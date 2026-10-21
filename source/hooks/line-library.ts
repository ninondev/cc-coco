// The band's line library (owner 10-17, DECISIONS 988 and his cards): Coco, Claudie and maid Claudie may each have
// lines written for them with the person's model, in the language they pick, kept on this computer; Coco also has the
// lines we ship. Every set can be edited in a text file, and what was saved is said from the next line on. With the
// More row on, Claudie and maid Claudie say their written lines and Coco says the written ones mixed with the shipped ones or alone;
// off, Coco says the shipped lines and Claudie nothing (their chatter goes unsaid, reminders still show: his card
// 「只停闲话，提醒照出」). Nothing is filtered for what the lines say (his 10-17: 「对台词生成不要有限制」): only what the
// band needs to show a written set is checked.
import { LINES } from './lines'

export type LineCharacter = 'coco' | 'dake' | 'maid'
export type LineSet = Record<string, string[]>
export type LineMix = 'only' | 'both'
// The occasions a written set covers; Coco's shipped lines have more, which a written Coco set leaves to them.
export const LINE_GROUPS = [
  'greeting.morning', 'greeting.noon', 'greeting.afternoon', 'greeting.evening', 'greeting.night',
  'start', 'thinking_long', 'working', 'done', 'done_long', 'waiting', 'question', 'error', 'test_fail', 'pass_first',
  'fixed', 'aborted', 'back', 'goodbye', 'sleep', 'wake', 'praised', 'poke', 'pat',
] as const
export const LINES_PER_GROUP = 3
// The widest written line, in terminal cells (a CJK character takes two): 24 CJK characters, or 48 others.
export const LINE_CELLS = 48

// Coco's lines as we ship them, one list per occasion: greeting.<part>, the rest by name, clingy.<occasion>.
const shippedCache = new Map<string, LineSet>()
export function shippedLines(lang: string): LineSet {
  const cached = shippedCache.get(lang)
  if (cached) return cached
  const own = ((LINES as unknown as Record<string, unknown>)[lang] ?? LINES.en) as Record<string, unknown>, set: LineSet = {}
  for (const [key, value] of Object.entries(own)) {
    if (Array.isArray(value)) set[key] = [...value as string[]]
    else if (value && typeof value === 'object') for (const [inner, list] of Object.entries(value as Record<string, unknown>))
      if (Array.isArray(list)) set[`${key === 'greeting' ? 'greeting' : key}.${inner}`] = [...list as string[]]
  }
  shippedCache.set(lang, set)
  return set
}

// What is in use: each character's written set, Coco's shipped set as edited, the row's switch and Coco's mix.
const written: Partial<Record<LineCharacter, LineSet>> = {}
let edited: LineSet | undefined
let used = false
let mix: LineMix = 'both'
export function installWritten(character: LineCharacter, set: LineSet | undefined): void { if (set) written[character] = set; else delete written[character] }
export function installEdited(set: LineSet | undefined): void { edited = set }
export function useWritten(on: boolean, cocoMix: LineMix = 'both'): void { used = on; mix = cocoMix }

/** The lines a character may say for an occasion right now (mood.ts linesFor). */
export function libraryLines(character: LineCharacter, lang: string, key: string, clingy: boolean): readonly string[] {
  const own = used ? written[character]?.[key] ?? [] : []
  if (character !== 'coco') return own
  const base = edited ?? shippedLines(lang), fallback = edited ? undefined : shippedLines('en')
  const shipped = clingy && base[`clingy.${key}`] ? base[`clingy.${key}`]! : base[key] ?? fallback?.[key] ?? []
  return !used ? shipped : mix === 'only' ? own : [...shipped, ...own]
}

// Coco's chatter, which Claudie's forms leave unsaid: Coco's own lines (class 0) other than the occasions above (said as
// theirs, «ambient»), the first hello and the commit asides.
const CHATTER = new Set(['first.hello', 'commit.praise', 'commit.uwu'])
export function claudieUnsaid(line: { key: string; class: number }): boolean {
  return line.class === 0 && line.key !== 'ambient' || CHATTER.has(line.key)
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97c\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u
const NONE = /[\p{M}\u1160-\u11ff\ud7b0-\ud7ff\u200b-\u200f\u2060\ufeff]/u
export function lineCells(text: string): number {
  let n = 0
  for (const ch of text) n += NONE.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1
  return n
}
const shown = (line: string): boolean => !/[\u0000-\u001f\u007f]/.test(line)

/** The model's reply as lane B's prompt asks for it: one JSON object of the groups, three lines each. A group the band
 * cannot show (a line too wide, empty or carrying a control character, or not exactly three lines) is left out whole
 * (lane B's rule, 10-17), and that occasion goes unsaid. Undefined when the reply is not that JSON at all. */
export function writtenLinesFrom(reply: string): LineSet | undefined {
  const start = reply.indexOf('{'), end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let data: unknown
  try { data = JSON.parse(reply.slice(start, end + 1)) } catch { return undefined }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const set: LineSet = {}
  for (const group of LINE_GROUPS) {
    const lines = (data as Record<string, unknown>)[group]
    if (!Array.isArray(lines) || lines.length !== LINES_PER_GROUP) continue
    const kept = lines.map(line => typeof line === 'string' ? line.trim() : '')
    if (kept.every(line => line && lineCells(line) <= LINE_CELLS && shown(line))) set[group] = kept
  }
  return set
}

// A set's text file, as the person edits it: lane B's lines at the head (each starts with #), then each occasion in
// brackets with its lines under it, one a line; a line that breaks in two on the band (a face under the words) is
// written with \n where it breaks.
export function linesText(head: string, set: LineSet): string {
  const top = head.split('\n').map(line => line ? `# ${line}` : '#').join('\n')
  return [top, ...Object.entries(set).map(([key, lines]) => `\n[${key}]\n${lines.map(line => line.replace(/\n/g, '\\n')).join('\n')}`)].join('\n') + '\n'
}
/** What the person saved: every occasion they kept, and its lines as they wrote them (\n breaks one in two); # lines
 * are notes, control characters leave a line out, and the lines under a bracket that names no occasion are left out
 * until the next one. An occasion with no lines left is said as nothing. */
export function linesFromText(text: string): LineSet {
  const set: LineSet = {}
  let key: string | undefined
  for (const raw of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const head = /^\[(.*)\]$/.exec(line)
    if (head) { key = /^[A-Za-z0-9_.-]{1,60}$/.test(head[1]!) ? head[1]! : undefined; if (key) set[key] ??= []; continue }
    if (key && shown(line)) set[key]!.push(line.replace(/\\n/g, '\n'))
  }
  return set
}
