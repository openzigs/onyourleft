// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The built-in workouts on the Workouts screen — #2304.
 *
 * Driven through the real router: the screen is rendered by a component that
 * reads `useRoute()`, as `AppShell` does, so a filter chosen here is a change
 * of `location.hash` that comes back through `matchHash` as the query the
 * screen draws from. What is asserted is the cards a rider SEES — their names
 * in the DOM — never the filter's state.
 */

import { BUILT_IN_WORKOUTS, seconds, thresholdShare, unixSeconds } from '@onyourleft/domain';
import { athleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useRoute } from '../shell/useRoute';
import { chooseOption, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { hrefForWorkouts } from '../workouts/built-in';
import type { WorkoutStore } from '../workouts/store-port';
import { workoutStub, type WorkoutStub } from '../workouts/testing';
import { WorkoutsView } from './WorkoutsView';

const OWNER = athleteId('athlete-a');

const SAVED: WorkoutRecord = {
  id: workoutId('workout-own'),
  createdBy: OWNER,
  name: 'My own hour',
  workout: {
    name: 'My own hour',
    blocks: [{ kind: 'steady', seconds: seconds(3600), target: thresholdShare(0.65) }],
  },
  createdAt: unixSeconds(1_700_000_000),
  updatedAt: unixSeconds(1_700_000_000),
};

let mounted: Mounted | undefined;

beforeEach(() => {
  globalThis.location.hash = '#/workouts?list=built-in';
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/** The Workouts screen as the shell renders it: from the address. */
function Routed({ port }: { readonly port: WorkoutStub }): JSX.Element {
  const match = useRoute();
  return <WorkoutsView port={port} selected={match.parameter} query={match.query} />;
}

/** Every call the screen makes on the store, by name. */
function counted(store: WorkoutStore, calls: string[]): WorkoutStore {
  return {
    listWorkouts: (...args) => {
      calls.push('listWorkouts');
      return store.listWorkouts(...args);
    },
    getWorkout: (...args) => {
      calls.push('getWorkout');
      return store.getWorkout(...args);
    },
    putWorkout: (...args) => {
      calls.push('putWorkout');
      return store.putWorkout(...args);
    },
    deleteWorkout: (...args) => {
      calls.push('deleteWorkout');
      return store.deleteWorkout(...args);
    },
  };
}

async function open(stub: WorkoutStub = workoutStub(OWNER)): Promise<Mounted> {
  mounted = await mount(<Routed port={stub} />);
  await settle();
  return mounted;
}

function builtIns(): HTMLElement {
  const section = document.querySelector<HTMLElement>('[data-oyl-built-ins]');
  if (section === null) throw new Error('no built-in workouts on this screen');
  return section;
}

/** The names on the built-in cards, as drawn. */
function cardNames(): string[] {
  return queryAll(builtIns(), '[data-oyl-built-in] a').map((link) => link.textContent ?? '');
}

function select(label: string): HTMLSelectElement {
  const found = queryAll<HTMLLabelElement>(builtIns(), 'label').find(
    (each) => each.textContent === label,
  );
  const control = found?.htmlFor === undefined ? null : document.getElementById(found.htmlFor);
  if (!(control instanceof HTMLSelectElement)) throw new Error(`no ${label} filter`);
  return control;
}

async function follow(link: HTMLAnchorElement): Promise<void> {
  link.click();
  await settle();
}

function linkSaying(root: ParentNode, text: string): HTMLAnchorElement {
  const link = queryAll<HTMLAnchorElement>(root, 'a').find((each) => each.textContent === text);
  if (link === undefined) throw new Error(`no link “${text}”`);
  return link;
}

/** The list pane's heading: the list it shows. */
function paneHeading(): string {
  return document.querySelector('[data-oyl-pane="list"] h2')?.textContent ?? '';
}

describe('the built-ins are listed with nothing saved and no instance — #2304', () => {
  it('opens on the rider’s own, and the switch shows every built-in the app ships apart from them', async () => {
    globalThis.location.hash = '#/workouts';
    await open(workoutStub(OWNER, [SAVED]));
    expect(paneHeading()).toBe('Saved workouts');
    expect(document.querySelector('[data-oyl-list="saved"]')?.textContent).toContain('My own hour');
    expect(document.querySelector('[data-oyl-built-ins]')).toBeNull();

    await follow(linkSaying(document, 'Built-in workouts'));
    expect(globalThis.location.hash).toBe('#/workouts?list=built-in');
    expect(paneHeading()).toBe('Built-in workouts');
    expect(cardNames()).toEqual(BUILT_IN_WORKOUTS.map((template) => template.name));
    // The rider's own workout is in their list and not among the built-ins.
    expect(document.querySelector('[data-oyl-list="saved"]')).toBeNull();
    expect(builtIns().textContent).not.toContain('My own hour');

    await follow(linkSaying(document, 'Your workouts'));
    expect(document.querySelector('[data-oyl-list="saved"]')?.textContent).toContain('My own hour');
  });

  it('lists them for a rider with no saved workout at all', async () => {
    await open();
    expect(cardNames()).toHaveLength(BUILT_IN_WORKOUTS.length);
  });

  it('says which list is shown by more than its colour', async () => {
    await open();
    const current = queryAll(document, 'nav[aria-label="Which workouts"] a[aria-current]');
    expect(current.map((link) => [link.textContent, link.getAttribute('aria-current')])).toEqual([
      ['Built-in workouts', 'true'],
    ]);
  });

  it('says on each card the length, the category, the hardest share and the shape', async () => {
    await open();
    const card = builtIns().querySelector('[data-oyl-built-in="sweet-spot-2x20"]');
    expect(card?.textContent).toBe(
      'Sweet spot, two by twenty' +
        '1 h 5 min · Sweet spot · hardest: 89% of threshold' +
        '10 min ramping 45% to 70%, 2 × 20 min at 89%, 5 min at 55%, 5 min ramping 60% to 45%',
    );
    expect(builtIns().textContent).not.toMatch(/\d\s?W\b/);
  });
});

describe('filtering changes which cards render — #2304', () => {
  it('leaves the sweet-spot sessions of about 45 minutes, and clearing brings back every one', async () => {
    await open();
    await chooseOption(select('Category'), 'sweet-spot');
    await settle();
    expect(cardNames()).toEqual([
      'Sweet spot, three by twelve',
      'Sweet spot, two by twenty',
      'Sweet spot, four by ten',
      'Sweet spot, three by fifteen',
      'Sweet spot, rising block',
      'Sweet spot, one long block',
    ]);
    await chooseOption(select('Length'), '45');
    await settle();
    expect(cardNames()).toEqual(['Sweet spot, rising block', 'Sweet spot, one long block']);
    expect(globalThis.location.hash).toBe('#/workouts?list=built-in&category=sweet-spot&length=45');

    await follow(linkSaying(builtIns(), 'Clear filters'));
    expect(cardNames()).toHaveLength(BUILT_IN_WORKOUTS.length);
    expect(globalThis.location.hash).toBe('#/workouts?list=built-in');
  });

  it('leaves only the workouts with a heart-rate target', async () => {
    await open();
    const box = builtIns().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box === null) throw new Error('no heart-rate filter');
    box.click();
    await settle();
    expect(cardNames()).toEqual(['Endurance by heart rate', 'Low endurance by heart rate']);
    expect(box.checked).toBe(true);
  });

  it('says when nothing matches, and offers to clear', async () => {
    globalThis.location.hash = '#/workouts?list=built-in&category=recovery&length=90';
    await open();
    expect(cardNames()).toEqual([]);
    expect(builtIns().textContent).toContain('No built-in workout matches these filters.');
    expect(linkSaying(builtIns(), 'Clear filters').getAttribute('href')).toBe(
      '#/workouts?list=built-in',
    );
  });

  it('renders the filtered list on a fresh load of an address with a filter in it', async () => {
    globalThis.location.hash = '#/workouts?list=built-in&category=sweet-spot&length=45';
    await open();
    expect(cardNames()).toEqual(['Sweet spot, rising block', 'Sweet spot, one long block']);
    expect(select('Category').value).toBe('sweet-spot');
    expect(select('Length').value).toBe('45');
    expect(builtIns().textContent).toContain('2 of 32 built-in workouts.');
  });
});

describe('choosing a built-in — #2304', () => {
  it('opens it in the detail pane and keeps the list filtered beside it', async () => {
    globalThis.location.hash = '#/workouts?list=built-in&category=tempo';
    await open();
    await follow(linkSaying(builtIns(), 'Tempo, two by twenty'));
    expect(globalThis.location.hash).toBe(
      '#/workouts/selected/built-in%3Atempo-2x20?list=built-in&category=tempo',
    );
    const detail = document.querySelector('[data-oyl-built-in-detail="tempo-2x20"]');
    expect(detail?.querySelector('h2')?.textContent).toBe('Tempo, two by twenty');
    expect(detail?.textContent).toContain('2 × 20 min at 83%');
    expect(cardNames()).toHaveLength(5);
    // At one pane the way back is to the list as it was filtered.
    expect(linkSaying(document, 'All workouts').getAttribute('href')).toBe(
      '#/workouts?list=built-in&category=tempo',
    );
  });

  it('keeps the chosen built-in when the filter changes', async () => {
    globalThis.location.hash = hrefForWorkouts({}, 'built-in:tempo-2x20');
    await open();
    await chooseOption(select('Length'), '75');
    await settle();
    expect(globalThis.location.hash).toBe(
      '#/workouts/selected/built-in%3Atempo-2x20?list=built-in&length=75',
    );
    expect(document.querySelector('[data-oyl-built-in-detail="tempo-2x20"]')).not.toBeNull();
  });

  it('shows the built-in list beside a built-in opened by its address alone', async () => {
    globalThis.location.hash = '#/workouts/selected/built-in%3Atempo-2x20';
    await open();
    expect(paneHeading()).toBe('Built-in workouts');
    expect(cardNames()).toHaveLength(BUILT_IN_WORKOUTS.length);
  });

  it('says a built-in that does not exist is not found, without asking the store', async () => {
    globalThis.location.hash = '#/workouts/selected/built-in%3Ano-such-workout';
    const stub = workoutStub(OWNER);
    const calls: string[] = [];
    await open({ ...stub, store: counted(stub.store, calls) });
    expect(document.querySelector('#oyl-selected-heading')?.textContent).toBe('Workout not found');
    expect(calls).toEqual(['listWorkouts']);
  });
});

describe('browsing writes nothing — #2304', () => {
  it('leaves the rider’s saved workouts exactly as they were', async () => {
    const stub = workoutStub(OWNER, [SAVED]);
    const before = await stub.store.listWorkouts(OWNER);
    const calls: string[] = [];
    await open({ ...stub, store: counted(stub.store, calls) });

    await chooseOption(select('Category'), 'threshold');
    await settle();
    await follow(linkSaying(builtIns(), 'Threshold, two by twenty'));
    await chooseOption(select('Length'), '60');
    await settle();
    await follow(linkSaying(builtIns(), 'Clear filters'));
    await follow(linkSaying(builtIns(), 'Ramp test'));
    expect(document.querySelector('[data-oyl-built-in-detail="ramp-test"]')).not.toBeNull();

    // Read back through the path the Workouts list uses.
    expect(await stub.store.listWorkouts(OWNER)).toEqual(before);
    // And the screen only ever read: one list per mount, no lookup of a built-in.
    expect(calls.filter((call) => call !== 'listWorkouts')).toEqual([]);
  });
});
