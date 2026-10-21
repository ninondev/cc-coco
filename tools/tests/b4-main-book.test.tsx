import { describe, expect, test } from 'claude-code/testing'
import { desktopBook, terminalBook, pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import { PAGES } from '../hooks/book-words'
import type { BookWords } from '../hooks/book-words'
import { cells } from '../hooks/band'
import { desktopWidth } from '../hooks/pictures-lazy'
import { loadD1Words } from '../hooks/d1-words'
import { LANGS, WORDS } from '../hooks/words'
import { nowFit } from '../hooks/companion-book'
import { BOOK_FILES } from './book-files'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { MORNING, PERSON, P, RECENT, settleLegacyStart, world } from './world'

// His book after the redesign of 10-09 (BOOK.md): his room for pixel people and the painted portrait for painted ones, the
// label column, the 72-column measure, group titles with a grey rule, the unknown-figure lines, plain buttons on a narrow
// terminal and the pane title in his name.
const ALL = LANGS.map(l => l.code)
const words = (lang: string) => JSON.parse(BOOK_FILES[`${lang}.json`] ?? 'null') as BookWords
const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children ?? []) : ''
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]
const press = { go() {}, turn() {}, marks() {} } as any
const PORTRAIT = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"></svg>'
const ROOM = { source: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', alt: 'the room', width: 320, height: 180 }

function data(lang: string, change: Partial<BookData> = {}, band: 'on' | 'compact' | 'off' = 'on'): BookData {
  return {
    view: { mood: 'idle', frame: 'idle-reading', said: null, context: 32, estimate: false, verb: 'reading', band, voice: 'off', affection: 'warm', lang, pictures: 'cells', colors: 'truecolor', cue: 'claude' } as any,
    own: WORDS[lang as 'en'], now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', voiceSizes: { light: 124, full: 456 }, reading: 0,
    store: { turns: 12, wilds: 1, firstMet: MORNING - 86_400_000, latestNight: { at: MORNING - 86_400_000, minutes: 60 }, lang: 'en' },
    usage: { startedAt: MORNING - 3_600_000, context: { window: 200000, tokens: 64000, percent: 32 }, rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-06T09:00:00Z' }], cost: { usd: 1.84 } },
    cache: 80,
    ...change,
  }
}
// One render handler per test, registered before the first mount: the kit refuses a hook added after $ was used.
type Rig = { surface: 'desktop' | 'terminal'; lang: string; book: any; d: BookData; columns: number }
const rigs = new WeakMap<object, Rig>()
function rigFor(on: any): Rig {
  const known = rigs.get(on)
  if (known) return known
  const rig = {} as Rig
  rigs.set(on, rig)
  on('ui.render', { component: 'Pane', requestId: 'b4-book' }, ($: any, e: any) => rig.surface === 'desktop'
    ? desktopBook($.ui.resolve(e), words(rig.lang), rig.book, rig.d, { source: PORTRAIT, height: 56 }, press, rig.columns, 'desktop')
    : terminalBook($.ui.resolve(e), words(rig.lang), rig.book, rig.d, press, rig.columns))
  world(on)
  return rig
}
async function drawn($: any, on: any, surface: 'desktop' | 'terminal', lang: string, page: string, columns: number, d: BookData, extra: Record<string, unknown> = {}) {
  const rig = rigFor(on)
  Object.assign(rig, { surface, lang, columns, d, book: { page, reading: 0, rev: 0, ...extra } })
  const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'b4-book', props: { title: 'B4', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}
const svgs = (tree: any) => nodes(tree).filter(n => n.type === 'Svg')

describe('the book\'s pictures: his room for a pixel person, the painted portrait for a painted one', () => {
  test('a painted person keeps the portrait beside every title', async ($, on) => {
    for (const page of ['omen', 'offerings', 'log', 'library', 'settings']) {
      const tree = await drawn($, on, 'desktop', 'en', page, 64, data('en', {}, 'on'))
      expect(svgs(tree).some(n => n.props.source === PORTRAIT && n.props.width === desktopWidth(56))).toBe(true)
    }
  })
  test('a pixel person has no sticker on any page, and no corner of the room either', async ($, on) => {
    for (const page of ['offerings', 'log', 'library', 'settings']) {
      const tree = await drawn($, on, 'desktop', 'en', page, 64, data('en', {}, 'compact'))
      expect(svgs(tree).some(n => n.props.source === PORTRAIT)).toBe(false)
      expect(svgs(tree).filter(n => n.props.width === 320 || n.props.width === 160).length).toBe(0)
    }
    const vibe = await drawn($, on, 'desktop', 'en', 'omen', 64, data('en', {}, 'compact'))
    expect(svgs(vibe).some(n => n.props.source === PORTRAIT)).toBe(false)
  })
  test('his page shows the whole room to both, and a painted person has no sticker there', async ($, on) => {
    for (const band of ['on', 'compact'] as const) {
      const tree = await drawn($, on, 'desktop', 'en', 'him', 64, data('en', { roomPicture: ROOM, roomNarration: 'the room' }, band))
      expect(svgs(tree).some(n => n.props.source === ROOM.source && n.props.width === 320 && n.props.height === 180)).toBe(true)
      expect(svgs(tree).some(n => n.props.source === PORTRAIT)).toBe(false)
    }
  })
  test('a pixel person whose band is off is still a pixel person', async ($, on) => {
    const tree = await drawn($, on, 'desktop', 'en', 'settings', 64, data('en', { view: { ...data('en').view!, band: 'off', bandBeforeOff: 'compact' } as any }))
    expect(svgs(tree).some(n => n.props.source === PORTRAIT)).toBe(false)
  })
})

describe('the label column, the measure and the group titles', () => {
  test('from 48 columns the labels stand in their own column; below it they stand over their buttons', async ($, on) => {
    const wide = await drawn($, on, 'desktop', 'en', 'settings', 64, data('en'))
    const labelBoxes = nodes(wide).filter(n => n.type === 'Box' && typeof n.props?.width === 'number' && n.props.width >= 8 && n.props.width <= 18 && n.props.flexShrink === 0)
    expect(labelBoxes.length).toBeGreaterThan(5)
    const narrow = await drawn($, on, 'desktop', 'en', 'settings', 40, data('en'))
    expect(nodes(narrow).filter(n => n.type === 'Box' && typeof n.props?.width === 'number' && n.props.width >= 8 && n.props.width <= 18 && n.props.flexShrink === 0).length).toBe(0)
  })
  test('the body never runs wider than 72 columns', async ($, on) => {
    for (const surface of ['desktop', 'terminal'] as const) {
      const tree = await drawn($, on, surface, 'en', 'library', 120, data('en'))
      expect(nodes(tree).some(n => n.type === 'Box' && n.props?.width === 72)).toBe(true)
      const small = await drawn($, on, surface, 'en', 'library', 40, data('en'))
      expect(nodes(small).some(n => n.type === 'Box' && n.props?.width === 40)).toBe(true)
    }
  })
  test('a group title has two blank rows above it and a grey rule, never vermilion, under it', async ($, on) => {
    const tree = await drawn($, on, 'desktop', 'en', 'settings', 64, data('en'))
    const rules = svgs(tree).filter(n => n.props.alt === '' && n.props.height === 7)
    expect(rules.length).toBeGreaterThanOrEqual(2)
    for (const rule of rules) { expect(rule.props.source).not.toContain('#C75730'); expect(rule.props.source).toContain('#8C877E') }
    const titles = nodes(tree).filter(n => n.type === 'Box' && n.props?.marginTop === 2)
    expect(titles.some(box => text(box).includes(words('en').settings.reminders))).toBe(true)
    const terminal = await drawn($, on, 'terminal', 'en', 'settings', 60, data('en'))
    expect(nodes(terminal).some(n => n.type === 'Text' && n.props?.color === 'inactive' && /^─+$/.test(text(n)))).toBe(true)
  })
})

describe('F3: Offerings never draw a figure without its words', () => {
  test('an unknown cost, start and cache leave their lines out; with none known there is one note', async ($, on) => {
    const d = data('en', { usage: undefined, cache: null })
    const blocks = pageBlocks('offerings', words('en'), d)
    expect(blocks.some(b => b.t === 'para' && b.text.includes('—'))).toBe(false)
    const session = blocks.slice(blocks.findIndex(b => b.t === 'heading' && b.text === words('en').offerings.session) + 1)
    expect(session.filter(b => b.t === 'para').length).toBe(0)
    expect(session.filter(b => b.t === 'note' && b.text === words('en').offerings.noReading).length).toBe(1)
    const tree = await drawn($, on, 'desktop', 'en', 'offerings', 64, d)
    expect(text(tree)).not.toContain('—')
  })
  // A dollar figure needs a named payer first (K1 W5, COST-CACHE.md): the ledger alone is not a bill, so these two
  // tests give the figure a payer snapshot and then take it away.
  const payer = { billing: { kind: 'api' }, cache: { observed: false, state: 'cold', sentAt: 0, warmUntil: 0, ttlMs: 300000, prefix: 0 }, warmEnabled: false, sessionUSD: 1.84 } as any
  const unknownBut = { startedAt: undefined, context: undefined, rateLimits: [], cost: { usd: 1.84 } } as any
  const sessionOf = (blocks: ReturnType<typeof pageBlocks>) => blocks.slice(blocks.findIndex(b => b.t === 'heading' && b.text === words('en').offerings.session) + 1)
  test('what is known stays, each line with its own words', () => {
    const session = sessionOf(pageBlocks('offerings', words('en'), data('en', { cache: null, cost: payer, usage: unknownBut })))
    const lines = session.filter(b => b.t === 'para').map(b => (b as any).text as string)
    expect(lines.length).toBe(1)
    expect(lines[0]).toBe('Cost so far: $1.84')
    expect(session.some(b => b.t === 'note' && b.text === words('en').offerings.noReading)).toBe(false)
  })
  test('a ledger figure with no payer snapshot is left out and the one note says so', () => {
    const blocks = pageBlocks('offerings', words('en'), data('en', { cache: null, usage: unknownBut }))
    const session = sessionOf(blocks)
    expect(blocks.some(b => b.t === 'para' && b.text.includes('$'))).toBe(false)
    expect(session.filter(b => b.t === 'para').length).toBe(0)
    expect(session.filter(b => b.t === 'note' && b.text === words('en').offerings.noReading).length).toBe(1)
  })
})

describe('the terminal book on a narrow pane', () => {
  test('under 32 columns the tabs are plain buttons with a gap of two columns', async ($, on) => {
    const tree = await drawn($, on, 'terminal', 'it', 'omen', 24, data('it'))
    const tabs = nodes(tree).filter(n => n.type === 'Button' && String(n.props.key).startsWith('coco:book:tab:'))
    expect(tabs.length).toBe(7) // her itabag's seven pages (lane C, 10-14)
    for (const tab of tabs) { expect(tab.props.plain).toBe(true); expect(/^\d/.test(tab.props.label)).toBe(false) }
    const row = nodes(tree).find(n => n.type === 'Box' && n.props?.columnGap === 2)
    expect(row).toBeDefined()
    const wide = await drawn($, on, 'terminal', 'it', 'omen', 40, data('it'))
    expect(nodes(wide).filter(n => n.type === 'Button' && String(n.props.key).startsWith('coco:book:tab:')).every(n => n.props.plain !== true)).toBe(true)
  })
  for (const lang of ALL) test(`${lang}: no button is wider than a 24-column pane, on any page (F12)`, async ($, on) => {
    const wrong: string[] = []
    for (const page of PAGES) {
      const tree = await drawn($, on, 'terminal', lang, page, 24, data(lang, {}, 'on'), { languages: true })
      for (const button of nodes(tree).filter(n => n.type === 'Button')) {
        const shown = button.props.plain ? `${button.props.hotkey ? button.props.hotkey + ': ' : ''}${button.props.label}` : `[ ${button.props.label} ]`
        if (cells(shown) > 24) wrong.push(`${lang}.${page}: ${shown}`)
      }
    }
    expect(wrong).toEqual([])
  })
  test('a group whose bracketed buttons do not fit is drawn plain, one to a row, and one that fits keeps its brackets', async ($, on) => {
    const narrow = await drawn($, on, 'terminal', 'es-419', 'settings', 24, data('es-419'))
    const language = nodes(narrow).filter(n => n.type === 'Button' && String(n.props.key).startsWith('coco:set:lang:'))
    expect(language.length).toBeGreaterThan(10)
    expect(language.every(n => n.props.plain === true)).toBe(true)
    const wide = await drawn($, on, 'terminal', 'es-419', 'settings', 60, data('es-419'))
    expect(nodes(wide).filter(n => n.type === 'Button' && String(n.props.key).startsWith('coco:set:lang:')).every(n => n.props.plain !== true)).toBe(true)
  })
  test('his page keeps a blank row between the room narration and his two lines', () => {
    const blocks = pageBlocks('him', words('en'), data('en', { roomNarration: 'a room, a window, a desk.' }), 'terminal')
    expect(blocks[0]).toEqual({ t: 'para', text: 'a room, a window, a desk.', space: true })
  })
})

describe('"Now: value" keeps its no-break spaces only when the whole line fits', () => {
  test('nowFit', () => {
    expect(nowFit('Now: Automatic · English', 40)).toBe('Now: Automatic · English')
    expect(nowFit('Now: Automatic · English', 20)).toBe('Now: Automatic · English')
  })
  test('on a 24-column pane the language line wraps in Italian and German', async ($, on) => {
    for (const lang of ['it', 'de']) {
      const tree = await drawn($, on, 'terminal', lang, 'settings', 24, data(lang))
      const long = nodes(tree).filter(n => n.type === 'Text').map(text).filter(t => t.length > 22 && !/^─+$/.test(t))
      for (const line of long) expect([lang, line.includes(' ')]).toEqual([lang, false])
    }
  })
})

describe('his page head: the direction in italics, his words upright', () => {
  test('(opens the door) is italic, come in. is not; in Chinese all stays upright', async ($, on) => {
    await loadD1Words(async () => D1_WORDS_TEXT)
    const tree = await drawn($, on, 'desktop', 'en', 'him', 64, data('en', { roomPicture: ROOM, roomNarration: 'the room' }))
    const aside = nodes(tree).find(n => n.type === 'Text' && n.props?.italic === true && text(n) === '(opens the door)')
    expect(aside).toBeDefined()
    expect(nodes(tree).some(n => n.type === 'Text' && n.props?.italic === true && text(n).includes('come in'))).toBe(false)
    const zh = await drawn($, on, 'desktop', 'zh', 'him', 64, data('zh', { roomPicture: ROOM, roomNarration: '房间' }))
    expect(nodes(zh).some(n => n.type === 'Text' && n.props?.italic === true)).toBe(false)
  })
})

describe('the pane title is his name', () => {
  for (const [lang, name] of [['zh', '小克'], ['zh-Hant', '小克'], ['ja', 'Coco'], ['ko', '코코'], ['en', 'Coco'], ['de', 'Coco']] as const) test(`${lang}: ${name}`, async ($, on) => {
    const titles: string[] = []
    // a filtered middleware beside the world's own ui.open: it notes the title and lets the call through
    on('ui.open', { id: 'coco-book' }, ($: any, e: any, next: any) => { titles.push(e.title); return next(e) })
    const w = world(on, { store: RECENT, env: { LANG: ({ zh: 'zh_CN.UTF-8', 'zh-Hant': 'zh_TW.UTF-8', ja: 'ja_JP.UTF-8', ko: 'ko_KR.UTF-8', en: 'en_US.UTF-8', de: 'de_DE.UTF-8' } as Record<string, string>)[lang]! } })
    await loadD1Words(async () => D1_WORDS_TEXT)
    await $.session.start({ cwd: '/tmp/project', surface: 'desktop', isInteractive: true })
    await settleLegacyStart($, w)
    await $.command.run({ command: 'coco', args: 'lang ' + lang, origin: PERSON, presentation: P })
    await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
    expect(titles.at(-1)).toBe(name)
  })
})
