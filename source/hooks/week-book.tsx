// The week at the top of his Reading log: this issue's cover, the numbers and the save button; and the zine's every issue,
// each opening to its cover and that week's numbers (owner 10-17). The bookmarks and the stamps are gone (DECISIONS 1035, 1036).
// Pure: pages.tsx gathers the inputs and handles the presses. Without the words nothing draws.
import type { Elements, RenderElement } from 'claude-code'
import { issueRows, viewTotals, weekRange, weekView, addDays } from './week-days'
import type { WeekRecord } from './week-days'
import { cardSaveWords } from './card-runtime'
import type { CardSaveResult } from './card-runtime'
import { numberText } from './numbers'

export type WeekWord = (key: string, vars?: Record<string, string | number>, n?: number) => string
export type WeekBookData = {
  title: string
  shown?: 'this' | 'last' | 'back'
  n?: number // the shown issue
  cover?: { source: string; alt: string; width: number; height: number }
  issues?: IssueLine[]
  lastLink?: string
  facts?: string
  saved?: string
  button?: { key: string; label: string }
}
// A row of 'every issue': its number, its week and numbers, and a button that opens it (none on the one shown).
export type IssueLine = { n: number; label: string; lines: string[]; open?: { key: string; label: string } }
export type WeekBookInput = {
  held: WeekRecord
  now: number
  zone: string | undefined
  lang: string
  surface: 'desktop' | 'terminal' | 'vscode' | 'mobile'
  word: WeekWord
  want?: boolean | number // last week, this week, or an issue's number
  zine?: { issue: string; open: string } // the zine page's row words (bag words zineRows)
  cover?: (n: number) => string | undefined // an issue's cover, JPEG in base64
  canSave: boolean
  save?: CardSaveResult | 'saving'
  home?: string
  localDay: (at: number, zone: string | undefined) => string
}

export function weekBookData(i: WeekBookInput): WeekBookData | undefined {
  const w = i.word
  if (!w('week.title')) return undefined
  const today = i.localDay(i.now, i.zone), view = weekView(i.held, today, i.lang, i.want)
  if (!view) return undefined
  const { pages, green } = viewTotals(view), n = (v: number): string => numberText(v, i.lang)
  const issue = (v: number): string => i.zine ? i.zine.issue.replace('{n}', n(v)) : ''
  const title = view.shown === 'this' ? w('week.title') : view.shown === 'last' ? w('week.lastTitle') || w('week.title') : issue(view.n!) || w('week.title')
  const data: WeekBookData = {
    title, shown: view.shown, ...(view.n ? { n: view.n } : {}),
    ...(view.other && w('week.lastLink') ? { lastLink: w('week.lastLink') } : {}),
    facts: w('week.facts', { pages: n(pages), green: n(green) }, pages),
  }
  const art = view.n && i.surface !== 'terminal' ? i.cover?.(view.n) : undefined
  if (art) data.cover = { ...zineCoverSvg(art, i.surface === 'mobile' ? 88 : 104), alt: issue(view.n!) || title }
  const rows = i.zine ? issueRows(i.held, today, i.lang) : [], join = w('card.week.rangeJoin')
  if (rows.length) data.issues = rows.map(row => ({
    n: row.n, label: issue(row.n),
    lines: [...(row.start && join ? [weekRange(row.start, addDays(row.start, 6), i.lang, join)] : []), ...(row.pages !== undefined ? [w('week.facts', { pages: n(row.pages), green: n(row.green ?? 0) }, row.pages)] : [])],
    ...(row.n === view.n ? {} : { open: { key: `coco:zine:issue:${row.n}`, label: i.zine!.open } }),
  }))
  if (i.canSave && w('week.save')) {
    const done = typeof i.save === 'object' && i.save.kind !== 'failed'
    // The writer's saved notes carry no path slot; the path follows the note.
    const withPath = (text: string): string => text.includes('{path}') ? text : `${text} {path}`
    if (typeof i.save === 'object') data.saved = cardSaveWords(i.save, { saved: withPath(w('week.saved')), savedSvg: withPath(w('week.savedSvg')), failed: w('week.failed') }, i.home ?? '')
    data.button = i.save === 'saving' ? { key: 'coco:week:saving', label: w('week.saving') }
      : done ? { key: 'coco:week:show', label: w('week.show') } : { key: 'coco:week:save', label: w('week.save') }
  }
  return data
}

// An issue's cover as a print: the whole painting in a thin paper edge, two thirds as wide as it is tall.
export function zineCoverSvg(art: string, width: number): { source: string; width: number; height: number } {
  const height = Math.round(width * 1.5)
  return { width, height, source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 480" width="${width}" height="${height}"><image width="320" height="480" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,${art}"/><rect x="1.5" y="1.5" width="317" height="477" fill="none" stroke="#E4C7BC" stroke-width="3"/></svg>` }
}

type Ui = Elements['desktop'] | Elements['vscode'] | Elements['mobile'] | Elements['terminal']
export function weekSection(ui: Ui, d: WeekBookData, o: { terminal: boolean }): RenderElement {
  const { Box, Text, Button } = ui as Elements['desktop']
  const { Svg } = ui as Elements['desktop']
  const noop = (): void => {}
  const head = <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={1}>
    <Text bold wrap="wrap">{d.title}</Text>
    {d.lastLink ? <Button key="coco:week:previous" label={d.lastLink} plain onPress={noop} /> : null}
  </Box>
  const facts = d.facts ? <Text wrap="wrap">{d.facts}</Text> : null
  // With a cover, the title and the numbers stand beside it; the button goes under both.
  const cover = d.cover && !o.terminal ? d.cover : undefined
  return <Box flexDirection="column" rowGap={1}>
    {cover
      ? <Box flexDirection="row" columnGap={2} alignItems="flex-start">
        <Box flexShrink={0}><Svg source={cover.source} alt={cover.alt} width={cover.width} height={cover.height} /></Box>
        <Box flexDirection="column" rowGap={1} flexGrow={1} flexShrink={1} minWidth={0}>{head}{facts}</Box>
      </Box>
      : head}
    {cover ? null : facts}
    {d.saved ? <Text wrap="wrap">{d.saved}</Text> : null}
    {d.button ? <Button key={d.button.key} label={d.button.label} onPress={noop} /> : null}
  </Box>
}

// A row of 'every issue': the number in bold, its week and numbers dim under it, and the button that opens it; on the
// desktop the button keeps to the right edge, in a terminal it follows the row's words.
export function issueLine(ui: Ui, line: IssueLine, terminal: boolean): RenderElement {
  const { Box, Text, Button } = ui as Elements['desktop']
  const noop = (): void => {}
  return <Box flexDirection="row" flexGrow={1} justifyContent={terminal ? 'flex-start' : 'space-between'} alignItems={terminal ? 'flex-start' : 'center'} columnGap={2} flexWrap="wrap">
    <Box flexDirection="column" flexGrow={terminal ? 0 : 1} flexShrink={1} minWidth={0}><Text bold wrap="wrap">{line.label}</Text>{line.lines.map(text => <Text color="inactive" wrap="wrap">{text}</Text>)}</Box>
    {line.open ? <Button key={line.open.key} label={line.open.label} onPress={noop} /> : null}
  </Box>
}
