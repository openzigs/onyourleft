// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DRAWN_FROM,
  inputDigest,
  licenceVerdict,
  encodingWords,
  ktxCreateArguments,
  OUTPUTS,
  PINNED_KTX,
  PINNED_KTX_VERSION_LINE,
  polyHavenAuthors,
  polyHavenFiles,
  RIDER_BUILD_TARGETS,
  safeRelativePath,
  shippedFiles,
  SOURCES,
  sourcesDigest,
  systemAssetVerdict,
  STRUCTURE_TEXTURES,
  structureMapFiles,
  TEXTURE_SCRIPT,
  type AssetSource,
  type Ktx2Step,
} from './sources';
import { sameFiles } from './fetch-assets';
import { REALISTIC_RIDER } from '../../src/game/realistic-assets';

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

  it('reads from the hosts ADR 0026 names, and no other', () => {
    // A new host is a change to that ADR, not to this table — so a row from
    // anywhere else is a red test rather than a review note. ⚠️ Since #623
    // MakeHuman's own site is one of them: ADR 0026's 2026-09-28 amendment
    // records the owner's ruling that MakeHuman's CC0 system assets pack, from
    // the same author under the same grant, falls under D-4's MakeHuman row.
    for (const source of SOURCES) {
      expect(new URL(source.licencePage).hostname, source.id).toMatch(
        /^(?:polyhaven\.com|raw\.githubusercontent\.com|static\.makehumancommunity\.org)$/,
      );
    }
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
      expect(ids, output.file).toContain(output.from);
    }
    // Non-vacuity: the four bicycle maps, and only they, are drawn.
    expect(OUTPUTS.filter((output) => output.recipe.how === 'drawn')).toHaveLength(4);
  });

  it('downloads nothing it does not use', () => {
    const used = new Set(
      OUTPUTS.flatMap((output) => [
        output.from,
        ...(output.recipe.how === 'blender' ? (output.recipe.alsoReads ?? []) : []),
      ]),
    );
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
        if (recipe.ktx2 !== undefined) expect(recipe.ktx2.origin, output.file).toBe('bottom-left');
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
      const step = recipe.how === 'verbatim' ? undefined : recipe.ktx2;
      if (step === undefined) continue;
      // #624: a roughness map is data — linear, never sRGB colour.
      expect(step.encoding, output.file).toBe(
        output.file.includes('_nor_gl_')
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
