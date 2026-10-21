// The small pictures of the notices, drawn in code: their place marker (a sticky note), the slip he passes, the night
// lamp, the rain pane and the reading-glasses stand-in. Every picture carries forced-color-adjust:none and
// both high-contrast blocks; light and dark come from the picture's own media query.
// Ported from handoffs/program/design/1.0/notices/tools/pieces.py and pieces2.py.
import { contrastMedia } from './high-contrast'

const DARK = (css: string): string => `@media(prefers-color-scheme:dark){${css}}`
const REDUCED = (css: string): string => `@media(prefers-reduced-motion:reduce){${css}}`

function wrap(w: number, h: number, body: string, style: string, hcLight: string, hcDark: string, view = `0 0 ${w} ${h}`): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${w}" height="${h}" style="forced-color-adjust:none"><style>${style}${contrastMedia(hcLight, hcDark)}</style>${body}</svg>`
}

const cache = new Map<string, string>()
const once = (key: string, make: () => string): string => {
  let hit = cache.get(key)
  if (hit === undefined) { hit = make(); cache.set(key, hit) }
  return hit
}

// Their place in a list (lane C, 10-14): a yellow sticky note, its top
// strip a shade darker and its lower right corner folded up, 16 x 22 (play_sprites.py NOTE drawn at this size). The first
// note of a list drops in (fade 150 ms, fall 260 ms); each later place gives it a small hop (380 ms). The picture differs
// by `dip`, so a new place restarts its own animation and nothing is scheduled by the plugin. Reduced motion: none.
export function placeSvg(dip: number): string {
  return once(`place:${dip === 0 ? 0 : 1 + (dip % 2)}`, () => {
    const hop = (name: string): string => `.s{animation:${name} .38s both}@keyframes ${name}{0%{transform:none;animation-timing-function:ease-out}37%{transform:translateY(-2.5px);animation-timing-function:ease-in}100%{transform:none}}`
    const motion = dip === 0
      ? '.m{animation:cs-f .15s ease-out both}.s{animation:cs-u .26s cubic-bezier(0,0,.2,1) both}@keyframes cs-f{from{opacity:0}}@keyframes cs-u{from{transform:translateY(-6px)}}'
      : hop(dip % 2 ? 'cs-pa' : 'cs-pb')
    const body =
      '<g class="m"><g class="s">' +
      '<path class="nt" d="M1.5 5.5H14.5V15.6L11.6 18.5H1.5Z"/><path class="tp" d="M1.5 5.5H14.5V7.7H1.5Z"/>' +
      '<path class="fd" d="M11.6 18.5V15.6H14.5Z"/><path class="ol" d="M1.5 5.5H14.5V15.6L11.6 18.5H1.5Z"/></g></g>'
    const style =
      '.nt{fill:#F7D768}.tp{fill:#E8B94A}.fd{fill:#FFF6C9}.ol{fill:none;stroke:#5C2A1E;stroke-width:.9;stroke-linejoin:round}' + motion + REDUCED('.m,.s{animation:none}') +
      DARK('.ol{stroke:#A07B6A}')
    return wrap(16, 22, body, style, '.ol{stroke:#000;stroke-width:1.1}', '.ol{stroke:#FAEEE9;stroke-width:1.1}')
  })
}

// The note he passes: a slip of paper, tilted, an orange-red band at its head, 10 x 16.
export function slipIconSvg(): string {
  return once('slip', () => {
    const body = '<g transform="rotate(-9 5 8)"><rect class="p" x="2" y="1.5" width="6.2" height="13" rx=".6"/><rect class="t" x="2" y="1.5" width="6.2" height="2.4" rx=".6"/>' +
      '<line class="l" x1="5.1" x2="5.1" y1="5.8" y2="9.6"/><line class="l" x1="5.1" x2="5.1" y1="10.8" y2="12.6"/></g>'
    const style = '.p{fill:#FAEEE9;stroke:#9E4123;stroke-width:.8}.t{fill:#C75730}.l{stroke:#5C2A1E;stroke-width:.9;stroke-linecap:round}' + DARK('.p{stroke:#C9A99B}')
    return wrap(10, 16, body, style, '.p{stroke:#231B19}.t{fill:#9E4123}', '.p{stroke:#FAEEE9}')
  })
}

// ------------------------------------------------------------------ in his picture (frame pixels, viewBox -4 0 159 128)

// The paper floor lamp of his room at the lower left, lit, with its light warming his left side.
// 32 x 58 frame pixels at x 0, y 70. The light is not drawn under high contrast.
function lamp(): string {
  const w = 22, h = 40
  const fr = (x: number, y: number, ww: number, hh: number, rx = 0): string => `<rect class="fr" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ww.toFixed(1)}" height="${hh.toFixed(1)}"${rx ? ` rx="${rx}"` : ''}/>`
  return (
    `<g id="cs-lamp" transform="translate(0 70) scale(${(32 / w).toFixed(4)} ${(58 / h).toFixed(4)})">` +
    fr(w * .42, .6, w * .16, 3.4, .6) + fr(w * .14, 3.2, w * .72, 2.2, .7) +
    `<rect class="pa" x="${(w * .18).toFixed(1)}" y="5.2" width="${(w * .64).toFixed(1)}" height="${(h * .62).toFixed(1)}" fill="url(#cs-paper)"/>` +
    fr(w * .16, 5, 1.6, h * .64) + fr(w * .84 - 1.6, 5, 1.6, h * .64) + fr(w * .16, 5 + h * .31, w * .68, 1.3) +
    fr(w * .12, 5 + h * .62, w * .76, 2.2, .7) + fr(w * .16, 7.2 + h * .62, 1.8, h - 7.6 - h * .62) + fr(w * .84 - 1.8, 7.2 + h * .62, 1.8, h - 7.6 - h * .62) +
    '</g>'
  )
}

const LAMP_DEFS = '<defs><linearGradient id="cs-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DC"/><stop offset="1" stop-color="#FFE3A3"/></linearGradient>' +
  '<radialGradient id="cs-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFD27A" stop-opacity=".30"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient></defs>'
const LAMP_STYLE = '<style>#cs-lamp .fr{fill:#5C2A1E}#cs-light{opacity:.55}' + DARK('#cs-light{opacity:1}') + contrastMedia('#cs-light{display:none}#cs-lamp .fr{fill:#3A1A12}', '#cs-light{display:none}#cs-lamp .fr{fill:#E1C3AC}') + '</style>'

export function lampLayer(): string {
  return once('lamp', () => `${LAMP_DEFS}${LAMP_STYLE}<ellipse id="cs-light" cx="14" cy="96" rx="52" ry="52" fill="url(#cs-glow)"/>${lamp()}`)
}

// A pane of rainy window behind him, rounded, filling his picture's box; 30 drops, 2 x 16 frame pixels,
// slanted 10 degrees, each crossing in 820 to 1,020 ms. The one loop of the group, and it lasts as long as the
// wait it shows. Reduced motion: the pane and still drops.
export function rainLayer(): string {
  return once('rain', () => {
    let seed = 5
    const next = (): number => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const drops = Array.from({ length: 30 }, () => {
      const x = 8 + next() * 133, period = 820 + next() * 200, phase = next() * period
      return `<g transform="translate(${x.toFixed(1)} 0)"><rect class="dr" x="0" y="0" width="2" height="16" style="animation-duration:${period.toFixed(0)}ms;animation-delay:-${phase.toFixed(0)}ms"/></g>`
    }).join('')
    const style = '<style>#cs-rain .pane{fill:#DEE7EC}#cs-rain .sill{stroke:#C4D0D6;stroke-width:2}#cs-rain .dr{fill:#46708A;transform-box:fill-box;animation:cs-fall linear infinite}' +
      '@keyframes cs-fall{from{transform:translate(0,-18px) skewX(-10deg)}to{transform:translate(16px,132px) skewX(-10deg)}}' +
      DARK('#cs-rain .pane{fill:#28343C}#cs-rain .sill{stroke:#3C4950}#cs-rain .dr{fill:#A8D4E6}') + REDUCED('#cs-rain .dr{animation-play-state:paused}') +
      contrastMedia('#cs-rain .dr{fill:#1B3A4D}', '#cs-rain .dr{fill:#D4EEF9}') + '</style>'
    return `${style}<g id="cs-rain"><rect class="pane" x="2" y="6" width="146" height="121" rx="10"/><line class="sill" x1="4" x2="146" y1="122" y2="122"/>${drops}</g>`
  })
}

// Round reading glasses over both eyes of the scroll pose: a stand-in drawn in code for the painted patch
// (art step 12). The eyes of the re-cut scroll-a and scroll-b (151 x 128) are two capsules about x 56 to 62
// and 82 to 87, y 79 to 89; the bangs stay in front, so nothing is drawn above y 78.
export function glassesLayer(): string {
  return once('glasses', () => {
    const lens = (cx: number): string => `<circle class="rim" cx="${cx}" cy="85.8" r="8.6"/><path class="lit" d="M${(cx - 5.82).toFixed(2)} 83.68A6.19 6.19 0 0 1 ${(cx - 2.12).toFixed(2)} 79.98"/>`
    const style = '<style>#cs-glasses .rim{fill:none;stroke:#5C2A1E;stroke-width:1.25}#cs-glasses .lit{fill:none;stroke:#fff;stroke-opacity:.67;stroke-width:.9;stroke-linecap:round}#cs-glasses .bar{fill:none;stroke:#5C2A1E;stroke-width:1.3;stroke-linecap:round}' +
      DARK('#cs-glasses .rim,#cs-glasses .bar{stroke:#3A1A12}') + '</style>'
    return `${style}<clipPath id="cs-glasses-clip"><rect x="0" y="78" width="151" height="50"/></clipPath><g id="cs-glasses" clip-path="url(#cs-glasses-clip)">${lens(59.7)}${lens(85)}<path class="bar" d="M66.66 83.77A6.05 3.75 0 0 1 78.04 83.77"/></g>`
  })
}

// The desktop tree keeps a picture under 90 % of 131,072 characters (desktop-safe); a picture that would pass it stays undressed.
const PICTURE_LIMIT = 117_964

export type Dress = { night: boolean; rain: boolean; glasses: boolean }
// Where his picture's units land on Coco's (coco-motion.ts, data-coco on its tag): one transform for the pane, one for the lamp.
export type DressPlace = { pane: string; lamp: string }

// Lays the reactions on a painted picture: the pane behind (just after the opening tag), the rest in front
// (just before the closing one). A picture that is not the painted band's is returned as it came.
// Coco's picture takes only the pane and the lamp, each through its place: Coco has no bow (the keycap hairclip comes
// off in frames of Coco's own), and the glasses wait for the places of Coco's eyes. Past the desktop tree's limit
// the picture stays undressed.
export function dressPicture(source: string, dress: Dress, place?: DressPlace): string {
  if (!dress.night && !dress.rain && !dress.glasses) return source
  if (place) {
    const head = /^<svg\b[^>]*\bdata-coco="[^"]*"[^>]*>/.exec(source)
    if (!head || !source.endsWith('</svg>') || !(dress.night || dress.rain)) return source
    const dressed = head[0] + (dress.rain ? `<g transform="${place.pane}">${rainLayer()}</g>` : '') + source.slice(head[0].length, -'</svg>'.length) +
      (dress.night ? `<g transform="${place.lamp}">${lampLayer()}</g>` : '') + '</svg>'
    return dressed.length > PICTURE_LIMIT ? source : dressed
  }
  const open = /^<svg\b[^>]*viewBox="-4 0 159 128"[^>]*>/.exec(source)
  if (!open || !source.endsWith('</svg>')) return source
  const front = (dress.glasses ? glassesLayer() : '') + (dress.night ? lampLayer() : '')
  return open[0] + (dress.rain ? rainLayer() : '') + source.slice(open[0].length, -'</svg>'.length) + front + '</svg>'
}
