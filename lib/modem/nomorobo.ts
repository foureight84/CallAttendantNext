import * as cheerio from 'cheerio';

export interface NomoroboResult {
  score: number;   // 0 = clean, 1 = suspicious, 2 = DO NOT ANSWER
  reason: string;
}

/**
 * Scrape nomorobo.com to check if a number is a robocall.
 * Returns score >= config.spamThreshold to block.
 */
export async function checkNomorobo(phoneNumber: string): Promise<NomoroboResult> {
  // Format to dashes: 8005551234 → 800-555-1234
  const formatted = phoneNumber.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  // format no longer needed
  const url = `https://www.nomorobo.com/lookup/${phoneNumber}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CallAttendant/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      console.warn(`[nomorobo] HTTP ${response.status} for ${formatted}`);
      return { score: 0, reason: 'lookup failed' };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const metaDesc = $('meta[name="description"]').attr('content') ?? '';
    const match = metaDesc.match(/is (?:a|an) ([^.]+)/i);
    const position = match ? match[1]!.trim() : '';
    const callActivity = $('span.big-alert-badge').text().trim() ?? '';

    const BLOCK_TYPES = ['Robocall', 'Telemarketer', 'Political', 'Scam', 'Debt Collector', 'Do Not Answer'];

    if (BLOCK_TYPES.some(t => t.toLowerCase() === position.toLowerCase())) {
      return { score: 2, reason: `Nomorobo: ${position}` };
    }

    if (position.toLocaleLowerCase() === 'unknown caller') {
      return { score: 0, reason: `Nomorobo: not listed`};
    }

    if (position.length > 0) {
      return { score: 1, reason: `Nomorobo: ${position} - ${callActivity}` };
    }

    return { score: 0, reason: 'Nomorobo: not listed' };
  } catch (err) {
    console.error('[nomorobo] Error:', err);
    return { score: 0, reason: 'lookup error' };
  }
}
