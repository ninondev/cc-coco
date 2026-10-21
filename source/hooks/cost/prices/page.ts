// Parse Anthropic's public price page (Markdown) into a validated table.
// Pure port of reference/prices.py `parse`; a page that looks wrong makes
// parsePricePage throw PageChanged so callers fall back to the shipped table.

export type RowStatus = 'current' | 'retired' | 'limited';

export interface TierPrices {
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

/** Haiku 5.5 is priced twice, split by the length of one request's whole prompt (cache reads and writes count). */
export const TIER_SPLIT_TOKENS = 100_000;

export interface PriceRow extends TierPrices {
  id: string;
  name: string;
  status: RowStatus;
  /** Prices for a request whose prompt is longer than `above` tokens; absent for models with one price. */
  over?: TierPrices & { above: number };
}

export interface Rejected {
  name: string;
  why: 'unparsed' | 'ratios' | 'tier';
}

export type PageChangedCode = 'no-heading' | 'no-table' | 'too-few-rows' | 'missing-family';

export class PageChanged extends Error {
  readonly code: PageChangedCode;

  constructor(code: PageChangedCode, message?: string) {
    super(message ?? defaultMessage(code));
    this.name = 'PageChanged';
    this.code = code;
  }
}

function defaultMessage(code: PageChangedCode): string {
  switch (code) {
    case 'no-heading':
      return 'no "## Model pricing" heading';
    case 'no-table':
      return 'no table with input, 5m, 1h, cache hits and output columns';
    case 'too-few-rows':
      return 'too few usable rows';
    case 'missing-family':
      return 'opus, sonnet and haiku rows are all required';
  }
}

const MONEY = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*MTok/;
const HEADER_WANT = ['input', '5m', '1h', 'cache hits', 'output'];

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|+/, '')
    .replace(/\|+$/, '')
    .split('|')
    .map((c) => c.trim());
}

function cleanName(cell: string): { name: string; status: RowStatus } {
  const low = cell.toLowerCase();
  const status: RowStatus = low.includes('retired')
    ? 'retired'
    : low.includes('limited availability')
      ? 'limited'
      : 'current';
  const name = cell
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '') // "([retired, ...](url))" removed whole
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/<sup>.*?<\/sup>/g, '')
    .trim();
  return { name, status };
}

// A row name may end in a bracket that gives the prompt length the row is priced for:
// "Claude Haiku 5.5 (up to 100K tokens)" and "Claude Haiku 5.5 (over 100K tokens)".
const TIER_NOTE = /\s*\(([^()]*)\)\s*$/;
function tierOf(name: string): { base: string; side: 'low' | 'high' } | null {
  const m = TIER_NOTE.exec(name);
  if (!m) return null;
  const inner = (m[1] ?? '').toLowerCase();
  if (!/\b100\s?k\b|\b100,000\b|\b100000\b|\b100\s000\b/.test(inner)) return null;
  const high = /\b(over|above|more than|exceeds?|beyond|longer|greater)\b|[>\u2265]/.test(inner);
  const low = /\b(up to|under|below|within|at most|less than|shorter|not more than)\b|[<\u2264]/.test(inner);
  if (high === low) return null;
  return { base: name.slice(0, m.index).trim(), side: high ? 'high' : 'low' };
}

export function modelIdFromName(name: string): string {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parsePricePage(md: string): { rows: PriceRow[]; rejected: Rejected[] } {
  if (typeof md !== 'string') throw new PageChanged('no-heading', 'page is not a string');
  const at = md.indexOf('## Model pricing');
  if (at < 0) throw new PageChanged('no-heading');
  const lines = md.slice(at).split(/\r\n|\r|\n/);

  let head = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('|')) {
      const lower = cells(line).map((c) => c.toLowerCase());
      if (HEADER_WANT.every((w) => lower.some((c) => c.includes(w)))) {
        head = i;
        break;
      }
    }
    if (line.startsWith('## ') && i > 0) break;
  }
  if (head < 0) throw new PageChanged('no-table');

  const rows: PriceRow[] = [];
  const rejected: Rejected[] = [];
  const highTiers: { base: string; prices: TierPrices }[] = [];
  for (let i = head + 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('|')) break;
    const cs = cells(line);
    const cleaned = cleanName(cs[0] ?? '');
    const { status } = cleaned;
    const tier = tierOf(cleaned.name);
    const name = tier ? tier.base : cleaned.name;
    const nums: (number | null)[] = [];
    for (const c of cs.slice(1, 6)) {
      const m = MONEY.exec(c);
      nums.push(m ? Number(m[1]) : null);
    }
    if (nums.length !== 5 || nums.some((n) => n === null)) {
      rejected.push({ name, why: 'unparsed' });
      continue;
    }
    const input = nums[0] as number;
    const write5m = nums[1] as number;
    const write1h = nums[2] as number;
    const read = nums[3] as number;
    const output = nums[4] as number;
    const ok =
      input > 0 &&
      Math.abs(write5m - 1.25 * input) <= 0.01 * write5m &&
      Math.abs(write1h - 2 * input) <= 0.01 * write1h &&
      0.02 <= read / input &&
      read / input <= 0.15 &&
      2 <= output / input &&
      output / input <= 8;
    if (!ok) {
      rejected.push({ name, why: 'ratios' });
      continue;
    }
    if (tier?.side === 'high') {
      highTiers.push({ base: name, prices: { input, write5m, write1h, read, output } });
      continue;
    }
    rows.push({ id: modelIdFromName(name), name, input, write5m, write1h, read, output, status });
  }
  // The longer-prompt row belongs to the shorter-prompt row of the same model; a lone one is refused.
  for (const high of highTiers) {
    const low = rows.find((r) => r.id === modelIdFromName(high.base));
    if (low === undefined || low.over !== undefined) rejected.push({ name: high.base, why: 'tier' });
    else low.over = { above: TIER_SPLIT_TOKENS, ...high.prices };
  }

  if (rows.length < 3) throw new PageChanged('too-few-rows', `only ${rows.length} usable rows`);
  const fams = new Set<string>();
  for (const r of rows) if (r.id.startsWith('claude-')) fams.add(r.id.split('-')[1]!);
  if (!(fams.has('opus') && fams.has('sonnet') && fams.has('haiku'))) throw new PageChanged('missing-family');
  return { rows, rejected };
}
