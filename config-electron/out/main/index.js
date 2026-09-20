"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const events = require("events");
const child_process = require("child_process");
const HID = require("node-hid");
const crypto = require("crypto");
const os = require("os");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
function settingsPath() {
  return path.join(electron.app.getPath("userData"), "settings.json");
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch {
  }
}
const IPC = {
  DEVICE_CONNECT: "device:connect",
  DEVICE_DISCONNECT: "device:disconnect",
  DEVICE_STATUS: "device:status",
  DEVICE_BATTERY: "device:battery",
  CONFIG_READ: "config:read",
  CONFIG_WRITE: "config:write",
  CONFIG_SAVE: "config:save",
  PRESETS_LIST: "presets:list",
  PRESETS_LOAD: "presets:load",
  PRESETS_SAVE: "presets:save",
  PRESETS_DELETE: "presets:delete",
  APP_GET_VERSION: "app:getVersion",
  SHELL_OPEN_URL: "shell:openUrl",
  // Telemetry consent — renderer reads and writes via settings UI
  TELEMETRY_GET_CONSENT: "telemetry:getConsent",
  TELEMETRY_SET_CONSENT: "telemetry:setConsent"
};
const IPC_EVENTS = {
  DEVICE_CHANGED: "device:changed",
  DEVICE_TELEMETRY: "device:telemetry",
  LOOPBACK_STATUS: "loopback:status"
};
const KILL_GRACE_MS = 500;
class LoopbackEngine extends events.EventEmitter {
  child = null;
  stdoutBuf = "";
  status = { running: false };
  stopping = false;
  killTimer = null;
  start() {
    if (process.platform !== "win32") return;
    if (this.child) return;
    const workerPath = path.join(__dirname, "loopback-worker.js");
    if (!fs.existsSync(workerPath)) {
      this.setStatus({ running: false, error: `loopback worker not found: ${workerPath}` });
      return;
    }
    const env = { ...process.env };
    let exe;
    if (electron.app.isPackaged) {
      exe = process.execPath;
      env.ELECTRON_RUN_AS_NODE = "1";
      env.AUDIFY_PATH = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "audify");
    } else {
      const nodeExe = this.findNodeExecutable();
      if (!nodeExe) {
        this.setStatus({ running: false, error: "system Node.js executable not found in PATH (dev mode)" });
        return;
      }
      exe = nodeExe;
    }
    this.stopping = false;
    try {
      this.child = child_process.spawn(exe, [workerPath], {
        stdio: ["pipe", "pipe", "inherit"],
        // inherit stderr → worker debug logs in our console
        windowsHide: true,
        env
      });
    } catch (err) {
      this.setStatus({ running: false, error: `failed to spawn loopback worker: ${String(err)}` });
      this.child = null;
      return;
    }
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk) => this.onStdout(chunk));
    this.child.on("error", (err) => {
      this.setStatus({ running: false, error: `loopback worker error: ${String(err)}` });
    });
    this.child.on("exit", () => {
      this.child = null;
      this.stdoutBuf = "";
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      if (this.status.running) this.setStatus({ running: false });
    });
    this.send({ cmd: "start" });
  }
  stop() {
    if (!this.child) {
      if (this.status.running) this.setStatus({ running: false });
      return;
    }
    this.stopping = true;
    this.send({ cmd: "stop" });
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => {
      if (this.child) {
        try {
          this.child.kill();
        } catch {
        }
      }
    }, KILL_GRACE_MS);
  }
  getStatus() {
    return { ...this.status };
  }
  // ---- Private ---------------------------------------------------------------
  setStatus(status) {
    this.status = status;
    this.emit("status", status);
  }
  send(msg) {
    try {
      this.child?.stdin?.write(JSON.stringify(msg) + "\n");
    } catch {
    }
  }
  onStdout(chunk) {
    this.stdoutBuf += chunk;
    let nl;
    while ((nl = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.event === "status") {
        this.setStatus({
          running: !!msg.running,
          deviceName: msg.deviceName,
          error: msg.error
        });
      }
    }
  }
  // Locate the system `node` executable. process.execPath points at Electron,
  // so it cannot be used here. We probe PATH via `where`/`which`, then a couple
  // of well-known install locations as a fallback.
  findNodeExecutable() {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    try {
      const out = child_process.execSync(cmd, { encoding: "utf8" }).trim();
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    } catch {
    }
    if (process.platform === "win32") {
      const fallbacks = [
        path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
        path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe")
      ];
      for (const f of fallbacks) {
        if (fs.existsSync(f)) return f;
      }
    }
    return null;
  }
}
const loopbackEngine = new LoopbackEngine();
const SONY_VID = 1356;
const DS5_PID = 3302;
const EDGE_PID = 3570;
const REPORT_READ_CONFIG = 247;
const REPORT_CMD = 246;
const REPORT_FIRMWARE_VERSION = 248;
const REPORT_RSSI = 249;
const CMD_WRITE_CONFIG = 1;
const CMD_SAVE_CONFIG = 2;
const CMD_RECONNECT_USB = 3;
const CONFIG_SIZE = 30;
const FIELD_OFFSETS = {
  hapticsGain: 0,
  // float32LE [0..3]
  speakerVolume: 4,
  // uint8 [0..127] linear (was float dB pre-merge)
  headsetVolume: 5,
  // uint8 [0..127] linear
  speakerGain: 6,
  // uint8 [0..7] (0 = auto)
  inactiveTime: 7,
  // uint8 [0..60] minutes (0 = disable, folds old disableInactiveDisconnect)
  disablePicoLed: 8,
  // uint8 (bool)
  pollingRateMode: 9,
  // uint8
  audioBufferLength: 10,
  // uint8
  controllerMode: 11,
  // uint8
  autoHapticsEnable: 12,
  // uint8
  autoHapticsGain: 13,
  // uint8
  autoHapticsLowpassHz: 14,
  // uint16LE [14..15]
  enablePoweroffShortcut: 16,
  // uint8 (bool)
  enableTouchpad: 17,
  // uint8 (bool)
  poweroffButton: 18,
  // uint8
  touchpadButton: 19,
  // uint8
  batteryColorEnable: 20,
  // uint8 (bool)
  wakeEnable: 21,
  // uint8 (bool) — legacy field, superseded by enableWake, kept for wire compat only
  autoHapticsMuteReplace: 22,
  // uint8 (bool)
  autoHapticsMuteMix: 23,
  // uint8 (bool)
  enableUsbSn: 24,
  // uint8 (bool)
  psShortcutEnabled: 25,
  // uint8 (bool) — Xbox Game Bar shortcut via HID keyboard
  disableMic: 26,
  // uint8 (bool)
  disableSpeaker: 27,
  // uint8 (bool)
  enableWake: 28,
  // uint8 (bool) — active wake toggle (upstream)
  triggerReduce: 29
  // uint8 [0..10] (0 = auto)
};
class DS5DeviceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "DS5DeviceError";
  }
}
function unpackConfig(raw) {
  if (raw.length < CONFIG_SIZE) {
    raw = Buffer.concat([raw, Buffer.alloc(CONFIG_SIZE - raw.length)]);
  }
  const o = FIELD_OFFSETS;
  const cfg = {
    hapticsGain: Math.min(2, Math.max(1, raw.readFloatLE(o.hapticsGain))),
    speakerVolume: raw.readUInt8(o.speakerVolume),
    headsetVolume: raw.readUInt8(o.headsetVolume),
    speakerGain: raw.readUInt8(o.speakerGain),
    inactiveTime: raw.readUInt8(o.inactiveTime),
    disablePicoLed: raw.readUInt8(o.disablePicoLed) !== 0,
    pollingRateMode: raw.readUInt8(o.pollingRateMode),
    audioBufferLength: raw.readUInt8(o.audioBufferLength),
    controllerMode: raw.readUInt8(o.controllerMode),
    autoHapticsEnable: raw.readUInt8(o.autoHapticsEnable),
    autoHapticsGain: raw.readUInt8(o.autoHapticsGain),
    autoHapticsLowpassHz: raw.readUInt16LE(o.autoHapticsLowpassHz),
    enablePoweroffShortcut: raw.readUInt8(o.enablePoweroffShortcut) !== 0,
    enableTouchpad: raw.readUInt8(o.enableTouchpad) !== 0,
    poweroffButton: raw.readUInt8(o.poweroffButton),
    touchpadButton: raw.readUInt8(o.touchpadButton),
    batteryColorEnable: raw.readUInt8(o.batteryColorEnable) !== 0,
    wakeEnable: raw.readUInt8(o.wakeEnable) !== 0,
    autoHapticsMuteReplace: raw.readUInt8(o.autoHapticsMuteReplace) !== 0,
    autoHapticsMuteMix: raw.readUInt8(o.autoHapticsMuteMix) !== 0,
    enableUsbSn: raw.readUInt8(o.enableUsbSn) !== 0,
    psShortcutEnabled: raw.readUInt8(o.psShortcutEnabled) !== 0,
    disableMic: raw.readUInt8(o.disableMic) !== 0,
    disableSpeaker: raw.readUInt8(o.disableSpeaker) !== 0,
    enableWake: raw.readUInt8(o.enableWake) !== 0,
    triggerReduce: raw.readUInt8(o.triggerReduce)
  };
  return cfg;
}
function packConfig(cfg) {
  const buf = Buffer.alloc(CONFIG_SIZE);
  const o = FIELD_OFFSETS;
  buf.writeFloatLE(cfg.hapticsGain, o.hapticsGain);
  buf.writeUInt8(cfg.speakerVolume, o.speakerVolume);
  buf.writeUInt8(cfg.headsetVolume, o.headsetVolume);
  buf.writeUInt8(cfg.speakerGain, o.speakerGain);
  buf.writeUInt8(cfg.inactiveTime, o.inactiveTime);
  buf.writeUInt8(cfg.disablePicoLed ? 1 : 0, o.disablePicoLed);
  buf.writeUInt8(cfg.pollingRateMode, o.pollingRateMode);
  buf.writeUInt8(cfg.audioBufferLength, o.audioBufferLength);
  buf.writeUInt8(cfg.controllerMode, o.controllerMode);
  buf.writeUInt8(cfg.autoHapticsEnable, o.autoHapticsEnable);
  buf.writeUInt8(cfg.autoHapticsGain, o.autoHapticsGain);
  buf.writeUInt16LE(cfg.autoHapticsLowpassHz, o.autoHapticsLowpassHz);
  buf.writeUInt8(cfg.enablePoweroffShortcut ? 1 : 0, o.enablePoweroffShortcut);
  buf.writeUInt8(cfg.enableTouchpad ? 1 : 0, o.enableTouchpad);
  buf.writeUInt8(cfg.poweroffButton, o.poweroffButton);
  buf.writeUInt8(cfg.touchpadButton, o.touchpadButton);
  buf.writeUInt8(cfg.batteryColorEnable ? 1 : 0, o.batteryColorEnable);
  buf.writeUInt8(cfg.wakeEnable ? 1 : 0, o.wakeEnable);
  buf.writeUInt8(cfg.autoHapticsMuteReplace ? 1 : 0, o.autoHapticsMuteReplace);
  buf.writeUInt8(cfg.autoHapticsMuteMix ? 1 : 0, o.autoHapticsMuteMix);
  buf.writeUInt8(cfg.enableUsbSn ? 1 : 0, o.enableUsbSn);
  buf.writeUInt8(cfg.psShortcutEnabled ? 1 : 0, o.psShortcutEnabled);
  buf.writeUInt8(cfg.disableMic ? 1 : 0, o.disableMic);
  buf.writeUInt8(cfg.disableSpeaker ? 1 : 0, o.disableSpeaker);
  buf.writeUInt8(cfg.enableWake ? 1 : 0, o.enableWake);
  buf.writeUInt8(cfg.triggerReduce, o.triggerReduce);
  return buf;
}
class DS5HapticsDevice {
  device = null;
  _model = null;
  // --- Connection management ---
  connect() {
    const candidates = [
      [DS5_PID, "DualSense"],
      [EDGE_PID, "DualSense Edge"]
    ];
    for (const [pid, label] of candidates) {
      const infos = HID.devices(SONY_VID, pid);
      if (infos.length === 0) continue;
      for (const info of infos) {
        if (!info.path) continue;
        let dev = null;
        try {
          dev = new HID.HID(info.path);
          dev.getFeatureReport(REPORT_READ_CONFIG, 64);
          this.device = dev;
          this._model = label;
          return label;
        } catch {
          try {
            dev?.close();
          } catch {
          }
        }
      }
    }
    throw new DS5DeviceError(
      "NOT_FOUND",
      "DS5Dongle not found. Make sure the Pico is plugged in via USB."
    );
  }
  disconnect() {
    if (this.device) {
      try {
        this.device.close();
      } catch {
      }
      this.device = null;
      this._model = null;
    }
  }
  isConnected() {
    return this.device !== null;
  }
  get model() {
    return this._model;
  }
  assertConnected() {
    if (!this.device) {
      throw new DS5DeviceError("NOT_CONNECTED", "Not connected to DS5Dongle.");
    }
    return this.device;
  }
  // --- Config read / write ---
  readConfig() {
    const dev = this.assertConnected();
    const raw = dev.getFeatureReport(REPORT_READ_CONFIG, 64);
    const body = Buffer.from(raw.slice(1, 1 + CONFIG_SIZE));
    return unpackConfig(body);
  }
  writeConfig(cfg) {
    const dev = this.assertConnected();
    const payload = Buffer.alloc(2 + CONFIG_SIZE);
    payload[0] = REPORT_CMD;
    payload[1] = CMD_WRITE_CONFIG;
    packConfig(cfg).copy(payload, 2);
    dev.sendFeatureReport([...payload]);
  }
  saveConfig() {
    const dev = this.assertConnected();
    dev.sendFeatureReport([REPORT_CMD, CMD_SAVE_CONFIG]);
  }
  // Triggers a USB soft-reset on the Pico — the device disappears briefly then
  // reappears. Caller is responsible for waiting for re-attach (via hotplug.ts).
  reconnectUsb() {
    const dev = this.assertConnected();
    dev.sendFeatureReport([REPORT_CMD, CMD_RECONNECT_USB]);
    this.disconnect();
  }
  // --- Informational reads (firmware extensions) ---
  readFirmwareVersion() {
    const dev = this.assertConnected();
    const raw = dev.getFeatureReport(REPORT_FIRMWARE_VERSION, 32);
    const bytes = raw.slice(1);
    const end = bytes.indexOf(0);
    return Buffer.from(end === -1 ? bytes : bytes.slice(0, end)).toString("ascii");
  }
  readRssi() {
    const dev = this.assertConnected();
    const raw = dev.getFeatureReport(REPORT_RSSI, 2);
    if (raw.length < 2) return null;
    const byte = raw[1];
    return byte > 127 ? byte - 256 : byte;
  }
}
const hapticsDongle = new DS5HapticsDevice();
class LinuxUpower {
  async read() {
    return new Promise((resolve) => {
      child_process.execFile("upower", ["-d"], { timeout: 3e3 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        const idx = stdout.indexOf("DualSense");
        if (idx === -1) {
          resolve(null);
          return;
        }
        const window = stdout.slice(idx, idx + 400);
        const match = window.match(/percentage:\s+(\d+)%/);
        resolve(match ? parseInt(match[1], 10) : null);
      });
    });
  }
}
class WindowsBattery {
  async read() {
    return null;
  }
}
const PRESET_SCHEMA_VERSION = 1;
const PRESET_NAME_RE = /^[\w\s-]+$/;
function isValidPresetName(name) {
  return name.trim().length > 0 && PRESET_NAME_RE.test(name);
}
function toSafeFilename(name) {
  return name.trim().replace(/\s+/g, "_").toLowerCase();
}
class PresetStore {
  presetsDir() {
    const dir = path.join(electron.app.getPath("userData"), "presets");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  filePath(name) {
    return path.join(this.presetsDir(), `${toSafeFilename(name)}.json`);
  }
  list() {
    const dir = this.presetsDir();
    const summaries = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, entry), "utf-8");
        const file = JSON.parse(raw);
        summaries.push({ name: file.name, savedAt: file.savedAt });
      } catch {
      }
    }
    return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  load(name) {
    const raw = fs.readFileSync(this.filePath(name), "utf-8");
    const file = JSON.parse(raw);
    return file.config;
  }
  save(name, config) {
    if (!isValidPresetName(name)) throw new Error(`Invalid preset name: "${name}"`);
    const file = {
      _schema: PRESET_SCHEMA_VERSION,
      name,
      savedAt: (/* @__PURE__ */ new Date()).toISOString(),
      config
    };
    fs.writeFileSync(this.filePath(name), JSON.stringify(file, null, 2), "utf-8");
  }
  delete(name) {
    const path2 = this.filePath(name);
    if (fs.existsSync(path2)) fs.unlinkSync(path2);
  }
}
const presetStore = new PresetStore();
const usbModule = require("usb");
const usbBus = usbModule.usb;
function isDS5Dongle(device) {
  const { idVendor, idProduct } = device.deviceDescriptor;
  return idVendor === SONY_VID && (idProduct === DS5_PID || idProduct === EDGE_PID);
}
let attachListener = null;
let detachListener = null;
function startHotplugWatcher(cb) {
  attachListener = (device) => {
    if (isDS5Dongle(device)) cb("attach");
  };
  detachListener = (device) => {
    if (isDS5Dongle(device)) cb("detach");
  };
  usbBus.on("attach", attachListener);
  usbBus.on("detach", detachListener);
  usbBus.setMaxListeners(20);
}
function stopHotplugWatcher() {
  if (attachListener) {
    usbBus.off("attach", attachListener);
    attachListener = null;
  }
  if (detachListener) {
    usbBus.off("detach", detachListener);
    detachListener = null;
  }
}
function waitForReattach(timeoutMs = 1e4) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      usbBus.off("attach", onAttach);
      reject(new Error("USB reconnect timeout"));
    }, timeoutMs);
    const onAttach = (device) => {
      if (!isDS5Dongle(device)) return;
      clearTimeout(timer);
      usbBus.off("attach", onAttach);
      setTimeout(resolve, 300);
    };
    usbBus.on("attach", onAttach);
  });
}
const TELEMETRY_ENDPOINT = "https://ds5-telemetry.arctis-asm.workers.dev/collect";
const INSTALLATION_ID_SALT = "ds5dongle-autohaptics";
function getConsent() {
  const s = loadSettings();
  if (s.telemetryConsent === true) return true;
  if (s.telemetryConsent === false) return false;
  return null;
}
function setConsent(value) {
  const s = loadSettings();
  s.telemetryConsent = value;
  saveSettings(s);
}
function readRawMachineId() {
  const plat = process.platform;
  if (plat === "linux") {
    for (const path2 of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try {
        const raw = fs.readFileSync(path2, "utf8").trim();
        if (raw) return raw;
      } catch {
      }
    }
    return null;
  }
  if (plat === "win32") {
    try {
      const out = child_process.execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { timeout: 3e3, encoding: "utf8" }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
      if (match) return match[1];
    } catch {
    }
    return null;
  }
  if (plat === "darwin") {
    try {
      const out = child_process.execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        timeout: 3e3,
        encoding: "utf8"
      });
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {
    }
    return null;
  }
  return null;
}
function machineIdHash() {
  const raw = readRawMachineId();
  if (!raw) return null;
  return crypto.createHash("sha256").update(`${INSTALLATION_ID_SALT}:${raw}`).digest("hex").slice(0, 32);
}
function getInstallationId() {
  const hashed = machineIdHash();
  if (hashed) return hashed;
  const s = loadSettings();
  if (s.telemetryInstallId) return s.telemetryInstallId;
  const uuid = crypto.randomUUID();
  s.telemetryInstallId = uuid;
  saveSettings(s);
  return uuid;
}
function getOsLabel() {
  const plat = process.platform;
  if (plat === "linux") {
    try {
      const lines = fs.readFileSync("/etc/os-release", "utf8").split("\n");
      const fields = {};
      for (const line of lines) {
        const idx = line.indexOf("=");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
        fields[key] = val;
      }
      if (fields["PRETTY_NAME"]) return fields["PRETTY_NAME"];
      const name = fields["NAME"] ?? "";
      const version = fields["VERSION"] ?? fields["VERSION_ID"] ?? "";
      if (name && version) return `${name} ${version}`;
      if (name) return name;
    } catch {
    }
    return "Unknown Linux";
  }
  if (plat === "win32") {
    const ver = os__namespace.version();
    const build = os__namespace.release();
    const buildNum = build.split(".").pop() ?? build;
    if (ver) return `${ver} (${buildNum})`;
    return `Windows (build ${buildNum})`;
  }
  if (plat === "darwin") {
    return `macOS ${os__namespace.release()}`;
  }
  return `${process.platform} ${os__namespace.release()}`;
}
async function doSend(firmware) {
  const payload = {
    installation_id: getInstallationId(),
    platform: process.platform,
    os: getOsLabel(),
    version: electron.app.getVersion(),
    firmware: firmware || "Unknown"
  };
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    });
    const s = loadSettings();
    s.telemetryLastSent = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    saveSettings(s);
  } finally {
    clearTimeout(timeout);
  }
}
function maybeSend(opts = {}) {
  if (getConsent() !== true) return;
  if (TELEMETRY_ENDPOINT.includes("PLACEHOLDER")) return;
  const s = loadSettings();
  if (s.telemetryLastSent) {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (s.telemetryLastSent >= today) return;
  }
  const firmware = opts.firmware ?? "Unknown";
  doSend(firmware).catch(() => {
  });
}
const batteryProvider = process.platform === "linux" ? new LinuxUpower() : new WindowsBattery();
function registerHandlers() {
  electron.ipcMain.handle(IPC.DEVICE_CONNECT, () => {
    const model = hapticsDongle.connect();
    let firmwareVersion;
    try {
      firmwareVersion = hapticsDongle.readFirmwareVersion();
    } catch {
    }
    loopbackEngine.start();
    return { model, firmwareVersion };
  });
  electron.ipcMain.handle(IPC.DEVICE_DISCONNECT, () => {
    hapticsDongle.disconnect();
  });
  electron.ipcMain.handle(IPC.DEVICE_STATUS, () => {
    let rssi = null;
    try {
      if (hapticsDongle.isConnected()) rssi = hapticsDongle.readRssi();
    } catch {
    }
    return {
      connected: hapticsDongle.isConnected(),
      model: hapticsDongle.model ?? void 0,
      rssi: rssi ?? void 0
    };
  });
  electron.ipcMain.handle(IPC.DEVICE_BATTERY, async () => {
    const percent = await batteryProvider.read();
    return { percent };
  });
  electron.ipcMain.handle(IPC.CONFIG_READ, () => {
    return hapticsDongle.readConfig();
  });
  electron.ipcMain.handle(IPC.CONFIG_WRITE, async (_event, cfg, reconnect) => {
    hapticsDongle.writeConfig(cfg);
    hapticsDongle.saveConfig();
    if (reconnect) {
      hapticsDongle.reconnectUsb();
      try {
        await waitForReattach(1e4);
      } catch {
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          hapticsDongle.connect();
          return hapticsDongle.readConfig();
        } catch {
          if (attempt === 4) throw new Error("Config saved, but USB did not come back — reconnect manually.");
          await new Promise((r) => setTimeout(r, 1e3));
        }
      }
    }
    return cfg;
  });
  electron.ipcMain.handle(IPC.CONFIG_SAVE, () => {
    hapticsDongle.saveConfig();
  });
  electron.ipcMain.handle(IPC.PRESETS_LIST, () => presetStore.list());
  electron.ipcMain.handle(IPC.PRESETS_LOAD, (_e, name) => presetStore.load(name));
  electron.ipcMain.handle(IPC.PRESETS_SAVE, (_e, name, cfg) => presetStore.save(name, cfg));
  electron.ipcMain.handle(IPC.PRESETS_DELETE, (_e, name) => presetStore.delete(name));
  electron.ipcMain.handle(IPC.APP_GET_VERSION, () => electron.app.getVersion());
  electron.ipcMain.handle(IPC.SHELL_OPEN_URL, (_e, url) => {
    if (/^https:\/\/github\.com\/loteran\/DS5Dongle(\/|$)/.test(url)) {
      electron.shell.openExternal(url);
    }
  });
  electron.ipcMain.handle(IPC.TELEMETRY_GET_CONSENT, () => getConsent());
  electron.ipcMain.handle(IPC.TELEMETRY_SET_CONSENT, (_e, value) => setConsent(value));
}
const TELEMETRY_INTERVAL_MS = 3e4;
function startTelemetryTimer(win) {
  setInterval(async () => {
    if (win.isDestroyed() || !hapticsDongle.isConnected()) return;
    const battery = await batteryProvider.read().catch(() => null);
    let rssi = null;
    try {
      rssi = hapticsDongle.readRssi();
    } catch {
    }
    const payload = { battery, rssi };
    win.webContents.send(IPC_EVENTS.DEVICE_TELEMETRY, payload);
  }, TELEMETRY_INTERVAL_MS);
}
function setupHotplugEvents(win) {
  loopbackEngine.on("status", (payload) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.LOOPBACK_STATUS, payload);
  });
  startHotplugWatcher((event) => {
    if (win.isDestroyed()) return;
    if (event === "attach") {
      try {
        const model = hapticsDongle.connect();
        let firmwareVersion;
        try {
          firmwareVersion = hapticsDongle.readFirmwareVersion();
        } catch {
        }
        win.webContents.send(IPC_EVENTS.DEVICE_CHANGED, { connected: true, model, firmwareVersion });
        maybeSend({ firmware: firmwareVersion });
      } catch {
        win.webContents.send(IPC_EVENTS.DEVICE_CHANGED, { connected: false });
      }
      loopbackEngine.start();
    } else {
      hapticsDongle.disconnect();
      loopbackEngine.stop();
      win.webContents.send(IPC_EVENTS.DEVICE_CHANGED, { connected: false });
    }
  });
  electron.app.on("quit", () => {
    loopbackEngine.stop();
    stopHotplugWatcher();
  });
}
const DEFAULT_WIDTH = 780;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 700;
function createWindow() {
  const { windowBounds } = loadSettings();
  const win = new electron.BrowserWindow({
    width: windowBounds?.width ?? DEFAULT_WIDTH,
    height: windowBounds?.height ?? DEFAULT_HEIGHT,
    x: windowBounds?.x,
    y: windowBounds?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "DS5 Audio Haptics BT",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.on("close", () => {
    saveSettings({ windowBounds: win.getBounds() });
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
async function askTelemetryConsent(win) {
  if (getConsent() !== null) return;
  const { response } = await electron.dialog.showMessageBox(win, {
    type: "question",
    title: "Anonymous usage statistics",
    message: "Help improve DS5Dongle by sharing anonymous stats",
    detail: 'If you agree, the app will send once a day:\n  • Your OS (e.g. "Ubuntu 24.04" or "Windows 11 Pro")\n  • App version and firmware version\n\nNo personal data, no IP address, no controller input.\nThe ID is an irreversible hash — it cannot be traced back to you.\n\nYou can change this at any time in Settings.',
    buttons: ["Yes, help improve DS5Dongle", "No thanks"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  setConsent(response === 0);
}
electron.app.whenReady().then(async () => {
  const win = createWindow();
  registerHandlers();
  startTelemetryTimer(win);
  setupHotplugEvents(win);
  await askTelemetryConsent(win);
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
