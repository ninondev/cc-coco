import { slashPath } from './file-paths'
// The band must choose the asset from the final layout height, including a narrow fallback.
// world serves PNGs carrying their requested file path, so these assertions check the image
// read and embedded by the real hook, rather than just the surrounding SVG's display size.

import { describe, expect, test } from 'claude-code/testing'
import { FRAME_NAMES } from '../hooks/art'
import { planDesktop } from '../hooks/band'
import { TERMINAL_ROWS, imageColumns, pngPath, spriteSvg } from '../hooks/pictures'
import { P, PERSON, RECENT, band, stubPng, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
type Svg = { props: Record<string, unknown> }

function assertSprite(sprite: Svg | undefined, family: 'pixel' | 'desktop'): void {
  expect(sprite).toBeDefined()
  const pixel = family === 'pixel'
  expect(sprite?.props.width).toBe(pixel ? 35 : 69)
  expect(sprite?.props.height).toBe(pixel ? 32 : 64)
  expect(sprite?.props.alt).toBe('Claude-sama, training...')
  const source = String(sprite?.props.source)
  expect(source).toContain(pixel ? 'viewBox="0 0 35 32"' : 'viewBox="0 0 137 128"')
  expect(source.includes('image-rendering:pixelated')).toBe(pixel)
  const image = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(source)
  expect(image).not.toBe(null)
  const payload = image ? atob(image[1] ?? '') : ''
  expect(slashPath(payload)).toContain(`/assets/${family}/01-idle-reading.png`)
}

describe('desktop band sprite family', () => {
  test('all sixteen registered frames resolve independently in both sprite families', { timeoutMs: 60_000 }, () => {
    expect(FRAME_NAMES.length).toBe(16)
    for (const [i, frame] of FRAME_NAMES.entries()) {
      const filename = `${String(i + 1).padStart(2, '0')}-${frame}.png`
      for (const height of [32, 64]) {
        const pixel = height === 32
        const path = `assets/${pixel ? 'pixel' : 'desktop'}/${filename}`
        expect(pngPath(frame, height)).toBe(path)
        const source = spriteSvg(frame, height, stubPng(`/test/${path}`))
        expect(source).toContain(pixel ? 'viewBox="0 0 35 32"' : 'viewBox="0 0 137 128"')
        expect(source.includes('image-rendering:pixelated')).toBe(pixel)
        const image = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(source)
        expect(image).not.toBe(null)
        expect(image ? atob(image[1] ?? '') : '').toContain(path)
      }
      expect(pngPath(frame)).toBe(`assets/desktop/${filename}`) // the terminal's existing default
    }
  })

  test('compact uses the full pixel head at its native 35 by 32 CSS pixels', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'compact' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    assertSprite((await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), 'pixel')
    expect(w.fileReads.some(path => slashPath(path).endsWith('/assets/pixel/01-idle-reading.png'))).toBe(true)
    expect(w.fileReads.some(path => slashPath(path).endsWith('/assets/desktop/01-idle-reading.png'))).toBe(false)
  })

  test('on at full size keeps the painted head at 69 by 64 CSS pixels', async ($, on) => {
    world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    assertSprite((await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), 'desktop')
  })

  test('on chooses pixels when the final narrow-width layout falls back to 32 pixels', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const columns = Array.from({ length: 77 }, (_, i) => i + 24).find(columns =>
      planDesktop(w.view(), { columns, maxRows: 30, screenRows: 48, isWorking: false }).height === 32,
    )
    expect(columns).toBeDefined()
    const ui = await $.ui.mount({ surface: 'desktop', ...band(columns ?? 24) })
    assertSprite((await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), 'pixel')
    expect(w.fileReads.some(path => slashPath(path).endsWith('/assets/pixel/01-idle-reading.png'))).toBe(true)
    expect(w.fileReads.some(path => slashPath(path).endsWith('/assets/desktop/01-idle-reading.png'))).toBe(false)
  })

  test('changing compact and on never reuses the other family for the same frame', { timeoutMs: 60_000 }, async ($, on) => {
    world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    for (const setting of ['on', 'compact', 'on', 'compact'] as const) {
      await $.command.run({ command: 'claudesama', args: `band ${setting}`, origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      assertSprite((await ui.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), setting === 'compact' ? 'pixel' : 'desktop')
      await ui.unmount()
    }
  })

  test('a short desktop uses pixels while compact terminal behavior stays one line', async ($, on) => {
    world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100, false, 3) })
    assertSprite((await desktop.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), 'pixel')
    await $.command.run({ command: 'claudesama', args: 'band compact', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    expect(await terminal.find({ type: 'Raster' })).toBe(undefined)
    expect(await terminal.find({ type: 'Image' })).toBe(undefined)
    expect(await terminal.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
  })

  test('kitty keeps its painted image, cell dimensions and accessible description', async ($, on) => {
    world(on, { store: { ...RECENT, band: 'compact' }, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
    await $.session.start(START)
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100) })
    assertSprite((await desktop.findAll({ type: 'Svg' })).find(svg => svg.props.alt === 'Claude-sama, training...'), 'pixel')
    await $.command.run({ command: 'claudesama', args: 'band on', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    const image = await terminal.find({ type: 'Image' })
    expect(image?.props.columns).toBe(imageColumns(TERMINAL_ROWS))
    expect(image?.props.rows).toBe(TERMINAL_ROWS)
    expect(image?.props.alt).toBe('Claude-sama (training...)')
    const source = image?.props.source as { png?: string } | undefined
    expect(slashPath(atob(source?.png ?? ''))).toContain('/assets/desktop/01-idle-reading.png')
  })
})
