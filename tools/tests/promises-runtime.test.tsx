import { expect, test } from 'claude-code/testing'
import { BAG_TEXT_RAW } from './bag-text-fixture'
import type { Plugin } from 'claude-code/testing'
import { initialView } from '../hooks/mood'
import { VOICE } from '../hooks/voice'
import { HAIRLINE, desktopBand } from '../hooks/band'
import { EMPTY_12x1, scrollSvg, shedRowSvg, d1Word, loadD1Art, loadD1Words } from '../hooks/d1-state.js'
import { D1_ART_FILES } from './d1-art-fixture'
import { D1_WORDS_TEXT } from './d1-room-fixture'
import { cocoStill, installCocoData } from '../hooks/coco-motion'
import type { CocoData } from '../hooks/coco-motion'
import { COCO_RESTING } from '../hooks/coco-stills'
import { LANGS, WORDS } from '../hooks/words'
import { reminderSettings } from '../hooks/reminder-settings'
import { companionActivity, companionEnded, companionKey, companionText } from '../hooks/companion'
import { CompanionChannel } from '../hooks/channel'
import { CompanionBook } from '../hooks/companion-book'
import { bagBadgeSvg } from '../hooks/bag'
import { companionRun } from '../hooks/pages'
import { PLUGIN_SOURCES } from './plugin-sources'
import { posixPath } from './file-paths'
import { RUNTIME_PROMISE_INPUT } from './promises-runtime-input'
import { world, RECENT, P, PERSON, band, desktopPicture, settleLegacyStart } from './world'
import { PRIVATE, SURFACES, PANE, PROMISE_FOLDER, PROMISE_PROJECT, TOOL_CASES, DRIVEN_HOOKS, M1_DRIVEN_HOOKS, promiseWorld, drivePromiseEvents } from './promises-runtime-world'

const ASK = { model: 'claude', promptModel: 'claude', tools: [], outputStyle: null, traits: [] }
const containsPrivate = (value: unknown) => Object.values(PRIVATE).filter(marker => JSON.stringify(value)?.includes(marker))
const canonical = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '').replace(/^\/private\/(?=(?:tmp|var)\/)/, '/')
  const pieces: string[] = []
  for (const piece of normalized.split('/')) {
    if (!piece || piece === '.') continue
    if (piece === '..') pieces.pop(); else pieces.push(piece)
  }
  return (normalized.startsWith('/') ? '/' : '') + pieces.join('/')
}
const within = (path: string, folder: string) => canonical(path) === canonical(folder) || canonical(path).startsWith(canonical(folder) + '/')
const runtimeWorld = promiseWorld
function assertAppendScope(f: ReturnType<typeof promiseWorld>) {
  expect(f.appended).toEqual([{ door: 'prompt', uuid: 'p1-user-row' }, { door: 'response', uuid: 'p1-answer-row' }])
  expect(f.appendOutcomes.map(({ door, uuid }) => ({ door, uuid }))).toEqual([
    { door: 'prompt', uuid: 'p1-user-row' }, { door: 'response', uuid: 'p1-answer-row' },
  ])
  expect(f.unsupportedAppend).toEqual(f.appendOutcomes.filter(row => row.status === 'unsupported').map(row => row.door))
  for (const row of f.appendOutcomes) {
    if (row.status === 'unsupported') {
      expect(row.reason).toContain('no implementation for session.append')
    } else {
      const expected = row.door === 'prompt'
        ? { uuid: 'p1-user-row', message: { type: 'user', role: 'user', content: [{ type: 'text', text: PRIVATE.prompt }], isMeta: false } }
        : { uuid: 'p1-answer-row', message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: PRIVATE.reply }] } }
      expect(row.result).toEqual(expected)
    }
  }
  // The response handler's pre-next ledger.request must settle this same UUID.
  expect(f.stores.some(entry => entry.key.startsWith('heads:v2:') && Array.isArray(entry.value) && entry.value[0] === 'p1-answer-row')).toBe(true)
}
// Native person-origin close is not exposed by this kit. This documented extra-plugin
// fixture dispatches plugin-origin close through the same registered ui.close chain.
const CLOSER: Plugin = { name: 'p1-closer', register(on) {
  on('command.run', { command: 'p1-fixture-close' }, async $ => { await $.ui.close({ id: 'coco-book' }); return {} })
} }

test('P1 owner decision new installs start with voice off', () => {
  expect(initialView().voice).toBe('off')
})

test('A2 shipped voice sizes match every level and language', () => {
  const { voiceSizes } = RUNTIME_PROMISE_INPUT
  expect(voiceSizes.version).toBe(1)
  expect(voiceSizes.sourceSha256).toBe(RUNTIME_PROMISE_INPUT.voiceSourceSha256)
  expect(Object.keys(voiceSizes.languages).sort()).toEqual(LANGS.map(lang => lang.code).sort())
  for (const { code } of LANGS) expect(voiceSizes.languages[code]).toEqual({ off: 0, light: [...VOICE.light].length, full: [...VOICE.full].length })
})

test('A4 token feature defaults and voice cost disclosure match shipping', async () => {
  const features = RUNTIME_PROMISE_INPUT.tokenFeatures
  expect(features.map(feature => feature.feature).sort()).toEqual(['voice', 'book companion actions', 'companion typed instruction', 'More model options', 'companion command verb', 'keep warm'].sort())
  expect(initialView().voice).toBe(features.find(feature => feature.feature === 'voice')?.default)
  for (const feature of features.filter(feature => feature.feature !== 'voice')) expect(/^off until (?:an )?explicit/.test(feature.default)).toBe(true)
  // The owner's 10-15 light section; the README states its size, so a new length needs a README that says it.
  expect([...VOICE.light].length).toBe(338)
  expect(RUNTIME_PROMISE_INPUT.readme).toContain(`${[...VOICE.light].length}-character instruction`)
  // Current token-producing channels: voice, typed companion Send, and explicit
  // companion-action Bash fallback. Action flags default absent, hence disabled.
  const normal = JSON.stringify(initialView())
  for (const key of ['iconApply', 'iconRestore', 'update', 'submit', 'vision', 'trim', 'thinking']) expect(normal.includes('"' + key + '":true')).toBe(false)
  expect(reminderSettings({})).toEqual({ guard: true, bookmark: true, notes: true, budget: 'off', neighbours: false, appIcon: 'off', dockTile: 'off', longTask: 'band', trim: false, breathe: true, stickEnd: 'quiet', week: true })
  expect(RUNTIME_PROMISE_INPUT.manifest.userConfig.band.default).toBe('on')
  // Every plugin-side token-producing call must be listed; additions fail this inventory.
  const callers = Object.entries(PLUGIN_SOURCES).filter(([path]) => !path.includes('/algo/')).flatMap(([path, source]) =>
    [...source.matchAll(/\$\.(?:prompt\.submit|tool\.call|model\.\w+)\s*\(/g)].map(match => path + ':' + match[0]))
  const registered = features.flatMap(feature => feature.callSites).filter(site => !site.endsWith(':prompt.compose'))
  expect(callers.sort()).toEqual(registered.sort())
  expect(features.find(feature => feature.feature === 'voice')?.callSites).toEqual(['hooks/register.tsx:prompt.compose'])
  // Execute the shipping action boundaries with local callbacks. Starting the
  // typed instruction channel is quiet; a validated Send is the submit boundary.
  const submitted: string[] = [], notes: string[] = [], bash: unknown[] = []
  let receive: ((text: string) => Promise<void>) | undefined
  const channel = new CompanionChannel({ exists: async () => true, now: async () => 10000,
    listen: callback => { receive = callback; return () => {} },
    submit: async text => { submitted.push(text) }, clear: async () => {} }, 'p1-action-session', PROMISE_FOLDER,
    { running: () => {}, seen: () => {}, ack: async () => {}, changed: async () => {}, note: async (note: { text: string }) => { notes.push(note.text) } })
  await channel.start()
  expect(submitted).toEqual([])
  await receive!(JSON.stringify({ v: 1, id: '1234567890abcdef', at: 10000, session: 'p1-action-session', kind: 'submit', text: PRIVATE.input }) + '\n')
  // M1 finding 2: a validated Send becomes a note the person passes with a press; nothing is submitted on its own.
  expect(submitted).toEqual([]);expect(notes).toEqual([PRIVATE.input])
  channel.stop()
  const engine = { process: { run: async () => { throw Error('p1 unsupported process seam') } },
    tool: { call: async (input: unknown) => { bash.push(input); return { result: { stdout: '', stderr: '', exitCode: 0 } } } } }
  expect(bash).toEqual([])
  expect(await companionRun(engine as never, new CompanionBook(), ['/bin/sh', '/p1/explicit-action'], 'p1 explicit action')).toMatchObject({ kind: 'ran', exitCode: 0 })
  expect(bash).toEqual([{ tool: 'Bash', command: "'/usr/bin/env' 'PATH=/usr/bin:/bin:/usr/sbin:/sbin' '/bin/sh' '/p1/explicit-action'", description: 'p1 explicit action', timeout: 30000 }])
})

for (const level of ['off', 'light', 'full'] as const) test('A1 A6 ' + level + ' event set has only its voice model section', { timeoutMs: 120000, plugins: [CLOSER] }, async ($, on) => {
  const declared = [...new Set(Object.values(PLUGIN_SOURCES).flatMap(source => [...source.matchAll(/\bon\(['"]([^'"]+)['"]/g)].map(match => match[1])))].sort()
  expect(declared).toEqual([...new Set([...DRIVEN_HOOKS, ...M1_DRIVEN_HOOKS])].sort())
  const f = runtimeWorld(on, { voice: level, companion: true })
  await drivePromiseEvents($, f)
  console.log('P1_M1_UNDISPATCHED ' + JSON.stringify(f.unsupportedM1))
  assertAppendScope(f)
  expect(f.models).toEqual([])
  expect(f.modelChannels).toEqual([])
  for (const surfaces of [[], ['terminal'], ['desktop'], ['vscode'], ['mobile']] as const) {
    const composed = await $.prompt.compose({ ...ASK, surfaces: [...surfaces] })
    expect(composed.sections).toEqual([{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }, ...(level === 'off' || !surfaces.length ? [] : [{ id: 'coco:voice', text: VOICE[level], scope: 'session' }])])
  }
  expect((await $.prompt.compose({ ...ASK, surfaces: ['terminal'], traits: ['bare'] })).sections).toEqual([{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }])
})

test('B1 B2 B4 B8 event set keeps network empty and private payloads in bounded excerpt files only', { timeoutMs: 120000, plugins: [CLOSER] }, async ($, on) => {
  const f = runtimeWorld(on, { companion: true })
  await drivePromiseEvents($, f)
  assertAppendScope(f)
  expect(f.network).toEqual([])
  expect(f.stores.length > 0).toBe(true)
  expect(f.fs.length > 0).toBe(true)
  expect(f.writes.some(write => posixPath(write.path) === PROMISE_FOLDER + '/view.json')).toBe(true)
  for (const entry of f.stores) expect(containsPrivate(entry.value), 'store ' + entry.key).toEqual([])
  for (const write of f.writes) {
    if (posixPath(write.path) !== PROMISE_FOLDER + '/view.json') { expect(containsPrivate(write.text), write.path).toEqual([]); continue }
    const record = JSON.parse(write.text)
    for (const name of ['reply', 'notice']) if (record[name]) expect([...record[name].text].length <= 140, name + ' excerpt bound').toBe(true)
    const { reply, notice, ...metadata } = record
    expect(containsPrivate(metadata), 'companion metadata').toEqual([])
    expect(containsPrivate(reply).filter(marker => marker !== PRIVATE.reply)).toEqual([])
    expect(containsPrivate(notice).filter(marker => marker !== PRIVATE.notice)).toEqual([])
  }
  const probes: Record<string, string> = {
    '/System/Library/CoreServices/SystemVersion.plist': 'platform existence probe',
    '/proc/sys/kernel/ostype': 'Linux platform existence probe for the own companion branch helper; no file read',
    '/bin/sh': 'local shell existence probe', '/usr/bin/python3': 'legacy asset worker availability probe',
    '/usr/bin/tail': 'local follower availability probe',
    '/tmp/p1-runtime-home/Applications/Coco Pet.app': 'own companion installation existence probe',
    '/tmp/p1-runtime-home/Library/LaunchAgents/io.github.ninondev.coco-companion.plist': 'own companion launch-agent existence probe',
    '/tmp/p1-runtime-home/Pictures': 'share card destination existence probe; no save without press',
    '/tmp/.git': 'caller project ancestor repository existence probe; no file read',
  }
  for (const call of f.fs) {
    const own = within(call.path, call.root) || within(call.path, PROMISE_FOLDER) || within(call.path, '/tmp/p1-runtime-home/Applications/Coco Pet.app')
    const projectMetadata = call.name === 'exists' && posixPath(call.path) === PROMISE_PROJECT + '/.git'
    const probe = call.name === 'exists' && !!probes[posixPath(call.path)]
    expect(own || probe || projectMetadata, call.name + ' outside owned folders: ' + call.path + '; plugin root: ' + call.root).toBe(true)
  }
  const ended = JSON.parse(f.writes.filter(write => posixPath(write.path) === PROMISE_FOLDER + '/view.json').at(-1)!.text)
  expect(ended).toMatchObject({ ended: true, reply: null, notice: null, channel: false })
  console.log('P1_RUNTIME_CHANNELS ' + JSON.stringify({ networkCalls: f.network.length, modelCalls: f.models.length, storeWrites: f.stores.length, filesystemCalls: f.fs.length, recordedWrites: f.writes.length }))
})

test('B5 session-end serialization clears excerpt state as well as its record', () => {
  const view = initialView()
  companionActivity({ reply: { text: PRIVATE.reply, at: 1 }, notice: { text: PRIVATE.notice, kind: 'idle_prompt', at: 1 }, channel: true })
  expect(companionText(companionKey(view), 'p1-excerpt', true, 1)).toContain(PRIVATE.reply)
  expect(JSON.parse(companionEnded('p1-excerpt', 2))).toMatchObject({ ended: true, reply: null, notice: null, channel: false })
  expect(containsPrivate(companionText(companionKey(view), 'p1-excerpt', true, 3))).toEqual([])
})

test('B7 every tool type preserves host allow ask deny and PermissionRequest results', { timeoutMs: 120000 }, async ($, on) => {
  let decision: 'allow' | 'ask' | 'deny' = 'allow'
  let host: Record<string, unknown> = { decision: { behavior: 'deny', message: PRIVATE.input } }
  const f = runtimeWorld(on, { toolCheck: () => ({ decision, reason: 'p1-host-' + decision }), permissionResult: () => host })
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'terminal', isInteractive: true }); await settleLegacyStart($, f.w)
  await $.turn.start({ text: '', turnId: 'p1-permission' })
  const inputs = [...TOOL_CASES, ...RUNTIME_PROMISE_INPUT.builtinTools.filter(tool => !TOOL_CASES.some(input => input.tool === tool)).map(tool => ({ tool, p1Private: PRIVATE.input }))]
  for (const input of inputs) {
    const result = await $.tool.call({ ...input, tool_use_id: 'p1-' + input.tool } as never)
    expect(result, input.tool + ' host tool result').toEqual(input.tool === 'Read' ? { result: PRIVATE.file, text: PRIVATE.file } : { result: { ok: true } })
    for (const answer of ['allow', 'ask', 'deny'] as const) {
    decision = answer
    host = answer === 'deny' ? { decision: { behavior: 'deny', message: PRIVATE.input } } : { decision: { behavior: 'allow', updatedInput: { p1Private: PRIVATE.input } } }
    expect(await $.tool.check({ tool: input.tool, input, tool_use_id: 'p1-' + input.tool } as never)).toEqual({ decision: answer, reason: 'p1-host-' + answer })
    expect(await $.classic.PermissionRequest({ tool_name: input.tool, tool_input: input, permission_suggestions: [] } as never)).toEqual(host)
    }
  }
  console.log('P1_PERMISSION_TOOLS ' + inputs.length)
  console.log('P1_PERMISSION_TOOL_RESULTS ' + inputs.length)
})

test('C2 terminal resting minute stays within its pinned render and blink budget', { timeoutMs: 120000 }, async ($, on) => {
  let counting = false, renders = 0, invalidates = 0
  const w = world(on, { store: RECENT, onRender: component => { if (counting && component === 'AbovePrompt') renders++ } })
  on('fs.exists', () => ({ value: false }))
  on('ui.invalidate', ($, e, next) => { if (counting) invalidates++; return next(e) })
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'terminal', isInteractive: true }); await settleLegacyStart($, w)
  await $.ui.mount({ surface: 'terminal', ...band(100) })
  await w.clock.advance(15000)
  const blits = w.blits.length
  counting = true; await w.clock.advance(60000); counting = false
  const measured = { renders, invalidates, blits: w.blits.length - blits }
  console.log('P1_TERMINAL_IDLE ' + JSON.stringify(measured))
  expect(renders <= 0).toBe(true)
  expect(invalidates <= 0).toBe(true)
  expect(measured.blits <= 26).toBe(true)
  expect(measured.blits > 0).toBe(true)
})

test('C7 terminal first answer contains a picture before deferred startup', async ($, on) => {
  const w = world(on, { store: RECENT })
  on('fs.exists', () => ({ value: false }))
  const ui = await $.ui.mount({ surface: 'terminal', ...band(100) })
  expect((await ui.find({ type: 'Raster' })) ?? (await ui.find({ type: 'Image' }))).toBeDefined()
  expect(w.blits).toEqual([])
})

// VS Code and the phone draw the desktop's painted band (owner 10-19, DECISIONS 1044, 1045): before it shows, the
// first-answer head carries her picture; once it has shown there, that surface's heads stay quiet, as on the desktop.
test('C7 remote surfaces draw the painted band and their first-answer head goes quiet once it shows', async ($, on) => {
  const w = world(on, { store: RECENT, engineRows: true, stepText: 'Done.' })
  on('fs.exists', () => ({ value: false }))
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'vscode', isInteractive: true }); await settleLegacyStart($, w)
  for (const surface of ['vscode', 'mobile'] as const) {
    await $.turn.start({ text: 'go', turnId: 'p1-first-head-' + surface })
    for await (const _ of $.turn.step({ turnId: 'p1-first-head-' + surface, index: 0, model: 'test', messageCount: 1 })) {}
    const before = await $.ui.mount({ surface, plugin: 'coco', component: 'AssistantMessage', props: { text: 'Done.', isFirstOfReply: true } })
    expect(await before.find({ type: 'Svg' })).toBeDefined()
    const bandUi = await $.ui.mount({ surface, ...band(100) })
    expect(await bandUi.find({ key: 'coco:picture' })).toBeDefined()
    const head = await $.ui.mount({ surface, plugin: 'coco', component: 'AssistantMessage', props: { text: 'Done.', isFirstOfReply: true } })
    expect(allNodes(await head.drawn()).filter(n => n.type === 'Svg' && n.props?.width === 35)).toEqual([])
  }
})

function allNodes(tree: any): any[] { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(allNodes) : [tree, ...(tree.children ?? []).flatMap(allNodes)] }
function adjacentWords(tree: any, picture: any): string {
  const words = (node: any): string => allNodes(node).filter(n => n.type === 'Text').flatMap(n => n.children ?? []).filter((v: unknown) => typeof v === 'string').join(' ')
  const route = (node: any): any[] | undefined => {
    if (node === picture) return [node]
    for (const child of Array.isArray(node) ? node : node?.children ?? []) {
      if (!child || typeof child !== 'object') continue
      const path = route(child); if (path) return [node, ...path]
    }
  }
  return (route(tree) ?? []).reverse().map(words).find(Boolean) ?? ''
}
function removeWrittenRows(tree: any): any {
  if (Array.isArray(tree)) return tree.map(removeWrittenRows)
  if (!tree || typeof tree !== 'object' || tree.type === 'Svg' || tree.type === 'Image') return tree
  return { ...tree, children: tree.type === 'Text' ? [] : (tree.children ?? []).map(removeWrittenRows) }
}
// a group's badge beside its written name (step 2): the switches page's, then her page's, the quota page's, vibe
// check's and the drawer's, drawn once lane B's group names for them are merged
const GROUP_BADGES = [['#3A86C8'], ['#D97757'], ['#D97757', 'level'], ['#B9B2AC'], ['#B9B2AC', 'note'], ['#3A86C8', 'level'], ['#D97757', 'squash'],
  ['#D97757', 'x'], ['#3A86C8', 'squash'], ['#D97757', 'sock']].map(([face, mark]) => bagBadgeSvg({ on: true, face: face!, ...(mark ? { mark: mark as 'level' | 'note' | 'squash' | 'x' | 'sock' } : {}) }))
function decorative(node: any, component: string): boolean {
  if (node.type !== 'Svg' || node.props?.alt !== '') return false
  const { width, height, source } = node.props
  // Decorative faces duplicate the immediately adjacent written identity or question,
  // and ribbons duplicate the repeat note. The spark is not decorative: it carries its words.
  if (['AssistantMessage', 'AskUserQuestion'].includes(component) && width === 35 && height === 32) return true
  if (component === 'UserMessage' && [[10, 17], [8, 14]].some(pair => pair[0] === width && pair[1] === height)) return true
  if (component === 'CommandOutput' && width === 20 && height === 18) return true
  // SPEC0.3:650-661 and 572-574 pair this exact scroll with the written helper row.
  if (['Pane', 'ToolUse'].includes(component) && width === 9 && height === 18 && source === scrollSvg().replace('viewBox="0 0 12 18"', 'viewBox="0 0 9 18"').replace('width="12"', 'width="9"')) return true
  // SPEC0.3:370-374 pairs the shed icon with its written compact direction.
  if (component === 'CommandOutput' && width === 26 && height === 15 && source === shedRowSvg()) return true
  // BOOK: the grey hairline under a group title repeats the written title just above it.
  if (component === 'Pane' && height === 7 && /viewBox="0 0 \d+ 7"[^>]*><style>path\{stroke:#8C877E\}/.test(String(source))) return true
  // BOOK (her itabag, step 2): a group's small badge sits beside its written name.
  if (component === 'Pane' && width === 18 && height === 18 && GROUP_BADGES.includes(String(source))) return true
  // SPEC0.3:272-273 reserves this exact empty decorative slot.
  // InfoNotice below deliberately routes the same shipping desktopBand constructor.
  if (['AbovePrompt', 'InfoNotice'].includes(component) && width === 12 && height === 1 && source === EMPTY_12x1) return true
  return ['AbovePrompt', 'InfoNotice'].includes(component) && width === 1 && height === 16 && source === HAIRLINE
}

test('D3 D4 every rendered event-set Svg and Image has words or an explicit decorative occurrence', { timeoutMs: 120000, plugins: [CLOSER] }, async ($, on) => {
  // The test's canonical render functions have a separate module instance from shipping hooks.
  await loadD1Words(() => Promise.resolve(D1_WORDS_TEXT))
  for (const kind of ['helpers', 'shed'] as const) await loadD1Art(kind, path => Promise.resolve(D1_ART_FILES[path]!))
  let pictures = 0, mainPictures = 0
  // Reduced-motion frames in the event set already preserve their colours. Exercise the
  // same shipping constructor with her bundled resting still too.
  installCocoData(COCO_RESTING.A as unknown as CocoData, true)
  const raw = cocoStill('A', 'idle', 32)
  expect(raw.length).toBeGreaterThan(0)
  on('ui.render', { component: 'InfoNotice' }, ($, e) => e.surface === 'desktop'
    ? desktopBand($.ui.resolve(e), { ...initialView(), band: 'compact' }, { columns: 100, maxRows: 30, screenRows: 48, isWorking: false }, raw) : null)
  const f = runtimeWorld(on, { pictures: true })
  f.inspect.tree = (tree, surface, component) => {
    const nodes = allNodes(tree)
    for (const node of nodes) if (node.type === 'Svg' || node.type === 'Image') {
      pictures++
      expect(typeof node.props?.alt === 'string' && (node.props.alt.trim().length > 0 || decorative(node, component)), surface + ' ' + component + ' ' + node.type + ' accessible words').toBe(true)
      if (node.type === 'Svg' && node.props?.alt === '' && component === 'Pane' && node.props.width === 9 && node.props.height === 18) {
        expect(adjacentWords(tree, node)).toContain('fixture helper')
        expect(adjacentWords(tree, node)).toContain(d1Word('en', 'helpers.working'))
        expect(adjacentWords(removeWrittenRows(tree), node)).toBe('')
      }
      if (node.type === 'Svg' && node.props?.alt === '' && component === 'CommandOutput' && node.props.width === 26 && node.props.height === 15) {
        expect(adjacentWords(tree, node)).toContain(d1Word('en', 'marks.shed').replace(/\*/g, ''))
        expect(adjacentWords(removeWrittenRows(tree), node)).toBe('')
      }
    }
  }
  f.inspect.mainPicture = picture => {
    const props = (picture as any)?.props
    expect(typeof props?.source === 'string', 'main desktop band picture source').toBe(true)
    expect(String(props?.alt).startsWith(WORDS.en.name), 'main band picture identity').toBe(true)
    const root = /<svg\b[^>]*>/.exec(props.source)?.[0] ?? ''
    expect(/\bstyle=["'][^"']*forced-color-adjust\s*:\s*none\b[^"']*["']/.test(root), 'main band picture keeps its colours in forced-colour media').toBe(true)
    mainPictures++
  }
  await drivePromiseEvents($, f)
  assertAppendScope(f)
  const rawBand = await $.ui.mount({ surface: 'desktop', plugin: 'coco', component: 'InfoNotice', props: { text: WORDS.en.name, command: null } })
  f.inspect.tree(await rawBand.drawn(), 'desktop', 'InfoNotice')
  f.inspect.mainPicture(await desktopPicture(rawBand))
  await rawBand.unmount()
  expect(pictures > 0).toBe(true)
  expect(mainPictures).toBe(2) // 3 with the desktop's pixel band, gone since 10-19 (owner)
  console.log('P1_ALT_PICTURES ' + pictures)
  console.log('P1_MAIN_BAND_PICTURES ' + mainPictures)
})

const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'
test('D9 shipped coco command verbs each have an existing button path', { timeoutMs: 120000 }, async ($, on) => {
  const f = runtimeWorld(on, { companion: true })
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'desktop', isInteractive: true }); await settleLegacyStart($, f.w)
  const table: Record<string, [string, string]> = {
    about: ['him', 'coco:book:tab:him'], him: ['him', 'coco:book:tab:him'], book: ['him', 'coco:book:tab:him'],
    // One command (owner 10-16): /omen and the shrine words are gone as inputs; vibe and usage open pages 3 and 2.
    vibe: ['vibe', 'coco:book:tab:omen'], usage: ['usage', 'coco:book:tab:offerings'],
    log: ['log', 'coco:book:tab:log'], library: ['library', 'coco:book:tab:library'], settings: ['settings', 'coco:book:tab:settings'],
    socks: ['socks', 'coco:book:tab:socks'], // her sock drawer, the itabag's fourth page (lane C, 10-14)
    voice: ['settings', 'coco:set:voice:off'], warmth: ['settings', 'coco:set:affection:warm'], affection: ['settings', 'coco:set:affection:warm'],
    icon: ['settings', 'coco:icon:choose'],
    visitors: ['him', 'coco:visitors:open'],
    focus: ['him', 'coco:stick:light'],
    band: ['settings', 'coco:set:band:on'], lang: ['settings', 'coco:set:lang:auto'], marks: ['settings', 'coco:set:marks:off'], companiontarget: [COMPANION_PAGE, 'coco:set:companionTarget:auto'],
    // M1: the More page, the companion verb, and Talk's two verbs. The More rows stand in the switches page's groups (her
    // itabag, step 2), so its path is one of their switches.
    // her desktop companion stands on her page once lane B has named its group there (step 2), else on the switches page
    more: ['settings', 'coco:more:lively:on'], companion: [COMPANION_PAGE, 'coco:companion:install'],
    talk: ['him', 'coco:talk:open'], say: ['him', 'coco:talk:send'],
    // the DM thread is Talk's (dm.ts, lane C 10-17): /coco dm opens it, and the same button opens it from her page
    dm: ['him', 'coco:talk:open'],
  }
  const commandSources = PLUGIN_SOURCES['hooks/register.tsx'] + '\n' + PLUGIN_SOURCES['hooks/pages.tsx']
  const aliases = /const ALIASES[^=]*=\s*\{([^}]+)\}/.exec(PLUGIN_SOURCES['hooks/pages.tsx'] ?? '')?.[1] ?? ''
  const shipped = [...new Set([...commandSources.matchAll(/verb\s*===\s*'([^']+)'/g)].map(m => m[1]!).filter(Boolean).concat([...aliases.matchAll(/(\w+):/g)].map(m => m[1]!)))].sort()
  expect(shipped).toEqual(Object.keys(table).sort())
  // Pin the shipping surface policy rather than require unavailable features.
  const bookSource = PLUGIN_SOURCES['hooks/book.tsx'] ?? ''
  // The Visitors button shows once a first visit is in the guest book and its word `visitors.open` is shipped; that word is not delivered yet.
  const VISITORS_BUTTON_WAITS = 'the Visitors button needs a first visit and the word visitors.open, which the words agent has not delivered'
  expect(bookSource).toContain("const remote = surface === 'vscode' || surface === 'mobile'")
  // the desktop band is always the painted one (owner 10-19), so only the terminal offers band shapes
  expect(bookSource).toContain("band: remote || surface === 'desktop' ? [] : [choice(s.band.label")
  // M1 (MOD-GAPS): the terminal offers Marks too, as Replies or Off.
  expect(bookSource).toContain("choice(s.marks.label, 'marks', surface === 'terminal' && marks === 'on' ? 'replies' : marks")
  expect(bookSource).toContain("companion: surface !== 'mobile' && d.companion && !bagWords(lang)?.himGroups ?")
  expect(bookSource).toContain("const companion: Block[] = surface !== 'mobile' && d.companion ?")
  const absent: Record<typeof SURFACES[number], Record<string, string>> = {
    terminal: { talk: 'Talk is off by default; its tab and Send appear once it is on', say: 'Talk is off by default; its tab and Send appear once it is on', dm: 'Talk is off by default; the DM thread opens once it is on', visitors: VISITORS_BUTTON_WAITS },
    desktop: { band: 'book.tsx draws no band choices on the desktop: its band is always the painted one (owner 10-19)', talk: 'Talk is off by default; its tab and Send appear once it is on', say: 'Talk is off by default; its tab and Send appear once it is on', dm: 'Talk is off by default; the DM thread opens once it is on', visitors: VISITORS_BUTTON_WAITS },
    vscode: { band: 'book.tsx excludes AbovePrompt band choices on remote surfaces', icon: 'book.tsx excludes native app icon section on VS Code', talk: 'Talk is off by default; its tab and Send appear once it is on', say: 'Talk is off by default; its tab and Send appear once it is on', dm: 'Talk is off by default; the DM thread opens once it is on', visitors: VISITORS_BUTTON_WAITS },
    mobile: { band: 'book.tsx excludes AbovePrompt band choices on remote surfaces', companiontarget: 'book.tsx excludes native companion section on mobile', companion: 'book.tsx excludes native companion section on mobile', icon: 'book.tsx excludes native app icon section on mobile', talk: 'Talk is off by default; its tab and Send appear once it is on', say: 'Talk is off by default; its tab and Send appear once it is on', dm: 'Talk is off by default; the DM thread opens once it is on', visitors: VISITORS_BUTTON_WAITS },
  }
  let paths = 0, omitted = 0
  for (const surface of SURFACES) for (const [verb, [page, key]] of Object.entries(table)) {
    await $.command.run({ command: 'coco', args: page, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE })
    // Remote language choices use the shipping unfold button first.
    if (verb === 'lang' && (surface === 'vscode' || surface === 'mobile')) {
      expect(await ui.find({ key: 'coco:set:lang:open' }), surface + ' language unfold path').toBeDefined()
      await ui.press({ key: 'coco:set:lang:open' }); await ui.redraw()
    }
    const reason = absent[surface][verb]
    if (reason) {
      expect(await ui.find({ key }), surface + ' ' + verb + ' intentionally absent: ' + reason).toBeUndefined()
      omitted++
      console.log('P1_COMMAND_BUTTON_ABSENT ' + JSON.stringify({ surface, verb, key, reason }))
    } else {
      expect(await ui.find({ key }), surface + ' ' + verb + ' button path').toBeDefined()
      paths++
    }
    await ui.unmount()
  }
  expect(paths).toBe(73) // 74 before the desktop band row went (owner 10-19); 78 with the sock drawer's tab (lane C, 10-14); vibe and usage stand for omen, offerings and usage, one verb fewer on the four surfaces (10-16)
  expect(omitted).toBe(23) // 22 before the desktop band row went (owner 10-19); 18, and /coco dm on the four surfaces while Talk is off (lane C, 10-17)
  console.log('P1_COMMAND_BUTTON_PATHS ' + paths)
  console.log('P1_COMMAND_BUTTON_ABSENT_COUNT ' + omitted)
})

test('G12 settled Settings check-up performs no timed probes', { timeoutMs: 120000 }, async ($, on) => {
  const f = runtimeWorld(on)
  await $.session.start({ cwd: PROMISE_PROJECT, surface: 'terminal', isInteractive: true }); await settleLegacyStart($, f.w)
  const relevant = () => f.fs.filter(call => /[\\/](?:companion|health|snapshot)\.json$/.test(call.path)).length
  for (const surface of SURFACES) {
    await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...PANE })
    await settleLegacyStart($, f.w)
    const before = relevant()
    await f.w.clock.advance(300000); await settleLegacyStart($, f.w)
    expect(relevant(), surface + ' settled Settings probes').toBe(before)
    await ui.unmount()
  }
  // Talk's engine adapter hands the engine clock through (its waits are Talk's, lane C 10-10); any other timer in
  // pages.tsx is refused
  const pages = (PLUGIN_SOURCES['hooks/pages.tsx'] ?? '').replace('after:(ms:number,callback:()=>unknown)=>$.clock.after(ms,callback)', '')
  expect(/(?:clock\.after|setInterval|setTimeout)\s*\(/.test(pages)).toBe(false)
  console.log('P1_SETTINGS_IDLE_SURFACES ' + SURFACES.length)
})
