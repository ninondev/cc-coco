// Builds the deck from what the engine lists. Measured on Claude Code 2.1.295 (docs/cards/DESKTOP.md):
// - $.command.list() returns skills and slash commands together, each with its full description and a source
//   ('builtin' | 'plugin' | 'user' | 'mcp'); user skills come back as source 'user', plugin skills as 'plugin'.
// - $.session.usage({ breakdown: 'summary' }).context.breakdown.skills.skillFrontmatter names the skills the model
//   is offered; that is how a skill is told from a command. Skills with model invocation turned off are missing
//   there, so the names of the skills folders count too.
// - Subagents are not in the command list; agent.offer events carry each type with its description and source.
import type { Card, Kind, Source } from './model'

export type CommandEntry = { name: string; description: string; source: string; plugin?: string }
export type AgentEntry = { agent: string; description: string; source: string; provider?: { plugin?: string } }

/** Commands that are the engine's plumbing, renamed stubs or removed ones: never dealt. */
export function isPlumbing(c: CommandEntry): boolean {
  return c.name.startsWith('_') || /^\(removed\)|^Renamed to /i.test(c.description.trim())
}

const commandSource = (s: string): Source =>
  s === 'user' ? 'user' : s === 'project' ? 'project' : s === 'plugin' ? 'plugin' : s === 'builtin' ? 'builtin' : s === 'mcp' ? 'mcp' : 'other'

/** agent.offer's source: 'built-in', 'plugin', or a settings source ('userSettings', 'projectSettings', ...). */
const agentSource = (s: string): Source =>
  s === 'built-in' ? 'builtin' : s === 'plugin' ? 'plugin' : s === 'userSettings' ? 'user' : /Settings$/.test(s) ? 'project' : 'other'

/** The divider a card stands behind: yours, built in, one per plugin, MCP. */
export function groupOf(source: Source, plugin?: string): string {
  if (source === 'plugin') return plugin ? `plugin:${plugin}` : 'plugin'
  if (source === 'user' || source === 'project') return 'yours'
  if (source === 'builtin') return 'built-in'
  if (source === 'mcp') return 'mcp'
  return 'other'
}

/** One line for a strip: the description's first sentence or line, cut to `max` characters. */
export function firstLine(text: string, max = 80): string {
  const line = text.trim().split(/\n/)[0] ?? ''
  const cut = line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
  return cut
}

export type CatalogInput = {
  commands: readonly CommandEntry[]
  /** Skill names from the context breakdown's skillFrontmatter. */
  skillNames: ReadonlySet<string>
  /** Folder names under the skills folders (user and project); may be empty when they cannot be listed. */
  skillDirs: ReadonlySet<string>
  agents: readonly AgentEntry[]
}

export function buildCatalog(input: CatalogInput): Card[] {
  const cards = new Map<string, Card>()
  for (const c of input.commands) {
    if (isPlumbing(c)) continue
    const source = commandSource(c.source)
    const isSkill = input.skillNames.has(c.name) || ((source === 'user' || source === 'project') && input.skillDirs.has(c.name))
    const kind: Kind = isSkill ? 'skill' : 'command'
    const card: Card = { id: `${kind}:${c.name}`, kind, name: c.name, description: c.description.trim(), source, group: groupOf(source, c.plugin) }
    if (c.plugin) card.plugin = c.plugin
    cards.set(card.id, card)
  }
  for (const a of input.agents) {
    const source = agentSource(a.source)
    const plugin = source === 'plugin' ? a.provider?.plugin : undefined
    const card: Card = { id: `agent:${a.agent}`, kind: 'agent', name: a.agent, description: a.description.trim(), source, group: groupOf(source, plugin) }
    if (plugin) card.plugin = plugin
    cards.set(card.id, card)
  }
  return [...cards.values()]
}

/**
 * A subagent's name and description from its own definition file (`.claude/agents/<file>.md`), so the person's own
 * subagents are dealt before the first message's `agent.offer`. Reads the frontmatter's `name` (else the file's
 * name) and `description`, nothing else; null when the file has no frontmatter.
 */
export function agentFromFile(text: string, file: string): { name: string; description: string } | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return null
  const front = lines.slice(1, end)
  const field = (key: string): string | undefined => {
    const i = front.findIndex(l => l.startsWith(`${key}:`))
    if (i < 0) return undefined
    const value = front[i]!.slice(key.length + 1).trim()
    // a block scalar: the indented lines under the key, kept as lines (|) or folded into one (>)
    const block = /^([|>])[+-]?\d?$/.exec(value)
    if (block) {
      const body: string[] = []
      for (let j = i + 1; j < front.length && (/^\s/.test(front[j]!) || front[j]!.trim() === ''); j++) body.push(front[j]!.trim())
      return body.join(block[1] === '|' ? '\n' : ' ').trim()
    }
    return unquote(value)
  }
  const name = field('name') || file.replace(/\.md$/i, '')
  return name ? { name, description: field('description') ?? '' } : null
}

/** A YAML scalar written in quotes, unquoted: `\n`, `\"` and `\\` in double quotes, `''` in single ones. */
function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

/** Adds or refreshes one agent offered after the deck was built; returns the same array when nothing changed. */
export function withAgent(cards: readonly Card[], a: AgentEntry): readonly Card[] {
  const [one] = buildCatalog({ commands: [], skillNames: new Set(), skillDirs: new Set(), agents: [a] })
  if (!one) return cards
  const i = cards.findIndex(c => c.id === one.id)
  if (i >= 0 && cards[i]!.description === one.description && cards[i]!.group === one.group) return cards
  return i >= 0 ? cards.map((c, j) => (j === i ? one : c)) : [...cards, one]
}

const KIND_ORDER: Record<Kind, number> = { skill: 0, agent: 1, command: 2 }
const GROUP_ORDER = (g: string) => (g === 'yours' ? 0 : g.startsWith('plugin') ? 1 : g === 'built-in' ? 2 : g === 'mcp' ? 3 : 4)

/** The order cards stand in the box: by group, then kind, then name. */
export function boxOrder(a: Card, b: Card): number {
  return GROUP_ORDER(a.group) - GROUP_ORDER(b.group) || a.group.localeCompare(b.group) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)
}

/** Search over name and description, any case; every word of the query must appear. */
export function matches(card: Card, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = `${card.name}\n${card.description}`.toLowerCase()
  return words.every(w => hay.includes(w))
}
