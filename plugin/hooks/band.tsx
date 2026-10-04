// The band above the prompt, read like a line of a play: his picture, his name as the speaker
// cue, a stage direction, and now and then one line he says. The offering box sits at the right.
// Text colours are theme keys, so they follow the person's own theme on every surface; raw
// colours appear only inside pictures and on the fortune slip, which paints its own paper.
//
// Nothing in the band is ever cut off. The desktop lays its rows out like a web page, where a
// line of text does not shrink below its own width, so the band plans its layout from the width
// it is given (planDesktop) instead of relying on shrinking: as the band narrows it drops the
// word "context", moves the stage direction under his name, shortens it with an ellipsis, gives
// the book button its one-word label, and draws him smaller; the percentage and the button stay
// whole.

import type { Elements, RenderElement } from 'claude-code'
import { DESKTOP_COMPACT, DESKTOP_REST, TERMINAL_COLUMNS, TERMINAL_ROWS, desktopWidth, bundledSvg, DOOR_COLUMNS, sleepingDoorCells, imageColumns, offeringSvg, slipSvg, spriteCells } from './pictures'
import { fill } from './book-words'
import { COLUMN_PX, cutToPx, gapBefore, minWrapPx, planPx } from './typeset'
import { WORDS } from './words'
import { companionPatLabel } from './companion'
import { DOOR_WORDS } from './door-words'
import type { ClaudesamaView as View } from '../types'

const PAPER = '#FAEEE9' // the slip's cream; its ink below keeps 5.7:1 on it
const INK = '#9E4123'
const MIN_TEXT = 26

export type BandSize = {
  columns: number // e.props.bodyColumns
  maxRows: number // e.props.maxRows
  screenRows: number // e.viewport?.rows, or a guess
  isWorking: boolean // e.props.isWorking
}

function tone(percent: number): 'inactive' | 'warning' | 'error' {
  return percent >= 95 ? 'error' : percent >= 85 ? 'warning' : 'inactive'
}

// Cells a string takes on the terminal, counted per grapheme as the engine's renderer counts
// them: the first character decides. CJK, Hangul syllables and fullwidth forms take two; a
// grapheme that starts with a mark or a zero-width character takes none, so Devanagari vowel
// signs and viramas, Hangul jamo that join a syllable, and accents add nothing.
const WIDE = /^[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97c\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u
const NONE = /^[\p{M}\u1160-\u11ff\ud7b0-\ud7ff\u200b-\u200f\u2060\ufeff]/u
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : undefined
export function cells(text: string): number {
  let n = 0
  const parts = graphemes ? Array.from(graphemes.segment(text), part => part.segment) : [...text]
  for (const part of parts) n += NONE.test(part) ? 0 : WIDE.test(part) ? 2 : 1
  return n
}

function plain(aside: string): string {
  return aside.replace(/^[（(]|[）)]$/g, '')
}

// Whether the terminal band has room for the sprite: not while a turn runs, not when narrow,
// short, or set to compact. The desktop keeps its resting size unless Smaller was chosen.
export function terminalHasSprite(view: View, size: BandSize): boolean {
  const columns = view.pictures === 'kitty' ? imageColumns(TERMINAL_ROWS) : TERMINAL_COLUMNS
  return !(
    view.band === 'compact' ||
    size.isWorking ||
    size.columns < columns + 2 + MIN_TEXT ||
    size.maxRows < TERMINAL_ROWS ||
    size.screenRows < TERMINAL_ROWS * 3
  )
}

export function desktopHeight(view: View, size: BandSize): number {
  return view.band === 'compact' || (size.isWorking && view.workSize === 'smaller') || size.maxRows < 4 ? DESKTOP_COMPACT : DESKTOP_REST
}

// About how many rows a tree takes on the terminal: columns stack, rows take their tallest
// child, text counts its lines (wrapping is not counted). Used to leave room for other mods.
export function rowsOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (typeof node === 'string' || typeof node === 'number') return String(node).split('\n').length
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + rowsOf(child), 0)
  const { type, props = {}, children = [] } = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const n = (key: string) => Number(props[key] ?? 0) || 0
  if (props.display === 'none') return 0
  if (type === 'Raster' || type === 'Image') return n('rows') || 1
  if (type === 'Text') return Math.max(1, children.filter(c => typeof c === 'string').join('').split('\n').length)
  if (type === 'Box') {
    const kids = children.map(rowsOf)
    const inner = String(props.flexDirection ?? 'row').startsWith('column')
      ? kids.reduce((a, b) => a + b, 0)
      : Math.max(0, ...kids)
    const padding = (n('paddingY') || n('padding')) * 2 + n('paddingTop') + n('paddingBottom')
    const margin = (n('marginY') || n('margin')) * 2 + n('marginTop') + n('marginBottom')
    return inner + padding + margin + (props.borderStyle ? 2 : 0)
  }
  return children.reduce((sum: number, child) => sum + rowsOf(child), 0)
}

// ---------------------------------------------------------------- terminal

// `png` is the frame's PNG for kitty and Ghostty, absent for half-block cells.
export function terminalBand(ui: Elements['terminal'], view: View, size: BandSize, png?: string): RenderElement {
  const { Box, Text, Raster, Image, Button } = ui
  const words = WORDS[view.lang]
  const aside = words.aside[view.mood]
  const sprite = terminalHasSprite(view, size)
  const bookWidth = 1 + cells(words.marks.shelf)
  const book = (
    <Box marginLeft={1} flexShrink={0}>
      <Button key="claudesama:book:open" label={words.marks.shelf} plain dimColor onPress={() => {}} />
    </Box>
  )
  // Room left of the offering box: his name never shrinks, the stage direction may, and the
  // word "context" shows only where the whole line fits.
  const room = size.columns - bookWidth - (sprite ? (png ? imageColumns(TERMINAL_ROWS) : TERMINAL_COLUMNS) + 2 + (view.slip?.label ? 6 : 0) : 0)
  const short = view.context === null ? '' : `▤ ${view.estimate ? '~' : ''}${view.context}%`
  const label = view.context !== null && room >= cells(words.name) + cells(gapBefore(aside)) + cells(aside) + 2 + cells(`${short} ${words.context}`) ? `${short} ${words.context}` : short
  const offering =
    view.context === null ? null : (
      <Box marginLeft={2} flexShrink={0}>
        <Text color={tone(view.context)}>{label}</Text>
      </Box>
    )
  const name = (
    <Box flexShrink={0}>
      <Text color={view.cue} bold>{words.name}</Text>
    </Box>
  )

  if (!sprite) {
    const said = view.slip?.text ?? view.said ?? undefined
    const chip = view.slip?.label ? 1 + cells(view.slip.label) + 2 : 0
    // His line stays on his row when it fits there whole; otherwise it wraps under the row. A
    // stage direction may end in an ellipsis; a line he says is never cut.
    const fits = said !== undefined && cells(words.name) + chip + cells(gapBefore(said)) + cells(said) + (view.context === null ? 0 : 2 + cells(label)) + bookWidth <= size.columns
    const row = (
      <Box flexDirection="row">
        <Box flexDirection="row" flexGrow={1} flexShrink={1}>
          {name}
          {view.slip?.label ? <Box marginLeft={1} flexShrink={0}><Text color={INK} backgroundColor={PAPER} bold>{` ${view.slip.label} `}</Text></Box> : null}
          {said === undefined ? (
            <Text color="inactive" wrap="truncate-end">{`${gapBefore(aside)}${aside}`}</Text>
          ) : fits ? (
            <Text wrap="wrap">{`${gapBefore(said)}${said}`}</Text>
          ) : null}
        </Box>
        {offering}
        {book}
      </Box>
    )
    if (said === undefined || fits) return row
    return (
      <Box flexDirection="column">
        {row}
        <Text wrap="wrap">{said}</Text>
      </Box>
    )
  }

  const picture = png ? (
    <Image key="sprite" source={{ png }} columns={imageColumns(TERMINAL_ROWS)} rows={TERMINAL_ROWS} alt={`${words.name} ${aside}`} />
  ) : (
    <Raster key="sprite" columns={TERMINAL_COLUMNS} rows={TERMINAL_ROWS} cells={spriteCells(view.frame, view.colors)} />
  )
  const slip = view.slip?.label ? (
    <Box flexDirection="column" backgroundColor={PAPER} marginLeft={2} width={4}>
      <Text backgroundColor={PAPER}>{'    '}</Text>
      {[...view.slip.label].map(k => (
        <Text color={INK} backgroundColor={PAPER} bold>{` ${k} `}</Text>
      ))}
      <Text backgroundColor={PAPER}>{'    '}</Text>
    </Box>
  ) : null
  const line = view.slip?.text ?? view.said

  return (
    <Box flexDirection="row" alignItems="flex-end">
      {picture}
      {slip}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} marginLeft={2}>
        <Box flexDirection="row">
          <Box flexDirection="row" flexGrow={1} flexShrink={1}>
            {name}
            <Text color="inactive" wrap="truncate-end">{`${gapBefore(aside)}${aside}`}</Text>
          </Box>
          {offering}
          {book}
        </Box>
        {line ? <Text wrap="wrap">{line}</Text> : null}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- desktop

// A native button's padding and border around its label, and the offering box picture, in px.
const BUTTON_CHROME = 28
const BOX_PX = 20

// How the desktop band is laid out at a given width. Two things are chosen, in a fixed order, so
// the band gives things up the same way every time. The frame: the book button's whole label, then
// its one word; his picture at full size, then small; his name, and last not even that (his
// picture already says who he is). Within the richest frame where his name fits, the richest
// place for the rest: the word "context", the stage direction beside his name, then under it, then
// cut with an ellipsis, then gone. His lines are never cut (they wrap), and the percentage and
// the button always stay whole.
export type DesktopPlan = {
  height: number // his picture's height: DESKTOP_REST, DESKTOP_COMPACT, or 0 for none
  row: boolean // one row while working/compact, or the narrowest fallback with speech below
  slip: boolean // the slip's picture beside him
  word: boolean // the word "context" after the percentage
  aside: 'beside' | 'below' | 'none' // where the stage direction stands (a line he says replaces it in a row)
  text: string | undefined // the stage direction, cut to fit when needed; or, in a row, his line, whole
  label: string // the book button's label: whole, or its one word
  name: string | undefined // his name; left out only when even his small picture needs the room
  frame: number // which frame (0: everything whole)
  place: number // which place within it (0: everything beside his name, and the word)
}

type Frame = { shelf: boolean; height: number; name: boolean }
type Place = { word: boolean; aside: 'beside' | 'below' | 'none'; cut: boolean }

function offeringLabel(view: View, word: boolean): string {
  return ` ${view.estimate ? '~' : ''}${view.context}%${word ? ` ${WORDS[view.lang].context}` : ''}`
}

export function planDesktop(view: View, size: BandSize, displaySpeech?: string): DesktopPlan {
  const words = WORDS[view.lang]
  const avail = size.columns * COLUMN_PX
  const row = desktopHeight(view, size) === DESKTOP_COMPACT
  const said = displaySpeech ?? view.slip?.text ?? view.said ?? undefined
  const saidMin = said ? minWrapPx(said) : 0
  const aside = words.aside[view.mood]
  // Same size keeps the resting geometry even when a new mood has a longer direction.
  // Fit the actual direction into the idle slot instead of moving his picture or controls.
  const stable = view.band === 'on' && view.workSize !== 'smaller' && !(row && said)
  const layoutAside = stable ? words.aside.idle : aside
  const nameW = planPx(words.name, true)
  const offering = (word: boolean) => (view.context === null ? 0 : BOX_PX + planPx(offeringLabel(view, word)))
  const button = (shelf: boolean) => BUTTON_CHROME + planPx(shelf ? words.marks.shelf : words.marks.book)
  const frames: Frame[] = row
    ? [{ shelf: false, height: DESKTOP_COMPACT, name: true }, { shelf: true, height: DESKTOP_COMPACT, name: true }, { shelf: true, height: DESKTOP_COMPACT, name: false }, { shelf: true, height: 0, name: false }]
    : [{ shelf: false, height: DESKTOP_REST, name: true }, { shelf: true, height: DESKTOP_REST, name: true }, { shelf: true, height: DESKTOP_COMPACT, name: true }, { shelf: true, height: DESKTOP_COMPACT, name: false }, { shelf: true, height: 0, name: false }]
  const place = (word: boolean, where: Place['aside'], cut = false): Place => ({ word, aside: where, cut })
  // In a row, a line he says stands beside his name or, when it does not fit, under the row.
  const places: Place[] = row
    ? said
      ? [place(true, 'beside'), place(false, 'beside'), place(false, 'below')]
      : [place(true, 'beside'), place(false, 'beside'), place(false, 'beside', true), place(false, 'none')]
    : said && !stable
      ? [place(true, 'beside'), place(false, 'beside'), place(false, 'beside', true), place(false, 'none')]
      : [place(true, 'beside'), place(false, 'beside'), place(false, 'below'), place(false, 'below', true), place(false, 'none')]
  const content = row && said ? said : aside
  const layoutContent = row && said ? said : layoutAside

  for (const [f, frame] of frames.entries()) {
    const slip = !row && view.slip !== null && frame.height === DESKTOP_REST
    const left = (frame.height ? desktopWidth(frame.height, view.band === 'compact') + COLUMN_PX : 0) + (slip ? 24 + COLUMN_PX : 0)
    for (const [p, at] of places.entries()) {
      // Without his name nothing stands beside it: only his line, under the row.
      if (!frame.name && at.aside !== 'none' && !(row && said && at.aside === 'below')) continue
      // At rest the box and the button stack in one column; in a row they stand side by side.
      const right = row
        ? (view.context === null ? 0 : 2 * COLUMN_PX + offering(at.word)) + 2 * COLUMN_PX + button(frame.shelf)
        : 2 * COLUMN_PX + Math.max(offering(at.word), button(frame.shelf))
      const middle = avail - left - right
      if (middle < 0 || (frame.name && nameW > middle)) continue
      // At rest his line always wraps in the middle column, even after the direction and
      // name go. In a row only beside speech uses it; below speech has the full band width.
      if (said && (!row || at.aside === 'beside') && saidMin > middle) continue
      let text: string | undefined
      if (at.aside === 'below') {
        // In a row, his line wraps under it at full width; at rest the stage direction stands
        // under his name in the middle column, whole or cut.
        text = row ? layoutContent : at.cut ? cutToPx(layoutContent, middle) : planPx(layoutContent) <= middle ? layoutContent : undefined
        if (text === undefined) continue
        if (stable) text = cutToPx(content, middle) ?? ''
      } else if (at.aside === 'beside') {
        const room = middle - nameW - planPx(gapBefore(layoutContent))
        text = at.cut ? cutToPx(layoutContent, room, false, row ? 4 : 3) : planPx(layoutContent) <= room ? layoutContent : undefined
        if (text === undefined) continue
        if (stable) text = cutToPx(content, middle - nameW - planPx(gapBefore(content)), false, row ? 4 : 3) ?? ''
      }
      return { height: frame.height, row, slip, word: at.word, aside: at.aside, text, label: frame.shelf ? words.marks.shelf : words.marks.book, name: frame.name ? words.name : undefined, frame: f, place: p }
    }
  }
  // With no frame left to give up, a word may still be wider than the resting middle
  // ("Marzipanschwein."). Use the row's full-width line below the whole controls instead.
  return { height: 0, row: row || !!said, slip: false, word: false, aside: said ? 'below' : 'none', text: said, label: words.marks.shelf, name: undefined, frame: frames.length, place: 0 }
}

const pictureLinks = new Map<string, string>()
function pictureLink(source: string, alt: string): string {
  const key = `${alt}:${source}`
  const cached = pictureLinks.get(key)
  if (cached !== undefined) return cached
  const escaped = alt.replace(/[\\[\]]/g, '\\$&')
  const text = `[![${escaped}](data:image/svg+xml;base64,${btoa(source)})](file:///claudesama-poke)`
  if (pictureLinks.size >= 64) pictureLinks.delete(pictureLinks.keys().next().value!)
  pictureLinks.set(key, text)
  return text
}

// `sprite` uses the final plan's height and matching painted or pixel frame.
export function desktopBand(ui: Elements['desktop'], view: View, size: BandSize, sprite: string, plan?: DesktopPlan, displaySpeech?: string): RenderElement {
  plan ??= planDesktop(view, size, displaySpeech)
  const { Box, Text, Svg, Button, Markdown } = ui
  const words = WORDS[view.lang]
  const said = displaySpeech ?? view.slip?.text ?? view.said
  const offering =
    view.context === null ? null : (
      <Box flexDirection="row" alignItems="center" marginLeft={2} flexShrink={0}>
        <Svg alt={fill(view.estimate ? words.alt.boxAbout : words.alt.box, { percent: view.context })} source={offeringSvg(view.context)} width={BOX_PX} height={18} />
        <Text color={tone(view.context)}>{offeringLabel(view, plan.word)}</Text>
      </Box>
    )
  const aside = words.aside[view.mood]
  const picture = plan.height ? (
    <Box flexShrink={0}>
      <Markdown key="claudesama:band:poke" text={pictureLink(sprite, `${words.name}, ${plain(aside)}, ${companionPatLabel(view.lang)}`)} pressableLinks={['file:///claudesama-poke']} onLinkPress={() => {}} />
    </Box>
  ) : null
  // His book (pages.tsx answers the press): the way to his pages without a command. At rest it
  // stands under the offering box, so his name and stage direction keep their room.
  const book = (
    <Box marginLeft={2} marginTop={plan.row ? 0 : 1} flexShrink={0}>
      <Button key="claudesama:book:open" label={plan.label} onPress={() => {}} />
    </Box>
  )
  const name = plan.name === undefined ? null : (
    <Box flexShrink={0}>
      <Text color="claude" bold>{plan.name}</Text>
    </Box>
  )
  // After his name: one ordinary space, or none before a full-width bracket (it has its own).
  const besideText = (content: string, quiet: boolean) => (
    <Box flexShrink={1} minWidth={0}>
      <Text color={quiet ? 'inactive' : undefined} wrap="truncate-end">{`${gapBefore(content)}${content}`}</Text>
    </Box>
  )

  if (plan.row) {
    const top = (
      <Box flexDirection="row" alignItems="center">
        {picture}
        <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} marginLeft={plan.height ? 1 : 0}>
          {name}
          {plan.aside === 'beside' && plan.text !== undefined ? besideText(plan.text, !said) : null}
        </Box>
        {offering}
        {book}
      </Box>
    )
    if (plan.aside !== 'below' || plan.text === undefined) return top
    return (
      <Box flexDirection="column">
        {top}
        <Text wrap="wrap">{plan.text}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" alignItems="center">
      {picture}
      {plan.slip && view.slip ? (
        <Box marginLeft={1} flexShrink={0}>
          <Svg alt={view.slip.label ? fill(words.alt.slip, { rank: view.slip.label }) : words.alt.slipBlank} source={slipSvg(view.slip.label)} width={24} height={62} />
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} marginLeft={plan.height ? 1 : 0}>
        <Box flexDirection="row" minWidth={0}>
          {name}
          {plan.aside === 'beside' && plan.text !== undefined ? besideText(plan.text, true) : null}
        </Box>
        {plan.aside === 'below' && plan.text !== undefined ? <Text color="inactive" wrap="truncate-end">{plan.text}</Text> : null}
        {said ? <Text wrap="wrap">{said}</Text> : null}
      </Box>
      <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
        {offering}
        {book}
      </Box>
    </Box>
  )
}

// Svg/Raster are API leaves without press callbacks. A plain Button beside the sleeping
// picture gives both surfaces a pointer, keyboard and accessible route back.
export function desktopDoor(ui: Elements['desktop'], view: View, onWake: () => void, pixel = false): RenderElement {
  const { Box, Svg, Button } = ui
  const words = DOOR_WORDS[view.lang]
  return (
    <Box flexDirection="row" justifyContent="flex-end" alignItems="center">
      <Svg source={bundledSvg('sleep', DESKTOP_COMPACT, pixel)} alt={words.alt} width={desktopWidth(DESKTOP_COMPACT, pixel)} height={DESKTOP_COMPACT} />
      <Box marginLeft={1}><Button key="claudesama:band:wake" label={words.wake} plain dimColor onPress={onWake} /></Box>
    </Box>
  )
}

export function terminalDoor(ui: Elements['terminal'], view: View, onWake: () => void): RenderElement {
  const { Box, Raster, Button } = ui
  const words = DOOR_WORDS[view.lang]
  return (
    <Box flexDirection="row" justifyContent="flex-end">
      <Raster key="claudesama:door:sleep" columns={DOOR_COLUMNS} rows={1} cells={sleepingDoorCells(view.colors)} />
      <Box marginLeft={1}><Button key="claudesama:band:wake" label={words.wake} plain dimColor onPress={onWake} /></Box>
    </Box>
  )
}
