// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorResponse } from './errors.ts';
import {
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
  MAXIMUM_PAGE_LIMIT,
  pageOf,
  parsePageRequest,
  type Direction,
  type Page,
  type PageRequest,
  type Position,
} from './pagination.ts';

interface Row {
  readonly id: string;
  readonly startedAt: string;
}

const positionOf = (row: Row): Position => ({ key: row.startedAt, id: row.id });

function row(n: number): Row {
  return {
    id: `ride-${String(n).padStart(4, '0')}`,
    startedAt: `2026-09-${String(1 + (n % 28)).padStart(2, '0')}`,
  };
}

/** Read a whole list page by page, running `between` after every page. */
function readAll(
  rows: Row[],
  limit: number,
  direction: Direction,
  between: (pageNumber: number) => void,
  page: (rows: readonly Row[], request: PageRequest) => Page<Row> = (all, request) =>
    pageOf(all, positionOf, request, direction),
): Row[] {
  const seen: Row[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber += 1) {
    const parsed = parsePageRequest(
      new URLSearchParams({ limit: String(limit), ...(cursor === null ? {} : { cursor }) }),
    );
    if (!parsed.ok) throw new Error('the page request did not parse');
    const result = page(rows, parsed.request);
    seen.push(...result.items);
    if (result.next === null) return seen;
    cursor = result.next;
    between(pageNumber);
  }
  throw new Error('never reached the last page');
}

describe('keyset pagination is stable under concurrent insertion (#36)', () => {
  it.each<Direction>(['ascending', 'descending'])(
    'returns every original row exactly once, %s, while rows land before and after the reader',
    (direction) => {
      const rows = Array.from({ length: 120 }, (_, n) => row(n));
      const original = new Set(rows.map((r) => r.id));
      let next = 1000;
      const seen = readAll(rows, 7, direction, () => {
        // Another device syncs three rides between every page: one that sorts
        // first, one that sorts last, and one in the middle of the order.
        rows.push({ id: `ride-${String(next++)}`, startedAt: '2026-08-01' });
        rows.push({ id: `ride-${String(next++)}`, startedAt: '2026-12-31' });
        rows.push({ id: `ride-${String(next++)}`, startedAt: '2026-09-15' });
      });
      const ids = seen.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length); // nothing twice
      for (const id of original) expect(ids).toContain(id); // nothing dropped
    },
  );

  it('is what an OFFSET would get wrong — the control', () => {
    // The same reading against "skip n, take limit". If this did not duplicate
    // a row, the scenario above would prove nothing about keyset pagination.
    const rows = Array.from({ length: 120 }, (_, n) => row(n));
    let offset = 0;
    let next = 1000;
    const byOffset = (all: readonly Row[], request: PageRequest): Page<Row> => {
      const sorted = pageOf(all, positionOf, { limit: all.length, after: undefined }).items;
      const items = sorted.slice(offset, offset + request.limit);
      offset += request.limit;
      return { items, next: offset < sorted.length ? encodeCursor({ key: 'x', id: 'x' }) : null };
    };
    const seen = readAll(
      rows,
      7,
      'ascending',
      () => rows.push({ id: `ride-${String(next++)}`, startedAt: '2026-08-01' }),
      byOffset,
    );
    const ids = seen.map((r) => r.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });

  it('ends with next = null, and pages hold the limit', () => {
    const rows = Array.from({ length: 10 }, (_, n) => row(n));
    const first = pageOf(rows, positionOf, { limit: 4, after: undefined });
    expect(first.items).toHaveLength(4);
    expect(first.next).not.toBeNull();
    const exact = pageOf(rows, positionOf, { limit: 10, after: undefined });
    expect(exact.next).toBeNull();
  });
});

describe('the page request, and its validation errors', () => {
  it('defaults the limit and reads a cursor it wrote', () => {
    expect(parsePageRequest(new URLSearchParams())).toEqual({
      ok: true,
      request: { limit: DEFAULT_PAGE_LIMIT, after: undefined },
    });
    const cursor = encodeCursor({ key: '2026-09-01', id: 'ride-1' });
    expect(decodeCursor(cursor)).toEqual({ key: '2026-09-01', id: 'ride-1' });
  });

  it.each([
    ['limit', '000'],
    ['limit', String(MAXIMUM_PAGE_LIMIT + 1)],
    ['limit', '12abc'],
    ['limit', '-3'],
    ['limit', '1e2'],
    ['cursor', 'not-a-cursor!'],
    ['cursor', Buffer.from('{"key":1}').toString('base64url')],
    ['cursor', Buffer.from('["a"]').toString('base64url')],
  ])('names %s when it is %j, and never echoes the value', async (field, value) => {
    const result = parsePageRequest(new URLSearchParams({ [field]: value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.map((problem) => problem.field)).toEqual([field]);
    // Through the one error shape, as a list endpoint will answer it.
    const response = errorResponse('validation_failed', { fields: result.fields });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'validation_failed',
        message: expect.any(String) as unknown,
        fields: [{ field, problem: expect.any(String) as unknown }],
      },
    });
    expect(text).not.toContain(value);
  });

  it('refuses a field given twice, and reports every bad field at once', () => {
    const twice = parsePageRequest(new URLSearchParams('limit=5&limit=6&cursor=a&cursor=b'));
    expect(twice.ok ? [] : twice.fields.map((problem) => problem.field)).toEqual([
      'limit',
      'cursor',
    ]);
  });
});

describe('the cursor needs no Node (#841, ADR 0037 D-2)', () => {
  // Every byte value's base64 digits, `+` and `/` among them, and text that is
  // not ASCII — what a base64url written out by hand gets wrong.
  const positions: readonly Position[] = [
    { key: '2026-09-01', id: 'ride-1' },
    { key: '>>>???', id: 'Zürich — 東京 🚲' },
    { key: '', id: '' },
    { key: 'a'.repeat(1), id: 'bb' },
  ];
  // Taken while Node's `Buffer` is still there, as the wire form to hold to.
  const byBuffer = positions.map((position) =>
    Buffer.from(JSON.stringify([position.key, position.id]), 'utf8').toString('base64url'),
  );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes and reads a cursor with Buffer gone, as a Durable Object has it', () => {
    vi.stubGlobal('Buffer', undefined);
    positions.forEach((position, index) => {
      const cursor = encodeCursor(position);
      expect(cursor).toBe(byBuffer[index]);
      expect(decodeCursor(cursor)).toEqual(position);
    });
  });

  it('refuses text that is not base64url at all, with Buffer gone', () => {
    vi.stubGlobal('Buffer', undefined);
    expect(decodeCursor('a')).toBeUndefined();
    expect(decodeCursor('Pz8_')).toBeUndefined();
  });
});
