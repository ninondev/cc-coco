import { test, expect, describe } from 'bun:test'
import {
  ownCallsToday,
  initialPayer,
  updatePayer,
  resolveTtl,
  initialCache,
  onMainStep,
  turnBaseline,
  turnCost,
  type Usage,
  type WindowReading,
  type PayerEvent,
  type LimitsReading,
  type Prices,
} from '../../../plugin/hooks/cost/core/index'

const opus: Prices = { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }
const u = (input: number, cacheRead = 0, cacheWrite = 0, output = 0): Usage => ({ input, cacheRead, cacheWrite, output })

describe('rule 7: ownCallsToday', () => {
  const calls = [
    { day: '2026-10-05', usd: 1 },
    { day: '2026-10-06', usd: 2.5 },
    { day: '2026-10-06', usd: 0.5 },
    { day: '2026-10-07', usd: 4 },
  ]

  test('counts and sums only the calls of the day', () => {
    expect(ownCallsToday(calls, '2026-10-06')).toEqual({ count: 2, usd: 3 })
  })

  test('another day only sees its own calls', () => {
    expect(ownCallsToday(calls, '2026-10-05')).toEqual({ count: 1, usd: 1 })
  })

  test('a day without calls gives null', () => {
    expect(ownCallsToday(calls, '2026-10-04')).toBe(null)
  })

  test('an empty list gives null', () => {
    expect(ownCallsToday([], '2026-10-06')).toBe(null)
  })

  test('a zero-dollar call still counts', () => {
    expect(ownCallsToday([{ day: '2026-10-06', usd: 0 }], '2026-10-06')).toEqual({ count: 1, usd: 0 })
  })
})

describe('rules 2–5 together: a small session story', () => {
  const win = (usedPercent: number, resetsAt = 1000000): WindowReading => ({ usedPercent, resetsAt })
  const measure = (limits: LimitsReading | null): PayerEvent => ({ type: 'measure', env: {}, limits, policyPricing: false })

  test('from the first measure to the turn mark', () => {
    let payer = updatePayer(initialPayer(), measure({ fiveHour: win(41) }))
    expect(payer.kind).toBe('plan')

    const r = resolveTtl({ env: {}, kind: payer.kind })
    expect(r).toEqual({ ttl: '1h', source: 'payer' })

    let cache = initialCache()
    cache = onMainStep(cache, { startedAt: 0, usage: u(10000, 50000, 40000, 1000), model: 'claude-opus-5-5' }, { ttl: r.ttl, prices: opus })
    expect(cache.prefix).toBe(100000)
    expect(cache.misses).toBe(0)

    const baseline = turnBaseline({ costUsd: 1.5, limits: { fiveHour: win(41) } })
    const cost = turnCost(
      baseline,
      { costUsd: 1.92, limits: { fiveHour: win(43) } },
      u(10000, 50000, 40000, 1000),
      { prices: opus, ttl: r.ttl },
    )
    expect(cost.usd).toBeCloseTo(0.42, 12)
    expect(cost.window).toEqual({ name: '5h', from: 41, to: 43 })
  })

  test('an unexpected re-read shows up in misses and missUsd', () => {
    let cache = onMainStep(initialCache(), { startedAt: 0, usage: u(10000, 50000, 40000, 0), model: 'claude-opus-5-5' }, { ttl: '5m', prices: opus })
    cache = onMainStep(cache, { startedAt: 1000, usage: u(0, 0, 100000, 0) }, { ttl: '5m', prices: opus })
    expect(cache.misses).toBe(1)
    expect(cache.missUsd).toBeCloseTo(0.5, 12)
  })
})
