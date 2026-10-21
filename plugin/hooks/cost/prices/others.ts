// Filter the public LiteLLM price list down to other model makers' own API
// prices. Pure port of reference/others.py `filter_others`.

export interface OtherModel {
  name: string;
  input: number;
  read: number | null;
  output: number;
}

export interface OtherMaker {
  maker: string;
  label: string;
  models: OtherModel[];
}

export const OTHER_MAKERS: readonly {
  provider: string;
  label: string;
  prefixes: readonly string[];
}[] = [
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
];

const DROP_TOKENS = new Set([
  'image',
  'audio',
  'live',
  'realtime',
  'transcribe',
  'transcription',
  'tts',
  'speech',
  'embedding',
  'embed',
  'latest',
]);

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function mtok(x: number): number {
  return Number((x * 1e6).toFixed(6));
}

// "grok-4-1" and "grok-4.1" are the same version spelled two ways.
function canon(n: string): string {
  return n.toLowerCase().replace(/(\d)-(?=\d)/g, '$1.');
}

function is4(t: string): boolean {
  return /^\d{4}$/.test(t);
}
function is2(t: string): boolean {
  return /^\d{2}$/.test(t);
}
function is8(t: string): boolean {
  return /^\d{8}$/.test(t);
}

// Drop date-like token runs: 2024-10-22, 10-2024, 2024, 20241022.
export function undate(n: string): string {
  const t = n.split('-');
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    if (i + 2 < t.length && is4(t[i]!) && is2(t[i + 1]!) && is2(t[i + 2]!)) {
      i += 3;
      continue;
    }
    if (i + 1 < t.length && is2(t[i]!) && is4(t[i + 1]!)) {
      i += 2;
      continue;
    }
    if (is4(t[i]!) || is8(t[i]!)) {
      i += 1;
      continue;
    }
    out.push(t[i]!);
    i += 1;
  }
  return out.join('-');
}

// Version as a string ('4', '4.20', '6.1'), or null when the name has none.
function versionOf(n: string): string | null {
  const t = undate(n).split('-');
  for (let i = 0; i < t.length; i++) {
    const m = /^([A-Za-z]*)(\d+(?:\.\d+)?)$/.exec(t[i]!);
    if (m) {
      let v = m[2]!;
      if (m[1] === '' && !v.includes('.') && i + 1 < t.length && /^\d{1,2}$/.test(t[i + 1]!)) {
        v = v + '.' + t[i + 1]!;
      }
      return v;
    }
  }
  return null;
}

interface Row extends OtherModel {
  v: string | null;
}

export function filterOthers(data: unknown, today: string, perMaker = 6): OtherMaker[] {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return [];
  const per = typeof perMaker === 'number' ? perMaker : 6;
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  const out: OtherMaker[] = [];
  for (const { provider, label, prefixes } of OTHER_MAKERS) {
    const cand = new Map<string, Record<string, unknown>>();
    for (const key of keys) {
      const v = obj[key];
      if (v == null || typeof v !== 'object' || Array.isArray(v)) continue;
      const vo = v as Record<string, unknown>;
      if (vo.litellm_provider !== provider) continue;
      const name = key.startsWith(provider + '/') ? key.slice(provider.length + 1) : key;
      if (name.includes('/') || name.includes(':')) continue;
      const low = name.toLowerCase();
      if (!prefixes.some((p) => low.startsWith(p))) continue;
      if (vo.mode !== 'chat') continue;
      const i = vo.input_cost_per_token;
      const o = vo.output_cost_per_token;
      if (!(isNum(i) && isNum(o) && i > 0 && o > 0)) continue;
      const toks = new Set(low.split(/[-_]/));
      let drop = false;
      for (const t of DROP_TOKENS) if (toks.has(t)) drop = true;
      if (drop) continue;
      if (vo.supports_audio_output === true || vo.supports_image_output === true) continue;
      const dd = vo.deprecation_date;
      if (typeof dd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dd) && dd < today) continue;
      if (cand.has(name)) continue;
      cand.set(name, vo);
    }

    let names = [...cand.keys()];
    const canonFirst = new Map<string, string>();
    for (const n of names) {
      const c = canon(n);
      if (!canonFirst.has(c)) canonFirst.set(c, n);
    }
    names = names.filter((n) => canonFirst.get(canon(n)) === n);

    const keep: string[] = [];
    for (const n of names) {
      const b = undate(n);
      if (b !== n && cand.has(b)) continue;
      keep.push(n);
    }

    const rows: Row[] = keep.map((n) => {
      const v = cand.get(n)!;
      const cr = v.cache_read_input_token_cost;
      return {
        name: n,
        input: mtok(v.input_cost_per_token as number),
        read: isNum(cr) ? mtok(cr) : null,
        output: mtok(v.output_cost_per_token as number),
        v: versionOf(n),
      };
    });
    rows.sort((a, b) => {
      const ah = a.v !== null;
      const bh = b.v !== null;
      if (ah !== bh) return ah ? -1 : 1;
      const av = a.v !== null ? parseFloat(a.v) : 0;
      const bv = b.v !== null ? parseFloat(b.v) : 0;
      if (av !== bv) return bv - av;
      if (a.input !== b.input) return b.input - a.input;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
    const models = rows.slice(0, per).map(({ name, input, read, output }) => ({ name, input, read, output }));
    if (models.length > 0) out.push({ maker: provider, label, models });
  }
  return out;
}
