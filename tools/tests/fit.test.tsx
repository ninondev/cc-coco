// Nothing he draws is cut off, at any width: the desktop band plans its layout from the width it
// is given and gives things up in one fixed order; the terminal band always fits its columns in
// cells; a stage direction may end in an ellipsis, a line he says never does; and no space goes
// before a full-width bracket. (The desktop's pixels are checked in WebKit by the preview build.)

import { describe, expect, test } from 'claude-code/testing'
import { cells, planDesktop } from '../hooks/band'
import type { BandSize } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LINES } from '../hooks/lines'
import { desktopWidth } from '../hooks/pictures'
import { COLUMN_PX, cutToPx, gapBefore, minWrapPx, planPx } from '../hooks/typeset'
import { WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import type { ClaudesamaView } from '../types'
import { P, PERSON, RECENT, band, world } from './world'
import { COMPANION_HOME, companionScene } from './companion-fixture'
import { BOOK_FILES } from './book-files'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const LANGS = { en: 'en_US.UTF-8', de: 'de_DE.UTF-8', hi: 'hi_IN.UTF-8', ja: 'ja_JP.UTF-8', ko: 'ko_KR.UTF-8', zh: 'zh_CN.UTF-8' } as const
type Code = keyof typeof LANGS
const CODES = Object.keys(LANGS) as Code[]
const IDLE_DIRECTIONS: Record<Lang, string> = {
  en: '(training...)', fr: "(à l'entraînement...)", de: '(im Training...)', hi: '(अभ्यास में...)',
  id: '(sedang berlatih...)', it: '(in allenamento...)', ja: '(学習中...)', ko: '(수련 중...)',
  'pt-BR': '(treinando...)', 'es-419': '(entrenando...)', 'es-ES': '(entrenando...)', zh: '(练功中...)',
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function texts(node: unknown, out: { text: string; wrap?: unknown }[] = []): { text: string; wrap?: unknown }[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  if (n.type === 'Text') out.push({ text: (n.children ?? []).filter(c => typeof c === 'string').join(''), wrap: n.props?.wrap })
  for (const child of n.children ?? []) texts(child, out)
  return out
}

// A drawing's words in reading order, nested texts included.
function words(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return ((node as Node).children ?? []).map(words).join('')
}

// The terminal lays out like Yoga: a box that may shrink goes down to its narrowest content (a
// text that may be cut, to nothing; one that wraps, to its longest word), one that may not keeps
// its whole line.
function longestWord(text: string): number {
  let best = 0
  for (const word of text.split(/\s+/)) {
    for (const part of word.split(/(?<=[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠])/u)) best = Math.max(best, cells(part))
  }
  return best
}
function natural(node: unknown): number {
  if (typeof node === 'string') return Math.max(...node.split('\n').map(cells))
  if (!node || typeof node !== 'object') return 0
  const n = node as Node
  const p = n.props ?? {}
  if (n.type === 'Raster' || n.type === 'Image') return Number(p.columns ?? 0)
  if (n.type === 'Button') return cells(String(p.label)) + 4
  const kids = (n.children ?? []).map(natural)
  if (n.type === 'Text') return kids.reduce((a, b) => a + b, 0)
  const row = !String(p.flexDirection ?? 'row').startsWith('column')
  return Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + Math.max(Number(p.width ?? 0), row ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids))
}
function narrowest(node: unknown): number {
  if (typeof node === 'string') return longestWord(node)
  if (!node || typeof node !== 'object') return 0
  const n = node as Node
  const p = n.props ?? {}
  if (p.flexShrink === 0) return natural(node)
  if (n.type === 'Raster' || n.type === 'Image') return Number(p.columns ?? 0)
  if (n.type === 'Button') return cells(String(p.label)) + 4
  if (n.type === 'Text') return String(p.wrap ?? '').startsWith('truncate') ? 0 : Math.max(0, ...(n.children ?? []).map(narrowest))
  const kids = (n.children ?? []).map(narrowest)
  // a row that wraps is as narrow as its widest child
  const row = !String(p.flexDirection ?? 'row').startsWith('column') && p.flexWrap !== 'wrap'
  return Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + Math.max(Number(p.width ?? 0), row ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids))
}

function view(lang: Lang, change: Partial<ClaudesamaView> = {}): ClaudesamaView {
  return { ...initialView(), lang, context: 72, ...change }
}
const size = (columns: number, isWorking = false): BandSize => ({ columns, maxRows: 30, screenRows: 48, isWorking })

const FULL_WIDTH_AFTER_SPACE = / [（「『【〔〈《［｛]/u

// Spoken leaves include every greeting, ordinary/clingy key and fortune in every language.
// Keep their key/index in failures, even when two keys happen to contain the same words.
function spokenLeaves(value: unknown, key = ''): { key: string; line: string }[] {
  if (typeof value === 'string') return [{ key, line: value }]
  if (Array.isArray(value)) return value.flatMap((child, index) => spokenLeaves(child, `${key}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).filter(([name]) => !name.startsWith('_')).flatMap(([name, child]) => spokenLeaves(child, key ? `${key}.${name}` : name))
}

// Independent wrapping oracle: ordinary spaces separate words; CJK characters can each
// break. A Latin run inside Japanese/Chinese stays whole (including its punctuation).
function longestSpokenRunPx(line: string): number {
  let widest = 0
  let run = ''
  const flush = () => { widest = Math.max(widest, planPx(run)); run = '' }
  for (const char of line) {
    if (char === ' ' || char === '\n') flush()
    else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uff60]/u.test(char)) {
      flush()
      widest = Math.max(widest, planPx(char))
    } else run += char
  }
  flush()
  return widest
}

const SPOKEN_LAYOUTS = [
  { name: 'rest', band: 'on', working: false },
  { name: 'compact', band: 'compact', working: false },
  { name: 'working', band: 'on', working: true },
] as const
const SPOKEN_CASES = (Object.keys(WORDS) as Lang[]).map(lang => ({
  lang,
  // Use a real four-digit page count, as the runtime fills milestone placeholders.
  leaves: [...spokenLeaves(LINES[lang]), ...spokenLeaves(LINES.omikuji[lang], 'omikuji')].map(({ key, line }) => {
    const spoken = line.replace(/\{pages\}/g, '1284')
    return { key, line: spoken, runPx: longestSpokenRunPx(spoken), linePx: planPx(spoken) }
  }),
}))
const SPOKEN_COMBINATIONS = SPOKEN_CASES.reduce((total, { leaves }) => total + leaves.length * 157 * 2 * SPOKEN_LAYOUTS.length * 2, 0)

function spokenRoom(v: ClaudesamaView, columns: number, working: boolean, runPx?: number) {
  const plan = planDesktop(v, size(columns, working))
  const line = v.slip?.text ?? v.said ?? ''
  const fullWidth = columns * COLUMN_PX
  // Match the drawn frame's physical boxes, not a production text-fitting helper: sprite
  // plus its margin, optional 24px slip plus its margin, 20px box and 28px button chrome.
  const left = (plan.height ? desktopWidth(plan.height) + COLUMN_PX : 0) + (plan.slip ? 24 + COLUMN_PX : 0)
  const offering = v.context === null ? 0 : 20 + planPx(` ${v.estimate ? '~' : ''}${v.context}%${plan.word ? ` ${WORDS[v.lang].context}` : ''}`)
  const button = 28 + planPx(plan.label)
  const right = plan.row
    ? (v.context === null ? 0 : 2 * COLUMN_PX + offering) + 2 * COLUMN_PX + button
    : 2 * COLUMN_PX + Math.max(offering, button)
  const middle = fullWidth - left - right
  const belowRow = plan.row && plan.aside === 'below'
  const available = belowRow ? fullWidth : plan.row
    ? middle - planPx(plan.name ?? '', true) - planPx(gapBefore(line))
    : middle
  return { plan, middle, available, required: runPx ?? longestSpokenRunPx(line), belowRow }
}

describe(`every spoken line fits the desktop: ${SPOKEN_COMBINATIONS} combinations`, () => {
  test('wrapping preserves NBSP words and Latin runs between CJK characters', () => {
    expect(minWrapPx('long short')).toBe(Math.max(planPx('long'), planPx('short')))
    expect(minWrapPx('long\u00a0short')).toBe(planPx('long\u00a0short'))
    expect(minWrapPx('中Spendenkasten文')).toBe(planPx('Spendenkasten'))
    expect(minWrapPx('中日本語文')).toBe(planPx('中'))
  })

  test('German offering_full, rest at 24 columns and 91%: Spendenkasten stays whole', () => {
    const line = 'Der Spendenkasten ist fast voll.'
    expect(spokenLeaves(LINES.de).some(leaf => leaf.line === line)).toBe(true)
    const { available, required, plan } = spokenRoom(view('de', { said: line, context: 91 }), 24, false)
    expect({ line, available, required, frame: plan.frame, fits: available >= required }).toEqual({ line, available, required, frame: plan.frame, fits: true })
  })

  test('German Marzipanschwein fortune at 24 columns: the full-width fallback keeps the slip and controls whole', () => {
    const line = LINES.omikuji.de.suekichi[0]
    expect(line.includes('Marzipanschwein.')).toBe(true)
    for (const context of [34, 91]) {
      const v = view('de', { context, said: null, slip: { rank: 'suekichi', label: '末吉', text: line } })
      const { plan, middle, available, required, belowRow } = spokenRoom(v, 24, false)
      expect(plan.row).toBe(true)
      expect(plan.aside).toBe('below')
      expect(plan.text).toBe(line)
      expect(belowRow).toBe(true)
      expect(available).toBe(24 * COLUMN_PX)
      expect({ middle, required, controlsFit: middle >= 0, lineFits: available >= required }).toEqual({ middle, required, controlsFit: true, lineFits: true })
    }
  })

  for (const { lang, leaves } of SPOKEN_CASES) {
    const expected = leaves.length * 157 * 2 * SPOKEN_LAYOUTS.length * 2
    test(`${lang}: ${leaves.length} lines, ${expected} combinations; columns 24..180, box 34/91%, rest/compact/working, slip in/out`, { timeoutMs: 120_000 }, () => {
      let checked = 0
      let failures = 0
      const samples: unknown[] = []
      for (const { key, line, runPx, linePx } of leaves) for (const context of [34, 91]) for (const layout of SPOKEN_LAYOUTS) for (const slipOut of [false, true]) {
        const v = view(lang, {
          context, band: layout.band,
          said: slipOut ? null : line,
          slip: slipOut ? { rank: 'kichi', label: '吉', text: line } : null,
        })
        for (let columns = 24; columns <= 180; columns++) {
          const { plan, available, required, middle, belowRow } = spokenRoom(v, columns, layout.working, runPx)
          checked++
          // At rest speech wraps inside the middle column. In a compact/working row it
          // stands beside his name or below the entire row, where it has full band width.
          const intact = !plan.row || plan.text === line
          const placed = !plan.row || plan.aside === 'beside' || belowRow
          const fitsWhole = !plan.row || plan.aside !== 'beside' || available >= linePx
          if (middle < 0 || available < required || !intact || !placed || !fitsWhole) {
            failures++
            if (samples.length < 6) samples.push({ key, line, columns, context, layout: layout.name, slipOut, middle, available, required, linePx, frame: plan.frame, aside: plan.aside, intact, placed, fitsWhole })
          }
        }
      }
      expect({ checked, expected, failures, samples }).toEqual({ checked: expected, expected, failures: 0, samples: [] })
    })
  }
})

describe('the space before a stage direction', () => {
  test('none before a full-width bracket, one ordinary space otherwise', () => {
    expect(gapBefore('（练功中）')).toBe('')
    expect(gapBefore('「よし」')).toBe('')
    expect(gapBefore('(training...)')).toBe(' ')
    expect(gapBefore('(अभ्यास में...)')).toBe(' ')
    expect(gapBefore('(练功中...)')).toBe(' ')
  })

  for (const lang of CODES) {
    test(`in ${lang}: the band at three widths, the question line and the repeated slip keep the rule`, { timeoutMs: 60_000 }, async ($, on) => {
      world(on, { store: { ...RECENT, omen: { day: '2026-10-02', rank: 'kichi', index: 0 } }, env: { LANG: LANGS[lang] }, engineRows: true })
      await $.session.start(START)
      const drawn: string[] = []
      for (const surface of ['desktop', 'terminal'] as const) for (const cols of [34, 63, 120]) drawn.push(...texts(await (await $.ui.mount({ surface, ...band(cols) })).drawn()).map(t => t.text))
      await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P }) // the same day's slip again: its note joins it
      for (const surface of ['desktop', 'terminal'] as const) drawn.push(...texts(await (await $.ui.mount({ surface, ...band(120) })).drawn()).map(t => t.text))
      const ask = await $.ui.mount({ surface: 'desktop', plugin: 'claudesama', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: [{ question: 'Which?' }] } })
      drawn.push(words(await ask.drawn()))
      expect(drawn.some(text => text.includes(WORDS[lang].again))).toBe(true)
      for (const text of drawn.filter(t => t.trim() !== '')) { // (a run of spaces alone is the slip's paper)
        expect([lang, text, FULL_WIDTH_AFTER_SPACE.test(text)]).toEqual([lang, text, false])
        expect([lang, text, text.startsWith('  ')]).toEqual([lang, text, false])
      }
    })
  }
})

describe('the desktop band at every width', () => {
  test('all twelve training directions keep their parentheses whenever the band cuts them, from 24 to 200 columns', { timeoutMs: 60_000 }, () => {
    let bandCuts = 0
    for (const lang of Object.keys(IDLE_DIRECTIONS) as Lang[]) {
      const direction = IDLE_DIRECTIONS[lang]
      expect(WORDS[lang].aside.idle).toBe(direction)
      expect(gapBefore(direction)).toBe(' ')
      // Short directions may always fit beside the longer name. Exercise their cut as well.
      const shortened = `${direction.slice(0, -4)}…)`
      const cut = cutToPx(direction, planPx(shortened))
      expect(cut).toBeDefined()
      expect(/^\(.+…\)$/.test(cut ?? '')).toBe(true)
      expect(direction.startsWith((cut ?? '').slice(0, -2))).toBe(true)
      expect(planPx(cut ?? '') <= planPx(shortened)).toBe(true)
      if (lang === 'zh') expect(cut).toBe('(练功中…)')
      if (lang === 'ja') expect(cut).toBe('(学習中…)')
      let whole = 0
      for (const setting of ['on', 'compact'] as const) for (let cols = 24; cols <= 200; cols++) {
        const plan = planDesktop(view(lang, { band: setting }), size(cols))
        if (plan.text === undefined) {
          expect(plan.aside).toBe('none')
          continue
        }
        expect([lang, setting, cols, /^\(.+\)$/.test(plan.text)]).toEqual([lang, setting, cols, true])
        if (plan.text === direction) whole++
        else {
          bandCuts++
          expect(plan.text.endsWith('…)')).toBe(true)
          expect(direction.startsWith(plan.text.slice(0, -2))).toBe(true)
          expect(plan.text.includes(' …')).toBe(false)
        }
      }
      expect([lang, whole > 0]).toEqual([lang, true])
    }
    expect(bandCuts > 0).toBe(true)
  })

  test("the owner's band (Chinese, 34 columns): the percentage and the book button whole, the direction under his name", () => {
    const plan = planDesktop(view('zh'), size(34))
    expect(plan.word).toBe(false)
    expect(plan.label === WORDS.zh.marks.book || plan.label === WORDS.zh.marks.shelf).toBe(true)
    expect(plan.aside).toBe('below')
    expect(plan.text).toBe(WORDS.zh.aside.idle)
  })

  const STATES: [string, Partial<ClaudesamaView>, boolean][] = [
    ['reading', {}, false],
    ['saying', { said: 'the offering box is almost full. time to sweep it out soon.', mood: 'happy' }, false],
    ['working', { mood: 'work' }, true],
    ['working and saying', { mood: 'work', said: 'still at it. the parser has more corners than it looks.' }, true],
    ['omen', { slip: { rank: 'kichi', label: '', text: 'blessing. the docs and the code agree today. lucky number: 304.' }, mood: 'omen' }, false],
  ]
  test('as the band narrows, things are given up in one order and never come back; his lines are never cut', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      for (const [state, change, working] of STATES) {
        let frame = 0
        let place = 0
        for (let cols = 200; cols >= 24; cols--) {
          const plan = planDesktop(view(lang, change), size(cols, working))
          // the frame (button label, picture, name) only ever gets poorer; within a frame, so does the place
          expect([lang, state, cols, plan.frame >= frame]).toEqual([lang, state, cols, true])
          if (plan.frame === frame) expect([lang, state, cols, plan.place >= place]).toEqual([lang, state, cols, true])
          frame = plan.frame
          place = plan.place
          expect(plan.label === WORDS[lang].marks.book || plan.label === WORDS[lang].marks.shelf).toBe(true)
          const said = change.slip?.text ?? change.said
          if (working && said && plan.text !== undefined) expect(plan.text).toBe(said) // a line in a row is whole
        }
      }
    }
  })

  test('a cut stage direction keeps its closing bracket, ends on a whole word where words are spaced, never on a space', () => {
    expect(cutToPx('(liest eine Zeile noch mal)', planPx('(liest eine Zeile…)'))).toBe('(liest eine Zeile…)')
    expect(cutToPx('(writing in the margins)', planPx('(writing i…)'))).toBe('(writing…)')
    expect(cutToPx('（把一行又读了一遍）', planPx('（把一行…）'))).toBe('（把一行…）')
    expect(cutToPx('(training...)', 5)).toBe(undefined)
  })
})

describe('the terminal band fits its columns', () => {
  for (const lang of Object.keys(IDLE_DIRECTIONS) as Lang[]) {
    test(`${lang}: the new idle direction stays a direction at every width from 24 to 200 columns`, { timeoutMs: 60_000 }, async ($, on) => {
      const w = world(on, { store: RECENT, percent: 34 })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: `lang ${lang}`, origin: PERSON, presentation: P })
      await w.clock.advance(15_000)
      expect(w.view().mood).toBe('idle')
      for (let cols = 24; cols <= 200; cols++) {
        const tree = await (await $.ui.mount({ surface: 'terminal', ...band(cols) })).drawn()
        expect([lang, cols, narrowest(tree) <= cols]).toEqual([lang, cols, true])
        const direction = texts(tree).find(t => t.text.trim() === IDLE_DIRECTIONS[lang])
        expect(direction).toBeDefined()
        expect(direction?.text).toBe(` ${IDLE_DIRECTIONS[lang]}`)
        expect(direction?.wrap).toBe('truncate-end')
      }
    })
  }

  const STATES: { name: string; working: boolean; w: Record<string, unknown>; act: (w: ReturnType<typeof world>, $: Parameters<Parameters<typeof test>[1]>[0]) => Promise<void> }[] = [
    { name: 'reading', working: false, w: { store: RECENT, percent: 34 }, act: async w => { await w.clock.advance(15_000) } },
    { name: 'saying', working: false, w: { store: RECENT, percent: 91 }, act: async w => { await w.clock.advance(1000) } },
    { name: 'working', working: true, w: { store: RECENT, percent: 56 }, act: async (w, $) => { await $.turn.start({ text: 'refactor the parser', turnId: 't1' }); await w.clock.advance(15_000); await $.tool.call({ tool: 'Read', file_path: '/a.ts' }) } },
    { name: 'omen', working: false, w: { store: { ...RECENT, omen: { day: '2026-10-02', rank: 'daikyo', index: 1 } }, percent: 72 }, act: async (w, $) => { await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P }) } },
    { name: 'full', working: false, w: { store: RECENT, percent: 100 }, act: async w => { await w.clock.advance(15_000) } },
  ]
  for (const lang of CODES) {
    for (const state of STATES) {
      test(`${lang}, ${state.name}, 40 to 200 columns: nothing wider than the band; only stage directions may be cut`, { timeoutMs: 60_000 }, async ($, on) => {
        const w = world(on, { ...state.w, env: { LANG: LANGS[lang] } })
        await $.session.start(START)
        await state.act(w, $)
        const asides = new Set(Object.values(WORDS[lang].aside))
        for (const cols of [40, 46, 52, 60, 70, 80, 100, 120, 160, 200]) {
          const tree = await (await $.ui.mount({ surface: 'terminal', ...band(cols, state.working) })).drawn()
          expect([cols, narrowest(tree) <= cols]).toEqual([cols, true])
          for (const t of texts(tree)) {
            if (String(t.wrap ?? '').startsWith('truncate') && t.text.trim()) expect([cols, t.text.trim(), asides.has(t.text.trim())]).toEqual([cols, t.text.trim(), true])
          }
        }
      })
    }
  }
})

describe('his book on the terminal fits its columns', () => {
  const PAGES = ['him', 'omen', 'offerings', 'log', 'library', 'settings'] as const
  for (const lang of CODES) {
    test(`${lang}: every page from 40 to 200 columns`, { timeoutMs: 60_000 }, async ($, on) => {
      world(on, {
        store: { ...RECENT, omen: { day: '2026-10-02', rank: 'daikyo', index: 0 }, turns: 1284, firstMet: Date.UTC(2026, 8, 30, 21, 4), latestNight: { at: Date.UTC(2026, 9, 1, 3, 42), minutes: 222 }, wilds: 7, omens: 12 },
        percent: 56,
        limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' }],
        cost: 1.84,
        startedAt: Date.UTC(2026, 8, 30, 21, 4),
        env: { LANG: LANGS[lang] },
      })
      await $.session.start(START)
      const pane = (cols: number) => ({ plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: true, bodyColumns: cols, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } })
      await $.command.run({ command: 'claudesama', args: 'about', origin: PERSON, presentation: P })
      for (const page of PAGES) {
        const opener = await $.ui.mount({ surface: 'terminal', ...pane(80) })
        await opener.press({ key: `claudesama:book:tab:${page}` })
        await opener.unmount()
        for (const cols of [40, 46, 52, 60, 70, 80, 100, 120, 160, 200]) {
          const ui = await $.ui.mount({ surface: 'terminal', ...pane(cols) })
          expect([page, cols, narrowest(await ui.drawn()) <= cols]).toEqual([page, cols, true])
          await ui.unmount()
        }
      }
    })
  }
  for (const lang of CODES) for (const state of ['corner', 'following', 'absent'] as const) {
    test(`${lang}: companion ${state} from 40 to 200 columns`, { timeoutMs: 60_000 }, async ($, on) => {
      companionScene(on, state)
      world(on, { store: RECENT, env: { LANG: LANGS[lang], HOME: COMPANION_HOME } })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      for (const cols of [40, 46, 52, 60, 70, 80, 100, 120, 160, 200]) {
        const ui = await $.ui.mount({ surface: 'terminal', plugin: 'claudesama', component: 'Pane', requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
        expect([lang, state, cols, narrowest(await ui.drawn()) <= cols]).toEqual([lang, state, cols, true])
        expect(await ui.find({ type: 'Text', text: JSON.parse(BOOK_FILES[`${lang}.json`]).settings.companion[state] })).toBeDefined()
        expect((await ui.findAll({ type: 'Button' })).some(b => String(b.key).startsWith('claudesama:companion:'))).toBe(true)
        expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
        await ui.unmount()
      }
    })
  }
})
