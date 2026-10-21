import { test, expect, describe } from 'bun:test'
import { turnBaseline, turnCost, type Usage, type WindowReading } from '../../../plugin/hooks/cost/core/index'

const win = (usedPercent: number, resetsAt = 1000000): WindowReading => ({ usedPercent, resetsAt })
const u = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({ input, cacheRead, cacheWrite, output })
const opus = { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 }

describe('rule 5: turnBaseline', () => {
  test('c0 is the ledger reading when it is a finite number', () => {
    expect(turnBaseline({ costUsd: 1.5, limits: null }).c0).toBe(1.5)
    expect(turnBaseline({ costUsd: 0, limits: null }).c0).toBe(0)
    expect(turnBaseline({ costUsd: -2, limits: null }).c0).toBe(-2)
  })

  test('c0 is null for anything else', () => {
    expect(turnBaseline({ costUsd: null, limits: null }).c0).toBe(null)
    expect(turnBaseline({ costUsd: NaN, limits: null }).c0).toBe(null)
    expect(turnBaseline({ costUsd: Infinity, limits: null }).c0).toBe(null)
    expect(turnBaseline({ costUsd: -Infinity, limits: null }).c0).toBe(null)
    expect(turnBaseline({ costUsd: '3' as unknown as number, limits: null }).c0).toBe(null)
  })

  test('the fiveHour window is chosen when present', () => {
    const b = turnBaseline({ costUsd: 1, limits: { fiveHour: win(55, 9), sevenDay: win(30, 10) } })
    expect(b.window).toEqual({ name: '5h', percent: 55, resetsAt: 9 })
  })

  test('the sevenDay window is chosen only without a fiveHour one', () => {
    const b = turnBaseline({ costUsd: 1, limits: { sevenDay: win(30, 10) } })
    expect(b.window).toEqual({ name: '7d', percent: 30, resetsAt: 10 })
  })

  test('no window at all gives null', () => {
    expect(turnBaseline({ costUsd: 1, limits: null }).window).toBe(null)
    expect(turnBaseline({ costUsd: 1, limits: {} }).window).toBe(null)
    expect(turnBaseline({ costUsd: 1, limits: { spendLimit: {} } }).window).toBe(null)
    expect(turnBaseline({ costUsd: 1, limits: { fiveHour: null, sevenDay: null } }).window).toBe(null)
  })

  test('a fractional percent passes through', () => {
    expect(turnBaseline({ costUsd: 1, limits: { fiveHour: win(41.4, 77) } }).window).toEqual({ name: '5h', percent: 41.4, resetsAt: 77 })
  })
})

describe('rule 5: turnCost — the ledger difference', () => {
  const b = turnBaseline({ costUsd: 1.5, limits: { fiveHour: win(41, 2000000) } })

  test('a positive difference is the turn cost, not an estimate', () => {
    const c = turnCost(b, { costUsd: 1.92, limits: { fiveHour: win(43, 2000000) } }, u(0, 0, 0, 0), { prices: opus, ttl: '5m' })
    expect(c.usd).toBeCloseTo(0.42, 12)
    expect(c.estimated).toBe(false)
  })

  test('an equal reading costs zero', () => {
    const c = turnCost(b, { costUsd: 1.5, limits: null }, u(0, 0, 0, 0), { prices: opus, ttl: '5m' })
    expect(c.usd).toBe(0)
    expect(c.estimated).toBe(false)
  })

  test('a negative difference gives usd null, never an estimate', () => {
    const c = turnCost(b, { costUsd: 1.0, limits: null }, u(1000, 2000, 3000, 4000), { prices: opus, ttl: '5m' })
    expect(c.usd).toBe(null)
    expect(c.estimated).toBe(false)
  })

  test('a missing start reading falls back to the estimate', () => {
    const b0 = turnBaseline({ costUsd: null, limits: null })
    const c = turnCost(b0, { costUsd: 2, limits: null }, u(1000, 2000, 3000, 4000), { prices: opus, ttl: '5m' })
    expect(c.usd).toBeCloseTo(0.0994, 12)
    expect(c.estimated).toBe(true)
  })

  test('a missing end reading falls back to the estimate', () => {
    const c = turnCost(b, { costUsd: null, limits: null }, u(1000, 2000, 3000, 4000), { prices: opus, ttl: '5m' })
    expect(c.usd).toBeCloseTo(0.0994, 12)
    expect(c.estimated).toBe(true)
  })

  test('a non-finite reading counts as missing', () => {
    const c = turnCost(b, { costUsd: NaN, limits: null }, u(1000, 2000, 3000, 4000), { prices: opus, ttl: '5m' })
    expect(c.estimated).toBe(true)
  })

  test('no prices and a missing reading give usd null', () => {
    const c = turnCost(b, { costUsd: null, limits: null }, u(1000, 2000, 3000, 4000), { prices: null, ttl: '5m' })
    expect(c.usd).toBe(null)
    expect(c.estimated).toBe(false)
  })

  test('tokens are returned as given', () => {
    const tokens = u(1, 2, 3, 4)
    const c = turnCost(b, { costUsd: 2, limits: null }, tokens, { prices: opus, ttl: '5m' })
    expect(c.tokens).toBe(tokens)
    expect(c.tokens).toEqual(u(1, 2, 3, 4))
  })

  test('the estimate uses the write rate of its ttl', () => {
    const c5 = turnCost(b, { costUsd: null, limits: null }, u(0, 0, 1000000, 0), { prices: opus, ttl: '5m' })
    const c1 = turnCost(b, { costUsd: null, limits: null }, u(0, 0, 1000000, 0), { prices: opus, ttl: '1h' })
    expect(c5.usd).toBeCloseTo(5, 12)
    expect(c1.usd).toBeCloseTo(8, 12)
  })
})

describe('rule 5: turnCost — the window move', () => {
  const b = turnBaseline({ costUsd: 1.5, limits: { fiveHour: win(41, 2000000) } })

  test('the same window with the same resetsAt moves from baseline to end', () => {
    const c = turnCost(b, { costUsd: 2, limits: { fiveHour: win(43.4, 2000000) } }, u(0, 0, 0, 0), { prices: null, ttl: '5m' })
    expect(c.window).toEqual({ name: '5h', from: 41, to: 43.4 })
  })

  test('a different resetsAt means the window reset and no move is shown', () => {
    const c = turnCost(b, { costUsd: 2, limits: { fiveHour: win(43, 3000000) } }, u(0, 0, 0, 0), { prices: null, ttl: '5m' })
    expect(c.window).toBe(null)
  })

  test('a different window name means no move', () => {
    const c = turnCost(b, { costUsd: 2, limits: { sevenDay: win(43, 2000000) } }, u(0, 0, 0, 0), { prices: null, ttl: '5m' })
    expect(c.window).toBe(null)
  })

  test('a window missing on either side means no move', () => {
    expect(turnCost(b, { costUsd: 2, limits: null }, u(0, 0, 0, 0), { prices: null, ttl: '5m' }).window).toBe(null)
    const bNone = turnBaseline({ costUsd: 1.5, limits: null })
    expect(turnCost(bNone, { costUsd: 2, limits: { fiveHour: win(43, 2000000) } }, u(0, 0, 0, 0), { prices: null, ttl: '5m' }).window).toBe(null)
  })

  test('the move is shown even when the cost is an estimate', () => {
    const b0 = turnBaseline({ costUsd: null, limits: { sevenDay: win(10, 5) } })
    const c = turnCost(b0, { costUsd: null, limits: { sevenDay: win(12, 5) } }, u(1000, 0, 0, 0), { prices: opus, ttl: '5m' })
    expect(c.estimated).toBe(true)
    expect(c.window).toEqual({ name: '7d', from: 10, to: 12 })
  })
})

