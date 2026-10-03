import { samePath } from './file-paths'
// The activity feed is exercised through the mod's actual session/tool hooks.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { MORNING, RECENT, band, world } from './world'

const START = { cwd: '/tmp/project', surface: 'terminal' as const, isInteractive: true }
const HOME = '/tmp/activity-test'
const FOLDER = `${HOME}/Library/Application Support/Claude-sama`
const FEED = `${FOLDER}/view.json`
type Record = { project: string; task: string | null; done: number | null; waitAt: number | null; reply: { text: string; at: number } | null; notice: { kind: string; text: string; at: number } | null; ack: string | null; channel: boolean; ended?: boolean }

function feed(on: On, root = '/tmp/project') {
  const records: Record[] = []
  let roots = 0
  on('session.end', () => ({ sessionId: 's1' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => { roots++; return { value: root } })
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', ($, e) => ({ value: samePath(e.path, '/System/Library/CoreServices/SystemVersion.plist') || samePath(e.path, '/usr/bin/tail') || samePath(e.path, FOLDER) || samePath(e.path, `${FOLDER}/requests.jsonl`) }))
  on('fs.write', ($, e) => { if (samePath(e.path, FEED)) records.push(JSON.parse(e.text)); return { value: undefined } })
  on('process.spawn', async function* () { throw new Error('stream unavailable in activity fixture') })
  return { records, latest: () => records[records.length - 1]!, roots: () => roots }
}
function ended(answer: string) { return { answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const } }

 describe('companion task and activity records', () => {
  test('tool boundaries carry localized phrases; programs never expose their arguments', { timeoutMs: 60_000 }, async ($, on) => {
    let current: ReturnType<typeof feed>
    const starts: string[] = []
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' }, onTool: () => starts.push(current.latest().task ?? '') })
    current = feed(on)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(current.latest().task).toBe('thinking')
    const cases = [
      [{ tool: 'Read', file_path: '/private/path/source.ts' }, 'reading source.ts'],
      [{ tool: 'Write', file_path: '/private/path/output.md', content: 'text' }, 'editing output.md'],
      [{ tool: 'Edit', file_path: '/private/path/source.ts', old_string: 'a', new_string: 'b' }, 'editing source.ts'],
      [{ tool: 'NotebookEdit', notebook_path: '/private/path/demo.ipynb', new_source: '1' }, 'editing demo.ipynb'],
      [{ tool: 'Bash', command: 'SECRET=value sudo time nice /usr/local/bin/pytest --secret secret-value' }, 'running pytest'],
      [{ tool: 'Bash', command: 'sudo --user alice time nice -n 5 /opt/bin/node --token private' }, 'running node'],
      [{ tool: 'Bash', command: 'cd "/private/folder name" && A=b /usr/local/bin/python3 -c "private text"' }, 'running python3'],
      [{ tool: 'Bash', command: '/bin/abcdefghijklmnopQRSTUV argument-never-shown' }, 'running abcdefghijklmnop'],
      [{ tool: 'Grep', pattern: 'private search', path: '/tmp' }, 'searching'],
      [{ tool: 'Glob', pattern: '**/*.ts' }, 'searching'],
      [{ tool: 'WebSearch', query: 'private search' }, 'searching the web'],
      [{ tool: 'WebFetch', url: 'https://example.invalid/private', prompt: 'private text' }, 'searching the web'],
      [{ tool: 'Agent', prompt: 'private task', subagent_type: 'general-purpose', description: 'helper' }, 'a helper is working'],
      [{ tool: 'EnterPlanMode' }, 'planning'],
      [{ tool: 'mcp__private_server__inspect_widget', private: 'do not show' }, 'using inspect_widget'],
    ] as const
    for (const [input, expected] of cases) {
      await $.tool.call(input as never)
      expect(starts[starts.length - 1]).toBe(expected)
      expect(current.latest().task).toBe('thinking')
    }
    await $.turn.complete(ended('Done.'))
    expect(current.latest().task).toBe(null)
    expect(current.latest().done).toBe(MORNING)
  })

  test('zh task phrases follow the selected session language', async ($, on) => {
    let current: ReturnType<typeof feed>
    let during = ''
    world(on, { store: RECENT, env: { HOME, LANG: 'zh_CN.UTF-8' }, onTool: () => { during = current.latest().task ?? '' } })
    current = feed(on)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(current.latest().task).toBe('在想')
    await $.tool.call({ tool: 'Read', file_path: '/tmp/README.md' })
    expect(during).toBe('在读README.md')
  })

  test('permission and question waits retain their starting timestamp until resolved', async ($, on) => {
    let current: ReturnType<typeof feed>
    let question: Record | undefined
    const w = world(on, { store: RECENT, ask: true, env: { HOME, LANG: 'en_US.UTF-8' }, onTool: tool => { if (tool === 'AskUserQuestion') question = current.latest() } })
    current = feed(on)
    // A call-bound permission check carries tool_use_id; a standalone query does not.
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.check({ tool: 'Bash', input: { command: 'echo ok' }, tool_use_id: 'main-call' } as never)
    expect(current.latest().task).toBe('waiting for your OK')
    expect(current.latest().waitAt).toBe(MORNING)
    await w.clock.advance(500)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] })
    expect(question?.task).toBe('waiting for your answer')
    expect(question?.waitAt).toBe(MORNING + 500)
    expect(current.latest().task).toBe('thinking')
    expect(current.latest().waitAt).toBe(null)
    await $.turn.complete(ended('Done.'))
    expect(current.latest().task).toBe(null)
  })

  test('project is read once and middle-cut; unchanged state and blinking never write', async ($, on) => {
    const w = world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on, '/tmp/abcdefghijklmnopqrstuvwxyz0123456789')
    await $.session.start(START)
    const project = current.latest().project
    expect(Array.from(project).length).toBe(24)
    expect(project.startsWith('abc')).toBe(true)
    expect(project.endsWith('789')).toBe(true)
    expect(project.includes('…')).toBe(true)
    await $.ui.mount({ surface: 'terminal', ...band(100) })
    const before = current.records.length
    await w.clock.advance(20_000)
    expect(current.records.length).toBe(before)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const running = current.records.length
    await $.session.measure({ changed: ['context'], context: { window: 200000, tokens: 40000, percent: 20 } } as never)
    expect(current.records.length).toBe(running)
    await $.tool.call({ tool: 'Read', file_path: '/tmp/a.ts' })
    expect(current.roots()).toBe(1)
  })

  test('reply excerpt removes Markdown and line breaks while preserving the words and punctuation', async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ended('# A heading!\n- **Bold**, _plain_, `code`.\n[Keep this](https://example.invalid/private)\n```ts\nconst x = 1;\n```'))
    expect(current.latest().reply?.text).toBe('A heading! Bold, plain, code. Keep this const x = 1;')
    expect(current.latest().reply?.at).toBe(MORNING)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ended('😀'.repeat(150)))
    expect(Array.from(current.latest().reply?.text ?? '').length).toBe(140)
    expect(current.latest().reply?.text).toBe('😀'.repeat(140))
    await $.command.run({ command: 'clear', args: '' })
    expect(current.latest().reply).toBe(null)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ended('A final reply.'))
    await $.session.end({ reason: 'prompt_input_exit' } as never)
    expect(current.latest().reply).toBe(null)
    expect(current.latest().task).toBe(null)
  })

  test('helper turn completions do not replace the main loop task or reply', async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on)
    await $.session.start(START)
    await $.turn.start({ text: 'main task', turnId: 'main' })
    const before = current.records.length
    await $.turn.complete({ ...ended('Helper only.'), turnId: 'worker-turn', agentId: 'worker' })
    expect(current.latest().task).toBe('thinking')
    expect(current.latest().reply).toBe(null)
    expect(current.latest().done).toBe(null)
    expect(current.records.length).toBe(before)
  })

  test('CJK emphasis and link URLs preserve Claude punctuation and literal hashes', async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on)
    await $.session.start(START)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete(ended(`## 标题\n**做完了**,保留!\n_日本語_、保留。\nC# and issue #42.\n[链接](https://example.invalid/path_(nested))。`))
    expect(current.latest().reply?.text).toBe('标题 做完了,保留! 日本語、保留。 C# and issue #42. 链接。')
  })

  test('code excerpts retain literal links, nested backticks and Markdown-looking punctuation', async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on)
    await $.session.start(START)
    const cases = [
      ['`[x](y)`', '[x](y)'],
      ['``a ` b``', 'a ` b'],
      ['```md\n[x](y)\n# literal\n**literal**\n```', '[x](y) # literal **literal**'],
    ]
    for (const [answer, expected] of cases) {
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete(ended(answer!))
      expect(current.latest().reply?.text).toBe(expected)
    }
  })

  test('classic notifications retain their kind and a 140-character excerpt', async ($, on) => {
    world(on, { store: RECENT, env: { HOME, LANG: 'en_US.UTF-8' } })
    const current = feed(on)
    on('classic.Notification', () => ({}))
    await $.session.start(START)
    await $.classic.Notification({ message: '🔔'.repeat(150), title: 'Do not use the title', notification_type: 'permission_prompt' })
    expect(current.latest().notice).toEqual({ kind: 'permission_prompt', text: '🔔'.repeat(140), at: MORNING })
    await $.session.end({ reason: 'prompt_input_exit' } as never)
    expect(current.latest().notice).toBe(null)
  })
})
