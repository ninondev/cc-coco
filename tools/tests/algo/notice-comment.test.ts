// SPARK reader: which comment a careful person would mark. Frozen cases from the design (fixtures in 13
// languages, the independent review's cases), a regression set drawn from real code, and the rules of
// the pickier round (hedged comments, lists, API sentences).
import { describe, expect, test } from 'bun:test'
import cases from './notice-data/comment-cases.json'
import golden from './notice-data/comment-units.json'
import { executeNoticeAlgo } from '../../notice-core'
import { fileSkipped, pick, quote, read, units } from '../../notice/comment'

const one = (text: string, next = '', extra: Record<string, unknown> = {}) =>
  read({ lines: [text], next, kind: 'line', doc: false, line: 10, first: false, ...extra } as never)

describe('the design cases', () => {
  test('hand-written comments in 13 languages: the reader agrees with the labels in at least 34 of 37', () => {
    const agree = cases.fixtures.filter(f => !!one(f.text, f.next) === f.label).length
    expect(cases.fixtures.length).toBe(37)
    expect(agree).toBeGreaterThanOrEqual(34)
    for (const f of cases.fixtures) expect(!!one(f.text, f.next)).toBe(f.pass)
  })

  test('the review cases come out as stated, with the quote the pictures show', () => {
    for (const c of cases.review) {
      const got = one(c.text, c.next)
      expect(!!got).toBe(c.want)
      if (got) expect(got.quote).toBe(c.quote as string)
    }
    expect(cases.review.length).toBe(16)
  })

  test('a frozen set drawn from real code keeps its verdicts', () => {
    expect(golden.length).toBeGreaterThan(60)
    for (const g of golden) expect(read(g as never)?.quote ?? null).toBe(g.expect)
  })
})

describe('gate 0, not his to judge', () => {
  const why = 'because the router drops the first SYN after a reset, so a single retry is never enough.'
  test.each([
    ['a license', 'Copyright 2024 Example Corp. Licensed under the Apache License, ' + why],
    ['a lint directive', 'eslint-disable-next-line no-unused-vars, ' + why],
    ['a TODO', 'TODO: wait 250 ms here ' + why],
    ['a deferral', 'For now we wait 250 ms ' + why],
    ['a bare URL', 'see https://example.com/spec/section-4'],
    ['commented-out code', 'if (a === b) { return c; }'],
    ['shouting', 'THIS MUST NEVER BE CALLED WITHOUT THE LOCK OTHERWISE THE QUEUE CORRUPTS'],
  ])('%s gets nothing', (_, text) => expect(one(text, 'work()')).toBeUndefined())

  test('the first comment block of a file is its header, not a remark', () => {
    const header = ['Wait 250 ms before the probe because the router drops the SYN.', 'Second line of the block.', 'Third line of the block.', 'Fourth line of the block.']
    const unit = { lines: header, next: 'import x from "y"', kind: 'line', doc: false, line: 1, first: true }
    expect(read(unit as never)).toBeUndefined()
    expect(read({ ...unit, first: false, line: 40 } as never)).toBeDefined()
  })
})

describe('gates 1 to 4', () => {
  test('too short, too long and a restated line fail', () => {
    expect(one('Retry because slow.', 'retry()')).toBeUndefined()
    expect(one('Wait 250 ms before the second probe because the router drops the first SYN after a reset. '.repeat(3), 'await sleep(250)')).toBeUndefined()
    expect(one('Increment the counter because the counter must go up.', 'counter++')).toBeUndefined()
  })

  test('a bare negation is never a consequence (no longer needed, we do not need it)', () => {
    expect(one('Free the main buffer here since it is no longer needed by anyone.', 'free(buf);')).toBeUndefined()
    expect(one('Close the file because we do not need it anymore after this point.', 'fclose(f);')).toBeUndefined()
    expect(one('このバッファはもう不要になったので、ここで解放する。', 'free(buf);')).toBeUndefined()
    expect(one('这个缓冲区不再需要，所以在这里释放掉它。', 'free(buf);')).toBeUndefined()
  })

  test('", so" plus the next line\'s action fails without a consequence', () => {
    expect(one('We failed to find a free slot, so mark the cache as full and return nothing.', 'cache->full = 1;')).toBeUndefined()
  })

  test('a reason with its consequence passes, in the first position and after a sentence', () => {
    expect(one('Clear the cache before the redirect, otherwise the old session is served.', 'cache.clear()')?.quote).toBe('Clear the cache before the redirect…')
    expect(one('Order matters here. Otherwise, the first rule swallows the second and nothing ever matches.', 'rules.sort()')).toBeUndefined()
    expect(one('Keep the table sorted or else the binary search below would return the wrong index for some keys.', 'search(table)')).toBeDefined()
  })
})

describe('the pickier round', () => {
  test('hedged comments are doubt, not a reason', () => {
    expect(one('Must not be called before the codegen step, for reasons now lost to history (and might not still be applicable).', 'run()')).toBeUndefined()
    expect(one('Wait for the lock, otherwise the queue is probably corrupted by the second thread.', 'lock()')).toBeUndefined()
  })

  test('a list of open issues is not a comment to point at', () => {
    expect(one('Issues to be discussed: - Thread safe-ness must be checked - Return values differ, otherwise callers break.', 'int f()')).toBeUndefined()
  })

  test('an API sentence that leads with its own name needs a stake or a consequence', () => {
    expect(one('HashFunc returns an identifier for the hash function used to sign, or else zero to indicate nothing was hashed.', 'HashFunc() Hash')).toBeUndefined()
    expect(one('initGoSum initializes the go.sum data and the lock must be held by the caller.', 'func initGoSum() {')).toBeUndefined()
  })

  test('a doc comment that gives a real reason still passes', () => {
    const v = one('Close releases the handle. It must be called because the descriptor leaks until the process exits.', 'func (f *File) Close() error {')
    expect(v?.kind).toBe('why')
  })
})

describe('units: what counts as one comment', () => {
  test('line comments at one indent merge; line numbers follow the Read\'s start line', () => {
    const text = 'x = 1\n  // first half of the thought\n  // second half, because it is long\nrun()\n'
    const us = units(text, 'a.ts', 40)
    expect(us.length).toBe(1)
    expect(us[0]).toMatchObject({ line: 41, end: 42, next: 'run()', first: false })
    expect(us[0]!.lines).toEqual(['first half of the thought', 'second half, because it is long'])
  })

  test('strings hide comment markers; a shell variable and a hash inside a word are not comments', () => {
    expect(units('const a = "// not a comment"\nconst b = `/* nor this */`\n', 'a.ts')).toEqual([])
    expect(units('echo "${#items[@]}"\nurl=http://x/y#anchor\n', 'a.sh')).toEqual([])
    expect(units("let r: &'a str = x; // keep it\n", 'a.rs').map(u => u.kind)).toEqual(['trail'])
  })

  test('block comments lose their star leaders; Python triple quotes are not comments', () => {
    const us = units('/**\n * Wait here\n * because of the race.\n */\nfoo()\n', 'a.ts')
    expect(us[0]!.lines).toEqual(['Wait here', 'because of the race.'])
    expect(us[0]!.doc).toBe(true)
    expect(units('x = """\n# not a comment\n"""\n# real one\n', 'a.py').map(u => u.text)).toEqual(['real one'])
  })

  test('an unknown language has no comments to read', () => {
    expect(units('// anything', 'notes.txt')).toEqual([])
  })
})

describe('files and quotes', () => {
  test('files he never reads for this', () => {
    expect(fileSkipped('node_modules/x/index.js', '')).toBe('path')
    expect(fileSkipped('.env.local', '')).toBe('path')
    expect(fileSkipped('config/prod.pem', '')).toBe('path')
    expect(fileSkipped('src/credentials.ts', '')).toBe('path')
    expect(fileSkipped('src/a.min.js', '')).toBe('generated')
    expect(fileSkipped('src/a.ts', '// @generated by tool\nx')).toBe('generated')
    expect(fileSkipped('src/a.ts', 'x'.repeat(4000))).toBe('minified')
    expect(fileSkipped('src/a.ts', 'const a = 1\n')).toBeUndefined()
  })

  test('the quote stops at a word (44 columns) or at 21 CJK characters, with an ellipsis', () => {
    const long = quote('Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.')
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(44)
    expect(long).toBe('Hold the lock while copying, otherwise a…')
    const cjk = quote('先加锁再拷贝，否则并发刷新会在我们读的时候释放缓冲区，造成数据损坏。')
    expect([...cjk].length).toBeLessThanOrEqual(22)
    expect(cjk.endsWith('…')).toBe(true)
    expect(quote('short and whole')).toBe('short and whole')
  })
})

describe('which comment of several', () => {
  test('a consequence or stake first, then a reason over a constraint, then the shortest', () => {
    const text = [
      '// Must hold the lock while the queue is read by the worker.',
      'a()',
      '// Take the lock first, otherwise the worker thread can read a half-written tail and crash.',
      'b()',
      '// Take the lock, otherwise the tail is read half written.',
      'c()',
    ].join('\n')
    expect(pick(units(text, 'a.ts'))?.line).toBe(5)
  })
})

describe('the worker op', () => {
  test('a Read returns one line and a quote, and nothing else', () => {
    const got = executeNoticeAlgo({ op: 'comment', mode: 'read', path: 'src/a.ts', start: 1, text: 'a()\n// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.\nmutex.lock()\n' })
    expect(got).toEqual({ line: 2, quote: 'Hold the lock while copying, otherwise a…' })
  })

  test('numbered Read output is read as the file', () => {
    const numbered = ['     1\ta()', '     2\t// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.', '     3\tmutex.lock()'].join('\n')
    expect(executeNoticeAlgo({ op: 'comment', mode: 'read', path: 'src/a.ts', start: 1, text: numbered })).toEqual({ line: 2, quote: 'Hold the lock while copying, otherwise a…' })
  })

  test('an Edit marks only comments it added, never a context comment or a moved one', () => {
    const good = '  // Wait 250 ms before the second probe because the router drops the first SYN after a reset.'
    const hunks = [{ newStart: 10, lines: [' function f() {', '+' + good, '+  await sleep(250)', ' }'] }]
    expect(executeNoticeAlgo({ op: 'comment', mode: 'edit', path: 'src/a.ts', hunks })).toEqual({ line: 11, quote: 'Wait 250 ms before the second probe because…' })
    const context = [{ newStart: 10, lines: [' function f() {', ' ' + good, '+  await sleep(250)', ' }'] }]
    expect(executeNoticeAlgo({ op: 'comment', mode: 'edit', path: 'src/a.ts', hunks: context })).toBeNull()
    const moved = [{ newStart: 10, lines: [' function f() {', '-' + good, '+' + good, ' }'] }]
    expect(executeNoticeAlgo({ op: 'comment', mode: 'edit', path: 'src/a.ts', hunks: moved })).toBeNull()
  })

  test('skipped paths and unknown languages answer null', () => {
    const text = '// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.\nmutex.lock()\n'
    expect(executeNoticeAlgo({ op: 'comment', mode: 'read', path: 'node_modules/a/b.js', start: 1, text })).toBeNull()
    expect(executeNoticeAlgo({ op: 'comment', mode: 'read', path: 'notes.md', start: 1, text })).toBeNull()
    expect(executeNoticeAlgo({ op: 'nothing' })).toBeNull()
  })
})
