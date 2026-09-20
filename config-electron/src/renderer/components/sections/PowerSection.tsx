import { useConfigStore } from '../../state/configStore';
import SliderRow from '../SliderRow';
import ToggleRow from '../ToggleRow';

export default function PowerSection() {
  const { draft, updateField } = useConfigStore();
  if (!draft) return <></>;

  return (
    <div className="section-card">
      <p className="section-title">Power</p>
      <SliderRow
        label="Auto power off"
        value={draft.inactiveTime}
        min={0} max={60} step={1}
        format={(v) => (v === 0 ? 'Disabled' : `${v} min`)}
        disabled={draft.inactiveTime === 0}
        onChange={(v) => updateField('inactiveTime', v)}
      />
      <ToggleRow
        label="Stay connected"
        description="Disable auto power-off when idle"
        value={draft.inactiveTime === 0}
        onChange={(v) => updateField('inactiveTime', v ? 0 : 30)}
      />
      <ToggleRow
        label="Disable Pico LED"
        description="Turn off the onboard LED on the Raspberry Pi Pico"
        value={draft.disablePicoLed}
        onChange={(v) => updateField('disablePicoLed', v)}
      />
    </div>
  );
}
