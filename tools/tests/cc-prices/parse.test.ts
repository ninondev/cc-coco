import { describe, expect, test } from 'bun:test';
import { PageChanged, modelIdFromName, parsePricePage } from '../../../plugin/hooks/cost/prices/index.ts';
import type { PriceRow } from '../../../plugin/hooks/cost/prices/index.ts';
import { expectedRows, miniPage, opusRow, pricingPage, row, sonnetRow, trio } from './helpers.ts';

function parseOk(md: string): { rows: PriceRow[]; rejected: ReturnType<typeof parsePricePage>['rejected'] } {
  return parsePricePage(md);
}

function expectCode(md: string, code: string): void {
  let err: unknown;
  try {
    parsePricePage(md);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(PageChanged);
  expect((err as PageChanged).code).toBe(code);
  expect((err as Error).name).toBe('PageChanged');
}

// The rejected probe row keeps every other ratio healthy (input 100, w5 125, w1 200, read 10, out 400).
function probeAccepted(...parts: [number, number, number, number, number]): boolean {
  const [i, w5, w1, r, o] = parts;
  const res = parseOk(miniPage(...trio(), row('Claude Probe 4.5', i, w5, w1, r, o)));
  return res.rows.some((x) => x.id === 'claude-probe-4-5');
}

function probeRejectedRatios(...parts: [number, number, number, number, number]): void {
  const [i, w5, w1, r, o] = parts;
  const res = parseOk(miniPage(...trio(), row('Claude Probe 4.5', i, w5, w1, r, o)));
  expect(res.rows.some((x) => x.id === 'claude-probe-4-5')).toBe(false);
  expect(res.rejected).toEqual([{ name: 'Claude Probe 4.5', why: 'ratios' }]);
}

describe('parsePricePage on the 2026-10-06 fixture', () => {
  test('gives exactly the 19 expected rows in page order with rejected []', () => {
    const res = parsePricePage(pricingPage);
    expect(res).toEqual({ rows: expectedRows, rejected: [] });
    expect(res.rows).toHaveLength(19);
  });

  test('first row is Claude Fable 5.1 with the documented values', () => {
    const res = parsePricePage(pricingPage);
    expect(res.rows[0]).toEqual({
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      input: 10,
      write5m: 12.5,
      write1h: 20,
      read: 0.25,
      output: 50,
      status: 'current',
    });
  });

  test("Claude Mythos 5.1 is 'limited' with the link stripped from its name", () => {
    const res = parsePricePage(pricingPage);
    const m = res.rows.find((r) => r.id === 'claude-mythos-5-1');
    expect(m?.status).toBe('limited');
    expect(m?.name).toBe('Claude Mythos 5.1');
  });

  test("retired statuses on Opus 4.1, Opus 4, Sonnet 4 and Haiku 3.5", () => {
    const res = parsePricePage(pricingPage);
    for (const id of ['claude-opus-4-1', 'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-3-5']) {
      expect(res.rows.find((r) => r.id === id)?.status).toBe('retired');
    }
  });

  test('row ids come from modelIdFromName of the cleaned name', () => {
    const res = parsePricePage(pricingPage);
    expect(res.rows.map((r) => r.id)).toEqual(expectedRows.map((r: PriceRow) => r.id));
  });
});

describe('mutation (a): heading renamed', () => {
  test("replaceAll heading gives PageChanged 'no-heading'", () => {
    expectCode(pricingPage.replaceAll('## Model pricing', '## Prices of models'), 'no-heading');
  });
});

describe('mutation (b): Opus 5.5 input x10', () => {
  const oldCell = '| $4 / MTok             | $5 / MTok       | $8 / MTok       | $0.20 / MTok<sup>2</sup> | $20 / MTok             |';
  const newCell = '| $40 / MTok            | $5 / MTok       | $8 / MTok       | $0.20 / MTok<sup>2</sup> | $20 / MTok             |';

  test('gives 18 rows and rejected Claude Opus 5.5 ratios', () => {
    const bad = pricingPage.replaceAll(oldCell, newCell);
    expect(bad).not.toBe(pricingPage);
    const res = parsePricePage(bad);
    expect(res.rows).toHaveLength(18);
    expect(res.rejected).toEqual([{ name: 'Claude Opus 5.5', why: 'ratios' }]);
    expect(res.rows.some((r) => r.id === 'claude-opus-5-5')).toBe(false);
  });
});

describe('mutation (c): column renamed', () => {
  test("replaceAll '5m cache writes' gives PageChanged 'no-table'", () => {
    expectCode(pricingPage.replaceAll('5m cache writes', 'short writes'), 'no-table');
  });
});

describe('header search', () => {
  test("missing '## Model pricing' anywhere gives no-heading", () => {
    expectCode('# Pricing\n\n| Model | input | 5m | 1h | cache hits | output |\n', 'no-heading');
  });

  test('stops at the next ## section even when a good table follows it', () => {
    const md = [
      '## Model pricing',
      '',
      'Words only.',
      '',
      '## Batch pricing',
      '',
      '| Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |',
      '| --- | --- | --- | --- | --- | --- |',
      ...trio(),
      '',
    ].join('\n');
    expectCode(md, 'no-table');
  });

  test('skips a table whose header lacks a needed column and uses the next one', () => {
    const md = [
      '## Model pricing',
      '',
      '| Model | Batch input | Batch output |',
      '| --- | --- | --- |',
      '| Claude Opus 4.5 | $2.50 / MTok | $12.50 / MTok |',
      '',
      '| Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |',
      '| --- | --- | --- | --- | --- | --- |',
      ...trio(),
      '',
    ].join('\n');
    const res = parseOk(md);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0].id).toBe('claude-opus-4-5');
  });

  test('header needs all five markers spread over cells (input via "Base input")', () => {
    const md = miniPage(...trio());
    const res = parseOk(md);
    expect(res.rows).toHaveLength(3);
  });

  test('data rows stop at the first line not starting with | (second block ignored)', () => {
    const md = [
      '## Model pricing',
      '',
      '| Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |',
      '| --- | --- | --- | --- | --- | --- |',
      ...trio(),
      '',
      'Interrupting prose.',
      '',
      ...trio().map((r) => r.replace('Claude', 'Claude Second')),
      '',
    ].join('\n');
    const res = parseOk(md);
    expect(res.rows.map((r) => r.id)).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']);
  });
});

describe('unparsed rows', () => {
  test('a cell without a $ / MTok price gives rejected unparsed', () => {
    const md = miniPage(...trio(), '| Claude Probe 4.5 | included | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |');
    const res = parseOk(md);
    expect(res.rejected).toEqual([{ name: 'Claude Probe 4.5', why: 'unparsed' }]);
    expect(res.rows).toHaveLength(3);
  });

  test('a row with too few cells gives rejected unparsed', () => {
    const md = miniPage(...trio(), '| Claude Probe 4.5 | $100 / MTok | $125 / MTok |');
    const res = parseOk(md);
    expect(res.rejected).toEqual([{ name: 'Claude Probe 4.5', why: 'unparsed' }]);
  });

  test('a bare pipe row gives rejected unparsed with an empty name', () => {
    const md = miniPage(...trio(), '|');
    const res = parseOk(md);
    expect(res.rejected).toEqual([{ name: '', why: 'unparsed' }]);
  });

  test('a price like $125 needs the / MTok unit to count', () => {
    const md = miniPage(...trio(), '| Claude Probe 4.5 | $100 per million | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |');
    const res = parseOk(md);
    expect(res.rejected).toEqual([{ name: 'Claude Probe 4.5', why: 'unparsed' }]);
  });

  test('the first price in a cell wins and extra cells are ignored', () => {
    const md = miniPage(
      ...trio(),
      '| Claude Probe 4.5 | $100 / MTok ($50 / MTok batch) | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok | $999 / MTok |',
    );
    const res = parseOk(md);
    expect(res.rejected).toEqual([]);
    const p = res.rows.find((r) => r.id === 'claude-probe-4-5');
    expect(p?.input).toBe(100);
    expect(p?.output).toBe(400);
  });

  test('decimals with spaces after $ parse ($ 0.02 / MTok style)', () => {
    const md = miniPage(...trio(), '| Claude Probe 4.5 | $ 100 /MTok | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |');
    const res = parseOk(md);
    expect(res.rejected).toEqual([]);
    expect(res.rows.find((r) => r.id === 'claude-probe-4-5')?.input).toBe(100);
  });
});

describe('ratio bounds', () => {
  test('healthy probe row is accepted', () => {
    expect(probeAccepted(100, 125, 200, 10, 400)).toBe(true);
  });

  test('write5m exactly at +1% tolerance passes (126.25)', () => {
    expect(probeAccepted(100, 126.25, 200, 10, 400)).toBe(true);
  });
  test('write5m just under the +1% limit passes (126.26)', () => {
    expect(probeAccepted(100, 126.26, 200, 10, 400)).toBe(true);
  });
  test('write5m just over the +1% limit is rejected (126.27)', () => {
    probeRejectedRatios(100, 126.27, 200, 10, 400);
  });
  test('write5m just under the -1% limit passes (123.77)', () => {
    expect(probeAccepted(100, 123.77, 200, 10, 400)).toBe(true);
  });
  test('write5m just over the -1% limit is rejected (123.76)', () => {
    probeRejectedRatios(100, 123.76, 200, 10, 400);
  });

  test('write1h exactly at +1% tolerance passes (202)', () => {
    expect(probeAccepted(100, 125, 202, 10, 400)).toBe(true);
  });
  test('write1h just over +1% is rejected (203)', () => {
    probeRejectedRatios(100, 125, 203, 10, 400);
  });
  test('write1h just under -1% passes (199)', () => {
    expect(probeAccepted(100, 125, 199, 10, 400)).toBe(true);
  });
  test('write1h just over -1% is rejected (198)', () => {
    probeRejectedRatios(100, 125, 198, 10, 400);
  });

  test('read/input at exactly 0.02 passes', () => {
    expect(probeAccepted(100, 125, 200, 2, 400)).toBe(true);
  });
  test('read/input at exactly 0.15 passes', () => {
    expect(probeAccepted(100, 125, 200, 15, 400)).toBe(true);
  });
  test('read/input just below 0.02 is rejected (1.99)', () => {
    probeRejectedRatios(100, 125, 200, 1.99, 400);
  });
  test('read/input just above 0.15 is rejected (15.01)', () => {
    probeRejectedRatios(100, 125, 200, 15.01, 400);
  });

  test('output/input at exactly 2 passes', () => {
    expect(probeAccepted(100, 125, 200, 10, 200)).toBe(true);
  });
  test('output/input at exactly 8 passes', () => {
    expect(probeAccepted(100, 125, 200, 10, 800)).toBe(true);
  });
  test('output/input just below 2 is rejected (199.99)', () => {
    probeRejectedRatios(100, 125, 200, 10, 199.99);
  });
  test('output/input just above 8 is rejected (800.01)', () => {
    probeRejectedRatios(100, 125, 200, 10, 800.01);
  });

  test('input of 0 is rejected with ratios', () => {
    probeRejectedRatios(0, 0, 0, 0, 0);
  });

  test('a zero input row with sane-looking other cells still rejected', () => {
    probeRejectedRatios(0, 1.25, 2, 0.1, 5);
  });
});

describe('too-few-rows and missing-family', () => {
  test('two good rows give too-few-rows', () => {
    expectCode(miniPage(opusRow(), sonnetRow()), 'too-few-rows');
  });

  test('rows that all reject give too-few-rows', () => {
    const bad = row('Claude Probe 4.5', 100, 999, 200, 10, 400);
    expectCode(miniPage(bad, bad.replace('Probe', 'Probe 2'), bad.replace('Probe', 'Probe 3')), 'too-few-rows');
  });

  test('a table with only Opus and Sonnet rows gives missing-family', () => {
    expectCode(miniPage(opusRow(' a'), opusRow(' b'), sonnetRow()), 'missing-family');
  });

  test('families come only from ids starting with claude-', () => {
    const alien = row('GPT Fancy 4', 100, 125, 200, 10, 400);
    expectCode(miniPage(opusRow(), sonnetRow(), alien), 'missing-family');
    // the alien row itself parses fine when the trio is present
    const res = parseOk(miniPage(...trio(), alien));
    expect(res.rows.some((r) => r.id === 'gpt-fancy-4')).toBe(true);
  });
});

describe('line endings and name cleaning', () => {
  test('CRLF line ends parse to the same 19 rows', () => {
    const res = parsePricePage(pricingPage.replaceAll('\n', '\r\n'));
    expect(res).toEqual({ rows: expectedRows, rejected: [] });
  });

  test('CR-only line ends parse to the same 19 rows', () => {
    const res = parsePricePage(pricingPage.replaceAll('\n', '\r'));
    expect(res).toEqual({ rows: expectedRows, rejected: [] });
  });

  test('a plain [text](url) link keeps its text; ([...](...)) is removed whole', () => {
    const md = miniPage(
      ...trio(),
      '| Claude [Probe](https://example.com/x) 4.5 ([retired on AWS](https://example.com/y)) | $100 / MTok | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |',
    );
    const res = parseOk(md);
    const p = res.rows.find((r) => r.id === 'claude-probe-4-5');
    expect(p?.name).toBe('Claude Probe 4.5');
    expect(p?.status).toBe('retired');
  });

  test('superscripts are removed from the name cell', () => {
    const md = miniPage(...trio(), '| Claude Probe<sup>2</sup> 4.5 | $100 / MTok | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |');
    const res = parseOk(md);
    expect(res.rows.find((r) => r.id === 'claude-probe-4-5')?.name).toBe('Claude Probe 4.5');
  });

  test("'limited availability' anywhere in the cell means limited", () => {
    const md = miniPage(...trio(), '| Claude Probe 4.5 (limited availability in EU) | $100 / MTok | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |');
    const res = parseOk(md);
    // a plain-text note is not a link pattern, so cleanName keeps it in the name
    const p = res.rows.find((r) => r.id === 'claude-probe-4-5-limited-availability-in-eu');
    expect(p?.status).toBe('limited');
    expect(p?.name).toBe('Claude Probe 4.5 (limited availability in EU)');
  });

  test("'retired' wins over 'limited availability'", () => {
    const md = miniPage(
      ...trio(),
      '| Claude Probe 4.5 ([limited availability](https://x), retired) | $100 / MTok | $125 / MTok | $200 / MTok | $10 / MTok | $400 / MTok |',
    );
    const res = parseOk(md);
    // "([limited availability](url), retired)" is not a bare "([…](url))" group:
    // only the [text](url) syntax is replaced, so the note's text stays in the name
    const p = res.rows.find((r) => r.id === 'claude-probe-4-5-limited-availability-retired');
    expect(p?.status).toBe('retired');
    expect(p?.name).toBe('Claude Probe 4.5 (limited availability, retired)');
  });

  test('the parse starts at the first heading occurrence', () => {
    const md = [
      'Intro.',
      '',
      '## Model pricing below.',
      '',
      '| Model | Base input | 5m cache writes | 1h cache writes | Cache hits | Output |',
      '| --- | --- | --- | --- | --- | --- |',
      ...trio(),
      '',
    ].join('\n');
    const res = parseOk(md);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0].id).toBe('claude-opus-4-5');
  });
});

describe('modelIdFromName', () => {
  test("'Claude Opus 5.5' -> claude-opus-5-5", () => {
    expect(modelIdFromName('Claude Opus 5.5')).toBe('claude-opus-5-5');
  });
  test('runs of non-alphanumerics collapse to one dash', () => {
    expect(modelIdFromName('Claude  Opus!! 5.5')).toBe('claude-opus-5-5');
  });
  test('leading and trailing separators are stripped', () => {
    expect(modelIdFromName('--Claude Opus--')).toBe('claude-opus');
  });
  test('digits and letters survive; case is lowered', () => {
    expect(modelIdFromName('GPT x5 Turbo')).toBe('gpt-x5-turbo');
  });
  test('an empty name gives an empty id', () => {
    expect(modelIdFromName('')).toBe('');
    expect(modelIdFromName('!!!')).toBe('');
  });
});

describe('PageChanged shape', () => {
  test('the class carries its code and the name PageChanged', () => {
    const e = new PageChanged('no-table', 'custom message');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(PageChanged);
    expect(e.code).toBe('no-table');
    expect(e.name).toBe('PageChanged');
    expect(e.message).toBe('custom message');
  });

  test('the message is optional', () => {
    const e = new PageChanged('missing-family');
    expect(e.code).toBe('missing-family');
    expect(typeof e.message).toBe('string');
  });

  test('codes are exactly the four documented ones', () => {
    expect(new PageChanged('no-heading').code).toBe('no-heading');
    expect(new PageChanged('no-table').code).toBe('no-table');
    expect(new PageChanged('too-few-rows').code).toBe('too-few-rows');
    expect(new PageChanged('missing-family').code).toBe('missing-family');
  });
});
