// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GAIT_PHASES, GAITS } from './gait';
import { readGlb, type GlbFile } from './model-bytes-testing';
import {
  ANIMATION_ROWS,
  CLOTHES_STAND_OFF,
  HEM_FLARE,
  PERSON_ANIMATION_MAX_BYTES,
  PERSON_MAX_TRIANGLES,
  PersonRegion,
  animationBytes,
  animationRow,
  clusterDecimate,
  dressed,
  regionOf,
  vertexNormals,
} from './people-body';
import { PEOPLE_NEAR_MAX } from './people';
import { REALISTIC_RIDER } from './realistic-assets';
import { REALISTIC_PEOPLE_TRIANGLES } from './realistic-budget';

/** A UV sphere of `rings` × `segments`, radius 1: positions and triangles. */
function sphere(rings: number, segments: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const theta = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const phi = (segment / segments) * 2 * Math.PI;
      positions.push(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, indices };
}

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

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

describe('a person’s body, cut from the rider’s by vertex clustering — #1541', () => {
  it('cuts a mesh to the budget, keeping only the source’s own vertices and no broken triangle', () => {
    const { positions, indices } = sphere(60, 80);
    const group = new Array<number>(positions.length / 3).fill(0);
    const cut = clusterDecimate(positions, indices, group, 1_000);
    expect(cut.indices.length / 3).toBeLessThanOrEqual(1_000);
    // Not cut to nothing: the bisection finds the smallest cube that fits.
    expect(cut.indices.length / 3).toBeGreaterThan(600);
    const seen = new Set<string>();
    for (let at = 0; at < cut.indices.length; at += 3) {
      const corners = [cut.indices[at], cut.indices[at + 1], cut.indices[at + 2]] as number[];
      expect(new Set(corners).size).toBe(3);
      for (const corner of corners) expect(corner).toBeLessThan(cut.kept.length);
      const key = [...corners].sort((a, b) => a - b).join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // Every kept vertex is a source vertex, used by a triangle.
    for (const source of cut.kept) expect(source).toBeLessThan(positions.length / 3);
    expect(new Set(cut.indices).size).toBe(cut.kept.length);
  });

  it('leaves a mesh already inside the budget as it is', () => {
    const { positions, indices } = sphere(8, 8);
    const cut = clusterDecimate(positions, indices, new Array<number>(81).fill(0), 1_000);
    expect(cut.indices.length).toBe(indices.length);
  });

  it('never joins vertices of two bones, however close they are', () => {
    // Two spheres in the same place, bones 0 and 1.
    const one = sphere(30, 40);
    const count = one.positions.length / 3;
    const positions = [...one.positions, ...one.positions.map((value) => value + 0.001)];
    const indices = [...one.indices, ...one.indices.map((index) => index + count)];
    const group = [...new Array<number>(count).fill(0), ...new Array<number>(count).fill(1)];
    const cut = clusterDecimate(positions, indices, group, 600);
    for (let at = 0; at < cut.indices.length; at += 3) {
      const bones = new Set(
        [0, 1, 2].map((corner) => group[cut.kept[cut.indices[at + corner] as number] as number]),
      );
      expect(bones.size).toBe(1);
    }
  });

  it('cuts the committed rider to at most 2 000 triangles, and its walk and run to under 1 MiB', () => {
    const path = fileURLToPath(
      new URL(`../../public/realistic/${REALISTIC_RIDER}`, import.meta.url),
    );
    const file = readGlb(path);
    const mesh = file.json.meshes?.[0];
    const primitive = mesh?.primitives[0];
    if (primitive === undefined) throw new Error('the rider has no mesh');
    const positions = accessor(file, primitive.attributes['POSITION'] as number);
    const indices = accessor(file, (primitive as unknown as { indices: number }).indices);
    const joints = accessor(file, primitive.attributes['JOINTS_0'] as number);
    const weights = accessor(file, primitive.attributes['WEIGHTS_0'] as number);
    const dominant: number[] = [];
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      let best = 0;
      for (let slot = 1; slot < 4; slot += 1) {
        if ((weights[vertex * 4 + slot] as number) > (weights[vertex * 4 + best] as number))
          best = slot;
      }
      dominant.push(joints[vertex * 4 + best] as number);
    }
    // The body before: the figure the header quotes.
    expect(indices.length / 3).toBe(8_636);
    const cut = clusterDecimate(positions, indices, dominant, PERSON_MAX_TRIANGLES);
    const triangles = cut.indices.length / 3;
    expect(triangles).toBeLessThanOrEqual(PERSON_MAX_TRIANGLES);
    expect(triangles).toBeGreaterThan(PERSON_MAX_TRIANGLES * 0.8);
    // Sixteen of them: the issue's "about 32k triangles".
    expect(REALISTIC_PEOPLE_TRIANGLES).toBe(PEOPLE_NEAR_MAX * PERSON_MAX_TRIANGLES);
    expect(PEOPLE_NEAR_MAX * triangles).toBeLessThanOrEqual(REALISTIC_PEOPLE_TRIANGLES);
    // The animation texture: one column a kept vertex.
    expect(animationBytes(cut.kept.length)).toBeLessThanOrEqual(PERSON_ANIMATION_MAX_BYTES);
    // The control: the uncut body's would not fit.
    expect(animationBytes(positions.length / 3)).toBeGreaterThan(PERSON_ANIMATION_MAX_BYTES);
  });

  it('lays the animation texture out a position row and a normal row a phase of each gait', () => {
    expect(ANIMATION_ROWS).toBe(2 * GAITS.length * GAIT_PHASES);
    expect(animationRow(0, 0)).toBe(0);
    expect(animationRow(1, 0)).toBe(GAIT_PHASES);
    expect(animationRow(1, GAIT_PHASES - 1)).toBe(ANIMATION_ROWS / 2 - 1);
    expect(animationBytes(1_000)).toBe(1_000 * ANIMATION_ROWS * 8);
  });

  it('turns each vertex’s normal out of its triangles', () => {
    // One triangle in the ground plane, wound to face up.
    const normals = vertexNormals([0, 0, 0, 0, 0, 1, 1, 0, 0], [0, 1, 2]);
    expect([...normals]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const { positions, indices } = sphere(20, 20);
    const round = vertexNormals(positions, indices);
    // On a sphere the normal is along the position — one way for every
    // vertex, the way the triangles are wound — away from the poles and the seam.
    const signs = new Set<number>();
    for (let ring = 2; ring <= 18; ring += 1) {
      for (let segment = 1; segment < 20; segment += 1) {
        const at = (ring * 21 + segment) * 3;
        const along =
          (round[at] as number) * (positions[at] as number) +
          (round[at + 1] as number) * (positions[at + 1] as number) +
          (round[at + 2] as number) * (positions[at + 2] as number);
        expect(Math.abs(along)).toBeGreaterThan(0.99);
        signs.add(Math.sign(along));
      }
    }
    expect(signs.size).toBe(1);
  });

  it('dresses a body by bone and place: shoes, bottoms, a top, hair, skin', () => {
    const at = { waistY: 0.13, headY: 0.7, headZ: 0.04, crownY: 0.84 };
    expect(regionOf('foot.L', -0.8, 0, at)).toBe(PersonRegion.shoes);
    expect(regionOf('lowerleg01.R', -0.4, 0, at)).toBe(PersonRegion.bottoms);
    expect(regionOf('pelvis.L', 0.05, 0, at)).toBe(PersonRegion.bottoms);
    expect(regionOf('spine05', 0.05, 0, at)).toBe(PersonRegion.bottoms);
    expect(regionOf('spine02', 0.3, 0, at)).toBe(PersonRegion.top);
    expect(regionOf('upperarm01.L', 0.45, 0, at)).toBe(PersonRegion.top);
    expect(regionOf('lowerarm01.L', 0.3, 0, at)).toBe(PersonRegion.skin);
    expect(regionOf('wrist.R', 0.2, 0, at)).toBe(PersonRegion.skin);
    expect(regionOf('head', 0.82, 0.05, at)).toBe(PersonRegion.hair);
    expect(regionOf('head', 0.75, -0.06, at)).toBe(PersonRegion.hair);
    // The face.
    expect(regionOf('head', 0.75, 0.12, at)).toBe(PersonRegion.skin);
  });
});

describe('a person dressed by face, in clothes that stand off the body — #1618', () => {
  // A strip of six triangles over eight vertices, two rows of four: the left
  // column skin, the next skin, then top, top — so the middle columns are a
  // seam, as a sleeve's end on a forearm is.
  //   0 - 1 - 2 - 3
  //   | / | / | / |
  //   4 - 5 - 6 - 7
  const indices = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 3, 6, 7];
  const { skin, top } = PersonRegion;
  const regions = [skin, skin, top, top, skin, skin, top, top];

  it('gives every corner of a triangle the triangle’s one region, so a seam is an edge', () => {
    const dress = dressed(indices, regions);
    expect(dress.indices.length).toBe(indices.length);
    let seams = 0;
    for (let at = 0; at < dress.indices.length; at += 3) {
      const corners = [0, 1, 2].map((corner) => dress.region[dress.indices[at + corner] as number]);
      expect(new Set(corners).size).toBe(1);
      // Each drawn corner is the kept vertex the triangle had there.
      for (let corner = 0; corner < 3; corner += 1) {
        expect(dress.column[dress.indices[at + corner] as number]).toBe(indices[at + corner]);
      }
    }
    // The seam's vertices are drawn twice, once a region; nothing else is.
    for (let column = 0; column < regions.length; column += 1) {
      const copies = [...dress.column].filter((each) => each === column).length;
      if (copies > 1) seams += 1;
      expect(copies).toBeLessThanOrEqual(2);
    }
    expect(seams).toBeGreaterThan(0);
    // The control: dressed by vertex, as before, some triangle fades two regions.
    let blended = 0;
    for (let at = 0; at < indices.length; at += 3) {
      const corners = [0, 1, 2].map((corner) => regions[indices[at + corner] as number]);
      if (new Set(corners).size > 1) blended += 1;
    }
    expect(blended).toBeGreaterThan(0);
  });

  it('gives a triangle its corners’ majority, and clothes before skin where they split', () => {
    const { shoes, bottoms, hair } = PersonRegion;
    expect([...dressed([0, 1, 2], [skin, top, top]).region]).toEqual([top, top, top]);
    expect([...dressed([0, 1, 2], [skin, skin, top]).region]).toEqual([skin, skin, skin]);
    expect([...dressed([0, 1, 2], [skin, bottoms, shoes]).region]).toEqual([shoes, shoes, shoes]);
    expect([...dressed([0, 1, 2], [hair, skin, top]).region]).toEqual([top, top, top]);
  });

  it('stands clothes off the body, flares them at a hem, and leaves skin where it is', () => {
    const { standOff } = dressed(indices, regions);
    // Skin away from any clothes: on the body.
    expect(standOff[0]).toBe(0);
    expect(standOff[4]).toBe(0);
    // Clothes away from the hem: their stand-off.
    expect(standOff[3]).toBeCloseTo(CLOTHES_STAND_OFF[top], 6);
    expect(standOff[7]).toBeCloseTo(CLOTHES_STAND_OFF[top], 6);
    // The hem, where the top meets the skin: further out.
    expect(standOff[2]).toBeCloseTo(CLOTHES_STAND_OFF[top] + HEM_FLARE, 6);
    expect(standOff[5]).toBeCloseTo(CLOTHES_STAND_OFF[top] + HEM_FLARE, 6);
    // Every piece of clothing stands off, shoes furthest; skin not at all.
    expect(CLOTHES_STAND_OFF[skin]).toBe(0);
    for (const clothes of [top, PersonRegion.bottoms, PersonRegion.shoes]) {
      expect(CLOTHES_STAND_OFF[clothes] * 1.75).toBeGreaterThanOrEqual(0.012);
    }
    expect(CLOTHES_STAND_OFF[PersonRegion.shoes]).toBeGreaterThan(CLOTHES_STAND_OFF[top]);
  });

  it('costs no triangle and no column of the animation texture', () => {
    const dress = dressed(indices, regions);
    expect(dress.indices.length / 3).toBe(indices.length / 3);
    expect(Math.max(...dress.column)).toBe(regions.length - 1);
    expect(dress.standOff.length).toBe(regions.length);
  });
});
