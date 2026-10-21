// Talk as a person texts (owner, 10-10): one call, one reply, which he may send as several messages.
// Everything here is a pure function of its input: the same reply gives the same parts and the same pauses.

/** At most this many messages per reply; the rest joins the last one. */
export const TALK_MAX_PARTS = 6
/** The gap between two of his messages (owner 10-10: never two at once, at least 0.2 s, at most 2.5 s). */
export const TALK_GAP_MIN = 200
export const TALK_GAP_MAX = 2500

const MARKER = /^[ \t]*---[ \t]*$/

/**
 * His reply split only at lines that are exactly `---` (trimmed). The words are never cut, trimmed or
 * tidied: only the marker lines (and the line break that ends each one) go. A reply with no marker is one part.
 */
export function splitTalkReply(text: string): string[] {
  const lines = text.split(/(?<=\n)/)
  const parts: string[] = []
  let current = ''
  for (const line of lines) {
    if (MARKER.test(line.replace(/\r?\n$/, ''))) {
      parts.push(current.replace(/\r?\n$/, ''))
      current = ''
    } else current += line
  }
  parts.push(current)
  const kept = parts.filter(part => part.trim() !== '')
  if (kept.length <= TALK_MAX_PARTS) return kept
  return [...kept.slice(0, TALK_MAX_PARTS - 1), kept.slice(TALK_MAX_PARTS - 1).join('\n\n')]
}

/** His turn as the history keeps it: one turn, the parts joined by blank lines. */
export function talkTurnText(parts: readonly string[]): string { return parts.join('\n\n') }

// Typing weight: a CJK or Hangul character holds about as much as two Latin letters.
function typingUnits(text: string): number {
  let units = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    units += /[぀-ヿ㐀-鿿가-힯＀-￯]/.test(ch) ? 2 : 1
  }
  return units
}
const endsThought = (text: string) => /(?:[?？]|\.\.\.|…|[.。!！])["'”’)）]*\s*$/.test(text)
const endsOpen = (text: string) => /(?:[?？]|\.\.\.|…)["'”’)）]*\s*$/.test(text)
const firstWord = (text: string) => (text.trim().match(/^[\p{L}\p{N}]+/u)?.[0] ?? text.trim().slice(0, 1)).toLowerCase()

/**
 * The wait before part `next` after part `prev`: a thinking beat plus typing time, both from the content.
 * Thinking is longer when `next` starts a new thought (after a question, trailing dots, or a finished
 * sentence, opening differently) and shorter for a quick follow-up (a short part, an exclamation, a
 * bracketed action). Typing grows with the length of `next`. No randomness. `quick` (the person wrote
 * again meanwhile) shortens it, never below the minimum.
 */
export function talkPause(prev: string, next: string, quick = false): number {
  const units = typingUnits(next)
  const reaction = units <= 12 || /^[ \t]*[(（\[]/.test(next) || /[!！]["'”’)）]*\s*$/.test(next)
  const newThought = endsOpen(prev) || (endsThought(prev) && firstWord(prev) !== firstWord(next))
  const thinking = reaction ? 150 : newThought ? (endsOpen(prev) ? 700 : 500) : 300
  const typing = units * 28
  const total = Math.min(TALK_GAP_MAX, Math.max(TALK_GAP_MIN, thinking + typing))
  return quick ? Math.max(TALK_GAP_MIN, Math.round(total * 0.4)) : total
}

// The context line (owner, 10-10): a few facts in plain English so he reacts to what is happening. Only
// enumerated values and numbers can enter it: never a name, a path, code, prompt text, a command or arguments.
export type TalkFacts = {
  now: number
  timeZone?: string
  working: boolean
  /** The current tool's name, mapped to a verb from a fixed list; anything else reads as working. */
  tool?: string
  /** His band mood (words.ts Mood). */
  mood?: string
  /** The last test run this session. */
  test?: { verdict: 'pass' | 'fail'; failed?: number }
  /** When the person was last active in this session (their last prompt). */
  lastActiveAt?: number
}
export const TALK_CONTEXT_LIMIT = 200
const TOOL_VERB: Record<string, string> = {
  Read: 'reading', Grep: 'searching', Glob: 'searching', Edit: 'editing', MultiEdit: 'editing', Write: 'writing',
  NotebookEdit: 'editing', Bash: 'running commands', Agent: 'working with helpers', Task: 'working with helpers',
  WebFetch: 'reading the web', WebSearch: 'searching the web',
}
const FACE: Record<string, string> = {
  idle: 'calm', think: 'thinking', work: 'busy', happy: 'happy', waiting: 'waiting', question: 'curious',
  error: 'worried', wild: 'grumpy', refuse: 'stubborn', flustered: 'flustered', sleep: 'sleepy', wave: 'cheerful',
  snake: 'playful',
}
function clock(now: number, timeZone?: string): string | undefined {
  for (const zone of timeZone ? [timeZone, undefined] : [undefined]) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).formatToParts(now)
      const get = (type: string) => parts.find(part => part.type === type)?.value
      const weekday = get('weekday'), hour = get('hour'), minute = get('minute')
      if (weekday && hour && minute) return `${weekday} ${hour}:${minute}`
    } catch { /* an unknown zone falls back to the machine's own */ }
  }
  return undefined
}
function away(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} days`
}
/** One short line, every field optional, at most TALK_CONTEXT_LIMIT bytes. */
export function talkContextLine(facts: TalkFacts, lastTalkAt?: number): string {
  const fields: string[] = []
  const time = clock(facts.now, facts.timeZone)
  if (time) fields.push(`Now: ${time}.`)
  fields.push(facts.working ? `Claude is ${(facts.tool && TOOL_VERB[facts.tool]) || 'working'}.` : 'Claude is idle.')
  if (facts.test) fields.push(facts.test.verdict === 'pass' ? 'Last tests: green.' : Number.isInteger(facts.test.failed) && facts.test.failed! > 0 ? `Last tests: ${facts.test.failed} failed.` : 'Last tests: failed.')
  const last = Math.max(lastTalkAt ?? 0, facts.lastActiveAt ?? 0)
  if (last > 0 && facts.now - last > 600000) fields.push(`They were away ${away(facts.now - last)}.`)
  const face = facts.mood ? FACE[facts.mood] : undefined
  if (face) fields.push(`Your face: ${face}.`)
  const bytes = (text: string) => new TextEncoder().encode(text).length
  while (fields.length && bytes(fields.join(' ')) > TALK_CONTEXT_LIMIT) fields.pop()
  return fields.join(' ')
}

/**
 * The history that rides in a prompt (owner, 10-10): the newest whole exchanges (a person's message and his
 * turn after it) that fit `budget` by `estimate`; the oldest go first and none is ever cut in half.
 */
export function talkHistory<T extends { side: 'person' | 'him' }>(items: readonly T[], line: (item: T) => string, budget: number, estimate: (text: string) => number): T[] {
  const kept: T[] = []
  let used = 0
  let end = items.length
  while (end > 0) {
    let start = end - 1
    while (start > 0 && items[start]!.side === 'him') start--
    const exchange = items.slice(start, end)
    const cost = exchange.reduce((sum, item) => sum + estimate(line(item) + '\n'), 0)
    if (used + cost > budget) break
    kept.unshift(...exchange)
    used += cost
    end = start
  }
  return kept
}
