// Her itabag's pages in their groups (lane C, step 2): lane B's names over her companion, the drawer, the windows and
// this session; a language without them keeps the older page.
import { describe, expect, test } from 'claude-code/testing'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { SOCK_PAIRS, loadBagWords } from '../hooks/bag'
import { WORDS } from '../hooks/words'
import { initialView } from '../hooks/mood'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { BOOK_FILES } from './book-files'
import { MORNING } from './world'

// lane B's names (sent 10-15; the sticky notes page's asked for that night); the test brings English ones and German goes without
const NAMES = {
  himGroups: { companion: 'Desktop companion', together: 'Together' }, quotaGroups: { quota: 'Quota', session: 'This session', more: 'More' },
  sockGroups: { drawer: 'Drawer' }, sockRows: { wearing: 'Wearing', back: 'Back to {name}' }, noteGroups: { notes: 'Sticky notes', lastStop: 'Where you stopped' },
}
const BAG = JSON.parse(BAG_TEXT_RAW)
const load = () => loadBagWords(async () => JSON.stringify({ ...BAG, en: { ...BAG.en, ...NAMES }, de: { ...BAG.de, himGroups: undefined, quotaGroups: undefined, sockGroups: undefined, sockRows: undefined, noteGroups: undefined } }))
const EN = JSON.parse(BOOK_FILES['en.json']!) as BookWords, DE = JSON.parse(BOOK_FILES['de.json']!) as BookWords
type Block = ReturnType<typeof pageBlocks>[number]
const data = (extra: Record<string, unknown>, lang = 'en') =>
  ({ view: { ...initialView(), lang, context: 34 }, own: WORDS[lang as 'en'], now: MORNING, timeZone: 'UTC', reducedMotion: false, marks: 'replies', reading: 0, store: {}, ...extra }) as unknown as BookData
const named = (blocks: readonly Block[]) => blocks.flatMap(b => b.t === 'heading' && b.badge ? [b.text] : [])
const headings = (blocks: readonly Block[]) => blocks.flatMap(b => b.t === 'heading' ? [b.text] : [])
const plain = (blocks: readonly Block[]) => blocks.flatMap(b => b.t === 'heading' && !b.badge ? [b.text] : [])

describe('her itabag pages in groups', () => {
  test('socks: the drawer under its name, then the pair she wears and the way back to the first pair', async () => {
    await load()
    const drawer = { mode: 'collect', open: ['honmei', 'taro'] }
    const blocks = pageBlocks('socks', EN, data({ socks: 'taro', drawer }))
    const at = blocks.findIndex(b => b.t === 'heading' && b.badge)
    expect(blocks[at]).toMatchObject({ t: 'heading', text: 'Drawer', badge: { mark: 'sock' } })
    expect(blocks.slice(at + 1).filter(b => b.t !== 'choice').map(b => b.t)).toEqual(['socks', 'fact', 'button'])
    expect(blocks.find(b => b.t === 'fact')).toEqual({ t: 'fact', label: 'Wearing', text: BAG.en.socks[SOCK_PAIRS.indexOf('taro')] })
    expect(blocks.find(b => b.t === 'button')).toEqual({ t: 'button', key: 'coco:socks:honmei:back', label: `Back to ${BAG.en.socks[0]}` })
    // in her first pair there is no way back to draw; German without the names keeps the drawer as it was
    expect(pageBlocks('socks', EN, data({ socks: 'honmei', drawer })).some(b => b.t === 'button')).toBe(false)
    expect(pageBlocks('socks', DE, data({ socks: 'taro', drawer }, 'de')).some(b => b.t === 'heading' || b.t === 'fact' || b.t === 'button')).toBe(false)
  })
  test('her page: her lines, then her desktop companion and what you do together; the switches page lets the companion go', async () => {
    await load()
    const companion = { folder: true, app: true, login: false, info: { running: true, size: 'larger' }, state: 'following', asks: false, cannot: false, notRun: false, confirmed: false, afterTools: false, removed: false, message: '' }
    const blocks = pageBlocks('him', EN, data({ companion }))
    expect(named(blocks)).toEqual(['Desktop companion', 'Together'])
    expect(blocks[blocks.findIndex(b => b.t === 'heading' && b.text === 'Desktop companion') + 1]).toMatchObject({ t: 'companion' })
    expect(blocks.at(-1)?.t).toBe('link')
    // the line on top says the size she stands at, in the companion section's own names
    expect(blocks.find(b => b.t === 'lead')).toEqual({ t: 'lead', text: BAG.en.lead.him.replace('{name}', 'Coco').replace('{size}', EN.settings.companion.macSizes[2]) })
    expect(pageBlocks('settings', EN, data({ companion })).some(b => b.t === 'companion')).toBe(false)
    // German without the names: her page as it was, and the companion still on the switches page
    expect(named(pageBlocks('him', DE, data({ companion }, 'de')))).toEqual([])
    expect(pageBlocks('settings', DE, data({ companion }, 'de')).some(b => b.t === 'companion')).toBe(true)
  })
  test('the zine page: this week with the files he opens most and the seven short reads, no stamp book; the bookmark on the sticky notes page', async () => {
    await load()
    const bookmark = { where: 'src/auth/login.ts', at: MORNING - 3_600_000 }, store = { turns: 12, firstMet: MORNING - 86_400_000, stamps: { met: MORNING - 86_400_000 } }
    const zine = pageBlocks('log', EN, data({ store, bookmark, shelf: { names: ['login.ts', 'session.ts'] } }))
    expect(named(zine)).toEqual([BAG.en.zineGroups.week, BAG.en.zineGroups.extras])
    expect(zine.some(b => b.t === 'heading' && b.text === EN.library.shelf.head)).toBe(true)
    expect(zine.some(b => b.t === 'nav')).toBe(true)
    // the achievements left the bag (DECISIONS 1035); an old stored record draws nothing
    expect(zine.some(b => String(b.t) === 'stamps')).toBe(false)
    // the omen's count left with the omen, and the bookmark went to its own page
    expect(zine.some(b => b.t === 'fact' && (b.label === EN.log.omens || b.label === EN.settings.bookmark.label))).toBe(false)
    const notes = pageBlocks('library', EN, data({ store, bookmark }))
    expect(named(notes)).toEqual(['Where you stopped'])
    expect(notes.find(b => b.t === 'row')).toMatchObject({ t: 'row', label: 'src/auth/login.ts' })
    expect(notes.some(b => b.t === 'nav' || b.t === 'heading' && b.text === EN.library.shelf.head)).toBe(false)
    // German without the names: both pages as they were
    expect(named(pageBlocks('log', DE, data({ store, bookmark }, 'de')))).toEqual([])
    expect(pageBlocks('library', DE, data({ store }, 'de')).some(b => b.t === 'nav')).toBe(true)
  })
  test('quota: the windows, then this session, then the price table, under their names and without the book headings', async () => {
    await load()
    const usage = { rateLimits: [{ kind: 'five_hour', percentUsed: 25, resetsAt: '2026-10-02T12:00:00Z' }], context: { tokens: 68_000, window: 200_000 } }
    const blocks = pageBlocks('offerings', EN, data({ usage }))
    expect(named(blocks).slice(0, 2)).toEqual(['Quota', 'This session'])
    expect(named(blocks).includes('More')).toBe(blocks.some(b => b.t === 'button' && b.key === 'coco:prices:open'))
    // (English names this session the same as the book's heading did; the group's name wears a badge, the heading none)
    for (const old of [EN.offerings.context, EN.offerings.limits, EN.offerings.session]) expect(plain(blocks)).not.toContain(old)
    expect(blocks.findIndex(b => b.t === 'incense')).toBeLessThan(blocks.findIndex(b => b.t === 'box'))
    // German without the names: the book's headings in their older order, the context first
    const de = pageBlocks('offerings', DE, data({ usage }, 'de'))
    expect(named(de)).toEqual([])
    expect(headings(de).slice(0, 2)).toEqual([DE.offerings.context, DE.offerings.limits])
    expect(de.findIndex(b => b.t === 'box')).toBeLessThan(de.findIndex(b => b.t === 'incense'))
  })
})
