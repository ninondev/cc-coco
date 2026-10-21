// His openings: when one plays, what it draws, and that it leaves nothing behind (FIRST-MEETING 2).
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { OPENING_TEXT_RAW, WEEK_TEXT_RAW } from './week-text-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { RECENT, PERSON, band, desktopPicture, settleLegacyStart, world } from './world'
import { c3MotionFrame, c3NextMotion, openingFrames, openingLife, openingStart } from '../hooks/c3-motion'
import { chooseOpening, markOpening, openingsFrom, weekReadyDue } from '../hooks/openings'
import type { OpeningInput } from '../hooks/openings'
import { forgetWeekWords } from '../hooks/week-words'
import { weekStart } from '../hooks/week-days'
import { rowsOf } from '../hooks/band.js'

const TEXT: Record<string, Record<string, string>> = { ...JSON.parse(WEEK_TEXT_RAW), ...JSON.parse(OPENING_TEXT_RAW) }
const pose = (name: string, extra: Record<string, unknown> = {}) => ({ name, frame: openingStart(name), aside: '(x)', at: 1000, ...extra }) as never
const base: OpeningInput = { sessionId: 's1', surface: 'terminal', played: [], now: 10 * 60_000, lastSeen: 0, sourceAge: 0, last: {}, arrival: true }

test('OPEN which opening plays: the source decides, a reload and a quick resume play nothing', () => {
  expect(chooseOpening({ ...base, source: 'startup' })).toBe('startup')
  expect(chooseOpening({ ...base, source: 'resume', seconds: 3600 })).toBe('resume')
  expect(chooseOpening({ ...base, source: 'resume', seconds: 60 })).toBeUndefined()
  expect(chooseOpening({ ...base, source: 'resume', seconds: 9000 })).toBe('resume')
  expect(chooseOpening({ ...base, source: 'compact' })).toBeUndefined()
  expect(chooseOpening({ ...base, source: 'fork' })).toBe('fork')
  expect(chooseOpening({ ...base, turns: 0 })).toBe('startup')
  expect(chooseOpening({ ...base, turns: 4 })).toBe('resume')
  expect(chooseOpening({ ...base, source: 'startup', lastSeen: base.now - 60_000 })).toBeUndefined()
  expect(chooseOpening({ ...base, source: 'startup', sourceAge: 10_001 })).toBeUndefined()
})

test('OPEN once per session and surface; clear and fork at most once a minute each', () => {
  const marks = markOpening([], 's1', 'terminal')
  expect(chooseOpening({ ...base, source: 'startup', played: marks })).toBeUndefined()
  expect(chooseOpening({ ...base, source: 'startup', played: marks, surface: 'desktop' })).toBe('startup')
  expect(chooseOpening({ ...base, source: 'resume', seconds: 3600, played: marks, arrival: false })).toBe('resume')
  expect(chooseOpening({ ...base, source: 'clear', last: { clear: base.now - 59_000 } })).toBeUndefined()
  expect(chooseOpening({ ...base, source: 'clear', last: { clear: base.now - 61_000 }, played: marks, arrival: false })).toBe('clear')
  expect(chooseOpening({ ...base, source: 'fork', last: { clear: base.now - 1000 } })).toBe('fork')
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, s: ['terminal'] }))
  expect(openingsFrom(many).length).toBe(32)
  expect(markOpening(many, 'new', 'desktop').length).toBe(32)
  expect(openingsFrom('junk')).toEqual([])
})

test('OPEN the weekly line is due once a week, only when last week has a finished day', () => {
  const held = { days: [{ day: '2026-09-29', pages: 3, runs: [['read', 1]], green: 0, wild: [] }], slid: [] } as never
  expect(weekReadyDue(held, '2026-10-06', 'en', undefined)).toBe(true)
  expect(weekReadyDue(held, '2026-10-06', 'en', weekStart('2026-10-06', 'en'))).toBe(false)
  expect(weekReadyDue(held, '2026-10-02', 'en', undefined)).toBe(false)
})

test('OPEN timelines: the terminal swaps cells at the design moments, reduced motion only cuts', () => {
  const frames = (name: string, at: number[], reduced = false) => at.map(t => c3MotionFrame(pose(name), t, reduced))
  expect(frames('open-startup', [0, 60, 120, 2599, 2600])).toEqual(['wave~6', 'wave~3', 'wave', 'wave', 'idle-reading'])
  expect(frames('open-resume', [0, 899, 900, 1449, 1450, 1570])).toEqual(['snake', 'snake', 'idle-reading', 'idle-reading', 'idle-blink', 'idle-reading'])
  expect(frames('open-clear', [0, 299, 300])).toEqual(['idle-blink', 'idle-blink', 'idle-reading'])
  expect(frames('open-fork', [0, 139, 140, 1099, 1100])).toEqual(['scroll-a', 'scroll-a', 'fork', 'fork', 'idle-reading'])
  expect(frames('open-startup', [0, 100, 2700], true)).toEqual(['wave', 'wave', 'idle-reading'])
  expect(frames('open-resume', [0, 899, 900], true)).toEqual(['snake', 'snake', 'idle-reading'])
  expect(frames('open-fork', [0, 1099, 1100], true)).toEqual(['fork', 'fork', 'idle-reading'])
  expect(c3NextMotion(pose('open-startup'), 0)).toBe(60)
  expect(c3NextMotion(pose('open-startup'), 2600)).toBeUndefined()
  expect(c3NextMotion(pose('open-resume'), 900)).toBe(550)
  expect(c3NextMotion(pose('open-startup'), 0, true)).toBe(2600)
  expect(['open-startup', 'open-resume', 'open-clear', 'open-fork', 'open-week'].map(openingLife)).toEqual([2700, 1700, 1200, 1350, 1500])
  expect(openingFrames('open-fork').sort()).toEqual(['idle-reading', 'scroll-a'])
})

const START = { cwd: '/tmp/opening-project', surface: 'terminal' as const, isInteractive: true }
const wordsOf = () => ({ readText: (path: string) => /[\\/]hooks[\\/]week-text\.json$/.test(path) ? WEEK_TEXT_RAW : /[\\/]hooks[\\/]opening-text\.json$/.test(path) ? OPENING_TEXT_RAW : path.endsWith('frame-manifest.json') ? JSON.stringify(C3_HEAD_MANIFEST) : undefined })
const classic = ($: any, source: string, extra: Record<string, unknown> = {}) => $.classic.SessionStart({ source, ...extra })
function fixture(on: On, store: Record<string, unknown> = {}, options: Parameters<typeof world>[1] = {}) {
  forgetWeekWords()
  on('classic.SessionStart', () => ({}))
  const writes = new Map<string, unknown>()
  on('store.*', async ($, e, next) => { const out = await next(e); if (next.is('store.set', e)) writes.set(e.key, e.value); return out })
  return { w: world(on, { store, ...wordsOf(), ...options }), writes }
}

test('OPEN a new session waves with the greeting and the rise; the pose leaves with its time', async ($, on) => {
  const { w } = fixture(on)
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().mood).toBe('wave')
  expect(w.view().pose?.name).toBe('open-startup')
  expect(w.view().pose?.frame).toBe('wave')
  expect(w.view().said).not.toBeNull()
  await w.clock.advance(2800)
  expect(w.view().pose).toBeUndefined()
  expect(w.view().mood).toBe('idle')
  await w.clock.advance(3_600_000)
  expect(w.view().pose).toBeUndefined()
})

test('OPEN a resumed session opens the page Shiori kept, with no hello, and «back» only after two hours', async ($, on) => {
  const { w } = fixture(on)
  await $.session.start(START); await settleLegacyStart($, w)
  await w.clock.advance(5000)
  await classic($, 'resume', { seconds_since_last_response: 3600 })
  expect(w.view().pose?.name).toBe('open-resume')
  expect(w.view().pose?.aside).toBe(`(${TEXT['aside.resume']!.en})`)
  await w.clock.advance(2000)
  await classic($, 'resume', { seconds_since_last_response: 60 })
  expect(w.view().pose).toBeUndefined()
})

test('OPEN after two hours away the resumed opening says «back»; a clear and a fork each play once a minute', async ($, on) => {
  const { w } = fixture(on)
  await $.session.start(START); await settleLegacyStart($, w)
  await w.clock.advance(5000)
  await classic($, 'resume', { seconds_since_last_response: 9000 })
  expect(w.view().pose?.name).toBe('open-resume')
  expect(w.view().said).not.toBeNull()
  await w.clock.advance(5000)
  await classic($, 'clear')
  expect(w.view().pose?.name).toBe('open-clear')
  expect(w.view().pose?.aside).toBe(`(${TEXT['aside.clear']!.en})`)
  await w.clock.advance(1300)
  await classic($, 'clear')
  expect(w.view().pose).toBeUndefined()
  await classic($, 'fork')
  expect(w.view().pose?.name).toBe('open-fork')
  expect(w.view().pose?.aside).toBe(`(${TEXT['aside.fork']!.en})`)
})

test('OPEN a compaction adds no wave, no greeting and no second shed', async ($, on) => {
  const { w } = fixture(on, RECENT)
  await $.session.start(START); await settleLegacyStart($, w)
  await classic($, 'compact')
  expect(w.view().pose).toBeUndefined()
  expect(w.view().mood).toBe('idle')
  expect(w.view().said).toBeNull()
})

test('OPEN a reload right after activity plays nothing', async ($, on) => {
  const { w } = fixture(on, RECENT)
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().pose).toBeUndefined()
})

test('OPEN the source may arrive before or after the plugin draws him: the same opening, once', async ($, on) => {
  const { w, writes } = fixture(on)
  await classic($, 'startup')
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().pose?.name).toBe('open-startup')
  await classic($, 'startup')
  expect((writes.get('openings') as { id: string }[]).length).toBe(1)
  await w.clock.advance(2800)
  expect(w.view().pose).toBeUndefined()
})

test('OPEN the band keeps its height and rows during an opening and never takes focus', async ($, on) => {
  const { w } = fixture(on, {}, { surfaces: ['desktop'] })
  const calls: string[] = []
  on('ui.*', ($, e, next) => { if (next.is('ui.focus', e) || next.is('ui.open', e)) calls.push(e.type); return next(e) })
  await $.session.start({ ...START, surface: 'desktop' }); await settleLegacyStart($, w)
  await $.session.attach({ clientId: 'c1', surface: 'desktop' } as never)
  await w.clock.advance(0)
  const at = await $.ui.mount({ surface: 'desktop', ...band(90) })
  const during = Number((await desktopPicture(at))?.props.height)
  await w.clock.advance(3000)
  await at.redraw()
  const after = Number((await desktopPicture(at))?.props.height)
  expect(during).toBe(after)
  expect(calls).toEqual([])
  void rowsOf
})

test('OPEN the weekly line replaces the greeting once a week, carries a button, and a prompt removes it', async ($, on) => {
  const held = { days: [{ day: '2026-09-22', pages: 3, runs: [['read', 1]], green: 0, wild: [] }], slid: [] }
  const { w, writes } = fixture(on, { 'days:v1': held })
  await $.session.start(START); await settleLegacyStart($, w)
  const line = w.view().line
  expect(line?.key).toBe('week.ready')
  expect(line?.text).toBe(TEXT['week.ready']!.en)
  expect(line?.button?.label).toBe(TEXT['week.open']!.en)
  expect(line?.button?.key).toBe('coco:week:open')
  expect(w.view().pose?.name).toBe('open-week')
  expect(writes.get('weekReady')).toBe(weekStart('2026-10-02', 'en'))
  await $.prompt.submit({ text: 'hello', wait: false, origin: PERSON })
  await $.turn.start({ text: 'hello', turnId: 't1' })
  expect(w.view().line?.key).not.toBe('week.ready')
})

test('OPEN the weekly line does not come twice in a week, and Off removes it', async ($, on) => {
  const held = { days: [{ day: '2026-09-22', pages: 3, runs: [['read', 1]], green: 0, wild: [] }], slid: [] }
  const { w } = fixture(on, { 'days:v1': held, weekReady: weekStart('2026-10-02', 'en') })
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().line?.key).not.toBe('week.ready')
})

test('OPEN with the weekly page off the first line stays the greeting', async ($, on) => {
  const held = { days: [{ day: '2026-09-22', pages: 3, runs: [['read', 1]], green: 0, wild: [] }], slid: [] }
  const { w } = fixture(on, { 'days:v1': held, week: false })
  await $.session.start(START); await settleLegacyStart($, w)
  expect(w.view().line?.key).not.toBe('week.ready')
  expect(w.view().pose?.name).toBe('open-startup')
})

