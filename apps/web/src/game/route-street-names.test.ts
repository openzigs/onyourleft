// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3245: a saved route ride paints the name of the street it is on, once just
 * after it joins the street and then no more than once each kilometre, and
 * never a side street's. Every name here is invented, on a synthetic square
 * route (`routeFor`), and laid on the drawn road the scene draws.
 */

import { ATHLETE_A, resetFixtureIds, routeFor } from '@onyourleft/store/testing';
import type { RouteProfile } from '@onyourleft/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { drawnRoadPoints, nearestOnDrawnRoad } from './road-grid';
import {
  ROUTE_STREET_NAME_JOIN_METRES,
  ROUTE_STREET_NAME_REPEAT_METRES,
  routeStreetNameLabels,
  type RouteStreet,
} from './route-street-names';
import { paintedLength, type StreetNameLabel } from './street-names';
import { corridorOrigin } from './terrain';

const SIDE_METRES = 1_500;

/** Invented names, one a side of the square. */
const SIDES = ['Testa Way', 'Testb Row', 'Testc Lane', 'Testd Road'] as const;

let profile: RouteProfile;

beforeEach(() => {
  resetFixtureIds();
  profile = routeFor(ATHLETE_A, { sideMetres: SIDE_METRES }).profile;
});

const origin = (): ReturnType<typeof corridorOrigin> => corridorOrigin(profile);

/** The drawn road's point `metres` along it. */
function roadAt(metres: number): { x: number; z: number } {
  const road = drawnRoadPoints(profile, origin());
  const index = Math.min(road.points.length / 2 - 1, Math.round(metres / road.step));
  return { x: road.points[index * 2] as number, z: road.points[index * 2 + 1] as number };
}

/** A street along the drawn road from `from` to `to` metres, straight between its corners. */
function streetAlong(from: number, to: number, name: string | undefined): RouteStreet {
  const a = roadAt(from);
  const b = roadAt(to);
  return { line: Float32Array.of(a.x, a.z, b.x, b.z), name };
}

/** The square's four sides, each its own named street, ends meeting at the corners. */
function sides(names: readonly (string | undefined)[] = SIDES): RouteStreet[] {
  return names.map((name, side) => streetAlong(side * SIDE_METRES, (side + 1) * SIDE_METRES, name));
}

/** How far along the route each label is, by its text, in route order. */
function alongByName(labels: readonly StreetNameLabel[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const label of labels) {
    const on = nearestOnDrawnRoad(profile, origin(), label.x, label.z, 5);
    expect(on, `label ${label.key} is on the drawn road`).toBeDefined();
    const list = out.get(label.text) ?? [];
    list.push(on?.along ?? Number.NaN);
    out.set(label.text, list);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

describe('a saved route ride names the street it is on — #3245', () => {
  it('paints one label just after each turn onto a new named street, then one each kilometre on it', () => {
    const labels = routeStreetNameLabels(sides(), profile, origin());
    const along = alongByName(labels);
    expect([...along.keys()].sort()).toStrictEqual([...SIDES].sort());
    for (const [side, name] of SIDES.entries()) {
      const at = along.get(name) ?? [];
      const half = paintedLength(name) / 2;
      const joined = side * SIDE_METRES;
      // Just after the turn: its nearest letter the join distance past the
      // corner, give or take where the corner's own samples end.
      expect(at[0]).toBeGreaterThanOrEqual(joined + ROUTE_STREET_NAME_JOIN_METRES + half - 1);
      expect(at[0]).toBeLessThan(joined + ROUTE_STREET_NAME_JOIN_METRES + half + 20);
      // Then once a kilometre on, which a 1.5 km side has room for once.
      expect(at).toHaveLength(2);
      expect((at[1] as number) - (at[0] as number)).toBeCloseTo(ROUTE_STREET_NAME_REPEAT_METRES, 0);
    }
  });

  it('paints no more than one label each kilometre along one long street', () => {
    const name = 'Testlong Avenue';
    const labels = routeStreetNameLabels(sides([name, name, name, name]), profile, origin());
    const at = alongByName(labels).get(name) ?? [];
    // One street the whole 6 km: joined once, at the start, and never again.
    expect(at[0]).toBeLessThan(ROUTE_STREET_NAME_JOIN_METRES + paintedLength(name));
    expect(at.length).toBeGreaterThanOrEqual(4);
    expect(at.length).toBeLessThanOrEqual(6);
    for (let index = 1; index < at.length; index += 1) {
      expect((at[index] as number) - (at[index - 1] as number)).toBeGreaterThanOrEqual(
        ROUTE_STREET_NAME_REPEAT_METRES - 1,
      );
    }
  });

  it('never paints a side street’s name, nor a street beside the route', () => {
    const a = roadAt(SIDE_METRES / 2);
    const b = roadAt(SIDE_METRES / 2 + 10);
    // Square across the route at the middle of the first side, 200 m each way.
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const acrossX = -(b.z - a.z) / length;
    const acrossZ = (b.x - a.x) / length;
    const cross: RouteStreet = {
      line: Float32Array.of(
        a.x - acrossX * 200,
        a.z - acrossZ * 200,
        a.x + acrossX * 200,
        a.z + acrossZ * 200,
      ),
      name: 'Testcross Street',
    };
    // And one alongside, 30 m off the route, the whole of the first side.
    const start = roadAt(0);
    const end = roadAt(SIDE_METRES);
    const beside: RouteStreet = {
      line: Float32Array.of(
        start.x + acrossX * 30,
        start.z + acrossZ * 30,
        end.x + acrossX * 30,
        end.z + acrossZ * 30,
      ),
      name: 'Testbeside Street',
    };
    const labels = routeStreetNameLabels([...sides(), cross, beside], profile, origin());
    const texts = new Set(labels.map((label) => label.text));
    expect(texts.has('Testcross Street')).toBe(false);
    expect(texts.has('Testbeside Street')).toBe(false);
    expect(texts).toStrictEqual(new Set(SIDES));
  });

  it('never takes a street crossing at an angle for the route’s, though it passes nearer than the route’s own', () => {
    // The first side's street mapped 7.5 m off the drawn road, as a mapped
    // centreline often is, and a named street crossing the road at its
    // middle 32° off its heading: near the crossing that street is nearer
    // the road than the road's own, though it runs too far off its heading.
    const [first, ...rest] = SIDES;
    const road = drawnRoadPoints(profile, origin());
    const normalAt = (index: number): [number, number, number, number] => {
      const [x, z] = [road.points[index * 2] as number, road.points[index * 2 + 1] as number];
      const dx = (road.points[index * 2 + 2] as number) - x;
      const dz = (road.points[index * 2 + 3] as number) - z;
      const length = Math.hypot(dx, dz);
      return [x, z, dx / length, dz / length];
    };
    const shifted: number[] = [];
    for (let index = 0; index * road.step <= SIDE_METRES; index += 5) {
      const [x, z, ux, uz] = normalAt(index);
      shifted.push(x - uz * 7.5, z + ux * 7.5);
    }
    const offset: RouteStreet = { line: Float32Array.from(shifted), name: first };
    const [mx, mz, ux, uz] = normalAt(Math.round(SIDE_METRES / 2 / road.step));
    const angle = (32 * Math.PI) / 180;
    const [cx, cz] = [
      ux * Math.cos(angle) - uz * Math.sin(angle),
      uz * Math.cos(angle) + ux * Math.sin(angle),
    ];
    const crossing: RouteStreet = {
      line: Float32Array.of(mx - cx * 300, mz - cz * 300, mx + cx * 300, mz + cz * 300),
      name: 'Testoblique Street',
    };
    const streets = [
      offset,
      crossing,
      ...rest.map((name, side) =>
        streetAlong((side + 1) * SIDE_METRES, (side + 2) * SIDE_METRES, name),
      ),
    ];
    const along = alongByName(routeStreetNameLabels(streets, profile, origin()));
    expect(along.has('Testoblique Street')).toBe(false);
    // And the route's street is not joined again past the crossing.
    const at = along.get(first) ?? [];
    expect(at).toHaveLength(2);
    expect((at[1] as number) - (at[0] as number)).toBeCloseTo(ROUTE_STREET_NAME_REPEAT_METRES, 0);
  });

  it('paints nothing for unnamed streets, a name the atlas cannot paint, or no streets', () => {
    expect(routeStreetNameLabels([], profile, origin())).toStrictEqual([]);
    expect(
      routeStreetNameLabels(sides([undefined, '', '   ', undefined]), profile, origin()),
    ).toStrictEqual([]);
    // A character outside the glyph atlas: the whole name is not painted.
    expect(
      routeStreetNameLabels(
        sides(['TestЖ Way', undefined, undefined, undefined]),
        profile,
        origin(),
      ),
    ).toStrictEqual([]);
  });

  it('paints a name only where the whole of it fits on its street', () => {
    // A street of 60 m: the join distance and a 30-letter name do not fit.
    const long = 'Testaaaaaaaaaaaaaaaaaaaaa Road';
    const short = streetAlong(200, 260, long);
    expect(routeStreetNameLabels([short], profile, origin())).toStrictEqual([]);
    // And a short name that does fit is painted, once.
    const fits = routeStreetNameLabels([streetAlong(200, 260, 'Test Rd')], profile, origin());
    expect(fits.map((label) => label.text)).toStrictEqual(['Test Rd']);
  });

  it('keeps one street one street across a short unnamed gap and a stray short match in it', () => {
    // The first side's street in two pieces with 30 m of nothing between,
    // and a 12 m spur of another name lying along the road in the gap.
    const [first, ...rest] = SIDES;
    const streets = [
      streetAlong(0, 700, first),
      streetAlong(704, 716, 'Testz Spur'),
      streetAlong(730, SIDE_METRES, first),
      ...rest.map((name, side) =>
        streetAlong((side + 1) * SIDE_METRES, (side + 2) * SIDE_METRES, name),
      ),
    ];
    const along = alongByName(routeStreetNameLabels(streets, profile, origin()));
    // No second join label after the gap — the second label is the one a
    // kilometre on — and none for the spur.
    const at = along.get(first) ?? [];
    expect(at).toHaveLength(2);
    expect((at[1] as number) - (at[0] as number)).toBeCloseTo(ROUTE_STREET_NAME_REPEAT_METRES, 0);
    expect(along.has('Testz Spur')).toBe(false);
  });

  it('moves a label on past a corner rather than lay it across one', () => {
    // A street that starts just before the first corner: its join label
    // would straddle the corner, so it is laid wholly past it.
    const name = 'Testcorner Way';
    const half = paintedLength(name) / 2;
    const [a, corner, b] = [roadAt(1_470), roadAt(SIDE_METRES), roadAt(1_800)];
    const bent: RouteStreet = {
      line: Float32Array.of(a.x, a.z, corner.x, corner.z, b.x, b.z),
      name,
    };
    const labels = routeStreetNameLabels([bent], profile, origin());
    const at = alongByName(labels).get(name) ?? [];
    expect(at).toHaveLength(1);
    expect((at[0] as number) - half).toBeGreaterThanOrEqual(SIDE_METRES - 1);
  });

  it('lays each label along the route, on its centreline', () => {
    const labels = routeStreetNameLabels(sides(), profile, origin());
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(Math.hypot(label.alongX, label.alongZ)).toBeCloseTo(1, 5);
      const on = nearestOnDrawnRoad(profile, origin(), label.x, label.z, 5);
      expect(on?.distance).toBeLessThan(0.5);
    }
    expect(new Set(labels.map((label) => label.key)).size).toBe(labels.length);
  });
});
