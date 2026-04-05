import { CallerIdParser } from './callerIdParser';
import { CallerScreener } from './screener';
import { VoicemailRecorder } from './voicemail';
import { TtsEngine } from './tts';
import { GpioController } from './gpio';
import { insertCallLog, insertMessage, getSettings, isWhitelisted, isBlacklisted } from '../db';
import { callEvents, modemLog } from '../events';
import { sendCallEmail } from '../email';
import { publishCallMqtt } from '../mqtt';
import { config } from '../config';
import path from 'path';
import { sleep } from '../sleep';
import type { CallerIdInfo } from './callerIdParser';
import type { Modem } from './modem';
import { dtmfToneCmd } from './modem';
import type { ScreeningResult } from './screener';

const RING_INTERVAL_MS = 6000;
const RING_TIMEOUT_BUFFER_MS = 2000;

export class CallHandler {
  private ringCount = 0;
  private currentCallInfo: CallerIdInfo | null = null;
  private isHandlingCall = false;
  private isWaitingForRings = false;
  private screeningPromise: Promise<ScreeningResult> | null = null;
  private ringTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private waitRingCount = 0;
  private preSynthesizedGreeting: Buffer[] | null = null;
  private preSynthesizedPleaseLeave: Buffer[] | null = null;
  private started = false;

  constructor(
    private readonly modem: Modem,
    private readonly screener: CallerScreener,
    private readonly recorder: VoicemailRecorder,
    private readonly tts: TtsEngine,
    private readonly gpio: GpioController,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.modem.on(async (event) => {
      try {
        switch (event.type) {
          case 'RING':
            callEvents.emit('RING');
            await this.handleRing();
            break;
          case 'CALLER_ID':
            this.currentCallInfo = event.info;
            callEvents.emit('CALLER_ID', event.info);
            modemLog('info', `Caller ID: name="${event.info.name ?? 'unknown'}" number="${event.info.number ?? 'unknown'}"`);
            modemLog('info', `Screening caller: ${event.info.name ?? 'UNKNOWN'} <${event.info.number ?? 'UNKNOWN'}>...`);
            this.screeningPromise = this.screener.screen(event.info.name ?? 'UNKNOWN', event.info.number ?? 'UNKNOWN').catch(err => {
              modemLog('error', `Screening failed: ${err}`);
              return { action: 'Screened' as const, reason: 'Screening error' };
            });
            this.kickOffPreSynthesis().catch(() => {});
            break;
          case 'CALL_END':
            callEvents.emit('CALL_END');
            await this.handleCallEnd();
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
  }

  private scheduleRingTimeout(): void {
    if (this.ringTimeoutId !== null) clearTimeout(this.ringTimeoutId);
    this.ringTimeoutId = setTimeout(() => {
      this.ringTimeoutId = null;
      if ((this.isWaitingForRings || !this.isHandlingCall) && this.ringCount > 0) {
        modemLog('info', 'No additional ring received — caller likely hung up, resetting state');
        this.resetCallState();
      }
    }, RING_INTERVAL_MS + RING_TIMEOUT_BUFFER_MS);
  }

  private async handleRing(): Promise<void> {
    if (this.isHandlingCall) {
      // Always refresh the ring timeout so it tracks the latest ring,
      // regardless of whether we are currently in waitForRings().
      this.scheduleRingTimeout();
      if (this.isWaitingForRings) this.waitRingCount++;
      return;
    }
    this.ringCount++;
    modemLog('info', `RING #${this.ringCount}`);
    this.scheduleRingTimeout();

    if (this.ringCount === 1) {
      this.gpio.blinkLed(GpioController.PINS.RING, 1).catch(() => {});
      // Caller ID normally arrives within ~2s after ring 1.
      // Poll up to 3.5s — if it arrives, process immediately (fast path).
      // If not, return and let ring 2 trigger as the fallback.
      const callerIdArrived = await this.waitForScreeningWithTimeout(3500);
      if (!callerIdArrived) return;
      // Fall through to process the call now, before ring 2
    }

    // Lock before any further awaits.
    // Intentionally placed AFTER waitForScreeningWithTimeout() on ring 1: if no
    // caller ID arrived within 3.5s, ring 1 returned early without locking, so
    // ring 2 enters as a full handler (the UNKNOWN fallback path). This is safe
    // because modem events are dispatched serially from a single serial port
    // listener — two ring handlers cannot interleave at this point in practice.
    this.isHandlingCall = true;

    await this.gpio.blinkLed(GpioController.PINS.RING, 1);

    // After ring 2, proceed even without caller ID (treat as unknown)
    const name = this.currentCallInfo?.name ?? 'UNKNOWN';
    const number = this.currentCallInfo?.number ?? 'UNKNOWN';

    if (!this.currentCallInfo) {
      modemLog('warn', 'No caller ID received — treating as unknown caller');
    }

    const date = this.currentCallInfo?.date
      ? CallerIdParser.formatDate(this.currentCallInfo.date)
      : new Date().toLocaleDateString();
    const time = this.currentCallInfo?.time
      ? CallerIdParser.formatTime(this.currentCallInfo.time)
      : new Date().toLocaleTimeString();
    const systemDateTime = new Date().toISOString();

    modemLog('info', `Incoming call from: ${name} <${number}>`);

    let screening: ScreeningResult;
    if (this.screeningPromise) {
      screening = await this.screeningPromise;
    } else {
      // No caller ID received — screen as unknown
      try {
        screening = await this.screener.screen(name, number);
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

    const resolvedName = await this.resolveCallerName(name, number);
    callEvents.emit('incoming-call', { callLogId, name: resolvedName, number, date, time, action: screening.action, reason: screening.reason });

    const emailSnapshot: { action: 'Permitted' | 'Blocked' | 'Screened'; name: string; number: string; date: string; time: string; systemDateTime: string; reason: string; voicemailFilename?: string } = {
      action: screening.action, name: resolvedName, number, date, time, systemDateTime, reason: screening.reason,
    };

    let voicemailFilename: string | null = null;
    if (screening.action === 'Blocked') {
      voicemailFilename = await this.handleBlockedCall(callLogId, this.ringCount, name, number);
    } else if (screening.action === 'Permitted') {
      voicemailFilename = await this.handlePermittedCall(callLogId, name, number);
    } else {
      voicemailFilename = await this.handleScreenedCall(callLogId, this.ringCount, name, number, screening.immediate);
    }
    if (voicemailFilename) emailSnapshot.voicemailFilename = voicemailFilename;
    callEvents.emit('call-resolved', { action: screening.action, number });
    sendCallEmail(emailSnapshot).catch((err) => modemLog('warn', `Failed to send call email: ${err}`));
    publishCallMqtt(emailSnapshot).catch((err) => modemLog('warn', `Failed to publish call MQTT: ${err}`));
  }

  private async handleBlockedCall(callLogId: number, currentRing: number, name: string, number: string): Promise<string | null> {
    const settings = await getSettings();
    const dtmfKey = settings.dtmfRemovalEnabled ? settings.dtmfRemovalKey : undefined;

    // Action 3: send to voicemail after N rings
    if (settings.blocklistAction === 3) {
      const ringsLeft = Math.max(0, settings.ringsBeforeVmBlocklist - currentRing);
      modemLog('info', `Blocked caller — sending to voicemail after ${ringsLeft} more ring(s)`);
      await this.waitForRings(ringsLeft);
      if (!this.isHandlingCall) { modemLog('info', 'Blocked call aborted — caller hung up'); return null; }
      const filename = await this.goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number, settings.savePcmDebug, dtmfKey);
      await this.gpio.blinkLed(GpioController.PINS.BLOCKED, 1);
      return filename;
    }

    // Action 1: hang up silently
    // Action 2: play blocked greeting then hang up (default)
    modemLog('info', 'Answering blocked call — entering voice mode');
    await this.modem.answer();
    await sleep(1000);

    if (settings.blocklistAction === 2) {
      try {
        const text = await this.recorder.readScriptFile('blocked_greeting');
        modemLog('info', 'Synthesizing blocked_greeting via TTS');
        await this.modem.playAudioStream(this.tts.synthesize(text, this.resolveModelPath(settings.greetingVoice), settings.greetingLengthScale));
      } catch (err) {
        modemLog('warn', `Could not play blocked greeting: ${err}`);
      }
      await sleep(500);
    }

    if (dtmfKey) {
      const cmd = dtmfToneCmd(dtmfKey);
      if (cmd) {
        modemLog('info', `Sending DTMF removal key '${dtmfKey}' to blocked caller`);
        await this.modem.sendCommand(cmd, 1000);
        await sleep(120);
      } else {
        modemLog('warn', `DTMF removal key '${dtmfKey}' not in frequency table — skipping`);
      }
    }

    await this.modem.hangUp();
    modemLog('info', 'Hung up blocked call');
    await this.gpio.blinkLed(GpioController.PINS.BLOCKED, 1);
    this.resetCallState();
    return null;
  }

  private async handlePermittedCall(callLogId: number, name: string, number: string): Promise<string | null> {
    const settings = await getSettings();
    const ringsLeft = settings.ringsBeforeVm - this.ringCount;
    modemLog('info', `Permitted caller — waiting ${ringsLeft} more ring(s) before voicemail`);
    await this.waitForRings(ringsLeft);
    if (!this.isHandlingCall) { modemLog('info', 'Permitted call aborted — caller hung up'); return null; }
    const filename = await this.goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number, settings.savePcmDebug);
    await this.gpio.blinkLed(GpioController.PINS.ALLOWED, 1);
    return filename;
  }

  private async handleScreenedCall(callLogId: number, currentRing: number, name: string, number: string, immediate = false): Promise<string | null> {
    const settings = await getSettings();
    const ringsLeft = immediate ? 0 : Math.max(0, settings.ringsBeforeVmScreened - currentRing);
    modemLog('info', `Screened caller — answering after ${ringsLeft} more ring(s)`);
    await this.waitForRings(ringsLeft);
    if (!this.isHandlingCall) { modemLog('info', 'Screened call aborted — caller hung up'); return null; }
    return this.goToVoicemail(callLogId, 'general_greeting', settings.greetingVoice, settings.greetingLengthScale, name, number, settings.savePcmDebug);
  }

  private resolveModelPath(modelFilename: string): string {
    return path.join(path.resolve(config.piperModelsDir), modelFilename);
  }

  private async goToVoicemail(callLogId: number, greetingBasename: string, voice: string, lengthScale: number, name: string, number: string, savePcmDebug = false, dtmfKey?: string): Promise<string | null> {
    modemLog('info', 'Answering call — entering voice mode (AT+FCLASS=8 → AT+VLS=1)...');
    try {
      await this.modem.answer();
      modemLog('info', 'Call answered — off hook');
    } catch (err) {
      modemLog('error', `Failed to answer call: ${err}`);
      this.resetCallState();
      return null;
    }
    await sleep(1000);

    try {
      if (this.preSynthesizedGreeting && this.preSynthesizedPleaseLeave) {
        modemLog('info', 'Playing pre-synthesized greeting audio');
        await this.modem.playAudioStream(this.fromBuffers(this.preSynthesizedGreeting));
        await this.modem.playAudioStream(this.fromBuffers(this.preSynthesizedPleaseLeave));
      } else {
        const greetingText = await this.recorder.readScriptFile(greetingBasename);
        modemLog('info', `Synthesizing ${greetingBasename} via TTS`);
        await this.modem.playAudioStream(this.tts.synthesize(greetingText, this.resolveModelPath(voice), lengthScale));

        const pleaseLeaveText = await this.recorder.readScriptFile('please_leave_message');
        modemLog('info', 'Synthesizing please_leave_message via TTS');
        await this.modem.playAudioStream(this.tts.synthesize(pleaseLeaveText, this.resolveModelPath(voice), lengthScale));
      }
      callEvents.emit('greeting-played');
    } catch (err) {
      modemLog('warn', `Could not play greeting: ${err}`);
    }

    // If the caller hung up during greeting playback, CALL_END will have fired
    // and reset isHandlingCall to false — skip recording entirely.
    if (!this.isHandlingCall) {
      modemLog('info', 'Caller hung up during greeting — skipping recording');
      await this.modem.hangUp().catch(() => {});
      this.resetCallState();
      return null;
    }

    modemLog('info', 'Starting recording — playing beep then AT+VRX...');
    await this.modem.startRecording(dtmfKey ? { dtmfKey } : undefined);
    modemLog('info', 'Recording voicemail...');
    callEvents.emit('recording-started');

    // Wait until caller hangs up (inVoiceMode → false via DLE code) or 120s timeout.
    // Also check isHandlingCall: if the caller hung up during the beep inside
    // startRecording(), isOffHook detection emits CALL_END and resets
    // isHandlingCall before inVoiceMode is set, so startRecording() can still
    // enter VRX mode after the caller is already gone.
    // Silence fallback: some modems (e.g. MT9234MU) don't send DLE hang-up
    // codes into the VRX stream. Mirrors the original Python project's approach:
    // stop after ~5s of consecutive fully-silent audio (all bytes in [126,129]).
    const SILENCE_HANGUP_MS = 5000;
    let waited = 0;
    let silenceReason = false;
    while (this.modem.isRecording() && this.isHandlingCall && waited < 120000) {
      await sleep(500);
      waited += 500;
      if (this.modem.hasSustainedSilence(SILENCE_HANGUP_MS)) {
        silenceReason = true;
        break;
      }
    }

    if (this.modem.isRecording()) {
      if (silenceReason) {
        modemLog('info', `${SILENCE_HANGUP_MS / 1000}s of silence — caller likely hung up, stopping recording`);
      } else if (waited >= 120000) {
        modemLog('info', 'Recording timeout — stopping recording');
      } else {
        modemLog('info', 'Caller hung up — stopping recording');
      }
    }
    await this.modem.stopRecording();

    const pcmData = this.modem.getRecordedBuffer();
    modemLog('info', `Recording ended — ${pcmData.length} bytes captured`);

    // 8000 bytes = 1 second at 8kHz 8-bit mono — filters hang-up transients
    let savedFilename: string | null = null;
    if (pcmData.length > 8000) {
      try {
        const filename = await this.recorder.savePcmAsMP3(pcmData, callLogId, number, name, savePcmDebug);
        if (filename) {
          await insertMessage({ CallLogID: callLogId, Played: 0, Filename: filename, DateTime: new Date().toISOString() });
          modemLog('info', `Voicemail saved: ${filename}`);
          callEvents.emit('new-voicemail', { callLogId, filename });
          savedFilename = filename;
        } else {
          modemLog('info', 'Recording discarded — insufficient audio content after trimming');
        }
      } catch (err) {
        modemLog('error', `Failed to save voicemail: ${err}`);
      }
    } else {
      modemLog('info', 'No voicemail left (silence or too short)');
    }

    await this.modem.hangUp();
    modemLog('info', 'Call ended — on hook');
    this.resetCallState();
    return savedFilename;
  }

  private async handleCallEnd(): Promise<void> {
    if (this.isHandlingCall || this.ringCount > 0) {
      modemLog('info', 'Call ended');
      this.resetCallState();
    }
  }

  private async waitForRings(count: number): Promise<void> {
    if (count <= 0) return;
    modemLog('info', `Waiting for ${count} more ring(s)...`);
    this.isWaitingForRings = true;
    this.waitRingCount = 0;
    // Arm a fresh timeout at the start of the wait. If rings stopped before
    // waitForRings() was entered (e.g. callee answered during screening), the
    // earlier ring timeout may have already fired harmlessly. Without this, the
    // loop would run to completion and kick off voicemail even though no further
    // rings arrived — matching Python's wait_for_rings() abort-on-silence logic.
    this.scheduleRingTimeout();
    // Wait for `count` actual ring events rather than a fixed time duration.
    // Previously this was a fixed countdown (count × RING_INTERVAL_MS), which
    // caused a race: if the last ring arrived near the end of the window, the
    // ring timeout that detects "another phone picked up" fired ~1s AFTER the
    // countdown expired — too late to abort. Counting real rings means we only
    // exit after the Nth ring is confirmed, so the ring timeout always has a
    // full RING_INTERVAL_MS + RING_TIMEOUT_BUFFER_MS window to fire after the
    // last ring before we proceed.
    while (this.isHandlingCall && this.waitRingCount < count) {
      await sleep(100);
    }
    this.isWaitingForRings = false;
  }

  private resetCallState(): void {
    this.ringCount = 0;
    this.currentCallInfo = null;
    this.isHandlingCall = false;
    this.isWaitingForRings = false;
    this.screeningPromise = null;
    this.preSynthesizedGreeting = null;
    this.preSynthesizedPleaseLeave = null;
    this.waitRingCount = 0;
    if (this.ringTimeoutId !== null) {
      clearTimeout(this.ringTimeoutId);
      this.ringTimeoutId = null;
    }
  }

  private async resolveCallerName(name: string, number: string): Promise<string> {
    if (number && number !== 'P' && number !== 'O') {
      const wl = await isWhitelisted(number).catch(() => undefined);
      if (wl?.name) return wl.name;
      const bl = await isBlacklisted(number).catch(() => undefined);
      if (bl?.name) return bl.name;
    }
    if (!name || name === 'O') return 'UNKNOWN';
    return name;
  }

  private async *fromBuffers(chunks: Buffer[]): AsyncGenerator<Buffer> {
    for (const chunk of chunks) yield chunk;
  }

  private async kickOffPreSynthesis(): Promise<void> {
    try {
      const settings = await getSettings();
      if (!settings.greetingVoice) return;
      const modelPath = this.resolveModelPath(settings.greetingVoice);
      const [greetingText, pleaseLeaveText] = await Promise.all([
        this.recorder.readScriptFile('general_greeting'),
        this.recorder.readScriptFile('please_leave_message'),
      ]);
      const collectChunks = async (gen: AsyncGenerator<Buffer>): Promise<Buffer[]> => {
        const chunks: Buffer[] = [];
        for await (const chunk of gen) chunks.push(chunk);
        return chunks;
      };
      const [greetingChunks, pleaseLeaveChunks] = await Promise.all([
        collectChunks(this.tts.synthesize(greetingText, modelPath, settings.greetingLengthScale)),
        collectChunks(this.tts.synthesize(pleaseLeaveText, modelPath, settings.greetingLengthScale)),
      ]);
      this.preSynthesizedGreeting = greetingChunks;
      this.preSynthesizedPleaseLeave = pleaseLeaveChunks;
      modemLog('info', 'Pre-synthesis complete — greeting audio buffered');
    } catch (err) {
      modemLog('warn', `Pre-synthesis failed (will synthesize on demand): ${err}`);
    }
  }

  private async waitForScreeningWithTimeout(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.screeningPromise !== null) return true;
      await sleep(100);
    }
    return false;
  }
}
