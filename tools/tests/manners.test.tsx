// C11 colour hardening and C13 good manners in the shared band.

import { describe, expect, test } from 'claude-code/testing'
import { FRAME_NAMES } from '../hooks/art'
import { TERMINAL_ROWS, spriteCells } from '../hooks/pictures'
import { RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const DEFAULT = 0x01000000

function cellsOf(base64: string): number[][] {
  const bin = atob(base64)
  const view = new DataView(Uint8Array.from(bin, ch => ch.charCodeAt(0)).buffer)
  const out: number[][] = []
  for (let at = 0; at < view.byteLength; at += 12) {
    out.push([view.getUint32(at, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true)])
  }
  return out
}

const LEVELS = [0, 95, 135, 175, 215, 255]
const XTERM = new Set<number>()
for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) XTERM.add((r << 16) | (g << 8) | b)
for (let i = 0; i < 24; i++) {
  const v = 8 + 10 * i
  XTERM.add((v << 16) | (v << 8) | v)
}

describe('colour', () => {
  test('every terminal frame stays within a colour-pair budget of 128 (the terminal paints 1024)', { timeoutMs: 60_000 }, () => {
    for (const colors of ['truecolor', '256'] as const) {
      let most = 0
      for (const frame of FRAME_NAMES) {
        const pairs = new Set(cellsOf(spriteCells(frame, colors)).map(([, fg, bg]) => `${fg}/${bg}`))
        most = Math.max(most, pairs.size)
        expect(pairs.size).toBeLessThanOrEqual(128)
      }
      console.log(`colour pairs, most in one frame (${colors}): ${most}`)
    }
  })

  test('Terminal.app without COLORTERM draws only colours of the xterm 256 palette', async ($, on) => {
    world(on, { store: RECENT, env: { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color', LANG: 'en_US.UTF-8' } })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
    const raster = await ui.find({ type: 'Raster' })
    const colours = cellsOf(String(raster?.props.cells)).flatMap(([, fg, bg]) => [fg, bg]).filter(c => c !== DEFAULT)
    expect(colours.length).toBeGreaterThan(0)
    expect(colours.every(c => XTERM.has(c ?? -1))).toBe(true)
  })

  test('tmux without COLORTERM falls back to 256 colours; COLORTERM=truecolor keeps 24-bit', async ($, on) => {
    const w = world(on, { store: RECENT, env: { TMUX: '/tmp/tmux-501/default,1,0', TERM: 'tmux-256color', TERM_PROGRAM: 'iTerm.app' } })
    await $.session.start(START)
    expect(w.view().colors).toBe('256')
  })

  test('a terminal that says truecolor gets the full palette', async ($, on) => {
    const w = world(on, { store: RECENT, env: { TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
    await $.session.start(START)
    expect(w.view().colors).toBe('truecolor')
  })
})

describe('sharing the band', () => {
  test('nobody else in the band: his picture shows', async ($, on) => {
    world(on, { store: RECENT })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, false, 30) })
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
  })

  test("another mod's 25 rows in a 30-row band: he steps down to one line", async ($, on) => {
    world(on, { store: RECENT, theirsRows: 25 })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, false, 30) })
    expect(await ui.find({ type: 'Raster' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /another mod, row 25/ })).toBeDefined()
  })

  test('room for both: 30 rows with 10 of theirs keeps his picture', async ($, on) => {
    world(on, { store: RECENT, theirsRows: 10 })
    await $.session.start(START)
    const ui = await $.ui.mount({ surface: 'terminal', ...band(100, false, 30) })
    expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(TERMINAL_ROWS)
  })

  test('even when others fill the band he keeps his one line', async ($, on) => {
    world(on, { store: RECENT, theirsRows: 40 })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ surface, ...band(100, false, 30) })
      expect(await ui.find({ type: 'Text', text: 'Claude-sama' })).toBeDefined()
    }
  })
})
