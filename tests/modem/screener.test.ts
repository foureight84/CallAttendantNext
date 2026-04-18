import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AppSettings, ListRow } from '@/lib/db';

// ─── Module mocks ──────────────────────────────────────────────────────────

// vi.hoisted ensures this is available before vi.mock hoisting
const mockNomoroboCheck = vi.hoisted(() => vi.fn());

vi.mock('@/lib/modem/nomorobo', () => ({
  NomoroboChecker: function NomoroboChecker(this: { check: unknown }) {
    this.check = mockNomoroboCheck;
  },
}));

vi.mock('@/lib/db', () => ({
  getSettings: vi.fn(),
  isWhitelisted: vi.fn(),
  isBlacklisted: vi.fn(),
  addToBlacklist: vi.fn(),
}));

vi.mock('@/lib/events', () => ({
  modemLog: vi.fn(),
  callEvents: { emit: vi.fn() },
}));

import { CallerScreener } from '@/lib/modem/screener';
import * as db from '@/lib/db';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    screeningMode: ['blacklist', 'whitelist'],
    blockService: 'NOMOROBO',
    spamThreshold: 2,
    autoBlockSpam: false,
    ringsBeforeVm: 4, ringsBeforeVmScreened: 2,
    blocklistAction: 2, ringsBeforeVmBlocklist: 0,
    enableGpio: false, debugConsole: false, diagnosticMode: false, savePcmDebug: false,
    greetingVoice: '', greetingLengthScale: 1.0,
    logFile: '', logMaxBytes: 0, logKeepFiles: 0,
    emailEnabled: false, emailHost: '', emailPort: 587, emailUser: '', emailPass: '',
    emailFrom: '', emailTo: '',
    emailNotifyVoicemail: false, emailNotifyBlocked: false, emailNotifyAll: false,
    mqttEnabled: false, mqttBrokerUrl: '', mqttUsername: '', mqttPassword: '',
    mqttTopicPrefix: '', mqttNotifyVoicemail: false, mqttNotifyBlocked: false, mqttNotifyAll: false,
    robocallCleanupEnabled: false,
    robocallCleanupCron: '0 2 * * 6',
    dtmfRemovalEnabled: false,
    dtmfRemovalKey: '9',
    wizardCompleted: true,
    ...overrides,
  };
}

function listRow(phoneNo: string, name: string): ListRow {
  return { phoneNo, name, reason: null, systemDateTime: null };
}

let screener: CallerScreener;

beforeEach(() => {
  vi.clearAllMocks();
  screener = new CallerScreener();
  vi.mocked(db.isBlacklisted).mockResolvedValue(undefined);
  vi.mocked(db.isWhitelisted).mockResolvedValue(undefined);
  mockNomoroboCheck.mockResolvedValue({ score: 0, reason: 'Nomorobo: not listed' });
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('CallerScreener — blacklist', () => {
  it('blocks a number on the blacklist', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(db.isBlacklisted).mockResolvedValue(listRow('5551234567', 'Spammer'));

    const result = await screener.screen('Spammer', '5551234567');

    expect(result.action).toBe('Blocked');
    expect(result.reason).toContain('Blacklisted');
  });

  it('skips blacklist check when blacklist mode is disabled', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ screeningMode: ['whitelist'] }));
    vi.mocked(db.isBlacklisted).mockResolvedValue(listRow('5551234567', 'Spammer'));

    const result = await screener.screen('Spammer', '5551234567');

    expect(vi.mocked(db.isBlacklisted)).not.toHaveBeenCalled();
    expect(result.action).not.toBe('Blocked');
  });
});

describe('CallerScreener — whitelist', () => {
  it('permits a number on the whitelist', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(db.isWhitelisted).mockResolvedValue(listRow('5551234567', 'Alice'));

    const result = await screener.screen('Alice', '5551234567');

    expect(result.action).toBe('Permitted');
    expect(result.reason).toContain('Whitelisted');
  });
});

describe('CallerScreener — obvious spam patterns', () => {
  it('blocks a number matching an obvious spam pattern', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());

    const result = await screener.screen('CALLER', '0000000000');

    expect(result.action).toBe('Blocked');
    expect(result.reason).toContain('Pattern match');
  });

  it('does not treat a call with UNKNOWN name as a spam pattern match', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());

    const result = await screener.screen('UNKNOWN', '5551234567');

    // UNKNOWN name is explicitly exempted from pattern blocking
    expect(result.action).not.toBe('Blocked');
  });
});

describe('CallerScreener — screening mode disabled', () => {
  it('returns Screened when all screening modes are disabled', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ screeningMode: [], blockService: 'NONE' }));

    const result = await screener.screen('CALLER', '5551234567');

    expect(result.action).toBe('Screened');
    expect(result.reason).toBe('Unknown caller');
    expect(vi.mocked(db.isBlacklisted)).not.toHaveBeenCalled();
    expect(vi.mocked(db.isWhitelisted)).not.toHaveBeenCalled();
    expect(mockNomoroboCheck).not.toHaveBeenCalled();
  });
});

describe('CallerScreener — Nomorobo', () => {
  it('screens an unknown caller when Nomorobo returns score 0', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());
    mockNomoroboCheck.mockResolvedValue({ score: 0, reason: 'Nomorobo: not listed' });

    const result = await screener.screen('UNKNOWN', '5551234567');

    expect(result.action).toBe('Screened');
  });

  it('screens (not blocks) when Nomorobo returns score 1 below threshold', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ spamThreshold: 2 }));
    mockNomoroboCheck.mockResolvedValue({ score: 1, reason: 'Nomorobo: Suspicious' });

    const result = await screener.screen('CALLER', '5551234567');

    expect(result.action).toBe('Screened');
    expect(result.reason).toContain('Nomorobo');
  });

  it('blocks when Nomorobo returns score >= threshold', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ spamThreshold: 2 }));
    mockNomoroboCheck.mockResolvedValue({ score: 2, reason: 'Nomorobo: Robocall' });

    const result = await screener.screen('ROBOCALLER', '5551111111');

    expect(result.action).toBe('Blocked');
    expect(result.reason).toContain('Nomorobo');
  });

  it('auto-blocks and adds to blacklist when autoBlockSpam is enabled', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ spamThreshold: 2, autoBlockSpam: true }));
    vi.mocked(db.addToBlacklist).mockResolvedValue(undefined);
    mockNomoroboCheck.mockResolvedValue({ score: 2, reason: 'Nomorobo: Robocall' });

    await screener.screen('ROBOCALLER', '5551111111');

    expect(vi.mocked(db.addToBlacklist)).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNo: '5551111111' }),
    );
  });

  it('skips Nomorobo for special placeholder numbers (P and O)', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings());

    await screener.screen('UNKNOWN', 'P');

    expect(mockNomoroboCheck).not.toHaveBeenCalled();
  });

  it('skips Nomorobo when block service is not NOMOROBO', async () => {
    vi.mocked(db.getSettings).mockResolvedValue(makeSettings({ blockService: 'NONE' }));

    await screener.screen('CALLER', '5551234567');

    expect(mockNomoroboCheck).not.toHaveBeenCalled();
  });
});
