import { useState, useEffect } from 'react';
import { useConfigStore } from '../../state/configStore';
import SelectRow from '../SelectRow';
import SliderRow from '../SliderRow';
import ToggleRow from '../ToggleRow';
import { AUTO_HAPTICS_LABELS } from '../../../shared/enums';
import { useLoopbackStatus } from '../../hooks/useLoopback';
import { ds5 } from '../../ipc/client';
import type { AudioDevice } from '../../../shared/ipc';

export default function AutoHapticsSection() {
  const { draft, updateField } = useConfigStore();
  const loopback = useLoopbackStatus();

  // Windows-only: loopback source selection state
  const isWindows = ds5.platform === 'win32';
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!isWindows) return;
    let cancelled = false;
    Promise.all([ds5.listAudioSources(), ds5.getAudioSource()]).then(([{ devices }, src]) => {
      if (cancelled) return;
      const filtered = devices.filter(
        (d) => d.outputChannels > 0 && !d.name.toLowerCase().includes('dualsense')
      );
      setOutputDevices(filtered);
      setSelectedSource(src);
    }).catch(() => { /* ignore — worker may not be running yet */ });
    return () => { cancelled = true; };
  }, [isWindows]);

  if (!draft) return <></>;

  const active = draft.autoHapticsEnable !== 0;

  // Build options and compute selected index for the source picker
  const sourceOptions: string[] = ['Default output (follow Windows)', ...outputDevices.map((d) => d.name)];
  const selectedIdx = selectedSource == null
    ? 0
    : Math.max(0, outputDevices.findIndex((d) => d.name === selectedSource) + 1);

  function handleSourceChange(i: number): void {
    const name = i === 0 ? null : outputDevices[i - 1].name;
    setSelectedSource(name);
    ds5.setAudioSource(name);
  }

  return (
    <div className="section-card">
      <p className="section-title">Auto Haptics</p>
      <SelectRow
        label="Mode"
        description="Convert audio output into controller vibrations"
        value={draft.autoHapticsEnable}
        options={AUTO_HAPTICS_LABELS}
        onChange={(v) => updateField('autoHapticsEnable', v as 0 | 1 | 2)}
      />
      <SliderRow
        label="Intensity"
        value={draft.autoHapticsGain}
        min={0} max={200} step={1}
        format={(v) => `${v}%`}
        disabled={!active}
        onChange={(v) => updateField('autoHapticsGain', v)}
      />
      <SliderRow
        label="Low-pass cutoff"
        value={draft.autoHapticsLowpassHz}
        min={20} max={400} step={1}
        format={(v) => `${v} Hz`}
        disabled={!active}
        onChange={(v) => updateField('autoHapticsLowpassHz', v)}
      />
      <ToggleRow
        label="Auto-mute speaker (Replace)"
        description="Mute speaker output when Replace mode is active"
        value={draft.autoHapticsMuteReplace}
        disabled={draft.autoHapticsEnable !== 2}
        onChange={(v) => updateField('autoHapticsMuteReplace', v)}
      />
      <ToggleRow
        label="Auto-mute speaker (Mix)"
        description="Mute speaker output when Mix mode is active"
        value={draft.autoHapticsMuteMix}
        disabled={draft.autoHapticsEnable !== 1}
        onChange={(v) => updateField('autoHapticsMuteMix', v)}
      />
      {isWindows && (
        <SelectRow
          label="Haptics audio source"
          description="Which playback device's audio is captured for haptics. Use this if Windows keeps switching your default to the DualSense."
          value={selectedIdx}
          options={sourceOptions}
          onChange={handleSourceChange}
        />
      )}
      {isWindows && <LoopbackBanner status={loopback} />}
    </div>
  );
}

function LoopbackBanner({ status }: { status: ReturnType<typeof useLoopbackStatus> }) {
  if (!status) return null;

  const dot = status.error
    ? 'loopback-dot loopback-dot--error'
    : status.running
      ? 'loopback-dot loopback-dot--ok'
      : 'loopback-dot loopback-dot--idle';

  const label = status.error
    ? `Error: ${status.error}`
    : status.running
      ? status.deviceName ?? 'Running'
      : 'Stopped';

  return (
    <div className="loopback-banner">
      <span className={dot} />
      <span className="loopback-label">Audio source: {label}</span>
    </div>
  );
}
