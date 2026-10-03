// Pictures for his book, built once per distinct input and cached: the fortune slip at reading
// size, and a thin meter. Not character art (that comes only from the owner's sheets): a slip
// of paper and a bar. Every one sits beside text that says the same thing.

import { SLIP_FONTS } from './pictures'

const cache = new Map<string, string>()

// His book closing: none of its drawings are kept.
export function forgetBookArt(): void {
  cache.clear()
}

function once(key: string, make: () => string): string {
  let value = cache.get(key)
  if (value === undefined) {
    value = make()
    cache.set(key, value)
  }
  return value
}

const PAPER = '#FAEEE9'
const RUBRIC = '#C75730'
const INK = '#9E4123' // 5.71:1 on the paper
const RULE = '#E4C7BC'
const LATIN = "'Iowan Old Style','Palatino',Georgia,serif"
const DEVANAGARI = "'Kohinoor Devanagari','ITF Devanagari','Noto Sans Devanagari','Noto Serif Devanagari',sans-serif"

const UPRIGHT = /^[㐀-鿿豈-﫿가-힣]{1,3}$/
const LENGTH = 104 // px of the slip's body a sideways rank may run along, centred at y 80
const MIDDLE = 80

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

function fontsFor(rank: string): string {
  if (/[가-힣]/.test(rank)) return SLIP_FONTS.hangul
  if (/[㐀-鿿豈-﫿]/.test(rank)) return SLIP_FONTS.han
  if (/[ऀ-ॿ]/.test(rank)) return DEVANAGARI
  return LATIN
}

// About how long a line runs at 1px font size: enough to choose a size and a break, never
// trusted to the pixel (an over-long line is fitted with textLength).
function ems(text: string): number {
  let n = 0
  for (const ch of text) {
    if (/\s/.test(ch)) n += 0.28
    else if (/\p{Mn}|\p{Me}/u.test(ch)) n += 0
    else if (/\p{Mc}/u.test(ch)) n += 0.3
    else if (/\p{Lu}/u.test(ch)) n += 0.68
    else if (/[ऀ-ॿ]/.test(ch)) n += 0.62
    else n += 0.55
  }
  return n
}

// Two lines when one would be too long: the break (a space or hyphen) nearest the middle.
function lines(rank: string, size: number): string[] {
  if (ems(rank) * size <= LENGTH) return [rank]
  let best: [string, string] | undefined
  let worst = Infinity
  for (let i = 1; i < rank.length - 1; i++) {
    const ch = rank[i]
    if (ch !== ' ' && ch !== '-') continue
    const a = ch === '-' ? rank.slice(0, i + 1) : rank.slice(0, i)
    const b = rank.slice(i + 1)
    const longest = Math.max(ems(a), ems(b))
    if (longest < worst) {
      worst = longest
      best = [a, b]
    }
  }
  return best ?? [rank]
}

function sideways(rank: string): string {
  const devanagari = /[ऀ-ॿ]/.test(rank)
  const rows = lines(rank, 14)
  const longest = Math.max(...rows.map(ems))
  const size = Math.max(10, Math.min(14, Math.floor(LENGTH / longest)))
  const leading = size * (devanagari ? 1.5 : 1.3)
  // Turned a quarter clockwise, a line's glyphs stand to the right of its baseline and the next
  // line falls to the left of it, as on a book's spine; the block is centred on the slip.
  return rows
    .map((row, i) => {
      const centre = 28 + ((rows.length - 1) / 2 - i) * leading
      const x = (centre - size * 0.35).toFixed(1)
      const fit = ems(row) * size > LENGTH ? ` textLength="${LENGTH}" lengthAdjust="spacingAndGlyphs"` : ''
      // No letter-spacing in Devanagari: it would pull its joined letters apart.
      const spacing = devanagari ? '' : ' letter-spacing="0.4"'
      return `<text transform="translate(${x} ${MIDDLE}) rotate(90)" text-anchor="middle" font-size="${size}"${spacing}${fit}>${escapeXml(row)}</text>`
    })
    .join('')
}

// The slip at reading size, 56 x 150: a rubric header with his crest, the rank written top to
// bottom. One to three Han or Hangul characters stand upright; any other rank runs down the slip
// on its side (on two lines when long), as titles on a book's spine do. No rank: ruled lines.
export function slipLargeSvg(rank: string): string {
  return once(`slip:${rank}`, () => {
    const chars = [...rank]
    const crest = [0, 45, 90, 135]
      .map(a => {
        const r = (a * Math.PI) / 180
        const dx = (Math.cos(r) * 4.5).toFixed(2)
        const dy = (Math.sin(r) * 4.5).toFixed(2)
        return `M${(28 - Number(dx)).toFixed(2)} ${(9 - Number(dy)).toFixed(2)}L${(28 + Number(dx)).toFixed(2)} ${(9 + Number(dy)).toFixed(2)}`
      })
      .join('')
    const text = UPRIGHT.test(rank)
      ? chars
          .map((c, i) => `<text x="28" y="${(MIDDLE - (chars.length - 1) * 13 + i * 26).toFixed(0)}" text-anchor="middle" dominant-baseline="central" font-size="22">${escapeXml(c)}</text>`)
          .join('')
      : rank
        ? sideways(rank)
        : [40, 56, 72, 88, 104, 120].map(y => `<path d="M12 ${y}h32" stroke="${RULE}"/>`).join('')
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 150" width="56" height="150">' +
      `<rect x="1" y="1" width="54" height="148" rx="2" fill="${PAPER}" stroke="${RUBRIC}"/>` +
      `<path d="M1 3a2 2 0 0 1 2-2h50a2 2 0 0 1 2 2v14H1z" fill="${RUBRIC}"/>` +
      `<path d="${crest}" stroke="${PAPER}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M8 140h40" stroke="${RULE}"/>` +
      `<g fill="${INK}" font-weight="700" font-family="${fontsFor(rank)}">${text}</g>` +
      '</svg>'
    )
  })
}

// A thin meter: the filled share of a track, rounded to a whole percent so a few cached
// strings cover every reading. The number beside it is what carries the meaning.
export function meterSvg(percent: number, width = 168): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return once(`meter:${p}:${width}`, () => {
    const filled = Math.round((width * p) / 100)
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 8" width="${width}" height="8">` +
      `<rect x="0" y="1" width="${width}" height="6" rx="3" fill="${RUBRIC}" fill-opacity="0.22"/>` +
      (filled > 0 ? `<rect x="0" y="1" width="${Math.max(filled, 6)}" height="6" rx="3" fill="${RUBRIC}"/>` : '') +
      '</svg>'
    )
  })
}
