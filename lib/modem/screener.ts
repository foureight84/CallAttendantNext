import { isWhitelisted, isBlacklisted, getSettings, addToBlacklist } from '../db';
import { checkNomorobo } from './nomorobo';
import { modemLog } from '../events';

export type ScreeningAction = 'Permitted' | 'Blocked' | 'Screened';

export interface ScreeningResult {
  action: ScreeningAction;
  reason: string;
  immediate?: boolean; // skip ring wait and go straight to voicemail
}

export async function screenCaller(name: string, number: string): Promise<ScreeningResult> {
  const { screeningMode: modes, blockService, spamThreshold, autoBlockSpam } = await getSettings();

  if (modes.includes('blacklist')) {
    const entry = await isBlacklisted(number);
    if (entry) {
      const reason = `Blacklisted: ${entry.reason ?? 'blocked caller'}`;
      const matchType = entry.phoneNo.includes('*') ? `wildcard ${entry.phoneNo}` : 'exact';
      modemLog('info', `✗ Blacklist match (${matchType}) — ${entry.name ?? name} - ${number} — blocked`);
      return { action: 'Blocked', reason };
    }
  }

  if (modes.includes('whitelist')) {
    const entry = await isWhitelisted(number);
    if (entry) {
      const reason = `Whitelisted: ${entry.reason ?? 'known caller'}`;
      const matchType = entry.phoneNo.includes('*') ? `wildcard ${entry.phoneNo}` : 'exact';
      modemLog('info', `✓ Whitelist match (${matchType}) — ${entry.name ?? name} - ${number}`);
      return { action: 'Permitted', reason };
    }
  }

  if (isObviousSpam(name, number)) {
    modemLog('info', `✗ Spam pattern match — blocking`);
    return { action: 'Blocked', reason: 'Pattern match: obvious spam' };
  }

  if (blockService === 'NOMOROBO' && number && number !== 'P' && number !== 'O') {
    modemLog('info', `Checking Nomorobo for ${number}...`);
    const result = await checkNomorobo(number);
    modemLog('info', `Nomorobo result: score=${result.score} — ${result.reason}`);
    if (result.score >= spamThreshold) {
      const blockReason = `${result.reason} (score: ${result.score})`;
      if (autoBlockSpam) {
        modemLog('info', `Auto-blocking ${number} — adding to blocklist`);
        await addToBlacklist({
          phoneNo: number,
          name: name,
          reason: blockReason,
          systemDateTime: new Date().toISOString(),
        }).catch(err => modemLog('warn', `Failed to auto-block ${number}: ${err}`));
      }
      return { action: 'Blocked', reason: blockReason };
    }
    if (result.score > 0) {
      return { action: 'Screened', reason: result.reason };
    }
  }

  return { action: 'Screened', reason: 'Unknown caller' };
}

function isObviousSpam(name: string, number: string): boolean {
  const spamPatterns = [/^0+$/, /^1234567890$/, /^9999999999$/];
  const spamNames = ['UNKNOWN', 'UNAVAILABLE', 'V', 'O'];
  if (spamNames.includes(name?.toUpperCase())) return false;
  for (const pattern of spamPatterns) {
    if (pattern.test(number)) return true;
  }
  return false;
}
