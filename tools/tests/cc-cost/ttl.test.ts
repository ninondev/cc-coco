import { test, expect, describe } from 'bun:test'
import { resolveTtl, type PayerKind } from '../../../plugin/hooks/cost/core/index'

const KINDS: PayerKind[] = ['plan', 'credits', 'api', 'cloud', 'gateway', 'unknown']

describe('rule 3: evidence', () => {
  test("evidence '5m' overrides every other rule", () => {
    const r = resolveTtl({
      env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', ENABLE_PROMPT_CACHING_1H: '1' },
      settingsTtl: '1h',
      kind: 'plan',
      evidence: '5m',
    })
    expect(r).toEqual({ ttl: '5m', source: 'evidence' })
  })

  test("evidence '1h' overrides every other rule", () => {
    const r = resolveTtl({
      env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' },
      settingsTtl: '5m',
      kind: 'credits',
      evidence: '1h',
    })
    expect(r).toEqual({ ttl: '1h', source: 'evidence' })
  })

  test('null or missing evidence falls through to the later rules', () => {
    expect(resolveTtl({ env: {}, kind: 'plan', evidence: null }).source).toBe('payer')
    expect(resolveTtl({ env: {}, kind: 'plan' }).source).toBe('payer')
  })

  test('an evidence value that is neither 5m nor 1h is ignored', () => {
    expect(resolveTtl({ env: {}, kind: 'plan', evidence: 'bogus' as never }).source).toBe('payer')
  })
})

describe('rule 3: FORCE_PROMPT_CACHING_5M', () => {
  test("exactly '1' after trim forces 5m", () => {
    expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: '1' }, kind: 'plan' })).toEqual({ ttl: '5m', source: 'force5m' })
    expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: ' 1 ' }, kind: 'cloud' })).toEqual({ ttl: '5m', source: 'force5m' })
  })

  test("other values ('0', 'true', '', undefined) fall through", () => {
    for (const v of ['0', 'true', '', '  ', '2', undefined]) {
      expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: v }, kind: 'plan' }).source).not.toBe('force5m')
    }
  })

  test('force beats the env TTL, the settings and ENABLE_PROMPT_CACHING_1H', () => {
    expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, kind: 'api' })).toEqual({ ttl: '5m', source: 'force5m' })
    expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: '1', ENABLE_PROMPT_CACHING_1H: '1' }, kind: 'api' })).toEqual({ ttl: '5m', source: 'force5m' })
    expect(resolveTtl({ env: { FORCE_PROMPT_CACHING_5M: '1' }, settingsTtl: '1h', kind: 'api' })).toEqual({ ttl: '5m', source: 'force5m' })
  })
})

describe('rule 3: CLAUDE_CODE_PROMPT_CACHE_TTL', () => {
  test("'5m' and '1h' after trim come from env", () => {
    expect(resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }, kind: 'plan' })).toEqual({ ttl: '5m', source: 'env' })
    expect(resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, kind: 'plan' })).toEqual({ ttl: '1h', source: 'env' })
    expect(resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: ' 1h ' }, kind: 'unknown' })).toEqual({ ttl: '1h', source: 'env' })
  })

  test('any other value falls through (to settings, then payer)', () => {
    for (const v of ['5M', '1H', 'x', '0', 'true', '', undefined]) {
      const r = resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: v }, settingsTtl: '5m', kind: 'api' })
      expect(r).toEqual({ ttl: '5m', source: 'settings' })
    }
  })

  test('env beats settings and ENABLE_PROMPT_CACHING_1H', () => {
    expect(resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }, settingsTtl: '1h', kind: 'api' })).toEqual({ ttl: '5m', source: 'env' })
    expect(resolveTtl({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m', ENABLE_PROMPT_CACHING_1H: '1' }, kind: 'api' })).toEqual({ ttl: '5m', source: 'env' })
  })
})

describe('rule 3: settingsTtl', () => {
  test("exactly the string '5m' or '1h' comes from settings", () => {
    expect(resolveTtl({ env: {}, settingsTtl: '5m', kind: 'plan' })).toEqual({ ttl: '5m', source: 'settings' })
    expect(resolveTtl({ env: {}, settingsTtl: '1h', kind: 'credits' })).toEqual({ ttl: '1h', source: 'settings' })
  })

  test('padded or non-string settings fall through', () => {
    for (const v of [' 5m', '5m ', '5M', 5, null, true, undefined, { ttl: '5m' }]) {
      const r = resolveTtl({ env: {}, settingsTtl: v, kind: 'plan' })
      expect(r).toEqual({ ttl: '1h', source: 'payer' })
    }
  })

  test('settings beats ENABLE_PROMPT_CACHING_1H', () => {
    expect(resolveTtl({ env: { ENABLE_PROMPT_CACHING_1H: '1' }, settingsTtl: '5m', kind: 'api' })).toEqual({ ttl: '5m', source: 'settings' })
  })
})

describe('rule 3: ENABLE_PROMPT_CACHING_1H', () => {
  test("exactly '1' after trim gives 1h with source enable1h", () => {
    expect(resolveTtl({ env: { ENABLE_PROMPT_CACHING_1H: '1' }, kind: 'credits' })).toEqual({ ttl: '1h', source: 'enable1h' })
    expect(resolveTtl({ env: { ENABLE_PROMPT_CACHING_1H: ' 1' }, kind: 'unknown' })).toEqual({ ttl: '1h', source: 'enable1h' })
  })

  test("other values fall through to the payer rule", () => {
    for (const v of ['0', 'yes', '', ' ']) {
      expect(resolveTtl({ env: { ENABLE_PROMPT_CACHING_1H: v }, kind: 'credits' })).toEqual({ ttl: '5m', source: 'payer' })
    }
  })

  test('enable1h beats the payer default even for plan', () => {
    expect(resolveTtl({ env: { ENABLE_PROMPT_CACHING_1H: '1' }, kind: 'plan' })).toEqual({ ttl: '1h', source: 'enable1h' })
  })
})

describe('rule 3: payer kind default', () => {
  test("plan pays for the 1h cache", () => {
    expect(resolveTtl({ env: {}, kind: 'plan' })).toEqual({ ttl: '1h', source: 'payer' })
  })

  test('every other kind defaults to 5m', () => {
    for (const kind of ['credits', 'api', 'cloud', 'gateway', 'unknown'] as PayerKind[]) {
      expect(resolveTtl({ env: {}, kind })).toEqual({ ttl: '5m', source: 'payer' })
    }
  })

  test('all six kinds are covered', () => {
    expect(KINDS.length).toBe(6)
  })
})

describe('rule 3: full precedence ladder', () => {
  test('each rung wins over every rung below it', () => {
    const all = {
      env: { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', ENABLE_PROMPT_CACHING_1H: '1' },
      settingsTtl: '1h',
      kind: 'plan' as const,
    }
    expect(resolveTtl({ ...all, evidence: '5m' }).source).toBe('evidence')
    expect(resolveTtl({ ...all }).source).toBe('force5m')
    expect(resolveTtl({ ...all, env: { ...all.env, FORCE_PROMPT_CACHING_5M: '0' } }).source).toBe('env')
    expect(
      resolveTtl({ ...all, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: 'nope', ENABLE_PROMPT_CACHING_1H: '1' } }).source,
    ).toBe('settings')
    expect(
      resolveTtl({ ...all, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: 'nope', ENABLE_PROMPT_CACHING_1H: '1' }, settingsTtl: 'nope' }).source,
    ).toBe('enable1h')
    expect(resolveTtl({ ...all, env: {}, settingsTtl: 'nope' }).source).toBe('payer')
  })

  test('an empty env with no settings lands on the payer default', () => {
    expect(resolveTtl({ env: {}, settingsTtl: undefined, kind: 'api' })).toEqual({ ttl: '5m', source: 'payer' })
  })
})
