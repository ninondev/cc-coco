// Price-change detection and arrangement of rows for display.
import type { PriceRow } from './page';
import { normalizeModelId } from './ids';

export interface SeenPrice {
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
  at: number;
}

export interface PriceChange {
  id: string;
  name: string;
  field: 'input' | 'write5m' | 'write1h' | 'read' | 'output';
  old: number;
  new: number;
  since: number;
}

const FIELDS = ['input', 'write5m', 'write1h', 'read', 'output'] as const;

export function priceChanges(
  seen: Record<string, SeenPrice>,
  rows: PriceRow[],
  usedIds: string[],
  now: number,
): { changes: PriceChange[]; seen: Record<string, SeenPrice> } {
  const prevSeen =
    seen != null && typeof seen === 'object' && !Array.isArray(seen) ? (seen as Record<string, SeenPrice>) : {};
  const rowList = Array.isArray(rows) ? rows : [];
  const used = new Set(Array.isArray(usedIds) ? usedIds : []);

  const changes: PriceChange[] = [];
  const out: Record<string, SeenPrice> = { ...prevSeen };
  for (const row of rowList) {
    if (row == null || typeof row !== 'object') continue;
    // rows may be malformed (rule 10), so field access goes through a record view
    const rec = row as unknown as Record<string, unknown>;
    const has = Object.prototype.hasOwnProperty.call(prevSeen, row.id);
    const prev = has ? prevSeen[row.id as string] : undefined;
    let anyDiff = false;
    if (prev != null && typeof prev === 'object') {
      for (const f of FIELDS) {
        if (prev[f] !== rec[f]) {
          anyDiff = true;
          if (used.has(row.id)) {
            changes.push({
              id: row.id,
              name: row.name,
              field: f,
              old: prev[f],
              new: rec[f] as number,
              since: now,
            });
          }
        }
      }
    }
    out[row.id as string] = {
      input: row.input,
      write5m: row.write5m,
      write1h: row.write1h,
      read: row.read,
      output: row.output,
      at: prev != null && typeof prev === 'object' && !anyDiff ? prev.at : now,
    };
  }
  return { changes, seen: out };
}

const MAIN_FAMILIES = new Set(['fable', 'opus', 'sonnet', 'haiku']);

export function arrangeRows(
  rows: PriceRow[],
  o: { chatModel?: string | null; usedRecently?: string[] },
): { main: (PriceRow & { thisChat: boolean })[]; older: PriceRow[] } {
  const rowList = Array.isArray(rows) ? rows : [];
  const oo = o != null && typeof o === 'object' ? o : {};
  const chat =
    oo.chatModel !== undefined && oo.chatModel !== null
      ? normalizeModelId(oo.chatModel as string)
      : null;
  const used = new Set(
    (Array.isArray(oo.usedRecently) ? (oo.usedRecently as unknown[]) : []).map((u) => normalizeModelId(u as string)),
  );

  const seenCurrent = new Set<string>();
  const main: (PriceRow & { thisChat: boolean })[] = [];
  const older: PriceRow[] = [];
  for (const row of rowList) {
    if (row == null || typeof row !== 'object') continue;
    const fam = typeof row.id === 'string' ? row.id.split('-')[1] : undefined;
    const firstCurrent = row.status === 'current' && fam !== undefined && !seenCurrent.has(fam) && MAIN_FAMILIES.has(fam);
    if (row.status === 'current' && fam !== undefined) seenCurrent.add(fam);
    if (firstCurrent || row.id === chat || used.has(row.id)) {
      main.push({ ...row, thisChat: row.id === chat });
    } else {
      older.push(row);
    }
  }
  return { main, older };
}
