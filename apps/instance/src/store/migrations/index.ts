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
import * as recoveryEmailConfirmation from './0006-recovery-email-confirmation.ts';
import * as moderation from './0007-moderation.ts';
import * as registration from './0008-registration.ts';
import * as sync from './0009-sync.ts';
import * as historyIndex from './0010-history-index.ts';
import * as raceConsent from './0011-race-consent.ts';
import * as sessionScope from './0012-session-scope.ts';
import * as privateRooms from './0013-private-rooms.ts';
import * as hostedModelKey from './0014-hosted-model-key.ts';
import * as instanceKeys from './0015-instance-keys.ts';
import * as instanceKeyLease from './0016-instance-key-lease.ts';
import * as sealedReplay from './0017-sealed-replay.ts';
import * as accountChanges from './0018-account-changes.ts';

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
  '0006-recovery-email-confirmation': recoveryEmailConfirmation,
  '0007-moderation': moderation,
  '0008-registration': registration,
  '0009-sync': sync,
  '0010-history-index': historyIndex,
  '0011-race-consent': raceConsent,
  '0012-session-scope': sessionScope,
  '0013-private-rooms': privateRooms,
  '0014-hosted-model-key': hostedModelKey,
  '0015-instance-keys': instanceKeys,
  '0016-instance-key-lease': instanceKeyLease,
  '0017-sealed-replay': sealedReplay,
  '0018-account-changes': accountChanges,
};
