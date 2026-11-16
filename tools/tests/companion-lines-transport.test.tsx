import { test, expect } from 'claude-code/testing'
import { world, RECENT, settleLegacyStart } from './world'
import { drainFeed } from './feed-drain'
import { samePath } from './file-paths'
import { atomicFeed, atomicLineBook, PROCESS_OK } from './shared-world'
import { companionFiles, companionKey, companionRecord, companionText } from '../hooks/companion'
import { initialView } from '../hooks/mood'
import { TEST_PLUGIN_ROOT } from './test-system'

const folder = '/tmp/x/Library/Application Support/Coco'
function companionPathExists(path: string, books: Set<string>): boolean {
  return [...books, folder, `${folder}/requests.jsonl`, '/System/Library/CoreServices/SystemVersion.plist',
    '/usr/bin/tail', '/tmp/x/Applications/Coco Pet.app/Contents/MacOS/coco-companion'].some(known => samePath(path, known))
}

test('Mac transport fixture recognizes native Windows-normalized file paths', () => {
  const book = `${folder}/lines-${'a'.repeat(64)}.json`
  const books = new Set([book])
  for (const path of [folder, `${folder}/requests.jsonl`, '/System/Library/CoreServices/SystemVersion.plist', '/usr/bin/tail', book]) {
    expect(companionPathExists(path, books)).toBe(true)
    expect(companionPathExists('C:' + path.replace(/\//g, '\\'), books)).toBe(true)
  }
  expect(companionPathExists('C:\\tmp\\unrelated', books)).toBe(false)
})

test('only the exact bundled line-book writer is classified as file I/O', () => {
  const root = '/tmp/plugin', name = `lines-${'a'.repeat(64)}.json`, helper = `${root}/bin/companion-control`
  const argv = [helper, 'write-lines', folder, name]
  expect(atomicLineBook(argv, '{}', root, folder)?.path).toBe(`${folder}/${name}`)
  const windows = argv.map((value, i) => i === 0 || i === 2 ? 'C:' + value.replace(/\//g, '\\') : value)
  expect(atomicLineBook(windows, '{}', 'C:\\tmp\\plugin', folder)).toBeDefined()
  for (const unknown of [
    ['/tmp/other/bin/companion-control', ...argv.slice(1)], [helper, 'install', folder, name],
    [helper, 'stop', folder, name], [helper, 'write-lines', '/tmp/other', name],
    [helper, 'write-lines', folder, '../voice.json'], [helper, 'write-lines', folder, 'view.json'],
    [helper, 'write-lines', folder, `lines-${'A'.repeat(64)}.json`], [...argv, '--launch'], argv.slice(0, 3),
  ]) expect(atomicLineBook(unknown, '{}', root, folder)).toBeUndefined()
  expect(atomicLineBook(argv, undefined, root, folder)).toBeUndefined()
})

test('the new line-book boundary supplies Coco without changing the old default record', () => {
  const view = initialView(), raw = companionRecord(view)
  expect('character' in raw || 'claudie' in raw).toBe(false)
  const files = companionFiles(companionText(companionKey(view), 'default-coco', true, 1))
  expect(JSON.parse(files.feed).character).toBe('coco')
  expect(JSON.parse(files.library!.text).character).toBe('coco')
  const legacy = '{"session":"legacy","at":1,"lang":"zh"}\n'
  expect(companionFiles(legacy)).toEqual({ feed: legacy })
  for (const [chosen, character] of [[{ claudie: 'dake' }, 'dake'], [{ character: 'fish' }, 'fish'], [{ character: 'coco' }, 'coco']] as const) {
    const files = companionFiles(companionText(companionKey({ ...view, ...chosen }), 'chosen', true, 1))
    expect(JSON.parse(files.feed).character).toBe(character)
    expect(JSON.parse(files.library!.text).character).toBe(character)
  }
})

test('ordinary state changes reuse the complete line book and recreate a missing copy', async ($, on) => {
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
  const books = new Set<string>(), writes: string[] = [], feeds: Record<string, unknown>[] = []
  on('fs.exists', ($, e) => ({ value: companionPathExists(e.path, books) }))
  on('process.run', ($, e) => {
    const book = atomicLineBook(e.argv, e.init?.stdin, TEST_PLUGIN_ROOT, folder)
    if (book) {
      books.add(book.path); writes.push(book.path)
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
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME: '/tmp/x' } })
  let failure: 'exit' | 'timeout' | undefined = 'exit', attempts = 0
  const books = new Set<string>(), feeds: Record<string, unknown>[] = []
  on('fs.exists', ($, e) => ({ value: companionPathExists(e.path, books) }))
  on('process.run', ($, e) => {
    const book = atomicLineBook(e.argv, e.init?.stdin, TEST_PLUGIN_ROOT, folder)
    if (book) {
      attempts++
      if (failure === 'timeout') throw new Error('ETIMEDOUT')
      if (failure === 'exit') return { value: { ...PROCESS_OK, exitCode: 1 } }
      books.add(book.path)
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
