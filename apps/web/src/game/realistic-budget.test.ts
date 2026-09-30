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

import { BANNER_CELL_HEIGHT, BANNER_CELL_WIDTH, BANNER_CELLS } from './banner-atlas';
import { standBoxes } from './gantry';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TRANSCODER_FILES, transcoderSource } from '../../tools/basis/transcoder-plugin';

import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_BICYCLE_MAPS,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_RIDER,
  REALISTIC_RIDER_MAP_NAMES,
  REALISTIC_RIDER_MAPS,
  REALISTIC_SKY,
  REALISTIC_STRUCTURE_SURFACES,
  REALISTIC_SURFACES,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticFiles,
} from './realistic-assets';
import { treeSlots, type TreeLevels } from './tree-levels';
import {
  DEVICE_BYTES_PER_TEXEL,
  environmentMapBytes,
  HARD_SWAP_TREE_LEVELS,
  estimatedTextureBytes,
  REALISTIC_BICYCLE_SURFACES,
  REALISTIC_RIDER_SURFACES,
  REALISTIC_BUILD_BYTES,
  REALISTIC_FRAME_TRIANGLES,
  REALISTIC_GANTRY_TRIANGLES,
  REALISTIC_GROUND_BLOBS,
  REALISTIC_NEAR_MESHES,
  REALISTIC_REMOTE_RIDERS,
  REALISTIC_REMOTE_STYLISED_RIDERS,
  REALISTIC_REMOTE_TRIANGLES,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TEXTURE_CEILING_PIXELS,
  REALISTIC_RIDER_SILHOUETTE_BYTES,
  REALISTIC_TEXTURE_MEMORY_BYTES,
  REALISTIC_TEXTURE_PIXELS,
  REALISTIC_TREE_LEVELS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { GROUND_BLOB_TRIANGLES } from './ground-blob';
import { readGlb } from './model-bytes-testing';
import {
  fileImageSize,
  fileKtx2Facts,
  modelFacts,
  type Ktx2Facts,
} from './realistic-bytes-testing';
import { STRUCTURE_KINDS } from './scatter';
import { SCENERY_MODELS } from './scenery-models';
import { BUILT_KINDS } from './buildings';
import { REALISTIC_LADDER } from './quality';
import {
  realisticBicycleTriangles,
  realisticStructureTriangles,
  realisticStructureTrianglesOf,
  ScatterBelt,
  stylisedRiderTriangles,
} from './three-renderer';
import { MAXIMUM_DRAWN_RIDERS } from '../net/interest';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const WEB = fileURLToPath(new URL('../../', import.meta.url));
const at = (file: string): string => join(SHIPPED, file);

const riderTriangles = modelFacts(at(REALISTIC_RIDER)).triangles;

const TREE_KINDS = ['tree-broadleaf', 'tree-conifer'] as const;

/** The heaviest committed file of a kind's near level, or of the trees' middle level. */
function heaviestNear(kind: (typeof REALISTIC_VEGETATION_KINDS)[number]): number {
  return Math.max(
    ...REALISTIC_VEGETATION[kind].map((model) => modelFacts(at(model.file)).triangles),
  );
}
function heaviestMiddle(): number {
  return Math.max(
    ...TREE_KINDS.flatMap((kind) =>
      REALISTIC_VEGETATION[kind].map((model) =>
        model.middle === undefined
          ? Number.POSITIVE_INFINITY
          : modelFacts(at(model.middle)).triangles,
      ),
    ),
  );
}

/**
 * The worst vegetation a frame can submit — #617: every tree slot
 * (`tree-levels.ts` §`treeSlots`, a band tree counted at BOTH its levels)
 * filled with the heaviest file of EITHER tree kind, and the nearest shrubs and
 * rocks as before.
 */
function worstVegetation(levels: TreeLevels = REALISTIC_TREE_LEVELS): number {
  const slots = treeSlots(levels);
  const heaviestTree = Math.max(...TREE_KINDS.map(heaviestNear));
  return (
    slots.full * heaviestTree +
    (slots.middle > 0 ? slots.middle * heaviestMiddle() : 0) +
    REALISTIC_NEAR_MESHES.shrub * heaviestNear('shrub') +
    REALISTIC_NEAR_MESHES.rock * heaviestNear('rock')
  );
}

/** A box's triangles: six faces, two each. */
const BOX_TRIANGLES = 12;

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
    for (const maps of [
      REALISTIC_SURFACES.road,
      REALISTIC_SURFACES.ground,
      // #627: the ground's verge, rock and scree.
      REALISTIC_SURFACES.verge,
      REALISTIC_SURFACES.rock,
    ]) {
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

  it('keeps every tree’s middle level under its ceiling, carrying no map at all — #617', () => {
    for (const kind of TREE_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        const file = model.middle;
        expect(file, model.name).toBeDefined();
        if (file === undefined) continue;
        const facts = modelFacts(at(file));
        expect(facts.triangles, file).toBeGreaterThan(REALISTIC_TRIANGLES['tree-middle'] / 2);
        expect(facts.triangles, file).toBeLessThanOrEqual(REALISTIC_TRIANGLES['tree-middle']);
        // It wears the near file's maps, so it adds no texture memory.
        expect(facts.images, file).toEqual([]);
        expect(facts.skinned, file).toBe(false);
        // …and every material it names is one the near file has, which is
        // what the runtime pairs its parts by.
        const names = (path: string): string[] =>
          ((readGlb(path).json as { materials?: { name?: string }[] }).materials ?? []).map(
            (material) => material.name ?? '',
          );
        const near = names(at(model.file));
        for (const name of names(at(file))) expect(near, `${file} wears ${name}`).toContain(name);
      }
    }
  });

  it('bakes the rock’s occlusion into a vertex colour, and changes nothing else about it — #620', () => {
    // #620's rock is the same 2 400 triangles and the same two 512 px maps it
    // was before the bake — `process_rock.py` only adds a colour — and the
    // colour is on every vertex without splitting one (a CORNER bake would
    // have split 2 103 vertices into 4 095 and nearly doubled the file).
    for (const model of REALISTIC_VEGETATION.rock) {
      const path = at(model.file);
      const facts = modelFacts(path);
      expect(facts.triangles, model.file).toBe(2_400);
      expect(facts.images, model.file).toEqual([
        { width: 512, height: 512 },
        { width: 512, height: 512 },
      ]);
      const glb = readGlb(path);
      const json = glb.json as {
        meshes: { primitives: { attributes: Record<string, number> }[] }[];
        accessors: {
          count: number;
          bufferView: number;
          componentType: number;
          type: string;
          normalized?: boolean;
        }[];
        bufferViews: { byteOffset?: number; byteLength: number }[];
      };
      const attributes = json.meshes[0]?.primitives[0]?.attributes ?? {};
      const colour = json.accessors[attributes['COLOR_0'] ?? -1];
      const position = json.accessors[attributes['POSITION'] ?? -1];
      expect(colour, `${model.file} carries no baked occlusion`).toBeDefined();
      expect(colour?.count).toBe(position?.count);
      expect(position?.count).toBe(2_103);
      // Normalized UNSIGNED_SHORT RGBA — what Blender 4.4.3 writes for the
      // ACTIVE byte-colour attribute when no node reads it, 8 bytes a vertex
      // where the node-wired FLOAT RGB it wrote first cost 12 (#686's review;
      // `process_rock.py` step 4). Read it and require an occlusion that
      // actually darkens — mean under 0.95 and a floor near 0 — while the top
      // of the rock stays lit, and an alpha of 1 everywhere, so the colour
      // makes nothing see-through.
      expect(colour?.componentType).toBe(5123);
      expect(colour?.type).toBe('VEC4');
      expect(colour?.normalized).toBe(true);
      const view = json.bufferViews[colour?.bufferView ?? -1];
      const start = view?.byteOffset ?? 0;
      const values = new Uint16Array(
        glb.binary.buffer.slice(
          glb.binary.byteOffset + start,
          glb.binary.byteOffset + start + (view?.byteLength ?? 0),
        ),
      );
      expect(values.length).toBe(4 * 2_103);
      let sum = 0;
      let low = 1;
      let high = 0;
      for (let at = 0; at < values.length; at += 4) {
        const red = (values[at] as number) / 65_535;
        sum += red;
        low = Math.min(low, red);
        high = Math.max(high, red);
        expect(values[at + 3]).toBe(65_535);
      }
      const mean = sum / (values.length / 4);
      expect(mean).toBeLessThan(0.95);
      expect(mean).toBeGreaterThan(0.5);
      expect(low).toBeLessThan(0.2);
      expect(high).toBeGreaterThan(0.95);
    }
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
    readonly blobs: number;
    readonly gantries: number;
  } => {
    return {
      // #679: two gantries and the board before a line, a quad a banner.
      gantries:
        2 * (standBoxes('gantry').length * BOX_TRIANGLES + 2) +
        (standBoxes('board').length * BOX_TRIANGLES + 2),
      // #620: the ground blobs, every one the belt has room for, a quad each.
      blobs: REALISTIC_GROUND_BLOBS * GROUND_BLOB_TRIANGLES,
      vegetation: worstVegetation(),
      // Three riders: the rider, the pacer and the ghost, each a body and a bicycle.
      riders: 3 * (riderTriangles + realisticBicycleTriangles()),
      // The most structures ANY realistic rung lets a frame carry, each the
      // heaviest shape any structure kind is built in. #506
      structureItems: Math.max(...REALISTIC_LADDER.map((rung) => rung.structureItems)),
      heaviestStructure: Math.max(...STRUCTURE_KINDS.map(realisticStructureTriangles)),
    };
  };

  it('holds the worst frame the caps allow under the frame’s triangles, structures included — #506', () => {
    const { vegetation, riders, structureItems, heaviestStructure, blobs, gantries } = worstFrame();
    // ⚠️ #506: until this the sum stopped at the riders, and 240 structures
    // at up to 640 triangles each went into no sum at all. This is the line
    // that is red on the tree #506 was filed against.
    expect(
      vegetation + riders + structureItems * heaviestStructure + blobs + gantries,
    ).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
    // #679: the gantries inside their own ceiling, and a real sum.
    expect(gantries).toBeLessThanOrEqual(REALISTIC_GANTRY_TRIANGLES);
    expect(gantries).toBeGreaterThan(REALISTIC_GANTRY_TRIANGLES / 2);
    // Non-vacuity: the structures are a real share of the frame — a village
    // of detailed buildings — rather than a term that rounds to nothing.
    expect(structureItems * heaviestStructure).toBeGreaterThan(10_000);
    expect(heaviestStructure).toBeGreaterThan(300);
  });

  it('holds it with a room’s remote riders in it too: two realistic and the stylised rest — #783', () => {
    const { vegetation, riders, structureItems, blobs, gantries } = worstFrame();
    const stylised = stylisedRiderTriangles();
    const remote =
      REALISTIC_REMOTE_RIDERS * (riderTriangles + realisticBicycleTriangles()) +
      REALISTIC_REMOTE_STYLISED_RIDERS * stylised;
    // At every structure's CEILING, the frame the #506 case above allows.
    expect(
      vegetation +
        riders +
        structureItems * REALISTIC_TRIANGLES.structure +
        blobs +
        gantries +
        remote,
    ).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
    // Non-vacuity: the stylised term is real, and the room's whole K drawn
    // stylised would NOT fit — which is why the rule stops at 24.
    expect(stylised).toBeGreaterThan(1_000);
    expect(
      vegetation +
        riders +
        structureItems * REALISTIC_TRIANGLES.structure +
        blobs +
        gantries +
        REALISTIC_REMOTE_RIDERS * (riderTriangles + realisticBicycleTriangles()) +
        MAXIMUM_DRAWN_RIDERS * stylised,
    ).toBeGreaterThan(REALISTIC_FRAME_TRIANGLES);
    // #681 stays blocked: this is two bodies, not a pack.
    expect(REALISTIC_REMOTE_RIDERS).toBeLessThanOrEqual(2);
    // The browser gate's ceiling: inside what the worst frame leaves, and the
    // rule's own worst inside it.
    expect(
      vegetation +
        riders +
        structureItems * REALISTIC_TRIANGLES.structure +
        blobs +
        gantries +
        REALISTIC_REMOTE_TRIANGLES,
    ).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
    expect(remote).toBeLessThanOrEqual(REALISTIC_REMOTE_TRIANGLES);
  });

  it('holds it with every structure at its CEILING too, so a building may grow to its budget — #506', () => {
    const { vegetation, riders, structureItems, blobs, gantries } = worstFrame();
    expect(
      vegetation + riders + structureItems * REALISTIC_TRIANGLES.structure + blobs + gantries,
    ).toBeLessThanOrEqual(REALISTIC_FRAME_TRIANGLES);
    // And the figure the rungs spend is the one `realistic-budget.ts` states.
    expect(structureItems).toBe(REALISTIC_STRUCTURE_ITEMS);
  });

  it('counts a ground blob under every mesh and structure a frame can draw, inside #620’s 124 — #620', () => {
    const { blobs, structureItems } = worstFrame();
    // Every tree at the full or middle level, the band between them, every
    // shrub and rock mesh, and every structure the richest realistic rung
    // carries: the belt's capacity, and so the most a frame can submit.
    const trees = REALISTIC_TREE_LEVELS.near + REALISTIC_TREE_LEVELS.middle + 1;
    expect(REALISTIC_GROUND_BLOBS).toBe(
      trees + REALISTIC_NEAR_MESHES.shrub + REALISTIC_NEAR_MESHES.rock + structureItems,
    );
    expect(REALISTIC_GROUND_BLOBS).toBe(62);
    expect(GROUND_BLOB_TRIANGLES).toBe(2);
    expect(blobs).toBeLessThanOrEqual(124);
    console.log(
      `#620: ${String(REALISTIC_GROUND_BLOBS)} ground blobs at most, ${String(blobs)} triangles`,
    );
  });

  it('falls by at least 60 000 triangles with the trees’ middle level — #617', () => {
    // The worst frame as it was summed before #617: the nearest THREE of each
    // tree kind as full meshes, a hard swap, no middle level.
    const before =
      3 * heaviestNear('tree-broadleaf') +
      3 * heaviestNear('tree-conifer') +
      REALISTIC_NEAR_MESHES.shrub * heaviestNear('shrub') +
      REALISTIC_NEAR_MESHES.rock * heaviestNear('rock');
    const now = worstVegetation();
    console.log(
      `#617: worst vegetation ${String(now)} triangles, ${String(before)} before — ` +
        `${String(before - now)} fewer; the heaviest middle tree ${String(heaviestMiddle())}`,
    );
    expect(before - now).toBeGreaterThanOrEqual(60_000);
    // The frame's figure is unchanged: what fell is the worst case under it.
    expect(REALISTIC_FRAME_TRIANGLES).toBe(300_000);
    // And the hard swap the browser gate draws as its control is no lighter
    // than what it replaced, so a green control is not a lighter frame.
    expect(worstVegetation(HARD_SWAP_TREE_LEVELS) - now).toBeGreaterThanOrEqual(60_000);
  });

  it('counts a band tree at BOTH its levels in that worst case — #617', () => {
    // Non-vacuity for the sum above: the dithered hand-over costs a full tree
    // and two middle ones over the same counts with no band.
    const bandless = worstVegetation({ ...REALISTIC_TREE_LEVELS, dithered: false });
    expect(worstVegetation() - bandless).toBe(
      Math.max(...TREE_KINDS.map(heaviestNear)) + 2 * heaviestMiddle(),
    );
  });

  /**
   * Every committed texture but the sky, read off disk, by class — #618:
   * each a KTX2 file, whose own header says its size and encoding.
   */
  const textures = (): readonly {
    readonly role:
      'surface' | 'structure' | 'model' | 'impostor' | 'impostor-normals' | 'bicycle' | 'rider';
    readonly facts: Ktx2Facts;
  }[] => [
    // #623: the rider's kit, relief and occlusion.
    ...REALISTIC_RIDER_MAP_NAMES.map((map) => ({
      role: 'rider' as const,
      facts: fileKtx2Facts(at(REALISTIC_RIDER_MAPS[map])),
    })),
    // #624: the bicycle's four drawn maps.
    ...REALISTIC_BICYCLE_MAP_NAMES.map((map) => ({
      role: 'bicycle' as const,
      facts: fileKtx2Facts(at(REALISTIC_BICYCLE_MAPS[map])),
    })),
    ...[
      REALISTIC_SURFACES.road,
      REALISTIC_SURFACES.ground,
      REALISTIC_SURFACES.verge,
      REALISTIC_SURFACES.rock,
    ].flatMap((maps) =>
      [maps.colour, maps.normal].map((file) => ({
        role: 'surface' as const,
        facts: fileKtx2Facts(at(file)),
      })),
    ),
    ...PHOTOGRAPHIC_STRUCTURE_SURFACES.flatMap((surface) => {
      const maps = REALISTIC_STRUCTURE_SURFACES[surface];
      return [maps.colour, maps.normal].map((file) => ({
        role: 'structure' as const,
        facts: fileKtx2Facts(at(file)),
      }));
    }),
    ...REALISTIC_VEGETATION_KINDS.flatMap((kind) =>
      REALISTIC_VEGETATION[kind].flatMap((model) => [
        ...modelFacts(at(model.file)).ktx2.map((facts) => ({ role: 'model' as const, facts })),
        ...(model.impostor === undefined
          ? []
          : [{ role: 'impostor' as const, facts: fileKtx2Facts(at(model.impostor)) }]),
        // #630: the strip's normals, priced as the normal maps they are.
        ...(model.impostorNormals === undefined
          ? []
          : [
              {
                role: 'impostor-normals' as const,
                facts: fileKtx2Facts(at(model.impostorNormals)),
              },
            ]),
      ]),
    ),
  ];

  /** What the tablet is handed per texel for one KTX2 file. @see DEVICE_BYTES_PER_TEXEL */
  const onTheTablet = (facts: Ktx2Facts): number =>
    facts.scheme === 'uastc'
      ? DEVICE_BYTES_PER_TEXEL.uastc
      : facts.alpha
        ? DEVICE_BYTES_PER_TEXEL['etc1s-alpha']
        : DEVICE_BYTES_PER_TEXEL.etc1s;

  /** The sky alone: half-float with no mipmaps, and the environment prefiltered from it. */
  const skyBytes = (): number => {
    const sky = fileImageSize(at(REALISTIC_SKY));
    return (
      estimatedTextureBytes({ ...sky, bytesPerTexel: 8, mipmapped: false }) +
      environmentMapBytes(sky.width)
    );
  };

  it('commits every texture but the sky as KTX2, a full mipmap chain each — #618', () => {
    const all = textures();
    // Non-vacuity: the whole set, read — eight surface maps, fourteen structure
    // maps, four impostors and every map in a tree, shrub and rock.
    expect(all.length).toBeGreaterThanOrEqual(40);
    for (const { role, facts } of all) {
      const full = Math.floor(Math.log2(Math.max(facts.width, facts.height))) + 1;
      expect(facts.levels, `${role} ${JSON.stringify(facts)}`).toBe(full);
    }
    // And no JPEG or PNG is left in a model for three to decode to RGBA8.
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        const facts = modelFacts(at(model.file));
        expect(facts.ktx2.length, model.file).toBe(facts.images.length);
      }
    }
  });

  it('holds the estimated texture memory under its ceiling, as the tablet is handed it — #618', () => {
    const all = textures();
    const compressed = all.reduce(
      (sum, { facts }) =>
        sum +
        estimatedTextureBytes({ ...facts, bytesPerTexel: onTheTablet(facts), mipmapped: true }),
      0,
    );
    // The same set as three decoded it before #618, RGBA8: the "before".
    const decoded = all.reduce(
      (sum, { facts }) =>
        sum + estimatedTextureBytes({ ...facts, bytesPerTexel: 4, mipmapped: true }),
      0,
    );
    // #679: the banners' atlas, made at load from the app's glyphs — one
    // byte a texel, uncompressed, with its mips; in no committed file.
    const banners = estimatedTextureBytes({
      width: BANNER_CELL_WIDTH,
      height: BANNER_CELL_HEIGHT * BANNER_CELLS,
      bytesPerTexel: 1,
      mipmapped: true,
    });
    expect(banners).toBeLessThanOrEqual(2 ** 20);
    // #626: and the riders' silhouette, made at runtime at its own ceiling.
    const total = compressed + skyBytes() + REALISTIC_RIDER_SILHOUETTE_BYTES + banners;
    const before = decoded + skyBytes();
    const mib = (bytes: number): string => (bytes / 2 ** 20).toFixed(1);
    const tablet = (facts: Ktx2Facts): number =>
      estimatedTextureBytes({ ...facts, bytesPerTexel: onTheTablet(facts), mipmapped: true });
    const sum = (keep: (each: (typeof all)[number]) => boolean): number =>
      all.filter(keep).reduce((bytes, each) => bytes + tablet(each.facts), 0);
    const standalone = (each: (typeof all)[number]): boolean =>
      each.role === 'surface' || each.role === 'structure';
    console.log(
      `#618: texture memory estimated ${mib(total)} MiB on the tablet's formats, ${mib(before)} MiB as RGBA8. ` +
        `Colour maps ${mib(sum((each) => standalone(each) && each.facts.scheme === 'etc1s'))}, ` +
        `normal maps ${mib(sum((each) => standalone(each) && each.facts.scheme === 'uastc'))}, ` +
        `maps inside a GLB ${mib(sum((each) => each.role === 'model'))}, ` +
        `impostors ${mib(sum((each) => each.role === 'impostor'))}, ` +
        `their normals (#630) ${mib(sum((each) => each.role === 'impostor-normals'))}; ` +
        `the banners (#679) ${mib(banners)}; the sky alone ${mib(skyBytes())}`,
    );
    expect(total).toBeLessThanOrEqual(REALISTIC_TEXTURE_MEMORY_BYTES);
    // #618's criterion: it FALLS, from the 136 MiB the RGBA8 set was estimated at.
    expect(before).toBeGreaterThan(130 * 2 ** 20);
    expect(total).toBeLessThan(before - 60 * 2 ** 20);
    // ⚠️ Non-vacuity: the set is real, so the estimate is a real fraction of
    // the ceiling rather than a rounding error under it.
    expect(total).toBeGreaterThan(REALISTIC_TEXTURE_MEMORY_BYTES / 4);
  });

  it('prices a KTX2 file by what the tablet is handed, never by the file’s own size — #618', () => {
    // A colour map with no alpha is ETC2 RGB, half a byte a texel; with alpha,
    // ETC2 RGBA; a normal map ASTC 4×4. The road's colour and normal maps
    // are the same 1024 px and must price differently.
    const colour = fileKtx2Facts(at(REALISTIC_SURFACES.road.colour));
    const normal = fileKtx2Facts(at(REALISTIC_SURFACES.road.normal));
    expect(colour).toMatchObject({ scheme: 'etc1s', alpha: false, transfer: 'srgb' });
    expect(normal).toMatchObject({ scheme: 'uastc', alpha: false, transfer: 'linear' });
    expect(onTheTablet(colour)).toBe(0.5);
    expect(onTheTablet(normal)).toBe(1);
    for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
      for (const model of REALISTIC_VEGETATION[kind]) {
        if (model.impostor === undefined) continue;
        const strip = fileKtx2Facts(at(model.impostor));
        expect(strip, model.impostor).toMatchObject({ scheme: 'etc1s', alpha: true });
        expect(onTheTablet(strip)).toBe(1);
      }
    }
  });

  it('adds the bicycle’s surfaces inside #624’s own ceiling, texture memory and build alike', () => {
    const bicycle = textures().filter((each) => each.role === 'bicycle');
    // Non-vacuity: all four, read.
    expect(bicycle).toHaveLength(REALISTIC_BICYCLE_MAP_NAMES.length);
    const memory = bicycle.reduce(
      (sum, { facts }) =>
        sum +
        estimatedTextureBytes({ ...facts, bytesPerTexel: onTheTablet(facts), mipmapped: true }),
      0,
    );
    const build = REALISTIC_BICYCLE_MAP_NAMES.reduce(
      (sum, map) => sum + statSync(at(REALISTIC_BICYCLE_MAPS[map])).size,
      0,
    );
    console.log(
      `#624: the bicycle's maps are ${String(Math.round(memory))} bytes estimated on the tablet, ${String(build)} bytes in the build`,
    );
    expect(memory).toBeLessThanOrEqual(REALISTIC_BICYCLE_SURFACES.textureBytes);
    expect(build).toBeLessThanOrEqual(REALISTIC_BICYCLE_SURFACES.buildBytes);
    // Every one of them at or under its class's size, and priced as UASTC.
    for (const { facts } of bicycle) {
      expect(Math.max(facts.width, facts.height)).toBeLessThanOrEqual(
        REALISTIC_TEXTURE_PIXELS.bicycle,
      );
      expect(onTheTablet(facts)).toBe(DEVICE_BYTES_PER_TEXEL.uastc);
    }
  });

  it('dresses the rider inside #623’s own ceiling, texture memory and build alike', () => {
    const rider = textures().filter((each) => each.role === 'rider');
    // Non-vacuity: all three, read.
    expect(rider).toHaveLength(REALISTIC_RIDER_MAP_NAMES.length);
    const memory = rider.reduce(
      (sum, { facts }) =>
        sum +
        estimatedTextureBytes({ ...facts, bytesPerTexel: onTheTablet(facts), mipmapped: true }),
      0,
    );
    const build = [
      REALISTIC_RIDER,
      ...REALISTIC_RIDER_MAP_NAMES.map((map) => REALISTIC_RIDER_MAPS[map]),
    ].reduce((sum, file) => sum + statSync(at(file)).size, 0);
    const added = build - REALISTIC_RIDER_SURFACES.buildBefore;
    console.log(
      `#623: the rider's maps are ${(memory / 2 ** 20).toFixed(2)} MiB estimated on the tablet; ` +
        `the rider is ${String(build)} bytes in the build, ${String(added)} against the ${String(REALISTIC_RIDER_SURFACES.buildBefore)} before`,
    );
    expect(memory).toBeLessThanOrEqual(REALISTIC_RIDER_SURFACES.textureBytes);
    expect(added).toBeLessThanOrEqual(REALISTIC_RIDER_SURFACES.buildBytes);
    for (const { facts } of rider) {
      expect(Math.max(facts.width, facts.height)).toBeLessThanOrEqual(
        REALISTIC_TEXTURE_PIXELS.rider,
      );
    }
    // The kit is colour, ETC1S; the relief and the occlusion/roughness/mask
    // are data, UASTC.
    expect(rider.map(({ facts }) => facts.scheme).sort()).toEqual(['etc1s', 'uastc', 'uastc']);
  });

  it('adds no more to the build than its share, the transcoder included — #618', () => {
    const files = realisticFiles().reduce((sum, file) => sum + statSync(at(file)).size, 0);
    const transcoder = TRANSCODER_FILES.reduce(
      (sum, file) => sum + statSync(transcoderSource(WEB, file)).size,
      0,
    );
    console.log(
      `#618: the realistic set is ${String(files)} bytes and its transcoder ${String(transcoder)}`,
    );
    // ADR 0026 D-8 recorded the .wasm at 527 333 bytes, read from the tree.
    expect(statSync(transcoderSource(WEB, 'basis_transcoder.wasm')).size).toBe(527_333);
    expect(files + transcoder).toBeLessThanOrEqual(REALISTIC_BUILD_BYTES);
    expect(files).toBeGreaterThan(REALISTIC_BUILD_BYTES / 4);
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
