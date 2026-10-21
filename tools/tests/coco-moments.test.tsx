// The eleven new moments (owner 10-14): which line each existing event says.
import { describe, expect, test } from 'claude-code/testing'
import { LINES } from '../hooks/lines'
import { runMoment } from '../hooks/mood'
import { settleLegacyStart, RECENT, world } from './world'

const EN = LINES.en
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const end = (turnId: string, reason: 'answer' | 'error') => ({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId, reason })

describe('which run calls for which line', () => {
  test('builds slip, tests fail, green after red is fixed, a first test passing is a first-try pass', () => {
    const run = { test: true, failed: false, failures: 0, failedBefore: false, firstOfTurn: false }
    expect(runMoment({ ...run, test: false, failed: true, failures: 1 })).toBe('small_slip')
    expect(runMoment({ ...run, failed: true, failures: 2 })).toBe('test_fail')
    expect(runMoment({ ...run, failed: true, failures: 3 })).toBe(undefined)
    expect(runMoment({ ...run, failedBefore: true })).toBe('fixed')
    expect(runMoment({ ...run, firstOfTurn: true })).toBe('pass_first')
    expect(runMoment(run)).toBe(undefined)
    expect(runMoment({ ...run, test: false })).toBe(undefined)
  })
})

describe('the new moments in a session', () => {
  test('a failing test says a failed-test line and the next green says fixed', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    w.fails = true
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(w.view().mood).toBe('error')
    expect(EN.test_fail).toContain(w.view().said)
    w.fails = false
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.fixed).toContain(w.view().said)
  })

  test('the first test of a turn passing is a first-try pass, once per turn', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.pass_first).toContain(w.view().said)
    await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
    expect(EN.pass_first).toContain(w.view().said)
    await $.turn.complete(end('t1', 'answer'))
    await $.turn.start({ text: 'again', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.pass_first).toContain(w.view().said)
  })

  test('a failing build is a small slip', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'build it', turnId: 't1' })
    w.fails = true
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    expect(EN.small_slip).toContain(w.view().said)
  })

  test('three failures wake the wild soul; three more and she stops joking', async ($, on) => {
    const w = world(on, { store: RECENT })
    w.fails = true
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'fix the tests', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.wild).toContain(w.view().said)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.wild).toContain(w.view().said)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(EN.serious).toContain(w.view().said)
  })

  test('the first plan of a turn starts a big job', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
    await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)
    expect(EN.big_start).toContain(w.view().said)
  })

  test('a command the shell cannot find is a typo', async ($, on) => {
    const w = world(on, { store: RECENT, toolResult: tool => tool === 'Bash' ? { isError: true, result: '', text: 'bash: gti: command not found' } as never : undefined })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'commit it', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'gti status' })
    expect(EN.typo).toContain(w.view().said)
  })

  test('a second turn in a row stopped by an error is serious', async ($, on) => {
    const w = world(on, { store: RECENT })
    await $.session.start(START); await settleLegacyStart($, w)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(end('t1', 'error'))
    expect(EN.error).toContain(w.view().said)
    await $.turn.start({ text: 'go again', turnId: 't2' })
    await $.turn.complete(end('t2', 'error'))
    expect(EN.serious).toContain(w.view().said)
  })
})
