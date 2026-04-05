import { config } from '../config';
import { CallerIdParser } from './callerIdParser';
import type { CallerIdInfo } from './callerIdParser';

// Lazily imported to avoid crashing on platforms where serialport's
// native libuv bindings aren't available (e.g. Bun without uv_default_loop).
type SerialPortType = import('serialport').SerialPort;

export type ModemModel = 'USR' | 'CONEXANT' | 'MT9234MU' | 'UNKNOWN';

export type ModemEvent =
  | { type: 'RING' }
  | { type: 'CALLER_ID'; info: CallerIdInfo }
  | { type: 'CALL_END' }
  | { type: 'VOICE_DATA'; chunk: Buffer }
  | { type: 'ERROR'; error: Error };

// ─── Model-specific AT command variants ────────────────────────────────────

// AT+VSM: voice compression (8-bit PCM, 8kHz)
const VOICE_COMPRESSION: Record<ModemModel, string> = {
  USR:      'AT+VSM=128,8000',     // 8-bit linear
  CONEXANT: 'AT+VSM=1,8000,0,0',  // 8-bit unsigned PCM
  MT9234MU: 'AT+VSM=128,8000',
  UNKNOWN:  'AT+VSM=128,8000',
};

// AT+VSD: silence detection config per modem — two variants needed:
//
// ANSWER phase (during greeting playback): disable silence detection so the
//   modem does not inject <DLE>s mid-greeting.
//   USR manual Example #7: AT+VSD=128,0 before AT+VLS=1.
//
// RECORD phase (during AT+VRX): enable hardware silence detection so the modem
//   injects <DLE>s when caller goes silent, triggering hang-up detection.
//   USR manual Example #7: AT+VSD=128,50 before AT+VRX (5.0s silence interval).
//   MT9234MU: same (128,50) — hardware silence detection always used for VRX.
//   CONEXANT: keep disabled (0,0) — use software silence detection instead.
const SILENCE_DETECTION_CMD: Record<ModemModel, string> = {
  USR:      'AT+VSD=128,0',   // disabled during answer/greeting
  CONEXANT: 'AT+VSD=0,0',
  MT9234MU: 'AT+VSD=128,50',
  UNKNOWN:  'AT+VSD=128,0',
};

// AT+VSD to apply immediately before AT+VRX (recording phase).
// USR new firmware manual Example #7: AT+VSD=128,50 before AT+VRX — enables
//   hardware silence detection (5.0s interval) so modem injects <DLE>s on silence.
// MT9234MU: same (128,50).
// CONEXANT: keep disabled (0,0) — software silence detection only.
const SILENCE_DETECTION_RECORD_CMD: Record<ModemModel, string> = {
  USR:      'AT+VSD=128,50',  // new firmware Example #7: enable 5s hardware silence
  CONEXANT: 'AT+VSD=0,0',    // keep disabled; software silence detection only
  MT9234MU: 'AT+VSD=128,50', // enable hardware silence detection
  UNKNOWN:  'AT+VSD=128,0',
};

// Whether to re-send the full voice setup before each audio operation even when
// already off-hook. New USR firmware maintains state between operations — no need
// to re-send VLS=1 multiple times (Example #7 sends it only once to answer).
const RESEND_SETUP_PER_OP: Record<ModemModel, boolean> = {
  USR:      false,
  CONEXANT: false,
  MT9234MU: false,
  UNKNOWN:  false,
};

// AT+VLS to switch to before AT+VRX (recording phase).
// USR new firmware manual Example #7: switch to VLS=5 ("Speaker connected to DCE,
//   DCE off-hook — call screening") before AT+VRX to route PSTN audio into the
//   modem receive path.  Without this, VRX in VLS=1 mode does not capture line audio.
// Other modems: null = no VLS change needed before VRX.
const VLS_RECORD_CMD: Record<ModemModel, string | null> = {
  USR:      'AT+VLS=5',
  CONEXANT: null,
  MT9234MU: null,
  UNKNOWN:  null,
};

// DTE→DCE: end voice transmit  (<DLE><ETX> or triple-DLE for Conexant)
const END_VOICE_TX: Record<ModemModel, Buffer> = {
  USR:      Buffer.from([0x10, 0x03]),
  CONEXANT: Buffer.from([0x10, 0x10, 0x10, 0x03]),
  MT9234MU: Buffer.from([0x10, 0x03]),
  UNKNOWN:  Buffer.from([0x10, 0x03]),
};

// DTE→DCE: end voice receive
//   USR/MT9234MU/UNKNOWN:  <DLE>!  (IS-101 compatible)
//   CONEXANT:              <DLE><DLE><DLE>!  (triple-DLE required by Conexant)
const END_VOICE_RX: Record<ModemModel, Buffer> = {
  USR:      Buffer.from([0x10, 0x21]),
  CONEXANT: Buffer.from([0x10, 0x10, 0x10, 0x21]),
  MT9234MU: Buffer.from([0x10, 0x21]),
  UNKNOWN:  Buffer.from([0x10, 0x21]),
};

// AT+VGR: receive (recording) gain boost applied before AT+VRX.
//   USR:      range 121-134 effective (manual clamps outside); 128=nominal, 134=max
//   CONEXANT: null — only VGR=0 (AGC) is valid per manual; no manual gain
//   MT9234MU: range 0-255; 128=nominal, higher values amplify
//   The command is skipped (null) when the modem doesn't support manual gain.
const RECORD_GAIN: Record<ModemModel, string | null> = {
  USR:      'AT+VGR=134',  // max useful per manual (effective range 121-134)
  CONEXANT: null,          // AGC only — VGR=0 is the only valid value
  MT9234MU: 'AT+VGR=180', // boosted above nominal (128); full range 0-255
  UNKNOWN:  'AT+VGR=134',
};

// AT+VGT: transmit (playback) volume applied before AT+VTX.
//   All modems: 128=nominal (default), 0-255 range.
//   USR new firmware manual Example #7 uses VGT=128 (nominal).
const PLAYBACK_VOLUME: Record<ModemModel, string> = {
  USR:      'AT+VGT=128',  // nominal per new firmware manual Example #7
  CONEXANT: 'AT+VGT=200',
  MT9234MU: 'AT+VGT=200',
  UNKNOWN:  'AT+VGT=200',
};

// AT+VTS beep played after greeting, before recording.
//   Format: [freq1,freq2,duration×10ms]
//   USR new firmware manual Example #7 shows [933,0,120] but freq2=0 is below the
//   300–3300 Hz valid range and returns ERROR on some firmware. Using [933,933,120]
//   (single frequency, both params same) avoids the rejection.
//   Other modems: dual 900 Hz tone, 1.2 seconds.
const VOICE_TONE_BEEP: Record<ModemModel, string> = {
  USR:      'AT+VTS=[933,933,120]',
  CONEXANT: 'AT+VTS=[900,900,120]',
  MT9234MU: 'AT+VTS=[900,900,120]',
  UNKNOWN:  'AT+VTS=[900,900,120]',
};

// Audio chunk sleep interval (ms) while streaming audio to modem
const AUDIO_CHUNK_SLEEP: Record<ModemModel, number> = {
  USR:      100,
  CONEXANT: 30,
  MT9234MU: 30,
  UNKNOWN:  100,
};

// DCE→DTE: DLE-shielded hang-up/termination codes (sourced from each modem's manual)
//   <DLE><ETX> 0x03 — end of voice data        USR ✓  CONEXANT ✓  MT9234MU ✓
//   <DLE>H     0x48 — line current detected     USR ✓  CONEXANT ✓  MT9234MU ✓
//   <DLE>b     0x62 — busy tone                 USR ✓  CONEXANT ✓  MT9234MU ✓
//   <DLE>d     0x64 — dial tone                 USR ✓  CONEXANT ✓  MT9234MU ✓
//   <DLE>h     0x68 — line current break        USR ✓  CONEXANT ✓  MT9234MU —
//   <DLE>l     0x6C — loop current interruption USR ✗  CONEXANT ✓  MT9234MU —
const DCE_END_VOICE_DATA     = Buffer.from([0x10, 0x03]);
const DCE_PHONE_OFF_HOOK     = Buffer.from([0x10, 0x48]);
const DCE_BUSY_TONE          = Buffer.from([0x10, 0x62]);
const DCE_DIAL_TONE          = Buffer.from([0x10, 0x64]);
const DCE_LINE_CURRENT_BREAK = Buffer.from([0x10, 0x68]);
const DCE_LOOP_CURRENT_INT   = Buffer.from([0x10, 0x6C]); // NOT sent by USR5637 or MT9234MU
const DCE_SILENCE_DETECTED   = Buffer.from([0x10, 0x73]); // Event 9: Presumed Hang Up "SILENCE"
const DCE_QUIET_DETECTED     = Buffer.from([0x10, 0x71]); // Event 10: Presumed End of Message "QUIET"

// Per-model hang-up sequences — only codes documented for that modem.
// Using another modem's codes risks false positives from valid voice data bytes.
//
// USR 5637 notes (per manual Table 189):
//   <DLE>H (DCE_PHONE_OFF_HOOK) means "Local phone off-hook" — a parallel
//   handset was picked up, OR the modem emits it as a self-confirmation after
//   AT+VLS=1.  Including it as a hang-up trigger causes a false CALL_END
//   immediately after answering, so it is intentionally excluded here.
//   <DLE>s (DCE_SILENCE_DETECTED) is only injected when AT+VSD=128,50 is
//   active (recording phase); it is safe to include in the list at all times
//   because the modem won't send it during greeting playback (VSD=128,0).
//
// MT9234MU includes <DLE>s and <DLE>q which are injected when AT+VSD hardware
// silence detection fires (see SILENCE_DETECTION_CMD above).
const HANGUP_SEQS: Record<ModemModel, Buffer[]> = {
  USR:      [DCE_END_VOICE_DATA, DCE_LINE_CURRENT_BREAK, DCE_BUSY_TONE, DCE_DIAL_TONE, DCE_SILENCE_DETECTED],
  CONEXANT: [DCE_END_VOICE_DATA, DCE_PHONE_OFF_HOOK, DCE_LINE_CURRENT_BREAK, DCE_LOOP_CURRENT_INT, DCE_BUSY_TONE, DCE_DIAL_TONE],
  MT9234MU: [DCE_END_VOICE_DATA, DCE_PHONE_OFF_HOOK, DCE_BUSY_TONE, DCE_DIAL_TONE, DCE_SILENCE_DETECTED, DCE_QUIET_DETECTED],
  UNKNOWN:  [DCE_END_VOICE_DATA, DCE_PHONE_OFF_HOOK, DCE_LINE_CURRENT_BREAK, DCE_BUSY_TONE, DCE_DIAL_TONE],
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class Modem {
  private port: SerialPortType | null = null;
  private parser = new CallerIdParser();
  private listeners: ((event: ModemEvent) => void)[] = [];
  model: ModemModel = 'UNKNOWN';

  // Optional logger wired up by index.ts to route AT command responses to the
  // debug console (via modemLog). If null, responses only go to console.log.
  onLog: ((msg: string) => void) | null = null;

  private inVoiceMode = false;
  private isOffHook = false;   // true between answer() and hangUp()
  private dleCarry = false;    // last byte of previous voice chunk was 0x10 (DLE)
  private voiceBuffer: Buffer[] = [];
  private textBuffer = '';

  constructor() {
    this.parser.onCallerId((info) => {
      this.emit({ type: 'CALLER_ID', info });
    });
  }

  on(cb: (event: ModemEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit(event: ModemEvent): void {
    for (const l of this.listeners) l(event);
  }

  private log(msg: string): void {
    console.log(msg);
    this.onLog?.(msg);
  }

  // ─── Serial port ──────────────────────────────────────────────────────────

  async open(): Promise<void> {
    const { SerialPort } = await import('serialport');

    this.port = new SerialPort({
      path: config.serialPort,
      baudRate: config.serialBaudRate,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.port!.open((err) => err ? reject(err) : resolve());
    });

    this.port.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.port.on('error', (err: Error) => this.emit({ type: 'ERROR', error: err }));
    this.port.on('close', () => console.log('[modem] Port closed'));

    console.log(`[modem] Opened ${config.serialPort} at ${config.serialBaudRate} baud`);
    await this.initModem();
  }

  async close(): Promise<void> {
    if (this.port?.isOpen) {
      await new Promise<void>((resolve) => this.port!.close(() => resolve()));
    }
  }

  isOpen(): boolean {
    return this.port?.isOpen ?? false;
  }

  isRecording(): boolean {
    return this.inVoiceMode;
  }

  // ─── Data handler ─────────────────────────────────────────────────────────

  private handleData(chunk: Buffer): void {
    const hangupSeqs = HANGUP_SEQS[this.model];

    if (this.inVoiceMode) {
      // Re-attach any DLE byte that was split off the end of the previous chunk.
      // Serial data can arrive in arbitrary boundaries; without this a hang-up
      // sequence like [0x10][0x68] split across two chunks would go undetected.
      if (this.dleCarry) {
        chunk = Buffer.concat([Buffer.from([0x10]), chunk]);
        this.dleCarry = false;
      }

      // Check for modem status codes that signal end of recording.
      // Only codes in this modem's HANGUP_SEQS are checked — prevents false
      // positives from voice data bytes that match another modem's DLE codes.
      if (chunk.includes(0x10)) {
        const hitIdx = hangupSeqs.map(seq => chunk.indexOf(seq)).filter(i => i !== -1);
        if (hitIdx.length > 0) {
          const termIdx = Math.min(...hitIdx);
          if (termIdx > 0) this.voiceBuffer.push(chunk.slice(0, termIdx));
          this.inVoiceMode = false;
          this.dleCarry = false;
          const dleCode = chunk[termIdx + 1]?.toString(16).padStart(2, '0') ?? '??';
          console.log(`[modem] Hang-up DLE code detected during VRX: 0x10 0x${dleCode}`);
          this.emit({ type: 'CALL_END' });
          return;
        }

        // If the last byte is 0x10, it might be the first half of a split hang-up
        // sequence — carry it forward to prepend on the next chunk.
        if (chunk[chunk.length - 1] === 0x10) {
          this.dleCarry = true;
          chunk = chunk.slice(0, -1);
        }
      }
      this.voiceBuffer.push(chunk);
      this.emit({ type: 'VOICE_DATA', chunk });
      return;
    }

    // While off-hook but not yet recording (i.e. during greeting playback),
    // the modem sends DLE-escaped codes for hang-up rather than "NO CARRIER".
    // Detect them here so goToVoicemail can skip recording.
    if (this.isOffHook && chunk.includes(0x10)) {
      if (hangupSeqs.some(seq => chunk.indexOf(seq) !== -1)) {
        this.isOffHook = false;
        this.inVoiceMode = false;
        this.emit({ type: 'CALL_END' });
        return;
      }
    }

    // Text mode: accumulate and scan for known modem responses
    const text = chunk.toString('ascii');
    this.textBuffer += text;
    this.parser.feed(text);

    if (this.textBuffer.includes('RING')) {
      this.textBuffer = this.textBuffer.replace(/RING/g, '');
      this.emit({ type: 'RING' });
    }

    if (this.textBuffer.includes('NO CARRIER')) {
      this.textBuffer = this.textBuffer.replace(/NO CARRIER/g, '');
      this.emit({ type: 'CALL_END' });
    }

    if (this.textBuffer.length > 1000) {
      this.textBuffer = this.textBuffer.slice(-500);
    }
  }

  // ─── AT command helpers ───────────────────────────────────────────────────

  async sendCommand(cmd: string, delayMs = 300): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) {
        reject(new Error('Port not open'));
        return;
      }

      let response = '';
      const timeout = setTimeout(() => {
        this.port!.removeListener('data', onData);
        const trimmed = response.replace(/[\r\n]+/g, ' ').trim();
        this.log(`[AT] ${cmd} → TIMEOUT (got: "${trimmed}")`);
        resolve(response);
      }, delayMs + 500);

      const onData = (chunk: Buffer) => {
        response += chunk.toString('ascii');
        if (response.includes('OK') || response.includes('ERROR') || response.includes('CONNECT') || response.includes('VCON')) {
          clearTimeout(timeout);
          this.port!.removeListener('data', onData);
          const trimmed = response.replace(/[\r\n]+/g, ' ').trim();
          this.log(`[AT] ${cmd} → ${trimmed}`);
          resolve(response);
        }
      };

      this.port!.on('data', onData);
      this.port!.write(`${cmd}\r`, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.port!.removeListener('data', onData);
          reject(err);
        }
      });
    });
  }

  private async writeRaw(data: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.port!.write(data, (err) => err ? reject(err) : resolve());
    });
  }

  // Send raw bytes and wait for the modem's OK/ERROR response.
  // Used to end voice TX/RX sessions (DLE+ETX / DLE+!) — the modem responds
  // with OK after processing these, and consuming it here prevents the stale OK
  // from polluting subsequent sendCommand listeners.
  private async writeRawAndWait(data: Buffer, delayMs = 500): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port?.isOpen) { resolve(); return; }
      let response = '';
      const timeout = setTimeout(() => {
        this.port!.removeListener('data', onData);
        resolve();
      }, delayMs + 500);
      const onData = (chunk: Buffer) => {
        response += chunk.toString('ascii');
        if (response.includes('OK') || response.includes('ERROR')) {
          clearTimeout(timeout);
          this.port!.removeListener('data', onData);
          resolve();
        }
      };
      this.port!.on('data', onData);
      this.port!.write(data, (err) => {
        if (err) { clearTimeout(timeout); this.port!.removeListener('data', onData); resolve(); }
      });
    });
  }

  // ─── Modem init ───────────────────────────────────────────────────────────

  async initModem(): Promise<void> {
    console.log('[modem] Sending init sequence...');

    // Escape from any voice data mode the modem may be stuck in (e.g. after a
    // recording session that was aborted uncleanly — modem left in AT+VRX mode).
    // +++ requires a ≥1s guard time on both sides; if already in command mode
    // the modem returns ERROR (harmless — we ignore the response).
    await sleep(1100);
    await this.writeRaw(Buffer.from('+++'));
    await sleep(1100);

    await this.sendCommand('ATH0', 500);   // ensure on-hook before full reset
    await this.sendCommand('ATZ', 1500);   // factory reset (longer delay for MT modems)
    await this.sendCommand('ATE0', 500);
    await this.sendCommand('AT+FCLASS=0', 500); // explicitly clear voice class before detect

    this.model = await this.detectModel();

    await this.sendCommand('ATV1', 500);       // Verbose result codes
    await this.sendCommand('AT+VCID=1', 500);  // Enable formatted caller ID
    await this.sendCommand('ATM0', 500);        // Disable speaker
    // NOTE: AT+FCLASS=8 is NOT sent here — it changes how RING is reported
    // (Conexant sends <DLE>R instead of text "RING"). Only set it before answering.
    console.log('[modem] Init complete');
  }

  private async detectModel(): Promise<ModemModel> {
    const response = await this.sendCommand('ATI0', 1000);
    if (response.includes('5601'))    { console.log('[modem] US Robotics 5637 detected');      return 'USR'; }
    if (response.includes('56000'))   { console.log('[modem] Conexant-based modem detected');   return 'CONEXANT'; }
    if (response.includes('MT9234MU')) { console.log('[modem] MT9234MU modem detected');        return 'MT9234MU'; }
    console.log('[modem] Unknown modem — using USR-compatible defaults');
    return 'UNKNOWN';
  }

  // ─── Call control ─────────────────────────────────────────────────────────

  /**
   * Answer the call: configure voice mode and go off-hook (TAD mode).
   *
   * USR new firmware manual Example #7:
   *   FCLASS=8 → VGT=128 → VSM=128,8000 → VSD=128,0 → VLS=1
   * Setup is sent once here; play/record calls skip it (RESEND_SETUP_PER_OP=false).
   */
  async answer(): Promise<void> {
    await this.sendCommand('AT+FCLASS=8', 500);
    if (!RESEND_SETUP_PER_OP[this.model]) {
      // For modems that send setup only once, include VGT/VSM here
      await this.sendCommand(PLAYBACK_VOLUME[this.model], 500);
      await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
    }
    await this.sendCommand(SILENCE_DETECTION_CMD[this.model], 500);
    await this.sendCommand('AT+VLS=1', 1000);
    this.isOffHook = true;
  }

  /**
   * Hang up: go on-hook and reset voice state.
   * Mirrors Python hang_up(): ATH0
   */
  async hangUp(): Promise<void> {
    // Flush serial buffers before hanging up — discards leftover voice data so it
    // doesn't corrupt the next call's parser state. Mirrors Python's
    // cancel_read() + reset_input_buffer() + reset_output_buffer().
    await new Promise<void>((resolve) => {
      if (!this.port?.isOpen) return resolve();
      this.port.flush((err) => {
        if (err) console.warn('[modem] flush error on hangUp:', err);
        resolve();
      });
    });
    await this.sendCommand('ATH0', 500);
    await this.sendCommand('AT+FCLASS=0', 500); // restore command mode after on-hook
    this.inVoiceMode = false;
    this.isOffHook = false;
    this.dleCarry = false;
    this.voiceBuffer = [];
    this.textBuffer = '';
  }

  // ─── Audio I/O ────────────────────────────────────────────────────────────

  /**
   * Play audio through the modem.
   * Mirrors Python play_audio(): AT+FCLASS=8 → AT+VSM → AT+VLS=1 → AT+VTX (CONNECT) → chunks → DLE+ETX
   */
  async playAudio(audioData: Buffer): Promise<void> {
    if (!this.port?.isOpen) return;

    if (!this.isOffHook || RESEND_SETUP_PER_OP[this.model]) {
      // Re-send full setup: always for USR (matches Python play_audio),
      // or first time only for other modems.
      await this.sendCommand('AT+FCLASS=8', 500);
      await this.sendCommand(PLAYBACK_VOLUME[this.model], 500);
      await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
      await this.sendCommand(SILENCE_DETECTION_CMD[this.model], 500);
      await this.sendCommand('AT+VLS=1', 1000);
    }
    await this.sendCommand('AT+VTX', 2000); // modem responds with CONNECT

    // Stream audio in 1024-byte chunks with inter-chunk sleep (matches Python)
    const chunkSize = 1024;
    const sleepMs = AUDIO_CHUNK_SLEEP[this.model];
    for (let offset = 0; offset < audioData.length; offset += chunkSize) {
      await this.writeRaw(audioData.slice(offset, offset + chunkSize));
      await sleep(sleepMs);
    }

    await this.writeRawAndWait(END_VOICE_TX[this.model], 500);
  }

  /**
   * Stream audio to the modem from an AsyncIterable of raw PCM chunks.
   * Sets up AT+VTX once, then writes chunks as they arrive.
   */
  async playAudioStream(source: AsyncIterable<Buffer>): Promise<void> {
    if (!this.port?.isOpen) return;

    if (!this.isOffHook || RESEND_SETUP_PER_OP[this.model]) {
      // Re-send full setup: always for USR (matches Python play_audio),
      // or first time only for other modems.
      await this.sendCommand('AT+FCLASS=8', 500);
      await this.sendCommand(PLAYBACK_VOLUME[this.model], 500);
      await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
      await this.sendCommand(SILENCE_DETECTION_CMD[this.model], 500);
      await this.sendCommand('AT+VLS=1', 1000);
    }
    await this.sendCommand('AT+VTX', 2000);

    for await (const chunk of source) {
      await this.writeRaw(chunk);
    }

    await this.writeRawAndWait(END_VOICE_TX[this.model], 500);
  }

  /**
   * Start recording voicemail.
   * Per USR 5637 manual Example #7, the sequence after greeting ends is:
   *   VTS (beep) → VSD=128,50 (enable silence detection) → VLS=5 (call screening
   *   mode — routes PSTN audio into modem receive path) → VGR → VRX
   * Other modems: same order but no VLS change (null VLS_RECORD_CMD).
   * If called standalone (no prior answer()), configure everything from scratch.
   */
  async startRecording(opts?: { dtmfKey?: string }): Promise<void> {
    this.voiceBuffer = [];

    if (!this.isOffHook || RESEND_SETUP_PER_OP[this.model]) {
      // Re-send full setup: always for USR (matches Python record_audio),
      // or first time only for other modems.
      await this.sendCommand('AT+FCLASS=8', 500);
      await this.sendCommand(PLAYBACK_VOLUME[this.model], 500);
      await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
      await this.sendCommand(SILENCE_DETECTION_CMD[this.model], 500);
      await this.sendCommand('AT+VLS=1', 1000);
    }

    // Beep first (per manual: VTS before VSD/VLS changes).
    // If a DTMF removal key is configured, send that tone instead of the standard beep.
    const beepCmd = opts?.dtmfKey ? `AT+VTS=${opts.dtmfKey}` : VOICE_TONE_BEEP[this.model];
    await this.sendCommand(beepCmd, 2000);

    // Switch silence detection to recording mode (USR: enable 5s hardware detection)
    await this.sendCommand(SILENCE_DETECTION_RECORD_CMD[this.model], 500);

    // Switch VLS to recording mode if required (USR: VLS=1→VLS=5)
    const vlsRecord = VLS_RECORD_CMD[this.model];
    if (vlsRecord) await this.sendCommand(vlsRecord, 500);

    const recordGain = RECORD_GAIN[this.model];
    if (recordGain) await this.sendCommand(recordGain, 500);

    this.inVoiceMode = true; // set before VRX so incoming voice data is captured
    await this.sendCommand('AT+VRX', 2000); // modem responds with CONNECT
  }

  /**
   * Signal end of voice receive mode to the modem.
   * Mirrors Python DTE_END_VOICE_DATA_RX: <DLE>! (USR/MT9234MU) or <DLE><DLE><DLE>! (Conexant)
   */
  async stopRecording(): Promise<void> {
    if (!this.port?.isOpen) return;
    this.inVoiceMode = false;
    this.dleCarry = false;
    await this.writeRaw(END_VOICE_RX[this.model]);
    await sleep(500);
  }

  getRecordedBuffer(): Buffer {
    return Buffer.concat(this.voiceBuffer);
  }

  /**
   * Returns true if the last silenceMs milliseconds of buffered voice data are
   * all within the 8-bit unsigned PCM silence band (bytes 126–129, centred on 128).
   * Used to detect caller hang-up on modems (e.g. MT9234MU) that do not insert
   * DLE hang-up codes into the AT+VRX audio stream.
   * Returns false if less than silenceMs of audio has been buffered yet.
   */
  hasSustainedSilence(silenceMs: number): boolean {
    const target = Math.round(silenceMs / 1000 * 8000);
    let remaining = target;
    for (let i = this.voiceBuffer.length - 1; i >= 0 && remaining > 0; i--) {
      const chunk = this.voiceBuffer[i];
      const start = Math.max(0, chunk.length - remaining);
      for (let j = chunk.length - 1; j >= start; j--) {
        const b = chunk[j];
        if (b < 126 || b > 129) return false;
        remaining--;
      }
    }
    return remaining <= 0;
  }

}
