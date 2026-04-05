import { CallHandler } from './callHandler';
import { CallerScreener } from './screener';
import { VoicemailRecorder } from './voicemail';
import { TtsEngine } from './tts';
import { GpioController } from './gpio';
import { modemLog } from '../events';
import { config } from '../config';
import type { Modem } from './modem';

// Store on globalThis so all module instances (instrumentation + API routes) share the same reference
declare global {
  // eslint-disable-next-line no-var
  var __modemInstance: Modem | null;
  // eslint-disable-next-line no-var
  var __callHandler: CallHandler | null;
}
globalThis.__modemInstance ??= null;
globalThis.__callHandler ??= null;

export function getModem(): Modem | null {
  return globalThis.__modemInstance;
}

export async function restartDaemon(): Promise<void> {
  if (globalThis.__modemInstance) {
    try {
      modemLog('info', 'Closing modem for restart...');
      await globalThis.__modemInstance.close();
    } catch (err) {
      modemLog('warn', `Error closing modem: ${err}`);
    }
    globalThis.__modemInstance = null;
  }
  globalThis.__callHandler = null;
  await startDaemon();
}

export async function startDaemon(): Promise<void> {
  const recorder = new VoicemailRecorder();
  await recorder.ensureMessagesDir();

  const { existsSync } = await import('fs');
  if (!existsSync(config.serialPort)) {
    modemLog('warn', `Serial port ${config.serialPort} not found — running in demo mode`);
    return;
  }

  modemLog('info', `Opening ${config.serialPort} at ${config.serialBaudRate} baud...`);

  try {
    const { Modem } = await import('./modem');
    globalThis.__modemInstance = new Modem();
    globalThis.__modemInstance.onLog = (msg) => modemLog('info', msg);
    await globalThis.__modemInstance.open();
    const model = globalThis.__modemInstance.model;
    const modelNames: Record<string, string> = {
      USR: 'US Robotics 5637',
      CONEXANT: 'Conexant-based',
      MT9234MU: 'MULTITECH MT9234MU',
      UNKNOWN: 'Unknown (using USR-compatible defaults)',
    };
    modemLog('info', `Serial port opened. Modem initialized.`);
    modemLog('info', `Detected modem: ${modelNames[model] ?? model} (model=${model})`);
  } catch (err) {
    modemLog('error', `Failed to open serial port: ${err}`);
    return;
  }

  const handler = new CallHandler(
    globalThis.__modemInstance!,
    new CallerScreener(),
    recorder,
    new TtsEngine(),
    new GpioController(),
  );
  handler.start();
  globalThis.__callHandler = handler;

  modemLog('info', 'Modem daemon started — listening for calls');
}

// Re-export types used by other parts of the codebase
export type { ScreeningResult, ScreeningAction } from './screener';
