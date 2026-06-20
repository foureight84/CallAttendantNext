import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => {
  const realpathSync = vi.fn();
  const existsSync = vi.fn();
  const writeFileSync = vi.fn();
  return {
    default: { realpathSync, existsSync, writeFileSync },
    realpathSync,
    existsSync,
    writeFileSync,
  };
});

import fs from 'fs';
import { resolveUsbDevicePath, systemResetSerial } from '@/lib/modem/usbReset';

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('resolveUsbDevicePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks up from the tty device to the USB node containing idVendor', () => {
    vi.mocked(fs.realpathSync).mockReturnValue(
      '/sys/devices/platform/usb1/1-1/1-1:1.0',
    );
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p) === '/sys/devices/platform/usb1/1-1/idVendor',
    );

    expect(resolveUsbDevicePath('/dev/ttyUSB0')).toBe('/sys/devices/platform/usb1/1-1');
  });

  it('returns null when the device symlink cannot be read', () => {
    vi.mocked(fs.realpathSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(resolveUsbDevicePath('/dev/ttyUSB0')).toBeNull();
  });

  it('returns null when no idVendor ancestor exists', () => {
    vi.mocked(fs.realpathSync).mockReturnValue('/sys/devices/a/b/c');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(resolveUsbDevicePath('/dev/ttyUSB0')).toBeNull();
  });
});

describe('systemResetSerial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('is a no-op on non-Linux platforms', async () => {
    setPlatform('darwin');
    const logs: string[] = [];
    const ok = await systemResetSerial('/dev/tty.usbmodem1', (m) => logs.push(m));
    expect(ok).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('not supported');
  });

  it('unbinds and rebinds the resolved USB device on Linux', async () => {
    setPlatform('linux');
    vi.mocked(fs.realpathSync).mockReturnValue(
      '/sys/devices/platform/usb1/1-1/1-1:1.0',
    );
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p) === '/sys/devices/platform/usb1/1-1/idVendor',
    );
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const ok = await systemResetSerial('/dev/ttyUSB0', () => {});
    expect(ok).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith('/sys/bus/usb/drivers/usb/unbind', '1-1');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/sys/bus/usb/drivers/usb/bind', '1-1');
  });

  it('returns false when sysfs writes are not permitted', async () => {
    setPlatform('linux');
    vi.mocked(fs.realpathSync).mockReturnValue(
      '/sys/devices/platform/usb1/1-1/1-1:1.0',
    );
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p) === '/sys/devices/platform/usb1/1-1/idVendor',
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });

    const logs: string[] = [];
    const ok = await systemResetSerial('/dev/ttyUSB0', (m) => logs.push(m));
    expect(ok).toBe(false);
    expect(logs.join('\n')).toContain('no permission');
  });
});
