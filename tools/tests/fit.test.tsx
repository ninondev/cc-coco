// Nothing he draws is cut off, at any width: the desktop band plans its layout from the width it
// is given and gives things up in one fixed order; the terminal band always fits its columns in
// cells; stage directions may be cut or dropped, speech uses its final cut only when needed,
// and no space goes
// before a full-width bracket. (The desktop's pixels are checked in WebKit by the preview build.)

import { commitCount, commitLineText, commitLineWidth, contextTokensText } from '../hooks/play-commits'
import { describe, expect, test } from 'claude-code/testing'
import { cells, desktopBand, planDesktop } from '../hooks/band'
import type { BandSize } from '../hooks/band'
import { initialView } from '../hooks/mood'
import { LINES } from '../hooks/lines'
import { getMotionWidth } from '../hooks/pictures-lazy'
import { cocoStill, installCocoData } from '../hooks/coco-motion'
import type { CocoData } from '../hooks/coco-motion'
import { COCO_RESTING } from '../hooks/coco-stills'
import { percentText } from '../hooks/numbers'
import { COLUMN_PX, cutToPx, gapBefore, minWrapPx, planPx } from '../hooks/typeset'
import { LANGS as LANGUAGE_CHOICES, WORDS } from '../hooks/words'
import { IDLE_DIRECTIONS } from './fit-idle-directions'
import type { Lang } from '../hooks/words'
import type { CocoView } from '../types'
import { settleLegacyStart, P, PERSON, RECENT, band, world } from './world'
import { COMPANION_HOME, companionScene } from './companion-fixture'
import { BOOK_FILES } from './book-files'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'

const C3_WORDS = JSON.parse(C3_WORDS_RAW) as Record<string, Record<Lang, string>>
const TOOL_DIRECTIONS = ['scroll', 'search', 'spyglass', 'plan', 'run', 'tea', 'helper', 'cheer'] as const
const readC3Text = (path: string) => path.endsWith('c3-text.json') ? C3_WORDS_RAW : path.endsWith('frame-manifest.json') ? JSON.stringify(C3_HEAD_MANIFEST) : undefined

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const LANGS = { en: 'en_US.UTF-8', de: 'de_DE.UTF-8', hi: 'hi_IN.UTF-8', ja: 'ja_JP.UTF-8', ko: 'ko_KR.UTF-8', zh: 'zh_CN.UTF-8', 'zh-Hant': 'zh_TW.UTF-8' } as const
type Code = keyof typeof LANGS
const CODES = Object.keys(LANGS) as Code[]

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

type TextRun = { text: string; wrap?: unknown; textRoot?: string }
function texts(node: unknown, out: TextRun[] = [], textRoot?: string): TextRun[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  if (n.type === 'Text') out.push({ text: words(n), wrap: n.props?.wrap, textRoot })
  for (const child of n.children ?? []) texts(child, out, textRoot ?? (n.type === 'Text' ? words(n) : undefined))
  return out
}

// A drawing's words in reading order, nested texts included.
function words(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return ((node as Node).children ?? []).map(words).join('')
}

function nodes(node: unknown, type: string): Node[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Node
  return [...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap(child => nodes(child, type))]
}

// The native direction keeps its prefix and closing bracket. Spaced languages stop on a
// complete first word pair. Chinese and Japanese keep the complete direction.
function certifiedDirection(text: string, original: string, lang: Lang): boolean {
  if (/[\r\n]/u.test(text)) return false
  if (text === original) return true
  const opening = /^[(*（]/u.test(original) ? original[0]! : ''
  const closing = /[)*）]$/u.test(original) ? original.slice(-1) : ''
  const suffix = '…' + closing
  if (!text.endsWith(suffix)) return false
  const kept = text.slice(0, -suffix.length)
  const body = kept.slice(opening.length)
  return !['zh', 'zh-Hant', 'ja'].includes(lang) && body.trim().split(/\s+/u).length >= 2
    && kept.length > opening.length && kept === kept.trimEnd() && original.startsWith(kept)
    && (/^\s/u.test(original.slice(kept.length)) || kept.length === original.length - closing.length)
}

function authoredSpeech(source: string): string {
  return source.replace(/\*([^*\n]+)\*/g, '$1')
}

function certifiedLeadingPauseCut(text: string, original: string | null | undefined): boolean {
  if (!original || /[\r\n]/u.test(text)) return false
  const source = authoredSpeech(original)
  if (!source.startsWith('…') || source.startsWith('……') || !text.endsWith('…') || (text.match(/…/gu)?.length ?? 0) !== 1) return false
  const kept = text.slice(0, -1)
  return [...kept.matchAll(/[\p{L}\p{N}]/gu)].length >= 2 && kept.length < source.length - 1
    && kept === kept.trimEnd() && source.slice(1).startsWith(kept)
}

// Review row 1's final step may cut the actual visible sentence, including its bold slots.
function certifiedVisibleLine(text: string, original: string | null | undefined): boolean {
  if (!original || /[\r\n]/u.test(text)) return false
  original = authoredSpeech(original)
  if (text === original) return true
  if (certifiedLeadingPauseCut(text, original)) return true
  if (!text.endsWith('…')) return false
  const kept = text.slice(0, -1)
  return kept === kept.trimEnd() && original.startsWith(kept)
}

function certifiedKoreanRun(run: TextRun, original: string | null | undefined, lang: Lang): boolean {
  if (lang !== 'ko' || run.textRoot === undefined || run.wrap !== 'truncate-end' || !original) return false
  original = authoredSpeech(original)
  if (!certifiedVisibleLine(run.textRoot.trim(), original) || /\s/u.test(run.text) || !/\p{Script=Hangul}/u.test(run.text)) return false
  const omitted = run.text.endsWith('…')
  const kept = omitted ? run.text.slice(0, -1) : run.text
  return original.split(/\s+/u).some(word => word === kept || omitted && word.replace(/[.。।]+$/u, '') === kept)
}

function certifiedCjkTailRun(run: TextRun, original: string | null | undefined, lang: Lang): boolean {
  if (!['zh', 'zh-Hant', 'ja'].includes(lang) || run.textRoot === undefined || run.wrap !== 'truncate-end' || !original) return false
  const root = run.textRoot.trim()
  if (/[\r\n]/u.test(run.textRoot + run.text) || [root, run.text].some(text => (text.match(/…/gu)?.length ?? 0) > 1)) return false
  if (!certifiedVisibleLine(root, original) || !root.endsWith(run.text)) return false
  const substantive = [...run.text.matchAll(/[\p{L}\p{N}]/gu)].map(match => match[0])
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
  if (substantive.length < 2 || !cjk.test(substantive[substantive.length - 1]!)) return false
  // A Latin word or number bound to the final CJK character must start whole.
  const start = root.length - run.text.length
  const prefix = [...root.slice(0, start)], preceding = prefix[prefix.length - 1]
  if (preceding && /^[\p{L}\p{N}]/u.test(run.text) && !cjk.test(substantive[0]!)
      && /[\p{L}\p{N}]/u.test(preceding) && !cjk.test(preceding)) return false
  return true
}

function shortestDirection(direction: string, lang: Lang): number {
  const opening = /^[(*（]/u.test(direction) ? direction[0]! : ''
  const closing = /[)*）]$/u.test(direction) ? direction.slice(-1) : ''
  const body = direction.slice(opening.length, closing ? -closing.length : undefined)
  if (['zh', 'zh-Hant', 'ja'].includes(lang)) return cells(direction)
  const pair = body.trim().split(/\s+/u).slice(0,2).join(' ')
  return body.trim().split(/\s+/u).length < 2 ? cells(direction) : Math.min(cells(direction), cells(opening + pair + '…' + closing))
}

function certifiedDirectionDrop(direction: string, lang: Lang, room: number, lineNeedsRoom = false): boolean {
  return lineNeedsRoom || room < cells(gapBefore(direction,lang)) + shortestDirection(direction,lang)
}

// The terminal lays out like Yoga: a box that may shrink goes down to its narrowest content (a
// text that may be cut, to nothing; one that wraps, to its longest word), one that may not keeps
// its whole line.
function longestWord(text: string): number {
  let best = 0
  for (const word of text.split(/\s+/)) {
    for (const part of word.split(/(?<=[⺀-꓏豈-﫿＀-｠])/u)) best = Math.max(best, cells(part))
  }
  return best
}
function natural(node: unknown): number {
  if (typeof node === 'string') return Math.max(...node.split('\n').map(cells))
  if (!node || typeof node !== 'object') return 0
  const n = node as Node
  const p = n.props ?? {}
  if (n.type === 'Raster' || n.type === 'Image') return Number(p.columns ?? 0)
  // API plain terminal buttons draw just their label (no bracket/chrome cells).
  if (n.type === 'Button') return cells(String(p.label)) + (p.plain ? 0 : 4)
  const kids = (n.children ?? []).map(natural)
  if (n.type === 'Text') return kids.reduce((a, b) => a + b, 0)
  const row = !String(p.flexDirection ?? 'row').startsWith('column')
  // A box with an explicit width is exactly that wide, as in Yoga: what is in it wraps inside it (the book's label column).
  if (typeof p.width === 'number') return Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + p.width
  return Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + Math.max(0, row ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids))
}
function narrowest(node: unknown): number {
  if (typeof node === 'string') return longestWord(node)
  if (!node || typeof node !== 'object') return 0
  const n = node as Node
  const p = n.props ?? {}
  if (p.flexShrink === 0) return natural(node)
  if (n.type === 'Raster' || n.type === 'Image') return Number(p.columns ?? 0)
  // API plain terminal buttons draw just their label (no bracket/chrome cells).
  if (n.type === 'Button') return cells(String(p.label)) + (p.plain ? 0 : 4)
  if (n.type === 'Text') return String(p.wrap ?? '').startsWith('truncate') ? 0 : Math.max(0, ...(n.children ?? []).map(narrowest))
  const kids = (n.children ?? []).map(narrowest)
  // a row that wraps is as narrow as its widest child
  const row = !String(p.flexDirection ?? 'row').startsWith('column') && p.flexWrap !== 'wrap'
  return Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0) + Math.max(Number(p.width ?? 0), row ? kids.reduce((a, b) => a + b, 0) : Math.max(0, ...kids))
}

function view(lang: Lang, change: Partial<CocoView> = {}): CocoView {
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
    else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uff60]/u.test(char)) {
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
  leaves: spokenLeaves(LINES[lang]).map(({ key, line }) => {
    const source = line.replace(/\{pages\}/g, '1284')
    const spoken = authoredSpeech(source)
    return { key, line: source, spoken, runPx: longestSpokenRunPx(spoken), linePx: planPx(spoken) }
  }),
}))
const SPOKEN_COMBINATIONS = SPOKEN_CASES.reduce((total, { leaves }) => total + leaves.length * 3 * 2 * SPOKEN_LAYOUTS.length, 0)

// The room his line has, worked out from the cue-line design (BAND 3.2) and not from the planner: the text column is the band
// less the two-column inset on the right, the ribbon slot, his picture and a column. At
// rest his line stands on rows 2 and 3 under the cue line and has the whole column. In one row (the pixel band, "Smaller
// while working") it shares the cue row with his name, the box and the Book button, and the right block keeps two columns.
function spokenRoom(v: CocoView, columns: number, working: boolean) {
  const plan = planDesktop(v, size(columns, working))
  const fullWidth = columns * COLUMN_PX - 2 * COLUMN_PX
  const left = 12 + getMotionWidth(plan.height, v.band === 'compact') + COLUMN_PX
  if (!plan.row) return { plan, middle: fullWidth - left, available: fullWidth - left }
  const book = COLUMN_PX + planPx(plan.label) + 22
  // the commit line (lane C, 10-14) in the one-row band: only its commits, one CSS px a pixel, unless they made room for his name
  const right = plan.showRight === false ? 0 : 2 * COLUMN_PX + book + (v.context === null ? 0 : (plan.cells === false ? 0 : commitLineWidth(commitCount(v.context), true, undefined, 1)) + planPx(` ${v.estimate ? '~' : ''}${v.context}%${plan.word ? ` ${WORDS[v.lang].context}` : ''}`))
  const middle = fullWidth - left - right
  const available = middle - (plan.name ? planPx(plan.name, true) + planPx(gapBefore(plan.speech ?? '')) : 0)
  return { plan, middle, available }
}
// Independent word-wrap oracle for the bounded text column, including CJK break positions.
function lineRows(text: string, width: number, measure: (text: string) => number = planPx): number {
  const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^ \t\n\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[ \t]+|\n/gu) ?? []
  let rows=1, used=0
  for(const unit of units) {
    if(unit==='\n') {rows++;used=0;continue}
    const widthOfWord=measure(unit)
    if(widthOfWord>width && unit.trim()) return Infinity
    if(used+widthOfWord>width) {rows++;used=unit.trim()?widthOfWord:0} else used+=widthOfWord
  }
  return rows
}
describe(`every spoken line fits its fixed desktop slot: ${SPOKEN_COMBINATIONS} combinations`, () => {
  test('wrapping preserves NBSP words and Latin runs between CJK characters', () => {
    expect(minWrapPx('long short')).toBe(Math.max(planPx('long'), planPx('short')))
    expect(minWrapPx('long\u00a0short')).toBe(planPx('long\u00a0short'))
    expect(minWrapPx('中Spendenkasten文')).toBe(planPx('Spendenkasten'))
    expect(minWrapPx('中日本語文')).toBe(planPx('中'))
  })
  test('the longest German line at narrow width uses the final fitting step inside the resting slot',()=>{
    const line=spokenLeaves(LINES.de).map(({line})=>line).reduce((a,b)=>b.length>a.length?b:a)
    for(const context of [34,91]) {
      const v=view('de',{context,said:line})
      const {plan,available}=spokenRoom(v,Math.floor(300/COLUMN_PX),false)
      // his picture does not depend on the line (BAND 3.2: 32 px where the cue line cannot hold his name at 64)
      expect(plan.height).toBe(planDesktop({...v,said:null},size(Math.floor(300/COLUMN_PX))).height)
      expect(plan.row).toBe(false)
      expect(plan.speech).toBeDefined()
      expect(lineRows(plan.speech!,available)<=plan.lineRows!).toBe(true)
    }
  })
  for (const { lang, leaves } of SPOKEN_CASES) {
    const expected = leaves.length * 3 * 2 * SPOKEN_LAYOUTS.length
    test(`${lang}: every line at 300/600/900px, box34/91%, rest/compact/working`,{timeoutMs:120_000},()=>{
      let checked=0
      const failures:unknown[]=[]
      for(const {key,line,spoken} of leaves) for(const context of [34,91]) for(const layout of SPOKEN_LAYOUTS) for(const px of [300,600,900]) {
        const v=view(lang,{context,band:layout.band,said:line})
        const cols=Math.floor(px/COLUMN_PX), {plan,available}=spokenRoom(v,cols,layout.working)
        const baseline=planDesktop({...v,said:null},size(cols,layout.working))
        checked++
        const text=plan.speech ?? ''
        const prefix=text.replace(/…[)）*]?$/u,'')
        const intact=text===spoken || /…[)）*]?$/u.test(text) && spoken.startsWith(prefix) || certifiedLeadingPauseCut(text,spoken)
        // The one-row band keeps his name, the box and the Book button (BAND 3.2: the Book button is never given up). Where a line
        // is wider than the room left even cut to its first clause, the row leaves it out and keeps the name.
        const omitted=text==='' && plan.row && plan.name!==undefined && px<=320 && planPx(spoken)>plan.textWidth
        if(plan.height!==baseline.height || plan.row!==baseline.row || available<0 || !(intact||omitted) || lineRows(text,available)>plan.lineRows!) if(failures.length<6) failures.push({key,px,context,layout:layout.name,available,text,original:line,rows:lineRows(text,available),allowed:plan.lineRows})
      }
      expect({checked,expected,failures}).toEqual({checked:expected,expected,failures:[]})
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
    test(`in ${lang}: the band at three widths and the question line keep the rule`, { timeoutMs: 60_000 }, async ($, on) => {
      const setupWorld=world(on, { store: RECENT, env: { LANG: LANGS[lang] }, engineRows: true })
      await $.session.start(START); await settleLegacyStart($,setupWorld);
      const drawn: string[] = []
      for (const surface of ['desktop', 'terminal'] as const) for (const cols of [34, 63, 120]) drawn.push(...texts(await (await $.ui.mount({ surface, ...band(cols) })).drawn()).map(t => t.text))
      const ask = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: [{ question: 'Which?' }] } })
      drawn.push(words(await ask.drawn()))
      for (const text of drawn.filter(t => t.trim() !== '')) {
        expect([lang, text, FULL_WIDTH_AFTER_SPACE.test(text)]).toEqual([lang, text, false])
        expect([lang, text, text.startsWith('  ')]).toEqual([lang, text, false])
      }
    })
  }
})

describe('the desktop band at every width', () => {
  test(`all ${LANGUAGE_CHOICES.length} training directions keep their parentheses or leave the slot, from 24 to 200 columns`, { timeoutMs: 60_000 }, () => {
    for (const { code: lang } of LANGUAGE_CHOICES) {
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
      if (lang === 'zh') expect(cut).toBe('(坐在杯…)')
      if (lang === 'ja') expect(cut).toBe('(マグで足ぶ…)')
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
          expect(plan.text.endsWith('…)')).toBe(true)
          expect(direction.startsWith(plan.text.slice(0, -2))).toBe(true)
          expect(plan.text.includes(' …')).toBe(false)
          expect(certifiedDirection(plan.text,direction,lang)).toBe(true)
        }
      }
      expect([lang, whole > 0]).toEqual([lang, true])
    }
    // Every authored idle aside has at most two words. N6 can drop a partial
    // idle pair; exercise actual partial band cuts with a longer native aside.
    const direction='(hands resting on the book)'
    let pairCuts=0
    for(let cols=24;cols<=200;cols++){
      const plan=planDesktop(view('en',{band:'compact',pose:{name:'scroll',frame:'scroll-a',aside:direction,at:0}}),size(cols))
      if(plan.text===undefined||plan.text===direction)continue
      pairCuts++
      expect(certifiedDirection(plan.text,direction,'en')).toBe(true)
      expect(plan.text.startsWith('(hands resting')).toBe(true)
      expect(plan.text.endsWith('…)')).toBe(true)
      expect(plan.text.includes(' …')).toBe(false)
    }
    expect(pairCuts>0).toBe(true)
  })

  test("the owner's band (Chinese, 34 columns): whole reading and book button on the cue line beside 小克, the picture the rule gives and the ribbon slot", async ($, on) => {
    const v = view('zh', { quota: { rateLimits: [{ kind: 'five_hour', percentUsed: 62 }, { kind: 'seven_day', percentUsed: 31 }], costUSD: 1.84, at: Date.UTC(2026, 9, 2, 9) } as never })
    const plan = planDesktop(v, size(34))
    expect(WORDS.zh.name).toBe('小克')
    expect(plan.name).toBe('小克') // his name fits beside the props in Chinese
    // BAND 3.2 (owner 04:22): the painted figure shrinks to 32 px before his name goes. 10-14: with the gear for the Book
    // button and her quota charms that stack, 小克 fits beside the props at 64 px on his 34 columns, so the figure stays
    // 64 (it was 32 before; lanes/C.md asks him whether he still wants 32 here)
    expect(plan.height).toBe(64)
    expect(plan.row).toBe(false)
    expect(plan.word).toBe(false)
    expect(plan.label === WORDS.zh.marks.book || plan.label === WORDS.zh.marks.shelf).toBe(true)
    // the cue line holds the name and the props, with at least two columns between; the direction gives way before either
    const cueRoom = 34 * COLUMN_PX - 2 * COLUMN_PX - (12 + getMotionWidth(plan.height, false) + COLUMN_PX)
    expect(planPx('小克', true) + 2 * COLUMN_PX < cueRoom).toBe(true)
    expect(plan.text === undefined || plan.text === WORDS.zh.aside.idle).toBe(true)
    expect(plan.aside).toBe(plan.text === undefined ? 'none' : 'beside')
    installCocoData(COCO_RESTING.A as unknown as CocoData, true)
    on('ui.render', { component: 'Pane', requestId: 'fit-approved-34' }, ($, e) =>
      desktopBand($.ui.resolve(e) as never, v, size(34), cocoStill('A', 'idle', plan.height), plan))
    world(on)
    const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'Pane', requestId: 'fit-approved-34',
      props: { title: 'Fit', isFocused: false, bodyColumns: 34, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.drawn()
    const ribbon = nodes(tree, 'Box').find(node => node.props?.key === 'coco:ribbon-slot')
    expect(nodes(ribbon, 'Svg')[0]?.props?.width).toBe(12)
    const column = nodes(tree, 'Box').find(node => node.props?.key === 'coco:text-column')
    expect(column?.props?.flexDirection).toBe('column')
    expect(texts(column).map(node => node.text)).toContain('小克')
    if (plan.text !== undefined) expect(texts(column).map(node => node.text)).toContain(WORDS.zh.aside.idle)
    expect((await ui.findAll({ type: 'Button' })).some(button => button.key === 'coco:book:open')).toBe(true)
    await ui.unmount()
  })

  const STATES: [string, Partial<CocoView>, boolean][] = [
    ['reading', {}, false],
    ['saying', { said: 'the offering box is almost full. time to sweep it out soon.', mood: 'happy' }, false],
    ['working same size', { mood: 'work', workSize: 'same' }, true],
    ['working smaller', { mood: 'work', workSize: 'smaller' }, true],
    ['working same size and saying', { mood: 'work', workSize: 'same', said: 'still at it. the parser has more corners than it looks.' }, true],
    ['working smaller and saying', { mood: 'work', workSize: 'smaller', said: 'still at it. the parser has more corners than it looks.' }, true],
  ]
  test('as the band narrows, resting geometry stays fixed and speech uses its bounded slot', { timeoutMs: 60_000 }, () => {
    for (const lang of CODES) {
      for (const [state, change, working] of STATES) {
        let frame = 0
        let place = 0
        let height = 64
        for (let cols = 200; cols >= 24; cols--) {
          const plan = planDesktop(view(lang, change), size(cols, working))
          // the frame (button label, picture, name) only ever gets poorer; within a frame, so does the place
          // (10-18: where her picture shrinks to 32 px, the room it frees may bring her name back; the order starts again there)
          if (plan.height < height) { frame = 0; place = 0 }
          if (!change.said) {
            expect([lang,state,cols,plan.frame>=frame]).toEqual([lang,state,cols,true])
            if(plan.frame===frame) expect([lang,state,cols,plan.place>=place]).toEqual([lang,state,cols,true])
          }
          // the picture is 64 px at rest and 32 px where the cue line cannot hold his name beside it (BAND 3.2), never bigger
          // again as the band narrows; "Smaller while working" is 32 px at every width
          const pinned = change.workSize==='smaller'&&working
          expect([lang,state,cols,pinned?32:[32,64].includes(plan.height)?plan.height:-1]).toEqual([lang,state,cols,pinned?32:plan.height])
          if(!pinned){expect([lang,state,cols,plan.height<=height]).toEqual([lang,state,cols,true]);height=plan.height}
          frame = plan.frame
          place = plan.place
          expect(plan.label === WORDS[lang].marks.book || plan.label === WORDS[lang].marks.shelf).toBe(true)
          const said = change.said
          if (said) {
            expect(plan.speech).toBeDefined()
            const {available}=spokenRoom(view(lang,change),cols,working)
            expect({lang,state,cols,available,text:plan.speech,rows:lineRows(plan.speech!,available),allowed:plan.lineRows,fits:lineRows(plan.speech!,available)<=plan.lineRows!}).toEqual({lang,state,cols,available,text:plan.speech,rows:lineRows(plan.speech!,available),allowed:plan.lineRows,fits:true})
          }
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
  test('cut certification rejects unrelated text, missing brackets and partial spaced words', () => {
    expect(certifiedDirection('(writing…)', '(writing in the margins)', 'en')).toBe(false)
    expect(certifiedDirection('(writing in…)', '(writing in the margins)', 'en')).toBe(true)
    expect(certifiedDirection('(writing i…)', '(writing in the margins)', 'en')).toBe(false)
    expect(certifiedDirection('(writing…', '(writing in the margins)', 'en')).toBe(false)
    expect(certifiedDirection('(writing …)', '(writing in the margins)', 'en')).toBe(false)
    expect(certifiedDirection('（把一行…）', '（把一行又读了一遍）', 'zh')).toBe(false)
    expect(certifiedDirection('(another…)', '(writing in the margins)', 'en')).toBe(false)
    expect(certifiedVisibleLine('the offering bo…', 'the offering box is almost full.')).toBe(true)
    expect(certifiedVisibleLine('the offering …', 'the offering box is almost full.')).toBe(false)
    expect(certifiedVisibleLine('other text…', 'the offering box is almost full.')).toBe(false)
    expect(certifiedVisibleLine('the offering\nbo…', 'the offering box is almost full.')).toBe(false)
    expect(certifiedVisibleLine('looks up hello.', '*looks up* hello.')).toBe(true)
    expect(certifiedVisibleLine('*looks up* hello.', '*looks up* hello.')).toBe(false)
    expect(certifiedVisibleLine('looks down hello.', '*looks up* hello.')).toBe(false)
    expect(certifiedVisibleLine('looks up hello nods goodbye.', '*looks up* hello *nods* goodbye.')).toBe(true)
    expect(certifiedVisibleLine('looks up hello…', '*looks up* hello *nods* goodbye.')).toBe(true)
    expect(certifiedVisibleLine('*unpaired hello.', '*unpaired hello.')).toBe(true)
    expect(certifiedVisibleLine('unpaired hello.', '*unpaired hello.')).toBe(false)
    expect(texts({ type: 'Text', children: ['the offering ', { type: 'Text', props: { bold: true }, children: ['box'] }, ' is almost full.'] })[0]!.text).toBe('the offering box is almost full.')
  })

  test('N6 drop certification rejects omission when a complete first pair or whole short direction fits',()=>{
    const long='(hands resting on the book)',pair='(hands resting…)'
    const room=cells(gapBefore(long,'en'))+cells(pair)
    expect(shortestDirection(long,'en')).toBe(cells(pair))
    expect(certifiedDirectionDrop(long,'en',room)).toBe(false)
    expect(certifiedDirectionDrop(long,'en',room+1)).toBe(false)
    expect(certifiedDirectionDrop(long,'en',room-1)).toBe(true)
    expect(certifiedDirectionDrop(long,'en',room,true)).toBe(true)
    for(const lang of Object.keys(IDLE_DIRECTIONS) as Lang[]){
      const direction=IDLE_DIRECTIONS[lang],wholeRoom=cells(gapBefore(direction,lang))+cells(direction)
      expect(shortestDirection(direction,lang)).toBe(cells(direction))
      expect(certifiedDirectionDrop(direction,lang,wholeRoom)).toBe(false)
      expect(certifiedDirectionDrop(direction,lang,wholeRoom-1)).toBe(true)
    }
    expect(certifiedDirection('(hands…)',long,'en')).toBe(false)
    expect(certifiedDirection('(hands resting…)',long,'en')).toBe(true)
    expect(certifiedDirection('(hands rest…)',long,'en')).toBe(false)
    expect(certifiedDirection('(hands resting…',long,'en')).toBe(false)
  })

  test('nested Korean runs require whole original words in a certified speech root', () => {
    const original = '상자가 거의 찼어요. 이제 비워요.'
    const run: TextRun = { text: '상자가', wrap: 'truncate-end', textRoot: ' 상자가 거의…' }
    expect(certifiedKoreanRun(run, original, 'ko')).toBe(true)
    expect(certifiedKoreanRun({ ...run, text: '상자' }, original, 'ko')).toBe(false)
    expect(certifiedKoreanRun({ ...run, text: '상자를' }, original, 'ko')).toBe(false)
    expect(certifiedKoreanRun({ ...run, wrap: 'wrap' }, original, 'ko')).toBe(false)
    expect(certifiedKoreanRun({ ...run, textRoot: undefined }, original, 'ko')).toBe(false)
    expect(certifiedKoreanRun({ ...run, textRoot: ' 상자가 다른 문장.' }, original, 'ko')).toBe(false)
    expect(certifiedKoreanRun(run, original, 'ja')).toBe(false)
    expect(certifiedDirection('(상자…)', '(상자가 거의 찼어요)', 'ko')).toBe(false)
    expect(certifiedDirection('(상자가…)', '(상자가 거의 찼어요)', 'ko')).toBe(false)
    expect(certifiedDirection('(상자가 거의…)', '(상자가 거의 찼어요)', 'ko')).toBe(true)
    expect(lineRows('상자가', planPx('상자'))).toBe(Infinity)
    expect(lineRows('日本語', planPx('日'))).toBe(3)
    const nested = texts({ type: 'Text', children: [' ', { type: 'Text', props: { wrap: 'truncate-end' }, children: ['상자가'] }, ' 거의…'] })
    expect(nested[0]!.textRoot).toBeUndefined()
    expect(nested[1]!.textRoot).toBe(' 상자가 거의…')
    expect(certifiedKoreanRun(nested[1]!, original, 'ko')).toBe(true)
  })

  test('a cut may remove only its initial authored pause while retaining an exact useful source prefix', () => {
    expect(certifiedLeadingPauseCut('wer hat…', '…wer hat das geschrieben.')).toBe(true)
    expect(certifiedLeadingPauseCut('oke. pitanya…', '…oke. *pitanya dilonggarkan*')).toBe(true)
    expect(certifiedLeadingPauseCut('chi ha scritto…', '…chi ha scritto questa roba.')).toBe(true)
    expect(certifiedVisibleLine('…wer hat das geschrieben.', '…wer hat das geschrieben.')).toBe(true)
    expect(certifiedVisibleLine('wer hat…', '…wer hat das geschrieben.')).toBe(true)
    const rejected = [
      ['one two…', '…one… two three.'],
      ['two one…', '…one two three.'],
      ['one three…', '…one two three.'],
      ['…', '…one two three.'],
      ['w…', '…wer hat das geschrieben.'],
      ['…wer hat…', '…wer hat das geschrieben.'],
      ['wer hat……', '…wer hat das geschrieben.'],
      ['wer hat das geschrieben.', '…wer hat das geschrieben.'],
      ['hello world…', '…hello world'],
      ['wer hat…', 'wer hat das geschrieben.'],
      ['wer hat…', '……wer hat das geschrieben.'],
      ['wer hat…', '… wer hat das geschrieben.'],
      ['wer\nhat…', '…wer hat das geschrieben.'],
    ] as const
    for (const [candidate, source] of rejected) expect(certifiedLeadingPauseCut(candidate, source)).toBe(false)
  })

  test('nested CJK tails require a complete suffix of the certified original speech root', () => {
    const examples = [
      ['zh', '纸快满了。', '满了。', ' 纸快满了。'],
      ['zh-Hant', '紙快滿了。', '滿了。', ' 紙快滿了。'],
      ['ja', 'これは日本語。', '本語。', ' これは日本語。'],
      ['ja', '箱はもうすぐいっぱいだ。', 'ぱい…', ' 箱はもうすぐいっぱい…'],
      ['ja', 'あと130秒。', '130秒。', ' あと130秒。'],
      ['zh', '次是cache行。', 'cache行。', ' 次是cache行。'],
    ] as const
    for (const [lang, original, text, textRoot] of examples) {
      expect(certifiedCjkTailRun({ text, textRoot, wrap: 'truncate-end' }, original, lang)).toBe(true)
    }
    const original = '纸快满了。'
    const run: TextRun = { text: '满了。', wrap: 'truncate-end', textRoot: ' 纸快满了。' }
    const rejected: TextRun[] = [
      { ...run, text: '其他。' },
      { ...run, text: '快满' },
      { ...run, text: '了。' },
      { ...run, text: '了…', textRoot: ' 纸快满了…' },
      { ...run, text: '满了……', textRoot: ' 纸快满了……' },
      { ...run, text: '满\n了。' },
      { ...run, textRoot: ' 纸快\n满了。' },
      { ...run, textRoot: ' 换了纸快满了。' },
      { ...run, textRoot: ' 纸快满了。另句。' },
      { ...run, textRoot: ' 纸快满了。' + '满了。' },
      { ...run, textRoot: undefined },
      { ...run, wrap: 'wrap' },
    ]
    for (const candidate of rejected) expect(certifiedCjkTailRun(candidate, original, 'zh')).toBe(false)
    expect(certifiedCjkTailRun(run, original, 'ko')).toBe(false)
    expect(certifiedCjkTailRun(run, original, 'en')).toBe(false)
    expect(certifiedCjkTailRun({ text: '30秒。', textRoot: ' あと130秒。', wrap: 'truncate-end' }, 'あと130秒。', 'ja')).toBe(false)
    expect(certifiedCjkTailRun({ text: 'ache行。', textRoot: ' 次是cache行。', wrap: 'truncate-end' }, '次是cache行。', 'zh')).toBe(false)
    expect(certifiedCjkTailRun({ text: '了…', textRoot: ' 了…', wrap: 'truncate-end' }, '了不起。', 'zh')).toBe(false)
    const nested = texts({ type: 'Text', children: [' 纸快', { type: 'Text', props: { wrap: 'truncate-end' }, children: ['满了。'] }] })
    expect(nested[0]!.textRoot).toBeUndefined()
    expect(nested[1]!.textRoot).toBe(' 纸快满了。')
    expect(certifiedCjkTailRun(nested[1]!, original, 'zh')).toBe(true)
  })

  for (const { code: lang } of LANGUAGE_CHOICES) {
    test(`${lang}: the idle direction stays whole, cuts at a boundary or leaves room for name, box and Book from 24 to 200 columns`, { timeoutMs: 60_000 }, async ($, on) => {
      const w = world(on, { store: RECENT, percent: 34 })
      await $.session.start(START); await settleLegacyStart($,w);
      await $.command.run({ command: 'coco', args: `lang ${lang}`, origin: PERSON, presentation: P })
      await w.clock.advance(15_000)
      expect(w.view().mood).toBe('idle')
      const visible = w.view()
      const spoken = authoredSpeech(visible.line?.text ?? visible.said ?? '')
      let whole = 0
      for (let cols = 24; cols <= 200; cols++) {
        const tree = await (await $.ui.mount({ surface: 'terminal', ...band(cols) })).drawn()
        expect([lang, cols, narrowest(tree) <= cols]).toEqual([lang, cols, true])
        const drawn = texts(tree)
        // The commit line and the tokens in k (lane C, 10-14), the percent where no tokens were counted.
        const v = w.view(), value = v.contextTokens !== undefined ? contextTokensText(v.contextTokens, lang, v.estimate) : percentText(v.context, lang, v.estimate)
        const readings = [`${commitLineText(commitCount(v.context))} ${value}`, value] // the cells go first on a tight row
        expect([lang, cols, drawn.some(t => t.text === WORDS[lang].name)]).toEqual([lang, cols, true])
        expect([lang, cols, drawn.some(t => readings.some(r => t.text === r || t.text === r + ' ' + WORDS[lang].context))]).toEqual([lang, cols, true])
        expect([lang, cols, nodes(tree, 'Button').some(n => n.props?.label === WORDS[lang].marks.shelf)]).toEqual([lang, cols, true])
        const directions = drawn.filter(t => String(t.wrap ?? '').startsWith('truncate') && t.text.trim())
        expect(directions.length <= 1).toBe(true)
        const direction = directions[0]
        if (direction) {
          const text = direction.text.trim()
          expect([lang, cols, text, certifiedDirection(text, IDLE_DIRECTIONS[lang], lang)]).toEqual([lang, cols, text, true])
          expect(direction.text).toBe(`${gapBefore(text, lang)}${text}`)
          expect(direction.wrap).toBe('truncate-end')
          if (text === IDLE_DIRECTIONS[lang]) whole++
        } else {
          // With no optional direction left, the drawn tree measures the fixed occupants.
          const room = cols - natural(tree)
          const picture = [...nodes(tree, 'Raster'), ...nodes(tree, 'Image')][0]
          const lineRoom = cols - Number(picture?.props?.columns ?? 0) - 2 - (visible.line?.button ? cells(visible.line.button.label) + 5 : 0)
          // At rest, the direction yields first when the original visible line needs more
          // than the fixed three-row column, even if the name row could still hold it.
          const lineNeedsRoom = !!picture && !!spoken && lineRows(spoken, lineRoom, cells) > 3
          const proof = { lang, cols, room, lineRoom, spoken, lineRows: spoken ? lineRows(spoken, lineRoom, cells) : 0, picture: picture?.props?.columns, justified: certifiedDirectionDrop(IDLE_DIRECTIONS[lang],lang,room,lineNeedsRoom) }
          expect(proof).toEqual({ ...proof, justified: true })
        }
      }
      expect([lang, whole > 0]).toEqual([lang, true])
    })
  }

  const STATES: { name: string; working: boolean; w: Record<string, unknown>; act: (w: ReturnType<typeof world>, $: Parameters<Parameters<typeof test>[1]>[0]) => Promise<void> }[] = [
    { name: 'reading', working: false, w: { store: RECENT, percent: 34 }, act: async w => { await w.clock.advance(15_000) } },
    { name: 'saying', working: false, w: { store: RECENT, percent: 91 }, act: async w => { await w.clock.advance(1000) } },
    { name: 'working', working: true, w: { store: RECENT, percent: 56 }, act: async (w, $) => { await $.turn.start({ text: 'refactor the parser', turnId: 't1' }); await w.clock.advance(15_000); await $.tool.call({ tool: 'Read', file_path: '/a.ts' }) } },
    { name: 'full', working: false, w: { store: RECENT, percent: 100 }, act: async w => { await w.clock.advance(15_000) } },
  ]
  for (const lang of CODES) {
    for (const state of STATES) {
      test(`${lang}, ${state.name}, 40 to 200 columns: nothing wider than the band; certified native directions and visible lines may be cut`, { timeoutMs: 60_000 }, async ($, on) => {
        on('session.turns', () => ({ value: 0 }))
        const w = world(on, { ...state.w, env: { LANG: LANGS[lang] }, readText: readC3Text })
        await $.session.start(START); await settleLegacyStart($,w);
        await state.act(w, $)
        // SPEC 0.2(5), 6.1 and review row 1's final step: native stages keep their boundaries;
        // the actual visible sentence may lose its end after the other fitting steps.
        const asides = new Set([...Object.values(WORDS[lang].aside), ...TOOL_DIRECTIONS.map(pose => C3_WORDS['aside.' + pose]![lang])].map(aside => aside.replace(/\*/g, '')))
        if (state.name === 'working') expect(w.view().pose?.aside).toBe(C3_WORDS['aside.scroll']![lang])
        const visible = w.view()
        const spoken = authoredSpeech(visible.line?.text ?? visible.said ?? '')
        for (const cols of [40, 46, 52, 60, 70, 80, 100, 120, 160, 200]) {
          const tree = await (await $.ui.mount({ surface: 'terminal', ...band(cols, state.working) })).drawn()
          expect([cols, narrowest(tree) <= cols]).toEqual([cols, true])
          if (!nodes(tree, 'Raster').length && !nodes(tree, 'Image').length) expect([cols, natural(tree) <= cols]).toEqual([cols, true])
          for (const t of texts(tree)) {
            if (String(t.wrap ?? '').startsWith('truncate') && t.text.trim()) {
              if (t.textRoot !== undefined) {
                const certified = certifiedKoreanRun(t, spoken, lang) || certifiedCjkTailRun(t, spoken, lang)
                expect([cols, t.text, certified]).toEqual([cols, t.text, true])
                continue
              }
              const text = t.text.trim()
              const direction = [...asides].some(original => certifiedDirection(text, original, lang))
              const certified = direction || certifiedVisibleLine(text, spoken)
              expect([cols, text, certified]).toEqual([cols, text, true])
              // a space before it only where his name stands before it: the name goes before his words are cut (BAND F2)
              expect([`${direction ? gapBefore(text, lang) : gapBefore(text)}${text}`, text]).toContain(t.text)
            }
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
      const setupWorld=world(on, {
        store: { ...RECENT, omen: { day: '2026-10-02', rank: 'daikyo', index: 0 }, turns: 1284, firstMet: Date.UTC(2026, 8, 30, 21, 4), latestNight: { at: Date.UTC(2026, 9, 1, 3, 42), minutes: 222 }, wilds: 7, omens: 12 },
        percent: 56,
        limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' }],
        cost: 1.84,
        startedAt: Date.UTC(2026, 8, 30, 21, 4),
        env: { LANG: LANGS[lang] },
      })
      await $.session.start(START); await settleLegacyStart($,setupWorld);
      const pane = (cols: number) => ({ plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: cols, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } })
      await $.command.run({ command: 'coco', args: 'about', origin: PERSON, presentation: P })
      for (const page of PAGES) {
        const opener = await $.ui.mount({ surface: 'terminal', ...pane(80) })
        await opener.press({ key: `coco:book:tab:${page}` })
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
      const setupWorld=world(on, { store: RECENT, env: { LANG: LANGS[lang], HOME: COMPANION_HOME } })
      await $.session.start(START); await settleLegacyStart($,setupWorld);
      await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
      for (const cols of [40, 46, 52, 60, 70, 80, 100, 120, 160, 200]) {
        const ui = await $.ui.mount({ surface: 'terminal', plugin: 'coco', component: 'Pane', requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
        expect([lang, state, cols, narrowest(await ui.drawn()) <= cols]).toEqual([lang, state, cols, true])
        expect(await ui.find({ type: 'Text', text: JSON.parse(BOOK_FILES[`${lang}.json`]).settings.companion[state] })).toBeDefined()
        expect((await ui.findAll({ type: 'Button' })).some(b => String(b.key).startsWith('coco:companion:'))).toBe(true)
        expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
        await ui.unmount()
      }
    })
  }
})
