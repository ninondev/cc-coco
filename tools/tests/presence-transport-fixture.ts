import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import type { PresenceSnapshot } from '../hooks/presence'
import { joinPath, windowsPath } from '../hooks/paths'

// Filesystem/process emulation only. All decisions run the shipping TypeScript. A Windows folder gets the Windows
// helper's paths and process facts (companion-rs/src/presence_helper.rs: backslashes, windows: births, uid 0).
const helperFacts = (folder: string, n: number) => windowsPath(folder)
  ? { birth: `windows:${n}`, uid: 0, follower: 'C:\\fixture\\coco-companion.exe', host: 'C:\\fixture\\claude.exe' }
  : { birth: `darwin:${n}:1`, uid: 501, follower: '/fixture/presence-follow', host: '/fixture/host' }
export function transportFixture(initial: PresenceSnapshot, options: { remoteBusy?: boolean; noTransport?: boolean; firstPullFails?: boolean; deferReady?: boolean } = {}) {
  let state = { ...initial, claims: (initial as any).claims ?? {} } as any
  const streams = new Map<string, { packets: string[]; wake?: () => void; folder: string; owner: string }>()
  const transactions = new Map<string, { push: (text: string) => void; release: () => void; inspected: boolean; device: string; inode: string }>()
  const alive = new Map<number, { birth: string; uid: number; executable: string; registeredOwner?: string; parent: number }>()
  const sendBuffers = new Map<string, string>()
  let pidCount = 8000
  let lock: Promise<void> = Promise.resolve()
  let writeGate: Promise<void> | undefined
  const births = new Map<string, { pid: number; birth: string }>()
  const broadcast = (text: string, header = true) => { for (const stream of streams.values()) { stream.packets.push(header ? `==> ${joinPath(stream.folder, 'presence.jsonl')} <==\n${text}` : text); stream.wake?.(); stream.wake = undefined } }
  if (options.remoteBusy ?? initial.busy) {
    alive.set(7000, { parent: 1, birth: 'darwin:10:1', uid: 501, executable: '/fixture/presence-follow', registeredOwner: 'remote' })
    state.claims.remote = { pid: 7000, birth: alive.get(7000)!.birth, busy: true, owner: 'remote', session: 'remote', uid: 501, executable: '/fixture/presence-follow' }
  }
  return {
    get state() { return state },
    read: async (_path: string) => JSON.stringify(state),
    holdWrites() { let release!: () => void; writeGate = new Promise<void>(resolve => { release = resolve }); return () => { writeGate = undefined; release() } },
    kill(session: string) { const host = births.get(session); if (host) alive.delete(host.pid) },
    insertSession(session:string,metadata:{cwd:string;ribbon:number;ribbonAt:number},at:number){
      const host={pid:++pidCount,birth:`darwin:${pidCount}:1`},owner=`fixture-${host.pid}`,folder=[...streams.values()][0]?.folder??'/fixture-presence'
      births.set(session,host)
      alive.set(host.pid,{parent:host.pid+10000,birth:host.birth,uid:501,executable:'/fixture/presence-follow',registeredOwner:owner})
      alive.set(host.pid+10000,{parent:1,birth:host.birth,uid:501,executable:'/fixture/host'})
      state={...state,seq:state.seq+1,event:{kind:'activity',id:`activity:${state.seq+1}:${at}`,at},claims:{...state.claims,[session]:{session,owner,pid:host.pid,birth:host.birth,hostPid:host.pid+10000,hostBirth:host.birth,uid:501,executable:'/fixture/presence-follow',busy:false,...metadata}}}
      broadcast(JSON.stringify(state)+'\n');return streams.size>0
    },
    removeSession(session:string,at:number){
      const host=births.get(session);if(host){alive.delete(host.pid);alive.delete(host.pid+10000);births.delete(session)}
      const claims={...state.claims};delete claims[session]
      state={...state,claims,seq:state.seq+1,event:{kind:'activity',id:`activity:${state.seq+1}:${at}`,at}}
      broadcast(JSON.stringify(state)+'\n');return streams.size>0
    },
    remote(value: PresenceSnapshot) { state = { ...value, claims: state.claims }; if (value.busy && !Object.values(state.claims).some((claim: any) => claim.busy)) state.claims.remote = { pid: 7000, birth: 'darwin:10:1', busy: true, owner: 'remote', session: 'remote', uid: 501, executable: '/fixture/presence-follow' }; if (!value.busy) { for (const claim of Object.values(state.claims) as any[]) claim.busy = false }; broadcast(JSON.stringify(state) + '\n'); return streams.size > 0 },
    malformed: (text: string) => broadcast(text,false),
    request(path: string, text: string) { for (const stream of streams.values()) { stream.packets.push(`==> ${path} <==\n${text}`); stream.wake?.(); stream.wake = undefined } },
    ready() { for (const stream of streams.values()) { stream.packets.push(`==> ${joinPath(stream.folder, `.presence-follow-${stream.owner}.jsonl`)} <==\nREADY\t${stream.owner}\n`); stream.wake?.(); stream.wake = undefined } },
    write: async (path: string, text: string) => {
      await writeGate
      const transaction = transactions.get(path)
      if (!transaction) throw new Error('missing fixture FIFO ' + path)
      if (!transaction.inspected) {
        transaction.inspected = true
        transaction.push(`${[...alive].map(([pid, identity]) => `PID\t${pid}\t${identity.parent}\t${identity.birth}\t${identity.uid}\t${identity.executable}\t${identity.registeredOwner ?? ''}\n`).join('')}READY\n`)
        return
      }
      if (text.trim() && text.trim() !== '-') { state = JSON.parse(text); broadcast(JSON.stringify(state) + '\n') }
      transaction.push('COMMITTED\n')
      transaction.release()
      transactions.delete(path)
    },
    spawn(session: string, argv: string[]): HookStream<ProcessSpawnChunk, ProcessSpawnResult> {
      if (argv[3] === 'fifo-send') {
        let ended = false
        const path = argv[4]!, transaction = transactions.get(path)
        if (!transaction || transaction.device !== argv[5] || transaction.inode !== argv[6]) throw new Error('invalid fixture FIFO receipt')
        const buffered = (sendBuffers.get(path) ?? '') + argv[7]!
        const newline = buffered.indexOf('\n')
        const delivery = newline < 0 ? Promise.resolve() : this.write(path, buffered.slice(0, newline + 1))
        if (newline < 0) sendBuffers.set(path, buffered); else sendBuffers.delete(path)
        return { async next() { await delivery; ended = true; return { done: true, value: { code: 0, signal: null } } }, async return() { return { done: true, value: { code: ended ? 0 : null, signal: null } } }, [Symbol.asyncIterator]() { return this } } as HookStream<ProcessSpawnChunk, ProcessSpawnResult>
      }
      const packets: string[] = []
      const following = argv[3] === 'follow' || argv[0] === '/usr/bin/tail'
      let wake: (() => void) | undefined, done = false, releaseOnReturn: (() => void) | undefined
      const push = (text: string) => { packets.push(text); wake?.(); wake = undefined }
      if (following) {
        if (options.firstPullFails) throw new Error('presence unavailable')
        const stream = { packets, folder: argv[2], owner: argv[4], get wake() { return wake }, set wake(value) { wake = value } }
        streams.set(session, stream)
        const facts = helperFacts(argv[2]!, 10)
        let host = births.get(session)
        if (!host) { host = { pid: ++pidCount, birth: facts.birth }; births.set(session, host) }
        alive.set(host.pid, { parent: host.pid + 10000, birth: host.birth, uid: facts.uid, executable: facts.follower, registeredOwner: argv[4] })
        alive.set(host.pid + 10000, { parent: 1, birth: host.birth, uid: facts.uid, executable: facts.host })
        packets.push(`FOLLOW\t${host.pid}\n==> ${joinPath(argv[2]!, 'presence.jsonl')} <==\n${JSON.stringify(state)}\n`)
        if (!options.deferReady) packets.push(`==> ${joinPath(argv[2]!, `.presence-follow-${argv[4]}.jsonl`)} <==\nREADY\t${argv[4]}\n`)
      } else {
        let release!: () => void
        const prior = lock
        lock = new Promise<void>(resolve => { release = resolve }); releaseOnReturn = release
        void prior.then(() => {
          if (options.noTransport) { done = true; release(); wake?.(); return }
          let host = births.get(session)
          if (!host) { host = { pid: ++pidCount, birth: helperFacts(argv[2]!, 10).birth }; births.set(session, host) }
          const fifo = joinPath(argv[2]!, `.presence-${argv[4]}`, 'commit')
          transactions.set(fifo, { push: text => { push(text); if (text === 'COMMITTED\n') done = true }, release, inspected: false, device: '1', inode: String(++pidCount) })
          push(`PRESENCE\t${host.pid + 10000}\t${fifo}\t1\t${pidCount}\nSTATE\t${JSON.stringify(state)}\nINSPECT\n`)
        })
      }
      return {
        next: async () => { if (!packets.length && !done) await new Promise<void>(resolve => { wake = resolve }); return packets.length ? { done: false, value: { stream: 'stdout', text: packets.shift()! } } : { done: true, value: { code: options.noTransport ? 69 : 0, signal: null } } },
        return: async () => { done = true; releaseOnReturn?.(); if (following && streams.get(session)?.packets === packets) streams.delete(session); wake?.(); return { done: true, value: { code: 0, signal: null } } },
        [Symbol.asyncIterator]() { return this },
      } as HookStream<ProcessSpawnChunk, ProcessSpawnResult>
    },
  }
}
