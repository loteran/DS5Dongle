import { useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import HapticsSection from './components/sections/HapticsSection';
import AutoHapticsSection from './components/sections/AutoHapticsSection';
import AudioSection from './components/sections/AudioSection';
import ControllerSection from './components/sections/ControllerSection';
import PowerSection from './components/sections/PowerSection';
import ShortcutsSection from './components/sections/ShortcutsSection';
import LightbarSection from './components/sections/LightbarSection';
import SettingsSection from './components/sections/SettingsSection';
import PresetBar from './components/PresetBar';
import UpdateBanner, { FirmwareUpdateBanner } from './components/UpdateBanner';
import { useDevice } from './hooks/useDevice';
import { useConfigStore } from './state/configStore';
import { ds5 } from './ipc/client';

export default function App() {
  const device = useDevice();
  const { draft, setConfig, clearConfig } = useConfigStore();

  useEffect(() => {
    if (!device.connected) {
      clearConfig();
      return;
    }
    ds5.readConfig()
      .then(setConfig)
      .catch((err: unknown) => console.error('[App] readConfig failed:', err));
  }, [device.connected]);

  function handleRead(): void {
    ds5.readConfig().then(setConfig).catch(console.error);
  }

  return (
    <div className="app">
      <Header
        {...device}
        onConnect={device.connect}
        onDisconnect={device.disconnect}
      />

      <UpdateBanner />
      <FirmwareUpdateBanner currentFirmwareVersion={device.firmwareVersion} />

      <PresetBar connected={device.connected} />

      <main className="main-scroll">
        {!device.connected && <Splash error={device.error} />}

        {device.connected && !draft && (
          <div className="splash">
            <p className="splash-sub">Loading configuration…</p>
          </div>
        )}

        {device.connected && draft && (
          <div className="sections">
            <HapticsSection />
            <AutoHapticsSection />
            <AudioSection />
            <ControllerSection />
            <PowerSection />
            <ShortcutsSection />
            <LightbarSection />
            <SettingsSection />
          </div>
        )}
      </main>

      <Footer connected={device.connected} onRead={handleRead} />
    </div>
  );
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="splash">
      <div className="splash-icon">🎮</div>
      <p className="splash-title">DS5 Audio Haptics BT</p>
      <p className="splash-sub">Connect your DS5Dongle via USB to begin</p>
      {error && <p className="splash-error">{error}</p>}
    </div>
  );
}
