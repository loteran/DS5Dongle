#!/usr/bin/env python3
"""
DS5Dongle configuration tool.

Works with either Python HID binding:
  - cython-hidapi   (`pip install hidapi`,  module exposes `hid.device()`)
  - the `hid` package (`pip install hid`,   module exposes `hid.Device(...)`)
Most distros ship one or the other; both are supported transparently.
"""

import struct
import sys
import argparse

try:
    import hid
except ImportError:
    print("[ERROR] Missing dependency: install with  pip install hidapi  (or  pip install hid)")
    sys.exit(1)

SONY_VID = 0x054C
DS5_PID  = 0x0CE6  # DualSense
DSE_PID  = 0x0DF2  # DualSense Edge

# Config_body layout (30 bytes, little-endian), matching src/config.h and
# config-electron/src/shared/protocol.ts (FIELD_OFFSETS). The firmware's 0xF7
# get/set skips config_version, so byte 0 here is already `haptics_gain`.
#   float    haptics_gain               [0:4]    [1.0-2.0]
#   uint8    speaker_volume             [4]      [0-127] linear
#   uint8    headset_volume             [5]      [0-127] linear
#   uint8    speaker_gain               [6]      [0-7] (0=auto)
#   uint8    inactive_time              [7]      [0-60] min (0=disable, replaces old separate toggle)
#   uint8    disable_pico_led           [8]
#   uint8    polling_rate_mode          [9]
#   uint8    audio_buffer_length        [10]     [16-128]
#   uint8    controller_mode            [11]
#   uint8    auto_haptics_enable        [12]
#   uint8    auto_haptics_gain          [13]     [0-200]
#   uint16   auto_haptics_lowpass_hz    [14:16]  [20-400]
#   uint8    enable_poweroff_shortcut   [16]
#   uint8    enable_touchpad            [17]
#   uint8    poweroff_button            [18]
#   uint8    touchpad_button            [19]
#   uint8    battery_color_enable       [20]
#   uint8    wake_enable                [21]     legacy, wire compat only
#   uint8    auto_haptics_mute_replace  [22]
#   uint8    auto_haptics_mute_mix      [23]
#   uint8    enable_usb_sn              [24]
#   uint8    ps_shortcut_enabled        [25]
#   uint8    disable_mic                [26]
#   uint8    disable_speaker            [27]
#   uint8    enable_wake                [28]
#   uint8    trigger_reduce             [29]     [0-10] (0=auto)
CONFIG_FMT  = '<f' + 'B' * 10 + 'H' + 'B' * 14
CONFIG_SIZE = struct.calcsize(CONFIG_FMT)  # 30

FIELDS = [
    'haptics_gain', 'speaker_volume', 'headset_volume', 'speaker_gain',
    'inactive_time', 'disable_pico_led', 'polling_rate_mode',
    'audio_buffer_length', 'controller_mode', 'auto_haptics_enable',
    'auto_haptics_gain', 'auto_haptics_lowpass_hz', 'enable_poweroff_shortcut',
    'enable_touchpad', 'poweroff_button', 'touchpad_button',
    'battery_color_enable', 'wake_enable', 'auto_haptics_mute_replace',
    'auto_haptics_mute_mix', 'enable_usb_sn', 'ps_shortcut_enabled',
    'disable_mic', 'disable_speaker', 'enable_wake', 'trigger_reduce',
]

POLLING_MODES     = {0: "250 Hz", 1: "500 Hz", 2: "Real-time (1000 Hz)"}
CONTROLLER_MODES  = {0: "DS5", 1: "DSE (Edge)", 2: "Auto"}
AUTO_HAP_MODES    = {
    0: "Full audio (raw passthrough, ch3/ch4)",
    1: "Bass mix (ch3/ch4 + pad-speaker bass)",
    2: "Pad speaker (bass from the pad's own speaker audio only, ignores ch3/ch4)",
}


# ---------------------------------------------------------------------------
# Device helpers
# ---------------------------------------------------------------------------

def _open_hid(vid, pid):
    """Open the HID device with whichever python HID binding is installed.

    cython-hidapi exposes ``hid.device()`` + ``.open(vid, pid)``; the ``hid``
    package exposes ``hid.Device(vid, pid)``. Both raise on failure.
    """
    if hasattr(hid, "device"):          # cython-hidapi
        device = hid.device()
        device.open(vid, pid)
        return device
    if hasattr(hid, "Device"):          # 'hid' package (apmorton)
        return hid.Device(vid, pid)
    raise RuntimeError("Unsupported 'hid' module (expected hidapi or the hid package)")


def open_device():
    for pid, label in [(DS5_PID, "DualSense"), (DSE_PID, "DualSense Edge")]:
        try:
            device = _open_hid(SONY_VID, pid)
            print(f"[INFO] Connected to {label}")
            return device
        except Exception:
            pass
    print("[ERROR] No DS5/DSE device found. Make sure the Pico is plugged in.")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Config read / write
# ---------------------------------------------------------------------------

def get_config(device):
    raw = bytes(device.get_feature_report(0xF7, 64))
    body = raw[1:1 + CONFIG_SIZE]
    if len(body) < CONFIG_SIZE:
        print(f"[ERROR] Config too short ({len(body)} bytes, expected {CONFIG_SIZE}). "
              "Flash the latest firmware first.")
        sys.exit(1)
    values = struct.unpack(CONFIG_FMT, body)
    return dict(zip(FIELDS, values))


def print_config(cfg):
    print("\n=== DS5Dongle Configuration ===")
    print(f"  haptics_gain                : {cfg['haptics_gain']:.2f}  [1.0 – 2.0]")
    print(f"  speaker_volume              : {cfg['speaker_volume']}  [0 – 127]")
    print(f"  headset_volume              : {cfg['headset_volume']}  [0 – 127]")
    print(f"  speaker_gain                : {cfg['speaker_gain']}  [0 – 7] (0=auto)")
    it = cfg['inactive_time']
    print(f"  inactive_time               : {'disabled' if it == 0 else f'{it} min'}  [0 – 60] (0=disable)")
    print(f"  disable_pico_led            : {cfg['disable_pico_led']}  (0=LED on, 1=LED off)")
    pm = cfg['polling_rate_mode']
    print(f"  polling_rate_mode           : {pm}  ({POLLING_MODES.get(pm, '?')})")
    print(f"  audio_buffer_length         : {cfg['audio_buffer_length']}  [16 – 128]")
    cm = cfg['controller_mode']
    print(f"  controller_mode             : {cm}  ({CONTROLLER_MODES.get(cm, '?')})")
    print(f"  trigger_reduce              : {cfg['trigger_reduce']}  [0 – 10] (0=auto)")
    print()
    print("--- Auto Haptics (audio → rumble) ---")
    ae = cfg['auto_haptics_enable']
    print(f"  auto_haptics_enable         : {ae}  ({AUTO_HAP_MODES.get(ae, '?')})")
    print(f"  auto_haptics_gain           : {cfg['auto_haptics_gain']}%  [0 – 200]")
    print(f"  auto_haptics_lowpass_hz     : {cfg['auto_haptics_lowpass_hz']} Hz  [20 – 400]")
    print(f"  auto_haptics_mute_replace   : {cfg['auto_haptics_mute_replace']}  (mute speaker in Pad speaker mode)")
    print(f"  auto_haptics_mute_mix       : {cfg['auto_haptics_mute_mix']}  (mute speaker in Bass mix mode)")
    print()
    print("--- Input ---")
    print(f"  enable_poweroff_shortcut    : {cfg['enable_poweroff_shortcut']}  (1=PS+<button> powers off)")
    print(f"  poweroff_button             : {cfg['poweroff_button']}  (ShortcutButton id, default 3=Triangle)")
    print(f"  enable_touchpad             : {cfg['enable_touchpad']}  (1=on, 0=off; PS+<button> toggles runtime)")
    print(f"  touchpad_button             : {cfg['touchpad_button']}  (ShortcutButton id, default 2=Circle)")
    print()
    print("--- Misc ---")
    print(f"  battery_color_enable        : {cfg['battery_color_enable']}  (lightbar reflects battery level)")
    print(f"  enable_wake                 : {cfg['enable_wake']}  (wake-on-PS — see README before enabling)")
    print(f"  enable_usb_sn               : {cfg['enable_usb_sn']}  (advertise a USB serial number)")
    print(f"  ps_shortcut_enabled         : {cfg['ps_shortcut_enabled']}  (PS -> Xbox Game Bar shortcut)")
    print(f"  disable_mic                 : {cfg['disable_mic']}")
    print(f"  disable_speaker             : {cfg['disable_speaker']}")
    print("================================\n")


def set_config(device, **kwargs):
    cfg = get_config(device)

    for key, value in kwargs.items():
        if key not in cfg:
            print(f"[WARNING] Unknown parameter ignored: {key}")
            continue
        cfg[key] = value
        print(f"[INFO] {key} = {value}")

    packed = struct.pack(CONFIG_FMT, *(cfg[f] for f in FIELDS))

    print("[INFO] Writing config to memory...")
    device.send_feature_report(bytes([0xF6, 0x01]) + packed)

    print("[INFO] Saving to flash...")
    device.send_feature_report(bytes([0xF6, 0x02]))

    print("[INFO] Reconnecting USB...")
    device.send_feature_report(bytes([0xF6, 0x03]))

    print("[OK] Configuration saved.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(
        description="Configure DS5Dongle firmware settings.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Show current config
  python set_ds5.py

  # Pad speaker mode (bass derived from the pad's own speaker audio only)
  python set_ds5.py --auto-haptics-enable 2 --auto-haptics-gain 120 --auto-haptics-lowpass 160

  # Bass mix mode: native/loopback ch3/ch4 + pad-speaker-derived bass
  python set_ds5.py --auto-haptics-enable 1

  # Full audio: raw ch3/ch4 passthrough (use this for a PC-side audio loopback, see README)
  python set_ds5.py --auto-haptics-enable 0

  # Adjust haptics intensity and speaker volume
  python set_ds5.py --haptics-gain 1.8 --speaker-volume 80

  # Switch to 500 Hz polling
  python set_ds5.py --polling-rate 1

  # Always stay connected (disable auto power-off)
  python set_ds5.py --inactive-time 0

Auto haptics modes:
  0 = Full audio   — raw ch3/ch4 passthrough, no synthesis. Use this if a PC-side
                      audio loopback feeds ch3/ch4 (see README) -- 1 and 2 both
                      derive their signal from the pad's OWN speaker audio
                      (ch1/ch2), which a loopback never touches.
  1 = Bass mix      — ch3/ch4 (low-pass filtered) + bass/envelope synthesized
                      from the pad's own speaker audio (ch1/ch2), blended.
  2 = Pad speaker   — ignores ch3/ch4 entirely; vibrates only from bass/envelope
                      synthesized from the pad's own speaker audio (ch1/ch2).
                      Silent unless something is actually playing through the
                      pad's speaker/headphone-jack output.

Auto haptics lowpass cutoff (free Hz value, 20-400) -- affects modes 1 and 2:
  20  Hz             — sub-bass only (very heavy, low-frequency rumble)
  80  Hz             — deep bass (default, good all-round feel)
  160 Hz             — balanced bass (more detail, good for most games)
  400 Hz             — wide bass (maximum detail)
""")

    p.add_argument('--haptics-gain', type=float,
                   metavar='GAIN', help='Haptics gain [1.0-2.0]')
    p.add_argument('--speaker-volume', type=int,
                   metavar='N', help='Pad speaker volume [0-127]')
    p.add_argument('--headset-volume', type=int,
                   metavar='N', help='Pad headset-jack volume [0-127]')
    p.add_argument('--speaker-gain', type=int, choices=range(0, 8),
                   metavar='0-7', help='Speaker hardware gain stage (0=auto)')
    p.add_argument('--inactive-time', type=int,
                   metavar='MIN', help='Auto-disconnect delay in minutes [0-60] (0=disable, always stay on)')
    p.add_argument('--disable-pico-led', type=int, choices=[0, 1],
                   metavar='0|1', help='0=LED on, 1=LED off')
    p.add_argument('--polling-rate', type=int, choices=[0, 1, 2],
                   metavar='0|1|2', help='Polling rate: 0=250Hz, 1=500Hz, 2=1000Hz')
    p.add_argument('--audio-buffer-length', type=int,
                   metavar='N', help='Haptics audio buffer length [16-128]')
    p.add_argument('--controller-mode', type=int, choices=[0, 1, 2],
                   metavar='0|1|2', help='Controller mode: 0=DS5, 1=DSE, 2=Auto')
    p.add_argument('--trigger-reduce', type=int, choices=range(0, 11),
                   metavar='0-10', help='Adaptive trigger power reduction (0=auto)')

    g = p.add_argument_group('Auto haptics (audio -> rumble)')
    g.add_argument('--auto-haptics-enable', type=int, choices=[0, 1, 2],
                   metavar='0|1|2',
                   help='0=Full audio, 1=Bass mix, 2=Pad speaker (default: 2) -- see epilog')
    g.add_argument('--auto-haptics-gain', type=int,
                   metavar='PCT',
                   help='Auto haptics intensity 0-200%% of haptics_gain (default: 100)')
    g.add_argument('--auto-haptics-lowpass', type=int,
                   metavar='HZ',
                   help='LP cutoff in Hz [20-400], default 80')
    g.add_argument('--auto-haptics-mute-replace', type=int, choices=[0, 1],
                   metavar='0|1', help='Mute the pad speaker while in Pad speaker mode')
    g.add_argument('--auto-haptics-mute-mix', type=int, choices=[0, 1],
                   metavar='0|1', help='Mute the pad speaker while in Bass mix mode')

    h = p.add_argument_group('Input')
    h.add_argument('--enable-poweroff-shortcut', type=int, choices=[0, 1],
                   metavar='0|1', help='1=PS+<button> powers off controller (default: 1)')
    h.add_argument('--poweroff-button', type=int,
                   metavar='ID', help='ShortcutButton id for the power-off combo (default: 3=Triangle)')
    h.add_argument('--enable-touchpad', type=int, choices=[0, 1],
                   metavar='0|1', help='1=touchpad active, 0=disabled (PS+<button> toggles runtime)')
    h.add_argument('--touchpad-button', type=int,
                   metavar='ID', help='ShortcutButton id for the touchpad toggle (default: 2=Circle)')

    m = p.add_argument_group('Misc')
    m.add_argument('--battery-color-enable', type=int, choices=[0, 1],
                   metavar='0|1', help='1=lightbar color reflects battery level')
    m.add_argument('--enable-wake', type=int, choices=[0, 1],
                   metavar='0|1', help='Wake-on-PS -- see README warning before enabling')
    m.add_argument('--enable-usb-sn', type=int, choices=[0, 1],
                   metavar='0|1', help='1=advertise a USB serial number')
    m.add_argument('--ps-shortcut-enabled', type=int, choices=[0, 1],
                   metavar='0|1', help='1=PS button triggers Xbox Game Bar shortcut')
    m.add_argument('--disable-mic', type=int, choices=[0, 1],
                   metavar='0|1', help='1=disable the controller mic')
    m.add_argument('--disable-speaker', type=int, choices=[0, 1],
                   metavar='0|1', help='1=disable the pad speaker/headset output')
    return p


def validate(args):
    errs = []
    if args.haptics_gain is not None and not (1.0 <= args.haptics_gain <= 2.0):
        errs.append("--haptics-gain must be between 1.0 and 2.0")
    if args.speaker_volume is not None and not (0 <= args.speaker_volume <= 127):
        errs.append("--speaker-volume must be between 0 and 127")
    if args.headset_volume is not None and not (0 <= args.headset_volume <= 127):
        errs.append("--headset-volume must be between 0 and 127")
    if args.inactive_time is not None and not (0 <= args.inactive_time <= 60):
        errs.append("--inactive-time must be between 0 and 60")
    if args.audio_buffer_length is not None and not (16 <= args.audio_buffer_length <= 128):
        errs.append("--audio-buffer-length must be between 16 and 128")
    if args.auto_haptics_gain is not None and not (0 <= args.auto_haptics_gain <= 200):
        errs.append("--auto-haptics-gain must be between 0 and 200")
    if args.auto_haptics_lowpass is not None and not (20 <= args.auto_haptics_lowpass <= 400):
        errs.append("--auto-haptics-lowpass must be between 20 and 400")
    if errs:
        for e in errs:
            print(f"[ERROR] {e}")
        sys.exit(1)


def main():
    parser = build_parser()
    args = parser.parse_args()
    validate(args)

    # Build the dict of changes requested
    changes = {}
    mapping = {
        'haptics_gain':                args.haptics_gain,
        'speaker_volume':              args.speaker_volume,
        'headset_volume':              args.headset_volume,
        'speaker_gain':                args.speaker_gain,
        'inactive_time':               args.inactive_time,
        'disable_pico_led':            args.disable_pico_led,
        'polling_rate_mode':           args.polling_rate,
        'audio_buffer_length':         args.audio_buffer_length,
        'controller_mode':             args.controller_mode,
        'trigger_reduce':              args.trigger_reduce,
        'auto_haptics_enable':         args.auto_haptics_enable,
        'auto_haptics_gain':           args.auto_haptics_gain,
        'auto_haptics_lowpass_hz':     args.auto_haptics_lowpass,
        'auto_haptics_mute_replace':   args.auto_haptics_mute_replace,
        'auto_haptics_mute_mix':       args.auto_haptics_mute_mix,
        'enable_poweroff_shortcut':    args.enable_poweroff_shortcut,
        'poweroff_button':             args.poweroff_button,
        'enable_touchpad':             args.enable_touchpad,
        'touchpad_button':             args.touchpad_button,
        'battery_color_enable':        args.battery_color_enable,
        'enable_wake':                 args.enable_wake,
        'enable_usb_sn':               args.enable_usb_sn,
        'ps_shortcut_enabled':         args.ps_shortcut_enabled,
        'disable_mic':                 args.disable_mic,
        'disable_speaker':             args.disable_speaker,
    }
    for key, val in mapping.items():
        if val is not None:
            changes[key] = val

    device = open_device()
    try:
        if changes:
            set_config(device, **changes)
            # Device reconnects after save — reopen to read back config
            device.close()
            import time; time.sleep(2)
            device = open_device()
        cfg = get_config(device)
        print_config(cfg)
    finally:
        device.close()


if __name__ == '__main__':
    main()
