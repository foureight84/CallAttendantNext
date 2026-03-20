import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';
import { config } from '../config';

async function getModelSampleRate(modelPath: string): Promise<number> {
  const raw = await readFile(modelPath + '.json', 'utf8');
  return JSON.parse(raw).audio.sample_rate;
}

function piperEnv(): NodeJS.ProcessEnv {
  const piperDir = path.resolve(path.dirname(config.piperBinary));
  const existing = process.env.DYLD_LIBRARY_PATH ?? '';
  return {
    ...process.env,
    DYLD_LIBRARY_PATH: existing ? `${piperDir}:${existing}` : piperDir,
  };
}

function waitForClose(proc: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise((res, rej) =>
    proc.on('close', code => code === 0 ? res() : rej(new Error(`${name} exited ${code}`)))
  );
}

/**
 * Synthesize text using the Piper binary and ffmpeg, yielding
 * 8-bit unsigned PCM chunks at 8000 Hz suitable for modem playback.
 */
export async function* synthesize(text: string, modelPath: string, lengthScale = 1.0): AsyncGenerator<Buffer> {
  const sampleRate = await getModelSampleRate(modelPath);

  const piper = spawn(config.piperBinary, ['--model', modelPath, '--output-raw', '--length-scale', String(lengthScale)], { env: piperEnv() });
  const ffmpeg = spawn('ffmpeg', [
    '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    '-f', 'u8', '-ar', '8000', '-ac', '1',
    '-af', 'highpass=f=300,lowpass=f=3400',
    'pipe:1',
  ]);

  // Register close listeners immediately to avoid missing the event
  const done = Promise.all([waitForClose(piper, 'piper'), waitForClose(ffmpeg, 'ffmpeg')]);

  piper.stdout.pipe(ffmpeg.stdin);
  piper.stdin.write(text);
  piper.stdin.end();

  for await (const chunk of ffmpeg.stdout) {
    yield chunk as Buffer;
  }

  await done;
}

/**
 * Synthesize text to WAV format for browser audio preview.
 */
export async function* synthesizeWav(text: string, modelPath: string, lengthScale = 1.0): AsyncGenerator<Buffer> {
  const sampleRate = await getModelSampleRate(modelPath);

  const piper = spawn(config.piperBinary, ['--model', modelPath, '--output-raw', '--length-scale', String(lengthScale)], { env: piperEnv() });
  const ffmpeg = spawn('ffmpeg', [
    '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    '-f', 'wav', '-ar', '22050', '-ac', '1',
    'pipe:1',
  ]);

  // Register close listeners immediately to avoid missing the event
  const done = Promise.all([waitForClose(piper, 'piper'), waitForClose(ffmpeg, 'ffmpeg')]);

  piper.stdout.pipe(ffmpeg.stdin);
  piper.stdin.write(text);
  piper.stdin.end();

  for await (const chunk of ffmpeg.stdout) {
    yield chunk as Buffer;
  }

  await done;
}
