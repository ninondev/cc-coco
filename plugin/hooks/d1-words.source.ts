import type { EngineInterface } from 'claude-code'
import { joinPath } from './paths'
export type D1Value = string | Record<string,string>
export type D1Words = { lang: string; entries: Record<string,Record<string,D1Value>>; ready?:false }
let loaded: D1Words['entries'] | undefined
let pending: Promise<void> | undefined
let generation = 0
const missing = new Set<string>()
export function loadD1Words(source: EngineInterface | (() => Promise<string>), _lang?: string): Promise<void> {
  if (loaded) return Promise.resolve()
  if (pending) return pending
  const own = generation
  const read = typeof source === 'function' ? source : () => source.fs.read(joinPath(source.plugin.root,'hooks','d1-words.json'))
  pending = read().then(raw => { const entries = JSON.parse(raw); if (own === generation && entries && typeof entries === 'object' && !Array.isArray(entries)) loaded = entries }).catch(() => {}).then(() => { if (own === generation) pending = undefined })
  return pending
}
export function d1Words(lang: string): D1Words { return loaded ? {lang,entries:loaded} : {lang,entries:{},ready:false} }
export function d1Text(words: D1Words, key: string, values: Record<string,string|number> = {}, n?: number): string {
  const entry = words.entries[key]
  if (words.ready!==false && entry?.[words.lang] === undefined) missing.add(`${words.lang}:${key}`)
  const selectedLang=entry?.[words.lang]===undefined?'en':words.lang
  let value = entry?.[words.lang] ?? entry?.en
  if (value && typeof value === 'object') {
    let category = 'other'
    try { category = new Intl.PluralRules(selectedLang).select(n ?? Number(values.n ?? 0)) } catch {}
    value = value[category] ?? value.other
  }
  if (typeof value !== 'string') return ''
  return value.replace(/\{([^}]+)\}/g, (token, key: string) => values[key] === undefined ? token : String(values[key]))
}
export function d1Word(lang: string,key: string,values: Record<string,string|number> = {},n?: number): string { return d1Text(d1Words(lang),key,values,n) }
export function d1MissingWords(): readonly string[] { return [...missing].sort() }
export function forgetD1Words(): void { generation++;loaded=undefined;pending=undefined }
