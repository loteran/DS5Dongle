// Persistent app settings — JSON file in userData, no external dependency.

import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppSettings {
  windowBounds?: WindowBounds;
  // Telemetry consent: true = opted in, false = declined, undefined/null = never asked
  telemetryConsent?: boolean | null;
  // ISO date (YYYY-MM-DD) of the last successful telemetry send — rate-limit to once per day
  telemetryLastSent?: string;
  // Fallback installation ID (random UUID) when machine-id is unavailable
  telemetryInstallId?: string;
  // Explicit WASAPI loopback capture source by device name; null/undefined => follow Windows default output (Windows-only)
  loopbackSourceName?: string | null;
}

// Called lazily so app.getPath() is only invoked after app.ready
function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as AppSettings;
  } catch {
    return {};
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch { /* ignore write errors — non-critical */ }
}
