// File-stream input is stubbed; every action still passes through register.tsx.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, ProcessSpawnChunk } from 'claude-code'
import { CompanionChannel, notifyChannelEnded } from '../hooks/channel'
import { MORNING, RECENT, stubPng } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const HOME = '/tmp/channel-test'
const FOLDER = `${HOME}/Library/Application Support/Claude-sama`
const REQUESTS = `${FOLDER}/requests.jsonl`
const FEED = `${FOLDER}/view.json`
type Feed = { ack: string | null; channel: boolean; reply: { text: string; at: number } | null; notice: { kind: string; text: string; at: number } | null }
type Request = { v: number; id: string; session: string; at: number; kind: string; text?: string; upto?: number }
const UNLOADED_STATE = '$.state.set refused: no hooks module of that name is loaded, so there is no scan to allow it (host rule)'
function request(n: number, kind: string, change: Partial<Request> = {}): Request {
  return { v: 1, id: n.toString(16).padStart(16, '0'), session: 's1', at: MORNING, kind, ...change }
}
function fixture(on: On, options: { installed?: boolean; missingFile?: boolean; failSpawn?: boolean; actionGate?: Promise<void> } = {}) {
  // world() already owns prompt.submit and command.run; this local world leaves those
  // two engine bottoms to the action spies instead of trying to shadow a generic stub.
  const clock = mock.clock(on, { now: MORNING })
  mock.store(on, RECENT)
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  on('state.get', ($, e) => ({ value: cells.get(e.key) ?? { value: undefined, version: 0 } }) as never)
  on('state.set', ($, e) => { const version = (cells.get(e.key)?.version ?? 0) + 1; cells.set(e.key, { value: e.value, version }); return { value: { isSet: true, version } } })
  on('settings.read', () => ({ value: { timeZone: 'UTC' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [] } }))
  on('fs.read', ($, e) => ({ value: { base64: stubPng(e.path) } }) as never)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: { ok: true } }))
  const w = { clock }
  let installed = options.installed ?? true
  const records: Feed[] = []
  const writes: { path: string; text: string }[] = []
  const submitted: { text: string; asUser?: boolean }[] = []
  const cleared: { command: string; args: string }[] = []
  const spawns: readonly string[][] = []
  const calls: string[][] = spawns as string[][]
  const chunks: { chunk: ProcessSpawnChunk | null; done: () => void }[] = []
  const receipts = new Set<() => void>()
  let wake: (() => void) | undefined
  let closed = false
  let pulls = 0
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/tmp/project' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', ($, e) => ({ value: installed && (e.path === FOLDER || (e.path === REQUESTS && !options.missingFile)) }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    if (e.path === FEED) records.push(JSON.parse(e.text))
    return { value: undefined }
  })
  on('prompt.submit', async ($, e) => { submitted.push({ text: e.text, ...(e.origin.kind === 'plugin' && e.origin.asUser ? { asUser: true } : {}) }); await options.actionGate; return { text: e.text } })
  on('command.run', async ($, e) => { if (e.command === 'clear') { cleared.push({ command: e.command, args: e.args }); await options.actionGate }; return { text: '' } })
  on('classic.Notification', () => ({}))
  on('process.spawn', async function* ($, e) {
    calls.push([...e.argv])
    if (options.failSpawn) throw new Error('cannot start tail')
    try {
      while (true) {
        pulls++
        if (!chunks.length) await new Promise<void>(resolve => { wake = resolve })
        const packet = chunks.shift()
        if (!packet) continue
        if (packet.chunk === null) { packet.done(); receipts.delete(packet.done); return { code: 0, signal: null } }
        yield packet.chunk
        packet.done()
        receipts.delete(packet.done)
      }
    } finally { closed = true; for (const done of receipts) done(); receipts.clear() }
  })
  const drain = async () => { for (let i = 0; i < 240; i++) await Promise.resolve() }
  const enqueue = async (chunk: ProcessSpawnChunk | null) => {
    const receipt = new Promise<void>(resolve => { chunks.push({ chunk, done: resolve }); receipts.add(resolve) })
    wake?.()
    wake = undefined
    await receipt
    await drain()
  }
  return {
    w, records, writes, submitted, cleared, spawns,
    latest: () => records[records.length - 1]!,
    view: () => cells.get('view')?.value,
    installed: (value: boolean) => { installed = value },
    closed: () => closed,
    pulls: () => pulls,
    drain,
    finish: () => enqueue(null),
    emit: (text: string, stream: 'stdout' | 'stderr' = 'stdout') => enqueue({ stream, text }),
    send: (r: Request) => enqueue({ stream: 'stdout', text: `${JSON.stringify(r)}\n` }),
  }
}
function ended(answer = 'Done.') { return { answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const } }

 describe('companion request stream', () => {
  test('completion drops only the unloaded-module state write rejection', async () => {
    for (const message of [UNLOADED_STATE, `environment 2: ${UNLOADED_STATE}`]) {
      await expect(notifyChannelEnded(async () => { throw new Error(message) })).resolves.toBeUndefined()
    }
    const otherErrors = [
      new Error('state write failed'),
      new Error('$.state.set refused: the plugin may not write this key (host rule)'),
      new Error(UNLOADED_STATE.replace('state.set', 'state.get')),
      new Error(UNLOADED_STATE + '; another failure'),
      new Error(UNLOADED_STATE + '\n'),
      new Error(`outer: environment 2: ${UNLOADED_STATE}`),
      new Error(`environment 2: environment 3: ${UNLOADED_STATE}`),
      UNLOADED_STATE,
      'an arbitrary rejection',
    ]
    for (const error of otherErrors) {
      await expect(notifyChannelEnded(async () => { throw error })).rejects.toBe(error)
    }
    let notifications = 0
    await notifyChannelEnded(async () => { notifications++ })
    expect(notifications).toBe(1)
  })

  test('without process.spawn the channel stays false and makes no request file', async () => {
    let running = false
    let checks = 0
    let writes = 0
    let actions = 0
    const channel = new CompanionChannel({
      exists: async () => { checks++; return true },
      write: async () => { writes++ },
      now: async () => MORNING,
      submit: async () => { actions++ },
      clear: async () => { actions++ },
    }, 's1', FOLDER, {
      running: value => { running = value },
      seen: () => { actions++ },
      ack: async () => { actions++ },
      changed: async () => {},
    })
    await channel.start()
    await channel.start()
    expect(running).toBe(false)
    expect(checks).toBe(1)
    expect(writes).toBe(0)
    expect(actions).toBe(0)
  })

  test('no child without the folder; the first unchanged push after installation starts one', async ($, on) => {
    const f = fixture(on, { installed: false, missingFile: true })
    await $.session.start(START)
    await f.drain()
    expect(f.spawns.length).toBe(0)
    expect(f.writes.length).toBe(0)
    const before = f.view()
    expect(before).toBeDefined()
    f.installed(true)
    await $.command.run({ command: 'claudesama', args: 'voice light' })
    expect(f.view()).toEqual(before)
    await f.drain()
    expect(f.spawns).toEqual([['/usr/bin/tail', '-f', '-n', '0', REQUESTS]])
    expect(f.writes.filter(write => write.path === REQUESTS)).toEqual([{ path: REQUESTS, text: '' }])
    expect(f.latest().channel).toBe(true)
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    expect(f.spawns.length).toBe(1)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('chunks form lines; submit, clear and seen act in the own session and acknowledge', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    expect(f.latest().channel).toBe(true)
    const line = `${JSON.stringify(request(1, 'submit', { text: '  Please read this.\n  ' }))}\n`
    await f.emit(line.slice(0, 21))
    expect(f.submitted.length).toBe(0)
    await f.emit(line.slice(21))
    expect(f.submitted).toEqual([{ text: 'Please read this.', asUser: true }])
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await f.send(request(2, 'clear'))
    expect(f.cleared).toEqual([{ command: 'clear', args: '' }])
    expect(f.latest().ack).toBe(request(2, 'clear').id)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ended('A reply.'))
    await $.classic.Notification({ message: 'A notice.', notification_type: 'idle_prompt' })
    await f.send(request(3, 'seen', { upto: MORNING - 1 }))
    expect(f.latest().reply?.text).toBe('A reply.')
    expect(f.latest().notice?.text).toBe('A notice.')
    await f.send(request(4, 'seen', { upto: MORNING }))
    expect(f.latest().reply).toBe(null)
    expect(f.latest().notice).toBe(null)
    expect(f.latest().ack).toBe(request(4, 'seen').id)
    await $.turn.start({ text: 'go', turnId: 't2' })
    expect(f.latest().ack).toBe(request(4, 'seen').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('invalid lines are silent and do not consume a valid request id', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    const invalid = [
      '{broken json',
      JSON.stringify(request(1, 'submit', { session: 'other', text: 'bad' })),
      JSON.stringify(request(2, 'unknown')),
      JSON.stringify(request(3, 'submit', { at: MORNING - 60_001, text: 'bad' })),
      JSON.stringify(request(4, 'submit', { at: MORNING + 60_001, text: 'bad' })),
      JSON.stringify(request(5, 'submit', { v: 2, text: 'bad' })),
      JSON.stringify(request(6, 'submit', { id: 'not-a-valid-id', text: 'bad' })),
      JSON.stringify(request(7, 'submit', { text: 'x'.repeat(4001) })),
      JSON.stringify(request(8, 'submit', { text: 'bad\0text' })),
      JSON.stringify(request(9, 'submit', { text: ' \n ' })),
      JSON.stringify(request(10, 'submit', { text: 'ok' })).slice(0, -1) + ',"unused":"' + 'x'.repeat(8192) + '"}',
    ]
    await f.emit(invalid.join('\n') + '\n')
    expect(f.submitted.length).toBe(0)
    expect(f.cleared.length).toBe(0)
    expect(f.latest().ack).toBe(null)
    await f.send(request(1, 'submit', { text: 'accepted' }))
    expect(f.submitted).toEqual([{ text: 'accepted', asUser: true }])
    await f.send(request(1, 'submit', { text: 'reused' }))
    expect(f.submitted.length).toBe(1)
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('submit and clear spacing are independent and enforce their exact boundaries', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    await f.send(request(1, 'submit', { text: 'first' }))
    await f.send(request(2, 'submit', { text: 'too soon' }))
    await f.send(request(3, 'clear'))
    await f.send(request(4, 'clear'))
    expect(f.submitted.length).toBe(1)
    expect(f.cleared.length).toBe(1)
    await f.w.clock.advance(1999)
    await f.send(request(5, 'submit', { at: MORNING + 1999, text: 'still too soon' }))
    expect(f.submitted.length).toBe(1)
    await f.w.clock.advance(1)
    await f.send(request(6, 'submit', { at: MORNING + 2000, text: 'at boundary' }))
    expect(f.submitted.length).toBe(2)
    await f.w.clock.advance(7999)
    await f.send(request(7, 'clear', { at: MORNING + 9999 }))
    expect(f.cleared.length).toBe(1)
    await f.w.clock.advance(1)
    await f.send(request(8, 'clear', { at: MORNING + 10000 }))
    expect(f.cleared.length).toBe(2)
    expect(f.latest().ack).toBe(request(8, 'clear').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('thirty submits in a rolling hour; every still-fresh identity is remembered', { timeoutMs: 60_000 }, async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    for (let n = 1; n <= 30; n++) {
      if (n > 1) await f.w.clock.advance(2000)
      await f.send(request(n, 'submit', { at: MORNING + (n - 1) * 2000, text: `message ${n}` }))
    }
    expect(f.submitted.length).toBe(30)
    await f.w.clock.advance(2000)
    await f.send(request(31, 'submit', { at: MORNING + 60000, text: 'hour limit' }))
    expect(f.submitted.length).toBe(30)
    for (let n = 32; n <= 64; n++) await f.send(request(n, 'seen', { at: MORNING + 60000, upto: MORNING + 60000 }))
    const writes = f.records.length
    await f.send(request(1, 'seen', { at: MORNING + 60000, upto: MORNING + 60000 }))
    expect(f.records.length).toBe(writes)
    await f.send(request(1, 'submit', { text: 'message 1' }))
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    expect(f.submitted.length).toBe(30)
    await f.w.clock.advance(3_540_001)
    await f.send(request(65, 'submit', { at: MORNING + 3_600_001, text: 'next hour' }))
    expect(f.submitted.length).toBe(31)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('identical submit and New chat retries republish confirmation without another action', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    for (const kind of ['submit', 'clear']) {
      const original = request(kind === 'submit' ? 101 : 102, kind, { text: kind === 'submit' ? 'once only' : undefined })
      await f.send(original)
      const writes = f.records.length
      await f.w.clock.advance(5000)
      await f.send(original)
      expect(f.records.length).toBe(writes + 1)
      expect(f.latest().ack).toBe(original.id)
    }
    expect(f.submitted.length).toBe(1)
    expect(f.cleared.length).toBe(1)
    await f.finish()
  })

  test('a delayed action and its buffered retry execute once after the five-second wait', async ($, on) => {
    let finish!: () => void
    const actionGate = new Promise<void>(resolve => { finish = resolve })
    const f = fixture(on, { actionGate })
    await $.session.start(START)
    await f.drain()
    const original = request(101, 'submit', { text: 'slow engine' })
    const first = f.send(original)
    await f.drain()
    await f.w.clock.advance(5001)
    const retry = f.send(original)
    await f.drain()
    expect(f.submitted.length).toBe(1)
    expect(f.latest().ack).toBe(null)
    finish()
    await first
    await retry
    expect(f.submitted.length).toBe(1)
    expect(f.records.filter(record => record.ack === original.id).length).toBe(2)
    await f.finish()
  })

  test('more than thirty-two seen markers never evict a live submit or New chat identity', { timeoutMs: 60_000 }, async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    const submit = request(101, 'submit', { text: 'keep my identity' })
    const clear = request(102, 'clear')
    await f.send(submit)
    await f.send(clear)
    for (let n = 200; n < 240; n++) await f.send(request(n, 'seen', { upto: MORNING }))
    await f.w.clock.advance(10000)
    await f.send(submit)
    await f.send(clear)
    expect(f.submitted.length).toBe(1)
    expect(f.cleared.length).toBe(1)
    const writes = f.records.length
    await f.send({ ...submit, text: 'different payload' })
    await f.send({ ...clear, at: MORNING + 10000 })
    expect(f.records.length).toBe(writes)
    await f.finish()
  })

  test('throwing engine actions stay uncertain; throwing acknowledgements can be retried safely', async () => {
    for (const kind of ['submit', 'clear']) for (const actionThrows of [false, true]) {
      let actions = 0, acknowledgements = 0
      let ended!: () => void
      const done = new Promise<void>(resolve => { ended = resolve })
      const original = request(101, kind, { text: kind === 'submit' ? 'only once' : undefined })
      const child = async function* () {
        for (let n = 0; n < 2; n++) yield { stream: 'stdout' as const, text: JSON.stringify(original) + '\n' }
        return { code: 0, signal: null }
      }
      const action = async () => { actions++; if (actionThrows) throw new Error('possibly handled before throwing') }
      const channel = new CompanionChannel({
        exists: async () => true, write: async () => {}, now: async () => MORNING,
        spawn: () => child() as never, submit: action, clear: action,
      }, 's1', FOLDER, {
        running: () => {}, seen: () => {}, changed: async () => { ended() },
        ack: async () => { acknowledgements++; if (acknowledgements === 1) throw new Error('lost ack') },
      })
      await channel.start()
      await done
      expect(actions).toBe(1)
      expect(acknowledgements).toBe(actionThrows ? 0 : 2)
    }
  })

  test('the original expiry boundary is checked again immediately before an engine action', async () => {
    for (const age of [60000, 60001]) {
      let reads = 0, actions = 0, acknowledgements = 0
      let ended!: () => void
      const done = new Promise<void>(resolve => { ended = resolve })
      const child = async function* () {
        yield { stream: 'stdout' as const, text: JSON.stringify(request(101, 'clear')) + '\n' }
        return { code: 0, signal: null }
      }
      const channel = new CompanionChannel({
        exists: async () => true, write: async () => {}, now: async () => MORNING + (reads++ === 0 ? 0 : age),
        spawn: () => child() as never, submit: async () => {}, clear: async () => { actions++ },
      }, 's1', FOLDER, {
        running: () => {}, seen: () => {}, ack: async () => { acknowledgements++ }, changed: async () => { ended() },
      })
      await channel.start()
      await done
      expect(actions).toBe(age === 60000 ? 1 : 0)
      expect(acknowledgements).toBe(actions)
    }
  })

  test('stopping while the action clock is being read cannot revive a buffered request', async () => {
    let reads = 0, actions = 0
    let ended!: () => void
    const done = new Promise<void>(resolve => { ended = resolve })
    const child = async function* () {
      yield { stream: 'stdout' as const, text: JSON.stringify(request(101, 'clear')) + '\n' }
      return { code: 0, signal: null }
    }
    const channel = new CompanionChannel({
      exists: async () => true, write: async () => {},
      now: async () => { if (++reads === 2) channel.stop(); return MORNING },
      spawn: () => child() as never, submit: async () => {}, clear: async () => { actions++ },
    }, 's1', FOLDER, {
      running: () => {}, seen: () => {}, ack: async () => { actions++ }, changed: async () => { ended() },
    })
    await channel.start()
    await done
    expect(actions).toBe(0)
  })

  test('folder removal ends the child on the next push and rejects further input', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    f.installed(false)
    const before = f.writes.length
    await $.turn.start({ text: 'go', turnId: 't1' })
    // Wake a blocked pull: leaving the watcher must release its stream too.
    await f.emit(`${JSON.stringify(request(1, 'submit', { text: 'after uninstall' }))}\n`)
    expect(f.closed()).toBe(true)
    expect(f.submitted.length).toBe(0)
    expect(f.writes.length).toBe(before)
  })

  test('a child ending naturally writes channel false and never restarts', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    expect(f.latest().channel).toBe(true)
    await f.finish()
    expect(f.closed()).toBe(true)
    expect(f.latest().channel).toBe(false)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await f.drain()
    expect(f.spawns.length).toBe(1)
    expect(f.latest().channel).toBe(false)
  })

  test('unloading the module with an open tail leaves no unhandled completion rejection', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.drain()
    expect(f.latest().channel).toBe(true)
    expect(f.closed()).toBe(false)
    expect(f.pulls()).toBeGreaterThan(0)
    // The kit unloads this environment when the body returns. Deliberately leave
    // its tail open: the runner's file-end check must find no unhandled rejection.
  })

  test('a spawn failure stays false with no retry on later pushes', async ($, on) => {
    const f = fixture(on, { failSpawn: true })
    await $.session.start(START)
    await f.drain()
    expect(f.latest().channel).toBe(false)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    await f.drain()
    expect(f.latest().channel).toBe(false)
    expect(f.spawns.length).toBe(1)
  })
})
