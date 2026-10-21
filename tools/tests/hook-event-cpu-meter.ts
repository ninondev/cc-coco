// Test-realm public SDK calls only. The calibration test proves worker compute
// is charged to this process CPU clock before these receipts support a claim.
import { cpuMilliseconds } from './process-cpu'
import { hookCpuMeter } from './hook-cpu-meter'
import type { CpuClock, HookCpuBudgets } from './hook-cpu-meter'

export const BRIDGED_CPU_EVENTS = ['session.usage', 'store.set', 'state.set', 'ui.close', 'model.fork', 'model.complete'] as const
export type HookEventCpuRow = { event: string; component?: string; transports: string[]; calls: number; settled: number; pending: number; measured: number; missingClock: number; maxCpuMs: number | null; totalCpuMs: number }
export type HookEventCpuReceipt = { version: 1; scope: 'sdk-test-realm-process-inclusive-event-dispatch'; events: HookEventCpuRow[]; limitations: string[] }

export function hookEventCpuMeter(clock: CpuClock = cpuMilliseconds) {
  const meter = hookCpuMeter(clock)
  const callbacks = new Map<string, Function>()
  const transports = new Map<string, Set<string>>()
  let created: Function = () => {}
  const on = meter.wrapOn(((_event: string, _matcher: unknown, callback: Function) => { created = callback; return { catch() {} } }) as any)
  function invoke(event: string, component: string | undefined, transport: string, callback: () => unknown) {
    const key = JSON.stringify([event, component ?? null])
    if (!transports.has(key)) transports.set(key, new Set())
    transports.get(key)!.add(transport)
    if (!callbacks.has(key)) {
      on(event, component ? { component } : null, (_$: unknown, input: any) => input.invoke())
      callbacks.set(key, created)
    }
    return callbacks.get(key)!({}, { component, invoke: callback }, { event })
  }
  function wrapEngine<T extends object>(engine: T): T {
    const namespaces = new Map<PropertyKey, { target: object; proxy: object }>()
    return new Proxy(engine, { get(target, noun) {
      const namespace = Reflect.get(target, noun, target)
      if (!namespace || typeof namespace !== 'object' || typeof noun !== 'string') return namespace
      const cached = namespaces.get(noun)
      if (cached?.target === namespace) return cached.proxy
      const methods = new Map<PropertyKey, { target: Function; wrapper: Function }>()
      const proxy = new Proxy(namespace, { get(namespaceTarget, verb) {
        const method = Reflect.get(namespaceTarget, verb, namespaceTarget)
        if (typeof method !== 'function' || typeof verb !== 'string') return method
        const previous = methods.get(verb)
        if (previous?.target === method) return previous.wrapper
        const wrapper = (...args: any[]) => {
          const command = noun === 'command' && verb === 'run' && typeof args[0]?.command === 'string' ? args[0].command : ''
          const candidate = command.startsWith('p1-kit-hook-event-cpu:') ? command.slice('p1-kit-hook-event-cpu:'.length) : ''
          const bridged = (BRIDGED_CPU_EVENTS as readonly string[]).includes(candidate)
          const event = bridged ? candidate : noun === 'ui' && verb === 'mount' ? 'ui.render' : noun + '.' + verb
          const component = event === 'ui.render' && typeof args[0]?.component === 'string' ? args[0].component : undefined
          const transport = bridged ? 'sdk-command-bridge-inclusive' : noun + '.' + verb
          return invoke(event, component, transport, () => Reflect.apply(method, namespaceTarget, args))
        }
        methods.set(verb, { target: method, wrapper })
        return wrapper
      } })
      namespaces.set(noun, { target: namespace, proxy })
      return proxy
    } })
  }
  function snapshot(): HookEventCpuReceipt {
    return { version: 1, scope: 'sdk-test-realm-process-inclusive-event-dispatch',
      events: meter.snapshot().hooks.map(row => ({ event: row.pattern, ...(row.components.length ? { component: row.components[0] } : {}),
        transports: [...(transports.get(JSON.stringify([row.pattern, row.components[0] ?? null])) ?? [])].sort(),
        calls: row.calls, settled: row.settled, pending: row.pending, measured: row.measured, missingClock: row.missingClock,
        maxCpuMs: row.maxCpuMs, totalCpuMs: row.totalCpuMs })).sort((a, b) => a.event.localeCompare(b.event) || (a.component ?? '').localeCompare(b.component ?? '')),
      limitations: [
        'CPU includes the complete SDK event chain, host work, test mocks and concurrent work in the calibrated process; it is not exclusive callback CPU.',
        'ui.mount measures ui.render plus mount and client initialization CPU; mounted drawn reads are not counted as render dispatches.',
        'session.usage, store.set, state.set and ui.close use scratch command bridges; their CPU includes both the bridge and the complete nested event chain.',
        'Other events raised only inside workers have registration coverage but require a direct SDK dispatch for their own CPU budget measurement.',
        'Streaming event CPU sums active pulls and excludes CPU between yields; unclosed streams remain pending.',
        'Work deferred beyond SDK settlement is outside that event measurement and requires a separate CPU measurement.',
      ] }
  }
  return { wrapEngine, snapshot }
}

export function validateHookEventCpu(receipt: HookEventCpuReceipt, coverage: { hooks: { pattern: string; matcher?: any; calls: number }[] }, budgets: HookCpuBudgets): string[] {
  const gaps: string[] = []
  for (const row of receipt.events) {
    const label = row.event + (row.component ? ' component ' + row.component : '')
    if (row.pending) gaps.push(label + ': ' + row.pending + ' SDK calls not settled')
    if (row.missingClock || !row.measured || row.maxCpuMs === null) { gaps.push(label + ': CPU primitive unavailable'); continue }
    const limit = row.component && budgets.byComponent?.[row.component] !== undefined ?
      Math.min(budgets.byEvent?.[row.event] ?? budgets.defaultMaxCpuMs, budgets.byComponent[row.component]) : budgets.byEvent?.[row.event] ?? budgets.defaultMaxCpuMs
    if (!Number.isFinite(limit) || limit < 0) throw Error('invalid SDK event CPU budget ' + label)
    if (row.maxCpuMs > limit) gaps.push(label + ': ' + row.maxCpuMs + ' CPU ms exceeds ' + limit)
  }
  const missing = new Set<string>()
  for (const row of coverage.hooks) {
    const components = row.pattern === 'ui.render' ? row.matcher?.component : undefined
    const required = components === undefined ? [undefined] : Array.isArray(components) ? components : [components]
    for (const component of required) {
      if (typeof component !== 'string' && component !== undefined) { missing.add(row.pattern + ': component matcher requires explicit coverage review'); continue }
      if (!receipt.events.some(event => event.event === row.pattern && (component === undefined || event.component === component) && event.measured > 0)) {
        missing.add(row.pattern + (component ? ' component ' + component : '') + ': no direct SDK event CPU measurement')
      }
    }
  }
  gaps.push(...missing)
  return gaps
}
