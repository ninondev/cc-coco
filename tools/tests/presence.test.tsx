// Multiple transport/controllers, independent session clocks/callbacks, one fake shared folder.
import { describe, expect, test } from 'claude-code/testing'
import type { PresenceIO, PresenceSnapshot } from '../hooks/presence'
import { parsePresence, parsePresenceRecord, parseProcessInventory, SharedPresence, presenceSessions } from '../hooks/presence'
import { MORNING } from './world'
import { initialView, pick, sharedLineFor, TIMING } from '../hooks/mood'
import { LINES } from '../hooks/lines'
import { LANGS } from '../hooks/words'
import type { Lang } from '../hooks/words'
import { snapshot } from './presence-world'
import { transportFixture } from './presence-transport-fixture'

const FOLDER = '/tmp/one-shared-presence'
const SCRIPT = '/plugin/bin/presence.sh'
const drain = async () => { for (let i = 0; i < 400; i++) await Promise.resolve() }
function sharedFolder(initial: PresenceSnapshot = snapshot()) {
  let now = MORNING
  const transport = transportFixture(initial)
  const callbacks = new Map<string, PresenceSnapshot[]>()
  const controllers = new Map<string, SharedPresence>()
  const timers: { session: string; at: number; callback: () => void; active: boolean }[] = []
  const errors: unknown[] = []
  let ioCalls = 0
  let transactions = 0
  const spawned: string[][] = []
  function create(session: string, folder = FOLDER, language: Lang = 'en', metadata: { cwd?: string; version?: string } = {}, quietEnabled?:()=>boolean, script = SCRIPT) {
    const seen: PresenceSnapshot[] = []
    callbacks.set(session, seen)
    const io: PresenceIO = {
      now: async () => now,
      read: async path => { ioCalls++; expect(path).toBe(`${FOLDER}/native-v2/snapshot.json`); return transport.read(path) },
      write: async () => { throw new Error('unsafe SDK presence write') },
      run: async (argv, stdin) => { ioCalls++; expect(argv[3]).toBe('write'); await transport.write(argv[5]!, stdin!); return { stdout: '', code: 0 } },
      after: (ms, callback) => { const timer = { session, at: now + ms, callback, active: true }; timers.push(timer); return () => { timer.active = false } },
      spawn: argv => { ioCalls++; spawned.push([...argv]); if (argv[3] === 'transaction') transactions++; return transport.spawn(session, argv) },
    } as PresenceIO
    const controller = new SharedPresence(io, session, folder, script, { changed: value => { seen.push(value) }, error: value => { errors.push(value) } }, { sleepAfter: TIMING.sleepAfter, clingyAfter: 150000, enabled:quietEnabled }, () => language, metadata)
    controllers.set(session, controller)
    return controller
  }
  return {
    create, callbacks, errors,
    holdWrites: transport.holdWrites,
    current: () => transport.state,
    ioCalls: () => ioCalls,
    transactions: () => transactions,
    spawned: () => spawned,
    timers: () => timers.filter(timer => timer.active),
    async advance(ms: number) {
      const target = now + ms
      while (true) {
        const pending = timers.filter(timer => timer.active && timer.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!pending) break
        now = pending.at; pending.active = false; pending.callback(); await drain()
      }
      now = target; await drain()
    },
    async killed(session: string) {
      transport.kill(session)
      // Tail has no process-death event: liveness is checked at this next decision.
      const observer = [...controllers.entries()].find(([id]) => id !== session)?.[1]
      if (observer) await (observer as any).decide()
      await drain()
    },
    async malformed(text: string) { transport.malformed(text); await drain() },
  }
}

test('M1 shared presence with Lively off schedules zero quiet timers and does no idle IO',async()=>{
 const f=sharedFolder(),session=f.create('quiet-off',FOLDER,'en',{},()=>false)
 await session.start();await drain()
 expect(f.timers()).toEqual([])
 const before=f.ioCalls(),transactions=f.transactions()
 await f.advance(600000)
 expect(f.timers()).toEqual([]);expect(f.ioCalls()).toBe(before);expect(f.transactions()).toBe(transactions)
 expect(session.current?.asleep).toBe(false)
 session.stop()
})

test('M1 shared Lively changes cancel existing quiet timers before any wake',async()=>{
 let enabled=true
 const f=sharedFolder(),session=f.create('quiet-toggle',FOLDER,'en',{},()=>enabled)
 await session.start();await drain();expect(f.timers().length).toBe(1)
 enabled=false;await session.quietChanged();expect(f.timers()).toEqual([])
 const before=f.ioCalls();await f.advance(600000);expect(f.ioCalls()).toBe(before);expect(session.current?.asleep).toBe(false)
 session.stop()
})

test('M1 randomized idle has exactly one sleep timer per session, matching the shared event millisecond', async () => {
  const f = sharedFolder(), sessions = [f.create('sleep-one'), f.create('sleep-two')]
  try {
    await Promise.all(sessions.map(session => session.start())); await drain()
    const quietAt = f.current().quietAt, deadline = quietAt + TIMING.sleepAfter(quietAt)
    expect(f.timers()).toHaveLength(2)
    for(const id of ['sleep-one','sleep-two'])expect(f.timers().filter(timer=>timer.session===id)).toHaveLength(1)
    expect(f.timers().map(timer=>timer.at)).toEqual([quietAt+TIMING.clingyAfter,quietAt+TIMING.clingyAfter])
    await f.advance(TIMING.clingyAfter)
    expect(sessions.map(session=>session.current?.clingyEvent?.at)).toEqual([quietAt+TIMING.clingyAfter,quietAt+TIMING.clingyAfter])
    expect(f.current().quietAt).toBe(quietAt)
    expect(f.timers()).toHaveLength(2)
    for(const id of ['sleep-one','sleep-two'])expect(f.timers().filter(timer=>timer.session===id)).toHaveLength(1)
    expect(f.timers().map(timer => timer.at)).toEqual([deadline, deadline])
    await f.advance(deadline - quietAt - TIMING.clingyAfter - 1)
    expect(sessions.map(session => session.current?.asleep)).toEqual([false, false])
    await f.advance(1)
    expect(sessions.map(session => session.current?.sleepEvent?.at)).toEqual([deadline, deadline])
    expect(f.timers()).toHaveLength(0)
    await sessions[0]!.activity(false); await drain()
    const nextQuiet = f.current().quietAt, nextDeadline = nextQuiet + TIMING.sleepAfter(nextQuiet)
    expect(nextQuiet).not.toBe(quietAt)
    expect(TIMING.sleepAfter(nextQuiet)).not.toBe(TIMING.sleepAfter(quietAt))
    expect(f.timers()).toHaveLength(2)
    expect(f.timers().map(timer=>timer.at)).toEqual([nextQuiet+TIMING.clingyAfter,nextQuiet+TIMING.clingyAfter])
    await f.advance(TIMING.clingyAfter)
    expect(f.timers()).toHaveLength(2)
    expect(f.timers().map(timer=>timer.at)).toEqual([nextDeadline,nextDeadline])
  } finally { sessions.forEach(session => session.stop()); await drain() }
  expect(f.errors).toEqual([])
})

test('M1 fallback earliest deadline survives early delivery and rejects repeated, Off, busy and stopped callbacks',async()=>{
 let enabled=true
 const f=sharedFolder(),session=f.create('quiet-boundaries',FOLDER,'en',{},()=>enabled)
 try{
  await session.start();await drain();expect(f.timers()).toHaveLength(1)
  const first=f.timers()[0]!,deadline=f.current().quietAt+TIMING.sleepAfter(f.current().quietAt)
  await f.advance(TIMING.clingyAfter-1)
  first.active=false;first.callback();await drain()
  expect(session.current?.clingy).toBe(false);expect(session.current?.asleep).toBe(false)
  expect(f.timers()).toHaveLength(1);expect(f.timers()[0]!.at).toBe(MORNING+TIMING.clingyAfter)
  const earlyTransactions=f.transactions()
  first.callback();await drain();expect(f.transactions()).toBe(earlyTransactions);expect(f.timers()).toHaveLength(1)
  await f.advance(1)
  expect(session.current?.clingyEvent?.at).toBe(MORNING+TIMING.clingyAfter)
  expect(f.timers()).toHaveLength(1);expect(f.timers()[0]!.at).toBe(deadline)
  const beforeOff=f.timers()[0]!
  enabled=false;await session.quietChanged();expect(f.timers()).toHaveLength(0)
  const offTransactions=f.transactions()
  beforeOff.callback();await drain();expect(f.transactions()).toBe(offTransactions);expect(f.timers()).toHaveLength(0)
  enabled=true;await session.quietChanged();expect(f.timers()).toHaveLength(1);expect(f.timers()[0]!.at).toBe(deadline)
  const beforeBusy=f.timers()[0]!
  await session.activity(true);await drain();expect(session.current?.busy).toBe(true);expect(f.timers()).toHaveLength(0)
  const busyTransactions=f.transactions()
  beforeBusy.callback();await drain();expect(f.transactions()).toBe(busyTransactions);expect(session.current?.asleep).toBe(false)
  await session.activity(false);await drain();expect(f.timers()).toHaveLength(1)
  const beforeStop=f.timers()[0]!
  session.stop();await drain();expect(f.timers()).toHaveLength(0)
  const stoppedTransactions=f.transactions()
  beforeStop.callback();await drain();expect(f.transactions()).toBe(stoppedTransactions);expect(f.timers()).toHaveLength(0)
 }finally{session.stop();await drain()}
 expect(f.errors).toEqual([])
})

describe('one global presence across independent session controllers', () => {
  test('all sessions sleep at the same hashed global quiet millisecond and remote activity wakes each controller', async () => {
    const f = sharedFolder(), sessions = ['a', 'b', 'c'].map(id => f.create(id))
    await Promise.all(sessions.map(session => session.start()))
    await f.advance(TIMING.sleepAfter(MORNING) - 1)
    expect(sessions.map(session => session.current?.asleep)).toEqual([false, false, false])
    await f.advance(1)
    expect(sessions.map(session => session.current?.asleep)).toEqual([true, true, true])
    expect(new Set(sessions.map(session => session.current?.sleepEvent?.id)).size).toBe(1)
    await sessions[0]!.activity(false); await drain()
    expect(sessions.map(session => session.current?.asleep)).toEqual([false, false, false])
    expect(new Set(sessions.map(session => session.current?.wakeEvent?.id)).size).toBe(1)
    sessions.forEach(session => session.stop())
    expect(f.errors).toEqual([])
  })
  test('two initiating bands preserve the sleeping speech language before either native write confirms', async () => {
    const asleep = { ...snapshot('sleep', MORNING - 1000, 12), lang: 'zh' as const }
    asleep.sleepEvent = { ...asleep.event, lang: 'zh' } as never
    const f = sharedFolder(asleep), a = f.create('english', FOLDER, 'en'), b = f.create('french', FOLDER, 'fr')
    await Promise.all([a.start(), b.start()])
    const release = f.holdWrites()
    const pending = [a.activity(false), b.activity(false)]
    try {
      await drain()
      expect(f.current().asleep).toBe(true) // no durable writer has run yet
      expect(a.current?.asleep).toBe(false)
      expect(b.current?.asleep).toBe(false)
      expect(a.current?.wakeEvent?.lang).toBe('zh')
      expect(b.current?.wakeEvent?.lang).toBe('zh')
      const states = [a.current!, b.current!]
      const lines = states.map(state => sharedLineFor({ ...initialView(), lang: state.wakeEvent!.lang! }, 'wake', state.wakeEvent!.id))
      expect(lines[0]).toBe(lines[1])
      expect(LINES.zh.wake).toContain(lines[0])
    } finally { release(); await Promise.all(pending); a.stop(); b.stop(); await drain() }
    expect(f.errors).toEqual([])
  })
  test('a running turn suppresses deadlines; death after those deadlines delivers expiry and rearms quiet', async () => {
    const f = sharedFolder(), a = f.create('a'), b = f.create('b')
    await Promise.all([a.start(), b.start()])
    await a.activity(true); await drain()
    await f.advance(600000)
    expect(b.current?.asleep).toBe(false)
    expect(f.timers()).toHaveLength(0)
    await f.killed('a')
    expect(b.current?.busy).toBe(false)
    await f.advance(TIMING.sleepAfter(f.current().quietAt))
    expect(b.current?.asleep).toBe(true)
    a.stop(); b.stop()
  })
  test('clingy is one shared event at 2.5 minutes and activity starts a new quiet stretch', async () => {
    const f = sharedFolder(), a = f.create('a'), b = f.create('b')
    await Promise.all([a.start(), b.start()])
    await f.advance(149999)
    expect(f.current().clingy).toBe(false)
    await f.advance(1)
    expect(f.current().clingy).toBe(true)
    expect(new Set([a.current?.clingyEvent?.id, b.current?.clingyEvent?.id]).size).toBe(1)
    const id = f.current().clingyEvent?.id
    await f.advance(89999)
    expect(f.current().clingyEvent?.id).toBe(id)
    await a.activity(false); await drain(); await f.advance(150000)
    expect(f.current().clingyEvent?.id).not.toBe(id)
    a.stop(); b.stop()
  })
  test('new sessions first apply the already asleep or awake state, without a local activity write', async () => {
    for (const asleep of [true, false]) {
      const f = sharedFolder(snapshot(asleep ? 'sleep' : 'wake', MORNING - 1000, 12)), a = f.create('new')
      const first = await a.start()
      expect(first?.asleep).toBe(asleep)
      expect(f.callbacks.get('new')?.[0]?.asleep).toBe(asleep)
      expect(f.current().event).toEqual(snapshot(asleep ? 'sleep' : 'wake', MORNING - 1000, 12).event)
      expect(f.current().quietAt).toBe(MORNING - 1000)
      a.stop()
    }
  })
  test('fragmented stream, duplicates, malformed and oversized lines preserve the last valid state', async () => {
    const f = sharedFolder(), a = f.create('a')
    await a.start()
    const initial = a.current
    await f.malformed('not json\n[]\n' + 'x'.repeat(262145) + '\n' + JSON.stringify({ ...initial, seq: 999, asleep: true, event: { kind: 'wake', id: 'arbitrary text', at: MORNING } }) + '\n')
    expect(a.current).toEqual(initial)
    const valid = snapshot('wake', MORNING, 9), line = JSON.stringify(valid) + '\n'
    await f.malformed(line.slice(0, 17)); await f.malformed(line.slice(17))
    expect(a.current?.seq).toBe(9)
    await f.malformed(JSON.stringify(initial) + '\n' + JSON.stringify(valid) + '\n')
    expect(a.current?.seq).toBe(9)
    a.stop()
  })
  test('snapshot replacement without a journal append delivers once and later journal duplicate is ignored', async () => {
    const f = sharedFolder(), a = f.create('a')
    await a.start()
    const before = f.callbacks.get('a')!.length
    const sleeping = snapshot('sleep',MORNING,9)
    await f.malformed(`==> ${FOLDER}/native-v2/snapshot.json <==\n${JSON.stringify(sleeping)}\n`)
    expect(a.current?.asleep).toBe(true)
    expect(a.current?.seq).toBe(9)
    await f.malformed(`==> ${FOLDER}/native-v2/presence.jsonl <==\n${JSON.stringify(sleeping)}\n`)
    expect(f.callbacks.get('a')!.length).toBe(before+1)
    a.stop()
  })
  // Windows shares presence too (lane C, 10-16; DECISIONS 941): the pet program's own `presence` verbs stand in for
  // presence.sh, with the same arguments after the folder, the folder as it is (no native-v2) and the Windows helper's
  // process facts in the inventory (companion-rs/src/presence_helper.rs; tests/presence_windows.rs runs it for real).
  test('a Windows folder shares presence through the pet program the way presence.sh does elsewhere', async () => {
    const program = 'C:\\Users\\owner\\.claude\\plugins\\coco\\companion-rs\\bin\\coco-companion-windows-x86_64.exe'
    const folder = 'C:\\Users\\owner\\.local\\state\\coco'
    const f = sharedFolder(), a = f.create('windows', folder, 'en', {}, undefined, program)
    expect(await a.start()).toBeDefined()
    expect(a.isRunning).toBe(true)
    const follow = f.spawned().find(argv => argv[3] === 'follow')!
    const owner = follow[4]!
    expect(follow).toEqual([program, 'presence', folder, 'follow', owner, '', '', `${folder}\\.presence-follow-${owner}.jsonl`, `${folder}\\.presence-deadline-${owner}.jsonl`])
    const claims = Object.values(f.current().claims) as { birth: string; executable: string; uid: number }[]
    expect(claims.map(claim => [claim.birth.startsWith('windows:'), claim.executable, claim.uid])).toEqual([[true, 'C:\\fixture\\coco-companion.exe', 0]])
    const before = f.transactions()
    await a.activity(true); await drain()
    expect(f.transactions()).toBeGreaterThan(before)
    expect(f.current().busy).toBe(true)
    const sends = f.spawned().filter(argv => argv[3] === 'fifo-send')
    expect(sends.length).toBeGreaterThan(0)
    expect(sends.every(argv => argv[4]!.startsWith(`${folder}\\.presence-`) && argv[4]!.endsWith('\\commit'))).toBe(true)
    expect(f.spawned().every(argv => argv[0] === program && argv[1] === 'presence' && argv[2] === folder)).toBe(true)
    a.stop()
    // Its inventory lines: a windows: birth, uid 0, a drive or network path; nothing else from Windows passes.
    const listed = parseProcessInventory('PID\t44\t22\twindows:133\t0\tC:\\Program Files\\nodejs\\node.exe\towned\nPID\t45\t22\twindows:134\t0\t\\\\server\\share\\claude.exe\t\n')
    expect([...listed.entries()].map(([pid, row]) => [pid, row.birth, row.executable, row.registeredOwner ?? ''])).toEqual([[44, 'windows:133', 'C:\\Program Files\\nodejs\\node.exe', 'owned'], [45, 'windows:134', '\\\\server\\share\\claude.exe', '']])
    for (const row of ['PID\t44\t22\twindows:133\t0\tnode.exe\t\n', 'PID\t44\t22\twindows:x\t0\tC:\\node.exe\t\n', 'PID\t44\t22\twindows:1:2\t0\tC:\\node.exe\t\n']) expect(parseProcessInventory(row).size).toBe(0)
  })
  test('a quiet minute has no polling callbacks or process work', async () => {
    const f = sharedFolder(), a = f.create('a'), b = f.create('b')
    await Promise.all([a.start(), b.start()]); await drain()
    const calls = f.ioCalls()
    await f.advance(60000)
    expect(f.ioCalls()).toBe(calls)
    expect(f.timers()).toHaveLength(2)
    a.stop(); b.stop()
  })
  test('a same-stack activity burst commits one line with the final busy edge', async () => {
    const f = sharedFolder(), a = f.create('a')
    await a.start(); await drain()
    const before = f.transactions(), seq = f.current().seq
    await Promise.all([a.activity(true), a.activity(true), a.activity(false)])
    await drain()
    expect(f.transactions() - before).toBe(1)
    expect(f.current().seq - seq).toBe(1)
    expect(f.current().busy).toBe(false)
    expect(a.ownsBusy).toBe(false)
    a.stop(); await drain()
  })
  test('one follower routes presence and requests, dropping only the old request replay', async () => {
    const requestPath = '/tmp/companion-requests.jsonl'
    const old = '{"v":1,"id":"old"}', fresh = '{"v":1,"id":"fresh"}'
    const transport = transportFixture(snapshot(),{deferReady:true}), seen: string[] = [], errors: unknown[] = [], spawns: string[][] = [], reads: string[] = []
    let ended = 0
    const io: PresenceIO = {
      now: async () => MORNING,
      read: async path => { reads.push(path); throw new Error('unsafe SDK shared-state read') },
      write: async () => { throw new Error('unsafe SDK presence write') },
      run: async (argv, stdin) => { expect(argv[3]).toBe('write'); await transport.write(argv[5]!, stdin!); return { stdout: '', code: 0 } },
      spawn: argv => { spawns.push(argv); return transport.spawn('shared-reader',argv) },
      after: () => () => {},
    }
    const a = new SharedPresence(io,'shared-reader',FOLDER,SCRIPT,{changed: () => {},error:error=>errors.push(error)},undefined,undefined,{requestPath})
    await a.start()
    const unsubscribe = a.subscribeRequests(text=>{seen.push(text)},()=>{ended++})
    expect(unsubscribe).toBeDefined()
    transport.request(requestPath,old + '\n'); await drain()
    expect(seen).toEqual([])
    transport.ready(); await drain()
    transport.request(requestPath,fresh + '\n'); await drain()
    expect(seen).toEqual([fresh + '\n'])
    const failure = new Error('one request subscriber refused')
    a.subscribeRequests(()=>{throw failure})
    transport.request(requestPath,'{"id":"next"}\n');await drain()
    expect(seen).toEqual([fresh + '\n','{"id":"next"}\n'])
    expect(a.isRunning).toBe(true)
    transport.remote(snapshot('sleep',MORNING+240000,transport.state.seq+1)); await drain()
    expect(a.current?.asleep).toBe(true)
    expect(spawns.filter(argv=>argv[3]==='follow')).toHaveLength(1)
    expect(spawns.filter(argv=>argv[0]==='/usr/bin/tail')).toHaveLength(0)
    expect(reads).toEqual([])
    a.stop(); await drain()
    expect(ended).toBe(1)
    expect(errors).toEqual([failure])
  })
  test('every language shares sleep and wake wording across warmth and prior local line history', () => {
    for (const { code: lang } of LANGS) {
      for (const key of ['sleep', 'wake'] as const) {
        const warm = { ...initialView(), lang, affection: 'warm' as const }, clingy = { ...initialView(), lang, affection: 'clingy' as const }
        const event = `${key}:71:${MORNING}`
        const a = sharedLineFor(warm, key, event)
        for (let i = 0; i < 9; i++) pick(`${lang}:local`, LINES[lang][key])
        const b = sharedLineFor(clingy, key, event)
        expect(a).toBe(b)
        expect(LINES[lang][key]).toContain(a)
      }
    }
  })
  test('C2 session metadata survives activity, and locked reading leaves state unchanged', async () => {
    const f = sharedFolder(), a = f.create('project', FOLDER, 'en', { cwd: '/tmp/project', version: '0.2.0' })
    await a.start()
    const before = JSON.stringify(f.current())
    // each row also says whether that window is working and since when (E1-2, their windows on the bag's first page)
    const quiet = await a.readSessions()
    expect(quiet.map(({ busySince: _since, ...row }) => row)).toEqual([{ session: 'project', cwd: '/tmp/project', version: '0.2.0', open: true, busy: false }])
    expect(typeof quiet[0]?.busySince).toBe('number')
    expect(JSON.stringify(f.current())).toBe(before)
    await a.activity(true)
    const working = await a.readSessions()
    expect(working.map(({ busySince: _since, ...row }) => row)).toEqual([{ session: 'project', cwd: '/tmp/project', version: '0.2.0', open: true, busy: true }])
    expect(working[0]!.busySince!).toBeGreaterThanOrEqual(quiet[0]!.busySince!)
    await a.end()
    expect(await a.readSessions()).toEqual([])
    expect(f.errors).toEqual([])
  })
  test('C2 check-up filters dead owner identities without any record-age cutoff', () => {
    const claim = { pid: 44, birth: 'darwin:1:2', busy: false, session: 'project', owner: 'c2', hostPid: 22,
      hostBirth: 'darwin:3:4', uid: 501, executable: '/bin/helper', cwd: '/tmp/project', version: '0.1.2' }
    const parsed = parsePresenceRecord(JSON.stringify({ ...snapshot(), quietAt: 0, claims: { project: claim } }))!
    const alive = new Map([[44, { parent: 22, birth: claim.birth, uid: 501, executable: '/bin/helper', registeredOwner: 'c2' }],
      [22, { parent: 1, birth: claim.hostBirth, uid: 501, executable: '/bin/host' }]])
    expect(presenceSessions(parsed, alive)).toEqual([{ session: 'project', cwd: '/tmp/project', version: '0.1.2', open: true, busy: false }])
    for (const defect of [{ birth: 'darwin:1:3' }, { registeredOwner: 'forged' }, { parent: 23 }]) {
      const forged = new Map(alive); forged.set(44, { ...alive.get(44)!, ...defect })
      expect(presenceSessions(parsed, forged)).toEqual([])
    }
    const reusedHost = new Map(alive); reusedHost.set(22, { ...alive.get(22)!, birth: 'darwin:3:5' })
    expect(presenceSessions(parsed, reusedHost)).toEqual([])
    alive.delete(22)
    expect(presenceSessions(parsed, alive)).toEqual([])
    for (const metadata of [{ cwd: null }, { cwd: 'x'.repeat(4097) }, { version: 42 }, { version: 'x'.repeat(65) }])
      expect(parsePresenceRecord(JSON.stringify({ ...snapshot(), claims: { project: { ...claim, ...metadata } } }))).toBeUndefined()
  })
  test('transport rejects invalid claims and legacy argument inventory', () => {
    const claim = { pid: 44, birth: 'Sun Oct 4 08:00:00 2026', busy: true, session: 'main', owner: 'valid', hostPid: 22, hostBirth: 'Sun Oct 4 08:00:00 2026' }
    expect(parsePresenceRecord(JSON.stringify({ ...snapshot(),claims: { main: claim } }))?.claims.main?.pid).toBe(44)
    for (const claims of [[],null,{main:{...claim,pid:-1}},{main:{...claim,owner:'not safe'}},{main:{...claim,hostPid:0}},{main:{...claim,busy:'true'}}]) {
      expect(parsePresenceRecord(JSON.stringify({ ...snapshot(),claims }))).toBeUndefined()
    }
    const inventory = parseProcessInventory('PID\t44\t22\tdarwin:1:2\t501\t/fixture/helper\tvalid\n45 22 Z Sun Oct 4 08:00:00 2026 zombie\ninvalid\n')
    expect(inventory.size).toBe(1)
    expect(inventory.get(44)?.parent).toBe(22)
    expect(parseProcessInventory('PID\t44\t22\tdarwin:1:2\t/bin/helper .presence-follow-valid.jsonl\n').size).toBe(0)
    expect(parseProcessInventory('PID2\t44\t22\tdarwin:1:2\tvalid\nPID2\t44\t22\tdarwin:1:2\tother\n').size).toBe(0)
  })
  test('owned registration binds executable and owner UID without reading process text', () => {
    const claim = { pid: 44, birth: 'darwin:1:2', busy: true, session: 'project', owner: 'owned',
      uid: 501, executable: '/fixture/helper', hostPid: 22, hostBirth: 'darwin:3:4', cwd: '/fixture/project', version: '1' }
    const record = parsePresenceRecord(JSON.stringify({ ...snapshot(), claims: { project: claim } }))!
    const inventory = parseProcessInventory('PID\t44\t22\tdarwin:1:2\t501\t/fixture/helper\towned\nPID\t22\t1\tdarwin:3:4\t501\t/fixture/host\t\n')
    expect(presenceSessions(record, inventory)).toHaveLength(1)
    for (const changed of [{ registeredOwner: '' }, { registeredOwner: 'foreign' }, { uid: 502 }, { executable: '/fixture/other' }, { birth: 'darwin:1:3' }]) {
      const altered = new Map(inventory); altered.set(44, { ...inventory.get(44)!, ...changed })
      expect(presenceSessions(record, altered)).toEqual([])
    }
    expect(parseProcessInventory('PID\t44\t22\tdarwin:1:2\t501\t/fixture/helper\towned\tPRIVATE\n').size).toBe(0)
  })
  test('defensive snapshot parser rejects invalid times, shapes and unknown event identities', () => {
    for (const value of [null, [], {}, { ...snapshot(), seq: -1 }, { ...snapshot(), quietAt: -1 }, { ...snapshot(), busy: 'true' }, { ...snapshot(), event: { kind: 'sleep', id: 'untrusted words', at: MORNING } }]) {
      expect(parsePresence(JSON.stringify(value))).toBeUndefined()
    }
    expect(parsePresence(JSON.stringify(snapshot()))?.seq).toBe(1)
  })
})
