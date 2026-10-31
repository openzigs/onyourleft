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
  DOOR_PAINTS,
  ROOF_PAINTS,
  SHINGLE_PAINTS,
  TRIM_PAINTS,
  WALL_PAINTS,
} from './building-paint';
import { FOUNDATION_METRES } from './buildings';
import { FACADE_AO, SASH, SASH_TOP_SHARE, WINDOW_IN_BAY } from './facade';
import {
  BAY_METRES,
  FACADE_FLOATS,
  FACADE_RAILING,
  FOOTPRINT_SURFACES,
  FOOTPRINT_VERTEX_FLOATS,
  ROOF_ROLES,
  STOREY_METRES,
  STYLE_FLOATS,
  STYLE_OFFSET,
  footprintPlans,
  type FootprintPlan,
  type FootprintRole,
} from './footprint-buildings';
import {
  mixedTownFixture,
  richmondStreetFixture,
  rowTownFixture,
} from './footprint-fixtures-testing';
import { HOUSE_MODELS, placedPoint } from './house-models';
import { mappedBuildingCut, nearPyramid, type NearPyramid } from './near-field';
import { FRONT_PORCH } from './porch';
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
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { atStartLine } from './simulation';
import { drawnRoadFrame } from './terrain';
import {
  breathesTheAir,
  GROUNDED_SHADE,
  GROUNDING_METRES,
  isConstructedMaterial,
  laysRoofSnow,
  MappedBuildingBelt,
  readsInstanceTint,
  readsTextureLodBias,
  drawsFacade,
  readsVertexTint,
  refillMappedBuildings,
  ROOF_SNOW,
  setMappedBuildingsMerged,
  WorldLamps,
} from './three-renderer';
import { WREATH_BERRY, WREATH_GREEN } from './decorations';
import { glslFunction } from './glsl-testing';

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

/**
 * What the upload-range test reads off a belt attribute. Written out rather
 * than imported, because `three-seam.test.ts` admits one importer of three.
 */
interface UploadedAttribute {
  readonly itemSize: number;
  readonly updateRanges: readonly { readonly start: number; readonly count: number }[];
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
      // #1581: and draws the windows and the door from its vertices.
      expect(drawsFacade(material as never), surface).toBe(true);
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
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute float oylTint;');
    expect(shader.vertexShader).toContain('vOylTint = oylTintOf(oylTint);');
    expect(shader.fragmentShader).toContain('oylTinted(diffuseColor.rgb, vOylTint)');
    expect(belt.mesh.geometry.getAttribute('oylTint').itemSize).toBe(1);
    // #1581: the facade, from the two attributes the belt fills, read after
    // the tint's varying is declared, and carried on to the finish.
    expect(shader.vertexShader).toContain('attribute vec4 oylFacade;');
    expect(shader.vertexShader).toContain('vOylFacade = oylFacade;');
    expect(shader.vertexShader).toContain('vOylTrim = oylTrim;');
    expect(shader.fragmentShader).toContain('if (oylTop > 0.0)');
    expect(shader.fragmentShader).toContain(`const float oylWinL = ${String(WINDOW_IN_BAY.left)};`);
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(mix(roughnessFactor');
    // Since #1662 a pane is a dielectric, its reflection three's Fresnel's.
    expect(shader.fragmentShader).toContain(
      'metalnessFactor = mix(metalnessFactor, 0.0, oylGlass);',
    );
    expect(shader.fragmentShader).toContain('normal = normalize(mix(normal, nonPerturbedNormal');
    expect(shader.fragmentShader.indexOf('varying vec3 vOylTint;')).toBeLessThan(
      shader.fragmentShader.indexOf('float oylLit'),
    );
    expect(belt.mesh.geometry.getAttribute('oylFacade').itemSize).toBe(FACADE_FLOATS);
    expect(belt.mesh.geometry.getAttribute('oylTrim').itemSize).toBe(3);
    // #1588: the style, from its own attribute, and the sun's direction for the reveal.
    expect(shader.vertexShader).toContain('attribute vec4 oylStyle;');
    expect(shader.vertexShader).toContain('vOylStyle = oylStyle;');
    expect(shader.fragmentShader).toContain('uniform vec3 oylSunWorld;');
    expect(shader.fragmentShader).toContain('if (abs(oylKind - oylClapboard) < 0.5)');
    expect(shader.fragmentShader).toContain(`const float oylSashW = ${String(SASH.width)};`);
    expect(shader.fragmentShader).toContain('normal = normalize(normal + oylTilt');
    // A sash's own top is what the eaves rule tests on a sash wall.
    // Since #1590 a commercial wall's taller window's top is, on its wall.
    expect(shader.fragmentShader).toContain(
      'float oylTopShare = mix(mix(oylWinT, oylCwT, oylComOn), oylSashTop, oylSashOn);',
    );
    expect(shader.fragmentShader).toContain(`const float oylSashTop = ${String(SASH_TOP_SHARE)};`);
    expect(belt.mesh.geometry.getAttribute('oylStyle').itemSize).toBe(STYLE_FLOATS);
    // #1589: a porch's railing, on its own face, its rails and balusters from `porch.ts`' numbers.
    expect(shader.fragmentShader).toContain('} else if (abs(oylTop - oylRailingTop) < 0.5) {');
    expect(shader.fragmentShader).toContain(
      `const float oylRailingTop = ${String(FACADE_RAILING)}.0;`,
    );
    expect(shader.fragmentShader).toContain(
      `const float oylBalusterGap = ${String(FRONT_PORCH.railing.spacing)};`,
    );
    expect(shader.fragmentShader).toContain(
      'diffuseColor.rgb = vColor.rgb * mix(oylRailingGap, 1.0, oylOn);',
    );
  });

  it('reads the sun’s direction from the lamps that light the scene — #1588', () => {
    const belt = aBelt();
    const material = belt.materialOf('render');
    const shader = {
      uniforms: {} as Record<string, { value: { x: number; y: number; z: number } }>,
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    const lamps = new WorldLamps();
    const sun = { x: 0.6, y: 0.64, z: -0.48, direct: 1, ambient: 0.3 };
    lamps.apply(sun);
    const read = shader.uniforms.oylSunWorld?.value;
    const length = Math.hypot(sun.x, sun.y, sun.z);
    expect(read?.x).toBeCloseTo(sun.x / length, 6);
    expect(read?.y).toBeCloseTo(sun.y / length, 6);
    expect(read?.z).toBeCloseTo(sun.z / length, 6);
    lamps.apply({ ...sun, x: -0.6 });
    expect(read?.x).toBeCloseTo(-sun.x / length, 6);
    lamps.dispose();
  });
});

describe('at most six draw calls for any number of mapped buildings — #1549', () => {
  it('is one mesh with at most six groups, with 10 and with 36 buildings in reach', () => {
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
    // submits far more with 36.
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
    // 170 m off the road's side: at D-5.6's 36 the nearest from the road are
    // all within 150 m, and from here they straddle it, so both levels are read.
    const road = viewAt(1_500);
    const rider = { ...road, x: road.x + 170 };
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
        roles.filter((role) => !ROOF_ROLES.has(role)),
      );
      // Since #1588 a dormer's roof wears the roof, after it in the roof's run.
      const roof = floatsOf(
        plan,
        roles.filter((role) => ROOF_ROLES.has(role)),
      );
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

  it('shades each vertex by its role and, on a building with a plinth, by its height above the foundation — #1549', () => {
    // The shades are written out, not read from the renderer: a plinth is
    // darker than the wall it wears the photograph of, and a chimney a
    // little; since #1581 the door and the trim are painted, not shaded; since
    // #1588 a dormer is shaded as its wall and its roof are, and a driveway is
    // painted by the shader.
    const shades: Record<FootprintRole, number> = {
      wall: 1,
      plinth: 0.62,
      roof: 1,
      parapet: 1,
      door: 1,
      chimney: 0.9,
      trim: 1,
      dormer: 1,
      'dormer-roof': 1,
      driveway: 1,
      shopfront: 1,
      // #1589: a porch is painted, and its roof shaded as the roof.
      porch: 1,
      'porch-roof': 1,
      'porch-trim': 1,
    };
    // And the paint, written out too: the wall surface's list on everything
    // but the roof, the door and the trim, which wear their own — and since
    // #1588 a shingled roof's albedo, and none on a driveway or under a
    // clapboard house's foundation, whose colours the shader lays.
    const paintOf = (plan: FootprintPlan, role: FootprintRole): readonly number[] => {
      if (role === 'roof' || role === 'dormer-roof' || role === 'porch-roof') {
        return plan.cladding.roof === 'shingle'
          ? (SHINGLE_PAINTS[plan.paint.roof] ?? [])
          : (ROOF_PAINTS[plan.surfaces.roof]?.[plan.paint.roof] ?? []);
      }
      if (role === 'door') return DOOR_PAINTS[plan.paint.door] ?? [];
      if (role === 'trim' || role === 'porch' || role === 'porch-trim') {
        return TRIM_PAINTS[plan.paint.trim] ?? [];
      }
      if (
        role === 'driveway' ||
        role === 'shopfront' ||
        (role === 'plinth' && plan.cladding.wall === 'clapboard')
      ) {
        return [1, 1, 1];
      }
      return WALL_PAINTS[plan.surfaces.wall]?.[plan.paint.wall] ?? [];
    };
    let painted = 0;
    const rider = viewAt(1_500);
    const belt = aBelt();
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const colour = belt.mesh.geometry.getAttribute('color');
    let grounded = 0;
    let doors = 0;
    let soffits = 0;
    let decks = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      const plan = planned[drawn.plan] as FootprintPlan;
      const standing = plan.triangles.plinth.length > 0;
      const same = plan.surfaces.wall === plan.surfaces.roof;
      let wallCursor = drawn.wallAt;
      let roofCursor = drawn.roofAt;
      for (const role of drawn.far ? FAR_ROLES : NEAR_ROLES) {
        const floats = plan.triangles[role];
        const vertices = floats.length / FOOTPRINT_VERTEX_FLOATS;
        const from = ROOF_ROLES.has(role) && !same ? roofCursor : wallCursor;
        for (let vertex = 0; vertex < vertices; vertex += 1) {
          const y = floats[vertex * FOOTPRINT_VERTEX_FLOATS + 1] as number;
          const rise = Math.min(
            1,
            Math.max(0, (y - (plan.base + FOUNDATION_METRES)) / GROUNDING_METRES),
          );
          // A driveway lies on the ground, and is not grounded.
          const ground =
            standing && role !== 'driveway' ? GROUNDED_SHADE + (1 - GROUNDED_SHADE) * rise : 1;
          // #1588: trim facing down — a soffit, a gutter's underside — is in the eaves' shade;
          // #1589: so is a porch's ceiling, and its deck is in its roof's.
          const facing = floats[vertex * FOOTPRINT_VERTEX_FLOATS + 4] as number;
          const underneath =
            (role === 'trim' ||
              role === 'porch' ||
              role === 'porch-trim' ||
              role === 'shopfront') &&
            facing < -0.5
              ? FACADE_AO.soffit
              : role === 'porch' && facing > 0.5
                ? FACADE_AO.porchFloor
                : 1;
          const paint = paintOf(plan, role);
          for (let channel = 0; channel < 3; channel += 1) {
            expect(colour.array[(from + vertex) * 3 + channel]).toBeCloseTo(
              (paint[channel] as number) * shades[role] * ground * underneath,
              5,
            );
          }
          if (underneath === FACADE_AO.soffit) soffits += 1;
          if (underneath === FACADE_AO.porchFloor) decks += 1;
          if (paint.some((each) => each !== 1)) painted += 1;
          if (standing && rise === 0) grounded += 1;
        }
        if (role === 'door') doors += vertices;
        if (ROOF_ROLES.has(role) && !same) roofCursor += vertices;
        else wallCursor += vertices;
      }
    }
    // Something was checked at the foot of a grounded wall, and at a door.
    expect(grounded).toBeGreaterThan(0);
    expect(doors).toBeGreaterThan(0);
    expect(soffits).toBeGreaterThan(0);
    expect(decks).toBeGreaterThan(0);
    // And the paint is really there: most vertices are not the photograph as it was.
    expect(painted).toBeGreaterThan(0);
  });

  it('lays a driveway in its own light: unpainted, unshaded and not grounded — #1588', () => {
    // #1581's mixed town, whose first half is residential: at 1 100 m its garages are near.
    const mixed = mixedTownFixture();
    const plans = footprintPlans(
      mixed.corridor,
      landClassMask(mixed.corridor),
      mixed.profile,
      mixed.origin,
    ).plans;
    const frame = drawnRoadFrame(mixed.profile, mixed.origin, 1_100);
    if (frame === undefined) throw new Error('the mixed town has no road at 1 100 m');
    const belt = aBelt(mappedBuildingsOf(plans));
    const stats = belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
    const colour = belt.mesh.geometry.getAttribute('color');
    let driveways = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined || drawn.far) continue;
      const plan = plans[drawn.plan] as FootprintPlan;
      if (plan.triangles.driveway.length === 0) continue;
      // The driveway is the last of the wall group's roles: it ends where the next building's starts.
      let at = drawn.wallAt;
      for (const role of NEAR_ROLES) {
        if (ROOF_ROLES.has(role)) continue;
        if (role === 'driveway') break;
        at += plan.triangles[role].length / FOOTPRINT_VERTEX_FLOATS;
      }
      for (
        let vertex = 0;
        vertex < plan.triangles.driveway.length / FOOTPRINT_VERTEX_FLOATS;
        vertex += 1
      ) {
        for (let channel = 0; channel < 3; channel += 1) {
          expect(colour.array[(at + vertex) * 3 + channel]).toBe(1);
        }
      }
      driveways += 1;
    }
    expect(driveways).toBeGreaterThan(0);
  });

  it('uploads only the range a refill wrote, and one that wrote nothing uploads nothing — #1549', () => {
    const belt = aBelt();
    const rider = viewAt(1_500);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const geometry = belt.mesh.geometry;
    for (const name of [
      'position',
      'normal',
      'uv',
      'color',
      'oylTint',
      'oylFacade',
      'oylTrim',
      'oylStyle',
    ]) {
      const attribute = geometry.getAttribute(name) as UploadedAttribute;
      expect(attribute.updateRanges).toEqual([
        { start: 0, count: stats.triangles * 3 * attribute.itemSize },
      ]);
    }
    const empty = belt.refill(rider.x + 1e6, rider.z + 1e6, MAPPED_BUILDING_TRIANGLES);
    expect(empty.buildings).toBe(0);
    for (const name of [
      'position',
      'normal',
      'uv',
      'color',
      'oylTint',
      'oylFacade',
      'oylTrim',
      'oylStyle',
    ]) {
      expect((geometry.getAttribute(name) as UploadedAttribute).updateRanges).toEqual([]);
    }
  });

  it('carries each vertex’s facade and its building’s trim paint, as the plan has them — #1581', () => {
    const rider = viewAt(1_500);
    const belt = aBelt();
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const facade = belt.mesh.geometry.getAttribute('oylFacade');
    const trim = belt.mesh.geometry.getAttribute('oylTrim');
    let windowed = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      const plan = planned[drawn.plan] as FootprintPlan;
      const paint = TRIM_PAINTS[plan.paint.trim] ?? [];
      // The walls are first in their surface's run: read them back from there.
      const walls = plan.triangles.wall;
      for (let vertex = 0; vertex < walls.length / FOOTPRINT_VERTEX_FLOATS; vertex += 1) {
        const at = drawn.wallAt + vertex;
        const from = vertex * FOOTPRINT_VERTEX_FLOATS + 8;
        expect(facade.getX(at)).toBe(walls[from]);
        expect(facade.getY(at)).toBe(walls[from + 1]);
        expect(facade.getZ(at)).toBe(walls[from + 2]);
        expect(facade.getW(at)).toBe(walls[from + 3]);
        if ((walls[from + 2] as number) > 0) windowed += 1;
        expect([trim.getX(at), trim.getY(at), trim.getZ(at)]).toStrictEqual(
          paint.map((channel) => Math.fround(channel)),
        );
      }
    }
    expect(windowed).toBeGreaterThan(0);
  });

  it('carries each vertex’s cladding and windows’ style, as the plan has them — #1588', () => {
    const rider = viewAt(1_500);
    const belt = aBelt();
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const style = belt.mesh.geometry.getAttribute('oylStyle');
    let clad = 0;
    for (let place = 0; place < stats.buildings; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) throw new Error('a drawn building is missing');
      const plan = planned[drawn.plan] as FootprintPlan;
      for (const [role, at] of [
        ['wall', drawn.wallAt],
        ['roof', drawn.roofAt],
      ] as const) {
        const floats = plan.triangles[role];
        for (let vertex = 0; vertex < floats.length / FOOTPRINT_VERTEX_FLOATS; vertex += 1) {
          const from = vertex * FOOTPRINT_VERTEX_FLOATS + STYLE_OFFSET;
          expect(style.getX(at + vertex)).toBe(floats[from]);
          expect(style.getY(at + vertex)).toBe(floats[from + 1]);
          expect(style.getZ(at + vertex)).toBe(floats[from + 2]);
          expect(style.getW(at + vertex)).toBe(floats[from + 3]);
          if ((floats[from] as number) > 0) clad += 1;
        }
      }
    }
    expect(clad).toBeGreaterThan(0);
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

describe('the procedural structures and the mapped buildings, ranked together — #1586', () => {
  const mixed = mixedTownFixture();
  const mixedLand = landClassMask(mixed.corridor);
  const mixedBuildings = mappedBuildingsOf(
    footprintPlans(mixed.corridor, mixedLand, mixed.profile, mixed.origin).plans,
  );

  /** #1581's mixed town with the rider at `along`, as a realistic rung carries it. */
  function mixedFrame(along: number): ReturnType<typeof sceneFrame> {
    const start = atStartLine(mixed.profile);
    return sceneFrame({
      profile: mixed.profile,
      origin: mixed.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(along) } },
      worldCorridor: mixed.corridor,
      landClass: mixedLand,
      mappedBuildings: mixedBuildings,
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
  }

  it('draws the town’s nearest buildings at its edge, the fields beyond filling every structure slot', () => {
    const frame = mixedFrame(1_750);
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('the frame carries no mapped buildings');
    const procedural = frame.scatter.filter((item) =>
      Object.hasOwn(STRUCTURE_FOOTPRINTS, item.kind),
    );
    const billboards = frame.billboards.length;
    // The issue's frame: the procedural structures alone fill the cap…
    expect(procedural.length + billboards).toBeGreaterThanOrEqual(REALISTIC_STRUCTURE_ITEMS);
    // …and the town's nearest building is nearer than most of them: the fields beyond its end.
    const plans = mixedBuildings.plans;
    const away = (x: number, z: number): number => Math.hypot(x - view.x, z - view.z);
    const nearestPlan = plans.reduce(
      (best, plan, index) =>
        away(plan.centroid.x, plan.centroid.z) <
        away((plans[best] as FootprintPlan).centroid.x, (plans[best] as FootprintPlan).centroid.z)
          ? index
          : best,
      0,
    );
    const nearestPlanMetres = away(
      (plans[nearestPlan] as FootprintPlan).centroid.x,
      (plans[nearestPlan] as FootprintPlan).centroid.z,
    );
    const beyond = procedural.filter((item) => away(item.x, item.z) > nearestPlanMetres);
    expect(beyond.length).toBeGreaterThan(procedural.length / 2);

    const belt = aBelt(mixedBuildings);
    const cap = refillMappedBuildings(
      belt,
      view,
      frame.scatter,
      billboards,
      REALISTIC_STRUCTURE_ITEMS,
    );
    // The town is drawn, its nearest building first, read back out of the belt.
    expect(belt.stats.buildings).toBeGreaterThan(0);
    expect(belt.drawnAt(0)?.plan).toBe(nearestPlan);
    // The structure term still holds, the procedural structures within what is left.
    const structure = REALISTIC_TRIANGLES.structure;
    expect(cap).toBeGreaterThan(0);
    expect(((cap ?? 0) + billboards) * structure + belt.stats.triangles).toBeLessThanOrEqual(
      MAPPED_BUILDING_TRIANGLES,
    );

    // THE CONTROL: #1549's rule, procedural structures first, draws no building at all.
    const before = aBelt(mixedBuildings);
    before.refill(
      view.x,
      view.z,
      Math.max(0, REALISTIC_STRUCTURE_ITEMS - procedural.length - billboards) * structure,
      view.chunk,
    );
    expect(before.stats.buildings).toBe(0);
  });

  it('still takes procedural structures nearer than the town before its buildings', () => {
    const frame = mixedFrame(1_750);
    const view = frame.mappedBuildings;
    if (view === undefined) throw new Error('the frame carries no mapped buildings');
    // 36 structures beside the rider, nearer than any house.
    const beside = Array.from({ length: REALISTIC_STRUCTURE_ITEMS }, (): ScatterItem => ({
      kind: 'building',
      x: view.x,
      y: 0,
      z: view.z,
      rotation: 0,
      scale: 1,
      variant: 0,
    }));
    const belt = aBelt(mixedBuildings);
    const cap = refillMappedBuildings(belt, view, beside, 0, REALISTIC_STRUCTURE_ITEMS);
    expect(belt.stats.buildings).toBe(0);
    expect(cap).toBe(REALISTIC_STRUCTURE_ITEMS);
  });

  it('ranks the structures by their distance, not by the frame’s order', () => {
    const view = viewAt(1_500);
    // A rung of one structure; the frame lists one far out first, and one beside the rider last.
    const far = { ...structure(view.z), x: view.x + 5_000 };
    const beside = { ...structure(view.z), x: view.x };
    const belt = aBelt();
    refillMappedBuildings(belt, view, [far, beside], 0, 1);
    // The one beside the rider is nearer than every house, and takes the only slot.
    expect(belt.stats.buildings).toBe(0);
    // THE CONTROL: with only the far one, the houses are nearer and take it.
    const control = aBelt();
    refillMappedBuildings(control, view, [far], 0, 1);
    expect(control.stats.buildings).toBeGreaterThan(0);
  });
});

describe('the house models in the belt — #1585', () => {
  const street = richmondStreetFixture();
  const streetBuildings = mappedBuildingsOf(
    footprintPlans(street.corridor, landClassMask(street.corridor), street.profile, street.origin)
      .plans,
  );
  /** A stand-in model: one triangle a model, its corners where the model's index says. */
  const triangle = (index: number): Float32Array =>
    Float32Array.from([index, 0, 0, index + 1, 2, 0, index, 0, 3]);
  const atlas = aTexture();
  const houses = {
    models: HOUSE_MODELS.map((_, index) => ({
      position: triangle(index),
      // The first corner faces the model's +X, the second its +Z, the third
      // between them, as a sloped roof's does, so the stretch's inverse shows.
      normal: Float32Array.from([1, 0, 0, 0, 0, 1, Math.SQRT1_2, 0, Math.SQRT1_2]),
      uv: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
      triangles: 1,
    })),
    atlas,
    triangles: HOUSE_MODELS.map((model) => model.triangles),
  };
  const frame = drawnRoadFrame(street.profile, street.origin, 1_100);
  if (frame === undefined) throw new Error('the fixture road has no direction there');

  it('writes each modelled building’s model where `house-models.ts` places it, into one call', () => {
    const belt = new MappedBuildingBelt(streetBuildings, textures, houses);
    belts.push(belt);
    const stats = belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.modelled).toBeGreaterThan(0);
    expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    // The stat counts what is drawn: the extrusions' groups and the models' one call.
    expect(stats.drawCalls).toBe(belt.mesh.geometry.groups.length + 1);
    const geometry = belt.modelMesh.geometry;
    expect(geometry.drawRange.count).toBe(stats.modelled * 3);
    const position = geometry.getAttribute('position').array;
    const uv = geometry.getAttribute('uv').array;
    let seen = 0;
    let unevenly = 0;
    for (let place = 0; ; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) break;
      if (drawn.modelAt < 0) continue;
      seen += 1;
      const plan = streetBuildings.plans[drawn.plan];
      const placed = plan?.model;
      if (placed === undefined) throw new Error('a modelled plan has no model');
      const source = triangle(placed.model);
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const want = placedPoint(
          placed,
          source[vertex * 3] as number,
          source[vertex * 3 + 1] as number,
          source[vertex * 3 + 2] as number,
        );
        const at = (drawn.modelAt + vertex) * 3;
        // To a float32's millimetre a kilometre out.
        expect(position[at]).toBeCloseTo(want[0], 3);
        expect(position[at + 1]).toBeCloseTo(want[1], 3);
        expect(position[at + 2]).toBeCloseTo(want[2], 3);
      }
      expect(uv[drawn.modelAt * 2]).toBeCloseTo(0.1, 6);
      // The model's normals turned with it: +X along the plan's long axis
      // toward its front, +Z across it.
      const normal = geometry.getAttribute('normal').array;
      const first = drawn.modelAt * 3;
      expect(normal[first]).toBeCloseTo(placed.ax, 5);
      expect(normal[first + 1]).toBeCloseTo(0, 5);
      expect(normal[first + 2]).toBeCloseTo(placed.az, 5);
      expect(normal[first + 3]).toBeCloseTo(-placed.az, 5);
      expect(normal[first + 5]).toBeCloseTo(placed.ax, 5);
      // A slanted normal goes through the stretch's inverse before it turns.
      const along = Math.SQRT1_2 / placed.stretchX;
      const across = Math.SQRT1_2 / placed.stretchZ;
      const length = Math.hypot(along, across);
      expect(normal[first + 6]).toBeCloseTo((along * placed.ax - across * placed.az) / length, 5);
      expect(normal[first + 8]).toBeCloseTo((along * placed.az + across * placed.ax) / length, 5);
      if (Math.abs(placed.stretchX - placed.stretchZ) > 0.02) unevenly += 1;
    }
    expect(seen).toBe(stats.modelled);
    // Some model is stretched unevenly, or the inverse would go unseen.
    expect(unevenly).toBeGreaterThan(0);
    expect(belt.modelMesh.visible).toBe(true);
    const material = belt.modelMesh.material as unknown as { map: unknown };
    expect(material.map).toBe(atlas);
    expect(readsVertexTint(belt.modelMesh.material as never)).toBe(true);
    expect(breathesTheAir(belt.modelMesh.material as never)).toBe(true);
  });

  it('draws no model, and the extrusions as before, where the models are not loaded', () => {
    const belt = aBelt(streetBuildings);
    const stats = belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.modelled).toBe(0);
    expect(belt.modelMesh.geometry.drawRange.count).toBe(0);
    expect(belt.modelMesh.visible).toBe(false);
    expect(stats.buildings).toBeGreaterThan(0);
  });
});

/**
 * Snow on the roofs, by the route's real season — #1623: the facade's
 * program mixes what faces up toward the roofs' snow by `oylRoofSnow`
 * (`world.ts` §`roofSnowIn`, written by the view each realistic frame), and
 * leaves a wall alone. Evaluated from the program three is handed.
 */
describe('a roof under snow, and a wall without it — #1623', () => {
  const program = (): { fragment: string; uniforms: Record<string, unknown> } => {
    const material = aBelt().materialOf('roof-tiles');
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    return { fragment: shader.fragmentShader, uniforms: shader.uniforms };
  };
  /** sRGB to linear, as three decodes a colour for the shader. */
  const linear = (packed: number): readonly [number, number, number] => {
    const decode = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [decode((packed >> 16) & 0xff), decode((packed >> 8) & 0xff), decode(packed & 0xff)];
  };
  const TILE: readonly [number, number, number] = [0.3, 0.09, 0.05];
  const snowed = (up: number, snow: number): readonly number[] => {
    const drawn = glslFunction(program().fragment, 'oylSnowedRoof')(TILE, up, snow);
    if (typeof drawn === 'number') throw new Error('oylSnowedRoof returned a float');
    return drawn;
  };
  const apart = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot(...a.map((each, at) => each - (b[at] ?? 0)));

  it('splices the snow after the normals, by the surface’s facing, reading the season’s uniform', () => {
    const { fragment, uniforms } = program();
    const at = fragment.indexOf(
      'diffuseColor.rgb = oylSnowedRoof(diffuseColor.rgb, dot(normalize(nonPerturbedNormal)',
    );
    expect(at).toBeGreaterThan(fragment.indexOf('#include <normal_fragment_maps>'));
    expect(fragment).toContain('uniform float oylRoofSnow;');
    expect(uniforms['oylRoofSnow']).toEqual({ value: 0 });
  });

  it('shades a roof’s up-facing fragment toward the snow on a snowy day, and a wall not at all', () => {
    const snow = linear(ROOF_SNOW);
    // A 30° roof, under a full cover.
    const roof = snowed(Math.cos(Math.PI / 6), 1);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(roof[channel]).toBeCloseTo(snow[channel] ?? 0, 5);
    }
    expect(apart(roof, snow)).toBeLessThan(apart(TILE, snow));
    // A wall faces sideways, and a 70° spire sheds it.
    expect(snowed(0, 1)).toEqual(TILE);
    expect(snowed(Math.cos((70 * Math.PI) / 180), 1)).toEqual(TILE);
    // A 50° roof holds some, less than a flat one.
    const steep = snowed(Math.cos((50 * Math.PI) / 180), 1);
    expect(apart(steep, snow)).toBeGreaterThan(apart(snowed(1, 1), snow));
    expect(apart(steep, snow)).toBeLessThan(apart(TILE, snow));
  });

  it('draws every roof exactly as before with no snow — the season-free picture', () => {
    for (const up of [0, 0.5, 0.8, 1]) expect(snowed(up, 0)).toEqual(TILE);
  });
});

/**
 * Snow on the house models' roofs — #1686: #1585's models are not drawn
 * through the facade, so their one material is taught the roofs' snow on its
 * own (`three-renderer.ts` §`withRoofSnow`), the same function by the same
 * uniform as a mapped roof beside them. Evaluated from the program three is
 * handed, as #1623's describe above does for the facade.
 */
describe('a house model’s roof under snow, and its wall without it — #1686', () => {
  const programOf = (
    material: unknown,
  ): { fragment: string; uniforms: Record<string, unknown> } => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    (material as { onBeforeCompile(shader: unknown, renderer: unknown): void }).onBeforeCompile(
      shader,
      undefined,
    );
    return { fragment: shader.fragmentShader, uniforms: shader.uniforms };
  };
  const linear = (packed: number): readonly number[] =>
    [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff].map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  /** An atlas texel of a model's roof, linear. */
  const SHINGLE: readonly [number, number, number] = [0.22, 0.2, 0.19];
  const snowed = (up: number, snow: number): readonly number[] => {
    const drawn = glslFunction(programOf(aBelt().modelMesh.material).fragment, 'oylSnowedRoof')(
      SHINGLE,
      up,
      snow,
    );
    if (typeof drawn === 'number') throw new Error('oylSnowedRoof returned a float');
    return drawn;
  };
  const apart = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot(...a.map((each, at) => each - (b[at] ?? 0)));

  it('is taught the roofs’ snow, after the normals, reading the very uniform a mapped roof reads', () => {
    const belt = aBelt();
    expect(laysRoofSnow(belt.modelMesh.material as never)).toBe(true);
    const model = programOf(belt.modelMesh.material);
    const at = model.fragment.indexOf(
      'diffuseColor.rgb = oylSnowedRoof(diffuseColor.rgb, dot(normalize(nonPerturbedNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), oylRoofSnow);',
    );
    expect(at).toBeGreaterThan(model.fragment.indexOf('#include <normal_fragment_maps>'));
    expect(model.fragment).toContain('uniform float oylRoofSnow;');
    // One uniform, the season's: what the view writes for a mapped roof reaches the models.
    const mapped = programOf(belt.materialOf('roof-tiles'));
    expect(model.uniforms['oylRoofSnow']).toBeDefined();
    expect(model.uniforms['oylRoofSnow']).toBe(mapped.uniforms['oylRoofSnow']);
  });

  it('shades a model roof’s up-facing fragment toward the snow on a snowy day, and a wall not at all', () => {
    const snow = linear(ROOF_SNOW);
    const roof = snowed(Math.cos(Math.PI / 6), 1);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(roof[channel]).toBeCloseTo(snow[channel] ?? 0, 5);
    }
    expect(apart(roof, snow)).toBeLessThan(apart(SHINGLE, snow));
    expect(snowed(0, 1)).toEqual(SHINGLE);
  });

  it('draws every model exactly as before with no snow — the season-free picture', () => {
    for (const up of [0, 0.5, 0.8, 1]) expect(snowed(up, 0)).toEqual(SHINGLE);
  });
});

/**
 * The winter lights' wreath on a mapped front door — #1626: the facade's
 * program draws it on the door's own quad by `oylWreath` (written by the view
 * from the ride's holiday), so it costs no triangle and no call. Evaluated
 * from the program three is handed.
 */
describe('a wreath on a mapped door in the winter lights — #1626', () => {
  const program = (): { fragment: string; uniforms: Record<string, { value: unknown }> } => {
    const material = aBelt().materialOf('brick');
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    material?.onBeforeCompile(shader as never, undefined as never);
    return { fragment: shader.fragmentShader, uniforms: shader.uniforms };
  };
  const DOOR: readonly [number, number, number] = [0.3, 0.2, 0.1];
  const wreathed = (x: number, y: number, on: number): readonly number[] => {
    const drawn = glslFunction(program().fragment, 'oylWreathed')(DOOR, x, y, on);
    if (typeof drawn === 'number') throw new Error('oylWreathed returned a float');
    return drawn;
  };
  const linear = (packed: number): readonly number[] =>
    [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff].map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  const near = (a: readonly number[], b: readonly number[]): void => {
    for (let channel = 0; channel < 3; channel += 1) {
      expect(a[channel]).toBeCloseTo(b[channel] ?? 0, 4);
    }
  };

  it('splices the wreath onto the door’s own quad, reading the season’s uniform and nothing that moves', () => {
    const { fragment, uniforms } = program();
    expect(fragment).toContain('uniform float oylWreath;');
    expect(fragment).toContain(
      'diffuseColor.rgb = oylWreathed(diffuseColor.rgb, (oylAt.x - 0.5) * oylDoorW, oylAt.y * oylDoorH, oylWreath);',
    );
    expect(uniforms['oylWreath']).toEqual({ value: 0 });
    // Steady (WCAG 2.3.1): the wreath's term reads no time, no clock, no sine.
    const start = fragment.indexOf('vec3 oylWreathed(');
    const body = fragment.slice(start, fragment.indexOf('\n  }', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/time|clock|sin\(/i);
  });

  it('draws an evergreen ring and a bow on the door with the winter lights on, and nothing with them off', () => {
    const green = linear(WREATH_GREEN);
    const berry = linear(WREATH_BERRY);
    // On the ring, either side and above.
    near(wreathed(0.195, 1.35, 1), green);
    near(wreathed(-0.195, 1.35, 1), green);
    near(wreathed(0, 1.35 + 0.195, 1), green);
    // The bow under it.
    near(wreathed(0, 1.35 - 0.24, 1), berry);
    // The hole in the middle, and the door away from it, are the door.
    near(wreathed(0, 1.35, 1), DOOR);
    near(wreathed(0.4, 0.5, 1), DOOR);
    // Off: the door everywhere, as before #1626.
    for (const [x, y] of [
      [0.195, 1.35],
      [0, 1.11],
      [0, 1.35],
    ] as const) {
      near(wreathed(x, y, 0), DOOR);
    }
  });
});

describe('a building the near plane would cut is hidden from that frame, and drawn again — #1835', () => {
  /** A near pyramid 5 cm off the middle of a plan's first wall triangle, looking into it. */
  function pyramidInside(plan: FootprintPlan): NearPyramid {
    const floats = plan.triangles.wall;
    const stride = FOOTPRINT_VERTEX_FLOATS;
    const middle = (axis: number): number =>
      ((floats[axis] as number) +
        (floats[stride + axis] as number) +
        (floats[2 * stride + axis] as number)) /
      3;
    const [nx, ny, nz] = [floats[3] as number, floats[4] as number, floats[5] as number];
    const eye = { x: middle(0) + nx * 0.05, y: middle(1) + ny * 0.05, z: middle(2) + nz * 0.05 };
    const target = { x: middle(0) - nx + 0.5, y: middle(1), z: middle(2) - nz + 0.5 };
    return nearPyramid({ eye, target }, 16 / 10);
  }

  type Geometry = MappedBuildingBelt['mesh']['geometry'];

  /** A mesh's positions as drawn, as numbers. */
  const positionsOf = (geometry: Geometry): number[] =>
    Array.from(geometry.getAttribute('position').array).slice(0, geometry.drawRange.count * 3);

  /** Every update range a geometry's attributes hold, by name. */
  const rangesOf = (
    geometry: Geometry,
  ): Record<string, readonly { readonly start: number; readonly count: number }[]> =>
    Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        (attribute as unknown as UploadedAttribute).updateRanges,
      ]),
    );

  /** As three does once it has uploaded what was written. */
  const uploaded = (geometry: Geometry): void => {
    for (const attribute of Object.values(geometry.attributes)) {
      (attribute as unknown as { clearUpdateRanges: () => void }).clearUpdateRanges();
    }
  };

  it('writes the nearest building’s every vertex to one point, uploads only that, and writes it back once the plane lets it go', () => {
    const belt = aBelt();
    const rider = viewAt(1_500);
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const drawn = belt.drawnAt(0);
    if (drawn === undefined) throw new Error('nothing drawn');
    const plan = planned[drawn.plan] as FootprintPlan;
    const pyramid = pyramidInside(plan);
    // Non-vacuity: the pyramid does stand inside the building.
    expect(mappedBuildingCut(plan, buildings.radii[drawn.plan] as number, pyramid)).toBe(true);
    const geometry = belt.mesh.geometry;
    const whole = positionsOf(geometry);
    uploaded(geometry);

    expect(belt.clearOf(pyramid)).toBe(1);
    expect(belt.hiddenAt(0)).toBe(true);
    const roles = drawn.far ? FAR_ROLES : NEAR_ROLES;
    const vertices = (onRoof: boolean): number =>
      roles
        .filter((role) => ROOF_ROLES.has(role) === onRoof)
        .reduce((sum, role) => sum + plan.triangles[role].length / FOOTPRINT_VERTEX_FLOATS, 0);
    const own = new Set<number>();
    for (const [from, count] of [
      [drawn.wallAt, vertices(false)],
      [drawn.roofAt, vertices(true)],
    ] as const) {
      for (let vertex = from; vertex < from + count; vertex += 1) own.add(vertex);
    }
    expect(own.size).toBe(plan.triangleCount * 3);
    // Its own vertices, wall run and roof run, all at one point, which draws
    // no triangle; every other building's as the refill wrote it.
    const hidden = positionsOf(geometry);
    for (let vertex = 0; vertex < hidden.length / 3; vertex += 1) {
      expect(hidden.slice(vertex * 3, vertex * 3 + 3)).toEqual(
        own.has(vertex) ? [0, 0, 0] : whole.slice(vertex * 3, vertex * 3 + 3),
      );
    }
    // Only the positions are uploaded, and only its two runs.
    const ranges = rangesOf(geometry);
    expect(ranges.position).toEqual([
      { start: drawn.wallAt * 3, count: vertices(false) * 3 },
      { start: drawn.roofAt * 3, count: vertices(true) * 3 },
    ]);
    for (const [name, each] of Object.entries(ranges)) {
      if (name !== 'position') expect(each, name).toEqual([]);
    }

    // The same frame again writes nothing: it is hidden already.
    uploaded(geometry);
    expect(belt.clearOf(pyramid)).toBe(1);
    expect(rangesOf(geometry).position).toEqual([]);

    // The plane moves on — or the cull is off — and it is drawn as it was.
    expect(belt.clearOf(undefined)).toBe(0);
    expect(belt.hiddenAt(0)).toBe(false);
    expect(positionsOf(geometry)).toEqual(whole);
    // And a refill draws every building whole, whatever the last frame hid.
    belt.clearOf(pyramid);
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(belt.hiddenAt(0)).toBe(false);
    expect(positionsOf(geometry)).toEqual(whole);
  });

  it('hides nothing and writes nothing where the plane meets no building', () => {
    const belt = aBelt();
    const rider = viewAt(1_500);
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const geometry = belt.mesh.geometry;
    const whole = positionsOf(geometry);
    uploaded(geometry);
    // A chase camera's rig over the road, at the widest frame there is.
    const eye = { x: rider.x, y: 2, z: rider.z };
    const pyramid = nearPyramid({ eye, target: { x: rider.x + 25, y: 1, z: rider.z } }, 6);
    expect(belt.clearOf(pyramid)).toBe(0);
    expect(positionsOf(geometry)).toEqual(whole);
    for (const [name, each] of Object.entries(rangesOf(geometry))) expect(each, name).toEqual([]);
  });

  it('hides a house model with its plan, in the models’ buffer, and writes it back', () => {
    const street = richmondStreetFixture();
    const streetPlans = footprintPlans(
      street.corridor,
      landClassMask(street.corridor),
      street.profile,
      street.origin,
    ).plans;
    const houses = {
      models: HOUSE_MODELS.map((_, index) => ({
        position: Float32Array.from([index, 0, 0, index + 1, 2, 0, index, 0, 3]),
        normal: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 1]),
        uv: Float32Array.from([0, 0, 1, 0, 0, 1]),
        triangles: 1,
      })),
      atlas: aTexture(),
      triangles: HOUSE_MODELS.map((model) => model.triangles),
    };
    const frame = drawnRoadFrame(street.profile, street.origin, 1_100);
    if (frame === undefined) throw new Error('the fixture road has no direction there');
    const belt = new MappedBuildingBelt(mappedBuildingsOf(streetPlans), textures, houses);
    belts.push(belt);
    belt.refill(frame.x, frame.z, MAPPED_BUILDING_TRIANGLES);
    let place = 0;
    while ((belt.drawnAt(place)?.modelAt ?? 0) < 0) place += 1;
    const drawn = belt.drawnAt(place);
    if (drawn === undefined) throw new Error('no model drawn');
    const plan = streetPlans[drawn.plan] as FootprintPlan;
    const geometry = belt.modelMesh.geometry;
    const whole = positionsOf(geometry);
    uploaded(geometry);
    belt.clearOf(pyramidInside(plan));
    expect(belt.hiddenAt(place)).toBe(true);
    expect(positionsOf(geometry).slice(drawn.modelAt * 3, drawn.modelAt * 3 + 9)).toEqual(
      Array.from({ length: 9 }, () => 0),
    );
    expect(rangesOf(geometry).position).toEqual([{ start: drawn.modelAt * 3, count: 9 }]);
    belt.clearOf(undefined);
    expect(positionsOf(geometry)).toEqual(whole);
  });
});
