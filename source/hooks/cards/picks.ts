// The tray: cards picked for the next message only. Skills and subagents travel as one hidden block the model reads
// beside the message (prompt.submit's `context`, measured to reach the model); the tray empties once that message
// has entered. A command cannot ride along that way (the model cannot run the person's slash commands), so a command
// card is not put in the tray: its button writes `/name ` into the prompt instead (see cards.tsx).
import type { Card } from './model'

export function pickBlock(cards: readonly Card[]): string | null {
  const skills = cards.filter(c => c.kind === 'skill')
  const agents = cards.filter(c => c.kind === 'agent')
  if (skills.length === 0 && agents.length === 0) return null
  const lines = ['[Coco skill cards] The user picked these cards for this message only:']
  for (const c of skills) lines.push(`- Skill "${c.name}": load it with the Skill tool and follow it for this message.`)
  for (const c of agents) lines.push(`- Subagent type "${c.name}": hand it the part of this task it is for, with the Agent tool (subagent_type "${c.name}").`)
  lines.push('For each card, either use it as above or say in one line why it does not fit this message. Never pass over a card without a word.')
  return lines.join('\n')
}

/** Toggles a card in the tray; commands never enter it. */
export function toggle(tray: readonly string[], card: Card): string[] {
  if (card.kind === 'command') return [...tray]
  return tray.includes(card.id) ? tray.filter(id => id !== card.id) : [...tray, card.id]
}
