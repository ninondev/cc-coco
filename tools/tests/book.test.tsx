// His book (the pane) and his marks on the engine's rows: what each page shows, that presses
// change what they say, that live figures redraw the open book, and what the rows cost.

import { describe, expect, test } from 'claude-code/testing'
import { moment, desktopBook, terminalBook, pageBlocks } from '../hooks/book'
import type { BookData, Press } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { BOOK_FILES } from './book-files'
import { WORDS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { VOICE } from '../hooks/voice'
import { settleLegacyStart, P, PERSON, RECENT, MORNING, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const PANE = {
  plugin: 'coco',
  component: 'Pane' as const,
  requestId: 'coco-book',
  props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const REPLY = { plugin: 'coco', component: 'AssistantMessage' as const, props: { text: 'Done. All 41 tests pass.', isFirstOfReply: true } }
const ENGINE = { type: 'engine', ref: 0 }
// BOOK 10-09: a label and its value stand in two columns (or two lines), so they are separate Texts; this joins a page's Texts in order.
const pageText = async (ui: { findAll: (query: { type: string }) => Promise<{ text?: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(node => node.text ?? '').join(' ')
const prompt = (kind: 'composer' | 'bridge' | 'sdk' | 'task-notification' | 'peer' | 'scheduled-trigger') => ({
  plugin: 'coco',
  component: 'UserMessage' as const,
  props: { text: 'Fix the flaky test.', origin: { kind }, isExpanded: true },
})
const ASK = { plugin: 'coco', component: 'AskUserQuestion' as const, props: { tool: 'AskUserQuestion', questions: [{ question: 'Which one?' }] } }
const output = (command: string, isErrored: boolean) => ({ plugin: 'coco', component: 'CommandOutput' as const, props: { command, args: '', text: 'Compacted.', isErrored } })
const STEP = (word: string) => ({ plugin: 'coco', component: 'Spinner' as const, props: { word, message: null, suffix: '…', mode: 'thinking' as const } })
const LIMITS = [
  { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-02T16:00:00Z' },
  { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-06T09:00:00Z' },
]

for (const surface of ['desktop','terminal'] as const) test(`C3 ${surface} book pace note stays valid inline text with its complete bold time`, async ($,on) => {
  // SPEC 4.1: the book pace sentence wraps as a note, with its run-out time bold.
  const words=JSON.parse(BOOK_FILES['en.json']!) as BookWords
  const data:BookData={view:initialView(),usage:{startedAt:MORNING-3600000,rateLimits:[{kind:'five_hour',percentUsed:72,resetsAt:null}]},store:{bandSettings:{notes:true}},now:MORNING,timeZone:'UTC',reducedMotion:true,marks:'off',voiceSizes:{light:0,full:0},fortune:undefined,reading:0,own:WORDS.en,platform:'darwin',pace:[{kind:'five_hour',exhaustionAt:MORNING+3720000}]}
  const expected=pageBlocks('offerings',words,data,surface).find(block=>block.t==='note'&&!!block.value)
  expect(expected?.t).toBe('note')
  if(!expected||expected.t!=='note'||!expected.value)throw Error('controlled pace note missing')
  on('ui.render',{component:'Pane',requestId:'c3-pace-book'},($,e)=>{
    const ui=$.ui.resolve(e),book={page:'offerings' as const,reading:0,rev:0}
    return e.surface==='desktop'?desktopBook(ui,words,book,data,{source:'<svg width="73" height="64"></svg>',height:64},{} as Press,100):e.surface==='terminal'?terminalBook(ui,words,book,data,{} as Press,100):null
  })
  world(on)
  const ui=await $.ui.mount({surface,...PANE,requestId:'c3-pace-book'})
  expect(await ui.find({type:'Text',text:expected.text})).toBeDefined()
  const matches=await ui.findAll({type:'Text',text:expected.value})
  expect(matches.some(item=>item.text===expected.value&&item.props.bold===true)).toBe(true)
  await ui.unmount()
})

async function beginText($: Parameters<Parameters<typeof test>[1]>[0], turnId = 'marks-turn') {
  await $.turn.start({ text: 'go', turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude', messageCount: 1 })) {}
}

async function open($: Parameters<Parameters<typeof test>[1]>[0], args = '') {
  await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
}

describe('his book', () => {
  test('/coco opens it at his page: seven tabs, his name, who he is', async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await open($)
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ surface, ...PANE })
      const tabs = (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('coco:book:tab:'))
      // her itabag's seven pages in the owner's order, lane B's names (lane C, 10-14)
      const labels = ['Coco', 'Quota', 'vibe check', 'Socks', 'Doujin', 'Sticky notes', 'Switches']
      expect(tabs.map(t => t.props.label)).toEqual(surface === 'desktop' ? labels : labels.map((label, i) => `${i + 1} ${label}`))
      expect(tabs[0]?.props.variant).toBe('primary')
      expect(await ui.find({ type: 'Text', text: /Coco/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /commandeered the lot/ })).toBeDefined()
      expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Raster' })).toBeDefined()
      await ui.unmount()
    }
  })

  test("the band's button opens it, on the desktop", async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const strip = await $.ui.mount({ surface: 'desktop', ...band(90) })
    await strip.press({ key: 'coco:book:open' })
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /commandeered the lot/ })).toBeDefined()
  })

  // With lane B's group names for the sticky notes page, the seven short reads stand on the zine page (lane C's step 2).
  test('tabs turn the pages; the zine page turns its seven short reads', async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'coco:book:tab:log' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'A borrowed shell' })).toBeDefined()
    await ui.press({ key: 'coco:book:next' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'Your desk' })).toBeDefined()
    await ui.press({ key: 'coco:book:previous' })
    await ui.redraw()
    await ui.press({ key: 'coco:book:previous' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'While Coco sleeps' })).toBeDefined()
  })

  test('the settings page changes his voice and warmth, and shows it at once', async ($, on) => {
    const w = world(on, { store: { ...RECENT, voice: 'light' } })
    await $.session.start(START); await settleLegacyStart($,w);
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Now:\u00a0Light/ })).toBeDefined()
    await ui.press({ key: 'coco:set:voice:full' })
    await ui.redraw()
    expect(w.view().voice).toBe('full')
    expect(await ui.find({ type: 'Text', text: /Now:\u00a0Full/ })).toBeDefined()
    const ask = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [], surfaces: ['desktop' as const] }
    const sections = (await $.prompt.compose(ask)).sections.filter(s => s.id === 'coco:voice')
    expect(sections.map(s => s.text)).toEqual([VOICE.full])
    // the desktop bag has no band row any more (owner 10-19): the band is always the painted one, never smaller
    expect(await ui.find({ type: 'Button', key: 'coco:set:band:compact' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'coco:set:workSize:smaller' })).toBeUndefined()
    await ui.press({ key: 'coco:set:affection:clingy' })
    await ui.redraw()
    expect(w.view().affection).toBe('clingy')
  })

  test('the language row lists every language by its own name and switches him', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await open($, 'settings')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await pageText(ui)).toMatch(/Now:[\s\u00a0]Automatic[\s\u00a0]\(English\)/) // too long for the label column, so it wraps at its spaces (BOOK F2)
    expect(await ui.find({ type: 'Button', key: 'coco:set:lang:hi' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:set:lang:zh', text: '华文' })).toBeDefined()
    await ui.press({ key: 'coco:set:lang:ja' })
    await ui.redraw()
    expect(w.view().lang).toBe('ja')
    expect(await ui.find({ type: 'Button', text: 'Coco' })).toBeDefined() // her itabag's first page in Japanese
    expect(await ui.find({ type: 'Text', text: /いま:日本語/ })).toBeDefined()
    await ui.press({ key: 'coco:set:lang:zh' })
    await ui.redraw()
    expect(w.view().lang).toBe('zh')
    expect(await ui.find({ type: 'Text', text: /现在:华文(?![(（])/ })).toBeDefined()
  })

  test('Chinese (Singapore) dates, times and numbers appear in both book surfaces', async ($, on) => {
    const expectedTime = new Intl.DateTimeFormat('zh-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' }).format(new Date('2025-10-02T14:50:00Z'))
    const expectedTimePattern = expectedTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const now = Date.parse('2026-10-02T14:50:00Z')
    const expectedClock = (iso: string) => new Intl.DateTimeFormat('zh-SG', {
      hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore',
    }).format(new Date(iso))
    const priorYearClock = expectedClock('2025-10-02T14:50:00Z')
    const currentClock = expectedClock('2026-10-02T14:50:00Z')
    const resetClock = expectedClock('2026-10-03T14:50:00Z')
    const exactTextPattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const utcClock = new Intl.DateTimeFormat('zh-SG', {
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }).format(new Date('2026-10-02T14:50:00Z'))
    expect(currentClock).not.toBe(utcClock)
    const w = world(on, {
      settings: { language: '华文', timeZone: 'Asia/Singapore' },
      store: {
        ...RECENT, firstMet: now, turns: 12345,
        latestNight: { at: now, minutes: 60 },
      },
      percent: 56.5,
      limits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-03T14:50:00Z' }],
      cost: 1234.56, startedAt: now,
    })
    await w.clock.set(now)
    await $.session.start(START); await settleLegacyStart($,w);
    await open($, 'usage')
    expect(moment('2025-10-02T14:50:00Z', now, 'zh', 'Asia/Singapore')).toBe(`2025年10月2日${priorYearClock}`)
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ surface, ...PANE })
      await ui.press({ key: 'coco:book:tab:offerings' })
      await ui.redraw()
      for (const text of [
        /装了56\.5%/, /已用113,000 \/ 200,000 token/,
        exactTextPattern(`耗23.5%,10月3日${resetClock}重置`),
        exactTextPattern(`${currentClock}开始`),
      ]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
      // A plan's dollars need the API-price qualifier (W5); the Chinese session line has none yet, so no figure shows.
      expect(await ui.find({ type: 'Text', text: /1,234\.56/ })).toBeUndefined()
      await ui.press({ key: 'coco:book:tab:log' })
      await ui.redraw()
      // at 64 columns a fact is its label in a column and its value beside it, with no colon (BOOK D3)
      const log = await pageText(ui)
      expect(log).toMatch(/一起读过的页数\s+12,345/)
      expect(log).toMatch(/第一页\s+2026年10月2日/)
      expect(log).toMatch(exactTextPattern(`熬得最晚的一夜 2026年10月2日${currentClock}`))
      await ui.unmount()
    }
  })

  // 10-15 (owner): her vibe check takes page 3 whole and the day's omen left it; /coco vibe opens the page and draws nothing.
  test('page 3 has no omen to draw, and /coco vibe opens it without drawing one', async ($, on) => {
    const setupWorld=world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    await ui.press({ key: 'coco:book:tab:omen' })
    await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'coco:omen:draw' })).toBeUndefined()
    await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
    await ui.redraw()
    expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.alt).startsWith('fortune slip: '))).toBe(false)
  })

  test('the offering box page: the figure, the limits, the cost, redrawn when they move', async ($, on) => {
    const w = world(on, { store: RECENT, percent: 56, limits: LIMITS, cost: 1.84 })
    await $.session.start(START); await settleLegacyStart($,w);
    await open($, 'usage')
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
    await $.session.start(START); await settleLegacyStart($,w);
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    await $.turn.complete({ answer: 'Fixed.', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
    await open($, 'log')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    const log = await pageText(ui)
    expect(log).toMatch(/Pages read together\s+42/)
    expect(log).toMatch(/The wild soul came out\s+once/)
    expect(log).toMatch(/First page\s+Oct 2, 2026/)
  })

  test('the latest night is kept: a turn at 03:12 beats one at 01:40, one at noon changes nothing', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
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
    expect(await pageText(ui)).toMatch(/Latest night\s+3:12\s?AM on Oct 4, 2026/)
  })

  test('the book follows the language', async ($, on) => {
    const setupWorld=world(on, { store: RECENT, env: { LANG: 'ja_JP.UTF-8' } })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await open($)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Button', text: 'Coco' })).toBeDefined() // her itabag's first page in Japanese
  })

  test('/coco with a word it does not know still lists the commands', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($,w);
    await open($, 'whatever')
    expect(w.toasts.at(-1)).toContain('/coco')
  })
})

describe('his marks on the engine rows', () => {
  test("his name stands above the first words of a desktop turn, the engine's row kept whole", async ($, on) => {
    const setupWorld=world(on, { stepText: 'Done.', store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await beginText($)
    const first = await $.ui.mount({ surface: 'desktop', ...REPLY })
    const tree = (await first.drawn()) as { children?: unknown[] }
    expect(tree.children?.[1]).toEqual(ENGINE)
    expect(await first.find({ type: 'Text', text: '✻ Coco' })).toBeDefined()
    const later = await $.ui.mount({ surface: 'desktop', ...REPLY, props: { ...REPLY.props, isFirstOfReply: false } })
    expect(await later.drawn()).toEqual(ENGINE)
    const terminal = await $.ui.mount({ surface: 'terminal', ...REPLY })
    expect(await terminal.drawn()).toEqual(ENGINE)
  })

  test('by default your prompts stay as the engine draws them; his name stays above his replies', async ($, on) => {
    const setupWorld=world(on, { store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    expect(await (await $.ui.mount({ surface: 'desktop', ...prompt('composer') })).drawn()).toEqual(ENGINE)
  })

  test('with marks on, your name stands above your own prompts; a notification keeps only the engine\'s marking', async ($, on) => {
    const setupWorld=world(on, { store: { ...RECENT, marks: 'on' }, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
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
    const setupWorld=world(on, { store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const card = await $.ui.mount({ surface: 'desktop', ...ASK })
    const tree = (await card.drawn()) as { children?: unknown[] }
    expect(tree.children?.[1]).toEqual(ENGINE)
    expect(await card.find({ type: 'Text', text: /✻ Coco\s+\(waiting for your answer\)/ })).toBeDefined()
  })

  test('P1 Italian compact mark keeps every word in separately wrapping cue and direction at 280px', async ($, on) => {
    const setupWorld = world(on, { store: { ...RECENT, marks: 'on' }, env: { LANG: 'it_IT.UTF-8' }, engineRows: true })
    await $.session.start(START); await settleLegacyStart($, setupWorld)
    const ui = await $.ui.mount({ surface: 'desktop', ...output('compact', false), viewport: { columns: 35, rows: 48 } })
    const tree = await ui.drawn() as any
    const flatten = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(flatten)]
    const text = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('')
    const name = `✻ ${WORDS.it.name}`
    const direction = ` ${WORDS.it.marks.swept}`
    expect(text(tree)).toContain(name + direction)
    const row = flatten(tree).find(node => node.type === 'Box' && node.props?.flexDirection === 'row' && node.props?.flexWrap === 'wrap'
      && (node.children ?? []).some((child: any) => text(child) === name)
      && (node.children ?? []).some((child: any) => text(child) === direction))
    expect(row, '280px compact mark must wrap the full direction independently of its name').toBeDefined()
    expect(await ui.find({ type: 'Text', text: direction })).toBeDefined()
    expect(tree.children?.[0]).toEqual(ENGINE)
    await ui.unmount()
  })

  test("/compact's row gets one line under it; an errored one, or any other command's, none", async ($, on) => {
    const setupWorld=world(on, { store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const swept = await $.ui.mount({ surface: 'desktop', ...output('compact', false) })
    const tree = (await swept.drawn()) as { children?: unknown[] }
    expect(tree.children?.[0]).toEqual(ENGINE)
    expect(await swept.find({ type: 'Text', text: /squashing the box flat/ })).toBeDefined()
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
    await $.session.start(START); await settleLegacyStart($,w);
    await $.ui.mount({ surface: 'desktop', ...STEP('Working') })
    expect(word).toBe(w.view().verb)
    await $.ui.mount({ surface: 'desktop', ...STEP('Creating notes.md') })
    expect(word).toBe('Creating notes.md')
  })

  test('one switch takes every mark away, and back', async ($, on) => {
    let word = ''
    const setupWorld=world(on, {
      stepText: 'Done.',
      store: { ...RECENT, marks: 'on' },
      engineRows: true,
      onRender: (component, props) => {
        if (component === 'Spinner') word = (props as { word: string }).word
      },
    })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    await beginText($)
    await open($, 'settings')
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    expect(await pageText(book)).toMatch(/Marks in the conversation\s+Now:[\s\u00a0]Coco's[\s\u00a0]and[\s\u00a0]yours/)
    await book.press({ key: 'coco:set:marks:off' })
    await book.redraw()
    expect(await pageText(book)).toMatch(/Marks in the conversation\s+Now:[\s\u00a0]Off/)
    for (const row of [REPLY, prompt('composer'), ASK, output('compact', false)]) {
      expect(await (await $.ui.mount({ surface: 'desktop', ...row })).drawn()).toEqual(ENGINE)
    }
    await $.ui.mount({ surface: 'desktop', ...STEP('Working') })
    expect(word).toBe('Working')
    await $.command.run({ command: 'coco', args: 'marks on', origin: PERSON, presentation: P })
    await beginText($, 'marks-on-turn')
    const reply = await $.ui.mount({ surface: 'desktop', ...REPLY })
    expect(await reply.find({ type: 'Text', text: '✻ Coco' })).toBeDefined()
  })

  test('the footer names a mode only while his voice is full', async ($, on) => {
    let modes: readonly string[] = []
    const setupWorld=world(on, {
      store: RECENT,
      onRender: (component, props) => {
        if (component === 'SessionMode') modes = (props as { modes: readonly string[] }).modes
      },
    })
    await $.session.start(START); await settleLegacyStart($,setupWorld);
    const footer = { plugin: 'coco', component: 'SessionMode' as const, props: { modes: ['focus'] } }
    await $.ui.mount({ surface: 'desktop', ...footer })
    expect(modes).toEqual(['focus'])
    await $.command.run({ command: 'coco', args: 'voice full', origin: PERSON, presentation: P })
    await $.ui.mount({ surface: 'desktop', ...footer })
    expect(modes).toEqual(['focus', "coco's voice"])
  })

  test('a hundred unrecorded history reply rows read no state', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: RECENT, engineRows: true })
    await $.session.start(START); await settleLegacyStart($,w);
    const before = w.stateReads
    for (let i = 0; i < 100; i++) {
      const row = await $.ui.mount({ surface: 'desktop', ...REPLY, requestId: `m${i}` })
      await row.unmount()
    }
    expect(w.stateReads - before).toBe(0)
  })
})
