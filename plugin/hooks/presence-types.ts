import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import type { Lang } from './words'
import type { VisitDue, VisitState } from './visitors'

export type PresenceEvent = { kind: string; id: string; at: number; lang?: Lang }
export type PresenceTouch = 'poke' | 'pat' | 'burst' | 'hug' | 'drag'
export type PresenceTouchEvent = PresenceEvent & { kind: 'touch'; by: 'band' | 'companion'; touch: PresenceTouch; session?: string; lang: Lang }
export type PresenceSetting = null | boolean | number | string | PresenceSetting[] | { [key: string]: PresenceSetting }
export type PresenceSettings = Record<string, PresenceSetting>
export type PresenceSettingsEvent = PresenceEvent & { kind: 'settings'; changes: PresenceSettings }
export type PresenceMutation = { touch?: PresenceTouchEvent; settings?: PresenceSettings; at?: number; initial?: boolean; settingsId?: string; activityBusy?: boolean; companionExited?: {pid:number;birth:string} }
export type PresenceNeighbourWindow = { usedPercent?: number; windowMinutes?: number; resetsAt?: number }
export type PresenceNeighbour = { id: string; label: string; busy: boolean; partial: boolean; startedAt?: number; quota?: { primary?: PresenceNeighbourWindow; secondary?: PresenceNeighbourWindow } }
export type PresenceNeighbours = { owner?: {pid:number;birth:string}; v: 1; running: boolean; agents: PresenceNeighbour[] }
export type PresenceSnapshot = {
  neighbours?: PresenceNeighbours
  sessions?: {session:string;cwd:string;ribbon?:number;ribbonAt?:number}[]
  v: 1; seq: number; quietAt: number; asleep: boolean; clingy: boolean; busy: boolean
  lang?: Lang; event: PresenceEvent; sleepEvent?: PresenceEvent; wakeEvent?: PresenceEvent; clingyEvent?: PresenceEvent
  touchEvent?: PresenceTouchEvent; settings?: PresenceSettings; settingsEvent?: PresenceSettingsEvent
  visitors?: VisitState
}
export type PresenceIO = {
  read: (path: string) => Promise<string>
  write?: (path: string, text: string) => Promise<void>
  run?: (argv: string[]) => Promise<{ stdout: string; code: number | null }>
  spawn: (argv: string[]) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  now: () => Promise<number>
  after: (ms: number, callback: () => void) => (() => void)
}
export type Callbacks = { changed: (state: PresenceSnapshot) => Promise<void> | void; error?: (error: unknown) => void; ended?: () => Promise<void> | void }
export type Deadlines = { sleepAfter: number | ((quietAt: number) => number); clingyAfter: number; enabled?: () => boolean }
export type PresenceMetadata = { cwd?: string; version?: string; ribbon?:number; ribbonAt?:number; visitorDue?: VisitDue; lastPromptAt?: number }
// busy and busySince: whether that window is working, and since when (E1-2, their windows on the bag's first page).
export type PresenceSession = { session: string; cwd: string; version: string; open: true; lastPromptAt?: number; busy?: boolean; busySince?: number }
export type PresenceClaim = PresenceMetadata & { session: string; owner: string; pid: number; birth: string; busy: boolean; busySince?: number; uid?: number; executable?: string; hostPid?: number; hostBirth?: string }
export type PresenceRecord = PresenceSnapshot & { claims: Record<string, PresenceClaim> }
export type ProcessIdentity = { birth: string; parent: number; uid: number; executable: string; registeredOwner?: string }
