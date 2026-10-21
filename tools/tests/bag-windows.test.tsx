// Their windows on the bag's first page (E1-2, his card 10-17: list only). Each session's presence claim notes when it
// began working or went quiet; the page lists every open session with two or more open, and marks this window and the
// one the desktop pet follows.
import { expect, test } from 'claude-code/testing'
import { reducePresence, presenceSessions } from '../hooks/presence'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { loadBagWords } from '../hooks/bag'
import { initialView } from '../hooks/mood'
import { WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { tildePath } from '../hooks/paths'
import { MORNING } from './world'

const WINDOWS = { title: 'fixture {n} windows', working: 'working since {time}', quiet: 'quiet since {time}', workingNow: 'working', quietNow: 'quiet', here: 'this window', follows: 'the pet follows it' }

test('E1-2 a claim notes when its window began working or went quiet, and the open sessions carry it', () => {
  const alive = new Map([[101, { birth: 'b', parent: 1, uid: 0, executable: '/bin/claude', registeredOwner: 'own' }]])
  const meta = { cwd: '/home/a/project', version: '1.0.0' }
  const start = reducePresence(undefined, 'bootstrap', 's1', MORNING, false, 101, 'b', alive, 'own', 'en', undefined, undefined, undefined, undefined, meta)
  const key = '101:own'
  expect(start.claims[key]?.busySince).toBe(MORNING)
  const busy = reducePresence(start, 'write', 's1', MORNING + 5000, true, 101, 'b', alive, 'own', 'en', undefined, undefined, undefined, undefined, meta)
  expect(busy.claims[key]?.busySince).toBe(MORNING + 5000)
  // still working later: the start stays
  const still = reducePresence(busy, 'write', 's1', MORNING + 9000, true, 101, 'b', alive, 'own', 'en', undefined, undefined, undefined, undefined, meta)
  expect(still.claims[key]?.busySince).toBe(MORNING + 5000)
  expect(presenceSessions(still, alive)).toEqual([{ session: 's1', cwd: '/home/a/project', version: '1.0.0', open: true, busy: true, busySince: MORNING + 5000 }])
})

test('E1-2 the first page lists the open windows with what each is doing, this one and the one the pet follows marked', async () => {
  const bag = JSON.parse(BAG_TEXT_RAW) as Record<string, Record<string, unknown>>
  bag.en = { ...bag.en, windows: WINDOWS }
  expect(await loadBagWords(async () => JSON.stringify(bag))).toBe(true)
  const words = JSON.parse(BOOK_FILES['en.json']!) as BookWords
  const rows = [
    { session: 'a', cwd: '/home/a/project', busy: true, busySince: MORNING - 60_000, lastPromptAt: MORNING - 60_000 },
    { session: 'b', cwd: '/home/a/notes', busy: false, busySince: MORNING - 600_000, lastPromptAt: MORNING - 30_000 },
    { session: 'c', cwd: '/srv/other', busy: false },
  ]
  const data: BookData = { view: { ...initialView(), lang: 'en' }, own: WORDS.en, now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', reading: 0, store: {},
    windows: { rows, self: 'a', home: '/home/a' } }
  const texts = (blocks: ReturnType<typeof pageBlocks>) => blocks.flatMap(b => b.t === 'heading' ? [b.text] : b.t === 'row' ? [`${b.label} | ${b.help ?? ''}`] : [])
  const listed = texts(pageBlocks('him', words, data))
  expect(listed).toContain('fixture 3 windows')
  const row = (folder: string) => listed.find(text => text.startsWith(folder + ' | '))
  expect(row('~/project')).toMatch(/^~\/project \| working since .+, this window$/)
  expect(row('~/notes')).toMatch(/^~\/notes \| quiet since .+$/)
  expect(row('/srv/other')).toBe('/srv/other | quiet')
  // with the pet on the desktop, the newest prompt's window is the one it follows
  const pet = { ...data, companion: { folder: true, app: true, login: false, info: { running: true }, version: '1', state: 'following', asks: false, cannot: false, notRun: false, confirmed: false, afterTools: false, removed: false, message: '' } } as BookData
  expect(texts(pageBlocks('him', words, pet)).find(text => text.startsWith('~/notes | '))).toMatch(/, the pet follows it$/)
  // one window: no list
  expect(texts(pageBlocks('him', words, { ...data, windows: { rows: rows.slice(0, 1), self: 'a', home: '/home/a' } }))).not.toContain('fixture 1 windows')
})

test('E1-2 the list speaks lane B\'s words (88b79976) in each language', async () => {
  expect(await loadBagWords(async () => BAG_TEXT_RAW)).toBe(true)
  const shipped = JSON.parse(BAG_TEXT_RAW) as Record<string, { windows?: Record<string, string> }>
  const rows = [
    { session: 'a', cwd: '/home/a/project', busy: true, busySince: MORNING - 60_000, lastPromptAt: MORNING - 60_000 },
    { session: 'b', cwd: '/home/a/notes', busy: false },
  ]
  // English is the earlier test's fixture once loaded (the words load once per run), so the check reads other languages.
  for (const lang of ['zh', 'zh-Hant', 'ja', 'fr'] as const) {
    const own = shipped[lang]!.windows!
    const words = JSON.parse(BOOK_FILES[`${lang}.json`]!) as BookWords
    const data: BookData = { view: { ...initialView(), lang }, own: WORDS[lang], now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', reading: 0, store: {},
      windows: { rows, self: 'a', home: '/home/a' } }
    const blocks = pageBlocks('him', words, data)
    const headings = blocks.flatMap(b => b.t === 'heading' ? [b.text] : [])
    expect(headings, lang).toContain(own.title!.replace('{n}', '2'))
    const help = blocks.flatMap(b => b.t === 'row' && b.label === '~/notes' ? [b.help ?? ''] : [])
    expect(help, lang).toEqual([own.quietNow])
    const mine = blocks.flatMap(b => b.t === 'row' && b.label === '~/project' ? [b.help ?? ''] : [])
    expect(mine[0], lang).toContain(own.here!)
  }
})

test('E1-2 folders under the home folder read from ~, through hooks/paths.ts (tildePath)', () => {
  expect(tildePath('/home/a/project', '/home/a')).toBe('~/project')
  expect(tildePath('/home/a', '/home/a/')).toBe('~')
  expect(tildePath('/home/ab/project', '/home/a')).toBe('/home/ab/project')
  expect(tildePath('/srv/other', '/home/a')).toBe('/srv/other')
  expect(tildePath('C:\\Users\\A\\work', 'c:\\users\\a')).toBe('~\\work')
  expect(tildePath('C:\\Users\\Ab\\work', 'C:\\Users\\A')).toBe('C:\\Users\\Ab\\work')
  expect(tildePath('/home/a/project', undefined)).toBe('/home/a/project')
})
