// Her itabag (lane C, 10-14): the settings pane is 小克的痛包, seven pages in the owner's order with lane B's names, the
// bag's picture on top (its badges are the settings page's switches), a coral frame on the terminal, and her sock drawer
// on the fourth page, where a press puts a pair on her.

import { describe, expect, test } from 'claude-code/testing'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { COST_WORDS_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { settleLegacyStart, P, PERSON, RECENT, SUMMARY, world } from './world'
import { bagArtSvg } from '../hooks/bag'
import { bagMvSvg } from '../hooks/bag-mv'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const BAG = JSON.parse(BAG_TEXT_RAW) as Record<string, { title: string; pages: string[]; socks: string[]; alt: string[] }>
const PAIRS = ['honmei', 'matcha', 'blueberry', 'sesame', 'mint', 'strawberry', 'taro', 'marshmallow', 'goodgirl', 'nude', 'lan', 'whitehat', 'reddot']
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const nodes = (node: unknown): Node[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node as Node, ...((node as Node).children ?? []).flatMap(nodes)]
const text = (node: unknown): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text((node as Node).children ?? []) : ''

async function open($: Parameters<Parameters<typeof test>[1]>[0], args = '') {
  await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
}

describe('her itabag', () => {
  // 10-15 (lane A): the switches page has no way into the More page any more, so who pays for Talk stands under Talk here
  test('who pays for Talk stands under Talk on the switches page', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const keys = nodes(await ui.drawn()).map(n => String(n.props?.key))
    const talk = keys.indexOf('coco:more:row:talk')
    expect(talk).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('coco:more:payer:row')).toBeGreaterThan(talk)
  })
  test('the pane is her bag: its title, the skill cards at the very top (owner 10-19), its picture, then the seven pages in the owner\'s order', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    expect(w.opens.at(-1)).toMatchObject({ id: 'coco-book' })
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const tree = await ui.drawn() as Node
    expect(((tree.children?.[0] as Node | undefined)?.children?.[0] as Node | undefined)?.props?.key).toBe('coco:cards:open')
    const art = (tree.children?.[1] as Node | undefined)?.children?.[0] as Node | undefined
    expect(art?.type).toBe('Svg')
    expect(String(art?.props?.alt)).toMatch(/^coco's ita bag, switches on: \d+ of \d+$/)
    const tabs = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('coco:book:tab:'))
    expect(tabs.map(t => [String(t.key).split(':').at(-1), t.props.label, t.props.hotkey])).toEqual(
      ['him', 'offerings', 'omen', 'socks', 'log', 'library', 'settings'].map((page, i) => [page, BAG.en!.pages[i], String(i + 1)]))
    // one badge a switch: the settings page's choices, the language picker aside, and the More rows that stand in its
    // groups now (step 2, settings_drafts.py: everything from Settings and More, grouped by what it does)
    const switches = nodes(tree).filter(n => n.type === 'Button' && /^coco:set:(?!lang:)/.test(String(n.props?.key)) && n.props?.variant === 'primary')
    const moreRows = nodes(tree).filter(n => /^coco:more:row:/.test(String(n.props?.key)))
    expect(moreRows.length).toBeGreaterThan(0)
    expect(String(art?.props?.alt)).toContain(`of ${switches.length + moreRows.length}`)
    await ui.unmount()
  })
  test('the quota page hangs the two charms on the bag, and its picture says how many cells are left', async ($, on) => {
    const w = world(on, { store: RECENT, limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-02T16:00:00Z' }, { kind: 'seven_day', percentUsed: 80, resetsAt: '2026-10-06T09:00:00Z' }] })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'usage')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 100 } })
    const art = (await ui.findAll({ type: 'Svg' }))[0]
    expect(String(art?.props.alt)).toBe(BAG.en!.alt[1]!.replace('{five}', '3').replace('{week}', '1').replace(/\{total\}/g, '4'))
    expect(String(art?.props.source)).toContain('stroke-dasharray')
    await ui.unmount()
  })
  test('the terminal draws her bag as a coral frame with the page\'s number and name, and the tabs in the same order', async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'zh_CN.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'socks')
    const ui = await $.ui.mount({ surface: 'terminal', ...PANE })
    const all = nodes(await ui.drawn())
    // a row is one Text holding its runs (a run of its own may be the frame's single side character)
    const rows = [...new Set(all.filter(n => n.type === 'Text' && /^[▗▐▝]/.test(text(n)) && text(n).length > 2).map(text))]
    expect(rows.map(row => row[0])).toEqual(['▗', '▐', '▝'])
    expect(rows[1]).toContain(`4${BAG.zh!.pages[3]}`)
    const tabs = all.filter(n => n.type === 'Button' && String(n.props?.key).startsWith('coco:book:tab:'))
    expect(tabs.map(t => t.props?.label)).toEqual(BAG.zh!.pages.map((page, i) => `${i + 1}${page}`))
    await ui.unmount()
  })
  test('vibe check, the sock drawer and the sticky notes each have their own picture, and say what it counts', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    // the third page has no word of its own after /coco (its old one draws the omen), so its tab is pressed
    const alt = async (page: string) => {
      await open($, 'settings')
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
      await ui.press({ key: `coco:book:tab:${page}` }); await ui.redraw()
      const art = (await ui.findAll({ type: 'Svg' }))[0]
      await ui.unmount()
      return String(art?.props.alt)
    }
    // the drawer collects (owner 10-15): her own pair, and reddot for opening her bag in the terminal
    expect(await alt('socks')).toBe(BAG.en!.alt[3]!.replace('{total}', '13').replace('{have}', '2'))
    expect(await alt('library')).toBe(BAG.en!.alt[5]!.replace('{notes}', '0'))
    expect(await alt('omen')).toBe(BAG.en!.alt[2]!.replace('{failed}', '0').replace('{fixed}', '0').replace('{compacted}', '0'))
  })
  // 10-17: she peeks into the bag's picture from the right where there is room, holding its edge (lane A's bag-peek.png)
  test('she peeks in from the right, full height when wide, smaller on the bottom edge when not, out where she would crowd the bag', async ($, on) => {
    // a clear 236 x 360 picture in place of lane A's, the size the bag lays her out by
    on('fs.read', { path: /[\\/]assets[\\/]coco[\\/]bag-peek\.png$/ }, () => ({ value: { base64: 'iVBORw0KGgoAAAANSUhEUgAAAOwAAAFoCAYAAABUhRduAAABYUlEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4NcAMTMAAcHHo3EAAAAASUVORK5CYII=' } } as never))
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    const art = async (bodyColumns: number) => {
      await open($, 'settings')
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns } })
      const svg = (await ui.findAll({ type: 'Svg' }))[0]
      await ui.unmount()
      return { source: String(svg?.props.source), width: Number(svg?.props.width) }
    }
    const her = (source: string) => /<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" href="data:image\/png;base64,/.exec(source)
    const wide = await art(100), image = her(wide.source)
    expect(image?.[2]).toBe('0')
    expect(Number(image![1]) + Number(image![3])).toBeLessThanOrEqual(wide.width)
    // the usual pane: she stands on the bottom edge, a little smaller
    expect(Number(her((await art(64)).source)?.[2])).toBeGreaterThan(0)
    expect((await art(55)).source).not.toContain('<image')
  })
  // 10-18: the desktop takes a picture of at most 131072 characters and refused his whole bag for her peek (the 110 KB
  // drawing); her drawing is 66 KB now, and one past the limit leaves the bag drawn without her
  test('her drawing at its real size stays in the wide desktop bag, under the limit', async ($, on) => {
    // the first 24 bytes of a 236 x 360 PNG, then filler to the length of her drawing's base64
    on('fs.read', { path: /[\\/]assets[\\/]coco[\\/]bag-peek\.png$/ }, () => ({ value: { base64: 'iVBORw0KGgoAAAANSUhEUgAAAOwAAAFo'.padEnd(87_392, 'A') } }))
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 100 } })
    const real = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
    await ui.unmount()
    expect(real).toContain('<image')
    expect(real.length).toBeLessThanOrEqual(131_072)
  })
  test('a peek past the limit is left out and the bag still draws (the old 110 KB drawing)', async ($, on) => {
    on('fs.read', { path: /[\\/]assets[\\/]coco[\\/]bag-peek\.png$/ }, () => ({ value: { base64: 'iVBORw0KGgoAAAANSUhEUgAAAOwAAAFo'.padEnd(147_220, 'A') } }))
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 100 } })
    const svg = (await ui.findAll({ type: 'Svg' }))[0]
    await ui.unmount()
    expect(String(svg?.props.source)).toContain('<svg')
    expect(String(svg?.props.source)).not.toContain('<image')
    expect(String(svg?.props.source).length).toBeLessThanOrEqual(131_072)
  })
  // 10-17: in B Coco wears a cream hoodie (lane A's bag-peek-b.png), so the plane behind is a darker sand than in A
  test('the plane behind the peek is cream in A and a darker sand in B', () => {
    const peek = { base64: 'x', width: 236, height: 360 }
    const plane = (svg: string) => /<path d="M[\d.]+ [\d.]+L[\d.]+ 0H[\d.]+V[\d.]+Z" fill="(#[0-9A-F]{6})"\/>/.exec(svg)?.[1]
    expect(plane(bagArtSvg(495, [true], undefined, undefined, peek))).toBe('#F4ECE4')
    expect(plane(bagArtSvg(495, [true], undefined, undefined, { ...peek, outfit: 'B' }))).toBe('#E3D3C3')
  })
  // 10-17 (his yes on lane A's seven): the bag's pictures in the MV style, chosen on their page; the current ones stay the default
  test('their page offers the MV pictures: choosing them draws every page in navy and coral and keeps what a screen reader hears', async ($, on) => {
    const STYLE = { label: 'Bag pictures', classic: 'As they are', mv: 'MV' }
    on('fs.read', { path: /[\\/]hooks[\\/]bag-text\.json$/ }, () => ({ value: JSON.stringify({ ...BAG, en: { ...BAG.en, bagStyle: STYLE } }) }))
    let settingsRecord: Record<string, unknown> | undefined
    on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'bandSettings') settingsRecord = e.value as Record<string, unknown>; return next(e) })
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const head = async () => { const svg = (await ui.findAll({ type: 'Svg' }))[0]; return { source: String(svg?.props.source), alt: String(svg?.props.alt) } }
    const pages = ['him', 'offerings', 'omen', 'socks', 'log', 'library', 'settings'] as const, before: Record<string, string> = {}
    for (const page of pages) { await ui.press({ key: `coco:book:tab:${page}` }); await ui.redraw(); const h = await head(); expect(h.source).not.toContain('#131C30'); before[page] = h.alt }
    await ui.press({ key: 'coco:book:tab:him' }); await ui.redraw()
    expect((await ui.find({ key: 'coco:set:bagStyle:classic' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'coco:set:bagStyle:mv' }); await settleLegacyStart($, w); await ui.redraw()
    expect(settingsRecord).toMatchObject({ bagStyle: 'mv' })
    expect((await ui.find({ key: 'coco:set:bagStyle:mv' }))?.props.variant).toBe('primary')
    for (const page of pages) {
      await ui.press({ key: `coco:book:tab:${page}` }); await ui.redraw()
      const h = await head()
      expect(h.source).toContain('#131C30')
      // the quota not read yet: the classic page shows the switches, the MV one the quota's empty cells and the bag's name
      expect(h.alt).toBe(page === 'offerings' ? BAG.en!.title : before[page]!)
    }
    await ui.unmount()
  })
  test('the MV picture reads its page: an off call struck through, a quota not read yet outlined, marks where the window is narrow', () => {
    const struck = (svg: string) => (svg.match(/stroke="#F6EBDD" stroke-width="1.2"\/>/g) ?? []).length
    const pet = bagMvSvg(560, { page: 'him', switches: [true, false, true], size: 1 })
    expect(pet).toContain('onDesk();'); expect(pet).toContain('follow();'); expect(pet).toContain('openAtLogin();')
    expect(struck(pet)).toBe(1)
    const quota = bagMvSvg(560, { page: 'offerings' })
    expect(quota).toContain('left("5h");'); expect(struck(quota)).toBe(2)
    expect(bagMvSvg(560, { page: 'offerings', five: 3, week: 2 })).toContain('left("7d", 2);')
    // narrow: no code, the same reading as marks; very narrow: the bag alone, without Coco
    expect(bagMvSvg(300, { page: 'omen', failed: 1, fixed: 1, compacted: 0, rarity: 'SR' })).not.toContain('<text')
    const peek = { base64: 'x', width: 472, height: 720 }
    expect(bagMvSvg(300, { page: 'library', notes: 0 }, peek)).toContain('<image')
    expect(bagMvSvg(240, { page: 'library', notes: 0 }, peek)).not.toContain('<image')
  })
  // 10-17: who keeps them company on the desktop band and the pet (A 10-16), on their page once lane B's words are in
  test('their page offers Coco, Claudie or the maid for the band and the pet, and a press keeps the choice', async ($, on) => {
    const LOOK = { label: 'Who keeps you company', coco: 'Coco', dake: 'Claudie', maid: 'Maid Claudie', fish: 'DeepSeek-chan', help: 'On the desktop band and Coco Pet; the terminal always has Coco.' }
    on('fs.read', { path: /[\\/]hooks[\\/]bag-text\.json$/ }, () => ({ value: JSON.stringify({ ...BAG, en: { ...BAG.en, look: LOOK } }) }))
    let settingsRecord: Record<string, unknown> | undefined
    on('store.*', ($, e, next) => { if (next.is('store.set', e) && e.key === 'bandSettings') settingsRecord = e.value as Record<string, unknown>; return next(e) })
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'coco:book:tab:him' }); await ui.redraw()
    expect((await ui.find({ key: 'coco:set:claudeForm:coco' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'coco:set:claudeForm:maid' }))?.props.label).toBe('Maid Claudie')
    expect(text(await ui.drawn())).toContain(LOOK.help)
    await ui.press({ key: 'coco:set:claudeForm:dake' }); await settleLegacyStart($, w); await ui.redraw()
    expect(settingsRecord).toMatchObject({ claudeForm: 'dake' })
    expect((await ui.find({ key: 'coco:set:claudeForm:dake' }))?.props.variant).toBe('primary')
    // 10-19: the fourth look, the whale girl (her band and pet art not drawn yet, so those keep Coco)
    expect((await ui.find({ key: 'coco:set:claudeForm:fish' }))?.props.label).toBe(LOOK.fish)
    await ui.press({ key: 'coco:set:claudeForm:fish' }); await settleLegacyStart($, w); await ui.redraw()
    expect(settingsRecord).toMatchObject({ claudeForm: 'fish' })
    await ui.unmount()
  })
  // 10-17 (his card, lane B's words): a page says what Coco does only where its still shows it; the sticky notes keep the peek
  test('the sticky notes page says Coco peeks out; the doujin page has no such line', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const portrait = async (): Promise<string | undefined> => nodes(await ui.drawn()).map(n => n.type === 'Svg' ? String(n.props?.alt ?? '') : '').find(alt => alt === 'Coco' || alt.startsWith('Coco, '))
    await ui.press({ key: 'coco:book:tab:library' }); await ui.redraw()
    expect(text(await ui.drawn())).toContain('(peeking out)')
    expect(await portrait()).toBe('Coco, peeking out')
    await ui.press({ key: 'coco:book:tab:log' }); await ui.redraw()
    expect(text(await ui.drawn())).not.toContain('(peeking out)')
    expect(await portrait()).toBe('Coco')
    await ui.unmount()
  })
  // 10-17: their page shows the pet's three switches over its three sizes; the doujin its issues, numbered from the first week
  test('their page and the doujin have their own pictures: the pet\'s switches and size, the issues collected and the newest', async ($, on) => {
    const day = (d: string) => ({ day: d, pages: 2, runs: [['read', 1]], green: 0, wild: [] })
    const w = world(on, { store: { ...RECENT, 'days:v1': { days: [day('2026-09-08'), day('2026-09-29')], slid: [] } } })
    await $.session.start(START); await settleLegacyStart($, w)
    const page = async (tab: string) => {
      await open($, 'settings')
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
      await ui.press({ key: `coco:book:tab:${tab}` }); await ui.redraw()
      const art = (await ui.findAll({ type: 'Svg' }))[0], all = text(await ui.drawn())
      await ui.unmount()
      return { alt: String(art?.props.alt), source: String(art?.props.source), all }
    }
    // off a Mac the book reads no pet yet, so their page shows the bag alone (the Mac's picture: companion-book.test.tsx)
    expect((await page('him')).alt).toBe(BAG.en!.title)
    // English weeks start on Sunday: 09-06 is issue 1, 09-27 issue 4
    const zine = await page('log')
    expect(zine.alt).toBe(BAG.en!.alt[4]!.replace('{issues}', '2').replace('{latest}', '4'))
    expect(zine.source).toContain('>4</text>')
    expect(zine.all).toContain((BAG.en as unknown as { lead: Record<string, string> }).lead.log!.replace('{issues}', '2').replace('{latest}', '4'))
  })
  test('keeping the cache warm is a switch on her bag: the first on asks once, with what a re-read costs, then on and off', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const warm = async () => (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('coco:set:warm:')).map(b => [b.key, b.props.variant])
    // no reading yet in this world, so the question carries the switch's own lines and no number
    const cost = JSON.parse(COST_WORDS_RAW)['more.warm.cost'].en as string
    expect(await warm()).toEqual([['coco:set:warm:ask', undefined], ['coco:set:warm:off', 'primary']])
    // the first on asks in place; not now closes it and it stays off
    await ui.press({ key: 'coco:set:warm:ask' }); await ui.redraw()
    expect(await warm()).toEqual([['coco:set:warm:no', undefined], ['coco:set:warm:on', 'primary']])
    expect(text(await ui.drawn())).toContain(cost)
    await ui.press({ key: 'coco:set:warm:no' }); await ui.redraw()
    expect(w.view().cost?.warmEnabled).toBe(false)
    expect(await warm()).toEqual([['coco:set:warm:ask', undefined], ['coco:set:warm:off', 'primary']])
    // asked again, turned on, then off
    await ui.press({ key: 'coco:set:warm:ask' }); await ui.redraw()
    await ui.press({ key: 'coco:set:warm:on' }); await ui.redraw()
    expect(w.view().cost?.warmEnabled).toBe(true)
    expect(await warm()).toEqual([['coco:set:warm:on', 'primary'], ['coco:set:warm:off', undefined]])
    await ui.press({ key: 'coco:set:warm:off' }); await ui.redraw()
    expect(w.view().cost?.warmEnabled).toBe(false)
    // answered once, on no longer asks
    expect(await warm()).toEqual([['coco:set:warm:on', undefined], ['coco:set:warm:off', 'primary']])
    await ui.unmount()
  })
  test('vibe check: with lane B\'s words the page opens on the day\'s verdict for this session, two roasts and a way out', async ($, on) => {
    const words = JSON.parse(BAG_TEXT_RAW) as Record<string, Record<string, unknown>>
    const sets = [0, 1, 2].map(i => ({ verdict: `verdict ${i}`, roasts: [`roast ${i}a`, `roast ${i}b`], step: `step ${i}` }))
    words.en!.vibe = { noTests: sets }
    on('fs.read', { path: /bag-text\.json$/ }, () => ({ value: JSON.stringify(words) }))
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'coco:book:tab:omen' }); await ui.redraw()
    // no test has run this session: one set of the three, whole, chosen by the day
    const drawn = text(await ui.drawn()), shown = sets.filter(set => drawn.includes(set.verdict))
    expect(shown.length).toBe(1)
    for (const line of [...shown[0]!.roasts, shown[0]!.step]) expect(drawn).toContain(line)
    await ui.unmount()
  })
  test('the sock drawer collects: her own pair and the earned ones are buttons, the rest say how she gets them', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await open($, 'socks'); await settleLegacyStart($, w)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const pairs = async () => (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('coco:socks:'))
    // opening her bag in the terminal was the reddot pair's first (owner 10-15), and she says so
    expect((await pairs()).map(b => [String(b.key).split(':').at(-1), b.props.label])).toEqual([['honmei', BAG.en!.socks[0]], ['reddot', BAG.en!.socks[12]]])
    const words = JSON.parse(C3_WORDS_RAW) as Record<string, Record<string, string>>, drawn = text(await ui.drawn())
    const earned = (i: number) => words['socks.earned']!.en!.replace('{pair}', BAG.en!.socks[i]!)
    for (let i = 0; i < 50 && w.view().line?.key !== 'socks.earned'; i++) await w.clock.advance(0)
    expect([w.view().line?.key, w.view().line?.text]).toEqual(['socks.earned', earned(12)])
    for (const pair of PAIRS.slice(1, 12)) expect(drawn).toContain(words[`socks.hint.${pair}`]!.en!)
    // every pair at once: all thirteen are buttons, and a press puts one on her, everywhere, and her own takes it off
    await ui.press({ key: 'coco:set:socksMode:all' }); await ui.redraw()
    expect((await pairs()).map(b => [String(b.key).split(':').at(-1), b.props.label])).toEqual(PAIRS.map((pair, i) => [pair, BAG.en!.socks[i]]))
    expect((await pairs()).filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['coco:socks:honmei'])
    await ui.press({ key: 'coco:socks:taro' }); await ui.redraw()
    expect(w.view().socks).toBe('taro')
    expect((await pairs()).filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['coco:socks:taro'])
    await ui.press({ key: 'coco:socks:honmei' }); await ui.redraw()
    expect(w.view().socks).toBeUndefined()
    // a first while every pair is open is still kept, without a word
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] }); await settleLegacyStart($, w)
    for (let i = 0; i < 50; i++) await w.clock.advance(0)
    expect(w.view().line?.text).not.toBe(earned(3))
    // collecting again closes the pairs she has not earned
    await ui.press({ key: 'coco:set:socksMode:collect' }); await ui.redraw()
    expect((await pairs()).map(b => String(b.key).split(':').at(-1))).toEqual(['honmei', 'sesame', 'reddot'])
    await ui.unmount()
  })
})
