// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The people's bodies — #1541, and the owner's request of 2026-11-18: real
 * models. The committed model is read back through glTF 2.0's own accessors,
 * which is what a loader reads, and held to the budgets its drawing spends:
 * a body's triangles, sixteen of them in a frame, and the two data textures.
 * What jsdom cannot do — pose them, draw them, count the call —
 * `browser/game.browser.spec.ts` §"#1541" does.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GAITS } from './gait';
import { GlslProgram } from './glsl-program-testing';
import { readGlb, type GlbFile } from './model-bytes-testing';
import {
  ANIMATION_BYTES_PER_TEXEL,
  ANIMATION_MAX_WIDTH,
  GAIT_ROWS,
  NORMAL_STEPS,
  PEOPLE_BODIES_MAX,
  PERSON_ANIMATION_MAX_BYTES,
  PERSON_MAX_TRIANGLES,
  PHASES,
  PersonRegion,
  RIDE_GAIT_INDEX,
  RIDE_PHASES,
  SLOT_REGIONS,
  SLOT_WIDTH,
  animationLayout,
  animationTexel,
  gaitRow,
  packNormal,
  peopleTextureBytes,
  regionNamed,
  slotRows,
  slotTexel,
  unpackNormal,
  vertexNormals,
  weld,
} from './people-body';
import { PEOPLE_NEAR_MAX } from './people';
import { REALISTIC_PEOPLE, REALISTIC_RIDER } from './realistic-assets';
import { REALISTIC_PEOPLE_TRIANGLES, REALISTIC_TEXTURE_PIXELS } from './realistic-budget';
import { fileKtx2Facts } from './realistic-bytes-testing';
import { PEOPLE_NORMAL_GLSL } from './three-renderer';

const shipped = (file: string): string =>
  fileURLToPath(new URL(`../../public/realistic/${file}`, import.meta.url));

const COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

/** Any accessor of the file, flattened to numbers. */
function accessor(file: GlbFile, index: number): number[] {
  const described = file.json.accessors?.[index];
  if (described === undefined) throw new Error(`no accessor ${String(index)}`);
  const components = COMPONENTS[described.type] as number;
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[described.componentType] as number;
  const view = file.json.bufferViews?.[described.bufferView];
  const stride = view?.byteStride ?? components * size;
  const base = (view?.byteOffset ?? 0) + (described.byteOffset ?? 0);
  const data = new DataView(file.binary.buffer, file.binary.byteOffset, file.binary.byteLength);
  const out: number[] = [];
  for (let element = 0; element < described.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      const at = base + element * stride + component * size;
      out.push(
        described.componentType === 5126
          ? data.getFloat32(at, true)
          : described.componentType === 5125
            ? data.getUint32(at, true)
            : described.componentType === 5123
              ? data.getUint16(at, true)
              : data.getUint8(at),
      );
    }
  }
  return out;
}

/** What the tests read of a file's nodes and skins, which `GltfDocument` does not type. */
interface Rigged {
  readonly nodes: readonly {
    readonly name?: string;
    readonly mesh?: number;
    readonly skin?: number;
  }[];
  readonly skins: readonly {
    readonly joints: readonly number[];
    readonly inverseBindMatrices: number;
  }[];
  readonly meshes: readonly {
    readonly name?: string;
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices: number;
      readonly material?: number;
    }[];
  }[];
}

/** One person of the committed model, read as the renderer reads a loader's scene. */
interface PersonRead {
  readonly name: string;
  readonly triangles: number;
  /** Three numbers a vertex, every primitive's in turn. */
  readonly positions: number[];
  readonly regions: string[];
  /** Each primitive's texture coordinates' bounds: `[uMin, vMin, uMax, vMax]`. */
  readonly uvBounds: readonly [number, number, number, number];
  readonly joints: string[];
  readonly inverseBind: number[];
}

function peopleOf(file: GlbFile): PersonRead[] {
  const rigged = file.json as unknown as Rigged;
  return rigged.nodes
    .filter((node) => node.mesh !== undefined && node.skin !== undefined)
    .map((node) => {
      const mesh = rigged.meshes[node.mesh as number];
      const skin = rigged.skins[node.skin as number];
      if (mesh === undefined || skin === undefined) throw new Error('a person with no mesh');
      const positions: number[] = [];
      const regions: string[] = [];
      let triangles = 0;
      const bounds: [number, number, number, number] = [1, 1, 0, 0];
      for (const primitive of mesh.primitives) {
        positions.push(...accessor(file, primitive.attributes['POSITION'] as number));
        triangles += (file.json.accessors?.[primitive.indices]?.count ?? 0) / 3;
        regions.push(file.json.materials?.[primitive.material ?? -1]?.name ?? '');
        const uv = accessor(file, primitive.attributes['TEXCOORD_0'] as number);
        for (let at = 0; at < uv.length; at += 2) {
          bounds[0] = Math.min(bounds[0], uv[at] as number);
          bounds[1] = Math.min(bounds[1], uv[at + 1] as number);
          bounds[2] = Math.max(bounds[2], uv[at] as number);
          bounds[3] = Math.max(bounds[3], uv[at + 1] as number);
        }
      }
      return {
        name: node.name ?? '',
        triangles,
        positions,
        regions,
        uvBounds: bounds,
        joints: skin.joints.map((joint) => rigged.nodes[joint]?.name ?? ''),
        inverseBind: accessor(file, skin.inverseBindMatrices),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

const PEOPLE = peopleOf(readGlb(shipped(REALISTIC_PEOPLE.model)));

describe('the people are models — the owner’s request of 2026-11-18', () => {
  it('ships more than one person, each a body of every region, inside a body’s triangles', () => {
    expect(PEOPLE.map((person) => person.name)).toEqual(['person-a', 'person-b', 'person-c']);
    expect(PEOPLE.length).toBeLessThanOrEqual(PEOPLE_BODIES_MAX);
    for (const person of PEOPLE) {
      expect(person.triangles, person.name).toBeLessThanOrEqual(PERSON_MAX_TRIANGLES);
      // A person, not a remnant: the pipeline cuts to 1 800 and lands just under.
      expect(person.triangles, person.name).toBeGreaterThan(1_700);
      // Dressed: skin, a top, bottoms, shoes and hair, and nothing of no region.
      expect([...person.regions].sort(), person.name).toEqual(Object.keys(PersonRegion).sort());
      for (const region of person.regions) expect(regionNamed(region)).not.toBeUndefined();
    }
    // Sixteen of the largest: #1541's "about 32k triangles".
    expect(REALISTIC_PEOPLE_TRIANGLES).toBe(PEOPLE_NEAR_MAX * PERSON_MAX_TRIANGLES);
  });

  it('keeps each person’s texture coordinates in their own row of the atlas', () => {
    PEOPLE.forEach((person, row) => {
      const [uMin, vMin, uMax, vMax] = person.uvBounds;
      expect(uMin).toBeGreaterThanOrEqual(0);
      expect(uMax).toBeLessThanOrEqual(1);
      // glTF's v runs down the picture and the atlas's rows run up it: the
      // first person's row is the last quarter.
      expect(vMin, person.name).toBeGreaterThanOrEqual(1 - (row + 1) / PEOPLE_BODIES_MAX);
      expect(vMax, person.name).toBeLessThanOrEqual(1 - row / PEOPLE_BODIES_MAX);
    });
    const atlas = fileKtx2Facts(shipped(REALISTIC_PEOPLE.atlas));
    expect([atlas.width, atlas.height]).toEqual([
      REALISTIC_TEXTURE_PIXELS.people,
      REALISTIC_TEXTURE_PIXELS.people,
    ]);
  });

  it('bakes their walk, run and ride into under 1 MiB, which a normal row of its own would not fit', () => {
    const columns = PEOPLE.map((person) => weld(person.positions).first.length);
    const triangles = PEOPLE.map((person) => person.triangles);
    const bytes = peopleTextureBytes(columns, triangles);
    expect(bytes).toBeLessThanOrEqual(PERSON_ANIMATION_MAX_BYTES);
    expect(bytes).toBeGreaterThan(PERSON_ANIMATION_MAX_BYTES / 2);
    // Welded: a vertex the file repeats for a seam is one column.
    PEOPLE.forEach((person, at) => {
      expect(columns[at]).toBeLessThan(person.positions.length / 3);
    });
    // The control: with the normals in rows of their own, as they were while
    // one body filled the texture, the animation alone is over the ceiling.
    const layout = animationLayout(columns);
    expect(2 * layout.width * layout.height * ANIMATION_BYTES_PER_TEXEL).toBeGreaterThan(
      PERSON_ANIMATION_MAX_BYTES,
    );
  });

  it('gives every person the rider’s 24 bones, and the first the rider’s own joints — #2722', () => {
    const rider = readGlb(shipped(REALISTIC_RIDER));
    const rigged = rider.json as unknown as Rigged;
    const skin = rigged.skins[0];
    if (skin === undefined) throw new Error('the rider has no skin');
    const riderJoints = skin.joints.map((joint) => rigged.nodes[joint]?.name ?? '');
    const riderInverse = accessor(rider, skin.inverseBindMatrices);
    for (const person of PEOPLE) expect(person.joints, person.name).toEqual(riderJoints);
    const [first, second] = PEOPLE;
    if (first === undefined || second === undefined) throw new Error('nobody');
    // A scenery cyclist is the first person skinned by the seated RIDER's
    // bones: its rest joints must be where the rider's are.
    const apart = (person: PersonRead): number =>
      Math.max(...person.inverseBind.map((value, at) => Math.abs(value - (riderInverse[at] ?? 0))));
    expect(apart(first)).toBeLessThan(1e-4);
    // The control: another build's joints are somewhere else.
    expect(apart(second)).toBeGreaterThan(0.01);
  });
});

describe('the people’s animation texture', () => {
  it('lays the bodies side by side, wrapped into blocks no device’s texture is too narrow for', () => {
    const narrow = animationLayout([1000, 1200, 1300]);
    expect(narrow.blocks).toBe(2);
    expect(narrow.width).toBe(1750);
    expect(narrow.width).toBeLessThanOrEqual(ANIMATION_MAX_WIDTH);
    expect(narrow.base).toEqual([0, 1000, 2200]);
    expect(narrow.height).toBe(2 * GAIT_ROWS + RIDE_PHASES);
    const one = animationLayout([900]);
    expect([one.blocks, one.width, one.height]).toEqual([1, 900, GAIT_ROWS + RIDE_PHASES]);
    // A first body wider than a block has nowhere for its ride's rows.
    expect(() => animationLayout([3000, 100, 100, 100])).toThrow(/wider than a block/);
  });

  it('gives every column, gait and phase a texel of its own, the ride after every block', () => {
    const layout = animationLayout([1000, 1200, 1300]);
    expect(GAIT_ROWS).toBe(PHASES.walk + PHASES.run);
    expect(gaitRow(0)).toBe(0);
    expect(gaitRow(1)).toBe(PHASES.walk);
    expect(RIDE_GAIT_INDEX).toBe(GAITS.length);
    const seen = new Set<string>();
    const take = (column: number, gait: number, phase: number): void => {
      const texel = animationTexel(layout, column, gait, phase);
      expect(texel.x).toBeLessThan(layout.width);
      expect(texel.y).toBeLessThan(layout.height);
      const key = `${String(texel.x)},${String(texel.y)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    };
    for (const column of [0, 999, 1000, 1749, 1750, 3499]) {
      GAITS.forEach((gait, gaitAt) => {
        for (let phase = 0; phase < PHASES[gait]; phase += 1) take(column, gaitAt, phase);
      });
    }
    // The ride: the first body's columns only.
    for (const column of [0, 999]) {
      for (let phase = 0; phase < RIDE_PHASES; phase += 1) take(column, RIDE_GAIT_INDEX, phase);
    }
    expect(animationTexel(layout, 5, RIDE_GAIT_INDEX, 0)).toEqual({ x: 5, y: 2 * GAIT_ROWS });
    expect(animationTexel(layout, 1750, 1, 0)).toEqual({ x: 0, y: GAIT_ROWS + PHASES.walk });
  });

  it('numbers a body’s corners into rows of the slot texture, a body after a body', () => {
    expect(slotRows(1_800)).toBe(Math.ceil(5_400 / SLOT_WIDTH));
    expect(slotTexel(0, 0, 1_800)).toEqual({ x: 0, y: 0 });
    expect(slotTexel(0, SLOT_WIDTH, 1_800)).toEqual({ x: 0, y: 1 });
    expect(slotTexel(2, 5_399, 1_800)).toEqual({
      x: 5_399 % SLOT_WIDTH,
      y: 2 * slotRows(1_800) + Math.floor(5_399 / SLOT_WIDTH),
    });
    // A slot's second number holds a block and a region, both whole and apart.
    expect(Math.max(...Object.values(PersonRegion))).toBeLessThan(SLOT_REGIONS);
    expect(peopleTextureBytes([100], [10])).toBe(
      (100 * (GAIT_ROWS + RIDE_PHASES) + SLOT_WIDTH * 1) * ANIMATION_BYTES_PER_TEXEL,
    );
  });

  it('welds only vertices at exactly the same place', () => {
    const welded = weld([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1e-7, 1, 0, 0]);
    expect([...welded.column]).toEqual([0, 1, 0, 2, 1]);
    expect([...welded.first]).toEqual([0, 1, 3]);
  });

  it('packs a normal into one whole number a half float holds, and brings it back within 4°', () => {
    const glsl = new GlslProgram(PEOPLE_NORMAL_GLSL);
    let worst = 0;
    let shaderApart = 0;
    for (let ring = 0; ring <= 60; ring += 1) {
      const theta = (ring / 60) * Math.PI;
      for (let segment = 0; segment < 120; segment += 1) {
        const phi = (segment / 120) * 2 * Math.PI;
        const normal = [
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        ] as const;
        const packed = packNormal(...normal);
        expect(Number.isInteger(packed)).toBe(true);
        // A half float holds every whole number from −2 048 to 2 048, and no further.
        expect(Math.abs(packed)).toBeLessThanOrEqual(2048);
        expect(NORMAL_STEPS * NORMAL_STEPS).toBeLessThanOrEqual(4096);
        const back = unpackNormal(packed);
        const along = back[0] * normal[0] + back[1] * normal[1] + back[2] * normal[2];
        worst = Math.max(worst, Math.acos(Math.min(1, along)));
        // The shader's own text gives what the twin gives.
        const drawn = glsl.call('oylNormalOf', packed) as readonly number[];
        shaderApart = Math.max(
          shaderApart,
          Math.hypot(
            (drawn[0] ?? 0) - back[0],
            (drawn[1] ?? 0) - back[1],
            (drawn[2] ?? 0) - back[2],
          ),
        );
      }
    }
    expect((worst * 180) / Math.PI).toBeLessThan(4);
    expect(shaderApart).toBeLessThan(1e-9);
    // Up is up and down is down: the two halves of the map do not fold together.
    expect(unpackNormal(packNormal(0, 1, 0))[1]).toBeGreaterThan(0.99);
    expect(unpackNormal(packNormal(0, -1, 0))[1]).toBeLessThan(-0.99);
  });

  it('turns each vertex’s normal out of its triangles', () => {
    // One triangle in the ground plane, wound to face up.
    const normals = vertexNormals([0, 0, 0, 0, 0, 1, 1, 0, 0], [0, 1, 2]);
    expect([...normals]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    // A vertex no triangle uses still gets a unit normal.
    const spare = vertexNormals([0, 0, 0, 0, 0, 1, 1, 0, 0, 5, 5, 5], [0, 1, 2]);
    expect([...spare.slice(9)]).toEqual([0, 1, 0]);
  });

  it('names a region by its material’s name, and nothing else', () => {
    expect(regionNamed('skin')).toBe(PersonRegion.skin);
    expect(regionNamed('hair')).toBe(PersonRegion.hair);
    expect(regionNamed('')).toBeUndefined();
    expect(regionNamed('toString')).toBeUndefined();
  });
});

describe('the seams between a person’s regions, straightened — the modeller’s pass of 2026-11-18', () => {
  /**
   * A strip of `columns` squares, two rows of triangles, standing in the XY
   * plane: a bottom row of vertices at `y = 0`, a top row at `y = 2`, and a
   * middle row whose heights alternate `1 ± tooth`. The bottom row is bottoms
   * and the rest a top, so of each lower square's two triangles one is
   * bottoms and one a top: the seam runs up a diagonal and down an upright,
   * square after square — the saw's edge a cut leaves.
   */
  function strip(
    columns: number,
    tooth: number,
  ): { positions: Float32Array; indices: number[]; regions: number[] } {
    const positions: number[] = [];
    const regions: number[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        const y = row === 1 ? 1 + (column % 2 === 0 ? tooth : -tooth) : row;
        positions.push(column, y, 0);
        regions.push(row === 0 ? PersonRegion.bottoms : PersonRegion.top);
      }
    }
    const indices: number[] = [];
    const wide = columns + 1;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = row * wide + column;
        indices.push(a, a + 1, a + wide, a + 1, a + wide + 1, a + wide);
      }
    }
    return { positions: Float32Array.from(positions), indices, regions };
  }
  /** The seam's own vertices: every one a triangle of each region uses. */
  function seamHeights(body: ReturnType<typeof strip>): number[] {
    const dress = dressed(body.indices, body.regions);
    const used = new Map<number, Set<number>>();
    dress.column.forEach((column, drawn) => {
      const set = used.get(column) ?? new Set<number>();
      set.add(dress.region[drawn] as number);
      used.set(column, set);
    });
    return [...used]
      .filter(([, set]) => set.size > 1)
      .map(([column]) => body.positions[column * 3 + 1] as number);
  }
  const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

  it('flattens a saw-toothed hem to a small part of its teeth, moving nothing that is not on a seam', () => {
    const body = strip(24, 0.3);
    const before = Float32Array.from(body.positions);
    const seamBefore = seamHeights(body);
    expect(spread(seamBefore)).toBeGreaterThan(0.5);
    const moved = straightenSeams(body.positions, body.indices, body.regions);
    expect(moved).toBeGreaterThan(20);
    // Away from the strip's two ends, where a seam stops and stays put.
    const inner = seamHeights(body).slice(4, -4);
    expect(spread(inner)).toBeLessThan(spread(seamBefore) * 0.2);
    // The same triangles and the same vertices: only seam vertices moved.
    let others = 0;
    const dress = dressed(body.indices, body.regions);
    const seam = new Set<number>();
    const seen = new Map<number, number>();
    dress.column.forEach((column, drawn) => {
      const region = dress.region[drawn] as number;
      if (seen.has(column) && seen.get(column) !== region) seam.add(column);
      seen.set(column, region);
    });
    for (let vertex = 0; vertex < body.regions.length; vertex += 1) {
      if (seam.has(vertex)) continue;
      for (let axis = 0; axis < 3; axis += 1) {
        if (body.positions[vertex * 3 + axis] !== before[vertex * 3 + axis]) others += 1;
      }
    }
    expect(others).toBe(0);
  });

  it('leaves a seam’s own loop the size it was — a waist is not pinched', () => {
    // A ring of 16 seam vertices round `y = 0`, radius 1, with a tooth up
    // and down: two rings of triangles either side of it.
    const count = 16;
    const positions: number[] = [];
    const regions: number[] = [];
    for (const [row, y] of [-1, 0, 1].entries()) {
      for (let at = 0; at < count; at += 1) {
        const angle = (at / count) * Math.PI * 2;
        const tooth = row === 1 ? (at % 2 === 0 ? 0.2 : -0.2) : 0;
        positions.push(Math.cos(angle), y + tooth, Math.sin(angle));
        regions.push(row === 0 ? PersonRegion.bottoms : PersonRegion.top);
      }
    }
    const indices: number[] = [];
    for (let row = 0; row < 2; row += 1) {
      for (let at = 0; at < count; at += 1) {
        const a = row * count + at;
        const b = row * count + ((at + 1) % count);
        indices.push(a, b, a + count, b, b + count, a + count);
      }
    }
    const body = Float32Array.from(positions);
    straightenSeams(body, indices, regions);
    const heights: number[] = [];
    const radii: number[] = [];
    for (let at = count; at < count * 2; at += 1) {
      heights.push(body[at * 3 + 1] as number);
      radii.push(Math.hypot(body[at * 3] as number, body[at * 3 + 2] as number));
    }
    expect(spread(heights)).toBeLessThan(0.08);
    // Taubin's step back: the ring is within 3 % of the radius it had, where
    // the step toward alone, as many times, leaves it under 60 %.
    expect(Math.min(...radii)).toBeGreaterThan(0.97);
    expect(Math.max(...radii)).toBeLessThan(1.03);
    expect(SEAM_SMOOTHING.back).toBeLessThan(-SEAM_SMOOTHING.toward);
  });

  it('is the same on every read, and adds nothing to draw', () => {
    const a = strip(12, 0.25);
    const b = strip(12, 0.25);
    const drawnBefore = dressed(a.indices, a.regions);
    straightenSeams(a.positions, a.indices, a.regions);
    straightenSeams(b.positions, b.indices, b.regions);
    expect([...a.positions]).toEqual([...b.positions]);
    const drawnAfter = dressed(a.indices, a.regions);
    expect(drawnAfter.indices.length).toBe(drawnBefore.indices.length);
    expect(drawnAfter.column.length).toBe(drawnBefore.column.length);
  });
});
