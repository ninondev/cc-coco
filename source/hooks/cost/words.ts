type Table = Record<string, Record<string, string>>
let words: Table = {}
export function installCostWords(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  words = value as Table
}
export function costWord(lang: string, key: string, values: Record<string, string | number> = {}): string {
  const text = words[key]?.[lang] ?? words[key]?.en ?? ''
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
}
