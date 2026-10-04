// The installed hooks are loaded by the engine test kit. These tests mount the real band
// before session.start, and never use ui.redraw to conceal a missing invalidation.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { LINES } from '../hooks/lines'
import { initialView, slipLabel, STILL } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { bundledSvg } from '../hooks/pictures'
import type { Lang, Mood } from '../hooks/words'
import type { ClaudesamaView } from '../types'
import { MORNING, P, PERSON, RECENT, band, desktopPicture, stubPng } from './world'

const START = { cwd: '/tmp/startup-project', surface: null, isInteractive: false }
const HOME = '/tmp/startup-shared'
const FOLDER = `${HOME}/Library/Application Support/Claude-sama`

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
  failedSpawn?: boolean
  initial?: ClaudesamaView
  sessionId?: string
} = {}) {
  const clock = mock.clock(on, { now: MORNING })
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  if (options.initial) cells.set('view', { value: options.initial, version: 1 })
  const stored: Record<string, unknown> = { ...RECENT }
  let assetReads = 0
  let settingsReads = 0
  let spawns = 0
  const diagnosticRuns: { argv: readonly string[]; stdin: string }[] = []
  on('state.get', ($, e) => {
    if (options.getThrows && e.key === 'view') throw new Error('state read unavailable')
    return { value: cells.get(e.key) ?? { value: undefined, version: 0 } } as never
  })
  on('state.set', ($, e) => {
    if (options.stateDeny?.() && e.key === 'view') return { deny: options.stateMessage ?? 'state write unavailable' } as never
    if (options.stateThrows && e.key === 'view') throw new Error(options.stateMessage ?? 'state write unavailable')
    const version = (cells.get(e.key)?.version ?? 0) + 1
    cells.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
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
  on('fs.exists', ($, e) => ({ value: e.path === `${FOLDER}/diagnostics` ? !!options.diagnostics?.() : !!options.failedSpawn && (e.path === '/System/Library/CoreServices/SystemVersion.plist' || e.path === '/usr/bin/tail' || e.path === FOLDER || e.path === `${FOLDER}/requests.jsonl`) }))
  on('fs.read', async ($, e) => {
    assetReads++
    await options.readGate
    if (options.readThrows) {
      const message = options.readMessage ?? 'asset read unavailable'
      if (options.readDeny) return { deny: message } as never
      throw new Error(message)
    }
    return { value: { base64: stubPng(e.path) } } as never
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    if (String(e.argv[2]).includes('diagnostics.log')) {
      diagnosticRuns.push({ argv: e.argv, stdin: e.init?.stdin ?? '' })
      if (options.diagnosticFails) throw new Error('diagnostic append unavailable')
      if (options.diagnosticDenied) return { deny: 'diagnostic append denied' } as never
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () { spawns++; throw new Error('tail spawn unavailable'); yield { stream: 'stdout' as const, text: '' } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => <></>)
  return { clock, cells, diagnosticRuns, assetReads: () => assetReads, settingsReads: () => settingsReads, spawns: () => spawns }
}

async function drain(): Promise<void> { for (let i = 0; i < 300; i++) await Promise.resolve() }
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
  test('the very first desktop render is visible even when every asset read throws', async ($, on) => {
    const f = fixture(on, { readThrows: true })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const sprite = await desktopPicture(ui)
    expect(sprite).toBeDefined()
    visibleSource(sprite?.props.source)
    expect(f.assetReads()).toBe(0) // render is never blocked by a file read
    await f.clock.advance(0)
    expect(await ui.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
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

  test('every desktop frame stays bundled and does no asset read after the first render', async ($, on) => {
    const f = fixture(on)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const initial = String((await desktopPicture(ui))?.props.source)
    expect(initial).toBe(bundledSvg('idle-reading', 64, false))
    await f.clock.advance(0)
    await drain()
    expect(f.assetReads()).toBe(0)
    expect(String((await desktopPicture(ui))?.props.source)).toBe(initial)
  })

  test('a newer band render cancels a queued stale work transition', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await ui.redraw(band(100, false).props)
    await f.clock.advance(0)
    expect((f.cells.get('view')?.value as ClaudesamaView).mood).toBe('idle')
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
    await $.session.start(START)
    expect(f.cells.get('view')).toBeDefined()
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  test('a failed request-channel spawn cannot prevent the first band', async ($, on) => {
    const f = fixture(on, { failedSpawn: true, readThrows: true })
    await $.session.start(START)
    await drain()
    expect(f.spawns()).toBeGreaterThan(0)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    visibleSource((await desktopPicture(ui))?.props.source)
  })

  for (const stateThrows of [false, true]) {
    test(`later state changes redraw the mounted band automatically (state write throws: ${stateThrows})`, async ($, on) => {
      fixture(on, { stateThrows })
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      expect(await ui.find({ type: 'Text', text: /training/ })).toBeDefined()
      await $.command.run({ command: 'claudesama', args: 'lang zh', origin: PERSON, presentation: P })
      await ui.drawn()
      expect(await ui.find({ type: 'Text', text: /练功中/ })).toBeDefined()
    })
  }

  test('a late rejected state write redraws from the newer module view instead of a stale cell', async ($, on) => {
    let denied = false
    const f = fixture(on, { initial: initialView(), stateDeny: () => denied })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    expect(await ui.find({ type: 'Text', text: /training/ })).toBeDefined()
    denied = true
    await $.command.run({ command: 'claudesama', args: 'lang zh', origin: PERSON, presentation: P })
    expect((f.cells.get('view')?.value as ClaudesamaView).lang).toBe('en')
    expect(await ui.find({ type: 'Text', text: /练功中/ })).toBeDefined()
  })

  test('a rejected preference write still redraws an already-applied band change', async ($, on) => {
    const f = fixture(on, { storeWriteDeny: true })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    expect((await desktopPicture(ui))?.props.height).toBe(64)
    await $.command.run({ command: 'claudesama', args: 'band compact', origin: PERSON, presentation: P })
    expect((f.cells.get('view')?.value as ClaudesamaView).band).toBe('compact')
    await ui.drawn()
    expect((await desktopPicture(ui))?.props.height).toBe(32)
  })

  test('diagnostics follows OFF, ON, OFF and records each lifecycle step separately', async ($, on) => {
    let enabled = false
    const f = fixture(on, { diagnostics: () => enabled, readThrows: true, readDeny: true, readMessage: 'file read failed' })
    await $.session.start(START)
    await flush($)
    expect(f.diagnosticRuns.length).toBe(0)
    enabled = true
    await $.session.start(START)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await f.clock.advance(0)
    await flush($)
    visibleSource((await desktopPicture(ui))?.props.source)
    const records = f.diagnosticRuns.map(run => {
      expect(run.argv.length).toBe(5)
      expect(run.argv[4]).toBe(FOLDER)
      expect(run.argv[5]).toBe(undefined)
      expect(run.stdin.trim().split('\n').length).toBe(1)
      return JSON.parse(run.stdin) as { step: string; message?: string }
    })
    const steps = records.map(record => record.step)
    expect(steps.filter(step => step === 'register').length).toBe(1)
    expect(steps).toContain('session.start.begin')
    expect(steps).toContain('session.start.end')
    expect(steps).toContain('first-band:svg-bundled')
    expect(steps.some(step => step.startsWith('redraw:'))).toBe(true)
    expect(f.assetReads()).toBe(0) // eliminated asset failure path
    const count = f.diagnosticRuns.length
    enabled = false
    await $.session.start(START) // the lifecycle forces a flag refresh
    await flush($)
    const offCount = f.diagnosticRuns.length
    await $.turn.start({ text: 'PRIVATE PROMPT DO NOT LOG', turnId: 't1' })
    await flush($)
    expect(f.diagnosticRuns.length).toBe(offCount)
    expect(f.diagnosticRuns.some(run => run.stdin.includes('PRIVATE PROMPT'))).toBe(false)
  })

  test('diagnostics redacts unknown error text and keeps only a safe OS error code', async ($, on) => {
    const f = fixture(on, { diagnostics: () => true, stateDeny: () => true, stateMessage: 'ENOENT: /tmp/private-reply PRIVATE FILE CONTENT' })
    await $.session.start(START)
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
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await flush($)
      expect(f.diagnosticRuns.length).toBeGreaterThan(0)
      visibleSource((await desktopPicture(ui))?.props.source)
      await $.command.run({ command: 'claudesama', args: 'lang zh', origin: PERSON, presentation: P })
      await ui.drawn()
      expect(await ui.find({ type: 'Text', text: /练功中/ })).toBeDefined()
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

  for (const mood of Object.keys(STILL) as Mood[]) {
    test(`${mood}: the first render draws a valid picture on both surfaces`, async ($, on) => {
      fixture(on, { initial: { ...initialView(), mood, frame: STILL[mood] } })
      for (const surface of ['desktop', 'terminal'] as const) {
        const ui = await $.ui.mount({ surface, ...band(100) })
        expect(await ui.drawn()).toBeDefined()
        if (surface === 'desktop') visibleSource((await desktopPicture(ui))?.props.source)
        else expect(await ui.find({ type: 'Raster' })).toBeDefined()
        const direction = WORDS.en.aside[mood]
        expect(await ui.find({ type: 'Text', text: ` ${direction}` })).toBeDefined()
        await ui.unmount()
      }
    })
  }

  for (const lang of Object.keys(WORDS) as Lang[]) {
    test(`${lang}: every existing line is preserved by the first band render`, { timeoutMs: 60_000 }, async ($, on) => {
      const initial = initialView()
      const f = fixture(on, { initial })
      const strings = (value: unknown): string[] => typeof value === 'string' ? [value]
        : Array.isArray(value) ? value.flatMap(strings)
        : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
      const lines = strings(LINES[lang]).map(line => ({ line, rank: undefined as string | undefined }))
      for (const [rank, held] of Object.entries(LINES.omikuji[lang])) {
        lines.push(...strings(held).map(line => ({ line, rank })))
      }
      expect(lines.length).toBeGreaterThan(0)
      for (const { line, rank } of lines) {
        // This changes the state-read bottom before mounting; each mount is the band's
        // actual first render, before setup or an asset-read timer has run.
        f.cells.set('view', { value: { ...initial, lang, said: rank ? null : line,
          slip: rank ? { rank, label: slipLabel(line), text: line } : null }, version: 1 })
        for (const surface of ['desktop', 'terminal'] as const) {
          const ui = await $.ui.mount({ surface, ...band(180) })
          expect(await ui.drawn()).toBeDefined()
          expect(await ui.find({ type: 'Text', text: line })).toBeDefined()
          if (surface === 'desktop') visibleSource((await desktopPicture(ui))?.props.source)
          else expect(await ui.find({ type: 'Raster' })).toBeDefined()
          await ui.unmount()
        }
      }
    })
  }
})
