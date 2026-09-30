// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every migration, in order, keyed by its file name (#769).
 *
 * Written out rather than discovered at run time, because discovery needs a
 * filesystem and a dynamic `import()`, and the store has to mount unchanged
 * under a Durable Object (ADR 0037 D-2), which has neither. ⚠️ **A hand list
 * is the thing that goes stale**, so `migrations.test.ts` reads this directory
 * and fails when a file is missing from here or named here without existing —
 * and it runs its up/down/up check over the DIRECTORY, not over this list.
 *
 * The type makes `down` REQUIRED. Kysely's own `Migration.down` is optional and
 * its `migrateDown` silently skips a migration without one (#769), so this is
 * where "every migration is reversible" stops being a promise.
 */

import type { Kysely } from 'kysely';
import * as athletesKeysSessions from './0001-athletes-keys-sessions.ts';
import * as activityRecords from './0002-activity-records.ts';
import * as roomsAndResults from './0003-rooms-and-results.ts';
import * as identity from './0004-identity.ts';
import * as roomCourses from './0005-room-courses.ts';

/** A migration this repository accepts: both directions. */
export interface InstanceMigration {
  readonly up: (db: Kysely<unknown>) => Promise<void>;
  readonly down: (db: Kysely<unknown>) => Promise<void>;
}

export const MIGRATIONS: Readonly<Record<string, InstanceMigration>> = {
  '0001-athletes-keys-sessions': athletesKeysSessions,
  '0002-activity-records': activityRecords,
  '0003-rooms-and-results': roomsAndResults,
  '0004-identity': identity,
  '0005-room-courses': roomCourses,
};
