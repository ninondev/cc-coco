// Coco's pixel version in the terminal (DECISIONS 913, 917): her frames as half-block cells, and which frame a
// moment shows at a given time. coco-pixel.ts holds the frames and the moments (tools/art/coco-pixel-motion.py).
// A moment's body plays once and settles into its state's loop; the loop only moves when the band may move
// while she is idle ("闲着也动来动去"), otherwise its first frame is held and nothing runs.
import { PIXEL_DARK_OUTLINE, PIXEL_DOOR, PIXEL_FRAMES, PIXEL_H, PIXEL_KEY, PIXEL_MOMENTS, PIXEL_OUTFITS, PIXEL_SOCKS, PIXEL_STILLS, PIXEL_W } from './coco-pixel'
import type { PixelStep } from './coco-pixel'

export const PIXEL_COLUMNS = PIXEL_W
export const PIXEL_ROWS = PIXEL_H / 2

export type PixelOutfit = 'A' | 'B'
// `short`: the terminal draws blocks from a font whose blocks stop short of the line's top (Terminal.app)
export type PixelLook = { outfit: PixelOutfit; socks?: string; dark: boolean; colors: 'truecolor' | '256'; short?: boolean }
// Another sprite's pixels over hers (a visitor): its top-left on her grid, rows of letters ('a' + index), colours.
export type PixelOverlay = { key: string; x: number; y: number; rows: readonly string[]; rgb: readonly number[] }

const rows = new Map<number, readonly string[]>()
export function pixelRows(frame: number): readonly string[] {
  let r = rows.get(frame)
  if (!r) {
    const packed = PIXEL_FRAMES[frame] ?? PIXEL_FRAMES[0]!
    r = packed.split('|').map(row => row.replace(/(\d+)(\D)/g, (_, n: string, c: string) => c.repeat(Number(n))))
    rows.set(frame, r)
  }
  return r
}

// the xterm 256 palette's cube and greys: the 256-colour cells use only colours it holds exactly
const CUBE = [0, 95, 135, 175, 215, 255]
function xterm(rgb: number): number {
  const r = rgb >> 16, g = rgb >> 8 & 255, b = rgb & 255
  const level = (v: number): number => CUBE.reduce((a, c) => Math.abs(c - v) < Math.abs(a - v) ? c : a)
  const cube = [level(r), level(g), level(b)]
  const v = 8 + 10 * Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)))
  const d = (x: readonly number[]): number => (x[0]! - r) ** 2 + (x[1]! - g) ** 2 + (x[2]! - b) ** 2
  const best = d(cube) <= d([v, v, v]) ? cube : [v, v, v]
  return best[0]! << 16 | best[1]! << 8 | best[2]!
}

const tables = new Map<string, Readonly<Record<string, number>>>()
function colours(look: PixelLook, other: number): Readonly<Record<string, number>> {
  const worn: PixelOutfit = other ? (look.outfit === 'A' ? 'B' : 'A') : look.outfit
  const id = `${worn}:${look.socks ?? 'honmei'}:${look.dark ? 'd' : 'l'}:${look.colors}`
  let t = tables.get(id)
  if (!t) {
    const away: PixelOutfit = worn === 'A' ? 'B' : 'A'
    const hex: Record<string, string> = { ...PIXEL_KEY, ...PIXEL_OUTFITS[worn], q: PIXEL_OUTFITS[away].Q, v: PIXEL_OUTFITS[away].V,
      ...(PIXEL_SOCKS[look.socks ?? 'honmei'] ?? PIXEL_SOCKS.honmei) }
    // on a dark terminal her outline is near black, so no grey ring shows round her (DECISIONS 1060)
    if (look.dark) hex.o = PIXEL_DARK_OUTLINE
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(hex)) {
      const n = parseInt(v.slice(1), 16)
      out[k] = look.colors === '256' ? xterm(n) : n
    }
    t = out
    tables.set(id, t)
  }
  return t
}

const DEFAULT = 0x01000000 // the terminal's own colour
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const LOWER_FIVE = 0x2585 // ▅
const SPACE = 0x20
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] ?? 0) << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0)
    out += ALPHABET[n >> 18 & 63]! + ALPHABET[n >> 12 & 63]!
    out += i + 1 < bytes.length ? ALPHABET[n >> 6 & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}

// Two pixels in one cell. Terminal.app draws ▀ and ▄ from its font, and SF Mono's (and Menlo's) blocks stop short of the
// line's top by about 15%: a ▀ cell showed a strip of the lower pixel above the upper one, so dark outline crept into
// her hair and face (owner 10-20: 「变得很脏，很多地方变黑方块」). A lower block with the upper pixel as the ground
// keeps the halves whole; there ▅ splits the line 46 to 54 where ▄ split it 57 to 43 (owner 10-20: 「高度你看着调」),
// and terminals that draw blocks themselves get the true half, ▄.
function halfCell(top: number, bottom: number, short = false): readonly number[] {
  if (bottom >= 0) return [short ? LOWER_FIVE : LOWER, bottom, top >= 0 ? top : DEFAULT]
  return top >= 0 ? [UPPER, top, DEFAULT] : [SPACE, DEFAULT, DEFAULT]
}

const cells = new Map<string, string>()
// Half-block cells, each [codePoint, foreground, background] as little-endian u32: her frame moved dx pixels,
// with an overlay drawn over her.
export function pixelCells(frame: number, other: number, look: PixelLook, overlay?: PixelOverlay, dx = 0): string {
  const id = `${frame}:${other}:${look.outfit}:${look.socks ?? 'honmei'}:${look.dark ? 'd' : 'l'}:${look.colors}:${dx}:${overlay?.key ?? ''}:${look.short ? 's' : ''}`
  const held = cells.get(id)
  if (held) return held
  if (cells.size > 400) cells.clear()
  const r = pixelRows(frame), t = colours(look, other)
  const at = (x: number, y: number): number => {
    if (overlay) {
      const v = overlay.rows[y - overlay.y]?.[x - overlay.x]
      if (v !== undefined && v !== '.') return overlay.rgb[v.charCodeAt(0) - 97] ?? -1
    }
    const c = r[y]?.[x - dx]
    return c === undefined || c === '.' ? -1 : t[c] ?? -1
  }
  const view = new DataView(new ArrayBuffer(PIXEL_COLUMNS * PIXEL_ROWS * 12))
  let o = 0
  for (let row = 0; row < PIXEL_ROWS; row++) {
    for (let x = 0; x < PIXEL_COLUMNS; x++) {
      const top = at(x, row * 2), bottom = at(x, row * 2 + 1)
      const cell = halfCell(top, bottom, look.short)
      for (const n of cell) { view.setUint32(o, n, true); o += 4 }
    }
  }
  const out = base64(new Uint8Array(view.buffer))
  cells.set(id, out)
  return out
}

// Her outfit, her socks and the terminal's ground, for the pictures asked for by name (the book's portrait,
// the blink and the door); register.tsx sets it before it draws the terminal band.
export type PixelWear = { outfit: PixelOutfit; socks?: string; dark: boolean; short?: boolean }
let wear: PixelWear = { outfit: 'A', dark: true }
export function setPixelWear(next: PixelWear): void { wear = next }
export function pixelWear(): PixelWear { return wear }

// ---------------------------------------------------------------- kitty and Ghostty

// The same frame as a PNG for the terminals that show pictures: palette colour, every pixel `scale` pixels
// square, uncompressed deflate (no zlib here; a frame at 4x is about 7 KB).
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(bytes: Uint8Array): number { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ c >>> 8; return (c ^ 0xFFFFFFFF) >>> 0 }
function chunk(kind: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
const pngs = new Map<string, string>()
export function pixelPng(frame: number, other: number, look: PixelLook, overlay?: PixelOverlay, dx = 0, scale = 4): string {
  const id = `${frame}:${other}:${look.outfit}:${look.socks ?? 'honmei'}:${look.dark ? 'd' : 'l'}:${dx}:${scale}:${overlay?.key ?? ''}`
  const held = pngs.get(id)
  if (held) return held
  if (pngs.size > 200) pngs.clear()
  const r = pixelRows(frame), t = colours({ ...look, colors: 'truecolor' }, other)
  const palette: number[] = [], index = new Map<number, number>()
  const at = (x: number, y: number): number => {
    let rgb = -1
    const v = overlay?.rows[y - overlay.y]?.[x - overlay.x]
    if (v !== undefined && v !== '.') rgb = overlay!.rgb[v.charCodeAt(0) - 97] ?? -1
    else { const c = r[y]?.[x - dx]; rgb = c === undefined || c === '.' ? -1 : t[c] ?? -1 }
    if (rgb < 0) return 0
    let i = index.get(rgb)
    if (i === undefined) { i = palette.length + 1; index.set(rgb, i); palette.push(rgb) }
    return i
  }
  const w = PIXEL_COLUMNS * scale, h = PIXEL_H * scale, stride = w + 1
  const raw = new Uint8Array(stride * h)
  for (let y = 0; y < PIXEL_H; y++) {
    const line = new Uint8Array(w)
    for (let x = 0; x < PIXEL_COLUMNS; x++) line.fill(at(x, y), x * scale, x * scale + scale)
    for (let k = 0; k < scale; k++) raw.set(line, (y * scale + k) * stride + 1)
  }
  // zlib: a header, stored blocks of at most 65535 bytes, the Adler-32 of the raw bytes
  const blocks = Math.ceil(raw.length / 65535) || 1, z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  z[0] = 0x78; z[1] = 0x01
  let o = 2
  for (let b = 0; b < blocks; b++) {
    const part = raw.subarray(b * 65535, Math.min(raw.length, (b + 1) * 65535))
    z[o] = b === blocks - 1 ? 1 : 0; z[o + 1] = part.length & 255; z[o + 2] = part.length >> 8; z[o + 3] = ~part.length & 255; z[o + 4] = ~part.length >> 8 & 255
    z.set(part, o + 5); o += 5 + part.length
  }
  let a = 1, s2 = 0
  for (const v of raw) { a = (a + v) % 65521; s2 = (s2 + a) % 65521 }
  new DataView(z.buffer).setUint32(o, (s2 << 16 | a) >>> 0)
  const header = new Uint8Array(13), hv = new DataView(header.buffer)
  hv.setUint32(0, w); hv.setUint32(4, h); header[8] = 8; header[9] = 3
  const plte = new Uint8Array(3 * (palette.length + 1)), trns = new Uint8Array(palette.length + 1)
  palette.forEach((rgb, i) => { plte[3 * (i + 1)] = rgb >> 16; plte[3 * (i + 1) + 1] = rgb >> 8 & 255; plte[3 * (i + 1) + 2] = rgb & 255; trns[i + 1] = 255 })
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const part of parts) { out.set(part, p); p += part.length }
  const encoded = base64(out)
  pngs.set(id, encoded)
  return encoded
}

// One picture per old frame name, for the calls that still ask by name (the book's portrait, a still band).
export function pixelStill(name: string): number { return PIXEL_STILLS[name] ?? PIXEL_STILLS['idle-reading'] ?? 0 }

// The closed band's door: her sleeping face in one row of eight cells, dimmed by the band.
export const PIXEL_DOOR_COLUMNS = PIXEL_DOOR[0]!.length
export function pixelDoorCells(look: PixelLook): string {
  const id = `door:${look.dark ? 'd' : 'l'}:${look.colors}:${look.short ? 's' : ''}`
  const held = cells.get(id)
  if (held) return held
  const t = colours({ ...look, colors: 'truecolor' }, 0)
  // dim: each colour muted toward neutral grey, still legible on either terminal ground
  const mute = (n: number): number => { const m = [n >> 16, n >> 8 & 255, n & 255].reduce((a, v) => a << 8 | Math.round(v * .55 + 136 * .45), 0); return look.colors === '256' ? xterm(m) : m }
  const px = (x: number, y: number): number => { const c = PIXEL_DOOR[y]?.[x]; return c === undefined || c === '.' ? -1 : t[c] === undefined ? -1 : mute(t[c]!) }
  const view = new DataView(new ArrayBuffer(PIXEL_DOOR_COLUMNS * 12))
  let o = 0
  for (let x = 0; x < PIXEL_DOOR_COLUMNS; x++) {
    const top = px(x, 0), bottom = px(x, 1)
    const cell = halfCell(top, bottom, look.short)
    for (const n of cell) { view.setUint32(o, n, true); o += 4 }
  }
  const out = base64(new Uint8Array(view.buffer))
  cells.set(id, out)
  return out
}

// ---------------------------------------------------------------- playing

// What the terminal is showing of her: the moment, the state it settles into, when it started and in which
// outfit it plays (the shell change plays in the one she is taking off).
export type PixelPlay = { action: string; base: string; at: number; outfit: PixelOutfit; act?: number }
export function pixelHas(action: string): boolean { return PIXEL_MOMENTS[action] !== undefined }
// The band's actions of 10-16 that the five pixel sprites have no drawing for, played as the nearest moment.
const PIXEL_STANDS_IN: Readonly<Record<string, string>> = { nap: 'doze', breath: 'idle', catch: 'done' }
export function pixelNext(previous: PixelPlay | undefined, wanted: string, wantedBase: string, outfit: PixelOutfit, now: number, act?: number): PixelPlay {
  const action = PIXEL_STANDS_IN[wanted] ?? wanted, base = PIXEL_STANDS_IN[wantedBase] ?? wantedBase
  const key = pixelHas(action) ? action : pixelHas(base) ? base : 'idle'
  const settle = pixelHas(base) ? base : 'idle'
  if (previous && previous.action === key && previous.outfit === outfit && previous.act === act) return previous.base === settle ? previous : { ...previous, base: settle }
  return { action: key, base: settle, at: now, outfit, ...(act === undefined ? {} : { act }) }
}
const total = (steps: readonly PixelStep[]): number => steps.reduce((a, s) => a + s[1], 0)
// how long the shell change plays after a compaction
export const PIXEL_SHELL_MS = total(PIXEL_MOMENTS.shell?.body ?? [])
// The one picture that stands for a moment that may not move: its longest step that is more than her
// standing still (the sip of the coffee moment, not the plain stand it starts from).
function standIn(steps: readonly PixelStep[]): PixelStep {
  const rest = PIXEL_MOMENTS.idle!.loop[0]![0]
  const own = steps.filter(s => s[0] !== rest)
  return (own.length ? own : steps).reduce((a, s) => s[1] > a[1] ? s : a)
}
// A held usage limit: the moment's stand-in, or the state's resting picture, for as long as the limit holds.
export function pixelHeld(play: PixelPlay): { frame: number; other: number } {
  const m = PIXEL_MOMENTS[play.action] ?? PIXEL_MOMENTS.idle!
  const s = m.body.length ? standIn(m.body) : (m.loop.length ? m.loop : PIXEL_MOMENTS.idle!.loop)[0]!
  return { frame: s[0], other: s[2] }
}
// Moments that are her idle life rather than an answer to anything: with "闲着也动来动去" off she is simply in
// the state they lead to (falling asleep is just being asleep), so a quiet spell costs one drawing.
const IDLE_LIFE: ReadonlySet<string> = new Set(['doze'])
// The frame for now: [frame, other outfit], and the ms until it changes (undefined: it holds).
// moving: the band may move (not reduced motion, not a held usage limit); lively: "闲着也动来动去" is on, so her
// idle life plays and her resting loop moves, except while she is asleep.
export function pixelStep(play: PixelPlay, now: number, moving: boolean, lively: boolean, asleep = false): { frame: number; other: number; next?: number } {
  const m = PIXEL_MOMENTS[play.action] ?? PIXEL_MOMENTS.idle!
  const body = lively || !IDLE_LIFE.has(play.action) ? m.body : []
  const t = Math.max(0, now - play.at)
  if (body.length) {
    if (!moving) {
      // reduced motion: one picture stands for the moment, until it is over
      if (t < total(body)) {
        const held = standIn(body)
        return { frame: held[0], other: held[2], next: total(body) - t }
      }
    } else {
      let acc = 0
      for (const s of body) {
        acc += s[1]
        if (t < acc) return { frame: s[0], other: s[2], next: acc - t }
      }
    }
  }
  const rest = m.loop.length ? m : PIXEL_MOMENTS[play.base] ?? PIXEL_MOMENTS.idle!
  const loop = rest.loop.length ? rest.loop : PIXEL_MOMENTS.idle!.loop
  // after the shell change she stays in the outfit she changed into, whatever the play started in
  const other = body.length ? body[body.length - 1]![2] : 0
  if (!moving || !lively || asleep || loop.length < 2) return { frame: loop[0]![0], other }
  const length = total(loop), into = (t - total(body)) % length
  let acc = 0
  for (const s of loop) {
    acc += s[1]
    if (into < acc) return { frame: s[0], other, next: acc - into }
  }
  return { frame: loop[0]![0], other }
}
