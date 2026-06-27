// Typed re-export of window.ds5 — keeps the renderer free of raw channel names.

import type { DS5Config } from '../../shared/config';
import type { DeviceStatus } from '../../shared/protocol';
import type { PresetSummary } from '../../shared/presets';
import type { AudioDevice, DeviceChangedPayload, DeviceTelemetryPayload, LoopbackStatusPayload } from '../../shared/ipc';

declare global {
  interface Window {
    ds5: {
      connect:    () => Promise<{ model: string; firmwareVersion?: string }>;
      disconnect: () => Promise<void>;
      getStatus:  () => Promise<DeviceStatus>;
      getBattery: () => Promise<{ percent: number | null }>;

      readConfig:  () => Promise<DS5Config>;
      writeConfig: (cfg: DS5Config, reconnect: boolean) => Promise<DS5Config>;
      saveConfig:  () => Promise<void>;

      presets: {
        list:   () => Promise<PresetSummary[]>;
        load:   (name: string) => Promise<DS5Config>;
        save:   (name: string, cfg: DS5Config) => Promise<void>;
        delete: (name: string) => Promise<void>;
      };

      getVersion:   () => Promise<string>;
      openUrl:      (url: string) => Promise<void>;

      // Telemetry consent — settings UI toggle
      getTelemetryConsent: () => Promise<boolean | null>;
      setTelemetryConsent: (value: boolean) => Promise<void>;

      // Return a cleanup function for useEffect
      onDeviceChanged:   (cb: (p: DeviceChangedPayload) => void) => () => void;
      onTelemetry:       (cb: (p: DeviceTelemetryPayload) => void) => () => void;
      onLoopbackStatus:  (cb: (p: LoopbackStatusPayload) => void) => () => void;

      // Loopback source selection (Windows-only)
      listAudioSources: () => Promise<{ devices: AudioDevice[]; defOutId: number }>;
      getAudioSource:   () => Promise<string | null>;
      setAudioSource:   (name: string | null) => Promise<void>;

      platform: string;
    };
  }
}

export const ds5 = window.ds5;
