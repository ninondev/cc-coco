// r20-14 (ZCode-2): the cost features' settings and store records, pure shapes only; the word
// lines live in cost/surfaces.ts, the events in register.tsx's marked blocks. Each feature is
// off until the person turns it on; nothing here blocks anything.

export interface CostFeatureSettings {
  switchCost?: boolean  // 1: cost line on a model switch
  pasteBytes?: number    // 2: warn on a prompt over this many bytes
  dayCapUsd?: number     // 3: one line past this day cap
  costForecast?: boolean // 4: the month forecast line
  costFolders?: boolean  // 5: spend by project folder
  planConvert?: boolean  // 6: this chat at API prices
}
export const COST_FEATURES_KEY = 'cost.features'
export type CostFeatureStore = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const readCostFeatures = async (store: CostFeatureStore): Promise<CostFeatureSettings> => {
  const raw = object(await store.get(COST_FEATURES_KEY))
  const paste = raw.pasteBytes, cap = raw.dayCapUsd
  return {
    ...(raw.switchCost === true ? { switchCost: true } : {}),
    ...(typeof paste === 'number' && Number.isFinite(paste) && paste > 0 ? { pasteBytes: paste } : {}),
    ...(typeof cap === 'number' && Number.isFinite(cap) && (cap as number) > 0 ? { dayCapUsd: cap as number } : {}),
    ...(raw.costForecast === true ? { costForecast: true } : {}),
    ...(raw.costFolders === true ? { costFolders: true } : {}),
    ...(raw.planConvert === true ? { planConvert: true } : {}),
  }
}
export const writeCostFeatures = async (store: CostFeatureStore, patch: CostFeatureSettings): Promise<void> => {
  await store.set(COST_FEATURES_KEY, { ...object(await store.get(COST_FEATURES_KEY)), ...patch })
}
// UTF-8 and NFKC bytes: a token upper bound, never under the real count.
export const estimateTokens = (text: string): number => {
  const bytes = (value: string) => new TextEncoder().encode(value).length
  return Math.max(bytes(text), bytes(text.normalize('NFKC')))
}

// Item 5: cost.folders holds one row per folder (last path segment, one figure per day, thirty
// days kept); the dollars come from the cost runtime, so billing without dollars records nothing.
export interface FolderRecord { [path: string]: { name: string; days: Record<string, number> } }
export function recordFolderSpend(raw: unknown, path: string, day: string, usd: number, now: number): FolderRecord {
  const record: FolderRecord = {}
  const cutoff = dayKeyOf(now - 29 * 86400000)
  for (const [key, row] of Object.entries(object(raw))) {
    const days: Record<string, number> = {}
    for (const [one, value] of Object.entries(object((row as { days?: unknown }).days)))
      if (one >= cutoff && typeof value === 'number' && Number.isFinite(value)) days[one] = value
    // A row whose every day has fallen out of the window leaves with them.
    if (typeof (row as { name?: unknown }).name === 'string' && Object.keys(days).length) record[key] = { name: (row as { name: string }).name, days }
  }
  if (path && usd > 0) {
    const name = path.split('/').filter(Boolean).pop() ?? path
    const row = record[path] ?? { name, days: {} }
    row.days[day] = (row.days[day] ?? 0) + usd
    record[path] = row
  }
  return record
}
export type FolderRow = { name: string; day: number; month: number }
export function folderRows(raw: unknown, today: string): FolderRow[] {
  const month = today.slice(0, 7)
  const rows: FolderRow[] = []
  for (const row of Object.values(object(raw))) {
    const name = (row as { name?: unknown }).name
    if (typeof name !== 'string') continue
    const days = object((row as { days?: unknown }).days)
    let day = 0, monthTotal = 0
    for (const [one, value] of Object.entries(days)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (one === today) day += value
      if (one.slice(0, 7) === month) monthTotal += value
    }
    rows.push({ name, day, month: monthTotal })
  }
  return rows.filter(row => row.day > 0 || row.month > 0).sort((a, b) => b.month - a.month || b.day - a.day || a.name.localeCompare(b.name)).slice(0, 3)
}
const dayKeyOf = (time: number): string => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
