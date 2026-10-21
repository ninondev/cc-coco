import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import { CompanionBook, nowFit } from '../hooks/companion-book'
import { cells } from '../hooks/band'
import { companionSnapshot, companionDataFromSnapshot, companionChanged, warmCompanion, pressCompanion, registerBook } from '../hooks/pages'
import { BOOK_TEXT } from '../hooks/book-text'
import { WORDS } from '../hooks/words'
import { COMPANION_TARGET_FILES } from './companion-target-files'
import { COMPANION_APP_SOURCE } from './companion-source'
import { MORNING, RECENT, PERSON, P, world } from './world'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'

const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 42, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} } }
const START = { cwd: '/tmp/project', surface: 'vscode' as const, isInteractive: true }
const HOME = '/tmp/book-state-fixture'
type Tree = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function nodes(tree: unknown): Tree[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  const node = tree as Tree
  return [node, ...(node.children ?? []).flatMap(nodes)]
}
function textOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (!tree || typeof tree !== 'object') return ''
  return textOf((tree as Tree).children)
}

const data: BookData = { view: undefined, usage: undefined, store: {}, now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', voiceSizes: { light: 1, full: 2 }, fortune: undefined, reading: 0, own: WORDS.en }

describe('B4b book state and capability', () => {
  test('the production Swift status writer declares exactly Claude and VS Code target capabilities', () => {
    const begin = COMPANION_APP_SOURCE.indexOf('final class Store {')
    const end = COMPANION_APP_SOURCE.indexOf('final class Companion:', begin)
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(begin)
    const statusWriter = COMPANION_APP_SOURCE.slice(begin, end)
    expect(statusWriter).toContain('func save()')
    expect(statusWriter).toContain('"running": running')
    const declarations = [...statusWriter.matchAll(/"targets"\s*:\s*(\[[^\]]*\])/g)]
    expect(declarations.length).toBe(1)
    expect(JSON.parse(declarations[0]![1]!)).toEqual(['claude', 'vscode'])
  })
  for (const surface of ['desktop', 'vscode'] as const) test(`${surface}: an older companion without targets shows no choice even with stored VS Code preference`, async ($, on) => {
    expect(JSON.parse(COMPANION_TARGET_FILES['missing.json']!).targets).toBeUndefined()
    world(on, { store: { ...RECENT, companionTarget: 'vscode' }, env: { HOME, LANG: 'en_US.UTF-8' }, readText: path => path.endsWith('companion.json') ? COMPANION_TARGET_FILES['missing.json'] : undefined })
    on('session.surfaces', () => ({ value: [surface] }))
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: COMPANION_TARGET_FILES['missing.json']! }))
    await $.session.start({ ...START, surface })
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE }); await ui.redraw()
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('coco:set:companionTarget:'))).toEqual([])
    expect((await ui.findAll({ type: 'Svg' })).some(t => String(t.props.alt).includes('VS\u00a0Code'))).toBe(false)
  })
  test('capable book choice writes the VS Code preference into the actual view and store', async ($, on) => {
    let persisted: unknown
    on('store.set', { key: 'companionTarget' }, ($, e, next) => { persisted = e.value; return next(e) })
    const f = world(on, { store: { ...RECENT, companionTarget: 'auto' }, env: { HOME, LANG: 'en_US.UTF-8' }, readText: path => path.endsWith('companion.json') ? COMPANION_TARGET_FILES['vscode.json'] : undefined })
    on('session.surfaces', () => ({ value: ['desktop', 'vscode'] }))
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: COMPANION_TARGET_FILES['vscode.json']! }))
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'vscode', ...PANE }); await ui.redraw()
    await ui.press({ key: 'coco:set:companionTarget:vscode' })
    expect(f.view().companionTarget).toBe('vscode')
    expect(persisted).toBe('vscode')
  })

  for (const name of Object.keys(COMPANION_TARGET_FILES)) test(`actual ${name} capability gates both target and silhouette`, async () => {
    const reads: string[] = []
    const engine = { env: { get: async (key: string) => key === 'HOME' ? HOME : undefined }, fs: { exists: async () => true, read: async (path: string) => { reads.push(path); return COMPANION_TARGET_FILES[name] } } } as unknown as EngineInterface
    const snapshot = await companionSnapshot(engine, new CompanionBook())
    const info = snapshot.info as typeof snapshot.info & { targets?: string[] }
    const capable = name === 'vscode.json'
    expect(info.targets).toEqual(name === 'vscode.json' ? ['claude', 'vscode'] : name === 'claude.json' ? ['claude'] : name === 'empty.json' ? [] : undefined)
    expect(reads).toEqual([`${HOME}/Library/Application Support/Coco/companion.json`])
    for (const target of ['auto', 'claude', 'vscode'] as const) {
      const rendered = companionDataFromSnapshot(new CompanionBook(), snapshot, true, MORNING, target, 'VS Code')
      expect(rendered.target).toBe(target)
      expect(rendered.targetApp).toBe(capable && target !== 'claude' ? 'VS Code' : 'Claude')
      expect(rendered.stage?.source.includes('M26.5 49v36M44.5 49v36')).toBe(capable && target !== 'claude')
    }
  })
  for (const storage of ['record', 'legacy'] as const) for (const surface of ['desktop', 'vscode'] as const) for (const name of ['vscode.json', 'missing.json', 'mixed.json']) test(`${surface}: mounted target controls and stored VS Code preference follow actual ${name}${storage === 'legacy' ? ' after legacy migration' : ''}`, async ($, on) => {
    const legacyTarget = storage === 'legacy' ? 'vscode' : 'claude'
    let record: unknown = storage === 'record' ? { companionTarget: 'vscode' } : undefined
    const records: unknown[] = [], targetWrites: unknown[] = [], deletes: string[] = []
    // Expose either the real old keys or an authoritative record over a stale old choice.
    // Observe completed store writes; the settings pane need not publish the band's view.
    on('store.*', async ($, e, next) => {
      if (next.is('store.get', e)) {
        if (e.key === 'bandSettings') return { value: record } as never
        if (e.key === 'companionTarget') return { value: legacyTarget } as never
      }
      if (next.is('store.set', e) && e.key === 'companionTarget') targetWrites.push(e.value)
      if (next.is('store.delete', e) && ['bandSettings', 'companionTarget'].includes(e.key)) deletes.push(e.key)
      const result = await next(e)
      if (next.is('store.set', e) && e.key === 'bandSettings' && !('deny' in result)) {
        record = e.value; records.push(e.value)
      }
      return result
    })
    world(on, { store: { ...RECENT, companionTarget: legacyTarget }, env: { HOME, LANG: 'en_US.UTF-8' }, readText: path => path.endsWith('companion.json') ? COMPANION_TARGET_FILES[name] : undefined })
    on('session.surfaces', () => ({ value: [surface] }))
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: COMPANION_TARGET_FILES[name]! }))
    await $.session.start({ ...START, surface })
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE }); await ui.redraw()
    const targets = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('coco:set:companionTarget:')).map(b => b.key)
    expect(targets).toEqual(name === 'vscode.json' ? ['auto', 'claude', 'vscode'].map(target => `coco:set:companionTarget:${target}`) : [])
    expect(record).toMatchObject({ companionTarget: 'vscode' })
    expect(records.length).toBeGreaterThan(0)
    for (const saved of records) expect(saved).toMatchObject({ companionTarget: 'vscode' })
    expect(targetWrites).toEqual([])
    expect(deletes).toEqual([])
    const text = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')
    expect(text.includes('Now:\u00a0VS\u00a0Code')).toBe(name === 'vscode.json')
    if (name === 'vscode.json') {
      expect(await ui.find({ type: 'Button', key: 'coco:set:companionTarget:vscode' })).toHaveProperty('props.label', 'VS\u00a0Code')
      expect(text).toContain('With several VS\u00a0Code windows')
      expect(text).not.toContain('VS Code')
    }
    const alts = (await ui.findAll({ type: 'Svg' })).map(t => String(t.props.alt)).join('\n')
    expect(alts.includes('VS\u00a0Code')).toBe(name === 'vscode.json')
    expect(alts).not.toContain('VS Code')
  })
  // BOOK F2: the block keeps its ordinary spaces; the drawing glues "Now: value" with nowFit only while the whole line fits.
  test('short choice Now values stay whole where the whole line fits, and wrap normally where it does not', () => {
    for (const value of ['Only his', '12345678901 123456789012', '123456789012 123456789012']) {
      const words = { ...BOOK_TEXT.en, settings: { ...BOOK_TEXT.en.settings, marks: { ...BOOK_TEXT.en.settings.marks, replies: value } } }
      const block = pageBlocks('settings', words, data, 'vscode').find(b => b.t === 'choice' && b.label === words.settings.marks.label)
      const now = block?.t === 'choice' ? block.now : ''
      expect(now).toBe(`Now: ${value}`)
      expect(nowFit(now, cells(now))).toBe(now.replace(/ /g, '\u00a0'))
      expect(nowFit(now, cells(now) - 1)).toBe(now)
    }
  })
  for (const surface of ['vscode', 'mobile', 'desktop'] as const) test(`${surface} choice and heading spacing preserves desktop and removes remote doubling`, async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE })
    let tree = await ui.drawn()
    const blocks = (tree as Tree).children?.[4] as Tree // after the skill cards (10-19), her itabag's picture, the tabs and the page's head (lane C, 10-14)
    expect(blocks.props?.gap).toBeUndefined() // the room above each block is its own margin now (BOOK F5, F9)
    // the switches page stands in lane B's groups (step 2): a group's name is not a setting, even where it reads the same
    const groupNames: string[] = Object.values(JSON.parse(BAG_TEXT_RAW).en.groups)
    const choices = (blocks.children ?? []).filter(g => !groupNames.includes(textOf(g)) && ["Coco's voice in replies", 'Warmth', 'Marks in the conversation', 'Language'].some(label => textOf(g).startsWith(label)))
    expect(choices.length).toBe(4)
    // two blank rows above every setting, on every surface; nothing above the first block of the page or right under a group's name
    for (const group of choices) { const i = blocks.children!.indexOf(group); expect((group as Tree).props?.marginTop ?? 0).toBe(i === 0 || groupNames.includes(textOf(blocks.children![i - 1])) ? 0 : 2) }
    await ui.press({ key: 'coco:book:tab:offerings' }); await ui.redraw()
    tree = await ui.drawn()
    const page = (tree as Tree).children?.[4] as Tree
    // the book's three headings, or the windows and this session under lane B's group names once merged (step 2)
    const quotaGroups = JSON.parse(BAG_TEXT_RAW).en.quotaGroups as Record<'quota' | 'session', string> | undefined
    const names = quotaGroups ? [quotaGroups.quota, quotaGroups.session] : [BOOK_TEXT.en.offerings.context, BOOK_TEXT.en.offerings.limits, BOOK_TEXT.en.offerings.session]
    const headings = (page.children ?? []).filter(g => names.includes(textOf(g)))
    expect(headings.length).toBe(names.length)
    // nothing above the first block of a page; two blank rows above every later heading
    headings.forEach(heading => expect((heading.props?.marginTop ?? 0)).toBe(page.children?.indexOf(heading) === 0 ? 0 : 2))
  })
  for (const surface of ['desktop', 'vscode'] as const) test(`${surface} target group preserves desktop gap and removes remote internal row gap`, async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' }, readText: path => path.endsWith('companion.json') ? COMPANION_TARGET_FILES['vscode.json'] : undefined })
    on('fs.exists', { path: /SystemVersion\.plist|Coco/ }, () => ({ value: true }))
    on('fs.read', { path: /companion\.json$/ }, () => ({ value: COMPANION_TARGET_FILES['vscode.json']! }))
    await $.session.start(START)
    await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE }); await ui.redraw()
    const groups = nodes(await ui.drawn()).filter(n => n.type === 'Box' && textOf(n.children?.[0]).startsWith('Stands beside'))
    expect(groups.length).toBe(1)
    expect(groups[0]?.props?.gap ?? 0).toBe(surface === 'desktop' ? 1 : 0)
  })
  for (const surface of ['vscode', 'mobile'] as const) test(`${surface} closing book folds open language list on reopening`, async () => {
    const handlers: { event: string; match: unknown; callback: Function }[] = []
    registerBook(((event: string, match: unknown, callback?: Function) => { handlers.push({ event, match: callback ? match : undefined, callback: callback ?? match as Function }) }) as On)
    let state: { languages?: boolean } | undefined
    const engine = { state: { set: async (_key: unknown, value: { languages?: boolean }) => { state = value; return { isSet: true } } }, session: { usage: async () => undefined, surfaces: async () => [surface] }, ui: { open: async () => ({ isPlaced: true }), invalidate: () => {} } } as unknown as EngineInterface
    const language = handlers.find(h => h.event === 'ui.press' && String((h.match as { element?: RegExp })?.element) === '/^coco:set:lang:/')!
    const close = handlers.find(h => h.event === 'ui.close')!
    const command = handlers.find(h => h.event === 'command.run' && (h.match as { command?: string })?.command === 'coco')!
    await language.callback(engine, { element: 'coco:set:lang:open' }, () => {})
    expect(state?.languages).toBe(true)
    const next = Object.assign(async () => ({}), { origin: { plugin: 'coco' } })
    await close.callback(engine, { id: 'coco-book', origin: { kind: 'person' } }, next)
    await command.callback(engine, { args: '' }, next)
    expect(state?.languages).toBe(false)
  })
  test('status-only event preserves file capability and first event permits asynchronous capability warming', async () => {
    await pressCompanion({ env: { get: async () => undefined } } as unknown as EngineInterface, new CompanionBook(), 'trash', {} as never, () => {}, () => true)
    const c = new CompanionBook()
    let reads = 0
    const engine = { env: { get: async (key: string) => key === 'HOME' ? HOME : undefined }, fs: { exists: async () => true, read: async () => { reads++; return COMPANION_TARGET_FILES['vscode.json']! } } } as unknown as EngineInterface
    companionChanged({ running: true, accessibility: true })
    warmCompanion(engine, c, () => {})
    await c.warming
    expect(reads).toBe(1)
    expect(c.snapshot?.info.targets).toEqual(['claude', 'vscode'])
    companionChanged({ running: true, accessibility: true, size: 'small' })
    warmCompanion(engine, c, () => {})
    expect(c.snapshot?.info.targets).toEqual(['claude', 'vscode'])
    expect(c.snapshot?.info.size).toBe('small')
    expect(reads).toBe(1)
  })
  test('held file capability redraws after a newer status-only event without replacing its status', async () => {
    await pressCompanion({ env: { get: async () => undefined } } as unknown as EngineInterface, new CompanionBook(), 'trash', {} as never, () => {}, () => true)
    const c = new CompanionBook()
    let release!: () => void, began!: () => void, redraws = 0
    const held = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { began = resolve })
    const engine = { env: { get: async (key: string) => key === 'HOME' ? HOME : undefined }, fs: { exists: async () => true, read: async () => { began(); await held; return COMPANION_TARGET_FILES['vscode.json']! } } } as unknown as EngineInterface
    warmCompanion(engine, c, () => { redraws++ })
    const pending = c.warming
    await started
    companionChanged({ running: true, accessibility: true, size: 'small' })
    release(); await pending
    expect(redraws).toBe(1)
    expect(c.snapshot?.info.targets).toEqual(['claude', 'vscode'])
    expect(c.snapshot?.info.size).toBe('small')
    expect(companionDataFromSnapshot(c, c.snapshot!, true, MORNING, 'vscode').targetApp).toBe('VS Code')
  })

})
