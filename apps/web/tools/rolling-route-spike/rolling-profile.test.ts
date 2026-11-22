// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882: the rolling profile's findings, held. Each case reads back through
 * {@link RollingProfile.view}, the `RouteProfile` the game would be handed.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  distanceBetween,
  geographicPosition,
  degreesLatitude,
  degreesLongitude,
  routeProfile,
  type GeographicPosition,
} from '@onyourleft/domain';

import { ROLLING_RESOLUTION_METRES, RollingProfile, type RollingPoint } from './rolling-profile';
import { moved } from './turning-ride';

const START = geographicPosition(degreesLatitude(41.9), degreesLongitude(-87.8));

/** Points every 50 m along `heading` for `metres`, from `from`, climbing at `grade` percent. */
function straight(
  from: GeographicPosition,
  heading: number,
  metres: number,
  grade = 0,
  fromHeight = 0,
): RollingPoint[] {
  const points: RollingPoint[] = [];
  for (let at = 50; at < metres + 50; at += 50) {
    const to = Math.min(at, metres);
    points.push({ position: moved(from, heading, to), elevation: fromHeight + (to * grade) / 100 });
  }
  return points;
}

describe('the rolling profile (#2882)', () => {
  it('spaces its samples exactly, where routeProfile stretches its grid to the end', () => {
    const rolling = new RollingProfile({ position: START });
    rolling.append(straight(START, 0, 1_005));
    const view = rolling.view();
    // The 5 m left over waits for the next extension instead of stretching the grid.
    // Whole steps only: the flat-earth points are a few decimetres short of 1,005 m.
    expect(view.totalDistance % ROLLING_RESOLUTION_METRES).toBe(0);
    expect(view.totalDistance).toBeGreaterThanOrEqual(990);
    expect(view.positions).toHaveLength(view.totalDistance / ROLLING_RESOLUTION_METRES + 1);
    expect(view.resolution).toBe(ROLLING_RESOLUTION_METRES);
    const fifty = distanceBetween(START, view.positions[50] as GeographicPosition);
    expect(fifty).toBeCloseTo(500, 0);
    // routeProfile on the same road: the grid is stretched, so sample 50 is not at 500 m.
    // (And it refuses points with no height at all, which an open-world ride
    // has until #2013's DEM: they are given 0 here.)
    const road = [{ position: START, elevation: 0 }, ...straight(START, 0, 1_005)].map((point) => ({
      position: point.position,
      elevation: altitudeMetres(point.elevation ?? 0),
    }));
    expect(() =>
      routeProfile(road.map((point) => ({ position: point.position, elevation: undefined }))),
    ).toThrow(/elevation/u);
    const fixed = routeProfile(road);
    expect(fixed.resolution).not.toBe(ROLLING_RESOLUTION_METRES);
    expect(fixed.totalDistance % ROLLING_RESOLUTION_METRES).not.toBe(0);
    expect(fixed.positions[50]).not.toEqual(view.positions[50]);
  });

  it('never moves a sample it already handed out when it grows', () => {
    const rolling = new RollingProfile({ position: START });
    rolling.append(straight(START, 0, 1_005));
    const before = rolling.view();
    const sample = before.positions[80];
    rolling.append(straight(moved(START, 0, 1_000), 0, 1_000));
    const after = rolling.view();
    expect(after).not.toBe(before);
    expect(after.positions[80]).toEqual(sample);
    // What was left over is the next extension's first metres: nothing is lost.
    expect(after.totalDistance).toBeGreaterThanOrEqual(1_990);
    // The old view is untouched: a holder of it is never changed under it.
    const total = before.totalDistance;
    expect(before.positions).toHaveLength(total / ROLLING_RESOLUTION_METRES + 1);
  });

  it('extends the same in one piece or two', () => {
    const one = new RollingProfile({ position: START });
    const road = straight(START, 0, 2_000);
    one.append(road);
    const two = new RollingProfile({ position: START });
    two.append(road.slice(0, 13));
    two.append(road.slice(13));
    expect(two.view().positions).toEqual(one.view().positions);
  });

  it('hands out the same view until something changes', () => {
    const rolling = new RollingProfile({ position: START });
    rolling.append(straight(START, 0, 500));
    expect(rolling.view()).toBe(rolling.view());
    expect(rolling.views).toBe(1);
  });

  it('swaps its tail at a junction for the chosen street, keeping the road ridden', () => {
    const rolling = new RollingProfile({ position: START });
    // 400 m north to the junction, and the default branch: straight on for 600 m.
    rolling.append(straight(START, 0, 1_000));
    const ridden = rolling.view();
    const junction = moved(START, 0, 400);
    // The rider chose right: east from the junction.
    rolling.swapTail(400, straight(junction, 90, 600));
    const turned = rolling.view();
    expect(turned.totalDistance).toBeGreaterThanOrEqual(990);
    for (let index = 0; index <= 40; index += 1) {
      expect(turned.positions[index]).toEqual(ridden.positions[index]);
    }
    // 200 m past the junction the road is 200 m east of it, not north.
    const past = turned.positions[60] as GeographicPosition;
    expect(distanceBetween(past, moved(junction, 90, 200))).toBeLessThan(0.5);
    expect(distanceBetween(past, moved(junction, 0, 200))).toBeGreaterThan(250);
  });

  it('fits the grade again near the end once more road is known', () => {
    const rolling = new RollingProfile({ position: START, elevation: 0 });
    rolling.append(straight(START, 0, 1_000, 0, 0));
    const flat = rolling.view();
    expect(flat.grades[50]).toBeCloseTo(0, 6);
    expect(rolling.settledTo).toBe(rolling.totalDistance - 50);
    // A 6 % climb starts where the known road ended: the last sample's grade was provisional.
    rolling.append(straight(moved(START, 0, 1_000), 0, 1_000, 6, 0));
    const climbing = rolling.view();
    // The flat road's last sample, which had no road past it when it was fitted.
    const last = flat.grades.length - 1;
    expect(climbing.grades[last]).not.toBeCloseTo(flat.grades[last] as number, 1);
    expect(climbing.grades[150]).toBeCloseTo(6, 1);
    // A sample settled before the climb was not fitted again.
    expect(climbing.grades[50]).toBe(flat.grades[50]);
  });
});
