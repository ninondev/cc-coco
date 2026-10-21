import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { executeC3Algo } from '../hooks/algo-core.mjs'
import { recognize } from '../hooks/algo/runs'
import { sha256 } from '../hooks/history-key'
import { reminderSettings } from '../hooks/reminder-settings'
import { world, RECENT, settleLegacyStart } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'

const MARKER = 'P1_PRIVATE_TOOL_CONTENT_c729a48e'
const LEGACY_MARKER = 'P1_LEGACY_TOOL_CONTENT_d849b'
const LEGACY_SAMPLES = [{ ms: 1200, outcome: 'pass' }, { ms: 3000, outcome: 'fail' }, { ms: 2400, outcome: 'unknown' }]
const SECRET = 'sk-ant-api03-' + 'x'.repeat(60)
// Evidence controls override this only in a scratch test copy, never shipping.
const SYNTHETIC_FEATURE_OFF: Record<string, unknown> = {}
const START = { cwd: '/tmp/p1-persistence-project', surface: 'terminal' as const, isInteractive: true }
const COMPLETE = { turnId: 'p1-persistence-turn', answer: 'done', reason: 'answer' as const, durationMs: 1500, isAborted: false }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

function fixture(on: On, seed: Record<string, unknown> = {}) {
  let turnsReads = 0
  on('session.turns', () => { turnsReads++; return { value: 0 } })
  const reads: { key: string; origin: string }[] = [], writes: { key: string; value: unknown }[] = [], workerOps: string[] = [], elapsed: number[] = []
  on('store.*', ($, e, next) => {
    if (next.is('store.get', e)) reads.push({ key: e.key, origin: next.origin.plugin ?? '' })
    if (next.is('store.set', e)) writes.push({ key: e.key, value: e.value })
    return next(e)
  })
  // Execute the exact shipping algorithm adapter in memory. Host process and
  // tool calls are inert; this does not execute Bash or spawn an algorithm worker.
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('algo-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      workerOps.push(request.op)
      if (request.op === 'finish') elapsed.push(request.ms)
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result: executeC3Algo(request) ?? null }) } }
    }
    return { value: OK }
  })
  on('ui.notice', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  const w = world(on, {
    store: { ...RECENT, runs: { ['npm test ' + LEGACY_MARKER]: LEGACY_SAMPLES }, ...seed, bandSettings: SYNTHETIC_FEATURE_OFF }, sessionRoot: START.cwd, surfaces: ['terminal'],
    env: { HOME: '/tmp/p1-persistence-home', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' },
    readText: path => path.endsWith('c3-text.json') ? C3_WORDS_RAW : undefined,
    toolResult: tool => tool === 'Bash' ? { result: { stdout: 'PASS all tests', stderr: '', exitCode: 0 }, text: 'PASS all tests' } : undefined,
    hold: tool => tool === 'Bash' ? w.clock.advance(1500) : undefined,
  })
  return { w, writes, workerOps, elapsed, reads, turnsReads: () => turnsReads }
}

function assertPrivateAbsent(f: ReturnType<typeof fixture>, feature: string) {
  expect(f.writes.length > 0, 'store observer sees shipping writes').toBe(true)
  const leaks = f.writes.filter(entry => (JSON.stringify(entry.value).includes(MARKER) || JSON.stringify(entry.value).includes(LEGACY_MARKER))).map(entry => entry.key)
  console.log('P1_PERSISTENCE ' + JSON.stringify({ feature, syntheticFeatureOff: SYNTHETIC_FEATURE_OFF, storeWrites: f.writes.length, leakKeys: leaks, workerOps: f.workerOps, elapsedMs: f.elapsed }))
  expect(leaks, 'B4 private tool-content marker must not enter plugin store values').toEqual([])
}

test('B4 default TodoWrite bookmark retains bounded task words with recognized secrets redacted', async ($, on) => {
  expect(reminderSettings({}).bookmark).toBe(true)
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  expect(f.turnsReads() > 0, 'shipping C3 startup reads session.turns before tools').toBe(true)
  await $.turn.start({ text: 'work', turnId: COMPLETE.turnId })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ status: 'in_progress', content: MARKER + ' ' + SECRET + ' 😀'.repeat(220), activeForm: 'Working' }] })
  await $.turn.complete(COMPLETE); await settleLegacyStart($, f.w)
  const entries = f.writes.filter(entry => entry.key === 'bookmarks')
  const ownEntries = entries.filter(entry => entry.value !== null && typeof entry.value === 'object' && Object.prototype.hasOwnProperty.call(entry.value, START.cwd))
  console.log('P1_BOOKMARK_WRITES ' + JSON.stringify({ expectedCwd: START.cwd, writes: entries.map(entry => ({ keys: entry.value !== null && typeof entry.value === 'object' ? Object.keys(entry.value) : [], own: ownEntries.includes(entry) })), ownWrites: ownEntries.length, reads: f.reads.filter(entry => ['bookmarks', 'runs'].includes(entry.key)) }))
  // Startup may normalize an absent/null bookmark store to an empty record.
  // Require the completed task's own record explicitly; do not dereference a
  // bootstrap write or silently accept a bookmark stored under another cwd.
  expect(ownEntries.length > 0, 'default bookmark task is actually persisted under its own project').toBe(true)
  for (const entry of entries) expect(JSON.stringify(entry.value)).not.toContain(SECRET)
  for (const entry of ownEntries) {
    const bookmark = (entry.value as Record<string, { where: string }>)[START.cwd]!
    expect(bookmark !== null && typeof bookmark === 'object', 'persisted bookmark is a record').toBe(true)
    expect(typeof bookmark.where, 'persisted bookmark carries task words').toBe('string')
    expect(bookmark.where).toContain(MARKER)
    expect(bookmark.where).toContain('«…»')
    expect([...bookmark.where].length).toBe(200)
  }
  for (const entry of f.writes.filter(entry => entry.key !== 'bookmarks')) expect(JSON.stringify(entry.value)).not.toContain(MARKER)
})

test('B4 default recognized Bash history keeps private command arguments out of store values', async ($, on) => {
  expect(reminderSettings({}).notes).toBe(true)
  const command = 'npm test ' + MARKER
  expect(recognize(command)?.key).toContain(MARKER)
  const f = fixture(on)
  await $.session.start(START); await settleLegacyStart($, f.w)
  expect(f.turnsReads() > 0, 'shipping C3 startup reads session.turns before tools').toBe(true)
  await $.turn.start({ text: 'work', turnId: COMPLETE.turnId })
  await $.tool.call({ tool: 'Bash', command })
  await $.turn.complete(COMPLETE); await settleLegacyStart($, f.w)
  expect(f.workerOps).toContain('recognize')
  expect(f.workerOps).toContain('finish')
  expect(f.elapsed.length).toBe(1)
  expect(f.elapsed[0]! >= 1000, 'shipping history persistence duration reached').toBe(true)
  expect(f.writes.every(entry => !JSON.stringify(entry.value).includes(MARKER)), 'new normalized command argument must never be persisted').toBe(true)
  assertPrivateAbsent(f, 'notes')
  const entries = f.writes.filter(entry => entry.key === 'runs')
  expect(entries.length > 0, 'timing history is actually persisted').toBe(true)
  const legacyHash = sha256(recognize('npm test ' + LEGACY_MARKER)!.key), commandHash = sha256(recognize(command)!.key)
  for (const entry of entries) expect(Object.keys(entry.value as object).every(key => key === legacyHash || key === commandHash), 'only fixture command hashes are persisted').toBe(true)
  expect(Object.keys(entries[entries.length - 1]!.value as object).sort()).toEqual([legacyHash, commandHash].sort())
  expect((entries[entries.length - 1]!.value as Record<string, unknown>)[commandHash]).toEqual([{ ms: 1500, outcome: 'pass' }])
})


test('B4 first load migrates plaintext timing keys without a new run and keeps durations', async ($, on) => {
  const command = 'npm test ' + LEGACY_MARKER, samples = [{ ms: 1200, outcome: 'pass' }, { ms: 3000, outcome: 'fail' }, { ms: 2400, outcome: 'unknown' }]
  const f = fixture(on, { runs: { [recognize(command)!.key]: samples } })
  await $.session.start(START); await settleLegacyStart($, f.w)
  expect(f.turnsReads() > 0, 'shipping C3 startup reads session.turns before tools').toBe(true)
  const entries = f.writes.filter(entry => entry.key === 'runs')
  console.log('P1_MIGRATION_READS ' + JSON.stringify({ expectedCwd: START.cwd, reads: f.reads.filter(entry => entry.key === 'runs'), runWrites: entries.map(entry => Object.keys(entry.value as object)) }))
  expect(entries.length > 0, 'migration writes before any recognized run').toBe(true)
  for (const entry of entries) expect(entry.value).toEqual({ [sha256(recognize(command)!.key)]: samples })
  expect(f.workerOps).not.toContain('finish')
  assertPrivateAbsent(f, 'migration')
})
