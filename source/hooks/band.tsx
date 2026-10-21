import { contrastSvg, pictureColors } from './high-contrast'
import { EMPTY_12x1 } from './d1-state.js'
import { ribbonSvg, ribbonTerminalCells } from './d1-state.js'
import { d1Word, NO_ITALIC } from './d1-state.js'
import { companionPatLabel } from './companion'
import { cacheAlt, cacheHover, cacheTerminal, costDollars, cupShown } from './cost/surfaces'
import { cupSvg } from './cost/cup'
// The band above the prompt, read like a line of a play: his picture, his name as the speaker
// cue, a stage direction, and now and then one line he says. The offering box sits at the right.
// Text colours are theme keys, so they follow the person's own theme on every surface; raw
// colours appear only inside pictures.
//
// The desktop reserves three text rows at rest and one in compact mode. The planner fits
// speech inside that column, giving up the direction, long slot values and finally the line's
// end in the approved order. A text change never changes the picture's geometry.

import type { Elements, RenderElement } from 'claude-code'
import { DESKTOP_COMPACT, DESKTOP_REST, TERMINAL_COLUMNS, TERMINAL_ROWS, DOOR_COLUMNS, sleepingDoorCells, imageColumns, spriteCells } from './pictures-lazy'
import { cocoStill, cocoWidth } from './coco-motion'
import { claudieReady, claudieSvg } from './claudie'
import { fill } from './book-words'
import { COLUMN_PX, cutToPx, gapBefore, planPx, textPx } from './typeset'
import { placeSvg } from './notice-art'
import { WORDS, quotaDetailGroups, quotaMoney } from './words'
import { contextAlt, hasNumber, numberLocale, percentText, momentText } from './numbers'
import { BAND_BOOK_WORDS } from './book-band-words'
import { PIXEL_EDGE_STYLE, QUOTA_PICTURE_PX, pixelRuns, quotaBandItems, quotaForecast, quotaForecastText } from './quota'
import { LIGHT_PX, laptopLightSvg } from './play-light'
// While keeping the cache warm is on, their cup is the thermos (lane C, 10-14; play-thermos.ts).
import { thermosSvg } from './play-thermos'
import { PLANE_PX, PLANES_PX, planeSvg } from './play-planes'
import type { QuotaBandItem } from './quota'
import { commitCount, commitLineHeight, commitLineSvg, commitLineText, commitLineWidth, contextTokensText } from './play-commits'
import { playWord } from './play'
import { FOCUS_PX, focusBarSvg, focusBarText, focusDone } from './play-focus'
import { ANIMATION_MODE, getMotionWidth } from './pictures-lazy'
import { DOOR_WORDS } from './door-words'
import { lineParts } from './line-slot'
import {displaySlots,untrustedDisplaySlot} from './display-slots'
import type { LinePart, LineButton, LineValue } from './line-slot'
import type { CocoView as View } from '../types'

const MIN_TEXT = 26

// Existing desktop transport bounds also bound preprocessing on the terminal.
// Applying them before tokenization prevents an untrusted slot from selecting
// work proportional to an uncapped path, test name, or direction.
export const BAND_INPUT_LIMIT = 10_000
const BAND_SLOT_LIMIT = 12
const BAND_SLOT_KEEP = 1_000
function cappedBandText(text:string):string {
  if(text.length<=BAND_INPUT_LIMIT)return text
  const head=text.slice(0,BAND_INPUT_LIMIT-1).replace(/[\uD800-\uDBFF]$/,'')
  return head+'…'
}
// The weak direction marks (ALM, LRM, RLM) are part of approved right-to-left words and stay in a line; a slot or a
// line that lost its slot (multiline false) shows them as well.
const LINE_CONTROLS=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
const SLOT_CONTROLS=/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
export function safeBandText(text:string,multiline=true):string {
  return cappedBandText(cappedBandText(text).replace(multiline?LINE_CONTROLS:SLOT_CONTROLS,
    character=>multiline&&(character==='\n'||character==='\t')?character:'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0')))
}
export function safeBandSpeech(text:string,fit:BandLineFit,named=false):{text:string;fit:BandLineFit} {
  const admitted=fit.slots?.slice(0,BAND_SLOT_LIMIT)
  // A slot value past the input budget is cut to its first characters where it stands in the
  // text, so the authored words after it (W4: «… failed.») survive and the fitter still shortens it.
  let source=text,lost=!!fit.slots&&fit.slots.length>BAND_SLOT_LIMIT
  const values=admitted?.map(slot=>{
    const raw=slot.value
    if(raw.length<=BAND_INPUT_LIMIT)return {slot,raw,cut:false}
    // With no authored words around it there is nothing to keep: the slot goes, and the text is cut as before.
    if(source.trim()===raw.trim()){lost=true;return undefined}
    const kept=raw.slice(0,BAND_SLOT_KEEP).replace(/[\uD800-\uDBFF]$/,'')+'…'
    if(source.includes(raw))source=source.split(raw).join(kept);else lost=true
    return {slot,raw:kept,cut:true}
  }).filter((value):value is {slot:LineValue;raw:string;cut:boolean}=>value!==undefined)
  // An omitted raw slot can occupy the retained prefix. Without its full extent,
  // conservatively escape line controls across that bounded source.
  const multiline=!lost
  let bounded=safeBandText(source,multiline)
  // Escaped here, each control shows as \u202e. A drawing passes `named`: a slot within the budget then keeps its
  // value for main's display slots, which name each control (⟨U+202E⟩); a cut slot is still escaped here.
  const slots=values?.map(({slot,raw,cut})=>{const value=cut||!named?safeBandText(raw,false):raw;if(raw)bounded=bounded.split(safeBandText(raw,multiline)).join(value);return {...slot,value}})
  return {text:cappedBandText(bounded),fit:{...fit,...(slots===undefined?{}:{slots})}}
}
// Word/tail boundaries can change wrapping non-monotonically. Visit every
// distinct formatter state in the original descending order, never binary-search
// the wrapping predicate. Long paths have only their existing omission choices.
export function bandSlotFitLengths(slots:readonly LineValue[]):number[] {
  const lengths=new Set<number>([12])
  const add=(length:number)=>{if(length>=12&&length<=BAND_INPUT_LIMIT)lengths.add(length)}
  for(const slot of slots){
    const value=slot.value;add(value.length)
    if(slot.kind==='value'||slot.kind==='label')continue
    if(slot.kind==='path'){
      const parts=value.split('/')
      if(parts.length>1){
        const end=parts.pop()!,start=parts.slice(0,parts.length===2?1:Math.min(parts.length,2)).join('/')
        for(const candidate of [start+'/…/'+end,parts[0]+'/…/'+end,'…/'+end,end])if(candidate&&candidate.length<value.length)add(candidate.length)
      }
      continue
    }
    const boundaries=[...value.matchAll(slot.kind==='test'?/ › |::|[./ ]+/g:/ +/g)]
    if(slot.kind==='test'&&boundaries.length){
      for(const match of boundaries){const tail=value.slice(match.index!+match[0].length).trimStart();if(tail.length+1>=12)add(tail.length)}
      continue
    }
    let fallbackBelow=value.length
    for(const match of boundaries){const head=value.slice(0,match.index).trimEnd();if(head){add(head.length+1);fallbackBelow=Math.min(fallbackBelow,head.length+1)}}
    if(!/\p{Script=Hangul}/u.test(value))for(let length=12;length<fallbackBelow;length++)add(length)
  }
  return [...lengths].sort((a,b)=>b-a)
}
export function fitBandSlotLength(maximum:number,fits:(length:number)=>boolean,lengths?:readonly number[]):number {
  const high=Math.max(12,Math.min(BAND_INPUT_LIMIT,maximum))
  const candidates=lengths??Array.from({length:high-11},(_,i)=>high-i)
  for(const length of candidates)if(fits(length))return length
  return 12
}

export const POKE_ROUTE: 'markdown-overlay' | 'buttons' = 'buttons'
export const HOVER: 'scoped' | 'band' = 'scoped'

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
let graphemes: Intl.Segmenter | null | undefined
export function cells(text: string): number {
  if (/^[\x00-\x7f]*$/.test(text) && !text.includes('\r\n')) return text.length
  // Construct ICU only when a surface first asks for an actual cell width.
  if (graphemes === undefined) graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null
  let n = 0
  const parts = graphemes ? Array.from(graphemes.segment(text), part => part.segment) : [...text]
  for (const part of parts) n += NONE.test(part) ? 0 : WIDE.test(part) ? 2 : 1
  return n
}

function stripStageMarkup(text:string):string {
  return text.replace(/\*([^*\n]+)\*/g,'$1')
}
type SpokenScript = { text: string; italic: { start: number; end: number }[] }
type BandPart = LinePart & { sourceValue?: string; italic?: boolean; noWrap?: boolean; children?: BandPart[] }
function spokenScript(source:string,slots:readonly LineValue[]=[]):SpokenScript {
  if(!source.includes('*'))return {text:source,italic:[]}
  const script:SpokenScript={text:'',italic:[]}
  const protectedValues=slots.length?slots.map(slot=>slot.value):[...source.matchAll(/(?:~?\/|[A-Za-z]:\/)[^\s,;!?]+/g)].map(match=>match[0])
  const protectedRanges:{start:number;end:number}[]=[]
  let offset=0
  for(const part of lineParts(source,protectedValues)){
    if(part.slot)protectedRanges.push({start:offset,end:offset+part.text.length})
    offset+=part.text.length
  }
  let opening=-1,at=0
  for(let i=0;i<source.length;i++){
    if(source[i]!=='*')continue
    const protectedRange=protectedRanges.find(range=>i>=range.start&&i<range.end)
    if(protectedRange){
      if(slots.length||opening<0||i!==protectedRange.end-1||source.slice(opening+1,i).includes('\n'))continue
      const lineEnd=source.indexOf('\n',i+1)
      const laterClose=[...source.matchAll(/\*/g)].some(match=>match.index!>i&&(lineEnd<0||match.index!<lineEnd)&&!protectedRanges.some(range=>match.index!>=range.start&&match.index!<range.end))
      if(laterClose)continue
    }
    if(opening>=0&&i>opening+1&&!source.slice(opening+1,i).includes('\n')){
      script.text+=source.slice(at,opening)
      const start=script.text.length
      script.text+=source.slice(opening+1,i)
      script.italic.push({start,end:script.text.length})
      at=i+1;opening=-1
    }else{
      opening=i
    }
  }
  script.text+=source.slice(at)
  return script
}
function fittedParts(text:string,slots:readonly LineValue[],fitted:readonly string[],original=text):BandPart[]{
  const sources=new Map<string,string[]>()
  for(const part of lineParts(original,slots.filter(slot=>slot.kind!=='label').map(slot=>slot.value))){
    if(!part.slot)continue
    const index=slots.findIndex(slot=>slot.kind!=='label'&&slot.value===part.text)
    const key=fitted[index]
    if(key===undefined)continue
    const queue=sources.get(key)??[]
    queue.push(part.text);sources.set(key,queue)
  }
  return lineParts(text,fitted.filter((_,i)=>slots[i]!.kind!=='label')).map(part=>{
    const sourceValue=part.slot?sources.get(part.text)?.shift():undefined
    return sourceValue===undefined?part:{...part,sourceValue}
  })
}
function spokenStyles(parts:BandPart[],script:SpokenScript):BandPart[]{
  if(!script.italic.length)return parts
  const source=script.text.replace(/\u00a0/g,' ')
  let at=0
  return parts.flatMap(part=>{
    if(part.slot&&part.sourceValue){
      const original=part.sourceValue.replace(/\u00a0/g,' '),start=source.indexOf(original,at)
      const italic=start>=0&&script.italic.some(range=>start>=range.start&&start+original.length<=range.end)
      if(start>=0)at=start+original.length
      return [{...part,italic}]
    }
    const out:BandPart[]=[]
    for(const char of part.text){
      const plain=char==='\u00a0'?' ':char
      const found=char==='…'&&source[at]!=='…'?-1:source.indexOf(plain,at)
      // The fitter's omission mark has no source position. It follows the style
      // of an unfinished stage direction without consuming the omitted words.
      const omitted=char==='…'&&found<0
      const position=omitted?at:found
      const italic=position>=0&&script.italic.some(range=>position>=range.start&&position<range.end)
      const last=out[out.length-1]
      if(last&&last.italic===italic)last.text+=char
      else out.push({...part,text:char,italic})
      if(found>=0)at=found+plain.length
    }
    return out
  })
}
// A stage direction is italic wherever the script has italics, as in his transcript heads (BAND F13).
function stageItalic(view:View):boolean {
  return !NO_ITALIC.has(view.lang)
}
function plain(aside: string): string {
  return aside.replace(/\*([^*\n]+)\*/g, '$1').replace(/^[（(]|[）)]$/g, '')
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

// Her picture: 64 px at rest, on a 34-column band too (her things give way on the floor first); 32 px in a one-row band,
// and on the narrowest bands, under 34 columns, where the floor would lose the context number beside 64 px.
export function desktopHeight(view: View, size: BandSize): number {
  return isRow(view, size) || floorNeedsSmallFigure(view, size) ? DESKTOP_COMPACT : DESKTOP_REST
}
// One row for the text column: the pixel band, "Smaller while working", or a screen too short for three rows.
function isRow(view: View, size: BandSize): boolean {
  return view.band === 'compact' || (size.isWorking && view.workSize === 'smaller') || size.maxRows < 4
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

// 24 columns, and a desktop band under 480 px, name a visitor by its short name (VISITORS.md 2.4): the stage direction opens with
// it, so a cut at its end never takes the name, and the wake line says it in the {visitor} place. Wider, the full words stand.
function narrowVisitor(view: View, narrow: boolean): View {
  if (!narrow || (!view.visit?.narrow && view.saidShort === undefined)) return view
  return { ...view, ...(view.visit?.narrow && view.stageDirection ? { stageDirection: view.visit.narrow } : {}), ...(view.saidShort !== undefined ? { said: view.saidShort } : {}) }
}

function stageAside(view: View): string {
  // Claudie and maid Claudie have no stage directions of Coco's (owner 10-17: in their form Coco's chatter is left unsaid)
  if (view.claudie) return ''
  const words=WORDS[view.lang]
  // the desktop band names the picture it draws, before any other words (owner 10-18: 「小字跟着画面走」)
  const direction=view.drawnAside ?? (view.stageDirection || view.costumeDirection || (view.mood==='waiting'&&view.line?.key.startsWith('guard.') ? words.aside.question : view.pose?.aside??words.aside[view.mood]))
  return stripStageMarkup(safeBandText(direction))
}

// What register.tsx does to a published view just before either band draws it, kept here so the web demo
// (tools/demo/web/engine.ts) draws the same. The commit line's squash follows the compaction (lane C, 10-14):
// pushed together while it runs, flat then round as it ends, inside the shell change's own redraws (1600 ms on
// the desktop, the terminal's cuts to 960 ms).
export function squashedView(drawn: View, now: number, terminal = false): View {
  const shed = drawn.shed
  if (shed?.phase === 'begin') return { ...drawn, squash: 'pushed' }
  if (shed?.phase === 'end' && now - shed.at < (terminal ? 960 : 1600)) return { ...drawn, squash: 'squash' }
  return drawn
}
// The night lamp (idle or asleep from 23:00 to 5:00, `hour` local; none before the clock is known) and the stage
// direction a costume brings; `word` reads the c3 words in the view's language. On the desktop a command left running
// past a minute is her coffee, not rain on a window (DECISIONS 1017).
// On the desktop only what her picture shows is named (owner 10-18: 「小字跟着画面走」, his screenshot of her typing under
// "holding her coffee"): her coffee picture names itself as a pose, she wears no glasses there, and the keycap clip is in
// her hand only while she takes it off (`clipOff`).
export function costumedView(local: View, hour: number | undefined, working: boolean, word: (key: string) => string, desktop = false, clipOff = false): View {
  const night = hour !== undefined && !working && (local.mood === 'idle' || local.mood === 'sleep') && (hour >= 23 || hour < 5)
  const c = local.costume
  const key = c?.bow && (!desktop || clipOff) ? 'aside.ultrathink' : c?.rain && !desktop ? 'aside.rain' : c?.glasses && !desktop ? 'aside.glasses' : night ? 'aside.night' : undefined
  const direction = key ? word(key).replace(/\*/g, '') : ''
  return night || direction ? { ...local, ...(night ? { night } : {}), ...(direction ? { costumeDirection: direction } : {}) } : local
}

// `png` is the frame's PNG for kitty and Ghostty, absent for half-block cells.
export function terminalBand(ui: Elements['terminal'], view: View, size: BandSize, png?: string, toolCells?: string): RenderElement {
  // At 24 columns a visitor's words outrank the right block: the row is his name and the direction, or the wake line, cut at its end.
  const visiting = size.columns <= 24 && !!view.visit?.narrow && !!view.stageDirection, wakeShort = size.columns <= 24 && view.saidShort !== undefined
  view = narrowVisitor(view, size.columns <= 24)
  const { Box, Text, Raster, Image, Button } = ui
  if (size.columns < 40 && view.line?.key.startsWith('stuck.')) { const { line: _note, ...rest } = view; view = rest as View }
  const words = WORDS[view.lang], aside = stageAside(view)
  const ansi = view.theme === 'light-ansi' || view.theme === 'dark-ansi'
  const sprite = terminalHasSprite(view, size)
  const rawSpoken = view.line?.text ?? view.said ?? undefined
  const bounded=safeBandSpeech(rawSpoken??'',view.line??{class:0,slots:[]},true)
  const display=displaySlots(bounded.text,bounded.fit.slots)
  const fit: BandLineFit = {...bounded.fit,slots:display.slots}
  const script=spokenScript(display.text,fit.slots)
  const spoken=rawSpoken===undefined?undefined:script.text
  // The terminal draws only Coco, so in Claudie's form it still writes Coco's name (owner 10-19: 「显示「小克」」)
  const name = words.name
  let text = spoken
  const slots=fit.slots??[]
  const unbroken=numericValues(slots,spoken,view.lang)
  const point=spoken!==undefined&&view.line?.key.startsWith('guard.')
    ? size.columns===24?guardClausePoint(spoken,slots):linePoint(view,spoken,fit):[]
  let fittedSlots=slots.map(s=>({...s}))
  const hasRibbon=view.ribbon?.visible===true
  const ribbon=hasRibbon?<Raster key="coco:ribbon" columns={1} rows={sprite?TERMINAL_ROWS:1} cells={ribbonTerminalCells(view.ribbon!.index,!(view.theme??'').startsWith('light'),sprite?TERMINAL_ROWS:1)}/>:null
  let showHelpers=(view.helpersCount??0)>0
  const helperText=view.helpersCountText??d1Word(view.lang,'helpers.count',{n:view.helpersCount??0},view.helpersCount??0)
  const stick = view.play?.stick, stickLit = !!stick && stick.endedAt === undefined
  // Focus: their eight cells and when it ends; at the narrowest only the time (lane C, 10-14).
  const focusCells = stick && stickLit ? focusBarText(focusDone(stick, view.play?.at ?? stick.startedAt)) : ''
  const stickTag = focusCells ? (size.columns <= 24 ? stick!.until : `${focusCells} ${stick!.until}`) : ''
  const breathing = view.play?.breath?.cell ?? ''
  const baseWidth = sprite ? (png ? imageColumns(TERMINAL_ROWS) : TERMINAL_COLUMNS) + 2 + (hasRibbon?1:0) : hasRibbon?1:0
  // Lifted, his picture, name and line move right together; his name and line keep 18 cells.
  const lift = sprite && view.play?.drag ? Math.max(0, Math.min(view.play.drag.dx, size.columns - baseWidth - 18)) : 0
  const pictureWidth = baseWidth + lift
  const lineButtons=fit.buttons??(fit.button?[fit.button]:[])
  let showButton=lineButtons.length>0
  const buttonWidth = () => showButton ? lineButtons.reduce((width,b)=>width+cells(b.label)+5,0) : 0
  const quotaItems = bandQuotaItems(view, false)
  let quotaGroups = terminalQuotaGroups(view, quotaItems)
  let neighbourGroups = neighbourQuotaGroups(view,true)
  // A line that already offers the book (the first hello) keeps the only book button.
  // An unknown context draws no box and no figure: the band never shows a placeholder character.
  // The commit line in cells and the tokens in k (lane C, 10-14); one commit while it is squashed.
  // A line sharing the row leaves the box its cells, as it left the old glyph; a name row of its own gives them up after
  // the stage direction and before the Book, and the reading itself stays (BAND 3.3).
  let dots = true
  const offeringShort = () => hasNumber(view.context) ? `${dots ? commitLineText(commitCount(view.context), view.squash !== undefined) + ' ' : ''}${contextValue(view)}` : ''
  const warming = view.cost?.cache.state === 'warm'
  // Warm terminal caches have no text yet. Keep their eligible marker so the
  // two lifetime boundaries can reveal cooling/cold without an idle poll.
  let cache = cacheTerminal(warming && view.cost ? { ...view.cost, cache: { ...view.cost.cache, state: 'cooling' } } : view.cost, view.lang)
  // One row with a line on it, 24 to 30 columns: the box steps aside for the line (0.2 SPEC rule 5c, lead's call 10-09).
  const boxAside = !sprite && text !== undefined && size.columns >= 24 && size.columns <= 30
  // Shiori's place ("task 3/7") stands before the offering and is the first thing the right block gives up.
  let showPlace = !!view.place?.short
  const placeText = view.place?.short ?? ''
  let word = offeringShort() !== '' && !boxAside, showRight = true, showBook = !lineButtons.some(b=>b.key==='coco:book:open'), showName = true, direction: string|undefined=aside
  if(boxAside){showHelpers=false;neighbourGroups=[];quotaGroups=[];cache='';showPlace=false}
  const showBox = offeringShort() !== '' && !boxAside
  const offeringWidth = () => (showBox ? cells(offeringShort()) + (word ? 1 + cells(words.context) : 0) : 0) + (showPlace ? cells(placeText) + (showBox ? 2 : 0) : 0)
  const fixedRightWidth = () => (showBox || showPlace ? offeringWidth() + 2 : 0) + (showBook ? 1 + cells(words.marks.shelf) : 0) + (breathing ? 2 : 0)
  let moreActions = view.moreActions ?? []
  const moreWidth = () => moreActions.reduce((width,b)=>width+cells(b.label)+5,0)
  const rightWidth = () => moreWidth() + fixedRightWidth() + (cache ? cells(cache) + 1 : 0) + (showHelpers?cells(helperText)+1:0) + (quotaGroups.length+neighbourGroups.length ? [...quotaGroups,...neighbourGroups].reduce((n,t)=>n+cells(t)+1,1) : 0)
  // The right block shares only the name row at rest; it never consumes the line below.
  const available = () => Math.max(0,size.columns-pictureWidth-buttonWidth()-(sprite?0:(showName?cells(name)+1:0)+(showRight?rightWidth():0)))
  const rows = () => sprite?3:1
  const nameWidth=()=>cells(name)+(direction?cells(gapBefore(direction,view.lang))+cells(direction):0)+(stickTag?cells(stickTag)+1:0)+(showRight?rightWidth():0)
  const fits = () => text===undefined?nameWidth()<=size.columns-pictureWidth:point.every(value=>text!.includes(value))&&terminalWrapRows(text,available(),unbroken)<=rows()
  // Visual review row 1 / G2: neighbours, context, own quota, then identified values.
  // The cue row alone (no line) gives up in its own order below; a line has the order of 0.2 SPEC rule 5.
  if(!fits())showPlace=false
  if(sprite&&text!==undefined&&!fits())direction=undefined
  if(text!==undefined&&!fits())showHelpers=false
  if (text!==undefined&&!fits()) cache=''
  if (!sprite&&text!==undefined&&!fits()) neighbourGroups=[]
  if (!sprite&&text!==undefined&&!fits()) word = false
  if (!sprite&&text!==undefined&&!fits()) quotaGroups=[]
  if (!sprite&&!fits()) moreActions=[]
  if (!fits() && text !== undefined){
    const values=shrinkSlots(slots,values=>{text=slots.reduce((line,slot,i)=>line.replace(slot.value,values[i]!),spoken!)},fits)
    fittedSlots=slots.map((slot,i)=>({...slot,value:values[i]!}))
  }
  if (!sprite&&!fits() && ((fit.class??0)>=2 || wakeShort)) showRight=false
  if (!sprite&&text!==undefined&&!fits()) showName=false
  if(showButton&&size.columns-pictureWidth-(sprite?0:cells(name)+1+(showRight?rightWidth():0))<buttonWidth())showButton=false
  if (!fits() && text !== undefined) text=cutTerminalLine(text,available(),rows(),unbroken,fittedSlots.filter(slot=>slot.kind==='path'||slot.kind==='test').map(slot=>slot.value),point)
  // When the warning's first clause surrounds its object, removing that path
  // leaves a grammatical hole. At the cell floor, omit the whole warning.
  const missingGuardObject=size.columns===24&&view.line?.key.startsWith('guard.')&&point.length>1
    &&fittedSlots.some(slot=>slot.kind==='path')&&!fittedSlots.some(slot=>slot.kind==='path'&&text?.includes(slot.value))
  if(text!==undefined&&(!text.replace(/[\s\p{P}]/gu,'')||singleCjkFragment(text,spoken??'')||!point.every(value=>text!.includes(value))||missingGuardObject||terminalWrapRows(text,available(),unbroken)>rows()))text=''
  // The name went before his words were cut; if the line is left out after all, he stands there by his name alone.
  if(text==='')showName=true
  if(sprite||text===undefined){
    const nameFits=()=>nameWidth()<=size.columns-pictureWidth
    // The cue row gives up, in this order: Shiori's place, the cost and 7-day groups, helpers, the cache,
    // neighbours, the word "context", the 5-hour group, the stage direction, then the commit line's cells (the direction
    // taking back what they free). Name, the reading and Book stay (BAND 3.3, F8).
    if(!nameFits())showPlace=false
    if(!nameFits())quotaGroups=quotaGroups.slice(0,1)
    if(!nameFits())showHelpers=false
    if(!nameFits())cache=''
    if(!nameFits())neighbourGroups=[]
    if(!nameFits())word=false
    if(!nameFits())quotaGroups=[]
    if(!nameFits())moreActions=[]
    const cutDirection=()=>cutTerminalDirection(aside,Math.max(0,size.columns-pictureWidth-cells(name)-cells(gapBefore(aside,view.lang))-(visiting?0:rightWidth())),view.lang,visiting)
    if(!nameFits())direction=cutDirection()
    if(!nameFits()){dots=false;direction=cutDirection()}
    // Fixed widgets also yield whole when the name row cannot hold them.
    if(!nameFits())showBook=false
    if(!nameFits())showRight=false
    if(visiting&&text===undefined)showRight=false
  }
  const parts=noBreakValues(spokenStyles(fittedParts(text??'',slots,fittedSlots.map(slot=>slot.value),script.text),script),fittedSlots,view.lang)
  const line = text === undefined ? null : <Box flexDirection="row" flexWrap={sprite?'wrap':'nowrap'} alignItems="flex-end" columnGap={1}>
    {text?<Box flexShrink={1} minWidth={0}><Text wrap={sprite?'wrap':'truncate-end'}>{!sprite&&showName?gapBefore(text):''}{parts.map(p=>p.children?<Text wrap="truncate-end">{p.children.map(c=><Text bold={c.slot||undefined} italic={c.italic||undefined} wrap={c.noWrap?'truncate-end':undefined}>{c.text}</Text>)}</Text>:p.slot||p.noWrap||p.italic?<Text bold={p.slot||undefined} italic={p.italic||undefined} wrap={p.noWrap?'truncate-end':undefined}>{p.text}</Text>:p.text)}</Text></Box>:null}
    {showButton?lineButtons.map(b=><Box flexShrink={0}><Button key={b.key} label={b.label} onPress={()=>{}}/></Box>):null}
  </Box>
  const offering = showRight&&(showBox||showPlace) ? <Box marginLeft={2} flexShrink={0} columnGap={showPlace&&showBox?2:0}>{showPlace?<Text color="inactive">{placeText}</Text>:null}{showBox?<Text color={hasNumber(view.context)?tone(view.context):'inactive'}>{`${offeringShort()}${word?' '+words.context:''}`}</Text>:null}</Box> : null
  const cacheNode = showRight&&cache ? <Box key="coco:cache:terminal" marginLeft={warming?0:1} flexShrink={0}>{warming?null:<Text color="inactive">{cache}</Text>}</Box> : null
  const ownItems = quotaItems.slice(0, quotaGroups.length), plainGroups = quotaItems.length ? [] : quotaGroups
  const quota = showRight&&quotaGroups.length+neighbourGroups.length>0 ? <Box flexDirection="row" columnGap={1} marginLeft={1} flexShrink={0}>{ownItems.map(item=><Box key={'coco:quota:'+item.kind} flexDirection="row" flexShrink={0}><Text color="inactive">{item.label+' '}</Text><Text color={meterColor(item)}>{item.meter}</Text><Text color={item.flag?'claude':'inactive'}>{' '+item.tail}</Text></Box>)}{[...plainGroups,...neighbourGroups].map(t=><Text color="inactive">{t.startsWith('● ')?<Text color="warning">●</Text>:null}{t.startsWith('● ')?t.slice(1):t}</Text>)}</Box> : null
  const book=showRight&&showBook?<Box marginLeft={1} flexShrink={0}><Button key="coco:book:open" label={words.marks.shelf} plain onPress={()=>{}}/></Box>:null
  const nameNode=name&&showName?<Box flexShrink={0}><Text color={view.cue} bold>{name}</Text></Box>:null
  const moreButtons=(showRight?moreActions:[]).map(b=><Box marginLeft={1} flexShrink={0}><Button key={b.key} label={b.label} plain onPress={()=>{}}/></Box>)
  const row=<Box flexDirection="row"><Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>{nameNode}{!sprite&&text!==undefined?line:direction?<Text color="inactive" italic={stageItalic(view)||undefined} wrap="truncate-end">{`${gapBefore(direction,view.lang)}${direction}`}</Text>:null}</Box>{stickTag?<Box marginLeft={1} flexShrink={0}>{stickTag.startsWith(focusCells)?[<Text color="claude">{focusCells}</Text>,<Text color="inactive">{stickTag.slice(focusCells.length)}</Text>]:<Text color="inactive">{stickTag}</Text>}</Box>:null}{showRight&&showHelpers?<Box marginLeft={1} flexShrink={0}><Text color="inactive">{helperText}</Text></Box>:null}{showRight&&breathing?<Box marginLeft={1} flexShrink={0}><Text color="inactive">{breathing}</Text></Box>:null}{offering}{cacheNode}{quota}{moreButtons}{book}</Box>
  if(!sprite)return ribbon?<Box flexDirection="row">{ribbon}<Box flexGrow={1} flexShrink={1} minWidth={0}>{row}</Box></Box>:row
  const picture=png?<Image key="sprite" source={{png}} columns={imageColumns(TERMINAL_ROWS)} rows={TERMINAL_ROWS} alt={`${words.name} ${aside}${view.visit?.label&&!view.stageDirection?` ${view.visit.label}`:''}`}/>:<Raster key="sprite" columns={TERMINAL_COLUMNS} rows={TERMINAL_ROWS} cells={toolCells??spriteCells(view.frame,view.colors)}/>
  return <Box flexDirection="row" alignItems="flex-end">{ribbon}{lift?<Box marginLeft={lift} flexShrink={0}>{picture}</Box>:picture}<Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} marginLeft={2}>{row}{line}</Box></Box>
}

// `leading` keeps whatever opens the direction when it fits at all, even one word or one character: a visitor's short name leads it.
export function cutTerminalDirection(text:string,width:number,lang:string,leading=false):string|undefined {
  if(cells(text)<=width)return text
  if(!leading&&['zh','zh-Hant','ja'].includes(lang))return undefined
  const opening=/^[(*（]/u.test(text)?text[0]!:'',closing=/[)*）]$/u.test(text)?text.slice(-1):''
  const body=text.slice(opening.length,closing?text.length-closing.length:undefined)
  let kept='',used=cells(opening+'…'+closing)
  const units=['zh','zh-Hant','ja'].includes(lang)?[...body]:body.split(' ')
  for(const unit of units){const gap=kept&&!['zh','zh-Hant','ja'].includes(lang)?' ':'';const n=cells(gap+unit);if(used+n>width)break;used+=n;kept+=gap+unit}
  kept=kept.trimEnd()
  return leading?(kept?opening+kept+'…'+closing:undefined):kept.split(/\s+/u).length>=2?opening+kept+'…'+closing:undefined
}

export function terminalWrapRows(text: string, width: number, unbroken:readonly string[]=[]): number {
  let rows=1, used=0
  for(const unit of lineUnits(text,unbroken)) {
    if(unit==='\n'){rows++;used=0;continue}
    const n=cells(unit)
    if(n>width&&unit.trim())return Infinity
    if(used+n>width){rows++;used=unit.trim()?n:0}else used+=n
  }
  return rows
}
function withoutLeadingPause(text:string,identified:readonly string[]=[]):string {
  const first=lineParts(text,identified)[0]
  return first&&!first.slot&&/^…(?=[\p{L}\p{N}])/u.test(first.text)?text.slice(1):text
}
function omittedPrefix(text:string,identified:readonly string[]=[]):string {
  text=withoutLeadingPause(text,identified)
  let offset=0,pause=-1
  for(const part of lineParts(text,identified)){
    if(!part.slot&&part.text.includes('…')){pause=offset+part.text.indexOf('…');break}
    offset+=part.text.length
  }
  const kept=lineParts((pause<0?text:text.slice(0,pause)).trimEnd(),identified)
  const last=kept[kept.length-1]
  if(last&&!last.slot)last.text=last.text.replace(/[.。।!?！？:：]+$/u,'')
  return kept.map(part=>part.text).join('')+'…'
}
function cutTerminalLine(text: string,width: number,rows: number,unbroken:readonly string[]=[],identified:readonly string[]=[],required:readonly string[]=[]): string {
  if(width<1)return ''
  text=withoutLeadingPause(text,identified)
  const fits=(candidate:string)=>required.every(value=>candidate.includes(value))&&terminalWrapRows(candidate,width,unbroken)<=rows
  const numeric=cutNumericLine(text,[...unbroken,...identified,...required],fits,unbroken,!identified.some(value=>unbroken.includes(value)),{width,rows,measure:cells,unbroken},required,identified)
  if(numeric!==undefined){
    if(required.length&&identified.length&&!fits(numeric))return cutNumericLine(text,[...unbroken,...required],fits,unbroken,true,{width,rows,measure:cells,unbroken},required,identified)??numeric
    return numeric
  }
  let kept=fitLinePrefix(text,width,rows,unbroken,cells)
  if(!kept.trim()&&!/\p{Script=Hangul}/u.test(text)&&!unbroken.includes(lineUnits(text,unbroken).find(unit=>unit.trim())??'')){
    if(graphemes===undefined)graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter():null
    const parts=graphemes?Array.from(graphemes.segment(text),part=>part.segment):[...text]
    let used=cells('…'),end=0
    for(const part of parts){const n=cells(part);if(used+n>width)break;used+=n;end+=part.length}
    kept=text.slice(0,end)
  }
  return omittedPrefix(kept,identified)
}

function numericValue(slot:LineValue):boolean{
  return slot.kind==='value'&&/\p{N}/u.test(slot.value)
}
function numericValues(slots:LineValue[],text?:string,lang?:string):string[]{
  return slots.filter(numericValue).map(slot=>{
    if(lang!=='ko'||!text)return slot.value
    const at=text.indexOf(slot.value),tail=at<0?'':text.slice(at+slot.value.length)
    return slot.value+(/^[\p{Script=Hangul}]+[.!?。]?/u.exec(tail)?.[0]??'')
  })
}
function noBreakValues(parts:BandPart[],slots:LineValue[],lang?:string):BandPart[]{
  const numbers=numericValues(slots)
  const rendered=parts.map(part=>part.slot&&numbers.includes(part.text)
    ? {...part,text:part.text.replace(/ /g,'\u00a0'),noWrap:true}:part).flatMap(part=>lang==='ko'&&!('noWrap' in part&&part.noWrap)?lineUnits(part.text).map(text=>({...part,text,noWrap:/\p{Script=Hangul}/u.test(text)||undefined})):part)
  if(lang!=='ko')return bindCjkTail(rendered)
  const grouped:BandPart[]=[]
  for(let i=0;i<rendered.length;i++){
    const part=rendered[i]!,tail=rendered[i+1]
    if(part.slot&&part.noWrap&&tail&&!tail.slot&&/^[\p{Script=Hangul}]/u.test(tail.text)){
      grouped.push({text:part.text+tail.text,slot:false,noWrap:true,children:[part,tail]});i++
    }else grouped.push(part)
  }
  return grouped
}
function bandSessionMoney(view:View):boolean {
  return !!view.cost&&(view.cost.billing.kind==='api'||view.cost.billing.kind==='gateway')&&!view.cost.billing.organisation&&!view.cost.billing.otherMaker
}
function bandMoney(view:View,usd:number):string {
  return fill(WORDS[view.lang].quota.api,{usd:costDollars(usd,view.lang,view.cost?.sessionEstimated)})
}
function singleCjkFragment(text:string,source:string):boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)&&[...text.matchAll(/[\p{L}\p{N}]/gu)].length===1&&[...source.matchAll(/[\p{L}\p{N}]/gu)].length>1
}
function cjkTailStart(text:string):number {
  const tail=/[\p{L}\p{N}]\p{M}*[\s\p{P}]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]\p{M}*[\s\p{P}]*$/u.exec(text)
  if(!tail)return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]\p{M}*[\s\p{P}]*$/u.exec(text)?.index??-1
  let start=tail.index
  if(!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(tail[0]))
    start-=text.slice(0,start).match(/[^\s\p{P}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u)?.[0].length??0
  return start
}
function bindCjkTail(parts:BandPart[]):BandPart[]{
  const start=cjkTailStart(parts.map(part=>part.text).join(''))
  if(start<0)return parts
  const before:BandPart[]=[],tail:BandPart[]=[]
  let at=0
  for(const part of parts){
    const end=at+part.text.length
    if(end<=start)before.push(part)
    else if(at<start&&!part.noWrap&&!part.children){
      before.push({...part,text:part.text.slice(0,start-at)})
      tail.push({...part,text:part.text.slice(start-at)})
    }else tail.push(part)
    at=end
  }
  return [...before,{text:tail.map(part=>part.text).join(''),noWrap:true,children:tail}]
}
function bandQuotaGroups(view:View,narrow:boolean):string[] {
  const hideCost=!bandSessionMoney(view)
  const groups=quotaDetailGroups(view.lang,view.quota?.rateLimits??[],view.quota?.tokens,hideCost?undefined:view.quota?.costUSD,narrow,view.quota?.at)
  // A dollar figure that cannot be qualified is not asked for, so it has no group; an unknown one never has a group (BAND F1).
  if(!hideCost&&view.quota?.costUSD!==undefined&&groups.length)groups[groups.length-1]=groups[groups.length-1]!.replace(
    quotaMoney(view.lang,view.quota.costUSD,(view.quota.rateLimits??[]).length>0),bandMoney(view,view.quota.costUSD))
  const separator=WORDS[view.lang].quota.separator
  for(const detail of view.paceDetails??[]){const at=(view.quota?.rateLimits??[]).filter(w=>w.kind in WORDS[view.lang].quota.kinds).findIndex(w=>w.kind===detail.kind);if(at>=0&&groups[at]){const [used,...reset]=groups[at]!.split(separator);groups[at]=used+separator+(narrow?detail.narrow:detail.wide)+(reset.length?separator+reset.join(separator):'')}}
  return groups
}
// The hover's fullest form (lane C, 10-14): each window's words, then what its readings predict in the compact form.
// A hot window already says when it runs out, so it adds only the even share left.
function bandForecastGroups(view:View):string[] {
  const groups=bandQuotaGroups(view,false),now=view.quota?.at,separator=WORDS[view.lang].quota.separator
  if(now===undefined)return groups
  const windows=(view.quota?.rateLimits??[]).filter(w=>w.kind in WORDS[view.lang].quota.kinds&&hasNumber(w.percentUsed))
  return groups.map((text,i)=>{
    const window=windows[i];if(!window)return text
    const hot=!!view.hotWindows?.includes(window.kind),forecast=quotaForecast(window,now,view.paceRates?.[window.kind],hot)
    if(!forecast)return text
    const extra=quotaForecastText(view.lang,hot?{kind:forecast.kind,used:forecast.used,...(forecast.allowance?{allowance:forecast.allowance}:{})}:forecast,now,view.quotaTimeZone,true)
    return extra?text+separator+extra:text
  })
}
// The terminal's plain row (owner 10-14: 「终端要改……更直白的5h/week limit之类」): the short name, four cells, then what
// is left, or the flag. The dollar figure stays as it was where no window is reported.
function terminalQuotaGroups(view:View,items:QuotaBandItem[]):string[] {
  return items.length?items.map(item=>item.label+' '+item.meter+' '+item.tail):bandQuotaGroups(view,true)
}
function meterColor(item:QuotaBandItem):'suggestion'|'claude'|'inactive' {
  return item.tone==='calm'?'suggestion':item.tone==='out'?'inactive':'claude'
}


export const LANTERN=contrastSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 14" width="12" height="17"><style>.lr{fill:#5B3A2A}@media(prefers-color-scheme:dark){.lr{fill:#B98B6F}}</style><path d="M5 0v2.2" stroke="#8A7B70" stroke-width=".8"/><ellipse cx="5" cy="7.6" rx="4" ry="4.4" fill="#F3A64C" stroke="#C46A1E" stroke-width=".7"/><ellipse cx="5" cy="7.6" rx="2.3" ry="3.1" fill="#FFD98A"/><path d="M1.4 6.2h7.2M1.2 8.9h7.6" stroke="#D9853A" stroke-width=".6"/><rect class="lr" x="2.6" y="2.3" width="4.8" height="1.4" rx=".5"/><rect class="lr" x="2.6" y="11.6" width="4.8" height="1.4" rx=".5"/></svg>')
export const HAIRLINE=contrastSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="16"><style>path{stroke:#D6D1C7}@media(prefers-color-scheme:dark){path{stroke:#45433E}}</style><path d="M.5 0v16"/></svg>','path{stroke:#8A847A}','path{stroke:#8E8B85}')
function spentDetails(view:View):{kind:string;time:string}[] {
 const remembered=view.spentResets
 return (view.spentWindows??[]).map(kind=>{const reset=remembered?.[kind]??view.quota?.rateLimits.find(w=>w.kind===kind)?.resetsAt;return {kind,time:momentText(reset,view.quota?.at??0,view.lang,view.quotaTimeZone)}})
}
function neighboursOf(view:View){return view.neighbours&&view.neighbourLights?.running?view.neighbourLights.agents.slice(0,32).map(agent=>({...agent,label:untrustedDisplaySlot(agent.label)})):[]}
function neighbourWindows(agent:NonNullable<View['neighbourLights']>['agents'][number]){return [agent.quota?.primary,agent.quota?.secondary].flatMap((window,index)=>hasNumber(window?.usedPercent)?[{kind:index?'seven_day':'five_hour',percentUsed:window!.usedPercent!,resetsAt:hasNumber(window?.resetsAt)?new Date(window!.resetsAt!<1e12?window!.resetsAt!*1000:window!.resetsAt!).toISOString():undefined}]:[])}
function neighbourQuotaGroups(view:View,narrow:boolean,terminal=true):string[]{return neighboursOf(view).flatMap(agent=>[...(terminal&&agent.busy&&!agent.partial?['● '+agent.label]:[]),...(neighbourWindows(agent).length?[agent.label+' '+quotaDetailGroups(view.lang,neighbourWindows(agent),undefined,undefined,narrow,view.quota?.at).join('; ')]:[])])}
// A neighbour at work is a small lit desk lamp (lane C, 10-14: outside_page.py lamp); neighbours' quotas stay in the
// hover and on the quota page.
const LAMP_ROWS=['..OOO..','.OYYYO.','OYyyyYO','OOOOOOO','...O...','...O...','..OOO..']
export const LAMP=contrastSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges"><style>${PIXEL_EDGE_STYLE}</style>${pixelRuns(LAMP_ROWS,0,0,{O:'#5C2A1E',Y:'#FFF6C9',y:'#F7D768'})}</svg>`)
function busyNeighbours(view:View){return neighboursOf(view).filter(a=>a.busy&&!a.partial).sort((a,b)=>(b.startedAt??0)-(a.startedAt??0)).slice(0,3)}
function neighbourWidth(view:View):number{const busy=busyNeighbours(view);return busy.length?COLUMN_PX*2+1+busy.length*(14+COLUMN_PX):0}
function desktopNeighbours(ui:Elements['desktop'],view:View):RenderElement|null{const {Box,Svg}=ui,busy=busyNeighbours(view);return busy.length?<Box key="coco:neighbours" flexDirection="row" alignItems="center" columnGap={1} marginLeft={1} flexShrink={0}><Svg source={HAIRLINE} alt="" width={1} height={16}/>{busy.map(a=><Box key={'lamp:'+a.id} flexShrink={0}><Svg source={LAMP} alt={fill(view.neighbourBusyLabel??'{agent}',{agent:a.label})} width={14} height={14}/></Box>)}</Box>:null}

type HelperMode='full'|'bundle'|'none'
function bandHelpers(view:View){return (view.helpers??[]).filter(h=>h.state==='running'||h.leavingAt!==undefined).sort((a,b)=>a.at-b.at||(a.arrivalAt??a.at)-(b.arrivalAt??b.at)||a.id.localeCompare(b.id))}
// Helpers are paper planes (lane C, 10-14): up to four, or three and the stack that stands for the rest.
function helperWidth(view:View,mode:HelperMode):number{const n=bandHelpers(view).length;if(!n||mode==='none')return 0;return (mode==='bundle'?PLANES_PX.width:n>=5?3*PLANE_PX.width+PLANES_PX.width:n*PLANE_PX.width)+COLUMN_PX}
function desktopHelpers(ui:Elements['desktop'],view:View,mode:HelperMode):RenderElement|null {
  const {Box,Svg}=ui,all=bandHelpers(view)
  if(!all.length || mode==='none')return null
  const bundle=mode==='bundle'||all.length>=5,shown=mode==='bundle'?[]:all.slice(0,bundle?3:4)
  const represented=mode==='bundle'?all:all.slice(3),bundleHelper=represented.find(h=>h.state==='running')??represented[0]
  const alt=view.helpersAlt??d1Word(view.lang,'helpers.alt',{n:view.helpersCount??0},view.helpersCount??0)
  const options=(h:typeof all[number])=>({reduced:view.d1ReducedMotion, ...(h.leavingAt===undefined?{arrivalDelay:Math.max(0,(h.arrivalAt??h.at)-h.at),elapsed:h.elapsed??0}:{leave:h.state==='done'?'done' as const:'failed' as const,elapsed:Math.max(0,(h.elapsed??0)-(h.leavingAt-h.at))})})
  return <Box key="coco:helpers" flexDirection="row" alignItems="flex-end" flexShrink={0}>{shown.map((helper,i)=><Box key={`coco:helper:${helper.id}`} flexShrink={0}><Svg source={planeSvg(options(helper))} alt={i===0?alt:''} width={PLANE_PX.width} height={PLANE_PX.height}/></Box>)}{bundle?<Box key="coco:helper:bundle" flexShrink={0}><Svg source={planeSvg(options(bundleHelper!),true)} alt={shown.length?'':alt} width={PLANES_PX.width} height={PLANES_PX.height}/></Box>:null}</Box>
}
// ---------------------------------------------------------------- desktop

// The offering box picture in px.
// What the stick and the breathing light add to the right block.
function playWidth(view: View, compact: boolean): number {
  return (view.play?.stick ? FOCUS_PX.width + (view.play.stick.endedAt === undefined ? COLUMN_PX + planPx(view.play.stick.until) : 0) + COLUMN_PX : 0) + (view.play?.breath !== undefined ? LIGHT_PX.width + COLUMN_PX : 0)
}

// Desktop geometry stays fixed. The planner reserves the name plus two line rows at rest;
// compact speech uses the name row. Only safety/action lines may remove the right block.
export type DesktopPlan = {
  height: number // his picture's height: DESKTOP_REST, DESKTOP_COMPACT, or 0 for none
  row: boolean // one row while working/compact, or the narrowest fallback with speech below
  word: boolean // the word "context" after the percentage
  aside: 'beside' | 'none' // whether the stage direction stands on the cue line (a line he says replaces it in a row)
  text: string | undefined // the stage direction, cut to fit when needed; or, in a row, his line, whole
  rest?: string // a visitor's direction in a narrow band continues here, on the empty row below his name, and ends in an ellipsis
  label: string // the book button's label: whole, or its one word
  name: string | undefined // his name; left out only when even his small picture needs the room
  frame: number // which frame (0: everything whole)
  place: number // which place within it (0: everything beside his name, and the word)
  speech?: string // fitted into the fixed text column; never a new band row
  speechRows?: number // how many of the text column's rows his resting line takes (the hover's Close stands on a free one)
  speechWidth?: number // that line's width on one row, in px
  showRight?: boolean
  lineRows?: number
  textWidth?: number
  buttonWidth?: number
  showButton?: boolean
  parts?: BandPart[]
  neighbours?: boolean
  cup?: boolean
  helpers?: 'full'|'bundle'|'none'
  quota?: QuotaMode
  cells?: false // the commit line's cells left out, the reading kept: on the one-row band so his name can come back, on the cue line at the 24-column floor
  rightGap?: number
  marker?: boolean // Shiori's place stands in the right block, before the offering
  number?: false // the floor's context number left out, its last step but the pictures' (DECISIONS 1017)
  bagWord?: false // the bag's word left out; its 👜 and its size stay
  play?: false // focus and breathing left off the floor
  pad?: false // the floor's blocks without their padding
}

// An unknown context draws no figure and no word: the band never shows a placeholder character (BAND F1).
// The conversation in k tokens where the engine counted them (owner 10-14: 「把对话从百分比改成多少多少k」), else its percent.
function contextValue(view: View): string {
  return hasNumber(view.contextTokens) ? contextTokensText(view.contextTokens, view.lang, view.estimate) : percentText(view.context, view.lang, view.estimate)
}
// Each cue state asks for the label again, and a number's formatting is the costly part of planning, so the few labels a
// session shows are kept by what they say.
const offeringLabels = new Map<string, string>()
function offeringLabel(view: View, word: boolean): string {
  if (!hasNumber(view.context)) return ''
  const key = `${view.lang}|${view.context}|${view.contextTokens ?? ''}|${view.estimate}|${word}`
  let label = offeringLabels.get(key)
  if (label === undefined) {
    label = ` ${contextValue(view)}${word ? ` ${WORDS[view.lang].context}` : ''}`
    if (offeringLabels.size >= 32) offeringLabels.clear()
    offeringLabels.set(key, label)
  }
  return label
}
// CoreText system 13 px advances. The whole 0..100% and ~0..100% labels
// stayed below the summed regular advances rounded up plus 1 px (202 cases).
// This calibrates the planner; actual desktop geometry still needs its own check.
const HEADER_ADVANCE:Readonly<Record<string,number>>={
  ' ':3.580078125,'0':8.1123046875,'1':5.9541015625,'2':7.76953125,'3':8.07421875,
  '4':8.2900390625,'5':7.9599609375,'6':8.201171875,'7':7.3251953125,'8':8.2265625,
  '9':8.201171875,'.':3.783203125,',':3.783203125,'%':11.95263671875,'~':8.1123046875,'—':11.2861328125,
}
function offeringWidth(view:View,word:boolean):number {
  const label=offeringLabel(view,word)
  return !word&&/^ (?:~?[0-9.,]+%|—)$/u.test(label)?Math.ceil([...label].reduce((sum,c)=>sum+HEADER_ADVANCE[c]!,0))+1:planPx(label)
}
function speakerWidth(name:string):number {
  // Rounded bold advances plus 1 px for the three measured name strings; Coco, シャオコー and 코코 use planPx.
  return ({'クロードさま':76,'클로디':35,'小克':27} as Record<string,number>)[name]??planPx(name,true)
}

// ---------------------------------------------------------------- the cue line (BAND 3.2)
// His name, the stage direction and his props (helpers, the box, the incense, neighbours, the Book
// button) share the first row of the text column; his line stands under it. The props are never hidden at rest.

const INSET = 2 * COLUMN_PX // band.inset: the right edge keeps two columns
const CUE_GAP = 2 * COLUMN_PX // gap.cue: at least two columns between the cue's words and his props
const BUTTON_PAD = 22 // a native Button's horizontal padding, as the hover widths count it

// The quota pictures give way in steps on a narrow band: their short names go, then they draw at one CSS px a pixel, and on
// the narrowest (the owner's own band is 34 columns) they stand one above the other while the commit line steps aside.
type QuotaMode = 'full' | 'bare' | 'small' | 'stack'
type CueState = { cup: boolean; word: boolean; aside: 'whole' | 'cut' | 'none'; label: 'book' | 'shelf'; helpers: HelperMode; neighbours: boolean; quota: QuotaMode; name: boolean; cells?: false; number?: false; bagWord?: false; play?: false; pad?: false }
type CuePlan = { height: number; state: CueState; text: string | undefined; rest?: string; index: number; frame: number; column: number; props: number }

// Every cue state measures the right block, so the items are kept for the readings they were made from.
const quotaItemsMemo = new Map<string, QuotaBandItem[]>()
function bandQuotaItems(view: View, pictures = true): QuotaBandItem[] {
  const key = JSON.stringify([view.lang, view.quota?.rateLimits, view.quota?.at, view.spentWindows, view.spentResets, view.paceDetails, view.hotWindows, view.quotaTimeZone, view.play?.wait?.time, pictures])
  let items = quotaItemsMemo.get(key)
  if (!items) {
    // While Claude Code waits at a limit, a window at 100% waits under the bolt too, and a spent window with no reset time
    // takes the time Claude Code said it carries on at.
    const waitTime = view.play?.wait?.time, known = spentDetails(view)
    const waiting = waitTime ? (view.quota?.rateLimits ?? []).filter(w => hasNumber(w.percentUsed) && w.percentUsed >= 100 && !known.some(s => s.kind === w.kind)).map(w => ({ kind: w.kind, time: waitTime })) : []
    const spent = [...known.map(s => !/\d/.test(s.time) && waitTime ? { ...s, time: waitTime } : s), ...waiting]
    items = quotaBandItems(view.lang, (view.quota?.rateLimits ?? []).filter(w => hasNumber(w.percentUsed)), { spent, pace: view.paceDetails?.filter(p => view.hotWindows?.includes(p.kind)) }, pictures)
    if (quotaItemsMemo.size >= 4) quotaItemsMemo.clear()
    quotaItemsMemo.set(key, items)
  }
  return items
}
function quotaItemWidth(item: QuotaBandItem, mode: QuotaMode): number {
  return (mode === 'full' ? planPx(item.label) + COLUMN_PX : 0) + QUOTA_PICTURE_PX[item.kind] / (mode === 'small' || mode === 'stack' ? 2 : 1) + (item.flag ? COLUMN_PX + planPx(item.flag) : 0)
}
function incenseWidth(view: View, mode: QuotaMode = 'full'): number {
  const items = bandQuotaItems(view, false)
  const quota = items.length ? (mode === 'stack' ? Math.max(...items.map(item => quotaItemWidth(item, mode))) : items.reduce((sum, item, i) => sum + quotaItemWidth(item, mode) + (i ? COLUMN_PX : 0), 0)) + COLUMN_PX
    : view.quota?.costUSD !== undefined && bandSessionMoney(view) ? planPx(bandMoney(view, view.quota.costUSD)) + COLUMN_PX : 0
  return quota + playWidth(view, view.band === 'compact')
}
// Without a reading the desktop keeps the line's place (C2), empty and as narrow as one commit, with its 'no reading' alt.
const commitFit = (view: View, draw: CommitDraw): boolean => draw === 'fit' || draw === 'row' || !hasNumber(view.context)
// The commit line: all five slots, only the commits there are ('fit'), those at one CSS px a pixel on the one-row band
// ('row'), or none beside stacked quota pictures.
type CommitDraw = 'line' | 'fit' | 'row' | 'none'
const commitScale = (draw: CommitDraw): number => draw === 'row' ? 1 : 1.5
function boxWidth(view: View, word: boolean, draw: CommitDraw = 'line'): number {
  return (draw !== 'none' ? commitLineWidth(commitCount(view.context), commitFit(view, draw), view.squash, commitScale(draw)) : 0) + Math.max(offeringWidth(view, word), planPx(offeringLabel(view, word)))
}
function bookWidth(label: string): number {
  return COLUMN_PX + planPx(label) + BUTTON_PAD
}
function cueProps(view: View, s: Pick<CueState, 'word' | 'label' | 'helpers' | 'neighbours'> & { cup?: boolean; quota?: QuotaMode; cells?: false }): number {
  const words = WORDS[view.lang]
  return (s.cup ? 16 + COLUMN_PX : 0) + helperWidth(view, s.helpers) + boxWidth(view, s.word, s.cells === false ? 'none' : s.quota === 'small' ? 'fit' : s.quota === 'stack' && bandQuotaItems(view, false).length ? 'none' : 'line') + incenseWidth(view, s.quota ?? 'full') + (s.neighbours ? neighbourWidth(view) : 0) + bookWidth(s.label === 'book' ? words.marks.book : words.marks.shelf)
}
// The text column's width: the band, less the picture and the right inset.
function cueColumn(view: View, size: BandSize, height: number): number {
  const left = 12 + getMotionWidth(height, view.band === 'compact') + COLUMN_PX
  return Math.max(0, size.columns * COLUMN_PX - INSET - left)
}
// What the cue line gives up as the band narrows, in this order (BAND 3.2): the word "context", the stage
// direction (cut to two words or more, then gone), the Book label to its one word, helpers to a bundle and then gone,
// neighbours. The picture shrinks and his name goes after these, never the percentage, the incense or the Book button.
function cueStates(view: View, said: boolean): CueState[] {
  const words = WORDS[view.lang]
  const helpers: HelperMode = helperWidth(view, 'full') > 0 ? 'full' : 'none'
  const first: CueState = { cup: cupShown(view.cost), word: hasNumber(view.context), aside: 'whole', label: 'book', helpers, neighbours: neighbourWidth(view) > 0, quota: 'full', name: true }
  const out = [first]
  const step = (patch: Partial<CueState>) => { out.push({ ...out[out.length - 1]!, ...patch }) }
  // The cup yields before any other decision changes: it is drawn only where the first state fits beside the direction.
  if (first.cup) step({ cup: false })
  if (first.word) step({ word: false })
  step({ aside: 'cut' })
  // Under 480 px a visitor's direction leads with its short name and must keep it (VISITORS 2.4, V14): the Book
  // label takes its one word before that direction goes.
  const visiting = !!view.visit?.narrow && view.stageDirection === view.visit.narrow
  // Their battery and power bank (lane C, 10-14) give way in three steps: their short names, then one CSS px a pixel, then
  // stacked. They come after their words and the other props, except that a visitor's short name stays beside their name (V14).
  // Without them the commit line still takes its one step, to the commits there are ('small' draws it that way).
  const quotaSteps = () => { if (bandQuotaItems(view, false).length) { step({ quota: 'bare' }); step({ quota: 'small' }); step({ quota: 'stack' }) } else if (hasNumber(view.context)) step({ quota: 'small' }) }
  if (visiting) quotaSteps()
  step({ aside: 'none' })
  if (helpers === 'full' && helperWidth(view, 'full') > helperWidth(view, 'bundle')) step({ helpers: 'bundle' })
  if (first.neighbours) step({ neighbours: false })
  if (helpers !== 'none') step({ helpers: 'none' })
  if (!visiting) quotaSteps()
  return out
}
function fitCue(view: View, column: number, aside: string, states: CueState[], row = true, props = (state: CueState) => cueProps(view, state)): { state: CueState; text: string | undefined; rest?: string; index: number } {
  const nameW = speakerWidth(WORDS[view.lang].name)
  const gap = aside ? planPx(gapBefore(aside, view.lang)) : 0
  for (const [index, state] of states.entries()) {
    const room = column - nameW - props(state) - CUE_GAP
    if (room < 0) continue
    if (state.aside === 'none' || !aside) return { state, text: undefined, index }
    const visiting = !!view.visit?.narrow && view.stageDirection === view.visit.narrow
    const text = cutDirection(aside, room - gap, view.lang, visiting)
    if (text === undefined || (state.aside === 'whole' && text !== aside)) continue
    // Under 480 px a visitor's direction that does not fit beside his name runs onto the empty row below it.
    const split = visiting && !row && text !== aside ? directionRows(aside, room - gap, column, view.lang) : undefined
    return { state, text: split ? split.first : text, ...(split?.rest ? { rest: split.rest } : {}), index }
  }
  // Not even his name beside the smallest props: the name gives way. At the floor the props may take the right inset too,
  // with BAND 3.2's own half pixel of rounding; where they are wider even than that, the commit line's cells go; the
  // reading and the Book button never do.
  const nameless: CueState = { ...states[states.length - 1]!, name: false, aside: 'none' }
  return { state: hasNumber(view.context) && props(nameless) > column + INSET + 0.5 ? { ...nameless, cells: false } : nameless, text: undefined, index: states.length }
}
function planCue(view: View, size: BandSize, said: boolean): CuePlan {
  const height = desktopHeight(view, size), column = cueColumn(view, size, height)
  if (!isRow(view, size)) {
    // At rest her things stand on the floor (DECISIONS 1017), so the script row is hers alone.
    const floor = planFloor(view, column).state
    const fit = fitCue(view, column, stageAside(view), [{ ...floor, aside: 'whole' }, { ...floor, aside: 'cut' }, { ...floor, aside: 'none' }], false, () => 0)
    return { height, state: fit.state, text: fit.text, ...(fit.rest ? { rest: fit.rest } : {}), index: fit.index, frame: fit.state.name ? 0 : 2, column, props: 0 }
  }
  const fit = fitCue(view, column, stageAside(view), cueStates(view, said), true)
  const frame = !fit.state.name ? 2 : height === DESKTOP_COMPACT && !isRow(view, size) ? 1 : 0
  return { height, state: fit.state, text: fit.text, ...(fit.rest ? { rest: fit.rest } : {}), index: fit.index, frame, column, props: cueProps(view, fit.state) }
}
// The desktop's bag is always 👜 (DECISIONS 1017): it never turns into the terminal's ⚙.
function cueLabel(view: View, _state?: Pick<CueState, 'label'>): string {
  return WORDS[view.lang].marks.book
}

// ---------------------------------------------------------------- the floor (DECISIONS 1017)
// At rest her things stand on the floor row, on the line of her feet, right-aligned: Shiori's place, context, the 5-hour
// battery and the week's power bank (or the session's money), the cup, then what is going on (helpers, focus, breathing,
// neighbours), and the bag last. Each thing is one block with a column of padding on both sides, so the tint under the
// pointer takes its name and its picture together; a card with its full name and numbers opens above it.
const THING_PAD = 2 * COLUMN_PX
// The native button with 👜 at title size: 58 to 59 px with " 设置" on his desktop (probe 2, 10-18); about 30 px alone.
const BAG_PX = 32
export type FloorThing = { kind: string; px: number }
function ctxPx(view: View, s: Pick<CueState, 'word' | 'cells' | 'number'>): number {
  const cells = s.cells === false ? 0 : commitLineWidth(commitCount(view.context), !hasNumber(view.context), view.squash, 1.5)
  if (!hasNumber(view.context)) return cells
  return cells + (s.number === false ? 0 : planPx(' ' + contextValue(view))) + (s.word ? planPx(' ' + WORDS[view.lang].context) : 0)
}
export function floorThings(view: View, s: CueState): FloorThing[] {
  const out: FloorThing[] = [], add = (kind: string, content: number) => { if (content > 0) out.push({ kind, px: content + (s.pad === false ? 0 : THING_PAD) }) }
  add('ctx', ctxPx(view, s))
  const items = bandQuotaItems(view, false)
  if (s.quota === 'stack' && items.length) add('quota', Math.max(...items.map(item => quotaItemWidth(item, 'stack'))))
  else for (const item of items) add('quota:' + item.kind, quotaItemWidth(item, s.quota))
  if (!items.length && view.quota?.costUSD !== undefined && bandSessionMoney(view)) add('money', planPx(bandMoney(view, view.quota.costUSD)))
  if (s.cup && view.cost) add('cup', 16)
  if (s.helpers !== 'none') add('helpers', helperWidth(view, s.helpers) - COLUMN_PX)
  if (s.play !== false && view.play?.stick) add('stick', FOCUS_PX.width + (view.play.stick.endedAt === undefined ? COLUMN_PX + planPx(view.play.stick.until) : 0))
  if (s.play !== false && view.play?.breath) add('light', LIGHT_PX.width)
  if (s.neighbours) add('neighbours', neighbourWidth(view) - COLUMN_PX)
  return out
}
function bagPx(view: View, s: Pick<CueState, 'bagWord'>): number {
  return COLUMN_PX + BAG_PX + (s.bagWord !== false && view.bagEntry ? planPx(' ' + view.bagEntry) : 0)
}
function floorPx(view: View, s: CueState): number {
  return floorThings(view, s).reduce((sum, thing) => sum + thing.px, 0) + bagPx(view, s)
}
// What gives way when the floor is short of room, in this order: helpers to their bundle, neighbours, helpers, the
// short names, the commit cells, the cup, the bag's word (its 👜 and its size stay), focus and breathing, the blocks'
// padding, the pictures at one CSS px a pixel, then stacked, and the context number last (DECISIONS 1017).
function floorStates(view: View): CueState[] {
  const helpers: HelperMode = helperWidth(view, 'full') > 0 ? 'full' : 'none', items = bandQuotaItems(view, false).length > 0
  const out: CueState[] = [{ cup: cupShown(view.cost), word: hasNumber(view.context), aside: 'none', label: 'book', helpers, neighbours: neighbourWidth(view) > 0, quota: 'full', name: true }]
  const step = (patch: Partial<CueState>) => { out.push({ ...out[out.length - 1]!, ...patch }) }
  if (helpers === 'full' && helperWidth(view, 'full') > helperWidth(view, 'bundle')) step({ helpers: 'bundle' })
  if (out[0]!.neighbours) step({ neighbours: false })
  if (helpers !== 'none') step({ helpers: 'none' })
  step({ word: false, quota: items ? 'bare' : 'full' })
  step({ cells: false })
  if (out[0]!.cup) step({ cup: false })
  if (view.bagEntry) step({ bagWord: false })
  if (view.play?.stick || view.play?.breath) step({ play: false })
  // The blocks lose their padding, then the pictures draw at one CSS px a pixel and stack, before the context number
  // goes: the number says more than their size.
  step({ pad: false })
  if (items) { step({ quota: 'small' }); step({ quota: 'stack' }) }
  if (hasNumber(view.context)) step({ number: false })
  return out
}
const floorMemo = new Map<string, { state: CueState; px: number }>()
export function planFloor(view: View, column: number): { state: CueState; px: number } {
  const key = JSON.stringify([Math.round(column), view.lang, view.context, view.contextTokens, view.estimate, view.squash, view.bagEntry, view.quota, view.cost?.billing, view.cost?.cache.state, view.cost?.warmEnabled, view.helpers?.length, view.neighbourLights?.agents.length, view.neighbours, view.play?.stick?.until, view.play?.stick?.endedAt, !!view.play?.breath, view.spentWindows, view.paceDetails, view.hotWindows])
  const kept = floorMemo.get(key)
  if (kept) return kept
  const states = floorStates(view)
  const state = states.find(s => floorPx(view, s) <= column) ?? states[states.length - 1]!
  const out = { state, px: floorPx(view, state) }
  if (floorMemo.size >= 16) floorMemo.clear()
  floorMemo.set(key, out)
  return out
}
// Her picture shrinks before the context number leaves the floor or her name the script row (BAND 3.2).
function floorNeedsSmallFigure(view: View, size: BandSize): boolean {
  const column = cueColumn(view, size, DESKTOP_REST), floor = planFloor(view, column)
  return column < speakerWidth(WORDS[view.lang].name) + CUE_GAP || floor.px > column || (hasNumber(view.context) && floor.state.number === false)
}
function floorFields(state: CueState): Pick<DesktopPlan, 'number' | 'bagWord' | 'play' | 'pad'> {
  return { ...(state.number === false ? { number: false as const } : {}), ...(state.bagWord === false ? { bagWord: false as const } : {}), ...(state.play === false ? { play: false as const } : {}), ...(state.pad === false ? { pad: false as const } : {}) }
}

export type BandLineFit = { class?: number; slots?: LineValue[]; button?: LineButton; buttons?: LineButton[] }
type CalibratedPoint = {text:string;width:number}

function calibratedPoint(view:View,text:string,fit:BandLineFit):CalibratedPoint|undefined {
  if(view.lang!=='de'||view.line?.key!=='slow_build')return undefined
  const value=fit.slots?.find(numericValue)?.value
  if(!value)return undefined
  const at=text.indexOf(value),start=text.lastIndexOf('Diesmal ',at)
  if(at<0||start<0||start+'Diesmal '.length!==at)return undefined
  const end=at+value.length,clause=text.slice(start,end+(text[end]==='.'?1:0))
  // CoreText system 13 px, with the duration bold: 145.5042 px for the
  // approved 2m10s clause. Rounded nominal widths plus 1 px reserve 153 px.
  // Only this complete authored clause uses the tighter bound.
  return {text:clause,width:Math.ceil(textPx(clause))+1}
}

// The point is taken from the authored line and declared slot order. It is a
// fitting constraint, never replacement copy or an inferred translation.
function guardClausePoint(text:string,slots:readonly LineValue[]):string[] {
  const pieces:string[]=[]
  for(const part of lineParts(text,slots.map(slot=>slot.value))){
    if(part.slot)continue
    const end=part.text.search(/[.!?।](?:\s|$)|[,，]|。|।/u)
    const piece=(end<0?part.text:part.text.slice(0,end)).trim().replace(/^[,，、:：]+|[,，、:：]+$/gu,'').trim()
    if(piece)pieces.push(piece)
    if(end>=0)break
  }
  return pieces
}

function linePoint(view:View,text:string,fit:BandLineFit):string[] {
  const slots=fit.slots??[],key=view.line?.key
  if(key==='slow_build')return slots.filter(numericValue).slice(0,1).map(slot=>slot.value)
  if(key==='chapter')return [text.split('/compact')[0]!.trim().replace(/[.!?。।]+$/u,'')].filter(Boolean)
  if(key==='budget')return [
    ...slots.filter(numericValue).map(slot=>slot.value),
    ...lineParts(text,slots.map(slot=>slot.value)).filter(part=>!part.slot&&/[\p{L}\p{M}]/u.test(part.text))
      .map(part=>part.text.trim().replace(/^[,，、:：.!?。।]+|[,，、:：.!?。।]+$/gu,'').trim()).filter(Boolean),
  ]
  if(key==='first_down'){
    const value=slots.find(slot=>slot.kind==='test')?.value,at=value?text.indexOf(value):-1
    return at<0?[]:[text.slice(at+value!.length).trim().replace(/^[,，、]\s*/u,'').replace(/[.!?。।]+$/u,'')].filter(Boolean)
  }
  if(!key?.startsWith('guard.'))return []
  const values=slots.map(slot=>slot.value)
  if(key.startsWith('guard.secret')){
    const match=/(?:secret|geheimen Schlüssel|गोपनीय जानकारी|rahasia|segreto|秘密の鍵|비밀 정보|segredo|secreto|密钥|金鑰)/u.exec(text)
    if(match){
      if(view.lang==='de')return [match[0]]
      if(view.lang==='ko')return [match[0]+(/^[\p{Script=Hangul}]+/u.exec(text.slice(match.index+match[0].length))?.[0]??'')]
      let start=match.index
      if(!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(match[0]))start-=(text.slice(0,start).match(/(?:[\p{L}\p{M}]+[ \u00a0]+){1,2}$/u)?.[0].length??0)
      const tail=text.slice(match.index+match[0].length),stop=tail.search(/[:：。.!?।]/u)
      return [text.slice(start,stop<0?match.index+match[0].length:match.index+match[0].length+stop).trim()]
    }
  }
  // Slots cannot impersonate the operation. In the first sentence, keep the
  // longest authored run beside them; long spaced runs keep their first words.
  const parts=lineParts(text,values),runs:string[]=[]
  for(const part of parts){
    if(part.slot)continue
    const end=part.text.search(/[。.!?।](?:\s|$)|[,，]|。|।/u),run=(end<0?part.text:part.text.slice(0,end)).trim().replace(/^[,，、:：]+|[,，、:：]+$/gu,'').trim()
    if(run)runs.push(run)
    if(end>=0)break
  }
  const longest=runs.reduce((best,run)=>run.length>best.length?run:best,'')
  if(!longest)return []
  const words=longest.split(/\s+/u)
  return [words.length>6?words.slice(0,4).join(' '):longest]
}

// Width is monotone as identified slots shorten. Binary search keeps layout
// attempts logarithmic even when a caller hands us an enormous test name.
function shrinkSlots(slots:readonly LineValue[],apply:(values:string[])=>void,fits:()=>boolean):string[] {
  let low=12,high=Math.max(12,...slots.map(slot=>slot.value.length)),best:string[]|undefined
  while(low<=high){
    const length=Math.floor((low+high)/2),values=slots.map(slot=>shortenSlot(slot.value,slot.kind,length))
    apply(values)
    if(fits()){best=values;low=length+1}else high=length-1
  }
  const values=best??slots.map(slot=>shortenSlot(slot.value,slot.kind,12))
  apply(values)
  return values
}

// Spaced words stay whole; CJK characters offer their normal break opportunities.
function lineUnits(text: string, unbroken:readonly string[]=[],bindTail=true): string[] {
  const units=lineParts(text,unbroken).flatMap(part=>part.slot?[part.text]:part.text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^ \t\n\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[ \t]+|\n/gu) ?? [])
  const start=bindTail?cjkTailStart(text):-1
  if(start<0)return units
  let at=0
  const first=units.findIndex(unit=>{at+=unit.length;return at>start})
  return first<0?units:[...units.slice(0,first),units.slice(first).join('')]
}
type RowState={rows:number;used:number;replay?:()=>number;error?:number}
function addUnit(state:RowState,unit:string,n:number,width:number):RowState{
  if(unit==='\n')return {rows:state.rows+1,used:0}
  if(n>width&&unit.trim())return {rows:Infinity,used:0}
  return state.used+n>width?{rows:state.rows+1,used:unit.trim()?n:0}:{rows:state.rows,used:state.used+n}
}
// Each unit is measured once. Replacing the last unit with its ellipsis-bearing form
// reproduces the old prefix probe without laying out the preceding units again.
function fitLinePrefix(text:string,width:number,rows:number,unbroken:readonly string[],measure:(text:string)=>number,bindTail=true,forceCut=false):string{
  const units=lineUnits(text,unbroken,bindTail),states:RowState[]=[{rows:1,used:0}]
  const measured=new Map<string,number>()
  const advance=(state:RowState,unit:string)=>{
    let n=measured.get(unit)
    if(n===undefined){n=measure(unit);measured.set(unit,n)}
    return addUnit(state,unit,n,width)
  }
  const lastUseful=forceCut?[...text.matchAll(/[\p{L}\p{N}]/gu)].at(-1):undefined
  const forceCutAt=lastUseful?lastUseful.index!+lastUseful[0].length:Infinity
  let end=0,kept=0,lastFits=measure('…')<=width
  for(let i=0;i<units.length;i++){
    const unit=units[i]!
    if(end+unit.length>=forceCutAt)break
    if(unit.trimEnd()){
      // Rebuild only the local edge: appending an omission atom can bind the
      // previous CJK pair. Earlier measured rows remain cached.
      const edge=Math.max(0,i-3)
      let candidate=states[edge]!
      for(const fragment of lineUnits(units.slice(edge,i+1).join('').trimEnd()+'…',unbroken))
        candidate=advance(candidate,fragment)
      lastFits=candidate.rows<=rows
    }
    if(!lastFits)break
    states.push(advance(states[i]!,unit));end+=unit.length;kept=end
  }
  return text.slice(0,kept)
}
function speechPx(text:string,bold=false):number {
  // CoreText 13 px ellipsis: 10.3848 regular, 12.3272 bold. The generic
  // typesetter's narrow default is insufficient for a speech omission atom.
  return planPx(text,bold)+(text.match(/…/gu)?.length??0)*((bold?14:12)-planPx('…',bold))
}
export function wrappedRows(text: string, width: number, unbroken:readonly string[]=[],boldValues:readonly string[]=[]): number {
  if (width <= 0) return Infinity
  let rows = 1, used = 0
  for (const unit of lineUnits(text,unbroken)) {
    if (unit === '\n') { rows++; used = 0; continue }
    const px = lineParts(unit,boldValues).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0)
    if (px > width && unit.trim()) return Infinity
    if (used + px > width) { rows++; used = unit.trim() ? px : 0 }
    else used += px
  }
  return rows
}
type LineMetrics={width:number;rows:number;measure:(text:string)=>number;unbroken:readonly string[]}
// A range shares the measured source units. Greedy wrapping jumps to a row boundary
// by prefix-width search; it never remeasures a growing candidate string.
class RangeWrap {
  private units:string[]
  private offsets:number[]=[0]
  private sums:number[]=[0]
  private widths:number[]=[]
  private newlines:number[]=[]
  private nextText:number[]=[]
  private previousText:number[]=[]
  private omissions:number[]=[]
  private requiredEnd=0
  private endpoints=new Map<number,{to:number;edge:number;fragments:{text:string;width:number}[]}>()
  private edges=new Map<string,{text:string;width:number}[]>()
  constructor(private text:string,private metrics:LineMetrics,private protectedValues:readonly string[],required:readonly string[]=[]){
    this.requiredEnd=Math.max(0,...required.map(value=>text.indexOf(value)+value.length))
    let at=0
    for(const part of lineParts(text,protectedValues)){
      if(!part.slot)for(const match of part.text.matchAll(/…/gu))this.omissions.push(at+match.index!)
      at+=part.text.length
    }
    this.units=lineUnits(text,metrics.unbroken,false)
    let previous=-1
    for(let i=0;i<this.units.length;i++){
      const unit=this.units[i]!,n=unit==='\n'?0:metrics.measure(unit)
      this.offsets.push(this.offsets[i]!+unit.length);this.widths.push(n);this.sums.push(this.sums[i]!+n)
      if(unit.trim())previous=i
      this.previousText.push(previous)
    }
    let newline=this.units.length,next=this.units.length
    for(let i=this.units.length-1;i>=0;i--){
      if(this.units[i]==='\n')newline=i
      if(this.units[i]!.trim())next=i
      this.newlines[i]=newline;this.nextText[i]=next
    }
  }
  private index(offset:number):number{
    let low=0,high=this.offsets.length-1
    while(low<high){const mid=Math.ceil((low+high)/2);if(this.offsets[mid]!<=offset)low=mid;else high=mid-1}
    return low
  }
  private fragments(text:string,tail=true):{text:string;width:number}[]{
    const key=(tail?'tail:':'head:')+text
    let cached=this.edges.get(key)
    if(!cached){cached=lineUnits(text,this.metrics.unbroken,tail).map(text=>({text,width:this.metrics.measure(text)}));this.edges.set(key,cached)}
    return cached
  }
  private append(state:RowState,text:string,tail=true):RowState{
    for(const unit of this.fragments(text,tail)){state=this.addMeasured(state,unit.text,unit.width);if(state.rows>this.metrics.rows)break}
    return state
  }
  private addMeasured(state:RowState,text:string,n:number):RowState{
    const {width}=this.metrics
    // This bound only selects exact arithmetic; it never grants extra fitting room.
    // Replay cached widths in the renderer's original addition order at an ambiguous edge.
    if(state.replay&&Math.abs(state.used+n-width)<=(state.error??0)+Number.EPSILON*(Math.abs(state.used)+n+width+1)){
      state={rows:state.rows,used:state.replay()}
    }
    const next=addUnit(state,text,n,width)
    if(state.replay&&text!=='\n'&&next.rows===state.rows){
      const previous=state.replay
      next.replay=()=>previous()+n
      next.error=(state.error??0)+Number.EPSILON*(Math.abs(state.used)+n+1)
    }
    return next
  }
  private middle(state:RowState,start:number,end:number):RowState{
    const {width,rows}=this.metrics
    while(start<end&&state.rows<=rows){
      const stop=Math.min(end,this.newlines[start]??end)
      const initial=state,rowStart=start
      const replay=(until:number)=>{
        let used=initial.replay?initial.replay():initial.used
        for(let i=rowStart;i<until;i++)used+=this.widths[i]!
        return used
      }
      const error=(initial.error??0)+Number.EPSILON*(Math.abs(this.sums[stop]!)+Math.abs(this.sums[start]!)+Math.abs(initial.used)+width+1)*(this.units.length+4)
      let low=start,high=stop
      while(low<high){
        const mid=Math.ceil((low+high)/2),estimated=initial.used+(this.sums[mid]!-this.sums[start]!)
        const used=Math.abs(estimated-width)<=error?replay(mid):estimated
        if(used<=width)low=mid;else high=mid-1
      }
      let exact:number|undefined
      state={rows:initial.rows,used:initial.used+(this.sums[low]!-this.sums[start]!),error,replay:()=>exact??=replay(low)};start=low
      if(start===stop&&start<end){state={rows:state.rows+1,used:0};start++}
      else if(start<end){state=this.addMeasured(state,this.units[start]!,this.widths[start]!);start++}
    }
    return state
  }
  private endpoint(end:number):{to:number;edge:number;fragments:{text:string;width:number}[]}{
    let cached=this.endpoints.get(end)
    if(cached)return cached
    let last=this.index(end)
    if(this.offsets[last]===end)last--
    last=this.previousText[last]??-1
    const edge=Math.max(0,last-3)
    const raw=this.text.slice(this.offsets[edge],Math.min(end,this.offsets[last+1]??end))
    const parts=lineParts(raw.trimEnd(),this.protectedValues)
    const tail=parts[parts.length-1]
    if(tail&&!tail.slot)tail.text=tail.text.replace(/[.。।!?！？:：]+$/u,'')
    const body=parts.map(part=>part.text).join('')
    const to=this.offsets[edge]!+body.length
    const fragments=this.fragments(body+'…')
    cached={to,edge,fragments};this.endpoints.set(end,cached)
    return cached
  }
  endpointFits(end:number):boolean{
    // Any suffix atom wider than the column makes this endpoint impossible.
    // Removing those endpoints restores monotone range-width search.
    return end===this.text.length||this.endpoint(end).fragments.every(unit=>unit.text==='\n'||!unit.text.trim()||unit.width<=this.metrics.width)
  }
  fits(start:number,end:number):boolean{
    const cut=start>0||end<this.text.length
    let first=this.index(start),last=this.index(end)
    if(this.offsets[last]===end)last--
    first=this.nextText[first]??this.units.length;last=this.previousText[last]??-1
    if(first>last)return false
    let from=Math.max(start,this.offsets[first]!),to=Math.min(end,this.offsets[last+1]!)
    if(cut){
      // Find the first authored pause outside the protected display atoms.
      let low=0,high=this.omissions.length
      while(low<high){const mid=Math.floor((low+high)/2);if(this.omissions[mid]!<from)low=mid+1;else high=mid}
      if(this.omissions[low]===from&&/^…(?=[\p{L}\p{N}])/u.test(this.text.slice(from))){from++;low++}
      if(this.omissions[low]!==undefined&&this.omissions[low]!<to)to=this.omissions[low]!
    }
    if(to<=from||to<this.requiredEnd)return false
    // Cached endpoint edges contain at most four source units. They reproduce
    // punctuation trimming and CJK tail binding without scanning the span.
    const endpoint=cut?this.endpoint(to):undefined
    if(endpoint)to=endpoint.to
    if(to<=from)return false
    first=this.index(from);last=this.index(to)
    if(this.offsets[last]===to)last--
    const edge=Math.max(first,last-3)
    let state:RowState={rows:1,used:0}
    if(first>=edge)state=this.append(state,this.text.slice(from,to)+(cut?'…':''))
    else{
      state=this.append(state,this.text.slice(from,this.offsets[first+1]),false)
      state=this.middle(state,first+1,edge)
      state=this.append(state,this.text.slice(this.offsets[edge],to)+(cut?'…':''))
    }
    return state.rows<=this.metrics.rows
  }
}
function cutNumericLine(text:string,unbroken:readonly string[],fitsWidth:(candidate:string)=>boolean,numbers:readonly string[]=unbroken,allowClauseDrop=true,metrics:LineMetrics,required:readonly string[]=[],atomic:readonly string[]=[],preferAllNumbers=false):string|undefined {
  const fits=(candidate:string)=>required.every(value=>candidate.includes(value))&&fitsWidth(candidate)
  if(!unbroken.length)return undefined
  let atomicOffset=0
  const atomicRanges=lineParts(text,atomic).flatMap(part=>{const start=atomicOffset,end=start+part.text.length;atomicOffset=end;return part.slot?[{start,end}]:[]})
  let offset=0
  const occurrences=lineParts(text,unbroken).map(part=>{
    const start=offset,end=offset+part.text.length;offset=end
    return {part,start,end,numeric:!!part.slot&&numbers.includes(part.text)}
  })
  if(required.length&&allowClauseDrop){
    let start=0
    const clauses:string[]=[]
    for(const match of text.matchAll(/。|[.!?！？।](?:\s+|$)|[,，]\s*/gu)){
      if(occurrences.some(slot=>slot.part.slot&&match.index!>=slot.start&&match.index!<slot.end))continue
      const end=match.index!+match[0].length
      if(/^[,，]/u.test(match[0])&&(!occurrences.some(slot=>slot.numeric&&slot.start>=start&&slot.end<=end)||!occurrences.some(slot=>slot.numeric&&slot.start>=end)))continue
      clauses.push(text.slice(start,end).trim().replace(/[,，]$/u,''));start=end
      if(clauses.length===7)break
    }
    clauses.push(text.slice(start).trim())
    if(clauses.length>1)for(const clause of clauses)if(clause&&fits(clause))return clause
  }
  // A complete first sentence needs no omission mark when the following sentence is dropped.
  const split=allowClauseDrop?[...text.matchAll(/。|[.!?！？।](?:\s+|$)|[,，]\s*/gu)].find(match=>{
    if(occurrences.some(({part,start,end})=>part.slot&&match.index!>=start&&match.index!<end))return false
    const at=match.index!+match[0].length
    return occurrences.some(slot=>slot.numeric&&slot.end<=at)&&(!/^[,，]/u.test(match[0])||occurrences.some(slot=>slot.numeric&&slot.start>=at))
  }):undefined
  const first=split?text.slice(0,split.index!+split[0].length).trimEnd().replace(/[,，]$/u,''):undefined
  const ranges:{start:number;end:number}[]=[]
  for(const {part,start,end,numeric} of occurrences){
    if(!part.slot)continue
    let from=start,to=end
    if(numeric){
      const before=text.slice(0,start),after=text.slice(end)
      const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
      const cjkValue=cjk.test(part.text)
      // Keep the adjacent label, including Japanese clause labels and Korean particles.
      const label=/(?:di solito\s+|lo normal es\s+|o normal é\s+|आम तौर पर\s+|[这這]次build花了|今回は|いつもは|平[时時]|[这這]次|残り|あと|第|[\p{L}\p{M}'’\-]+[,，]?[ \u00a0]+)$/u.exec(before)
      if(label&&(!cjkValue||cjk.test(label[0]))&&!atomicRanges.some(range=>range.start<start&&range.end>start-label[0].length))from-=label[0].length
      const suffix=/^(?:[\p{Script=Hangul}]+|行目|行|回|次|页|頁)[.!?。]?/u.exec(after)
      if(suffix)to+=suffix[0].length
      const following=/^[ \u00a0]+(?:this time|dessa vez|esta vez|red runs|[\p{L}\p{M}]+)/u.exec(after)
      if(following&&(!cjkValue||cjk.test(following[0])))to+=following[0].length
    }
    const previous=ranges[ranges.length-1]
    if(previous&&from<=previous.end)previous.end=Math.max(previous.end,to)
    else ranges.push({start:from,end:to})
  }
  if(!ranges.length)return undefined
  const payload=ranges.map(range=>text.slice(range.start,range.end)).join(' ')
  const firstSlots=first?occurrences.filter(slot=>slot.part.slot&&slot.end<=first.length):[]
  const completeSentence=!!split&&!/^[,，]/u.test(split[0])
  if(first&&first.length<text.length&&firstSlots.some(slot=>slot.numeric)&&(!preferAllNumbers||!fits(payload)||completeSentence&&fits(first))){
    if(fits(first))return first
    if(!fits(payload)){
      const fittedFirst=cutNumericLine(first,firstSlots.map(slot=>slot.part.text),fits,firstSlots.filter(slot=>slot.numeric).map(slot=>slot.part.text),true,metrics,required,atomic)
      if(fittedFirst&&fits(fittedFirst))return fittedFirst
    }
  }
  const firstRange=ranges[0]!,lastRange=ranges[ranges.length-1]!
  // Keep source order. A single cut in the surrounding words is preferred to several holes.
  const units=lineUnits(text,atomic),boundaries=[0]
  for(const unit of units)boundaries.push(boundaries[boundaries.length-1]!+unit.length)
  let best='',score=-1
  const layout=new RangeWrap(text,metrics,unbroken,required)
  const candidate=(start:number,end:number)=>{
    const body=text.slice(start,end).trim()
    return start>0||end<text.length?omittedPrefix(body,unbroken):body
  }
  const consider=(start:number,end:number)=>{
    if(end-start<=score||!layout.fits(start,end))return
    const fitted=candidate(start,end)
    if(required.every(value=>fitted.includes(value))){best=fitted;score=end-start}
  }
  const lastIndex=boundaries.findIndex(end=>end>=lastRange.end)
  const ends=boundaries.filter((end,index)=>index>=lastIndex&&layout.endpointFits(end))
  // The full endpoint drops no suffix marker and gets its own exact probe.
  // Remaining possible suffix endpoints have monotone row extent.
  for(const start of boundaries){
    if(start>firstRange.start||text.length-start<=score)break
    const previous=score
    consider(start,text.length)
    if(score>previous)continue
    let low=0,high=ends.length-1,fitted=-1
    if(ends[high]===text.length)high--
    while(low<=high){
      const mid=Math.floor((low+high)/2)
      if(layout.fits(start,ends[mid]!)){fitted=mid;low=mid+1}else high=mid-1
    }
    if(fitted>=0)consider(start,ends[fitted]!)
  }
  if(best)return best
  // Multiple values can leave no contiguous span that fits. Retain their labelled units
  // in source order and use just one omission mark for the removed connecting words.
  return omittedPrefix(payload,unbroken)
}
function cutLine(text: string, width: number, rows: number,unbroken:readonly string[]=[],identified:readonly string[]=[],required:readonly string[]=[],preferAllNumbers=false,precise?:CalibratedPoint,boldValues:readonly string[]=[]): string {
  if (width < speechPx('…')) return ''
  if (wrappedRows(text, width,unbroken,boldValues) <= rows) return text
  const original=text
  text=withoutLeadingPause(text,identified)
  const normalizedPause=original!==text
  const fits=(candidate:string)=>candidate===precise?.text?rows>=1&&precise.width<=width:wrappedRows(candidate,width,unbroken,boldValues)<=rows
  const numeric=cutNumericLine(text,[...unbroken,...identified,...required],fits,unbroken,!identified.some(value=>unbroken.includes(value)),{width,rows,measure:value=>lineParts(value,boldValues).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0),unbroken},required,identified,preferAllNumbers)
  if(numeric!==undefined){
    if(required.length&&identified.length&&!fits(numeric))return cutNumericLine(text,[...unbroken,...required],fits,unbroken,true,{width,rows,measure:value=>lineParts(value,boldValues).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0),unbroken},required,identified)??numeric
    return numeric
  }
  const measure=(value:string)=>lineParts(value,boldValues).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0)
  const kept=fitLinePrefix(text,width,rows,unbroken,measure,rows>1,normalizedPause)
  // A single unbreakable run can itself exceed the slot; the last fitting step cuts its end.
  if(!kept.trim()){
    if(/\p{Script=Hangul}/u.test(text)||unbroken.includes(lineUnits(text,unbroken).find(unit=>unit.trim())??''))return '…'
    const budget=width-(speechPx('…')-planPx('…'))
    const fallback=cutToPx(text,budget,false,1)
    return normalizedPause&&fallback===text?cutToPx(text,Math.min(budget,planPx(text)-0.001),false,1)??'…':fallback??'…'
  }
  return omittedPrefix(kept,identified)
}
export function shortenSlot(value: string, kind: LineValue['kind'], length: number): string {
  if (kind==='value'||kind==='label') return value
  if (kind === 'path') {
    if(value.length<=length&&value.length>12)return value
    const parts = value.split('/')
    if (parts.length > 1) {
      const end = parts.pop()!
      const start = parts.slice(0, parts.length === 2 ? 1 : Math.min(parts.length, 2)).join('/')
      const candidates = [start+'/…/'+end,parts[0]+'/…/'+end,'…/'+end,end].filter(path=>path&&path.length<value.length)
      return candidates.find(path=>path.length<=length)??candidates[candidates.length-1]??value
    }
    return value
  }
  if(value.length<=length)return value
  const boundaries=[...value.matchAll(kind==='test'?/ › |::|[./ ]+/g:/ +/g)]
  if(kind==='test'&&boundaries.length){
    const tails=boundaries.map(match=>value.slice(match.index!+match[0].length).trimStart()).filter(tail=>tail.length+1>=12)
    const tail=tails.find(tail=>tail.length<=length)??tails[tails.length-1]
    return tail?'…'+tail:value
  }
  else for(const match of boundaries.reverse()){const head=value.slice(0,match.index).trimEnd();if(head.length+1<=length&&head.length)return head+'…'}
  if(/\p{Script=Hangul}/u.test(value))return value
  const shortened = kind === 'test' ? '…' + value.slice(-(length - 1)) : value.slice(0, length - 1).trimEnd() + '…'
  return shortened.length >= 12 ? shortened : value
}
// A line she says at rest stands after her name on the script row and runs on to the row below at the same indent, a
// play's script; her things keep the floor row (DECISIONS 1017).
function planSpokenRest(view: View, size: BandSize, said: string, fit: BandLineFit): DesktopPlan {
  const bounded=safeBandSpeech(said,fit,true);fit=bounded.fit
  said=spokenScript(bounded.text,fit.slots).text
  const words = WORDS[view.lang]
  const cue = planCue(view, size, true)
  // Her line hangs after her name.
  let named = !!cue.state.name, textWidth = 1
  const lineButtons=fit.buttons??(fit.button?[fit.button]:[])
  let showButton = lineButtons.length>0
  const buttonWidth = lineButtons.reduce((width,b)=>width+planPx(b.label)+22+COLUMN_PX,0)
  const rows = () => 2 - (showButton ? 1 : 0)
  const slots = fit.slots ?? [...said.matchAll(/(?:~?\/|[A-Za-z]:\/)[^\s,;!?]+/g)].map(m => ({value:m[0],kind:'path' as const}))
  const unbroken = numericValues(fit.slots ?? [], said, view.lang)
  const point = linePoint(view, said, fit)
  const precise = calibratedPoint(view, said, fit)
  let text = said, fittedSlots = slots.map(s => s.value), fittedWhole = said
  const fits = () => point.every(value=>text.includes(value)) && (text===precise?.text?rows()>=1&&precise.width<=textWidth:wrappedRows(text, textWidth, unbroken) <= rows())
  // 0.2 SPEC rule 5: (b) shorten identified slot values, then (e) cut the line's end. The stage direction and the name sit
  // on the cue line, so neither takes room from the line (the column is its own).
  const fitLine = () => {
    text = said; fittedSlots = slots.map(s => s.value); showButton = lineButtons.length>0
    if (!fits()) fittedSlots=shrinkSlots(slots,values=>{
      text=slots.reduce((line,slot,i)=>line.replace(slot.value,values[i]!),said)
    },fits)
    const identified=fittedSlots.filter((_,i)=>slots[i]!.kind==='path'||slots[i]!.kind==='test')
    fittedWhole=text
    if (!fits()) text=cutLine(fittedWhole,textWidth,rows(),unbroken,identified,point,!point.length,precise)
    const renderedWidth=(value:string)=>value===precise?.text?precise.width:lineParts(value,fittedSlots.filter((_,i)=>slots[i]!.kind!=='label')).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0)
    const widest=()=>Math.max(buttonWidth?buttonWidth-COLUMN_PX:0,...lineUnits(text,unbroken).map(renderedWidth))
    const invalidCut=()=>!text.replace(/[\s\p{P}]/gu,'')||singleCjkFragment(text,said)||point.some(value=>!text.includes(value))
    if(widest()>textWidth||invalidCut()){
      const boldValues=fittedSlots.filter((_,i)=>slots[i]!.kind!=='label')
      text=cutLine(fittedWhole,textWidth,rows(),unbroken,identified,point,!point.length,precise,boldValues)
      if(showButton&&point.length>0&&(widest()>textWidth||invalidCut())){
        showButton=false
        text=cutLine(fittedWhole,textWidth,rows(),unbroken,identified,point,false,precise,boldValues)
      }
      if(widest()>textWidth||invalidCut())text=''
    }
  }
  // Her name gives way where the line then stands whole, or would not stand at all beside it.
  // The script row (CANON 197): her name, her stage direction, her line. The direction gives way first: it stays only where
  // the whole line still stands beside it, never cut.
  const direction = cue.text !== undefined && !cue.text.endsWith('…') ? cue.text : undefined
  const directionPx = direction ? planPx(`${gapBefore(direction, view.lang) ? ' ' : ''}${direction}`) + COLUMN_PX : 0
  let directed = false
  const fitWith = (withName: boolean, withDirection = false) => { named = withName; directed = withDirection; textWidth = Math.max(1, cue.column - (named ? speakerWidth(words.name) + COLUMN_PX : 0) - (directed ? directionPx : 0)); fitLine() }
  if (direction && named) {
    fitWith(true, true)
    if (text !== fittedWhole || wrappedRows(text, textWidth, unbroken) > 1) directed = false
  }
  if (!directed) fitWith(named)
  if (!directed && named && text !== fittedWhole) {
    const kept = { text, fittedSlots, fittedWhole, showButton, textWidth }
    fitWith(false)
    if (kept.text && text !== fittedWhole) { named = true; ({ text, fittedSlots, fittedWhole, showButton, textWidth } = kept) }
  }
  const renderedWidth=(value:string)=>value===precise?.text?precise.width:lineParts(value,fittedSlots.filter((_,i)=>slots[i]!.kind!=='label')).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0)
  return {height:cue.height,row:false,word:cue.state.word,cup:cue.state.cup,aside:directed?'beside':'none',text:directed?direction:undefined,speech:text,showRight:true,neighbours:cue.state.neighbours,quota:cue.state.quota,...(cue.state.cells===false?{cells:false as const}:{}),helpers:cue.state.helpers,...floorFields(cue.state),lineRows:rows(),textWidth,buttonWidth,showButton,speechRows:text?(text===precise?.text?1:wrappedRows(text,textWidth,unbroken)):0,speechWidth:text?renderedWidth(text):0,parts:fittedParts(text,slots,fittedSlots,said),label:cueLabel(view,cue.state),name:named?words.name:undefined,frame:cue.frame,place:cue.index}
}

// A line he says in the one-row band (the pixel band, "Smaller while working") stands on the cue row, between his name and
// his props; it takes the stage direction's place.
function planSpokenRow(view: View, size: BandSize, said: string, fit: BandLineFit): DesktopPlan {
  const bounded=safeBandSpeech(said,fit,true);fit=bounded.fit
  said=spokenScript(bounded.text,fit.slots).text
  const words = WORDS[view.lang], height = desktopHeight(view, size)
  // The right edge keeps its two columns for his props; where a protected line has sent the props away, the line may use them.
  let showRight = true
  const avail = () => size.columns * COLUMN_PX - (showRight ? INSET : 0)
  const left = 12 + getMotionWidth(height, view.band === 'compact') + COLUMN_PX
  const rightGap = 2
  let label = words.marks.book
  let cup = cupShown(view.cost)
  let cells = true
  const rightWidth = (word: boolean) => (cup ? 16 + COLUMN_PX : 0) + boxWidth(view, word, cells ? 'row' : 'none') + incenseWidth(view) + bookWidth(label) + rightGap * COLUMN_PX
  let name: string | undefined = words.name, text = said, word = hasNumber(view.context), stage = 0
  let neighbours=neighbourWidth(view)>0
  let helpers:HelperMode=helperWidth(view,'full')>0?'full':'none'
  const middle = () => Math.max(1, avail() - left - (showRight ? rightWidth(word)+(neighbours?neighbourWidth(view):0)+helperWidth(view,helpers) : 0))
  const lineButtons=fit.buttons??(fit.button?[fit.button]:[])
  let showButton=lineButtons.length>0
  let buttonWidth = lineButtons.reduce((width,b)=>width+planPx(b.label)+22+COLUMN_PX,0)
  const width = () => middle() - buttonWidth - (name ? (view.line?speakerWidth(name):Math.max(speakerWidth(name),planPx(name,true))) + planPx(gapBefore(text)) : 0)
  const slots = fit.slots ?? [...said.matchAll(/(?:~?\/|[A-Za-z]:\/)[^\s,;!?]+/g)].map(m => ({value:m[0],kind:'path' as const}))
  const unbroken=numericValues(fit.slots??[],said,view.lang)
  const point=linePoint(view,said,fit)
  const precise=calibratedPoint(view,said,fit)
  // The resting header is unshrinkable too; speech fitting alone cannot keep the
  // following offering inside when the name is wider than their shared column.
  const fits = () => (!name || speakerWidth(name) <= middle()) && point.every(value=>text.includes(value)) && (text===precise?.text?precise.width<=width():wrappedRows(text, width(), unbroken) <= 1)
  if(!fits() && helperWidth(view,'full')>helperWidth(view,'bundle'))helpers='bundle'
  // The row gives up, in this order: the cache cup, the word "context", the Book label to its one word, helpers, neighbours.
  if (!fits()) cup = false
  if (!fits()) word = false
  if (!fits()) neighbours=false
  if (!fits()) helpers='none'
  // (b) shorten only identified slot values; prefer complete words at the floor.
  let fittedSlots = slots.map(s => s.value)
  if (!fits()) fittedSlots=shrinkSlots(slots,values=>{
    text=slots.reduce((line,slot,i)=>line.replace(slot.value,values[i]!),said)
  },fits)
  // (c) only safety/action lines may move the right block aside.
  if (!fits() && (fit.class ?? 0) >= 2) { showRight = false; stage = 1 }
  const identified=fittedSlots.filter((_,i)=>slots[i]!.kind==='path'||slots[i]!.kind==='test')
  const fittedWhole=text
  // The speaker stays whenever the fitted line can share his row; protected payloads can still need the name row, and
  // only that measured failure gives it back to them. A row has no third row to hand over (0.2 SPEC rule 4).
  if (!fits()) {
    const whole=text
    if(name&&withoutLeadingPause(whole,identified)!==whole){
      const speaker=name
      name=undefined
      if(fits())stage=2
      else name=speaker
    }
    if(!fits()){
      text=cutLine(whole,width(),1,unbroken,identified,point,false,precise);stage=3
      if(!fits()) {name=undefined;text=cutLine(whole,width(),1,unbroken,identified,point,!point.length,precise);stage=2}
    }
  }
  const fixedWidth=()=>left+(showRight?rightWidth(word)+(neighbours?neighbourWidth(view):0)+helperWidth(view,helpers):0)
  const renderedWidth=(value:string)=>value===precise?.text?precise.width:lineParts(value,fittedSlots.filter((_,i)=>slots[i]!.kind!=='label')).reduce((sum,part)=>sum+speechPx(part.text,!!part.slot),0)
  const requiredWidth=()=>fixedWidth()+(name?speakerWidth(name)+planPx(gapBefore(text)):0)+renderedWidth(text)+buttonWidth
  const invalidCut=()=>!text.replace(/[\s\p{P}]/gu,'')||singleCjkFragment(text,said)||point.some(value=>!text.includes(value))
  if(requiredWidth()>avail()||invalidCut()){
    // Keep the authored clause boundaries for each retry. An earlier cut may
    // have joined numeric units that cannot fit even after fixed siblings yield.
    const physicalWhole=fittedWhole
    const protectedSpeech=point.length>0||unbroken.length>0||identified.length>0||(fit.class??0)>=2
    const boldValues=fittedSlots.filter((_,i)=>slots[i]!.kind!=='label')
    // Retry inside the existing column before yielding either fixed sibling.
    // Numeric speech keeps its authored value while the name gives back room.
    text=cutLine(physicalWhole,width(),1,unbroken,identified,point,!point.length,precise,boldValues)
    if(requiredWidth()>avail()||invalidCut()){
      name=undefined
      text=cutLine(physicalWhole,width(),1,unbroken,identified,point,!point.length,precise,boldValues)
    }
    if(requiredWidth()>avail()||invalidCut()){
      if(protectedSpeech){
        showRight=false;neighbours=false;cup=false;helpers='none'
        text=cutLine(physicalWhole,width(),1,unbroken,identified,point,!point.length,precise,boldValues)
      }
      if(showButton&&point.length>0&&(requiredWidth()>avail()||invalidCut())){
        showButton=false;buttonWidth=0
        text=cutLine(physicalWhole,width(),1,unbroken,identified,point,false,precise,boldValues)
        if(name===undefined&&requiredWidth()<=avail()&&!invalidCut()){
          const withoutName=text
          name=words.name
          text=cutLine(physicalWhole,width(),1,unbroken,identified,point,false,precise,boldValues)
          if(!fits()||requiredWidth()>avail()||invalidCut()){name=undefined;text=withoutName}
        }
      }
      // The commit line's cells give way before the line is left out; the reading stays (lane C, 10-14).
      if((requiredWidth()>avail()||invalidCut())&&hasNumber(view.context)){
        cells=false
        text=cutLine(physicalWhole,width(),1,unbroken,identified,point,!point.length,precise,boldValues)
        if(requiredWidth()>avail()||invalidCut())cells=true
      }
      if(requiredWidth()>avail()||invalidCut())text=''
    }
  }
  // A line the row cannot hold, not even cut, is left out; the name is then all the row says and comes back, the commit
  // line's cells making room for it where they must.
  if(text===''&&name===undefined){
    if(speakerWidth(words.name)>middle()&&hasNumber(view.context)){cells=false;if(speakerWidth(words.name)>middle())cells=true}
    if(speakerWidth(words.name)<=middle())name=words.name
  }
  return {height,row:true,word,cup,aside:'beside',text,speech:text,showRight,neighbours,helpers,lineRows:1,textWidth:middle(),buttonWidth,showButton,parts:fittedParts(text,slots,fittedSlots,said),label,name,frame:0,place:stage,rightGap,...(cells?{}:{cells:false as const})}
}
function planSpokenDesktop(view: View, size: BandSize, said: string, fit: BandLineFit): DesktopPlan {
  return isRow(view, size) ? planSpokenRow(view, size, said, fit) : planSpokenRest(view, size, said, fit)
}

// Shiori's place (the marker, a space and «3 of 7») stands before the offering. It is shown only when the band
// still plans every other part whole with its room taken, so it is the first thing to yield (0.2 rule 5c).
function markerPx(view: View): number {
  return view.place?.text ? 16 + planPx(` ${view.place.text}`) + COLUMN_PX : 0
}
const PLAN_PARTS = ['word', 'cup', 'rest', 'aside', 'text', 'name', 'frame', 'place', 'helpers', 'neighbours', 'showRight', 'showButton', 'speech', 'lineRows', 'rightGap', 'cells', 'quota', 'number', 'bagWord', 'play', 'pad'] as const
export function planDesktop(view: View, size: BandSize, displaySpeech?: string, fit: BandLineFit = view.line ?? {}): DesktopPlan {
  const plan = planDesktopWhole(view, size, displaySpeech, fit), room = markerPx(view)
  if (!room || !plan.height || plan.showRight === false || plan.name === undefined || plan.frame !== 0) return plan
  const narrowed = planDesktopWhole(view, { ...size, columns: size.columns - Math.ceil(room / COLUMN_PX) }, displaySpeech, fit)
  return PLAN_PARTS.every(part => JSON.stringify(plan[part]) === JSON.stringify(narrowed[part])) ? { ...narrowed, marker: true } : plan
}

function planDesktopWhole(view: View, size: BandSize, displaySpeech?: string, fit: BandLineFit = view.line ?? {}): DesktopPlan {
  view = narrowVisitor(view, size.columns * COLUMN_PX < 480)
  const speech = displaySpeech ?? view.line?.text ?? view.said
  if (speech) {const bounded=safeBandSpeech(speech,fit,true),display=displaySlots(bounded.text,bounded.fit.slots);fit=bounded.fit;return planSpokenDesktop(view,size,display.text,{...fit,slots:display.slots})}
  const words = WORDS[view.lang], cue = planCue(view, size, false)
  return {height:cue.height,row:isRow(view,size),word:cue.state.word,cup:cue.state.cup,aside:cue.text===undefined?'none':'beside',text:cue.text,...(cue.rest?{rest:cue.rest}:{}),label:cueLabel(view,cue.state),name:cue.state.name?words.name:undefined,frame:cue.frame,place:cue.index,neighbours:cue.state.neighbours,quota:cue.state.quota,...(cue.state.cells===false?{cells:false as const}:{}),...floorFields(cue.state),helpers:cue.state.helpers}
}

// `leading` keeps what opens the direction when even one word of it fits: a visitor's short name leads it and is never cut.
export function cutDirection(text: string, budget: number, lang: string, leading = false): string | undefined {
  const cut = cutToPx(text, budget, false, leading ? 1 : 3)
  if (cut === undefined || cut === text) return cut
  if (leading) return cut
  if(['zh','zh-Hant','ja'].includes(lang))return undefined
  const kept = cut.replace(/^[(*（]/u, '').replace(/…[)*）]?$/u, '')
  return kept.trim().split(/\s+/u).length>=2&&text.replace(/^[(*（]/u, '').startsWith(kept + ' ') ? cut : undefined
}

// A visitor's direction in a narrow band: as much as fits beside his name, the rest on the empty row below, then an ellipsis.
function directionRows(text: string, first: number, second: number, lang: string): { first: string; rest?: string } {
  const units = ['zh','zh-Hant','ja'].includes(lang) ? [...text] : text.split(/(?<= )/u)
  let head = ''
  for (const unit of units) { if (head && planPx(head + unit.trimEnd()) > first) break; head += unit }
  const rest = text.slice(head.length)
  const tail = rest ? cutToPx(rest, second, false, 1) : undefined
  return { first: head.trimEnd(), ...(tail ? { rest: tail } : {}) }
}

const pictureLinks = new Map<string, string>()
function pictureLink(source: string, alt: string): string {
  const key = `${alt}:${source}`
  const cached = pictureLinks.get(key)
  if (cached !== undefined) return cached
  const escaped = alt.replace(/[\\[\]]/g, '\\$&')
  const text = `[![${escaped}](data:image/svg+xml;base64,${btoa(source)})](file:///coco-poke)`
  if (pictureLinks.size >= 64) pictureLinks.delete(pictureLinks.keys().next().value!)
  pictureLinks.set(key, text)
  return text
}

// A thing on VS Code and the phone: each Text it holds becomes a dim button of that Text, its pictures stay as they are.
// VS Code's Markdown draws a picture as its alt text (webview: `img: ({alt}) => <span>{alt}</span>`, 2.1.301), and a
// Button there holds words alone, so a picture there cannot be pressed (his screenshot, 10-20).
function thingWords(node: unknown, kind: string, Button: Elements['desktop']['Button'], n = { i: 0 }): RenderElement {
  if (!node || typeof node !== 'object') return node as RenderElement
  const element = node as { type?: string; children?: unknown[] }
  if (element.type === 'Text') return <Button key={'coco:thing:' + kind + (n.i++ ? '#' + n.i : '')} dimColor onPress={() => {}}>{node as RenderElement}</Button>
  return Array.isArray(element.children) ? { ...element, children: element.children.map(child => thingWords(child, kind, Button, n)) } as RenderElement : node as RenderElement
}


// A thing's card: its full name and main number, then what comes next (its reset, its forecast). Where the room above it
// is short the second line goes first, then the short form; the card never reaches past the column's left edge, so it
// never covers her (owner 10-18, probe 4).
type ThingCard = { main: string; detail?: string; short?: string; narrow?: string }
function cardCols(lines: string[]): number { return Math.ceil(Math.max(...lines.map(line => planPx(line))) / COLUMN_PX) + 3 }
function fitCard(card: ThingCard, room: number): { lines: string[]; cols: number } | undefined {
  // The second line gives way in parts: the reset and the forecast, then the reset alone, then none.
  const options = [...(card.detail ? [[card.main, card.detail]] : []), ...(card.short ? [[card.main, card.short]] : []), [card.main], ...(card.narrow ? [[card.narrow]] : [])]
  for (const lines of options) if (cardCols(lines) <= room) return { lines, cols: cardCols(lines) }
  const last = options[options.length - 1]!
  return room >= 6 ? { lines: last, cols: room } : undefined
}
function windowText(tokens: number, lang: string): string {
  return tokens >= 1_000_000 ? new Intl.NumberFormat(numberLocale(lang), { maximumFractionDigits: 1, useGrouping: false }).format(tokens / 1_000_000) + 'M' : contextTokensText(tokens, lang)
}
function thingCards(view: View): Record<string, ThingCard> {
  const words = WORDS[view.lang], separator = words.quota.separator, cards: Record<string, ThingCard> = {}
  const money = view.quota?.costUSD !== undefined && bandSessionMoney(view) ? bandMoney(view, view.quota.costUSD) : undefined
  cards.ctx = !hasNumber(view.context) ? { main: contextAlt(view.context, view.lang, { offerings: { noReading: BAND_BOOK_WORDS[view.lang].noReading }, alt: words.alt }, view.estimate) }
    : { main: `${words.context} ${contextValue(view)}${hasNumber(view.contextTokens) && hasNumber(view.contextWindow) ? ' / ' + windowText(view.contextWindow, view.lang) : ''}`, ...(money ? { detail: money } : {}) }
  const windows = (view.quota?.rateLimits ?? []).filter(w => w.kind in words.quota.kinds && hasNumber(w.percentUsed))
  const wide = bandForecastGroups(view), narrow = bandQuotaGroups(view, true)
  windows.forEach((w, i) => {
    const [main, ...rest] = (wide[i] ?? '').split(separator)
    if (main) cards['quota:' + w.kind] = { main, ...(rest.length ? { detail: rest.join(separator) } : {}), ...(rest.length > 1 ? { short: rest[0] } : {}), ...(narrow[i] ? { narrow: narrow[i] } : {}) }
  })
  if (money) cards.money = { main: money }
  const cache = cacheHover(view.cost, view.lang, false), cacheNarrow = cacheHover(view.cost, view.lang, true)
  if (cache[0]) cards.cup = { main: cache[0], ...(cache[1] ? { detail: cache[1] } : {}), ...(cacheNarrow[0] ? { narrow: cacheNarrow[0] } : {}) }
  const helpers = view.helpersAlt ?? d1Word(view.lang, 'helpers.alt', { n: view.helpersCount ?? 0 }, view.helpersCount ?? 0)
  if (helpers) cards.helpers = { main: helpers }
  if (view.play?.stick && view.play.stick.endedAt === undefined) cards.stick = { main: playWord(view.lang, 'alt.stick', { time: view.play.stick.until }) }
  if (view.play?.breath) cards.light = { main: playWord(view.lang, 'alt.incense.breathing') }
  const busy = busyNeighbours(view).map(a => fill(view.neighbourBusyLabel ?? '{agent}', { agent: a.label }))
  if (busy.length) cards.neighbours = { main: busy.join(separator) }
  return cards
}

// The desktop band (DECISIONS 1017, 1018). At rest her script row (her name, then her line or a stage direction) runs on
// to the row below at the same indent, and her things stand on the floor row, right-aligned, the bag last; each thing is a
// keyed block that takes a tint under the pointer and opens its card above. Her picture is a keyed block too: the pointer
// on her opens Poke, Pat and Close on the floor row beside her, and her touch rows read a click on her as a poke and
// rubbing her as a pat. The one-row band keeps one row: her name, her line, her things and the bag.
// Hover reveals only work inside the keyed Box the pointer is on (a shared hover scope never revealed anything, 10-18).
// The pointer clients come from the hooks module: a Client's module is a literal read off the file that draws it.
export type DesktopClients = { touch: (row: number, columns: number) => RenderElement; press: (kind: string, columns: number) => RenderElement }
// `flow`: the surface places nothing absolutely and has no hover (VS Code's panel takes no position, left, right, top or
// bottom; the phone has no pointer to hover with), so the floor stands in the text column's last row, at its right end,
// with the ribbon's tag at its left, as on the desktop (owner 10-19: the phone as VS Code, as near the desktop as it goes).
export function desktopBand(ui: Elements['desktop'], view: View, size: BandSize, sprite: string, plan?: DesktopPlan, displaySpeech?: string, clients?: DesktopClients, flow: false | 'vscode' | 'mobile' = false): RenderElement {
  view = narrowVisitor(view, size.columns * COLUMN_PX < 480)
  const rawSpeech=displaySpeech??view.line?.text??view.said
  const bounded=safeBandSpeech(rawSpeech??'',view.line??{},true)
  const display=displaySlots(bounded.text,bounded.fit.slots)
  if(view.line)view={...view,line:{...view.line,text:display.text,slots:display.slots}}
  if(displaySpeech!==undefined)displaySpeech=display.text
  plan ??= planDesktop(view, size, displaySpeech)
  const { Box, Text, Svg, Button, Markdown } = ui
  const words = WORDS[view.lang]
  const said = displaySpeech ?? view.line?.text ?? view.said
  const aside = stageAside(view)
  const rawTouchAside = view.claudie ? undefined : view.touch === 'burst' ? words.touch.flustered : view.touch === 'pat' ? words.touch.patted : view.touch === 'poke' ? words.touch.poked : undefined
  const touchAside=rawTouchAside===undefined?undefined:stripStageMarkup(rawTouchAside)
  const directionItalic=stageItalic(view)
  const width = Number(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/.exec(sprite)?.[1]) || getMotionWidth(plan.height, view.band === 'compact')
  const offeringText = offeringLabel(view, plan.word)
  const commitDraw: CommitDraw = plan.row ? (plan.cells === false ? 'none' : 'row') : plan.cells === false ? 'none' : 'line'
  const commitSvg = commitDraw !== 'none' ? <Svg alt={contextAlt(view.context, view.lang, { offerings: { noReading: BAND_BOOK_WORDS[view.lang].noReading }, alt: words.alt }, view.estimate)} source={commitLineSvg(commitCount(view.context), view.squash, commitFit(view, commitDraw), commitScale(commitDraw))} width={commitLineWidth(commitCount(view.context), commitFit(view, commitDraw), view.squash, commitScale(commitDraw))} height={commitLineHeight(commitScale(commitDraw))} /> : null
  const place = plan.marker && view.place?.text ? (
    <Box key="coco:place" flexDirection="row" alignItems="center" flexShrink={0}>
      <Svg alt={view.place.alt ?? ''} source={placeSvg(view.place.dip)} width={16} height={22} />
      <Text color="inactive">{` ${view.place.text}`}</Text>
    </Box>
  ) : null
  const cost = view.quota?.costUSD
  const play = view.play, stillArt = view.d1ReducedMotion === true
  const breath = play?.breath ? { phaseMs: Math.round(Math.max(0, (play.at ?? play.breath.since) - play.breath.since) / 100) * 100, still: play.breath.still === true || stillArt } : undefined
  // Their battery for the 5-hour limit and their power bank for the week, each after its short name (owner 10-14).
  const quotaItems = bandQuotaItems(view)
  const quotaMode = plan.quota ?? 'full', half = quotaMode === 'small' || quotaMode === 'stack' ? 2 : 1
  const quotaItem = (item: QuotaBandItem) => <Box key={'coco:quota:' + item.kind} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
      {quotaMode === 'full' ? <Text color="inactive">{item.label}</Text> : null}
      <Svg source={item.picture} alt={item.alt} width={QUOTA_PICTURE_PX[item.kind] / half} height={24 / half} />
      {item.flag ? <Text color="claude" bold>{item.flag}</Text> : null}
    </Box>
  const money = cost !== undefined && bandSessionMoney(view) ? <Text color="inactive">{bandMoney(view,cost)}</Text> : null
  const cup = plan.cup && view.cost ? <Svg source={view.cost.warmEnabled?thermosSvg(2,true):cupSvg(view.cost.cache.state)} alt={cacheAlt(view.cost,view.lang,view.quota?.at??Date.now())} width={16} height={22}/> : null
  // Breathing: the light on the side of their shut laptop brightens as you breathe in and dims as you breathe out. VS
  // Code's band leaves it out (owner 10-19: 「呼吸灯在vscode的横条上毫无意义」).
  const bare = breath && !flow ? <Svg source={laptopLightSvg(breath.phaseMs, breath.still)} alt={playWord(view.lang,'alt.incense.breathing')} width={LIGHT_PX.width} height={LIGHT_PX.height} /> : null
  // Focus: their eight coral cells light one by one, then the time it ends; once it ends the full bar stays until it goes.
  const stick = play?.stick ? <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}><Svg source={focusBarSvg(play.stick, play.stick.endedAt ?? play.at ?? play.stick.startedAt, stillArt)} alt={play.stick.endedAt===undefined?playWord(view.lang,'alt.stick',{time:play.stick.until}):''} width={FOCUS_PX.width} height={FOCUS_PX.height} />{play.stick.endedAt===undefined?<Text color="inactive">{play.stick.until}</Text>:null}</Box> : null
  const leftPx = plan.height ? 12 + width + COLUMN_PX : 0
  const inset = plan.row && plan.showRight === false ? 0 : INSET // a protected line that sent his props away may use the inset
  const column = Math.max(0, size.columns * COLUMN_PX - inset - leftPx)
  const script=spokenScript(said??'',view.line?.slots)
  const slots=view.line?.slots??[]
  const parts = noBreakValues(spokenStyles(plan.parts ?? fittedParts(plan.speech ?? script.text,slots,slots.map(slot=>slot.value),script.text),script),slots,view.lang)
  const spoken = <Text wrap={plan.row ? 'truncate-end' : 'wrap'}>{parts.map(p => p.children?<Text wrap="truncate-end">{p.children.map(c=><Text bold={c.slot||undefined} italic={c.italic||undefined} wrap={c.noWrap?'truncate-end':undefined}>{c.text}</Text>)}</Text>:p.slot||p.noWrap||p.italic ? <Text bold={p.slot||undefined} italic={p.italic||undefined} wrap={p.noWrap?'truncate-end':undefined}>{p.text}</Text> : p.text)}</Text>
  const actionButtons=view.line?.buttons??(view.line?.button?[view.line.button]:[])
  const action = actionButtons.length&&plan.showButton!==false ? <Box flexDirection="row" flexShrink={0} columnGap={1}>{actionButtons.map(b=><Button key={b.key} label={b.label} onPress={() => {}} />)}</Box> : null
  const name = plan.name === undefined || view.claudie ? null : <Box flexShrink={0}><Text color={view.cue} bold>{plan.name}</Text></Box>
  const direction = touchAside&&!said ? cutDirection(touchAside, Math.max(0, column - planPx(plan.name ?? '', true)), view.lang) : plan.row&&said?undefined:plan.text
  const directionText = direction === undefined ? null : <Text color="inactive" italic={directionItalic||undefined} wrap="truncate-end">{`${gapBefore(direction, view.lang) ? '\u00a0' : ''}${direction}`}</Text>
  // The bag (DECISIONS 1017): the native button, 👜 at title size and its word; the word gives way, the button stays as big.
  const bagWord = !plan.row && plan.bagWord !== false ? view.bagEntry : undefined
  // A thing (or her picture) the pointer has left is drawn under a new key, which drops the hover the surface kept on it.
  const epoch = (kind: string) => view.hoverEpochs?.[kind] ? ':' + view.hoverEpochs[kind] : ''
  const bag = <Button key="coco:book:open" onPress={() => {}}><Text size="title">{words.marks.book}</Text>{bagWord ? <Text>{' ' + bagWord}</Text> : null}</Button>

  // His props in the one-row band stand at the right end of its row: helpers, the box, the incense, neighbours, the bag.
  const cueBefore = plan.name !== undefined || !!direction
  const rowProps = plan.row && plan.showRight !== false ? <Box flexDirection="row" alignItems="center" marginLeft={cueBefore ? 2 : 0} columnGap={1} flexShrink={0}>{desktopHelpers(ui,view,plan.helpers??'full')}{cup?<Box key="coco:cache:cup" flexShrink={0}>{cup}</Box>:null}{place}<Box flexDirection="row" alignItems="center" flexShrink={0}>{commitSvg}{offeringText ? <Text color={hasNumber(view.context) ? tone(view.context) : 'inactive'}>{offeringText}</Text> : null}</Box>{quotaItems.length ? <Box key="coco:quota" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>{quotaItems.map(quotaItem)}</Box> : money}{bare ? <Box key="coco:light" flexShrink={0}>{bare}</Box> : null}{stick ? <Box key="coco:stick" flexShrink={0}>{stick}</Box> : null}{plan.neighbours?desktopNeighbours(ui,view):null}{bag}</Box> : null
  const rowPropsPx = rowProps ? cueProps(view, { cup: plan.cup === true, word: plan.word, label: 'book', helpers: plan.helpers ?? 'full', neighbours: plan.neighbours === true, quota: plan.quota ?? 'full' }) + CUE_GAP + (plan.marker && view.place?.text ? markerPx(view) : 0) : 0

  // The floor at rest: each thing a keyed block with its card above it and, on the quota things, a press that opens the
  // bag's quota page.
  let floor: RenderElement | null = null, floorWidth = 0, flowCard: RenderElement | null = null
  if (!plan.row) {
    const state: CueState = { cup: plan.cup === true, word: plan.word, aside: 'none', label: 'book', helpers: plan.helpers ?? 'none', neighbours: plan.neighbours === true, quota: quotaMode, name: true, ...(plan.cells === false ? { cells: false as const } : {}), ...floorFields({ number: plan.number, bagWord: plan.bagWord, play: plan.play, pad: plan.pad } as CueState) }
    // A card opens over the script rows, so while a line that matters is showing (class 1 and up) the things keep only
    // their tint and their alt: no detail is drawn over it (SPEC 0.2 rule 8).
    const things = floorThings(view, state), cards = !flow && said && (view.line?.class ?? 0) >= 1 ? {} as Record<string, ThingCard> : thingCards(view), bagRoom = bagPx(view, state)
    floorWidth = things.reduce((sum, t) => sum + t.px, 0) + bagRoom + (place ? markerPx(view) : 0)
    const content: Record<string, RenderElement | null> = {
      ctx: <Box flexDirection="row" alignItems="center" flexShrink={0}>{commitSvg}{hasNumber(view.context) && plan.number !== false ? <Text color={tone(view.context)}>{' ' + contextValue(view)}</Text> : null}{hasNumber(view.context) && plan.word ? <Text color="inactive">{' ' + words.context}</Text> : null}</Box>,
      quota: <Box flexDirection="column" alignItems="flex-start" flexShrink={0}>{quotaItems.map(quotaItem)}</Box>,
      money, cup, helpers: desktopHelpers(ui, view, plan.helpers ?? 'none'), stick, light: bare, neighbours: desktopNeighbours(ui, view),
    }
    for (const item of quotaItems) content['quota:' + item.kind] = quotaItem(item)
    let right = bagRoom
    const blocks: RenderElement[] = []
    for (const thing of [...things].reverse()) {
      if (flow && thing.kind === 'light') continue
      const card = cards[thing.kind] ?? (thing.kind === 'quota' ? cards['quota:' + quotaItems[0]?.kind] : undefined)
      const fitted = card ? fitCard(card, Math.floor((column - right) / COLUMN_PX)) : undefined
      // every thing has its pointer layer: its leave tells the plugin to drop the card (the surface alone keeps it), and
      // on a battery or the money a click opens the quota page
      const cols = Math.max(1, Math.floor(thing.px / COLUMN_PX)), press = !!clients
      right += thing.px
      // With the pointer layers the plugin knows where the pointer is and draws one card, the thing under it: the surface's
      // own hover stayed on every thing the pointer had crossed, a minute long (his screenshots, 10-18). Without them the
      // surface's hover is all there is.
      const pointed = press ? view.pointerOn === thing.kind : undefined
      // VS Code has no hover: each thing is a dim button there, and a press opens its card in a row of its own above the
      // floor, the quota things' card with the button to their page (owner 10-19: 「横条里多出一行卡片」)
      if (flow) {
        // the thing's pictures stay as they are, and its words are pressed as dim buttons
        blocks.unshift(<Box key={'coco:flow-thing:' + thing.kind} flexDirection="row" alignItems="center" flexShrink={0} paddingX={plan.pad === false ? 0 : 1} {...(view.pointerOn === thing.kind ? { backgroundColor: 'userMessageBackground' } : {})}>{thingWords(content[thing.kind] ?? null, thing.kind, Button)}</Box>)
        const lines = card && view.pointerOn === thing.kind ? fitCard(card, Math.floor(column / COLUMN_PX) - 2) : undefined
        if (lines) flowCard = <Box key={'coco:thing-card:' + thing.kind} flexDirection="row" flexWrap="nowrap" justifyContent="flex-end">
          <Box flexDirection="column" alignItems="flex-end" flexShrink={1} minWidth={0} backgroundColor="userMessageBackground" paddingX={1}>
            {lines.lines.map((line, i) => <Text size="caption" weight={i ? undefined : 'semibold'} color={i ? 'inactive' : undefined} wrap="wrap">{line}</Text>)}
            {thing.kind === 'money' || thing.kind.startsWith('quota') ? <Button key="coco:thing:quota-page" label={BAND_BOOK_WORDS[view.lang].offerings} dimColor onPress={() => {}} /> : null}
          </Box>
        </Box>
        continue
      }
      blocks.unshift(<Box key={'coco:thing:' + thing.kind + epoch(thing.kind)} position="relative" flexDirection="row" alignItems="center" flexShrink={0} paddingX={plan.pad === false ? 0 : 1} {...(pointed === undefined ? { hover: { backgroundColor: 'userMessageBackground' } } : pointed ? { backgroundColor: 'userMessageBackground' } : {})}>
        {content[thing.kind] ?? null}
        {fitted && pointed !== false && !flow ? <Box position="absolute" right={0} top={-fitted.lines.length} width={fitted.cols} {...(pointed ? {} : { display: 'none', hover: { display: 'flex' } })} flexDirection="column" alignItems="flex-end" backgroundColor="userMessageBackground" paddingX={1}>
          {fitted.lines.map((line, i) => <Text size="caption" weight={i ? undefined : 'semibold'} color={i ? 'inactive' : undefined} wrap="truncate-end">{line}</Text>)}
        </Box> : null}
        {press ? <Box position="absolute" left={0} top={0} width={cols} height={1}>{clients.press(thing.kind, cols)}</Box> : null}
      </Box>)
    }
    floor = <Box key="coco:floor" {...(flow ? { flexWrap: 'nowrap' as const, marginLeft: 1 } : { position: 'absolute' as const, right: 0, bottom: 0 })} flexDirection="row" alignItems="flex-end" flexShrink={0}>
      {place}{blocks}<Box marginLeft={1} flexShrink={0}>{bag}</Box>
    </Box>
  }

  // The pointer on her (DECISIONS 1018): Poke, Pat (and M1's More actions) and Close stand beside her, on the floor row at
  // rest, after her name in a row. They take the room her things leave; More actions give way first, then Poke and Pat,
  // never Close. A protected line that sent the one-row band's things away takes the bag into them.
  const bookIn = plan.row && plan.showRight === false
  const closeLabel = words.hover.close
  const moreActions = view.moreActions ?? []
  const buttonPx = (labels: string[]) => (bookIn ? [...labels, words.marks.book] : labels).reduce((sum, label) => sum + planPx(label) + BUTTON_PAD, 0) + Math.max(0, labels.length - (bookIn ? 0 : 1)) * COLUMN_PX
  const nameEnd = plan.row && plan.name !== undefined ? speakerWidth(plan.name) + COLUMN_PX : 0
  const free = plan.row ? column - nameEnd - Math.ceil(rowPropsPx / COLUMN_PX) * COLUMN_PX : column - floorWidth - COLUMN_PX
  const fitsFree = buttonPx([closeLabel]) <= free
  const room = fitsFree ? free : column - nameEnd
  // VS Code wraps the floor row where they don't fit, so there Poke, Pat and Close always stay
  const labels = [[words.hover.poke, words.hover.pat, ...moreActions.map(b => b.label), closeLabel], [words.hover.poke, words.hover.pat, closeLabel], ...(flow ? [] : [[closeLabel]])].find(l => buttonPx(l) <= room) ?? (flow ? [words.hover.poke, words.hover.pat, closeLabel] : [closeLabel])
  const ribbon = view.ribbon?.visible ? { folder: view.ribbon.folder, px: 8 + COLUMN_PX + planPx(view.ribbon.folder, true) } : undefined
  // The session's folder stands before the buttons wherever the stretch holds both.
  const withRibbon = !!ribbon && buttonPx(labels) + ribbon.px + 2 * COLUMN_PX <= room
  const pictureCols = Math.ceil(width / COLUMN_PX)
  // The session's ribbon (DECISIONS 1023): with another session open, her ribbon stands beside her on the floor row with
  // the folder's name, so it says whose band this is. It takes only the room her things leave; where the name has no
  // room for a few letters, the bare ribbon goes back to the band's left edge.
  const tie = !!view.ribbon?.visible && !view.d1ReducedMotion && view.ribbon.tiedAt !== undefined && (view.ribbon.elapsed ?? 0) < 910
  const tagRoom = ribbon && !plan.row ? free - COLUMN_PX : 0
  const tag = ribbon && tagRoom >= 8 + COLUMN_PX + planPx('…') + 4 * COLUMN_PX ? <Box key="coco:ribbon-tag" {...(flow ? {} : { position: 'absolute' as const, left: 0, bottom: 0 })} height={1} width={Math.floor(Math.min(8 + COLUMN_PX + planPx(ribbon.folder) + COLUMN_PX, tagRoom) / COLUMN_PX)} flexDirection="row" alignItems="center" columnGap={1}>
    <Svg source={ribbonSvg(view.ribbon!.index, 18, tie, 8, view.ribbon!.elapsed ?? 0)} alt={view.ribbon!.alt ?? d1Word(view.lang, 'ribbon.alt', { folder: ribbon.folder })} width={8} height={18} />
    <Text color="inactive" wrap="truncate-end">{ribbon.folder}</Text>
  </Box> : null
  // VS Code's panel has no hover and places nothing absolutely, so there the same buttons stay drawn, dim until the
  // pointer is on them: after her name in a row, at the floor row's left at rest (owner 10-19: 「做成一直显示的小按钮」).
  const flowButtons = flow ? <Box key="coco:band:buttons" flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={1} flexShrink={0} marginLeft={plan.row ? 2 : 0}>
    {labels.includes(words.hover.poke) ? <Button key="coco:band:poke" label={words.hover.poke} dimColor onPress={() => {}} /> : null}
    {labels.includes(words.hover.pat) ? <Button key="coco:band:pat" label={words.hover.pat} dimColor onPress={() => {}} /> : null}
    {moreActions.filter(b => labels.includes(b.label)).map(b => <Button key={b.key} label={b.label} dimColor onPress={() => {}} />)}
    {bookIn ? <Button key="coco:book:open" label={words.marks.book} dimColor onPress={() => {}} /> : null}
    <Button key="coco:band:close" label={closeLabel} dimColor onPress={() => {}} />
  </Box> : null
  const strip = flow ? null : <Box position="absolute" left={pictureCols + 1 + Math.ceil(nameEnd / COLUMN_PX)} top={plan.row ? 0 : 2} width={Math.ceil((buttonPx(labels) + (withRibbon ? ribbon!.px + 2 * COLUMN_PX : 0)) / COLUMN_PX) + 1} height={1} display="none" hover={{ display: 'flex' }} flexDirection="row" alignItems="center" columnGap={2} backgroundColor="composerSidebarBackground">
    {withRibbon ? <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0} columnGap={1}><Svg source={ribbonSvg(view.ribbon!.index, 18, false, 8)} alt="" width={8} height={18} /><Text bold wrap="truncate-end">{ribbon!.folder}</Text></Box> : null}
    <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
      {labels.includes(words.hover.poke) ? <Button key="coco:band:poke" label={words.hover.poke} plain onPress={() => {}} /> : null}
      {labels.includes(words.hover.pat) ? <Button key="coco:band:pat" label={words.hover.pat} plain onPress={() => {}} /> : null}
      {moreActions.filter(b => labels.includes(b.label)).map(b => <Button key={b.key} label={b.label} plain onPress={() => {}} />)}
      {bookIn ? <Button key="coco:book:open" label={words.marks.book} plain onPress={() => {}} /> : null}
      <Button key="coco:band:close" label={closeLabel} plain onPress={() => {}} />
    </Box>
  </Box>
  // Her touch rows: one pointer client a row over her picture (a single client of three rows heard nothing, probe 4).
  const touchRows = plan.row ? 1 : Math.min(3, Math.ceil(plan.height / 21))
  const touch = clients ? <Box position="absolute" left={0} top={0} width={pictureCols} height={touchRows} flexDirection="column">
    {Array.from({ length: touchRows }, (_, row) => clients.touch(row, pictureCols))}
  </Box> : null
  const picture = plan.height ? (
    <Box key={'coco:picture' + epoch('picture')} flexShrink={0} position="relative">
      <Svg key="coco:picture" source={pictureColors(sprite)} alt={`${words.name}${aside?`, ${plain(aside)}`:''}${view.visit?.label&&!view.stageDirection?`, ${view.visit.label}`:''}, ${companionPatLabel(view.lang)}`} width={width} height={plan.height} isInteractive={ANIMATION_MODE === 'interactive-css' || ANIMATION_MODE === 'smil' ? true : undefined} />
      {POKE_ROUTE === 'markdown-overlay' ? <Box position="absolute" left={0} top={0}>
        <Markdown key="coco:band:poke:overlay" text={pictureLink(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${plan.height}"></svg>`, words.hover.poke)} pressableLinks={['file:///coco-poke']} onLinkPress={() => {}} />
      </Box> : null}
      {touch}
      {strip}
    </Box>
  ) : null
  return (
    <Box key="coco:band" backgroundColor="composerSidebarBackground" position="relative" flexDirection="row" {...(flow ? { flexWrap: 'nowrap' as const } : {})} alignItems="flex-end" padding={0}>
      <Box key="coco:ribbon-slot" flexShrink={0} alignSelf="flex-start"><Svg source={view.ribbon?.visible&&!tag?ribbonSvg(view.ribbon.index,plan.row?28:50,tie,12,view.ribbon.elapsed??0):EMPTY_12x1} alt={view.ribbon?.visible&&!tag?view.ribbon.alt??d1Word(view.lang,'ribbon.alt',{folder:view.ribbon.folder}):''} width={12} height={view.ribbon?.visible&&!tag?plan.row?28:50:1}/></Box>
      {picture}
      <Box key="coco:text-column" position="relative" flexDirection="column" alignSelf={plan.row?'center':'flex-start'} flexGrow={1} flexShrink={1} minWidth={0} {...(plan.row ? {} : flow ? { minHeight: 3, justifyContent: 'space-between' as const } : { height: 3 })} marginLeft={plan.height ? 1 : 0} marginRight={inset / COLUMN_PX}>
        {plan.row ? <Box flexDirection="row" alignItems="center" minWidth={0}>
          {name}
          {said ? <Box flexDirection="row" flexShrink={1} minWidth={0} columnGap={1}><Box flexShrink={1} minWidth={0}>{plan.name ? <Text>{gapBefore(plan.speech ?? said)}</Text> : null}{spoken}</Box>{action}</Box> : plan.aside === 'beside' && directionText ? <Box flexShrink={1} minWidth={0}>{directionText}</Box> : null}
          {plan.row ? flowButtons : null}
          <Box flexGrow={1} flexShrink={1} minWidth={0} />
          {rowProps}
        </Box> : said ? <Box flexDirection="row" alignItems="flex-start" minWidth={0}>
          {name}
          {plan.aside === 'beside' && directionText ? <Box flexShrink={0}>{directionText}</Box> : null}
          <Box flexDirection="row" flexWrap="wrap" alignItems="flex-end" columnGap={1} flexShrink={1} minWidth={0} marginLeft={name ? 1 : 0}><Box flexShrink={1} minWidth={0}>{spoken}</Box>{action}</Box>
        </Box> : <Box flexDirection="row" alignItems="flex-start" minWidth={0}>
          {name}
          {plan.aside === 'beside' && directionText ? <Box flexDirection="column" flexShrink={1} minWidth={0}>{directionText}{plan.rest !== undefined ? <Text color="inactive" italic={directionItalic||undefined} wrap="truncate-end">{plan.rest}</Text> : null}</Box> : null}
        </Box>}
        {flowCard}
        {flow && (floor || tag || flowButtons) && !plan.row ? <Box flexDirection="row" flexWrap="wrap" alignItems="flex-end" columnGap={1}>{tag}{flowButtons}<Box flexGrow={1} flexShrink={1} minWidth={0} />{floor}</Box> : floor}
        {flow ? null : tag}
      </Box>
    </Box>
  )
}

// Svg/Raster are API leaves without press callbacks. A plain Button beside the sleeping
// picture gives both surfaces a pointer, keyboard and accessible route back. On the desktop they doze there in
// the outfit they wear (their idle still until that outfit's data has the doze; the button alone before any of it).
export function desktopDoor(ui: Elements['desktop'], view: View, onWake: () => void): RenderElement {
  const { Box, Svg, Button } = ui
  const words = DOOR_WORDS[view.lang]
  const asleep = view.claudie && claudieReady(view.claudie) ? claudieSvg(view.claudie, 'nap', cocoWidth(DESKTOP_COMPACT), DESKTOP_COMPACT) : cocoStill(view.outfit === 'B' ? 'B' : 'A', 'nap', DESKTOP_COMPACT)
  return (
    <Box flexDirection="row" justifyContent="flex-end" alignItems="center">
      {asleep ? <Svg source={asleep} alt={words.alt} width={cocoWidth(DESKTOP_COMPACT)} height={DESKTOP_COMPACT} /> : null}
      <Box marginLeft={1}><Button key="coco:band:wake" label={words.wake} plain onPress={onWake} /></Box>
    </Box>
  )
}

export function terminalDoor(ui: Elements['terminal'], view: View, onWake: () => void): RenderElement {
  const { Box, Raster, Button } = ui
  const words = DOOR_WORDS[view.lang]
  return (
    <Box flexDirection="row" justifyContent="flex-end">
      <Raster key="coco:door:sleep" columns={DOOR_COLUMNS} rows={1} cells={sleepingDoorCells(view.colors)} />
      <Box marginLeft={1}><Button key="coco:band:wake" label={words.wake} plain onPress={onWake} /></Box>
    </Box>
  )
}
