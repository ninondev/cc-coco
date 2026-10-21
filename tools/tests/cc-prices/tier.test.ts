// Haiku 5.5 is priced twice, split by the length of one request's whole prompt (K1 part 2).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIER_SPLIT_TOKENS, parsePricePage, priceAt, priceFor } from '../../../plugin/hooks/cost/prices/index.ts';
import type { PriceRow } from '../../../plugin/hooks/cost/prices/index.ts';
import { haikuRow, miniPage, opusRow, row, sonnetRow } from './helpers.ts';

const low = row('Claude Haiku 5.5 (up to 100K tokens)', 0.1, 0.125, 0.2, 0.01, 0.5);
const high = row('Claude Haiku 5.5 (over 100K tokens)', 0.5, 0.625, 1, 0.05, 2.5);
const page = (...extra: string[]) => miniPage(opusRow(), sonnetRow(), haikuRow(), ...extra);

describe('parsePricePage joins the two prompt-length rows of one model', () => {
  test('up to and over rows become one row with an over tier', () => {
    const parsed = parsePricePage(page(low, high));
    expect(parsed.rejected).toEqual([]);
    const haiku = parsed.rows.find((r) => r.id === 'claude-haiku-5-5');
    expect(haiku).toEqual({
      id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5, status: 'current',
      over: { above: 100000, input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 },
    });
    expect(parsed.rows.filter((r) => r.id.startsWith('claude-haiku-5-5'))).toHaveLength(1);
  });

  test('the order of the two rows does not matter', () => {
    const parsed = parsePricePage(page(high, low));
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows.find((r) => r.id === 'claude-haiku-5-5')?.over?.output).toBe(2.5);
  });

  test('other ways to write the bracket are read the same', () => {
    for (const [a, b] of [['(≤ 100,000 tokens)', '(> 100,000 tokens)'], ['(prompts under 100k)', '(prompts above 100k)'], ['(within 100 000 tokens)', '(more than 100K tokens)']]) {
      const parsed = parsePricePage(page(row(`Claude Haiku 5.5 ${a}`, 0.1, 0.125, 0.2, 0.01, 0.5), row(`Claude Haiku 5.5 ${b}`, 0.5, 0.625, 1, 0.05, 2.5)));
      expect(parsed.rejected).toEqual([]);
      expect(parsed.rows.find((r) => r.id === 'claude-haiku-5-5')?.over?.input).toBe(0.5);
    }
  });

  test('a longer-prompt row with no shorter one is refused and kept out of the table', () => {
    const parsed = parsePricePage(page(high));
    expect(parsed.rows.some((r) => r.id.startsWith('claude-haiku-5-5'))).toBe(false);
    expect(parsed.rejected).toEqual([{ name: 'Claude Haiku 5.5', why: 'tier' }]);
  });

  test('a second longer-prompt row for the same model is refused', () => {
    const parsed = parsePricePage(page(low, high, high));
    expect(parsed.rejected).toEqual([{ name: 'Claude Haiku 5.5', why: 'tier' }]);
    expect(parsed.rows.find((r) => r.id === 'claude-haiku-5-5')?.over?.input).toBe(0.5);
  });

  test('the ratio guard applies to the longer tier too', () => {
    const bad = row('Claude Haiku 5.5 (over 100K tokens)', 0.5, 0.625, 1, 0.05, 90);
    const parsed = parsePricePage(page(low, bad));
    expect(parsed.rejected).toEqual([{ name: 'Claude Haiku 5.5', why: 'ratios' }]);
    expect(parsed.rows.find((r) => r.id === 'claude-haiku-5-5')?.over).toBeUndefined();
  });

  test('a bracket that is not a prompt-length tier stays part of the model name', () => {
    const parsed = parsePricePage(page(row('Claude Probe 4.5 (preview)', 1, 1.25, 2, 0.1, 5)));
    expect(parsed.rows.some((r) => r.id === 'claude-probe-4-5-preview')).toBe(true);
  });
});

describe('priceAt picks the prices of one request by its whole prompt', () => {
  const haiku = parsePricePage(page(low, high)).rows.find((r) => r.id === 'claude-haiku-5-5') as PriceRow;
  test('the split is 100,000 tokens and the limit itself is the lower price', () => {
    expect(TIER_SPLIT_TOKENS).toBe(100000);
    expect(priceAt(haiku, 0).input).toBe(0.1);
    expect(priceAt(haiku, 100000).input).toBe(0.1);
    expect(priceAt(haiku, 100001).input).toBe(0.5);
    expect(priceAt(haiku, 100001).output).toBe(2.5);
    expect(priceAt(haiku, 100001).read).toBe(0.05);
  });
  test('a prompt that is not a finite number stays on the lower price', () => {
    for (const n of [NaN, -1]) expect(priceAt(haiku, n).input).toBe(0.1);
    expect(priceAt(haiku, Infinity).input).toBe(0.1);
  });
  test('a model with one price ignores the length', () => {
    const opus = parsePricePage(page()).rows.find((r) => r.id === 'claude-opus-4-5') as PriceRow;
    expect(priceAt(opus, 5_000_000)).toBe(opus);
  });
  test('priceFor finds the joined row for a host id', () => {
    expect(priceFor('claude-haiku-5-5-20261009', [haiku])?.over?.above).toBe(100000);
  });
});

describe('the shipped table', () => {
  const shipped = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugin/assets/prices.json'), 'utf8')) as { rows: PriceRow[]; supplement?: { ids: string[]; asOf: string } };
  test('carries Haiku 5.5 with both tiers, ahead of Haiku 4.5, and says where the row came from', () => {
    const ids = shipped.rows.map((r) => r.id);
    expect(ids.indexOf('claude-haiku-5-5')).toBeGreaterThan(-1);
    expect(ids.indexOf('claude-haiku-5-5')).toBeLessThan(ids.indexOf('claude-haiku-4-5'));
    const haiku = shipped.rows[ids.indexOf('claude-haiku-5-5')]!;
    expect([haiku.input, haiku.output, haiku.read, haiku.write5m, haiku.write1h]).toEqual([0.1, 0.5, 0.01, 0.125, 0.2]);
    expect([haiku.over?.above, haiku.over?.input, haiku.over?.output, haiku.over?.read, haiku.over?.write5m, haiku.over?.write1h]).toEqual([100000, 0.5, 2.5, 0.05, 0.625, 1]);
    expect(shipped.supplement?.ids).toEqual(['claude-haiku-5-5']);
  });
});
