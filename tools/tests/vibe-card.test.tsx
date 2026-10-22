// The vibe check share card (lane C, 10-17; his design): the card itself, and its save on the vibe check page.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { vibeBalance, vibeCardSvg, vibePngSize, vibeRarity, vibeWrap } from '../hooks/vibe-card'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import { OPENING_TEXT_RAW, WEEK_TEXT_RAW } from './week-text-fixture'
import { RECENT, P, PERSON, world, settleLegacyStart, stubPng } from './world'
import { posixPath, samePath, slashPath } from './file-paths'

const BAG = JSON.parse(BAG_TEXT_RAW)
const PNG_1080_1350 = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAVGAQAAAABTNDYnAAAAyUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIB3A81OAAGYNrEaAAAAAElFTkSuQmCC'
const CARD = {
  lang: 'en', title: 'red to green twice. the tests blinked first', roasts: ['the first red was a typo', 'claude fixed it and said it planned that'],
  rows: [{ template: 'Red to green: {fixed}', key: 'fixed', value: '2' }, { template: 'Helpers: {n}, back: 3', key: 'n', value: '3' }],
  rarity: 'SR' as const, name: 'Coco', unofficial: 'unofficial fan mod',
}

test('VIBE the card is 1080 x 1350 plain SVG with the verdict, both roasts, the numbers in bold and her name', () => {
  const svg = vibeCardSvg({ ...CARD, art: { base64: PNG_1080_1350, width: 1080, height: 1350 } })
  expect(svg).toContain('width="1080" height="1350"')
  expect(svg).not.toMatch(/<filter|<foreignObject|<script|<style|<mask|feGaussian/)
  for (const word of CARD.title.split(' ')) expect(svg).toContain(word)
  expect(svg).toContain('the first red was a typo')
  expect(svg).toContain('claude fixed it and said it planned that')
  expect(svg).toContain('>2</tspan>')
  expect(svg).toContain('Helpers: <tspan')
  expect(svg).toContain('Coco')
  expect(svg).toContain('unofficial fan mod')
  expect(svg).toContain(`data:image/png;base64,${PNG_1080_1350}`)
  expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/)/)
  expect(svg).not.toMatch(/[–—]/)
  expect(vibeCardSvg({ ...CARD, rows: [] })).not.toContain('<tspan font-weight="800"')
  expect(vibeCardSvg({ ...CARD, lang: 'zh', roasts: ['测试先眨了眼'] })).toContain('「测试先眨了眼」')
})

test('VIBE lines wrap like each script: Korean at its spaces, Japanese never starts a line with a long vowel, the title clears the rarity letters and two lines balance', () => {
  expect(vibeWrap('테스트 아직 빨개. 오늘은 안 끝났어', 62, 840, 640)).toEqual(['테스트 아직 빨개.', '오늘은 안 끝났어'])
  const ja = vibeWrap('「このバグ、居座って家賃も払わない。ボクのパーカーより面の皮が厚い」', 34, 840)
  expect(ja.length).toBe(2)
  expect(ja.every(line => !/^[ーっゃゅょ、。」]/.test(line))).toBe(true)
  expect(vibeWrap('the first red was a typo and nothing more than that', 34, 400)).toEqual(['the first red was a', 'typo and nothing more', 'than that'])
  const title = vibeCardSvg({ ...CARD, title: 'テストまだ赤い。今日は終われない' })
  expect(title).toContain('>テストまだ赤い。</text>')
  expect(title).toContain('>今日は終われない</text>')
  // a roast whose second line would hold one word is balanced; a full second line is left alone
  expect(vibeBalance('“context more stuffed than the genius\'s ita bag”', 34, 840, 840, 1 / 3)).toEqual(['“context more stuffed than', 'the genius\'s ita bag”'])
  expect(vibeBalance('“claude dug the hole and filled it back in. counts, i guess”', 34, 840, 840, 1 / 3)).toEqual(vibeWrap('“claude dug the hole and filled it back in. counts, i guess”', 34, 840))
  // a verdict too long for two lines gets smaller type and keeps every word
  const long = vibeCardSvg({ ...CARD, lang: 'fr', title: '12 corrections, les tests hochent enfin la tête' })
  expect(long).toContain('font-size="56" font-weight="800"')
  expect(long).toContain('tête')
})

test('VIBE a number row too long for its column gets smaller type, never below 70 percent', () => {
  const svg = vibeCardSvg({ ...CARD, rows: [{ template: 'Plattgesessen (komprimiert): {n}', key: 'n', value: '3' }, { template: 'Commits: {n}', key: 'n', value: '4' }] })
  const size = (label: string): number => Number(new RegExp(`font-size="([\\d.]+)" fill="#5b5246">${label}`).exec(svg)?.[1])
  expect(size('Plattgesessen')).toBeLessThan(30)
  expect(size('Plattgesessen')).toBeGreaterThanOrEqual(21)
  expect(size('Commits: ')).toBe(30)
})

test('VIBE rarity: berserk and back to green is SSR, a fix or two squashes SR, anything else R', () => {
  expect(vibeRarity({ failed: 4, fixed: 1, compacted: 0, ran: 6, last: 'pass', storms: 1 })).toBe('SSR')
  expect(vibeRarity({ failed: 4, fixed: 1, compacted: 0, ran: 6, last: 'fail', storms: 1 })).toBe('SR')
  expect(vibeRarity({ failed: 0, fixed: 0, compacted: 2 })).toBe('SR')
  expect(vibeRarity({ failed: 0, fixed: 0, compacted: 1, ran: 3, last: 'pass' })).toBe('R')
})

test('VIBE a PNG header gives its size and anything else gives none', () => {
  expect(vibePngSize(PNG_1080_1350)).toEqual({ width: 1080, height: 1350 })
  expect(vibePngSize(stubPng('x'))).toEqual({ width: 1, height: 1 })
  expect(vibePngSize(btoa('not a picture at all, just words here'))).toBeUndefined()
  expect(vibePngSize('')).toBeUndefined()
})

const HOME = '/tmp/vibe-fixture-home', PICTURES = `${HOME}/Pictures`, FOLDER = `${PICTURES}/Coco`, STEM = 'vibe-2026-10-02-0900'
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const START = { cwd: '/tmp/vibe-fixture-project', surface: 'desktop' as const, isInteractive: true }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const allText = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(allText).join('') : n && typeof n === 'object' ? allText(n.children ?? []) : ''

function fixture(on: On, options: { failWrite?: boolean; noRaster?: boolean; noPictures?: boolean } = {}) {
  const commands: string[][] = [], files = new Map<string, string>(), texts: string[] = []
  on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || files.has(posixPath(e.path)) }))
  on('fs.stat', ($, e) => ({ value: samePath(e.path, PICTURES) && !options.noPictures ? { kind: 'dir', size: 0, isLink: false } : files.has(posixPath(e.path)) ? { kind: 'file', size: 512, isLink: false } : { kind: 'missing', size: 0, isLink: false } } as never))
  on('fs.read', { path: /[\\/]Pictures[\\/]Coco[\\/]/ }, ($, e) => ({ value: { base64: files.get(posixPath(e.path)) ?? PNG_1080_1350 } } as never))
  on('fs.write', ($, e) => { texts.push(e.text); if (options.failWrite) throw new Error('fixture cannot write'); files.set(posixPath(e.path), e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    if (e.argv[0] === 'sips') { if (options.noRaster) return { value: { ...OK, exitCode: 1 } }; files.set(e.argv.at(-1)!, PNG_1080_1350); return { value: OK } }
    if (e.argv[0] === 'mv') { files.set(e.argv[4]!, files.get(e.argv[3]!)!); files.delete(e.argv[3]!); return { value: OK } }
    if (e.argv[0] === 'rm') { for (const p of e.argv.slice(3)) files.delete(p); return { value: OK } }
    return { value: OK }
  })
  const w = world(on, { store: RECENT, surfaces: ['desktop'], env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME }, sessionId: 'vibe-fixture', readText: (path: string) => /[\\/]hooks[\\/]week-text\.json$/.test(path) ? WEEK_TEXT_RAW : /[\\/]hooks[\\/]opening-text\.json$/.test(path) ? OPENING_TEXT_RAW : undefined })
  return { w, commands, files, texts }
}
const open = async ($: any, f: ReturnType<typeof fixture>) => {
  await $.session.start(START); await settleLegacyStart($, f.w)
  await $.command.run({ command: 'coco', args: 'vibe', origin: PERSON, presentation: P })
  return $.ui.mount({ surface: 'desktop', ...PANE })
}

test('VIBE the page offers the card under her note, saves it through sips by the day and time, then opens it in the folder', async ($, on) => {
  const f = fixture(on), ui = await open($, f)
  const before = allText(await ui.drawn())
  expect(before).toContain(BAG.en.vibeGroups.share)
  expect(before).toContain(BAG.en.shareHelp)
  expect((await ui.find({ key: 'coco:vibe:save' }))?.props.label).toBe(BAG.en.share.save)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  const sips = f.commands.filter(c => c[0] === 'sips')
  expect(sips.length).toBe(1)
  expect(sips[0]!.slice(0, 4)).toEqual(['sips', '-s', 'format', 'png'])
  expect(f.files.has(`${FOLDER}/${STEM}.png`)).toBe(true)
  expect(allText(await ui.drawn())).toContain(`Saved to ~/Pictures/Coco/${STEM}.png`)
  expect(await ui.find({ key: 'coco:vibe:save' })).toBeUndefined()
  expect((await ui.find({ key: 'coco:vibe:show' }))?.props.label).toBe(BAG.en.share.folder)
  await ui.press({ key: 'coco:vibe:show' })
  expect(f.commands.some(c => c.length === 3 && c[0] === 'open' && c[1] === '-R' && c[2] === `${FOLDER}/${STEM}.png`)).toBe(true)
  expect(f.commands.flat().join(' ')).not.toMatch(/curl|wget|http/)
  await ui.unmount()
})

test('VIBE the card holds the day\'s verdict, their painting for it, and nothing of the project or the home folder', async ($, on) => {
  const f = fixture(on), ui = await open($, f)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  const svg = f.texts.find(text => text.startsWith('<svg')) ?? ''
  expect(BAG.en.vibe.noTests.some((set: { verdict: string }) => svg.includes(set.verdict.split(' ')[0]!))).toBe(true)
  const named = [...svg.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map(match => slashPath(atob(match[1]!)))
  expect(named.some(png => png.includes('card/vibe-noTests.png'))).toBe(true)
  expect(svg).not.toContain('vibe-fixture-project')
  expect(svg).not.toContain(HOME)
  await ui.unmount()
})

test('VIBE a card kept as SVG says so with its path', async ($, on) => {
  const f = fixture(on, { noRaster: true }), ui = await open($, f)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  expect(allText(await ui.drawn())).toContain(`Saved as SVG: ~/Pictures/Coco/${STEM}.svg`)
  await ui.unmount()
})

test('VIBE a failed save says so and offers the save again; no Pictures folder writes nothing', async ($, on) => {
  const f = fixture(on, { failWrite: true }), ui = await open($, f)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  expect(allText(await ui.drawn())).toContain('Save failed')
  expect(await ui.find({ key: 'coco:vibe:save' })).toBeDefined()
  await ui.unmount()
})

test('VIBE without a Pictures folder the save fails before writing anything', async ($, on) => {
  const f = fixture(on, { noPictures: true }), ui = await open($, f)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  expect(allText(await ui.drawn())).toContain('Save failed')
  expect(f.texts).toEqual([])
  expect(f.commands.some(c => c[0] === 'sips')).toBe(false)
  await ui.unmount()
})

test('VIBE turning the page forgets the save: back on the vibe check the button saves again', async ($, on) => {
  const f = fixture(on), ui = await open($, f)
  await ui.press({ key: 'coco:vibe:save' }); await ui.redraw()
  expect(await ui.find({ key: 'coco:vibe:show' })).toBeDefined()
  await ui.press({ key: 'coco:book:tab:offerings' }); await ui.redraw()
  await ui.press({ key: 'coco:book:tab:omen' }); await ui.redraw()
  expect(await ui.find({ key: 'coco:vibe:save' })).toBeDefined()
  expect(allText(await ui.drawn())).not.toContain('Saved to')
  await ui.unmount()
})
