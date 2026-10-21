// Choosing between a fetched table and the shipped one, and the two loaders.
// Pure: fetching, timers and clock are injected via LoadDeps.
import { parsePricePage } from './page';
import type { PriceRow } from './page';
import { filterOthers } from './others';
import type { OtherMaker } from './others';

export const PRICE_PAGE_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
export const OTHERS_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const FETCH_LIMIT_MS = 6000;
export const OTHERS_MAX_BYTES = 8_000_000;
export const SHIPPED_MAX_AGE_DAYS = 14;

// Count the decompressed UTF-8 response without allocating a second copy.
// Stop at the limit, including replacement bytes for unpaired surrogates.
export function otherResponseWithinLimit(text: string): boolean {
  if (typeof text !== 'string' || text.length > OTHERS_MAX_BYTES) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > OTHERS_MAX_BYTES) return false;
  }
  return true;
}

export interface StoredPrices {
  fetchedAt: number;
  rows: PriceRow[];
}

export interface StoredOthers {
  fetchedAt: number;
  makers: OtherMaker[];
}

export interface ShippedPrices {
  asOf: string;
  source: string;
  rows: PriceRow[];
  aliases?: Record<string, string>;
  others?: OtherMaker[];
}

export interface ChosenTable {
  from: 'fetched' | 'shipped';
  at: number | null;
  asOf: string | null;
  rows: PriceRow[];
}

export type WhyNotFresh = 'offline' | 'changed' | 'off';

export interface LoadDeps {
  fetchText: (url: string) => Promise<string>;
  after: (ms: number, fn: () => void) => () => void;
  now: () => number;
  env: Record<string, string | undefined>;
  policyRefuses?: boolean;
}

export interface LoadedClaude {
  table: ChosenTable;
  why: WhyNotFresh | null;
  store: StoredPrices | null;
}

export interface LoadedOthers {
  makers: OtherMaker[];
  from: 'fetched' | 'shipped';
  at: number | null;
  why: WhyNotFresh | null;
  store: StoredOthers | null;
}

// A day key 'YYYY-MM-DD' starts at Date.UTC(y, m - 1, d); anything else (any
// non-string included) has no start.
export function dayStart(key: unknown): number | null {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === key ? t : null;
}

function shippedTable(shipped: ShippedPrices | undefined | null): ChosenTable {
  return {
    from: 'shipped',
    at: null,
    asOf: shipped != null && typeof shipped.asOf === 'string' ? shipped.asOf : null,
    rows: shipped != null && Array.isArray(shipped.rows) ? shipped.rows : [],
  };
}

export function newestTable(stored: StoredPrices | null, shipped: ShippedPrices): ChosenTable {
  const fallback = shippedTable(shipped);
  if (stored == null || typeof stored !== 'object') return fallback;
  if (typeof stored.fetchedAt !== 'number' || !Number.isFinite(stored.fetchedAt)) return fallback;
  if (!Array.isArray(stored.rows) || stored.rows.length === 0) return fallback;
  const start = dayStart(shipped != null ? shipped.asOf : undefined);
  if (start !== null && stored.fetchedAt < start) return fallback;
  return { from: 'fetched', at: stored.fetchedAt, asOf: null, rows: stored.rows };
}

export function shippedTooOld(asOf: string, today: string): boolean {
  const a = dayStart(asOf);
  const t = dayStart(today);
  if (a === null || t === null) return true;
  return (t - a) / 86400000 > SHIPPED_MAX_AGE_DAYS;
}

export function trafficOff(env: Record<string, string | undefined>): boolean {
  if (env == null || typeof env !== 'object') return false;
  const v = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t === '') return false;
  const low = t.toLowerCase();
  return low !== '0' && low !== 'false';
}

// Race the injected fetch against the injected timer; the promise always
// resolves. `offline` wins on timer or rejection, `changed` on any exception
// while using the text, `useText` builds the fresh result.
function raceFetch<T>(
  d: LoadDeps,
  url: string,
  offline: () => T,
  changed: () => T,
  useText: (text: string) => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    let cancelTimer: () => void = () => {};
    const finish = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    let fetched: unknown;
    try {
      fetched = d.fetchText(url);
    } catch {
      fetched = undefined;
    }
    const text: Promise<string> =
      fetched != null && typeof (fetched as PromiseLike<string>).then === 'function'
        ? Promise.resolve<string>(fetched as string | PromiseLike<string>)
        : Promise.reject(new Error('fetchText did not return a promise'));

    try {
      const cancel = d.after(FETCH_LIMIT_MS, () => {
        if (settled) return;
        let value: T;
        try {
          value = offline();
        } catch {
          value = changed();
        }
        finish(value);
      });
      if (typeof cancel === 'function') cancelTimer = cancel;
    } catch {
      // arming failed; the fetch outcome alone decides
    }

    text.then(
      (t) => {
        if (settled) return;
        let value: T;
        try {
          cancelTimer();
          value = useText(t);
        } catch {
          value = changed();
        }
        finish(value);
      },
      () => {
        if (settled) return;
        let value: T;
        try {
          cancelTimer();
          value = offline();
        } catch {
          value = changed();
        }
        finish(value);
      },
    );
  });
}

export function loadClaudePrices(d: LoadDeps & { stored: StoredPrices | null; shipped: ShippedPrices }): Promise<LoadedClaude> {
  const deps = (d ?? {}) as LoadDeps & { stored: StoredPrices | null; shipped: ShippedPrices };
  const fallback = () => newestTable(deps.stored ?? null, deps.shipped);
  if (trafficOff(deps.env) || deps.policyRefuses) {
    return Promise.resolve({ table: fallback(), why: 'off', store: null });
  }
  return raceFetch<LoadedClaude>(
    deps,
    PRICE_PAGE_URL,
    () => ({ table: fallback(), why: 'offline', store: null }),
    () => ({ table: fallback(), why: 'changed', store: null }),
    (text) => {
      const rows = parsePricePage(text).rows;
      const fetchedAt = deps.now();
      return { table: { from: 'fetched', at: fetchedAt, asOf: null, rows }, why: null, store: { fetchedAt, rows } };
    },
  );
}

export function loadOtherPrices(
  d: LoadDeps & { stored: StoredOthers | null; shipped: ShippedPrices; today: string },
): Promise<LoadedOthers> {
  const deps = (d ?? {}) as LoadDeps & { stored: StoredOthers | null; shipped: ShippedPrices; today: string };
  const fallback = (): { makers: OtherMaker[]; from: 'fetched' | 'shipped'; at: number | null } => {
    const stored = deps.stored ?? null;
    const shipped = deps.shipped;
    // An invalid shipped.asOf has no start (rule 4); like newestTable, it
    // cannot make the stored list stale, so the stored list stays usable.
    const start = dayStart(shipped != null ? shipped.asOf : undefined);
    const usable =
      stored != null &&
      typeof stored === 'object' &&
      typeof stored.fetchedAt === 'number' &&
      Number.isFinite(stored.fetchedAt) &&
      Array.isArray(stored.makers) &&
      stored.makers.length > 0 &&
      (start === null || stored.fetchedAt >= start);
    if (usable) return { makers: stored.makers, from: 'fetched', at: stored.fetchedAt };
    return {
      makers: shipped != null && Array.isArray(shipped.others) ? shipped.others : [],
      from: 'shipped',
      at: null,
    };
  };
  if (trafficOff(deps.env) || deps.policyRefuses) {
    const f = fallback();
    return Promise.resolve({ makers: f.makers, from: f.from, at: f.at, why: 'off', store: null });
  }
  return raceFetch<LoadedOthers>(
    deps,
    OTHERS_URL,
    () => {
      const f = fallback();
      return { makers: f.makers, from: f.from, at: f.at, why: 'offline', store: null };
    },
    () => {
      const f = fallback();
      return { makers: f.makers, from: f.from, at: f.at, why: 'changed', store: null };
    },
    (text) => {
      if (!otherResponseWithinLimit(text)) throw new Error('other price response exceeds byte limit');
      const makers = filterOthers(JSON.parse(text), deps.today);
      if (makers.length === 0) throw new Error('no other makers found');
      const fetchedAt = deps.now();
      return { makers, from: 'fetched', at: fetchedAt, why: null, store: { fetchedAt, makers } };
    },
  );
}
