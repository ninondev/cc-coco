// W1 order Do 3: exact v3 words replace old text pins; all other properties stay.
import { describe, expect, test } from 'claude-code/testing'
import { companionRecord, TASK_WORDS } from '../hooks/companion'
import { DOOR_WORDS } from '../hooks/door-words'
import { LINES } from '../hooks/lines'
import { APPROVED_PERSONA, APPROVED_REACTIONS } from './approved-localization'
import { APPROVED_RIDE } from './approved-ride'
import { VOICE } from '../hooks/voice'
import { LANGS, WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { CHINESE_README } from './review-texts'

const VIEW: Parameters<typeof companionRecord>[0] = {
  mood: 'idle', frame: 'idle-reading', said: null, slip: null, context: null, estimate: false,
  verb: '', band: 'on', voice: 'off', affection: 'warm', lang: 'zh', pictures: 'cells', colors: 'truecolor', cue: '',
}
// The owner dropped the two souls and the old 黑化 on 10-22: three red runs in a row are 炸毛 (DECISIONS 1134).
const FORBIDDEN = /荒魂|和魂|荒御魂|和御魂|黑化|两个魂|兩個魂/u
// The souls as each language's book and bag had them before 10-22.
const SOULS = /荒魂|和魂|黑化|\bsouls?\b|거친 혼|\bSeele\b|(?<!\p{L})âme(?!\p{L})|\balma\b|\banima\b|आत्मा|\bjiwa\b/iu

function strings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree]
  if (Array.isArray(tree)) return tree.flatMap(strings)
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(strings)
  return []
}

function violations(sources: Record<string, unknown>, forbidden = FORBIDDEN): string[] {
  return Object.entries(sources).flatMap(([source, tree]) =>
    strings(tree).filter(text => forbidden.test(text)).map(text => `${source}: ${text}`))
}

describe('owner-approved localization boundaries', () => {
  test('no language names the two souls in the book or the bag', () => {
    const bag = JSON.parse(BAG_TEXT_RAW)
    for (const { code: lang } of LANGS) expect(violations({ book: JSON.parse(BOOK_FILES[`${lang}.json`]), bag: bag[lang] }, SOULS)).toEqual([])
    for (const old of ['The wild soul came out', '荒魂が出た回数', '거친 혼이 나온 횟수', 'Die wilde Seele kam heraus', "L'âme sauvage est sortie", 'El alma salvaje salió', "L'anima selvaggia è uscita", 'A alma selvagem apareceu', 'जंगली आत्मा बाहर आई', 'Jiwa liarnya keluar', '黑化过']) {
      expect(violations({ book: { log: { wild: old } } }, SOULS).length).toBe(1)
    }
  })

  test('no soul names and no 黑化 appear in Chinese user-facing text', { timeoutMs: 60_000 }, () => {
    for (const { code: lang } of LANGS.filter(({ code }) => code.startsWith('zh'))) {
      const companion = companionRecord({ ...VIEW, lang })
      expect(violations({
        book: JSON.parse(BOOK_FILES[`${lang}.json`]), words: WORDS[lang],
        lines: [LINES[lang]], voice: VOICE, door: DOOR_WORDS[lang],
        companion: [companion.words, companion.reactions, TASK_WORDS[lang]], readme: CHINESE_README,
      })).toEqual([])
    }
  })

  test('the guard rejects each forbidden name in every covered source, including nested values', () => {
    const sources = ['book', 'words', 'lines', 'voice', 'door', 'companion', 'readme']
    for (const source of sources) {
      for (const term of ['荒魂', '和魂', '荒御魂', '和御魂', '黑化', '两个魂']) {
        expect(violations({ [source]: { zh: [{ text: `前${term}后` }] } }).length).toBe(1)
      }
    }
    expect(violations({ zh: '平常温和。炸毛过', en: 'Bristled' })).toEqual([])
  })

  test('Chinese book keeps the exact five approved values', () => {
    const book = JSON.parse(BOOK_FILES['zh.json'])
    // Her page as the owner rewrote it on 10-15; the birthday row went, so 脾气 (his 10-22 name) is the seventh row.
    expect(book.profile[6]).toEqual({ label: '脾气', text: '平时坐不住,爱抢功。测试连挂三次限制器就弹飞,火只冲烂代码从不冲你;真出大事时一秒收起玩笑替你兜底' })
    expect(book.log.wild).toBe('炸毛过')
    // The bag's extras (lane B 10-15) replaced the old book's readings about the kami; his 10-22 wording, picked from the de-AI rewrite and edited by him.
    expect(book.library.readings[1]).toEqual({
      title: '桌上的东西',
      text: '你桌上的零碎物件,全被她改造成了秘密基地。嫌吵就钻到鼠标底下躲清静,犯困就往杯子里塞个小睡袋打盹。代码一跑红,她嗖地缩进纸箱合上盖,只从缝里伸出两根手指比个V。碰上Claude拒答撂挑子,她就"叮"地把茶壶盖扣在脑袋上生闷气。熬到后半夜,她会盘腿窝在空泡面桶的软垫里陪你死磕。',
    })
  })

  test('all persona strings equal the frozen W1 values plus the approved W2 Chinese pat addition', { timeoutMs: 60_000 }, () => {
    // The fixture holds the owner's W2 pat line itself (zh, and zh-Hant from build-zh-hant), so every language is exact.
    for (const { code } of LANGS) expect(LINES[code]).toEqual(APPROVED_PERSONA[code])
    // Negative control: changing an unapproved warm line still fails the frozen boundary.
    const wrong = { ...LINES.en, start: ['changed without approval'] }
    expect(wrong).not.toEqual(APPROVED_PERSONA.en)
  })

  test('all companion reactions equal the approved W1 v3 native pools', { timeoutMs: 60_000 }, () => {
    for (const { code } of LANGS) {
      const { ride, ...before } = companionRecord({ ...VIEW, lang: code }).reactions
      expect(before).toEqual(APPROVED_REACTIONS[code])
      expect(ride).toEqual(APPROVED_RIDE[code])
    }
  })
})
