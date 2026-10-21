// What sits beneath the plugin in these tests: a clock, a store, the environment, the plugin's
// state cell and the few engine answers the plugin waits on. Calls on `$` (settings.read,
// command.register, ...) are answered as `{ value }`; events (session.start, tool.call, ...)
// with their own result. Not shipped: tools/run-tests.py copies these next to a copy of plugin/.

import { D1_ART_FILES } from './d1-art-fixture'
import { mock } from 'claude-code/testing'
import type { Engine as TestEngine } from 'claude-code/testing'
import type { ConfigRow, On, TurnUsage } from 'claude-code'
import type { CocoView } from '../types'
import { BOOK_FILES } from './book-files'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import * as COCO_FIXTURE from './coco-band-data'
// Coco's band data as the plugin ships it (assets/coco/band-<outfit>.json; run-tests.py fills it with
// blank pictures). presence-world.tsx is a reviewed fixture, so its tests pass this as readText.
export function cocoBandText(path: string): string | undefined {
  const outfit = /[\\/]assets[\\/]coco[\\/]band-([AB])\.json$/.exec(path)?.[1]
  return outfit === undefined ? undefined : (COCO_FIXTURE as { COCO_BAND_TEXT?: Record<string, string> }).COCO_BAND_TEXT?.[outfit]
}
import { M1_MORE_TEXT, M1_GAPS_TEXT } from './m1-more-data-fixture'
import { WINDOWS_ROOTS } from './test-system'
import { TRADITIONAL_ONLY, SIMPLIFIED_ONLY } from './chinese-script-data'
import { COST_WORDS_RAW, SHIPPED_PRICES_RAW } from './cost-words-fixture'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { D1_ROOM_ASSET_FILES } from './d1-room-assets-fixture'

export const MORNING = Date.UTC(2026, 9, 2, 9, 0) // 09:00 in the UTC zone the tests set
export const RECENT = { lastActive: MORNING - 60_000, firstMet: MORNING - 60_000 } // established install, seen a minute ago: no greeting
export const PERSON = { kind: 'composer' as const }
export const P = { isFullscreen: false, columns: 100 }
export const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far.', toolUses: [] }

export type World = {
  withNativePresence?: boolean // opt-in Lively for legacy transport/nap contracts; default off
  sessionCompact?: false // Private SDK boundary fixture: leave the native bottom unimplemented.
  sessionTurns?: false
  sessionRoot?: string
  sessionId?: string
  observeStore?: boolean
  surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]
  settings?: Record<string, unknown>
  config?: ConfigRow[]
  theme?: ConfigRow['value']
  store?: Record<string, unknown>
  initialState?: Record<string, unknown> // existing host cells; family addresses use key:id
  env?: Record<string, string>
  percent?: number | null // null: the engine has no figure (a fresh session, just compacted)
  stepTools?: {id:string;name:string}[]
  stepUsage?: TurnUsage | null // a landed response before the engine's session snapshot catches up
  stepText?: string // stream a main-agent text chunk before the response result
  stepHold?: () => Promise<void> | undefined // delayed main response at the existing stream seam
  estimate?: number // what the engine's local breakdown counts, in tokens
  bashFails?: () => boolean
  ask?: boolean
  toolCheck?: () => { decision: 'allow' | 'ask' | 'deny'; reason?: string } // optional host verdict for preservation checks
  toolResult?: (tool: string) => { result: unknown; text?: string } | undefined // caller-owned private file/output fixture
  onTool?: (tool: string) => void
  hold?: (tool: string) => Promise<void> | undefined
  onRender?: (component: string, props: unknown) => void
  onOpen?: (id: string) => void // measurement of the engine pane-open request
  beforeUsage?: () => Promise<void> | void // optional hold at the existing usage seam; absent by default
  readText?: (path: string) => string | Promise<string> | undefined // optional file content at the existing FS seam
  moreText?: string // explicit development-only payload; approved words remain the default
  theirsRows?: number // rows another mod draws in the band under ours
  limits?: { kind: string; percentUsed: number; resetsAt?: string }[] // the account's rate-limit windows
  cost?: number // the session's cost in US dollars, as /cost totals it
  startedAt?: number // when the session began, as $.session.usage() says (0 when not given)
  compactWindow?: number // the window the engine compacts at, as /context measures it (absent: the model's 200000)
  engineRows?: boolean // the engine's own drawing under transcript rows, as `{ type: 'engine' }`
}

// A valid 1x1 PNG carrying `path` in a tEXt chunk: signature and IHDR, tEXt, then IDAT and IEND.
const HEAD = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]
const TAIL = 'AAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
function crc32(bytes: number[]): number {
  let c = -1
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ -1) >>> 0
}
export function stubPng(path: string): string {
  const data = [...'tEXt', ...`path\0${path}`].map(ch => ch.charCodeAt(0) & 255)
  const len = data.length - 4
  const crc = crc32(data)
  const chunk = [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]
  return btoa(String.fromCharCode(...HEAD, ...chunk) + atob(TAIL))
}

export function band(columns: number, isWorking = false, maxRows = 30) {
  return {
    plugin: 'coco',
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
    viewport: { columns, rows: 48 },
  }
}

export function themeConfig(value: ConfigRow['value'] = 'dark'): ConfigRow[] {
  return [{ key: 'theme', label: 'Theme', kind: 'choice', value,
    options: ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'],
    provider: { plugin: 'engine', tier: 'core' }, isLocked: false }]
}

// Normalize the linked native desktop picture so legacy geometry/source assertions keep
// checking the actual image bytes, including the ordinary Svg used by the Off door.
export async function desktopPicture(ui: { find: (match: { type: string; key?: string }) => Promise<any>; drawn: () => Promise<unknown> }): Promise<{ props: Record<string, unknown> } | undefined> {
  const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children ?? [])] : []
  const tree = nodes(await ui.drawn())
  const picture = tree.find(node => node.type === 'Box' && node.props?.key === 'coco:picture')
  if (picture) {
    const source = nodes(picture).find(node => node.type === 'Svg')
    if (!source) throw new Error('keyed desktop picture has no actual Svg')
    return source
  }
  const keyed = tree.find(node => node.type === 'Svg' && node.props?.key === 'coco:picture')
  if (keyed) return keyed
  const linked = await ui.find({ type: 'Markdown', key: 'coco:band:poke' })
  if (linked) {
    const text = String(linked.props.text)
    const match = /^\[!\[([\s\S]*?)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)\]\(file:\/\/\/coco-poke\)$/.exec(text)
    if (!match) throw new Error('invalid linked desktop picture')
    const source = atob(match[2]!)
    const width = Number(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/.exec(source)?.[1])
    const height = Number(/<svg[^>]*\bheight="(\d+)"/.exec(source)?.[1])
    return { props: { source, width, height, alt: match[1]!.replace(/\\([\\[\]])/g, '$1') } }
  }
  return ui.find({ type: 'Svg' })
}

export function world(on: On, w: World = {}) {
  const clock = mock.clock(on, { now: MORNING })
  const config = w.config ?? themeConfig(w.theme)
  const stored = new Map<string, unknown>(Object.entries(w.store ?? {}))
  if (w.observeStore) on('store.*', async ($, e, next) => {
    const result = await next(e)
    if (next.is('store.set', e) && !('deny' in result)) stored.set(e.key, e.value)
    if (next.is('store.delete', e) && !('deny' in result)) stored.delete(e.key)
    return result
  })
  const record=(w.store?.bandSettings ?? w.store ?? {}) as Record<string,unknown>
  const chosenRecord=w.withNativePresence?{...record,more:{...((record as {more?:object}).more??{}),lively:true}}:record
  mock.store(on, { ...(w.store ?? {}), ...(w.withNativePresence?{more:{lively:true}}:{}), bandSettings:chosenRecord })
  // This legacy world models assets and the optional companion, not native
  // presence. Explicit absence keeps its process/asset seams truthful.
  on('fs.exists', { path: /^\/usr\/bin\/python3$/ }, () => ({ value: false }))
  const env = w.env ?? { LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }
  mock.env(on, WINDOWS_ROOTS ? { ...env, ...(!env.HOME ? { USERPROFILE: 'C:\\Users\\windows' } : {}), PROCESSOR_ARCHITECTURE: env.PROCESSOR_ARCHITECTURE ?? 'AMD64' } : env)
  if (w.sessionRoot || WINDOWS_ROOTS) on('session.root', () => ({ value: w.sessionRoot ?? 'C:\\Users\\windows\\project' }))
  const cells = new Map<string, { value: unknown; version: number }>(Object.entries(w.initialState ?? {}).map(([key, value]) => [key, { value, version: 1 }]))
  const live: {
    percent: number | undefined
    estimate: number | undefined
    fails: boolean
    reads: number
    stateReads: number
    limits: { kind: string; percentUsed: number; resetsAt?: string }[]
    cost: number | undefined
    compactWindow: number | undefined
  } = {
    percent: w.percent === null ? undefined : (w.percent ?? 20),
    estimate: w.estimate,
    fails: false,
    reads: 0,
    stateReads: 0,
    limits: w.limits ?? [],
    cost: w.cost,
    compactWindow: w.compactWindow,
  }
  const toasts: string[] = []
  const blits: string[] = []
  const opens: { id: string; focus?: true; rows?: number }[] = [] // each $.ui.open, as asked
  const fileReads: string[] = [] // each $.fs.read, by path
  on('state.get', async ($, e, next) => {
    live.stateReads += 1
    await next(e) // retain the kit's real render-instance subscription
    const address = e.id === undefined ? e.key : `${e.key}:${e.id}`
    const cell = cells.get(address)
    return { value: { value: cell?.value, version: cell?.version ?? 0 } } as never
  })
  on('state.set', async ($, e, next) => {
    const result = await next(e) // retain native subscription redraws
    const address = e.id === undefined ? e.key : `${e.key}:${e.id}`
    const version = result.value?.version ?? (cells.get(address)?.version ?? 0) + 1
    cells.set(address, { value: e.value, version })
    return result
  })
  on('settings.read', () => ({ value: { timeZone: 'UTC', ...(w.settings ?? {}) } }))
  on('config.list', () => ({ value: config.map(row => ({ ...row })) }))
  if (w.sessionTurns !== false) on('session.*', async ($, e, next) => {
    if (!next.is('session.turns', e)) return next(e)
    try { return await next(e) } catch (error) {
      if (!String(error).includes('no implementation for session.turns')) throw error
      return { value: 0 }
    }
  })
  on('session.usage', ($, e) => {
    const answer = () => {
      live.reads += 1
      const figure = live.percent === undefined ? {} : { tokens: 2000 * live.percent, percent: live.percent }
      const compacting = live.compactWindow === undefined ? {} : { rawMaxTokens: live.compactWindow, isAutoCompactEnabled: true }
      const breakdown = e?.breakdown && (live.estimate !== undefined || live.compactWindow !== undefined) ? { breakdown: { ...(live.estimate === undefined ? {} : { totalTokens: live.estimate }), ...compacting } } : {}
      const cost = live.cost === undefined ? {} : { cost: { usd: live.cost } }
      return { value: { startedAt: w.startedAt ?? 0, context: { window: 200000, ...figure, ...breakdown }, rateLimits: live.limits, ...cost } } as never
    }
    return w.beforeUsage ? Promise.resolve(w.beforeUsage()).then(answer) : answer()
  })
  // The asset reads: his book's words as the plugin ships them (book-files.ts, filled by the test
  // runners), and for any other file a real 1x1 PNG whose tEXt chunk names it (build-preview.py
  // swaps the file's own PNG in).
  on('fs.read', async ($, e) => {
    fileReads.push(e.path)
    if (/[\\/]assets[\\/]coco[\\/]band-[AB]\.json$/.test(e.path)) {
      const text = cocoBandText(e.path)
      return text === undefined ? { deny: `no Coco data: ${e.path}` } : { value: text }
    }
    if (/[\\/]hooks[\\/]more-text\.json$/.test(e.path)) return { value: w.moreText ?? M1_MORE_TEXT }
    if (/[\\/]hooks[\\/]gaps-text\.json$/.test(e.path)) return { value: M1_GAPS_TEXT }
    if (/[\\/]hooks[\\/]bag-text\.json$/.test(e.path)) return { value: BAG_TEXT_RAW }
    const text = w.readText?.(e.path)
    if (text !== undefined) return { value: await text }
    if (/[\\/]hooks[\\/]cost-text\.json$/.test(e.path)) return { value: COST_WORDS_RAW }
    if (/[\\/]assets[\\/]prices\.json$/.test(e.path)) return { value: SHIPPED_PRICES_RAW }
    const art=/[\\/]hooks[\\/](d1-(?:helpers|ribbon|shed|trim)-art\.json)$/.exec(e.path)
    if(art&&D1_ART_FILES['hooks/'+art[1]]!==undefined)return {value:D1_ART_FILES['hooks/'+art[1]]!}
    if (/[\\/]hooks[\\/]chinese-script-data\.json$/.test(e.path)) return { value: JSON.stringify({ TRADITIONAL_ONLY, SIMPLIFIED_ONLY }) }
    if (/[\\/]hooks[\\/]d1-words\.json$/.test(e.path)) return { value: D1_WORDS_TEXT }
    if (/[\\/]hooks[\\/]c3-text\.json$/.test(e.path)) return { value: C3_WORDS_RAW }
    if (/[\\/]assets[\\/]coco-room[\\/]/.test(e.path)) {
      const name=e.path.split(/[\\/]/).pop()!,source=D1_ROOM_ASSET_FILES[name]
      if(source!==undefined)return {value:name==='layers.json'?source:{base64:source}}
      return {deny:`no such room layer: ${e.path}`}
    }
    const words = /[\\/]book[\\/]([\w-]+\.json)$/.exec(e.path)
    if (words) {
      const text = BOOK_FILES[words[1] ?? '']
      return text === undefined ? { deny: `no such file: ${e.path}` } : { value: text }
    }
    return { value: { base64: stubPng(e.path) } }
  })
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.onOpen?.(e.id)
    opens.push({ id: e.id, ...(e.focus ? { focus: e.focus } : {}), ...(e.rows === undefined ? {} : { rows: e.rows }) })
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', {}, async ($, e, next) => {
    try { return await next(e) } catch (error) {
      if (!String(error).includes('no implementation for session.id')) throw error
      return { value: w.sessionId ?? 'fixture-session' }
    }
  })
  on('session.surfaces', {}, async ($, e, next) => {
    try { return await next(e) } catch (error) {
      if (!String(error).includes('no implementation for session.surfaces')) throw error
      return { value: w.surfaces ?? ['terminal'] }
    }
  })
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    const held = w.stepHold?.(); if (held) await held
    for (const [index, tool] of (w.stepTools ?? []).entries()) yield { kind: 'tool' as const, index, ...tool }
    if (w.stepText !== undefined) yield { kind: 'text' as const, index: (w.stepTools ?? []).length, text: w.stepText }
    return { turnId: e.turnId, index: e.index, answer: w.stepText ?? '', toolUses: [], stopReason: 'end_turn', usage: w.stepUsage ?? null }
  })
  on('tool.check', () => w.toolCheck?.() ?? ({ decision: w.ask ? 'ask' : 'allow' }))
  if(w.sessionCompact!==false)on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('config.set', ($, e) => {
    const row = config.find(item => item.key === e.key)
    if (row) row.value = e.value
    return { value: e.value }
  })
  on('command.describe', { command: /^b1b-host-boundary$/ }, async ($,e,next) => {
    for (let i=0;i<80;i++) await next(e)
    return { description: '', isHidden: true }
  })
  on('command.describe', { command: 'b1b-host-boundary' }, () => ({ description: '', isHidden: true }))
  on('command.run', () => ({ text: '' })) // a core command (/model, /rewind)
  on('tool.call', async ($, e) => {
    w.onTool?.(e.tool)
    await w.hold?.(e.tool)
    const fails = w.bashFails ? w.bashFails() : live.fails
    return (w.toolResult?.(e.tool) ?? (e.tool === 'Bash' && fails ? { isError: true, result: 'exit 1', text: 'Exit code 1' } : { result: { ok: true } })) as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('ui.render', ($, e) => {
    w.onRender?.(e.component, e.props)
    if (w.engineRows && e.component !== 'AbovePrompt' && e.component !== 'Pane') return { type: 'engine', ref: 0 } as never
    if (e.component === 'AbovePrompt' && w.theirsRows) {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {Array.from({ length: w.theirsRows }, (_, i) => <Text>{`another mod, row ${i + 1}`}</Text>)}
        </Box>
      )
    }
    return <></>
  })
  return {
    clock,
    toasts,
    blits,
    opens,
    fileReads,
    stored: (key: string) => stored.get(key),
    storedEntries: () => [...stored.entries()],
    view: () => {
      const view = cells.get('view')?.value as CocoView | undefined
      if (!view) throw new Error('the plugin has not drawn a view yet')
      return view
    },
    // For previews: show a moment the clock would otherwise pass through (a blink frame).
    patch: (change: Partial<CocoView>) => {
      const cell = cells.get('view')
      if (cell?.value) cells.set('view', { value: { ...(cell.value as CocoView), ...change }, version: cell.version + 1 })
    },
    set fails(value: boolean) {
      live.fails = value
    },
    set percent(value: number | null) {
      live.percent = value === null ? undefined : value
    },
    set estimate(value: number | undefined) {
      live.estimate = value
    },
    set compactWindow(value: number | undefined) {
      live.compactWindow = value
    },
    get reads() {
      return live.reads
    },
    get stateReads() {
      return live.stateReads
    },
    // A state value as the plugin last wrote it, by key, with its version.
    cell: (key: string) => cells.get(key),
    resetHostState: () => cells.clear(), // session identity changes start with fresh host cells
    set limits(value: { kind: string; percentUsed: number; resetsAt?: string }[]) {
      live.limits = value
    },
    set cost(value: number | undefined) {
      live.cost = value
    },
  }
}

// Legacy event-behavior fixtures let lifecycle-owned background startup run before assertions.
// Cold first-answer and pending-dependency tests use their own fixtures and never call this.
export async function settleLegacyStart($: TestEngine, w: ReturnType<typeof world>): Promise<void> {
  await w.clock.advance(0)
  await $.command.describe({command:'b1b-host-boundary',description:'',isHidden:true,immediate:true,provider:{plugin:'engine',tier:'core'}})
  await w.clock.advance(0)
}
