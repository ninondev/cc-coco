// Arming (rule 3): each refusal, their order, and the armed result.

import { expect, test } from 'bun:test'
import { FakeClock, armInput, flush, makeEnv, okFork, setup } from './helpers'
import { createKeeper } from '../../../plugin/hooks/cost/warm/index'

test('arm refuses off when the switch is off', () => {
  const { clock, keeper, events } = setup({ env: { switchOn: () => false } })
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'off' })
  expect(keeper.status().state).toBe('idle')
  expect(clock.pending()).toBe(0)
  expect(events).toEqual([])
})

test('arm refuses heldOff', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ heldOff: true }))).toEqual({ armed: false, why: 'heldOff' })
})

test('arm refuses unobserved', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ observed: false }))).toEqual({ armed: false, why: 'unobserved' })
})

test('arm refuses small when delta < 0.05', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ prefix: 1000 }))).toEqual({ armed: false, why: 'small' })
})

test('arm accepts delta exactly at the 0.05 floor boundary region', () => {
  // prefix 10417 * 4.8 / 1e6 = 0.0500016 >= 0.05
  const { keeper } = setup()
  const res = keeper.arm(armInput({ prefix: 10417 }))
  expect(res.armed).toBe(true)
})

test('arm refuses notInteractive', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ interactive: false }))).toEqual({ armed: false, why: 'notInteractive' })
})

test('arm refuses notNewest', () => {
  const { keeper } = setup({ env: { isNewest: () => false } })
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'notNewest' })
})

test('arm refuses cron', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ cronWithinTtl: true }))).toEqual({ armed: false, why: 'cron' })
})

test('off beats heldOff', () => {
  const { keeper } = setup({ env: { switchOn: () => false } })
  expect(keeper.arm(armInput({ heldOff: true, observed: false }))).toEqual({ armed: false, why: 'off' })
})

test('heldOff beats unobserved', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ heldOff: true, observed: false }))).toEqual({ armed: false, why: 'heldOff' })
})

test('unobserved beats small', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ observed: false, prefix: 1 }))).toEqual({ armed: false, why: 'unobserved' })
})

test('small beats notInteractive', () => {
  const { keeper } = setup()
  expect(keeper.arm(armInput({ prefix: 1000, interactive: false }))).toEqual({ armed: false, why: 'small' })
})

test('notInteractive beats notNewest', () => {
  const { keeper } = setup({ env: { isNewest: () => false } })
  expect(keeper.arm(armInput({ interactive: false }))).toEqual({ armed: false, why: 'notInteractive' })
})

test('notNewest beats cron', () => {
  const { keeper } = setup({ env: { isNewest: () => false } })
  expect(keeper.arm(armInput({ cronWithinTtl: true }))).toEqual({ armed: false, why: 'notNewest' })
})

test('armed 5m: firstAt is sentAt + 4 minutes and deltaUsd is the write gap', () => {
  const { clock, keeper } = setup()
  const res = keeper.arm(armInput({ sentAt: 1000 }))
  expect(res).toEqual({ armed: true, firstAt: 1000 + 240000, deltaUsd: 120000 * (5 - 0.2) / 1e6 })
  expect(clock.pending()).toBe(1)
  const s = keeper.status()
  expect(s.state).toBe('armed')
  expect(s.pauseStart).toBe(0)
  expect(s.warmUntil).toBe(1000 + 300000)
  expect(s.nextAt).toBe(1000 + 240000)
  expect(s.reason).toBeNull()
  expect(s.disabled).toBe(false)
})

test('armed 1h: firstAt is sentAt + 56 minutes, deltaUsd uses write1h', () => {
  const { keeper } = setup()
  const res = keeper.arm(armInput({ ttl: '1h' }))
  if (!res.armed) throw new Error('expected the 1h arm to succeed')
  expect(res.firstAt).toBe(3360000)
  expect(res.deltaUsd).toBe(120000 * (8 - 0.2) / 1e6)
})

test('delay is never negative: a timer due now fires on advance(0)', async () => {
  const clock = new FakeClock(240000)
  const { fork, calls } = okFork()
  const keeper = createKeeper({ clock, fork, env: makeEnv() })
  const res = keeper.arm(armInput({ sentAt: 0 }))
  expect(res.armed).toBe(true)
  expect(clock.pending()).toBe(1)
  clock.advance(0)
  expect(calls.length).toBe(1)
  await flush()
  expect(keeper.status().rereads).toBe(1)
})

test('a firstAt long past fires at once and stops with slept', () => {
  const { clock, calls, events, keeper } = setup()
  clock.advance(300000)
  const res = keeper.arm(armInput({ sentAt: 0 }))
  expect(res.armed).toBe(true)
  clock.advance(0)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 300000, reason: 'slept' }])
  expect(keeper.status().state).toBe('stopped')
})

test('arm cancels any pending timer before refusing', () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  expect(clock.pending()).toBe(1)
  clock.advance(120000)
  const res = keeper.arm(armInput({ heldOff: true }))
  expect(res).toEqual({ armed: false, why: 'heldOff' })
  expect(clock.pending()).toBe(0)
})

test('arm cancels the previous timer and schedules exactly one new one', async () => {
  const { clock, calls, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(120000)
  expect(keeper.arm(armInput())).toEqual({ armed: true, firstAt: 240000, deltaUsd: 120000 * (5 - 0.2) / 1e6 })
  expect(clock.pending()).toBe(1)
  clock.advance(120000)
  await flush()
  expect(calls.length).toBe(1)
  expect(clock.pending()).toBe(1)
})

test('arm discards an unreported pause summary', async () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.turnStarted('composer')).not.toBeNull()
  keeper.arm(armInput())
  expect(keeper.firstReply(120000, false)).toBeNull()
})

test('arm resets the counters of the new pause', async () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status().rereads).toBe(1)
  keeper.turnStarted('composer')
  expect(keeper.arm(armInput()).armed).toBe(true)
  const s = keeper.status()
  expect(s.rereads).toBe(0)
  expect(s.spentUsd).toBe(0)
  expect(s.state).toBe('armed')
})

test('stopsBy at arm time reaches the budget limit (5m Opus: 89 min)', () => {
  const { keeper } = setup()
  keeper.arm(armInput())
  expect(keeper.status().stopsBy).toBe(5340000)
})

test('stopsBy uses the 30-minute cap when lock is none', () => {
  const { keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput())
  expect(keeper.status().stopsBy).toBe(1740000)
})
