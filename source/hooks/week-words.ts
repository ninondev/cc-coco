// The first-meeting words (plugin/hooks/week-text.json and opening-text.json), read when the book or an
// opening first needs them. A key the writer has not delivered answers '' and its feature stays quiet.
import { d1Text } from './d1-state.js'
import { joinPath } from './d1-paths.js'
import type { EngineInterface } from 'claude-code'

type Table = Record<string, Record<string, string | Record<string, string>>>
let table: Table | undefined
let pending: Promise<void> | undefined
export function loadWeekWords($: Pick<EngineInterface, 'fs' | 'plugin'>): Promise<void> {
  if (table) return Promise.resolve()
  return pending ??= Promise.all(['week-text.json', 'opening-text.json'].map(async name => {
    try { return JSON.parse(await $.fs.read(joinPath($.plugin.root, 'hooks', name))) as Table } catch { return {} as Table }
  })).then(parts => { table = Object.assign({}, ...parts) }).finally(() => { pending = undefined })
}
export function forgetWeekWords(): void { table = undefined; pending = undefined }
export function weekWord(lang: string, key: string, vars: Record<string, string | number> = {}, n?: number): string {
  return d1Text({ lang, entries: table ?? {}, ready: false }, key, vars, n)
}
