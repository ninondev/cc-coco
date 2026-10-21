// The weekly card: 1080 x 1350, cream paper, a red frame and header, the week's numbers and the issue's cover taped on
// under them. It holds counts only, never a time of day. The bookmarks and the stamps are gone (DECISIONS 1036).
import { CARD_FONTS, cardCrest, cardName, cardWrap } from './card-runtime'
import { cardScript } from './card-metrics-lazy'

export type WeekCardInput = {
  lang: string
  theme: 'light' | 'dark'
  title: string
  facts: string
  range: string
  unofficial: string
  saved?: string
  illustration?: string // PNG in base64
  cover?: string // the issue's cover, JPEG in base64 (owner 10-17); wins over the illustration
}
export const WEEK_CARD = { width: 1080, height: 1350 } as const
const PAPER = { light: { bg: '#FAEEE9', ink: '#231B19', rank: '#9E4123', soft: '#6E4A3E' }, dark: { bg: '#211B19', ink: '#F3E8DE', rank: '#F2A47F', soft: '#C9AFA2' } }
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function weekCardSvg(input: WeekCardInput): string {
  const t = PAPER[input.theme], script = cardScript(input.lang), family = CARD_FONTS[script], latin = CARD_FONTS.latin, name = cardName(input.lang)
  const text = (x: number, y: number, size: number, fill: string, value: string, extra = ''): string =>
    `<text x="${x}" y="${y}" font-family="${esc(family)}" font-size="${size}" ${extra}fill="${fill}">${esc(value)}</text>`
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WEEK_CARD.width}" height="${WEEK_CARD.height}" viewBox="0 0 ${WEEK_CARD.width} ${WEEK_CARD.height}">`,
    `<rect width="1080" height="1350" fill="${t.bg}"/>`,
    '<rect x="40" y="40" width="1000" height="1270" fill="none" stroke="#C75730" stroke-width="4"/>',
    '<rect x="52" y="52" width="976" height="1246" fill="none" stroke="#C75730" stroke-width="1.5"/>',
    '<rect x="52" y="52" width="976" height="88" fill="#C75730"/>',
    cardCrest(118, 96, 17, '#FAEEE9', 4.2),
    `<text x="150" y="107" font-family="${esc(name.latin ? latin : family)}" font-size="31" font-weight="700" letter-spacing="1" fill="#FAEEE9">${esc(name.text)}</text>`,
    `<text x="976" y="107" text-anchor="end" font-family="${esc(family)}" font-size="29" fill="#FAEEE9">${esc(input.range)}</text>`,
    text(104, 236, 58, t.rank, input.title, 'font-weight="700" '),
    '<path d="M104 268h88" stroke="#C75730" stroke-width="3" stroke-linecap="round"/>']
  const lines = cardWrap(input.facts, script, 33, 860).slice(0, 2)
  lines.forEach((line, i) => parts.push(text(104, 322 + i * 46, 33, t.ink, line)))
  let fy = 322 + 46 * lines.length
  if (input.saved) {
    parts.push(text(104, fy, 27, t.soft, cardWrap(input.saved, script, 27, 860)[0] ?? ''))
    fy += 40
  }
  parts.push(text(104, 1232, 26, t.soft, input.unofficial),
    `<text x="104" y="1268" font-family="${esc(latin)}" font-size="26" letter-spacing=".3" fill="${t.soft}">github.com/ninondev/cc-coco</text>`)
  // The issue's cover (or their night-window painting) as a snapshot taped to the page under the numbers, across the
  // middle; a cover shows its lower part, the sky at its top being left for a title.
  const [px, py, pw, ph, turn] = [290, Math.round(fy + 50), 480, 600, -2]
  const cx = px + 10 + pw / 2, cy = py + 10 + ph / 2
  const photo = input.cover ? `<image x="${px + 10}" y="${py + 10}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMax slice" href="data:image/jpeg;base64,${input.cover}"/>`
    : input.illustration ? `<image x="${px + 10}" y="${py + 10}" width="${pw}" height="${ph}" href="data:image/png;base64,${input.illustration}"/>` : ''
  if (photo) parts.push(`<g transform="rotate(${turn} ${cx} ${cy})"><rect x="${px + 4}" y="${py + 6}" width="${pw + 20}" height="${ph + 20}" rx="4" fill="#3A1E14" opacity=".14"/>`,
    `<rect x="${px}" y="${py}" width="${pw + 20}" height="${ph + 20}" rx="4" fill="#FFFBF6" stroke="#E4C7BC" stroke-width="1.5"/>`,
    photo,
    `<rect x="${cx - 44}" y="${py - 14}" width="88" height="28" fill="#C75730" opacity=".6" transform="rotate(-6 ${cx} ${py})"/></g>`)
  parts.push('</svg>')
  return parts.join('')
}
