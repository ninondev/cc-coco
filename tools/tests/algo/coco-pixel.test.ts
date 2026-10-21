// Coco's pixel version in the terminal (plugin/hooks-source/coco-pixel-play.ts, DECISIONS 913, 917): the frames the
// generator packed, the cells and pictures made from them, and when a moment asks for its next frame.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PIXEL_FRAMES, PIXEL_KEY, PIXEL_MOMENTS, PIXEL_OUTFITS, PIXEL_SOCKS, PIXEL_STILLS } from '../../../plugin/hooks-source/coco-pixel'
import { PIXEL_COLUMNS, PIXEL_DOOR_COLUMNS, PIXEL_ROWS, PIXEL_SHELL_MS, pixelCells, pixelDoorCells, pixelHeld, pixelNext, pixelPng, pixelRows, pixelStep } from '../../../plugin/hooks-source/coco-pixel-play'

const ROOT = join(import.meta.dir, '../../..')
const LETTERS = new Set(['.', ...Object.keys(PIXEL_KEY), 'Q', 'V', 'J', 'q', 'v', 'X', 'Y', 'Z'])
const look = { outfit: 'A' as const, dark: true, colors: 'truecolor' as const }
const total = (steps: readonly (readonly number[])[]) => steps.reduce((a, s) => a + s[1]!, 0)
// the band's 31 actions (coco-motion.ts COCO_ACTIONS and the walk), and the terminal's own four
const ACTIONS = ['idle', 'wait', 'think', 'watch', 'petted', 'hood', 'hello', 'peek', 'doze', 'night', 'pack', 'serious', 'shell',
  'work', 'done', 'search', 'read', 'lookup', 'plan', 'run', 'coffee', 'helper', 'praised', 'pass', 'firsttry', 'out', 'error',
  'wild', 'fixed', 'teapot', 'walk', 'glance-left', 'glance-right', 'waking', 'lifted', 'dropped']
const RESTING = ['idle', 'wait', 'think', 'work', 'doze', 'night', 'lifted']

describe('the packed frames', () => {
  test('every frame is 18 rows of 24 letters from her key', () => {
    for (let i = 0; i < PIXEL_FRAMES.length; i++) {
      const rows = pixelRows(i)
      expect(rows.length).toBe(18)
      for (const row of rows) {
        expect(row.length).toBe(24)
        for (const c of row) expect(LETTERS.has(c)).toBe(true)
      }
    }
  })
  test('both outfits and all thirteen pairs colour every role', () => {
    for (const o of ['A', 'B'] as const) expect(Object.keys(PIXEL_OUTFITS[o]).sort()).toEqual(['J', 'Q', 'V'])
    expect(Object.keys(PIXEL_SOCKS).length).toBe(13)
    for (const pair of Object.values(PIXEL_SOCKS)) expect(Object.keys(pair).sort()).toEqual(['X', 'Y', 'Z'])
  })
  test('every old frame name the terminal still asks for has a still', () => {
    const art = readFileSync(join(ROOT, 'plugin/hooks-source/art.ts'), 'utf8')
    const names = [...JSON.parse(art.match(/export const FRAME_NAMES = (\[.*?\]) as const/)![1]!),
      ...JSON.parse(art.match(/export const EXTRA_FRAME_NAMES = (\[.*?\]) as const/)![1]!)] as string[]
    for (const name of names) expect(PIXEL_STILLS[name]).toBeGreaterThanOrEqual(0)
  })
})

describe('the moments', () => {
  test('the band has a moment for every action, each step a frame that exists', () => {
    for (const key of ACTIONS) {
      const m = PIXEL_MOMENTS[key]
      expect(m).toBeDefined()
      for (const s of [...m!.body, ...m!.loop]) {
        expect(s[0]).toBeLessThan(PIXEL_FRAMES.length)
        expect(s[1]).toBeGreaterThanOrEqual(50)
      }
      expect(m!.body.length + m!.loop.length).toBeGreaterThan(0)
    }
    for (const key of RESTING) expect(PIXEL_MOMENTS[key]!.loop.length).toBeGreaterThan(0)
  })
  test('a moment plays, then she holds still and asks for no more frames', () => {
    for (const key of ACTIONS) {
      if (RESTING.includes(key)) continue
      const play = pixelNext(undefined, key, 'idle', 'A', 1000)
      const body = total(PIXEL_MOMENTS[key]!.body)
      expect(pixelStep(play, 1000, true, false).next).toBeGreaterThan(0)
      expect(pixelStep(play, 1000 + body + 1, true, false).next).toBeUndefined()
    }
  })
  test('her resting loop moves only when the band may move while idle', () => {
    const idle = pixelNext(undefined, 'idle', 'idle', 'A', 0)
    expect(pixelStep(idle, 500, true, false).next).toBeUndefined()
    expect(pixelStep(idle, 500, true, true).next).toBeGreaterThan(0)
    expect(pixelStep(idle, 500, false, true).next).toBeUndefined()
  })
  test('falling asleep plays only when she may move while idle, and asleep her loop holds still', () => {
    const doze = pixelNext(undefined, 'doze', 'doze', 'A', 0)
    expect(pixelStep(doze, 10, true, false, true).next).toBeUndefined()
    expect(pixelStep(doze, 10, true, false, true).frame).toBe(PIXEL_MOMENTS.doze!.loop[0]![0])
    expect(pixelStep(doze, 10, true, true, true).next).toBeGreaterThan(0)
    expect(pixelStep(doze, total(PIXEL_MOMENTS.doze!.body) + 10, true, true, true).next).toBeUndefined()
  })
  test('the band actions of 10-16 the pixel sprites have no drawing for play as their nearest moment', () => {
    expect(pixelNext(undefined, 'nap', 'nap', 'A', 0)).toMatchObject({ action: 'doze', base: 'doze' })
    expect(pixelNext(undefined, 'breath', 'breath', 'A', 0)).toMatchObject({ action: 'idle', base: 'idle' })
    expect(pixelNext(undefined, 'catch', 'think', 'A', 0)).toMatchObject({ action: 'done', base: 'think' })
  })
  test('picked up she is startled into her hood, then peeks out; let go she is flustered', () => {
    const lifted = pixelNext(undefined, 'lifted', 'idle', 'A', 0)
    expect(pixelStep(lifted, 100, true, false).frame).toBe(PIXEL_STILLS.error)
    expect(pixelStep(lifted, 400, true, false).frame).toBe(PIXEL_STILLS.refuse)
    expect(pixelStep(pixelNext(undefined, 'dropped', 'idle', 'A', 0), 100, true, false).frame).toBe(PIXEL_STILLS.flustered)
  })
  test('a held usage limit stands for the moment with its own picture, not the plain stand, and asks for nothing', () => {
    const rest = PIXEL_MOMENTS.idle!.loop[0]![0]
    const sip = pixelHeld(pixelNext(undefined, 'coffee', 'idle', 'A', 0))
    expect(sip.frame).not.toBe(rest)
    expect(PIXEL_MOMENTS.coffee!.body.some(s => s[0] === sip.frame)).toBe(true)
    expect(pixelHeld(pixelNext(undefined, 'wait', 'wait', 'A', 0)).frame).toBe(PIXEL_MOMENTS.wait!.loop[0]![0])
  })
  test('reduced motion holds one picture for the length of the moment', () => {
    const play = pixelNext(undefined, 'petted', 'idle', 'A', 0)
    const a = pixelStep(play, 10, false, false), b = pixelStep(play, 900, false, false)
    expect(a.frame).toBe(b.frame)
  })
  test('after the shell change she stays in the outfit she changed into', () => {
    const play = pixelNext(undefined, 'shell', 'idle', 'A', 0)
    expect(pixelStep(play, 10, true, false).other).toBe(0)
    expect(pixelStep(play, PIXEL_SHELL_MS + 5, true, false).other).toBe(1)
  })
  test('the same action keeps its clock; a new explicit moment restarts it', () => {
    const a = pixelNext(undefined, 'pass', 'idle', 'A', 0, 0)
    expect(pixelNext(a, 'pass', 'idle', 'A', 500, 0)).toBe(a)
    expect(pixelNext(a, 'pass', 'idle', 'A', 500, 400).at).toBe(500)
  })
})

describe('cells and pictures', () => {
  const decode = (b64: string) => new DataView(Buffer.from(b64, 'base64').buffer)
  test('the cells fill 24 columns and 9 rows of half blocks', () => {
    expect(Buffer.from(pixelCells(0, 0, look), 'base64').length).toBe(PIXEL_COLUMNS * PIXEL_ROWS * 12)
    expect(Buffer.from(pixelDoorCells(look), 'base64').length).toBe(PIXEL_DOOR_COLUMNS * 12)
  })
  test('256-colour cells use only colours the xterm palette holds', () => {
    const levels = new Set([0, 95, 135, 175, 215, 255])
    const grey = (v: number) => v >= 8 && v <= 238 && (v - 8) % 10 === 0
    const view = decode(pixelCells(PIXEL_STILLS['idle-reading']!, 0, { ...look, colors: '256', socks: 'matcha' }))
    for (let at = 0; at < view.byteLength; at += 12) {
      for (const n of [view.getUint32(at + 4, true), view.getUint32(at + 8, true)]) {
        if (n === 0x01000000) continue
        const r = n >> 16, g = n >> 8 & 255, b = n & 255
        expect(levels.has(r) && levels.has(g) && levels.has(b) || r === g && g === b && grey(r)).toBe(true)
      }
    }
  })
  test('the outline is drawn a shade lighter on a dark terminal', () => {
    expect(pixelCells(0, 0, look)).not.toBe(pixelCells(0, 0, { ...look, dark: false }))
  })
  test('kitty and Ghostty get the same frame as a PNG, every pixel four pixels square', () => {
    const png = Buffer.from(pixelPng(PIXEL_STILLS['idle-reading']!, 0, look), 'base64')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.readUInt32BE(16)).toBe(PIXEL_COLUMNS * 4)
    expect(png.readUInt32BE(20)).toBe(PIXEL_ROWS * 2 * 4)
  })
})
