const light = ['#F0EEE6', '#FFFFFF', '#FFFAEF']
const dark = ['#2B2A27', '#000000', '#202020', '#2D3236']
function lum(color: string): number {
  const values = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05)
export function assertCupLegible(svg: string): void {
  if (!svg.includes('style="forced-color-adjust:none"')) throw Error('Cup permits system recoloring')
  const css = /<style>(.*?)<\/style>/.exec(svg)?.[1] ?? ''
  if (!css.includes('@media(prefers-contrast:more),(forced-colors:active)') || !css.includes('@media(prefers-contrast:more) and (prefers-color-scheme:dark),(forced-colors:active) and (prefers-color-scheme:dark)')) throw Error('Cup lacks both contrast rules')
  const classes = { l: 'stroke', s: 'stroke' }
  for (const [name, property] of Object.entries(classes)) {
    const matches = [...css.matchAll(new RegExp('\\.' + name + '\\{' + property + ':(#[0-9A-Fa-f]{6})\\}', 'g'))]
    if (matches.length !== 4) throw Error('Cup lacks four palettes for ' + name)
    for (let i = 0; i < 4; i++) for (const ground of i % 2 ? dark : light) if (ratio(matches[i]![1]!, ground) < 3) throw Error('Cup mark below 3:1: ' + name + '/' + i + '/' + ground)
  }
  const clay = [...css.matchAll(/\.c\{fill:(#[0-9A-Fa-f]{6})\}/g)]
  const tea = [...css.matchAll(/\.t\{fill:(#[0-9A-Fa-f]{6})\}/g)]
  const glaze = [...css.matchAll(/\.g\{fill:(#[0-9A-Fa-f]{6})\}/g)]
  if (clay.length !== 4 || tea.length !== 4 || glaze.length !== 4) throw Error('Cup lacks internal palettes')
  for (let i = 0; i < 4; i++) for (const fill of [clay[i]![1]!, tea[i]![1]!]) if (ratio(fill, glaze[i]![1]!) < 3) throw Error('Cup internal mark below 3:1')
}
