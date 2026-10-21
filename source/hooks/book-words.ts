import type { Page, Fact, Reading, CompanionBookWords, BookWords } from './book-word-types'
export type { Page, CompanionBookWords, BookWords } from './book-word-types'
// The shape of his book's words (the pane /coco opens). The words themselves live in
// plugin/book/<lang>.json, one file per language, and are read only when the book opens, for the
// language he reads in: the plugin carries none of them in memory until then. The small words
// around the engine's rows (his name, yours, the book button) are in words.ts with the band's.
//
// Three kinds of text: labels (sentence case), narration from LORE.md (sentence case), and his
// stage directions (lowercase where the language reads soft, in parentheses, as in the band).
// Layouts never assume a width: every string may wrap, and labels may run long (German, Hindi).
// TODO(main session): review the voice of `direction`, `profile` and `library` in each language.


// Their itabag's seven pages in the owner's order (10-14): 小克, 额度, vibe check, 袜子, 同人誌, 便利贴, 开关 (bag.ts).
export const PAGES: readonly Page[] = ['him', 'offerings', 'omen', 'socks', 'log', 'library', 'settings']








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
