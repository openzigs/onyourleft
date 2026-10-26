// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * People walking and running — #1541. The pure half: where people walk, how
 * many, where each one is at a second of the ride, and the rule that keeps
 * every one of them off the carriageway. Read back through `sceneFrame`, the
 * path a ride takes, where it matters; the drawn half is the browser gate's.
 */

import { describe, expect, it } from 'vitest';

import { metres, seconds } from '@onyourleft/domain';
import type { LandUseFeature, PathFeature } from '@onyourleft/map-features';

import { STRIDE_PER_HEIGHT } from './gait';
import {
  NO_PEOPLE,
  PEOPLE_FAR_MAX,
  PEOPLE_FAR_METRES,
  PEOPLE_NEAR_MAX,
  PEOPLE_NEAR_METRES,
  PEOPLE_PER_METRE,
  PERSON_CLEARANCE_METRES,
  PERSON_HALF_WIDTH_METRES,
  RUNNER_SHARE,
  clearOfPavements,
  footwayWalks,
  streetWalks,
  peopleAt,
  personLook,
  villageDensity,
  walkLine,
  type PeopleOptions,
  type RoadDistance,
  type WalkLine,
} from './people';
import { NO_LAND_CLASS, type LandClass, type LandClassMask } from './land-class';
import { QUALITY_LADDER, REALISTIC_LADDER } from './quality';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { siteAt, siteSpacing, type Site } from './settlements';
import { atStartLine } from './simulation';
import {
  KERB_LATERAL_METRES,
  PAVEMENT_WIDTH_METRES,
  WALK_FROM_KERB_METRES,
  streetsAt,
  type VillageStreet,
} from './streets';
import { ROAD_WIDTH_METRES, corridorOrigin, drawnRoadFrame } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** A road along `x = 0`: how far `(x, z)` is from it. */
const ALONG_Z: RoadDistance = (x) => Math.abs(x);

/** A straight line at `x`, from `z = 0` to `z = length`, a point every 2 m, `x, y, z`. */
function straight(x: number, length: number): Float32Array {
  const points: number[] = [];
  for (let z = 0; z <= length; z += 2) points.push(x, 0, z);
  return Float32Array.from(points);
}

function options(overrides: Partial<PeopleOptions> = {}): PeopleOptions {
  return {
    x: 0,
    z: 0,
    seconds: 0,
    near: PEOPLE_NEAR_MAX,
    rule: true,
    road: ALONG_Z,
    ground: () => 0,
    ...overrides,
  };
}

/** How far `(x, z)` is from a straight line at `x = lineX`, `z` in `[0, length]`. */
function offLine(x: number, z: number, lineX: number, length: number): number {
  const clamped = Math.min(length, Math.max(0, z));
  return Math.hypot(x - lineX, z - clamped);
}

describe('the lines people walk — #1541', () => {
  it('breaks a line where it comes within a person’s half-width of the carriageway (the rule)', () => {
    // A path that crosses the road at z = 100.
    const points: number[] = [];
    for (let z = 0; z <= 200; z += 2) points.push(Math.abs(z - 100) * 0.5, 0, z);
    const lines = walkLine(points, 3, 'footway', 0.05, 1, ALONG_Z, true);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      for (let at = 0; at < line.points.length; at += 3) {
        expect(Math.abs(line.points[at] as number)).toBeGreaterThanOrEqual(PERSON_CLEARANCE_METRES);
      }
    }
    // The control: with the rule off it is one line, through the road.
    const off = walkLine(points, 3, 'footway', 0.05, 1, ALONG_Z, false);
    expect(off.length).toBe(1);
    expect(Math.min(...[...(off[0] as WalkLine).points].filter((_, at) => at % 3 === 0))).toBe(0);
  });

  it('is a person’s half-width more than the carriageway: 3.8 m from the centreline', () => {
    expect(PERSON_CLEARANCE_METRES).toBe(ROAD_WIDTH_METRES / 2 + PERSON_HALF_WIDTH_METRES);
    expect(PERSON_CLEARANCE_METRES).toBeCloseTo(3.8, 9);
  });

  it('carries as many people as its density says, in the mean, rounded by its own hash', () => {
    let total = 0;
    let expected = 0;
    for (let key = 0; key < 400; key += 1) {
      const [line] = walkLine(straight(10, 50), 3, 'pavement', 0.07, key, ALONG_Z, true);
      total += (line as WalkLine).people;
      expected += (line as WalkLine).length * 0.07;
    }
    expect(total / expected).toBeGreaterThan(0.9);
    expect(total / expected).toBeLessThan(1.1);
  });

  it('is busier in a fuller village, and on commercial land than residential (phase A and B)', () => {
    expect(villageDensity(20)).toBeCloseTo(PEOPLE_PER_METRE.pavement, 9);
    expect(villageDensity(4)).toBeLessThan(villageDensity(12));
    expect(villageDensity(0)).toBeGreaterThan(0);
    expect(PEOPLE_PER_METRE.commercial).toBeGreaterThan(PEOPLE_PER_METRE['built-up']);
    expect(PEOPLE_PER_METRE['built-up']).toBeGreaterThan(PEOPLE_PER_METRE.elsewhere);
  });
});

describe('where each person is at a second of the ride — #1541', () => {
  const [line] = walkLine(straight(10, 120), 3, 'park', 0.1, 7, ALONG_Z, true) as [WalkLine];

  it('is the same at the same second, and moves along the line as the seconds pass', () => {
    const now = peopleAt([line], options({ seconds: 30 }));
    expect(peopleAt([line], options({ seconds: 30 }))).toEqual(now);
    const later = peopleAt([line], options({ seconds: 31 }));
    expect(later.near.map((person) => person.z)).not.toEqual(now.near.map((person) => person.z));
  });

  it('keeps everybody on the line, never past an end, facing the way they go', () => {
    for (let second = 0; second < 300; second += 7) {
      const { near, far } = peopleAt([line], options({ seconds: second }));
      for (const person of [...near, ...far]) {
        expect(offLine(person.x, person.z, 10, 120)).toBeLessThan(1e-3);
        // Along z, one way or the other.
        expect(
          Math.abs(Math.abs(person.yaw) - (Math.abs(person.yaw) < 1 ? 0 : Math.PI)),
        ).toBeLessThan(1e-6);
      }
    }
  });

  it('advances a person’s gait by the ground they cover over their stride, so a foot does not slide', () => {
    const [one] = walkLine(straight(10, 100), 3, 'pavement', 0.0001, 3, ALONG_Z, true) as [
      WalkLine,
    ];
    const single = { ...one, people: 1 };
    // Two moments half a second apart with no turn at an end between them.
    let second = 10;
    let a = peopleAt([single], options({ seconds: second, x: 10, z: 50 })).near[0];
    let b = peopleAt([single], options({ seconds: second + 0.5, x: 10, z: 50 })).near[0];
    while (a !== undefined && b !== undefined && a.yaw !== b.yaw) {
      second += 5;
      a = peopleAt([single], options({ seconds: second, x: 10, z: 50 })).near[0];
      b = peopleAt([single], options({ seconds: second + 0.5, x: 10, z: 50 })).near[0];
    }
    if (a === undefined || b === undefined) throw new Error('nobody walked the line');
    const covered = Math.abs(b.z - a.z);
    const stride = STRIDE_PER_HEIGHT[a.gait] * a.height;
    const advanced = (b.phase - a.phase + 1) % 1;
    expect(advanced).toBeCloseTo((covered / stride) % 1, 4);
  });

  it('draws at most 16 bodies within 60 m and at most 32 impostors beyond, the nearest first', () => {
    const busy = walkLine(straight(10, 400), 3, 'footway', 1, 9, ALONG_Z, true);
    const { near, far } = peopleAt(busy, options({ z: 200 }));
    expect(near.length).toBe(PEOPLE_NEAR_MAX);
    expect(far.length).toBe(PEOPLE_FAR_MAX);
    for (const person of near) expect(person.distance).toBeLessThanOrEqual(PEOPLE_NEAR_METRES);
    for (const person of far) {
      expect(person.distance).toBeGreaterThan(PEOPLE_NEAR_METRES);
      expect(person.distance).toBeLessThanOrEqual(PEOPLE_FAR_METRES);
    }
    const distances = near.map((person) => person.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    // A rung that draws nobody places nobody, near or far.
    expect(peopleAt(busy, options({ z: 200, near: 0 }))).toBe(NO_PEOPLE);
  });

  it('sends runners only to paths and parks', () => {
    expect(RUNNER_SHARE.pavement).toBe(0);
    expect(RUNNER_SHARE.sidewalk).toBe(0);
    expect(RUNNER_SHARE['door-path']).toBe(0);
    const gaits = (kind: 'pavement' | 'park') =>
      peopleAt(walkLine(straight(10, 400), 3, kind, 1, 4, ALONG_Z, true), options({ z: 200 }))
        .near.concat(
          peopleAt(walkLine(straight(10, 400), 3, kind, 1, 4, ALONG_Z, true), options({ z: 200 }))
            .far,
        )
        .map((person) => person.gait);
    expect(gaits('pavement')).not.toContain('run');
    expect(gaits('park')).toContain('run');
    expect(gaits('park')).toContain('walk');
  });

  it('dresses each person from their own hash, from the palettes', () => {
    const looks = new Set<string>();
    for (let hash = 0; hash < 50; hash += 1) looks.add(JSON.stringify(personLook(hash * 7919)));
    expect(looks.size).toBeGreaterThan(40);
  });

  it('puts nobody within a half-width of the carriageway, and the rule off does (its control)', () => {
    // A mapped line at 3.6 m: off the carriageway, but a shoulder over the kerb.
    const kerbside = straight(3.6, 200);
    const on = walkLine(kerbside, 3, 'sidewalk', 0.5, 2, ALONG_Z, true);
    expect(on).toEqual([]);
    const off = walkLine(kerbside, 3, 'sidewalk', 0.5, 2, ALONG_Z, false);
    const { near } = peopleAt(off, options({ z: 100, rule: false }));
    expect(near.length).toBeGreaterThan(0);
    for (const person of near) {
      expect(Math.abs(person.x) - PERSON_HALF_WIDTH_METRES).toBeLessThan(ROAD_WIDTH_METRES / 2);
    }
    // And between two kept points: a line that dips toward the road between them.
    const dipping = walkLine(
      Float32Array.from([4, 0, 0, 4, 0, 40]),
      3,
      'sidewalk',
      1,
      3,
      ALONG_Z,
      true,
    );
    const placed = peopleAt(
      dipping,
      // 3.5 m: off the carriageway, but inside the 3.8 m a person keeps.
      options({ z: 20, road: (x, z) => (z > 15 && z < 25 ? 3.5 : Math.abs(x)) }),
    );
    expect(placed.near.length).toBeGreaterThan(0);
    for (const person of placed.near) expect(person.z <= 15 || person.z >= 25).toBe(true);
  });
});

describe('people in a ride’s frame — #1541, through `sceneFrame`', () => {
  const FARMLAND = northRoute(6_000, () => 40);
  const ORIGIN = corridorOrigin(FARMLAND);
  const SEED = scatterSeed(FARMLAND);
  const { sites } = siteSpacing(FARMLAND);
  const villages = [...Array(sites).keys()]
    .map((index) => siteAt(FARMLAND, SEED, index))
    .filter((site): site is Site => site?.kind === 'village');
  const village = villages[0] as Site;

  function frameAt(
    along: number,
    second: number,
    extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
  ): ReturnType<typeof sceneFrame> {
    const start = atStartLine(FARMLAND);
    return sceneFrame({
      profile: FARMLAND,
      origin: ORIGIN,
      state: {
        ...start,
        ride: { ...start.ride, distance: metres(along) },
        elapsed: seconds(second),
        ridden: seconds(second),
      },
      people: PEOPLE_NEAR_MAX,
      ...extra,
    });
  }

  it('walks a village’s pavements, never nearer the road than the rule allows', () => {
    let seen = 0;
    for (let second = 0; second < 120; second += 10) {
      const frame = frameAt(village.centre, second);
      const people = frame.people ?? NO_PEOPLE;
      seen += people.near.length;
      expect(people.near.length).toBeLessThanOrEqual(PEOPLE_NEAR_MAX);
      for (const person of [...people.near, ...people.far]) {
        const distance = distanceToDrawnRoad(FARMLAND, ORIGIN, person.x, person.z, 20);
        expect(distance).toBeGreaterThanOrEqual(PERSON_CLEARANCE_METRES);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('walks the pavement itself, inside its width, and each front path', () => {
    const road: RoadDistance = (x, z, reach) => distanceToDrawnRoad(FARMLAND, ORIGIN, x, z, reach);
    const streets = streetsAt(
      FARMLAND,
      ORIGIN,
      SEED,
      village.centre - village.half,
      village.centre + village.half,
    );
    const lines = streets.flatMap((street) => streetWalks(street, road));
    const pavements = lines.filter((line) => line.kind === 'pavement');
    expect(pavements.length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.kind === 'door-path').length).toBeGreaterThan(0);
    for (const line of pavements) {
      for (let at = 0; at < line.points.length; at += 3) {
        const x = line.points[at] as number;
        const z = line.points[at + 2] as number;
        const out = road(x, z, 20);
        expect(out).toBeGreaterThan(KERB_LATERAL_METRES + PERSON_HALF_WIDTH_METRES);
        expect(out).toBeLessThan(
          KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES - PERSON_HALF_WIDTH_METRES,
        );
      }
    }
  });

  it('places nobody where the rung draws nobody — every stylised rung, and the realistic second', () => {
    for (const rung of [...QUALITY_LADDER, REALISTIC_LADDER[1]]) {
      expect(rung?.people).toBe(0);
      expect(frameAt(village.centre, 30, { people: rung?.people }).people).toEqual(NO_PEOPLE);
    }
    expect(REALISTIC_LADDER[0]?.people).toBe(PEOPLE_NEAR_MAX);
    // Absent is nobody: GameView passes it.
    expect(frameAt(village.centre, 30, { people: undefined }).people).toEqual(NO_PEOPLE);
  });

  it('walks a mapped sidewalk, and with the rule off a kerbside one puts somebody over the kerb', () => {
    // Away from any village: a mapped sidewalk 6 m to the right and one at 3.6 m to the left.
    const along = (village.centre + 1_000) % FARMLAND.totalDistance;
    const line = (offset: number): Float32Array => {
      const points: number[] = [];
      for (let at = along - 200; at <= along + 200; at += 10) {
        const road = drawnRoadFrame(FARMLAND, ORIGIN, at);
        if (road === undefined) continue;
        points.push(road.x + road.normalX * offset, road.z + road.normalZ * offset);
      }
      return Float32Array.from(points);
    };
    const paths: PathFeature[] = [
      { kind: 'path', kindDetail: 'sidewalk', line: line(6) },
      { kind: 'path', kindDetail: 'sidewalk', line: line(-3.6) },
    ];
    const corridor: WorldCorridor = {
      routeId: 'people-fixture',
      origin: ORIGIN,
      covered: () => true,
      coveredBoxes: [],
      landUse: [],
      buildings: [],
      paths,
      streets: [],
    };
    let ruled = 0;
    let over = 0;
    for (let second = 0; second < 200; second += 5) {
      const kept = frameAt(along, second, { worldCorridor: corridor }).people ?? NO_PEOPLE;
      for (const person of [...kept.near, ...kept.far]) {
        ruled += 1;
        expect(
          distanceToDrawnRoad(FARMLAND, ORIGIN, person.x, person.z, 20),
        ).toBeGreaterThanOrEqual(PERSON_CLEARANCE_METRES);
      }
      const control =
        frameAt(along, second, { worldCorridor: corridor, peopleOnTheRoad: true }).people ??
        NO_PEOPLE;
      for (const person of control.near) {
        const distance = distanceToDrawnRoad(FARMLAND, ORIGIN, person.x, person.z, 20);
        if (distance - PERSON_HALF_WIDTH_METRES < ROAD_WIDTH_METRES / 2) over += 1;
      }
    }
    expect(ruled).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(0);
  });
});

describe('a pavement walked once, in a village with a mapped sidewalk — #1620', () => {
  const FARMLAND = northRoute(6_000, () => 40);
  const ORIGIN = corridorOrigin(FARMLAND);
  const SEED = scatterSeed(FARMLAND);
  const { sites } = siteSpacing(FARMLAND);
  const village = [...Array(sites).keys()]
    .map((index) => siteAt(FARMLAND, SEED, index))
    .find((site): site is Site => site?.kind === 'village') as Site;
  // A sidewalk mapped 4.6 m out on the right, through the village: inside the
  // 3.5 to 5.5 m its pavement is laid on there.
  const sidewalk: number[] = [];
  for (let at = village.centre - 150; at <= village.centre + 150; at += 2) {
    const road = drawnRoadFrame(FARMLAND, ORIGIN, at);
    if (road === undefined) continue;
    sidewalk.push(road.x + road.normalX * 4.6, road.z + road.normalZ * 4.6);
  }
  const corridor: WorldCorridor = {
    routeId: 'people-mapped-pavement',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [{ kind: 'path', kindDetail: 'sidewalk', line: Float32Array.from(sidewalk) }],
    streets: [],
  };

  function frameAt(second: number): ReturnType<typeof sceneFrame> {
    const start = atStartLine(FARMLAND);
    return sceneFrame({
      profile: FARMLAND,
      origin: ORIGIN,
      state: {
        ...start,
        ride: { ...start.ride, distance: metres(village.centre) },
        elapsed: seconds(second),
        ridden: seconds(second),
      },
      people: PEOPLE_NEAR_MAX,
      worldCorridor: corridor,
    });
  }

  /** The pavement's top under `(x, z)`, read off the nearest walk; `undefined` off every pavement. */
  function pavementTop(
    streets: readonly VillageStreet[],
    x: number,
    z: number,
  ): number | undefined {
    let best: { off: number; y: number } | undefined;
    for (const street of streets) {
      street.walks.forEach((walk, index) => {
        const reach = (street.walkWidths[index] as number) - WALK_FROM_KERB_METRES;
        for (let at = 0; at + 5 < walk.length; at += 3) {
          const ax = walk[at] as number;
          const az = walk[at + 2] as number;
          const dx = (walk[at + 3] as number) - ax;
          const dz = (walk[at + 5] as number) - az;
          const span = dx * dx + dz * dz;
          const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
          const off = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          if (off > reach || (best !== undefined && off >= best.off)) continue;
          const ay = walk[at + 1] as number;
          best = { off, y: ay + ((walk[at + 4] as number) - ay) * t };
        }
      });
    }
    return best?.y;
  }

  it('stands nobody below the pavement they are on, and somebody is on it', () => {
    const streets = frameAt(0).streets ?? [];
    expect(streets.length).toBeGreaterThan(0);
    let onIt = 0;
    for (let second = 0; second < 600; second += 3) {
      for (const person of (frameAt(second).people ?? NO_PEOPLE).near) {
        const top = pavementTop(streets, person.x, person.z);
        if (top === undefined) continue;
        onIt += 1;
        expect(person.y).toBeGreaterThanOrEqual(top - 0.005);
      }
    }
    expect(onIt).toBeGreaterThan(0);
  });

  it('breaks a mapped line over a pavement and keeps its density; a line clear of every street is the same line', () => {
    const streets = frameAt(0).streets ?? [];
    const lines = footwayWalks(corridor, FARMLAND, ORIGIN, NO_LAND_CLASS);
    expect(lines.length).toBe(1);
    const line = lines[0] as WalkLine;
    const cleared = clearOfPavements(lines, streets);
    expect(cleared).not.toContain(line);
    expect(cleared.length).toBeGreaterThan(0);
    for (const piece of cleared) {
      expect(piece.perMetre).toBe(line.perMetre);
      for (let at = 0; at < piece.points.length; at += 3) {
        expect(
          pavementTop(streets, piece.points[at] as number, piece.points[at + 2] as number),
        ).toBeUndefined();
      }
    }
    // The same pieces next frame, so nobody on them moves.
    expect(clearOfPavements(lines, streets)).toEqual(cleared);
    expect(clearOfPavements(lines, streets)[0]).toBe(cleared[0]);
    // Far from any street: untouched.
    const away = walkLine(straight(9_000, 100), 3, 'footway', 0.05, 7, ALONG_Z, true);
    expect(clearOfPavements(away, streets)[0]).toBe(away[0]);
  });
});

describe('the mapped footways, by the land they cross — #1541, through `footwayWalks`', () => {
  const ROUTE = northRoute(6_000, () => 40);
  const ORIGIN = corridorOrigin(ROUTE);
  const SPOTS = { park: 1_000, commercial: 2_500, residential: 4_000, field: 5_500 } as const;
  type Spot = keyof typeof SPOTS;
  const SPOT_NAMES = Object.keys(SPOTS) as Spot[];

  const centreOf = (spot: Spot): { x: number; z: number } => {
    const road = drawnRoadFrame(ROUTE, ORIGIN, SPOTS[spot]);
    if (road === undefined) throw new Error('no road');
    return { x: road.x, z: road.z };
  };
  const nearestSpot = (x: number, z: number): Spot =>
    SPOT_NAMES.reduce((best, spot) => {
      const a = centreOf(spot);
      const b = centreOf(best);
      return Math.hypot(x - a.x, z - a.z) < Math.hypot(x - b.x, z - b.z) ? spot : best;
    });
  const classes: Record<Spot, LandClass> = {
    park: 'park',
    commercial: 'built-up',
    residential: 'built-up',
    field: 'farmland',
  };
  const land: LandClassMask = {
    ...NO_LAND_CLASS,
    classAt: (x, z) => classes[nearestSpot(x, z)],
    covered: () => true,
  };

  const sideLine = (spot: Spot): Float32Array => {
    const points: number[] = [];
    for (let at = SPOTS[spot] - 150; at <= SPOTS[spot] + 150; at += 10) {
      const road = drawnRoadFrame(ROUTE, ORIGIN, at);
      if (road === undefined) continue;
      points.push(road.x + road.normalX * 6, road.z + road.normalZ * 6);
    }
    return Float32Array.from(points);
  };
  const c = centreOf('commercial');
  const half = 400;
  const commercial: LandUseFeature = {
    layer: 'landuse',
    kind: 'commercial',
    rings: [
      Float32Array.from([
        c.x - half,
        c.z - half,
        c.x + half,
        c.z - half,
        c.x + half,
        c.z + half,
        c.x - half,
        c.z + half,
      ]),
    ],
  };
  const corridor: WorldCorridor = {
    routeId: 'people-footway-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [],
    landUse: [commercial],
    buildings: [],
    paths: SPOT_NAMES.map((spot): PathFeature => ({
      kind: 'path',
      kindDetail: 'sidewalk',
      line: sideLine(spot),
    })),
    streets: [],
  };

  const walks = footwayWalks(corridor, ROUTE, ORIGIN, land);
  const at = (spot: Spot): { kinds: Set<string>; people: number; length: number } => {
    const lines = walks.filter((line) => {
      const middle = Math.floor(line.points.length / 6) * 3;
      return nearestSpot(line.points[middle] as number, line.points[middle + 2] as number) === spot;
    });
    return {
      kinds: new Set(lines.map((line) => line.kind)),
      people: lines.reduce((sum, line) => sum + line.people, 0),
      length: lines.reduce((sum, line) => sum + line.length, 0),
    };
  };

  it('sends runners to the mapped paths of a park, and leaves a sidewalk elsewhere a sidewalk', () => {
    expect([...at('park').kinds]).toEqual(['park']);
    for (const spot of ['commercial', 'residential', 'field'] as const) {
      expect([...at(spot).kinds]).toEqual(['sidewalk']);
    }
  });

  it('carries each line’s people by its land: commercial, built-up, park, then anywhere else', () => {
    const within = (spot: Spot, density: number): void => {
      const found = at(spot);
      expect(found.length).toBeGreaterThan(200);
      expect(Math.abs(found.people / found.length - density)).toBeLessThan(0.006);
    };
    within('commercial', PEOPLE_PER_METRE.commercial);
    within('residential', PEOPLE_PER_METRE['built-up']);
    within('park', PEOPLE_PER_METRE.park);
    within('field', PEOPLE_PER_METRE.elsewhere);
  });
});
