import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface IncomingCallEvent {
  callLogId: number;
  name: string;
  number: string;
  date: string;
  time: string;
  action: 'Permitted' | 'Blocked' | 'Screened';
  reason: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'data';

export interface ModemLogEntry {
  ts: string;       // ISO timestamp
  level: LogLevel;
  msg: string;
}

const LOG_BUFFER_SIZE = 1000;

export interface LogFileConfig {
  logFile: string;
  logMaxBytes: number;
  logKeepFiles: number;
}

class CallEventEmitter extends EventEmitter {}

// Store on globalThis so all module instances share the same emitter and log buffer
declare global {
  // eslint-disable-next-line no-var
  var __callEvents: CallEventEmitter;
  // eslint-disable-next-line no-var
  var __logBuffer: ModemLogEntry[];
  // eslint-disable-next-line no-var
  var __logDirEnsured: boolean;
  // eslint-disable-next-line no-var
  var __logConfig: LogFileConfig | null;
}
globalThis.__callEvents ??= new CallEventEmitter();
globalThis.__logBuffer ??= [];
globalThis.__logDirEnsured ??= false;
globalThis.__logConfig ??= null;

export const callEvents: CallEventEmitter = globalThis.__callEvents;

function getLogConfig(): LogFileConfig {
  return globalThis.__logConfig ?? {
    logFile: config.logFile,
    logMaxBytes: config.logMaxBytes,
    logKeepFiles: config.logKeepFiles,
  };
}

/** Update the live log config (called when settings are saved via UI). */
export function updateLogConfig(cfg: LogFileConfig): void {
  if (globalThis.__logConfig?.logFile !== cfg.logFile) {
    globalThis.__logDirEnsured = false; // new path — re-create dir on next write
  }
  globalThis.__logConfig = cfg;
}

function ensureLogDir(): void {
  if (globalThis.__logDirEnsured) return;
  fs.mkdirSync(path.dirname(getLogConfig().logFile), { recursive: true });
  globalThis.__logDirEnsured = true;
}

function appendToLogFile(entry: ModemLogEntry): void {
  ensureLogDir();
  fs.appendFileSync(getLogConfig().logFile, JSON.stringify(entry) + '\n', 'utf8');
}

function maybeRotate(): void {
  const { logFile, logMaxBytes, logKeepFiles } = getLogConfig();
  try {
    const stat = fs.statSync(logFile);
    if (stat.size <= logMaxBytes) return;
    // Delete oldest rotated file
    try { fs.unlinkSync(`${logFile}.${logKeepFiles}`); } catch { /* doesn't exist */ }
    // Shift rotated files: .1 → .2, etc.
    for (let i = logKeepFiles - 1; i >= 1; i--) {
      try { fs.renameSync(`${logFile}.${i}`, `${logFile}.${i + 1}`); } catch { /* skip */ }
    }
    // Current log → .1
    fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* log file doesn't exist yet */ }
}

/** Read the last n non-data log entries from log file(s). */
export function readLogHistory(n: number): ModemLogEntry[] {
  const { logFile, logKeepFiles } = getLogConfig();
  // Collect files oldest-first so final concat is chronological
  const files: string[] = [];
  for (let i = logKeepFiles; i >= 1; i--) {
    files.push(`${logFile}.${i}`);
  }
  files.push(logFile);

  const rawLines: string[] = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      rawLines.push(...content.split('\n').filter(l => l.trim()));
    } catch { /* file absent, skip */ }
  }

  const recent = rawLines.slice(-n);
  const entries: ModemLogEntry[] = [];
  for (const line of recent) {
    try { entries.push(JSON.parse(line) as ModemLogEntry); } catch { /* malformed line */ }
  }
  return entries;
}

/** Emit a modem log line — stored in a ring buffer and broadcast to SSE clients.
 *  `data` entries are streamed via SSE only; they are not stored in the buffer or written to file. */
export function modemLog(level: LogLevel, msg: string): void {
  const entry: ModemLogEntry = { ts: new Date().toISOString(), level, msg };

  if (level !== 'data') {
    globalThis.__logBuffer.push(entry);
    if (globalThis.__logBuffer.length > LOG_BUFFER_SIZE) globalThis.__logBuffer.shift();
    appendToLogFile(entry);
    maybeRotate();
  }

  globalThis.__callEvents.emit('modem-log', entry);

  // Mirror to process stdout so server logs stay useful
  const prefix = `[modem]`;
  if (level === 'error') console.error(prefix, msg);
  else if (level === 'warn') console.warn(prefix, msg);
  else console.log(prefix, msg);
}

/** Returns a snapshot of the recent log buffer (newest last). */
export function getLogBuffer(): ModemLogEntry[] {
  return [...globalThis.__logBuffer];
}
