// Return (rule 7): turnStarted summaries, announce, allHit, firstReply,
// cancel, reset, status lifecycle, and the twice-gone rule 6.

import { expect, test } from 'bun:test'
import { armInput, flush, forkSeq, okFork, okUsage, setup } from './helpers'
import type { ForkOutcome } from '../../../plugin/hooks/cost/warm/index'

const D5 = 120000 * (5 - 0.2) / 1e6
const K = (30 * 4 + 120000 * 0.2 + 0 * 5 + 150 * 20) / 1e6
const gone: ForkOutcome = { ok: true, usage: okUsage({ cacheRead: 0 }) }
const good: ForkOutcome = { ok: true, usage: okUsage() }

// arm at 0, one good re-read at minute 4, person back at minute 6
function pausedOnce() {
  const s = setup()
  s.keeper.arm(armInput())
  s.clock.advance(240000)
  void flush()
  s.clock.advance(120000)
  return s
}

test('turnStarted returns null when no pause is open', () => {
  const { keeper } = setup()
  expect(keeper.turnStarted('composer')).toBeNull()
})

test('turnStarted returns null a second time', async () => {
  const s = pausedOnce()
  expect(s.keeper.turnStarted('composer')).not.toBeNull()
  expect(s.keeper.turnStarted('composer')).toBeNull()
})

test('turnStarted returns null after a refused arm', () => {
  const { keeper } = setup({ env: { switchOn: () => false } })
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'off' })
  expect(keeper.turnStarted('composer')).toBeNull()
})

test('summary when still armed: reason turn, stoppedAt null, stop event at the end', async () => {
  const s = pausedOnce()
  await flush() // let the re-read settle before the turn starts
  const eventsBefore = s.events.length
  const summary = s.keeper.turnStarted('composer')
  expect(summary).toEqual({
    start: 0,
    end: 360000,
    rereads: 1,
    spentUsd: K,
    deltaUsd: D5,
    stoppedAt: null,
    reason: 'turn',
    announce: true,
    allHit: true,
    warmUntil: 540000,
  })
  expect(s.events.length).toBe(eventsBefore + 1)
  expect(s.events[s.events.length - 1]).toEqual({ type: 'stop', at: 360000, reason: 'turn' })
  expect(s.clock.pending()).toBe(0)
  expect(s.keeper.status().state).toBe('idle')
})

test('announce is false for a silent running pause with no re-reads', () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(120000)
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ reason: 'turn', rereads: 0, announce: false, allHit: false })
})

test('announce is true for the bridge origin with re-reads', async () => {
  const s = pausedOnce()
  await flush()
  expect(s.keeper.turnStarted('bridge')!.announce).toBe(true)
})

test('announce is false for the other origin even with re-reads', async () => {
  const s = pausedOnce()
  await flush()
  const summary = s.keeper.turnStarted('other')
  expect(summary!.rereads).toBe(1)
  expect(summary!.announce).toBe(false)
})

test('announce is true for a loud stop reason without re-reads', () => {
  const { clock, keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput({ ttl: '1h' }))
  clock.advance(3360000) // cap with no re-read at minute 56
  clock.advance(240000)
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ reason: 'cap', rereads: 0, stoppedAt: 3360000, announce: true })
})

test('announce is false for a cancel (off) without re-reads', () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(60000)
  keeper.cancel()
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ reason: 'off', stoppedAt: 60000, announce: false })
})

test('announce for reset depends on the re-reads', async () => {
  const a = setup()
  a.keeper.arm(armInput())
  a.keeper.reset()
  a.clock.advance(240000)
  expect(a.keeper.turnStarted('bridge')!.announce).toBe(false)

  const b = setup()
  b.keeper.arm(armInput())
  b.clock.advance(240000)
  await flush()
  b.keeper.reset()
  b.clock.advance(240000) // reset stops the minute-8 timer
  const summary = b.keeper.turnStarted('bridge')
  expect(summary).toMatchObject({ reason: 'reset', rereads: 1, announce: true })
})

test('allHit is false when the only re-read went gone', async () => {
  const { clock, keeper } = setup({ fork: forkSeq([gone]).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ rereads: 1, allHit: false, reason: 'gone' })
})

test('allHit stays true for a costly re-read that hit the cache', async () => {
  const { clock, keeper } = setup({ fork: okFork({ output: 1001 }).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ rereads: 1, allHit: true, reason: 'costly' })
})

test('firstReply returns null without a kept summary', () => {
  const { keeper } = setup()
  expect(keeper.firstReply(120000, false)).toBeNull()
})

test('firstReply consumes the summary', async () => {
  const s = pausedOnce()
  await flush()
  s.keeper.turnStarted('composer')
  expect(s.keeper.firstReply(120000, false)).not.toBeNull()
  expect(s.keeper.firstReply(120000, false)).toBeNull()
})

test('firstReply: warm return after a covered pause saves delta minus spent', async () => {
  const s = pausedOnce()
  await flush()
  s.keeper.turnStarted('composer')
  expect(s.keeper.firstReply(120000, false)).toEqual({ warmOnReturn: true, savedUsd: D5 - K, notHeld: false })
})

test('firstReply: a cold return with re-reads loses the spent rent', async () => {
  const s = pausedOnce()
  await flush()
  s.keeper.turnStarted('composer')
  expect(s.keeper.firstReply(0, false)).toEqual({ warmOnReturn: false, savedUsd: -K, notHeld: true })
})

test('firstReply: notHeld is cleared by an explained return', async () => {
  const s = pausedOnce()
  await flush()
  s.keeper.turnStarted('composer')
  expect(s.keeper.firstReply(0, true)!.notHeld).toBe(false)
})

test('firstReply: notHeld needs a cache read below half the prefix', async () => {
  const a = pausedOnce()
  await flush()
  a.keeper.turnStarted('composer')
  expect(a.keeper.firstReply(60000, false)!.notHeld).toBe(false) // exactly 50%: not below
  const b = pausedOnce()
  await flush()
  b.keeper.turnStarted('composer')
  expect(b.keeper.firstReply(59999, false)!.notHeld).toBe(true)
})

test('firstReply: no re-reads means zero saved whatever happens', () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(120000)
  keeper.turnStarted('composer')
  expect(keeper.firstReply(120000, false)).toEqual({ warmOnReturn: true, savedUsd: 0, notHeld: false })
  expect(keeper.firstReply(0, false)).toBeNull() // consumed
})

test('firstReply: warm but back before sentAt + TTL only loses the rent', async () => {
  const { clock, keeper } = setup()
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  clock.advance(30000) // minute 4.5, before sentAt + TTL = minute 5
  keeper.turnStarted('composer')
  expect(keeper.firstReply(120000, false)).toEqual({ warmOnReturn: true, savedUsd: -K, notHeld: false })
})

test('firstReply on a stopped pause: end past warmUntil blocks notHeld', async () => {
  const { clock, keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput())
  for (let i = 0; i < 6; i++) {
    clock.advance(240000)
    await flush()
  }
  clock.advance(240000) // cap at minute 28
  clock.advance(420000) // person back at minute 35, warmUntil was minute 29
  const summary = keeper.turnStarted('composer')
  expect(summary).toMatchObject({ reason: 'cap', rereads: 6, warmUntil: 1740000, allHit: true })
  expect(summary!.end).toBe(2100000)
  const cold = keeper.firstReply(0, false)!
  expect(cold.warmOnReturn).toBe(false)
  expect(cold.savedUsd).toBeCloseTo(-6 * K, 10)
  expect(cold.notHeld).toBe(false)
})

test('firstReply on a stopped pause: warm return saves delta minus spent', async () => {
  const { clock, keeper } = setup({ env: { lock: () => 'none' } })
  keeper.arm(armInput())
  for (let i = 0; i < 6; i++) {
    clock.advance(240000)
    await flush()
  }
  clock.advance(240000)
  clock.advance(420000)
  keeper.turnStarted('composer')
  const warm = keeper.firstReply(120000, false)!
  expect(warm.warmOnReturn).toBe(true)
  expect(warm.savedUsd).toBeCloseTo(D5 - 6 * K, 10)
  expect(warm.notHeld).toBe(false)
})

test('status lifecycle: idle, armed, idle again with the last counters', async () => {
  const { clock, keeper } = setup()
  expect(keeper.status()).toEqual({
    state: 'idle',
    pauseStart: null,
    rereads: 0,
    spentUsd: 0,
    warmUntil: null,
    nextAt: null,
    stopsBy: null,
    reason: null,
    disabled: false,
  })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status()).toMatchObject({ state: 'armed', rereads: 1, pauseStart: 0, warmUntil: 540000, nextAt: 480000 })
  keeper.turnStarted('composer')
  expect(keeper.status()).toEqual({
    state: 'idle',
    pauseStart: null,
    rereads: 1,
    spentUsd: K,
    warmUntil: null,
    nextAt: null,
    stopsBy: null,
    reason: null,
    disabled: false,
  })
})

test('cancel does nothing when idle or stopped', () => {
  const { keeper, events } = setup()
  keeper.cancel()
  expect(events).toEqual([])
  keeper.arm(armInput())
  keeper.cancel()
  keeper.cancel()
  expect(events).toEqual([{ type: 'stop', at: 0, reason: 'off' }])
})

test('twice-gone: the first gone stop leaves the keeper enabled', async () => {
  const { clock, keeper, events } = setup({ fork: forkSeq([gone]).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(events[1]).toEqual({ type: 'stop', at: 240000, reason: 'gone' })
  expect(keeper.status().disabled).toBe(false)
})

test('twice-gone: two first-gone pauses in a row give unsupported and disable', async () => {
  const { clock, keeper, events } = setup({ fork: forkSeq([gone, gone]).fork })
  keeper.arm(armInput()) // pause 1 from t = 0
  clock.advance(240000)
  await flush() // first re-read gone: counter 1, stop gone at 240000
  keeper.turnStarted('composer')
  keeper.arm(armInput({ sentAt: clock.now() })) // pause 2 from t = 240000
  clock.advance(240000)
  await flush() // first re-read of pause 2 gone: counter 2
  expect(events[events.length - 1]).toEqual({ type: 'stop', at: 480000, reason: 'unsupported' })
  expect(keeper.status().disabled).toBe(true)
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'disabled' })
})

test('off beats disabled when both match', async () => {
  let on = true
  const { clock, keeper } = setup({ env: { switchOn: () => on }, fork: forkSeq([gone, gone]).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  keeper.turnStarted('composer')
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status().disabled).toBe(true)
  on = false
  expect(keeper.arm(armInput())).toEqual({ armed: false, why: 'off' })
})

test('twice-gone: a successful first re-read resets the counter', async () => {
  const { clock, keeper } = setup({ fork: forkSeq([gone, good, gone]).fork })
  keeper.arm(armInput()) // pause 1 from t = 0
  clock.advance(240000)
  await flush() // first re-read gone (count 1)
  keeper.turnStarted('composer')
  keeper.arm(armInput({ sentAt: clock.now() })) // pause 2 from t = 240000
  clock.advance(240000)
  await flush() // first re-read good: success resets the counter
  keeper.turnStarted('composer')
  keeper.arm(armInput({ sentAt: clock.now() })) // pause 3 from t = 480000
  clock.advance(240000)
  await flush() // first re-read gone again: count 1, not unsupported
  expect(keeper.status()).toMatchObject({ reason: 'gone', disabled: false })
})

test('twice-gone: a gone on a later re-read of a pause does not count', async () => {
  const { clock, keeper } = setup({ fork: forkSeq([good, gone, gone]).fork })
  keeper.arm(armInput()) // pause 1 from t = 0
  clock.advance(240000)
  await flush() // good
  clock.advance(240000)
  await flush() // gone on the second re-read: stop gone, counter untouched
  expect(keeper.status().reason).toBe('gone')
  keeper.turnStarted('composer')
  keeper.arm(armInput({ sentAt: clock.now() })) // pause 2 from t = 480000
  clock.advance(240000)
  await flush() // first re-read of the new pause gone: count 1 -> gone again
  expect(keeper.status()).toMatchObject({ reason: 'gone', disabled: false })
})

test('the second pause after a gone keeps the measured usage of the good run', async () => {
  const fat: ForkOutcome = { ok: true, usage: okUsage({ input: 130000 }) }
  const { clock, keeper } = setup({ fork: forkSeq([good, fat]).fork })
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  keeper.turnStarted('composer')
  keeper.arm(armInput())
  clock.advance(240000)
  await flush()
  expect(keeper.status().spentUsd).toBeCloseTo((130000 * 4 + 120000 * 0.2 + 150 * 20) / 1e6, 12)
  expect(keeper.status().rereads).toBe(1)
})
