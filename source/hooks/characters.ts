// The character table (plugin/assets/characters.json, shape and saved data in zcode/notes/e-character-table.md):
// who can stand on the band, with the name each language reads, so that a new character is a new row. The data is
// embedded (characters-data.ts, built by tools/build-characters.py): the companion record asks for a name without waiting.
import { CHARACTER_DATA } from './characters-data'

export type CharacterId = string
export interface Character {
  id: CharacterId
  /** One entry per language that differs from `default`; "Fatfish" and "fish" are code names and never appear here. */
  names: Readonly<Record<string, string>>
  /** Sixteen chibi cells under plugin/assets/<folder>; null: Coco's own animation. */
  desktop: { folder: string; cells: number; placeholder: boolean } | null
  /** A 24x18 pixel set under plugin/assets/<folder>; null: the terminal keeps Coco's sprite and name. */
  terminal: { folder: string } | null
  persona: string
  lines: string
  /** `context` is the default model's window in tokens (package F's own-key cap reads it); null until a figure is documented. */
  chat: { provider: string; base: string; model: string; context: number | null }
  /** The bag's peek picture; null: Coco's stands in. */
  peek: string | null
}

const MAX_ROWS = 64
const ID = /^[a-z0-9-]{1,24}$/
const text = (value: unknown, max = 40): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max && !value.includes('\n')
const folder = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(value) && value.split('/').every(part => part !== '.' && part !== '..')

function row(value: unknown): Character | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID.test(r.id)) return undefined
  const names = r.names
  if (!names || typeof names !== 'object' || Array.isArray(names) || !text((names as Record<string, unknown>).default)) return undefined
  for (const [lang, name] of Object.entries(names)) if (lang.length > 12 || !text(name)) return undefined
  const d = r.desktop, t = r.terminal, c = r.chat as Record<string, unknown> | null
  if (d !== null && !(d && typeof d === 'object' && folder((d as Record<string, unknown>).folder) && (d as Record<string, unknown>).cells === 16 && typeof (d as Record<string, unknown>).placeholder === 'boolean')) return undefined
  if (t !== null && !(t && typeof t === 'object' && folder((t as Record<string, unknown>).folder))) return undefined
  if (!text(r.persona) || !text(r.lines)) return undefined
  if (!c || typeof c !== 'object' || !text(c.provider) || !text(c.base, 512) || !text(c.model, 200) || !(c.context === null || (Number.isInteger(c.context) && (c.context as number) > 0))) return undefined
  if (r.peek !== null && !folder(r.peek)) return undefined
  return { id: r.id, names: { ...(names as Record<string, string>) }, desktop: d as Character['desktop'], terminal: t as Character['terminal'],
    persona: r.persona, lines: r.lines, chat: { provider: c.provider as string, base: c.base as string, model: c.model as string, context: c.context as number | null }, peek: r.peek as string | null }
}

function parse(value: unknown): Character[] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const table = value as { version?: unknown; characters?: unknown }
  if (table.version !== 1 || !Array.isArray(table.characters) || table.characters.length < 1 || table.characters.length > MAX_ROWS) return undefined
  const rows = table.characters.map(row)
  if (rows.some(each => each === undefined)) return undefined
  const all = rows as Character[]
  if (new Set(all.map(each => each.id)).size !== all.length || all[0]!.id !== 'coco') return undefined
  return all
}

const SHIPPED = parse(CHARACTER_DATA) ?? []
let table: readonly Character[] = SHIPPED

/** Replaces the table (tests, and a later runtime loader). A table that breaks a rule changes nothing and returns false. */
export function installCharacters(value: unknown): boolean {
  const next = parse(value)
  if (!next) return false
  table = next
  return true
}
export function resetCharacters(): void { table = SHIPPED }

export function characters(): readonly Character[] { return table }
export function character(id: unknown): Character | undefined { return typeof id === 'string' ? table.find(each => each.id === id) : undefined }

/** The name a person reads for a character in a language: the table's, else its default; an unknown form reads as Coco. */
export function nameFor(form: unknown, lang: string): string {
  const names = (character(form) ?? table[0])?.names
  return names?.[lang] ?? names?.default ?? 'Coco'
}

/** A stored `claudeForm` that names a character other than Coco, or undefined (Coco, or a form this build does not know). */
export function characterForm(value: unknown): CharacterId | undefined {
  return typeof value === 'string' && value !== 'coco' && character(value) ? value : undefined
}
