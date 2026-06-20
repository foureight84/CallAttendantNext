import fs from 'fs';
import path from 'path';

/**
 * Best-effort, dependency-free system-level reset of a USB serial modem.
 *
 * A wedged modem (firmware hang) cannot be revived by closing and reopening the
 * serial port — the USB device itself must be re-enumerated. On Linux this can be
 * done purely through sysfs (no native addon, no extra npm dependency):
 *
 *   1. unbind + rebind the USB device from the `usb` driver, OR
 *   2. toggle the device's `authorized` flag (0 → 1)
 *
 * Both force the kernel to tear down and re-probe the device, which recreates the
 * tty (e.g. /dev/ttyUSB0). Either requires root, or a udev rule granting the
 * service user write access to the relevant sysfs nodes.
 *
 * On non-Linux platforms, or when the sysfs nodes aren't writable (e.g. inside an
 * unprivileged Docker container without `/dev/bus/usb` + a writable `/sys`), this
 * is a graceful no-op that logs why it couldn't reset.
 */

type Logger = (msg: string) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve the sysfs USB device directory backing a tty device path.
 * Returns the absolute sysfs path of the USB device node (the dir containing
 * `idVendor`), whose basename (e.g. "1-1.2") is the id used for unbind/bind.
 * Returns null if it can't be resolved.
 */
export function resolveUsbDevicePath(serialPath: string): string | null {
  const ttyName = path.basename(serialPath); // e.g. ttyUSB0 / ttyACM0
  const deviceLink = `/sys/class/tty/${ttyName}/device`;
  let current: string;
  try {
    current = fs.realpathSync(deviceLink);
  } catch {
    return null;
  }

  // Walk up the device tree until we find the USB device node — the first
  // ancestor directory that contains an `idVendor` file.
  for (let i = 0; i < 12 && current && current !== '/'; i++) {
    if (fs.existsSync(path.join(current, 'idVendor'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function tryWrite(file: string, value: string, log: Logger): boolean {
  try {
    fs.writeFileSync(file, value);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      log(`[modem] USB reset: no permission to write ${file} (need root or a udev rule)`);
    } else if (code === 'ENOENT') {
      // node absent — expected inside containers without /sys passthrough
      log(`[modem] USB reset: ${file} not available in this environment`);
    } else {
      log(`[modem] USB reset: failed writing ${file}: ${err}`);
    }
    return false;
  }
}

/**
 * Attempt to re-enumerate the USB modem behind `serialPath`.
 * Returns true if a reset method was successfully applied (the caller should then
 * wait for the device node to re-appear and reopen), false otherwise.
 */
export async function systemResetSerial(serialPath: string, log: Logger): Promise<boolean> {
  if (process.platform !== 'linux') {
    log(`[modem] USB reset not supported on ${process.platform} — skipping system-level reset`);
    return false;
  }

  const usbDir = resolveUsbDevicePath(serialPath);
  if (!usbDir) {
    log(`[modem] USB reset: could not resolve sysfs USB device for ${serialPath}`);
    return false;
  }

  const deviceId = path.basename(usbDir); // e.g. "1-1.2"
  log(`[modem] Attempting system-level USB reset of ${serialPath} (device ${deviceId})`);

  // Method 1: unbind + rebind from the usb driver. This fully removes and
  // re-probes the device, recreating the tty.
  const unbindPath = '/sys/bus/usb/drivers/usb/unbind';
  const bindPath = '/sys/bus/usb/drivers/usb/bind';
  if (tryWrite(unbindPath, deviceId, log)) {
    await sleep(1000);
    if (tryWrite(bindPath, deviceId, log)) {
      log('[modem] USB reset via unbind/bind succeeded');
      return true;
    }
    log('[modem] USB reset: unbind succeeded but rebind failed — falling through');
  }

  // Method 2: toggle the authorized flag (0 → 1) to force re-enumeration.
  const authorizedPath = path.join(usbDir, 'authorized');
  if (tryWrite(authorizedPath, '0', log)) {
    await sleep(1000);
    if (tryWrite(authorizedPath, '1', log)) {
      log('[modem] USB reset via authorized toggle succeeded');
      return true;
    }
  }

  log('[modem] System-level USB reset unavailable — modem may need a physical power cycle');
  return false;
}
