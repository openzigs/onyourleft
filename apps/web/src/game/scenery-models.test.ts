// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The five committed models, and what one of them is allowed to reach for.
 *
 * ## Why this reads the bytes rather than mocking around them
 *
 * `scenery-models.ts` is a table and one pure function, and both make claims
 * about files nobody opens in review. A `.glb` is a binary: it carries no SPDX
 * header, it is in no dependency closure, and — until this file — the only
 * thing in the repository that could say anything about its *contents* was a
 * SHA-256 in `ASSETS.toml`, which says the bytes have not changed and nothing
 * about what they are.
 *
 * So the assertions below open the committed files and read their glTF header
 * and JSON chunk directly, with `node:fs`. That needs no GL context, no loader
 * and no network, which is what lets them run in the fast suite where a
 * reviewer will actually see them go red.
 *
 * ⚠️ **The guard in `sceneryResourceUrl` would be untestable without this.** A
 * policy that refuses every external resource is trivially green against a
 * corpus that declares none, and that is the single most likely way this file
 * becomes decoration. `building-type-h.glb` declares exactly one — the atlas
 * its pack paints every building from — and the test below reads that
 * declaration out of the file rather than asserting it from memory.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCATTER_KINDS, type ScatterKind } from './scatter';
import { SCENERY_MODEL_FILES, sceneryResourceUrl } from './scenery-models';

/**
 * The file name behind one of the table's URLs.
 *
 * ⚠️ **The table holds URLs, not paths**, and their shape is the bundler's
 * business: under Vite's dev pipeline — which is what a test runs against — a
 * `?url` import resolves to the module's own path, and a production build
 * emits a content-hashed name instead. So this takes the last segment, and the
 * assertions using it are about the **source tree**, which is the thing a test
 * can check.
 */
function fileOf(url: string | undefined): string {
  return (url ?? '').split('/').pop()?.split('?')[0] ?? '';
}

/** One model's glTF JSON chunk, parsed out of the committed container. */
function glTfOf(name: string): {
  readonly asset: { readonly version: string };
  readonly meshes?: readonly {
    readonly primitives: readonly { readonly attributes: Record<string, number> }[];
  }[];
  readonly images?: readonly { readonly uri?: string }[];
  readonly buffers?: readonly { readonly uri?: string }[];
} {
  const bytes = readFileSync(fileURLToPath(new URL(`./models/${name}`, import.meta.url)));
  // The GLB container: a 12-byte header — magic, version, length — then chunks,
  // each 8 bytes of length and type. The first chunk is the JSON.
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.subarray(16, 20).toString('ascii')).toBe('JSON');
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as ReturnType<
    typeof glTfOf
  >;
}

describe('which shape each kind is drawn with — ADR 0022 D-3', () => {
  it('gives five of the six kinds a model and leaves `post` alone', () => {
    // D-3, in the form a reader can check: *"A shape with no silhouette to buy
    // is not worth buying."* A marker post is 1.1 m tall and 14 cm across.
    expect(Object.keys(SCENERY_MODEL_FILES).sort()).toEqual([
      'building',
      'rock',
      'shrub',
      'tree-broadleaf',
      'tree-conifer',
    ]);
    expect(SCENERY_MODEL_FILES.post).toBeUndefined();
  });

  it('names a kind `scatter.ts` can actually place, for every entry', () => {
    // A table keyed on a kind that no longer exists is a model that is loaded,
    // prepared, held in memory and drawn by nothing.
    for (const kind of Object.keys(SCENERY_MODEL_FILES) as ScatterKind[]) {
      expect(SCATTER_KINDS).toContain(kind);
    }
  });

  it('draws each kind with the file ADR 0022 D-2 assigns it', () => {
    // The kit boundary is the **author**, not the archive (D-2): trees, shrubs
    // and rocks come from Kenney's *Nature Kit* and the building from its
    // *City Kit (Suburban)*, because no single kit holds all five. A file from
    // a second author is a change to that ADR, and this is where it shows up.
    expect(fileOf(SCENERY_MODEL_FILES['tree-broadleaf'])).toBe('tree_default.glb');
    expect(fileOf(SCENERY_MODEL_FILES['tree-conifer'])).toBe('tree_pineTallA.glb');
    expect(fileOf(SCENERY_MODEL_FILES.shrub)).toBe('plant_bush.glb');
    expect(fileOf(SCENERY_MODEL_FILES.rock)).toBe('stone_largeA.glb');
    expect(fileOf(SCENERY_MODEL_FILES.building)).toBe('building-type-h.glb');
  });

  it('gives each kind a different shape', () => {
    const urls = Object.values(SCENERY_MODEL_FILES);

    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('the committed bytes are glTF 2.0 with geometry in them', () => {
  for (const [kind, url] of Object.entries(SCENERY_MODEL_FILES)) {
    it(`reads ${kind} as a mesh with positions and normals`, () => {
      const model = glTfOf(fileOf(url));
      const primitives = (model.meshes ?? []).flatMap((mesh) => mesh.primitives);

      expect(model.asset.version).toBe('2.0');
      expect(primitives.length).toBeGreaterThan(0);
      for (const primitive of primitives) {
        expect(primitive.attributes.POSITION).toBeTypeOf('number');
        expect(primitive.attributes.NORMAL).toBeTypeOf('number');
      }
    });

    it(`packs ${kind}'s buffer inside the container rather than beside it`, () => {
      // A `.glb` may still point at an external `.bin`, and one that did would
      // be a model whose geometry is refused by `sceneryResourceUrl` and which
      // therefore silently falls back to a primitive. Every committed file is
      // self-contained, which is what makes the refusal free.
      for (const buffer of glTfOf(fileOf(url)).buffers ?? []) {
        expect(buffer.uri).toBeUndefined();
      }
    });
  }
});

describe('what a model is allowed to fetch — #240 NFR-5', () => {
  it('lets each model fetch its own bytes', () => {
    for (const url of Object.values(SCENERY_MODEL_FILES)) {
      expect(sceneryResourceUrl(url ?? '')).toBe(url);
    }
  });

  it('has something to refuse, read out of the committed file', () => {
    // ⚠️ **The non-vacuity of everything below.** A refusal policy over a
    // corpus that asks for nothing is green for the wrong reason, for ever.
    // `building-type-h.glb` declares its pack's shared colour atlas as an
    // external URI, and that is what the next assertion is about.
    const declared = (glTfOf(fileOf(SCENERY_MODEL_FILES.building)).images ?? []).map(
      (image) => image.uri,
    );

    expect(declared).toEqual(['Textures/colormap.png']);
  });

  it('refuses that atlas, however the loader spells it by the time it asks', () => {
    // `LoadingManager` hands its modifier the **resolved** URL, so the relative
    // URI in the file arrives having been joined onto wherever the bundler put
    // the model. Both spellings are refused, because the rule is membership of
    // the table rather than anything about the shape of the string.
    for (const asked of [
      'Textures/colormap.png',
      'http://localhost:4173/assets/Textures/colormap.png',
      'https://example.invalid/tracker.png',
      'https://example.invalid/another-model.glb',
      '',
    ]) {
      expect(sceneryResourceUrl(asked)).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('answers with something small enough to be free, and nothing to look at', () => {
    // 68 bytes of transparent PNG, already in the bundle. Not a placeholder
    // that might one day be replaced by the real atlas: the point is that it is
    // never fetched and never drawn.
    const stand = sceneryResourceUrl('Textures/colormap.png');

    expect(Buffer.from(stand.split(',')[1] ?? '', 'base64')).toHaveLength(68);
  });
});
