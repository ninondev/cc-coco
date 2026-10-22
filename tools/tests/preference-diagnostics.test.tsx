import { DIAGNOSTIC_APPEND } from '../hooks/shared-files'
// Real engine mounts before process start. All filesystem/process operations below are mocks.
// No diagnostics flag is created. Lifecycle flags model the classic API's separate start event.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { CocoView } from '../types'
import { initialView } from '../hooks/mood'
import { MORNING, P, PERSON, RECENT, SUMMARY, band, cocoBandText, desktopPicture } from './world'
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'
import { samePath } from './file-paths'

const HOME = '/tmp/diagnostic-fixture'
const START = { cwd: '/tmp/private-project', surface: 'desktop' as const, isInteractive: true }
function fixture(on: On, store: Record<string, unknown>, enabled = false, held?: CocoView) {
  const clock = mock.clock(on, { now: MORNING })
  mock.store(on, { ...RECENT, ...store,bandSettings:store })
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  if (held) cells.set('view', { value: held, version: 7 })
  const exists: string[] = [], reads: string[] = [], wordReads: ('gaps'|'more')[] = [], motionReads: string[] = [], records: Record<string, unknown>[] = []
  let invalidations = 0, draws = 0, blits = 0
  const blitPictures = new Set<string>()
  const surfaceDraws = new Map<string, number>()
  on('state.get', async ($, e, next) => { await next(e); return { value: cells.get(e.key) ?? { value: undefined, version: 0 } } as never })
  on('state.set', async ($, e, next) => { const result = await next(e); const version = result.value?.version ?? (cells.get(e.key)?.version ?? 0) + 1; cells.set(e.key, { value: e.value, version }); return result })
  on('settings.read', () => ({ value: { timeZone: 'UTC' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 20, tokens: 40000, breakdown: { totalTokens: 24000 } }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.root', () => ({ value: START.cwd }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', ($, e) => { exists.push(e.path); return { value: samePath(e.path, `${HOME}/Library/Application Support/Coco/diagnostics`) && enabled } })
  on('fs.read', ($, e) => {
    if (/[\\/]hooks[\\/]gaps-text\.json$/.test(e.path)) { wordReads.push('gaps'); return {value:M1_GAPS_TEXT} as never }
    if (/[\\/]hooks[\\/]more-text\.json$/.test(e.path)) { wordReads.push('more'); return {value:M1_MORE_TEXT} as never }
    // the bag's word (👜 设置) is read once beside her pictures (10-18); it is no diagnostic read
    if (/[\\/]hooks[\\/]bag-text\.json$/.test(e.path)) return {value:'{}'} as never
    const coco = cocoBandText(e.path); if (coco !== undefined) { motionReads.push(e.path); return {value:coco} as never }
    reads.push(e.path)
    if(/[\\/]assets[\\/]frame-manifest\.json$/.test(e.path))return{value:JSON.stringify(C3_HEAD_MANIFEST)}
    throw new Error('No file read is available on this path')
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    if ((e.argv[0] === '/bin/sh' && e.argv[1] === '-c' && e.argv[2] === DIAGNOSTIC_APPEND)) for (const line of (e.init?.stdin ?? '').trim().split('\n')) if (line) records.push(JSON.parse(line))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.invalidate', ($, e, next) => { invalidations++; return next(e) })
  // Model the terminal host's accepted blit response as world.tsx does,
  // while checking every actual shipping cell payload below.
  on('ui.blit', ($, e) => { blits++; if ('cells' in e) blitPictures.add(e.cells); return { value: {} } })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('command.run', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => { if (e.component === 'AbovePrompt') { draws++; surfaceDraws.set(e.surface, (surfaceDraws.get(e.surface) ?? 0) + 1) } return <></> })
  return { clock, cells, exists, reads, wordReads, motionReads, records, invalidations: () => invalidations, blits: () => blits, blitPictures, draws: (surface?: string) => surface === undefined ? draws : surfaceDraws.get(surface) ?? 0 }
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
    test(`${source}: ${chosen}, Japanese, no asset or startup dependency`, {options:{band:chosen,language:'ja'}}, async ($, on) => {
      const f = fixture(on, { band: chosen, bandBeforeOff: 'compact', lang: 'ja' })
      if (source !== 'fresh') await $.classic.SessionStart({ source, session_id: source + '-session', cwd: START.cwd })
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      expect(f.reads).toEqual([]);expect(f.wordReads).toEqual([]);expect(f.motionReads).toEqual([])
      if(chosen==='off'){
        // Cold options know Off and Japanese; the previous style arrives via lifecycle hydration.
        expect(await ui.find({type:'Button',key:'coco:band:wake'})).toBeDefined()
        await $.session.start(START);await f.clock.advance(0)
        for(let i=0;i<20;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P})
      }
      const svgs = await ui.findAll({ type: 'Svg' })
      const sprite = await desktopPicture(ui)
      expect(sprite).toBeDefined()
      expect(String(sprite?.props.alt).startsWith('Coco')).toBe(true)
      if (chosen === 'off') {
        // the door: Coco napping on the shut laptop, from their bundled rest, held still, whichever size she wakes to
        expect(String(sprite?.props.source)).toContain('data-coco="A nap"')
        expect(sprite?.props.height).toBe(32)
        expect(String(sprite?.props.source).includes('image-rendering:pixelated')).toBe(false)
      } else {
        // the band draws Coco from her bundled rest (coco-stills.ts), pictures 128 px tall, in both sizes
        expect(String(sprite?.props.source)).toContain('data-coco="A idle"')
        expect(pngSize(sprite?.props.source)?.[1]).toBe(128)
        expect(String(sprite?.props.source).includes('image-rendering:pixelated')).toBe(false)
      }
      if (chosen === 'off') {
        expect(sprite?.props.alt).toBe('Coco、ねむっている')
        expect((await ui.find({ type: 'Button', key: 'coco:band:wake' }))?.props.label).toBe('Cocoを起こす')
        expect(svgs.length).toBe(1)
        const redraws = f.invalidations()
        const firstTree = await ui.drawn()
        await f.clock.advance(60_000)
        expect(f.invalidations()).toBe(redraws)
        expect(await ui.drawn()).toEqual(firstTree)
      } else expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()
      expect(f.reads).toEqual([])
      expect(f.wordReads).toEqual(chosen==='off'?['gaps']:[])
    })
  }
})

describe('restored cold state and animation do not reset each other', () => {
  test('restored desktop work retains one animated eyes-up picture after lifecycle hydration',{options:{language:'ja'}},async($,on)=>{
    const f=fixture(on,{},false,{...initialView(),lang:'ja',band:'on'})
    const ui=await $.ui.mount({surface:'desktop',...band(100,true)})
    // Coco's first answer is her bundled think loop (coco-stills.ts), already moving
    expect(String((await desktopPicture(ui))?.props.source)).toContain('data-coco="A think"')
    expect(String((await desktopPicture(ui))?.props.alt).startsWith('Coco')).toBe(true)
    expect((await desktopPicture(ui))?.props.alt).not.toContain('修行中')
    expect(f.reads).toEqual([]);expect(f.wordReads).toEqual([]);expect(f.motionReads).toEqual([])
    await $.session.start(START);await f.clock.advance(0);await ui.redraw(band(100,true).props)
    for(let i=0;i<20;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P})
    await f.clock.advance(0)
    const picture=String((await desktopPicture(ui))?.props.source)
    expect(picture).toContain('@keyframes');expect(picture).toContain('data-coco="A think"')
    expect((await desktopPicture(ui))?.props.alt).not.toContain('修行中')
    expect(f.wordReads).toEqual(['gaps']);const wordReads=[...f.wordReads],motionReads=[...f.motionReads]
    const redraws=f.invalidations();await f.clock.advance(3000)
    expect(String((await desktopPicture(ui))?.props.source)).toBe(picture);expect(f.invalidations()).toBe(redraws)
    await ui.redraw(band(100,true).props);expect(String((await desktopPicture(ui))?.props.source)).toBe(picture);expect(f.reads).toEqual([]);expect(f.wordReads).toEqual(wordReads);expect(f.motionReads).toEqual(motionReads)
  })

})

describe('diagnostics are cached and content-free', () => {
  test('cached OFF adds no exists/read/log operation per terminal animation frame', async ($, on) => {
    const f = fixture(on, {})
    await $.session.start({ ...START, surface: 'terminal' });await f.clock.advance(0)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    for(let i=0;i<20;i++)await $.command.run({command:'b1b-host-boundary',args:'',origin:PERSON,presentation:P})
    expect(f.wordReads).toEqual(['gaps']);const wordReads=[...f.wordReads],motionReads=[...f.motionReads]
    const before = f.exists.length
    await f.clock.advance(60_000)
    expect(f.exists.length).toBe(before)
    expect(f.reads).toEqual([]);expect(f.wordReads).toEqual(wordReads);expect(f.motionReads).toEqual(motionReads)
    expect(f.records).toEqual([])
  })

  test('render, push and compaction schemas expose only bounded metadata', async ($, on) => {
    const f = fixture(on, {}, true)
    await $.session.start(START);await f.clock.advance(0)
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
    const allowed = new Set(['at', 'step', 'message', 'surface', 'isWorking', 'bodyColumns', 'maxRows', 'style', 'height', 'fallback', 'version', 'published', 'trigger', 'tokensAfter', 'context', 'estimate', 'startup','activationId','sessionId','requestId','engineVersion','enteredAt','steps','ownMs','totalMs','renderCount'])
    for (const record of f.records) for (const key of Object.keys(record)) expect(allowed.has(key), `Unexpected diagnostic field ${key}`).toBe(true)
    const desktopReturns=f.records.filter(record=>record.step==='returned-tree'&&record.surface==='desktop')
    expect(desktopReturns.length).toBeGreaterThan(0)
    for(const record of desktopReturns){expect(Number.isSafeInteger(record.renderCount)).toBe(true);expect(record.renderCount).toBeGreaterThan(0)}
    for(const record of f.records.filter(record=>record.surface!=='desktop'))expect(record.renderCount).toBeUndefined()
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
    await $.session.start(START);await f.clock.advance(0)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    // Frame changes must not add diagnostics on either attached band.
    const terminal = await $.ui.mount({ surface: 'terminal', requestId: 'mixed-terminal-instance', ...band(80) })
    const bands = () => f.records.filter(record => record.step === 'band')
    const drain = async () => { await f.clock.advance(0); for (let i = 0; i < 8; i++) await $.command.run({ command: 'model', args: '', origin: PERSON, presentation: P }) }
    await drain()
    expect(f.wordReads).toEqual(['gaps']);const wordReads=[...f.wordReads],motionReads=[...f.motionReads]
    const baseline = bands().length
    expect(baseline).toBeGreaterThan(0)
    const redraws = f.draws('desktop')
    const globalRedraws = f.invalidations()
    const terminalRedraws = f.draws('terminal')
    const terminalBlits = f.blits()
    const pictures = new Set<string | undefined>()
    // Seeded observation cadence remains below the model's 100 ms minimum closed-eye hold.
    // Production blink holds are untouched; sixty seconds exceeds its maximum interval.
    const random = seeded(89)
    for (let elapsed = 0; elapsed < 60_000;) {
      const step = Math.min(50 + Math.floor(random() * 25), 60_000 - elapsed)
      elapsed += step
      await f.clock.advance(step)
      const sprite = await desktopPicture(ui)
      expect(String(sprite?.props.alt).startsWith('Coco,')).toBe(true)
      pictures.add(payload(sprite?.props.source))
      const terminalSprite = await terminal.find({ type: 'Raster', key: 'sprite' })
      expect(terminalSprite).toBeDefined()
    }
    await drain()
    // B1's desktop image animates itself; B4's frame-payload checks remain on the
    // terminal blit path within the same minute and closed-eye observation budget.
    expect(pictures.size).toBe(1)
    expect(f.draws('desktop')).toBe(redraws)
    expect(f.invalidations()).toBe(globalRedraws)
    expect(f.blitPictures.size).toBeGreaterThanOrEqual(2)
    expect(f.blits()).toBeGreaterThan(terminalBlits)
    expect(f.draws('terminal')).toBe(terminalRedraws)
    expect(bands().length).toBe(baseline)
    expect(f.reads).toEqual([]);expect(f.wordReads).toEqual(wordReads);expect(f.motionReads).toEqual(motionReads)

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
    await $.command.run({ command: 'coco', args: 'lang ja', origin: PERSON, presentation: P })
    await drain()
    expect(bands().length).toBeGreaterThan(beforeLanguage)
    expect(await ui.find({ type: 'Text', text: 'Coco' })).toBeDefined()

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
