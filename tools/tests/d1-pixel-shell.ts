// The terminal's shell change as her pixel version plays it (DECISIONS 917), for the D1 compaction counters: the
// picture at each moment after the compaction ends, and how many of her own frame changes (each one redraw) have
// happened by then. The play starts when the ended compaction is first drawn, in the outfit she changes out of.
import { PIXEL_MOMENTS } from '../hooks/coco-pixel'
import { pixelCells, pixelNext, pixelPng, pixelStep } from '../hooks/coco-pixel-play'

const BODY = PIXEL_MOMENTS.shell!.body
// the moments, in ms after the end, where her frame changes and the band is drawn again; the last is the change's
// end, when she goes on standing in the outfit she changed into
export const SHELL_BOUNDS: readonly number[] = BODY.map((_, i) => BODY.slice(0, i + 1).reduce((a, s) => a + s[1], 0))
export function shellRedraws(ms: number): number { return SHELL_BOUNDS.filter(edge => edge <= ms).length }
// the frames still to come after the 1600 ms timeline: the change outlasts it, so they land in the quiet minute after
export const SHELL_TAIL = SHELL_BOUNDS.length - shellRedraws(1600)
export function shellPicture(ms: number, kind: 'png' | 'cells', colors: 'truecolor' | '256' = 'truecolor'): string {
  const step = pixelStep(pixelNext(undefined, 'shell', 'idle', 'A', 0), ms, true, false), look = { outfit: 'A' as const, dark: true, colors }
  return kind === 'png' ? pixelPng(step.frame, step.other, look) : pixelCells(step.frame, step.other, look)
}
