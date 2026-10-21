import { expect, test } from 'claude-code/testing'
import { desktopBand, terminalBand } from '../hooks/band'
import { LINES } from '../hooks/lines'
import { initialView } from '../hooks/mood'
import { LANGS } from '../hooks/words'
import type { Lang } from '../hooks/words'

type Surface = 'desktop' | 'terminal'
type Source = { path: string[]; text: string }
type Run = { text: string; italic: boolean }
const paired = /\*[^*\n]+\*/u
const sprite = '<svg width="73" height="64"></svg>'
const fits = [{ name: 'full', columns: 200, band: 'on' }, { name: 'narrow', columns: 40, band: 'compact' }] as const

function strings(value: unknown, path: string[] = []): Source[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => strings(item, [...path, key]))
}
const sources = strings(LINES).filter(source => paired.test(source.text))
const corpusBefore = JSON.stringify(LINES)
function sourceValue(path: readonly string[]): unknown {
  return path.reduce((value: any, key) => value[key], LINES)
}
function sourceLang(path: readonly string[]): Lang | undefined {
  return LANGS.find(({ code }) => path.includes(code))?.code
}

function textRuns(tree: any, inheritedItalic = false): Run[] {
  if (typeof tree === 'string') return [{ text: tree, italic: inheritedItalic }]
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => textRuns(child, inheritedItalic))
  const italic = tree.type === 'Text' ? (tree.props?.italic ?? inheritedItalic) : inheritedItalic
  return (tree.children ?? []).flatMap((child: any) => textRuns(child, italic))
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}
function cleanTree(tree: unknown): void {
  for (const run of textRuns(tree)) expect(run.text.includes('*')).toBe(false)
  for (const node of nodes(tree)) if (typeof node.props?.alt === 'string') expect(node.props.alt.includes('*')).toBe(false)
}

// Expected character styles come from source delimiters, independently of renderer fitting.
function expectedRuns(source: string): Run[] {
  const runs: Run[] = []
  let at = 0
  for (const match of source.matchAll(/\*([^*\n]+)\*/gu)) {
    if (match.index! > at) runs.push({ text: source.slice(at, match.index), italic: false })
    runs.push({ text: match[1]!, italic: true })
    at = match.index! + match[0].length
  }
  if (at < source.length) runs.push({ text: source.slice(at), italic: false })
  return runs
}
function exactSpeechStyles(tree: unknown, source: string): void {
  const expected = expectedRuns(source)
  const spoken = expected.map(run => run.text).join('')
  const painted = textRuns(tree)
  const allText = painted.map(run => run.text).join('')
  const at = allText.indexOf(spoken)
  expect(at).toBeGreaterThanOrEqual(0)
  const characters = painted.flatMap(run => Array.from(run.text, text => ({ text, italic: run.italic })))
  const offset = Array.from(allText.slice(0, at)).length
  const wanted = expected.flatMap(run => Array.from(run.text, text => ({ text, italic: run.italic })))
  expect(characters.slice(offset, offset + wanted.length)).toEqual(wanted)
}

// Each group uses one SDK context. Every source still gets a fresh mounted Pane.
async function renderer($: any, on: any, surface: Surface, lang: Lang, fit: typeof fits[number]): Promise<(source: string) => Promise<unknown>> {
  let view = { ...initialView(), lang, said: '', band: fit.band }
  const size = { columns: fit.columns, maxRows: 30, screenRows: 48, isWorking: false }
  on('ui.render', { component: 'Pane', requestId: 'w3-spoken-stage' }, ($: any, e: any) => surface === 'desktop'
    ? desktopBand($.ui.resolve(e) as any, view, size, sprite)
    : terminalBand($.ui.resolve(e) as any, view, size))
  return async source => {
    view = { ...initialView(), lang, said: source, band: fit.band }
    const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'w3-spoken-stage', props: { title: 'W3 fixture', isFocused: true, bodyColumns: fit.columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    try { return await ui.drawn() }
    finally { await ui.unmount() }
  }
}
function caseTitle(source: Source, surface: Surface, fit: typeof fits[number]): string {
  return `W3 A1 spoken ${surface} ${fit.name}: ${source.path.join('.')} renders stage markup with exact source preserved`
}
function completedCase(name: string): void {
  console.log('P3_W3_CASE ' + JSON.stringify({ test: name }))
}

// Since the Coco lines (10-14) every language writes stage directions in half-width parentheses (CANON 3), so the
// authored corpus is empty; the synthetic cases below keep the star markup path covered.
const corpusTitle = 'W3 A1 band lines carry no star markup and every entry would have a locale'
test(corpusTitle, () => {
  expect(sources).toEqual([])
  expect(sources.filter(source => sourceLang(source.path) === undefined)).toEqual([])
  completedCase(corpusTitle)
})

for (const { code: lang } of LANGS) for (const surface of ['desktop', 'terminal'] as const) for (const fit of fits) {
  const group = sources.filter(source => sourceLang(source.path) === lang)
  if (!group.length) continue
  test(`W3 A1 spoken ${surface} ${fit.name}: every authored stage line in ${lang}`, async ($, on) => {
    const draw = await renderer($, on, surface, lang, fit)
    const completed: string[] = []
    for (const source of group) {
      const before = corpusBefore
      expect(JSON.stringify(LINES)).toBe(before)
      expect(sourceValue(source.path)).toBe(source.text)
      const tree = await draw(source.text)
      cleanTree(tree)
      if (fit.name === 'full') exactSpeechStyles(tree, source.text)
      expect(sourceValue(source.path)).toBe(source.text)
      expect(JSON.stringify(LINES)).toBe(before)
      const title = caseTitle(source, surface, fit)
      completed.push(title)
      completedCase(title)
    }
    // Build expected identities independently of the rendering loop's completion list.
    const expected = sources.filter(source => sourceLang(source.path) === lang).map(source => caseTitle(source, surface, fit))
    expect(completed).toEqual(expected)
    expect(new Set(completed).size).toBe(expected.length)
  })
}

for (const surface of ['desktop', 'terminal'] as const) for (const fit of fits) {
  const title = `W3 A1 spoken ${surface} ${fit.name}: two stage runs keep ordinary words roman`
  test(title, async ($, on) => {
    const source = '*stage* ordinary *second stage*'
    const draw = await renderer($, on, surface, 'en', fit)
    const tree = await draw(source)
    cleanTree(tree)
    if (fit.name === 'full') exactSpeechStyles(tree, source)
    completedCase(title)
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  const title = `W3 A1 spoken ${surface}: ordinary no-markup control retains exact roman speech`
  test(title, async ($, on) => {
    const source = 'ordinary words stay roman'
    const draw = await renderer($, on, surface, 'en', fits[0])
    const tree = await draw(source)
    cleanTree(tree)
    exactSpeechStyles(tree, source)
    completedCase(title)
  })
}
