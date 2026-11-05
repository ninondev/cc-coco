// The switch behind /coco privacy and the list behind /coco models (owner 11-04). Nothing here
// runs until the person presses. Claude Code offers no setting for these through the plugin API
// (no such row in $.config.list on 2.1.317), so the keys go into the person's own settings.json,
// the same keys the installer's box writes. A press does what it says, whoever wrote the key.
// /coco uninstall takes back only what a press added, which the store remembers, so a key the
// person or the installer set stays. The second tier only matters on another maker's model and
// is written only there (docs/BRAND-SAFETY.md).
import type { EngineInterface } from 'claude-code'
import { moreModelIsClaude, moreModelsDirect } from './more-models'
import { homePath, joinPath } from './paths'

type PrivacyEngine = Pick<EngineInterface, 'env' | 'fs' | 'session' | 'store'>
type Settings = Record<string, unknown>
export type PrivacyState = { quiet: boolean; other: boolean }

const FIRST: Record<string, string> = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', FORCE_AUTOUPDATE_PLUGINS: '1' }
const SECOND: Record<string, string> = { CLAUDE_CODE_ATTRIBUTION_HEADER: '0', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' }
const ATTRIBUTION = { commit: '', pr: '', sessionUrl: false }
const ADDED = 'privacyAdded'
// How the engine reads these switches (2.1.317): one of these words, in any case.
const YES = ['1', 'true', 'yes', 'on'], NO = ['0', 'false', 'no', 'off']

export type ModelService = { name: string; url: string; mainland?: true; where?: 'china' | 'singapore' | 'forward' | 'here' }

// In alphabetical order, with no ranking (owner 11-04). Each address was read on the service's
// own page on 2026-11-04; `where` is only there when its own policy or docs say so.
export const MODEL_SERVICES: readonly ModelService[] = [
  { name: 'Alibaba Cloud Model Studio', url: 'https://dashscope-intl.aliyuncs.com/apps/anthropic' },
  { name: 'Alibaba Cloud Model Studio', mainland: true, url: 'https://dashscope.aliyuncs.com/apps/anthropic' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', where: 'china' },
  { name: 'Kimi', url: 'https://api.moonshot.ai/anthropic', where: 'singapore' },
  { name: 'MiniMax', url: 'https://api.minimax.io/anthropic' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api', where: 'forward' },
  { name: 'Z.ai', url: 'https://api.z.ai/api/anthropic', where: 'singapore' },
  { name: 'llama.cpp', url: 'http://127.0.0.1:8080', where: 'here' },
  { name: 'LM Studio', url: 'http://localhost:1234', where: 'here' },
  { name: 'Ollama', url: 'http://localhost:11434', where: 'here' },
]

const record = (value: unknown): Settings | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Settings : undefined

const tiers = (other: boolean): Record<string, string> => other ? { ...FIRST, ...SECOND } : FIRST

const holds = (have: unknown, want: string): boolean =>
  have !== undefined && (want === '1' ? YES : NO).includes(String(have).toLowerCase().trim())

/** Every key that applies says what the switch says, whoever put it there. */
export function isQuiet(settings: Settings, other: boolean): boolean {
  const env = record(settings.env) ?? {}
  return Object.entries(tiers(other)).every(([key, value]) => holds(env[key], value))
    && (!other || (settings.skipWebFetchPreflight === true && 'attribution' in settings))
}

/** The settings with what is missing or says the opposite put right, or undefined when env is not
 *  an object to add to. An attribution the person wrote stays: that wording is theirs. */
export function quieted(settings: Settings, other: boolean): Settings | undefined {
  if (settings.env !== undefined && !record(settings.env)) return undefined
  const env = { ...record(settings.env) }
  for (const [key, value] of Object.entries(tiers(other))) if (!holds(env[key], value)) env[key] = value
  return {
    ...settings,
    env,
    ...(other && settings.skipWebFetchPreflight !== true ? { skipWebFetchPreflight: true } : {}),
    ...(other && !('attribution' in settings) ? { attribution: { ...ATTRIBUTION } } : {}),
  }
}

const sameAttribution = (value: unknown): boolean => {
  const held = record(value)
  return held !== undefined && Object.keys(held).length === 3 && held.commit === '' && held.pr === '' && held.sessionUrl === false
}

// The keys a press changed, by name, for /coco uninstall to take back later.
const changed = (before: Settings, after: Settings): string[] => {
  const was = record(before.env) ?? {}, now = record(after.env) ?? {}
  return [...Object.keys(now).filter(key => now[key] !== was[key]), ...['skipWebFetchPreflight', 'attribution'].filter(key => after[key] !== before[key])]
}

/** The settings without this file's keys, or only the ones named. The website-check key stays on someone else's service, where it may be needed. */
export function unquieted(settings: Settings, only?: readonly string[]): Settings {
  const mine = (key: string) => !only || only.includes(key)
  const next = { ...settings }, env = record(settings.env)
  const left = env ? { ...env } : undefined
  if (left) {
    for (const [key, value] of Object.entries({ ...FIRST, ...SECOND })) if (mine(key) && holds(left[key], value)) delete left[key]
    if (Object.keys(left).length) next.env = left
    else delete next.env
  }
  if (mine('skipWebFetchPreflight') && next.skipWebFetchPreflight === true && !left?.ANTHROPIC_BASE_URL) delete next.skipWebFetchPreflight
  if (mine('attribution') && sameAttribution(next.attribution)) delete next.attribution
  return next
}

async function settingsFile($: PrivacyEngine): Promise<string | undefined> {
  const folder = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  if (folder) return joinPath(folder, 'settings.json')
  const home = await $.env.get('HOME').catch(() => undefined)
  const base = homePath(home, home ? undefined : await $.env.get('USERPROFILE').catch(() => undefined))
  return base ? joinPath(base, '.claude', 'settings.json') : undefined
}

// Undefined when the file cannot be read as an object, and nothing is written then.
async function readSettings($: PrivacyEngine, file: string): Promise<Settings | undefined> {
  try {
    if (!await $.fs.exists(file)) return {}
    const text = (await $.fs.read(file)).replace(/^﻿/, '')
    return text.trim() ? record(JSON.parse(text)) : {}
  } catch { return undefined }
}

async function onOtherModel($: PrivacyEngine, settings: Settings): Promise<boolean> {
  const set = record(settings.env)?.ANTHROPIC_BASE_URL
  const base = typeof set === 'string' ? set : await $.env.get('ANTHROPIC_BASE_URL').catch(() => undefined)
  if (moreModelsDirect(base ?? undefined)) return false
  const model = await $.session.model().catch(() => undefined)
  return !model || !moreModelIsClaude(model)
}

export async function readPrivacy($: PrivacyEngine): Promise<PrivacyState | undefined> {
  const file = await settingsFile($), settings = file ? await readSettings($, file) : undefined
  if (!settings) return undefined
  const other = await onOtherModel($, settings)
  return { quiet: isQuiet(settings, other), other }
}

async function write($: PrivacyEngine, file: string, settings: Settings): Promise<boolean> {
  try { await $.fs.write(file, `${JSON.stringify(settings, null, 2)}\n`); return true } catch { return false }
}

async function added($: PrivacyEngine): Promise<string[]> {
  try {
    const held = await $.store.get(ADDED) as unknown
    return Array.isArray(held) ? held.filter((key): key is string => typeof key === 'string') : []
  } catch { return [] }
}

export async function setPrivacy($: PrivacyEngine, quiet: boolean): Promise<boolean> {
  const file = await settingsFile($), seen = file ? await readSettings($, file) : undefined
  if (!file || !seen) return false
  const other = quiet && await onOtherModel($, seen)
  // Read again after that wait, so a save Claude Code made meanwhile is not lost.
  const settings = await readSettings($, file)
  const next = settings && (quiet ? quieted(settings, other) : unquieted(settings))
  if (!settings || !next) return false
  if (JSON.stringify(next) !== JSON.stringify(settings) && !await write($, file, next)) return false
  if (quiet) await $.store.set(ADDED, [...new Set([...await added($), ...changed(settings, next)])] as never).catch(() => undefined)
  else await $.store.delete(ADDED).catch(() => undefined)
  return true
}

/** The uninstaller's step, which takes back only what a press added: 'same' when that is nothing. */
export async function restorePrivacy($: PrivacyEngine): Promise<'done' | 'same' | 'failed'> {
  const keys = await added($)
  if (!keys.length) return 'same'
  const file = await settingsFile($), settings = file ? await readSettings($, file) : undefined
  if (!file || !settings) return 'failed'
  const next = unquieted(settings, keys), same = JSON.stringify(next) === JSON.stringify(settings)
  if (!same && !await write($, file, next)) return 'failed'
  await $.store.delete(ADDED).catch(() => undefined)
  return same ? 'same' : 'done'
}
