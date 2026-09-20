import { useState, useEffect } from 'react';
import { ds5 } from '../ipc/client';

const RELEASES_URL = 'https://api.github.com/repos/loteran/DS5Dongle/releases';

interface GhRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

interface UpdateInfo {
  version: string;
  url: string;
}

let releasesCache: Promise<GhRelease[]> | null = null;

// Both banners hit the same releases list; share one fetch instead of firing
// two requests on every launch.
function fetchReleases(): Promise<GhRelease[]> {
  if (!releasesCache) {
    releasesCache = fetch(RELEASES_URL, { signal: AbortSignal.timeout(10_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        return res.json() as Promise<GhRelease[]>;
      })
      .catch((err) => {
        releasesCache = null; // allow retry on next mount
        throw err;
      });
  }
  return releasesCache;
}

/** App update check: releases tagged `app-vX.Y.Z`, compared against the running app's own version. */
export function useUpdateCheck(): { latestVersion: string | null; releaseUrl: string | null } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      const current = await ds5.getVersion();
      const releases = await fetchReleases();
      if (cancelled) return;

      const appRelease = releases.find(
        r => !r.draft && !r.prerelease && r.tag_name.startsWith('app-v'),
      );
      if (!appRelease) return;

      const latest = appRelease.tag_name.replace(/^app-v/, '');
      if (isNewer(latest, current)) {
        setUpdate({ version: latest, url: appRelease.html_url });
      }
    }

    check().catch(() => { /* network unavailable — silently skip */ });
    return () => { cancelled = true; };
  }, []);

  return update
    ? { latestVersion: update.version, releaseUrl: update.url }
    : { latestVersion: null, releaseUrl: null };
}

/**
 * Firmware update check: releases tagged plain `vX.Y.Z` (no `app-` prefix —
 * that's the firmware release track, see .github/workflows/release.yml),
 * compared against the connected device's own reported firmware version
 * (0xF8 report — the exact tag it was built from, see CMakeLists.txt VERSION).
 * `currentVersion` is undefined while no device is connected; the check is
 * skipped in that case.
 */
export function useFirmwareUpdateCheck(currentVersion?: string): { latestVersion: string | null; releaseUrl: string | null } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!currentVersion) {
      setUpdate(null);
      return;
    }
    let cancelled = false;

    async function check(): Promise<void> {
      const releases = await fetchReleases();
      if (cancelled) return;

      const fwRelease = releases.find(
        r => !r.draft && !r.prerelease && !r.tag_name.startsWith('app-v') && /^v\d+\.\d+\.\d+/.test(r.tag_name),
      );
      if (!fwRelease) return;

      const latest = fwRelease.tag_name.replace(/^v/, '');
      const current = currentVersion!.replace(/^v/, '');
      if (isNewer(latest, current)) {
        setUpdate({ version: latest, url: fwRelease.html_url });
      }
    }

    check().catch(() => { /* network unavailable, or device firmware string not a plain semver (dev build) — silently skip */ });
    return () => { cancelled = true; };
  }, [currentVersion]);

  return update
    ? { latestVersion: update.version, releaseUrl: update.url }
    : { latestVersion: null, releaseUrl: null };
}

function isNewer(a: string, b: string): boolean {
  // Pad to exactly 3 numeric segments so a short/malformed version (e.g. the
  // firmware reporting "dev" for a local, untagged build) never leaves a
  // segment `undefined` -- `7 > undefined` is false in JS, which silently
  // broke the comparison instead of treating the missing segment as 0.
  const parse = (v: string): [number, number, number] => {
    const parts = v.split(/[.-]/).map(n => parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [am, an, ap] = parse(a);
  const [bm, bn, bp] = parse(b);
  return am > bm || (am === bm && an > bn) || (am === bm && an === bn && ap > bp);
}
