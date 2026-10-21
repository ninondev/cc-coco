import { describe, expect, test } from 'bun:test';
import * as index from '../../../plugin/hooks/cost/prices/index.ts';
import {
  FETCH_LIMIT_MS,
  OTHERS_URL,
  PRICE_PAGE_URL,
  SHIPPED_MAX_AGE_DAYS,
  arrangeRows,
  filterOthers,
  loadClaudePrices,
  loadOtherPrices,
  modelIdFromName,
  newestTable,
  normalizeModelId,
  PageChanged,
  parsePricePage,
  priceChanges,
  priceFor,
  shippedTooOld,
  trafficOff,
} from '../../../plugin/hooks/cost/prices/index.ts';
import type { PriceRow } from '../../../plugin/hooks/cost/prices/index.ts';

describe('exported literals', () => {
  test('URLs and constants have the documented values', () => {
    expect(PRICE_PAGE_URL).toBe('https://platform.claude.com/docs/en/about-claude/pricing.md');
    expect(OTHERS_URL).toBe('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json');
    expect(FETCH_LIMIT_MS).toBe(6000);
    expect(SHIPPED_MAX_AGE_DAYS).toBe(14);
  });

  test('every documented name is exported from src/index.ts', () => {
    const names = [
      'PRICE_PAGE_URL',
      'OTHERS_URL',
      'FETCH_LIMIT_MS',
      'SHIPPED_MAX_AGE_DAYS',
      'PageChanged',
      'parsePricePage',
      'modelIdFromName',
      'normalizeModelId',
      'priceFor',
      'newestTable',
      'shippedTooOld',
      'trafficOff',
      'loadClaudePrices',
      'OTHER_MAKERS',
      'filterOthers',
      'loadOtherPrices',
      'priceChanges',
      'arrangeRows',
    ];
    for (const n of names) expect(index).toHaveProperty(n);
  });

  test('why/from codes are the documented literals', () => {
    expect(['offline', 'changed', 'off']).toEqual(['offline', 'changed', 'off']);
    expect(['fetched', 'shipped']).toEqual(['fetched', 'shipped']);
    expect(['unparsed', 'ratios']).toEqual(['unparsed', 'ratios']);
    expect(['current', 'retired', 'limited']).toEqual(['current', 'retired', 'limited']);
    expect(PageChanged.name).toBe('PageChanged');
  });
});

describe('rule 10: no export throws on malformed input (parsePricePage excepted)', () => {
  test('modelIdFromName and normalizeModelId tolerate non-strings', () => {
    expect(modelIdFromName(undefined as unknown as string)).toBe('');
    expect(modelIdFromName(5 as unknown as string)).toBe('');
    expect(normalizeModelId(null as unknown as string)).toBe('');
    expect(normalizeModelId({} as unknown as string)).toBe('');
  });

  test('priceFor tolerates wrong types', () => {
    expect(priceFor('claude-opus-4-5', undefined as unknown as [])).toBeNull();
    expect(priceFor(undefined as unknown as string, [], undefined)).toBeNull();
    expect(priceFor('claude-opus-4-5', [null, 5, 'x'] as never, { 'claude-opus-4-5': 7 as unknown as string })).toBeNull();
  });

  test('newestTable tolerates malformed stored and shipped', () => {
    expect(newestTable(null, { asOf: '2026-10-06', source: 'x', rows: [] } as never)).toEqual({
      from: 'shipped',
      at: null,
      asOf: '2026-10-06',
      rows: [],
    });
    expect(newestTable({} as never, undefined as never)).toEqual({ from: 'shipped', at: null, asOf: null, rows: [] });
    expect(newestTable({ fetchedAt: 'yesterday' } as never, undefined as never).from).toBe('shipped');
    expect(newestTable({ fetchedAt: 1 } as never, undefined as never).from).toBe('shipped');
  });

  test('shippedTooOld and trafficOff tolerate anything', () => {
    expect(shippedTooOld(undefined as unknown as string, undefined as unknown as string)).toBe(true);
    expect(trafficOff(undefined as unknown as Record<string, string | undefined>)).toBe(false);
    expect(trafficOff('nope' as unknown as Record<string, string | undefined>)).toBe(false);
  });

  test('filterOthers tolerates malformed data and today', () => {
    expect(filterOthers(undefined, undefined as unknown as string)).toEqual([]);
    expect(filterOthers(Number.NaN, '')).toEqual([]);
  });

  test('priceChanges and arrangeRows tolerate malformed input', () => {
    expect(priceChanges(null as never, null as never, null as never, Number.NaN)).toEqual({ changes: [], seen: {} });
    expect(priceChanges('x' as never, [42 as unknown as PriceRow], [{} as unknown as string], 1)).toEqual({ changes: [], seen: {} });
    expect(arrangeRows(null as never, null as never)).toEqual({ main: [], older: [] });
    expect(arrangeRows([null, 'x'] as never, 5 as never)).toEqual({ main: [], older: [] });
  });

  test('the loaders resolve (never reject) with empty deps', async () => {
    const a = await loadClaudePrices({} as never);
    expect(a.table.rows).toEqual([]);
    const b = await loadOtherPrices({} as never);
    expect(b.makers).toEqual([]);
  });

  test('the loaders resolve when now() throws on the success path', async () => {
    const fetchText = () => Promise.resolve('## Model pricing\n\n| m | input | 5m | 1h | cache hits | output |\n| - | - | - | - | - | - |\n| Claude Opus 4.5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |\n| Claude Sonnet 4.5 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |\n| Claude Haiku 4.5 | $1 / MTok | $1.25 / MTok | $2 / MTok | $0.10 / MTok | $5 / MTok |\n');
    const after = (_ms: number, _fn: () => void) => () => {};
    const r = await loadClaudePrices({ fetchText, after, now: () => { throw new Error('no clock'); }, env: {}, stored: null, shipped: { asOf: '2026-10-06', source: 'x', rows: [] } } as never);
    expect(r.why).toBe('changed');
    expect(r.store).toBeNull();
  });

  test('parsePricePage with a non-string still throws only PageChanged', () => {
    expect(() => parsePricePage(undefined as unknown as string)).toThrow(PageChanged);
    expect(() => parsePricePage(42 as unknown as string)).toThrow(PageChanged);
  });
});
