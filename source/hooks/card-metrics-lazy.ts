// The approved measurements are loaded only when a card is saved.
export type CardScript = 'latin' | 'zh' | 'ja' | 'ko' | 'hi'
export type CardMetrics = { characters: Record<string, number>; pairs: Record<string, number>; exact: Record<string, Record<string, number>>; fallback: number }
let TABLES: Record<CardScript, readonly [CardMetrics, CardMetrics]> | undefined
let loading: Promise<void> | undefined
export function loadCardMetrics(read: (path: string) => Promise<string>): Promise<void> {
  if (TABLES) return Promise.resolve()
  if (!loading) loading = read('hooks/card-metrics.json').then(text => {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card metrics')
    const tables = value as Record<CardScript, readonly [CardMetrics, CardMetrics]>
    for (const script of ['latin', 'zh', 'ja', 'ko', 'hi'] as const) {
      if (!Array.isArray(tables[script]) || tables[script].length !== 2) throw new Error('Invalid card metrics')
      for (const metrics of tables[script]) if (!metrics || typeof metrics.characters !== 'object' || typeof metrics.pairs !== 'object' || typeof metrics.exact !== 'object' || !Number.isFinite(metrics.fallback)) throw new Error('Invalid card metrics')
    }
    TABLES = tables
  }).catch(error => { loading = undefined; throw error })
  return loading
}
export function resetCardMetrics(): void { TABLES = undefined; loading = undefined }
export function cardScript(lang: string): CardScript {
  return lang === 'zh-Hant' ? 'zh' : lang === 'zh' || lang === 'ja' || lang === 'ko' || lang === 'hi' ? lang : 'latin'
}
export function cardWidth(text: string, script: CardScript, size: number, bold = false): number {
  if (!TABLES) throw new Error('Card metrics not loaded')
  const m = TABLES[script][bold ? 1 : 0], exact = m.exact[String(size)]
  if (exact?.[text] !== undefined) return exact[text]!
  const basic = (s: string): number => {
    const chars = [...s]
    return chars.reduce((sum, ch, i) => sum + (m.characters[ch] ?? m.fallback)
      + (i ? m.pairs[chars[i - 1]! + ch] ?? 0 : 0), 0) * size
  }
  if (!bold && exact && script !== 'zh' && script !== 'ja') {
    const words = text.split(' ')
    let total = 0
    for (let i = 0; i < words.length; i++) {
      const word = words[i]!
      total += exact[word] ?? basic(word)
      if (i) {
        const before = [...words[i - 1]!].at(-1) ?? '', after = [...word][0] ?? ''
        total += ((m.characters[' '] ?? 0) + (m.pairs[before + ' '] ?? 0) + (m.pairs[' ' + after] ?? 0)) * size
      }
    }
    return total
  }
  return basic(text)
}
