"use strict";
const electron = require("electron");
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
electron.contextBridge.exposeInMainWorld("ds5", {
  // Device
  connect: () => electron.ipcRenderer.invoke(IPC.DEVICE_CONNECT),
  disconnect: () => electron.ipcRenderer.invoke(IPC.DEVICE_DISCONNECT),
  getStatus: () => electron.ipcRenderer.invoke(IPC.DEVICE_STATUS),
  getBattery: () => electron.ipcRenderer.invoke(IPC.DEVICE_BATTERY),
  // Config
  readConfig: () => electron.ipcRenderer.invoke(IPC.CONFIG_READ),
  writeConfig: (cfg, reconnect) => electron.ipcRenderer.invoke(IPC.CONFIG_WRITE, cfg, reconnect),
  saveConfig: () => electron.ipcRenderer.invoke(IPC.CONFIG_SAVE),
  // Presets
  presets: {
    list: () => electron.ipcRenderer.invoke(IPC.PRESETS_LIST),
    load: (name) => electron.ipcRenderer.invoke(IPC.PRESETS_LOAD, name),
    save: (name, cfg) => electron.ipcRenderer.invoke(IPC.PRESETS_SAVE, name, cfg),
    delete: (name) => electron.ipcRenderer.invoke(IPC.PRESETS_DELETE, name)
  },
  // App helpers
  getVersion: () => electron.ipcRenderer.invoke(IPC.APP_GET_VERSION),
  openUrl: (url) => electron.ipcRenderer.invoke(IPC.SHELL_OPEN_URL, url),
  // Telemetry consent — read and write from the renderer settings UI
  getTelemetryConsent: () => electron.ipcRenderer.invoke(IPC.TELEMETRY_GET_CONSENT),
  setTelemetryConsent: (value) => electron.ipcRenderer.invoke(IPC.TELEMETRY_SET_CONSENT, value),
  // Push events — return a cleanup function so useEffect can unsubscribe on unmount
  onDeviceChanged: (cb) => {
    const listener = (_e, p) => cb(p);
    electron.ipcRenderer.on(IPC_EVENTS.DEVICE_CHANGED, listener);
    return () => electron.ipcRenderer.removeListener(IPC_EVENTS.DEVICE_CHANGED, listener);
  },
  onTelemetry: (cb) => {
    const listener = (_e, p) => cb(p);
    electron.ipcRenderer.on(IPC_EVENTS.DEVICE_TELEMETRY, listener);
    return () => electron.ipcRenderer.removeListener(IPC_EVENTS.DEVICE_TELEMETRY, listener);
  },
  onLoopbackStatus: (cb) => {
    const listener = (_e, p) => cb(p);
    electron.ipcRenderer.on(IPC_EVENTS.LOOPBACK_STATUS, listener);
    return () => electron.ipcRenderer.removeListener(IPC_EVENTS.LOOPBACK_STATUS, listener);
  },
  platform: process.platform
});
