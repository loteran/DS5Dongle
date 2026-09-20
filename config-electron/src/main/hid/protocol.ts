// Pack/unpack between DS5Config and the CONFIG_SIZE-byte HID buffer.
// Layout must stay in sync with src/config.h's Config_body (see shared/protocol.ts).

import type { DS5Config } from '../../shared/config';
import { DEFAULTS } from '../../shared/config';
import { CONFIG_SIZE, FIELD_OFFSETS } from '../../shared/protocol';

export function unpackConfig(raw: Buffer): DS5Config {
  // raw must be exactly CONFIG_SIZE bytes (report id already stripped by caller)
  if (raw.length < CONFIG_SIZE) {
    raw = Buffer.concat([raw, Buffer.alloc(CONFIG_SIZE - raw.length)]);
  }

  const o = FIELD_OFFSETS;
  const cfg: DS5Config = {
    hapticsGain:               Math.min(2.0, Math.max(1.0, raw.readFloatLE(o.hapticsGain))),
    speakerVolume:             raw.readUInt8(o.speakerVolume),
    headsetVolume:             raw.readUInt8(o.headsetVolume),
    speakerGain:               raw.readUInt8(o.speakerGain),
    inactiveTime:              raw.readUInt8(o.inactiveTime),
    disablePicoLed:            raw.readUInt8(o.disablePicoLed) !== 0,
    pollingRateMode:           raw.readUInt8(o.pollingRateMode) as 0 | 1 | 2,
    audioBufferLength:         raw.readUInt8(o.audioBufferLength),
    controllerMode:            raw.readUInt8(o.controllerMode) as 0 | 1 | 2,
    autoHapticsEnable:         raw.readUInt8(o.autoHapticsEnable) as 0 | 1 | 2,
    autoHapticsGain:           raw.readUInt8(o.autoHapticsGain),
    autoHapticsLowpassHz:      raw.readUInt16LE(o.autoHapticsLowpassHz),
    enablePoweroffShortcut:    raw.readUInt8(o.enablePoweroffShortcut) !== 0,
    enableTouchpad:            raw.readUInt8(o.enableTouchpad) !== 0,
    poweroffButton:            raw.readUInt8(o.poweroffButton),
    touchpadButton:            raw.readUInt8(o.touchpadButton),
    batteryColorEnable:        raw.readUInt8(o.batteryColorEnable) !== 0,
    wakeEnable:                raw.readUInt8(o.wakeEnable) !== 0,
    autoHapticsMuteReplace:    raw.readUInt8(o.autoHapticsMuteReplace) !== 0,
    autoHapticsMuteMix:        raw.readUInt8(o.autoHapticsMuteMix) !== 0,
    enableUsbSn:               raw.readUInt8(o.enableUsbSn) !== 0,
    psShortcutEnabled:         raw.readUInt8(o.psShortcutEnabled) !== 0,
    disableMic:                raw.readUInt8(o.disableMic) !== 0,
    disableSpeaker:            raw.readUInt8(o.disableSpeaker) !== 0,
    enableWake:                raw.readUInt8(o.enableWake) !== 0,
    triggerReduce:             raw.readUInt8(o.triggerReduce),
  };

  return cfg;
}

export function packConfig(cfg: DS5Config): Buffer {
  const buf = Buffer.alloc(CONFIG_SIZE);
  const o = FIELD_OFFSETS;

  buf.writeFloatLE(cfg.hapticsGain,           o.hapticsGain);
  buf.writeUInt8(cfg.speakerVolume,            o.speakerVolume);
  buf.writeUInt8(cfg.headsetVolume,            o.headsetVolume);
  buf.writeUInt8(cfg.speakerGain,              o.speakerGain);
  buf.writeUInt8(cfg.inactiveTime,             o.inactiveTime);
  buf.writeUInt8(cfg.disablePicoLed ? 1 : 0,  o.disablePicoLed);
  buf.writeUInt8(cfg.pollingRateMode,          o.pollingRateMode);
  buf.writeUInt8(cfg.audioBufferLength,        o.audioBufferLength);
  buf.writeUInt8(cfg.controllerMode,           o.controllerMode);
  buf.writeUInt8(cfg.autoHapticsEnable,        o.autoHapticsEnable);
  buf.writeUInt8(cfg.autoHapticsGain,          o.autoHapticsGain);
  buf.writeUInt16LE(cfg.autoHapticsLowpassHz,  o.autoHapticsLowpassHz);
  buf.writeUInt8(cfg.enablePoweroffShortcut ? 1 : 0, o.enablePoweroffShortcut);
  buf.writeUInt8(cfg.enableTouchpad ? 1 : 0,  o.enableTouchpad);
  buf.writeUInt8(cfg.poweroffButton,           o.poweroffButton);
  buf.writeUInt8(cfg.touchpadButton,           o.touchpadButton);
  buf.writeUInt8(cfg.batteryColorEnable ? 1 : 0,      o.batteryColorEnable);
  buf.writeUInt8(cfg.wakeEnable ? 1 : 0,              o.wakeEnable);
  buf.writeUInt8(cfg.autoHapticsMuteReplace ? 1 : 0,  o.autoHapticsMuteReplace);
  buf.writeUInt8(cfg.autoHapticsMuteMix ? 1 : 0,      o.autoHapticsMuteMix);
  buf.writeUInt8(cfg.enableUsbSn ? 1 : 0,             o.enableUsbSn);
  buf.writeUInt8(cfg.psShortcutEnabled ? 1 : 0,       o.psShortcutEnabled);
  buf.writeUInt8(cfg.disableMic ? 1 : 0,              o.disableMic);
  buf.writeUInt8(cfg.disableSpeaker ? 1 : 0,          o.disableSpeaker);
  buf.writeUInt8(cfg.enableWake ? 1 : 0,              o.enableWake);
  buf.writeUInt8(cfg.triggerReduce,                    o.triggerReduce);

  return buf;
}

export { DEFAULTS };
