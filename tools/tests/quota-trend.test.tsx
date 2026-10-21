// Their quota page's charts (lane C, 10-15; quota_page.py): every reading Claude Code reports goes into its window's trail
// in their store, and page 2 draws each window from it on the desktop. The terminal keeps the cells and the sentence.
import { expect, test } from 'claude-code/testing'
import { desktopBook, pageBlocks, terminalBook } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { WORDS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { BOOK_FILES } from './book-files'
import { MORNING, RECENT, settleLegacyStart, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const H = 3_600_000, M = 60_000
const EN = JSON.parse(BOOK_FILES['en.json']!) as BookWords
const RESET = MORNING + 2 * H + 10 * M // the 5-hour window opened at 06:10
const WEEK_RESET = MORNING + 3 * 24 * H
const limits = (five: number, week: number) => [
  { kind: 'five_hour', percentUsed: five, resetsAt: new Date(RESET).toISOString() },
  { kind: 'seven_day', percentUsed: week, resetsAt: new Date(WEEK_RESET).toISOString() },
]
const usage = (five: number, week: number) => ({ startedAt: MORNING - H, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: limits(five, week) })
const trail = {
  five_hour: { resetsAt: RESET, points: [[Math.floor((RESET - 5 * H) / M), 0], [Math.floor((MORNING - 60 * M) / M), 20], [Math.floor((MORNING - 20 * M) / M), 33]] },
  seven_day: { resetsAt: WEEK_RESET, points: [[Math.floor((WEEK_RESET - 7 * 24 * H) / M), 0], [Math.floor((MORNING - 24 * H) / M), 40]] },
}
const data = (extra: Partial<BookData> = {}) => ({
  view: { ...initialView(), lang: 'en', context: 32 }, own: WORDS.en, now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies',
  reading: 0, store: { quotaTrail: trail }, usage: usage(38, 55), ...extra,
}) as unknown as BookData
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]

test('every reading goes into its window trail in her store, at most once a minute', async ($, on) => {
  const w = world(on, { store: RECENT, observeStore: true })
  await $.session.start(START); await settleLegacyStart($, w)
  const measure = (five: number) => $.session.measure({ context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: limits(five, 55), cost: { usd: 1 }, changed: ['cost'] } as never)
  await measure(38)
  const first = w.stored('quotaTrail') as any
  expect(first.five_hour.resetsAt).toBe(RESET)
  expect(first.five_hour.points.at(-1)[1]).toBe(38)
  expect(first.seven_day.points.at(-1)[1]).toBe(55)
  await w.clock.advance(20_000); await measure(39)
  expect((w.stored('quotaTrail') as any).five_hour.points.at(-1)[1]).toBe(38) // written once a minute
  await w.clock.advance(60_000); await measure(41)
  const later = (w.stored('quotaTrail') as any).five_hour.points as [number, number][]
  expect(later.at(-1)![1]).toBe(41)
  expect(later.length).toBeLessThanOrEqual(3) // 38 kept only if the 20 seconds crossed a minute
  expect(later.every((p, i) => i === 0 || p[0] > later[i - 1]![0])).toBe(true)
})

test('page 2 puts a chart between each window and its sentence when its trail is there', () => {
  const blocks = pageBlocks('offerings', EN, data())
  const trends = blocks.flatMap((b, i) => b.t === 'trend' ? [i] : [])
  expect(trends.length).toBe(2)
  for (const at of trends) {
    expect(blocks[at - 1]!.t).toBe('incense')
    expect(blocks[at + 1]!.t).toBe('para')
  }
  const five = blocks[trends[0]!] as Extract<typeof blocks[number], { t: 'trend' }>
  expect(five.trend.kind).toBe('five_hour')
  expect(five.trend.resetLabel).toBe('11:10 AM')
  expect(five.alt.startsWith(`${EN.offerings.kinds.five_hour}: `)).toBe(true)
  // no trail, or a trail of an earlier window: no chart, the rest as it was
  expect(pageBlocks('offerings', EN, data({ store: {} })).some(b => b.t === 'trend')).toBe(false)
  const old = { five_hour: { ...trail.five_hour, resetsAt: RESET - 5 * H } }
  expect(pageBlocks('offerings', EN, data({ store: { quotaTrail: old } })).filter(b => b.t === 'trend').map(b => (b as any).trend.kind)).toEqual([])
})

test('the desktop draws the chart across the page; the terminal draws none', async ($, on) => {
  let surface: 'desktop' | 'terminal' = 'desktop', columns = 64
  const press = { go() {}, turn() {}, marks() {} } as any
  on('ui.render', { component: 'Pane', requestId: 'quota-trend' }, ($: any, e: any) => surface === 'desktop'
    ? desktopBook($.ui.resolve(e), EN, { page: 'offerings', reading: 0, rev: 0 } as any, data(), { source: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"></svg>', height: 56 }, press, columns, 'desktop')
    : terminalBook($.ui.resolve(e), EN, { page: 'offerings', reading: 0, rev: 0 } as any, data(), press, columns))
  world(on)
  const draw = async () => {
    const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'quota-trend', props: { title: 'Q', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as never)
    const tree = await ui.drawn(); await ui.unmount(); return tree
  }
  const charts = (tree: unknown) => nodes(tree).filter(n => n.type === 'Svg' && String(n.props?.source).includes('stroke-dasharray="4 3"'))
  const wide = charts(await draw())
  expect(wide.length).toBe(2)
  expect(wide[0].props.height).toBe(96)
  expect(wide[0].props.width).toBeLessThanOrEqual(520)
  expect(String(wide[0].props.alt).startsWith(EN.offerings.kinds.five_hour)).toBe(true)
  columns = 30
  const narrow = charts(await draw())
  expect(narrow[0].props.width).toBeLessThan(wide[0].props.width)
  surface = 'terminal'; columns = 64
  expect(charts(await draw()).length).toBe(0)
})
