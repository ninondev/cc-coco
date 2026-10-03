// His book in every language he reads: one file of words per language (plugin/book/<lang>.json),
// complete, filled the same way and typeset by its own language's rules; every page drawn in
// every language with no hole; the slips written in every script; pictures described in his
// language.

import { describe, expect, test } from 'claude-code/testing'
import { rankOf } from '../hooks/book'
import { slipLargeSvg } from '../hooks/book-art'
import { LINES } from '../hooks/lines'
import { SLIP_FONTS, slipSvg } from '../hooks/pictures'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { P, PERSON, RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'claudesama',
  component: 'Pane' as const,
  requestId: 'claudesama-book',
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const CODES: readonly Lang[] = LANGS.map(l => l.code)
const PAGES = ['him', 'omen', 'offerings', 'log', 'library', 'settings'] as const
const FORTUNES = LINES.omikuji as unknown as Record<string, Record<string, readonly string[]>>

// What he is never called, as language.test.tsx holds the band's words to it.
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
  zh: /上帝|神明/,
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

  test('Automatic names its selected language with one dot, without another help line', { timeoutMs: 60_000 }, () => {
    for (const code of CODES) {
      const own = JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null') as { settings: { language: { autoNow: string; help?: string } } }
      expect(own.settings.language.autoNow).toBe('{auto} · {language}')
      expect(own.settings.language.help).toBeUndefined()
    }
  })

  // 12 languages times 6 pages: about half a second alone, several when the machine is busy.
  test('every page draws in every language, in that language, with no hole', { timeoutMs: 60_000 }, async ($, on) => {
    world(on, { store: RECENT, percent: 56, limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' }], cost: 1.84 })
    await $.session.start(START)
    const english: string[] = []
    const wrong: string[] = []
    for (const code of CODES) {
      await $.command.run({ command: 'claudesama', args: `lang ${code}`, origin: PERSON, presentation: P })
      await $.command.run({ command: 'claudesama', args: 'about', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
      for (const page of PAGES) {
        await ui.press({ key: `claudesama:book:tab:${page}` })
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

  test("the band's pictures and the book's slip are described in his language", async ($, on) => {
    world(on, { store: RECENT, percent: 56, env: { LANG: 'ja_JP.UTF-8' } })
    await $.session.start(START)
    const strip = await $.ui.mount({ surface: 'desktop', ...band(90) })
    expect((await strip.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('お賽銭箱、56%たまっている(コンテキストウィンドウ)')
    expect(await strip.find({ type: 'Button', text: WORDS.ja.marks.book })).toBeDefined()
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P })
    await strip.redraw()
    expect((await strip.findAll({ type: 'Svg' })).some(s => String(s.props.alt).startsWith('おみくじ:'))).toBe(true)
  })
})

describe('the slip in every script', () => {
  test('a fortune opens with its rank, whatever ends its sentences', () => {
    expect(rankOf('great blessing. your tests pass on the first run.')).toBe('great blessing')
    expect(rankOf('大吉。【失物】バグはただのタイポ。')).toBe('大吉')
    expect(rankOf('अति शुभ। टेस्ट पहली बार में पास होंगे।')).toBe('अति शुभ')
  })

  test('Han and Hangul ranks stand upright, Korean in a Korean face; others run down the side', () => {
    const korean = slipLargeSvg('소확행')
    expect(korean.match(/<text x="28"/g)?.length).toBe(3)
    expect(korean).toContain('AppleMyungjo')
    expect(slipLargeSvg('大吉').match(/<text x="28"/g)?.length).toBe(2)
    expect(slipLargeSvg('Pech auf ganzer Linie').match(/rotate\(90\)/g)?.length).toBe(2)
    expect(slipLargeSvg('curse').match(/rotate\(90\)/g)?.length).toBe(1)
    const hindi = slipLargeSvg('देर से ही सही')
    expect(hindi).toContain('Kohinoor Devanagari')
    expect(hindi).not.toContain('letter-spacing') // it would pull the joined letters apart
    expect(slipSvg('대박')).toContain(SLIP_FONTS.hangul)
    expect(slipSvg('上上签')).toContain(SLIP_FONTS.han)
  })

  test("every rank of every language fits the slip at a readable size, nothing squeezed", { timeoutMs: 60_000 }, () => {
    const squeezed: string[] = []
    for (const code of CODES) {
      for (const lines of Object.values(FORTUNES[code] ?? {})) {
        const svg = slipLargeSvg(rankOf(lines[0] ?? ''))
        const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map(m => Number(m[1]))
        if (svg.includes('textLength') || sizes.some(s => s < 12)) squeezed.push(`${code}: ${rankOf(lines[0] ?? '')}`)
      }
    }
    expect(squeezed).toEqual([])
  })
})
