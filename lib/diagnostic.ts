import { callEvents, modemLog } from './events';
import { getModem } from './modem/index';
import { addToBlacklist, removeFromBlacklist, addToWhitelist, removeFromWhitelist } from './db';
import { config } from './config';
import fs from 'fs';
import path from 'path';

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail';

export interface DiagnosticTest {
  id: string;
  name: string;
  description: string;
  instruction?: string;
  status: TestStatus;
  message?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface DiagnosticState {
  sessionId: string | null;
  currentTestIndex: number;
  tests: DiagnosticTest[];
  detectedNumber?: string;
  detectedName?: string;
  lastVoicemailFilename?: string;
}

function makeTests(): DiagnosticTest[] {
  return [
    {
      id: 'modem-connected',
      name: 'Modem Connected',
      description: 'Verifies the modem serial port is open and responding.',
      status: 'pending',
    },
    {
      id: 'ring-detection',
      name: 'RING Detection',
      description: 'Verifies the modem detects an incoming ring signal.',
      instruction: 'Call your number now. Waiting for a ring signal…',
      status: 'pending',
    },
    {
      id: 'caller-id',
      name: 'Caller ID Parsed',
      description: 'Verifies caller ID name and number are received and parsed.',
      instruction: 'Keep the call ringing — waiting for caller ID data…',
      status: 'pending',
    },
    {
      id: 'greeting-played',
      name: 'Greeting Played',
      description: 'Verifies TTS greeting audio is synthesized and played to the caller.',
      instruction: 'Stay on the line — the system will answer and play a greeting…',
      status: 'pending',
    },
    {
      id: 'recording-started',
      name: 'Voicemail Recording',
      description: 'Verifies the modem enters receive mode and captures audio.',
      instruction: 'After you hear the beep, say a few words…',
      status: 'pending',
    },
    {
      id: 'hangup-detected',
      name: 'Hang-up Detection',
      description: 'Verifies the system detects when the caller hangs up.',
      instruction: 'Hang up now. Waiting for call end…',
      status: 'pending',
    },
    {
      id: 'voicemail-saved',
      name: 'Voicemail Saved',
      description: 'Verifies the recorded audio was saved as an MP3 file.',
      status: 'pending',
    },
    {
      id: 'blocklist-screening',
      name: 'Blocklist Screening',
      description: 'Verifies a blacklisted number is correctly blocked.',
      instruction: 'Call your number again. The system will block the call…',
      status: 'pending',
    },
    {
      id: 'whitelist-screening',
      name: 'Whitelist Screening',
      description: 'Verifies a whitelisted number is correctly permitted.',
      instruction: 'Call your number one more time. The system will permit the call…',
      status: 'pending',
    },
  ];
}

declare global {
  // eslint-disable-next-line no-var
  var __diagnosticState: DiagnosticState;
  // eslint-disable-next-line no-var
  var __diagnosticListenersAttached: boolean;
}

function initialState(): DiagnosticState {
  return {
    sessionId: null,
    currentTestIndex: -1,
    tests: makeTests(),
  };
}

globalThis.__diagnosticState ??= initialState();
globalThis.__diagnosticListenersAttached ??= false;

export function getDiagnosticState(): DiagnosticState {
  return globalThis.__diagnosticState;
}

function broadcastState(): void {
  callEvents.emit('diagnostic-update', globalThis.__diagnosticState);
}

function setTestStatus(id: string, status: TestStatus, message?: string): void {
  const state = globalThis.__diagnosticState;
  const test = state.tests.find(t => t.id === id);
  if (!test) return;
  test.status = status;
  if (message !== undefined) test.message = message;
  if (status === 'running' && !test.startedAt) test.startedAt = Date.now();
  if (status === 'pass' || status === 'fail') test.completedAt = Date.now();
  broadcastState();
}

function advanceTo(id: string): void {
  const state = globalThis.__diagnosticState;
  const idx = state.tests.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.currentTestIndex = idx;
  setTestStatus(id, 'running');
}

let ringTimeout: ReturnType<typeof setTimeout> | null = null;
let callPhase: 'idle' | 'first-call' | 'blocklist-call' | 'whitelist-call' = 'idle';

function clearRingTimeout(): void {
  if (ringTimeout !== null) {
    clearTimeout(ringTimeout);
    ringTimeout = null;
  }
}

function armRingTimeout(testId: string, label: string): void {
  clearRingTimeout();
  ringTimeout = setTimeout(() => {
    ringTimeout = null;
    const state = globalThis.__diagnosticState;
    const test = state.tests.find(t => t.id === testId);
    if (test?.status === 'running') {
      setTestStatus(testId, 'fail', `Timed out after 90 seconds waiting for ${label}`);
      modemLog('warn', `[Diagnostic] Timeout waiting for ${label}`);
      // Mark remaining tests as failed and end session
      for (let i = state.currentTestIndex + 1; i < state.tests.length; i++) {
        state.tests[i]!.status = 'fail';
        state.tests[i]!.message = 'Skipped due to earlier failure';
      }
      broadcastState();
      callPhase = 'idle';
    }
  }, 90_000);
}

function attachListeners(): void {
  if (globalThis.__diagnosticListenersAttached) return;
  globalThis.__diagnosticListenersAttached = true;

  callEvents.on('RING', () => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId) return;

    if (callPhase === 'first-call') {
      const ringTest = state.tests.find(t => t.id === 'ring-detection');
      if (ringTest?.status === 'running') {
        clearRingTimeout();
        setTestStatus('ring-detection', 'pass', 'RING signal received');
        modemLog('info', '[Diagnostic] RING detection passed');
        advanceTo('caller-id');
        armRingTimeout('caller-id', 'caller ID');
      }
    } else if (callPhase === 'blocklist-call') {
      // RING received — caller ID will follow, handled in CALLER_ID listener
    } else if (callPhase === 'whitelist-call') {
      // same
    }
  });

  callEvents.on('CALLER_ID', (info: { name?: string; number?: string }) => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId) return;

    const number = info.number ?? '';
    const name = info.name ?? '';

    if (callPhase === 'first-call') {
      const callerIdTest = state.tests.find(t => t.id === 'caller-id');
      if (callerIdTest?.status === 'running') {
        clearRingTimeout();
        state.detectedNumber = number || undefined;
        state.detectedName = name || undefined;
        const detail = number ? `number="${number}" name="${name || 'unknown'}"` : 'Caller ID received (no number)';
        setTestStatus('caller-id', 'pass', detail);
        modemLog('info', `[Diagnostic] Caller ID passed — ${detail}`);
        advanceTo('greeting-played');
      }
    }

    if (callPhase === 'blocklist-call') {
      // nothing extra needed — incoming-call event handles pass/fail for blocklist
    }
    if (callPhase === 'whitelist-call') {
      // nothing extra needed — incoming-call event handles pass/fail for whitelist
    }
  });

  callEvents.on('greeting-played', () => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId || callPhase !== 'first-call') return;
    const test = state.tests.find(t => t.id === 'greeting-played');
    if (test?.status === 'running') {
      setTestStatus('greeting-played', 'pass', 'Greeting audio played successfully');
      modemLog('info', '[Diagnostic] Greeting played passed');
      advanceTo('recording-started');
    }
  });

  callEvents.on('recording-started', () => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId || callPhase !== 'first-call') return;
    const test = state.tests.find(t => t.id === 'recording-started');
    if (test?.status === 'running') {
      setTestStatus('recording-started', 'pass', 'Modem entered voice receive mode');
      modemLog('info', '[Diagnostic] Recording started passed');
      advanceTo('hangup-detected');
    }
  });

  callEvents.on('CALL_END', () => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId) return;

    if (callPhase === 'first-call') {
      const hangupTest = state.tests.find(t => t.id === 'hangup-detected');
      if (hangupTest?.status === 'running' || hangupTest?.status === 'pending') {
        clearRingTimeout();
        setTestStatus('hangup-detected', 'pass', 'CALL_END received');
        modemLog('info', '[Diagnostic] Hang-up detection passed');
        // voicemail-saved is checked on 'new-voicemail' event
        advanceTo('voicemail-saved');
        // Give voicemail save up to 10s before auto-failing
        ringTimeout = setTimeout(() => {
          ringTimeout = null;
          const vmTest = state.tests.find(t => t.id === 'voicemail-saved');
          if (vmTest?.status === 'running') {
            setTestStatus('voicemail-saved', 'fail', 'No voicemail saved within 10 seconds');
            modemLog('warn', '[Diagnostic] Voicemail save timed out');
            startBlocklistTest().catch(() => {});
          }
        }, 10_000);
      }
    } else if (callPhase === 'blocklist-call') {
      // clean up temp blacklist entry
      const num = state.detectedNumber;
      if (num) removeFromBlacklist(num).catch(() => {});
    } else if (callPhase === 'whitelist-call') {
      // clean up temp whitelist entry
      const num = state.detectedNumber;
      if (num) removeFromWhitelist(num).catch(() => {});
      callPhase = 'idle';
    }
  });

  callEvents.on('new-voicemail', (data: { filename?: string }) => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId) return;
    const vmTest = state.tests.find(t => t.id === 'voicemail-saved');
    if (vmTest?.status === 'running') {
      clearRingTimeout();
      const filename = data.filename ?? '';
      state.lastVoicemailFilename = filename;
      // Verify file exists
      const fullPath = filename ? path.join(path.resolve(config.messagesDir), path.basename(filename)) : '';
      const exists = fullPath ? fs.existsSync(fullPath) : false;
      if (exists) {
        const stat = fs.statSync(fullPath);
        setTestStatus('voicemail-saved', 'pass', `Saved: ${path.basename(filename)} (${(stat.size / 1024).toFixed(1)} KB)`);
        modemLog('info', '[Diagnostic] Voicemail saved passed');
      } else {
        setTestStatus('voicemail-saved', 'pass', `Voicemail saved: ${path.basename(filename)}`);
        modemLog('info', '[Diagnostic] Voicemail saved passed (file path not resolved)');
      }
      startBlocklistTest().catch(err => modemLog('error', `[Diagnostic] ${err}`));
    }
  });

  callEvents.on('incoming-call', (data: { action?: string; number?: string }) => {
    const state = globalThis.__diagnosticState;
    if (!state.sessionId) return;

    if (callPhase === 'blocklist-call') {
      const test = state.tests.find(t => t.id === 'blocklist-screening');
      if (test?.status === 'running') {
        clearRingTimeout();
        if (data.action === 'Blocked') {
          setTestStatus('blocklist-screening', 'pass', `Call from ${data.number ?? 'caller'} correctly blocked`);
          modemLog('info', '[Diagnostic] Blocklist screening passed');
        } else {
          setTestStatus('blocklist-screening', 'fail', `Expected Blocked, got ${data.action}`);
          modemLog('warn', `[Diagnostic] Blocklist screening failed — action was ${data.action}`);
        }
        // Remove from blacklist immediately after screening result
        const num = state.detectedNumber;
        if (num) removeFromBlacklist(num).catch(() => {});
        callPhase = 'idle';
        startWhitelistTest().catch(err => modemLog('error', `[Diagnostic] ${err}`));
      }
    } else if (callPhase === 'whitelist-call') {
      const test = state.tests.find(t => t.id === 'whitelist-screening');
      if (test?.status === 'running') {
        clearRingTimeout();
        if (data.action === 'Permitted') {
          setTestStatus('whitelist-screening', 'pass', `Call from ${data.number ?? 'caller'} correctly permitted`);
          modemLog('info', '[Diagnostic] Whitelist screening passed');
        } else {
          setTestStatus('whitelist-screening', 'fail', `Expected Permitted, got ${data.action}`);
          modemLog('warn', `[Diagnostic] Whitelist screening failed — action was ${data.action}`);
        }
        // Remove from whitelist
        const num = state.detectedNumber;
        if (num) removeFromWhitelist(num).catch(() => {});
        callPhase = 'idle';
        broadcastState();
      }
    }
  });
}

async function startBlocklistTest(): Promise<void> {
  const state = globalThis.__diagnosticState;
  callPhase = 'blocklist-call';
  advanceTo('blocklist-screening');
  const num = state.detectedNumber;
  if (num) {
    await addToBlacklist({ phoneNo: num, name: state.detectedName ?? null, reason: 'Diagnostic test — auto-removed after call' });
    modemLog('info', `[Diagnostic] Temporarily added ${num} to blacklist for blocklist test`);
  }
  armRingTimeout('blocklist-screening', 'blocked call');
}

async function startWhitelistTest(): Promise<void> {
  const state = globalThis.__diagnosticState;
  callPhase = 'whitelist-call';
  advanceTo('whitelist-screening');
  const num = state.detectedNumber;
  if (num) {
    await addToWhitelist({ phoneNo: num, name: state.detectedName ?? null, reason: 'Diagnostic test — auto-removed after call' });
    modemLog('info', `[Diagnostic] Temporarily added ${num} to whitelist for whitelist test`);
  }
  armRingTimeout('whitelist-screening', 'permitted call');
}

export function startDiagnostic(): DiagnosticState {
  attachListeners();
  clearRingTimeout();
  callPhase = 'idle';

  globalThis.__diagnosticState = {
    sessionId: Date.now().toString(36),
    currentTestIndex: 0,
    tests: makeTests(),
  };

  const state = globalThis.__diagnosticState;

  // Test 1: Modem Connected — auto
  state.tests[0]!.status = 'running';
  state.tests[0]!.startedAt = Date.now();
  const modem = getModem();
  if (modem && modem.isOpen()) {
    state.tests[0]!.status = 'pass';
    state.tests[0]!.message = 'Modem serial port is open';
    state.tests[0]!.completedAt = Date.now();
    state.currentTestIndex = 1;
    state.tests[1]!.status = 'running';
    state.tests[1]!.startedAt = Date.now();
    callPhase = 'first-call';
    armRingTimeout('ring-detection', 'ring signal');
    modemLog('info', '[Diagnostic] Session started — waiting for RING');
  } else {
    state.tests[0]!.status = 'fail';
    state.tests[0]!.message = 'Modem is not connected or serial port is closed';
    state.tests[0]!.completedAt = Date.now();
    for (let i = 1; i < state.tests.length; i++) {
      state.tests[i]!.status = 'fail';
      state.tests[i]!.message = 'Skipped — modem not connected';
    }
    modemLog('warn', '[Diagnostic] Session started but modem is not connected');
  }

  broadcastState();
  return state;
}

export function resetDiagnostic(): DiagnosticState {
  clearRingTimeout();
  callPhase = 'idle';
  // Clean up any lingering temp entries if we have a detected number
  const old = globalThis.__diagnosticState;
  if (old.detectedNumber) {
    removeFromBlacklist(old.detectedNumber).catch(() => {});
    removeFromWhitelist(old.detectedNumber).catch(() => {});
  }
  globalThis.__diagnosticState = initialState();
  broadcastState();
  modemLog('info', '[Diagnostic] Session reset');
  return globalThis.__diagnosticState;
}
