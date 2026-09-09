// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The erase decision, its wording, and the erase itself against the real store.
 *
 * The wording assertions are not decoration. #35: *"A deletion dialogue that
 * implies more than the architecture can deliver is the worst outcome."* A test
 * that re-typed the sentences would pass against a dialogue that had been
 * softened, so these read the exported constants — the same reason
 * `PUBLIC_ROUTE_WARNING` is a constant and not a string in a component.
 */

import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
  workoutFor,
} from '@onyourleft/store/testing';
import { unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ERASE_CANNOT_REACH,
  ERASE_CONFIRMATION,
  ERASE_REFUSAL_TEXT,
  ERASE_REMOVES,
  eraseDecision,
  eraseDevice,
  eraseSentence,
} from './erase-device';

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('the decision', () => {
  it('refuses an empty box', () => {
    expect(eraseDecision('', true)).toStrictEqual({ ready: false, refusal: 'not-confirmed' });
  });

  it('refuses a near miss', () => {
    // A prefix is not confirmation, and neither is a superset. Somebody typing
    // "erase" and pressing the button has not confirmed anything.
    expect(eraseDecision('erase', true).ready).toBe(false);
    expect(eraseDecision('erase everything now', true).ready).toBe(false);
  });

  it('accepts the phrase however it was capitalised or spaced', () => {
    // A rider who typed it meant it. Rejecting a trailing space would be
    // pedantry dressed as safety.
    expect(eraseDecision('  Erase Everything ', true).ready).toBe(true);
    expect(eraseDecision(ERASE_CONFIRMATION, true).ready).toBe(true);
  });

  it('refuses when there is nothing to erase, before it looks at the phrase', () => {
    // Ordered this way so a rider with an empty device is told the true reason
    // rather than being asked to type a confirmation that would do nothing.
    expect(eraseDecision(ERASE_CONFIRMATION, false)).toStrictEqual({
      ready: false,
      refusal: 'nothing-to-erase',
    });
  });

  it('has wording for every refusal it can return', () => {
    // The record is keyed by the union, so a new refusal is a compile error
    // rather than an `undefined` on a rider's screen.
    for (const refusal of ['not-confirmed', 'nothing-to-erase'] as const) {
      expect(ERASE_REFUSAL_TEXT[refusal].length).toBeGreaterThan(10);
    }
  });
});

describe('what the rider is told before they press it', () => {
  it('names the signing key among what goes', () => {
    // ADR 0014 D-7: the key cannot be backed up and cannot be replaced. A
    // dialogue that listed rides and not this would imply less than it does.
    expect(ERASE_REMOVES.join(' ')).toContain('signing key');
  });

  it('names the per-second samples rather than only the rides', () => {
    // A rider thinking "I can re-import my FIT files" is reasoning about the
    // rides. The streams are the part an export of a lossy format loses.
    expect(ERASE_REMOVES.join(' ')).toContain('per-second');
  });

  it('names the signed records and the laps, the two the export used to leave', () => {
    // #221's sixth criterion. Both go in `deleteAthlete`'s cascade, and until
    // that issue neither came out in the export — so the rider who read this
    // list, exported everything and then erased lost both without being told.
    // The list is the last thing read before an irreversible action, so a line
    // missing from it is a rider consenting to something they were not shown.
    const text = ERASE_REMOVES.join(' ');
    expect(text).toContain('signed record');
    expect(text).toContain('laps');
  });

  it('says an exported file is out of reach, and that a shared ride is a copy', () => {
    const text = ERASE_CANNOT_REACH.join(' ');
    expect(text).toContain('already exported');
    expect(text).toContain('copy they hold');
  });

  it('lists nothing it cannot actually do', () => {
    // The list is short on purpose and every entry is a fact about the
    // architecture. If it ever grows a "we will ask other instances" line, that
    // line must arrive with the instance that makes it true.
    expect(ERASE_CANNOT_REACH.length).toBeLessThanOrEqual(3);
  });
});

describe('erasing, against the real store', () => {
  async function seed(owner: typeof ATHLETE_A, rides: number): Promise<void> {
    for (let index = 0; index < rides; index += 1) {
      const ride = rideFor(owner, { hasPosition: true });
      await harness.write(async (store) => {
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 20 }));
      });
    }
    await harness.write(async (store) => {
      await store.putRoute(routeFor(owner));
      await store.putWorkout(workoutFor(owner));
    });
  }

  it('removes this athlete and reports what went', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 2);

    const outcome = await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    expect(outcome.activities).toBe(2);
    expect(outcome.routes).toBe(1);
    expect(outcome.workouts).toBe(1);
    // Read back through a fresh connection: the erase has to have reached disk,
    // not just the handle that ran it.
    const left = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(left).toStrictEqual([]);
  });

  it('leaves another athlete alone', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    await seed(ATHLETE_B, 2);

    await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    const theirs = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_B));
    expect(theirs).toHaveLength(2);
  });

  it('puts the athlete row back, so the next write does not fail', async () => {
    // ⚠️ The regression this exists to stop is #184, exactly. `deleteAthlete`
    // removes the row every write path checks, and `ensureLocalAthlete` runs
    // once at start-up — so without the recreate, the tab survives the erase
    // and the next ride fails its first checkpoint referentially. The recorder
    // catches that and carries on in memory, so the ride runs normally right up
    // to the moment the tab closes and takes the whole thing with it.
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);

    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        athlete: { id: ATHLETE_A, displayName: 'You', createdAt: unixSeconds(1_800_000_000) },
      }),
    );

    // The write that would have thrown.
    const after = rideFor(ATHLETE_A, { hasPosition: true });
    await expect(harness.write(async (store) => store.putActivity(after))).resolves.toBeDefined();
  });

  it('leaves no row at all when no replacement was given', async () => {
    // The other half, so the recreate is a decision the caller makes rather
    // than something this function does unconditionally: a caller that wants
    // the device genuinely empty — a test, or an uninstall path — gets that.
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);

    await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    await expect(
      harness.read(async (store) => store.getAthlete(ATHLETE_A)),
    ).resolves.toBeUndefined();
  });

  it('forgets the half-drawn route, which the store cannot see', async () => {
    // A route draft lives in `localStorage`, and its waypoints are raw
    // coordinates — usually starting at the rider's front door. `deleteAthlete`
    // cannot reach it, so an erase that only called the store would leave it
    // behind while saying this device holds nothing about you.
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    const forgotten: string[] = [];

    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        drafts: {
          forget: () => {
            forgotten.push('draft');
          },
        },
      }),
    );

    expect(forgotten).toStrictEqual(['draft']);
  });

  it('does not forget the draft when the cascade threw', async () => {
    // Ordered so a failed delete does not lose a half-drawn route for nothing.
    const forgotten: string[] = [];
    const refusing = {
      deleteAthlete: () => Promise.reject(new Error('refused')),
      ensureAthlete: () => Promise.reject(new Error('unreachable')),
    };

    await expect(
      eraseDevice(refusing, ATHLETE_A, {
        drafts: {
          forget: () => {
            forgotten.push('draft');
          },
        },
      }),
    ).rejects.toThrow('refused');
    expect(forgotten).toStrictEqual([]);
  });

  it('is idempotent — a second press is not an error', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);

    await harness.write(async (store) => eraseDevice(store, ATHLETE_A));
    const again = await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    expect(again.activities).toBe(0);
  });
});

describe('the sentence afterwards', () => {
  it('counts what went', () => {
    expect(eraseSentence({ activities: 4, routes: 2, workouts: 0, segments: 1 })).toBe(
      'Removed 4 rides, 2 routes, 1 segment. This device now holds nothing about you.',
    );
  });

  it('says one ride rather than 1 rides', () => {
    expect(eraseSentence({ activities: 1, routes: 0, workouts: 0, segments: 0 })).toContain(
      '1 ride.',
    );
  });

  it('names nothing that could be a place', () => {
    // ADR 0004 decision D, applied to the one screen that runs immediately
    // after an athlete asked for their location history to be gone. A route is
    // routinely named after where it goes.
    const sentence = eraseSentence({ activities: 3, routes: 1, workouts: 1, segments: 1 });
    expect(sentence).toMatch(/^Removed [\d\s,a-z]+\. This device now holds nothing about you\.$/);
  });
});
