// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3344, the owner's ruling of 2026-11-26: a route ride's street name is
 * painted across the rider's lane as a real road marking is ("SLOW", "BUS"),
 * readable as the rider comes up to it — not along the road as a map label
 * is. Then the maintainer's look check on PR #3346: at road-marking size,
 * 0.6 m wide and (the owner's ruling of 2026-11-27) 5 m long a letter, in capitals, abbreviated and stacked
 * rather than shrunk, and left of the rider's own line so the chase camera
 * sees it past the rider. Each scene case reads the letter quads the
 * renderer is handed (`sceneFrame`'s `streetNames`) on a synthetic square
 * route whose sides are invented, named streets, against the road the scene
 * draws (`terrain.ts` §`drawnRoadFrame`, its right-hand normal) and the lane
 * its paint marks out (`terrain.ts`'s road, edge-line and centre-line widths).
 */

import { ATHLETE_A, resetFixtureIds, routeFor } from '@onyourleft/store/testing';
import { metres, type RouteProfile } from '@onyourleft/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { LANE_OFFSETS_METRES } from './lanes';
import { drawnRoadPoints, nearestOnDrawnRoad } from './road-grid';
import {
  ROUTE_STREET_NAME_JOIN_METRES,
  routeStreetNameLabels,
  type RouteStreet,
} from './route-street-names';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  glyphCell,
  paintedSize,
  roadMarkingText,
  ROUTE_STREET_NAME_ABBREVIATIONS,
  ROUTE_STREET_NAME_CAP_SHARE,
  ROUTE_STREET_NAME_CELL_LENGTH_METRES,
  ROUTE_STREET_NAME_GLYPH_LENGTH_METRES,
  ROUTE_STREET_NAME_GLYPH_MIN_WIDTH_METRES,
  ROUTE_STREET_NAME_GLYPH_WIDTH_METRES,
  ROUTE_STREET_NAME_LANE_MARGIN_METRES,
  ROUTE_STREET_NAME_LINE_WIDTH_METRES,
  ROUTE_STREET_NAME_MAX_LINES,
  routeNameLayout,
  streetNamesInView,
  type RouteNameLayout,
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

/**
 * Invented names: one that fits one line at full size, one stacked onto
 * three at full size, one whose last word is abbreviated to fit, one whose
 * first line is narrowed (but not past the floor), and one that only fits
 * a lane at a size too small to read.
 */
const SHORT = 'Elm';
const STACKS = 'Oak 3rd St.';
const ABBREVIATED = 'Test Avenue';
const NARROWED = 'Testa Way';
const TOO_LONG = 'Testaaaaaaa';

/** The rider's lane, metres right of the centreline: the centre line's right edge to the right edge line. */
const LANE_INNER = CENTRE_LINE_WIDTH_METRES / 2;
const LANE_OUTER = ROAD_WIDTH_METRES / 2 - EDGE_LINE_WIDTH_METRES;

/** The rider's own line, metres right of the centreline (`lanes.ts`). */
const RIDER_LINE = LANE_OFFSETS_METRES[2] as number;

let profile: RouteProfile;

beforeEach(() => {
  resetFixtureIds();
  profile = routeFor(ATHLETE_A, { sideMetres: SIDE_METRES }).profile;
});

/** `name`'s layout, which every name here but {@link TOO_LONG} has. */
function layoutOf(name: string): RouteNameLayout {
  const layout = routeNameLayout(name);
  expect(layout).toBeDefined();
  return layout as RouteNameLayout;
}

/** A street along the drawn road from `from` to `to` metres, straight between its corners. */
function streetAlong(from: number, to: number, name: string): RouteStreet {
  const road = drawnRoadPoints(profile, corridorOrigin(profile));
  const at = (metres: number): [number, number] => {
    const index = Math.round(metres / road.step);
    return [road.points[index * 2] as number, road.points[index * 2 + 1] as number];
  };
  return { line: Float32Array.of(...at(from), ...at(to)), name };
}

/** The square's first sides, named in turn. */
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
    view?.labels.reduce((sum, each) => sum + layoutOf(each.text).letters, 0),
  );
  return view as StreetNamesInView;
}

type Corner = [number, number, number];

/** The letters of `label` in `view`: each one's four corners `[x, y, z]`, and its atlas cell. */
function lettersOf(view: StreetNamesInView, label: StreetNameLabel) {
  let first = 0;
  for (const each of view.labels) {
    if (each.key === label.key) break;
    first += layoutOf(each.text).letters;
  }
  const count = layoutOf(label.text).letters;
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

/** A letter's plan size: across (bottom edge) and along (left edge), metres. */
function planSize([a, b, , d]: readonly Corner[]): { across: number; along: number } {
  const plan = (p: Corner, q: Corner): number => Math.hypot(q[0] - p[0], q[2] - p[2]);
  return { across: plan(a as Corner, b as Corner), along: plan(a as Corner, d as Corner) };
}

/** Each of `label`'s lines, in order: its letters' near corners on the road. */
function linesOf(labels: readonly StreetNameLabel[], label: StreetNameLabel) {
  const letters = lettersOf(viewOf(labels, label), label);
  const lines: { along: number; right: number; farRight: number }[][] = [];
  let index = 0;
  for (const line of layoutOf(label.text).lines) {
    lines.push(
      letters.slice(index, index + Array.from(line).length).map(({ corners }) => {
        const [a, b] = corners;
        return { ...onRoad(a[0], a[2]), farRight: onRoad(b[0], b[2]).right };
      }),
    );
    index += Array.from(line).length;
  }
  return lines;
}

describe('a route ride’s street name reads across the lane, as a road marking does — #3344', () => {
  it('stands each letter upright to the approaching rider: its up along the way the route runs, its bottom edge across the lane to the rider’s right', () => {
    const labels = labelsOf([SHORT, STACKS, NARROWED]);
    expect(new Set(labels.map((label) => label.text))).toStrictEqual(
      new Set([SHORT, STACKS, NARROWED]),
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
    expect(letters).toBeGreaterThan(10);
  });

  it('paints every letter at road-marking size: 0.6 m across the lane and 5 m along the road, never narrower than 0.45 m', () => {
    expect(ROUTE_STREET_NAME_GLYPH_WIDTH_METRES).toBe(0.6);
    expect(ROUTE_STREET_NAME_GLYPH_LENGTH_METRES).toBe(5);
    // A capital fills 37 of its 64 px atlas cell's rows (`three-renderer.ts` §`streetNameAtlas`).
    expect(ROUTE_STREET_NAME_CAP_SHARE).toBeCloseTo(0.58, 2);
    expect(ROUTE_STREET_NAME_GLYPH_MIN_WIDTH_METRES).toBe(0.45);
    const labels = labelsOf([SHORT, STACKS, ABBREVIATED, NARROWED]);
    expect(new Set(labels.map((label) => label.text))).toStrictEqual(
      new Set([SHORT, STACKS, ABBREVIATED, NARROWED]),
    );
    for (const label of labels) {
      // The size the scene paints, in metres: 0.6 m a letter where the name
      // fits at it; the 5-letter line narrowed to fill the lane, and no more.
      const width = label.text === NARROWED ? ROUTE_STREET_NAME_LINE_WIDTH_METRES / 5 : 0.6;
      expect(layoutOf(label.text).width).toBeCloseTo(width, 9);
      for (const { corners } of lettersOf(viewOf(labels, label), label)) {
        const size = planSize(corners);
        // To 0.5 %: the corners are float32, a thousand metres from the origin.
        expect(Math.abs(size.across / width - 1)).toBeLessThan(0.005);
        // The quad as long as makes the capital in it 5 m long.
        expect(Math.abs((size.along * ROUTE_STREET_NAME_CAP_SHARE) / 5 - 1)).toBeLessThan(0.005);
        expect(size.across).toBeGreaterThan(0.45 * 0.995);
      }
    }
  });

  it('spells the name in capitals, as a road marking is, and draws the capitals’ cells', () => {
    expect(layoutOf(SHORT).lines).toStrictEqual(['ELM']);
    const labels = labelsOf([SHORT]);
    const [label] = labels as [StreetNameLabel];
    expect(lettersOf(viewOf(labels, label), label).map(({ cell }) => cell)).toStrictEqual(
      Array.from('ELM', (letter) => glyphCell(letter)),
    );
    // Accented capitals the atlas holds are painted; a capital it does not hold refuses the name.
    expect(layoutOf('Testé').lines).toStrictEqual(['TESTÉ']);
    expect(routeNameLayout('Testÿ')).toBeUndefined();
    expect(
      routeStreetNameLabels(
        [streetAlong(0, SIDE_METRES, 'Testÿ')],
        profile,
        corridorOrigin(profile),
      ),
    ).toStrictEqual([]);
  });

  it('abbreviates a name’s last word as road markings do, by a small table', () => {
    expect(ROUTE_STREET_NAME_ABBREVIATIONS).toStrictEqual({
      STREET: 'ST',
      ROAD: 'RD',
      AVENUE: 'AVE',
      DRIVE: 'DR',
      LANE: 'LN',
      BOULEVARD: 'BLVD',
      PLACE: 'PL',
      COURT: 'CT',
      HIGHWAY: 'HWY',
      PARKWAY: 'PKWY',
      TERRACE: 'TER',
      CIRCLE: 'CIR',
    });
    for (const [word, short] of Object.entries(ROUTE_STREET_NAME_ABBREVIATIONS)) {
      const suffix = word.charAt(0) + word.slice(1).toLowerCase();
      expect(roadMarkingText(`Testa ${suffix}`)).toBe(`TESTA ${short}`);
    }
    // Only the last word: a suffix word earlier in the name is spelled out.
    expect(roadMarkingText('Lane Testa Road')).toBe('LANE TESTA RD');
    // A word not in the table is kept, in capitals.
    expect(roadMarkingText('Testa Way')).toBe('TESTA WAY');
    // And the abbreviation is what is laid out: "TEST AVE" on two full-size lines.
    expect(layoutOf(ABBREVIATED).lines).toStrictEqual(['TEST', 'AVE']);
    expect(layoutOf(ABBREVIATED).width).toBe(ROUTE_STREET_NAME_GLYPH_WIDTH_METRES);
  });

  it('stacks a long name onto up to three lines along the road, the first nearest the rider, each read left to right', () => {
    expect(ROUTE_STREET_NAME_MAX_LINES).toBe(3);
    expect(layoutOf(STACKS).lines).toStrictEqual(['OAK', '3RD', 'ST.']);
    // Fewest lines first: two lines where two fit at full size.
    expect(layoutOf('Oak Elm').lines).toStrictEqual(['OAK', 'ELM']);
    const labels = labelsOf([STACKS]);
    const [label] = labels as [StreetNameLabel];
    const lines = linesOf(labels, label);
    expect(lines.map((line) => line.length)).toStrictEqual([3, 3, 3]);
    for (let line = 1; line < lines.length; line += 1) {
      const before = Math.max(...(lines[line - 1] ?? []).map((letter) => letter.along));
      const next = Math.min(...(lines[line] ?? []).map((letter) => letter.along));
      // Each line wholly beyond the one before it, cell to cell: the clear
      // road between their capitals the cell's margin, about 3.65 m.
      expect(next - before).toBeCloseTo(ROUTE_STREET_NAME_CELL_LENGTH_METRES, 1);
    }
    for (const line of lines) {
      for (let index = 1; index < line.length; index += 1) {
        expect(line[index]?.right).toBeGreaterThan(line[index - 1]?.right as number);
        expect(line[index]?.along).toBeCloseTo(line[0]?.along as number, 1);
      }
    }
  });

  it('skips a name that does not fit three lines at 0.45 m a letter, rather than paint it smaller', () => {
    // One word: no stacking helps, and 11 letters at 0.45 m are wider than the lane.
    expect(routeNameLayout(TOO_LONG)).toBeUndefined();
    // Four words that would fit four lines, but not three.
    expect(routeNameLayout('Abcd Efgh Ijkl Mnop')).toBeUndefined();
    expect(routeNameLayout('Abcd Efgh Ijkl')).toBeDefined();
    // No label is placed for either, however long the street.
    expect(labelsOf([TOO_LONG, 'Abcd Efgh Ijkl Mnop'])).toStrictEqual([]);
    // And a label handed to the scene anyway is not drawn, while the next one is.
    const skipped: StreetNameLabel = {
      key: 'route:0',
      text: TOO_LONG,
      x: 0,
      z: 50,
      alongX: 0,
      alongZ: 1,
      along: 50,
    };
    const drawn: StreetNameLabel = { ...skipped, key: 'route:1', text: SHORT, z: 80, along: 80 };
    const view = streetNamesInView([skipped, drawn], { x: 0, z: 0 }, 0, () => 0);
    expect(view.labels.map((label) => label.key)).toStrictEqual(['route:1']);
    expect(view.cells).toHaveLength(3);
  });

  it('paints each line in the rider’s lane, inside its lines and left of the rider’s own line', () => {
    const PAIR = 'Ab Cd';
    const labels = labelsOf([SHORT, STACKS, NARROWED, PAIR]);
    let lines = 0;
    for (const label of labels) {
      const spans = linesOf(labels, label).map((line) => ({
        left: Math.min(...line.map((letter) => letter.right)),
        right: Math.max(...line.map((letter) => letter.farRight)),
      }));
      for (const { left, right } of spans) {
        expect(left).toBeGreaterThan(LANE_INNER);
        expect(right).toBeLessThan(LANE_OUTER);
        // Its middle left of the rider's line, for the chase camera to see it
        // past the rider's body; every line of a name on the same middle.
        expect((left + right) / 2).toBeLessThan(RIDER_LINE);
        expect((left + right) / 2).toBeCloseTo(
          ((spans[0]?.left ?? 0) + (spans[0]?.right ?? 0)) / 2,
          2,
        );
        // A line narrow enough lies wholly left of the rider's line.
        if (label.text === PAIR) expect(right).toBeLessThan(RIDER_LINE);
        lines += 1;
      }
      // A wider name as far left as the lane's margin allows.
      if (label.text !== PAIR) {
        expect(Math.min(...spans.map((span) => span.left))).toBeCloseTo(
          LANE_INNER + ROUTE_STREET_NAME_LANE_MARGIN_METRES,
          2,
        );
      }
    }
    // Each side's name is painted twice, a kilometre apart.
    expect(lines).toBe(2 * (1 + 3 + 2 + 2));
  });

  it('places a stacked name only where its whole stacked length lies past the join distance', () => {
    const layout = layoutOf(STACKS);
    expect(layout.extent).toBeCloseTo(3 * ROUTE_STREET_NAME_CELL_LENGTH_METRES, 9);
    const labels = labelsOf([STACKS]);
    const [label] = labels as [StreetNameLabel];
    const lines = linesOf(labels, label);
    const near = Math.min(...(lines[0] ?? []).map((letter) => letter.along));
    const far = Math.max(...(lines[2] ?? []).map((letter) => letter.along)) + layout.length;
    // What is painted is as long as the placement measured.
    expect(far - near).toBeCloseTo(layout.extent, 1);
    // And placement measured all three lines: on the same street, its middle
    // is half the difference in length further on than a one-line name's, so
    // each starts the same join distance past where the route came onto it.
    const [one] = labelsOf([SHORT]) as [StreetNameLabel];
    expect((label.along as number) - (one.along as number)).toBeCloseTo(
      (layout.extent - layoutOf(SHORT).extent) / 2,
      6,
    );
    expect(near).toBeGreaterThanOrEqual(ROUTE_STREET_NAME_JOIN_METRES - 1);
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
    // In the name's own case.
    expect(view.cells[0]).toBe(glyphCell('O'));
    expect(view.cells[1]).toBe(glyphCell('a'));
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
