// The models Talk and the second look may run on (owner 10-17: 「允许其选择模型」; then 「如果用户使用cc-switch，那么选择范围
// 应该基于其自己接入了哪些，聊天功能亦然」 and 「如果是无cc-switch的就默认最新haiku，其它可选；如果是有cc-switch的就彻彻底底
// 自选，无默认」; Explain on Talk's pick, 「跟聊天用同一个选择」). Only what Claude Code itself is set to reach is offered. cc-switch and tools like it write Claude Code's
// own variables (the base URL, a pinned model per family and its display name), and those are all this reads: no other
// program's files, and never a key. On a connection of the person's own, a row with no pick follows the model this
// conversation runs on (owner 11-04, the card 「全做」), which replaces 「无默认」 of 10-17; Claude's own service keeps Haiku.
import type { MoreModelChoice, MoreModelRow, MoreModels } from './more-state'

export const MORE_MODEL_FAMILIES = ['haiku', 'sonnet', 'opus'] as const
export type MoreModelFamily = typeof MORE_MODEL_FAMILIES[number]
const FAMILY_LABEL: Record<MoreModelFamily, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }
// Claude Code's settings that are not a model of their own.
const NOT_A_MODEL = new Set(['default', 'opusplan', 'best', 'fable', 'inherit'])

/** Claude Code's model variables as read at session start. */
export type MoreModelEnv = {
  base?: string
  // ANTHROPIC_DEFAULT_<FAMILY>_MODEL and its _NAME; ANTHROPIC_SMALL_FAST_MODEL is Haiku's older name
  pinned?: Partial<Record<MoreModelFamily, string>>
  names?: Partial<Record<MoreModelFamily, string>>
  smallFast?: string
  // ANTHROPIC_MODEL, and ANTHROPIC_CUSTOM_MODEL_OPTION with its _NAME
  main?: string
  custom?: string
  customName?: string
  // What the conversation runs on now, as /model shows it: $.session.model(). The app's own connection to another
  // model may not show in the variables above, so this decides as well.
  current?: string
}

/** No base URL, or Anthropic's own: Claude's families are there. Anything else is the person's own connection. */
export function moreModelsDirect(base: string | undefined): boolean {
  const value = base?.trim()
  if (!value) return true
  try { return new URL(value).hostname.toLowerCase() === 'api.anthropic.com' } catch { return false }
}

/** A model of Claude's by its name: an alias, or an id as Anthropic, Bedrock or Vertex writes it. */
export function moreModelIsClaude(id: string): boolean {
  return /^(haiku|sonnet|opus|fable)(\[1m\])?$|(^|[./:])claude[-.]/i.test(id.trim())
}

const modelId = (value: string | undefined): string | undefined => {
  const id = value?.trim()
  return id && id.length <= 200 && /^[\x21-\x7e]+$/.test(id) && !NOT_A_MODEL.has(id.toLowerCase()) ? id : undefined
}
const shownId = (id: string): string => id.replace(/\[1m\]$/i, '')
// A display name the person set; control characters out, kept short enough for a button.
const shownName = (name: string | undefined): string | undefined => {
  const text = name?.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text ? text.slice(0, 60) : undefined
}

/** Claude's own service: Anthropic's address, and not a conversation already running on someone else's model. */
function claudeService(env: MoreModelEnv): boolean {
  const current = modelId(env.current)
  return moreModelsDirect(env.base) && (!current || moreModelIsClaude(current))
}

function modelList(env: MoreModelEnv): { choices: MoreModelChoice[]; current?: string } {
  const direct = claudeService(env), choices: MoreModelChoice[] = [], seen = new Map<string, string>()
  const add = (value: string, id: string, label: string) => {
    const key = shownId(id).toLowerCase()
    if (!seen.has(key)) { seen.set(key, value); choices.push({ value, label }) }
    return seen.get(key)!
  }
  const pinOf = (family: MoreModelFamily) => modelId(env.pinned?.[family] ?? (family === 'haiku' ? env.smallFast : undefined))
  // A family goes by its alias, which Claude Code turns into the model pinned for it, so it always reaches what the
  // person connected. Elsewhere an unpinned family would send a Claude model's name to a service that may not serve it.
  for (const family of MORE_MODEL_FAMILIES) {
    const pin = pinOf(family)
    if (pin) add(family, pin, shownName(env.names?.[family]) ?? shownId(pin))
    else if (direct) add(family, family, FAMILY_LABEL[family])
  }
  const custom = modelId(env.custom)
  if (custom) add(custom, custom, shownName(env.customName) ?? shownId(custom))
  // ANTHROPIC_MODEL may name a family: its pin is listed already, else the session reaches it as it is.
  const running = (value: string | undefined) => {
    const id = direct ? undefined : modelId(value)
    if (!id) return undefined
    const family = MORE_MODEL_FAMILIES.find(f => f === id.toLowerCase())
    if (!family) return add(id, id, shownId(id))
    return pinOf(family) ? family : add(family, family, FAMILY_LABEL[family])
  }
  running(env.main)
  const current = running(env.current)
  return current ? { choices, current } : { choices }
}

export function moreModelChoices(env: MoreModelEnv): MoreModelChoice[] { return modelList(env).choices }

export function moreModels(env: MoreModelEnv): MoreModels {
  const { choices, current } = modelList(env)
  return { choices, own: !claudeService(env), ...(current ? { current } : {}) }
}

/** The model a row runs on: the person's pick while it is still offered; with Claude's own service the newest Haiku
 * (the alias) until they pick; on their own connection the model of the conversation. */
export function moreModelFor(models: MoreModels | undefined, row: MoreModelRow): string | undefined {
  if (!models) return 'haiku'
  const pick = models.picks?.[row]
  if (pick && models.choices.some(choice => choice.value === pick)) return pick
  return models.own ? models.current : models.choices.find(choice => choice.value === 'haiku')?.value ?? models.choices[0]?.value
}

/** The name for words that say who does the work: the model of the conversation, when it is not Claude's own service. */
export function moreWorkerName(models: MoreModels): string | undefined {
  if (!models.own || !models.current) return undefined
  return models.choices.find(choice => choice.value === models.current)?.label ?? shownId(models.current)
}
