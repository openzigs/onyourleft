// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  alsoWritten,
  AMBIENTCG_GROUND_TEXTURES,
  AMBIENTCG_PHRASE,
  AMBIENTCG_STRUCTURE_TEXTURES,
  AMBIENTCG_TECHNIQUES_KEPT,
  ambientCgArchive,
  ambientCgTechniques,
  archiveOf,
  DRAWN_FROM,
  GENERATED_BARK_MAPS,
  GENERATED_FROM,
  GENERATED_LEAF_MAPS,
  GENERATED_TREE_TEXTURES,
  generatedInputDigest,
  generatedTreeMaps,
  POLY_HAVEN_TREE_MAPS,
  POLY_HAVEN_TREE_RESOLUTION,
  WORDMARK_FROM,
  EXPECTED_REPORTS,
  inputDigest,
  licenceVerdict,
  lockFault,
  encodingWords,
  ktxCreateArguments,
  OUTPUTS,
  PINNED_KTX,
  PINNED_KTX_VERSION_LINE,
  polyHavenAuthors,
  polyHavenFiles,
  reportFaults,
  RIDER_BUILD_TARGETS,
  safeRelativePath,
  shippedFiles,
  SOURCES,
  sourcesDigest,
  systemAssetVerdict,
  STRUCTURE_TEXTURES,
  structureMapFiles,
  TEXTURE_SCRIPT,
  TOWN_STRUCTURE_TEXTURES,
  type AssetSource,
  type InputLock,
  type Ktx2Step,
} from './sources';
import { sameFiles } from './fetch-assets';
import {
  GENERATED_SPECIES,
  GENERATED_TREES,
  runNumbersDigest,
  speciesOf,
  type GeneratedSpecies,
} from './generated-trees';
import {
  REALISTIC_HOUSE_ATLAS,
  REALISTIC_RIDER,
  REALISTIC_STRUCTURE_SURFACES,
  TOWN_STRUCTURE_SURFACES,
} from '../../src/game/realistic-assets';

const polyHaven = SOURCES.find((source) => source.id === 'farm_field') as AssetSource;
const makeHuman = SOURCES.find((source) => source.id === 'makehuman') as AssetSource;

/** This directory: where every recipe's script is. */
const PIPELINE = dirname(fileURLToPath(import.meta.url));

describe('what the pipeline keeps — #430, ADR 0026 D-4', () => {
  it('keeps a source whose own page states its licence', () => {
    const page = `<script type="application/ld+json">{"copyrightNotice":"${polyHaven.licencePhrase}"}</script>`;
    expect(licenceVerdict(polyHaven, page)).toEqual({
      kept: true,
      licence: 'CC0-1.0',
      evidence: polyHaven.licencePhrase,
    });
  });

  it('refuses a source whose page does not say so — a label elsewhere is not a grant', () => {
    const verdict = licenceVerdict(
      polyHaven,
      '<meta name="keywords" content="free,cc0,creative commons">',
    );
    expect(verdict.kept).toBe(false);
  });

  it('refuses a page that also names a non-commercial, no-derivatives or share-alike licence', () => {
    for (const other of ['CC BY-NC 4.0', 'CC-BY-NC-SA-4.0', 'CC BY-ND 4.0', 'CC BY-SA 4.0']) {
      const verdict = licenceVerdict(polyHaven, `${polyHaven.licencePhrase} … this file: ${other}`);
      expect(verdict, other).toMatchObject({ kept: false });
    }
  });

  it('refuses Mixamo by host, whatever the page says', () => {
    const mixamo: AssetSource = {
      ...makeHuman,
      id: 'character',
      licencePage: 'https://www.mixamo.com/terms',
    };
    expect(licenceVerdict(mixamo, makeHuman.licencePhrase)).toMatchObject({ kept: false });
  });

  it('keeps only CC0 and CC-BY-4.0, the two ADR 0026 D-4 admits under apps/', () => {
    for (const source of SOURCES) expect(['CC0-1.0', 'CC-BY-4.0']).toContain(source.licence);
  });

  it('reads from the hosts ADR 0026 names, and no other', () => {
    // A new host is a change to that ADR, not to this table — so a row from
    // anywhere else is a red test rather than a review note. ⚠️ Since #623
    // MakeHuman's own site is one of them: ADR 0026's 2026-09-28 amendment
    // records the owner's ruling that MakeHuman's CC0 system assets pack, from
    // the same author under the same grant, falls under D-4's MakeHuman row.
    // ⚠️ Since #1274 ambientCG is read too, and that is no new host: D-4's own
    // table has admitted it from the start, and nothing here had used it.
    // ⚠️ Since #1585 Sketchfab's public model records are read too, and that
    // is no new host either: D-4's "an individual model under CC-BY-4.0" row
    // admits a model wherever it is hosted, verified per asset.
    for (const source of SOURCES) {
      expect(new URL(source.licencePage).hostname, source.id).toMatch(
        /^(?:polyhaven\.com|ambientcg\.com|raw\.githubusercontent\.com|static\.makehumancommunity\.org|api\.sketchfab\.com)$/,
      );
    }
    // Every ambientCG asset is read through ambientCG's OWN origin, whose page
    // is held to `ambientCgVerdict`: one listed as plain URLs would be kept on
    // its licence sentence alone, however its page said it was made.
    const fromAmbientCg = SOURCES.filter(
      (source) => new URL(source.licencePage).hostname === 'ambientcg.com',
    );
    // The ground's rock (#1274), and since #1283 the generated trees' bark
    // and leaves — those of them that are ambientCG's: since #1294 the fir's
    // are Poly Haven's.
    const wornFrom = (from: 'ambientcg' | 'polyhaven'): string[] =>
      GENERATED_TREE_TEXTURES.filter((texture) => texture.from === from).map(
        (texture) => texture.id,
      );
    // And since #1535 a village's pavement.
    expect(fromAmbientCg.map((source) => source.id)).toEqual([
      ...AMBIENTCG_GROUND_TEXTURES.map((texture) => texture.id),
      ...AMBIENTCG_STRUCTURE_TEXTURES.map((texture) => texture.id),
      // #1548: the mapped towns' render, concrete and flat roof.
      ...TOWN_STRUCTURE_TEXTURES.map((texture) => texture.id),
      ...wornFrom('ambientcg'),
    ]);
    expect(wornFrom('ambientcg').length).toBeGreaterThan(0);
    // A Poly Haven asset a tree wears is read from Poly Haven's own page,
    // through Poly Haven's origin, as named maps and no geometry.
    expect(wornFrom('polyhaven')).toEqual(Object.keys(POLY_HAVEN_TREE_MAPS));
    for (const id of wornFrom('polyhaven')) {
      const source = SOURCES.find((each) => each.id === id);
      expect(source?.licencePage, id).toBe(`https://polyhaven.com/a/${id}`);
      expect(source?.origin, id).toMatchObject({ from: 'polyhaven', select: { type: 'maps' } });
    }
    for (const source of fromAmbientCg) expect(source.origin.from, source.id).toBe('ambientcg');
    expect(
      SOURCES.filter((source) => source.origin.from === 'ambientcg').map((source) => source.id),
    ).toEqual(fromAmbientCg.map((source) => source.id));
    // And only MakeHuman's own pack is read from MakeHuman's site.
    const fromMakeHumanSite = SOURCES.filter(
      (source) => new URL(source.licencePage).hostname === 'static.makehumancommunity.org',
    );
    expect(fromMakeHumanSite.map((source) => source.id)).toEqual(['makehuman-system-assets']);
  });

  it('pins MakeHuman to one commit and checks the mesh’s own CC0 header', () => {
    expect(makeHuman.origin.from).toBe('urls');
    if (makeHuman.origin.from !== 'urls') return;
    for (const file of makeHuman.origin.files) expect(file.url).toMatch(/\/[0-9a-f]{40}\//);
    expect(makeHuman.origin.files.find((file) => file.path === 'base.obj')?.mustContain).toMatch(
      /CC0/,
    );
  });
});

describe('Poly Haven’s answers', () => {
  const file = (name: string) => ({ url: `https://dl.polyhaven.org/${name}`, md5: 'm', size: 1 });

  it('takes a model and everything it includes', () => {
    const answer = {
      gltf: {
        '1k': {
          gltf: {
            ...file('tree_1k.gltf'),
            include: { 'textures/a.jpg': file('a.jpg'), 'tree.bin': file('tree.bin') },
          },
        },
      },
    };
    expect(
      polyHavenFiles('tree', { type: 'model', resolution: '1k' }, answer).map((each) => each.path),
    ).toEqual(['tree_1k.gltf', 'textures/a.jpg', 'tree.bin']);
  });

  it('takes a model’s named maps and none of its geometry — #1294', () => {
    const answer = {
      twig_diff: { '1k': { jpg: file('fir_twig_diff_1k.jpg'), png: file('fir_twig_diff_1k.png') } },
      twig_alpha: { '1k': { jpg: file('fir_twig_alpha_1k.jpg') } },
      gltf: { '1k': { gltf: { ...file('fir_1k.gltf'), include: { 'fir.bin': file('fir.bin') } } } },
    };
    const select = { type: 'maps', resolution: '1k', maps: ['twig_diff', 'twig_alpha'] } as const;
    expect(polyHavenFiles('fir', select, answer)).toEqual([
      {
        path: 'fir_twig_diff_1k.jpg',
        url: 'https://dl.polyhaven.org/fir_twig_diff_1k.jpg',
        md5: 'm',
        size: 1,
      },
      {
        path: 'fir_twig_alpha_1k.jpg',
        url: 'https://dl.polyhaven.org/fir_twig_alpha_1k.jpg',
        md5: 'm',
        size: 1,
      },
    ]);
    // A map the asset does not offer is a refusal: a model's glTF does not
    // include its alpha, and a sprig with no cut-out would be a green square.
    expect(() =>
      polyHavenFiles('fir', { ...select, maps: ['twig_diff', 'twig_mask'] }, answer),
    ).toThrow(/fir: Poly Haven offers no twig_mask\/1k\/jpg/);
  });

  it('refuses rather than quietly downloading less than was asked for', () => {
    const answer = { Diffuse: { '1k': { jpg: file('d1.jpg') } } };
    expect(() =>
      polyHavenFiles(
        't',
        { type: 'texture', resolution: '1k', maps: ['Diffuse', 'nor_gl'] },
        answer,
      ),
    ).toThrow(/offers no nor_gl\/1k\/jpg/);
  });

  it('writes the authors with their roles, and refuses an asset that names none', () => {
    expect(
      polyHavenAuthors('t', { authors: { 'A Person': 'scanning', 'B Person': 'cleanup' } }),
    ).toBe('A Person (scanning); B Person (cleanup)');
    expect(() => polyHavenAuthors('t', { authors: {} })).toThrow(/names no author/);
    expect(() => polyHavenAuthors('t', {})).toThrow(/names no author/);
  });
});

describe('a path from a remote answer', () => {
  it('may name a file below the output directory', () => {
    expect(safeRelativePath('textures/tree_diff_1k.jpg')).toBe(true);
  });

  it('may not climb out of it, or start at the root', () => {
    for (const path of [
      '../escape.jpg',
      'textures/../../x',
      '/etc/passwd',
      '',
      'a//b',
      './a',
      'a\\b',
    ]) {
      expect(safeRelativePath(path), path).toBe(false);
    }
  });
});

describe('the input digest — ADR 0026 D-5', () => {
  const files = [
    { path: 'b.bin', sha256: 'bb' },
    { path: 'a.gltf', sha256: 'aa' },
  ];

  it('is the SHA-256 of the sorted `shasum` lines, so it can be reproduced by hand', () => {
    // `printf 'aa  a.gltf\nbb  b.bin\n' | shasum -a 256`
    expect(inputDigest(files)).toBe(
      'e61585d588afbe3d74f2197abc283ef018a76918a02074ac1e055e9e494f09b7',
    );
  });

  it('does not depend on the order an API listed the files in', () => {
    expect(inputDigest(files)).toBe(inputDigest([...files].reverse()));
  });

  it('moves when two files swap contents, because the path is in it', () => {
    const swapped = [
      { path: 'a.gltf', sha256: 'bb' },
      { path: 'b.bin', sha256: 'aa' },
    ];
    expect(inputDigest(swapped)).not.toBe(inputDigest(files));
  });
});

describe('the pipeline’s own table', () => {
  it('makes every shipped file from a source it names — or draws it, and says so (#624)', () => {
    const ids = new Set(SOURCES.map((source) => source.id));
    for (const output of OUTPUTS) {
      if (output.recipe.how === 'drawn') {
        expect(output.from, output.file).toBe(DRAWN_FROM);
        continue;
      }
      // #966: the wordmark is made from the owner's artwork, committed here.
      if (output.recipe.how === 'wordmark') {
        expect(output.from, output.file).toBe(WORDMARK_FROM);
        continue;
      }
      // #1283: a generated tree is this repository's own work, wearing two
      // ambientCG assets its SPECIES names — each of them a source in the table.
      if (output.recipe.how === 'generated') {
        expect(output.from, output.file).toBe(GENERATED_FROM);
        const recipe = output.recipe;
        const tree = GENERATED_TREES.find((each) => each.name === recipe.tree);
        if (tree === undefined) throw new Error(`${output.file}: no generated tree`);
        expect(ids, output.file).toContain(speciesOf(tree).bark.source);
        expect(ids, output.file).toContain(speciesOf(tree).sprig.source);
        continue;
      }
      expect(ids, output.file).toContain(output.from);
    }
    // Non-vacuity: every generated tree has a full and a middle level.
    expect(OUTPUTS.filter((output) => output.recipe.how === 'generated')).toHaveLength(
      GENERATED_TREES.length * 2,
    );
    // Non-vacuity: the four bicycle maps, and only they, are drawn.
    expect(OUTPUTS.filter((output) => output.recipe.how === 'drawn')).toHaveLength(4);
    expect(OUTPUTS.filter((output) => output.recipe.how === 'wordmark')).toHaveLength(1);
  });

  it('downloads nothing it does not use', () => {
    const used = new Set(
      OUTPUTS.flatMap((output) => [
        output.from,
        ...(output.recipe.how === 'blender' ? (output.recipe.alsoReads ?? []) : []),
      ]),
    );
    // #1283: what a generated tree wears, by its species.
    for (const tree of GENERATED_TREES) {
      used.add(speciesOf(tree).bark.source);
      used.add(speciesOf(tree).sprig.source);
    }
    for (const source of SOURCES) expect(used, source.id).toContain(source.id);
  });

  it('says in words what a derived file had done to it', () => {
    for (const output of OUTPUTS) {
      if (output.recipe.how !== 'verbatim') expect(output.modified, output.file).toBeTruthy();
    }
  });

  it('names each shipped file once', () => {
    const files = shippedFiles();
    expect(new Set(files).size).toBe(files.length);
  });
});

describe('re-locking dates only what moved — #475', () => {
  const a = { path: 'a.jpg', sha256: '1' };
  const b = { path: 'b.jpg', sha256: '2' };

  it('calls the same files in any order the same', () => {
    expect(sameFiles([a, b], [b, a])).toBe(true);
  });

  it('calls a changed byte, a lost file or an added one different', () => {
    expect(sameFiles([a, b], [a, { ...b, sha256: '3' }])).toBe(false);
    expect(sameFiles([a, b], [a])).toBe(false);
    expect(sameFiles([a], [a, b])).toBe(false);
    expect(sameFiles([a, b], [a, { ...b, path: 'c.jpg' }])).toBe(false);
  });
});

describe('the structures’ surfaces — #475, ADR 0026 D-12 layer 3', () => {
  it('takes each from Poly Haven under CC0, colour and normal map at 1K', () => {
    for (const texture of STRUCTURE_TEXTURES) {
      const source = SOURCES.find((each) => each.id === texture.id);
      expect(source?.licence, texture.id).toBe('CC0-1.0');
      expect(source?.origin, texture.id).toEqual({
        from: 'polyhaven',
        select: { type: 'texture', resolution: '1k', maps: ['Diffuse', 'nor_gl'] },
      });
    }
  });

  it('makes two files from each, downsized by the committed texture script', () => {
    for (const texture of STRUCTURE_TEXTURES) {
      const made = OUTPUTS.filter((output) => output.from === texture.id);
      expect(made.map((output) => output.file).sort(), texture.id).toEqual(
        [structureMapFiles(texture.id).colour, structureMapFiles(texture.id).normal].sort(),
      );
      for (const output of made) {
        expect(output.recipe, output.file).toMatchObject({
          how: 'blender',
          script: TEXTURE_SCRIPT,
        });
        // The colour map is read as colour and the normal map as data, never the other way.
        const args = output.recipe.how === 'blender' ? output.recipe.args : [];
        expect(args[2], output.file).toBe(output.file.includes('_nor_gl_') ? 'data' : 'colour');
        expect(args[0], output.file).toBe(
          output.file.includes('_nor_gl_') ? `${texture.id}_nor_gl_1k.jpg` : texture.colourFile,
        );
      }
    }
  });
});

describe('the mapped towns’ surfaces — #1548', () => {
  it('takes one ambientCG CC0 material for each of the three, colour and normal map at 1K', () => {
    expect(TOWN_STRUCTURE_TEXTURES.map((texture) => texture.surface)).toEqual([
      ...TOWN_STRUCTURE_SURFACES,
    ]);
    for (const texture of TOWN_STRUCTURE_TEXTURES) {
      const source = SOURCES.find((each) => each.id === texture.id);
      expect(source?.licence, texture.id).toBe('CC0-1.0');
      expect(source?.licencePage, texture.id).toBe(`https://ambientcg.com/view?id=${texture.id}`);
      expect(source?.origin, texture.id).toEqual({
        from: 'ambientcg',
        attribute: '1K-JPG',
        maps: ['Color', 'NormalGL'],
      });
    }
  });

  it('makes exactly the two files the renderer loads, ambientCG’s 1K maps encoded with no step between', () => {
    for (const texture of TOWN_STRUCTURE_TEXTURES) {
      const maps = REALISTIC_STRUCTURE_SURFACES[texture.surface];
      const made = OUTPUTS.filter((output) => output.from === texture.id);
      expect(made.map((output) => output.file).sort(), texture.id).toEqual(
        [maps.colour, maps.normal].sort(),
      );
      for (const output of made) {
        const normal = output.file === maps.normal;
        // No Blender, no downsizing: the upstream JPEG straight into the
        // encoder — and the colour map as colour, the normal map as a normal
        // map, never the other way.
        expect(output.recipe, output.file).toEqual({
          how: 'ktx2',
          file: `${texture.id}_1K-JPG_${normal ? 'NormalGL' : 'Color'}.jpg`,
          ktx2: { encoding: normal ? 'normal' : 'colour', origin: 'bottom-left' },
        });
      }
    }
  });
});

describe('the KTX2 step — #618, ADR 0026 D-8', () => {
  const colour: Ktx2Step = { encoding: 'colour', origin: 'bottom-left' };

  it('encodes a colour map as ETC1S in sRGB, a normal map as UASTC assigned linear', () => {
    const colourArgs = ktxCreateArguments(colour, 'in.jpg', 'out.ktx2');
    expect(colourArgs).toEqual(expect.arrayContaining(['--encode', 'basis-lz', 'R8G8B8_SRGB']));
    const normal = ktxCreateArguments({ encoding: 'normal', origin: 'top-left' }, 'in.jpg', 'o');
    expect(normal).toEqual(
      expect.arrayContaining(['--encode', 'uastc', 'R8G8B8_UNORM', '--assign-tf', 'linear']),
    );
    expect(normal).not.toContain('--normal-mode');
    const alpha = ktxCreateArguments({ encoding: 'colour-alpha', origin: 'top-left' }, 'i', 'o');
    expect(alpha).toContain('R8G8B8A8_SRGB');
    // #624: a data map — the bicycle's roughness — is encoded as a normal map
    // is, linear, and never as sRGB colour, which would bend every value.
    const data = ktxCreateArguments({ encoding: 'data', origin: 'top-left' }, 'in.png', 'o');
    expect(data).toEqual(normal.map((arg) => (arg === 'in.jpg' ? 'in.png' : arg)));
    expect(data).not.toContain('R8G8B8_SRGB');
  });

  it('asks for the full mipmap chain, one thread and no silent colour conversion, every time', () => {
    for (const encoding of ['colour', 'colour-alpha', 'normal', 'data'] as const) {
      const args = ktxCreateArguments({ encoding, origin: 'top-left' }, 'in', 'out');
      expect(args[0]).toBe('create');
      expect(args).toEqual(
        expect.arrayContaining([
          '--generate-mipmap',
          '--threads',
          '1',
          '--fail-on-color-conversions',
        ]),
      );
      expect(args.slice(-2)).toEqual(['in', 'out']);
    }
  });

  it('reverses the rows of exactly the pictures TextureLoader used to flip', () => {
    expect(ktxCreateArguments(colour, 'i', 'o')).toEqual(
      expect.arrayContaining(['--convert-texcoord-origin', 'bottom-left']),
    );
    expect(ktxCreateArguments({ ...colour, origin: 'top-left' }, 'i', 'o')).not.toContain(
      '--convert-texcoord-origin',
    );
    // Every standalone texture was a TextureLoader picture, so every one is
    // flipped; a GLB's own maps never are (`encode-ktx2.ts` §`pinnedImageEncoder`).
    for (const output of OUTPUTS) {
      const recipe = output.recipe;
      if (recipe.how === 'ktx2') expect(recipe.ktx2.origin, output.file).toBe('bottom-left');
      // #624: a drawn map is drawn the way its coordinates read it, row 0 at
      // v = 0, and never went through TextureLoader — so it is not flipped.
      if (recipe.how === 'drawn') expect(recipe.ktx2.origin, output.file).toBe('top-left');
      if (recipe.how === 'blender') {
        // #1585: the house models' atlas is read at their GLBs' own texture
        // coordinates, which `GLTFLoader` never flips, and Blender writes it
        // top row first as those coordinates read it — the rider's case.
        if (recipe.ktx2 !== undefined) {
          expect(recipe.ktx2.origin, output.file).toBe(
            output.file === REALISTIC_HOUSE_ATLAS ? 'top-left' : 'bottom-left',
          );
        }
        // #623: the rider's maps are read at the body's own glTF texture
        // coordinates, which `GLTFLoader` never flips, and `process_rider.py`
        // writes them top row first as those coordinates read them.
        const glTF = output.file === REALISTIC_RIDER;
        for (const also of recipe.alsoWrites ?? []) {
          expect(also.ktx2.origin, also.file).toBe(glTF ? 'top-left' : 'bottom-left');
        }
      }
    }
  });

  it('ships every texture as KTX2 and the sky as the upstream HDR, nothing else verbatim', () => {
    const verbatim = OUTPUTS.filter((output) => output.recipe.how === 'verbatim');
    expect(verbatim.map((output) => output.file)).toEqual(['farm_field_2k.hdr']);
    const pictures = shippedFiles().filter((file) => !/\.(?:glb|hdr)$/.test(file));
    expect(pictures.length).toBeGreaterThanOrEqual(22);
    for (const file of pictures) expect(file).toMatch(/\.ktx2$/);
    // A colour map is colour, a normal map is normal, never the other way.
    for (const output of OUTPUTS) {
      const recipe = output.recipe;
      // A generated tree's own file is a GLB; its strips are held below.
      const step =
        recipe.how === 'verbatim' || recipe.how === 'generated' ? undefined : recipe.ktx2;
      if (step === undefined) continue;
      // #624: a roughness map is data — linear, never sRGB colour.
      // #966: the wordmark is a cut-out over its board, so it keeps its alpha.
      expect(step.encoding, output.file).toBe(
        recipe.how === 'wordmark'
          ? 'colour-alpha'
          : output.file.includes('_nor_gl_')
            ? 'normal'
            : output.file.includes('_rough_')
              ? 'data'
              : 'colour',
      );
    }
  });

  it('pins one KTX-Software release', () => {
    expect(PINNED_KTX).toBe('KTX-Software v4.4.2');
    expect(PINNED_KTX_VERSION_LINE).toBe('ktx version: v4.4.2');
    expect(encodingWords(colour)).toContain(PINNED_KTX);
  });
});

describe('MakeHuman’s CC0 system assets — #623, ADR 0026’s 2026-09-28 amendment', () => {
  const row = (type: string, name: string, author: string, licence: string): string =>
    `<tr>\n<td>${type}</td>\n<td><a href="#x"><img alt="${name}.png"></a></td>\n<td>${name}</td>\n<td>${author}</td>\n<td><a href="http://www.makehumancommunity.org">asset repo</a></td>\n<td>${licence}</td>\n</tr>`;
  const page = (...rows: string[]): string => `<table>${rows.join('')}</table>`;
  const skin = { type: 'skins', name: 'young_caucasian_male' };

  it('keeps an asset whose OWN row names MakeHuman’s own author and CC0', () => {
    expect(
      systemAssetVerdict(
        page(row('skins', 'young_caucasian_male', 'makehuman_system', 'CC0')),
        skin,
      ),
    ).toMatchObject({ kept: true, licence: 'CC0-1.0' });
  });

  it('refuses a community author, whatever the licence — the ruling’s premise is the same author', () => {
    expect(
      systemAssetVerdict(page(row('skins', 'young_caucasian_male', 'Mindfront', 'CC0')), skin),
    ).toMatchObject({ kept: false });
  });

  it('refuses any licence but CC0 on the asset’s own row', () => {
    for (const licence of ['CC-BY', 'AGPL', 'CC-BY-NC', '']) {
      expect(
        systemAssetVerdict(
          page(row('skins', 'young_caucasian_male', 'makehuman_system', licence)),
          skin,
        ),
        licence,
      ).toMatchObject({ kept: false });
    }
  });

  it('never lets another asset’s CC0 row vouch for this one', () => {
    // A page on which the NEXT skin is CC0 and this one is not listed at all.
    expect(
      systemAssetVerdict(
        page(row('skins', 'young_caucasian_male2', 'makehuman_system', 'CC0')),
        skin,
      ),
    ).toMatchObject({ kept: false });
    // Nor an eyebrow of the same name under another type.
    expect(
      systemAssetVerdict(
        page(row('eyebrows', 'young_caucasian_male', 'makehuman_system', 'CC0')),
        skin,
      ),
    ).toMatchObject({ kept: false });
  });

  it('takes its files out of the pack’s one archive, each naming its asset, the text ones checked for the CC0 header', () => {
    const system = SOURCES.find((source) => source.id === 'makehuman-system-assets');
    expect(system?.origin.from).toBe('archive');
    if (system?.origin.from !== 'archive') return;
    expect(new URL(system.origin.url).hostname).toBe('files.makehumancommunity.org');
    expect(system.licence).toBe('CC0-1.0');
    for (const member of system.origin.members) {
      expect(safeRelativePath(member.path), member.path).toBe(true);
      expect(
        member.path.startsWith(`${member.asset.type}/${member.asset.name}/`),
        member.path,
      ).toBe(true);
      if (!/\.png$/.test(member.path)) expect(member.mustContain, member.path).toMatch(/CC0/);
    }
  });

  it('fetches every build target from the pinned MakeHuman commit, checking each one’s CC0 header', () => {
    if (makeHuman.origin.from !== 'urls') throw new Error('MakeHuman is fetched by URL');
    const targets = makeHuman.origin.files.filter((file) => file.path.startsWith('targets/'));
    expect(targets.map((file) => file.path.slice('targets/'.length))).toEqual(RIDER_BUILD_TARGETS);
    for (const file of targets) {
      expect(file.url).toMatch(/\/[0-9a-f]{40}\/makehuman\/data\/targets\/macrodetails\//);
      expect(file.mustContain).toMatch(/CC0/);
    }
  });
});

describe('the digest of a run that reads two sources — #623', () => {
  const one = { id: 'a', files: [{ path: 'x', sha256: '1' }] };
  const two = { id: 'b', files: [{ path: 'y', sha256: '2' }] };

  it('is the input digest over both, each path under its source’s id', () => {
    expect(sourcesDigest([one, two])).toBe(
      inputDigest([
        { path: 'a/x', sha256: '1' },
        { path: 'b/y', sha256: '2' },
      ]),
    );
  });

  it('moves when a file moves from one source to the other', () => {
    expect(sourcesDigest([one, two])).not.toBe(
      sourcesDigest([
        { id: 'a', files: [] },
        { id: 'b', files: [...two.files, { path: 'x', sha256: '1' }] },
      ]),
    );
  });
});

describe('what --check requires of a run’s report — #900 item 2', () => {
  it('names only outputs a Blender run makes, whose script writes the count', () => {
    const files = Object.keys(EXPECTED_REPORTS);
    expect(files.sort()).toEqual(['island_tree_02-middle.glb', 'island_tree_02.glb']);
    for (const file of files) {
      const output = OUTPUTS.find((each) => each.file === file);
      expect(output?.recipe.how, file).toBe('blender');
      if (output?.recipe.how !== 'blender') continue;
      const script = readFileSync(join(PIPELINE, output.recipe.script), 'utf8');
      expect(script, file).toContain('"repeatedTrianglesDropped": repeated_triangles');
    }
  });

  it('passes a report with #696’s count, and names a run that dropped none, or the wrong one', () => {
    expect(reportFaults('island_tree_02.glb', { repeatedTrianglesDropped: 1, x: 2 })).toEqual([]);
    expect(reportFaults('island_tree_02.glb', { repeatedTrianglesDropped: 0 })).toEqual([
      'island_tree_02.glb: its report says repeatedTrianglesDropped 0, not 1',
    ]);
    expect(reportFaults('island_tree_02-middle.glb', {})).toEqual([
      'island_tree_02-middle.glb: its report says repeatedTrianglesDropped nothing, not 1',
    ]);
    expect(reportFaults('island_tree_02.glb', undefined)).toHaveLength(1);
    // A file nothing is required of passes whatever its report says.
    expect(reportFaults('tree_small_02.glb', undefined)).toEqual([]);
  });
});

describe('ambientCG — #1274, the source ADR 0026 D-4 admits and nothing had read', () => {
  const rock = SOURCES.find((source) => source.id === 'Rock026') as AssetSource;

  /**
   * An ambientCG asset's page, as `ambientcg.com/view?id=Rock026` was read on
   * 2026-10-12: its downloads, each a link to the archive; its "Technique"
   * block, a `<span>` an entry; the "Dimensions" block after it, whose value is
   * a span too; and the licence, in the site's own answer further down.
   */
  const page = ({
    techniques = ['Surface Photogrammetry'],
    files = ['Rock026_1K-JPG.zip', 'Rock026_2K-JPG.zip'],
    licence = `Yes. ${AMBIENTCG_PHRASE}, making them free to use without attribution - even in commercial circumstances.`,
    more = '',
  }: {
    techniques?: readonly string[] | 'absent';
    files?: readonly string[];
    licence?: string;
    more?: string;
  } = {}): string => `
<title>Rock 045 | ambientCG</title>
<meta name="description" content="Get this asset for free under the Public Domain license.">
${files
  .map(
    (file) => `<a
      class="asset-download"
      data-file-name="${file}"
      href="https://ambientcg.com/get?file=${file}">download</a>`,
  )
  .join('\n')}
${
  techniques === 'absent'
    ? ''
    : `<div id="techniques">
  <div class="detail-title">Technique</div>
  <div class="detail-value">
${techniques.map((technique) => `    <span title="how it was made">\n\t\t${technique}\t\t</span>`).join('\n')}
  </div>
</div>`
}
<div id="dimensions">
  <div class="detail-title">Dimensions</div>
  <div class="detail-value"><span>ca. 240 cm × 240 cm</span></div>
</div>
<div class="faq-item"><h4>Are the assets really free for any purpose?</h4><p>${licence}</p></div>
${more}`;

  it('keeps an asset whose own page offers its archive, states CC0 and says it was measured', () => {
    expect(licenceVerdict(rock, page())).toEqual({
      kept: true,
      licence: 'CC0-1.0',
      evidence: AMBIENTCG_PHRASE,
      technique: 'Surface Photogrammetry',
    });
    // The other measured technique, and a page that names both.
    expect(licenceVerdict(rock, page({ techniques: ['Photometric Stereo'] }))).toMatchObject({
      kept: true,
      technique: 'Photometric Stereo',
    });
    expect(
      licenceVerdict(rock, page({ techniques: ['Surface Photogrammetry', 'Photometric Stereo'] })),
    ).toMatchObject({ kept: true, technique: 'Surface Photogrammetry, Photometric Stereo' });
  });

  it('reads the technique out of its own block, and nothing after it', () => {
    // The "Dimensions" value is a span too, directly after: read as a
    // technique it would refuse every asset there is.
    expect(ambientCgTechniques(page())).toEqual(['Surface Photogrammetry']);
    expect(ambientCgTechniques(page({ techniques: 'absent' }))).toEqual([]);
    expect(ambientCgTechniques(page({ techniques: [] }))).toEqual([]);
  });

  it('refuses an "approximated" asset, however its licence reads — #1274 item 4', () => {
    const verdict = licenceVerdict(rock, page({ techniques: ['Approximation'] }));
    expect(verdict.kept).toBe(false);
    expect(verdict.kept ? '' : verdict.reason).toMatch(/made by "Approximation"/);
    // And one that is partly approximated is approximated.
    expect(
      licenceVerdict(rock, page({ techniques: ['Surface Photogrammetry', 'Approximation'] })).kept,
    ).toBe(false);
  });

  it('refuses every technique it has not read as measured, a new one included', () => {
    expect(AMBIENTCG_TECHNIQUES_KEPT).toEqual(['Surface Photogrammetry', 'Photometric Stereo']);
    // The site's own spelling of procedural; its "unknown"; and one it has not invented yet.
    for (const technique of ['Prodedural', 'Other/Unknown', 'Neural Synthesis']) {
      const verdict = licenceVerdict(rock, page({ techniques: [technique] }));
      expect(verdict.kept, technique).toBe(false);
      expect(verdict.kept ? '' : verdict.reason, technique).toContain(`"${technique}"`);
    }
  });

  it('refuses a page that does not say how the asset was made: not known is not measured', () => {
    for (const techniques of ['absent', []] as const) {
      const verdict = licenceVerdict(rock, page({ techniques }));
      expect(verdict.kept).toBe(false);
      expect(verdict.kept ? '' : verdict.reason).toMatch(/does not say how the asset was made/);
    }
  });

  it('refuses a page that is not this asset’s own: another’s CC0 cannot vouch for this file', () => {
    // Another asset's page, word for word a kept one.
    const other = licenceVerdict(
      rock,
      page({ files: ['Rock027_1K-JPG.zip', 'Rock027_2K-JPG.zip'] }),
    );
    expect(other.kept).toBe(false);
    expect(other.kept ? '' : other.reason).toMatch(/does not offer Rock026_1K-JPG\.zip/);
    // This asset, at a size it is not published in.
    expect(licenceVerdict(rock, page({ files: ['Rock026_2K-JPG.zip'] })).kept).toBe(false);
    // And a longer name that merely ends with this one's is another file.
    expect(licenceVerdict(rock, page({ files: ['MossyRock026_1K-JPG.zip'] })).kept).toBe(false);
  });

  it('refuses a page that does not state the licence, or states a stricter one beside it', () => {
    // The site's own description says "Public Domain license": a label, not the grant.
    const unstated = licenceVerdict(rock, page({ licence: 'Free textures for everyone.' }));
    expect(unstated.kept).toBe(false);
    expect(unstated.kept ? '' : unstated.reason).toContain(AMBIENTCG_PHRASE);
    expect(licenceVerdict(rock, page({ more: '<p>This asset: CC-BY-NC-4.0</p>' })).kept).toBe(
      false,
    );
  });

  it('names the archive and its files as ambientCG does, and pins the archive whole', () => {
    expect(ambientCgArchive(rock)).toEqual({
      name: 'Rock026_1K-JPG.zip',
      url: 'https://ambientcg.com/get?file=Rock026_1K-JPG.zip',
      members: [{ path: 'Rock026_1K-JPG_Color.jpg' }, { path: 'Rock026_1K-JPG_NormalGL.jpg' }],
    });
    // A PNG archive's files are PNGs.
    expect(
      ambientCgArchive({
        ...rock,
        origin: { from: 'ambientcg', attribute: '2K-PNG', maps: ['Opacity'] },
      }).members,
    ).toEqual([{ path: 'Rock026_2K-PNG_Opacity.png' }]);
    // And it is refused for a source that is not ambientCG's.
    expect(() => ambientCgArchive(polyHaven)).toThrow(/not an ambientCG asset/);
  });

  it('reads an archive for ambientCG and for MakeHuman’s pack, and for nothing else', () => {
    expect(archiveOf(rock)).toEqual(ambientCgArchive(rock));
    const pack = SOURCES.find((source) => source.id === 'makehuman-system-assets') as AssetSource;
    expect(archiveOf(pack)?.name).toBe('makehuman_system_assets_cc0.zip');
    expect(archiveOf(pack)?.members.length).toBeGreaterThan(0);
    expect(archiveOf(polyHaven)).toBeUndefined();
    expect(archiveOf(makeHuman)).toBeUndefined();
  });

  it('takes each ground and structure surface at 1K, colour and OpenGL normal map, and makes two files of it', () => {
    expect(AMBIENTCG_GROUND_TEXTURES.length).toBeGreaterThan(0);
    // #1535: the pavement's by the same archive, maps and recipe.
    expect(AMBIENTCG_STRUCTURE_TEXTURES.map((texture) => texture.id)).toEqual(['PavingStones136']);
    for (const texture of [...AMBIENTCG_GROUND_TEXTURES, ...AMBIENTCG_STRUCTURE_TEXTURES]) {
      const source = SOURCES.find((each) => each.id === texture.id);
      expect(source?.licence, texture.id).toBe('CC0-1.0');
      expect(source?.licencePage, texture.id).toBe(`https://ambientcg.com/view?id=${texture.id}`);
      expect(source?.licencePhrase, texture.id).toBe(AMBIENTCG_PHRASE);
      // ⚠️ `NormalGL`, never `NormalDX`: three reads a normal map's green as
      // up, and the archive holds both.
      expect(source?.origin, texture.id).toEqual({
        from: 'ambientcg',
        attribute: '1K-JPG',
        maps: ['Color', 'NormalGL'],
      });
      const made = OUTPUTS.filter((output) => output.from === texture.id);
      expect(made.map((output) => output.file).sort(), texture.id).toEqual(
        [structureMapFiles(texture.id).colour, structureMapFiles(texture.id).normal].sort(),
      );
      for (const output of made) {
        expect(output.recipe, output.file).toMatchObject({
          how: 'blender',
          script: TEXTURE_SCRIPT,
        });
        const args = output.recipe.how === 'blender' ? output.recipe.args : [];
        const normal = output.file.includes('_nor_gl_');
        expect(args, output.file).toEqual([
          `${texture.id}_1K-JPG_${normal ? 'NormalGL' : 'Color'}.jpg`,
          '512',
          normal ? 'data' : 'colour',
        ]);
      }
    }
  });
});

describe('the digest lock — ADR 0026 D-5, #1274', () => {
  const locked = {
    files: [
      { path: 'Rock026_1K-JPG.zip', url: 'https://ambientcg.com/a', bytes: 3, sha256: 'aa' },
      { path: 'Rock026_1K-JPG_Color.jpg', url: 'https://ambientcg.com/b', bytes: 2, sha256: 'bb' },
    ],
  };

  it('passes a file whose path and SHA-256 are the ones the lock records', () => {
    expect(lockFault('Rock026', 'Rock026_1K-JPG.zip', 'aa', locked)).toBeUndefined();
    expect(lockFault('Rock026', 'Rock026_1K-JPG_Color.jpg', 'bb', locked)).toBeUndefined();
  });

  it('names a file whose bytes moved, with both digests', () => {
    expect(lockFault('Rock026', 'Rock026_1K-JPG.zip', 'cc', locked)).toBe(
      'Rock026/Rock026_1K-JPG.zip: not the input the lock records (aa, got cc); run with --lock only if re-basing on new inputs is intended',
    );
  });

  it('names a file the lock does not record at all, and a source it has never seen', () => {
    expect(lockFault('Rock026', 'Rock026_1K-JPG_Roughness.jpg', 'aa', locked)).toMatch(
      /Rock026_1K-JPG_Roughness\.jpg: not the input the lock records \(absent, got aa\)/,
    );
    expect(lockFault('Rock027', 'Rock027_1K-JPG.zip', 'aa', undefined)).toMatch(
      /\(absent, got aa\)/,
    );
  });

  it('never lets one file’s digest vouch for another: the path is part of the lock', () => {
    // The archive's digest, offered for the member, and the member's for the archive.
    expect(lockFault('Rock026', 'Rock026_1K-JPG_Color.jpg', 'aa', locked)).toMatch(
      /\(bb, got aa\)/,
    );
    expect(lockFault('Rock026', 'Rock026_1K-JPG.zip', 'bb', locked)).toMatch(/\(aa, got bb\)/);
  });
});

describe('the generated trees in the pipeline’s table — #1283, ADR 0049 D-1', () => {
  const locked = (id: string, sha256: string): InputLock['sources'][number] => ({
    id,
    licence: 'CC0-1.0',
    licencePage: `https://ambientcg.com/view?id=${id}`,
    evidence: AMBIENTCG_PHRASE,
    read: '2026-10-12',
    authors: 'ambientCG',
    technique: 'Surface Photogrammetry',
    files: [
      { path: `${id}.zip`, url: `https://ambientcg.com/get?file=${id}.zip`, bytes: 1, sha256 },
    ],
  });
  const lockOf = (digest: (id: string) => string): InputLock => ({
    sources: GENERATED_TREE_TEXTURES.map((texture) => locked(texture.id, digest(texture.id))),
  });
  const [tree] = GENERATED_TREES;
  if (tree === undefined) throw new Error('no generated tree');
  const species = speciesOf(tree);

  it('fetches each species’ bark and leaves once, with the maps the script reads', () => {
    const ids = GENERATED_TREE_TEXTURES.map((texture) => texture.id);
    expect(new Set(ids).size).toBe(ids.length);
    /** Every file a source is fetched for, as a run would name it. */
    const fetched = (id: string): readonly string[] => {
      const source = SOURCES.find((candidate) => candidate.id === id);
      if (source === undefined) throw new Error(`${id} is not a source`);
      if (source.origin.from === 'ambientcg') {
        return ambientCgArchive(source).members.map((member) => `${id}/${member.path}`);
      }
      // #1294: a Poly Haven asset's maps, named as its API names each file.
      if (source.origin.from !== 'polyhaven' || source.origin.select.type !== 'maps') {
        throw new Error(`${id}: neither ambientCG’s nor a Poly Haven asset’s maps`);
      }
      const { maps, resolution } = source.origin.select;
      const answer = Object.fromEntries(
        maps.map((map) => [
          map,
          {
            [resolution]: {
              jpg: {
                url: `https://dl.polyhaven.org/x/${id}_${map}_${resolution}.jpg`,
                md5: 'm',
                size: 1,
              },
            },
          },
        ]),
      );
      return polyHavenFiles(id, source.origin.select, answer).map((file) => `${id}/${file.path}`);
    };
    let fromPolyHaven = 0;
    for (const each of GENERATED_SPECIES) {
      expect(ids, each.id).toContain(each.bark.source);
      expect(ids, each.id).toContain(each.sprig.source);
      const maps = generatedTreeMaps(each);
      const bark = [maps.barkColour, maps.barkNormal];
      const leaf = [maps.leafColour, maps.leafOpacity, maps.leafNormal];
      // Five different files: a species never reads one map as two.
      expect(new Set([...bark, ...leaf]).size, each.id).toBe(5);
      if (each.bark.source === each.sprig.source) {
        // One asset is both: every file fetched of it is one the run reads.
        expect([...bark, ...leaf].sort(), each.id).toEqual([...fetched(each.bark.source)].sort());
        fromPolyHaven += 1;
        continue;
      }
      // Every path a run reads is a member the archive of its source is taken for.
      expect([...bark].sort(), each.id).toEqual([...fetched(each.bark.source)].sort());
      expect([...leaf].sort(), each.id).toEqual([...fetched(each.sprig.source)].sort());
    }
    // The fir's five maps, by the names Poly Haven gives them.
    expect(fromPolyHaven).toBe(1);
    const fir = GENERATED_SPECIES.find((each) => each.id === 'fir');
    if (fir === undefined) throw new Error('there is a fir');
    expect(POLY_HAVEN_TREE_RESOLUTION).toBe('1k');
    expect(generatedTreeMaps(fir)).toEqual({
      barkColour: 'fir_tree_01/fir_tree_01_bark_diff_1k.jpg',
      barkNormal: 'fir_tree_01/fir_tree_01_bark_nor_gl_1k.jpg',
      leafColour: 'fir_tree_01/fir_tree_01_twig_diff_1k.jpg',
      leafOpacity: 'fir_tree_01/fir_tree_01_twig_alpha_1k.jpg',
      leafNormal: 'fir_tree_01/fir_tree_01_twig_nor_gl_1k.jpg',
    });
    // And an oak's are still ambientCG's own names.
    expect(generatedTreeMaps(species).leafOpacity).toBe(
      `${species.sprig.source}/${species.sprig.source}_1K-JPG_Opacity.jpg`,
    );
    // A bark gives two maps and a leaf atlas three: the opacity is the cut-out.
    expect(Object.values(GENERATED_BARK_MAPS)).toEqual(['Color', 'NormalGL']);
    expect(Object.values(GENERATED_LEAF_MAPS)).toEqual(['Color', 'Opacity', 'NormalGL']);
  });

  it('writes a full level’s two strips beside it, and nothing beside a middle level', () => {
    for (const each of GENERATED_TREES) {
      const full = OUTPUTS.find((output) => output.file === `${each.name}.glb`);
      const middle = OUTPUTS.find((output) => output.file === `${each.name}-middle.glb`);
      expect(full?.recipe).toMatchObject({ how: 'generated', tree: each.name, level: 'full' });
      expect(middle?.recipe).toMatchObject({ how: 'generated', tree: each.name, level: 'middle' });
      if (full === undefined || middle === undefined) throw new Error(`${each.name}: no output`);
      expect(alsoWritten(full.recipe).map((also) => also.file)).toEqual([
        `${each.name}-impostor.ktx2`,
        `${each.name}-impostor-normals.ktx2`,
      ]);
      // A strip is a cut-out read as `TextureLoader` read it; its normals are data.
      expect(alsoWritten(full.recipe).map((also) => also.ktx2)).toEqual([
        { encoding: 'colour-alpha', origin: 'bottom-left' },
        { encoding: 'normal', origin: 'bottom-left' },
      ]);
      expect(alsoWritten(middle.recipe)).toEqual([]);
      // A full level's maps are encoded; a middle level has none to encode.
      expect(full.recipe).toMatchObject({ images: 'ktx2' });
      expect(middle.recipe).not.toHaveProperty('images');
      for (const file of [full.file, middle.file, ...alsoWritten(full.recipe).map((a) => a.file)]) {
        expect(shippedFiles(), file).toContain(file);
      }
    }
    // And a recipe that writes nothing else says so.
    expect(alsoWritten({ how: 'verbatim', file: 'x' })).toEqual([]);
  });

  it('digests a tree’s input over its geometry at both levels and both assets it wears', () => {
    const lock = lockOf((id) => (id === species.bark.source ? 'a' : 'b').repeat(64));
    const digest = generatedInputDigest(tree, lock);
    expect(digest).toBe(
      inputDigest([
        { path: `generated-trees.ts#${tree.name}.full`, sha256: tree.geometry.full },
        { path: `generated-trees.ts#${tree.name}.middle`, sha256: tree.geometry.middle },
        // #1289's review: and what only Blender reads of each level's run.
        {
          path: `generated-trees.ts#${tree.name}.full.run`,
          sha256: runNumbersDigest(tree, 'full'),
        },
        {
          path: `generated-trees.ts#${tree.name}.middle.run`,
          sha256: runNumbersDigest(tree, 'middle'),
        },
        { path: `${species.bark.source}/${species.bark.source}.zip`, sha256: 'a'.repeat(64) },
        { path: `${species.sprig.source}/${species.sprig.source}.zip`, sha256: 'b'.repeat(64) },
      ]),
    );
    // It moves with the seed's geometry at either level…
    for (const level of ['full', 'middle'] as const) {
      expect(
        generatedInputDigest(
          { ...tree, geometry: { ...tree.geometry, [level]: 'c'.repeat(64) } },
          lock,
        ),
        level,
      ).not.toBe(digest);
    }
    // …and with either download.
    expect(
      generatedInputDigest(
        tree,
        lockOf((id) => (id === species.bark.source ? 'd' : 'b').repeat(64)),
      ),
    ).not.toBe(digest);
    expect(
      generatedInputDigest(
        tree,
        lockOf((id) => (id === species.bark.source ? 'a' : 'd').repeat(64)),
      ),
    ).not.toBe(digest);
    // A lock that does not hold what the tree wears is refused, not digested short.
    expect(() => generatedInputDigest(tree, { sources: [] })).toThrow(/is not in the lock/);
  });

  it('moves a tree’s input with every number only Blender reads — #1289’s review', () => {
    // The reviewer turned one shoot of the oak's sprig from 48° to 30° and
    // every test stayed green, although the shipped leaf card is drawn from
    // it: the generator reads none of these, so no geometry digest moves.
    const lock = lockOf((id) => (id === species.bark.source ? 'a' : 'b').repeat(64));
    const digest = generatedInputDigest(tree, lock);
    const { sprig } = species;
    if ('rects' in sprig) throw new Error('the first tree’s atlas is a grid');
    const firstLeaf = sprig.leaves[0];
    if (firstLeaf === undefined) throw new Error('a sprig has leaves');
    const turned = [{ ...firstLeaf, turn: firstLeaf.turn + 1 }, ...sprig.leaves.slice(1)];
    const edits: Readonly<Record<string, GeneratedSpecies>> = {
      'a leaf’s turn, which a shoot’s heading sets': {
        ...species,
        sprig: { ...sprig, leaves: turned },
      },
      'a leaf fewer': { ...species, sprig: { ...sprig, leaves: sprig.leaves.slice(1) } },
      'the atlas’s grid': { ...species, sprig: { ...sprig, grid: [sprig.grid[1], sprig.grid[0]] } },
      'the atlas’s turn': { ...species, sprig: { ...sprig, atlasTurn: sprig.atlasTurn + 90 } },
      'the tone': { ...species, sprig: { ...sprig, tone: [sprig.tone[0], sprig.tone[1], 0.51] } },
      'the card’s pixels': { ...species, sprig: { ...sprig, pixels: sprig.pixels * 2 } },
      'the card’s normal pixels': {
        ...species,
        sprig: { ...sprig, normalPixels: sprig.normalPixels * 2 },
      },
      'the bark’s pixels': {
        ...species,
        bark: { ...species.bark, pixels: species.bark.pixels * 2 },
      },
      'the impostor’s frame': {
        ...species,
        impostor: { ...species.impostor, frame: [species.impostor.frame[0] + 16, 256] },
      },
      'the impostor’s normal frame': {
        ...species,
        impostor: { ...species.impostor, normalFrame: [species.impostor.normalFrame[0] + 16, 96] },
      },
    };
    const seen = new Set([digest]);
    for (const [what, edited] of Object.entries(edits)) {
      const moved = generatedInputDigest(tree, lock, edited);
      expect(moved, what).not.toBe(digest);
      seen.add(moved);
    }
    // Each its own digest: none of the ten is read as another.
    expect(seen.size).toBe(Object.keys(edits).length + 1);
    // And the species handed in unchanged is the tree's own.
    expect(generatedInputDigest(tree, lock, species)).toBe(digest);
    // A full level and a middle level are told different things, and both are recorded.
    expect(runNumbersDigest(tree, 'full')).not.toBe(runNumbersDigest(tree, 'middle'));
  });

  it('digests a fir’s one asset once, and moves with every number of a rectangle — #1294', () => {
    const fir = GENERATED_TREES.find((each) => each.species === 'fir');
    if (fir === undefined) throw new Error('there is a generated fir');
    const firSpecies = speciesOf(fir);
    // Its bark and its sprigs are one Poly Haven asset.
    expect(firSpecies.bark.source).toBe(firSpecies.sprig.source);
    const lock = lockOf(() => 'a'.repeat(64));
    const digest = generatedInputDigest(fir, lock);
    expect(digest).toBe(
      inputDigest([
        ...(['full', 'middle'] as const).flatMap((level) => [
          { path: `generated-trees.ts#${fir.name}.${level}`, sha256: fir.geometry[level] },
          {
            path: `generated-trees.ts#${fir.name}.${level}.run`,
            sha256: runNumbersDigest(fir, level),
          },
        ]),
        // Once: named twice it would be two lines of one file.
        {
          path: `${firSpecies.bark.source}/${firSpecies.bark.source}.zip`,
          sha256: 'a'.repeat(64),
        },
      ]),
    );
    const { sprig } = firSpecies;
    if (!('rects' in sprig)) throw new Error('the fir’s atlas is rectangles');
    const [first, ...rest] = sprig.rects;
    if (first === undefined) throw new Error('the fir’s atlas has rectangles');
    const seen = new Set([digest]);
    for (const key of ['x', 'y', 'width', 'height', 'turn'] as const) {
      const moved = generatedInputDigest(fir, lock, {
        ...firSpecies,
        sprig: { ...sprig, rects: [{ ...first, [key]: first[key] + 1 }, ...rest] },
      });
      expect(moved, key).not.toBe(digest);
      seen.add(moved);
    }
    expect(seen.size).toBe(6);
    // A rectangle fewer, and the same rectangles in another order.
    expect(
      generatedInputDigest(fir, lock, { ...firSpecies, sprig: { ...sprig, rects: rest } }),
    ).not.toBe(digest);
    expect(
      generatedInputDigest(fir, lock, {
        ...firSpecies,
        sprig: { ...sprig, rects: [...rest, first] },
      }),
    ).not.toBe(digest);
  });
});
