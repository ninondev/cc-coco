// The fewer-words contract: every language carries the same small controls, and the
// actual registered hooks draw and change them on the surface where they belong.
import { describe, expect, test } from 'claude-code/testing'
import { cells } from '../hooks/band'
import { rankOf } from '../hooks/book'
import { LANGS, WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { LINES } from '../hooks/lines'
import { BOOK_FILES } from './book-files'
import { P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book',
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const CODES = LANGS.map(lang => lang.code)
const DELETED = [
  'settings.affection.help', 'settings.band.help', 'settings.language.help',
  'settings.motion.help', 'settings.motion.moving', 'offerings.costNote',
  'offerings.footnote', 'log.pagesNote', 'log.footnote',
  ...['installHelp', 'toolsLine', 'oldToolsLine', 'updateHelp', 'sizeHelp', 'sizePreview', 'loginHelp'].map(key => `settings.companion.${key}`),
]
const REASSURANCE = /guilt|don't go|don't leave|culpabilit|ne pars pas|Schuldgefühle|geh nicht|अपराध.?बोध|मत जाओ|bersalah|jangan pergi|sensi di colpa|non andare|罪悪感|行かないで|죄책감|가지 마|cobranças|não vá|reproches|no te vayas|内疚|愧疚|别走/i

function strings(tree: unknown, path = ''): Record<string, string> {
  if (typeof tree === 'string') return { [path]: tree }
  if (!tree || typeof tree !== 'object') return {}
  return Object.assign({}, ...Object.entries(tree).map(([key, value]) => strings(value, path ? `${path}.${key}` : key)))
}
function book(code: Lang): Record<string, unknown> {
  return JSON.parse(BOOK_FILES[`${code}.json`] ?? 'null')
}
function at(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, tree)
}
const HELP = /(?:help|Help|Note|Line|After)$|^(?:confirm|asks|cannot|removed|estimateNote|noReading|noLimits|oneADay|replace|fallback)$/
function widths(tree: unknown, source: string): string[] {
  const wrong: string[] = []
  for (const [path, value] of Object.entries(strings(tree))) {
    const key = path.split('.').at(-1) ?? ''
    // Narration and accessibility descriptions are not labels or visible notes.
    if (path.startsWith('direction.') || /^profile\.\d+\.text$|^library\.readings\.\d+\.text$/.test(path) || path.includes('.stageAlt.') || path.includes('.sizeAlt.') || path === 'settings.now' || path === 'settings.language.autoNow') continue
    const limit = HELP.test(key) ? 90 : 44
    // Four independent size buttons, not one label carrying all four names.
    const choices = path === 'settings.companion.sizes' ? value.split(' · ') : [value]
    for (const choice of choices) if (cells(choice) > limit) wrong.push(`${source}.${path}: ${cells(choice)} cells > ${limit}: ${choice}`)
  }
  return wrong
}
function punctuation(tree: unknown, source: string, language: 'zh' | 'ja'): string[] {
  const kept = new Set(language === 'zh' ? ['。', '《', '》', '～'] : ['、', '。', '「', '」', '『', '』', '・'])
  const wrong: string[] = []
  for (const [path, text] of Object.entries(strings(tree))) {
    const forbidden = [...text].filter(char => /[\u3000-\u303f\u30fb\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff65]/u.test(char) && !kept.has(char))
    if (forbidden.length || /[…“”‘’]/u.test(text)) wrong.push(`${source}.${path}: forbidden punctuation: ${text}`)
    if (text.endsWith('。') && !/^library\.readings\.\d+\.text$/.test(path)) wrong.push(`${source}.${path}: final ideographic stop`)
    if (/,[ \t]/u.test(text)) wrong.push(`${source}.${path}: space after ASCII comma`)
  }
  return wrong
}

describe('fewer words in all twelve books', () => {
  test('deleted keys and guilt or do-not-go reassurances have no place in settings', { timeoutMs: 60_000 }, () => {
    const wrong: string[] = []
    for (const code of CODES) {
      const own = book(code)
      for (const path of DELETED) if (at(own, path) !== undefined) wrong.push(`${code}.${path}: still present`)
      for (const [path, text] of Object.entries(strings(own.settings))) if (REASSURANCE.test(text)) wrong.push(`${code}.settings.${path}: ${text}`)
    }
    expect(wrong).toEqual([])
  })

  test('help and notes fit 90 cells; labels, states and each button fit 44', { timeoutMs: 60_000 }, () => {
    expect(cells('漢字')).toBe(4)
    expect(widths({ settings: { voice: { help: '字'.repeat(46), label: '字'.repeat(23) } } }, 'guard').length).toBe(2)
    expect(CODES.flatMap(code => widths(book(code), code))).toEqual([])
  })

  test('zh and ja use the kept punctuation only; readings alone may end in 。', { timeoutMs: 60_000 }, () => {
    expect(punctuation({ label: '・' }, 'guard', 'zh').length).toBe(1)
    expect(punctuation({ label: '・' }, 'guard', 'ja')).toEqual([])
    for (const language of ['zh', 'ja'] as const) {
      expect(punctuation({ label: '现在：你。', aside: '(等你), 下一行' }, 'guard', language).length).toBe(3)
      expect(punctuation({ library: { readings: [{ text: '这是一段。' }] } }, 'guard', language)).toEqual([])
      expect([...punctuation(book(language), `book.${language}`, language), ...punctuation(WORDS[language], `words.${language}`, language)]).toEqual([])
    }
  })

  test('warmth is the public command; affection remains compatible and replies say 温度', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, env: { LANG: 'zh_SG.UTF-8' } })
    await $.session.start(START)
    await $.command.run({ command: 'claudesama', args: 'warmth clingy', origin: PERSON, presentation: P })
    expect(w.view().affection).toBe('clingy')
    expect(w.toasts.at(-1)).toBe('好,温度:clingy')
    await $.session.start(START)
    expect(w.view().affection).toBe('clingy')
    await $.command.run({ command: 'claudesama', args: 'affection warm', origin: PERSON, presentation: P })
    expect(w.view().affection).toBe('warm')
    expect(w.toasts.at(-1)).toBe('好,温度:warm')
    await $.session.start(START)
    expect(w.view().affection).toBe('warm')
    for (const code of CODES) {
      expect(WORDS[code].reply.usage).toContain('warmth warm|clingy')
      expect(WORDS[code].reply.usage).not.toContain('affection warm|clingy')
    }
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    test(`${surface}: the band names its pictures or lines; marks appear only on desktop`, async ($, on) => {
      world(on, { store: RECENT })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.filter(node => String(node.key).startsWith('claudesama:set:band:')).map(node => node.props.label)).toEqual(surface === 'desktop' ? ['Painted', 'Pixel', 'Off'] : ['Full', 'One line', 'Off'])
      expect(buttons.filter(node => String(node.key).startsWith('claudesama:set:marks:')).map(node => node.props.label)).toEqual(surface === 'desktop' ? ['His and yours', 'Only his', 'Off'] : [])
      expect(await ui.find({ type: 'Text', text: /Marks in the conversation/ }) === undefined).toBe(surface === 'terminal')
      await ui.press({ key: 'claudesama:set:band:compact' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: surface === 'desktop' ? /Now: Pixel/ : /Now: One line/ })).toBeDefined()
    })

    for (const still of [false, true]) test(`${surface}: Motion is ${still ? 'drawn while still' : 'absent while he moves'}`, async ($, on) => {
      world(on, { store: RECENT, settings: { prefersReducedMotion: still } })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: /Motion\s+Still \(Reduce motion is on\)/ }) !== undefined).toBe(still)
      expect(await ui.find({ type: 'Text', text: /Motion/ }) !== undefined).toBe(still)
    })
  }
})

// Rank words pinned independently from persona/lines.json. Every slip is checked, not
// just the first one or a parser-derived expectation, so lost separators cannot pass.
const RANKS: Record<Lang, readonly string[]> = {
  en: ['great blessing', 'blessing', 'middle blessing', 'small blessing', 'late blessing', 'curse', 'great curse'],
  fr: ['chance insolente', 'bonne étoile', 'beau temps', 'petite veine', 'ça viendra', 'la poisse', 'poisse totale'],
  de: ['Schwein gehabt', 'Glück gehabt', 'Passt schon', 'Ein bisschen Glück', 'Glück auf Raten', 'Pech', 'Pech auf ganzer Linie'],
  hi: ['अति शुभ', 'शुभ', 'मिश्रित', 'ठीक-ठाक', 'देर से ही सही', 'सावधान', 'संकट'],
  id: ['hoki banget', 'hoki', 'lumayan', 'hoki tipis', 'hokinya nyusul', 'apes', 'apes banget'],
  it: ['fortuna sfacciata', 'buona stella', 'mica male', 'un pizzico di fortuna', 'pazienza', 'iella', 'iella nera'],
  ja: ['大吉', '吉', '中吉', '小吉', '末吉', '凶', '大凶'],
  ko: ['대박', '당첨', '중박', '소확행', '늦복', '꽝', '쪽박'],
  'pt-BR': ['sorte grande', 'sorte', 'deu bom', 'sortezinha', 'vai dar bom', 'azar', 'azar dos grandes'],
  'es-419': ['suertota', 'buena suerte', 'buena racha', 'suerte chiquita', 'ya te tocará', 'mala racha', 'martes 13'],
  'es-ES': ['el gordo', 'segundo premio', 'tercer premio', 'pedrea', 'reintegro', 'ni el reintegro', 'martes y trece'],
  zh: ['上上签', '上签', '中签', '中平签', '中下签', '下签', '下下签'],
}
test('the book finds the exact rank on every omen slip in every language', { timeoutMs: 60_000 }, () => {
  const keys = ['daikichi', 'kichi', 'chukichi', 'shokichi', 'suekichi', 'kyo', 'daikyo']
  const fortunes = LINES.omikuji as unknown as Record<Lang, Record<string, readonly string[]>>
  const wrong: string[] = []
  for (const code of CODES) keys.forEach((key, index) => {
    const slips = fortunes[code][key]
    expect(slips.length).toBe(2)
    for (const slip of slips) if (rankOf(slip) !== RANKS[code][index]) wrong.push(`${code}.${key}: ${rankOf(slip)}`)
  })
  expect(wrong).toEqual([])
})
