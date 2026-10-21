// COST-CACHE 3.5 without the brazier (owner 10-09). Every Svg is a separate image document.
// Kept warm is the warm cup: two wisps. The words say «kept warm»; the picture does not change.
export type CupState = 'warm' | 'cooling' | 'cold' | 'kept'
export const CUP_COLORS = {
  line: ['#573A33', '#E68F6F', '#3A1F18', '#F4A988'],
  glaze: ['#FAEEE9', '#FAEEE9', '#FFFFFF', '#FAEEE9'],
  clay: ['#AA5E47', '#AA5E47', '#8A4A36', '#AA5E47'],
  tea: ['#6E3524', '#6E3524', '#4A1E12', '#6E3524'],
  steam: ['#846D57', '#C0A98E', '#4A3A2E', '#E1CFB8'],
} as const
const BODY = 'M3 10.8L4.2 19.3Q4.35 20.2 5.3 20.2H10.7Q11.65 20.2 11.8 19.3L13 10.8Z'
const DIP = 'M2 15.5q1.5.75 3 0t3 0 3 0 3 0V22H2Z'
const rules = (i: 0 | 1 | 2 | 3) => `.l{stroke:${CUP_COLORS.line[i]}}.g{fill:${CUP_COLORS.glaze[i]}}.c{fill:${CUP_COLORS.clay[i]}}.t{fill:${CUP_COLORS.tea[i]}}.s{stroke:${CUP_COLORS.steam[i]}}`
function style(): string {
  return rules(0) + '@media(prefers-color-scheme:dark){' + rules(1) + '}' +
    '@media(prefers-contrast:more),(forced-colors:active){' + rules(2) + '}' +
    '@media(prefers-contrast:more) and (prefers-color-scheme:dark),(forced-colors:active) and (prefers-color-scheme:dark){' + rules(3) + '}'
}
const cups = new Map<string, string>()
export function cupSvg(state: CupState, width = 16, height = 22): string {
  const key = `${state}:${width}:${height}`
  const cached = cups.get(key)
  if (cached) return cached
  const dash = state === 'cold' ? ' stroke-dasharray="1.2 1"' : ''
  const tea = state === 'cold' ? '' : '<ellipse class="t" cx="8" cy="10.95" rx="4.5" ry=".8"/>'
  const wisp = (x: number) => `<path class="s" fill="none" stroke-width="1.3" stroke-linecap="round" d="M${x} 9.4c-1.15-1.35 1.15-2.15 0-3.5s1.15-2.15 0-3.5"/>`
  const steam = state === 'cold' ? '' : state === 'cooling' ? wisp(8) : wisp(6.3) + wisp(9.7)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 22" width="${width}" height="${height}" style="forced-color-adjust:none"><style>${style()}</style><clipPath id="b"><path d="${BODY}"/></clipPath><path class="g" d="${BODY}"/><path class="c" clip-path="url(#b)" d="${DIP}"/><path class="l" fill="none" stroke-width="1" stroke-linejoin="round"${dash} d="${BODY}"/><rect class="c l" x="5.6" y="20.2" width="4.8" height=".9" rx=".3" stroke-width=".8"${dash}/>${tea}${steam}</svg>`
  if (cups.size >= 16) cups.delete(cups.keys().next().value!)
  cups.set(key, svg)
  return svg
}
