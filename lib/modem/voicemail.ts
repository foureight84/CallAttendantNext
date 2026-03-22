import { spawn } from 'child_process';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Ensure messages directory exists.
 */
export async function ensureMessagesDir(): Promise<void> {
  if (!existsSync(config.messagesDir)) {
    await mkdir(config.messagesDir, { recursive: true });
  }
}

/**
 * Convert raw PCM buffer (8-bit unsigned, 8kHz, mono) to MP3 using ffmpeg.
 * Returns the output MP3 filename (basename only).
 */
export async function savePcmAsMP3(pcmBuffer: Buffer, callLogId: number, number: string, name: string): Promise<string | null> {
  await ensureMessagesDir();
  const trimmed = trimSilence(pcmBuffer);
  // At 8kHz 8-bit mono: 4000 bytes = 0.5 seconds. Anything shorter after
  // trimming silence/dial tone is not a real voicemail.
  if (trimmed.length < 4000) return null;
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const yy  = String(now.getFullYear()).slice(-2);
  const hh  = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${mm}${dd}${yy}_${hh}${min}`;
  const safeName = name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').trim() || 'UNKNOWN';
  const baseName = `${callLogId}_${number}_${safeName}_${timestamp}`;

  try {
    const pcmPath = path.join(config.messagesDir, `${baseName}.pcm`);
    const mp3Path = path.join(config.messagesDir, `${baseName}.mp3`);
    await writeFile(pcmPath, trimmed);
    await runFfmpeg(pcmPath, mp3Path);
    await unlink(pcmPath).catch(() => {});
    return `${baseName}.mp3`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).message?.includes('ffmpeg not found')) {
      const wavPath = path.join(config.messagesDir, `${baseName}.wav`);
      await writePcmAsWav(trimmed, wavPath);
      return `${baseName}.wav`;
    }
    throw err;
  }
}

function trimSilence(pcm: Buffer): Buffer {
  const SILENCE_MIN = 126;
  const SILENCE_MAX = 129;
  const CHUNK = 1024;

  let firstAudioChunk = -1;
  let lastAudioChunk = 0;

  for (let i = 0; i < pcm.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, pcm.length);
    const chunkLen = end - i;

    let hasSpeech = false;
    for (let j = i; j < end; j++) {
      if (pcm[j] < SILENCE_MIN || pcm[j] > SILENCE_MAX) {
        hasSpeech = true;
        break;
      }
    }

    // Keep this chunk only if it has non-silence AND is not dial tone
    if (hasSpeech && !isDialToneChunk(pcm, i, chunkLen)) {
      if (firstAudioChunk === -1) firstAudioChunk = i;
      lastAudioChunk = end;
    }
  }

  // No audio found at all (all silence or all dial tone) — return empty
  if (firstAudioChunk === -1) return Buffer.alloc(0);

  // Trim both leading and trailing silence/dial-tone
  return pcm.slice(firstAudioChunk, lastAudioChunk);
}

/**
 * Goertzel algorithm — measures power at a single target frequency.
 * More efficient than FFT for detecting specific tones.
 * Input: 8-bit unsigned PCM (converted to signed internally).
 */
function goertzelPower(pcm: Buffer, offset: number, length: number, targetFreq: number): number {
  const k = Math.round(length * targetFreq / 8000);
  const coeff = 2 * Math.cos((2 * Math.PI * k) / length);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < length; i++) {
    const s0 = (pcm[offset + i] - 128) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s2 * s2 + s1 * s1 - coeff * s1 * s2;
}

/**
 * Returns true if the chunk contains North American dial tone (350 Hz + 440 Hz).
 * Thresholds are per-frequency based on observed power levels at 8kHz/1024-sample chunks:
 *   350 Hz: voice peaks ~2.7M, dial tone floor ~8.7M  → threshold 4M
 *   440 Hz: voice peaks ~400k, dial tone floor ~3.0M  → threshold 1.5M
 */
function isDialToneChunk(pcm: Buffer, offset: number, length: number): boolean {
  // Goertzel power scales with N², so normalize thresholds relative to the
  // calibrated 1024-sample values (4M @ 350Hz, 1.5M @ 440Hz).
  const scale = (length / 1024) ** 2;
  return goertzelPower(pcm, offset, length, 350) > 4_000_000 * scale &&
         goertzelPower(pcm, offset, length, 440) > 1_500_000 * scale;
}

async function writePcmAsWav(pcmData: Buffer, filePath: string): Promise<void> {
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  await writeFile(filePath, Buffer.concat([header, pcmData]));
}

function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',           // overwrite output
      '-f', 'u8',     // input format: 8-bit unsigned PCM
      '-ar', '8000',  // sample rate
      '-ac', '1',     // mono
      '-i', inputPath,
      outputPath,
    ]);

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('ffmpeg not found. Install ffmpeg to enable MP3 voicemail encoding.'));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Play a WAV file through the modem's audio output (modem in voice mode).
 * Reads the file and returns its bytes; caller sends bytes over the serial port.
 */
export async function readAudioFile(filename: string): Promise<Buffer> {
  const { readFile } = await import('fs/promises');
  const filePath = path.join(process.cwd(), 'public', 'audio', filename);
  return readFile(filePath);
}

/**
 * Read a TTS script text file from public/audio/script/{basename}.txt
 */
export async function readScriptFile(basename: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  const filePath = path.join(process.cwd(), 'public', 'audio', 'script', `${basename}.txt`);
  return (await readFile(filePath, 'utf8')).trim();
}
