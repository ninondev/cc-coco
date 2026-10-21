// Real scratch files/processes. This harness calls the shipping TypeScript reducer.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, appendFile, stat, rename } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import { cpuMilliseconds, scheduleCpuBudget } from './process-cpu'
const [plugin, out, fixtureMode] = process.argv.slice(2)
await mkdir(out,{recursive:true,mode:0o700})
const { reducePresence, parsePresenceRecord, parseProcessInventory, SharedPresence, presenceSessions } = await import(join(plugin, 'hooks/presence.ts'))
let script = process.env.COCO_TEST_TRANSPORT ?? join(plugin, 'bin/presence.sh')
const deadlines = { sleepAfter: 240000, clingyAfter: 150000 }
const now = Date.now()
let serial = 0
const metrics: any[] = []
const identitySource = process.platform === 'linux' ? 'native /proc boot ID and start ticks' : 'native libproc metadata and owned registration'
function processLines(argv: string[], env = process.env) {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env })
  const lines: string[] = []; let buffer = '', stderr = '', ended = false, wake: (() => void) | undefined
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', text => { buffer += text; for (;;) { const n = buffer.indexOf('\n'); if (n < 0) break; lines.push(buffer.slice(0,n)); buffer = buffer.slice(n+1) }; wake?.(); wake = undefined })
  child.stderr.on('data', text => { stderr += text })
  const exit = new Promise<number | null>(resolve => child.on('exit', code => { ended = true; wake?.(); resolve(code) }))
  return { child, exit, async next() { while (!lines.length) { if (ended) throw new Error(`EOF code=${child.exitCode} ${argv.join(' ')}: ${stderr}`); await new Promise<void>((resolve,reject) => { const cancel = scheduleCpuBudget(5000,()=>{wake=undefined;reject(new Error('transport line CPU budget: '+argv.join(' ')+'\n'+stderr))});wake = ()=>{cancel();resolve()} }) }; return lines.shift()! }, stop() { child.kill('SIGCONT'); child.kill('SIGTERM') } }
}
async function follower(folder: string, owner: string, requests = '') {
  const stream = processLines(['/bin/sh', '-c', '/bin/sh "$1" "$2" follow "$3" "$4" "" "$2/.presence-follow-$3.jsonl" & wait', 'presence-test-host', script, folder, owner, requests])
  const first = await stream.next()
  assert.match(first, /^FOLLOW\t\d+$/)
  const pid = Number(first.split('\t')[1])
  return { ...stream, pid, owner, hostPid: stream.child.pid!, stop() { try { process.kill(pid, 'SIGTERM') } catch {} stream.stop() } }
}
async function transaction(folder: string, mode: string, session: string, at: number, busy: boolean, reader: any, language = 'en', token = `tx${++serial}`) {
  const stream = processLines(['/bin/sh', script, folder, 'transaction', token, '', mode === 'leave' ? reader.owner : ''])
  let fifo = '', previous: any, inventory = ''
  try {
    for (;;) {
      const line = await stream.next()
      if (line.startsWith('PRESENCE\t')) fifo = line.split('\t')[2]
      else if (line.startsWith('STATE\t')) previous = parsePresenceRecord(line.slice(6))
      else if (line.startsWith('LOG\t')) { const record = parsePresenceRecord(line.slice(4)); if (record && (!previous || record.seq > previous.seq)) previous = record }
      else if (line === 'INSPECT') break
    }
    const pids = [`${reader.pid}:${reader.owner}`, String(reader.hostPid), ...Object.values(previous?.claims ?? {}).flatMap((claim: any) => [`${claim.pid}:${claim.owner}`, ...(claim.hostPid ? [String(claim.hostPid)] : [])])]
    await writeFile(fifo, [...new Set(pids)].join(',') + '\n')
    for (;;) { const line = await stream.next(); if (line === 'READY') break; inventory += line + '\n' }
    const alive = parseProcessInventory(inventory)
    const result = reducePresence(previous, mode, session, at, busy, reader.pid, alive.get(reader.pid)?.birth ?? '', alive, reader.owner, language, deadlines, reader.hostPid, alive.get(reader.hostPid)?.birth ?? '')
    await writeFile(fifo, JSON.stringify(result) === JSON.stringify(previous) ? '-\n' : JSON.stringify(result) + '\n')
    assert.equal(await stream.next(), 'COMMITTED')
    assert.equal(await stream.exit, 0)
    return result
  } finally { if (stream.child.exitCode === null) stream.stop() }
}
async function receive(stream: any, seq: number) { for (;;) { const line = await stream.next(); const value = parsePresenceRecord(line); if (value?.seq === seq) return value } }
const tests: [string, () => Promise<void>][] = []
function test(name: string, run: () => Promise<void>) { tests.push([name, run]) }
// The time a live claim's busy last changed is the clock's; only its presence is checked.
function sinceStripped(rows: any[]): any[] { return rows.map(({ busySince, ...row }) => { assert.equal(typeof busySince, 'number'); return row }) }
async function setup(name: string) { const folder = join(out, name); await mkdir(folder, { recursive: true, mode: 0o700 }); const reader = await follower(folder, `owner${++serial}`); return { folder, reader } }

test('C2 presence metadata is durable, backward compatible and owner validated without age guesses', async () => {
  const claim = { session: 'project', owner: 'c2', pid: 44, birth: 'darwin:12:34', busy: false,
    hostPid: 22, hostBirth: 'darwin:56:78', cwd: '/scratch/project', version: '0.2.0' }
  const alive = new Map([[44, { parent: 22, birth: claim.birth, uid: 501, executable: '/bin/helper', registeredOwner: 'c2' }],
    [22, { parent: 1, birth: claim.hostBirth, uid: 501, executable: '/bin/host' }]])
  const state = reducePresence(undefined, 'bootstrap', claim.session, now, false, 44, claim.birth, alive, 'c2', 'en',
    deadlines, 22, claim.hostBirth, undefined, { cwd: claim.cwd, version: claim.version })
  assert.equal(state.claims['44:c2'].cwd, claim.cwd)
  assert.equal(state.claims['44:c2'].version, claim.version)
  const parsed = parsePresenceRecord(JSON.stringify(state))!
  // bdf29d9a (10-17): open sessions carry busy and when it last changed (busySince)
  assert.deepEqual(presenceSessions(parsed, alive), [{ session: claim.session, cwd: claim.cwd, version: claim.version, open: true, busy: false, busySince: now }])
  assert.deepEqual(presenceSessions({ ...parsed, quietAt: 0 }, alive), presenceSessions(parsed, alive))
  const reused = new Map(alive); reused.set(44, { ...alive.get(44)!, birth: 'darwin:12:35' })
  assert.deepEqual(presenceSessions(parsed, reused), [])
  const wrongNonce = new Map(alive); wrongNonce.set(44, { ...alive.get(44)!, registeredOwner: 'other' })
  assert.deepEqual(presenceSessions(parsed, wrongNonce), [])
  const reparented = new Map(alive); reparented.set(44, { ...alive.get(44)!, parent: 23 })
  assert.deepEqual(presenceSessions(parsed, reparented), [])
  for (const metadata of [{ cwd: 42 }, { cwd: 'x'.repeat(4097) }, { version: null }, { version: 'x'.repeat(65) }])
    assert.equal(parsePresenceRecord(JSON.stringify({ ...state, claims: { c2: { ...claim, ...metadata } } })), undefined)
  const legacy = { ...claim }; delete legacy.cwd; delete legacy.version
  const old = parsePresenceRecord(JSON.stringify({ ...state, claims: { legacy } }))!
  assert.ok(old); assert.deepEqual(presenceSessions(old, alive), [])
})

test('C2 locked session reads expose metadata without writing state or changing sequence', async () => {
  const { nodePresenceIO } = await import('./presence-node-io')
  const folder = join(out, 'c2-metadata'), errors: unknown[] = []
  let commits = 0
  const nativeDiagnostics: string[] = []
  const io = nodePresenceIO({ writes: (_path, text) => { if (text.startsWith('{')) commits++ }, spawned: child => { child.stderr.on('data', text => nativeDiagnostics.push(String(text))); child.on('exit', (code, signal) => nativeDiagnostics.push(`owned native exit ${code} ${signal}`)) } })
  const controller = new SharedPresence(io, 'c2-project', folder, script,
    { changed: () => {}, error: error => errors.push(error) }, deadlines, () => 'en', { cwd: '/scratch/project', version: '0.2.0' })
  try {
    await controller.start()
    assert.equal(errors.length, 0, [...errors.map(String), ...nativeDiagnostics].join("\n"))
    const path = join(folder, 'native-v2', 'snapshot.json'), before = await readFile(path, 'utf8'), writes = commits
    assert.deepEqual(sinceStripped(await controller.readSessions()), [{ session: 'c2-project', cwd: '/scratch/project', version: '0.2.0', open: true, busy: false }])
    assert.equal(await readFile(path, 'utf8'), before); assert.equal(commits, writes)
    await controller.activity(true)
    assert.deepEqual(sinceStripped(await controller.readSessions()), [{ session: 'c2-project', cwd: '/scratch/project', version: '0.2.0', open: true, busy: true }])
  } finally { await controller.end() }
  assert.deepEqual(await controller.readSessions(), [])
  assert.deepEqual(errors, [])
})

test('C2 check-up can inspect live sessions inside an awaited presence redraw', async () => {
  const { nodePresenceIO } = await import('./presence-node-io')
  const errors: unknown[] = [], reads: unknown[] = []
  let controller: any, inspected!: () => void
  const checked = new Promise<void>(resolve => { inspected = resolve })
  controller = new SharedPresence(nodePresenceIO(), 'c2-redraw', join(out, 'c2-redraw'), script,
    { changed: async state => { if (state.event.kind === 'activity') { reads.push(await controller.readSessions()); inspected() } },
      error: error => errors.push(error) }, deadlines, () => 'en', { cwd: '/scratch/redraw', version: '0.2.0' })
  let cancelTimeout: (() => void) | undefined
  try {
    await controller.start()
    await Promise.race([Promise.all([controller.activity(true), checked]), new Promise((_, reject) => {
      cancelTimeout = scheduleCpuBudget(1000, () => reject(new Error('check-up redraw inspection exhausted its CPU budget')))
    })])
    assert.deepEqual(reads.map(rows => sinceStripped(rows as any[])), [[{ session: 'c2-redraw', cwd: '/scratch/redraw', version: '0.2.0', open: true, busy: true }]])
    assert.deepEqual(errors, [])
  } finally { cancelTimeout?.(); await controller.end() }
})

test('concurrent writers, complete atomic snapshots, bounded rotation and live tail readers', async () => {
  const { folder, reader } = await setup('concurrent')
  const others = await Promise.all(Array.from({length: 23}, (_, n) => follower(folder, `parallel${n}`)))
  try {
    await Promise.all([reader,...others].map((r,n) => transaction(folder,'bootstrap',`s${n}`,now,false,r)))
    let state = parsePresenceRecord(await readFile(join(folder,'snapshot.json'),'utf8'))!
    assert.equal(Object.keys(state.claims).length,24)
    await writeFile(join(folder,'presence.jsonl'), 'x'.repeat(262134))
    await Promise.all([reader,...others].map((r,n) => transaction(folder,'write',`s${n}`,now+n+1,n%2===0,r)))
    state = parsePresenceRecord(await readFile(join(folder,'snapshot.json'),'utf8'))!
    assert.equal(Object.keys(state.claims).length,24)
    assert.equal(Object.values(state.claims).filter((c:any) => c.busy).length,12)
    assert.equal(state.seq,48)
    assert.ok((await stat(join(folder,'presence.jsonl'))).size <= 262144)
    const log = (await readFile(join(folder,'presence.jsonl'),'utf8')).trim().split('\n')
    assert.ok(log.every((line:string) => parsePresenceRecord(line)))
    assert.deepEqual(JSON.parse(log.at(-1)!),JSON.parse(JSON.stringify(state)))
    await Promise.all([reader,...others].map(r => receive(r,state.seq)))
  } finally { for (const r of [reader,...others]) r.stop(); await Promise.all([reader,...others].map(r=>r.exit)) }
})
test('sleep/wake/clingy language stays shared; live busy turn holds and killed claim rearms quiet', async () => {
  const { folder, reader } = await setup('decisions')
  const other = await follower(folder,'other')
  try {
    let state = await transaction(folder,'bootstrap','main',now,false,reader,'zh')
    state = await transaction(folder,'decide','observer',now+149999,false,reader)
    assert.equal(state.clingy,false)
    state = await transaction(folder,'decide','observer',now+150000,false,reader)
    const clingy = state.clingyEvent
    assert.equal(state.clingy,true)
    assert.deepEqual((await transaction(folder,'decide','observer',now+230000,false,reader)).clingyEvent,clingy)
    state = await transaction(folder,'decide','observer',now+240000,false,reader)
    assert.equal(state.asleep,true); assert.equal(state.sleepEvent.lang,'zh')
    const sleep = state.sleepEvent
    assert.deepEqual((await transaction(folder,'decide','observer',now+240000,false,reader)).sleepEvent,sleep)
    state = await transaction(folder,'bootstrap','crash',now+240001,true,other,'en')
    assert.equal(state.asleep,false); assert.equal(state.busy,true); assert.equal(state.wakeEvent.lang,'zh')
    assert.equal(state.lang,'en')
    assert.equal((await transaction(folder,'decide','observer',now+1000000,false,reader)).busy,true)
    other.stop(); await other.exit
    state = await transaction(folder,'decide','observer',now+1000001,false,reader)
    assert.equal(state.busy,false); assert.equal(state.asleep,false)
    assert.equal(state.quietAt,now+1000001)
    assert.equal(state.event.kind,'expired')
    state = await transaction(folder,'decide','observer',state.quietAt+240000,false,reader)
    assert.equal(state.asleep,true)
  } finally { reader.stop(); other.stop(); await Promise.all([reader.exit,other.exit]) }
})
test('corrupt snapshot recovers journal; old module cannot remove or revive replacement; reused PID nonce is rejected', async () => {
  const { folder, reader } = await setup('reload')
  try {
    let state = await transaction(folder,'bootstrap','main',now,true,reader)
    await writeFile(join(folder,'snapshot.json'),'{incomplete')
    state = await transaction(folder,'decide','observer',now+10,false,reader)
    assert.equal(state.busy,true)
    const replacement = { ...reader, owner: 'replacement' }
    const live = new Map([[reader.pid,{ parent: reader.hostPid, birth: Object.values(state.claims)[0].birth, uid: 501, executable: '/fixture/presence-follow', registeredOwner: 'replacement' }]])
    live.set(reader.hostPid, { parent: process.pid, birth: Object.values(state.claims)[0].hostBirth, uid: 501, executable: '/fixture/host' })
    state = reducePresence(state,'bootstrap','main',now+600000,false,reader.pid,live.get(reader.pid).birth,live,replacement.owner,'en',deadlines,reader.hostPid,live.get(reader.hostPid).birth)
    assert.equal(state.busy,false); assert.equal(state.asleep,false); assert.equal(state.quietAt,now+600000)
    assert.deepEqual(Object.values(state.claims).map((c:any)=>c.owner),['replacement'])
    const stale = reducePresence(state,'write','main',now+600001,true,reader.pid,live.get(reader.pid).birth,live,reader.owner,'en',deadlines,reader.hostPid,live.get(reader.hostPid).birth)
    assert.equal(stale.busy,false); assert.deepEqual(Object.values(stale.claims).map((c:any)=>c.owner),['replacement'])
    const left = reducePresence(stale,'leave','main',now+600002,false,reader.pid,live.get(reader.pid).birth,live,reader.owner,'en',deadlines,reader.hostPid,live.get(reader.hostPid).birth)
    assert.deepEqual(Object.values(left.claims).map((c:any)=>c.owner),['replacement'])
    const wrongNonce = new Map([[reader.pid,{ ...live.get(reader.pid), registeredOwner: 'different' }]])
    const expired = reducePresence({...left,busy:true,claims:Object.fromEntries(Object.entries(left.claims).map(([k,c]:any)=>[k,{...c,busy:true}]))},'decide','observer',now+600003,false,reader.pid,live.get(reader.pid).birth,wrongNonce,'observer','en',deadlines,reader.hostPid,live.get(reader.hostPid).birth)
    assert.equal(expired.busy,false); assert.deepEqual(expired.claims,{})
  } finally { reader.stop(); await reader.exit }
})
test('killed writer lock is reclaimed without losing later atomic append', async () => {
  const { folder, reader } = await setup('killed-writer')
  const writer = processLines(['/bin/sh',script,folder,'transaction','killed'])
  try {
    for (;;) { if ((await writer.next()) === 'INSPECT') break }
    writer.child.kill('SIGKILL'); await writer.exit
    const state = await transaction(folder,'bootstrap','survivor',now,false,reader)
    assert.ok(parsePresenceRecord(await readFile(join(folder,'snapshot.json'),'utf8')))
    assert.deepEqual(JSON.parse((await readFile(join(folder,'presence.jsonl'),'utf8')).trim()),JSON.parse(JSON.stringify(state)))
  } finally { reader.stop(); writer.stop(); await reader.exit }
})
test('SIGKILL host makes its follower and waiting transaction exit autonomously; survivor expires busy on next decision', async () => {
  const { folder, reader } = await setup('orphan-host')
  const owner = 'hard-crash'
  const host = processLines(['/bin/sh','-c','/bin/sh "$1" "$2" follow "$3" "" "" "$2/.presence-follow-$3.jsonl" & /bin/sh "$1" "$2" transaction crash-writer; /bin/sh "$1" "$2" transaction host-waiter & wait','presence-test-host',script,folder,owner])
  let readerPid = 0, writerPid = 0
  try {
    let inspected=false
    for (;;) {
      const line = await host.next()
      if (line.startsWith('FOLLOW\t')) readerPid = Number(line.split('\t')[1])
      if (line === 'INSPECT') inspected=true
      if(inspected&&readerPid)break
    }
    writerPid = Number((await readFile(join(folder,'.presence-flock-owner'),'utf8')).split('\n')[0])
    // Release the waiting child so a real busy claim can be committed before the crash.
    const crashFifo = join(folder,'.presence-crash-writer','commit')
    await writeFile(crashFifo,`${readerPid}:${owner},${host.child.pid}\n`)
    let inventory = ''
    for (;;) {const line=await host.next();if(line==='READY')break;inventory+=line+'\n'}
    const alive=parseProcessInventory(inventory)
    const busy=reducePresence(undefined,'bootstrap','hard-crashed-session',now,true,readerPid,alive.get(readerPid)!.birth,alive,owner,'en',deadlines,host.child.pid!,alive.get(host.child.pid!)!.birth)
    await writeFile(crashFifo,JSON.stringify(busy)+'\n')
    for (;;) {if((await host.next())==='COMMITTED')break}
    assert.equal(parsePresenceRecord(await readFile(join(folder,'snapshot.json'),'utf8'))!.busy,true)
    // A second child is now genuinely waiting on its FIFO when the host dies.
    for(;;){if((await host.next())==='INSPECT')break}
    writerPid=Number((await readFile(join(folder,'.presence-flock-owner'),'utf8')).split('\n')[0])
    host.child.kill('SIGKILL'); await host.exit
    const started = performance.now()
    const cpuStarted = cpuMilliseconds()
    for (const pid of [readerPid,writerPid]) {
      for (;;) {
        try { process.kill(pid,0) } catch { break }
        assert.ok(cpuMilliseconds()-cpuStarted < 3000,`orphan ${pid} did not exit within the CPU budget`)
        await new Promise(resolve=>setTimeout(resolve,5))
      }
    }
    const state = await transaction(folder,'decide','survivor',now+1,false,reader)
    assert.equal(state.busy,false);assert.equal(state.event.kind,'expired');assert.equal(state.quietAt,now+1)
    assert.deepEqual(Object.values(state.claims).map((claim:any)=>claim.session),[])
    metrics.push({orphan_followers_and_transactions:2,autonomous_exit_ms:performance.now()-started})
  } finally { host.stop(); reader.stop(); await reader.exit }
})
test('snapshot-only durable update reaches a surviving tail before any journal append', async () => {
  const { folder, reader } = await setup('snapshot-window')
  const writer = processLines(['/bin/sh',script,folder,'transaction','snapshotwindow'])
  try {
    for (;;) { if ((await writer.next()) === 'INSPECT') break }
    const at = now+240000
    const event = {kind:'sleep',id:`sleep:51:${at}`,at,lang:'en'}
    const state = {v:1,seq:51,quietAt:now,asleep:true,clingy:true,busy:false,lang:'en',claims:{},event,sleepEvent:event}
    await writeFile(join(folder,'window.snapshot'),JSON.stringify(state)+'\n')
    await rename(join(folder,'window.snapshot'),join(folder,'snapshot.json'))
    writer.child.kill('SIGKILL');await writer.exit
    assert.equal((await readFile(join(folder,'presence.jsonl'),'utf8')).length,0)
    const observed = await receive(reader,51)
    assert.equal(observed.asleep,true)
    assert.deepEqual(observed.sleepEvent,event)
  } finally { reader.stop();writer.stop();await reader.exit }
})
test('a full undrained follower output pipe cannot prevent autonomous exit after host SIGKILL',async()=>{
  const {folder,reader}=await setup('full-output-parent')
  const started=performance.now()
  try{
    reader.child.stdout.pause()
    await appendFile(join(folder,'presence.jsonl'),'x'.repeat(1024*1024)+'\n')
    await new Promise(resolve=>setTimeout(resolve,100))
    reader.child.kill('SIGKILL');await reader.exit
    const killed=performance.now()
    const cpuKilled=cpuMilliseconds()
    for(;;){try{process.kill(reader.pid,0)}catch{break}assert.ok(cpuMilliseconds()-cpuKilled<3000,'follower blocked on full output pipe after parent death');await new Promise(resolve=>setTimeout(resolve,5))}
    metrics.push({full_pipe_autonomous_exit_ms:performance.now()-killed,full_pipe_bytes:1024*1024,total_ms:performance.now()-started})
  }finally{reader.stop();reader.child.stdout.destroy();await reader.exit}
})
test('snapshot-only update during request output backpressure is delivered immediately after reader resumes',async()=>{
  const folder=join(out,'request-backpressure'),requests=join(folder,'requests.jsonl')
  await mkdir(folder,{recursive:true,mode:0o700});await writeFile(requests,'')
  const reader=await follower(folder,'backpressure',requests)
  try{
    for(;;){if((await reader.next())==='READY\tbackpressure')break}
    reader.child.stdout.pause()
    await appendFile(requests,'x'.repeat(262144)+'\n')
    await new Promise(resolve=>setTimeout(resolve,100))
    const state={v:1,seq:777777,quietAt:now,asleep:false,clingy:false,busy:false,lang:'en',claims:{},event:{kind:'initial',id:`initial:777777:${now}`,at:now,lang:'en'}}
    await writeFile(join(folder,'snapshot-next'),JSON.stringify(state)+'\n')
    await rename(join(folder,'snapshot-next'),join(folder,'snapshot.json'))
    await new Promise(resolve=>setTimeout(resolve,100))
    reader.child.stdout.resume()
    assert.equal((await receive(reader,777777)).seq,777777)
    assert.equal((await readFile(join(folder,'presence.jsonl'),'utf8')).length,0)
  }finally{reader.child.stdout.resume();reader.stop();await reader.exit}
})
test('one follower adopts a later companion request file without creating its directory', async () => {
  const base = join(out,'late-install','Library','Application Support'), folder = join(base,'Coco-presence','native-v2'), companion = join(base,'Coco')
  const requests = join(companion,'requests.jsonl')
  await mkdir(folder,{recursive:true,mode:0o700})
  const reader = await follower(folder,'late-install',requests)
  try {
    assert.equal(await stat(companion).then(()=>true,()=>false),false)
    await mkdir(companion,{mode:0o700})
    const line = JSON.stringify({v:1,id:'0123456789abcdef',kind:'seen',session:'session',at:now,upto:now})
    await writeFile(requests,line+'\n')
    for (;;) { if ((await reader.next()) === line) break }
    assert.equal(reader.child.exitCode,null)
  } finally { reader.stop();await reader.exit }
})
test('ready marker follows the old request replay even when the request log exceeds the API read cap', async () => {
  const base = join(out,'request-replay','Library','Application Support'), folder = join(base,'Coco-presence','native-v2'), companion = join(base,'Coco')
  const requests = join(companion,'requests.jsonl'), owner = 'large-request'
  await mkdir(folder,{recursive:true,mode:0o700}); await mkdir(companion,{mode:0o700})
  const old = JSON.stringify({v:1,id:'old-request'}), fresh = JSON.stringify({v:1,id:'fresh-request'})
  await writeFile(requests,' '.repeat(4*1024*1024)+'\n'+old+'\n')
  const reader = await follower(folder,owner,requests)
  try {
    let replay = false, markerHeader = false
    for (;;) {
      const line = await reader.next()
      if (line === old) replay = true
      if (line === `==> ${folder}/.presence-follow-${owner}.jsonl <==`) markerHeader = true
      if (line === `READY\t${owner}`) { assert.equal(replay,true); assert.equal(markerHeader,true); break }
    }
    await appendFile(requests,fresh+'\n')
    for (;;) { if ((await reader.next()) === fresh) break }
    assert.equal(reader.child.exitCode,null)
  } finally { reader.stop();await reader.exit }
})
test('same session in independent processes retains remaining busy claim, observer stays claim free, wake reaches real followers', async () => {
  const { folder, reader } = await setup('same-session')
  const a = await follower(folder,'sameA'), b = await follower(folder,'sameB')
  try {
    await transaction(folder,'bootstrap','same',now,true,a)
    let state = await transaction(folder,'bootstrap','same',now,true,b)
    assert.equal(Object.keys(state.claims).length,2)
    a.stop(); await a.exit
    state = await transaction(folder,'decide','observer',now+600000,false,reader)
    assert.equal(state.busy,true); assert.equal(Object.keys(state.claims).length,1)
    b.stop(); await b.exit
    state = await transaction(folder,'decide','observer',now+600001,false,reader)
    assert.deepEqual(state.claims,{}); assert.equal(state.busy,false)
    state = await transaction(folder,'decide','observer',state.quietAt+240000,false,reader)
    assert.equal(state.asleep,true); assert.deepEqual(state.claims,{})
    await receive(reader,state.seq)
    const began = performance.now()
    state = await transaction(folder,'bootstrap','new-host',now+840002,true,reader)
    assert.equal((await receive(reader,state.seq)).asleep,false)
    metrics.push({process_identity_source:identitySource,cross_process_file_wake_ms: performance.now()-began,includes_transaction_spawn:true})
    // Cleanup removes only the normally departing owner's marker. A failed or
    // killed generation's retained marker must not be erased by another owner.
    const cleanupToken = `${reader.owner}-cleanup`
    await transaction(folder,'leave','new-host',now+840003,false,reader,'en',cleanupToken)
    assert.equal(await stat(join(folder,`.presence-follow-${reader.owner}.jsonl`)).then(()=>true,()=>false),false)
    assert.equal(await stat(join(folder,'.presence-follow-sameA.jsonl')).then(()=>true,()=>false),true)
  } finally { for (const r of [reader,a,b]) r.stop(); await Promise.all([reader.exit,a.exit,b.exit]) }
})
if (process.env.COCO_TEST_TRANSPORT) test('SIGKILL at every lock and commit step never blocks the next writer', async () => {
  const stages = ['before-lock','lock-acquired','owner-written','inspect-wait','commit-wait','temporary-written','snapshot-renamed','journal-appended','journal-rotated','before-unlock','after-unlock']
  const began = performance.now()
  for (const [index,stage] of stages.entries()) {
    const {folder,reader} = await setup(`crash-step-${stage}`)
    const writer = processLines(['/bin/sh',script,folder,'transaction',`crash${index}`], {...process.env,COCO_TEST_BOUNDARY:stage})
    let fifo = ''
    let contender: ReturnType<typeof processLines> | undefined
    const at = now+index
    const state = {v:1,seq:1,quietAt:at,asleep:false,clingy:false,busy:false,lang:'en',claims:{},event:{kind:'initial',id:`initial:1:${at}`,at,lang:'en'}}
    try {
      if (stage === 'journal-rotated') await writeFile(join(folder,'presence.jsonl'),'x'.repeat(262144))
      for (;;) {
        const line = await writer.next()
        if (line.startsWith('PRESENCE\t')) fifo=line.split('\t')[2]
        if (line === 'INSPECT') await writeFile(fifo,`${reader.pid},${reader.hostPid}\n`)
        if (line === 'READY') await writeFile(fifo,JSON.stringify(state)+'\n')
        if (line.startsWith(`BOUNDARY\t${stage}\t`)) break
      }
      // Start a live contender before the holder dies, so owner-publication races are covered.
      if(stage!=='before-lock'&&stage!=='after-unlock') {
        contender=processLines(['/bin/sh',script,folder,'transaction',`contender${index}`])
        assert.match(await contender.next(),/^CONTENDING\t\d+$/)
      }
      writer.child.kill('SIGKILL'); await writer.exit
      if(contender) {
        let contenderFifo=''
        for(;;){const line=await contender.next();if(line.startsWith('PRESENCE\t'))contenderFifo=line.split('\t')[2];if(line==='INSPECT')break}
        await writeFile(contenderFifo,`${reader.pid},${reader.hostPid}\n`)
        for(;;){if((await contender.next())==='READY')break}
        await writeFile(contenderFifo,'-\n')
        assert.equal(await contender.next(),'COMMITTED');assert.equal(await contender.exit,0)
      }
      // These obsolete gates are deliberate debris. The kernel lock ignores them.
      await writeFile(join(folder,'.presence-reclaim'),'abandoned gate\n')
      await writeFile(join(folder,'.presence-lock'),'abandoned owner\n')
      const recovered = await transaction(folder,'bootstrap',`survivor${index}`,at+1,false,reader)
      assert.ok(recovered.seq>=1)
      assert.deepEqual(JSON.parse(await readFile(join(folder,'snapshot.json'),'utf8')),JSON.parse(JSON.stringify(recovered)))
    } finally { reader.stop();writer.stop();contender?.stop();await Promise.all([reader.exit,writer.exit,contender?.exit]) }
  }
  metrics.push({sigkill_steps:stages.length,all_recovered:true,total_ms:performance.now()-began})
})
if(process.env.COCO_TEST_STARTUP_HOST)test('host killed before helper main rejects reparented startup; blocked lock waiter exits on host death',async()=>{
  const {folder,reader}=await setup('startup-and-lock-parent')
  const native=process.env.COCO_TEST_NATIVE ?? join(script,'..','presence-native-v2')
  const startup=processLines([process.env.COCO_TEST_STARTUP_HOST!,native,folder,'follow','early',''])
  let earlyPid=0,waiterPid=0
  let holder: ReturnType<typeof processLines>|undefined, waiter: ReturnType<typeof processLines>|undefined
  try{
    const startupLine=await startup.next();assert.match(startupLine,/^BEFORE_EXEC\t[1-9]\d*$/)
    earlyPid=Number(startupLine.split('\t')[1]);assert.ok(Number.isSafeInteger(earlyPid)&&earlyPid>1);startup.child.kill('SIGKILL');await startup.exit;process.kill(earlyPid,'SIGCONT')
    const start=performance.now()
    const cpuStart=cpuMilliseconds()
    for(;;){try{process.kill(earlyPid,0)}catch{break}assert.ok(cpuMilliseconds()-cpuStart<3000);await new Promise(r=>setTimeout(r,5))}
    holder=processLines(['/bin/sh',script,folder,'transaction','held'])
    for(;;){if((await holder.next())==='INSPECT')break}
    waiter=processLines(['/bin/sh','-c','/bin/sh "$1" "$2" transaction blocked-parent & wait','test-host',script,folder])
    const line=await waiter.next();assert.match(line,/^CONTENDING\t\d+$/);const pid=Number(line.split('\t')[1]);waiterPid=pid
    waiter.child.kill('SIGKILL');await waiter.exit
    const began=performance.now()
    const cpuBegan=cpuMilliseconds()
    for(;;){try{process.kill(pid,0)}catch{break}assert.ok(cpuMilliseconds()-cpuBegan<3000,'blocked orphan did not exit');await new Promise(r=>setTimeout(r,5))}
    holder.child.kill('SIGKILL');await holder.exit
    await transaction(folder,'bootstrap','survivor',now,false,reader)
    metrics.push({startup_host_exit_ms:performance.now()-start,blocked_waiter_exit_ms:performance.now()-began})
  }finally{reader.stop();startup.stop();holder?.stop();waiter?.stop();for(const pid of[earlyPid,waiterPid])if(Number.isSafeInteger(pid)&&pid>1)try{process.kill(pid,'SIGKILL')}catch{};await Promise.all([reader.exit,startup.exit,holder?.exit,waiter?.exit])}
})
test('native child inventory counts two actual OS children without guessing from buffer size',async()=>{
  const helper=join(plugin,'bin/presence.sh')
  const fixture=processLines(['/bin/sh','-c','/bin/sleep 60 & child=$!; trap \'kill "$child" 2>/dev/null || :\' EXIT; "$1" stats "$$"; kill "$child"; wait "$child" 2>/dev/null || :','native-stats-host',helper])
  try{const rows=JSON.parse(await fixture.next());assert.equal(rows.length,1);assert.equal(rows[0].children,2);assert.equal(await fixture.exit,0)}finally{fixture.stop()}
})
if(process.env.COCO_TEST_TRANSPORT&&process.platform==='darwin')test('write between opening a new request file and registering its watch is delivered without another event',async()=>{
  const folder=join(out,'request-open-gap'),requests=join(folder,'requests.jsonl'),owner='watch-gap'
  await mkdir(folder,{recursive:true,mode:0o700});await writeFile(requests,'')
  const stream=processLines(['/bin/sh','-c','/bin/sh "$1" "$2" follow "$3" "$4" "" "$2/.presence-follow-$3.jsonl" & wait','test-host',script,folder,owner,requests],{...process.env,COCO_TEST_BOUNDARY:'request-opened-before-watch'})
  let pid=0
  try{
    for(;;){const line=await stream.next();if(line.startsWith('FOLLOW\t'))pid=Number(line.split('\t')[1]);if(line.startsWith('BOUNDARY\trequest-opened-before-watch\t'))break}
    await appendFile(requests,'{"v":1,"id":"gap-request"}\n');process.kill(pid,'SIGCONT')
    let observed=false
    for(;;){const line=await stream.next();if(line==='{"v":1,"id":"gap-request"}')observed=true;if(line===`READY\t${owner}`)break}
    assert.equal(observed,true)
  }finally{if(pid)try{process.kill(pid,'SIGKILL')}catch{};stream.stop();await stream.exit}
})
test('unterminated request cannot swallow a following snapshot-only presence header',async()=>{
  const {nodePresenceIO}=await import('./presence-node-io')
  const base=join(out,'partial-request-controller','Library','Application Support'),folder=join(base,'Coco-presence'),actual=join(folder,'native-v2'),companion=join(base,'Coco'),requests=join(companion,'requests.jsonl')
  await mkdir(companion,{recursive:true,mode:0o700});await writeFile(requests,'')
  const seen:number[]=[],errors:unknown[]=[]
  const controller=new SharedPresence(nodePresenceIO() as any,'partial-request',folder,script,{changed:(state:any)=>{seen.push(state.seq)},error:(error:any)=>errors.push(String(error))},undefined,undefined,{requestPath:requests})
  try{
    await controller.start();assert.equal(controller.isRunning,true)
    await appendFile(requests,'{"v":1,"id":"incomplete')
    await new Promise(r=>setTimeout(r,15))
    const old=JSON.parse(await readFile(join(actual,'snapshot.json'),'utf8')),seq=old.seq+10
    await writeFile(join(actual,'replacement'),JSON.stringify({...old,seq})+'\n')
    await rename(join(actual,'replacement'),join(actual,'snapshot.json'))
    const began=cpuMilliseconds()
    while(!seen.includes(seq)){assert.ok(cpuMilliseconds()-began<2000,'snapshot was swallowed by request framing');await new Promise(r=>setTimeout(r,5))}
    assert.deepEqual(errors,[])
  }finally{await controller.end()}
})
test('native process birth is independent of opposite date-line time zones',async()=>{
  const {folder,reader}=await setup('identity-timezones')
  try{
    const identities:string[]=[]
    for(const zone of ['Pacific/Kiritimati','Pacific/Pago_Pago']){
      const writer=processLines(['/bin/sh',script,folder,'transaction',zone.replace(/[^a-z]/gi,'')],{...process.env,TZ:zone})
      let fifo='',inventory=''
      for(;;){const line=await writer.next();if(line.startsWith('PRESENCE\t'))fifo=line.split('\t')[2];if(line==='INSPECT')break}
      await writeFile(fifo,`${reader.pid},${reader.hostPid}\n`)
      for(;;){const line=await writer.next();if(line==='READY')break;inventory+=line+'\n'}
      identities.push(parseProcessInventory(inventory).get(reader.pid)!.birth)
      await writeFile(fifo,'-\n');assert.equal(await writer.next(),'COMMITTED');assert.equal(await writer.exit,0)
    }
    assert.equal(identities[0],identities[1]);assert.match(identities[0],/^(darwin:|linux:)/)
  }finally{reader.stop();await reader.exit}
})
test('native tree inventory includes and deduplicates every owned descendant',async()=>{
  const helper=join(plugin,'bin/presence.sh')
  const fixture=processLines(['/bin/sh','-c','/bin/sleep 60 & child=$!; trap \'kill "$child" 2>/dev/null || :\' EXIT; "$1" stats-tree "$$,$$"; kill "$child"; wait "$child" 2>/dev/null || :','native-tree-host',helper])
  try{const rows=JSON.parse(await fixture.next());assert.equal(rows.length,3);assert.equal(new Set(rows.map((row:any)=>row.pid)).size,3);const parent=rows.find((row:any)=>row.pid===fixture.child.pid)!;assert.equal(parent.children,2);assert.equal(rows.filter((row:any)=>row.parent===parent.pid).length,2);assert.equal(await fixture.exit,0)}finally{fixture.stop()}
})
test('oversized corrupt snapshot recovers bounded journal, and oversized journal recovers valid snapshot then rotates',async()=>{
  const {folder,reader}=await setup('oversized-file-recovery')
  try{
    let state=await transaction(folder,'bootstrap','recovery',now,false,reader)
    const first=state.seq
    await writeFile(join(folder,'snapshot.json'),'x'.repeat(1024*1024))
    state=await transaction(folder,'write','recovery',now+1,true,reader)
    assert.equal(state.busy,true);assert.equal(state.seq,first+1);assert.equal(Object.keys(state.claims).length,1)
    await writeFile(join(folder,'presence.jsonl'),'x'.repeat(1024*1024))
    state=await transaction(folder,'write','recovery',now+2,false,reader)
    assert.equal(state.busy,false);assert.equal(state.seq,first+2);assert.equal(Object.keys(state.claims).length,1)
    assert.ok((await stat(join(folder,'snapshot.json'))).size<=262144)
    assert.ok((await stat(join(folder,'presence.jsonl'))).size<=262144)
    assert.deepEqual(JSON.parse((await readFile(join(folder,'presence.jsonl'),'utf8')).trim()),JSON.parse(JSON.stringify(state)))
  }finally{reader.stop();await reader.exit}
})
let failed = 0
const selected=process.env.COCO_TEST_FILTER?tests.filter(([name])=>name.includes(process.env.COCO_TEST_FILTER!)):tests
for (const [name,run] of selected) { try { await run(); console.log('PASS '+name) } catch (error) { failed++; console.error('FAIL '+name,error) } }
await writeFile(join(out,'metrics.json'),JSON.stringify(metrics,null,2)+'\n')
console.log(JSON.stringify({transport_file_tests:selected.length,process_identity_source:identitySource,failed,metrics}))
process.exitCode = failed ? 1 : 0
