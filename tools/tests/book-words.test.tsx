// His book in every language he reads: one file of words per language (plugin/book/<lang>.json),
// complete, filled the same way and typeset by its own language's rules; every page drawn in
// every language with no hole; pictures described in his language.

import { describe, expect, test } from 'claude-code/testing'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { settleLegacyStart, P, PERSON, RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const CODES: readonly Lang[] = LANGS.map(l => l.code)
const PAGES = ['him', 'omen', 'offerings', 'log', 'library', 'settings'] as const

// What he is never called, as language.test.tsx holds the band's words to it.
const CHINESE_NOT_GOD = /上帝|神明/
const NOT_GOD: Record<Lang, RegExp> = {
  en: /\b(gods?|deity|divine)\b/i,
  fr: /\bdieux?\b|divinit|\bdivin/i,
  de: /gott|göttlich/i,
  hi: /देवता|भगवान|ईश्वर|प्रभु|देव /,
  id: /\b(dewa|tuhan|ilahi?|allah)\b/i,
  it: /\bdio\b|\bdivin|\bdeit/i,
  ja: /ゴッド/,
  ko: /하느님|하나님|(^|[\s(])신(이|은|님|이야)?([\s.,?)]|$)/,
  'pt-BR': /\bdeus(es)?\b|\bdivin/i,
  'es-419': /\bdios(es)?\b|deidad|\bdivin/i,
  'es-ES': /\bdios(es)?\b|deidad|\bdivin/i,
  zh: CHINESE_NOT_GOD,
  'zh-Hant': CHINESE_NOT_GOD,
}

// Every string of a tree by its key path.
function strings(tree: unknown, path = ''): Record<string, string> {
  if (typeof tree === 'string') return { [path]: tree }
  const out: Record<string, string> = {}
  if (Array.isArray(tree)) tree.forEach((v, i) => Object.assign(out, strings(v, `${path}[${i}]`)))
  else if (tree && typeof tree === 'object') for (const [k, v] of Object.entries(tree)) Object.assign(out, strings(v, `${path}.${k}`))
  return out
}

const holes = (key: string) => (key.match(/\{\w+\}/g) ?? []).sort().join(' ')

describe('his book in every language', () => {
  test('every language file has every word English has, filled the same way, typeset by its own rules', { timeoutMs: 60_000 }, () => {
    expect(Object.keys(BOOK_FILES).sort()).toEqual(CODES.map(code => `${code}.json`).sort())
    const files: Record<string, unknown> = {}
    for (const code of CODES) files[code] = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null')
    const english = strings(files.en)
    expect(Object.keys(english).length).toBeGreaterThan(100)
    const wrong: string[] = []
    for (const code of CODES) {
      const own = strings(files[code])
      if (Object.keys(own).sort().join() !== Object.keys(english).sort().join()) wrong.push(`${code}: not the same words as English`)
      for (const [key, text] of Object.entries(own)) {
        if (text.trim() === '') wrong.push(`${code}${key}: empty`)
        if (holes(text) !== holes(english[key] ?? '')) wrong.push(`${code}${key}: fills ${holes(text)}`)
        if (/[–—―⸺⸻]/.test(text)) wrong.push(`${code}${key}: a dash`)
        if (/\bgods?\b/i.test(text) || NOT_GOD[code].test(text)) wrong.push(`${code}${key}: calls him a god`)
        if (code === 'fr' && /[^\u00a0\u202f][?!:;»]|«[^\u00a0\u202f]/.test(text.replace(/https?:\S+|\/\S+/g, ''))) wrong.push(`fr${key}: no no-break space`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('no page promises what the desktop does not draw: no word of the step row\'s "Working"', { timeoutMs: 60_000 }, () => {
    const promised: string[] = []
    for (const code of CODES) {
      for (const [key, text] of Object.entries(strings(JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null')))) {
        if (/Working/.test(text)) promised.push(`${code}${key}`)
      }
    }
    expect(promised).toEqual([])
  })

  test('Automatic names its selected language in brackets, without another help line', { timeoutMs: 60_000 }, () => {
    for (const code of CODES) {
      const own = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as { settings: { language: { autoNow: string; help?: string } } }
      expect(own.settings.language.autoNow).toMatch(/^\{auto\} ?\(\{language\}\)$/)
      expect(own.settings.language.help).toBeUndefined()
    }
  })

  // Each supported language times 6 pages: about half a second alone, several when the machine is busy.
  test('every page draws in every language, in that language, with no hole', { timeoutMs: 60_000 }, async ($, on) => {
    const setupWorld=world(on, { store: RECENT, percent: 56, limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' }], cost: 1.84 })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const english: string[] = []
    const wrong: string[] = []
    for (const code of CODES) {
      await $.command.run({ command: 'coco', args: `lang ${code}`, origin: PERSON, presentation: P })
      await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
      for (const page of PAGES) {
        await ui.press({ key: `coco:book:tab:${page}` })
        await ui.redraw()
        const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
        const labels = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
        const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
        for (const text of [...texts, ...labels, ...alts]) if (/undefined|\{\w+\}|\[object/.test(text)) wrong.push(`${code} ${page}: ${text}`)
        if (page === 'him') {
          if (code === 'en') english.push(...labels)
          else if (labels.join('|') === english.join('|')) wrong.push(`${code}: tabs still in English`)
        }
      }
      await ui.unmount()
    }
    expect(wrong).toEqual([])
  })

  test("the band's pictures are described in his language", async ($, on) => {
    const setupWorld=world(on, { store: RECENT, percent: 56, env: { LANG: 'ja_JP.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const strip = await $.ui.mount({ surface: 'desktop', ...band(90) })
    expect((await strip.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('コンテキストウィンドウ、56%使用中')
    expect(await strip.find({ type: 'Button', text: WORDS.ja.marks.book })).toBeDefined()
  })
})
