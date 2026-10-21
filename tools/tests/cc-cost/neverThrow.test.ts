import { test, expect, describe } from 'bun:test'
import {
  priceUsage,
  rereadDelta,
  nextMessageCost,
  initialPayer,
  updatePayer,
  wordsVariant,
  resolveTtl,
  initialCache,
  onMainStep,
  onForkRead,
  onTtlEvidence,
  onReset,
  warmUntil,
  cacheLook,
  indicatorShown,
  indicatorTimers,
  clearTip,
  turnBaseline,
  turnCost,
  ownCallsToday,
  localDay,
  ledgerAdd,
  ledgerTotals,
  formatUsd,
  formatTokens,
  formatPercent,
  formatMove,
  floorToMinute,
  type Usage,
  type Prices,
  type CacheState,
  type WindowReading,
} from '../../../plugin/hooks/cost/core/index'

const opus: Prices = { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }
const nastyPrices: Prices = { input: NaN, write5m: Infinity, write1h: -Infinity, read: NaN, output: -1 }
const u = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({ input, cacheRead, cacheWrite, output })
const NASTY_USAGE: Usage[] = [
  u(NaN, NaN, NaN, NaN),
  u(Infinity, -Infinity, Infinity, -Infinity),
  u(-1e9, -1e9, -1e9, -1e9),
  u(0, 0, 0, 0),
]
const TTLS = ['5m', '1h'] as const
const cache: CacheState = { sentAt: NaN, prefix: NaN, model: null, observed: true, evidence: null, misses: 0, missUsd: 0 }

describe('rule 11: pricing never throws', () => {
  test('priceUsage on every nasty usage and price', () => {
    for (const usage of NASTY_USAGE) {
      for (const p of [opus, nastyPrices]) {
        for (const ttl of TTLS) {
          expect(() => priceUsage(usage, p, ttl)).not.toThrow()
          expect(typeof priceUsage(usage, p, ttl)).toBe('number')
        }
      }
    }
  })

  test('rereadDelta and nextMessageCost on nasty prefixes', () => {
    for (const prefix of [NaN, Infinity, -Infinity, -1, 0, 1e18]) {
      for (const ttl of TTLS) {
        expect(() => rereadDelta(prefix, opus, ttl)).not.toThrow()
        expect(() => nextMessageCost(prefix, nastyPrices, ttl)).not.toThrow()
      }
    }
  })
})

describe('rule 11: payer never throws', () => {
  test('updatePayer on odd env, limits and events', () => {
    const events = [
      { type: 'measure', env: { CLAUDE_CODE_USE_BEDROCK: undefined, CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_ANTHROPIC_AWS: ' ' }, limits: { fiveHour: { usedPercent: NaN, resetsAt: Infinity } }, policyPricing: false },
      { type: 'measure', env: {}, limits: { spendLimit: [], sevenDay: { usedPercent: -Infinity, resetsAt: NaN } }, policyPricing: true },
      { type: 'measure', env: {}, limits: null, policyPricing: false },
      { type: 'response', main: true, hasUsage: false, modelPriced: false },
      { type: 'response', main: false, hasUsage: true, modelPriced: true },
    ] as const
    let s = initialPayer()
    for (const e of events) {
      expect(() => updatePayer(s, e)).not.toThrow()
      s = updatePayer(s, e)
    }
    expect(s).toBeDefined()
  })

  test('wordsVariant on every kind and odd strings', () => {
    for (const k of ['plan', 'credits', 'api', 'cloud', 'gateway', 'unknown', '', 'nonsense'] as never[]) {
      expect(() => wordsVariant(k)).not.toThrow()
    }
  })
})

describe('rule 11: ttl and cache never throw', () => {
  test('resolveTtl on odd inputs', () => {
    expect(() => resolveTtl({ env: undefined as never, settingsTtl: Symbol('x'), kind: 'unknown' })).not.toThrow()
    expect(() => resolveTtl({ env: {}, settingsTtl: { ttl: '5m' }, kind: 'plan', evidence: 'maybe' as never })).not.toThrow()
  })

  test('the cache reducers on nasty usage, times and contexts', () => {
    let s = initialCache()
    const steps = [
      { startedAt: NaN, usage: u(NaN, NaN, NaN, NaN) },
      { startedAt: -Infinity, usage: u(Infinity, -Infinity, Infinity, 0), model: '' },
      { startedAt: 1e18, usage: u(0, 0, 0, 0) },
    ]
    for (const step of steps) {
      for (const ctx of [{ ttl: '5m', prices: null }, { ttl: '1h', prices: nastyPrices }] as const) {
        expect(() => onMainStep(s, step, ctx)).not.toThrow()
      }
      s = onMainStep(s, step, { ttl: '5m', prices: null })
    }
    expect(() => onForkRead(s, { startedAt: NaN, cacheRead: NaN })).not.toThrow()
    expect(() => onTtlEvidence(s, undefined)).not.toThrow()
    expect(() => onReset(s)).not.toThrow()
  })

  test('the look helpers on nasty states and clocks', () => {
    for (const now of [NaN, Infinity, -Infinity, -1, 0, 1e18]) {
      expect(() => warmUntil(cache, '5m')).not.toThrow()
      expect(() => cacheLook(cache, '1h', now, { turnRunning: false, keptWarm: false })).not.toThrow()
      expect(() => indicatorShown(cache, nastyPrices, '5m')).not.toThrow()
      expect(() => indicatorTimers(cache, '1h', true)).not.toThrow()
      expect(() => clearTip(cache, opus, '5m', now)).not.toThrow()
    }
  })
})

describe('rule 11: turns never throw', () => {
  test('turnBaseline on non-finite and odd readings', () => {
    for (const r of [
      { costUsd: null, limits: null },
      { costUsd: NaN, limits: { fiveHour: { usedPercent: NaN, resetsAt: NaN } } },
      { costUsd: 'x' as never, limits: { sevenDay: {} as WindowReading } },
    ]) {
      expect(() => turnBaseline(r)).not.toThrow()
    }
  })

  test('turnCost with everything missing or nasty', () => {
    const b = turnBaseline({ costUsd: NaN, limits: null })
    expect(() => turnCost(b, { costUsd: Infinity, limits: null }, u(NaN, NaN, NaN, NaN), { prices: null, ttl: '5m' })).not.toThrow()
    expect(() => turnCost(b, { costUsd: 1, limits: null }, u(-1, -2, -3, -4), { prices: nastyPrices, ttl: '1h' })).not.toThrow()
  })
})

describe('rule 11: sessions and days never throw', () => {
  test('ownCallsToday on empty and nasty input', () => {
    expect(() => ownCallsToday([], 'x')).not.toThrow()
    expect(() => ownCallsToday([{ day: 'x', usd: NaN }, { day: 'x', usd: Infinity }], 'x')).not.toThrow()
  })

  test('localDay on NaN and a broken time zone', () => {
    expect(() => localDay(NaN)).not.toThrow()
    expect(() => localDay(0, 'Not/AZone')).not.toThrow()
    expect(typeof localDay(NaN)).toBe('string')
  })

  test('ledgerAdd and ledgerTotals on odd input', () => {
    expect(() => ledgerAdd({}, 'garbage', NaN, 'garbage')).not.toThrow()
    expect(() => ledgerAdd({ weird: NaN, '2026-10-06': Infinity }, '', -1, '2026-10-06')).not.toThrow()
    expect(() => ledgerTotals([], 'garbage')).not.toThrow()
    expect(() => ledgerTotals([{ '2026-10-06': NaN, bad: 1 }], '2026-10-06', NaN)).not.toThrow()
    expect(() => ledgerTotals(undefined as never, '2026-10-06')).not.toThrow()
  })
})

describe('rule 11: formats never throw', () => {
  test('every format on missing and non-finite values', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity, -0, 1e308]) {
      expect(() => formatUsd(v, 'en', { estimate: true })).not.toThrow()
      expect(() => formatTokens(v, 'zh-CN')).not.toThrow()
      expect(() => formatPercent(v, 'ja')).not.toThrow()
    }
    expect(() => formatMove(NaN, Infinity, 'de')).not.toThrow()
    expect(() => floorToMinute(NaN)).not.toThrow()
    expect(() => floorToMinute(Infinity)).not.toThrow()
  })

  test('every format survives a language tag Intl rejects', () => {
    expect(() => formatUsd(0.42, 'definitely not a tag!', { estimate: true })).not.toThrow()
    expect(() => formatTokens(128400, 'definitely not a tag!')).not.toThrow()
    expect(() => formatPercent(43, 'definitely not a tag!')).not.toThrow()
    expect(() => formatMove(41, 43, 'definitely not a tag!')).not.toThrow()
  })
})
