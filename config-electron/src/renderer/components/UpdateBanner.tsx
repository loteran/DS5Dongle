import { useState } from 'react';
import { ds5 } from '../ipc/client';
import { useUpdateCheck, useFirmwareUpdateCheck } from '../hooks/useUpdateCheck';

interface BannerProps {
  label: string;
  latestVersion: string;
  releaseUrl: string;
  dismissKey: string;
}

function Banner({ label, latestVersion, releaseUrl, dismissKey }: BannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="update-banner" data-update={dismissKey}>
      <span>{label} — v{latestVersion}</span>
      <button className="btn-primary btn-update" onClick={() => ds5.openUrl(releaseUrl)}>
        Download
      </button>
      <button className="btn-secondary btn-dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

export default function UpdateBanner() {
  const { latestVersion, releaseUrl } = useUpdateCheck();
  if (!latestVersion || !releaseUrl) return null;

  return <Banner label="App update available" latestVersion={latestVersion} releaseUrl={releaseUrl} dismissKey="app" />;
}

/** Firmware banner is separate so it can be told the connected device's current firmware version. */
export function FirmwareUpdateBanner({ currentFirmwareVersion }: { currentFirmwareVersion?: string }) {
  const { latestVersion, releaseUrl } = useFirmwareUpdateCheck(currentFirmwareVersion);
  if (!latestVersion || !releaseUrl) return null;

  return <Banner label="Firmware update available" latestVersion={latestVersion} releaseUrl={releaseUrl} dismissKey="firmware" />;
}
