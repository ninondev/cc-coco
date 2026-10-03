// Setting a line of type where nothing may be cut off: the gap between a speaker's name and a
// stage direction, how wide a string will be on the desktop, and shortening a string to a width
// with an ellipsis. Pure; used by the band and the transcript's marks.

// A full-width opening bracket carries its own space on its left (the glyph sits in the right of
// its square), so nothing goes before it; any other direction gets one ordinary space.
const FULL_WIDTH_OPEN = /^[（「『【〔〈《［｛]/u

export function gapBefore(direction: string): string {
  return FULL_WIDTH_OPEN.test(direction) ? '' : ' '
}

// ---------------------------------------------------------------- desktop widths

// The desktop draws the band and the transcript in a proportional sans at 13 px; it lays Boxes
// out in cells of its monospace metric, about 7.8 px (the band reported 34 columns at 280 px on
// the owner's screen). These estimates were fitted to WebKit's own layout of every band string
// in all twelve languages at 13 px (median 1.07 times the measured width, never under 0.98) and
// are used with SAFE on top, so a layout that fits by them fits on screen.
export const COLUMN_PX = 7.8
export const SAFE = 1.1

const WIDE = /^[ᄀ-ᅟ⺀-꓏ꥠ-ꥼ가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u
const MARK = /^[\p{Mn}\p{Me}​-‏⁠﻿]/u
const SPACING_MARK = /^\p{Mc}/u
const DEVANAGARI = /^[ऀ-ॿ]/
const NARROW = new Set([...'il.,;:!|\'’`ıIjtf()[]'])
const BROAD = new Set([...'mwMW%'])

// Width in px at 13 px, before SAFE; bold is about 7% wider.
export function textPx(text: string, bold = false): number {
  let w = 0
  for (const ch of text) {
    if (MARK.test(ch)) continue
    else if (WIDE.test(ch)) w += 13.2
    else if (DEVANAGARI.test(ch)) w += SPACING_MARK.test(ch) ? 4.6 : 8.4
    else if (ch === ' ') w += 3.8
    else if (NARROW.has(ch)) w += 4.6
    else if (BROAD.has(ch)) w += 11.2
    else if (ch >= '0' && ch <= '9') w += 7.8
    else if (ch !== ch.toLowerCase()) w += 8.9
    else w += 7.5
  }
  return w * (bold ? 1.07 : 1)
}

// The width to plan for: the estimate with its margin.
export function planPx(text: string, bold = false): number {
  return textPx(text, bold) * SAFE
}

// A wrapped line cannot be narrower than its longest unbreakable run. Ordinary spaces
// separate words; CJK characters break on either side, including beside a Latin word. Keep
// no-break spaces inside their run (French uses them before punctuation).
const CJK_BREAK = /^[ᄀ-ᅟ⺀-꓏ꥠ-ꥼ가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3fffd}]/u
export function minWrapPx(text: string): number {
  let widest = 0
  let run = ''
  for (const ch of text) {
    if (ch === ' ' || ch === '\n' || CJK_BREAK.test(ch)) {
      widest = Math.max(widest, planPx(run), ch === ' ' || ch === '\n' ? 0 : planPx(ch))
      run = ''
    } else run += ch
  }
  return Math.max(widest, planPx(run))
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : undefined
function split(text: string): string[] {
  return graphemes ? Array.from(graphemes.segment(text), part => part.segment) : [...text]
}

// The string shortened to fit `budget` px with an ellipsis, keeping its closing bracket when it
// has one ("(liest eine Zeile…)"). Where words are spaced, it ends on a whole word if one fits
// ("(writing…)", not "(writing i…)"). Undefined when fewer than `least` characters would show.
export function cutToPx(text: string, budget: number, bold = false, least = 3): string | undefined {
  if (planPx(text, bold) <= budget) return text
  const parts = split(text)
  const close = /^[)）」』】〕〉》］｝]$/u.test(parts[parts.length - 1] ?? '') ? parts.pop() ?? '' : ''
  const tail = `…${close}`
  const whole = parts.slice()
  while (parts.length > 0 && planPx(parts.join('') + tail, bold) > budget) parts.pop()
  const visible = (kept: string[]) => kept.filter(p => !/^[\s(（「『【〔〈《［｛]$/u.test(p)).length
  // Cut inside a word: step back to the space before it, when that still shows enough.
  if (parts.length < whole.length && !/^\s$/u.test(whole[parts.length] ?? ' ')) {
    const space = parts.lastIndexOf(' ')
    if (space > 0 && visible(parts.slice(0, space)) >= least) parts.length = space
  }
  while (parts.length > 0 && /^\s$/u.test(parts[parts.length - 1] ?? '')) parts.pop() // no space before the ellipsis
  return visible(parts) >= least ? parts.join('') + tail : undefined
}
