// What an independent review of his book and his marks found, each held by a test: the marks
// switch from the very first row, other plugins' writes and closes, the keyboard, honest help
// text, absolute times, a cue for each speaker on its own, a closed book holding nothing, and
// the footer and italics rules.

import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { P, PERSON, RECENT, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const BOOK_PANE = 'claudesama-book'
const PANE = {
  plugin: 'claudesama',
  component: 'Pane' as const,
  requestId: BOOK_PANE,
  props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const REPLY = { plugin: 'claudesama', component: 'AssistantMessage' as const, props: { text: 'Done.', isFirstOfReply: true } }
const YOURS = { plugin: 'claudesama', component: 'UserMessage' as const, props: { text: 'Fix the flaky test.', origin: { kind: 'composer' as const }, isExpanded: true } }
const ASK = { plugin: 'claudesama', component: 'AskUserQuestion' as const, props: { tool: 'AskUserQuestion', questions: [{ question: 'Which one?' }] } }
const FOOTER = { plugin: 'claudesama', component: 'SessionMode' as const, props: { modes: ['focus'] } }
const ENGINE = { type: 'engine', ref: 0 }

async function run($: Parameters<Parameters<typeof test>[1]>[0], command: string, args = '') {
  await $.command.run({ command, args, origin: PERSON, presentation: P })
}

// Another plugin, writing keys of the same names in its own store and closing a pane of the same
// id: none of it is his.
const INTRUDER: Plugin = {
  name: 'intruder',
  register(on) {
    on('command.run', { command: 'scribble' }, async $ => {
      await $.store.set('turns', 7)
      await $.store.set('omen', { day: '2026-10-02', rank: 'kichi', index: 0 })
      return {}
    })
    on('command.run', { command: 'shut' }, async $ => {
      await $.ui.close({ id: 'claudesama-book' })
      return {}
    })
  },
}

describe('the review of his book and marks', () => {
  test('marks off holds from the very first rows: five replies drawn together right after start, none marked', async ($, on) => {
    world(on, { store: { ...RECENT, marks: 'off' }, engineRows: true })
    await $.session.start(START)
    const rows = await Promise.all([1, 2, 3, 4, 5].map(i => $.ui.mount({ surface: 'desktop', ...REPLY, requestId: `m${i}` })))
    const drawn = await Promise.all(rows.map(row => row.drawn()))
    expect(drawn).toEqual([ENGINE, ENGINE, ENGINE, ENGINE, ENGINE])
  })

  test("another plugin's store writes leave his records alone", { plugins: [INTRUDER] }, async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    await run($, 'scribble')
    await run($, 'claudesama', 'log')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await book.find({ type: 'Text', text: /First page\s+Not yet/ })).toBeDefined()
    expect(await book.find({ type: 'Text', text: /Omens drawn\s+Not yet/ })).toBeDefined()
  })

  test("another plugin closing a pane of the same name leaves his book open and live", { plugins: [INTRUDER] }, async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56 })
    await $.session.start(START)
    await run($, 'claudesama', 'offerings')
    await $.ui.mount({ surface: 'desktop', ...PANE })
    await run($, 'shut')
    w.percent = 61
    await $.turn.start({ text: 'go', turnId: 't1' })
    const rev = (w.cell('book')?.value as { rev: number }).rev
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }) // the band reads the engine's figures here
    await w.clock.advance(1)
    expect((w.cell('book')?.value as { rev: number }).rev).toBeGreaterThan(rev)
  })

  test('his book keeps no words, portraits or figures before it is first opened', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56 })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(w.fileReads.filter(path => path.includes('/book/'))).toEqual([])
    await run($, 'claudesama')
    await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(w.fileReads.filter(path => path.includes('/book/'))).toEqual([expect.stringMatching(/\/book\/en\.json$/)])
  })

  test('the book takes the keyboard when the person opens it, and the terminal tabs show their keys', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await run($, 'claudesama')
    expect(w.opens.at(-1)).toEqual({ id: BOOK_PANE, focus: true })
    const terminal = await $.ui.mount({ surface: 'terminal', ...PANE })
    const tabs = (await terminal.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('claudesama:book:tab:'))
    expect(tabs.map(t => String(t.props.label).split(' ')[0])).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  test('the offering page dates every time that is not today, past or future', async ($, on) => {
    const evening = Date.UTC(2026, 9, 2, 22, 0)
    const w = world(on, {
      store: RECENT,
      percent: 56,
      limits: [{ kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-03T17:00:00Z' }],
      startedAt: evening - 3 * 86_400_000,
    })
    await w.clock.set(evening)
    await $.session.start(START)
    await run($, 'claudesama', 'offerings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await book.find({ type: 'Text', text: /resets Oct 3,? 5:00\s?PM/ })).toBeDefined()
    expect(await book.find({ type: 'Text', text: /Started at Sep 29,? 10:00\s?PM/ })).toBeDefined()
  })

  test('marks replies: his cue and lines stay, the cue above your prompts goes', async ($, on) => {
    world(on, { store: RECENT, engineRows: true })
    await $.session.start(START)
    await run($, 'claudesama', 'marks replies')
    expect(await (await $.ui.mount({ surface: 'desktop', ...YOURS })).drawn()).toEqual(ENGINE)
    expect(await (await $.ui.mount({ surface: 'desktop', ...REPLY })).find({ type: 'Text', text: /Claude-sama/ })).toBeDefined()
    expect(await (await $.ui.mount({ surface: 'desktop', ...ASK })).find({ type: 'Text', text: /waiting for your answer/ })).toBeDefined()
    await run($, 'claudesama', 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    const keys = (await book.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k.startsWith('claudesama:set:marks:'))
    expect(keys).toEqual(['claudesama:set:marks:on', 'claudesama:set:marks:replies', 'claudesama:set:marks:off'])
    expect(await book.find({ type: 'Text', text: /Marks in the conversation\s+Now: Only his/ })).toBeDefined()
  })

  test('the footer label is the desktop\'s, behind the marks switch', async ($, on) => {
    let modes: readonly string[] = []
    world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'SessionMode') modes = (props as { modes: readonly string[] }).modes
      },
    })
    await $.session.start(START)
    await run($, 'claudesama', 'voice full')
    await $.ui.mount({ surface: 'terminal', ...FOOTER })
    expect(modes).toEqual(['focus'])
    await $.ui.mount({ surface: 'desktop', ...FOOTER })
    expect(modes).toEqual(['focus', 'claude-sama voice'])
    await run($, 'claudesama', 'marks off')
    await $.ui.mount({ surface: 'desktop', ...FOOTER })
    expect(modes).toEqual(['focus'])
  })

  test('help longer than one line stands upright; his stage direction stays italic', async ($, on) => {
    world(on, { store: RECENT, env: { LANG: 'de_DE.UTF-8' } })
    await $.session.start(START)
    await run($, 'claudesama', 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 44 } })
    const voiceHelp = await book.find({ type: 'Text', text: /^Leicht: / })
    expect(voiceHelp).toBeDefined()
    expect(voiceHelp?.props.italic === true).toBe(false)
    const direction = await book.find({ type: 'Text', text: '(wartet, bis du dich entschieden hast)' })
    expect(direction?.props.italic).toBe(true)
  })
})
