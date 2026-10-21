// The DM thread's own rules (owner's cards, 10-17 late): Talk is a standing DM thread between the person and Coco, one
// thread in the plugin and on the pet. While it is closed she may write first when something real happened, from her
// line library by default or written by the model once the person turns that on; what they have not seen is counted,
// and a notification goes out unless they turned notifications off or she is asleep (the pet also holds it while the
// screen is locked). Nothing here calls a model or reads the clock: the runtime passes the time in.
import { openerGroups } from './talk-openers'
import type { OpenerFacts, OpenerGroup } from './talk-openers'
import { moreDay } from './more-state'

/** The moments worth a message of her own: a reason a friend would text. The clock's own (up late, morning, a weekend)
 *  count only while the person is at it, since she is asked only at their prompt, a turn's end or a session's start. */
export const DM_MOMENTS: readonly OpenerGroup[] = ['away', 'calmed', 'green', 'bigJob', 'compacted', 'quotaOut', 'quotaLow', 'night', 'morning', 'weekend']
const DM_CLOCK: readonly OpenerGroup[] = ['night', 'morning', 'weekend']
/** Away this long, coming back is a moment («you back?»). */
export const DM_BACK_MS = 30 * 60_000
/** Between two of her unprompted messages. */
export const DM_GAP_MS = 45 * 60_000
/** The same kind of moment once in this long; the clock's own once a day. */
export const DM_MOMENT_MS = 6 * 3_600_000
export const DM_CLOCK_MS = 20 * 3_600_000
/** Her unprompted messages in a local day, from her lines or written by the model. */
export const DM_DAY_CAP = 6
/** Unanswered this many times, she waits until the person writes. */
export const DM_UNANSWERED_CAP = 2
/** A notification shows this much of the message. */
export const DM_PREVIEW = 120

// What happened, for the model when the person lets it write her first messages: plain facts in English, as the chat's
// context line is (talk-parts.ts); how she writes about it is lane B's instruction (more.model.talk.first).
const DM_MOMENT_FACTS: Partial<Record<OpenerGroup, string>> = {
  away: 'They just came back after being away.',
  calmed: 'Things just calmed down after a rough stretch.',
  green: 'The tests just went green.',
  bigJob: 'A long job just finished.',
  compacted: 'The conversation with Claude was just compacted.',
  quotaOut: 'Their usage limit has run out for now.',
  quotaLow: 'Their usage limit is running low.',
  night: 'It is late at night where they are.',
  morning: 'It is morning where they are.',
  weekend: 'It is the weekend where they are.',
}
export function dmMomentLine(moment: OpenerGroup): string { return DM_MOMENT_FACTS[moment] ?? '' }

export type DmFirst = 'lines' | 'model'
export type DmState = {
  /** Her messages the person has not seen. */
  unread: number
  /** The local day the counts are for. */
  day: string
  /** Her unprompted messages that day. */
  written: number
  /** When she last wrote first. */
  lastAt?: number
  /** Her unprompted messages since the person last wrote. */
  unanswered: number
  /** When each kind of moment last made her write. */
  moments: Partial<Record<OpenerGroup, number>>
  /** Where her first messages come from. */
  first: DmFirst
  /** Notifications on (the default) or off. */
  notify: boolean
}

export function dmInitial(): DmState {
  return { unread: 0, day: '', written: 0, unanswered: 0, moments: {}, first: 'lines', notify: true }
}

/** A stored state, every field checked; anything else starts fresh. */
export function dmState(value: unknown): DmState {
  const fresh = dmInitial()
  if (!value || typeof value !== 'object') return fresh
  const v = value as Record<string, unknown>
  const count = (n: unknown, cap: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, cap) : 0
  const time = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
  const moments: DmState['moments'] = {}
  if (v.moments && typeof v.moments === 'object') {
    for (const [group, at] of Object.entries(v.moments as Record<string, unknown>)) {
      if ((DM_MOMENTS as readonly string[]).includes(group) && time(at) !== undefined) moments[group as OpenerGroup] = time(at)
    }
  }
  const lastAt = time(v.lastAt)
  return {
    unread: count(v.unread, 999),
    day: typeof v.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.day) ? v.day : '',
    written: count(v.written, DM_DAY_CAP),
    ...(lastAt === undefined ? {} : { lastAt }),
    unanswered: count(v.unanswered, DM_UNANSWERED_CAP),
    moments,
    first: v.first === 'model' ? 'model' : 'lines',
    notify: v.notify !== false,
  }
}

/** The moment she would write about now, if every rule lets her: the first of DM_MOMENTS that holds, in the openers'
 *  order, and has not made her write in the last six hours (a day for the clock's own), at least 45 minutes after her
 *  last one, under the day's cap, and with fewer than two of hers unanswered. Without `lastActiveAt` nobody came back. */
export function dmMoment(state: DmState, facts: OpenerFacts): OpenerGroup | undefined {
  const now = facts.now
  const written = state.day === moreDay(now) ? state.written : 0
  const within = (at: number | undefined, ms: number) => at !== undefined && now - at >= 0 && now - at < ms
  if (written >= DM_DAY_CAP || state.unanswered >= DM_UNANSWERED_CAP || within(state.lastAt, DM_GAP_MS)) return undefined
  return openerGroups(facts, DM_BACK_MS).find(group => DM_MOMENTS.includes(group) &&
    !within(state.moments[group], DM_CLOCK.includes(group) ? DM_CLOCK_MS : DM_MOMENT_MS))
}

/** She wrote first about `group`: `n` messages, all unseen. */
export function dmWrote(state: DmState, group: OpenerGroup, now: number, n: number): DmState {
  const day = moreDay(now)
  return {
    ...state, day, written: (state.day === day ? state.written : 0) + 1, lastAt: now,
    unanswered: Math.min(DM_UNANSWERED_CAP, state.unanswered + 1), moments: { ...state.moments, [group]: now },
    unread: Math.min(999, state.unread + n),
  }
}

/** `n` of her messages arrived while the thread was closed. */
export function dmArrived(state: DmState, n: number): DmState {
  return n > 0 ? { ...state, unread: Math.min(999, state.unread + n) } : state
}

/** The person wrote: she may write first again. */
export function dmAnswered(state: DmState): DmState {
  return state.unanswered ? { ...state, unanswered: 0 } : state
}

/** The thread is open: everything in it is seen. */
export function dmSeen(state: DmState): DmState {
  return state.unread ? { ...state, unread: 0 } : state
}

/** What a notification shows of a message: one line, whole words where it is cut. */
export function dmPreview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const chars = [...line]
  if (chars.length <= DM_PREVIEW) return line
  const cut = chars.slice(0, DM_PREVIEW - 1).join('')
  const space = cut.lastIndexOf(' ')
  return (space > DM_PREVIEW / 2 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

// A first message sent while the thread is closed reads as a message: a leading stage direction in brackets, as
// «(呆毛立正)…», is left off in the thread and in the notice (his card of 10-17 late, via lane B). Said live in an open
// thread or on the band, the same line keeps it.
export function dmSpoken(text: string): string {
  const spoken = text.replace(/^\s*[(（][^()（）\n]{1,40}[)）]\s*/u, '')
  return spoken.trim() ? spoken : text
}
