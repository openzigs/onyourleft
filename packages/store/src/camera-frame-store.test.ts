// SPDX-License-Identifier: Apache-2.0

/**
 * **A kept picture, written, read back through a connection nothing wrote on,
 * and erased** — #384.
 *
 * ⚠️ **The pair at the bottom is the point of this file.** #384 is explicit
 * that the failure worth spending a suite on here is not a lost setting but
 * *"a frame the rider believes was erased, and was not"*, and
 * `testing/fakes.ts` §`survivingFrameStoreFactory` is the store built to
 * produce exactly that: `deleteCameraFrames` returns a **true** count and
 * removes nothing. Every cheap assertion passes against it. Only a round trip
 * that discards the writer and opens a fresh connection notices, which is
 * docs/agents/quality-gate.md §5's *wrong time* and *wrong layer* causes in one store.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { activityId as activityIdOf } from './ids';
import { fromPersistedCameraFrame, toPersistedCameraFrame } from './persisted';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import type { PersistedCameraFrame } from './persisted';
import {
  assertCameraFrameRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  cameraFrameFor,
  createStoreHarness,
  resetFixtureIds,
  RoundTripFailure,
  ATHLETE_C,
  seedAthletes,
  seedRide,
  snapshotFor,
  survivingFrameStoreFactory,
  survivingSnapshotStoreFactory,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('keeping a picture', () => {
  it('survives a round trip, byte for byte', async () => {
    const frame = cameraFrameFor(ATHLETE_A);
    const read = await assertCameraFrameRoundTrip(harness, frame);
    expect(read.id).toBe(frame.id);
    expect(read.mediaType).toBe('image/jpeg');
  });

  it('is not there at all on a device nobody kept one on', async () => {
    // ADR 0029 D-2's default, as a fact about the store rather than a claim.
    // D-11 rests on it: *"the ordinary state of a shared device is one with no
    // frames on it at all."*
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      0,
    );
    await expect(
      harness.read(async (store) => store.listCameraFrames(ATHLETE_A)),
    ).resolves.toStrictEqual([]);
  });

  it('comes back newest first', async () => {
    const older = cameraFrameFor(ATHLETE_A, { capturedAt: 1_700_000_100 });
    const newer = cameraFrameFor(ATHLETE_A, { capturedAt: 1_700_000_200 });
    await harness.write(async (store) => {
      await store.putCameraFrame(older);
      await store.putCameraFrame(newer);
    });
    const read = await harness.read(async (store) => store.listCameraFrames(ATHLETE_A));
    expect(read.map((each) => each.id)).toStrictEqual([newer.id, older.id]);
  });

  it('honours a caller’s budget, because every row is a whole JPEG', async () => {
    await harness.write(async (store) => {
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
    });
    await expect(
      harness.read(async (store) => store.listCameraFrames(ATHLETE_A, 2)),
    ).resolves.toHaveLength(2);
  });

  it('refuses a picture belonging to an athlete who does not exist', async () => {
    // The same rule `putRoute` states, and it matters more here: the orphan
    // would be a photograph no scoped read can reach and no erase can remove.
    const orphan = { ...cameraFrameFor(ATHLETE_A), athleteId: ATHLETE_A };
    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    await expect(harness.write(async (store) => store.putCameraFrame(orphan))).rejects.toThrow(
      StoreReferentialError,
    );
  });

  it('refuses to overwrite one belonging to somebody else', async () => {
    const mine = cameraFrameFor(ATHLETE_A);
    await harness.write(async (store) => store.putCameraFrame(mine));
    await expect(
      harness.write(async (store) => store.putCameraFrame({ ...mine, athleteId: ATHLETE_B })),
    ).rejects.toThrow(StoreReferentialError);
  });
});

describe('what a row has to be to come back', () => {
  it('refuses bytes that are not a typed array', () => {
    // A hand-edited IndexedDB row, or a future adapter that stored base64. The
    // one consumer is an export, which would otherwise write a file that is not
    // an image and say nothing about it.
    const row = {
      ...toPersistedCameraFrame(cameraFrameFor(ATHLETE_A)),
      bytes: 'not bytes',
    } as unknown as PersistedCameraFrame;
    expect(() => fromPersistedCameraFrame(row)).toThrow(StoreDecodeError);
  });

  it('refuses a zero-length picture', () => {
    const row = { ...toPersistedCameraFrame(cameraFrameFor(ATHLETE_A)), bytes: new Uint8Array(0) };
    expect(() => fromPersistedCameraFrame(row)).toThrow(StoreDecodeError);
  });

  it('carries nothing of the picture in the refusal', () => {
    // ADR 0029 D-8 applied to a decoder: the field and the constraint, never
    // the value. A failure message is exactly the string somebody pastes into
    // an issue.
    const row = { ...toPersistedCameraFrame(cameraFrameFor(ATHLETE_A)), bytes: new Uint8Array(0) };
    try {
      fromPersistedCameraFrame(row);
      expect.unreachable('the refusal did not fire');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('cameraFrame.bytes');
      expect(message).not.toMatch(/data:|blob:|base64|[0-9a-f]{16}/i);
    }
  });
});

describe('erasing the pictures', () => {
  it('removes them and says how many, read back through a fresh connection', async () => {
    await harness.write(async (store) => {
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
    });

    const removed = await harness.write(async (store) => store.deleteCameraFrames(ATHLETE_A));
    expect(removed).toBe(2);

    // ⚠️ **The assertion.** `harness.read` discards every open handle and opens
    // a new one, so this cannot be served by the connection that did the
    // delete — docs/agents/quality-gate.md §5's fourth cause, and the one a naive test cannot
    // detect.
    await expect(
      harness.read(async (store) => store.listCameraFrames(ATHLETE_A)),
    ).resolves.toStrictEqual([]);
  });

  it('leaves everybody else’s alone', async () => {
    const theirs = cameraFrameFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
      await store.putCameraFrame(theirs);
    });
    await harness.write(async (store) => store.deleteCameraFrames(ATHLETE_A));
    const read = await harness.read(async (store) => store.listCameraFrames(ATHLETE_B));
    expect(read.map((each) => each.id)).toStrictEqual([theirs.id]);
  });

  it('is a no-op on a device that kept none', async () => {
    await expect(harness.write(async (store) => store.deleteCameraFrames(ATHLETE_A))).resolves.toBe(
      0,
    );
  });
});

/* -------------------------------------------------------------------------- *
 * The red/green pair. See this file's header.
 * -------------------------------------------------------------------------- */

describe('the harness catches a delete that reports success and removes nothing', () => {
  it('goes GREEN against the real store', async () => {
    const real = createStoreHarness();
    try {
      await seedAthletes(real);
      await real.write(async (store) => store.putCameraFrame(cameraFrameFor(ATHLETE_A)));
      await real.write(async (store) => store.deleteCameraFrames(ATHLETE_A));
      await expect(
        real.read(async (store) => store.listCameraFrames(ATHLETE_A)),
      ).resolves.toStrictEqual([]);
    } finally {
      await real.destroy();
    }
  });

  it('goes RED against a store that leaves the rows behind', async () => {
    const broken = createStoreHarness({ factory: survivingFrameStoreFactory() });
    try {
      await seedAthletes(broken);
      const frame = cameraFrameFor(ATHLETE_A);
      await broken.write(async (store) => store.putCameraFrame(frame));

      // Everything a caller can see says it worked. This is the whole failure
      // mode: the count is honest.
      await expect(
        broken.write(async (store) => store.deleteCameraFrames(ATHLETE_A)),
      ).resolves.toBe(1);

      // And the picture is still there, on a connection nothing wrote on.
      const read = await broken.read(async (store) => store.listCameraFrames(ATHLETE_A));
      expect(read.map((each) => each.id)).toStrictEqual([frame.id]);
    } finally {
      await broken.destroy();
    }
  });

  it('the write-side round trip stays green against it, which is why the pair is needed', async () => {
    // ⚠️ The calibration. `survivingFrameStoreFactory` breaks a **delete**, and
    // every write-path assertion in this file passes against it — including
    // `assertCameraFrameRoundTrip`, which is the strongest one this package
    // has. A suite that only round-tripped writes would report this store as
    // correct, which is precisely why #384 asks for a fake of a different
    // shape rather than a fourteenth write-path one.
    const broken = createStoreHarness({ factory: survivingFrameStoreFactory() });
    try {
      await seedAthletes(broken);
      await expect(
        assertCameraFrameRoundTrip(broken, cameraFrameFor(ATHLETE_A)),
      ).resolves.toBeDefined();
    } finally {
      await broken.destroy();
    }
  });

  it('the round trip itself can fail, so a green one means something', async () => {
    // The other half of the calibration: `assertCameraFrameRoundTrip` throws
    // `RoundTripFailure` rather than being an `expect` call, which is what lets
    // the same assertion body run green against the real store and red against
    // a fake. Here the fake is a frame that was never written at all.
    const empty = createStoreHarness();
    try {
      await seedAthletes(empty);
      const never = cameraFrameFor(ATHLETE_A);
      await expect(
        empty.read(async (store) => store.listCameraFrames(never.athleteId)),
      ).resolves.toStrictEqual([]);
      await expect(
        (async () => {
          const read = await empty.read(async (store) => store.listCameraFrames(never.athleteId));
          if (read.find((each) => each.id === never.id) === undefined) {
            throw new RoundTripFailure('the picture is not there');
          }
        })(),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await empty.destroy();
    }
  });
});

/* --------------------------------------------------------------------------
 * #1063 — a side-camera snapshot, kept WITH its ride (ADR 0044 D-3, D-5).
 * -------------------------------------------------------------------------- */

describe('a side-camera snapshot', () => {
  it('survives a round trip through the read its ride’s page uses, outline and all', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const snapshot = snapshotFor(ATHLETE_A, ride.id);
    const read = await assertCameraFrameRoundTrip(harness, snapshot);
    expect(read.source).toBe('snapshot');
    expect(read.activityId).toBe(ride.id);
    expect(read.outline).toStrictEqual(snapshot.outline);
  });

  it('keeps a snapshot the model found nobody in, with no outline', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const read = await assertCameraFrameRoundTrip(
      harness,
      snapshotFor(ATHLETE_A, ride.id, { withOutline: false }),
    );
    expect(read.outline).toBeNull();
  });

  it('is refused when it names no ride, a ride nobody holds, or another athlete’s ride', async () => {
    const mine = await seedRide(harness, ATHLETE_A);
    const theirs = await seedRide(harness, ATHLETE_B);
    const unnamed = { ...snapshotFor(ATHLETE_A, mine.id), activityId: null };
    await expect(
      harness.write(async (store) => store.putCameraFrame(unnamed)),
    ).rejects.toBeInstanceOf(StoreValidationError);
    await expect(
      harness.write(async (store) =>
        store.putCameraFrame(snapshotFor(ATHLETE_A, activityIdOf('no-such-ride'))),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
    await expect(
      harness.write(async (store) => store.putCameraFrame(snapshotFor(ATHLETE_A, theirs.id))),
    ).rejects.toBeInstanceOf(StoreReferentialError);
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      0,
    );
  });

  it('refuses a kept frame that names a ride or carries an outline, and an outline off the picture', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const kept = cameraFrameFor(ATHLETE_A);
    await expect(
      harness.write(async (store) => store.putCameraFrame({ ...kept, activityId: ride.id })),
    ).rejects.toBeInstanceOf(StoreValidationError);
    const snapshot = snapshotFor(ATHLETE_A, ride.id);
    await expect(
      harness.write(async (store) => store.putCameraFrame({ ...kept, outline: snapshot.outline })),
    ).rejects.toBeInstanceOf(StoreValidationError);
    const off = {
      ...snapshot,
      outline: { aspect: 1, landmarks: [{ name: 'knee', x: 1.5, y: 0.5 }] },
    };
    const refusal = harness.write(async (store) => store.putCameraFrame(off));
    await expect(refusal).rejects.toBeInstanceOf(StoreValidationError);
    // The field and the constraint, never where the knee was (ADR 0029 D-8).
    await expect(refusal).rejects.not.toThrow(/1\.5/);
  });

  it('is counted and listed per ride, oldest first, and a kept frame is in neither', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const other = await seedRide(harness, ATHLETE_A);
    const later = snapshotFor(ATHLETE_A, ride.id, { capturedAt: 1_700_000_200 });
    const earlier = snapshotFor(ATHLETE_A, ride.id, { capturedAt: 1_700_000_100 });
    await harness.write(async (store) => {
      await store.putCameraFrame(later);
      await store.putCameraFrame(earlier);
      await store.putCameraFrame(snapshotFor(ATHLETE_A, other.id));
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
    });
    const read = await harness.read(async (store) => store.listRideSnapshots(ATHLETE_A, ride.id));
    expect(read.map((each) => each.id)).toStrictEqual([earlier.id, later.id]);
    await expect(
      harness.read(async (store) => store.countRideSnapshots(ATHLETE_A, ride.id)),
    ).resolves.toBe(2);
  });

  it('goes with its ride, in the ride’s delete, read back through a fresh connection', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const kept = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => {
      await store.putCameraFrame(snapshotFor(ATHLETE_A, ride.id));
      await store.putCameraFrame(snapshotFor(ATHLETE_A, kept.id));
      await store.putCameraFrame(cameraFrameFor(ATHLETE_A));
    });
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(
      harness.read(async (store) => store.listRideSnapshots(ATHLETE_A, ride.id)),
    ).resolves.toStrictEqual([]);
    // The other ride's snapshot, and the kept frame, are untouched.
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      2,
    );
  });

  it('goes with its OWNER’s ride only: another athlete’s row naming that ride id stays (#1063’s review)', async () => {
    // `putCameraFrame` refuses a snapshot naming another athlete's ride, so
    // this row is written past it, raw — the case the delete's owner scope is
    // for. A cascade by activity id alone would take B's row with A's ride.
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.discard();
    const raw = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      raw.version(index + 1).stores(stores);
    });
    await raw
      .table(TABLE.cameraFrames)
      .put(toPersistedCameraFrame(snapshotFor(ATHLETE_B, ride.id)));
    raw.close();
    // The control: the row is there, under B, before the delete.
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_B))).resolves.toBe(
      1,
    );
    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_B))).resolves.toBe(
      1,
    );
  });

  it('is erased with everything else the athlete kept', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    await harness.write(async (store) => store.putCameraFrame(snapshotFor(ATHLETE_A, ride.id)));
    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      0,
    );
  });
});

describe('one snapshot is deleted — and the harness catches a delete that keeps it', () => {
  it('goes GREEN against the real store: gone on a fresh read, its neighbour stays', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const gone = snapshotFor(ATHLETE_A, ride.id);
    const stays = snapshotFor(ATHLETE_A, ride.id);
    await harness.write(async (store) => {
      await store.putCameraFrame(gone);
      await store.putCameraFrame(stays);
    });
    await expect(
      harness.write(async (store) => store.deleteRideSnapshot(ATHLETE_A, ride.id, gone.id)),
    ).resolves.toBe(true);
    const read = await harness.read(async (store) => store.listRideSnapshots(ATHLETE_A, ride.id));
    expect(read.map((each) => each.id)).toStrictEqual([stays.id]);
  });

  it('deletes nothing for another athlete, another ride, or a kept frame', async () => {
    const mine = await seedRide(harness, ATHLETE_A);
    const other = await seedRide(harness, ATHLETE_A);
    const theirs = await seedRide(harness, ATHLETE_C);
    const snapshot = snapshotFor(ATHLETE_C, theirs.id);
    const kept = cameraFrameFor(ATHLETE_A);
    await harness.write(async (store) => {
      await store.putCameraFrame(snapshot);
      await store.putCameraFrame(kept);
    });
    await harness.write(async (store) => {
      await expect(store.deleteRideSnapshot(ATHLETE_A, theirs.id, snapshot.id)).resolves.toBe(
        false,
      );
      await expect(store.deleteRideSnapshot(ATHLETE_C, mine.id, snapshot.id)).resolves.toBe(false);
      await expect(store.deleteRideSnapshot(ATHLETE_A, other.id, kept.id)).resolves.toBe(false);
    });
    await expect(
      harness.read(async (store) => store.countRideSnapshots(ATHLETE_C, theirs.id)),
    ).resolves.toBe(1);
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      1,
    );
  });

  it('goes RED against a store that reports the delete and keeps the picture', async () => {
    const broken = createStoreHarness({ factory: survivingSnapshotStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A);
      const snapshot = snapshotFor(ATHLETE_A, ride.id);
      await broken.write(async (store) => store.putCameraFrame(snapshot));
      // Every signal a caller has says it worked.
      await expect(
        broken.write(async (store) => store.deleteRideSnapshot(ATHLETE_A, ride.id, snapshot.id)),
      ).resolves.toBe(true);
      // And the picture is still there, on a connection nothing wrote on.
      const read = await broken.read(async (store) => store.listRideSnapshots(ATHLETE_A, ride.id));
      expect(read.map((each) => each.id)).toStrictEqual([snapshot.id]);
    } finally {
      await broken.destroy();
    }
  });
});

describe('what a snapshot row has to be to come back', () => {
  it('refuses a source this build does not know, naming the field and not the value', () => {
    const ride = activityIdOf('ride-x');
    const row: PersistedCameraFrame = {
      ...toPersistedCameraFrame(snapshotFor(ATHLETE_A, ride)),
      source: 'burst',
    };
    expect(() => fromPersistedCameraFrame(row)).toThrow(StoreDecodeError);
    expect(() => fromPersistedCameraFrame(row)).toThrow(/cameraFrame\.source/);
  });

  it('refuses a snapshot row with no ride', () => {
    const row: PersistedCameraFrame = {
      ...toPersistedCameraFrame(snapshotFor(ATHLETE_A, activityIdOf('ride-x'))),
      activityId: null,
    };
    expect(() => fromPersistedCameraFrame(row)).toThrow(/cameraFrame\.activityId/);
  });
});
