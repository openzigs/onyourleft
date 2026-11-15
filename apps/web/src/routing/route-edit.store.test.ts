// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * An edited route, read back through the **real** local store — #2007.
 *
 * `route-edit.test.ts` holds the arithmetic. This file holds the claim a rider
 * relies on: after *Save over*, the route that comes back from the store, on a
 * connection that never saw it written, is the edited line, and every sample
 * outside the redrawn stretch is the one that was saved before, number for
 * number. A test against the object handed to `putRoute` would pass whatever
 * the store did with it (docs/agents/quality-gate.md §5, the wrong harness).
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  unixSeconds,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';
import { routeId, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  heightAt,
  lastSample,
  lineOf,
  replaceRouteLine,
  replaceStretch,
  routeFromEdit,
  straightStretch,
} from './route-edit';

const SAVED_AT = unixSeconds(1_790_000_000);
const NOW = unixSeconds(1_800_000_000);
const ID = routeId('route-to-edit');

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

function at(north: number, east: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(0.5 + north / 111_195),
    degreesLongitude(0.5 + east / 111_178),
  );
}

function saved(): RouteRecord {
  return {
    id: ID,
    createdBy: ATHLETE_A,
    name: 'Saturday',
    profile: routeProfile([
      { position: at(0, 0), elevation: altitudeMetres(100) },
      { position: at(900, 100), elevation: altitudeMetres(150) },
      { position: at(1_800, 0), elevation: altitudeMetres(110) },
    ]),
    visibility: 'private',
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
  };
}

/** Every number of a sample, for `Object.is`. */
function numbers(profile: RouteProfile, index: number): readonly number[] {
  const position = profile.positions[index]!;
  return [
    position.latitude,
    position.longitude,
    profile.elevations[index]!,
    profile.grades[index]!,
  ];
}

describe('a route edited and saved over itself', () => {
  it('reads back with every sample outside the redrawn stretch byte-identical', async () => {
    const open = createStoreHarness();
    await seedAthletes(open);
    harness = open;
    await open.read(async (store) => store.putRoute(saved()));
    // The editor opens the route as the store hands it back, not as it was built.
    const opened = await open.read(async (store) => store.getRoute(ATHLETE_A, ID));
    if (opened === undefined) throw new Error('the seeded route did not read back');

    const line = lineOf(opened);
    const edited = replaceStretch(
      line,
      40,
      110,
      straightStretch(line.profile.positions[40]!, line.profile.positions[110]!, {
        from: heightAt(line, 40),
        to: heightAt(line, 110),
      }),
    );
    const fresh = await open.read(async (store) => store.getRoute(ATHLETE_A, ID));
    const outcome = replaceRouteLine(fresh!, edited, opened.updatedAt, NOW);
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);

    const read = await open.roundTrip(
      async (store) => store.putRoute(outcome.record),
      async (store) => store.getRoute(ATHLETE_A, ID),
    );
    if (read === undefined) throw new Error('a fresh connection can see no route with that id');

    const before = opened.profile;
    const after = read.profile;
    const last = lastSample(line);
    const tail = last - 110 + 1;
    const shift = after.positions.length - before.positions.length;
    for (let index = 0; index <= last; index += 1) {
      if (index > 40 && index < 110) continue;
      const moved = index <= 40 ? index : index + shift;
      const was = numbers(before, index);
      const now = numbers(after, moved);
      for (const [field, value] of was.entries()) {
        expect(
          Object.is(now[field], value),
          `sample ${String(index)}, field ${String(field)}`,
        ).toBe(true);
      }
    }
    // Not vacuous: the stretch between is the new one, and was written.
    expect(tail).toBeGreaterThan(10);
    expect(after.positions.length).toBe(edited.profile.positions.length);
    expect(after.totalDistance).toBe(edited.profile.totalDistance);
    expect(after.totalDistance).toBeLessThan(before.totalDistance);
    expect(read.updatedAt).toBe(NOW);
  });

  it('saved as a new route instead, leaves the original as it was', async () => {
    const open = createStoreHarness();
    await seedAthletes(open);
    harness = open;
    await open.read(async (store) => store.putRoute(saved()));
    const opened = await open.read(async (store) => store.getRoute(ATHLETE_A, ID));
    if (opened === undefined) throw new Error('the seeded route did not read back');
    const line = lineOf(opened);
    const edited = replaceStretch(
      line,
      'new-start',
      60,
      straightStretch(at(-300, -300), line.profile.positions[60]!, { to: heightAt(line, 60) }),
    );
    const outcome = routeFromEdit(opened, edited, {
      id: routeId('route-edited-copy'),
      name: 'Saturday, from the other side',
      now: NOW,
    });
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);

    const [original, copy] = await open.roundTrip(
      async (store) => store.putRoute(outcome.record),
      async (store) =>
        Promise.all([
          store.getRoute(ATHLETE_A, ID),
          store.getRoute(ATHLETE_A, routeId('route-edited-copy')),
        ]),
    );
    expect(original).toEqual(opened);
    expect(copy?.profile.totalDistance).toBe(edited.profile.totalDistance);
    expect(copy?.visibility).toBe('private');
  });
});
