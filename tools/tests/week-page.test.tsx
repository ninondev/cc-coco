// The weekly page: the day record, its pictures, the card and the book section (FIRST-MEETING 3).
// The words are the writer's (week-text.json, opening-text.json), carried here by week-text-fixture.ts.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { CARD_METRICS_TEXT } from './card-metrics-data'
import { OPENING_TEXT_RAW, WEEK_TEXT_RAW } from './week-text-fixture'
import { MORNING, RECENT, P, PERSON, world, settleLegacyStart } from './world'
import { posixPath, samePath, slashPath } from './file-paths'
import { WeekTally, addDays, foldTurn, issueNumber, issueRows, viewTotals, weekFirstDay, weekIssues, weekKind, weekRange, weekRecordFrom, weekStart, weekView, lastWeekReady, zineCover } from '../hooks/week-days'
import type { WeekDay, WeekRecord } from '../hooks/week-days'
import { weekCardSvg, WEEK_CARD } from '../hooks/week-card'
import { loadCardMetrics, resetCardMetrics } from '../hooks/card-metrics-lazy'
import { forgetWeekWords } from '../hooks/week-words'
import { d1Text } from '../hooks/d1-state.js'

const PNG_1080_1350 = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAVGAQAAAABTNDYnAAAAyUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIB3A81OAAGYNrEaAAAAAElFTkSuQmCC'
const TEXT: Record<string, Record<string, unknown>> = { ...JSON.parse(WEEK_TEXT_RAW), ...JSON.parse(OPENING_TEXT_RAW) }
// The words as the plugin reads them: a plural slot picks its form from n.
const word = (lang = 'en') => (key: string, vars: Record<string, string | number> = {}, n?: number): string => d1Text({ lang, entries: TEXT as never, ready: false }, key, vars, n)
const DAYS: WeekDay[] = [
  { day: '2026-09-28', pages: 34, green: 2 },
  { day: '2026-09-29', pages: 51, green: 3 },
  { day: '2026-10-01', pages: 12, green: 0 },
]
const record = (days: WeekDay[] = DAYS): WeekRecord => ({ days })
const tally = (green = 0): WeekTally => {
  const t = new WeekTally()
  for (let i = 0; i < green; i++) t.greenRun()
  return t
}

test('WEEK tool calls fall into seven kinds by the pose table, and every unlisted tool counts as writing', () => {
  expect(['Read', 'Grep', 'Glob', 'Bash', 'BashOutput', 'WebFetch', 'TodoWrite', 'Agent', 'Edit', 'NotebookEdit', 'MadeUpTool'].map(weekKind))
    .toEqual(['read', 'search', 'search', 'run', 'run', 'web', 'plan', 'helpers', 'write', 'write', 'write'])
})

test('WEEK a turn folds into its day: a page per finished turn and its green runs', () => {
  let held = record([])
  held = foldTurn(held, tally(), '2026-10-01', 'en')
  held = foldTurn(held, tally(1), '2026-10-01', 'en')
  expect(held.days).toEqual([{ day: '2026-10-01', pages: 2, green: 1 }])
})

test('WEEK days older than last week drop and no more than fourteen are kept', () => {
  const old = Array.from({ length: 20 }, (_, i) => ({ day: addDays('2026-08-01', i), pages: 1, green: 0 }) as WeekDay)
  const held = foldTurn(record(old), tally(), '2026-10-02', 'en')
  expect(held.days.map(d => d.day)).toEqual(['2026-10-02'])
  const week = foldTurn(record(DAYS), tally(), '2026-10-02', 'en')
  expect(week.days.map(d => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'])
})

test('WEEK a damaged record loses days and never draws a wrong one; the old bookmark fields drop on read', () => {
  const held = weekRecordFrom({ days: [{ day: 'x' }, { day: '2026-10-01', pages: -3, runs: [['nope', 4], ['read', 2]], green: 'a', wild: [9] }, 7, null], slid: ['2026-10-01', 4] })
  expect(held.days).toEqual([{ day: '2026-10-01', pages: 0, green: 0 }])
  expect('slid' in held).toBe(false)
  expect(weekRecordFrom('junk')).toEqual({ days: [] })
})

// The doujin's issues (page 5): a week with a finished day is an issue in their collection, numbered from the first week;
// a week without work is an issue they missed, so the count and the newest number differ.
test('WEEK issues: numbered from the first week, a missed week leaves a gap, today alone collects nothing', () => {
  const day = (d: string): WeekDay => ({ day: d, pages: 2, green: 0 })
  // Monday weeks (zh): 09-07 is issue 1, 09-28 issue 4
  const held = record([day('2026-09-08'), day('2026-09-29'), day('2026-10-02')])
  expect(weekIssues(held, '2026-10-02', 'zh')).toEqual({ first: '2026-09-07', got: [1, 4] })
  expect(weekIssues(record([day('2026-10-02')]), '2026-10-02', 'zh')).toBeUndefined()
  expect(weekIssues(record([{ ...day('2026-09-29'), pages: 0 }]), '2026-10-02', 'zh')).toBeUndefined()
  // a Sunday week start against a Monday first week rounds to the same issue
  expect(issueNumber('2026-09-07', '2026-09-27')).toBe(4)
  expect(issueNumber('2026-09-07', '2026-09-28')).toBe(4)
})

test('WEEK issues stay collected after their days drop, survive the store, and a damaged list loses only bad numbers', () => {
  const day = (d: string): WeekDay => ({ day: d, pages: 1, green: 0 })
  const first = foldTurn(record([day('2026-09-08')]), tally(), '2026-09-09', 'zh')
  expect(first.issues).toEqual({ first: '2026-09-07', got: [1] })
  // three weeks later the September day is gone from the record, its issue is not
  const later = foldTurn(first, tally(), '2026-10-01', 'zh')
  expect(later.days.map(d => d.day)).toEqual(['2026-10-01'])
  expect(later.issues).toEqual({ first: '2026-09-07', got: [1] })
  const next = foldTurn(later, tally(), '2026-10-02', 'zh')
  expect(next.issues).toEqual({ first: '2026-09-07', got: [1, 4] })
  expect(weekRecordFrom(JSON.parse(JSON.stringify(next))).issues).toEqual(next.issues)
  expect(weekRecordFrom({ days: [], slid: [], issues: { first: '2026-09-07', got: [4, 'x', 0, 1.5, 1, 4] } }).issues).toEqual({ first: '2026-09-07', got: [1, 4] })
  expect(weekRecordFrom({ days: [], slid: [], issues: { first: 'soon', got: [1] } }).issues).toBeUndefined()
  expect(Object.keys(next.issues!)).toEqual(['first', 'got'])
})

test('WEEK a past issue keeps its two numbers when its days drop, opens by number, and the twelve covers take turns', () => {
  const day = (d: string, pages = 3, green = 1): WeekDay => ({ day: d, pages, green })
  // Monday weeks (zh): 09-07 is issue 1, 09-28 issue 4
  const later = foldTurn(record([day('2026-09-08', 3, 1), day('2026-09-10', 4, 2)]), tally(), '2026-10-01', 'zh')
  expect(later.back).toEqual([{ n: 1, start: '2026-09-07', pages: 7, green: 3 }])
  // folding again counts nothing twice, and the store keeps it
  const again = foldTurn(later, tally(), '2026-10-02', 'zh')
  expect(again.back).toEqual(later.back)
  expect(weekRecordFrom(JSON.parse(JSON.stringify(again))).back).toEqual(again.back)
  expect(weekRecordFrom({ days: [], slid: [], back: [{ n: 2, start: '2026-09-14', pages: 5, green: 'x' }, { n: 0, start: '2026-09-07' }, { n: 3, start: 'soon' }, { n: 2, start: '2026-09-14', pages: 9 }, 'x'] }).back)
    .toEqual([{ n: 2, start: '2026-09-14', pages: 5, green: 0 }])
  // an issue's number opens it: a past one with its numbers and no days, this week's as this week; an unknown one changes nothing
  const past = weekView(again, '2026-10-02', 'zh', 1)!
  expect(past).toMatchObject({ shown: 'back', n: 1, start: '2026-09-07', end: '2026-09-13', days: [], other: false })
  expect(viewTotals(past)).toEqual({ pages: 7, green: 3 })
  expect(weekView(again, '2026-10-02', 'zh', 4)).toMatchObject({ shown: 'this', n: 4, start: '2026-09-28' })
  expect(weekView(again, '2026-10-02', 'zh', 9)).toMatchObject({ shown: 'this', n: 4 })
  expect(issueRows(again, '2026-10-02', 'zh')).toEqual([{ n: 4, start: '2026-09-28', pages: 1, green: 0 }, { n: 1, start: '2026-09-07', pages: 7, green: 3 }])
  expect([1, 2, 12, 13, 24, 25].map(zineCover)).toEqual([1, 2, 12, 1, 12, 1])
})

test('WEEK the week starts on the locale first day, Simplified Chinese on Monday', () => {
  const info = (Intl.Locale.prototype as unknown as { getWeekInfo?: unknown; weekInfo?: unknown })
  const measured = info.getWeekInfo !== undefined || 'weekInfo' in info
  const sunday = ['en', 'zh-Hant', 'ja', 'ko', 'pt-BR', 'hi', 'id'], monday = ['zh', 'de', 'fr', 'es-ES', 'es-419', 'it']
  expect(weekFirstDay('zh')).toBe(1)
  for (const lang of monday) expect(weekFirstDay(lang)).toBe(1)
  for (const lang of sunday) expect(weekFirstDay(lang)).toBe(measured ? 7 : 1)
  expect(weekStart('2026-10-02', 'en')).toBe(measured ? '2026-09-27' : '2026-09-28')
  expect(weekStart('2026-10-04', 'de')).toBe('2026-09-28')
})

test('WEEK today never draws; before this week has a finished day last week shows; nothing counts absence', () => {
  const held = record([...DAYS, { day: '2026-10-02', pages: 4, green: 0 }])
  const view = weekView(held, '2026-10-02', 'en')!
  expect(view.days.map(d => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-10-01'])
  expect(view.shown).toBe('this')
  const next = weekView(record(DAYS), '2026-10-06', 'en')!
  expect(next.shown).toBe('last')
  expect(next.other).toBe(false)
  expect(weekView(record(DAYS), '2026-10-30', 'en')).toBeUndefined()
  expect(lastWeekReady(record(DAYS), '2026-10-06', 'en')).toBe(true)
  expect(lastWeekReady(record(DAYS), '2026-10-02', 'en')).toBe(false)
  expect(weekView(held, '2026-10-02', 'en', true)!.shown).toBe('this')
})

test('WEEK the range keeps the locale order and swaps the dash for the word', () => {
  expect(weekRange('2026-10-04', '2026-10-10', 'en', 'to')).toBe('Oct 4 to 10, 2026')
  expect(weekRange('2026-09-28', '2026-10-04', 'en', 'to')).toBe('Sep 28 to Oct 4, 2026')
  for (const lang of ['zh', 'zh-Hant', 'ja', 'ko', 'de', 'fr', 'es-419', 'pt-BR', 'it', 'hi', 'id']) expect(weekRange('2026-10-04', '2026-10-10', lang, 'X')).not.toMatch(/[‒-―−]/)
})

test('WEEK the card is 1080 x 1350, holds the counts, no time of day and no address but the repository', async () => {
  resetCardMetrics()
  await loadCardMetrics(async () => CARD_METRICS_TEXT)
  const input = { lang: 'en', theme: 'light' as const, title: word()('card.week.title'), facts: word()('card.week.facts', { pages: 97, green: 5 }), range: weekRange('2026-09-27', '2026-10-03', 'en', 'to'), unofficial: 'unofficial fan mod' }
  const svg = weekCardSvg(input)
  expect(svg).toContain(`width="${WEEK_CARD.width}" height="${WEEK_CARD.height}"`)
  expect(svg).toContain('Sep 27 to Oct 3, 2026')
  expect(svg).not.toContain('>Mon<')
  expect(svg).not.toMatch(/\d{1,2}:\d{2}/)
  expect([...svg.matchAll(/https?:\/\/[^"'<\s]+/g)].map(m => m[0]).filter(u => u !== 'http://www.w3.org/2000/svg')).toEqual([])
  expect(svg).toContain('github.com/ninondev/cc-coco')
  expect(svg).not.toMatch(/[–—]/)
  expect(weekCardSvg({ ...input, saved: '~38K tokens kept out of the chat' })).toContain('~38K tokens')
  expect(weekCardSvg({ ...input, theme: 'dark', lang: 'zh', range: '2026/9/27 至 2026/10/3', title: '我书里的一页', facts: '这一周一起读了97页。' })).toContain('我书里的一页')
  resetCardMetrics()
})

test('WEEK the card header carries her name in each language', async () => {
  resetCardMetrics()
  await loadCardMetrics(async () => CARD_METRICS_TEXT)
  const input = { theme: 'light' as const, title: 'A page of my book', facts: 'We read 97 pages.', range: 'Sep 27 to Oct 3, 2026', unofficial: 'unofficial fan mod' }
  const header = (lang: string) => weekCardSvg({ ...input, lang })
  expect(header('zh')).toContain('>小克</text>')
  expect(header('zh-Hant')).toContain('>小克</text>')
  expect(header('ja')).toContain('>Coco</text>')
  expect(header('ko')).toContain('>코코</text>')
  for (const lang of ['en', 'de', 'hi', 'fr']) expect(header(lang)).toContain('>Coco</text>')
  expect(header('zh')).not.toContain('>Coco</text>')
  resetCardMetrics()
})

const HOME = '/tmp/week-fixture-home', PICTURES = `${HOME}/Pictures`, FOLDER = `${PICTURES}/Coco`
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const START = { cwd: '/tmp/week-fixture-project', surface: 'desktop' as const, isInteractive: true }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const allText = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(allText).join('') : n && typeof n === 'object' ? allText(n.children ?? []) : ''

function fixture(on: On, options: { failWrite?: boolean; noRaster?: boolean; words?: boolean; store?: Record<string, unknown>; surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[] } = {}) {
  forgetWeekWords()
  const commands: string[][] = [], files = new Map<string, string>(), writes: string[] = [], texts: string[] = []
  const worker = { outcome: 'pass' as 'pass' | 'fail' }
  const stored = new Map<string, unknown>(Object.entries({ ...RECENT, ...(options.store ?? {}) }))
  on('store.*', async ($, e, next) => {
    const out = await next(e)
    if (next.is('store.set', e)) stored.set(e.key, e.value)
    if (next.is('store.delete', e)) stored.delete(e.key)
    return out
  })
  on('fs.read', { path: /[\\/]hooks[\\/]card-metrics\.json$/ }, () => ({ value: CARD_METRICS_TEXT }))
  on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || files.has(posixPath(e.path)) }))
  on('fs.stat', ($, e) => ({ value: samePath(e.path, PICTURES) ? { kind: 'dir', size: 0, isLink: false } : files.has(posixPath(e.path)) ? { kind: 'file', size: 512, isLink: false } : { kind: 'missing', size: 0, isLink: false } } as never))
  on('fs.read', { path: /[\\/]Pictures[\\/]Coco[\\/]/ }, ($, e) => ({ value: { base64: files.get(posixPath(e.path)) ?? PNG_1080_1350 } } as never))
  on('fs.write', ($, e) => { writes.push(e.path); texts.push(e.text); if (options.failWrite) throw new Error('fixture cannot write'); files.set(posixPath(e.path), e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    if (e.argv[0] === '/bin/test') return { value: OK }
    if (e.argv[1]?.endsWith('algo-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      const result = request.op === 'recognize' ? (String(request.command).includes('test') ? { kind: 'test', tool: 'jest', key: 'npm test' } : null)
        : request.op === 'finish' ? { parsed: { outcome: worker.outcome }, slowness: { slow: false, usualMs: 5000 }, history: request.history } : null
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result }) } }
    }
    if (e.argv[0] === 'sips') { if (options.noRaster) return { value: { ...OK, exitCode: 1 } }; files.set(e.argv.at(-1)!, PNG_1080_1350); return { value: OK } }
    if (e.argv[0] === 'mv') { files.set(e.argv[4]!, files.get(e.argv[3]!)!); files.delete(e.argv[3]!); return { value: OK } }
    if (e.argv[0] === 'rm') { for (const p of e.argv.slice(3)) files.delete(p); return { value: OK } }
    return { value: OK }
  })
  const w = world(on, { store: { ...RECENT, ...(options.store ?? {}) }, surfaces: options.surfaces ?? ['desktop'], env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME }, sessionId: 'week-fixture', ...(options.words === false ? {} : { readText: (path: string) => /[\\/]hooks[\\/]week-text\.json$/.test(path) ? WEEK_TEXT_RAW : /[\\/]hooks[\\/]opening-text\.json$/.test(path) ? OPENING_TEXT_RAW : undefined }) })
  return { w, commands, files, writes, texts, store: (key: string): unknown => stored.get(key), worker }
}
const svgAlts = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Svg' })).map((n: any) => String(n.props.alt ?? ''))
const finished = { 'days:v1': record() }
const open = async ($: any, f: ReturnType<typeof fixture>, args = 'log') => {
  await $.session.start(START); await settleLegacyStart($, f.w)
  await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
  return $.ui.mount({ surface: 'desktop', ...PANE })
}

test('WEEK the Reading log opens with this week: the numbers and a Save button, no bookmarks', async ($, on) => {
  const f = fixture(on, { store: finished }), ui = await open($, f)
  const text = allText(await ui.drawn())
  expect(text).toContain('This week')
  expect(text).toContain('97 pages together, 5 green runs')
  expect((await svgAlts(ui)).some(alt => alt.includes('Mon: 34 pages'))).toBe(false)
  expect(await ui.find({ key: 'coco:week:save' })).toBeDefined()
  expect(await ui.find({ key: 'coco:week:previous' })).toBeUndefined()
  expect(text.indexOf('This week')).toBeLessThan(text.indexOf('Pages read together'))
  await ui.unmount()
})

test('WEEK Save builds the 1080 x 1350 card through sips, replaces by name, then shows it in the folder', async ($, on) => {
  const f = fixture(on, { store: finished }), ui = await open($, f)
  await ui.press({ key: 'coco:week:save' }); await ui.redraw()
  const sips = f.commands.filter(c => c[0] === 'sips')
  expect(sips.length).toBe(1)
  expect(sips[0]!.slice(0, 4)).toEqual(['sips', '-s', 'format', 'png'])
  expect(f.commands.some(c => c[0] === 'qlmanage')).toBe(false)
  expect(f.files.has(`${FOLDER}/week-2026-09-27.png`)).toBe(true)
  expect(allText(await ui.drawn())).toContain('Saved to ~/Pictures/Coco/week-2026-09-27.png')
  expect(await ui.find({ key: 'coco:week:save' })).toBeUndefined()
  await ui.press({ key: 'coco:week:show' })
  expect(f.commands.some(c => c.length === 3 && c[0] === 'open' && c[1] === '-R' && c[2] === `${FOLDER}/week-2026-09-27.png`)).toBe(true)
  expect(f.commands.flat().join(' ')).not.toMatch(/curl|wget|http/)
  await ui.unmount()
})

test('WEEK the card carries this issue\'s cover, its lower part, in place of her night-window painting', async ($, on) => {
  const f = fixture(on, { store: finished }), ui = await open($, f)
  await ui.press({ key: 'coco:week:save' }); await ui.redraw()
  const svg = f.texts.find(text => text.startsWith('<svg')) ?? ''
  const named = (type: string): string[] => [...svg.matchAll(new RegExp(`data:image/${type};base64,([A-Za-z0-9+/=]+)`, 'g'))].map(match => slashPath(atob(match[1]!)))
  expect(named('jpeg').filter(art => art.includes('zine/cover-01.jpg')).length).toBe(1)
  expect(svg).toContain('preserveAspectRatio="xMidYMax slice"')
  expect(named('png').some(png => png.includes('card/week.png') || png.includes('card/reading.png') || png.includes('card/happy.png'))).toBe(false)
  await ui.unmount()
})

test('WEEK the zine page: this issue\'s cover beside its numbers, every issue under it, a past one opens to its cover and numbers', async ($, on) => {
  // Sunday weeks (en): 09-06 is issue 1, this week (09-27) issue 4
  const f = fixture(on, { store: { 'days:v1': { ...record(), issues: { first: '2026-09-06', got: [1, 4] }, back: [{ n: 1, start: '2026-09-06', pages: 40, green: 6 }] } } }), ui = await open($, f)
  expect(await svgAlts(ui)).toContain('Issue 4')
  let text = allText(await ui.drawn())
  expect(text).toContain('Every issue')
  expect(text).toContain('40 pages together, 6 green runs')
  expect(text.indexOf('Issue 4')).toBeLessThan(text.indexOf('Issue 1'))
  expect(await ui.find({ key: 'coco:zine:issue:4' })).toBeUndefined()
  await ui.press({ key: 'coco:zine:issue:1' }); await ui.redraw()
  text = allText(await ui.drawn())
  expect(await svgAlts(ui)).toContain('Issue 1')
  expect((await svgAlts(ui)).some(alt => alt.includes('Mon: 34 pages'))).toBe(false)
  expect(text.indexOf('Issue 1')).toBeLessThan(text.indexOf('40 pages together, 6 green runs'))
  expect(await ui.find({ key: 'coco:zine:issue:1' })).toBeUndefined()
  expect(await ui.find({ key: 'coco:zine:issue:4' })).toBeDefined()
  // its card: the cover and the numbers, no book without days
  await ui.press({ key: 'coco:week:save' }); await ui.redraw()
  expect(f.files.has(`${FOLDER}/week-2026-09-06.png`)).toBe(true)
  const svg = f.texts.find(text => text.startsWith('<svg')) ?? ''
  expect(slashPath(atob(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(svg)?.[1] ?? ''))).toContain('zine/cover-01.jpg')
  expect(svg).toContain('>Issue 1</text>')
  expect(svg).toContain('40 pages together, 6 green runs')
  expect(svg).not.toContain('this week')
  expect(svg).not.toContain('height="60" rx="7"')
  // back to this week from its row
  await ui.press({ key: 'coco:zine:issue:4' }); await ui.redraw()
  expect(await svgAlts(ui)).toContain('Issue 4')
  await ui.unmount()
})

test('WEEK the plural words follow the page count, and zh calls a green run 转绿 everywhere', () => {
  const facts = (n: number): string => word('en')('week.facts', { pages: n, green: 2 }, n)
  expect(facts(1)).toBe('1 page, 2 green runs')
  expect(facts(5)).toBe('5 pages together, 2 green runs')
  expect(word('de')('week.facts', { pages: 1, green: 2 }, 1)).toBe('1 Seite, 2 grüne Durchläufe')
  for (const key of ['week.facts', 'card.week.facts']) expect(JSON.stringify(TEXT[key]!.zh)).toContain('转绿')
  expect(word('zh-Hant')('week.facts', { pages: 3, green: 1 }, 3)).toContain('轉綠')
})

test('WEEK a card kept as SVG says so with its path after the words', async ($, on) => {
  const f = fixture(on, { store: finished, noRaster: true }), ui = await open($, f)
  await ui.press({ key: 'coco:week:save' }); await ui.redraw()
  expect(allText(await ui.drawn())).toContain('Saved as SVG: ~/Pictures/Coco/week-2026-09-27.svg')
  await ui.unmount()
})

test('WEEK a failed save says so and offers Save again', async ($, on) => {
  const f = fixture(on, { store: finished, failWrite: true })
  const ui = await open($, f)
  await ui.press({ key: 'coco:week:save' }); await ui.redraw()
  expect(allText(await ui.drawn())).toContain('Save failed')
  expect(await ui.find({ key: 'coco:week:save' })).toBeDefined()
  await ui.unmount()
})

test('WEEK with nothing finished the page has no week section and no button', async ($, on) => {
  const f = fixture(on), ui = await open($, f)
  const text = allText(await ui.drawn())
  // his call (10-19): until a day is done the week is not shown at all, not even a sentence about it
  expect(text).not.toContain('pages together')
  expect(text).not.toContain('A bookmark appears')
  expect(await ui.find({ key: 'coco:week:save' })).toBeUndefined()
  await ui.unmount()
})

test('WEEK without the words nothing of the week draws and nothing is saved', async ($, on) => {
  const f = fixture(on, { store: finished, words: false }), ui = await open($, f)
  // the zine page's first group is called «This week» in lane B's words, so the week's own lines are what must be missing
  expect(allText(await ui.drawn())).not.toContain('pages together')
  expect(await ui.find({ key: 'coco:week:save' })).toBeUndefined()
  await ui.unmount()
})

test('WEEK last week shows with its link when this week has no finished day', async ($, on) => {
  const old: WeekDay[] = [{ day: '2026-09-22', pages: 20, green: 1 }]
  const f = fixture(on, { store: { 'days:v1': record([...old, ...DAYS]) } }), ui = await open($, f)
  expect(await ui.find({ key: 'coco:week:previous' })).toBeDefined()
  await ui.press({ key: 'coco:week:previous' }); await ui.redraw()
  const text = allText(await ui.drawn())
  expect(text).toContain('Last week')
  expect(text).toContain('20 pages together, 1 green runs')
  await ui.unmount()
})

test('WEEK the record counts only: no path, name, command or secret reaches the store', async ($, on) => {
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  await $.turn.start({ text: 'fix sk-abc123 for alice@example.com', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/alice/secret.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'cat /Users/alice/secret.txt && echo alice@example.com sk-abc123' })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/alice/app/main.ts' } as never)
  await $.turn.complete({ answer: 'Done. alice@example.com', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  const held = f.store('days:v1')
  const json = JSON.stringify(held)
  expect(json).not.toMatch(/alice|secret|sk-abc|main\.ts|\/Users|cat /)
  expect(weekRecordFrom(held).days).toEqual([{ day: '2026-10-02', pages: 1, green: 0 }])
})

test('WEEK a red-to-green run reaches the day', async ($, on) => {
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  await $.turn.start({ text: 'make the tests pass', turnId: 't1' })
  f.w.fails = true; f.worker.outcome = 'fail'
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  f.w.fails = false; f.worker.outcome = 'pass'
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ answer: 'Fixed.', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  const day = weekRecordFrom(f.store('days:v1')).days[0]!
  expect(day).toEqual({ day: '2026-10-02', pages: 1, green: 1 })
})

test('WEEK turning the setting off deletes the record and stops writing', async ($, on) => {
  const f = fixture(on, { store: finished })
  const ui = await open($, f, 'settings')
  expect(await ui.find({ key: 'coco:set:week:off' })).toBeDefined()
  await ui.press({ key: 'coco:set:week:off' }); await ui.redraw()
  expect(f.store('days:v1')).toBeUndefined()
  await $.turn.start({ text: 'one more', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(f.store('days:v1')).toBeUndefined()
  await ui.press({ key: 'coco:set:week:on' }); await ui.redraw()
  await $.turn.start({ text: 'again', turnId: 't3' })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't3', reason: 'answer' })
  expect(weekRecordFrom(f.store('days:v1')).days.length).toBe(1)
  await ui.unmount()
})

test('WEEK no midnight timer: three days with no event write and draw nothing', async ($, on) => {
  const f = fixture(on, { store: finished })
  await $.session.start(START); await settleLegacyStart($, f.w)
  const before = JSON.stringify(f.store('days:v1'))
  await f.w.clock.advance(3 * 86400000)
  expect(JSON.stringify(f.store('days:v1'))).toBe(before)
})

test('WEEK on the terminal the section is words only: the numbers, no day rows and no picture', async ($, on) => {
  const f = fixture(on, { store: finished, surfaces: ['terminal'] })
  await $.session.start({ ...START, surface: 'terminal' }); await settleLegacyStart($, f.w)
  await $.command.run({ command: 'coco', args: 'log', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 100 } })
  const text = allText(await ui.drawn())
  expect(text).toContain('97 pages together, 5 green runs')
  expect(text).not.toContain('Mon: 34')
  expect((await svgAlts(ui)).some(alt => /pages;/.test(alt))).toBe(false)
  expect(await ui.find({ key: 'coco:week:save' })).toBeDefined()
  await ui.unmount()
  const narrow = await $.ui.mount({ surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 24 } })
  expect(allText(await narrow.drawn())).toContain('97 pages together, 5 green runs')
  await narrow.unmount()
})
