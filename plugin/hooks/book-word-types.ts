export type Page = 'him' | 'omen' | 'offerings' | 'log' | 'library' | 'settings' | 'socks'
export type Fact = { label: string; text: string }
export type Reading = { title: string; text: string }
export type CompanionBookWords = {
  label: string; summon: string; fallback: string
  target: { label: string; help: string }
  absent: string; absentLine: string; install: string
  building: string; buildingLine: string; tools: string; toolsButton: string; toolsAfter: string
  oldTools: string; oldToolsButton: string; oldToolsAfter: string
  failed: string; retry: string; stopped: string; hidden: string
  corner: string; follow: string; followHelp: string
  waiting: string; waitingLine: string; waitingHelp: string; openSettings: string
  following: string; update: string; updateButton: string
  size: string; sizes: readonly string[]; macSizes: readonly string[]
  sizeAlt: { pixel: string; painted: string }
  login: string; capture: string; on: string; off: string
  remove: string; confirm: string; trash: string; keep: string; removing: string; removed: string
  asks: string; notRun: string; cannot: string
  stageAlt: Record<'absent' | 'stopped' | 'hidden' | 'corner' | 'following', string>
  // Off macOS (lane C 10-17): the lines that name the Mac, and the Recycle Bin on Windows; until written, not shown.
  pc?: Partial<{ absentLine: string; remove: string; cannot: string; trashWindows: string; confirmWindows: string; removingWindows: string; removedWindows: string }>
}
export type BookWords = {
  tabs: Record<Page, string>
  title: Partial<Record<Page, string>>
  direction: Partial<Record<Page, string>>
  profile: readonly Fact[]
  offerings: {
    pace: string
    neighbour: string
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
    usedAndReset: string
    noLimits: string
    session: string
    cost: string
    subscriptionCost: string
    cache: string
    started: string
  }
  log: {
    pages: string
    first: string
    latest: string
    wild: string
    times: string
    once: string
    never: string
    at: string
    spark: string
    bookmark: string
  }
  durations: readonly string[]
  check: { title: string; ok: string; fix: string; oldSession: string; copied: string }
  stick: { title: string; help: string; light: string; out: string; until: string; endLabel: string; endQuiet: string; endSound: string }
  library: { previous: string; next: string; of: string; readings: readonly Reading[]; shelf: { head: string; note: string; empty: string; error: string } }
  settings: {
    reminders: string
    guard: { label: string; help: string }
    bookmark: { label: string; help: string }
    notes: { label: string; help: string }
    budget: { label: string; off: string }
    neighbours: { label: string; help: string }
    now: string
    voice: { label: string; off: string; light: string; full: string; help: string }
    affection: { label: string; warm: string; clingy: string }
    band: { label: string; on: string; compact: string; off: string }
    marks: { label: string; on: string; replies: string; off: string; help: string }
    language: { label: string; auto: string; autoNow: string; choose: string }
    motion: { label: string; still: string }
    icon: Record<string, string> & {
      failed: string; fallback: string;
      S1: string; S1a: string; S1b: string; S2: string; 'S3.title': string; 'S3.body': string;
      S3a: string; S3b: string; S3c: string; S4: string; S5: string; S5a: string; S8: string; S9: string; S10: string;
      S11: string; S11a: string; S11b: string; S20: string; S21: string; S22: string; dockRedraw: string
    }
    companion: CompanionBookWords
  }
}
