import { createRequire } from 'module';
import { sleep } from '../sleep';

export class GpioController {
  static readonly PINS = {
    RING: 11,
    BLOCKED: 13,
    ALLOWED: 15,
  } as const;

  private readonly enabled: boolean;

  constructor() {
    this.enabled = process.env.ENABLE_GPIO === 'true';
  }

  async setLed(pin: number, value: 0 | 1): Promise<void> {
    if (!this.enabled) return;
    try {
      const require = createRequire(import.meta.url);
      const { Gpio } = require('onoff') as { Gpio: new (pin: number, direction: string) => { writeSync: (v: number) => void } };
      const led = new Gpio(pin, 'out');
      led.writeSync(value);
    } catch {
      console.warn('[gpio] GPIO not available on this platform');
    }
  }

  async blinkLed(pin: number, times = 3, intervalMs = 200): Promise<void> {
    if (!this.enabled) return;
    for (let i = 0; i < times; i++) {
      await this.setLed(pin, 1);
      await sleep(intervalMs);
      await this.setLed(pin, 0);
      await sleep(intervalMs);
    }
  }
}

// Keep for any existing callers that import GPIO_PINS directly
export const GPIO_PINS = GpioController.PINS;
