import { describe, expect, test } from 'claude-code/testing'
import type { PresenceIO, PresenceSnapshot } from '../hooks/presence'
import { SharedPresence, parsePresence, reducePresence } from '../hooks/presence'
import { MORNING } from './world'
import { snapshot } from './presence-world'
import { transportFixture } from './presence-transport-fixture'

const drain = async () => { for (let i = 0; i < 400; i++) await Promise.resolve() }
function controllers(initial: PresenceSnapshot) {
  const transport = transportFixture(initial), calls: string[] = [], seen: PresenceSnapshot[][] = [[], []], errors: unknown[] = []
  const create = (index: number) => new SharedPresence({
    now: async () => { calls.push('now'); return MORNING },
    read: async path => { calls.push('read'); return transport.read(path) },
    write: async () => { throw new Error('unsafe SDK presence write') },
    run: async (argv, text) => { calls.push('write'); if (argv[3] !== 'write' || text === undefined) throw new Error('bad secure write command'); await transport.write(argv[5]!, text); return { stdout: '', code: 0 } },
    spawn: argv => { calls.push('spawn'); return transport.spawn(`session-${index}`, argv) },
    after: () => { calls.push('after'); return () => {} },
  } as PresenceIO, `session-${index}`, '/tmp/b1-presence', '/plugin/bin/presence.sh',
  { changed: state => { seen[index]!.push(state) }, error: error => errors.push(error) }, undefined, () => 'zh')
  return { transport, calls, seen, errors, a: create(0), b: create(1) }
}

const sleeping = () => ({ ...snapshot('sleep', MORNING - 1000, 12), claims: {} })
const touches = ['poke', 'pat', 'burst', 'hug', 'drag'] as const
const touch = (kind: typeof touches[number], by: 'band' | 'companion' = 'band') => ({
  kind: 'touch', id: `touch:${by}:${MORNING}`, at: MORNING, by, touch: kind, lang: 'zh',
  ...(by === 'band' ? { session: 'touched-session' } : {}),
})

describe('native-v2 touch contract', () => {
  test('all touch types parse beside the preserved sleep and wake events', () => {
    for (const kind of touches) for (const by of ['band', 'companion'] as const) {
      const event = touch(kind, by)
      const state = { ...sleeping(), asleep: false, event, touchEvent: event,
        wakeEvent: { kind: 'wake', id: `wake:0:${MORNING - 1000}`, at: MORNING, lang: 'zh' } }
      const parsed = parsePresence(JSON.stringify(state)) as any
      expect(parsed?.touchEvent).toEqual(event)
      expect(parsed?.wakeEvent?.at).toBe(MORNING)
      expect(parsed?.sleepEvent?.at).toBe(MORNING - 1000)
    }
  })
  test('every sleeping touch wakes once with the original event time and retains routing', () => {
    for (const kind of touches) for (const by of ['band', 'companion'] as const) {
      const event = touch(kind, by)
      const before = sleeping()
      const reduce = (previous: any) => (reducePresence as any)(previous, 'touch', 'observer', MORNING + 800, false,
        1, 'reader', new Map(), 'owner', 'en', undefined, undefined, undefined, { touch: event })
      const after = reduce(before)
      expect(after.asleep).toBe(false)
      expect(after.wakeEvent?.at).toBe(MORNING)
      expect(after.event).toEqual(event)
      expect(after.touchEvent).toEqual(event)
      expect(after.sleepEvent).toEqual(before.sleepEvent)
      expect(after.quietAt).toBe(MORNING)
      const duplicate = reduce(after)
      expect(duplicate.seq).toBe(after.seq)
      expect(duplicate.wakeEvent).toEqual(after.wakeEvent)
    }
  })

  test('bootstrap seeds missing settings without speech; durable values and future keys win', () => {
    const prior = { ...sleeping(), settings: { voice: 'off', companionTarget: 'vscode', neighbours: false, future: { enabled: true } } }
    const initial = { voice: 'full', band: 'compact', marks: false }
    const after = (reducePresence as any)(prior, 'bootstrap', 'new-session', MORNING, false,
      1, 'reader', new Map(), 'owner', 'en', undefined, undefined, undefined, { settings: initial, initial: true })
    expect(after.settings).toEqual({ ...initial, ...prior.settings })
    expect(after.event).toEqual(prior.event)
    expect(after.settingsEvent).toBeUndefined()
    const parsed = parsePresence(JSON.stringify(after)) as any
    expect(parsed?.settings).toEqual(after.settings)
  })
  test('a setting patch wakes a sleeping session in the new mode and never drops unrelated values', () => {
    const prior = { ...sleeping(), settings: { voice: 'light', companionTarget: 'mobile', neighbours: true, future: ['value', 2] } }
    const patch = { voice: 'full', affection: 'clingy' }
    const after = (reducePresence as any)(prior, 'settings', 'settings-session', MORNING + 800, false,
      1, 'reader', new Map(), 'owner', 'en', undefined, undefined, undefined, { settings: patch, at: MORNING })
    expect(after.settings).toEqual({ ...prior.settings, ...patch })
    expect(after.settingsEvent?.changes).toEqual(patch)
    expect(after.settingsEvent?.at).toBe(MORNING)
    expect(after.event.kind).toBe('settings')
    expect(after.asleep).toBe(false)
    expect(after.wakeEvent?.at).toBe(MORNING)
    const again = (reducePresence as any)(after, 'settings', 'settings-session', MORNING + 800, false,
      1, 'reader', new Map(), 'owner', 'en', undefined, undefined, undefined, { settings: patch, at: MORNING + 10 })
    expect(again.seq).toBe(after.seq)
    const parsed = parsePresence(JSON.stringify(after)) as any
    expect(parsed?.settingsEvent).toEqual(after.settingsEvent)
  })

  test('snapshot preload delivers asleep state and settings with one read and no native startup', async () => {
    const initial = { ...sleeping(), settings: { voice: 'full', band: 'compact' } }
    const f = controllers(initial)
    const preloaded = await (f.a as any).peek()
    expect(preloaded.asleep).toBe(true)
    expect(preloaded.settings).toEqual(initial.settings)
    expect(f.calls).toEqual(['read'])
    expect(f.a.isRunning).toBe(false)
    expect(f.seen[0]).toEqual([])
  })
  test('local sleeping touch reacts on the same stack before any clock, read, spawn, write or timer', async () => {
    for (const kind of touches) {
      const f = controllers(sleeping())
      await Promise.all([f.a.start(), f.b.start()]); await drain()
      const release = f.transport.holdWrites(), before = f.calls.length, remoteBefore = f.seen[1]!.length
      const pending = (f.a as any).touch(kind, MORNING)
      expect(f.a.current?.asleep).toBe(false)
      expect((f.a.current as any)?.touchEvent?.touch).toBe(kind)
      expect(f.a.current?.wakeEvent?.at).toBe(MORNING)
      expect(f.seen[0]!.at(-1)?.asleep).toBe(false)
      expect(f.calls.length).toBe(before)
      expect(f.b.current?.asleep).toBe(true)
      release(); await pending; await drain()
      expect(f.b.current?.asleep).toBe(false)
      expect((f.b.current as any)?.touchEvent?.session).toBe('session-0')
      expect(f.b.current?.wakeEvent).toEqual(f.a.current?.wakeEvent)
      expect(f.seen[1]!.length).toBe(remoteBefore + 1)
      f.a.stop(); f.b.stop(); await drain()
      expect(f.errors).toEqual([])
    }
  })
  test('cross-process settings reach every session, preserve future keys, and do not echo', async () => {
    const f = controllers({ ...sleeping(), settings: { voice: 'off', neighbours: true } } as any)
    await Promise.all([(f.a as any).start(false, { voice: 'light', companionTarget: 'desktop', marks: true }), f.b.start()]); await drain()
    const remoteBefore = f.seen[1]!.length, before = f.calls.length
    const pending = (f.a as any).settings({ voice: 'full', affection: 'clingy' }, MORNING)
    expect((f.a.current as any)?.settings.voice).toBe('full')
    expect(f.a.current?.asleep).toBe(false)
    expect(f.calls.length).toBe(before)
    await pending; await drain()
    expect((f.b.current as any)?.settings).toEqual({ voice: 'full', affection: 'clingy', neighbours: true, companionTarget: 'desktop', marks: true })
    expect((f.b.current as any)?.settingsEvent).toEqual((f.a.current as any)?.settingsEvent)
    expect(f.seen[1]!.length).toBe(remoteBefore + 1)
    await (f.b as any).settings({ voice: 'full', affection: 'clingy' }, MORNING + 1); await drain()
    expect(f.seen[1]!.length).toBe(remoteBefore + 1)
    f.a.stop(); f.b.stop(); await drain()
    expect(f.errors).toEqual([])
  })

  test('durable echoes never roll a rapid local touch or setting back to the earlier one', async () => {
    const f = controllers(sleeping())
    await f.a.start(); await drain()
    const release = f.transport.holdWrites()
    const first = (f.a as any).touch('poke', MORNING), next = (f.a as any).touch('pat', MORNING + 1)
    const seenBefore = f.seen[0]!.length
    release(); await Promise.all([first, next]); await drain()
    const events = f.seen[0]!.slice(seenBefore).map(state => (state as any).touchEvent?.touch)
    expect(events).not.toContain('poke')
    const releaseSettings = f.transport.holdWrites()
    const full = (f.a as any).settings({ voice: 'full' }, MORNING + 2), off = (f.a as any).settings({ voice: 'off' }, MORNING + 3)
    const settingsBefore = f.seen[0]!.length
    releaseSettings(); await Promise.all([full, off]); await drain()
    const voices = f.seen[0]!.slice(settingsBefore).map(state => (state as any).settings?.voice)
    expect(voices).not.toContain('full')
    expect((f.a.current as any)?.settings?.voice).toBe('off')
    f.a.stop(); await drain()
    expect(f.errors).toEqual([])
  })

  test('a touch on the fast first frame wakes locally and waits safely for detached native setup', async () => {
    const f = controllers(sleeping())
    await (f.a as any).peek()
    const before = f.calls.length
    const pending = (f.a as any).touch('poke', MORNING)
    expect(f.a.current?.asleep).toBe(false)
    expect((f.a.current as any)?.touchEvent?.touch).toBe('poke')
    expect(f.seen[0]!.at(-1)?.asleep).toBe(false)
    expect(f.calls.length).toBe(before)
    await drain()
    expect(f.calls.length).toBe(before)
    await f.a.start(); await pending; await drain()
    expect(f.transport.state.asleep).toBe(false)
    expect(f.transport.state.touchEvent?.touch).toBe('poke')
    f.a.stop(); await drain()
    expect(f.errors).toEqual([])
  })

  test('touch parsing rejects lookalike IDs, invalid source, non-string touch and invalid language', () => {
    const good = touch('poke')
    for (const event of [
      { ...good, id: `touch:companion:${MORNING}` }, { ...good, by: 'unknown' },
      { ...good, touch: ['poke'] }, { ...good, touch: 'drop' }, { ...good, lang: 'unknown' },
      { ...good, session: 42 }, { ...good, at: -1 },
    ]) expect(parsePresence(JSON.stringify({ ...sleeping(), event, touchEvent: event }))).toBeUndefined()
  })

  test('a supplied activity timestamp wakes on the same stack so render suppression survives the callback', async () => {
    const f = controllers(sleeping())
    await f.a.start(); await drain()
    const before = f.calls.length
    const pending = (f.a as any).activity(false, MORNING)
    try {
      expect(f.a.current?.asleep).toBe(false)
      expect(f.a.current?.wakeEvent?.at).toBe(MORNING)
      expect(f.seen[0]!.at(-1)?.asleep).toBe(false)
      expect(f.calls.length).toBe(before)
    } finally { await pending; f.a.stop(); await drain() }
    expect(f.errors).toEqual([])
  })

  test('supplied first-render activity wakes a preloaded inactive snapshot and survives native startup', async () => {
    const f = controllers(sleeping())
    await f.a.peek()
    const before = f.calls.length
    const pending = (f.a as any).activity(true, MORNING)
    expect(f.a.current?.asleep).toBe(false)
    expect(f.a.current?.busy).toBe(true)
    expect(f.a.current?.wakeEvent?.at).toBe(MORNING)
    expect(f.seen[0]!.at(-1)?.asleep).toBe(false)
    expect(f.calls.length).toBe(before)
    await drain()
    expect(f.calls.length).toBe(before)
    await f.a.start(true); await pending; await drain()
    expect(f.transport.state.asleep).toBe(false)
    expect(f.transport.state.busy).toBe(true)
    expect(f.seen[0]!.every(state => !state.asleep)).toBe(true)
    f.a.stop(); await drain()
    expect(f.errors).toEqual([])
  })

})
