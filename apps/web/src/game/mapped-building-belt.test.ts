// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1549's belt, in Node: the materials it is constructed with, the draw calls
 * it submits, what its buffers hold, when it refills, and the structures'
 * term it shares — all arithmetic over three objects that need no GL context.
 * What needs a GPU (that the mesh reaches the screen at the probed pixel) is
 * `game.browser.spec.ts` §"#1549".
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

import { afterEach, describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import {
  BAY_METRES,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  STOREY_METRES,
  footprintPlans,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import { rowTownFixture } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import {
  FAR_ROLES,
  mappedBuildingsOf,
  NEAR_ROLES,
  type MappedBuildings,
  type MappedBuildingsInView,
} from './mapped-buildings';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_TRIANGLES,
  MAPPED_CHUNK_METRES,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_STRUCTURE_SURFACES,
  surfaceRepeat,
} from './realistic-assets';
import type { ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { drawnRoadFrame } from './terrain';
import {
  breathesTheAir,
  isConstructedMaterial,
  MappedBuildingBelt,
  readsInstanceTint,
  readsTextureLodBias,
  readsVertexTint,
  refillMappedBuildings,
  setMappedBuildingsMerged,
} from './three-renderer';

/** A texture three would have loaded: the fields a material and a release read. */
function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

const town = rowTownFixture();
const planned = footprintPlans(
  town.corridor,
  landClassMask(town.corridor),
  town.profile,
  town.origin,
).plans;
const buildings = mappedBuildingsOf(planned);

function roadAt(along: number): { readonly x: number; readonly z: number } {
  const frame = drawnRoadFrame(town.profile, town.origin, along);
  if (frame === undefined) throw new Error('the fixture road has no direction there');
  return { x: frame.x, z: frame.z };
}

/** A frame's view of the mapped buildings at `along`. */
function viewAt(along: number, of: MappedBuildings = buildings): MappedBuildingsInView {
  return { buildings: of, chunk: Math.floor(along / MAPPED_CHUNK_METRES), ...roadAt(along) };
}

const belts: MappedBuildingBelt[] = [];

function aBelt(of: MappedBuildings = buildings): MappedBuildingBelt {
  const belt = new MappedBuildingBelt(of, textures);
  belts.push(belt);
  return belt;
}

afterEach(() => {
  setMappedBuildingsMerged(true);
  for (const belt of belts.splice(0)) belt.dispose();
});

/** A procedural structure, as the scene would carry one. */
function structure(z: number): ScatterItem {
  return { kind: 'building', x: 20, y: 0, z, rotation: 0, scale: 1, variant: 0 };
}

describe('the mapped buildings’ materials — #1549', () => {
  it('wears each surface’s compressed photograph, constructed, in the air, its tint from the vertex', () => {
    const belt = aBelt();
    for (const surface of FOOTPRINT_SURFACES) {
      const material = belt.materialOf(surface);
      expect(material?.type, surface).toBe('MeshStandardMaterial');
      const maps = textures.get(surface as never);
      expect(material?.map, surface).toBe(maps?.colour);
      expect(material?.normalMap, surface).toBe(maps?.normal);
      expect(material?.vertexColors, surface).toBe(true);
      expect(isConstructedMaterial(material as never), surface).toBe(true);
      expect(breathesTheAir(material as never), surface).toBe(true);
      expect(readsTextureLodBias(material as never), surface).toBe(true);
      expect(readsVertexTint(material as never), surface).toBe(true);
      // There is no instance to read a tint from.
      expect(readsInstanceTint(material as never), surface).toBe(false);
    }
  });

  it('splices the tint into three’s program from the vertex attribute it fills', () => {
    const belt = aBelt();
    const material = belt.materialOf('brick');
    // The includes `realistic-renderer.test.ts` §`compiledBoth` hands a lit material.
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float oylTint;');
    expect(shader.vertexShader).toContain('vOylTint = oylTintOf(oylTint);');
    expect(shader.fragmentShader).toContain('oylTinted(diffuseColor.rgb, vOylTint)');
    expect(belt.mesh.geometry.getAttribute('oylTint').itemSize).toBe(1);
  });
});

describe('at most six draw calls for any number of mapped buildings — #1549', () => {
  it('is one mesh with at most six groups, with 10 and with 240 buildings in reach', () => {
    const rider = viewAt(1_500);
    const belt = aBelt();
    for (const count of [10, MAPPED_BUILDING_MAX]) {
      // The nearest `count`: a budget that fits exactly them.
      const nearest = [...planned]
        .sort(
          (a, b) =>
            Math.hypot(a.centroid.x - rider.x, a.centroid.z - rider.z) -
            Math.hypot(b.centroid.x - rider.x, b.centroid.z - rider.z),
        )
        .slice(0, count);
      const budget = nearest.reduce(
        (sum, plan) =>
          sum +
          (Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z) >
          MAPPED_BUILDING_NEAR_METRES
            ? plan.farTriangleCount
            : plan.triangleCount),
        0,
      );
      const stats = belt.refill(rider.x, rider.z, budget);
      expect(stats.buildings).toBe(count);
      expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
      expect(belt.mesh.geometry.groups).toHaveLength(stats.drawCalls);
      expect(stats.drawCalls).toBeGreaterThan(1);
      expect(belt.mesh.visible).toBe(true);
    }
    // THE CONTROL: a group a building and surface — a mesh a building —
    // submits far more with 240.
    setMappedBuildingsMerged(false);
    const unmerged = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(unmerged.buildings).toBe(MAPPED_BUILDING_MAX);
    expect(unmerged.drawCalls).toBeGreaterThan(MAPPED_BUILDING_DRAW_CALLS);
  });

  it('draws nothing, and submits nothing, with nothing in reach', () => {
    const belt = aBelt();
    const stats = belt.refill(1e6, 1e6, MAPPED_BUILDING_TRIANGLES);
    expect(stats.buildings).toBe(0);
    expect(stats.drawCalls).toBe(0);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.mesh.geometry.drawRange.count).toBe(0);
  });
});

describe('what the buffers hold — #1549', () => {
  /** A plan's floats for `roles`, one after the other. */
  const floatsOf = (plan: FootprintPlan, roles: readonly FootprintRole[]): number[] =>
    roles.flatMap((role) => Array.from(plan.triangles[role]));

  it('holds each drawn building’s triangles at its level, nearest first, read back by position', () => {
    const rider = viewAt(1_500);
    const belt = aBelt();
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.buildings).toBe(MAPPED_BUILDING_MAX);
    expect(stats.far).toBeGreaterThan(0);
    expect(stats.near).toBeGreaterThan(0);
    const position = belt.mesh.geometry.getAttribute('position');
    expect(belt.mesh.geometry.drawRange.count).toBe(stats.triangles * 3);
    let previous = 0;
    let checked = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      const plan = planned[drawn.plan] as FootprintPlan;
      const distance = Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z);
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
      expect(drawn.far).toBe(distance > MAPPED_BUILDING_NEAR_METRES);
      const roles = drawn.far ? FAR_ROLES : NEAR_ROLES;
      const walls = floatsOf(
        plan,
        roles.filter((role) => role !== 'roof'),
      );
      const roof = floatsOf(plan, ['roof']);
      const read = (from: number, floats: readonly number[]): void => {
        for (let vertex = 0; vertex < floats.length / FOOTPRINT_VERTEX_FLOATS; vertex += 1) {
          const at = from + vertex;
          const source = vertex * FOOTPRINT_VERTEX_FLOATS;
          expect(position.getX(at)).toBe(floats[source]);
          expect(position.getY(at)).toBe(floats[source + 1]);
          expect(position.getZ(at)).toBe(floats[source + 2]);
          checked += 1;
        }
      };
      read(drawn.wallAt, walls);
      read(drawn.roofAt, roof);
      // The far level leaves out the plinth, the parapet and the door.
      const vertices = (walls.length + roof.length) / FOOTPRINT_VERTEX_FLOATS;
      expect(vertices / 3).toBe(drawn.far ? plan.farTriangleCount : plan.triangleCount);
    }
    expect(checked).toBe(stats.triangles * 3);
    expect(belt.drawnAt(stats.buildings)).toBeUndefined();
  });

  it('carries each building’s seeded tint on every vertex, and lays the photograph at its own size', () => {
    const rider = viewAt(1_500);
    const belt = aBelt();
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const drawn = belt.drawnAt(0);
    const plan = planned[drawn?.plan ?? -1] as FootprintPlan;
    const tint = belt.mesh.geometry.getAttribute('oylTint');
    expect(tint.getX(drawn?.wallAt ?? -1)).toBe(Math.fround(plan.tint));
    expect(tint.getX(drawn?.roofAt ?? -1)).toBe(Math.fround(plan.tint));
    // The photograph at its own size: the plan's bays and storeys back to
    // metres, over the surface's own repeat — so a brick is a brick's size.
    const uv = belt.mesh.geometry.getAttribute('uv');
    const wall = surfaceRepeat(REALISTIC_STRUCTURE_SURFACES[plan.surfaces.wall as never]);
    const roof = surfaceRepeat(REALISTIC_STRUCTURE_SURFACES[plan.surfaces.roof as never]);
    const floats = (role: FootprintRole, vertex: number, at: number): number =>
      plan.triangles[role][vertex * FOOTPRINT_VERTEX_FLOATS + at] as number;
    let spread = 0;
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const at = (drawn?.wallAt ?? 0) + vertex;
      expect(uv.getX(at)).toBeCloseTo((floats('wall', vertex, 6) * BAY_METRES) / wall.across, 5);
      expect(uv.getY(at)).toBeCloseTo((floats('wall', vertex, 7) * STOREY_METRES) / wall.up, 5);
      spread = Math.max(spread, Math.abs(uv.getX(at)));
    }
    expect(spread).toBeGreaterThan(0);
    const roofAt = drawn?.roofAt ?? 0;
    expect(uv.getX(roofAt)).toBeCloseTo((floats('roof', 0, 6) * STOREY_METRES) / roof.across, 5);
    expect(uv.getY(roofAt)).toBeCloseTo((floats('roof', 0, 7) * STOREY_METRES) / roof.up, 5);
  });
});

describe('refilled only at a chunk, and nothing allocated between — #1549, #240 NFR-3', () => {
  it('refills 2 000 / MAPPED_CHUNK_METRES ± 1 times over a 2 km ride, frame by frame', () => {
    const belt = aBelt();
    const start = atStartLine(town.profile);
    const frames = Array.from({ length: 401 }, (_, index) => 500 + index * 5);
    for (const along of frames) {
      const frame = sceneFrame({
        profile: town.profile,
        origin: town.origin,
        state: { ...start, ride: { ...start.ride, distance: metres(along) } },
        mappedBuildings: buildings,
      });
      const view = frame.mappedBuildings;
      if (view === undefined) throw new Error('the frame carries no mapped buildings');
      expect(view.buildings).toBe(buildings);
      refillMappedBuildings(
        belt,
        view,
        frame.scatter,
        frame.billboards.length,
        REALISTIC_STRUCTURE_ITEMS,
      );
    }
    const expected = 2_000 / MAPPED_CHUNK_METRES;
    expect(belt.refills).toBeGreaterThanOrEqual(expected - 1);
    expect(belt.refills).toBeLessThanOrEqual(expected + 1);
    // Non-vacuity: far more frames than refills.
    expect(frames.length).toBeGreaterThan(10 * belt.refills);
    // And a new rung refills at once, whatever the chunk.
    const last = viewAt(2_500);
    const before = belt.refills;
    belt.invalidate();
    refillMappedBuildings(belt, last, [], 0, REALISTIC_STRUCTURE_ITEMS);
    expect(belt.refills).toBe(before + 1);
  });

  it('allocates nothing on a frame that is not a refill', () => {
    const belt = aBelt();
    const view = viewAt(1_500);
    const scatter = [structure(1_490), structure(1_510)];
    refillMappedBuildings(belt, view, scatter, 0, REALISTIC_STRUCTURE_ITEMS);
    let sink = 0;
    const frames = (count: number): void => {
      for (let at = 0; at < count; at += 1) {
        if (
          refillMappedBuildings(belt, view, scatter, 0, REALISTIC_STRUCTURE_ITEMS) === undefined
        ) {
          sink += 1;
        }
      }
    };
    frames(200_000);
    const attempts: string[] = [];
    let measured = false;
    for (let attempt = 0; attempt < 8 && !measured; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      frames(100_000);
      const after = getHeapStatistics().used_heap_size;
      const { statistics } = profiler.stop();
      if (statistics.length > 0) {
        attempts.push('collected');
        continue;
      }
      measured = true;
      expect(after - before).toBeLessThan(64 * 1024);
    }
    expect(measured, attempts.join(', ')).toBe(true);
    expect(belt.refills).toBe(1);
    expect(sink).toBeGreaterThan(0);
  });
});

describe('the share of the structures’ term a refill takes — #1549, P-12', () => {
  it('counts a billboard as a structure, and a rung’s fewer structures as less room', () => {
    const view = viewAt(1_500);
    // Billboards fill every structure slot: no room for a mapped building.
    const full = aBelt();
    refillMappedBuildings(full, view, [], REALISTIC_STRUCTURE_ITEMS, REALISTIC_STRUCTURE_ITEMS);
    expect(full.stats.buildings).toBe(0);
    // A rung of one structure leaves one structure's triangles, and no more.
    const one = aBelt();
    const cap = refillMappedBuildings(one, view, [], 0, 1);
    expect(one.stats.buildings).toBeGreaterThan(0);
    expect(one.stats.triangles).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
    // …and the procedural structures keep to what is left of that one: none.
    expect(cap).toBe(0);
    // A rung over the realistic term is held to it.
    const over = aBelt();
    refillMappedBuildings(over, view, [], 0, 10 * REALISTIC_STRUCTURE_ITEMS);
    expect(over.stats.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
  });
});
