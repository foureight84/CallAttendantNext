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

// AT+VSD: disable silence detection
const DISABLE_SILENCE_DETECTION: Record<ModemModel, string> = {
  USR:      'AT+VSD=128,0',
  CONEXANT: 'AT+VSD=0,0',
  MT9234MU: 'AT+VSD=128,0',
  UNKNOWN:  'AT+VSD=128,0',
};

// DTE→DCE: end voice transmit  (<DLE><ETX> or triple-DLE for Conexant)
const END_VOICE_TX: Record<ModemModel, Buffer> = {
  USR:      Buffer.from([0x10, 0x03]),
  CONEXANT: Buffer.from([0x10, 0x10, 0x10, 0x03]),
  MT9234MU: Buffer.from([0x10, 0x03]),
  UNKNOWN:  Buffer.from([0x10, 0x03]),
};

// DTE→DCE: end voice receive  (<DLE>! or triple-DLE+! for Conexant)
const END_VOICE_RX: Record<ModemModel, Buffer> = {
  USR:      Buffer.from([0x10, 0x21]),
  CONEXANT: Buffer.from([0x10, 0x10, 0x10, 0x21]),
  MT9234MU: Buffer.from([0x10, 0x21]),
  UNKNOWN:  Buffer.from([0x10, 0x21]),
};

// Audio chunk sleep interval (ms) while streaming audio to modem
const AUDIO_CHUNK_SLEEP: Record<ModemModel, number> = {
  USR:      100,
  CONEXANT: 30,
  MT9234MU: 30,
  UNKNOWN:  100,
};

// DCE→DTE: DLE-shielded status codes sent by modem during voice mode
const DCE_END_VOICE_DATA = Buffer.from([0x10, 0x03]); // <DLE><ETX> — caller hung up
const DCE_PHONE_OFF_HOOK = Buffer.from([0x10, 0x48]); // <DLE>H
const DCE_BUSY_TONE      = Buffer.from([0x10, 0x62]); // <DLE>b
const DCE_DIAL_TONE      = Buffer.from([0x10, 0x64]); // <DLE>d

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class Modem {
  private port: SerialPortType | null = null;
  private parser = new CallerIdParser();
  private listeners: ((event: ModemEvent) => void)[] = [];
  model: ModemModel = 'UNKNOWN';

  private inVoiceMode = false;
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
    if (this.inVoiceMode) {
      // Check for modem status codes that signal end of recording
      if (chunk.includes(DCE_END_VOICE_DATA[0]) ) {
        // Look for <DLE><ETX>, <DLE>H, <DLE>b, <DLE>d
        if (chunk.indexOf(DCE_END_VOICE_DATA) !== -1 ||
            chunk.indexOf(DCE_PHONE_OFF_HOOK)  !== -1 ||
            chunk.indexOf(DCE_BUSY_TONE)       !== -1 ||
            chunk.indexOf(DCE_DIAL_TONE)       !== -1) {
          // Capture audio up to the terminator
          const termIdx = Math.min(
            ...[DCE_END_VOICE_DATA, DCE_PHONE_OFF_HOOK, DCE_BUSY_TONE, DCE_DIAL_TONE]
              .map(seq => chunk.indexOf(seq))
              .filter(i => i !== -1)
          );
          if (termIdx > 0) this.voiceBuffer.push(chunk.slice(0, termIdx));
          this.inVoiceMode = false;
          this.emit({ type: 'CALL_END' });
          return;
        }
      }
      this.voiceBuffer.push(chunk);
      this.emit({ type: 'VOICE_DATA', chunk });
      return;
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
      const timeout = setTimeout(() => resolve(response), delayMs + 500);

      const onData = (chunk: Buffer) => {
        response += chunk.toString('ascii');
        if (response.includes('OK') || response.includes('ERROR') || response.includes('CONNECT')) {
          clearTimeout(timeout);
          this.port!.removeListener('data', onData);
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

  // ─── Modem init ───────────────────────────────────────────────────────────

  async initModem(): Promise<void> {
    console.log('[modem] Sending init sequence...');
    await this.sendCommand('ATZ', 1000);
    await this.sendCommand('ATE0', 500);

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
   * Answer the call: enter voice mode, disable silence detection, go off-hook (TAD mode).
   * Mirrors Python pick_up(): AT+FCLASS=8 → AT+VSD → AT+VLS=1
   */
  async answer(): Promise<void> {
    await this.sendCommand('AT+FCLASS=8', 500);
    await this.sendCommand(DISABLE_SILENCE_DETECTION[this.model], 500);
    await this.sendCommand('AT+VLS=1', 1000); // TAD off-hook (answers the call)
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

    await this.sendCommand('AT+FCLASS=8', 500);
    await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
    await this.sendCommand('AT+VLS=1', 500);
    await this.sendCommand('AT+VTX', 2000); // modem responds with CONNECT

    // Stream audio in 1024-byte chunks with inter-chunk sleep (matches Python)
    const chunkSize = 1024;
    const sleepMs = AUDIO_CHUNK_SLEEP[this.model];
    for (let offset = 0; offset < audioData.length; offset += chunkSize) {
      await this.writeRaw(audioData.slice(offset, offset + chunkSize));
      await sleep(sleepMs);
    }

    await this.writeRaw(END_VOICE_TX[this.model]);
    await sleep(500); // give modem time to flush
  }

  /**
   * Stream audio to the modem from an AsyncIterable of raw PCM chunks.
   * Sets up AT+VTX once, then writes chunks as they arrive.
   */
  async playAudioStream(source: AsyncIterable<Buffer>): Promise<void> {
    if (!this.port?.isOpen) return;

    await this.sendCommand('AT+FCLASS=8', 500);
    await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
    await this.sendCommand('AT+VLS=1', 500);
    await this.sendCommand('AT+VTX', 2000);

    for await (const chunk of source) {
      await this.writeRaw(chunk);
    }

    await this.writeRaw(END_VOICE_TX[this.model]);
    await sleep(500);
  }

  /**
   * Start recording voicemail.
   * Mirrors Python record_audio(): AT+FCLASS=8 → AT+VSM → AT+VSD → AT+VLS=1 → AT+VTS beep → AT+VRX (CONNECT)
   */
  async startRecording(): Promise<void> {
    this.voiceBuffer = [];

    await this.sendCommand('AT+FCLASS=8', 500);
    await this.sendCommand(VOICE_COMPRESSION[this.model], 500);
    await this.sendCommand(DISABLE_SILENCE_DETECTION[this.model], 500);
    await this.sendCommand('AT+VLS=1', 500);
    await this.sendCommand('AT+VTS=[900,900,120]', 2000); // 1.2 second beep

    this.inVoiceMode = true; // set before VRX so incoming voice data is captured
    await this.sendCommand('AT+VRX', 2000); // modem responds with CONNECT
  }

  /**
   * Signal end of voice receive mode to the modem.
   * Mirrors Python DTE_END_VOICE_DATA_RX: <DLE>! (USR) or <DLE><DLE><DLE>! (Conexant)
   */
  async stopRecording(): Promise<void> {
    if (!this.port?.isOpen) return;
    this.inVoiceMode = false;
    await this.writeRaw(END_VOICE_RX[this.model]);
    await sleep(500);
  }

  getRecordedBuffer(): Buffer {
    return Buffer.concat(this.voiceBuffer);
  }
}
