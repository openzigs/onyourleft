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
  BUILDING_ROLES,
  BUILDING_VARIANTS,
  BUILT_KINDS,
  FOUNDATION_METRES,
  PLINTH_TOP_METRES,
  buildingPlan,
  type BuildingRole,
} from './buildings';
import {
  REALISTIC_BOUNDARY_PARTS,
  REALISTIC_BUILDING_SURFACES,
  REALISTIC_STRUCTURE_SURFACES,
} from './realistic-assets';
import {
  BridgeBelt,
  GROUNDED_SHADE,
  GROUNDING_METRES,
  groundingShade,
  realisticStructureGeometry,
  HorizonRing,
  ScatterBelt,
  SKY_GRADIENT_RISE,
  SkyDome,
  TerrainBelt,
  WaterBelt,
  isConstructedMaterial,
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

  it('sends the index list once, not once a frame — #468 review', () => {
    // `landform.ts` lends the same index array for every frame of one row
    // count; three counts each `needsUpdate` as a new version to upload.
    const belt = new TerrainBelt();
    const first = groundAt(500);
    belt.update(first, 0x557744);
    const index = belt.mesh.geometry.getIndex() as unknown as { readonly version: number };
    const uploaded = index.version;
    const second = groundAt(520);
    // Non-vacuity: the second frame really does hand back the same array.
    expect(second.indices).toBe(first.indices);
    belt.update(second, 0x557744);
    expect(index.version).toBe(uploaded);
    // A different list IS sent: a copy is a different array with the same rows.
    belt.update({ ...second, indices: Uint32Array.from(second.indices) }, 0x557744);
    expect(index.version).toBe(uploaded + 1);
  });

  it('tells the patchwork how many fields a lap has, so lap two wraps onto lap one — #468 review B3', () => {
    const belt = new TerrainBelt();
    const ground = groundAt(500);
    belt.update(ground, 0x557744);
    // The same uniform object three's program reads.
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    (
      belt.mesh.material as unknown as { onBeforeCompile: (s: typeof shader) => void }
    ).onBeforeCompile(shader);
    expect(shader.uniforms['fieldCount']?.value).toBe(ground.fieldCount);
    expect(ground.fieldCount * ground.fieldSpan).toBeCloseTo(hillRoute().totalDistance, 6);
    // And the fragment wraps the field index by it.
    expect(shader.fragmentShader).toContain('fieldCount * floor(');
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

  it('band-limits its ripples, and can have that turned off for the gate’s control — #501', () => {
    const belt = new WaterBelt();
    const material = belt.mesh.material as unknown as {
      readonly fragmentShader: string;
      readonly uniforms: Record<string, { value: number }>;
    };
    // Each ripple's amplitude is weighted by how far its phase turns across a
    // pixel — a screen-space derivative — and the weight is on by default.
    expect(material.fragmentShader).toContain('fwidth(phase)');
    expect(material.fragmentShader).toContain('oylRippleWeight(a1) * cos(a1)');
    expect(material.fragmentShader).toContain('oylRippleWeight(a2) * cos(a2)');
    expect(material.uniforms['rippleFilter']?.value).toBe(1);
    belt.setRippleFilter(false);
    expect(material.uniforms['rippleFilter']?.value).toBe(0);
    belt.setRippleFilter(true);
    expect(material.uniforms['rippleFilter']?.value).toBe(1);
    belt.dispose();
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

  it('dresses the bridge in the photographed stone on a realistic rung — #501', () => {
    const belt = new BridgeBelt();
    const stylised = belt.mesh.material;
    // Stand-ins: this file may not import three (`three-seam.test.ts`), and a
    // material only holds its maps until it is compiled.
    const stone = { colour: { name: 'colour' } as never, normal: { name: 'normal' } as never };
    belt.setWorld('realistic', stone);
    const dressed = belt.mesh.material as unknown as {
      readonly map: unknown;
      readonly normalMap: unknown;
      onBeforeCompile: (shader: {
        uniforms: Record<string, { value: number }>;
        vertexShader: string;
      }) => void;
    };
    expect(dressed.map).toBe(stone.colour);
    expect(dressed.normalMap).toBe(stone.normal);
    expect(isConstructedMaterial(belt.mesh.material as never)).toBe(true);
    // Projected in the world's metres, at the stone's own tile — not the unit
    // cube's 0-to-1, which would stretch one photograph along a parapet.
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\n#include <project_vertex>',
    };
    dressed.onBeforeCompile(shader);
    expect(shader.uniforms['tileMetres']?.value).toBe(
      REALISTIC_STRUCTURE_SURFACES.stone.tileMetres,
    );
    expect(shader.vertexShader).toContain('vMapUv = oylStone');
    expect(shader.vertexShader).toContain('instanceMatrix * oylWorld');
    // The same maps again build nothing new.
    belt.setWorld('realistic', stone);
    expect(belt.mesh.material).toBe(dressed);
    // No photograph to wear: the plain physical stone, with no map.
    belt.setWorld('realistic');
    expect((belt.mesh.material as unknown as { readonly map: unknown }).map).toBeNull();
    // And the stylised world keeps its own, whatever it is handed.
    belt.setWorld('stylised', stone);
    expect(belt.mesh.material).toBe(stylised);
    belt.dispose();
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

  it('paints a built shape in more than one colour, in one mesh a shape', () => {
    const belt = new ScatterBelt(new Map());
    for (const kind of ['barn', 'church', 'shop-row', 'shed', 'signpost'] as const) {
      const meshes = belt.meshesOf(kind);
      // #500: a building has two shapes, each one mesh; a signpost has one.
      expect(meshes, kind).toHaveLength(kind === 'signpost' ? 1 : 2);
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

describe('the buildings a view draws, since #500', () => {
  const pose = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1, eyeRoadY: 0, targetRoadY: 0 };

  it('draws each building in the shape its own variant names, two shapes a kind', () => {
    const belt = new ScatterBelt(new Map());
    belt.update(
      Array.from({ length: 6 }, (_, variant) => ({
        kind: 'barn' as const,
        x: -12,
        y: 0,
        z: 10 + variant * 20,
        rotation: 0,
        scale: 1,
        variant,
      })),
      pose,
    );
    const [first, second] = belt.meshesOf('barn');
    // Six slots folded onto two shapes: three each.
    expect(first?.count).toBe(3);
    expect(second?.count).toBe(3);
    // Non-vacuity: two meshes of one shape would pass the counts.
    expect(first?.geometry.getAttribute('position').count).not.toBe(
      second?.geometry.getAttribute('position').count,
    );
    belt.dispose();
  });

  it('grounds a building: darker where its walls meet the ground', () => {
    expect(groundingShade(-FOUNDATION_METRES)).toBe(GROUNDED_SHADE);
    expect(groundingShade(0)).toBe(GROUNDED_SHADE);
    expect(groundingShade(GROUNDING_METRES / 2)).toBeCloseTo((1 + GROUNDED_SHADE) / 2, 9);
    expect(groundingShade(GROUNDING_METRES)).toBe(1);
    expect(groundingShade(8)).toBe(1);
    // In the mesh the stylised world draws: the plinth's own colour at the
    // foundation is the same colour at its top, darkened by the grounding.
    const belt = new ScatterBelt(new Map());
    const mesh = belt.meshesOf('barn')[0];
    const positions = mesh?.geometry.getAttribute('position') as unknown as Attribute;
    const colours = mesh?.geometry.getAttribute('color') as unknown as Attribute;
    let pairs = 0;
    for (let low = 0; low < positions.array.length / 3; low += 1) {
      if (Math.abs(positions.getY(low) + FOUNDATION_METRES) > 1e-6) continue;
      for (let high = 0; high < positions.array.length / 3; high += 1) {
        if (
          Math.abs(positions.getY(high) - PLINTH_TOP_METRES) < 1e-6 &&
          Math.abs(positions.getX(high) - positions.getX(low)) < 1e-6 &&
          Math.abs(positions.getZ(high) - positions.getZ(low)) < 1e-6
        ) {
          expect(colours.getX(low) / colours.getX(high)).toBeCloseTo(
            GROUNDED_SHADE / groundingShade(PLINTH_TOP_METRES),
            5,
          );
          pairs += 1;
        }
      }
    }
    expect(pairs).toBeGreaterThan(4);
    belt.dispose();
  });

  it('grounds a realistic building the same way, in the vertex colour its materials multiply in', () => {
    const walls = realisticStructureGeometry('barn', 'planks', 0);
    const positions = walls?.getAttribute('position') as unknown as Attribute;
    const colours = walls?.getAttribute('color') as unknown as Attribute;
    let foundation = 0;
    for (let vertex = 0; vertex < positions.array.length / 3; vertex += 1) {
      const y = positions.getY(vertex);
      // White, darkened by the grounding and by the part's own shade only.
      expect(colours.getX(vertex)).toBeLessThanOrEqual(groundingShade(y) + 1e-6);
      if (y < -FOUNDATION_METRES + 1e-6) {
        expect(colours.getX(vertex)).toBeLessThanOrEqual(GROUNDED_SHADE + 1e-6);
        foundation += 1;
      }
    }
    expect(foundation).toBeGreaterThan(0);
    walls?.dispose();
  });

  it('draws a realistic plinth, ridge, door and chimney darker than the part beside it', () => {
    // A plinth wears the wall's photograph, a ridge the roof's and a door the
    // frame's, so without `REALISTIC_ROLE_SHADE` each is the same surface as
    // its neighbour and does not read as a part at all. Read back out of the
    // geometry the belts are built from: `realisticStructureGeometry` merges a
    // surface's roles in `BUILDING_ROLES`' order, so each role's vertices are
    // a run whose length the plan gives, and its shade is what is left of a
    // vertex's colour once the grounding is divided out.
    const PAIRS: readonly (readonly [BuildingRole, BuildingRole])[] = [
      ['plinth', 'wall'],
      ['ridge', 'roof'],
      ['door', 'joinery'],
      ['chimney', 'wall'],
    ];
    let checked = 0;
    for (const kind of BUILT_KINDS) {
      for (let variant = 0; variant < BUILDING_VARIANTS; variant += 1) {
        const plan = buildingPlan(kind, variant);
        const surfaces = REALISTIC_BUILDING_SURFACES[kind];
        const shadeOf = (role: BuildingRole): number | undefined => {
          const surface = surfaces[role];
          const geometry = realisticStructureGeometry(kind, surface, variant);
          if (geometry === undefined) return undefined;
          const positions = geometry.getAttribute('position') as unknown as Attribute;
          const colours = geometry.getAttribute('color') as unknown as Attribute;
          let first = 0;
          for (const earlier of BUILDING_ROLES) {
            if (earlier === role) break;
            if (surfaces[earlier] === surface) first += plan.triangles[earlier].length / 3;
          }
          const count = plan.triangles[role].length / 3;
          const shades = new Set<string>();
          for (let vertex = first; vertex < first + count; vertex += 1) {
            shades.add((colours.getX(vertex) / groundingShade(positions.getY(vertex))).toFixed(4));
          }
          geometry.dispose();
          // One shade a role, or the run was not that role's.
          expect(shades.size, `${kind} ${String(variant)} ${role}`).toBe(1);
          return Number([...shades][0]);
        };
        for (const [darker, than] of PAIRS) {
          if (plan.triangles[darker].length === 0 || plan.triangles[than].length === 0) continue;
          if (surfaces[darker] !== surfaces[than]) continue;
          const label = `${kind} ${String(variant)} ${darker} against ${than}`;
          const dark = shadeOf(darker);
          const light = shadeOf(than);
          expect(dark, label).toBeDefined();
          expect(light, label).toBeDefined();
          expect(dark ?? 1, label).toBeLessThanOrEqual((light ?? 0) - 0.08);
          checked += 1;
        }
      }
    }
    // Every pair on the house, and the plinths of every kind.
    expect(checked).toBeGreaterThanOrEqual(2 * 4 + 8);
  });

  it('does not ground a realistic field boundary or signpost, as the stylised world does not', () => {
    for (const [kind, surfaces] of Object.entries(REALISTIC_BOUNDARY_PARTS) as [
      keyof typeof REALISTIC_BOUNDARY_PARTS,
      readonly Parameters<typeof realisticStructureGeometry>[1][],
    ][]) {
      let low = 0;
      for (const surface of new Set(surfaces)) {
        const geometry = realisticStructureGeometry(kind, surface, 0);
        expect(geometry, `${kind} ${surface}`).toBeDefined();
        const positions = geometry?.getAttribute('position') as unknown as Attribute;
        const colours = geometry?.getAttribute('color') as unknown as Attribute;
        for (let vertex = 0; vertex < positions.array.length / 3; vertex += 1) {
          expect(colours.getX(vertex), `${kind} ${surface}`).toBeCloseTo(1, 6);
          if (positions.getY(vertex) < GROUNDING_METRES / 2) low += 1;
        }
        geometry?.dispose();
      }
      // Non-vacuity: it has a foot for the grounding to have darkened (a
      // signpost's is its pole; its board stands above the band).
      expect(low, kind).toBeGreaterThan(0);
    }
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
