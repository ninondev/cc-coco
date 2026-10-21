// Coco's own card, as the draft stands it in the box's front right corner: cream stock with a coral band, Coco's
// frame, "Coco" in bold and their line under it, the whole card turned TILT degrees. The card is one still picture;
// Coco's frames are laid over it by the pane (they turn inside their own upright frame by the same angle,
// tools/cards/build-art.mjs),
// so this module also says where the frame goes. Nothing here draws.

/** The card in CSS px, as the draft's `.box > .coco`: 124 wide, the frame set 6 in and 10 down. */
const CARD_W = 124
const IN_X = 6
const IN_Y = 10
/** Room around the card in the picture for its turned corners and the soft shadow under it. */
const M_X = 14
const M_TOP = 8
const M_BOTTOM = 26
const TYPE = 12
const LEAD = 17.4
const MAX_LINES = 3
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans','Apple SD Gothic Neo','Noto Sans',sans-serif"

export type CocoCard = {
  /** The card picture, for a non-interactive Svg. */
  svg: string
  /** Its size in CSS px. */
  w: number
  h: number
  /** Where Coco's upright frame's top left corner goes in the picture, in CSS px. */
  frameX: number
  frameY: number
  /** How far down the picture the turned card's lowest corner reaches, in CSS px; the shadow runs on under it. */
  foot: number
}

/** A rough width in px of `s` set at `size`: enough to break a line before it runs off the card. */
export function textPx(s: string, size: number): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x3000 && c <= 0x30ff)) w += size
    else if (ch === ' ') w += size * 0.28
    else if (/[A-Z]/.test(ch)) w += size * 0.64
    else if (/[iljtf.,:;'!|]/.test(ch)) w += size * 0.3
    else w += size * 0.54
  }
  return w
}

/** Breaks `s` into lines no wider than `max` px: at spaces, or between any two characters of a script without them. */
export function wrap(s: string, max: number, size: number): string[] {
  const lines: string[] = []
  let line = ''
  // a closing mark never starts a line: it rides with the character before it
  const words: string[] = []
  for (const w of s.split(/(?<= )|(?=[⺀-鿿　-ヿ＀-￯])|(?<=[⺀-鿿　-ヿ＀-￯])/u)) {
    if (words.length && /^[、。，．！？：；）」』～~,.!?:;)]/u.test(w)) words[words.length - 1] += w
    else words.push(w)
  }
  for (const word of words) {
    if (line && textPx((line + word).trimEnd(), size) > max) {
      lines.push(line.trimEnd())
      line = word.trimStart()
    } else line += word
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Coco's card with `line` under the name, turned `tilt` degrees about the middle of Coco's frame, which is where the
 * frames turn too. The frame is `fw` by `fh` px.
 */
export function cocoCard(line: string, tilt: number, fw: number, fh: number): CocoCard {
  const lines = wrap(line, CARD_W - IN_X * 2 - 4, TYPE).slice(0, MAX_LINES)
  const ch = IN_Y + fh + 6 + 18 + lines.length * LEAD + 6
  const x0 = M_X
  const y0 = M_TOP
  const w = CARD_W + M_X * 2
  const h = Math.ceil(y0 + ch + M_BOTTOM)
  const frameX = x0 + IN_X
  const frameY = y0 + IN_Y
  const px = frameX + fw / 2
  const py = frameY + fh / 2
  const who = y0 + IN_Y + fh + 6 + 13
  const text = lines.map((l, i) => `<text class="l" x="${x0 + IN_X + 2}" y="${(who + 4 + LEAD * (i + 1)).toFixed(1)}">${esc(l)}</text>`).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<style>text{font-family:${FONT};font-size:${TYPE}px}.w{font-weight:700;fill:#2a241d}.l{fill:#5b5246}` +
    `.b{fill:#d97757}.s{fill:#3b2a17}.e{opacity:.2}.f{opacity:.55}` +
    `@media (prefers-color-scheme:dark){.b{fill:#e58a6c}.s{fill:#000}.e{opacity:.45}.f{opacity:.85}}</style>` +
    `<defs><filter id="u" x="-40%" y="-30%" width="180%" height="170%"><feGaussianBlur stdDeviation="9"/></filter>` +
    `<clipPath id="k"><rect x="${x0}" y="${y0}" width="${CARD_W}" height="${ch}" rx="5"/></clipPath></defs>` +
    `<g transform="rotate(${tilt} ${px} ${py})">` +
    // the draft's lift: a soft shadow 12 px down from a card 12 px smaller all round, and a hairline under the edge
    `<rect class="s f" x="${x0 + 12}" y="${y0 + 12 + 12}" width="${CARD_W - 24}" height="${ch - 24}" rx="5" filter="url(#u)"/>` +
    `<rect class="s e" x="${x0}" y="${y0 + 1}" width="${CARD_W}" height="${ch}" rx="5"/>` +
    `<rect x="${x0}" y="${y0}" width="${CARD_W}" height="${ch}" rx="5" fill="#fffdf8"/>` +
    `<rect class="b" x="${x0}" y="${y0}" width="${CARD_W}" height="4" clip-path="url(#k)"/>` +
    `<text class="w" x="${x0 + IN_X + 2}" y="${who}">Coco</text>${text}</g></svg>`
  const t = (tilt * Math.PI) / 180
  const foot = py + (x0 + CARD_W - px) * Math.sin(t) + (y0 + ch - py) * Math.cos(t)
  return { svg, w, h, frameX, frameY, foot }
}

/** A still picture and its size in CSS px. */
export type Picture = { svg: string; w: number; h: number }

/**
 * The pulled card's use count as the draft stamps it: bold stamp-red letters in a 2 px rounded frame, the whole
 * stamp turned 3 degrees back. The letters are held to the width measured for them (`textLength`), so a font a
 * little wider or narrower than the estimate still sits inside the frame.
 */
export function stamp(text: string, ink: string): Picture {
  const size = 14
  const tw = Math.ceil(textPx(text, size) * 1.04)
  const fw = tw + 18 + 4
  const fh = 25
  const turn = (3 * Math.PI) / 180
  // room for the turned corners
  const mx = Math.ceil((fh * Math.sin(turn)) / 2) + 2
  const my = Math.ceil((fw * Math.sin(turn)) / 2) + 2
  const w = fw + mx * 2
  const h = fh + my * 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g transform="rotate(-3 ${w / 2} ${h / 2})" fill="none" stroke="${ink}">` +
    `<rect x="${mx + 1}" y="${my + 1}" width="${fw - 2}" height="${fh - 2}" rx="6" stroke-width="2"/>` +
    `<text x="${w / 2}" y="${my + fh / 2 + size * 0.36}" text-anchor="middle" textLength="${tw}" lengthAdjust="spacingAndGlyphs" ` +
    `fill="${ink}" stroke="none" font-family="${FONT.replace(/"/g, "'")}" font-size="${size}" font-weight="700">${esc(text)}</text></g></svg>`
  return { svg, w, h }
}

/** The draft's "+1" flag on a card used since it was last pulled: a coral slip, bold ink, turned four degrees back. */
export const FLAG: Picture = {
  svg:
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="22" viewBox="0 0 32 22"><g transform="rotate(-4 16 11)">` +
    `<rect x="3" y="2.5" width="26" height="17" rx="2" fill="#d97757"/>` +
    `<text x="16" y="15.4" text-anchor="middle" textLength="14" lengthAdjust="spacingAndGlyphs" fill="#2b140a" ` +
    `font-family="${FONT.replace(/"/g, "'")}" font-size="12" font-weight="700">+1</text></g></svg>`,
  w: 32,
  h: 22,
}

/** The flag at opacity `o`, for the steps in which the pane takes it off a pulled card as the draft fades it. */
export function flagAt(o: number): Picture {
  return { ...FLAG, svg: FLAG.svg.replace('<g transform=', `<g opacity="${o}" transform=`) }
}
