// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The group ride's control on the picker — #3303, ADR 0101 D-1: its switch,
 * its speed box and its size select have names, are reached by keyboard, and
 * audit clean in each state a rider can meet:
 *
 * - off, with the hint the switch is described by;
 * - on, with the two controls;
 * - refused, where the reason is an alert **and** travels with the speed box
 *   and with *Ride* (`aria-describedby`, #255's rule);
 * - **not offered**, with a workout holding the trainer at a set power, the
 *   draft switched off, or a loop chosen (#3369): the switch is disabled and
 *   **its accessible description is the reason**, so a rider who reaches it
 *   hears why.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { watts } from '@onyourleft/domain';

import { auditAccessibility, formatViolations, keyboardReachableElements } from '../../a11y/audit';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { SOLO_DRAFT_STORAGE_KEY } from '../solo-draft-preference';
import { NO_GAME_TRAINER, type GameTrainerPort } from '../trainer-port';

import { GROUP_RIDE_STORAGE_KEY, GROUP_RIDE_UNAVAILABLE_TEXT } from './choice';

const ROUTE: RidableRoute = {
  id: 'a',
  name: 'Level road',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};

/** A loop of the rider's own, on which a group ride is not offered yet (#3369). */
const LOOP: RidableRoute = {
  id: 'loop',
  name: 'Loop',
  profile: circuitRoute(40, () => 0),
  attempts: 0,
};

const portFor = (route: RidableRoute): GamePort => ({
  listRoutes: () => Promise.resolve([route]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(0), live: false, paired: false },
    cadence: { value: undefined, live: false, paired: false },
    heartRate: { value: undefined, live: false, paired: false },
  }),
});

/** The game's port to the ride, with a workout holding the trainer or with none. */
function trainer(workout: boolean): GameTrainerPort {
  return {
    readTrainer: () => (workout ? { kind: 'workout', control: undefined } : NO_GAME_TRAINER),
    askForControlOnRide: () => Promise.resolve(),
    workoutRescue: () => undefined,
    recordingMayStop: () => false,
    gameRideEnded: () => undefined,
    rideMovingSeconds: () => undefined,
    watchRide: () => () => undefined,
  };
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
});

async function picker(workout = false, route: RidableRoute = ROUTE): Promise<Mounted> {
  const tree = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={portFor(route)} trainer={trainer(workout)} />
    </main>,
  );
  await settle();
  return tree;
}

const groupSwitch = (root: ParentNode): HTMLInputElement =>
  queryAll<HTMLInputElement>(root, 'input[type="checkbox"]').find((input) =>
    (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
  ) as HTMLInputElement;

/** The control a `<label for>` names, by the label's words. */
function labelled<T extends HTMLElement>(root: ParentNode, words: string): T | undefined {
  const label = queryAll<HTMLLabelElement>(root, 'label').find(
    (each) => (each.textContent ?? '') === words,
  );
  return label === undefined || label.htmlFor === ''
    ? undefined
    : ((document.getElementById(label.htmlFor) as T | null) ?? undefined);
}

/** What `aria-describedby` on `element` reads out. */
function description(element: Element | undefined): string {
  return (element?.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? `(nothing has the id ${id})`)
    .join(' ');
}

const rideButton = (root: ParentNode): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>(root, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );

function expectClean(): void {
  const violations = auditAccessibility(document);
  expect(violations, formatViolations(violations)).toEqual([]);
}

describe('the group ride on the picker — #3303', () => {
  it('is a named switch, off, described by what a group ride is, and audits clean', async () => {
    mounted = await picker();
    const control = groupSwitch(mounted.container);
    expect(control).toBeDefined();
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(description(control)).toContain('Nobody is left behind');
    expect(keyboardReachableElements(document)).toContain(control);
    expect(labelled(mounted.container, 'Group average speed, km/h')).toBeUndefined();
    expectClean();
  });

  it('switched on by keyboard, offers a labelled speed and a labelled size, both reachable, and audits clean', async () => {
    mounted = await picker();
    await activateWithKeyboard(groupSwitch(mounted.container));
    await settle();
    expect(groupSwitch(mounted.container).checked).toBe(true);
    const speed = labelled<HTMLInputElement>(mounted.container, 'Group average speed, km/h');
    const size = labelled<HTMLSelectElement>(mounted.container, 'Riders in the group, besides you');
    expect(speed?.value).toBe('30');
    expect(size?.value).toBe('5');
    expect([...(size?.options ?? [])].map((option) => option.value)).toStrictEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    const reachable = keyboardReachableElements(document);
    expect(reachable).toContain(speed);
    expect(reachable).toContain(size);
    expect(speed?.getAttribute('aria-invalid')).toBeNull();
    expectClean();
  });

  it('refused, says why in an alert that travels with the speed box and with Ride, and audits clean', async () => {
    mounted = await picker();
    await activateWithKeyboard(groupSwitch(mounted.container));
    await settle();
    const speed = labelled<HTMLInputElement>(mounted.container, 'Group average speed, km/h');
    await typeInto(speed as HTMLInputElement, '90');
    await settle();
    const alert = queryAll(mounted.container, '[role="alert"]').find((each) =>
      (each.textContent ?? '').startsWith('The group cannot average 90 km/h on this route.'),
    );
    expect(alert).toBeDefined();
    expect(speed?.getAttribute('aria-invalid')).toBe('true');
    expect(description(speed)).toBe(alert?.textContent);
    expect(description(rideButton(mounted.container))).toContain(alert?.textContent ?? '(none)');
    expectClean();
  });

  it('with a workout holding the trainer, is unavailable and described by the reason, and audits clean', async () => {
    // Remembered on, from a ride before the workout began: still shown off.
    localStorage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 }),
    );
    mounted = await picker(true);
    const control = groupSwitch(mounted.container);
    expect(control.disabled).toBe(true);
    expect(control.checked).toBe(false);
    expect(description(control)).toBe(GROUP_RIDE_UNAVAILABLE_TEXT.workout);
    expect(labelled(mounted.container, 'Group average speed, km/h')).toBeUndefined();
    // Not offered is not a refusal: *Ride* is not described by it and rides.
    expect(description(rideButton(mounted.container))).not.toContain('group');
    expectClean();
  });

  it('with the draft switched off, is unavailable and described by that reason, and audits clean', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    mounted = await picker();
    const control = groupSwitch(mounted.container);
    expect(control.disabled).toBe(true);
    expect(description(control)).toBe(GROUP_RIDE_UNAVAILABLE_TEXT['draft-off']);
    expectClean();
  });

  it('on a loop, is unavailable and described by that reason, and audits clean', async () => {
    localStorage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 }),
    );
    mounted = await picker(false, LOOP);
    const control = groupSwitch(mounted.container);
    expect(control.disabled).toBe(true);
    expect(control.checked).toBe(false);
    expect(description(control)).toBe(GROUP_RIDE_UNAVAILABLE_TEXT.loop);
    expect(labelled(mounted.container, 'Group average speed, km/h')).toBeUndefined();
    expect(description(rideButton(mounted.container))).not.toContain('group');
    expectClean();
  });
});
