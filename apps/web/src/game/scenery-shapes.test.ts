// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What #3252's scenery is DRAWN as — read back off the belts a frame draws
 * with: the species a setting's item wears, its size and build, a grown
 * tree's far band in its host's own mesh, a rock set into the ground, the
 * drystone wall, and the timber fence and the noise barrier folded into the
 * field fence's one draw.
 *
 * ⚠️ No `three` is imported here, for `three-seam.test.ts`.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CAMERA_TARGET_AHEAD_METRES } from './camera';
import { GlslProgram } from './glsl-program-testing';
import { GROWN_SPECIES, growTree } from './grown-trees';
import { readGlb } from './model-bytes-testing';
import type { CameraPose } from './port';
import { REALISTIC_CHAIN_LINK, realisticVegetation } from './realistic-assets';
import {
  HARD_SWAP_TREE_LEVELS,
  REALISTIC_GROWN_TRIANGLES,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { chainLinkFacts } from './realistic-bytes-testing';
import type { ScatterItem } from './scatter';
import { ageScale, fenceFoldOf, instanceBuild, rockSeat, ROCK_SEAT } from './scenery-plan';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import {
  builtFenceGeometry,
  CHAIN_LINK_FOLD_GLSL,
  CHAIN_LINK_PART_ATTRIBUTE,
  CHAIN_LINK_SHAPE_ATTRIBUTE,
  chainLinkFenceGeometry,
  GROWN_HOST_MATERIALS,
  grownShapeOf,
  NOISE_BARRIER_METRES,
  prepareRealisticShape,
  RealisticStructureBelts,
  RealisticVegetationBelt,
  realisticStructureGeometry,
  ScatterBelt,
  sceneryFitMetres,
  STONE_WALL_COPES,
  stoneWallGeometry,
  type RealisticShape,
} from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));

const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  targetAheadMetres: CAMERA_TARGET_AHEAD_METRES,
  eyeRoadY: 0,
  targetRoadY: 0,
};

type Geometry = NonNullable<ReturnType<ScatterBelt['meshesOf']>[number]>['geometry'];

/** A geometry three built, taken off a belt so this file names no `three` type. */
function aGeometry(): Geometry {
  const mesh = new ScatterBelt(new Map()).meshesOf('rock')[0];
  if (mesh === undefined) throw new Error('no rock primitive');
  return mesh.geometry.clone();
}

const aTexture = (): never =>
  ({ image: { width: 512, height: 512 }, dispose: () => undefined }) as never;

/** What `GLTFLoader` leaves on a mesh of a generated tree: a colour map and a normal map. */
function loaderMaterial(name: string, transparent = false): Record<string, unknown> {
  return {
    name,
    transparent,
    alphaTest: 0,
    alphaHash: false,
    map: aTexture(),
    normalMap: aTexture(),
    dispose: () => undefined,
  };
}

const IDENTITY = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };

/** The size a loaded host records: 8 units tall and 4 across. */
const HOST = { height: 8, width: 4 };

/** A loaded shape: a tree of two materials with its impostor's strip, or a plant of one. */
function aShape(name: string, materials: readonly string[], tree: boolean): RealisticShape {
  const scene = {
    updateWorldMatrix: () => undefined,
    traverse: (visit: (node: unknown) => void) => {
      visit({
        isMesh: false,
        userData: {
          oyl_scan_height: HOST.height,
          oyl_scan_width: HOST.width,
          oyl_impostor_scale: 8.2,
          oyl_impostor_frames: 8,
        },
      });
      for (const material of materials) {
        visit({
          isMesh: true,
          geometry: aGeometry(),
          material: loaderMaterial(material, material === 'leaves'),
          matrixWorld: IDENTITY,
          userData: {},
        });
      }
    },
  } as unknown as Parameters<typeof prepareRealisticShape>[0];
  return prepareRealisticShape(
    scene,
    name,
    tree
      ? ({ image: { width: 2048, height: 512 } } as unknown as Parameters<
          typeof prepareRealisticShape
        >[2])
      : undefined,
  );
}

/** A world's vegetation as a load leaves it: the committed shapes, then every grown species. */
function aWorld(): Map<'tree-broadleaf' | 'tree-conifer' | 'shrub' | 'rock', RealisticShape[]> {
  const committed = realisticVegetation('generated');
  const world = new Map<'tree-broadleaf' | 'tree-conifer' | 'shrub' | 'rock', RealisticShape[]>();
  const hosts = new Map<string, RealisticShape>();
  for (const kind of ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'] as const) {
    const tree = kind === 'tree-broadleaf' || kind === 'tree-conifer';
    world.set(
      kind,
      committed[kind].map((model) => {
        const shape = aShape(model.name, tree ? ['bark', 'leaves'] : ['plant'], tree);
        hosts.set(model.name, shape);
        return shape;
      }),
    );
  }
  for (const species of GROWN_SPECIES) {
    const host = hosts.get(species.host);
    const grown = host === undefined ? undefined : grownShapeOf(species, host);
    if (grown === undefined) throw new Error(`${species.id}: not grown`);
    world.get(species.kind)?.push(grown);
  }
  return world;
}

const shapeOf = (world: ReturnType<typeof aWorld>, name: string): RealisticShape => {
  for (const shapes of world.values()) {
    const found = shapes.find((shape) => shape.name === name);
    if (found !== undefined) return found;
  }
  throw new Error(`no shape ${name}`);
};

type Belt = RealisticVegetationBelt;
type DrawnMesh = Belt['meshes'][number];

/** The mesh a belt draws a shape's full level with: the one over its first part's own geometry. */
const nearMeshOf = (belt: Belt, shape: RealisticShape): DrawnMesh => {
  const mesh = belt.meshes.find((each) => each.geometry === shape.parts[0]?.geometry);
  if (mesh === undefined) throw new Error(`${shape.name}: no near mesh`);
  return mesh;
};

/** The meshes a belt draws impostors with: the ones wearing an impostor's own material. */
const farMeshOf = (belt: Belt, shape: RealisticShape): DrawnMesh => {
  const mesh = belt.meshes.find((each) => each.material === shape.impostor?.material);
  if (mesh === undefined) throw new Error(`${shape.name}: no far mesh`);
  return mesh;
};

/** One instance's matrix, read as where it is and how big it is along each of its axes. */
function placed(mesh: DrawnMesh, instance = 0) {
  const m = Array.from(mesh.instanceMatrix.array).slice(instance * 16, instance * 16 + 16);
  const column = (at: number): number => Math.hypot(m[at] ?? 0, m[at + 1] ?? 0, m[at + 2] ?? 0);
  return {
    x: m[12] ?? 0,
    y: m[13] ?? 0,
    z: m[14] ?? 0,
    across: column(0),
    up: column(4),
    // How far its own up-axis leans from the world's, radians.
    lean: Math.acos(Math.min(1, (m[5] ?? 0) / column(4))),
  };
}

const item = (kind: ScatterItem['kind'], extra: Partial<ScatterItem> = {}): ScatterItem => ({
  kind,
  x: 3,
  y: 0.5,
  z: 24,
  rotation: 0.4,
  scale: 1,
  variant: 0,
  ...extra,
});

describe('a species grown in code, dressed as its host — #3252', () => {
  const host = aShape('generated_hornbeam_a', ['bark', 'leaves'], true);
  const lime = GROWN_SPECIES.find((species) => species.id === 'grown_lime');
  if (lime === undefined) throw new Error('no lime');
  const grown = grownShapeOf(lime, host);

  it('is its own wood and leaf cards in the HOST’S own maps, at both levels', () => {
    if (grown === undefined) throw new Error('not grown');
    const tree = growTree(lime);
    expect(grown.name).toBe('grown_lime');
    expect(grown.triangles).toBe(tree.full.triangles);
    expect(grown.middle?.triangles).toBe(tree.middle?.triangles);
    expect(grown.extent).toBeCloseTo(Math.max(tree.heightMetres, tree.widthMetres), 6);
    expect(grown.parts.map((part) => part.material.name)).toEqual(['bark', 'leaves']);
    for (const [index, part] of grown.parts.entries()) {
      const hosted = host.parts[index]?.material;
      // The host's images, and a material of its own: nothing is loaded twice.
      expect(part.material).not.toBe(hosted);
      expect(part.material.map).toBe(hosted?.map);
      expect(part.material.normalMap).toBe(hosted?.normalMap);
      expect(part.material.alphaTest).toBe(hosted?.alphaTest);
      expect(part.material.vertexColors).toBe(true);
      expect(part.geometry.getAttribute('color').count).toBe(
        part.geometry.getAttribute('position').count,
      );
    }
    // The leaves are cut and the bark is not, as the host's are.
    expect(grown.parts[1]?.material.alphaTest).toBeGreaterThan(0);
    expect(grown.parts[0]?.material.alphaTest).toBe(0);
    // The middle level wears the full level's two materials: no third.
    expect(grown.middle?.parts.map((part) => part.material)).toEqual(
      grown.parts.map((part) => part.material),
    );
    expect(grown.impostor).toBeUndefined();
  });

  it('is drawn far off as its host’s impostor, scaled to its own height', () => {
    const tree = growTree(lime);
    expect(grown?.far).toEqual({
      host: 'generated_hornbeam_a',
      scale: tree.heightMetres / HOST.height,
    });
  });

  it('is nothing for a host that is not a generated tree: a scan, or a shape with other materials', () => {
    expect(
      grownShapeOf(lime, aShape('island_tree_02', ['branches', 'leaves'], true)),
    ).toBeUndefined();
    expect(grownShapeOf(lime, aShape('boulder_01', ['plant'], false))).toBeUndefined();
  });

  it('a bush is one level and no far band, as every shrub is', () => {
    const thorn = GROWN_SPECIES.find((species) => species.id === 'grown_thorn');
    if (thorn === undefined) throw new Error('no thorn');
    const bush = grownShapeOf(thorn, aShape('generated_oak_c', ['bark', 'leaves'], true));
    expect(bush?.middle).toBeUndefined();
    expect(bush?.far).toBeUndefined();
    expect(bush?.triangles).toBeLessThanOrEqual(REALISTIC_GROWN_TRIANGLES.shrub.full);
  });

  it('names the materials the COMMITTED generated trees carry, read off their files', () => {
    for (const hostName of new Set(GROWN_SPECIES.map((species) => species.host))) {
      const json = readGlb(join(SHIPPED, `${hostName}.glb`)).json as unknown as {
        readonly materials: readonly { readonly name: string }[];
      };
      expect(json.materials.map((material) => material.name).sort(), hostName).toEqual(
        [GROWN_HOST_MATERIALS.bark, GROWN_HOST_MATERIALS.leaves].sort(),
      );
    }
  });
});

describe('which shape a setting’s item is drawn as — #3252', () => {
  it('draws a park’s tree as the lime and the same slot with no setting as the oak it was', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    belt.update([item('tree-broadleaf', { setting: 'park' })], POSE);
    expect(nearMeshOf(belt, shapeOf(world, 'grown_lime')).count).toBe(1);
    expect(nearMeshOf(belt, shapeOf(world, 'generated_oak_a')).count).toBe(0);
    belt.update([item('tree-broadleaf')], POSE);
    expect(nearMeshOf(belt, shapeOf(world, 'grown_lime')).count).toBe(0);
    expect(nearMeshOf(belt, shapeOf(world, 'generated_oak_a')).count).toBe(1);
    belt.dispose();
  });

  it('draws a hedgerow’s bush as the thorn, a park’s as the laurel and a wild one as the scrub', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const drawnAs = (setting: ScatterItem['setting']): string[] => {
      belt.update([item('shrub', setting === undefined ? {} : { setting })], POSE);
      return (world.get('shrub') ?? [])
        .filter((shape) => nearMeshOf(belt, shape).count === 1)
        .map((shape) => shape.name);
    };
    expect(drawnAs('hedgerow')).toEqual(['grown_thorn']);
    expect(drawnAs('park')).toEqual(['grown_laurel']);
    expect(drawnAs(undefined)).toEqual(['shrub_02_a']);
    expect(drawnAs('wood')).toEqual(['shrub_02_a']);
    belt.dispose();
  });

  it('CONTROL: a world without the grown species folds the variant into what it has, whatever the setting', () => {
    const world = aWorld();
    for (const [kind, shapes] of world) {
      world.set(
        kind,
        shapes.filter((shape) => !shape.name.startsWith('grown_')),
      );
    }
    const belt = new RealisticVegetationBelt(world);
    belt.update([item('tree-broadleaf', { setting: 'park', variant: 5 })], POSE);
    // 5 % 4: the second shape, as before #3252.
    expect(nearMeshOf(belt, shapeOf(world, 'generated_hornbeam_a')).count).toBe(1);
    belt.dispose();
  });
});

describe('how big and how built an instance is drawn — #3252', () => {
  it('sizes a park’s lime by its age there and builds it taller or stouter by where it stands', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const lime = shapeOf(world, 'grown_lime');
    const tree = item('tree-broadleaf', { setting: 'park', scale: 1.2 });
    belt.update([tree], POSE);
    const drawn = placed(nearMeshOf(belt, lime));
    const size =
      (sceneryFitMetres('tree-broadleaf') * 1.2 * ageScale('park', 'grown_lime', tree.x, tree.z)) /
      lime.extent;
    const build = instanceBuild('park', tree.x, tree.z, { height: 0, girth: 0 });
    expect(ageScale('park', 'grown_lime', tree.x, tree.z)).toBeGreaterThan(1.1);
    expect(drawn.up).toBeCloseTo(size * build.height, 5);
    expect(drawn.across).toBeCloseTo(size * build.girth, 5);
    expect(drawn.up).not.toBeCloseTo(drawn.across, 3);
    expect([drawn.x, drawn.y, drawn.z]).toEqual([tree.x, tree.y, tree.z]);
    belt.dispose();
  });

  it('draws the world with no map at the size it was: its fit and its scale, the same every way', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const oak = shapeOf(world, 'generated_oak_a');
    belt.update([item('tree-broadleaf', { scale: 1.2 })], POSE);
    const drawn = placed(nearMeshOf(belt, oak));
    const size = (sceneryFitMetres('tree-broadleaf') * 1.2) / oak.extent;
    expect(drawn.up).toBeCloseTo(size, 6);
    expect(drawn.across).toBeCloseTo(size, 6);
    belt.dispose();
  });
});

describe('a grown tree’s far band is its host’s own mesh — #3252', () => {
  /** Every tree an impostor: no full and no middle slot. */
  const FAR_ONLY = { ...HARD_SWAP_TREE_LEVELS, near: 0 };

  it('adds no far mesh: as many impostor meshes with the grown species as without', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const impostors = (each: Belt): number =>
      each.meshes.filter((mesh) =>
        [...world.values()].flat().some((shape) => shape.impostor?.material === mesh.material),
      ).length;
    // Four broadleaves and two firs are committed; four more trees are grown.
    expect(impostors(belt)).toBe(6);
    expect(new Set(belt.meshes).size).toBe(belt.meshes.length);
    belt.dispose();
  });

  it('draws a far lime in the hornbeam’s impostor mesh, beside a hornbeam, at the lime’s own height', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world, FAR_ONLY);
    const lime = shapeOf(world, 'grown_lime');
    const hornbeam = shapeOf(world, 'generated_hornbeam_a');
    const parkTree = item('tree-broadleaf', { setting: 'park', z: 40 });
    belt.update([parkTree, item('tree-broadleaf', { variant: 1, z: 60 })], POSE);
    const far = farMeshOf(belt, hornbeam);
    expect(far.count).toBe(2);
    expect(nearMeshOf(belt, lime).count).toBe(0);
    const fit = sceneryFitMetres('tree-broadleaf');
    const limeSize = (fit * ageScale('park', 'grown_lime', parkTree.x, parkTree.z)) / lime.extent;
    const build = instanceBuild('park', parkTree.x, parkTree.z, { height: 0, girth: 0 });
    // The host's picture is HOST.height units tall: scaled, it stands as tall as the lime.
    expect(placed(far, 0).up * HOST.height).toBeCloseTo(
      limeSize * build.height * (lime.height ?? 0),
      4,
    );
    // And the hornbeam beside it is drawn at its own size, as it was.
    expect(placed(far, 1).up).toBeCloseTo(fit / hornbeam.extent, 6);
    belt.dispose();
  });
});

describe('a rock sits in the ground — #3252', () => {
  it('is set into the ground by its seat’s share of its drawn height, and tipped', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const boulder = shapeOf(world, 'boulder_01');
    const rock = item('rock', { x: 4, z: 18, scale: 0.9 });
    belt.update([rock], POSE);
    const drawn = placed(nearMeshOf(belt, boulder));
    const seat = rockSeat(rock.x, rock.z, { sink: 0, tilt: 0, azimuth: 0 });
    const geometry = boulder.parts[0]?.geometry;
    geometry?.computeBoundingBox();
    const height = geometry?.boundingBox?.max.y ?? 0;
    const size = (sceneryFitMetres('rock') * 0.9) / boulder.extent;
    expect(height).toBeGreaterThan(0);
    expect(drawn.y).toBeCloseTo(rock.y - seat.sink * height * size, 6);
    expect(drawn.y).toBeLessThan(rock.y - ROCK_SEAT.sink[0] * height * size + 1e-9);
    expect(drawn.lean).toBeCloseTo(seat.tilt, 5);
    expect(seat.tilt).toBeGreaterThan(0.01);
    expect([drawn.x, drawn.z]).toEqual([rock.x, rock.z]);
    belt.dispose();
  });

  it('CONTROL: a shrub beside it stands on the ground, upright', () => {
    const world = aWorld();
    const belt = new RealisticVegetationBelt(world);
    const shrub = item('shrub', { x: 4, z: 18 });
    belt.update([shrub], POSE);
    const drawn = placed(nearMeshOf(belt, shapeOf(world, 'shrub_02_a')));
    expect(drawn.y).toBe(shrub.y);
    expect(drawn.lean).toBeCloseTo(0, 6);
    belt.dispose();
  });
});

/** A geometry's triangles, indexed or not. */
const trianglesOf = (geometry: Geometry): number =>
  (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;

/** A geometry's lowest and highest value along an axis, over the vertices `keep` admits. */
function span(geometry: Geometry, axis: 0 | 1 | 2, keep: (at: number) => boolean = () => true) {
  const position = geometry.getAttribute('position');
  let low = Infinity;
  let high = -Infinity;
  for (let at = 0; at < position.count; at += 1) {
    if (!keep(at)) continue;
    const value = position.getComponent(at, axis);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { low, high };
}

describe('the realistic stone wall is a drystone wall — #3252', () => {
  const wall = stoneWallGeometry();
  const position = wall.getAttribute('position');

  it('is battered and coped: narrower at its top than its foot, its top broken and not ruled', () => {
    const foot = span(wall, 0, (at) => position.getY(at) < -0.4);
    const head = span(wall, 0, (at) => position.getY(at) > 0.8 && position.getY(at) < 0.85);
    expect(foot.high - foot.low).toBeCloseTo(0.6, 6);
    expect(head.high - head.low).toBeLessThan(0.5);
    // The copes' tops: tall and short in turn, and no two the same height.
    const tops = new Set<string>();
    for (let at = 0; at < position.count; at += 1) {
      if (position.getY(at) > 0.9) tops.add(position.getY(at).toFixed(4));
    }
    expect(tops.size).toBe(STONE_WALL_COPES);
    const heights = [...tops].map(Number);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.08);
  });

  it('keeps the field wall’s footprint and its seat in the ground, inside a structure’s triangles', () => {
    const footprint = STRUCTURE_FOOTPRINTS.wall;
    expect(span(wall, 0).high).toBeLessThanOrEqual(footprint.x + 1e-6);
    expect(span(wall, 0).low).toBeGreaterThanOrEqual(-footprint.x - 1e-6);
    expect(span(wall, 2).low).toBeCloseTo(footprint.back, 6);
    expect(span(wall, 2).high).toBeCloseTo(footprint.front, 6);
    expect(span(wall, 1).low).toBeCloseTo(-0.5, 6);
    expect(trianglesOf(wall)).toBe(12 + STONE_WALL_COPES * 12);
    expect(trianglesOf(wall)).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
  });

  it('is what the realistic world’s wall wears its stone on', () => {
    const drawn = realisticStructureGeometry('wall', 'stone');
    if (drawn === undefined) throw new Error('a realistic wall wears stone');
    expect(trianglesOf(drawn)).toBe(trianglesOf(wall));
    expect(span(drawn, 1).high).toBeCloseTo(span(wall, 1).high, 6);
    drawn.dispose();
  });
});

describe('the timber fence and the noise barrier, the fence’s second variant in one mesh — #3252', () => {
  const facts = chainLinkFacts(join(SHIPPED, REALISTIC_CHAIN_LINK.model));
  const chainLink = { geometry: facts, wire: aTexture() };
  const fence = (z: number, extra: Partial<ScatterItem>): ScatterItem => ({
    kind: 'fence',
    x: 8,
    y: 0,
    z,
    rotation: 0,
    scale: 1,
    variant: 0,
    ...extra,
  });
  const field = (): Geometry => {
    const plain = realisticStructureGeometry('fence', 'planks');
    if (plain === undefined) throw new Error('a realistic fence wears planks');
    const chained = chainLinkFenceGeometry(plain, facts);
    plain.dispose();
    return chained;
  };
  const partsOf = (geometry: Geometry): number[] =>
    Array.from(geometry.getAttribute(CHAIN_LINK_PART_ATTRIBUTE).array as Float32Array);
  const TIMBER = { boundary: 'timber-fence', variant: 1 } as const;
  const BARRIER = { boundary: 'noise-barrier', variant: 1 } as const;

  it('builds the timber fence head-high in boards and the barrier 3 m in panels, on the fence’s line', () => {
    const like = field();
    const built = builtFenceGeometry(like);
    const parts = partsOf(built);
    const timber = (at: number): boolean => parts[at] === 0;
    const barrier = (at: number): boolean => parts[at] === 1;
    expect(parts.filter((part) => part === 0)).toHaveLength(96 * 3);
    expect(parts.filter((part) => part === 1)).toHaveLength(120 * 3);
    expect(parts).toHaveLength(built.getAttribute('position').count);
    // An instance submits both: inside one structure's triangles.
    expect(trianglesOf(built)).toBe(216);
    expect(trianglesOf(built)).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
    // Every attribute the field fence's mesh carries, so one material draws both meshes.
    expect(Object.keys(built.attributes).sort()).toEqual(Object.keys(like.attributes).sort());
    const footprint = STRUCTURE_FOOTPRINTS.fence;
    for (const which of [timber, barrier]) {
      expect(span(built, 2, which).low).toBeCloseTo(footprint.back, 6);
      expect(span(built, 2, which).high).toBeCloseTo(footprint.front, 6);
      expect(span(built, 0, which).high).toBeLessThanOrEqual(footprint.x + 1e-6);
      expect(span(built, 0, which).low).toBeGreaterThanOrEqual(-footprint.x - 1e-6);
      // Set into the ground, as every field boundary is.
      expect(span(built, 1, which).low).toBeLessThanOrEqual(-0.4);
    }
    expect(span(built, 1, timber).high).toBeCloseTo(1.8, 6);
    expect(span(built, 1, barrier).high).toBeCloseTo(NOISE_BARRIER_METRES + 0.1, 6);
    // The barrier is drawn in its own colours, a colour a vertex: two greys
    // of panel, a tinted band and steel posts.
    const colour = built.getAttribute('color');
    const greens = new Set<string>();
    for (let at = 0; at < colour.count; at += 1) {
      if (barrier(at)) greens.add(colour.getY(at).toFixed(3));
    }
    expect(greens.size).toBe(4);
    like.dispose();
    built.dispose();
  });

  it('draws both in the built fences’ ONE mesh, and only where one stands', () => {
    const belts = new RealisticStructureBelts(new Map(), chainLink);
    const meshes = belts.beltOf('planks')?.meshesOf('fence') ?? [];
    // The field fence with the chain-link folded in, and the built fences.
    expect(meshes).toHaveLength(2);
    const [fields, built] = meshes as [(typeof meshes)[number], (typeof meshes)[number]];
    expect(trianglesOf(built.geometry)).toBe(216);
    belts.update(
      [
        fence(20, {}),
        fence(30, { chainLink: true }),
        fence(40, TIMBER),
        fence(50, BARRIER),
        fence(60, BARRIER),
      ],
      POSE,
    );
    expect([fields.count, built.count]).toEqual([2, 3]);
    // What each instance's material is told: 1, its own vertices' colours
    // (the chain-link, the barrier), or 0, the planks (the field fence, the timber).
    const told = (mesh: (typeof meshes)[number], instance: number): number =>
      mesh.geometry.getAttribute(CHAIN_LINK_SHAPE_ATTRIBUTE).getX(instance);
    expect([told(fields, 0), told(fields, 1)]).toEqual([0, 1]);
    expect([told(built, 0), told(built, 1), told(built, 2)]).toEqual([0, 1, 1]);
    // A frame of field fences alone draws none of it: no instance, so no call and no triangle.
    belts.update([fence(20, {}), fence(30, {})], POSE);
    expect([fields.count, built.count]).toEqual([2, 0]);
    expect([fields.visible, built.visible]).toEqual([true, false]);
    // And the field fence's own mesh is what it was: its triangles, and the chain-link's.
    expect(trianglesOf(fields.geometry)).toBe(trianglesOf(field()));
    belts.dispose();
  });

  it('shows the fence an instance is and folds the other away, by the fold its material runs', () => {
    const program = new GlslProgram(
      `vec3 fold(float ${CHAIN_LINK_PART_ATTRIBUTE}, float ${CHAIN_LINK_SHAPE_ATTRIBUTE}, vec3 transformed) { float vOylChain = 0.0; ${CHAIN_LINK_FOLD_GLSL} return transformed; }`,
    );
    const at = [0.3, 0.8, -1.2];
    const timber = fenceFoldOf({ boundary: 'timber-fence' });
    const barrier = fenceFoldOf({ boundary: 'noise-barrier' });
    // The timber's vertices are part 0, the barrier's part 1.
    expect(program.call('fold', 0, timber, at)).toEqual(at);
    expect(program.call('fold', 1, timber, at)).toEqual([0, 0, 0]);
    expect(program.call('fold', 1, barrier, at)).toEqual(at);
    expect(program.call('fold', 0, barrier, at)).toEqual([0, 0, 0]);
  });

  it('CONTROL: with no chain-link loaded nothing folds, and a built fence is the timber fence alone', () => {
    const belts = new RealisticStructureBelts(new Map());
    const meshes = belts.beltOf('planks')?.meshesOf('fence') ?? [];
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      expect(mesh.geometry.getAttribute(CHAIN_LINK_PART_ATTRIBUTE)).toBeUndefined();
    }
    expect(trianglesOf((meshes[1] as (typeof meshes)[number]).geometry)).toBe(96);
    belts.update([fence(20, BARRIER)], POSE);
    expect(meshes.map((mesh) => mesh.count)).toEqual([0, 1]);
    belts.dispose();
  });
});
