// Pictures for his book, built once per distinct input and cached. Not character art (that comes
// only from the owner's sheets). Every one sits beside text that says the same thing.

import { companionStageSvg } from './companion-art'
import type { CompanionStage } from './companion-art'

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

const RUBRIC = '#C75730'
// A thin meter: the filled share of a track, rounded to a whole percent so a few cached
// strings cover every reading. The number beside it is what carries the meaning.
export function meterSvg(percent: number, width = 168): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  return once(`meter:${p}:${width}`, () => {
    const filled = Math.round((width * p) / 100)
    return (
      `<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 8" width="${width}" height="8">` +
      `<rect x="0" y="1" width="${width}" height="6" rx="3" fill="${RUBRIC}" fill-opacity="0.22"/>` +
      (filled > 0 ? `<rect x="0" y="1" width="${Math.max(filled, 6)}" height="6" rx="3" fill="${RUBRIC}"/>` : '') +
      '</svg>'
    )
  })
}

// The same companion stage, with the editor silhouette when he stands beside VS Code.
export function bookCompanionStageSvg(stage: CompanionStage, png: string, app: 'Claude' | 'VS Code'): string {
  const source = companionStageSvg(stage, png)
  if (app !== 'VS Code') return source
  const editor = '<g fill="none" stroke="#807B76" stroke-width=".8"><path d="M26.5 49v36M44.5 49v36"/>' + [53, 61, 69].map(y => `<rect x="20.4" y="${y}" width="4" height="4" rx=".6"/>`).join('') + '</g>'
  return source.replace('</svg>', `${editor}</svg>`)
}

// One usage window in the book's own frame, with fixed colours and no smoke.
export function bookIncenseSvg(percent: number): string {
  const used = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  return once(`incense:${used}`, () => {
    const ember = 21.4 - 18.8 * (1 - used / 100)
    const tip = used >= 85 ? '#C7361C' : '#E8643A'
    return '<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 26" width="12" height="26">' +
      '<path d="M6 21.4V2.6" stroke="#9A7458" stroke-width="2" stroke-linecap="round" opacity=".25"/>' +
      (used === 100
        ? '<path d="M6 21.4v-1" stroke="#9A7458" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>'
        : `<path d="M6 21.4V${ember}" stroke="#9A7458" stroke-width="2" stroke-linecap="round"/>` +
          `<circle cx="6" cy="${ember}" r="2.8" fill="${tip}" opacity=".24"/>` +
          `<circle cx="6" cy="${ember}" r="1.45" fill="${tip}"/>`) +
      '<rect x="1.5" y="21" width="9" height="3.6" rx="1.6" fill="#AA5E47"/>' +
      '</svg>'
  })
}
