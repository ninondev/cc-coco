// The commit line in plugin/hooks-source/play-commits.ts against the design's own rows (play_sprites.py, 10-14).
import { describe, expect, test } from 'bun:test'
import { commitCount, commitLineRows, commitPushedRows, commitFlatRows, commitRoundRows, commitLineSvg, commitLineText, contextTokensText } from '../../../plugin/hooks-source/play-commits'

const EXPECT: Record<string, string[]> = {"line1": [".OOO.............................", "OrrRO............................", "OrRqO............................", "ORqqO............................", ".OOO............................."], "line2": [".OOO....OOO......................", "OrrRO..OrrRO.....................", "OrRqOOOOrRqO.....................", "ORqqO..ORqqO.....................", ".OOO....OOO......................"], "line3": [".OOO....OOO....OOO...............", "OrrRO..OrrRO..OrrRO..............", "OrRqOOOOrRqOOOOrRqO..............", "ORqqO..ORqqO..ORqqO..............", ".OOO....OOO....OOO..............."], "line4": [".OOO....OOO....OOO....OOO........", "OrrRO..OrrRO..OrrRO..OrrRO.......", "OrRqOOOOrRqOOOOrRqOOOOrRqO.......", "ORqqO..ORqqO..ORqqO..ORqqO.......", ".OOO....OOO....OOO....OOO........"], "line5": [".OOO....OOO....OOO....OOO....OOO.", "OrrRO..OrrRO..OrrRO..OrrRO..OrrRO", "OrRqOOOOrRqOOOOrRqOOOOrRqOOOOrRqO", "ORqqO..ORqqO..ORqqO..ORqqO..ORqqO", ".OOO....OOO....OOO....OOO....OOO."], "pushed": [".OOOOOOOOOOOOOOO.", "OrrOrrOrrOrrOrrRO", "OrROrROrROrROrRqO", "ORqORqORqORqORqqO", ".OOOOOOOOOOOOOOO."], "flat": ["..OOOOOOO..", ".OrrrRRRRO.", "OrRRRRRRRqO", ".OqqqqqqqO.", "..OOOOOOO.."], "round": [".OOOO.", "OrrRRO", "OrRRqO", "ORRqqO", "OqqqqO", ".OOOO."]}

describe('the commit line', () => {
  test('one to five commits match the design row for row', () => {
    for (let n = 1; n <= 5; n++) expect(commitLineRows(n)).toEqual(EXPECT['line' + n]!)
  })
  test('the squash frames match the design: pushed together, flat, round', () => {
    expect(commitPushedRows()).toEqual(EXPECT.pushed!)
    expect(commitFlatRows()).toEqual(EXPECT.flat!)
    expect(commitRoundRows()).toEqual(EXPECT.round!)
  })
  test('one commit a fifth of the window, at least one once there is a reading', () => {
    expect([null, 0, 9, 30, 64, 70, 95, 100].map(p => commitCount(p))).toEqual([0, 1, 1, 2, 3, 4, 5, 5])
  })
  test('the squash plays once and rests on the round commit; reduced motion shows only that', () => {
    const svg = commitLineSvg(3, 'squash')
    expect(svg).toContain('width="50" height="9"')
    expect(svg).toContain('forwards')
    expect(svg).not.toContain('infinite')
    expect(svg).toContain('@media(prefers-reduced-motion:reduce){.s{animation:none}.s3{opacity:1}}')
  })
  test('the terminal draws one cell a commit, one while squashed', () => {
    expect(commitLineText(3)).toBe('◉◉◉')
    expect(commitLineText(5, true)).toBe('◉')
  })
  test('tokens in k, the estimate marked', () => {
    expect(contextTokensText(840, 'en')).toBe('840')
    expect(contextTokensText(4520, 'en')).toBe('4.5k')
    expect(contextTokensText(128_400, 'en')).toBe('128k')
    expect(contextTokensText(4520, 'de')).toBe('4,5k')
    expect(contextTokensText(20_000, 'zh', true)).toBe('~20k')
  })
})
