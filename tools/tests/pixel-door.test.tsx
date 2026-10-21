// The closed band's door is her pixel head asleep (DECISIONS 917): two rows of the generator's door
// picture in eight half-block cells, every colour muted toward grey. The expected cells are worked out
// here from the packed door and her key, the 256-colour ones by a full search of the xterm palette.
import { describe, expect, test } from 'claude-code/testing'
import { PIXEL_DARK_OUTLINE, PIXEL_DOOR, PIXEL_KEY } from '../hooks/coco-pixel'
import { DOOR_COLUMNS, setTerminalLook, sleepingDoorCells } from '../hooks/pictures-lazy'

const DEFAULT = 0x01000000
const XTERM = [...[0, 95, 135, 175, 215, 255].flatMap(r => [0, 95, 135, 175, 215, 255].flatMap(g => [0, 95, 135, 175, 215, 255].map(b => [r, g, b]))),
  ...Array.from({ length: 24 }, (_, i) => [8 + 10 * i, 8 + 10 * i, 8 + 10 * i])]
const nearest = (n: number): number => {
  const c = [n >> 16, n >> 8 & 255, n & 255]
  const best = XTERM.reduce((a, x) => x.reduce((s, v, i) => s + (v - c[i]!) ** 2, 0) < a.reduce((s, v, i) => s + (v - c[i]!) ** 2, 0) ? x : a)
  return best[0]! << 16 | best[1]! << 8 | best[2]!
}
const muted = (letter: string, mode: 'truecolor' | '256'): number => {
  const hex = letter === 'o' ? PIXEL_DARK_OUTLINE : PIXEL_KEY[letter]!
  const n = parseInt(hex.slice(1), 16)
  const m = [n >> 16, n >> 8 & 255, n & 255].reduce((a, v) => a << 8 | Math.round(v * .55 + 136 * .45), 0)
  return mode === '256' ? nearest(m) : m
}

describe('designed terminal sleeping door', () => {
  test('the door is her two-row head asleep, eight cells wide', () => {
    expect(DOOR_COLUMNS).toBe(8)
    expect(PIXEL_DOOR.length).toBe(2)
    for (const row of PIXEL_DOOR) expect(row.length).toBe(8)
  })
  for (const mode of ['truecolor', '256'] as const) {
    test(`${mode}: each cell is its two pixels, muted, on the terminal's own ground where she is not`, () => {
      const bytes = Uint8Array.from(atob(sleepingDoorCells(mode)), c => c.charCodeAt(0))
      expect(bytes.length).toBe(96)
      const cells = new DataView(bytes.buffer)
      for (let x = 0; x < 8; x++) {
        const top = PIXEL_DOOR[0]![x]!, bottom = PIXEL_DOOR[1]![x]!
        const [glyph, fg, bg] = bottom !== '.' ? [0x2584, muted(bottom, mode), top !== '.' ? muted(top, mode) : DEFAULT]
          : top !== '.' ? [0x2580, muted(top, mode), DEFAULT] : [0x20, DEFAULT, DEFAULT]
        expect(cells.getUint32(x * 12, true)).toBe(glyph)
        expect(cells.getUint32(x * 12 + 4, true)).toBe(fg)
        expect(cells.getUint32(x * 12 + 8, true)).toBe(bg)
      }
    })
  }
  test('in Terminal.app a cell with a lower pixel is ▅, which splits its short-block line nearest to halves', () => {
    setTerminalLook({ outfit: 'A', dark: true, short: true })
    try {
      const cells = new DataView(Uint8Array.from(atob(sleepingDoorCells('truecolor')), c => c.charCodeAt(0)).buffer)
      for (let x = 0; x < 8; x++) {
        const top = PIXEL_DOOR[0]![x]!, bottom = PIXEL_DOOR[1]![x]!
        expect(cells.getUint32(x * 12, true)).toBe(bottom !== '.' ? 0x2585 : top !== '.' ? 0x2580 : 0x20)
      }
    } finally { setTerminalLook({ outfit: 'A', dark: true }) }
  })
})
