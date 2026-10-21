// Coco's state contract: the one value the band draws from, held by the host for the
// session ($.state). Self-contained on purpose (the engine reads it as written).

export type CocoFrame =
  | 'idle-reading' | 'idle-blink' | 'think-a' | 'think-b' | 'work-a' | 'work-b' | 'happy' | 'waiting'
  | 'error' | 'wild-a' | 'wild-b' | 'sleep' | 'refuse' | 'flustered' | 'wave' | 'snake'

export type CocoMood =
  | 'idle' | 'think' | 'work' | 'happy' | 'waiting' | 'question' | 'error' | 'wild'
  | 'refuse' | 'flustered' | 'sleep' | 'wave' | 'snake'

// Kept for the session's Activity row, separate from the animated band state.
export type CompanionActivity = {
  project: string
  done: number | null
  waitAt: number | null
  reply: { text: string; at: number } | null
  notice: { kind: string; text: string; at: number } | null
  ack: string | null
  channel: boolean
}

// Raw numbers only: surfaces apply the approved word form for the billing kind.
export type CostSurfaceSnapshot = {
  model?: string
  billing: { kind: 'plan' | 'credits' | 'api' | 'cloud' | 'gateway' | 'unknown'; organisation?: boolean; otherMaker?: boolean }
  cache: {
    observed: boolean
    shown?: boolean
    state: 'warm' | 'cooling' | 'cold' | 'kept'
    sentAt: number
    warmUntil: number
    ttlMs: number
    prefix: number
    warmUSD?: number
    coldUSD?: number
    deltaUSD?: number
    kept?: { since: number; pings: number; usd: number; stopAt: number }
    // One keep-warm re-read before any is measured: the prefix at the read price, 30 input and 150 output tokens.
    pingUSD?: number
  }
  sessionUSD?: number
  sessionEstimated?: boolean
  makerEstimate?: { turnUSD?: number; sessionUSD?: number }
  lastTurn?: { usd?: number; estimated?: boolean; window?: { kind: '5h' | '7d'; from: number; to: number } }
  ownCalls?: { count: number; usd: number }
  misses?: { count: number; usd: number }
  ledger?: { day: number; week: number; month: number }
  warmEnabled: boolean
  // The warm switch was set before, so turning it on no longer asks first (COST-CACHE 4.2's one-time question).
  warmAsked?: true
  // That question is open on her bag's switches page.
  warmAsking?: true
  // The screen lock cannot be read here, so keeping warm stops after 30 minutes.
  warmNoLock?: true
  // Today's pauses kept warm, re-reads, their price and what they saved (the warm runtime's 'warm.today').
  warmToday?: { pauses: number; pings: number; usd: number; saved: number }
  // Keeping warm turned itself off on this computer: a return found the cache not held (COST-CACHE 4.7). The switch reads
  // off, and its row says why, until they turn it on again.
  warmHeldOff?: 'notHeld'
}

// Play features: breathing, one stick, the wait at a limit. Strings are words already chosen for the view's language.
export type PlayState = {
  at?: number // the clock when the view was last built; animation offsets are measured from it
  breath?: { since: number; cell?: string; still?: boolean }
  stick?: { startedAt: number; endsAt: number; until: string; tag: string; endedAt?: number }
  wait?: { at: number; time: string; resetsAt?: number }
  relit?: { at: number; turn: boolean }
  out?: number // the stick was put out by hand at this time
  drag?: { dx: number; at: number; droppedAt?: number; sigh?: boolean } // the terminal's picture is lifted dx cells to the right; sigh: the third drag in a minute
  glance?: { at: number; side: 'left' | 'right' } // the pointer came onto him from this side
}

export type CocoView = {
  mood: CocoMood
  frame: CocoFrame
  said: string | null
  context: number | null
  /** The tokens in the conversation the context reading counts, for the commit line's k (lane C, 10-14). */
  contextTokens?: number
  /** The context window those tokens count against, for the band's «309k / 1M» (the desktop band's card, 10-18). */
  contextWindow?: number
  /** The bag's word on the desktop band's bag button («设置», «Settings»), from bag-text in the person's language. */
  bagEntry?: string
  /** Bumped when the pointer left a thing or her picture: the desktop surface keeps a hover until it is redrawn with a new key (10-18). */
  hoverEpochs?: Readonly<Record<string, number>>
  pointerOn?: string
  drawnAside?: string // the stage direction of the picture the desktop band draws now (owner 10-18: 「小字跟着画面走」)
  /** The DM thread (lane C, dm.ts): her messages the person has not seen, for the band's DM entry and the pet. */
  dm?: { unread: number }
  /** Her newest message that reached the closed thread, for the pet's system notification (dm.ts). */
  dmNotice?: { id: string; at: number; title: string; body: string }
  /** The squash on the commit line: 'pushed' while a compaction runs, 'squash' as it ends (set at drawing time). */
  squash?: 'pushed' | 'squash'
  estimate: boolean // the context figure is the engine's local estimate (after a compaction, at a fresh start)
  verb: string
  band: 'on' | 'compact' | 'off' | 'text'
  bandBeforeOff?: 'on' | 'compact' | 'text'
  workSize?: 'same' | 'smaller' // absent in an older session: keep the resting size
  voice: 'off' | 'light' | 'full'
  affection: 'warm' | 'clingy'
  lang: "en" | "fr" | "de" | "hi" | "id" | "it" | "ja" | "ko" | "pt-BR" | "es-419" | "es-ES" | "zh" | "zh-Hant" // generated by tools/build-zh-hant.py from the language table
  pictures: 'cells' | 'kitty'
  colors: 'truecolor' | '256'
  cue: string
  theme?: string
  cost?: CostSurfaceSnapshot
  touch?: 'poke' | 'pat' | 'burst'
  spentWindows?: string[]
  spentResets?: Record<string,number>
  moreActions?: {key:string;label:string}[]
  quotaTimeZone?: string
  quota?: { rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]; costUSD?: number; tokens?: number; at: number }
  companionTarget?: 'auto' | 'claude' | 'vscode'
  neighbours?: boolean
  line?: { id: string; key: string; text: string; class: 0 | 1 | 2 | 3; slots?: { value: string; kind: 'path' | 'test' | 'todo' | 'value' | 'label' }[]; button?: { key: string; label: string }; buttons?: {key:string;label:string}[]; stamp?: string; callId?: string; expiresAt: number }
  pose?: { name: string; frame: string; aside: string; at: number; longAt?: number; celebration?: number }
  companionPose?: CocoView['pose'] | null
  companionLine?: (NonNullable<CocoView['line']> & { untilPrompt?: boolean }) | null
  hotWindows?: string[]
  paceDetails?: { kind: string; wide: string; narrow: string; t: string }[]
  /** Each window's pace over the last 90 minutes, percent an hour, while the reminders measure it (lane C, 10-14). */
  paceRates?: Record<string, number>
  neighbourBusyLabel?: string
  neighbourLights?: { v: 1; running: boolean; agents: { id: string; label: string; busy: boolean; partial: boolean; startedAt?: number; quota?: { primary?: { usedPercent?: number; windowMinutes?: number; resetsAt?: number }; secondary?: { usedPercent?: number; windowMinutes?: number; resetsAt?: number } } }[] }
  ribbon?: { index: number; folder: string; visible: boolean; tiedAt?: number; elapsed?: number; alt?: string }
  helpers?: { id: string; state: 'running'|'done'|'failed'|'stopped'; at: number; arrivalAt?: number; leavingAt?: number; elapsed?: number }[]
  place?: { i: number; n: number; subject: string; dip: number; short?: string; text?: string; alt?: string } // Shiori's place in the task list, with its words
  costume?: { rain?: true; glasses?: true; bow?: true } // small reactions while they last
  outfit?: 'A' | 'B' // Coco's hoodie: A coral (the usual), B cream; a compaction swaps them (owner 10-14)
  act?: { key: string; at: number } // a moment Coco acts out once (coco-motion.ts), set with its mood
  socks?: string // the pair from her sock drawer (a key of tools/art/coco-socks.py PAIRS); absent: her own (owner 10-14)
  claudie?: 'dake' | 'maid' // Claude's form on the desktop band and Coco Pet when it is not Coco (DECISIONS 927); the terminal keeps Coco
  costumeDirection?: string // the stage direction a reaction (or the night lamp) gives him, resolved when the band draws
  night?: boolean // the night lamp stands: 23:00 to 04:59 on the person's clock, read when the band draws
  helpersCount?: number
  helpersAlt?: string
  helpersCountText?: string
  d1ReducedMotion?: boolean
  stageDirection?: string
  shed?: { id: string; phase: 'begin'|'end'|'skip'; at: number }
  visit?: { id: string; kind: 'plane' | 'bulb' | 'leaf' | 'snowman' | 'usb' | 'note' | 'ghost' | 'keycap' | 'cursor'; at: number; leftAt?: number; first?: true; label?: string; narrow?: string } // a visitor on him, added when the band is drawn; `narrow` is its stage direction with the short name first
  saidShort?: string // the wake line that names a visitor, with its short name, for 24 columns and a desktop band under 480 px
  play?: PlayState
  longTask?: { id:string; startedAt:number; completedAt:number; durationMs:number; mode:'off'|'band'|'notify'; quiet:boolean; title:string; body:string; thread:string; targetBundleID?:string }
}

export type HeadState = { mood: CocoMood; newest: boolean; endedAt?: number; ms?: number; first?: boolean; week?: boolean; ribbon?:number; folder?:string }

// His book (the pane): the page open, the library's reading, and a counter that redraws it.
export type CocoBook = {
  page: 'him' | 'omen' | 'offerings' | 'log' | 'library' | 'settings' | 'socks'
  reading: number
  rev: number
  languages?: boolean
  more?: boolean
  talk?: boolean
  visitors?: number // His page shows the guest book, this many months back from the newest
}

// Coco's skill cards (`/coco cards`, hooks-source/cards): the deck, the uses, the tray, the pane and Coco in it. Plain
// JSON data, fit for $.state and $.store; cards/model.ts gives them their short names.
export type CardKind = 'skill' | 'agent' | 'command'

/** Where a card comes from, folded from the engine's several spellings. */
export type CardSource = 'user' | 'project' | 'plugin' | 'builtin' | 'mcp' | 'other'

export type SkillCard = {
  /** `${kind}:${name}`, stable across sessions; the key of its use record. */
  id: string
  kind: CardKind
  /** As the person types it (`sloptrim`, `pdf:pdf`) or as Claude names the agent type (`Explore`). */
  name: string
  /** The definition's own one line; '' when it has none (the card then says so, it never invents one). */
  description: string
  source: CardSource
  /** The plugin that adds it, when source is 'plugin'. */
  plugin?: string
  /** The divider it stands behind; see groupOf in cards/catalog.ts. */
  group: string
}

/** One card's uses: how many, and the last one (ms since the epoch). */
export type CardUse = { n: number; last: number }

/** Use records by card id. Persisted in $.store under STORE_USAGE (cards/model.ts). */
export type CardUsage = Record<string, CardUse>

export type CardsView = 'box' | 'book'
export type CardKindFilter = 'all' | CardKind
/** How the book orders its cards: by divider, by uses, by name. */
export type CardsBookSort = 'group' | 'uses' | 'name'

/** What the pane shows. Session state; `view`, `sort`, `isMotionOff` and `line` are also persisted. */
export type CardsPane = {
  view: CardsView
  kind: CardKindFilter
  query: string
  sort: CardsBookSort
  /** The group whose divider a press on its tab brought to the top of the box; absent in the box's own order. Not persisted. */
  lead?: string
  /** The card pulled out to be read, or null. */
  pulled: string | null
  /** How much of a narrow pane's sheet shows while it comes up, 0 to 1; absent once it is all up. Not persisted. */
  rise?: number
  /** The card whose narrow sheet is going back down, drawn until it is gone. Not persisted. */
  sinking?: string
  /** How much of its way from the box a wide pane's pulled card still has to go, 0 to 1; absent once home. */
  fly?: number
  /** The card whose "+1" is coming off as it is pulled, and which of the steps it has reached; absent once it is off. Not persisted. */
  peel?: { id: string; step: number }
  /** How far over the motion switch's knob is while it slides as motion comes on, 0 to 1; absent at rest. Not persisted. */
  knob?: number
  isMotionOff: boolean
  /** Which of Coco's three lines they say, 0 to 2; each opening of the pane moves on to the next. Absent before the first. */
  line?: 0 | 1 | 2
  /** Cards used since the pane was last closed and not pulled since: they wear the "+1" flag. Not persisted. */
  fresh: string[]
}

/**
 * The deck as last read: loading until the first read ends, error when the engine handed over no list. `hasFolders`
 * once it was dealt with Claude's .claude/skills and .claude/agents read, which waits for the person to open the cards.
 */
export type CardsCatalog = { status: 'loading' | 'ready' | 'error'; cards: SkillCard[]; hasFolders?: boolean }

/**
 * One picture laid over Coco at rest: a part of a move as one play filled it. The arguments are kept rather than
 * the filled source, so every redraw fills the same string again and the desktop keeps the frame playing.
 */
export type CardsLayer = { key: string; move: string; part: number; mark: string; actMs: number; restAge: number }

/** What Coco is doing. Times are ms since the epoch. */
export type CardsCoco = {
  /** When Coco's rest picture was first drawn since the pane opened; plays breathe in step with it. */
  restSince: number
  /** Counts plays, so each play's frames are new ones. */
  play: number
  /** The move playing, or null; its parts are in `layers`. */
  move: string | null
  layers: CardsLayer[]
  /** Moves asked for while another played, played next in order (a hand-over, then a rank-up). */
  queued: string[]
}

declare module 'claude-code' {
  interface PluginState {
    coco: { bandWake: { activationId: string; revision: number }; view: CocoView; book: CocoBook; close: StateFamily<{line:string;lang:string;key:string}>; head: StateFamily<HeadState>; cardsCatalog: CardsCatalog; cardsUsage: CardUsage; cardsTray: string[]; cardsPane: CardsPane; cardsCoco: CardsCoco }
  }
}
