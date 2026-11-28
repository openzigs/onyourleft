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

import { GAITS, MOTIONS, STILL_POSES } from './gait';
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
  SKIN_LUMINANCE,
  SLOT_REGIONS,
  SLOT_WIDTH,
  animationLayout,
  animationTexel,
  gaitRow,
  packNormal,
  peopleTextureBytes,
  regionNamed,
  skinAlbedo,
  slotRows,
  slotTexel,
  unpackNormal,
  vertexNormals,
  weld,
} from './people-body';
import { CLOTHES, PEOPLE_NEAR_MAX, SKIN_TONES } from './people';
import { REALISTIC_PEOPLE, REALISTIC_RIDER } from './realistic-assets';
import { REALISTIC_PEOPLE_TRIANGLES, REALISTIC_TEXTURE_PIXELS } from './realistic-budget';
import { accessorValues, fileKtx2Facts } from './realistic-bytes-testing';
import {
  PEOPLE_COLOUR_GLSL,
  PEOPLE_NORMAL_GLSL,
  peopleSlotData,
  peopleSlotGlsl,
} from './three-renderer';

/** An IEEE half float's bits as the number they hold — how the GPU reads a texel. */
function halfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

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

/** A vertex of the committed model: where it is, its region, and the bone that moves it most. */
interface VertexRead {
  readonly at: readonly [number, number, number];
  readonly region: string;
  readonly bone: string;
}

/** Every vertex of each person, in the people's order, and where each bone's joint is at rest. */
function verticesOf(file: GlbFile): {
  readonly vertices: VertexRead[];
  readonly joint: (bone: string) => [number, number, number];
}[] {
  const rigged = file.json as unknown as Rigged;
  return rigged.nodes
    .filter((node) => node.mesh !== undefined && node.skin !== undefined)
    .sort((a, b) => ((a.name ?? '') < (b.name ?? '') ? -1 : 1))
    .map((node) => {
      const mesh = rigged.meshes[node.mesh as number];
      const skin = rigged.skins[node.skin as number];
      if (mesh === undefined || skin === undefined) throw new Error('a person with no mesh');
      const bones = skin.joints.map((joint) => rigged.nodes[joint]?.name ?? '');
      const inverse = accessor(file, skin.inverseBindMatrices);
      const vertices: VertexRead[] = [];
      for (const primitive of mesh.primitives) {
        const read = (name: string) =>
          accessorValues(file.json, file.binary, primitive.attributes[name] as number).values;
        const [position, joints, weights] = [read('POSITION'), read('JOINTS_0'), read('WEIGHTS_0')];
        const region = file.json.materials?.[primitive.material ?? -1]?.name ?? '';
        for (let vertex = 0; vertex < position.length / 3; vertex += 1) {
          let most = 0;
          for (let slot = 1; slot < 4; slot += 1) {
            if ((weights[vertex * 4 + slot] ?? 0) > (weights[vertex * 4 + most] ?? 0)) most = slot;
          }
          vertices.push({
            at: [
              position[vertex * 3] ?? 0,
              position[vertex * 3 + 1] ?? 0,
              position[vertex * 3 + 2] ?? 0,
            ],
            region,
            bone: bones[joints[vertex * 4 + most] ?? -1] ?? '',
          });
        }
      }
      return {
        vertices,
        // A rest joint is where its inverse bind matrix sends to the origin: −Rᵀt.
        joint: (bone: string): [number, number, number] => {
          const m = inverse.slice(bones.indexOf(bone) * 16, bones.indexOf(bone) * 16 + 16);
          const t = [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0] as const;
          return [0, 1, 2].map(
            (row) =>
              -(
                (m[row * 4] ?? 0) * t[0] +
                (m[row * 4 + 1] ?? 0) * t[1] +
                (m[row * 4 + 2] ?? 0) * t[2]
              ),
          ) as [number, number, number];
        },
      };
    });
}

const BODIES = verticesOf(readGlb(shipped(REALISTIC_PEOPLE.model)));

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
    // #3285: with the still poses' six rows a block, 1 714 × 64 texels of
    // animation and 256 × 66 of slots — 1 012 736 bytes, where the gaits and
    // the ride alone were 1 714 × 52, 848 192. A seventh still row a block
    // would leave 8 416; an eighth is over the ceiling.
    expect(animationLayout(columns)).toMatchObject({ width: 1714, blocks: 2, height: 64 });
    expect(bytes).toBe(1_012_736);
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

describe('the people, polished — the owner’s pictures of PR #2844', () => {
  it('has no thigh under the skirt to come through its front', () => {
    const [, woman] = BODIES;
    if (woman === undefined) throw new Error('nobody');
    const skirt = woman.vertices.filter((vertex) => vertex.region === 'bottoms');
    const hem = Math.min(...skirt.map((vertex) => vertex.at[1]));
    const waist = Math.max(...skirt.map((vertex) => vertex.at[1]));
    // A skirt: it stops above the knee.
    expect(hem).toBeGreaterThan(woman.joint('lowerleg01.L')[1]);
    const leg = woman.vertices.filter(
      (vertex) => vertex.region === 'skin' && /^(upperleg|lowerleg|pelvis|root)/.test(vertex.bone),
    );
    // A centimetre of slack for the collapse that cuts the leg's top ring.
    const under = leg.filter((vertex) => vertex.at[1] > hem + 0.01 && vertex.at[1] < waist);
    console.log(
      `PR #2844: the skirt hangs from ${waist.toFixed(3)} m to ${hem.toFixed(3)} m, over ${String(under.length)} of the leg's ${String(leg.length)} vertices`,
    );
    expect(under).toEqual([]);
    // Non-vacuity: she has legs, and they begin at the hem — not a hand's width below it.
    expect(leg.length).toBeGreaterThan(40);
    expect(Math.max(...leg.map((vertex) => vertex.at[1]))).toBeGreaterThan(hem - 0.05);
    // The control: the men's trousers hide their own legs, by MakeHuman's own list.
    for (const man of [BODIES[0], BODIES[2]]) {
      expect(
        man?.vertices.filter(
          (vertex) => vertex.region === 'skin' && vertex.bone.startsWith('upperleg'),
        ),
      ).toEqual([]);
    }
  });

  it('curls every hand: no finger reaches straight out past the wrist', () => {
    BODIES.forEach((body, person) => {
      for (const side of ['L', 'R']) {
        const wrist = body.joint(`wrist.${side}`);
        const elbow = body.joint(`lowerarm01.${side}`);
        const forearm = Math.hypot(...wrist.map((value, axis) => value - (elbow[axis] ?? 0)));
        const hand = body.vertices.filter(
          (vertex) => vertex.region === 'skin' && vertex.bone === `wrist.${side}`,
        );
        expect(hand.length).toBeGreaterThan(8);
        const reach = Math.max(
          ...hand.map((vertex) =>
            Math.hypot(...vertex.at.map((value, axis) => value - (wrist[axis] ?? 0))),
          ),
        );
        console.log(
          `PR #2844: person ${String(person)} hand ${side} reaches ${(reach / forearm).toFixed(3)} of its forearm past the wrist`,
        );
        // A flat hand is three quarters of a forearm long; a relaxed one's
        // fingertips are curled back to well inside that.
        expect(reach / forearm).toBeLessThan(0.66);
        // And it is still a hand, not a stump.
        expect(reach / forearm).toBeGreaterThan(0.4);
      }
    });
  });

  it('lights skin as skin: no tone as bright as it looks, the light ones deeper in colour, the deep ones their own', () => {
    const glsl = new GlslProgram(PEOPLE_COLOUR_GLSL);
    const linear = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const toneOf = (hex: number): [number, number, number] => [
      linear(hex >> 16),
      linear((hex >> 8) & 0xff),
      linear(hex & 0xff),
    ];
    const lightOf = (colour: readonly number[]): number =>
      colour.reduce((sum, value, channel) => sum + value * (SKIN_LUMINANCE[channel] ?? 0), 0);
    const [lightest, deepest] = [SKIN_TONES[0], SKIN_TONES[SKIN_TONES.length - 1]];
    if (lightest === undefined || deepest === undefined) throw new Error('no skin tones');
    for (const hex of SKIN_TONES) {
      const tone = toneOf(hex);
      const albedo = skinAlbedo(tone);
      // The shader's own text gives what the twin gives, from the packed colour.
      const drawn = glsl.call('oylColourOf', 0, hex, 0, 0, 0, 0) as readonly number[];
      albedo.forEach((value, channel) => expect(drawn[channel]).toBeCloseTo(value, 9));
      // Dimmer than the tone by a fifth and more, and still skin: red over green over blue.
      expect(lightOf(albedo)).toBeLessThan(0.8 * lightOf(tone));
      expect(lightOf(albedo)).toBeGreaterThan(0.6 * lightOf(tone));
      expect(albedo[0]).toBeGreaterThan(albedo[1]);
      expect(albedo[1]).toBeGreaterThan(albedo[2]);
    }
    // The lightest tone reflected 62 % as a tone; the realistic rider's skin reflects 36 %.
    expect(lightOf(toneOf(lightest))).toBeGreaterThan(0.6);
    expect(lightOf(skinAlbedo(toneOf(lightest)))).toBeLessThan(0.47);
    // Deeper in colour where the tone map bleaches: the lightest's red over its blue grows by a third…
    const redOverBlue = (colour: readonly number[]): number => (colour[0] ?? 0) / (colour[2] ?? 1);
    expect(redOverBlue(skinAlbedo(toneOf(lightest)))).toBeGreaterThan(
      1.3 * redOverBlue(toneOf(lightest)),
    );
    // …and the deepest keeps its own, to a tenth.
    expect(redOverBlue(skinAlbedo(toneOf(deepest)))).toBeLessThan(
      1.1 * redOverBlue(toneOf(deepest)),
    );
    // A grey is still a grey, and black is black.
    const grey = skinAlbedo([0.3, 0.3, 0.3]);
    expect(grey[0]).toBeCloseTo(grey[2], 12);
    expect(skinAlbedo([0, 0, 0]).every((value) => value >= 0 && value < 1e-3)).toBe(true);
    // THE CONTROL: only skin is treated so. Every other region is its colour, unpacked.
    const cloth = CLOTHES[0] ?? 0;
    for (const region of [1, 2, 3, 4]) {
      const drawn = glsl.call(
        'oylColourOf',
        region,
        0,
        cloth,
        cloth,
        cloth,
        cloth,
      ) as readonly number[];
      toneOf(cloth).forEach((value, channel) => expect(drawn[channel]).toBeCloseTo(value, 9));
    }
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
    // #3285: the still poses' rows after the gaits', two a pose.
    expect(GAIT_ROWS).toBe(PHASES.walk + PHASES.run + PHASES.stand + PHASES.sit + PHASES.clap);
    expect(MOTIONS.slice(0, GAITS.length)).toEqual(GAITS);
    expect(MOTIONS.slice(GAITS.length)).toEqual(STILL_POSES);
    for (const pose of STILL_POSES) expect(PHASES[pose]).toBe(2);
    expect(gaitRow(0)).toBe(0);
    expect(gaitRow(1)).toBe(PHASES.walk);
    expect(gaitRow(MOTIONS.indexOf('clap'))).toBe(GAIT_ROWS - PHASES.clap);
    expect(RIDE_GAIT_INDEX).toBe(MOTIONS.length);
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
      MOTIONS.forEach((gait, gaitAt) => {
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

  it('writes each body’s corners into the slot texture as the shader’s own decode reads them back, the second block too', () => {
    // Three bodies of 3 500 columns between them: two blocks, so the second
    // and third bodies have columns in the second block.
    const columns = [1000, 1200, 1300];
    const layout = animationLayout(columns);
    expect(layout.blocks).toBe(2);
    const counts = [1500, 1797, 1600];
    const most = Math.max(...counts);
    const people = counts.map((triangles, body) => ({
      triangles: Uint32Array.from(
        { length: triangles * 3 },
        (_, slot) => (slot * 7 + body) % (columns[body] as number),
      ),
      corners: Array.from({ length: triangles * 3 }, (_, slot) => ({
        region: (slot % 5) as PersonRegion,
        u: (slot % 128) / 128,
        v: ((slot + body) % 64) / 64,
      })),
    }));
    const data = peopleSlotData(people, layout, most);
    const glsl = new GlslProgram(peopleSlotGlsl(slotRows(most)));
    let secondBlock = 0;
    people.forEach((person, body) => {
      const base = layout.base[body] as number;
      for (let slot = 0; slot < most * 3; slot += 1) {
        const [x, y] = glsl.call('oylSlotTexelOf', body, slot) as readonly number[];
        expect({ x, y }).toEqual(slotTexel(body, slot, most));
        const at = ((y as number) * SLOT_WIDTH + (x as number)) * 4;
        const texel = [0, 1, 2, 3].map((k) => halfFloat(data[at + k] as number));
        const block = glsl.call('oylBlockOf', texel[1] as number) as number;
        const column =
          block * layout.width + (glsl.call('oylColumnOf', texel[0] as number) as number);
        const used = slot < person.triangles.length;
        const corner = person.corners[slot];
        if (block > 0) secondBlock += 1;
        expect(column).toBe(base + (used ? (person.triangles[slot] as number) : 0));
        expect(glsl.call('oylRegionOf', texel[1] as number)).toBe(used ? corner?.region : 0);
        expect(texel[2]).toBe(used ? corner?.u : 0);
        expect(texel[3]).toBe(used ? corner?.v : 0);
      }
    });
    // The second block was read, not only the first.
    expect(secondBlock).toBeGreaterThan(1000);
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
