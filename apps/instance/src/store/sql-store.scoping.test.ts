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
  createStoreHarness,
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
      return found;
    },
  },
  listActivityRecords: { probe: (store, athleteId) => store.listActivityRecords(athleteId) },
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

  findSession: {
    notAScopedRead: 'authentication: the token is what names the athlete (#772)',
  },
  findDeviceKey: {
    notAScopedRead: 'authentication: the public key is what names the athlete (#772)',
  },
  takeChallenge: { notAScopedRead: 'spends a nonce, issued before any athlete is named (#772)' },
  pruneChallenges: { notAScopedRead: 'a write over challenges, which belong to no athlete' },
  takeRecoveryCode: { notAScopedRead: 'recovery: the code is what names the athlete (#773)' },
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
  listRoomResults: { notAScopedRead: 'a finish order is every rider’s, by design (ADR 0037)' },
  putAthlete: { notAScopedRead: 'a write' },
  putDeviceKey: { notAScopedRead: 'a write; ownership is sql-store.test.ts’s' },
  putSession: { notAScopedRead: 'a write; ownership is sql-store.test.ts’s' },
  putActivityRecord: { notAScopedRead: 'a write' },
  putRoom: { notAScopedRead: 'a write' },
  putResult: { notAScopedRead: 'a write' },
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
