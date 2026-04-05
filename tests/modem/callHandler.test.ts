import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppSettings } from '@/lib/db';
import type { ModemEvent, ModemModel } from '@/lib/modem/modem';
import type { ScreeningResult } from '@/lib/modem/screener';

// ─── Module mocks (hoisted before imports) ─────────────────────────────────

vi.mock('@/lib/db', () => ({
  insertCallLog: vi.fn(),
  insertMessage: vi.fn(),
  getSettings: vi.fn(),
  isWhitelisted: vi.fn(),
  isBlacklisted: vi.fn(),
  addToBlacklist: vi.fn(),
}));

vi.mock('@/lib/events', () => ({
  callEvents: { emit: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  modemLog: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendCallEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/mqtt', () => ({
  publishCallMqtt: vi.fn().mockResolvedValue(undefined),
}));

import { CallHandler } from '@/lib/modem/callHandler';
import { CallerScreener } from '@/lib/modem/screener';
import { VoicemailRecorder } from '@/lib/modem/voicemail';
import { TtsEngine } from '@/lib/modem/tts';
import { GpioController } from '@/lib/modem/gpio';
import * as db from '@/lib/db';
import * as email from '@/lib/email';
import * as mqtt from '@/lib/mqtt';

// ─── Mock Modem ────────────────────────────────────────────────────────────

class MockModem {
  private _listener?: (event: ModemEvent) => void | Promise<void>;

  model: ModemModel = 'USR';
  onLog: ((msg: string) => void) | null = null;

  on(cb: (event: ModemEvent) => void | Promise<void>): void {
    this._listener = cb;
  }

  async emit(event: ModemEvent): Promise<void> {
    if (this._listener) await this._listener(event);
  }

  answer          = vi.fn().mockResolvedValue(undefined);
  hangUp          = vi.fn().mockResolvedValue(undefined);
  playAudioStream = vi.fn().mockResolvedValue(undefined);
  startRecording  = vi.fn().mockResolvedValue(undefined);
  stopRecording   = vi.fn().mockResolvedValue(undefined);
  isRecording     = vi.fn().mockReturnValue(false);
  hasSustainedSilence = vi.fn().mockReturnValue(false);
  getRecordedBuffer   = vi.fn().mockReturnValue(Buffer.alloc(0));
  close           = vi.fn().mockResolvedValue(undefined);
}

// ─── Default settings (0-ring waits so tests don't need multi-ring sequences) ─

const defaultSettings: AppSettings = {
  screeningMode: ['blacklist', 'whitelist'],
  blockService: 'NOMOROBO',
  spamThreshold: 2,
  ringsBeforeVm: 0,
  ringsBeforeVmScreened: 0,
  blocklistAction: 2,
  ringsBeforeVmBlocklist: 0,
  autoBlockSpam: false,
  enableGpio: false,
  debugConsole: false,
  diagnosticMode: false,
  savePcmDebug: false,
  greetingVoice: '',          // empty = skip TTS, use on-demand path (mocked)
  greetingLengthScale: 1.0,
  logFile: '/tmp/callattendant-test.log',
  logMaxBytes: 1000000,
  logKeepFiles: 2,
  emailEnabled: false,
  emailHost: '', emailPort: 587, emailUser: '', emailPass: '',
  emailFrom: '', emailTo: '',
  emailNotifyVoicemail: false, emailNotifyBlocked: false, emailNotifyAll: false,
  mqttEnabled: false,
  mqttBrokerUrl: '', mqttUsername: '', mqttPassword: '',
  mqttTopicPrefix: 'callattendant',
  mqttNotifyVoicemail: false, mqttNotifyBlocked: false, mqttNotifyAll: false,
};

const ALICE_INFO = { name: 'Alice', number: '5551234567', date: '0403', time: '1430' };
const ALICE: ModemEvent = { type: 'CALLER_ID', info: ALICE_INFO };

// ─── Test harness ──────────────────────────────────────────────────────────

// All outer variables are assigned by makeHandler(); tests use them after that call.
let mockModem:   MockModem;
let mockScreener: { screen: ReturnType<typeof vi.fn> };
let mockRecorder: {
  ensureMessagesDir: ReturnType<typeof vi.fn>;
  savePcmAsMP3:      ReturnType<typeof vi.fn>;
  readScriptFile:    ReturnType<typeof vi.fn>;
  readAudioFile:     ReturnType<typeof vi.fn>;
};
let mockTts:  { synthesize: ReturnType<typeof vi.fn>; synthesizeWav: ReturnType<typeof vi.fn> };
let mockGpio: { setLed: ReturnType<typeof vi.fn>; blinkLed: ReturnType<typeof vi.fn> };
let handler: CallHandler;

function makeHandler(settings: Partial<AppSettings> = {}): CallHandler {
  vi.mocked(db.getSettings).mockResolvedValue({ ...defaultSettings, ...settings });
  vi.mocked(db.insertCallLog).mockResolvedValue(42);
  vi.mocked(db.insertMessage).mockResolvedValue(1);
  vi.mocked(db.isWhitelisted).mockResolvedValue(undefined);
  vi.mocked(db.isBlacklisted).mockResolvedValue(undefined);

  mockModem    = new MockModem();
  mockScreener = { screen: vi.fn() };
  mockRecorder = {
    ensureMessagesDir: vi.fn().mockResolvedValue(undefined),
    savePcmAsMP3:      vi.fn().mockResolvedValue(null),
    readScriptFile:    vi.fn().mockResolvedValue('Hello, please leave a message.'),
    readAudioFile:     vi.fn().mockResolvedValue(Buffer.alloc(0)),
  };
  mockTts = {
    synthesize:    vi.fn().mockImplementation(async function* () {}),
    synthesizeWav: vi.fn(),
  };
  mockGpio = {
    setLed:   vi.fn().mockResolvedValue(undefined),
    blinkLed: vi.fn().mockResolvedValue(undefined),
  };

  return new CallHandler(
    mockModem   as never,
    mockScreener as unknown as CallerScreener,
    mockRecorder as unknown as VoicemailRecorder,
    mockTts     as unknown as TtsEngine,
    mockGpio    as unknown as GpioController,
  );
}

/**
 * Advance past the sleep(1000) in goToVoicemail so the ring handler completes.
 * Adds 200ms of headroom beyond the 1000ms sleep.
 */
async function driveToVoicemail(ringDone: Promise<void>): Promise<void> {
  await vi.advanceTimersByTimeAsync(1200);
  await ringDone;
}

beforeEach(() => {
  vi.useFakeTimers();
  handler = makeHandler();
  handler.start();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── Permitted caller ──────────────────────────────────────────────────────

describe('permitted caller', () => {
  it('answers and starts recording', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' } as ScreeningResult);

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(mockModem.startRecording).toHaveBeenCalledOnce();
    expect(mockModem.hangUp).toHaveBeenCalledOnce();
    expect(vi.mocked(db.insertCallLog)).toHaveBeenCalledWith(
      expect.objectContaining({ Action: 'Permitted' }),
    );
  });

  it('saves voicemail when recording has sufficient audio', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });
    const pcm = Buffer.alloc(12000, 100); // >8000 bytes, non-silent (value 100 ≠ silence range 126-129)
    mockModem.getRecordedBuffer.mockReturnValue(pcm);
    mockRecorder.savePcmAsMP3.mockResolvedValue('42_5551234567_Alice_040326_1430.mp3');

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockRecorder.savePcmAsMP3).toHaveBeenCalledWith(pcm, 42, '5551234567', 'Alice', false);
    expect(vi.mocked(db.insertMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ CallLogID: 42, Played: 0, Filename: '42_5551234567_Alice_040326_1430.mp3' }),
    );
  });

  it('waits for ringsBeforeVm rings before going to voicemail', async () => {
    handler = makeHandler({ ringsBeforeVm: 2 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });

    await mockModem.emit(ALICE);
    const ring1Done = mockModem.emit({ type: 'RING' });

    // Flush microtasks so ring 1 enters waitForRings(1)
    await vi.advanceTimersByTimeAsync(0);
    expect(mockModem.answer).not.toHaveBeenCalled();

    // Ring 2 arrives — increments waitRingCount, unblocking waitForRings
    await mockModem.emit({ type: 'RING' });

    await driveToVoicemail(ring1Done);

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(vi.mocked(db.insertCallLog)).toHaveBeenCalledWith(
      expect.objectContaining({ Action: 'Permitted' }),
    );
  });

  it('discards recording when audio is too short (<8000 bytes)', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });
    mockModem.getRecordedBuffer.mockReturnValue(Buffer.alloc(100));

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(vi.mocked(db.insertMessage)).not.toHaveBeenCalled();
  });
});

// ─── Blocked caller ────────────────────────────────────────────────────────

describe('blocked caller', () => {
  it('plays blocked message then hangs up (action 2)', async () => {
    // Create a new handler with blocklistAction=2 and set up mock AFTER makeHandler
    handler = makeHandler({ blocklistAction: 2 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Blocked', reason: 'Blacklisted' });

    await mockModem.emit(ALICE);
    const ringDone = mockModem.emit({ type: 'RING' });
    // sleep(1000) after answer + sleep(500) after playing blocked greeting
    await vi.advanceTimersByTimeAsync(1600);
    await ringDone;

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(mockTts.synthesize).toHaveBeenCalled();
    expect(mockModem.hangUp).toHaveBeenCalledOnce();
    expect(mockModem.startRecording).not.toHaveBeenCalled();
  });

  it('sends blocked caller to voicemail after configured rings (action 3)', async () => {
    handler = makeHandler({ blocklistAction: 3, ringsBeforeVmBlocklist: 0 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Blocked', reason: 'Blacklisted' });

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(mockModem.startRecording).toHaveBeenCalledOnce();
    expect(vi.mocked(db.insertCallLog)).toHaveBeenCalledWith(
      expect.objectContaining({ Action: 'Blocked' }),
    );
  });

  it('hangs up silently without any greeting (action 1)', async () => {
    handler = makeHandler({ blocklistAction: 1 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Blocked', reason: 'Blacklisted' });

    await mockModem.emit(ALICE);
    const ringDone = mockModem.emit({ type: 'RING' });
    await vi.advanceTimersByTimeAsync(1100); // sleep(1000) only
    await ringDone;

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(mockTts.synthesize).not.toHaveBeenCalled();
    expect(mockModem.hangUp).toHaveBeenCalledOnce();
    expect(mockModem.startRecording).not.toHaveBeenCalled();
  });
});

// ─── Screened caller ───────────────────────────────────────────────────────

describe('screened caller', () => {
  it('goes to voicemail', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Screened', reason: 'Unknown caller' });

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(vi.mocked(db.insertCallLog)).toHaveBeenCalledWith(
      expect.objectContaining({ Action: 'Screened' }),
    );
  });

  it('answers immediately when screening result carries immediate=true', async () => {
    // ringsBeforeVmScreened=5 would cause a 5-ring wait, but immediate=true skips it
    handler = makeHandler({ ringsBeforeVmScreened: 5 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Screened', reason: 'Nomorobo hit', immediate: true });

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockModem.answer).toHaveBeenCalledOnce();
  });
});

// ─── No caller ID ──────────────────────────────────────────────────────────

describe('no caller ID received', () => {
  it('bails on ring 1, then screens as UNKNOWN on ring 2', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Screened', reason: 'Unknown caller' });

    // Ring 1: no CALLER_ID → waitForScreeningWithTimeout(3500) times out → returns false → bail
    const ring1Done = mockModem.emit({ type: 'RING' });
    await vi.advanceTimersByTimeAsync(3600);
    await ring1Done;

    expect(mockModem.answer).not.toHaveBeenCalled();

    // Ring 2: no caller ID, inline screen call
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockScreener.screen).toHaveBeenCalledWith('UNKNOWN', 'UNKNOWN');
    expect(mockModem.answer).toHaveBeenCalledOnce();
  });
});

// ─── Mid-call hang-ups ─────────────────────────────────────────────────────

describe('caller hangs up mid-call', () => {
  it('skips recording when caller hangs up before greeting finishes', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });
    // Simulate CALL_END arriving during answer() — before greeting starts
    mockModem.answer.mockImplementation(async () => {
      await mockModem.emit({ type: 'CALL_END' });
    });

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(mockModem.startRecording).not.toHaveBeenCalled();
    expect(mockModem.hangUp).toHaveBeenCalledOnce(); // cleanup call in goToVoicemail
    expect(vi.mocked(db.insertMessage)).not.toHaveBeenCalled();
  });

  it('resets state and does nothing when CALL_END arrives before ring 2', async () => {
    // Ring 1 fires — handler waits up to 3.5s for caller ID (none arrives)
    const ring1Done = mockModem.emit({ type: 'RING' });

    // Caller hangs up immediately (no caller ID ever sent)
    await mockModem.emit({ type: 'CALL_END' });

    await vi.advanceTimersByTimeAsync(3600);
    await ring1Done;

    expect(mockModem.answer).not.toHaveBeenCalled();
    expect(vi.mocked(db.insertCallLog)).not.toHaveBeenCalled();
  });
});

// ─── Ring wait / another phone picks up ───────────────────────────────────

describe('ring timeout (another phone answered)', () => {
  it('aborts voicemail when no further rings arrive within the ring interval', async () => {
    // ringsBeforeVm=4 means the handler waits for 3 more rings after ring 1
    handler = makeHandler({ ringsBeforeVm: 4 });
    handler.start();
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });

    await mockModem.emit(ALICE);
    const ringDone = mockModem.emit({ type: 'RING' });

    // No additional rings arrive — ring timeout fires after 8s and resets state
    await vi.advanceTimersByTimeAsync(8200);
    await ringDone;

    expect(mockModem.answer).not.toHaveBeenCalled();
    expect(vi.mocked(db.insertMessage)).not.toHaveBeenCalled();
  });
});

// ─── Concurrent ring protection ────────────────────────────────────────────

describe('concurrent ring protection', () => {
  it('ignores a second RING while already handling a call', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });

    await mockModem.emit(ALICE);

    const ring1Done = mockModem.emit({ type: 'RING' });
    // Flush microtasks so ring 1 progresses past isHandlingCall=true before ring 2 fires
    await vi.advanceTimersByTimeAsync(0);

    const ring2Done = mockModem.emit({ type: 'RING' });

    await driveToVoicemail(ring1Done);
    await ring2Done;

    // answer() and insertCallLog() should each be called exactly once
    expect(mockModem.answer).toHaveBeenCalledOnce();
    expect(vi.mocked(db.insertCallLog)).toHaveBeenCalledOnce();
  });
});

// ─── Notifications ─────────────────────────────────────────────────────────

describe('notifications', () => {
  it('fires email and MQTT after every call resolves', async () => {
    mockScreener.screen.mockResolvedValue({ action: 'Permitted', reason: 'Whitelisted' });

    await mockModem.emit(ALICE);
    await driveToVoicemail(mockModem.emit({ type: 'RING' }));

    expect(vi.mocked(email.sendCallEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'Permitted', number: '5551234567' }),
    );
    expect(vi.mocked(mqtt.publishCallMqtt)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'Permitted' }),
    );
  });
});
