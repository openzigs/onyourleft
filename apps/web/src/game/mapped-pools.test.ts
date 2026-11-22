// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's swimming pools and fountains, drawn with a pool's look — #2974.
 *
 * Every fixture is arithmetic beside a straight test road: no OpenStreetMap
 * data and nothing here is a real place. A pool is read back through what a
 * ride draws: `sceneFrame` handed the corridor and the mask `GameView` builds
 * from it, and the water's mesh it hands the renderer.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import { landBeside, polygonBeside, ringBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import {
  POOL_EDGE_METRES,
  POOL_EDGE_RISE_METRES,
  POOL_KINDS,
  POOLS_DRAWN,
  POOL_WATER_LIFT_METRES,
  poolsInView,
} from './mapped-pools';
import { nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { POOL_EDGE_COLOUR, POOL_SIDE_COLOUR, POOL_WATER_COLOUR, WaterBelt } from './three-renderer';
import { POOL_EDGE_SHORE, POOL_SIDE_SHORE, POOL_WATER_SHORE } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A level road 3 km north, 10 m up: no invented water at all. */
const LEVEL = northRoute(3_000, () => 10);
const ORIGIN = corridorOrigin(LEVEL);

/** A pool of `kind`, 10 m along the road by 5 m across, 30 to 35 m out on its right at `along`. */
function poolAt(along: number, kind = 'swimming_pool', near = 30, far = 35): LandUseFeature {
  return landBeside(LEVEL, ORIGIN, 'water', kind, along - 5, along + 5, near, far);
}

function corridorOf(landUse: readonly LandUseFeature[]): WorldCorridor {
  return {
    routeId: 'mapped-pools',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 4_000 }],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
}

/** The water mesh's vertices of one mark in the frame at `odometer`, read at once (it is lent). */
function marked(landUse: readonly LandUseFeature[], mark: number, odometer = 1_180) {
  const corridor = corridorOf(landUse);
  const start = atStartLine(LEVEL);
  const { surface } = sceneFrame({
    profile: LEVEL,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    worldCorridor: corridor,
    landClass: landClassMask(corridor),
  }).water;
  const found: { x: number; y: number; z: number }[] = [];
  for (let at = 0; at < surface.shore.length; at += 1) {
    if (surface.shore[at] !== mark) continue;
    found.push({
      x: surface.vertices[at * 3] as number,
      y: surface.vertices[at * 3 + 1] as number,
      z: surface.vertices[at * 3 + 2] as number,
    });
  }
  // Every index names a vertex, and no triangle mixes two marks.
  for (let at = 0; at + 2 < surface.indices.length; at += 3) {
    const marks = [0, 1, 2].map((corner) => {
      const vertex = surface.indices[at + corner] as number;
      expect(vertex).toBeLessThan(surface.shore.length);
      return surface.shore[vertex] as number;
    });
    if (marks.some((each) => each >= POOL_WATER_SHORE)) {
      expect(new Set(marks).size).toBe(1);
    }
  }
  return found;
}

/** The ground the renderer draws at `(x, z)`. */
function groundAt(x: number, z: number, landUse: readonly LandUseFeature[]): number {
  const near = nearestOnDrawnRoad(LEVEL, ORIGIN, x, z, 250);
  if (near === undefined) throw new Error('off the corridor');
  return terrainHeightAt(
    LEVEL,
    ORIGIN,
    scatterSeed(LEVEL),
    near.along,
    near.lateral,
    landClassMask(corridorOf(landUse)),
  );
}

describe('a mapped swimming pool is drawn with a pool’s look — #2974', () => {
  const pool = [poolAt(1_200)];

  it('draws its water over its outline, on the ground, where none was drawn', () => {
    const water = marked(pool, POOL_WATER_SHORE);
    expect(water).toHaveLength(4);
    const outline = (pool[0] as LandUseFeature).rings[0] as Float32Array;
    const zs = Array.from(outline).filter((_, at) => at % 2 === 1);
    for (const { x, y, z } of water) {
      // The road runs north along x = 0, and its right is −x.
      expect(-x).toBeGreaterThanOrEqual(30 - 1e-3);
      expect(-x).toBeLessThanOrEqual(35 + 1e-3);
      expect(z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-3);
      expect(z).toBeLessThanOrEqual(Math.max(...zs) + 1e-3);
      expect(y).toBeGreaterThanOrEqual(groundAt(x, z, pool) + POOL_WATER_LIFT_METRES - 1e-3);
    }
    // The control: the same polygon as a pond is the mask's water, and no pool.
    expect(marked([poolAt(1_200, 'water')], POOL_WATER_SHORE)).toEqual([]);
  });

  it('stands a pale coping round it, over its water, out past its outline', () => {
    const water = marked(pool, POOL_WATER_SHORE);
    const edge = marked(pool, POOL_EDGE_SHORE);
    const side = marked(pool, POOL_SIDE_SHORE);
    const level = Math.max(...water.map((each) => each.y));
    expect(edge.length).toBeGreaterThan(0);
    expect(Math.max(...edge.map((each) => each.y))).toBeCloseTo(level + POOL_EDGE_RISE_METRES, 4);
    // Its outer edge, the coping's width out past the outline.
    const outermost = Math.max(...edge.map((each) => -each.x));
    expect(outermost).toBeCloseTo(35 + POOL_EDGE_METRES, 3);
    // Its skirt reaches down past the ground, so no gap shows under it.
    for (const { x, y, z } of side) {
      if (y < level) expect(y).toBeLessThan(groundAt(x, z, pool));
    }
    expect(side.some((each) => each.y < level)).toBe(true);
  });

  it('draws its water lighter than a lake’s, and its coping in stone with no sky in it', () => {
    const belt = new WaterBelt();
    const material = belt.mesh.material as unknown as {
      fragmentShader: string;
      uniforms: Record<string, { value: { r: number; g: number; b: number } }>;
    };
    // In the working (linear) space, as the shader's uniforms hold a lake's two colours.
    const luminance = (colour: { r: number; g: number; b: number }): number =>
      0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
    const linear = (hex: number): { r: number; g: number; b: number } => {
      const channel = (value: number): number => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return { r: channel((hex >> 16) & 255), g: channel((hex >> 8) & 255), b: channel(hex & 255) };
    };
    const pool = luminance(linear(POOL_WATER_COLOUR));
    for (const lake of ['deepColour', 'shallowColour']) {
      const colour = material.uniforms[lake]?.value;
      expect(colour).toBeDefined();
      expect(pool).toBeGreaterThan(luminance(colour as { r: number; g: number; b: number }));
    }
    expect(luminance(linear(POOL_EDGE_COLOUR))).toBeGreaterThan(
      luminance(linear(POOL_SIDE_COLOUR)),
    );
    // The shader reads the marks: water over 1.5, the coping over 2.5 and its skirt over 3.5.
    expect(material.fragmentShader).toContain('vShore > 1.5');
    expect(material.fragmentShader).toContain('vShore > 2.5');
    expect(material.fragmentShader).toContain('vShore > 3.5');
    expect(POOL_WATER_SHORE).toBeGreaterThan(1.5);
    expect(POOL_EDGE_SHORE).toBeGreaterThan(2.5);
    expect(POOL_EDGE_SHORE).toBeLessThan(3.5);
    expect(POOL_SIDE_SHORE).toBeGreaterThan(3.5);
    belt.dispose();
  });

  it('draws a fountain as a pool, and a retention basin as the mask’s water', () => {
    expect(POOL_KINDS.has('fountain')).toBe(true);
    expect(marked([poolAt(1_200, 'fountain')], POOL_WATER_SHORE)).toHaveLength(4);
    expect(marked([poolAt(1_200, 'basin')], POOL_WATER_SHORE)).toEqual([]);
  });

  it('draws a round pool by its outline’s own triangles', () => {
    const round: LandUseFeature = {
      layer: 'water',
      kind: 'swimming_pool',
      rings: [ringBeside(LEVEL, ORIGIN, polygonBeside(1_200, 40, 4, 12))],
    };
    expect(marked([round], POOL_WATER_SHORE)).toHaveLength(12);
  });
});

describe('what is drawn as no pool — #2974', () => {
  it('none on the road, none the size of a lido’s grounds, none out of reach', () => {
    expect(marked([poolAt(1_200, 'swimming_pool', -2, 2)], POOL_WATER_SHORE)).toEqual([]);
    const lido = landBeside(LEVEL, ORIGIN, 'water', 'swimming_pool', 1_150, 1_250, 30, 60);
    expect(marked([lido], POOL_WATER_SHORE)).toEqual([]);
    expect(marked([poolAt(2_500)], POOL_WATER_SHORE)).toEqual([]);
    // The control: the same pool is drawn once the rider comes near it.
    expect(marked([poolAt(2_500)], POOL_WATER_SHORE, 2_480)).toHaveLength(4);
  });

  it('draws at most POOLS_DRAWN, nearest the camera first', () => {
    const many = Array.from({ length: 40 }, (_, index) => poolAt(1_100 + index * 12));
    const drawn = poolsInView(
      corridorOf(many),
      LEVEL,
      ORIGIN,
      scatterSeed(LEVEL),
      landClassMask(corridorOf(many)),
      0,
      1_200,
    );
    expect(drawn).toHaveLength(POOLS_DRAWN);
    const distances = drawn.map((each) => Math.abs(each.centreZ - 1_200));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});
