// Coco's skill cards (`/coco cards`): Coco deals the session's skills, subagents and slash commands as cards in a
// pane of their own, counts each real use, and sends the cards picked for the next message along with it as hidden
// context. register.tsx calls registerCards first, so these hooks stand outside Coco's own: `/coco cards` is taken
// before the /coco verbs, the picks join a message before Talk routing, and the tray's line sits above Coco's band. A
// plugin holds one hook without a matcher per event, so Coco's session.start and agent.spawn hooks call cardsStarted
// and cardsSpawned instead.
// What it relies on was measured on the desktop app (docs/cards/DESKTOP.md); the reasons behind the choices are in
// docs/cards/DECISIONS.md. Everything the pane shows comes from $.state; presses and typing arrive as ui.press and
// ui.input events and are handled there with a fresh `$`.
import type { EngineInterface, On, RenderElement } from 'claude-code'
import type { BookSort, Card, Catalog, CocoState, KindFilter, PaneState, Usage, View } from './model'
import { COCO_DEFAULT, PANE_DEFAULT, STORE_PREFS, STORE_USAGE } from './model'
import type { AgentEntry, CommandEntry } from './catalog'
import { agentFromFile, boxOrder, buildCatalog, firstLine, matches, withAgent } from './catalog'
import type { Rarity } from './usage'
import { addUse, markFresh, parseUsage, rarity, seen, toNext } from './usage'
import { pickBlock, toggle } from './picks'
import type { Lang } from './i18n'
import { STRINGS, langOf, listOf } from './i18n'
import { homePath, joinPath } from '../paths'
import type { Art, MoveName, StateName } from './coco'
import { apply, asImage, ask, fill, finish, parseArt, playEnd, rested, steps } from './coco'
import { FLAG, cocoCard, flagAt, stamp } from './card'
import { atom, read, update } from './state'

const PANE = 'coco-cards'
/** Coco's picture in CSS px: the frames' 320x400 at the size the owner approved on the desktop. */
const W = 112
const H = 140
/** At this many columns and more the pulled card and the tray stand beside the box instead of under it. */
const WIDE = 96
const SIDE = 38
/** One row of the pane in CSS px (13 px type on a 19 px line): how many rows a drawing takes. */
const ROW_PX = 19
/** Columns the box keeps clear at its right for Coco's card, as the draft's walls keep 150 px for it. */
const COCO_COLS = 21
/** Rows the desktop's search field takes, about: a field and its button on one line. */
const SEARCH_ROWS = 1.5
/** A blank picture: a drawing's room, or the gap that sets Coco's frame into their card to the pixel. */
const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
/** Rows a docked part runs on past the window's foot: the most the rounded window's place can be off. */
const SKIRT = 0.5
/**
 * How a narrow pane's sheet comes up, as [ms after the press, share of it showing]: the draft slides it up in 0.32 s,
 * easing out, and a Box cannot move, so it is drawn three times, most of the way in the first.
 */
const RISE = [[0, 0.45], [70, 0.82], [140, 1]] as const
/** How it goes back down, the same way: [ms after the press, share of it still showing]. */
const SINK = [[0, 0.55], [70, 0.18], [140, 0]] as const
/**
 * How a wide pane's pulled card comes out of the box to its column, as [ms after the press, share of the way still
 * to go]: the draft flies it there in 0.36 s, easing out; a Box cannot move, so it is drawn three times.
 */
const FLY = [[0, 0.55], [70, 0.18], [140, 0]] as const
/** The "+1" coming off a pulled card, as the draft fades it over 0.6 s: when, its opacity, how far up it has gone in px. */
const PEEL = [[0, 0.8, 1], [150, 0.45, 2.5], [300, 0.15, 3.5], [450, 0, 4]] as const
/** The motion switch's knob sliding over as motion comes on, as the draft's does in 0.2 s: when, how far over, 0 to 1. */
const KNOB = [[0, 0.4], [70, 0.8], [140, 1]] as const
/** The longest the pane's first opening in a session waits for the deck Claude's folders complete (openPane). */
const DEAL_WAIT_MS = 300

// On the desktop the card stock and the inks printed on it are the draft's, the same in both themes: names, words and
// buttons are Text in those inks with a blank press target laid over them (`hit` below), since a desktop Button inks
// its label in the theme's own color. Where the draft darkens a surface in dark mode (the kraft box, the manila
// dividers, the tray) the color is a film laid over one of the theme's surfaces: one film reads as the draft's light
// color on the light theme and close to its dark color on the dark one (docs/cards/DECISIONS.md, Colors). The card stock
// stays the draft's light cream: a film needs a box of its own under every card, which a big deck has no room for.
const BASE = 'userMessageBackground'
const FLOOR = 'clawd_background'
const PAPER = '#fffdf8'
const FILM = { kraft: '#9e6529c1', manila: '#ebd298e3', tray: '#5a2e001d', ghost: '#905921c3' } as const
type Film = keyof typeof FILM
/** The theme's own surface under each film: the tray's is the floor's, the rest the cards'. */
const UNDER: Record<Film, string> = { kraft: BASE, manila: BASE, tray: FLOOR, ghost: BASE }
/** The terminal has no films: each surface is one color there, and the paper the theme's own. */
const SOLID: Record<Film, string> = { kraft: '#b98a57', manila: '#ecd7a3', tray: FLOOR, ghost: '#6f5133' }
const INK = { text: '#2a241d', muted: '#5b5246', faint: '#6d6457', manila: '#3b2a17', manilaCount: '#5c4728', coral: '#d97757', onCoral: '#2b140a', stamp: '#9a4024', edge: '#d6cdbf', rule: '#3a86c84d', underline: '#d97757bf' }
const KIND = { skill: '#d97757', agent: '#3a86c8', command: '#2b2925' } as const
const PRINT: Record<Rarity, string | undefined> = { N: undefined, R: '#8b4a26', SR: '#3e4a57' }
/** The terminal's paper follows its theme, so there the command stripe and the prints are mid tones. */
const TERM = { paper: BASE, command: 'inactive', R: '#a85c32', SR: '#66707d', stamp: '#b4532f' }
/** Blank, about as wide as the type is tall, and never collapsed: a press target's label of them reaches across what it covers. */
const REACH = '\u2003'
const C = { kraft: '#b98a57', ghostText: '#f7ecdf', flagInk: '#2b140a' }
/** The steps of the shade over a card lifted over the pane, top to bottom: the draft's shadow ink, thin. */
const SHADE = ['#1e140a0a', '#1e140a12', '#1e140a1f'] as const
/** The pulled card's lift, under its foot: the draft's contact shadow, then its soft cast, in the same ink. */
const LIFT = ['#3b2a1738', '#3b2a1712'] as const

/**
 * The folded corner of a rare card: the paper cut along a 45-degree line shows the kraft behind, and the flap lies
 * on the face with its foil back up, copper for R, holographic for SR, in bands parallel to the fold.
 */
const FOIL = {
  R: ['#93502a', '#bb6c3e', '#e5a57d', '#bb6c3e', '#93502a', '#bb6c3e'],
  SR: ['#7d8997', '#bad4f1', '#f4c9dd', '#c3e8d5', '#f4e1ae', '#e4cdf0', '#7d8997'],
}
// the cut corner shows the kraft box behind the card, the dark theme's kraft where the picture follows the theme;
// a card off the box (`bare`) leaves the corner empty for what is drawn behind it
const foldSvg = (bands: string[]) => (size: number, bare = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><style>@media (prefers-color-scheme:dark){.c{fill:#7d5224}}</style><defs><linearGradient id="f" x1="0" y1="1" x2="1" y2="0">${bands
    .map((c, i) => `<stop offset="${(i / (bands.length - 1)).toFixed(2)}" stop-color="${c}"/>`)
    .join('')}</linearGradient></defs>${bare ? '' : `<path class="c" d="M0 0H16V16Z" fill="${C.kraft}"/>`}<path d="M0 0L16 16H0Z" fill="url(#f)"/><path d="M0 0L16 16" stroke="#3b2a17" stroke-opacity=".25" stroke-width=".6"/></svg>`
const FOLD: Record<'R' | 'SR', (size: number, bare?: boolean) => string> = { R: foldSvg(FOIL.R), SR: foldSvg(FOIL.SR) }
/** The draft's foil as a CSS gradient, which its glint slides across the flap (the draft's `--foil`). */
const FOIL_CSS = {
  R: 'linear-gradient(45deg,#93502a 0%,#bb6c3e 10%,#f4c6a6 18%,#bb6c3e 27%,#e5a57d 36%,#93502a 46%,#e5a57d 56%,#f4c6a6 64%,#bb6c3e 74%,#e5a57d 84%,#93502a 100%)',
  SR: 'linear-gradient(45deg,#7d8997 0%,#dfe7f0 9%,#f4c9dd 18%,#c3e8d5 27%,#f4e1ae 36%,#bad4f1 45%,#7d8997 53%,#e4cdf0 62%,#c3e8d5 71%,#f4e1ae 80%,#bad4f1 89%,#7d8997 100%)',
}
/**
 * The pulled card's flap, catching the light once as the card comes up: the draft's glint (1.1 s, after 0.2 s), its
 * foil sliding across the flap, drawn in an interactive frame so the animation plays. The card's id rides in the
 * source, so each card pulled gets a frame of its own and glints, and a redraw keeps the frame and does not.
 */
const glintSvg = (r: 'R' | 'SR', size: number, id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><style>/*${id.replace(/[^\w:.-]/g, '')}*/` +
  `body::after{content:"";position:absolute;inset:0;clip-path:polygon(0 0,100% 100%,0 100%);` +
  `background:linear-gradient(45deg,transparent 49.3%,rgba(59,42,23,.25) 50%,transparent 50.7%),${FOIL_CSS[r]};` +
  `background-size:100% 100%,200% 200%;background-position:0 0,0 100%;animation:g 1.1s cubic-bezier(.16,1,.3,1) .2s 1 both}` +
  `@keyframes g{to{background-position:0 0,100% 0}}` +
  `@media (prefers-reduced-motion:reduce){body::after{animation:none;background-position:0 0,100% 0}}</style></svg>`

/** The pulled card's use-count stamp, as an Svg's picture and size. */
function stampOf(text: string): { source: string; width: number; height: number } {
  const { svg, w, h } = stamp(text, INK.stamp)
  return { source: svg, width: w, height: h }
}

/** A strip's small hand-placed offset in columns, the same for a card every time (docs/cards/DESIGN.md, Shapes). */
function jitter(id: string): [number, number] {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return [(h % 3) * 0.3, ((h >> 3) % 3) * 0.3]
}

const catalogAtom = atom({ plugin: 'coco', key: 'cardsCatalog' } as const, { status: 'loading', cards: [] } as Catalog)
const usageAtom = atom({ plugin: 'coco', key: 'cardsUsage' } as const, {} as Usage)
const trayAtom = atom({ plugin: 'coco', key: 'cardsTray' } as const, [] as string[])
const paneAtom = atom({ plugin: 'coco', key: 'cardsPane' } as const, PANE_DEFAULT)
const cocoAtom = atom({ plugin: 'coco', key: 'cardsCoco' } as const, COCO_DEFAULT)

/**
 * The tray's names as the band shows them. Coco's band answers its first drawing before it reads anything
 * (tools/tests/b1b-first-answer.test.tsx holds that drawing to no host call), so the band's hook reads the names from
 * here instead of $.state, and each change to the tray or the deck asks for the band again.
 */
let bandNames: readonly string[] = []

async function syncBand($: EngineInterface): Promise<void> {
  const [tray, catalog] = await Promise.all([read($, trayAtom), read($, catalogAtom)])
  const names = tray.map(id => catalog.cards.find(c => c.id === id)?.name).filter((n): n is string => !!n)
  if (names.length === bandNames.length && names.every((n, i) => n === bandNames[i])) return
  bandNames = names
  $.ui.invalidate('ui.render')
}

/** Writes the tray, then brings the band's names up to date. */
async function setTray($: EngineInterface, change: (tray: string[]) => string[]): Promise<void> {
  await update($, trayAtom, change)
  await syncBand($)
}

// The module's own memory, which a reload starts over (the atoms above are the host's and stay).
/** Coco's language as the rest of the plugin resolved it (`zh` is Simplified Chinese), read when it is needed. */
let cocoLang: () => string = () => 'en'
const lang = (): Lang => langOf(cocoLang())
/**
 * Whether the pane is up, so Coco's moves play. A request to draw it says so as well as the mod's own open: the pane
 * can be up without one, after a reload or opened from the desktop, and then Coco's moves never played
 * (docs/cards/DESKTOP.md).
 */
let isPaneOpen = false
/** The session's folder, whose .claude/skills holds the project's own skills. */
let cwd = ''
/** Subagent types offered this session; agent.offer is the only listing of them. */
const offered = new Map<string, AgentEntry>()
/** The deals begun (loadCatalog), so a deal that began earlier and ends later does not lay its deck over the newer one. */
let deals = 0
/** Bumped to draw the search field anew, empty (clearing it); otherwise the person's typing stays in it. */
let searchGen = 0
/** Whether the last drawing docked a pulled card's sheet at the window's foot (a narrow pane on the desktop). */
let sheetDocks = false
/** Coco's pictures once read, and the read that gets them (pictures below). */
let art: Art | null = null
let artRead: Promise<Art | null> | null = null

// Buttons and the search field are made once and the same element returned on every redraw: a new element
// retires the handle the desktop page holds, and the click that focuses the pane redraws it, so a fresh element
// would lose that first press (docs/cards/DESKTOP.md). Elements a redraw did not use are let go.
const made = new Map<string, unknown>()
let usedNow = new Set<string>()
function once<T>(sig: string, make: () => T): T {
  usedNow.add(sig)
  let el = made.get(sig) as T | undefined
  if (el === undefined) {
    el = make()
    made.set(sig, el)
  }
  return el
}
const noop = () => {}

/** Under the desktop pane's caps (one tree under 262,144 characters, 2,000 nodes, depth 32), with some margin. */
const CAPS = { chars: 250000, nodes: 1900, depth: 30 }
/** What the engine adds to each Button and Input as it sends the tree: `"press":{"plugin":…,"handle":…}`, with room. */
const HANDLE = 64
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }
/** Whether a drawn tree stays under CAPS: its nodes and depth walked, its characters counted as the desktop gets them. */
export function fits(tree: unknown): boolean {
  let nodes = 0
  let depth = 0
  let handles = 0
  const walk = (x: unknown, d: number): void => {
    if (Array.isArray(x)) return x.forEach(y => walk(y, d))
    if (!x || typeof x !== 'object') return
    nodes += 1
    depth = Math.max(depth, d)
    const n = x as Node
    if (n.type === 'Button' || n.type === 'Input') handles += 1
    walk(n.children ?? n.props?.children, d + 1)
  }
  walk(tree, 1)
  return nodes < CAPS.nodes && depth < CAPS.depth && JSON.stringify(tree).length + handles * HANDLE < CAPS.chars
}

/** Counts drawings, so each one's hair (see `stirred`) differs from the last one's. */
let stirs = 0
/**
 * The tree with every Box around a moving picture given a minimum width `hair` columns over its own, a few
 * thousandths, which no one can see. The desktop keeps a moving picture's frame and the boxes around it from one
 * drawing to the next, lays each new box in above the old one it replaces and only then takes the old one out; when
 * the page laid out in between, it took the cards in the window for pushed down, scrolled after them, and stayed
 * there once the old cards were gone. A page follows nothing in a box whose size has just changed, so with the hair
 * different on every drawing the window stays where the person left it (docs/cards/DESKTOP.md). A Box laid in a row with
 * no minimum width of its own is passed over, since any would let it shrink below its content; boxes with no moving
 * picture come back as they were, the same elements.
 */
export function stirred(tree: unknown, hair: number): unknown {
  const walk = (x: unknown, inRow: boolean): [unknown, boolean] => {
    if (Array.isArray(x)) {
      let moving = false
      const out = x.map(y => {
        const [z, m] = walk(y, inRow)
        moving ||= m
        return z
      })
      return moving ? [out, true] : [x, false]
    }
    if (!x || typeof x !== 'object') return [x, false]
    const n = x as Node
    if (n.type === 'Svg') return [x, n.props?.isInteractive === true]
    if (n.type !== 'Box') return [x, false]
    const p = n.props ?? {}
    const row = p.flexDirection === undefined || String(p.flexDirection).startsWith('row')
    const [children, moving] = walk(n.children, row)
    if (!moving) return [x, false]
    const own = p.minWidth
    const free = p.position === 'absolute' || !inRow || typeof own === 'number'
    const minWidth = !free || typeof own === 'string' ? own : Math.round(((typeof own === 'number' ? own : 0) + hair) * 1000) / 1000
    return [{ ...n, props: minWidth === undefined ? p : { ...p, minWidth }, children }, true]
  }
  return walk(tree, false)[0]
}

/**
 * Deals the deck: commands and skills from the command list, which of them are skills, and the offered agents. With
 * `withFolders`, also the names in the person's and the project's .claude/skills and their .claude/agents definitions:
 * Claude's own folders, which the cards read only once the person has opened them (promise B8). Until then a user
 * command may be a skill hidden from the model, which only its folder tells apart, so its runs wait (parkRun).
 */
async function loadCatalog($: EngineInterface, withFolders: boolean): Promise<void> {
  const deal = ++deals
  // a deck already dealt stays drawn while it is dealt again
  if ((await read($, catalogAtom)).status !== 'ready') await update($, catalogAtom, (c): Catalog => ({ ...c, status: 'loading' }))
  try {
    const commands = (await $.command.list()) as unknown as CommandEntry[]
    const skillNames = new Set<string>()
    try {
      const usage = await $.session.usage({ breakdown: 'summary' })
      const front = (usage.context.breakdown as { skills?: { skillFrontmatter?: { name: string; pluginName?: string }[] } } | undefined)?.skills?.skillFrontmatter ?? []
      for (const s of front) {
        skillNames.add(s.name)
        if (s.pluginName) skillNames.add(`${s.pluginName}:${s.name}`)
      }
    } catch {}
    const skillDirs = new Set<string>()
    const agents = new Map<string, AgentEntry>()
    if (withFolders) {
      const home = homePath(await $.env.get('HOME'), await $.env.get('USERPROFILE'))
      for (const root of [home, cwd]) {
        if (!root) continue
        try {
          for (const entry of await $.fs.list(joinPath(root, '.claude', 'skills'))) skillDirs.add(entry.name)
        } catch {}
      }
      // The person's own subagents, from their definition files (name and description only), so they are dealt
      // before the first message; agent.offer, which first fires as that message's tools are composed, replaces them.
      // A project's file wins over the user's of the same name, as in Claude Code.
      for (const [root, source] of [[home, 'userSettings'], [cwd, 'projectSettings']] as const) {
        if (!root) continue
        try {
          for (const entry of await $.fs.list(joinPath(root, '.claude', 'agents'))) {
            if (entry.kind === 'dir' || !entry.name.endsWith('.md')) continue
            try {
              const a = agentFromFile(await $.fs.read(joinPath(root, '.claude', 'agents', entry.name)), entry.name)
              if (a) agents.set(a.name, { agent: a.name, description: a.description, source })
            } catch {}
          }
        } catch {}
      }
    }
    for (const [name, a] of offered) agents.set(name, a)
    const cards = buildCatalog({ commands, skillNames, skillDirs, agents: [...agents.values()] })
    if (deal !== deals) return
    await update($, catalogAtom, (): Catalog => ({ status: 'ready', cards, hasFolders: withFolders }))
    if (withFolders) await settleRuns($, cards)
    await syncBand($)
  } catch {
    if (deal === deals) await update($, catalogAtom, (c): Catalog => ({ ...c, status: 'error' }))
  }
}

async function savePrefs($: EngineInterface, pane: PaneState): Promise<void> {
  try {
    await $.store.set(STORE_PREFS, { view: pane.view, sort: pane.sort, isMotionOff: pane.isMotionOff, line: pane.line })
  } catch {}
}

/**
 * Brings an element of the pane into view once the redraw that draws it is in. The pane is one scroller (a Box
 * cannot scroll on its own), so a card pulled deep in a long box would otherwise open its face out of sight.
 */
function reveal($: EngineInterface, key: string, block: 'start' | 'nearest' | 'center'): void {
  $.clock.after(80, () => void $.ui.scroll({ to: { key }, in: PANE, block }).catch(() => undefined))
}

/**
 * Moves the pane's focus ring onto element `key`, where the draft moves the focus. It waits out the sheet's steps,
 * since the focus brings an element into view and could scroll the clip a rising sheet is drawn in.
 */
function focusOn($: EngineInterface, key: string): void {
  $.clock.after(RISE[2][0] + 40, () => void $.ui.focus({ requestId: PANE, key }).catch(() => undefined))
}

/**
 * Coco's pictures (hooks/cards-art.json), read the first time a surface that draws them draws the pane, so a session
 * that never opens it never loads them. Null when the file cannot be read; the pane then draws in words, as on a
 * surface without pictures, until it is opened again.
 */
function pictures($: EngineInterface): Promise<Art | null> {
  artRead ??= $.fs.read(joinPath($.plugin.root, 'hooks', 'cards-art.json')).then(parseArt, () => null).then(a => (art = a))
  return artRead
}

async function openPane($: EngineInterface): Promise<boolean> {
  // a read that failed is tried again
  if (art === null) artRead = null
  // Claude's folders are read now that the person opens the cards (loadCatalog). The pane waits a moment for the deck
  // they complete, so that a skill hidden from the model does not open among the commands and then move.
  if (!(await read($, catalogAtom)).hasFolders) {
    const dealt = bringsCoco($, () => loadCatalog($, true)).catch(() => undefined)
    let giveUp = () => {}
    const timer = $.clock.after(DEAL_WAIT_MS, () => giveUp())
    await Promise.race([dealt, new Promise<void>(done => (giveUp = done))])
    timer.cancel()
  }
  // Coco says the next of their lines each time the pane opens, never the same one twice running
  await savePrefs($, await update($, paneAtom, (p): PaneState => ({ ...p, line: p.line === undefined ? 0 : (((p.line + 1) % 3) as 0 | 1 | 2) })))
  const placed = await $.ui.open({ id: PANE, title: STRINGS[lang()].title })
  isPaneOpen = placed?.isPlaced === true
  const now = await $.clock.now()
  await update($, cocoAtom, c => rested(c, now))
  return isPaneOpen
}

/** Starts a move over Coco at rest, or queues it behind the one playing; timers lay and lift each part. */
async function playMove($: EngineInterface, move: MoveName): Promise<void> {
  // no pictures read, nothing to play: the pane has not drawn them
  const moveArt = art?.MOVES[move]
  if (!moveArt) return
  const pane = await read($, paneAtom)
  const now = await $.clock.now()
  let started = false
  const coco = await update($, cocoAtom, c => {
    // Coco's card stands in the box only; with the book open the move would play out of sight
    const r = ask(c, move, moveArt, now, pane.isMotionOff || !isPaneOpen || pane.view === 'book')
    started = r.started
    return r.coco
  })
  if (!started) return
  const play = coco.play
  for (const step of steps(moveArt)) $.clock.after(step.at, () => void update($, cocoAtom, c => apply(c, play, step, moveArt, now)))
  $.clock.after(playEnd(moveArt), () => {
    void (async () => {
      let next: string | null = null
      await update($, cocoAtom, c => {
        const r = finish(c, play)
        next = r.next
        return r.coco
      })
      if (next && art && next in art.MOVES) await playMove($, next as MoveName)
    })()
  })
}

/** Counts one real use of card `id`; a rank-up makes Coco cheer. */
async function countUse($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  let rankedUp = false
  const usage = await update($, usageAtom, u => {
    const r = addUse(u, id, now)
    rankedUp = r.rankedUp
    return r.usage
  })
  try {
    await $.store.set(STORE_USAGE, usage)
  } catch {}
  await update($, paneAtom, (p): PaneState => ({ ...p, fresh: markFresh(p.fresh, id) }))
  if (rankedUp) await playMove($, 'rank')
}

/**
 * Counts a slash command the person ran, if it is one of the deck's cards. Its hook does not wait for this: Coco's own
 * command.run hook starts work of its own once the command has run (the bag's socks), and a command answers no later
 * with the cards than without them.
 */
async function countCommand($: EngineInterface, command: string): Promise<void> {
  try {
    const { cards, hasFolders } = await read($, catalogAtom)
    const card = cards.find(c => c.id === `command:${command}`)
    if (!card) return
    if (!hasFolders && (card.source === 'user' || card.source === 'project')) await parkRun($, command)
    else await countUse($, card.id)
  } catch {}
}

/**
 * Keeps a run of the person's or the project's command `name` while Claude's folders are unread: it may be a skill
 * hidden from the model, which skill.prompt counts. The run waits among the counts under `run:` (none of them a card's)
 * until the deck is dealt with the folders, and goes with the counts into the store meanwhile.
 */
async function parkRun($: EngineInterface, name: string): Promise<void> {
  const now = await $.clock.now()
  const usage = await update($, usageAtom, u => addUse(u, `run:${name}`, now).usage)
  try {
    await $.store.set(STORE_USAGE, usage)
  } catch {}
}

/** Counts the parked runs (parkRun) of the commands in `cards`, dealt with Claude's folders, and drops the others. */
async function settleRuns($: EngineInterface, cards: readonly Card[]): Promise<void> {
  if (!Object.keys(await read($, usageAtom)).some(id => id.startsWith('run:'))) return
  let settled: string[] = []
  const usage = await update($, usageAtom, u => {
    settled = []
    const out: Usage = {}
    for (const [id, use] of Object.entries(u)) {
      if (!id.startsWith('run:')) {
        out[id] ??= use
        continue
      }
      const card = `command:${id.slice(4)}`
      if (!cards.some(c => c.id === card)) continue
      const had = out[card] ?? u[card]
      out[card] = { n: (had?.n ?? 0) + use.n, last: Math.max(had?.last ?? 0, use.last) }
      settled.push(card)
    }
    return out
  })
  try {
    await $.store.set(STORE_USAGE, usage)
  } catch {}
  if (settled.length > 0) await update($, paneAtom, (p): PaneState => ({ ...p, fresh: settled.reduce((f, id) => markFresh(f, id), p.fresh) }))
}

async function cardById($: EngineInterface, id: string): Promise<Card | undefined> {
  return (await read($, catalogAtom)).cards.find(c => c.id === id)
}

/** What a press on one of the pane's elements does, by the element's key. */
async function onPress($: EngineInterface, key: string): Promise<void> {
  const [kind, arg = ''] = key.split(/:(.*)/s)
  const pane = (fn: (p: PaneState) => PaneState) => update($, paneAtom, fn)
  // a sheet going back down still shows its buttons; a second press on them (a double click) does nothing
  if ((kind === 'take' || kind === 'takeup' || kind === 'type' || kind === 'back') && (await read($, paneAtom)).sinking !== undefined) return
  /** Puts the pulled card back; a docked sheet goes down in steps, as the draft's slides down, holding its card. */
  const close = async () => {
    const was = await read($, paneAtom)
    const sinks = sheetDocks && !was.isMotionOff && was.pulled !== null
    await pane(p => ({ ...p, pulled: null, fly: undefined, rise: sinks ? SINK[0][1] : undefined, sinking: sinks ? (p.pulled ?? undefined) : undefined }))
    if (!sinks) return
    for (const [at, to] of SINK.slice(1)) {
      $.clock.after(at, () =>
        void pane(q => (q.sinking === undefined ? q : to <= 0 ? { ...q, sinking: undefined, rise: undefined } : { ...q, rise: Math.min(q.rise ?? 1, to) })))
    }
  }
  if (kind === 'card') {
    if ((await read($, paneAtom)).pulled === arg) return close()
    // a sheet coming up from the window's foot rises in steps; one already up just shows the new card
    const rises = sheetDocks
    const p = await pane(p => ({
      ...p,
      pulled: arg,
      fresh: seen(p.fresh, arg),
      sinking: undefined,
      // its "+1" comes off in steps, as the draft's fades
      peel: !p.isMotionOff && (p.fresh ?? []).includes(arg) ? { id: arg, step: 0 } : p.peel,
      rise: rises && !p.isMotionOff && p.pulled === null ? RISE[0][1] : p.rise,
      // on a wide pane every card pulled comes out of the box, as the draft's flies
      fly: !rises && !p.isMotionOff ? FLY[0][1] : undefined,
    }))
    if (p.peel?.id === arg && p.peel.step === 0) {
      PEEL.slice(1).forEach(([at, o], i) =>
        $.clock.after(at, () => void pane(q => (q.peel?.id !== arg ? q : { ...q, peel: o <= 0 ? undefined : { id: arg, step: i + 1 } }))))
    }
    if (p.fly !== undefined) {
      for (const [at, to] of FLY.slice(1)) {
        $.clock.after(at, () =>
          void pane(q => (q.fly === undefined || q.pulled !== arg ? q : { ...q, fly: to <= 0 ? undefined : Math.min(q.fly, to) })))
      }
    }
    // a docked sheet stands in the window by itself; asking for it could scroll the clip it rises in. There the
    // focus goes to its main button, as the draft's does
    if (!rises) reveal($, 'face', 'nearest')
    else focusOn($, `${arg.startsWith('command:') ? 'type' : 'takeup'}:${arg}`)
    if (p.rise !== undefined) {
      for (const [at, to] of RISE.slice(1)) {
        $.clock.after(at, () =>
          void pane(q => (q.rise === undefined || q.sinking !== undefined ? q : { ...q, rise: to >= 1 ? undefined : Math.max(q.rise, to) })))
      }
    }
  } else if (kind === 'take' || kind === 'takeup') {
    const card = await cardById($, arg)
    if (!card) return
    let added = false
    await setTray($, t => {
      const next = toggle(t, card)
      added = next.length > t.length
      return next
    })
    // from the sheet the card goes back, and the focus to its slot in the box, as the draft's put-back
    if (kind === 'takeup') {
      await close()
      focusOn($, `card:${arg}`)
    }
    if (added) await playMove($, 'hand')
  } else if (kind === 'type') {
    const card = await cardById($, arg)
    if (!card) return
    const box = await $.prompt.read()
    await $.prompt.fill({ text: `/${card.name} ${box.text.replace(/^\/\S*\s*/, '')}`.trimEnd() + ' ', mode: 'replace' })
  } else if (kind === 'back') {
    const was = (await read($, paneAtom)).pulled
    await close()
    // back to where the person was in the box, as the draft returns the focus to the card's slot
    if (was) {
      reveal($, `card:${was}`, 'center')
      focusOn($, `card:${was}`)
    }
  } else if (kind === 'jump') {
    // the group's divider moves up under the tabs and the window stays put (owner's choice, docs/cards/DECISIONS.md)
    await pane(p => ({ ...p, lead: arg }))
  } else if (kind === 'untray') {
    await setTray($, t => t.filter(id => id !== arg))
  } else if (kind === 'allback') {
    await setTray($, () => [])
  } else if (kind === 'kind') {
    await pane(p => ({ ...p, kind: arg as KindFilter }))
  } else if (kind === 'view') {
    const p = await pane(p => ({ ...p, view: arg as View }))
    await savePrefs($, p)
  } else if (kind === 'sort') {
    const p = await pane(p => ({ ...p, sort: arg as BookSort }))
    await savePrefs($, p)
  } else if (kind === 'motion') {
    // turned on, the knob slides over in steps; turned off, it goes at once, as every move does with motion off
    const p = await pane(p => ({ ...p, isMotionOff: !p.isMotionOff, knob: p.isMotionOff ? KNOB[0][1] : undefined }))
    if (p.knob !== undefined) {
      for (const [at, to] of KNOB.slice(1)) {
        $.clock.after(at, () => void pane(q => (q.knob === undefined ? q : { ...q, knob: to >= 1 || q.isMotionOff ? undefined : Math.max(q.knob, to) })))
      }
    }
    if (p.isMotionOff) await update($, cocoAtom, c => ({ ...c, move: null, layers: [], queued: [] }))
    await savePrefs($, p)
  } else if (kind === 'clearq') {
    searchGen += 1
    await pane(p => ({ ...p, query: '' }))
    focusOn($, 'q')
  } else if (kind === 'retry') {
    await loadCatalog($, true)
  }
}

/** Which state picture stands in for Coco at rest, if any, and the line under the bar that goes with it. */
function stateOf(catalog: Catalog, pane: PaneState, shown: number): StateName | null {
  if (catalog.status === 'loading') return 'shuffle'
  if (catalog.status === 'error') return 'emptybox'
  if (pane.view === 'book') return 'album'
  if (catalog.cards.length === 0) return 'wait'
  if (shown === 0) return pane.query ? 'dig' : 'wait'
  return null
}

/** Whether the box stands drawn with cards in it, and so Coco's card in its corner (stateOf gives no state). */
function cocoIn(catalog: Catalog, pane: PaneState): boolean {
  return stateOf(catalog, pane, catalog.cards.filter(c => (pane.kind === 'all' || c.kind === pane.kind) && matches(c, pane.query)).length) === null
}

/**
 * Runs a change and, when it brings Coco's card back into the drawing, notes that Coco's frame at rest starts its loops
 * over, drawn anew; the moves after it keep in step from there. A drawing may not write, so the handler does it.
 */
async function bringsCoco($: EngineInterface, change: () => Promise<unknown>): Promise<void> {
  const was = cocoIn(await read($, catalogAtom), await read($, paneAtom))
  await change()
  if (was || !cocoIn(await read($, catalogAtom), await read($, paneAtom))) return
  const now = await $.clock.now()
  await update($, cocoAtom, (c): CocoState => ({ ...c, restSince: now }))
}

/**
 * Loads the counts and the pane's settings and deals the deck as a session starts. A plugin holds one session.start hook
 * without a matcher, so Coco's calls this once the start has run. Claude's folders wait for the person to open the cards
 * (loadCatalog); a reload deals them again when the deck held them, since the person opened the cards this session.
 */
export async function cardsStarted($: EngineInterface, sessionCwd: string): Promise<void> {
  cwd = sessionCwd
  try {
    const stored = parseUsage(await $.store.get(STORE_USAGE))
    await update($, usageAtom, () => stored)
    const prefs = (await $.store.get(STORE_PREFS)) as Partial<PaneState> | undefined
    if (prefs) {
      await update($, paneAtom, (p): PaneState => ({
        ...p,
        view: prefs.view === 'book' ? 'book' : 'box',
        sort: prefs.sort === 'uses' || prefs.sort === 'name' ? prefs.sort : 'group',
        isMotionOff: prefs.isMotionOff === true,
        line: prefs.line === 0 || prefs.line === 1 || prefs.line === 2 ? prefs.line : undefined,
      }))
    }
  } catch {}
  const opened = await read($, catalogAtom).then(c => c.hasFolders === true, () => false)
  void bringsCoco($, () => loadCatalog($, opened))
}

/** Counts a subagent's card once it was asked for; Coco's agent.spawn hook calls it, being the plugin's only one. */
export async function cardsSpawned($: EngineInterface, subagentType: string): Promise<void> {
  try {
    await countUse($, `agent:${subagentType}`)
  } catch {}
}

/** Adds the cards' hooks. `language` gives Coco's language code when asked. */
export function registerCards(on: On, language: () => string): void {
  cocoLang = language

  // `/coco cards` opens the pane; every other /coco verb goes on to Coco's own. Like Coco's replies, a word about a
  // pane that could not be placed goes to a toast.
  on('command.run', { command: 'coco' }, async ($, e, next) => {
    if (e.args.trim().toLowerCase().split(/\s+/)[0] !== 'cards') return next(e)
    if (!(await openPane($))) $.ui.toast(STRINGS[lang()].notPlaced, { timeoutMs: 8000 })
    return {}
  })

  // The same pane from its button at the top of Coco's bag, on every page (book.tsx, owner 10-19).
  on('ui.press', { element: 'coco:cards:open' }, async ($, e) => {
    if (!(await openPane($))) $.ui.toast(STRINGS[lang()].notPlaced, { timeoutMs: 8000 })
    return { element: e.element }
  })

  // A slash command the person ran at the prompt or through Remote Control counts for its card; a plugin's run does not,
  // and a skill typed as /name counts at skill.prompt instead. The matcher also keeps this hook apart from Coco's: a
  // plugin holds one command.run hook without a matcher.
  on('command.run', { origin: [{ kind: 'composer' }, { kind: 'bridge' }] }, async ($, e, next) => {
    const ran = await next(e)
    void countCommand($, e.command)
    return ran
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const ran = await next(e)
    await countUse($, `skill:${e.skill}`)
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.offer', async ($, e, next) => {
    const entry: AgentEntry = { agent: e.agent, description: e.description, source: e.source, provider: e.provider as AgentEntry['provider'] }
    offered.set(e.agent, entry)
    const catalog = await read($, catalogAtom)
    if (catalog.status === 'ready') {
      const cards = withAgent(catalog.cards, entry)
      if (cards !== catalog.cards) {
        await update($, catalogAtom, c => ({ ...c, cards: [...withAgent(c.cards, entry)] }))
        await syncBand($)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The picked cards ride along with a message the person sent themselves, at the prompt or through Remote Control (not
  // a task's notification or a plugin's message), then go back in the box.
  on('prompt.submit', { origin: [{ kind: 'composer' }, { kind: 'bridge' }] }, async ($, e, next) => {
    const tray = await read($, trayAtom)
    if (tray.length === 0) return next(e)
    const { cards } = await read($, catalogAtom)
    const picked = tray.map(id => cards.find(c => c.id === id)).filter((c): c is Card => !!c)
    const block = pickBlock(picked)
    if (!block) return next(e)
    const result = await next({ ...e, context: [...(e.context ?? []), block] })
    if (!(result as { drop?: unknown } | undefined)?.drop) {
      await setTray($, () => [])
      // what went along is the model's to read alone, so the person is told which cards it was (owner, 2026-10-15)
      $.ui.toast(STRINGS[lang()].carried(picked.filter(c => c.kind !== 'command').map(c => c.name)))
    }
    return result
  }).catch(($, e, next) => next(e))

  // The cards in the tray, named in the band above the prompt box until the message goes (owner, 2026-10-15). Coco's
  // band, and what other mods draw there, stays under this line. With the tray empty the hook reads nothing and passes
  // the band straight on (see bandNames).
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const names = bandNames
    if (e.props.hasSurvey || names.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return next(e).then(theirs => (
      <Box flexDirection="column">
        <Box key="coco-tray" columnGap={1}>
          <Text color="inactive">{STRINGS[lang()].trayTitle}</Text>
          <Box flexGrow={1} width={0}><Text bold wrap="truncate-end">{listOf(lang(), names)}</Text></Box>
        </Box>
        {theirs}
      </Box>
    ))
  })

  on('ui.close', { id: 'coco-cards' }, async ($, e, next) => {
    isPaneOpen = false
    await update($, cocoAtom, c => ({ ...c, move: null, layers: [], queued: [] }))
    await update($, paneAtom, (p): PaneState => ({ ...p, fresh: [] }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.press', { plugin: 'coco', requestId: 'coco-cards' }, async ($, e, next) => {
    await bringsCoco($, () => onPress($, e.element))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.input', async ($, e, next) => {
    if (e.plugin === 'coco' && e.requestId === PANE && e.element === 'q') {
      const query = e.value
      await bringsCoco($, () => update($, paneAtom, (p): PaneState => (p.query === query ? p : { ...p, query, pulled: null })))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isPaneOpen = true
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const s = STRINGS[lang()]
    const [catalog, usage, tray, pane, coco] = await Promise.all([read($, catalogAtom), read($, usageAtom), read($, trayAtom), read($, paneAtom), read($, cocoAtom)])
    // VS Code draws the terminal's pane, in words: owner 10-19, after trying it with pictures, 「vscode和cli纯文字版」
    const flat = e.surface === 'terminal' || e.surface === 'vscode'
    // the phone places nothing absolutely, so there the desktop's pane is drawn in one flow: its papers and pictures,
    // each picture standing alone, and real buttons where the desktop lays blank ones over a drawing (owner 10-19:
    // 「手机尽可能接近windows/mac/linux app客户端体验」)
    const flow = e.surface === 'mobile'
    // Everywhere but the desktop a pulled card opens under its own strip or pocket, its buttons with it, since nothing
    // there can stand at the window's foot as the desktop's sheet does (owner 10-19: 「就地展开」)
    const inline = e.surface !== 'desktop'
    // Coco's pictures, where Svg is drawn (the app surfaces only); the terminal and VS Code never read them
    const pics = !flat && 'Svg' in table ? await pictures($) : null
    const now = await $.clock.now()
    const cols = Math.max(24, e.props.bodyColumns)
    const wide = cols >= WIDE
    usedNow = new Set()

    // ---- the cards in view ----
    const all = [...catalog.cards].sort(boxOrder)
    const counts: Record<KindFilter, number> = { all: all.length, skill: 0, agent: 0, command: 0 }
    for (const c of all) counts[c.kind] += 1
    const shown = all.filter(c => (pane.kind === 'all' || c.kind === pane.kind) && matches(c, pane.query))
    const state = stateOf(catalog, pane, shown.length)
    const uses = (c: Card) => usage[c.id]?.n ?? 0
    const rank = (c: Card) => rarity(usage[c.id], now)

    // ---- elements made once ----
    // The desktop draws a Button as one line of its label in its own native style, ink following the theme, and
    // draws no children in it (docs/cards/DESKTOP.md); a card's colors and weights therefore sit in Text beside it.
    const desk = !flat
    // VS Code has no plain button and fills it in its accent color, so there a plain one is drawn dim, as an outline
    const button = (key: string, label: string, extra: { variant?: 'primary'; plain?: true; dimColor?: true } = {}) =>
      once(`${e.surface}|b|${key}|${label}|${JSON.stringify(extra)}`, () =>
        Button({ key, label, ...(e.surface === 'vscode' && extra.plain ? { dimColor: true } : extra), onPress: noop }))
    /**
     * A press target laid over a drawing on the desktop: a plain Button whose label is blank spaces, `reach` columns of
     * them, then the words a screen reader reads, all past the drawing's right edge, where the drawing (which must be
     * drawn `overflow="hidden"`) cuts it off. The button fills the drawing's height (a row Box that names its
     * `alignItems` stretches it; one that does not centers it), a hair in from the edges so the focus ring shows; its
     * own hover tint shows on it. Drawn last, so it lies over the rest.
     */
    const hit = (key: string, label: string, reach: number) => flow ? null : (
      <Box position="absolute" top={0} bottom={0} left={0} width={reach * 2 + label.length * 2 + 8} padding={0.2} alignItems="stretch">
        {button(key, REACH.repeat(Math.ceil(reach * 0.62) + 2) + label, { plain: true })}
      </Box>
    )
    /** A surface of the draft's: on the desktop the theme's own color under a film of the draft's (see FILM), on the terminal one color. */
    const filmed = (key: string, film: Film, outer: Record<string, unknown>, inner: Record<string, unknown>, kids: unknown) =>
      desk ? (
        <Box key={key} backgroundColor={UNDER[film]} {...outer}>
          <Box key="f" flexGrow={1} minWidth={0} backgroundColor={FILM[film]} {...inner}>{kids as RenderElement}</Box>
        </Box>
      ) : (
        <Box key={key} backgroundColor={SOLID[film]} {...outer} {...inner}>{kids as RenderElement}</Box>
      )
    const kindInk = (k: Card['kind']) => (desk || k !== 'command' ? KIND[k] : TERM.command)
    /**
     * A button drawn as the draft's: coral for the main action, an outline for the other, the label bold in the card's
     * ink; on the kraft (`onKraft`) the outline and the label take the box's own ink, the theme's.
     */
    const pill = (key: string, label: string, primary: boolean, onKraft = false) =>
      flow ? (
        button(key, label, primary || onKraft ? { variant: 'primary' } : { dimColor: true })
      ) : desk ? (
        <Box key={`b-${key}`} backgroundColor={primary ? INK.coral : undefined} borderStyle="single" borderColor={primary ? INK.coral : onKraft ? 'text' : INK.edge} paddingX={2} paddingY={1} overflow="hidden">
          <Text bold color={primary ? INK.onCoral : onKraft ? 'text' : INK.text}>{label}</Text>
          {hit(key, label, label.length * 2 + 6)}
        </Box>
      ) : (
        button(key, label, primary ? { variant: 'primary' } : {})
      )
    const search =
      'Input' in table
        ? once(`${e.surface}|q|${searchGen}`, () => table.Input({ key: 'q', placeholder: s.search, value: '', submitLabel: s.find, onInput: noop, onSubmit: noop }))
        : null
    /** A printed word of the bar: dim at rest, full ink with an ink rule under it when chosen (docs/cards/DESIGN.md). */
    const word = (key: string, label: string, chosen: boolean) =>
      flow ? (
        button(key, label, chosen ? { variant: 'primary' } : { dimColor: true })
      ) : desk ? (
        <Box key={key} flexDirection="column">
          {button(key, label, chosen ? { plain: true } : { plain: true, dimColor: true })}
          <Box key="u" height={0.12} backgroundColor={chosen ? 'text' : undefined} />
        </Box>
      ) : (
        button(key, label, chosen ? { variant: 'primary' } : { plain: true })
      )

    // ---- Coco ----
    // Coco's card stands tilted at the front right of the box, as the draft's; under a state (loading, nothing found,
    // an empty box) the picture stands in the middle of the box instead, and in the book Coco has a pocket of their own.
    // Each picture lies on a blank of its size; Coco at rest lies on theirs always, so that frame never restarts while
    // the pane is open, and a move's parts lie on top (docs/cards/DESKTOP.md). Svg is drawn by the app surfaces only;
    // where it is but the pictures could not be read, the pane draws as where it is not, in words.
    const hasSvg = pics !== null && 'Svg' in table
    const layer = (key: string, source: string) =>
      'Svg' in table ? (
        <Box key={key} position="absolute" top={0} left={0}>
          {table.Svg({ source, alt: s.cocoAlt, width: W, height: H, isInteractive: true })}
        </Box>
      ) : null
    /** The room a picture of Coco's takes, with nothing on it: where the picture laid from another layer comes to lie. */
    const blank = (key: string) =>
      'Svg' in table && pics ? (
        <Box key={key} flexDirection="column" flexShrink={0}>
          {table.Svg({ source: pics.SPACER, alt: s.cocoAlt, width: W, height: H })}
        </Box>
      ) : null
    /** A picture of Coco's that stands alone, `pick` of the pictures: a blank holding the room, the picture over it. */
    const still = (key: string, pick: (a: Art) => string) =>
      flow && 'Svg' in table && pics ? (
        <Box key={key} flexDirection="column" flexShrink={0}>
          {table.Svg({ source: asImage(pick(pics), W, H), alt: s.cocoAlt, width: W, height: H })}
        </Box>
      ) : 'Svg' in table && pics ? (
        <Box key={key} flexDirection="column" flexShrink={0}>
          {table.Svg({ source: pics.SPACER, alt: s.cocoAlt, width: W, height: H })}
          {layer('pic', pick(pics))}
        </Box>
      ) : null
    const turn = pane.line ?? 0
    // drawn only with the pictures, which say how far the card turns
    const card = cocoCard(s.cocoBox[turn], pics?.TILT ?? 0, W, H)
    const cardRows = Math.ceil(card.h / ROW_PX)
    // where Coco's card's top stands above the window's foot, in rows: the draft's 14 px clear under its lowest corner,
    // the shadow running on past the edge
    const standRows = (card.foot + 14) / ROW_PX
    // `keep`: how many of a move's layers to draw, the newest; fewer when the pane would pass the desktop's caps
    const cocoCardOf = (keep: number): RenderElement | null => {
      if (!pics || !('Svg' in table)) return null
      const { Svg } = table
      // in one flow Coco at rest is drawn into their card, the one picture inside the other
      if (flow) {
        return (
          <Box key="coco" flexDirection="column" flexShrink={0}>
            {Svg({ source: card.svg.replace(/<\/svg>$/, `${asImage(pics.REST, W, H, card.frameX, card.frameY)}</svg>`), alt: `Coco. ${s.cocoBox[turn]}`, width: card.w, height: card.h })}
          </Box>
        )
      }
      const loops = { breathMs: pics.BREATH_MS, swayMs: pics.SWAY_MS }
      const moving = coco.layers.filter(l => l.move in pics.MOVES)
      const over = moving.slice(Math.max(0, moving.length - keep)).map(l => {
        const part = pics.MOVES[l.move as MoveName].PARTS[l.part]
        return part ? layer(l.key, fill(part.svg, l.mark, l.actMs, l.restAge, loops)) : null
      })
      // the card is one picture; Coco's upright frame sits on it where the card's frame turns, set in by a blank
      return (
        <Box key="coco" flexDirection="column" flexShrink={0}>
          {Svg({ source: card.svg, alt: `Coco. ${s.cocoBox[turn]}`, width: card.w, height: card.h })}
          <Box key="at" position="absolute" top={0} left={0} flexDirection="row" alignItems="flex-end">
            {Svg({ source: BLANK, alt: 'Coco', width: card.frameX, height: card.frameY + H })}
            <Box key="pic" flexDirection="column">
              {Svg({ source: pics.SPACER, alt: s.cocoAlt, width: W, height: H })}
              {layer('rest', pics.REST)}
              {over}
            </Box>
          </Box>
        </Box>
      )
    }

    // ---- the bar ----
    const kinds = (['all', 'skill', 'agent', 'command'] as const).map(k => {
      const w = word(`kind:${k}`, `${s.kind[k]} ${counts[k]}`, pane.kind === k)
      // each kind wears its stripe's color as a swatch, so the stripes in the box read at a glance
      return desk && k !== 'all' ? (
        <Box key={`kw-${k}`} flexDirection="row" alignItems="center" columnGap={0.5}>
          <Box key="sw" width={1} height={0.8} backgroundColor={flow && k === 'command' ? TERM.command : KIND[k]} />
          {w}
        </Box>
      ) : (
        w
      )
    })
    const views = (['box', 'book'] as const).map(v => word(`view:${v}`, s.view[v], pane.view === v))
    // the draft's switch on the desktop: a track with a knob, the word beside it; a screen reader hears it on or off
    const isMoving = !pane.isMotionOff
    // how far over the knob is: at the right when motion is on, on its way there while it slides
    const knobAt = pane.knob ?? (isMoving ? 1 : 0)
    const motionWord = s.motionOn.split(/\s*[:：]/)[0] ?? s.motionOn
    // in words nothing moves, so there is no switch (owner 10-19: 「动画开关也没意义了在cli和vscode里」)
    const motion = desk && !flow ? (
      <Box key="motion" flexDirection="row" alignItems="center" columnGap={1} paddingX={0.5} overflow="hidden">
        <Box key="track" width={4} height={1} flexShrink={0} borderStyle="round" borderColor={isMoving ? 'text' : 'inactive'} backgroundColor={isMoving ? 'text' : undefined} paddingX={0.35} paddingY={0} alignItems="center">
          <Box key="kl" flexGrow={knobAt} />
          <Box key="knob" width={1.5} height={0.63} flexShrink={0} borderStyle="round" borderColor={isMoving ? FLOOR : 'inactive'} backgroundColor={isMoving ? FLOOR : 'inactive'} padding={0} />
          <Box key="kr" flexGrow={Math.round((1 - knobAt) * 100) / 100} />
        </Box>
        <Text color="inactive">{motionWord}</Text>
        {hit('motion:', isMoving ? s.motionOn : s.motionOff, 6 + motionWord.length * 2)}
      </Box>
    ) : (
      word('motion:', pane.isMotionOff ? s.motionOff : s.motionOn, false)
    )
    // what a state says, and the button that gets out of it: in the box under Coco's picture on the desktop, as the
    // draft has it, and under the bar on the terminal
    let said: string | null = null
    let out: RenderElement | null = null
    if (state === 'shuffle') said = s.loading
    else if (state === 'emptybox') [said, out] = [s.error, desk ? pill('retry:', s.retry, false, true) : button('retry:', s.retry)]
    else if (state === 'dig') [said, out] = [s.noMatch(pane.query), desk ? pill('clearq:', s.clearSearch, false, true) : button('clearq:', s.clearSearch)]
    else if (state === 'wait') said = catalog.cards.length === 0 ? s.empty : s.emptyKind
    const status = said === null || hasSvg ? null : <Box key="st" flexDirection="column" rowGap={0.5}><Text>{said}</Text>{out}</Box>
    /** The box under a state: Coco's picture in its middle, what the state says and the way out under it. */
    const stateBox = (name: StateName) =>
      filmed('deck', 'kraft', { flexGrow: 1, minWidth: 0 }, { flexDirection: 'column', alignItems: 'center', rowGap: 1, paddingX: 2, paddingTop: 4, paddingBottom: 4 }, [
        still(`state-${name}`, a => a.STATES[name]),
        said === null ? null : <Box key="said" width={Math.min(boxCols - 6, 40)} justifyContent="center"><Text color="text">{said}</Text></Box>,
        out,
      ])

    const bar = (
      <Box key="bar" flexDirection="column" flexGrow={1} rowGap={1}>
        <Text bold>{s.title}</Text>
        {search}
        <Box key="kinds" flexDirection="row" flexWrap="wrap" columnGap={2}>{kinds}</Box>
        <Box key="views" flexDirection="row" flexWrap="wrap" columnGap={2}>{views}{flat ? null : motion}</Box>
        {status}
      </Box>
    )

    // ---- a card's strip in the box, its pocket in the book ----
    /** The kind stripe painted along a card's top edge: skill a coral bar, subagent a blue double rule, command an ink bar. */
    const topStripe = (k: Card['kind']) =>
      k === 'agent' ? (
        <Box key="k" flexDirection="column" rowGap={0.2}>
          <Box key="a" height={0.1} backgroundColor={KIND.agent} />
          <Box key="b" height={0.1} backgroundColor={KIND.agent} />
        </Box>
      ) : (
        <Box key="k" height={k === 'skill' ? 0.2 : 0.26} backgroundColor={flow && k === 'command' ? TERM.command : KIND[k]} />
      )
    /** The same stripe down a strip's left edge, on the terminal. */
    const stripe = (k: Card['kind']) => <Text key="k" color={kindInk(k)}>{k === 'agent' ? '‖' : '▌'}</Text>
    const rarityMark = (c: Card) => {
      const r = rank(c)
      return r === 'N' ? null : <Text key="r" bold color={desk && !flow ? PRINT[r] : TERM[r]}>{r}</Text>
    }
    /** A rare card's top right corner folded down to show its foil, as a picture laid on the corner (docs/cards/DESIGN.md). */
    /**
     * A rare card's folded corner. A card in the box shows the box's kraft in the cut; the pulled card (`lifted`) lies
     * off the box, so its cut shows the pane's floor, and its flap glints as it comes up unless motion is off.
     */
    const fold = (c: Card, size: number, lifted = false) => {
      const r = rank(c)
      if (!desk || flow || r === 'N' || !('Svg' in table)) return null
      if (!lifted) {
        return (
          <Box key="fold" position="absolute" top={0} right={0}>
            {table.Svg({ source: FOLD[r](size), alt: r, width: size, height: size })}
          </Box>
        )
      }
      return (
        <Box key="fold" position="absolute" top={0} right={0} backgroundColor={FLOOR}>
          {pane.isMotionOff
            ? table.Svg({ source: FOLD[r](size, true), alt: r, width: size, height: size })
            : table.Svg({ source: glintSvg(r, size, c.id), alt: r, width: size, height: size, isInteractive: true })}
        </Box>
      )
    }
    // the draft's coral "+1" slip, turned back a little on the desktop (a still picture, since a Box cannot turn)
    const flag = (c: Card) =>
      !(pane.fresh ?? []).includes(c.id) ? null
      : hasSvg ? <Box key="new" flexShrink={0}>{table.Svg({ source: FLAG.svg, alt: '+1', width: FLAG.w, height: FLAG.h })}</Box>
      : <Text key="new" bold color={C.flagInk} backgroundColor={KIND.skill}> +1 </Text>
    // Ink printed on the card stock: the draft's on the desktop, the theme's on the terminal, whose paper follows it.
    const inkOf = (tone: 'text' | 'muted' | 'faint') => (desk ? INK[tone] : tone === 'text' ? undefined : 'inactive')
    const ink = inkOf
    // The strip's header as the draft has it: the name, its uses, "in the tray", then the description cut to the
    // room left, and at the right end the "+1" flag and the printed R or SR, clear of the folded corner.
    const boxCols = wide ? cols - SIDE - 2 : cols
    // the strips leave the box's right side to Coco's card, as the draft's walls do
    // in one flow a narrow box has Coco's card over its strips, not beside them
    const beside = !flow || boxCols >= 60
    const stripCols = boxCols - (hasSvg && beside ? COCO_COLS : 0)
    // `lite`: drawn without its press target, which waits out one of Coco's moves when the pane would pass the caps
    const strip = (c: Card, lite: boolean) => {
      const desc = c.description ? firstLine(c.description, Math.max(24, stripCols - c.name.length - 8)) : s.noDescription
      const inTray = tray.includes(c.id) ? s.inTray : ''
      if (!desk) {
        return (
          <Box key={`s-${c.id}`} flexDirection="row" backgroundColor={TERM.paper}>
            {stripe(c.kind)}
            <Box key="t" columnGap={1} paddingLeft={1} paddingRight={1} flexGrow={1} minWidth={0}>
              {button(`card:${c.id}`, c.name, { plain: true })}
              <Box key="u" flexShrink={0}><Text color="inactive">{s.uses(uses(c)) + inTray}</Text></Box>
              <Box key="d" flexGrow={1} width={0}><Text color="inactive" wrap="truncate-end">{desc}</Text></Box>
              {flag(c)}
              {rarityMark(c)}
            </Box>
          </Box>
        )
      }
      const [left, right] = jitter(c.id)
      if (flow) {
        return (
          <Box key={`s-${c.id}`} flexDirection="column" backgroundColor={BASE} marginLeft={left} marginRight={right} overflow="hidden">
            {topStripe(c.kind)}
            <Box columnGap={1} paddingLeft={1} paddingRight={1} paddingY={0.25} alignItems="center">
              {button(`card:${c.id}`, c.name, { dimColor: true })}
              <Box key="u" flexShrink={0}><Text color="inactive">{s.uses(uses(c)) + inTray}</Text></Box>
              <Box key="d" flexGrow={1} width={0}><Text color="inactive" wrap="truncate-end">{desc}</Text></Box>
              {flag(c)}
              {rarityMark(c)}
            </Box>
          </Box>
        )
      }
      return (
        <Box key={`s-${c.id}`} flexDirection="column" backgroundColor={PAPER} marginLeft={left} marginRight={right} overflow="hidden">
          {topStripe(c.kind)}
          <Box columnGap={1} paddingLeft={1} paddingRight={rank(c) !== 'N' ? 3 : 1} paddingY={0.25}>
            {/* the name in bold ink, its uses and "in the tray" after it; the description takes what room is left */}
            <Text color={INK.muted} wrap="truncate-end"><Text bold color={INK.text}>{c.name}</Text>{`  ${s.uses(uses(c))}${inTray}`}</Text>
            <Box flexGrow={1} width={0}><Text color={c.description ? INK.muted : INK.faint} wrap="truncate-end">{desc}</Text></Box>
            {flag(c)}
            {rarityMark(c)}
          </Box>
          <Box height={0.06} backgroundColor={INK.rule} />
          {fold(c, 17)}
          {lite ? null : hit(`card:${c.id}`, c.name, boxCols)}
        </Box>
      )
    }
    // the "+1" of a card just pulled, left where it stood on the strip and drawn fainter and a little higher at each
    // of PEEL's steps, as the draft fades it; laid over the slot, so the box does not move
    const peelOf = (c: Card) => {
      const at = desk && !flow && hasSvg && pane.peel?.id === c.id ? PEEL[pane.peel.step] : undefined
      if (!at || !('Svg' in table)) return null
      const r = rank(c)
      const stripe = c.kind === 'agent' ? 0.4 : c.kind === 'skill' ? 0.2 : 0.26
      return (
        // an absolute Box's offsets are whole cells, so it sits in the corner and pads itself to the place
        <Box key="peel" position="absolute" top={0} right={0} paddingTop={Math.round((stripe + 0.25 - at[2] / 19) * 100) / 100} paddingRight={jitter(c.id)[1] + (r === 'N' ? 1 : 4 + r.length)}>
          {table.Svg({ source: flagAt(at[1]).svg, alt: '+1', width: FLAG.w, height: FLAG.h })}
        </Box>
      )
    }
    // the pulled card's slot stays in the box as a ghost on darkened kraft, so the box never reflows
    const ghost = (c: Card) =>
      filmed(`s-${c.id}`, 'ghost', {}, desk ? { borderStyle: 'single', borderColor: 'inactive', paddingX: 1, paddingY: 0.3 } : { paddingX: 1, paddingY: 0.3 }, [
        <Text key="n" color={desk ? 'text' : C.ghostText}>{c.name}</Text>,
        peelOf(c),
      ])
    const divider = (g: string, n: number, i: number) => (
      <Box key={`d-${g}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
        {filmed('tab', 'manila', { alignSelf: 'flex-start', marginLeft: (i % 4) * 6 }, { paddingX: 1, paddingTop: 0.3 }, [
          <Text key="g" bold color={INK.manila}>{s.group(g)}</Text>,
          <Text key="n" color={INK.manilaCount}> {n}</Text>,
        ])}
        {filmed('edge', 'manila', {}, { height: 0.4 }, null)}
      </Box>
    )
    /**
     * Coco's moving pictures lie on a layer of their own over the box or the book, never inside it, so a redraw
     * makes the box anew in one piece: the desktop keeps a frame and the boxes around it from one drawing to the next
     * and makes the rest anew (docs/cards/DESKTOP.md). On the desktop that alone did not stop the window being pulled to
     * the box's end; `stirred` stopped it (owner's desktop, 2026-10-15). On the bench, at the
     * harshest layout timing tried, the two together held better than `stirred` with the frames inside the box.
     */
    const layered = (key: string, inner: RenderElement, layer: RenderElement | null) =>
      layer ? (
        <Box key={key} flexDirection="column" flexGrow={1} minWidth={0}>
          {inner}
          {layer}
        </Box>
      ) : inner
    const groupsOf = (cards: Card[]) => {
      const groups = new Map<string, Card[]>()
      for (const c of cards) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
      return groups
    }
    // `max`: how many cards to draw; the rest are left for search when the tree would pass the desktop's caps
    const boxView = (max: number, lite: boolean, keep: number) => {
      const whole = groupsOf(shown)
      // the group whose tab was pressed goes first, the rest after it in their order; the tabs keep theirs
      const led = pane.lead && whole.has(pane.lead) ? [...(whole.get(pane.lead) ?? []), ...shown.filter(c => c.group !== pane.lead)] : shown
      // the draft's row of divider tabs above the box: one per group, manila with the group's name in ink; a press
      // brings its divider to the top; a narrow box drops the counts
      const counted = boxCols >= 56
      const tabs =
        whole.size < 2 ? null : (
          <Box key="tabs" flexDirection="row" flexWrap="wrap" columnGap={flow ? 1 : 0.5} rowGap={0.5} marginBottom={1}>
            {[...whole].map(([g, cs]) =>
              flow ? (
                button(`jump:${g}`, counted ? `${s.group(g)} ${cs.length}` : s.group(g), { dimColor: true })
              ) : desk ? (
                <Box key={`j-${g}`} backgroundColor={BASE} overflow="hidden">
                  <Box key="f" flexGrow={1} backgroundColor={FILM.manila} paddingX={1} paddingTop={0.3} paddingBottom={0.5}>
                    <Text bold color={INK.manila}>{s.group(g)}</Text>
                    {counted ? <Text color={INK.manilaCount}> {cs.length}</Text> : null}
                  </Box>
                  {hit(`jump:${g}`, s.group(g), s.group(g).length * 2 + 8)}
                </Box>
              ) : (
                <Box key={`j-${g}`} backgroundColor={TERM.paper} paddingX={0.5}>{button(`jump:${g}`, counted ? `${s.group(g)} ${cs.length}` : s.group(g), { plain: true })}</Box>
              ),
            )}
          </Box>
        )
      // Coco's card on a rail down the box's right side: the rail starts where the card would stand at the bottom of
      // the window and runs to the box's floor; the card stands at its top, and where the rail is shorter than the card
      // it stands on the floor, never past it (the rail lays it out flex-end, a spacer under it taking the rest)
      const cocoRail = hasSvg && !flow ? rail('cocorail', cocoTop, { right: 0, width: COCO_COLS }, cocoCardOf(keep)) : null
      const groups = [...groupsOf(led.slice(0, max))].map(([g, cs], i) => (
        <Box key={`g-${g}`} flexDirection="column" rowGap={0.25} paddingRight={hasSvg && !flow ? COCO_COLS : 0}>
          {divider(g, (whole.get(g) ?? cs).length, i)}
          {cs.flatMap(c => (pane.pulled !== c.id ? [strip(c, lite)] : inline ? [strip(c, lite), face] : [ghost(c)]))}
        </Box>
      ))
      const moreLine = shown.length > max ? <Box key="more" marginTop={1}><Text color={desk ? 'text' : '#24180b'}>{s.moreCards(shown.length - max)}</Text></Box> : null
      // in one flow Coco's card cannot follow the window, so it stands at the box's top right, beside the strips in a
      // wide box and over them in a narrow one
      const cocoFlow = flow && hasSvg ? cocoCardOf(0) : null
      const deck = filmed('deck', 'kraft', { flexGrow: 1, minWidth: 0 }, { flexDirection: 'column', paddingX: 1, paddingY: 1, minHeight: hasSvg && !flow ? cardRows + 4 : undefined }, (
        !cocoFlow ? [flow ? null : tabs, ...groups, moreLine]
        : beside ? [
            <Box key="beside" flexDirection="row" columnGap={1}>
              <Box key="strips" flexDirection="column" flexGrow={1} minWidth={0}>{groups}{moreLine}</Box>
              {cocoFlow}
            </Box>,
          ]
        : [<Box key="cocorow" justifyContent="flex-end" marginBottom={1}>{cocoFlow}</Box>, ...groups, moreLine]
      ))
      // in one flow the tabs are buttons, which read on the floor and not on the kraft, so they stand over the box
      if (flow && tabs) return <Box key="deckroom" flexDirection="column" flexGrow={1} minWidth={0}>{tabs}{deck}</Box>
      return layered('deckroom', deck, cocoRail)
    }

    // a card in its sleeve, as the draft's binder: the name with R or SR at the right (clear of the fold), the start
    // of its description, and 用过 N 次 at the bottom right
    const pocket = (c: Card, lite: boolean) => {
      // in one flow the pocket is the theme's own paper, so the name's button reads on it
      const ink = flow ? (tone: 'text' | 'muted' | 'faint') => (tone === 'text' ? undefined : 'inactive') : inkOf
      const body = (
        <Box key="b" flexDirection="column" paddingX={1} paddingY={0.5} rowGap={0.25}>
          <Box key="n" justifyContent="space-between" columnGap={1} minWidth={0} paddingRight={desk && rank(c) !== 'N' ? 1 : 0}>
            {flow ? button(`card:${c.id}`, c.name, { dimColor: true }) : desk ? <Text bold color={INK.text}>{c.name}</Text> : button(`card:${c.id}`, c.name, { plain: true })}
            {rarityMark(c)}
          </Box>
          <Text key="d" color={ink(c.description ? 'muted' : 'faint')}>{c.description ? firstLine(c.description, 44) : s.noDescription}</Text>
          <Box key="u" alignSelf="flex-end"><Text color={ink('muted')}>{s.uses(uses(c))}</Text></Box>
        </Box>
      )
      if (!desk || flow) return <Box key={`p-${c.id}`} flexDirection="column" width={24} backgroundColor={TERM.paper}>{flow ? topStripe(c.kind) : null}{body}</Box>
      return (
        <Box key={`p-${c.id}`} flexDirection="column" width={24} backgroundColor={PAPER} overflow="hidden">
          {topStripe(c.kind)}
          {body}
          {fold(c, 15)}
          {lite ? null : hit(`card:${c.id}`, c.name, 24)}
        </Box>
      )
    }
    const byUses = (a: Card, b: Card) => uses(b) - uses(a) || a.name.localeCompare(b.name)
    const sr = all.filter(c => rank(c) === 'SR').length
    const r = all.filter(c => rank(c) === 'R').length
    const top = [...all].sort(byUses)[0]
    // Coco's pocket in the binder: their album picture, cut to the top of it as the draft's, the name and their line. The
    // pocket holds a blank where the picture goes; the picture lies on the layer over the pages (see `layered`), set in
    // from the first page's corner by the page's padding, then by the pocket's stripe and padding, as the blank is
    const albumPic = (pic: RenderElement | null) => <Box key="pic" height={112 / ROW_PX} overflow="hidden" alignSelf="center">{pic}</Box>
    const cocoPocket = hasSvg ? (
      <Box key="p-coco" flexDirection="column" width={24} backgroundColor={PAPER} overflow="hidden">
        <Box key="k" height={0.2} backgroundColor={KIND.skill} />
        <Box key="b" flexDirection="column" paddingX={1} paddingY={0.5} rowGap={0.25}>
          {albumPic(flow ? still('state-album', a => a.STATES.album) : blank('state-album'))}
          <Text key="n" bold color={INK.text}>Coco</Text>
          <Text key="l" color={INK.muted}>{s.cocoBook[turn]}</Text>
        </Box>
      </Box>
    ) : null
    const album = hasSvg && !flow ? (
      <Box key="album" position="absolute" top={1} left={2} width={24} flexDirection="column">
        <Box key="k" height={0.2} />
        <Box key="b" flexDirection="column" paddingX={1} paddingTop={0.5}>{albumPic(still('state-album', a => a.STATES.album))}</Box>
      </Box>
    ) : null
    const bookView = (max: number, lite: boolean) => {
      const list = pane.sort === 'group' ? shown : [...shown].sort(pane.sort === 'uses' ? byUses : (a, b) => a.name.localeCompare(b.name))
      const drawn = list.slice(0, max)
      const pages: [string, Card[]][] = pane.sort === 'group' ? [...groupsOf(drawn)].map(([g, cs]) => [s.group(g), cs]) : [[s.sorted[pane.sort], drawn]]
      const tab = (title: string, n: number) =>
        filmed('tab', 'manila', { alignSelf: 'flex-start', marginLeft: 2 }, { paddingX: 1, paddingTop: 0.3 }, [
          <Text key="t" bold color={INK.manila}>{title}</Text>,
          <Text key="n" color={INK.manilaCount}> {n}</Text>,
        ])
      // a pulled card opens under the page that holds it
      const opened = (cs: Card[]) => (inline && pane.pulled && cs.some(c => c.id === pane.pulled) ? face : null)
      const page = (cs: Card[], first: boolean) =>
        filmed('page', 'kraft', {}, { flexWrap: 'wrap', columnGap: 2, rowGap: 1, paddingX: 2, paddingY: 1 }, [first ? cocoPocket : null, ...cs.map(c => pocket(c, lite))])
      const more = list.length > max ? <Text key="more">{s.moreCards(list.length - max)}</Text> : null
      // the first page's tab stands above the layer that holds Coco's album picture, so the layer starts at the first
      // page's top and the picture lies a whole row down from it; the other pages and the rest of the book are under it
      const [lead, ...rest] = pages
      return (
        <Box key="book" flexDirection="column" flexGrow={1} minWidth={0} rowGap={1}>
          <Text key="tally">{s.tally(all.length, sr, r, top && uses(top) > 0 ? top.name : null)}</Text>
          <Box key="sorts" flexDirection="row" flexWrap="wrap" columnGap={2}>
            {(['group', 'uses', 'name'] as const).map(k => word(`sort:${k}`, s.sortBy[k], pane.sort === k))}
          </Box>
          {lead ? (
            <Box key={`p-${lead[0]}`} flexDirection="column">
              {tab(lead[0], lead[1].length)}
              {layered('pages', (
                <Box key="binder" flexDirection="column" rowGap={1}>
                  {page(lead[1], true)}
                  {opened(lead[1])}
                  {rest.map(([title, cs]) => (
                    <Box key={`p-${title}`} flexDirection="column">
                      {tab(title, cs.length)}
                      {page(cs, false)}
                      {opened(cs)}
                    </Box>
                  ))}
                  {more}
                </Box>
              ), album)}
            </Box>
          ) : more}
        </Box>
      )
    }

    // ---- the pulled card and the tray ----
    // a narrow pane's sheet going back down still holds its card until it is gone
    const pulledId = pane.pulled ?? pane.sinking ?? null
    const pulled = pulledId ? catalog.cards.find(c => c.id === pulledId) : undefined
    // a narrow pane stacks the face over the box, where the draft hides the empty slot too
    // the empty place for it, as the draft's dashed outline
    let face: RenderElement | null = wide && !inline ? (
      <Box key="hint" borderStyle="single" justifyContent="center" paddingX={2} paddingY={3} />
    ) : null
    if (pulled) {
      const n = toNext(usage[pulled.id], now)
      const inTray = tray.includes(pulled.id)
      // on a narrow pane the card's sheet covers the tray, so there the button also puts the card back, as the draft's
      // does, and the card is seen landing in the tray
      const sheetUp = hasSvg && !flow && !wide && catalog.status === 'ready'
      const take = pulled.kind === 'command' ? pill(`type:${pulled.id}`, s.typeIt, true) : pill(`${sheetUp ? 'takeup' : 'take'}:${pulled.id}`, inTray ? s.untake : s.take, !inTray)
      const lines = [
        // the name, and at the right the printed R or SR, clear of the folded corner, as the draft's title
        <Box key="h" justifyContent="space-between" columnGap={1} paddingRight={desk && rank(pulled) !== 'N' ? 2 : 0}>
          <Text bold color={ink('text')}>{pulled.name}</Text>
          {rarityMark(pulled)}
        </Box>,
        desk ? <Box key="rule" height={0.12} backgroundColor={INK.underline} /> : null,
        <Text key="call" color={ink('muted')}>{pulled.kind === 'agent' ? s.agentCall : `/${pulled.name}`}</Text>,
        <Text key="desc" color={ink(pulled.description ? 'text' : 'faint')}>{pulled.description || s.noDescription}</Text>,
        <Text key="meta" color={ink('muted')}>{s.meta(s.kindOne[pulled.kind], s.group(pulled.group))}</Text>,
        // how the card climbs, and the use count stamped in red at the right
        <Box key="next" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
          <Text color={ink('muted')}>{n ? s.toNext(n.uses, n.to) : s.top}</Text>
          {hasSvg ? (
            // the draft's stamp, turned back a little: a still picture, since a Box cannot turn
            <Box key="stamp" flexShrink={0}>{table.Svg({ ...stampOf(s.uses(uses(pulled))), alt: s.uses(uses(pulled)) })}</Box>
          ) : desk ? (
            <Box key="stamp" borderStyle="bold" borderColor={INK.stamp} paddingX={1} paddingY={0}>
              <Text bold color={INK.stamp}>{s.uses(uses(pulled))}</Text>
            </Box>
          ) : (
            <Text key="stamp" bold color={TERM.stamp}>{s.uses(uses(pulled))}</Text>
          )}
        </Box>,
      ]
      // in one flow the buttons stand under the card, on the theme's floor, where theirs read
      const acts = (
        <Box key="acts" flexWrap="wrap" columnGap={1} rowGap={0.5} marginTop={0.5}>
          {take}
          {pill('back:', s.putBack, false)}
        </Box>
      )
      if (!flow) lines.push(acts)
      face = desk ? (
        <Box key="face" flexDirection="column">
          <Box key="card" flexDirection="column" backgroundColor={PAPER}>
            {topStripe(pulled.kind)}
            <Box key="in" flexDirection="column" rowGap={0.5} paddingX={2} paddingTop={1.5} paddingBottom={1.5}>{lines}</Box>
            {fold(pulled, 24, true)}
          </Box>
          {/* the draft lifts the card with a drop shadow, which a Box cannot cast: films under its foot, the softer one
              drawn in a little, keep the cream card apart from a floor close to its color */}
          {LIFT.map((c, i) => <Box key={`lift${i}`} height={0.1} flexShrink={0} marginX={i} backgroundColor={c} />)}
          {flow ? acts : null}
        </Box>
      ) : (
        <Box key="face" flexDirection="column" backgroundColor={TERM.paper} borderStyle="round" borderColor={kindInk(pulled.kind)} rowGap={0.5}>{lines}</Box>
      )
    }
    const trayCards = tray.map(id => catalog.cards.find(c => c.id === id)).filter((c): c is Card => !!c)
    // a slip of the same card stock in the tray: its kind's stripe on top, the name, and a cross; a press puts it back
    const chip = (c: Card) =>
      flow ? (
        <Box key={`c-${c.id}`} flexDirection="column" backgroundColor={BASE}>
          {topStripe(c.kind)}
          <Box key="t" paddingX={0.5} paddingY={0.3}>{button(`untray:${c.id}`, `${c.name} ×`, { dimColor: true })}</Box>
        </Box>
      ) : desk ? (
        <Box key={`c-${c.id}`} flexDirection="column" backgroundColor={PAPER} overflow="hidden">
          {topStripe(c.kind)}
          <Box key="t" columnGap={1} paddingLeft={1} paddingRight={0.5} paddingY={0.3}>
            <Text bold color={INK.text}>{c.name}</Text>
            <Text color={INK.muted}>×</Text>
          </Box>
          {hit(`untray:${c.id}`, s.remove(c.name), c.name.length * 2 + 8)}
        </Box>
      ) : (
        <Box key={`c-${c.id}`} flexDirection="row" backgroundColor={TERM.paper}>
          {stripe(c.kind)}
          <Box key="t" paddingX={0.5}>{button(`untray:${c.id}`, `${c.name} ×`, { plain: true })}</Box>
        </Box>
      )
    // the tray: a heading with "all back" at its right and the slips in a shallow tray
    // in words (the terminal, VS Code) the tray shows only once a card is in it (owner 10-19, on
    // the empty tray's lines: 「纯文字版把这些去掉」)
    const trayBox = flat && trayCards.length === 0 ? null : (
      <Box key="tray" flexDirection="column" rowGap={0.5}>
        <Box key="hd" justifyContent="space-between" alignItems="center" columnGap={1}>
          <Text bold>{s.trayTitle}</Text>
          {trayCards.length > 0 ? button('allback:', s.allBack, { plain: true, dimColor: true }) : null}
        </Box>
        {filmed('chips', 'tray', {}, { flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, padding: flat ? 0.5 : 1, minHeight: flat ? undefined : 3 }, trayCards.length > 0 ? trayCards.map(chip) : <Text key="empty" color="inactive">{s.trayEmpty}</Text>)}
      </Box>
    )

    // ---- what stays put while the pane scrolls ----
    // The pane is one scroller and cannot hold a part still (docs/cards/DESKTOP.md), so on the desktop the parts the draft
    // pins are laid over the flow at the window's place, which every scroll redraws: the side column sticks to the
    // top while the box scrolls by, a narrow pane docks the tray at the bottom and pulls a card up into a sheet over
    // it, and Coco's card stands at the bottom right of the box. Each lies on a rail from where it should stand to
    // the end of what it belongs to, so it stops there and never makes the pane longer. Rows are counted the
    // desktop's way: the window shows rows offset to offset + bodyRows; heights here are estimates kept a little
    // generous, so a part sits a row clear of an edge rather than under it.
    const { offset, bodyRows } = e.props.scroll ?? { offset: 0, bodyRows: 40 }
    const ready = catalog.status === 'ready'
    const pinned = hasSvg && !flow
    const colsOf = (t: string) => {
      let n = 0
      for (const ch of t) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 1.8 : 1
      return n
    }
    const linesOf = (t: string, width: number) => Math.max(1, Math.ceil(colsOf(t) / Math.max(8, width)))
    /** Rows of the pulled card's face drawn `width` columns wide. */
    const faceRows = (c: Card, width: number) => {
      const w = width - 4
      const takeLabel = c.kind === 'command' ? s.typeIt : tray.includes(c.id) ? s.untake : s.take
      const acts = colsOf(takeLabel) + colsOf(s.putBack) + 13
      const n = toNext(usage[c.id], now)
      const next = colsOf(n ? s.toNext(n.uses, n.to) : s.top) + colsOf(s.uses(uses(c))) + 5
      return 0.2 + 0.75 + linesOf(c.name, w - 3) + 0.25 + 0.12 + 0.25 + 1 + 0.25 + linesOf(c.description || s.noDescription, w) + 0.25 +
        linesOf(s.meta(s.kindOne[c.kind], s.group(c.group)), w) + 0.25 + (next > w ? 2.5 : 1.3) + 0.25 + 0.25 + (acts > w ? 4.45 : 2.1) + 0.75 + 0.2
    }
    /** Rows of the tray drawn `width` columns wide: its heading, the slips packed into rows, and its hint. */
    const trayRows = (width: number) => {
      let rowsN = 1
      let used = 0
      for (const c of trayCards) {
        const cw = colsOf(c.name) + 4.5
        if (used > 0 && used + cw > width - 2) [rowsN, used] = [rowsN + 1, cw]
        else used += cw
      }
      const chips = Math.max(3, 1 + rowsN * 1.5 + (rowsN - 1) * 0.25)
      return 1 + 0.25 + chips
    }
    const kindsCols = (['all', 'skill', 'agent', 'command'] as const).reduce((n, k) => n + colsOf(`${s.kind[k]} ${counts[k]}`) + 4, 0)
    /** Rows above the box: the bar's title, search, kinds and views and the gaps between, and the gap under it. */
    const workTop = 1 + 0.5 + SEARCH_ROWS + 0.5 + (kindsCols > cols ? 2.37 : 1.12) + 0.5 + 1.12 + 0.5
    const docked = pinned && !wide && ready
    sheetDocks = docked
    // half a row more than it needs: the window's place is rounded to a row, so its foot may fall half a row short
    const trayH = docked ? Math.ceil(0.06 + 0.5 + trayRows(cols - 2) + 1) : 0
    // the face set in the sheet's margins, the shade and the rule over it, and half a row to spare
    const sheetH = docked && pulled ? Math.min(bodyRows - 2, Math.ceil(faceRows(pulled, cols - 4) + 0.3 + 0.06 + 0.75 + 0.5 + 0.5)) : 0
    const risen = pane.isMotionOff ? sheetH : Math.round(sheetH * Math.min(1, pane.rise ?? 1) * 100) / 100
    // Coco's card stands at the window's foot, above a docked tray; in rows from the box's top
    const cocoTop = Math.max(4, offset + bodyRows - trayH - standRows - workTop)
    const stick = Math.max(0, offset + 1 - workTop)
    const sideRows = (pulled ? faceRows(pulled, SIDE) : 4.2) + 1 + trayRows(SIDE) + 2

    // on the desktop the face is drawn in a place of its own, shifted toward the box while it comes out of it. The
    // desktop draws offsets on absolute Boxes only, so the shift is a negative margin on a place as wide as the
    // column, which moves the face and nothing under it; always drawn, so the glint's frame keeps its place
    const flight = pinned && wide && pane.pulled ? Math.min(1, pane.fly ?? 0) : 0
    const side = (
      <Box key="side" flexDirection="column" rowGap={1} width={wide ? SIDE : undefined} flexShrink={0}>
        {inline ? null : pinned && wide && face ? (
          <Box key="flight" width={SIDE} marginLeft={flight > 0 ? -Math.round((cols - SIDE - 4) * flight) : 0} flexDirection="column">
            {face}
          </Box>
        ) : face}
        {trayBox}
      </Box>
    )
    /**
     * A part laid over the flow from row `top` of its parent to the parent's foot, standing at the top of that. An
     * absolute place is a whole row, so a spacer above the part carries the rest of `top`.
     */
    const rail = (key: string, top: number, at: Record<string, unknown>, kid: RenderElement | null) => {
      const row = Math.floor(top)
      return (
        <Box key={key} position="absolute" top={row} bottom={0} {...at} flexDirection="column" justifyContent="flex-end">
          <Box key="lead" height={Math.round((top - row) * 100) / 100} flexShrink={0} />
          {kid}
          <Box key="sp" flexGrow={1} />
        </Box>
      )
    }

    // where a pulled card opens in the box, the side holds only the tray, and nothing while the tray is not drawn
    const sideShown = !inline || trayBox !== null
    const draw = (max: number, keep: number, lite: boolean) => {
      const main =
        state === 'shuffle' || state === 'emptybox' ? (hasSvg ? stateBox(state) : null)
        : pane.view === 'book' ? bookView(max, lite)
        : state ? (hasSvg ? stateBox(state) : null)
        : boxView(max, lite, keep)
      if (!pinned) {
        return (
          <Box flexDirection="column" width={cols} rowGap={1}>
            <Box key="top" flexDirection="row" columnGap={2} flexWrap="wrap">{bar}</Box>
            <Box key="work" flexDirection={wide ? 'row' : 'column'} gap={2}>
              {/* narrow: the face and the tray come before the box, so neither ends up below a long deck */}
              {ready && !wide && sideShown ? side : null}
              {main}
              {ready && wide && sideShown ? side : null}
            </Box>
            <Text key="unofficial" dimColor>{s.unofficial}</Text>
          </Box>
        )
      }
      // a docked pane reaches at least the window's foot, so with a short deck the tray still docks there, as the
      // draft's tray does (margin-top: auto), half a row short of it in case the window's last row is cut
      return (
        <Box flexDirection="column" width={cols} rowGap={1} minHeight={docked ? bodyRows - 0.5 : undefined}>
          <Box key="top" flexDirection="row" columnGap={2} flexWrap="wrap">{bar}</Box>
          <Box key="work" flexDirection="row" columnGap={2} minHeight={wide && ready ? sideRows : undefined}>
            {main}
            {wide && ready ? <Box key="room" width={SIDE} flexShrink={0} /> : null}
            {wide && ready ? rail('siderail', stick, { right: 0, width: SIDE }, side) : null}
          </Box>
          <Text key="unofficial" dimColor>{s.unofficial}</Text>
          {docked ? <Box key="dockroom" height={trayH} /> : null}
          {/* the window's place comes rounded to a row, so the docked parts run on half a row past where its foot
              should be, in their own color, and no sliver of the scrolling cards shows under them; where the pane
              ends sooner (a short deck, the end of a long one) that half row gives way first */}
          {docked
            ? rail('dock', offset + bodyRows - trayH, { left: 0, right: 0 },
                <Box key="tray-dock" flexDirection="column" height={trayH + SKIRT} minHeight={trayH} flexShrink={1} backgroundColor={FLOOR}>
                  <Box key="rule" height={0.06} backgroundColor="inactive" />
                  <Box key="in" flexDirection="column" paddingX={1} paddingTop={1}>{trayBox}</Box>
                </Box>)
            : null}
          {/* the pulled card rises over the pane as the draft's sheet, the card set in a margin; the sheet is the floor's
              color as wide as the pane, since the pane's text starts at its very edge and would show in a clear
              margin. In place of the draft's shadow, thin dark films over its top edge, which read as shade on either
              theme, and the tray's rule */}
          {/* while it comes up, only its top shows above the window's foot, as the draft's sheet slides up */}
          {docked && face
            ? rail('sheet', offset + bodyRows - risen, { left: 0, right: 0 },
                <Box key="clip" flexDirection="column" height={risen + SKIRT} minHeight={risen} flexShrink={1} overflow="hidden">
                <Box key="sheet" flexDirection="column" height={sheetH + SKIRT} flexShrink={0} justifyContent="flex-end">
                  {SHADE.map((c, i) => <Box key={`shade${i}`} height={0.1} flexShrink={0} backgroundColor={c} />)}
                  <Box key="rule" height={0.06} flexShrink={0} backgroundColor="inactive" />
                  <Box key="pan" flexDirection="column" flexShrink={0} backgroundColor={FLOOR} paddingX={2} paddingTop={1.5} paddingBottom={1}>
                    {face}
                  </Box>
                  <Box key="skirt" height={SKIRT} flexShrink={0} backgroundColor={FLOOR} />
                </Box>
                </Box>)
            : null}
        </Box>
      )
    }
    // The desktop drops a tree past its caps without a word and keeps the old drawing, so a press would seem to do
    // nothing (docs/cards/DESKTOP.md). Measure before handing it over. Past the guard while Coco moves, the cards' press
    // targets wait out the move first, then the older of two overlapping parts goes, then the move itself, so Coco
    // stands at rest; only then are fewer cards drawn, a fifth fewer at a time, the rest left for search.
    let max = shown.length
    let keep = coco.layers.length
    let lite = false
    let tree = draw(max, keep, lite)
    if (!fits(tree) && keep > 0) tree = draw(max, keep, (lite = true))
    while (!fits(tree) && keep > 1) tree = draw(max, --keep, lite)
    if (!fits(tree) && keep > 0) tree = draw(max, (keep = 0), (lite = false))
    for (let i = 0; i < 24 && !fits(tree) && max > 0; i++) tree = draw((max = Math.floor(max * 0.8)), keep, lite)
    stirs = (stirs + 1) % 7
    return stirred(tree, stirs / 1000) as RenderElement
  })
}
