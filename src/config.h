//
// Created by awalol on 2026/5/4.
//

#ifndef DS5_BRIDGE_CONFIG_H
#define DS5_BRIDGE_CONFIG_H

#include <cstdint>

struct __attribute__((packed)) Config_body {
    uint8_t config_version; // Config Version
    float haptics_gain; // [1.0,2.0]
    uint8_t speaker_volume; // [0,127]
    uint8_t headset_volume; // [0,127] // max 0x7f
    uint8_t speaker_gain; // [0,7] (0: auto)
    uint8_t inactive_time; // [0,60] min (0: disable)
    uint8_t disable_pico_led; // bool
    uint8_t polling_rate_mode; // 0: 250Hz, 1: 500Hz, 2: real-time
    uint8_t audio_buffer_length; // [16,127]
    uint8_t controller_mode; // 0: DS5, 1: DSE, 2: Auto
    // Auto haptics: derive rumble from game audio (ch1/ch2) even when game sends no haptic commands
    uint8_t auto_haptics_enable;      // 0: off, 1: mix with native haptics, 2: replace native haptics
    uint8_t auto_haptics_gain;        // [0,200] percent applied to derived signal, default 100
    uint16_t auto_haptics_lowpass_hz; // LP cutoff in Hz [20-400], default 80
    uint8_t enable_poweroff_shortcut; // 1: PS+<button> powers off controller, 0: disabled
    uint8_t enable_touchpad;          // 1: touchpad active, 0: touchpad data zeroed (PS+<button> toggles runtime)
    uint8_t poweroff_button;          // ShortcutButton: which button + PS triggers power off (default 3=Triangle)
    uint8_t touchpad_button;          // ShortcutButton: which button + PS toggles touchpad (default 2=Circle)
    uint8_t battery_color_enable;     // 1: change lightbar color based on battery level, 0: disabled
    uint8_t wake_enable;              // 1: power off controller on host sleep + wake host on reconnect, 0: disabled
    uint8_t auto_haptics_mute_replace; // 1: mute speaker when Replace mode active
    uint8_t auto_haptics_mute_mix;     // 1: mute speaker when Mix mode active
    // --- fields below added by the v0.7.2-hotfix upstream merge ---
    uint8_t enable_usb_sn; // 0: disable,1: enable
    uint8_t ps_shortcut_enabled; // 0: disabled, 1: enabled (Xbox Game Bar via HID keyboard)
    uint8_t disable_mic; // bool: 0 enable (default), 1 disable controller mic
    uint8_t disable_speaker; // bool: 0 enable (default), 1 disable speaker/headset
    uint8_t enable_wake; // bool: 0 disabled (default), 1 wake host on PS press (USB remote wakeup)
    uint8_t trigger_reduce; // [0,10] (0: auto)
};

// Button IDs used in poweroff_button / touchpad_button
enum ShortcutButton : uint8_t {
    BTN_SQUARE   = 0,
    BTN_CROSS    = 1,
    BTN_CIRCLE   = 2,
    BTN_TRIANGLE = 3,
    BTN_L1       = 4,
    BTN_R1       = 5,
    BTN_CREATE   = 6,
    BTN_OPTIONS  = 7,
    BTN_MUTE     = 8,
    BTN_SHORTCUT_MAX = BTN_MUTE,
};

struct __attribute__((packed)) Config {
    uint32_t magic;
    uint32_t crc32; // Config_body crc32, only calc and verify when save
    uint16_t size;  // Config_body size
    Config_body body;
};

void config_default();
void config_load();
bool config_save();
Config_body& get_config();
void set_config(const uint8_t *new_config, const uint16_t len);
void config_valid();
void set_config(const Config_body &new_config);
void set_gain(uint8_t value);
extern bool is_dse;

#endif //DS5_BRIDGE_CONFIG_H
