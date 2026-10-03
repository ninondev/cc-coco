// His book, drawn: each page is a list of blocks built from data the plugin already holds, then
// laid out for the desktop (pictures as SVG) or the terminal (pictures as cells and text).
// Pure: no `$`. Text uses theme keys or none, so it follows the app's light or dark theme; the
// only raw colours sit inside pictures. Nothing is faint, so everything keeps the theme's full
// contrast, and nothing is told by colour alone. Italics mark his stage directions and short
// notes; help and notes longer than one line stand upright, which reads faster. Scripts without
// italics (Chinese, Japanese, Korean, Devanagari) stay upright throughout: a slanted glyph there
// is a distortion, not a style.

import type { Elements, RenderElement, SessionUsage } from 'claude-code'
import type { FrameName } from './art'
import { meterSvg, slipLargeSvg } from './book-art'
import { companionSection } from './companion-book'
import { iconSection } from './icon-book'
import type { IconBookData, IconAction } from './icon-book'
import type { CompanionBookData, CompanionAction } from './companion-book'
import { PAGES, fill } from './book-words'
import type { BookWords, Page } from './book-words'
import { cells } from './band'
import type { Marks } from './latest'
import { desktopWidth, offeringSvg, spriteCells, TERMINAL_COLUMNS, TERMINAL_ROWS } from './pictures'
import { LANGS, WORDS } from './words'
import type { ClaudesamaBook, ClaudesamaView } from '../types'

export const PORTRAIT: Record<Page, FrameName> = {
  him: 'wave',
  omen: 'happy',
  offerings: 'work-b',
  log: 'idle-reading',
  library: 'snake',
  settings: 'think-a',
}

// Where a slanted glyph is a distortion: these languages' secondary text stays upright, and
// their stage directions keep their parentheses to say what they are.
export const NO_ITALIC: ReadonlySet<string> = new Set(['zh', 'ja', 'ko', 'hi'])

type Own = (typeof WORDS)['en']

// What a page needs besides the book's words: the band's latest view, the engine's latest usage
// figures, the store values the page shows, the time, a few settings, and the band's own small
// words in this language (his name, the about lines, the pictures' alt text).
export type BookData = {
  view: ClaudesamaView | undefined
  usage: SessionUsage | undefined
  store: Record<string, unknown>
  now: number
  timeZone: string | undefined
  reducedMotion: boolean
  marks: Marks
  voiceSizes: { light: number; full: number }
  fortune: { line: string; rank: string; day: string } | undefined
  reading: number
  own: Own
  icon?: IconBookData
  companion?: CompanionBookData
}

export type Press = {
  go: (page: Page) => void
  turn: (delta: number) => void
  marks: (marks: Marks) => void
  icon?: (action: IconAction) => Promise<void>
  companion?: (action: CompanionAction) => Promise<void>
}

type Option = { value: string; label: string; key: string }
type Block =
  | { t: 'heading'; text: string }
  | { t: 'para'; text: string }
  | { t: 'note'; text: string }
  | { t: 'fact'; label: string; text: string }
  | { t: 'meter'; percent: number; alt: string }
  | { t: 'box'; percent: number | null; title: string; detail: string | null; alt: string }
  | { t: 'slip'; rank: string; text: string; date: string; alt: string }
  | { t: 'choice'; label: string; now: string; current: string; options: readonly Option[]; help: string; local?: true }
  | { t: 'button'; key: string; label: string; primary?: true }
  | { t: 'nav'; previous: string; next: string; where: string }
  | { t: 'icon'; data: IconBookData }
  | { t: 'companion'; data: CompanionBookData }

// ---------------------------------------------------------------- formatting

function locale(lang: string): string {
  return lang === 'zh' ? 'zh-SG' : lang
}

function number(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(n)
  } catch {
    return String(n)
  }
}

function time(ms: number, lang: string, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(11, 16)
  }
}

function date(ms: number, lang: string, timeZone: string | undefined, withYear = false): string {
  try {
    return new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

function yearOf(ms: number, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 4)
  }
}

// Today, in the person's time zone: the time alone. Any other day, past or future: its date and
// time, with the year when it is not this one. Absolute, so it never goes stale.
export function moment(iso: string, now: number, lang: string, timeZone: string | undefined): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  if (date(ms, lang, timeZone, true) === date(now, lang, timeZone, true)) return time(ms, lang, timeZone)
  return `${date(ms, lang, timeZone, yearOf(ms, timeZone) !== yearOf(now, timeZone))}${lang === 'zh' || lang === 'ja' ? '' : ' '}${time(ms, lang, timeZone)}`
}

// Whether a line of text fits the body's width on one line, as cells count it (generous on the
// desktop, whose proportional type fits a little more).
function oneLine(text: string, columns: number): boolean {
  return cells(text) <= (columns > 0 ? columns : 60)
}

function usd(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(locale(lang), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

// A fortune opens with its rank: "great blessing." / "大吉。" / "अति शुभ।".
export function rankOf(line: string): string {
  return line.split(/[。.।]/, 1)[0]?.trim() ?? ''
}

// ---------------------------------------------------------------- pages

export function pageBlocks(page: Page, w: BookWords, d: BookData, surface: 'desktop' | 'terminal' = 'desktop'): Block[] {
  const lang = d.view?.lang ?? 'en'
  if (page === 'him') {
    return [
      ...d.own.about.map((text): Block => ({ t: 'para', text })),
      ...w.profile.map((f): Block => ({ t: 'fact', label: f.label, text: f.text })),
    ]
  }

  if (page === 'omen') {
    if (!d.fortune) return [{ t: 'para', text: w.omen.notYet }, { t: 'button', key: 'claudesama:omen:draw', label: w.omen.draw, primary: true }, { t: 'note', text: w.omen.oneADay }]
    const rank = rankOf(d.fortune.line)
    return [
      {
        t: 'slip',
        rank,
        text: d.fortune.line,
        date: fill(w.omen.drawnOn, { date: date(Date.parse(`${d.fortune.day}T12:00:00Z`), lang, 'UTC') }),
        alt: rank ? fill(d.own.alt.slip, { rank }) : d.own.alt.slipBlank,
      },
      { t: 'note', text: w.omen.oneADay },
    ]
  }

  if (page === 'offerings') {
    const o = w.offerings
    const context = d.usage?.context
    const percent = d.view?.context ?? null
    const estimate = d.view?.estimate === true
    const tokens = estimate ? context?.breakdown?.totalTokens : context?.tokens
    const blocks: Block[] = [{ t: 'heading', text: o.context }]
    if (percent === null) {
      blocks.push({ t: 'box', percent: null, title: o.noReading, detail: null, alt: '' })
    } else {
      const shown = number(percent, lang)
      blocks.push({
        t: 'box',
        percent,
        title: fill(estimate ? o.fullAbout : o.full, { percent: shown }),
        detail: tokens !== undefined && context?.window ? fill(estimate ? o.tokensAbout : o.tokens, { tokens: number(tokens, lang), window: number(context.window, lang) }) : null,
        alt: fill(estimate ? d.own.alt.boxAbout : d.own.alt.box, { percent: shown }),
      })
      blocks.push({ t: 'meter', percent, alt: fill(estimate ? o.fullAbout : o.full, { percent: shown }) })
      if (estimate) blocks.push({ t: 'note', text: o.estimateNote })
    }
    blocks.push({ t: 'heading', text: o.limits })
    const limits = d.usage?.rateLimits ?? []
    if (limits.length === 0) blocks.push({ t: 'note', text: o.noLimits })
    for (const limit of limits) {
      const used = fill(o.used, { percent: number(limit.percentUsed, lang) })
      const parts = [used]
      if (limit.resetsAt) parts.push(fill(o.resets, { time: moment(limit.resetsAt, d.now, lang, d.timeZone) }))
      const kind = o.kinds[limit.kind] ?? limit.kind
      blocks.push({ t: 'fact', label: kind, text: parts.join(' · ') })
      blocks.push({ t: 'meter', percent: limit.percentUsed, alt: `${kind}: ${used}` })
    }
    blocks.push({ t: 'heading', text: o.session })
    if (d.usage?.cost) blocks.push({ t: 'para', text: fill(o.cost, { usd: usd(d.usage.cost.usd, lang) }) })
    if (d.usage?.startedAt) blocks.push({ t: 'para', text: fill(o.started, { time: moment(new Date(d.usage.startedAt).toISOString(), d.now, lang, d.timeZone) }) })
    return blocks
  }

  if (page === 'log') {
    const l = w.log
    const turns = Number(d.store.turns ?? 0)
    const count = (n: number) => (n === 0 ? l.never : n === 1 ? l.once : fill(l.times, { n: number(n, lang) }))
    const night = d.store.latestNight as { at: number; minutes: number } | undefined
    const first = Number(d.store.firstMet ?? 0)
    return [
      { t: 'fact', label: l.pages, text: number(turns, lang) },
      { t: 'fact', label: l.first, text: first ? date(first, lang, d.timeZone, true) : l.never },
      { t: 'fact', label: l.latest, text: night ? fill(l.at, { time: time(night.at, lang, d.timeZone), date: date(night.at, lang, d.timeZone, true) }) : l.never },
      { t: 'fact', label: l.wild, text: count(Number(d.store.wilds ?? 0)) },
      { t: 'fact', label: l.omens, text: count(Number(d.store.omens ?? 0)) },
    ]
  }

  if (page === 'library') {
    const all = w.library.readings
    const i = ((d.reading % all.length) + all.length) % all.length
    const reading = all[i] ?? all[0]
    return [
      { t: 'heading', text: reading?.title ?? '' },
      { t: 'para', text: reading?.text ?? '' },
      { t: 'nav', previous: w.library.previous, next: w.library.next, where: fill(w.library.of, { i: i + 1, n: all.length }) },
    ]
  }

  // settings
  const s = w.settings
  const choice = (label: string, setting: string, current: string, options: Record<string, string>, help = '', local?: true, shown?: string): Block => ({
    t: 'choice',
    label,
    current,
    now: fill(s.now, { value: shown ?? options[current] ?? current }),
    options: Object.entries(options).map(([value, text]) => ({ value, label: text, key: `claudesama:set:${setting}:${value}` })),
    help,
    ...(local ? { local } : {}),
  })
  const picked = LANGS.find(l => l.code === d.store.lang)?.code
  // The store first: it is written before the view, so a redraw right after a press is current.
  const now = (key: 'voice' | 'affection' | 'band', fallback: string) => String(d.store[key] ?? d.view?.[key] ?? fallback)
  // The store first, as above; then the value the transcript holds.
  const stored = d.store.marks
  const marks: Marks = stored === 'off' || stored === 'replies' || stored === 'on' ? stored : d.marks
  const reading = LANGS.find(l => l.code === d.view?.lang)?.native ?? 'English'
  return [
    choice(s.voice.label, 'voice', now('voice', 'light'), { off: s.voice.off, light: s.voice.light, full: s.voice.full }, s.voice.help),
    choice(s.affection.label, 'affection', now('affection', 'warm'), { warm: s.affection.warm, clingy: s.affection.clingy }),
    choice(s.band.label, 'band', now('band', 'on'), { on: surface === 'desktop' ? s.band.painted : s.band.on, compact: surface === 'desktop' ? s.band.pixel : s.band.compact, off: s.band.off }),
    ...(surface === 'desktop' ? [choice(s.marks.label, 'marks', marks, { on: s.marks.on, replies: s.marks.replies, off: s.marks.off }, s.marks.help, true)] : []),
    // Each language by its own name, so anyone finds theirs whatever the page is in.
    choice(
      s.language.label,
      'lang',
      picked ?? 'auto',
      Object.fromEntries([['auto', s.language.auto], ...LANGS.map(l => [l.code, l.native])]),
      '',
      undefined,
      picked ? undefined : fill(s.language.autoNow, { auto: s.language.auto, language: reading }),
    ),
    ...(d.reducedMotion ? [{ t: 'fact' as const, label: s.motion.label, text: s.motion.still }] : []),
    { t: 'icon', data: d.icon ?? { state: 'unknown', unavailable: true, failed: false } },
    ...(d.companion ? [{ t: 'companion' as const, data: d.companion }] : []),
  ]
}

function direction(page: Page, w: BookWords, d: BookData): string {
  return page === 'omen' && d.fortune ? w.direction.omenDrawn : w.direction[page]
}

function titleOf(page: Page, w: BookWords, d: BookData): string {
  return page === 'him' ? d.own.name : w.title[page]
}

function plain(text: string): string {
  return text.replace(/^[（(]|[）)]$/g, '')
}

// ---------------------------------------------------------------- desktop

// `portrait` is the page's picture as SVG source, drawn `height` px tall.
export function desktopBook(
  ui: Elements['desktop'],
  w: BookWords,
  book: ClaudesamaBook,
  d: BookData,
  portrait: { source: string; height: number },
  press: Press,
  columns: number,
): RenderElement {
  const { Box, Text, Button, Svg } = ui
  const page = book.page
  const blocks = pageBlocks(page, w, d)
  const slant = !NO_ITALIC.has(d.view?.lang ?? 'en')
  const aside = (text: string) => slant && oneLine(text, columns)
  const noop = () => {}

  const block = (b: Block): RenderElement | null => {
    switch (b.t) {
      case 'heading':
        return <Box marginTop={1}><Text bold wrap="wrap">{b.text}</Text></Box>
      case 'para':
        return <Text wrap="wrap">{b.text}</Text>
      case 'note':
        return <Text italic={aside(b.text)} wrap="wrap">{b.text}</Text>
      case 'fact':
        return (
          <Text wrap="wrap">
            <Text bold>{b.label}</Text>
            {`${d.view?.lang === 'zh' || d.view?.lang === 'ja' ? ':' : '  '}${b.text}`}
          </Text>
        )
      case 'meter':
        return <Svg alt={b.alt} source={meterSvg(b.percent)} width={168} height={8} />
      case 'box':
        return (
          <Box flexDirection="row" alignItems="center">
            {b.percent === null ? null : <Svg alt={b.alt} source={offeringSvg(b.percent)} width={40} height={36} />}
            <Box flexDirection="column" marginLeft={b.percent === null ? 0 : 1} flexShrink={1}>
              <Text bold={b.percent !== null} wrap="wrap">{b.title}</Text>
              {b.detail ? <Text wrap="wrap">{b.detail}</Text> : null}
            </Box>
          </Box>
        )
      case 'slip':
        return (
          <Box flexDirection="row" alignItems="flex-start">
            <Svg alt={b.alt} source={slipLargeSvg(b.rank)} width={56} height={150} />
            <Box flexDirection="column" marginLeft={2} flexShrink={1}>
              <Text wrap="wrap">{b.text}</Text>
              <Text italic={slant} wrap="wrap">{b.date}</Text>
            </Box>
          </Box>
        )
      case 'choice':
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text wrap="wrap">
              <Text bold>{b.label}</Text>
              {`  ${b.now}`}
            </Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {b.options.map(o => (
                <Button
                  key={o.key}
                  label={o.label}
                  {...(o.value === b.current ? { variant: 'primary' as const } : {})}
                  onPress={b.local ? () => press.marks(o.value as Marks) : noop}
                />
              ))}
            </Box>
            {b.help ? <Text italic={aside(b.help)} wrap="wrap">{b.help}</Text> : null}
          </Box>
        )
      case 'button':
        return (
          <Box flexDirection="row">
            <Button key={b.key} label={b.label} {...(b.primary ? { variant: 'primary' as const } : {})} onPress={noop} />
          </Box>
        )
      case 'icon':
        return iconSection(ui, w.settings.icon, b.data, action => press.icon?.(action), slant, columns)
      case 'companion':
        return companionSection(ui, true, w.settings.companion, w.settings.now, b.data, action => press.companion?.(action), slant, columns, moment(new Date(b.data.info.hiddenUntil ?? d.now).toISOString(), d.now, d.view?.lang ?? 'en', d.timeZone))
      case 'nav':
        return (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center" marginTop={1}>
            <Button key="claudesama:book:previous" label={b.previous} onPress={() => press.turn(-1)} />
            <Button key="claudesama:book:next" label={b.next} onPress={() => press.turn(1)} />
            <Text italic={slant}>{b.where}</Text>
          </Box>
        )
    }
    return null
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {PAGES.map((p, i) => (
          <Button
            key={`claudesama:book:tab:${p}`}
            label={w.tabs[p]}
            hotkey={String(i + 1)}
            {...(p === page ? { variant: 'primary' as const } : {})}
            onPress={() => press.go(p)}
          />
        ))}
      </Box>
      <Box flexDirection="row" alignItems="center" marginTop={1}>
        <Svg alt={`${d.own.name},${d.view?.lang === 'zh' || d.view?.lang === 'ja' ? '' : ' '}${plain(direction(page, w, d))}`} source={portrait.source} width={desktopWidth(portrait.height)} height={portrait.height} />
        <Box flexDirection="column" marginLeft={1} flexShrink={1}>
          <Text bold wrap="wrap">
            <Text color="claude">{'✻ '}</Text>
            {titleOf(page, w, d)}
          </Text>
          <Text italic={slant} wrap="wrap">{direction(page, w, d)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {blocks.map(block)}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- terminal

const BAR = 24

function bar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR, Math.round((BAR * percent) / 100)))
  return `${'█'.repeat(filled)}${'░'.repeat(BAR - filled)}`
}

export function terminalBook(ui: Elements['terminal'], w: BookWords, book: ClaudesamaBook, d: BookData, press: Press, columns: number): RenderElement {
  const { Box, Text, Button, Raster } = ui
  const page = book.page
  const blocks = pageBlocks(page, w, d, 'terminal')
  const slant = !NO_ITALIC.has(d.view?.lang ?? 'en')
  const aside = (text: string) => slant && oneLine(text, columns)
  const noop = () => {}
  const cue = d.view?.cue ?? 'claude'
  // His portrait on his page only where it leaves the title a fair line beside it.
  const portrait = page === 'him' && columns >= TERMINAL_COLUMNS + 2 + 24

  // The page's first block sits right under the header's own gap; later choices keep a blank line.
  const block = (b: Block, i: number): RenderElement | null => {
    switch (b.t) {
      case 'heading':
        return <Text bold wrap="wrap">{b.text}</Text>
      case 'para':
        return <Text wrap="wrap">{b.text}</Text>
      case 'note':
        return <Text italic={aside(b.text)} wrap="wrap">{b.text}</Text>
      case 'fact':
        return (
          <Text wrap="wrap">
            <Text bold>{b.label}</Text>
            {`${d.view?.lang === 'zh' || d.view?.lang === 'ja' ? ':' : '  '}${b.text}`}
          </Text>
        )
      case 'meter':
        return <Text color={cue}>{bar(b.percent)}</Text>
      case 'box':
        return (
          <Box flexDirection="column">
            <Text bold={b.percent !== null} wrap="wrap">{`${b.percent === null ? '' : '▤ '}${b.title}`}</Text>
            {b.detail ? <Text wrap="wrap">{b.detail}</Text> : null}
          </Box>
        )
      case 'slip':
        return (
          <Box flexDirection="column">
            <Text bold color={cue} wrap="wrap">{`✻ ${b.rank}`}</Text>
            <Text wrap="wrap">{b.text}</Text>
            <Text italic={slant}>{b.date}</Text>
          </Box>
        )
      case 'choice':
        return (
          <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
            <Text wrap="wrap">
              <Text bold>{b.label}</Text>
              {`  ${b.now}`}
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {b.options.map(o => (
                <Button key={o.key} label={o.label} {...(o.value === b.current ? { variant: 'primary' as const } : {})} onPress={b.local ? () => press.marks(o.value as Marks) : noop} />
              ))}
            </Box>
            {b.help ? <Text italic={aside(b.help)} wrap="wrap">{b.help}</Text> : null}
          </Box>
        )
      case 'button':
        return <Button key={b.key} label={b.label} {...(b.primary ? { variant: 'primary' as const } : {})} onPress={noop} />
      case 'icon':
        return iconSection(ui, w.settings.icon, b.data, action => press.icon?.(action), slant, columns)
      case 'companion':
        return companionSection(ui, false, w.settings.companion, w.settings.now, b.data, action => press.companion?.(action), slant, columns, moment(new Date(b.data.info.hiddenUntil ?? d.now).toISOString(), d.now, d.view?.lang ?? 'en', d.timeZone))
      case 'nav':
        return (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="claudesama:book:previous" label={b.previous} onPress={() => press.turn(-1)} />
            <Button key="claudesama:book:next" label={b.next} onPress={() => press.turn(1)} />
            <Text italic={slant}>{b.where}</Text>
          </Box>
        )
    }
    return null
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {PAGES.map((p, i) => (
          <Button key={`claudesama:book:tab:${p}`} label={`${i + 1}${d.view?.lang === 'zh' || d.view?.lang === 'ja' ? '' : ' '}${w.tabs[p]}`} hotkey={String(i + 1)} {...(p === page ? { variant: 'primary' as const } : {})} onPress={() => press.go(p)} />
        ))}
      </Box>
      <Box flexDirection="row" alignItems="flex-end" marginTop={1}>
        {portrait ? <Raster key="portrait" columns={TERMINAL_COLUMNS} rows={TERMINAL_ROWS} cells={spriteCells('wave', d.view?.colors ?? 'truecolor')} /> : null}
        <Box flexDirection="column" marginLeft={portrait ? 2 : 0} flexShrink={1}>
          <Text bold wrap="wrap">
            <Text color={cue}>{'✻ '}</Text>
            {titleOf(page, w, d)}
          </Text>
          <Text italic={slant} wrap="wrap">{direction(page, w, d)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {blocks.map(block)}
      </Box>
    </Box>
  )
}
