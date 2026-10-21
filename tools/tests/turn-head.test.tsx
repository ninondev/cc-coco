// Main-agent text arming, persisted snapshots, family writes and redraw scope.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { OLDER_HEAD_DIRECTION } from '../hooks/transcript'
import { WORDS } from '../hooks/words'
import type { DrawnKey } from '../hooks/words'
import { desktopRenderReceipts } from './desktop-render-receipts'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { EXTRA_HEAD_SVG, HEAD_ALIAS } from '../hooks/head-art'
import { WINDOWS_ROOTS } from './test-system'
import { HEAD_CAP, TurnLedger, headAddress, headKey } from '../hooks/turn-ledger'
import { MORNING, RECENT, band, desktopPicture, world, settleLegacyStart } from './world'

const C3_WORDS=JSON.parse(C3_WORDS_RAW)
const readC3=(path:string)=>path.endsWith('c3-text.json')?C3_WORDS_RAW:path.endsWith('frame-manifest.json')?JSON.stringify(C3_HEAD_MANIFEST):undefined
const ENGINE = { type: 'engine', ref: 0 }

// Exact visible tree/props; handler identities can change on host re-entry.
function visibleContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(visibleContent)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'handle')
    .map(([key, item]) => [key, visibleContent(item)]))
}
const START = { cwd: '/tmp/b4-heads', surface: 'vscode' as const, isInteractive: true }
const STEP = { turnId: 't1', index: 0, model: 'claude', messageCount: 1 }
function reply(requestId: string, isFirstOfReply = true) {
  return { plugin: 'coco', component: 'AssistantMessage' as const, requestId,
    props: { text: `native words ${requestId}`, isFirstOfReply }, viewport: { columns: 100, rows: 48 } }
}
// The legacy world groups state only by key; these tests model the family's id.
function family(on: On) {
  const cells = new Map<string, { value: any; version: number }>()
  const reads: string[] = [], writes: string[] = []
  on('state.get', { key: 'head' }, async ($, e, next) => {
    await next(e)
    reads.push(e.id!); const c = cells.get(e.id!)
    return { value: { value: c?.value, version: c?.version ?? 0 } } as never
  })
  on('state.set', { key: 'head' }, async ($, e, next) => {
    const result = await next(e)
    writes.push(e.id!); const version = result.value?.version ?? (cells.get(e.id!)?.version ?? 0) + 1
    cells.set(e.id!, { value: e.value, version })
    return result
  })
  return { cells, reads, writes }
}
async function step($: any, turnId = 't1', agentId?: string) {
  for await (const _ of $.turn.step({ ...STEP, turnId, ...(agentId ? { agentId } : {}) })) {}
}
function complete(turnId: string, reason: 'answer' | 'error' | 'aborted' | 'refusal' = 'answer', answer = 'Done.') {
  return { turnId, reason, answer, durationMs: 1200, isAborted: reason === 'aborted',
    ...(reason === 'refusal' ? { refusal: { category: null, explanation: null } } : {}) }
}

describe('B4 one frozen head per main turn', () => {
  test('immutable head addresses preserve two sessions that completed from the same stale store snapshot', () => {
    const first = new TurnLedger(), second = new TurnLedger()
    first.restore([], MORNING); second.restore([], MORNING)
    first.start('a-turn', MORNING); first.arm('a-turn'); first.request('a:head/%', 'think')
    second.start('b-turn', MORNING); second.arm('b-turn'); second.request('b:head/%', 'work')
    const a = first.settle(complete('a-turn'), MORNING)!, b = second.settle(complete('b-turn', 'error'), MORNING)!
    const store = new Map<string, unknown>()
    store.set(headKey(MORNING, 'session:a/%', a.id), first.entries[0])
    store.set(headKey(MORNING, 'session:b/%', b.id), second.entries[0])
    expect(store.size).toBe(2)
    expect([...store.keys()].map(headAddress)).toEqual([
      { session: 'session:a/%', id: 'a:head/%' }, { session: 'session:b/%', id: 'b:head/%' },
    ])
    const resumed = new TurnLedger(); resumed.restore([...store.values()], MORNING)
    expect(resumed.heads.get(a.id)?.mood).toBe('happy')
    expect(resumed.heads.get(b.id)?.mood).toBe('error')
    expect(HEAD_CAP).toBe(600)
  })
  test('mixed legacy and v2 history gives only the actual current newest head a book button', async ($, on) => {
    const v2 = headKey(MORNING - 1000, 'current-session', 'v2-newest')
    world(on, { store: { ...RECENT, heads: [['legacy-last', 'error', MORNING - 2000, 800]],
      [v2]: ['v2-newest', 'happy', MORNING - 1000, 900] }, sessionId: 'current-session', engineRows: true })
    family(on)
    await $.session.start(START)
    const old = await $.ui.mount({ surface: 'vscode', ...reply('legacy-last') })
    const newest = await $.ui.mount({ surface: 'vscode', ...reply('v2-newest') })
    if (OLDER_HEAD_DIRECTION === 'none') expect(await old.find({ text: WORDS.en.aside.error })).toBeUndefined()
    else expect(await old.find({ text: WORDS.en.aside.error })).toBeDefined()
    expect(await old.find({ key: 'coco:book:open' })).toBeUndefined()
    expect(await newest.find({ key: 'coco:book:open' })).toBeDefined()
  })
  test('same-millisecond settlements restore the actual last turn rather than the lexical reply ID', async ($, on) => {
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    const w = world(on, { stepText: 'first words', store: RECENT, sessionId: 'same-clock-session', engineRows: true })
    const f = family(on)
    await $.session.start(START)
    for (const id of ['z-earlier', 'a-newest']) {
      await $.turn.start({ turnId: id, text: 'go' }); await step($, id)
      const row = await $.ui.mount({ surface: 'vscode', ...reply(id) })
      await $.turn.complete(complete(id)); await row.drawn(); await row.unmount()
    }
    await $.session.end({ reason: 'resume', sessionId: 'same-clock-session', resume: { id: 'same-clock-session' } })
    f.cells.clear(); w.resetHostState()
    const older = await $.ui.mount({ surface: 'vscode', ...reply('z-earlier') })
    const newest = await $.ui.mount({ surface: 'vscode', ...reply('a-newest') })
    expect(await older.find({ key: 'coco:book:open' })).toBeUndefined()
    expect(await newest.find({ key: 'coco:book:open' })).toBeDefined()
    expect(f.cells.size).toBe(0) // restoring rows must not rewrite state or the stored measured times
  })
  test('a completion held at native head publication persists under its original session after resume switches identity', async ($, on) => {
    let sessionId = 'held-old-session', hold = false
    let release!: () => void, begin!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const began = new Promise<void>(resolve => { begin = resolve })
    const writes: { key: string; value: unknown }[] = []
    on('session.id', () => ({ value: sessionId }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    on('state.set', { key: 'head', id: 'held-old-head' }, async ($, e, next) => {
      if (hold) { hold = false; begin(); await waiting }
      return next(e) // retain native family publication and mounted subscriptions
    })
    on('store.set', { key: /^heads:v2:/ }, ($, e, next) => { writes.push({ key: e.key, value: e.value }); return next(e) })
    const w = world(on, { stepText: 'first words', store: RECENT, engineRows: true }); const f = family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 'held-old-turn', text: 'go' }); await step($, 'held-old-turn')
    const old = await $.ui.mount({ surface: 'vscode', ...reply('held-old-head') })
    hold = true
    const pending = $.turn.complete(complete('held-old-turn', 'error'))
    await began
    try {
      expect(writes).toEqual([])
      await $.session.end({ reason: 'resume', sessionId, resume: { id: sessionId } })
      sessionId = 'held-new-session'; f.cells.clear(); w.resetHostState()
      await $.turn.start({ turnId: 'held-new-turn', text: 'go' }); await step($, 'held-new-turn')
      const current = await $.ui.mount({ surface: 'vscode', ...reply('held-new-head') })
      expect(await current.find({ key: 'coco:book:open' })).toBeDefined()
    } finally { release() }
    await pending; await old.unmount()
    await $.turn.complete(complete('held-new-turn'))
    expect(writes.map(row => headAddress(row.key))).toEqual([
      { session: 'held-old-session', id: 'held-old-head' }, { session: 'held-new-session', id: 'held-new-head' },
    ])
    expect(writes.map(row => row.value)).toEqual([
      ['held-old-head', 'error', MORNING, 1200], ['held-new-head', 'happy', MORNING, 1200],
    ])
  })
  test('a failed persisted-head read never lets that historical row claim the current turn', async ($, on) => {
    const saved = headKey(MORNING - 1000, 'old-session', 'unreadable-old')
    on('store.get', { key: saved }, () => ({ deny: 'fixture saved head cannot be read' } as never))
    world(on, { stepText: 'first words', store: { ...RECENT, [saved]: ['unreadable-old', 'error', MORNING - 1000, 800] }, engineRows: true })
    family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    expect(await (await $.ui.mount({ surface: 'vscode', ...reply('unreadable-old') })).drawn()).toEqual(ENGINE)
    const current = await $.ui.mount({ surface: 'vscode', ...reply('actual-new-head') })
    expect(await current.find({ key: 'coco:book:open' })).toBeDefined()
    expect(await current.find({ text: WORDS.en.aside.think })).toBeDefined()
  })
  for (const drawnBeforeTurn of [true, false]) test(`same-session resume, previous newest drawn ${drawnBeforeTurn ? 'before' : 'after'} arming: exactly one current book button`, async ($, on) => {
    const saved = headKey(MORNING - 1000, 'source-session', 'resumed-newest')
    world(on, { stepText: 'first words', store: { ...RECENT, [saved]: ['resumed-newest', 'error', MORNING - 1000, 800] }, sessionId: 'source-session', engineRows: true })
    family(on)
    await $.session.start(START)
    let previous: Awaited<ReturnType<typeof $.ui.mount>> | undefined
    if (drawnBeforeTurn) {
      previous = await $.ui.mount({ surface: 'vscode', ...reply('resumed-newest') })
      expect(await previous.find({ key: 'coco:book:open' })).toBeDefined()
    }
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    previous ??= await $.ui.mount({ surface: 'vscode', ...reply('resumed-newest') })
    const current = await $.ui.mount({ surface: 'vscode', ...reply('new-main-head') })
    expect(await previous.find({ key: 'coco:book:open' })).toBeUndefined()
    if (OLDER_HEAD_DIRECTION === 'none') expect(await previous.find({ text: WORDS.en.aside.error })).toBeUndefined()
    else expect(await previous.find({ text: WORDS.en.aside.error })).toBeDefined()
    expect(await current.find({ key: 'coco:book:open' })).toBeDefined()
  })
  for (const reason of ['clear', 'resume'] as const) test(`${reason}: an identity switch resets seen rows and persists the next head under the new session`, async ($, on) => {
    let sessionId = 'before-session'
    const writes: { key: string; value: unknown }[] = []
    on('session.id', () => ({ value: sessionId }))
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    on('store.set', { key: /^heads:v2:/ }, ($, e, next) => { writes.push({ key: e.key, value: e.value }); return next(e) })
    const w = world(on, { stepText: 'first words', store: RECENT, engineRows: true }); const f = family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 'first-turn', text: 'go' }); await step($, 'first-turn')
    const first = await $.ui.mount({ surface: 'vscode', ...reply('old-head') })
    await $.turn.complete(complete('first-turn', 'error')); await first.drawn(); await first.unmount()
    const seen = await $.ui.mount({ surface: 'vscode', ...reply('next-head') })
    expect(await seen.drawn()).toEqual(ENGINE); await seen.unmount()
    await $.session.end({ reason, sessionId, resume: { id: sessionId } })
    sessionId = 'after-session'; f.cells.clear(); w.resetHostState()
    await $.turn.start({ turnId: 'next-turn', text: 'go' }); await step($, 'next-turn')
    const fresh = await $.ui.mount({ surface: 'vscode', ...reply('next-head') })
    expect(await fresh.find({ key: 'coco:book:open' })).toBeDefined()
    await $.turn.complete(complete('next-turn'))
    expect(writes.map(row => headAddress(row.key))).toEqual([
      { session: 'before-session', id: 'old-head' }, { session: 'after-session', id: 'next-head' },
    ])
    expect(writes.map(row => row.value)).toEqual([
      ['old-head', 'error', MORNING, 1200], ['next-head', 'happy', MORNING, 1200],
    ])
  })
  for (const [arrival, toolsFirst, mood] of [[true, false, 'wave'], [false, false, 'think'], [false, true, 'work']] as const) {
    // SPEC 6.4: the first remote head uses the newest tool; SPEC 6.2 holds the band's prior pose for 1200 ms.
    test(`opening ${mood}: direction reflects arrival or the actual first activity`, async ($, on) => {
      const w=world(on, { stepText: 'first words', store: arrival ? {} : RECENT, engineRows: true, readText:readC3, settings: { prefersReducedMotion: true } }); family(on)
      await $.session.start({...START,surface:toolsFirst?'desktop':'vscode'})
      if(toolsFirst)await settleLegacyStart($,w)
      await $.turn.start({ turnId: 't1', text: 'go' })
      const liveBand=toolsFirst?await $.ui.mount({surface:'desktop',...band(100,true)}):undefined
      if (toolsFirst) await $.tool.call({ tool: 'Read', file_path: '/tmp/b4-source' })
      await step($)
      const ui = await $.ui.mount({ surface: 'vscode', ...reply('opening-head') })
      expect(await ui.find({ text: toolsFirst?C3_WORDS['aside.scroll'].en:WORDS.en.aside[mood] })).toBeDefined()
      const picture=await ui.find({type:'Svg'})
      expect(picture?.props).toMatchObject({ alt: '', width: 35, height: 32 })
      if(toolsFirst){
        // the reading pose's head is hers, the one her scroll-a still shares with search-a (head-art.ts)
        const png=(source:string)=>/href="data:image\/png;base64,([^"]+)"/.exec(source)?.[1]
        expect(png(String(picture?.props.source))).toBe(png(EXTRA_HEAD_SVG[HEAD_ALIAS['scroll-a']!]!))
        const held=[{at:w.clock.now()-MORNING,pose:w.view().pose?.name}],frozenHead=visibleContent(await ui.drawn())
        expect(w.view().pose?.name).toBe('think')
        // the desktop names the picture it draws, her work at the computer (owner 10-18: 「小字跟着画面走」)
        expect(String((await desktopPicture(liveBand!))?.props.alt)).toContain(WORDS.en.drawn.work.slice(1,-1))
        await w.clock.advance(1199);await settleLegacyStart($,w);expect(w.view().pose?.name).toBe('think')
        expect(String((await desktopPicture(liveBand!))?.props.alt)).toContain(WORDS.en.drawn.work.slice(1,-1));held.push({at:w.clock.now()-MORNING,pose:w.view().pose?.name})
        await w.clock.advance(1);await settleLegacyStart($,w);expect(w.view().pose?.name).toBe('lookup') // Text streamed after Read is the latest request: he looks up while Claude writes (owner 10-09 08:4x).
        expect(String((await desktopPicture(liveBand!))?.props.alt)).toContain(WORDS.en.drawn.work.slice(1,-1));held.push({at:w.clock.now()-MORNING,pose:w.view().pose?.name})
        expect(await ui.find({text:C3_WORDS['aside.scroll'].en})).toBeDefined();expect(visibleContent(await ui.drawn())).toEqual(frozenHead)
        console.log('C3_B4_HOLD_TRACE '+JSON.stringify({headSurface:'vscode',headFrame:'scroll-a',bandSurface:'desktop',held}))
      }
    })
  }
  test('marks off hides heads while retaining their truthful turn records', async ($, on) => {
    world(on, { stepText: 'first words', store: { ...RECENT, marks: 'off' }, engineRows: true }); const f = family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    expect(await (await $.ui.mount({ surface: 'vscode', ...reply('hidden-head') })).drawn()).toEqual(ENGINE)
    await $.turn.complete(complete('t1'))
    expect(f.cells.get('hidden-head')?.value).toMatchObject({ mood: 'happy' })
  })
  test('failed settlement uses the fresh ledger outcome rather than a preexisting family value', async ($, on) => {
    let deny = false
    on('state.set', { key: 'head', id: 'failed-settle' }, ($, e, next) => deny ? { value: { isSet: false, version: 1 } } : next(e))
    world(on, { stepText: 'first words', store: RECENT, engineRows: true,
      initialState: { 'head:failed-settle': { mood: 'happy', newest: true } } }); family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    const ui = await $.ui.mount({ surface: 'vscode', ...reply('failed-settle') })
    expect(await ui.find({ text: WORDS.en.aside.happy })).toBeDefined()
    deny = true
    await $.turn.complete(complete('t1', 'error'))
    expect(await ui.find({ text: WORDS.en.aside.error })).toBeDefined()
    expect(await ui.find({ text: WORDS.en.aside.happy })).toBeUndefined()
  })
  test('failed demotion still removes the old button after its family cell had settled successfully', async ($, on) => {
    let deny = false
    on('state.set', { key: 'head', id: 'failed-demote' }, ($, e, next) => deny ? { value: { isSet: false, version: 1 } } : next(e))
    world(on, { stepText: 'first words', store: RECENT, engineRows: true }); family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    const old = await $.ui.mount({ surface: 'vscode', ...reply('failed-demote') })
    await $.turn.complete(complete('t1'))
    expect(await old.find({ key: 'coco:book:open' })).toBeDefined()
    deny = true
    await $.turn.start({ turnId: 't2', text: 'go' }); await step($, 't2')
    const fresh = await $.ui.mount({ surface: 'vscode', ...reply('fresh-head') })
    expect(await old.find({ key: 'coco:book:open' })).toBeUndefined()
    expect(await fresh.find({ key: 'coco:book:open' })).toBeDefined()
    if (OLDER_HEAD_DIRECTION === 'all') expect(await old.find({ text: WORDS.en.aside.happy })).toBeDefined()
    else expect(await old.find({ text: WORDS.en.aside.happy })).toBeUndefined()
    expect(await old.find({ text: WORDS.en.name })).toBeDefined()
    expect(await old.find({ type: 'Svg' })).toBeDefined()
  })
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    test(`${surface}: first main text arms one head, tool reply steps and old rows never claim another`, async ($, on) => {
      world(on, { stepText: 'first words', store: RECENT, engineRows: true, settings: { prefersReducedMotion: true } })
      family(on)
      await $.session.start({ ...START, surface })
      const old = await $.ui.mount({ surface, ...reply('old') })
      expect(await old.drawn()).toEqual(ENGINE)
      await $.turn.start({ turnId: 't1', text: 'go' })
      const early = await $.ui.mount({ surface, ...reply('early') })
      expect(await early.drawn()).toEqual(ENGINE)
      await step($, 't1', 'subagent')
      expect(await (await $.ui.mount({ surface, ...reply('subagent-first') })).drawn()).toEqual(ENGINE)
      await step($)
      await old.redraw()
      expect(await old.drawn()).toEqual(ENGINE)
      const head = await $.ui.mount({ surface, ...reply('head-1') })
      expect(await head.find({ text: WORDS.en.name })).toBeDefined()
      expect((await head.findAll({ type: 'Svg' })).length).toBe(surface === 'desktop' ? 0 : 1)
      await $.tool.call({ tool: 'Read', file_path: '/tmp/b4-source' })
      await step($)
      expect(await (await $.ui.mount({ surface, ...reply('tool-step') })).drawn()).toEqual(ENGINE)
      await $.turn.complete(complete('t1'))
      if (surface !== 'desktop') expect(await head.find({ text: WORDS.en.aside.happy })).toBeDefined()
    })
  }
  test('terminal keeps native replies; desktop with band off gets the complete head', {options:{band:'off'}}, async ($, on) => {
    const w=world(on, { stepText: 'first words', store: { ...RECENT, band: 'off' }, engineRows: true }); family(on)
    await $.session.start(START); await settleLegacyStart($,w)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    const desktop = await $.ui.mount({ surface: 'desktop', ...reply('head-1') })
    expect(await desktop.find({ type: 'Svg' })).toBeDefined()
    expect(await desktop.find({ type: 'Button', key: 'coco:book:open' })).toBeDefined()
    expect(await (await $.ui.mount({ surface: 'terminal', ...reply('head-1') })).drawn()).toEqual(ENGINE)
  })
  test('one main reply retains the same head when the session is drawn on desktop, VS Code and mobile', async ($, on) => {
    world(on, { stepText: 'first words', store: RECENT, engineRows: true }); const f = family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    const rows = []
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const row = await $.ui.mount({ surface, ...reply('shared-head') })
      expect(await row.find({ text: WORDS.en.name })).toBeDefined()
      rows.push(row)
    }
    await $.turn.complete(complete('t1', 'error'))
    expect(f.writes).toEqual(['shared-head'])
    for (const row of rows) if (row.surface !== 'desktop') expect(await row.find({ text: WORDS.en.aside.error })).toBeDefined()
  })
  for (const [reason, answer, mood] of [
    ['answer', 'Done.', 'happy'], ['answer', "You're absolutely right.", 'flustered'],
    ['error', '', 'error'], ['aborted', '', 'flustered'], ['refusal', '', 'refuse'],
  ] as const) {
    test(`${reason}/${mood}: exactly one settle uses the band's semantic outcome`, async ($, on) => {
      world(on, { stepText: 'first words', store: RECENT, engineRows: true }); const f = family(on)
      await $.session.start(START)
      await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
      const ui = await $.ui.mount({ surface: 'vscode', ...reply('outcome-head') })
      expect(f.writes).toEqual([]) // drawing must not publish state
      await $.turn.complete(complete('t1', reason, answer))
      expect(f.cells.get('outcome-head')?.value).toMatchObject({ mood, newest: true, ms: 1200 })
      expect(f.writes).toEqual(['outcome-head'])
      expect(await ui.find({ text: WORDS.en.aside[mood] })).toBeDefined()
    })
  }
  test('newest button moves once; settled heads read only their own family and ignore future moods', async ($, on) => {
    let renders = 0
    world(on, { stepText: 'first words', store: RECENT, engineRows: true, settings: { prefersReducedMotion: true }, onRender: c => { if (c === 'AssistantMessage') renders++ } })
    const f = family(on)
    await $.session.start(START)
    await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
    const first = await $.ui.mount({ surface: 'vscode', ...reply('head-1') })
    await $.turn.complete(complete('t1'))
    expect(await first.find({ key: 'coco:book:open' }), 'first button after settlement').toBeDefined()
    await $.turn.start({ turnId: 't2', text: 'next' }); await step($, 't2')
    const second = await $.ui.mount({ surface: 'vscode', ...reply('head-2') })
    expect(await first.find({ key: 'coco:book:open' })).toBeUndefined()
    expect(await second.find({ key: 'coco:book:open' }), 'new head button after prior demotion').toBeDefined()
    await $.turn.complete(complete('t2', 'error'))
    await second.drawn() // drain the second turn's own required settlement draw
    const firstTree = await first.drawn(), before = renders, writes = f.writes.slice()
    const secondContent=visibleContent(await second.drawn())
    for (let n = 0; n < 5; n++) {
      await $.turn.start({ turnId: `mood-${n}`, text: 'next' })
      expect(await first.drawn()).toEqual(firstTree)
      expect(visibleContent(await second.drawn())).toEqual(secondContent)
      expect(renders).toBe(before+2*(n+1)) // each observed publication re-enters both rows
      expect(f.writes).toEqual(writes)
      expect(f.cells.get('head-1')?.value).toMatchObject({ mood: 'happy', newest: false })
      expect(f.reads.every(id => id === 'head-1' || id === 'head-2')).toBe(true)
    }
    expect(await first.drawn()).toEqual(firstTree)
    expect(renders).toBe(before+10)
    expect(f.writes).toEqual(writes)
    expect(f.cells.get('head-1')?.value).toMatchObject({ mood: 'happy', newest: false })
    expect(f.reads.every(id => id === 'head-1' || id === 'head-2')).toBe(true)
  })
  for (const source of ['resume', 'fork'] as const) {
    test(`${source}: only recorded IDs restore settled heads; immutable records retain cap600 without replacing another session`, async ($, on) => {
      const records = Array.from({ length: 600 }, (_, i) => [`history-${i}`, i === 599 ? 'error' : 'happy', MORNING - 10000 + i, 1000])
      const stored = Object.fromEntries(records.map(row => [headKey(row[2] as number, 'source-session', row[0] as string), row]))
      const writes: { key: string; value: unknown }[] = [], deleted: string[] = [], legacyWrites: unknown[] = []
      on('store.set', { key: /^heads:v2:/ }, ($, e, next) => { writes.push({ key: e.key, value: e.value }); return next(e) })
      on('store.set', { key: 'heads' }, ($, e, next) => { legacyWrites.push(e.value); return next(e) })
      on('store.delete', { key: /^heads:v2:/ }, ($, e, next) => { deleted.push(e.key); return next(e) })
      world(on, { stepText: 'first words', store: { ...RECENT, ...stored }, engineRows: true }); family(on)
      on('session.id', () => ({ value: `b4-${source}` }))
      on('classic.SessionStart', () => ({}))
      await $.classic.SessionStart({ source, session_id: `b4-${source}`, cwd: START.cwd })
      await $.session.start(START)
      expect(await (await $.ui.mount({ surface: 'vscode', ...reply('not-recorded') })).drawn()).toEqual(ENGINE)
      const old = await $.ui.mount({ surface: 'vscode', ...reply('history-0') })
      if (OLDER_HEAD_DIRECTION === 'all') expect(await old.find({ text: WORDS.en.aside.happy })).toBeDefined()
      else expect(await old.find({ text: WORDS.en.aside.happy })).toBeUndefined()
      expect(await old.find({ text: WORDS.en.name })).toBeDefined()
      expect(await old.find({ type: 'Svg' })).toBeDefined()
      expect(await old.find({ key: 'coco:book:open' })).toBeUndefined()
      await $.turn.start({ turnId: 't1', text: 'go' }); await step($)
      await $.ui.mount({ surface: 'vscode', ...reply('new-head') })
      await $.turn.complete(complete('t1'))
      expect(writes.length).toBe(1)
      expect(writes[0]?.value).toEqual(['new-head', 'happy', MORNING, 1200])
      expect(headAddress(writes[0]!.key)).toEqual({ session: `b4-${source}`, id: 'new-head' })
      expect(deleted).toEqual([headKey(MORNING - 10000, 'source-session', 'history-0')])
      expect(600 + writes.length - deleted.length).toBe(600)
      expect(legacyWrites).toEqual([])
    })
  }
  // The host invalidates all render callbacks. B1b's own synchronous desktop
  // branch omits downstream dispatch; own redraws and frozen rows are measured separately.
  // SPEC 6.2: Read keeps the band's think pose for its 1200 ms hold; B4 frozen row content survives every publication.
  for (const transcriptSurface of ['desktop', 'vscode', 'mobile'] as const) test(`${transcriptSurface}: 50 reply and 50 tool rows retain their exact content across five band publications`, { timeoutMs: 60_000 }, async ($, on) => {
    const receipts=desktopRenderReceipts(on)
    let counting=false, globalInvalidations=0
    on('ui.invalidate',($,e,next)=>{if(counting)globalInvalidations++;return next(e)})
    const counts = { replies: 0, tools: 0, band: 0 }
    const heads = Array.from({ length: 50 }, (_, i) => [`unchanged-${i}`, 'error', MORNING - 1000 + i, 1200])
    heads.push(['sentinel-newest', 'happy', MORNING, 1200])
    const w=world(on, { stepText: 'first words', store: { ...RECENT, heads }, engineRows: true, readText:readC3, settings: { prefersReducedMotion: true }, onRender: c => {
      if (c === 'AssistantMessage') counts.replies++
      if (c === 'ToolUse') counts.tools++
      if (c === 'AbovePrompt') counts.band++
    } }); family(on)
    await $.session.start(START); await settleLegacyStart($,w)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const rows: { ui: Awaited<ReturnType<typeof $.ui.mount>>; content: unknown }[] = []
    for (let i = 0; i < 50; i++) {
      const head = await $.ui.mount({ surface: transcriptSurface, ...reply(`unchanged-${i}`) })
      expect(await head.find({ type: 'Text', text: /Coco/ })).toBeDefined()
      if (transcriptSurface === 'vscode') expect(await head.find({ type: 'Svg' })).toBeDefined()
      expect(await head.find({ key: 'coco:book:open' })).toBeUndefined()
      rows.push({ ui: head, content: visibleContent(await head.drawn()) })
      const tool = await $.ui.mount({ surface: transcriptSurface, plugin: 'coco', component: 'ToolUse', requestId: `tool-${i}`,
        props: { tool_use_id: `tool-${i}`, tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false } })
      expect(await tool.drawn()).toEqual(ENGINE)
      rows.push({ ui: tool, content: visibleContent(await tool.drawn()) })
    }
    await w.clock.advance(0);await receipts.flush($)
    console.log('B1C_BOOTSTRAP_COUNTS '+JSON.stringify({surface:transcriptSurface,counts:{...counts},ownDesktopRenders:receipts.current(),scope:'Observed setup counts; priming is measured separately by subscription-probe'}))
    const before = { ...counts }, ownBefore=receipts.current()
    counting=true
    const invalidationPhases:number[]=[]
    const assertFrozen = async (mood: 'think'|'work'|'happy'|'error', picture: DrawnKey) => {
      await ui.drawn()
      expect(w.view().mood).toBe(mood)
      // the desktop names the picture it draws (owner 10-18: 「小字跟着画面走」)
      const shown=await desktopPicture(ui)
      expect(String(shown?.props.source)).toMatch(new RegExp(`data-coco="[AB] ${picture}"`))
      expect(shown?.props.alt).toContain(WORDS.en.drawn[picture].slice(1,-1))
      for (const row of rows) expect(visibleContent(await row.ui.drawn())).toEqual(row.content)
      invalidationPhases.push(globalInvalidations)
    }
    await $.turn.start({ turnId: 'm1', text: 'go' }); await assertFrozen('think', 'think')
    await $.tool.call({ tool: 'Read', file_path: '/tmp/b4-source' }); await assertFrozen('work', 'work')
    await $.turn.complete(complete('m1')); await assertFrozen('happy', 'done')
    await $.turn.start({ turnId: 'm2', text: 'go' }); await assertFrozen('think', 'think')
    await $.turn.complete(complete('m2', 'error')); await assertFrozen('error', 'error')
    await receipts.flush($)
    counting=false
    const measured = { replies: counts.replies - before.replies, tools: counts.tools - before.tools, band: counts.band - before.band }
    expect(receipts.available).toBe(!WINDOWS_ROOTS)
    console.log('B4_RENDER_COUNTS ' + JSON.stringify({ surface: transcriptSurface, replies: 50, tools: 50, pushes: 5, ...(receipts.available?{ownDesktopRenders:receipts.current()-ownBefore}:{ownDiagnosticUnavailable:'native Windows diagnostics disabled'}), globalInvalidations, measured }))
    if(receipts.available)expect(receipts.current()-ownBefore).toBe(5)
    expect(invalidationPhases).toEqual([0,0,0,0,0])
    expect(globalInvalidations).toBe(0)
    expect(measured).toEqual({ replies: 0, tools: 0, band: 0 })
  })
})
