// Sony USB VID and DS5Dongle firmware PIDs
export const SONY_VID  = 0x054C;
export const DS5_PID   = 0x0CE6; // DualSense
export const EDGE_PID  = 0x0DF2; // DualSense Edge

// HID feature report IDs (from src/cmd.cpp)
export const REPORT_READ_CONFIG      = 0xF7;
export const REPORT_CMD              = 0xF6;
export const REPORT_FIRMWARE_VERSION = 0xF8;
export const REPORT_RSSI             = 0xF9;

// Sub-commands for REPORT_CMD (0xF6)
export const CMD_WRITE_CONFIG  = 0x01;
export const CMD_SAVE_CONFIG   = 0x02;
export const CMD_RECONNECT_USB = 0x03;

// Total size of the packed config struct on the wire.
// Firmware (src/cmd.cpp pico_cmd_get/set for 0xF7) skips config_version and
// sends/receives Config_body starting at haptics_gain — i.e. sizeof(Config_body) - 1.
// Layout below must stay in sync with the Config_body struct in src/config.h
// (v0.7.2-hotfix upstream merge — speaker_volume is now a linear uint8,
// headset_volume/speaker_gain were inserted, and several fields were appended
// at the tail).
export const CONFIG_SIZE = 30;

// Byte offsets within the CONFIG_SIZE-byte config buffer.
// node-hid getFeatureReport includes the report id at [0], so caller
// must slice raw[1..1+CONFIG_SIZE] before passing here.
export const FIELD_OFFSETS = {
  hapticsGain:                 0,  // float32LE [0..3]
  speakerVolume:                4,  // uint8 [0..127] linear (was float dB pre-merge)
  headsetVolume:                5,  // uint8 [0..127] linear
  speakerGain:                  6,  // uint8 [0..7] (0 = auto)
  inactiveTime:                 7,  // uint8 [0..60] minutes (0 = disable, folds old disableInactiveDisconnect)
  disablePicoLed:               8,  // uint8 (bool)
  pollingRateMode:              9,  // uint8
  audioBufferLength:            10, // uint8
  controllerMode:               11, // uint8
  autoHapticsEnable:            12, // uint8
  autoHapticsGain:              13, // uint8
  autoHapticsLowpassHz:         14, // uint16LE [14..15]
  enablePoweroffShortcut:       16, // uint8 (bool)
  enableTouchpad:               17, // uint8 (bool)
  poweroffButton:               18, // uint8
  touchpadButton:               19, // uint8
  batteryColorEnable:           20, // uint8 (bool)
  wakeEnable:                   21, // uint8 (bool) — legacy field, superseded by enableWake, kept for wire compat only
  autoHapticsMuteReplace:       22, // uint8 (bool)
  autoHapticsMuteMix:           23, // uint8 (bool)
  enableUsbSn:                  24, // uint8 (bool)
  psShortcutEnabled:            25, // uint8 (bool) — Xbox Game Bar shortcut via HID keyboard
  disableMic:                   26, // uint8 (bool)
  disableSpeaker:               27, // uint8 (bool)
  enableWake:                   28, // uint8 (bool) — active wake toggle (upstream)
  triggerReduce:                29, // uint8 [0..10] (0 = auto)
} as const;

export type ControllerModel = 'DualSense' | 'DualSense Edge';

export interface DeviceStatus {
  connected: boolean;
  model?: ControllerModel;
  firmwareVersion?: string; // from 0xF8 report
  rssi?: number;            // dBm, from 0xF9 report
}
