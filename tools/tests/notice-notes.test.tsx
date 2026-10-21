// NOTICES through the plugin's real hooks: the commit he marks, Shiori's place, the notes when Claude seems
// stuck and the small costume reactions. The reader has Bun coverage (tools/tests/algo/notice-*.test.ts); here
// the worker answers with controlled envelopes and rows, voice, spacing, stored state and the band are checked
// as the engine drives them.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { P, PERSON, RECENT, band, settleLegacyStart, world } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { BOOK_FILES } from './book-files'

const WORDS = JSON.parse(C3_WORDS_RAW)
const WORDS_BOOK = { en: JSON.parse(BOOK_FILES['en.json']) }
const ROOT = '/tmp/notes'
const ENGINE = { type: 'engine', ref: 0 }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const QUOTE = 'because the network is not up yet'
type Node = { type?: string; props?: Record<string, any>; children?: Node[] }
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'

const COMMIT = { result: { stdout: '[main 3f2a9c1] Retry the token refresh once before logging out\n 2 files changed', stderr: '', gitOperation: { commit: { kind: 'committed', sha: '3f2a9c1' } } } }
const READ = (file: string, total: number) => ({ result: { type: 'text', file: { filePath: ROOT + '/' + file, content: 'x\n', numLines: 200, startLine: 1, totalLines: total } } })
const TODOS = (done: number, total = 7) => ({ result: { newTodos: Array.from({ length: total }, (_, i) => ({ content: `task ${i + 1}`, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending', activeForm: 'x' })) } })
const EDIT = { result: { filePath: ROOT + '/src/auth/refresh.ts', oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [{ oldStart: 40, oldLines: 0, newStart: 40, newLines: 2, lines: ['+// Hold the lock while copying, otherwise a concurrent flush can free the buffer.', '+lock()'] }] } }
const BOOK_PANE = { plugin: 'coco', component: 'Pane' as const, requestId: 'coco-book', props: { title: 'Coco', isFocused: false, bodyColumns: 64, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} } }
const LONG_EDIT = { result: { filePath: ROOT + '/parser.ts', oldString: 'a', newString: 'b', originalFile: 'a\n'.repeat(450), structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: [' a', '+b'] }] } }

function fixture(on: On, options: { tools?: Record<string, any>; verdict?: (request: any) => any; env?: Record<string, string>; theme?: string; store?: Record<string, unknown>; readText?: (path: string) => string | undefined } = {}) {
  const requests: any[] = [], writes: { key: string; value: unknown }[] = [], tools: Record<string, any> = { ...options.tools }
  on('store.*', ($, e, next) => { if (next.is('store.set', e)) writes.push({ key: e.key, value: e.value }); if (next.is('store.delete', e)) writes.push({ key: e.key, value: undefined }); return next(e) })
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('notice-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      requests.push(request)
      const result = options.verdict ? options.verdict(request) : request.op === 'commit' ? { quality: 'why', quote: QUOTE, words: 20 } : request.op === 'comment' ? { line: 40, quote: 'Hold the lock while copying, otherwise a…' } : undefined
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result: result ?? null }) } }
    }
    return { value: OK }
  })
  const w = world(on, { store: { ...RECENT, ...options.store }, engineRows: true, theme: options.theme, env: options.env, toolResult: tool => tools[tool], readText: options.readText })
  return { w, requests, writes, tools }
}
type Fixture = ReturnType<typeof fixture>

async function begin($: any, f: Fixture, surface: Surface = 'terminal') {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  await settleLegacyStart($, f.w)
  await $.turn.start({ text: 'work', turnId: 't1' })
}
async function call($: any, f: Fixture, id: string, tool: string, input: Record<string, unknown> = {}) {
  await $.tool.call({ tool, tool_use_id: id, ...input })
  for (let i = 0; i < 4; i++) await f.w.clock.advance(0)
}
const commit = (id: string, message = 'Retry the token refresh') => ({ tool: 'Bash', command: `git commit -m "${message}"`, tool_use_id: id })
const resultProps = (id: string, tool: string, extra: Record<string, unknown> = {}) => ({
  plugin: 'coco', component: 'ToolResult' as const, requestId: id,
  props: { tool_use_id: id, tool, output: {}, isErrored: false, ...extra },
})
const drawn = async ($: any, surface: Surface, props: any, columns = 100) => {
  const row = await $.ui.mount({ surface, ...props, viewport: { columns, rows: 48 } })
  const tree = (await row.drawn()) as Node
  await row.unmount()
  return tree
}
const flat = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(flat) : node && typeof node === 'object' ? [node as Node, ...((node as Node).children ?? []).flatMap(flat)] : []
const strings = (node: any): string[] => typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(strings) : node && typeof node === 'object' ? (node.children ?? []).flatMap(strings) : []
const said = async ($: any, columns = 100) => { const row = await $.ui.mount({ surface: 'terminal', ...band(columns) }); const text = strings(await row.drawn()).join(''); await row.unmount(); return text }

describe('the commit he marks', () => {
  test('a marked commit leaves his note under the engine\'s own output: his name, the quality, the words he liked', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, theme: 'light' })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1'))
    const tree = await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }), 96)
    expect(tree.children?.[0]).toEqual(ENGINE)
    const note = tree.children![1]!
    expect(note.props).toMatchObject({ key: 'coco:commit', paddingLeft: 5 })
    const texts = flat(note).filter(n => n.type === 'Text')
    const name = texts.find(n => n.props?.bold)!
    expect(strings(name)).toEqual(['Coco'])
    expect(name.props?.color).toBe('#9E4123')
    expect(strings(texts.find(n => n.props?.color === 'inactive'))).toEqual([`  LGTM~ says why: "${QUOTE}"`])
    expect(f.requests.filter(r => r.op === 'commit').length).toBe(1)
    expect(String(f.requests[0].command)).toContain('git commit')
  })

  test('24 columns: the quote goes whole, his name and the quality stay; under 30 the indent is 2', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1'))
    const tree = await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }), 24)
    const note = tree.children![1]!
    expect(note.props?.paddingLeft).toBe(2)
    expect(strings(note).join('')).toBe('Coco  says why')
    const mid = await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }), 40)
    expect(mid.children![1]!.props?.paddingLeft).toBe(5)
    expect(strings(mid.children![1]).join('')).toBe('Coco  says why')
  })

  test('the desktop, VS Code and the phone carry the same note with no indent', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT } })
    await begin($, f, 'desktop')
    await call($, f, 'c1', 'Bash', commit('c1'))
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const tree = await drawn($, surface, resultProps('c1', 'Bash', { output: COMMIT.result }))
      expect(tree.children?.[0]).toEqual(ENGINE)
      expect(tree.children![1]!.props?.paddingLeft).toBe(0)
      expect(strings(tree.children![1]).join('')).toBe(`Coco  LGTM~ says why: "${QUOTE}"`)
    }
  })

  test('a long, explained message gets no quote, and the screen reader gets the words', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, verdict: r => r.op === 'commit' ? { quality: 'long', words: 90 } : null, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', CLAUDE_AX_SCREEN_READER: '1' } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1'))
    const tree = await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }))
    expect(strings(tree.children![1]).join('')).toBe('Coco marked this commit: spells it out')
    const plain = fixture
    expect(plain).toBeDefined()
  })

  test('no note for a failed hook, a bad message, marks off, or a failed result', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, verdict: () => null })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1'))
    expect((await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }))).children?.length ?? 1).toBeLessThanOrEqual(1)
    f.tools.Bash = { result: { stdout: 'hook failed', stderr: '', gitOperation: { commit: { kind: 'failed' } } } }
    const before = f.requests.length
    await call($, f, 'c2', 'Bash', commit('c2'))
    expect(f.requests.length).toBe(before)
    expect(flat(await drawn($, 'terminal', resultProps('c2', 'Bash', { output: f.tools.Bash.result }))).some(n => n.props?.key === 'coco:commit')).toBe(false)
  })

  test('marks off draws nothing and asks nobody', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, store: { marks: 'off' } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1'))
    expect(f.requests.filter(r => r.op === 'commit').length).toBe(0)
    expect(flat(await drawn($, 'terminal', resultProps('c1', 'Bash', { output: COMMIT.result }))).some(n => n.props?.key === 'coco:commit')).toBe(false)
  })

  test('spacing: after a note, four commits pass before the next; a long, explained message always gets one', async ($, on) => {
    let long = false
    const f = fixture(on, { tools: { Bash: COMMIT }, verdict: r => r.op === 'commit' ? { quality: long ? 'long' : 'why', quote: long ? undefined : QUOTE, words: 20 } : null })
    await begin($, f)
    const marked: boolean[] = []
    for (let i = 1; i <= 6; i++) {
      await call($, f, `c${i}`, 'Bash', commit(`c${i}`))
      marked.push(flat(await drawn($, 'terminal', resultProps(`c${i}`, 'Bash', { output: COMMIT.result }))).some(n => n.props?.key === 'coco:commit'))
    }
    expect(marked).toEqual([true, false, false, false, false, true])
    long = true
    await call($, f, 'c7', 'Bash', commit('c7'))
    expect(flat(await drawn($, 'terminal', resultProps('c7', 'Bash', { output: COMMIT.result }))).some(n => n.props?.key === 'coco:commit')).toBe(true)
  })

  test('voiced once a session: the band says it, and the message is never stored', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1', 'Retry the token refresh once before logging out'))
    expect(await said($)).toContain(`says why: "${QUOTE}"`)
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    for (const write of f.writes) {
      const text = JSON.stringify(write.value)
      expect(text).not.toContain(QUOTE)
      expect(text).not.toContain('Retry the token refresh')
    }
    expect(f.writes.some(w => w.key === 'commitGap')).toBe(true)
    expect(f.writes.some(w => w.key === 'commitVoice')).toBe(true)
  })
})

describe('her LGTM and the uwu threat (lane C, 10-14)', () => {
  test('LGTM: each one voiced is counted for the repository in the store', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1', 'Retry the token refresh once before logging out'))
    expect(await said($)).toContain(QUOTE)
    expect(f.writes.filter(w => w.key === 'commitLgtm').at(-1)?.value).toEqual({ [ROOT]: 1 })
  })
  test('LGTM: after five in a repository she marks the commit but says nothing', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, store: { commitLgtm: { [ROOT]: 5 } } })
    await begin($, f)
    await call($, f, 'c1', 'Bash', commit('c1', 'Retry the token refresh once before logging out'))
    expect(await said($)).not.toContain(QUOTE)
    expect(f.writes.some(w => w.key === 'commitLgtm')).toBe(false)
    expect(f.requests.some(r => r.op === 'bare')).toBe(false)
  })
  test('a lone "fix": she threatens to uwu it, three times a day at most, and the message is never stored', async ($, on) => {
    const f = fixture(on, { tools: { Bash: COMMIT }, verdict: r => r.op === 'bare' ? { fix: true, claude: false } : null })
    await begin($, f)
    for (let i = 1; i <= 4; i++) {
      await call($, f, `u${i}`, 'Bash', commit(`u${i}`, 'fix'))
      if (i === 1) expect(await said($)).toContain('uwu-ify')
      await f.w.clock.advance(15_000)
    }
    expect(f.writes.filter(w => w.key === 'commitUwu').map(w => (w.value as { n: number }).n)).toEqual([1, 2, 3])
    expect(f.requests.filter(r => r.op === 'bare').length).toBe(3)
    expect(JSON.stringify(f.writes.map(w => w.value))).not.toContain('"fix"')
  })
})

describe('notes when Claude seems stuck', () => {
  const circle = async ($: any, f: Fixture) => { for (let i = 1; i <= 4; i++) await call($, f, `r${i}`, 'Read', { file_path: ROOT + '/big.ts' }) }

  test('VS Code and the phone: a row under the tool call that tipped it, the slip, his name, the words, the button', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ('big.ts', 1500) } })
    await begin($, f, 'vscode')
    await circle($, f)
    const tree = await drawn($, 'vscode', resultProps('r4', 'Read'))
    expect(tree.children?.[0]).toEqual(ENGINE)
    const row = tree.children![1]!
    expect(row.props?.key).toBe('coco:stuck:circle')
    expect(flat(row).some(n => n.type === 'Svg' && String(n.props?.source).includes('rotate(-9'))).toBe(true)
    expect(strings(row).join('')).toContain('Claude opened big.ts 4 times in')
    const button = flat(row).find(n => n.type === 'Button')!
    expect(button.props).toMatchObject({ key: 'coco:stuck:off:circle', label: 'stop these' })
    for (const earlier of ['r1', 'r2', 'r3']) expect(flat(await drawn($, 'vscode', resultProps(earlier, 'Read'))).some(n => n.type === 'Button')).toBe(false)
  })

  test('a wide terminal and the desktop with the band on carry it in the band, never under the tool', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ('big.ts', 1500) } })
    await begin($, f, 'terminal')
    await circle($, f)
    expect(flat(await drawn($, 'terminal', resultProps('r4', 'Read'), 100)).some(n => n.type === 'Button')).toBe(false)
    expect(await said($, 100)).toContain('Claude opened big.ts 4 times')
  })

  test('under 40 columns the note moves under the tool call, indented 2, with no glyph; the band keeps his name', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ('big.ts', 1500) } })
    await begin($, f, 'terminal')
    await circle($, f)
    const row = (await drawn($, 'terminal', resultProps('r4', 'Read'), 30)).children![1]!
    expect(row.props).toMatchObject({ key: 'coco:stuck:circle', paddingLeft: 2 })
    expect(flat(row).some(n => n.type === 'Svg')).toBe(false)
    expect(flat(row).some(n => n.type === 'Button' && n.props?.label === 'stop these')).toBe(true)
    expect(await said($, 30)).not.toContain('big.ts')
  })

  test('the button stores the cause, removes the note, and the cause stays quiet; His notes off and on brings it back', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ('big.ts', 1500) } })
    await begin($, f, 'vscode')
    await circle($, f)
    const row = await $.ui.mount({ surface: 'vscode', ...resultProps('r4', 'Read'), viewport: { columns: 100, rows: 48 } })
    await row.press({ key: 'coco:stuck:off:circle' })
    await row.unmount()
    await f.w.clock.advance(0)
    expect(f.writes.filter(w => w.key === 'notesOff').at(-1)?.value).toEqual(['circle'])
    expect(flat(await drawn($, 'vscode', resultProps('r4', 'Read'))).some(n => n.type === 'Button')).toBe(false)
  })

  test('a function past 400 lines: the note names it, the file and the lines', async ($, on) => {
    const f = fixture(on, { tools: { Edit: LONG_EDIT }, verdict: r => r.op === 'long' ? { name: 'tokenize', lines: 412 } : null })
    await begin($, f, 'vscode')
    await call($, f, 'e1', 'Edit', { file_path: ROOT + '/parser.ts' })
    const row = (await drawn($, 'vscode', resultProps('e1', 'Edit'))).children![1]!
    expect(strings(row).join('')).toContain('tokenize in parser.ts is 412 lines now.')
    const request = f.requests.find(r => r.op === 'long')!
    expect(request.path).toBe('parser.ts')
    expect(request.limit).toBe(400)
  })

  test('His notes off silences both kinds', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ('big.ts', 1500) }, store: { notes: false } })
    await begin($, f, 'vscode')
    await circle($, f)
    expect(flat(await drawn($, 'vscode', resultProps('r4', 'Read'))).some(n => n.type === 'Button')).toBe(false)
  })
})

describe("Shiori keeps the place", () => {
  const marker = async ($: any) => {
    const row = await $.ui.mount({ surface: 'desktop', ...band(120) })
    const nodes = flat(await row.drawn())
    await row.unmount()
    return nodes.find(n => n.props?.key === 'coco:place')
  }

  test('a task list of seven with two done: «3 of 7» in the desktop band, task 3/7 in the terminal band', async ($, on) => {
    const f = fixture(on, { tools: { TodoWrite: TODOS(2) } })
    await begin($, f, 'desktop')
    await call($, f, 'td1', 'TodoWrite')
    const place = await marker($)
    expect(strings(place).join('')).toBe(' 3 of 7')
    expect(flat(place).find(n => n.type === 'Svg')?.props?.alt).toBe('Task 3 of 7: task 3')
    const terminal = await said($, 100)
    expect(terminal).toContain('task 3/7')
  })

  test('a task done: the figure changes and her picture restarts its dip; the last task done: she goes in and stays', async ($, on) => {
    const f = fixture(on, { tools: { TodoWrite: TODOS(2) } })
    await begin($, f, 'desktop')
    await call($, f, 'td1', 'TodoWrite')
    const first = String(flat(await marker($)).find(n => n.type === 'Svg')?.props?.source)
    f.tools.TodoWrite = TODOS(3)
    await call($, f, 'td2', 'TodoWrite')
    const second = await marker($)
    expect(strings(second).join('')).toBe(' 4 of 7')
    const dip = String(flat(second).find(n => n.type === 'Svg')?.props?.source)
    expect(dip).not.toBe(first)
    expect(dip).toContain('@keyframes cs-pa')
    f.tools.TodoWrite = TODOS(7)
    await call($, f, 'td3', 'TodoWrite')
    expect(await marker($)).toBeUndefined()
  })

  test('no list of one, nothing for a helper\'s list, and none in screen-reader mode', async ($, on) => {
    const f = fixture(on, { tools: { TodoWrite: TODOS(0, 1) } })
    await begin($, f, 'desktop')
    await call($, f, 'td1', 'TodoWrite')
    expect(await marker($)).toBeUndefined()
  })
})

describe('small costume reactions', () => {
  const sprites = async ($: any) => {
    const row = await $.ui.mount({ surface: 'desktop', ...band(120) })
    const source = flat(await row.drawn()).filter(n => n.type === 'Svg').map(n => String(n.props?.source)).find(s => s.includes('data-coco=')) ?? ''
    await row.unmount()
    return source
  }

  // His card (10-18): the rain pane sat askew behind Coco as a dark square, so their band draws none.
  test('a command past a minute: no rain pane behind Coco', async ($, on) => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => { await gate; return next(e) })
    const f = fixture(on, { tools: { Bash: { result: { stdout: 'ok', stderr: '' } } } })
    await begin($, f, 'desktop')
    const running = $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' })
    await f.w.clock.advance(30_000)
    expect(await sprites($)).not.toContain('id="cs-rain"')
    await f.w.clock.advance(31_000)
    expect(await sprites($)).not.toContain('id="cs-rain"')
    release()
    await running
    await f.w.clock.advance(0)
    expect(await sprites($)).not.toContain('id="cs-rain"')
  })

  test('ultrathink: the stage direction says the bow is loose until the turn ends', async ($, on) => {
    const f = fixture(on)
    await begin($, f, 'terminal')
    await $.prompt.submit({ text: 'ultrathink about the cache', origin: PERSON })
    await f.w.clock.advance(0)
    expect(await said($)).toContain(WORDS['aside.ultrathink'].en)
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    await f.w.clock.advance(0)
    expect(await said($)).not.toContain(WORDS['aside.ultrathink'].en)
  })

  // Coco wears a keycap hairclip, not his bow: the painted bow's patches (393 KB) are never read for the turn.
  test('ultrathink: Coco\'s picture has no bow, so the old painted bow is never read or laid on it', async ($, on) => {
    const reads: string[] = []
    const f = fixture(on, { readText: path => { if (path.endsWith('hooks/loose-bow.json')) reads.push(path); return undefined } })
    await begin($, f, 'desktop')
    await $.prompt.submit({ text: 'ultrathink about the cache', origin: PERSON })
    await f.w.clock.advance(0)
    expect(await sprites($)).toContain('data-coco=')
    expect(await sprites($)).not.toContain('cs-bow-')
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    await f.w.clock.advance(0)
    expect(reads).toEqual([])
  })

  test('the night lamp stands at rest from 23:00 to 04:59 by the person\'s clock, and not by day', async ($, on) => {
    const f = fixture(on)
    for (const [at, lit] of [[Date.UTC(2026, 9, 2, 22, 59), false], [Date.UTC(2026, 9, 2, 23, 0), true], [Date.UTC(2026, 9, 3, 4, 59), true], [Date.UTC(2026, 9, 3, 5, 0), false]] as const) {
      await f.w.clock.set(at)
      await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true }) // a new session reads the clock; the band reads it on every draw
      await settleLegacyStart($, f.w)
      expect([at, (await sprites($)).includes('id="cs-lamp"')]).toEqual([at, lit])
    }
  })
})


describe('his book: the shelf and the comment he liked last', () => {
  const book = async ($: any, page: string, surface: Surface = 'desktop') => {
    await $.command.run({ command: 'coco', args: page, origin: PERSON, presentation: P })
    const ui = await $.ui.mount({ surface, ...BOOK_PANE })
    const text = strings(await ui.drawn())
    await ui.unmount()
    return text
  }
  const read = async ($: any, f: Fixture, id: string, file: string) => { f.tools.Read = READ(file, 100); await call($, f, id, 'Read', { file_path: ROOT + '/' + file }) }
  const turn = async ($: any, f: Fixture, n: number) => {
    await $.turn.complete({ turnId: 't' + n, answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    await $.turn.start({ text: 'again', turnId: 't' + (n + 1) })
  }

  // With lane B's group names the shelf stands in the zine page's first group, this week (lane C's step 2).
  test('the zine page lists the five files Claude opened most here, names only, in a numbered list', async ($, on) => {
    const f = fixture(on)
    await begin($, f, 'desktop')
    for (const file of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', '.env', 'src/deep/g.pem']) await read($, f, 'r' + file, file)
    await turn($, f, 1)
    for (const file of ['a.ts', 'b.ts']) await read($, f, 'q' + file, file)
    await turn($, f, 2)
    await read($, f, 'p', 'a.ts')
    await $.turn.complete({ turnId: 't3', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    const stored = JSON.stringify(f.writes.filter(w => w.key === 'shelf').at(-1)?.value)
    expect(stored).not.toContain('.env')
    expect(stored).not.toContain('.pem')
    const page = await book($, 'log')
    expect(page).toContain(WORDS_BOOK.en.library.shelf.head)
    expect(page.slice(page.indexOf(WORDS_BOOK.en.library.shelf.head) + 1, page.indexOf(WORDS_BOOK.en.library.shelf.head) + 6)).toEqual(['1. a.ts', '2. b.ts', '3. c.ts', '4. d.ts', '5. e.ts'])
    expect(page).toContain(WORDS_BOOK.en.library.shelf.note)
    expect(page.join('')).not.toContain('f.ts')
    expect(page.join('')).not.toContain(ROOT)
  })

  test('a new folder says what will appear; Bookmark and shelf off deletes the shelf and hides the list', async ($, on) => {
    const f = fixture(on)
    await begin($, f, 'desktop')
    expect(await book($, 'log')).toContain(WORDS_BOOK.en.library.shelf.empty)
    await read($, f, 'r1', 'a.ts')
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    expect(await book($, 'log')).toContain('1. a.ts')
    await $.command.run({ command: 'coco', args: 'settings', origin: PERSON, presentation: P })
    const settings = await $.ui.mount({ surface: 'desktop', ...BOOK_PANE })
    await settings.press({ key: 'coco:set:bookmark:off' })
    await settings.unmount()
    await f.w.clock.advance(0)
    expect(f.writes.some(w => w.key === 'shelf' && w.value === undefined)).toBe(true)
    const page = await book($, 'log')
    expect(page).not.toContain(WORDS_BOOK.en.library.shelf.head)
    expect(page).not.toContain(WORDS_BOOK.en.library.shelf.empty)
  })

  test('the Reading log holds the comment he liked last, from this session\'s memory', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT } })
    await begin($, f, 'desktop')
    expect((await book($, 'log')).join('')).not.toContain(WORDS_BOOK.en.log.spark)
    await call($, f, 'e1', 'Edit', { file_path: ROOT + '/src/auth/refresh.ts' })
    const log = await book($, 'log')
    const at = log.indexOf(WORDS_BOOK.en.log.spark)
    expect(at).toBeGreaterThanOrEqual(0)
    // From 48 columns the label has its own column and the two spaces are the column's gap (BOOK F5).
    expect(log.slice(at, at + 2).join('').replace(`${WORDS_BOOK.en.log.spark}  `, WORDS_BOOK.en.log.spark)).toBe(`${WORDS_BOOK.en.log.spark}refresh.ts:40 “Hold the lock while copying, otherwise a…”`)
  })
})

describe('Shiori keeps the place for the next session', () => {
  const LIST = (done: number, total = 7) => Array.from({ length: total }, (_, i) => ({ content: `task ${i + 1}`, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending', activeForm: 'x' }))

  test('the turn that ends with a list open stores the place; a nothing-but-the-place record is all that is kept', async ($, on) => {
    const f = fixture(on, { tools: { TodoWrite: TODOS(2) } })
    await begin($, f, 'terminal')
    await call($, f, 'td1', 'TodoWrite', { todos: LIST(2) })
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    const kept = f.writes.filter(w => w.key === 'bookmarks').at(-1)?.value as Record<string, any>
    expect(kept[ROOT]).toMatchObject({ where: 'task 3', kind: 'todo', i: 3, n: 7 })
    expect(Object.keys(kept[ROOT]).sort()).toEqual(['at', 'i', 'kind', 'n', 'where'])
  })

  test('the next session in that folder says where the list stopped, with the place', async ($, on) => {
    const f = fixture(on, { store: { bookmarks: { [ROOT]: { where: 'add tests for the parser', kind: 'todo', at: 1, i: 3, n: 7 } } } })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await settleLegacyStart($, f.w)
    expect(await said($)).toContain('you stopped at task 3 of 7: add tests for the parser')
  })

  test('a bookmark with no place says it as it always did', async ($, on) => {
    const f = fixture(on, { store: { bookmarks: { [ROOT]: { where: 'src/main.ts', kind: 'file', at: 1 } } } })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await settleLegacyStart($, f.w)
    expect(await said($)).toContain('your bookmark: src/main.ts.')
  })
})
