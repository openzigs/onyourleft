// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The street map's geometry and its throttle — #2290.
 *
 * What a rider reads off the panel is a place: north up, the rider in the
 * middle, the streets where they are. And what the tablet pays for it is a
 * count: how often the drawing changes, and how much of it there is. Both are
 * asserted here, through the functions `StreetMap.tsx` renders from.
 */

import { describe, expect, it } from 'vitest';

import {
  STREET_MAP_MARGIN_METRES,
  STREET_MAP_MARK_RADIUS,
  STREET_MAP_METRES,
  STREET_MAP_STEP_METRES,
  streetMapCentre,
  streetMapIndex,
  streetMapLayers,
  streetMapRegion,
  streetMapSheetStyle,
  streetMapViewBox,
  type StreetMapLayers,
  type StreetMapRegion,
} from './street-map';
import {
  CROSSING_NORTH_METRES,
  FAR_EAST_METRES,
  denseTown,
  denseTownRoute,
  northCorridor,
  northRoute,
} from './street-map-testing';
import { PLAN_SIZE, RIDER_MARK_RADIUS } from './plan';

/** Every `x y` pair in a path `d`. */
function pointsOf(d: string): readonly (readonly [number, number])[] {
  return [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
}

/** The layers drawn for a rider at `distance` along the north route. */
function drawnAt(distance: number, corridor = northCorridor()): StreetMapLayers {
  const profile = northRoute();
  const centre = streetMapCentre(corridor.origin, profile, distance);
  return streetMapLayers(streetMapIndex(corridor, profile), streetMapRegion(centre));
}

/** Where `streetMapSheetStyle` puts `centre`: its place on the sheet, read back from the style. */
function placed(region: StreetMapRegion, centre: { east: number; south: number }) {
  const style = streetMapSheetStyle(region, centre);
  const [across, down] = [...style.transform.matchAll(/(-?[\d.]+)%/g)].map(([, n]) => Number(n));
  return {
    east: region.left + (-(across ?? 0) / 100) * region.width,
    south: region.top + (-(down ?? 0) / 100) * region.height,
    /** The sheet's height in metres, where the box's shorter side, 100 `cqmin`, is {@link STREET_MAP_METRES}. */
    tall: style.height.endsWith('cqmin')
      ? (Number.parseFloat(style.height) / 100) * STREET_MAP_METRES
      : Number.NaN,
  };
}

describe('the street map is centred on the rider, north up — #2290', () => {
  it('puts the rider in the middle of the view, with north up the screen', () => {
    const corridor = northCorridor();
    const profile = northRoute();
    const start = streetMapCentre(corridor.origin, profile, 0);
    expect(start).toEqual({ east: 0, south: 0 });
    // 600 m north is 600 m UP the screen: a smaller `south`.
    const on = streetMapCentre(corridor.origin, profile, 600);
    expect(on.east).toBe(0);
    expect(on.south).toBeCloseTo(-600, 0);
    // The sheet is placed so that the rider's place on it is the box's middle…
    const region = streetMapRegion(on);
    const at = placed(region, on);
    expect(at.east).toBeCloseTo(on.east, 1);
    expect(at.south).toBeCloseTo(on.south, 1);
    // …and drawn at the box's scale: the box's shorter side is the kilometre.
    expect(at.tall).toBeCloseTo(region.height, 6);
    expect(streetMapViewBox(region)).toBe(
      `${String(region.left)} ${String(region.top)} ${String(region.width)} ${String(region.height)}`,
    );
    // Wherever on its sheet the rider is, not only at the sheet's middle: on
    // the way back down the loop, 100 m east, and between grid points.
    const loop = northRoute(true);
    for (const distance of [1600, 1730, 2100, 2615, 2990]) {
      const back = streetMapCentre(corridor.origin, loop, distance);
      expect(back.east).toBeCloseTo(100, 0);
      const at2 = placed(streetMapRegion(back), back);
      expect(at2.east).toBeCloseTo(back.east, 1);
      expect(at2.south).toBeCloseTo(back.south, 1);
    }
  });

  it('draws the corridor east as east: a street west of the route is left of the rider', () => {
    // The lake is 250–350 m WEST (`x` positive) in the corridor's frame.
    const water = pointsOf(drawnAt(0).water);
    expect(water.length).toBeGreaterThan(0);
    for (const [east] of water) expect(east).toBeLessThan(0);
    // And the crossing street is 200 m NORTH: up, a negative `south`.
    const streets = pointsOf(drawnAt(0).streets);
    expect(streets).toContainEqual([200, -CROSSING_NORTH_METRES]);
    expect(streets).toContainEqual([-200, -CROSSING_NORTH_METRES]);
  });

  it('follows the rider round a loop: lap two is centred where lap one was', () => {
    const corridor = northCorridor();
    const loop = northRoute(true);
    const length = loop.totalDistance as number;
    const lapOne = streetMapCentre(corridor.origin, loop, 900);
    const lapTwo = streetMapCentre(corridor.origin, loop, length + 900);
    expect(lapTwo).toEqual(lapOne);
  });

  it('draws the rider’s mark the plan view’s size on screen', () => {
    // A mark of `RIDER_MARK_RADIUS` in a 100-unit plan is this many metres in
    // a 1 km map: the same fraction of the box.
    expect(STREET_MAP_MARK_RADIUS / STREET_MAP_METRES).toBe(RIDER_MARK_RADIUS / PLAN_SIZE);
  });
});

describe('the street map draws what the corridor holds, near the rider — #2290', () => {
  it('draws the covered land, the water, the streets, the paths and the route', () => {
    const drawn = drawnAt(300);
    expect(drawn.land).toMatch(/^M.*Z$/);
    // Both rings of the lake, so the island stays dry.
    expect(drawn.water.match(/M/g)).toHaveLength(2);
    expect(drawn.streets).not.toBe('');
    expect(drawn.paths).not.toBe('');
    expect(pointsOf(drawn.route).length).toBeGreaterThan(100);
  });

  it('does not draw a street 6 km away', () => {
    const far = pointsOf(drawnAt(0).streets).filter(([east]) => east > 1000);
    expect(far).toEqual([]);
    // The control: the same street, moved within reach, IS drawn.
    const near = northCorridor();
    const moved = {
      ...near,
      streets: near.streets.map((street) =>
        street.kind === 'major_road'
          ? { ...street, line: Float32Array.of(-1500, 0, -1500, 400) }
          : street,
      ),
    };
    expect(pointsOf(drawnAt(0, moved).streets)).toContainEqual([1500, 0]);
    expect(FAR_EAST_METRES).toBeGreaterThan(5000);
  });

  it('draws nothing the basemap style does not: no building, no park', () => {
    const drawn = Object.values(drawnAt(0)).join(' ');
    // The building's corner (20, 20) west/north is (-20, -20); the park's (50, 50).
    expect(pointsOf(drawn)).not.toContainEqual([-20, -20]);
    expect(pointsOf(drawn)).not.toContainEqual([-50, -50]);
  });

  it('keeps a street’s last vertex, and drops vertices closer than a pixel', () => {
    const corridor = {
      ...northCorridor(),
      streets: [
        {
          kind: 'minor_road',
          kindDetail: '',
          grade: 'ground' as const,
          line: Float32Array.of(0, 100, 0.5, 100, 1, 100, 100, 100, 100.5, 100),
        },
      ],
    };
    expect(pointsOf(drawnAt(0, corridor).streets)).toEqual([
      [0, -100],
      [-100, -100],
      [-100.5, -100],
    ]);
  });

  it('draws the route in parts where its points jump, never a line across the gap', () => {
    const corridor = northCorridor();
    const profile = northRoute();
    // From sample 75 on, the route is ~850 m east: a stored row a different
    // build wrote (`plan.ts` §"What a gap is").
    const jumped = {
      ...profile,
      positions: profile.positions.map((position, index) =>
        index < 75 ? position : { ...position, longitude: position.longitude + 0.01 },
      ),
    } as typeof profile;
    const longest = (d: string): number =>
      Math.max(
        ...d
          .split('M')
          .filter((part) => part !== '')
          .map((part) => {
            const points = pointsOf(part);
            let most = 0;
            for (let index = 1; index < points.length; index += 1) {
              const [x0, y0] = points[index - 1] as readonly [number, number];
              const [x1, y1] = points[index] as readonly [number, number];
              most = Math.max(most, Math.hypot(x1 - x0, y1 - y0));
            }
            return most;
          }),
      );
    const route = streetMapLayers(
      streetMapIndex(corridor, jumped),
      streetMapRegion({ east: 0, south: 0 }),
    ).route;
    // Both sides of the jump are drawn…
    expect(pointsOf(route).some(([east]) => east < 10)).toBe(true);
    expect(pointsOf(route).some(([east]) => east > 800)).toBe(true);
    // …and no segment is longer than the grid can produce.
    expect(longest(route)).toBeLessThan(40);
    // The control: joined into one run, the jump IS a segment of ~850 m.
    expect(longest(route.replace(/M/g, 'L').replace(/^L/, 'M'))).toBeGreaterThan(800);
  });
});

describe('the cost: the drawing changes only when the rider has moved — #2290, #2380', () => {
  /**
   * One minute at 40 km/h, at sixty frames a second: what `HudPanel` asks of
   * this panel, and how often the answer differs from the frame before.
   */
  it('moves the sheet under once per frame in fifteen, and draws it again once per 250 m', () => {
    const corridor = northCorridor();
    const profile = northRoute(true);
    const speed = 40 / 3.6;
    const frames = 60 * 60;
    let moves = 0;
    let draws = 0;
    let lastMove = '';
    let lastRegion = '';
    for (let frame = 0; frame <= frames; frame += 1) {
      const centre = streetMapCentre(corridor.origin, profile, (frame / 60) * speed);
      const region = streetMapRegion(centre);
      const move = streetMapSheetStyle(region, centre).transform;
      const drawn = streetMapViewBox(region);
      if (move !== lastMove) moves += 1;
      if (drawn !== lastRegion) draws += 1;
      lastMove = move;
      lastRegion = drawn;
    }
    const ridden = 60 * speed;
    // At most one move per grid step ridden, and one new sheet per margin.
    expect(moves).toBeLessThanOrEqual(Math.ceil(ridden / STREET_MAP_STEP_METRES) + 1);
    expect(moves).toBeLessThan(frames / 15);
    expect(draws).toBeLessThanOrEqual(Math.ceil(ridden / STREET_MAP_MARGIN_METRES) + 1);
    // The control: it does follow, a step at a time, and the sheet does change.
    expect(moves).toBeGreaterThan(10);
    expect(draws).toBeGreaterThan(1);
  });

  it('does not change at all for a rider who has stopped', () => {
    const corridor = northCorridor();
    const profile = northRoute();
    const views = new Set<string>();
    for (let frame = 0; frame < 600; frame += 1) {
      // A rider creeping a metre in ten seconds: the trainer's own noise.
      const centre = streetMapCentre(corridor.origin, profile, 400 + frame / 600);
      const region = streetMapRegion(centre);
      views.add(`${streetMapViewBox(region)} ${streetMapSheetStyle(region, centre).transform}`);
    }
    expect(views.size).toBe(1);
  });

  it('moves the view less than a pixel at a time on the largest box', () => {
    // 8 rem, a landscape tablet's: `theme.css` §"THE PLAN VIEW ON A LANDSCAPE TABLET".
    const pixelsPerMetre = 128 / STREET_MAP_METRES;
    expect(STREET_MAP_STEP_METRES * pixelsPerMetre).toBeLessThan(1);
  });
});

/** Every segment of every subpath in a `d`, as its two ends. */
function segmentsOf(d: string): readonly (readonly [number, number, number, number])[] {
  return d
    .split('M')
    .filter((part) => part !== '')
    .flatMap((part) => {
      const points = pointsOf(part);
      return points.slice(1).map(([x1, y1], index) => {
        const [x0, y0] = points[index] as readonly [number, number];
        return [x0, y0, x1, y1] as const;
      });
    });
}

/** Whether a segment's bounds touch the region. */
function touches(
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  region: StreetMapRegion,
): boolean {
  return (
    Math.max(x0, x1) >= region.left &&
    Math.min(x0, x1) <= region.left + region.width &&
    Math.max(y0, y1) >= region.top &&
    Math.min(y0, y1) <= region.top + region.height
  );
}

describe('the sheet holds the box and its margin, and nothing further — #2380', () => {
  /** The widest box any layout gives the panel, as half its width: `REACH_ACROSS_METRES`' 22 rem by 5. */
  const HALF_WIDEST_BOX = (22 / 5) * (STREET_MAP_METRES / 2);

  it('holds the whole box, wherever the rider is on the grid', () => {
    const corridor = denseTown();
    const profile = denseTownRoute();
    for (let distance = 4000; distance < 6000; distance += 7) {
      const centre = streetMapCentre(corridor.origin, profile, distance);
      const region = streetMapRegion(centre);
      // The box round the rider, every side inside the sheet.
      expect(region.left).toBeLessThanOrEqual(centre.east - HALF_WIDEST_BOX);
      expect(region.left + region.width).toBeGreaterThanOrEqual(centre.east + HALF_WIDEST_BOX);
      expect(region.top).toBeLessThanOrEqual(centre.south - STREET_MAP_METRES / 2);
      expect(region.top + region.height).toBeGreaterThanOrEqual(
        centre.south + STREET_MAP_METRES / 2,
      );
    }
  });

  it('draws a dense town’s streets only where they reach into the sheet, and every one that does', () => {
    const corridor = denseTown();
    const profile = denseTownRoute();
    // Five kilometres in, where the harness starts, in the middle of the town.
    const centre = streetMapCentre(corridor.origin, profile, 5000);
    const region = streetMapRegion(centre);
    const drawn = streetMapLayers(streetMapIndex(corridor, profile), region);

    // Every segment drawn reaches into the sheet…
    const streets = segmentsOf(drawn.streets);
    const paths = segmentsOf(drawn.paths);
    for (const segment of [...streets, ...paths]) expect(touches(segment, region)).toBe(true);
    // …and every street segment of the town's that does is drawn, counted
    // here from the corridor itself (the corridor's `x` is WEST, `z` NORTH).
    const expected = corridor.streets.reduce((count, street) => {
      let touching = 0;
      for (let index = 0; index + 3 < street.line.length; index += 2) {
        const segment = [
          -(street.line[index] as number),
          -(street.line[index + 1] as number),
          -(street.line[index + 2] as number),
          -(street.line[index + 3] as number),
        ] as const;
        if (touches(segment, region)) touching += 1;
      }
      return count + touching;
    }, 0);
    expect(streets.length).toBe(expected);

    // So the path data a sheet can hold is bounded by its area, not by the
    // cells round it. On this PR the town's sheet is 6,040 street and 3,040
    // path segments, 102 KB of `d`: 15 rows of 4 km and 40 columns of
    // 1.5 km, the 5 km by 1.5 km sheet across the town's 4 km. #2290 joined
    // every shape filed in 13 × 5 cells whole.
    const bytes = drawn.streets.length + drawn.paths.length;
    expect(bytes).toBeLessThan(120_000);
    expect(streets.length + paths.length).toBeLessThan(10_000);
  });

  it('cuts a covered tile and a lake to the sheet, and keeps the lake’s island dry', () => {
    const corridor = northCorridor();
    const profile = northRoute();
    // A sheet from 1100 m north to 490 m north, so its bottom edge is across
    // the lake (400 to 600 m north) and its island (480 to 520).
    const region: StreetMapRegion = { left: -2500, top: -1100, width: 5000, height: 610 };
    const drawn = streetMapLayers(streetMapIndex(corridor, profile), region);
    const inside = ([east, south]: readonly [number, number]): boolean =>
      east >= region.left - 0.1 &&
      east <= region.left + region.width + 0.1 &&
      south >= region.top - 0.1 &&
      south <= region.top + region.height + 0.1;
    for (const point of pointsOf(drawn.land)) expect(inside(point)).toBe(true);
    for (const point of pointsOf(drawn.water)) expect(inside(point)).toBe(true);
    // The tile, 200 m south to 1700 m north, is cut at both: 1100 and 490 m north.
    expect(pointsOf(drawn.land)).toContainEqual([-500, -1100]);
    expect(pointsOf(drawn.land)).toContainEqual([500, -490]);
    // The lake, 400 to 600 m north, is cut at the sheet's bottom: 490 m north…
    expect(pointsOf(drawn.water)).toContainEqual([-250, -490]);
    expect(pointsOf(drawn.water)).not.toContainEqual([-250, -400]);
    // …and the island, 480 to 520 m north, is cut too, and still a ring of its own.
    expect(drawn.water.match(/M/g)).toHaveLength(2);
    expect(pointsOf(drawn.water)).toContainEqual([-290, -490]);
  });

  it('splits a line where it leaves the sheet, and draws nothing between', () => {
    const corridor = {
      ...northCorridor(),
      streets: [
        {
          kind: 'minor_road',
          kindDetail: '',
          grade: 'ground' as const,
          // East along 100 m north, 4 km out of the sheet and back.
          line: Float32Array.of(0, 100, -2000, 100, -6000, 100, -6000, 200, -2000, 200, 0, 200),
        },
      ],
    };
    const drawn = streetMapLayers(
      streetMapIndex(corridor, northRoute()),
      streetMapRegion({ east: 0, south: 0 }),
    );
    expect(drawn.streets.match(/M/g)).toHaveLength(2);
    // The two segments that reach in, to 6 km east, are kept whole; the one
    // wholly off the sheet, from 6 km north of 100 m to 200 m, is not.
    expect(segmentsOf(drawn.streets)).not.toContainEqual([6000, -100, 6000, -200]);
    expect(pointsOf(drawn.streets)).toContainEqual([0, -100]);
    expect(pointsOf(drawn.streets)).toContainEqual([0, -200]);
  });
});
