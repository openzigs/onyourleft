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
 * CLAUDE.md §5's *wrong time* and *wrong layer* causes in one store.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError } from './errors';
import { fromPersistedCameraFrame, toPersistedCameraFrame } from './persisted';
import type { PersistedCameraFrame } from './persisted';
import {
  assertCameraFrameRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  cameraFrameFor,
  createStoreHarness,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  survivingFrameStoreFactory,
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
    // delete — CLAUDE.md §5's fourth cause, and the one a naive test cannot
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
