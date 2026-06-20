import { CallHandler } from './callHandler';
import { CallerScreener } from './screener';
import { VoicemailRecorder } from './voicemail';
import { TtsEngine } from './tts';
import { GpioController } from './gpio';
import { systemResetSerial } from './usbReset';
import { modemLog } from '../events';
import { config } from '../config';
import type { Modem } from './modem';

// Store on globalThis so all module instances (instrumentation + API routes) share the same reference
declare global {
  // eslint-disable-next-line no-var
  var __modemInstance: Modem | null;
  // eslint-disable-next-line no-var
  var __callHandler: CallHandler | null;
  // In-flight recovery promise — serializes manual restarts and watchdog-driven
  // recovery so they can never overlap (overlapping restarts corrupted serial
  // state in the original crash report).
  // eslint-disable-next-line no-var
  var __modemRecovering: Promise<void> | null;
}
globalThis.__modemInstance ??= null;
globalThis.__callHandler ??= null;
globalThis.__modemRecovering ??= null;

export function getModem(): Modem | null {
  return globalThis.__modemInstance;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function teardownModem(): Promise<void> {
  if (globalThis.__modemInstance) {
    try {
      await globalThis.__modemInstance.close();
    } catch (err) {
      modemLog('warn', `Error closing modem: ${err}`);
    }
    globalThis.__modemInstance = null;
  }
  globalThis.__callHandler = null;
}

/**
 * Build a fresh Modem + CallHandler, open the serial port, and start listening.
 * Throws if the port can't be opened or the modem doesn't respond to init.
 * On success the new instance is stored on globalThis and is healthy (not wedged).
 */
async function bringUpModem(recorder: VoicemailRecorder): Promise<void> {
  modemLog('info', `Opening ${config.serialPort} at ${config.serialBaudRate} baud...`);

  const { Modem } = await import('./modem');
  const modem = new Modem();
  modem.onLog = (msg) => modemLog('info', msg);
  globalThis.__modemInstance = modem;

  await modem.open();

  // A modem that wedged during init answers no AT commands — treat that as a
  // failed bring-up so the caller can escalate to a system-level reset.
  if (modem.isWedged()) {
    throw new Error('Modem unresponsive during init (wedged)');
  }

  const model = modem.model;
  const modelNames: Record<string, string> = {
    USR: 'US Robotics 5637',
    CONEXANT: 'Conexant-based',
    MT9234MU: 'MULTITECH MT9234MU',
    UNKNOWN: 'Unknown (using USR-compatible defaults)',
  };
  modemLog('info', `Serial port opened. Modem initialized.`);
  modemLog('info', `Detected modem: ${modelNames[model] ?? model} (model=${model})`);

  const handler = new CallHandler(
    modem,
    new CallerScreener(),
    recorder,
    new TtsEngine(),
    new GpioController(),
  );
  handler.start();
  globalThis.__callHandler = handler;

  // Daemon-level listener for crash recovery. The CallHandler attaches its own
  // listener for call events; this one only watches for failures.
  modem.on((event) => {
    if (!config.modemAutoRecover) return;
    if (event.type === 'WEDGED') {
      runRecovery(`Watchdog: modem wedged after ${event.consecutiveTimeouts} consecutive timeouts`);
    } else if (event.type === 'ERROR' && !modem.isOpen()) {
      // Port dropped out from under us (e.g. USB disconnect / re-enumeration).
      runRecovery(`Serial port closed unexpectedly: ${event.error}`);
    }
  });

  modemLog('info', 'Modem daemon started — listening for calls');
}

/** Run the optional external reset command (e.g. a uhubctl power cycle). */
async function runResetCommand(): Promise<void> {
  if (!config.modemResetCmd) return;
  modemLog('info', `Running MODEM_RESET_CMD: ${config.modemResetCmd}`);
  try {
    const { exec } = await import('child_process');
    await new Promise<void>((resolve) => {
      exec(config.modemResetCmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) modemLog('warn', `MODEM_RESET_CMD failed: ${err}`);
        if (stdout?.trim()) modemLog('info', `MODEM_RESET_CMD: ${stdout.trim()}`);
        if (stderr?.trim()) modemLog('warn', `MODEM_RESET_CMD stderr: ${stderr.trim()}`);
        resolve();
      });
    });
  } catch (err) {
    modemLog('warn', `Could not run MODEM_RESET_CMD: ${err}`);
  }
}

/** Wait (up to timeoutMs) for the serial device node to (re)appear. */
async function waitForDeviceNode(timeoutMs: number): Promise<boolean> {
  const { existsSync } = await import('fs');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(config.serialPort)) return true;
    await sleep(500);
  }
  return existsSync(config.serialPort);
}

/**
 * Recovery ladder for a wedged / disconnected modem:
 *   1. Soft: close + reopen + re-init.
 *   2. System-level: external reset command and/or sysfs USB re-enumeration,
 *      then wait for the device node and reopen.
 *   3. If still dead: exit for the supervisor to restart (opt-in), else give up
 *      with the modem offline (a later manual restart can retry).
 */
async function doRecovery(reason: string): Promise<void> {
  const recorder = new VoicemailRecorder();
  await recorder.ensureMessagesDir();

  modemLog('warn', `Modem recovery started — ${reason}`);

  // Step 1: soft reopen.
  await teardownModem();
  try {
    await bringUpModem(recorder);
    modemLog('info', 'Modem recovered via soft reopen');
    return;
  } catch (err) {
    modemLog('warn', `Soft reopen failed: ${err}`);
  }

  // Step 2: system-level reset (external command + sysfs USB re-enumeration).
  await teardownModem();
  await runResetCommand();
  if (config.modemUsbReset) {
    await systemResetSerial(config.serialPort, (m) => modemLog('info', m));
  }
  await waitForDeviceNode(15000);
  try {
    await bringUpModem(recorder);
    modemLog('info', 'Modem recovered after system-level reset');
    return;
  } catch (err) {
    modemLog('error', `Recovery after system-level reset failed: ${err}`);
  }

  // Step 3: unrecoverable.
  await teardownModem();
  if (config.modemExitOnUnrecoverable) {
    modemLog('error', 'Modem unrecoverable — exiting so the supervisor can restart the process');
    // Give logs a moment to flush before exiting.
    await sleep(500);
    process.exit(1);
  }
  modemLog('error', 'Modem unrecoverable — daemon offline. A physical power cycle may be required; restart the modem from the debug console once resolved.');
}

/** Serialize recovery so manual restarts and the watchdog never overlap. */
function runRecovery(reason: string): Promise<void> {
  if (globalThis.__modemRecovering) {
    modemLog('info', `Recovery already in progress — ignoring trigger: ${reason}`);
    return globalThis.__modemRecovering;
  }
  const p = doRecovery(reason).finally(() => {
    globalThis.__modemRecovering = null;
  });
  globalThis.__modemRecovering = p;
  return p;
}

export async function restartDaemon(): Promise<void> {
  await runRecovery('Manual restart requested');
}

export async function startDaemon(): Promise<void> {
  const recorder = new VoicemailRecorder();
  await recorder.ensureMessagesDir();

  const { existsSync } = await import('fs');
  if (!existsSync(config.serialPort)) {
    modemLog('warn', `Serial port ${config.serialPort} not found — running in demo mode`);
    return;
  }

  try {
    await bringUpModem(recorder);
  } catch (err) {
    modemLog('error', `Failed to open serial port: ${err}`);
    if (config.modemAutoRecover) {
      // Don't await — let the daemon finish starting; recovery runs in background.
      runRecovery('Initial bring-up failed').catch(() => {});
    }
  }
}

// Re-export types used by other parts of the codebase
export type { ScreeningResult, ScreeningAction } from './screener';
