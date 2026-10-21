import { test, expect } from 'bun:test'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'

// Before integration root supplies the real generated candidate explicitly.
// After integration the same cases exercise the shipping compiled graph.
const explicit = process.env.COCO_HOOKS_GRAPH_PLUGIN
const plugin = explicit ?? resolve(import.meta.dir, '../../plugin')
const manifestPath = join(plugin, 'hooks/m1-compiled/manifest.json')
const enabled = existsSync(manifestPath)
if (explicit && !enabled) throw Error('Explicit compiled hook graph fixture is missing')
const graphTest = enabled ? test : test.skip
const manifest = enabled ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined

async function modules(name: string) {
  const mapping = manifest.publicMap['hooks-source/' + name]
  if (!mapping) throw Error('Missing canonical public map: ' + name)
  const [facade, group] = await Promise.all([
    import(join(plugin, mapping.publicPath)), import(join(plugin, mapping.group)),
  ])
  return { facade, direct: Object.fromEntries(Object.entries(mapping.aliases).map(([name, alias]) => [name, group[alias as string]])) }
}

graphTest('every public runtime export is the same compiled class function or state reference', async () => {
  let modulesChecked = 0, exportsChecked = 0
  for (const [path, mapping] of Object.entries(manifest.publicMap) as [string, any][]) {
    const {facade, direct} = await modules(path.replace('hooks-source/', ''))
    expect(Object.keys(facade).sort()).toEqual(Object.keys(mapping.aliases).sort())
    for (const name of Object.keys(mapping.aliases)) {
      expect(facade[name]).toBe(direct[name])
      exportsChecked++
    }
    modulesChecked++
  }
  expect(modulesChecked).toBe(Object.keys(manifest.publicMap).length)
  expect(modulesChecked).toBeGreaterThan(70)
  expect(exportsChecked).toBeGreaterThan(100)
})

graphTest('More pending reads reset and cross-group choices share one word cache', async () => {
  const {facade: words, direct} = await modules('more-words.ts')
  const {facade: state} = await modules('more-state.ts')
  const raw = readFileSync(join(plugin, 'hooks/more-text.json'), 'utf8')
  const authored = JSON.parse(raw)
  expect(authored['more.cap.off'].en.length).toBeGreaterThan(0)
  words.resetMoreWords()
  try {
    let reads = 0, release!: (raw: string) => void
    const held = new Promise<string>(resolve => { release = resolve })
    const read = () => { reads++; return held }
    const first = words.loadMoreWords(read), second = direct.loadMoreWords(read)
    expect(first).toBe(second)
    expect(reads).toBe(1)
    direct.resetMoreWords()
    release(raw)
    expect(await first).toBe(false)
    expect(words.moreWord('cap.off', 'en')).toBe('')
    expect(state.capChoices('en', false)[0].label).toBe('')
    expect(await direct.loadMoreWords(async () => { reads++; return raw })).toBe(true)
    expect(reads).toBe(2)
    expect(words.MORE_SLOTS).toBe(direct.MORE_SLOTS)
    expect(words.moreWord('cap.off', 'en')).toBe(authored['more.cap.off'].en)
    expect(state.capChoices('en', false)[0].label).toBe(authored['more.cap.off'].en)
    words.resetMoreWords()
    expect(direct.moreWord('cap.off', 'en')).toBe('')
    expect(state.capChoices('en', false)[0].label).toBe('')
  } finally { words.resetMoreWords() }
})

graphTest('gaps pending reads reset and runtime hint consumer share one word cache', async () => {
  const {facade: words, direct} = await modules('mod-gaps-words.ts')
  const {facade: gaps} = await modules('mod-gaps.ts')
  const raw = readFileSync(join(plugin, 'hooks/gaps-text.json'), 'utf8')
  expect(JSON.parse(raw)['hint.tail'].en.length).toBeGreaterThan(0)
  const hint = () => gaps.hintTail({surface:'terminal',band:'text',sessions:1,keysUsed:false,isDraft:false,isWorking:false,lang:'en'})
  words.resetGapWords()
  try {
    let reads = 0, release!: (raw: string) => void
    const held = new Promise<string>(resolve => { release = resolve })
    const read = () => { reads++; return held }
    const first = words.loadGapWords(read), second = direct.loadGapWords(read)
    expect(first).toBe(second)
    expect(reads).toBe(1)
    direct.resetGapWords()
    release(raw)
    expect(await first).toBe(false)
    expect(words.gapWord('en', 'hint.tail')).toBe('')
    expect(await direct.loadGapWords(async () => { reads++; return raw })).toBe(true)
    expect(reads).toBe(2)
    expect(hint()).toBe(', ' + words.gapFill('en', 'hint.tail', {}))
    expect(words.gapWord('en', 'hint.tail').length).toBeGreaterThan(0)
    words.resetGapWords()
    expect(direct.gapWord('en', 'hint.tail')).toBe('')
    expect(hint()).toBe(', ')
  } finally { words.resetGapWords() }
})

graphTest('latest state mutation is visible through public and compiled imports', async () => {
  const {facade, direct} = await modules('latest.ts')
  const before = facade.latest.desktopRenders
  try {
    facade.latest.desktopRenders = before + 37
    expect(direct.latest.desktopRenders).toBe(before + 37)
    direct.latest.desktopRenders = before + 19
    expect(facade.latest.desktopRenders).toBe(before + 19)
  } finally { facade.latest.desktopRenders = before }
})

graphTest('generated facade keeps mutable bindings live with an explicitly synthetic provider', async () => {
  const mapping = manifest.publicMap['hooks-source/latest.ts']
  const aliases = mapping.aliases
  const temp = mkdtempSync(join(tmpdir(), 'hooks-live-facade-'))
  try {
    const publicPath = join(temp, mapping.publicPath), groupPath = join(temp, mapping.group)
    mkdirSync(dirname(publicPath), {recursive:true})
    mkdirSync(dirname(groupPath), {recursive:true})
    // The facade is exact generator output. This small provider supplies a mutable
    // primitive solely to verify forwarding; shipping MARKS_DEFAULT remains const.
    writeFileSync(publicPath, readFileSync(join(plugin, mapping.publicPath)))
    writeFileSync(groupPath, `export let ${aliases.MARKS_DEFAULT}=0;export const ${aliases.latest}={};export function ${aliases.marksFrom}(){${aliases.MARKS_DEFAULT}++;}\n`)
    const [facade, group] = await Promise.all([import(publicPath), import(groupPath)])
    expect(facade.MARKS_DEFAULT).toBe(0)
    group[aliases.marksFrom]()
    expect(group[aliases.MARKS_DEFAULT]).toBe(1)
    expect(facade.MARKS_DEFAULT).toBe(1)
    facade.marksFrom()
    expect(group[aliases.MARKS_DEFAULT]).toBe(2)
    expect(facade.MARKS_DEFAULT).toBe(2)
  } finally { rmSync(temp, {recursive:true,force:true}) }
})

graphTest('subclass and instance identity survives the public constructor export', async () => {
  const {facade, direct} = await modules('more-runtime.ts')
  class Derived extends facade.MoreRuntime {}
  const runtime = new Derived()
  expect(Object.getPrototypeOf(Derived.prototype)).toBe(direct.MoreRuntime.prototype)
  expect(runtime instanceof direct.MoreRuntime).toBe(true)
  runtime.values = {lively:true}
  expect(runtime.isOn('lively')).toBe(true)
  expect(runtime.isOn('look')).toBe(false)
})
