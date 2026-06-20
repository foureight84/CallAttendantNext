import { vi, describe, it, expect, afterEach } from 'vitest';
import { Modem } from '@/lib/modem/modem';
import type { ModemEvent } from '@/lib/modem/modem';

// Minimal fake serialport that lets us drive data/timeout behaviour without
// touching real hardware. sendCommand() only uses isOpen/on/removeListener/write.
function makeFakePort() {
  const listeners: ((c: Buffer) => void)[] = [];
  return {
    isOpen: true,
    on(ev: string, cb: (c: Buffer) => void) { if (ev === 'data') listeners.push(cb); },
    removeListener(ev: string, cb: (c: Buffer) => void) {
      if (ev === 'data') {
        const i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      }
    },
    write(_data: unknown, cb?: (err?: Error | null) => void) { cb?.(null); return true; },
    emitData(buf: Buffer) { for (const l of [...listeners]) l(buf); },
  };
}

describe('modem watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('declares the modem wedged and emits WEDGED after consecutive AT timeouts', async () => {
    vi.useFakeTimers();
    const modem = new Modem();
    const port = makeFakePort();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (modem as any).port = port;

    const events: ModemEvent[] = [];
    modem.on((e) => events.push(e));

    // Default threshold is 3 (config.modemWatchdogTimeouts).
    for (let i = 0; i < 3; i++) {
      const p = modem.sendCommand('AT', 100);
      await vi.advanceTimersByTimeAsync(700); // delayMs + 500 buffer
      await p;
    }

    expect(modem.isWedged()).toBe(true);
    expect(events.filter((e) => e.type === 'WEDGED')).toHaveLength(1);
    const wedged = events.find((e) => e.type === 'WEDGED');
    expect(wedged && wedged.type === 'WEDGED' && wedged.consecutiveTimeouts).toBe(3);
  });

  it('does not emit WEDGED again on further timeouts (single-shot)', async () => {
    vi.useFakeTimers();
    const modem = new Modem();
    const port = makeFakePort();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (modem as any).port = port;
    const events: ModemEvent[] = [];
    modem.on((e) => events.push(e));

    for (let i = 0; i < 5; i++) {
      const p = modem.sendCommand('AT', 100);
      await vi.advanceTimersByTimeAsync(700);
      await p;
    }

    expect(events.filter((e) => e.type === 'WEDGED')).toHaveLength(1);
  });

  it('resets the timeout streak when a command succeeds', async () => {
    vi.useFakeTimers();
    const modem = new Modem();
    const port = makeFakePort();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (modem as any).port = port;

    // Two timeouts (below the threshold of 3).
    for (let i = 0; i < 2; i++) {
      const p = modem.sendCommand('AT', 100);
      await vi.advanceTimersByTimeAsync(700);
      await p;
    }

    // A successful response clears the streak.
    const ok = modem.sendCommand('AT', 100);
    port.emitData(Buffer.from('OK\r\n'));
    await ok;

    // One more timeout — streak restarts at 1, so still not wedged.
    const p = modem.sendCommand('AT', 100);
    await vi.advanceTimersByTimeAsync(700);
    await p;

    expect(modem.isWedged()).toBe(false);
  });
});
