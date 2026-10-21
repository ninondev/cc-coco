import { describe, expect, test } from 'bun:test';
import {
  FETCH_LIMIT_MS,
  OTHERS_URL,
  PRICE_PAGE_URL,
  loadClaudePrices,
  loadOtherPrices,
  newestTable,
  parsePricePage,
} from '../../../plugin/hooks/cost/prices/index.ts';
import type { OtherMaker, PriceRow, ShippedPrices } from '../../../plugin/hooks/cost/prices/index.ts';
import { DAY, NOW, dayMs, expectedOthers, expectedRows, fakeDeps, miniPage, othersList, pricingPage, trio } from './helpers.ts';

const shippedRows = expectedRows as PriceRow[];
const shippedTable: ShippedPrices = { asOf: DAY, source: 'test', rows: shippedRows };
const parsed = parsePricePage(pricingPage).rows;

describe('loadClaudePrices', () => {
  test('traffic off never calls fetchText and returns why off', async () => {
    const f = fakeDeps({ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, shipped: shippedTable });
    const r = await loadClaudePrices(f.d as never);
    expect(f.calls).toEqual([]);
    expect(f.timers).toHaveLength(0);
    expect(r.why).toBe('off');
    expect(r.store).toBeNull();
    expect(r.table).toEqual(newestTable(null, shippedTable));
  });

  test('a policy refusal never calls fetchText and returns why off', async () => {
    const f = fakeDeps({ policyRefuses: true, shipped: shippedTable });
    const r = await loadClaudePrices(f.d as never);
    expect(f.calls).toEqual([]);
    expect(r.why).toBe('off');
    expect(r.store).toBeNull();
    expect(r.table.from).toBe('shipped');
    expect(r.table.asOf).toBe(DAY);
  });

  test('success: fetch called once with PRICE_PAGE_URL, one timer armed and cancelled', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    expect(f.calls).toEqual([PRICE_PAGE_URL]);
    expect(f.timers).toHaveLength(1);
    expect(f.timers[0].ms).toBe(FETCH_LIMIT_MS);
    expect(typeof f.timers[0].fn).toBe('function');
    f.fetch.resolve(pricingPage);
    const r = await p;
    expect(f.timers[0].cancelled).toBe(true);
    expect(r.why).toBeNull();
    expect(r.store).toEqual({ fetchedAt: NOW, rows: parsed });
    expect(r.table).toEqual({ from: 'fetched', at: NOW, asOf: null, rows: parsed });
  });

  test('success on a small fresh page stores now()', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    f.fetch.resolve(miniPage(...trio()));
    const r = await p;
    expect(r.why).toBeNull();
    expect(r.store?.fetchedAt).toBe(NOW);
    expect(r.store?.rows).toHaveLength(3);
    expect(r.table.rows).toBe(r.store?.rows);
  });

  test('timeout gives offline and a late answer is ignored', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.store).toBeNull();
    expect(r.table).toEqual({ from: 'shipped', at: null, asOf: DAY, rows: shippedRows });
    // the late answer must not change anything
    f.fetch.resolve(pricingPage);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.why).toBe('offline');
    expect(f.timers[0].cancelled).toBe(false);
  });

  test('a rejection gives offline and cancels the timer', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    f.fetch.reject(new Error('network down'));
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.store).toBeNull();
    expect(f.timers[0].cancelled).toBe(true);
    expect(r.table.from).toBe('shipped');
  });

  test('a changed page gives changed with the fallback table', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    f.fetch.resolve('# Something else entirely');
    const r = await p;
    expect(r.why).toBe('changed');
    expect(r.store).toBeNull();
    expect(r.table).toEqual(newestTable(null, shippedTable));
    expect(f.timers[0].cancelled).toBe(true);
  });

  test('offline with a fresh stored table serves the stored rows', async () => {
    const storedNow = dayMs(DAY) + 60_000;
    const stored = { fetchedAt: storedNow, rows: parsed.slice(0, 4) };
    const f = fakeDeps({ shipped: shippedTable, stored });
    const p = loadClaudePrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.table).toEqual({ from: 'fetched', at: storedNow, asOf: null, rows: stored.rows });
    expect(r.store).toBeNull();
  });

  test('changed with a stale stored table serves the shipped rows', async () => {
    const stale = { fetchedAt: dayMs(DAY) - 1000, rows: parsed.slice(0, 4) };
    const f = fakeDeps({ shipped: shippedTable, stored: stale });
    const p = loadClaudePrices(f.d as never);
    f.fetch.resolve('## Model pricing\n\nno table');
    const r = await p;
    expect(r.why).toBe('changed');
    expect(r.table).toEqual({ from: 'shipped', at: null, asOf: DAY, rows: shippedRows });
  });

  test('a fetchText that throws synchronously still resolves offline', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const boom = {
      ...f.d,
      fetchText: (_url: string) => {
        throw new Error('sync boom');
      },
    };
    const r = await loadClaudePrices(boom as never);
    expect(r.why).toBe('offline');
    expect(f.timers).toHaveLength(1);
  });

  test('an empty deps object never rejects', async () => {
    const r = await loadClaudePrices({} as never);
    expect(['offline', 'changed', 'off']).toContain(r.why);
    expect(r.store).toBeNull();
  });

  test('a rejection with a non-Error reason never rejects', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadClaudePrices(f.d as never);
    f.fetch.reject('just a string');
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.store).toBeNull();
  });
});

const otherMakers: OtherMaker[] = [
  { maker: 'xai', label: 'xAI', models: [{ name: 'grok-4', input: 2, read: 0.5, output: 6 }] },
];
// Made three hours before the press: the list's own time is what is kept and shown.
const MADE = NOW - 3 * 3600000;
const othersJson = othersList(otherMakers, new Date(MADE).toISOString());

describe('loadOtherPrices', () => {
  test('success fetches OTHERS_URL once and stores the time the list was made', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    expect(f.calls).toEqual([OTHERS_URL]);
    expect(f.timers).toHaveLength(1);
    expect(f.timers[0].ms).toBe(FETCH_LIMIT_MS);
    f.fetch.resolve(othersJson);
    const r = await p;
    expect(f.timers[0].cancelled).toBe(true);
    expect(r.why).toBeNull();
    expect(r.from).toBe('fetched');
    expect(r.at).toBe(MADE);
    expect(r.makers).toEqual(otherMakers);
    expect(r.store).toEqual({ fetchedAt: MADE, makers: otherMakers });
  });

  test('the whole 10-06 snapshot reads back as a list', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve(othersList());
    const r = await p;
    expect(r.why).toBeNull();
    expect(r.makers).toEqual(expectedOthers);
  });

  test("a list older than the shipped table gives the shipped one, with no complaint", async () => {
    const shippedWithOthers = { ...shippedTable, others: otherMakers };
    const f = fakeDeps({ shipped: shippedWithOthers });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve(othersList(otherMakers, new Date(dayMs(DAY) - 1).toISOString()));
    const r = await p;
    expect(r.why).toBeNull();
    expect(r.from).toBe('shipped');
    expect(r.at).toBeNull();
    expect(r.store).toBeNull();
    expect(r.makers).toBe(shippedWithOthers.others);
  });

  test("labels come from Coco's own table, never the file", async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve(othersList([{ maker: 'xai', label: 'Click here', models: otherMakers[0]!.models }]));
    const r = await p;
    expect(r.makers[0]!.label).toBe('xAI');
  });

  const refused: [string, string][] = [
    ['another version', othersList(otherMakers, undefined, { version: 2 })],
    ['a time more than a day ahead', othersList(otherMakers, new Date(NOW + 86400000 + 1).toISOString())],
    ['no time', othersList(otherMakers, 'soon')],
    ['an unknown maker', othersList([{ maker: 'acme', label: 'Acme', models: otherMakers[0]!.models }])],
    ['a maker twice', othersList([otherMakers[0], otherMakers[0]])],
    ['no makers', othersList([])],
    ['seven models for one maker', othersList([{ maker: 'xai', label: 'xAI', models: Array.from({ length: 7 }, (_, i) => ({ name: `grok-${i}`, input: 1, read: null, output: 2 })) }])],
    ['a name with a control character', othersList([{ maker: 'xai', label: 'xAI', models: [{ name: 'grok\u202e4', input: 1, read: null, output: 2 }] }])],
    ['a name with a slash', othersList([{ maker: 'xai', label: 'xAI', models: [{ name: 'xai/grok-4', input: 1, read: null, output: 2 }] }])],
    ['a negative price', othersList([{ maker: 'xai', label: 'xAI', models: [{ name: 'grok-4', input: -1, read: null, output: 2 }] }])],
    ['an absurd price', othersList([{ maker: 'xai', label: 'xAI', models: [{ name: 'grok-4', input: 1e6, read: null, output: 2 }] }])],
    ['a missing read', othersList([{ maker: 'xai', label: 'xAI', models: [{ name: 'grok-4', input: 1, output: 2 }] }])],
    ["LiteLLM's own table", JSON.stringify({ 'xai/grok-4': { litellm_provider: 'xai', mode: 'chat', input_cost_per_token: 2e-6, output_cost_per_token: 6e-6 } })],
  ];
  for (const [what, text] of refused) test(`a list with ${what} is refused whole: changed, shipped fallback`, async () => {
    const shippedWithOthers = { ...shippedTable, others: otherMakers };
    const f = fakeDeps({ shipped: shippedWithOthers });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve(text);
    const r = await p;
    expect(r.why).toBe('changed');
    expect(r.store).toBeNull();
    expect(r.from).toBe('shipped');
  });

  test('bad JSON gives changed with the shipped fallback', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve('{not json');
    const r = await p;
    expect(r.why).toBe('changed');
    expect(r.store).toBeNull();
    expect(r.from).toBe('shipped');
    expect(r.at).toBeNull();
    expect(r.makers).toEqual(shippedTable.others ?? []);
  });

  test('an empty object gives changed', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.fetch.resolve('{}');
    const r = await p;
    expect(r.why).toBe('changed');
    expect(r.store).toBeNull();
  });

  test('timeout gives offline with the stored makers when fresh', async () => {
    const stored = { fetchedAt: dayMs(DAY) + 1, makers: otherMakers };
    const f = fakeDeps({ shipped: shippedTable, stored });
    const p = loadOtherPrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.from).toBe('fetched');
    expect(r.at).toBe(stored.fetchedAt);
    expect(r.makers).toBe(otherMakers);
    expect(r.store).toBeNull();
  });

  test('timeout with stale stored falls back to shipped.others', async () => {
    const stored = { fetchedAt: dayMs(DAY) - 1, makers: otherMakers };
    const shippedWithOthers = { ...shippedTable, others: otherMakers };
    const f = fakeDeps({ shipped: shippedWithOthers, stored });
    const p = loadOtherPrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.from).toBe('shipped');
    expect(r.at).toBeNull();
    expect(r.makers).toBe(shippedWithOthers.others);
  });

  test('timeout with no stored and no shipped.others gives []', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.from).toBe('shipped');
    expect(r.makers).toEqual([]);
  });

  test('rejection gives offline and cancels the timer', async () => {
    const f = fakeDeps({ shipped: shippedTable });
    const p = loadOtherPrices(f.d as never);
    f.fetch.reject(new Error('no network'));
    const r = await p;
    expect(r.why).toBe('offline');
    expect(f.timers[0].cancelled).toBe(true);
  });

  test('traffic off never fetches and returns why off with the fallback', async () => {
    const shippedWithOthers = { ...shippedTable, others: otherMakers };
    const f = fakeDeps({ env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true' }, shipped: shippedWithOthers });
    const r = await loadOtherPrices(f.d as never);
    expect(f.calls).toEqual([]);
    expect(r.why).toBe('off');
    expect(r.store).toBeNull();
    expect(r.from).toBe('shipped');
    expect(r.makers).toBe(otherMakers);
  });

  test('empty stored makers fall back to shipped even when fetchedAt is fresh', async () => {
    const stored = { fetchedAt: dayMs(DAY) + 1, makers: [] as OtherMaker[] };
    const f = fakeDeps({ shipped: shippedTable, stored });
    const p = loadOtherPrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.why).toBe('offline');
    expect(r.from).toBe('shipped');
  });

  test('invalid shipped.asOf keeps a fresh stored list usable', async () => {
    const stored = { fetchedAt: 1000, makers: otherMakers };
    const f = fakeDeps({ shipped: { ...shippedTable, asOf: 'whenever' }, stored });
    const p = loadOtherPrices(f.d as never);
    f.timers[0].fn();
    const r = await p;
    expect(r.from).toBe('fetched');
    expect(r.at).toBe(1000);
  });

  test('an empty deps object never rejects', async () => {
    const r = await loadOtherPrices({} as never);
    expect(r.makers).toEqual([]);
    expect(r.why).toBe('offline');
  });
});
