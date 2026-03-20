import { EventEmitter } from 'events';

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

const LOG_BUFFER_SIZE = 500;

class CallEventEmitter extends EventEmitter {}

// Store on globalThis so all module instances share the same emitter and log buffer
declare global {
  // eslint-disable-next-line no-var
  var __callEvents: CallEventEmitter;
  // eslint-disable-next-line no-var
  var __logBuffer: ModemLogEntry[];
}
globalThis.__callEvents ??= new CallEventEmitter();
globalThis.__logBuffer ??= [];

export const callEvents: CallEventEmitter = globalThis.__callEvents;

/** Emit a modem log line — stored in a ring buffer and broadcast to SSE clients. */
export function modemLog(level: LogLevel, msg: string): void {
  const entry: ModemLogEntry = { ts: new Date().toISOString(), level, msg };
  globalThis.__logBuffer.push(entry);
  if (globalThis.__logBuffer.length > LOG_BUFFER_SIZE) globalThis.__logBuffer.shift();
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
