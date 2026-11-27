// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3344, the owner's ruling of 2026-11-26: a route ride's street name is
 * painted across the rider's lane as a real road marking is ("SLOW", "BUS"),
 * readable as the rider comes up to it — not along the road as a map label
 * is. Each case reads the letter quads the renderer is handed
 * (`sceneFrame`'s `streetNames`) on a synthetic square route whose four
 * sides are invented, named streets, against the road the scene draws
 * (`terrain.ts` §`drawnRoadFrame`, its right-hand normal) and the lane its
 * paint marks out (`terrain.ts`'s road, edge-line and centre-line widths).
 */

import { ATHLETE_A, resetFixtureIds, routeFor } from '@onyourleft/store/testing';
import { metres, type RouteProfile } from '@onyourleft/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { drawnRoadPoints, nearestOnDrawnRoad } from './road-grid';
import { routeStreetNameLabels, type RouteStreet } from './route-street-names';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  paintedSize,
  ROUTE_STREET_NAME_GLYPH_WIDTH_METRES,
  ROUTE_STREET_NAME_LINE_WIDTH_METRES,
  ROUTE_STREET_NAME_STRETCH,
  routeNameLayout,
  streetNamesInView,
  type StreetNameLabel,
  type StreetNamesInView,
} from './street-names';
import {
  CENTRE_LINE_WIDTH_METRES,
  corridorOrigin,
  drawnRoadFrame,
  EDGE_LINE_WIDTH_METRES,
  ROAD_WIDTH_METRES,
} from './terrain';

const SIDE_METRES = 1_500;

/** Invented names: one short enough for one line, one that wraps, one long word that only shrinks. */
const SHORT = 'Elm';
const WRAPS = 'Testa Way';
const SHRINKS = 'Testaaaaaaaaaaaaaaaaaaaaa';

/** The rider's lane, metres right of the centreline: the centre line's right edge to the right edge line. */
const LANE_INNER = CENTRE_LINE_WIDTH_METRES / 2;
const LANE_OUTER = ROAD_WIDTH_METRES / 2 - EDGE_LINE_WIDTH_METRES;

let profile: RouteProfile;

beforeEach(() => {
  resetFixtureIds();
  profile = routeFor(ATHLETE_A, { sideMetres: SIDE_METRES }).profile;
});

/** A street along the drawn road from `from` to `to` metres, straight between its corners. */
function streetAlong(from: number, to: number, name: string): RouteStreet {
  const road = drawnRoadPoints(profile, corridorOrigin(profile));
  const at = (metres: number): [number, number] => {
    const index = Math.round(metres / road.step);
    return [road.points[index * 2] as number, road.points[index * 2 + 1] as number];
  };
  return { line: Float32Array.of(...at(from), ...at(to)), name };
}

/** The square's first three sides, named in turn. */
function labelsOf(names: readonly string[]): StreetNameLabel[] {
  return routeStreetNameLabels(
    names.map((name, side) => streetAlong(side * SIDE_METRES, (side + 1) * SIDE_METRES, name)),
    profile,
    corridorOrigin(profile),
  );
}

/** What the renderer is handed with the rider `before` metres short of `label`. */
function viewOf(labels: readonly StreetNameLabel[], label: StreetNameLabel, before = 40) {
  const start = atStartLine(profile);
  const view = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: {
      ...start,
      ride: { ...start.ride, distance: metres(Math.max(0, (label.along as number) - before)) },
    },
    streetNames: labels,
  }).streetNames;
  expect(view?.labels.map((each) => each.key)).toContain(label.key);
  // Every letter of every label in view is drawn, so each label's are found by count.
  expect(view?.cells.length).toBe(
    view?.labels.reduce((sum, each) => sum + routeNameLayout(each.text).letters, 0),
  );
  return view as StreetNamesInView;
}

type Corner = [number, number, number];

/** The letters of `label` in `view`: each one's four corners `[x, y, z]`, and its atlas cell. */
function lettersOf(view: StreetNamesInView, label: StreetNameLabel) {
  let first = 0;
  for (const each of view.labels) {
    if (each.key === label.key) break;
    first += routeNameLayout(each.text).letters;
  }
  const count = routeNameLayout(label.text).letters;
  return Array.from({ length: count }, (_, letter) => {
    const at = (first + letter) * 12;
    return {
      cell: view.cells[first + letter] as number,
      corners: [0, 1, 2, 3].map((corner) => [
        view.corners[at + corner * 3] as number,
        view.corners[at + corner * 3 + 1] as number,
        view.corners[at + corner * 3 + 2] as number,
      ]) as [Corner, Corner, Corner, Corner],
    };
  });
}

/** How far along the route and how far right of the drawn centreline `(x, z)` is. */
function onRoad(x: number, z: number): { along: number; right: number } {
  const origin = corridorOrigin(profile);
  const near = nearestOnDrawnRoad(profile, origin, x, z, 10);
  expect(near).toBeDefined();
  const along = near?.along ?? Number.NaN;
  const frame = drawnRoadFrame(profile, origin, along);
  expect(frame).toBeDefined();
  const right =
    (x - (frame?.x ?? 0)) * (frame?.normalX ?? 0) + (z - (frame?.z ?? 0)) * (frame?.normalZ ?? 0);
  return { along, right };
}

describe('a route ride’s street name reads across the lane, as a road marking does — #3344', () => {
  it('stands each letter upright to the approaching rider: its up along the way the route runs, its bottom edge across the lane to the rider’s right', () => {
    const labels = labelsOf([SHORT, WRAPS, SHRINKS]);
    expect(new Set(labels.map((label) => label.text))).toStrictEqual(
      new Set([SHORT, WRAPS, SHRINKS]),
    );
    const origin = corridorOrigin(profile);
    let letters = 0;
    for (const label of labels) {
      const frame = drawnRoadFrame(profile, origin, label.along as number);
      // The way the route runs there: the right-hand normal turned back a quarter.
      const [wayX, wayZ] = [frame?.normalZ ?? 0, -(frame?.normalX ?? 0)];
      for (const { corners } of lettersOf(viewOf(labels, label), label)) {
        const [a, b, , d] = corners;
        const up = [d[0] - a[0], d[2] - a[2]] as const;
        const across = [b[0] - a[0], b[2] - a[2]] as const;
        const upLength = Math.hypot(...up);
        const acrossLength = Math.hypot(...across);
        expect((up[0] * wayX + up[1] * wayZ) / upLength).toBeGreaterThan(0.999);
        expect(
          (across[0] * (frame?.normalX ?? 0) + across[1] * (frame?.normalZ ?? 0)) / acrossLength,
        ).toBeGreaterThan(0.999);
        letters += 1;
      }
    }
    expect(letters).toBeGreaterThan(20);
  });

  it('lays a wrapped name’s first line nearest the rider and each line left to right across the lane', () => {
    const labels = labelsOf([WRAPS]);
    const [label] = labels as [StreetNameLabel];
    expect(routeNameLayout(WRAPS).lines).toStrictEqual(['Testa', 'Way']);
    const letters = lettersOf(viewOf(labels, label), label).map(({ corners }) => {
      const [a, b] = corners;
      return { near: onRoad(a[0], a[2]), far: onRoad(b[0], b[2]) };
    });
    const [first, second] = [letters.slice(0, 5), letters.slice(5)];
    expect(second).toHaveLength(3);
    // Every letter of the first line nearer than any of the second.
    const firstFarthest = Math.max(...first.map((letter) => letter.near.along));
    const secondNearest = Math.min(...second.map((letter) => letter.near.along));
    expect(secondNearest).toBeGreaterThan(firstFarthest);
    // And left to right across the lane, in reading order, along each line.
    for (const line of [first, second]) {
      for (let index = 1; index < line.length; index += 1) {
        expect(line[index]?.near.right).toBeGreaterThan(line[index - 1]?.near.right as number);
        expect(line[index]?.near.along).toBeCloseTo(line[0]?.near.along as number, 1);
      }
    }
  });

  it('stretches every letter lengthwise by the stated factor, and keeps it inside the lane’s lines', () => {
    expect(ROUTE_STREET_NAME_STRETCH).toBeGreaterThanOrEqual(2.5);
    expect(ROUTE_STREET_NAME_STRETCH).toBeLessThanOrEqual(3);
    const labels = labelsOf([SHORT, WRAPS, SHRINKS]);
    let letters = 0;
    for (const label of labels) {
      for (const { corners } of lettersOf(viewOf(labels, label), label)) {
        const plan = (p: Corner, q: Corner): number => Math.hypot(q[0] - p[0], q[2] - p[2]);
        const [a, b, c, d] = corners;
        // To 0.5 %: the corners are float32, a thousand metres from the origin.
        expect(Math.abs(plan(a, d) / plan(a, b) / ROUTE_STREET_NAME_STRETCH - 1)).toBeLessThan(
          0.005,
        );
        expect(Math.abs(plan(b, c) / plan(d, c) / ROUTE_STREET_NAME_STRETCH - 1)).toBeLessThan(
          0.005,
        );
        for (const [x, , z] of corners) {
          const { right } = onRoad(x, z);
          expect(right).toBeGreaterThan(LANE_INNER);
          expect(right).toBeLessThan(LANE_OUTER);
        }
        letters += 1;
      }
    }
    expect(letters).toBeGreaterThan(20);
  });

  it('paints a name that fits its lane at full size on one line', () => {
    const layout = routeNameLayout(SHORT);
    expect(layout.lines).toStrictEqual([SHORT]);
    expect(layout.width).toBe(ROUTE_STREET_NAME_GLYPH_WIDTH_METRES);
    expect(layout.length).toBeCloseTo(ROUTE_STREET_NAME_STRETCH * layout.width, 9);
    expect(layout.extent).toBeCloseTo(layout.length, 9);
  });

  it('wraps a name too wide for the lane at the space that leaves its longer line shortest, and shrinks what is still too wide', () => {
    // Two lines at full size.
    const two = routeNameLayout('Oak Elm');
    expect(two.lines).toStrictEqual(['Oak', 'Elm']);
    expect(two.width).toBe(ROUTE_STREET_NAME_GLYPH_WIDTH_METRES);
    expect(two.letters).toBe(6);
    // The best of three spaces, the rest kept inside their line.
    const best = routeNameLayout('Testford 3rd St.');
    expect(best.lines).toStrictEqual(['Testford', '3rd St.']);
    expect(best.width * 8).toBeCloseTo(ROUTE_STREET_NAME_LINE_WIDTH_METRES, 9);
    // A long word with no space is shrunk to the lane on one line.
    const word = routeNameLayout(SHRINKS);
    expect(word.lines).toStrictEqual([SHRINKS]);
    expect(word.width * Array.from(SHRINKS).length).toBeCloseTo(
      ROUTE_STREET_NAME_LINE_WIDTH_METRES,
      9,
    );
    // And every line of every layout no wider than the lane allows.
    for (const layout of [two, best, word, routeNameLayout('Testaaaaaaaaaaaaaaaaaaaaa Road')]) {
      for (const line of layout.lines) {
        expect(Array.from(line).length * layout.width).toBeLessThanOrEqual(
          ROUTE_STREET_NAME_LINE_WIDTH_METRES + 1e-9,
        );
      }
      expect(layout.length).toBeCloseTo(ROUTE_STREET_NAME_STRETCH * layout.width, 9);
      expect(layout.extent).toBeCloseTo(layout.length * (layout.lines.length === 2 ? 2.5 : 1), 9);
    }
    // The lane the name is kept to is inside the lane's lines.
    expect(ROUTE_STREET_NAME_LINE_WIDTH_METRES).toBeLessThan(LANE_OUTER - LANE_INNER);
  });

  it('leaves the open world’s labels laid along their street', () => {
    const open: StreetNameLabel = {
      key: 'open:0',
      text: 'Oak',
      x: 0,
      z: 100,
      alongX: 0,
      alongZ: 1,
    };
    const view = streetNamesInView([open], { x: 30, z: 100 }, 0, () => 0);
    const [a, b] = [0, 1].map((corner) => [
      view.corners[corner * 3] as number,
      view.corners[corner * 3 + 2] as number,
    ]) as [[number, number], [number, number]];
    // Its bottom edge runs along the street, as since #3052.
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(1.5, 5);
    expect(b[0]).toBeCloseTo(a[0], 5);
  });
});

describe('the size guard sees each of a letter’s four edges — #3261’s review', () => {
  const [width, height] = [0.5, 1.4];
  /** A flat letter of `width` by `height`, corners bottom-left, bottom-right, top-right, top-left. */
  const square = (): number[][] => [
    [0, 0, 0],
    [width, 0, 0],
    [width, 0, height],
    [0, 0, height],
  ];
  const flat = (corners: number[][]): number[] => corners.flat();

  it('passes a letter at its painted size', () => {
    expect(paintedSize(flat(square()), width, height)).toBe(true);
  });

  // Each case moves two corners apart along ONE edge, so that edge alone is
  // longer than 1.5 times its size: its two neighbours lengthen only a little.
  it.each([
    ['bottom', 0, 1, 0],
    ['top', 3, 2, 0],
    ['left', 0, 3, 2],
    ['right', 1, 2, 2],
  ] as const)('refuses a letter whose %s edge alone is drawn too long', (_edge, from, to, axis) => {
    const corners = square();
    const size = axis === 0 ? width : height;
    (corners[from] as number[])[axis] = ((corners[from] as number[])[axis] as number) - size * 0.3;
    (corners[to] as number[])[axis] = ((corners[to] as number[])[axis] as number) + size * 0.3;
    expect(paintedSize(flat(corners), width, height)).toBe(false);
    // The same move a little short of the bound passes.
    const near = square();
    (near[from] as number[])[axis] = ((near[from] as number[])[axis] as number) - size * 0.2;
    (near[to] as number[])[axis] = ((near[to] as number[])[axis] as number) + size * 0.2;
    expect(paintedSize(flat(near), width, height)).toBe(true);
  });
});
