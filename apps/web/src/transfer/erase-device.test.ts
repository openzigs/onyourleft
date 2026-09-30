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

import { instanceEraser, INSTANCE_SESSION_STORAGE_KEY } from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import {
  ATHLETE_A,
  cameraFrameFor,
  ATHLETE_B,
  createStoreHarness,
  framingReferenceFor,
  sideCameraReportFor,
  rideWriteUpFor,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
  workoutFor,
} from '@onyourleft/store/testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ActivityId } from '@onyourleft/store';
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

  it('names the pictures AND everything derived from one — #384, ADR 0029 D-4', () => {
    // ⚠️ The second half is the half that is easy to drop, and the ADR spells
    // it out: a pose skeleton, a set of joint coordinates, a model's
    // description of the rider, a thumbnail generated for a report — each is a
    // smaller artefact saying the same thing about the same person, and
    // *"a deletion that leaves a derived artefact is not a deletion"*.
    const text = ERASE_REMOVES.join(' ');
    expect(text).toContain('photograph');
    expect(text).toContain('everything derived from one');
  });

  it('names the side camera’s framing reference — #528, ADR 0033 D-7', () => {
    // Numbers read off a picture of the rider, not a picture, so the line
    // above does not obviously cover it for a rider reading the list before an
    // irreversible action.
    expect(ERASE_REMOVES.join(' ')).toContain('side camera');
  });

  it('names the side camera’s pose summaries and the ride write-ups — #801', () => {
    const text = ERASE_REMOVES.join(' ');
    expect(text).toContain('how much your position changed');
    expect(text).toContain('write-up of a ride');
  });

  it('names the side camera’s reports — #388, the owner’s retention ruling', () => {
    expect(ERASE_REMOVES.join(' ')).toContain('side camera’s report');
  });

  it('names the copy on the rider’s own machine, and NOT a hosted one — #387', () => {
    // ADR 0029 D-4 writes two `ERASE_CANNOT_REACH` lines. #387 made the first
    // true — a picture can now be sent to the rider's own computer — and it is
    // there verbatim. The second is about a hosted model, which #387 did not
    // build and the address rule refuses; claiming it would be the list ageing
    // into a lie in the *frightening* direction.
    const text = ERASE_CANNOT_REACH.join(' ');
    expect(ERASE_CANNOT_REACH).toContain(
      'a photograph you sent to your own machine to be analysed, which is a copy that machine holds',
    );
    // D-4's second line is about a PHOTOGRAPH sent to a hosted model, and the
    // owner ruled the hosted path is never sent one (#518) — so that line is
    // still not here, in either wording.
    expect(text).not.toContain('photograph you sent to a hosted');
    expect(text).not.toMatch(/hosted[^,]*photograph|photograph[^,]*hosted/);
    // And what was already true: a picture the rider copied off the device.
    expect(text).toContain('copied off this device');
  });

  it('names the copy a hosted service holds of a question and of a ride’s numbers — #518, #803', () => {
    // ADR 0029's 2026-09-28 amendment wrote the line for a question; #803
    // sends a ride's numbers there too, and the line says so. Not a picture.
    expect(ERASE_CANNOT_REACH).toContain(
      'a question or a ride’s numbers you sent to a service you chose, on your own key, which is a copy that service holds',
    );
  });

  it('names the ride’s numbers sent to a hosted service, as the privacy policy does — #803', () => {
    const policy = readFileSync(
      fileURLToPath(new URL('../../../../docs/privacy-policy.md', import.meta.url)),
      'utf8',
    );
    const erase = policy.slice(
      policy.indexOf('## Deleting your data'),
      policy.indexOf('## Children'),
    );
    const straight = (text: string): string => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
    expect(straight(erase)).toContain(
      "a question or a ride's numbers you sent to a service you chose, which is a copy that service holds",
    );
    const line = ERASE_CANNOT_REACH.find((entry) => straight(entry).includes('service you chose'));
    expect(straight(line ?? '')).toContain("a question or a ride's numbers");
  });

  it('names the rider’s goals, ride notes and documents among what an erase removes — #836', () => {
    const text = ERASE_REMOVES.join(' ');
    expect(text).toContain('your goals');
    expect(text).toContain('notes on your rides');
    expect(text).toContain('documents you added');
  });

  it('names the hosted service’s key among what an erase removes — #518', () => {
    expect(ERASE_REMOVES.join(' ')).toContain('key you entered for a hosted model');
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
    // Five since #518, whose hosted path made the fifth true; six since #804,
    // whose press sends a ride's numbers to the rider's own computer; seven
    // since #777, which connects this device to an instance — and arrived
    // with it, as this comment asked.
    expect(ERASE_CANNOT_REACH.length).toBeLessThanOrEqual(7);
  });

  it('names what an instance holds, as the privacy policy does — #777, #778', () => {
    const policy = readFileSync(
      fileURLToPath(new URL('../../../../docs/privacy-policy.md', import.meta.url)),
      'utf8',
    );
    const erase = policy.slice(
      policy.indexOf('## Deleting your data'),
      policy.indexOf('## Children'),
    );
    const straight = (text: string): string => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
    expect(straight(erase)).toContain('your account on an instance you connected to');
    expect(straight(erase)).toContain('which is a copy that instance holds');
    const line = ERASE_CANNOT_REACH.find((entry) =>
      straight(entry).includes('your account on an instance you connected to'),
    );
    expect(straight(line ?? '')).toContain('which is a copy that instance holds');
  });

  it('names the ride’s numbers sent to the rider’s own computer, as the privacy policy does — #804', () => {
    const policy = readFileSync(
      fileURLToPath(new URL('../../../../docs/privacy-policy.md', import.meta.url)),
      'utf8',
    );
    const erase = policy.slice(
      policy.indexOf('## Deleting your data'),
      policy.indexOf('## Children'),
    );
    const straight = (text: string): string => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
    // The policy's erase paragraph says it…
    expect(straight(erase)).toContain("a ride's numbers you sent to your own computer");
    expect(straight(erase)).toContain('which is a copy that computer holds');
    // …and so does the screen, before the rider presses anything.
    const line = ERASE_CANNOT_REACH.find((entry) =>
      straight(entry).includes("a ride's numbers you sent to your own computer"),
    );
    expect(line).toBeDefined();
    expect(straight(line ?? '')).toContain('which is a copy that computer holds');
  });
});

describe('erasing, against the real store', () => {
  async function seed(owner: typeof ATHLETE_A, rides: number): Promise<ActivityId[]> {
    const ids: ActivityId[] = [];
    for (let index = 0; index < rides; index += 1) {
      const ride = rideFor(owner, { hasPosition: true });
      ids.push(ride.id);
      await harness.write(async (store) => {
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 20 }));
        // #388. The side camera's report on this ride, named in ERASE_REMOVES —
        // with its pose summary (#801), named there too.
        await store.putSideCameraReport(sideCameraReportFor(owner, ride.id));
        // #801. A model's write-up of this ride, named in ERASE_REMOVES.
        await store.putRideWriteUp(rideWriteUpFor(owner, ride.id));
      });
    }
    await harness.write(async (store) => {
      await store.putRoute(routeFor(owner));
      await store.putWorkout(workoutFor(owner));
      // #384. The most sensitive row the store holds, and the one ADR 0029
      // D-11 makes the erase the only remedy for.
      await store.putCameraFrame(cameraFrameFor(owner));
      // #528. Numbers read off a picture of the rider, named in ERASE_REMOVES.
      await store.putFramingReference(framingReferenceFor(owner));
    });
    return ids;
  }

  it('removes this athlete and reports what went', async () => {
    await seedAthletes(harness);
    const erased = await seed(ATHLETE_A, 2);

    const outcome = await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    expect(outcome.activities).toBe(2);
    expect(outcome.routes).toBe(1);
    expect(outcome.workouts).toBe(1);
    expect(outcome.cameraFrames).toBe(1);
    // Read back through a fresh connection: the erase has to have reached disk,
    // not just the handle that ran it.
    const left = await harness.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(left).toStrictEqual([]);
    // ⚠️ **The assertion #384 calls the worst version of this bug** — *"a frame
    // the rider believes was erased, and was not"*. Read on a connection
    // nothing wrote through, which is the only read that can tell.
    const pictures = await harness.read(async (store) => store.listCameraFrames(ATHLETE_A));
    expect(pictures).toStrictEqual([]);
    // #528: ERASE_REMOVES names the framing reference, and this is what makes
    // that line true rather than a promise.
    const reference = await harness.read(async (store) => store.getFramingReference(ATHLETE_A));
    expect(reference).toBeUndefined();
    // #388: ERASE_REMOVES names the side camera's reports, and this is what
    // makes that line true.
    for (const id of erased) {
      const report = await harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, id));
      expect(report).toBeUndefined();
      // #801: the write-up line is true too.
      const writeUp = await harness.read(async (store) => store.getRideWriteUp(ATHLETE_A, id));
      expect(writeUp).toBeUndefined();
    }
  });

  it('leaves another athlete alone', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    await seed(ATHLETE_B, 2);

    await harness.write(async (store) => eraseDevice(store, ATHLETE_A));

    const theirPictures = await harness.read(async (store) => store.listCameraFrames(ATHLETE_B));
    expect(theirPictures).toHaveLength(1);
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

  it('forgets the palette choice after the cascade, as it does the draft (#672)', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    const forgotten: string[] = [];
    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        drafts: { forget: () => void forgotten.push('draft') },
        theme: { forget: () => void forgotten.push('theme') },
      }),
    );
    expect(forgotten).toStrictEqual(['draft', 'theme']);
  });

  it('forgets the hosted model and its key after the cascade (#518)', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    const forgotten: string[] = [];
    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        hostedModel: { forget: () => void forgotten.push('hosted-model') },
      }),
    );
    expect(forgotten).toStrictEqual(['hosted-model']);
  });

  it('forgets this device’s sign-in to an instance after the cascade, over real storage (#777)', async () => {
    await seedAthletes(harness);
    await seed(ATHLETE_A, 1);
    const kept = new Map<string, string>([
      [INSTANCE_SESSION_STORAGE_KEY, 'token'],
      [INSTANCE_ACCOUNT_STORAGE_KEY, '{"origin":"https://ride.example"}'],
      ['oyl.units.other', 'kept'],
    ]);
    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        instance: instanceEraser({ removeItem: (key) => void kept.delete(key) }),
      }),
    );
    expect([...kept.keys()]).toStrictEqual(['oyl.units.other']);
  });

  it('does not forget the instance sign-in when the cascade threw (#777)', async () => {
    const forgotten: string[] = [];
    const refusing = {
      deleteAthlete: () => Promise.reject(new Error('refused')),
      ensureAthlete: () => Promise.reject(new Error('unreachable')),
    };
    await expect(
      eraseDevice(refusing, ATHLETE_A, {
        instance: { forget: () => void forgotten.push('instance') },
      }),
    ).rejects.toThrow('refused');
    expect(forgotten).toStrictEqual([]);
  });

  it('does not forget the hosted key when the cascade threw (#518)', async () => {
    const forgotten: string[] = [];
    const refusing = {
      deleteAthlete: () => Promise.reject(new Error('refused')),
      ensureAthlete: () => Promise.reject(new Error('unreachable')),
    };
    await expect(
      eraseDevice(refusing, ATHLETE_A, {
        hostedModel: { forget: () => void forgotten.push('hosted-model') },
      }),
    ).rejects.toThrow('refused');
    expect(forgotten).toStrictEqual([]);
  });

  it('does not forget the palette choice when the cascade threw (#672)', async () => {
    const forgotten: string[] = [];
    const refusing = {
      deleteAthlete: () => Promise.reject(new Error('refused')),
      ensureAthlete: () => Promise.reject(new Error('unreachable')),
    };
    await expect(
      eraseDevice(refusing, ATHLETE_A, { theme: { forget: () => void forgotten.push('theme') } }),
    ).rejects.toThrow('refused');
    expect(forgotten).toStrictEqual([]);
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
    expect(
      eraseSentence({ activities: 4, routes: 2, workouts: 0, segments: 1, cameraFrames: 0 }),
    ).toBe('Removed 4 rides, 2 routes, 1 segment. This device now holds nothing about you.');
  });

  it('says one ride rather than 1 rides', () => {
    expect(
      eraseSentence({ activities: 1, routes: 0, workouts: 0, segments: 0, cameraFrames: 0 }),
    ).toContain('1 ride.');
  });

  it('names nothing that could be a place', () => {
    // ADR 0004 decision D, applied to the one screen that runs immediately
    // after an athlete asked for their location history to be gone. A route is
    // routinely named after where it goes.
    const sentence = eraseSentence({
      activities: 3,
      routes: 1,
      workouts: 1,
      segments: 1,
      cameraFrames: 2,
    });
    expect(sentence).toMatch(/^Removed [\d\s,a-z]+\. This device now holds nothing about you\.$/);
  });
});
