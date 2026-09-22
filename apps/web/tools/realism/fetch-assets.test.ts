// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  licenceVerdict,
  polyHavenFiles,
  safeRelativePath,
  SOURCES,
  type AssetSource,
} from './fetch-assets';

const polyHaven = SOURCES.find((source) => source.id === 'farm_field') as AssetSource;
const makeHuman = SOURCES.find((source) => source.id === 'makehuman') as AssetSource;

describe('what the realism spike keeps — #457', () => {
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

  it('refuses a page that also names a non-commercial or no-derivatives licence', () => {
    for (const other of ['CC BY-NC 4.0', 'CC-BY-NC-SA-4.0', 'CC BY-ND 4.0']) {
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

  it('keeps only CC0 and CC-BY-4.0, the two ADR 0023 admits under apps/', () => {
    for (const source of SOURCES) expect(['CC0-1.0', 'CC-BY-4.0']).toContain(source.licence);
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

describe('Poly Haven’s file list', () => {
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

  it('takes every map at every resolution asked for', () => {
    const answer = {
      Diffuse: { '1k': { jpg: file('d1.jpg') }, '2k': { jpg: file('d2.jpg') } },
      nor_gl: { '1k': { jpg: file('n1.jpg') }, '2k': { jpg: file('n2.jpg') } },
    };
    const files = polyHavenFiles(
      't',
      { type: 'texture', resolutions: ['1k', '2k'], maps: ['Diffuse', 'nor_gl'] },
      answer,
    );
    expect(files.map((each) => each.path)).toEqual(['d1.jpg', 'n1.jpg', 'd2.jpg', 'n2.jpg']);
  });

  it('refuses rather than quietly downloading less than was asked for', () => {
    const answer = { Diffuse: { '1k': { jpg: file('d1.jpg') } } };
    expect(() =>
      polyHavenFiles(
        't',
        { type: 'texture', resolutions: ['1k'], maps: ['Diffuse', 'nor_gl'] },
        answer,
      ),
    ).toThrow(/offers no nor_gl\/1k\/jpg/);
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
