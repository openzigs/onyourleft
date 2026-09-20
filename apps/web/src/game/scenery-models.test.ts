// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The committed models, and what one of them is allowed to reach for.
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
 * and JSON chunk directly. That needs no GL context, no loader and no network,
 * which is what lets them run in the fast suite where a reviewer will actually
 * see them go red.
 *
 * ⚠️ **The guard in `sceneryResourceUrl` would be untestable without this.** A
 * policy over a corpus that declares no external resource is trivially green,
 * and that is the single most likely way this file becomes decoration. Every
 * City Kit building declares exactly one — the atlas its pack paints every
 * building from — and the tests below read that declaration out of the file
 * rather than asserting it from memory.
 *
 * ⚠️ **Since #366 that atlas is answered with a committed file rather than
 * with 68 bytes of nothing**, so the refusal is a *redirection* and the claim
 * it supports is about the function's range rather than its conditions. A
 * reviewer who remembers this file asserting that a `colormap.png` gets a
 * transparent PNG is reading the old one.
 */

import { describe, expect, it } from 'vitest';

import { readGlb } from './model-bytes-testing';
import { SCATTER_KINDS, type ScatterKind } from './scatter';
import {
  MAXIMUM_SCENERY_VARIANTS,
  SCENERY_ATLAS,
  SCENERY_MODELS,
  sceneryResourceUrl,
} from './scenery-models';
import { SCENERY_PALETTE } from './scenery-palette';

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

/** Every model in the table, flattened, with the kind it belongs to. */
function everyModel(): readonly { kind: ScatterKind; name: string; url: string }[] {
  return Object.entries(SCENERY_MODELS).flatMap(([kind, models]) =>
    models.map((model) => ({ kind: kind as ScatterKind, ...model })),
  );
}

/** One model's glTF JSON chunk, parsed out of the committed container. */
function glTfOf(name: string): ReturnType<typeof readGlb>['json'] {
  return readGlb(new URL(`./models/${name}`, import.meta.url).pathname).json;
}

describe('which shapes each kind is drawn with — ADR 0022 D-3, #367', () => {
  it('gives five of the six kinds a model and leaves `post` alone', () => {
    // D-3, in the form a reader can check: *"A shape with no silhouette to buy
    // is not worth buying."* A marker post is 1.1 m tall and 14 cm across.
    expect(Object.keys(SCENERY_MODELS).sort()).toEqual([
      'building',
      'rock',
      'shrub',
      'tree-broadleaf',
      'tree-conifer',
    ]);
    expect(SCENERY_MODELS.post).toBeUndefined();
  });

  it('names a kind `scatter.ts` can actually place, for every entry', () => {
    // A table keyed on a kind that no longer exists is a model that is loaded,
    // prepared, held in memory and drawn by nothing.
    for (const kind of Object.keys(SCENERY_MODELS) as ScatterKind[]) {
      expect(SCATTER_KINDS).toContain(kind);
    }
  });

  it('draws each kind with files ADR 0022 D-2 assigns it', () => {
    // The kit boundary is the **author**, not the archive (D-2): trees, shrubs
    // and rocks come from Kenney's *Nature Kit* and the buildings from its
    // *City Kit (Suburban)*, because no single kit holds all five. A file from
    // a second author is a change to that ADR, and this is where it shows up.
    const named = Object.fromEntries(
      Object.entries(SCENERY_MODELS).map(([kind, models]) => [
        kind,
        models.map((model) => fileOf(model.url)),
      ]),
    );

    expect(named).toEqual({
      'tree-broadleaf': ['tree_default.glb', 'tree_oak.glb'],
      'tree-conifer': ['tree_pineTallA.glb', 'tree_pineRoundD.glb'],
      shrub: ['plant_bush.glb', 'plant_bushLargeTriangle.glb'],
      rock: ['stone_largeA.glb', 'stone_largeC.glb'],
      building: ['building-type-h.glb', 'building-type-i.glb', 'building-type-k.glb'],
    });
  });

  it('meets #367 — three buildings and two of every natural kind', () => {
    // The issue's first criterion, stated as the numbers rather than as the
    // filenames above, so a swap that kept the count is a different failure
    // from a swap that lost one.
    expect(SCENERY_MODELS.building).toHaveLength(3);
    for (const kind of ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'] as const) {
      expect(SCENERY_MODELS[kind]?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every kind inside the variant budget — #367', () => {
    // ⚠️ **The budget half of #367's sixth criterion, and the reason it is a
    // test rather than a constant nobody reads.** A variant is a draw call;
    // this is what a pull request that adds a fourth shape has to get past, and
    // it cannot be got past by adding a file. `game.browser.spec.ts` is where
    // the cost of the three is measured.
    for (const [kind, models] of Object.entries(SCENERY_MODELS)) {
      expect(models.length, `${kind} variants`).toBeLessThanOrEqual(MAXIMUM_SCENERY_VARIANTS);
      expect(models.length).toBeGreaterThan(0);
    }
  });

  it('gives every model a different file', () => {
    const urls = everyModel().map((model) => model.url);

    expect(new Set(urls).size).toBe(urls.length);
  });

  it('records a palette for every model, and a model for every palette — #366', () => {
    // ⚠️ **What stops `SCENERY_PALETTE` going stale against the files actually
    // loaded, in both directions.** A model added without a palette entry is a
    // colour in the scene that nothing asserts, which is exactly the hole
    // ADR 0022 D-7 was protecting; a palette entry left behind by a model that
    // was removed is a gate asserting something nobody draws.
    expect(
      everyModel()
        .map((model) => model.name)
        .sort(),
    ).toEqual(Object.keys(SCENERY_PALETTE).sort());
  });

  it('names each model by the file it actually is', () => {
    // The palette is keyed on the name, and the name is not derivable from the
    // URL — so a name that has drifted from its file would key the gate onto
    // the wrong colours while every other test here stayed green.
    for (const model of everyModel()) {
      expect(fileOf(model.url)).toBe(`${model.name}.glb`);
    }
  });
});

describe('the committed bytes are glTF 2.0 with geometry in them', () => {
  for (const model of everyModel()) {
    it(`reads ${model.name} as a mesh with positions and normals`, () => {
      const gltf = glTfOf(fileOf(model.url));
      const primitives = (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives);

      expect(primitives.length).toBeGreaterThan(0);
      for (const primitive of primitives) {
        expect(primitive.attributes['POSITION']).toBeTypeOf('number');
        expect(primitive.attributes['NORMAL']).toBeTypeOf('number');
      }
    });

    it(`packs ${model.name}'s buffer inside the container rather than beside it`, () => {
      // A `.glb` may still point at an external `.bin`, and one that did would
      // be a model whose geometry is answered with a transparent PNG and which
      // therefore silently falls back to a primitive. Every committed file is
      // self-contained, which is what makes the policy free.
      for (const buffer of glTfOf(fileOf(model.url)).buffers ?? []) {
        expect(buffer.uri).toBeUndefined();
      }
    });
  }
});

describe('what a model is allowed to fetch — #240 NFR-5, #366', () => {
  it('lets each model fetch its own bytes', () => {
    for (const model of everyModel()) {
      expect(sceneryResourceUrl(model.url)).toBe(model.url);
    }
  });

  it('has something to answer, read out of the committed files', () => {
    // ⚠️ **The non-vacuity of everything below.** A policy over a corpus that
    // asks for nothing is green for the wrong reason, for ever. Every City Kit
    // building declares its pack's shared colour atlas as an external URI, and
    // that is what the next assertions are about.
    for (const model of SCENERY_MODELS.building ?? []) {
      const declared = (glTfOf(fileOf(model.url)).images ?? []).map((image) => image.uri);

      expect(declared).toEqual(['Textures/colormap.png']);
    }
  });

  it('answers that atlas with OUR atlas, however the loader spells it', () => {
    // `LoadingManager` hands its modifier the **resolved** URL, so the relative
    // URI in the file arrives having been joined onto wherever the bundler put
    // the model. Every spelling lands on the committed file — including the
    // one that names a third party, which is the case that matters: the answer
    // is a redirection and never an admission.
    for (const asked of [
      'Textures/colormap.png',
      'http://localhost:4173/assets/Textures/colormap.png',
      'https://example.invalid/colormap.png',
      'https://example.invalid/deep/path/colormap.png?v=2#frag',
    ]) {
      expect(sceneryResourceUrl(asked)).toBe(SCENERY_ATLAS.url);
    }
  });

  it('answers everything else with something small and blank', () => {
    // 68 bytes of transparent PNG, already in the bundle. Not a placeholder
    // that might one day be replaced by a real asset: the point is that it is
    // never fetched and never drawn.
    for (const asked of [
      'https://example.invalid/tracker.png',
      'https://example.invalid/another-model.glb',
      'Textures/colormap.jpg',
      'notcolormap.png',
      '',
    ]) {
      const stand = sceneryResourceUrl(asked);

      expect(stand).toMatch(/^data:image\/png;base64,/);
      expect(Buffer.from(stand.split(',')[1] ?? '', 'base64')).toHaveLength(68);
    }
  });

  it('never answers with a URL that is not one of ours — #366', () => {
    // ⚠️ **The claim stated over the function's RANGE rather than its
    // conditions, which is what makes it survive a future model nobody has
    // read.** Whatever a glTF asks for, what comes back is a model of ours, the
    // atlas of ours, or 68 bytes — so a file declaring a host cannot reach it,
    // and no new condition has to be written to keep that true.
    const ours = new Set<string>([...everyModel().map((model) => model.url), SCENERY_ATLAS.url]);
    const hostile = [
      'https://example.invalid/anything',
      'http://127.0.0.1:9/probe',
      '//example.invalid/protocol-relative.png',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      '../../../secret.glb',
      'colormap.png.glb',
      'COLORMAP.PNG',
    ];

    for (const asked of hostile) {
      const answered = sceneryResourceUrl(asked);

      expect(ours.has(answered) || answered.startsWith('data:image/png;base64,')).toBe(true);
      expect(answered).not.toBe(asked);
    }
  });
});
