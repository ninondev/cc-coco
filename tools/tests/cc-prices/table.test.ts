import { describe, expect, test } from 'bun:test';
import { dayStart, newestTable, shippedTooOld, trafficOff } from '../../../plugin/hooks/cost/prices/index.ts';
import type { PriceRow, ShippedPrices, StoredPrices } from '../../../plugin/hooks/cost/prices/index.ts';
import { DAY, dayMs, expectedRows } from './helpers.ts';

const fixtureRows = expectedRows as PriceRow[];

const shipped = (asOf: string, rows: PriceRow[] = fixtureRows): ShippedPrices => ({ asOf, source: 'test', rows });
const stored = (fetchedAt: number, rows: PriceRow[] = fixtureRows.slice(0, 3)): StoredPrices => ({ fetchedAt, rows });

describe('newestTable', () => {
  test('fresh stored table wins', () => {
    const t = newestTable(stored(dayMs(DAY) + 5000), shipped(DAY));
    expect(t).toEqual({ from: 'fetched', at: dayMs(DAY) + 5000, asOf: null, rows: fixtureRows.slice(0, 3) });
  });

  test('stored fetched exactly at the start of shipped.asOf still wins (>=)', () => {
    const t = newestTable(stored(dayMs(DAY)), shipped(DAY));
    expect(t.from).toBe('fetched');
    expect(t.at).toBe(dayMs(DAY));
    expect(t.asOf).toBeNull();
  });

  test('stored fetched before the shipped day falls back', () => {
    const t = newestTable(stored(dayMs(DAY) - 1), shipped(DAY));
    expect(t).toEqual({ from: 'shipped', at: null, asOf: DAY, rows: fixtureRows });
  });

  test('null stored falls back', () => {
    const t = newestTable(null, shipped(DAY));
    expect(t.from).toBe('shipped');
    expect(t.at).toBeNull();
    expect(t.asOf).toBe(DAY);
    expect(t.rows).toBe(fixtureRows);
  });

  test('non-finite fetchedAt falls back', () => {
    expect(newestTable({ fetchedAt: Number.NaN, rows: fixtureRows }, shipped(DAY)).from).toBe('shipped');
    expect(newestTable({ fetchedAt: Infinity, rows: fixtureRows }, shipped(DAY)).from).toBe('shipped');
  });

  test('empty stored rows fall back', () => {
    expect(newestTable(stored(dayMs(DAY), []), shipped(DAY)).from).toBe('shipped');
  });

  test('invalid shipped.asOf lets stored win even when old', () => {
    const t = newestTable(stored(1000), shipped('not-a-date'));
    expect(t.from).toBe('fetched');
    expect(t.at).toBe(1000);
  });

  test('rows array identity is preserved from the winner', () => {
    const rows = fixtureRows.slice(0, 2);
    expect(newestTable(stored(dayMs(DAY), rows), shipped(DAY)).rows).toBe(rows);
  });
});

describe('shippedTooOld', () => {
  test('exactly 14 days is not too old', () => {
    expect(shippedTooOld('2026-09-22', '2026-10-06')).toBe(false);
  });
  test('15 days is too old', () => {
    expect(shippedTooOld('2026-09-21', '2026-10-06')).toBe(true);
  });
  test('13 days is not too old', () => {
    expect(shippedTooOld('2026-09-23', '2026-10-06')).toBe(false);
  });
  test('a future asOf is never too old', () => {
    expect(shippedTooOld('2026-12-01', '2026-10-06')).toBe(false);
  });
  test('an invalid asOf is too old', () => {
    expect(shippedTooOld('2026-9-22', '2026-10-06')).toBe(true);
    expect(shippedTooOld('', '2026-10-06')).toBe(true);
  });
  test('an invalid today is too old', () => {
    expect(shippedTooOld('2026-09-22', 'yesterday')).toBe(true);
  });
});

describe('dayStart', () => {
  test('a day key starts at its UTC midnight', () => {
    expect(dayStart('2026-10-06')).toBe(Date.UTC(2026, 9, 6));
  });
  test('an invalid key has no start', () => {
    expect(dayStart('2026-10-6')).toBeNull();
    expect(dayStart('20261006')).toBeNull();
    expect(dayStart('2026-10-06T00:00:00Z')).toBeNull();
  });
});

describe('trafficOff', () => {
  const key = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
  test("'1' means off", () => {
    expect(trafficOff({ [key]: '1' })).toBe(true);
  });
  test("'0' means not off", () => {
    expect(trafficOff({ [key]: '0' })).toBe(false);
  });
  test("'false' means not off, case-insensitively", () => {
    expect(trafficOff({ [key]: 'false' })).toBe(false);
    expect(trafficOff({ [key]: 'False' })).toBe(false);
    expect(trafficOff({ [key]: 'FALSE' })).toBe(false);
  });
  test("'0' with different case is still not off", () => {
    expect(trafficOff({ [key]: '0' })).toBe(false);
  });
  test('an empty or whitespace-only value means not off', () => {
    expect(trafficOff({ [key]: '' })).toBe(false);
    expect(trafficOff({ [key]: '   ' })).toBe(false);
  });
  test('a trimmed non-zero word means off', () => {
    expect(trafficOff({ [key]: ' true ' })).toBe(true);
    expect(trafficOff({ [key]: 'yes' })).toBe(true);
    expect(trafficOff({ [key]: '00' })).toBe(true);
  });
  test('a missing value means not off', () => {
    expect(trafficOff({})).toBe(false);
    expect(trafficOff({ OTHER: '1' })).toBe(false);
  });
});
