// Windows-only WASAPI loopback engine.
//
// Captures the current default audio output and mirrors it to the DS5 dongle
// USB sound card, so the firmware converts it into haptics.
//
// audify (RtAudio) is loaded from a *separate* Node.js process (loopback-worker.js)
// spawned with the system `node` executable. This sidesteps the ABI mismatch
// between Electron's embedded Node and the system Node that installed audify:
// the audio never flows through the Electron main process at all.
//
// On Linux the loopback is handled externally by pw-loopback — this class is a no-op.

import { EventEmitter } from 'events';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadSettings, saveSettings } from '../store/settings';

export interface LoopbackStatus {
  running: boolean;
  deviceName?: string;
  error?: string;
}

export interface AudioDevice {
  id: number;
  name: string;
  outputChannels: number;
  inputChannels: number;
}

interface WorkerStatusEvent {
  event: 'status';
  running: boolean;
  deviceName?: string;
  error?: string;
}

interface WorkerDevicesEvent {
  event: 'devices';
  devices?: AudioDevice[];
  defOutId?: number;
  error?: string;
}

type WorkerEvent = WorkerStatusEvent | WorkerDevicesEvent;

const KILL_GRACE_MS = 500;

class LoopbackEngine extends EventEmitter {
  private child: ChildProcess | null = null;
  private stdoutBuf = '';
  private status: LoopbackStatus = { running: false };
  private stopping = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceResolvers: Array<(r: { devices: AudioDevice[]; defOutId: number }) => void> = [];

  start(): void {
    if (process.platform !== 'win32') return; // WASAPI loopback is Windows-only
    if (this.child) return;                    // already running

    const nodeExe = this.findNodeExecutable();
    if (!nodeExe) {
      this.setStatus({ running: false, error: 'system Node.js executable not found in PATH' });
      return;
    }

    const workerPath = join(__dirname, 'loopback-worker.js');
    if (!existsSync(workerPath)) {
      this.setStatus({ running: false, error: `loopback worker not found: ${workerPath}` });
      return;
    }

    this.stopping = false;
    try {
      this.child = spawn(nodeExe, [workerPath], {
        stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr → worker debug logs in our console
        windowsHide: true,
      });
    } catch (err) {
      this.setStatus({ running: false, error: `failed to spawn loopback worker: ${String(err)}` });
      this.child = null;
      return;
    }

    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk));

    this.child.on('error', (err) => {
      this.setStatus({ running: false, error: `loopback worker error: ${String(err)}` });
    });

    this.child.on('exit', () => {
      this.child = null;
      this.stdoutBuf = '';
      if (this.killTimer) { clearTimeout(this.killTimer); this.killTimer = null; }
      // Only surface a "stopped" status if we weren't already reporting not-running.
      if (this.status.running) this.setStatus({ running: false });
    });

    // Kick off the loopback, forwarding any persisted source preference.
    const source = loadSettings().loopbackSourceName ?? '';
    this.send({ cmd: 'start', source });
  }

  stop(): void {
    if (!this.child) {
      if (this.status.running) this.setStatus({ running: false });
      return;
    }
    this.stopping = true;
    this.send({ cmd: 'stop' });

    // Force-kill if the worker hasn't exited within the grace period.
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => {
      if (this.child) {
        try { this.child.kill(); } catch { /* already gone */ }
      }
    }, KILL_GRACE_MS);
  }

  getStatus(): LoopbackStatus {
    return { ...this.status };
  }

  listDevices(): Promise<{ devices: AudioDevice[]; defOutId: number }> {
    if (process.platform !== 'win32' || !this.child) {
      return Promise.resolve({ devices: [], defOutId: -1 });
    }
    return new Promise((resolve) => {
      let settled = false;
      const wrappedResolve = (r: { devices: AudioDevice[]; defOutId: number }) => {
        if (!settled) { settled = true; resolve(r); }
      };
      const timer = setTimeout(() => {
        const idx = this.deviceResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.deviceResolvers.splice(idx, 1);
        wrappedResolve({ devices: [], defOutId: -1 });
      }, 2000);
      this.deviceResolvers.push((r) => {
        clearTimeout(timer);
        wrappedResolve(r);
      });
      this.send({ cmd: 'list-devices' });
    });
  }

  getSource(): string | null {
    return loadSettings().loopbackSourceName ?? null;
  }

  setSource(name: string | null): void {
    const s = loadSettings();
    s.loopbackSourceName = name;
    saveSettings(s);
    if (this.child) {
      this.send({ cmd: 'set-source', source: name ?? '' });
    }
  }

  // ---- Private ---------------------------------------------------------------

  private setStatus(status: LoopbackStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  private send(msg: Record<string, unknown>): void {
    try {
      this.child?.stdin?.write(JSON.stringify(msg) + '\n');
    } catch {
      /* worker stdin closed */
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: WorkerEvent;
      try {
        msg = JSON.parse(line) as WorkerEvent;
      } catch {
        continue; // ignore non-JSON noise
      }
      if (msg.event === 'status') {
        this.setStatus({
          running: !!msg.running,
          deviceName: msg.deviceName,
          error: msg.error,
        });
      } else if (msg.event === 'devices') {
        const resolver = this.deviceResolvers.shift();
        if (resolver) {
          resolver({ devices: msg.devices ?? [], defOutId: msg.defOutId ?? -1 });
        }
      }
    }
  }

  // Locate the system `node` executable. process.execPath points at Electron,
  // so it cannot be used here. We probe PATH via `where`/`which`, then a couple
  // of well-known install locations as a fallback.
  private findNodeExecutable(): string | null {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    try {
      const out = execSync(cmd, { encoding: 'utf8' }).trim();
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && existsSync(first)) return first;
    } catch {
      /* not on PATH — fall through to known locations */
    }

    if (process.platform === 'win32') {
      const fallbacks = [
        join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      ];
      for (const f of fallbacks) {
        if (existsSync(f)) return f;
      }
    }

    return null;
  }
}

export const loopbackEngine = new LoopbackEngine();
