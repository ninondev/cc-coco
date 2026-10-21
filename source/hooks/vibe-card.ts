// The vibe check share card (lane C, 10-17; his design, https://claude.ai/artifact/4drdipLdHjC8pcYnqy1V6N): a card from
// Coco's box, 1080 by 1350. The verdict is its name, their picture stands on it with no frame, their two lines under it,
// the session's numbers on the ruled lines, and the top right corner folded over to show the foil of its rarity.
// Only plain SVG (paths, gradients, images, text): sips, rsvg-convert and the browsers all draw it the same.
import { vibeRarity, type VibeRarity } from './bag'

// The rarity rule lives in bag.ts, beside vibe check's situations, for the bag's MV picture too.
export { vibeRarity, type VibeRarity }

// A PNG's width and height from its header (the first 24 bytes, so the first 32 characters of its base64).
export function vibePngSize(base64: string): { width: number; height: number } | undefined {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes: number[] = []
  let bits = 0, value = 0
  for (const ch of base64.slice(0, 32)) {
    const digit = alphabet.indexOf(ch)
    if (digit < 0) return undefined
    value = ((value << 6) | digit) & 0xffffff; bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
  }
  const integer = (i: number): number => bytes.slice(i, i + 4).reduce((n, b) => n * 256 + b, 0)
  if (bytes.length < 24 || bytes[0] !== 137 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return undefined
  const width = integer(16), height = integer(20)
  return width > 0 && height > 0 && width <= 4096 && height <= 4096 ? { width, height } : undefined
}

export type VibeCardRow = { template: string; key: string; value: string }
export type VibeCardInput = {
  lang: string
  title: string
  roasts: readonly string[]
  rows: readonly VibeCardRow[] // only what happened, at most six, in B's words with the number's slot
  rarity: VibeRarity
  name: string // their name, as the band writes it
  unofficial?: string
  art?: { base64: string; width: number; height: number } // their painting for this verdict, PNG
}

const INK = '#2a241d', INK2 = '#5b5246', MUTED = '#8a8072', CORAL = '#d97757', BLUE = '#3a86c8', STOCK = '#fffdf8', BACK = '#ece5da'
const KRAFT = '#b98a57', SHADOW = '59,42,23'
const PRINT: Record<VibeRarity, string> = { R: '#8b4a26', SR: '#3e4a57', SSR: '#3e4a57' }
const COPPER = ['#f6d6bf', '#e5a57d', '#bb6c3e', '#93502a']
const PEARL = ['#f4f7fb', '#dfd0ef', '#c9e6ea', '#f0dfc2', '#c3cddb']
const HOLO = ['#7d8997', '#dfe7f0', '#f4c9dd', '#c3e8d5', '#f4e1ae', '#bad4f1', '#e4cdf0', '#dfe7f0']
const FONT = "-apple-system,'PingFang SC','Hiragino Sans','Hiragino Kaku Gothic ProN','Apple SD Gothic Neo','Kohinoor Devanagari','Microsoft YaHei','Malgun Gothic','Nirmala UI','Segoe UI','Noto Sans CJK SC','Noto Sans','Noto Sans Devanagari',sans-serif"

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n1 = (v: number): string => (Math.round(v * 10) / 10).toString()
const wide = (ch: string): boolean => (ch.codePointAt(0) ?? 0) >= 0x2e80
// A safe guess of a line's width: a wide character is a full em, a capital a little over half, anything else half.
// The card metrics were measured on his Mac for the week card's serif; these lines are sans (C.md: re-measure on the Mac).
function width(text: string, size: number): number {
  let w = 0
  for (const ch of text) w += size * (wide(ch) ? 1 : ch >= 'A' && ch <= 'Z' ? 0.62 : 0.55)
  return w
}
// Chinese and Japanese break between any two characters, Korean only at its spaces, like Latin.
const breaksAnywhere = (ch: string): boolean => wide(ch) && !/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(ch)
// a closing mark, a long vowel or a small kana never starts a line
const NO_START = ',.!?:;)」』】〉》、。，！？：；）ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々・…'
// Two lines are balanced, so the second never holds a lone character or word; one line or three stay as they wrap.
// With `short`, only a second line under that share of the room is balanced (the roasts keep their full measure).
export function vibeBalance(text: string, size: number, room: number, firstRoom = room, short = 1): string[] {
  const lines = vibeWrap(text, size, room, firstRoom)
  if (lines.length !== 2 || width(lines[1]!, size) >= room * short) return lines
  for (let narrower = Math.ceil(width(text, size) / 2); narrower < room; narrower += 8) {
    const balanced = vibeWrap(text, size, narrower, Math.min(narrower, firstRoom))
    if (balanced.length === 2) return balanced
  }
  return lines
}
export function vibeWrap(text: string, size: number, room: number, firstRoom = room): string[] {
  const tokens: string[] = []
  for (const ch of text) {
    const last = tokens[tokens.length - 1]
    if (breaksAnywhere(ch) || last === undefined || ch === ' ' || breaksAnywhere([...last].pop()!) || last.endsWith(' ')) tokens.push(ch)
    else tokens[tokens.length - 1] = last + ch
  }
  const lines: string[] = []
  let line: string[] = []
  for (const t of tokens) {
    if (line.length && width(line.join('') + t, size) > (lines.length ? room : firstRoom)) {
      // a mark that cannot start the line takes the character before it along
      const carried = NO_START.includes(t[0]!) && line.length > 1 ? line.splice(-1) : []
      lines.push(line.join('').trimEnd()); line = [...carried, t].join('').trimStart() ? [...carried, t] : []
    } else line.push(t)
  }
  if (line.join('').trim()) lines.push(line.join('').trimEnd())
  return lines
}
const stops = (colors: readonly string[]): string => colors.map((c, i) => `<stop offset="${n1(i / (colors.length - 1))}" stop-color="${c}"/>`).join('')
function reflect(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  return [2 * (ax + t * dx) - px, 2 * (ay + t * dy) - py]
}
// A row too long for its column gets smaller type, as small as 70 percent.
function numberRow(row: VibeCardRow, x: number, y: number, room: number): string {
  const slot = `{${row.key}}`, at = row.template.indexOf(slot)
  const [before, after] = at < 0 ? [row.template.replace(/\{\w+\}/g, row.value), ''] : [row.template.slice(0, at), row.template.slice(at + slot.length)]
  const scale = Math.max(0.7, Math.min(1, room / (width(before + after, 30) + (at < 0 ? 0 : width(row.value, 38)))))
  const value = at < 0 ? '' : `<tspan font-weight="800" font-size="${n1(38 * scale)}" fill="${INK}">${esc(row.value)}</tspan>`
  return `<text x="${x}" y="${y}" font-size="${n1(30 * scale)}" fill="${INK2}">${esc(before)}${value}${esc(after)}</text>`
}

export function vibeCardSvg(i: VibeCardInput): string {
  const x1 = 72, y1 = 64, x2 = 1008, y2 = 1286, r = 14
  // a hand-folded corner: the crease runs a little askew, from the top edge to the right edge
  const ax = x2 - 112, ay = y1, bx = x2, by = y1 + 78
  const fold = (px: number, py: number): [number, number] => reflect(px, py, ax, ay, bx, by)
  const [tx, ty] = fold(x2, y1), [p1x, p1y] = fold(x2 - r, y1), [p2x, p2y] = fold(x2, y1 + r)
  const mx = (ax + bx) / 2, my = (ay + by) / 2, nl = Math.hypot(tx - mx, ty - my), nx = (tx - mx) / nl, ny = (ty - my) / nl
  // the card's outline, cut along the crease
  const outline = (d: number): string =>
    `M${x1 + r + d} ${y1 + d}H${ax}L${bx} ${by}V${y2 - r + d}Q${x2 + d} ${y2 + d} ${x2 - r + d} ${y2 + d}H${x1 + r + d}Q${x1 + d} ${y2 + d} ${x1 + d} ${y2 - r + d}V${y1 + r + d}Q${x1 + d} ${y1 + d} ${x1 + r + d} ${y1 + d}Z`
  const flap = `M${ax} ${ay}L${n1(p1x)} ${n1(p1y)}Q${n1(tx)} ${n1(ty)} ${n1(p2x)} ${n1(p2y)}L${bx} ${by}Z`
  const foil = i.rarity === 'R' ? COPPER : PEARL
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" font-family="${FONT}">`,
    '<defs>',
    `<linearGradient id="foil" gradientUnits="userSpaceOnUse" x1="${n1(mx)}" y1="${n1(my)}" x2="${n1(tx)}" y2="${n1(ty)}">${stops(foil)}</linearGradient>`,
    `<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="${n1(mx)}" y1="${n1(my)}" x2="${n1(tx)}" y2="${n1(ty)}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.6"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="bend" gradientUnits="userSpaceOnUse" x1="${n1(mx)}" y1="${n1(my)}" x2="${n1(mx + nx * 10)}" y2="${n1(my + ny * 10)}"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="edge" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(HOLO)}</linearGradient>`,
    '</defs>',
    // their kraft box's lid, a few fibres in it
    `<rect width="1080" height="1350" fill="${KRAFT}"/>`,
    ...[38, 151, 260, 377, 521, 644, 739, 868, 977, 1046].map((x, k) => `<rect x="${x}" y="0" width="${k % 3 ? 1 : 2}" height="1350" fill="rgb(${SHADOW})" opacity="${k % 2 ? 0.05 : 0.08}"/>`),
    // a soft lift: the paper's shadow in a few thin layers
    ...[[22, 0.05], [14, 0.07], [8, 0.09], [4, 0.1]].map(([d, o]) => `<path d="${outline(d!)}" fill="rgb(${SHADOW})" opacity="${o}"/>`),
    `<path d="${outline(0)}" fill="${STOCK}"/>`,
  ]
  if (i.rarity === 'SSR') {
    // a rim of holographic foil, cut along the crease like the card
    const e = 12, top = y1 + e, right = x2 - e, slope = (by - ay) / (bx - ax)
    const xt = ax + (top - ay) / slope, yr = ay + (right - ax) * slope
    out.push(`<path d="M${x1 + e} ${top}H${n1(xt)}L${right} ${n1(yr)}V${y2 - e}H${x1 + e}Z" fill="none" stroke="url(#edge)" stroke-width="7"/>`)
  }
  // the fold: its shadow under the lifted tip, the card's own back with the foil printed on it, the bend's light
  const s = (dx: number, dy: number): string => `M${ax} ${ay + 4}L${n1(p1x + dx)} ${n1(p1y + dy)}Q${n1(tx + dx)} ${n1(ty + dy)} ${n1(p2x + dx)} ${n1(p2y + dy)}L${bx - 4} ${by}Z`
  out.push(`<path d="${s(-6, 13)}" fill="rgb(${SHADOW})" opacity="0.1"/>`, `<path d="${s(-3, 7)}" fill="rgb(${SHADOW})" opacity="0.14"/>`)
  out.push(`<path d="${flap}" fill="${BACK}"/>`, `<path d="${flap}" fill="url(#foil)" opacity="0.78"/>`, `<path d="${flap}" fill="url(#sheen)"/>`, `<path d="${flap}" fill="url(#bend)"/>`)
  out.push(`<path d="M${ax} ${ay}L${n1(p1x)} ${n1(p1y)}Q${n1(tx)} ${n1(ty)} ${n1(p2x)} ${n1(p2y)}L${bx} ${by}" fill="none" stroke="${STOCK}" stroke-opacity="0.7" stroke-width="1.4"/>`)
  out.push(`<path d="M${ax} ${ay}L${bx} ${by}" stroke="rgb(${SHADOW})" stroke-opacity="0.16" stroke-width="2.4"/>`)
  out.push(`<path d="M${n1(ax - nx * 1.2)} ${n1(ay - ny * 1.2)}L${n1(bx - nx * 1.2)} ${n1(by - ny * 1.2)}" stroke="#fff" stroke-opacity="0.95" stroke-width="1.6"/>`)
  out.push(`<text x="${ax - 22}" y="${y1 + 58}" text-anchor="end" font-size="30" font-weight="800" letter-spacing="2.4" fill="${PRINT[i.rarity]}">${i.rarity}</text>`)
  // the verdict on the index card's red header line, two lines at most
  // (a longer one gets smaller type, never cut); the first line stops short of the rarity letters
  const beside = ax - 22 - i.rarity.length * 24 - 24 - 120
  let size = 62, title = vibeBalance(i.title, size, 840, beside)
  while (title.length > 2 && size > 44) { size -= 6; title = vibeBalance(i.title, size, 840, beside) }
  let y = 168
  for (const line of title) { out.push(`<text x="120" y="${y}" font-size="${size}" font-weight="800" fill="${INK}">${esc(line)}</text>`); y += Math.round(size * 1.2) }
  const rule = y - Math.round(size * 1.2) + 32
  out.push(`<rect x="120" y="${rule}" width="840" height="4" fill="${CORAL}"/>`)
  // the numbers on the ruled lines just above the foot; their lines and the painting share what is left
  const rows = i.rows.slice(0, 6), gap = 58, nrows = Math.max(1, Math.ceil(rows.length / 2)), first = 1188 - nrows * gap
  const cjkQuotes = i.lang === 'zh' || i.lang === 'zh-Hant' || i.lang === 'ja'
  const said = i.roasts.map(roast => vibeBalance((cjkQuotes ? '「' : '“') + roast + (cjkQuotes ? '」' : '”'), 34, 840, 840, 1 / 3))
  const saidH = said.reduce((h, lines) => h + lines.length * 46, 0) + 8 * Math.max(0, said.length - 1)
  const saidTop = first - 40 - saidH + 34, top = rule + 30
  if (i.art && i.art.height > 0) {
    const h = Math.min(600, saidTop - 74 - top), w = i.art.width * h / i.art.height
    out.push(`<ellipse cx="540" cy="${n1(top + h - 8)}" rx="${n1(w * 0.36)}" ry="16" fill="rgb(${SHADOW})" opacity="0.1"/>`)
    out.push(`<image x="${n1(540 - w / 2)}" y="${top}" width="${n1(w)}" height="${n1(h)}" href="data:image/png;base64,${i.art.base64}"/>`)
  }
  y = saidTop
  for (const lines of said) {
    for (const line of lines) { out.push(`<text x="120" y="${y}" font-size="34" fill="${INK2}">${esc(line)}</text>`); y += 46 }
    y += 8
  }
  for (let k = 0; k <= nrows; k++) out.push(`<rect x="120" y="${first + k * gap}" width="840" height="2" fill="${BLUE}" opacity="0.28"/>`)
  rows.forEach((row, k) => out.push(numberRow(row, 120 + (k % 2) * 430, first + (Math.floor(k / 2) + 1) * gap - 14, 400)))
  // the foot: their name with the band's asterisk, the unofficial note, and the page it came from
  out.push(`<text x="120" y="1240" font-size="28" font-weight="700" fill="${INK}"><tspan fill="${CORAL}">✻</tspan> ${esc(i.name)}${i.unofficial ? `<tspan font-weight="400" font-size="22" fill="${MUTED}">  ${esc(i.unofficial)}</tspan>` : ''}</text>`)
  out.push(`<text x="960" y="1240" text-anchor="end" font-size="28" fill="${INK2}">vibe check</text>`)
  out.push('</svg>')
  return out.join('')
}
