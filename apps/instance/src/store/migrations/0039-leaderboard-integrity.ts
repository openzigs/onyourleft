// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0039 (#69): **leaderboard integrity** — what keeps an impossible
 * time and a flagged one off a shared board, and the record of each.
 *
 * - **`segment_effort.excluded_reason`** — why the instance's own rule
 *   (`@onyourleft/domain` §`implausibleEffort`) excluded an effort when it was
 *   shared, in words, or `NULL`. The effort stays: its rider still sees it,
 *   with the reason, on their own board.
 * - **`segment_flag`** — one rider's flag: an effort on a segment
 *   (`effort_id`), or the segment itself as hazardous (`effort_id` NULL), with
 *   a reason from a closed list and when. A flagged effort leaves every shared
 *   board; a hazardous segment awards nothing to anybody. `athlete_id` is the
 *   FLAGGER, so the schema-derived erasure takes a rider's flags with them.
 *   `segment_id` and `effort_id` carry no foreign key, for 0038's reason: a
 *   flag is one athlete's row about another's.
 * - **`segment_integrity_log`** — every exclusion and every flag, with its
 *   actor (`NULL` for the instance's own rule), the athlete it was about, the
 *   segment, the effort and the reason. ⚠️ **Append-only in the schema**, as
 *   the moderation log is (#83): two triggers abort any `UPDATE` or `DELETE`,
 *   because moderation without an audit trail is unappealable. Its athlete
 *   columns carry no foreign key, so erasing an account leaves the record of
 *   what was done, and `down` is refused while it holds an entry.
 *
 * `segment_flag_by_effort` and `segment_flag_by_segment` answer the board's
 * two `not exists`; `segment_flag_by_flagger` the per-athlete rate limit.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('segment_effort').addColumn('excluded_reason', 'text').execute();
  await db.schema
    .createTable('segment_flag')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('segment_id', 'text', (column) => column.notNull())
    .addColumn('effort_id', 'text')
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('segment_flag_by_effort')
    .on('segment_flag')
    .column('effort_id')
    .execute();
  await db.schema
    .createIndex('segment_flag_by_segment')
    .on('segment_flag')
    .columns(['segment_id', 'effort_id'])
    .execute();
  await db.schema
    .createIndex('segment_flag_by_flagger')
    .on('segment_flag')
    .columns(['athlete_id', 'created_at'])
    .execute();
  await db.schema
    .createTable('segment_integrity_log')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('action', 'text', (column) =>
      column.notNull().check(sql`action in ('excluded', 'flagged_effort', 'flagged_hazardous')`),
    )
    .addColumn('actor_athlete_id', 'text')
    .addColumn('subject_athlete_id', 'text')
    .addColumn('segment_id', 'text', (column) => column.notNull())
    .addColumn('effort_id', 'text')
    .addColumn('reason', 'text', (column) => column.notNull())
    .modifyEnd(sql`strict`)
    .execute();
  await sql`create trigger segment_integrity_log_no_update before update on segment_integrity_log
    begin select raise(abort, 'segment_integrity_log is append-only'); end`.execute(db);
  await sql`create trigger segment_integrity_log_no_delete before delete on segment_integrity_log
    begin select raise(abort, 'segment_integrity_log is append-only'); end`.execute(db);
}

/** What `down` throws when the log holds an entry. */
export class IntegrityLogNotEmptyError extends Error {
  override readonly name = 'IntegrityLogNotEmptyError';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const held = await sql<{ n: number }>`select count(*) as n from segment_integrity_log`.execute(
    db,
  );
  if (Number(held.rows[0]?.n ?? 0) > 0) {
    throw new IntegrityLogNotEmptyError(
      'Migration 0039 cannot be undone: the leaderboard integrity log holds entries, and undoing it would delete them. Nothing was changed.',
    );
  }
  await sql`drop trigger segment_integrity_log_no_delete`.execute(db);
  await sql`drop trigger segment_integrity_log_no_update`.execute(db);
  await db.schema.dropTable('segment_integrity_log').execute();
  await db.schema.dropIndex('segment_flag_by_flagger').execute();
  await db.schema.dropIndex('segment_flag_by_segment').execute();
  await db.schema.dropIndex('segment_flag_by_effort').execute();
  await db.schema.dropTable('segment_flag').execute();
  await db.schema.alterTable('segment_effort').dropColumn('excluded_reason').execute();
}
