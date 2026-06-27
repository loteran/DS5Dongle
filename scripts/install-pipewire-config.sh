#!/usr/bin/env bash
#
# install-pipewire-config.sh — DS5Dongle Linux auto-haptics integration.
#
# Installs, system-wide (so it covers every user account on the machine):
#   /etc/wireplumber/wireplumber.conf.d/51-ds5dongle.conf   WirePlumber rules
#   /etc/udev/rules.d/70-ds5dongle.rules                    udev (start/stop loopback)
#   /usr/lib/ds5dongle/ds5dongle-loopback-stop              loopback stop helper
#   /etc/systemd/user/ds5-haptics-loopback.service          per-user loopback service
#
# The audio→haptics loopback is started by udev whenever the Pico is plugged in
# and stopped when it is removed, so nothing runs while the dongle is absent.
#
# System files need root; the WirePlumber/profile steps run in your own session.
# Run it as your normal user (it calls sudo only for the system files):
#
#     ./scripts/install-pipewire-config.sh
#
# Override the privilege helper if you don't use sudo:  SUDO=pkexec ./scripts/install-pipewire-config.sh
#
set -euo pipefail

SUDO="${SUDO:-sudo}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../config-app"

die()  { printf '\033[31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$*"; }
info() { printf '\033[36m[*]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ok]\033[0m %s\n' "$*"; }

# ── Sanity checks ─────────────────────────────────────────────────────────────
[ "$(id -u)" -ne 0 ] || die "Run this as your normal user, not root — the WirePlumber/profile steps need your session. It calls sudo itself."

for f in 51-ds5dongle.conf 70-ds5dongle.rules ds5dongle-loopback-stop ds5-haptics-loopback.service; do
    [ -f "$SRC/$f" ] || die "Missing $SRC/$f — run this from a checked-out DS5Dongle tree."
done

command -v pw-loopback  >/dev/null || die "pw-loopback not found — install PipeWire (pipewire / pipewire-audio) first."
command -v wireplumber  >/dev/null || die "WirePlumber not found — install it first."
command -v pactl        >/dev/null || die "pactl not found — install pipewire-pulse (pipewire-audio) first."
command -v "$SUDO"      >/dev/null || die "'$SUDO' not found — set SUDO=… to your privilege helper."

# ── Install system files ──────────────────────────────────────────────────────
info "Installing system files (you may be prompted for your password)…"
$SUDO install -Dm644 "$SRC/51-ds5dongle.conf"            /etc/wireplumber/wireplumber.conf.d/51-ds5dongle.conf
$SUDO install -Dm644 "$SRC/70-ds5dongle.rules"           /etc/udev/rules.d/70-ds5dongle.rules
$SUDO install -Dm755 "$SRC/ds5dongle-loopback-stop"      /usr/lib/ds5dongle/ds5dongle-loopback-stop
$SUDO install -Dm644 "$SRC/ds5-haptics-loopback.service" /etc/systemd/user/ds5-haptics-loopback.service
ok "System files installed."

# ── Reload systemd + WirePlumber FIRST so the rename rules are active ─────────
# WirePlumber must be running with the new 51-ds5dongle.conf before udev
# re-triggers the device events. If we fire udev first, ds5_dongle_sink won't
# exist when the loopback service's ExecStartPre runs, causing a timeout.
info "Reloading systemd user units + WirePlumber…"
systemctl --user daemon-reload
# Enable at boot so the cold-plug case is covered (dongle already connected at
# boot → udev's ADD event never fires). The service's ExecStartPre guard makes
# this safe: it refuses to start when ds5_dongle_sink is absent, so an unplugged
# dongle can't cause a speaker feedback loop.
systemctl --user enable ds5-haptics-loopback.service 2>/dev/null || true
systemctl --user restart wireplumber

# Give WirePlumber a moment to settle before firing udev events.
sleep 1

# ── Reload udev rules + re-trigger Sony USB devices ───────────────────────────
info "Reloading udev rules…"
$SUDO udevadm control --reload-rules
$SUDO udevadm trigger --subsystem-match=usb --attr-match=idVendor=054c >/dev/null 2>&1 || true

# ── Pin pro-audio profile + start loopback if the dongle is already plugged ───
CARD="$(pactl list cards short 2>/dev/null | awk '/DualSense/{print $2; exit}')"
if [ -n "${CARD:-}" ]; then
    info "Dongle detected — selecting the pro-audio profile…"
    pactl set-card-profile "$CARD" pro-audio || warn "Could not set pro-audio (will retry on next plug)."

    # Use restart so a previously stuck service is properly cleared.
    systemctl --user restart ds5-haptics-loopback.service 2>/dev/null || true

    # Verify that the WirePlumber rename rule matched — ds5_dongle_sink must
    # exist for the loopback to work. Give WirePlumber up to 3 s to apply it.
    info "Verifying WirePlumber rename rule…"
    SINK_FOUND=0
    for _ in 1 2 3 4 5 6; do
        if pw-dump 2>/dev/null | grep -q '"ds5_dongle_sink"'; then
            SINK_FOUND=1; break
        fi
        sleep 0.5
    done

    if [ "$SINK_FOUND" -eq 1 ]; then
        ok "ds5_dongle_sink found — WirePlumber rule applied correctly."
        ok "Dongle configured."
    else
        warn "ds5_dongle_sink not found after WirePlumber restart."
        warn "The loopback service may not start. Run this to diagnose:"
        warn "  pw-dump | python3 -c \""
        warn "  import json,sys"
        warn "  for n in json.load(sys.stdin):"
        warn "    p=n.get('info',{}).get('props',{})"
        warn "    if '054c' in str(p) or 'DualSense' in str(p):"
        warn "      print(p.get('node.name'), '|', p.get('alsa.components'), '|', p.get('media.class'))\""
        warn "Then open a GitHub issue with that output."
    fi
else
    info "Dongle not plugged in — it will be configured automatically when you plug it in."
fi

cat <<'EOF'

────────────────────────────────────────────────────────────
 DS5Dongle auto-haptics integration installed (system-wide).

 • Plug the Pico in: the loopback starts automatically and the
   controller vibrates from game/system audio.
 • Other user accounts on this machine: log into their session
   once and select the pro-audio profile (or just replug the
   dongle) — the rules already apply to them.
 • Note: the dongle's microphone input is disabled on purpose
   (it would kill haptics over Bluetooth). Use another mic.

 Configure haptics intensity etc.:  python3 scripts/set_ds5.py --help
────────────────────────────────────────────────────────────
EOF
