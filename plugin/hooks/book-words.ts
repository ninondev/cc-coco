// The shape of his book's words (the pane /claudesama opens). The words themselves live in
// plugin/book/<lang>.json, one file per language, and are read only when the book opens, for the
// language he reads in: the plugin carries none of them in memory until then. The small words
// around the engine's rows (his name, yours, the book button) are in words.ts with the band's.
//
// Three kinds of text: labels (sentence case), narration from LORE.md (sentence case), and his
// stage directions (lowercase where the language reads soft, in parentheses, as in the band).
// Layouts never assume a width: every string may wrap, and labels may run long (German, Hindi).
// TODO(main session): review the voice of `direction`, `profile` and `library` in each language.

export type Page = 'him' | 'omen' | 'offerings' | 'log' | 'library' | 'settings'
export const PAGES: readonly Page[] = ['him', 'omen', 'offerings', 'log', 'library', 'settings']

type Fact = { label: string; text: string }
type Reading = { title: string; text: string }

export type CompanionBookWords = {
  label: string; summon: string; fallback: string
  absent: string; absentLine: string; install: string
  building: string; buildingLine: string; tools: string; toolsButton: string; toolsAfter: string
  oldTools: string; oldToolsButton: string; oldToolsAfter: string
  failed: string; retry: string; stopped: string; stoppedLine: string; hidden: string; hiddenLine: string
  corner: string; cornerLine: string; follow: string; followHelp: string
  waiting: string; waitingLine: string; waitingHelp: string; openSettings: string
  following: string; followingLine: string; update: string; updateButton: string
  size: string; sizes: string
  sizeAlt: { pixel: string; painted: string }
  login: string; on: string; off: string
  remove: string; confirm: string; trash: string; keep: string; removing: string; removed: string
  asks: string; notRun: string; cannot: string
  stageAlt: Record<'absent' | 'stopped' | 'hidden' | 'corner' | 'following', string>
}

export type BookWords = {
  tabs: Record<Page, string>
  title: Record<Page, string>
  direction: Record<Page, string> & { omenDrawn: string }
  profile: readonly Fact[]
  omen: { notYet: string; draw: string; drawnOn: string; oneADay: string }
  offerings: {
    context: string
    full: string
    fullAbout: string
    tokens: string
    tokensAbout: string
    estimateNote: string
    noReading: string
    limits: string
    kinds: Record<string, string>
    used: string
    resets: string
    noLimits: string
    session: string
    cost: string
    started: string
  }
  log: {
    pages: string
    first: string
    latest: string
    wild: string
    omens: string
    times: string
    once: string
    never: string
    at: string
  }
  library: { previous: string; next: string; of: string; readings: readonly Reading[] }
  settings: {
    now: string
    voice: { label: string; off: string; light: string; full: string; help: string }
    affection: { label: string; warm: string; clingy: string }
    band: { label: string; painted: string; pixel: string; on: string; compact: string; off: string }
    marks: { label: string; on: string; replies: string; off: string; help: string }
    language: { label: string; auto: string; autoNow: string }
    motion: { label: string; still: string }
    icon: {
      label: string; help: string; own: string; stock: string; custom: string; unknown: string
      replace: string; unknownHelp: string; apply: string; clear: string
      applying: string; clearing: string; reading: string; failed: string; fallback: string
    }
    companion: CompanionBookWords
  }
}

// A language's words laid over English's, key by key, so a word a translation lacks shows in
// English and never as "undefined". Lists (the profile, the readings) are taken whole.
export function overEnglish(en: BookWords, own: unknown): BookWords {
  const lay = (base: unknown, over: unknown): unknown => {
    if (typeof base === 'string') return typeof over === 'string' && over.trim() !== '' ? over : base
    if (Array.isArray(base)) return Array.isArray(over) && over.length > 0 ? over : base
    if (base && typeof base === 'object') {
      const theirs = over && typeof over === 'object' && !Array.isArray(over) ? (over as Record<string, unknown>) : {}
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(base)) out[key] = lay(value, theirs[key])
      for (const [key, value] of Object.entries(theirs)) if (!(key in out)) out[key] = value // e.g. a rate-limit kind English lacks
      return out
    }
    return over ?? base
  }
  return lay(en, own) as BookWords
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}
