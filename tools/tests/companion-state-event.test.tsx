import { describe, expect, test } from 'claude-code/testing'
import { CompanionChannel } from '../hooks/channel'

const FOLDER = '/tmp/companion-state-events'
const NOW = 100000
const drain = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
function fixture(events: unknown[]) {
  let probes = 0, actions = 0
  const states: Record<string, unknown>[] = []
  let wake!: () => void
  const wait = new Promise<void>(resolve => { wake = resolve })
  const io = {
    exists: async () => { probes++; return true },
    ensureRequests: async () => {},
    now: async () => NOW,
    submit: async () => { actions++ }, clear: async () => { actions++ },
    spawn: () => (async function* () {
      await wait
      for (const event of events) yield { stream: 'stdout' as const, text: JSON.stringify(event) + '\n' }
      await new Promise(() => {})
      return { code: null, signal: null }
    })(),
  }
  const channel = new CompanionChannel(io, 's1', FOLDER, {
    running: () => {}, seen: () => { actions++ }, ack: async () => { actions++ },
    changed: async () => {}, companionState: async info => { states.push(info) },
  })
  return { channel, states, wake, probes: () => probes, actions: () => actions }
}

describe('native companion settings broadcast', () => {
  test('a state event reaches the redraw callback without a probe, timer, prompt or acknowledgement', async () => {
    const f = fixture([{ v: 1, kind: 'companion-state', at: NOW, info: {
      running: false, accessibility: true, hiddenUntil: 60, answered: NOW,
      size: 'small', sizeAt: NOW, loginAt: NOW, followAt: NOW, login: false, version: '1',
      text: 'PRIVATE REPLY', path: '/private/user-file', prompt: 'PRIVATE PROMPT',
    } }])
    await f.channel.start(); const probes = f.probes(); f.wake(); await drain()
    expect(f.probes()).toBe(probes)
    expect(f.actions()).toBe(0)
    expect(f.states).toEqual([{ running: false, accessibility: true, hiddenUntil: 60000,
      answered: NOW, size: 'small', sizeAt: NOW, loginAt: NOW, followAt: NOW, login: false, version: '1' }])
    f.channel.stop()
  })
  test('invalid and stale broadcasts cannot replace visible settings', async () => {
    const f = fixture([
      { v: 1, kind: 'companion-state', at: NOW - 60001, info: { running: true } },
      { v: 2, kind: 'companion-state', at: NOW, info: { running: true } },
      { v: 1, kind: 'companion-state', at: NOW, info: [] },
      { v: 1, kind: 'companion-state', at: NOW, info: { size: 'enormous', answered: Infinity, hiddenUntil: Infinity, login: 'yes', running: 'yes' } },
    ])
    await f.channel.start(); f.wake(); await drain()
    expect(f.states).toEqual([{}]); expect(f.actions()).toBe(0)
    f.channel.stop()
  })
})
