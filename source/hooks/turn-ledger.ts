// Pure ledger: event adapters live in transcript.tsx because the engine follows $ only
// into local functions. No state, store, clock or rendering API is called from this module.
import type { TurnCompleteInput } from 'claude-code'
import type { HeadState } from '../types'
import { ABSOLUTELY_RIGHT, TIMING } from './mood'

export type HeadAdornment={ribbon?:number;folder?:string}
export type HeadEntry = [string, HeadState['mood'], number, number, number?, string?]
const isRibbon=(value:unknown):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=14
export function headAdornment(entry:HeadEntry):HeadAdornment{return isRibbon(entry[4])?{ribbon:entry[4],...(typeof entry[5]==='string'?{folder:entry[5]}:{})}:{}}
export function headTuple(id:string,head:HeadState):HeadEntry{return isRibbon(head.ribbon)?[id,head.mood,head.endedAt!,head.ms!,head.ribbon,head.folder??'']:[id,head.mood,head.endedAt!,head.ms!]}
export const HEAD_CAP = 600
const CAP = HEAD_CAP
const SETTLED = new Set(['happy', 'flustered', 'error', 'refuse'])
export const HEAD_PREFIX = 'heads:v2:'
export function headKey(at: number, session: string, id: string): string {
  return `${HEAD_PREFIX}${String(Math.max(0, Math.floor(at))).padStart(16, '0')}:${encodeURIComponent(session)}:${encodeURIComponent(id)}`
}
export function headAddress(key: string): { session: string; id: string } | undefined {
  const parts = /^heads:v2:\d{16}:([^:]*):([^:]+)$/.exec(key)
  if (!parts || !Number.isSafeInteger(Number(key.slice(HEAD_PREFIX.length, HEAD_PREFIX.length + 16)))) return
  try { return { session: decodeURIComponent(parts[1]!), id: decodeURIComponent(parts[2]!) } } catch { return }
}
export function headEntry(row: unknown): HeadEntry | undefined {
  if (!Array.isArray(row) || (row.length !== 4 && row.length !== 6) || typeof row[0] !== 'string' || !row[0] ||
      !SETTLED.has(row[1]) || !Number.isFinite(row[2]) || !Number.isFinite(row[3]) || row[3] < 0) return
  if(row.length===6&&(!isRibbon(row[4])||typeof row[5]!=='string'))return
  return row as HeadEntry
}
export class TurnLedger {
  entries: HeadEntry[] = []
  readonly heads = new Map<string, HeadState>()
  readonly seen = new Set<string>()
  newest?: string
  lastActive = 0
  first = true
  turn?: { id: string; head?: string; armed: boolean; arrival: boolean }

  restore(stored: unknown, active: unknown): void {
    const byId = new Map<string, HeadEntry>()
    if (Array.isArray(stored)) for (const row of stored) {
      const entry = headEntry(row)
      if (!entry) continue
      byId.delete(entry[0]); byId.set(entry[0], entry)
    }
    this.entries = Array.from(byId.values()).slice(-CAP)
    this.newest = this.entries.at(-1)?.[0]
    for (const entry of this.entries){const [id,mood,endedAt,ms]=entry;this.heads.set(id,{mood,endedAt,ms,newest:id===this.newest,...headAdornment(entry)})}
    this.lastActive = typeof active === 'number' && Number.isFinite(active) ? active : 0
  }

  start(id: string, now: number): void {
    this.turn = { id, armed: false, arrival: now - this.lastActive >= (this.first ? TIMING.reload : TIMING.back) }
    this.first = false; this.lastActive = now
  }

  arm(id: string): { id: string; head: HeadState } | undefined {
    if (!this.turn || this.turn.armed || this.turn.id !== id) return
    this.turn.armed = true
    const old = this.newest ? this.heads.get(this.newest) : undefined
    const previous = this.newest
    this.newest = undefined
    if (previous && old?.newest) {
      const head = { ...old, newest: false }
      this.heads.set(previous, head)
      return { id: previous, head }
    }
  }

  request(id: string, mood: HeadState['mood'],adornment:HeadAdornment={}): HeadState | undefined {
    let head = this.heads.get(id)
    if (!head && this.turn?.armed && !this.turn.head && !this.seen.has(id)) {
      head = { mood: this.turn.arrival ? 'wave' : mood === 'think' ? 'think' : 'work', newest: true,...(isRibbon(adornment.ribbon)?{ribbon:adornment.ribbon,folder:adornment.folder??''}:{}) }
      this.turn.head = id; this.newest = id; this.heads.set(id, head)
    }
    this.seen.add(id)
    return head
  }

  settle(e: TurnCompleteInput, endedAt: number): { id: string; head: HeadState } | undefined {
    if (e.agentId !== undefined || !this.turn || e.turnId !== this.turn.id) return
    const ended = this.turn
    this.turn = undefined; this.lastActive = endedAt
    if (!ended.head) return
    const mood = e.reason === 'error' ? 'error' : e.reason === 'refusal' ? 'refuse'
      : e.reason === 'aborted' || ABSOLUTELY_RIGHT.test(e.answer) ? 'flustered' : 'happy'
    const head: HeadState = { ...this.heads.get(ended.head),mood, newest: ended.head === this.newest, endedAt, ms: Math.max(0, e.durationMs) }
    this.heads.set(ended.head, head)
    this.entries.push(headTuple(ended.head,head))
    if (this.entries.length > CAP) for (const [id] of this.entries.splice(0, this.entries.length - CAP)) this.heads.delete(id)
    return { id: ended.head, head }
  }
}
