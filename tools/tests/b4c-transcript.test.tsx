import { describe, expect, test } from 'claude-code/testing'
import { cutDirection } from '../hooks/transcript'
import { offeringSvg } from '../hooks/pictures-lazy'
import { commitCount, commitLineHeight, commitLineSvg, commitLineWidth } from '../hooks/play-commits'
import { D1_APPROVED_SHED_EMBLEM } from './d1-approved-shed-emblem-fixture'
import { D1_WORDS_TEXT } from './d1-room-fixture'
const D1_MARKS = JSON.parse(D1_WORDS_TEXT)['marks.shed'] as Record<string,string>
const shedDirection = (lang:string) => D1_MARKS[lang]!.replace(/\*/g,'')

import { LANGS, WORDS } from '../hooks/words'
import { gapBefore, planPx } from '../hooks/typeset'
import { PERSON, P, RECENT, world, settleLegacyStart } from './world'

type Node = { type?: string; props?: Record<string, any>; children?: unknown[] }
const MOODS = ['wave', 'think', 'work', 'happy', 'flustered', 'error', 'refuse'] as const
const START = { cwd: '/tmp/b4c-transcript', surface: 'mobile' as const, isInteractive: true }
const ENGINE = { type: 'engine', ref: 0 }
function nodes(tree: unknown, type: string): Node[] {
  if (!tree || typeof tree !== 'object') return []
  const n = tree as Node
  return [...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap(c => nodes(c, type))]
}
function line(component: 'AskUserQuestion' | 'CommandOutput', columns: number) {
  return { plugin: 'coco', component, viewport: { columns, rows: 48 }, props: component === 'AskUserQuestion'
    ? { tool: 'AskUserQuestion', questions: [{ question: 'Keep?' }] }
    : { command: 'compact', isErrored: false, args: '', text: 'native compact' } } as const
}
function directionOf(tree: unknown): string | undefined {
  return nodes(tree, 'Text').find(n => n.props?.italic !== undefined && n.props?.color === 'inactive')?.children?.join('')
}
function renderedGap(tree: unknown): string {
  const outer = nodes(tree, 'Text').find(n => n.props?.wrap === 'truncate-end' || n.props?.wrap === 'wrap')
  return (outer?.children ?? []).filter((c): c is string => typeof c === 'string').join('')
}
function checkRemoteWidth(tree: unknown, lang: keyof typeof WORDS, columns: number, phone: boolean, lead: number) {
  const svg = nodes(tree, 'Svg')[0]
  expect(svg?.props?.width).toBe(lead)
  const name = nodes(tree, 'Text').find(n => n.props?.bold && n.children?.includes(WORDS[lang].name))
  expect(name).toBeDefined()
  const direction = directionOf(tree)
  const gap = renderedGap(tree)
  expect(gap).toBe(direction ? gapBefore(direction, lang) : '')
  const buttons = nodes(tree, 'Button')
  for (const button of buttons) {
    expect(button.props?.key).toBe('coco:book:open')
    expect(typeof button.props?.label).toBe('string')
    expect(String(button.props?.label).length).toBeGreaterThan(0)
  }
  const occupied = lead + 7.2 + planPx(WORDS[lang].name, true) + planPx(gap)
    + (direction ? planPx(direction) : 0) + buttons.reduce((sum,button)=>sum+planPx(String(button.props!.label))+3*7.2,0)
  expect(occupied, `${lang}/${columns}/${lead}/${direction}/${buttons.map(button=>button.props?.label).join(',')}`).toBeLessThanOrEqual(columns * 7.2 * (phone ? 0.9 : 1))
  expect(nodes(tree, 'engine')).toEqual([ENGINE])
}

describe('B4c phone planning and desktop spacing', () => {
  for (const columns of [46, 54]) for (const { code: lang } of LANGS) {
    test(`mobile/${lang}/${columns}: every head, waiting and swept row fits its reserved budget`, {options:{language:lang}}, async ($, on) => {
      const initialState = Object.fromEntries(MOODS.map(mood => [`head:${mood}`, { mood, newest: true }]))
      const w=world(on, { store: { ...RECENT, lang }, initialState, engineRows: true, stepText: 'main-agent words' })
      await $.session.start(START); await settleLegacyStart($,w)
      for (const mood of MOODS) {
        await $.turn.start({ turnId: `turn-${mood}`, text: 'go' })
        for await (const _ of $.turn.step({ turnId: `turn-${mood}`, index: 0, model: 'claude', messageCount: 1 })) {}
        const ui = await $.ui.mount({ surface: 'mobile', plugin: 'coco', component: 'AssistantMessage', requestId: mood,
          props: { text: 'native reply', isFirstOfReply: true }, viewport: { columns, rows: 48 } })
        const tree = await ui.drawn()
        expect(nodes(tree, 'Button').filter(n=>n.props?.key==='coco:book:open').length).toBe(1)
        checkRemoteWidth(tree, lang, columns, true, 35)
        await ui.unmount()
      }
      for (const component of ['AskUserQuestion', 'CommandOutput'] as const) {
        const ui = await $.ui.mount({ surface: 'mobile', ...line(component, columns) })
        const tree = await ui.drawn()
        const lead = component === 'AskUserQuestion' ? 35 : 26
        const text = component === 'AskUserQuestion' ? WORDS[lang].aside.question : shedDirection(lang)
        checkRemoteWidth(tree, lang, columns, true, lead)
        expect(directionOf(tree)).toBe(cutDirection(text, columns * 7.2 * 0.9 - lead - 7.2 - planPx(WORDS[lang].name, true) - planPx(gapBefore(text, lang)), lang))
        await ui.unmount()
      }
    })
  }
  for (const component of ['AskUserQuestion', 'CommandOutput'] as const) {
    test(`vscode/${component}: all languages retain the full remote width`, async ($, on) => {
      const w=world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface: 'vscode' }); await settleLegacyStart($,w)
      for (const columns of [41, 46, 54, 83]) for (const { code: lang } of LANGS) {
        await $.command.run({ command: 'coco', args: `lang ${lang}`, origin: PERSON, presentation: P })
        const ui = await $.ui.mount({ surface: 'vscode', ...line(component, columns) })
        const tree = await ui.drawn()
        const lead = component === 'AskUserQuestion' ? 35 : 26
        const text = component === 'AskUserQuestion' ? WORDS[lang].aside.question : shedDirection(lang)
        checkRemoteWidth(tree, lang, columns, false, lead)
        expect(directionOf(tree)).toBe(cutDirection(text, columns * 7.2 - lead - 7.2 - planPx(WORDS[lang].name, true) - planPx(gapBefore(text, lang)), lang))
        await ui.unmount()
      }
    })
    for (const lang of ['zh', 'zh-Hant', 'ja', 'ko'] as const) for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      test(`${surface}/${lang}/${component}: desktop retains its ordinary gap and remote retains its language spacing`, {options:{language:lang}}, async ($, on) => {
        const w=world(on, { store: { ...RECENT, lang }, engineRows: true })
        await $.session.start({ ...START, surface }); await settleLegacyStart($,w)
        const tree = await (await $.ui.mount({ surface, ...line(component, 150) })).drawn()
        const legacyText = component === 'AskUserQuestion' ? WORDS[lang].aside.question : WORDS[lang].marks.swept
        expect(legacyText.startsWith('(')).toBe(true)
        const text = component === 'CommandOutput' && surface !== 'desktop' ? shedDirection(lang) : legacyText
        expect(renderedGap(tree)).toBe(surface === 'desktop' ? ' ' : '')
        expect(nodes(tree, 'Text').find(n => n.props?.italic !== undefined)?.children).toEqual([text])
        expect(nodes(tree, 'Text').find(n => n.props?.wrap)?.props?.wrap).toBe(surface === 'desktop' ? 'wrap' : 'truncate-end')
        expect(nodes(tree, 'engine')).toEqual([ENGINE])
      })
    }
  }
})

function checkFixedBox(source: string, percent: number) {
  // HC 1.4 requires media blocks on every code-drawn SVG. These empty blocks
  // preserve the fixed remote outline instead of making it theme-dependent.
  expect([...source.matchAll(/<style>(.*?)<\/style>/g)].map(row => row[1])).toEqual([
    '@media(prefers-contrast:more),(forced-colors:active){}@media(prefers-contrast:more) and (prefers-color-scheme:dark),(forced-colors:active) and (prefers-color-scheme:dark){}',
  ])
  expect((source.match(/stroke="#8A4A36"/g) ?? []).length).toBe(2)
  const lid = source.match(/<path[^>]*d="M3\.5 1\.5h13l2 3h-17z"[^>]*>/)?.[0] ?? ''
  const body = source.match(/<rect[^>]*x="2"[^>]*>/)?.[0] ?? ''
  for (const tag of [lid, body]) {
    expect(tag).toContain('stroke="#8A4A36"')
    expect(tag).toContain('stroke-width="1"')
  }
  expect(lid).toContain('fill="#CC7556"')
  expect(body).toContain('y="5" width="16" height="12"')
  expect(body).toContain('fill="#AA5E47"')
  expect(source).toContain('<path d="M6 2v2.5M9 2v2.5M12 2v2.5M15 2v2.5" stroke="#572A1C" stroke-width="1"/>')
  const level = Math.round(9 * percent / 100)
  // C3 round 4 high-contrast decision: paper remains cream through every offering level.
  expect(source).toContain(`<rect x="4" y="${16 - level}" width="12" height="${level}" fill="#FAEEE9"/>`)
}
const LEGACY_BOX_56 = '<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18" width="20" height="18">'
  + '<style>@media(prefers-contrast:more),(forced-colors:active){}@media(prefers-contrast:more) and (prefers-color-scheme:dark),(forced-colors:active) and (prefers-color-scheme:dark){}</style>'
  + '<style>.o{stroke:#573A33}@media (prefers-color-scheme:dark){.o{stroke:#E68F6F}}</style>'
  + '<path class="o" d="M3.5 1.5h13l2 3h-17z" fill="#CC7556" stroke-width="1"/>'
  + '<path d="M6 2v2.5M9 2v2.5M12 2v2.5M15 2v2.5" stroke="#572A1C" stroke-width="1"/>'
  + '<rect class="o" x="2" y="5" width="16" height="12" fill="#AA5E47" stroke-width="1"/>'
  + '<rect x="4" y="11" width="12" height="5" fill="#FAEEE9"/></svg>'

describe('B4c fixed remote offering outline', () => {
  for (const surface of ['vscode', 'mobile'] as const) {
    // The quota page draws the commit line where the box stood (lane C, 10-14); on these surfaces its outline is the same
    // fixed mid tone the box's was, since they draw a picture by the system's light or dark and not the editor's.
    for (const percent of [0, 56, 85]) test(`${surface}/${percent}: the book's commit line uses the fixed outline`, async ($, on) => {
      const w=world(on, { store: RECENT, percent })
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w)
      await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, plugin: 'coco', component: 'Pane', requestId: 'coco-book',
        props: { title: 'Coco', isFocused: true, bodyColumns: 54, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} } })
      const line = nodes(await ui.drawn(), 'Svg').find(n => n.props?.width === commitLineWidth(commitCount(percent), false, undefined, 2) && n.props?.height === commitLineHeight(2))
      expect(line).toBeDefined()
      expect(String(line?.props?.source)).toBe(commitLineSvg(commitCount(percent), undefined, false, 2, true))
      expect(String(line?.props?.source)).toContain('.e{fill:#8A4A36}')
      expect(String(line?.props?.source)).not.toContain('prefers-color-scheme:dark){.e')
      checkFixedBox(offeringSvg(percent, true), percent)
      expect(offeringSvg(56)).toBe(LEGACY_BOX_56)
    })
    test(`${surface}: D1 replaces the swept box with the approved26x15 emblem and retains legacy offering outline`, async ($, on) => {
      const w=world(on, { store: RECENT, engineRows: true })
      await $.session.start({ ...START, surface }); await settleLegacyStart($,w)
      const tree = await (await $.ui.mount({ surface, ...line('CommandOutput', 54) })).drawn()
      const box = nodes(tree, 'Svg')[0]
      expect(box?.props?.width).toBe(26)
      expect(box?.props?.height).toBe(15)
      expect(box?.props?.alt).toBe('')
      expect(String(box?.props?.source)).toBe(D1_APPROVED_SHED_EMBLEM)
      checkFixedBox(offeringSvg(0,true), 0)
      expect(offeringSvg(56)).toBe(LEGACY_BOX_56)
    })
  }
  test('the desktop book draws the commit line with the theme\'s own outline', async ($, on) => {
    const w=world(on, { store: RECENT, percent: 56 })
    await $.session.start({ ...START, surface: 'desktop' }); await settleLegacyStart($,w)
    await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: P })
    const tree = await (await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'Pane', requestId: 'coco-book',
      props: { title: 'Coco', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} } })).drawn()
    const line = nodes(tree, 'Svg').find(n => n.props?.width === commitLineWidth(commitCount(56), false, undefined, 2) && n.props?.height === commitLineHeight(2))
    expect(line?.props?.source).toBe(commitLineSvg(commitCount(56), undefined, false, 2))
    expect(offeringSvg(56)).toBe(LEGACY_BOX_56)
  })
})
