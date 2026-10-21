// Two independent JavaScript hosts, each with the shipping native-v2 follower.
// Run: bun run tools/tests/presence-native-touch-real.ts [plugin folder]
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { nodePresenceIO } from './presence-node-io'
import { registerScratch } from './scratch-process'

async function worker(plugin: string, folder: string, session: string) {
  const { SharedPresence } = await import(join(plugin, 'hooks/presence.ts'))
  let calls = 0
  const base = nodePresenceIO(), io = { ...base,
    read: async (path: string) => { calls++; return base.read(path) },
    write: async () => { throw new Error('unsafe SDK presence write') },
    run: async (argv: string[], stdin?: string) => { calls++; return base.run(argv, stdin) },
    now: async () => { calls++; return base.now() },
    spawn: (argv: string[]) => { calls++; return base.spawn(argv) },
    after: (ms: number, callback: () => void) => { calls++; return base.after(ms, callback) },
  }
  const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
  const shared = new SharedPresence(io, session, folder, join(plugin, 'bin/presence.sh'), {
    changed: state => { emit({ changed: state }) }, error: error => { emit({ error: String(error) }) },
  }, { sleepAfter: 120000, clingyAfter: 60000 }, () => 'zh')
  await shared.peek()
  await shared.start(false, { voice: 'light', marks: true })
  emit({ ready: true, session, pid: process.pid, state: shared.current })
  const commands = createInterface({ input: process.stdin })
  for await (const line of commands) {
    const action = JSON.parse(line), before = calls
    if (action.command === 'stop') { await shared.end(); emit({ done: action.id }); break }
    const pending = action.command === 'touch' ? shared.touch(action.touch, action.at, action.by)
      : shared.settings(action.values, action.at)
    emit({ local: action.id, state: shared.current, ioBeforeDraw: calls - before })
    await pending
    emit({ done: action.id, state: shared.current })
  }
  commands.close(); process.stdin.destroy()
}

if (process.argv[2] === '--worker') {
  await worker(process.argv[3]!, process.argv[4]!, process.argv[5]!)
} else {
  const plugin = resolve(process.argv[2] ?? join(import.meta.dir, '../../plugin'))
  const folder = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'coco-presence-touch-'))
  let stopWorkers = () => {}
  const cleanup = registerScratch(folder, () => stopWorkers())
  const snapshotPath = join(folder, 'native-v2', 'snapshot.json')
  await mkdir(join(folder, 'native-v2'), { recursive: true, mode: 0o700 })
  const at = Date.now()
  const sleep = { kind: 'sleep', id: `sleep:10:${at}`, at, lang: 'zh' }
  await writeFile(snapshotPath, JSON.stringify({ v: 1, seq: 10, quietAt: at - 121000, asleep: true, clingy: true, busy: false, lang: 'zh',
    event: sleep, sleepEvent: sleep, claims: {}, settings: { voice: 'off', companionTarget: 'mobile', neighbours: true, future: { enabled: true } } }) + '\n')
  const notifications = new Set<() => void>(), errors: string[] = []
  let serial = 0
  function host(session: string) {
    const child = spawn(process.execPath, ['run', import.meta.filename, '--worker', plugin, folder, session], { stdio: ['pipe', 'pipe', 'pipe'] })
    const output = createInterface({ input: child.stdout })
    const local = new Map<number, any>(), done = new Map<number, any>()
    const host = { child, state: undefined as any, ready: false, pid: 0, local, done,
      send(command: Record<string, unknown>) { const id = ++serial; child.stdin.write(JSON.stringify({ id, ...command }) + '\n'); return id } }
    output.on('line', line => {
      try {
        const message = JSON.parse(line)
        if (message.changed) host.state = message.changed
        if (message.ready) { host.ready = true; host.pid = message.pid; host.state = message.state }
        if (message.local) local.set(message.local, message)
        if (message.done) done.set(message.done, message)
        if (message.error) errors.push(message.error)
        for (const wake of notifications) wake()
      } catch (error) { errors.push(String(error)) }
    })
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { errors.push(text) })
    return host
  }
  const a = host('real-0'), b = host('real-1'), peers = [a, b]
  stopWorkers = () => { for (const peer of peers) { peer.child.stdin.end(); if (peer.child.exitCode === null) peer.child.kill('SIGTERM') } }
  function until(predicate: () => boolean, label: string): Promise<void> {
    if (predicate()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const check = () => { if (!predicate()) return; clearTimeout(timer); notifications.delete(check); resolve() }
      const timer = setTimeout(() => { notifications.delete(check); reject(new Error(`${label}: ${JSON.stringify({ errors, states: peers.map(peer => peer.state) })}`)) }, 5000)
      notifications.add(check)
    })
  }
  try {
    await until(() => peers.every(peer => peer.ready), 'native host ready')
    assert.notEqual(a.pid, b.pid)
    for (const touch of ['poke', 'pat', 'burst', 'hug', 'drag']) for (const by of ['band', 'companion']) {
      const previous = JSON.parse(await readFile(snapshotPath, 'utf8')), sleepingAt = Date.now(), seq = previous.seq + 1
      const sleep = { kind: 'sleep', id: `sleep:${seq}:${sleepingAt}`, at: sleepingAt, lang: 'zh' }
      await writeFile(`${snapshotPath}.next`, JSON.stringify({ ...previous, seq, quietAt: sleepingAt - 121000, asleep: true, event: sleep, sleepEvent: sleep }) + '\n')
      await rename(`${snapshotPath}.next`, snapshotPath)
      await until(() => peers.every(peer => peer.state?.asleep && peer.state.seq >= seq), `sleep before ${by}/${touch}`)
      const sourceAt = Date.now(), id = a.send({ command: 'touch', touch, by, at: sourceAt })
      await until(() => a.local.has(id), `local ${by}/${touch}`)
      assert.equal(a.local.get(id).ioBeforeDraw, 0)
      assert.equal(a.local.get(id).state.asleep, false)
      assert.equal(a.local.get(id).state.wakeEvent.at, sourceAt)
      await until(() => a.done.has(id) && peers.every(peer => peer.state?.touchEvent?.id === `touch:${by}:${sourceAt}`), `shared ${by}/${touch}`)
      for (const peer of peers) {
        assert.equal(peer.state.asleep, false)
        assert.equal(peer.state.wakeEvent.at, sourceAt)
        assert.equal(peer.state.touchEvent.touch, touch)
        assert.equal(peer.state.touchEvent.session, by === 'band' ? 'real-0' : undefined)
      }
      console.log(`PASS native ${by}/${touch}: two hosts awake; zero I/O before local draw; same source at=${sourceAt}`)
    }
    const settingAt = Date.now(), id = a.send({ command: 'settings', values: { voice: 'full', affection: 'clingy', marks: 'off' }, at: settingAt })
    await until(() => a.done.has(id) && b.state?.settings?.voice === 'full', 'shared settings')
    assert.equal(a.local.get(id).ioBeforeDraw, 0)
    assert.deepEqual(b.state.settings, { voice: 'full', affection: 'clingy', companionTarget: 'mobile', neighbours: true, future: { enabled: true }, marks: 'off' })
    assert.deepEqual(a.state.settingsEvent, b.state.settingsEvent)
    console.log('PASS native settings: voice, warmth and marks fresh in two hosts; future settings preserved')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ checks: 11, javascriptHosts: 2, errors: 0, hostPids: peers.map(peer => peer.pid) }))
  } finally {
    const stop = peers.map(peer => peer.send({ command: 'stop' }))
    try { await until(() => peers.every((peer, index) => peer.done.has(stop[index]!)), 'native host stop') } finally {
      cleanup()
    }
  }
}
