// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A heart-rate hold built on the Workouts screen, through the REAL store and
 * the real file — #1241.
 *
 * Built on the screen, saved through the screen, and read back from a FRESH
 * store connection (`@onyourleft/store/testing`'s harness discards every
 * handle before it reads), so what is asserted is what a reload would show —
 * not the object the screen just constructed. Then exported, and imported
 * into an empty store, and read back fresh again.
 */

import { seconds, thresholdShare, unixSeconds } from '@onyourleft/domain';
import { workoutId, type WorkoutRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { WorkoutsView } from '../views/WorkoutsView';

import { exportedWorkout, workoutFromFile } from './transfer';

const harnesses: StoreHarness[] = [];
let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  for (const harness of harnesses.splice(0)) {
    await harness.destroy();
  }
});

function harness(): StoreHarness {
  const made = createStoreHarness();
  harnesses.push(made);
  return made;
}

function field(root: ParentNode, id: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`#${id}`);
  if (input === null) throw new Error(`no field ${id} on this screen`);
  return input;
}

function press(root: ParentNode, text: string): Promise<void> {
  const button = queryAll<HTMLButtonElement>(root, 'button').find((each) =>
    (each.textContent ?? '').includes(text),
  );
  if (button === undefined) throw new Error(`no button saying ${text}`);
  return activateWithKeyboard(button);
}

const HOLD_BLOCK = {
  kind: 'heart-rate-hold',
  seconds: 1800,
  range: { low: 130, high: 140 },
  startShare: 0.55,
  ceilingShare: 0.8,
} as const;

/** Build a workout with a warm-up and a hold on the screen, and save it into `open`'s store. */
async function buildAndSave(open: StoreHarness): Promise<void> {
  await open.write(async (store) => {
    mounted = await mount(
      <WorkoutsView port={{ athleteId: ATHLETE_A, store }} now={() => 1_800_000_000} />,
    );
    await settle();
    const root = mounted.container;

    await typeInto(field(root, 'block-minutes'), '10');
    await typeInto(field(root, 'block-percent'), '50');
    await press(root, 'Add block');

    const kind = root.querySelector<HTMLSelectElement>('#block-kind');
    if (kind === null) throw new Error('no kind picker');
    await chooseOption(kind, 'heart-rate-hold');
    await typeInto(field(root, 'block-minutes'), '30');
    await typeInto(field(root, 'block-percent'), '55');
    await typeInto(field(root, 'block-ceiling-percent'), '80');
    await typeInto(field(root, 'block-low-bpm'), '130');
    await typeInto(field(root, 'block-high-bpm'), '140');
    await press(root, 'Add block');
    expect(root.textContent).toContain('30 min holding 130–140 bpm');

    await typeInto(field(root, 'workout-name'), 'Endurance hold');
    await press(root, 'Save workout');
    await settle();
    mounted.unmount();
    mounted = undefined;
  });
}

describe('a heart-rate hold built on the Workouts screen — #1241', () => {
  it('reads back from a fresh store read with every field equal', async () => {
    const open = harness();
    await seedAthletes(open);
    await buildAndSave(open);

    const saved = await open.read((store) => store.listWorkouts(ATHLETE_A));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.workout.blocks).toStrictEqual([
      { kind: 'steady', seconds: 600, target: 0.5 },
      HOLD_BLOCK,
    ]);
  });

  it('exports as version 2, and imports into an empty store as the same workout', async () => {
    const open = harness();
    await seedAthletes(open);
    await buildAndSave(open);
    const [record] = await open.read((store) => store.listWorkouts(ATHLETE_A));
    if (record === undefined) throw new Error('nothing was saved');

    const file = exportedWorkout(record);
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain('"onYourLeftWorkout": 2,');

    const empty = harness();
    await seedAthletes(empty);
    const outcome = workoutFromFile(text, {
      id: workoutId('imported'),
      owner: ATHLETE_A,
      now: 1_800_000_100,
    });
    if (outcome.status !== 'imported') throw new Error(outcome.refusal.message);
    await empty.write((store) => store.putWorkout(outcome.record));

    const back = await empty.read((store) => store.getWorkout(ATHLETE_A, workoutId('imported')));
    expect(back?.workout).toStrictEqual(record.workout);
  });

  it('a workout without a hold still exports as version 1', () => {
    const record: WorkoutRecord = {
      id: workoutId('plain'),
      createdBy: ATHLETE_A,
      name: 'Plain',
      workout: {
        name: 'Plain',
        blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.5) }],
      },
      createdAt: unixSeconds(1),
      updatedAt: unixSeconds(1),
    };
    const text = new TextDecoder().decode(exportedWorkout(record).bytes);
    expect(text).toContain('"onYourLeftWorkout": 1,');
  });
});
