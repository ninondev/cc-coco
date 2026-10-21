import { describe, expect, test } from 'bun:test';
import { normalizeModelId, priceFor } from '../../../plugin/hooks/cost/prices/index.ts';
import { expectedRows, pricingPage } from './helpers.ts';
import { parsePricePage } from '../../../plugin/hooks/cost/prices/index.ts';

const rows = parsePricePage(pricingPage).rows;

describe('normalizeModelId (every brief example)', () => {
  test("'claude-opus-5-5[1m]' -> 'claude-opus-5-5'", () => {
    expect(normalizeModelId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
  });
  test("'claude-opus-4-1-20250805' -> 'claude-opus-4-1'", () => {
    expect(normalizeModelId('claude-opus-4-1-20250805')).toBe('claude-opus-4-1');
  });
  test("'claude-opus-4-20250514' -> 'claude-opus-4'", () => {
    expect(normalizeModelId('claude-opus-4-20250514')).toBe('claude-opus-4');
  });
  test("'us.anthropic.claude-haiku-4-5-20251001-v1:0' -> 'claude-haiku-4-5'", () => {
    expect(normalizeModelId('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('claude-haiku-4-5');
  });
  test("'anthropic.claude-3-5-haiku-20241022-v1:0' -> 'claude-haiku-3-5' (old order)", () => {
    expect(normalizeModelId('anthropic.claude-3-5-haiku-20241022-v1:0')).toBe('claude-haiku-3-5');
  });
  test("'claude-haiku-4-5@20251001' -> 'claude-haiku-4-5'", () => {
    expect(normalizeModelId('claude-haiku-4-5@20251001')).toBe('claude-haiku-4-5');
  });
  test("'anthropic/claude-opus-4.1' -> 'claude-opus-4-1'", () => {
    expect(normalizeModelId('anthropic/claude-opus-4.1')).toBe('claude-opus-4-1');
  });
  test("'Claude-Sonnet-4-5' -> 'claude-sonnet-4-5'", () => {
    expect(normalizeModelId('Claude-Sonnet-4-5')).toBe('claude-sonnet-4-5');
  });
});

describe('normalizeModelId (more shapes)', () => {
  test('trims surrounding whitespace', () => {
    expect(normalizeModelId('  claude-opus-4-1 ')).toBe('claude-opus-4-1');
  });
  test("strips up to the LAST 'anthropic.' occurrence", () => {
    expect(normalizeModelId('eu.anthropic.foo.anthropic/claude-opus-4')).toBe('claude-opus-4');
  });
  test("a plain 'anthropic' without . or / is not stripped", () => {
    expect(normalizeModelId('anthropic-claude-opus-4')).toBe('anthropic-claude-opus-4');
  });
  test('old two-part order claude-3-opus -> claude-opus-3', () => {
    expect(normalizeModelId('claude-3-opus')).toBe('claude-opus-3');
  });
  test('old three-part order claude-3-5-sonnet -> claude-sonnet-3-5', () => {
    expect(normalizeModelId('claude-3-5-sonnet')).toBe('claude-sonnet-3-5');
  });
  test('new order is not rewritten', () => {
    expect(normalizeModelId('claude-opus-4-1')).toBe('claude-opus-4-1');
  });
  test('-v1:0 and -v2 suffixes drop', () => {
    expect(normalizeModelId('claude-opus-4-5-v1:0')).toBe('claude-opus-4-5');
    expect(normalizeModelId('claude-opus-4-5-v2')).toBe('claude-opus-4-5');
  });
  test('an @8-digit date after a dot still leaves the version', () => {
    expect(normalizeModelId('claude-opus-4.1@20250514')).toBe('claude-opus-4-1');
  });
  test('a dot version inside a bedrock id normalizes', () => {
    expect(normalizeModelId('anthropic.claude-opus-4.1-v1:0')).toBe('claude-opus-4-1');
  });
  test('unknown families pass through untouched', () => {
    expect(normalizeModelId('gpt-4o-mini')).toBe('gpt-4o-mini');
  });
  test('mixed case host ids lower to table ids', () => {
    expect(normalizeModelId('CLAUDE-OPUS-4-5')).toBe('claude-opus-4-5');
  });
});

describe('priceFor', () => {
  test('a dated host id finds its row', () => {
    const r = priceFor('claude-opus-4-1-20250805', rows);
    expect(r?.id).toBe('claude-opus-4-1');
    expect(r?.input).toBe(15);
    expect(r?.status).toBe('retired');
  });

  test('a vertex-style id finds its row', () => {
    expect(priceFor('us.anthropic.claude-haiku-4-5-20251001-v1:0', rows)?.id).toBe('claude-haiku-4-5');
  });

  test('an old-order id finds its row', () => {
    expect(priceFor('anthropic.claude-3-5-haiku-20241022-v1:0', rows)?.id).toBe('claude-haiku-3-5');
  });

  test('an exact table id works directly', () => {
    expect(priceFor('claude-sonnet-5-5', rows)?.name).toBe('Claude Sonnet 5.5');
  });

  test("another maker's model gives null", () => {
    expect(priceFor('gpt-4o', rows)).toBeNull();
    expect(priceFor('claude-opus-2-0', rows)).toBeNull();
  });

  test('aliases remap after normalization', () => {
    const aliases = { 'claude-haiku-4-5': 'claude-haiku-3-5' };
    expect(priceFor('claude-haiku-4-5', rows, aliases)?.id).toBe('claude-haiku-3-5');
    expect(priceFor('claude-haiku-4-5@20251001', rows, aliases)?.id).toBe('claude-haiku-3-5');
  });

  test('an alias key that does not match leaves the id alone', () => {
    const aliases = { 'claude-fable-5': 'claude-fable-5-1' };
    expect(priceFor('claude-haiku-4-5', rows, aliases)?.id).toBe('claude-haiku-4-5');
  });

  test('an empty rows array gives null', () => {
    expect(priceFor('claude-opus-4-5', [])).toBeNull();
  });

  test('rows from the fixture all resolve to themselves', () => {
    for (const r of rows) {
      expect(priceFor(r.id, rows)).toBe(r);
    }
    expect(rows).toHaveLength((expectedRows as unknown[]).length);
  });
});
