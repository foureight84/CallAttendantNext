/**
 * Live integration test for NomoroboChecker.
 *
 * Tests a known robocaller number (3157859930) against nomorobo.com.
 * If this fails, either:
 *   1. The site's HTML structure changed and the scraper needs updating, OR
 *   2. The number is no longer listed — find a new known robocaller to test against.
 *
 * Requires outbound internet access. Skipped in offline/restricted environments.
 */
import { describe, it, expect } from 'vitest';
import { NomoroboChecker } from '@/lib/modem/nomorobo';

// Known robocaller — 315-785-9930
// If this test fails, verify the number is still listed at https://www.nomorobo.com/lookup/3157859930
const KNOWN_ROBOCALLER = '3157859930';

describe('NomoroboChecker — live scrape', () => {
  it('identifies a known robocaller number with score >= 1', async () => {
    const checker = new NomoroboChecker();
    const result = await checker.check(KNOWN_ROBOCALLER);

    // Score 1 = suspicious, score 2 = DO NOT ANSWER
    // Either indicates a hit; 0 means the number is no longer listed
    if (result.score === 0) {
      console.warn(
        `[nomorobo] ${KNOWN_ROBOCALLER} returned score 0 — it may no longer be listed. ` +
        `Verify at https://www.nomorobo.com/lookup/${KNOWN_ROBOCALLER} and update test number if needed.`
      );
    }

    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.reason).toMatch(/Nomorobo/i);
  }, 10_000); // 10s timeout for network request
});
