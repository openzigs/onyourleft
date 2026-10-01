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
  expandWorkout,
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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeStub, stubRouteId } from '../routes/testing';
import { mount, queryAll, settle, typeInto, type Mounted } from '../testing/mount';
import { POPULATED_WORKOUT_BLOCKS } from '../testing/populated-shell';
import { workoutRow } from '../workouts/library';
import { workoutStub } from '../workouts/testing';
import { RoutesView } from './RoutesView';
import { WorkoutsView } from './WorkoutsView';
import { WorkoutShape } from '../design/illustration/WorkoutShape';

/*
 * Counted, not replaced: the real expansion and the real drawing run, and each
 * call is written down, so "expanded once" and "not drawn again for a
 * keystroke" are read off the calls (#941's review).
 */
vi.mock('@onyourleft/domain', async (actual) => {
  const domain = await actual<typeof import('@onyourleft/domain')>();
  return { ...domain, expandWorkout: vi.fn(domain.expandWorkout) };
});
vi.mock('../workouts/library', async (actual) => {
  const library = await actual<typeof import('../workouts/library')>();
  return { ...library, workoutRow: vi.fn(library.workoutRow) };
});
vi.mock('../design/illustration/WorkoutShape', async (actual) => {
  const shape = await actual<typeof import('../design/illustration/WorkoutShape')>();
  return { ...shape, WorkoutShape: vi.fn(shape.WorkoutShape) };
});

const ATHLETE = toAthleteId('athlete-a');
const METRES_PER_DEGREE_LATITUDE = 111_195;

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.mocked(expandWorkout).mockClear();
  vi.mocked(WorkoutShape).mockClear();
  vi.mocked(workoutRow).mockClear();
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

/**
 * The populated fixture's workout, and two that draw every kind of block.
 *
 * ⚠️ The ids HOLD digits, on purpose (#980): a card carries its id in its
 * link's `href` and `data-oyl-select`, and a real id is a generated string
 * that may hold any. The no-number check strips the card's own id and nothing
 * else before it looks — so a number anywhere else is still found, and the
 * check does not depend on how ids happen to be spelt.
 */
const WORKOUTS: readonly WorkoutRecord[] = [
  workout(
    'workout-sweet-1700',
    'Sweet spot over-unders with a very long name for a small screen',
    POPULATED_WORKOUT_BLOCKS,
  ),
  workout('workout-ramp-25', 'Ramp and intervals', [
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
  workout('workout-free-900', 'Free ride', [{ kind: 'free-ride', seconds: seconds(900) }]),
];

/** The cards on the page: every item of the list pane's list. */
function cards(root: HTMLElement): HTMLElement[] {
  return queryAll(root, '.oyl-pane-list__item');
}

/**
 * Every attribute on a card — the `<li>` itself and every element inside it,
 * the drawing's wrapper included — less the drawing's geometry: an SVG
 * element's `d` and `viewBox` and nothing else.
 *
 * Until #941's review this read the `<svg>` alone, and a `title="250 W"` on the
 * wrapper `div` passed every test here: a `title` is a tooltip and an
 * accessible description, which is text a rider reads.
 */
function nonGeometryAttributes(card: HTMLElement): string[] {
  return [card, ...card.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter(
        (attribute) =>
          !(
            element.closest('svg') !== null &&
            (attribute.name === 'd' || attribute.name === 'viewBox')
          ),
      )
      .map((attribute) => `${element.tagName}[${attribute.name}=${attribute.value}]`),
  );
}

/**
 * The card's own layout utilities (ADR 0042) whose names hold a digit — #982.
 * Taken out of a `class` attribute by exact name before the no-number check,
 * and nothing else is: a class that is not on this list and holds a digit
 * still fails, so no number can hide behind the exemption.
 */
const LAYOUT_CLASSES_WITH_DIGITS: readonly string[] = ['tw:grid-cols-1', 'tw:mb-0'];

function withoutLayoutClasses(value: string): string {
  const match = /^([A-Za-z]+)\[class=(.*)\]$/.exec(value);
  if (match === null) return value;
  const kept = (match[2] ?? '')
    .split(/\s+/)
    .filter((name) => !LAYOUT_CLASSES_WITH_DIGITS.includes(name));
  return `${match[1] ?? ''}[class=${kept.join(' ')}]`;
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
      // Outside the drawing's path data and coordinate system, and once the
      // card's own id (#980) and its named layout utilities (#982) are taken
      // out, no attribute on the card holds a
      // digit: no watt, percentage or score in a class, a label, a title, a
      // `data-*` or an `aria-*`.
      expect(
        nonGeometryAttributes(card)
          .map((value) => withoutLayoutClasses(value).replaceAll(record.id, ''))
          .filter((value) => /\d/.test(value)),
      ).toEqual([]);
    }
  });

  it('hands each row the expansion of its OWN record (#980)', async () => {
    mounted = await mount(<WorkoutsView port={workoutStub(ATHLETE, WORKOUTS)} />);
    await settle();
    expect(cards(mounted.container)).toHaveLength(WORKOUTS.length);
    const expansions = vi.mocked(expandWorkout).mock;
    const rows = vi.mocked(workoutRow).mock.calls;
    expect(rows).toHaveLength(WORKOUTS.length);
    for (const [record, timeline] of rows) {
      // Handed a timeline, not left to expand its own — and that timeline is
      // the very object `expandWorkout` returned for this record's workout.
      expect(timeline, `${record.id}: no timeline handed`).toBeDefined();
      const index = expansions.results.findIndex(
        (result) => result.type === 'return' && result.value === timeline,
      );
      expect(index, `${record.id}: the timeline is no expansion the view made`).toBeGreaterThan(-1);
      expect(expansions.calls[index]?.[0], `${record.id}: another workout's timeline`).toBe(
        record.workout,
      );
    }
  });

  it('expands each workout once per load, and draws no card again for a keystroke', async () => {
    mounted = await mount(<WorkoutsView port={workoutStub(ATHLETE, WORKOUTS)} />);
    await settle();
    expect(cards(mounted.container)).toHaveLength(WORKOUTS.length);
    // One expansion a workout: the card's drawing and its row share it.
    expect(vi.mocked(expandWorkout)).toHaveBeenCalledTimes(WORKOUTS.length);
    const drawn = vi.mocked(WorkoutShape).mock.calls.length;
    expect(drawn).toBeGreaterThanOrEqual(WORKOUTS.length);

    const name = mounted.container.querySelector<HTMLInputElement>('#workout-name');
    if (name === null) throw new Error('no name box');
    await typeInto(name, 'S');
    await typeInto(name, 'Su');
    await typeInto(name, 'Sun');
    expect(name.value).toBe('Sun');
    // The builder re-rendered the view three times; no card was drawn again
    // and no workout expanded again.
    expect(vi.mocked(WorkoutShape).mock.calls.length).toBe(drawn);
    expect(vi.mocked(expandWorkout)).toHaveBeenCalledTimes(WORKOUTS.length);
  });
});
