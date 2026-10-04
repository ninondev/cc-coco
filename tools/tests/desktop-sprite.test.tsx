// Style selection checks actual bundled PNG bytes, separately verified against shipped assets.
// Display size may compact Painted without changing its family.

import { describe, expect, test } from 'claude-code/testing'
import { FRAME_NAMES } from '../hooks/art'
import { planDesktop } from '../hooks/band'
import { TERMINAL_ROWS, bundledSvg, imageColumns, pngPath, spriteSvg } from '../hooks/pictures'
import { REST_FRAMES } from '../hooks/rest-frames'
import { PAINTED_FRAMES } from '../hooks/painted-frames'
import { P, PERSON, RECENT, band, desktopPicture, stubPng, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
type Svg = { props: Record<string, unknown> }

function assertSprite(sprite: Svg | undefined, family: 'pixel' | 'desktop', height = family === 'pixel' ? 32 : 64): void {
  expect(sprite).toBeDefined()
  const pixel = family === 'pixel'
  expect(sprite?.props.width).toBe(Math.round((pixel ? 35 / 32 : 137 / 128) * height))
  expect(sprite?.props.height).toBe(height)
  expect(sprite?.props.alt).toBe('Claude-sama, training..., pat his head')
  const source = String(sprite?.props.source)
  expect(source).toContain(pixel ? 'viewBox="0 0 35 32"' : 'viewBox="0 0 137 128"')
  expect(source.includes('image-rendering:pixelated')).toBe(pixel)
  const image = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(source)
  expect(image).not.toBe(null)
  expect(image?.[1]).toBe((pixel ? REST_FRAMES : PAINTED_FRAMES)['idle-reading'])
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
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(ui), 'pixel')
    expect(w.fileReads.some(path => /[\\/]assets[\\/]/.test(path))).toBe(false)
  })

  test('on at full size keeps the painted head at 69 by 64 CSS pixels', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(ui), 'desktop')
  })

  for (const workSize of [undefined, 'smaller'] as const) {
    test(`Painted working keeps ${workSize === 'smaller' ? 'the selected smaller 34 by 32' : 'the default resting 69 by 64'} picture`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, band: 'on', ...(workSize ? { workSize } : {}) } })
      await $.session.start(START)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      const sprite = await desktopPicture(ui)
      const height = workSize === 'smaller' ? 32 : 64
      expect(sprite).toBeDefined()
      expect(sprite?.props.width).toBe(Math.round(137 / 128 * height))
      expect(sprite?.props.height).toBe(height)
      expect(sprite?.props.alt).toBe('Claude-sama, rereading a line, pat his head')
      expect(sprite?.props.source).toBe(bundledSvg('think-a', height, false))
      expect(String(sprite?.props.source)).toContain('viewBox="0 0 137 128"')
      expect(String(sprite?.props.source)).not.toContain('image-rendering:pixelated')
      const image = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(String(sprite?.props.source))
      expect(image?.[1]).toBe(PAINTED_FRAMES['think-a'])
      expect(w.fileReads.some(path => /[\\/]assets[\\/]/.test(path))).toBe(false)
    })
  }

  test('on keeps painted smooth when the final narrow-width layout falls back to 32 pixels', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const columns = Array.from({ length: 77 }, (_, i) => i + 24).find(columns =>
      planDesktop(w.view(), { columns, maxRows: 30, screenRows: 48, isWorking: false }).height === 32,
    )
    expect(columns).toBeDefined()
    const ui = await $.ui.mount({ surface: 'desktop', ...band(columns ?? 24) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(ui), 'desktop', 32)
    expect(w.fileReads.some(path => /[\\/]assets[\\/]/.test(path))).toBe(false)
  })

  test('changing compact and on never reuses the other family for the same frame', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    for (const setting of ['on', 'compact', 'on', 'compact'] as const) {
      await $.command.run({ command: 'claudesama', args: `band ${setting}`, origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
      assertSprite(await desktopPicture(ui), setting === 'compact' ? 'pixel' : 'desktop')
      await ui.unmount()
    }
  })

  test('a short desktop keeps painted while compact terminal behavior stays one line', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START)
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100, false, 3) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(desktop), 'desktop', 32)
    await $.command.run({ command: 'claudesama', args: 'band compact', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await terminal.find({ type: 'Raster' })).toBe(undefined)
    expect(await terminal.find({ type: 'Image' })).toBe(undefined)
    expect(await terminal.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
  })

  test('kitty keeps its painted image, cell dimensions and accessible description', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'compact' }, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
    await $.session.start(START)
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(desktop), 'pixel')
    await $.command.run({ command: 'claudesama', args: 'band on', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    const image = await terminal.find({ type: 'Image' })
    expect(image?.props.columns).toBe(imageColumns(TERMINAL_ROWS))
    expect(image?.props.rows).toBe(TERMINAL_ROWS)
    expect(image?.props.alt).toBe('Claude-sama (training...)')
    const source = image?.props.source as { png?: string } | undefined
    expect(source?.png).toBe(PAINTED_FRAMES['idle-reading'])
  })
})
