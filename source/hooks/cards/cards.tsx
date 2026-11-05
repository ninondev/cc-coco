// Coco's skill cards (`/coco cards`): the session's skills, subagents and slash commands dealt as cards in a pane of
// their own; each real use is counted and picked cards ride along with the next message as hidden context.
// register.tsx calls registerCards first, so these hooks stand outside Coco's own (`/coco cards` is taken before the
// /coco verbs, picks join a message before Talk routing, the tray's line sits above Coco's band). A plugin holds one
// hook without a matcher per event, so Coco's session.start and agent.spawn hooks call cardsStarted and cardsSpawned.
// Measured desktop facts: docs/cards/DESKTOP.md; reasons for the choices: docs/cards/DECISIONS.md.
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
const W = 112
const H = 140
const WIDE = 96
const SIDE = 38
const ROW_PX = 19
const COCO_COLS = 21
const SEARCH_ROWS = 1.5
const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
/** Rows a docked part runs past the window's foot: the most the rounded window can be off. */
const SKIRT = 0.5
/** Narrow sheet coming up as [ms after the press, share showing]: three drawings for the draft's 0.32 s slide (a Box cannot move). */
const RISE = [[0, 0.45], [70, 0.82], [140, 1]] as const
const SINK = [[0, 0.55], [70, 0.18], [140, 0]] as const
/** Wide pulled card out of the box as [ms after the press, share still to go]: three drawings for the draft's 0.36 s fly. */
const FLY = [[0, 0.55], [70, 0.18], [140, 0]] as const
const PEEL = [[0, 0.8, 1], [150, 0.45, 2.5], [300, 0.15, 3.5], [450, 0, 4]] as const
const KNOB = [[0, 0.4], [70, 0.8], [140, 1]] as const
/** Longest the first pane opening waits for the deck Claude's folders complete (openPane). */
const DEAL_WAIT_MS = 300

// Desktop card stock and inks are the draft's, the same in both themes: Text in those inks with a blank press target
// over it (`hit`), since a desktop Button inks its label in the theme's own color. Where the draft darkens a surface in
// dark mode the color is a film over a theme surface (DECISIONS.md, Colors). Card stock stays light cream: a film needs
// a box of its own under every card, which a big deck has no room for.
const BASE = 'userMessageBackground'
const FLOOR = 'clawd_background'
const PAPER = '#fffdf8'
const FILM = { kraft: '#9e6529c1', manila: '#ebd298e3', tray: '#5a2e001d', ghost: '#905921c3' } as const
type Film = keyof typeof FILM
const UNDER: Record<Film, string> = { kraft: BASE, manila: BASE, tray: FLOOR, ghost: BASE }
const SOLID: Record<Film, string> = { kraft: '#b98a57', manila: '#ecd7a3', tray: FLOOR, ghost: '#6f5133' }
const INK = { text: '#2a241d', muted: '#5b5246', faint: '#6d6457', manila: '#3b2a17', manilaCount: '#5c4728', coral: '#d97757', onCoral: '#2b140a', stamp: '#9a4024', edge: '#d6cdbf', rule: '#3a86c84d', underline: '#d97757bf' }
const KIND = { skill: '#d97757', agent: '#3a86c8', command: '#2b2925' } as const
const PRINT: Record<Rarity, string | undefined> = { N: undefined, R: '#8b4a26', SR: '#3e4a57' }
const TERM = { paper: BASE, command: 'inactive', R: '#a85c32', SR: '#66707d', stamp: '#b4532f' }
/** Blank, never collapsed: a press target's label of them reaches across what it covers. */
const REACH = '\u2003'
const C = { kraft: '#b98a57', ghostText: '#f7ecdf', flagInk: '#2b140a' }
const SHADE = ['#1e140a0a', '#1e140a12', '#1e140a1f'] as const
const LIFT = ['#3b2a1738', '#3b2a1712'] as const

const FOIL = {
  R: ['#93502a', '#bb6c3e', '#e5a57d', '#bb6c3e', '#93502a', '#bb6c3e'],
  SR: ['#7d8997', '#bad4f1', '#f4c9dd', '#c3e8d5', '#f4e1ae', '#e4cdf0', '#7d8997'],
}
const foldSvg = (bands: string[]) => (size: number, bare = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><style>@media (prefers-color-scheme:dark){.c{fill:#7d5224}}</style><defs><linearGradient id="f" x1="0" y1="1" x2="1" y2="0">${bands
    .map((c, i) => `<stop offset="${(i / (bands.length - 1)).toFixed(2)}" stop-color="${c}"/>`)
    .join('')}</linearGradient></defs>${bare ? '' : `<path class="c" d="M0 0H16V16Z" fill="${C.kraft}"/>`}<path d="M0 0L16 16H0Z" fill="url(#f)"/><path d="M0 0L16 16" stroke="#3b2a17" stroke-opacity=".25" stroke-width=".6"/></svg>`
const FOLD: Record<'R' | 'SR', (size: number, bare?: boolean) => string> = { R: foldSvg(FOIL.R), SR: foldSvg(FOIL.SR) }
const FOIL_CSS = {
  R: 'linear-gradient(45deg,#93502a 0%,#bb6c3e 10%,#f4c6a6 18%,#bb6c3e 27%,#e5a57d 36%,#93502a 46%,#e5a57d 56%,#f4c6a6 64%,#bb6c3e 74%,#e5a57d 84%,#93502a 100%)',
  SR: 'linear-gradient(45deg,#7d8997 0%,#dfe7f0 9%,#f4c9dd 18%,#c3e8d5 27%,#f4e1ae 36%,#bad4f1 45%,#7d8997 53%,#e4cdf0 62%,#c3e8d5 71%,#f4e1ae 80%,#bad4f1 89%,#7d8997 100%)',
}
/** The pulled card's flap glints once as it comes up (1.1 s after 0.2 s), in an interactive frame so the animation plays; the card's id rides in the source, so each pulled card gets a frame and glints, a redraw keeps it and does not. */
const glintSvg = (r: 'R' | 'SR', size: number, id: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><style>/*${id.replace(/[^\w:.-]/g, '')}*/` +
  `body::after{content:"";position:absolute;inset:0;clip-path:polygon(0 0,100% 100%,0 100%);` +
  `background:linear-gradient(45deg,transparent 49.3%,rgba(59,42,23,.25) 50%,transparent 50.7%),${FOIL_CSS[r]};` +
  `background-size:100% 100%,200% 200%;background-position:0 0,0 100%;animation:g 1.1s cubic-bezier(.16,1,.3,1) .2s 1 both}` +
  `@keyframes g{to{background-position:0 0,100% 0}}` +
  `@media (prefers-reduced-motion:reduce){body::after{animation:none;background-position:0 0,100% 0}}</style></svg>`

function stampOf(text: string): { source: string; width: number; height: number } {
  const { svg, w, h } = stamp(text, INK.stamp)
  return { source: svg, width: w, height: h }
}

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

/** The tray's names for the band. Coco's band answers its first drawing before it reads anything (tools/tests/b1b-first-answer.test.tsx: no host call), so its hook reads here, not $.state; each tray or deck change asks for the band again. */
let bandNames: readonly string[] = []

async function syncBand($: EngineInterface): Promise<void> {
  const [tray, catalog] = await Promise.all([read($, trayAtom), read($, catalogAtom)])
  const names = tray.map(id => catalog.cards.find(c => c.id === id)?.name).filter((n): n is string => !!n)
  if (names.length === bandNames.length && names.every((n, i) => n === bandNames[i])) return
  bandNames = names
  $.ui.invalidate('ui.render')
}

async function setTray($: EngineInterface, change: (tray: string[]) => string[]): Promise<void> {
  await update($, trayAtom, change)
  await syncBand($)
}

let cocoLang: () => string = () => 'en'
const lang = (): Lang => langOf(cocoLang())
/** Whether the pane is up. A draw request sets it too: after a reload or a desktop open the pane is up without the mod's own open, and Coco's moves never played. */
let isPaneOpen = false
let cwd = ''
const offered = new Map<string, AgentEntry>()
/** Deals begun (loadCatalog): an earlier deal ending later must not lay its deck over a newer one. */
let deals = 0
let searchGen = 0
let sheetDocks = false
let art: Art | null = null
let artRead: Promise<Art | null> | null = null

// Buttons and the search field are made once and returned on every redraw: a new element retires the handle the desktop
// page holds, so a fresh one would lose the first press (the click that focuses the pane redraws it). Unused ones are let go.
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

/** Under the desktop pane's caps (tree under 262,144 characters, 2,000 nodes, depth 32), with margin. */
const CAPS = { chars: 250000, nodes: 1900, depth: 30 }
const HANDLE = 64
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }
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

let stirs = 0
/**
 * The tree with every Box around a moving picture given a min width `hair` columns over its own (a few thousandths,
 * unseen): a page follows nothing in a box whose size just changed, so the window stays where the person left it
 * instead of chasing the cards (DESKTOP.md). A row Box with no min width of its own is passed over (any would let it
 * shrink below its content).
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

/** Deals the deck. With `withFolders`, also names from .claude/skills and .claude/agents, read only once the person has opened the cards (promise B8); until then a user command may be a skill hidden from the model, so its runs wait (parkRun). */
async function loadCatalog($: EngineInterface, withFolders: boolean): Promise<void> {
  const deal = ++deals
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
      // Own subagents from their definition files, dealt before the first message; agent.offer replaces them. A project's
      // file wins over the user's of the same name, as in Claude Code.
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

function reveal($: EngineInterface, key: string, block: 'start' | 'nearest' | 'center'): void {
  $.clock.after(80, () => void $.ui.scroll({ to: { key }, in: PANE, block }).catch(() => undefined))
}

/** Moves the focus ring onto `key`; waits out the sheet's steps, since focus scrolls into view and could scroll the clip a rising sheet is drawn in. */
function focusOn($: EngineInterface, key: string): void {
  $.clock.after(RISE[2][0] + 40, () => void $.ui.focus({ requestId: PANE, key }).catch(() => undefined))
}

/** Coco's pictures, read on first draw by a surface that draws them; null when unreadable, and the pane then draws in words. */
function pictures($: EngineInterface): Promise<Art | null> {
  artRead ??= $.fs.read(joinPath($.plugin.root, 'hooks', 'cards-art.json')).then(parseArt, () => null).then(a => (art = a))
  return artRead
}

async function openPane($: EngineInterface): Promise<boolean> {
  if (art === null) artRead = null
  // the pane waits a moment for the deck Claude's folders complete, so a hidden skill does not open among the commands and then move
  if (!(await read($, catalogAtom)).hasFolders) {
    const dealt = bringsCoco($, () => loadCatalog($, true)).catch(() => undefined)
    let giveUp = () => {}
    const timer = $.clock.after(DEAL_WAIT_MS, () => giveUp())
    await Promise.race([dealt, new Promise<void>(done => (giveUp = done))])
    timer.cancel()
  }
  await savePrefs($, await update($, paneAtom, (p): PaneState => ({ ...p, line: p.line === undefined ? 0 : (((p.line + 1) % 3) as 0 | 1 | 2) })))
  const placed = await $.ui.open({ id: PANE, title: STRINGS[lang()].title })
  isPaneOpen = placed?.isPlaced === true
  const now = await $.clock.now()
  await update($, cocoAtom, c => rested(c, now))
  return isPaneOpen
}

async function playMove($: EngineInterface, move: MoveName): Promise<void> {
  const moveArt = art?.MOVES[move]
  if (!moveArt) return
  const pane = await read($, paneAtom)
  const now = await $.clock.now()
  let started = false
  const coco = await update($, cocoAtom, c => {
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

/** Counts a slash command the person ran if it is a card. Its hook does not wait: Coco's command.run hook starts its own work (the bag's socks) and answers no later with the cards than without. */
async function countCommand($: EngineInterface, command: string): Promise<void> {
  try {
    const { cards, hasFolders } = await read($, catalogAtom)
    const card = cards.find(c => c.id === `command:${command}`)
    if (!card) return
    if (!hasFolders && (card.source === 'user' || card.source === 'project')) await parkRun($, command)
    else await countUse($, card.id)
  } catch {}
}

/** Keeps a run of command `name` while Claude's folders are unread (it may be a skill hidden from the model, which skill.prompt counts): waits among the `run:` counts (none a card's) until the deck is dealt with folders; goes into the store meanwhile. */
async function parkRun($: EngineInterface, name: string): Promise<void> {
  const now = await $.clock.now()
  const usage = await update($, usageAtom, u => addUse(u, `run:${name}`, now).usage)
  try {
    await $.store.set(STORE_USAGE, usage)
  } catch {}
}

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

async function onPress($: EngineInterface, key: string): Promise<void> {
  const [kind, arg = ''] = key.split(/:(.*)/s)
  const pane = (fn: (p: PaneState) => PaneState) => update($, paneAtom, fn)
  // a sheet going back down still shows its buttons; a second press on them (a double click) does nothing
  if ((kind === 'take' || kind === 'takeup' || kind === 'type' || kind === 'back') && (await read($, paneAtom)).sinking !== undefined) return
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
    const rises = sheetDocks
    const p = await pane(p => ({
      ...p,
      pulled: arg,
      fresh: seen(p.fresh, arg),
      sinking: undefined,
      peel: !p.isMotionOff && (p.fresh ?? []).includes(arg) ? { id: arg, step: 0 } : p.peel,
      rise: rises && !p.isMotionOff && p.pulled === null ? RISE[0][1] : p.rise,
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
    // a docked sheet stands alone in the window; asking for it could scroll the clip it rises in, so focus goes to its main button
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
    if (was) {
      reveal($, `card:${was}`, 'center')
      focusOn($, `card:${was}`)
    }
  } else if (kind === 'jump') {
    // the group's divider moves up under the tabs and the window stays put (owner's choice, DECISIONS.md)
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

function stateOf(catalog: Catalog, pane: PaneState, shown: number): StateName | null {
  if (catalog.status === 'loading') return 'shuffle'
  if (catalog.status === 'error') return 'emptybox'
  if (pane.view === 'book') return 'album'
  if (catalog.cards.length === 0) return 'wait'
  if (shown === 0) return pane.query ? 'dig' : 'wait'
  return null
}

function cocoIn(catalog: Catalog, pane: PaneState): boolean {
  return stateOf(catalog, pane, catalog.cards.filter(c => (pane.kind === 'all' || c.kind === pane.kind) && matches(c, pane.query)).length) === null
}

/** Runs a change; when it brings Coco's card back into the drawing, Coco's frame at rest starts over, drawn anew. A drawing may not write, so the handler does it. */
async function bringsCoco($: EngineInterface, change: () => Promise<unknown>): Promise<void> {
  const was = cocoIn(await read($, catalogAtom), await read($, paneAtom))
  await change()
  if (was || !cocoIn(await read($, catalogAtom), await read($, paneAtom))) return
  const now = await $.clock.now()
  await update($, cocoAtom, (c): CocoState => ({ ...c, restSince: now }))
}

/** Loads counts and settings and deals the deck as a session starts (a plugin holds one session.start hook, so Coco's calls this). Folders wait for the person to open the cards; a reload deals them again when the deck held them. */
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

export async function cardsSpawned($: EngineInterface, subagentType: string): Promise<void> {
  try {
    await countUse($, `agent:${subagentType}`)
  } catch {}
}

export function registerCards(on: On, language: () => string): void {
  cocoLang = language

  on('command.run', { command: 'coco' }, async ($, e, next) => {
    if (e.args.trim().toLowerCase().split(/\s+/)[0] !== 'cards') return next(e)
    if (!(await openPane($))) $.ui.toast(STRINGS[lang()].notPlaced, { timeoutMs: 8000 })
    return {}
  })

  // The same pane from the button at the top of Coco's bag (book.tsx, owner 10-19).
  on('ui.press', { element: 'coco:cards:open' }, async ($, e) => {
    if (!(await openPane($))) $.ui.toast(STRINGS[lang()].notPlaced, { timeoutMs: 8000 })
    return { element: e.element }
  })

  // A slash command run at the prompt or through Remote Control counts; a plugin's run does not, and a skill typed as /name counts at skill.prompt. The matcher keeps this hook apart from Coco's (one command.run hook without a matcher).
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

  // Picked cards ride along only with a message the person sent themselves (prompt or Remote Control), not a task notification or a plugin's message, then return to the box.
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
      // the model alone reads what went along, so the person is told which cards (owner, 2026-10-15)
      $.ui.toast(STRINGS[lang()].carried(picked.filter(c => c.kind !== 'command').map(c => c.name)))
    }
    return result
  }).catch(($, e, next) => next(e))

  // Tray names in the band above the prompt box until the message goes (owner, 2026-10-15); Coco's band and other mods' stay under it. An empty tray reads nothing and passes the band on (bandNames).
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
    // VS Code draws the terminal's pane, in words: owner 10-19, 「vscode和cli纯文字版」
    const flat = e.surface === 'terminal' || e.surface === 'vscode'
    // the phone places nothing absolutely, so the desktop's pane is drawn in one flow (owner 10-19: 「手机尽可能接近windows/mac/linux app客户端体验」)
    const flow = e.surface === 'mobile'
    // off the desktop a pulled card opens under its own strip or pocket, buttons with it (owner 10-19: 「就地展开」)
    const inline = e.surface !== 'desktop'
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
    // A desktop Button is one line of its label in its native style and draws no children (DESKTOP.md); a card's colors and weights sit in Text beside it.
    const desk = !flat
    // VS Code fills a plain button in its accent color, so there a plain one is drawn dim, as an outline
    const button = (key: string, label: string, extra: { variant?: 'primary'; plain?: true; dimColor?: true } = {}) =>
      once(`${e.surface}|b|${key}|${label}|${JSON.stringify(extra)}`, () =>
        Button({ key, label, ...(e.surface === 'vscode' && extra.plain ? { dimColor: true } : extra), onPress: noop }))
    /**
     * Press target over a drawing on the desktop: a plain Button of blank spaces (`reach` columns) then the screen-reader
     * words, past the drawing's right edge, where the drawing (drawn `overflow="hidden"`) cuts it off. It fills the
     * drawing's height (a row Box naming `alignItems` stretches it; otherwise it centers), a hair in from the edges so the
     * focus ring shows. Drawn last, so it lies over the rest.
     */
    const hit = (key: string, label: string, reach: number) => flow ? null : (
      <Box position="absolute" top={0} bottom={0} left={0} width={reach * 2 + label.length * 2 + 8} padding={0.2} alignItems="stretch">
        {button(key, REACH.repeat(Math.ceil(reach * 0.62) + 2) + label, { plain: true })}
      </Box>
    )
    const filmed = (key: string, film: Film, outer: Record<string, unknown>, inner: Record<string, unknown>, kids: unknown) =>
      desk ? (
        <Box key={key} backgroundColor={UNDER[film]} {...outer}>
          <Box key="f" flexGrow={1} minWidth={0} backgroundColor={FILM[film]} {...inner}>{kids as RenderElement}</Box>
        </Box>
      ) : (
        <Box key={key} backgroundColor={SOLID[film]} {...outer} {...inner}>{kids as RenderElement}</Box>
      )
    const kindInk = (k: Card['kind']) => (desk || k !== 'command' ? KIND[k] : TERM.command)
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
    // Coco's card tilts at the front right of the box; under a state the picture stands mid-box; the book gives Coco a pocket.
    // Each picture lies on a blank of its size; Coco at rest always lies on theirs, so that frame never restarts while the
    // pane is open, and a move's parts lie on top (DESKTOP.md). Without readable pictures the pane draws in words.
    const hasSvg = pics !== null && 'Svg' in table
    const layer = (key: string, source: string) =>
      'Svg' in table ? (
        <Box key={key} position="absolute" top={0} left={0}>
          {table.Svg({ source, alt: s.cocoAlt, width: W, height: H, isInteractive: true })}
        </Box>
      ) : null
    const blank = (key: string) =>
      'Svg' in table && pics ? (
        <Box key={key} flexDirection="column" flexShrink={0}>
          {table.Svg({ source: pics.SPACER, alt: s.cocoAlt, width: W, height: H })}
        </Box>
      ) : null
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
    const card = cocoCard(s.cocoBox[turn], pics?.TILT ?? 0, W, H)
    const cardRows = Math.ceil(card.h / ROW_PX)
    const standRows = (card.foot + 14) / ROW_PX
    // `keep`: how many of a move's layers to draw, the newest; fewer when the pane would pass the desktop's caps
    const cocoCardOf = (keep: number): RenderElement | null => {
      if (!pics || !('Svg' in table)) return null
      const { Svg } = table
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

    const kinds = (['all', 'skill', 'agent', 'command'] as const).map(k => {
      const w = word(`kind:${k}`, `${s.kind[k]} ${counts[k]}`, pane.kind === k)
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
    const isMoving = !pane.isMotionOff
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
    let said: string | null = null
    let out: RenderElement | null = null
    if (state === 'shuffle') said = s.loading
    else if (state === 'emptybox') [said, out] = [s.error, desk ? pill('retry:', s.retry, false, true) : button('retry:', s.retry)]
    else if (state === 'dig') [said, out] = [s.noMatch(pane.query), desk ? pill('clearq:', s.clearSearch, false, true) : button('clearq:', s.clearSearch)]
    else if (state === 'wait') said = catalog.cards.length === 0 ? s.empty : s.emptyKind
    const status = said === null || hasSvg ? null : <Box key="st" flexDirection="column" rowGap={0.5}><Text>{said}</Text>{out}</Box>
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

    const topStripe = (k: Card['kind']) =>
      k === 'agent' ? (
        <Box key="k" flexDirection="column" rowGap={0.2}>
          <Box key="a" height={0.1} backgroundColor={KIND.agent} />
          <Box key="b" height={0.1} backgroundColor={KIND.agent} />
        </Box>
      ) : (
        <Box key="k" height={k === 'skill' ? 0.2 : 0.26} backgroundColor={flow && k === 'command' ? TERM.command : KIND[k]} />
      )
    const stripe = (k: Card['kind']) => <Text key="k" color={kindInk(k)}>{k === 'agent' ? '‖' : '▌'}</Text>
    const rarityMark = (c: Card) => {
      const r = rank(c)
      return r === 'N' ? null : <Text key="r" bold color={desk && !flow ? PRINT[r] : TERM[r]}>{r}</Text>
    }
    /** A rare card's folded corner: a boxed card shows kraft in the cut, a `lifted` one the pane's floor; the flap glints on rising unless motion is off. */
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
    const flag = (c: Card) =>
      !(pane.fresh ?? []).includes(c.id) ? null
      : hasSvg ? <Box key="new" flexShrink={0}>{table.Svg({ source: FLAG.svg, alt: '+1', width: FLAG.w, height: FLAG.h })}</Box>
      : <Text key="new" bold color={C.flagInk} backgroundColor={KIND.skill}> +1 </Text>
    const inkOf = (tone: 'text' | 'muted' | 'faint') => (desk ? INK[tone] : tone === 'text' ? undefined : 'inactive')
    const ink = inkOf
    const boxCols = wide ? cols - SIDE - 2 : cols
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
    // the "+1" of a card just pulled stays on the strip, fainter and higher at each of PEEL's steps; laid over the slot so the box does not move
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
     * Coco's moving pictures lie on a layer of their own over the box or the book, never inside it, so a redraw makes the
     * box anew in one piece (DESKTOP.md). That alone did not stop the window being pulled to the box's end; `stirred` did
     * (owner's desktop, 2026-10-15). On the bench at the harshest layout timing tried, both together held better than
     * `stirred` with the frames inside the box.
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
    const boxView = (max: number, lite: boolean, keep: number) => {
      const whole = groupsOf(shown)
      const led = pane.lead && whole.has(pane.lead) ? [...(whole.get(pane.lead) ?? []), ...shown.filter(c => c.group !== pane.lead)] : shown
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
      // Coco's card on a rail from the window-bottom place to the box's floor; where the rail is shorter than the card it
      // stands on the floor, never past it (the rail lays it out flex-end, a spacer under it taking the rest)
      const cocoRail = hasSvg && !flow ? rail('cocorail', cocoTop, { right: 0, width: COCO_COLS }, cocoCardOf(keep)) : null
      const groups = [...groupsOf(led.slice(0, max))].map(([g, cs], i) => (
        <Box key={`g-${g}`} flexDirection="column" rowGap={0.25} paddingRight={hasSvg && !flow ? COCO_COLS : 0}>
          {divider(g, (whole.get(g) ?? cs).length, i)}
          {cs.flatMap(c => (pane.pulled !== c.id ? [strip(c, lite)] : inline ? [strip(c, lite), face] : [ghost(c)]))}
        </Box>
      ))
      const moreLine = shown.length > max ? <Box key="more" marginTop={1}><Text color={desk ? 'text' : '#24180b'}>{s.moreCards(shown.length - max)}</Text></Box> : null
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
      if (flow && tabs) return <Box key="deckroom" flexDirection="column" flexGrow={1} minWidth={0}>{tabs}{deck}</Box>
      return layered('deckroom', deck, cocoRail)
    }

    const pocket = (c: Card, lite: boolean) => {
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
    // Coco's pocket: it holds a blank where the picture goes; the picture lies on the layer over the pages (`layered`), set
    // in by the page's padding, then the pocket's stripe and padding, as the blank is
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
      const opened = (cs: Card[]) => (inline && pane.pulled && cs.some(c => c.id === pane.pulled) ? face : null)
      const page = (cs: Card[], first: boolean) =>
        filmed('page', 'kraft', {}, { flexWrap: 'wrap', columnGap: 2, rowGap: 1, paddingX: 2, paddingY: 1 }, [first ? cocoPocket : null, ...cs.map(c => pocket(c, lite))])
      const more = list.length > max ? <Text key="more">{s.moreCards(list.length - max)}</Text> : null
      // the first page's tab stands above the layer holding Coco's album picture, so the layer starts at the first page's top
      // and the picture lies a whole row down; the other pages and the rest of the book are under it
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
    const pulledId = pane.pulled ?? pane.sinking ?? null
    const pulled = pulledId ? catalog.cards.find(c => c.id === pulledId) : undefined
    let face: RenderElement | null = wide && !inline ? (
      <Box key="hint" borderStyle="single" justifyContent="center" paddingX={2} paddingY={3} />
    ) : null
    if (pulled) {
      const n = toNext(usage[pulled.id], now)
      const inTray = tray.includes(pulled.id)
      const sheetUp = hasSvg && !flow && !wide && catalog.status === 'ready'
      const take = pulled.kind === 'command' ? pill(`type:${pulled.id}`, s.typeIt, true) : pill(`${sheetUp ? 'takeup' : 'take'}:${pulled.id}`, inTray ? s.untake : s.take, !inTray)
      const lines = [
        <Box key="h" justifyContent="space-between" columnGap={1} paddingRight={desk && rank(pulled) !== 'N' ? 2 : 0}>
          <Text bold color={ink('text')}>{pulled.name}</Text>
          {rarityMark(pulled)}
        </Box>,
        desk ? <Box key="rule" height={0.12} backgroundColor={INK.underline} /> : null,
        <Text key="call" color={ink('muted')}>{pulled.kind === 'agent' ? s.agentCall : `/${pulled.name}`}</Text>,
        <Text key="desc" color={ink(pulled.description ? 'text' : 'faint')}>{pulled.description || s.noDescription}</Text>,
        <Text key="meta" color={ink('muted')}>{s.meta(s.kindOne[pulled.kind], s.group(pulled.group))}</Text>,
        <Box key="next" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
          <Text color={ink('muted')}>{n ? s.toNext(n.uses, n.to) : s.top}</Text>
          {hasSvg ? (
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
    // in words (the terminal, VS Code) the tray shows only once a card is in it (owner 10-19, 「纯文字版把这些去掉」)
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
    // The pane is one scroller and cannot hold a part still (DESKTOP.md), so on the desktop the parts the draft pins are
    // laid over the flow at the window's place, which every scroll redraws. Each lies on a rail from where it should stand
    // to the end of what it belongs to, so it stops there and never lengthens the pane. Rows are counted the desktop's way
    // (the window shows offset to offset + bodyRows); heights are estimates kept a little generous, so a part sits a row
    // clear of an edge rather than under it.
    const { offset, bodyRows } = e.props.scroll ?? { offset: 0, bodyRows: 40 }
    const ready = catalog.status === 'ready'
    const pinned = hasSvg && !flow
    const colsOf = (t: string) => {
      let n = 0
      for (const ch of t) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 1.8 : 1
      return n
    }
    const linesOf = (t: string, width: number) => Math.max(1, Math.ceil(colsOf(t) / Math.max(8, width)))
    const faceRows = (c: Card, width: number) => {
      const w = width - 4
      const takeLabel = c.kind === 'command' ? s.typeIt : tray.includes(c.id) ? s.untake : s.take
      const acts = colsOf(takeLabel) + colsOf(s.putBack) + 13
      const n = toNext(usage[c.id], now)
      const next = colsOf(n ? s.toNext(n.uses, n.to) : s.top) + colsOf(s.uses(uses(c))) + 5
      return 0.2 + 0.75 + linesOf(c.name, w - 3) + 0.25 + 0.12 + 0.25 + 1 + 0.25 + linesOf(c.description || s.noDescription, w) + 0.25 +
        linesOf(s.meta(s.kindOne[c.kind], s.group(c.group)), w) + 0.25 + (next > w ? 2.5 : 1.3) + 0.25 + 0.25 + (acts > w ? 4.45 : 2.1) + 0.75 + 0.2
    }
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
    const workTop = 1 + 0.5 + SEARCH_ROWS + 0.5 + (kindsCols > cols ? 2.37 : 1.12) + 0.5 + 1.12 + 0.5
    const docked = pinned && !wide && ready
    sheetDocks = docked
    const trayH = docked ? Math.ceil(0.06 + 0.5 + trayRows(cols - 2) + 1) : 0
    const sheetH = docked && pulled ? Math.min(bodyRows - 2, Math.ceil(faceRows(pulled, cols - 4) + 0.3 + 0.06 + 0.75 + 0.5 + 0.5)) : 0
    const risen = pane.isMotionOff ? sheetH : Math.round(sheetH * Math.min(1, pane.rise ?? 1) * 100) / 100
    const cocoTop = Math.max(4, offset + bodyRows - trayH - standRows - workTop)
    const stick = Math.max(0, offset + 1 - workTop)
    const sideRows = (pulled ? faceRows(pulled, SIDE) : 4.2) + 1 + trayRows(SIDE) + 2

    // on the desktop the face is drawn in a place of its own, shifted toward the box while it comes out: desktop offsets
    // exist on absolute Boxes only, so the shift is a negative margin on a place as wide as the column; always drawn, so
    // the glint's frame keeps its place
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
    /** A part laid over the flow from row `top` of its parent to the parent's foot. An absolute place is a whole row, so a spacer above the part carries the rest of `top`. */
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
      // a docked pane reaches at least the window's foot, so a short deck's tray still docks there (the draft's margin-top:
      // auto), half a row short of it in case the window's last row is cut
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
    // The desktop drops a tree past its caps without a word and keeps the old drawing, so a press would seem to do nothing.
    // Measure before handing it over. Past the guard while Coco moves, the cards' press targets wait out the move first,
    // then the older of two overlapping parts goes, then the move itself; only then are fewer cards drawn, a fifth fewer at
    // a time, the rest left for search.
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
