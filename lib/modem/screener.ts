import { isWhitelisted, isBlacklisted, getSettings, addToBlacklist } from '../db';
import { NomoroboChecker } from './nomorobo';
import { IpqsChecker } from './ipqs';
import { modemLog } from '../events';

export type ScreeningAction = 'Permitted' | 'Blocked' | 'Screened';

export interface ScreeningResult {
  action: ScreeningAction;
  reason: string;
  immediate?: boolean;
  resolvedName?: string;
  lineType?: string;
  carrier?: string;
  city?: string;
  region?: string;
  country?: string;
  fraudScore?: number;
  riskFlags?: string;
}

export class CallerScreener {
  private readonly nomorobo = new NomoroboChecker();
  private readonly ipqs = new IpqsChecker();

  async screen(name: string, number: string): Promise<ScreeningResult> {
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

    if (this.isObviousSpam(name, number)) {
      modemLog('info', `✗ Spam pattern match — blocking`);
      return { action: 'Blocked', reason: 'Pattern match: obvious spam' };
    }

    const validNumber = number && number !== 'P' && number !== 'O';

    if (validNumber && (blockService === 'NOMOROBO' || blockService === 'IPQS' || blockService === 'BOTH')) {
      let score = 0;
      let reason = 'Unknown caller';
      let ipqsMeta: Pick<ScreeningResult, 'resolvedName' | 'lineType' | 'carrier' | 'city' | 'region' | 'country' | 'fraudScore' | 'riskFlags'> = {};

      if (blockService === 'BOTH') {
        modemLog('info', `Checking Nomorobo + IPQS in parallel for ${number}...`);
        const [nResult, iResult] = await Promise.all([
          this.nomorobo.check(number),
          this.ipqs.check(number),
        ]);
        modemLog('info', `Nomorobo: score=${nResult.score} — ${nResult.reason}`);
        modemLog('info', `IPQS: score=${iResult.score} — ${iResult.reason}`);
        ipqsMeta = extractIpqsMeta(iResult);
        if (iResult.score >= nResult.score) {
          score = iResult.score;
          reason = iResult.reason;
        } else {
          score = nResult.score;
          reason = nResult.reason;
        }
      } else if (blockService === 'NOMOROBO') {
        modemLog('info', `Checking Nomorobo for ${number}...`);
        const result = await this.nomorobo.check(number);
        modemLog('info', `Nomorobo result: score=${result.score} — ${result.reason}`);
        score = result.score;
        reason = result.reason;
      } else {
        modemLog('info', `Checking IPQS for ${number}...`);
        const result = await this.ipqs.check(number);
        modemLog('info', `IPQS result: score=${result.score} — ${result.reason}`);
        score = result.score;
        reason = result.reason;
        ipqsMeta = extractIpqsMeta(result);
      }

      if (score >= spamThreshold) {
        const blockReason = `${reason} (score: ${score})`;
        if (autoBlockSpam) {
          modemLog('info', `Auto-blocking ${number} — adding to blocklist`);
          await addToBlacklist({
            phoneNo: number,
            name: name,
            reason: blockReason,
            systemDateTime: new Date().toISOString(),
          }).catch(err => modemLog('warn', `Failed to auto-block ${number}: ${err}`));
        }
        return { action: 'Blocked', reason: blockReason, ...ipqsMeta };
      }
      if (score > 0) {
        return { action: 'Screened', reason, ...ipqsMeta };
      }
      return { action: 'Screened', reason: 'Unknown caller', ...ipqsMeta };
    }

    return { action: 'Screened', reason: 'Unknown caller' };
  }

  private isObviousSpam(name: string, number: string): boolean {
    const spamPatterns = [/^0+$/, /^1234567890$/, /^9999999999$/];
    const spamNames = ['UNKNOWN', 'UNAVAILABLE', 'V', 'O'];
    if (spamNames.includes(name?.toUpperCase())) return false;
    for (const pattern of spamPatterns) {
      if (pattern.test(number)) return true;
    }
    return false;
  }
}

function extractIpqsMeta(result: { raw: { name?: string | null; line_type?: string | null; carrier?: string | null; city?: string | null; region?: string | null; country?: string | null; fraud_score?: number; recent_abuse?: boolean | null; spammer?: boolean | null; do_not_call?: boolean | null; risky?: boolean | null } | null }): Pick<ScreeningResult, 'resolvedName' | 'lineType' | 'carrier' | 'city' | 'region' | 'country' | 'fraudScore' | 'riskFlags'> {
  const raw = result.raw;
  if (!raw) return {};
  const flags = (['recent_abuse', 'spammer', 'do_not_call', 'risky'] as const).filter(f => raw[f] === true);
  return {
    resolvedName: raw.name && raw.name !== 'N/A' ? raw.name : undefined,
    lineType:     raw.line_type && raw.line_type !== 'N/A' ? raw.line_type : undefined,
    carrier:      raw.carrier && raw.carrier !== 'N/A' ? raw.carrier : undefined,
    city:         raw.city && raw.city !== 'N/A' ? raw.city : undefined,
    region:       raw.region && raw.region !== 'N/A' ? raw.region : undefined,
    country:      raw.country && raw.country !== 'N/A' ? raw.country : undefined,
    fraudScore:   typeof raw.fraud_score === 'number' ? raw.fraud_score : undefined,
    riskFlags:    flags.length > 0 ? flags.join(',') : undefined,
  };
}
