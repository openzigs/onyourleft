// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic set, read back off disk and held to ADR 0026 D-6's budget.
 *
 * ⚠️ **What this reads is the committed bytes**, through a reader that shares
 * no code with the renderer (`realistic-bytes-testing.ts`): a tree the pipeline
 * made heavier than its recipe asked for, a map committed at source resolution,
 * or a set that outgrew its share of the APK is red here, before any device
 * sees it. What it cannot establish is what those numbers cost on a phone —
 * that is the soak in validation 0002 Part Z, run on the owner's tablet on
 * 2026-09-23, and `realistic-budget.ts` §"Re-set from the twenty-minute soak"
 * says what it showed and why every constant stood.
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
  REALISTIC_BUILD_BYTES,
  REALISTIC_FRAME_TRIANGLES,
  REALISTIC_NEAR_MESHES,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TEXTURE_CEILING_PIXELS,
  REALISTIC_TEXTURE_MEMORY_BYTES,
  REALISTIC_TEXTURE_PIXELS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { readGlb } from './model-bytes-testing';
import { fileImageSize, modelFacts } from './realistic-bytes-testing';
import { STRUCTURE_KINDS } from './scatter';
import { SCENERY_MODELS } from './scenery-models';
import { BUILT_KINDS } from './buildings';
import { REALISTIC_LADDER } from './quality';
import {
  realisticBicycleTriangles,
  realisticStructureTriangles,
  realisticStructureTrianglesOf,
  ScatterBelt,
} from './three-renderer';

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
  // ⚠️ **The bicycle's own CEILING is asserted in `realistic-renderer.test.ts`
  // §"the realistic bicycle — #369", NOT here, and #369's first pass put a
  // weaker copy of it in this file on the strength of a claim that turned out
  // to be false.** That copy is deleted rather than kept: it bounded the count
  // below at `> 0` where the existing one bounds it at `> 1 000`, so the two
  // together were the older assertion plus a line that could not fail. ⚠️
  // **Since #506 the frame sum below reads the bicycle AS BUILT**
  // (`realisticBicycleTriangles`), where it read `REALISTIC_BICYCLE_TRIANGLES`:
  // every other term is the committed or built asset, and the ceiling alone
  // overstated three bicycles by about 20 000.
  const worstFrame = (): {
    readonly vegetation: number;
    readonly riders: number;
    readonly structureItems: number;
    readonly heaviestStructure: number;
  } => {
    const heaviest = (kind: (typeof REALISTIC_VEGETATION_KINDS)[number]): number =>
      Math.max(...REALISTIC_VEGETATION[kind].map((model) => modelFacts(at(model.file)).triangles));
    return {
      vegetation: REALISTIC_VEGETATION_KINDS.reduce(
        (sum, kind) => sum + REALISTIC_NEAR_MESHES[kind] * heaviest(kind),
        0,
      ),
      // Three riders: the rider, the pacer and the ghost, each a body and a bicycle.
      riders: 3 * (riderTriangles + realisticBicycleTriangles()),
      // The most structures ANY realistic rung lets a frame carry, each the
      // heaviest shape any structure kind is built in. #506
      structureItems: Math.max(...REALISTIC_LADDER.map((rung) => rung.structureItems)),
      heaviestStructure: Math.max(...STRUCTURE_KINDS.map(realisticStructureTriangles)),
    };
  };

  it('holds the worst frame the caps allow under the frame’s triangles, structures included — #506', () => {
    const { vegetation, riders, structureItems, heaviestStructure } = worstFrame();
    // ⚠️ #506: until this the sum stopped at the riders, and 240 structures
    // at up to 640 triangles each went into no sum at all. This is the line
    // that is red on the tree #506 was filed against.
    expect(vegetation + riders + structureItems * heaviestStructure).toBeLessThanOrEqual(
      REALISTIC_FRAME_TRIANGLES,
    );
    // Non-vacuity: the structures are a real share of the frame — a village
    // of detailed buildings — rather than a term that rounds to nothing.
    expect(structureItems * heaviestStructure).toBeGreaterThan(10_000);
    expect(heaviestStructure).toBeGreaterThan(300);
  });

  it('holds it with every structure at its CEILING too, so a building may grow to its budget — #506', () => {
    const { vegetation, riders, structureItems } = worstFrame();
    expect(
      vegetation + riders + structureItems * REALISTIC_TRIANGLES.structure,
    ).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
    // And the figure the rungs spend is the one `realistic-budget.ts` states.
    expect(structureItems).toBe(REALISTIC_STRUCTURE_ITEMS);
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

  /** The lightest house the stylised world draws: the Kenney pack's own. */
  const lightestPackedHouse = (): number => {
    const models = fileURLToPath(new URL('./models/', import.meta.url));
    return Math.min(
      ...(SCENERY_MODELS.building ?? []).map((model) =>
        glbTriangles(join(models, `${model.name}.glb`)),
      ),
    );
  };

  it('draws no structure heavier than the stylised world draws at the same place', () => {
    // ⚠️ This used to end "which is why the frame's triangles need not count
    // them". It was not why, and since #506 they do. @see REALISTIC_FRAME_TRIANGLES
    const stylised = new ScatterBelt(new Map());
    for (const kind of STRUCTURE_KINDS) {
      const packed = SCENERY_MODELS[kind];
      // #500: a building drawn from numbers has two shapes; the stylised belt
      // draws each as one mesh, and a realistic structure is held to the
      // lightest of them, so no shape of it is heavier than its stylised twin.
      const lightestStylised =
        packed === undefined
          ? Math.min(...stylised.meshesOf(kind).map((mesh) => trianglesOf(mesh.geometry)))
          : lightestPackedHouse();
      expect(lightestStylised, kind).toBeGreaterThan(0);
      expect(realisticStructureTriangles(kind), kind).toBeLessThanOrEqual(
        packed === undefined
          ? Math.max(...stylised.meshesOf(kind).map((mesh) => trianglesOf(mesh.geometry)))
          : lightestStylised,
      );
    }
    stylised.dispose();
  });

  it('draws each building shape with the SAME triangles in both worlds — #500', () => {
    // The claim above, made exact for the buildings both worlds build from
    // `buildings.ts`: shape by shape, the realistic surfaces together are the
    // stylised mesh, triangle for triangle.
    const stylised = new ScatterBelt(new Map());
    for (const kind of BUILT_KINDS.filter((each) => each !== 'building')) {
      stylised.meshesOf(kind).forEach((mesh, variant) => {
        expect(realisticStructureTrianglesOf(kind, variant), `${kind} ${String(variant)}`).toBe(
          trianglesOf(mesh.geometry),
        );
      });
    }
    stylised.dispose();
  });

  it('holds a structure’s budget under the lightest house the stylised world already draws — #500', () => {
    // The stylised world has no triangle budget — its budget is draw calls —
    // so what stops #500 making a village heavier is this: no built shape
    // costs more than the pack's own houses always have, a village of them
    // included.
    expect(REALISTIC_TRIANGLES.structure).toBeLessThanOrEqual(lightestPackedHouse());
    // Non-vacuity: the detail is really there — a house is hundreds of
    // triangles, where it was eighteen.
    expect(realisticStructureTriangles('building')).toBeGreaterThan(300);
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
