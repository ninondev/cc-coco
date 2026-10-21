import { DIAGNOSTIC_APPEND } from '../hooks/shared-files'
// One real engine band and remote session snapshots at the shared filesystem/process seam.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { CocoView } from '../types'
import { D1_ART_FILES } from './d1-art-fixture'
import { BOOK_FILES } from './book-files'
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { MORNING, RECENT, stubPng, themeConfig } from './world'
import { WINDOWS_ROOTS } from './test-system'
import { transportFixture } from './presence-transport-fixture'

export type SharedSnapshot = { v: 1; seq: number; lang?: string; quietAt: number; asleep: boolean; clingy: boolean; busy: boolean; event: { kind: string; id: string; at: number }; sleepEvent?: { kind: string; id: string; at: number }; wakeEvent?: { kind: string; id: string; at: number }; clingyEvent?: { kind: string; id: string; at: number } }
export const HOME = '/tmp/presence-kit-user'
export const FOLDER = `${HOME}/Library/Application Support/Coco-presence`
export function snapshot(kind = 'activity', at = MORNING, seq = 1, extra: Partial<SharedSnapshot> = {}): SharedSnapshot {
  return { v: 1, seq, quietAt: at, asleep: kind === 'sleep', clingy: kind === 'clingy', busy: false,
    event: { kind, id: `${kind}:${seq}:${at}`, at }, ...(['sleep', 'wake', 'clingy'].includes(kind) ? { [kind + 'Event']: { kind, id: `${kind}:${seq}:${at}`, at } } : {}), ...extra }
}
export function presenceWorld(on: On, initial = snapshot(), options: { withNativePresence?: boolean; moreRead?: () => Promise<string>; sessionTurns?: false; windows?: boolean; macCapabilities?: true; affection?: 'warm' | 'clingy'; remoteBusy?: boolean; readFails?: boolean; noTransport?: boolean; firstPullFails?: boolean; missingShell?: boolean; missingTail?: boolean; mockDiagnostics?: boolean; companion?: boolean; store?:Record<string,unknown>; reducedMotion?:boolean; readText?:(path:string)=>string|undefined; surface?:'desktop'|'terminal' } = {}) {
  const clock = mock.clock(on, { now: MORNING })
  const config = themeConfig('dark')
  mock.store(on, { ...RECENT, ...(options.withNativePresence ? { more: { lively: true } } : {}), ...options.store, bandSettings:{...(options.affection ? { affection: options.affection } : {}), ...(options.withNativePresence ? { more: { lively: true } } : {})} })
  const windows = options.macCapabilities ? false : WINDOWS_ROOTS || options.windows
  mock.env(on, windows ? { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\windows', LANG: 'en_US.UTF-8' } : { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  const transport = transportFixture(initial, options)
  let firstReadAt: number | undefined
  const calls: { mode: string; argv: readonly string[] }[] = []
  const reads: string[] = []
  // The native transaction is the only snapshot read the shipping presence makes (m1: no plain file
  // reads of the shared folder); its STATE line carries snapshot.json under the helper's lock.
  const secureReads: string[] = []
  const draws: { mood: unknown; said: unknown }[] = []
  const invalidates: number[] = []
  const drawTimes: number[] = []
  const diagnosticRecords: Record<string, unknown>[] = []
  const companionFeeds: Record<string, unknown>[] = []
  on('state.get', async ($, e, next) => { await next(e); return { value: cells.get(e.key) ?? { value: undefined, version: 0 } } as never })
  on('state.set', async ($, e, next) => { const result = await next(e); const version = result.value?.version ?? (cells.get(e.key)?.version ?? 0) + 1; cells.set(e.key, { value: e.value, version }); return result })
  on('settings.read', () => ({ value: { timeZone: 'UTC', prefersReducedMotion: options.reducedMotion??true } }))
  // R4 theme contract: the global theme is a config.list row, never a setting.
  on('config.list', () => ({ value: config.map(row => ({ ...row })) }))
  if (options.sessionTurns !== false) on('session.*', async ($, e, next) => {
    if (!next.is('session.turns', e)) return next(e)
    try { return await next(e) } catch (error) {
      if (!String(error).includes('no implementation for session.turns')) throw error
      return { value: 0 }
    }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'local-session' }))
  on('session.root', () => ({ value: windows ? 'C:\\project' : '/tmp/presence-project' }))
  on('session.surfaces', () => ({ value: [options.surface??'desktop'] }))
  on('fs.exists', ($, e) => ({ value: !windows && !(options.missingShell && e.path === '/bin/sh') && !(options.missingTail && e.path === '/usr/bin/tail') && (options.mockDiagnostics && e.path === `${HOME}/Library/Application Support/Coco/diagnostics` || options.companion && (e.path === `${HOME}/Library/Application Support/Coco` || e.path === `${HOME}/Library/Application Support/Coco/requests.jsonl`) || e.path === FOLDER || e.path === `${FOLDER}/snapshot.json` || e.path === '/usr/bin/tail' || e.path === '/bin/sh' || e.path === '/System/Library/CoreServices/SystemVersion.plist') }))
  on('fs.read', ($, e) => {
    reads.push(e.path)
    const text=options.readText?.(e.path);if(text!==undefined)return {value:text} as never
    const art=/[\\/]hooks[\\/](d1-(?:helpers|ribbon|shed|trim)-art\.json)$/.exec(e.path)
    if(art&&D1_ART_FILES['hooks/'+art[1]]!==undefined)return {value:D1_ART_FILES['hooks/'+art[1]]!} as never
    if (/[\\/]hooks[\\/]c3-text\.json$/.test(e.path)) return { value: C3_WORDS_RAW } as never
    if (/[\\/]hooks[\\/]more-text\.json$/.test(e.path)) return (options.moreRead ? options.moreRead().then(value => ({ value })) : { value: M1_MORE_TEXT }) as never
    if (/[\\/]hooks[\\/]gaps-text\.json$/.test(e.path)) return { value: M1_GAPS_TEXT } as never
    if (e.path.endsWith('/requests.jsonl')) return { value: '' } as never
    if (e.path.endsWith('/snapshot.json')) {
      firstReadAt ??= Date.now()
      if (options.readFails) throw new Error('presence read failed')
      return { value: JSON.stringify(transport.state) } as never
    }
    const words = /[\\/]book[\\/]([\w-]+\.json)$/.exec(e.path)
    if (words) return { value: BOOK_FILES[words[1]!] ?? '{}' } as never
    return { value: { base64: stubPng(e.path) } } as never
  })
  on('fs.write', async ($, e) => { if (e.path.endsWith('/commit')) await transport.write(e.path, e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    const mode = e.argv[3] ?? ''
    calls.push({ mode, argv: e.argv })
    if ((e.argv[0] === '/bin/sh' && e.argv[1] === '-c' && e.argv[2] === DIAGNOSTIC_APPEND) && e.init?.stdin) diagnosticRecords.push(JSON.parse(e.init.stdin))
    if (e.argv[0] === '/bin/sh' && e.argv[5] === 'view.json' && e.init?.stdin) companionFeeds.push(JSON.parse(e.init.stdin))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e) {
    calls.push({ mode: e.argv[3] ?? '', argv: e.argv })
    if (!e.argv.some(arg => arg.endsWith('presence.sh'))) return { value: { code: 0, signal: null } }
    if (e.argv[3] === 'transaction') secureReads.push(e.argv[2] + '/snapshot.json')
    const child = transport.spawn('local-session', [...e.argv])
    try {
      while (true) { const chunk = await child.next(); if (chunk.done) return { value: chunk.value }; yield chunk.value }
    } finally { await child.return({ code: 0, signal: null }) }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } })
  on('tool.call', () => ({ result: { ok: true } }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('command.run', () => ({ text: '' }))
  on('config.set', ($, e) => {
    const row = config.find(item => item.key === e.key)
    if (row) row.value = e.value
    return { value: e.value }
  })
  on('ui.invalidate', ($, e, next) => { invalidates.push(Date.now()); return next(e) })
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', ($, e) => {
    if (e.component === 'AbovePrompt') { const view = cells.get('view')?.value as CocoView | undefined; draws.push({ mood: view?.mood, said: view?.said }); drawTimes.push(Date.now()) }
    return <></>
  })
  return {
    clock, calls, reads, secureReads, draws, drawTimes, invalidates, diagnosticRecords, companionFeeds,
    get current() { return transport.state },
    firstReadAt: () => firstReadAt,
    view: () => cells.get('view')?.value as CocoView,
    remote: (value: SharedSnapshot) => transport.remote(value),
    insertSession:(session:string,metadata:{cwd:string;ribbon:number;ribbonAt:number},at:number)=>transport.insertSession(session,metadata,at),
    removeSession:(session:string,at:number)=>transport.removeSession(session,at),
  }
}
