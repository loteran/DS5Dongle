#!/usr/bin/env python3
"""
Reboot the ds5dongle into BOOTSEL (USB bootloader) from the host, so it can be
reflashed without the physical BOOTSEL button.

Sends HID feature report 0xF6 with funcid 0x04, which firmware that includes the
reboot command (src/cmd.cpp: `buffer[0] == 0x04 -> reset_usb_boot()`) answers by
dropping into BOOTSEL. The dongle then enumerates as the RP2350 mass-storage
drive. The HID device disappears mid-request, so a send error here is EXPECTED
and means success.

Requires: pip install hidapi
Run:      python reboot_bootsel.py
"""
import sys

try:
    import hid
except ImportError:
    sys.exit("Missing dependency. Install with:  pip install hidapi")

VID = 0x054C
PIDS = (0x0CE6, 0x0DF2)          # DualSense, DualSense Edge
REPORT_ID = 0xF6
FUNCID_REBOOT_BOOTSEL = 0x04
DATA_LEN = 63                    # data bytes after the report id (descriptor: report count 0x3F)


def main():
    cand = [d for d in hid.enumerate(VID) if d["product_id"] in PIDS]
    if not cand:
        sys.exit("No DualSense / ds5dongle found (VID 054C, PID 0CE6/0DF2). "
                 "Close Steam/DSX if they're holding the device.")
    dev = hid.device()
    dev.open_path(cand[0]["path"])

    # [report id][funcid][padding...] -> 1 + DATA_LEN bytes total
    payload = bytes([REPORT_ID, FUNCID_REBOOT_BOOTSEL] + [0] * (DATA_LEN - 1))
    try:
        dev.send_feature_report(payload)
        print("Sent reboot-to-BOOTSEL. The dongle should now appear as the RP2350 drive.")
    except (OSError, ValueError) as e:
        # Device reboots and drops off the bus mid-request -- this is success.
        print(f"Send raised (device already rebooting -- expected): {e}")
    finally:
        try:
            dev.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
