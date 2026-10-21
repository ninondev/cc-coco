// The minutes of the stuck note take the language's plural form of «stuck.circle» (groups-f-1009.json):
// «1 minute» and «2 minutes» through the real hooks, and each language's own rule on the words themselves.
// Kept apart from notice-notes.test.tsx, which already sits near its per-file CPU allowance.
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { RECENT, settleLegacyStart, world } from './world'
import { C3_WORDS_RAW } from './c3-words-fixture'
import { c3Word, loadC3Words, resetC3Words } from '../hooks/c3-words'

const ROOT = '/tmp/notes'
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const READ = { result: { type: 'text', file: { filePath: ROOT + '/big.ts', content: 'x\n', numLines: 200, startLine: 1, totalLines: 1500 } } }
type Node = { type?: string; props?: Record<string, any>; children?: Node[] }

const flat = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(flat) : node && typeof node === 'object' ? [node as Node, ...((node as Node).children ?? []).flatMap(flat)] : []
const strings = (node: any): string[] => typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(strings) : node && typeof node === 'object' ? (node.children ?? []).flatMap(strings) : []

// Four reads of the same part of one big file, `gap` ms apart, then the row under the fourth.
async function circleNote($: any, on: On, gap: number): Promise<string> {
  on('process.run', () => ({ value: OK }))
  const w = world(on, { store: { ...RECENT }, engineRows: true, toolResult: () => READ })
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })
  await settleLegacyStart($, w)
  await $.turn.start({ text: 'work', turnId: 't1' })
  for (let i = 1; i <= 4; i++) {
    if (i > 1) await w.clock.advance(gap)
    await $.tool.call({ tool: 'Read', tool_use_id: `r${i}`, file_path: ROOT + '/big.ts' })
    for (let k = 0; k < 4; k++) await w.clock.advance(0)
  }
  const row = await $.ui.mount({ surface: 'vscode', plugin: 'coco', component: 'ToolResult', requestId: 'r4', props: { tool_use_id: 'r4', tool: 'Read', output: {}, isErrored: false }, viewport: { columns: 100, rows: 48 } })
  const tree = (await row.drawn()) as Node
  await row.unmount()
  return strings(flat(tree).find(n => n.props?.key === 'coco:stuck:circle')!).join('')
}

describe('the minutes of the stuck note', () => {
  test('four reads within a minute read «1 minute»', async ($, on) => {
    expect(await circleNote($, on, 0)).toContain('Claude opened big.ts 4 times in 1 minute, unchanged.')
  })

  test('four reads spread over two minutes read «2 minutes»', async ($, on) => {
    const text = await circleNote($, on, 40_000)
    expect(text).toContain('Claude opened big.ts 4 times in 2 minutes, unchanged.')
    expect(text).not.toContain('2 minute,')
  })

  test('each language picks its own plural form, and languages with one string keep it for every count', async () => {
    resetC3Words()
    await loadC3Words(() => Promise.resolve(C3_WORDS_RAW))
    const circle = (lang: string, count: number) => c3Word(lang, 'stuck.circle', 0, count)
    expect(circle('en', 1)).toContain('{m} minute,')
    expect(circle('en', 2)).toContain('{m} minutes,')
    expect(circle('de', 1)).toContain('{m} Minute ')
    expect(circle('de', 2)).toContain('{m} Minuten ')
    expect(circle('fr', 1)).toContain('{m} minute,')
    expect(circle('fr', 2)).toContain('{m} minutes,')
    expect(circle('pt-BR', 1)).toContain('{m} minuto,')
    expect(circle('pt-BR', 2)).toContain('{m} minutos,')
    for (const lang of ['zh', 'zh-Hant', 'ja', 'ko', 'id', 'hi']) expect(circle(lang, 1)).toBe(circle(lang, 2))
    // A language the table does not carry falls back to English, with English's rule.
    expect(circle('xx', 1)).toBe(circle('en', 1))
    expect(circle('xx', 3)).toBe(circle('en', 3))
    resetC3Words()
  })
})
