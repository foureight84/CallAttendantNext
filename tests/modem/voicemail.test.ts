import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('fs/promises', () => ({
  mkdir:     vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink:    vi.fn().mockResolvedValue(undefined),
  readFile:  vi.fn().mockResolvedValue(Buffer.from('hello')),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true), // messagesDir already exists → skip mkdir
}));

vi.mock('@/lib/config', () => ({
  config: { messagesDir: '/tmp/test-messages' },
}));

import { VoicemailRecorder } from '@/lib/modem/voicemail';
import { spawn } from 'child_process';
import * as fsp from 'fs/promises';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a mock ChildProcess that emits 'close' or 'error' after listeners attach. */
function makeMockProcess(exitCode: number): EventEmitter;
function makeMockProcess(exitCode: number, spawnError: NodeJS.ErrnoException): EventEmitter;
function makeMockProcess(exitCode: number, spawnError?: NodeJS.ErrnoException): EventEmitter {
  const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
  process.nextTick(() => {
    if (spawnError) {
      proc.emit('error', spawnError);
    } else {
      proc.emit('close', exitCode);
    }
  });
  return proc;
}

/** PCM buffer filled with silence-range bytes (127 = mid-point of 126–129). */
function silencePcm(bytes: number): Buffer {
  return Buffer.alloc(bytes, 127);
}

/** PCM buffer with clear non-silent audio (value 100 is outside 126–129). */
function audioPcm(bytes: number): Buffer {
  return Buffer.alloc(bytes, 100);
}

let recorder: VoicemailRecorder;

beforeEach(() => {
  vi.clearAllMocks();
  recorder = new VoicemailRecorder();
});

// ─── Silence trimming ──────────────────────────────────────────────────────

describe('VoicemailRecorder — silence trimming', () => {
  it('returns null for all-silence PCM (no voicemail left)', async () => {
    // 10 000 bytes of silence → trimSilence returns empty buffer → < 4000 → null
    const result = await recorder.savePcmAsMP3(silencePcm(10_000), 1, '5551234567', 'Test');

    expect(result).toBeNull();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('returns null when audio content is too short after trimming silence', async () => {
    // 2 000 bytes of audio bookended by silence chunks → trimmed < 4 000 bytes → null
    const pcm = Buffer.concat([silencePcm(1024), audioPcm(2000), silencePcm(1024)]);

    const result = await recorder.savePcmAsMP3(pcm, 1, '5551234567', 'Test');

    expect(result).toBeNull();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});

// ─── savePcmAsMP3 ──────────────────────────────────────────────────────────

describe('VoicemailRecorder — savePcmAsMP3', () => {
  it('invokes ffmpeg with correct PCM format flags and returns an mp3 filename', async () => {
    vi.mocked(spawn).mockReturnValue(makeMockProcess(0) as never);

    const result = await recorder.savePcmAsMP3(audioPcm(10_000), 42, '5551234567', 'Alice');

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-f', 'u8', '-ar', '8000', '-ac', '1']),
    );
    expect(result).toMatch(/^42_5551234567_Alice_.*\.mp3$/);
  });

  it('falls back to WAV and returns a wav filename when ffmpeg is not installed', async () => {
    const enoent = Object.assign(new Error('spawn error'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    vi.mocked(spawn).mockReturnValue(makeMockProcess(0, enoent) as never);

    const result = await recorder.savePcmAsMP3(audioPcm(10_000), 42, '5551234567', 'Alice');

    expect(result).toMatch(/\.wav$/);
    // writeFile should be called twice: once for the temp PCM, once for the WAV
    expect(vi.mocked(fsp.writeFile)).toHaveBeenCalledTimes(2);
  });
});
