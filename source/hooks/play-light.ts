// The breathing light (lane C, 10-14): they hold their laptop shut, seen from the side so it is thin as a line, and the
// little light at its front edge brightens as you breathe in and dims as you breathe out. It replaces the incense plume
// and keeps its timing (play.ts: four seconds in, six out); nothing new is scheduled for it. On the desktop the light is
// one CSS cycle set to the breath's phase; the terminal steps it with the breath's own cells. The source is
// the unpublished drawing tool play_sprites.py (LAPTOP_SHUT, laptop_light).
import { contrastSvg } from './high-contrast'
import { BREATH_CYCLE_MS } from './play'
import { PIXEL_EDGE_STYLE, pixelRuns } from './quota'

const LAPTOP_SHUT = [
  '.OOOOOOOOOOOOOOOOO.',
  'OlllllllllllllllllO',
  'ObbbbbbbbbbbbbbbbbO',
  'OsssssssssssssssEEO',
  '.OOOOOOOOOOOOOOOOO.',
]
const INK: Record<string, string> = { O: '#5C2A1E', l: '#6A6A74', b: '#45454D', s: '#2E2E35', E: '#7E8A94' }
// The light: off, half, full.
export const LED = ['#7E8A94', '#BFE3FF', '#F4FBFF'] as const
const PAD = 4
// 19 by 5 art pixels with room for the glow, 1.5 CSS px a pixel.
export const LIGHT_PX = { width: 35, height: 20 } as const
const EASE = 'cubic-bezier(.37,0,.63,1)' // the old incense plume's ease

/** The light's level for a point in the breath, 0 to 1 (play.ts breathLevel): off, half or full. */
export function lightLevel(breath: number): 0 | 1 | 2 {
  return breath >= 2 / 3 ? 2 : breath >= 1 / 3 ? 1 : 0
}
/** The closed laptop with its light. `phaseMs` sets the cycle; `still` holds the light half on (reduce motion). */
export function laptopLightSvg(phaseMs: number, still = false): string {
  const phase = Math.round((((phaseMs % BREATH_CYCLE_MS) + BREATH_CYCLE_MS) % BREATH_CYCLE_MS) / 100) * 100
  // The design centres the glow on pixel (w - 2.5, pad + 3), which is this point in the SVG's coordinates.
  const w = LAPTOP_SHUT[0]!.length, h = LAPTOP_SHUT.length, cx = w - 2, cy = PAD + 3.5
  const css = PIXEL_EDGE_STYLE
    + `.led{fill:${LED[0]};animation:led 10s infinite;animation-delay:-${phase}ms}.glow{opacity:0;animation:glow 10s infinite;animation-delay:-${phase}ms}`
    + `@keyframes led{0%{fill:${LED[0]};animation-timing-function:${EASE}}20%{fill:${LED[1]};animation-timing-function:${EASE}}40%{fill:${LED[2]};animation-timing-function:${EASE}}70%{fill:${LED[1]};animation-timing-function:${EASE}}100%{fill:${LED[0]}}}`
    + `@keyframes glow{0%{opacity:0;animation-timing-function:${EASE}}40%{opacity:1;animation-timing-function:${EASE}}100%{opacity:0}}`
    + (still ? `.led{animation:none;fill:${LED[1]}}.glow{animation:none;opacity:.5}` : '')
    + `@media(prefers-reduced-motion:reduce){.led{animation:none;fill:${LED[1]}}.glow{animation:none;opacity:.5}}`
  const glow = `<defs><radialGradient id="g"><stop offset="0" stop-color="#D2ECFF" stop-opacity=".55"/><stop offset="1" stop-color="#D2ECFF" stop-opacity="0"/></radialGradient></defs><circle class="glow" cx="${cx}" cy="${cy}" r="4.5" fill="url(#g)"/>`
  const body = pixelRuns(LAPTOP_SHUT.map(row => row.replace(/E/g, '.')), 0, PAD, INK)
  const led = `<rect class="led" x="${w - 3}" y="${PAD + 3}" width="2" height="1"/>`
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + PAD} ${h + PAD * 2}" width="${LIGHT_PX.width}" height="${LIGHT_PX.height}" shape-rendering="crispEdges"><style>${css}</style>${glow}${body}${led}</svg>`)
}
