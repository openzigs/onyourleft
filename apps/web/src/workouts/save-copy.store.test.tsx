// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Save a copy* of a tailored built-in, through the REAL store — #2305.
 *
 * Tailored and saved on the screen, then read back from a FRESH connection
 * (`@onyourleft/store/testing`'s harness discards every handle before it
 * reads) through `listWorkouts(owner)`, the read the Workouts list makes: so
 * what is asserted is what a reload would list, not the object the screen
 * built. Two athletes are in the fixture, each with a workout of their own,
 * because a copy saved under the wrong owner — or a list that forgot the owner
 * — passes every test with one (CLAUDE.md §6, `activity-store.scoping.test.ts`).
 */

import {
  BUILT_IN_WORKOUTS,
  seconds,
  tailorWorkout,
  thresholdShare,
  unixSeconds,
  workoutShapeText,
} from '@onyourleft/domain';
import { workoutId, type WorkoutRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { chooseOption, mount, queryAll, settle, typeInto, type Mounted } from '../testing/mount';
import { WorkoutsView } from '../views/WorkoutsView';

const harnesses: StoreHarness[] = [];
let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  for (const harness of harnesses.splice(0)) {
    await harness.destroy();
  }
});

const TEMPLATE = BUILT_IN_WORKOUTS.find((each) => each.id === 'sweet-spot-3x12');

function own(id: string, owner: typeof ATHLETE_A, name: string): WorkoutRecord {
  return {
    id: workoutId(id),
    createdBy: owner,
    name,
    workout: {
      name,
      blocks: [{ kind: 'steady', seconds: seconds(1200), target: thresholdShare(0.6) }],
    },
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
}

/** Whether the screen has said the copy was saved. */
function saidSaved(): boolean {
  return (document.body.textContent ?? '').includes('to your workouts.');
}

/** Two athletes, each with a workout of their own already saved. */
async function twoAthletes(): Promise<StoreHarness> {
  const open = createStoreHarness();
  harnesses.push(open);
  await seedAthletes(open);
  await open.write(async (store) => {
    await store.putWorkout(own('workout-a-own', ATHLETE_A, 'A’s own'));
    await store.putWorkout(own('workout-b-own', ATHLETE_B, 'B’s own'));
  });
  return open;
}

/** Tailor the sweet-spot session to 45 minutes at −5 % on A's screen, and save a copy. */
async function saveCopyAsA(open: StoreHarness): Promise<void> {
  await open.write(async (store) => {
    mounted = await mount(
      <WorkoutsView
        port={{ athleteId: ATHLETE_A, store }}
        selected="built-in:sweet-spot-3x12"
        now={() => 1_800_000_000}
      />,
    );
    await settle();
    const pane = document.querySelector('[data-oyl-built-in-detail]');
    const length = pane?.querySelector<HTMLSelectElement>('[data-oyl-tailor="length"] select');
    const intensity = pane?.querySelector<HTMLInputElement>('[data-oyl-tailor="intensity"] input');
    if (length === null || length === undefined || intensity === null || intensity === undefined) {
      throw new Error('no tailor controls');
    }
    await chooseOption(length, '45');
    await typeInto(intensity, '-5');
    const save = queryAll<HTMLButtonElement>(document, 'button').find(
      (each) => each.textContent === 'Save a copy',
    );
    if (save === undefined) throw new Error('no Save a copy');
    save.click();
    // A real IndexedDB write and the list's read after it take more than one turn.
    for (let turn = 0; turn < 20 && !saidSaved(); turn += 1) {
      await settle();
    }
    expect(document.querySelector('[data-oyl-list="saved"]')?.textContent).toContain(
      'Sweet spot, three by twelve (47 min, −5%)',
    );
    mounted.unmount();
    mounted = undefined;
  });
}

describe('Save a copy, read back fresh — #2305', () => {
  it('lists the copy under its owner with the tailored blocks, deep-equal', async () => {
    if (TEMPLATE === undefined) throw new Error('no sweet-spot template');
    const open = await twoAthletes();
    await saveCopyAsA(open);

    const listed = await open.read((store) => store.listWorkouts(ATHLETE_A));
    const copy = listed.find((record) => record.name.startsWith('Sweet spot, three by twelve'));
    expect(copy).toBeDefined();
    const tailored = tailorWorkout(TEMPLATE, { targetMinutes: 45, intensityPercent: -5 });
    expect(copy?.workout.blocks).toStrictEqual(tailored.blocks);
    expect(copy?.workout.description).toBe(TEMPLATE.summary);
    expect(copy?.createdBy).toBe(ATHLETE_A);
    // Beside A's own, which it did not replace.
    expect(listed.map((record) => record.name).sort()).toEqual([
      'A’s own',
      'Sweet spot, three by twelve (47 min, −5%)',
    ]);
  });

  it('is not listed for the other athlete on the device, whose own is untouched', async () => {
    const open = await twoAthletes();
    await saveCopyAsA(open);

    const other = await open.read((store) => store.listWorkouts(ATHLETE_B));
    expect(other.map((record) => record.name)).toEqual(['B’s own']);
  });

  it('opens from the rider’s own list on a fresh screen, showing its blocks', async () => {
    if (TEMPLATE === undefined) throw new Error('no sweet-spot template');
    const open = await twoAthletes();
    await saveCopyAsA(open);
    const [copy] = (await open.read((store) => store.listWorkouts(ATHLETE_A))).filter((record) =>
      record.name.startsWith('Sweet spot'),
    );
    if (copy === undefined) throw new Error('no copy saved');

    await open.read(async (store) => {
      mounted = await mount(
        <WorkoutsView port={{ athleteId: ATHLETE_A, store }} selected={copy.id} />,
      );
      await settle();
      const chosen = document.querySelector('.oyl-selected');
      expect(chosen?.querySelector('h2')?.textContent).toBe(copy.name);
      expect(chosen?.textContent).toContain(
        workoutShapeText(tailorWorkout(TEMPLATE, { targetMinutes: 45, intensityPercent: -5 })),
      );
    });
  });
});
