// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Segments and leaderboards on an instance (#68), end to end against the REAL
 * instance: Bea publishes a segment cut from her own ride and shares her
 * effort on it; Anna, a different athlete, finds it in the instance's list,
 * adds it to her device, and reads Bea's time on its board — every request
 * sealed. Then everything that must send nothing: a private segment, an end in
 * a privacy zone, no instance, and an answer that is not what it claims.
 */

import { readFileSync } from 'node:fs';

import {
  createSegment,
  geographicPosition,
  publishedDefinitionOf,
  publishedSegmentId,
  seconds,
  metres,
  toHex,
  unixSeconds,
  type DegreesLatitude,
  type DegreesLongitude,
  type SegmentVisibility,
} from '@onyourleft/domain';
import {
  activityId as toActivityId,
  ensureDeviceSigningKey,
  privacyZoneId,
  segmentEffortId,
  segmentId as toSegmentId,
  webCryptoSha256,
  type ActivityId,
  type SegmentEffortRecord,
  type SegmentRecord,
} from '@onyourleft/store';
import {
  createStoreHarness,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../local-athlete';
import { rideSummaryOf } from '../ride-analysis/ride-summary';
import { raceRouteOf } from '../detail/race-consent';
import { importActivityFiles } from '../transfer/import-batch';
import type { LoadedFrom } from './instance-pin';
import { createInstancePort, type InstanceStorage } from './instance-port';
import type { InstanceSend } from './instance-transport';
import {
  createLeaderboardPort,
  FROM_THE_INSTANCE_REFUSAL,
  IN_A_ZONE_REFUSAL,
  NOT_PUBLIC_REFUSAL,
  parseBoard,
  parseSegmentList,
} from './leaderboard-port';
import { createSyncPort } from './sync-port';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  answeringAs(path: string, answer: () => Response): (request: Request) => Promise<Response>;
  close(): Promise<void>;
}

interface IdentityTesting {
  readonly TEST_ORIGIN: string;
  startIdentityInstance(options?: { bodyLimitBytes?: number }): Promise<IdentityInstance>;
}

const INSTANCE = (path: string): string =>
  new URL(`../../../instance/src/${path}`, import.meta.url).href;
const CORPUS = new URL('../../../../packages/fit/fixtures/corpus/', import.meta.url);
const NOW = unixSeconds(1_790_000_000);

let testing: IdentityTesting;
const worlds: IdentityInstance[] = [];
const harnesses: StoreHarness[] = [];

beforeAll(async () => {
  testing = (await import(
    /* @vite-ignore */ INSTANCE('auth/identity-testing.ts')
  )) as IdentityTesting;
});

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const harness of harnesses.splice(0)) await harness.destroy();
});

async function world(): Promise<{ w: IdentityInstance; send: InstanceSend; seen: string[] }> {
  const w = await testing.startIdentityInstance({ bodyLimitBytes: 1024 * 1024 });
  worlds.push(w);
  const seen: string[] = [];
  const send: InstanceSend = async (url, init) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return w.instance.handler(new Request(url, init));
  };
  return { w, send, seen };
}

function mapStorage(): InstanceStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

let counter = 0;

async function device(send: InstanceSend, loadedFrom: LoadedFrom = LOADED_LOCALLY) {
  const harness = createStoreHarness();
  harnesses.push(harness);
  let open: PersistentStore | undefined;
  await harness.write((store) => {
    open = store;
    return ensureLocalAthlete(store, NOW);
  });
  const store = (): PersistentStore => open as PersistentStore;
  const storage = mapStorage();
  const signingKey = () => ensureDeviceSigningKey(store(), LOCAL_ATHLETE, { now: () => NOW });
  const sealing = { storage, loadedFrom, signingKey, send, now: () => NOW * 1000 };
  const instance = createInstancePort({
    ...sealing,
    ensureLocalAthlete: () => ensureLocalAthlete(store(), NOW),
  });
  const sync = createSyncPort({
    ...sealing,
    store,
    athleteId: LOCAL_ATHLETE,
    timeZone: 'Europe/London',
    rideSummary: (id) => rideSummaryOf(store(), LOCAL_ATHLETE)(id),
    newDocumentId: () => crypto.randomUUID(),
    raceRoute: (id) => raceRouteOf(store(), LOCAL_ATHLETE, webCryptoSha256)(id),
  });
  const boards = createLeaderboardPort({ ...sealing, store, athleteId: LOCAL_ATHLETE });
  return { harness, storage, store, instance, sync, boards };
}

type Device = Awaited<ReturnType<typeof device>>;

async function connected(send: InstanceSend, w: IdentityInstance, name: string): Promise<Device> {
  const on = await device(send);
  const card = (await w.instanceKeys.show()).card;
  expect(await on.instance.connect(testing.TEST_ORIGIN, name, card)).toMatchObject({
    kind: 'connected',
  });
  return on;
}

/** A ride from the corpus, imported, and synced to the instance. */
async function syncedRide(on: Device): Promise<{ id: ActivityId; startedAt: number }> {
  const report = await on.harness.write((store) =>
    importActivityFiles({
      sources: [
        {
          fileName: 'nominal-outdoor-ride.fit',
          bytes: () =>
            Promise.resolve(
              new Uint8Array(readFileSync(new URL('nominal-outdoor-ride.fit', CORPUS))),
            ),
        },
      ],
      store,
      athleteId: LOCAL_ATHLETE,
      newActivityId: () => toActivityId(`board-ride-${String((counter += 1))}`),
      now: () => NOW,
      digest: async (bytes) => toHex(await webCryptoSha256(bytes)),
      timeZone: 'Europe/London',
    }),
  );
  const id = report.outcomes[0]?.activityId as ActivityId;
  expect(await on.sync.sync()).toMatchObject({ kind: 'synced', report: { failures: [] } });
  const ride = await on.store().getActivity(LOCAL_ATHLETE, id);
  return { id, startedAt: ride!.startedAt };
}

/** A segment on this device: a northbound 555 m with its own random id. */
function ownSegment(visibility: SegmentVisibility = 'public', name = 'Box Hill'): SegmentRecord {
  const segment = createSegment({
    id: `local-${String((counter += 1))}`,
    createdBy: LOCAL_ATHLETE,
    name,
    sport: 'ride',
    geometry: Array.from({ length: 6 }, (_, index) =>
      geographicPosition((51.5 + index * 0.001) as DegreesLatitude, -0.12 as DegreesLongitude),
    ),
    elevationSource: 'none',
    visibility,
    createdAt: NOW,
  });
  return { ...segment, id: toSegmentId(segment.id), createdBy: LOCAL_ATHLETE };
}

async function withSegment(on: Device, segment: SegmentRecord): Promise<SegmentRecord> {
  await on.harness.write((store) => store.putSegment(segment));
  return segment;
}

function effortOn(
  segment: SegmentRecord,
  ride: { id: ActivityId; startedAt: number },
  elapsed: number,
  visibility: SegmentEffortRecord['visibility'] = 'public',
): SegmentEffortRecord {
  return {
    id: segmentEffortId(`effort-${String((counter += 1))}`),
    athleteId: LOCAL_ATHLETE,
    segmentId: segment.id,
    activityId: ride.id,
    startedAt: unixSeconds(ride.startedAt + 10),
    elapsed: seconds(elapsed),
    deviation: metres(3),
    visibility,
    attributes: {},
  };
}

describe('a board across two riders, through the instance (#68)', () => {
  it('lets Anna add Bea’s published segment and read Bea’s time on it — every call sealed', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);

    expect(await bea.boards.publishRefusal(segment)).toBeUndefined();
    expect(await bea.boards.standing(segment)).toEqual({ kind: 'not-published', segmentId });
    expect(await bea.boards.publish(segment)).toBe('published');
    expect(await bea.boards.standing(segment)).toEqual({
      kind: 'published',
      segmentId,
      yours: true,
    });
    expect(await bea.boards.share(segmentId, [effortOn(segment, ride, 95)])).toEqual({
      rides: 1,
      notSynced: 0,
      failed: 0,
    });
    // The ride is public HERE too, read back off the device's own store.
    expect((await bea.store().getActivity(LOCAL_ATHLETE, ride.id))?.visibility).toBe('public');

    const anna = await connected(send, w, 'Anna');
    seen.length = 0;
    const listed = await anna.boards.listSegments();
    expect(
      listed?.map((each) => ({ segmentId: each.segmentId, name: each.name, yours: each.yours })),
    ).toEqual([{ segmentId, name: 'Box Hill', yours: false }]);
    // Measured by the instance from the path, never told it.
    expect(listed?.[0]?.distanceMetres).toBeCloseTo(segment.distance, 6);
    expect(await anna.boards.addSegment(segmentId)).toBe('added');
    const added = await anna.store().getSegment(LOCAL_ATHLETE, toSegmentId(segmentId));
    expect(added?.name).toBe('Box Hill');
    expect(added?.geometry).toEqual(segment.geometry);
    // Added from the instance: never offered back to it, and already on it.
    expect(await anna.boards.publishRefusal(added!)).toBe(FROM_THE_INSTANCE_REFUSAL);
    expect(await anna.boards.addSegment(segmentId)).toBe('already');

    const board = await anna.boards.board(segmentId, 'instance', 'all-time');
    expect(board).toEqual({
      scope: 'instance',
      period: 'all-time',
      rows: [{ rank: 1, rider: 'Bea', yours: false, elapsedSeconds: 95 }],
    });
    // Sealed, like every instance call: no segment, ride or name leaves in the clear.
    expect(new Set(seen)).toEqual(new Set(['GET /v1/instance/keys', 'POST /v1/sealed']));

    // Bea takes it off: the board is empty, and her ride private again in both places.
    expect(await bea.boards.withdraw(segmentId, [effortOn(segment, ride, 95)])).toEqual({
      rides: 1,
      notSynced: 0,
      failed: 0,
    });
    expect((await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows).toEqual([]);
    // Only its publisher withdraws the segment; then it is gone for everybody.
    expect(await anna.boards.withdrawSegment(segmentId)).toBe(false);
    expect(await bea.boards.withdrawSegment(segmentId)).toBe(true);
    expect(await anna.boards.board(segmentId, 'instance', 'all-time')).toBeUndefined();
    expect(await bea.boards.standing(segment)).toEqual({ kind: 'not-published', segmentId });
    expect(
      (await bea.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride.id)))?.visibility,
    ).toBe('private');
  }, 30_000);

  it('shares a `private-match` effort for the rider alone, and counts a ride not synced yet', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    const unsynced = { id: toActivityId('never-synced'), startedAt: ride.startedAt };
    expect(
      await bea.boards.share(segmentId, [
        effortOn(segment, ride, 95, 'private-match'),
        effortOn(segment, unsynced, 90),
        // An excluded effort is not sent at all (#69's).
        effortOn(
          segment,
          { id: toActivityId('excluded'), startedAt: ride.startedAt },
          1,
          'excluded',
        ),
      ]),
    ).toEqual({ rides: 1, notSynced: 1, failed: 0 });
    const anna = await connected(send, w, 'Anna');
    expect((await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows).toEqual([]);
    expect((await bea.boards.board(segmentId, 'personal', 'all-time'))?.rows).toEqual([
      { rank: 1, rider: 'Bea', yours: true, elapsedSeconds: 95 },
    ]);
  }, 30_000);
});

describe('what is never offered, and sends nothing (#68)', () => {
  it('refuses a private segment, and one with an end in a privacy zone, before anything is sent', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    const hidden = await withSegment(bea, ownSegment('private', 'Private climb'));
    expect(await bea.boards.publishRefusal(hidden)).toBe(NOT_PUBLIC_REFUSAL);
    const home = await withSegment(bea, ownSegment('public', 'From home'));
    await bea.harness.write((store) =>
      store.putPrivacyZone({
        id: privacyZoneId('zone-home'),
        athleteId: LOCAL_ATHLETE,
        centre: home.start.position,
        radius: metres(200),
        label: 'Home',
        createdAt: NOW,
      }),
    );
    expect(await bea.boards.publishRefusal(home)).toBe(IN_A_ZONE_REFUSAL);
    seen.length = 0;
    expect(await bea.boards.publish(hidden)).toBe('refused');
    expect(await bea.boards.publish(home)).toBe('refused');
    expect(seen).toEqual([]);
  }, 30_000);

  it('offers nothing, and sends nothing, on a device with no instance', async () => {
    const { send, seen } = await world();
    const alone = await device(send);
    expect(alone.boards.offered()).toBe(false);
    expect(alone.boards.instanceName()).toBeUndefined();
    expect(await alone.boards.board('a'.repeat(32), 'instance', 'all-time')).toBeUndefined();
    expect(await alone.boards.listSegments()).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('will not add a segment whose definition is not the one its id names', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    const other = publishedDefinitionOf(ownSegment('public', 'Another road'));
    const forged = w.answeringAs(`/v1/segments/${segmentId}`, () =>
      Response.json({ segmentId, definition: other }),
    );
    const anna = await connected(async (url, init) => forged(new Request(url, init)), w, 'Anna');
    expect(await anna.boards.addSegment(segmentId)).toBe('unavailable');
    expect(
      await anna.harness.read((store) => store.getSegment(LOCAL_ATHLETE, toSegmentId(segmentId))),
    ).toBeUndefined();
  }, 30_000);
});

describe('what is taken as a board (#68)', () => {
  const row = { rank: 1, rider: 'Bea', yours: false, elapsedSeconds: 95 };
  const good = { scope: 'instance', period: 'all-time', rankedBy: 'elapsed', rows: [row] };

  it('takes a board', () => {
    expect(parseBoard({ ...good, segment: {} })).toEqual({
      scope: 'instance',
      period: 'all-time',
      rows: [row],
    });
  });

  it('refuses anything that is not one', () => {
    for (const body of [
      null,
      [],
      { ...good, scope: 'global' },
      { ...good, period: 'forever' },
      { ...good, rankedBy: 'moving' },
      { ...good, rows: [{ ...row, latitude: 51.5 }] },
      { ...good, rows: [{ ...row, rank: 2 }] },
      { ...good, rows: [{ ...row, rider: 'Bea\u202e' }] },
      { ...good, rows: [{ ...row, elapsedSeconds: -1 }] },
      { ...good, rows: Array.from({ length: 51 }, (_, index) => ({ ...row, rank: index + 1 })) },
    ]) {
      expect(parseBoard(body), JSON.stringify(body).slice(0, 80)).toBeUndefined();
    }
  });

  it('takes a list of segments, and refuses one that names a segment by anything but its digest', () => {
    const item = {
      segmentId: 'a'.repeat(32),
      name: 'S',
      sport: 'ride',
      distanceMetres: 500,
      yours: false,
    };
    expect(parseSegmentList({ items: [item], next: null })).toEqual([item]);
    expect(parseSegmentList({ items: [{ ...item, segmentId: '../x' }] })).toBeUndefined();
    expect(parseSegmentList({ items: [{ ...item, sport: 'swim' }] })).toBeUndefined();
    expect(parseSegmentList({})).toBeUndefined();
  });
});
