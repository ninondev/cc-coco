// Development-only scratch instrumentation. Never imported by shipping hooks.
export type CpuClock = () => number | undefined
export type HookCpuRow = {
  registration: number; pattern: string; matcher: unknown; calls: number; settled: number
  pending: number; measured: number; missingClock: number; maxCpuMs: number | null
  totalCpuMs: number; components: string[]; events: string[]
}
export type HookCpuReceipt = {
  version: 1; scope: 'hook-worker-process-inclusive'; hooks: HookCpuRow[]; limitations: string[]
}
export type HookCpuBudgets = { defaultMaxCpuMs: number; byEvent?: Record<string, number>; byComponent?: Record<string, number> }

function matcherValue(value: unknown): unknown {
  if (value instanceof RegExp) return { regexp: value.source, flags: value.flags }
  if (Array.isArray(value)) return value.map(matcherValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, matcherValue(child)]))
  return value ?? null
}

export function hookWorkerCpuMilliseconds(): number | undefined {
  // This global is probed in the actual kit worker; it is not part of SDK globals.
  try {
    const process = (globalThis as any).process
    if (typeof process?.cpuUsage !== 'function') return undefined
    const usage = process.cpuUsage()
    const cpu = (usage.user + usage.system) / 1000
    return Number.isFinite(cpu) ? cpu : undefined
  } catch { return undefined }
}

export function hookCpuMeter(clock: CpuClock = hookWorkerCpuMilliseconds) {
  const rows: HookCpuRow[] = []
  const read = (): number | undefined => {
    try { const value = clock(); return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
    catch { return undefined }
  }
  function timed(row: HookCpuRow, callback: Function): Function {
    return function(this: unknown, ...args: any[]) {
      row.calls++; row.pending++
      const component = args[1]?.component, event = args[2]?.event
      if (typeof component === 'string' && !row.components.includes(component)) row.components.push(component)
      if (typeof event === 'string' && !row.events.includes(event)) row.events.push(event)
      let sum = 0, missing = false, settled = false
      const start = read()
      const add = (begin: number | undefined) => {
        const end = read()
        if (begin === undefined || end === undefined || end < begin) missing = true
        else sum += end - begin
      }
      const finish = () => {
        if (settled) return
        settled = true; row.pending--; row.settled++
        if (missing) row.missingClock++
        else { row.measured++; row.totalCpuMs += sum; row.maxCpuMs = Math.max(row.maxCpuMs ?? 0, sum) }
      }
      const watch = (result: any, begin: number | undefined, final = true) => {
        if (result && typeof result.then === 'function') {
          // Observe settlement while returning the very same Promise to the engine.
          result.then((value: any) => { add(begin); if (final || value?.done) finish() }, () => { add(begin); finish() })
        } else { add(begin); if (final || result?.done) finish() }
        return result
      }
      let result: any
      try { result = Reflect.apply(callback, this, args) }
      catch (error) { add(start); finish(); throw error }
      if (result && typeof result.next === 'function' && typeof result.then !== 'function') {
        add(start)
        let proxy: any
        proxy = new Proxy(result, { get(target, key) {
          if (key === Symbol.asyncIterator || key === Symbol.iterator) {
            const iterator = Reflect.get(target, key, target)
            return typeof iterator === 'function' ? () => proxy : iterator
          }
          const method = Reflect.get(target, key, target)
          if ((key === 'next' || key === 'return' || key === 'throw') && typeof method === 'function') {
            return (...pullArgs: unknown[]) => {
              const begin = read()
              try { return watch(Reflect.apply(method, target, pullArgs), begin, false) }
              catch (error) { add(begin); finish(); throw error }
            }
          }
          return method
        } })
        return proxy
      }
      return watch(result, start)
    }
  }
  function wrapOn<T extends Function>(on: T): T {
    return new Proxy(on, { apply(target, receiver, originalArgs: unknown[]) {
      const args = [...originalArgs], index = args.length - 1
      const row: HookCpuRow = { registration: rows.length, pattern: String(args[0]), matcher: index === 2 ? matcherValue(args[1]) : null,
        calls: 0, settled: 0, pending: 0, measured: 0, missingClock: 0, maxCpuMs: null, totalCpuMs: 0, components: [], events: [] }
      args[index] = timed(row, args[index] as Function)
      // Keep the native registration position, matcher identity, and callback receiver.
      const registration = Reflect.apply(target, receiver, args)
      rows.push(row)
      if (!registration || typeof registration.catch !== 'function') return registration
      return new Proxy(registration, { get(target, key) {
        if (key !== 'catch') return Reflect.get(target, key, target)
        return (handler: Function) => Reflect.apply(target.catch, target, [timed(row, handler)])
      } })
    } }) as T
  }
  function snapshot(): HookCpuReceipt {
    return { version: 1, scope: 'hook-worker-process-inclusive',
      hooks: rows.map(row => ({ ...row, matcher: matcherValue(row.matcher), components: [...row.components].sort(), events: [...row.events].sort() })),
      limitations: [
        'CPU includes lower hooks, awaited host work, and concurrent work in the same worker process.',
        'Only work executed in the measured worker process is counted; host-process and deferred background CPU are outside this receipt.',
        'Async iterator CPU sums active pulls and excludes idle between yields; cancellation without iterator closure remains pending.',
        'A missing worker CPU primitive is a measurement gap; elapsed SDK budget and wall clocks are never substituted.',
      ] }
  }
  return { wrapOn, snapshot }
}

export function validateHookCpuReceipt(receipt: HookCpuReceipt, budgets: HookCpuBudgets): string[] {
  const gaps: string[] = []
  for (const row of receipt.hooks) {
    const label = 'registration ' + row.registration + ' ' + row.pattern
    if (!row.calls) { gaps.push(label + ': no dispatched calls'); continue }
    if (row.pending) gaps.push(label + ': ' + row.pending + ' callbacks not settled')
    if (row.missingClock || !row.measured || row.maxCpuMs === null) { gaps.push(label + ': CPU primitive unavailable'); continue }
    const bounds = [budgets.byEvent?.[row.pattern] ?? budgets.defaultMaxCpuMs,
      ...row.components.flatMap(component => budgets.byComponent?.[component] === undefined ? [] : [budgets.byComponent[component]])]
    const limit = Math.min(...bounds)
    if (!Number.isFinite(limit) || limit < 0) throw Error('invalid hook CPU budget ' + label)
    if (row.maxCpuMs > limit) gaps.push(label + ': ' + row.maxCpuMs + ' CPU ms exceeds ' + limit)
  }
  if (!receipt.hooks.length) gaps.push('no registered plugin hooks')
  return gaps
}
