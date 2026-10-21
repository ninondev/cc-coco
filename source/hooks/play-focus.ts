// The focus bar (lane C, 10-14): `/coco focus` runs 25 minutes by default, and beside their eight coral cells, their
// hair-tie cubes, light one by one as it passes (the approved preview: 「专注默认 25 分钟分 8 格」). On the desktop
// each cell lights by its own one-shot CSS step; the terminal draws the cells as text and keeps the stick's chained
// timer, one step a cell. The source is play_sprites.py (focus_bar) in handoffs/program/design/1.0/new-play/tools.
import { contrastSvg } from './high-contrast'
import { PIXEL_EDGE_STYLE, pixelRuns } from './quota'

export const FOCUS_CELLS = 8
const CELL_ON = ['OOOO', 'OrRO', 'ORqO', 'OOOO']
const CELL_OFF = ['....', '.dd.', '.dd.', '....']
const INK: Record<string, string> = { O: '#5C2A1E', r: '#F2A587', R: '#D97757', q: '#AE5539', d: '#C2AD9F' }
// Eight cells of four art pixels and their gaps: 39 by 4, 1.5 CSS px a pixel.
export const FOCUS_PX = { width: 59, height: 6 } as const

/** How many cells have passed: one per eighth of the focus. */
export function focusDone(focus: { startedAt: number; endsAt: number }, now: number): number {
  const total = Math.max(1, focus.endsAt - focus.startedAt)
  return Math.max(0, Math.min(FOCUS_CELLS, Math.floor((now - focus.startedAt) / total * FOCUS_CELLS)))
}
export function focusBarRows(done: number): string[] {
  const rows = Array.from({ length: 4 }, () => Array.from({ length: FOCUS_CELLS * 5 - 1 }, () => '.'))
  for (let i = 0; i < FOCUS_CELLS; i++) {
    const cell = i < done ? CELL_ON : CELL_OFF
    cell.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') rows[y]![i * 5 + x] = ch }))
  }
  return rows.map(row => row.join(''))
}
/** The bar at `now`, each cell still to come lighting itself at its time; `still` draws it as it stands. */
export function focusBarSvg(focus: { startedAt: number; endsAt: number }, now: number, still = false): string {
  const done = focusDone(focus, now), total = Math.max(1, focus.endsAt - focus.startedAt)
  const cells: string[] = []
  let css = PIXEL_EDGE_STYLE
  for (let i = done; i < FOCUS_CELLS && !still; i++) {
    const at = Math.max(0, Math.round(focus.startedAt + (i + 1) / FOCUS_CELLS * total - now))
    css += `.c${i}{opacity:0;animation:on 1ms forwards;animation-delay:${at}ms}`
    cells.push(`<g class="c${i}">${pixelRuns(CELL_ON, i * 5, 0, INK)}</g>`)
  }
  // A cell lighting is a change of state, not motion, so reduced motion keeps it.
  if (cells.length) css += '@keyframes on{to{opacity:1}}'
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FOCUS_CELLS * 5 - 1} 4" width="${FOCUS_PX.width}" height="${FOCUS_PX.height}" shape-rendering="crispEdges"><style>${css}</style>${pixelRuns(focusBarRows(done), 0, 0, INK)}${cells.join('')}</svg>`)
}
/** The terminal's cells: ▪ passed, ▫ to come (both one cell wide in every terminal). */
export function focusBarText(done: number): string {
  return '▪'.repeat(done) + '▫'.repeat(FOCUS_CELLS - done)
}
