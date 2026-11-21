// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A new view's drawn path eased in from the one drawn before it — #2989
 * (`line-ease.ts`), on a street ridden north-east into a junction, so that a
 * choice's trim moves the view's local frame north and east at once: its
 * shift, and the scale a degree of longitude changes by with latitude.
 * `rolling-camera.test.ts` rides it through the camera; this reads the path
 * itself, sample by sample, back in one frame.
 */

import { describe, expect, it } from 'vitest';

import {
  RollingRoute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type RollingEdge,
  type RouteProfile,
} from '@onyourleft/domain';
import { graphOf, streetThrough } from '@onyourleft/domain/rolling-testing';

import { drawnLine, type DrawnLine } from '../drawn-line';
import { corridorOrigin, localGroundPosition, type CorridorOrigin } from '../terrain';
import { LINE_EASE_METRES, easeWeight, easedLine, heldLine } from './line-ease';

/** `terrain.ts` §`localGroundPosition`'s metres per degree of latitude. */
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Where the street in meets the junction: 2 km east and 2 km north of the start. */
const JUNCTION = 2_000;

/** A street ridden north-east into a junction that goes on, or turns left or right. */
function junctionRoute(): RollingRoute {
  const flat = () => 0;
  const street = (
    id: string,
    from: string,
    to: string,
    stops: [number, number][],
  ): RollingEdge => ({
    id,
    from,
    to,
    points: streetThrough(stops, flat),
    roadClass: 1,
  });
  const into = street('in', 'w', 'j', [
    [0, 0],
    [JUNCTION, JUNCTION],
  ]);
  return new RollingRoute(
    graphOf([
      into,
      street('on', 'j', 'a', [
        [JUNCTION, JUNCTION],
        [JUNCTION + 2_000, JUNCTION + 2_000],
      ]),
      street('left', 'j', 'b', [
        [JUNCTION, JUNCTION],
        [JUNCTION - 2_000, JUNCTION + 2_000],
      ]),
      street('right', 'j', 'c', [
        [JUNCTION, JUNCTION],
        [JUNCTION + 2_000, JUNCTION - 2_000],
      ]),
    ]),
    into,
  );
}

/** A sample's place in the local metres of `to`, from the local metres of `from`. */
function reframed(from: CorridorOrigin, to: CorridorOrigin, x: number, z: number) {
  const perDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  return localGroundPosition(
    to,
    geographicPosition(
      degreesLatitude(from.latitude + z / METRES_PER_DEGREE_LATITUDE),
      degreesLongitude(from.longitude - x / perDegreeLongitude),
    ),
  );
}

/** A view, its origin, and its line. */
interface Drawn {
  readonly profile: RouteProfile;
  readonly origin: number;
  readonly line: DrawnLine;
}

function drawnOf(route: RollingRoute): Drawn {
  const profile = route.view();
  return { profile, origin: route.origin, line: drawnLine(profile) };
}

/** The view drawn before a choice, and the one after it, with the frame moved between them. */
function aChoice(): { readonly before: Drawn; readonly after: Drawn; readonly junction: number } {
  const route = junctionRoute();
  route.advance(1_200);
  const before = drawnOf(route);
  const junction = route.junctionsAfter(1_200)[0];
  if (junction === undefined) throw new Error('no junction ahead');
  const way = junction.ways.find((each) => each.edge.id !== junction.taken)?.edge.id as string;
  // Far enough on that the choice trims the road behind, which moves the frame.
  expect(route.choose(junction.distance, way, 1_900)).toBe('swapped');
  return { before, after: drawnOf(route), junction: junction.distance };
}

describe('a new view’s drawn path eased in from the one drawn before — #2989', () => {
  const { before, after, junction } = aChoice();
  const resolution = after.profile.resolution as number;
  const from = corridorOrigin(before.profile);
  const to = corridorOrigin(after.profile);
  /** The after view's last sample at or before ride distance `ride`. */
  const indexOf = (ride: number) => Math.floor((ride - after.origin) / resolution);
  /** The before view's index of the after view's `index`. */
  const beforeIndex = (index: number) =>
    index + Math.round((after.origin - before.origin) / resolution);
  /** The before view's sample at the after view's `index`, in the after view's frame. */
  const was = (index: number) => {
    const at = beforeIndex(index);
    return reframed(from, to, before.line.xs[at] as number, before.line.zs[at] as number);
  };
  /**
   * The channels that are not a place, so no frame moves them: `shifts` sets
   * the drawn rider's height on a climb (`drawnPlaceOf`), `curvatures` their
   * lag (`bend-easing.ts` `easedPlace`), and `offsets` the path's distance
   * from the centreline. Each is blended at the same weight as the place.
   */
  const scalars = ['shifts', 'offsets', 'curvatures'] as const;

  it('moves the frame north and east between the two views', () => {
    expect(to.latitude).toBeGreaterThan(from.latitude);
    expect(to.longitude).not.toBe(from.longitude);
  });

  it('draws the path drawn before, in the new frame, on the frame of the change', () => {
    const eased = easedLine(heldLine(before.line, before.origin), after.line, after.origin, 0);
    expect(eased.profile).toBe(after.profile);
    // Every sample both views hold on the road before the junction.
    for (let index = indexOf(after.origin); index <= indexOf(junction); index += 1) {
      const there = was(index);
      const off = Math.hypot(
        (eased.xs[index] as number) - there.x,
        (eased.zs[index] as number) - there.z,
      );
      expect(off, `sample ${index}`).toBeLessThan(1e-6);
      for (const channel of scalars) {
        expect(eased[channel][index], `${channel} at sample ${index}`).toBeCloseTo(
          before.line[channel][beforeIndex(index)] as number,
          9,
        );
      }
    }
    // The two views' values differ on that road, or the hold would not be seen.
    for (const channel of scalars) {
      let apart = 0;
      for (let index = indexOf(after.origin); index <= indexOf(junction); index += 1) {
        apart = Math.max(
          apart,
          Math.abs(
            (before.line[channel][beforeIndex(index)] as number) -
              (after.line[channel][index] as number),
          ),
        );
      }
      expect(apart, channel).toBeGreaterThan(1e-3);
    }
  });

  it('draws the new line where the new view is another road: past the junction a choice swapped', () => {
    const eased = easedLine(heldLine(before.line, before.origin), after.line, after.origin, 0);
    const past = indexOf(junction) + 1;
    expect(past).toBeLessThan(after.line.xs.length);
    for (let index = past; index < after.line.xs.length; index += 1) {
      expect(eased.xs[index], `sample ${index}`).toBe(after.line.xs[index]);
      expect(eased.zs[index], `sample ${index}`).toBe(after.line.zs[index]);
    }
  });

  it('is part of the way between the two, by the weight, and the new line itself at the end', () => {
    const held = heldLine(before.line, before.origin);
    const half = easedLine(held, after.line, after.origin, 0.5);
    const index = indexOf(junction - 110);
    const there = was(index);
    expect(half.xs[index]).toBeCloseTo(0.5 * there.x + 0.5 * (after.line.xs[index] as number), 9);
    expect(half.zs[index]).toBeCloseTo(0.5 * there.z + 0.5 * (after.line.zs[index] as number), 9);
    // The two are apart there, or the weight would not be seen.
    expect(
      Math.hypot(
        there.x - (after.line.xs[index] as number),
        there.z - (after.line.zs[index] as number),
      ),
    ).toBeGreaterThan(1e-3);
    // Each scalar channel, at the shared sample where the two views differ most in it.
    for (const channel of scalars) {
      let widest = indexOf(after.origin);
      let apart = 0;
      for (let at = indexOf(after.origin); at <= indexOf(junction); at += 1) {
        const gap = Math.abs(
          (before.line[channel][beforeIndex(at)] as number) - (after.line[channel][at] as number),
        );
        if (gap > apart) [widest, apart] = [at, gap];
      }
      expect(apart, channel).toBeGreaterThan(1e-3);
      expect(half[channel][widest], channel).toBeCloseTo(
        0.5 * (before.line[channel][beforeIndex(widest)] as number) +
          0.5 * (after.line[channel][widest] as number),
        9,
      );
    }
    expect(easedLine(held, after.line, after.origin, 1)).toBe(after.line);
  });

  it('eases by a smoothstep of the distance ridden, from nought to one over the ease', () => {
    expect(easeWeight(-1)).toBe(0);
    expect(easeWeight(0)).toBe(0);
    expect(easeWeight(LINE_EASE_METRES / 2)).toBeCloseTo(0.5, 12);
    expect(easeWeight(LINE_EASE_METRES)).toBe(1);
    expect(easeWeight(LINE_EASE_METRES * 2)).toBe(1);
    // Flat at both ends: the drawn rider starts and stops drifting gently.
    expect(easeWeight(1)).toBeLessThan(0.01);
    expect(1 - easeWeight(LINE_EASE_METRES - 1)).toBeLessThan(0.01);
  });
});
