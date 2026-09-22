// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  inputDigest,
  licenceVerdict,
  OUTPUTS,
  polyHavenAuthors,
  polyHavenFiles,
  safeRelativePath,
  shippedFiles,
  SOURCES,
  STRUCTURE_TEXTURES,
  structureMapFiles,
  TEXTURE_SCRIPT,
  type AssetSource,
} from './sources';
import { sameFiles } from './fetch-assets';

const polyHaven = SOURCES.find((source) => source.id === 'farm_field') as AssetSource;
const makeHuman = SOURCES.find((source) => source.id === 'makehuman') as AssetSource;

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

  it('reads from the two hosts ADR 0026 D-4 names, and no third', () => {
    // A new host is a change to that ADR, not to this table — so a row from
    // anywhere else is a red test rather than a review note.
    for (const source of SOURCES) {
      expect(new URL(source.licencePage).hostname, source.id).toMatch(
        /^(?:polyhaven\.com|raw\.githubusercontent\.com)$/,
      );
    }
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
  it('makes every shipped file from a source it names', () => {
    const ids = new Set(SOURCES.map((source) => source.id));
    for (const output of OUTPUTS) expect(ids, output.file).toContain(output.from);
  });

  it('downloads nothing it does not use', () => {
    const used = new Set(OUTPUTS.map((output) => output.from));
    for (const source of SOURCES) expect(used, source.id).toContain(source.id);
  });

  it('says in words what a derived file had done to it', () => {
    for (const output of OUTPUTS) {
      if (output.recipe.how === 'blender') expect(output.modified, output.file).toBeTruthy();
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
