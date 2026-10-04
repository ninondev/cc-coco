import { samePath, pathPattern, slashPath } from './file-paths'
import { PLUGIN_VERSION } from '../hooks/book-text'
// His companion controls, mounted on both surfaces; program/permission/clock behavior also
// checked with a small injected engine so no test can touch a real Mac or its HOME.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import { CompanionBook, COMPANION_APP, COMPANION_PLIST, COMPANION_OPEN, companionCommand, companionState } from '../hooks/companion-book'
import { companionChanged, companionData, pressCompanion } from '../hooks/pages'
import type { CompanionSnapshot, CompanionState } from '../hooks/companion-book'
import { companionSizeSvg, companionStageSvg } from '../hooks/companion-art'
import { companionRecord } from '../hooks/companion'
import { BOOK_FILES } from './book-files'
import { MORNING, P, PERSON, RECENT, stubPng, world } from './world'
import { atomicFeed, PROCESS_OK } from './shared-world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const HOME = '/tmp/x', FOLDER = `${HOME}/Library/Application Support/Claude-sama`, FEED = `${FOLDER}/view.json`
const INFO = `${FOLDER}/companion.json`, APP = `${HOME}/${COMPANION_APP}`, PLIST = `${HOME}/${COMPANION_PLIST}`
const PANE = { plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const normal: CompanionSnapshot = { folder: true, app: true, login: false, info: { running: true, accessibility: true, size: 'medium', version: PLUGIN_VERSION }, version: PLUGIN_VERSION }

function fixture(on: On, options: { mac?: boolean; folder?: boolean; app?: boolean; info?: Record<string, unknown>; missingRecord?: boolean; login?: boolean; report?: string; processThrows?: boolean; hold?: () => Promise<void> } = {}) {
  const state = { folder: options.folder ?? true, app: options.app ?? true, login: options.login ?? false, info: options.info ?? { running: true, accessibility: true, size: 'medium', version: PLUGIN_VERSION }, report: options.report ?? 'ok' }
  const records: Record<string, unknown>[] = [], commands: string[][] = [], reads: string[] = []
  let requestFileExists = false
  on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') ? options.mac !== false : samePath(e.path, '/usr/bin/tail') ? true : samePath(e.path, FOLDER) ? state.folder : samePath(e.path, APP) ? state.app : samePath(e.path, PLIST) ? state.login : samePath(e.path, `${FOLDER}/requests.jsonl`) ? requestFileExists : false }))
  on('fs.read', { path: pathPattern(INFO) }, ($, e) => { reads.push(e.path); return options.missingRecord ? { deny: 'no companion record yet' } : { value: JSON.stringify(state.info) } })
  on('fs.read', { path: /[\\/]\.claude-plugin[\\/]plugin\.json$/ }, () => ({ value: '{"version":"1"}' }))
  on('fs.write', ($, e) => {
    if (samePath(e.path, `${FOLDER}/requests.jsonl`)) {
      expect(requestFileExists).toBe(false); expect(e.text).toBe(''); requestFileExists = true
      return { value: undefined }
    }
    expect(samePath(e.path, FEED)).toBe(true); records.push(JSON.parse(e.text)); return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('process.run', async ($, e) => {
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) { expect(samePath(feed.path, FEED)).toBe(true); records.push(JSON.parse(feed.text)); return { value: PROCESS_OK } }
    if (e.argv[0] === '/usr/bin/touch') { requestFileExists = true; return { value: PROCESS_OK } }
    if (slashPath(e.argv[1] ?? '').includes('/bin/icon-')) return { value: { ...PROCESS_OK, stdout: 'icon: stock\n' } }
    commands.push([...e.argv]); await options.hold?.(); if (options.processThrows) throw new Error('direct process unavailable')
    return { value: { ...PROCESS_OK, exitCode: state.report === 'ok' ? 0 : 1, stdout: `build message\nresult: ${state.report}\n` } }
  })
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME } })
  return { w, state, records, commands, reads }
}
async function settings($: Parameters<Parameters<typeof test>[1]>[0], surface: 'desktop' | 'terminal') {
  await $.session.start(START)
  await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
  return $.ui.mount({ surface, ...PANE })
}

// No host event is used by this harness; only its explicit maps, arrays and callback queue.
function fakeEngine() {
  let now = MORNING, active = true, redraws = 0
  const state = { folder: true, app: true, login: false, info: { running: true, accessibility: false, size: 'medium', version: PLUGIN_VERSION, answered: 0, sizeAt: 0, loginAt: 0 } as Record<string, unknown> }
  let processBehavior: 'ok' | 'throw' | 'nonzero' = 'ok', toolBehavior: 'ok' | 'throw' | 'deny' = 'ok', stdout = 'result: ok\n'
  const commands: { argv: readonly string[]; options: unknown }[] = [], tools: Record<string, unknown>[] = [], records: Record<string, unknown>[] = [], reads: string[] = []
  const timers: { due: number; callback: () => void | Promise<void>; cancelled: boolean }[] = []
  let beforeWrite: (() => void) | undefined
  const engine = {
    plugin: { root: "/tmp/plugin's files" }, env: { get: async () => HOME },
    fs: {
      exists: async (path: string) => /[\\/]diagnostics$/.test(path) ? false : path === FOLDER ? state.folder : path === APP ? state.app : path === PLIST ? state.login : true,
      read: async (path: string, options?: { as: string }) => { reads.push(path); if (path === INFO) return JSON.stringify(state.info); if (path.endsWith('plugin.json')) return '{"version":"1"}'; if (options?.as === 'bytes') return { base64: stubPng(path) }; return '' },
      write: async (_path: string, text: string) => { records.push(JSON.parse(text)) },
    },
    session: { id: async () => { beforeWrite?.(); return 's1' }, surfaces: async () => ['desktop'] },
    clock: { now: async () => now, after: (ms: number, callback: () => void | Promise<void>) => { const t = { due: now + ms, callback, cancelled: false }; timers.push(t); return { cancel: () => { t.cancelled = true } } } },
    process: { run: async (argv: readonly string[], options: unknown) => {
      const feed = atomicFeed(argv, (options as { stdin?: string })?.stdin)
      if (feed) { records.push(JSON.parse(feed.text)); return PROCESS_OK }
      if (argv[0] === '/usr/bin/touch') return PROCESS_OK
      commands.push({ argv, options }); if (processBehavior === 'throw') throw new Error('unavailable')
      return { exitCode: processBehavior === 'nonzero' ? 1 : 0, stdout, stderr: '' }
    } },
    tool: { call: async (input: Record<string, unknown>) => { tools.push(input); if (toolBehavior === 'throw') throw new Error('unavailable'); if (toolBehavior === 'deny') return { deny: 'person declined' }; return { result: { stdout, stderr: '', interrupted: false }, text: 'mapped output' } } },
  } as unknown as EngineInterface
  return {
    engine, state, commands, tools, records, reads, timers,
    redraw: () => { redraws += 1 }, active: () => active,
    async advance(ms: number) { const end = now + ms; while (true) { const t = timers.filter(t => !t.cancelled && t.due <= end).sort((a, b) => a.due - b.due)[0]; if (!t) break; t.cancelled = true; now = t.due; await t.callback() } now = end },
    get now() { return now }, get redraws() { return redraws }, setActive(value: boolean) { active = value },
    set process(value: typeof processBehavior) { processBehavior = value }, set tool(value: typeof toolBehavior) { toolBehavior = value }, set stdout(value: string) { stdout = value },
    set beforeWrite(value: typeof beforeWrite) { beforeWrite = value },
  }
}

describe('the companion section on both book surfaces', () => {
  const visible: [CompanionState, Record<string, unknown>, string][] = [
    ['stopped', {}, 'Not running'], ['hidden', { running: true, hiddenUntil: MORNING / 1000 + 60 }, 'Hidden until 9:01 AM'],
    ['corner', { running: true, accessibility: false }, "Can't follow your window yet"], ['following', { running: true, accessibility: true }, 'Beside your window'],
  ]
  for (const surface of ['desktop', 'terminal'] as const) {
    for (const [state, info, status] of visible) test(`${surface}: ${state}`, async ($, on) => {
      fixture(on, { info: { ...info, version: PLUGIN_VERSION } }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: status })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('claudesama:companion:')).every(b => !b.props.hotkey)).toBe(true)
      if (surface === 'terminal') expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    })
    test(`${surface}: a fresh draw assumes the direct process path without a permission note`, async ($, on) => {
      const f = fixture(on, { app: false }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Button', text: 'Install the companion' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeUndefined()
      expect(f.commands).toEqual([])
    })
    test(`${surface}: a thrown direct process uses Bash and then shows the permission note`, async ($, on) => {
      const tools: string[] = []
      on('tool.call', { tool: 'Bash' }, ($, e) => {
        tools.push(e.command)
        return { result: { stdout: 'Apple tools are needed\nresult: no-tools\n', stderr: '', interrupted: false }, text: 'Apple tools are needed' }
      })
      const f = fixture(on, { app: false, processThrows: true }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeUndefined()
      await ui.press({ key: 'claudesama:companion:install' }); await f.w.clock.advance(0); await ui.redraw()
      expect(f.commands.length).toBe(1)
      expect(tools).toEqual([companionCommand(f.commands[0]!)])
      expect(await ui.find({ type: 'Text', text: "Needs Apple's Command Line Tools" })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeDefined()
      // The failure belongs to this load, so another draw retains the note.
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeDefined()
    })
    test(`${surface}: missing app shows install; off macOS shows no section`, async ($, on) => {
      fixture(on, { app: false }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Button', text: 'Install the companion' })).toBeDefined()
    })
    test(`${surface}: not macOS`, async ($, on) => {
      fixture(on, { mac: false }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: 'Desktop companion' })).toBeUndefined()
    })
    test(`${surface}: malformed finite timestamps cannot break the Settings drawing`, async ($, on) => {
      fixture(on, { info: { running: true, accessibility: false, hiddenUntil: 1e300, answered: 'wrong', size: 'enormous', version: PLUGIN_VERSION } }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: "Can't follow your window yet" })).toBeDefined()
    })
    const unknownVersions: readonly [string, Record<string, unknown>, boolean][] = [
      ['missing version field', { running: true, accessibility: true }, false],
      ['empty record', {}, false],
      ['missing record', {}, true],
    ]
    for (const [name, info, missingRecord] of unknownVersions) test(`${surface}: ${name} does not claim an update is available`, async ($, on) => {
      fixture(on, { info, missingRecord }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: 'Desktop companion' })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: 'Remove from this Mac…' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: 'Update him' })).toBeUndefined()
    })
    test(`${surface}: the same recorded version has no update row`, async ($, on) => {
      fixture(on, { info: { running: true, accessibility: true, version: PLUGIN_VERSION } }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Text', text: 'Beside your window' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: 'Update him' })).toBeUndefined()
    })
    test(`${surface}: update, size and login use the record and plist`, async ($, on) => {
      fixture(on, { login: true, info: { running: true, accessibility: true, size: 'small', version: '0' } }); const ui = await settings($, surface)
      expect(await ui.find({ type: 'Button', text: 'Update him' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeDefined()
      const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
      expect(text).toContain('Update ready'); expect(text).toContain('His size'); expect(text).toContain('Start at login')
      expect(text).not.toContain('A newer companion came with this plugin.')
      expect(text).toContain('Now: Small'); expect(text).toContain('Now: On')
      expect(text).not.toContain('Shown here at half size.')
      const sizeFigures = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).startsWith('Small:'))
      expect(sizeFigures.map(svg => svg.props.alt)).toEqual(surface === 'desktop' ? ['Small: pixel head'] : [])
    })
    for (const [report, status, nextButton] of [
      ['no-tools', "Needs Apple's Command Line Tools", 'Get the Command Line Tools'],
      ['old-tools', 'Needs newer Command Line Tools', 'Open Software Update'],
      ['failed', "The build didn't finish", 'Try again'],
    ]) test(`${surface}: install result ${report} is drawn`, async ($, on) => {
      const f = fixture(on, { app: false, report }); const ui = await settings($, surface)
      await ui.press({ key: 'claudesama:companion:install' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: status })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: nextButton })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeUndefined()
    })
    for (const action of ['install', 'trash'] as const) test(`${surface}: ${action === 'install' ? 'building' : 'removing'} replaces its buttons while busy`, async ($, on) => {
      let release: (() => void) | undefined, began: (() => void) | undefined
      const waiting = new Promise<void>(resolve => { release = resolve })
      const started = new Promise<void>(resolve => { began = resolve })
      const f = fixture(on, { hold: () => { began?.(); return waiting }, ...(action === 'install' ? { info: { running: true, accessibility: true, size: 'medium', version: 'old' } } : {}) }); const ui = await settings($, surface)
      if (action === 'trash') { await ui.press({ key: 'claudesama:companion:remove' }); await f.w.clock.advance(0); await ui.redraw() }
      // Install is supplied by the update row while he is present.
      const pressed = ui.press({ key: `claudesama:companion:${action === 'install' ? 'updateButton' : 'trash'}` })
      await started; await ui.redraw()
      expect(await ui.find({ type: 'Text', text: action === 'install' ? 'Building him…' : 'Moving him to the Trash…' })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('claudesama:companion:'))).toEqual([])
      release?.(); await pressed
    })
    test(`${surface}: follow shows waiting, and remove offers Keep before trash`, async ($, on) => {
      const f = fixture(on, { info: { running: true, accessibility: false, version: PLUGIN_VERSION } }); const ui = await settings($, surface)
      await ui.press({ key: 'claudesama:companion:follow' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'Waiting for your OK' })).toBeDefined()
      expect(f.records.some(r => typeof r.follow === 'number')).toBe(true)
      await ui.press({ key: 'claudesama:companion:remove' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Button', text: 'Move to Trash' })).toBeDefined()
      await ui.press({ key: 'claudesama:companion:keep' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Button', text: 'Move to Trash' })).toBeUndefined()
      expect(f.commands).toEqual([])
    })
  }

  test('state precedence includes every state and defensively handles missing fields', () => {
    expect(companionState(normal, MORNING, { busy: 'install', issue: 'failed' })).toBe('building')
    expect(companionState(normal, MORNING, { busy: 'trash', issue: 'failed' })).toBe('removing')
    for (const issue of ['tools', 'oldTools', 'failed'] as const) expect(companionState({ ...normal, app: false }, MORNING, { issue })).toBe(issue)
    expect(companionState({ ...normal, folder: false }, MORNING, {})).toBe('absent')
    expect(companionState({ ...normal, info: {} }, MORNING, {})).toBe('stopped')
    expect(companionState(normal, MORNING, { unanswered: true })).toBe('stopped')
    const corner = { ...normal, info: { running: true, accessibility: false } }
    expect(companionState(corner, MORNING, { followed: MORNING - 599_999 })).toBe('waiting')
    expect(companionState(corner, MORNING, { followed: MORNING - 600_000 })).toBe('corner')
  })
})

describe('companion presses through an injected engine', () => {
  async function view($: Parameters<Parameters<typeof test>[1]>[0], on: On) { const w = world(on, { store: RECENT }); await $.session.start(START); return w.view() }
  test('install argv and fallback Bash command quote paths safely; nonzero is a real result', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    expect(f.commands[0]?.argv).toEqual(['sh', "/tmp/plugin's files/bin/companion-macos.sh", 'install', '--report'])
    expect(f.commands[0]?.options).toEqual({ timeoutMs: 600_000 }); expect(f.records.length).toBe(1)
    f.process = 'throw'; await pressCompanion(f.engine, c, 'updateButton', v, f.redraw, f.active)
    expect(f.tools[0]).toEqual({ tool: 'Bash', command: `'sh' '/tmp/plugin'"'"'s files/bin/companion-macos.sh' 'install' '--report'`, description: 'Install Claude-sama Companion', timeout: 600_000 })
    const f2 = fakeEngine(); f2.process = 'nonzero'; f2.stdout = 'last message\nresult: failed\n'
    await pressCompanion(f2.engine, new CompanionBook(), 'install', v, f2.redraw, f2.active); expect(f2.tools).toEqual([])
    expect(companionCommand(['$(touch x)', '`id`', 'a b'])).toBe("'$(touch x)' '`id`' 'a b'")
  })
  for (const action of ['install', 'trash', 'summon', 'follow', 'small', 'on', 'off'] as const) test(`${action}: first redraw precedes optional file validation`, async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    c.confirmed = true
    const operations: string[] = []
    const exists = f.engine.fs.exists, read = f.engine.fs.read
    f.engine.fs.exists = (async (...args: Parameters<typeof exists>) => { operations.push('fs.exists'); return exists(...args) }) as typeof exists
    f.engine.fs.read = (async (...args: Parameters<typeof read>) => { operations.push('fs.read'); return read(...args) }) as typeof read
    const draw = () => {
      operations.push('redraw')
      if (f.redraws === 0 && (action === 'install' || action === 'trash')) expect(c.progress).toBe(action)
      f.redraw()
    }
    await pressCompanion(f.engine, c, action, v, draw, f.active)
    expect(operations[0]).toBe('redraw')
    expect(operations).toContain('fs.exists')
    expect(operations).toContain('fs.read')
    expect(c.busy.size).toBe(0)
    expect(c.progress).toBeUndefined()
  })
  test('denial shows notRun for one draw, and an unavailable ladder shows cannot', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook(); f.process = 'throw'; f.tool = 'deny'
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    expect((await companionData(f.engine, c, false, f.now)).notRun).toBe(true)
    expect((await companionData(f.engine, c, false, f.now)).notRun).toBe(false)
    expect(f.records).toEqual([])
    f.tool = 'throw'; await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    expect((await companionData(f.engine, c, false, f.now)).cannot).toBe(true)
  })
  for (const [report, expected] of [['no-tools', 'tools'], ['old-tools', 'oldTools'], ['failed', 'failed'], ['not-mac', 'failed'], ['ok', 'corner']] as const) test(`result: ${report} maps to ${expected}`, async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook(); f.stdout = `clear message\nresult: ${report}\n`
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    const data = await companionData(f.engine, c, false, f.now); expect(data.state).toBe(expected)
    if (expected === 'failed') expect(data.message).toBe('clear message')
  })
  test('while building a duplicate press is ignored', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    let finish: ((r: unknown) => void) | undefined
    const run = f.engine.process.run
    let builds = 0
    f.engine.process.run = ((argv, init) => {
      if (atomicFeed(argv, init?.stdin) || argv[0] === '/usr/bin/touch') return run(argv, init)
      builds++
      return new Promise(resolve => { finish = resolve })
    }) as typeof run
    const first = pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    for (let i = 0; i < 20 && !finish; i++) await Promise.resolve()
    expect((await companionData(f.engine, c, false, f.now)).state).toBe('building')
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    finish?.({ exitCode: 0, stdout: 'result: ok', stderr: '' }); await first
    expect(builds).toBe(1)
    expect(f.records.length).toBe(1)
  })
  test('a running companion summons immediately and its event acknowledges without a clock wait', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active)
    expect(f.records[0]?.summon).toBe(MORNING)
    expect(f.commands[0]?.argv).toEqual(COMPANION_OPEN)
    expect(f.timers).toEqual([])
    companionChanged({ running: true, accessibility: true, answered: MORNING, login: false, size: 'medium' })
    expect((await companionData(f.engine, c, false, f.now)).state).toBe('following')
  })
  test('a stopped companion starts immediately; absent folder writes and starts nothing', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook(); f.state.info.running = false
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active); expect(f.commands[0]?.argv).toEqual(COMPANION_OPEN)
    f.records.length = 0; f.commands.length = 0; f.state.folder = false
    for (const action of ['summon', 'follow', 'openSettings', 'small', 'on', 'off', 'trash'] as const) await pressCompanion(f.engine, c, action, v, f.redraw, f.active)
    expect(f.records).toEqual([]); expect(f.commands).toEqual([])
  })
  test('folder checked immediately before writing; requests survive later feed records', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    for (const action of ['follow', 'openSettings', 'small', 'on'] as const) { await pressCompanion(f.engine, c, action, v, f.redraw, f.active); await f.advance(1) }
    const later = companionRecord(v)
    expect(later.follow).toBe(MORNING); expect(later.settings).toBe(MORNING + 1)
    expect(later.size).toEqual({ to: 'small', at: MORNING + 2 }); expect(later.login).toEqual({ on: true, at: MORNING + 3 })
    f.records.length = 0; f.beforeWrite = () => { f.state.folder = false }
    await pressCompanion(f.engine, c, 'large', v, f.redraw, f.active)
    expect(f.records).toEqual([]); expect(companionRecord(v).size).toEqual(later.size)
  })
  test('settings acknowledgements are events, with no polling or delayed read after close', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'follow', v, f.redraw, f.active)
    expect(f.timers).toEqual([])
    companionChanged({ running: true, accessibility: true, login: false, size: 'medium' })
    expect((await companionData(f.engine, c, false, f.now)).state).toBe('following')
    c.forget(); const reads = f.reads.length; await f.advance(600_000)
    expect(f.reads.length).toBe(reads)
  })
  test('no check chain remains; remove still confirms, keeps and trashes', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'follow', v, f.redraw, f.active); await pressCompanion(f.engine, c, 'small', v, f.redraw, f.active)
    expect(f.timers.filter(t => !t.cancelled)).toEqual([])
    await f.advance(330_000); expect(f.timers.filter(t => !t.cancelled)).toEqual([])
    await pressCompanion(f.engine, c, 'trash', v, f.redraw, f.active); expect(f.commands).toEqual([])
    await pressCompanion(f.engine, c, 'remove', v, f.redraw, f.active); expect((await companionData(f.engine, c, false, f.now)).confirmed).toBe(true)
    await pressCompanion(f.engine, c, 'keep', v, f.redraw, f.active); expect((await companionData(f.engine, c, false, f.now)).confirmed).toBe(false)
    await pressCompanion(f.engine, c, 'remove', v, f.redraw, f.active); await pressCompanion(f.engine, c, 'trash', v, f.redraw, f.active)
    expect(f.commands[0]?.argv).toEqual(['sh', "/tmp/plugin's files/bin/companion-macos.sh", 'uninstall', '--report'])
    f.state.folder = false; f.state.app = false; const data = await companionData(f.engine, c, false, f.now)
    expect(data.state).toBe('absent'); expect(data.removed).toBe(true)
  })
  test('after closing Settings no deferred summon can start another program', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active)
    expect(f.commands.length).toBe(1)
    f.setActive(false); c.forget()
    const reads = f.reads.length
    await f.advance(600_000)
    expect(f.commands.length).toBe(1); expect(f.reads.length).toBe(reads)
    expect(f.timers).toEqual([])
  })
  test('companion diagram and size figures use bundled pixels and forget clears their caches', async ($, on) => {
    await view($, on)
    const f = fakeEngine(), c = new CompanionBook()
    const data = await companionData(f.engine, c, true, f.now)
    expect(data.stage).toBeDefined(); expect(data.figures).toBeDefined()
    expect(f.reads.filter(path => /[\/]assets[\/]/.test(path))).toEqual([])
    c.forget(); expect(c.stage).toBeUndefined(); expect(c.figures).toBeUndefined()
  })
  test('all diagram and figure SVGs stay within the engine bound, contain no script and pixelate pixel heads', { timeoutMs: 60_000 }, () => {
    for (const state of ['absent', 'stopped', 'hidden', 'corner', 'following'] as const) {
      const source = companionStageSvg(state, stubPng(state))
      expect(source.length).toBeLessThan(131072); expect(source).not.toContain('<script')
      if (state !== 'absent') expect(source).toContain('image-rendering:pixelated')
      expect(source).not.toContain('@media')
    }
    for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
      const fig = companionSizeSvg(size, stubPng(size)); expect(fig.source.length).toBeLessThan(131072)
      expect(fig.source.includes('image-rendering:pixelated')).toBe(size === 'tiny' || size === 'small')
    }
    for (const text of Object.values(BOOK_FILES)) {
      const words = JSON.parse(text).settings.companion
      for (const key of ['installHelp', 'toolsLine', 'oldToolsLine', 'updateHelp', 'sizeHelp', 'sizePreview', 'loginHelp']) expect(Object.prototype.hasOwnProperty.call(words, key)).toBe(false)
      expect(Object.values(words.stageAlt).every(s => typeof s === 'string' && !!s.trim())).toBe(true)
      expect(words.sizeAlt.pixel).toContain('{size}'); expect(words.sizeAlt.painted).toContain('{size}')
    }
  })
})
