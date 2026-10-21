import { expect, test } from 'claude-code/testing'
import { desktopBand, planDesktop, terminalBand } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { durationText, numberLocale } from '../hooks/numbers'
import { WORDS } from '../hooks/words'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { world } from './world'

const corpus = JSON.parse(C3_WORDS_RAW)
const target = '~/Claude/Projects/atlas/plugin/assets/build'
const quota = { rateLimits: [{ kind: 'five_hour', percentUsed: 72 }, { kind: 'seven_day', percentUsed: 41 }], costUSD: 1.84, at: Date.UTC(2026, 9, 2, 9) }
const size = (columns: number) => ({ columns, maxRows: 30, screenRows: 48, isWorking: true })
const base = (lang: 'zh' | 'zh-Hant' | 'ja' | 'ko' | 'hi' | 'fr') => ({ ...initialView(), lang, context: 56, workSize: 'smaller' as const, quota })

// Use the capture's approved words, formatted values and sibling data. In particular,
// Korean's actual duration contains a space; the earlier synthetic fixture did not.
for (const lang of ['zh', 'zh-Hant', 'ja'] as const) test(`W4 captured ${lang} budget retains its crossing verdict before the name`, () => {
  const window = WORDS[lang].quota.kinds.five_hour!
  const percent = new Intl.NumberFormat(numberLocale(lang), { style: 'percent', maximumFractionDigits: 0 }).format(.8)
  const text = corpus.budget[lang].replace('{window}', window).replace('{p}', percent)
  const verdict = { zh: '过了你设的线', 'zh-Hant': '過了你設的線', ja: '超えた' }[lang]
  const view = { ...base(lang), quota: { ...quota, rateLimits: [{ kind: 'five_hour', percentUsed: 83 }, { kind: 'seven_day', percentUsed: 41 }] },
    line: { id: 'budget', key: 'budget', text, class: 1 as const, slots: [{ value: window, kind: 'label' as const }, { value: percent, kind: 'value' as const }], expiresAt: 14000 } }
  expect(text.includes(verdict)).toBe(true)
  for (const columns of [38, 53]) {
    const speech = planDesktop(view, size(columns)).speech ?? ''
    expect({ columns, speech, verdictRetained: speech.includes(verdict), percentRetained: speech.includes(percent) })
      .toEqual({ columns, speech, verdictRetained: true, percentRetained: true })
  }
})

for (const lang of ['ja', 'ko', 'hi', 'fr'] as const) test(`W4 captured ${lang} chapter retains its authored fullness predicate`, () => {
  const text = corpus.chapter[lang] as string
  const point = text.split('/compact')[0]!.trim().replace(/[.!?。।]+$/u, '')
  const view = { ...base(lang), line: { id: 'chapter', key: 'chapter', text, class: 2 as const, slots: [], expiresAt: 14000,
    button: { key: 'coco:chapter:compact', label: corpus['chapter.button'][lang] as string } } }
  expect(point.length).toBeGreaterThan(0)
  for (const columns of [38, 53]) {
    const plan = planDesktop(view, size(columns)), speech = plan.speech ?? ''
    const layout = { name: plan.name, buttonWidth: plan.buttonWidth, textWidth: plan.textWidth, lineRows: plan.lineRows }
    expect({ columns, speech, layout, pointRetained: speech.includes(point) }).toEqual({ columns, speech, layout, pointRetained: true })
  }
})

test('W4 captured Korean build retains the real spaced current duration and its predicate', () => {
  const lang = 'ko', now = durationText(130, lang, corpus.durations[lang]), usual = durationText(58, lang, corpus.durations[lang])
  expect(now.includes(' ')).toBe(true)
  const text = corpus.slow_build[lang].replace('{now}', now).replace('{usual}', usual)
  const view = { ...base(lang), line: { id: 'slow_build', key: 'slow_build', text, class: 1 as const,
    slots: [{ value: now, kind: 'value' as const }, { value: usual, kind: 'value' as const }], expiresAt: 14000 } }
  for (const columns of [38, 53]) {
    const speech = planDesktop(view, size(columns)).speech ?? ''
    expect({ columns, speech, currentUnitRetained: speech.includes(now + ' 걸렸어') })
      .toEqual({ columns, speech, currentUnitRetained: true })
  }
})

const guardCases = [
  ['hi', 'guard.chmod', 'बदलने देगा', ['फ़ाइल']], ['hi', 'guard.chown', 'बदल देगा', ['मालिक']],
  ['zh', 'guard.chown', '改掉', ['所有者']], ['zh', 'guard.dropRows', '清空', ['所有数据']],
  ['zh', 'guard.kubectl', '删掉', ['build', '里面的所有东西']], ['zh', 'guard.bucket', '删掉', ['build', '里面存的所有东西']],
  ['zh-Hant', 'guard.chown', '改掉', ['所有者']], ['zh-Hant', 'guard.dropRows', '清空', ['所有資料']],
  ['zh-Hant', 'guard.kubectl', '刪掉', ['build', '裡面的所有東西']], ['zh-Hant', 'guard.bucket', '刪掉', ['build', '裡面存的所有東西']],
] as const
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim()
const flatten = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(flatten).join('') : node && typeof node === 'object' ? flatten(node.children ?? []) : ''
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...(node.children ?? []).flatMap(nodes)]
const speechRoots = (node: any): any[] => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(speechRoots) : node.type === 'Text'
    ? !node.props?.bold && node.props?.wrap && node.props?.color !== 'inactive' ? [node] : []
    : (node.children ?? []).flatMap(speechRoots)

for (const lang of ['ja', 'fr'] as const) test(`W4 captured ${lang} chapter yields only the whole action when its point needs the narrow row`, async ($, on) => {
  const text = corpus.chapter[lang] as string, point = text.split('/compact')[0]!.trim().replace(/[.!?。।]+$/u, '')
  const label = corpus['chapter.button'][lang] as string, key = 'coco:chapter:compact'
  const view = { ...base(lang), line: { id: 'chapter', key: 'chapter', text, class: 2 as const, slots: [], expiresAt: 14000, button: { key, label } } }
  // 10-14: the squash button is shorter than the old turn-the-page one, so it now fits at 38; the narrow row is 32
  let columns = 32
  const requestId = 'w4-captured-chapter-action'
  on('ui.render', { component: 'Pane', requestId }, ($, event) => desktopBand($.ui.resolve(event) as any, view, size(columns), '<svg xmlns="http://www.w3.org/2000/svg"/>'))
  world(on)
  for (columns of [32, 102]) {
    const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'Pane', requestId,
      props: { title: 'W4 captured chapter', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn(), speech = normalize(speechRoots(tree).map(flatten).join(' '))
    const actions = nodes(tree).filter(node => node.type === 'Button' && node.props?.key === key)
    expect({ columns, speech, pointRetained: speech.includes(point) }).toEqual({ columns, speech, pointRetained: true })
    expect(actions.length).toBe(columns === 32 ? 0 : 1)
    for (const action of actions) expect(action.props.label).toBe(label)
    await ui.unmount()
  }
})

for (const [lang, key, operation, objects] of guardCases) for (const columns of [24, 60, 80])
  test(`W4 captured terminal ${columns} ${lang}/${key} never substitutes an object tail for its operation`, async ($, on) => {
    const template = corpus[key][lang] as string
    const firstClause = template.split(/[.!?。।,，]/u)[0]!
    const pieces = firstClause.split('{target}').map(normalize).filter(Boolean)
    expect(pieces.length).toBe(2)
    expect(template.includes(operation)).toBe(true)
    const source = template.replace('{target}', target)
    const view = { ...base(lang), mood: 'waiting' as const, frame: 'waiting' as const,
      line: { id: key, key, text: source, class: 3 as const, slots: [{ value: target, kind: 'path' as const }], expiresAt: 14000 } }
    const requestId = 'w4-captured-guard'
    on('ui.render', { component: 'Pane', requestId }, ($, event) => terminalBand($.ui.resolve(event) as any, view, size(columns)))
    world(on)
    const ui = await $.ui.mount({ surface: 'terminal', plugin: 'coco', component: 'Pane', requestId,
      props: { title: 'W4 captured guard', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn(), all = nodes(tree), roots = speechRoots(tree)
    const speech = normalize(roots.map(flatten).join(' '))
    expect(roots.length).toBeLessThanOrEqual(1)
    expect(all.some(node => node.type === 'Text' && normalize(flatten(node)) === '…')).toBe(false)
    if (columns === 24 && speech === '') {
      expect(all.filter(node => node.type === 'Text').map(flatten)).toEqual([WORDS[lang].name])
    } else {
      expect({ speech, operationRetained: speech.includes(operation) }).toEqual({ speech, operationRetained: true })
      expect({ speech, objectRetained: objects.some(object => speech.includes(object)) }).toEqual({ speech, objectRetained: true })
      if (columns === 24) {
        let cursor = 0
        for (const piece of pieces) {
          const found = speech.indexOf(piece, cursor)
          expect({ speech, piece, foundInOrder: found >= cursor }).toEqual({ speech, piece, foundInOrder: true })
          cursor = found + piece.length
        }
      }
    }
    await ui.unmount()
  })

for (const lang of ['zh', 'zh-Hant'] as const) for (const columns of [24, 60, 80])
  test(`W4 captured terminal ${columns} ${lang}/guard.shred keeps its object or omits the whole warning`, async ($, on) => {
    const key = 'guard.shred', source = corpus[key][lang].replace('{target}', target)
    const view = { ...base(lang), mood: 'waiting' as const, frame: 'waiting' as const,
      line: { id: key, key, text: source, class: 3 as const, slots: [{ value: target, kind: 'path' as const }], expiresAt: 14000 } }
    const requestId = 'w4-captured-shred-object'
    on('ui.render', { component: 'Pane', requestId }, ($, event) => terminalBand($.ui.resolve(event) as any, view, size(columns)))
    world(on)
    const ui = await $.ui.mount({ surface: 'terminal', plugin: 'coco', component: 'Pane', requestId,
      props: { title: 'W4 captured object', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn(), all = nodes(tree), speech = normalize(speechRoots(tree).map(flatten).join(' '))
    if (columns === 24 && speech === '') {
      expect(all.filter(node => node.type === 'Text').map(flatten)).toEqual([WORDS[lang].name])
      expect(all.some(node => node.type === 'Button')).toBe(false)
    } else if (columns === 24) {
      // BAND F2: his name goes before his words are cut, so the room it leaves keeps the object and the operation; the line is
      // cut once at its end and never stands with a bare object
      expect(speech.includes('build')).toBe(true)
      expect(speech.includes('抹掉')).toBe(true)
      expect((speech.match(/…/gu) ?? []).length).toBeGreaterThanOrEqual(1)
    } else {
      expect(speech.includes(lang === 'zh' ? '彻底抹掉' : '徹底抹掉')).toBe(true)
      expect(speech.includes('build')).toBe(true)
      expect(all.some(node => node.type === 'Text' && node.props?.bold && flatten(node).includes('build'))).toBe(true)
    }
    await ui.unmount()
  })
