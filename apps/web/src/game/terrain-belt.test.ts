// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `three-renderer.ts` §`TerrainBelt` and §`HorizonRing` — the ground and the
 * distant hills, #458, as the objects the renderer builds.
 *
 * jsdom has no WebGL, so what is asserted is what would be handed to a
 * driver: the arrays in the buffers, the draw range, the material. What a
 * driver then draws is `game.browser.spec.ts` §"the gradient shows beside the
 * road", with the flat quad this replaced as its control.
 */

import { describe, expect, it } from 'vitest';

import {
  HORIZON_RADIUS_METRES,
  HORIZON_SEGMENTS,
  TERRAIN_BANDS,
  horizonRelief,
  terrainCorridor,
} from './landform';
import { hillRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed, type SceneryKind } from './scatter';
import { corridorOrigin, roadCorridor } from './terrain';
import {
  BridgeBelt,
  HorizonRing,
  ScatterBelt,
  SKY_GRADIENT_RISE,
  SkyDome,
  TerrainBelt,
  WaterBelt,
  skyShare,
} from './three-renderer';
import { bridgeParts, waterSurface, waterways } from './waterways';
import { worldStyle } from './world';

function groundAt(odometer: number) {
  const profile = hillRoute();
  return terrainCorridor(
    profile,
    corridorOrigin(profile),
    roadCorridor(profile, corridorOrigin(profile), odometer),
    scatterSeed(profile),
  );
}

/**
 * The parts of three's objects these tests read, stated structurally —
 * `three-seam.test.ts` allows exactly one file to import the library, and it
 * is not this one.
 */
interface Attribute {
  readonly array: Float32Array;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}
interface Material {
  readonly type: string;
  readonly depthWrite: boolean;
  readonly fog?: boolean;
  readonly color: { getHex(): number };
}

function attribute(belt: TerrainBelt, name: string): Attribute {
  return belt.mesh.geometry.getAttribute(name) as unknown as Attribute;
}

describe('the ground a view draws — #458', () => {
  it('uploads the landform it is handed, whole, and draws every band at the target', () => {
    const belt = new TerrainBelt();
    const ground = groundAt(500);
    belt.update(ground, 0x557744);

    expect([...attribute(belt, 'position').array].slice(0, ground.vertices.length)).toEqual([
      ...ground.vertices,
    ]);
    expect([...attribute(belt, 'normal').array].slice(0, ground.normals.length)).toEqual([
      ...ground.normals,
    ]);
    expect(belt.mesh.geometry.drawRange.count).toBe(ground.indices.length);
    expect(belt.mesh.geometry.drawRange.count).toBe(TERRAIN_BANDS * ground.indicesPerBand);
  });

  it('draws only the innermost bands a rung allows, and never none', () => {
    const belt = new TerrainBelt();
    const ground = groundAt(500);
    belt.update(ground, 0x557744);
    belt.setBands(8);
    expect(belt.mesh.geometry.drawRange.count).toBe(8 * ground.indicesPerBand);
    // A rung set BEFORE a frame arrives still binds when it does.
    const early = new TerrainBelt();
    early.setBands(9);
    early.update(ground, 0x557744);
    expect(early.mesh.geometry.drawRange.count).toBe(9 * ground.indicesPerBand);
    belt.setBands(0);
    expect(belt.mesh.geometry.drawRange.count).toBe(ground.indicesPerBand);
  });

  it('is lit and writes depth, where the flat quad was neither', () => {
    // The two decisions #458 asks to be recorded, as properties of the object.
    const belt = new TerrainBelt();
    belt.update(groundAt(500), 0x557744);
    const material = belt.mesh.material as unknown as Material;
    expect(material.type).toBe('MeshLambertMaterial');
    expect(material.depthWrite).toBe(true);
    expect(material.color.getHex()).toBe(0x557744);
    belt.setShading('flat');
    const flat = belt.mesh.material as unknown as Material;
    expect(flat.type).toBe('MeshBasicMaterial');
    expect(flat.depthWrite).toBe(true);
    // Either way the ground's own colour is carried.
    expect(flat.color.getHex()).toBe(0x557744);
  });

  it('reuses its buffers from one frame to the next — NFR-3', () => {
    const belt = new TerrainBelt();
    belt.update(groundAt(500), 0x557744);
    const first = attribute(belt, 'position');
    belt.update(groundAt(520), 0x557744);
    expect(attribute(belt, 'position')).toBe(first);
  });
});

describe('the distant hills a view draws — #458', () => {
  const profile = hillRoute();
  const origin = corridorOrigin(profile);
  const relief = horizonRelief(profile, origin, scatterSeed(profile));
  const world = worldStyle(profile);
  const pose = {
    x: 40,
    y: 12,
    z: 900,
    headingX: 0,
    headingZ: 1,
    eyeRoadY: 12,
    targetRoadY: 12,
  };

  it('stands a ring of the relief’s own tops round the camera, at the route’s heights', () => {
    const ring = new HorizonRing();
    ring.update(relief, world, pose);
    const positions = ring.mesh.geometry.getAttribute('position') as unknown as Attribute;
    for (let segment = 0; segment < HORIZON_SEGMENTS; segment += 1) {
      const top = segment * 3 + 2;
      expect(Math.hypot(positions.getX(top), positions.getZ(top))).toBeCloseTo(
        HORIZON_RADIUS_METRES,
        3,
      );
      expect(positions.getY(top)).toBeCloseTo(relief.tops[segment] as number, 3);
      expect(positions.getY(segment * 3)).toBeCloseTo(relief.base, 3);
    }
    // Round the CAMERA in plan, but at the route's own heights: a rider who
    // climbs rises past the hills rather than carrying them up.
    expect([ring.mesh.position.x, ring.mesh.position.y, ring.mesh.position.z]).toEqual([
      40, 0, 900,
    ]);
  });

  it('is a backdrop: unfogged, drawn first, writing no depth', () => {
    const ring = new HorizonRing();
    const material = ring.mesh.material as unknown as Material;
    expect(material.fog).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(ring.mesh.renderOrder).toBeLessThan(0);
  });

  it('meets the fogged ground in the horizon colour, and hazes the ridge', () => {
    const ring = new HorizonRing();
    ring.update(relief, world, pose);
    const colours = ring.mesh.geometry.getAttribute('color') as unknown as Attribute;
    const channel = (vertex: number): readonly number[] => [
      colours.getX(vertex),
      colours.getY(vertex),
      colours.getZ(vertex),
    ];
    // The foot is exactly the horizon colour; the ridge is not.
    expect(channel(1)).toEqual(channel(0));
    expect(channel(2)).not.toEqual(channel(1));
  });
});

describe('the water and the bridges a view draws — #459', () => {
  const profile = valleyRoute();
  const origin = corridorOrigin(profile);
  const ways = waterways(profile, scatterSeed(profile));
  const crossing = ways.crossings[0]?.distance ?? 0;
  const corridor = roadCorridor(profile, origin, crossing - 50);
  const world = worldStyle(profile);

  it('uploads the surface and draws it, and draws nothing where there is no water', () => {
    const belt = new WaterBelt();
    const surface = waterSurface(profile, origin, corridor, ways);
    belt.update(surface, world, 12);
    expect(surface.indices.length).toBeGreaterThan(0);
    expect(belt.mesh.visible).toBe(true);
    expect(belt.mesh.geometry.drawRange.count).toBe(surface.indices.length);
    const shore = belt.mesh.geometry.getAttribute('shore') as unknown as Attribute;
    expect([...shore.array].slice(0, surface.shore.length)).toEqual([...surface.shore]);
    // Far from the valley: no water in view, and no draw call for it.
    belt.update(
      waterSurface(profile, origin, roadCorridor(profile, origin, 2_600), ways),
      world,
      12,
    );
    expect(belt.mesh.visible).toBe(false);
  });

  it('runs its ripples on the ride’s clock and reflects this frame’s sky', () => {
    const belt = new WaterBelt();
    belt.update(waterSurface(profile, origin, corridor, ways), world, 42.5);
    const material = belt.mesh.material as unknown as {
      readonly type: string;
      readonly uniforms: Record<string, { value: { getHex?: () => number } | number }>;
    };
    expect(material.type).toBe('ShaderMaterial');
    expect(material.uniforms['time']?.value).toBe(42.5);
    const sky = material.uniforms['skyColour']?.value as { getHex: () => number };
    expect(sky.getHex()).toBe(world.skyColour);
    belt.setDrawn('flat');
    expect((belt.mesh.material as unknown as { readonly type: string }).type).toBe(
      'MeshBasicMaterial',
    );
  });

  it('draws every block of every bridge in view as one instance of one box', () => {
    const belt = new BridgeBelt();
    const parts = bridgeParts(profile, origin, corridor, ways);
    belt.update(parts);
    expect(parts.length).toBeGreaterThan(4);
    expect(belt.mesh.count).toBe(parts.length);
    expect(belt.mesh.visible).toBe(true);
    // The box's own size is the part's: its matrix stretches a unit cube to it.
    const first = parts[0];
    const matrix = { elements: new Float32Array(16) };
    const read = belt.mesh.instanceMatrix.array as Float32Array;
    matrix.elements.set(read.subarray(0, 16));
    const column = (index: number) =>
      Math.hypot(
        matrix.elements[index * 4] as number,
        matrix.elements[index * 4 + 1] as number,
        matrix.elements[index * 4 + 2] as number,
      );
    expect(column(0)).toBeCloseTo(first?.width ?? 0, 4);
    expect(column(1)).toBeCloseTo(first?.height ?? 0, 4);
    expect(column(2)).toBeCloseTo(first?.length ?? 0, 4);
    expect(matrix.elements[13]).toBeCloseTo(first?.y ?? 0, 4);
    belt.update([]);
    expect(belt.mesh.visible).toBe(false);
  });
});

describe('the buildings and the field boundaries a view draws — #460', () => {
  /** The size of a kind's shape, as the belt holds it, with no model loaded. */
  const sizeOf = (belt: ScatterBelt, kind: SceneryKind): readonly number[] => {
    const geometry = belt.meshesOf(kind)[0]?.geometry;
    geometry?.computeBoundingBox();
    const box = geometry?.boundingBox;
    return box === null || box === undefined
      ? [0, 0, 0]
      : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  };

  it('draws five kinds of building with five different silhouettes', () => {
    const belt = new ScatterBelt(new Map());
    const kinds: readonly SceneryKind[] = ['building', 'barn', 'church', 'shop-row', 'shed'];
    const sizes = kinds.map((kind) => sizeOf(belt, kind));
    // Every pair differs by more than a metre in at least one dimension — a
    // silhouette, not a recolour.
    for (let first = 0; first < kinds.length; first += 1) {
      for (let second = first + 1; second < kinds.length; second += 1) {
        const apart = Math.max(
          ...[0, 1, 2].map((axis) =>
            Math.abs((sizes[first]?.[axis] ?? 0) - (sizes[second]?.[axis] ?? 0)),
          ),
        );
        expect(apart, `${kinds[first] ?? ''} against ${kinds[second] ?? ''}`).toBeGreaterThan(1);
      }
    }
    // The church is the landmark: the tallest thing in a village.
    expect(sizeOf(belt, 'church')[1]).toBeGreaterThan(18);
    belt.dispose();
  });

  it('paints a built shape in more than one colour, in one mesh', () => {
    const belt = new ScatterBelt(new Map());
    for (const kind of ['barn', 'church', 'shop-row', 'shed', 'signpost'] as const) {
      const meshes = belt.meshesOf(kind);
      expect(meshes, kind).toHaveLength(1);
      const colours = meshes[0]?.geometry.getAttribute('color') as unknown as Attribute;
      const seen = new Set<string>();
      for (let vertex = 0; vertex < colours.array.length / 3; vertex += 1) {
        seen.add(
          [colours.getX(vertex), colours.getY(vertex), colours.getZ(vertex)]
            .map((channel) => channel.toFixed(3))
            .join(','),
        );
      }
      expect(seen.size, kind).toBeGreaterThanOrEqual(2);
    }
    belt.dispose();
  });

  it('draws every wall, hedge and fence of a kind in one instanced mesh', () => {
    const belt = new ScatterBelt(new Map());
    const pose = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1, eyeRoadY: 0, targetRoadY: 0 };
    const items = (['wall', 'hedge', 'fence'] as const).flatMap((kind, at) =>
      Array.from({ length: 40 }, (_, index) => ({
        kind,
        x: -10 - at * 3,
        y: 0,
        z: index * 8,
        rotation: 0,
        scale: 1,
        variant: index % 6,
      })),
    );
    belt.update(items, pose);
    for (const kind of ['wall', 'hedge', 'fence'] as const) {
      const meshes = belt.meshesOf(kind);
      expect(meshes, kind).toHaveLength(1);
      expect(meshes[0]?.count, kind).toBe(40);
    }
    belt.dispose();
  });
});

describe('the sky and the surfaces — #425', () => {
  it('grades the sky from the haze at the horizon to the sky overhead', () => {
    expect(skyShare(-0.3)).toBe(0);
    expect(skyShare(0)).toBe(0);
    expect(skyShare(SKY_GRADIENT_RISE)).toBe(1);
    expect(skyShare(1)).toBe(1);
    let previous = 0;
    for (let rise = 0; rise <= 1; rise += 0.05) {
      expect(skyShare(rise)).toBeGreaterThanOrEqual(previous);
      previous = skyShare(rise);
    }
  });

  it('paints the dome in the route’s own two colours, and follows the eye', () => {
    const dome = new SkyDome();
    const world = worldStyle(hillRoute());
    dome.update(world, { x: 3, y: 4, z: 5 });
    const positions = dome.mesh.geometry.getAttribute('position') as unknown as Attribute;
    const colours = dome.mesh.geometry.getAttribute('color') as unknown as Attribute;
    let top = 0;
    let bottom = 0;
    for (let vertex = 0; vertex < positions.array.length / 3; vertex += 1) {
      if (positions.getY(vertex) > positions.getY(top)) top = vertex;
      if (positions.getY(vertex) < positions.getY(bottom)) bottom = vertex;
    }
    const channels = (vertex: number) => [
      colours.getX(vertex),
      colours.getY(vertex),
      colours.getZ(vertex),
    ];
    // Overhead the sky's own colour; underfoot the haze — and not the same.
    expect(channels(top)).not.toEqual(channels(bottom));
    const material = dome.mesh.material as unknown as Material;
    expect(material.fog).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect([dome.mesh.position.x, dome.mesh.position.y, dome.mesh.position.z]).toEqual([3, 4, 5]);
    // A flat world — the haze set to the sky — paints one colour everywhere.
    const flat = new SkyDome();
    flat.update({ ...world, horizonColour: world.skyColour }, { x: 0, y: 0, z: 0 });
    const flatColours = flat.mesh.geometry.getAttribute('color') as unknown as Attribute;
    expect(flatColours.getX(top)).toBeCloseTo(flatColours.getX(bottom), 6);
  });

  it('switches the ground’s detail with the rung, compiling it once each way', () => {
    const belt = new TerrainBelt();
    const defines = () =>
      Object.keys((belt.mesh.material as unknown as { defines?: object }).defines ?? {});
    belt.setSurfaceDetail(true);
    expect(defines()).toContain('SURFACE_DETAIL');
    const version = (belt.mesh.material as unknown as { version: number }).version;
    belt.setSurfaceDetail(true);
    // Asked again with no change: nothing recompiled.
    expect((belt.mesh.material as unknown as { version: number }).version).toBe(version);
    belt.setSurfaceDetail(false);
    expect(defines()).not.toContain('SURFACE_DETAIL');
  });
});
