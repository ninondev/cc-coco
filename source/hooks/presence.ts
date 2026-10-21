import type { PresenceEvent, PresenceTouch, PresenceTouchEvent, PresenceSetting, PresenceSettings, PresenceSettingsEvent, PresenceMutation, PresenceNeighbourWindow, PresenceNeighbour, PresenceNeighbours, PresenceSnapshot, PresenceIO, Callbacks, Deadlines, PresenceMetadata, PresenceSession, PresenceClaim, PresenceRecord, ProcessIdentity } from './presence-types'
export type { PresenceEvent, PresenceTouch, PresenceTouchEvent, PresenceSetting, PresenceSettings, PresenceSettingsEvent, PresenceMutation, PresenceNeighbourWindow, PresenceNeighbour, PresenceNeighbours, PresenceSnapshot, PresenceIO, PresenceMetadata, PresenceSession, PresenceClaim, PresenceRecord, ProcessIdentity } from './presence-types'
import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import { joinPath, windowsPath } from './d1-paths.js'
import { LANGS, type Lang } from './words'
import { sleepAfter } from './sleep'
import { untrustedDisplaySlot } from './display-slots'
import { newerDue, parseVisitState, visitAtSleep, visitAtWake } from './visitors'
function sleepDelay(deadlines: Deadlines, quietAt: number): number {
  return typeof deadlines.sleepAfter === 'function' ? deadlines.sleepAfter(quietAt) : deadlines.sleepAfter
}
const MAX_LINE = 256 * 1024

// His own settings, shared between his sessions and kept in his record, plus the theme, reduced motion, time zone and
// Coco's outfit the pet and the other sessions follow.
export const COCO_SETTING_KEYS: ReadonlySet<string> = new Set([
  'band', 'bandBeforeOff', 'workSize', 'voice', 'voiceChosen', 'affection', 'lang', 'language', 'heard', 'marks', 'companionTarget',
  'neighbours', 'guard', 'bookmark', 'notes', 'budget', 'appIcon', 'dockTile', 'appIconChoice', 'appIconBlocked', 'appIconLegacyChecked',
  'appIconRestoreNotice', 'longTask', 'trim', 'breathe', 'stickEnd', 'week', 'visitors', 'waitSound', 'socks', 'socksMode', 'socksEarned',
  'claudeForm', 'bagStyle', 'stick', 'more', 'theme', 'prefersReducedMotion', 'timeZone', 'outfit',
])
// Claude Code's own settings, which went into the shared record whole until 10-18 (env can hold secrets, and they
// grew his record past its size limit). Records and snapshots lose them on their next read; a key a newer Coco adds stays.
export const ENGINE_SETTING_KEYS: ReadonlySet<string> = new Set([
  'env', 'permissions', 'hooks', 'model', 'modelSettings', 'enabledPlugins', 'extraKnownMarketplaces', 'pluginConfigs', 'skillOverrides',
  'deniedMcpServers', 'allowedMcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'enableAllProjectMcpServers', 'autoMode',
  'effortLevel', 'fastMode', 'ultracode', 'promptSuggestionEnabled', 'skipWorkflowUsageWarning', 'switchModelsOnFlag', 'apiKeyHelper',
  'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper', 'statusLine', 'outputStyle', 'includeCoAuthoredBy', 'attribution',
  'cleanupPeriodDays', 'forceLoginMethod', 'forceLoginOrgUUID', 'disableAllHooks', 'sandbox', 'alwaysThinkingEnabled', 'companyAnnouncements',
  'spinnerTipsEnabled', 'feedbackSurveyRate',
])
export function cocoSettings(values: Readonly<Record<string, unknown>> | undefined, engine: Readonly<Record<string, unknown>> = {}): PresenceSettings {
  const kept: PresenceSettings = {}
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === undefined || (!COCO_SETTING_KEYS.has(key) && (ENGINE_SETTING_KEYS.has(key) || Object.prototype.hasOwnProperty.call(engine, key)))) continue
    kept[key] = value as PresenceSetting
  }
  return kept
}
function validSettings(value: unknown, depth = 0): value is PresenceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 16) return false
  return Object.entries(value).every(([key, item]) => key.length <= 256 && validSetting(item, depth + 1))
}
function validSetting(value: unknown, depth: number): value is PresenceSetting {
  if (depth > 16) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return Array.isArray(value) ? value.every(item => validSetting(item, depth + 1)) : validSettings(value, depth)
}
function validEvent(value: unknown): value is PresenceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  if (typeof event.kind !== 'string' || !['initial', 'activity', 'expired', 'sleep', 'wake', 'clingy', 'touch', 'settings'].includes(event.kind)
      || (event.lang !== undefined && !LANGS.some(language => language.code === event.lang))
      || typeof event.id !== 'string' || event.id.length > 96
      || typeof event.at !== 'number' || !Number.isFinite(event.at) || event.at < 0 || event.at > 8.64e15) return false
  if (event.kind === 'touch') return (event.by === 'band' || event.by === 'companion')
    && event.id === `touch:${event.by}:${event.at}` && event.lang !== undefined
    && typeof event.touch === 'string' && ['poke', 'pat', 'burst', 'hug', 'drag'].includes(event.touch)
    && (event.session === undefined || typeof event.session === 'string' && event.session.length <= 256)
  if (!/^[a-z]+:\d+:\d+$/.test(event.id)) return false
  return event.kind !== 'settings' || validSettings(event.changes)
}
/** Allowlisted, bounded numbers and status only; record content can never reach UI. */
export function parseNeighbours(value: unknown): PresenceNeighbours | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.v !== 1 || typeof input.running !== 'boolean' || !Array.isArray(input.agents) || input.agents.length > 32) return undefined
  const agents: PresenceNeighbour[] = []
  const ids = new Set<string>()
  for (const row of input.agents) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined
    const a = row as Record<string, unknown>
    if (typeof a.id !== 'string' || !a.id || a.id.length > 64 || ids.has(a.id) || typeof a.label !== 'string' || a.label.length > 128
      || typeof a.busy !== 'boolean' || typeof a.partial !== 'boolean') return undefined
    ids.add(a.id)
    const agent: PresenceNeighbour = {id:a.id,label:untrustedDisplaySlot(a.label),busy:a.busy,partial:a.partial}
    if (typeof a.startedAt === 'number' && Number.isFinite(a.startedAt) && a.startedAt >= 0 && a.startedAt <= 8.64e15) agent.startedAt = a.startedAt
    if (a.quota && typeof a.quota === 'object' && !Array.isArray(a.quota)) {
      const quota: NonNullable<PresenceNeighbour['quota']> = {}
      for (const key of ['primary','secondary'] as const) {
        const raw = (a.quota as Record<string, unknown>)[key]
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const window: PresenceNeighbourWindow = {}
        for (const field of ['usedPercent','windowMinutes','resetsAt'] as const) {
          const n = (raw as Record<string, unknown>)[field]
          if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && (field !== 'usedPercent' || n <= 100)) window[field] = n
        }
        if (window.usedPercent !== undefined) quota[key] = window
      }
      if (quota.primary || quota.secondary) agent.quota = quota
    }
    agents.push(agent)
  }
  const owner = input.owner as Record<string,unknown> | undefined
  const identity = owner && Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0 && typeof owner.birth === 'string' && /^darwin:\d+:\d+$/.test(owner.birth) && owner.birth.length < 128 ? {pid:owner.pid as number,birth:owner.birth} : undefined
  if (input.owner !== undefined && !identity) return undefined
  return {v:1,running:input.running,agents,...(identity ? {owner:identity} : {})}
}

export function parsePresence(text: string): PresenceSnapshot | undefined {
  if (text.length > MAX_LINE) return undefined
  let input: unknown
  try { input = JSON.parse(text) } catch { return undefined }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (value.v !== 1 || !Number.isSafeInteger(value.seq) || (value.seq as number) < 0
      || typeof value.quietAt !== 'number' || !Number.isFinite(value.quietAt) || value.quietAt < 0 || value.quietAt > 8.64e15
      || typeof value.asleep !== 'boolean' || typeof value.clingy !== 'boolean' || typeof value.busy !== 'boolean'
      || !validEvent(value.event)) return undefined
  if (value.lang !== undefined && !LANGS.some(language => language.code === value.lang)) return undefined
  for (const key of ['sleepEvent', 'wakeEvent', 'clingyEvent', 'touchEvent', 'settingsEvent']) if (value[key] !== undefined && !validEvent(value[key])) return undefined
  if (value.touchEvent !== undefined && (value.touchEvent as PresenceEvent).kind !== 'touch') return undefined
  if (value.settingsEvent !== undefined && (value.settingsEvent as PresenceEvent).kind !== 'settings') return undefined
  if (value.settings !== undefined && !validSettings(value.settings)) return undefined
  const neighbours = parseNeighbours(value.neighbours)
  const visitors = parseVisitState(value.visitors)
  const sessions=value.claims&&typeof value.claims==='object'&&!Array.isArray(value.claims)?Object.values(value.claims as Record<string,PresenceClaim>).filter(c=>c&&typeof c.session==='string'&&c.session.length<=256&&typeof c.cwd==='string'&&c.cwd.length<=4096).slice(0,1024).map(c=>({session:c.session,cwd:c.cwd!,...(Number.isInteger(c.ribbon)&&c.ribbon!>=1&&c.ribbon!<=14?{ribbon:c.ribbon}:{}),...(typeof c.ribbonAt==='number'&&Number.isFinite(c.ribbonAt)?{ribbonAt:c.ribbonAt}:{})})):undefined
  // Process identities stay private to the transport; drawing receives only presence.
  return { v: 1, seq: value.seq as number, quietAt: value.quietAt, asleep: value.asleep, clingy: value.clingy, busy: value.busy,
    lang: value.lang as Lang | undefined, event: value.event, sleepEvent: value.sleepEvent as PresenceEvent | undefined,
    wakeEvent: value.wakeEvent as PresenceEvent | undefined, clingyEvent: value.clingyEvent as PresenceEvent | undefined,
    touchEvent: value.touchEvent as PresenceTouchEvent | undefined, settings: value.settings === undefined ? undefined : cocoSettings(value.settings as PresenceSettings),
    settingsEvent: value.settingsEvent === undefined ? undefined
      : { ...value.settingsEvent as PresenceSettingsEvent, changes: cocoSettings((value.settingsEvent as PresenceSettingsEvent).changes) },
    ...(neighbours ? { neighbours } : {}),...(sessions?{sessions}:{}),...(visitors?{visitors}:{}) }
}

export function parsePresenceRecord(text: string): PresenceRecord | undefined {
  const snapshot = parsePresence(text)
  if (!snapshot) return undefined
  const input = JSON.parse(text) as { claims?: unknown }
  if (!input.claims || typeof input.claims !== 'object' || Array.isArray(input.claims)) return undefined
  const claims = input.claims as Record<string, PresenceClaim>
  if (Object.keys(claims).length > 1024) return undefined
  for (const [key, claim] of Object.entries(claims)) {
    if (key.length > 256 || !claim || typeof claim !== 'object' || !Number.isSafeInteger(claim.pid) || claim.pid < 1
        || typeof claim.birth !== 'string' || claim.birth.length > 128 || typeof claim.session !== 'string' || claim.session.length > 256
        || typeof claim.owner !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(claim.owner) || typeof claim.busy !== 'boolean'
        || (claim.uid !== undefined && (!Number.isSafeInteger(claim.uid) || claim.uid < 0))
        || (claim.executable !== undefined && (typeof claim.executable !== 'string' || claim.executable.length > 4096 || !absoluteProgram(claim.executable) || /[\t\r\n]/.test(claim.executable)))
        || (claim.hostPid !== undefined && (!Number.isSafeInteger(claim.hostPid) || claim.hostPid < 1))
        || (claim.busySince !== undefined && (typeof claim.busySince !== 'number' || !Number.isFinite(claim.busySince) || claim.busySince < 0 || claim.busySince > 8.64e15))
        || (claim.hostBirth !== undefined && (typeof claim.hostBirth !== 'string' || claim.hostBirth.length > 128))
        || (claim.cwd !== undefined && (typeof claim.cwd !== 'string' || claim.cwd.length > 4096))
        || (claim.ribbon !== undefined && (!Number.isInteger(claim.ribbon)||claim.ribbon<1||claim.ribbon>14))
        || (claim.ribbonAt !== undefined && (typeof claim.ribbonAt!=='number'||!Number.isFinite(claim.ribbonAt)||claim.ribbonAt<0))
        || (claim.version !== undefined && (typeof claim.version !== 'string' || claim.version.length > 64))
        || (claim.lastPromptAt !== undefined && (!Number.isFinite(claim.lastPromptAt) || claim.lastPromptAt < 0))) return undefined
  }
  return { ...snapshot, claims }
}

/** A program path as an inventory records it: POSIX, or a Windows drive or network path (the pet program's helper). */
function absoluteProgram(path: string): boolean { return path.startsWith('/') || windowsPath(path) }

export function parseProcessInventory(text: string): Map<number, ProcessIdentity> {
  const identities = new Map<number, ProcessIdentity>()
  if (text.length > MAX_LINE * 2) return identities
  for (const line of text.split('\n').slice(0, 2048)) {
    const row = line.match(/^PID\t(\d+)\t(\d+)\t(linux:[A-Za-z0-9-]+:\d+|darwin:\d+:\d+|windows:\d+)\t(\d+)\t([^\t\r\n]{1,4096})\t([A-Za-z0-9_-]{0,64})$/)
    if (!row) continue
    const pid = Number(row[1]), parent = Number(row[2]), uid = Number(row[4])
    if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(parent) || !Number.isSafeInteger(uid) || uid < 0 || !absoluteProgram(row[5]!)) continue
    identities.set(pid, { parent, birth: row[3]!, uid, executable: row[5]!, ...(row[6] ? { registeredOwner: row[6] } : {}) })
  }
  return identities
}

function claimAlive(claim: PresenceClaim, alive: ReadonlyMap<number, ProcessIdentity>): boolean {
  const reader = alive.get(claim.pid)
  if (!reader || reader.birth !== claim.birth || reader.registeredOwner !== claim.owner
      || reader.uid !== claim.uid || reader.executable !== claim.executable) return false
  if (claim.hostPid !== undefined) {
    const host = alive.get(claim.hostPid)
    if (!host || host.birth !== claim.hostBirth || host.uid !== reader.uid || reader.parent !== claim.hostPid) return false
  }
  return true
}

/** Only the follower generation and its owning host establish an open session. */
export function presenceSessions(record: PresenceRecord, alive: ReadonlyMap<number, ProcessIdentity>): PresenceSession[] {
  return Object.values(record.claims).filter(claim => claimAlive(claim, alive)
    && typeof claim.cwd === 'string' && typeof claim.version === 'string')
    .map(claim => ({ session: claim.session, cwd: claim.cwd!, version: claim.version!, open: true, ...(claim.lastPromptAt === undefined ? {} : { lastPromptAt: claim.lastPromptAt }),
      busy: claim.busy, ...(typeof claim.busySince === 'number' && Number.isFinite(claim.busySince) ? { busySince: claim.busySince } : {}) }))
}

export function reducePresence(previous: PresenceRecord | undefined, command: string, session: string, now: number, busy: boolean,
  pid: number, birth: string, alive: ReadonlyMap<number, ProcessIdentity>, owner: string, language: Lang,
  deadlines: Deadlines = { sleepAfter, clingyAfter: 150000 }, hostPid?: number, hostBirth?: string, mutation?: PresenceMutation, metadata?: PresenceMetadata): PresenceRecord {
  const state: PresenceRecord = previous ? JSON.parse(JSON.stringify(previous)) : { v: 1, seq: 0, quietAt: now,
    asleep: false, clingy: false, busy: false, lang: language, claims: {}, event: { kind: 'initial', id: `initial:0:${now}`, at: now, lang: language } }
  if (mutation?.touch) {
    if (!validEvent(mutation.touch) || mutation.touch.kind !== 'touch') throw new Error('invalid presence touch')
    // A retried or delayed touch cannot re-run a reaction or wake a later quiet stretch.
    if (state.touchEvent?.id === mutation.touch.id || mutation.touch.at < state.quietAt
        || (state.touchEvent && mutation.touch.at < state.touchEvent.at)) return state
  }
  if (mutation?.settings && !validSettings(mutation.settings)) throw new Error('invalid presence settings')
  const before = JSON.stringify(state)
  // A record from before the key list loses everything else on its next commit.
  if (state.settings) state.settings = cocoSettings(state.settings)
  if (mutation?.settings) mutation = { ...mutation, settings: cocoSettings(mutation.settings) }
  if (mutation?.companionExited && state.neighbours?.owner?.pid === mutation.companionExited.pid && state.neighbours.owner.birth === mutation.companionExited.birth) state.neighbours = {v:1,running:false,agents:[]}
  if (command === 'bootstrap' && mutation?.initial && mutation.settings) state.settings = { ...mutation.settings, ...state.settings }
  const wakeLanguage = state.sleepEvent?.lang ?? state.lang ?? 'en'
  const wasBusy = Object.values(state.claims).some(claim => claim.busy)
  const event = (kind: string, at: number) => {
    const value: PresenceEvent = { kind, id: `${kind}:${state.seq + 1}:${at}`, at, lang: state.lang ?? 'en' }
    state.event = value
    if (kind === 'sleep') { state.sleepEvent = value; const v = visitAtSleep(state.visitors, at, state.seq + 1, state.settings?.visitors !== false && state.settings?.visitors !== 'off'); if (v) state.visitors = v }
    if (kind === 'wake') { state.wakeEvent = value; const v = visitAtWake(state.visitors, at); if (v) state.visitors = v }
    if (kind === 'clingy') state.clingyEvent = value
  }
  const anyBusy = () => Object.values(state.claims).some(claim => claim.busy)
  for (const [key, claim] of Object.entries(state.claims)) if (!claimAlive(claim, alive)) delete state.claims[key]
  if (wasBusy && !anyBusy()) { state.quietAt = now; state.clingy = false; event('expired', now) }
  const key = `${pid}:${owner}`
  if (command === 'bootstrap') {
    for (const [other, claim] of Object.entries(state.claims)) {
      const sameHost = hostPid === undefined ? claim.pid === pid && claim.birth === birth : claim.hostPid === hostPid && claim.hostBirth === hostBirth
      if (other !== key && claim.session === session && sameHost) delete state.claims[other]
    }
  }
  if (command === 'write' && !state.claims[key]) command = 'decide'
  if (command === 'bootstrap' || command === 'write') {
    if (!state.claims[key] && Object.keys(state.claims).length >= 1024) throw new Error('presence capacity')
    const { visitorDue, ...claimMetadata } = metadata ?? {}
    const prior = state.claims[key]
    state.claims[key] = { ...prior, session, owner, pid, birth, busy, hostPid, hostBirth, uid: alive.get(pid)?.uid, executable: alive.get(pid)?.executable, ...claimMetadata }
    // When this window began working or went quiet, for the list of windows on the bag's first page (E1-2).
    if (!prior || prior.busy !== busy || prior.busySince === undefined) state.claims[key].busySince = now
    if (visitorDue) state.visitors = { ...state.visitors, due: newerDue(state.visitors?.due, visitorDue) }
  }
  if (command === 'leave') {
    const removed = state.claims[key]; delete state.claims[key]
    if (removed?.busy && !anyBusy()) { state.quietAt = now; state.clingy = false }
  }
  if (command === 'write' || (command === 'bootstrap' && busy)) state.lang = language
  if (command === 'write') {
    const oldQuiet = state.quietAt; now = Math.max(now, oldQuiet)
    state.quietAt = now; state.clingy = false
    if (state.asleep) {
      state.asleep = false; event('wake', now); state.event.id = `wake:0:${oldQuiet}`; state.event.lang = wakeLanguage
    } else event('activity', now)
  }
  if (command === 'touch' && mutation?.touch) {
    const touch = mutation.touch, oldQuiet = state.quietAt
    state.quietAt = Math.max(touch.at, oldQuiet); state.clingy = false; state.lang = touch.lang
    if (state.asleep) {
      state.asleep = false; event('wake', touch.at)
      state.wakeEvent!.id = `wake:0:${oldQuiet}`; state.wakeEvent!.lang = wakeLanguage
    }
    state.touchEvent = touch; state.event = touch
    // Delivery latency is not quiet time: waking uses the source event's exact at.
    now = touch.at
  }
  if (command === 'settings' && mutation?.settings) {
    const changes = Object.fromEntries(Object.entries(mutation.settings).filter(([key, value]) => JSON.stringify(state.settings?.[key]) !== JSON.stringify(value)))
    if (Object.keys(changes).length) {
      const at = mutation.at ?? now, oldQuiet = state.quietAt
      if (!Number.isFinite(at) || at < 0 || at > 8.64e15) throw new Error('invalid presence settings time')
      state.settings = { ...state.settings, ...changes }
      state.quietAt = Math.max(at, oldQuiet); state.clingy = false
      if (state.asleep) {
        state.asleep = false; event('wake', at)
        state.wakeEvent!.id = `wake:0:${oldQuiet}`; state.wakeEvent!.lang = wakeLanguage
      }
      const settingsEvent: PresenceSettingsEvent = { kind: 'settings', id: mutation.settingsId ?? `settings:${state.seq + 1}:${at}`,
        at, lang: language, changes }
      if (!validEvent(settingsEvent)) throw new Error('invalid presence settings event')
      state.settingsEvent = settingsEvent; state.event = settingsEvent; now = at
    }
  }
  state.busy = anyBusy()
  if (command === 'bootstrap' && wasBusy && !state.busy) { state.quietAt = Math.max(now, state.quietAt); state.clingy = false; event('activity', now) }
  if (!state.busy) {
    const quiet = Math.max(0, now - state.quietAt)
    if (!state.clingy && quiet >= deadlines.clingyAfter) { state.clingy = true; event('clingy', state.quietAt + deadlines.clingyAfter) }
    const delay = sleepDelay(deadlines, state.quietAt)
    if (!state.asleep && quiet >= delay) { state.asleep = true; event('sleep', state.quietAt + delay) }
  } else if (state.asleep) {
    const oldQuiet = state.quietAt; state.quietAt = Math.max(now, oldQuiet); state.clingy = false; state.asleep = false
    event('wake', now); state.event.id = `wake:0:${oldQuiet}`; state.event.lang = wakeLanguage
  }
  if (JSON.stringify(state) !== before || state.seq === 0) state.seq++
  return state
}

/** One native event follower; short single-process transactions at state transitions. */
export class SharedPresence {
  private snapshot: PresenceSnapshot | undefined
  private child: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
  private active = false
  private ready: (() => void) | undefined
  private whenReady = new Promise<void>(resolve => { this.ready = resolve })
  private attempted = false
  private ended: Promise<void> | undefined
  private finish: (() => void) | undefined
  private cancelSleep: (() => void) | undefined
  private cancelClingy: (() => void) | undefined
  private serial: Promise<void> = Promise.resolve()
  private pendingMutations: { command: 'touch' | 'settings' | 'write'; mutation: PresenceMutation }[] = []
  private nativeDeadlines = false
  private deadlinePath = ''
  private deadlineAt = 0
  private deadlineWrite: Promise<void> = Promise.resolve()
  private timerGeneration = 0
  private pending = ''
  private joined = false
  private ownBusy = false
  private released: Promise<void> = Promise.resolve()
  private owner = Math.random().toString(36).slice(2) || 'instance'
  private readerPid = 0
  private hostPid = 0
  private readerBirth = ''
  private hostBirth = ''
  private followerPath = ''
  private activityPending: Promise<void> | undefined
  private activityBusy = false
  private requestReady = false
  private requestListeners = new Set<{ receive: (text: string) => Promise<void> | void; ended?: () => void; generation?: () => void }>()

  constructor(private io: PresenceIO, private session: string, private folder: string, private script: string,
    private callbacks: Callbacks, private deadlines: Deadlines = { sleepAfter, clingyAfter: 150000 },
    private language: () => Lang = () => 'en', private transport: { requestPath?: string } & PresenceMetadata = {}) {
    // Older live writers do not take flock. A versioned namespace prevents their
    // snapshot/lock protocol from corrupting this generation's shared state.
    if (!windowsPath(this.folder)) this.folder = joinPath(this.folder, 'native-v2')
  }

  /** macOS and Linux run presence.sh; Windows runs the pet program's `presence` verbs (companion-rs/src/presence_helper.rs),
   *  given here as the script, with the same arguments after the folder. */
  private helper(...args: string[]): string[] {
    return windowsPath(this.folder) ? [this.script, 'presence', this.folder, ...args] : ['/bin/sh', this.script, this.folder, ...args]
  }

  get current(): PresenceSnapshot | undefined { return this.snapshot }
  get isRunning(): boolean { return this.active }
  get ownsBusy(): boolean { return this.ownBusy }
  /** Inspect under the native lock, including from an awaited redraw callback. */
  async readSessions(): Promise<PresenceSession[]> {
    if (!this.active) return []
    let sessions: PresenceSession[] = []
    // The native lock owns read ordering. Joining the JS write queue here would
    // deadlock a changed callback that is itself awaited by that queue's apply.
    try {
      await this.transaction('inspect', this.ownBusy, undefined, rows => { sessions = rows })
      return sessions
    } catch (error) { this.report(error); return [] }
  }
  subscribeRequests(receive: (text: string) => Promise<void> | void, ended?: () => void, generation?: () => void): (() => void) | undefined {
    if (!this.active || !this.transport.requestPath) return undefined
    const listener = { receive, ended, generation }; this.requestListeners.add(listener)
    return () => { this.requestListeners.delete(listener) }
  }
  private report(error: unknown): void { try { this.callbacks.error?.(error) } catch { /* presence remains optional */ } }

  /** The first-frame state from one read of snapshot.json and no native start (main's native-v2 contract). A host IO
   *  that refuses that read (M1's band, which reads the shared snapshot only through the native transaction) leaves the
   *  state already held. */
  async peek(): Promise<PresenceSnapshot | undefined> {
    try {
      const state = parsePresence(await this.io.read(joinPath(this.folder, 'snapshot.json')))
      if (state && !this.active) this.snapshot = state
      return state ?? this.snapshot
    } catch { return this.snapshot }
  }

  async start(busy = false, initialSettings?: PresenceSettings): Promise<PresenceSnapshot | undefined> {
    if (this.attempted) return this.snapshot
    this.attempted = true
    try {
      this.deadlinePath = joinPath(this.folder, `.presence-deadline-${this.owner}.jsonl`)
      this.child = this.io.spawn(this.helper('follow', this.owner, this.transport.requestPath ?? '', '', joinPath(this.folder, `.presence-follow-${this.owner}.jsonl`), this.deadlinePath))
      let initial = ''
      while (!this.readerPid) {
        const chunk = await this.child.next()
        if (chunk.done) throw new Error('presence unavailable')
        if (chunk.value.stream !== 'stdout') continue
        initial += chunk.value.text
        const newline = initial.indexOf('\n')
        if (newline < 0) { if (initial.length > MAX_LINE) throw new Error('invalid presence reader'); continue }
        const match = initial.slice(0, newline).match(/^FOLLOW\t(\d+)(\tDEADLINE1)?$/)
        if (!match) throw new Error('invalid presence reader')
        this.readerPid = Number(match[1]); this.nativeDeadlines = match[2] !== undefined; this.pending = initial.slice(newline + 1)
      }
      // The follower exists before bootstrap, so the first frame and every claim
      // refer to the same live reader generation rather than an old store value.
      const confirmed = await this.transaction('bootstrap', busy, initialSettings ? { settings: initialSettings, initial: true } : undefined)
      const state = confirmed
      this.joined = true; this.ownBusy = busy; this.active = true
      this.ended = new Promise(resolve => { this.finish = resolve })
      this.snapshot = undefined
      await this.apply(state)
      this.ready?.(); this.ready = undefined
      void this.follow().catch(error => { this.report(error); this.stop() })
      return this.snapshot
    } catch (error) {
      this.report(error); this.stop()
      if (this.child) void this.child.return({ code: null, signal: null }).catch(error => this.report(error))
      await this.released
      return undefined
    }
  }

  private async sendFIFO(path: string, device: string, inode: string, text: string): Promise<void> {
    if (new TextEncoder().encode(text).length > MAX_LINE) throw new Error('presence capacity')
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 16384)
      // Never split a Unicode surrogate pair between helper invocations.
      if (end < text.length && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF) end--
      const child = this.io.spawn(this.helper('fifo-send', path, device, inode, text.slice(offset, end)))
      try {
        while (true) { const next = await child.next(); if (next.done) { if (next.value.code !== 0) throw new Error('presence unavailable'); break } }
      } finally { void child.return({ code: null, signal: null }).catch(error => this.report(error)) }
      offset = end
    }
  }

  private async transaction(command: string, busy: boolean, mutation?: PresenceMutation, inspected?: (sessions: PresenceSession[]) => void): Promise<PresenceSnapshot> {
    const token = `${this.owner}-${Math.random().toString(36).slice(2) || 'write'}`
    const child = this.io.spawn(this.helper('transaction', token, this.transport.requestPath ?? '', command === 'leave' ? this.owner : ''))
    let pending = '', fifo = '', fifoDevice = '', fifoInode = '', headerPid = 0, record: PresenceRecord | undefined, snapshot = '', inventory = '', result: PresenceRecord | undefined
    const journal: string[] = []
    let committed = false
    try {
      while (true) {
        const chunk = await child.next()
        if (chunk.done) {
          if (!committed || !result || chunk.value.code !== 0) throw new Error('presence unavailable')
          return parsePresence(JSON.stringify(result))!
        }
        if (chunk.value.stream !== 'stdout') continue
        pending += chunk.value.text
        if (pending.length > MAX_LINE * 5) throw new Error('invalid presence transaction')
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
          if (line.startsWith('PRESENCE\t')) {
            const parts = line.split('\t'); headerPid = Number(parts[1]); fifo = parts[2] ?? ''; fifoDevice = parts[3] ?? ''; fifoInode = parts[4] ?? ''
            if (parts.length !== 5 || !/^\d{1,20}$/.test(fifoDevice) || !/^\d{1,20}$/.test(fifoInode)) throw new Error('invalid presence transaction')
            if (!Number.isSafeInteger(headerPid) || headerPid < 1 || fifo !== joinPath(this.folder, `.presence-${token}`, 'commit')) throw new Error('invalid presence transaction')
          } else if (line.startsWith('STATE\t')) snapshot = line.slice(6)
          else if (line.startsWith('LOG\t')) journal.push(line.slice(4))
          else if (line === 'INSPECT') {
            if (!fifo) throw new Error('invalid presence transaction')
            record = parsePresenceRecord(snapshot)
            if (!record) for (let i = journal.length - 1; i >= 0; i--) { record = parsePresenceRecord(journal[i]!); if (record) break }
            const pids = new Set([`${this.readerPid}:${this.owner}`, String(headerPid)])
            for (const claim of Object.values(record?.claims ?? {})) { pids.add(`${claim.pid}:${claim.owner}`); if (claim.hostPid) pids.add(String(claim.hostPid)) }
            await this.sendFIFO(fifo, fifoDevice, fifoInode, `${[...pids].join(',')}\n`)
          } else if (line === 'READY') {
            const alive = parseProcessInventory(inventory)
            const reader = alive.get(this.readerPid), host = alive.get(headerPid)
            if ((!reader || !host || reader.registeredOwner !== this.owner || reader.uid !== host.uid) && command !== 'leave') throw new Error('presence parent unavailable')
            this.hostPid = headerPid; this.readerBirth = reader?.birth ?? this.readerBirth; this.hostBirth = host?.birth ?? this.hostBirth
            if (command === 'inspect') {
              if (!record) throw new Error('invalid presence record')
              result = record
            } else result = reducePresence(record, command, this.session, await this.io.now(), busy, this.readerPid,
              this.readerBirth, alive, this.owner, this.language(), this.deadlines, this.hostPid, this.hostBirth, mutation,
              { ...(this.transport.cwd === undefined ? {} : { cwd: this.transport.cwd }),
                ...(this.transport.ribbon === undefined ? {} : { ribbon: this.transport.ribbon }),
                ...(this.transport.ribbonAt === undefined ? {} : { ribbonAt: this.transport.ribbonAt }),
                ...(this.transport.version === undefined ? {} : { version: this.transport.version }),
                ...(this.transport.visitorDue === undefined ? {} : { visitorDue: this.transport.visitorDue }),
                ...(this.transport.lastPromptAt === undefined ? {} : { lastPromptAt: this.transport.lastPromptAt }) })
            inspected?.(presenceSessions(result, alive))
            const text = JSON.stringify(result)
            if (new TextEncoder().encode(text).length + 1 > MAX_LINE) throw new Error('presence capacity')
            await this.sendFIFO(fifo, fifoDevice, fifoInode, result.seq === record?.seq ? '-\n' : `${text}\n`)
          } else if (line === 'COMMITTED') committed = true
          else inventory += `${line}\n`
        }
      }
    } finally { void child.return({ code: null, signal: null }).catch(error => this.report(error)) }
  }

  private project(state: PresenceSnapshot, command: 'touch' | 'settings' | 'write', mutation: PresenceMutation): PresenceSnapshot {
    if (command === 'write') {
      const at = mutation.at ?? state.quietAt, lang = state.sleepEvent?.lang ?? state.lang ?? 'en'
      const event: PresenceEvent = state.asleep
        ? { kind: 'wake', id: `wake:0:${state.quietAt}`, at, lang }
        : { kind: 'activity', id: `activity:${state.seq + 1}:${at}`, at, lang: this.language() }
      return { ...state, seq: state.seq + 1, quietAt: Math.max(state.quietAt, at), asleep: false, clingy: false,
        busy: state.busy || mutation.activityBusy === true, event, ...(state.asleep ? { wakeEvent: event } : {}) }
    }
    const result = reducePresence({ ...state, claims: {} }, command, this.session, mutation.touch?.at ?? mutation.at ?? state.quietAt,
      false, 0, '', new Map(), this.owner, this.language(), { sleepAfter: Infinity, clingyAfter: Infinity }, undefined, undefined, mutation)
    const { claims: _claims, ...local } = result
    local.busy = state.busy
    return local
  }
  private companionWatch?: HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  private companionOwner = ''
  private companionConfirmed = false
  private companionGeneration = 0
  private watchCompanion(state: PresenceSnapshot): PresenceSnapshot {
    const owner = state.neighbours?.running ? state.neighbours.owner : undefined
    const key = owner ? `${owner.pid}:${owner.birth}` : ''
    if (key !== this.companionOwner) {
      const generation = ++this.companionGeneration
      this.companionConfirmed = false; this.companionOwner = key
      const old = this.companionWatch; this.companionWatch = undefined
      if (old) void old.return({code:null,signal:null}).catch(error=>this.report(error))
      if (owner) {
        const child = this.io.spawn(this.helper('watch-companion',String(owner.pid),owner.birth))
        this.companionWatch = child
        void (async () => {
          let pending = '', live = false
          try {
            while (this.active && generation === this.companionGeneration) {
              const chunk = await child.next()
              if (chunk.done) break
              if (chunk.value.stream !== 'stdout') continue
              pending += chunk.value.text
              if (pending.length > 512) break
              let newline: number
              while ((newline=pending.indexOf('\n'))>=0) {
                const line=pending.slice(0,newline);pending=pending.slice(newline+1)
                if (line === `LIVE\t${owner.pid}\t${owner.birth}` && !live) {
                  live = true; this.companionConfirmed = true
                  const current = this.snapshot
                  if (current?.neighbours?.owner?.pid === owner.pid && current.neighbours.owner.birth === owner.birth) {
                    this.snapshot = {...current,neighbours:{...current.neighbours,running:true}}
                    await this.callbacks.changed(this.snapshot)
                  }
                } else if (line === `EXIT\t${owner.pid}\t${owner.birth}`) return
              }
            }
          } catch (error) { this.report(error) }
          finally {
            if (this.active && generation === this.companionGeneration) {
              this.companionConfirmed = false
              const current=this.snapshot
              if (current?.neighbours?.owner?.pid === owner.pid && current.neighbours.owner.birth === owner.birth) {
                this.snapshot={...current,neighbours:{...current.neighbours,running:false,agents:[]}}
                await this.callbacks.changed(this.snapshot)
                await this.enqueue('companion-exited',this.ownBusy,{companionExited:owner})
              }
            }
            void child.return({code:null,signal:null}).catch(error=>this.report(error))
          }
        })()
      }
    }
    return owner && !this.companionConfirmed ? {...state,neighbours:{...state.neighbours!,running:false}} : state
  }

  private async apply(state: PresenceSnapshot): Promise<void> {
    if (!this.active || (this.snapshot && state.seq <= this.snapshot.seq)) return
    // A durable echo for the first of several local gestures must not rewind the
    // visible latest gesture. Pending patches also survive another writer's update.
    const durableSeq = state.seq
    for (const pending of this.pendingMutations) state = this.project(state, pending.command, pending.mutation)
    state.seq = durableSeq
    state = this.watchCompanion(state)
    this.snapshot = state
    this.cancelDeadlines()
    const generation = this.timerGeneration
    if (this.nativeDeadlines) {
      // The first reaction/redraw must finish before the deadline-control write.
      await this.callbacks.changed(state)
      if (this.active && generation === this.timerGeneration) await this.armNativeDeadline(state)
      return
    }
    if (this.deadlines.enabled?.() !== false && !state.busy && !state.asleep) {
      const now = await this.io.now()
      if (!this.active || generation !== this.timerGeneration) return
      this.armFallbackDeadline(state, now, generation)
    }
    if (!this.active || generation !== this.timerGeneration) return
    await this.callbacks.changed(state)
  }
  private armFallbackDeadline(state: PresenceSnapshot, now: number, generation: number): void {
    const at = Math.min(state.quietAt + sleepDelay(this.deadlines, state.quietAt),
      ...(state.clingy ? [] : [state.quietAt + this.deadlines.clingyAfter]))
    if (!Number.isFinite(at)) return
    const cancel = this.io.after(Math.max(0, at - now), () => {
      if (!this.active || generation !== this.timerGeneration || this.cancelSleep !== cancel
        || this.deadlines.enabled?.() === false) return
      this.cancelSleep = undefined
      void this.decide().then(async () => {
        // A slightly early no-op decision must keep the absolute deadline armed.
        if (this.active && generation === this.timerGeneration) await this.quietChanged()
      }).catch(error => { this.report(error); this.stop() })
    })
    this.cancelSleep = cancel
  }
  private armNativeDeadline(state: PresenceSnapshot): Promise<void> {
    const generation = this.timerGeneration
    const candidates = this.deadlines.enabled?.() !== false && !state.busy && !state.asleep
      ? [state.quietAt + sleepDelay(this.deadlines, state.quietAt), ...(state.clingy ? [] : [state.quietAt + this.deadlines.clingyAfter])]
      : []
    const at = Math.min(...candidates.filter(value => Number.isSafeInteger(value) && value > 0 && value <= 8.64e15))
    this.deadlineAt = Number.isFinite(at) ? at : 0
    const text = `${generation}\t${this.deadlineAt}\n`
    const operation = this.deadlineWrite.then(async () => {
      if (this.active && generation === this.timerGeneration) {
        const child = this.io.spawn(this.helper('deadline-write', this.owner, text))
        try {
          while (true) { const next = await child.next(); if (next.done) { if (next.value.code !== 0) throw new Error('presence deadline unavailable'); break } }
        } finally { void child.return({ code: null, signal: null }).catch(error => this.report(error)) }
      }
    })
    this.deadlineWrite = operation.catch(error => { this.report(error); this.stop() })
    return this.deadlineWrite
  }
  private async receiveDeadline(line: string): Promise<void> {
    const match = line.match(/^DEADLINE\t(\d{1,16})\t(\d{1,16})$/)
    if (!match || !this.nativeDeadlines || !this.active || this.deadlines.enabled?.() === false) return
    const generation = Number(match[1]), at = Number(match[2])
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(at) || at <= 0
        || generation !== this.timerGeneration || at !== this.deadlineAt) return
    this.deadlineAt = 0 // A repeated packet cannot start a second transaction.
    await this.decide()
    if (this.active && generation === this.timerGeneration && this.snapshot) {
      // Clock rounding or a wall-clock adjustment may make a valid native expiry
      // slightly early for the host clock. A no-op decision must not lose the wait.
      this.cancelDeadlines()
      await this.armNativeDeadline(this.snapshot)
    }
  }
  private cancelDeadlines(): void {
    this.timerGeneration++
    this.deadlineAt = 0
    this.cancelSleep?.(); this.cancelClingy?.(); this.cancelSleep = undefined; this.cancelClingy = undefined
  }
  async quietChanged(): Promise<void> {
    this.cancelDeadlines()
    const state = this.snapshot, generation = this.timerGeneration
    if (!this.active || !state) return
    if (this.nativeDeadlines) { await this.armNativeDeadline(state); return }
    if (this.deadlines.enabled?.() === false || state.busy || state.asleep) return
    const now = await this.io.now()
    if (!this.active || generation !== this.timerGeneration || this.deadlines.enabled?.() === false) return
    this.armFallbackDeadline(state, now, generation)
  }
  private enqueue(command: string, busy = false, mutation?: PresenceMutation, drawn?: Promise<void>): Promise<void> {
    const operation = this.serial.then(async () => {
      await drawn
      await this.whenReady
      if (!this.active) return
      try { await this.apply(await this.transaction(command, busy, mutation)) }
      finally { this.pendingMutations = this.pendingMutations.filter(pending => pending.mutation !== mutation) }
    })
    this.serial = operation.catch(error => { this.report(error); this.stop() })
    return this.serial
  }
  private decide(): Promise<void> { return this.enqueue('decide') }
  private immediate(command: 'touch' | 'settings', mutation: PresenceMutation): Promise<void> {
    const state = this.snapshot
    if (!state) {
      this.pendingMutations.push({ command, mutation })
      return this.enqueue(command, this.ownBusy, mutation)
    }
    // Use the same pure reducer for local and locked durable decisions. Local claims
    // are private to the transport; remote busy ownership remains exactly as observed.
    const local = this.project(state, command, mutation)
    if (JSON.stringify(local) === JSON.stringify({ ...state, seq: local.seq })) return Promise.resolve()
    local.seq = state.seq
    this.pendingMutations.push({ command, mutation })
    this.snapshot = local
    this.cancelDeadlines()
    let drawn: Promise<void> | void = undefined
    try { drawn = this.callbacks.changed(local) } catch (error) { this.report(error) }
    // Publication begins only after the synchronous reaction and its redraw promise.
    return this.enqueue(command, this.ownBusy, mutation, Promise.resolve(drawn).catch(error => this.report(error)))
  }
  touch(touch: PresenceTouch, at = Date.now(), by: PresenceTouchEvent['by'] = 'band', session?: string): Promise<void> {
    const event: PresenceTouchEvent = { kind: 'touch', id: `touch:${by}:${at}`, at, by, touch, lang: this.language(),
      ...(by === 'band' ? { session: session ?? this.session } : session === undefined ? {} : { session }) }
    return this.immediate('touch', { touch: event })
  }
  settings(values: PresenceSettings, at = Date.now()): Promise<void> {
    if (!validSettings(values)) throw new Error('invalid presence settings')
    const settings = JSON.parse(JSON.stringify(values)) as PresenceSettings
    return this.immediate('settings', { settings, at, settingsId: `settings:${Math.floor(Math.random() * 1e9)}:${at}` })
  }
  async activity(busy: boolean, at?: number): Promise<void> {
    if (!this.active && (at === undefined || !this.snapshot)) return
    if (at !== undefined) {
      if (!Number.isFinite(at) || at < 0 || at > 8.64e15) throw new Error('invalid presence activity time')
      this.ownBusy = busy; this.activityBusy = busy
      const state = this.snapshot
      if (state?.asleep || (!this.active && state)) {
        const mutation: PresenceMutation = { at, activityBusy: busy }
        const local = this.project(state, 'write', mutation)
        local.seq = state.seq
        this.pendingMutations.push({ command: 'write', mutation })
        this.snapshot = local
        this.cancelDeadlines()
        let drawn: Promise<void> | void = undefined
        try { drawn = this.callbacks.changed(local) } catch (error) { this.report(error) }
        return this.enqueue('write', busy, mutation, Promise.resolve(drawn).catch(error => this.report(error)))
      }
    }
    if (!this.active) return
    this.ownBusy = busy; this.activityBusy = busy
    const state = this.snapshot
    if (state?.asleep) {
      let now: number
      try { now = await this.io.now() } catch (error) { this.report(error); this.stop(); return }
      if (this.active && this.snapshot === state) {
        const wake: PresenceEvent = { kind: 'wake', id: `wake:0:${state.quietAt}`, at: now, lang: state.sleepEvent?.lang ?? state.lang ?? 'en' }
        this.snapshot = { ...state, asleep: false, clingy: false, busy, lang: wake.lang, event: wake, wakeEvent: wake }
        this.cancelDeadlines()
        try { await this.callbacks.changed(this.snapshot) } catch (error) { this.report(error) }
      }
    }
    // One microtask coalesces prompt/turn edges arriving in the same burst.
    return this.activityPending ??= Promise.resolve().then(async () => {
      const latest = this.activityBusy
      this.activityPending = undefined
      await this.enqueue('write', latest)
    })
  }
  async prompt(at: number): Promise<void> {
    if (!Number.isFinite(at) || at < 0) return
    this.transport.lastPromptAt = Math.max(this.transport.lastPromptAt ?? 0, at)
    await this.activityPending
    if (this.active) await this.enqueue('write', this.ownBusy)
  }
  async end(): Promise<void> {
    if (!this.active) return
    await this.activityPending
    await this.enqueue('leave'); this.joined = false; this.stop()
  }
  stop(): void {
    this.companionGeneration++;this.companionOwner='';this.companionConfirmed=false
    const watcher=this.companionWatch;this.companionWatch=undefined
    if(watcher) void watcher.return({code:null,signal:null}).catch(error=>this.report(error))
    this.cancelDeadlines()
    this.ready?.(); this.ready = undefined
    const wasActive = this.active; this.active = false; this.ownBusy = false; this.pendingMutations = []
    if (this.joined) {
      this.joined = false
      this.released = this.serial.then(async () => { await this.transaction('leave', false) }).catch(error => this.report(error))
    }
    this.finish?.(); this.finish = undefined
    for (const listener of this.requestListeners) { try { listener.ended?.() } catch (error) { this.report(error) } }
    this.requestListeners.clear()
    if (wasActive) { try { void Promise.resolve(this.callbacks.ended?.()).catch(error => this.report(error)) } catch (error) { this.report(error) } }
  }
  private async follow(): Promise<void> {
    const child = this.child!
    let line = '', oversized = false, path = this.followerPath || joinPath(this.folder, 'presence.jsonl')
    try {
      while (this.active) {
        const chunk = this.pending ? { done: false as const, value: { stream: 'stdout' as const, text: this.pending } }
          : await Promise.race([child.next(), this.ended!.then(() => undefined)])
        this.pending = ''
        if (!chunk || chunk.done || !this.active) break
        if (chunk.value.stream !== 'stdout') continue
        for (const part of chunk.value.text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
          const complete = part.endsWith('\n'), piece = complete ? part.slice(0, -1) : part
          if (line.length + piece.length > MAX_LINE) { oversized = true; line = '' }
          if (!oversized) line += piece
          if (complete) {
            if (!oversized) {
              const header = line.match(/^==> (.*) <==$/)
              if (/^REQUEST-GENERATION\t[0-9]+\t[0-9]+$/.test(line)) { for (const listener of this.requestListeners) { try { listener.generation?.() } catch (error) { this.report(error) } } }
              else if (header) path = header[1]!
              else if (path === joinPath(this.folder, `.presence-follow-${this.owner}.jsonl`) && line === `READY\t${this.owner}`) {
                this.requestReady = true
              }
              else if (path === this.deadlinePath) await this.receiveDeadline(line)
              else if (path === this.transport.requestPath && line && this.requestReady) {
                for (const listener of this.requestListeners) {
                  try { await listener.receive(`${line}\n`) } catch (error) { this.report(error) }
                }
              }
              else if (path === joinPath(this.folder, 'presence.jsonl') || path === joinPath(this.folder, 'snapshot.json')) {
                const state = parsePresence(line); if (state) await this.apply(state)
              }
            }
            line = ''; oversized = false
          }
        }
      }
    } catch (error) { this.report(error) }
    finally { this.stop(); void child.return({ code: null, signal: null }).catch(error => this.report(error)) }
  }
}
