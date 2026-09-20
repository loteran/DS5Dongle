export interface DS5Config {
  hapticsGain: number;                // float [1.0–2.0]
  speakerVolume: number;              // uint8 [0–127] linear (was float dB pre-merge)
  headsetVolume: number;              // uint8 [0–127] linear
  speakerGain: number;                // uint8 [0–7] (0 = auto)
  inactiveTime: number;               // uint8 [0–60] minutes (0 = disable)
  disablePicoLed: boolean;            // uint8
  pollingRateMode: 0 | 1 | 2;        // uint8 — 250/500/1000 Hz
  audioBufferLength: number;          // uint8 [16–128]
  controllerMode: 0 | 1 | 2;         // uint8 — DS5/Edge/Auto
  autoHapticsEnable: 0 | 1 | 2;      // uint8 — Off/Mix/Replace
  autoHapticsGain: number;            // uint8 [0–200]
  autoHapticsLowpassHz: number;       // uint16 [20–400]
  enablePoweroffShortcut: boolean;    // uint8
  enableTouchpad: boolean;            // uint8
  poweroffButton: number;             // uint8 [0–8]
  touchpadButton: number;             // uint8 [0–8]
  batteryColorEnable: boolean;        // uint8
  wakeEnable: boolean;               // uint8 — legacy field, no longer read by firmware; kept for wire compat only
  autoHapticsMuteReplace: boolean;   // uint8 — auto-mute speaker in Replace mode
  autoHapticsMuteMix: boolean;       // uint8 — auto-mute speaker in Mix mode
  enableUsbSn: boolean;               // uint8
  psShortcutEnabled: boolean;         // uint8 — Xbox Game Bar shortcut via HID keyboard
  disableMic: boolean;                // uint8
  disableSpeaker: boolean;            // uint8
  enableWake: boolean;                // uint8 — power off controller on host sleep + wake host on reconnect
  triggerReduce: number;              // uint8 [0–10] (0 = auto)
}

export const DEFAULTS: DS5Config = {
  hapticsGain: 1.0,
  speakerVolume: 100,
  headsetVolume: 100,
  speakerGain: 0,
  inactiveTime: 30,
  disablePicoLed: false,
  pollingRateMode: 0,
  audioBufferLength: 32,
  controllerMode: 2,
  autoHapticsEnable: 0,
  autoHapticsGain: 100,
  autoHapticsLowpassHz: 80,
  enablePoweroffShortcut: true,
  enableTouchpad: true,
  poweroffButton: 3,  // Triangle
  touchpadButton: 2,  // Circle
  batteryColorEnable: true,
  wakeEnable: false,
  autoHapticsMuteReplace: false,
  autoHapticsMuteMix: false,
  enableUsbSn: false,
  psShortcutEnabled: false,
  disableMic: false,
  disableSpeaker: false,
  enableWake: false,
  triggerReduce: 0,
};

export interface FieldConstraint {
  min: number;
  max: number;
  step: number;
}

export const CONSTRAINTS: Partial<Record<keyof DS5Config, FieldConstraint>> = {
  hapticsGain:          { min: 1.0, max: 2.0,  step: 0.01 },
  speakerVolume:        { min: 0,   max: 127,  step: 1 },
  headsetVolume:        { min: 0,   max: 127,  step: 1 },
  speakerGain:          { min: 0,   max: 7,    step: 1 },
  inactiveTime:         { min: 0,   max: 60,   step: 1 },
  audioBufferLength:    { min: 16,  max: 128,   step: 1 },
  autoHapticsGain:      { min: 0,   max: 200,   step: 1 },
  autoHapticsLowpassHz: { min: 20,  max: 400,   step: 1 },
  poweroffButton:       { min: 0,   max: 8,     step: 1 },
  touchpadButton:       { min: 0,   max: 8,     step: 1 },
  triggerReduce:        { min: 0,   max: 10,    step: 1 },
};

// These fields require USB reconnect after write (firmware resets the USB stack)
export const RECONNECT_FIELDS: ReadonlySet<keyof DS5Config> = new Set([
  'pollingRateMode',
  'controllerMode',
]);
