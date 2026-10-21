// Her vibe check page (lane C, step 2): the groups under the day's verdict, tests and builds then this session, in lane
// B's words (vibeRows), drawn from this session's own numbers.
import { describe, expect, test } from 'claude-code/testing'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { loadBagWords } from '../hooks/bag'
import { durationText } from '../hooks/numbers'
import { WORDS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { BOOK_FILES } from './book-files'
import { MORNING } from './world'

// the test brings English rows of its own, and German goes without them, whatever lane B's merged copy holds
const ROWS = {
  firstFail: 'First failing test', fixed: 'Red to green: {fixed}', storms: 'Three reds in a row: {storms}', stormsHelp: 'She bristled that time',
  build: 'Builds usually ~{usual}, this one {now}', buildSlow: 'Slow for this project', tools: 'Tools used: {n}',
  toolKinds: 'read {read}, search {search}, write {write}, run {run}, web {web}, plan {plan}', helpers: 'Helpers: {n}, back: {back}',
  commits: 'Commits: {n}', compactions: 'Compactions: {n}', shareCard: "This session's commit line",
}
const BAG = JSON.parse(BAG_TEXT_RAW)
const WORDS_EN = JSON.parse(BOOK_FILES['en.json']!) as BookWords
type Block = ReturnType<typeof pageBlocks>[number]
const data = (vibe: Record<string, unknown>, lang = 'en') =>
  ({ view: { ...initialView(), lang }, own: WORDS[lang as 'en'], now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', reading: 0, store: {}, vibe: { failed: 0, fixed: 0, compacted: 0, ...vibe } }) as unknown as BookData
const groupsOf = (blocks: readonly Block[]) => {
  const out: { name: string; rows: [string, string | undefined][] }[] = []
  for (const b of blocks) {
    if (b.t === 'heading' && b.badge) out.push({ name: b.text, rows: [] })
    else if (b.t === 'row') out.at(-1)?.rows.push([b.label, b.help])
  }
  return out
}

describe('her vibe check page', () => {
  test('tests and builds, then this session: a row for each thing this session has, its numbers in the words', async () => {
    await loadBagWords(async () => JSON.stringify({ ...BAG, en: { ...BAG.en, vibeRows: ROWS }, de: { ...BAG.de, vibeRows: undefined } }))
    const blocks = pageBlocks('omen', WORDS_EN, data({
      failed: 3, fixed: 2, compacted: 1, ran: 5, last: 'pass', storms: 1, firstFail: 'test_login_redirect',
      build: { ms: 110_000, usualMs: 42_000, slow: true }, tools: { read: 96, search: 40, write: 31, run: 37, web: 6, plan: 4 }, helpers: 3, back: 3, commits: 2,
    }))
    expect(groupsOf(blocks)).toEqual([
      { name: BAG.en.vibeGroups.tests, rows: [
        ['First failing test', 'test_login_redirect'],
        ['Red to green: 2', undefined],
        ['Three reds in a row: 1', 'She bristled that time'],
        [`Builds usually ~${durationText(42, 'en', WORDS_EN.durations)}, this one ${durationText(110, 'en', WORDS_EN.durations)}`, 'Slow for this project'],
      ] },
      { name: BAG.en.vibeGroups.session, rows: [
        ['Tools used: 214', 'read 96, search 40, write 31, run 37, web 6, plan 4'],
        ['Helpers: 3, back: 3', undefined],
        ['Commits: 2', undefined],
        ['Compactions: 1', undefined],
      ] },
    ])
  })
  test('nothing counted draws no group; a build without its usual time draws no build row; a language without the rows draws neither group', async () => {
    await loadBagWords(async () => JSON.stringify({ ...BAG, en: { ...BAG.en, vibeRows: ROWS }, de: { ...BAG.de, vibeRows: undefined } }))
    expect(groupsOf(pageBlocks('omen', WORDS_EN, data({})))).toEqual([])
    expect(groupsOf(pageBlocks('omen', WORDS_EN, data({ build: { ms: 9_000, slow: false } })))).toEqual([])
    expect(groupsOf(pageBlocks('omen', WORDS_EN, data({ commits: 1 })))).toEqual([{ name: BAG.en.vibeGroups.session, rows: [['Commits: 1', undefined]] }])
    const de = JSON.parse(BOOK_FILES['de.json']!) as BookWords
    expect(groupsOf(pageBlocks('omen', de, data({ commits: 1 }, 'de')))).toEqual([])
  })
})
