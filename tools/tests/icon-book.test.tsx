import { samePath } from './file-paths'
// The icon script is always stubbed. These tests cannot reach a real app, native program or HOME.
import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { IconBook, iconReport } from '../hooks/icon-book'
import { runIcon } from '../hooks/pages'
import { BOOK_FILES } from './book-files'
import { LANGS } from '../hooks/words'
import { P, PERSON, RECENT, world } from './world'

const PANE = { plugin: 'claudesama', component: 'Pane' as const, requestId: 'claudesama-book', props: { title: 'Claude-sama', isFocused: true, bodyColumns: 42, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
type State = 'own' | 'stock' | 'custom' | 'unknown'

function fake(os: 'macos' | 'linux' | 'other' = 'macos') {
  const calls: { argv: readonly string[]; options: unknown }[] = []
  let state: State = 'stock', exitCode = 0, unavailable = false, redraws = 0
  const engine = {
    plugin: { root: "/tmp/plugin's folder" },
    env: { get: async () => undefined },
    fs: { exists: async (path: string) => path === '/System/Library/CoreServices/SystemVersion.plist' ? os === 'macos' : path === '/proc/sys/kernel/ostype' && os === 'linux' },
    process: { run: async (argv: readonly string[], options: unknown) => { calls.push({ argv, options }); if (unavailable) throw new Error('process missing'); return { exitCode, stdout: `icon: ${state}\n`, stderr: '' } } },
  } as unknown as EngineInterface
  return { engine, calls, redraw: () => { redraws += 1 }, get redraws() { return redraws }, set state(value: State) { state = value }, set exit(value: number) { exitCode = value }, set unavailable(value: boolean) { unavailable = value } }
}

describe('icon status and button presses', () => {
  test('machine answers never infer an icon from human or ambiguous output', () => {
    for (const value of ['own', 'stock', 'custom', 'unknown'] as const) expect(iconReport(`icon: ${value}\n`)).toBe(value)
    for (const value of ['State: custom', 'Done.', 'icon: own\nicon: stock', 'icon: other', '', 'prefix\nicon: own']) expect(iconReport(value)).toBe('unknown')
  })
  for (const os of ['macos', 'linux'] as const) test(`${os}: argv stays literal and a press uses the shipped script`, async () => {
    const f = fake(os), c = new IconBook()
    await runIcon(f.engine, c, 'status', f.redraw)
    expect(c.data()).toEqual({ state: 'stock', busy: undefined, unavailable: false, failed: false })
    f.state = 'own'; await runIcon(f.engine, c, 'apply', f.redraw)
    f.state = 'stock'; await runIcon(f.engine, c, 'clear', f.redraw)
    expect(f.calls.map(call => call.argv)).toEqual(['status', 'apply', 'clear'].map(action => ['sh', `/tmp/plugin's folder/bin/icon-${os}.sh`, action, '--report', ...(os === 'linux' && action !== 'status' ? ['--replace-custom'] : [])]))
    expect(f.calls.every(call => JSON.stringify(call.options) === '{"timeoutMs":30000}')).toBe(true)
  })
  test('missing process and unsupported platforms show fallback without running another tool', async () => {
    const f = fake(), c = new IconBook()
    f.engine.process = undefined as never
    await runIcon(f.engine, c, 'apply', f.redraw)
    expect(f.calls).toEqual([]); expect(c.data().unavailable).toBe(true); expect(c.state).toBe('unknown')
    const other = fake('other'), d = new IconBook()
    await runIcon(other.engine, d, 'status', other.redraw)
    expect(other.calls).toEqual([]); expect(d.data().unavailable).toBe(true)
  })
  test('failures and unchanged icons remain truthful; a later success recovers', async () => {
    const f = fake(), c = new IconBook()
    f.exit = 1; f.state = 'custom'; await runIcon(f.engine, c, 'apply', f.redraw)
    expect(c.failed).toBe(true); expect(c.state).toBe('custom')
    f.exit = 0; await runIcon(f.engine, c, 'clear', f.redraw)
    expect(c.failed).toBe(true); expect(c.state).toBe('custom')
    f.state = 'own'; await runIcon(f.engine, c, 'apply', f.redraw)
    expect(c.failed).toBe(false); expect(c.unavailable).toBe(false); expect(c.changed).toBe(true)
    f.unavailable = true; await runIcon(f.engine, c, 'clear', f.redraw)
    expect(c.failed).toBe(true); expect(c.unavailable).toBe(true); expect(c.state).toBe('unknown')
  })
  test('one running press excludes all duplicates and stale completion cannot change a reopened book', async () => {
    const f = fake(), c = new IconBook()
    let finish: ((result: unknown) => void) | undefined
    f.engine.process.run = (() => new Promise(resolve => { finish = resolve })) as never
    const first = runIcon(f.engine, c, 'apply', f.redraw)
    // Advance promise microtasks until the injected script is held.
    for (let i = 0; i < 8 && !finish; i++) await Promise.resolve()
    expect(c.busy).toBe('apply'); expect(finish).toBeDefined()
    await runIcon(f.engine, c, 'clear', f.redraw)
    c.forget(); finish?.({ exitCode: 0, stdout: 'icon: own\n', stderr: '' }); await first
    expect(c.state).toBe('unknown'); expect(c.busy).toBeUndefined()
  })

  test('a new explicit Settings visit during an old run queues one fresh status', async () => {
    const f = fake(), c = new IconBook()
    let finish: ((result: unknown) => void) | undefined
    let runs = 0
    f.engine.process.run = (() => { runs += 1; return runs === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ exitCode: 0, stdout: 'icon: custom\n', stderr: '' }) }) as never
    const first = runIcon(f.engine, c, 'status', f.redraw)
    for (let i = 0; i < 8 && !finish; i++) await Promise.resolve()
    c.forget()
    await runIcon(f.engine, c, 'status', f.redraw)
    finish?.({ exitCode: 0, stdout: 'icon: own\n', stderr: '' }); await first
    expect(runs).toBe(2); expect(c.state).toBe('custom'); expect(c.busy).toBeUndefined()
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    for (const state of ['own', 'stock', 'custom'] as const) test(`${surface}: ${state} status, warning, press and redraw`, async ($, on) => {
      let current: State = state
      const calls: string[][] = []
      on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') }))
      on('process.run', ($, e) => { calls.push([...e.argv]); if (e.argv[2] === 'apply') current = 'own'; if (e.argv[2] === 'clear') current = 'stock'; return { value: { exitCode: 0, stdout: `icon: ${current}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
      const w = world(on, { store: RECENT })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      const words = JSON.parse(BOOK_FILES['en.json']).settings.icon
      expect(await ui.find({ type: 'Text', text: words[state] })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: words.help })).toBeUndefined()
      if (state === 'custom') expect(await ui.find({ type: 'Text', text: words.replace })).toBeDefined()
      else expect(await ui.find({ type: 'Text', text: words.replace })).toBeUndefined()
      const actions = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('claudesama:icon:'))
      expect(actions.map(b => b.key)).toEqual(['claudesama:icon:apply', 'claudesama:icon:clear'])
      expect(actions.every(b => !b.props.hotkey)).toBe(true)
      expect(calls.map(call => call[2])).toEqual(['status'])
      await ui.redraw(); await w.clock.advance(60_000); await ui.redraw()
      expect(calls.map(call => call[2])).toEqual(['status']) // render and timers run no script
      await ui.press({ key: 'claudesama:icon:apply' }); await w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: words.own })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: words.help })).toBeDefined()
      await ui.press({ key: 'claudesama:icon:clear' }); await w.clock.advance(0); await ui.redraw()
      expect(await ui.find({ type: 'Text', text: words.stock })).toBeDefined()
      expect(calls.map(call => call[2])).toEqual(['status', 'apply', 'clear'])
    })
    test(`${surface}: thrown process shows command fallback and no pretend buttons`, async ($, on) => {
      on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') }))
      on('process.run', () => { throw new Error('missing process') })
      world(on, { store: RECENT })
      await $.session.start(START)
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface, ...PANE })
      expect(await ui.find({ type: 'Text', text: 'Try /claudesama:icon apply or clear.' })).toBeDefined()
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('claudesama:icon:'))).toEqual([])
    })
  }
  test('all twelve languages label both actions and all three icon states natively', { timeoutMs: 60_000 }, async ($, on) => {
    on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: 'icon: custom\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    world(on, { store: RECENT })
    await $.session.start(START)
    for (const { code } of LANGS) {
      await $.command.run({ command: 'claudesama', args: `lang ${code}`, origin: PERSON, presentation: P })
      await $.command.run({ command: 'claudesama', args: 'settings', origin: PERSON, presentation: P })
      const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
      const words = JSON.parse(BOOK_FILES[`${code}.json`]).settings.icon
      expect(await ui.find({ type: 'Text', text: words.custom })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: words.replace })).toBeDefined()
      expect(await ui.find({ key: 'claudesama:icon:apply' })).toBeDefined()
      expect((await ui.find({ key: 'claudesama:icon:apply' }))?.props.label).toBe(words.apply)
      expect((await ui.find({ key: 'claudesama:icon:clear' }))?.props.label).toBe(words.clear)
      for (const key of ['own', 'stock', 'custom', 'apply', 'clear', 'replace']) expect(words[key].trim().length).toBeGreaterThan(0)
      if (code !== 'en') expect(words.apply).not.toBe('Put on his icon')
      await ui.unmount()
    }
  })
})
