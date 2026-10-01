// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Route and workout cards with their shape drawn on them — #941.
 *
 * Three things the drawing must not cost, each against the real view:
 *
 * - **No new read.** Each list reads the store exactly as it did before the
 *   shapes: one `listRoutes`, one `listWorkouts`, and nothing per card. A
 *   route's climb comes from the profile the list read already carries; a
 *   workout's blocks from the record already in hand.
 * - **No watts.** Over the populated fixture's workout (and two more with a
 *   ramp, intervals and a free ride), a card's words are exactly the words it
 *   had before #941, and the drawing adds no text and no digit outside its
 *   geometry — no title, no label, no number a rider could read as a target.
 * - **Decoration.** Every card carries one `aria-hidden` `<svg>` with a shape
 *   in it, and the card's single link is the only control.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  thresholdShare,
  unixSeconds,
  type RoutePoint,
  type WorkoutBlock,
} from '@onyourleft/domain';
import {
  athleteId as toAthleteId,
  workoutId,
  type RouteRecord,
  type WorkoutRecord,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { routeStub, stubRouteId } from '../routes/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { POPULATED_WORKOUT_BLOCKS } from '../testing/populated-shell';
import { workoutRow } from '../workouts/library';
import { workoutStub } from '../workouts/testing';
import { RoutesView } from './RoutesView';
import { WorkoutsView } from './WorkoutsView';

const ATHLETE = toAthleteId('athlete-a');
const METRES_PER_DEGREE_LATITUDE = 111_195;

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * The store, with every method call written down by name.
 *
 * A `Proxy` rather than a hand-written wrapper, so a method added to a port
 * later is counted with no edit here.
 */
function counted<T extends object>(store: T, calls: string[]): T {
  return new Proxy(store, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        calls.push(String(key));
        return (value as (...given: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** A route north from London over a hill, so its shape has something to draw. */
function route(index: number): RouteRecord {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= 4000; along += 25) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10_000 + along) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(30 + 80 * Math.sin((Math.PI * along) / 4000)),
    });
  }
  return {
    id: stubRouteId(`route-${String(index)}`),
    createdBy: ATHLETE,
    name: `Hill ${String(index)}`,
    profile: routeProfile(points),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000 + index),
    updatedAt: unixSeconds(1_700_000_000 + index),
  };
}

function workout(id: string, name: string, blocks: readonly WorkoutBlock[]): WorkoutRecord {
  return {
    id: workoutId(id),
    createdBy: ATHLETE,
    name,
    workout: { name, blocks },
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
}

/** The populated fixture's workout, and two that draw every kind of block. */
const WORKOUTS: readonly WorkoutRecord[] = [
  workout(
    'workout-1',
    'Sweet spot over-unders with a very long name for a small screen',
    POPULATED_WORKOUT_BLOCKS,
  ),
  workout('workout-2', 'Ramp and intervals', [
    {
      kind: 'ramp',
      seconds: seconds(300),
      from: thresholdShare(0.5),
      to: thresholdShare(0.75),
    },
    {
      kind: 'intervals',
      repeats: 6,
      hardSeconds: seconds(40),
      hardTarget: thresholdShare(1.3),
      easySeconds: seconds(20),
      easyTarget: thresholdShare(0.5),
    },
  ]),
  workout('workout-3', 'Free ride', [{ kind: 'free-ride', seconds: seconds(900) }]),
];

/** The cards on the page: every item of the list pane's list. */
function cards(root: HTMLElement): HTMLElement[] {
  return queryAll(root, '.oyl-pane-list__item');
}

/** Every attribute value in a drawing, less the geometry. */
function nonGeometryAttributes(svg: SVGElement): string[] {
  return [svg, ...svg.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) => attribute.name !== 'd' && attribute.name !== 'viewBox')
      .map((attribute) => `${element.tagName}[${attribute.name}=${attribute.value}]`),
  );
}

function expectDecoration(card: HTMLElement): void {
  const svgs = queryAll<SVGElement>(card, 'svg');
  expect(svgs).toHaveLength(1);
  const [svg] = svgs;
  if (svg === undefined) throw new Error('no drawing');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(svg.querySelectorAll('text, title, desc').length).toBe(0);
  expect(svg.textContent).toBe('');
  // One control on the card: its link.
  expect(queryAll(card, 'a, button, input, select, textarea, [tabindex]')).toHaveLength(1);
}

describe('#941 — the Routes list', () => {
  it('reads the store once, whatever the number of cards', async () => {
    const stub = routeStub(ATHLETE, [route(1), route(2), route(3)]);
    const calls: string[] = [];
    mounted = await mount(<RoutesView port={{ ...stub, store: counted(stub.store, calls) }} />);
    await settle();
    expect(cards(mounted.container)).toHaveLength(3);
    // The read before #941, and no other: no route read per card for its shape.
    expect(calls).toEqual(['listRoutes']);
  });

  it('draws each route’s climb as decoration, and keeps the card’s words', async () => {
    const routes = [route(1), route(2)];
    mounted = await mount(<RoutesView port={routeStub(ATHLETE, routes)} />);
    await settle();
    for (const card of cards(mounted.container)) {
      expectDecoration(card);
      const drawing = card.querySelector('svg');
      const words = card.textContent ?? '';
      expect(drawing?.textContent).toBe('');
      expect(words).toMatch(/^Hill \d/);
      expect(words).toContain('climb');
    }
  });
});

describe('#941 — the Workouts list', () => {
  it('reads the store once, whatever the number of cards', async () => {
    const stub = workoutStub(ATHLETE, WORKOUTS);
    const calls: string[] = [];
    mounted = await mount(<WorkoutsView port={{ ...stub, store: counted(stub.store, calls) }} />);
    await settle();
    expect(cards(mounted.container)).toHaveLength(WORKOUTS.length);
    expect(calls).toEqual(['listWorkouts']);
  });

  it('adds no number to a card: its words are what they were, and its drawing has none', async () => {
    mounted = await mount(<WorkoutsView port={workoutStub(ATHLETE, WORKOUTS)} />);
    await settle();
    const shown = cards(mounted.container);
    expect(shown).toHaveLength(WORKOUTS.length);
    for (const card of shown) {
      expectDecoration(card);
      const id = card.querySelector('a')?.getAttribute('data-oyl-select');
      const record = WORKOUTS.find((candidate) => candidate.id === id);
      if (record === undefined) throw new Error(`no fixture for the card ${String(id)}`);
      const row = workoutRow(record);
      // The card's text before #941, word for word: the name, the duration and
      // the hardest target as a share. Nothing the drawing could add.
      const before =
        `${row.name}${row.duration} · hardest: ` +
        (row.hardestPercent === undefined
          ? 'No target'
          : `${String(row.hardestPercent)}% of threshold`);
      expect(card.textContent).toBe(before);
      const svg = card.querySelector('svg');
      if (svg === null) throw new Error('no drawing');
      // Outside its path data and its coordinate system, the drawing holds no
      // digit at all: no watt, percentage or score in a class, a label or a
      // title.
      expect(nonGeometryAttributes(svg).filter((value) => /\d/.test(value))).toEqual([]);
    }
  });
});
