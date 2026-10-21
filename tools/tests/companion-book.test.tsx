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
import { settleLegacyStart, MORNING, P, PERSON, RECENT, stubPng, world, band } from './world'
import { atomicFeed, PROCESS_OK } from './shared-world'
import { BAG_TEXT_RAW } from './bag-text-fixture'
// her desktop companion stands on her page once lane B has named its group there (bag step 2), else on the switches page
const COMPANION_PAGE = JSON.parse(BAG_TEXT_RAW).en.himGroups ? 'him' : 'settings'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const HOME = '/tmp/x', FOLDER = `${HOME}/Library/Application Support/Coco`, FEED = `${FOLDER}/view.json`
const INFO = `${FOLDER}/companion.json`, APP = `${HOME}/${COMPANION_APP}`, PLIST = `${HOME}/${COMPANION_PLIST}`
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const normal: CompanionSnapshot = { folder: true, app: true, login: false, info: { running: true, accessibility: true, size: 'medium', version: PLUGIN_VERSION }, version: PLUGIN_VERSION }

function fixture(on: On, options: { guard?: boolean; mac?: boolean; folder?: boolean; app?: boolean; info?: Record<string, unknown>; missingRecord?: boolean; login?: boolean; report?: string; processThrows?: boolean; hold?: () => Promise<void> } = {}) {
  const state = { folder: options.folder ?? true, app: options.app ?? true, login: options.login ?? false, info: options.info ?? { running: true, accessibility: true, size: 'medium', version: PLUGIN_VERSION }, report: options.report ?? 'ok' }
  const records: Record<string, unknown>[] = [], commands: string[][] = [], reads: string[] = [], guardCommands: string[][] = []
  let companionScript: string | undefined
  let requestFileExists = false
  on('fs.exists', ($, e) => ({ value: /[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.path) ? options.guard !== false : samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') ? options.mac !== false : samePath(e.path, '/usr/bin/tail') ? true : samePath(e.path, FOLDER) ? state.folder : samePath(e.path, APP) ? state.app : samePath(e.path, PLIST) ? state.login : samePath(e.path, `${FOLDER}/requests.jsonl`) ? requestFileExists : false }))
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
    if (/[\\/]bin[\\/]coco-state(?:-macos-(?:x86_64|aarch64)|-linux-(?:x86_64|aarch64)|-windows-(?:x86_64|aarch64)\.exe)?$/.test(e.argv[0] ?? '')) {
      guardCommands.push([...e.argv])
      if (e.argv[1] === '--ensure-requests') requestFileExists = true
      return { value: { ...PROCESS_OK, stdout: JSON.stringify(e.argv[1] === '--ensure-requests' ? { ensured: true } : e.argv[1] === '--read-requests' ? { read: true, text: '' } : e.argv[1] === '--append-requests' ? { appended: true } : { marked: true }) } }
    }
    const feed = atomicFeed(e.argv, e.init?.stdin)
    if (feed) { expect(samePath(feed.path, FEED)).toBe(true); records.push(JSON.parse(feed.text)); return { value: PROCESS_OK } }
    if (e.argv[0] === '/usr/bin/touch') { requestFileExists = true; return { value: PROCESS_OK } }
    if (slashPath(e.argv[1] ?? '').includes('/bin/icon-')) {
      companionScript = e.argv[1]!.replace(/icon-[^\\/]+\.sh$/, 'companion-macos.sh')
      return { value: { ...PROCESS_OK, stdout: 'icon: stock\n' } }
    }
    commands.push([...e.argv]); await options.hold?.(); if (options.processThrows) throw new Error('direct process unavailable')
    return { value: { ...PROCESS_OK, exitCode: state.report === 'ok' ? 0 : 1, stdout: `build message\nresult: ${state.report}\n` } }
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // Main's icon (10-09) runs no status before consent, so the script path may first be seen here.
    companionScript ??= /'([^']*[\\/]bin[\\/]companion-macos\.sh)'/.exec(e.command)?.[1]
    expect(companionScript).toBeDefined()
    const argv = ['/bin/sh', companionScript!, state.app ? 'uninstall' : 'install', '--report']
    const install = ['/bin/sh', companionScript!, 'install', '--report']
    const matched = [argv, install, [...COMPANION_OPEN]].find(candidate => companionCommand(candidate) === e.command)
    if (!matched) return next(e)
    commands.push(matched); await options.hold?.()
    return { isError: state.report !== 'ok', result: { exitCode: state.report === 'ok' ? 0 : 1, stdout: `build message\nresult: ${state.report}\n`, stderr: '', interrupted: false } }
  })
  const w = world(on, { store: RECENT, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME } })
  return { w, state, records, commands, reads, guardCommands, get companionScript() { return companionScript } }
}
async function settings($: Parameters<Parameters<typeof test>[1]>[0], surface: 'desktop' | 'terminal', w: ReturnType<typeof world>) {
  await $.session.start(START); await settleLegacyStart($,w);
  await $.command.run({ command: 'coco', args: COMPANION_PAGE, origin: PERSON, presentation: P })
  return $.ui.mount({ surface, ...PANE })
}

// No host event is used by this harness; only its explicit maps, arrays and callback queue.
function fakeEngine() {
  let now = MORNING, active = true, redraws = 0
  const state = { folder: true, app: true, login: false, info: { running: true, accessibility: false, size: 'medium', version: PLUGIN_VERSION, answered: 0, sizeAt: 0, loginAt: 0 } as Record<string, unknown> }
  let processBehavior: 'ok' | 'throw' | 'nonzero' = 'ok', toolBehavior: 'ok' | 'throw' | 'deny' | 'nonzero' = 'ok', stdout = 'result: ok\n'
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
    tool: { call: async (input: Record<string, unknown>) => { tools.push(input); if (toolBehavior === 'throw') throw new Error('unavailable'); if (toolBehavior === 'deny') return { deny: 'person declined' }; return { isError: toolBehavior === 'nonzero', result: { exitCode: toolBehavior === 'nonzero' ? 1 : 0, stdout, stderr: '', interrupted: false }, text: 'mapped output' } } },
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
      const f = fixture(on, { info: { ...info, version: PLUGIN_VERSION } }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Text', text: status })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('coco:companion:')).every(b => !b.props.hotkey)).toBe(true)
      if (surface === 'terminal') expect(await ui.findAll({ type: 'Svg' })).toEqual([])
    })
    test(`${surface}: a fresh draw runs no program action before a press`, async ($, on) => {
      const f = fixture(on, { app: false }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Button', text: 'Install Coco Pet' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeUndefined()
      expect(f.commands).toEqual([])
    })
    test(`${surface}: a program action uses one permission-scoped Bash and shows the permission note`, async ($, on) => {
      const tools: string[] = []
      on('tool.call', { tool: 'Bash' }, ($, e) => {
        tools.push(e.command)
        return { result: { stdout: 'Apple tools are needed\nresult: no-tools\n', stderr: '', interrupted: false }, text: 'Apple tools are needed' }
      })
      const f = fixture(on, { app: false, processThrows: true }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeUndefined()
      await ui.press({ key: 'coco:companion:install' }); await f.w.clock.advance(0); await ui.redraw()
      expect(f.commands).toEqual([])
      const script = f.companionScript ?? /'([^']*[\\/]bin[\\/]companion-macos\.sh)'/.exec(tools[0] ?? '')?.[1]
      expect(script).toBeDefined()
      expect(tools).toEqual([companionCommand(['/bin/sh', script!, 'install', '--report'])])
      expect(await ui.find({ type: 'Text', text: "Needs Apple's Command Line Tools" })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeDefined()
      // The failure belongs to this load, so another draw retains the note.
      await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeDefined()
    })
    test(`${surface}: missing app shows install; off macOS shows no section`, async ($, on) => {
      const f = fixture(on, { app: false }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Button', text: 'Install Coco Pet' })).toBeDefined()
    })
    test(`${surface}: not macOS`, async ($, on) => {
      const f = fixture(on, { mac: false }); const ui = await settings($, surface, f.w)
      // the section's title itself: the look row's help on the same page names Coco Pet too (lane B's words, 10-17)
      expect((await ui.findAll({ type: 'Text' })).some((node: { text?: string }) => node.text === 'Coco Pet')).toBe(false)
    })
    test(`${surface}: malformed finite timestamps cannot break the Settings drawing`, async ($, on) => {
      const f = fixture(on, { info: { running: true, accessibility: false, hiddenUntil: 1e300, answered: 'wrong', size: 'enormous', version: PLUGIN_VERSION } }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Text', text: "Can't follow your window yet" })).toBeDefined()
    })
    const unknownVersions: readonly [string, Record<string, unknown>, boolean][] = [
      ['missing version field', { running: true, accessibility: true }, false],
      ['empty record', {}, false],
      ['missing record', {}, true],
    ]
    for (const [name, info, missingRecord] of unknownVersions) test(`${surface}: ${name} does not claim an update is available`, async ($, on) => {
      const f = fixture(on, { info, missingRecord }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Text', text: 'Coco Pet' })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: 'Remove from this Mac…' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: 'Update Coco' })).toBeUndefined()
    })
    test(`${surface}: the same recorded version has no update row`, async ($, on) => {
      const f = fixture(on, { info: { running: true, accessibility: true, version: PLUGIN_VERSION } }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Text', text: 'Beside your window' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: 'Update Coco' })).toBeUndefined()
    })
    test(`${surface}: update, size and login use the record and plist`, async ($, on) => {
      const f = fixture(on, { login: true, info: { running: true, accessibility: true, size: 'larger', version: '0' } }); const ui = await settings($, surface, f.w)
      expect(await ui.find({ type: 'Button', text: 'Update Coco' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Update ready' })).toBeDefined()
      const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
      expect(text).toContain('Update ready'); expect(text).toContain("Coco's size"); expect(text).toContain('Start at login')
      expect(text).not.toContain('A newer companion came with this plugin.')
      // a pet that reports no capture switch (Linux, or one from before it) gets no row for it
      expect(text).not.toContain('Show in screenshots and recordings')
      expect(text).toContain('Now:\u00a0Larger'); expect(text).toContain('Now:\u00a0On')
      expect(text).not.toContain('Shown here at half size.')
      const sizeFigures = (await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.alt).startsWith('Larger:'))
      // Coco Pet draws her hand-drawn at every size, so every size's preview is read as painted
      expect(sizeFigures.map(svg => svg.props.alt)).toEqual(surface === 'desktop' ? ['Larger: painted'] : [])
    })
    // owner 10-20: a pet that can keep its windows out of screenshots reports the switch, and the page offers it
    test(`${surface}: the capture switch shows only when the pet reports it`, async ($, on) => {
      const f = fixture(on, { info: { running: true, accessibility: true, size: 'medium', version: PLUGIN_VERSION, capture: false } }); const ui = await settings($, surface, f.w)
      const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
      expect(text).toContain('Show in screenshots and recordings'); expect(text).toContain('Now:\u00a0Off')
      expect(await ui.find({ type: 'Button', key: 'coco:companion:captureOn' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'coco:companion:captureOff' })).toBeDefined()
    })
    // 10-17: on her page the bag shows the pet's three switches (on the desk, following, at login) over its three sizes (owner 10-18)
    if (surface === 'desktop' && COMPANION_PAGE === 'him') test(`${surface}: her page's bag shows the pet's switches and its size`, async ($, on) => {
      const f = fixture(on, { login: true, info: { running: true, accessibility: true, size: 'larger', version: PLUGIN_VERSION } }); const ui = await settings($, surface, f.w)
      const art = (await ui.findAll({ type: 'Svg' }))[0]
      expect(String(art?.props.alt)).toMatch(/^Coco's ita bag, Coco Pet: [23] of 3 on, size: Larger$/)
    })
    for (const [report, status, nextButton] of [
      ['no-tools', "Needs Apple's Command Line Tools", 'Get the Command Line Tools'],
      ['old-tools', 'Needs newer Command Line Tools', 'Open Software Update'],
      ['failed', "The build didn't finish", 'Try again'],
    ]) test(`${surface}: install result ${report} is drawn`, async ($, on) => {
      const f = fixture(on, { app: false, report }); const ui = await settings($, surface, f.w)
      await ui.press({ key: 'coco:companion:install' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: status })).toBeDefined()
      expect(await ui.find({ type: 'Button', text: nextButton })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Claude Code will ask first.' })).toBeDefined()
    })
    for (const action of ['install', 'trash'] as const) test(`${surface}: ${action === 'install' ? 'building' : 'removing'} replaces its buttons while busy`, async ($, on) => {
      let release: (() => void) | undefined, began: (() => void) | undefined
      const waiting = new Promise<void>(resolve => { release = resolve })
      const started = new Promise<void>(resolve => { began = resolve })
      const f = fixture(on, { hold: () => { began?.(); return waiting }, ...(action === 'install' ? { info: { running: true, accessibility: true, size: 'medium', version: 'old' } } : {}) }); const ui = await settings($, surface, f.w)
      if (action === 'trash') { await ui.press({ key: 'coco:companion:remove' }); await f.w.clock.advance(0); await ui.redraw() }
      // Install is supplied by the update row while he is present.
      const pressed = ui.press({ key: `coco:companion:${action === 'install' ? 'updateButton' : 'trash'}` })
      await started; await ui.redraw()
      expect(await ui.find({ type: 'Text', text: action === 'install' ? 'Building Coco…' : 'Moving Coco to the Trash…' })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('coco:companion:'))).toEqual([])
      release?.(); await pressed
    })
    test(`${surface}: follow shows waiting, and remove offers Keep before trash`, async ($, on) => {
      const f = fixture(on, { info: { running: true, accessibility: false, version: PLUGIN_VERSION } }); const ui = await settings($, surface, f.w)
      await ui.press({ key: 'coco:companion:follow' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: 'Waiting for your OK' })).toBeDefined()
      expect(f.records.some(r => typeof r.follow === 'number')).toBe(true)
      await ui.press({ key: 'coco:companion:remove' }); await f.w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Button', text: 'Move to Trash' })).toBeDefined()
      await ui.press({ key: 'coco:companion:keep' }); await f.w.clock.advance(0); await ui.redraw()
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
  async function view($: Parameters<Parameters<typeof test>[1]>[0], on: On) { const w = world(on, { store: RECENT }); await $.session.start(START); await settleLegacyStart($,w); return w.view() }
  test('program actions use scoped Bash only, quote paths safely, and retain nonzero results', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    expect(f.commands).toEqual([])
    expect(f.tools).toEqual([{ tool: 'Bash', command: `'/usr/bin/env' 'PATH=/usr/bin:/bin:/usr/sbin:/sbin' '/bin/sh' '/tmp/plugin'"'"'s files/bin/companion-macos.sh' 'install' '--report'`, description: 'Install Coco Pet', timeout: 600_000 }])
    expect(f.records.length).toBe(1)
    f.process = 'throw'; await pressCompanion(f.engine, c, 'updateButton', v, f.redraw, f.active)
    expect(f.commands).toEqual([]); expect(f.tools.length).toBe(2)
    const f2 = fakeEngine(); f2.tool = 'nonzero'; f2.stdout = 'last message\nresult: failed\n'
    const c2 = new CompanionBook(); await pressCompanion(f2.engine, c2, 'install', v, f2.redraw, f2.active)
    expect(f2.commands).toEqual([]); expect(f2.tools.length).toBe(1)
    expect((await companionData(f2.engine, c2, false, f2.now)).state).toBe('failed')
    expect(companionCommand(['$(touch x)', '`id`', 'a b'])).toBe("'/usr/bin/env' 'PATH=/usr/bin:/bin:/usr/sbin:/sbin' '$(touch x)' '`id`' 'a b'")
  })
  for (const action of ['install', 'trash', 'summon', 'follow', 'larger', 'on', 'off'] as const) test(`${action}: first redraw precedes optional file validation`, async ($, on) => {
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
    const call = f.engine.tool.call
    let builds = 0
    f.engine.tool.call = (() => {
      builds++
      return new Promise(resolve => { finish = resolve })
    }) as typeof call
    const first = pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    for (let i = 0; i < 20 && !finish; i++) await Promise.resolve()
    expect((await companionData(f.engine, c, false, f.now)).state).toBe('building')
    await pressCompanion(f.engine, c, 'install', v, f.redraw, f.active)
    finish?.({ result: { exitCode: 0, stdout: 'result: ok', stderr: '', interrupted: false } }); await first
    expect(builds).toBe(1)
    expect(f.records.length).toBe(1)
  })
  test('a running companion summons immediately and its event acknowledges without a clock wait', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active)
    expect(f.records[0]?.summon).toBe(MORNING)
    expect(f.tools[0]).toEqual({tool:'Bash',command:companionCommand(COMPANION_OPEN),description:'Bring Coco Pet back',timeout:30_000}); expect(f.commands).toEqual([])
    expect(f.timers).toEqual([])
    companionChanged({ running: true, accessibility: true, answered: MORNING, login: false, size: 'medium' })
    expect((await companionData(f.engine, c, false, f.now)).state).toBe('following')
  })
  test('a stopped companion starts immediately; absent folder writes and starts nothing', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook(); f.state.info.running = false
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active); expect(f.tools[0]).toEqual({tool:'Bash',command:companionCommand(COMPANION_OPEN),description:'Bring Coco Pet back',timeout:30_000}); expect(f.commands).toEqual([])
    f.records.length = 0; f.commands.length = 0; f.tools.length = 0; f.state.folder = false
    for (const action of ['summon', 'follow', 'openSettings', 'larger', 'on', 'off', 'trash'] as const) await pressCompanion(f.engine, c, action, v, f.redraw, f.active)
    expect(f.records).toEqual([]); expect(f.commands).toEqual([]); expect(f.tools).toEqual([])
  })
  test('folder checked immediately before writing; requests survive later feed records', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    for (const action of ['follow', 'openSettings', 'larger', 'on'] as const) { await pressCompanion(f.engine, c, action, v, f.redraw, f.active); await f.advance(1) }
    const later = companionRecord(v)
    expect(later.follow).toBe(MORNING); expect(later.settings).toBe(MORNING + 1)
    expect(later.size).toEqual({ to: 'larger', at: MORNING + 2 }); expect(later.login).toEqual({ on: true, at: MORNING + 3 })
    await pressCompanion(f.engine, c, 'captureOff', v, f.redraw, f.active)
    expect(companionRecord(v).capture).toEqual({ on: false, at: MORNING + 4 })
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
    await pressCompanion(f.engine, c, 'follow', v, f.redraw, f.active); await pressCompanion(f.engine, c, 'larger', v, f.redraw, f.active)
    expect(f.timers.filter(t => !t.cancelled)).toEqual([])
    await f.advance(330_000); expect(f.timers.filter(t => !t.cancelled)).toEqual([])
    await pressCompanion(f.engine, c, 'trash', v, f.redraw, f.active); expect(f.commands).toEqual([])
    await pressCompanion(f.engine, c, 'remove', v, f.redraw, f.active); expect((await companionData(f.engine, c, false, f.now)).confirmed).toBe(true)
    await pressCompanion(f.engine, c, 'keep', v, f.redraw, f.active); expect((await companionData(f.engine, c, false, f.now)).confirmed).toBe(false)
    await pressCompanion(f.engine, c, 'remove', v, f.redraw, f.active); await pressCompanion(f.engine, c, 'trash', v, f.redraw, f.active)
    expect(f.tools[0]).toEqual({tool:'Bash',command:companionCommand(['/bin/sh', "/tmp/plugin's files/bin/companion-macos.sh", 'uninstall', '--report']),description:'Move Coco Pet to the Trash',timeout:600_000}); expect(f.commands).toEqual([])
    f.state.folder = false; f.state.app = false; const data = await companionData(f.engine, c, false, f.now)
    expect(data.state).toBe('absent'); expect(data.removed).toBe(true)
  })
  test('after closing Settings no deferred summon can start another program', async ($, on) => {
    const v = await view($, on), f = fakeEngine(), c = new CompanionBook()
    await pressCompanion(f.engine, c, 'summon', v, f.redraw, f.active)
    expect(f.tools.length).toBe(1); expect(f.commands).toEqual([])
    f.setActive(false); c.forget()
    const reads = f.reads.length
    await f.advance(600_000)
    expect(f.tools.length).toBe(1); expect(f.commands).toEqual([]); expect(f.reads.length).toBe(reads)
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
  // Coco Pet draws her hand-drawn at every size, so the diagram nests her still where she stands and each size shows it
  test('all diagram and figure SVGs stay within the engine bound, contain no script and nest her still', { timeoutMs: 60_000 }, () => {
    const still = (h: number) => `<svg style="forced-color-adjust:none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 234 241" width="${h * 234 / 241}" height="${h}" data-coco="A idle"></svg>`
    for (const state of ['absent', 'stopped', 'hidden', 'corner', 'following'] as const) {
      const source = companionStageSvg(state, still(32))
      expect(source.length).toBeLessThan(131072); expect(source).not.toContain('<script')
      expect(source.includes('data-coco="A idle"')).toBe(state !== 'absent')
      expect(source).not.toContain('image-rendering:pixelated'); expect(source).not.toContain('@media')
    }
    expect(companionStageSvg('following', still(32))).toContain('<g clip-path="url(#above)"><svg x="63" y="11" ')
    for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
      const fig = companionSizeSvg(size, h => ({ source: still(h), width: h * 234 / 241 })); expect(fig.source.length).toBeLessThan(131072)
      expect(fig.height).toBe({ tiny: 24, small: 32, medium: 48, large: 64 }[size]); expect(fig.source).toContain(`height="${fig.height}"`)
    }
    for (const text of Object.values(BOOK_FILES)) {
      const words = JSON.parse(text).settings.companion
      for (const key of ['installHelp', 'toolsLine', 'oldToolsLine', 'updateHelp', 'sizeHelp', 'sizePreview', 'loginHelp']) expect(Object.prototype.hasOwnProperty.call(words, key)).toBe(false)
      expect(Object.values(words.stageAlt).every(s => typeof s === 'string' && !!s.trim())).toBe(true)
      expect(words.sizeAlt.pixel).toContain('{size}'); expect(words.sizeAlt.painted).toContain('{size}')
    }
  })
})

test('missing deferred development guard skips companion request transport without native exec',async($,on)=>{
 const f=fixture(on,{guard:false});await $.session.start(START);await settleLegacyStart($,f.w)
 await $.ui.mount({surface:'desktop',...band(100)})
 expect(f.guardCommands).toEqual([])
 expect(f.records.some(record=>record.channel===true)).toBe(false)
})
