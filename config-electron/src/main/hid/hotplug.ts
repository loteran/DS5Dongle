// USB hot-plug detection via node-usb.
// Fires callbacks when the DS5Dongle dongle is plugged/unplugged.

import type { EventEmitter } from 'events';
import { SONY_VID, DS5_PID, EDGE_PID } from '../../shared/protocol';

// node-usb exports `usb` as an EventEmitter at runtime; types don't reflect this.
import usbModule = require('usb');
const usbBus = (usbModule as unknown as { usb: EventEmitter }).usb;

export type HotplugCallback = (event: 'attach' | 'detach') => void;

interface UsbDevice {
  deviceDescriptor: { idVendor: number; idProduct: number };
}

function isDS5Dongle(device: UsbDevice): boolean {
  const { idVendor, idProduct } = device.deviceDescriptor;
  return idVendor === SONY_VID && (idProduct === DS5_PID || idProduct === EDGE_PID);
}

let attachListener: ((d: UsbDevice) => void) | null = null;
let detachListener: ((d: UsbDevice) => void) | null = null;

export function startHotplugWatcher(cb: HotplugCallback): void {
  attachListener = (device) => { if (isDS5Dongle(device)) cb('attach'); };
  detachListener = (device) => { if (isDS5Dongle(device)) cb('detach'); };

  usbBus.on('attach', attachListener as (...args: unknown[]) => void);
  usbBus.on('detach', detachListener as (...args: unknown[]) => void);

  // Keep the process alive for hotplug events
  usbBus.setMaxListeners(20);
}

export function stopHotplugWatcher(): void {
  if (attachListener) {
    usbBus.off('attach', attachListener as (...args: unknown[]) => void);
    attachListener = null;
  }
  if (detachListener) {
    usbBus.off('detach', detachListener as (...args: unknown[]) => void);
    detachListener = null;
  }
}

/** Resolves when a DS5Dongle re-attaches, rejects after `timeoutMs`. */
export function waitForReattach(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      usbBus.off('attach', onAttach as (...args: unknown[]) => void);
      reject(new Error('USB reconnect timeout'));
    }, timeoutMs);

    const onAttach = (device: UsbDevice) => {
      if (!isDS5Dongle(device)) return;
      clearTimeout(timer);
      usbBus.off('attach', onAttach as (...args: unknown[]) => void);
      // Brief pause so the OS fully enumerates HID interfaces
      setTimeout(resolve, 300);
    };

    usbBus.on('attach', onAttach as (...args: unknown[]) => void);
  });
}
