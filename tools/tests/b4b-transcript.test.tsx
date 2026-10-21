import { describe, expect, test } from 'claude-code/testing'
import { cutDirection, OLDER_HEAD_DIRECTION, planHead, planLine } from '../hooks/transcript'
import { moment } from '../hooks/book'
import { D1_WORDS_TEXT } from './d1-room-fixture'
const D1_MARKS = JSON.parse(D1_WORDS_TEXT)['marks.shed'] as Record<string,string>
const shedDirection = (lang:string) => D1_MARKS[lang]!.replace(/\*/g,'')

import { LANGS, WORDS } from '../hooks/words'
import { cutToPx, gapBefore, planPx } from '../hooks/typeset'
import { headKey } from '../hooks/turn-ledger'
import { MORNING, PERSON, P, RECENT, world } from './world'

const MOODS = ['wave', 'think', 'work', 'happy', 'flustered', 'error', 'refuse'] as const
const START = { cwd: '/tmp/b4b-transcript', surface: 'vscode' as const, isInteractive: true }
type Node = { type?: string; props?: Record<string, any>; children?: unknown[] }
function nodes(tree: unknown, type: string): Node[] {
  if (!tree || typeof tree !== 'object') return []
  const n = tree as Node
  return [...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap(c => nodes(c, type))]
}
function reply(requestId: string, columns = 100) {
  return { plugin: 'coco', component: 'AssistantMessage' as const, requestId,
    props: { text: 'native reply', isFirstOfReply: true }, viewport: { columns, rows: 48 } }
}
function line(component: 'AskUserQuestion' | 'CommandOutput', columns = 41) {
  return { plugin: 'coco', component, viewport: { columns, rows: 48 }, props: component === 'AskUserQuestion'
    ? { tool: 'AskUserQuestion', questions: [] }
    : { command: 'compact', isErrored: false, args: '', text: 'native compact' } } as const
}

describe('B4b transcript review regressions', () => {
  test('all three older-head policies preserve newest directions and apply the exact older-head contract', () => {
    expect(['news', 'none', 'all']).toContain(OLDER_HEAD_DIRECTION)
    for (const policy of ['news', 'none', 'all'] as const) for (const mood of [...MOODS, 'idle'] as const) {
      for (const newest of [true, false]) for (const settled of [true, false]) {
        const p = planHead({ mood, newest, ...(settled ? { endedAt: MORNING, ms: 1000 } : {}) }, 'en', 150, 'vscode', true, MORNING, 'UTC', policy)
        const visible = newest || policy === 'all' || (policy === 'news' && (!settled || (mood !== 'happy' && mood !== 'idle')))
        expect(p.direction, `${policy}/${mood}/${newest}/${settled}`).toBe(visible ? WORDS.en.aside[mood] : undefined)
      }
    }
  })
  test('waiting and swept plans fit all languages independently of the host shrinking', () => {
    for (const { code: lang } of LANGS) for (const [text, lead] of [[WORDS[lang].aside.question, 35], [WORDS[lang].marks.swept, 20]] as const) for (let columns = 20; columns <= 100; columns++) {
      const direction = planLine(text, lead, lang, columns, 'vscode')
      const available = columns * 7.2 - lead - 7.2 - planPx(WORDS[lang].name, true) - planPx(gapBefore(text, lang))
      expect(direction).toBe(cutDirection(text, available, lang))
      if (direction) expect(lead + 7.2 + planPx(WORDS[lang].name, true) + planPx(gapBefore(direction, lang)) + planPx(direction)).toBeLessThanOrEqual(columns * 7.2)
      if (direction?.includes('…') && !['zh', 'zh-Hant', 'ja', 'ko'].includes(lang)) {
        const words = direction.slice(1, -2).split(' ')
        expect([...words[words.length - 1]!].length).toBeGreaterThan(4)
        expect(text.slice(1, -1).startsWith(words.join(' ') + ' ')).toBe(true)
      }
    }
  })
  test('book labels depend only on width across the seven head moods and all languages', () => {
    for (const { code: lang } of LANGS) for (const surface of ['vscode', 'mobile', 'desktop'] as const) for (let columns = 20; columns <= 100; columns++) {
      const labels = MOODS.map(mood => planHead({ mood, newest: true }, lang, columns, surface, true).label)
      expect(new Set(labels).size, `${lang}/${surface}/${columns}`).toBe(1)
    }
  })
  test('spaced directions end at a whole substantive word, or disappear', () => {
    expect(planHead({ mood: 'work', newest: true }, 'en', 41, 'vscode', true).direction).toBe('(typing…)')
    // the narrow Settings label is a gear (10-14), so at 41 the whole direction fits; "(smug…)" is never a cut
    expect(planHead({ mood: 'happy', newest: true }, 'en', 41, 'mobile', true).direction).toBe('(smug ω mouth)')
    expect(planHead({ mood: 'happy', newest: true }, 'en', 33, 'mobile', true).direction).toBeUndefined()
    expect(planHead({ mood: 'happy', newest: true }, 'de', 34, 'vscode', true).direction).toBeUndefined()
    expect(planHead({ mood: 'think', newest: true }, 'de', 41, 'vscode', true).direction).toBe('(Antennen…)')
    expect(planHead({ mood: 'happy', newest: true }, 'de', 41, 'vscode', true).direction).toBeUndefined()
    expect(planHead({ mood: 'think', newest: true }, 'es-419', 41, 'vscode', true).direction).toBe('(antenas…)')
    for (const { code: lang } of LANGS.filter(l => !['zh', 'zh-Hant', 'ja', 'ko'].includes(l.code))) for (const mood of MOODS) for (let columns = 26; columns < 65; columns++) {
      const direction = planHead({ mood, newest: true }, lang, columns, 'vscode', true).direction
      if (!direction?.includes('…')) continue
      const words = direction.slice(1, -2).split(' ')
      expect([...words[words.length - 1]!].length, `${lang}/${mood}/${columns}:${direction}`).toBeGreaterThan(4)
      expect(WORDS[lang].aside[mood].slice(1, -1).startsWith(words.join(' ') + ' ')).toBe(true)
    }
  })
  test('CJK cuts keep the shared at-least-three-character behavior', () => {
    for (const lang of ['zh', 'zh-Hant', 'ja', 'ko'] as const) for (const mood of MOODS) for (let columns = 26; columns < 65; columns++) {
      const p = planHead({ mood, newest: true }, lang, columns, 'vscode', true)
      const d = WORDS[lang].aside[mood]
      const budget = columns * 7.2 - 35 - 7.2 - planPx(WORDS[lang].name, true) - planPx(gapBefore(d, lang)) - (p.label ? planPx(p.label) + 3 * 7.2 : 0)
      expect(p.direction).toBe(cutToPx(d, budget))
    }
  })
  for (const component of ['AskUserQuestion', 'CommandOutput'] as const) for (const surface of ['vscode', 'mobile'] as const) {
    test(`${surface}/${component}: direction fits its own pixel budget and preserves native content`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true }); await $.session.start({ ...START, surface })
      // 36 columns: with the short name Coco the question direction still has to cut here (10-14 old words).
      const tree = await (await $.ui.mount({ surface, ...line(component, 36) })).drawn()
      const direction = nodes(tree, 'Text').find(n => n.props?.italic)?.children?.join('')
      expect(direction).toBe(component === 'AskUserQuestion' ? '(waiting…)': '(swaps shells)')
      expect((component === 'AskUserQuestion' ? 35 : 26) + 7.2 + planPx(WORDS.en.name, true) + planPx(gapBefore(String(direction), 'en')) + planPx(String(direction))).toBeLessThanOrEqual(36 * 7.2 * (surface === 'mobile' ? 0.9 : 1))
      expect(nodes(tree, 'engine').length).toBe(1)
      const box = nodes(tree, 'Box').find(n => n.props?.marginLeft === 1)
      expect(box?.props).toMatchObject({ flexGrow: 1, flexShrink: 1 })
      if (component === 'CommandOutput') expect(box?.props?.minWidth).toBe(0)
      else expect(box?.props?.minWidth).toBeUndefined()
    })
    test(`${surface}/${component}: all supported language trees fit at the reviewed panel width`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true }); await $.session.start({ ...START, surface })
      const columns = surface === 'vscode' ? 41 : 46
      const lead = component === 'AskUserQuestion' ? 35 : 26
      for (const { code: lang } of LANGS) {
        await $.command.run({ command: 'coco', args: `lang ${lang}`, origin: PERSON, presentation: P })
        const ui = await $.ui.mount({ surface, ...line(component, columns) })
        const tree = await ui.drawn()
        const direction = nodes(tree, 'Text').find(n => n.props?.italic !== undefined)?.children?.join('')
        const text = component === 'AskUserQuestion' ? WORDS[lang].aside.question : shedDirection(lang)
        expect(direction).toBe(planLine(text, lead, lang, columns, surface))
        if (direction) expect(lead + 7.2 + planPx(WORDS[lang].name, true) + planPx(gapBefore(direction, lang)) + planPx(direction), `${lang}/${direction}`).toBeLessThanOrEqual(columns * 7.2 * (surface === 'mobile' ? 0.9 : 1))
        expect(nodes(tree, 'engine').length).toBe(1)
        await ui.unmount()
      }
    })
    test(`${surface}/${component}: a direction with no whole word fitting is absent`, async ($, on) => {
      world(on, { store: RECENT, engineRows: true }); await $.session.start({ ...START, surface })
      const tree = await (await $.ui.mount({ surface, ...line(component, 19) })).drawn()
      expect(nodes(tree, 'Text').filter(n => n.props?.italic).length).toBe(0)
      expect(nodes(tree, 'Text').some(n => n.props?.bold && n.children?.includes(WORDS.en.name))).toBe(true)
    })
  }
  for (const component of ['AskUserQuestion', 'CommandOutput'] as const) test(`desktop/${component}: direction wraps in the body color`, async ($, on) => {
    world(on, { store: RECENT, engineRows: true }); await $.session.start({ ...START, surface: 'desktop' })
    const tree = await (await $.ui.mount({ surface: 'desktop', ...line(component) })).drawn()
    expect(nodes(tree, 'Text').find(n => n.props?.wrap)?.props?.wrap).toBe('wrap')
    expect(nodes(tree, 'Text').find(n => n.props?.italic)?.props?.color).toBeUndefined()
  })
  test('mobile and VS Code Book buttons use full host text color', async ($, on) => {
    const key = headKey(MORNING - 1000, 'book-session', 'book-head')
    world(on, { store: { ...RECENT, [key]: ['book-head', 'error', MORNING - 1000, 120000] }, sessionId: 'book-session', engineRows: true })
    await $.session.start(START)
    for (const surface of ['mobile', 'vscode'] as const) {
      const ui = await $.ui.mount({ surface, ...reply('book-head') })
      // C3 round 4 high-contrast decision: Book stays in the host's full native text colour.
      const book = await ui.find({ key: 'coco:book:open' })
      expect(book).toBeDefined()
      expect(book?.props.dimColor).toBeUndefined()
      expect(book?.props.color).toBeUndefined()
    }
  })
  for (const [lang, zone, endedAt, ms] of [
    ['en', 'America/Los_Angeles', Date.UTC(2026, 9, 2, 21, 32), 125 * 60_000],
    ['hi', 'Asia/Kolkata', Date.UTC(2026, 9, 2, 9, 2), 59_000],
    ['zh', 'Asia/Singapore', Date.UTC(2026, 9, 1, 19, 2), 60 * 60_000],
    ['zh', 'Asia/Singapore', Date.UTC(2026, 9, 1, 7, 2), 60 * 60_000],
    ['en', 'America/Los_Angeles', Date.UTC(2026, 9, 1, 21, 32), 125 * 60_000],
    ['en', 'America/Los_Angeles', Date.UTC(2025, 9, 1, 21, 32), 59 * 60_000],
  ] as const) test(`hover note uses book time/date and duration units: ${lang}/${zone}/${endedAt}/${ms}`, async ($, on) => {
    const key = headKey(endedAt, 'old-session', 'note-head')
    world(on, { store: { ...RECENT, [key]: ['note-head', 'error', endedAt, ms] }, sessionId: 'current-session', settings: { timeZone: zone }, engineRows: true })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'vscode', ...reply('note-head', 150) })
    const locale = lang === 'zh' ? 'zh-SG' : lang
    await $.command.run({ command: 'coco', args: `lang ${lang}`, origin: PERSON, presentation: P })
    const unit = ms >= 3_600_000 ? 'hour' : ms >= 60_000 ? 'minute' : 'second'
    const duration = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: unit === 'hour' ? 1 : 0 }).format(ms / (unit === 'hour' ? 3_600_000 : unit === 'minute' ? 60_000 : 1000))
    const clock = moment(new Date(endedAt).toISOString(), MORNING, lang, zone)
    expect(await ui.find({ text: lang === 'zh' ? `${clock}(${duration})` : `${clock} (${duration})` })).toBeDefined()
    if (lang === 'en' && ms === 125 * 60_000) {
      expect(duration).toBe('2.1 hr')
      expect(moment(new Date(endedAt).toISOString(), MORNING, lang, zone)).toBe(endedAt === Date.UTC(2026, 9, 2, 21, 32) ? '2:32 PM' : 'Oct 1 2:32 PM')
    }
  })
  test('shipping policy also applies to an unfinished head after a newer reply claims the book button', async ($, on) => {
    world(on, { store: RECENT, engineRows: true, stepText: 'first words' }); await $.session.start(START)
    await $.turn.start({ turnId: 'unfinished', text: 'go' })
    for await (const _ of $.turn.step({ turnId: 'unfinished', index: 0, model: 'claude', messageCount: 1 })) {}
    const old = await $.ui.mount({ surface: 'vscode', ...reply('unfinished-head') })
    expect(await old.find({ text: WORDS.en.aside.think })).toBeDefined()
    await $.turn.start({ turnId: 'new-turn', text: 'go' })
    for await (const _ of $.turn.step({ turnId: 'new-turn', index: 0, model: 'claude', messageCount: 1 })) {}
    const current = await $.ui.mount({ surface: 'vscode', ...reply('new-head') })
    if (OLDER_HEAD_DIRECTION === 'none') expect(await old.find({ text: WORDS.en.aside.think })).toBeUndefined()
    else expect(await old.find({ text: WORDS.en.aside.think })).toBeDefined()
    expect(await old.find({ text: WORDS.en.name })).toBeDefined()
    expect(await old.find({ type: 'Svg' })).toBeDefined()
    expect(await old.find({ key: 'coco:book:open' })).toBeUndefined()
    expect(await current.find({ text: WORDS.en.aside.think })).toBeDefined()
    expect(await current.find({ key: 'coco:book:open' })).toBeDefined()
  })
  test('shipping policy controls older settled directions while retaining the face and name', async ($, on) => {
    const store = { ...RECENT, ...Object.fromEntries(['happy', 'error'].map((mood, i) => [headKey(MORNING - 3000 + i, 'past-session', mood), [mood, mood, MORNING - 3000 + i, 120000]])) }
    world(on, { store, sessionId: 'current-session', engineRows: true }); await $.session.start(START)
    for (const mood of ['happy', 'error'] as const) {
      const ui = await $.ui.mount({ surface: 'vscode', ...reply(mood) })
      const visible = OLDER_HEAD_DIRECTION === 'all' || (OLDER_HEAD_DIRECTION === 'news' && mood === 'error')
      if (visible) expect(await ui.find({ text: WORDS.en.aside[mood] })).toBeDefined()
      else expect(await ui.find({ text: WORDS.en.aside[mood] })).toBeUndefined()
      expect(await ui.find({ text: WORDS.en.name })).toBeDefined()
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
  })
})
