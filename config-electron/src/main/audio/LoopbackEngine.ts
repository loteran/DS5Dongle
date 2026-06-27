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
import { app } from 'electron';

export interface LoopbackStatus {
  running: boolean;
  deviceName?: string;
  error?: string;
}

interface WorkerStatusEvent {
  event: 'status';
  running: boolean;
  deviceName?: string;
  error?: string;
}

const KILL_GRACE_MS = 500;

class LoopbackEngine extends EventEmitter {
  private child: ChildProcess | null = null;
  private stdoutBuf = '';
  private status: LoopbackStatus = { running: false };
  private stopping = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (process.platform !== 'win32') return; // WASAPI loopback is Windows-only
    if (this.child) return;                    // already running

    const workerPath = join(__dirname, 'loopback-worker.js');
    if (!existsSync(workerPath)) {
      this.setStatus({ running: false, error: `loopback worker not found: ${workerPath}` });
      return;
    }

    // Decide how to run the worker process.
    // - Packaged: spawn Electron itself as a plain Node runtime (ELECTRON_RUN_AS_NODE).
    //   This uses Electron's embedded Node, whose ABI matches the audify binary that
    //   electron-builder rebuilds at package time (npmRebuild). No system Node.js
    //   install is required, and Electron's asar-aware fs can read the worker script.
    // - Dev: audify was built for the system Node that ran `npm install`, so spawn that.
    const env: NodeJS.ProcessEnv = { ...process.env };
    let exe: string;
    if (app.isPackaged) {
      exe = process.execPath;
      env.ELECTRON_RUN_AS_NODE = '1';
      // Point the worker straight at the unpacked native module (see asarUnpack).
      env.AUDIFY_PATH = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'audify');
    } else {
      const nodeExe = this.findNodeExecutable();
      if (!nodeExe) {
        this.setStatus({ running: false, error: 'system Node.js executable not found in PATH (dev mode)' });
        return;
      }
      exe = nodeExe;
    }

    this.stopping = false;
    try {
      this.child = spawn(exe, [workerPath], {
        stdio: ['pipe', 'pipe', 'inherit'], // inherit stderr → worker debug logs in our console
        windowsHide: true,
        env,
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

    // Kick off the loopback.
    this.send({ cmd: 'start' });
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
      let msg: WorkerStatusEvent;
      try {
        msg = JSON.parse(line) as WorkerStatusEvent;
      } catch {
        continue; // ignore non-JSON noise
      }
      if (msg.event === 'status') {
        this.setStatus({
          running: !!msg.running,
          deviceName: msg.deviceName,
          error: msg.error,
        });
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
