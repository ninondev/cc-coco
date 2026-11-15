import { test, expect } from 'claude-code/testing'
import { world, RECENT, settleLegacyStart } from './world'
import { drainFeed } from './feed-drain'
import { samePath } from './file-paths'
import { atomicFeed, PROCESS_OK } from './shared-world'

test('ordinary state changes reuse the complete line book and recreate a missing copy', async ($, on) => {
  const folder = '/tmp/x/Library/Application Support/Coco'
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
  const books = new Set<string>(), writes: string[] = [], feeds: Record<string, unknown>[] = []
  on('fs.exists', ($, e) => ({ value: [...books, folder, `${folder}/requests.jsonl`, '/System/Library/CoreServices/SystemVersion.plist',
    '/usr/bin/tail', '/tmp/x/Applications/Coco Pet.app/Contents/MacOS/coco-companion'].some(path => samePath(path, e.path)) }))
  on('process.run', ($, e) => {
    if (e.argv[1] === 'write-lines') {
      const path = `${e.argv[2]}/${e.argv[3]}`
      books.add(path); writes.push(path)
    }
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) feeds.push(JSON.parse(feed.text))
    return { value: PROCESS_OK }
  })
  on('session.id', () => ({ value: 'line-book-session' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w); await drainFeed($)
  const beforeBooks = writes.length, beforeFeeds = feeds.length
  expect(beforeBooks).toBeGreaterThan(0)
  await $.turn.start({ text: 'go', turnId: 'line-book-turn' }); await drainFeed($)
  expect(feeds.length).toBeGreaterThan(beforeFeeds)
  expect(writes.length).toBe(beforeBooks)
  expect(feeds.at(-1)?.lineLibrary).toBeUndefined()
  expect(feeds.at(-1)?.lineLibraryRef).toBeDefined()
  books.clear()
  await $.turn.complete({ turnId: 'line-book-turn', answer: 'done', reason: 'answer', durationMs: 1000, isAborted: false }); await drainFeed($)
  expect(writes.length).toBe(beforeBooks + 1)
})

test('line-book exit failures and timeouts still publish state and a later update retries', async ($, on) => {
  const folder = '/tmp/x/Library/Application Support/Coco'
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
  let failure: 'exit' | 'timeout' | undefined = 'exit', attempts = 0
  const books = new Set<string>(), feeds: Record<string, unknown>[] = []
  on('fs.exists', ($, e) => ({ value: [...books, folder, `${folder}/requests.jsonl`, '/System/Library/CoreServices/SystemVersion.plist',
    '/usr/bin/tail', '/tmp/x/Applications/Coco Pet.app/Contents/MacOS/coco-companion'].some(path => samePath(path, e.path)) }))
  on('process.run', ($, e) => {
    if (e.argv[1] === 'write-lines') {
      attempts++
      if (failure === 'timeout') throw new Error('ETIMEDOUT')
      if (failure === 'exit') return { value: { ...PROCESS_OK, exitCode: 1 } }
      books.add(`${e.argv[2]}/${e.argv[3]}`)
    }
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) feeds.push(JSON.parse(feed.text))
    return { value: PROCESS_OK }
  })
  on('session.id', () => ({ value: 'line-book-retry' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await settleLegacyStart($, w); await drainFeed($)
  expect(attempts).toBeGreaterThan(0)
  expect(feeds.length).toBeGreaterThan(0)
  const afterExit = feeds.length, exitAttempts = attempts
  failure = 'timeout'
  await $.turn.start({ text: 'go', turnId: 'line-book-retry-turn' }); await drainFeed($)
  expect(attempts).toBeGreaterThan(exitAttempts)
  expect(feeds.length).toBeGreaterThan(afterExit)
  expect(feeds.at(-1)?.rest).toBe(false)
  expect(books.size).toBe(0)
  const timeoutAttempts = attempts
  failure = undefined
  await $.turn.complete({ turnId: 'line-book-retry-turn', answer: 'done', reason: 'answer', durationMs: 1000, isAborted: false }); await drainFeed($)
  expect(attempts).toBeGreaterThan(timeoutAttempts)
  expect(books.size).toBe(1)
  expect(feeds.at(-1)?.lineLibraryRef).toBeDefined()
})
