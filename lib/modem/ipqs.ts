interface IpqsRawResponse {
  success: boolean;
  message: string;
  fraud_score: number;
  valid: boolean;
  active: boolean | null;
  recent_abuse: boolean | null;
  VOIP: boolean | null;
  prepaid: boolean | null;
  risky: boolean | null;
  spammer: boolean | null;
  do_not_call: boolean | null;
  leaked: boolean | null;
  line_type: string | null;
  carrier: string | null;
  name: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  zip_code: string | null;
  dialing_code: number | null;
  active_status: string | null;
  user_activity: string | null;
  request_id: string;
}

export interface IpqsResult {
  score: number;
  reason: string;
  raw: IpqsRawResponse | null;
}

export interface IpqsUsageData {
  success: boolean;
  message?: string;
  credits?: number;
  usage?: number;
  phone_usage?: number;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

let exhaustedMonth: string | null = null;
let cachedUsage: { credits: number; usage: number; phone_usage: number; fetchedAt: number } | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function getIpqsCachedUsage() {
  return cachedUsage;
}

export function isIpqsExhausted(): boolean {
  return exhaustedMonth === currentMonthKey();
}

export class IpqsChecker {
  async check(phoneNumber: string): Promise<IpqsResult> {
    const { getSettings } = await import('../db');
    const { ipqsApiKey, ipqsStrictness, ipqsCountries } = await getSettings();

    if (!ipqsApiKey) {
      return { score: 0, reason: 'IPQS: no API key configured', raw: null };
    }

    if (isIpqsExhausted()) {
      return { score: 0, reason: 'IPQS: monthly credits exhausted', raw: null };
    }

    const url = new URL(`https://www.ipqualityscore.com/api/json/phone/${ipqsApiKey}/${encodeURIComponent(phoneNumber)}`);
    if (ipqsStrictness > 0) url.searchParams.set('strictness', String(ipqsStrictness));
    for (const country of ipqsCountries) url.searchParams.append('country[]', country);

    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'CallAttendantNext/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        console.warn(`[ipqs] HTTP ${res.status} for ${phoneNumber}`);
        return { score: 0, reason: 'IPQS: lookup failed', raw: null };
      }

      const data = await res.json() as IpqsRawResponse;

      if (!data.success) {
        if (data.message?.toLowerCase().includes('insufficient credits')) {
          exhaustedMonth = currentMonthKey();
          console.warn('[ipqs] Monthly credits exhausted — IPQS lookups paused until next month');
          if (cachedUsage) cachedUsage = { ...cachedUsage, phone_usage: cachedUsage.credits };
        }
        return { score: 0, reason: `IPQS: ${data.message ?? 'lookup failed'}`, raw: data };
      }

      const score = computeScore(data);
      const reason = buildReason(data, score);
      return { score, reason, raw: data };
    } catch (err) {
      console.error('[ipqs] Error:', err);
      return { score: 0, reason: 'IPQS: lookup error', raw: null };
    }
  }

  async getUsage(apiKey: string): Promise<IpqsUsageData> {
    try {
      const res = await fetch(`https://www.ipqualityscore.com/api/json/account/${apiKey}`, {
        headers: { 'User-Agent': 'CallAttendantNext/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json() as IpqsUsageData;
      if (data.success) {
        cachedUsage = {
          credits: data.credits ?? 0,
          usage: data.usage ?? 0,
          phone_usage: data.phone_usage ?? 0,
          fetchedAt: Date.now(),
        };
        // Only update the exhaustion flag when the response gives us credible numbers.
        // A credits=0 reply (API hiccup, malformed plan response) is treated as
        // "no information" and leaves any prior exhausted state untouched —
        // otherwise we'd silently undo a real "insufficient credits" detection
        // from the hot path.
        if (cachedUsage.credits > 0) {
          if (cachedUsage.phone_usage >= cachedUsage.credits) {
            exhaustedMonth = currentMonthKey();
          } else {
            exhaustedMonth = null;
          }
        }
      }
      return data;
    } catch (err) {
      console.error('[ipqs] Usage fetch error:', err);
      return { success: false, message: 'Request failed' };
    }
  }
}

function computeScore(d: IpqsRawResponse): number {
  if (d.spammer === true || d.fraud_score >= 90 || d.recent_abuse === true) return 3;
  if (d.fraud_score >= 75) return 2;
  if (d.fraud_score >= 50 || d.risky === true) return 1;
  return 0;
}

function buildReason(d: IpqsRawResponse, score: number): string {
  if (score === 0) return 'IPQS: not flagged';
  const parts: string[] = [`IPQS: fraud_score=${d.fraud_score}`];
  if (d.line_type) parts.push(d.line_type);
  if (d.carrier && d.carrier !== 'N/A') parts.push(d.carrier);
  const activeFlags = (['spammer', 'recent_abuse', 'risky'] as const).filter(f => d[f] === true);
  if (activeFlags.length) parts.push(`(${activeFlags.join(', ')})`);
  return parts.join(', ');
}

export async function startUsageRefresh(intervalMs = 60 * 60 * 1000): Promise<void> {
  const { getSettings } = await import('../db');
  const checker = new IpqsChecker();

  const refresh = async () => {
    try {
      const { blockService, ipqsApiKey } = await getSettings();
      if ((blockService === 'IPQS' || blockService === 'BOTH') && ipqsApiKey) {
        await checker.getUsage(ipqsApiKey);
        console.log(`[ipqs] Usage refreshed: phone_usage=${cachedUsage?.phone_usage ?? '?'}/${cachedUsage?.credits ?? '?'}`);
      }
    } catch { /* background — ignore */ }
  };

  await refresh();
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(refresh, intervalMs);
}
