// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance's round-trip persistence harness (#769) — the server-side twin
 * of `@onyourleft/store/testing` (#28).
 *
 * > **write through the port → close every connection → open a fresh one →
 * > read through the port → compare.**
 *
 * `read()` closes every store this harness has opened before it opens
 * another, so no read can be served by the connection that wrote: the
 * "wrong harness" cause of `CLAUDE.md` §5's defect shape is not expressible
 * here. The database is a FILE in a fresh temporary directory, because an
 * in-memory database cannot be reopened and a reopen is the whole point.
 *
 * The assertions throw {@link RoundTripFailure} rather than calling `expect`,
 * so one assertion body runs green against the real store and red against the
 * deliberately broken stores in `fakes.ts`. That pair is the only evidence a
 * harness can fail.
 *
 * Test support, never shipped: nothing but a test imports it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlStore } from '../open-sql-store.ts';
import type {
  ActivityRecord,
  Athlete,
  DeviceKeyWrite,
  Registration,
  Result,
  Room,
  Session,
  SqlStore,
  SyncItemWrite,
} from '../sql-store.ts';

/** Opens a store over a database file. The real one is {@link openSqlStore}. */
export type StoreFactory = (path: string) => Promise<SqlStore>;

export interface StoreHarness {
  /** The database file. */
  readonly path: string;
  /** How many stores this harness has opened, so a test can hold it to its word. */
  readonly connectionsOpened: number;
  write<T>(operation: (store: SqlStore) => Promise<T>): Promise<T>;
  /** Closes every open store, then reads through a new one. */
  read<T>(operation: (store: SqlStore) => Promise<T>): Promise<T>;
  roundTrip<T>(
    write: (store: SqlStore) => Promise<unknown>,
    read: (store: SqlStore) => Promise<T>,
  ): Promise<T>;
  /** Close everything and delete the directory. */
  destroy(): Promise<void>;
}

export async function createStoreHarness(
  factory: StoreFactory = openSqlStore,
): Promise<StoreHarness> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-instance-store-'));
  const path = join(directory, 'instance.sqlite');
  const open = new Set<SqlStore>();
  let opened = 0;

  async function closeAll(): Promise<void> {
    for (const store of [...open]) {
      open.delete(store);
      await store.close();
    }
  }

  async function fresh(): Promise<SqlStore> {
    await closeAll();
    const store = await factory(path);
    opened += 1;
    open.add(store);
    return store;
  }

  const harness: StoreHarness = {
    path,
    get connectionsOpened() {
      return opened;
    },
    write: async (operation) => {
      const store = await fresh();
      try {
        return await operation(store);
      } finally {
        await closeAll();
      }
    },
    read: async (operation) => {
      const store = await fresh();
      try {
        return await operation(store);
      } finally {
        await closeAll();
      }
    },
    roundTrip: async (write, read) => {
      await harness.write(write);
      return harness.read(read);
    },
    destroy: async () => {
      await closeAll();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return harness;
}

/** A round trip that did not come back as it went in. */
export class RoundTripFailure extends Error {
  override readonly name = 'RoundTripFailure';
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** Write a signed activity record, read it back on a fresh connection, compare every field. */
export async function assertActivityRecordRoundTrip(
  harness: StoreHarness,
  record: ActivityRecord,
): Promise<void> {
  const outcome = await harness.write((store) => store.putActivityRecord(record));
  if (outcome !== 'stored') {
    throw new RoundTripFailure(`A new record was reported as ${outcome}.`);
  }
  const read = await harness.read((store) =>
    store.getActivityRecord(record.athleteId, record.contentSha256),
  );
  if (read === undefined) throw new RoundTripFailure('The record did not come back.');
  if (
    read.athleteId !== record.athleteId ||
    read.contentSha256 !== record.contentSha256 ||
    read.receivedAt !== record.receivedAt ||
    !sameBytes(read.signedRecord, record.signedRecord)
  ) {
    throw new RoundTripFailure('The record came back different.');
  }
  const listed = await harness.read((store) => store.listActivityRecords(record.athleteId));
  if (!listed.some((each) => each.contentSha256 === record.contentSha256)) {
    throw new RoundTripFailure('The record is not in its athlete’s list.');
  }
}

/** Write an athlete, read them back on a fresh connection, compare. */
export async function assertAthleteRoundTrip(
  harness: StoreHarness,
  athlete: Athlete,
): Promise<void> {
  const read = await harness.roundTrip(
    (store) => store.putAthlete(athlete),
    (store) => store.getAthlete(athlete.id),
  );
  if (JSON.stringify(read) !== JSON.stringify(athlete)) {
    throw new RoundTripFailure('The athlete came back different.');
  }
}

// --- Fixtures: three athletes, always -----------------------------------------
//
// Two athletes cannot tell "scoped correctly" from "returns everything the
// caller is not"; the third is what separates a filter from an exclusion
// (`CLAUDE.md` §5).

export const ATHLETE_A = 'athlete-a';
export const ATHLETE_B = 'athlete-b';
export const ATHLETE_C = 'athlete-c';
export const ATHLETES = [ATHLETE_A, ATHLETE_B, ATHLETE_C] as const;

/** The one room all three rode in, so a room's results hold every athlete. */
export const SHARED_ROOM: Room = {
  id: 'room-shared',
  kind: 'race',
  visibility: 'private',
  routeSha256: 'f'.repeat(64),
  physicsVersion: 1,
};

const hexOf = (seed: string): string =>
  [...seed]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);

export function athleteFixture(id: string): Athlete {
  return { id, displayName: `Rider ${id}`, createdAt: 1_790_000_000, registrationState: 'active' };
}

export function deviceKeyFixture(athleteId: string): DeviceKeyWrite {
  return { publicKey: `key-of-${athleteId}`, athleteId, addedAt: 1_790_000_100, revokedAt: null };
}

export function sessionFixture(athleteId: string): Session {
  return {
    tokenSha256: hexOf(`session-${athleteId}`),
    athleteId,
    deviceKey: `key-of-${athleteId}`,
    expiresAt: 1_790_086_400,
    revokedAt: null,
  };
}

export function activityRecordFixture(athleteId: string, seed = 'ride'): ActivityRecord {
  return {
    athleteId,
    contentSha256: hexOf(`${seed}-${athleteId}`),
    signedRecord: new TextEncoder().encode(`signed ${seed} of ${athleteId}`),
    receivedAt: 1_790_000_200,
  };
}

export function resultFixture(athleteId: string, roomId = SHARED_ROOM.id): Result {
  return { roomId, athleteId, finishMs: 3_600_000, flags: 0 };
}

/**
 * A file all three athletes sent — two riders can upload identical bytes
 * (#776) — so a read keyed by content alone would find somebody else's record.
 */
export const SHARED_CONTENT_SHA256 = hexOf('the-same-file-for-everyone');

/**
 * One item of every kind #776's addition names but an activity — a write-up,
 * a side-camera report with its pose summary, a goal, a note and a reference
 * document — for `athleteId`. The bodies say whose they are, so a read that
 * crossed athletes would be visible in the bytes as well as in `athleteId`.
 */
export function syncItemFixtures(athleteId: string): readonly SyncItemWrite[] {
  const kinds = ['write-up', 'side-camera-report', 'goal', 'note', 'document'] as const;
  return kinds.map((kind) => ({
    athleteId,
    kind,
    key: `${kind}-of-${athleteId}`,
    body: new TextEncoder().encode(JSON.stringify({ kind, of: athleteId })),
    digest: hexOf(`${kind}-${athleteId}`),
    now: 1_790_000_400,
  }));
}

/** Every athlete-scoped row the schema has, for all three athletes. */
export async function seedWorld(store: SqlStore): Promise<void> {
  await store.putRoom(SHARED_ROOM);
  for (const athlete of ATHLETES) {
    await store.registerAthlete(registrationFixture(athlete));
    await store.putSession(sessionFixture(athlete));
    await store.putActivityRecord(activityRecordFixture(athlete));
    await store.putActivityRecord(activityRecordFixture(athlete, 'second-ride'));
    // Migration 0005's manifest (#37, #776): an ingested ride, and every other kind.
    const synced = activityRecordFixture(athlete, 'synced-ride');
    await store.ingestActivity({
      athleteId: athlete,
      contentSha256: synced.contentSha256,
      signedRecord: synced.signedRecord,
      recordSha256: hexOf(`record-${athlete}`),
      now: synced.receivedAt,
    });
    await store.ingestActivity({
      athleteId: athlete,
      contentSha256: SHARED_CONTENT_SHA256,
      signedRecord: new TextEncoder().encode(`${athlete}'s record of the shared file`),
      recordSha256: hexOf(`shared-record-${athlete}`),
      now: 1_790_000_250,
    });
    for (const item of syncItemFixtures(athlete)) await store.putSyncItem(item);
    await store.putResult(resultFixture(athlete));
    // Migration 0004's athlete-scoped tables (#772, #773, #774), one row each.
    await store.putLinkCode({
      codeSha256: hexOf(`link-${athlete}`),
      athleteId: athlete,
      mintedByKey: deviceKeyFixture(athlete).publicKey,
      expiresAt: 1_790_000_600,
    });
    await store.renameAthlete(athlete, `Renamed ${athlete}`, 1_790_000_300);
    await store.putEmailRecoveryToken({
      tokenSha256: hexOf(`email-${athlete}`),
      athleteId: athlete,
      expiresAt: 1_790_000_900,
    });
  }
}

/** A fixture athlete's registration: their first key, a recovery code and an email address. */
export function registrationFixture(athleteId: string): Registration {
  return {
    athlete: athleteFixture(athleteId),
    key: deviceKeyFixture(athleteId),
    recoveryCodeSha256s: [hexOf(`recovery-${athleteId}`)],
    recoveryEmail: `${athleteId}@example.org`,
  };
}
