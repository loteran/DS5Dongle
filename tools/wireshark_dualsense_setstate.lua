--[[
  DualSense SetStateData dissector (Wireshark Lua plugin)
  ----------------------------------------------------------------------------
  Parses DualSense USB output reports whose byte 0 (HID Report ID) == 0x02.
  Byte 0 is the Report ID; everything after it is the 47-byte `SetStateData`
  structure from duaLib/src/include/dataStructures.h, which is decoded field
  by field (including bitfields).

  This is a post-dissector: it runs after Wireshark's USB/HID dissection and
  picks up the report payload from `usbhid.data` (falling back to
  `usb.capdata`). It therefore works on USBPcap captures without needing the
  device's HID report descriptor.

  Install: copy this file into your Wireshark "Personal Lua Plugins" folder
  (Help > About Wireshark > Folders), then restart Wireshark or press
  Analyze > Reload Lua Plugins (Ctrl+Shift+L).

  Filter examples:
    dualsense                      -- only 0x02 SetState reports
    dualsense.led_red == 255
    dualsense.flags.allow_led_color == 1
    dualsense.rumble_emulation_left > 0
--]]

local p_ds = Proto("dualsense", "DualSense Output Report (SetStateData)")

----------------------------------------------------------------------------
-- Value strings (enums from dataStructures.h)
----------------------------------------------------------------------------
local YESNO = { [0] = "No", [1] = "Yes" }

local VS_MUTELIGHT = {
    [0] = "Off", [1] = "On", [2] = "Breathing", [3] = "DoNothing (ignored)",
    [4] = "NoAction4", [5] = "NoAction5", [6] = "NoAction6", [7] = "NoAction7",
}
local VS_BRIGHTNESS = {
    [0] = "Bright", [1] = "Mid", [2] = "Dim", [3] = "NoAction3",
    [4] = "NoAction4", [5] = "NoAction5", [6] = "NoAction6", [7] = "NoAction7",
}
local VS_FADE = { [0] = "Nothing", [1] = "FadeIn (black->blue)", [2] = "FadeOut (blue->black)" }
local VS_MICSELECT = { [0] = "Auto", [1] = "Internal Only", [2] = "External Only", [3] = "Unclear (3)" }
local VS_OUTPATH = { [0] = "L_R_X", [1] = "L_L_X", [2] = "L_L_R", [3] = "X_X_R" }
local VS_INPATH = { [0] = "CHAT_ASR", [1] = "CHAT_CHAT", [2] = "ASR_ASR", [3] = "Invalid (3)" }

----------------------------------------------------------------------------
-- Field helpers
----------------------------------------------------------------------------
local function u8(abbr, name, vs, mask)
    return ProtoField.uint8("dualsense." .. abbr, name, base.DEC, vs, mask)
end
local function flag(abbr, name, mask)
    return ProtoField.uint8("dualsense." .. abbr, name, base.DEC, YESNO, mask)
end

local f = {
    report_id = ProtoField.uint8("dualsense.report_id", "Report ID", base.HEX),

    -- byte 0: Report Set Flags (enable group 1)
    flags0          = ProtoField.uint8("dualsense.flags0", "Enable Flags (byte 0)", base.HEX),
    en_rumble       = flag("flags.enable_rumble_emulation", "EnableRumbleEmulation", 0x01),
    use_rumble      = flag("flags.use_rumble_not_haptics", "UseRumbleNotHaptics", 0x02),
    allow_r_trig    = flag("flags.allow_right_trigger_ffb", "AllowRightTriggerFFB", 0x04),
    allow_l_trig    = flag("flags.allow_left_trigger_ffb", "AllowLeftTriggerFFB", 0x08),
    allow_hp_vol    = flag("flags.allow_headphone_volume", "AllowHeadphoneVolume", 0x10),
    allow_spk_vol   = flag("flags.allow_speaker_volume", "AllowSpeakerVolume", 0x20),
    allow_mic_vol   = flag("flags.allow_mic_volume", "AllowMicVolume", 0x40),
    allow_audio     = flag("flags.allow_audio_control", "AllowAudioControl", 0x80),

    -- byte 1: Report Set Flags (enable group 2)
    flags1          = ProtoField.uint8("dualsense.flags1", "Enable Flags (byte 1)", base.HEX),
    allow_mutelight = flag("flags.allow_mute_light", "AllowMuteLight", 0x01),
    allow_audiomute = flag("flags.allow_audio_mute", "AllowAudioMute", 0x02),
    allow_led       = flag("flags.allow_led_color", "AllowLedColor", 0x04),
    reset_lights    = flag("flags.reset_lights", "ResetLights", 0x08),
    allow_player    = flag("flags.allow_player_indicators", "AllowPlayerIndicators", 0x10),
    allow_hlpf      = flag("flags.allow_haptic_lpf", "AllowHapticLowPassFilter", 0x20),
    allow_motorpwr  = flag("flags.allow_motor_power_level", "AllowMotorPowerLevel", 0x40),
    allow_audio2    = flag("flags.allow_audio_control2", "AllowAudioControl2", 0x80),

    -- bytes 2..6
    rumble_right    = ProtoField.uint8("dualsense.rumble_emulation_right", "RumbleEmulationRight (light)", base.DEC),
    rumble_left     = ProtoField.uint8("dualsense.rumble_emulation_left", "RumbleEmulationLeft (heavy)", base.DEC),
    vol_headphones  = ProtoField.uint8("dualsense.volume_headphones", "VolumeHeadphones", base.DEC),
    vol_speaker     = ProtoField.uint8("dualsense.volume_speaker", "VolumeSpeaker", base.DEC),
    vol_mic         = ProtoField.uint8("dualsense.volume_mic", "VolumeMic", base.DEC),

    -- byte 7: AudioControl
    audioctrl       = ProtoField.uint8("dualsense.audio_control", "AudioControl (byte 7)", base.HEX),
    mic_select      = u8("audio.mic_select", "MicSelect", VS_MICSELECT, 0x03),
    echo_cancel     = flag("audio.echo_cancel_enable", "EchoCancelEnable", 0x04),
    noise_cancel    = flag("audio.noise_cancel_enable", "NoiseCancelEnable", 0x08),
    out_path        = u8("audio.output_path_select", "OutputPathSelect", VS_OUTPATH, 0x30),
    in_path         = u8("audio.input_path_select", "InputPathSelect", VS_INPATH, 0xC0),

    -- byte 8
    mutelight_mode  = ProtoField.uint8("dualsense.mute_light_mode", "MuteLightMode", base.DEC, VS_MUTELIGHT),

    -- byte 9: MuteControl
    mutectrl        = ProtoField.uint8("dualsense.mute_control", "MuteControl (byte 9)", base.HEX),
    touch_ps        = flag("mute.touch_power_save", "TouchPowerSave", 0x01),
    motion_ps       = flag("mute.motion_power_save", "MotionPowerSave", 0x02),
    haptic_ps       = flag("mute.haptic_power_save", "HapticPowerSave", 0x04),
    audio_ps        = flag("mute.audio_power_save", "AudioPowerSave", 0x08),
    mic_mute        = flag("mute.mic_mute", "MicMute", 0x10),
    speaker_mute    = flag("mute.speaker_mute", "SpeakerMute", 0x20),
    headphone_mute  = flag("mute.headphone_mute", "HeadphoneMute", 0x40),
    haptic_mute     = flag("mute.haptic_mute", "HapticMute", 0x80),

    -- bytes 10..31
    right_ffb       = ProtoField.bytes("dualsense.right_trigger_ffb", "RightTriggerFFB[11]"),
    left_ffb        = ProtoField.bytes("dualsense.left_trigger_ffb", "LeftTriggerFFB[11]"),
    ffb_effect      = ProtoField.uint8("dualsense.trigger_ffb_effect", "Effect/Mode (byte 0)", base.HEX),

    -- bytes 32..35
    host_timestamp  = ProtoField.uint32("dualsense.host_timestamp", "HostTimestamp", base.DEC),

    -- byte 36: MotorPowerLevel
    motorpwr        = ProtoField.uint8("dualsense.motor_power_level", "MotorPowerLevel (byte 36)", base.HEX),
    trig_motor_red  = u8("motor.trigger_power_reduction", "TriggerMotorPowerReduction (x12.5%)", nil, 0x0F),
    rumble_motor_red = u8("motor.rumble_power_reduction", "RumbleMotorPowerReduction (x12.5%)", nil, 0xF0),

    -- byte 37: AudioControl2
    audioctrl2      = ProtoField.uint8("dualsense.audio_control2", "AudioControl2 (byte 37)", base.HEX),
    spk_pregain     = u8("audio2.speaker_comp_pregain", "SpeakerCompPreGain", nil, 0x07),
    beamforming     = flag("audio2.beamforming_enable", "BeamformingEnable", 0x08),
    unk_audio2      = u8("audio2.unk", "UnkAudioControl2", nil, 0xF0),

    -- byte 38
    misc38          = ProtoField.uint8("dualsense.misc38", "Misc Flags (byte 38)", base.HEX),
    allow_bright    = flag("misc.allow_light_brightness_change", "AllowLightBrightnessChange", 0x01),
    allow_fade      = flag("misc.allow_color_light_fade_animation", "AllowColorLightFadeAnimation", 0x02),
    en_imp_rumble   = flag("misc.enable_improved_rumble_emulation", "EnableImprovedRumbleEmulation", 0x04),
    unkbitc         = u8("misc.unkbitc", "UNKBITC", nil, 0xF8),

    -- byte 39
    misc39          = ProtoField.uint8("dualsense.misc39", "Haptic LPF (byte 39)", base.HEX),
    hlpf            = flag("misc.haptic_low_pass_filter", "HapticLowPassFilter", 0x01),
    unkbit          = u8("misc.unkbit", "UNKBIT", nil, 0xFE),

    -- byte 40
    unkbyte         = ProtoField.uint8("dualsense.unkbyte", "UNKBYTE (byte 40)", base.HEX),

    -- bytes 41..42
    fade_anim       = ProtoField.uint8("dualsense.light_fade_animation", "LightFadeAnimation", base.DEC, VS_FADE),
    brightness      = ProtoField.uint8("dualsense.light_brightness", "LightBrightness", base.DEC, VS_BRIGHTNESS),

    -- byte 43: PlayerIndicators
    player          = ProtoField.uint8("dualsense.player_indicators", "PlayerIndicators (byte 43)", base.HEX),
    pl1             = flag("player.light1", "PlayerLight1", 0x01),
    pl2             = flag("player.light2", "PlayerLight2", 0x02),
    pl3             = flag("player.light3", "PlayerLight3", 0x04),
    pl4             = flag("player.light4", "PlayerLight4", 0x08),
    pl5             = flag("player.light5", "PlayerLight5", 0x10),
    pl_fade         = flag("player.light_fade", "PlayerLightFade", 0x20),
    pl_unk          = u8("player.light_unk", "PlayerLightUNK", nil, 0xC0),

    -- bytes 44..46: RGB LED
    led_red         = ProtoField.uint8("dualsense.led_red", "LedRed", base.DEC),
    led_green       = ProtoField.uint8("dualsense.led_green", "LedGreen", base.DEC),
    led_blue        = ProtoField.uint8("dualsense.led_blue", "LedBlue", base.DEC),
    led_rgb         = ProtoField.uint24("dualsense.led_rgb", "Led RGB", base.HEX),
}

p_ds.fields = f

----------------------------------------------------------------------------
-- Locate the report payload from already-dissected USB/HID fields
----------------------------------------------------------------------------
local function make_field(name)
    local ok, fld = pcall(Field.new, name)
    if ok then return fld end
    return nil
end
local fe_hiddata = make_field("usbhid.data")
local fe_capdata = make_field("usb.capdata")

local function get_payload_range()
    if fe_hiddata then
        local fi = fe_hiddata()
        if fi then return fi.range end
    end
    if fe_capdata then
        local fi = fe_capdata()
        if fi then return fi.range end
    end
    return nil
end

----------------------------------------------------------------------------
-- Dissection
----------------------------------------------------------------------------
local function add_byte_bits(parent, field, hdr_field, range, children)
    local node = parent:add(field, range)
    for _, child in ipairs(children) do
        node:add(child, range)
    end
    return node
end

local function dissect_setstate(s, tree)
    -- s is a Tvb covering the 47-byte SetStateData (offset 0 == struct byte 0)
    local stree = tree:add(p_ds, s(0, s:len()), "SetStateData")

    -- byte 0
    add_byte_bits(stree, f.flags0, nil, s(0, 1), {
        f.en_rumble, f.use_rumble, f.allow_r_trig, f.allow_l_trig,
        f.allow_hp_vol, f.allow_spk_vol, f.allow_mic_vol, f.allow_audio,
    })
    -- byte 1
    add_byte_bits(stree, f.flags1, nil, s(1, 1), {
        f.allow_mutelight, f.allow_audiomute, f.allow_led, f.reset_lights,
        f.allow_player, f.allow_hlpf, f.allow_motorpwr, f.allow_audio2,
    })

    stree:add(f.rumble_right, s(2, 1))
    stree:add(f.rumble_left, s(3, 1))
    stree:add(f.vol_headphones, s(4, 1))
    stree:add(f.vol_speaker, s(5, 1))
    stree:add(f.vol_mic, s(6, 1))

    -- byte 7: AudioControl
    add_byte_bits(stree, f.audioctrl, nil, s(7, 1), {
        f.mic_select, f.echo_cancel, f.noise_cancel, f.out_path, f.in_path,
    })

    stree:add(f.mutelight_mode, s(8, 1))

    -- byte 9: MuteControl
    add_byte_bits(stree, f.mutectrl, nil, s(9, 1), {
        f.touch_ps, f.motion_ps, f.haptic_ps, f.audio_ps,
        f.mic_mute, f.speaker_mute, f.headphone_mute, f.haptic_mute,
    })

    -- bytes 10..20 / 21..31: trigger force feedback arrays
    local rffb = stree:add(f.right_ffb, s(10, 11))
    rffb:add(f.ffb_effect, s(10, 1))
    local lffb = stree:add(f.left_ffb, s(21, 11))
    lffb:add(f.ffb_effect, s(21, 1))

    stree:add_le(f.host_timestamp, s(32, 4))

    -- byte 36: MotorPowerLevel
    add_byte_bits(stree, f.motorpwr, nil, s(36, 1), {
        f.trig_motor_red, f.rumble_motor_red,
    })
    -- byte 37: AudioControl2
    add_byte_bits(stree, f.audioctrl2, nil, s(37, 1), {
        f.spk_pregain, f.beamforming, f.unk_audio2,
    })
    -- byte 38
    add_byte_bits(stree, f.misc38, nil, s(38, 1), {
        f.allow_bright, f.allow_fade, f.en_imp_rumble, f.unkbitc,
    })
    -- byte 39
    add_byte_bits(stree, f.misc39, nil, s(39, 1), {
        f.hlpf, f.unkbit,
    })

    stree:add(f.unkbyte, s(40, 1))
    stree:add(f.fade_anim, s(41, 1))
    stree:add(f.brightness, s(42, 1))

    -- byte 43: PlayerIndicators
    add_byte_bits(stree, f.player, nil, s(43, 1), {
        f.pl1, f.pl2, f.pl3, f.pl4, f.pl5, f.pl_fade, f.pl_unk,
    })

    -- bytes 44..46: RGB LED
    local r, g, b = s(44, 1):uint(), s(45, 1):uint(), s(46, 1):uint()
    stree:add(f.led_red, s(44, 1))
    stree:add(f.led_green, s(45, 1))
    stree:add(f.led_blue, s(46, 1))
    local rgb = stree:add(f.led_rgb, s(44, 3))
    rgb:set_text(string.format("Led RGB: #%02X%02X%02X", r, g, b))
    rgb:set_generated()

    return r, g, b
end

function p_ds.dissector(tvb, pinfo, tree)
    local data = get_payload_range()
    if not data then return end
    if data:len() < 1 then return end
    if data(0, 1):uint() ~= 0x02 then return end  -- only Report ID 0x02

    local root = tree:add(p_ds, data, "DualSense Output Report (0x02)")
    root:add(f.report_id, data(0, 1))

    if data:len() < 1 + 47 then
        root:add_expert_info(PI_MALFORMED, PI_WARN,
            string.format("Truncated: need 48 bytes, have %d", data:len()))
        return
    end

    -- SetStateData starts right after the 1-byte Report ID
    local s = data(1, 47):tvb()
    local r, g, b = dissect_setstate(s, root)

    local rr = s(2, 1):uint()
    local rl = s(3, 1):uint()
    root:append_text(string.format(", Rumble R/L=%d/%d, LED=#%02X%02X%02X", rr, rl, r, g, b))
    pinfo.cols.info:append(string.format("  [DualSense SetState  Rumble=%d/%d  LED=#%02X%02X%02X]",
        rr, rl, r, g, b))
end

register_postdissector(p_ds)
