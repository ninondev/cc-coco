import { test, expect, describe } from 'bun:test'
import priceRows from './fixtures/prices-2026-10-06.json'
import { priceUsage, rereadDelta, nextMessageCost, INDICATOR_MIN_USD, CLEAR_TIP_USD, type Prices, type Usage } from '../../../plugin/hooks/cost/core/index'

type Row = { id: string; input: number; write5m: number; write1h: number; read: number; output: number }
const rows = priceRows as Row[]
const table = new Map<string, Prices>(rows.map((r) => [r.id, { input: r.input, write5m: r.write5m, write1h: r.write1h, read: r.read, output: r.output }]))
const opus = table.get('claude-opus-5-5')!
const sonnet = table.get('claude-sonnet-5-5')!
const haiku = table.get('claude-haiku-4-5')!

const u = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({ input, cacheRead, cacheWrite, output })

// Prices tuned so rereadDelta hits the indicator/clear-tip thresholds exactly:
// 2.5 and 5 per MTok with read 0 give 0.25 and 0.5 for round prefixes.
const P25: Prices = { input: 0, write5m: 2.5, write1h: 5, read: 0, output: 0 }

describe('rule 1: fixture', () => {
  test('holds the 19 documented rows', () => {
    expect(rows.length).toBe(19)
  })

  test('opus 5.5 row matches the brief', () => {
    expect(opus).toEqual({ input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 })
  })

  test('sonnet 5.5 row matches the brief', () => {
    expect(sonnet).toEqual({ input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 })
  })

  test('haiku 4.5 row matches the brief', () => {
    expect(haiku).toEqual({ input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 })
  })

  test('fable 5.1 row matches the brief', () => {
    expect(table.get('claude-fable-5-1')).toEqual({ input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 })
  })
})

describe('rule 1: priceUsage', () => {
  test('prices every bucket with the 5m write rate', () => {
    expect(priceUsage(u(1000, 2000, 3000, 4000), opus, '5m')).toBeCloseTo(0.0994, 12)
  })

  test('prices every bucket with the 1h write rate', () => {
    expect(priceUsage(u(1000, 2000, 3000, 4000), opus, '1h')).toBeCloseTo(0.1084, 12)
  })

  test('a cache-write-only usage costs write5m per MTok on 5m', () => {
    expect(priceUsage(u(0, 0, 1000000, 0), opus, '5m')).toBeCloseTo(5, 12)
  })

  test('a cache-write-only usage costs write1h per MTok on 1h', () => {
    expect(priceUsage(u(0, 0, 1000000, 0), opus, '1h')).toBeCloseTo(8, 12)
  })

  test('prices each single bucket on sonnet 5.5', () => {
    expect(priceUsage(u(1000000, 0, 0, 0), sonnet, '5m')).toBeCloseTo(2, 12)
    expect(priceUsage(u(0, 1000000, 0, 0), sonnet, '5m')).toBeCloseTo(0.2, 12)
    expect(priceUsage(u(0, 0, 0, 1000000), sonnet, '5m')).toBeCloseTo(10, 12)
  })

  test('zero usage costs zero', () => {
    expect(priceUsage(u(0, 0, 0, 0), opus, '5m')).toBe(0)
    expect(priceUsage(u(0, 0, 0, 0), opus, '1h')).toBe(0)
  })

  test('negative token counts just make the sum negative, no throw', () => {
    expect(priceUsage(u(-1000000, 0, 0, 0), opus, '5m')).toBeCloseTo(-4, 12)
  })
})

describe('rule 1: rereadDelta and nextMessageCost', () => {
  test('worked example: opus 5.5, 120K prefix, 5m', () => {
    expect(rereadDelta(120000, opus, '5m')).toBeCloseTo(0.576, 12)
  })

  test('worked example: opus 5.5, 120K prefix, 1h', () => {
    expect(rereadDelta(120000, opus, '1h')).toBeCloseTo(0.936, 12)
  })

  test('worked example: sonnet 5.5, 120K prefix, 5m', () => {
    expect(rereadDelta(120000, sonnet, '5m')).toBeCloseTo(0.276, 12)
  })

  test('worked example: haiku 4.5, 120K prefix, 5m', () => {
    expect(rereadDelta(120000, haiku, '5m')).toBeCloseTo(0.138, 12)
  })

  test('warm and cold next-message costs, opus 5m', () => {
    expect(nextMessageCost(120000, opus, '5m').warm).toBeCloseTo(0.024, 12)
    expect(nextMessageCost(120000, opus, '5m').cold).toBeCloseTo(0.6, 12)
  })

  test('warm and cold next-message costs, opus 1h', () => {
    expect(nextMessageCost(120000, opus, '1h').warm).toBeCloseTo(0.024, 12)
    expect(nextMessageCost(120000, opus, '1h').cold).toBeCloseTo(0.96, 12)
  })

  test('cold minus warm is exactly the reread delta', () => {
    const n = nextMessageCost(120000, sonnet, '1h')
    expect(n.cold - n.warm).toBeCloseTo(rereadDelta(120000, sonnet, '1h'), 12)
  })

  test('nextMessageCost returns a fresh object with both keys', () => {
    const n = nextMessageCost(1, haiku, '5m')
    expect(Object.keys(n).sort()).toEqual(['cold', 'warm'])
  })

  test('zero prefix costs nothing warm or cold', () => {
    expect(nextMessageCost(0, opus, '5m').warm).toBe(0)
    expect(nextMessageCost(0, opus, '1h').cold).toBe(0)
    expect(rereadDelta(0, opus, '5m')).toBe(0)
  })
})

describe('rule 1: threshold constants', () => {
  test('the documented constants', () => {
    expect(INDICATOR_MIN_USD).toBe(0.25)
    expect(CLEAR_TIP_USD).toBe(0.5)
  })

  test('rereadDelta lands exactly on 0.25 and just under', () => {
    expect(rereadDelta(100000, P25, '5m')).toBe(0.25)
    expect(rereadDelta(99960, P25, '5m')).toBeCloseTo(0.2499, 12)
    expect(rereadDelta(99999, P25, '5m')).toBeLessThan(0.25)
  })

  test('rereadDelta lands exactly on 0.5 and just under', () => {
    expect(rereadDelta(100000, P25, '1h')).toBe(0.5)
    expect(rereadDelta(99999, P25, '1h')).toBeLessThan(0.5)
    expect(rereadDelta(200000, P25, '5m')).toBe(0.5)
  })
})
