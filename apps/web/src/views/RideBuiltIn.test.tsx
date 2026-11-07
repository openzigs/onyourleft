// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Ride it* — a tailored built-in ridden without saving it, #2306.
 *
 * From the tailor pane to the Ride screen through the address *Ride it*
 * links to, as `AppShell` hands it on (`matchHash` → `RouteMatch.query`), and
 * then through the Ride screen's own *Ride* to `RideController.startWorkout`
 * — the one start path. What is asserted is what the rider sees, what reached
 * the controller, and that nothing was written to the workouts store.
 */

import {
  BUILT_IN_WORKOUTS,
  tailorWorkout,
  unixSeconds,
  watts,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { athleteId, type WorkoutRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { stubAnalysis } from '../analysis/testing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { matchHash } from '../shell/routes';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { workoutStub, type WorkoutStub } from '../workouts/testing';
import { RideView } from './RideView';
import { WorkoutsView } from './WorkoutsView';

const OWNER = athleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const SWEET_SPOT = template('sweet-spot-3x12');
// The owner's ruling of 2026-11-07 (a): no length in the name, which the screen says beside it.
const NAME = 'Sweet spot, three by twelve (−5%)';

/** How many times `text` says `part`. */
function times(text: string | null | undefined, part: string): number {
  return (text ?? '').split(part).length - 1;
}

/** On the tailor pane: 45 minutes at −5 %, then the address *Ride it* links to. */
async function rideItAddress(): Promise<string> {
  mounted = await mount(
    <WorkoutsView port={workoutStub(OWNER)} selected="built-in:sweet-spot-3x12" />,
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
  const link = queryAll<HTMLAnchorElement>(pane as Element, 'a').find(
    (each) => each.textContent === 'Ride it',
  );
  if (link === undefined) throw new Error('no Ride it');
  const href = link.getAttribute('href') ?? '';
  mounted.unmount();
  mounted = undefined;
  return href;
}

function analysisWith(thresholdPower?: number) {
  return stubAnalysis(OWNER, [], {
    id: OWNER,
    displayName: 'A',
    createdAt: unixSeconds(1),
    ...(thresholdPower === undefined ? {} : { thresholdPower: watts(thresholdPower) }),
  });
}

/** The Ride screen at an address, as the shell renders it. */
async function rideScreen(
  href: string,
  options: {
    readonly thresholdPower?: number;
    readonly workouts?: WorkoutStub;
    readonly snapshot?: ReturnType<typeof ridingSnapshot>;
  } = {},
) {
  const match = matchHash(href);
  expect(match.route.id).toBe('ride');
  const stub = stubRideController(options.snapshot ?? ridingSnapshot());
  const started: WorkoutRecord[] = [];
  const startWorkout = stub.controller.startWorkout.bind(stub.controller);
  const controller = {
    ...stub.controller,
    startWorkout: (...args: Parameters<typeof startWorkout>) => {
      started.push(args[0]);
      return startWorkout(...args);
    },
  };
  mounted = await mount(
    <RideView
      controller={controller}
      workouts={options.workouts ?? workoutStub(OWNER)}
      analysis={analysisWith(options.thresholdPower)}
      query={match.query}
    />,
  );
  await settle();
  return { stub, started };
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    (each.textContent ?? '').startsWith(`Ride ${NAME}`),
  );
}

describe('Ride it opens the Ride screen with the tailored built-in loaded — #2306', () => {
  it('offers it by name and length, and Ride starts it through startWorkout with the rider’s threshold', async () => {
    const href = await rideItAddress();
    expect(href).toBe('#/ride?workout=built-in%3Asweet-spot-3x12&length=45&intensity=-5');
    const { stub, started } = await rideScreen(href, { thresholdPower: 250 });

    const panel = document.querySelector('.oyl-ride__group--trainer');
    expect(panel?.textContent).toContain(`${NAME} — 47 min,`);
    // (a) The length is said once on the workout's line, not in its name as well.
    const line = queryAll(panel ?? document, 'li').find((each) =>
      (each.textContent ?? '').startsWith(NAME),
    );
    expect(times(line?.textContent, '47 min')).toBe(1);
    const ride = rideButton();
    expect(ride).toBeDefined();
    await activateWithKeyboard(ride as HTMLButtonElement);
    await settle();

    expect(stub.calls.startWorkout).toEqual([NAME]);
    expect(stub.calls.startWorkoutWith).toStrictEqual([
      { thresholdPower: 250, heartRateHold: undefined, choices: {} },
    ]);
    // The workout ridden is the one previewed.
    expect(started[0]?.workout.blocks).toStrictEqual(
      tailorWorkout(SWEET_SPOT, { targetMinutes: 45, intensityPercent: -5 }).blocks,
    );
    expect(started[0]?.id).toBe('built-in:sweet-spot-3x12');
  });

  it('shows its name and length with no threshold, and offers no Ride for it', async () => {
    const href = await rideItAddress();
    const { stub } = await rideScreen(href);
    const offered = document.querySelector('[data-oyl-offered-workout]');
    expect(offered?.textContent).toContain(`${NAME} — 47 min,`);
    expect(times(offered?.textContent, '47 min')).toBe(1);
    expect(document.body.textContent).toContain('Set your threshold power on the Analysis screen');
    expect(rideButton()).toBeUndefined();
    expect(stub.calls.startWorkout).toEqual([]);
  });

  it('lists it first, before the saved workouts, each with its own Ride', async () => {
    const saved: WorkoutRecord = {
      id: 'workout-own' as WorkoutRecord['id'],
      createdBy: OWNER,
      name: 'My own',
      workout: tailorWorkout(template('tempo-2x20'), {}),
      createdAt: unixSeconds(1),
      updatedAt: unixSeconds(1),
    };
    const href = await rideItAddress();
    await rideScreen(href, { thresholdPower: 250, workouts: workoutStub(OWNER, [saved]) });
    const rows = queryAll(document, '.oyl-ride__group--trainer li').map(
      (row) => row.textContent ?? '',
    );
    expect(rows[0]).toContain(NAME);
    expect(rows[1]).toContain('My own');
  });

  it('says why when the address asks for what the built-in cannot be', async () => {
    await rideScreen('#/ride?workout=built-in%3Asweet-spot-3x12&intensity=40', {
      thresholdPower: 250,
    });
    expect(document.body.textContent).toContain(
      'Sweet spot, three by twelve cannot be ridden as it was asked for.',
    );
    expect(document.body.textContent).toContain('you asked for +40%');
    expect(
      queryAll<HTMLButtonElement>(document, 'button').some((each) =>
        (each.textContent ?? '').startsWith('Ride Sweet spot'),
      ),
    ).toBe(false);
  });

  it('still says why when the rider has saved workouts, which list in its place', async () => {
    const saved: WorkoutRecord = {
      id: 'workout-own' as WorkoutRecord['id'],
      createdBy: OWNER,
      name: 'My own',
      workout: tailorWorkout(template('tempo-2x20'), {}),
      createdAt: unixSeconds(1),
      updatedAt: unixSeconds(1),
    };
    await rideScreen('#/ride?workout=built-in%3Asweet-spot-3x12&intensity=40', {
      thresholdPower: 250,
      workouts: workoutStub(OWNER, [saved]),
    });
    const panel = document.querySelector('.oyl-ride__group--trainer');
    expect(panel?.textContent).toContain('My own');
    expect(panel?.textContent).toContain(
      'Sweet spot, three by twelve cannot be ridden as it was asked for.',
    );
    expect(panel?.textContent).toContain('you asked for +40%');
  });

  it('names the built-in and asks for control when the trainer has not granted it', async () => {
    const base = ridingSnapshot();
    const href = await rideItAddress();
    const { stub } = await rideScreen(href, {
      thresholdPower: 250,
      snapshot: { ...base, trainer: { ...base.trainer, hasControl: false } },
    });
    const panel = document.querySelector('.oyl-ride__group--trainer');
    expect(panel?.textContent).toContain('Ask the trainer for control first');
    expect(panel?.querySelector('[data-oyl-offered-workout]')?.textContent).toContain(
      `${NAME} — 47 min,`,
    );
    expect(rideButton()).toBeUndefined();
    expect(stub.calls.startWorkout).toEqual([]);
  });

  it('names the built-in and asks for a controllable trainer when there is none', async () => {
    const href = await rideItAddress();
    const { stub } = await rideScreen(href, { thresholdPower: 250, snapshot: idleSnapshot() });
    expect(document.querySelector('[data-oyl-offered-workout]')?.textContent).toContain(
      `${NAME} — 47 min,`,
    );
    expect(document.body.textContent).toContain(
      'Pair a trainer that can be controlled to ride it.',
    );
    expect(rideButton()).toBeUndefined();
    expect(stub.calls.startWorkout).toEqual([]);
  });

  it('says why a refused address cannot be ridden when there is no controllable trainer', async () => {
    await rideScreen('#/ride?workout=built-in%3Asweet-spot-3x12&intensity=40', {
      snapshot: idleSnapshot(),
    });
    expect(document.body.textContent).toContain('cannot be ridden as it was asked for.');
    expect(document.body.textContent).not.toContain('Pair a trainer that can be controlled');
  });
});

describe('riding a built-in writes no row to the workouts store — #2306', () => {
  it('leaves listWorkouts(owner) as it was, before and after Ride', async () => {
    const workouts = workoutStub(OWNER);
    const before = await workouts.store.listWorkouts(OWNER);
    const href = await rideItAddress();
    await rideScreen(href, { thresholdPower: 250, workouts });
    await activateWithKeyboard(rideButton() as HTMLButtonElement);
    await settle();
    expect(await workouts.store.listWorkouts(OWNER)).toEqual(before);
    expect(workouts.rows()).toEqual([]);
  });
});
