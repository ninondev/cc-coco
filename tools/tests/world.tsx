// What sits beneath the plugin in these tests: a clock, a store, the environment, the plugin's
// state cell and the few engine answers the plugin waits on. Calls on `$` (settings.read,
// command.register, ...) are answered as `{ value }`; events (session.start, tool.call, ...)
// with their own result. Not shipped: tools/run-tests.py copies these next to a copy of plugin/.

import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ClaudesamaView } from '../types'
import { BOOK_FILES } from './book-files'
import { WINDOWS_ROOTS } from './test-system'

export const MORNING = Date.UTC(2026, 9, 2, 9, 0) // 09:00 in the UTC zone the tests set
export const RECENT = { lastActive: MORNING - 60_000 } // seen a minute ago: no greeting
export const PERSON = { kind: 'composer' as const }
export const P = { isFullscreen: false, columns: 100 }
export const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far.', toolUses: [] }

export type World = {
  sessionRoot?: string
  settings?: Record<string, unknown>
  store?: Record<string, unknown>
  env?: Record<string, string>
  percent?: number | null // null: the engine has no figure (a fresh session, just compacted)
  estimate?: number // what the engine's local breakdown counts, in tokens
  bashFails?: () => boolean
  ask?: boolean
  onTool?: (tool: string) => void
  hold?: (tool: string) => Promise<void> | undefined
  onRender?: (component: string, props: unknown) => void
  theirsRows?: number // rows another mod draws in the band under ours
  limits?: { kind: string; percentUsed: number; resetsAt?: string }[] // the account's rate-limit windows
  cost?: number // the session's cost in US dollars, as /cost totals it
  startedAt?: number // when the session began, as $.session.usage() says (0 when not given)
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
    plugin: 'claudesama',
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking, maxRows, bodyColumns: columns, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
    viewport: { columns, rows: 48 },
  }
}

export function world(on: On, w: World = {}) {
  const clock = mock.clock(on, { now: MORNING })
  mock.store(on, w.store ?? {})
  const env = w.env ?? { LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }
  mock.env(on, WINDOWS_ROOTS && !env.HOME ? { ...env, USERPROFILE: 'C:\\Users\\windows' } : env)
  if (w.sessionRoot || WINDOWS_ROOTS) on('session.root', () => ({ value: w.sessionRoot ?? 'C:\\Users\\windows\\project' }))
  const cells = new Map<string, { value: unknown; version: number }>() // the plugin's state, by key
  const live: {
    percent: number | undefined
    estimate: number | undefined
    fails: boolean
    reads: number
    stateReads: number
    limits: { kind: string; percentUsed: number; resetsAt?: string }[]
    cost: number | undefined
  } = {
    percent: w.percent === null ? undefined : (w.percent ?? 20),
    estimate: w.estimate,
    fails: false,
    reads: 0,
    stateReads: 0,
    limits: w.limits ?? [],
    cost: w.cost,
  }
  const toasts: string[] = []
  const blits: string[] = []
  const opens: { id: string; focus?: true }[] = [] // each $.ui.open, as asked
  const fileReads: string[] = [] // each $.fs.read, by path
  on('state.get', ($, e) => {
    live.stateReads += 1
    const cell = cells.get(e.key)
    return { value: { value: cell?.value, version: cell?.version ?? 0 } } as never
  })
  on('state.set', ($, e) => {
    const version = (cells.get(e.key)?.version ?? 0) + 1
    cells.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('settings.read', () => ({ value: { timeZone: 'UTC', ...(w.settings ?? {}) } }))
  on('session.usage', ($, e) => {
    live.reads += 1
    const figure = live.percent === undefined ? {} : { tokens: 2000 * live.percent, percent: live.percent }
    const breakdown = e?.breakdown && live.estimate !== undefined ? { breakdown: { totalTokens: live.estimate } } : {}
    const cost = live.cost === undefined ? {} : { cost: { usd: live.cost } }
    return { value: { startedAt: w.startedAt ?? 0, context: { window: 200000, ...figure, ...breakdown }, rateLimits: live.limits, ...cost } } as never
  })
  // The asset reads: his book's words as the plugin ships them (book-files.ts, filled by the test
  // runners), and for any other file a real 1x1 PNG whose tEXt chunk names it (build-preview.py
  // swaps the file's own PNG in).
  on('fs.read', ($, e) => {
    fileReads.push(e.path)
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
    opens.push({ id: e.id, ...(e.focus ? { focus: e.focus } : {}) })
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: w.ask ? 'ask' : 'allow' }))
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 138000, tokensAfter: 20000 }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('config.set', ($, e) => ({ value: e.value }))
  on('command.run', () => ({ text: '' })) // a core command (/model, /rewind)
  on('tool.call', async ($, e) => {
    w.onTool?.(e.tool)
    await w.hold?.(e.tool)
    const fails = w.bashFails ? w.bashFails() : live.fails
    return e.tool === 'Bash' && fails ? { isError: true, result: 'exit 1', text: 'Exit code 1' } : { result: { ok: true } }
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
    view: () => {
      const view = cells.get('view')?.value as ClaudesamaView | undefined
      if (!view) throw new Error('the plugin has not drawn a view yet')
      return view
    },
    // For previews: show a moment the clock would otherwise pass through (a blink frame).
    patch: (change: Partial<ClaudesamaView>) => {
      const cell = cells.get('view')
      if (cell?.value) cells.set('view', { value: { ...(cell.value as ClaudesamaView), ...change }, version: cell.version + 1 })
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
    get reads() {
      return live.reads
    },
    get stateReads() {
      return live.stateReads
    },
    // A state value as the plugin last wrote it, by key, with its version.
    cell: (key: string) => cells.get(key),
    set limits(value: { kind: string; percentUsed: number; resetsAt?: string }[]) {
      live.limits = value
    },
  }
}
