<h1 align="center">DS5Dongle — Auto Haptics Edition</h1>

<p align="center"><a href="https://ko-fi.com/W7W31VXIVC"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi"></a></p>

> **Fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle)**  
> Adds **Audio Auto Haptics**: your DualSense vibrates in sync with the game's sounds — footsteps, gunshots, explosions — even when the game has no haptic support.

![Hardware](https://img.shields.io/badge/hardware-Raspberry%20Pi%20Pico%202%20W-c51a4a?logo=raspberrypi&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue?logo=linux&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
[![Usage stats](https://img.shields.io/badge/usage-stats-informational)](https://loteran.github.io/DS5Dongle/stats/)

> Synced with upstream [awalol/DS5Dongle `v0.7.2-hotfix`](https://github.com/awalol/DS5Dongle/releases/tag/v0.7.2-hotfix):
> controller mic capture, improved wake-from-sleep, BOOTSEL-button controller
> management (pair/reboot/forget without unplugging), Xbox Game Bar shortcuts,
> Waveshare RP2350B-Plus-W board support, a macOS build script, and the
> RAM-relocated hot path described in [Performance](#performance) below.
>
> **[v0.7.2](https://github.com/loteran/DS5Dongle/releases/tag/v0.7.2)**: fixed
> controller input lag under sustained auto-haptics audio (the 48kHz→3kHz
> haptics resample was expensive enough to delay the Bluetooth poll loop —
> replaced with a fixed 1-in-16 decimation, see [Performance](#performance)).
> Also: wake-on-PS is now a **runtime** config toggle (`enable_wake`, default
> off) instead of a separate firmware build — one UF2 covers both cases now.

---

## Table of Contents

- [What does this do?](#-what-does-this-do)
  - [The problem](#the-problem)
  - [The solution — a $20 bridge](#the-solution--a-20-bridge)
  - [What this fork adds](#what-this-fork-adds--audio-auto-haptics)
- [How it works internally](#-how-it-works-internally)
  - [Pico DSP pipeline](#pico-dsp-pipeline)
  - [Desktop app — Windows audio routing](#desktop-app--how-windows-audio-routing-works)
- [Hardware required](#-hardware-required)
- [Installation](#-installation)
  - [What you need](#what-you-need)
  - [Step 1 — Download the firmware](#step-1--download-the-firmware)
  - [Step 2 — Flash the Pico](#step-2--flash-the-pico)
  - [Step 3 — Pair your DualSense](#step-3--pair-your-dualsense)
  - [Step 4 — Route audio to the Pico](#step-4--route-audio-to-the-pico)
    - [Linux (PipeWire)](#linux-pipewire)
    - [Windows](#windows)
- [Configuration](#-configuration)
  - [Step 5 — Open the config tool](#step-5--open-the-config-tool)
    - [Web app (recommended)](#web-app--recommended)
    - [Desktop app — DS5 Audio Haptics BT](#desktop-app--ds5-audio-haptics-bt)
  - [Auto Haptics settings](#auto-haptics-settings)
  - [Python CLI (advanced)](#python-script-cli--no-chrome)
- [Troubleshooting](#-troubleshooting)
- [All configuration parameters](#-all-configuration-parameters)
- [Building from source](#-building-from-source)
- [Technical notes](#-technical-notes)
- [Usage statistics](#-usage-statistics)
- [Credits](#-credits)

---

## 🎮 What does this do?

### The problem

The Sony DualSense controller has advanced features that only work properly when connected **by USB cable** on PC: the HD haptics (the actuators that make you feel every texture), the internal speaker, and the adaptive triggers. Connect it via Bluetooth and most of these are lost — the operating system simply doesn't know how to send that data wirelessly.

On top of that, even with a cable, **most PC games never send haptic commands at all** — including many games that do vibrate on PS5. The game just doesn't bother implementing it for PC.

### The solution — a $20 bridge

DS5Dongle is a firmware for the **Raspberry Pi Pico 2 W** (~$7 board) that acts as a smart bridge between your PC and your DualSense:

```
Your PC
  │
  │  USB cable  (the Pico looks exactly like a DualSense plugged in by cable)
  ▼
Raspberry Pi Pico 2 W        ← this is the "dongle"
  │
  │  Bluetooth
  ▼
DualSense controller         ← wireless, on your couch
```

Your PC thinks it has a DualSense connected by USB. In reality it's talking to the Pico, which relays everything to the controller wirelessly. You get all the features, without the cable to the controller.

### What this fork adds — Audio Auto Haptics

This fork goes further: the Pico **listens to the game's audio** and **generates vibrations from the sound**, in real time, with no software needed on your PC.

| Sound | Haptic feel |
|-------|-------------|
| Horse galloping | Rhythmic hoofbeat pulses |
| Gunshot | Sharp impact in your hands |
| Explosion | Deep rumble that fades out |
| Car engine | Constant low-frequency buzz changing with RPM |

This works even if the game has **zero haptic support**. The Pico extracts the bass and impact sounds from the audio stream and converts them into motor signals, entirely by itself.

> **Compared to the PS5 experience**, this is not identical — the PS5 has access to precise per-object haptic data from the game engine. What this does is a smart approximation from audio alone, similar to what apps like DSX do on Windows. In practice it adds a lot of immersion to games that would otherwise have no feedback at all.

---

## ⚙️ How it works internally

### Pico DSP pipeline

The Pico receives the game audio over USB (it appears as a stereo USB sound card — 2 channels, 48 kHz). It then runs this signal through a small DSP chain entirely in firmware, with no CPU overhead on your PC:

```
Game audio (stereo, 48 kHz)
    │
    ├── Low-pass filter (selectable: 80 / 160 / 250 / 400 Hz)
    │       → isolates the bass frequencies the actuators can reproduce
    │
    ├── Envelope follower  (attack 1 ms / release 80 ms)
    │       → detects sudden impacts and gives them extra punch
    │
    ├── Waveform shaping
    │       → turns the filtered signal into a physically convincing rumble
    │
    └── Sent to the DualSense actuators via Bluetooth
```

Three modes let you control how the auto haptics interact with games that do send native haptic data:

| Mode | Behaviour |
|------|-----------|
| **0 — Off** | Original behaviour: only native haptics from the game pass through |
| **1 — Mix** | Native game haptics **+** audio-derived signal at the same time |
| **2 — Replace** *(default)* | Audio-derived signal only — best for games with no haptic support |

Classic rumble (games that do send vibration commands via DirectInput/SDL) works normally alongside the auto haptics — they go through a completely separate path and are unaffected.

### Desktop app — how Windows audio routing works

On Windows, the **DS5 Audio Haptics BT** desktop app routes audio to the Pico automatically, without any third-party tool (no VoiceMeeter, no virtual audio cable):

```
Windows default audio output
(your speakers / headset — completely untouched)
    │
    │  WASAPI loopback — read-only, silent tap of the output mix
    ▼
DS5 Audio Haptics BT          ← Electron app
    │  spawns a separate Node.js worker (RtAudio / WASAPI backend)
    │  to avoid Electron's embedded-Node ABI constraints
    │
    │  USB audio — 48 kHz stereo PCM, 10 ms frames
    ▼
Raspberry Pi Pico 2 W         ← on-board DSP runs the haptics pipeline above
```

- **Non-destructive** — WASAPI loopback taps the Windows mix without rerouting anything. Your speakers and headset continue to work normally, at full volume.
- **Automatic** — the app detects the dongle via USB hotplug and starts/stops the audio loopback automatically when you plug or unplug the Pico.
- **Self-contained** — the installer includes everything. No additional software, driver, or audio configuration is required.

---

## 🔧 Hardware required

| Item | Notes |
|------|-------|
| **Raspberry Pi Pico 2 W** | RP2350 + CYW43439 BT chip. Pico W (RP2040) compiles but has no audio. |
| USB-A to micro-USB cable | To connect the Pico to your PC |
| DualSense controller | Pair once following the [original pairing guide](https://github.com/awalol/DS5Dongle#pairing) |

---

## 🚀 Installation

> **In a nutshell — 4 steps:**
> 1. 📥 Download the firmware file (`.uf2`)
> 2. ⚡ Copy it onto the Pico (30 seconds, no software needed)
> 3. 🎮 Pair your DualSense with the Pico via Bluetooth
> 4. 🔊 Tell your PC to send a copy of its audio to the Pico

---

### What you need

Before starting, make sure you have everything:

- [ ] A **Raspberry Pi Pico 2 W** (the one with the "W" — Wi-Fi/Bluetooth chip)  
  > ⚠️ The regular Pico 2 (without W) won't work — it has no Bluetooth.
- [ ] A **USB-A to micro-USB cable** to connect the Pico to your PC
- [ ] A **DualSense controller** (PlayStation 5 controller)
- [ ] A PC running **Linux** or **Windows**

---

### Step 1 — Download the firmware

1. Go to the **[Releases page](https://github.com/loteran/DS5Dongle/releases)**
2. Under the latest release, download the file named **`ds5-bridge-vX.X.X.uf2`**  
   (ignore all the other files — you only need this one `.uf2`)

**Which UF2 to pick:**

| Asset | When to use |
| --- | --- |
| `ds5-bridge-<version>.uf2` | **This is the only one you need.** Wake-on-PS is a config toggle (off by default), not a separate build — see [Auto Haptics settings](#auto-haptics-settings) / the `enable_wake` field. |
| `ds5-bridge-debug-<version>.uf2` | Troubleshooting only (USB-serial verbose logs). Not needed for normal use. |

> ⚠️ Turning **wake-on-PS** on (`enable_wake`) makes the dongle advertise USB
> `REMOTE_WAKEUP`. On Linux, a wake-capable device is grabbed by Wine/Proton's
> libusb HID scanner, which can starve other USB-HID tools (e.g. an Arctis
> headset control daemon) with `EBUSY` errors — making them see the headset as
> permanently offline. Leave it off unless you specifically need host-wake.

---

### Step 2 — Flash the Pico

"Flashing" means copying the firmware onto the Pico so it knows what to do. It works like a USB key.

#### On Linux

1. Hold the **BOOTSEL** button on the Pico (small white button on the board)
2. While holding it, plug the Pico into your PC via USB
3. Release the button — the Pico appears as a drive called **`RP2350`**
4. Copy the firmware onto it:

```bash
cp ds5-bridge-vX.X.X.uf2 /run/media/$USER/RP2350/
```

> 💡 Replace `vX.X.X` with the actual version number you downloaded.

#### On Windows

1. Hold **BOOTSEL**, plug the Pico in, release the button
2. It appears as a drive in File Explorer, named **`RP2350`**
3. Drag and drop the `.uf2` file onto that drive

The Pico reboots by itself as soon as the file is copied. The drive disappears — that's normal, it means the flashing worked. ✅

> ✅ **How to know it worked:** the Pico LED blinks a few times, then stays on or blinks slowly. If it goes back to the `RP2350` drive, try again with the right file (`.uf2` only, not `.elf` or `.bin`).

---

### Step 3 — Pair your DualSense

The Pico acts as a Bluetooth host — your DualSense connects to it wirelessly, not directly to your PC.

> ⚠️ **Important:** once paired with the Pico, the DualSense will no longer connect directly to your PC via Bluetooth. It will always go through the Pico instead. You can re-pair it directly at any time by following the same steps below without the Pico.

**To pair for the first time:**

1. Make sure the Pico is plugged in and powered (LED on)
2. On the DualSense: hold **PS button + Create button** (small button top-left of the touchpad) for 5 seconds until the light bar flashes rapidly
3. The Pico searches for a DualSense and pairs automatically — the DualSense light bar turns solid white when connected

> ✅ **How to know it worked:** the DualSense light bar stops flashing and stays solid. Your PC should now see a **"DS5 Dongle"** gamepad in its device list (check Settings → Bluetooth & devices on Windows, or run `ls /dev/input/js*` on Linux).

> 💡 **Next time:** just press the PS button normally. The DualSense reconnects to the Pico automatically (no need to re-pair).

---

### Step 4 — Route audio to the Pico

The Pico needs to "hear" your game audio to turn it into vibrations. This step creates a silent background copy of your audio that goes to the Pico — **your headset or speakers are not affected at all.**

---

#### Linux (PipeWire)

> 💡 **What is PipeWire?** It's the audio system used by modern Linux distributions (Ubuntu 22.04+, Fedora 34+, Arch, etc.). These commands configure it to send a copy of your audio to the Pico automatically whenever it's plugged in.

> ⚡ **Quick install (recommended).** Instead of the manual steps below, run the
> installer from a checked-out tree — it sets everything up system-wide
> (for all user accounts) and configures udev so the loopback starts/stops with
> the dongle:
>
> ```bash
> ./scripts/install-pipewire-config.sh
> ```
>
> The manual steps below do exactly the same thing if you prefer to understand
> or customise each piece.

**1. Give the Pico a stable name**

By default, PipeWire gives the Pico a random name that can change each time you plug it in. This command gives it a fixed name (`ds5_dongle_sink`) so the rest of the setup always finds it.

```bash
mkdir -p ~/.config/wireplumber/wireplumber.conf.d
```

Create the file `~/.config/wireplumber/wireplumber.conf.d/51-ds5dongle.conf` with this content:

```ini
monitor.alsa.rules = [
  {
    matches = [
      { alsa.components = "USB054c:0ce6"
        media.class     = "Audio/Sink" }
      { alsa.components = "USB054c:0df2"
        media.class     = "Audio/Sink" }
    ]
    actions = {
      update-props = {
        node.name        = "ds5_dongle_sink"
        priority.session = 0
      }
    }
  }
  {
    matches = [
      { alsa.components = "USB054c:0ce6"
        node.name       = "~alsa_output\\.usb-.*" }
      { alsa.components = "USB054c:0df2"
        node.name       = "~alsa_output\\.usb-.*" }
    ]
    actions = {
      update-props = {
        priority.session = 0
      }
    }
  }
  {
    # Disable the Pico's audio capture (mic) endpoint. The pro-audio profile is
    # duplex, so PipeWire keeps the USB capture interface active alongside
    # playback. On the Pico that capture traffic contends with the Bluetooth
    # link and silently kills the haptics output (the controller stops
    # vibrating). The dongle is a haptics/audio *output* device only, so we
    # disable its source to free the BT link. Without this rule, auto-haptics
    # work with `aplay` (playback-only) but not through PipeWire.
    matches = [
      { alsa.components = "USB054c:0ce6"
        media.class     = "Audio/Source" }
      { alsa.components = "USB054c:0df2"
        media.class     = "Audio/Source" }
    ]
    actions = {
      update-props = {
        node.disabled = true
      }
    }
  }
]
```

Then reload WirePlumber to apply the rule:

```bash
systemctl --user restart wireplumber
```

**2. Set the audio profile on the Pico**

The Pico exposes two audio profiles. The auto-haptics system needs the **pro-audio** one. Run this once:

```bash
pactl set-card-profile alsa_card.usb-Sony_Interactive_Entertainment_DualSense_Wireless_Controller-00 pro-audio
```

> 💡 This is remembered automatically — you only need to do it once.

**3. Install the automatic loopback**

This sets up the background audio copy. It uses a **systemd service** (a background program that runs automatically) and a **udev rule** (a rule that starts/stops it when you plug/unplug the Pico).

All the needed files are already in the repo, inside `config-app/`. Run these commands from inside the project folder:

```bash
# Copy the background service + the self-heal watchdog
install -Dm644 config-app/ds5-haptics-loopback.service \
  ~/.config/systemd/user/ds5-haptics-loopback.service
install -Dm644 config-app/ds5-haptics-watchdog.service \
  ~/.config/systemd/user/ds5-haptics-watchdog.service
install -Dm644 config-app/ds5-haptics-watchdog.timer \
  ~/.config/systemd/user/ds5-haptics-watchdog.timer

# Copy the helper scripts (needs admin — that's what sudo is for).
# ds5-haptics-sources decides which audio the haptics follow; the service and
# the watchdog both call it, so the loopback will not start without it.
sudo install -Dm755 config-app/ds5-haptics-sources    /usr/lib/ds5dongle/ds5-haptics-sources
sudo install -Dm755 config-app/ds5-haptics-ensure     /usr/lib/ds5dongle/ds5-haptics-ensure
sudo install -Dm755 config-app/ds5dongle-loopback-stop /usr/lib/ds5dongle/ds5dongle-loopback-stop

# Copy the plug/unplug rules
sudo install -Dm644 config-app/70-ds5dongle.rules     /etc/udev/rules.d/70-ds5dongle.rules

# Tell systemd and udev to reload their configs, and start the watchdog
systemctl --user daemon-reload
systemctl --user enable --now ds5-haptics-watchdog.timer
sudo udevadm control --reload-rules
```

**4. Unplug and replug the Pico**

The udev rule triggers on plug/unplug. Replug the Pico to start the loopback for the first time.

**5. Verify everything is working**

```bash
# Should print "active"
systemctl --user is-active ds5-haptics-loopback.service

# Should show both loopbacks linked to ds5_dongle_sink (not your speakers)
pw-link -lo | grep -A2 "ds5_haptics_playback"
```

> ✅ **How to know it worked:** the first command prints `active`, and the second shows `ds5_haptics_playback_game` (and `ds5_haptics_playback_output`, when a second source is captured) linked to `ds5_dongle_sink` — specifically to its **`playback_AUX2` / `playback_AUX3`** ports. Those two carry the haptic actuators; `AUX0`/`AUX1` are the pad's 3.5mm headphone jack, so a loopback wired there plays into the jack and never vibrates. Now start a game, make noise, and feel the controller vibrate.

> ⚠️ **If the loopback targets your speakers instead of the Pico** — check that the WirePlumber rule from step 1 is applied (`pw-dump | grep ds5_dongle_sink`). If empty, the rule file might have a typo.

**Which audio drives the haptics?**

`ds5-haptics-sources` decides this, and both the loopback and the watchdog follow it:

- **On a plain PipeWire setup**, the haptics follow your **default output device** — whatever you hear vibrates. Switch the output (headset → TV) and the watchdog re-points the loopback within 30s.
- **With [Arctis Sound Manager](https://github.com/loteran/arctis-sound-manager) installed**, the haptics follow its **Game** channel, plus your system output device when ASM doesn't own it (a TV/HDMI, speakers) — that mix carries games that bypass ASM. ASM's **Chat** and **Media** channels are never captured, so voice chat and music don't make the pad buzz.
- The Pico's own sink is never captured — that would feed it back into itself.

**Optional — send only one game's audio (not the whole system)**

If you only want one game to drive the haptics:

1. Install `pavucontrol`: `sudo apt install pavucontrol` (Ubuntu) / `sudo pacman -S pavucontrol` (Arch)
2. Open `pavucontrol` → **Playback** tab while the game is running
3. Find the game's stream and change its output to **DS5 Dongle**

Everything else (music, Discord, etc.) will only go to your headset/speakers.

**To fully uninstall the audio routing:**

```bash
systemctl --user disable --now ds5-haptics-watchdog.timer
systemctl --user stop ds5-haptics-loopback.service
rm -f ~/.config/systemd/user/ds5-haptics-loopback.service \
      ~/.config/systemd/user/ds5-haptics-watchdog.service \
      ~/.config/systemd/user/ds5-haptics-watchdog.timer
sudo rm -rf /etc/udev/rules.d/70-ds5dongle.rules /usr/lib/ds5dongle
rm -f ~/.config/wireplumber/wireplumber.conf.d/51-ds5dongle.conf
systemctl --user daemon-reload
sudo udevadm control --reload-rules
systemctl --user restart wireplumber pipewire
```

---

#### Windows

**No third-party tool required.** The **DS5 Audio Haptics BT** desktop app handles audio routing automatically on Windows.

When the dongle is connected and the app is running, it captures your PC's default audio output in the background (via WASAPI loopback) and streams it silently to the Pico — your headset or speakers are not affected at all.

> ✅ **Nothing to configure.** Open the app, connect the dongle, and audio haptics are active immediately. Skip directly to [Step 5](#step-5--open-the-config-tool).

> 💡 **The app must be running** for audio haptics to work on Windows. If you close it, the loopback stops. A future release will add a system-tray mode so the app can run minimised in the background.

---

## 🎛️ Configuration

### Step 5 — Open the config tool

Once everything above is working, use the config tool to tune the haptics to your taste.

#### Web app — recommended

The easiest option — works directly in your browser, no installation needed.

1. Open **[DS5 Bridge Config](https://loteran.github.io/ds5dongle-config/)** in **Chrome or Edge**  
   > ⚠️ Firefox is not supported (it doesn't support WebHID, the browser API used to communicate with the Pico)
2. Click **Connect** → a dialog appears — select **DS5Dongle** from the list and click **Connect**
3. The current settings are loaded automatically from the Pico
4. Change any setting
5. Click **Save to Device** — the settings are written to the Pico's memory and survive reboots

#### Desktop app — DS5 Audio Haptics BT

A native cross-platform app (Linux + Windows) — no browser needed. Auto-detects the dongle on plug/unplug and adds **named presets** (save/load your favourite configurations).

##### Linux

**Arch / CachyOS / EndeavourOS (AUR)**

```bash
paru -S ds5-audio-haptics-bt
# or: yay -S ds5-audio-haptics-bt
```

**Ubuntu / Debian / Pop!_OS (DEB)**

Download `ds5-audio-haptics-bt_*.deb` from the [latest `app-v*` release](https://github.com/loteran/DS5Dongle/releases):

```bash
sudo dpkg -i ds5-audio-haptics-bt_*.deb
```

**Fedora / RHEL / openSUSE (RPM)**

Download `ds5-audio-haptics-bt-*.rpm` from the [latest `app-v*` release](https://github.com/loteran/DS5Dongle/releases):

```bash
sudo rpm -i ds5-audio-haptics-bt-*.rpm        # Fedora / RHEL
# or: sudo zypper install ds5-audio-haptics-bt-*.rpm  # openSUSE
```

**Any distro (tar.gz)**

Download `ds5-audio-haptics-bt-*-linux-x64.tar.gz` from the [latest `app-v*` release](https://github.com/loteran/DS5Dongle/releases):

```bash
tar -xzf ds5-audio-haptics-bt-*-linux-x64.tar.gz
./ds5-audio-haptics-bt-linux-x64/ds5-audio-haptics-bt
```

> For HID access without `sudo`, install the udev rule once (only needed if you skipped step 4):
> ```bash
> sudo install -Dm644 config-app/70-ds5dongle.rules /etc/udev/rules.d/70-ds5dongle.rules
> sudo udevadm control --reload-rules && sudo udevadm trigger
> ```

##### Windows

1. Download `ds5-audio-haptics-bt-Setup-*.exe` from the [latest `app-v*` release](https://github.com/loteran/DS5Dongle/releases)
2. Run the installer
3. Launch **DS5 Audio Haptics BT** from the Start menu or the desktop shortcut

> 💡 **Presets** are saved in `~/.config/ds5-audio-haptics-bt/presets/` (Linux) or `%APPDATA%\ds5-audio-haptics-bt\presets\` (Windows).

---

### Controller shortcuts

These shortcuts work at any time, even without opening the config tool:

| Shortcut | Action |
|----------|--------|
| **PS + Triangle** | Power off the controller |
| **PS + Circle** | Toggle touchpad on/off *(not saved — resets on reconnect)* |

> 💡 Both shortcuts can be disabled from the config page if you don't want them.

---

### Auto Haptics settings

These are the three settings that control how the audio is converted to vibrations:

| Setting | What it does | Default |
|---------|-------------|---------|
| **Mode** | **Full audio** = raw ch3/ch4 passthrough · **Bass mix** = ch3/ch4 + pad-speaker bass, blended · **Pad speaker** = pad-speaker bass only, ignores ch3/ch4 | Pad speaker |
| **Intensity** | How strong the vibrations are (percentage) | 100% |
| **Low-pass cutoff** | Which frequencies trigger vibrations — lower = more bass-heavy | 0 (80 Hz) |

**Which settings to use:**

| You want… | Use these settings |
|---|---|
| Strong bass rumble (racing, explosions) | Pad speaker · 80 Hz · 100% |
| More detail (FPS footsteps, reloads) | Pad speaker · 250–400 Hz · 100% |
| Vibrations are too weak | Increase intensity to 120–150% |
| Vibrations are too strong | Decrease intensity to 50–80% |
| Game already sends native haptics + you want audio too | Bass mix |
| Turn auto-haptics off temporarily (native game haptics still work) | Full audio |

> 🐧 **Linux, using the PipeWire loopback from [Step 4](#linux-pipewire):** use **Full audio** or
> **Bass mix**, not **Pad speaker** — see
> [Troubleshooting](#linux-the-pipewire-loopback-looks-healthy-but-nothing-vibrates) for why
> "Pad speaker" is the one mode that goes silent under that setup.
>
> 🪟 **Windows, using the built-in WASAPI loopback:** the opposite applies — use **Bass mix** or
> **Pad speaker**, not **Full audio**. The Windows loopback plays into the pad's own speaker
> channels (what "Pad speaker" mode listens to), not the dedicated ch3/ch4 haptic channel that
> "Full audio" needs.

---

### Python script (CLI / no Chrome)

For advanced users who prefer the command line:

```bash
pip install hidapi

# Show current config
python3 scripts/set_ds5.py

# Turn on auto haptics — audio-only mode, 160 Hz filter, 120% intensity
python3 scripts/set_ds5.py --auto-haptics-enable 2 --auto-haptics-gain 120 --auto-haptics-lowpass 1

# Turn off auto haptics
python3 scripts/set_ds5.py --auto-haptics-enable 0

# See all available options
python3 scripts/set_ds5.py --help
```

> 💡 On Linux, you may need to install the udev rule first so your user can access the device without `sudo`:
> ```bash
> sudo cp 70-ds5dongle.rules /etc/udev/rules.d/
> sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=hidraw
> # then replug the Pico
> ```

---

## 🔍 Troubleshooting

### The Pico doesn't appear as RP2350 when I hold BOOTSEL

- Make sure you're holding BOOTSEL **before** plugging in the cable, and releasing it **after**
- Try a different USB cable — many cheap cables are charge-only and don't carry data
- Try a different USB port (USB 2.0 ports sometimes work better than USB 3.0)

### The DualSense won't pair (light bar keeps flashing)

- Make sure the Pico firmware was flashed correctly (repeat Step 2)
- Hold **PS + Create** for at least 5 seconds — the light bar needs to blink rapidly before pairing starts
- Move the controller closer to the Pico during pairing (within 1 metre)
- Unplug and replug the Pico, then try pairing again

### Linux: the loopback service is not active

```bash
# Check why it failed
systemctl --user status ds5-haptics-loopback.service
journalctl --user -u ds5-haptics-loopback.service -n 30
```

Common causes:
- **`ds5_dongle_sink` not found** — the WirePlumber rename rule didn't match. This can happen when your PipeWire/WirePlumber version appends extra text to the device's `alsa.components` property. Make sure you have the latest `51-ds5dongle.conf` (v1.2.12+) which uses regex matching. Re-run the install script after a `git pull`, then restart WirePlumber and replug the Pico
- **Service not found** — the `.service` file wasn't installed. Redo step 3 of the Linux audio setup
- **`pw-loopback` not found** — install PipeWire tools: `sudo apt install pipewire-audio` (Ubuntu) / `sudo pacman -S pipewire` (Arch)
- **Custom audio sink / patchbay setup** — if you use a virtual upmix sink (e.g. a stereo→5.1 upmix via qpwgraph), the loopback service will capture the monitor of whichever sink is your system default. Make sure your upmix sink is the PipeWire default output. Do **not** connect the DualSense manually in qpwgraph — the USB audio clock domain conflict will freeze your entire audio graph. Let the service handle the connection via `pw-loopback`

### Linux: the DualSense audio profile keeps changing back

Run this command once to lock it to pro-audio:

```bash
pactl set-card-profile alsa_card.usb-Sony_Interactive_Entertainment_DualSense_Wireless_Controller-00 pro-audio
```

If the problem persists, check your WirePlumber configuration file for typos.

### Windows: the controller doesn't vibrate even though the app is running

- Make sure the dongle is connected — the app shows a green indicator when it detects the Pico
- Check the **Auto Haptics** section in the app: Mode must be **Bass mix** or **Pad speaker**, not **Full audio** (see the 🪟 note above — the Windows loopback plays into the pad's own speaker channels)
- The loopback captures your **default audio output** device. If audio is routed to a non-default device, it won't be captured. Check that the app's status banner shows the correct source device
- Try playing audio with the volume at a reasonable level — very low volumes may not trigger noticeable haptics

### The controller vibrates but the haptics feel wrong / too weak / too strong

Open the [config tool](#step-5--open-the-config-tool) and adjust:
- **Intensity**: start at 100%, go up to 150% if too weak or down to 50% if too strong
- **Low-pass cutoff**: 80 Hz for deep bass rumble, 250–400 Hz for sharper impacts
- **Mode**: if the game already sends native haptics and they clash with the audio-derived signal, try **Pad speaker** (ignores native haptics entirely — only works if real audio reaches the pad's own speaker channels, see the platform notes above)

### Linux: the PipeWire loopback looks healthy but nothing vibrates

Service active, `ds5_dongle_sink` `RUNNING`, `pw-link -l` shows the loopback linked to
`playback_AUX2`/`AUX3` — and still nothing. Check **`auto_haptics_enable`**: it must be
**`0` Full audio or `1` Bass mix** — **not `2` Pad speaker** — for the PC-side PipeWire
loopback to drive the actuators.

> **Why:** the loopback writes to AUX2/AUX3 (the actuator channels) on purpose, never to
> AUX0/AUX1 (the pad's own speaker/headphone-jack channels — writing there would also play
> the audio out loud through the pad's jack). Each mode treats those two inputs differently:
> - **`0` Full audio** — AUX2/AUX3 pass straight through, raw. This is what the loopback needs.
> - **`1` Bass mix** — AUX2/AUX3 pass through too, just low-pass filtered, mixed with whatever
>   bass is synthesized from AUX0/AUX1 (silence, in the loopback setup). Works, with extra
>   filtering.
> - **`2` Pad speaker** — *discards* AUX2/AUX3 entirely and vibrates only from what's
>   synthesized from AUX0/AUX1. Since the loopback never feeds those, this mode is silent
>   under this setup — it's meant for the other scenario, where the DualSense's own speaker
>   output is your real audio device and you want haptics derived from what's actually
>   playing on it (e.g. a game that sends effects to the controller's built-in speaker).

Set it to `0` or `1` in the [config tool](#step-5--open-the-config-tool), or:

```bash
python3 scripts/set_ds5.py --auto-haptics-enable 0
```

Modes 1/2 are for the other use case — the DualSense's actual physical speaker output is your
real audio device and you want haptics derived from what's actually playing on it.

### Linux: a game (e.g. Rocket League) has no controller rumble

This is about **game/motor rumble** (vibration triggered by in-game events), not the audio
auto-haptics. Under Steam/Proton, motor rumble for most games is routed through **Steam Input** —
if it's disabled, the game often sends no rumble to the controller at all. Enable it for the game:

- Steam → right-click the game → **Properties → Controller → Enable Steam Input**

With Steam Input on, the game may see the controller twice (the Steam virtual pad **and** the raw
DualSense), which causes **double input**. This only happens **through the dongle**: the Pico
exposes its own emulated DualSense HID, so the game sees both that and the Steam virtual pad. When
the DualSense is plugged **directly into the PC over USB**, Proton hides the raw hidraw device by
itself and there is no double input — the launch option below is **not needed** in that case.

To fix it with the dongle, hide the raw device from the game by adding this launch option
(**Properties → General → Launch Options**):

```
SDL_GAMECONTROLLER_IGNORE_DEVICES=0x054c/0x0ce6 %command%
```

The PID matches the dongle's emulated mode: `0x0ce6` in DS5 mode, `0x0df2` in DSE Edge mode
(`controller_mode`). In Edge mode use `SDL_GAMECONTROLLER_IGNORE_DEVICES=0x054c/0x0df2` instead.

Steam Input still reads the DualSense and forwards rumble to the dongle, while the game now only
sees the single virtual controller. If rumble works but you never had to do this before, a Proton
update most likely changed how the raw device is hidden — this launch option restores the old
behaviour.

---

## 📋 All configuration parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `haptics_gain` | 1.0 – 2.0 | 1.0 | Global haptics amplitude multiplier |
| `speaker_volume` | 0 – 127 | 100 | DualSense internal speaker volume (linear) |
| `headset_volume` | 0 – 127 | 100 | DualSense headset-jack volume (linear) |
| `speaker_gain` | 0 – 7 | 2 | Speaker hardware gain stage (0 = auto) |
| `audio_buffer_length` | 16 – 128 | 32 | Haptics PCM packet size (lower = less latency) |
| `inactive_time` | 0 – 60 min | 30 | Auto-disconnect delay; **`0` = always stay connected** (replaces the old separate `disable_inactive_disconnect` toggle) |
| `disable_pico_led` | 0 / 1 | 0 | 1 = turn off Pico LED |
| `polling_rate_mode` | 0 / 1 / 2 | 0 | 0=250Hz · 1=500Hz · 2=1000Hz |
| `controller_mode` | 0 / 1 / 2 | 2 | 0=DS5 · 1=DSE Edge · 2=Auto |
| `auto_haptics_enable` | 0 / 1 / 2 | 2 | Auto haptics mode — **`0` or `1`, not `2`**, if you use the PC-side PipeWire/WASAPI loopback, see [Troubleshooting](#-troubleshooting) |
| `auto_haptics_gain` | 0 – 200% | 100 | Auto haptics intensity |
| `auto_haptics_lowpass` | 20 – 400 Hz | 80 | LP cutoff, free Hz value |
| `enable_poweroff_shortcut` | 0 / 1 | 1 | 1 = PS+Triangle powers off the controller |
| `enable_touchpad` | 0 / 1 | 1 | Touchpad default state on connect (PS+Circle toggles runtime) |
| `battery_color_enable` | 0 / 1 | 1 | Lightbar color reflects battery level |
| `auto_haptics_mute_replace` / `_mix` | 0 / 1 | 0 | Mute the physical speaker while auto-haptics (Replace/Mix mode) derives its signal from it |
| `enable_usb_sn` | 0 / 1 | 0 | Advertise a USB serial number |
| `ps_shortcut_enabled` | 0 / 1 | 0 | PS button → Xbox Game Bar shortcut (tap Win+G, hold Win+Tab) |
| `disable_mic` / `disable_speaker` | 0 / 1 | 0 | Disable the controller mic / speaker entirely |
| `enable_wake` | 0 / 1 | 0 | Wake-on-PS (see the ⚠️ under [Step 1](#step-1--download-the-firmware) before enabling) |
| `trigger_reduce` | 0 – 10 | 0 | Adaptive trigger power reduction (0 = auto) |

---

## 🛠️ Building from source

```bash
# Arch / CachyOS
sudo pacman -S arm-none-eabi-gcc arm-none-eabi-newlib ninja cmake

# Clone with submodules
git clone --recurse-submodules https://github.com/loteran/DS5Dongle.git
cd DS5Dongle

# Pico SDK 2.2.0
git clone --depth 1 --branch 2.2.0 https://github.com/raspberrypi/pico-sdk.git /tmp/pico-sdk
git -C /tmp/pico-sdk submodule update --init --recursive

# TinyUSB must be exactly 0.20.0
git -C /tmp/pico-sdk/lib/tinyusb fetch --depth 1 origin refs/tags/0.20.0:refs/tags/0.20.0
git -C /tmp/pico-sdk/lib/tinyusb checkout --detach 0.20.0

# Configure & build
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DPICO_SDK_PATH=/tmp/pico-sdk
ninja -C build ds5-bridge

# Output
ls build/ds5-bridge.uf2
```

Other boards: build the [Waveshare RP2350B-Plus-W](https://www.waveshare.com/wiki/RP2350B-Plus-W) (RP2350B + CYW43
wireless module, 16 MB flash, USB-C) with `-DWAVESHARE_RP2350B_PLUS_W_BUILD=ON`. On macOS, `tools/build-macos.sh`
prepares a repo-local SDK checkout (prompting for missing Homebrew tools), pins TinyUSB, and builds —
`tools/build-macos.sh --clean` to rebuild from scratch, or `--sdk-dir <path>` to reuse an existing SDK checkout.

> ⚠️ **Classic Pico W (`-DPICO_W_BUILD=ON`) is not supported by this fork's official releases** and will fail to
> link: `cmake/relocate_to_ram.cmake` moves the BT/USB/audio hot path into RAM (`.time_critical`), which fits RP2350's
> ~520 KB RAM (Pico 2 W, this project's target) but overflows RP2040's ~264 KB by roughly 200 KB (`region 'RAM'
> overflowed`). This fork targets Pico 2 W only.

## Performance

The hot audio/haptics/BT path — the auto-haptics DSP, libopus, and the Bluetooth/USB packet handling — executes from
**RAM** instead of flash (`cmake/relocate_to_ram.cmake`, `src/ram_mem.c`). This removes flash-fetch (XIP cache miss)
stalls from the time-critical loop, which previously forced an overclock just to keep up. The firmware now runs the
full audio path at the **stock 150 MHz clock** — no overclock, no core-voltage bump. If you build for a different
board and it fails to boot, reduce the CPU frequency (and/or raise the voltage) in `CMakeLists.txt`.

The haptics DSP's 48kHz→3kHz downsampling stage no longer uses a resampler at all: it emits a fixed 1-in-16 decimated
sample directly (`src/audio.cpp`). The ratio is exact (48000/3000 = 16), and the haptics channel is felt, not heard,
so a polyphase filter's interpolation quality bought nothing here — it was, however, expensive enough under sustained
real audio to delay the core's Bluetooth poll loop, felt as controller input lag. See the [v0.7.2 release
notes](https://github.com/loteran/DS5Dongle/releases/tag/v0.7.2) for the full diagnosis.

## BOOTSEL button: switch, reboot, or clear controllers

While the firmware is running, the Pico's **BOOTSEL button** doubles as a controller and reset control — no unplugging
or re-flashing needed:

- **Short press (click):** if a controller is connected, disconnect it (pairing is kept, so it can reconnect later) —
  frees the dongle for a different already-paired controller. If nothing is connected, starts a 30-second scan to pair
  a new one (put the DualSense into pairing mode: hold **PS + Create/Share** until the light bar flashes).
- **Double click:** reboot the Pico — re-enters pairing inquiry, drops the current connection, recovers from a
  transient glitch.
- **Triple click:** reboot into BOOTSEL — re-enumerates as USB mass storage so you can drag on a new `.uf2`, without
  holding BOOTSEL while plugging in.
- **Long press (~1.5 s):** disconnect and forget every paired controller — all stored pairings are deleted and
  blacklisted (won't silently auto-reconnect, even across a power cycle); the LED flashes six times to confirm.

The web config's **Reboot to Bootloader** button does the same as triple-click, without touching the physical button.
```

---

## 📌 Technical notes

- Auto-haptics DSP (LP filter + envelope follower + soft-clip), the 48 kHz→3 kHz
  resample, and the haptics BT report packing run on **Core 1** — offloaded from
  Core 0 via a queue + critical section, the same pattern already used for the
  speaker Opus path, so Core 0's `cyw43_arch_poll()`/`tud_task()` loop stays free
  of audio-processing jitter (this used to delay Bluetooth HID servicing under
  audio load, perceived as controller input lag)
- All DSP state is `static` (16 bytes: 2× LP + 2× envelope)
- Cost: ~6 multiply-adds per sample + 1 division — negligible even at the stock
  150 MHz clock (no overclock needed since the hot path runs from RAM, see
  [Performance](#performance))
- `x / (1 + |x|)` avoids `tanhf()` which is expensive on Cortex-M33
- Classic rumble goes through a separate path (`tud_hid_set_report_cb` → BT report `0x31`) — unaffected
- Config stored in last flash sector (4 kB), validated by magic header + CRC32
- **TinyUSB must be 0.20.0** — the version bundled in Pico SDK 2.2.0 is incompatible

---

## 🙏 Credits

- **[awalol](https://github.com/awalol/DS5Dongle)** — original DS5Dongle firmware
- **[egormanga/SAxense](https://github.com/egormanga/SAxense)** — DualSense BT haptics proof of concept
- **[nondebug/dualsense](https://github.com/nondebug/dualsense)** — DualSense protocol reverse engineering
- **Cockos WDL** — resampler · **xiph/opus** — audio codec

---

## 📊 Usage statistics

Anonymous, aggregated usage data shared voluntarily by users who opt in during first launch:

**[→ DS5Dongle Usage Stats](https://loteran.github.io/DS5Dongle/stats/)**

No personal data, no IP address, no account required. The app asks for consent once; you can change your choice at any time in the Settings tab.

---

## License

MIT — see [LICENSE](LICENSE)
