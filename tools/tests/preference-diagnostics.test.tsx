// Real engine mounts before process start. All filesystem/process operations below are mocks.
// No diagnostics flag is created. Lifecycle flags model the classic API's separate start event.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ClaudesamaView } from '../types'
import { initialView } from '../hooks/mood'
import { MORNING, P, PERSON, RECENT, SUMMARY, band, desktopPicture } from './world'
import { BAND_PNG_BYTES } from './band-png-bytes'

const HOME = '/tmp/diagnostic-fixture'
const START = { cwd: '/tmp/private-project', surface: 'desktop' as const, isInteractive: true }
function fixture(on: On, store: Record<string, unknown>, enabled = false, held?: ClaudesamaView) {
  const clock = mock.clock(on, { now: MORNING })
  mock.store(on, { ...RECENT, ...store })
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  if (held) cells.set('view', { value: held, version: 7 })
  const exists: string[] = [], reads: string[] = [], records: Record<string, unknown>[] = []
  let invalidations = 0
  on('state.get', ($, e) => ({ value: cells.get(e.key) ?? { value: undefined, version: 0 } }) as never)
  on('state.set', ($, e) => { const version = (cells.get(e.key)?.version ?? 0) + 1; cells.set(e.key, { value: e.value, version }); return { value: { isSet: true, version } } })
  on('settings.read', () => ({ value: { timeZone: 'UTC' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20, tokens: 40000, breakdown: { totalTokens: 24000 } }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.root', () => ({ value: START.cwd }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', ($, e) => { exists.push(e.path); return { value: e.path === `${HOME}/Library/Application Support/Claude-sama/diagnostics` && enabled } })
  on('fs.read', ($, e) => { reads.push(e.path); throw new Error('No file read is available on this path') })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    if (String(e.argv[2]).includes('diagnostics.log')) for (const line of (e.init?.stdin ?? '').trim().split('\n')) if (line) records.push(JSON.parse(line))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.invalidate', ($, e, next) => { invalidations++; return next(e) })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => <></>)
  return { clock, cells, exists, reads, records, invalidations: () => invalidations }
}
const payload = (source: unknown) => /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(String(source))?.[1]
function pngSize(source: unknown) {
  const bytes = atob(payload(source) ?? '')
  const n = (i: number) => (bytes.charCodeAt(i) << 24 | bytes.charCodeAt(i + 1) << 16 | bytes.charCodeAt(i + 2) << 8 | bytes.charCodeAt(i + 3)) >>> 0
  return [n(16), n(20)]
}
function seeded(seed: number) { let x = seed >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 } }

describe('stored preferences are right before the first draw', () => {
  for (const source of ['fresh', 'resume', 'fork'] as const) for (const chosen of ['on', 'compact', 'off'] as const) {
    test(`${source}: ${chosen}, Japanese, no asset or startup dependency`, async ($, on) => {
      const f = fixture(on, { band: chosen, bandBeforeOff: 'compact', lang: 'ja' })
      if (source !== 'fresh') await $.classic.SessionStart({ source, session_id: source + '-session', cwd: START.cwd })
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      const svgs = await ui.findAll({ type: 'Svg' })
      const sprite = await desktopPicture(ui)
      expect(sprite).toBeDefined()
      expect(String(sprite?.props.alt).startsWith('Claudeさま')).toBe(true)
      expect(pngSize(sprite?.props.source)).toEqual(chosen === 'on' ? [137, 128] : [35, 32])
      expect(payload(sprite?.props.source)).toBe(BAND_PNG_BYTES[chosen === 'on' ? 'desktop' : 'pixel'][chosen === 'off' ? 'sleep' : 'idle-reading'])
      expect(String(sprite?.props.source).includes('image-rendering:pixelated')).toBe(chosen !== 'on')
      if (chosen === 'off') {
        expect(sprite?.props.alt).toBe('Claudeさま、ねむっている')
        expect((await ui.find({ type: 'Button', key: 'claudesama:band:wake' }))?.props.label).toBe('かれを起こす')
        expect(svgs.length).toBe(1)
        const redraws = f.invalidations()
        const firstTree = await ui.drawn()
        await f.clock.advance(60_000)
        expect(f.invalidations()).toBe(redraws)
        expect(await ui.drawn()).toEqual(firstTree)
      } else expect(await ui.find({ type: 'Text', text: 'Claudeさま' })).toBeDefined()
      expect(f.reads).toEqual([])
    })
  }
})

describe('restored cold state and animation do not reset each other', () => {
  test('seeded cold desktop work holds advance frames through repeated same-prop draws', async ($, on) => {
    const f = fixture(on, {}, false, { ...initialView(), lang: 'ja', band: 'on' })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    const sprite = async () => await desktopPicture(ui)
    const first = payload((await sprite())?.props.source)
    expect(first).toBe(BAND_PNG_BYTES.desktop['think-a'])
    expect(String((await sprite())?.props.alt).startsWith('Claudeさま')).toBe(true)
    expect((await sprite())?.props.alt).not.toContain('修行中')
    await ui.redraw(band(100, true).props) // host layout draw, not a substitute event invalidation
    expect((await sprite())?.props.alt).not.toContain('修行中')
    // Seed only the observation cadence; the actual hold is supplied by production motion.
    // Sampling finer than its minimum hold guarantees an intermediate changed frame is seen.
    const random = seeded(73)
    for (let elapsed = 0; elapsed < 3000 && payload((await sprite())?.props.source) === first;) {
      const step = 70 + Math.floor(random() * 50); elapsed += step; await f.clock.advance(step)
    }
    expect(payload((await sprite())?.props.source)).not.toBe(first)
    const second = payload((await sprite())?.props.source)
    expect(second).toBe(BAND_PNG_BYTES.desktop['think-b'])
    await ui.redraw(band(100, true).props)
    expect(payload((await sprite())?.props.source)).toBe(second)
    expect(f.invalidations()).toBeGreaterThan(0)
    expect(f.reads).toEqual([])
  })
})

describe('diagnostics are cached and content-free', () => {
  test('cached OFF adds no exists/read/log operation per terminal animation frame', async ($, on) => {
    const f = fixture(on, {})
    await $.session.start({ ...START, surface: 'terminal' })
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    const before = f.exists.length
    await f.clock.advance(60_000)
    expect(f.exists.length).toBe(before)
    expect(f.reads).toEqual([])
    expect(f.records).toEqual([])
  })

  test('render, push and compaction schemas expose only bounded metadata', async ($, on) => {
    const f = fixture(on, {}, true)
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100, false, 12) })
    await $.ui.mount({ surface: 'terminal', ...band(80, false, 10) })
    await $.turn.start({ text: 'PRIVATE_REQUEST_SECRET', turnId: 't1' })
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'PRIVATE_REPLY_SECRET', toolUses: [] }] })
    // Diagnostic work is detached; advancing drains queued host calls without producing input.
    await f.clock.advance(0)
    for (let i = 0; i < 8; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P })
    const bands = f.records.filter(record => record.step === 'band')
    expect(bands.length).toBeGreaterThanOrEqual(2)
    for (const record of bands) {
      for (const key of ['surface', 'isWorking', 'bodyColumns', 'maxRows', 'style', 'height', 'fallback', 'version']) expect(record[key]).not.toBe(undefined)
      expect(['terminal', 'desktop']).toContain(record.surface)
    }
    const pushes = f.records.filter(record => record.step === 'push')
    expect(pushes.length).toBeGreaterThan(0)
    for (const record of pushes) { expect(typeof record.version).toBe('number'); expect(typeof record.published).toBe('boolean') }
    const compact = f.records.find(record => record.step === 'compaction')
    expect(compact?.trigger).toBe('manual')
    expect(compact?.tokensAfter).toBe(true)
    expect(compact?.context).toBe(12)
    expect(compact?.estimate).toBe(true)
    const allowed = new Set(['at', 'step', 'message', 'surface', 'isWorking', 'bodyColumns', 'maxRows', 'style', 'height', 'fallback', 'version', 'published', 'trigger', 'tokensAfter', 'context', 'estimate'])
    for (const record of f.records) for (const key of Object.keys(record)) expect(allowed.has(key), `Unexpected diagnostic field ${key}`).toBe(true)
    const serialized = JSON.stringify(f.records)
    expect(serialized).not.toContain('PRIVATE_REQUEST_SECRET')
    expect(serialized).not.toContain('PRIVATE_REPLY_SECRET')
    expect(serialized).not.toContain(START.cwd)
    expect(serialized).not.toContain(HOME)
  })
})

describe('desktop diagnostics exclude animation frames and retain real redraws', () => {
  test('an animated minute logs no frame-only redraw; layout, language, compaction and new instance still log', { timeoutMs: 60_000 }, async ($, on) => {
    const f = fixture(on, {}, true)
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    // SVG invalidate redraws all engine instances; the terminal must not log those frames either.
    await $.ui.mount({ surface: 'terminal', requestId: 'mixed-terminal-instance', ...band(80) })
    const bands = () => f.records.filter(record => record.step === 'band')
    const drain = async () => { await f.clock.advance(0); for (let i = 0; i < 8; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
    await drain()
    const baseline = bands().length
    expect(baseline).toBeGreaterThan(0)
    const redraws = f.invalidations()
    const pictures = new Set<string | undefined>()
    // Seeded observation cadence remains below the model's 100 ms minimum closed-eye hold.
    // Production blink holds are untouched; sixty seconds exceeds its maximum interval.
    const random = seeded(89)
    for (let elapsed = 0; elapsed < 60_000;) {
      const step = Math.min(50 + Math.floor(random() * 25), 60_000 - elapsed)
      elapsed += step
      await f.clock.advance(step)
      const sprite = await desktopPicture(ui)
      expect(String(sprite?.props.alt).startsWith('Claude-sama,')).toBe(true)
      pictures.add(payload(sprite?.props.source))
    }
    await drain()
    expect(pictures.size).toBeGreaterThanOrEqual(2)
    expect(f.invalidations()).toBeGreaterThan(redraws)
    expect(bands().length).toBe(baseline)

    // External redraw with identical metadata remains a record when no frame marker is pending.
    await ui.redraw(band(100).props)
    await drain()
    expect(bands().length).toBeGreaterThan(baseline)
    const beforeLayout = bands().length
    await ui.redraw({ ...band(91, false, 8).props, scroll: { offset: 1, bodyRows: 8 } })
    await drain()
    expect(bands().length).toBeGreaterThan(beforeLayout)
    expect(bands().filter(record => record.surface === 'desktop').at(-1)?.bodyColumns).toBe(91)
    expect(bands().filter(record => record.surface === 'desktop').at(-1)?.maxRows).toBe(8)

    const beforeLanguage = bands().length
    await $.command.run({ command: 'claudesama', args: 'lang ja', origin: PERSON, presentation: P })
    await drain()
    expect(bands().length).toBeGreaterThan(beforeLanguage)
    expect(await ui.find({ type: 'Text', text: 'Claudeさま' })).toBeDefined()

    const beforeCompaction = bands().length
    await $.session.compact({ trigger: 'auto', messages: [SUMMARY] })
    await drain()
    expect(bands().length).toBeGreaterThan(beforeCompaction)
    expect(f.records.some(record => record.step === 'compaction' && record.trigger === 'auto' && record.estimate === true)).toBe(true)

    const beforeNew = bands().length
    const another = await $.ui.mount({ surface: 'desktop', requestId: 'second-band-instance', ...band(91, false, 8) })
    await drain()
    expect(bands().length).toBeGreaterThan(beforeNew)
    expect(await another.drawn()).toBeDefined()
  })
})
