// The desktop picture's native Markdown link answers the poke without a clock tick. Touch
// overlays the current face; task/book state and the companion feed retain the real activity.
import { describe, expect, test } from 'claude-code/testing'
import { bundledSvg } from '../hooks/pictures'
import { companionPatLabel } from '../hooks/companion'
import { LANGS, WORDS } from '../hooks/words'
import { LINES } from '../hooks/lines'
import { APPROVED_PERSONA } from './approved-localization'
import { band, desktopPicture, P, PERSON, RECENT, world } from './world'

const KEY = 'claudesama:band:poke'
const LINK = { href: 'file:///claudesama-poke' }
const START = { cwd: '/tmp/poke', surface: 'desktop' as const, isInteractive: true }
const PANE = { plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const visibleTree = (tree: unknown) => JSON.parse(JSON.stringify(tree, (key, value) => key === 'press' ? undefined : value))
const svg = async (ui: Parameters<typeof desktopPicture>[0]) => String((await desktopPicture(ui))?.props.source)
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return ((node as { children?: unknown[] }).children ?? []).map(textOf).join('')
}
const speech = async (ui: { drawn: () => Promise<unknown> }) => textOf(await ui.drawn())

for (const style of ['on', 'compact'] as const) {
  test(`${style}: the picture has the exact native link, all bytes bundled, and no interactive frame`, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: style }, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    const link = await ui.find({ type: 'Markdown', key: KEY })
    expect(link).toBeDefined()
    expect(link?.props.pressableLinks).toEqual([LINK.href])
    expect((await desktopPicture(ui))?.props.alt).toContain(companionPatLabel(w.view().lang))
    expect(String(link?.props.text).length).toBeLessThanOrEqual(10000)
    expect(await svg(ui)).toBe(bundledSvg('idle-reading', style === 'on' ? 64 : 32, style === 'compact'))
    for (const image of await ui.findAll({ type: 'Svg' })) expect(image.props.isInteractive).not.toBe(true)
    expect(w.fileReads.filter(path => /[\\/]assets[\\/]/.test(path))).toEqual([])
  })
}

describe('poking is a local head pat', () => {
  test('the first redraw already shows happy and the first poke line, with no wait, state write or book change', async ($, on) => {
    let recording = false, redraws = 0, writes = 0, observedWrites = 0, nowAt = 0, firstWall: number | undefined
    on('state.set', { key: 'view' }, ($, e, next) => { observedWrites++; if (recording) writes++; return next(e) })
    on('ui.invalidate', ($, e, next) => { if (recording) { redraws++; firstWall ??= Date.now() } return next(e) })
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
    const book = await $.ui.mount({ surface: 'desktop', ...PANE })
    const beforeBook = visibleTree(await book.drawn()), beforeView = { ...w.view() }, beforeReads = w.fileReads.length
    expect(observedWrites).toBeGreaterThan(0) // the observer must see real startup publications
    recording = true; nowAt = w.clock.now()
    const began = Date.now()
    await ui.press({ key: KEY, link: LINK })
    expect(w.clock.now()).toBe(nowAt)
    expect(await svg(ui)).toBe(bundledSvg('happy', 64, false))
    expect(await speech(ui)).toContain(APPROVED_PERSONA.en.poke[0])
    expect(redraws).toBe(1)
    expect(writes).toBe(0)
    expect(w.view()).toEqual(beforeView)
    expect(visibleTree(await book.drawn())).toEqual(beforeBook)
    expect(w.fileReads.length).toBe(beforeReads)
    expect(w.opens.length).toBe(1) // only the explicitly opened settings
    console.log('POKE_METRIC '+JSON.stringify({ eventToRedrawWallMs: firstWall === undefined ? null : firstWall - began, deliberateVirtualWaitMs: w.clock.now() - nowAt, viewWrites: writes, assetReads: w.fileReads.length - beforeReads, interactiveFrames: 0 }))
    await w.clock.advance(1399)
    expect(await svg(ui)).toBe(bundledSvg('happy', 64, false))
    await w.clock.advance(1)
    expect(await svg(ui)).toBe(bundledSvg('idle-reading', 64, false))
  })

  test('rapid pokes are capped, three spaced pokes fluster him, then the current task resumes', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 'poke-work' })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await ui.press({ key: KEY, link: LINK })
    for (let i = 0; i < 20; i++) await ui.press({ key: KEY, link: LINK })
    expect(await svg(ui)).toBe(bundledSvg('happy', 64, false))
    await w.clock.advance(300); await ui.press({ key: KEY, link: LINK })
    await w.clock.advance(300); await ui.press({ key: KEY, link: LINK })
    expect(await svg(ui)).toBe(bundledSvg('flustered', 64, false))
    expect(w.view().mood).toBe('think')
    await w.clock.advance(1800)
    expect(await svg(ui)).toBe(bundledSvg('think-a', 64, false))
  })

  test('ignored rapid pokes do not extend the hold; semantic events end a pat immediately', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await ui.press({ key: KEY, link: LINK })
    await w.clock.advance(299); await ui.press({ key: KEY, link: LINK })
    await w.clock.advance(1101)
    expect(await svg(ui)).toBe(bundledSvg('idle-reading', 64, false))
    await ui.press({ key: KEY, link: LINK })
    await $.turn.start({ text: 'go', turnId: 'interrupt-pat' })
    expect(await svg(ui)).toBe(bundledSvg('think-a', 64, false))
  })

  test('working frames stay current beneath a held face without redundant desktop redraws', async ($, on) => {
    let recording = false, redraws = 0
    on('ui.invalidate', ($, e, next) => { if (recording) redraws++; return next(e) })
    const w = world(on, { store: RECENT })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 'pat-animation' })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(w.view().mood).toBe('work')
    recording = true
    await ui.press({ key: KEY, link: LINK })
    expect(redraws).toBe(1)
    await w.clock.advance(1399)
    expect(redraws).toBe(1)
    expect(await svg(ui)).toBe(bundledSvg('happy', 64, false))
    await w.clock.advance(1)
    expect(redraws).toBe(2)
    expect([bundledSvg('work-a', 64, false), bundledSvg('work-b', 64, false)]).toContain(await svg(ui))
    await w.clock.advance(2200)
    expect(redraws).toBeGreaterThan(2) // the ordinary work animation resumes after the pat
  })

  test('waiting keeps its real mood and returns within the native urgent cap', async ($, on) => {
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true }, ask: true })
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 'wait-pat' })
    await $.tool.check({ tool: 'Read', input: { file_path: '/tmp/a' }, tool_use_id: 'wait' })
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
    expect(w.view().mood).toBe('waiting')
    await ui.press({ key: KEY, link: LINK })
    expect(w.view().mood).toBe('waiting')
    await w.clock.advance(899)
    expect(await svg(ui)).toBe(bundledSvg('happy', 64, false))
    await w.clock.advance(1)
    expect(await svg(ui)).toBe(bundledSvg('waiting', 64, false))
  })

  test('Off cancels the pat and its deadline, and waking uses the original idle face', async ($, on) => {
    let redraws = 0
    const w = world(on, { store: RECENT, settings: { prefersReducedMotion: true } })
    on('ui.invalidate', ($, e, next) => { redraws++; return next(e) })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await ui.press({ key: KEY, link: LINK })
    await $.command.run({ command: 'claudesama', args: 'band off', origin: PERSON, presentation: P })
    expect(await ui.find({ type: 'Markdown', key: KEY })).toBeUndefined()
    const stopped = redraws
    await w.clock.advance(10000)
    expect(redraws).toBe(stopped)
    await ui.press({ key: 'claudesama:band:wake' })
    expect(await svg(ui)).toBe(bundledSvg('idle-reading', 64, false))
  })

  test('all twelve languages have exactly the five approved poke lines and one poke_many line', () => {
    for (const { code } of LANGS) {
      expect(LINES[code].poke).toEqual(APPROVED_PERSONA[code].poke)
      expect(LINES[code].poke_many).toEqual(APPROVED_PERSONA[code].poke_many)
    }
  })

  for (const { code } of LANGS) {
    test(`${code}: accepted pokes cycle in order, ignored pokes do not advance, and quick pokes say poke_many`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, lang: code }, settings: { prefersReducedMotion: true } })
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(140) })
      expect(w.view().lang).toBe(code)
      for (let i = 0; i < 6; i++) {
        await ui.press({ key: KEY, link: LINK })
        expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke[i % 5])
        await w.clock.advance(299); await ui.press({ key: KEY, link: LINK })
        expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke[i % 5])
        await w.clock.advance(2701)
      }
      await ui.press({ key: KEY, link: LINK })
      expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke[1])
      await w.clock.advance(300); await ui.press({ key: KEY, link: LINK })
      expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke[2])
      await w.clock.advance(300); await ui.press({ key: KEY, link: LINK })
      expect(await svg(ui)).toBe(bundledSvg('flustered', 64, false))
      expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke_many[0])
      await w.clock.advance(1799)
      expect(await svg(ui)).toBe(bundledSvg('flustered', 64, false))
      await w.clock.advance(1)
      expect(await svg(ui)).toBe(bundledSvg('idle-reading', 64, false))
      expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke_many[0])
      await w.clock.advance(800)
      expect((await speech(ui)).includes(APPROVED_PERSONA[code].poke_many[0])).toBe(false)
      await ui.press({ key: KEY, link: LINK })
      expect(await speech(ui)).toContain(APPROVED_PERSONA[code].poke[3])
    })
  }

  test('the linked picture fits the Markdown budget for every language, frame and size', () => {
    // Maximum source is measured from all shipped frame bytes; escaping stays within the host limit.
    for (const { code: lang } of LANGS) for (const frame of ['idle-reading','idle-blink','think-a','think-b','work-a','work-b','happy','error','wild-a','wild-b','sleep','wave','refuse','omen','snake','flustered'] as const) for (const pixel of [false,true]) {
      const source = bundledSvg(frame, pixel ? 32 : 64, pixel)
      const alt = `${WORDS[lang].name}, ${WORDS[lang].aside.wild}, ${companionPatLabel(lang)}`
      expect(`[![${alt}](data:image/svg+xml;base64,${btoa(source)})](${LINK.href})`.length).toBeLessThanOrEqual(10000)
    }
  })
})
