// SPDX-License-Identifier: Apache-2.0

/**
 * **The side camera's framing reference, written, read back through a
 * connection nothing wrote on, replaced and erased** — #528,
 * [ADR 0033](../../../docs/adr/0033-side-camera-link.md) D-7.
 *
 * ⚠️ **The pair at the bottom is the point of this file.** The owner's ruling
 * is a reference *"from the rider's last session"*, and
 * `testing/fakes.ts` §`firstReferenceStoreFactory` is a store that keeps the
 * FIRST: every put succeeds, every read returns a well-formed reference for
 * the right athlete, and a single-session test cannot tell it from the real
 * one. Only a round trip over a store that already holds an older reference
 * notices.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import {
  fromPersistedFramingReference,
  MAXIMUM_FRAMING_LANDMARKS,
  toPersistedFramingReference,
} from './persisted';
import {
  assertFramingReferenceRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  firstReferenceStoreFactory,
  verdictlessReferenceStoreFactory,
  framingReferenceFor,
  framingReferenceWithoutCheck,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
} from './testing';
import type { StoreHarness } from './testing';
import type { FramingCheckRecord } from './records';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('keeping a framing reference', () => {
  it('survives a round trip, every number', async () => {
    const reference = framingReferenceFor(ATHLETE_A);
    const read = await assertFramingReferenceRoundTrip(harness, reference);
    expect(read.landmarks.map((each) => each.name)).toStrictEqual(
      reference.landmarks.map((each) => each.name),
    );
  });

  it('is not there on a device that never had a session whose check passed', async () => {
    await expect(
      harness.read(async (store) => store.getFramingReference(ATHLETE_A)),
    ).resolves.toBeUndefined();
  });

  it('keeps the LAST session’s reference, not the first', async () => {
    await harness.write(async (store) =>
      store.putFramingReference(framingReferenceFor(ATHLETE_A, 1)),
    );
    const second = framingReferenceFor(ATHLETE_A, 2);
    const read = await assertFramingReferenceRoundTrip(harness, second);
    expect(read.landmarks[0]?.x).toBe(second.landmarks[0]?.x);
  });

  it('is forgotten on request, and says whether there was one', async () => {
    await harness.write(async (store) => store.putFramingReference(framingReferenceFor(ATHLETE_A)));
    await expect(
      harness.write(async (store) => store.deleteFramingReference(ATHLETE_A)),
    ).resolves.toBe(true);
    await expect(
      harness.write(async (store) => store.deleteFramingReference(ATHLETE_A)),
    ).resolves.toBe(false);
    await expect(
      harness.read(async (store) => store.getFramingReference(ATHLETE_A)),
    ).resolves.toBeUndefined();
  });

  it('goes with the athlete when the device is erased, and is counted', async () => {
    await harness.write(async (store) => store.putFramingReference(framingReferenceFor(ATHLETE_A)));
    await harness.write(async (store) => store.putFramingReference(framingReferenceFor(ATHLETE_B)));
    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.framingReferences).toBe(1);
    await expect(
      harness.read(async (store) => store.getFramingReference(ATHLETE_A)),
    ).resolves.toBeUndefined();
    // And nobody else's.
    await expect(
      harness.read(async (store) => store.getFramingReference(ATHLETE_B)),
    ).resolves.toBeDefined();
  });

  it('refuses a reference for an athlete who does not exist', async () => {
    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    await expect(
      harness.write(async (store) => store.putFramingReference(framingReferenceFor(ATHLETE_A))),
    ).rejects.toThrow(StoreReferentialError);
  });
});

describe('what a reference has to be', () => {
  const base = framingReferenceFor(ATHLETE_A);

  it.each([
    ['an aspect of zero', { ...base, aspect: 0 }],
    ['an aspect that is not a number', { ...base, aspect: Number.NaN }],
    ['no landmarks', { ...base, landmarks: [] }],
    [
      'too many landmarks',
      {
        ...base,
        landmarks: Array.from({ length: MAXIMUM_FRAMING_LANDMARKS + 1 }, (_, index) => ({
          name: `point-${String(index)}`,
          x: 0.5,
          y: 0.5,
        })),
      },
    ],
    ['a landmark off the picture', { ...base, landmarks: [{ name: 'knee', x: 1.2, y: 0.5 }] }],
    ['a landmark with no name', { ...base, landmarks: [{ name: ' ', x: 0.5, y: 0.5 }] }],
    [
      'the same landmark twice',
      {
        ...base,
        landmarks: [
          { name: 'knee', x: 0.5, y: 0.5 },
          { name: 'knee', x: 0.4, y: 0.5 },
        ],
      },
    ],
  ])('refuses %s on the way in', async (_what, reference) => {
    await expect(
      harness.write(async (store) => store.putFramingReference(reference)),
    ).rejects.toThrow(StoreValidationError);
  });

  it('refuses a hand-edited row on the way out', () => {
    const row = {
      ...toPersistedFramingReference(base),
      landmarks: [{ name: 'knee', x: -1, y: 0.5 }],
    };
    expect(() => fromPersistedFramingReference(row)).toThrow(StoreDecodeError);
  });

  it('never puts a landmark’s position in the message', async () => {
    // ADR 0029 D-8: a landmark is where somebody's knee was in a photograph.
    const reference = { ...base, landmarks: [{ name: 'knee', x: 1.2345, y: 0.5 }] };
    await expect(
      harness.write(async (store) => store.putFramingReference(reference)),
    ).rejects.toThrow(/^(?!.*1\.2345).*$/s);
  });
});

describe('whether the framing check passed, kept with the session’s numbers (#530, D-7)', () => {
  it.each<FramingCheckRecord>(['matches', 'differs', 'no-reference', 'not-checked'])(
    'keeps %s on the same row as the placement',
    async (check) => {
      const read = await assertFramingReferenceRoundTrip(
        harness,
        framingReferenceFor(ATHLETE_A, 1, check),
      );
      expect(read.check).toBe(check);
    },
  );

  it('replaces the verdict with the placement, so the two always describe one session', async () => {
    await harness.write(async (store) =>
      store.putFramingReference(framingReferenceFor(ATHLETE_A, 1, 'matches')),
    );
    const read = await assertFramingReferenceRoundTrip(
      harness,
      framingReferenceFor(ATHLETE_A, 2, 'differs'),
    );
    expect(read.check).toBe('differs');
  });

  it('reads a row written before #530 as "not recorded", not as any verdict', async () => {
    const before = framingReferenceWithoutCheck(ATHLETE_A);
    const read = await harness.roundTrip(
      async (store) => store.putFramingReference(before),
      async (store) => store.getFramingReference(ATHLETE_A),
    );
    expect(read).toBeDefined();
    expect(read).not.toHaveProperty('check');
  });

  it('refuses a verdict it does not know, on the way in and on the way out', async () => {
    const reference = {
      ...framingReferenceFor(ATHLETE_A),
      check: 'passed' as FramingCheckRecord,
    };
    await expect(
      harness.write(async (store) => store.putFramingReference(reference)),
    ).rejects.toThrow(StoreValidationError);
    const row = { ...toPersistedFramingReference(framingReferenceFor(ATHLETE_A)), check: 'yes' };
    expect(() => fromPersistedFramingReference(row)).toThrow(StoreDecodeError);
  });
});

describe('the fake that drops whether the check passed', () => {
  it('passes a reference that carries no verdict, so it is otherwise the real store', async () => {
    const broken = createStoreHarness({ factory: verdictlessReferenceStoreFactory() });
    try {
      await seedAthletes(broken);
      const before = framingReferenceWithoutCheck(ATHLETE_A);
      await expect(assertFramingReferenceRoundTrip(broken, before)).resolves.toBeDefined();
    } finally {
      await broken.destroy();
    }
  });

  it('is caught by the round trip, with every landmark right', async () => {
    const broken = createStoreHarness({ factory: verdictlessReferenceStoreFactory() });
    try {
      await seedAthletes(broken);
      await expect(
        assertFramingReferenceRoundTrip(broken, framingReferenceFor(ATHLETE_A, 1, 'matches')),
      ).rejects.toThrow(/framingReference\.check/);
    } finally {
      await broken.destroy();
    }
  });
});

describe('the fake that keeps the first reference', () => {
  it('passes a single session, which is why a single session is not the test', async () => {
    const broken = createStoreHarness({ factory: firstReferenceStoreFactory() });
    try {
      await seedAthletes(broken);
      await expect(
        assertFramingReferenceRoundTrip(broken, framingReferenceFor(ATHLETE_A, 1)),
      ).resolves.toBeDefined();
    } finally {
      await broken.destroy();
    }
  });

  it('is caught by the round trip once there is a previous session', async () => {
    const broken = createStoreHarness({ factory: firstReferenceStoreFactory() });
    try {
      await seedAthletes(broken);
      await broken.write(async (store) =>
        store.putFramingReference(framingReferenceFor(ATHLETE_A, 1)),
      );
      await expect(
        assertFramingReferenceRoundTrip(broken, framingReferenceFor(ATHLETE_A, 2)),
      ).rejects.toThrow(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });
});
