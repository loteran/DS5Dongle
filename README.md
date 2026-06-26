<h1 align="center">DS5Dongle — Auto Haptics Edition</h1>

<p align="center"><a href="https://ko-fi.com/W7W31VXIVC"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi"></a></p>

> **Fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle)**  
> Adds **Audio Auto Haptics**: your DualSense vibrates in sync with the game's sounds — footsteps, gunshots, explosions — even when the game has no haptic support.

![Hardware](https://img.shields.io/badge/hardware-Raspberry%20Pi%20Pico%202%20W-c51a4a?logo=raspberrypi&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue?logo=linux&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
[![Usage stats](https://img.shields.io/badge/usage-stats-informational)](https://loteran.github.io/DS5Dongle/stats/)

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
2. Under the latest release, download the file named **`ds5-bridge-X.X.X.uf2`**  
   (ignore all the other files — you only need the `.uf2`)

**Which UF2 to pick:**

| Asset | When to use |
| --- | --- |
| `ds5-bridge-<version>.uf2` | **Default.** Recommended for everyone. |
| `ds5-bridge-wake-<version>.uf2` | Only if you need the dongle to **wake a sleeping Windows host**. |
| `ds5-bridge-debug-<version>.uf2` | Troubleshooting (USB-serial verbose logs). |

> ⚠️ The **wake** variant advertises USB `REMOTE_WAKEUP`. On Linux, a wake-capable
> device is grabbed by Wine/Proton's libusb HID scanner, which can starve other
> USB-HID tools (e.g. an Arctis headset control daemon) with `EBUSY` errors —
> making them see the headset as permanently offline. Use the default UF2 unless
> you specifically need host-wake.

---

### Step 2 — Flash the Pico

"Flashing" means copying the firmware onto the Pico so it knows what to do. It works like a USB key.

#### On Linux

1. Hold the **BOOTSEL** button on the Pico (small white button on the board)
2. While holding it, plug the Pico into your PC via USB
3. Release the button — the Pico appears as a drive called **`RP2350`**
4. Copy the firmware onto it:

```bash
cp ds5-bridge-X.X.X.uf2 /run/media/$USER/RP2350/
```

> 💡 Replace `X.X.X` with the actual version number you downloaded.

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

> ✅ **How to know it worked:** the DualSense light bar stops flashing and stays solid. Your PC should now see a **"DS5 Bridge"** gamepad in its device list (check Settings → Bluetooth & devices on Windows, or run `ls /dev/input/js*` on Linux).

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

All the needed files are already in the repo. Run these commands from inside the project folder:

```bash
# Copy the background service file
install -Dm644 ds5-haptics-loopback.service \
  ~/.config/systemd/user/ds5-haptics-loopback.service

# Copy the plug/unplug rules (needs admin — that's what sudo is for)
sudo install -Dm644 70-ds5dongle.rules        /etc/udev/rules.d/70-ds5dongle.rules
sudo install -Dm755 ds5dongle-loopback-stop   /usr/lib/ds5dongle/ds5dongle-loopback-stop

# Tell systemd and udev to reload their configs
systemctl --user daemon-reload
sudo udevadm control --reload-rules
```

> 💡 If you cloned the repo, these files are at the root of the project (not inside `config-app/`).

**4. Unplug and replug the Pico**

The udev rule triggers on plug/unplug. Replug the Pico to start the loopback for the first time.

**5. Verify everything is working**

```bash
# Should print "active"
systemctl --user is-active ds5-haptics-loopback.service

# Should show both loopbacks linked to ds5_dongle_sink (not your speakers)
pw-link -lo | grep -A2 "ds5_haptics_playback"
```

> ✅ **How to know it worked:** the first command prints `active`, and the second shows `ds5_dongle_sink` as the target for `ds5_haptics_playback_game` (and `ds5_haptics_playback_output` when ASM is installed). Now start a game, make noise, and feel the controller vibrate.

> ⚠️ **If the loopback targets your speakers instead of the Pico** — check that the WirePlumber rule from step 1 is applied (`pw-dump | grep ds5_dongle_sink`). If empty, the rule file might have a typo.

**Optional — send only one game's audio (not the whole system)**

By default, all system audio goes to the Pico. If you only want one game to drive the haptics:

1. Install `pavucontrol`: `sudo apt install pavucontrol` (Ubuntu) / `sudo pacman -S pavucontrol` (Arch)
2. Open `pavucontrol` → **Playback** tab while the game is running
3. Find the game's stream and change its output to **DS5 Bridge**

Everything else (music, Discord, etc.) will only go to your headset/speakers.

**To fully uninstall the audio routing:**

```bash
systemctl --user stop ds5-haptics-loopback.service
rm ~/.config/systemd/user/ds5-haptics-loopback.service
sudo rm -f /etc/udev/rules.d/70-ds5dongle.rules /usr/lib/ds5dongle/ds5dongle-loopback-stop
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
| **Mode** | **0** = disabled · **1** = mix audio haptics with game haptics · **2** = audio haptics only | 2 |
| **Intensity** | How strong the vibrations are (percentage) | 100% |
| **Low-pass cutoff** | Which frequencies trigger vibrations — lower = more bass-heavy | 0 (80 Hz) |

**Which settings to use:**

| You want… | Use these settings |
|---|---|
| Strong bass rumble (racing, explosions) | Mode 2 · 80 Hz · 100% |
| More detail (FPS footsteps, reloads) | Mode 2 · 250–400 Hz · 100% |
| Vibrations are too weak | Increase intensity to 120–150% |
| Vibrations are too strong | Decrease intensity to 50–80% |
| Game already sends haptics + you want audio too | Mode 1 (mix) |
| Turn haptics off temporarily | Mode 0 |

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
- Check the **Auto Haptics** section in the app: Mode must be **1 (Mix)** or **2 (Replace)**, not 0
- The loopback captures your **default audio output** device. If audio is routed to a non-default device, it won't be captured. Check that the app's status banner shows the correct source device
- Try playing audio with the volume at a reasonable level — very low volumes may not trigger noticeable haptics

### The controller vibrates but the haptics feel wrong / too weak / too strong

Open the [config tool](#step-5--open-the-config-tool) and adjust:
- **Intensity**: start at 100%, go up to 150% if too weak or down to 50% if too strong
- **Low-pass cutoff**: 80 Hz for deep bass rumble, 250–400 Hz for sharper impacts
- **Mode**: if the game already sends native haptics and they clash, try Mode 2 (audio only)

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
| `speaker_volume` | -100 – 0 dB | -100 | DualSense internal speaker volume |
| `audio_buffer_length` | 16 – 128 | 64 | Haptics PCM packet size (lower = less latency) |
| `inactive_time` | 5 – 60 min | 30 | Auto-disconnect delay |
| `disable_inactive_disconnect` | 0 / 1 | 0 | 1 = always stay connected |
| `disable_pico_led` | 0 / 1 | 0 | 1 = turn off Pico LED |
| `polling_rate_mode` | 0 / 1 / 2 | 0 | 0=250Hz · 1=500Hz · 2=1000Hz |
| `controller_mode` | 0 / 1 / 2 | 2 | 0=DS5 · 1=DSE Edge · 2=Auto |
| `auto_haptics_enable` | 0 / 1 / 2 | 2 | Auto haptics mode |
| `auto_haptics_gain` | 0 – 200% | 100 | Auto haptics intensity |
| `auto_haptics_lowpass` | 0 / 1 / 2 / 3 | 0 | LP cutoff: 80/160/250/400 Hz |
| `enable_poweroff_shortcut` | 0 / 1 | 1 | 1 = PS+Triangle powers off the controller |
| `enable_touchpad` | 0 / 1 | 1 | Touchpad default state on connect (PS+Circle toggles runtime) |

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

---

## 📌 Technical notes

- DSP runs on **Core 0** inside `audio_loop()` — no new threads, no queues added
- All state is `static` (16 bytes: 2× LP + 2× envelope)
- Cost: ~6 multiply-adds per sample + 1 division — negligible at 320 MHz
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
