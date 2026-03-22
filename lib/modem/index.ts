import { CallerIdParser } from './callerIdParser';
import { screenCaller } from './screener';
import { savePcmAsMP3, ensureMessagesDir, readScriptFile } from './voicemail';
import { synthesize } from './tts';
import { insertCallLog, insertMessage, getSettings, isWhitelisted, isBlacklisted } from '../db';
import { callEvents, modemLog } from '../events';
import { config } from '../config';
import path from 'path';
import { blinkLed, GPIO_PINS } from './gpio';
import { sleep } from '../sleep';
import type { CallerIdInfo } from './callerIdParser';
import type { Modem } from './modem';
import type { ScreeningResult } from './screener';

// Store on globalThis so all module instances (instrumentation + API routes) share the same reference
declare global {
  // eslint-disable-next-line no-var
  var __modemInstance: Modem | null;
}
globalThis.__modemInstance ??= null;

const RING_INTERVAL_MS = 6000;
const RING_TIMEOUT_BUFFER_MS = 2000;

let ringCount = 0;
let currentCallInfo: CallerIdInfo | null = null;
let isHandlingCall = false;
let isWaitingForRings = false;
let screeningPromise: Promise<{ action: 'Blocked' | 'Permitted' | 'Screened'; reason: string }> | null = null;
let ringTimeoutId: ReturnType<typeof setTimeout> | null = null;
let preSynthesizedGreeting: Buffer[] | null = null;
let preSynthesizedPleaseLeave: Buffer[] | null = null;

function scheduleRingTimeout(): void {
  if (ringTimeoutId !== null) clearTimeout(ringTimeoutId);
  ringTimeoutId = setTimeout(() => {
    ringTimeoutId = null;
    if ((isWaitingForRings || !isHandlingCall) && ringCount > 0) {
      modemLog('info', 'No additional ring received — caller likely hung up, resetting state');
      resetCallState();
    }
  }, RING_INTERVAL_MS + RING_TIMEOUT_BUFFER_MS);
}

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
  ringCount = 0;
  currentCallInfo = null;
  isHandlingCall = false;
  await startDaemon();
}

export async function startDaemon(): Promise<void> {
  await ensureMessagesDir();

  const { existsSync } = await import('fs');
  if (!existsSync(config.serialPort)) {
    modemLog('warn', `Serial port ${config.serialPort} not found — running in demo mode`);
    return;
  }

  modemLog('info', `Opening ${config.serialPort} at ${config.serialBaudRate} baud...`);

  try {
    const { Modem } = await import('./modem');
    globalThis.__modemInstance = new Modem();
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

  globalThis.__modemInstance.on(async (event) => {
    try {
      switch (event.type) {
        case 'RING':
          await handleRing();
          break;
        case 'CALLER_ID':
          currentCallInfo = event.info;
          modemLog('info', `Caller ID: name="${event.info.name ?? 'unknown'}" number="${event.info.number ?? 'unknown'}"`);
          modemLog('info', `Screening caller: ${event.info.name ?? 'UNKNOWN'} <${event.info.number ?? 'UNKNOWN'}>...`);
          screeningPromise = screenCaller(event.info.name ?? 'UNKNOWN', event.info.number ?? 'UNKNOWN').catch(err => {
            modemLog('error', `Screening failed: ${err}`);
            return { action: 'Screened' as const, reason: 'Screening error' };
          });
          kickOffPreSynthesis().catch(() => {});
          break;
        case 'CALL_END':
          await handleCallEnd();
          break;
        case 'VOICE_DATA':
          modemLog('data', `Voice data: ${event.chunk.length} bytes`);
          break;
        case 'ERROR':
          modemLog('error', `Modem error: ${event.error}`);
          break;
      }
    } catch (err) {
      modemLog('error', `Event handler error: ${err}`);
    }
  });

  modemLog('info', 'Modem daemon started — listening for calls');
}

async function resolveCallerName(name: string, number: string): Promise<string> {
  if (number && number !== 'P' && number !== 'O') {
    const wl = await isWhitelisted(number).catch(() => undefined);
    if (wl?.name) return wl.name;
    const bl = await isBlacklisted(number).catch(() => undefined);
    if (bl?.name) return bl.name;
  }
  if (!name || name === 'O') return 'UNKNOWN';
  return name;
}

async function* fromBuffers(chunks: Buffer[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) yield chunk;
}

async function collectChunks(gen: AsyncGenerator<Buffer>): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

async function kickOffPreSynthesis(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.greetingVoice) return;
    const modelPath = resolveModelPath(settings.greetingVoice);
    const [greetingText, pleaseLeaveText] = await Promise.all([
      readScriptFile('general_greeting'),
      readScriptFile('please_leave_message'),
    ]);
    const [greetingChunks, pleaseLeaveChunks] = await Promise.all([
      collectChunks(synthesize(greetingText, modelPath, settings.greetingLengthScale)),
      collectChunks(synthesize(pleaseLeaveText, modelPath, settings.greetingLengthScale)),
    ]);
    preSynthesizedGreeting = greetingChunks;
    preSynthesizedPleaseLeave = pleaseLeaveChunks;
    modemLog('info', 'Pre-synthesis complete — greeting audio buffered');
  } catch (err) {
    modemLog('warn', `Pre-synthesis failed (will synthesize on demand): ${err}`);
  }
}

async function waitForScreeningWithTimeout(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (screeningPromise !== null) return true;
    await sleep(100);
  }
  return false;
}

async function handleRing(): Promise<void> {
  if (isHandlingCall) {
    if (isWaitingForRings) scheduleRingTimeout();
    return;
  }
  ringCount++;
  modemLog('info', `RING #${ringCount}`);
  scheduleRingTimeout();

  if (ringCount === 1) {
    blinkLed(GPIO_PINS.RING, 1).catch(() => {});
    // Caller ID normally arrives within ~2s after ring 1.
    // Poll up to 3.5s — if it arrives, process immediately (fast path).
    // If not, return and let ring 2 trigger as the fallback.
    const callerIdArrived = await waitForScreeningWithTimeout(3500);
    if (!callerIdArrived) return;
    // Fall through to process the call now, before ring 2
  }

  // Lock immediately before any await to prevent concurrent ring handlers
  isHandlingCall = true;

  await blinkLed(GPIO_PINS.RING, 1);

  // After ring 2, proceed even without caller ID (treat as unknown)
  const name = currentCallInfo?.name ?? 'UNKNOWN';
  const number = currentCallInfo?.number ?? 'UNKNOWN';

  if (!currentCallInfo) {
    modemLog('warn', 'No caller ID received — treating as unknown caller');
  }

  const date = currentCallInfo?.date
    ? CallerIdParser.formatDate(currentCallInfo.date)
    : new Date().toLocaleDateString();
  const time = currentCallInfo?.time
    ? CallerIdParser.formatTime(currentCallInfo.time)
    : new Date().toLocaleTimeString();
  const systemDateTime = new Date().toISOString();

  modemLog('info', `Incoming call from: ${name} <${number}>`);

  let screening: ScreeningResult;
  if (screeningPromise) {
    screening = await screeningPromise;
  } else {
    // No caller ID received — screen as unknown
    try {
      screening = await screenCaller(name, number);
    } catch (err) {
      modemLog('error', `Screening failed: ${err}`);
      screening = { action: 'Screened' as const, reason: 'Screening error' };
    }
  }

  modemLog('info', `Screening result: ${screening.action} — ${screening.reason}`);

  const callLogId = await insertCallLog({
    Name: name, Number: number, Date: date, Time: time,
    SystemDateTime: systemDateTime, Action: screening.action, Reason: screening.reason,
  });

  const resolvedName = await resolveCallerName(name, number);
  callEvents.emit('incoming-call', { callLogId, name: resolvedName, number, date, time, action: screening.action, reason: screening.reason });

  if (screening.action === 'Blocked') {
    await handleBlockedCall(callLogId, ringCount, name, number);
  } else if (screening.action === 'Permitted') {
    await handlePermittedCall(callLogId, name, number);
  } else {
    await handleScreenedCall(callLogId, ringCount, name, number, screening.immediate);
  }
}

async function handleBlockedCall(callLogId: number, currentRing: number, name: string, number: string): Promise<void> {
  const modem = globalThis.__modemInstance;
  if (!modem) return;
  const settings = await getSettings();

  // Action 3: send to voicemail after N rings
  if (settings.blocklistAction === 3) {
    const ringsLeft = Math.max(0, settings.ringsBeforeVmBlocklist - currentRing);
    modemLog('info', `Blocked caller — sending to voicemail after ${ringsLeft} more ring(s)`);
    await waitForRings(ringsLeft);
    if (!isHandlingCall) { modemLog('info', 'Blocked call aborted — caller hung up'); return; }
    await goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number);
    await blinkLed(GPIO_PINS.BLOCKED, 1);
    return;
  }

  // Action 1: hang up silently
  // Action 2: play blocked greeting then hang up (default)
  modemLog('info', 'Answering blocked call — entering voice mode');
  await modem.answer();
  await sleep(1000);

  if (settings.blocklistAction === 2) {
    try {
      const text = await readScriptFile('blocked_greeting');
      modemLog('info', 'Synthesizing blocked_greeting via TTS');
      await modem.playAudioStream(synthesize(text, resolveModelPath(settings.greetingVoice), settings.greetingLengthScale));
    } catch (err) {
      modemLog('warn', `Could not play blocked greeting: ${err}`);
    }
    await sleep(500);
  }

  await modem.hangUp();
  modemLog('info', 'Hung up blocked call');
  await blinkLed(GPIO_PINS.BLOCKED, 1);
  resetCallState();
}

async function handlePermittedCall(callLogId: number, name: string, number: string): Promise<void> {
  if (!globalThis.__modemInstance) return;
  const settings = await getSettings();
  const ringsLeft = settings.ringsBeforeVm - ringCount;
  modemLog('info', `Permitted caller — waiting ${ringsLeft} more ring(s) before voicemail`);
  await waitForRings(ringsLeft);
  if (!isHandlingCall) { modemLog('info', 'Permitted call aborted — caller hung up'); return; }
  await goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number);
  await blinkLed(GPIO_PINS.ALLOWED, 1);
}

async function handleScreenedCall(callLogId: number, currentRing: number, name: string, number: string, immediate = false): Promise<void> {
  if (!globalThis.__modemInstance) return;
  const settings = await getSettings();
  const ringsLeft = immediate ? 0 : Math.max(0, settings.ringsBeforeVmScreened - currentRing);
  modemLog('info', `Screened caller — answering after ${ringsLeft} more ring(s)`);
  await waitForRings(ringsLeft);
  if (!isHandlingCall) { modemLog('info', 'Screened call aborted — caller hung up'); return; }
  await goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number);
}

function resolveModelPath(modelFilename: string): string {
  return path.join(path.resolve(config.piperModelsDir), modelFilename);
}

async function goToVoicemail(callLogId: number, greetingBasename: string, voice: string, lengthScale: number, name: string, number: string): Promise<void> {
  const modem = globalThis.__modemInstance;
  if (!modem) return;

  modemLog('info', 'Answering call — entering voice mode (AT+FCLASS=8 → AT+VLS=1)...');
  try {
    await modem.answer();
    modemLog('info', 'Call answered — off hook');
  } catch (err) {
    modemLog('error', `Failed to answer call: ${err}`);
    resetCallState();
    return;
  }
  await sleep(1000);

  try {
    if (preSynthesizedGreeting && preSynthesizedPleaseLeave) {
      modemLog('info', 'Playing pre-synthesized greeting audio');
      await modem.playAudioStream(fromBuffers(preSynthesizedGreeting));
      await modem.playAudioStream(fromBuffers(preSynthesizedPleaseLeave));
    } else {
      const greetingText = await readScriptFile(greetingBasename);
      modemLog('info', `Synthesizing ${greetingBasename} via TTS`);
      await modem.playAudioStream(synthesize(greetingText, resolveModelPath(voice), lengthScale));

      const pleaseLeaveText = await readScriptFile('please_leave_message');
      modemLog('info', 'Synthesizing please_leave_message via TTS');
      await modem.playAudioStream(synthesize(pleaseLeaveText, resolveModelPath(voice), lengthScale));
    }
  } catch (err) {
    modemLog('warn', `Could not play greeting: ${err}`);
  }

  // If the caller hung up during greeting playback, CALL_END will have fired
  // and reset isHandlingCall to false — skip recording entirely.
  if (!isHandlingCall) {
    modemLog('info', 'Caller hung up during greeting — skipping recording');
    await modem.hangUp().catch(() => {});
    resetCallState();
    return;
  }

  modemLog('info', 'Starting recording — playing beep (AT+VTS=[900,900,120]) then AT+VRX...');
  await modem.startRecording();
  modemLog('info', 'Recording voicemail...');

  // Wait until caller hangs up (inVoiceMode → false) or 120s timeout
  let waited = 0;
  while (modem.isRecording() && waited < 120000) {
    await sleep(500);
    waited += 500;
  }

  // Always send <DLE>! to exit AT+VRX mode — required even when the caller
  // hung up and the modem already sent <DLE><ETX>. Matches Python's behavior.
  if (modem.isRecording()) {
    modemLog('info', 'Recording timeout — stopping recording');
  }
  await modem.stopRecording();

  const pcmData = modem.getRecordedBuffer();
  modemLog('info', `Recording ended — ${pcmData.length} bytes captured`);

  // 8000 bytes = 1 second at 8kHz 8-bit mono — filters hang-up transients
  if (pcmData.length > 8000) {
    try {
      const filename = await savePcmAsMP3(pcmData, callLogId, number, name);
      if (filename) {
        await insertMessage({ CallLogID: callLogId, Played: 0, Filename: filename, DateTime: new Date().toISOString() });
        modemLog('info', `Voicemail saved: ${filename}`);
        callEvents.emit('new-voicemail', { callLogId, filename });
      } else {
        modemLog('info', 'Recording discarded — insufficient audio content after trimming');
      }
    } catch (err) {
      modemLog('error', `Failed to save voicemail: ${err}`);
    }
  } else {
    modemLog('info', 'No voicemail left (silence or too short)');
  }

  await modem.hangUp();
  modemLog('info', 'Call ended — on hook');
  resetCallState();
}

async function handleCallEnd(): Promise<void> {
  if (isHandlingCall || ringCount > 0) {
    modemLog('info', 'Call ended');
    resetCallState();
  }
}

async function waitForRings(count: number): Promise<void> {
  if (count <= 0) return;
  modemLog('info', `Waiting for ${count} more ring(s)...`);
  isWaitingForRings = true;
  const waitMs = count * RING_INTERVAL_MS;
  const start = Date.now();
  while (isHandlingCall && Date.now() - start < waitMs) {
    await sleep(100);
  }
  isWaitingForRings = false;
}

function resetCallState(): void {
  ringCount = 0;
  currentCallInfo = null;
  isHandlingCall = false;
  isWaitingForRings = false;
  screeningPromise = null;
  preSynthesizedGreeting = null;
  preSynthesizedPleaseLeave = null;
  if (ringTimeoutId !== null) {
    clearTimeout(ringTimeoutId);
    ringTimeoutId = null;
  }
}
