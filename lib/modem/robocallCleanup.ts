import { CronExpressionParser } from 'cron-parser';
import { getSettings, getRobocallBlacklist, removeFromBlacklist } from '../db';
import { modemLog } from '../events';
import { NomoroboChecker } from './nomorobo';

const checker = new NomoroboChecker();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNextRunDate(cronExpr: string): Date {
  return CronExpressionParser.parse(cronExpr).next().toDate();
}

// --- Single-flight mutex ---

let cleanupRunning = false;

export function isCleanupRunning(): boolean {
  return cleanupRunning;
}

// --- Cleanup logic ---

export async function runRobocallCleanup(): Promise<void> {
  if (cleanupRunning) {
    modemLog('info', '[cleanup] Already in progress, skipping.');
    return;
  }
  cleanupRunning = true;
  try {
    const settings = await getSettings();
    if (!settings.robocallCleanupEnabled) return;

    const entries = await getRobocallBlacklist();
    const n = entries.length;

    if (n === 0) {
      modemLog('info', '[cleanup] No robocall entries in blocklist to check.');
      return;
    }

    const estMins = Math.round(n * 10 / 60);
    modemLog('info', `[cleanup] Starting — ${n} number${n === 1 ? '' : 's'} to check (~${estMins}m estimated)`);

    let removed = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const result = await checker.check(entry.phoneNo);
      if (result.score === 0) {
        await removeFromBlacklist(entry.phoneNo);
        removed++;
        modemLog('info', `[cleanup] Removed ${entry.phoneNo} — no longer flagged by Nomorobo`);
      } else {
        modemLog('info', `[cleanup] Kept ${entry.phoneNo} — still flagged: ${result.reason}`);
      }
      if (i < entries.length - 1) await sleep(10_000);
    }

    modemLog('info', `[cleanup] Done — removed ${removed} of ${n} number${n === 1 ? '' : 's'}`);
  } catch (err) {
    modemLog('error', `[cleanup] Error: ${String(err)}`);
  } finally {
    cleanupRunning = false;
  }
}

// --- Scheduler ---

let cleanupTimeoutId: NodeJS.Timeout | null = null;

export function scheduleRobocallCleanup(): void {
  if (cleanupTimeoutId) {
    clearTimeout(cleanupTimeoutId);
    cleanupTimeoutId = null;
  }

  getSettings().then(settings => {
    if (!settings.robocallCleanupEnabled) return;

    let next: Date;
    try {
      next = getNextRunDate(settings.robocallCleanupCron);
    } catch {
      console.error('[cleanup] Invalid cron expression:', settings.robocallCleanupCron);
      return;
    }

    const delay = next.getTime() - Date.now();
    cleanupTimeoutId = setTimeout(async () => {
      await runRobocallCleanup();
      scheduleRobocallCleanup();
    }, delay);
  }).catch(err => {
    console.error('[cleanup] Failed to read settings for scheduling:', err);
  });
}

export function rescheduleRobocallCleanup(): void {
  scheduleRobocallCleanup();
}
