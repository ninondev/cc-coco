// Never throw (rule 11): a throwing fork or env getter never escapes, and odd
// inputs to the pure helpers behave.

import { expect, test } from 'bun:test'
import { armInput, flush, okFork, setup } from './helpers'
import { resolveLock } from '../../../plugin/hooks/cost/warm/index'
import type { ForkOutcome, WarmEnv } from '../../../plugin/hooks/cost/warm/index'

const boom = () => {
  throw new Error('getter boom')
}

test('a throwing switchOn counts as off at arm', () => {
  const env: WarmEnv = {
    switchOn: boom,
    isNewest: () => true,
    lock: () => 'unlocked',
    windowPercent: () => null,
  }
  const { keeper } = setup({ env })
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'off' })
})

test('a throwing isNewest counts as not newest at arm', () => {
  const env: WarmEnv = { switchOn: () => true, isNewest: boom, lock: () => 'unlocked', windowPercent: () => null }
  const { keeper } = setup({ env })
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'notNewest' })
})

test('a throwing lock counts as locked at the timer', () => {
  const env: WarmEnv = { switchOn: () => true, isNewest: () => true, lock: boom, windowPercent: () => null }
  const { clock, events, keeper } = setup({ env })
  keeper.arm(armInput())
  expect(() => clock.advance(240000)).not.toThrow()
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'locked' }])
})

test('a throwing windowPercent counts as 100 and stops with window', () => {
  const env: WarmEnv = { switchOn: () => true, isNewest: () => true, lock: () => 'unlocked', windowPercent: boom }
  const { clock, events, keeper } = setup({ env })
  keeper.arm(armInput())
  expect(() => clock.advance(240000)).not.toThrow()
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'window' }])
})

test('a throwing lock during status only affects the stopsBy cap choice', () => {
  const env: WarmEnv = { switchOn: () => true, isNewest: () => true, lock: boom, windowPercent: () => null }
  const { keeper } = setup({ env })
  keeper.arm(armInput())
  // no throw; cap falls back to the two-hour CAP_MS
  expect(keeper.status().stopsBy).toBe(5340000)
})

test('a throwing fork never escapes arm or the timer', () => {
  const throwing = (): Promise<ForkOutcome> => {
    throw new Error('sync fork boom')
  }
  const { clock, events, keeper } = setup({ fork: throwing })
  expect(() => keeper.arm(armInput())).not.toThrow()
  expect(() => clock.advance(240000)).not.toThrow()
  expect(events).toEqual([])
})

test('a refused arm leaves nothing scheduled and nothing breaks', () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput({ prefix: 1 })) // refuses small, nothing scheduled
  expect(keeper.status().state).toBe('idle')
  expect(clock.pending()).toBe(0)
})

test('resolveLock with odd inputs stays calm', () => {
  // NaN now makes the freshness test fail, so away falls through.
  expect(resolveLock({ now: Number.NaN, away: { state: 'locked', since: 1 } })).toBe('none')
  expect(resolveLock({ now: 0, ioreg: 42 as unknown as string })).toBe('none')
  expect(resolveLock({ now: 0, loginctl: undefined })).toBe('none')
  expect(resolveLock({ now: 0, away: 'yes' as unknown as null })).toBe('none')
})

test('an ok fork outcome without usage counts as an error', async () => {
  const bad = (): Promise<ForkOutcome> => Promise.resolve({ ok: true } as unknown as ForkOutcome)
  const { clock, events, keeper } = setup({ fork: bad })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events[0]).toEqual({ type: 'reread', at: 240000, ok: false, usd: 0, rereads: 0 })
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'error' })
})

test('status and arm keep working after every kind of stop', async () => {
  const { clock, keeper } = setup({ fork: okFork({ cacheRead: 0 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush() // gone
  expect(keeper.status().state).toBe('stopped')
  expect(keeper.turnStarted('composer')).not.toBeNull()
  expect(keeper.arm(armInput()).armed).toBe(true)
})
