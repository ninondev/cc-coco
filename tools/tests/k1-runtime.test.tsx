import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { MORNING, PERSON, RECENT, band, settleLegacyStart, world } from './world'
import { WINDOWS_ROOTS } from './test-system'
import { LANGS, WORDS } from '../hooks/words'
import { clockText, numberLocale, numberText } from '../hooks/numbers'
import { transportFixture } from './presence-transport-fixture'
import { loopColdLine, resumeColdLine } from '../hooks/cost/surfaces'
import { installCostWords } from '../hooks/cost/words'
import { quotaBandItems } from '../hooks/quota'
import { playWord } from '../hooks/play'

const MODEL = 'claude-opus-5-5'
const START = { cwd: WINDOWS_ROOTS ? 'C:\\Users\\windows\\k1-fixture' : '/tmp/k1-fixture', surface: 'vscode' as const, isInteractive: true }
const TOKENS = { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 120000, model: MODEL }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const complete = (turnId: string) => ({ turnId, answer: 'done', reason: 'answer' as const, durationMs: 1000, isAborted: false, usage: TOKENS })

function fixture(on: On, surface: 'vscode' | 'terminal' = 'vscode', options: { marks?: 'off' | 'replies'; warm?: boolean; lively?: boolean; nativePresence?: boolean; priceRead?: () => string; beforeStoreGet?: (key: string) => Promise<void> } = {}) {
  let usd = 1
  let forks = 0
  let gate: Promise<void> | undefined
  const settingsSources: (string | undefined)[] = []
  const delays: number[] = []
  const timers: { ms: number; signal: AbortSignal; settled: boolean }[] = []
  const presence = options.nativePresence ? transportFixture({ v: 1, seq: 1, quietAt: MORNING, asleep: false, clingy: false, busy: false, event: { kind: 'activity', id: 'k1-cron-presence', at: MORNING } }) : undefined
  if (presence) {
    on('session.id', () => ({ value: 'k1-ledger-fixture' }))
    on('fs.exists', { path: /^(?:\/bin\/sh|\/System\/Library\/CoreServices\/SystemVersion\.plist)$/ }, () => ({ value: true }))
    on('fs.read', { path: /\/snapshot\.json$/ }, () => ({ value: JSON.stringify(presence.state) }))
    on('fs.write', async ($, e) => { if (e.path.endsWith('/commit')) await presence.write(e.path, e.text); return { value: undefined } })
    on('process.spawn', async function* ($, e) {
      if (!e.argv.some(arg => arg.endsWith('presence.sh'))) return { value: { code: 0, signal: null } }
      const child = presence.spawn('k1-ledger-fixture', [...e.argv])
      try { while (true) { const chunk = await child.next(); if (chunk.done) return { value: chunk.value }; yield chunk.value } }
      finally { await child.return({ code: 0, signal: null }) }
    })
  }
  on('settings.*', ($, e, next) => {
    if (next.is('settings.read', e)) {
      settingsSources.push(e.source)
      if (e.source === 'policy') return { value: {} }
    }
    return next(e)
  })
  on('clock.*', async ($, e, next) => {
    if (!next.is('clock.after', e)) return next(e)
    delays.push(e.ms)
    const timer = { ms: e.ms, signal: next.signal, settled: false }; timers.push(timer)
    try { return await next(e) } finally { timer.settled = true }
  })
  on('model.fork', () => { forks++; return { value: { isAnswered: false, reason: 'disabled-fixture' } } as never })
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('algo-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      const result = request.op === 'pace' ? { projections: [], hot: { state: { hot: {} }, hot: [] } } : request.op === 'repeat' ? null : {}
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result }) } }
    }
    return { value: OK }
  })
  let firstStore = true
  // Decorate the world's actual bottom fixtures rather than appending hooks
  // after a world handler that already answers the event.
  const worldOn = ((event: string, ...args: any[]) => {
    const handler = args.pop()
    if (event === 'store.*' && firstStore) {
      firstStore = false
      return (on as any)(event, ...args, async ($: any, e: any, next: any) => {
        if (next.is('store.get', e)) await options.beforeStoreGet?.(e.key)
        return handler($, e, next)
      })
    }
    return (on as any)(event, ...args, handler)
  }) as On
  const w = world(worldOn, {
    observeStore: true,
    store: { ...RECENT, firstMet: MORNING, stamps: { met: MORNING }, marks: options.marks ?? 'off', ...(options.warm || options.lively ? { more: { ...(options.warm ? { warm: true } : {}), ...(options.lively ? { lively: true } : {}) } } : {}), bandSettings: { marks: options.marks ?? 'off', motion: 'still' } },
    sessionId: 'k1-ledger-fixture', sessionRoot: START.cwd, surfaces: [surface], percent: 60,
    cost: usd, startedAt: MORNING, stepUsage: TOKENS, stepText: 'done', stepHold: () => gate,
    limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }],
    settings: { promptCacheTtl: '5m', prefersReducedMotion: true },
    env: { HOME: '/tmp/k1-fixture-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', FORCE_PROMPT_CACHING_5M: '1' },
    readText: path => presence && path.endsWith('requests.jsonl') ? '' : presence && path.endsWith('health.json') ? JSON.stringify({ away: { state: null, since: MORNING } }) : path.endsWith('cost-text.json') ? COST_WORDS_RAW : path.endsWith('prices.json') ? options.priceRead?.() ?? SHIPPED_PRICES_RAW : path.endsWith('c3-text.json') ? C3_WORDS_RAW : undefined,
  })
  return { w, presence, delays, timers, settingsSources, cost: (value: number) => { usd = value; w.cost = value }, forks: () => forks, hold: (value: Promise<void> | undefined) => { gate = value } }
}
function closeEnough(actual: number | undefined, expected: number): void {
  expect(typeof actual).toBe('number')
  expect(Math.abs(actual! - expected)).toBeLessThan(5e-11)
}
async function start($: any, f: ReturnType<typeof fixture>, surface: 'vscode' | 'terminal' = 'vscode') {
  await $.session.start({ ...START, surface }); await settleLegacyStart($, f.w)
}
async function step($: any, turnId: string) {
  for await (const _ of $.turn.step({ turnId, index: 0, model: MODEL, messageCount: 1 })) {}
}

test('K1 real hooks keep background ledger growth outside the completed turn and preserve session totals', async ($, on) => {
  const f = fixture(on); await start($, f)
  await $.turn.start({ text: 'first', turnId: 'k1-first' }); await step($, 'k1-first')
  f.cost(1.42); await $.turn.complete(complete('k1-first'))
  closeEnough(f.w.view().cost?.lastTurn?.usd, .42)
  expect(f.w.view().cost?.sessionUSD).toBe(1.42)
  f.cost(1.57)
  await $.session.measure({ context: { window: 200000, tokens: 120000, percent: 60 }, rateLimits: [], cost: { usd: 1.57 }, changed: ['cost'] })
  expect(f.w.view().cost?.sessionUSD).toBe(1.57)
  closeEnough(f.w.view().cost?.lastTurn?.usd, .42)
  await $.turn.start({ text: 'second', turnId: 'k1-second' }); await step($, 'k1-second')
  f.cost(1.70); await $.turn.complete(complete('k1-second'))
  closeEnough(f.w.view().cost?.lastTurn?.usd, .13)
  expect(f.w.view().cost?.sessionUSD).toBe(1.70)
  const ledgers = f.w.storedEntries().filter(([key]) => key.startsWith('ledger.'))
  expect(ledgers.length).toBe(1)
  const ledger = ledgers[0]![1] as Record<string, number>
  closeEnough(Object.values(ledger).reduce((sum, value) => sum + value, 0), .70)
  expect(f.settingsSources).toContain('policy')
  expect(f.w.fileReads.some(path => path.endsWith('cost-text.json'))).toBe(true)
  expect(f.w.fileReads.some(path => path.endsWith('prices.json'))).toBe(true)
})

test('K1 real main request timestamp precedes a delayed response and default-off makes no fork', async ($, on) => {
  const f = fixture(on); await start($, f)
  await $.turn.start({ text: 'slow response', turnId: 'k1-slow' })
  let release!: () => void
  f.hold(new Promise(resolve => { release = resolve }))
  const requestedAt = f.w.clock.now(), running = step($, 'k1-slow')
  await f.w.clock.settle(); await f.w.clock.advance(61000)
  release(); await running; f.hold(undefined)
  f.cost(1.1); await $.turn.complete(complete('k1-slow'))
  expect(f.w.view().cost?.cache.sentAt).toBe(requestedAt)
  expect(f.w.view().cost?.cache.warmUntil).toBe(requestedAt + 300000)
  expect(f.w.view().cost?.cache.ttlMs).toBe(300000)
  expect(f.w.view().cost?.warmEnabled).toBe(false)
  await f.w.clock.advance(3 * 3600000); await settleLegacyStart($, f.w)
  expect(f.forks()).toBe(0)
  expect(f.w.stored('warm.today')).toBeUndefined()
  expect(f.w.stored('pauses')).toBeUndefined()
})

test('K1 real hidden band schedules no cup timers and shown band schedules the two lifetime boundaries', async ($, on) => {
  const f = fixture(on, 'terminal'); await start($, f, 'terminal')
  await $.turn.start({ text: 'cache', turnId: 'k1-cache' }); await step($, 'k1-cache')
  const hiddenAt = f.delays.length
  await $.turn.complete(complete('k1-cache'))
  expect(f.delays.slice(hiddenAt).filter(ms => ms === 200000 || ms === 300000)).toEqual([])
  const shownAt = f.delays.length
  const ui = await $.ui.mount({ surface: 'terminal', ...band(120, false) })
  // Repeated measures/completion do not replace unchanged deadlines.
  await $.turn.complete(complete('k1-cache'))
  expect(f.delays.slice(shownAt).filter(ms => ms === 200000 || ms === 300000)).toEqual([200000, 300000])
  await $.turn.start({ text: 'next', turnId: 'k1-next' })
  await f.w.clock.advance(300000)
  expect(f.forks()).toBe(0)
  await ui.unmount()
})

test('K1 real AssistantMessage viewport exit cancels cup deadlines and re-entry arms remaining lifetime', async ($, on) => {
  const f = fixture(on, 'vscode', { marks: 'replies' }); await start($, f)
  await $.turn.start({ text: 'viewport cache', turnId: 'k1-viewport' }); await step($, 'k1-viewport')
  const visible = { text: 'done', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'AssistantMessage', requestId: 'k1-viewport-reply', props: visible, viewport: { columns: 100, rows: 48 } })
  await $.turn.complete(complete('k1-viewport')); await row.redraw(visible)
  expect(f.w.view().cost?.cache.observed).toBe(true)
  expect(f.w.view().cost?.cache.deltaUSD).toBeGreaterThan(.25)
  const cupAlt = JSON.parse(COST_WORDS_RAW)['alt.cup.warm'].en.replace('{n}', '5')
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === cupAlt)).toBe(true)
  const deadlines = f.timers.filter(timer => timer.ms === 200000 || timer.ms === 300000)
  expect(deadlines.map(timer => timer.ms)).toEqual([200000, 300000])
  expect(deadlines.every(timer => !timer.signal.aborted && !timer.settled)).toBe(true)
  await f.w.clock.advance(60000)
  await row.redraw({ ...visible, onScreen: null })
  // The host may retain the offscreen tree for geometry. Timer cancellation
  // comes from the actual dispatch signals, independently of that tree.
  expect(deadlines.every(timer => timer.signal.aborted)).toBe(true)
  const beforeReentry = f.delays.length
  await f.w.clock.advance(10000); await row.redraw(visible)
  const returnedCupAlt = JSON.parse(COST_WORDS_RAW)['alt.cup.warm'].en.replace('{n}', '4')
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === returnedCupAlt)).toBe(true)
  expect(f.delays.slice(beforeReentry).filter(ms => ms === 130000 || ms === 230000)).toEqual([130000, 230000])
  const remaining = f.timers.filter(timer => timer.ms === 130000 || timer.ms === 230000)
  expect(remaining.every(timer => !timer.signal.aborted && !timer.settled)).toBe(true)
  await f.w.clock.advance(130000)
  expect(remaining.map(timer => timer.settled)).toEqual([true, false])
  await row.redraw(visible)
  const coolingAlt = JSON.parse(COST_WORDS_RAW)['alt.cup.cooling'].en.replace('{n}', '2')
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === coolingAlt)).toBe(true)
  await f.w.clock.advance(100000)
  expect(remaining.map(timer => timer.settled)).toEqual([true, true])
  await row.redraw(visible)
  const coldAlt = JSON.parse(COST_WORDS_RAW)['alt.cup.cold'].en
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === coldAlt)).toBe(true)
  expect(f.forks()).toBe(0)
  // True unmount has no plugin-facing lifecycle event in this API; this test
  // proves the explicit onScreen:null lifecycle, rather than inferring it.
  await row.unmount()
})

test('K1 cost setup failure retries without losing the turn-start engine baseline', async ($, on) => {
  let priceReads = 0
  const f = fixture(on, 'vscode', { priceRead: () => ++priceReads === 1 ? 'malformed-json-fixture' : SHIPPED_PRICES_RAW })
  await start($, f)
  await $.turn.start({ text: 'retry setup', turnId: 'k1-init-retry' })
  f.cost(1.42); await step($, 'k1-init-retry')
  expect(priceReads).toBe(1)
  expect(f.w.view().cost).toBeUndefined()
  await $.turn.complete(complete('k1-init-retry'))
  expect(priceReads).toBe(2)
  closeEnough(f.w.view().cost?.lastTurn?.usd, .42)
  expect(f.w.view().cost?.lastTurn?.estimated).toBe(false)
  expect(f.w.view().cost?.sessionUSD).toBe(1.42)
  const ledgers = f.w.storedEntries().filter(([key]) => key.startsWith('ledger.'))
  expect(ledgers.length).toBe(1)
  closeEnough(Object.values(ledgers[0]![1] as Record<string, number>).reduce((sum, value) => sum + value, 0), .42)
})

test('K1 post-constructor prices refresh failure retries without publishing a partial runtime', async ($, on) => {
  let refreshReads = 0
  const f = fixture(on, 'vscode', { beforeStoreGet: async key => { if (key === 'prices.claude' && ++refreshReads === 1) throw new Error('fixture-owned prices refresh rejection') } })
  await start($, f)
  await $.turn.start({ text: 'retry refresh', turnId: 'k1-refresh-retry' })
  f.cost(1.42); await step($, 'k1-refresh-retry')
  expect(refreshReads).toBe(1)
  expect(f.w.view().cost).toBeUndefined()
  await $.turn.complete(complete('k1-refresh-retry'))
  expect(refreshReads).toBe(2)
  closeEnough(f.w.view().cost?.lastTurn?.usd, .42)
  expect(f.w.view().cost?.lastTurn?.estimated).toBe(false)
  expect(f.w.view().cost?.sessionUSD).toBe(1.42)
  const ledgers = f.w.storedEntries().filter(([key]) => key.startsWith('ledger.'))
  expect(ledgers.length).toBe(1)
  closeEnough(Object.values(ledgers[0]![1] as Record<string, number>).reduce((sum, value) => sum + value, 0), .42)
})

test('K1 hidden AssistantMessage expiry returns cold immediately without reviving cup deadlines', async ($, on) => {
  const f = fixture(on, 'vscode', { marks: 'replies' }); await start($, f)
  await $.turn.start({ text: 'hidden expiry', turnId: 'k1-hidden-expiry' }); await step($, 'k1-hidden-expiry')
  const visible = { text: 'done', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'AssistantMessage', requestId: 'k1-hidden-expiry-reply', props: visible, viewport: { columns: 100, rows: 48 } })
  await $.turn.complete(complete('k1-hidden-expiry')); await row.redraw(visible)
  const words = JSON.parse(COST_WORDS_RAW)
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === words['alt.cup.warm'].en.replace('{n}', '5'))).toBe(true)
  const deadlines = f.timers.filter(timer => timer.ms === 200000 || timer.ms === 300000)
  expect(deadlines.map(timer => timer.ms)).toEqual([200000, 300000])
  await f.w.clock.advance(60000); await row.redraw({ ...visible, onScreen: null })
  expect(deadlines.every(timer => timer.signal.aborted)).toBe(true)
  // Both boundaries pass while the real render-instance clocks are cancelled.
  // No turn, measure, or completion event updates the published cost snapshot.
  await f.w.clock.advance(240001)
  const beforeReturn = f.timers.length
  await row.redraw(visible)
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === words['alt.cup.cold'].en)).toBe(true)
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === words['alt.cup.warm'].en.replace('{n}', '0'))).toBe(false)
  expect(f.timers.slice(beforeReturn).filter(timer => timer.ms > 0 && timer.ms <= 300000)).toEqual([])
  expect(deadlines.every(timer => timer.signal.aborted)).toBe(true)
  expect(f.forks()).toBe(0)
  await row.unmount()
})

test('K1 while a turn has run 20 seconds, the newest head shows their laptop light breathing, as the band does', async ($, on) => {
  const f = fixture(on, 'vscode', { marks: 'replies' }); await start($, f)
  await $.turn.start({ text: 'head breath', turnId: 'k1-head-breath' }); await step($, 'k1-head-breath')
  const visible = { text: 'working', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'AssistantMessage', requestId: 'k1-head-breath-reply', props: visible, viewport: { columns: 100, rows: 48 } })
  const alt = playWord('en', 'alt.incense.breathing')
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === alt)).toBe(false)
  await f.w.clock.advance(21000); await step($, 'k1-head-breath'); await f.w.clock.advance(0); await row.redraw(visible)
  expect(f.w.view().play?.breath).toBeDefined()
  expect(await row.find({ type: 'Box', key: 'coco:head:light' })).toBeDefined()
  expect((await row.findAll({ type: 'Svg' })).some(node => node.props.alt === alt)).toBe(true)
  await $.turn.complete(complete('k1-head-breath')); await f.w.clock.advance(0); await row.redraw(visible)
  expect(await row.find({ type: 'Box', key: 'coco:head:light' })).toBeUndefined()
  await row.unmount()
})

test('K1 repeated Offerings Pane redraws perform no extra usage queries or invalidations', async ($, on) => {
  const f = fixture(on, 'vscode', { marks: 'replies' })
  let invalidations = 0
  // The host does not automatically dispatch a redraw for this fixture event.
  // Explicit redraws below isolate redraw-caused work from clock/turn events.
  on('ui.invalidate', () => { invalidations++; return { value: undefined } })
  await start($, f)
  await $.turn.start({ text: 'book cup', turnId: 'k1-pane-loop' }); await step($, 'k1-pane-loop')
  const visible = { text: 'done', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'AssistantMessage', requestId: 'k1-pane-loop-reply', props: visible, viewport: { columns: 100, rows: 48 } })
  await $.turn.complete(complete('k1-pane-loop')); await row.redraw(visible)
  expect(await row.find({ type: 'Box', key: 'coco:head:cup' })).toBeDefined()
  // beside the face, their battery for the 5-hour window as on the band, at half size; no incense
  await $.session.measure({ context: { window: 200000, tokens: 120000, percent: 60 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }], changed: ['rateLimits'] })
  await row.redraw(visible)
  expect(await row.find({ type: 'Box', key: 'coco:head:quota' })).toBeDefined()
  const alt = quotaBandItems('en', [{ kind: 'five_hour', percentUsed: 40 }])[0]!.alt
  const battery = (await row.findAll({ type: 'Svg' })).find(node => node.props.alt === alt)
  expect([battery?.props.width, battery?.props.height]).toEqual([26, 12])
  expect((await row.findAll({ type: 'Svg' })).map(node => node.props.width)).toEqual([35, 26, 16])
  await $.command.run({ command: 'coco', args: 'usage', origin: PERSON, presentation: { isFullscreen: false, columns: 100 } })
  const book = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'Pane', requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  await book.redraw(); await f.w.clock.settle()
  expect(await book.find({ type: 'Button', key: 'coco:book:tab:offerings' })).toBeDefined()
  const usageReads = f.w.reads, invalidated = invalidations, timers = f.timers.length
  for (let i = 0; i < 5; i++) await book.redraw()
  expect(f.w.reads - usageReads).toBe(0)
  expect(invalidations - invalidated).toBe(0)
  expect(f.timers.length - timers).toBe(0)
  await book.unmount(); await row.unmount()
})

test('K1 wide AssistantMessage hover preserves approved cache and last-turn groups in all thirteen languages', { timeoutMs: 60000 }, async ($, on) => {
  const f = fixture(on, 'vscode', { marks: 'replies' }); await start($, f)
  await $.turn.start({ text: 'head hover', turnId: 'k1-head-hover' }); await step($, 'k1-head-hover')
  const visible = { text: 'done', isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'AssistantMessage', requestId: 'k1-head-hover-reply', props: visible, viewport: { columns: 500, rows: 48 } })
  f.w.limits = [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }]
  f.cost(1.42); await $.turn.complete(complete('k1-head-hover')); await row.redraw(visible)
  expect(f.w.view().cost?.billing.kind).toBe('plan')
  closeEnough(f.w.view().cost?.lastTurn?.usd, .42)
  expect(LANGS.length).toBe(13)
  const words = JSON.parse(COST_WORDS_RAW) as Record<string, Record<string, string>>
  const fill = (key: string, lang: string, values: Record<string, string>) => words[key]![lang]!.replace(/\{(\w+)\}/g, (_, slot: string) => values[slot] ?? '')
  for (const { code } of LANGS) {
    await $.command.run({ command: 'coco', args: `lang ${code}`, origin: PERSON, presentation: { isFullscreen: false, columns: 500 } })
    await row.redraw(visible)
    expect(f.w.view().lang).toBe(code)
    const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...(tree.children ?? []).flatMap(nodes)]
    const head = nodes(await row.drawn()).find(node => node.type === 'Box' && node.props?.key === 'coco:head:k1-head-hover-reply')
    expect(head).toBeDefined()
    const hover = nodes(head).find(node => node.type === 'Box' && node.props?.position === 'absolute' && node.props?.display === 'none')
    expect(hover).toBeDefined()
    expect(hover!.props.display).toBe('none')
    expect(hover!.props.key).toBeUndefined()
    expect(hover!.hover).toEqual({ display: 'flex' })
    const texts = (await row.findAll({ type: 'Text' })).map(node => String(node.text))
    const cache = fill('cache.hover.warm', code, { time: clockText(MORNING + 300000, code, 'UTC') })
    const money = new Intl.NumberFormat(numberLocale(code), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(.42)
    const lastTurn = fill('cost.hover.turn.plan', code, { window: WORDS[code].quota.shortKinds.five_hour, from: numberText(40, code, false, true) + '%', to: numberText(42, code, false, true) + '%', usd: money })
    expect(texts).toContain(cache)
    expect(texts).toContain(lastTurn)
    expect([cache, lastTurn].some(text => /undefined|\{\w+\}|\[object/.test(text))).toBe(false)
  }
  await row.unmount()
})

test('K1 classic cache TTL evidence survives lazy cost setup and rejects later invalid values', async ($, on) => {
  const f = fixture(on)
  on('classic.PreModelSwitch', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  await start($, f)
  const switchFields = { from_model: MODEL, to_model: MODEL, requested_model: MODEL, source: 'command' as const, context_tokens: 0, prompt_cache_warm: false, estimated_cache_write_usd: 0, pricing: 'catalog' as const }
  expect(f.w.fileReads.some(path => path.endsWith('prices.json'))).toBe(false)
  await $.classic.PreModelSwitch({ ...switchFields, cache_ttl: '1h' })
  await $.classic.PostModelSwitch({ ...switchFields, cache_ttl: 'invalid-fixture' as never })
  expect(f.w.fileReads.some(path => path.endsWith('prices.json'))).toBe(false)
  const requestedAt = f.w.clock.now()
  await $.turn.start({ text: 'one-hour evidence', turnId: 'k1-pending-ttl' }); await step($, 'k1-pending-ttl')
  await $.turn.complete(complete('k1-pending-ttl'))
  expect(f.w.view().cost?.cache.ttlMs).toBe(3600000)
  expect(f.w.view().cost?.cache.sentAt).toBe(requestedAt)
  expect(f.w.view().cost?.cache.warmUntil).toBe(requestedAt + 3600000)
  await $.classic.PreModelSwitch({ ...switchFields, cache_ttl: 'still-invalid-fixture' as never })
  expect(f.w.view().cost?.cache.ttlMs).toBe(3600000)
  expect(f.forks()).toBe(0)
})

// The same eligible pause as the positive control below, with the More row left as it ships (off): the plugin's only
// $.model.fork( call site is the keeper's, and it must never be reached while the row is off (A4: zero tokens by default).
if (!WINDOWS_ROOTS) {
test('K1 keep warm makes no model.fork while its More row is off', { timeoutMs: 20000 }, async ($, on) => {
  // M1 runs shared presence only while a More row is on; Lively stands in for one, keep warm stays off.
  const f = fixture(on, 'vscode', { nativePresence: true, lively: true })
  await start($, f)
  await $.prompt.submit({ text: 'eligible pause', origin: PERSON })
  await $.turn.start({ text: 'eligible pause', turnId: 'k1-row-off' }); await step($, 'k1-row-off')
  await $.turn.complete(complete('k1-row-off'))
  const claims = Object.values(f.presence!.state.claims) as { session?: string; lastPromptAt?: number }[]
  // Everything else the keeper needs is in place: this chat holds the newest prompt and the cache is observed.
  expect(claims.some(claim => claim.session === 'k1-ledger-fixture' && claim.lastPromptAt === MORNING)).toBe(true)
  expect(f.w.view().cost?.warmEnabled).toBe(false)
  expect(f.w.view().cost?.cache.state).toBe('warm')
  for (let i = 0; i < 36; i++) { await f.w.clock.advance(240000); await f.w.clock.settle() }
  expect(f.w.view().cost?.cache.state).not.toBe('kept')
  expect(f.w.view().cost?.cache.kept).toBeUndefined()
  expect(f.forks()).toBe(0)
})
}

// Windows native presence currently exposes no newest-prompt inventory. This
// actual positive arm control is explicitly excluded from Windows-roots runs.
if (!WINDOWS_ROOTS) {
test('K1 pre-setup recurring cron suppresses warm arming and removing it restores a real eligible arm', { timeoutMs: 15000 }, async ($, on) => {
  const f = fixture(on, 'vscode', { warm: true, nativePresence: true })
  on('classic.Stop', () => ({}))
  await start($, f)
  expect(f.w.fileReads.some(path => path.endsWith('prices.json'))).toBe(false)
  await $.classic.Stop({ stop_hook_active: false, session_crons: [{ id: 'k1-every-minute', schedule: '*/1 * * * *', recurring: true, prompt: 'fixture recurring task' }] })
  await $.prompt.submit({ text: 'cron pause', origin: PERSON })
  await $.turn.start({ text: 'cron pause', turnId: 'k1-pending-cron' }); await step($, 'k1-pending-cron')
  await $.turn.complete(complete('k1-pending-cron'))
  const claims = Object.values(f.presence!.state.claims) as { session?: string; lastPromptAt?: number }[]
  expect(claims.some(claim => claim.session === 'k1-ledger-fixture' && claim.lastPromptAt === MORNING)).toBe(true)
  expect(f.w.view().cost?.warmEnabled).toBe(true)
  expect(f.w.view().cost?.cache.state).toBe('warm')
  await f.w.clock.advance(240000)
  expect(f.forks()).toBe(0)
  await $.classic.Stop({ stop_hook_active: false, session_crons: [] })
  await $.prompt.submit({ text: 'eligible pause', origin: PERSON })
  await $.turn.start({ text: 'eligible pause', turnId: 'k1-cron-cleared' }); await step($, 'k1-cron-cleared')
  await $.turn.complete(complete('k1-cron-cleared'))
  // This positive control prevents absent/newest-false fixtures from falsely
  // proving the cron suppression merely because they can never keep warm.
  expect(f.w.view().cost?.cache.state).toBe('kept')
  await f.w.clock.advance(240000); await f.w.clock.settle()
  expect(f.forks()).toBe(1)
})

test('K1 back after keeping warm stopped: one note says when and why, under the newest head where the band is not drawn', { timeoutMs: 15000 }, async ($, on) => {
  const f = fixture(on, 'vscode', { warm: true, nativePresence: true })
  on('classic.Stop', () => ({}))
  await start($, f)
  await $.prompt.submit({ text: 'eligible pause', origin: PERSON })
  await $.turn.start({ text: 'eligible pause', turnId: 'k1-warm-pause' }); await step($, 'k1-warm-pause')
  await $.turn.complete(complete('k1-warm-pause'))
  expect(f.w.view().cost?.cache.state).toBe('kept')
  const stoppedAt = f.w.view().cost!.cache.sentAt + 240000
  // The fixture never answers a fork, so the first re-read stops the keeper; the cache then cools.
  await f.w.clock.advance(240000); await f.w.clock.settle()
  expect(f.forks()).toBe(1)
  await f.w.clock.advance(120000); await f.w.clock.settle()
  const before = f.w.toasts.length
  await $.prompt.submit({ text: 'back', origin: PERSON })
  await $.turn.start({ text: 'back', turnId: 'k1-warm-back' })
  const words = JSON.parse(COST_WORDS_RAW)
  expect(f.w.toasts.slice(before)).toEqual([words['line.warm.stopped'].en.replace('{time}', clockText(Math.floor(stoppedAt / 60000) * 60000, 'en')).replace('{reason}', words['warm.reason.error'].en)])
})
}

// COST-CACHE 3.8: cold moments named before they cost, each once, only when the re-read is worth a mention.
// The expected lines come from the same words, installed here for the test's own copy of the surfaces.
installCostWords(JSON.parse(COST_WORDS_RAW))
test('K1 a resumed chat whose cache lapsed says once what its first message re-reads; a cheap or a warm one says nothing', async ($, on) => {
  const f = fixture(on); on('classic.SessionStart', () => ({}))
  await start($, f)
  // a plan's window readings tell how they pay
  f.w.limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }]
  await $.turn.start({ text: 'first', turnId: 'k1-resume' }); await step($, 'k1-resume'); await $.turn.complete(complete('k1-resume'))
  expect(f.w.view().cost?.billing.kind).toBe('plan')
  const before = f.w.toasts.length, lapsed = { expired: true, tokens: 120000, usd: 0.9 }
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 4000, prompt_cache_likely_expired: true, context_tokens: 120000, estimated_cache_write_usd: 0.9 })
  await $.classic.SessionStart({ source: 'fork', seconds_since_last_response: 4000, prompt_cache_likely_expired: true, context_tokens: 9000, estimated_cache_write_usd: 0.05 })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 30, prompt_cache_likely_expired: false, context_tokens: 120000, estimated_cache_write_usd: 0.9 })
  const line = resumeColdLine(f.w.view().cost, lapsed, 'en')
  expect(line).toContain('120')
  expect(f.w.toasts.slice(before).filter(text => text.includes('the cache from last time has cooled'))).toEqual([line])
})

test('K1 a recurring /loop slower than the cache says once that each run re-reads the chat; a fast one and a one-off say nothing', async ($, on) => {
  const f = fixture(on); on('classic.Stop', () => ({}))
  await start($, f)
  // a plan's window readings tell how they pay
  f.w.limits = [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(MORNING + 5 * 3600000).toISOString() }]
  await $.turn.start({ text: 'first', turnId: 'k1-loop' }); await step($, 'k1-loop'); await $.turn.complete(complete('k1-loop'))
  expect(f.w.view().cost?.billing.kind).toBe('plan')
  const before = f.w.toasts.length
  const crons = [{ id: 'k1-hourly', schedule: '0 * * * *', recurring: true, prompt: 'hourly' }, { id: 'k1-minute', schedule: '*/1 * * * *', recurring: true, prompt: 'minute' }, { id: 'k1-once', schedule: '30 9 * * *', recurring: false, prompt: 'once' }]
  await $.classic.Stop({ stop_hook_active: false, session_crons: crons })
  await $.classic.Stop({ stop_hook_active: false, session_crons: crons })
  const line = loopColdLine(f.w.view().cost, 3600000, 'en')
  expect(line).toContain('/loop')
  expect(f.w.toasts.slice(before).filter(text => text.includes('/loop'))).toEqual([line])
})
