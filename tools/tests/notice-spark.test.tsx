// SPARK: his spark beside a comment he liked, through the plugin's real hooks. The reader itself has Bun
// coverage (tools/tests/algo/notice-comment.test.ts); here the worker answers with controlled envelopes
// and the rows, caps, words and persistence are checked as the engine drives them.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { P, PERSON, RECENT, settleLegacyStart, world } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'

const WORDS = JSON.parse(C3_WORDS_RAW)
const ROOT = '/tmp/spark'
const START = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true }
const ENGINE = { type: 'engine', ref: 0 }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const QUOTE = 'Hold the lock while copying, otherwise a…'
type Node = { type?: string; props?: Record<string, any>; children?: Node[] }

const EDIT = (file = ROOT + '/src/auth/refresh.ts') => ({ result: { filePath: file, oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [{ oldStart: 40, oldLines: 0, newStart: 40, newLines: 2, lines: ['+// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.', '+lock()'] }], userModified: false, replaceAll: false } })
const READ = (file = ROOT + '/src/session.ts') => ({ result: { type: 'text', file: { filePath: file, content: '// Hold the lock while copying, otherwise a concurrent flush can free the buffer under us.\nlock()\n', numLines: 2, startLine: 88, totalLines: 100 } } })

function fixture(on: On, options: { tools?: Record<string, ReturnType<typeof EDIT>> | ((tool: string) => ReturnType<typeof EDIT> | undefined); answer?: (request: any) => any; env?: Record<string, string>; theme?: string; store?: Record<string, unknown> } = {}) {
  const requests: any[] = [], writes: { key: string; value: unknown }[] = []
  on('store.*', ($, e, next) => { if (next.is('store.set', e)) writes.push({ key: e.key, value: e.value }); return next(e) })
  on('process.run', ($, e) => {
    if (e.argv[1]?.endsWith('notice-worker.mjs')) {
      const request = JSON.parse(e.init?.stdin ?? '{}')
      requests.push(request)
      const result = options.answer ? options.answer(request) : { line: request.mode === 'read' ? 88 : 40, quote: QUOTE }
      return { value: { ...OK, stdout: JSON.stringify({ ok: true, result }) } }
    }
    return { value: OK }
  })
  const w = world(on, { sessionRoot: ROOT, store: { ...RECENT, ...options.store }, engineRows: true, theme: options.theme, env: options.env, toolResult: tool => (typeof options.tools === 'function' ? options.tools(tool) : options.tools?.[tool]) })
  return { w, requests, writes }
}

async function begin($: any, f: ReturnType<typeof fixture>, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' = 'desktop') {
  await $.session.start({ ...START, surface })
  await settleLegacyStart($, f.w)
  await $.turn.start({ text: 'work', turnId: 't1' })
}
async function edit($: any, f: ReturnType<typeof fixture>, id: string, tool = 'Edit') {
  await $.tool.call({ tool, file_path: ROOT + '/src/auth/refresh.ts', tool_use_id: id })
  await f.w.clock.advance(0)
  await f.w.clock.advance(0)
}
const rowProps = (id: string, tool = 'Edit', extra: Record<string, unknown> = {}) => ({
  plugin: 'coco', component: 'ToolUse' as const, requestId: id,
  props: { tool_use_id: id, tool, input: { file_path: ROOT + '/src/auth/refresh.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok', ...extra },
})
const drawn = async ($: any, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', props: any, columns = 100) => {
  const row = await $.ui.mount({ surface, ...props, viewport: { columns, rows: 48 } })
  const tree = (await row.drawn()) as Node
  await row.unmount()
  return tree
}
const flat = (node: unknown): Node[] => { const n = node as Node; return n ? [n, ...(n.children ?? []).flatMap(flat)] : [] }
const texts = (node: unknown): string => flat(node).map(n => (typeof (n as any) === 'string' ? (n as any) : '')).join('')
const strings = (node: any): string[] => (typeof node === 'string' ? [node] : node && typeof node === 'object' ? (node.children ?? []).flatMap(strings) : [])

describe('the spark on a row that holds a comment he liked', () => {
  test('desktop: one keyed mark in the left margin with the slip beside it, his words in the alt', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    const tree = await drawn($, 'desktop', rowProps('toolu_1'))
    expect(tree.type).toBe('Box')
    expect(tree.children?.[0]).toEqual(ENGINE)
    const mark = tree.children?.[1]!
    expect(mark.props).toMatchObject({ key: 'coco:spark:toolu_1', position: 'absolute', left: -2, top: 0 })
    const svg = flat(mark).find(n => n.type === 'Svg')!
    expect(svg.props?.alt).toBe(`Coco liked a comment in refresh.ts, line 40: "${QUOTE}"`)
    expect(String(svg.props?.source)).toContain('prefers-contrast:more')
    expect(String(svg.props?.source)).toContain('forced-color-adjust:none')
    const slip = flat(mark).find(n => n.props?.display === 'none')!
    expect((slip as any).hover).toEqual({ display: 'flex' })
    expect(strings(slip)).toEqual([WORDS['spark.head'].en, 'refresh.ts:40', `“${QUOTE}”`])
    expect(slip.props?.top).toBeLessThan(0)
  })

  test('the first draw after the verdict grows the spark in; every later draw is still', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    const source = async () => String(flat(await drawn($, 'desktop', rowProps('toolu_1'))).find(n => n.type === 'Svg')!.props?.source)
    const first = await source(), later = await source()
    expect(first).toContain('@keyframes')
    expect(first).toContain('prefers-reduced-motion')
    expect(later).not.toContain('@keyframes')
    expect(first.match(/<path /g)?.length).toBe(8)
  })

  test('VS Code and the phone: the mark at the right edge, the row given room; the phone has no slip', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f, 'vscode')
    await edit($, f, 'toolu_1')
    const code = await drawn($, 'vscode', rowProps('toolu_1'))
    expect(code.props).toMatchObject({ paddingRight: 2 })
    expect(code.children?.[1]?.props).toMatchObject({ position: 'absolute', right: 0, top: 0 })
    expect(flat(code).some(n => n.props?.display === 'none')).toBe(true)
    const phone = await drawn($, 'mobile', rowProps('toolu_1'))
    expect(flat(phone).some(n => n.props?.display === 'none')).toBe(false)
    expect(flat(phone).find(n => n.type === 'Svg')?.props?.alt).toContain('line 40')
  })

  test('the slip opens below the mark when the row is the first one in view', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    const below = await drawn($, 'desktop', rowProps('toolu_1', 'Edit', { onScreen: { first: 0, last: 4, of: 5 } }))
    expect(flat(below).find(n => n.props?.display === 'none')?.props?.top).toBeGreaterThan(0)
  })

  test('terminal: ✲ file:line at the right margin in his accent, the row given room; the glyph alone under 40 columns', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, theme: 'light' })
    await begin($, f, 'terminal')
    await edit($, f, 'toolu_1')
    const wide = await drawn($, 'terminal', rowProps('toolu_1'), 96)
    const mark = flat(wide).find(n => n.props?.position === 'absolute')!
    expect(mark.props).toMatchObject({ right: 0, top: 0 })
    const label = flat(mark).find(n => n.type === 'Text')!
    expect(label.props?.color).toBe('#9E4123')
    expect(strings(label)).toEqual(['✲ refresh.ts:40'])
    expect(wide.props?.paddingRight).toBe(['✲ refresh.ts:40'][0]!.length + 1)
    const narrow = await drawn($, 'terminal', rowProps('toolu_1'), 30)
    expect(strings(flat(narrow).find(n => n.props?.position === 'absolute'))).toEqual(['✲'])
  })

  test('terminal on an ANSI theme draws the mark in bold and no colour of ours', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, theme: 'dark-ansi' })
    await begin($, f, 'terminal')
    await edit($, f, 'toolu_1')
    const label = flat(await drawn($, 'terminal', rowProps('toolu_1'), 96)).find(n => n.type === 'Text')!
    expect(label.props?.color).toBeUndefined()
    expect(label.props?.bold).toBe(true)
  })

  test('screen-reader mode: no glyph, his words on a row of their own', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, env: { LANG: 'en_US.UTF-8', TERM: 'xterm-256color', CLAUDE_AX_SCREEN_READER: '1' } })
    await begin($, f, 'terminal')
    await edit($, f, 'toolu_1')
    const tree = await drawn($, 'terminal', rowProps('toolu_1'), 96)
    expect(flat(tree).some(n => n.props?.position === 'absolute')).toBe(false)
    expect(strings(tree).join('')).toContain('Coco liked a comment in refresh.ts, line 40')
  })

  test('a Read: the folded group carries the mark; the unfolded group and the Read\'s own row never both', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ() } })
    await begin($, f)
    await $.tool.call({ tool: 'Read', file_path: ROOT + '/src/session.ts', tool_use_id: 'toolu_r1' })
    await f.w.clock.advance(0); await f.w.clock.advance(0)
    const call = { tool_use_id: 'toolu_r1', tool: 'Read', input: { file_path: ROOT + '/src/session.ts' }, isRunning: false, isErrored: false, isInterrupted: false }
    const folded = await drawn($, 'desktop', { plugin: 'coco', component: 'ToolGroup', props: { calls: [call], isActive: false, isExpanded: false } })
    expect(flat(folded).find(n => n.type === 'Svg')?.props?.alt).toContain('session.ts, line 88')
    const open = await drawn($, 'desktop', { plugin: 'coco', component: 'ToolGroup', props: { calls: [call], isActive: false, isExpanded: true } })
    expect(open).toEqual(ENGINE)
    const own = await drawn($, 'desktop', rowProps('toolu_r1', 'Read'))
    expect(flat(own).find(n => n.type === 'Svg')?.props?.alt).toContain('line 88')
  })
})

describe('what draws nothing', () => {
  test('a row with no verdict, a failed call and marks off are the engine\'s alone', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    expect(await drawn($, 'desktop', rowProps('toolu_other'))).toEqual(ENGINE)
    expect(await drawn($, 'desktop', rowProps('toolu_1', 'Edit', { isErrored: true }))).toEqual(ENGINE)
    await $.command.run({ command: 'coco', args: 'marks off', origin: PERSON, presentation: P })
    expect(await drawn($, 'desktop', rowProps('toolu_1'))).toEqual(ENGINE)
  })

  test('with marks off the worker is never asked', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, store: { marks: 'off' } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    expect(f.requests).toEqual([])
  })

  test('a file outside the folder never reaches the worker or the screen', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT('/etc/hosts') } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    expect(f.requests).toEqual([])
    expect(await drawn($, 'desktop', rowProps('toolu_1'))).toEqual(ENGINE)
  })

  test('the worker saying nothing means no spark', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, answer: () => null })
    await begin($, f)
    await edit($, f, 'toolu_1')
    expect(f.requests.length).toBe(1)
    expect(await drawn($, 'desktop', rowProps('toolu_1'))).toEqual(ENGINE)
  })
})

describe('how often', () => {
  test('one a turn: a second comment in the same turn is not marked and not even read', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    await edit($, f, 'toolu_2')
    expect(f.requests.length).toBe(1)
    expect(await drawn($, 'desktop', rowProps('toolu_2'))).toEqual(ENGINE)
  })

  test('two a session, twenty minutes apart, never the same file twice', async ($, on) => {
    const file = (n: number) => ROOT + `/src/f${n}.ts`
    let n = 1
    const f = fixture(on, { tools: tool => (tool === 'Edit' ? EDIT(file(n)) : undefined), answer: () => ({ line: 40 + n, quote: QUOTE + n }) })
    await begin($, f)
    const turn = async (id: string, minutes: number) => {
      await f.w.clock.advance(minutes * 60_000)
      await $.turn.complete({ turnId: 't' + id, answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
      await $.turn.start({ text: 'again', turnId: 't' + id + 'b' })
      await $.tool.call({ tool: 'Edit', file_path: file(n), tool_use_id: id })
      await f.w.clock.advance(0); await f.w.clock.advance(0)
    }
    await turn('a', 0)
    expect(flat(await drawn($, 'desktop', rowProps('a'))).some(x => x.type === 'Svg')).toBe(true)
    n = 2
    await turn('b', 5)
    expect(await drawn($, 'desktop', rowProps('b'))).toEqual(ENGINE)
    await turn('c', 21)
    expect(flat(await drawn($, 'desktop', rowProps('c'))).some(x => x.type === 'Svg')).toBe(true)
    n = 3
    await turn('d', 60)
    expect(await drawn($, 'desktop', rowProps('d'))).toEqual(ENGINE)
  })
})

describe('kept across a resume', () => {
  test('the row ids are stored when the turn ends, with the line and nothing else', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer', durationMs: 900, isAborted: false })
    await f.w.clock.advance(0)
    const saved = f.writes.filter(x => x.key === 'sparkRows')
    expect(saved.map(x => x.value)).toEqual([[['toolu_1', 40]]])
    expect(JSON.stringify(f.writes)).not.toContain('Hold')
  })

  test('a resumed row shows its spark at once, still, and reads its quote again from the row\'s own result', async ($, on) => {
    const f = fixture(on, { store: { sparkRows: [['toolu_old', 40]] } })
    await begin($, f)
    const props = rowProps('toolu_old', 'Edit', { output: EDIT().result })
    const tree = await drawn($, 'desktop', props)
    const svg = flat(tree).find(n => n.type === 'Svg')!
    expect(String(svg.props?.source)).not.toContain('@keyframes')
    expect(f.requests.length).toBe(1)
    expect(f.requests[0]).toMatchObject({ op: 'comment', mode: 'edit', path: 'src/auth/refresh.ts' })
    expect(strings(flat(await drawn($, 'desktop', props)).find(n => n.props?.display === 'none'))).toContain(`“${QUOTE}”`)
  })
})

describe('words and requests', () => {
  test('the request carries a path inside the folder, never an absolute one, and nothing is logged', async ($, on) => {
    const f = fixture(on, { tools: { Read: READ() } })
    await begin($, f)
    await $.tool.call({ tool: 'Read', file_path: ROOT + '/src/session.ts', tool_use_id: 'toolu_r1' })
    await f.w.clock.advance(0); await f.w.clock.advance(0)
    expect(f.requests[0]).toMatchObject({ op: 'comment', mode: 'read', path: 'src/session.ts', start: 88 })
    expect(JSON.stringify(f.requests[0])).not.toContain(ROOT)
  })

  test('in Chinese the slip and the alt are his Chinese words', async ($, on) => {
    const f = fixture(on, { tools: { Edit: EDIT() }, env: { LANG: 'zh_CN.UTF-8', TERM: 'xterm-256color' } })
    await begin($, f)
    await edit($, f, 'toolu_1')
    const tree = await drawn($, 'desktop', rowProps('toolu_1'))
    expect(flat(tree).find(n => n.type === 'Svg')?.props?.alt).toBe(`小克喜欢refresh.ts第40行的注释: "${QUOTE}"`)
    expect(strings(flat(tree).find(n => n.props?.display === 'none'))[0]).toBe('小克喜欢这条')
  })
})
