// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Operate** (#2601): the owner-only area of the app for running the
 * instance, and this — its instance half (#2602).
 *
 * Who may reach it is not decided here. Every Operate route declares
 * `reaches: 'owner'` (`route-kit.ts` §`Reach`), and the handler answers
 * anybody but the athlete holding `OYL_INSTANCE_OWNER_KEY` — the deputy
 * included (ADR 0046 D-9 Q9: the deputy key does not make its athlete the
 * operator) — `not_found`, as though the route were not there, before the
 * route is called. On an instance with no `OYL_INSTANCE_SECRET_KEY`, which
 * seals nothing, every Operate route answers `unavailable` naming it, rather
 * than serving an admin surface in plaintext through the tunnel (ADR 0047
 * D-7, D-13).
 *
 * What it holds today is the operator log's read: every action taken as the
 * operator, from the app or the CLI, newest first. Every action is WRITTEN
 * through `SqlStore.recordOperatorAction`, which applies it and logs it in
 * one transaction; this module only reads.
 */

import type { ErrorCode, FieldProblem } from '../errors.ts';
import { encodeCursor, parsePageRequest, type Page } from '../pagination.ts';
import type { OperatorLogEntry, SqlStore } from '../store/sql-store.ts';

export type OperateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

export interface Operate {
  /** The operator log a page at a time, NEWEST first: `?limit=` (1–200, default 50) and `?cursor=`. */
  logPage(query: URLSearchParams): Promise<OperateResult<Page<OperatorLogEntry>>>;
}

/** What `unavailable` says on an instance with no keys. Names the variable, never a value. */
export const OPERATE_NEEDS_KEYS =
  'This instance offers no Operate area: OYL_INSTANCE_SECRET_KEY is not set, so nothing here is sealed, and the owner’s area is not served in plaintext.';

/** What a cursor this instance did not write is refused with, by name and never by value. */
const NOT_OUR_CURSOR: readonly FieldProblem[] = [
  { field: 'cursor', problem: 'must be a cursor this instance returned' },
];

/** The cursor's key: an operator log position, and nothing else's. */
const CURSOR_KEY = 'operator-log';

export function createOperate(options: { readonly store: SqlStore }): Operate {
  const { store } = options;
  return {
    async logPage(query) {
      const request = parsePageRequest(query);
      if (!request.ok) return { ok: false, code: 'validation_failed', fields: request.fields };
      const { limit, after } = request.request;
      let beforeId: number | undefined;
      if (after !== undefined) {
        // Only a forged cursor carries an id the log could not have written.
        if (after.key !== CURSOR_KEY || !/^[1-9][0-9]{0,15}$/.test(after.id)) {
          return { ok: false, code: 'validation_failed', fields: NOT_OUR_CURSOR };
        }
        beforeId = Number(after.id);
        if (!Number.isSafeInteger(beforeId)) {
          return { ok: false, code: 'validation_failed', fields: NOT_OUR_CURSOR };
        }
      }
      // One row more than the page says whether there is a next one.
      const rows = await store.listOperatorLogPage(beforeId, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        ok: true,
        value: {
          items,
          next:
            rows.length > limit && last !== undefined
              ? encodeCursor({ key: CURSOR_KEY, id: String(last.id) })
              : null,
        },
      };
    },
  };
}
