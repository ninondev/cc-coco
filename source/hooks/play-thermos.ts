// The thermos (保温杯, lane C, 10-14): while keeping the cache warm is on, the band's cache cup becomes their coral thermos
// with a metal cap and a cream band (the owner saw it on 《设置外面》). Drawn like the quota pictures, one rect per run, its
// outline lightening on a dark ground. The source is the unpublished drawing tool play_sprites.py (THERMOS).
import { contrastSvg } from './high-contrast'
import { PIXEL_EDGE_STYLE, pixelRuns } from './quota'

export const THERMOS_ROWS = [
  '.OOOOO.',
  '.OmmmO.',
  'OOOOOOO',
  'OhcccsO',
  'OhcccsO',
  'OhwwwsO',
  'OhcccsO',
  'OhcccsO',
  'OhcccsO',
  '.OOOOO.',
] as const
const INK: Record<string, string> = { O: '#5C2A1E', m: '#C9C2BC', h: '#F2A587', c: '#D97757', s: '#AE5539', w: '#FFFDF8' }
export const THERMOS_PX = { width: 7, height: 10 } as const

// `box` pads the picture to the cup's own 16 x 22 place in the band (one CSS px each side at 2x), so nothing moves.
export function thermosSvg(scale = 2, box = false): string {
  const { width, height } = THERMOS_PX, pad = box ? 0.5 : 0
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}" width="${(width + 2 * pad) * scale}" height="${(height + 2 * pad) * scale}" shape-rendering="crispEdges"><style>${PIXEL_EDGE_STYLE}</style>${pixelRuns(THERMOS_ROWS, 0, 0, INK)}</svg>`)
}
