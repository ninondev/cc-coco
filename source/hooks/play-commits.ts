// The commit line (lane C, 10-14): how full the conversation is, drawn as up to five commits on one line, each a fifth of
// the context window, with the tokens beside it in k (owner 10-14: 「把对话从百分比改成多少多少k」). While the
// conversation is compacted the commits are pushed together; when it ends they flatten into one and that one springs
// round (the squash). The unpublished drawing tool play_sprites.py (commit_line, squash_frames) is the
// source these rows are checked against.
import { contrastSvg } from './high-contrast'
import { hasNumber, numberLocale } from './numbers'
import { PIXEL_EDGE_STYLE, pixelRuns } from './quota'

export const COMMIT_SLOTS = 5
// Five commits and their four links: 33 art pixels by 6 (the round one is a row taller), 1.5 CSS px a pixel.
export const COMMIT_LINE_PX = { width: 50, height: 9 } as const
const W = COMMIT_SLOTS * 5 + (COMMIT_SLOTS - 1) * 2, H = 6
// On the narrowest band the line keeps only the commits it has (the squash still needs its 17 pixels).
function artWidth(n: number, fit: boolean, stage?: 'pushed' | 'squash'): number {
  if (!fit) return W
  const slots = Math.max(1, Math.min(COMMIT_SLOTS, n))
  return Math.max(slots * 5 + (slots - 1) * 2, stage ? COMMIT_SLOTS * 3 + 2 : 0)
}
/** `scale` 1 draws it at one CSS px a pixel, for the one-row band. */
export function commitLineWidth(n: number, fit = false, stage?: 'pushed' | 'squash', scale = 1.5): number {
  return fit || scale !== 1.5 ? Math.ceil(artWidth(n, fit, stage) * scale) : COMMIT_LINE_PX.width
}
export function commitLineHeight(scale = 1.5): number {
  return scale === 1.5 ? COMMIT_LINE_PX.height : Math.ceil(H * scale)
}
const DOT = ['.OOO.', 'OrrRO', 'OrRqO', 'ORqqO', '.OOO.']
const FLAT = ['..OOOOOOO..', '.OrrrRRRRO.', 'OrRRRRRRRqO', '.OqqqqqqqO.', '..OOOOOOO..']
const ROUND = ['.OOOO.', 'OrrRRO', 'OrRRqO', 'ORRqqO', 'OqqqqO', '.OOOO.']

/** How many commits a context reading draws: one per fifth, at least one once there is a reading. */
export function commitCount(percent: number | null | undefined): number {
  if (!hasNumber(percent)) return 0
  return Math.max(1, Math.min(COMMIT_SLOTS, Math.round(percent / 20)))
}
function blank(width: number): string[][] { return Array.from({ length: 5 }, () => Array.from({ length: width }, () => '.')) }
function blit(canvas: string[][], rows: readonly string[], ox: number, oy = 0): void {
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && canvas[y + oy]?.[x + ox] !== undefined) canvas[y + oy]![x + ox] = ch }))
}
export function commitLineRows(n: number): string[] {
  const canvas = blank(W)
  for (let k = 0; k < n; k++) {
    blit(canvas, DOT, k * 7)
    if (k < n - 1) blit(canvas, ['OO'], k * 7 + 5, 2)
  }
  return canvas.map(row => row.join(''))
}
export function commitPushedRows(): string[] {
  const canvas = blank(COMMIT_SLOTS * 3 + 2)
  for (let k = 0; k < COMMIT_SLOTS; k++) blit(canvas, DOT, k * 3)
  return canvas.map(row => row.join(''))
}
export function commitFlatRows(): string[] { return [...FLAT] }
export function commitRoundRows(): string[] { return [...ROUND] }

// VS Code and the phone draw a picture by the system's light or dark, not the editor's (B4c), so there the outline is one
// fixed mid tone that reads on both, as the old box's was.
export const REMOTE_EDGE_STYLE = '.e{fill:#8A4A36}'
function svg(width: number, body: string, extra = '', scale = 1.5, edge = PIXEL_EDGE_STYLE): string {
  const w = scale === 1.5 && width === W ? COMMIT_LINE_PX.width : Math.ceil(width * scale)
  return contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}" width="${w}" height="${commitLineHeight(scale)}" shape-rendering="crispEdges"><style>${edge}${extra}</style>${body}</svg>`)
}
/** The line itself; 'pushed' while a compaction runs; 'squash' plays flat then round once, and stays round. `fit` keeps
 * only the commits there are, for the narrowest band. */
export function commitLineSvg(n: number, stage?: 'pushed' | 'squash', fit = false, scale = 1.5, remote = false): string {
  const width = artWidth(n, fit, stage), edge = remote ? REMOTE_EDGE_STYLE : PIXEL_EDGE_STYLE
  if (stage === 'pushed') return svg(width, pixelRuns(commitPushedRows()), '', scale, edge)
  if (stage === 'squash') {
    const css = '.s{opacity:0;animation:.9s linear forwards}.s1{animation-name:c1}.s2{animation-name:c2}.s3{animation-name:c3}'
      + '@keyframes c1{0%,33%{opacity:1}33.1%,100%{opacity:0}}@keyframes c2{0%,33%{opacity:0}33.1%,66%{opacity:1}66.1%,100%{opacity:0}}@keyframes c3{0%,66%{opacity:0}66.1%,100%{opacity:1}}'
      + '@media(prefers-reduced-motion:reduce){.s{animation:none}.s3{opacity:1}}'
    return svg(width, `<g class="s s1">${pixelRuns(commitPushedRows())}</g><g class="s s2">${pixelRuns(FLAT)}</g><g class="s s3">${pixelRuns(ROUND)}</g>`, css, scale, edge)
  }
  return svg(width, pixelRuns(commitLineRows(n).map(row => row.slice(0, width))), '', scale, edge)
}
/** The terminal's form: one ◉ a commit (U+25C9 takes one cell in every terminal), one while it is squashed. */
export function commitLineText(n: number, squashed = false): string {
  return squashed ? '◉' : '◉'.repeat(n)
}
/** Tokens in k: 840, 4.5k, 128k; "~" marks the engine's own estimate after a compaction or a fresh start. */
export function contextTokensText(tokens: number, lang: string, estimate = false): string {
  const t = Math.max(0, Math.round(tokens))
  const format = (value: number, digits: number) => new Intl.NumberFormat(numberLocale(lang), { maximumFractionDigits: digits, useGrouping: false }).format(value)
  const text = t < 1000 ? format(t, 0) : t < 10_000 ? format(Math.round(t / 100) / 10, 1) + 'k' : format(Math.round(t / 1000), 0) + 'k'
  return (estimate ? '~' : '') + text
}
