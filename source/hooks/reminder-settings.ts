import { langOf } from './mood'
import type { PresenceSettings } from './presence'
import { validIconRestoreKey } from './icon-book'

// C3 reads these effective values without IO; persistence stays in the batched record.
import { latest } from './latest'
export type ReminderSettings = { guard: boolean; bookmark: boolean; notes: boolean; budget: 'off' | 50 | 80 | 90; neighbours: boolean; appIcon: 'off' | 'on'; dockTile: 'off' | 'on'; longTask: 'off'|'band'|'notify'; trim:boolean; breathe: boolean; stickEnd: 'quiet' | 'sound'; week:boolean }
export function reminderSettings(record: Record<string, unknown> = latest.settings): ReminderSettings {
  const budget = record.budget
  return {
    guard: record.guard !== false && record.guard !== 'off',
    bookmark: record.bookmark !== false && record.bookmark !== 'off',
    notes: record.notes !== false && record.notes !== 'off',
    budget: budget === 50 || budget === 80 || budget === 90 ? budget : 'off',
    neighbours: record.neighbours === true,
    appIcon: record.appIcon === 'on' ? 'on' : 'off',
    dockTile: record.dockTile === 'on' ? 'on' : 'off',
    longTask: record.longTask === 'off' || record.longTask === 'notify' ? record.longTask : 'band',
    trim: record.trim === true || record.trim === 'on',
    breathe: record.breathe !== false && record.breathe !== 'off',
    stickEnd: record.stickEnd === 'sound' ? 'sound' : 'quiet',
    week: record.week !== false && record.week !== 'off',
  }
}

export const LEGACY_SETTING_KEYS = ['lang','heard','band','workSize','voice','affection','bandBeforeOff','marks','companionTarget','neighbours'] as const

// Presence includes malformed new records: callers leave those intact and report the error.
export function legacyMigrationNeeded(record: unknown): boolean { return record === undefined }

// No defaults or IO here. Invalid/absent fields leave the caller's effective defaults alone;
// only actual legacy choices enter the new record, after all reads have settled.
export function normalizeLegacySettings(values: Record<string, unknown>): PresenceSettings {
  const normalized: PresenceSettings = {}
  const choices = {
    band: ['on','compact','off','text'], workSize: ['same','smaller'], voice: ['off','light','full'],
    affection: ['warm','clingy'], bandBeforeOff: ['on','compact','text'], marks: ['on','replies','off'],
    companionTarget: ['auto','claude','vscode'], appIcon: ['off','on'], dockTile: ['off','on'], appIconChoice: ['coco','dake','keycap','ornament'], claudeForm: ['coco','dake','maid','fish'],
  } as const
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    const value = values[key]
    if (typeof value === 'string' && (choices[key] as readonly string[]).includes(value)) normalized[key] = value
  }
  for (const key of ['lang','heard'] as const) {
    const value = values[key], language = langOf(value)
    if (key === 'lang' && value === 'auto') normalized.lang = 'auto'
    else if (language) normalized[key] = language
  }
  if (typeof values.neighbours === 'boolean') normalized.neighbours = values.neighbours
  for (const key of ['appIconBlocked','appIconLegacyChecked'] as const) if (typeof values[key] === 'boolean') normalized[key] = values[key]
  if (values.appIconRestoreNotice === '' || validIconRestoreKey(values.appIconRestoreNotice)) normalized.appIconRestoreNotice = values.appIconRestoreNotice
  return normalized
}
