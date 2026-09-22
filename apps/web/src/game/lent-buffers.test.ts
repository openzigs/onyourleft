// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride loop reuses the ground's and the water's buffers — #469.
 *
 * Every frame of a ride used to allocate four arrays for the ground, three
 * JavaScript arrays and three typed arrays for the water, and a string a
 * structure to de-duplicate the buildings. On a phone, per-frame garbage is a
 * periodic GC pause, which reads as the stutter #323 fixed from the other side.
 *
 * What is pinned here is **identity**: two consecutive frames hand back the
 * same storage. A later change that goes back to allocating turns these red,
 * which a timing assertion never could — the allocation is cheap, it is the
 * collection a few seconds later that costs, and nothing a test can time.
 *
 * And the other half, which is what makes lending safe at all: a caller that
 * holds a frame across another build is told so, loudly, rather than drawing
 * the newer build's ground under the older frame's road.
 */

import { describe, expect, it, vi } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import { retainedFrame } from './frame-testing';
import {
  TERRAIN_COLUMN_OFFSETS,
  terrainCorridor,
  terrainMeshIsCurrent,
  type TerrainMesh,
} from './landform';
import type { SceneFrame } from './port';
import { hillRoute, lakeValleyRoute, rollingRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, roadCorridor, type RoadCorridor } from './terrain';
import { TerrainBelt, WaterBelt } from './three-renderer';
import { waterSurface, waterSurfaceIsCurrent, waterways, type WaterSurface } from './waterways';
import { worldStyle } from './world';

function riding(profile: RouteProfile, odometer: number): SceneFrame {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
  });
}

/** A lake beside the road at both readings: the water has something to lend. */
const LAKESIDE_METRES = 1_100;

describe('two consecutive frames share their storage — #469', () => {
  it('lends the ground the same four arrays, frame after frame', () => {
    const profile = hillRoute();
    const first = riding(profile, 500).terrain.mesh;
    const { vertices, normals, colours, fields } = first;
    const second = riding(profile, 500.2).terrain.mesh;
    expect(second.vertices).toBe(vertices);
    expect(second.normals).toBe(normals);
    expect(second.colours).toBe(colours);
    expect(second.fields).toBe(fields);
    // Non-vacuity: the rider moved, and the SAME array now holds the new ground.
    expect(second.lease).not.toBe(first.lease);
  });

  it('keeps lending the same ground over a whole climb and descent, not only for two frames', () => {
    // The storage is sized to the corridor's row count, so a row count that
    // wavered between frames would reallocate on every change. Ten seconds of
    // riding at 9 m/s and 60 fps, over the climb, the crest and the descent.
    const profile = hillRoute();
    const lent = riding(profile, 300).terrain.mesh.vertices;
    let reallocated = 0;
    for (let frame = 1; frame <= 600; frame += 1) {
      if (riding(profile, 300 + frame * 0.15).terrain.mesh.vertices !== lent) reallocated += 1;
    }
    expect(reallocated).toBe(0);
  });

  it('lends the water views of the same storage, frame after frame', () => {
    const profile = lakeValleyRoute();
    const first = riding(profile, LAKESIDE_METRES).water.surface;
    // Non-vacuity: there is water here, so there was something to allocate.
    expect(first.indices.length).toBeGreaterThan(0);
    const buffers = [first.vertices.buffer, first.shore.buffer, first.indices.buffer];
    const second = riding(profile, LAKESIDE_METRES + 0.2).water.surface;
    expect(second.indices.length).toBeGreaterThan(0);
    // `toBe`, one at a time: `toEqual` on two buffers compares their bytes.
    for (const [index, buffer] of [
      second.vertices.buffer,
      second.shore.buffer,
      second.indices.buffer,
    ].entries()) {
      expect(buffer).toBe(buffers[index]);
    }
  });
});

describe('a frame held across another build — #469', () => {
  it('is refused by the renderer rather than drawn with the newer ground', () => {
    const profile = hillRoute();
    const older = riding(profile, 400);
    const newer = riding(profile, 900);
    expect(terrainMeshIsCurrent(older.terrain.mesh)).toBe(false);
    expect(terrainMeshIsCurrent(newer.terrain.mesh)).toBe(true);
    const belt = new TerrainBelt();
    expect(() => {
      belt.update(older.terrain.mesh, 0x557744);
    }).toThrow(/retainedFrame/);
    expect(() => {
      belt.update(newer.terrain.mesh, 0x557744);
    }).not.toThrow();
  });

  it('is refused for its water too', () => {
    const profile = lakeValleyRoute();
    const older = riding(profile, LAKESIDE_METRES);
    const newer = riding(profile, LAKESIDE_METRES + 50);
    expect(waterSurfaceIsCurrent(older.water.surface)).toBe(false);
    const belt = new WaterBelt();
    expect(() => {
      belt.update(older.water.surface, worldStyle(profile), 0);
    }).toThrow(/retainedFrame/);
    expect(() => {
      belt.update(newer.water.surface, worldStyle(profile), 0);
    }).not.toThrow();
  });

  it('keeps its own ground and water once retained, whatever is built after it', () => {
    const profile = lakeValleyRoute();
    const built = riding(profile, LAKESIDE_METRES);
    const kept = retainedFrame(built);
    const heights = Array.from(built.terrain.mesh.vertices);
    const water = Array.from(built.water.surface.vertices);
    riding(profile, LAKESIDE_METRES + 300);
    // The borrowed arrays now hold the later frame…
    expect(Array.from(built.terrain.mesh.vertices)).not.toEqual(heights);
    // …and the retained copy still holds this one, and draws.
    expect(Array.from(kept.terrain.mesh.vertices)).toEqual(heights);
    expect(Array.from(kept.water.surface.vertices)).toEqual(water);
    expect(terrainMeshIsCurrent(kept.terrain.mesh)).toBe(true);
    expect(waterSurfaceIsCurrent(kept.water.surface)).toBe(true);
    expect(() => {
      new TerrainBelt().update(kept.terrain.mesh, 0x557744);
      new WaterBelt().update(kept.water.surface, worldStyle(profile), 0);
    }).not.toThrow();
  });
});

describe('a lent array carries nothing over from the frame before — #469', () => {
  it('writes every component of a collapsed cross-section’s normal, not only the one that is not zero', () => {
    // Behind the start of a point-to-point route every row is the same point,
    // and the ground there faces straight up. A fresh array was zero where the
    // builder wrote nothing; a lent one holds the last frame's hillside.
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const hillside = terrainCorridor(profile, origin, roadCorridor(profile, origin, 500), seed);
    let tilted = 0;
    for (let at = 0; at < hillside.normals.length; at += 3) {
      if (Math.abs(hillside.normals[at] as number) > 1e-3) tilted += 1;
    }
    // Non-vacuity: the array about to be lent again is full of sideways normals.
    expect(tilted).toBeGreaterThan(100);
    const start = terrainCorridor(profile, origin, roadCorridor(profile, origin, 0), seed);
    expect(start.normals).toBe(hillside.normals);
    // The first row is 60 m behind the start line: collapsed onto it.
    const perRow = start.vertices.length / 3 / start.rows;
    for (let vertex = 0; vertex < perRow; vertex += 1) {
      expect([
        start.normals[vertex * 3],
        start.normals[vertex * 3 + 1],
        start.normals[vertex * 3 + 2],
      ]).toEqual([0, 1, 0]);
    }
  });
});

/**
 * #472's review, finding 1: every "reuse while the size holds, reallocate when
 * it changes" path, taken in BOTH directions.
 *
 * The tests above only ever build one size, so a size check that always reused
 * stayed green across the whole game suite while a 47-row ground came back in a
 * 17-row array: 1 326 floats where 2 256 are needed, and a typed array drops an
 * out-of-bounds write without a word. The product takes this branch on a second
 * ride over a route with a different `profile.resolution`.
 *
 * The reference is a build in a FRESH copy of the module (`vi.resetModules`),
 * whose storage nothing has lent before — so "what a lent build draws" is
 * compared with "what an owned one would", not with itself.
 */
/** Well inside `lakeValleyRoute`'s one lake, which runs from about 1 329 m to 1 668 m. */
const MID_LAKE_METRES = 1_500;

describe('the lent storage when the size changes — #472', () => {
  /** A fresh copy of the two builders, holding no storage from any earlier build. */
  async function freshBuilders(): Promise<{
    readonly landform: typeof import('./landform');
    readonly waterways: typeof import('./waterways');
  }> {
    vi.resetModules();
    return { landform: await import('./landform'), waterways: await import('./waterways') };
  }

  function groundOf(mesh: TerrainMesh): Record<string, number[] | number> {
    return {
      rows: mesh.rows,
      vertices: Array.from(mesh.vertices),
      normals: Array.from(mesh.normals),
      colours: Array.from(mesh.colours),
      fields: Array.from(mesh.fields),
      indices: Array.from(mesh.indices),
    };
  }

  function waterOf(surface: WaterSurface): {
    readonly vertices: number[];
    readonly shore: number[];
    readonly indices: number[];
  } {
    return {
      vertices: Array.from(surface.vertices),
      shore: Array.from(surface.shore),
      indices: Array.from(surface.indices),
    };
  }

  it('reallocates the ground when the row count grows and when it shrinks, and draws what an owned build would', async () => {
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const short = roadCorridor(profile, origin, 500, { aheadMetres: 100 });
    const long = roadCorridor(profile, origin, 500);
    // Non-vacuity: two different row counts, the smaller first.
    expect(short.centre.length).toBeLessThan(long.centre.length);

    // The reference: each size built in its OWN fresh module, so each is a
    // first allocation and nothing a mutation does to reuse can reach it.
    const owned = async (corridor: RoadCorridor): Promise<Record<string, number[] | number>> =>
      groundOf((await freshBuilders()).landform.terrainCorridor(profile, origin, corridor, seed));
    const expectedShort = await owned(short);
    const expectedLong = await owned(long);

    // Small, then large, then small again, in a module whose storage starts
    // empty — so the first change is smaller→larger whatever ran before it.
    const { landform } = await freshBuilders();
    const floatsPerRow = TERRAIN_COLUMN_OFFSETS.length * 2 * 3;
    for (const [corridor, expected] of [
      [short, expectedShort],
      [long, expectedLong],
      [short, expectedShort],
    ] as const) {
      const built = landform.terrainCorridor(profile, origin, corridor, seed);
      expect(built.rows).toBe(corridor.centre.length);
      expect(built.vertices.length).toBe(built.rows * floatsPerRow);
      expect(built.vertices.every(Number.isFinite)).toBe(true);
      expect(built.normals.every(Number.isFinite)).toBe(true);
      expect(groundOf(built)).toEqual(expected);
    }

    // And the lease across the change, through the module the renderer reads.
    const belt = new TerrainBelt();
    for (const [before, after] of [
      [short, long],
      [long, short],
    ] as const) {
      const held = terrainCorridor(profile, origin, before, seed);
      const built = terrainCorridor(profile, origin, after, seed);
      expect(terrainMeshIsCurrent(held)).toBe(false);
      expect(() => {
        belt.update(held, 0x557744);
      }).toThrow(/retainedFrame/);
      expect(() => {
        belt.update(built, 0x557744);
      }).not.toThrow();
    }
  });

  /**
   * Two ways the water grows while it is being written, and each loses
   * something different if the growth forgets what was already there.
   */
  interface CorridorAt {
    readonly at: number;
    readonly aheadMetres?: number;
    readonly behindMetres?: number;
  }
  const WATER_GROWTH: readonly {
    readonly name: string;
    readonly route: () => RouteProfile;
    readonly short: CorridorAt;
    readonly long: CorridorAt;
  }[] = [
    {
      // One strip whose VERTICES outgrow the first allocation half-way along:
      // 9 vertices and 24 indices at three rows, inside the first 64 and 256;
      // 69 and 264 for the whole corridor, which are not.
      name: 'a lake, whose one strip outgrows the storage half-way along it',
      route: lakeValleyRoute,
      short: { at: MID_LAKE_METRES, aheadMetres: 10, behindMetres: 10 },
      long: { at: MID_LAKE_METRES },
    },
    {
      // Two streams: the first strip's 216 indices fit the first 256, and the
      // second's take it to 432 — so the INDICES grow between strips, with the
      // first strip's already written.
      name: 'two streams, the second of which outgrows what the first left',
      route: rollingRoute,
      short: { at: 449, aheadMetres: 10, behindMetres: 10 },
      long: { at: 750, aheadMetres: 400, behindMetres: 400 },
    },
  ];

  it.each(WATER_GROWTH)(
    'grows the water mid-build without losing what it had written, and shrinks back: $name',
    async ({ route, short: shortAt, long: longAt }) => {
      const profile = route();
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      const short = roadCorridor(profile, origin, shortAt.at, shortAt);
      const long = roadCorridor(profile, origin, longAt.at, longAt);

      // The reference: storage already large enough for both, so neither build
      // grows anything. The first build is only there to size it.
      const sized = await freshBuilders();
      const sizedWays = sized.waterways.waterways(profile, seed);
      sized.waterways.waterSurface(profile, origin, long, sizedWays);
      const expectedLong = waterOf(sized.waterways.waterSurface(profile, origin, long, sizedWays));
      const expectedShort = waterOf(
        sized.waterways.waterSurface(profile, origin, short, sizedWays),
      );
      // Non-vacuity: there is water at both sizes, and more at one.
      expect(expectedShort.indices.length).toBeGreaterThan(0);
      expect(expectedLong.indices.length).toBeGreaterThan(expectedShort.indices.length);

      // Small, then large, then small again, in storage that starts empty — so
      // the large build has to grow in the middle of writing it.
      const growing = await freshBuilders();
      const growingWays = growing.waterways.waterways(profile, seed);
      const first = growing.waterways.waterSurface(profile, origin, short, growingWays);
      expect(waterOf(first)).toEqual(expectedShort);
      const smallBuffers = [first.vertices.buffer, first.indices.buffer];
      const grown = growing.waterways.waterSurface(profile, origin, long, growingWays);
      // Non-vacuity: it did grow.
      expect([grown.vertices.buffer, grown.indices.buffer]).not.toContain(smallBuffers[0]);
      expect([grown.vertices.buffer, grown.indices.buffer]).not.toContain(smallBuffers[1]);
      expect(waterOf(grown)).toEqual(expectedLong);
      const shrunk = growing.waterways.waterSurface(profile, origin, short, growingWays);
      expect(shrunk.indices.buffer).toBe(grown.indices.buffer);
      expect(waterOf(shrunk)).toEqual(expectedShort);

      // And the lease across the change, through the module the renderer reads.
      const ways = waterways(profile, seed);
      const belt = new WaterBelt();
      const world = worldStyle(profile);
      for (const [before, after] of [
        [short, long],
        [long, short],
      ] as const) {
        const held = waterSurface(profile, origin, before, ways);
        const built = waterSurface(profile, origin, after, ways);
        expect(waterSurfaceIsCurrent(held)).toBe(false);
        expect(() => {
          belt.update(held, world, 0);
        }).toThrow(/retainedFrame/);
        expect(() => {
          belt.update(built, world, 0);
        }).not.toThrow();
      }
    },
  );
});
