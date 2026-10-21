// Integration receipt: real SharedPresence + native follower, with after() forbidden.
// Run: bun run tools/tests/presence-native-deadline-real.ts [plugin folder] [scratch bin folder]
import { strict as assert } from 'node:assert'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nodePresenceIO } from './presence-node-io'
import { registerScratch } from './scratch-process'

const plugin = resolve(process.argv[2] ?? join(import.meta.dir, '../../plugin'))
const bin = resolve(process.argv[3] ?? join(plugin, 'bin'))
const { SharedPresence } = await import(join(plugin, 'hooks/presence.ts'))
const folder = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'coco-native-deadline-'))
let stop = () => {}
const cleanup = registerScratch(folder, () => stop())
const base = nodePresenceIO(), seen: any[] = [], errors: string[] = []
let afterCalls = 0, controlWrites = 0, ioCalls = 0
const io = { ...base,
  read: async (path: string) => { ioCalls++; return base.read(path) },
  write: async (path: string, text: string) => { ioCalls++; if (path.includes('/.presence-deadline-')) controlWrites++; await base.write(path, text) },
  spawn: (argv: string[]) => { ioCalls++; if (argv[3] === 'deadline-write') controlWrites++; return base.spawn(argv) },
  after: () => { afterCalls++; throw new Error('native presence must never schedule a plugin timer') },
}
const deadlines = { clingyAfter: 1500, sleepAfter: 2400 }
const shared = new SharedPresence(io, 'deadline-real', folder, join(bin, 'presence.sh'), {
  changed: (state: any) => { seen.push(state) }, error: (error: unknown) => { errors.push(String(error)) },
}, deadlines, () => 'en')
stop = () => shared.stop()
async function until(predicate: () => boolean, label: string) {
  const end = Date.now() + 7000
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(`${label}: ${JSON.stringify({ state: shared.current, errors, afterCalls, controlWrites })}`)
    await new Promise(resolve => setTimeout(resolve, 10)) // Test observer only.
  }
}
try {
  const initial = await shared.start(false, { voice: 'light', neighbours: true })
  assert.equal(shared.isRunning, true)
  assert.ok(initial)
  assert.equal(afterCalls, 0)
  const quietAt = initial!.quietAt
  await until(() => shared.current?.clingy === true, 'native clingy expiry')
  assert.equal(shared.current!.clingyEvent!.at, quietAt + deadlines.clingyAfter)
  await until(() => shared.current?.asleep === true, 'native sleep expiry')
  assert.equal(shared.current!.sleepEvent!.at, quietAt + deadlines.sleepAfter)
  assert.equal(afterCalls, 0)
  console.log('PASS actual native waits deliver both quiet transitions with zero plugin after() calls')

  const before = ioCalls, sourceAt = Date.now(), touch = shared.touch('pat', sourceAt)
  assert.equal(shared.current!.asleep, false)
  assert.equal(shared.current!.wakeEvent!.at, sourceAt)
  assert.equal(ioCalls, before)
  await touch
  await shared.activity(true)
  await until(() => shared.current?.busy === true, 'busy cancellation')
  const files = await readdir(join(folder, 'native-v2'))
  const controlName = files.find(name => name.startsWith('.presence-deadline-'))
  assert.ok(controlName)
  assert.match(await readFile(join(folder, 'native-v2', controlName!), 'utf8'), /^\d+\t0\n$/)
  const seenCount = seen.length, writes = controlWrites
  await new Promise(resolve => setTimeout(resolve, 2500))
  assert.equal(shared.current!.asleep, false)
  assert.equal(seen.length, seenCount)
  assert.equal(controlWrites, writes)
  assert.equal(afterCalls, 0)
  console.log('PASS native cancellation stays busy beyond old expiry with zero idle redraw/control-write work')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks: 2, afterCalls, controlWrites, sourceQuietAt: quietAt,
    clingyAt: quietAt + deadlines.clingyAfter, sleepAt: quietAt + deadlines.sleepAfter,
    actualClingyAfterMs: deadlines.clingyAfter, actualSleepAfterMs: deadlines.sleepAfter,
    scope: 'real native integration; thresholds scaled, exact 150/240 seconds covered in engine fixture', errors: 0 }))
} finally {
  try { await shared.end() } finally { cleanup() }
}
