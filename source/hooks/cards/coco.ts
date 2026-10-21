// Coco in the cards pane: which pictures lie in their corner and when. The pictures (hooks/cards-art.json, built by
// tools/cards/build-art.mjs and read by the pane the first time it draws them) are Svg sources with placeholders each
// play fills; this module checks the file, plans the layers and fills them, nothing here draws.
// Measured on the desktop (docs/cards/DESKTOP.md): a frame keeps playing while its source string stays the same, so a
// layer is filled from fixed arguments; the next part goes on top inside a hold and the one under it comes off
// LINGER_MS later; the tree holds rest plus two parts at most.
import type { CocoState, Layer } from './model'

/** How long a part stays after the next one is on top of it, or after its move ends. */
export const LINGER_MS = 400
/** Moves waiting to play, at most; more are dropped (a burst of hand-overs plays once). */
export const QUEUE_MAX = 2

export type Part = { from: number; svg: string }
export type MoveArt = { MS: number; PARTS: readonly Part[] }
export type Loops = { breathMs: number; swayMs: number }

/** Coco's moves and states, as tools/cards/moves.mjs names them. */
export type MoveName = 'hand' | 'rank'
export type StateName = 'shuffle' | 'dig' | 'wait' | 'emptybox' | 'album'
const MOVE_NAMES: readonly MoveName[] = ['hand', 'rank']
const STATE_NAMES: readonly StateName[] = ['shuffle', 'dig', 'wait', 'emptybox', 'album']

/**
 * Coco's pictures: at rest, the blank that holds a picture's room, the rest's breath and lean loops, how far their card
 * turns (the frames turn with it), each move in parts and each state's picture.
 */
export type Art = {
  readonly REST: string
  readonly SPACER: string
  readonly BREATH_MS: number
  readonly SWAY_MS: number
  readonly TILT: number
  readonly MOVES: Readonly<Record<MoveName, MoveArt>>
  readonly STATES: Readonly<Record<StateName, string>>
}

/** The pictures in `text`, or null when it is not what build-art.mjs writes. */
export function parseArt(text: string): Art | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const has = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
  const svg = (x: unknown) => typeof x === 'string' && x.startsWith('<svg')
  const ms = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0
  const move = (x: unknown) =>
    has(x) && ms(x.MS) && Array.isArray(x.PARTS) && x.PARTS.length > 0 && x.PARTS.every(p => has(p) && ms(p.from) && svg(p.svg))
  if (!has(value) || !svg(value.REST) || !svg(value.SPACER) || typeof value.TILT !== 'number') return null
  // the loops divide a rest's age (fill), so neither may be 0
  if (!ms(value.BREATH_MS) || !ms(value.SWAY_MS) || value.BREATH_MS === 0 || value.SWAY_MS === 0) return null
  const { MOVES: moves, STATES: states } = value
  if (!has(moves) || !MOVE_NAMES.every(n => move(moves[n])) || !has(states) || !STATE_NAMES.every(n => svg(states[n]))) return null
  return value as unknown as Art
}

/**
 * A picture of Coco's for the phone, drawn as an image as VS Code draws Svg (10-19), at `x`, `y` when it goes inside
 * another picture. The desktop draws a source as a page, and the pictures are drawn by the page's style on its html
 * and body, over an empty svg kept clear; here that style is laid on a page inside the picture, and the svg it keeps
 * clear would be the picture itself, so that rule is left without a match. Chrome draws such a page still: it does
 * not play the style's animations in an image (tried 10-19).
 */
export function asImage(art: string, w: number, h: number, x = 0, y = 0): string {
  const css = (/<style>([\s\S]*)<\/style>/.exec(art)?.[1] ?? '').replace(/(^|[};,\s])svg(?=\s*[{,])/g, '$1i')
  return `<svg xmlns="http://www.w3.org/2000/svg" x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<style>html,body{margin:0;height:100%}${css}</style>` +
    `<foreignObject width="${w}" height="${h}"><html xmlns="http://www.w3.org/1999/xhtml"><body/></html></foreignObject></svg>`
}

/**
 * A part's source for one play. `actMs`: how far into the move the part starts; `restAge`: how long Coco at rest
 * has been breathing when it starts. The same arguments always give the same string.
 */
export function fill(svg: string, mark: string, actMs: number, restAge: number, loops: Loops): string {
  const age = Math.max(0, restAge)
  return svg
    .replace('@@N@@', mark)
    .split('@@D@@').join(`${-Math.round(actMs)}ms`)
    .split('@@B@@').join(`${-Math.round(age % loops.breathMs)}ms`)
    .split('@@S@@').join(`${-Math.round(age % loops.swayMs)}ms`)
}

export const layerKey = (play: number, part: number) => `play${play}p${part}`

/** The layer of part `part` of play `play`, starting `startedAt + from` on the clock of a rest drawn at `restSince`. */
export function layerOf(move: string, art: MoveArt, part: number, play: number, startedAt: number, restSince: number): Layer {
  const from = art.PARTS[part]!.from
  return { key: layerKey(play, part), move, part, mark: `${layerKey(play, part)}t${startedAt}`, actMs: from, restAge: startedAt + from - restSince }
}

/** One step of a play: at `at` ms after it starts, put part `add` on top or take part `remove` off. */
export type Step = { at: number; add?: number; remove?: number }

/** A play's steps after its first part goes on (at 0): each later part on at its start, each part off LINGER_MS after the next is on, the last LINGER_MS after the move. */
export function steps(art: MoveArt): Step[] {
  const out: Step[] = []
  art.PARTS.forEach((p, i) => {
    if (i > 0) out.push({ at: p.from, add: i })
    out.push({ at: (art.PARTS[i + 1]?.from ?? art.MS) + LINGER_MS, remove: i })
  })
  return out.sort((a, b) => a.at - b.at || (a.add !== undefined ? -1 : 1))
}

/** When a play's last layer comes off, in ms after it starts. */
export const playEnd = (art: MoveArt) => art.MS + LINGER_MS

/**
 * Asks for a move. Returns the next state and whether a play starts now. While another move plays the ask waits in
 * the queue (a repeat of a waiting move is not queued twice); with motion off nothing plays.
 */
export function ask(c: CocoState, move: string, art: MoveArt, now: number, isMotionOff: boolean): { coco: CocoState; started: boolean } {
  if (isMotionOff) return { coco: c, started: false }
  if (c.move !== null) {
    if (c.queued.includes(move) || c.queued.length >= QUEUE_MAX) return { coco: c, started: false }
    return { coco: { ...c, queued: [...c.queued, move] }, started: false }
  }
  const play = c.play + 1
  return { coco: { ...c, play, move, layers: [layerOf(move, art, 0, play, now, c.restSince)] }, started: true }
}

/** Applies one step of play `play` started at `startedAt`; a step of a play that is no longer current changes nothing. */
export function apply(c: CocoState, play: number, step: Step, art: MoveArt, startedAt: number): CocoState {
  if (c.play !== play) return c
  if (step.add !== undefined) return { ...c, layers: [...c.layers, layerOf(c.move ?? '', art, step.add, play, startedAt, c.restSince)] }
  const layers = c.layers.filter(l => l.key !== layerKey(play, step.remove!))
  return layers.length === c.layers.length ? c : { ...c, layers }
}

/** Ends play `play`: the move is over and its layers gone; the next queued move, if any, is returned to start. */
export function finish(c: CocoState, play: number): { coco: CocoState; next: string | null } {
  if (c.play !== play || c.move === null) return { coco: c, next: null }
  const [next = null, ...rest] = c.queued
  return { coco: { ...c, move: null, layers: c.layers.filter(l => !l.key.startsWith(`play${play}p`)), queued: rest }, next }
}

/** Coco at rest has (re)started: the pane opened, or their picture was drawn anew. Pending plays are dropped. */
export function rested(c: CocoState, now: number): CocoState {
  return { ...c, restSince: now, move: null, layers: [], queued: [] }
}
