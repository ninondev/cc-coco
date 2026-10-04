import { describe, expect, test } from 'claude-code/testing'
import { CompanionChannel } from '../hooks/channel'

const FOLDER = '/tmp/shared-channel/Library/Application Support/Claude-sama'
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
