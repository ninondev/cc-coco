// The built notice worker, run the way the plugin runs it: a request on stdin, an answer on stdout, under node
// and under bun. The generated file must match its sources.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'

const root = new URL('../../../', import.meta.url).pathname
const worker = root + 'plugin/hooks/notice-worker.mjs'
const run = (interpreter: string, request: unknown) =>
  spawnSync(interpreter, [worker], { input: typeof request === 'string' ? request : JSON.stringify(request), encoding: 'utf8' })

describe('notice-worker.mjs', () => {
  test('is exactly what tools/build-notice-worker.py builds from tools/notice*', () => {
    const done = spawnSync('python3', [root + 'tools/build-notice-worker.py', '--check'], { encoding: 'utf8' })
    expect(done.stderr).toBe('')
    expect(done.status).toBe(0)
  })

  for (const interpreter of ['node', 'bun']) {
    test(`${interpreter}: a Read, an Edit, a commit message and a long function each get their answer`, () => {
      const read = run(interpreter, { op: 'comment', mode: 'read', path: 'src/a.ts', start: 1, text: 'a()\n// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.\nmutex.lock()\n' })
      expect(JSON.parse(read.stdout)).toEqual({ ok: true, result: { line: 2, quote: 'Hold the lock while copying, otherwise a…' } })
      const commit = run(interpreter, { op: 'commit', message: 'Retry the refresh once\n\nThe refresh call fails when the laptop wakes from sleep because the network is not up yet, so people were logged out mid-draft.' })
      expect(JSON.parse(commit.stdout)).toEqual({ ok: true, result: { quality: 'why', quote: 'because the network is not up yet' } })
      const big = 'function big() {\n' + '  work()\n'.repeat(405) + '}\n'
      const long = run(interpreter, { op: 'long', path: 'a.ts', limit: 400, before: null, after: big, touched: [10] })
      expect(JSON.parse(long.stdout)).toEqual({ ok: true, result: { name: 'big', lines: 407 } })
    })

    test(`${interpreter}: bad input answers {"ok":false}, exits 1 and echoes nothing it was given`, () => {
      const done = run(interpreter, 'not json with a secret sk-123')
      expect(done.status).toBe(1)
      expect(done.stdout).toBe('{"ok":false}')
      expect(done.stderr).toBe('')
    })
  }
})
