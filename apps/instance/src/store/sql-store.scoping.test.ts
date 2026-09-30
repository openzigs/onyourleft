// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every athlete-scoped read, proved not to return another athlete's rows**
 * (#769; the server side of `packages/store`'s `activity-store.scoping.test.ts`).
 *
 * ## Derived from the port, not written down beside it
 *
 * {@link SCOPING} is a `Record` over `keyof SqlStore`, so a member added to the
 * port is a COMPILE error here until somebody says what it is: a read with a
 * probe, or something else with the reason it is not an athlete-scoped read.
 * And the store's own keys are compared with the table at run time, so a
 * member the implementation grows beyond the interface fails too.
 *
 * ## Three athletes, and the caller's rows must be there
 *
 * Every probe runs against a world where all three athletes have a row in
 * every table, as each of the three. It must return at least one row, all of
 * them the caller's: a read that returned nothing would pass "none of B's" and
 * prove nothing, and with only two athletes "not B's" and "A's" are the same
 * set.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlStore } from './sql-store.ts';
import {
  activityRecordFixture,
  ATHLETES,
  SHARED_CONTENT_SHA256,
  syncItemFixtures,
  createStoreHarness,
  HISTORY_FIXTURE_CONVENTION,
  HISTORY_FIXTURE_DIMENSION,
  HISTORY_FIXTURE_MODEL,
  seedWorld,
  type StoreHarness,
} from './testing/index.ts';

interface Owned {
  readonly athleteId?: string;
  readonly id?: string;
}

/** A read as `athleteId`, answering every row it returned. */
type Probe = (store: SqlStore, athleteId: string) => Promise<readonly Owned[]>;

type Entry = { readonly probe: Probe } | { readonly notAScopedRead: string };

/** Which athlete a fixture item key belongs to: `…-of-<athlete>`. */
const ownerOfKey = (key: string): string => key.slice(key.lastIndexOf('-of-') + 4);

const one = (row: Owned | undefined): readonly Owned[] => (row === undefined ? [] : [row]);

const SCOPING: Readonly<Record<keyof SqlStore, Entry>> = {
  getAthlete: {
    probe: async (store, athleteId) =>
      one(await store.getAthlete(athleteId)).map((row) => ({ athleteId: row.id })),
  },
  listDeviceKeys: { probe: (store, athleteId) => store.listDeviceKeys(athleteId) },
  listSessions: { probe: (store, athleteId) => store.listSessions(athleteId) },
  getActivityRecord: {
    probe: async (store, athleteId) => {
      // Asked for EVERY athlete's content key: only the caller's may answer.
      const found: Owned[] = [];
      for (const owner of ATHLETES) {
        const row = await store.getActivityRecord(
          athleteId,
          activityRecordFixture(owner).contentSha256,
        );
        if (row !== undefined) found.push(row);
      }
      // And the file every athlete sent: the same key, three owners (#776).
      const shared = await store.getActivityRecord(athleteId, SHARED_CONTENT_SHA256);
      if (shared !== undefined) found.push(shared);
      return found;
    },
  },
  listActivityPage: {
    probe: async (store, athleteId) =>
      (await store.listActivityPage(athleteId, undefined, 1000)).map((row) => row.record),
  },
  listSyncManifest: {
    probe: (store, athleteId) => store.listSyncManifest(athleteId, undefined, 1000),
  },
  getSyncItem: {
    probe: async (store, athleteId) => {
      // Every athlete's key of every kind, asked as the caller (#776's addition).
      const found: Owned[] = [];
      for (const owner of ATHLETES) {
        for (const item of syncItemFixtures(owner)) {
          const row = await store.getSyncItem(athleteId, item.kind, item.key);
          if (row !== undefined) found.push(row);
        }
        const activity = await store.getSyncItem(athleteId, 'activity', SHARED_CONTENT_SHA256);
        if (activity !== undefined) found.push(activity);
      }
      return found;
    },
  },
  listActivityRecords: { probe: (store, athleteId) => store.listActivityRecords(athleteId) },
  // #835, ADR 0040 D-3 and OWASP LLM08:2025's partitioning: the history index.
  // Each passage is labelled with its source's key, which names its owner, so
  // a passage of another athlete's is visible as theirs.
  listHistoryPassages: {
    probe: async (store, athleteId) =>
      (
        await store.listHistoryPassages(
          athleteId,
          HISTORY_FIXTURE_MODEL,
          HISTORY_FIXTURE_DIMENSION,
          HISTORY_FIXTURE_CONVENTION,
        )
      ).map((passage) => ({ athleteId: ownerOfKey(passage.key) })),
  },
  summariseHistoryIndex: {
    // A count, held to the caller's own passages: an unscoped count is every
    // athlete's three times over.
    probe: async (store, athleteId) => {
      const own = await store.listHistoryPassages(
        athleteId,
        HISTORY_FIXTURE_MODEL,
        HISTORY_FIXTURE_DIMENSION,
        HISTORY_FIXTURE_CONVENTION,
      );
      const summary = await store.summariseHistoryIndex(athleteId);
      const counted = summary.reduce((sum, row) => sum + row.passages, 0);
      return counted === own.length && own.length > 0
        ? own.map((passage) => ({ athleteId: ownerOfKey(passage.key) }))
        : [{ athleteId: `counted ${String(counted)}` }];
    },
  },
  listResults: { probe: (store, athleteId) => store.listResults(athleteId) },
  listRecoveryCodes: { probe: (store, athleteId) => store.listRecoveryCodes(athleteId) },
  listLinkCodes: { probe: (store, athleteId) => store.listLinkCodes(athleteId) },
  listDisplayNameChanges: {
    probe: (store, athleteId) => store.listDisplayNameChanges(athleteId),
  },
  getRecoveryEmail: {
    probe: async (store, athleteId) => one(await store.getRecoveryEmail(athleteId)),
  },
  listEmailConfirmations: {
    probe: (store, athleteId) => store.listEmailConfirmations(athleteId),
  },
  listEmailRecoveryTokens: {
    probe: (store, athleteId) => store.listEmailRecoveryTokens(athleteId),
  },
  listBlocks: { probe: (store, athleteId) => store.listBlocks(athleteId) },
  listInviteCodes: { probe: (store, athleteId) => store.listInviteCodes(athleteId) },
  countActivityRecords: {
    // A count, held to the caller's own rows: an unscoped count is every
    // athlete's, which the listing (probed above) is not.
    probe: async (store, athleteId) => {
      const own = await store.listActivityRecords(athleteId);
      const counted = await store.countActivityRecords(athleteId);
      return counted === own.length ? own : [{ athleteId: `counted ${String(counted)}` }];
    },
  },
  listReports: {
    probe: async (store, athleteId) =>
      (await store.listReports(athleteId)).map((report) => ({ athleteId: report.athleteId })),
  },

  findSession: {
    notAScopedRead: 'authentication: the token is what names the athlete (#772)',
  },
  findDeviceKey: {
    notAScopedRead: 'authentication: the public key is what names the athlete (#772)',
  },
  takeChallenge: { notAScopedRead: 'spends a nonce, issued before any athlete is named (#772)' },
  pruneChallenges: { notAScopedRead: 'a write over challenges, which belong to no athlete' },
  takeRecoveryCode: { notAScopedRead: 'recovery: the code is what names the athlete (#773)' },
  hasRecoveryCode: {
    notAScopedRead:
      'a yes or no, keyed by the athlete: sql-store.identity.test.ts holds it to its own athlete (#898)',
  },
  takeLinkCode: { notAScopedRead: 'linking: the code is what names the athlete (#773)' },
  findRecoveryEmail: { notAScopedRead: 'email recovery: the address names the athlete (#773)' },
  takeEmailRecoveryToken: {
    notAScopedRead: 'email recovery: the token is what names the athlete (#773)',
  },
  touchDeviceKey: { notAScopedRead: 'a write; scoping is sql-store.test.ts’s' },
  revokeDeviceKey: { notAScopedRead: 'a write; scoping is sql-store.test.ts’s' },
  revokeSession: { notAScopedRead: 'a write; scoping is sql-store.test.ts’s' },
  registerAthlete: { notAScopedRead: 'a write; ownership is sql-store.test.ts’s' },
  putChallenge: { notAScopedRead: 'a write' },
  putLinkCode: { notAScopedRead: 'a write; the schema holds the minting key to its athlete' },
  renameAthlete: { notAScopedRead: 'a write; scoping is sql-store.test.ts’s' },
  putEmailRecoveryToken: { notAScopedRead: 'a write' },
  putEmailConfirmation: { notAScopedRead: 'a write' },
  confirmRecoveryEmail: { notAScopedRead: 'a write; scoping is sql-store.identity.test.ts’s' },
  getRoom: { notAScopedRead: 'a room belongs to no athlete' },
  getRoomCourse: { notAScopedRead: 'a room’s course belongs to the room, not to an athlete' },
  listRoomResults: { notAScopedRead: 'a finish order is every rider’s, by design (ADR 0037)' },
  putAthlete: { notAScopedRead: 'a write' },
  putDeviceKey: { notAScopedRead: 'a write; ownership is sql-store.test.ts’s' },
  putSession: { notAScopedRead: 'a write; ownership is sql-store.test.ts’s' },
  putActivityRecord: { notAScopedRead: 'a write' },
  ingestActivity: {
    notAScopedRead: 'a write; its scoping is sync/ingest.test.ts’s (two athletes, one file)',
  },
  listPendingHistorySources: {
    notAScopedRead:
      'the indexer’s sweep over every athlete’s items: each row names its owner, and it is written back under that owner only (history.test.ts, #835)',
  },
  putHistoryIndex: {
    notAScopedRead: 'a write; it checks the item is the athlete’s own and live (history.test.ts)',
  },
  putSyncItem: {
    notAScopedRead: 'a write; its scoping is sync/manifest.test.ts’s (cross-athlete PUT)',
  },
  deleteSyncItem: {
    notAScopedRead: 'a write; its scoping is sync/manifest.test.ts’s (cross-athlete DELETE)',
  },
  setActivityMayBeRaced: {
    notAScopedRead:
      'a write; its scoping is sync/race-consent.test.ts’s (another athlete’s record, asked for as the caller)',
  },
  listRaceableActivities: {
    notAScopedRead:
      'cross-athlete BY DESIGN (ADR 0039 D-2): other riders’ consented rides, never the requester’s own; sync/race-consent.test.ts holds the consent and the exclusion',
  },
  isContentHeld: {
    notAScopedRead:
      'blob collection: whether ANY athlete holds a file, answered as a boolean and never as a row (#35)',
  },
  putRoom: { notAScopedRead: 'a write' },
  putRoomCourse: { notAScopedRead: 'a write' },
  markRaceStarted: { notAScopedRead: 'a write' },
  markRaceFinished: { notAScopedRead: 'a write' },
  putResult: { notAScopedRead: 'a write' },
  createPrivateRoom: { notAScopedRead: 'a write; its creator is the caller (rooms/rooms.test.ts)' },
  getPrivateRoom: { notAScopedRead: 'a room belongs to no athlete' },
  findPrivateRoomByCode: {
    notAScopedRead: 'a room by its code’s digest: whoever holds the code may join (#784)',
  },
  addRoomMember: { notAScopedRead: 'a write' },
  isRoomMember: {
    notAScopedRead:
      'a yes or no for ONE (room, athlete) pair, never a row; rooms/rooms.test.ts holds a non-member refused',
  },
  closePrivateRoom: { notAScopedRead: 'a write' },
  countOpenPrivateRoomsMadeBy: {
    notAScopedRead:
      'a count of the CALLER’s own open rooms, never a row; sql-store.rooms.test.ts holds another athlete’s rooms out of it',
  },
  listOpenPrivateRoomsMadeBy: {
    notAScopedRead:
      'the ids of the CALLER’s own open rooms, for their erasure — never another table’s rows; sql-store.rooms.test.ts holds the other athletes’ rooms out of it',
  },
  listOpenPrivateRooms: {
    notAScopedRead: 'the rooms’ sweep: every open room, by id and age, naming nobody (#784)',
  },
  countOpenPrivateRoomsWithRoute: {
    notAScopedRead: 'blob collection: a count across rooms, never a row (#784)',
  },
  sight: {
    notAScopedRead: 'a pair of athletes, either way round: the choke point asks it (#83)',
  },
  listOpenReports: { notAScopedRead: 'the moderators’ queue: every open report (#83)' },
  listModerationLog: { notAScopedRead: 'the moderators’ record: every action (#83)' },
  putBlock: { notAScopedRead: 'a write' },
  deleteBlock: { notAScopedRead: 'a write; scoping is sql-store.moderation.test.ts’s' },
  putReport: { notAScopedRead: 'a write' },
  moderate: { notAScopedRead: 'a moderator’s write; sql-store.moderation.test.ts' },
  logRefusedAction: { notAScopedRead: 'a write to the moderators’ log; moderation.test.ts' },
  listPendingAthletes: { notAScopedRead: 'the moderators’ approval queue (#775)' },
  confirmAdult: { notAScopedRead: 'a write; registration.test.ts' },
  mintInviteCode: { notAScopedRead: 'a moderator’s write, logged with it (#775)' },
  eraseAthlete: { notAScopedRead: 'erasure: sql-store.erasure.test.ts' },
  close: { notAScopedRead: 'not a read' },
};

let harness: StoreHarness;
beforeAll(async () => {
  harness = await createStoreHarness();
  await harness.write(seedWorld);
});
afterAll(() => harness.destroy());

describe('athlete scoping (#769)', () => {
  it('has an entry for every member the store actually has, and no other', async () => {
    const members = await harness.read((store) => Promise.resolve(Object.keys(store).sort()));
    expect(members.length).toBeGreaterThan(0);
    expect(members).toEqual(Object.keys(SCOPING).sort());
  });

  const probes = Object.entries(SCOPING).flatMap(([member, entry]) =>
    'probe' in entry ? [[member, entry.probe] as const] : [],
  );

  it('probes at least one read', () => {
    expect(probes.length).toBeGreaterThan(0);
  });

  describe.each(probes)('%s', (_member, probe) => {
    it.each(ATHLETES)('as %s, returns that athlete’s rows and nobody else’s', async (caller) => {
      const rows = await harness.read((store) => probe(store, caller));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.athleteId).toBe(caller);
    });
  });
});
