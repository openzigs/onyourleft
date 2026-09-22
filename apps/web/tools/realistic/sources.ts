// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where every realistic asset comes from, and what it becomes — #430.
 *
 * ## The rule this file exists for
 *
 * [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md) D-5: **a derived
 * asset is reproducible from a recorded input by a committed script.** ADR 0022
 * D-1 required that `ASSETS.toml`'s `source` and `sha256` describe the same
 * file, and a decimated tree breaks that by construction. So the property is
 * restated for a derived file rather than abandoned:
 *
 * - {@link SOURCES} names every upstream input — the page that states its
 *   licence, the phrase that page has to carry, and the files taken from it;
 * - `inputs.lock.json` beside this file records what was actually downloaded —
 *   each file's URL, size and SHA-256, and the date its licence was read;
 * - {@link OUTPUTS} names every file the product ships, the input it came
 *   from, and the committed script that made it;
 * - `ASSETS.toml` carries the output's own digest and, for a derived one, the
 *   input's page, {@link inputDigest} of its locked files, the script and the
 *   pinned tool. `provenance.test.ts` holds all four to each other.
 *
 * ## The licence is read off the asset's OWN page, at download time
 *
 * A marketplace label is not a grant (#369's rejection table). Every source
 * names the page that states the licence for that one asset and the phrase that
 * must be on it; `fetch-assets.ts` reads the page and refuses the asset before
 * a byte of it is written unless {@link licenceVerdict} keeps it.
 *
 * ⚠️ **No Mixamo, refused by host rather than by omission** — Adobe's terms bar
 * redistributing the raw character, and a public repository and an APK both
 * do. ADR 0026 D-4's other exclusions (Megascans/Fab, `-NC`, `-SA`, Sketchfab's
 * "Free Standard", anything AI-generated) are not reachable from the two hosts
 * named here, and a new host is a change to that ADR, not to this table.
 *
 * Pure: no file, no network. The two scripts beside it do the I/O.
 */

import { createHash } from 'node:crypto';

/** Hosts whose terms forbid shipping the file in a bundle or a repository. */
export const BARRED_HOSTS: readonly string[] = ['mixamo.com', 'www.mixamo.com'];

/** The licences a realistic asset may carry: the two ADR 0026 D-4 admits under `apps/`. */
export type KeptLicence = 'CC0-1.0' | 'CC-BY-4.0';

/** Which of a Poly Haven asset's files to take. */
export type PolyHavenSelection =
  | { readonly type: 'hdri'; readonly resolution: string }
  | {
      readonly type: 'texture';
      readonly resolution: string;
      readonly maps: readonly string[];
    }
  | { readonly type: 'model'; readonly resolution: string };

/** A file named by URL rather than by an API. */
export interface FixedFile {
  readonly path: string;
  readonly url: string;
  /** A phrase the file itself must contain — MakeHuman's mesh states its own licence. */
  readonly mustContain?: string | undefined;
}

/** One upstream asset, before its files are resolved. */
export interface AssetSource {
  /** A stable name: the directory under `build/raw/` and the key in the lock. */
  readonly id: string;
  /** The page that states this asset's licence, and the `input` `ASSETS.toml` records. */
  readonly licencePage: string;
  /** What that page has to say, verbatim. */
  readonly licencePhrase: string;
  readonly licence: KeptLicence;
  /**
   * Who made it, where the source does not say so through an API. A Poly Haven
   * asset's authors are read from `api.polyhaven.com/info/{id}` at download
   * time and recorded in the lock instead — typed here, two of them were wrong.
   */
  readonly author?: string;
  readonly origin:
    | { readonly from: 'polyhaven'; readonly select: PolyHavenSelection }
    | { readonly from: 'urls'; readonly files: readonly FixedFile[] };
}

/**
 * MakeHuman's repository, pinned to one commit so the mesh, skeleton and
 * weights are the ones every later run reads. #457 read it on 2026-09-22.
 */
export const MAKEHUMAN_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const MAKEHUMAN_RAW = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MAKEHUMAN_COMMIT}`;

/** What Poly Haven's page for an asset says in its structured data, verbatim. */
const POLY_HAVEN_PHRASE = 'CC0 1.0 Universal - public domain dedication, no attribution required';

function polyHaven(id: string, select: PolyHavenSelection): AssetSource {
  return {
    id,
    licencePage: `https://polyhaven.com/a/${id}`,
    licencePhrase: POLY_HAVEN_PHRASE,
    licence: 'CC0-1.0',
    origin: { from: 'polyhaven', select },
  };
}

/**
 * Every upstream input. Why each one, briefly — `docs/spikes/0005` has the
 * rest, and #474 the vegetation's own reasons:
 *
 * - `farm_field` — midday, partly cloudy, low contrast: the light `world.ts`'s
 *   own sun already assumes. 2K, the size the owner looked at on the tablet.
 * - `asphalt_02`, `sparse_grass` — the road and the ground, at **1K** and
 *   colour + normal only: #457's device run put 2K surfaces at 128 MiB of the
 *   355 MiB all-on estimate against 32 MiB for 1K, and the roughness map is a
 *   third of that for a term the chase camera barely sees.
 * - `island_tree_02`, `tree_small_02` — two broadleaf species, as #457 used.
 * - `fir_sapling_medium` — the conifer. #457's `fir_sapling` was a 1.3 m
 *   sapling scaled to a tree and read as bare twigs (spike 0005 §"What the
 *   pictures already say"); this pack's saplings are about 9 m.
 * - `shrub_02`, `boulder_01` — the shrub and the rock, #474's two new kinds.
 * - `makehuman` — the rider's body: base mesh, default skeleton and weights,
 *   CC0 since September 2020, stated in the repository's own asset licence
 *   and again in the mesh file's header.
 */
export const SOURCES: readonly AssetSource[] = [
  polyHaven('farm_field', { type: 'hdri', resolution: '2k' }),
  polyHaven('asphalt_02', {
    type: 'texture',
    resolution: '1k',
    maps: ['Diffuse', 'nor_gl'],
  }),
  polyHaven('sparse_grass', {
    type: 'texture',
    resolution: '1k',
    maps: ['Diffuse', 'nor_gl'],
  }),
  polyHaven('island_tree_02', { type: 'model', resolution: '1k' }),
  polyHaven('tree_small_02', { type: 'model', resolution: '1k' }),
  polyHaven('fir_sapling_medium', { type: 'model', resolution: '1k' }),
  polyHaven('shrub_02', { type: 'model', resolution: '1k' }),
  polyHaven('boulder_01', { type: 'model', resolution: '1k' }),
  {
    id: 'makehuman',
    licencePage: `${MAKEHUMAN_RAW}/LICENSE.md`,
    licencePhrase: 'These assets have been released under CC0 1.0 Universal',
    licence: 'CC0-1.0',
    author: 'The MakeHuman team',
    origin: {
      from: 'urls',
      files: [
        {
          path: 'base.obj',
          url: `${MAKEHUMAN_RAW}/makehuman/data/3dobjs/base.obj`,
          mustContain: 'This asset was explicitly released as CC0 in september 2020',
        },
        { path: 'default.mhskel', url: `${MAKEHUMAN_RAW}/makehuman/data/rigs/default.mhskel` },
        {
          path: 'default_weights.mhw',
          url: `${MAKEHUMAN_RAW}/makehuman/data/rigs/default_weights.mhw`,
        },
        { path: 'LICENSE.ASSETS.md', url: `${MAKEHUMAN_RAW}/LICENSE.ASSETS.md` },
      ],
    },
  },
];

/** The Blender version every derived asset was made with, and the one a re-run must use. */
export const PINNED_BLENDER = 'Blender 4.4.3';

/** Where the product's realistic files are committed, repository-relative. */
export const OUTPUT_DIRECTORY = 'apps/web/public/realistic';

/** How one shipped file is made. */
export type OutputRecipe =
  /** Copied byte for byte: its `source` and `sha256` describe the same file. */
  | { readonly how: 'verbatim'; readonly file: string }
  /** Made by a Blender script: {@link inputDigest} of the source's locked files is its input. */
  | {
      readonly how: 'blender';
      readonly script: string;
      /** The arguments after the input and output paths — which object, what budget. */
      readonly args: readonly string[];
      /** The other files the same run writes, beside {@link OutputSpec.file}. */
      readonly alsoWrites?: readonly string[];
    };

/** One file the product ships. */
export interface OutputSpec {
  /** The file's name inside {@link OUTPUT_DIRECTORY}. */
  readonly file: string;
  /** Which {@link SOURCES} entry it comes from. */
  readonly from: string;
  readonly recipe: OutputRecipe;
  /** What was changed, in words — ADR 0023's `modified`, for a derived file. */
  readonly modified?: string;
}

const TREE_SCRIPT = 'blender/process_tree.py';

/**
 * Every shipped file, in the order the pipeline makes them.
 *
 * ⚠️ **The budgets in the arguments are the D-6 constants' numbers, not a
 * second copy of them**: `apps/web/src/game/realistic-budget.test.ts` reads each
 * output's triangles and texture sizes back off the committed bytes and holds
 * them to `realistic-budget.ts`, so a recipe that asked for more fails there.
 */
export const OUTPUTS: readonly OutputSpec[] = [
  { file: 'farm_field_2k.hdr', from: 'farm_field', recipe: verbatim('farm_field_2k.hdr') },
  ...['asphalt_02', 'sparse_grass'].flatMap((id) =>
    ['diff', 'nor_gl'].map((map) => {
      const file = `${id}_${map}_1k.jpg`;
      return { file, from: id, recipe: verbatim(file) };
    }),
  ),
  tree('island_tree_02', 'island_tree_02', 'island_tree_02', '28000'),
  tree('tree_small_02', 'tree_small_02', 'tree_small_02', '28000'),
  tree('fir_sapling_medium_a', 'fir_sapling_medium', 'fir_sapling_medium_a', '24000'),
  tree('fir_sapling_medium_b', 'fir_sapling_medium', 'fir_sapling_medium_b', '24000'),
  plant('shrub_02_a', 'shrub_02', 'shrub_02_a', '6000'),
  plant('shrub_02_c', 'shrub_02', 'shrub_02_c', '6000'),
  {
    file: 'boulder_01.glb',
    from: 'boulder_01',
    recipe: { how: 'blender', script: 'blender/process_rock.py', args: ['boulder_01', '2400'] },
    modified:
      'collapse-decimated from 66 122 to about 2 400 triangles, its colour and normal maps downsized to 512 px and its roughness map dropped; stood on its base',
  },
  {
    file: 'rider.glb',
    from: 'makehuman',
    recipe: { how: 'blender', script: 'blender/process_rider.py', args: ['9000'] },
    modified:
      'the body mesh only, its skeleton reduced from 163 bones to 24 with each dropped bone’s weights merged into its nearest kept ancestor, coloured as cycling kit by dominant bone, collapse-decimated to about 9 000 triangles, in its rest pose',
  },
];

function verbatim(file: string): OutputRecipe {
  return { how: 'verbatim', file };
}

/** A tree: the near mesh, and the impostor strip rendered from the full scan. */
function tree(name: string, from: string, object: string, triangles: string): OutputSpec {
  return {
    file: `${name}.glb`,
    from,
    recipe: {
      how: 'blender',
      script: TREE_SCRIPT,
      args: [object, triangles, 'impostor', 'auto'],
      alsoWrites: [`${name}-impostor.png`],
    },
    modified: `one object of the pack (${object}); foliage thinned by whole cards and each survivor grown, wood collapse-decimated, textures downsized to 512 px and roughness maps dropped, ambient occlusion baked into a vertex colour; an eight-view impostor strip rendered from the full scan before any of that`,
  };
}

/** A plant with no impostor: a shrub stands in the near field or not at all. */
function plant(name: string, from: string, object: string, triangles: string): OutputSpec {
  return {
    file: `${name}.glb`,
    from,
    recipe: { how: 'blender', script: TREE_SCRIPT, args: [object, triangles, 'none', 'all'] },
    modified: `one object of the pack (${object}); foliage thinned by whole cards and each survivor grown, textures downsized to 512 px and roughness maps dropped, ambient occlusion baked into a vertex colour`,
  };
}

/** Every file the pipeline writes into {@link OUTPUT_DIRECTORY}, impostors included. */
export function shippedFiles(): readonly string[] {
  return OUTPUTS.flatMap((output) =>
    output.recipe.how === 'blender'
      ? [output.file, ...(output.recipe.alsoWrites ?? [])]
      : [output.file],
  );
}

/** Why a source was refused, or the evidence that it was not. */
export type LicenceVerdict =
  | { readonly kept: true; readonly licence: KeptLicence; readonly evidence: string }
  | { readonly kept: false; readonly reason: string };

/**
 * Whether a source may be kept, given the text of its licence page.
 *
 * Refuses a barred host, a page that does not carry the phrase, and — however
 * the phrase reads — a page that also names a non-commercial, no-derivatives or
 * share-alike term, because a page can carry the CC0 phrase for one file and a
 * stricter licence for the one being fetched. ADR 0026 D-4 excludes all three.
 */
export function licenceVerdict(source: AssetSource, pageText: string): LicenceVerdict {
  const hosts = [source.licencePage, ...fixedUrls(source)].map((url) => new URL(url).hostname);
  const barred = hosts.find((host) => BARRED_HOSTS.includes(host));
  if (barred !== undefined) {
    return {
      kept: false,
      reason: `${source.id}: ${barred} is barred — its terms forbid redistribution`,
    };
  }
  if (!pageText.includes(source.licencePhrase)) {
    return {
      kept: false,
      reason: `${source.id}: ${source.licencePage} does not state "${source.licencePhrase}"`,
    };
  }
  if (/\bCC[- ]BY[- ](?:[A-Z]+-)*(?:NC|ND|SA)\b/i.test(pageText)) {
    return {
      kept: false,
      reason: `${source.id}: the licence page names a NC, ND or SA licence`,
    };
  }
  return { kept: true, licence: source.licence, evidence: source.licencePhrase };
}

function fixedUrls(source: AssetSource): readonly string[] {
  return source.origin.from === 'urls' ? source.origin.files.map((file) => file.url) : [];
}

/** A file resolved to a URL, with whatever integrity check its origin offers. */
export interface ResolvedFile {
  readonly path: string;
  readonly url: string;
  readonly md5?: string | undefined;
  readonly size?: number | undefined;
  readonly mustContain?: string | undefined;
}

/** The part of Poly Haven's `/files/{id}` answer that is read. */
interface PolyHavenFile {
  readonly url: string;
  readonly md5: string;
  readonly size: number;
  readonly include?: Readonly<Record<string, { url: string; md5: string; size: number }>>;
}

/**
 * The files to fetch for a Poly Haven asset, from its `/files/{id}` answer.
 *
 * Throws when a requested map or resolution is not offered: a silently shorter
 * download is a vacuous pass in a new place — the road would ship with no
 * normal map and nothing would say so.
 */
export function polyHavenFiles(
  id: string,
  select: PolyHavenSelection,
  answer: Readonly<Record<string, unknown>>,
): readonly ResolvedFile[] {
  const pick = (path: readonly string[]): PolyHavenFile => {
    let node: unknown = answer;
    for (const key of path) {
      node =
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined;
    }
    if (
      typeof node !== 'object' ||
      node === null ||
      typeof (node as PolyHavenFile).url !== 'string'
    ) {
      throw new Error(`${id}: Poly Haven offers no ${path.join('/')}`);
    }
    return node as PolyHavenFile;
  };
  const one = (file: PolyHavenFile): ResolvedFile => ({
    path: file.url.slice(file.url.lastIndexOf('/') + 1),
    url: file.url,
    md5: file.md5,
    size: file.size,
  });
  switch (select.type) {
    case 'hdri':
      return [one(pick(['hdri', select.resolution, 'hdr']))];
    case 'texture':
      return select.maps.map((map) => one(pick([map, select.resolution, 'jpg'])));
    case 'model': {
      const gltf = pick(['gltf', select.resolution, 'gltf']);
      const included = Object.entries(gltf.include ?? {}).map(([path, file]) => ({
        path,
        url: file.url,
        md5: file.md5,
        size: file.size,
      }));
      return [one(gltf), ...included];
    }
  }
}

/**
 * Whether a relative path from a remote answer may be written under the output
 * directory. A traversal is refused, never normalised.
 */
export function safeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '..' && segment !== '' && segment !== '.');
}

/** One downloaded file, as `inputs.lock.json` records it. */
export interface LockedFile {
  readonly path: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** One source, as `inputs.lock.json` records it. */
export interface LockedSource {
  readonly id: string;
  readonly licence: KeptLicence;
  readonly licencePage: string;
  readonly evidence: string;
  /** The date the licence page was read and the files were downloaded. */
  readonly read: string;
  /** Who made it, as the source names them — recorded even where CC0 asks for nothing. */
  readonly authors: string;
  readonly files: readonly LockedFile[];
}

/** `inputs.lock.json`. */
export interface InputLock {
  readonly sources: readonly LockedSource[];
}

/**
 * One digest for everything a derived asset was made from: SHA-256 over the
 * lines `<sha256>  <path>\n`, sorted by path — the shape `shasum -a 256` prints,
 * so it can be reproduced by hand from a directory of downloads with
 * `shasum -a 256 $(find . -type f | sort) | … | shasum -a 256`.
 *
 * ⚠️ **Sorted by path**, so the order an API happened to list files in cannot
 * move it; and the path is in it, so two files swapping contents does.
 */
export function inputDigest(files: readonly Pick<LockedFile, 'path' | 'sha256'>[]): string {
  const canonical = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join('');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Poly Haven's `/info/{id}` `authors` field — name to role — as one line:
 * `Rob Tuytel (scanning, processing); Rico Cilliers (cleanup, processing)`.
 * Throws when there is none: an asset whose maker nobody recorded is one whose
 * provenance is half written.
 */
export function polyHavenAuthors(id: string, info: Readonly<Record<string, unknown>>): string {
  const authors = info['authors'];
  if (typeof authors !== 'object' || authors === null || Object.keys(authors).length === 0) {
    throw new Error(`${id}: Poly Haven names no author`);
  }
  return Object.entries(authors as Record<string, unknown>)
    .map(([name, role]) => (typeof role === 'string' ? `${name} (${role})` : name))
    .join('; ');
}

/** What `ASSETS.toml` records for one shipped file, as key–value pairs in its order. */
export type AssetRecord = readonly (readonly [string, string])[];

/**
 * The `ASSETS.toml` entry for one shipped file, from the pipeline's own table,
 * the lock and the file's digest — what `provenance.test.ts` holds the manifest
 * to, and what `process-assets.ts --records` prints to paste in.
 *
 * ⚠️ **Derived from the table rather than typed beside it**: an entry written
 * by hand would be a second statement of which script made a file, and the one
 * place two statements can disagree unnoticed is a manifest nobody reads.
 */
export function assetRecord(file: string, lock: InputLock, sha256: string): AssetRecord {
  const output = OUTPUTS.find(
    (each) =>
      each.file === file ||
      (each.recipe.how === 'blender' && (each.recipe.alsoWrites ?? []).includes(file)),
  );
  if (output === undefined) throw new Error(`${file}: no pipeline output makes it`);
  const source = lock.sources.find((each) => each.id === output.from);
  if (source === undefined) throw new Error(`${file}: ${output.from} is not in the lock`);
  const path = `${OUTPUT_DIRECTORY}/${file}`;
  const origin = source.id === 'makehuman' ? 'MakeHuman' : 'Poly Haven';
  if (output.recipe.how === 'verbatim') {
    const recipe = output.recipe;
    const upstream = source.files.find((each) => each.path === recipe.file);
    if (upstream === undefined) throw new Error(`${file}: the lock records no ${recipe.file}`);
    return [
      ['path', path],
      [
        'source',
        `${origin}, ${source.id} by ${source.authors}; upstream bytes, unmodified — ${upstream.url}`,
      ],
      ['licence', source.licence],
      ['read', source.read],
      ['sha256', sha256],
    ];
  }
  const impostor = file !== output.file;
  return [
    ['path', path],
    [
      'source',
      `${origin}, ${source.id} by ${source.authors}; made by this repository's asset pipeline (#430) from the files inputs.lock.json records`,
    ],
    ['licence', source.licence],
    ['read', source.read],
    ['sha256', sha256],
    [
      'modified',
      impostor
        ? `an eight-view impostor strip of one object of the pack, rendered from the full scan`
        : (output.modified ?? ''),
    ],
    ['input', source.licencePage],
    ['inputsha256', inputDigest(source.files)],
    ['script', `apps/web/tools/realistic/${output.recipe.script}`],
    ['tool', PINNED_BLENDER],
  ];
}

/** One entry as the `ASSETS.toml` subset writes it. */
export function formatRecord(record: AssetRecord): string {
  return ['[[asset]]', ...record.map(([key, value]) => `${key} = "${value}"`)].join('\n');
}
