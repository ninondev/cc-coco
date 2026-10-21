// The focus bar in plugin/hooks-source/play-focus.ts against the design's own rows (play_sprites.py focus_bar, 10-14).
import { describe, expect, test } from 'bun:test'
import { FOCUS_CELLS, focusBarRows, focusBarSvg, focusBarText, focusDone } from '../../../plugin/hooks-source/play-focus'

const EXPECT: Record<string, string[]> = {"bar0": [".......................................", ".dd...dd...dd...dd...dd...dd...dd...dd.", ".dd...dd...dd...dd...dd...dd...dd...dd.", "......................................."], "bar3": ["OOOO.OOOO.OOOO.........................", "OrRO.OrRO.OrRO..dd...dd...dd...dd...dd.", "ORqO.ORqO.ORqO..dd...dd...dd...dd...dd.", "OOOO.OOOO.OOOO........................."], "bar8": ["OOOO.OOOO.OOOO.OOOO.OOOO.OOOO.OOOO.OOOO", "OrRO.OrRO.OrRO.OrRO.OrRO.OrRO.OrRO.OrRO", "ORqO.ORqO.ORqO.ORqO.ORqO.ORqO.ORqO.ORqO", "OOOO.OOOO.OOOO.OOOO.OOOO.OOOO.OOOO.OOOO"]}
const M = 60_000, focus = { startedAt: 0, endsAt: 25 * M }

describe('the focus bar', () => {
  test('none, three and all eight cells match the design row for row', () => {
    expect(focusBarRows(0)).toEqual(EXPECT.bar0!)
    expect(focusBarRows(3)).toEqual(EXPECT.bar3!)
    expect(focusBarRows(8)).toEqual(EXPECT.bar8!)
  })
  test('one cell an eighth of the focus: 25 minutes, a cell every 3 minutes 7.5 seconds', () => {
    expect(focusDone(focus, 0)).toBe(0)
    expect(focusDone(focus, 3 * M + 7_499)).toBe(0)
    expect(focusDone(focus, 3 * M + 7_500)).toBe(1)
    expect(focusDone(focus, 10 * M)).toBe(3)
    expect(focusDone(focus, 30 * M)).toBe(FOCUS_CELLS)
  })
  test('each cell still to come lights itself once at its time; nothing repeats', () => {
    const svg = focusBarSvg(focus, 10 * M)
    expect(svg).toContain('.c3{opacity:0;animation:on 1ms forwards;animation-delay:150000ms}')
    expect(svg).toContain('.c7{opacity:0;animation:on 1ms forwards;animation-delay:'+String(15 * M)+'ms}')
    expect(svg).not.toContain('.c2{')
    expect(svg).not.toContain('infinite')
    expect(focusBarSvg(focus, 10 * M, true)).not.toContain('animation')
  })
  test('the terminal cells', () => {
    expect(focusBarText(3)).toBe('▪▪▪▫▫▫▫▫')
  })
})
