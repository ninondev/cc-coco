// Pictures, built once and cached: the desktop sprite as an SVG around the PNG, the terminal
// sprite as packed half-block cells, the offering box and the fortune slip.

import { DESKTOP_SIZE, FRAME_NAMES, TERMINAL_PALETTE, TERMINAL_PALETTE_256, TERMINAL_PIXELS, TERMINAL_SIZE } from './art'
import type { FrameName } from './art'

const cache = new Map<string, string>()

function once(key: string, make: () => string): string {
  let value = cache.get(key)
  if (value === undefined) {
    value = make()
    cache.set(key, value)
  }
  return value
}

// ---------------------------------------------------------------- desktop

export const DESKTOP_REST = 64 // CSS px tall; the PNG is 128 px, so 2x on a Retina screen
export const DESKTOP_COMPACT = 32
const PIXEL_SIZE = { width: 35, height: 32 } as const

export function desktopWidth(height: number): number {
  const size = height === DESKTOP_COMPACT ? PIXEL_SIZE : DESKTOP_SIZE
  return Math.round((size.width * height) / size.height)
}

// Where a frame's PNG lives under the plugin root.
export function pngPath(frame: FrameName, height = DESKTOP_REST): string {
  const folder = height === DESKTOP_COMPACT ? 'pixel' : 'desktop'
  return `assets/${folder}/${String(FRAME_NAMES.indexOf(frame) + 1).padStart(2, '0')}-${frame}.png`
}

// The desktop sprite: the frame's PNG (base64, read once by register.tsx) inside an SVG, kept for
// the band. spriteSource builds the same without keeping it (his book keeps its own while open).
export function spriteSvg(frame: FrameName, height: number, png: string): string {
  return once(`svg:${frame}:${height}`, () => spriteSource(height, png, height === DESKTOP_COMPACT))
}

export function spriteSource(height: number, png: string, pixel = false): string {
  const { width: w, height: h } = pixel ? PIXEL_SIZE : DESKTOP_SIZE
  const width = Math.round((w * height) / h)
  // A compact head maps art pixels to square CSS pixels; nearest-neighbour scaling keeps them
  // sharp at the surface's display scale. Book callers keep the painted source by default.
  const rendering = pixel ? ' style="image-rendering:pixelated"' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${width}" height="${height}">` +
    `<image href="data:image/png;base64,${png}" x="0" y="0" width="${w}" height="${h}"${rendering}/></svg>`
  )
}

// The offering box (saisen-bako): a wooden box seen from the front, its body showing how full it
// is. The body colour alone keeps 3:1 against both a light and a dark band; the outline lightens
// in dark mode where the app's colour scheme reaches the image.
export function offeringSvg(percent: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return once(`box:${p}`, () => {
    const inner = 9 // px of body height that can fill
    const level = Math.round((inner * p) / 100)
    const full = p >= 85
    const fill = full ? '#C75730' : '#FAEEE9'
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 18" width="20" height="18">' +
      '<style>.o{stroke:#573A33}@media (prefers-color-scheme:dark){.o{stroke:#E68F6F}}</style>' +
      '<path class="o" d="M3.5 1.5h13l2 3h-17z" fill="#CC7556" stroke-width="1"/>' +
      '<path d="M6 2v2.5M9 2v2.5M12 2v2.5M15 2v2.5" stroke="#572A1C" stroke-width="1"/>' +
      '<rect class="o" x="2" y="5" width="16" height="12" fill="#AA5E47" stroke-width="1"/>' +
      `<rect x="4" y="${7 + inner - level}" width="12" height="${level}" fill="${fill}"/>` +
      '</svg>'
    )
  })
}

// The slip's type: a Mincho for Han ranks, a Myeongjo for Hangul ones (Korean signs and banners
// stack short Hangul words the same way), with the Korean sans faces after them.
export const SLIP_FONTS = {
  han: "'Hiragino Mincho ProN','Yu Mincho','Noto Serif CJK JP','Songti SC',serif",
  hangul: "'AppleMyungjo','Noto Serif KR','Nanum Myeongjo','Apple SD Gothic Neo','Noto Sans KR',serif",
} as const
const HANGUL = /[\uac00-\ud7a3]/

// The fortune slip (/omen): cream paper, a rubric header, the rank written top to bottom when it is a
// few Han or Hangul characters; otherwise faint ruled lines, like the slip before you read it. Three
// characters set a size smaller, so the first stays clear of the header.
export function slipSvg(label: string): string {
  return once(`slip:${label}`, () => {
    const chars = [...label]
    const three = chars.length >= 3
    const step = three ? 14 : 15
    const top = three ? 23 : 33 - (chars.length - 1) * 7
    const text = chars.length
      ? chars.map((c, i) => `<text x="12" y="${top + i * step}" text-anchor="middle">${c}</text>`).join('')
      : [18, 26, 34, 42, 50].map(y => `<path d="M6 ${y}h12" stroke="#E4C7BC"/>`).join('')
    const fonts = HANGUL.test(label) ? SLIP_FONTS.hangul : SLIP_FONTS.han
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 62" width="24" height="62">' +
      '<rect x="1" y="1" width="22" height="60" rx="1.5" fill="#FAEEE9" stroke="#C75730"/>' +
      '<rect x="1" y="1" width="22" height="7" rx="1.5" fill="#C75730"/>' +
      `<g fill="#9E4123" font-size="${three ? 12 : 13}" font-weight="700" font-family="${fonts}">${text}</g>` +
      '</svg>'
    )
  })
}

// ---------------------------------------------------------------- terminal

export const TERMINAL_COLUMNS = TERMINAL_SIZE.width
export const TERMINAL_ROWS = Math.ceil(TERMINAL_SIZE.height / 2)

const DEFAULT = 0x01000000 // the terminal's own colour
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20
const RGB = {
  truecolor: TERMINAL_PALETTE.map(hex => parseInt(hex.slice(1), 16)),
  '256': TERMINAL_PALETTE_256.map(hex => parseInt(hex.slice(1), 16)),
}

function pixel(rgb: readonly number[], rows: readonly string[], x: number, y: number): number {
  const c = rows[y]?.[x]
  return c === undefined || c === '.' ? -1 : (rgb[c.charCodeAt(0) - 97] ?? -1)
}

// Half-block cells, each [codePoint, foreground, background] as little-endian u32, in 24-bit
// colour or in colours the xterm 256 palette holds exactly.
export function spriteCells(frame: FrameName, colors: 'truecolor' | '256' = 'truecolor'): string {
  return once(`cells:${frame}:${colors}`, () => {
    const rgb = RGB[colors]
    const rows = TERMINAL_PIXELS[frame]
    const view = new DataView(new ArrayBuffer(TERMINAL_COLUMNS * TERMINAL_ROWS * 12))
    let at = 0
    for (let r = 0; r < TERMINAL_ROWS; r++) {
      for (let x = 0; x < TERMINAL_COLUMNS; x++) {
        const top = pixel(rgb, rows, x, r * 2)
        const bottom = pixel(rgb, rows, x, r * 2 + 1)
        const cell =
          top >= 0 ? [UPPER, top, bottom >= 0 ? bottom : DEFAULT]
          : bottom >= 0 ? [LOWER, bottom, DEFAULT]
          : [SPACE, DEFAULT, DEFAULT]
        for (const n of cell) {
          view.setUint32(at, n, true)
          at += 4
        }
      }
    }
    return toBase64(new Uint8Array(view.buffer))
  })
}

// The kitty/Ghostty picture: the desktop PNG in a box of cells (cells are about twice as tall
// as they are wide).
export function imageColumns(rows: number): number {
  return Math.round((rows * 2 * DESKTOP_SIZE.width) / DESKTOP_SIZE.height)
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}
