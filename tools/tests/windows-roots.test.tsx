// Windows fixtures run on every host; native programs and filesystem writes are always spies.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { CompanionChannel } from '../hooks/channel'
import { companionRecord, companionSession, companionTask } from '../hooks/companion'
import { initialView } from '../hooks/mood'
import { taskForTool } from '../hooks/tasks'
import { IconBook } from '../hooks/icon-book'
import { latest } from '../hooks/latest'
import { runIcon } from '../hooks/pages'
import { BOOK_FILES } from './book-files'
import { TEST_PLUGIN_ROOT, WINDOWS_ROOTS } from './test-system'
import { settleLegacyStart, P, PERSON, RECENT, band, world } from './world'

const ROOT = 'C:\\Users\\windows\\project'
const PROFILE = 'C:\\Users\\windows'
const ENV = { USERPROFILE: PROFILE, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }
const START = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true }
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const callbacks = { running: () => {}, seen: () => {}, ack: async () => {}, changed: async () => {} }

describe('Windows roots and unsupported capabilities', () => {
  test('a Windows session and tool path produce portable companion record data', () => {
    companionSession(ROOT + '\\')
    companionTask(taskForTool({ tool: 'Read', file_path: ROOT + '\\src\\parser.ts' }))
    const record = companionRecord(initialView())
    expect(record.project).toBe('project')
    expect(record.task).toBe('reading parser.ts')
    expect(record.channel).toBe(false)
  })
  test('a Windows folder cannot spawn a POSIX request reader', async () => {
    let writes = 0, spawns = 0
    const child = async function* () { return { code: 0, signal: null } }
    const channel = new CompanionChannel({ exists: async () => true, write: async () => { writes++ }, spawn: () => { spawns++; return child() as never }, now: async () => 0, submit: async () => {}, clear: async () => {} }, 's1', PROFILE + '\\Library\\Application Support\\Coco', callbacks)
    await channel.start()
    expect(writes).toBe(0)
    expect(spawns).toBe(0)
  })
  test('a missing tail is checked before creating a request file or spawning', async () => {
    let writes = 0, spawns = 0
    const child = async function* () { return { code: 0, signal: null } }
    const channel = new CompanionChannel({ exists: async path => path !== '/usr/bin/tail' && !path.endsWith('requests.jsonl'), write: async () => { writes++ }, spawn: () => { spawns++; return child() as never }, now: async () => 0, submit: async () => {}, clear: async () => {} }, 's1', '/tmp/installed-companion', callbacks)
    await channel.start()
    expect(writes).toBe(0)
    expect(spawns).toBe(0)
  })
  test('USERPROFILE without HOME suppresses icon commands even with misleading POSIX probes', async () => {
    const before = latest.settings
    try {
      for (const appIcon of ['on','off',undefined] as const) {
        latest.settings = appIcon ? { appIcon } : {}
        let calls = 0, probes = 0
        const engine = { plugin: { root: PROFILE + '\\Coco' }, env: { get: async (name: string) => (ENV as Record<string, string>)[name] }, fs: { exists: async () => { probes++; return true } }, process: { run: async () => { calls++; return { exitCode: 0, stdout: 'icon: own\n', stderr: '' } } } } as unknown as EngineInterface
        const icon = new IconBook()
        await runIcon(engine, icon, 'status', () => {})
        expect(calls).toBe(0); expect(probes).toBe(0)
        expect(icon.unavailable).toBe(appIcon === 'on')
      }
    } finally { latest.settings = before }
  })
  // SPEC 0.5 and C3 Build 0: book words load once on first open; unsupported native operations remain absent.
  for (const surface of ['desktop', 'terminal'] as const) test(`${surface}: book and band survive USERPROFILE-only Windows; unsupported sections are hidden`, async ($, on) => {
    let writes = 0, spawns = 0, runs = 0
    on('session.id', () => ({ value: 'windows-session' }))
    on('session.surfaces', () => ({ value: [surface] }))
    on('fs.exists', ($, e) => ({ value: !/[A-Za-z]:\\/.test(e.path) })) // even stray POSIX-looking records must not enable native tools; the pet program (a drive path; the Mac host prefixes it) is absent, as on the runner
    on('fs.write', () => { writes++; return { value: undefined } })
    on('process.run', () => { runs++; throw new Error('native command must not run') })
    on('process.spawn', async function* () { spawns++; return { code: 0, signal: null } })
    const w = world(on, { store: RECENT, env: ENV, sessionRoot: ROOT })
    await $.session.start(START); await settleLegacyStart($,w);
    const strip = await $.ui.mount({ surface, ...band(100) })
    expect(await strip.find({ type: 'Text', text: /Coco/ })).toBeDefined()
    expect(w.fileReads.filter(path=>/[\\/]book[\\/]/.test(path))).toEqual([])
    await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
    const book = await $.ui.mount({ surface, ...PANE })
    const words = JSON.parse(BOOK_FILES['en.json']).settings
    // her bag's seven pages (the sock drawer is the fourth, lane C 10-14); none of them is hidden on Windows
    expect((await book.findAll({ type: 'Button' })).filter(button => String(button.key).startsWith('coco:book:tab:')).length).toBe(7)
    if (WINDOWS_ROOTS) {
      const windowsReads = w.fileReads.map(path => path.slice(path.indexOf('C:'))).filter(path => path.startsWith('C:'))
      // Only the plugin's own shipped files, under its root (the mock Windows root, or the real one on Windows): the book words, the cost prices, and what a desktop band and the bag draw.
      const shipped = ['assets\\prices.json', 'book\\en.json', ...(surface === 'desktop' ? ['assets\\coco\\band-A.json', 'assets\\coco\\band-B.json', 'assets\\coco\\bag-peek.png'] : [])].map(path => TEST_PLUGIN_ROOT + '\\' + path)
      expect(windowsReads.filter(path => /\\(?:book|assets)\\/.test(path)).sort()).toEqual(shipped.sort())
      expect(windowsReads.every(path => /^C:\\/.test(path) && !path.includes('/'))).toBe(true)

    }
    expect(typeof words.icon.S1).toBe('string')
    expect(words.icon.S1.length).toBeGreaterThan(0)
    expect(await book.find({ type: 'Text', text: words.icon.S1 })).toBeUndefined()
    expect(await book.find({ type: 'Text', text: words.companion.label })).toBeUndefined()
    expect((await book.findAll({ type: 'Button' })).filter(button => /^coco:(?:icon|companion):/.test(String(button.key)))).toEqual([])
    await book.redraw();await $.command.run({command:'coco',args:'settings',origin:PERSON,presentation:P});await book.redraw()
    expect(w.fileReads.filter(path=>/[\\/]book[\\/]en\.json$/.test(path)).length).toBe(1)
    expect(writes).toBe(0); expect(spawns).toBe(0); expect(runs).toBe(0)

  })
})
