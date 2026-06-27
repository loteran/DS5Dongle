// DS5Dongle WASAPI loopback worker.
//
// This script is NOT bundled by electron-vite — it is copied verbatim to
// out/main/ and spawned as a *separate* Node.js process using the system Node
// executable (whose ABI matches the prebuilt `audify` binary). Running audify
// here avoids the ABI mismatch between Electron's embedded Node and the system
// Node that compiled/installed audify.
//
// Protocol (line-delimited JSON):
//   stdin  (commands): {"cmd":"start"}  {"cmd":"stop"}
//   stdout (events):   {"event":"status","running":true,"deviceName":"..."}
//                      {"event":"status","running":false,"error":"..."}
//   stderr:            free-form debug logs
//
// CommonJS only — this file is executed directly by `node`, not transpiled.

'use strict';

/* ----------------------------------------------------------------------------
 * Resolve and load audify
 *
 * In dev:  __dirname = <project>/out/main           → ../../node_modules/audify
 * In prod (packaged, asar): main lives inside app.asar; native modules are not
 *          requirable from inside the asar, so audify must be reachable from an
 *          unpacked location. We try a list of candidate roots and use the
 *          first that resolves.
 * ------------------------------------------------------------------------- */

const path = require('path');

function loadAudify() {
  const candidates = [];

  // 1. Honour an explicit override from the parent process.
  if (process.env.AUDIFY_PATH) candidates.push(process.env.AUDIFY_PATH);

  // 2. Plain resolution against this worker's own node_modules chain.
  candidates.push('audify');

  // 3. Relative to common layouts (dev out/main, packaged resources, asar unpacked).
  const roots = [
    path.join(__dirname, '..', '..', 'node_modules', 'audify'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'audify'),
    path.join(__dirname, '..', 'node_modules', 'audify'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'audify'),
    path.join(process.resourcesPath || '', 'node_modules', 'audify'),
  ];
  for (const r of roots) candidates.push(r);

  let lastErr = null;
  for (const c of candidates) {
    try {
      return require(c);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'Unable to load audify from any known location. Last error: ' +
      (lastErr ? lastErr.message : 'unknown')
  );
}

let audify;
try {
  audify = loadAudify();
} catch (err) {
  emit({ event: 'status', running: false, error: String(err && err.message ? err.message : err) });
  // Keep the process alive so the parent can read the error and decide to stop.
}

/* ----------------------------------------------------------------------------
 * Config
 * ------------------------------------------------------------------------- */

const SAMPLE_RATE  = 48000;
const CHANNELS     = 2;
const FRAME_SIZE   = Number(process.env.FRAME || 480); // 10 ms @ 48 kHz
const POLL_MS      = 500;
const DONGLE_MATCH = (process.env.DONGLE || 'dualsense').toLowerCase();

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

let rtOut = null;            // RtAudio instance for the dongle output stream
let rtIn  = null;            // RtAudio instance for the default-output capture stream
let currentDefOutId   = null;
let currentDeviceName = '';
let pollTimer = null;
let active = false;
let preferredSourceName = null; // explicit capture source; null = follow Windows default

/* ----------------------------------------------------------------------------
 * IPC helpers
 * ------------------------------------------------------------------------- */

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch {
    /* parent gone */
  }
}

function log(...args) {
  try {
    process.stderr.write('[loopback-worker] ' + args.join(' ') + '\n');
  } catch {
    /* ignore */
  }
}

/* ----------------------------------------------------------------------------
 * audify helpers
 * ------------------------------------------------------------------------- */

function makeRt() {
  const { RtAudio, RtAudioApi } = audify;
  return process.platform === 'win32'
    ? new RtAudio(RtAudioApi.WINDOWS_WASAPI)
    : new RtAudio();
}

function enumerate() {
  const rt = makeRt();
  return { devices: rt.getDevices(), defOutId: rt.getDefaultOutputDevice() };
}

function findDongle(devices) {
  return devices.find(
    (d) => d.outputChannels > 0 && d.name.toLowerCase().includes(DONGLE_MATCH)
  );
}

/* ----------------------------------------------------------------------------
 * Stream lifecycle
 * ------------------------------------------------------------------------- */

function openOutput(dongle) {
  const { RtAudioFormat, RtAudioStreamFlags } = audify;
  try {
    const rt = makeRt();
    rt.openStream(
      { deviceId: dongle.id, nChannels: CHANNELS, firstChannel: 0 },
      null,
      RtAudioFormat.RTAUDIO_SINT16,
      SAMPLE_RATE,
      FRAME_SIZE,
      'ds5-dongle-out',
      null,
      null,
      RtAudioStreamFlags.RTAUDIO_MINIMIZE_LATENCY,
      (err) => log('output stream error:', String(err))
    );
    rt.start();
    rtOut = rt;
    log('output stream opened on', dongle.name);
  } catch (err) {
    log('failed to open output stream:', String(err));
    emit({ event: 'status', running: false, error: String(err) });
  }
}

function openInput(defOut) {
  const { RtAudioFormat } = audify;
  closeInput();

  currentDefOutId   = defOut.id;
  currentDeviceName = defOut.name;

  const out = rtOut;
  try {
    const rt = makeRt();
    rt.openStream(
      null,
      { deviceId: defOut.id, nChannels: CHANNELS, firstChannel: 0 },
      RtAudioFormat.RTAUDIO_SINT16,
      SAMPLE_RATE,
      FRAME_SIZE,
      'ds5-loopback-in',
      (inputBuf) => {
        try { out.write(Buffer.from(inputBuf)); } catch { /* output closed */ }
      },
      null,
      0,
      (err) => { if (err !== 1) log('input stream error:', String(err)); }
    );
    rt.start();
    rtIn = rt;
    log('capturing source:', defOut.name);
    emit({ event: 'status', running: true, deviceName: defOut.name });
  } catch (err) {
    log('failed to open input stream:', String(err));
    currentDefOutId   = null;
    currentDeviceName = '';
    emit({ event: 'status', running: false, error: String(err) });
  }
}

function closeInput() {
  if (rtIn) {
    try { rtIn.closeStream(); } catch { /* ignore */ }
    rtIn = null;
  }
  currentDefOutId   = null;
  currentDeviceName = '';
}

function closeOutput() {
  if (rtOut) {
    try { rtOut.closeStream(); } catch { /* ignore */ }
    rtOut = null;
  }
}

/* ----------------------------------------------------------------------------
 * Poll loop — opens output once the dongle appears, then (re)opens the capture
 * stream whenever the default output device changes.
 * Guards against feedback when the dongle is itself the default output.
 * ------------------------------------------------------------------------- */

function poll() {
  if (!audify) return;
  try {
    const { devices, defOutId } = enumerate();
    const dongle = findDongle(devices);

    if (!rtOut) {
      if (!dongle) return;
      openOutput(dongle);
      if (!rtOut) return;
    }

    // Determine the desired capture source: use preferred name if set, else fall back to Windows default
    let src = null;
    if (preferredSourceName) {
      src = devices.find((d) => d.outputChannels > 0 && d.name === preferredSourceName);
    }
    if (!src) {
      src = devices.find((d) => d.id === defOutId); // fall back to Windows default output
    }
    if (!src) return;

    // Feedback guard: refuse to capture the dongle into itself
    if (dongle && src.id === dongle.id) {
      log('source is the dongle — skipping to avoid feedback loop');
      if (rtIn) closeInput();
      return;
    }

    // Only reopen when the chosen source changes
    if (src.id === currentDefOutId) return;
    openInput(src);
  } catch (err) {
    log('poll error:', String(err));
  }
}

/* ----------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------- */

function startLoopback(msg) {
  if (msg && typeof msg.source === 'string') {
    preferredSourceName = msg.source || null;
  }
  if (active) return;
  if (!audify) {
    emit({ event: 'status', running: false, error: 'audify not available' });
    return;
  }
  if (process.platform !== 'win32') {
    // WASAPI loopback is Windows-only; nothing to do elsewhere.
    emit({ event: 'status', running: false });
    return;
  }
  active = true;
  log('start');
  try {
    const { devices, defOutId } = enumerate();
    log('audio devices:\n' + devices.map(d => `  [${d.id}] "${d.name}" out=${d.outputChannels} in=${d.inputChannels}`).join('\n'));
    log('default output id:', defOutId);
  } catch (e) {
    log('enumerate error:', String(e));
  }
  poll(); // immediate attempt
  pollTimer = setInterval(poll, POLL_MS);
}

function stopLoopback() {
  if (!active && !pollTimer && !rtOut && !rtIn) {
    emit({ event: 'status', running: false });
    return;
  }
  active = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  closeInput();
  closeOutput();
  log('stop');
  emit({ event: 'status', running: false });
}

/* ----------------------------------------------------------------------------
 * stdin command reader (line-delimited JSON)
 * ------------------------------------------------------------------------- */

let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('invalid command JSON:', line);
      continue;
    }
    if (msg && msg.cmd === 'start') startLoopback(msg);
    else if (msg && msg.cmd === 'stop') stopLoopback();
    else if (msg && msg.cmd === 'set-source') {
      preferredSourceName = (msg.source || null);
      // Force immediate re-evaluation on the new source
      currentDefOutId = null;
      poll();
    }
    else if (msg && msg.cmd === 'list-devices') {
      try {
        const { devices, defOutId } = enumerate();
        emit({ event: 'devices', devices: devices.map(d => ({ id: d.id, name: d.name, outputChannels: d.outputChannels, inputChannels: d.inputChannels })), defOutId });
      } catch (e) {
        emit({ event: 'devices', error: String(e) });
      }
    }
    else log('unknown command:', line);
  }
});

// When the parent closes our stdin, treat it as a stop + exit.
process.stdin.on('end', () => {
  shutdown(0);
});

/* ----------------------------------------------------------------------------
 * Clean shutdown
 * ------------------------------------------------------------------------- */

function shutdown(code) {
  try {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    closeInput();
    closeOutput();
  } catch {
    /* ignore */
  }
  process.exit(code || 0);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT',  () => shutdown(0));
process.on('uncaughtException', (err) => {
  log('uncaught exception:', String(err && err.stack ? err.stack : err));
  emit({ event: 'status', running: false, error: String(err && err.message ? err.message : err) });
});

// Keep the event loop alive even before the first command arrives.
process.stdin.resume();
