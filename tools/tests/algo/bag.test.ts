// Her itabag (plugin/hooks-source/bag.ts, lane C 10-14): the seven pages in the owner's order, lane B's names, the art and
// the terminal's head.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAG_PAGES, SOCK_FACES, SOCK_PAIRS, bagArtHeight, bagArtSvg, bagFill, bagPageName, bagTerminalHead, bagWords, loadBagWords, noteBadges, sockBadges, sockMode, sockPair, socksEarned, socksOpen, vibeBadges, vibePick, vibeSituation } from '../../../plugin/hooks-source/bag'
import { PAGES } from '../../../plugin/hooks-source/book-words'

const ROOT = join(import.meta.dir, '../../..')
const LANGS = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es-ES', 'es-419', 'pt-BR', 'it', 'hi', 'id']
// East Asian wide characters take two cells, the frame's block elements one.
const width = (text: string) => [...text].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(c) ? 2 : 1), 0)

describe('her sock drawer', () => {
  test('collects by default: her own pair, the earned ones and the one she wears; all unlocked opens every pair', () => {
    expect(sockMode({})).toBe('collect')
    expect(sockMode({ socksMode: 'all' })).toBe('all')
    expect(socksOpen({})).toEqual(['honmei'])
    // only known pairs count, her own pair is never stored, and the drawer keeps its own order
    expect(socksEarned({ socksEarned: ['taro', 'honmei', 'nope', 'matcha'] })).toEqual(['matcha', 'taro'])
    expect(socksOpen({ socksEarned: ['taro', 'matcha'], socks: 'lan' })).toEqual(['honmei', 'matcha', 'taro', 'lan'])
    expect(socksOpen({ socksMode: 'all' })).toEqual([...SOCK_PAIRS])
  })
  test('a pair she does not have yet is a dashed outline without colour', () => {
    const svg = bagArtSvg(560, sockBadges(['honmei']))
    expect(svg).toContain('stroke-dasharray')
    expect(bagArtSvg(560, sockBadges([...SOCK_PAIRS]))).not.toContain('stroke-dasharray')
  })
})

describe('her vibe check', () => {
  test('the situation comes from what this session did, the first that holds', () => {
    expect(vibeSituation({ failed: 2, fixed: 1, compacted: 3, ran: 4, last: 'fail' })).toBe('stillRed')
    expect(vibeSituation({ failed: 2, fixed: 1, compacted: 3, ran: 4, last: 'pass' })).toBe('redToGreen')
    expect(vibeSituation({ failed: 0, fixed: 0, compacted: 3, ran: 4, last: 'pass' })).toBe('allGreen')
    expect(vibeSituation({ failed: 0, fixed: 0, compacted: 2, ran: 0 })).toBe('compacted')
    expect(vibeSituation({ failed: 0, fixed: 0, compacted: 1 })).toBe('noTests')
  })
  test('the local day picks the set, so it holds all day and the next day takes the next; never luck', () => {
    const sets = ['a', 'b', 'c'].map(verdict => ({ verdict, roasts: ['r1', 'r2'], step: 's' }))
    const noon = Date.UTC(2026, 9, 14, 12), pick = (at: number, zone?: string) => vibePick(sets, at, zone)?.verdict
    expect(pick(noon, 'UTC')).toBe(pick(noon + 11 * 3_600_000, 'UTC'))
    expect(pick(noon + 86_400_000, 'UTC')).not.toBe(pick(noon, 'UTC'))
    expect(new Set([0, 1, 2].map(d => pick(noon + d * 86_400_000, 'UTC'))).size).toBe(3)
    // 01:00 in Shanghai is still the evening before in UTC: the person's own day counts
    expect(pick(Date.UTC(2026, 9, 14, 17), 'Asia/Shanghai')).toBe(pick(noon + 86_400_000, 'UTC'))
    expect(vibePick([], noon)).toBeUndefined()
  })
})

describe('the itabag', () => {
  test('its seven pages are the panel\'s pages in the owner\'s order: 小克, 额度, vibe check, 袜子, 同人誌, 便利贴, 开关', async () => {
    expect(BAG_PAGES).toEqual(PAGES)
    expect(await loadBagWords(async () => readFileSync(join(ROOT, 'plugin/hooks/bag-text.json'), 'utf8'))).toBe(true)
    expect(BAG_PAGES.map(page => bagPageName('zh', page))).toEqual(['小克', '额度', 'vibe check', '袜子', '同人誌', '便利贴', '开关'])
    expect(bagWords('zh')?.title).toBe('小克的痛包')
    for (const lang of LANGS) {
      const words = bagWords(lang)!
      expect([words.pages.length, words.socks.length, words.alt.length]).toEqual([7, 13, 7])
    }
    expect(bagWords('xx')).toBe(bagWords('en'))
    expect(bagFill(bagWords('zh')!.alt[6]!, { total: 12, on: 7 })).toBe('小克的痛包,12枚开关开着7枚')
  })
  test('the drawer holds thirteen pairs, her own first; every other pair has its pictures for both outfits', () => {
    expect(SOCK_PAIRS.length).toBe(13)
    expect(SOCK_PAIRS[0]).toBe('honmei')
    for (const pair of SOCK_PAIRS.slice(1)) for (const outfit of ['A', 'B']) expect(existsSync(join(ROOT, `plugin/assets/coco/socks-${outfit}-${pair}.json`))).toBe(true)
    expect(sockPair('taro')).toBe('taro')
    expect(sockPair('../taro')).toBeUndefined()
    expect(sockPair(undefined)).toBeUndefined()
  })
  test('the art is one picture of the bag: as wide as asked, its height by width, one badge a switch, the same every time', () => {
    const switches = [true, false, true, true, false, true, false, true]
    for (const w of [240, 400, 401, 560]) {
      const svg = bagArtSvg(w, switches)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain(`viewBox="0 0 ${w} ${bagArtHeight(w)}"`)
      expect(svg.match(/stroke-width="1.6"/g)?.length).toBe(switches.length)
      expect(svg).toBe(bagArtSvg(w, switches))
    }
    expect(bagArtHeight(400)).toBe(176)
    expect(bagArtHeight(560)).toBe(250)
    // off badges are grey with the knob to the left
    expect(bagArtSvg(560, [false])).toContain('fill="#B9B2AC"')
    expect(bagArtSvg(560, [true])).not.toContain('fill="#B9B2AC"')
  })
  test('the quota charms hang off the bag only where there is a reading, four cells each', () => {
    const none = bagArtSvg(560, [true]), both = bagArtSvg(560, [true], { five: 3, week: 1 }), five = bagArtSvg(560, [true], { five: 4 })
    expect(none).not.toContain('stroke-dasharray')
    expect(both.match(/stroke-dasharray/g)?.length).toBe(2)
    expect(five.match(/stroke-dasharray/g)?.length).toBe(1)
    // the last quarter turns coral
    expect(bagArtSvg(560, [true], { five: 1 })).toContain('fill="#D97757"/><rect')
  })
  test('the pages that count things draw their own badges: failed and fixed tests and compactions, the socks, the notes', () => {
    const vibe = vibeBadges({ failed: 3, fixed: 2, compacted: 9 })
    expect(vibe.map(b => b.mark)).toEqual(['x', 'x', 'x', 'check', 'check', 'squash', 'squash', 'squash', 'squash', 'squash', 'squash'])
    expect(vibeBadges({ failed: 0, fixed: 0, compacted: 0 })).toEqual([])
    const socks = sockBadges(['honmei', 'taro'])
    expect(socks.length).toBe(13)
    expect(socks.filter(b => b.on).map(b => b.face)).toEqual([SOCK_FACES.honmei, SOCK_FACES.taro])
    expect(Object.keys(SOCK_FACES)).toEqual([...SOCK_PAIRS])
    expect(noteBadges(2).map(b => b.mark)).toEqual(['note', 'note'])
    const art = bagArtSvg(560, vibe)
    expect(art.match(/stroke-width="1.6"/g)?.length).toBe(vibe.length)
    expect(art).toContain('<ellipse')
    // a pair she does not have yet is only its dashed outline (owner 10-15), never a coloured disc
    const none = bagArtSvg(560, sockBadges([]))
    expect(none).toContain('stroke-dasharray')
    expect(Object.values(SOCK_FACES).some(face => none.includes(`fill="${face}" stroke="#141418" stroke-width="1.6"`))).toBe(false)
  })
  test('the terminal head is a coral frame that always fits its columns; the cells, then the badges, then the slashes give way', () => {
    const switches = Array.from({ length: 12 }, (_, i) => i % 4 !== 0)
    for (let columns = 12; columns <= 80; columns++) {
      const rows = bagTerminalHead(columns, '7开关', switches, { five: 3, week: 1 }, width)
      expect(rows.length).toBe(3)
      for (const row of rows) expect(row.reduce((n, run) => n + width(run.text), 0)).toBe(columns)
      expect(rows[0]![0]!.text.startsWith('▗')).toBe(true)
      expect(rows[2]![0]!.text.startsWith('▝')).toBe(true)
    }
    const text = (columns: number) => bagTerminalHead(columns, '7开关', switches, { five: 3, week: 1 }, width)[1]!.map(run => run.text).join('')
    expect(text(80)).toContain(' 7开关 ╱╱╱  (○)(●)(●)(●)')
    expect(text(80)).toContain('5h ▮▮▮▯ week ▮▯▯▯')
    expect(text(60)).not.toContain('5h')
    expect(text(60)).toContain('(●)')
    expect(text(20)).toContain('╱╱╱')
    expect(text(20)).not.toContain('(●)')
    expect(text(13)).toContain('7开关 ╱╱╱')
    expect(text(10)).toContain('7开关')
    expect(text(10)).not.toContain('╱')
  })
})
