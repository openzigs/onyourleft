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
  STREET_MAP_CELL_METRES,
  STREET_MAP_MARK_RADIUS,
  STREET_MAP_METRES,
  STREET_MAP_STEP_METRES,
  streetMapCell,
  streetMapCentre,
  streetMapIndex,
  streetMapLayers,
  streetMapViewBox,
  type StreetMapLayers,
} from './street-map';
import {
  CROSSING_NORTH_METRES,
  FAR_EAST_METRES,
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
  return streetMapLayers(streetMapIndex(corridor, profile), streetMapCell(centre));
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
    expect(streetMapViewBox(on)).toBe(
      `${String(on.east - 500)} ${String(on.south - 500)} ${String(STREET_MAP_METRES)} ${String(STREET_MAP_METRES)}`,
    );
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
    const route = streetMapLayers(streetMapIndex(corridor, jumped), { column: 0, row: 0 }).route;
    // Both sides of the jump are drawn…
    expect(pointsOf(route).some(([east]) => east < 10)).toBe(true);
    expect(pointsOf(route).some(([east]) => east > 800)).toBe(true);
    // …and no segment is longer than the grid can produce.
    expect(longest(route)).toBeLessThan(40);
    // The control: joined into one run, the jump IS a segment of ~850 m.
    expect(longest(route.replace(/M/g, 'L').replace(/^L/, 'M'))).toBeGreaterThan(800);
  });
});

describe('the cost: the drawing changes only when the rider has moved — #2290', () => {
  /**
   * One minute at 40 km/h, at sixty frames a second: what `HudPanel` asks of
   * this panel, and how often the answer differs from the frame before.
   */
  it('changes the view under once per frame in fifteen, and the shapes once per cell', () => {
    const corridor = northCorridor();
    const profile = northRoute(true);
    const speed = 40 / 3.6;
    const frames = 60 * 60;
    let views = 0;
    let shapes = 0;
    let lastView = '';
    let lastCell = '';
    for (let frame = 0; frame <= frames; frame += 1) {
      const centre = streetMapCentre(corridor.origin, profile, (frame / 60) * speed);
      const view = streetMapViewBox(centre);
      const cell = JSON.stringify(streetMapCell(centre));
      if (view !== lastView) views += 1;
      if (cell !== lastCell) shapes += 1;
      lastView = view;
      lastCell = cell;
    }
    const ridden = 60 * speed;
    // At most one new view per grid step ridden, and one new set of shapes per cell.
    expect(views).toBeLessThanOrEqual(Math.ceil(ridden / STREET_MAP_STEP_METRES) + 1);
    expect(views).toBeLessThan(frames / 15);
    expect(shapes).toBeLessThanOrEqual(Math.ceil(ridden / STREET_MAP_CELL_METRES) + 2);
    expect(views).toBeGreaterThan(10);
  });

  it('does not change at all for a rider who has stopped', () => {
    const corridor = northCorridor();
    const profile = northRoute();
    const views = new Set<string>();
    for (let frame = 0; frame < 600; frame += 1) {
      // A rider creeping a metre in ten seconds: the trainer's own noise.
      views.add(streetMapViewBox(streetMapCentre(corridor.origin, profile, 400 + frame / 600)));
    }
    expect(views.size).toBe(1);
  });

  it('moves the view less than a pixel at a time on the largest box', () => {
    // 8 rem, a landscape tablet's: `theme.css` §"THE PLAN VIEW ON A LANDSCAPE TABLET".
    const pixelsPerMetre = 128 / STREET_MAP_METRES;
    expect(STREET_MAP_STEP_METRES * pixelsPerMetre).toBeLessThan(1);
  });
});
