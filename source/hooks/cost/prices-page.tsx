/** @jsxRuntime classic */
/** @jsx h */
// Pure rendering of the accepted Prices layout; fetching is exclusively a press action.
import type { Elements, RenderElement } from 'claude-code'
import { arrangeRows } from './units.js'
import type { PriceRow } from './prices/page'
import type { OtherMaker } from './prices/others'
import type { PricesViewState } from './prices/runtime'

export interface PricesPageOptions {
  lang: string
  word: (lang: string, key: string, values?: Record<string, string | number>) => string
  surface: 'desktop' | 'terminal' | 'vscode' | 'mobile'
  columns: number
  onBack: () => void
  onOlder: () => void
  onOthers: () => void
}
type PriceUI = Elements['desktop'] | Elements['terminal'] | Elements['vscode'] | Elements['mobile']
export function pricesPage(ui: PriceUI, state: PricesViewState, o: PricesPageOptions): RenderElement {
  const { Box, Text, Button } = ui
  const word = (key: string, values?: Record<string, string | number>) => o.word(o.lang, key, values)
  const locale = o.lang === 'zh' ? 'zh-CN' : o.lang === 'zh-Hant' ? 'zh-TW' : o.lang
  const dollars = (n: number | null) => n === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 4, minimumFractionDigits: 0 }).format(n)
  const date = (at: number, dayOnly = false) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...(dayOnly ? { timeZone: 'UTC' } : {}) }).format(new Date(at))
  const time = (at: number) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
  const source = state.table.from === 'fetched' && state.table.at !== null
    ? word('prices.source.fetched', { time: time(state.table.at) })
    : word('prices.source.shipped', { date: state.shippedAsOf ? date(Date.parse(state.shippedAsOf), true) : '—' })
  const narrow = o.surface === 'vscode' || o.surface === 'mobile' || o.columns < 76
  const arranged = arrangeRows(state.table.rows, { chatModel: state.chatModel, usedRecently: state.usedRecently })
  const rows = [...arranged.main, ...(state.olderOpen ? arranged.older.map(row => ({ ...row, thisChat: false })) : [])]
  const heading = (key: string) => <Text bold wrap="wrap">{word(key)}</Text>
  const cell = (content: string, width: number, bold = false) => <Box width={width} flexShrink={1} minWidth={0}><Text bold={bold} wrap="wrap">{content}</Text></Box>
  const modelName = (row: PriceRow & { thisChat: boolean }) => row.thisChat ? `${row.name} (${word('prices.thisChat')})` : row.name
  // A model priced in two tiers by prompt length (Haiku 5.5) gets a second line with its own label and prices.
  const tierWord = word('prices.tier.haiku')
  const stacked = (price: Pick<PriceRow, 'input' | 'output' | 'read' | 'write5m' | 'write1h'>) => [
    <Text wrap="wrap">{word('prices.narrow.inout', { in: dollars(price.input), out: dollars(price.output) })}</Text>,
    <Text wrap="wrap">{word('prices.narrow.cache', { r: dollars(price.read), w5: dollars(price.write5m), w1: dollars(price.write1h) })}</Text>,
  ]
  const claudeRows = () => narrow ? rows.map(row => <Box flexDirection="column" rowGap={0}>
    <Text bold wrap="wrap">{modelName(row)}</Text>
    {stacked(row)}
    {row.over && tierWord ? <Text wrap="wrap">{tierWord}</Text> : null}
    {row.over ? stacked(row.over) : null}
  </Box>) : <Box flexDirection="column" rowGap={1}>
    <Box flexDirection="row" columnGap={1}>
      {cell(word('prices.col.model'), 25, true)}{cell(word('prices.col.input'), 8, true)}{cell(word('prices.col.read'), 10, true)}
      <Box width={19} flexShrink={1}><Text bold wrap="wrap">{word('prices.col.write')}</Text><Text wrap="wrap">{`${word('prices.col.write5m')}, ${word('prices.col.write1h')}`}</Text></Box>
      {cell(word('prices.col.output'), 8, true)}
    </Box>
    {rows.flatMap(row => [
      <Box flexDirection="row" columnGap={1}>
        {cell(modelName(row), 25, row.thisChat)}{cell(dollars(row.input), 8)}{cell(dollars(row.read), 10)}
        {cell(`${dollars(row.write5m)}, ${dollars(row.write1h)}`, 19)}{cell(dollars(row.output), 8)}
      </Box>,
      ...(row.over ? [<Box flexDirection="row" columnGap={1}>
        {cell(tierWord, 25)}{cell(dollars(row.over.input), 8)}{cell(dollars(row.over.read), 10)}
        {cell(`${dollars(row.over.write5m)}, ${dollars(row.over.write1h)}`, 19)}{cell(dollars(row.over.output), 8)}
      </Box>] : []),
    ])}
  </Box>
  const makerRows = (maker: OtherMaker) => <Box flexDirection="column" rowGap={1}>
    <Text bold wrap="wrap">{maker.label}</Text>
    {!narrow ? <Box flexDirection="row" columnGap={1}>{cell(word('prices.col.model'), 25, true)}{cell(word('prices.col.input'), 8, true)}{cell(word('prices.col.read'), 10, true)}{cell(word('prices.col.output'), 8, true)}</Box> : null}
    {maker.models.map(row => narrow ? <Box flexDirection="column">
      <Text bold wrap="wrap">{row.name}</Text>
      <Text wrap="wrap">{word('prices.narrow.inout', { in: dollars(row.input), out: dollars(row.output) })}</Text>
      <Text wrap="wrap">{`${word('prices.col.read')}: ${dollars(row.read)}`}</Text>
    </Box> : <Box flexDirection="row" columnGap={1}>{cell(row.name, 25)}{cell(dollars(row.input), 8)}{cell(dollars(row.read), 10)}{cell(dollars(row.output), 8)}</Box>)}
  </Box>
  return <Box flexDirection="column" rowGap={1}>
    <Button key="coco:prices:back" label={word('prices.back')} onPress={o.onBack} />
    {heading('prices.title')}
    <Text wrap="wrap">{source}</Text>
    {state.checking ? <Text wrap="wrap">{word('prices.checking')}</Text> : state.why ? <Text wrap="wrap">{word(`prices.why.${state.why}`)}</Text> : null}
    <Text wrap="wrap">{word('prices.unit')}</Text>
    {claudeRows()}
    {arranged.older.length ? <Button key="coco:prices:older" label={word('prices.older', { n: arranged.older.length })} onPress={o.onOlder} /> : null}
    {state.changes.map(change => <Text wrap="wrap">{word('prices.changed', {
      model: change.name, what: word(`prices.col.${change.field}`), old: dollars(change.old), new: dollars(change.new), date: date(change.since),
    })}</Text>)}
    <Text wrap="wrap">{word('prices.about')}</Text>
    <Button key="coco:prices:others" label={word('prices.others')} onPress={o.onOthers} />
    {state.othersOpen ? <Box flexDirection="column" rowGap={1}>
      {state.checkingOthers ? <Text wrap="wrap">{word('prices.checking')}</Text> : null}
      {state.others ? <Text wrap="wrap">{state.others.from === 'fetched' && state.others.at !== null
        ? word('prices.others.source', { time: date(state.others.at) })
        : word('prices.source.shipped', { date: state.shippedAsOf ? date(Date.parse(state.shippedAsOf), true) : '—' })}</Text> : null}
      {state.others?.why ? <Text wrap="wrap">{word(`prices.why.${state.others.why}`)}</Text> : null}
      {state.others?.makers.map(makerRows)}
    </Box> : null}
  </Box>
}
