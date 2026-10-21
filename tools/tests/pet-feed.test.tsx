// The Windows and Linux pet is fed through its own program (lane C, 10-16; DECISIONS 941): the plugin finds the build
// for this computer in companion-rs/bin and pipes each record to its `write-shared`, only while the pet's folder is
// there. macOS keeps companion-control (startup.test.tsx). Runs on both roots: run-tests.py --windows-roots too.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { joinPath } from '../hooks/paths'
import { petDataFolder, petProgramName } from '../hooks/pet-program'
import { companionCommand } from '../hooks/companion-book'
import { PLUGIN_VERSION } from '../hooks/book-text'
import { TEST_PLUGIN_ROOT, WINDOWS_ROOTS } from './test-system'
import { MORNING, P, PERSON, band, settleLegacyStart, world } from './world'
import { snapshot } from './presence-world'
import { transportFixture } from './presence-transport-fixture'

const HOME = WINDOWS_ROOTS ? 'C:\\Users\\windows' : '/home/pet'
// The pet's folder in each system's usual place (petDataFolder; his card of 10-18): no APPDATA or XDG_CONFIG_HOME here.
const FOLDER = WINDOWS_ROOTS ? joinPath(HOME, 'AppData', 'Roaming', 'Coco') : joinPath(HOME, '.config', 'coco-pet')
const system = WINDOWS_ROOTS ? 'windows' : 'linux'
const program = (arch: string) => joinPath(TEST_PLUGIN_ROOT, petProgramName(system, arch)!)
const START = { cwd: WINDOWS_ROOTS ? 'C:\\Users\\windows\\project' : '/tmp/pet-project', surface: 'terminal' as const, isInteractive: true }

type Run = { argv: readonly string[]; stdin?: string }
// The shared presence folder (presenceFolder): Windows uses it as it is, Linux under native-v2.
const PRESENCE = WINDOWS_ROOTS ? joinPath(HOME, '.local', 'state', 'coco') : joinPath(HOME, '.local/state/coco/native-v2')
function petWorld(on: Parameters<Parameters<typeof test>[1]>[1], o: { folder?: boolean; builds?: readonly string[]; arch?: string; mac?: boolean; shared?: ReturnType<typeof transportFixture>; app?: boolean; readText?: (path: string) => string | undefined } = {}) {
  const env = WINDOWS_ROOTS
    ? { USERPROFILE: HOME, OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: o.arch ?? 'AMD64', LANG: 'en_US.UTF-8' }
    : { HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }
  // Registered before the world's own tool.call, so this one stands outside it and sees the Bash command.
  const asked: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => { asked.push(e.command); return { deny: 'fixture: not run' } })
  // With a shared presence fixture: a More option is on, and the presence helper's streams come from the fixture.
  const spawned: string[][] = []
  if (o.shared) on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv])
    const presence = WINDOWS_ROOTS ? e.argv[1] === 'presence' : e.argv.some(arg => arg.endsWith('presence.sh'))
    if (!presence) return { value: { code: 0, signal: null } }
    const child = o.shared!.spawn('pet-feed', [...e.argv])
    try { while (true) { const chunk = await child.next(); if (chunk.done) return { value: chunk.value }; yield chunk.value } }
    finally { await child.return({ code: 0, signal: null }) }
  })
  const w = world(on, { env, withNativePresence: !!o.shared, ...(o.readText ? { readText: o.readText } : {}) })
  const state = { folder: o.folder !== false }
  const builds = new Set((o.builds ?? ['x86_64']).map(program))
  const runs: Run[] = []
  // On Linux the kit reads a Windows root as relative and puts the test's folder before it.
  on('fs.exists', async ($, e, next) => {
    if (e.path.endsWith(FOLDER)) return { value: state.folder }
    if (/[\\/]companion-rs[\\/]bin[\\/]/.test(e.path)) return { value: [...builds].some(build => e.path.endsWith(build)) }
    if (e.path === '/System/Library/CoreServices/SystemVersion.plist') return { value: o.mac === true }
    // where `install` puts the pet (setup.rs app_folder)
    if (o.app !== undefined && /[\\/](?:coco-pet|Coco Pet)$/.test(e.path)) return { value: o.app }
    if (o.shared && e.path === '/bin/sh') return { value: !WINDOWS_ROOTS }
    return next(e)
  })
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const stdout = e.argv[0] === '/usr/bin/uname' ? `Linux ${o.arch ?? 'x86_64'}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const feeds = () => runs.filter(r => r.argv[1] === 'write-shared')
  return { w, state, runs, feeds, asked, spawned }
}

async function settle($: Engine, w: ReturnType<typeof world>) {
  await settleLegacyStart($, w)
  for (let i = 0; i < 6; i++) { await w.clock.advance(0); await $.prompt.submit({ text: `turn ${i}`, wait: false, origin: PERSON }) }
  await w.clock.advance(0)
}

describe('the Windows and Linux pet is fed through its own program', () => {
  test('its folder is %APPDATA%\\Coco or $XDG_CONFIG_HOME/coco-pet, as the pet finds it (paths.rs), never ~/.config/coco', async () => {
    const host = (values: Record<string, string>) => ({ env: { get: async (key: string) => values[key] } }) as unknown as Parameters<typeof petDataFolder>[0]
    expect(await petDataFolder(host({}), 'C:\\Users\\friend', true)).toBe('C:\\Users\\friend\\AppData\\Roaming\\Coco')
    expect(await petDataFolder(host({ APPDATA: 'D:\\Profiles\\friend\\Roaming' }), 'C:\\Users\\friend', true)).toBe('D:\\Profiles\\friend\\Roaming\\Coco')
    expect(await petDataFolder(host({ APPDATA: 'relative' }), 'C:\\Users\\friend', true)).toBe('C:\\Users\\friend\\AppData\\Roaming\\Coco')
    // ~/.config/coco holds the line library and the talk key, which taking the pet away must leave alone.
    expect(await petDataFolder(host({}), '/home/friend', false)).toBe('/home/friend/.config/coco-pet')
    expect(await petDataFolder(host({ XDG_CONFIG_HOME: '/xdg/config' }), '/home/friend', false)).toBe('/xdg/config/coco-pet')
    expect(await petDataFolder(host({ XDG_CONFIG_HOME: 'relative' }), '/home/friend', false)).toBe('/home/friend/.config/coco-pet')
  })

  test('each record goes to write-shared in the pet folder, from the build for this processor', async ($, on) => {
    const f = petWorld(on)
    await $.session.start(START)
    await settle($, f.w)
    const feeds = f.feeds()
    expect(feeds.length).toBeGreaterThan(0)
    for (const feed of feeds) expect(feed.argv).toEqual([program('x86_64'), 'write-shared', FOLDER, 'view.json'])
    const record = JSON.parse(feeds.at(-1)!.stdin!) as Record<string, unknown>
    expect(typeof record.mood).toBe('string')
    expect(f.runs.some(r => r.argv[0] === '/bin/sh')).toBe(false)
  })

  test('an ARM computer uses the ARM build', async ($, on) => {
    const f = petWorld(on, { arch: WINDOWS_ROOTS ? 'ARM64' : 'aarch64', builds: ['x86_64', 'aarch64'] })
    await $.session.start(START)
    await settle($, f.w)
    expect(f.feeds().length).toBeGreaterThan(0)
    expect(f.feeds().every(feed => feed.argv[0] === program('aarch64'))).toBe(true)
  })

  test('no pet folder, no write and no question to the system; the folder appearing later starts the feed', async ($, on) => {
    const f = petWorld(on, { folder: false })
    await $.session.start(START)
    await settle($, f.w)
    expect(f.feeds()).toEqual([])
    // Which Linux build fits costs a uname: not asked before the pet is there.
    expect(f.runs.some(r => r.argv[0] === '/usr/bin/uname')).toBe(false)
    f.state.folder = true
    for (let i = 0; i < 4; i++) { await $.prompt.submit({ text: `after install ${i}`, wait: false, origin: PERSON }); await f.w.clock.advance(0) }
    expect(f.feeds().length).toBeGreaterThan(0)
  })

  test('a package without a build for this computer feeds nothing and asks the system nothing', async ($, on) => {
    const f = petWorld(on, { builds: [] })
    await $.session.start(START)
    await settle($, f.w)
    expect(f.feeds()).toEqual([])
    expect(f.runs.some(r => r.argv[0] === '/usr/bin/uname')).toBe(false)
  })
})

describe('/coco companion runs the pet program off macOS', () => {
  test('install (with --login too), start, stop and uninstall run the build for this computer, by its whole path; anything else runs nothing', async ($, on) => {
    const f = petWorld(on, { folder: false })
    const asked = f.asked
    await $.session.start(START)
    await settleLegacyStart($, f.w)
    const verbs = ['install', 'install --login', 'start', 'stop', 'uninstall']
    for (const verb of verbs) await $.command.run({ command: 'coco', args: `companion ${verb}`, origin: PERSON, presentation: P })
    const quote = (arg: string) => `'${arg.replace(/'/g, `'"'"'`)}'`
    expect(asked).toEqual(verbs.map(verb => [program('x86_64'), ...verb.split(' ')].map(quote).join(' ')))
    asked.length = 0
    for (const args of ['companion start --login', 'companion status', 'companion', 'companion remove', 'companion install now']) await $.command.run({ command: 'coco', args, origin: PERSON, presentation: P })
    expect(asked).toEqual([])
    expect(f.runs.some(r => r.argv.some(arg => arg.endsWith('companion-macos.sh')))).toBe(false)
  })
})

// Windows shares presence too (DECISIONS 941 「Windows 也启动共享的后台」): every window and the pet sleep and wake
// together. The helper is the pet program's `presence` verbs there (companion-rs/src/presence_helper.rs), presence.sh
// on Linux; tests/presence_windows.rs in the Rust crate runs the Windows one for real.
describe('every window shares one presence, Windows too', () => {
  test('with a More option on, this window follows the shared folder and sleeps when everyone sleeps', async ($, on) => {
    const shared = transportFixture(snapshot('sleep', MORNING - 300000) as never)
    const f = petWorld(on, { folder: false, shared })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settleLegacyStart($, f.w)
    for (let i = 0; i < 4; i++) await f.w.clock.advance(0)
    const follow = f.spawned.find(argv => argv[3] === 'follow')
    expect(follow?.slice(0, 4)).toEqual(WINDOWS_ROOTS ? [program('x86_64'), 'presence', PRESENCE, 'follow']
      : ['/bin/sh', joinPath(TEST_PLUGIN_ROOT, 'bin', 'presence.sh'), PRESENCE, 'follow'])
    expect(f.w.view().mood).toBe('sleep')
    // A word here wakes the shared state for every window and the pet.
    await $.prompt.submit({ text: 'hi', wait: false, origin: PERSON })
    for (let i = 0; i < 4; i++) await f.w.clock.advance(0)
    expect(f.w.view().mood === 'sleep').toBe(false)
    expect(shared.state.asleep).toBe(false)
  })

  if (WINDOWS_ROOTS) test('a Windows package without the pet program keeps each window to itself', async ($, on) => {
    const shared = transportFixture(snapshot('sleep', MORNING - 300000) as never)
    const f = petWorld(on, { folder: false, shared, builds: [] })
    await $.session.start(START)
    await $.ui.mount({ surface: 'desktop', ...band(100) })
    await settleLegacyStart($, f.w)
    for (let i = 0; i < 4; i++) await f.w.clock.advance(0)
    expect(f.spawned).toEqual([])
    expect(f.w.view().mood === 'sleep').toBe(false)
  })
})

// Page 1's pet section off macOS (lane C 10-17): the minimal step (DECISIONS 941), drawn from the pet's own record, its
// buttons running the pet program; the Mac's lines that name the Mac are left out until lane B writes the computer's.
describe('the bag shows the pet off macOS', () => {
  const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} } }
  async function page($: Engine, on: Parameters<Parameters<typeof test>[1]>[1], installed: boolean) {
    const record = JSON.stringify({ running: true, size: 'small', login: true, version: PLUGIN_VERSION })
    const f = petWorld(on, { folder: installed, app: installed, readText: path => path.endsWith(joinPath(FOLDER, 'companion.json')) ? record : undefined })
    await $.session.start({ ...START, surface: 'desktop' }); await settleLegacyStart($, f.w)
    await $.command.run({ command: 'coco', args: 'him', origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
    for (let i = 0; i < 3; i++) { await f.w.clock.advance(0); await ui.redraw() }
    return { f, ui }
  }
  test('not there yet: install runs the pet program, and nothing says Mac', async ($, on) => {
    const { f, ui } = await page($, on, false)
    expect(await ui.find({ type: 'Button', key: 'coco:companion:install' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).some(node => /Mac/.test(String(node.props.text ?? '')))).toBe(false)
    await ui.press({ key: 'coco:companion:install' }); await f.w.clock.advance(0); await ui.redraw()
    expect(f.asked).toEqual([companionCommand([program('x86_64'), 'install'])])
  })
  test('there and running: its size and login from its own record, a size press rides the feed, remove runs uninstall', async ($, on) => {
    const { f, ui } = await page($, on, true)
    // the pet's record still says Small, from before it moved to the Mac's three sizes (10-19): the bag shows Medium
    expect((await ui.find({ type: 'Button', key: 'coco:companion:medium' }))?.props.variant).toBe('primary')
    expect((await ui.find({ type: 'Button', key: 'coco:companion:on' }))?.props.variant).toBe('primary')
    await ui.press({ key: 'coco:companion:large' }); await f.w.clock.advance(0)
    const record = JSON.parse(f.feeds().at(-1)!.stdin!) as { size?: { to: string } }
    expect(record.size?.to).toBe('large')
    await ui.press({ key: 'coco:companion:remove' }); await ui.redraw()
    await ui.press({ key: 'coco:companion:trash' }); await f.w.clock.advance(0)
    expect(f.asked).toEqual([companionCommand([program('x86_64'), 'uninstall'])])
  })
})
