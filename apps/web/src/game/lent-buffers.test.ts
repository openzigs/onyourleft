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

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import { retainedFrame } from './frame-testing';
import { terrainCorridor, terrainMeshIsCurrent } from './landform';
import type { SceneFrame } from './port';
import { hillRoute, lakeValleyRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, roadCorridor } from './terrain';
import { TerrainBelt, WaterBelt } from './three-renderer';
import { waterSurfaceIsCurrent } from './waterways';
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
