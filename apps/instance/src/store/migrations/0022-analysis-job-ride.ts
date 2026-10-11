// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Migration 0022 (#1229): **`analysis_job.ride_id`** — which of the athlete's
 * synced rides a job writes up, when the device named one.
 *
 * It is the ride's own id (the signed record's `claims.activityId`, the key a
 * ride's write-up, note and side-camera report sync under), checked at the
 * start to be one of the session athlete's live synced rides
 * (`analysis/jobs.ts` §`start`), and handed to the agent as `rideId` — so the
 * history tool (ADR 0040 D-2) dates the other rides it finds against this one
 * and leaves this one out. `NULL` is a job that named none: the device had not
 * synced the ride, and the history tool says no ride's age.
 *
 * No foreign key: an activity record is keyed by its content hash, not by this
 * id, and a ride deleted while its job runs only leaves the job unable to date
 * anything. The row goes with its job, and the job with its athlete.
 *
 * `down` drops the column. An instance rolled back forgets which ride each job
 * was about, which only its history tool ever read.
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('analysis_job').addColumn('ride_id', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('analysis_job').dropColumn('ride_id').execute();
}
