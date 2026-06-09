//
// Created by awalol on 2026/3/4.
//

#include <cstdio>
#include "bsp/board_api.h"
#include "bt.h"
#include "utils.h"
#include "resample.h"
#include "audio.h"
#include "hardware/clocks.h"
#include "hardware/vreg.h"
#include "hardware/watchdog.h"
#include "pico/cyw43_arch.h"
#include "pico/time.h"
#include "state_mgr.h"
#if ENABLE_SERIAL
#include "pico/stdio_usb.h"
#endif
#include "config.h"
#include "cmd.h"
#include "wake.h"
#if ENABLE_BATT_LED
#include "battery_led.h"
#endif
#if ENABLE_BATT_COLOR
#include "battery_color.h"
#endif

// Pico SDK speciifically for waiting on conditions
#include "pico/critical_section.h"

int reportSeqCounter = 0;
uint8_t packetCounter = 0;
bool spk_active = false;
bool touchpad_runtime_enabled = true;

uint8_t interrupt_in_data[63] = {
    0x7f, 0x7d, 0x7f, 0x7e, 0x00, 0x00, 0xa7,
    0x08, 0x00, 0x00, 0x00, 0x52, 0x43, 0x30, 0x41,
    0x01, 0x00, 0x0e, 0x00, 0xef, 0xff, 0x03, 0x03,
    0x7b, 0x1b, 0x18, 0xf0, 0xcc, 0x9c, 0x60, 0x00,
    0xfc, 0x80, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x09, 0x09, 0x00, 0x00, 0x00, 0x00,
    0x00, 0xa7, 0xad, 0x60, 0x00, 0x29, 0x18, 0x00,
    0x53, 0x9f, 0x28, 0x35, 0xa5, 0xa8, 0x0c, 0x8b
};

critical_section_t report_cs;
volatile bool report_dirty = false;

void interrupt_loop() {
    if (!tud_hid_ready()) return;

    // TODO: Refactor for better code reuse
    if (get_config().polling_rate_mode != 2) {
        if (!tud_hid_report(0x01, interrupt_in_data, 63)) {
            printf("[USBHID] tud_hid_report error\n");
        }
        return;
    }

    bool should_send = false;
    // Local buffer to hold the report data while we prepare it to send. 
    uint8_t safe_report[63];


    critical_section_enter_blocking(&report_cs);
    if (report_dirty) {
        memcpy(safe_report, interrupt_in_data, 63);
        report_dirty = false;
        should_send = true;
    }
    critical_section_exit(&report_cs);

    // Only send to TinyUSB if we actually grabbed fresh data
    if (should_send) {
        if (!tud_hid_report(0x01, safe_report, 63)) {
            printf("[USBHID] tud_hid_report error\n");

            // If the report failed to queue, restore the dirty flag 
            // so we try again on the next loop iteration.
            critical_section_enter_blocking(&report_cs);
            report_dirty = true;
            critical_section_exit(&report_cs);
        }
    }
}

// Zero out touchpad data in a 63-byte USB HID input report.
static void suppress_touchpad(uint8_t *report) {
    report[9] &= ~0x02;        // clear ButtonPad (touchpad click)
    memset(report + 32, 0, 9); // zero 9-byte TouchData (finger positions + timestamp)
}

// Byte offset (+mask) for each ShortcutButton in the raw BT report (data[] offset from 0).
// BT report: data[3+7]=face buttons, data[3+8]=shoulder/etc, data[3+9]=PS/Pad/Mute
struct BtnEntry { uint8_t off; uint8_t mask; };
static constexpr BtnEntry SHORTCUT_BTN_MAP[] = {
    {10, 0x10}, // 0: Square
    {10, 0x20}, // 1: Cross
    {10, 0x40}, // 2: Circle
    {10, 0x80}, // 3: Triangle
    {11, 0x01}, // 4: L1
    {11, 0x02}, // 5: R1
    {11, 0x10}, // 6: Create
    {11, 0x20}, // 7: Options
    {12, 0x04}, // 8: Mute
};

static bool shortcut_btn_pressed(const uint8_t *data, uint8_t btn) {
    if (btn > BTN_SHORTCUT_MAX) return false;
    return (data[SHORTCUT_BTN_MAP[btn].off] & SHORTCUT_BTN_MAP[btn].mask) != 0;
}

static void shortcut_btn_suppress(uint8_t *data, uint8_t btn) {
    if (btn > BTN_SHORTCUT_MAX) return;
    data[SHORTCUT_BTN_MAP[btn].off] &= ~SHORTCUT_BTN_MAP[btn].mask;
}

void on_bt_data(CHANNEL_TYPE channel, uint8_t *data, uint16_t len) {
    if (channel == INTERRUPT && data[1] == 0x31) {
        if ((data[56] & 1) != (interrupt_in_data[53] & 1)) {
            set_headset(data[56] & 1);
        }

        // Shortcut detection
        // data[3+7] = byte 7 of USBGetStateData, data[3+9] = byte 9: bit0=PS(Home)
        const bool ps    = (data[12] & 0x01) != 0;
        bool suppress_ps = false;

        // PS + poweroff_button → power off controller
        static bool poweroff_held = false;
        const uint8_t po_btn = get_config().poweroff_button;
        if (get_config().enable_poweroff_shortcut && ps && shortcut_btn_pressed(data, po_btn)) {
            shortcut_btn_suppress(data, po_btn);
            suppress_ps = true;
            if (!poweroff_held) {
                poweroff_held = true;
                bt_disconnect();
                return;
            }
        } else {
            poweroff_held = false;
        }

        // PS + touchpad_button → toggle touchpad (runtime only, no flash write)
        // Only active when enable_touchpad == 1; if disabled, touchpad is always on.
        static bool touchpad_toggle_held = false;
        const uint8_t tp_btn = get_config().touchpad_button;
        if (get_config().enable_touchpad && ps && shortcut_btn_pressed(data, tp_btn)) {
            shortcut_btn_suppress(data, tp_btn);
            suppress_ps = true;
            if (!touchpad_toggle_held) {
                touchpad_toggle_held = true;
                touchpad_runtime_enabled = !touchpad_runtime_enabled;
            }
        } else {
            touchpad_toggle_held = false;
        }

        if (suppress_ps) {
            data[12] &= ~0x01; // suppress PS
        }

        if (get_config().polling_rate_mode != 2) {
            memcpy(interrupt_in_data, data + 3, 63);
            if (!touchpad_runtime_enabled) suppress_touchpad(interrupt_in_data);
#if ENABLE_BATT_LED
            battery_led_note_report();
#endif
#if ENABLE_BATT_COLOR
            battery_color_note_report();
#endif
            return;
        }

        critical_section_enter_blocking(&report_cs);
        memcpy(interrupt_in_data, data + 3, 63);
        if (!touchpad_runtime_enabled) suppress_touchpad(interrupt_in_data);
        report_dirty = true;
        critical_section_exit(&report_cs);
#if ENABLE_BATT_LED
        battery_led_note_report();
#endif
#if ENABLE_BATT_COLOR
        battery_color_note_report();
#endif
    }
}

// Invoked when received GET_REPORT control request
// Application must fill buffer report's content and return its length.
// Return zero will cause the stack to STALL request
uint16_t tud_hid_get_report_cb(uint8_t itf, uint8_t report_id, hid_report_type_t report_type, uint8_t *buffer,
                               uint16_t reqlen) {
    (void) itf;
    (void) report_type;

    if (is_pico_cmd(report_id)) {
        return pico_cmd_get(report_id, buffer, reqlen);
    }

    std::vector<uint8_t> feature_data = get_feature_data(report_id, reqlen);
    if (!feature_data.empty()) {
        uint16_t len = (uint16_t)std::min((size_t)reqlen, feature_data.size() - 1);
        memcpy(buffer, feature_data.data() + 1, len);
        return len;
    }

    // BT feature data not yet cached — return zeros instead of STALLing.
    // hid_playstation calls GET_FEATURE(0x20) during probe; a STALL causes
    // it to fail and leaves the device without a driver.
    memset(buffer, 0, reqlen);
    return reqlen;
}

bool tud_audio_set_itf_cb(uint8_t rhport, tusb_control_request_t const *p_request) {
    (void) rhport;
    uint8_t const itf = tu_u16_low(p_request->wIndex); // wInterface
    uint8_t const alt = tu_u16_low(p_request->wValue); // bAlternateSetting

    if (itf == 1) {
        printf("[AUDIO] Set interface Speaker to alternate setting %d\n", alt);
        if (alt == 0 && spk_active) {
            state_init();
        }
        spk_active = alt;
    }

    return true;
}

// Invoked when received SET_REPORT control request or
// received data on OUT endpoint ( Report ID = 0, Type = 0 )
void tud_hid_set_report_cb(uint8_t itf, uint8_t report_id, hid_report_type_t report_type, uint8_t const *buffer,
                           uint16_t bufsize) {
    (void) itf;
    (void) report_id;
    (void) report_type;
    (void) buffer;
    (void) bufsize;

    if (is_pico_cmd(report_id)) {
        printf("[HID] Receive 0xf6 setting config, funcid:0x%02X\n", buffer[0]);
        pico_cmd_set(report_id, buffer, bufsize);
        return;
    }

    // INTERRUPT OUT
    if (report_id == 0) {
        switch (buffer[0]) {
            case 0x02: {
                state_update(buffer + 1, bufsize - 1);
                uint8_t outputData[78]{};
                outputData[0] = 0x31;
                outputData[1] = reportSeqCounter << 4;
                if (++reportSeqCounter == 256) {
                    reportSeqCounter = 0;
                }
                outputData[2] = 0x10;
                // memcpy(outputData + 3, buffer + 1, bufsize - 1);
                state_set(outputData + 3,sizeof(SetStateData));
                bt_write(outputData, sizeof(outputData));
                break;
            }
        }
    }
    if (report_id == 0x80 ||
        // DSE: Write Profile Block
        report_id == 0x60 ||
        report_id == 0x62 ||
        report_id == 0x61) {
        set_feature_data(report_id, const_cast<uint8_t *>(buffer), bufsize);
        return;
    }
}

// Periodic 0x31 keepalive: the DualSense haptic subsystem times out if no
// output report arrives for a few hundred ms. When a game crashes, HID reports
// stop but audio keeps flowing — this sends state every 20 ms so the actuators
// stay alive and 0x36 audio-haptics continue working.
static void state_keepalive() {
    static uint64_t last_us = 0;
    const uint64_t now = to_us_since_boot(get_absolute_time());
    if (now - last_us < 20000ULL) return;
    last_us = now;

    uint8_t pkt[78]{};
    pkt[0] = 0x31;
    pkt[1] = (uint8_t)(reportSeqCounter << 4);
    if (++reportSeqCounter == 256) reportSeqCounter = 0;
    pkt[2] = 0x10;
    state_set(pkt + 3, sizeof(SetStateData));
    bt_write(pkt, sizeof(pkt));
}

int main() {
    vreg_set_voltage(VREG_VOLTAGE_1_20);
    sleep_ms(1000);
    set_sys_clock_khz(SYS_CLOCK_KHZ, true);

    board_init();
    tusb_rhport_init_t dev_init = {
        .role = TUSB_ROLE_DEVICE,
        .speed = TUSB_SPEED_FULL
    };
    tusb_init(BOARD_TUD_RHPORT, &dev_init);
#if !ENABLE_SERIAL
    tud_disconnect();
#endif
    board_init_after_tusb();
#if ENABLE_SERIAL
    stdio_usb_init();
#endif

    if (cyw43_arch_init()) {
        printf("Failed to initialize CYW43\n");
        return 1;
    }
    cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, false);

#if ENABLE_BATT_LED
    battery_led_init();
#endif
#if ENABLE_BATT_COLOR
    battery_color_init();
#endif

#if !ENABLE_SERIAL
    if (watchdog_caused_reboot()) {
        printf("Rebooted by Watchdog!\n");
        // 当崩溃重启以后，闪三下灯
        for (int i = 0; i < 6; i++) {
            if (i % 2 == 0) {
                cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, true);
            } else {
                cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, false);
            }
            sleep_ms(500);
        }
    } else {
        printf("Clean boot\n");
    }
#endif

    // Initialize the critical section for the report buffer
    critical_section_init(&report_cs);

    config_load();
    // Touchpad always starts active; enable_touchpad controls whether the PS+button
    // shortcut is available (1 = shortcut enabled, 0 = touchpad always on, no toggle).
    touchpad_runtime_enabled = true;

    wake_init();

    bt_init();
    bt_register_data_callback(on_bt_data);

    audio_init();
    state_init();

#if !ENABLE_SERIAL
    watchdog_enable(1000, true);
#endif

    while (1) {
#if !ENABLE_SERIAL
        watchdog_update();
#endif
        cyw43_arch_poll();
        tud_task();
        audio_loop();
        interrupt_loop();
        if (spk_active) state_keepalive();
#if ENABLE_BATT_LED
        battery_led_tick();
#endif
#if ENABLE_BATT_COLOR
        battery_color_tick();
#endif
    }
}
