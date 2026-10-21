import { expect, test } from 'bun:test'
import { createLockReader, createWarmRuntime } from '../../../plugin/hooks/cost/warm-runtime'
import { FakeClock, armInput, flush, okUsage, OPUS, usd } from './helpers'

function setup(options: { enabled?: boolean; machine?: string; kind?: string; lock?: 'none' | 'locked' | 'unlocked' } = {}) {
  const clock = new FakeClock()
  const data = new Map<string, unknown>()
  if (options.enabled) data.set('more', { warm: true })
  let calls = 0; let lockCalls = 0; let newest = true
  const runtime = createWarmRuntime({
    clock, store: { get: async key => data.get(key), set: async (key, value) => { data.set(key, value) } },
    fork: async prompt => { expect(prompt).toBe('Reply with the single word: ok'); calls++; return { ok: true, usage: okUsage() } },
    isNewest: () => newest, readLock: async () => { lockCalls++; return options.lock ?? 'unlocked' },
    windowPercent: () => null, billingKind: () => options.kind ?? 'plan', computerId: options.machine ?? `runtime-${Math.random()}`,
  })
  return { clock, data, runtime, calls: () => calls, lockCalls: () => lockCalls, other: () => { newest = false } }
}

test('W1 internal default-off 100-turn replay has zero fork, timer, lock, or warm state writes', async () => {
  const s = setup()
  for (let turn = 0; turn < 100; turn++) {
    await s.runtime.turnStarted('composer')
    expect(await s.runtime.arm(armInput({ sentAt: s.clock.now() }))).toEqual({ armed: false, why: 'off' })
    s.clock.advance(7200000)
  }
  expect(s.calls()).toBe(0); expect(s.lockCalls()).toBe(0)
  expect(s.clock.pending()).toBe(0); expect(s.runtime.status()).toBeNull()
  expect([...s.data.keys()]).toEqual([])
})

test('off and ineligible pauses write no state and do no warm work', async () => {
  const off = setup()
  await off.runtime.arm(armInput()); off.clock.advance(61000)
  await off.runtime.turnStarted('composer')
  await off.runtime.arm(armInput()); off.clock.advance(62000); await off.runtime.close()
  expect([...off.data.keys()]).toEqual([])
  expect(off.calls()).toBe(0); expect(off.clock.pending()).toBe(0); expect(off.lockCalls()).toBe(0)
  const small = setup({ enabled: true })
  expect((await small.runtime.arm(armInput({ prefix: 0 }))).armed).toBe(false)
  small.clock.advance(60000); await small.runtime.turnStarted('composer')
  expect([...small.data.keys()]).toEqual(['more'])
  expect(small.calls()).toBe(0); expect(small.clock.pending()).toBe(0)
})

test('late paid usage reconciles the savings of its closed pause once', async () => {
  const clock = new FakeClock(), data = new Map<string, unknown>([['more', { warm: true }]])
  let finish: ((v: { ok: false; usage: ReturnType<typeof okUsage> }) => void) | undefined
  const runtime = createWarmRuntime({
    clock, computerId: `late-${Math.random()}`, billingKind: () => 'api',
    store: { get: key => data.get(key), set: (key, value) => { data.set(key, value) } },
    isNewest: () => true, readLock: async () => 'unlocked', windowPercent: () => null,
    fork: () => new Promise(resolve => { finish = resolve }),
  })
  await runtime.arm(armInput()); clock.advance(240000); await flush()
  await runtime.turnStarted('composer'); await runtime.firstReply(120000, false)
  const paid = usd(okUsage(), OPUS, '5m')
  finish?.({ ok: false, usage: okUsage() }); await flush(); await runtime.flush()
  expect(data.get('warm.today')).toMatchObject({ pings: 1, usd: paid, pauses: 1, saved: -paid })
  expect(clock.pending()).toBe(0)
  clock.advance(1000); await runtime.arm(armInput({ sentAt: clock.now() }))
  clock.advance(240000); await flush(); await runtime.turnStarted('composer'); await runtime.firstReply(0, false)
  finish?.({ ok: false, usage: okUsage() }); await flush(); await runtime.flush()
  expect(data.get('warm.today')).toMatchObject({ pings: 2, usd: 2 * paid, saved: -2 * paid })
  await runtime.close()
})

test('a fee after cancellation updates the later return verdict once', async () => {
  const clock = new FakeClock(), data = new Map<string, unknown>([['more', { warm: true }]])
  let finish: ((v: { ok: false; usage: ReturnType<typeof okUsage> }) => void) | undefined
  const runtime = createWarmRuntime({
    clock, computerId: `late-cancel-${Math.random()}`, billingKind: () => 'api',
    store: { get: key => data.get(key), set: (key, value) => { data.set(key, value) } },
    isNewest: () => true, readLock: async () => 'unlocked', windowPercent: () => null,
    fork: () => new Promise(resolve => { finish = resolve }),
  })
  await runtime.arm(armInput()); clock.advance(240000); await flush()
  await runtime.setEnabled(false); await runtime.flush()
  finish?.({ ok: false, usage: okUsage() }); await flush(); await runtime.flush()
  const paid = usd(okUsage(), OPUS, '5m')
  await runtime.turnStarted('composer')
  expect((await runtime.firstReply(0, false))?.savedUsd).toBe(-paid)
  expect(data.get('warm.today')).toMatchObject({ pings: 1, pauses: 1, usd: paid, saved: -paid })
  expect(clock.pending()).toBe(0)
  await runtime.close()
})

test('paid unsuccessful usage persists in exact warm state, stops with the error reason and does not renew', async () => {
  const clock = new FakeClock(), data = new Map<string, unknown>([['more', { warm: true }]])
  const usage = okUsage(), paid = usd(usage, OPUS, '5m')
  const runtime = createWarmRuntime({
    clock, computerId: `paid-error-${Math.random()}`, billingKind: () => 'api',
    store: { get: key => data.get(key), set: (key, value) => { data.set(key, value) } },
    isNewest: () => true, readLock: async () => 'unlocked', windowPercent: () => null,
    fork: async () => ({ ok: false, usage }),
  })
  await runtime.arm(armInput()); clock.advance(240000); await flush(); await runtime.flush()
  expect(data.get('warm.today')).toMatchObject({ pings: 1, usd: paid, saved: 0 })
  expect(runtime.status()).toMatchObject({ reason: 'error', warmUntil: 300000, nextAt: null })
  expect(clock.pending()).toBe(0)
  clock.advance(120000); await runtime.turnStarted('composer')
  expect((await runtime.firstReply(0, false))?.savedUsd).toBe(-paid)
  expect(runtime.disabledReason()).toBeNull()
  await runtime.close()
})

test('runtime persists only exact section9 shapes, records measured savings and a return', async () => {
  const s = setup({ enabled: true })
  expect((await s.runtime.arm(armInput())).armed).toBe(true)
  expect(s.clock.pending()).toBe(1)
  s.clock.advance(240000); await flush(); await s.runtime.flush()
  expect(s.calls()).toBe(1)
  expect(s.clock.pending()).toBe(1)
  s.clock.advance(120000)
  const pause = await s.runtime.turnStarted('composer')
  expect(pause?.announce).toBe(true)
  const verdict = await s.runtime.firstReply(120000, false)
  expect(verdict?.warmOnReturn).toBe(true)
  expect(verdict?.savedUsd).toBeCloseTo(.576 - .02712, 8)
  expect(Object.keys(s.data.get('warm.today') as object).sort()).toEqual(['date', 'pauses', 'pings', 'saved', 'usd'])
  expect([...s.data.keys()].sort()).toEqual(['more', 'warm.today'])
  expect(s.clock.pending()).toBe(0)
})

test('W7 settings and newest claims are refreshed at every callback', async () => {
  const s = setup({ enabled: true })
  await s.runtime.arm(armInput())
  s.other(); s.clock.advance(240000); await flush()
  expect(s.calls()).toBe(0); expect(s.runtime.status()?.reason).toBe('other')
  const off = setup({ enabled: true })
  await off.runtime.arm(armInput())
  off.data.set('more', { warm: false }); off.clock.advance(240000); await flush()
  expect(off.calls()).toBe(0); expect(off.runtime.status()?.reason).toBe('off')
})

test('W7 cold return disables the computer billing kind until an explicit toggle', async () => {
  const machine = `hold-${Math.random()}`
  const s = setup({ enabled: true, machine })
  await s.runtime.arm(armInput()); s.clock.advance(240000); await flush()
  s.clock.advance(120000); await s.runtime.turnStarted('bridge')
  expect((await s.runtime.firstReply(0, false))?.notHeld).toBe(true)
  expect(s.runtime.disabledReason()).toBe('notHeld')
  const same = setup({ enabled: true, machine })
  expect(await same.runtime.arm(armInput())).toEqual({ armed: false, why: 'heldOff' })
  const api = setup({ enabled: true, machine, kind: 'api' })
  expect((await api.runtime.arm(armInput())).armed).toBe(true)
  await api.runtime.close()
  await same.runtime.setEnabled(true)
  expect((await same.runtime.arm(armInput())).armed).toBe(true)
  await same.runtime.close()
})

test('close cancels the timer and leaves no pause history behind', async () => {
  const s = setup({ enabled: true })
  await s.runtime.arm(armInput()); s.clock.advance(61000); await s.runtime.close()
  expect([...s.data.keys()]).toEqual(['more'])
  expect(s.clock.pending()).toBe(0)
})

test('no lock signal limits the engine to 30 minutes', async () => {
  const s = setup({ enabled: true, lock: 'none' })
  await s.runtime.arm(armInput({ ttl: '1h' }))
  s.clock.advance(3360000); await flush()
  expect(s.calls()).toBe(0); expect(s.runtime.status()?.reason).toBe('cap')
})

test('fresh companion beats subprocess; stale companion uses exact terminal command; absent Windows signal is none', async () => {
  const commands: string[][] = []
  let away: { state: 'locked' | null; since: number } | null = { state: 'locked', since: 1 }
  const reader = createLockReader({ now: () => 600000, platform: 'darwin', terminal: true, away: async () => away, run: async argv => { commands.push(argv); return '"IOConsoleLocked" = No' } })
  expect(await reader()).toBe('locked'); expect(commands).toEqual([])
  away = { state: 'locked', since: 0 }
  expect(await reader()).toBe('unlocked')
  expect(commands).toEqual([['/usr/sbin/ioreg', '-n', 'Root', '-d1']])
  expect(await createLockReader({ now: () => 1, platform: 'win32', terminal: true, away: () => null, run: async () => { throw Error('must not run') } })()).toBe('none')
})

test('Linux fallback uses the authorized session identifier and lock flag only', async () => {
  const commands: string[][] = []
  const reader = createLockReader({ now: () => 10, platform: 'linux', terminal: true, linuxSessionId: 'session-4', away: () => null, run: async argv => { commands.push(argv); return 'yes\n' } })
  expect(await reader()).toBe('locked')
  expect(commands).toEqual([['loginctl', 'show-session', 'session-4', '-p', 'LockedHint', '--value']])
})

test('lock reader evaluates awaited companion flags against the settled clock', async () => {
  const boundaryClock = new FakeClock(599999), fallbackCalls: string[][] = []
  const boundary = createLockReader({ now: () => boundaryClock.now(), platform: 'darwin', terminal: true,
    away: async () => { await Promise.resolve(); boundaryClock.advance(1); return { state: null, since: 0 } },
    run: async argv => { fallbackCalls.push(argv); return '"IOConsoleLocked" = Yes' },
  })
  // At use-time the flag is exactly ten minutes old: the authorized fallback
  // must decide, even though the read began one millisecond before that edge.
  expect(await boundary()).toBe('locked')
  expect(fallbackCalls).toEqual([['/usr/sbin/ioreg', '-n', 'Root', '-d1']])
  const refreshedClock = new FakeClock(1000), futureFallbacks: string[][] = []
  const refreshed = createLockReader({ now: () => refreshedClock.now(), platform: 'darwin', terminal: true,
    away: async () => { await Promise.resolve(); refreshedClock.advance(1000); return { state: 'locked', since: 1500 } },
    run: async argv => { futureFallbacks.push(argv); return '"IOConsoleLocked" = No' },
  })
  // A flag created during the awaited read precedes the settled current clock.
  // It is fresh, rather than an invalid future timestamp.
  expect(await refreshed()).toBe('locked')
  expect(futureFallbacks).toEqual([])
})

test('W7 tied newest claims cannot overlap forks on one computer', async () => {
  const clock = new FakeClock()
  const machine = `concurrent-${Math.random()}`
  let calls = 0
  let finish: ((outcome: { ok: true; usage: ReturnType<typeof okUsage> }) => void) | undefined
  const factory = () => createWarmRuntime({
    clock, computerId: machine, billingKind: () => 'plan',
    store: { get: key => key === 'more' ? { warm: true } : undefined, set: () => {} },
    isNewest: () => true, readLock: async () => 'unlocked', windowPercent: () => null,
    fork: async () => { calls++; return await new Promise(resolve => { finish = resolve }) },
  })
  const a = factory(), b = factory()
  await a.arm(armInput()); await b.arm(armInput())
  clock.advance(240000); await flush()
  expect(calls).toBe(1)
  finish?.({ ok: true, usage: okUsage() }); await flush()
  await a.close(); await b.close()
})

test('a return while capability refresh is pending prevents a late arm', async () => {
  const clock = new FakeClock()
  let finish: ((value: boolean) => void) | undefined
  const runtime = createWarmRuntime({
    clock, computerId: `race-${Math.random()}`, billingKind: () => 'plan',
    store: { get: key => key === 'more' ? { warm: true } : undefined, set: () => {} },
    isNewest: () => new Promise(resolve => { finish = resolve }),
    readLock: async () => 'unlocked', windowPercent: () => null,
    fork: async () => { throw Error('must not run') },
  })
  const arming = runtime.arm(armInput())
  await flush()
  await runtime.turnStarted('composer')
  finish?.(true)
  expect((await arming).armed).toBe(false)
  expect(clock.pending()).toBe(0)
})

test('setting observation cancels immediately and never writes more recursively', async () => {
  const s = setup({ enabled: true })
  await s.runtime.arm(armInput())
  const more = { warm: false, turnCost: true }
  s.data.set('more', more)
  await s.runtime.syncEnabled()
  expect(s.data.get('more')).toBe(more)
  expect(s.clock.pending()).toBe(0)
  expect(s.runtime.status()?.reason).toBe('off')
})

test('reread observer sees the settled renewal and next schedule', async () => {
  const clock = new FakeClock()
  let observed: ReturnType<ReturnType<typeof createWarmRuntime>['status']>
  const runtime = createWarmRuntime({
    clock, computerId: `observer-${Math.random()}`, billingKind: () => 'plan',
    store: { get: key => key === 'more' ? { warm: true } : undefined, set: () => {} },
    isNewest: () => true, readLock: async () => 'unlocked', windowPercent: () => null,
    fork: async () => ({ ok: true, usage: okUsage() }), onReread: () => { observed = runtime.status() },
  })
  await runtime.arm(armInput()); clock.advance(240000); await flush()
  expect(observed?.nextAt).toBe(480000)
  expect(observed?.warmUntil).toBe(540000)
  expect(observed?.stopsBy).toBeGreaterThan(540000)
  await runtime.close()
})
