import { describe, expect, test } from 'claude-code/testing'
import type { PresenceIO, PresenceSnapshot } from '../hooks/presence'
import { SharedPresence } from '../hooks/presence'
import { TIMING } from '../hooks/mood'
import { MORNING } from './world'
import { snapshot } from './presence-world'
import { transportFixture } from './presence-transport-fixture'

const drain = async () => { for (let i = 0; i < 800; i++) await Promise.resolve() }
function fixture(native = true, initial: PresenceSnapshot = snapshot(), quietEnabled?:()=>boolean) {
  let now = MORNING, path = '', transactions = 0, ioCalls = 0
  const controls: { generation: number; at: number }[] = [], errors: unknown[] = [], seen: PresenceSnapshot[] = []
  const afterCalls: number[] = [], transport = transportFixture(initial)
  const controller = new SharedPresence({
    now: async () => now,
    read: async value => { ioCalls++; return transport.read(value) },
    write: async () => { throw new Error('unsafe SDK presence write') },
    run: async (argv, text) => {
      const value = argv[5]!
      if (argv[3] !== 'write' || text === undefined) throw new Error('bad secure write command')
      ioCalls++
      if (value === path && path) {
        const match = text.match(/^(\d+)\t(\d+)\n$/)
        if (!match) throw new Error('bad native deadline control')
        controls.push({ generation: Number(match[1]), at: Number(match[2]) }); return { stdout: '', code: 0 }
      }
      await transport.write(value, text)
      return { stdout: '', code: 0 }
    },
    spawn: argv => {
      ioCalls++
      if (argv[3] === 'deadline-write') {
        const match = argv[5]!.match(/^(\d+)\t(\d+)\n$/)
        if (!match) throw new Error('bad native deadline control')
        controls.push({ generation: Number(match[1]), at: Number(match[2]) })
        return { async next() { return { done: true, value: { code: 0, signal: null } } }, async return() { return { done: true, value: { code: 0, signal: null } } } } as never
      }
      if (argv[3] !== 'follow') { if (argv[3] === 'transaction') transactions++; return transport.spawn('deadline-session', argv) }
      path = argv[8] ?? ''
      const child = transport.spawn('deadline-session', argv)
      return { ...child, async next() {
        const chunk = await child.next()
        if (!chunk.done && native && chunk.value.stream === 'stdout')
          chunk.value.text = chunk.value.text.replace(/^(FOLLOW\t\d+)\n/, '$1\tDEADLINE1\n')
        return chunk
      } }
    },
    after: (ms: number) => { afterCalls.push(ms); return () => {} },
  } as PresenceIO, 'deadline-session', '/tmp/b1-deadline', '/plugin/bin/presence.sh', {
    changed: state => { seen.push(state) }, error: error => { errors.push(error) },
  }, {sleepAfter:TIMING.sleepAfter,clingyAfter:150000,enabled:quietEnabled})
  const emit = async (control: { generation: number; at: number }) => {
    transport.request(path, `DEADLINE\t${control.generation}\t${control.at}\n`); await drain()
  }
  return {
    controller, controls, errors, seen, afterCalls, transport,
    transactions: () => transactions, ioCalls: () => ioCalls,
    now: () => now, emit,
    async advance(ms: number) {
      const until = now + ms
      for (let i = 0; i < 16; i++) {
        const control = controls.at(-1)
        if (!control?.at || control.at > until) break
        now = Math.max(now, control.at)
        const count = controls.length
        await emit(control)
        if (controls.length === count) break
      }
      now = until; await drain()
    },
  }
}

test('M1 native presence with Lively off keeps deadline zero and has no idle reads or wakes',async()=>{
 const f=fixture(true,snapshot(),()=>false);await f.controller.start();await drain()
 try {
  expect(f.controls.at(-1)?.at).toBe(0);expect(f.afterCalls).toEqual([])
  const calls=f.ioCalls(),transactions=f.transactions();await f.advance(600000)
  expect(f.ioCalls()).toBe(calls);expect(f.transactions()).toBe(transactions);expect(f.controller.current?.asleep).toBe(false)
 } finally {f.controller.stop()}
})

test('M1 native shared Lively off cancels the previous deadline',async()=>{
 let enabled=true
 const f=fixture(true,snapshot(),()=>enabled);await f.controller.start();await drain()
 try {
  expect(f.controls.at(-1)?.at).toBe(MORNING+150000)
  enabled=false;await f.controller.quietChanged();expect(f.controls.at(-1)?.at).toBe(0)
  const calls=f.ioCalls();await f.advance(600000);expect(f.ioCalls()).toBe(calls)
 } finally {f.controller.stop()}
})

test('M1 native deadline packet cannot wake a row switched off before its control write',async()=>{
 let enabled=true
 const f=fixture(true,snapshot(),()=>enabled);await f.controller.start();await drain()
 try {
  const control=f.controls.at(-1)!,transactions=f.transactions();enabled=false
  await f.emit(control);expect(f.transactions()).toBe(transactions)
 } finally {f.controller.stop()}
})

describe('native shared presence deadlines without idle plugin timers', () => {
  test('native capability keeps the controller active with zero io.after and exact clingy and hashed sleep decisions', async () => {
    const f = fixture(); await f.controller.start(); await drain()
    try {
      expect(f.controller.isRunning).toBe(true)
      expect(f.afterCalls).toEqual([])
      expect(f.controls.at(-1)?.at).toBe(MORNING + 150000)
      const io = f.ioCalls()
      await f.advance(149999)
      expect(f.ioCalls()).toBe(io)
      expect(f.controller.current?.clingy).toBe(false)
      expect(f.controller.current?.asleep).toBe(false)
      await f.advance(1)
      expect(f.controller.current?.clingy).toBe(true)
      expect(f.controller.current?.clingyEvent?.at).toBe(MORNING + 150000)
      expect(f.controls.at(-1)?.at).toBe(MORNING + TIMING.sleepAfter(MORNING))
      await f.advance(TIMING.sleepAfter(MORNING) - 150001)
      expect(f.controller.current?.asleep).toBe(false)
      await f.advance(1)
      expect(f.controller.current?.asleep).toBe(true)
      expect(f.controller.current?.sleepEvent?.at).toBe(MORNING + TIMING.sleepAfter(MORNING))
      expect(f.controls.at(-1)?.at).toBe(0)
      expect(f.afterCalls).toEqual([])
    } finally { f.controller.stop(); await drain() }
    expect(f.errors).toEqual([])
  })

  test('busy and a later activity generation cancel stale native deadlines without spawning a decision', async () => {
    const f = fixture(); await f.controller.start(); await drain()
    try {
      const stale = f.controls.at(-1)!
      await f.controller.activity(true); await drain()
      expect(f.controls.at(-1)?.at).toBe(0)
      const before = f.transactions()
      await f.emit(stale)
      expect(f.transactions()).toBe(before)
      await f.advance(300000)
      expect(f.controller.current?.busy).toBe(true)
      expect(f.controller.current?.asleep).toBe(false)
      await f.controller.activity(false); await drain()
      expect(f.controls.at(-1)?.at).toBe(f.now() + 150000)
      await f.emit(stale)
      expect(f.controller.current?.clingy).toBe(false)
      await f.advance(TIMING.sleepAfter(f.controller.current!.quietAt))
      expect(f.controller.current?.asleep).toBe(true)
      expect(f.afterCalls).toEqual([])
    } finally { f.controller.stop(); await drain() }
    expect(f.errors).toEqual([])
  })

  test('touch reaction precedes native deadline file IO and an old deadline cannot overtake it', async () => {
    const f = fixture(); await f.controller.start(); await drain()
    try {
      const stale = f.controls.at(-1)!, before = f.ioCalls()
      const pending = f.controller.touch('pat', f.now())
      expect(f.ioCalls()).toBe(before)
      expect(f.seen.at(-1)?.touchEvent?.touch).toBe('pat')
      await pending; await drain()
      const writes = f.transactions()
      await f.emit(stale)
      expect(f.transactions()).toBe(writes)
      expect(f.afterCalls).toEqual([])
    } finally { f.controller.stop(); await drain() }
    expect(f.errors).toEqual([])
  })

  test('early or repeated native delivery cannot lose the next deadline or replay a decision', async () => {
    const f = fixture(); await f.controller.start(); await drain()
    try {
      const original = f.controls.at(-1)!
      await f.emit(original)
      expect(f.controller.current?.clingy).toBe(false)
      expect(f.controls.at(-1)?.at).toBe(original.at)
      expect(f.controls.at(-1)?.generation).not.toBe(original.generation)
      const writes = f.transactions()
      await f.emit(original)
      expect(f.transactions()).toBe(writes)
      await f.advance(150000)
      expect(f.controller.current?.clingy).toBe(true)
      expect(f.afterCalls).toEqual([])
    } finally { f.controller.stop(); await drain() }
    expect(f.errors).toEqual([])
  })

  test('a legacy follower schedules only the earliest one-shot fallback deadline', async () => {
    const f = fixture(false); await f.controller.start(); await drain()
    expect(f.controller.isRunning).toBe(true)
    expect(f.afterCalls).toEqual([150000])
    expect(f.controls).toEqual([])
    f.controller.stop(); await drain()
    expect(f.errors).toEqual([])
  })
})
