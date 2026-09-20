export const BUTTON_NAMES = [
  'Square', 'Cross', 'Circle', 'Triangle',
  'L1', 'R1', 'Create', 'Options', 'Mute',
] as const;

export type ButtonIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const POLLING_RATE_LABELS = ['250 Hz', '500 Hz', '1000 Hz'] as const;

export const CONTROLLER_MODE_LABELS = ['DualSense', 'DualSense Edge', 'Auto'] as const;

// Full audio = raw ch3/ch4 passthrough (what a PC-side audio loopback needs).
// Bass mix   = ch3/ch4 (low-pass filtered) + bass synthesized from the pad's
//              own speaker audio (ch1/ch2), blended.
// Pad speaker = ignores ch3/ch4 entirely; vibrates only from bass synthesized
//              from the pad's own speaker audio -- silent unless something is
//              actually playing through the pad's speaker/headphone jack.
export const AUTO_HAPTICS_LABELS = ['Full audio', 'Bass mix', 'Pad speaker'] as const;
