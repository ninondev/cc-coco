// Helpers as paper planes (lane C, 10-14): each helper they send off is a yellow sticky-note paper plane, and five or more
// fold into a stack of two (play_sprites.py plane and planes_stack, the visitors' plane in sticky-note yellow). The plane is
// thrown in when the helper starts; done, it flies back to them; failed, it drops. Each motion is one CSS animation inside
// the picture, set to the helper's elapsed time, so nothing is scheduled for it.
import { contrastSvg } from './high-contrast'
import { PIXEL_EDGE_STYLE, pixelRuns } from './quota'

const PLANE = ['...........OO', '........OOOhO', '.....OOOhhhO.', '..OOOhhhhhhO.', 'OOhhhhhhhhO..', '.OOmmmmshO...', '...OOOmmsO...', '......OOsO...', '........O....']
const INK: Record<string, string> = { O: '#5C2A1E', h: '#FFF6C9', m: '#F7D768', s: '#E8B94A' }
const W = 13, H = 9, DY = 4
// 1.5 CSS px an art pixel: one plane 20 by 14, the stack 20 by 20.
export const PLANE_PX = { width: 20, height: 14 } as const
export const PLANES_PX = { width: 20, height: 20 } as const
export type PlaneMotion = { arrivalDelay?: number; leave?: 'done' | 'failed'; elapsed?: number; reduced?: boolean }

// The helpers' own timings (D1: arrive 240 ms, done 220 ms, failed 260 ms), so a plane's motion ends when the band lets the
// helper go.
function motion(o: PlaneMotion): string {
  if (o.reduced) return ''
  const elapsed = Math.max(0, o.elapsed ?? 0)
  if (o.leave === 'done') return `@keyframes pd{to{opacity:0;transform:translate(-8px,-3px)}}.g{animation:pd 220ms cubic-bezier(.4,0,1,1) ${-elapsed}ms both}`
  if (o.leave === 'failed') return `@keyframes pf{to{opacity:0;transform:translateY(5px) rotate(24deg)}}.g{transform-origin:6.5px 4.5px;animation:pf 260ms cubic-bezier(.4,0,1,1) ${-elapsed}ms both}`
  return o.arrivalDelay === undefined ? '' : `@keyframes pa{from{opacity:0;transform:translate(-5px,3px)}}.g{animation:pa 240ms cubic-bezier(0,0,.2,1) ${o.arrivalDelay - elapsed}ms both}`
}
/** The plane, or two of them stacked, the upper one laid over the lower. */
export function planeRows(stack = false): string[] {
  if (!stack) return [...PLANE]
  const rows = Array.from({ length: H + DY }, () => Array.from({ length: W }, () => '.'))
  for (const dy of [DY, 0]) PLANE.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') rows[y + dy]![x] = ch }))
  return rows.map(row => row.join(''))
}
const cache = new Map<string, string>()
/** One plane, or the stack that stands for the rest. */
export function planeSvg(o: PlaneMotion = {}, stack = false): string {
  const key = JSON.stringify([o, stack])
  let svg = cache.get(key)
  if (svg === undefined) {
    const h = stack ? H + DY : H, size = stack ? PLANES_PX : PLANE_PX
    const body = pixelRuns(planeRows(stack), 0, 0, INK)
    svg = contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${size.width}" height="${size.height}" shape-rendering="crispEdges"><style>${PIXEL_EDGE_STYLE}${motion(o)}@media(prefers-reduced-motion:reduce){.g{animation:none}}</style><g class="g">${body}</g></svg>`)
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(key, svg)
  }
  return svg
}
