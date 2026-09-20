import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import { loadSettings, saveSettings } from './store/settings';
import { registerHandlers, startTelemetryTimer, setupHotplugEvents } from './ipc/registerHandlers';
import { getConsent, setConsent } from './telemetry/telemetry';

const DEFAULT_WIDTH  = 780;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH      = 600;
const MIN_HEIGHT     = 700;

function createWindow(): BrowserWindow {
  const { windowBounds } = loadSettings();

  const win = new BrowserWindow({
    width:     windowBounds?.width  ?? DEFAULT_WIDTH,
    height:    windowBounds?.height ?? DEFAULT_HEIGHT,
    x:         windowBounds?.x,
    y:         windowBounds?.y,
    minWidth:  MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title:     'DS5 Audio Haptics BT',
    // Packaged builds get their icon from electron-builder.yml (build/icon.*);
    // this covers the dev-mode/Linux runtime window icon, which that config
    // doesn't touch.
    icon:      join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    },
  });

  // Persist window geometry on close
  win.on('close', () => {
    saveSettings({ windowBounds: win.getBounds() });
  });

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/** Show a native consent dialog once, on first launch. */
async function askTelemetryConsent(win: BrowserWindow): Promise<void> {
  if (getConsent() !== null) return; // already answered

  const { response } = await dialog.showMessageBox(win, {
    type:    'question',
    title:   'Anonymous usage statistics',
    message: 'Help improve DS5Dongle by sharing anonymous stats',
    detail:
      'If you agree, the app will send once a day:\n' +
      '  • Your OS (e.g. "Ubuntu 24.04" or "Windows 11 Pro")\n' +
      '  • App version and firmware version\n\n' +
      'No personal data, no IP address, no controller input.\n' +
      'The ID is an irreversible hash — it cannot be traced back to you.\n\n' +
      'You can change this at any time in Settings.',
    buttons:     ['Yes, help improve DS5Dongle', 'No thanks'],
    defaultId:   0,
    cancelId:    1,
    noLink:      true,
  });

  setConsent(response === 0);
}

app.whenReady().then(async () => {
  const win = createWindow();

  registerHandlers();
  startTelemetryTimer(win);
  setupHotplugEvents(win);

  // Show the one-time consent dialog after the window is ready
  await askTelemetryConsent(win);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
