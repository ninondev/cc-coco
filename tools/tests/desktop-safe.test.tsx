import { describe, expect, test } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'
import { DESKTOP_LIMITS, normalizeDesktopSettings, normalizeDesktopView, safeDesktopTree, validateDesktopTree } from '../hooks/desktop-safe'
import { desktopBand, desktopDoor } from '../hooks/band'
import { initialView, STILL } from '../hooks/mood'
import { cocoAction, cocoBase, cocoStill, installCocoData } from '../hooks/coco-motion'
import type { CocoData } from '../hooks/coco-motion'
import { COCO_RESTING } from '../hooks/coco-stills'
import { LANGS } from '../hooks/words'
import { claudieReady, claudieSvg, installClaudie, pngSize } from '../hooks/claudie'

const name = (): RenderElement => ({ type: 'Text', children: ['Coco'] })
const svg = (source = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'): RenderElement => ({ type: 'Svg', props: { source, alt: 'Coco' } })
const still = (): RenderElement => ({ type: 'Box', children: [svg(), name()] })
const bad = (node: unknown): RenderElement => node as RenderElement
function refused(tree: unknown): boolean { try { validateDesktopTree(tree); return false } catch { return true } }

// SPEC 0.2 rule 7 and visual review rows 9/12: names remain labels; alt duration stays plain.
test('restored C3 labels and incense alt duration survive normalization',()=>{
  const view=normalizeDesktopView({...initialView(),line:{id:'pace',key:'pace',class:1,text:'Codex',expiresAt:14000,slots:[{value:'Codex',kind:'label'}]},paceDetails:[{kind:'five_hour',wide:'wide',narrow:'narrow',t:'1h 2m'}]},initialView(),['idle-reading'])
  expect(view.line?.slots).toEqual([{value:'Codex',kind:'label'}])
  expect(view.paceDetails?.[0]?.t).toBe('1h 2m')
})

test('M1 safety actions, paid option actions and retained ash survive view normalization',()=>{
 const actions=[{key:'coco:more:paste:hide',label:'Hide'},{key:'coco:more:paste:keep',label:'Keep'}]
 const moreActions=[{key:'coco:more:toHim',label:'To him'},{key:'coco:more:explain',label:'Explain simply'}]
 const view=normalizeDesktopView({...initialView(),line:{id:'paste',key:'more.paste',class:3,text:'key',expiresAt:14000,buttons:actions},moreActions,spentWindows:['five_hour'],spentResets:{five_hour:1700000000000}},initialView(),['idle-reading'])
 expect(view.line?.buttons).toEqual(actions);expect(view.moreActions).toEqual(moreActions)
 expect(view.spentWindows).toEqual(['five_hour']);expect(view.spentResets).toEqual({five_hour:1700000000000})
 const badView=normalizeDesktopView({...initialView(),moreActions:[{key:12,label:'bad'},null],spentWindows:[true,12],spentResets:{bad:NaN}},initialView(),['idle-reading'])
 expect(badView.moreActions).toEqual([]);expect(badView.spentWindows).toEqual([]);expect(badView.spentResets).toEqual({})
})

describe('desktop pre-return contract', () => {
  test('rejects Bogus and unsupported terminal elements at any depth; a Client needs its key and its own module', () => {
    for (const type of ['Bogus', 'Client', 'Raster', 'Image']) {
      expect(refused({ type: 'Box', children: [{ type, props: {} }] })).toBe(true)
    }
    const client = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: 'Box', children: [{ type: 'Client', props, ...extra }] })
    expect(refused(client({ key: 'coco:touch', module: './play-client.ts', width: 8, height: 3, props: { mode: 'desktop' } }))).toBe(false)
    expect(refused(client({ key: 'coco:touch', module: 'hooks/play-client.ts' }, { client: { plugin: 'coco' }, children: [] }))).toBe(false)
    for (const props of [{ module: './play-client.ts' }, { key: 'k', module: '../outside.ts' }, { key: 'k', module: './play-client.ts', props: { run: () => 1 } }, { key: 'k', module: './play-client.ts', props: 'x'.repeat(100_001) }])
      expect(refused(client(props))).toBe(true)
    expect(refused(client({ key: 'k', module: './play-client.ts' }, { children: [{ type: 'Text', children: ['x'] }] }))).toBe(true)
    expect(refused({ type: 'Text', children: [{ type: 'Client', props: { key: 'k', module: './play-client.ts' } }] })).toBe(true)
  })
  test('a Button may hold strings and Text in place of its label, nothing else', () => {
    const button = (children: unknown[]) => ({ type: 'Button', props: { key: 'coco:book:open' }, press: { plugin: 'coco', handle: 1 }, children })
    expect(refused(button([{ type: 'Text', props: { size: 'title' }, children: ['👜'] }, { type: 'Text', children: [' 设置'] }]))).toBe(false)
    expect(refused(button(['👜 设置']))).toBe(false)
    for (const children of [[], [{ type: 'Svg', props: { source: '<svg></svg>', alt: 'x' } }], [{ type: 'Box', children: ['x'] }]])
      expect(refused(button(children))).toBe(true)
  })
  test('Text accepts the cap, newline and tab but rejects overflow and controls', () => {
    expect(refused({ type: 'Text', children: ['a'.repeat(10_000)] })).toBe(false)
    expect(refused({ type: 'Text', children: ['ok\n\ttext'] })).toBe(false)
    for (const text of ['a'.repeat(10_001), 'hello\u0001there', 'hello\rthere', 'hello\u0085there'])
      expect(refused({ type: 'Text', children: [text] })).toBe(true)
    expect(refused({ type: 'Text', children: ['a'.repeat(5000), 'b'.repeat(5001)] })).toBe(true)
  })
  test('SVG and Markdown image limits reserve at least ten percent', () => {
    const source = (length: number) => `<svg>${' '.repeat(length - 11)}</svg>`
    expect(refused(svg(source(DESKTOP_LIMITS.svg)))).toBe(false)
    expect(refused(svg(source(DESKTOP_LIMITS.svg + 1)))).toBe(true)
    const image = (length: number) => `![a](x)${' '.repeat(length - 7)}`
    expect(refused({ type: 'Markdown', props: { text: image(9000) } })).toBe(false)
    expect(refused({ type: 'Markdown', props: { text: image(9001) } })).toBe(true)
    expect(refused(svg('<svg><image href="data:image/png;base64,undefined"/></svg>'))).toBe(true)
  })
  test('requires leaves, correct props, required fields, unique keys and legal inline children', () => {
    for (const tree of [
      { type: 'Text', props: { unexpected: true } }, { type: 'Box', props: null },
      { type: 'Svg', props: { source: '<svg></svg>' } },
      { type: 'Svg', props: { source: '<svg></svg>', alt: 'x' }, children: [] },
      { type: 'Button', props: { key: 'x', label: 'x' } },
      { type: 'Box', children: [{ type: 'Box', props: { key: 'same' } }, { type: 'Box', props: { key: 'same' } }] },
      { type: 'Text', children: [{ type: 'Box' }] }, { type: 'Text', children: [{ type: 'engine', ref: 0 }] },
      { type: 'Box', props: { padding: Number.NaN } },
    ]) expect(refused(tree)).toBe(true)
  })
  test('hover requires a valid local scope and legal non-layout overrides', () => {
    expect(refused({ type: 'Text', children: ['x'], hover: { bold: true } })).toBe(true)
    expect(refused({ type: 'Text', children: ['x'], hover: { scope: 'named', bold: true } })).toBe(false)
    expect(refused({ type: 'Box', props: { key: 'local' }, children: [{ type: 'Text', children: ['x'], hover: { bold: true } }] })).toBe(false)
    for (const scope of ['', 'x'.repeat(65), 'bad\u0001'])
      expect(refused({ type: 'Text', hover: { scope, bold: true }, children: ['x'] })).toBe(true)
    expect(refused({ type: 'Box', hover: { scope: 'x', display: 'flex' } })).toBe(true)
    expect(refused({ type: 'Box', props: { display: 'none' }, hover: { scope: 'x', display: 'flex' } })).toBe(false)
    expect(refused({ type: 'Box', hover: { scope: 'x', top: 1 } })).toBe(true)
    expect(refused({ type: 'Box', props: { position: 'absolute' }, hover: { scope: 'x', top: 1 } })).toBe(false)
  })
  test('Code and Markdown preserve allowed newlines while malformed links fail closed', () => {
    for (const tree of [{ type: 'Code', props: { source: 'line\n\tline' } }, { type: 'Markdown', props: { text: 'line\n\tline' } }])
      expect(refused(tree)).toBe(false)
    for (const href of ['https://example.com', 'https://EXAMPLE.COM/', 'file:///x', 'https://example.com/has space', 'https://user@example.com/', 'https://'])
      expect(refused({ type: 'Link', props: { href } })).toBe(true)
    expect(refused({ type: 'Link', props: { href: 'https://example.com/' } })).toBe(false)
  })
  test('cycles, accessors, too deep/wide trees and aggregate strings are bounded', () => {
    const cycle: { type: string; children?: unknown[] } = { type: 'Box' }; cycle.children = [cycle]
    expect(refused(cycle)).toBe(true)
    let deep: unknown = name()
    for (let i = 0; i < DESKTOP_LIMITS.depth + 1; i++) deep = { type: 'Box', children: [deep] }
    expect(refused(deep)).toBe(true)
    expect(refused({ type: 'Box', children: Array.from({ length: DESKTOP_LIMITS.nodes }, name) })).toBe(true)
    expect(refused({ type: 'Box', children: Array.from({ length: 27 }, () => ({ type: 'Text', children: ['a'.repeat(10000)] })) })).toBe(true)
    expect(refused({ type: 'Text', get props() { throw Error('no access') } })).toBe(true)
  })
  test('full build throw and every invalid tree fault select still, then name', () => {
    const injected = [bad({ type: 'Bogus' }), bad({ type: 'Text', children: ['x'.repeat(10001)] }), bad({ type: 'Text', children: ['bad\u0001'] }), svg('<svg>' + ' '.repeat(DESKTOP_LIMITS.svg) + '</svg>'), bad({ type: 'Markdown', props: { text: '![x](y)' + 'x'.repeat(9001) } }), bad({ type: 'Client', props: {} })]
    for (const tree of injected) {
      expect(safeDesktopTree(() => tree, still, name).fallback).toBe('still')
      expect(safeDesktopTree(() => tree, () => tree, name).fallback).toBe('name')
    }
    expect(safeDesktopTree(() => { throw Error('build') }, still, name).fallback).toBe('still')
    const last = safeDesktopTree(() => { throw Error('full') }, () => { throw Error('still') }, () => { throw Error('name') })
    expect(last.fallback).toBe('name'); expect(refused(last.tree)).toBe(false)
    expect(safeDesktopTree(still, still, name).fallback).toBe('full')
  })
  test('restored unknown language/mood/frame and null settings become safe plain data', () => {
    const defaults = initialView()
    expect(normalizeDesktopSettings(null)).toEqual({})
    const view = normalizeDesktopView({ ...defaults, lang: 'xx-unknown', mood: 'bad', frame: 'missing' }, defaults, ['idle-reading', 'sleep'])
    expect(view.lang).toBe('en'); expect(view.mood).toBe('idle'); expect(view.frame).toBe('idle-reading')
    expect(normalizeDesktopView(null, defaults, ['idle-reading'])).toEqual(defaults)
    const restored = normalizeDesktopView({ ...defaults, said: 'x'.repeat(100000), slip: { rank: 'x', label: '<&', text: 'fortune' }, context: Number.NaN }, defaults, ['idle-reading'])
    expect(restored.said!.length).toBe(10001); expect('slip' in restored).toBe(false); expect(restored.context).toBeNull()
    const later = normalizeDesktopView({ ...defaults, lang: 'ja', mood: 'sleep', frame: 'sleep' }, defaults, ['idle-reading', 'sleep'])
    expect(later.lang).toBe('ja'); expect(later.mood).toBe('sleep'); expect(later.frame).toBe('sleep')
  })
  test('optional companion preferences preserve restored choices and absent defaults', () => {
    const defaults = initialView()
    for (const companionTarget of ['auto', 'claude', 'vscode'] as const) {
      const restored = normalizeDesktopView({ companionTarget, neighbours: true }, defaults, ['idle-reading'])
      expect(restored.companionTarget).toBe(companionTarget)
      expect(restored.neighbours).toBe(true)
    }
    const invalid = normalizeDesktopView({ companionTarget: 'unknown', neighbours: 'unknown' }, defaults, ['idle-reading'])
    expect(invalid.companionTarget).toBe('auto')
    expect(invalid.neighbours).toBe(false)
    const selected = { ...defaults, companionTarget: 'vscode' as const, neighbours: true }
    expect(normalizeDesktopView(null, selected, ['idle-reading'])).toEqual(selected)
    expect(normalizeDesktopView(null, defaults, ['idle-reading'])).toEqual(defaults)
  })
  test('actual desktop constructors and the B1 rich band survive the validator', async ($, on) => {
    let captured: RenderElement | undefined
    on('ui.render', { component: 'InfoNotice' }, ($, e) => {
      if (e.surface !== 'desktop') return name()
      const ui = $.ui.resolve(e)
      captured = desktopBand(ui, initialView(), { columns: 100, maxRows: 30, screenRows: 48, isWorking: false }, '<svg width="70" height="64"></svg>')
      validateDesktopTree(captured)
      return captured
    })
    const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'InfoNotice', props: { text: 'test', command: null } } as never)
    expect(captured).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'coco:band:poke' })).toBeDefined()
  })
  test('every mood, language, style and Off door retains the full tier', async ($, on) => {
    // the door draws her dozing from the resting states the plugin installs when it loads
    for (const outfit of ['A', 'B'] as const) installCocoData(COCO_RESTING[outfit] as unknown as CocoData, true)
    let checked = 0
    on('ui.render', { component: 'InfoNotice' }, ($, e) => {
      if (e.surface !== 'desktop') return name()
      const ui = $.ui.resolve(e)
      for (const { code: lang } of LANGS) for (const mood of Object.keys(STILL) as Array<keyof typeof STILL>) for (const band of ['on', 'compact'] as const) {
        const view = { ...initialView(), lang, mood, frame: STILL[mood], band }
        const picture = cocoStill('A', 'idle', band === 'compact' ? 32 : 64)
        const answer = safeDesktopTree(() => desktopBand(ui, view, { columns: 100, maxRows: 30, screenRows: 48, isWorking: false }, picture), still, name)
        expect(answer.fallback).toBe('full')
        checked++
        expect(safeDesktopTree(() => desktopDoor(ui, { ...view, band: 'off' }, () => {}), still, name).fallback).toBe('full')
        checked++
      }
      return name()
    })
    await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'InfoNotice', props: { text: 'test', command: null } })
    expect(checked).toBe(LANGS.length * Object.keys(STILL).length * 4)
  })
  test('every other documented desktop primitive keeps its actual constructor shape', async ($, on) => {
    on('ui.render', { component: 'InfoNotice' }, ($, e) => {
      if (e.surface !== 'desktop') return name()
      const { Box, Text, Input, Select, Link, Code, Markdown, Button } = $.ui.resolve(e)
      const tree = <Box key="safe:scope" position="relative">
        <Text hover={{ bold: true }}>name <Link href="https://example.com/">link</Link></Text>
        <Button key="safe:button" label="button" onPress={() => {}} hover={{ scope: 'safe:group', bold: true }} />
        <Input key="safe:input" value="" onInput={() => {}} onSubmit={() => {}} />
        <Select key="safe:select" options={[{ value: 'a', label: 'A' }]} value="a" onSelect={() => {}} />
        <Code source={'const x = 1\n\tconst y = 2'} language="typescript" />
        <Markdown text={'first\n\tsecond'} />
        <Markdown key="safe:markdown" text="[link](file:///example)" pressableLinks={['file:///example']} onLinkPress={() => {}} />
      </Box>
      validateDesktopTree(tree)
      return tree
    })
    const ui = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'InfoNotice', props: { text: 'test', command: null } })
    for (const type of ['Input', 'Select', 'Link', 'Code', 'Markdown', 'Button']) expect(await ui.find({ type })).toBeDefined()
  })
})

// DECISIONS 943: the band draws one of the two Claudies only when the view names her; anything else is Coco.
test('claudie survives view normalization only as one of the two forms',()=>{
  expect(normalizeDesktopView({...initialView(),claudie:'dake'},initialView(),['idle-reading']).claudie).toBe('dake')
  expect(normalizeDesktopView({...initialView(),claudie:'maid'},initialView(),['idle-reading']).claudie).toBe('maid')
  expect(normalizeDesktopView({...initialView(),claudie:'coco'} as never,initialView(),['idle-reading']).claudie).toBeUndefined()
})

test('a Claudie cell fills the box kept for Coco, stands on its bottom edge, and needs all sixteen',()=>{
  const png=Array.from({length:16},(_,i)=>`cell${i+1}`)
  installClaudie('maid',undefined)
  expect(claudieSvg('maid','idle',40,64)).toBe('')
  installClaudie('maid',{width:10,height:16,png})
  expect(claudieReady('maid')).toBe(true)
  const out=claudieSvg('maid','pack',40.004,64)
  expect(out).toContain('viewBox="0 0 40 64"')
  expect(out).toContain('preserveAspectRatio="xMidYMax meet"')
  expect(out).toContain('base64,cell15"')
  expect(claudieSvg('maid','idle',40,64)).toContain('base64,cell14"')
  expect(claudieSvg('maid','error',40,64)).toContain('base64,cell10"')
  installClaudie('maid',{width:10,height:16,png:png.slice(1)})
  expect(claudieReady('maid')).toBe(false)
  expect(pngSize('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).toEqual({width:1,height:1})
  expect(pngSize('bm90IGEgcG5n')).toBeUndefined()
})

// The new frames of 10-16 (lane C's asks): the breathing light, falling asleep, a helper's plane back.
test('the breathing light, sleep and a helper back pick breath, nap and catch',()=>{
  expect(cocoAction({mood:'work',working:true,breath:true})).toBe('breath')
  expect(cocoBase({mood:'work',working:true,breath:true})).toBe('breath')
  expect(cocoAction({mood:'work',working:true,breath:true,touch:'pat'})).toBe('petted')
  expect(cocoAction({mood:'work',working:true,pose:'search'})).toBe('search')
  expect(cocoAction({mood:'sleep',working:false})).toBe('nap')
  expect(cocoBase({mood:'sleep',working:false})).toBe('nap')
  expect(cocoAction({mood:'sleep',working:false,night:true})).toBe('night')
  expect(cocoAction({mood:'idle',working:false,act:'catch'})).toBe('catch')
})
