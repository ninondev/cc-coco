// Coco Pet's blocking, drawn with her own hand-drawn poses, since the pet draws her that way at every size. Pure
// builders: no filesystem, clock or theme; the caller hands in her still (coco-motion.ts cocoPicture, an SVG).
import type { CocoActionKey } from './coco-motion'
export type CompanionStage = 'absent' | 'stopped' | 'hidden' | 'corner' | 'following'
export type CompanionSize = 'tiny' | 'small' | 'medium' | 'large' | 'larger'
// Every size a pet may report. Every pet offers the Mac's three (owner 10-18, DECISIONS 1012; Windows and Linux too,
// owner 10-19, DECISIONS 1060); an older pet or setting may still name Tiny or Small.
export const COMPANION_SIZES: readonly CompanionSize[] = ['tiny', 'small', 'medium', 'large', 'larger']
export const MAC_SIZES: readonly CompanionSize[] = ['medium', 'large', 'larger']
// Her pose in each place on the screen, drawn STAGE_HEIGHT px tall.
export const STAGE_POSE: Partial<Record<CompanionStage, CocoActionKey>> = { following: 'praised', corner: 'wait', stopped: 'doze', hidden: 'idle' }
export const STAGE_HEIGHT = 32
export function companionStageSvg(state: CompanionStage, figure = ''): string {
  const n = '#807B76', v = '#CC6440'
  // her still as a nested svg at its own size, centred where the old 35-wide head stood
  const placed = (x: number, y: number) => figure.replace('<svg ', `<svg x="${x + 2}" y="${y}" `)
  const head = (x: number, y: number, clip = false) => !figure ? '' : clip ? `<g clip-path="url(#above)">${placed(x, y)}</g>` : placed(x, y)
  const screen = `<rect x="1" y="1" width="148" height="94" rx="6" fill="none" stroke="${n}" stroke-width="1.5"/><path d="M1.75 10.5H148.25" stroke="${n}" stroke-width="1"/>`
  const window = `<rect x="18" y="40" width="86" height="46" rx="4" fill="none" stroke="${n}" stroke-width="1.5"/><path d="M18 48.5H104" stroke="${n}"/>` + [23.5, 28, 32.5].map(x => `<circle cx="${x}" cy="44.5" r="1.3" fill="none" stroke="${n}" stroke-width=".9"/>`).join('')
  const mark = `<g transform="translate(78.5 40) scale(1.25) translate(-6 -10)"><path d="M6 5.5v9M1.5 10h9M2.82 6.82l6.36 6.36M9.18 6.82l-6.36 6.36" fill="none" stroke="${v}" stroke-width="1.5" stroke-linecap="round"/></g>`
  let body = screen
  if (state === 'following') body += '<defs><clipPath id="above"><rect width="188" height="40"/></clipPath></defs>' + head(61, 11, true) + window
  else {
    body += window + mark
    if (state === 'corner') {
      // The mockup's open arrowhead, following the tangent of its cubic curve.
      const ux = -14 / Math.hypot(-14, 14), uy = 14 / Math.hypot(-14, 14)
      const side = (a: number) => [86.5 - 5 * (ux * Math.cos(a) - uy * Math.sin(a)), 32 - 5 * (uy * Math.cos(a) + ux * Math.sin(a))].map(x => x.toFixed(2)).join(' ')
      body += `<path d="M115 57 C111 34 100.5 18 86.5 32" fill="none" stroke="${v}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 3"/><path d="M${side(.6)} L86.5 32 L${side(-.6)}" fill="none" stroke="${v}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` + head(110, 60)
    } else if (state === 'hidden' || state === 'stopped') body += head(152, 60)
  }
  return `<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 96" width="188" height="96">${body}</svg>`
}
// Each size's preview: her still at that size's height (picture draws it and says how wide it is).
export function companionSizeSvg(size: CompanionSize, picture: (height: number) => { source: string; width: number }): { source: string; width: number; height: number } {
  const height = { tiny: 24, small: 32, medium: 48, large: 64, larger: 88 }[size]
  return { ...picture(height), height }
}
