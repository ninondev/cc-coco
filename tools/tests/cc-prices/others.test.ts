import { describe, expect, test } from 'bun:test';
import { OTHER_MAKERS, filterOthers } from '../../../plugin/hooks/cost/prices/index.ts';
import type { OtherMaker } from '../../../plugin/hooks/cost/prices/index.ts';
import { expectedOthers, litellmData } from './helpers.ts';

// A default chat entry for the xai provider, $2/$6 per MTok.
const E = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  litellm_provider: 'xai',
  mode: 'chat',
  input_cost_per_token: 2e-6,
  output_cost_per_token: 6e-6,
  ...over,
});

const names = (makers: OtherMaker[], maker = 'xai'): string[] =>
  makers.find((m) => m.maker === maker)?.models.map((x) => x.name) ?? [];

describe('filterOthers on the 2026-10-06 fixture', () => {
  test('deep-equals the expected JSON', () => {
    expect(filterOthers(litellmData, '2026-10-06')).toEqual(expectedOthers);
  });

  test('9 makers, 54 models, each at most 6', () => {
    const out = filterOthers(litellmData, '2026-10-06');
    expect(out).toHaveLength(9);
    expect(out.reduce((n, m) => n + m.models.length, 0)).toBe(54);
    for (const m of out) expect(m.models.length).toBeLessThanOrEqual(6);
  });

  test('OpenAI starts gpt-6.1-sol, gpt-6-astra; xAI starts grok-4.7; Mistral starts mistral-medium-3-5', () => {
    const out = filterOthers(litellmData, '2026-10-06');
    expect(out[0].models[0].name).toBe('gpt-6.1-sol');
    expect(out[0].models[1].name).toBe('gpt-6-astra');
    expect(names(out).at(0)).toBe('grok-4.7');
    expect(out.find((m) => m.maker === 'mistral')?.models[0].name).toBe('mistral-medium-3-5');
  });

  test('grok-4.3 sorts above grok-4.20 (4.20 counts as 4.2)', () => {
    const out = filterOthers(litellmData, '2026-10-06');
    const xs = names(out);
    expect(xs.indexOf('grok-4.3')).toBeLessThan(xs.indexOf('grok-4.20'));
  });

  test('perMaker 3 keeps the first three of the same order per maker', () => {
    const out = filterOthers(litellmData, '2026-10-06', 3);
    const full = filterOthers(litellmData, '2026-10-06');
    expect(out).toHaveLength(9);
    for (const m of out) {
      expect(m.models.map((x) => x.name)).toEqual(full.find((f) => f.maker === m.maker)!.models.slice(0, 3).map((x) => x.name));
    }
  });
});

describe('filterOthers step a: candidates', () => {
  test('a model of another provider is not picked up', () => {
    expect(filterOthers({ 'grok-4': E({ litellm_provider: 'azure' }) }, '2026-10-06')).toEqual([]);
  });

  test('a resold model under another provider is skipped', () => {
    expect(filterOthers({ 'openai/glm-5': E({ litellm_provider: 'openai' }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'azure/grok-4': E() }, '2026-10-06')).toEqual([]);
  });

  test("the maker's own provider/ prefix is stripped from the key", () => {
    const out = filterOthers({ 'xai/grok-4': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4']);
  });

  test('names with a colon (free variants) are skipped', () => {
    expect(filterOthers({ 'xai/grok-4:free': E() }, '2026-10-06')).toEqual([]);
  });

  test('the name must start with an allowed prefix', () => {
    expect(filterOthers({ 'xai/foo': E() }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ openai: { ...E({ litellm_provider: 'openai' }), } }, '2026-10-06')).toEqual([]);
    expect(names(filterOthers({ o1: E({ litellm_provider: 'openai' }) }, '2026-10-06'), 'openai')).toEqual(['o1']);
    expect(names(filterOthers({ 'openai/o3-mini': E({ litellm_provider: 'openai' }) }, '2026-10-06'), 'openai')).toEqual(['o3-mini']);
  });

  test("mode must be 'chat'", () => {
    expect(filterOthers({ 'grok-4': E({ mode: 'embedding' }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ mode: 'completion' }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ mode: undefined }) }, '2026-10-06')).toEqual([]);
  });

  test('both prices must be finite numbers above zero', () => {
    expect(filterOthers({ 'grok-4': E({ input_cost_per_token: 0 }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ output_cost_per_token: 0 }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ input_cost_per_token: -1e-6 }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ output_cost_per_token: '6e-6' }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ input_cost_per_token: Number.NaN }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ input_cost_per_token: true as unknown as number }) }, '2026-10-06')).toEqual([]);
    const out = filterOthers({ 'grok-4': E({ input_cost_per_token: 1.32e-6 }) }, '2026-10-06');
    expect(out[0]?.models[0]).toEqual({ name: 'grok-4', input: 1.32, read: null, output: 6 });
  });

  test('drop tokens in the lowercase name', () => {
    for (const bad of ['grok-4-audio', 'grok-4-image', 'grok-4-latest', 'grok-4-realtime', 'grok-4-tts', 'grok-4-embedding', 'grok-4_image', 'grok-4-transcribe', 'grok-4-transcription', 'grok-4-speech', 'grok-4-embed', 'grok-4-live']) {
      expect(filterOthers({ [bad]: E() }, '2026-10-06')).toEqual([]);
    }
    expect(names(filterOthers({ 'grok-4-preview': E() }, '2026-10-06'))).toEqual(['grok-4-preview']);
  });

  test('audio or image output support is skipped, strictly true', () => {
    expect(filterOthers({ 'grok-4': E({ supports_audio_output: true }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ supports_image_output: true }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ supports_audio_output: false }) }, '2026-10-06')).toHaveLength(1);
    expect(filterOthers({ 'grok-4': E({ supports_image_output: 'yes' }) }, '2026-10-06')).toHaveLength(1);
  });

  test('a deprecation_date before today is skipped', () => {
    expect(filterOthers({ 'grok-4': E({ deprecation_date: '2026-01-01' }) }, '2026-10-06')).toEqual([]);
    expect(filterOthers({ 'grok-4': E({ deprecation_date: '2026-10-05' }) }, '2026-10-06')).toEqual([]);
  });

  test('a deprecation_date of today or later, or malformed, is kept', () => {
    expect(filterOthers({ 'grok-4': E({ deprecation_date: '2026-10-06' }) }, '2026-10-06')).toHaveLength(1);
    expect(filterOthers({ 'grok-4': E({ deprecation_date: '2027-01-01' }) }, '2026-10-06')).toHaveLength(1);
    expect(filterOthers({ 'grok-4': E({ deprecation_date: '2026-1-1' }) }, '2026-10-06')).toHaveLength(1);
    expect(filterOthers({ 'grok-4': E({ deprecation_date: 20260101 }) }, '2026-10-06')).toHaveLength(1);
  });

  test('the first entry of each exact name wins', () => {
    const out = filterOthers(
      { 'xai/grok-4': E({ input_cost_per_token: 1e-6 }), 'grok-4': E({ input_cost_per_token: 3e-6 }) },
      '2026-10-06',
    );
    expect(out[0]?.models[0]?.input).toBe(1);
  });

  test('non-object entries are ignored', () => {
    expect(filterOthers({ 'grok-4': 'cheap', 'grok-5': 3, 'grok-6': [1, 2] }, '2026-10-06')).toEqual([]);
  });
});

describe('filterOthers step b: same-version spellings', () => {
  test("'grok-4-1' first drops 'grok-4.1'", () => {
    const out = filterOthers({ 'grok-4-1': E(), 'grok-4.1': E({ input_cost_per_token: 9e-6 }) }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4-1']);
  });

  test("'grok-4.1' first drops 'grok-4-1'", () => {
    const out = filterOthers({ 'grok-4.1': E(), 'grok-4-1': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4.1']);
  });

  test('case-insensitive canon: MiniMax-M2.5 vs minimax-m2-5', () => {
    const out = filterOthers(
      { 'minimax/MiniMax-M2.5': E({ litellm_provider: 'minimax' }), 'minimax/minimax-m2-5': E({ litellm_provider: 'minimax' }) },
      '2026-10-06',
    );
    expect(names(out, 'minimax')).toEqual(['MiniMax-M2.5']);
  });

  test('different versions are both kept', () => {
    const out = filterOthers({ 'grok-4.1': E(), 'grok-4.2': E() }, '2026-10-06');
    expect(names(out).sort()).toEqual(['grok-4.1', 'grok-4.2']);
  });
});

describe('filterOthers step c: dated duplicates', () => {
  test('a dated spelling is dropped when its undated twin is a candidate', () => {
    const out = filterOthers({ 'grok-4': E(), 'grok-4-20250101': E({ input_cost_per_token: 9e-6 }) }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4']);
  });

  test('ISO dates and MM-YYYY runs undate too', () => {
    const out = filterOthers({ 'grok-4': E(), 'grok-4-2025-01-01': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4']);
    const out2 = filterOthers(
      { 'mistral-x': E({ litellm_provider: 'mistral' }), 'mistral-x-10-2024': E({ litellm_provider: 'mistral' }) },
      '2026-10-06',
    );
    expect(names(out2, 'mistral')).toEqual(['mistral-x']);
  });

  test('a dated name is kept when the twin is absent', () => {
    const out = filterOthers({ 'grok-5-20250101': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-5-20250101']);
  });

  test('a four-digit suffix that is not a date still undates (2512)', () => {
    const both = filterOthers({ 'mistral/ministral-3-14b': E({ litellm_provider: 'mistral' }), 'mistral/ministral-3-14b-2512': E({ litellm_provider: 'mistral' }) }, '2026-10-06');
    expect(names(both, 'mistral')).toEqual(['ministral-3-14b']);
    const alone = filterOthers({ 'mistral/ministral-3-14b-2512': E({ litellm_provider: 'mistral' }) }, '2026-10-06');
    expect(names(alone, 'mistral')).toEqual(['ministral-3-14b-2512']);
  });
});

describe('filterOthers steps d-e: version and order', () => {
  test("version 4.20 (from 'grok-4-20') sorts below 4.3", () => {
    const out = filterOthers({ 'grok-4.3': E(), 'grok-4-20': E(), 'grok-4': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4.3', 'grok-4-20', 'grok-4']);
  });

  test('versioned models come before unversioned ones', () => {
    const out = filterOthers({ 'grok-beta': E(), 'grok-4.3': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4.3', 'grok-beta']);
  });

  test('higher versions first', () => {
    const out = filterOthers({ 'grok-4.3': E(), 'grok-4.6': E(), 'grok-4.5': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4.6', 'grok-4.5', 'grok-4.3']);
  });

  test('equal versions order by input price descending', () => {
    const out = filterOthers(
      { 'grok-4.3': E({ input_cost_per_token: 1e-6 }), 'grok-4.3-mini': E({ input_cost_per_token: 3e-6 }) },
      '2026-10-06',
    );
    expect(names(out)).toEqual(['grok-4.3-mini', 'grok-4.3']);
  });

  test('equal versions and price order by name ascending', () => {
    const out = filterOthers({ 'grok-4.3-b': E(), 'grok-4.3-a': E() }, '2026-10-06');
    expect(names(out)).toEqual(['grok-4.3-a', 'grok-4.3-b']);
  });

  test('perMaker keeps only the first per maker', () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) data[`grok-4.3-t${i}`] = E();
    expect(names(filterOthers(data, '2026-10-06'))).toHaveLength(6);
    expect(names(filterOthers(data, '2026-10-06'))).toEqual([
      'grok-4.3-t0',
      'grok-4.3-t1',
      'grok-4.3-t2',
      'grok-4.3-t3',
      'grok-4.3-t4',
      'grok-4.3-t5',
    ]);
    expect(names(filterOthers(data, '2026-10-06', 2))).toEqual(['grok-4.3-t0', 'grok-4.3-t1']);
    expect(names(filterOthers(data, '2026-10-06', 1))).toEqual(['grok-4.3-t0']);
  });
});

describe('filterOthers step f: values and shape', () => {
  test('read comes from cache_read_input_token_cost, null when not finite', () => {
    const out = filterOthers(
      {
        'grok-4': E({ cache_read_input_token_cost: 5e-7 }),
        'grok-4.1': E({ cache_read_input_token_cost: 'free' }),
        'grok-4.2': E({ cache_read_input_token_cost: 0 }),
      },
      '2026-10-06',
    );
    const get = (n: string) => out[0].models.find((m) => m.name === n);
    expect(get('grok-4')?.read).toBe(0.5);
    expect(get('grok-4.1')?.read).toBeNull();
    expect(get('grok-4.2')?.read).toBe(0);
  });

  test('costs are dollars per MTok with six-decimal rounding', () => {
    const out = filterOthers(
      { 'grok-4': E({ input_cost_per_token: 1.32e-6, output_cost_per_token: 4.7e-7, cache_read_input_token_cost: 1.6e-8 }) },
      '2026-10-06',
    );
    expect(out[0].models[0]).toEqual({ name: 'grok-4', input: 1.32, read: 0.016, output: 0.47 });
  });

  test('a maker with no models left is omitted', () => {
    expect(filterOthers({ 'grok-4': E({ mode: 'embedding' }) }, '2026-10-06')).toEqual([]);
  });

  test('makers appear in OTHER_MAKERS order regardless of key order', () => {
    const out = filterOthers(
      {
        'minimax/MiniMax-M2': E({ litellm_provider: 'minimax' }),
        'grok-4': E(),
        'openai/gpt-7': E({ litellm_provider: 'openai' }),
      },
      '2026-10-06',
    );
    expect(out.map((m) => m.maker)).toEqual(['openai', 'xai', 'minimax']);
    expect(out[0].label).toBe('OpenAI');
    expect(out[1].label).toBe('xAI');
    expect(out[2].label).toBe('MiniMax');
  });
});

describe('filterOthers with malformed data', () => {
  test('non-object data gives []', () => {
    expect(filterOthers(null, '2026-10-06')).toEqual([]);
    expect(filterOthers(undefined, '2026-10-06')).toEqual([]);
    expect(filterOthers(42, '2026-10-06')).toEqual([]);
    expect(filterOthers('grok', '2026-10-06')).toEqual([]);
    expect(filterOthers(true, '2026-10-06')).toEqual([]);
    expect(filterOthers([E()], '2026-10-06')).toEqual([]);
  });

  test('an empty object gives []', () => {
    expect(filterOthers({}, '2026-10-06')).toEqual([]);
  });
});

describe('OTHER_MAKERS constant', () => {
  test('has the nine makers with their providers, labels and prefixes', () => {
    expect(OTHER_MAKERS).toEqual([
      { provider: 'openai', label: 'OpenAI', prefixes: ['gpt-', 'o1', 'o3', 'o4'] },
      { provider: 'gemini', label: 'Google', prefixes: ['gemini-', 'gemma-'] },
      { provider: 'xai', label: 'xAI', prefixes: ['grok-'] },
      { provider: 'deepseek', label: 'DeepSeek', prefixes: ['deepseek-'] },
      { provider: 'zai', label: 'Z.ai', prefixes: ['glm-'] },
      { provider: 'moonshot', label: 'Moonshot', prefixes: ['kimi-', 'moonshot-'] },
      { provider: 'dashscope', label: 'Alibaba', prefixes: ['qwen', 'qwq-'] },
      {
        provider: 'mistral',
        label: 'Mistral',
        prefixes: ['mistral-', 'ministral-', 'magistral-', 'codestral-', 'devstral-', 'pixtral-', 'voxtral-', 'open-mistral-'],
      },
      { provider: 'minimax', label: 'MiniMax', prefixes: ['minimax-'] },
    ]);
  });
});
