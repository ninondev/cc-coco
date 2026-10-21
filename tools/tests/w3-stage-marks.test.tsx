import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand } from '../hooks/band'
import { desktopBook } from '../hooks/book'
import type { BookData, Press } from '../hooks/book'
import { PAGES } from '../hooks/book-words'
import { BOOK_TEXT } from '../hooks/book-text'
import { BAND_BOOK_WORDS } from '../hooks/book-band-words'
import { WORDS, LANGS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { c3Word, loadC3Words } from '../hooks/c3-words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world, stubPng } from './world'

const paired = /\*[^*\n]+\*/u
const size = { columns: 200, maxRows: 30, screenRows: 48, isWorking: false }
const sprite = '<svg width="73" height="64"></svg>'
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children ?? []).flatMap(nodes)]
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}.${key}`))
}
const mount = ($: any, surface: 'desktop' | 'terminal', id: string) => $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: id, props: { title: 'W3 fixture', isFocused: true, bodyColumns: 200, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
function cleanTree(tree: unknown, includeVisible = true): void {
  for (const node of nodes(tree)) {
    if (typeof node.props?.alt === 'string') expect({ alt: node.props.alt, markup: paired.test(node.props.alt) }).toEqual({ alt: node.props.alt, markup: false })
    if (includeVisible && node.type === 'Text') for (const child of node.children ?? []) if (typeof child === 'string') expect({ text: child, markup: paired.test(child) }).toEqual({ text: child, markup: false })
  }
}

test('W3 A1 every generated band, book and C3 interface string has no stage asterisk pair; deliberate touch italics remain exact', () => {
  const sources = { words: WORDS, book: BOOK_TEXT, bandBook: BAND_BOOK_WORDS, c3: JSON.parse(C3_WORDS_RAW) }
  const pairs = strings(sources).filter(([, text]) => paired.test(text))
  const deliberate = pairs.filter(([path]) => /^\.words\.[^.]+\.touch\.(poked|patted|flustered)$/.test(path))
  expect(deliberate.length).toBe(30)
  expect(pairs.filter(([path]) => !deliberate.some(([approved]) => approved === path))).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) test(`W3 A1 ${surface} every C3 pose tree exposes no paired stage asterisks`, async ($, on) => {
  await loadC3Words(() => Promise.resolve(C3_WORDS_RAW))
  let view = initialView()
  on('ui.render', { component: 'Pane', requestId: 'w3-stage' }, ($, e) => surface === 'desktop' ? desktopBand($.ui.resolve(e) as any, view, size, sprite) : terminalBand($.ui.resolve(e) as any, view, size))
  world(on)
  for (const { code: lang } of LANGS) {
    for (const pose of ['search', 'scroll', 'spyglass', 'plan', 'run', 'tea', 'helper', 'cheer']) {
      view = { ...initialView(), lang, pose: { name: pose, frame: 'think', aside: c3Word(lang, `aside.${pose}`), at: 0 } }
      const ui = await mount($, surface, 'w3-stage')
      cleanTree(await ui.drawn())
      await ui.unmount()
    }
  }
})

for (const surface of ['desktop', 'terminal'] as const) test(`W3 A1 ${surface} picture alt strips deliberately italic pose markup`, async ($, on) => {
  const aside = WORDS.ja.touch.patted
  const view = { ...initialView(), lang: 'ja' as const, pose: { name: 'tea', frame: 'think', aside, at: 0 } }
  on('ui.render', { component: 'Pane', requestId: 'w3-alt' }, ($, e) => surface === 'desktop' ? desktopBand($.ui.resolve(e) as any, view, size, sprite) : terminalBand($.ui.resolve(e) as any, view, size, stubPng('w3-alt.png')))
  world(on)
  const ui = await mount($, surface, 'w3-alt')
  const tree = await ui.drawn()
  const picture=surface==='desktop'?nodes(tree).find(node=>node.type==='Box'&&node.props?.key==='coco:picture'):tree
  const alt = nodes(picture).find(node => node.type === (surface === 'desktop' ? 'Svg' : 'Image') && (surface==='desktop'||node.props?.key==='sprite'))?.props?.alt
  expect(alt).toBeDefined()
  expect(alt).toContain(aside.slice(1, -1))
  cleanTree(tree, false)
  await ui.unmount()
})

test('W3 A1 desktop touch stage directions render deliberate italic source strings without visible markup', async ($, on) => {
  let view = { ...initialView(), lang: 'fr' as const, touch: 'pat' as 'pat' | 'poke' | 'burst' }
  on('ui.render', { component: 'Pane', requestId: 'w3-touch' }, ($, e) => desktopBand($.ui.resolve(e) as any, view, size, sprite))
  world(on)
  for (const touch of ['pat', 'poke', 'burst'] as const) {
    view = { ...view, touch }
    const original = WORDS.fr.touch[touch === 'pat' ? 'patted' : touch === 'poke' ? 'poked' : 'flustered']
    const ui = await mount($, 'desktop', 'w3-touch')
    const tree = await ui.drawn()
    cleanTree(tree)
    expect(strings(tree).some(([, text]) => text.includes(original.slice(1, -1)))).toBe(true)
    expect(WORDS.fr.touch[touch === 'pat' ? 'patted' : touch === 'poke' ? 'poked' : 'flustered']).toBe(original)
    await ui.unmount()
  }
})

test('W3 A1 every generated book direction and portrait alt is clean; italic source markup is stripped in alt only', async ($, on) => {
  let lang = 'en' as typeof LANGS[number]['code']
  let page = PAGES[0]!
  let words = BOOK_TEXT.en
  on('ui.render', { component: 'Pane', requestId: 'w3-book-alt' }, ($, e) => {
    const data: BookData = { view: { ...initialView(), lang }, usage: undefined, store: {}, now: 0, timeZone: 'UTC', reducedMotion: true, marks: 'off', voiceSizes: { light: 0, full: 0 }, fortune: undefined, reading: 0, own: WORDS[lang] }
    return desktopBook($.ui.resolve(e) as any, words, { page, reading: 0, rev: 0 }, data, { source: sprite, height: 64 }, {} as Press, 200)
  })
  world(on)
  for (const locale of LANGS) for (const nextPage of PAGES) {
    lang = locale.code; page = nextPage; words = BOOK_TEXT[lang]
    const ui = await mount($, 'desktop', 'w3-book-alt')
    cleanTree(await ui.drawn())
    await ui.unmount()
  }
  // D1 design/0.3/SPEC.md:118 replaces His page's portrait direction with his room.
  // Settings retains the authored portrait direction and exercises the same markup boundary.
  lang = 'en'; page = 'settings'; words = { ...BOOK_TEXT.en, direction: { ...BOOK_TEXT.en.direction, settings: '*opens the book*' } }
  const ui = await mount($, 'desktop', 'w3-book-alt')
  const tree = await ui.drawn()
  expect(nodes(tree).find(node => node.type === 'Svg')?.props?.alt).toContain('opens the book')
  cleanTree(tree)
  expect(nodes(tree).some(node => node.type === 'Text' && node.props?.italic && node.children?.includes('opens the book'))).toBe(true)
  expect(words.direction.settings).toBe('*opens the book*')
  await ui.unmount()
})
