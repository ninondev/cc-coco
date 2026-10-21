// How the notices sit in the transcript's rows: his spark beside a comment he liked. Pure drawing;
// what to draw and when comes from notice.ts.
import type { ElementTable, RenderElement } from 'claude-code'
import { contrastSvg } from './high-contrast'
import { slipIconSvg } from './notice-art'

const ARMS = [[6, 5.5], [6, 14.5], [1.5, 10], [10.5, 10], [2.82, 6.82], [9.18, 13.18], [9.18, 6.82], [2.82, 13.18]] as const
const TO = 'M6 10L'

// His eight-armed spark, 12 x 20, in the colour it has always had. The drawing source grows all eight
// arms out of the centre together in 190 ms, so no frame shows a plus or a cross alone; every later
// draw gets the still one. High contrast and reduced motion are answered inside the picture.
export function sparkSvg(drawing: boolean): string {
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 20" width="12" height="20">'
  const style = drawing
    ? '<style>path{stroke-dasharray:1;stroke-dashoffset:1;animation:g .19s cubic-bezier(0,0,.2,1) forwards}@keyframes g{to{stroke-dashoffset:0}}@media(prefers-reduced-motion:reduce){path{animation:none;stroke-dashoffset:0}}</style>'
    : ''
  const paths = ARMS.map(([x, y]) => `<path d="${TO}${x} ${y}" pathLength="1"/>`).join('')
  const group = `<g fill="none" stroke="#CC6440" stroke-width="1.5" stroke-linecap="round">${paths}</g>`
  return contrastSvg(`${head}${group}${style}</svg>`, 'path{stroke:#9E4123;stroke-width:1.7}', 'path{stroke:#F4A988;stroke-width:1.7}')
}

// His own accent for the terminal mark, never the theme's `claude` colour that the engine's ✻ line uses.
// The ANSI and custom themes keep the host's palette: no colour of ours, the mark in bold.
export function accentOf(theme: string | undefined): string | undefined {
  return theme === 'light' || theme === 'light-daltonized' ? '#9E4123' : theme === 'dark' || theme === 'dark-daltonized' ? '#F4A988' : undefined
}

export type SparkLook = {
  ui: ElementTable
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  id: string
  file: string
  line: number
  quote?: string
  head?: string
  alt?: string
  columns: number
  theme?: string
  drawing: boolean
  below: boolean
  reader: boolean
}

const PAPER = '#FAEEE9', TEXT = '#231B19', HEAD = '#9E4123'

// The slip: his paper, dark text and an orange-red head. Revealed by the mark's own keyed Box on a pointer.
function slip(look: SparkLook): RenderElement | undefined {
  const { Box, Text } = look.ui
  if (!look.head) return undefined
  const room = look.surface === 'desktop' ? 50 : Math.min(50, Math.max(16, look.columns - 3))
  const place = look.surface === 'desktop' ? { left: 0 } : { right: 0 }
  return (
    <Box position="absolute" top={look.below ? 2 : -4} {...place} width={room} display="none" hover={{ display: 'flex' }} flexDirection="column" backgroundColor={PAPER} paddingX={1}>
      <Text bold color={HEAD} wrap="truncate-end">{look.head}</Text>
      <Text color={TEXT} wrap="truncate-end">{`${look.file}:${look.line}`}</Text>
      {look.quote ? <Text color={TEXT} wrap="wrap">{`“${look.quote}”`}</Text> : undefined}
    </Box>
  )
}

// Desktop app, VS Code and the phone: the mark in the row's margin (left on the desktop, right elsewhere).
export function sparkMark(look: SparkLook): RenderElement {
  const { Box } = look.ui, Svg = 'Svg' in look.ui ? look.ui.Svg : undefined
  const place = look.surface === 'desktop' ? { left: -2 } : { right: 0 }
  if (!Svg) return <Box />
  return (
    <Box key={`coco:spark:${look.id}`} position="absolute" {...place} top={0}>
      <Svg source={sparkSvg(look.drawing)} alt={look.alt ?? ''} width={12} height={20} />
      {look.surface === 'mobile' ? undefined : slip(look)}
    </Box>
  )
}

// Terminal: ✲ file:line at the row's right margin, the glyph alone under 40 columns; in screen-reader
// mode no glyph at all, the words on a row of their own.
export function sparkTerminal(look: SparkLook): { mark?: RenderElement; reader?: RenderElement; pad: number } {
  const { Box, Text } = look.ui
  if (look.reader) return { reader: look.alt ? <Text wrap="wrap">{look.alt}</Text> : undefined, pad: 0 }
  const label = look.columns < 40 ? '✲' : `✲ ${look.file}:${look.line}`
  const accent = accentOf(look.theme)
  const mark = (
    <Box position="absolute" right={0} top={0}>
      <Text bold={accent === undefined} {...(accent ? { color: accent } : {})}>{label}</Text>
    </Box>
  )
  return { mark, pad: [...label].length + 1 }
}

// Columns a string takes in a terminal: wide characters count two.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u
export const cells = (text: string): number => [...text].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0)

export type NoteLook = {
  ui: ElementTable
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  columns: number
  cue: string
  name: string
  full: string // the quality and the words he liked, as his praise line has them
  short: string // the quality alone
  alt: string
  reader: boolean
}

// The margin note under a commit he marked: his name in the cue colour, then in `inactive` the one quality
// and the words he liked. Indented 5 on the terminal, 2 under 30 columns; where the quote does not fit it is
// dropped whole, his name and the quality stay. Screen reader: the words alone.
export function commitNote(look: NoteLook): RenderElement {
  const { Box, Text } = look.ui
  const pad = look.surface === 'terminal' ? (look.columns < 30 ? 2 : 5) : 0
  if (look.reader) return <Box paddingLeft={pad}><Text wrap="wrap">{look.alt}</Text></Box>
  const room = look.columns - pad
  const line = look.surface === 'terminal' && cells(look.name) + 2 + cells(look.full) > room ? look.short : look.full
  return (
    <Box key="coco:commit" paddingLeft={pad}>
      <Text wrap="wrap"><Text color={look.cue} bold>{look.name}</Text><Text color="inactive">{`  ${line}`}</Text></Text>
    </Box>
  )
}

export type StuckLook = {
  ui: ElementTable
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  cue: string
  name: string
  text: string
  cause: string
  button: string
  reader: boolean
}

// The stuck note where the band does not carry it: under the tool call that tipped it, the slip, his name,
// the words and the button; on a terminal there is no glyph, the row is indented 2 and wraps. The button
// stops notes of this kind (`coco:stuck:off:<cause>`).
export function stuckNote(look: StuckLook): RenderElement {
  const { Box, Text, Button } = look.ui, Svg = 'Svg' in look.ui ? look.ui.Svg : undefined
  const words = <Text wrap="wrap"><Text color={look.cue} bold>{look.name}</Text>{` ${look.text}`}</Text>
  const button = <Button key={`coco:stuck:off:${look.cause}`} label={look.button} onPress={() => {}} />
  if (look.surface === 'terminal') {
    return <Box key={`coco:stuck:${look.cause}`} flexDirection="column" paddingLeft={2}>{words}<Box>{button}</Box></Box>
  }
  return (
    <Box key={`coco:stuck:${look.cause}`} flexDirection="row" alignItems="flex-start" columnGap={1}>
      {Svg && !look.reader ? <Svg source={slipIconSvg()} alt="" width={10} height={16} /> : undefined}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>{words}</Box>
      <Box flexShrink={0}>{button}</Box>
    </Box>
  )
}
