// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Footways and sidewalks from the corridor — #1551. Read back through the
 * paths a consumer uses: `streetsAt` (#1535's builder) and `sceneFrame` for
 * the pavement sides, and the network's own lines for #1541.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { PathFeature } from '@onyourleft/map-features';

import {
  FOOTWAY_MAX_LINES,
  FOOTWAY_MAX_METRES,
  FOOTWAY_STEP_METRES,
  footwayNetwork,
  NO_PAVEMENT_DATA,
  pavementSides,
  ROAD_HALF_WIDTH_METRES,
  type PavementSide,
  type PavementSides,
} from './footways';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { PLOT_METRES, siteAt, siteSpacing, villagePlots, type Site } from './settlements';
import { atStartLine } from './simulation';
import { streetsAt, type PavementMesh, type VillageStreet } from './streets';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Six kilometres of level farmland running due north: `x` is across (WEST), `z` along. */
const FARMLAND = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(FARMLAND);
const SEED = scatterSeed(FARMLAND);

function roadAt(along: number) {
  const frame = drawnRoadFrame(FARMLAND, ORIGIN, along);
  if (frame === undefined) throw new Error(`no road at ${String(along)}`);
  return frame;
}

/**
 * A line beside the drawn road from `from` to `to` (odometer), `offset`
 * metres along its normal (the rider's right; negative is the left), turned
 * `degrees` off the road's heading about its start.
 */
function besideRoad(from: number, to: number, offset: number, degrees = 0): Float32Array {
  const start = roadAt(from);
  const turn = (degrees * Math.PI) / 180;
  const points: number[] = [];
  for (let along = from; along <= to + 1e-9; along += 10) {
    const here = roadAt(along);
    const x = here.x + here.normalX * offset;
    const z = here.z + here.normalZ * offset;
    // Turned about the line's start: a straight north road, so a rotation in plan.
    const sx = start.x + start.normalX * offset;
    const sz = start.z + start.normalZ * offset;
    const dx = x - sx;
    const dz = z - sz;
    points.push(
      sx + dx * Math.cos(turn) - dz * Math.sin(turn),
      sz + dx * Math.sin(turn) + dz * Math.cos(turn),
    );
  }
  return Float32Array.from(points);
}

/** A straight line across the road at `along`, `half` metres each side of it. */
function acrossRoad(along: number, half: number): Float32Array {
  const here = roadAt(along);
  return Float32Array.from([
    here.x - here.normalX * half,
    here.z - here.normalZ * half,
    here.x + here.normalX * half,
    here.z + here.normalZ * half,
  ]);
}

function sidewalk(line: Float32Array, kindDetail = 'sidewalk', kind = 'path'): PathFeature {
  return { kind, kindDetail, line };
}

function corridorOf(
  paths: readonly PathFeature[],
  covered: (x: number, z: number) => boolean = () => true,
): WorldCorridor {
  return {
    routeId: 'footways-fixture',
    origin: ORIGIN,
    covered,
    landUse: [],
    buildings: [],
    paths,
  };
}

function sidesOf(corridor: WorldCorridor): PavementSides {
  return pavementSides(corridor, FARMLAND, ORIGIN);
}

/** Every site of the fixture that holds a village. */
function villagesOf(): readonly Site[] {
  const { sites } = siteSpacing(FARMLAND);
  const found: Site[] = [];
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(FARMLAND, SEED, index);
    if (site?.kind === 'village') found.push(site);
  }
  return found;
}

/** A village with a house on its LEFT, so #1535 lays a left pavement there. */
const VILLAGE = villagesOf().find(
  (site) => villagePlots(SEED, site).filter((plot) => plot.side === -1).length >= 3,
) as Site;

/** The village's street, from its first plot to its last, on either side. */
const STREET_FROM = VILLAGE.centre - VILLAGE.half - PLOT_METRES;
const STREET_TO = VILLAGE.centre + VILLAGE.half + PLOT_METRES;

function streetOf(sides: PavementSides): VillageStreet | undefined {
  return streetsAt(FARMLAND, ORIGIN, SEED, STREET_FROM, STREET_TO, sides).find(
    (street) => street.wrappedSite === VILLAGE.wrappedSite,
  );
}

/** The pavement's top vertices, by the side of the road's normal they are on. */
function topSides(mesh: PavementMesh | undefined): { right: number; left: number } {
  let right = 0;
  let left = 0;
  if (mesh === undefined) return { right, left };
  for (let at = 0; at < mesh.positions.length / 3; at += 1) {
    if ((mesh.normals[at * 3 + 1] as number) < 0.999) continue;
    const x = mesh.positions[at * 3] as number;
    const z = mesh.positions[at * 3 + 2] as number;
    const along = alongAt(z);
    const road = roadAt(along);
    const offset = (x - road.x) * road.normalX + (z - road.z) * road.normalZ;
    if (offset > 0) right += 1;
    else left += 1;
  }
  return { right, left };
}

/** The odometer reading at which the north road reaches `z`. */
function alongAt(z: number): number {
  let low = 0;
  let high: number = FARMLAND.totalDistance;
  for (let step = 0; step < 50; step += 1) {
    const middle = (low + high) / 2;
    if (roadAt(middle).z < z) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** The sidewalk of the first criterion: 6 m to the road's right for 300 m, through the village. */
const RIGHT_FROM = VILLAGE.centre - 150;
const RIGHT_TO = VILLAGE.centre + 150;
const RIGHT_SIDEWALK = sidewalk(besideRoad(RIGHT_FROM, RIGHT_TO, 6));

describe('the side the map says — #1551', () => {
  it('finds the fixture a village with a left-hand pavement of its own', () => {
    // Non-vacuity: #1535 alone lays a pavement on the left here, so a data
    // pavement on the right only is a change it can be seen to make.
    expect(VILLAGE).toBeDefined();
    expect(topSides(streetOf(NO_PAVEMENT_DATA)?.pavement).left).toBeGreaterThan(50);
  });

  it('is `right` over the mapped stretch and `none` over the rest of the covered land', () => {
    const sides = sidesOf(corridorOf([RIGHT_SIDEWALK]));
    for (let along = RIGHT_FROM + 4; along <= RIGHT_TO - 4; along += 2) {
      expect(sides.sideAt(along), `at ${String(along)}`).toBe('right');
    }
    for (const along of [RIGHT_FROM - 40, RIGHT_TO + 40, 100, 5_900]) {
      expect(sides.sideAt(along), `at ${String(along)}`).toBe('none');
    }
  });

  it('reads the side off the road’s normal, which on a road north is −x: never the sign of x', () => {
    // #583's mirror defect is a side taken from the sign of `x`. The rider's
    // right on a road running north is EAST, which is −x.
    const middle = Math.floor(RIGHT_SIDEWALK.line.length / 4) * 2;
    expect(RIGHT_SIDEWALK.line[middle] as number).toBeLessThan(roadAt(VILLAGE.centre).x);
    const sides = sidesOf(corridorOf([sidewalk(besideRoad(RIGHT_FROM, RIGHT_TO, -6))]));
    expect(sides.sideAt(VILLAGE.centre)).toBe('left');
    const both = sidesOf(
      corridorOf([RIGHT_SIDEWALK, sidewalk(besideRoad(RIGHT_FROM, RIGHT_TO, -8))]),
    );
    expect(both.sideAt(VILLAGE.centre)).toBe('both');
  });

  it('is `unknown` where the road was not read, and the same object every call', () => {
    const north = roadAt(VILLAGE.centre).z;
    const corridor = corridorOf([RIGHT_SIDEWALK], (_x, z) => z < north);
    const sides = sidesOf(corridor);
    expect(sides.sideAt(VILLAGE.centre - 20)).toBe('right');
    expect(sides.sideAt(VILLAGE.centre + 20)).toBe('unknown');
    expect(sides.sideAt(5_900)).toBe('unknown');
    expect(sidesOf(corridor)).toBe(sides);
    expect(NO_PAVEMENT_DATA.sideAt(VILLAGE.centre)).toBe('unknown');
  });

  it('puts #1535’s pavement on the right only, through the village, when the map says right', () => {
    const procedural = topSides(streetOf(NO_PAVEMENT_DATA)?.pavement);
    const mapped = topSides(streetOf(sidesOf(corridorOf([RIGHT_SIDEWALK])))?.pavement);
    expect(mapped.left).toBe(0);
    expect(mapped.right).toBeGreaterThan(50);
    // Its right runs the whole street, from the first plot on either side to the last.
    expect(mapped.right).toBeGreaterThanOrEqual(procedural.right);
  });

  it('lays no pavement in a village whose road was read and has no sidewalk', () => {
    expect(streetOf(sidesOf(corridorOf([])))).toBeUndefined();
    // The control: the same village, with nothing read, has its own.
    expect(streetOf(NO_PAVEMENT_DATA)).toBeDefined();
  });

  it('carries the mapped side on the frame `sceneFrame` builds from the ride’s corridor', () => {
    const start = atStartLine(FARMLAND);
    const at = (worldCorridor: WorldCorridor | undefined) =>
      sceneFrame({
        profile: FARMLAND,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(VILLAGE.centre) } },
        ...(worldCorridor === undefined ? {} : { worldCorridor }),
      }).streets.find((street) => street.wrappedSite === VILLAGE.wrappedSite);
    const mapped = topSides(at(corridorOf([RIGHT_SIDEWALK]))?.pavement);
    expect(mapped.left).toBe(0);
    expect(mapped.right).toBeGreaterThan(50);
    expect(topSides(at(undefined)?.pavement).left).toBeGreaterThan(50);
  });
});

describe('parallel and near only — #1551', () => {
  const side = (paths: readonly PathFeature[]): PavementSide =>
    sidesOf(corridorOf(paths)).sideAt(VILLAGE.centre);

  it('gives no side for a crossing, or any footway, across the road at 90°', () => {
    expect(side([sidewalk(acrossRoad(VILLAGE.centre + 5, 10), 'crossing', 'path')])).toBe('none');
    expect(side([sidewalk(acrossRoad(VILLAGE.centre + 5, 10), 'footway', 'path')])).toBe('none');
  });

  it('gives no side for a path 40 m away, or one on the carriageway', () => {
    const far = besideRoad(VILLAGE.centre - 100, VILLAGE.centre + 100, 40);
    expect(side([sidewalk(far, 'path')])).toBe('none');
    const on = besideRoad(VILLAGE.centre - 100, VILLAGE.centre + 100, 2);
    expect(side([sidewalk(on)])).toBe('none');
    // The control: the same line 10 m out is beside it.
    expect(side([sidewalk(besideRoad(VILLAGE.centre - 100, VILLAGE.centre + 100, 10))])).toBe(
      'right',
    );
  });

  it('gives no side for a sidewalk at 25° to the road, and one at 15°', () => {
    // Turned about a start 6 m out and 10 m back, so it is 3–12 m out at the village's centre.
    const from = VILLAGE.centre - 10;
    expect(side([sidewalk(besideRoad(from, from + 30, 6, 25))])).toBe('none');
    expect(side([sidewalk(besideRoad(from, from + 30, 6, -25))])).toBe('none');
    expect(side([sidewalk(besideRoad(from, from + 30, 6, 15))])).toBe('right');
  });

  it('takes no track, bridleway or corridor, and takes a bare `path`', () => {
    const line = besideRoad(RIGHT_FROM, RIGHT_TO, 6);
    for (const detail of ['track', 'bridleway', 'corridor']) {
      expect(side([sidewalk(line, detail, 'path')]), detail).toBe('none');
    }
    expect(side([sidewalk(line, '', 'path')])).toBe('right');
    expect(side([sidewalk(line, 'cycleway', 'other')])).toBe('right');
    expect(side([sidewalk(line, '', 'minor_road')])).toBe('none');
  });
});

describe('uncovered is #1535’s own rule — #1551', () => {
  it('lays byte-identical streets with nothing read as with NO_PAVEMENT_DATA', () => {
    // A different object from the constant, `unknown` everywhere: it takes the
    // read path's test and must come out where #1535 does.
    const unread: PavementSides = { sideAt: () => 'unknown' };
    const own = streetsAt(FARMLAND, ORIGIN, SEED, 0, FARMLAND.totalDistance);
    const fromNothing = streetsAt(FARMLAND, ORIGIN, SEED, 0, FARMLAND.totalDistance, unread);
    const fromUncovered = streetsAt(
      FARMLAND,
      ORIGIN,
      SEED,
      0,
      FARMLAND.totalDistance,
      sidesOf(corridorOf([RIGHT_SIDEWALK], () => false)),
    );
    expect(own.length).toBeGreaterThan(0);
    for (const other of [fromNothing, fromUncovered]) {
      expect(other).not.toBe(own);
      expect(other).toEqual(own);
    }
    // The default IS NO_PAVEMENT_DATA, and the same objects.
    expect(streetsAt(FARMLAND, ORIGIN, SEED, 0, FARMLAND.totalDistance, NO_PAVEMENT_DATA)).toEqual(
      own,
    );
  });

  it('keeps #1535’s rule on the stretch of a street that was not read', () => {
    // Read up to the village's centre only: the left pavement stands beyond it.
    const north = roadAt(VILLAGE.centre).z;
    const half = topSides(
      streetOf(sidesOf(corridorOf([RIGHT_SIDEWALK], (_x, z) => z < north)))?.pavement,
    );
    expect(half.left).toBeGreaterThan(0);
    expect(half.left).toBeLessThan(topSides(streetOf(NO_PAVEMENT_DATA)?.pavement).left);
    expect(half.right).toBeGreaterThan(0);
  });
});

/** A footway that wanders across the road and back: the carriageway's test. */
function wanderer(): Float32Array {
  const points: number[] = [];
  for (let along = VILLAGE.centre - 200; along <= VILLAGE.centre + 200; along += 10) {
    const here = roadAt(along);
    const offset = 15 * Math.sin((along - VILLAGE.centre) / 30);
    points.push(here.x + here.normalX * offset, here.z + here.normalZ * offset);
  }
  return Float32Array.from(points);
}

const LIMITS = { maxLines: FOOTWAY_MAX_LINES, maxMetres: FOOTWAY_MAX_METRES };

function networkOf(paths: readonly PathFeature[], covered?: (x: number, z: number) => boolean) {
  return footwayNetwork(corridorOf(paths, covered), FARMLAND, ORIGIN, LIMITS);
}

function* pointsOf(lines: readonly Float32Array[]): Generator<readonly [number, number]> {
  for (const line of lines) {
    for (let at = 0; at + 1 < line.length; at += 2) {
      yield [line[at] as number, line[at + 1] as number];
    }
  }
}

describe('the walkable network — #1551', () => {
  it('states the bounds #1551 names', () => {
    expect(FOOTWAY_MAX_LINES).toBe(2_000);
    expect(FOOTWAY_MAX_METRES).toBe(50_000);
    expect(ROAD_HALF_WIDTH_METRES).toBe(3.5);
  });

  it('never puts a point within the road’s half-width of any stretch of the drawn road', () => {
    const network = networkOf([
      sidewalk(wanderer(), 'footway'),
      RIGHT_SIDEWALK,
      sidewalk(acrossRoad(VILLAGE.centre + 60, 12), 'crossing'),
    ]);
    let count = 0;
    for (const [x, z] of pointsOf(network.lines)) {
      count += 1;
      expect(distanceToDrawnRoad(FARMLAND, ORIGIN, x, z, 10)).toBeGreaterThanOrEqual(
        ROAD_HALF_WIDTH_METRES,
      );
    }
    // Non-vacuity: the wanderer is broken into pieces either side of the road, not dropped.
    expect(count).toBeGreaterThan(200);
    expect(network.lines.length).toBeGreaterThan(3);
  });

  it('takes no crossing at all', () => {
    expect(networkOf([sidewalk(acrossRoad(VILLAGE.centre, 12), 'crossing')]).lines).toEqual([]);
    // The control: a footway drawn the same way keeps its ends off the carriageway.
    expect(
      networkOf([sidewalk(acrossRoad(VILLAGE.centre, 12), 'footway')]).lines.length,
    ).toBeGreaterThan(0);
  });

  it('resamples every 2 m and adds up its own metres', () => {
    const network = networkOf([RIGHT_SIDEWALK]);
    expect(network.lines).toHaveLength(1);
    const line = network.lines[0] as Float32Array;
    let total = 0;
    for (let at = 2; at + 1 < line.length; at += 2) {
      const step = Math.hypot(
        (line[at] as number) - (line[at - 2] as number),
        (line[at + 1] as number) - (line[at - 1] as number),
      );
      expect(step).toBeLessThanOrEqual(FOOTWAY_STEP_METRES + 1e-3);
      total += step;
    }
    expect(network.totalMetres).toBeCloseTo(total, 3);
    expect(network.totalMetres).toBeGreaterThan(290);
  });

  it('is clipped to the corridor: nothing far from the road, nothing on land not read', () => {
    const far = sidewalk(besideRoad(RIGHT_FROM, RIGHT_TO, 300), 'path');
    expect(networkOf([far]).lines).toEqual([]);
    expect(networkOf([RIGHT_SIDEWALK], () => false).lines).toEqual([]);
    // The control: 200 m out is inside the corridor's 250 m.
    expect(networkOf([sidewalk(besideRoad(RIGHT_FROM, RIGHT_TO, 200), 'path')]).lines).toHaveLength(
      1,
    );
  });

  it('keeps the nearest lines first, within its line and metre bounds', () => {
    const paths = [40, 10, 30, 20, 50].map((offset) =>
      sidewalk(besideRoad(1_000, 1_100, offset), 'path'),
    );
    const two = footwayNetwork(corridorOf(paths), FARMLAND, ORIGIN, {
      maxLines: 2,
      maxMetres: FOOTWAY_MAX_METRES,
    });
    expect(two.lines).toHaveLength(2);
    const offsets = two.lines.map((line) =>
      Math.round(distanceToDrawnRoad(FARMLAND, ORIGIN, line[0] as number, line[1] as number, 100)),
    );
    expect(offsets).toEqual([10, 20]);
    const short = footwayNetwork(corridorOf(paths), FARMLAND, ORIGIN, {
      maxLines: FOOTWAY_MAX_LINES,
      maxMetres: 150,
    });
    expect(short.totalMetres).toBeLessThanOrEqual(150);
    expect(short.totalMetres).toBeGreaterThan(140);
    expect(short.lines).toHaveLength(2);
  });

  it('builds a 50 km route’s network inside its budget', () => {
    const long = northRoute(50_000, () => 40);
    const origin = corridorOrigin(long);
    const paths: PathFeature[] = [];
    for (let from = 0; from + 400 <= 50_000; from += 400) {
      for (const offset of [6, -6, 60]) {
        const line: number[] = [];
        for (let along = from; along <= from + 400; along += 10) {
          const here = drawnRoadFrame(long, origin, along);
          if (here === undefined) continue;
          line.push(here.x + here.normalX * offset, here.z + here.normalZ * offset);
        }
        paths.push(sidewalk(Float32Array.from(line), 'footway'));
      }
    }
    const corridor: WorldCorridor = { ...corridorOf(paths), origin };
    // The route's own road and its grid are built by the ride whatever this does.
    distanceToDrawnRoad(long, origin, 0, 0, 1);
    const started = performance.now();
    const network = footwayNetwork(corridor, long, origin, LIMITS);
    const networkMs = performance.now() - started;
    pavementSides(corridor, long, origin);
    const milliseconds = performance.now() - started;
    console.log(`network ${networkMs.toFixed(1)} ms`);
    const bytes = network.lines.reduce((sum, line) => sum + line.byteLength, 0);
    console.log(
      `#1551 50 km: ${String(network.lines.length)} lines, ${network.totalMetres.toFixed(0)} m, ${String(bytes)} bytes, ${milliseconds.toFixed(1)} ms`,
    );
    expect(network.totalMetres).toBeLessThanOrEqual(FOOTWAY_MAX_METRES);
    expect(network.totalMetres).toBeGreaterThan(49_000);
    expect(bytes).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe('only the fields P-4 names — #1551', () => {
  it('reads a PathFeature that carries no name, and nothing but its kind, detail and line', () => {
    expectTypeOf<PathFeature>().not.toHaveProperty('name');
    // Every key, exhaustively: a field added to `PathFeature` fails to compile here.
    const keys: Record<keyof PathFeature, true> = { kind: true, kindDetail: true, line: true };
    expect(Object.keys(keys)).toEqual(['kind', 'kindDetail', 'line']);
  });
});
