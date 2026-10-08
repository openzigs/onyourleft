// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A side-camera snapshot joins the right ride, after its save, and never
 * carries metadata** — #1063, ADR 0044 D-3 and D-4.
 *
 * Every read here is through the round-trip harness's `read`, which discards
 * every handle the keeper wrote through and opens a fresh connection — and
 * reads with `listRideSnapshots`, the same call the ride's page makes.
 */

import { unixSeconds } from '@onyourleft/domain';
import {
  openActivityStore,
  type ActivityId,
  type ActivityStore,
  type CameraFrameRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { metadataMarkersIn } from './frame';
import type { RideProgress, RideProgressSource } from './side-report-keeper';
import { MAXIMUM_HELD_SNAPSHOTS, type SideSnapshotTaken } from './side-snapshot-port';
import { sideSnapshotKeeper, snapshotProblem } from './snapshot-keeper';
import { cleanFrameBytes } from './testing';

/** A ride controller that moves when the test says, notifying as the real one does. */
function scriptedRides(initial: Partial<RideProgress> = {}) {
  let snapshot: RideProgress = {
    phase: 'idle',
    saveState: 'unavailable',
    savedActivityId: undefined,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const source: RideProgressSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (change: Partial<RideProgress>): void => {
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    source,
    start: () => {
      set({ phase: 'recording' });
    },
    /** `continueRecovered`: idle straight to paused. */
    recover: () => {
      set({ phase: 'paused' });
    },
    stopAndSave: (id: ActivityId | undefined, outcome: RideProgress['saveState'] = 'saved') => {
      set({ phase: 'stopped' });
      set({ saveState: 'saving' });
      set({ saveState: outcome, savedActivityId: outcome === 'saved' ? id : undefined });
    },
    /** `startNewRide`: back to idle with nothing saved. */
    reset: () => {
      set({ phase: 'idle', saveState: 'unavailable', savedActivityId: undefined });
    },
    /** `saveRecovered`: a save with no ride under way in this tab. */
    saveLeftover: (id: ActivityId) => {
      set({ saveState: 'saving' });
      set({ saveState: 'saved', savedActivityId: id });
    },
  };
}

/** A picture as the live view hands it over: a clean JPEG of its own. */
function taken(salt = 1, withOutline = true): SideSnapshotTaken {
  const bytes = cleanFrameBytes();
  bytes[bytes.length - 3] = salt;
  return {
    bytes,
    width: 256,
    height: 144,
    outline: withOutline
      ? {
          aspect: 16 / 9,
          landmarks: [
            { name: 'hip', x: 0.5, y: 0.5 },
            { name: 'knee', x: 0.6, y: 0.7 },
          ],
        }
      : undefined,
  };
}

/**
 * A synthetic JPEG carrying an APP1 Exif segment whose IFD0 points at a GPS
 * IFD holding a latitude — built here, byte by byte; no photograph is
 * committed (ADR 0044 D-4).
 */
function jpegWithExifGps(): Uint8Array {
  // TIFF, big-endian: header, IFD0 with one entry (GPSInfo → offset 26), then
  // the GPS IFD with GPSLatitudeRef 'N' and nothing else.
  // prettier-ignore
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    // IFD0: one entry — tag 0x8825 GPSInfo, LONG, count 1, value 26.
    0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a,
    0x00, 0x00, 0x00, 0x00,
    // GPS IFD: one entry — tag 0x0001 GPSLatitudeRef, ASCII, count 2, "N\0".
    0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x4e, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = exif.length + 2;
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...exif];
  const clean = cleanFrameBytes();
  // SOI, the APP1, then the rest of a clean picture after its own SOI.
  return new Uint8Array([0xff, 0xd8, ...app1, ...clean.subarray(2)]);
}

/** Whether `bytes` holds an APP1 marker, the Exif signature, or the GPSInfo tag. */
function carriesExifOrGps(bytes: Uint8Array): boolean {
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xe1) return true;
    if (bytes[index] === 0x88 && bytes[index + 1] === 0x25) return true;
  }
  return metadataMarkersIn(bytes).length > 0;
}

let harness: StoreHarness;
/**
 * The keeper's own connection, as `main.tsx` gives it one: the harness's
 * `read` then opens ANOTHER, so nothing a test reads can be served by the
 * handle that wrote.
 */
let writer: ActivityStore;
let ids = 0;

beforeEach(async () => {
  resetFixtureIds();
  ids = 0;
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = openActivityStore(harness.databaseName);
});

afterEach(async () => {
  writer.close();
  await harness.destroy();
});

function keeperOver(rides: ReturnType<typeof scriptedRides>) {
  return sideSnapshotKeeper({
    rides: rides.source,
    store: {
      putCameraFrame: async (record: CameraFrameRecord) => writer.putCameraFrame(record),
    },
    athleteId: ATHLETE_A,
    newFrameId: () => {
      ids += 1;
      return `snapshot-under-test-${String(ids)}`;
    },
    now: () => unixSeconds(1_760_000_000 + ids),
  });
}

/** This athlete's snapshots of `ride`, on a connection the keeper never wrote through. */
async function snapshotsOf(ride: ActivityId): Promise<CameraFrameRecord[]> {
  return harness.read(async (store) => store.listRideSnapshots(ATHLETE_A, ride));
}

async function cameraFramesOnDevice(): Promise<number> {
  return harness.read(async (store) => store.countCameraFrames(ATHLETE_A));
}

describe('a snapshot taken during a ride (D-3 rule 1)', () => {
  it('is written only after the ride is saved, with the ride it was taken in, byte for byte', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    const ride = await seedRide(harness, ATHLETE_A);
    rides.start();
    const picture = taken(7);
    expect(keeper.holdSideSnapshot(picture)).toStrictEqual({
      kind: 'held',
      joins: 'this-ride',
      held: 1,
    });
    // Nothing before the save: a snapshot row never precedes its ride's.
    expect(await cameraFramesOnDevice()).toBe(0);

    rides.stopAndSave(ride.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(ride.id)).toHaveLength(1);
    });
    const [read] = await snapshotsOf(ride.id);
    expect(read?.source).toBe('snapshot');
    expect(read?.activityId).toBe(ride.id);
    expect(read?.bytes).toStrictEqual(picture.bytes);
    expect(read?.outline).toStrictEqual(picture.outline);
  });

  it('is dropped with a ride whose save comes back empty or failed, and nothing is written', async () => {
    for (const outcome of ['empty', 'failed'] as const) {
      const rides = scriptedRides();
      const keeper = keeperOver(rides);
      rides.start();
      keeper.holdSideSnapshot(taken());
      rides.stopAndSave(undefined, outcome);
      rides.reset();
      const later = await seedRide(harness, ATHLETE_A);
      rides.start();
      rides.stopAndSave(later.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await snapshotsOf(later.id)).toStrictEqual([]);
    }
    expect(await cameraFramesOnDevice()).toBe(0);
  });
});

describe('a snapshot taken during setup (D-3 rules 2 to 4)', () => {
  it('joins the next ride started and saved, and only that one', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    expect(keeper.holdSideSnapshot(taken(3))).toStrictEqual({
      kind: 'held',
      joins: 'next-ride',
      held: 1,
    });
    const first = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(first.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(first.id)).toHaveLength(1);
    });
    rides.reset();
    const second = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(second.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await snapshotsOf(second.id)).toStrictEqual([]);
  });

  it('waits past a ride whose save failed, and joins the next one that is saved', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    keeper.holdSideSnapshot(taken(4));
    rides.start();
    rides.stopAndSave(undefined, 'failed');
    rides.reset();
    const saved = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(saved.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(saved.id)).toHaveLength(1);
    });
  });

  it('is thrown away by forget — the erase — and nothing is written afterwards', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    keeper.holdSideSnapshot(taken());
    keeper.forget();
    const ride = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(ride.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await cameraFramesOnDevice()).toBe(0);
  });

  it('is not consumed by saving a leftover ride, and still joins the next ride started', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    keeper.holdSideSnapshot(taken());
    const leftover = await seedRide(harness, ATHLETE_A);
    rides.saveLeftover(leftover.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await snapshotsOf(leftover.id)).toStrictEqual([]);
    rides.reset();
    const next = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(next.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(next.id)).toHaveLength(1);
    });
  });
});

describe('a recovered ride never collects a snapshot (D-3 rule 5)', () => {
  it('claims no setup snapshot, refuses a press in words, and leaves the setup one waiting', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    keeper.holdSideSnapshot(taken());
    const recovered = await seedRide(harness, ATHLETE_A);
    rides.recover();
    expect(keeper.holdSideSnapshot(taken(9))).toStrictEqual({
      kind: 'refused',
      reason: 'recovered-ride',
    });
    rides.stopAndSave(recovered.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await snapshotsOf(recovered.id)).toStrictEqual([]);
    rides.reset();
    const next = await seedRide(harness, ATHLETE_A);
    rides.start();
    rides.stopAndSave(next.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(next.id)).toHaveLength(1);
    });
  });
});

describe('what a press is refused for', () => {
  it('refuses a press with no picture on screen', () => {
    const keeper = keeperOver(scriptedRides());
    expect(keeper.holdSideSnapshot(undefined)).toStrictEqual({
      kind: 'refused',
      reason: 'none-on-screen',
    });
  });

  it(`holds at most ${String(MAXIMUM_HELD_SNAPSHOTS)}, and refuses the next in words rather than dropping it`, () => {
    const keeper = keeperOver(scriptedRides());
    for (let index = 0; index < MAXIMUM_HELD_SNAPSHOTS; index += 1) {
      expect(keeper.holdSideSnapshot(taken(index)).kind).toBe('held');
    }
    expect(keeper.holdSideSnapshot(taken())).toStrictEqual({ kind: 'refused', reason: 'full' });
  });
});

describe('no metadata reaches the store (ADR 0044 D-4)', () => {
  it('the fixture really carries an APP1 Exif segment with a GPS IFD', () => {
    // The control: without it, "nothing was found" could be a fixture with
    // nothing in it.
    const dirty = jpegWithExifGps();
    expect(carriesExifOrGps(dirty)).toBe(true);
    expect(metadataMarkersIn(dirty)).toContain('Exif');
    expect(snapshotProblem(dirty)).toBe('not-clean');
    expect(snapshotProblem(cleanFrameBytes())).toBeUndefined();
  });

  it('a picture carrying Exif and GPS is not kept; a clean one beside it is, and read back carries neither', async () => {
    const rides = scriptedRides();
    const keeper = keeperOver(rides);
    const ride = await seedRide(harness, ATHLETE_A);
    rides.start();
    const dirty: SideSnapshotTaken = { ...taken(), bytes: jpegWithExifGps() };
    expect(keeper.holdSideSnapshot(dirty)).toStrictEqual({
      kind: 'refused',
      reason: 'not-clean',
    });
    expect(keeper.holdSideSnapshot(taken(5)).kind).toBe('held');
    rides.stopAndSave(ride.id);
    await vi.waitFor(async () => {
      expect(await snapshotsOf(ride.id)).toHaveLength(1);
    });
    for (const frame of await snapshotsOf(ride.id)) {
      expect(carriesExifOrGps(frame.bytes)).toBe(false);
    }
    expect(await cameraFramesOnDevice()).toBe(1);
  });
});
