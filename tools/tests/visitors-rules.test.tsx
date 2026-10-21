// The rules of the visitors (VISITORS.md 1.1, 2.1, 2.2 as the owner's 10-09 answers changed them): eight kinds,
// one day in three, no kind twice in seven days, one a day from 05:00 to 04:59, the usb from 21:30.
import { describe, expect, test } from 'claude-code/testing'
import {
  VISITOR_KINDS, VISITOR_BARS, daysBetween, decideDue, hash32, lateMs, newerDue, parseVisitState, qualifying, readVisits,
  toolCountKey, totalCounts, visitAtSleep, visitAtWake, visitDay, visitingDay, visitorFor, visitorsOn, withVisit, VisitCounter, mergeVisitState, rememberVisit,
} from '../hooks/visitors'
import type { VisitCounts, VisitState } from '../hooks/visitors'

const at = (iso: string) => Date.parse(iso)
const UTC = 'UTC'

describe('the eight kinds and what brings them', () => {
  test('eight kinds, in the table order, with no owl and no white-eyes', () => {
    expect([...VISITOR_KINDS]).toEqual(['plane', 'bulb', 'leaf', 'snowman', 'usb', 'note', 'ghost', 'keycap', 'cursor'])
  })
  test('the decided thresholds', () => {
    expect(VISITOR_BARS).toEqual({
      plane: { key: 'slow', n: 3 }, bulb: { key: 'green', n: 2 }, leaf: { key: 'long', n: 1_200_000 }, snowman: { key: 'long', n: 1_200_000 }, usb: { key: 'late', n: 1_200_000 },
      note: { key: 'done', n: 10 }, ghost: { key: 'web', n: 15 }, keycap: { key: 'edit', n: 40 }, cursor: { key: 'run', n: 60 },
    })
  })
  test('each kind comes at its bar and not one short of it', () => {
    for (const kind of VISITOR_KINDS) {
      const { key, n } = VISITOR_BARS[kind]
      expect(qualifying({ [key]: n })).toContain(kind)
      expect(qualifying({ [key]: n - 1 })).not.toContain(kind)
    }
  })
  test('tool calls count by category, and an unknown tool counts for nothing', () => {
    expect(['Bash', 'Monitor', 'TaskStop', 'PowerShell'].map(toolCountKey)).toEqual(['run', 'run', 'run', 'run'])
    expect(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].map(toolCountKey)).toEqual(['edit', 'edit', 'edit', 'edit'])
    expect(['WebFetch', 'WebSearch'].map(toolCountKey)).toEqual(['web', 'web'])
    expect(['Read', 'Glob', 'Grep', 'Agent', 'TodoWrite'].map(toolCountKey)).toEqual([undefined, undefined, undefined, undefined, undefined])
  })
  test('sessions add up, except the longest task, which is the longest of all', () => {
    const total = totalCounts([{ run: 30, slow: 1, long: 600_000, late: 100 }, { run: 31, slow: 2, long: 1_300_000, late: 50 }, {}])
    expect(total).toMatchObject({ run: 61, slow: 3, long: 1_300_000, late: 150 })
  })
})

describe('the day runs from 05:00 to 04:59', () => {
  test('04:59 and 05:01 are different days, and 05:00 starts the new one', () => {
    expect(visitDay(at('2026-10-05T04:59:00Z'), UTC)).toBe('2026-10-04')
    expect(visitDay(at('2026-10-05T05:00:00Z'), UTC)).toBe('2026-10-05')
    expect(visitDay(at('2026-10-05T05:01:00Z'), UTC)).toBe('2026-10-05')
  })
  test('the boundary follows local time and survives the clocks changing', () => {
    expect(visitDay(at('2026-10-05T11:59:00Z'), 'America/Los_Angeles')).toBe('2026-10-04')
    expect(visitDay(at('2026-10-05T12:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-05')
    // New York falls back on 2026-11-01 at 02:00; 04:59 local is still the day before, 05:00 local starts it.
    expect(visitDay(at('2026-11-01T09:59:00Z'), 'America/New_York')).toBe('2026-10-31')
    expect(visitDay(at('2026-11-01T10:00:00Z'), 'America/New_York')).toBe('2026-11-01')
  })
  test('a month and a year roll over', () => {
    expect(visitDay(at('2027-01-01T03:00:00Z'), UTC)).toBe('2026-12-31')
    expect(visitDay(Number.NaN)).toBe('')
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('the usb counts 21:30 to 04:59', () => {
  const min = 60_000
  test('a turn wholly inside the hours counts in full', () => {
    expect(lateMs(at('2026-10-05T22:00:00Z'), at('2026-10-05T22:20:00Z'), UTC)).toBe(20 * min)
    expect(lateMs(at('2026-10-06T01:00:00Z'), at('2026-10-06T02:00:00Z'), UTC)).toBe(60 * min)
  })
  test('a turn crossing an edge counts only the part inside', () => {
    expect(lateMs(at('2026-10-05T21:00:00Z'), at('2026-10-05T22:00:00Z'), UTC)).toBe(30 * min)
    expect(lateMs(at('2026-10-06T04:30:00Z'), at('2026-10-06T06:00:00Z'), UTC)).toBe(30 * min)
  })
  test('daytime counts nothing, and so does a turn that ends before it starts', () => {
    expect(lateMs(at('2026-10-05T10:00:00Z'), at('2026-10-05T18:00:00Z'), UTC)).toBe(0)
    expect(lateMs(at('2026-10-05T22:20:00Z'), at('2026-10-05T22:00:00Z'), UTC)).toBe(0)
  })
  test('local time decides, not UTC', () => {
    expect(lateMs(at('2026-10-06T13:00:00Z'), at('2026-10-06T13:20:00Z'), 'America/Los_Angeles')).toBe(0)
    expect(lateMs(at('2026-10-06T05:00:00Z'), at('2026-10-06T05:20:00Z'), 'Asia/Tokyo')).toBe(0)
    expect(lateMs(at('2026-10-06T05:00:00Z'), at('2026-10-06T05:20:00Z'), 'America/Los_Angeles')).toBe(20 * min)
    expect(lateMs(at('2026-10-06T13:00:00Z'), at('2026-10-06T13:20:00Z'), 'Asia/Tokyo')).toBe(20 * min)
  })
  test('twenty minutes of it brings the usb, nineteen do not', () => {
    expect(qualifying({ late: lateMs(at('2026-10-05T21:30:00Z'), at('2026-10-05T21:50:00Z'), UTC) })).toEqual(['usb'])
    expect(qualifying({ late: lateMs(at('2026-10-05T21:30:00Z'), at('2026-10-05T21:49:00Z'), UTC) })).toEqual([])
  })
})

describe('which one comes', () => {
  const rich: VisitCounts = { slow: 3, green: 2, long: 1_200_000, late: 1_200_000, done: 10, web: 15, edit: 40, run: 60 }
  test('never seen counts as longest away, and ties go in table order', () => {
    expect(visitorFor(rich, undefined, '2026-10-20')).toBe('plane')
    expect(visitorFor({ edit: 40, run: 60 }, undefined, '2026-10-20')).toBe('keycap')
  })
  test('the one away longest wins', () => {
    expect(visitorFor(rich, { plane: '2026-10-10', bulb: '2026-10-11', leaf: '2026-10-09', usb: '2026-10-12', note: '2026-10-12', ghost: '2026-10-12', keycap: '2026-10-12', cursor: '2026-10-12' }, '2026-10-20')).toBe('leaf')
  })
  test('no kind comes twice in seven days, and on the seventh day after it may', () => {
    expect(visitorFor({ run: 60 }, { cursor: '2026-10-14' }, '2026-10-20')).toBeUndefined()
    expect(visitorFor({ run: 60 }, { cursor: '2026-10-14' }, '2026-10-21')).toBe('cursor')
    expect(visitorFor({ run: 60, edit: 40 }, { keycap: '2026-10-19' }, '2026-10-20')).toBe('cursor')
  })
})

describe('the rules that decide a due visit', () => {
  const counts: VisitCounts = { run: 60 }
  const base = { on: true, now: at('2026-10-20T15:00:00Z'), tz: UTC, seed: 12345, counts }
  const dayOf = (seed: number, from: number, wanted: boolean) => {
    for (let i = 0; i < 60; i++) { const day = visitDay(from + i * 86_400_000, UTC); if (visitingDay(seed, day) === wanted) return from + i * 86_400_000 }
    throw new Error('no such day')
  }
  test('off means nothing is due, and no work means nothing is due', () => {
    expect(decideDue({ ...base, on: false })).toBeUndefined()
    expect(decideDue({ ...base, counts: { run: 59 } })).toBeUndefined()
  })
  test('the first visit ever skips the coin; the day you first met him does not count', () => {
    const quiet = dayOf(base.seed, base.now, false)
    expect(decideDue({ ...base, now: quiet })?.kind).toBe('cursor')
    expect(decideDue({ ...base, now: quiet, firstMet: quiet - 3_600_000 })).toBeUndefined()
    expect(decideDue({ ...base, now: quiet, firstMet: quiet - 86_400_000 * 2 })?.kind).toBe('cursor')
  })
  test('after the first, only a visiting day brings one', () => {
    const state: VisitState = { kinds: { plane: '2026-01-01' }, last: '2026-01-01' }
    const yes = dayOf(base.seed, base.now, true), no = dayOf(base.seed, base.now, false)
    expect(decideDue({ ...base, now: yes, state })?.kind).toBe('cursor')
    expect(decideDue({ ...base, now: no, state })).toBeUndefined()
  })
  test('one a day: a day that already had its visitor brings no second', () => {
    const yes = dayOf(base.seed, base.now, true)
    expect(decideDue({ ...base, now: yes, state: { kinds: { plane: '2026-01-01' }, last: visitDay(yes, UTC) } })).toBeUndefined()
  })
  test('a doze at 04:59 and one at 05:01 are different days for it', () => {
    const state: VisitState = { kinds: { plane: '2026-01-01' }, last: '2026-10-19' }
    const night = at('2026-10-20T04:59:00Z'), morning = at('2026-10-20T05:01:00Z')
    expect(visitDay(night, UTC)).toBe('2026-10-19')
    expect(decideDue({ ...base, now: night, state })).toBeUndefined()
    const seeded = { ...base, seed: 7 }
    const day = visitDay(morning, UTC)
    expect(decideDue({ ...seeded, now: morning, state })?.day === day || !visitingDay(7, day)).toBe(true)
  })
  test('visiting days are one in three, and the same in every session', () => {
    let hits = 0
    for (let i = 0; i < 10_000; i++) if (visitingDay(1 + (i % 17) * 7919, visitDay(at('2024-01-01T12:00:00Z') + i * 86_400_000, UTC))) hits++
    expect(hits / 10_000).toBeGreaterThan(0.30)
    expect(hits / 10_000).toBeLessThan(0.37)
    expect(hash32(99, '2026-10-20')).toBe(hash32(99, '2026-10-20'))
    expect(visitingDay(99, '2026-10-20')).toBe(visitingDay(99, '2026-10-20'))
  })
})

describe('the visit itself, in the shared record', () => {
  const due = { day: '2026-10-20', kind: 'cursor' as const, tz: UTC }
  test('the doze brings the due visit, once', () => {
    const slept = visitAtSleep({ due }, at('2026-10-20T15:04:00Z'), 12, true)!
    expect(slept.visit).toEqual({ id: 'visit:12:' + at('2026-10-20T15:04:00Z'), kind: 'cursor', at: at('2026-10-20T15:04:00Z'), first: true })
    expect(slept.last).toBe('2026-10-20')
    expect(slept.kinds).toEqual({ cursor: '2026-10-20' })
    expect(slept.due).toBeUndefined()
    expect(visitAtSleep({ ...slept, due }, at('2026-10-20T18:00:00Z'), 20, true)!.visit).toEqual(slept.visit)
  })
  test('a due from another day, or with Visitors off, brings nobody', () => {
    expect(visitAtSleep({ due }, at('2026-10-21T15:00:00Z'), 3, true)!.visit).toBeUndefined()
    expect(visitAtSleep({ due }, at('2026-10-20T15:04:00Z'), 3, false)!.visit).toBeUndefined()
    expect(visitAtSleep(undefined, 1, 1, true)).toBeUndefined()
  })
  test('any wake ends the visit, once', () => {
    const slept = visitAtSleep({ due }, at('2026-10-20T15:04:00Z'), 12, true)!
    const woke = visitAtWake(slept, at('2026-10-20T15:30:00Z'))!
    expect(woke.visit!.leftAt).toBe(at('2026-10-20T15:30:00Z'))
    expect(visitAtWake(woke, at('2026-10-20T16:00:00Z'))!.visit!.leftAt).toBe(at('2026-10-20T15:30:00Z'))
    expect(visitAtWake(undefined, 5)).toBeUndefined()
  })
  test('the newest due is kept, and an older day never replaces a newer one', () => {
    expect(newerDue(undefined, due)).toEqual(due)
    expect(newerDue(due, { ...due, kind: 'plane' })).toEqual({ ...due, kind: 'plane' })
    expect(newerDue(due, { ...due, day: '2026-10-19', kind: 'plane' })).toEqual(due)
    expect(newerDue(due, undefined)).toEqual(due)
  })
  test('the record keeps only well-formed parts', () => {
    expect(parseVisitState({ due: { day: 'tomorrow', kind: 'plane' }, last: 5, kinds: { owl: '2026-10-01', plane: 'x' }, visit: { id: 'x' } })).toBeUndefined()
    expect(parseVisitState({ kinds: { plane: '2026-10-01', owl: '2026-10-02' } })).toEqual({ kinds: { plane: '2026-10-01' } })
    expect(parseVisitState({ visit: { id: 'visit:1:100', kind: 'owl', at: 100 } })).toBeUndefined()
  })
})

describe('the guest book', () => {
  test('a visit is a kind and two times, and nothing about the work', () => {
    const list = withVisit([], { id: 'visit:3:1000', kind: 'bulb', at: 1000, leftAt: 2000, ...({ path: '/secret', why: { n: 3 } } as object) } as never)
    expect(list).toEqual([{ id: 'visit:3:1000', kind: 'bulb', at: 1000, leftAt: 2000 }])
    expect(Object.keys(list[0]!).sort()).toEqual(['at', 'id', 'kind', 'leftAt'])
  })
  test('rows are read oldest first, a twice-written id counts once, and bad rows are skipped', () => {
    const rows = [{ id: 'visit:9:5000', kind: 'plane', at: 5000, leftAt: 6000 }, 'nope', { id: 'visit:1:1', kind: 'owl', at: 1 },
      { id: 'visit:2:1000', kind: 'leaf', at: 1000 }, { id: 'visit:2:1000', kind: 'leaf', at: 1000, leftAt: 1500 }]
    expect(readVisits(rows)).toEqual([{ id: 'visit:2:1000', kind: 'leaf', at: 1000, leftAt: 1500 }, { id: 'visit:9:5000', kind: 'plane', at: 5000, leftAt: 6000 }])
    expect(readVisits(undefined)).toEqual([])
    expect(readVisits('x')).toEqual([])
  })
  test('adding a visit that is there replaces it, and the book keeps the newest thousand', () => {
    const one = withVisit([], { id: 'visit:1:10', kind: 'plane', at: 10 })
    expect(withVisit(one, { id: 'visit:1:10', kind: 'plane', at: 10, leftAt: 20 })).toEqual([{ id: 'visit:1:10', kind: 'plane', at: 10, leftAt: 20 }])
    let list = one
    for (let i = 2; i < 1100; i++) list = withVisit(list, { id: `visit:${i}:${i * 10}`, kind: 'plane', at: i * 10 })
    expect(list.length).toBe(1000)
    expect(list[0]!.at).toBe(1000)
  })
  test('Visitors on is the default, and only an explicit off turns it off', () => {
    expect(visitorsOn({})).toBe(true)
    expect(visitorsOn({ visitors: true })).toBe(true)
    expect(visitorsOn({ visitors: 'on' })).toBe(true)
    expect(visitorsOn({ visitors: false })).toBe(false)
    expect(visitorsOn({ visitors: 'off' })).toBe(false)
  })
})

describe('one session counts its own day, and decides at a turn end', () => {
  const store = () => {
    const rows = new Map<string, unknown>()
    return { rows, get: async (key: string) => rows.get(key), set: async (key: string, value: unknown) => { rows.set(key, JSON.parse(JSON.stringify(value))) } }
  }
  const NOON = at('2026-10-20T12:00:00Z')
  const counter = (on = true) => new VisitCounter(() => on, () => UTC)
  test('tool calls count by category; denied and failed calls do not; a slow foreground command counts once more', async () => {
    const c = counter(), s = store()
    for (let i = 0; i < 60; i++) c.tool('Bash', NOON, NOON + 1000, {})
    c.tool('Bash', NOON, NOON + 61_000, {})
    c.tool('Bash', NOON, NOON + 61_000, { background: true })
    c.tool('Bash', NOON, NOON + 61_000, { failed: true })
    c.tool('Bash', NOON, NOON + 59_999, {})
    c.tool('Read', NOON, NOON + 1000, {})
    c.tool('Edit', NOON, NOON + 10, {})
    await c.decide(s, NOON, undefined, undefined)
    const own = (s.rows.get('visitTally') as { rows: Record<string, Record<string, number>> }).rows[c.tag]!
    expect(own).toMatchObject({ run: 63, slow: 1, edit: 1 })
  })
  test('sixty runs bring the cursor; the tally holds integers only and the session tag', async () => {
    const s = store(), c = counter()
    for (let i = 0; i < 60; i++) c.tool('Bash', NOON, NOON + 1000, {})
    const due = await c.decide(s, NOON, undefined, undefined)
    expect(due).toMatchObject({ kind: 'cursor', day: '2026-10-20' })
    const tally = s.rows.get('visitTally') as { day: string; rows: Record<string, Record<string, number>> }
    expect(tally.day).toBe('2026-10-20')
    expect(Object.keys(tally.rows)).toEqual([c.tag])
    expect(c.tag).toMatch(/^[0-9a-f]{4}$/)
    expect(Object.values(tally.rows[c.tag]!).every(n => Number.isInteger(n))).toBe(true)
    expect(JSON.stringify([...s.rows.values()])).not.toMatch(/Bash|command|\/|\.ts/)
  })
  test('two sessions add up in the store, and neither alone has to reach the bar', async () => {
    const s = store(), a = counter(), b = counter()
    for (let i = 0; i < 30; i++) a.tool('Bash', NOON, NOON + 1000, {})
    for (let i = 0; i < 30; i++) b.tool('Bash', NOON, NOON + 1000, {})
    expect(await a.decide(s, NOON, undefined, undefined)).toBeUndefined()
    expect(await b.decide(s, NOON + 1, undefined, undefined)).toMatchObject({ kind: 'cursor' })
  })
  test('the plane needs three foreground commands of a minute each, the leaf one task of twenty minutes, the note ten steps', async () => {
    let c = counter(), s = store()
    for (let i = 0; i < 3; i++) c.tool('Bash', NOON, NOON + 60_000, {})
    expect((await c.decide(s, NOON + 200_000, undefined, undefined))?.kind).toBe('plane')
    c = counter(); s = store(); c.task(NOON, 19 * 60_000)
    expect(await c.decide(s, NOON, undefined, undefined)).toBeUndefined()
    c.task(NOON, 20 * 60_000)
    expect((await c.decide(s, NOON, undefined, undefined))?.kind).toBe('leaf')
    c = counter(); s = store()
    c.todos(NOON, Array.from({ length: 9 }, (_, i) => ({ content: `step ${i}`, status: 'completed' })))
    expect(await c.decide(s, NOON, undefined, undefined)).toBeUndefined()
    c.todos(NOON, [...Array.from({ length: 9 }, (_, i) => ({ content: `step ${i}`, status: 'completed' })), { content: 'last', status: 'completed' }])
    expect((await c.decide(s, NOON, undefined, undefined))?.kind).toBe('note')
  })
  test('a to-do counts once however often the list is written, and a task hook adds a step', async () => {
    const c = counter(), s = store()
    const list = [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }]
    for (let i = 0; i < 5; i++) c.todos(NOON, list)
    for (let i = 0; i < 9; i++) c.step(NOON)
    expect((await c.decide(s, NOON, undefined, undefined))?.kind).toBe('note')
  })
  test('two red-to-green recoveries bring the bulb, one does not', async () => {
    const c = counter(), s = store()
    c.green(NOON)
    expect(await c.decide(s, NOON, undefined, undefined)).toBeUndefined()
    c.green(NOON)
    expect((await c.decide(s, NOON, undefined, undefined))?.kind).toBe('bulb')
  })
  test('a late turn brings the usb only for the minutes inside 21:30 to 04:59', async () => {
    const c = counter(), s = store(), end = at('2026-10-20T21:49:00Z')
    c.turn(end, 30 * 60_000)
    expect(await c.decide(s, end, undefined, undefined)).toBeUndefined()
    c.turn(end + 61 * 60_000, 2 * 60_000)
    expect((await c.decide(s, end + 61 * 60_000, undefined, undefined))?.kind).toBe('usb')
  })
  test('Visitors off keeps no counts and writes nothing (V10)', async () => {
    const s = store(), c = counter(false)
    for (let i = 0; i < 80; i++) c.tool('Bash', NOON, NOON + 1000, {})
    expect(await c.decide(s, NOON, undefined, undefined)).toBeUndefined()
    expect([...s.rows.keys()]).toEqual([])
  })
  test('a new day starts the counts again, and yesterday\'s tally is dropped at the first write', async () => {
    const s = store(), c = counter()
    for (let i = 0; i < 59; i++) c.tool('Bash', NOON, NOON + 1000, {})
    await c.decide(s, NOON, undefined, undefined)
    const next = NOON + 86_400_000
    c.tool('Bash', next, next + 1000, {})
    expect(await c.decide(s, next, undefined, undefined)).toBeUndefined()
    expect((s.rows.get('visitTally') as { day: string; rows: object }).day).toBe('2026-10-21')
    expect(Object.keys((s.rows.get('visitTally') as { rows: object }).rows)).toEqual([c.tag])
  })
  test('the first day he was met brings nobody, and a rest week holds the same kind back', async () => {
    const c = counter()
    for (let i = 0; i < 60; i++) c.tool('Bash', NOON, NOON + 1000, {})
    let seed = 1
    while (!visitingDay(seed, '2026-10-20')) seed++
    const withSeed = () => { const s = store(); s.rows.set('visitSeed', seed); return s }
    expect(await c.decide(withSeed(), NOON, NOON - 3_600_000, undefined)).toBeUndefined()
    expect(await c.decide(withSeed(), NOON, NOON - 2 * 86_400_000, { kinds: { cursor: '2026-10-18' }, last: '2026-10-18' })).toBeUndefined()
    expect((await c.decide(withSeed(), NOON, NOON - 2 * 86_400_000, { kinds: { cursor: '2026-10-10' }, last: '2026-10-10' }))?.kind).toBe('cursor')
  })
  test('what the record and this machine each remember is merged, the later day winning', async () => {
    expect(mergeVisitState({ last: '2026-10-01', kinds: { plane: '2026-10-01', keycap: '2026-09-01' } }, { last: '2026-10-05', kinds: { plane: '2026-09-20', leaf: '2026-10-05' } }))
      .toEqual({ last: '2026-10-05', kinds: { plane: '2026-10-01', keycap: '2026-09-01', leaf: '2026-10-05' } })
    const s = store()
    await rememberVisit(s, 'plane', '2026-10-01')
    await rememberVisit(s, 'leaf', '2026-10-05')
    expect(s.rows.get('visitState')).toEqual({ last: '2026-10-05', kinds: { plane: '2026-10-01', leaf: '2026-10-05' } })
  })
})
