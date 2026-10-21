// Host model ids -> price-table ids, and row lookup.
import type { PriceRow, TierPrices } from './page';

// Turn a display name like "Claude Opus 5.5" into the table id "claude-opus-5-5"
// (re-exported from page.ts; kept there next to the parser that uses it).

// Host ids arrive in several shapes: "claude-opus-4-1-20250805",
// "us.anthropic.claude-haiku-4-5-20251001-v1:0", "claude-haiku-4-5@20251001",
// "anthropic/claude-opus-4.1", and the old order "claude-3-5-haiku-...".
// normalizeModelId applies, in order: trim/lowercase; drop a trailing
// "[...]"; drop everything through the last "anthropic." / "anthropic/";
// drop a trailing "-vN[:M]"; drop a trailing "@YYYYMMDD"/"-YYYYMMDD";
// turn "4.1" into "4-1"; rewrite the old "claude-<n>[-<m>-]<family>" order.
export function normalizeModelId(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  s = s.replace(/\[[^\]]*\]$/, '');
  s = s.replace(/^.*anthropic[./]/, '');
  s = s.replace(/-v\d+(:\d+)?$/, '');
  s = s.replace(/[@-]\d{8}$/, '');
  s = s.replace(/(\d)\.(\d)/g, '$1-$2');
  s = s.replace(/^claude-(\d+)-(\d+)-(opus|sonnet|haiku)$/, 'claude-$3-$1-$2');
  s = s.replace(/^claude-(\d+)-(opus|sonnet|haiku)$/, 'claude-$2-$1');
  return s;
}

export function priceFor(modelId: string, rows: PriceRow[], aliases?: Record<string, string>): PriceRow | null {
  let id = normalizeModelId(modelId);
  if (
    aliases != null &&
    typeof aliases === 'object' &&
    Object.prototype.hasOwnProperty.call(aliases, id) &&
    typeof aliases[id] === 'string'
  ) {
    id = aliases[id]!;
  }
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    if (r != null && typeof r === 'object' && (r as PriceRow).id === id) return r;
  }
  return null;
}

// The prices that apply to one request. Haiku 5.5 has a second set above 100,000 tokens of prompt (everything
// the request reads counts); every other model has one set. Each request is priced on its own.
export function priceAt(row: PriceRow, promptTokens: number): TierPrices {
  if (row.over !== undefined && Number.isFinite(promptTokens) && promptTokens > row.over.above) return row.over;
  return row;
}
