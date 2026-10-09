// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0020 (#1095, ADR 0046 D-11): the analysis jobs and their events.
 *
 * - **`analysis_job`** — one post-ride write-up a device asked its instance
 *   for: whose it is, which source it runs on, the device-built input (#809's
 *   exclusions, checked again on the way in), its status, and — only once it
 *   has passed the screen — the write-up itself (`candidate`), kept until the
 *   device acknowledges it has saved it or the job's retention ends.
 * - **`analysis_event`** — what a job's stream carries, numbered per job from
 *   1: progress (a step, or a tool by name), a screened section, a
 *   withdrawal, and the result. Never a tool's arguments or results.
 *
 * Both name their athlete in `athlete_id`, referencing `athlete`, so
 * `eraseAthlete` (which derives its tables from the foreign keys to
 * `athlete`) empties both with no edit; and an event references its job as
 * `(job_id, athlete_id)`, the #842 rule, so one athlete's event can never
 * hang off another athlete's job.
 *
 * `down` drops both tables, rows and all: an instance rolled back past this
 * forgets every job, and runs a version that never started one.
 */

import { sql, type Kysely } from 'kysely';

/** Every status a job can be in. `queued` and `running` are the two that have not ended. */
export const ANALYSIS_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'withheld',
] as const;

/** The two sources a job may name (ADR 0046 D-9). */
export const ANALYSIS_JOB_SOURCES = ['instance-local', 'instance-hosted'] as const;

/** Every kind of event a job's stream carries. */
export const ANALYSIS_EVENT_KINDS = ['progress', 'section', 'withdrawn', 'result'] as const;

const quoted = (values: readonly string[]): string => values.map((each) => `'${each}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('analysis_job')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('status', 'text', (column) =>
      column.notNull().check(sql.raw(`status IN (${quoted(ANALYSIS_JOB_STATUSES)})`)),
    )
    .addColumn('source', 'text', (column) =>
      column.notNull().check(sql.raw(`source IN (${quoted(ANALYSIS_JOB_SOURCES)})`)),
    )
    .addColumn('template_version', 'text', (column) => column.notNull())
    .addColumn('input_json', 'text', (column) => column.notNull())
    .addColumn('candidate', 'text')
    .addColumn('failure', 'text')
    .addColumn('created_at', 'integer', (column) => column.notNull())
    .addColumn('ended_at', 'integer')
    .addUniqueConstraint('analysis_job_of_its_athlete', ['id', 'athlete_id'])
    .modifyEnd(sql`strict`)
    .execute();
  await db.schema
    .createIndex('analysis_job_by_athlete')
    .on('analysis_job')
    .columns(['athlete_id', 'status'])
    .execute();
  await db.schema
    .createIndex('analysis_job_by_status')
    .on('analysis_job')
    .columns(['status', 'created_at'])
    .execute();
  await db.schema
    .createTable('analysis_event')
    .addColumn('job_id', 'text', (column) => column.notNull())
    .addColumn('athlete_id', 'text', (column) => column.notNull().references('athlete.id'))
    .addColumn('seq', 'integer', (column) => column.notNull())
    .addColumn('kind', 'text', (column) =>
      column.notNull().check(sql.raw(`kind IN (${quoted(ANALYSIS_EVENT_KINDS)})`)),
    )
    .addColumn('data', 'text', (column) => column.notNull())
    .addColumn('at', 'integer', (column) => column.notNull())
    .addPrimaryKeyConstraint('analysis_event_key', ['job_id', 'seq'])
    .addForeignKeyConstraint(
      'analysis_event_of_its_athletes_job',
      ['job_id', 'athlete_id'],
      'analysis_job',
      ['id', 'athlete_id'],
    )
    .modifyEnd(sql`strict`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('analysis_event').execute();
  await db.schema.dropTable('analysis_job').execute();
}
