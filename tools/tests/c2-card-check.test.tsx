import { CARD_METRICS_TEXT } from './card-metrics-data'
// Wiring contracts only. Every filesystem, clipboard and process operation is mocked.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { presenceWorld, snapshot } from './presence-world'
import { WINDOWS_ROOTS } from './test-system'
import { BOOK_FILES } from './book-files'
import { RECENT, P, PERSON, world, settleLegacyStart, stubPng } from './world'

const HOME = '/tmp/coco-c2-fixture-home', PICTURES = `${HOME}/Pictures`, FOLDER = `${PICTURES}/Coco`
const PNG = 'iVBORw0KGgoAAAANSUhEUgAABDgAAAQ4AQAAAADEa1EiAAAApUlEQVR42u3BMQEAAADCoPVPbQlPoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4Gj3eAAG8D63NAAAAAElFTkSuQmCC'
const PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: true, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const START = { cwd: '/tmp/c2-fixture-project', surface: 'vscode' as const, isInteractive: true }
const WORDS = JSON.parse(BOOK_FILES['en.json']!)
const allText = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(allText).join('') : n && typeof n === 'object' ? allText(n.children ?? []) : ''
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

function fixture(on: On, options: { band?: 'off'; deniedCopy?: boolean } = {}) {
  const state = { pictures: true, failWrite: false, holdWrite: undefined as (() => Promise<void>) | undefined }
  const commands: string[][] = [], writes: string[] = [], toasts: { text: string; timeoutMs?: number }[] = [], copied: string[] = []
  const files = new Map<string, string>()
  on('fs.read', { path: /[\\/]hooks[\\/]card-metrics\.json$/ }, () => ({ value: CARD_METRICS_TEXT }))
  on('fs.exists', ($, e) => ({ value: e.path === '/System/Library/CoreServices/SystemVersion.plist' || files.has(e.path) }))
  on('fs.stat', ($, e) => ({ value: e.path === PICTURES && state.pictures ? { kind: 'dir', size: 0, isLink: false } : files.has(e.path) ? { kind: 'file', size: 512, isLink: false } : { kind: 'missing', size: 0, isLink: false } } as never))
  on('fs.read', { path: /\/Pictures\/Coco\// }, ($, e) => ({ value: { base64: files.get(e.path) ?? stubPng(e.path) } } as never))
  on('fs.write', async ($, e) => {
    expect(e.path.startsWith(`${FOLDER}/`)).toBe(true)
    writes.push(e.path)
    await state.holdWrite?.()
    if (state.failWrite) throw new Error('fixture destination cannot write')
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    commands.push([...e.argv])
    if (e.argv[0] === '/bin/test') return { value: { ...OK, exitCode: state.pictures ? 0 : 1 } }
    if (e.argv[0] === 'qlmanage') { files.set(e.argv.at(-1)! + '.png', PNG); return { value: OK } }
    if (e.argv[0] === 'mv') { files.set(e.argv[4]!, files.get(e.argv[3]!)!); files.delete(e.argv[3]!); return { value: OK } }
    if (e.argv[0] === 'rm') { for (const p of e.argv.slice(3)) files.delete(p); return { value: OK } }
    if (e.argv[0] === 'open') return { value: OK }
    // Existing companion/icon status reads are harmless fixture answers; no process starts.
    return { value: { ...OK, stdout: 'icon: stock\n' } }
  })
  on('ui.*', ($, e, next) => { if (next.is('ui.toast', e)) toasts.push({ text: e.text, timeoutMs: e.timeoutMs }); return next(e) })
  on('ui.copy', ($, e) => { copied.push(e.text); return { value: { isCopied: !options.deniedCopy } } })
  const w = world(on, { store: { ...RECENT, ...(options.band ? { bandSettings: { band: options.band } } : {}) }, surfaces: ['vscode'], env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', HOME }, sessionId: 'c2-fixture' })
  return { w, state, commands, writes, toasts, copied, files }
}

// The day's omen and its share card left with vibe check taking page 3 (owner 10-15). Its five save tests (scratch home
// only with the 8 s toast; Save turning into the saved path and Open folder; a failed save offering Save again; Save
// gone without a writable Pictures folder; a save finishing after navigation) come back with her vibe check's share card.

if (!WINDOWS_ROOTS) for (const deniedCopy of [false, true]) test(`C2 old live session reload copy reports only successful clipboard writes (${deniedCopy ? 'denied' : 'copied'})`, async ($, on) => {
  const copied: string[] = []
  on('ui.copy', ($, e) => { copied.push(e.text); return { value: { isCopied: !deniedCopy } } })
  const f = presenceWorld(on,snapshot(),{withNativePresence:true, remoteBusy: true })
  Object.assign(f.current.claims.remote, { session: 'old-c2', cwd: '/tmp/presence-kit-user/old-project', version: '0.0.1' })
  await $.session.start({ ...START, surface: 'desktop' })
  await f.clock.advance(0)
  for (let i=0;i<80;i++) await $.command.run({ command:'b1b-host-boundary', args:'', origin:PERSON, presentation:P })
  await f.clock.advance(0)
  await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'coco:check:session:old-c2' })).toBeDefined()
  await ui.press({ key: 'coco:check:session:old-c2' }); await ui.redraw()
  expect(copied).toEqual(['/reload-plugins'])
  expect(allText(await ui.drawn()).includes(WORDS.check.copied)).toBe(!deniedCopy)
  await ui.unmount()
})

test('C2 band check Fix uses the existing setting action and removes the wrong row', async ($, on) => {
  const f = fixture(on, { band: 'off' })
  await $.session.start({ ...START, surface: 'terminal' }); await settleLegacyStart($, f.w)
  await $.command.run({ command: 'coco', args: 'band off', origin: PERSON, presentation: P })
  await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'coco:check:band' })).toBeDefined()
  await ui.press({ key: 'coco:check:band' }); await settleLegacyStart($, f.w); await ui.redraw()
  expect(await ui.find({ key: 'coco:check:band' })).toBeUndefined()
  expect(allText(await ui.drawn())).toContain(WORDS.check.ok)
  await ui.unmount()
})
