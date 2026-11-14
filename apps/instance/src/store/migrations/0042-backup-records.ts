// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0042 (#2606): **each backup, recorded; and the owner's "back up
 * now"**. In the home deployment only the `backup` service mounts the backup
 * folders, so the instance learns about backups from the database, and asks
 * for one through it (#2601's decision 5).
 *
 * - **`backup_record`** — one row per run of `backup` or `backup-loop`: when
 *   it started (`at`, Unix seconds), whether it made a snapshot (`outcome`:
 *   `done` or `failed`), a failed run's error by NAME only (never its
 *   message, which may hold a path), and for a snapshot its directory's NAME
 *   (`snapshot-<time>`, never the folder it is in), its row and blob counts
 *   and database SHA-256 from its manifest, its size, how its off-box copy
 *   went, how many old snapshots `--keep` removed, and the free space where
 *   the snapshots and the off-box copies go. `interval_seconds` is the
 *   backup service's interval, set only by `backup-loop`: a one-off run (the
 *   pre-deploy snapshot) has none. A run deletes every record more than 30
 *   days older than itself, so the table never outlives the 30-day backup
 *   limit (#1381).
 * - **`backup_request`** — "back up now", from the Operate area: when it was
 *   asked for, and the record of the run that served it (`record_id`), or
 *   `NULL` while it waits. `backup-loop` serves it in the same transaction
 *   as it writes the record, so a request is served once. It names no
 *   athlete: the operator log says who asked.
 *
 * Neither table is append-only: the 30-day limit deletes from both. `down`
 * drops both, rows and all — they are a cache of what the backup folders
 * hold, and the next run writes a record again.
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('backup_record')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addColumn('outcome', 'text', (column) =>
      column.notNull().check(sql`outcome in ('done', 'failed')`),
    )
    // A name such as `Error` or `ENOSPC`, never a message.
    .addColumn('error', 'text', (column) =>
      column.check(
        sql`error is null or (length(error) between 1 and 64 and error not glob '*[^A-Za-z0-9_]*')`,
      ),
    )
    // A directory's name, never a path.
    .addColumn('snapshot', 'text', (column) =>
      column.check(
        sql`snapshot is null or (snapshot glob 'snapshot-*' and snapshot not glob '*[^A-Za-z0-9-]*')`,
      ),
    )
    .addColumn('row_count', 'integer')
    .addColumn('blob_count', 'integer')
    .addColumn('database_sha256', 'text', (column) =>
      column.check(
        sql`database_sha256 is null or (length(database_sha256) = 64 and database_sha256 not glob '*[^0-9a-f]*')`,
      ),
    )
    .addColumn('size_bytes', 'integer')
    .addColumn('off_box', 'text', (column) =>
      column.check(sql`off_box is null or off_box in ('copied', 'failed', 'not-configured')`),
    )
    .addColumn('removed', 'integer')
    .addColumn('backups_free_bytes', 'integer')
    .addColumn('off_box_free_bytes', 'integer')
    .addColumn('interval_seconds', 'integer')
    .addCheckConstraint(
      'backup_record_outcome',
      sql`(outcome = 'done' and error is null and snapshot is not null and off_box is not null)
        or (outcome = 'failed' and error is not null)`,
    )
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema.createIndex('backup_record_at').on('backup_record').column('at').execute();
  await db.schema
    .createTable('backup_request')
    .addColumn('id', 'integer', (column) => column.primaryKey())
    .addColumn('requested_at', 'integer', (column) => column.notNull())
    .addColumn('record_id', 'integer')
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('backup_request_pending')
    .on('backup_request')
    .column('id')
    .where(sql.ref('record_id'), 'is', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('backup_request_pending').execute();
  await db.schema.dropTable('backup_request').execute();
  await db.schema.dropIndex('backup_record_at').execute();
  await db.schema.dropTable('backup_record').execute();
}
