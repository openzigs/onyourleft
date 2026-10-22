// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1547: the ground under mapped built-up land is levelled to the road's own
 * height, and rises from the town's edge no faster than the relief rises from
 * the road's clear band.
 *
 * Every height here is read off the mesh `terrainCorridor` builds — the arrays
 * `three-renderer.ts` uploads — or off `terrainHeightAt`, which is what the
 * scenery stands on, and each claim has its control: the same build with
 * `NO_LAND_CLASS`, or with a hold that is a step rather than a slope, which
 * must fail the same assertion.
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

import { describe, expect, it } from 'vitest';

import { elevationAt, metres, type RouteProfile } from '@onyourleft/domain';
import type { Box, LandUseFeature } from '@onyourleft/map-features';

import { groundUnder } from './ground-blob';

import {
  LEVELLING_REACH_METRES,
  landClassMask,
  NO_LAND_CLASS,
  type LandClassMask,
} from './land-class';
import {
  RELIEF_MAX_METRES,
  RELIEF_SLOPE,
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  terrainCorridor,
  terrainHeightAt,
  type TerrainMesh,
} from './landform';
import {
  circuitRoute,
  hairpinRoute,
  hillRoute,
  lakeValleyRoute,
  northRoute,
  plannerRoute,
  rollingRoute,
  steadyClimb,
  valleyRoute,
} from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  corridorOrigin,
  drawnRoadFrame,
  roadCorridor,
  type CorridorOrigin,
  type RoadCorridor,
} from './terrain';
import { waterNearRoute, waterShaping, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** One point's distance to built-up land, through the mask's batch read. */
function builtUpDistance(land: LandClassMask, x: number, z: number): number {
  const into = new Float64Array(1);
  land.builtUpDistances(Float64Array.of(x, z), 1, into);
  return into[0] as number;
}

const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/** The block's lateral extent: #1547's 40–200 m from the road. */
const BLOCK_NEAR_METRES = 40;
const BLOCK_FAR_METRES = 200;

/** A route's built-up block beside the road on the normal's side, from `from` to `to` along it. */
interface Block {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly from: number;
  readonly to: number;
  readonly mask: LandClassMask;
}

/**
 * A covered corridor over the whole of a straight route, with one residential
 * block 40–200 m off it between `from` and `to` along it — on the normal's
 * side, built from the drawn road's own frame so it is beside the road the
 * ground is built from.
 */
function blockBeside(
  profile: RouteProfile,
  from: number,
  to: number,
  near = BLOCK_NEAR_METRES,
): Block {
  const origin = corridorOrigin(profile);
  const corner = (along: number, lateral: number): readonly [number, number] => {
    const frame = drawnRoadFrame(profile, origin, along);
    if (frame === undefined) throw new Error('no road frame');
    return [frame.x + frame.normalX * lateral, frame.z + frame.normalZ * lateral];
  };
  const ring = Float32Array.from([
    ...corner(from, near),
    ...corner(to, near),
    ...corner(to, BLOCK_FAR_METRES),
    ...corner(from, BLOCK_FAR_METRES),
  ]);
  const covered: Box = { minX: -2_000, maxX: 2_000, minZ: -2_000, maxZ: 5_000 };
  const block: LandUseFeature = { layer: 'landuse', kind: 'residential', rings: [ring] };
  const corridor: WorldCorridor = {
    routeId: 'levelling-fixture',
    origin,
    covered: () => true,
    coveredBoxes: [covered],
    landUse: [block],
    buildings: [],
    paths: [],
  };
  return { profile, origin, seed: scatterSeed(profile), from, to, mask: landClassMask(corridor) };
}

/** The road's height at a route distance, in local metres. */
function roadAt(block: Block, along: number): number {
  return elevationAt(block.profile, along) - block.origin.elevation;
}

/**
 * The range of the ground's height, relative to the road's at the same route
 * distance, over the centre of every 5 m cell of the block — read through
 * `terrainHeightAt`, which is what a building on it would stand on.
 */
function rangeUnderBlock(block: Block, land: LandClassMask): number {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let along = block.from + 2.5; along < block.to; along += 5) {
    for (let lateral = BLOCK_NEAR_METRES + 2.5; lateral < BLOCK_FAR_METRES; lateral += 5) {
      const relative =
        terrainHeightAt(block.profile, block.origin, block.seed, along, lateral, land) -
        roadAt(block, along);
      lowest = Math.min(lowest, relative);
      highest = Math.max(highest, relative);
    }
  }
  return highest - lowest;
}

/** One vertex of a mesh. */
function vertex(mesh: TerrainMesh, row: number, side: number, column: number): number[] {
  const at = (row * 2 * COLUMNS + side * COLUMNS + column) * 3;
  return [
    mesh.vertices[at] as number,
    mesh.vertices[at + 1] as number,
    mesh.vertices[at + 2] as number,
  ];
}

/** A copy of a mesh's heights and positions, since its arrays are lent (#469). */
function built(
  block: Block,
  odometer: number,
  land: LandClassMask,
): {
  readonly corridor: RoadCorridor;
  readonly vertices: Float32Array;
  readonly rows: number;
} {
  const corridor = roadCorridor(block.profile, block.origin, odometer);
  const mesh = terrainCorridor(block.profile, block.origin, corridor, block.seed, land);
  return { corridor, vertices: Float32Array.from(mesh.vertices), rows: mesh.rows };
}

/** Odometer readings whose ground reaches over the block: from 400 m before it to its end. */
function odometersOver(block: Block): number[] {
  const out: number[] = [];
  for (let odometer = block.from - 400; odometer <= block.to; odometer += 37) {
    if (odometer >= 0) out.push(odometer);
  }
  return out;
}

/**
 * The range of the drawn ground's height relative to its own row's road, over
 * every mesh vertex inside the block, across every frame that draws it.
 */
function meshRangeUnderBlock(block: Block, land: LandClassMask): { range: number; count: number } {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const odometer of odometersOver(block)) {
    const { corridor, vertices, rows } = built(block, odometer, land);
    for (let row = 0; row < rows; row += 1) {
      const point = corridor.centre[row];
      if (point === undefined) continue;
      for (let column = 0; column < COLUMNS; column += 1) {
        const at = (row * 2 * COLUMNS + column) * 3;
        const x = vertices[at] as number;
        const z = vertices[at + 2] as number;
        if (block.mask.classAt(x, z) !== 'built-up') continue;
        const relative = (vertices[at + 1] as number) - point.y;
        lowest = Math.min(lowest, relative);
        highest = Math.max(highest, relative);
        count += 1;
      }
    }
  }
  return { range: highest - lowest, count };
}

/**
 * The steepest the drawn ground is anywhere beyond the verge, over every frame
 * that draws the block: rise over run along each edge of the mesh's grid —
 * across a cross-section and between neighbouring rows — less the road's own
 * rise along a row, so a climb's grade is not counted as the ground's.
 * `only` keeps the edges it is true of.
 */
function steepest(
  block: Block,
  land: LandClassMask,
  only: (x: number, z: number) => boolean = () => true,
): number {
  let most = 0;
  for (const odometer of odometersOver(block)) {
    const { corridor, vertices, rows } = built(block, odometer, land);
    const at = (row: number, side: number, column: number): number =>
      (row * 2 * COLUMNS + side * COLUMNS + column) * 3;
    const slope = (a: number, b: number, roadRise: number): number => {
      const ax = vertices[a] as number;
      const az = vertices[a + 2] as number;
      const bx = vertices[b] as number;
      const bz = vertices[b + 2] as number;
      if (!only(ax, az) && !only(bx, bz)) return 0;
      const run = Math.hypot(bx - ax, bz - az);
      if (!(run > 0.5)) return 0;
      return Math.abs((vertices[b + 1] as number) - (vertices[a + 1] as number) - roadRise) / run;
    };
    for (let row = 0; row < rows; row += 1) {
      for (let side = 0; side < 2; side += 1) {
        // Beyond the verge: column 2 out.
        for (let column = 2; column < COLUMNS; column += 1) {
          if (column + 1 < COLUMNS) {
            most = Math.max(most, slope(at(row, side, column), at(row, side, column + 1), 0));
          }
          if (row + 1 < rows) {
            const rise = (corridor.centre[row + 1]?.y ?? 0) - (corridor.centre[row]?.y ?? 0);
            most = Math.max(most, slope(at(row, side, column), at(row + 1, side, column), rise));
          }
        }
      }
    }
  }
  return most;
}

/** The block's mask, its hold made a step: none on the town, everything off it — a blend of zero. */
function steppedHold(mask: LandClassMask): LandClassMask {
  return {
    ...mask,
    builtUpDistances: (points, count, into) => {
      for (let point = 0; point < count; point += 1) {
        const built = mask.classAt(points[point * 2] as number, points[point * 2 + 1] as number);
        into[point] = built === 'built-up' ? 0 : Number.POSITIVE_INFINITY;
      }
    },
  };
}

describe('a mapped town stands on the flat — #1547', () => {
  // A level 3 km with the block from 1 000 m to 1 300 m, and a steady 6 %
  // climb with it at the same place, where the cross-slope adds to the relief.
  const level = blockBeside(
    northRoute(3_000, () => 10),
    1_000,
    1_300,
  );
  const climbing = blockBeside(steadyClimb(), 1_000, 1_300);

  it('holds every cell of the block within 1 m of the road’s height; without it, more than 5 m', () => {
    for (const block of [level, climbing]) {
      expect(rangeUnderBlock(block, block.mask)).toBeLessThanOrEqual(1);
      // The control: the fixture is one the relief does raise.
      expect(rangeUnderBlock(block, NO_LAND_CLASS)).toBeGreaterThan(5);
    }
  });

  it('draws the same: every vertex of the mesh inside the block, in every frame that draws it', () => {
    for (const block of [level, climbing]) {
      const held = meshRangeUnderBlock(block, block.mask);
      expect(held.count).toBeGreaterThan(100);
      expect(held.range).toBeLessThanOrEqual(1);
      expect(meshRangeUnderBlock(block, NO_LAND_CLASS).range).toBeGreaterThan(5);
    }
  });

  it('stands the town at the road’s height less the verge: the relief is gone, not the road', () => {
    const along = 1_150;
    const ground = terrainHeightAt(level.profile, level.origin, level.seed, along, 120, level.mask);
    expect(ground).toBeCloseTo(roadAt(level, along) - VERGE_DROP_METRES, 3);
  });

  it('puts the scenery on the levelled triangles: terrainHeightAt agrees with the mesh', () => {
    // The twin and the mesh are built from the same columns; near the block's
    // edge the hold varies, and a twin that ignored it would stand a tree in
    // the air there.
    let worst = 0;
    let compared = 0;
    for (const odometer of [700, 900, 1_100]) {
      const corridor = roadCorridor(level.profile, level.origin, odometer);
      const mesh = terrainCorridor(level.profile, level.origin, corridor, level.seed, level.mask);
      for (let row = 0; row < mesh.rows; row += 1) {
        const point = corridor.centre[row];
        if (point === undefined) continue;
        for (let column = 3; column < COLUMNS; column += 1) {
          const lateral = TERRAIN_COLUMN_OFFSETS[column] as number;
          const [x, , z] = vertex(mesh, row, 0, column);
          const distance = builtUpDistance(level.mask, x as number, z as number);
          if (!(distance < LEVELLING_REACH_METRES)) continue;
          const twin = terrainHeightAt(
            level.profile,
            level.origin,
            level.seed,
            point.distance,
            lateral,
            level.mask,
          );
          worst = Math.max(worst, Math.abs(twin - (vertex(mesh, row, 0, column)[1] as number)));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(50);
    expect(worst).toBeLessThan(0.05);
  });
});

describe('the scenery stands on the levelled ground — #1547', () => {
  it('puts every item near the town on the triangles drawn under it, where the levelling moved them', () => {
    // Read off the mesh the frame carries, as `landform.test.ts` §"the
    // scenery stands on the ground" does: a tree placed on the unlevelled
    // ground beside a levelled town would float over it or be buried.
    // The block 25 m out on the climb, so the hold binds on the scatter's own
    // bands between it and the road, where the cross-slope has already risen.
    const block = blockBeside(steadyClimb(), 1_000, 1_300, 25);
    const start = atStartLine(block.profile);
    const under = { y: 0, nx: 0, ny: 1, nz: 0 };
    let stood = 0;
    let moved = 0;
    for (let at = 700; at <= 1_300; at += 60) {
      const frame = sceneFrame({
        profile: block.profile,
        origin: block.origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
        landClass: block.mask,
      });
      for (const item of frame.scatter) {
        const distance = builtUpDistance(block.mask, item.x, item.z);
        if (!(distance > 0 && distance < LEVELLING_REACH_METRES)) continue;
        if (!groundUnder(frame.terrain.mesh, frame.corridor.centre, item.x, item.z, under)) {
          continue;
        }
        expect(Math.abs(item.y - under.y), `${item.kind} at ${String(at)}`).toBeLessThan(0.2);
        stood += 1;
        const unlevelled = groundUnderAt(block, item.x, item.z);
        if (unlevelled !== undefined && Math.abs(unlevelled - item.y) > 0.5) moved += 1;
      }
    }
    expect(stood).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(0);
  });
});

/** The unlevelled ground's height at a point beside the level fixture's straight road. */
function groundUnderAt(block: Block, x: number, z: number): number | undefined {
  // On a straight route the start's frame names every point: how far along
  // the heading `(normalZ, −normalX)`, and how far out along the normal.
  const frame = drawnRoadFrame(block.profile, block.origin, 0);
  if (frame === undefined) return undefined;
  const dx = x - frame.x;
  const dz = z - frame.z;
  const along = dx * frame.normalZ - dz * frame.normalX;
  const lateral = dx * frame.normalX + dz * frame.normalZ;
  return terrainHeightAt(block.profile, block.origin, block.seed, along, lateral, NO_LAND_CLASS);
}

describe('no step at the town’s edge — #1547', () => {
  const block = blockBeside(
    northRoute(3_000, () => 10),
    1_000,
    1_300,
  );
  /** The margin: off the block, and within the hold's reach of it. */
  const inMargin = (x: number, z: number): boolean => {
    const distance = builtUpDistance(block.mask, x, z);
    return distance > 0 && distance < LEVELLING_REACH_METRES;
  };

  it('is never steeper across the margin than the relief makes the ground by itself', () => {
    const own = steepest(block, NO_LAND_CLASS);
    const margin = steepest(block, block.mask, inMargin);
    expect(own).toBeGreaterThan(0.1);
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThanOrEqual(own);
  });

  it('control: a blend of zero — the relief cut off at the edge — is a step, and fails', () => {
    const own = steepest(block, NO_LAND_CLASS);
    const stepped = steepest(block, steppedHold(block.mask), inMargin);
    expect(stepped).toBeGreaterThan(own);
  });

  it('reaches as far as the relief can be tall: the hold is the relief’s own cap at the reach', () => {
    expect(RELIEF_SLOPE * LEVELLING_REACH_METRES).toBeGreaterThanOrEqual(RELIEF_MAX_METRES);
  });

  it('measures the distance to the town across a chunk’s edge, within the chamfer’s 8 %', () => {
    // The block's edge 40 m out sits in one 320 m chunk; points 100 m further
    // out cross into the next on the level fixture's side.
    const frame = drawnRoadFrame(block.profile, block.origin, 1_150);
    if (frame === undefined) throw new Error('no road frame');
    for (const out of [0, 20, 60, 120, 200]) {
      const lateral = BLOCK_FAR_METRES + out;
      const distance = builtUpDistance(
        block.mask,
        frame.x + frame.normalX * lateral,
        frame.z + frame.normalZ * lateral,
      );
      expect(distance).toBeGreaterThanOrEqual(Math.max(0, out - 5));
      expect(distance).toBeLessThanOrEqual(out * 1.08 + 5);
    }
  });
});

/** FNV-1a over a lent mesh's four arrays, as bytes. */
function digest(mesh: TerrainMesh): string {
  let hash = 0x81_1c_9d_c5;
  for (const array of [mesh.vertices, mesh.normals, mesh.colours, mesh.fields]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
    }
  }
  return hash.toString(16);
}

/** Every fixture in `route-fixtures-testing.ts`, at three odometer readings. */
function everyFixtureDigest(land: LandClassMask): string[] {
  const fixtures: readonly (readonly [string, RouteProfile])[] = [
    ['north', northRoute(3_000, () => 10)],
    ['hill', hillRoute()],
    ['valley', valleyRoute()],
    ['lake valley', lakeValleyRoute()],
    ['rolling', rollingRoute()],
    ['steady climb', steadyClimb()],
    ['circuit', circuitRoute(400)],
    ['hairpin', hairpinRoute(40)],
    ['planner', plannerRoute()],
  ];
  const out: string[] = [];
  for (const [name, profile] of fixtures) {
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    for (const odometer of [0, 650, 1_200]) {
      const corridor = roadCorridor(profile, origin, odometer);
      out.push(
        `${name} ${String(odometer)} ${digest(terrainCorridor(profile, origin, corridor, seed, land))}`,
      );
    }
  }
  return out;
}

describe('unchanged where nothing is mapped — #1547', () => {
  it('builds main’s ground to the bit with NO_LAND_CLASS, on every fixture', () => {
    // ⚠️ Taken on `main` at 515a2b5c, before a line of #1547: `landform.ts`
    // there, with this file's own fixtures and digest. A digest taken after
    // the change would describe it rather than guard against it.
    expect(everyFixtureDigest(NO_LAND_CLASS)).toStrictEqual(MAIN_DIGESTS);
  });

  it('builds the same with a mask that maps land but no built-up land', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const wood: WorldCorridor = {
      routeId: 'levelling-wood',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -2_000, maxX: 2_000, minZ: -2_000, maxZ: 5_000 }],
      landUse: [
        {
          layer: 'landuse',
          kind: 'wood',
          rings: [Float32Array.of(40, 900, 200, 900, 200, 1_300, 40, 1_300)],
        },
      ],
      buildings: [],
      paths: [],
    };
    const mask = landClassMask(wood);
    expect(mask.bytes).toBeGreaterThan(0);
    expect(mask.levellingBytes).toBe(0);
    expect(everyFixtureDigest(mask)).toStrictEqual(MAIN_DIGESTS);
  });
});

describe('allocation-free per build, and within its time — #1547, #469', () => {
  // The 50 km fixture the issue's budget is stated on, with a town beside the
  // road where the frames are built.
  const block = blockBeside(
    northRoute(50_000, () => 10),
    900,
    1_300,
  );
  const corridors = [700, 800, 900, 1_000].map((odometer) =>
    roadCorridor(block.profile, block.origin, odometer),
  );
  const builds = (land: LandClassMask, count: number): number => {
    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      const corridor = corridors[index % corridors.length] as RoadCorridor;
      terrainCorridor(block.profile, block.origin, corridor, block.seed, land);
    }
    return (performance.now() - started) / count;
  };
  /** Heap growth a build, over 50 builds with no collection in the window. */
  const heapPerBuild = (land: LandClassMask): number => {
    builds(land, 300);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      builds(land, 50);
      const after = getHeapStatistics().used_heap_size;
      if (profiler.stop().statistics.length > 0) continue;
      return (after - before) / 50;
    }
    throw new Error('a collection fell inside every window');
  };

  it('allocates no more a build with the town levelled than with nothing mapped', () => {
    // ⚠️ A build allocates already — about 220 KB of small objects, measured
    // on main — and that is not this issue's. What #1547 may not do is add to
    // it: one distance read a vertex, into the lent arrays, and nothing kept.
    const unlevelled = heapPerBuild(NO_LAND_CLASS);
    const levelled = heapPerBuild(block.mask);
    expect(levelled).toBeLessThan(unlevelled + 4 * 1024);
  });

  it('lends the same four arrays with the town levelled', () => {
    const first = terrainCorridor(
      block.profile,
      block.origin,
      corridors[0] as RoadCorridor,
      block.seed,
      block.mask,
    );
    const vertices = first.vertices;
    const second = terrainCorridor(
      block.profile,
      block.origin,
      corridors[1] as RoadCorridor,
      block.seed,
      block.mask,
    );
    expect(second.vertices).toBe(vertices);
  });

  it('costs little against the 0.3 ms a build the issue allows, on the 50 km fixture', () => {
    // Relative to the same build with nothing mapped, as `land-class.test.ts`
    // times its own: coverage instrumentation slows both alike. Measured at
    // 0.16 against 0.12 ms in Node on the development machine.
    builds(block.mask, 300);
    builds(NO_LAND_CLASS, 300);
    const levelled = Math.min(builds(block.mask, 200), builds(block.mask, 200));
    const unlevelled = Math.min(builds(NO_LAND_CLASS, 200), builds(NO_LAND_CLASS, 200));
    expect(levelled).toBeLessThan(unlevelled * 3);
  });
});

describe('the road is not the ground — #1547', () => {
  it('builds the same road, and reads the same grades, with the levelling on and off', () => {
    // The ground is built FROM the corridor and writes nothing back to it or
    // to the profile; `trainer-wiring.test.tsx` holds the grades a trainer is
    // sent to the same, through `GameView`.
    const block = blockBeside(steadyClimb(), 1_000, 1_300);
    const corridor = roadCorridor(block.profile, block.origin, 1_000);
    const before = JSON.stringify(corridor.centre);
    terrainCorridor(block.profile, block.origin, corridor, block.seed, block.mask);
    expect(JSON.stringify(corridor.centre)).toBe(before);
  });
});

describe('water is not raised — #1547', () => {
  it('still cuts a stream’s bed through a mapped town on the valley fixture', () => {
    const profile = valleyRoute();
    const ways = waterways(profile, scatterSeed(profile));
    const crossing = ways.crossings[0]?.distance;
    if (crossing === undefined) throw new Error('the valley fixture has no stream');
    const block = blockBeside(profile, crossing - 120, crossing + 120);
    let cut = 0;
    let checked = 0;
    for (const odometer of [crossing - 200, crossing - 60]) {
      const corridor = roadCorridor(profile, block.origin, odometer);
      const mesh = terrainCorridor(profile, block.origin, corridor, block.seed, block.mask);
      for (let row = 0; row < mesh.rows; row += 1) {
        const point = corridor.centre[row];
        if (point === undefined || !waterNearRoute(ways, profile, point.distance)) continue;
        for (let column = 0; column < COLUMNS; column += 1) {
          const [x, height, z] = vertex(mesh, row, 0, column);
          if (block.mask.classAt(x as number, z as number) !== 'built-up') continue;
          // The lateral the vertex stands at: its distance from the centreline.
          const lateral = Math.hypot((x as number) - point.x, (z as number) - point.z);
          const { ceiling } = waterShaping(
            ways,
            profile,
            block.origin,
            point.distance,
            lateral,
            point.y,
          );
          checked += 1;
          expect(height as number).toBeLessThanOrEqual(ceiling + 1e-3);
          if (ceiling < point.y - VERGE_DROP_METRES - 0.5) cut += 1;
        }
      }
    }
    // Non-vacuity: the stream does run through the town, below the level it is held to.
    expect(checked).toBeGreaterThan(20);
    expect(cut).toBeGreaterThan(0);
  });
});

/** @see 'builds main’s ground to the bit with NO_LAND_CLASS, on every fixture' */
const MAIN_DIGESTS: readonly string[] = [
  'north 0 abac8513',
  'north 650 f6854389',
  'north 1200 c2f07fbf',
  'hill 0 fca0a47',
  'hill 650 4559957a',
  'hill 1200 d2d5e159',
  'valley 0 9ae048f3',
  'valley 650 3f64931e',
  'valley 1200 b629a4b0',
  'lake valley 0 d324659c',
  'lake valley 650 9ff33873',
  'lake valley 1200 592f4fb1',
  'rolling 0 22687d30',
  'rolling 650 dfe4c9a1',
  'rolling 1200 e9122085',
  'steady climb 0 8cfac12c',
  'steady climb 650 248e737d',
  'steady climb 1200 1627e29d',
  'circuit 0 f110d38a',
  'circuit 650 ad448b06',
  'circuit 1200 76ca3877',
  'hairpin 0 e8d96393',
  'hairpin 650 9a0efc7',
  'hairpin 1200 e55a5825',
  'planner 0 61325c60',
  'planner 650 4d982d35',
  'planner 1200 490487f8',
];
