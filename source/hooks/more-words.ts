// Generated from the approved more.* author file. Data is read on first use.
export const MORE_SLOTS: Record<string, Record<string,string>> = {}
let loaded = false
let generation = 0
let pending: Promise<boolean> | undefined
export function installMoreWords(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) return false
  for (const row of Object.values(value)) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !('en' in row) || Object.values(row).some(text => typeof text !== 'string')) return false
  }
  Object.assign(MORE_SLOTS, value)
  loaded = true
  return true
}
export function loadMoreWords(read: () => Promise<string>): Promise<boolean> {
  if (loaded) return Promise.resolve(true)
  if (pending) return pending
  const ticket = generation
  pending = read().then(raw => ticket === generation && installMoreWords(JSON.parse(raw))).catch(() => false).then(ok => { if (ticket === generation) pending = undefined; return ok })
  return pending
}
export function resetMoreWords(): void { for (const key of Object.keys(MORE_SLOTS)) delete MORE_SLOTS[key]; loaded = false; generation++; pending = undefined }
export function moreModelWords(keys: readonly string[]): Record<string,string> {
  const words: Record<string,string> = {}
  for (const key of keys) Object.defineProperty(words, key, { enumerable: true, get: () => moreWord(key, 'en') })
  return words
}
export function moreName(text: string, lang: string): string {
  const name = (lang === 'zh' || lang === 'zh-Hant') ? '小克' : lang === 'ja' ? 'Coco' : lang === 'ko' ? '코코' : 'Coco'
  return text.replace(/(?<![A-Za-z0-9_./:@-])Coco(?![A-Za-z0-9_@-])/g, name)
}
export function moreWord(key: string, lang: string): string {
  const slot = MORE_SLOTS[key.startsWith("more.") ? key : `more.${key}`]
  const text = moreName(slot?.[lang] ?? slot?.en ?? "", lang)
  return text
}
export function moreMissing(lang: string): string[] { return Object.keys(MORE_SLOTS).filter(key => !MORE_SLOTS[key]?.[lang]) }
export function moreFill(text: string, values: Record<string,string|number>): string { return text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] === undefined ? all : String(values[key])) }
