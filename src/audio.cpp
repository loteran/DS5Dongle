//
// Created by awalol on 2026/3/5.
//

#include "audio.h"
#include "bt.h"
#include "resample.h"
#include "tusb.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include "opus.h"
#include "utils.h"
#include "pico/multicore.h"
#include "pico/time.h"
#include "pico/util/queue.h"
#include "config.h"
#include "state_mgr.h"
#include "usb.h"

#define INPUT_CHANNELS    4
#define OUTPUT_CHANNELS   2
#define SAMPLE_SIZE       64
#define REPORT_SIZE       398
#define REPORT_ID         0x36
// #define VOLUME_GAIN       2
// #define BUFFER_LENGTH     48

using std::clamp;
using std::max;

static uint8_t reportSeqCounter = 0;
static uint8_t packetCounter = 0;
static bool plug_headset = false;
alignas(8) static uint32_t audio_core1_stack[8192];

extern bool spk_active;
static uint64_t audio_last_us = 0;
queue_t audio_fifo;
static uint8_t opus_buf[200];
critical_section_t opus_cs;

struct audio_raw_element {
    float data[512 * 2];
};

void set_headset(bool state) {
    plug_headset = state;
}

void __not_in_flash_func(audio_loop)() {
    // 1. 读取 USB 音频数据
    if (!tud_audio_available()) {
        // If spk_active is stuck (e.g. game crash without proper USB teardown),
        // reset it after 2 s of silence so the HID haptics path can resume.
        if (spk_active && audio_last_us != 0) {
            uint64_t now = to_us_since_boot(get_absolute_time());
            if (now - audio_last_us > 2000000ULL) {
                printf("[Audio] No audio for 2s, clearing spk_active\n");
                state_init();
                spk_active = false;
                audio_last_us = 0;
            }
        }
        return;
    }
    audio_last_us = to_us_since_boot(get_absolute_time());

    int16_t raw[192];
    uint32_t bytes_read = tud_audio_read(raw, sizeof(raw)); // 每次读入 384 bytes
    // Detect actual channel count from packet size:
    // 4ch@48kHz ≈ 384 bytes/ms (Linux/PipeWire), 2ch@48kHz ≈ 192 bytes/ms (Windows/Stereo Mix)
    const int actual_ch = (bytes_read > 250) ? 4 : 2;
    int frames = bytes_read / (actual_ch * (int)sizeof(int16_t));
    if (frames == 0) {
        return;
    }

    static float audio_buf[512 * 2];
    static uint audio_buf_pos = 0;

    const uint8_t auto_mode  = get_config().auto_haptics_enable;
    const bool auto_mute     = ((auto_mode == 2 || actual_ch == 2) && get_config().auto_haptics_mute_replace) ||
                               (auto_mode == 1 && get_config().auto_haptics_mute_mix);
    const float audio_gain   = (mute[0] || auto_mute) ? 0.0f : powf(10.0f, get_config().speaker_volume / 20.0f);
    const float haptics_gain = get_config().haptics_gain;
    // For 2ch mode (Windows/Stereo Mix), always enable auto-haptics DSP regardless of auto_mode setting
    const float auto_gain    = (auto_mode > 0 || actual_ch == 2) ? (get_config().auto_haptics_gain / 100.0f) * haptics_gain : 0.0f;

    const float lp_fc = (float)get_config().auto_haptics_lowpass_hz;
    const float lp_a = 1.0f - expf(-2.0f * M_PI * lp_fc / 48000.0f);

    // Persistent DSP state across calls
    static float lp_l = 0.0f,  lp_r = 0.0f;     // 1-pole LP memory (speaker ch0/1)
    static float lp_h_l = 0.0f, lp_h_r = 0.0f;  // 1-pole LP memory (native haptic ch2/3, Mix mode)
    static float env_l = 0.0f, env_r = 0.0f;    // envelope follower memory
    // Attack ~1 ms, release ~80 ms (values are per-frame at 48 kHz, not per-sample)
    constexpr float ENV_ATK = 0.40f;
    constexpr float ENV_REL = 0.025f;

    static int8_t haptic_buf[SAMPLE_SIZE];
    static int haptic_buf_pos = 0;
    // 48kHz -> 3kHz is a fixed 16:1 ratio. Emitting every 16th sample directly
    // instead of running the whole block through the WDL_Resampler's polyphase
    // filter removes the single most expensive step in this per-sample loop.
    // The haptics channel is felt, not heard (a "thump", not audio playback),
    // so the resampler's interpolation quality buys nothing here. This used to
    // take long enough per audio_loop() call, under sustained real audio (e.g.
    // the PC-side auto-haptics PipeWire loopback playing actual game sound),
    // to delay how often the main loop gets back to cyw43_arch_poll() --
    // felt as Bluetooth controller input lag. See project history for the
    // full diagnosis; a core1-offload alternative was tried and made the lag
    // worse (added a per-call cross-core critical section to the same hot
    // path), so it was reverted in favor of this cheaper inline approach.
    static uint8_t haptic_phase = 0;

    for (int i = 0; i < frames; i++) {
 #if !DISABLE_SPEAKER_PROC
        audio_buf[audio_buf_pos++] = raw[i * actual_ch] / 32768.0f * audio_gain;
        audio_buf[audio_buf_pos++] = raw[i * actual_ch + 1] / 32768.0f * audio_gain;
        if (audio_buf_pos == 512 * 2) {
            static audio_raw_element element{};
            memcpy(element.data, audio_buf, 512 * 2 * 4);
            if (queue_is_full(&audio_fifo)) {
                queue_try_remove(&audio_fifo,NULL);
            }
            if (!queue_try_add(&audio_fifo, &element)) {
                printf("[Audio] Warning: audio_fifo add failed\n");
            }
            audio_buf_pos = 0;
        }
#endif
        // 4ch mode (Linux): use dedicated haptic channels ch2/ch3
        // 2ch mode (Windows): no dedicated haptic channels, DSP will derive from ch0/ch1 below
        float h_l = (actual_ch == 4) ? raw[i * 4 + 2] / 32768.0f * haptics_gain : 0.0f;
        float h_r = (actual_ch == 4) ? raw[i * 4 + 3] / 32768.0f * haptics_gain : 0.0f;

        if (auto_mode > 0 || actual_ch == 2) {
            // Low-pass filter speaker audio — keep only bass felt by actuators
            const float spk_l = raw[i * actual_ch    ] / 32768.0f;
            const float spk_r = raw[i * actual_ch + 1] / 32768.0f;
            lp_l += lp_a * (spk_l - lp_l);
            lp_r += lp_a * (spk_r - lp_r);

            // Envelope follower — fast attack captures gunshots/footsteps, slow release gives body
            const float abs_l = lp_l < 0.0f ? -lp_l : lp_l;
            const float abs_r = lp_r < 0.0f ? -lp_r : lp_r;
            env_l = (abs_l > env_l) ? env_l + ENV_ATK * (abs_l - env_l)
                                    : env_l + ENV_REL * (abs_l - env_l);
            env_r = (abs_r > env_r) ? env_r + ENV_ATK * (abs_r - env_r)
                                    : env_r + ENV_REL * (abs_r - env_r);

            // Modulate LP signal by envelope to get a thumping waveform,
            // then soft-clip with tanh approximation (x / (1 + |x|), avoids tanhf cost)
            float al = lp_l * (1.0f + 3.0f * env_l) * auto_gain;
            float ar = lp_r * (1.0f + 3.0f * env_r) * auto_gain;
            al = al / (1.0f + (al < 0.0f ? -al : al));
            ar = ar / (1.0f + (ar < 0.0f ? -ar : ar));

            if (auto_mode == 2 || actual_ch == 2) {
                // Replace mode: use only derived signal (also forced for 2ch/Windows mode)
                h_l = al;
                h_r = ar;
            } else {
                // Mix mode: LP-filter native haptic channels before mixing to prevent
                // full-band audio leaking to actuators when ch2/3 mirror ch0/1
                // (e.g. Windows/VoiceMeeter routing 4ch with duplicated stereo)
                lp_h_l += lp_a * (h_l - lp_h_l);
                lp_h_r += lp_a * (h_r - lp_h_r);
                float m_l = lp_h_l + al;
                float m_r = lp_h_r + ar;
                h_l = m_l / (1.0f + (m_l < 0.0f ? -m_l : m_l));
                h_r = m_r / (1.0f + (m_r < 0.0f ? -m_r : m_r));
            }
        }

        // Emit only every 16th sample (48kHz -> 3kHz), directly as int8 — no
        // resampler involved. See the note above the loop for why.
        if (++haptic_phase < 16) {
            continue;
        }
        haptic_phase = 0;

        int val_l = static_cast<int>(clamp(h_l, -1.0f, 1.0f) * 127.0f);
        int val_r = static_cast<int>(clamp(h_r, -1.0f, 1.0f) * 127.0f);
        haptic_buf[haptic_buf_pos++] = (int8_t) clamp(val_l, -128, 127);
        haptic_buf[haptic_buf_pos++] = (int8_t) clamp(val_r, -128, 127);

        if (haptic_buf_pos != SAMPLE_SIZE) {
            continue;
        }
        uint8_t pkt[REPORT_SIZE]{};
        pkt[0] = REPORT_ID;
        pkt[1] = reportSeqCounter << 4;
        reportSeqCounter = (reportSeqCounter + 1) & 0x0F;
        pkt[2] = 0x11 | 0 << 6 | 1 << 7;
        pkt[3] = 7;
        pkt[4] = 0b11111110;
        const auto buf_len = get_config().audio_buffer_length;
        pkt[5] = buf_len;
        pkt[6] = buf_len;
        pkt[7] = buf_len;
        pkt[8] = buf_len;
        pkt[9] = buf_len;
        pkt[10] = packetCounter++;
        // SetStateData
        pkt[11] = 0x10 | 0 << 6 | 1 << 7;
        pkt[12] = 63;
        state_set(pkt + 13, 63);
        // Haptics Audio Data
        pkt[76] = 0x12 | 0 << 6 | 1 << 7;
        pkt[77] = SAMPLE_SIZE;
        memcpy(pkt + 78, haptic_buf, SAMPLE_SIZE);
#if !DISABLE_SPEAKER_PROC
        // Speaker Audio Data
        pkt[142] = (plug_headset ? 0x16 : 0x13) | 0 << 6 | 1 << 7; // Speaker: 0x13
        // L Headset Mono: 0x14
        // L Headset R Speaker: 0x15
        // Headset: 0x16
        pkt[143] = 200;
        critical_section_enter_blocking(&opus_cs);
        memcpy(pkt + 144, opus_buf, 200);
        critical_section_exit(&opus_cs);
#endif

        bt_write(pkt, sizeof(pkt));
        haptic_buf_pos = 0;
    }
}

void audio_init() {
 #if !DISABLE_SPEAKER_PROC
    queue_init(&audio_fifo, sizeof(audio_raw_element), 2);
    critical_section_init(&opus_cs);
    multicore_launch_core1_with_stack(core1_entry, audio_core1_stack, sizeof(audio_core1_stack));
#endif
}

static OpusEncoder *encoder;
static WDL_Resampler resampler_audio;

void __not_in_flash_func(core1_entry)() {
    int error = 0;
    encoder = opus_encoder_create(48000, 2,OPUS_APPLICATION_AUDIO, &error);
    if (error != 0) {
        printf("[Audio] OpusEncoder create failed\n");
        return;
    }
    opus_encoder_ctl(encoder,OPUS_SET_EXPERT_FRAME_DURATION(OPUS_FRAMESIZE_10_MS));
    opus_encoder_ctl(encoder,OPUS_SET_BITRATE(200 * 8 * 100));
    opus_encoder_ctl(encoder,OPUS_SET_VBR(false));
    opus_encoder_ctl(encoder,OPUS_SET_COMPLEXITY(0)); // max 4
    resampler_audio.SetMode(true, 0, false);
    resampler_audio.SetRates(51200, 48000);
    resampler_audio.SetFeedMode(true);
    resampler_audio.Prealloc(2, 512, 480);

    while (true) {
        static audio_raw_element audio_element{};
        queue_remove_blocking(&audio_fifo, &audio_element);
        // 将 512 frames 重采样成 480 frames 以解决噪音问题。感谢 @Junhoo
        WDL_ResampleSample *in_buf;
        int nframes = resampler_audio.ResamplePrepare(512, 2, &in_buf);
        for (int i = 0; i < nframes * 2; i++) {
            in_buf[i] = audio_element.data[i];
        }
        static WDL_ResampleSample out_buf[480 * 2];
        resampler_audio.ResampleOut(out_buf, nframes, 480, 2);

        static uint8_t out[200];
        (void) opus_encode_float(encoder, out_buf, 480, out, 200);
        critical_section_enter_blocking(&opus_cs);
        memcpy(opus_buf, out, 200);
        critical_section_exit(&opus_cs);
    }
}
