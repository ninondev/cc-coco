// r11-01: the warm switch is per conversation. A session with its own switch on keeps itself
// warm without being the newest; the legacy shared row keeps its old newest-only meaning until
// someone uses the new control; «turn all off» clears every conversation at once. These tests
// drive createWarmRuntime directly with a shared store, as runtime.test.ts does.

import { expect, test } from 'bun:test'
import { createWarmRuntime } from '../../../plugin/hooks/cost/warm-runtime'
import type { ForkFn, LockSignal } from '../../../plugin/hooks/cost/warm/index'
import { FakeClock, armInput, flush, okUsage } from './helpers'

type Shared = { data: Map<string, unknown> }
const store = (shared: Shared) => ({
  get: async (key: string) => shared.data.get(key),
  set: async (key: string, value: unknown) => { shared.data.set(key, value) },
  keys: async () => [...shared.data.keys()],
})
// Entries and the all-off stamp share one clock domain; a positive start keeps them apart.
// (FakeClock starts at 0, where a fresh entry would equal the absent stamp.)
const BASE = 1_000

function session(options: {
  id?: string
  shared: Shared
  newest?: boolean
  fork?: ForkFn
  kind?: string
}) {
  const clock = new FakeClock(BASE)
  let calls = 0
  let newest = options.newest ?? true
  let lock: LockSignal = 'unlocked'
  const runtime = createWarmRuntime({
    clock,
    store: store(options.shared),
    ...(options.id === undefined ? {} : { sessionId: () => options.id! }),
    fork: options.fork ?? (async () => { calls++; return { ok: true, usage: okUsage() } }),
    isNewest: () => newest,
    readLock: async () => lock,
    windowPercent: () => null,
    billingKind: () => options.kind ?? 'plan',
    computerId: `sessions-${Math.random()}`,
  })
  return {
    clock, runtime,
    calls: () => calls,
    loseNewest: () => { newest = false },
    lockScreen: () => { lock = 'locked' },
    shared: options.shared,
  }
}

const arm = async (s: ReturnType<typeof session>) => {
  await s.runtime.turnStarted('other')
  return await s.runtime.arm(armInput({ sentAt: s.clock.now() }))
}

test('a conversation with its own switch on keeps warm even when it is not the newest', async () => {
  const shared: Shared = { data: new Map() }
  const a = session({ id: 'a', shared, newest: false })
  expect(await arm(a)).toEqual({ armed: false, why: 'off' })
  await a.runtime.setEnabled(true)
  const result = await arm(a)
  expect(result.armed).toBe(true)
  // The first re-read runs although isNewest is false: the session's own switch carries it.
  a.clock.advance(300000 - 60000 + 1)
  await flush()
  expect(a.calls()).toBe(1)
  await a.runtime.close()
})

test('turning one conversation off leaves another switched-on conversation running', async () => {
  const shared: Shared = { data: new Map() }
  const a = session({ id: 'a', shared })
  const b = session({ id: 'b', shared, newest: false })
  await a.runtime.setEnabled(true)
  await b.runtime.setEnabled(true)
  expect((await arm(a)).armed).toBe(true)
  expect((await arm(b)).armed).toBe(true)
  await a.runtime.setEnabled(false)
  // a stops; b still holds its own switch and its own pause.
  expect(a.runtime.status()?.state).toBe('stopped')
  expect((await arm(b)).armed).toBe(true)
  b.clock.advance(300000 - 60000 + 1)
  await flush()
  expect(b.calls()).toBe(1)
  await a.runtime.close(); await b.runtime.close()
})

test('«turn all off» clears every switch, the legacy row too, and reaches the other sessions', async () => {
  const shared: Shared = { data: new Map() }
  shared.data.set('more', { warm: true })
  const a = session({ id: 'a', shared, newest: false })
  const b = session({ id: 'b', shared, newest: false })
  await a.runtime.setEnabled(true)
  await b.runtime.setEnabled(true)
  expect((await arm(b)).armed).toBe(true)
  await a.runtime.allOff()
  expect(JSON.parse(JSON.stringify(shared.data.get('more')))).toEqual({ warm: false })
  const rows = JSON.parse(JSON.stringify(shared.data.get('warm.sessions')))
  expect(Object.keys(rows.on)).toEqual([])
  expect(rows.offAllAt).toBeGreaterThan(0)
  expect((await arm(b)).armed).toBe(false)
  // A switch set after the all-off stamp is on again.
  shared.data.set('warm.sessions', { offAllAt: rows.offAllAt, on: { b: { on: true, at: rows.offAllAt + 1 } } })
  expect((await arm(b)).armed).toBe(true)
  await a.runtime.close(); await b.runtime.close()
})

test('without a session id the switch keeps its old shared-row meaning: newest only', async () => {
  const shared: Shared = { data: new Map() }
  shared.data.set('more', { warm: true })
  const newest = session({ shared })
  expect((await arm(newest)).armed).toBe(true)
  const old = session({ shared, newest: false })
  expect(await arm(old)).toEqual({ armed: false, why: 'notNewest' })
  await newest.runtime.close(); await old.runtime.close()
})

test('a legacy row plus a session id stays newest-only until that conversation chooses for itself', async () => {
  const shared: Shared = { data: new Map() }
  shared.data.set('more', { warm: true })
  const a = session({ id: 'a', shared, newest: false })
  expect(await arm(a)).toEqual({ armed: false, why: 'notNewest' })
  // The newest conversation still holds the legacy row, and the others see it as one more on.
  const newest = session({ id: 'n', shared })
  expect((await arm(newest)).armed).toBe(true)
  expect(a.runtime.othersOn()).toBe(1)
  // a's own choice retires the shared row for good and writes a's own row.
  await a.runtime.setEnabled(false)
  expect(JSON.parse(JSON.stringify(shared.data.get('more')))).toEqual({ warm: false })
  await newest.runtime.syncEnabled()
  expect((await arm(newest)).armed).toBe(false)
  await a.runtime.close(); await newest.runtime.close()
})

test('the day accounting is one row per conversation and the totals add them up', async () => {
  const shared: Shared = { data: new Map() }
  const a = session({ id: 'a', shared })
  const b = session({ id: 'b', shared })
  await a.runtime.setEnabled(true)
  await b.runtime.setEnabled(true)
  await arm(a); await arm(b)
  for (const s of [a, b]) {
    s.clock.advance(300000 - 60000 + 1)
    await flush()
    await s.runtime.turnStarted('other')
  }
  await flush()
  expect(shared.data.has('warm.day.a')).toBe(true)
  expect(shared.data.has('warm.day.b')).toBe(true)
  const totals = await a.runtime.dayTotals()
  expect(totals.any).toBe(true)
  expect(totals.pings).toBe(2)
  expect(totals.pauses).toBe(0)
  // A legacy row from an earlier version still counts for its own day.
  const written = shared.data.get('warm.day.a') as { date: string }
  shared.data.set('warm.today', { date: written.date, pauses: 1, pings: 0, usd: 0, saved: 0 })
  const withLegacy = await a.runtime.dayTotals()
  expect(withLegacy.pauses).toBe(1)
  expect(withLegacy.pings).toBe(2)
  await a.runtime.close(); await b.runtime.close()
})

test('an off conversation with no switch anywhere still writes nothing at all', async () => {
  const shared: Shared = { data: new Map() }
  const a = session({ id: 'a', shared })
  for (let turn = 0; turn < 5; turn++) {
    await a.runtime.turnStarted('composer')
    expect(await a.runtime.arm(armInput({ sentAt: a.clock.now() }))).toEqual({ armed: false, why: 'off' })
    a.clock.advance(7200000)
  }
  expect(a.calls()).toBe(0)
  expect([...shared.data.keys()]).toEqual([])
  await a.runtime.close()
})

// Review MC1: with a session id, every per-session choice and the turn-all-off retire the shared
// row to a stored false, which is what M1's save adopts; an absent row would let that save write
// the old value back on and switch other chats on.
test('per-session choices and turn-all-off always leave the shared row a stored false', async () => {
  const shared: Shared = { data: new Map() }
  const a = session({ id: 'a', shared, newest: false })
  await a.runtime.setEnabled(true)
  expect(JSON.parse(JSON.stringify(shared.data.get('more')))).toEqual({ warm: false })
  await a.runtime.allOff()
  expect(JSON.parse(JSON.stringify(shared.data.get('more')))).toEqual({ warm: false })
  expect(JSON.parse(JSON.stringify(shared.data.get('warm.sessions')))).toEqual({ offAllAt: expect.any(Number), on: {} })
  await a.runtime.close()
})
