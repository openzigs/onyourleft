// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The list of asset sources is the boundary — #1275, ADR 0049 D-10 and D-11.
 *
 * `sources.ts` carries the list as two tables, and the ADR carries the same two
 * as Markdown. This file reads the ADR and holds them to each other, then holds
 * the pipeline to the list: every URL it reads today is an admitted source's,
 * and `licenceVerdict` — what `realistic:fetch` asks before it writes a byte —
 * refuses one that is not.
 *
 * ⚠️ What it cannot cover: a barred TERM that no host identifies (an
 * AI-generated asset, a Standard licence). ADR 0049 D-2 leaves those to a
 * person reading the asset's own page.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADMITTED_SOURCES,
  admission,
  ambientCgArchive,
  BARRED_SOURCES,
  GENERATED_TREE_TEXTURES,
  GENERATED_TREE_WEARS,
  licenceVerdict,
  SOURCES,
  type AssetSource,
} from './sources';

const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ADR = readFileSync(
  join(REPOSITORY, 'docs', 'adr', '0049-open-asset-sources-for-the-realistic-world.md'),
  'utf8',
);

/** A cell as the code writes it: no emphasis, no code marks, one kind of apostrophe. */
function plain(cell: string): string {
  return cell
    .replace(/\*\*|`/g, '')
    .replace(/’/g, "'")
    .trim();
}

/** The body rows of the first Markdown table after `marker`, inside D-10. */
function rowsAfter(marker: string): readonly (readonly string[])[] {
  const section = ADR.slice(ADR.indexOf('### D-10 — The list, whole'), ADR.indexOf('### D-11 — '));
  const lines = section.slice(section.indexOf(marker)).split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  const rows: string[][] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map(plain));
  }
  // The header and its rule are not rows.
  return rows.slice(2);
}

/** Every URL a source has the pipeline read, as `licenceVerdict` sees them. */
function urlsOf(source: AssetSource): readonly string[] {
  if (source.origin.from === 'urls') {
    return [source.licencePage, ...source.origin.files.map((file) => file.url)];
  }
  if (source.origin.from === 'archive') return [source.licencePage, source.origin.url];
  // #1274: an ambientCG asset's own page, and the one archive it is read out of.
  if (source.origin.from === 'ambientcg') {
    return [source.licencePage, ambientCgArchive(source).url];
  }
  return [source.licencePage];
}

const makeHuman = SOURCES.find((source) => source.id === 'makehuman') as AssetSource;

/** A source that would be kept on its page's words alone, read from `licencePage`. */
function sourceAt(licencePage: string): AssetSource {
  return {
    id: 'probe',
    licencePage,
    licencePhrase: 'CC0',
    licence: 'CC0-1.0',
    origin: { from: 'urls', files: [] },
  };
}

describe('the lists are ADR 0049 D-10’s tables, row for row — #1275', () => {
  it('admits exactly the sources the ADR’s In table names, each with its licence and its decision', () => {
    const inTheAdr = rowsAfter('**In**').map(([name, licence, decidedBy]) => ({
      name,
      licence,
      decidedBy,
    }));
    expect(inTheAdr.length).toBeGreaterThan(0);
    expect(
      ADMITTED_SOURCES.map((source) => ({
        name: plain(source.name),
        licence: source.licence,
        decidedBy: source.decidedBy,
      })),
    ).toEqual(inTheAdr);
  });

  it('bars exactly what the ADR’s Out table names, each with its decision', () => {
    const outInTheAdr = rowsAfter('**Out**').map(([name, decidedBy]) => ({ name, decidedBy }));
    expect(outInTheAdr.length).toBeGreaterThan(0);
    expect(
      BARRED_SOURCES.map((source) => ({
        name: plain(source.name),
        decidedBy: source.decidedBy,
      })),
    ).toEqual(outInTheAdr);
  });

  it('names nothing on both lists', () => {
    const barred = new Set(BARRED_SOURCES.map((source) => source.name));
    expect(ADMITTED_SOURCES.filter((source) => barred.has(source.name))).toEqual([]);
  });

  it('keeps MIT for a generator alone: a downloaded file is CC0-1.0 or CC-BY-4.0', () => {
    for (const source of ADMITTED_SOURCES) {
      expect(source.licence === 'MIT', source.name).toBe(source.kind === 'generator');
    }
    expect(ADMITTED_SOURCES.filter((source) => source.kind === 'generator')).toHaveLength(1);
  });
});

describe('what the lists decide about a URL — ADR 0049 D-11', () => {
  it('admits every file URL the lock records: Poly Haven resolves them at run time', () => {
    const lock = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'inputs.lock.json'), 'utf8'),
    ) as { sources: { id: string; files: { url: string }[] }[] };
    const urls = lock.sources.flatMap((source) => source.files.map((file) => file.url));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.startsWith('https://dl.polyhaven.org/'))).toBe(true);
    for (const url of urls) {
      expect(admission(url.split('#')[0] ?? url), url).toMatchObject({ admitted: true });
    }
  });

  it('pins every admitted prefix, so a host added to a row is a visible edit', () => {
    expect(
      Object.fromEntries(ADMITTED_SOURCES.map((source) => [source.name, [...source.prefixes]])),
    ).toEqual({
      'Poly Haven': [
        'https://polyhaven.com/',
        'https://api.polyhaven.com/',
        'https://dl.polyhaven.org/',
      ],
      ambientCG: [
        'https://ambientcg.com/',
        'https://docs.ambientcg.com/',
        'https://acg-download.struffelproductions.com/file/ambientCG-Web/download/',
      ],
      'MakeHuman’s own files': [
        'https://raw.githubusercontent.com/makehumancommunity/makehuman/',
        'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
        'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/',
      ],
      Kenney: [],
      'An individual model under CC-BY-4.0': [],
      'EZ-Tree’s output': ['https://github.com/dgreenheck/ez-tree/'],
      'The Base Mesh': ['https://www.thebasemesh.com/'],
      'Blender Studio Human Base Meshes': [
        'https://www.blender.org/download/demo-files/',
        'https://www.blender.org/download/demo/asset-bundles/human-base-meshes/',
      ],
      'MakeHuman community cyclist poses': [
        'https://static.makehumancommunity.org/assets/assetpacks/poses02.html',
        'https://files.makehumancommunity.org/asset_packs/poses02/',
      ],
    });
  });

  it('refuses an address that is not the one fetch would request, and a page matched by prefix', () => {
    for (const url of [
      'https://www.blender.org/download/demo/asset-bundles/human-base-meshes/../ellie-pose-library/ellie.zip',
      'https://raw.githubusercontent.com/makehumancommunity/makehuman/../../someone/else/main/base.obj',
      'https://files.makehumancommunity.org/asset_packs/poses02/%2e%2e/hats02/hats02_ccby.zip',
      'https://static.makehumancommunity.org/assets/assetpacks/poses02.html/../skins01.html',
      'https://static.makehumancommunity.org/assets/assetpacks/poses02.htmlx',
    ]) {
      expect(admission(url), url).toMatchObject({ admitted: false });
    }
  });

  it('takes no file from a generator: only its licence page is read (ADR 0049 D-1)', () => {
    const bark =
      'https://github.com/dgreenheck/ez-tree/blob/v1.1.0/src/textures/bark/oak_color_1k.jpg';
    expect(admission(bark)).toMatchObject({ admitted: false });
    expect(admission(bark, 'licence')).toMatchObject({ admitted: true });
  });

  it('admits every URL the pipeline reads today, each to the source that owns it', () => {
    const owners = new Map<string, Set<string>>();
    for (const source of SOURCES) {
      for (const url of urlsOf(source)) {
        const verdict = admission(url);
        expect(verdict, url).toMatchObject({ admitted: true });
        if (!verdict.admitted) continue;
        owners.set(source.id, (owners.get(source.id) ?? new Set()).add(verdict.source.name));
      }
    }
    // Three sources are used today — ambientCG since #1274, which ADR 0026 D-4
    // had already admitted — and nothing ADR 0049 admits is adopted by #1275.
    expect([...new Set([...owners.values()].flatMap((names) => [...names]))].sort()).toEqual([
      'MakeHuman’s own files',
      'Poly Haven',
      'ambientCG',
    ]);
    expect(owners.get('Rock026')).toEqual(new Set(['ambientCG']));
    expect(owners.get('makehuman')).toEqual(new Set(['MakeHuman’s own files']));
    expect(owners.get('makehuman-system-assets')).toEqual(new Set(['MakeHuman’s own files']));
  });

  it.each([
    ['https://www.thebasemesh.com/asset/jersey-barrier', 'The Base Mesh'],
    [
      'https://www.blender.org/download/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip',
      'Blender Studio Human Base Meshes',
    ],
    [
      'https://static.makehumancommunity.org/assets/assetpacks/poses02.html',
      'MakeHuman community cyclist poses',
    ],
    [
      'https://files.makehumancommunity.org/asset_packs/poses02/poses02_cc0.zip',
      'MakeHuman community cyclist poses',
    ],
    ['https://github.com/dgreenheck/ez-tree/blob/v1.1.0/LICENSE', 'EZ-Tree’s output'],
    ['https://ambientcg.com/view?id=Bark012', 'ambientCG'],
  ])('admits %s as %s', (url, name) => {
    const verdict = admission(url, 'licence');
    expect(verdict).toMatchObject({ admitted: true, source: { name } });
  });

  it.each([
    // ADR 0049 D-7: not now.
    'https://www.cgbookcase.com/textures/bark-01',
    'https://www.texturecan.com/details/1/',
    'https://3dtextures.me/2020/01/01/bark/',
    // ADR 0049 D-6: MakeHuman's site is admitted for its own pack and one pose
    // pack, not for a community author's skins or clothes.
    'https://static.makehumancommunity.org/assets/assetpacks/skins01.html',
    'https://files.makehumancommunity.org/asset_packs/hats02/hats02_ccby.zip',
    // ADR 0049 D-4: the one bundle, not blender.org at large.
    'https://www.blender.org/download/demo/asset-bundles/ellie-pose-library/ellie.zip',
    // Another repository on an admitted host is another source.
    'https://raw.githubusercontent.com/someone/else/main/base.obj',
    'https://github.com/dgreenheck/ez-tree-fork/blob/main/LICENSE',
  ])('refuses %s, which no admitted source owns', (url) => {
    const verdict = admission(url);
    expect(verdict.admitted).toBe(false);
    if (verdict.admitted) return;
    expect(verdict.reason).toContain(url);
    expect(verdict.reason).toContain('ADR 0049 D-10');
  });

  it('never lets a look-alike host borrow an admitted name', () => {
    for (const url of [
      'https://polyhaven.com.example.org/a/farm_field',
      'https://www.thebasemesh.com.example.org/asset',
      'http://polyhaven.com/a/farm_field',
    ]) {
      expect(admission(url), url).toMatchObject({ admitted: false });
    }
    // Which holds for any row added later: a prefix ends where a path does.
    for (const source of ADMITTED_SOURCES) {
      for (const prefix of source.prefixes) {
        expect(prefix, source.name).toMatch(/^https:\/\/[^/]+\/(?:.*(?:\/|\.html))?$/);
      }
    }
  });

  it('refuses the cyclist motion capture set by host, with its own reason — ADR 0049 D-5', () => {
    for (const url of [
      'https://zenodo.org/records/10668611',
      'https://zenodo.org/api/records/10668611/files/Dataset_cycing_mocap.zip/content',
      'https://sandbox.zenodo.org/records/10668611',
    ]) {
      const verdict = admission(url);
      expect(verdict.admitted, url).toBe(false);
      if (verdict.admitted) continue;
      expect(verdict.reason).toContain('none of its data is fetched or committed');
      expect(verdict.reason).toContain('ADR 0049 D-5');
    }
  });

  it('refuses Mixamo and its subdomains as barred, not merely as unlisted', () => {
    for (const url of ['https://mixamo.com/', 'https://www.mixamo.com/terms']) {
      const verdict = admission(url);
      expect(verdict.admitted, url).toBe(false);
      if (verdict.admitted) continue;
      expect(verdict.reason).toContain('is barred — Mixamo');
    }
    // A host that merely ends in the same letters is not Mixamo's: it is unlisted.
    const other = admission('https://notmixamo.com/');
    expect(other.admitted).toBe(false);
    if (!other.admitted) expect(other.reason).not.toContain('is barred');
  });

  it('lists no admitted address on a barred host', () => {
    for (const barred of BARRED_SOURCES) {
      for (const host of barred.hosts) {
        for (const admitted of ADMITTED_SOURCES) {
          for (const prefix of admitted.prefixes) {
            const prefixHost = new URL(prefix).hostname;
            expect(prefixHost === host || prefixHost.endsWith(`.${host}`), prefix).toBe(false);
          }
        }
      }
    }
  });
});

describe('the pipeline refuses what the list does not name — ADR 0049 D-11', () => {
  it('keeps a source at an admitted address whose page states its licence', () => {
    expect(licenceVerdict(sourceAt('https://www.thebasemesh.com/asset/bollard'), 'CC0')).toEqual({
      kept: true,
      licence: 'CC0-1.0',
      evidence: 'CC0',
    });
  });

  it('refuses a source from anywhere else, whatever its page says', () => {
    const verdict = licenceVerdict(sourceAt('https://www.cgbookcase.com/textures/bark-01'), 'CC0');
    expect(verdict.kept).toBe(false);
    if (verdict.kept) return;
    expect(verdict.reason).toContain('probe: ');
    expect(verdict.reason).toContain('ADR 0049 D-10');
  });

  it('refuses a source whose page is admitted and whose FILE is not', () => {
    const elsewhere: AssetSource = {
      ...makeHuman,
      origin: {
        from: 'urls',
        files: [{ path: 'base.obj', url: 'https://example.org/base.obj' }],
      },
    };
    expect(licenceVerdict(makeHuman, makeHuman.licencePhrase)).toMatchObject({ kept: true });
    const verdict = licenceVerdict(elsewhere, makeHuman.licencePhrase);
    expect(verdict.kept).toBe(false);
    if (!verdict.kept) expect(verdict.reason).toContain('https://example.org/base.obj');
  });

  it('refuses an archive from a barred host with that host’s reason', () => {
    const fromZenodo: AssetSource = {
      ...sourceAt('https://www.thebasemesh.com/asset/bollard'),
      origin: {
        from: 'archive',
        url: 'https://zenodo.org/records/10668611/files/Dataset_cycing_mocap.zip',
        members: [],
      },
    };
    const verdict = licenceVerdict(fromZenodo, 'CC0');
    expect(verdict.kept).toBe(false);
    if (!verdict.kept) expect(verdict.reason).toContain('ADR 0049 D-5');
  });
});

describe('ADR 0026 points at the list that replaced its own — ADR 0013', () => {
  it('carries a dated amendment naming ADR 0049, below an unedited D-4', () => {
    const old = readFileSync(
      join(REPOSITORY, 'docs', 'adr', '0026-realistic-game-world.md'),
      'utf8',
    );
    const amendments = old.slice(old.indexOf('\n## Amendments\n'));
    const entry = amendments.split('\n- **').find((text) => text.startsWith('2026-10-11**'));
    expect(entry).toContain('0049-open-asset-sources-for-the-realistic-world.md');
    expect(entry).toContain('D-4');
    // D-4's own table is still there, word for word: the body is never edited.
    expect(old).toContain('**Out**, whatever the convenience: **Mixamo** (Adobe forbids');
    expect(old).toContain(
      '| **MakeHuman**, exports only | `CC0-1.0` for exports (#430, read 2026-09-20) |',
    );
  });
});

describe('what a generated tree may wear — ADR 0049 D-1 and its amendment of 2026-10-12, #1294', () => {
  const amendments = ADR.slice(ADR.indexOf('\n## Amendments\n'));
  const entry = amendments.split('\n- **').find((text) => text.startsWith('2026-10-12**')) ?? '';

  it('records the owner’s ruling as a dated amendment, below an unedited D-1', () => {
    expect(ADR).toContain('\n## Amendments\n');
    expect(entry).toContain('needles and bark come from Poly Haven');
    expect(entry).toContain('D-1');
    expect(entry).toContain('#1294');
    // D-1's own sentences are still there, word for word: the body is never edited.
    const body = ADR.slice(0, ADR.indexOf('\n## Amendments\n'));
    expect(body).toContain(
      '- **Bark and leaves come from ambientCG**, as the recommendation says.',
    );
    expect(body).toContain('repository are **not** taken.');
    // And the ruling added no source: D-10's In table names what it named.
    expect(rowsAfter('**In**').map(([name]) => name)).toEqual(
      ADMITTED_SOURCES.map((source) => plain(source.name)),
    );
  });

  it('lets a generated tree wear ambientCG’s and Poly Haven’s, the two the ADR now names', () => {
    expect(GENERATED_TREE_WEARS).toEqual(['ambientCG', 'Poly Haven']);
    for (const name of GENERATED_TREE_WEARS) {
      // Each is a row of D-10's In table, of downloaded files, and CC0.
      const row = ADMITTED_SOURCES.find((source) => source.name === name);
      expect(row, name).toMatchObject({ kind: 'files', licence: 'CC0-1.0' });
      // And each is named by the decision that lets a tree wear it.
      expect(name === 'ambientCG' ? ADR : entry, name).toContain(name);
    }
  });

  it('reads every asset a generated tree wears from one of those two, by its own page and files', () => {
    const lock = JSON.parse(
      readFileSync(join(REPOSITORY, 'apps/web/tools/realistic/inputs.lock.json'), 'utf8'),
    ) as { sources: { id: string; licencePage: string; files: { url: string }[] }[] };
    const from = new Set<string>();
    expect(GENERATED_TREE_TEXTURES.length).toBeGreaterThan(0);
    for (const texture of GENERATED_TREE_TEXTURES) {
      const source = SOURCES.find((each) => each.id === texture.id);
      const locked = lock.sources.find((each) => each.id === texture.id);
      if (source === undefined || locked === undefined) {
        throw new Error(`${texture.id} is not a source the lock records`);
      }
      const page = admission(source.licencePage, 'licence');
      if (!page.admitted) throw new Error(page.reason);
      expect(GENERATED_TREE_WEARS, texture.id).toContain(page.source.name);
      expect(page.source.name, texture.id).toBe(
        texture.from === 'polyhaven' ? 'Poly Haven' : 'ambientCG',
      );
      from.add(page.source.name);
      // Every file the lock pins for it is that same source's, by address.
      expect(locked.files.length, texture.id).toBeGreaterThan(0);
      for (const file of locked.files) {
        const verdict = admission(file.url.split('#')[0] ?? '', 'file');
        if (!verdict.admitted) throw new Error(verdict.reason);
        expect(verdict.source.name, file.url).toBe(page.source.name);
      }
      // …and it goes through the one door: the same licence check as any source.
      expect(licenceVerdict(source, 'no licence is stated here'), texture.id).toMatchObject({
        kept: false,
      });
    }
    // Non-vacuity: both are worn today — the broadleaves' and the fir's.
    expect([...from].sort()).toEqual([...GENERATED_TREE_WEARS].sort());
  });

  it('takes nothing a tree wears from the generator’s own repository', () => {
    for (const texture of GENERATED_TREE_TEXTURES) {
      const source = SOURCES.find((each) => each.id === texture.id);
      expect(source?.licencePage, texture.id).not.toContain('dgreenheck');
    }
    expect(
      admission('https://github.com/dgreenheck/ez-tree/raw/main/src/lib/assets/bark.png'),
    ).toMatchObject({
      admitted: false,
    });
  });
});
