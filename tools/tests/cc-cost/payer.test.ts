import { test, expect, describe } from 'bun:test'
import {
  initialPayer,
  updatePayer,
  wordsVariant,
  type PayerEvent,
  type PayerState,
  type WindowReading,
  type LimitsReading,
} from '../../../plugin/hooks/cost/core/index'

const win = (usedPercent: number, resetsAt = 1000000): WindowReading => ({ usedPercent, resetsAt })

function measure(over: { env?: Record<string, string | undefined>; limits?: LimitsReading | null; policyPricing?: boolean } = {}): PayerEvent {
  return { type: 'measure', env: over.env ?? {}, limits: over.limits ?? null, policyPricing: over.policyPricing ?? false }
}

const mainResponse = (hasUsage = true, modelPriced = true): PayerEvent => ({ type: 'response', main: true, hasUsage, modelPriced })
const sideResponse = (hasUsage = true, modelPriced = false): PayerEvent => ({ type: 'response', main: false, hasUsage, modelPriced })

const CLOUD_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
]

describe('rule 2: initialPayer', () => {
  test('starts unknown with every flag false', () => {
    expect(initialPayer()).toEqual({
      kind: 'unknown',
      orgRates: false,
      otherMaker: false,
      responses: 0,
      cloud: false,
      gateway: false,
      planWindows: false,
      full: false,
      creditsConfirmed: false,
    })
  })

  test('two initial states are separate objects', () => {
    expect(initialPayer()).not.toBe(initialPayer())
  })
})

describe('rule 2: measure — cloud env variables', () => {
  test('each of the five names marks cloud when set', () => {
    for (const name of CLOUD_VARS) {
      const s = updatePayer(initialPayer(), measure({ env: { [name]: '1' } }))
      expect(s.cloud).toBe(true)
      expect(s.kind).toBe('cloud')
    }
  })

  test("each of the five names with '0' leaves cloud off", () => {
    for (const name of CLOUD_VARS) {
      expect(updatePayer(initialPayer(), measure({ env: { [name]: '0' } })).cloud).toBe(false)
    }
  })

  test('set means trimmed, non-empty, not 0 and not false (case-insensitive)', () => {
    for (const v of ['1', ' 1 ', 'yes', '00', 'true', ' bedrock ']) {
      expect(updatePayer(initialPayer(), measure({ env: { CLAUDE_CODE_USE_BEDROCK: v } })).cloud).toBe(true)
    }
    for (const v of ['', ' ', '0', ' 0 ', 'false', 'FALSE', 'False', ' false ']) {
      expect(updatePayer(initialPayer(), measure({ env: { CLAUDE_CODE_USE_BEDROCK: v } })).cloud).toBe(false)
    }
  })

  test('undefined env entries are not set', () => {
    const env: Record<string, string | undefined> = { CLAUDE_CODE_USE_VERTEX: undefined, CLAUDE_CODE_USE_BEDROCK: undefined }
    expect(updatePayer(initialPayer(), measure({ env })).cloud).toBe(false)
  })

  test('any one of several set names is enough', () => {
    const s = updatePayer(initialPayer(), measure({ env: { CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_MANTLE: 'on' } }))
    expect(s.cloud).toBe(true)
  })

  test('a later measure can turn cloud off again', () => {
    let s = updatePayer(initialPayer(), measure({ env: { CLAUDE_CODE_USE_VERTEX: 'yes' } }))
    expect(s.cloud).toBe(true)
    s = updatePayer(s, measure({ env: {} }))
    expect(s.cloud).toBe(false)
    expect(s.kind).toBe('unknown')
  })
})

describe('rule 2: measure — gateway, plan windows, full, orgRates', () => {
  test('a non-null spendLimit object means gateway', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { spendLimit: {} } }))
    expect(s.gateway).toBe(true)
    expect(s.kind).toBe('gateway')
    expect(s.planWindows).toBe(false)
  })

  test('a null spendLimit is not gateway', () => {
    expect(updatePayer(initialPayer(), measure({ limits: { spendLimit: null } })).gateway).toBe(false)
  })

  test('null limits are neither gateway nor plan windows', () => {
    const s = updatePayer(initialPayer(), measure({ limits: null }))
    expect(s.gateway).toBe(false)
    expect(s.planWindows).toBe(false)
    expect(s.kind).toBe('unknown')
  })

  test('a fiveHour window means planWindows', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(30) } }))
    expect(s.planWindows).toBe(true)
    expect(s.gateway).toBe(false)
    expect(s.kind).toBe('plan')
  })

  test('a sevenDay window means planWindows', () => {
    expect(updatePayer(initialPayer(), measure({ limits: { sevenDay: win(30) } })).planWindows).toBe(true)
  })

  test('windows set to null are not present', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { fiveHour: null, sevenDay: null, spendLimit: {} } }))
    expect(s.planWindows).toBe(false)
    expect(s.gateway).toBe(true)
  })

  test('full needs usedPercent at or above 100 on some present window', () => {
    expect(updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } })).full).toBe(true)
    expect(updatePayer(initialPayer(), measure({ limits: { fiveHour: win(99.9) } })).full).toBe(false)
    expect(updatePayer(initialPayer(), measure({ limits: { sevenDay: win(140) } })).full).toBe(true)
    expect(updatePayer(initialPayer(), measure({ limits: { fiveHour: win(0), sevenDay: win(200) } })).full).toBe(true)
    expect(updatePayer(initialPayer(), measure({ limits: { fiveHour: win(0), sevenDay: win(99) } })).full).toBe(false)
  })

  test('a window object without usedPercent is present but not full', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { fiveHour: {} as WindowReading } }))
    expect(s.planWindows).toBe(true)
    expect(s.full).toBe(false)
  })

  test('orgRates mirrors policyPricing', () => {
    expect(updatePayer(initialPayer(), measure({ policyPricing: true })).orgRates).toBe(true)
    expect(updatePayer(initialPayer(), measure({ policyPricing: false })).orgRates).toBe(false)
    const kept = updatePayer(updatePayer(initialPayer(), measure({ policyPricing: true })), mainResponse())
    expect(kept.orgRates).toBe(true)
  })
})

describe('rule 2: measure — creditsConfirmed resets', () => {
  test('full false forces creditsConfirmed false', () => {
    const s0 = { ...initialPayer(), creditsConfirmed: true }
    const s = updatePayer(s0, measure({ limits: { fiveHour: win(50) } }))
    expect(s.full).toBe(false)
    expect(s.creditsConfirmed).toBe(false)
  })

  test('full turning false to true resets creditsConfirmed', () => {
    const s0 = { ...initialPayer(), full: false, creditsConfirmed: true }
    const s = updatePayer(s0, measure({ limits: { fiveHour: win(100) } }))
    expect(s.full).toBe(true)
    expect(s.creditsConfirmed).toBe(false)
  })

  test('full staying true keeps creditsConfirmed', () => {
    const s0 = { ...initialPayer(), full: true, creditsConfirmed: true }
    const s = updatePayer(s0, measure({ limits: { sevenDay: win(110) } }))
    expect(s.creditsConfirmed).toBe(true)
  })
})

describe('rule 2: response events', () => {
  test('a main response counts and records otherMaker', () => {
    let s = updatePayer(initialPayer(), mainResponse(true, false))
    expect(s.responses).toBe(1)
    expect(s.otherMaker).toBe(true)
    s = updatePayer(s, mainResponse(true, true))
    expect(s.responses).toBe(2)
    expect(s.otherMaker).toBe(false)
  })

  test('a side response changes nothing (but still returns a new object)', () => {
    const s = updatePayer(initialPayer(), mainResponse())
    const out = updatePayer(s, sideResponse())
    expect(out).toEqual(s)
    expect(out).not.toBe(s)
  })

  test('credits confirmed only when full and hasUsage on a main response', () => {
    const full = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    expect(updatePayer(full, mainResponse(true, true)).creditsConfirmed).toBe(true)
    expect(updatePayer(full, mainResponse(false, true)).creditsConfirmed).toBe(false)
  })

  test('a main response without full does not confirm credits', () => {
    const half = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(50) } }))
    expect(updatePayer(half, mainResponse(true, true)).creditsConfirmed).toBe(false)
  })

  test('a side response never confirms credits even when full', () => {
    const full = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    expect(updatePayer(full, sideResponse(true, true)).creditsConfirmed).toBe(false)
  })
})

describe('rule 2: kind decisions and their order', () => {
  test('a plan window reaching 100 without a later response stays plan', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    expect(s.full).toBe(true)
    expect(s.creditsConfirmed).toBe(false)
    expect(s.kind).toBe('plan')
  })

  test('full then a main response with usage gives credits', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    s = updatePayer(s, mainResponse(true, true))
    expect(s.kind).toBe('credits')
  })

  test('a window dropping below 100 returns to plan', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    s = updatePayer(s, mainResponse(true, true))
    expect(s.kind).toBe('credits')
    s = updatePayer(s, measure({ limits: { fiveHour: win(90) } }))
    expect(s.kind).toBe('plan')
  })

  test('credits survive a repeated full measure', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    s = updatePayer(s, mainResponse(true, true))
    s = updatePayer(s, measure({ limits: { fiveHour: win(105) } }))
    expect(s.kind).toBe('credits')
  })

  test('cloud beats gateway, plan windows, credits and api', () => {
    let s = updatePayer(initialPayer(), measure({ env: { CLAUDE_CODE_USE_BEDROCK: '1' }, limits: { spendLimit: {}, fiveHour: win(100) } }))
    s = updatePayer(s, mainResponse(true, true))
    expect(s.kind).toBe('cloud')
  })

  test('gateway beats plan windows and api', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { spendLimit: {}, fiveHour: win(100) } }))
    s = updatePayer(s, mainResponse(true, true))
    expect(s.kind).toBe('gateway')
  })

  test('plan windows beat api', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(30) } }))
    s = updatePayer(s, mainResponse())
    expect(s.responses).toBe(1)
    expect(s.kind).toBe('plan')
  })

  test('a single response with no windows is api', () => {
    const s = updatePayer(initialPayer(), mainResponse())
    expect(s.kind).toBe('api')
  })

  test('nothing at all is unknown', () => {
    expect(updatePayer(initialPayer(), measure()).kind).toBe('unknown')
  })

  test('windows disappearing falls back to api once responses exist', () => {
    let s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(30) } }))
    s = updatePayer(s, mainResponse())
    expect(s.kind).toBe('plan')
    s = updatePayer(s, measure({ limits: null }))
    expect(s.kind).toBe('api')
  })
})

describe('rule 2: wordsVariant', () => {
  test('plan and credits map to themselves', () => {
    expect(wordsVariant('plan')).toBe('plan')
    expect(wordsVariant('credits')).toBe('credits')
  })

  test('api, cloud and gateway map to money', () => {
    expect(wordsVariant('api')).toBe('money')
    expect(wordsVariant('cloud')).toBe('money')
    expect(wordsVariant('gateway')).toBe('money')
  })

  test('unknown maps to null', () => {
    expect(wordsVariant('unknown')).toBe(null)
  })
})

describe('rule 2: immutability', () => {
  const clone = (s: PayerState): PayerState => JSON.parse(JSON.stringify(s))

  test('measure never mutates the input state', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(30) } }))
    const before = clone(s)
    const out = updatePayer(s, measure({ env: { CLAUDE_CODE_USE_VERTEX: 'yes' }, limits: { sevenDay: win(100) }, policyPricing: true }))
    expect(s).toEqual(before)
    expect(out).not.toBe(s)
  })

  test('a main response never mutates the input state', () => {
    const s = updatePayer(initialPayer(), measure({ limits: { fiveHour: win(100) } }))
    const before = clone(s)
    const out = updatePayer(s, mainResponse(true, false))
    expect(s).toEqual(before)
    expect(out).not.toBe(s)
  })

  test('a side response never mutates the input state', () => {
    const s = updatePayer(initialPayer(), mainResponse())
    const before = clone(s)
    updatePayer(s, sideResponse())
    expect(s).toEqual(before)
  })
})
