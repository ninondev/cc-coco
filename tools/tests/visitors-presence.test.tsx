// A visit in the shared presence record: it comes with the doze, once for every window, goes at the wake,
// and nothing else about the record changes (VISITORS.md 2.1, 2.3, 2.5).
import { describe, expect, test } from 'claude-code/testing'
import { parsePresence, parsePresenceRecord, reducePresence } from '../hooks/presence'
import { visitDay } from '../hooks/visitors'

const reduce = reducePresence as any
const T0 = Date.parse('2026-10-20T15:00:00Z')
const DEADLINES = { sleepAfter: 240_000, clingyAfter: 150_000 }
const alive = new Map([[44, { birth: 'darwin:44:1', parent: 1, uid: 501, executable: '/bin/reader', registeredOwner: 'a' }], [45, { birth: 'darwin:45:1', parent: 1, uid: 501, executable: '/bin/reader', registeredOwner: 'b' }]])
const due = { day: visitDay(T0, 'UTC'), kind: 'cursor', tz: 'UTC' }
const step = (previous: any, command: string, now: number, extra: { mutation?: any; metadata?: any; session?: string; pid?: number; owner?: string; busy?: boolean } = {}) =>
  reduce(previous, command, extra.session ?? 'one', now, extra.busy ?? false, extra.pid ?? 44, `darwin:${extra.pid ?? 44}:1`, alive, extra.owner ?? 'a', 'en', DEADLINES, undefined, undefined, extra.mutation, extra.metadata)
const started = (metadata: any = { visitorDue: due }) => step(undefined, 'bootstrap', T0, { metadata })

describe('a visit rides the doze that already happens', () => {
  test('a due visit waits in the record, and nothing visits while he is awake', () => {
    const state = started()
    expect(state.visitors).toEqual({ due })
    expect(state.visitors.visit).toBeUndefined()
    expect(state.asleep).toBe(false)
  })
  test('the doze brings it, with the sleep event, once', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    expect(slept.asleep).toBe(true)
    const sleepAt = slept.sleepEvent.at
    expect(sleepAt).toBe(T0 + 240_000)
    expect(slept.visitors.visit).toEqual({ id: `visit:${slept.seq}:${sleepAt}`, kind: 'cursor', at: sleepAt, first: true })
    expect(slept.visitors.due).toBeUndefined()
    expect(slept.visitors.last).toBe(due.day)
    expect(slept.visitors.kinds).toEqual({ cursor: due.day })
    const again = step(slept, 'decide', T0 + 400_000)
    expect(again.visitors.visit).toEqual(slept.visitors.visit)
  })
  test('only the very first visit is marked first: a record that has seen a kind before marks none, even for the same kind', () => {
    const first = step(started(), 'decide', T0 + 250_000)
    expect(first.visitors.visit.first).toBe(true)
    expect(parsePresenceRecord(JSON.stringify(first))?.visitors?.visit?.first).toBe(true)
    const again = step({ ...started(), visitors: { due, kinds: { cursor: '2026-10-01' } } }, 'decide', T0 + 250_000)
    expect(again.visitors.visit).toBeDefined()
    expect(again.visitors.visit.first).toBeUndefined()
  })
  test('the wake ends it at the wake time, and only once', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    const woke = step(slept, 'write', T0 + 900_000, { busy: true })
    expect(woke.asleep).toBe(false)
    expect(woke.visitors.visit.leftAt).toBe(woke.wakeEvent.at)
    const later = step(woke, 'write', T0 + 1_000_000, { busy: true })
    expect(later.visitors.visit.leftAt).toBe(woke.visitors.visit.leftAt)
  })
  test('a touch, a setting and any other wake end it too', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    const touch = { kind: 'touch', id: `touch:band:${T0 + 400_000}`, at: T0 + 400_000, by: 'band', touch: 'poke', lang: 'en', session: 'one' }
    const touched = step(slept, 'touch', T0 + 400_100, { mutation: { touch } })
    expect(touched.visitors.visit.leftAt).toBe(T0 + 400_000)
    const set = step(slept, 'settings', T0 + 500_000, { mutation: { settings: { voice: 'full' }, at: T0 + 500_000 } })
    expect(set.visitors.visit.leftAt).toBe(T0 + 500_000)
  })
})

describe('one visitor for every window, and the rules hold in the record', () => {
  test('two sessions that both hand in the same due bring one visit', () => {
    let state = started()
    state = step(state, 'bootstrap', T0 + 1000, { session: 'two', pid: 45, owner: 'b', metadata: { visitorDue: due } })
    expect(Object.keys(state.claims).length).toBe(2)
    const slept = step(state, 'decide', T0 + 260_000, { session: 'two', pid: 45, owner: 'b' })
    expect(slept.visitors.visit.kind).toBe('cursor')
    expect(Object.keys(slept.claims).length).toBe(2)
    const next = step(slept, 'write', T0 + 600_000, { busy: true, metadata: { visitorDue: due } })
    const sleptAgain = step(next, 'decide', T0 + 600_000 + 250_000)
    expect(sleptAgain.visitors.visit.id).toBe(slept.visitors.visit.id)
  })
  test('one a day: a second doze on the same day brings no second visit', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    const woke = step(slept, 'write', T0 + 900_000, { busy: false, metadata: { visitorDue: { ...due, kind: 'plane' } } })
    expect(woke.asleep).toBe(false)
    const second = step(woke, 'decide', T0 + 900_000 + 250_000 + 1)
    expect(second.asleep).toBe(true)
    expect(second.visitors.visit.id).toBe(slept.visitors.visit.id)
    expect(second.visitors.kinds).toEqual({ cursor: due.day })
  })
  test('a due for another day brings nobody', () => {
    const state = started({ visitorDue: { ...due, day: '2026-10-19' } })
    const slept = step(state, 'decide', T0 + 250_000)
    expect(slept.visitors.visit).toBeUndefined()
  })
  test('Visitors off means no visit, and the due waits', () => {
    const state = started()
    const off = step(state, 'settings', T0 + 10_000, { mutation: { settings: { visitors: false }, at: T0 + 10_000 } })
    const slept = step(off, 'decide', T0 + 10_000 + 250_000)
    expect(slept.asleep).toBe(true)
    expect(slept.visitors.visit).toBeUndefined()
    expect(slept.visitors.due).toEqual(due)
  })
  test('nothing about the work is in the record: a visit is a kind and two times', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    const woke = step(slept, 'write', T0 + 900_000, { busy: true })
    expect(Object.keys(woke.visitors.visit).sort()).toEqual(['at', 'first', 'id', 'kind', 'leftAt'])
    expect(Object.keys(woke.visitors).sort()).toEqual(['kinds', 'last', 'visit'])
    for (const claim of Object.values(woke.claims) as any[]) expect(claim.visitorDue).toBeUndefined()
  })
})

describe('the record carries it across reads and leaves the rest alone', () => {
  test('a read of the record gives the visit back, and a malformed one is dropped', () => {
    const slept = step(started(), 'decide', T0 + 250_000)
    const parsed = parsePresence(JSON.stringify(slept)) as any
    expect(parsed.visitors.visit).toEqual(slept.visitors.visit)
    expect(parsePresenceRecord(JSON.stringify(slept))?.visitors).toEqual(slept.visitors)
    const broken = parsePresence(JSON.stringify({ ...slept, visitors: { visit: { id: 'x', kind: 'owl' }, kinds: { owl: '2026-10-01' } } })) as any
    expect(broken.visitors).toBeUndefined()
  })
  test('without any due, the record has no visitor key at all', () => {
    const slept = step(step(undefined, 'bootstrap', T0, {}), 'decide', T0 + 250_000)
    expect('visitors' in slept).toBe(false)
  })
})
