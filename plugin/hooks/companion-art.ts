// His blocking, drawn from the plugin's own PNGs. Pure builders: no filesystem, clock or theme.
export type CompanionStage = 'absent' | 'stopped' | 'hidden' | 'corner' | 'following'
export type CompanionSize = 'tiny' | 'small' | 'medium' | 'large'
export const COMPANION_SIZES: readonly CompanionSize[] = ['tiny', 'small', 'medium', 'large']
export const STAGE_PNG: Partial<Record<CompanionStage, string>> = {
  following: 'assets/pixel/07-happy.png', corner: 'assets/pixel/08-waiting.png',
  stopped: 'assets/pixel/12-sleep.png', hidden: 'assets/pixel/01-idle-reading.png',
}
export function companionStageSvg(state: CompanionStage, png = ''): string {
  const n = '#807B76', v = '#CC6440'
  const head = (x: number, y: number, clip = false) => `<image href="data:image/png;base64,${png}" x="${x}" y="${y}" width="35" height="32"${clip ? ' clip-path="url(#above)"' : ''} style="image-rendering:pixelated" image-rendering="pixelated"/>`
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 96" width="188" height="96">${body}</svg>`
}
export function companionSizeSvg(size: CompanionSize, png: string): { source: string; width: number; height: number } {
  const pixel = size === 'tiny' || size === 'small'
  const height = { tiny: 24, small: 32, medium: 48, large: 64 }[size]
  const w = pixel ? 35 : 137, h = pixel ? 32 : 128
  const width = Math.round(height * w / h)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${width}" height="${height}"><image href="data:image/png;base64,${png}" width="${w}" height="${h}"${pixel ? ' style="image-rendering:pixelated" image-rendering="pixelated"' : ''}/></svg>`
  return { source, width, height }
}
