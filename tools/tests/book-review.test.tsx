import { installM1Words } from './m1-more-data-fixture'
// What an independent review of his book and his marks found, each held by a test: the marks
// switch from the very first row, other plugins' writes and closes, the keyboard, honest help
// text, absolute times, a cue for each speaker on its own, a closed book holding nothing, and
// the footer and italics rules.

import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { gapWord } from '../hooks/mod-gaps-words'
import { settleLegacyStart, P, PERSON, RECENT, world } from './world'
import { D1_ROOM_ASSET_FILES } from './d1-room-assets-fixture'
import { joinPath } from '../hooks/paths'


installM1Words()

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const BOOK_PANE = 'coco-book'
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: BOOK_PANE,
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const REPLY = { plugin: 'coco', component: 'AssistantMessage' as const, props: { text: 'Done.', isFirstOfReply: true } }
const YOURS = { plugin: 'coco', component: 'UserMessage' as const, props: { text: 'Fix the flaky test.', origin: { kind: 'composer' as const }, isExpanded: true } }
const ASK = { plugin: 'coco', component: 'AskUserQuestion' as const, props: { tool: 'AskUserQuestion', questions: [{ question: 'Which one?' }] } }
const FOOTER = { plugin: 'coco', component: 'SessionMode' as const, props: { modes: ['focus'] } }
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
      return {}
    })
    on('command.run', { command: 'shut' }, async $ => {
      await $.ui.close({ id: 'coco-book' })
      return {}
    })
  },
}

describe('the review of his book and marks', () => {
  test('marks off holds from the very first rows: five replies drawn together right after start, none marked', async ($, on) => {
    const setupWorld=world(on, { store: { ...RECENT, marks: 'off' }, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const rows = await Promise.all([1, 2, 3, 4, 5].map(i => $.ui.mount({ surface: 'desktop', ...REPLY, requestId: `m${i}` })))
    const drawn = await Promise.all(rows.map(row => row.drawn()))
    expect(drawn).toEqual([ENGINE, ENGINE, ENGINE, ENGINE, ENGINE])
  })

  test("another plugin's store writes leave his records alone", { plugins: [INTRUDER] }, async ($, on) => {
    const setupWorld=world(on, { store: { ...RECENT, firstMet: undefined } })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await run($, 'scribble')
    await run($, 'coco', 'log')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    // BOOK 10-09: a label and its value stand in two columns, so they are two Texts of one row.
    const shown = (await book.findAll({ type: 'Text' })).map((node: any) => node.text ?? '').join(' ')
    expect(shown).toMatch(/First page\s+Not yet/)
  })

  test("another plugin closing a pane of the same name leaves his book open and live", { plugins: [INTRUDER] }, async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56 })
    await $.session.start(START); await settleLegacyStart($,w);
    await run($, 'coco', 'usage')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await run($, 'shut')
    w.percent = 61
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(await ui.find({ type: 'Text', text: /61%/ })).toBeUndefined()
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }) // the band reads the engine's figures here
    expect(await ui.find({ type: 'Text', text: /61%/ })).toBeDefined()
  })

  test('book words load only on first use and redraws keep the page cache', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56 })
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(w.fileReads.filter(path => /[\\/]book[\\/]/.test(path))).toEqual([])
    const assetReadsBeforeOpen = w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path))
    const roomReads = () => w.fileReads.filter(path => /[\\/]assets[\\/]coco-room[\\/]/.test(path))
    expect(roomReads()).toEqual([])
    const roomLayers = JSON.parse(D1_ROOM_ASSET_FILES['layers.json']!) as { layers: Record<string, { png: Record<string, string> }> }
    const roomFiles = ['layers.json', ...Object.values(roomLayers.layers).flatMap(layer => Object.values(layer.png))]
    expect(roomFiles).toHaveLength(79) // their room: 39 layers at two scales (Claudie and 大肥鱼 standing, 6d4365fe) and layers.json
    expect([...roomFiles].sort()).toEqual(Object.keys(D1_ROOM_ASSET_FILES).sort())
    // a tool pose reads none of the old frames (their manifest neither): she is drawn from her own pictures
    expect(assetReadsBeforeOpen.filter(path => /[\\/]assets[\\/]frame-manifest\.json$/.test(path))).toEqual([])
    await run($, 'coco')
    const pane = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(w.fileReads.filter(path => /[\\/]book[\\/]/.test(path)).map(path => path.split(/[\\/]/).at(-1))).toEqual(['en.json'])
    const firstRoomRead = roomReads()[0] ?? ''
    const assetRoot = firstRoomRead.replace(/[\\/]coco-room[\\/][^\\/]+$/, '')
    expect(assetRoot).toMatch(/[\\/]assets$/)
    const assetSeparator = firstRoomRead.match(/([\\/])coco-room[\\/][^\\/]+$/)![1]!
    const roomAssetReads = roomFiles.map(file => `${assetRoot}${assetSeparator}coco-room${assetSeparator}${file}`)
    expect(roomReads()).toEqual(roomAssetReads)
    await pane.redraw()
    await pane.redraw()
    expect(w.fileReads.filter(path => /[\\/]book[\\/]/.test(path)).map(path => path.split(/[\\/]/).at(-1))).toEqual(['en.json'])
    // the bag's picture of her peeking out (lane C 10-17) is read once with the room, before it
    const peekReads = w.fileReads.filter(path => /[\\/]assets[\\/]coco[\\/]bag-peek(?:-b)?\.png$/.test(path))
    expect(peekReads.map(path => path.split(/[\\/]/).at(-1))).toEqual(['bag-peek.png'])
    expect(w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path))).toEqual([...assetReadsBeforeOpen, ...peekReads, ...roomAssetReads])
    expect(roomReads()).toEqual(roomAssetReads)
  })

  test('the book takes the keyboard when the person opens it, and the terminal tabs show their keys', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await run($, 'coco')
    expect(w.opens.at(-1)).toEqual({ id: BOOK_PANE, focus: true })
    const terminal = await $.ui.mount({ surface: 'terminal', ...PANE })
    const tabs = (await terminal.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('coco:book:tab:'))
    expect(tabs.map(t => String(t.props.label).split(' ')[0])).toEqual(['1', '2', '3', '4', '5', '6', '7']) // her itabag's seven pages (lane C, 10-14)
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
    await $.session.start(START); await settleLegacyStart($,w);
    await run($, 'coco', 'usage')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await book.find({ type: 'Text', text: /resets Oct 3,? 5:00\s?PM/ })).toBeDefined()
    expect(await book.find({ type: 'Text', text: /Started at Sep 29,? 10:00\s?PM/ })).toBeDefined()
  })

  test('marks replies: his cue and lines stay, the cue above your prompts goes', async ($, on) => {
    const setupWorld=world(on, { stepText: 'Done.', store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await run($, 'coco', 'marks replies')
    await $.turn.start({ text: 'go', turnId: 'marks-review' })
    for await (const _ of $.turn.step({ turnId: 'marks-review', index: 0, model: 'claude', messageCount: 1 })) {}
    expect(await (await $.ui.mount({ surface: 'desktop', ...YOURS })).drawn()).toEqual(ENGINE)
    expect(await (await $.ui.mount({ surface: 'desktop', ...REPLY })).find({ type: 'Text', text: /Coco/ })).toBeDefined()
    expect(await (await $.ui.mount({ surface: 'desktop', ...ASK })).find({ type: 'Text', text: /waiting for your answer/ })).toBeDefined()
    await run($, 'coco', 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    const keys = (await book.findAll({ type: 'Button' })).map(b => String(b.key)).filter(k => k.startsWith('coco:set:marks:'))
    expect(keys).toEqual(['coco:set:marks:on', 'coco:set:marks:replies', 'coco:set:marks:off'])
    const shown = (await book.findAll({ type: 'Text' })).map((node: any) => node.text ?? '').join(' ')
    expect(shown).toMatch(/Marks in the conversation\s+Now:\u00a0Only\u00a0Coco's/)
  })

  test('the footer label is the desktop\'s, behind the marks switch', async ($, on) => {
    let modes: readonly string[] = []
    const setupWorld=world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'SessionMode') modes = (props as { modes: readonly string[] }).modes
      },
    })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await run($, 'coco', 'voice full')
    await $.ui.mount({ surface: 'terminal', ...FOOTER })
    expect(modes).toEqual(['focus'])
    await $.ui.mount({ surface: 'desktop', ...FOOTER })
    expect(modes).toEqual(['focus', "coco's voice"])
    await run($, 'coco', 'marks off')
    await $.ui.mount({ surface: 'desktop', ...FOOTER })
    expect(modes).toEqual(['focus'])
  })

  test('help longer than one line stands upright; his stage direction stays italic', async ($, on) => {
    const setupWorld=world(on, { store: {...RECENT,bandSettings:{voice:'light',voiceChosen:true}}, env: { LANG: 'de_DE.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await run($, 'coco', 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE, props: { ...PANE.props, bodyColumns: 44 } })
    const voiceHelp = await book.find({ type: 'Text', text: gapWord('de', 'settings.voice.help') })
    expect(voiceHelp).toBeDefined()
    expect(voiceHelp?.props.italic === true).toBe(false)
    const direction = await book.find({ type: 'Text', text: '(wartet, bis du dich entschieden hast)' })
    expect(direction?.props.italic).toBe(true)
  })
})
