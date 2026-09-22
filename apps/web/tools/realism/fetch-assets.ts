// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Download the realism spike's assets into `tools/realism/build/raw/` — #457.
 *
 * ```bash
 * node apps/web/tools/realism/fetch-assets.ts
 * ```
 *
 * Needs Node 24 (it runs this `.ts` file directly, as `icons:generate` does)
 * and the network. About 190 MB, most of it three tree scans.
 *
 * For every source in {@link SOURCES}: read the licence page and refuse the asset
 * unless it states the licence (`licenceVerdict`); resolve its files; download
 * each, check Poly Haven's MD5 where one is published and the file's own
 * licence header where one is required; record URL, date, licence evidence and
 * SHA-256 in `build/raw/provenance.json`. A file already on disk with the
 * recorded MD5 is not downloaded again.
 *
 * ## ⚠️ Spike code, on a branch that is never merged
 *
 * #431 — the ADR that would take the world realistic — has not landed, and it
 * is what would let a realistic asset enter the product. So nothing here is
 * committed as a binary: this script writes into `tools/realism/build/`,
 * which the root `.gitignore` ignores (`build/`) and `check-repo-rules.sh`
 * prunes by name, so `ASSET001` has nothing to report and nothing can be staged
 * without forcing past an ignore rule — which CLAUDE.md §7 forbids.
 *
 * ## The licence is read off the asset's OWN page, at download time
 *
 * A marketplace label is not a grant. Every source below names the page that
 * states the licence for that one asset, and the phrase that has to be on it.
 * The fetcher reads the page, requires the phrase, and refuses to keep the
 * asset otherwise — before a byte of it is written. The evidence it found is
 * recorded beside the file's SHA-256 in `build/raw/provenance.json`, which is
 * what the spike write-up's asset table is filled from.
 *
 * ⚠️ **No Mixamo**, and it is refused by host rather than by omission: Adobe's
 * terms bar redistributing the raw character, which is exactly what a web
 * bundle does. {@link BARRED_HOSTS}.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Hosts whose terms are incompatible with shipping the file in a web bundle. */
export const BARRED_HOSTS: readonly string[] = ['mixamo.com', 'www.mixamo.com'];

/** The licences the spike will keep: the two ADR 0023 admits under `apps/`. */
export type KeptLicence = 'CC0-1.0' | 'CC-BY-4.0';

/** One thing to download, before its files are resolved. */
export interface AssetSource {
  /** A stable name, used as the directory under `build/raw/`. */
  readonly id: string;
  readonly kind: 'hdri' | 'texture' | 'tree' | 'human';
  /** The page that states this asset's licence. */
  readonly licencePage: string;
  /** What that page has to say, verbatim, for the licence to be {@link licence}. */
  readonly licencePhrase: string;
  readonly licence: KeptLicence;
  /** Where the files come from: Poly Haven's API, or fixed raw URLs. */
  readonly origin:
    | { readonly from: 'polyhaven'; readonly select: PolyHavenSelection }
    | { readonly from: 'urls'; readonly files: readonly FixedFile[] };
}

/** Which of a Poly Haven asset's files to take. */
export type PolyHavenSelection =
  | { readonly type: 'hdri'; readonly resolution: string }
  | {
      readonly type: 'texture';
      readonly resolutions: readonly string[];
      readonly maps: readonly string[];
    }
  | { readonly type: 'model'; readonly resolution: string };

/** A file named by URL rather than by an API. */
export interface FixedFile {
  readonly path: string;
  readonly url: string;
  /**
   * A phrase the file itself must contain, for a file that states its own
   * licence in a header — MakeHuman's base mesh does.
   */
  readonly mustContain?: string | undefined;
}

/** A file resolved to a URL, with whatever integrity check its origin offers. */
export interface ResolvedFile {
  readonly path: string;
  readonly url: string;
  readonly md5?: string | undefined;
  readonly size?: number | undefined;
  readonly mustContain?: string | undefined;
}

/**
 * MakeHuman's repository, pinned to one commit so the mesh, skeleton and
 * weights read on 2026-09-21 are the ones every later run reads.
 */
export const MAKEHUMAN_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const MAKEHUMAN_RAW = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MAKEHUMAN_COMMIT}`;

/** Poly Haven states the licence of every asset in its page's structured data. */
const POLY_HAVEN_PHRASE = 'CC0 1.0 Universal - public domain dedication, no attribution required';

function polyHaven(id: string, kind: AssetSource['kind'], select: PolyHavenSelection): AssetSource {
  return {
    id,
    kind,
    licencePage: `https://polyhaven.com/a/${id}`,
    licencePhrase: POLY_HAVEN_PHRASE,
    licence: 'CC0-1.0',
    origin: { from: 'polyhaven', select },
  };
}

/** Everything the spike downloads. Each item's reason is in the spike write-up. */
export const SOURCES: readonly AssetSource[] = [
  // (1) The sky and the environment light: midday, partly cloudy, low contrast
  // — the light the product's own sun (`world.ts`) already assumes.
  polyHaven('farm_field', 'hdri', { type: 'hdri', resolution: '2k' }),
  // (2) The road and the ground, at both resolutions #457 asks to compare.
  polyHaven('asphalt_02', 'texture', {
    type: 'texture',
    resolutions: ['1k', '2k'],
    maps: ['Diffuse', 'nor_gl', 'Rough'],
  }),
  polyHaven('sparse_grass', 'texture', {
    type: 'texture',
    resolutions: ['1k', '2k'],
    maps: ['Diffuse', 'nor_gl', 'Rough'],
  }),
  // (3) Three photoscanned species: two broadleaf, one conifer — the two
  // `ScatterKind`s the product has trees for.
  polyHaven('island_tree_02', 'tree', { type: 'model', resolution: '1k' }),
  polyHaven('tree_small_02', 'tree', { type: 'model', resolution: '1k' }),
  polyHaven('fir_sapling', 'tree', { type: 'model', resolution: '1k' }),
  // (4) The rider's body: MakeHuman's base mesh, its default skeleton and the
  // skinning weights that go with it. CC0 since September 2020, stated in the
  // repository's own asset licence and again in the mesh file's header.
  {
    id: 'makehuman',
    kind: 'human',
    licencePage: `${MAKEHUMAN_RAW}/LICENSE.md`,
    licencePhrase: 'These assets have been released under CC0 1.0 Universal',
    licence: 'CC0-1.0',
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

/** Why a source was refused, or the evidence that it was not. */
export type LicenceVerdict =
  | { readonly kept: true; readonly licence: KeptLicence; readonly evidence: string }
  | { readonly kept: false; readonly reason: string };

/**
 * Whether a source may be kept, given the text of its licence page.
 *
 * Refuses a barred host, a page that does not carry the phrase, and — however
 * the phrase reads — a page whose own licence notice names a non-commercial or
 * no-derivatives term, because a page can carry the CC0 phrase for one file
 * and a stricter licence for the one being fetched.
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
  const at = pageText.indexOf(source.licencePhrase);
  if (at === -1) {
    return {
      kept: false,
      reason: `${source.id}: ${source.licencePage} does not state "${source.licencePhrase}"`,
    };
  }
  if (/\bCC[- ]BY[- ](?:[A-Z]+-)*(?:NC|ND)\b/i.test(pageText)) {
    return { kept: false, reason: `${source.id}: the licence page names a NC or ND licence` };
  }
  return { kept: true, licence: source.licence, evidence: source.licencePhrase };
}

function fixedUrls(source: AssetSource): readonly string[] {
  return source.origin.from === 'urls' ? source.origin.files.map((file) => file.url) : [];
}

/** The part of Poly Haven's `/files/{id}` answer the spike reads. */
export interface PolyHavenFile {
  readonly url: string;
  readonly md5: string;
  readonly size: number;
  readonly include?: Readonly<Record<string, { url: string; md5: string; size: number }>>;
}

/**
 * The files to fetch for a Poly Haven asset, from its `/files/{id}` answer.
 *
 * Throws when a requested map or resolution is not offered: a silently
 * shorter download is the vacuous pass in a new place — the page would then
 * measure a road with no normal map and say so nowhere.
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
      return select.resolutions.flatMap((resolution) =>
        select.maps.map((map) => one(pick([map, resolution, 'jpg']))),
      );
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
 * Whether a relative path from a manifest may be written under the output
 * directory. A path traversal from a remote answer is refused, not normalised.
 */
export function safeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '..' && segment !== '' && segment !== '.');
}

const RAW = join(dirname(fileURLToPath(import.meta.url)), 'build', 'raw');

interface ProvenanceRow {
  readonly asset: string;
  readonly kind: AssetSource['kind'];
  readonly file: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly licence: string;
  readonly licencePage: string;
  readonly evidence: string;
  readonly read: string;
}

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function bytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function resolve(source: AssetSource): Promise<readonly ResolvedFile[]> {
  if (source.origin.from === 'urls') return source.origin.files;
  const answer = JSON.parse(await text(`https://api.polyhaven.com/files/${source.id}`)) as Record<
    string,
    unknown
  >;
  return polyHavenFiles(source.id, source.origin.select, answer);
}

async function main(): Promise<void> {
  const read = new Date().toISOString().slice(0, 10);
  const rows: ProvenanceRow[] = [];
  for (const source of SOURCES) {
    const verdict = licenceVerdict(source, await text(source.licencePage));
    if (!verdict.kept) throw new Error(verdict.reason);
    for (const file of await resolve(source)) {
      if (!safeRelativePath(file.path)) throw new Error(`${source.id}: refused path ${file.path}`);
      const target = join(RAW, source.id, file.path);
      let body: Buffer;
      const md5 = (data: Buffer): string => createHash('md5').update(data).digest('hex');
      if (existsSync(target) && file.md5 !== undefined && md5(readFileSync(target)) === file.md5) {
        body = readFileSync(target);
      } else {
        body = await bytes(file.url);
        if (file.md5 !== undefined && md5(body) !== file.md5) {
          throw new Error(
            `${source.id}/${file.path}: MD5 does not match the one Poly Haven publishes`,
          );
        }
        if (file.mustContain !== undefined && !body.toString('utf8').includes(file.mustContain)) {
          throw new Error(
            `${source.id}/${file.path}: its header does not state "${file.mustContain}"`,
          );
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
      rows.push({
        asset: source.id,
        kind: source.kind,
        file: file.path,
        url: file.url,
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        licence: verdict.licence,
        licencePage: source.licencePage,
        evidence: verdict.evidence,
        read,
      });
      console.log(`${source.id}/${file.path} ${body.length} bytes`);
    }
  }
  writeFileSync(join(RAW, 'provenance.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(
    `${rows.length} files, ${rows.reduce((sum, row) => sum + row.bytes, 0)} bytes → ${RAW}`,
  );
}

if (process.argv[1]?.endsWith('fetch-assets.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
