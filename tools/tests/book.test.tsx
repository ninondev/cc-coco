// His book (the pane) and his marks on the engine's rows: what each page shows, that presses
// change what they say, that live figures redraw the open book, and what the rows cost.

import { describe, expect, test } from 'claude-code/testing'
import { moment } from '../hooks/book'
import { LINES } from '../hooks/lines'
import { VOICE } from '../hooks/voice'
import { P, PERSON, RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'claudesama',
  component: 'Pane' as const,
  requestId: 'claudesama-book',
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const REPLY = { plugin: 'claudesama', component: 'AssistantMessage' as const, props: { text: 'Done. All 41 tests pass.', isFirstOfReply: true } }
const ENGINE = { type: 'engine', ref: 0 }
const prompt = (kind: 'composer' | 'bridge' | 'sdk' | 'task-notification' | 'peer' | 'scheduled-trigger') => ({
  plugin: 'claudesama',
  component: 'UserMessage' as const,
  props: { text: 'Fix the flaky test.', origin: { kind }, isExpanded: true },
})
const ASK = { plugin: 'claudesama', component: 'AskUserQuestion' as const, props: { tool: 'AskUserQuestion', questions: [{ question: 'Which one?' }] } }
const output = (command: string, isErrored: boolean) => ({ plugin: 'claudesama', component: 'CommandOutput' as const, props: { command, args: '', text: 'Compacted.', isErrored } })
const STEP = (word: string) => ({ plugin: 'claudesama', component: 'Spinner' as const, props: { word, message: null, suffix: '…', mode: 'thinking' as const } })
const LIMITS = [
  { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' },
  { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-06T09:00:00Z' },
]

async function open($: Parameters<Parameters<typeof test>[1]>[0], args = '') {
  await $.command.run({ command: 'claudesama', args, origin: PERSON, presentation: P })
}

describe('his book', () => {
  test('/claudesama opens it at his page: six tabs, his name, who he is', async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    await open($)
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ surface, ...PANE })
      const tabs = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('claudesama:book:tab:'))
      const labels = ['His page', "Today's omen", 'Offerings', 'Reading log', 'Library', 'Settings']
      expect(tabs.map(t => t.props.label)).toEqual(surface === 'desktop' ? labels : labels.map((label, i) => `${i + 1} ${label}`))
      expect(tabs[0]?.props.variant).toBe('primary')
      expect(await ui.find({ type: 'Text', text: /Claude-sama/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Pi Day/ })).toBeDefined()
      expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })).toBeDefined()
      await ui.unmount()
    }
  })

  test("the band's button opens it, on the desktop", async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    const strip = await $.ui.mount({ surface: 'desktop', ...band(90) })
    await strip.press({ key: 'claudesama:book:open' })
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Pi Day/ })).toBeDefined()
  })

  test('tabs turn the pages; the library turns its own', async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'claudesama:book:tab:library' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Where he came from' })).toBeDefined()
    await ui.press({ key: 'claudesama:book:next' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Two souls' })).toBeDefined()
    await ui.press({ key: 'claudesama:book:previous' })
    await ui.redraw()
    await ui.press({ key: 'claudesama:book:previous' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'The family' })).toBeDefined()
  })

  test('the settings page changes his voice, the band and warmth, and shows it at once', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Now: Light/ })).toBeDefined()
    await ui.press({ key: 'claudesama:set:voice:full' })
    await ui.redraw()
    expect(w.view().voice).toBe('full')
    expect(await ui.find({ type: 'Text', text: /Now: Full/ })).toBeDefined()
    const ask = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [], surfaces: ['desktop' as const] }
    const sections = (await $.prompt.compose(ask)).sections.filter(s => s.id === 'claudesama:voice')
    expect(sections.map(s => s.text)).toEqual([VOICE.full])
    await ui.press({ key: 'claudesama:set:band:compact' })
    await ui.redraw()
    expect(w.view().band).toBe('compact')
    expect(await ui.find({ type: 'Text', text: /Now: Pixel/ })).toBeDefined()
    await ui.press({ key: 'claudesama:set:affection:clingy' })
    await ui.redraw()
    expect(w.view().affection).toBe('clingy')
  })

  test('the language row lists every language by its own name and switches him', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Now: Automatic · English/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'claudesama:set:lang:hi' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'claudesama:set:lang:zh', text: '华文(新加坡)' })).toBeDefined()
    await ui.press({ key: 'claudesama:set:lang:ja' })
    await ui.redraw()
    expect(w.view().lang).toBe('ja')
    expect(await ui.find({ type: 'Button', text: 'かれのこと' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /いま:日本語/ })).toBeDefined()
    await ui.press({ key: 'claudesama:set:lang:zh' })
    await ui.redraw()
    expect(w.view().lang).toBe('zh')
    expect(await ui.find({ type: 'Text', text: /现在:华文\(新加坡\)/ })).toBeDefined()
  })

  test('Chinese (Singapore) dates, times and numbers appear in both book surfaces', async ($, on) => {
    const now = Date.parse('2026-10-02T14:50:00Z')
    const w = world(on, {
      settings: { language: '华文', timeZone: 'Asia/Singapore' },
      store: {
        ...RECENT, firstMet: now, turns: 12345,
        latestNight: { at: now, minutes: 60 },
        omen: { day: '2026-10-02', rank: 'daikichi', index: 0 },
      },
      percent: 56.5,
      limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-03T14:50:00Z' }],
      cost: 1234.56, startedAt: now,
    })
    await w.clock.set(now)
    await $.session.start(START)
    await open($, 'offerings')
    expect(moment('2025-10-02T14:50:00Z', now, 'zh', 'Asia/Singapore')).toBe('2025年10月2日下午10:50')
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ surface, ...PANE })
      await ui.press({ key: 'claudesama:book:tab:offerings' })
      await ui.redraw()
      for (const text of [
        /装了56\.5%/, /已用113,000 \/ 200,000 token/,
        /已用23\.5% · 10月3日下午10:50重置/,
        /目前花费:US\$1,234\.56/, /下午10:50开始/,
      ]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
      await ui.press({ key: 'claudesama:book:tab:log' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /一起读过的页数:12,345/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /第一页:2026年10月2日/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /熬得最晚的一夜:2026年10月2日下午10:50/ })).toBeDefined()
      await ui.press({ key: 'claudesama:book:tab:omen' })
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: /10月2日抽的/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test("today's omen: a button until drawn, then the slip as written, counted once", async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'claudesama:book:tab:omen' })
    await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'claudesama:omen:draw' })).toBeDefined()
    await ui.press({ key: 'claudesama:omen:draw' })
    await ui.redraw()
    const fortunes: string[] = Object.values(LINES.omikuji.en).flat()
    const shown = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(shown.some(text => fortunes.includes(text))).toBe(true)
    expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.alt).startsWith('fortune slip: '))).toBe(true)
    await $.command.run({ command: 'omen', args: '', origin: PERSON, presentation: P }) // the same day: the same slip, no second count
    await ui.press({ key: 'claudesama:book:tab:log' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: /Omens drawn\s+once/ })).toBeDefined()
  })

  test('the offering box page: the figure, the limits, the cost, redrawn when they move', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56, limits: LIMITS, cost: 1.84 })
    await $.session.start(START)
    await open($, 'offerings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /56% full/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /112,000 of 200,000 tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /23\.5% used/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.84/ })).toBeDefined()
    w.limits = [{ kind: 'five_hour', percentUsed: 31, resetsAt: '2026-10-02T16:00:00Z' }]
    w.percent = 61
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }) // the box reads the engine's figures here
    expect(await ui.find({ type: 'Text', text: /31% used/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /61% full/ })).toBeDefined()
  })

  test('the reading log counts pages, the wild soul and the first page', async ($, on) => {
    const w = world(on, { store: { ...RECENT, turns: 41 } })
    w.fails = true
    await $.session.start(START)
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.turn.complete({ answer: 'Fixed.', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    await open($, 'log')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Pages read together\s+42/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /The wild soul came out\s+once/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /First page\s+Oct 2, 2026/ })).toBeDefined()
  })

  test('the latest night is kept: a turn at 03:12 beats one at 01:40, one at noon changes nothing', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    const finish = async (at: number) => {
      await w.clock.set(at)
      await $.turn.start({ text: 'x', turnId: `t${at}` })
      await $.turn.complete({ answer: '.', durationMs: 1, isAborted: false, turnId: `t${at}`, reason: 'answer' })
    }
    await finish(Date.UTC(2026, 9, 3, 1, 40))
    await finish(Date.UTC(2026, 9, 4, 3, 12))
    await finish(Date.UTC(2026, 9, 4, 12, 0))
    await open($, 'log')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Latest night\s+3:12\s?AM on Oct 4, 2026/ })).toBeDefined()
  })

  test('the book follows the language', async ($, on) => {
    world(on, { store: RECENT, env: { LANG: 'ja_JP.UTF-8' } })
    await $.session.start(START)
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Button', text: 'かれのこと' })).toBeDefined()
  })

  test('/claudesama with a word it does not know still lists the commands', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await open($, 'whatever')
    expect(w.toasts.at(-1)).toContain('/claudesama')
  })
})

describe('his marks on the engine rows', () => {
  test("his name stands above each of Claude's replies on the desktop, the engine's row kept whole", async ($, on) => {
    world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    const first = await $.ui.mount({ surface: 'desktop', ...REPLY })
    const tree = (await first.drawn()) as { children?: unknown[] }
    expect(tree.children?.[1]).toEqual(ENGINE)
    expect(await first.find({ type: 'Text', text: '✻ Claude-sama' })).toBeDefined()
    const later = await $.ui.mount({ surface: 'desktop', ...REPLY, props: { ...REPLY.props, isFirstOfReply: false } })
    expect(await later.drawn()).toEqual(ENGINE)
    const terminal = await $.ui.mount({ surface: 'terminal', ...REPLY })
    expect(await terminal.drawn()).toEqual(ENGINE)
  })

  test('by default your prompts stay as the engine draws them; his name stays above his replies', async ($, on) => {
    world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    expect(await (await $.ui.mount({ surface: 'desktop', ...prompt('composer') })).drawn()).toEqual(ENGINE)
  })

  test('with marks on, your name stands above your own prompts; a notification keeps only the engine\'s marking', async ($, on) => {
    world(on, { store: { ...RECENT, marks: 'on' }, engineRows: true })
    await $.session.start(START)
    for (const kind of ['composer', 'bridge', 'sdk'] as const) {
      const row = await $.ui.mount({ surface: 'desktop', ...prompt(kind) })
      const tree = (await row.drawn()) as { children?: unknown[] }
      expect(tree.children?.[1]).toEqual(ENGINE)
      expect(await row.find({ type: 'Text', text: 'You' })).toBeDefined()
      const cue = tree.children?.[0] as { props?: Record<string, unknown> }
      expect(cue.props?.justifyContent).toBe('flex-end') // on the right, over your bubble
    }
    for (const kind of ['task-notification', 'peer', 'scheduled-trigger'] as const) {
      expect(await (await $.ui.mount({ surface: 'desktop', ...prompt(kind) })).drawn()).toEqual(ENGINE)
    }
    expect(await (await $.ui.mount({ surface: 'terminal', ...prompt('composer') })).drawn()).toEqual(ENGINE)
  })

  test('the question card gets his stage direction above it, the card kept whole', async ($, on) => {
    world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    const card = await $.ui.mount({ surface: 'desktop', ...ASK })
    const tree = (await card.drawn()) as { children?: unknown[] }
    expect(tree.children?.[1]).toEqual(ENGINE)
    expect(await card.find({ type: 'Text', text: /✻ Claude-sama\s+\(waiting for your answer\)/ })).toBeDefined()
  })

  test("/compact's row gets one line under it; an errored one, or any other command's, none", async ($, on) => {
    world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    const swept = await $.ui.mount({ surface: 'desktop', ...output('compact', false) })
    const tree = (await swept.drawn()) as { children?: unknown[] }
    expect(tree.children?.[0]).toEqual(ENGINE)
    expect(await swept.find({ type: 'Text', text: /sweeping out the offering box/ })).toBeDefined()
    expect(await (await $.ui.mount({ surface: 'desktop', ...output('compact', true) })).drawn()).toEqual(ENGINE)
    expect(await (await $.ui.mount({ surface: 'desktop', ...output('cost', false) })).drawn()).toEqual(ENGINE)
  })

  test('the step row shows his word where the engine says only "Working"', async ($, on) => {
    let word = ''
    const w = world(on, {
      store: RECENT,
      engineRows: true,
      onRender: (component, props) => {
        if (component === 'Spinner') word = (props as { word: string }).word
      },
    })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...STEP('Working') })
    expect(word).toBe(w.view().verb)
    await $.ui.mount({ surface: 'desktop', ...STEP('Creating notes.md') })
    expect(word).toBe('Creating notes.md')
  })

  test('one switch takes every mark away, and back', async ($, on) => {
    let word = ''
    world(on, {
      store: { ...RECENT, marks: 'on' },
      engineRows: true,
      onRender: (component, props) => {
        if (component === 'Spinner') word = (props as { word: string }).word
      },
    })
    await $.session.start(START)
    await open($, 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await book.find({ type: 'Text', text: /Marks in the conversation\s+Now: His and yours/ })).toBeDefined()
    await book.press({ key: 'claudesama:set:marks:off' })
    await book.redraw()
    expect(await book.find({ type: 'Text', text: /Marks in the conversation\s+Now: Off/ })).toBeDefined()
    for (const row of [REPLY, prompt('composer'), ASK, output('compact', false)]) {
      expect(await (await $.ui.mount({ surface: 'desktop', ...row })).drawn()).toEqual(ENGINE)
    }
    await $.ui.mount({ surface: 'desktop', ...STEP('Working') })
    expect(word).toBe('Working')
    await $.command.run({ command: 'claudesama', args: 'marks on', origin: PERSON, presentation: P })
    const reply = await $.ui.mount({ surface: 'desktop', ...REPLY })
    expect(await reply.find({ type: 'Text', text: '✻ Claude-sama' })).toBeDefined()
  })

  test('the footer names a mode only while his voice is full', async ($, on) => {
    let modes: readonly string[] = []
    world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'SessionMode') modes = (props as { modes: readonly string[] }).modes
      },
    })
    await $.session.start(START)
    const footer = { plugin: 'claudesama', component: 'SessionMode' as const, props: { modes: ['focus'] } }
    await $.ui.mount({ surface: 'desktop', ...footer })
    expect(modes).toEqual(['focus'])
    await $.command.run({ command: 'claudesama', args: 'voice full', origin: PERSON, presentation: P })
    await $.ui.mount({ surface: 'desktop', ...footer })
    expect(modes).toEqual(['focus', 'claude-sama voice'])
  })

  test('a hundred reply rows read no state', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    const before = w.stateReads
    for (let i = 0; i < 100; i++) {
      const row = await $.ui.mount({ surface: 'desktop', ...REPLY, requestId: `m${i}` })
      await row.unmount()
    }
    expect(w.stateReads - before).toBe(0)
  })
})
