// Re-reads (rules 4-5 and 11): the worked runs, event order and contents,
// error/gone/costly outcomes, the estimate, and the timer invariants.

import { expect, test } from 'bun:test'
import {
  KEEP_WARM_PROMPT,
  type ForkOutcome,
  type KeeperEvent,
} from '../../../plugin/hooks/cost/warm/index'
import { armInput, deferredFork, flush, forkSeq, okFork, okUsage, setup } from './helpers'

const OPUS_REREAD_USD = (30 * 4 + 120000 * 0.2 + 0 * 5 + 150 * 20) / 1e6

test('worked run 5m Opus: 21 re-reads at minutes 4..84, then budget at minute 88', async () => {
  const { clock, calls, events, keeper } = setup()
  const res = keeper.arm(armInput())
  expect(res.armed).toBe(true)
  for (let i = 1; i <= 21; i++) {
    clock.advance(240000)
    await flush()
    expect(calls.length).toBe(i)
    expect(clock.pending()).toBe(1)
    expect(keeper.status().spentUsd).toBeLessThanOrEqual(120000 * (5 - 0.2) / 1e6)
  }
  clock.advance(240000) // minute 88
  expect(calls.length).toBe(21)
  const rereadEvents = events.filter((e) => e.type === 'reread')
  expect(rereadEvents.length).toBe(21)
  for (let i = 0; i < 21; i++) {
    expect(rereadEvents[i]).toEqual({ type: 'reread', at: 240000 * (i + 1), ok: true, usd: OPUS_REREAD_USD, rereads: i + 1 })
  }
  expect(events[21]).toEqual({ type: 'stop', at: 5280000, reason: 'budget' })
  const s = keeper.status()
  expect(s.state).toBe('stopped')
  expect(s.reason).toBe('budget')
  expect(s.rereads).toBe(21)
  expect(s.spentUsd).toBeCloseTo(21 * OPUS_REREAD_USD, 10)
  expect(s.warmUntil).toBe(5340000)
  expect(clock.pending()).toBe(0)
})

test('worked run 1h Opus: one re-read at minute 56, then cap at minute 112', async () => {
  const { clock, calls, events, keeper } = setup()
  keeper.arm(armInput({ ttl: '1h' }))
  clock.advance(3360000)
  await flush()
  expect(calls.length).toBe(1)
  expect(keeper.status()).toMatchObject({ rereads: 1, warmUntil: 6960000, nextAt: 6720000, state: 'armed' })
  clock.advance(3360000)
  expect(calls.length).toBe(1)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 6720000, reason: 'cap' })
  expect(clock.pending()).toBe(0)
})

test('fork is called with the exact keep-warm prompt', () => {
  const f = okFork()
  const { clock, calls, keeper } = setup({ fork: f.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  expect(calls.length).toBe(1)
  expect(calls[0]).toBe(KEEP_WARM_PROMPT)
})

test('error: a fork resolving ok:false stops with error and adds nothing', async () => {
  const { clock, events, keeper } = setup({ fork: forkSeq([{ ok: false } as ForkOutcome]).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events).toEqual([
    { type: 'reread', at: 240000, ok: false, usd: 0, rereads: 0 },
    { type: 'stop', at: 240000, reason: 'error' },
  ])
  expect(keeper.status()).toMatchObject({ state: 'stopped', reason: 'error', rereads: 0, spentUsd: 0 })
  expect(clock.pending()).toBe(0)
})

test('error: a rejected fork stops with error', async () => {
  const { clock, events, keeper } = setup({ fork: forkSeq(['reject']).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events[0]).toEqual({ type: 'reread', at: 240000, ok: false, usd: 0, rereads: 0 })
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'error' })
})

test('error: a fork throwing synchronously settles like a rejection', async () => {
  const { clock, events, keeper } = setup({ fork: forkSeq(['throw']).fork })
  keeper.arm(armInput())
  expect(() => clock.advance(240000)).not.toThrow()
  await flush()
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'error' })
  expect(keeper.status().state).toBe('stopped')
})

test('gone: a cache read below 90% stops with gone and still counts the re-read', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ cacheRead: 107000 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  const usd = (30 * 4 + 107000 * 0.2 + 0 * 5 + 150 * 20) / 1e6
  expect(events).toEqual([
    { type: 'reread', at: 240000, ok: true, usd, rereads: 1 },
    { type: 'stop', at: 240000, reason: 'gone' },
  ])
  expect(keeper.status()).toMatchObject({ reason: 'gone', rereads: 1, spentUsd: usd, disabled: false })
})

test('a cache read just above the hit share is a success', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ cacheRead: 108001 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events.length).toBe(1)
  expect(events[0].type).toBe('reread')
  expect(keeper.status().state).toBe('armed')
})

test('costly: output above 1000 stops with costly after counting the read', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ output: 1001 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'costly' })
  expect(keeper.status()).toMatchObject({ reason: 'costly', rereads: 1 })
})

test('output of exactly 1000 is fine', async () => {
  const { clock, keeper } = setup({ fork: okFork({ output: 1000 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status().state).toBe('armed')
  expect(keeper.status().rereads).toBe(1)
})

test('rule 11 order: gone is checked before costly', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ cacheRead: 0, output: 5000 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'gone' })
  expect(keeper.status().reason).toBe('gone')
})

test('the re-read cost includes cacheWrite at the TTL write price', async () => {
  const { clock, events, keeper } = setup({ fork: okFork({ cacheWrite: 500 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  const expected = (30 * 4 + 120000 * 0.2 + 500 * 5 + 150 * 20) / 1e6
  expect(events[0]).toEqual({ type: 'reread', at: 240000, ok: true, usd: expected, rereads: 1 })
  expect(keeper.status().spentUsd).toBeCloseTo(expected, 12)
})

test('a successful re-read moves sentAt: warmUntil and nextAt follow', async () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  expect(keeper.status()).toMatchObject({ warmUntil: 300000, nextAt: 240000 })
  clock.advance(240000)
  await flush()
  expect(keeper.status()).toMatchObject({ warmUntil: 540000, nextAt: 480000, state: 'armed' })
})

test('estimate switches to the measured usage of the last successful re-read', async () => {
  // output 990 (allowed): the measured estimate rises to 0.04392 per re-read
  // and the budget rule stops after 13 instead of 21.
  const { clock, calls, events, keeper } = setup({ fork: okFork({ output: 990 }).fork })
  keeper.arm(armInput())
  for (let i = 0; i < 13; i++) {
    clock.advance(240000)
    await flush()
  }
  expect(calls.length).toBe(13)
  clock.advance(240000) // minute 56
  expect(calls.length).toBe(13)
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 3360000, reason: 'budget' })
  expect(keeper.status().spentUsd).toBeCloseTo(13 * ((30 * 4 + 120000 * 0.2 + 990 * 20) / 1e6), 9)
})

test('measured usage is kept across pauses', async () => {
  const { clock, keeper } = setup({ fork: okFork({ output: 990 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  keeper.turnStarted('composer')
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status().rereads).toBe(1)
  // stopsBy for the second pause assumes the measured 0.04392 per re-read:
  // 13 fit under delta 0.576, so the last is at minute 52, warm to 57.
  expect(keeper.status().stopsBy).toBe(3420000)
})

test('in flight: turnStarted ends the pause, the result is only reported', async () => {
  const d = deferredFork()
  const { clock, events, keeper } = setup({ fork: d.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  expect(clock.pending()).toBe(0) // nothing pending while in flight
  const summary = keeper.turnStarted('composer')
  expect(summary).not.toBeNull()
  expect(summary!.rereads).toBe(0)
  d.resolve({ ok: true, usage: okUsage() })
  await flush()
  expect(events).toEqual([
    { type: 'stop', at: 240000, reason: 'turn' },
    { type: 'reread', at: 240000, ok: true, usd: OPUS_REREAD_USD, rereads: 0 },
  ])
  expect(keeper.status()).toMatchObject({ state: 'idle', rereads: 0, spentUsd: 0 })
  expect(clock.pending()).toBe(0)
})

test('in flight: cancel stops with off, the result is only reported', async () => {
  const d = deferredFork()
  const { clock, events, keeper } = setup({ fork: d.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  keeper.cancel()
  expect(events).toEqual([{ type: 'stop', at: 240000, reason: 'off' }])
  d.resolve({ ok: true, usage: okUsage() })
  await flush()
  expect(events.length).toBe(2)
  expect(events[1]).toEqual({ type: 'reread', at: 240000, ok: true, usd: OPUS_REREAD_USD, rereads: 0 })
  expect(keeper.status()).toMatchObject({ state: 'stopped', reason: 'off', rereads: 0, spentUsd: 0 })
})

test('in flight: a new arm makes the old result inert', async () => {
  const d = deferredFork()
  const { clock, events, keeper } = setup({ fork: d.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  keeper.arm(armInput())
  d.resolve({ ok: true, usage: okUsage({ cacheRead: 0 }) }) // would be gone
  await flush()
  expect(events.length).toBe(1)
  expect(events[0]).toEqual({ type: 'reread', at: 240000, ok: true, usd: (30 * 4 + 0 + 0 + 150 * 20) / 1e6, rereads: 0 })
  expect(keeper.status()).toMatchObject({ state: 'armed', rereads: 0, spentUsd: 0 })
  expect(clock.pending()).toBe(1)
})

test('a rule-11 stop carries the settle time, not the start time', async () => {
  const d = deferredFork()
  const { clock, events, keeper } = setup({ fork: d.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  clock.advance(60000) // the re-read is still in flight; a minute passes
  d.resolve({ ok: true, usage: okUsage({ cacheRead: 0 }) })
  await flush()
  expect(events[0]).toEqual({ type: 'reread', at: 240000, ok: true, usd: (30 * 4 + 0 + 0 + 150 * 20) / 1e6, rereads: 1 })
  expect(events[1]).toEqual({ type: 'stop', at: 300000, reason: 'gone' })
  expect(keeper.status().state).toBe('stopped')
})

test('never more than one pending timer across a long run', async () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  for (let i = 0; i < 5; i++) {
    expect(clock.pending()).toBe(1)
    clock.advance(240000)
    expect(clock.pending()).toBe(0)
    await flush()
    expect(clock.pending()).toBe(1)
  }
  keeper.cancel()
  expect(clock.pending()).toBe(0)
})

test('nothing pending after a stop, a cancel or a turn start', async () => {
  const a = setup({ env: { switchOn: () => false } })
  a.keeper.arm(armInput())
  a.clock.advance(240000) // stop 'off'
  expect(a.clock.pending()).toBe(0)

  const b = setup()
  b.keeper.arm(armInput())
  b.keeper.cancel()
  expect(b.clock.pending()).toBe(0)

  const c = setup()
  c.keeper.arm(armInput())
  c.clock.advance(240000)
  c.keeper.turnStarted('other')
  expect(c.clock.pending()).toBe(0)
})

test('a rejected in-flight re-read after the pause ended reports without stopping', async () => {
  const d = deferredFork()
  const { clock, events, keeper } = setup({ fork: d.fork })
  keeper.arm(armInput())
  clock.advance(240000)
  keeper.cancel()
  d.resolve({ ok: false })
  await flush()
  expect(events.length).toBe(2)
  expect(events[1]).toEqual({ type: 'reread', at: 240000, ok: false, usd: 0, rereads: 0 })
  expect(keeper.status().state).toBe('stopped')
  expect(keeper.status().reason).toBe('off')
})

test('events during a healthy pause are only rereads', async () => {
  const { clock, events, keeper } = setup()
  keeper.arm(armInput())
  for (let i = 0; i < 3; i++) {
    clock.advance(240000)
    await flush()
  }
  const types = events.map((e: KeeperEvent) => e.type)
  expect(types).toEqual(['reread', 'reread', 'reread'])
  expect(keeper.status()).toMatchObject({ state: 'armed', rereads: 3 })
})
