// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2700: mapped bare ground drawn in its own colour, not the grass's.
 *
 * #2662 classed a beach as `bare`, so nothing grows on it and no field is
 * fenced across it, but the ground under it was still drawn in the world's
 * one grass colour. Since #2700 the mask keeps what bare ground is made of
 * (`land-class.ts` §`BARE_SURFACE_OF_KIND`), `landform.ts` writes it for
 * every vertex of the ground, and `three-renderer.ts` §`TerrainBelt` folds
 * each surface's colour into the colours it uploads.
 *
 * The beach is read back through the path the renderer draws: `sceneFrame`
 * with the ride's mask, then the renderer's own `TerrainBelt`, then the
 * `color` attribute a GPU would be handed — times the material's colour, which
 * is what the shader multiplies it by. Its control is the covered `other`
 * ground beside it, drawn exactly as before. **No OpenStreetMap data and no
 * real place**: rectangles from arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { Box, LandUseFeature } from '@onyourleft/map-features';

import { retainedFrame } from './frame-testing';
import {
  BARE_SURFACE_OF_KIND,
  LAND_CLASS_OF_KIND,
  landClassMask,
  NO_LAND_CLASS,
  type BareSurface,
  type LandClassMask,
} from './land-class';
import { northRoute, outAndBackRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { landUseCorridor } from './testing/land-use-fixtures';
import { corridorOrigin } from './terrain';
import { TerrainBelt } from './three-renderer';
import { BARE_SURFACE_COLOURS, bareSurfaceColourIn, worldStyle } from './world';
import type { WorldCorridor } from './world-data/corridor';

/** A level 6 km road due north: local `z` is distance along, `x` is across. */
const ROUTE = northRoute(6_000, () => 10);
/** The middle 2 km, covered, 1 km either side of the road. */
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };
/** A beach on the right of the road, and bare rock on its left, the length of the covered stretch. */
const BEACH: Box = { minX: 40, maxX: 200, minZ: 2_000, maxZ: 4_000 };
const ROCK: Box = { minX: -200, maxX: -40, minZ: 2_000, maxZ: 4_000 };

function rectangle(kind: string, box: Box): LandUseFeature {
  return {
    layer: 'landuse',
    kind,
    rings: [
      Float32Array.of(
        box.minX,
        box.minZ,
        box.maxX,
        box.minZ,
        box.maxX,
        box.maxZ,
        box.minX,
        box.maxZ,
      ),
    ],
  };
}

function corridorOf(landUse: readonly LandUseFeature[], box: Box = MIDDLE): WorldCorridor {
  return {
    routeId: 'bare-ground-fixture',
    origin: { latitude: 51.5, longitude: -0.12, elevation: 0 },
    covered: (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ,
    coveredBoxes: [box],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
}

/** sRGB to linear, the conversion three's `Color.setHex` makes for the shader. */
function linear(hex: number): readonly [number, number, number] {
  return [16, 8, 0].map((shift) => {
    const c = ((hex >> shift) & 0xff) / 255;
    return c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as unknown as readonly [number, number, number];
}

/** The frame at `at` metres (3 km of {@link ROUTE} by default), with the ride's mask. */
function frameAt(land: LandClassMask, profile: RouteProfile = ROUTE, at = 3_000) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(at) } },
    landClass: land,
  });
}

/** Well inside `box`, a cell clear of its edges, so no 5 m cell there is half another's. */
function within(box: Box, x: number, z: number): boolean {
  return x > box.minX + 6 && x < box.maxX - 6 && z > box.minZ + 6 && z < box.maxZ - 6;
}

/**
 * Every vertex of the frame's ground, with the colour the renderer drew it in
 * — the uploaded `color` attribute times the material's colour, linear — and
 * the share of it that is the mottle and wet margin `landform.ts` wrote.
 */
function drawn(
  land: LandClassMask,
  snowCover = 0,
  groundColour = worldStyle(ROUTE).groundColour,
  frame = frameAt(land),
): {
  readonly vertices: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    /** The drawn colour over the mesh's own colour: what the surface made of the ground's. */
    readonly surface: readonly [number, number, number];
    readonly uploaded: readonly [number, number, number];
    readonly built: readonly [number, number, number];
  }[];
  readonly ground: readonly [number, number, number];
} {
  const mesh = frame.terrain.mesh;
  const belt = new TerrainBelt();
  belt.update(mesh, groundColour, snowCover);
  const colour = belt.mesh.geometry.getAttribute('color').array as Float32Array;
  const ground = linear(groundColour);
  const vertices = [];
  for (let at = 0; at * 3 < mesh.vertices.length; at += 1) {
    const built = [0, 1, 2].map((c) => mesh.colours[at * 3 + c] as number) as unknown as readonly [
      number,
      number,
      number,
    ];
    const uploaded = [0, 1, 2].map((c) => colour[at * 3 + c] as number) as unknown as readonly [
      number,
      number,
      number,
    ];
    vertices.push({
      x: mesh.vertices[at * 3] as number,
      y: mesh.vertices[at * 3 + 1] as number,
      z: mesh.vertices[at * 3 + 2] as number,
      surface: [0, 1, 2].map(
        (c) => ((uploaded[c] as number) / (built[c] as number)) * (ground[c] as number),
      ) as unknown as readonly [number, number, number],
      uploaded,
      built,
    });
  }
  return { vertices, ground };
}

function expectColour(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
  label: string,
): void {
  for (let c = 0; c < 3; c += 1) {
    expect(actual[c], `${label}, channel ${String(c)}`).toBeCloseTo(expected[c] as number, 4);
  }
}

describe('#2700 what bare ground is made of, through landClassMask', () => {
  it('reads each bare kind as its own surface, and every other kind as none', () => {
    const expected: Record<string, BareSurface | undefined> = {
      beach: 'sand',
      sand: 'sand',
      bare_rock: 'stone',
      glacier: 'ice',
      runway: 'paved',
      taxiway: 'paved',
      platform: 'paved',
      pier: 'paved',
      aerodrome: 'earth',
      dam: 'earth',
      // Not bare: no surface, so drawn as the ground always was.
      farmland: undefined,
      residential: undefined,
      grassland: undefined,
    };
    const fixture = landUseCorridor(Object.keys(expected));
    const land = landClassMask(fixture.corridor);
    for (const [kind, surface] of Object.entries(expected)) {
      const [x, z] = fixture.centreOf(kind);
      expect(land.bareSurfaceAt(x, z), kind).toBe(surface);
      // The class is what #2662 made it: one code a surface moves no precedence.
      expect(land.classAt(x, z) === 'bare', kind).toBe(surface !== undefined);
    }
    expect(NO_LAND_CLASS.bareSurfaceAt(0, 0)).toBeUndefined();
  });

  it('names every bare kind’s surface beside its rule (ADR 0054 D-5.1)', () => {
    const bare = Object.keys(LAND_CLASS_OF_KIND).filter((k) => LAND_CLASS_OF_KIND[k] === 'bare');
    expect(Object.keys(BARE_SURFACE_OF_KIND).sort()).toEqual(bare.sort());
  });

  it('paves a runway drawn over its airfield, whichever polygon comes first', () => {
    const airfield: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const strip: Box = { minX: 100, maxX: 200, minZ: 100, maxZ: 200 };
    for (const features of [
      [rectangle('aerodrome', airfield), rectangle('runway', strip)],
      [rectangle('runway', strip), rectangle('aerodrome', airfield)],
    ]) {
      const land = landClassMask(corridorOf(features, airfield));
      expect(land.bareSurfaceAt(150, 150)).toBe('paved');
      expect(land.bareSurfaceAt(50, 50)).toBe('earth');
    }
  });

  it('paves a pier drawn across a beach, whichever polygon comes first', () => {
    const shore: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const pier: Box = { minX: 100, maxX: 200, minZ: 100, maxZ: 200 };
    for (const features of [
      [rectangle('beach', shore), rectangle('pier', pier)],
      [rectangle('pier', pier), rectangle('beach', shore)],
    ]) {
      const land = landClassMask(corridorOf(features, shore));
      expect(land.bareSurfaceAt(150, 150)).toBe('paved');
      expect(land.bareSurfaceAt(50, 50)).toBe('sand');
    }
  });

  it('keeps built-up land over bare ground: an airport’s terminal is not paved over', () => {
    const airfield: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const terminal: Box = { minX: 100, maxX: 200, minZ: 100, maxZ: 200 };
    const land = landClassMask(
      corridorOf([rectangle('commercial', terminal), rectangle('runway', airfield)], airfield),
    );
    expect(land.classAt(150, 150)).toBe('built-up');
    expect(land.bareSurfaceAt(150, 150)).toBeUndefined();
  });
});

describe('#2700 a beach drawn as sand, through the renderer’s own ground', () => {
  const land = landClassMask(corridorOf([rectangle('beach', BEACH), rectangle('bare_rock', ROCK)]));

  it('draws every vertex on the beach in the sand’s colour, and on the rock in the stone’s', () => {
    const { vertices } = drawn(land);
    const sand = linear(BARE_SURFACE_COLOURS.sand);
    const stone = linear(BARE_SURFACE_COLOURS.stone);
    const onBeach = vertices.filter((v) => within(BEACH, v.x, v.z));
    const onRock = vertices.filter((v) => within(ROCK, v.x, v.z));
    // The frame reaches the beach and the rock, both sides, near and far.
    expect(onBeach.length).toBeGreaterThan(100);
    expect(onRock.length).toBeGreaterThan(100);
    for (const v of onBeach) expectColour(v.surface, sand, `beach at ${String(v.x)}`);
    for (const v of onRock) expectColour(v.surface, stone, `rock at ${String(v.x)}`);
  });

  it('draws the covered ground beside them as before, and a ride with no mask to the bit', () => {
    const { vertices, ground } = drawn(land);
    const other = vertices.filter(
      (v) =>
        v.z > MIDDLE.minZ + 6 &&
        v.z < MIDDLE.maxZ - 6 &&
        (v.x > BEACH.maxX + 6 || v.x < ROCK.minX - 6 || Math.abs(v.x) < BEACH.minX - 6),
    );
    expect(other.length).toBeGreaterThan(10);
    for (const v of other) expectColour(v.surface, ground, `other at ${String(v.x)}`);
    // No mask: what is uploaded is what `landform.ts` built, exactly.
    for (const v of drawn(NO_LAND_CLASS).vertices) expect(v.uploaded).toEqual(v.built);
  });

  it('lays the ground’s own snow over the beach, as over the fields beside it', () => {
    // Under a full cover the world's ground is the snow, and so is the sand.
    const snow = bareSurfaceColourIn('earth', 1);
    expect(bareSurfaceColourIn('sand', 1)).toBe(snow);
    const { vertices, ground } = drawn(land, 1, snow);
    const onBeach = vertices.filter((v) => within(BEACH, v.x, v.z));
    expect(onBeach.length).toBeGreaterThan(100);
    for (const v of onBeach) expectColour(v.surface, ground, `snowy beach at ${String(v.x)}`);
    // And part-way, part-way: between the sand and the snow.
    expect(bareSurfaceColourIn('sand', 0)).toBe(BARE_SURFACE_COLOURS.sand);
    const half = bareSurfaceColourIn('sand', 0.5);
    expect(half).not.toBe(BARE_SURFACE_COLOURS.sand);
    expect(half).not.toBe(snow);
    // And what the renderer uploads there is that colour, read back through the belt.
    const partway = drawn(land, 0.5, snow);
    const halfBeach = partway.vertices.filter((v) => within(BEACH, v.x, v.z));
    expect(halfBeach.length).toBeGreaterThan(100);
    for (const v of halfBeach)
      expectColour(v.surface, linear(half), `half-snowy beach at ${String(v.x)}`);
  });

  it('draws the ground round a turning point on a beach as sand too', () => {
    // #1996's out-and-back: the rows round the turn are written by
    // `retracedGround`, not the main pass, and the other pass's rows are sunk.
    const outAndBack = outAndBackRoute();
    const everywhere: Box = { minX: -3_000, maxX: 3_000, minZ: -3_000, maxZ: 3_000 };
    const beach = landClassMask(corridorOf([rectangle('beach', everywhere)], everywhere));
    const frame = frameAt(beach, outAndBack, outAndBack.totalDistance / 2 - 12);
    // Non-vacuity: this frame holds both passes, so it has a turning point.
    expect(frame.corridor.retraced.includes(1)).toBe(true);
    const lowest = Math.min(...frame.corridor.centre.map((point) => point.y));
    const sand = linear(BARE_SURFACE_COLOURS.sand);
    const { vertices } = drawn(beach, 0, worldStyle(outAndBack).groundColour, frame);
    // Every vertex drawn, which is every one not sunk out of sight under its road.
    const shown = vertices.filter((v) => v.y > lowest - 100);
    expect(shown.length).toBeGreaterThan(100);
    for (const v of shown) expectColour(v.surface, sand, `turn at ${String(v.x)}, ${String(v.z)}`);
  });

  it('leaves the mesh’s lent colours as built, and a retained frame keeps its surfaces', () => {
    const frame = frameAt(land);
    const before = frame.terrain.mesh.colours.slice();
    new TerrainBelt().update(frame.terrain.mesh, worldStyle(ROUTE).groundColour);
    expect(frame.terrain.mesh.colours).toEqual(before);
    const kept = retainedFrame(frame).terrain.mesh;
    expect(kept.surfaces).not.toBe(frame.terrain.mesh.surfaces);
    expect(kept.surfaces).toEqual(frame.terrain.mesh.surfaces);
    expect(kept.surfaces.some((byte) => byte !== 0)).toBe(true);
  });
});
