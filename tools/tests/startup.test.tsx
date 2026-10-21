import { DIAGNOSTIC_APPEND } from '../hooks/shared-files'
import { joinPath } from '../hooks/paths'
// The installed hooks are loaded by the engine test kit. These tests mount the real band
// before session.start, and never use ui.redraw to conceal a missing invalidation.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LINES } from '../hooks/lines'
import { initialView, STILL } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import type { DrawnKey, Lang, Mood } from '../hooks/words'
import type { CocoView } from '../types'
import { MORNING, P, PERSON, RECENT, band, desktopPicture, stubPng } from './world'
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'
import { WINDOWS_ROOTS, TEST_PLUGIN_ROOT } from './test-system'

const START = { cwd: '/tmp/startup-project', surface: null, isInteractive: false }
const HOME = '/tmp/startup-shared'
const FOLDER = `${HOME}/Library/Application Support/Coco`
const visibleStage = (source: string) => source.replace(/\*([^*\n]+)\*/g, '$1')
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!node || typeof node !== 'object') return ''
  return ((node as { children?: unknown[] }).children ?? []).map(textOf).join('')
}
function textNodes(tree: unknown): string[] {
  if (Array.isArray(tree)) return tree.flatMap(textNodes)
  if (!tree || typeof tree !== 'object') return []
  const node = tree as { type?: string; children?: unknown[] }
  return [...(node.type === 'Text' ? [textOf(node)] : []), ...(node.children ?? []).flatMap(textNodes)]
}

test('startup stage expectation decodes paired marks and preserves ordinary words and unmatched marks', () => {
  const source = '*stage* ordinary *second stage*'
  expect(visibleStage(source)).toBe('stage ordinary second stage')
  expect(source).toBe('*stage* ordinary *second stage*')
  for (const literal of ['ordinary text', '(stage) ordinary', 'ordinary * unmatched', 'ordinary ** marker', '*across\na line*']) expect(visibleStage(literal)).toBe(literal)
})

function fixture(on: On, options: {
  readThrows?: boolean
  readGate?: Promise<void>
  settingsGate?: Promise<void>
  storeThrows?: boolean
  stateThrows?: boolean
  stateMessage?: string
  stateDeny?: () => boolean
  storeWriteDeny?: boolean
  getThrows?: boolean
  readMessage?: string
  readDeny?: boolean
  diagnostics?: () => boolean
  diagnosticFails?: boolean
  diagnosticDenied?: boolean
  diagnosticHold?: Promise<void>
  withNativePresence?: boolean
  failedSpawn?: boolean
  initial?: CocoView
  sessionId?: string
} = {}) {
  const clock = mock.clock(on, { now: MORNING })
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  if (options.initial) cells.set('view', { value: options.initial, version: 1 })
  const stored: Record<string, unknown> = { ...RECENT,...(options.withNativePresence?{more:{lively:true}}:{}),bandSettings:options.withNativePresence?{more:{lively:true}}:{} }
  const wordReads: ('gaps'|'more')[] = []
  let assetReads = 0
  const assetPaths: string[] = []
  let settingsReads = 0
  let spawns = 0
  const diagnosticRuns: { argv: readonly string[]; stdin: string }[] = []
  on('state.get', async ($, e, next) => {
    if (options.getThrows && e.key === 'view') throw new Error('state read unavailable')
    await next(e) // Preserve the engine's actual render-instance subscription.
    return { value: cells.get(e.key) ?? { value: undefined, version: 0 } } as never
  })
  on('state.set', async ($, e, next) => {
    if (options.stateDeny?.() && e.key === 'view') return { deny: options.stateMessage ?? 'state write unavailable' } as never
    if (options.stateThrows && e.key === 'view') throw new Error(options.stateMessage ?? 'state write unavailable')
    const result = await next(e) // Successful writes must notify native subscribers.
    const version = result.value?.version ?? (cells.get(e.key)?.version ?? 0) + 1
    cells.set(e.key, { value: e.value, version })
    return result
  })
  on('store.get', ($, e) => {
    if (options.storeThrows) throw new Error('store read unavailable')
    return { value: stored[e.key] }
  })
  on('store.set', ($, e) => {
    if (options.storeWriteDeny) return { deny: 'store write unavailable' } as never
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('settings.read', async () => { settingsReads++; await options.settingsGate; return { value: { timeZone: 'UTC' } } })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20, tokens: 40000 }, rateLimits: [] } }))
  on('session.id', () => ({ value: options.sessionId ?? 'fresh-start' }))
  on('session.root', () => ({ value: START.cwd }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', ($, e) => ({ value: e.path === `${FOLDER}/diagnostics` ? !!options.diagnostics?.() : !!options.failedSpawn && (e.path === '/System/Library/CoreServices/SystemVersion.plist' || e.path === '/bin/sh' || e.path === FOLDER || e.path === `${FOLDER}/requests.jsonl`) }))
  on('fs.read', async ($, e) => {
    if (/[\\/]hooks[\\/]gaps-text\.json$/.test(e.path)) { wordReads.push('gaps');return {value:M1_GAPS_TEXT} as never }
    if (/[\\/]hooks[\\/]more-text\.json$/.test(e.path)) { wordReads.push('more');return {value:M1_MORE_TEXT} as never }
    // the band's 👜 word is read beside her pictures (register.tsx runPictureWorker, 10-18); it is a word file, not an asset
    if (!/[\\/]hooks[\\/]bag-text\.json$/.test(e.path)) { assetReads++; assetPaths.push(e.path) }
    await options.readGate
    if (options.readThrows) {
      const message = options.readMessage ?? 'asset read unavailable'
      if (options.readDeny) return { deny: message } as never
      throw new Error(message)
    }
    return { value: { base64: stubPng(e.path) } } as never
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', async ($, e) => {
    if ((e.argv[0] === '/bin/sh' && e.argv[1] === '-c' && e.argv[2] === DIAGNOSTIC_APPEND)) {
      diagnosticRuns.push({ argv: e.argv, stdin: e.init?.stdin ?? '' })
      await options.diagnosticHold
      if (options.diagnosticFails) throw new Error('diagnostic append unavailable')
      if (options.diagnosticDenied) return { deny: 'diagnostic append denied' } as never
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () { spawns++; throw new Error('presence spawn unavailable'); yield { stream: 'stdout' as const, text: '' } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => <></>)
  return { clock, cells, diagnosticRuns, wordReads, assetReads: () => assetReads, assetPaths: () => assetPaths.map(path => path.split(/[\\/]/).slice(-2).join('/')), settingsReads: () => settingsReads, spawns: () => spawns }
}

async function drain(): Promise<void> { for (let i = 0; i < 300; i++) await Promise.resolve() }
async function flushRestoredLine($: Engine): Promise<void> {
  // Fixed restored-line fixtures need first/final gauge updates and 20 host crossings.
  // Diagnostic startup tests retain the original flush and its queue progress.
  for (let i = 0; i < 20; i++) await $.command.run({ command: i === 0 || i === 19 ? 'model' : 'startup-host-boundary', args: '', origin: PERSON, presentation: P })
  await drain()
}
async function flush($: Engine): Promise<void> {
  // Calls cross the worker/host boundary: local Promise microtasks alone cannot drain it.
  for (let i = 0; i < 20; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P })
  await drain()
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function visibleSource(source: unknown): void {
  // A source with just an empty <image href> is not a fallback picture.
  expect(/<(rect|path)\b|data:image\/png;base64,[A-Za-z0-9+/]{20}/.test(String(source))).toBe(true)
}

describe('band startup regression', () => {
  test('a survey pass-through cannot consume the first shown band marker', async ($, on) => {
    const f = fixture(on, { diagnostics: () => true })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const request = band(100)
    const ui = await $.ui.mount({ surface: 'desktop', ...request, props: { ...request.props, hasSurvey: true } })
    await flush($)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('first-band:'))).toBe(false)
    await ui.redraw({ ...request.props, hasSurvey: false })
    await flush($)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('first-band:returned'))).toBe(true)
  })

  test('a full diagnostics queue still keeps the first shown band marker', async ($, on) => {
    const waiting = gate()
    const f = fixture(on, { diagnostics: () => true, diagnosticHold: waiting.promise })
    try {
      for (let i = 0; i < 40; i++) await $.session.start(START); await f.clock.advance(0); await flush($)
      await $.ui.mount({ surface: 'desktop', ...band(100) })
    } finally { waiting.release() }
    await flush($)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('first-band:returned'))).toBe(true)
  })

  test('turning diagnostics off while the first marker is queued rearms it for a later enabled draw', async ($, on) => {
    let enabled = true
    const waiting = gate()
    const f = fixture(on, { diagnostics: () => enabled, diagnosticHold: waiting.promise })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    enabled = false
    try { await $.session.start(START); await f.clock.advance(0); await flush($) } finally { waiting.release() }
    await flush($)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('first-band:'))).toBe(false)
    enabled = true
    await $.session.start(START); await f.clock.advance(0); await flush($)
    await ui.redraw(band(100).props)
    await flush($)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('first-band:returned'))).toBe(true)
  })

  test('the very first desktop render is visible even when every asset read throws', async ($, on) => {
    const f = fixture(on, { readThrows: true })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const sprite = await desktopPicture(ui)
    expect(sprite).toBeDefined()
    visibleSource(sprite?.props.source)
    expect(f.assetReads()).toBe(0) // render is never blocked by a file read
    await f.clock.advance(0)
    expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  test('a never-finishing asset read cannot hold the first desktop render', { timeoutMs: 1500 }, async ($, on) => {
    const waiting = gate()
    const f = fixture(on, { readGate: waiting.promise })
    try {
      // No timer advancement and no release: the actual first render must resolve with the
      // gate still closed. The timeout bounds the old implementation's blocked render.
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      expect(f.assetReads()).toBe(0)
      visibleSource((await desktopPicture(ui))?.props.source)
    } finally { waiting.release() }
  })

  test('desktop first still stays bundled and the lifecycle swaps in its cached animation',async($,on)=>{
    const f=fixture(on)
    const ui=await $.ui.mount({surface:'desktop',...band(100)})
    // Coco from their bundled rest (coco-stills.ts), before any file is read; the old figure is never drawn
    const still=String((await desktopPicture(ui))?.props.source)
    expect(still).toContain('data-coco="A idle"');expect(f.assetReads()).toBe(0);expect(f.wordReads).toEqual([])
    await $.session.start(START);await f.clock.advance(0);await flush($)
    // A generation's first answer releases the lifecycle-owned worker, which reads their band data: this fixture
    // answers every read with a stub picture, so band-A.json cannot be read and is tried again; nothing else is read.
    await ui.redraw(band(100).props);await f.clock.advance(0);await flush($)
    const animated=String((await desktopPicture(ui))?.props.source)
    expect(animated).toContain('@keyframes');expect(animated).toContain('data-coco="A idle"');expect(f.assetReads()).toBeGreaterThan(0);expect(f.assetPaths().every(path => path === 'coco/band-A.json')).toBe(true);expect(f.wordReads).toEqual(['gaps'])
    await ui.redraw(band(100).props);expect(String((await desktopPicture(ui))?.props.source)).toBe(animated);expect(f.wordReads).toEqual(['gaps'])
  })

  test('a newer band render cancels a queued stale work transition', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await ui.redraw(band(100, false).props)
    await f.clock.advance(0)
    expect((f.cells.get('view')?.value as CocoView).mood).toBe('idle')
  })

  test('a throwing state read still draws the initial fallback picture', async ($, on) => {
    fixture(on, { getThrows: true, readThrows: true })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  test('a restored host view draws while session setup waits, with its preferences already correct', async ($, on) => {
    const waiting = gate()
    const f = fixture(on, { settingsGate: waiting.promise, readThrows: true, initial: initialView() })
    const starting = $.session.start(START)
    try {
      await flush($)
      expect(f.settingsReads()).toBeGreaterThan(0)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      visibleSource((await desktopPicture(ui))?.props.source)
    } finally { waiting.release(); await starting }
  })

  test('a rejected startup store read still publishes a valid view and band', async ($, on) => {
    const f = fixture(on, { storeThrows: true })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    expect(f.cells.get('view')).toBeDefined()
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  test(WINDOWS_ROOTS ? 'Windows fallback starts no native presence and still draws the first band' : 'a failed shared-presence spawn cannot prevent the first band', async ($, on) => {
    const f = fixture(on, { withNativePresence:true, failedSpawn: true, readThrows: true })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    await drain()
    if (WINDOWS_ROOTS) expect(f.spawns()).toBe(0)
    else expect(f.spawns()).toBeGreaterThan(0)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  for (const stateThrows of [false, true]) {
    test(`later state changes redraw the mounted band automatically (state write throws: ${stateThrows})`, async ($, on) => {
      fixture(on, { stateThrows })
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      expect(await ui.find({ type: 'Text', text: /curled up in the cup/ })).toBeDefined()
      await $.command.run({ command: 'coco', args: 'lang zh', origin: PERSON, presentation: P })
      await ui.drawn()
      expect(await ui.find({ type: 'Text', text: /窝在杯子里/ })).toBeDefined()
    })
  }

  test('a late rejected state write redraws from the newer module view instead of a stale cell', async ($, on) => {
    let denied = false
    const f = fixture(on, { initial: initialView(), stateDeny: () => denied })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    expect(await ui.find({ type: 'Text', text: /curled up in the cup/ })).toBeDefined()
    denied = true
    await $.command.run({ command: 'coco', args: 'lang zh', origin: PERSON, presentation: P })
    expect((f.cells.get('view')?.value as CocoView).lang).toBe('en')
    expect(await ui.find({ type: 'Text', text: /窝在杯子里/ })).toBeDefined()
  })

  test('a rejected preference write still redraws an already-applied band change', async ($, on) => {
    const f = fixture(on, { storeWriteDeny: true })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    expect((await desktopPicture(ui))?.props.height).toBe(64)
    await $.command.run({ command: 'coco', args: 'band compact', origin: PERSON, presentation: P })
    expect((f.cells.get('view')?.value as CocoView).band).toBe('compact')
    await ui.drawn()
    expect((await desktopPicture(ui))?.props.height).toBe(32)
  })

  test('diagnostics follows OFF, ON, OFF and records each lifecycle step separately', async ($, on) => {
    let enabled = false
    const f = fixture(on, { diagnostics: () => enabled, readThrows: true, readDeny: true, readMessage: 'file read failed' })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    await flush($)
    expect(f.diagnosticRuns.length).toBe(0)
    enabled = true
    await $.session.start(START); await f.clock.advance(0); await flush($)
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    visibleSource((await desktopPicture(ui))?.props.source)
    const records = f.diagnosticRuns.map(run => {
      expect(run.argv.length).toBe(7)
      expect(run.argv[4]).toBe(FOLDER)
      expect(run.argv[5]).toBe(joinPath(TEST_PLUGIN_ROOT, 'bin/companion-control'))
      expect(run.argv[6]).toBe(joinPath(TEST_PLUGIN_ROOT, 'bin/presence.sh'))
      expect(run.stdin.trim().split('\n').length).toBe(1)
      return JSON.parse(run.stdin) as { step: string; message?: string; published?: boolean; version?: number }
    })
    const steps = records.map(record => record.step)
    expect(steps.filter(step => step === 'register').length).toBe(1)
    expect(steps).toContain('session.start.begin')
    expect(steps).toContain('session.start.end')
    expect(steps).toContain('first-band:returned')
    expect(steps.some(step => step.startsWith('redraw:'))).toBe(true)
    expect(records.some(record => record.step === 'push' && record.published === true && typeof record.version === 'number')).toBe(true)
    expect(f.assetReads()).toBe(2) // their band-A and band-B, tried once each and failing; the bundled rest draws without them
    expect(f.wordReads).toEqual(['gaps'])
    const count = f.diagnosticRuns.length
    enabled = false
    await $.session.start(START); await f.clock.advance(0); await flush($) // the lifecycle forces a flag refresh
    await flush($)
    const offCount = f.diagnosticRuns.length
    await $.turn.start({ text: 'PRIVATE PROMPT DO NOT LOG', turnId: 't1' })
    await flush($)
    expect(f.diagnosticRuns.length).toBe(offCount)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('PRIVATE PROMPT'))).toBe(false)
  })

  test('diagnostics redacts unknown error text and keeps only a safe OS error code', async ($, on) => {
    const f = fixture(on, { diagnostics: () => true, stateDeny: () => true, stateMessage: 'ENOENT: /tmp/private-reply PRIVATE FILE CONTENT' })
    await $.session.start(START); await f.clock.advance(0); await flush($)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    visibleSource((await desktopPicture(ui))?.props.source)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('Error: ENOENT'))).toBe(true)
    expect(f.diagnosticRuns.some(run => /private-reply|PRIVATE FILE CONTENT/.test(run.stdin))).toBe(false)
  })

  for (const failure of ['diagnosticFails', 'diagnosticDenied'] as const) {
    test(`a ${failure} logger cannot prevent the band or its redraws`, async ($, on) => {
      const f = fixture(on, { diagnostics: () => true, [failure]: true })
      await $.session.start(START); await f.clock.advance(0); await flush($)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await flush($)
      expect(f.diagnosticRuns.length).toBeGreaterThan(0)
      visibleSource((await desktopPicture(ui))?.props.source)
      await $.command.run({ command: 'coco', args: 'lang zh', origin: PERSON, presentation: P })
      await ui.drawn()
      expect(await ui.find({ type: 'Text', text: /窝在杯子里/ })).toBeDefined()
    })
  }

  // The function session.start supplies no resume/fork flags. The separate classic event
  // carries source; a fresh process also receives the three function-start fields.
  for (const source of ['resume', 'fork'] as const) {
    const sessionId = `${source}-session`
    test(`${sessionId}: a process start and desktop attach both keep the band visible`, async ($, on) => {
      fixture(on, { sessionId, readThrows: true })
      const before = await $.ui.mount({ surface: 'desktop', ...band(100) })
      visibleSource((await desktopPicture(before))?.props.source)
      await $.classic.SessionStart({ source, session_id: sessionId, cwd: START.cwd })
      await $.session.start(START)
      await $.session.attach({ surface: 'desktop', clientId: `${sessionId}:desktop` })
      visibleSource((await desktopPicture(before))?.props.source)
    })
  }

  // His words for the picture the desktop draws; hello, teapot and praised kept the words shown before (his picks, 10-18).
  const desktopAside = (source: string): string => {
    const action = /data-coco="[AB] (\w+)"/.exec(source)?.[1]
    expect(action).toBeDefined()
    return action === 'hello' ? WORDS.en.aside.wave : action === 'teapot' ? WORDS.en.aside.refuse : action === 'praised' ? WORDS.en.aside.flustered
      : WORDS.en.drawn[action as DrawnKey]
  }
  for (const mood of Object.keys(STILL) as Mood[]) {
    test(`${mood}: the first render draws a valid picture on both surfaces`, async ($, on) => {
      const f=fixture(on, { initial: { ...initialView(), mood, frame: STILL[mood] } })
      await $.session.start(START); await flush($)
      for (const surface of ['desktop', 'terminal'] as const) {
        const ui = await $.ui.mount({ surface, ...band(100) })
        expect(await ui.drawn()).toBeDefined()
        if (surface === 'desktop') visibleSource((await desktopPicture(ui))?.props.source)
        else expect(await ui.find({ type: 'Raster' })).toBeDefined()
        // the desktop names the picture it draws (owner 10-18: 「小字跟着画面走」); the terminal keeps the mood's words
        const direction = surface === 'desktop' ? desktopAside(String((await desktopPicture(ui))?.props.source)) : WORDS.en.aside[mood]
        expect(await ui.find({ type: 'Text', text: `${surface === 'desktop' ? '\u00a0' : ' '}${direction}` })).toBeDefined()
        await ui.unmount()
      }
    })
  }

  for (const lang of Object.keys(WORDS) as Lang[]) {
    const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
      : Array.isArray(value) ? value.flatMap(strings)
      : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
    const lines = strings(LINES[lang])
    for(const [index,line] of lines.entries())test(`${lang}: approved line ${index} survives the activation restore and first band render`,{options:{language:lang},timeoutMs:60_000},async($,on)=>{
      // A fresh engine activation owns each restored state. Drawing never rereads state.
      const f=fixture(on,{initial:{...initialView(),lang,said:line}})
      await $.session.start(START);await f.clock.settle();await flushRestoredLine($)
      for(const surface of ['desktop','terminal'] as const){
        const ui=await $.ui.mount({surface,...band(180)})
        const tree=await ui.drawn();expect(tree).toBeDefined()
        const visible=textNodes(tree),expected=visibleStage(line)
        expect(visible).toContain(expected)
        if(expected!==line)expect(visible).not.toContain(line)
        const restored=f.cells.get('view')?.value as CocoView
        expect(restored.said).toBe(line)
        if(surface==='desktop')visibleSource((await desktopPicture(ui))?.props.source)
        else expect(await ui.find({type:'Raster'})).toBeDefined()
        await ui.unmount()
      }
    })
  }

})
