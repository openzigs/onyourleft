// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FieldProblem } from './errors.ts';

/**
 * Pagination, defined once (#36).
 *
 * **Keyset, never offset.** A list is ordered by a sort key and then by the
 * row's id, and a page is "the next `limit` rows after this (key, id)". Offset
 * pagination — "skip 50, take 50" — silently repeats a row when one is inserted
 * ahead of the reader and silently skips one when a row ahead is removed, and
 * the activity list is exactly a list other devices insert into while a reader
 * pages through it. A keyset cursor names a POSITION in the order, and a row
 * inserted before that position cannot move what comes after it.
 *
 * What that guarantees, and what `pagination.test.ts` holds: every row present
 * when the first page is read, and still present when the reader reaches its
 * place, is returned **exactly once**, however many rows are inserted between
 * pages. A row inserted AFTER the reader's position may or may not appear on a
 * later page, which is correct — it did not exist when the listing began.
 *
 * ⚠️ **No route pages anything yet.** The instance's first list endpoint is
 * #776's sync, so this module has tests and no production caller; it is here
 * because #36 asks for pagination to be defined ONCE before the first list
 * exists, rather than by whichever endpoint happens to come first.
 *
 * `pageOf` is the reference semantics, over an array. A list endpoint backed by
 * SQL (#769) states the same order as `ORDER BY key, id` and the same cursor as
 * `WHERE (key, id) > (?, ?)`, and is tested against this function.
 *
 * ## The wire form
 *
 * Two query parameters, both optional: `limit` (a whole number from 1 to
 * {@link MAXIMUM_PAGE_LIMIT}, default {@link DEFAULT_PAGE_LIMIT}) and `cursor`
 * (the opaque string the previous page's `next` carried). A page's body carries
 * `items` and `next`, which is `null` on the last page. The cursor is opaque on
 * purpose: a client that parsed it would be broken by the next change to it.
 */

/** How many rows a page holds when the client does not say. */
export const DEFAULT_PAGE_LIMIT = 50;

/** The most rows one page may ask for. */
export const MAXIMUM_PAGE_LIMIT = 200;

/** A position in a list's order: the row's sort key, then its id. */
export interface Position {
  readonly key: string;
  readonly id: string;
}

/** Which way a list is ordered. The cursor comparison follows it. */
export type Direction = 'ascending' | 'descending';

/** A parsed page request. */
export interface PageRequest {
  readonly limit: number;
  readonly after: Position | undefined;
}

/** What {@link parsePageRequest} answers: a request, or the fields it got wrong. */
export type PageRequestResult =
  | { readonly ok: true; readonly request: PageRequest }
  | { readonly ok: false; readonly fields: readonly FieldProblem[] };

/** One page of a list. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/** Code-point order, so a page cannot depend on the machine's locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePositions(left: Position, right: Position): number {
  return compare(left.key, right.key) || compare(left.id, right.id);
}

/*
 * base64url (RFC 4648 §5, unpadded) over the UTF-8 bytes, written out with
 * `TextEncoder`, `btoa` and `atob` rather than Node's `Buffer` (#841): this
 * module is the one every list route will use, and a Durable Object (#781)
 * mounts the handler unchanged (ADR 0037 D-2), where `Buffer` exists only under
 * `nodejs_compat`. The bytes are the ones `Buffer`'s `base64url` wrote, which
 * `pagination.test.ts` holds, so a cursor means the same thing on either side.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Throws on text that is not base64url, which the caller reads as "not ours".
 * No padding is put back: `atob` is WHATWG's forgiving base64, which accepts
 * none, and still throws on a length that no bytes could have (`'a'`).
 */
function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** The opaque cursor for a position. */
export function encodeCursor(position: Position): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify([position.key, position.id])));
}

/** The position a cursor names, or `undefined` for anything this instance did not write. */
export function decodeCursor(cursor: string): Position | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)));
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    return undefined;
  }
  return { key: parsed[0], id: parsed[1] };
}

/**
 * Read `limit` and `cursor` from a query string. Every problem is reported by
 * the field's NAME, never with the value the client sent (`errors.ts`).
 */
export function parsePageRequest(query: URLSearchParams): PageRequestResult {
  const fields: FieldProblem[] = [];

  let limit = DEFAULT_PAGE_LIMIT;
  const limits = query.getAll('limit');
  if (limits.length > 1) {
    fields.push({ field: 'limit', problem: 'must be given at most once' });
  } else if (limits.length === 1) {
    const text = limits[0] ?? '';
    const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > MAXIMUM_PAGE_LIMIT) {
      fields.push({
        field: 'limit',
        problem: `must be a whole number from 1 to ${String(MAXIMUM_PAGE_LIMIT)}`,
      });
    } else {
      limit = value;
    }
  }

  let after: Position | undefined;
  const cursors = query.getAll('cursor');
  if (cursors.length > 1) {
    fields.push({ field: 'cursor', problem: 'must be given at most once' });
  } else if (cursors.length === 1) {
    after = decodeCursor(cursors[0] ?? '');
    if (after === undefined) {
      fields.push({ field: 'cursor', problem: 'must be a cursor this instance returned' });
    }
  }

  return fields.length > 0 ? { ok: false, fields } : { ok: true, request: { limit, after } };
}

/**
 * The page of `rows` a request asks for. `rows` need not be sorted; `positionOf`
 * says where each one is in the list's order.
 */
export function pageOf<T>(
  rows: readonly T[],
  positionOf: (row: T) => Position,
  request: PageRequest,
  direction: Direction = 'ascending',
): Page<T> {
  const sign = direction === 'ascending' ? 1 : -1;
  const ordered = [...rows].sort(
    (left, right) => sign * comparePositions(positionOf(left), positionOf(right)),
  );
  const { after } = request;
  const remaining =
    after === undefined
      ? ordered
      : ordered.filter((row) => sign * comparePositions(positionOf(row), after) > 0);
  const items = remaining.slice(0, request.limit);
  const last = items.at(-1);
  const next =
    remaining.length > items.length && last !== undefined ? encodeCursor(positionOf(last)) : null;
  return { items, next };
}
