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
import { hillRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { corridorOrigin, roadCorridor } from './terrain';
import { HorizonRing, TerrainBelt } from './three-renderer';
import { worldStyle } from './world';

function groundAt(odometer: number) {
  const profile = hillRoute();
  return terrainCorridor(
    profile,
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
