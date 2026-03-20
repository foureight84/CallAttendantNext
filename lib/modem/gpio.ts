import { createRequire } from 'module';
import { sleep } from '../sleep';

const ENABLE_GPIO = process.env.ENABLE_GPIO === 'true';

export const GPIO_PINS = {
  RING: 11,
  BLOCKED: 13,
  ALLOWED: 15,
} as const;

export async function setLed(pin: number, value: 0 | 1): Promise<void> {
  if (!ENABLE_GPIO) return;
  try {
    const require = createRequire(import.meta.url);
    const { Gpio } = require('onoff') as { Gpio: new (pin: number, direction: string) => { writeSync: (v: number) => void } };
    const led = new Gpio(pin, 'out');
    led.writeSync(value);
  } catch {
    console.warn('[gpio] GPIO not available on this platform');
  }
}

export async function blinkLed(pin: number, times = 3, intervalMs = 200): Promise<void> {
  if (!ENABLE_GPIO) return;
  for (let i = 0; i < times; i++) {
    await setLed(pin, 1);
    await sleep(intervalMs);
    await setLed(pin, 0);
    await sleep(intervalMs);
  }
}
