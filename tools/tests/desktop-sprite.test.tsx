// Style selection checks actual bundled PNG bytes, separately verified against shipped assets.
// Display size may compact Painted without changing its family.

import { describe, expect, test } from 'claude-code/testing'
import { planDesktop } from '../hooks/band'
import { TERMINAL_ROWS, imageColumns } from '../hooks/pictures-lazy'
import { COCO_RESTING } from '../hooks/coco-stills'
import { PIXEL_STILLS } from '../hooks/coco-pixel'
import { pixelPng } from '../hooks/coco-pixel-play'
import { settleLegacyStart, P, PERSON, RECENT, band, desktopPicture, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
type Svg = { props: Record<string, unknown> }

// The desktop band draws Coco (coco-motion.ts) in both sizes: her painted clips, no pixel family until
// her pixel art arrives. The width follows her canvas, written to two decimals.
const [COCO_WIDTH, COCO_HEIGHT] = COCO_RESTING.A.canvas
const cocoViewBox = `viewBox="0 0 ${COCO_WIDTH} ${COCO_HEIGHT}"`
const cocoWidth = (height: number) => Number((height * COCO_WIDTH / COCO_HEIGHT).toFixed(2))
const assetRead = (path: string) => /[\\/]assets[\\/]/.test(path) && !/[\\/]assets[\\/]coco[\\/]band-[AB]\.json$/.test(path)
function assertSprite(sprite: Svg | undefined, family: 'pixel' | 'desktop', height = family === 'pixel' ? 32 : 64, action = 'idle'): void {
  expect(sprite).toBeDefined()
  const source = String(sprite?.props.source)
  expect(sprite?.props.width).toBe(cocoWidth(height))
  expect(sprite?.props.height).toBe(height)
  expect(sprite?.props.alt).toBe("Coco, curled up in the cup, pat coco's head")
  expect(source).toContain(cocoViewBox)
  expect(source).toContain(`data-coco="A ${action}"`)
  expect(source.includes('image-rendering:pixelated')).toBe(false)
  expect(/data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(source)).not.toBe(null)
}

describe('desktop band sprite family', () => {
  test('compact draws Coco at 32 CSS pixels tall', {options:{band:'compact'}}, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'compact' } })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(ui), 'pixel')
    expect(w.fileReads.some(assetRead)).toBe(false)
  })

  test('on at full size draws Coco at 64 CSS pixels tall', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START); await settleLegacyStart($,w);
    const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(ui), 'desktop')
  })

  for (const workSize of [undefined, 'smaller'] as const) {
    test(`Painted working keeps ${workSize === 'smaller' ? 'the selected smaller 32 pixel height' : 'the default resting 64 pixel height'} picture`, async ($, on) => {
      const w = world(on, { store: { ...RECENT, band: 'on', ...(workSize ? { workSize } : {}) } })
      await $.session.start(START); await settleLegacyStart($,w);
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100, true) })
      const sprite = await desktopPicture(ui)
      const height = workSize === 'smaller' ? 32 : 64
      expect(sprite).toBeDefined()
      expect(sprite?.props.width).toBe(cocoWidth(height))
      expect(sprite?.props.height).toBe(height)
      expect(sprite?.props.alt).toBe("Coco, chin in hand, thinking, pat coco's head")
      expect(String(sprite?.props.source)).toContain('@keyframes')
      expect(String(sprite?.props.source)).toContain('data-coco="A think"')
      expect(String(sprite?.props.source)).toContain(cocoViewBox)
      expect(String(sprite?.props.source)).not.toContain('image-rendering:pixelated')
      expect(w.fileReads.some(assetRead)).toBe(false)
    })
  }

  // BAND 3.2 (owner 04:22, «选手绘就一直手绘，干活或窄时只缩小»): the painted band stays painted and shrinks to 32 px only where the
  // cue line cannot hold his name beside the 64 px picture; it never turns into the pixel family.
  test('on draws Coco 64 pixels tall, 32 only where a narrow floor would drop the context number', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START); await settleLegacyStart($,w);
    for (const columns of [24, 48, 77, 100]) {
      const height = planDesktop(w.view(), { columns, maxRows: 30, screenRows: 48, isWorking: false }).height
      // 10-18 (CANON 199): 32 px only on a narrow band whose floor would otherwise drop the context number
      if (columns > 24) expect([columns, height]).toEqual([columns, 64])
      expect([32, 64]).toContain(height)
      const ui = await $.ui.mount({ surface: 'desktop', ...band(columns) })
      await w.clock.advance(0)
      assertSprite(await desktopPicture(ui), 'desktop', height)
      await ui.unmount()
    }
    expect(w.fileReads.some(assetRead)).toBe(false)
  })

  test('changing compact and on keeps Coco at each size', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START); await settleLegacyStart($,w);
    for (const setting of ['on', 'compact', 'on', 'compact'] as const) {
      await $.command.run({ command: 'coco', args: `band ${setting}`, origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...band(100) })
      await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
      assertSprite(await desktopPicture(ui), setting === 'compact' ? 'pixel' : 'desktop')
      await ui.unmount()
    }
  })

  test('a short desktop draws Coco at 32 while compact terminal behavior stays one line', async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'on' } })
    await $.session.start(START); await settleLegacyStart($,w);
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100, false, 3) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(desktop), 'desktop', 32)
    await $.command.run({ command: 'coco', args: 'band compact', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    expect(await terminal.find({ type: 'Raster' })).toBe(undefined)
    expect(await terminal.find({ type: 'Image' })).toBe(undefined)
    expect(await terminal.find({ type: 'Text', text: 'Coco' })).toBeDefined()
  })

  // kitty and Ghostty draw her pixel version as a picture (DECISIONS 917), in the same 24 by 9 cells as the half blocks
  test('kitty keeps the terminal pixel image, cell dimensions and accessible description', {options:{band:'compact'}}, async ($, on) => {
    const w = world(on, { store: { ...RECENT, band: 'compact' }, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
    await $.session.start(START); await settleLegacyStart($,w);
    const desktop = await $.ui.mount({ surface: 'desktop', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    assertSprite(await desktopPicture(desktop), 'pixel')
    await $.command.run({ command: 'coco', args: 'band on', origin: PERSON, presentation: P })
    const terminal = await $.ui.mount({ surface: 'terminal', ...band(100) })
    await w.clock.advance(0) // the deferred asset load must invalidate this mounted band
    const image = await terminal.find({ type: 'Image' })
    expect(image?.props.columns).toBe(imageColumns(TERMINAL_ROWS))
    expect(image?.props.rows).toBe(TERMINAL_ROWS)
    expect(image?.props.alt).toBe('Coco (swinging legs)')
    const source = image?.props.source as { png?: string } | undefined
    expect(source?.png).toBe(pixelPng(PIXEL_STILLS['idle-reading']!, 0, { outfit: 'A', dark: true, colors: 'truecolor' }))
  })
})
