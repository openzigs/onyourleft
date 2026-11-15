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
 * operator, from the app or the CLI, newest first — the instance's Status
 * (#2604, `status.ts`), which changes nothing and so logs nothing — and its
 * backups (#2606): the records the `backup` service writes, and "back up
 * now". Every action is WRITTEN through `SqlStore.recordOperatorAction`,
 * which applies it and logs it in one transaction.
 *
 * ## Backups: through the database, never the folders
 *
 * In the home deployment only the `backup` service mounts the backup folders,
 * and the instance holds `OYL_INSTANCE_SECRET_KEY`, which the docs keep away
 * from them (#2601's decision 5). So the instance reads backups from the
 * records that service writes, and asks for one by writing a request it picks
 * up. A record names a snapshot's directory and never the folder it is in.
 * Restore stays on the CLI.
 */

import type { ErrorCode, FieldProblem } from '../errors.ts';
import { encodeCursor, parsePageRequest, type Page } from '../pagination.ts';
import type {
  BackupRecord,
  BackupRequestOutcome,
  OperateCounts,
  OperatorLogEntry,
  SqlStore,
} from '../store/sql-store.ts';
import type { DiskSpace, KeysState, StatusSources, TunnelState } from './status.ts';

export type OperateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** The backup service's newest snapshot (#2606): `backup-loop`'s, not a one-off pre-deploy run's. */
export interface LastBackup {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly offBox: 'copied' | 'failed' | 'not-configured';
  readonly intervalSeconds: number;
}

/**
 * What the owner's Status shows that the instance reads for itself (#2604).
 * Health, version, commit and registration mode are the handler's own and
 * are added by the route. Counts and states only: nothing secret, no path.
 */
export interface InstanceStatus {
  /** Whole seconds since this process started. */
  readonly uptimeSeconds: number;
  readonly disk: readonly DiskSpace[];
  /**
   * The backup service's newest snapshot (#2606) — `null` while it has
   * recorded none: shown as "not recorded".
   */
  readonly lastBackup: LastBackup | null;
  readonly tunnel: TunnelState;
  readonly counts: OperateCounts;
  readonly keys: KeysState;
}

/** How many backup records the owner is shown, newest first (#2606). */
export const BACKUPS_SHOWN = 50;

/** The owner's view of the backups (#2606). */
export interface BackupsView {
  readonly records: readonly BackupRecord[];
  /** The "back up now" still waiting, Unix seconds, or `null`. */
  readonly pendingSince: number | null;
  /** Now, Unix seconds: what each record's age is from. */
  readonly now: number;
}

export interface Operate {
  /** The instance's own state, read-only (#2604). Writes nothing, logs nothing. */
  status(): Promise<InstanceStatus>;
  /** The operator log a page at a time, NEWEST first: `?limit=` (1–200, default 50) and `?cursor=`. */
  logPage(query: URLSearchParams): Promise<OperateResult<Page<OperatorLogEntry>>>;
  /** The newest backup records and any waiting request (#2606). Writes nothing, logs nothing. */
  backups(): Promise<BackupsView>;
  /**
   * "Back up now" (#2606), as the owner `athleteId`: the request and its
   * `backup_requested` entry in ONE transaction, or `too_many` — logged
   * `refused` — while one waits or a backup ran in the last 15 minutes.
   * Answers when it was asked, Unix seconds.
   */
  requestBackup(athleteId: string): Promise<OperateResult<{ readonly requestedAt: number }>>;
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

export function createOperate(options: {
  readonly store: SqlStore;
  /** What Status reads beyond the store (#2604): `status.ts` builds each. */
  readonly status: StatusSources;
}): Operate {
  const { store, status } = options;
  const seconds = (): number => Math.floor(status.now() / 1000);
  return {
    async status() {
      const [counts, disk, tunnel, keys, backup] = await Promise.all([
        store.operateCounts(),
        status.disk(),
        status.tunnel(),
        status.keys(),
        store.newestServiceBackup(true),
      ]);
      return {
        uptimeSeconds: Math.max(0, Math.floor((status.now() - status.startedAt) / 1000)),
        disk,
        lastBackup:
          backup === undefined || backup.offBox === null || backup.intervalSeconds === null
            ? null
            : {
                at: new Date(backup.at * 1000).toISOString(),
                offBox: backup.offBox,
                intervalSeconds: backup.intervalSeconds,
              },
        tunnel,
        counts,
        keys,
      };
    },
    async backups() {
      const [records, pending] = await Promise.all([
        store.listBackupRecords(BACKUPS_SHOWN),
        store.pendingBackupRequest(),
      ]);
      return { records, pendingSince: pending?.requestedAt ?? null, now: seconds() };
    },
    async requestBackup(athleteId) {
      const at = seconds();
      const { value } = await store.recordOperatorAction<BackupRequestOutcome>(
        { actor: { source: 'app', athleteId }, action: 'backup_requested', at },
        async (inside) => {
          const asked = await inside.requestBackup(at);
          return asked.outcome === 'requested'
            ? { outcome: 'done', value: asked }
            : { outcome: 'refused', detail: asked.outcome, value: asked };
        },
      );
      return value.outcome === 'requested'
        ? { ok: true, value: { requestedAt: value.request.requestedAt } }
        : { ok: false, code: 'too_many' };
    },
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
