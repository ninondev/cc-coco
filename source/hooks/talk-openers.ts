// Talk opening up on its own (T5, DECISIONS 934; the signals and their order agreed with lane B on 10-16): when the chat
// opens Coco says at most one line, from the group that fits best right now, and after ten quiet minutes with the chat
// open one more. The lines are lane B's (more.talk.open.<group>.<n>); nothing here calls a model.
export const OPENER_ORDER = ['first', 'away', 'calmed', 'refused', 'red', 'green', 'ultrathink', 'bigJob', 'compacted', 'quotaOut', 'quotaLow', 'weekend', 'night', 'morning', 'day'] as const
export type OpenerGroup = typeof OPENER_ORDER[number] | 'quiet'
export type OpenerEvent = 'calmed' | 'refused' | 'red' | 'green' | 'ultrathink' | 'bigJob' | 'compacted'
export type OpenerFacts = {
  now: number
  timeZone?: string
  first: boolean // the chat has never been opened before
  lastActiveAt?: number // the last time they were here, this session or an earlier one
  events: Partial<Record<OpenerEvent, number>> // when each last happened
  quota?: 'low' | 'out'
}
export const OPENER_EVENT_MS = 10 * 60_000 // an event counts for ten minutes
export const OPENER_AWAY_MS = 2 * 3_600_000
export const OPENER_QUIET_MS = 10 * 60_000

// Coco's clock: the hour and whether it is Saturday or Sunday, in the person's time zone.
export function openerClock(now: number, timeZone?: string): { hour: number; weekend: boolean } {
  let hour = new Date(now).getUTCHours(), day = new Date(now).getUTCDay()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(now)
    hour = Number(parts.find(p => p.type === 'hour')?.value ?? hour) % 24
    const weekday = parts.find(p => p.type === 'weekday')?.value
    if (weekday) day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  } catch { /* the UTC clock */ }
  return { hour, weekend: day === 0 || day === 6 }
}

// Every group that holds, in the agreed order; `awayMs` is how long counts as away (the DM thread's is shorter).
export function openerGroups(f: OpenerFacts, awayMs = OPENER_AWAY_MS): Exclude<OpenerGroup, 'quiet'>[] {
  const recent = (event: OpenerEvent) => { const at = f.events[event]; return at !== undefined && f.now - at >= 0 && f.now - at <= OPENER_EVENT_MS }
  const { hour, weekend } = openerClock(f.now, f.timeZone)
  return OPENER_ORDER.filter(group => {
    if (group === 'first') return f.first
    if (group === 'away') return !!f.lastActiveAt && f.now - f.lastActiveAt >= awayMs
    if (group === 'calmed' || group === 'refused' || group === 'red' || group === 'green' || group === 'ultrathink' || group === 'bigJob' || group === 'compacted') return recent(group)
    if (group === 'quotaOut') return f.quota === 'out'
    if (group === 'quotaLow') return f.quota === 'low'
    if (group === 'weekend') return weekend
    if (group === 'night') return hour >= 23 || hour < 5
    if (group === 'morning') return hour >= 5 && hour < 11
    return group === 'day'
  })
}

// The first group that holds, in the agreed order; the time of day always holds, so there is always one.
export function openerGroup(f: OpenerFacts): Exclude<OpenerGroup, 'quiet'> {
  return openerGroups(f)[0] ?? 'day'
}

// One of the group's lines at random, never the one it said last time from that group; undefined while the words are
// not there in any language.
export function openerPick(lines: readonly string[], last: number | undefined, random: () => number = Math.random): number | undefined {
  if (!lines.length) return undefined
  if (lines.length === 1) return 0
  const choices = lines.map((_, i) => i).filter(i => i !== last)
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
}
