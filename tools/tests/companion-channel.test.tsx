import { drainFeed } from './feed-drain'
import { samePath } from './file-paths'
// Engine fixtures exercise register.tsx; pure fixtures queue local notes without engine authority.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, ProcessSpawnChunk } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { CompanionChannel, notifyChannelEnded } from '../hooks/channel'
import type { ChannelNote } from '../hooks/channel'
import { MORNING, RECENT, stubPng } from './world'
import { atomicFeed, PROCESS_OK } from './shared-world'
import { transportFixture } from './presence-transport-fixture'
import { M1_MORE_TEXT } from './m1-more-data-fixture'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const HOME = '/tmp/channel-test'
const FOLDER = `${HOME}/Library/Application Support/Coco`
const REQUESTS = `${FOLDER}/requests.jsonl`
const FEED = `${FOLDER}/view.json`
type Feed = { ack: string | null; channel: boolean; reply: { text: string; at: number } | null; notice: { kind: string; text: string; at: number } | null }
type Request = { v: number; id: string; session: string; at: number; kind: string; text?: string; upto?: number }
const UNLOADED_STATE = '$.state.set refused: no hooks module of that name is loaded, so there is no scan to allow it (host rule)'
function request(n: number, kind: string, change: Partial<Request> = {}): Request {
  return { v: 1, id: n.toString(16).padStart(16, '0'), session: 's1', at: MORNING, kind, ...change }
}
function fixture(on: On, options: { guard?: boolean; installed?: boolean; missingFile?: boolean; failSpawn?: boolean; actionGate?: Promise<void>; voice?: 'off' | 'light' | 'full'; moreText?: boolean } = {}) {
  // Native-positive fixtures explicitly emulate the retained development helper.
  // world() already owns prompt.submit and command.run; this local world leaves those
  // two engine bottoms to the action spies instead of trying to shadow a generic stub.
  const clock = mock.clock(on, { now: MORNING })
  mock.store(on, {...RECENT,more:{lively:true},bandSettings:{...(options.voice ? {voice:options.voice,voiceChosen:true} : {}),more:{lively:true}}})
  mock.env(on, { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' })
  const cells = new Map<string, { value: unknown; version: number }>()
  on('state.get', ($, e) => ({ value: cells.get(e.key) ?? { value: undefined, version: 0 } }) as never)
  on('state.set', ($, e) => { const version = (cells.get(e.key)?.version ?? 0) + 1; cells.set(e.key, { value: e.value, version }); return { value: { isSet: true, version } } })
  on('settings.read', () => ({ value: { timeZone: 'UTC' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 40000, percent: 20 }, rateLimits: [] } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: { ok: true } }))
  const w = { clock }
  const transport = transportFixture({v:1,seq:0,quietAt:MORNING,asleep:false,clingy:false,busy:false,event:{kind:'initial',id:`initial:0:${MORNING}`,at:MORNING,lang:'en'}})
  let installed = options.installed ?? true
  const records: Feed[] = []
  const writes: { path: string; text: string }[] = []
  const submitted: { text: string; asUser?: boolean }[] = []
  const cleared: { command: string; args: string }[] = []
  const guardCalls: string[][] = []
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
  on('fs.exists', ($, e) => ({ value: /[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.path) ? options.guard !== false : samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || samePath(e.path, '/bin/sh') || installed && (samePath(e.path, FOLDER) || (samePath(e.path, REQUESTS) && !options.missingFile)) }))
  on('fs.read', ($,e) => ({value:e.path.endsWith('/snapshot.json')?JSON.stringify(transport.state):options.moreText&&e.path.endsWith('/more-text.json')?M1_MORE_TEXT:{base64:stubPng(e.path)}}) as never)
  on('fs.write', async ($, e) => {
    if(e.path.endsWith('/commit'))throw new Error('unsafe direct SDK commit write')
    writes.push({ path: samePath(e.path, REQUESTS) ? REQUESTS : samePath(e.path, FEED) ? FEED : e.path, text: e.text })
    if (samePath(e.path, FEED)) records.push(JSON.parse(e.text))
    return { value: undefined }
  })
  let requestExists = !options.missingFile
  on('process.run', async ($, e) => {
    if(e.argv[3]==='write'){await transport.write(e.argv[5]!,e.init?.stdin??'');return{value:PROCESS_OK}}
    if (/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.argv[0] ?? '')) {
      guardCalls.push([...e.argv])
      // The fixture delivers request packets through shared presence. Refusing
      // the classic watch baseline selects that existing shared-reader fallback.
      const answer = e.argv[1] === '--ensure-requests' ? { ensured: true }
        : e.argv[1] === '--read-requests' ? { read: false } : { claimed: false }
      return { value: { ...PROCESS_OK, stdout: JSON.stringify(answer) } }
    }
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) {
      writes.push({ path: feed.path, text: feed.text })
      if (samePath(feed.path, FEED)) records.push(JSON.parse(feed.text))
    } else if (e.argv[0] === '/usr/bin/touch' && samePath(e.argv[1] ?? '', REQUESTS) && !requestExists) {
      writes.push({ path: REQUESTS, text: '' })
      requestExists = true
    }
    return { value: PROCESS_OK }
  })
  on('prompt.submit', async ($, e) => { submitted.push({ text: e.text, ...(e.origin.kind === 'plugin' && e.origin.asUser ? { asUser: true } : {}) }); await options.actionGate; return { text: e.text } })
  on('command.run', async ($, e) => { if (e.command === 'clear') { cleared.push({ command: e.command, args: e.args }); await options.actionGate }; return { text: '' } })
  on('classic.Notification', () => ({}))
  on('process.spawn', async function* ($, e) {
    if(e.argv[3]==='transaction'||e.argv[3]==='fifo-send'){
      const child=transport.spawn('s1',[...e.argv])
      try{for(;;){const packet=await child.next();if(packet.done)return{value:packet.value};yield packet.value}}
      finally{await child.return({code:0,signal:null})}
    }
    calls.push([...e.argv])
    if (options.failSpawn) throw new Error('cannot start tail')
    const child=transport.spawn('s1',[...e.argv])
    void (async()=>{for(;;){const packet=await child.next();if(packet.done)break;chunks.push({chunk:packet.value,done:()=>{}});wake?.();wake=undefined}})()
    try {
      while (true) {
        pulls++
        if (!chunks.length) await new Promise<void>(resolve => { wake = resolve })
        const packet = chunks.shift()
        if (!packet) continue
        if (packet.chunk === null) { packet.done(); receipts.delete(packet.done); return { value: { code: 0, signal: null } } }
        yield packet.chunk
        packet.done()
        receipts.delete(packet.done)
      }
    } finally { closed = true; await child.return({code:0,signal:null}); for (const done of receipts) done(); receipts.clear() }
  })
  const drain = async () => { for (let i = 0; i < 240; i++) await Promise.resolve() }
  const enqueue = async (chunk: ProcessSpawnChunk | null) => {
    const receipt = new Promise<void>(resolve => { chunks.push({ chunk, done: resolve }); receipts.add(resolve) })
    wake?.()
    wake = undefined
    await receipt
    await drain()
  }
  let partialRequest=false
  const emit=async(text:string,stream:'stdout'|'stderr'='stdout')=>{
    const framed=stream==='stdout'&&!partialRequest?`\n==> ${REQUESTS} <==\n${text}`:text
    if(stream==='stdout')partialRequest=!text.endsWith('\n')
    await enqueue({stream,text:framed})
  }
  return {
    w, records, writes, submitted, cleared, spawns, guardCalls,
    latest: () => records[records.length - 1]!,
    view: () => cells.get('view')?.value,
    installed: (value: boolean) => { installed = value },
    closed: () => closed,
    pulls: () => pulls,
    drain,
    finish: () => enqueue(null),
    emit,
    send: (r: Request) => emit(`${JSON.stringify(r)}\n`),
  }
}
// Owner S1 finding #2: journal delivery queues a local note only. The event
// adapter maintains the callback feed for the unchanged transport/seen checks.
function noteFixture(options: { actionGate?: Promise<void> } = {}) {
  let now = MORNING
  let closed = false
  let receive: ((text: string) => Promise<void>) | undefined
  let end: (() => void) | undefined
  let serial = Promise.resolve()
  const records: Feed[] = []
  const submitted: { text: string; asUser?: boolean }[] = []
  const cleared: { command: string; args: string }[] = []
  const notes: { text: string }[] = []
  const received: ChannelNote[] = []
  const authorized: string[] = []
  const feed: Feed = { ack: null, channel: false, reply: null, notice: null }
  const publish = () => { records.push({ ...feed, reply: feed.reply && { ...feed.reply }, notice: feed.notice && { ...feed.notice } }) }
  const drain = async () => { for (let i = 0; i < 240; i++) await Promise.resolve() }
  const channel = new CompanionChannel({
    exists: async () => true,
    now: async () => now,
    authorize: async () => { authorized.push('authorize'); return true },
    listen: (input, ended) => { receive = input; end = ended; return () => { closed = true; receive = undefined } },
    submit: async text => { submitted.push({ text, asUser: true }); await options.actionGate },
    clear: async () => { cleared.push({ command: 'clear', args: '' }); await options.actionGate },
  }, 's1', FOLDER, {
    note: async note => { received.push(note); notes.push({ text: note.text }); await options.actionGate },
    running: value => { feed.channel = value; publish() },
    ack: async id => { feed.ack = id; publish() },
    seen: upto => {
      if (feed.reply && feed.reply.at <= upto) feed.reply = null
      if (feed.notice && feed.notice.at <= upto) feed.notice = null
    },
    changed: async () => {},
  })
  const events = {
    session: { start: async () => { await channel.start() } },
    command: { run: async () => { await Promise.resolve() } },
    turn: {
      start: async () => {},
      complete: async (event: { answer: string }) => { feed.reply = { text: event.answer, at: now }; publish() },
    },
    classic: { Notification: async (event: { message: string; notification_type: string }) => {
      feed.notice = { kind: event.notification_type, text: event.message, at: now }; publish()
    } },
  } as unknown as Engine
  const emit = (text: string) => {
    serial = serial.then(async () => { if (receive) await receive(text) })
    return serial.then(drain)
  }
  return {
    events, records, submitted, cleared, notes, received, authorized, drain,
    w: { clock: { advance: async (ms: number) => { now += ms; await drain() } } },
    latest: () => records[records.length - 1]!,
    emit,
    send: (r: Request) => emit(`${JSON.stringify(r)}\n`),
    finish: async () => { await serial; end?.(); await drain(); expect(submitted).toEqual([]); expect(cleared).toEqual([]); expect(authorized).toEqual([]) },
    closed: () => closed,
  }
}
function ended(answer = 'Done.') { return { answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const } }

 describe('companion request stream (local notes; no journal engine authority)', () => {
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

  test('absent deferred helper ignores requests and attempts no guard execution', async ($, on) => {
    const f = fixture(on, { guard: false })
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($); await drainFeed($); await f.drain()
    // Without the state helper the channel is main's, on the presence follower (the denial needs it; lead, 10-10):
    // it runs, and still never runs the guard, submits or clears.
    expect(f.latest().channel).toBe(true)
    await f.send(request(1, 'submit', { text: 'ignored' }))
    await f.send(request(2, 'clear'))
    expect(f.guardCalls).toEqual([])
    expect(f.submitted).toEqual([])
    expect(f.cleared).toEqual([])
    expect(f.latest().channel).toBe(true)
    await f.finish()
  })

  test('one shared follower before companion installation; first unchanged push enables requests without another child', async ($, on) => {
    const f = fixture(on, { installed: false, missingFile: true, voice: 'light' })
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    expect(f.spawns.length).toBe(1)
    expect(f.writes.length).toBe(0)
    await $.command.run({ command: 'coco', args: 'voice light' })
    expect(f.writes.length).toBe(0)
    expect(f.spawns.length).toBe(1)
    const before = f.view()
    expect(before).toBeDefined()
    f.installed(true)
    await $.command.run({ command: 'coco', args: 'voice light' })
    expect(f.view()).toEqual(before)
    await drainFeed($)
    await f.drain()
    expect(f.spawns.length).toBe(1)
    expect(f.spawns[0]?.[3]).toBe('follow')
    expect(f.spawns[0]?.[5]).toBe(REQUESTS)
    expect(f.writes.filter(write => samePath(write.path, REQUESTS))).toEqual([])
    expect(f.latest().channel).toBe(true)
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    await drainFeed($)
    expect(f.spawns.length).toBe(1)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('integrated journal input never submits or clears while seen remains permitted', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($); await drainFeed($); await f.drain()
    expect(f.latest().channel).toBe(true)
    const line = `${JSON.stringify(request(1, 'submit', { text: '  Please read this.\n  ' }))}\n`
    await f.emit(line.slice(0, 21))
    expect(f.submitted).toEqual([])
    await f.emit(line.slice(21))
    await f.send(request(2, 'clear'))
    expect(f.submitted).toEqual([])
    expect(f.cleared).toEqual([])
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    await $.turn.complete(ended('A reply.'))
    await drainFeed($)
    await $.classic.Notification({ message: 'A notice.', notification_type: 'idle_prompt' })
    await drainFeed($)
    await f.send(request(3, 'seen', { upto: MORNING - 1 }))
    expect(f.latest().reply?.text).toBe('A reply.')
    expect(f.latest().notice?.text).toBe('A notice.')
    expect(f.latest().ack).toBe(request(3, 'seen').id)
    await f.send(request(4, 'seen', { upto: MORNING }))
    expect(f.latest().reply).toBe(null)
    expect(f.latest().notice).toBe(null)
    expect(f.latest().ack).toBe(request(4, 'seen').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('a desktop window attaching keeps the session\'s channel: the pet\'s note still gets its receipt', async ($, on) => {
    const f = fixture(on, { moreText: true })
    on('session.attach', ($, e) => ({ clientId: e.clientId }))
    await $.session.start({ ...START, surface: 'desktop' })
    await f.w.clock.advance(0)
    await drainFeed($); await drainFeed($); await f.drain()
    expect(f.latest().channel).toBe(true)
    await $.session.attach({ clientId: 'window', surface: 'desktop' })
    await f.w.clock.advance(0)
    await drainFeed($); await f.drain()
    await f.send(request(1, 'submit', { text: 'Please read this.' }))
    await f.w.clock.advance(0); await drainFeed($); await f.drain()
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    expect((f.view() as { line?: { key?: string; text?: string } } | undefined)?.line).toMatchObject({ key: 'letter.in', text: 'Please read this.' })
    await f.finish()
  })

  test('a forged valid journal identity creates one local note and never acts as the person', async () => {
    const f = noteFixture()
    await f.events.session.start(START)
    const forged = request(101, 'submit', { text: '  Written by another window.  ' })
    await f.send(forged)
    await f.send(forged)
    await f.send({ ...forged, text: 'changed payload' })
    await f.send(request(102, 'clear'))
    expect(f.received).toEqual([{ id: forged.id, at: forged.at, text: 'Written by another window.' }])
    expect(f.submitted).toEqual([])
    expect(f.cleared).toEqual([])
    expect(f.authorized).toEqual([])
    expect(f.records.filter(record => record.ack === forged.id)).toHaveLength(2)
    await f.finish()
  })

  test('chunks form lines; notes acknowledge receipts, clear is rejected and seen remains local', async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    expect(f.latest().channel).toBe(true)
    const line = `${JSON.stringify(request(1, 'submit', { text: '  Please read this.\n  ' }))}\n`
    await f.emit(line.slice(0, 21))
    expect(f.notes.length).toBe(0)
    await f.emit(line.slice(21))
    expect(f.notes).toEqual([{ text: 'Please read this.' }])
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await f.send(request(2, 'clear'))
    expect(f.cleared).toEqual([])
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    await $.turn.complete(ended('A reply.'))
    await drainFeed($)
    await $.classic.Notification({ message: 'A notice.', notification_type: 'idle_prompt' })
    await drainFeed($)
    await f.send(request(3, 'seen', { upto: MORNING - 1 }))
    expect(f.latest().reply?.text).toBe('A reply.')
    expect(f.latest().notice?.text).toBe('A notice.')
    await f.send(request(4, 'seen', { upto: MORNING }))
    expect(f.latest().reply).toBe(null)
    expect(f.latest().notice).toBe(null)
    expect(f.latest().ack).toBe(request(4, 'seen').id)
    await $.turn.start({ text: 'go', turnId: 't2' })
    await drainFeed($)
    expect(f.latest().ack).toBe(request(4, 'seen').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('invalid lines are silent and do not consume a valid request id', async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
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
    expect(f.notes.length).toBe(0)
    expect(f.cleared.length).toBe(0)
    expect(f.latest().ack).toBe(null)
    await f.send(request(1, 'submit', { text: 'accepted' }))
    expect(f.notes).toEqual([{ text: 'accepted' }])
    await f.send(request(1, 'submit', { text: 'reused' }))
    expect(f.notes.length).toBe(1)
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('note receipt spacing enforces exact boundaries and clear is always rejected', async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    await f.send(request(1, 'submit', { text: 'first' }))
    await f.send(request(2, 'submit', { text: 'too soon' }))
    await f.send(request(3, 'clear'))
    await f.send(request(4, 'clear'))
    expect(f.notes.length).toBe(1)
    expect(f.cleared.length).toBe(0)
    await f.w.clock.advance(1999)
    await f.send(request(5, 'submit', { at: MORNING + 1999, text: 'still too soon' }))
    expect(f.notes.length).toBe(1)
    await f.w.clock.advance(1)
    await f.send(request(6, 'submit', { at: MORNING + 2000, text: 'at boundary' }))
    expect(f.notes.length).toBe(2)
    await f.w.clock.advance(7999)
    await f.send(request(7, 'clear', { at: MORNING + 9999 }))
    expect(f.cleared.length).toBe(0)
    await f.w.clock.advance(1)
    await f.send(request(8, 'clear', { at: MORNING + 10000 }))
    expect(f.cleared.length).toBe(0)
    expect(f.latest().ack).toBe(request(6, 'submit').id)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('thirty note receipts in a rolling hour; every still-fresh identity is remembered', { timeoutMs: 60_000 }, async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    for (let n = 1; n <= 30; n++) {
      if (n > 1) await f.w.clock.advance(2000)
      await f.send(request(n, 'submit', { at: MORNING + (n - 1) * 2000, text: `message ${n}` }))
    }
    expect(f.notes.length).toBe(30)
    await f.w.clock.advance(2000)
    await f.send(request(31, 'submit', { at: MORNING + 60000, text: 'hour limit' }))
    expect(f.notes.length).toBe(30)
    for (let n = 32; n <= 64; n++) await f.send(request(n, 'seen', { at: MORNING + 60000, upto: MORNING + 60000 }))
    const writes = f.records.length
    await f.send(request(1, 'seen', { at: MORNING + 60000, upto: MORNING + 60000 }))
    expect(f.records.length).toBe(writes)
    await f.send(request(1, 'submit', { text: 'message 1' }))
    expect(f.latest().ack).toBe(request(1, 'submit').id)
    expect(f.notes.length).toBe(30)
    await f.w.clock.advance(3_540_001)
    await f.send(request(65, 'submit', { at: MORNING + 3_600_001, text: 'next hour' }))
    expect(f.notes.length).toBe(31)
    await f.finish()
    expect(f.closed()).toBe(true)
  })

  test('identical note retries republish receipt while repeated clear stays rejected', async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    for (const kind of ['submit', 'clear']) {
      const original = request(kind === 'submit' ? 101 : 102, kind, { text: kind === 'submit' ? 'once only' : undefined })
      await f.send(original)
      const writes = f.records.length
      await f.w.clock.advance(5000)
      await f.send(original)
      expect(f.records.length).toBe(writes + (kind === 'submit' ? 1 : 0))
      expect(f.latest().ack).toBe(request(101, 'submit').id)
    }
    expect(f.notes.length).toBe(1)
    expect(f.cleared.length).toBe(0)
    await f.finish()
  })

  test('a delayed note callback and its buffered retry queue once after the five-second wait', async () => {
    let finish!: () => void
    const actionGate = new Promise<void>(resolve => { finish = resolve })
    const f = noteFixture({ actionGate })
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    const original = request(101, 'submit', { text: 'slow engine' })
    const first = f.send(original)
    await f.drain()
    await f.w.clock.advance(5001)
    const retry = f.send(original)
    await f.drain()
    expect(f.notes.length).toBe(1)
    expect(f.latest().ack).toBe(null)
    finish()
    await first
    await retry
    expect(f.notes.length).toBe(1)
    expect(f.records.filter(record => record.ack === original.id).length).toBe(2)
    await f.finish()
  })

  test('more than thirty-two seen markers never evict a live note identity while clear stays rejected', { timeoutMs: 60_000 }, async () => {
    const f = noteFixture()
    const $ = f.events
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    const submit = request(101, 'submit', { text: 'keep my identity' })
    const clear = request(102, 'clear')
    await f.send(submit)
    await f.send(clear)
    for (let n = 200; n < 240; n++) await f.send(request(n, 'seen', { upto: MORNING }))
    await f.w.clock.advance(10000)
    await f.send(submit)
    await f.send(clear)
    expect(f.notes.length).toBe(1)
    expect(f.cleared.length).toBe(0)
    const writes = f.records.length
    await f.send({ ...submit, text: 'different payload' })
    await f.send({ ...clear, at: MORNING + 10000 })
    expect(f.records.length).toBe(writes)
    await f.finish()
  })

  test('throwing note callbacks stay uncertain; throwing acknowledgements can be retried safely', async () => {
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
        authorize: async () => { throw new Error('journal authorization forbidden') }, spawn: () => child() as never, submit: async () => { throw new Error('journal submit forbidden') }, clear: async () => { throw new Error('journal clear forbidden') },
      }, 's1', FOLDER, {
        note: action, running: () => {}, seen: () => {}, changed: async () => { ended() },
        ack: async () => { acknowledgements++; if (acknowledgements === 1) throw new Error('lost ack') },
      })
      await channel.start()
      await done
      expect(actions).toBe(kind === 'submit' ? 1 : 0)
      expect(acknowledgements).toBe(kind === 'submit' && !actionThrows ? 2 : 0)
    }
  })

  test('the original expiry boundary is checked again immediately before queueing a note', async () => {
    for (const age of [60000, 60001]) {
      let reads = 0, actions = 0, acknowledgements = 0
      let ended!: () => void
      const done = new Promise<void>(resolve => { ended = resolve })
      const child = async function* () {
        yield { stream: 'stdout' as const, text: JSON.stringify(request(101, 'submit', { text: 'only a note' })) + '\n' }
        return { code: 0, signal: null }
      }
      const channel = new CompanionChannel({
        exists: async () => true, write: async () => {}, now: async () => MORNING + (reads++ === 0 ? 0 : age),
        authorize: async () => true, spawn: () => child() as never, submit: async () => {}, clear: async () => { actions++ },
      }, 's1', FOLDER, {
        note: () => { actions++ }, running: () => {}, seen: () => {}, ack: async () => { acknowledgements++ }, changed: async () => { ended() },
      })
      await channel.start()
      await done
      expect(actions).toBe(age === 60000 ? 1 : 0)
      expect(acknowledgements).toBe(actions)
    }
  })

  test('stopping while the receipt clock is being read cannot revive a buffered note', async () => {
    let reads = 0, actions = 0
    let ended!: () => void
    const done = new Promise<void>(resolve => { ended = resolve })
    const child = async function* () {
      yield { stream: 'stdout' as const, text: JSON.stringify(request(101, 'submit', { text: 'only a note' })) + '\n' }
      return { code: 0, signal: null }
    }
    const channel = new CompanionChannel({
      exists: async () => true, write: async () => {},
      now: async () => { if (++reads === 2) channel.stop(); return MORNING },
      authorize: async () => true, spawn: () => child() as never, submit: async () => {}, clear: async () => { actions++ },
    }, 's1', FOLDER, {
      note: () => { actions++ }, running: () => {}, seen: () => {}, ack: async () => { actions++ }, changed: async () => { ended() },
    })
    await channel.start()
    await done
    expect(actions).toBe(0)
  })

  test('folder removal stops requests while retaining the shared follower and rejects further input', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    f.installed(false)
    const before = f.writes.length
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    // Wake a blocked pull: leaving the watcher must release its stream too.
    await f.emit(`${JSON.stringify(request(1, 'submit', { text: 'after uninstall' }))}\n`)
    expect(f.closed()).toBe(false)
    expect(f.spawns.length).toBe(1)
    expect(f.submitted.length).toBe(0)
    expect(f.writes.length).toBe(before)
  })

  test('a child ending naturally writes channel false and never restarts', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    expect(f.latest().channel).toBe(true)
    await f.finish()
    await drainFeed($)
    expect(f.closed()).toBe(true)
    await drainFeed($)
    expect(f.latest().channel).toBe(false)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    await f.drain()
    expect(f.spawns.length).toBe(1)
    expect(f.latest().channel).toBe(false)
  })

  test('unloading the module with an open tail leaves no unhandled completion rejection', async ($, on) => {
    const f = fixture(on)
    await $.session.start(START)
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
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
    await f.w.clock.advance(0)
    await drainFeed($)
    await drainFeed($)
    await f.drain()
    expect(f.latest().channel).toBe(false)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await drainFeed($)
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
    await drainFeed($)
    await f.drain()
    expect(f.latest().channel).toBe(false)
    expect(f.spawns.length).toBe(1)
  })
})
