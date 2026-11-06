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
  pathEntersPrivacyZone,
} from './leaderboard-port';
import { readInstanceAccount } from './sign-in';
import { createSyncPort } from './sync-port';
import { LOADED_LOCALLY } from './testing';

interface IdentityInstance {
  readonly instance: { handler(request: Request): Promise<Response> };
  readonly instanceKeys: { show(): Promise<{ readonly card: string }> };
  answeringAs(path: string, answer: () => Response): (request: Request) => Promise<Response>;
  /** A second connection to the instance's file: a read the instance's own store did not serve. */
  freshRead<T>(
    read: (store: {
      getActivityRecord(
        athleteId: string,
        contentSha256: string,
      ): Promise<{ readonly visibility?: string } | undefined>;
    }) => Promise<T>,
  ): Promise<T>;
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
  /** A fresh handle for the device's code after a `harness.read`, which closes the old one. */
  const reopen = (): Promise<void> =>
    harness.write((fresh) => {
      open = fresh;
      return Promise.resolve();
    });
  return { harness, storage, store, reopen, instance, sync, boards };
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

/** A segment on this device: a northbound 555 m, at made-up coordinates, with its own random id. */
function ownSegment(visibility: SegmentVisibility = 'public', name = 'North climb'): SegmentRecord {
  const segment = createSegment({
    id: `local-${String((counter += 1))}`,
    createdBy: LOCAL_ATHLETE,
    name,
    sport: 'ride',
    geometry: Array.from({ length: 6 }, (_, index) =>
      geographicPosition((10 + index * 0.001) as DegreesLatitude, 20 as DegreesLongitude),
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
    expect(await bea.boards.share(segment, [effortOn(segment, ride, 95)])).toEqual({
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
    ).toEqual([{ segmentId, name: 'North climb', yours: false }]);
    // Measured by the instance from the path, never told it.
    expect(listed?.[0]?.distanceMetres).toBeCloseTo(segment.distance, 6);
    expect(await anna.boards.addSegment(segmentId)).toBe('added');
    const added = await anna.store().getSegment(LOCAL_ATHLETE, toSegmentId(segmentId));
    expect(added?.name).toBe('North climb');
    expect(added?.geometry).toEqual(segment.geometry);
    // Added from the instance: never offered back to it, and already on it.
    expect(await anna.boards.publishRefusal(added!)).toBe(FROM_THE_INSTANCE_REFUSAL);
    expect(await anna.boards.addSegment(segmentId)).toBe('already');

    const board = await anna.boards.board(segmentId, 'instance', 'all-time');
    expect(board).toEqual({
      scope: 'instance',
      period: 'all-time',
      hazardous: false,
      rows: [
        {
          rank: 1,
          rider: 'Bea',
          yours: false,
          elapsedSeconds: 95,
          effortId: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
          excluded: null,
        },
      ],
    });
    // Sealed, like every instance call: no segment, ride or name leaves in the clear.
    expect(new Set(seen)).toEqual(new Set(['GET /v1/instance/keys', 'POST /v1/sealed']));

    // Bea takes it off: the board is empty, and her ride as it was.
    expect(await bea.boards.withdraw(segment, [effortOn(segment, ride, 95)])).toEqual({
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
    ).toBe('public');
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
      await bea.boards.share(segment, [
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
      expect.objectContaining({ rank: 1, rider: 'Bea', yours: true, elapsedSeconds: 95 }),
    ]);
  }, 30_000);
});

describe('integrity, through the instance (#69)', () => {
  it('flags another rider’s time off the board, and a segment as hazardous, from the device', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const beaRide = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    await bea.boards.share(segment, [effortOn(segment, beaRide, 95)]);

    const anna = await connected(send, w, 'Anna');
    const annaRide = await syncedRide(anna);
    expect(await anna.boards.addSegment(segmentId)).toBe('added');
    // Before Anna has an effort of her own there, her flag is refused.
    const beaEffort = (await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows[0]
      ?.effortId;
    expect(await anna.boards.flagEffort(segmentId, beaEffort ?? '', 'vehicle')).toBe('refused');
    const added = await anna.store().getSegment(LOCAL_ATHLETE, toSegmentId(segmentId));
    await anna.boards.share(added!, [effortOn(added!, annaRide, 100)]);

    expect(await anna.boards.flagEffort(segmentId, beaEffort ?? '', 'vehicle')).toBe('flagged');
    expect(await anna.boards.flagEffort(segmentId, beaEffort ?? '', 'vehicle')).toBe('already');
    expect(
      (await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows.map((row) => row.rider),
    ).toEqual(['Anna']);
    const own = await bea.boards.board(segmentId, 'personal', 'all-time');
    expect(own?.rows).toEqual([
      expect.objectContaining({
        rank: null,
        excluded: expect.stringMatching(/^Flagged/) as string,
      }),
    ]);

    // Two riders are not enough to switch a board off; the third is.
    const cy = await connected(send, w, 'Cy');
    const cyRide = await syncedRide(cy);
    expect(await cy.boards.addSegment(segmentId)).toBe('added');
    const cySegment = (await cy.store().getSegment(LOCAL_ATHLETE, toSegmentId(segmentId)))!;
    await cy.boards.share(cySegment, [effortOn(cySegment, cyRide, 105)]);
    expect(await anna.boards.flagHazard(segmentId, 'junction')).toBe('flagged');
    expect(await bea.boards.flagHazard(segmentId, 'junction')).toBe('flagged');
    expect(await bea.boards.board(segmentId, 'instance', 'all-time')).toMatchObject({
      hazardous: false,
    });
    expect(await cy.boards.flagHazard(segmentId, 'junction')).toBe('flagged');
    const hazardous = await bea.boards.board(segmentId, 'instance', 'all-time');
    expect(hazardous).toMatchObject({ hazardous: true, rows: [] });
  }, 30_000);

  it('excludes an impossible time a device sent as public, and tells only its rider why', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    // Five seconds over about 555 m: more than 100 m/s, sent as though it counted.
    expect(await bea.boards.share(segment, [effortOn(segment, ride, 5)])).toMatchObject({
      rides: 1,
    });
    const anna = await connected(send, w, 'Anna');
    expect((await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows).toEqual([]);
    expect((await bea.boards.board(segmentId, 'personal', 'all-time'))?.rows).toEqual([
      expect.objectContaining({
        rank: null,
        excluded: expect.stringMatching(/^Excluded automatically/) as string,
      }),
    ]);
  }, 30_000);
});

/** A privacy zone on Bea's device, centred on `centre`. */
async function zoneAt(on: Device, centre: SegmentRecord['start']['position']): Promise<void> {
  await on.harness.write((store) =>
    store.putPrivacyZone({
      id: privacyZoneId(`zone-${String((counter += 1))}`),
      athleteId: LOCAL_ATHLETE,
      centre,
      radius: metres(200),
      label: 'Zone',
      createdAt: NOW,
    }),
  );
}

/** The ride's visibility on the instance, read off a store the instance's own did not serve. */
async function onTheInstance(w: IdentityInstance, on: Device, ride: ActivityId): Promise<unknown> {
  const account = readInstanceAccount(on.storage);
  const file = (await on.store().listSyncBase(LOCAL_ATHLETE)).find(
    (row) => row.activityId === ride,
  )?.key;
  expect(account).toBeDefined();
  expect(file).toBeDefined();
  return (
    await w.freshRead((store) =>
      store.getActivityRecord(account!.instanceAthleteId, file as string),
    )
  )?.visibility;
}

/** The ride's visibility on the device, read on a fresh connection. */
async function onDevice(on: Device, ride: ActivityId): Promise<unknown> {
  const visibility = (await on.harness.read((store) => store.getActivity(LOCAL_ATHLETE, ride)))
    ?.visibility;
  await on.reopen();
  return visibility;
}

describe('withdrawing, and a share that fails (#68)', () => {
  it('takes a ride’s efforts off one segment only, and leaves its visibility as it was', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const north = await withSegment(bea, ownSegment('public', 'North climb'));
    const south = await withSegment(bea, ownSegment('public', 'South climb'));
    expect(await bea.boards.publish(north)).toBe('published');
    expect(await bea.boards.publish(south)).toBe('published');
    const northId = await publishedSegmentId(publishedDefinitionOf(north), webCryptoSha256);
    const southId = await publishedSegmentId(publishedDefinitionOf(south), webCryptoSha256);
    expect((await bea.boards.share(north, [effortOn(north, ride, 95)])).rides).toBe(1);
    expect((await bea.boards.share(south, [effortOn(south, ride, 80)])).rides).toBe(1);

    expect((await bea.boards.withdraw(north, [effortOn(north, ride, 95)])).rides).toBe(1);

    const anna = await connected(send, w, 'Anna');
    expect((await anna.boards.board(northId, 'instance', 'all-time'))?.rows).toEqual([]);
    // The other segment's effort is still on its board, from the same ride…
    expect((await anna.boards.board(southId, 'instance', 'all-time'))?.rows).toEqual([
      expect.objectContaining({ rank: 1, rider: 'Bea', yours: false, elapsedSeconds: 80 }),
    ]);
    // …and the ride is as the rider left it, here and there.
    expect(await onDevice(bea, ride.id)).toBe('public');
    expect(await onTheInstance(w, bea, ride.id)).toBe('public');
  }, 30_000);

  it('puts the ride back as it was, here and there, when the instance does not take the efforts', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    // Before the ride began: the instance refuses an effort outside its recorded time.
    const outside = {
      ...effortOn(segment, ride, 95),
      startedAt: unixSeconds(ride.startedAt - 600),
    };
    expect(await bea.boards.share(segment, [outside])).toEqual({
      rides: 0,
      notSynced: 0,
      failed: 1,
    });
    expect(await onDevice(bea, ride.id)).toBe('private');
    expect(await onTheInstance(w, bea, ride.id)).toBe('private');
  }, 30_000);

  it('puts the instance’s visibility back to what the INSTANCE had, not what the device had', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    // Public here, private there: the instance's default for every synced ride.
    await bea.harness.write((store) =>
      store.setActivityVisibility(LOCAL_ATHLETE, ride.id, 'public'),
    );
    const outside = {
      ...effortOn(segment, ride, 95),
      startedAt: unixSeconds(ride.startedAt - 600),
    };
    expect((await bea.boards.share(segment, [outside])).failed).toBe(1);
    expect(await onDevice(bea, ride.id)).toBe('public');
    expect(await onTheInstance(w, bea, ride.id)).toBe('private');
  }, 30_000);

  it('puts the ride back as it was on the device when the instance does not take its visibility', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const file = (await bea.store().listSyncBase(LOCAL_ATHLETE)).find(
      (row) => row.activityId === ride.id,
    )?.key as string;
    const refusing = w.answeringAs(`/v1/sync/records/${file}/visibility`, () =>
      Response.json({ error: { code: 'internal' } }, { status: 500 }),
    );
    const flaky = createLeaderboardPort({
      storage: bea.storage,
      loadedFrom: LOADED_LOCALLY,
      signingKey: () => ensureDeviceSigningKey(bea.store(), LOCAL_ATHLETE, { now: () => NOW }),
      send: async (url, init) => refusing(new Request(url, init)),
      now: () => NOW * 1000,
      store: bea.store,
      athleteId: LOCAL_ATHLETE,
    });
    expect((await flaky.share(segment, [effortOn(segment, ride, 95)])).failed).toBe(1);
    expect(await onDevice(bea, ride.id)).toBe('private');
    expect(await onTheInstance(w, bea, ride.id)).toBe('private');
  }, 30_000);
});

describe('a segment whose path passes through a privacy zone (#68, ADR 0004 C)', () => {
  it('is refused when a line between two points crosses a zone that holds neither', () => {
    // Two points about 445 m apart, as across a gap in a recording.
    const at = (latitude: number) =>
      geographicPosition(latitude as DegreesLatitude, 20 as DegreesLongitude);
    const sparse = [at(10), at(10.004), at(10.008)];
    const zone = (latitude: number, longitude: number) => ({
      centre: geographicPosition(latitude as DegreesLatitude, longitude as DegreesLongitude),
      radius: metres(100),
    });
    // Centred between the first two points: neither is within 100 m of it.
    expect(pathEntersPrivacyZone(sparse, [zone(10.002, 20)])).toBe(true);
    // The same zone 300 m to the side: the line passes it by.
    expect(pathEntersPrivacyZone(sparse, [zone(10.002, 20.0027)])).toBe(false);
  });

  it('is not offered, is not asked about, and sends nothing', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    const through = await withSegment(bea, ownSegment('public', 'Through a zone'));
    // Centred on the path's middle: neither end is in it.
    await zoneAt(bea, through.geometry[3]!);
    seen.length = 0;
    expect(await bea.boards.publishRefusal(through)).toBe(IN_A_ZONE_REFUSAL);
    expect(await bea.boards.standing(through)).toEqual({
      kind: 'withheld',
      refusal: IN_A_ZONE_REFUSAL,
    });
    expect(await bea.boards.publish(through)).toBe('refused');
    expect(seen).toEqual([]);
  }, 30_000);

  it('keeps an effort on it to the rider’s own board when the zone came after publishing', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    expect(await bea.boards.publish(segment)).toBe('published');
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    await zoneAt(bea, segment.geometry[3]!);
    expect((await bea.boards.share(segment, [effortOn(segment, ride, 95)])).rides).toBe(1);
    const anna = await connected(send, w, 'Anna');
    expect((await anna.boards.board(segmentId, 'instance', 'all-time'))?.rows).toEqual([]);
    expect((await bea.boards.board(segmentId, 'personal', 'all-time'))?.rows).toEqual([
      expect.objectContaining({ rank: 1, rider: 'Bea', yours: true, elapsedSeconds: 95 }),
    ]);
  }, 30_000);
});

describe('a segment this rider published, withheld afterwards (#68)', () => {
  it('can still be withdrawn, efforts and all, once a zone covers part of it — and nothing is asked on the way', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    const ride = await syncedRide(bea);
    const segment = await withSegment(bea, ownSegment());
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    expect(await bea.boards.publish(segment)).toBe('published');
    expect((await bea.boards.share(segment, [effortOn(segment, ride, 95)])).rides).toBe(1);
    await zoneAt(bea, segment.geometry[3]!);

    seen.length = 0;
    expect(await bea.boards.standing(segment)).toEqual({
      kind: 'withheld',
      refusal: IN_A_ZONE_REFUSAL,
      held: { segmentId, yours: true, shared: true },
    });
    // Known from this device's own record: the instance was not asked.
    expect(seen).toEqual([]);

    expect((await bea.boards.withdraw(segment, [effortOn(segment, ride, 95)])).rides).toBe(1);
    expect((await bea.boards.board(segmentId, 'personal', 'all-time'))?.rows).toEqual([]);
    expect(await bea.boards.withdrawSegment(segmentId)).toBe(true);
    expect(await bea.boards.standing(segment)).toEqual({
      kind: 'withheld',
      refusal: IN_A_ZONE_REFUSAL,
    });

    // Gone for everybody: not listed, and its path no longer served.
    const anna = await connected(send, w, 'Anna');
    expect((await anna.boards.listSegments())?.map((each) => each.segmentId)).toEqual([]);
    expect(await anna.boards.addSegment(segmentId)).toBe('unavailable');
  }, 30_000);

  it('can still be withdrawn once the rider makes it private on this device', async () => {
    const { w, send } = await world();
    const bea = await connected(send, w, 'Bea');
    const segment = await withSegment(bea, ownSegment());
    const segmentId = await publishedSegmentId(publishedDefinitionOf(segment), webCryptoSha256);
    expect(await bea.boards.publish(segment)).toBe('published');
    const hidden = await withSegment(bea, { ...segment, visibility: 'private' });
    expect(await bea.boards.standing(hidden)).toEqual({
      kind: 'withheld',
      refusal: NOT_PUBLIC_REFUSAL,
      held: { segmentId, yours: true, shared: false },
    });
    expect(await bea.boards.withdrawSegment(segmentId)).toBe(true);
    const anna = await connected(send, w, 'Anna');
    expect(await anna.boards.listSegments()).toEqual([]);
  }, 30_000);
});

describe('what is never offered, and sends nothing (#68)', () => {
  it('refuses a private segment, and one with an end in a privacy zone, before anything is sent', async () => {
    const { w, send, seen } = await world();
    const bea = await connected(send, w, 'Bea');
    const hidden = await withSegment(bea, ownSegment('private', 'Private climb'));
    expect(await bea.boards.publishRefusal(hidden)).toBe(NOT_PUBLIC_REFUSAL);
    seen.length = 0;
    // Not even asked about: its digest is a fingerprint of a segment the client refuses to send.
    expect(await bea.boards.standing(hidden)).toEqual({
      kind: 'withheld',
      refusal: NOT_PUBLIC_REFUSAL,
    });
    expect(seen).toEqual([]);
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
  const row = {
    rank: 1,
    rider: 'Bea',
    yours: false,
    elapsedSeconds: 95,
    effortId: 'e'.repeat(32),
    excluded: null,
  };
  const good = {
    scope: 'instance',
    period: 'all-time',
    rankedBy: 'elapsed',
    hazardous: false,
    rows: [row],
  };

  it('takes a board', () => {
    expect(parseBoard({ ...good, segment: {} })).toEqual({
      scope: 'instance',
      period: 'all-time',
      hazardous: false,
      rows: [row],
    });
    // The rider's own effort that is not counted: a reason, and no place (#69).
    const mine = { ...row, yours: true, rank: null, excluded: 'Flagged by another rider.' };
    expect(
      parseBoard({ ...good, scope: 'personal', rows: [mine, { ...row, yours: true }] })?.rows,
    ).toEqual([mine, { ...row, yours: true }]);
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
      // #69: a board must say whether it is hazardous; an uncounted row is the
      // rider's own, with a reason and no place; an effort id is opaque hex.
      { ...good, hazardous: undefined },
      { ...good, rows: [{ ...row, excluded: 'Flagged.', rank: null }] },
      { ...good, rows: [{ ...row, yours: true, excluded: 'Flagged.' }] },
      { ...good, rows: [{ ...row, rank: null }] },
      { ...good, rows: [{ ...row, effortId: 'athlete-a' }] },
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
