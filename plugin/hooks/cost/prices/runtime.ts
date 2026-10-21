// Runtime boundary for the pure accepted price units. No IO happens on import or creation.
import { arrangeRows, loadClaudePrices, loadOtherPrices, newestTable, normalizeModelId, priceChanges, dayStart } from './index'
import type { ChosenTable, LoadDeps, LoadedOthers, OtherMaker, PriceChange, SeenPrice, ShippedPrices, StoredPrices, WhyNotFresh } from './index'

export interface PriceStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<unknown>
}
export interface PricesViewState {
  table: ChosenTable
  shippedAsOf: string
  checking: boolean
  why: WhyNotFresh | null
  others: LoadedOthers | null
  checkingOthers: boolean
  olderOpen: boolean
  othersOpen: boolean
  changes: PriceChange[]
  chatModel: string | null
  usedRecently: string[]
}
export interface PricesControllerOptions {
  shipped: ShippedPrices
  store: PriceStore
  deps: LoadDeps
  changed?: () => void
  chatModel?: string | null
  policyRefusesOthers?: boolean
}

function localDay(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function usedAt(raw: unknown, now: number): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const start = dayStart(localDay(now))!
  const out: Record<string, string> = {}
  for (const [id, day] of Object.entries(raw)) {
    const at = dayStart(day)
    if (at !== null && at <= start && start - at < 30 * 86400000 && typeof day === 'string') out[id] = day
  }
  return out
}
export async function recordModelUsed(store: PriceStore, id: string, now: number): Promise<void> {
  if (!id || !Number.isFinite(now)) return
  const ids = usedAt(await store.get('models.used'), now)
  ids[normalizeModelId(id)] = localDay(now)
  await store.set('models.used', ids)
}
export async function knownClaudePrices(store: PriceStore, shipped: ShippedPrices): Promise<ChosenTable> {
  return newestTable(await store.get('prices.claude') as StoredPrices | null, shipped)
}
export async function knownOtherPrices(store: PriceStore, shipped: ShippedPrices): Promise<OtherMaker[]> {
  const raw = await store.get('prices.others') as { fetchedAt?: number; rows?: OtherMaker[] } | null
  const start = dayStart(shipped.asOf)
  return raw && typeof raw.fetchedAt === 'number' && Number.isFinite(raw.fetchedAt) && Array.isArray(raw.rows) && (start === null || raw.fetchedAt >= start) ? raw.rows : shipped.others ?? []
}

export function createPricesController(o: PricesControllerOptions) {
  let state: PricesViewState = {
    table: newestTable(null, o.shipped), shippedAsOf: o.shipped.asOf, checking: false, why: null,
    others: null, checkingOthers: false, olderOpen: false, othersOpen: false,
    changes: [], chatModel: o.chatModel ?? null, usedRecently: [],
  }
  let opened = false, othersFetched = false, generation = 0
  const timers = new Set<{ cancel: () => void; fire: () => void }>()
  const deps: LoadDeps = { ...o.deps, after(ms, fn) {
    const timer = { cancel: () => {}, fire: fn }
    timer.cancel = o.deps.after(ms, () => { timers.delete(timer); fn() })
    timers.add(timer)
    return () => { timers.delete(timer); timer.cancel() }
  } }
  const notify = () => { o.changed?.() }
  const apply = (patch: Partial<PricesViewState>) => { state = { ...state, ...patch }; notify() }
  async function open(): Promise<void> {
    if (opened) return
    opened = true; othersFetched = false
    const gen = ++generation
    apply({ checking: true, why: null, others: null, olderOpen: false, othersOpen: false, changes: [] })
    try {
      const [stored, models, seen] = await Promise.all([o.store.get('prices.claude'), o.store.get('models.used'), o.store.get('prices.seen')])
      if (gen !== generation || !opened) return
      const usedRecently = Object.keys(usedAt(models, deps.now())).map(normalizeModelId)
      apply({ table: newestTable(stored as StoredPrices | null, o.shipped), usedRecently })
      const result = await loadClaudePrices({ ...deps, stored: stored as StoredPrices | null, shipped: o.shipped })
      if (gen !== generation || !opened) return
      let changes: PriceChange[] = []
      if (result.store) {
        const compared = priceChanges(seen as Record<string, SeenPrice>, result.store.rows, usedRecently, result.store.fetchedAt)
        changes = compared.changes
        await o.store.set('prices.claude', result.store)
        await o.store.set('prices.seen', compared.seen)
      }
      if (gen === generation && opened) apply({ table: result.table, why: result.why, checking: false, changes })
    } catch {
      if (gen === generation && opened) apply({ checking: false, why: 'offline' })
    }
  }
  async function openOthers(): Promise<void> {
    if (!opened) return
    if (state.othersOpen) { apply({ othersOpen: false }); return }
    apply({ othersOpen: true })
    if (othersFetched) return
    othersFetched = true
    const gen = generation
    apply({ checkingOthers: true })
    try {
      const raw = await o.store.get('prices.others') as { fetchedAt: number; rows: OtherMaker[] } | null
      if (gen !== generation || !opened) return
      const result = await loadOtherPrices({ ...deps, policyRefuses: o.policyRefusesOthers ?? deps.policyRefuses, stored: raw && Array.isArray(raw.rows) ? { fetchedAt: raw.fetchedAt, makers: raw.rows } : null, shipped: o.shipped })
      if (gen !== generation || !opened) return
      if (result.store) await o.store.set('prices.others', { fetchedAt: result.store.fetchedAt, rows: result.store.makers })
      if (gen === generation && opened) apply({ others: result, checkingOthers: false })
    } catch {
      if (gen === generation && opened) apply({ checkingOthers: false, others: { makers: o.shipped.others ?? [], from: 'shipped', at: null, why: 'offline', store: null } })
    }
  }
  function close(): void {
    opened = false; generation++
    for (const timer of timers) { timer.cancel(); timer.fire() }
    timers.clear()
    state = { ...state, checking: false, checkingOthers: false }
  }
  return {
    open, close, openOthers,
    state: () => state,
    setChatModel: (chatModel: string | null) => { state = { ...state, chatModel } },
    toggleOlder: () => apply({ olderOpen: !state.olderOpen }),
    rows: () => arrangeRows(state.table.rows, { chatModel: state.chatModel, usedRecently: state.usedRecently }),
  }
}
export type PricesController = ReturnType<typeof createPricesController>

export function estimateOtherModel(modelId: string, usage: { input: number; read?: number; write?: number; output: number }, makers: OtherMaker[]): number | null {
  if (![usage.input, usage.output, usage.read ?? 0, usage.write ?? 0].every(n => Number.isFinite(n) && n >= 0)) return null
  const raw = modelId.toLowerCase()
  for (const maker of makers) for (const row of maker.models) {
    if (raw !== row.name.toLowerCase() && raw !== [maker.maker, row.name].join('/').toLowerCase()) continue
    if (![row.input, row.output].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null
    if (row.read !== null && (typeof row.read !== 'number' || !Number.isFinite(row.read) || row.read < 0)) return null
    if ((usage.read ?? 0) > 0 && row.read === null) return null
    return (usage.input * row.input + (usage.write ?? 0) * row.input + (usage.read ?? 0) * (row.read ?? 0) + usage.output * row.output) / 1e6
  }
  return null
}
export { PRICE_PAGE_URL, OTHERS_URL } from './load'
