import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OtherMaker, PriceRow } from '../../../plugin/hooks/cost/prices/index.ts';

export const fixturesDir = join(import.meta.dir, 'fixtures');

export const pricingPage: string = readFileSync(join(fixturesDir, 'pricing-2026-10-06.md'), 'utf8');
export const expectedRows: PriceRow[] = JSON.parse(readFileSync(join(fixturesDir, 'rows-expected-2026-10-06.json'), 'utf8'));
export const litellmData: unknown = JSON.parse(readFileSync(join(fixturesDir, 'litellm-2026-10-06.json'), 'utf8'));
export const expectedOthers: OtherMaker[] = JSON.parse(readFileSync(join(fixturesDir, 'others-expected-2026-10-06.json'), 'utf8'));

// A row whose numbers satisfy every ratio check: write5m = 1.25x input,
// write1h = 2x input, read = 0.1x input, output = 4x input.
export function row(name: string, input: number, w5: number, w1: number, read: number, out: number, nameSuffix = ''): string {
  return `| ${name}${nameSuffix} | $${input} / MTok | $${w5} / MTok | $${w1} / MTok | $${read} / MTok | $${out} / MTok |`;
}

export const opusRow = (v = '') => row(`Claude Opus 4.5${v}`, 5, 6.25, 10, 0.5, 25);
export const sonnetRow = (v = '') => row(`Claude Sonnet 4.5${v}`, 3, 3.75, 6, 0.3, 15);
export const haikuRow = (v = '') => row(`Claude Haiku 4.5${v}`, 1, 1.25, 2, 0.1, 5);

export function miniPage(...rows: string[]): string {
  return [
    '# Pricing',
    '',
    '## Model pricing',
    '',
    '| Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Later prose.',
  ].join('\n');
}

export const trio = (): string[] => [opusRow(), sonnetRow(), haikuRow()];

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T | PromiseLike<T>) => void;
  reject: (e?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeTimer {
  ms: number;
  fn: () => void;
  cancelled: boolean;
}

export const NOW = 1791300000000;

export interface FakeDeps {
  d: Record<string, unknown>;
  calls: string[];
  timers: FakeTimer[];
  fetch: Deferred<string>;
}

export function fakeDeps(over: Record<string, unknown> = {}): FakeDeps {
  const calls: string[] = [];
  const timers: FakeTimer[] = [];
  const fetch = deferred<string>();
  const d: Record<string, unknown> = {
    fetchText: (url: string) => {
      calls.push(url);
      return fetch.promise;
    },
    after: (ms: number, fn: () => void) => {
      const t: FakeTimer = { ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    now: () => NOW,
    env: {},
    stored: null,
    shipped: { asOf: '2026-10-06', source: 'shipped', rows: [] },
    ...over,
  };
  return { d, calls, timers, fetch };
}

// The daily list Coco downloads (readOthersList): what filterOthers kept, with the time it was made.
export function othersList(makers: unknown = expectedOthers, generatedAt: string = new Date(NOW).toISOString(), extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, generatedAt, source: 'fixture', makers, ...extra });
}

// A shipped table with the given rows and as-of day.
export const DAY = '2026-10-06';
export const dayMs = (key: string): number => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
