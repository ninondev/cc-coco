import { expect, test } from 'claude-code/testing'
import { WORDS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { settleLegacyStart, P, PERSON, RECENT, SUMMARY, band, desktopPicture, world } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { C3_HEAD_MANIFEST } from './c3-head-assets'

function seeded(seed: number) {
  let x = seed >>> 0
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 }
}

for (const [index, lang] of (Object.keys(WORDS) as Lang[]).entries()) {
  test(`${lang}: seeded event stress on two mounted surfaces with short/narrow windows`, { timeoutMs: 60_000, options:{language:lang} }, async ($, on) => {
    const random = seeded(1207 + index)
    let readOwner: 'event' | 'timer' | 'idle' | 'render' = 'event'
    const manifestReads: { path: string; owner: typeof readOwner }[] = []
    const w = world(on, { store: { ...RECENT, lang }, percent: 20, settings: { prefersReducedMotion: true }, readText: path => {
      if (path.endsWith('c3-text.json')) return C3_WORDS_RAW
      if (path.endsWith('frame-manifest.json')) { manifestReads.push({ path, owner: readOwner }); return JSON.stringify(C3_HEAD_MANIFEST) }
      return undefined
    } })
    const advance = async (ms: number) => {
      const before = manifestReads.length
      readOwner = 'timer'
      await w.clock.advance(ms)
      expect(manifestReads.length).toBe(before)
      readOwner = 'event'
    }
    on('classic.SessionStart', () => ({}))
    on('session.turns', () => ({ value: 0 }))
    const start = { cwd: '/tmp/round-a-stress', surface: 'desktop' as const, isInteractive: true }
    await $.session.start(start); readOwner = 'timer'; await settleLegacyStart($,w); readOwner = 'event';
    expect(manifestReads).toEqual([]);
    readOwner = 'render'
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    expect(manifestReads).toEqual([])
    readOwner = 'event'
    let active = false
    let turn = 0
    let expectedEstimate = false
    let expectedFigure = 20
    let responseFigure = 20
    const command = async (args: string) => $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
    for (let step = 0; step < 96; step++) {
      const event = Math.floor(random() * 12)
      if (event === 0) await command(`band ${['on', 'compact', 'off'][Math.floor(random() * 3)]}`)
      else if (event === 1) await command(`lang ${lang}`)
      else if (event === 2 && !active) {
        active = true; turn++
        await $.turn.start({ text: 'go', turnId: `stress-${turn}` })
      } else if (event === 3 && active) {
        const failed = random() < 0.5
        await $.turn.complete({ answer: 'done', durationMs: 100, isAborted: failed,
          turnId: `stress-${turn}`, reason: failed ? 'error' : 'answer' })
        active = false
        if (!failed || !expectedEstimate) { expectedFigure = responseFigure; expectedEstimate = false }
      } else if (event === 4 && active) {
        w.fails = random() < 0.6
        await $.tool.call({ tool: 'Bash', command: 'npm test' })
        expectedFigure = responseFigure; expectedEstimate = false
      } else if (event === 5) {
        await $.session.compact({ trigger: random() < 0.5 ? 'manual' : 'auto', messages: [SUMMARY] })
        expectedFigure = 10; expectedEstimate = true
      } else if (event === 6) {
        const figure = Math.floor(random() * 85)
        w.percent = figure
        responseFigure = figure
        await $.session.measure({ context: { window: 200000, tokens: figure * 2000, percent: figure },
          rateLimits: [], changed: ['context'] })
        if (!expectedEstimate) expectedFigure = figure
      } else if (event === 7) {
        const columns = 24 + Math.floor(random() * 116), rows = 1 + Math.floor(random() * 6)
        await desktop.redraw(band(columns, active, rows).props)
        await terminal.redraw(band(columns, active, rows).props)
      } else if (event === 8 && w.view().band !== 'off' && await desktop.find({ type: 'Markdown', key: 'coco:band:poke' })) {
        for (let poke = 0; poke < 6; poke++) await desktop.press({ key: 'coco:band:poke', link: { href: 'file:///coco-poke' } })
      } else if (event === 9) await advance(Math.floor(random() * 5000))
      else if (event === 10 && !active) {
        await $.classic.SessionStart({ source: random() < 0.5 ? 'resume' : 'fork', session_id: `cycle-${step}`, cwd: start.cwd })
        await $.session.start(start);
        const beforeSettle = manifestReads.length
        readOwner = 'timer'; await settleLegacyStart($,w); readOwner = 'event'
        expect(manifestReads.length).toBe(beforeSettle)
        expectedFigure = w.view().context ?? 20; expectedEstimate = w.view().estimate
      } else if (event === 11) await command('settings')

      readOwner = 'render'
      for (const ui of [desktop, terminal]) {
        expect(await ui.drawn()).toBeDefined()
        expect(w.view().lang).toBe(lang)
        if (w.view().band === 'off') expect(await ui.find({ type: 'Button', key: 'coco:band:wake' })).toBeDefined()
        else expect(await ui.find({ type: 'Button', key: 'coco:book:open' })).toBeDefined()
      }
      expect(Number.isFinite(w.view().context)).toBe(true)
      // Compaction holds its estimate through stale measurements/pokes until a response
      // lands (a main-thread tool call and turn completion each prove that too).
      expect(w.view().context, `seed ${1207 + index}, step ${step}, event ${event}`).toBe(expectedFigure)
      expect(w.view().estimate).toBe(expectedEstimate)
      if (w.view().band === 'off') expect(String((await desktopPicture(desktop))?.props.source)).toContain('data:image/png;base64,')
      readOwner = 'event'
    }
    // 0.2 SPEC 6.1/6.4: pose art is loaded once on first event use; the manifest is memoized and never read by a timer or while idle.
    expect(manifestReads.length <= 1).toBe(true)
    expect(manifestReads.every(read => read.owner === 'event')).toBe(true)
    expect(w.fileReads.filter(path => /assets[\\/]frame-manifest\.json$/.test(path))).toEqual(manifestReads.map(read => read.path))
    if (active) await $.turn.complete({ answer: 'done', durationMs: 100, isAborted: true, turnId: `stress-${turn}`, reason: 'error' })
    const beforeIdle = manifestReads.length
    readOwner = 'idle'
    await w.clock.advance(60_000)
    for (const ui of [desktop, terminal]) expect(await ui.drawn()).toBeDefined()
    expect(manifestReads.length).toBe(beforeIdle)
    console.log('ROUND_A_STRESS ' + JSON.stringify({ seed: 1207 + index, lang, events: 96, surfaces: 2, manifestReads: manifestReads.length, timerManifestReads: manifestReads.filter(read => read.owner === 'timer').length, idleManifestReads: manifestReads.filter(read => read.owner === 'idle').length }))
  })
}
