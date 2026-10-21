// The thermos in plugin/hooks-source/play-thermos.ts against the design's own rows (play_sprites.py THERMOS, 10-14).
import { describe, expect, test } from 'bun:test'
import { THERMOS_PX, THERMOS_ROWS, thermosSvg } from '../../../plugin/hooks-source/play-thermos'

const DESIGN = ['.OOOOO.', '.OmmmO.', 'OOOOOOO', 'OhcccsO', 'OhcccsO', 'OhwwwsO', 'OhcccsO', 'OhcccsO', 'OhcccsO', '.OOOOO.']

describe('the thermos', () => {
  test('matches the design row for row', () => {
    expect([...THERMOS_ROWS]).toEqual(DESIGN)
    expect(THERMOS_PX).toEqual({ width: 7, height: 10 })
  })
  test('is drawn at its scale, its edge outline in the class that lightens on a dark ground, the same every time', () => {
    const svg = thermosSvg(2)
    expect(svg).toContain('viewBox="0 0 7 10" width="14" height="20"')
    expect(svg).toContain('class="e"')
    expect(svg).toContain('fill="#D97757"')
    expect(svg).toContain('fill="#C9C2BC"')
    expect(svg).toBe(thermosSvg(2))
    expect(thermosSvg(3)).toContain('width="21" height="30"')
    // in the band it takes the cup's own 16 x 22 place
    expect(thermosSvg(2, true)).toContain('viewBox="-0.5 -0.5 8 11" width="16" height="22"')
  })
})
