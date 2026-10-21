import { describe, expect, test } from 'bun:test';
import { arrangeRows, parsePricePage, priceChanges } from '../../../plugin/hooks/cost/prices/index.ts';
import type { PriceRow, SeenPrice } from '../../../plugin/hooks/cost/prices/index.ts';
import { pricingPage } from './helpers.ts';

const rows = parsePricePage(pricingPage).rows;

// read is rounded to the table's six decimals: 3 * 0.1 is 0.30000000000000004,
// which would count as a changed field against the fixture's parsed 0.3.
const seenEntry = (input: number, at = 1000): SeenPrice => ({ input, write5m: input * 1.25, write1h: input * 2, read: Number((input * 0.1).toFixed(6)), output: input * 5, at });

describe('priceChanges', () => {
  test('one change per differing field in the order input, write5m, write1h, read, output', () => {
    const seen: Record<string, SeenPrice> = { 'claude-opus-4-5': seenEntry(5) };
    // new row: input 5 -> 5 same? build a row differing in input, write1h and read only
    const r: PriceRow = { ...rows.find((x) => x.id === 'claude-opus-4-5')!, input: 6, write5m: 6.25, write1h: 11, read: 0.7, output: 25 };
    const { changes } = priceChanges(seen, [r], ['claude-opus-4-5'], 9999);
    expect(changes).toEqual([
      { id: 'claude-opus-4-5', name: r.name, field: 'input', old: 5, new: 6, since: 9999 },
      { id: 'claude-opus-4-5', name: r.name, field: 'write1h', old: 10, new: 11, since: 9999 },
      { id: 'claude-opus-4-5', name: r.name, field: 'read', old: 0.5, new: 0.7, since: 9999 },
    ]);
  });

  test('a model not in usedIds produces no changes even when prices differ', () => {
    const seen: Record<string, SeenPrice> = { 'claude-opus-4-5': seenEntry(5) };
    const r: PriceRow = { ...rows.find((x) => x.id === 'claude-opus-4-5')!, input: 9 };
    const { changes, seen: seen2 } = priceChanges(seen, [r], [], 9999);
    expect(changes).toEqual([]);
    expect(seen2['claude-opus-4-5'].input).toBe(9);
    expect(seen2['claude-opus-4-5'].at).toBe(9999);
  });

  test('no differences means no changes and at is kept', () => {
    const seen: Record<string, SeenPrice> = { 'claude-haiku-4-5': seenEntry(1, 4242) };
    const r = rows.find((x) => x.id === 'claude-haiku-4-5')!;
    const { changes, seen: seen2 } = priceChanges(seen, [r], ['claude-haiku-4-5'], 9999);
    expect(changes).toEqual([]);
    expect(seen2['claude-haiku-4-5'].at).toBe(4242);
    expect(seen2['claude-haiku-4-5'].input).toBe(1);
  });

  test('a row with no previous entry is recorded with at = now and no change', () => {
    const r = rows.find((x) => x.id === 'claude-fable-5-1')!;
    const { changes, seen: seen2 } = priceChanges({}, [r], ['claude-fable-5-1'], 777);
    expect(changes).toEqual([]);
    expect(seen2['claude-fable-5-1']).toEqual({ input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50, at: 777 });
  });

  test('previous entries for absent rows are carried over', () => {
    const seen: Record<string, SeenPrice> = { 'gpt-old': seenEntry(3, 55) };
    const r = rows.find((x) => x.id === 'claude-haiku-4-5')!;
    const { seen: seen2 } = priceChanges(seen, [r], [], 9999);
    expect(seen2['gpt-old']).toEqual(seenEntry(3, 55));
  });

  test('changes are emitted in row order', () => {
    const seen: Record<string, SeenPrice> = {
      'claude-opus-4-5': seenEntry(5),
      'claude-sonnet-4-5': seenEntry(3),
    };
    const opus = { ...rows.find((x) => x.id === 'claude-opus-4-5')!, input: 8 };
    const sonnet = { ...rows.find((x) => x.id === 'claude-sonnet-4-5')!, output: 16 };
    const { changes } = priceChanges(seen, [opus, sonnet], ['claude-opus-4-5', 'claude-sonnet-4-5'], 1);
    expect(changes.map((c) => c.id)).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5']);
    expect(changes.map((c) => c.field)).toEqual(['input', 'output']);
  });

  test('the inputs are never mutated', () => {
    const seen: Record<string, SeenPrice> = { 'claude-opus-4-5': seenEntry(5) };
    const seenFrozen = JSON.parse(JSON.stringify(seen));
    const r = rows.find((x) => x.id === 'claude-opus-4-5')!;
    const rowsFrozen = [JSON.parse(JSON.stringify(r))];
    priceChanges(seen, [r], ['claude-opus-4-5'], 9999);
    expect(seen).toEqual(seenFrozen);
    expect([r]).toEqual(rowsFrozen);
  });

  test('the returned seen is a new object', () => {
    const seen: Record<string, SeenPrice> = {};
    const { seen: seen2 } = priceChanges(seen, [], [], 1);
    expect(seen2).not.toBe(seen);
  });
});

describe('arrangeRows', () => {
  test('with no chat model the four newest current families are main', () => {
    const { main, older } = arrangeRows(rows, {});
    expect(main.map((r) => r.id)).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
    expect(older).toHaveLength(15);
    expect(main.every((r) => r.thisChat === false)).toBe(true);
  });

  test('both lists keep page order and together hold all 19 rows once', () => {
    const { main, older } = arrangeRows(rows, {});
    const all = rows.map((r) => r.id);
    const mainIds = main.map((r) => r.id);
    const olderIds = older.map((r) => r.id);
    expect(new Set([...mainIds, ...olderIds]).size).toBe(19);
    expect(mainIds.length + olderIds.length).toBe(19);
    for (const id of [...mainIds, ...olderIds]) expect(all).toContain(id);
    const positions = (ids: string[]): number[] => ids.map((id) => all.indexOf(id));
    const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
    expect(sorted(positions(mainIds))).toEqual(positions(mainIds));
    expect(sorted(positions(olderIds))).toEqual(positions(olderIds));
  });

  test('the chat model lands in main with thisChat true, even when retired', () => {
    // in the fixture the retired sonnet is Claude Sonnet 4; 4.5 is current
    const { main } = arrangeRows(rows, { chatModel: 'claude-sonnet-4-20250514' });
    const chat = main.find((r) => r.id === 'claude-sonnet-4');
    expect(chat?.thisChat).toBe(true);
    expect(chat?.status).toBe('retired');
    expect(main.filter((r) => r.thisChat).length).toBe(1);
    expect(main.map((r) => r.id)).toContain('claude-sonnet-5-5');
  });

  test('limited rows only reach main via chat or usedRecently', () => {
    const base = arrangeRows(rows, {});
    expect(base.main.map((r) => r.id)).not.toContain('claude-mythos-5-1');
    const withUsed = arrangeRows(rows, { usedRecently: ['claude-mythos-5-1'] });
    expect(withUsed.main.map((r) => r.id)).toContain('claude-mythos-5-1');
    const withChat = arrangeRows(rows, { chatModel: 'claude-mythos-5-1[1m]' });
    expect(withChat.main.map((r) => r.id)).toContain('claude-mythos-5-1');
  });

  test('usedRecently entries normalize to table ids', () => {
    const { main } = arrangeRows(rows, { usedRecently: ['anthropic.claude-3-5-haiku-20241022-v1:0', 'claude-opus-4'] });
    expect(main.map((r) => r.id)).toContain('claude-haiku-3-5');
    expect(main.map((r) => r.id)).toContain('claude-opus-4');
  });

  test('only the first current row of a family is main', () => {
    const { main } = arrangeRows(rows, {});
    expect(main.map((r) => r.id)).not.toContain('claude-fable-5');
    expect(main.map((r) => r.id)).not.toContain('claude-opus-5');
  });

  test('main rows are copies; older rows are the given objects', () => {
    const { main, older } = arrangeRows(rows, {});
    const fable = rows[0];
    const mythos = rows[1];
    expect(main[0]).not.toBe(fable);
    expect(main[0]).toEqual({ ...fable, thisChat: false });
    expect(older[0]).toBe(mythos);
  });

  test('an empty rows list gives two empty lists', () => {
    expect(arrangeRows([], {})).toEqual({ main: [], older: [] });
  });

  test('a chat model with no row changes nothing', () => {
    const a = arrangeRows(rows, {});
    const b = arrangeRows(rows, { chatModel: 'gpt-4o' });
    expect(b.main.map((r) => r.id)).toEqual(a.main.map((r) => r.id));
  });
});
