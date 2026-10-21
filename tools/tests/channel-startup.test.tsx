import { describe, expect, test } from 'claude-code/testing'
import { CompanionChannel } from '../hooks/channel'

const FOLDER = '/tmp/shared-channel/Library/Application Support/Coco'
const REQUESTS = `${FOLDER}/requests.jsonl`
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

function callbacks(errors: unknown[], change: () => Promise<void> = async () => {}) {
  let active = false
  return {
    running: (value: boolean) => { active = value },
    seen: () => {},
    ack: async () => {},
    changed: change,
    error: (error: unknown) => { errors.push(error) },
    active: () => active,
  }
}

function sleepingChild() {
  return {
    next: () => new Promise(() => {}),
    return: async () => ({ done: true, value: { code: null, signal: null } }),
  } as never
}

describe('channel startup failure isolation', () => {
  test('throwing the first shared-folder read degrades without rejecting setup', async () => {
    const failure = new Error('folder check failed')
    const errors: unknown[] = []
    const cb = callbacks(errors)
    const io = {
      exists: async () => { throw failure }, write: async () => {},
      spawn: () => sleepingChild(), now: async () => 1,
      submit: async () => {}, clear: async () => {},
    }
    const channel = new CompanionChannel(io, 'session', FOLDER, cb)
    await expect(channel.start()).resolves.toBeUndefined()
    expect(cb.active()).toBe(false)
    expect(errors).toEqual([failure])
  })

  test('four simultaneous starts never truncate a request created after an existence check', async () => {
    const errors: unknown[] = []
    const writes: string[] = []
    const ensured: string[] = []
    // Each session sees the same stale missing-file result. The app has appended
    // a request by the time their create step runs.
    let sharedText = '{"v":1,"id":"0123456789abcdef","kind":"seen"}\n'
    const io = {
      exists: async (path: string) => path !== REQUESTS,
      write: async (_path: string, text: string) => { writes.push(text); sharedText = text },
      ensureRequests: async (path: string) => { ensured.push(path) },
      spawn: () => sleepingChild(), now: async () => 1,
      submit: async () => {}, clear: async () => {},
    }
    const channels = Array.from({ length: 4 }, (_, n) => new CompanionChannel(io, `s${n}`, FOLDER, callbacks(errors)))
    await Promise.all(channels.map(channel => channel.start()))
    expect(writes).toEqual([])
    expect(ensured).toEqual([REQUESTS, REQUESTS, REQUESTS, REQUESTS])
    expect(sharedText).toBe('{"v":1,"id":"0123456789abcdef","kind":"seen"}\n')
    channels.forEach(channel => channel.stop())
    await drain()
    expect(errors).toEqual([])
  })

  test('a synchronous spawn failure is caught and available to opt-in diagnostics', async () => {
    const failure = new Error('cannot start tail')
    const errors: unknown[] = []
    const cb = callbacks(errors)
    const io = {
      exists: async () => true, write: async () => {},
      spawn: () => { throw failure }, now: async () => 1,
      submit: async () => {}, clear: async () => {},
    }
    const channel = new CompanionChannel(io, 'session', FOLDER, cb)
    await channel.start()
    expect(cb.active()).toBe(false)
    expect(errors).toEqual([failure])
  })

  test('a rejected first pull stops the child and reports the error', async () => {
    const failure = new Error('tail first pull failed')
    const errors: unknown[] = []
    const cb = callbacks(errors)
    let returned = false
    const child = {
      next: async () => { throw failure },
      return: async () => { returned = true; return { done: true, value: { code: null, signal: null } } },
    } as never
    const io = {
      exists: async () => true, write: async () => {},
      spawn: () => child, now: async () => 1,
      submit: async () => {}, clear: async () => {},
    }
    const channel = new CompanionChannel(io, 'session', FOLDER, cb)
    await channel.start()
    await drain()
    expect(cb.active()).toBe(false)
    expect(returned).toBe(true)
    expect(errors).toEqual([failure])
  })
})

describe('one shared follower for presence and requests', () => {
  test('subscribes without creating a second process and preserves request acknowledgements', async () => {
    let receive!: (text: string) => Promise<void>, end!: () => void
    let spawns = 0, ensures = 0, unsubscribes = 0, actions = 0, notes = 0, acks = 0
    const errors: unknown[] = []
    const channel = new CompanionChannel({
      exists: async () => true,
      listen: (read, ended) => { receive = read; end = ended; return () => { unsubscribes++ } },
      ensureRequests: async () => { ensures++ },
      spawn: () => { spawns++; return sleepingChild() },
      now: async () => 1000,
      authorize: async () => true, submit: async () => { actions++ }, clear: async () => {},
    }, 'session', FOLDER, { note: () => { notes++ }, running: () => {}, seen: () => {}, ack: async () => { acks++ }, changed: async () => {}, error: e => errors.push(e) })
    await channel.start()
    expect(typeof receive).toBe('function');expect(typeof end).toBe('function')
    const line = JSON.stringify({ v: 1, id: '0123456789abcdef', kind: 'submit', session: 'session', at: 1000, text: 'hello' }) + '\n'
    await receive(line.slice(0, 20)); await receive(line.slice(20))
    expect(actions).toBe(0); expect(notes).toBe(1); expect(acks).toBe(1)
    expect(spawns).toBe(0); expect(ensures).toBe(0)
    end(); await drain()
    expect(channel.isRunning).toBe(false); expect(unsubscribes).toBe(1)
    expect(errors).toEqual([])
  })
  test('a shared request clock rejection stops only its subscription and reports once', async () => {
    let receive!: (text: string) => Promise<void>
    let unsubscribes = 0, spawns = 0, changes = 0, actions = 0
    const failure = new Error('request clock unavailable'), errors: unknown[] = []
    const cb = callbacks(errors,async()=>{changes++})
    const channel = new CompanionChannel({
      exists: async()=>true,
      listen: read=>{receive=read;return()=>{unsubscribes++}},
      spawn: ()=>{spawns++;return sleepingChild()},
      now: async()=>{throw failure},
      submit: async()=>{actions++},clear:async()=>{},
    },'session',FOLDER,cb)
    await channel.start()
    expect(typeof receive).toBe('function')
    await expect(receive(JSON.stringify({v:1,id:'0123456789abcdef',kind:'submit',session:'session',at:1000,text:'hello'})+'\n')).resolves.toBeUndefined()
    await drain()
    expect(channel.isRunning).toBe(false)
    expect(cb.active()).toBe(false)
    expect(unsubscribes).toBe(1)
    expect(spawns).toBe(0);expect(actions).toBe(0);expect(changes).toBe(1)
    expect(errors).toEqual([failure])
  })

})
