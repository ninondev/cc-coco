import { describe, expect, test } from 'claude-code/testing'
import { cells, desktopBand, planDesktop, terminalBand, rowsOf } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LANGS, WORDS, quotaDetailGroups } from '../hooks/words'
import { durationText } from '../hooks/numbers'
import { BAND_BOOK_WORDS } from '../hooks/book-band-words'
import { COLUMN_PX, planPx } from '../hooks/typeset'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { MORNING, PERSON, P, RECENT, band, world, settleLegacyStart } from './world'

// The band redesign of 10-09 (BAND.md): the pure fixes and the cue line, held by trees and plans.
const corpus = JSON.parse(C3_WORDS_RAW)
const ALL = LANGS.map(l => l.code)
// Mounting is the slow part; the trees of five scripts and the plans of all thirteen languages hold each rule.
const SOME = ['en', 'zh', 'ja', 'de', 'hi'] as const
const text = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.children ?? []) : ''
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]
// What a person can see at rest: every node outside a Box that is drawn display "none" until the pointer is over it.
const resting = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(resting) : node.props?.display === 'none' ? [] : [node, ...(node.children ?? []).flatMap(resting)]
const hoverBoxes = (tree: any) => nodes(tree).filter(n => n.type === 'Box' && n.props?.position === 'absolute' && n.props?.display === 'none')
const size = (columns: number, isWorking = false) => ({ columns, isWorking, maxRows: 30, screenRows: 48 })
const quota = { rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-02T11:40:00Z' }, { kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-06T09:00:00Z' }], tokens: 12000, at: MORNING } as any
const sprite = (plan: { height: number }) => `<svg width="${plan.height === 64 ? 79.5 : 39.75}" height="${plan.height}"></svg>`

// One render handler per test, registered before the first mount: the kit refuses a hook added after $ was used.
type Rig = { surface: 'desktop' | 'terminal'; view: any; columns: number; working: boolean; plan?: any }
const rigs = new WeakMap<object, Rig>()
function rigFor(on: any): Rig {
  let rig = rigs.get(on)
  if (rig) return rig
  const fresh: Rig = rig = { surface: 'desktop', view: undefined, columns: 90, working: false }
  rigs.set(on, fresh)
  on('ui.render', { component: 'Pane', requestId: 'b4-band' }, ($: any, e: any) => fresh.surface === 'desktop'
    ? desktopBand($.ui.resolve(e), fresh.view, size(fresh.columns, fresh.working), sprite(fresh.plan), fresh.plan)
    : terminalBand($.ui.resolve(e), fresh.view, size(fresh.columns, fresh.working)))
  world(on)
  return fresh
}
async function drawn($: any, rig: Rig) {
  const ui = await $.ui.mount({ surface: rig.surface, plugin: 'coco', component: 'Pane', requestId: 'b4-band', props: { title: 'B4', isFocused: true, bodyColumns: rig.columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}
async function desktopTree($: any, on: any, view: any, columns: number, working = false) {
  const rig = rigFor(on)
  const plan = planDesktop(view, size(columns, working))
  Object.assign(rig, { surface: 'desktop', view, columns, working, plan })
  return { tree: await drawn($, rig), plan }
}
async function terminalTree($: any, on: any, view: any, columns: number, working = false) {
  const rig = rigFor(on)
  // The terminal draws no sprite here (compact): the pictures are not loaded in a bare mount, and the cue row does not depend on them.
  Object.assign(rig, { surface: 'terminal', view: { ...view, band: 'compact' }, columns, working, plan: undefined })
  return drawn($, rig)
}

describe('F1: the band never draws a placeholder character', () => {
  test('an unknown cost and an unknown context leave their groups out of every quota reading', () => {
    expect(quotaDetailGroups('en', [], undefined, undefined)).toEqual([])
    expect(quotaDetailGroups('en', [{ kind: 'five_hour', percentUsed: 0 }], undefined, undefined)).toEqual(['5-hour window 0% used'])
    expect(quotaDetailGroups('en', [], undefined, 1.84)).toEqual(['spent $1.84'])
  })
  for (const lang of SOME) test(`${lang}: terminal and desktop, rest and hover, with no cost and no context figure`, async ($, on) => {
    const view = { ...initialView(), lang, context: null, quota } as any
    const drawn: string[] = []
    for (const columns of [24, 63, 160]) drawn.push(text(await terminalTree($, on, view, columns)))
    for (const columns of [34, 90]) drawn.push(text((await desktopTree($, on, view, columns)).tree))
    for (const shown of drawn) expect([lang, shown.includes('—')]).toEqual([lang, false])
  })
  // The commit line (lane C, 10-14) keeps its place without a reading, empty, with the 'no reading' alt.
  test('an unknown context draws an empty commit line without a figure on the desktop, and nothing on the terminal', async ($, on) => {
    const view = { ...initialView(), context: null, quota } as any
    const { tree } = await desktopTree($, on, view, 90)
    const svg = nodes(tree).filter(n => n.type === 'Svg').map(n => n.props.alt as string)
    expect(svg).toContain(BAND_BOOK_WORDS.en.noReading)
    expect(text(resting(tree))).not.toMatch(/%\s*context/)
    expect(text(await terminalTree($, on, view, 96))).not.toContain('◉')
  })
})

describe('F14: durations drop a zero trailing unit', () => {
  test('every language writes 2 minutes, not 2 minutes 0 seconds', () => {
    for (const lang of ALL) {
      const examples = BAND_BOOK_WORDS[lang].durations
      for (const [seconds, index] of [[120, 2], [3600, 3], [4 * 86400, 4]] as const) {
        const shown = durationText(seconds, lang, examples)
        expect([lang, seconds, /(?:^|\D)0(?:\D|$)/.test(shown)]).toEqual([lang, seconds, false])
      }
      expect(durationText(120, lang, examples)).toBe(examples[2]!.replace(/\d+/, '2'))
      expect(durationText(130, lang, examples)).toBe(examples[1]!.replace(/\d+/g, (_, at: number) => (at === examples[1]!.search(/\d/) ? '2' : '10')))
    }
    expect(durationText(3600, 'en', BAND_BOOK_WORDS.en.durations)).toBe('1h')
    expect(durationText(4 * 86400, 'zh', BAND_BOOK_WORDS.zh.durations)).toBe('4天')
    expect(durationText(3 * 86400 + 4 * 3600, 'zh', BAND_BOOK_WORDS.zh.durations)).toBe('3天4时')
  })
})

describe('F13: stage directions are italic where the script has italics', () => {
  for (const lang of SOME) test(`${lang}: terminal and desktop`, async ($, on) => {
    const italic = !['zh', 'zh-Hant', 'ja', 'ko', 'hi'].includes(lang)
    const view = { ...initialView(), lang, context: 40, quota } as any
    const direction = WORDS[lang].aside.idle.replace(/\*/g, '')
    const hits = (tree: any) => nodes(tree).filter(n => n.type === 'Text' && text(n).replace(/ /g, ' ').trim() === direction.trim())
    const desktop = hits((await desktopTree($, on, view, 180)).tree)
    expect(desktop.length).toBeGreaterThan(0)
    for (const node of desktop) expect([lang, node.props?.italic === true]).toEqual([lang, italic])
    const terminal = hits(await terminalTree($, on, view, 160))
    expect(terminal.length).toBeGreaterThan(0)
    for (const node of terminal) expect([lang, node.props?.italic === true]).toEqual([lang, italic])
  })
})

// DECISIONS 1017-1019 (10-18): her things stand on the floor with the bag last, Poke, Pat and Close open beside her picture,
// and her line follows her name on the script row.
const floorOf = (tree: any) => nodes(tree).find(n => n.type === 'Box' && n.props?.key === 'coco:floor')
const strip = (tree: any) => (nodes(tree).find(n => n.type === 'Box' && n.props?.key === 'coco:picture')?.children ?? []).find((n: any) => n.type === 'Box' && n.props?.position === 'absolute' && n.props?.display === 'none')
const stripKeys = (tree: any) => nodes(strip(tree)).filter(n => n.type === 'Button').map(n => n.props.key)

describe('F4, F7 and the floor on the desktop', () => {
  for (const lang of SOME) for (const columns of [34, 60, 180]) test(`${lang} at ${columns} columns: her things and the bag stand on the floor, visible at rest`, async ($, on) => {
    const view = { ...initialView(), lang, context: 47, quota } as any
    const { tree, plan } = await desktopTree($, on, view, columns)
    const column = nodes(tree).find(n => n.type === 'Box' && n.props?.key === 'coco:text-column')
    expect(column).toBeDefined()
    expect(column.props.marginRight).toBe(2) // F7: the right edge keeps two columns
    const floor = floorOf(tree)
    expect(floor.props.position).toBe('absolute')
    expect(resting(floor).length).toBeGreaterThan(0)
    // the bag is the native button, the last thing on the floor
    const bag = nodes(floor.children.at(-1)).find(n => n.type === 'Button')
    expect(bag.props.key).toBe('coco:book:open')
    expect(bag.props.plain).toBeUndefined()
    expect(text(bag)).toContain(WORDS[lang].marks.book)
    // the commit line steps aside only where the cells gave way
    expect(resting(floor).some(n => n.type === 'Svg' && /viewBox="0 0 \d+ 6"/.test(String(n.props.source)))).toBe(plan.cells !== false)
    expect(resting(floor).some(n => n.type === 'Svg' && String(n.props.source).includes('viewBox="0 0 26 12"'))).toBe(true) // her battery, at any width
    expect(plan.label).toBe(WORDS[lang].marks.book)
    // the strip holds no second bag
    const keys = stripKeys(tree)
    expect(strip(tree).props.top).toBe(2)
    expect(keys.at(-1)).toBe('coco:band:close')
    expect(keys).not.toContain('coco:book:open')
  })
  test('the bag is on the one-row band too, and the strip starts after his name there', async ($, on) => {
    // the pixel band is the one-row band, resting or working
    for (const working of [false, true]) {
      const view = { ...initialView(), band: 'compact' as const, context: 47, quota } as any
      const { tree } = await desktopTree($, on, view, 90, working)
      const column = nodes(tree).find(n => n.type === 'Box' && n.props?.key === 'coco:text-column')
      expect(resting(column.children[0]).some(n => n.type === 'Button' && n.props.key === 'coco:book:open')).toBe(true)
      expect(floorOf(tree)).toBeUndefined()
    }
    const view = { ...initialView(), band: 'compact' as const, context: 47, quota } as any
    const { tree } = await desktopTree($, on, view, 90)
    expect(strip(tree).props.top).toBe(0)
    expect(strip(tree).props.left * COLUMN_PX).toBeGreaterThanOrEqual(39.75 + 37) // 'Coco' is about 37 px wide in bold (planPx)
  })
  test('the strip gives Poke and Pat up together, never Close', async ($, on) => {
    const seen = new Set<number>()
    for (const columns of [34, 38, 46, 60, 80, 120, 200]) {
      const view = { ...initialView(), context: 47, quota: { ...quota, costUSD: 1.84 } } as any
      const { tree } = await desktopTree($, on, view, columns)
      const keys = stripKeys(tree)
      expect(keys.at(-1)).toBe('coco:band:close')
      expect(keys.includes('coco:band:poke')).toBe(keys.includes('coco:band:pat'))
      expect(nodes(strip(tree)).some(n => n.type === 'Text' && n.props?.color === 'inactive')).toBe(false)
      seen.add(keys.length)
    }
    expect([...seen].includes(3)).toBe(true)
  })
  test('while he speaks, the strip still stands beside her on the floor row', async ($, on) => {
    const said = 'the offering box is almost full. time to sweep it out soon.'
    const view = { ...initialView(), context: 47, quota, said, mood: 'happy' as const } as any
    const wide = (await desktopTree($, on, view, 120)).tree
    expect(strip(wide).props.top).toBe(2)
    expect(stripKeys(wide)).toEqual(['coco:band:poke', 'coco:band:pat', 'coco:band:close'])
    const narrow = (await desktopTree($, on, view, 34)).tree
    expect(stripKeys(narrow).at(-1)).toBe('coco:band:close')
  })
  test('his line follows his name on the script row', async ($, on) => {
    const said = 'the offering box is almost full. time to sweep it out soon.'
    const view = { ...initialView(), context: 47, quota, said, mood: 'happy' as const } as any
    const { tree } = await desktopTree($, on, view, 120)
    const column = nodes(tree).find(n => n.type === 'Box' && n.props?.key === 'coco:text-column')
    const row = text(resting(column.children[0]))
    expect(row.startsWith(WORDS.en.name)).toBe(true)
    expect(row).toContain('offering box')
    expect(text(resting(floorOf(tree)))).not.toContain('offering box')
  })
})

describe('the picture shrinks to 32 px only where the floor would drop the context number (CANON 199)', () => {
  for (const lang of ALL) test(`${lang}: 64 px from 28 columns up, 32 px at 24, never speech-dependent`, () => {
    const view = { ...initialView(), lang, context: 47, quota } as any
    for (const columns of [28, 34, 90]) {
      const plan = planDesktop(view, size(columns))
      expect([columns, plan.height, plan.name, plan.row]).toEqual([columns, 64, WORDS[lang].name, false])
      expect(planDesktop({ ...view, said: 'a line he says.' }, size(columns)).height).toBe(64)
    }
    expect(planDesktop(view, size(24)).height).toBe(32)
    // a pixel person has 32 px at every width
    expect(planDesktop({ ...view, band: 'compact' }, size(90)).height).toBe(32)
  })
  test('the give-up order only ever gets poorer as the band narrows', () => {
    for (const lang of ALL) {
      let frame = 0, place = 0
      for (let columns = 200; columns >= 30; columns--) {
        const plan = planDesktop({ ...initialView(), lang, context: 47, quota } as any, size(columns))
        expect([lang, columns, plan.frame >= frame]).toEqual([lang, columns, true])
        if (plan.frame === frame) expect([lang, columns, plan.place >= place]).toEqual([lang, columns, true])
        frame = plan.frame; place = plan.place
      }
    }
  })
})


describe('F2 and the box at 24 to 30 columns: a line keeps its place on the one-row band', () => {
  for (const lang of ALL) for (const columns of [24, 30]) test(`${lang} at ${columns} columns: one row, the box gives way, his name goes before the line is cut, Book stays`, async ($, on) => {
    const name = 'Explore'
    const lineText = (corpus['neighbour.busy'][lang] as string).replace('{agent}', name)
    const view = { ...initialView(), lang, context: 34, quota, mood: 'happy' as const, line: { id: 'neighbour:busy', key: 'neighbour.busy', text: lineText, class: 1 as const, slots: [{ value: name, kind: 'value' as const }], expiresAt: 4_000_000_000_000 } } as any
    const tree = await terminalTree($, on, view, columns, true)
    const shown = text(tree)
    expect(rowsOf(tree)).toBe(1)
    // his name goes before the line is cut: it stays only where the whole line stands beside it
    if (shown.includes(WORDS[lang].name)) expect([lang, columns, shown.replace(/\u00a0/g, ' ').includes(lineText)]).toEqual([lang, columns, true])
    expect([lang, columns, shown.includes('◉')]).toEqual([lang, columns, false])
    expect(nodes(tree).some(n => n.type === 'Button' && n.props?.key === 'coco:book:open')).toBe(true)
    // the whole line, or the cut line ends in a mark; never a bare cut and never an empty row
    expect(shown.replace(WORDS[lang].marks.shelf, '').trim().length).toBeGreaterThan(0)
    const widest = cells(shown)
    expect(widest).toBeLessThanOrEqual(columns)
  })
  test('from 31 columns the box is back while a line shows', async ($, on) => {
    const view = { ...initialView(), context: 34, quota, mood: 'happy' as const, said: 'ok.' } as any
    expect(text(await terminalTree($, on, view, 60, true))).toContain('◉') // the commit line (lane C, 10-14)
  })
})

