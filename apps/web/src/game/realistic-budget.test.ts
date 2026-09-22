// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic set, read back off disk and held to ADR 0026 D-6's budget.
 *
 * ⚠️ **What this reads is the committed bytes**, through a reader that shares
 * no code with the renderer (`realistic-bytes-testing.ts`): a tree the pipeline
 * made heavier than its recipe asked for, a map committed at source resolution,
 * or a set that outgrew its share of the APK is red here, before any device
 * sees it. What it cannot establish is what those numbers cost on a phone —
 * that is the soak in validation 0002 Part Z, which has not been run, and
 * `realistic-budget.ts` says why every constant is provisional until it is.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_RIDER,
  REALISTIC_SKY,
  REALISTIC_STRUCTURE_SURFACES,
  REALISTIC_SURFACES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticFiles,
} from './realistic-assets';
import {
  environmentMapBytes,
  estimatedTextureBytes,
  REALISTIC_BICYCLE_TRIANGLES,
  REALISTIC_BUILD_BYTES,
  REALISTIC_FRAME_TRIANGLES,
  REALISTIC_NEAR_MESHES,
  REALISTIC_TEXTURE_CEILING_PIXELS,
  REALISTIC_TEXTURE_MEMORY_BYTES,
  REALISTIC_TEXTURE_PIXELS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { readGlb } from './model-bytes-testing';
import { fileImageSize, modelFacts } from './realistic-bytes-testing';
import { STRUCTURE_KINDS } from './scatter';
import { SCENERY_MODELS } from './scenery-models';
import { realisticStructureTriangles, ScatterBelt } from './three-renderer';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const at = (file: string): string => join(SHIPPED, file);

const riderTriangles = modelFacts(at(REALISTIC_RIDER)).triangles;

describe('each committed file inside its class’s budget — ADR 0026 D-6', () => {
  it('keeps every model at or under its kind’s triangles', () => {
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        const { triangles } = modelFacts(at(model.file));
        expect(triangles, model.file).toBeGreaterThan(0);
        expect(triangles, model.file).toBeLessThanOrEqual(REALISTIC_TRIANGLES[kind]);
      }
    }
    expect(riderTriangles).toBeGreaterThan(0);
    expect(riderTriangles).toBeLessThanOrEqual(REALISTIC_TRIANGLES.rider);
  });

  it('keeps every map inside a model at or under the model class’s size', () => {
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        const { images } = modelFacts(at(model.file));
        expect(images.length, `${model.file} carries no map at all`).toBeGreaterThan(0);
        for (const image of images) {
          expect(Math.max(image.width, image.height), model.file).toBeLessThanOrEqual(
            REALISTIC_TEXTURE_PIXELS.model,
          );
        }
      }
    }
  });

  it('keeps the sky, the surfaces and the impostors inside theirs, and all under 2048', () => {
    const largest = (file: string): number => {
      const size = fileImageSize(at(file));
      return Math.max(size.width, size.height);
    };
    expect(largest(REALISTIC_SKY)).toBeLessThanOrEqual(REALISTIC_TEXTURE_PIXELS.sky);
    for (const maps of [REALISTIC_SURFACES.road, REALISTIC_SURFACES.ground]) {
      expect(largest(maps.colour), maps.colour).toBeLessThanOrEqual(
        REALISTIC_TEXTURE_PIXELS.surface,
      );
      expect(largest(maps.normal), maps.normal).toBeLessThanOrEqual(
        REALISTIC_TEXTURE_PIXELS.surface,
      );
    }
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        if (model.impostor === undefined) continue;
        expect(largest(model.impostor), model.impostor).toBeLessThanOrEqual(
          REALISTIC_TEXTURE_PIXELS.impostor,
        );
      }
    }
    // #475: the structures' surfaces.
    for (const surface of PHOTOGRAPHIC_STRUCTURE_SURFACES) {
      const maps = REALISTIC_STRUCTURE_SURFACES[surface];
      for (const file of [maps.colour, maps.normal]) {
        expect(largest(file), file).toBeLessThanOrEqual(REALISTIC_TEXTURE_PIXELS.structure);
        expect(largest(file), file).toBeGreaterThan(0);
      }
    }
    for (const limit of Object.values(REALISTIC_TEXTURE_PIXELS)) {
      expect(limit).toBeLessThanOrEqual(REALISTIC_TEXTURE_CEILING_PIXELS);
    }
    expect(REALISTIC_TEXTURE_CEILING_PIXELS).toBe(2048);
  });

  it('gives the rider a skin and nothing else one', () => {
    expect(modelFacts(at(REALISTIC_RIDER)).skinned).toBe(true);
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        expect(modelFacts(at(model.file)).skinned, model.file).toBe(false);
      }
    }
  });
});

describe('the set as a whole inside the budget — ADR 0026 D-6', () => {
  // ⚠️ **The bicycle's own count is asserted in `realistic-renderer.test.ts`
  // §"the realistic bicycle — #369", NOT here, and #369's first pass put a
  // weaker copy of it in this file on the strength of a claim that turned out
  // to be false.** That copy is deleted rather than kept: it bounded the count
  // below at `> 0` where the existing one bounds it at `> 1 000`, so the two
  // together were the older assertion plus a line that could not fail. The
  // frame sum below reads `REALISTIC_BICYCLE_TRIANGLES`, and what holds that
  // constant to the geometry the renderer actually builds is that other file.
  it('holds the worst frame the near-mesh caps allow under the frame’s triangles', () => {
    const heaviest = (kind: (typeof REALISTIC_VEGETATION_KINDS)[number]): number =>
      Math.max(...REALISTIC_VEGETATION[kind].map((model) => modelFacts(at(model.file)).triangles));
    const vegetation = REALISTIC_VEGETATION_KINDS.reduce(
      (sum, kind) => sum + REALISTIC_NEAR_MESHES[kind] * heaviest(kind),
      0,
    );
    // Three riders: the rider, the pacer and the ghost, each a body and a bicycle.
    const riders = 3 * (riderTriangles + REALISTIC_BICYCLE_TRIANGLES);
    expect(vegetation + riders).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
  });

  it('holds the estimated texture memory under its ceiling', () => {
    const shapes = [];
    const sky = fileImageSize(at(REALISTIC_SKY));
    // three's HDR loader makes half-float RGBA with no mipmaps, and the
    // environment is prefiltered from it.
    shapes.push({ ...sky, bytesPerTexel: 8, mipmapped: false });
    for (const maps of [REALISTIC_SURFACES.road, REALISTIC_SURFACES.ground]) {
      for (const file of [maps.colour, maps.normal]) {
        shapes.push({ ...fileImageSize(at(file)), bytesPerTexel: 4, mipmapped: true });
      }
    }
    // #475: the structures' surfaces, 8-bit and mipmapped like the ground's.
    for (const surface of PHOTOGRAPHIC_STRUCTURE_SURFACES) {
      const maps = REALISTIC_STRUCTURE_SURFACES[surface];
      for (const file of [maps.colour, maps.normal]) {
        shapes.push({ ...fileImageSize(at(file)), bytesPerTexel: 4, mipmapped: true });
      }
    }
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        for (const image of modelFacts(at(model.file)).images) {
          shapes.push({ ...image, bytesPerTexel: 4, mipmapped: true });
        }
        if (model.impostor !== undefined) {
          shapes.push({ ...fileImageSize(at(model.impostor)), bytesPerTexel: 4, mipmapped: true });
        }
      }
    }
    const total =
      shapes.reduce((sum, shape) => sum + estimatedTextureBytes(shape), 0) +
      environmentMapBytes(sky.width);
    expect(total).toBeLessThanOrEqual(REALISTIC_TEXTURE_MEMORY_BYTES);
    // ⚠️ Non-vacuity: the set is real, so the estimate is a real fraction of
    // the ceiling rather than a rounding error under it.
    expect(total).toBeGreaterThan(REALISTIC_TEXTURE_MEMORY_BYTES / 4);
  });

  it('adds no more to the build than its share', () => {
    const bytes = realisticFiles().reduce((sum, file) => sum + statSync(at(file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(REALISTIC_BUILD_BYTES);
    expect(bytes).toBeGreaterThan(REALISTIC_BUILD_BYTES / 4);
  });
});

describe('the realistic structures — #475, ADR 0026 D-12 layer 3', () => {
  /** How many triangles a mesh's geometry draws. */
  const trianglesOf = (geometry: {
    readonly index: { readonly count: number } | null;
    getAttribute: (name: 'position') => { readonly count: number };
  }): number => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;

  const NO_GEOMETRY = { index: null, getAttribute: () => ({ count: 0 }) };

  /**
   * A Kenney model's triangles, off its own JSON: every primitive's index
   * count, or its vertex count where it has none. The building models carry
   * their colour in an external atlas, which `modelFacts` refuses, so this
   * reads the geometry alone.
   */
  const glbTriangles = (path: string): number => {
    const json = readGlb(path).json as unknown as {
      readonly meshes: readonly {
        readonly primitives: readonly {
          readonly indices?: number;
          readonly attributes: { readonly POSITION: number };
        }[];
      }[];
      readonly accessors: readonly { readonly count: number }[];
    };
    let total = 0;
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        const accessor = json.accessors[primitive.indices ?? primitive.attributes.POSITION];
        total += (accessor?.count ?? 0) / 3;
      }
    }
    return total;
  };

  it('keeps every structure at or under its triangles', () => {
    for (const kind of STRUCTURE_KINDS) {
      const triangles = realisticStructureTriangles(kind);
      expect(triangles, kind).toBeGreaterThan(0);
      expect(triangles, kind).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
    }
  });

  it('draws no structure heavier than the stylised world draws at the same place', () => {
    // Which is why the frame's triangles need not count them. @see REALISTIC_FRAME_TRIANGLES
    const stylised = new ScatterBelt(new Map());
    const models = fileURLToPath(new URL('./models/', import.meta.url));
    for (const kind of STRUCTURE_KINDS) {
      const packed = SCENERY_MODELS[kind];
      const heaviestStylised =
        packed === undefined
          ? trianglesOf(stylised.meshesOf(kind)[0]?.geometry ?? NO_GEOMETRY)
          : Math.min(...packed.map((model) => glbTriangles(join(models, `${model.name}.glb`))));
      expect(heaviestStylised, kind).toBeGreaterThan(0);
      expect(realisticStructureTriangles(kind), kind).toBeLessThanOrEqual(heaviestStylised);
    }
  });
});

describe('the arithmetic the budget rests on', () => {
  it('estimates a mipmapped texture at a third again, as #457 published it', () => {
    expect(
      estimatedTextureBytes({ width: 1024, height: 1024, bytesPerTexel: 4, mipmapped: true }),
    ).toBe((1024 * 1024 * 4 * 4) / 3);
    expect(
      estimatedTextureBytes({ width: 2048, height: 1024, bytesPerTexel: 8, mipmapped: false }),
    ).toBe(2048 * 1024 * 8);
  });

  it('sizes a 2K sky’s environment the way three 0.185.1’s PMREMGenerator allocates it', () => {
    // A 512 face — the largest power of two not over 2048 / 4 — three faces
    // wide and four high, half-float RGBA.
    expect(environmentMapBytes(2048)).toBe(1536 * 2048 * 8);
    // And a width that is not a power of two rounds the face DOWN.
    expect(environmentMapBytes(3000)).toBe(3 * 512 * (4 * 512) * 8);
  });
});
