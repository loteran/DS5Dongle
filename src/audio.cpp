//
// Created by awalol on 2026/3/5.
//

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

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
#include "pico/platform.h"
#include "pico/flash.h"
#include "pico/util/queue.h"
#include "config.h"
#include "state_mgr.h"
#include "usb.h"

#define INPUT_CHANNELS    4
#define OUTPUT_CHANNELS   2
#define SAMPLE_SIZE       64
#define REPORT_SIZE       398
#define REPORT_ID         0x36
#define MIC_CHANNELS      1
#define MIC_FRAMES        480
#define MIC_OPUS_SIZE     71   // bytes per opus-encoded mic frame from the DualSense

using std::clamp;
using std::max;

// Haptics 48 kHz -> 3 kHz resampler. Now core1-only (see haptics_proc()); core0
// never touches it, so it needs no cross-core protection.
static WDL_Resampler resampler;
static uint8_t reportSeqCounter = 0;
static uint8_t packetCounter = 0;
static bool plug_headset = false;
static bool mic_active = false; // host has opened the mic IN interface (alt != 0)
alignas(8) static uint32_t audio_core1_stack[8192];
queue_t audio_fifo;
queue_t mic_fifo;
queue_t mic_decode_fifo;
static uint8_t opus_buf[200];
critical_section_t opus_cs;

struct audio_raw_element {
    float data[512 * 2];
};
struct mic_element {
    uint8_t data[MIC_OPUS_SIZE];
};
struct mic_decode_element {
    int16_t data[MIC_FRAMES * MIC_CHANNELS];
    uint16_t len;
};

// Raw USB audio captured by one audio_loop() call, handed to core1's
// haptics_proc() for the auto-haptics DSP + resample. Offloading this off
// core0 keeps its cyw43_arch_poll()/tud_task() loop free of audio-processing
// jitter -- that work used to delay Bluetooth HID servicing under sustained
// audio load, felt as controller input lag in games with continuous
// audio-reactive haptics (e.g. Rocket League via the PC-side PipeWire
// loopback, which only started reliably reaching the Pico once its capture
// bug was fixed -- see project history for the full diagnosis).
struct haptics_raw_element {
    int16_t raw[192];
    int frames;
    int actual_ch;
};
queue_t haptics_raw_fifo;

// core1 -> core0 handoff for the finished 64-byte haptics chunk, mirroring the
// opus_buf/opus_cs pattern already used for the speaker path. core0 still owns
// building the BT report and calling bt_write() -- bt_write()'s internal
// staging buffer is a single shared static, safe under repeated calls from one
// core but not proven safe for two cores calling it concurrently, so only
// core0 ever calls it. haptic_buf_seq lets core0 tell a fresh chunk from one
// it already sent.
static int8_t haptic_buf_shared[SAMPLE_SIZE]{};
static uint32_t haptic_buf_seq = 0;
critical_section_t haptics_cs;

void set_headset(bool state) {
    plug_headset = state;
}

// Called from tud_audio_set_itf_cb when the host opens/closes the mic IN
// interface. Gates controller-mic streaming so it only runs while recording.
void set_mic_active(bool active) {
    mic_active = active;
    update_mic_status();
}

bool audio_mic_active() {
    return mic_active;
}

void update_mic_status() {
    uint8_t pkt[142]{};
    pkt[0] = 0x32;
    pkt[1] = reportSeqCounter << 4;
    reportSeqCounter = (reportSeqCounter + 1) & 0x0F;
    pkt[2] = 0x11 | 0 << 6 | 1 << 7;
    pkt[3] = 7;
    pkt[4] = (mic_active && !get_config().disable_mic) ? 0b11111111 : 0b11111110;
    const auto buf_len = get_config().audio_buffer_length;
    pkt[5] = buf_len;
    pkt[6] = buf_len;
    pkt[7] = buf_len;
    pkt[8] = buf_len;
    pkt[9] = buf_len;
    pkt[10] = packetCounter++;
    bt_write(pkt,sizeof(pkt));
}

void __not_in_flash_func(audio_loop)() {
    const Config_body &cfg = get_config();
    const bool mic_enabled = mic_active && !cfg.disable_mic;
    const bool speaker_enabled = !cfg.disable_speaker;

    // Mic playback: drain decoded mic PCM into the USB IN endpoint
    static mic_decode_element mic_pb{};
    if (queue_try_remove(&mic_decode_fifo, &mic_pb)) {
        if (mic_enabled) {
            // The controller mic is mono, but the USB descriptor presents a 2-channel
            // mic (matching the real DS5) so Windows doesn't conflict with its cached
            // DS5 audio format. Pack each mono int16 sample as L/R in one 32-bit word.
            static uint32_t mic_stereo[MIC_FRAMES];
            const int mono_samples = mic_pb.len / 2;
            for (int i = 0; i < mono_samples; i++) {
                const uint16_t sample = static_cast<uint16_t>(mic_pb.data[i]);
                mic_stereo[i] = static_cast<uint32_t>(sample) | (static_cast<uint32_t>(sample) << 16);
            }
            const uint16_t stereo_len = (uint16_t) (mono_samples * sizeof(uint32_t));
            uint16_t written = tud_audio_write(mic_stereo, stereo_len);
            if (written != stereo_len) {
                // Gated behind ENABLE_VERBOSE: when the host has not opened the mic
                // interface (the common case -- most games never do) tud_audio_write
                // short-writes every frame, so an unconditional log would flood
                // core0's hot path with the newlib formatting chain.
#if ENABLE_VERBOSE
                printf("[Audio] Warning: USB mic FIFO wrote %u/%u bytes\n", written, stereo_len);
#endif
            }
        }
    }

    // 1. 读取 USB 音频数据
    if (!tud_audio_available()) return;

    int16_t raw[192];
    uint32_t bytes_read = tud_audio_read(raw, sizeof(raw)); // 每次读入至多 384 bytes
    // Detect actual channel count from packet size:
    // 4ch@48kHz ~= 384 bytes/ms (Linux/PipeWire, dedicated haptic channels
    // ch3/ch4), 2ch@48kHz ~= 192 bytes/ms (Windows/Stereo Mix, no dedicated
    // haptic channels -- haptics_proc() derives haptics from ch1/2 directly).
    const int actual_ch = (bytes_read > 250) ? 4 : 2;
    int frames = bytes_read / (actual_ch * (int) sizeof(int16_t));
    if (frames == 0) {
        return;
    }

#if !DISABLE_SPEAKER_PROC
    // Mirrors the mute decision haptics_proc() makes for the DSP: mute the
    // physical speaker/headset feed while an auto-haptics mode the user asked
    // to be silent is deriving its "thump" from this same audio, so it isn't
    // also heard at full volume out loud. Cheap (a few config reads), so it's
    // fine to recompute per call rather than pass it cross-core.
    const uint8_t auto_mode = cfg.auto_haptics_enable;
    const bool auto_mute = ((auto_mode == 2 || actual_ch == 2) && cfg.auto_haptics_mute_replace) ||
                            (auto_mode == 1 && cfg.auto_haptics_mute_mix);
    static float audio_buf[512 * 2];
    static uint audio_buf_pos = 0;
    if (!speaker_enabled || auto_mute) {
        audio_buf_pos = 0;
        while (queue_try_remove(&audio_fifo, NULL)) {}
    } else {
        for (int i = 0; i < frames; i++) {
            audio_buf[audio_buf_pos++] = raw[i * actual_ch] / 32768.0f;
            audio_buf[audio_buf_pos++] = raw[i * actual_ch + 1] / 32768.0f;
            if (audio_buf_pos == 512 * 2) {
                static audio_raw_element element{};
                memcpy(element.data, audio_buf, 512 * 2 * 4);
                if (queue_is_full(&audio_fifo)) {
                    queue_try_remove(&audio_fifo, NULL);
                }
                if (!queue_try_add(&audio_fifo, &element)) {
                    printf("[Audio] Warning: audio_fifo add failed\n");
                }
                audio_buf_pos = 0;
            }
        }
    }
#endif

    // Hand the raw block to core1's haptics_proc() instead of running the
    // auto-haptics DSP + resample inline here.
    static haptics_raw_element hr_elem;
    memcpy(hr_elem.raw, raw, bytes_read);
    hr_elem.frames = frames;
    hr_elem.actual_ch = actual_ch;
    if (queue_is_full(&haptics_raw_fifo)) {
        queue_try_remove(&haptics_raw_fifo, NULL);
    }
    queue_try_add(&haptics_raw_fifo, &hr_elem);

    // Pick up whatever core1 has finished since the last report we sent. Only
    // send when it's actually new -- core1 can (rarely, e.g. after a burst)
    // finish more than one 64-byte chunk between two audio_loop() calls; we
    // only see/send the latest one, silently dropping the rest. That's an
    // acceptable trade for a felt-not-heard channel, and it can only happen
    // when core1 is keeping up faster than core0 is polling, i.e. never under
    // the load patterns that motivated this split in the first place.
    static uint32_t last_sent_seq = 0;
    static int8_t haptic_buf[SAMPLE_SIZE];
    uint32_t seq;
    critical_section_enter_blocking(&haptics_cs);
    seq = haptic_buf_seq;
    if (seq != last_sent_seq) {
        memcpy(haptic_buf, haptic_buf_shared, SAMPLE_SIZE);
    }
    critical_section_exit(&haptics_cs);
    if (seq == last_sent_seq) {
        return;
    }
    last_sent_seq = seq;

    uint8_t pkt[REPORT_SIZE]{};
    pkt[0] = REPORT_ID;
    pkt[1] = reportSeqCounter << 4;
    reportSeqCounter = (reportSeqCounter + 1) & 0x0F;
    pkt[2] = 0x11 | 0 << 6 | 1 << 7;
    pkt[3] = 7;
    // bit0 enables controller mic streaming. Gate it on the host actually
    // opening the mic IN interface (set_mic_active from tud_audio_set_itf_cb)
    // AND on the user not disabling the mic (config.disable_mic), so the
    // DualSense only streams mic audio -- and core1 only decodes it -- while
    // an app is recording. Other bits (speaker/haptics) stay enabled.
    pkt[4] = mic_enabled ? 0b11111111 : 0b11111110;
    const auto buf_len = cfg.audio_buffer_length;
    pkt[5] = buf_len;
    pkt[6] = buf_len;
    pkt[7] = buf_len;
    pkt[8] = buf_len; // 这 4 个字节的作用未知，调整没有效果
    pkt[9] = buf_len; // audio buffer length 只有调整这个字节生效。
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
    // Speaker Audio Data -- omitted entirely when the user disables the
    // speaker/headset (config.disable_speaker), so the controller's speaker
    // amp isn't driven (mirrors the Pico W no-speaker report).
    if (speaker_enabled) {
        pkt[142] = (plug_headset ? 0x16 : 0x13) | 0 << 6 | 1 << 7; // Speaker: 0x13
        // L Headset Mono: 0x14
        // L Headset R Speaker: 0x15
        // Headset: 0x16
        pkt[143] = 200;
        critical_section_enter_blocking(&opus_cs);
        memcpy(pkt + 144, opus_buf, 200);
        critical_section_exit(&opus_cs);
    }
#endif

    bt_write(pkt, sizeof(pkt));
}

void audio_init() {
    resampler.SetMode(true, 0, false);
    resampler.SetRates(48000, 3000);
    resampler.SetFeedMode(true);
    resampler.Prealloc(2, 24, 6);
    // Mic and haptics queues are read from audio_loop on core0 every
    // iteration, so they must exist regardless of the speaker-proc build flag.
    queue_init(&mic_fifo, sizeof(mic_element), 2);
    queue_init(&mic_decode_fifo, sizeof(mic_decode_element), 2);
    queue_init(&haptics_raw_fifo, sizeof(haptics_raw_element), 2);
    critical_section_init(&haptics_cs);
#if !DISABLE_SPEAKER_PROC
    queue_init(&audio_fifo, sizeof(audio_raw_element), 2);
    critical_section_init(&opus_cs);
#endif
    // core1 now also runs haptics_proc() and mic_proc() (mic decode), so it
    // must launch even when speaker processing is compiled out.
    multicore_launch_core1_with_stack(core1_entry, audio_core1_stack, sizeof(audio_core1_stack));
}

static OpusEncoder *encoder;
static OpusDecoder *decoder; // mic decoder
static WDL_Resampler resampler_audio;

// Speaker path: USB OUT PCM (core0 audio_fifo) -> resample -> opus encode ->
// opus_buf for the haptics/speaker BT report. Non-blocking so core1 can also
// service the mic and haptics paths. Kept in RAM to remove XIP miss latency
// from the loop.
static void __not_in_flash_func(speaker_proc)() {
    static audio_raw_element audio_element{};
    if (!queue_try_remove(&audio_fifo, &audio_element)) {
        return;
    }
    if (get_config().disable_speaker) {
        return;
    }
    // 将 512 frames 重采样成 480 frames 以解决噪音问题。感谢 @Junhoo
    WDL_ResampleSample *in_buf;
    int nframes = resampler_audio.ResamplePrepare(512, 2, &in_buf);
    for (int i = 0; i < nframes * 2; i++) {
        in_buf[i] = audio_element.data[i];
    }
    static WDL_ResampleSample out_buf[480 * 2];
    resampler_audio.ResampleOut(out_buf, nframes, 480, 2);

    static uint8_t out[200];
    const int encoded_len = opus_encode_float(encoder, out_buf, 480, out, sizeof(out));
    if (encoded_len <= 0) {
#if ENABLE_VERBOSE
        printf("[Audio] OpusEncoder encode failed: %d\n", encoded_len);
#endif
        return;
    }
    critical_section_enter_blocking(&opus_cs);
    memcpy(opus_buf, out, encoded_len);
    if (encoded_len < (int) sizeof(opus_buf)) {
        memset(opus_buf + encoded_len, 0, sizeof(opus_buf) - encoded_len);
    }
    critical_section_exit(&opus_cs);
}

// Mic path: opus packets from the controller (core0 mic_fifo) -> opus decode ->
// PCM into mic_decode_fifo for audio_loop to push to the USB IN endpoint.
static void __not_in_flash_func(mic_proc)() {
    static mic_element mic_packet{};
    if (!queue_try_remove(&mic_fifo, &mic_packet)) {
        return;
    }
    if (!mic_active || get_config().disable_mic) {
        return;
    }
    static mic_decode_element decode_element{};
    auto decoded_samples = opus_decode(decoder, mic_packet.data, MIC_OPUS_SIZE, decode_element.data, MIC_FRAMES, false);
    if (decoded_samples <= 0) {
        // Gated behind ENABLE_VERBOSE: printf pulls the newlib formatting chain
        // (flash) onto core1's path. Release builds compile it out so core1's
        // audio loop stays fully RAM-resident (no XIP fetches on this core).
#if ENABLE_VERBOSE
        printf("[Audio] OpusDecoder decode failed: %d\n", decoded_samples);
#endif
        return;
    }
    decode_element.len = decoded_samples * MIC_CHANNELS * sizeof(int16_t);
    if (queue_is_full(&mic_decode_fifo)) {
        queue_try_remove(&mic_decode_fifo, NULL);
    }
    queue_try_add(&mic_decode_fifo, &decode_element);
}

// Haptics path: raw USB audio from core0 (haptics_raw_fifo) -> auto-haptics
// DSP (LP filter + envelope follower + soft-clip, deriving a felt "thump" from
// the game's bass/impact audio) -> 48 kHz -> 3 kHz resample -> int8 pack ->
// handed to core0 via haptic_buf_shared/haptics_cs for the actual BT report.
// This is the work that used to run inline in audio_loop() on core0 and delay
// cyw43_arch_poll(); moving it here is the fix.
static void __not_in_flash_func(haptics_proc)() {
    static haptics_raw_element elem;
    if (!queue_try_remove(&haptics_raw_fifo, &elem)) {
        return;
    }

    const int16_t *raw = elem.raw;
    const int frames = elem.frames;
    const int actual_ch = elem.actual_ch;

    WDL_ResampleSample *in_buf;
    int nframes = resampler.ResamplePrepare(frames, OUTPUT_CHANNELS, &in_buf);

    const uint8_t auto_mode  = get_config().auto_haptics_enable;
    const float haptics_gain = get_config().haptics_gain;
    // For 2ch mode (Windows/Stereo Mix), always enable auto-haptics DSP regardless of auto_mode setting
    const float auto_gain    = (auto_mode > 0 || actual_ch == 2) ? (get_config().auto_haptics_gain / 100.0f) * haptics_gain : 0.0f;

    const float lp_fc = (float) get_config().auto_haptics_lowpass_hz;
    const float lp_a = 1.0f - expf(-2.0f * (float) M_PI * lp_fc / 48000.0f);

    // Persistent DSP state across calls -- core1-only now, so no locking needed.
    static float lp_l = 0.0f, lp_r = 0.0f;      // 1-pole LP memory (speaker ch0/1)
    static float lp_h_l = 0.0f, lp_h_r = 0.0f;  // 1-pole LP memory (native haptic ch2/3, Mix mode)
    static float env_l = 0.0f, env_r = 0.0f;    // envelope follower memory
    // Attack ~1 ms, release ~80 ms (values are per-frame at 48 kHz, not per-sample)
    constexpr float ENV_ATK = 0.40f;
    constexpr float ENV_REL = 0.025f;

    for (int i = 0; i < nframes; i++) {
        // 4ch mode (Linux): use dedicated haptic channels ch2/ch3
        // 2ch mode (Windows): no dedicated haptic channels, DSP will derive from ch0/ch1 below
        float h_l = (actual_ch == 4) ? raw[i * 4 + 2] / 32768.0f * haptics_gain : 0.0f;
        float h_r = (actual_ch == 4) ? raw[i * 4 + 3] / 32768.0f * haptics_gain : 0.0f;

        if (auto_mode > 0 || actual_ch == 2) {
            // Low-pass filter speaker audio -- keep only bass felt by actuators
            const float spk_l = raw[i * actual_ch    ] / 32768.0f;
            const float spk_r = raw[i * actual_ch + 1] / 32768.0f;
            lp_l += lp_a * (spk_l - lp_l);
            lp_r += lp_a * (spk_r - lp_r);

            // Envelope follower -- fast attack captures gunshots/footsteps, slow release gives body
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

        in_buf[i * 2]     = static_cast<WDL_ResampleSample>(clamp(h_l, -1.0f, 1.0f));
        in_buf[i * 2 + 1] = static_cast<WDL_ResampleSample>(clamp(h_r, -1.0f, 1.0f));
    }

    // 48kHz -> 3kHz 重采样
    static WDL_ResampleSample out_buf[SAMPLE_SIZE]; // 64 floats = 32帧 × 2ch
    const int out_frames = resampler.ResampleOut(out_buf, nframes, nframes / 4, OUTPUT_CHANNELS);

    static int8_t haptic_buf[SAMPLE_SIZE];
    static int haptic_buf_pos = 0;

    for (int i = 0; i < out_frames; i++) {
        int val_l = static_cast<int>(out_buf[i * 2] * 127.0f);
        int val_r = static_cast<int>(out_buf[i * 2 + 1] * 127.0f);
        haptic_buf[haptic_buf_pos++] = (int8_t) clamp(val_l, -128, 127);
        haptic_buf[haptic_buf_pos++] = (int8_t) clamp(val_r, -128, 127);

        if (haptic_buf_pos != SAMPLE_SIZE) {
            continue;
        }
        critical_section_enter_blocking(&haptics_cs);
        memcpy(haptic_buf_shared, haptic_buf, SAMPLE_SIZE);
        haptic_buf_seq++;
        critical_section_exit(&haptics_cs);
        haptic_buf_pos = 0;
    }
}

void __not_in_flash_func(core1_entry)() {
    // Register core1 as a flash-safe victim so core0's flash_safe_execute() really
    // parks this core while flash is accessed, instead of letting it fault on XIP.
    // Used by config_save() (flash erase/program) and the BOOTSEL poll (which briefly
    // floats QSPI CSn) - the latter makes polling BOOTSEL safe while audio streams on
    // core1. Requires PICO_FLASH_ASSUME_CORE1_SAFE=0.
    flash_safe_execute_core_init();
    int error = 0;
    encoder = opus_encoder_create(48000, 2,OPUS_APPLICATION_RESTRICTED_LOWDELAY, &error);
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
    decoder = opus_decoder_create(48000, MIC_CHANNELS, &error);
    if (error != 0) {
        printf("[Audio] OpusDecoder create failed\n");
    }

    while (true) {
        speaker_proc();
        mic_proc();
        haptics_proc();
    }
}

// data points at the opus mic payload, len is the bytes available there.
// In RAM (consistent with the BT-receive path) and validates len so a short
// or malformed report can't over-read past the packet buffer.
void __not_in_flash_func(mic_add_queue)(uint8_t *data, uint16_t len) {
    if (!mic_active || get_config().disable_mic) return;
    if (len < MIC_OPUS_SIZE) return;
    static mic_element mic_packet{};
    memcpy(mic_packet.data, data, MIC_OPUS_SIZE);
    if (queue_is_full(&mic_fifo)) {
        queue_try_remove(&mic_fifo, NULL);
    }
    queue_try_add(&mic_fifo, &mic_packet);
}
