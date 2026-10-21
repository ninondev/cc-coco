// The stop rules, each alone and their order at a single timer. The learned early stop is cut (owner 10-09).

import { expect, test } from 'bun:test'
import { FABLE, armInput, flush, okFork, setup } from './helpers'
import type { LockSignal } from '../../../plugin/hooks/cost/warm/index'

test('rule 1: switch off stops with off before any re-read', () => {
  let on = true
  const { clock, calls, events, keeper } = setup({ env: { switchOn: () => on } })
  keeper.arm(armInput())
  on = false
  clock.advance(240000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'off' }])
  expect(keeper.status()).toMatchObject({ state: 'stopped', reason: 'off' })
  expect(clock.pending()).toBe(0)
})

test('rule 3: another conversation newest stops with other', () => {
  let newest = true
  const { clock, calls, events, keeper } = setup({ env: { isNewest: () => newest } })
  keeper.arm(armInput())
  newest = false
  clock.advance(240000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'other' }])
  expect(keeper.status().reason).toBe('other')
})

test('rule 4: a timer that runs late stops with slept at warmUntil - 5 s', () => {
  const { clock, calls, events, keeper } = setup()
  keeper.arm(armInput())
  clock.sleep(295000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 295000, reason: 'slept' }])
  expect(keeper.status().reason).toBe('slept')
})

test('rule 4 boundary: firing one millisecond early still re-reads', async () => {
  const { clock, calls, keeper } = setup()
  keeper.arm(armInput())
  clock.sleep(294999)
  expect(calls.length).toBe(1)
  await flush()
  expect(keeper.status().rereads).toBe(1)
})

test('rule 5: a locked computer stops with locked', () => {
  const { clock, calls, events, keeper } = setup({ env: { lock: () => 'locked' } })
  keeper.arm(armInput())
  clock.advance(240000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'locked' }])
})

test('rule 6: the 30-minute cap with no lock signal (6 re-reads then cap at 28 min)', async () => {
  const { clock, calls, events, keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput())
  for (let i = 0; i < 6; i++) {
    clock.advance(240000)
    await flush()
  }
  expect(calls.length).toBe(6)
  clock.advance(240000) // minute 28: 28 + 5 > 30
  expect(calls.length).toBe(6)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 1680000, reason: 'cap' })
  expect(keeper.status()).toMatchObject({ state: 'stopped', reason: 'cap', rereads: 6 })
})

test('rule 6: the two-hour cap (Fable 5m: 28 re-reads then cap at minute 116)', async () => {
  const { clock, calls, events, keeper } = setup()
  keeper.arm(armInput({ prices: FABLE }))
  for (let i = 0; i < 28; i++) {
    clock.advance(240000)
    await flush()
  }
  expect(calls.length).toBe(28)
  expect(keeper.status().spentUsd).toBeCloseTo(28 * ((120000 * 0.25 + 30 * 10 + 150 * 50) / 1e6), 9)
  clock.advance(240000) // minute 116: 116 + 5 > 120
  expect(calls.length).toBe(28)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 6960000, reason: 'cap' })
})

test('rule 6: 1h with no lock stops with cap at the first timer', () => {
  const { clock, calls, events, keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput({ ttl: '1h' }))
  clock.advance(3360000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 3360000, reason: 'cap' }])
})

test('rule 7: budget stops when the measured estimate would pass delta', async () => {
  // The first re-read is allowed with the default estimate; its fat usage
  // (input 130000) sets the measured estimate, and the next timer stops.
  const { clock, calls, events, keeper } = setup({ fork: okFork({ input: 130000 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(calls.length).toBe(1)
  clock.advance(240000)
  expect(calls.length).toBe(1)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 480000, reason: 'budget' })
  expect(keeper.status().spentUsd).toBeCloseTo((130000 * 4 + 120000 * 0.2 + 150 * 20) / 1e6, 12)
})

test('rule 7 equality: spending exactly the single reread saving is allowed, the following reread stops', async () => {
  // Independent prices make both one cached read and the write/read saving
  // exactly $0.12. Changing the production comparison from > to >= must fail.
  const prices = { input: 0, write5m: 2, write1h: 2, read: 1, output: 0 }
  const { clock, calls, events, keeper } = setup()
  const armed = keeper.arm(armInput({ prefix: 120000, prices }))
  expect(armed).toEqual({ armed: true, firstAt: 240000, deltaUsd: .12 })
  clock.advance(240000); await flush()
  expect(calls.length).toBe(1)
  expect(keeper.status()).toMatchObject({ state: 'armed', reason: null, rereads: 1, spentUsd: .12 })
  clock.advance(240000)
  expect(calls.length).toBe(1)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 480000, reason: 'budget' })
  expect(keeper.status().spentUsd).toBe(.12)
  expect(clock.pending()).toBe(0)
})

test('rule 7 vs 6: cap is checked before budget', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ input: 130000 }).fork })
  keeper.arm(armInput({ ttl: '1h' }))
  clock.advance(3360000)
  await flush()
  clock.advance(3360000) // minute 112: cap (172 > 120) and budget (1.094 > 0.936) both match
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 6720000, reason: 'cap' })
  expect(keeper.status().reason).toBe('cap')
})

test('rule 9: windowPercent >= 95 stops with window', () => {
  const { clock, calls, events, keeper } = setup({ env: { windowPercent: () => 95 } })
  keeper.arm(armInput())
  clock.advance(240000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'window' }])
})

test('rule 9 boundary: 94.9 does not stop, null does not stop', async () => {
  const a = setup({ env: { windowPercent: () => 94.9 } })
  a.keeper.arm(armInput())
  a.clock.advance(240000)
  expect(a.calls.length).toBe(1)

  const b = setup({ env: { windowPercent: () => 100 } })
  b.keeper.arm(armInput())
  b.clock.advance(240000)
  expect(b.events[b.events.length - 1]).toEqual({ type: 'stop', at: 240000, reason: 'window' })
})

test('rule 9 absent window: null reading does not prevent an otherwise eligible reread', async () => {
  const { clock, calls, keeper } = setup({ env: { windowPercent: () => null } })
  expect(keeper.arm(armInput()).armed).toBe(true)
  clock.advance(240000); await flush()
  expect(calls.length).toBe(1)
  expect(keeper.status()).toMatchObject({ state: 'armed', reason: null, rereads: 1 })
  expect(clock.pending()).toBe(1)
})

test('rule 10: reset() stops the next timer with reset', () => {
  const { clock, calls, events, keeper } = setup()
  keeper.arm(armInput())
  keeper.reset()
  clock.advance(240000)
  expect(calls.length).toBe(0)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'reset' }])
})

test('rule 10: reset after a successful re-read stops the following timer', async () => {
  const { clock, calls, events, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  keeper.reset()
  clock.advance(240000)
  expect(calls.length).toBe(1)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 480000, reason: 'reset' })
})

test('rule 10: reset before a new arm is cleared by the arm', async () => {
  const { clock, calls, keeper } = setup()
  keeper.arm(armInput())
  keeper.reset()
  keeper.turnStarted('composer')
  keeper.reset()
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(calls.length).toBe(1)
  expect(keeper.status().reason).toBeNull()
})

test('order: off beats every other matching rule', () => {
  let on = true
  let newest = true
  const { clock, events, keeper } = setup({
    env: {
      switchOn: () => on,
      isNewest: () => newest,
      lock: () => 'locked',
      windowPercent: () => 99,
    },
  })
  keeper.arm(armInput())
  on = false
  newest = false
  keeper.reset()
  clock.sleep(295000)
  expect(events).toEqual([{ type: 'stop', at: 295000, reason: 'off' }])
})

test('order: other beats slept', () => {
  let newest = true
  const { clock, events, keeper } = setup({ env: { isNewest: () => newest, lock: () => 'locked' } })
  keeper.arm(armInput())
  newest = false
  clock.sleep(300000)
  expect(events).toEqual([{ type: 'stop', at: 300000, reason: 'other' }])
})

test('order: slept beats locked', () => {
  const { clock, events, keeper } = setup({ env: { lock: () => 'locked' } })
  keeper.arm(armInput())
  clock.sleep(300000)
  expect(events).toEqual([{ type: 'stop', at: 300000, reason: 'slept' }])
})

test('order: locked beats cap', async () => {
  let lock: LockSignal = 'unlocked'
  const { clock, events, keeper } = setup({ env: { lock: () => lock } })
  keeper.arm(armInput({ prices: FABLE }))
  for (let i = 0; i < 28; i++) {
    clock.advance(240000)
    await flush()
  }
  lock = 'locked' // the minute-116 timer sees locked and cap both matching
  clock.advance(240000)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 6960000, reason: 'locked' })
})

test('order: window beats reset', () => {
  const { clock, events, keeper } = setup({ env: { windowPercent: () => 95 } })
  keeper.arm(armInput())
  keeper.reset()
  clock.advance(240000)
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'window' }])
})
