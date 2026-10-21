// His guest book: the page, its months, its states, the button on His page, the Settings row (VISITORS.md 4, 7, 9: V9, V10).
// The words are the shipped table.
import { describe, expect, test } from 'claude-code/testing'
import { desktopBook, pageBlocks, terminalBook } from '../hooks/book'
import type { BookData, Press } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { forgetVisitorData, guestBook, guestBookReading, loadVisitorData, visitorWord } from '../hooks/visitors-art'
import type { Visit } from '../hooks/visitors'
import { BOOK_FILES } from './book-files'
import { WORDS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { MORNING, world } from './world'
import { VISITORS_TEXT_RAW } from './visitors-text-fixture'
import { VISITOR_ART_TEXT } from './visitor-art-fixture'

const ART_TEXT = VISITOR_ART_TEXT
const read = async (path: string) => path.endsWith('visitor-art.json') ? ART_TEXT : VISITORS_TEXT_RAW
const words = JSON.parse(BOOK_FILES['en.json']!) as BookWords
const at = (iso: string) => Date.parse(iso)
const VISITS: Visit[] = [
  { id: 'visit:3:1', kind: 'keycap', at: at('2026-09-30T10:12:00Z'), leftAt: at('2026-09-30T10:40:00Z') },
  { id: 'visit:5:2', kind: 'bulb', at: at('2026-10-02T15:42:00Z'), leftAt: at('2026-10-02T16:00:00Z') },
  { id: 'visit:6:3', kind: 'usb', at: at('2026-10-05T23:51:00Z'), leftAt: at('2026-10-06T00:30:00Z') },
  { id: 'visit:9:4', kind: 'plane', at: at('2026-10-08T11:20:00Z') },
]
const base = (extra: Partial<BookData> = {}): BookData => ({ view: initialView(), usage: undefined, store: {}, now: MORNING, timeZone: 'UTC', reducedMotion: true, marks: 'off', voiceSizes: { light: 1, full: 1 }, fortune: undefined, reading: 0, own: WORDS.en, ...extra })
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'visitors-book', props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const texts = (node: any): string[] => Array.isArray(node) ? node.flatMap(texts) : typeof node === 'string' ? [node] : node && typeof node === 'object' ? texts(node.children ?? []) : []

const fresh = async () => { forgetVisitorData(); await loadVisitorData(read) }

describe('the guest book, one month a page, newest first', () => {
  test('the newest month first: portrait, when, and who, nothing more', async () => {
    await fresh()
    const g = guestBook(VISITS, 0, 'en', 'UTC', 'Coco', '‹ His page')
    expect(g.state).toBe('list')
    expect(g.month).toBe('October 2026')
    expect(g.rows.map(r => r.id)).toEqual(['visit:9:4', 'visit:6:3', 'visit:5:2'])
    expect(g.rows.map(r => r.name)).toEqual(['a paper plane', 'a blinking USB stick', 'a light bulb'])
    // the engine's ICU joins a date and a time with «, » or, newer, « at »: both are the locale's own words
    expect(g.rows[0]!.when).toMatch(/^Thu, Oct 8(,| at) 11:20$/)
    expect(g.rows.every(r => r.portrait.startsWith('<svg') && r.portrait.includes('width="44"'))).toBe(true)
    expect(Object.keys(g.rows[0]!).sort()).toEqual(['id', 'name', 'portrait', 'when'])
    expect(g.previous).toBe('‹ September')
    expect(g.next).toBeUndefined()
  })
  test('an older month has a way forward, and a month past the oldest stays on the oldest', async () => {
    await fresh()
    const g = guestBook(VISITS, 1, 'en', 'UTC', 'Coco', '‹ His page')
    expect(g.month).toBe('September 2026')
    expect(g.rows.map(r => r.id)).toEqual(['visit:3:1'])
    expect(g.next).toBe('October ›')
    expect(g.previous).toBeUndefined()
    expect(guestBook(VISITS, 9, 'en', 'UTC', 'Coco', '‹ His page').month).toBe('September 2026')
    expect(guestBook(VISITS, -3, 'en', 'UTC', 'Coco', '‹ His page').month).toBe('October 2026')
  })
  test('a visit after dark is on night paper, by day on his paper', async () => {
    await fresh()
    const g = guestBook(VISITS, 0, 'en', 'UTC', 'Coco', '‹ His page')
    expect(g.rows[1]!.portrait).toContain('#2B3A5E')
    expect(g.rows[0]!.portrait).toContain('#FAEEE9')
    expect(g.rows[2]!.portrait).toContain('#FAEEE9')
  })
  test('the paper takes the stamp pages’ stronger edge when more contrast is asked for', async () => {
    await fresh()
    expect(guestBook(VISITS, 0, 'en', 'UTC', 'x', 'y').rows[0]!.portrait).toContain('@media(prefers-contrast:more){.p{stroke:#8E8481}}')
  })
  test('empty and unreadable say so in a line, and keep the title and the way back', async () => {
    await fresh()
    const empty = guestBook([], 0, 'en', 'UTC', 'Coco', '‹ His page')
    expect(empty).toMatchObject({ state: 'empty', text: 'no visitors yet. they come by during a doze.', title: 'visitors', back: '‹ His page' })
    const broken = guestBook(undefined, 0, 'en', 'UTC', 'Coco', '‹ His page')
    expect(broken.state).toBe('unreadable')
    expect(broken.text).toBe('they could not read their notes. the file is kept')
  })
  test('reading his notes keeps the title and the way back and says so in a line, with no rows', async () => {
    await fresh()
    const reading = guestBookReading('en', 'Coco', '‹ His page')
    expect(reading).toMatchObject({ state: 'reading', text: 'reading their notes', title: 'visitors', direction: '(they show you who came by)', back: '‹ His page', rows: [] })
    const blocks = pageBlocks('him', words, base({ visitors: reading }), 'desktop')
    expect(blocks.some(b => b.t === 'para' && b.text === 'reading their notes')).toBe(true)
    expect(blocks.some(b => b.t === 'visit')).toBe(false)
    expect(guestBookReading('zh', 'x', 'y').text).toBe('在读她的笔记')
  })
  test('nothing counts or collects: no total, no blank slot, no mark of a first time', async () => {
    await fresh()
    const g = guestBook(VISITS, 0, 'en', 'UTC', 'Coco', '‹ His page')
    const everything = JSON.stringify({ ...g, rows: g.rows.map(({ portrait: _p, ...rest }) => rest) })
    expect(everything).not.toMatch(/\b(new|first|of \d|kinds|visits|total|streak)\b/i)
    expect(g.rows.length).toBe(3)
  })
})

describe('the page in the book', () => {
  const press = {} as Press
  const portrait = { source: '<svg width="73" height="64"></svg>', height: 64 }
  test('the desktop page: the way back above the title, the entries, and the way to the month before', async ($, on) => {
    await fresh()
    const data = base({ visitors: guestBook(VISITS, 0, 'en', 'UTC', 'Coco', '‹ His page') })
    on('ui.render', { component: 'Pane', requestId: 'visitors-book' }, ($, e) => desktopBook($.ui.resolve(e), words, { page: 'him', reading: 0, rev: 0, visitors: 0 }, data, portrait, press, 100))
    world(on)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Button', key: 'coco:visitors:back' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:visitors:previous' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:visitors:next' }).catch(() => undefined)).toBeUndefined()
    const all = texts(await ui.drawn()).join(' | ')
    expect(all).toContain('October 2026')
    expect(all).toContain('a paper plane')
    expect(all.indexOf('a paper plane')).toBeLessThan(all.indexOf('a light bulb'))
    expect(all).toContain('(they show you who came by)')
    await ui.unmount()
  })
  test('the terminal page is words only, with the way back and the month before', async ($, on) => {
    await fresh()
    const data = base({ visitors: guestBook(VISITS, 0, 'en', 'UTC', 'Coco', '‹ His page') })
    on('ui.render', { component: 'Pane', requestId: 'visitors-book' }, ($, e) => terminalBook($.ui.resolve(e), words, { page: 'him', reading: 0, rev: 0, visitors: 0 }, data, press, 60))
    world(on)
    const ui = await $.ui.mount({ surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Button', key: 'coco:visitors:back' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:visitors:previous' })).toBeDefined()
    expect(await ui.find({ type: 'Raster' }).catch(() => undefined)).toBeUndefined()
    expect(texts(await ui.drawn()).join(' | ')).toMatch(/Thu, Oct 8(,| at) 11:20/)
    await ui.unmount()
  })
  test('His page has the Visitors button only when it was given one, and only the terminal lists it as a block', async () => {
    await fresh()
    expect(pageBlocks('him', words, base({ visitorsButton: 'Visitors' }), 'terminal').some(b => b.t === 'button' && b.key === 'coco:visitors:open')).toBe(true)
    // His page carries other buttons too (the stick's, PLAY 4.2); these two look at the Visitors one only.
    expect(pageBlocks('him', words, base({ visitorsButton: 'Visitors' }), 'desktop').some(b => b.t === 'button' && b.key === 'coco:visitors:open')).toBe(false)
    expect(pageBlocks('him', words, base(), 'terminal').some(b => b.t === 'button' && b.key === 'coco:visitors:open')).toBe(false)
  })
})

describe('the Settings row', () => {
  const row = (store: Record<string, unknown>) => pageBlocks('settings', words, base({ store }), 'desktop').find(b => b.t === 'choice' && b.options.some(o => o.key.startsWith('coco:set:visitors:'))) as any
  test('is on by default, off only when chosen, and the buttons carry the design’s keys', async () => {
    await fresh()
    expect(row({}).current).toBe('on')
    expect(row({ visitors: true }).current).toBe('on')
    expect(row({ visitors: false }).current).toBe('off')
    expect(row({}).options.map((o: any) => o.key)).toEqual(['coco:set:visitors:on', 'coco:set:visitors:off'])
    expect(row({}).label).toBe('Visitors')
    expect(row({}).help).toBe(visitorWord('en', 'settings.visitors.help'))
  })
  test('is left out while its words are not shipped', async () => {
    await fresh()
    forgetVisitorData()
    expect(row({})).toBeUndefined()
  })
})
