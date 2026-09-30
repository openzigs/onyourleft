// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0010 (#835, ADR 0040): the history index — the passages the
 * analysis's history step may be shown, and their vectors.
 *
 * ⚠️ **An index, never a store of record** (ADR 0040 D-1). Every row here is
 * cut from a live `sync_item` the device synced, and deleting every row loses
 * nothing: `history/history.ts` rebuilds it from those items. So neither table
 * is in the account export (D-10), and both go with the account because both
 * name their owner in `athlete_id` REFERENCES `athlete`, which is how
 * `sql-store.ts` §`athleteTablesInErasureOrder` finds a table to erase.
 *
 * - **`history_source`** — one row per synced item that has been indexed: which
 *   item (`source_kind`, `source_key`), the digest of the body it was cut from,
 *   the model and prefix convention that embedded it, and how it went
 *   (`outcome`: `indexed`, `empty`, `too-long` or `picture`). An item with no
 *   row here for the configured model and convention, or with a row for an
 *   older digest, is waiting to be indexed. A source that yields no passage
 *   still gets a row, so it is not tried again on every sweep.
 * - **`history_passage`** — one row per passage: its ordinal within its
 *   source, the passage text (kept so a change of model can re-embed it, D-7),
 *   the model's name, the vector's dimension, the prefix convention, and the
 *   vector itself as little-endian `Float32` bytes, unit length (D-4).
 *
 * Retrieval reads passages by `(athlete_id, model, dimension, convention)`,
 * which is the index below: rows of another model are never read, let alone
 * ranked (D-7).
 */

import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('history_source')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('source_kind', 'text', (column) => column.notNull())
    .addColumn('source_key', 'text', (column) => column.notNull())
    .addColumn('source_digest', 'text', (column) => column.notNull())
    .addColumn('model', 'text', (column) => column.notNull())
    .addColumn('convention', 'text', (column) => column.notNull())
    .addColumn('outcome', 'text', (column) => column.notNull())
    .addColumn('passages', 'integer', (column) => column.notNull())
    .addColumn('indexed_at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('history_source_key', ['athlete_id', 'source_kind', 'source_key'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createTable('history_passage')
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('source_kind', 'text', (column) => column.notNull())
    .addColumn('source_key', 'text', (column) => column.notNull())
    .addColumn('ordinal', 'integer', (column) => column.notNull())
    .addColumn('passage', 'text', (column) => column.notNull())
    .addColumn('model', 'text', (column) => column.notNull())
    .addColumn('dimension', 'integer', (column) => column.notNull())
    .addColumn('convention', 'text', (column) => column.notNull())
    .addColumn('vector', 'blob', (column) => column.notNull())
    .addPrimaryKeyConstraint('history_passage_key', [
      'athlete_id',
      'source_kind',
      'source_key',
      'ordinal',
    ])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('history_passage_by_model')
    .on('history_passage')
    .columns(['athlete_id', 'model', 'dimension', 'convention'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('history_passage_by_model').execute();
  await db.schema.dropTable('history_passage').execute();
  await db.schema.dropTable('history_source').execute();
}
