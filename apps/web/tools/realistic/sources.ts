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
 * do.
 *
 * ## The list of sources is the boundary, and it is written here
 *
 * [ADR 0049](../../../../docs/adr/0049-open-asset-sources-for-the-realistic-world.md)
 * D-10 is the whole list since #1275, and it supersedes ADR 0026 D-4's:
 * {@link ADMITTED_SOURCES} and {@link BARRED_SOURCES} are that table, row for
 * row, and `admitted-sources.test.ts` reads the ADR and holds the two to each
 * other. {@link admission} is what the lists decide about one URL, and
 * `realistic:fetch` asks it of every URL it requests — a licence page and each
 * file, including the ones Poly Haven's API resolves — before the request is
 * made, so a source from anywhere else is refused by the pipeline, not only by
 * a reviewer. {@link licenceVerdict} asks it of the addresses a source declares.
 * (A redirect is followed by `fetch`; only the address requested is checked.)
 * ⚠️ **A new source is a superseding ADR, not a row added here** (ADR 0026 D-4,
 * which ADR 0049 keeps).
 *
 * ⚠️ **ambientCG is one of them since #1274, and it is no new host**: D-10's
 * table admits it, as ADR 0026 D-4's did, for PBR materials, and until #1274
 * nothing here read it. Its origin is {@link ambientCg}; what its asset's own page has to say,
 * and which of its assets are refused however their page reads, is
 * {@link ambientCgVerdict}.
 *
 * ⚠️ **And since #1283 some trees are GENERATED** (ADR 0049 D-1): made by the
 * pinned {@link PINNED_EZ_TREE} from the seed and parameters in
 * `generated-trees.ts`, wearing ambientCG's bark and leaves. Their recipe is
 * `generated`; their recorded input is those numbers' digest with the
 * ambientCG files' ({@link generatedInputDigest}).
 *
 * Pure: no file, no network. The two scripts beside it do the I/O.
 */

import { createHash } from 'node:crypto';

import {
  REALISTIC_BICYCLE_MAPS,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_RIDER,
  REALISTIC_RIDER_MAPS,
  REALISTIC_WORDMARK,
  type RealisticBicycleMap,
} from '../../src/game/realistic-assets';
import {
  WORDMARK_CREATOR,
  WORDMARK_MODIFIED_WORDS,
  WORDMARK_READ,
  WORDMARK_SCRIPT,
  WORDMARK_SOURCE,
  WORDMARK_SOURCE_SHA256,
  WORDMARK_SOURCE_WORDS,
  WORDMARK_URL,
} from '../brand/game-wordmark';

import {
  GENERATED_SPECIES,
  GENERATED_TREES,
  runNumbersDigest,
  speciesOf,
  type GeneratedLevel,
  type GeneratedSpecies,
  type GeneratedTree,
  type RunPaths,
} from './generated-trees';

import {
  BICYCLE_MAP_KINDS,
  BICYCLE_MAP_WORDS,
  drawBicycleMap,
  pixelDigest,
} from './draw-bicycle-maps';

/** The licences a realistic asset may carry: the two ADR 0026 D-4 admits under `apps/`. */
export type KeptLicence = 'CC0-1.0' | 'CC-BY-4.0';

/** One row of ADR 0049 D-10's **In** table. */
export interface AdmittedSource {
  /** The source, as the ADR's table names it. */
  readonly name: string;
  /**
   * The licence its row states. `MIT` is a GENERATOR's own licence, never an
   * asset's: what a generator writes is this repository's (ADR 0049 D-1).
   */
  readonly licence: KeptLicence | 'MIT';
  /** The decision that admits it. */
  readonly decidedBy: string;
  /**
   * `files`: its files are downloaded, pinned and derived from (ADR 0026 D-5).
   * `generator`: a deterministic tool run from committed parameters — its
   * version, seed and parameters are the recorded input (ADR 0049 D-1, D-2).
   */
  readonly kind: 'files' | 'generator';
  /**
   * Where its licence pages and files are read from: a URL is this source's
   * when it starts with one of these. Each ends at a path boundary, so a
   * look-alike host cannot match. Empty where this pipeline reads nothing from
   * it yet — the pull request that adopts an asset adds the page it read, and
   * that is a fact about an admitted source, not a new one (ADR 0049 D-11).
   */
  readonly prefixes: readonly string[];
}

/**
 * Every source a realistic asset may come from — ADR 0049 D-10's **In** table,
 * which supersedes ADR 0026 D-4's. ⚠️ **Admitted is not adopted**: #1275 added
 * no asset, and each adoption is its own issue, measured on the tablet.
 */
export const ADMITTED_SOURCES: readonly AdmittedSource[] = [
  {
    name: 'Poly Haven',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0026 D-4',
    kind: 'files',
    prefixes: [
      'https://polyhaven.com/',
      'https://api.polyhaven.com/',
      // Where api.polyhaven.com's /files answer points: the files themselves.
      'https://dl.polyhaven.org/',
    ],
  },
  {
    name: 'ambientCG',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0026 D-4',
    kind: 'files',
    prefixes: ['https://ambientcg.com/', 'https://docs.ambientcg.com/'],
  },
  {
    // ADR 0026's 2026-09-28 amendment: MakeHuman's own CC0 system assets pack,
    // by the author `makehuman_system`, is under this row.
    name: 'MakeHuman’s own files',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0026 D-4',
    kind: 'files',
    prefixes: [
      'https://raw.githubusercontent.com/makehumancommunity/makehuman/',
      'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
      'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/',
    ],
  },
  {
    // The stylised world's models: committed verbatim, never through this pipeline.
    name: 'Kenney',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0026 D-4',
    kind: 'files',
    prefixes: [],
  },
  {
    // Verified per asset under ADR 0023, wherever it is hosted: none is taken.
    name: 'An individual model under CC-BY-4.0',
    licence: 'CC-BY-4.0',
    decidedBy: 'ADR 0026 D-4',
    kind: 'files',
    prefixes: [],
  },
  {
    name: 'EZ-Tree’s output',
    licence: 'MIT',
    decidedBy: 'ADR 0049 D-1',
    kind: 'generator',
    prefixes: ['https://github.com/dgreenheck/ez-tree/'],
  },
  {
    name: 'The Base Mesh',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0049 D-3',
    kind: 'files',
    prefixes: ['https://www.thebasemesh.com/'],
  },
  {
    name: 'Blender Studio Human Base Meshes',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0049 D-4',
    kind: 'files',
    prefixes: [
      'https://www.blender.org/download/demo-files/',
      'https://www.blender.org/download/demo/asset-bundles/human-base-meshes/',
    ],
  },
  {
    // Per asset: the pose's OWN row on the pack's page has to read CC0.
    name: 'MakeHuman community cyclist poses',
    licence: 'CC0-1.0',
    decidedBy: 'ADR 0049 D-6',
    kind: 'files',
    prefixes: [
      'https://static.makehumancommunity.org/assets/assetpacks/poses02.html',
      'https://files.makehumancommunity.org/asset_packs/poses02/',
    ],
  },
];

/** One row of ADR 0049 D-10's **Out** table. */
export interface BarredSource {
  /** What is out, as the ADR's table names it. */
  readonly name: string;
  /** The decision that bars it. */
  readonly decidedBy: string;
  /** Why, in the words a refusal prints. */
  readonly why: string;
  /**
   * The hosts it is refused by, each with its subdomains. Empty where what is
   * barred is a licence term or a way of making, which no host identifies:
   * those are refused by {@link licenceVerdict}'s reading of the page, or by
   * review of the asset's own page (ADR 0049 D-2).
   */
  readonly hosts: readonly string[];
}

/** Everything that stays out, whatever the convenience — ADR 0049 D-10's **Out** table. */
export const BARRED_SOURCES: readonly BarredSource[] = [
  {
    name: 'Mixamo',
    decidedBy: 'ADR 0026 D-4',
    why: 'its terms forbid redistributing the raw files, and a public repository is redistribution',
    hosts: ['mixamo.com'],
  },
  {
    name: 'Quixel Megascans and the Fab Standard licence',
    decidedBy: 'ADR 0026 D-4',
    why: 'not an open licence',
    hosts: [],
  },
  {
    name: 'Sketchfab’s Standard licence',
    decidedBy: 'ADR 0026 D-4',
    why: 'not an open licence',
    hosts: [],
  },
  {
    name: 'Anything non-commercial, no-derivatives or share-alike',
    decidedBy: 'ADR 0026 D-4',
    why: 'an asset is CC0-1.0 or CC-BY-4.0 and nothing else',
    hosts: [],
  },
  {
    name: 'Non-commercial motion capture sets',
    decidedBy: 'ADR 0049 D-9',
    why: 'a non-commercial grant, whatever the data',
    hosts: [],
  },
  {
    name: 'MB-Lab characters',
    decidedBy: 'ADR 0049 D-9',
    why: 'its characters carry neither CC0-1.0 nor CC-BY-4.0',
    hosts: [],
  },
  {
    name: 'Anything AI-generated',
    decidedBy: 'ADR 0049 D-2',
    why: 'the output of a trained generative model, however it is labelled',
    hosts: [],
  },
  {
    name: 'The cyclist motion capture set’s data',
    decidedBy: 'ADR 0049 D-5',
    why: 'it is a reference to read, and none of its data is fetched or committed',
    hosts: ['zenodo.org'],
  },
  {
    name: 'A downloaded bicycle',
    decidedBy: 'ADR 0049 D-8',
    why: 'the bicycle is built from numbers (#369)',
    hosts: [],
  },
];

/** What the two lists decide about one URL. */
export type Admission =
  | { readonly admitted: true; readonly source: AdmittedSource }
  | { readonly admitted: false; readonly reason: string };

/**
 * Whether a URL may be read by the pipeline: barred hosts first, then the
 * admitted prefixes, and anything else refused — the list is the boundary, so
 * "not named" is a refusal and never a judgement (ADR 0026 D-4, ADR 0049 D-11).
 *
 * `as` says what the URL is for. A **generator** row (EZ-Tree) admits its
 * licence page and nothing it hosts: its bundled images are not taken (ADR
 * 0049 D-1), so no file is read from it. A URL that is not in the form `fetch`
 * would request (`..`, `%2e%2e`, a default port) is refused, because the prefix
 * test reads the string and the server reads the normalised address; a prefix
 * that names a page (`.html`) matches that page alone.
 */
export function admission(url: string, as: 'licence' | 'file' = 'file'): Admission {
  const { hostname, href } = new URL(url);
  const barred = BARRED_SOURCES.find((source) =>
    source.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
  );
  if (barred !== undefined) {
    return {
      admitted: false,
      reason: `${hostname} is barred — ${barred.name}: ${barred.why} (${barred.decidedBy})`,
    };
  }
  const source =
    href !== url || /%2e/i.test(url)
      ? undefined
      : ADMITTED_SOURCES.find(
          (candidate) =>
            (as === 'licence' || candidate.kind === 'files') &&
            candidate.prefixes.some((prefix) =>
              prefix.endsWith('.html') ? url === prefix : url.startsWith(prefix),
            ),
        );
  if (source === undefined) {
    return {
      admitted: false,
      reason: `${url} is not from a source ADR 0049 D-10 admits — a new source is a superseding ADR, not a new row`,
    };
  }
  return { admitted: true, source };
}

/** Which of a Poly Haven asset's files to take. */
export type PolyHavenSelection =
  | { readonly type: 'hdri'; readonly resolution: string }
  | {
      readonly type: 'texture';
      readonly resolution: string;
      readonly maps: readonly string[];
    }
  | { readonly type: 'model'; readonly resolution: string }
  /**
   * Named maps of an asset of any kind and none of its geometry — #1294: a
   * model's twig atlas and bark, for a generated tree to wear. `maps` are the
   * keys of Poly Haven's `/files/{id}` answer (`twig_alpha`), which for a
   * model are not among the files its glTF includes.
   */
  | { readonly type: 'maps'; readonly resolution: string; readonly maps: readonly string[] };

/** A file named by URL rather than by an API. */
export interface FixedFile {
  readonly path: string;
  readonly url: string;
  /** A phrase the file itself must contain — MakeHuman's mesh states its own licence. */
  readonly mustContain?: string | undefined;
}

/**
 * One file taken out of an archive — #623: MakeHuman's CC0 system assets pack
 * is published as ONE zip, and the rider reads six of its files.
 */
export interface ArchiveMember {
  /** The path inside the archive, and under `build/raw/<id>/`. */
  readonly path: string;
  /**
   * The asset it belongs to, as the pack's own page lists it: its type column
   * and its name. {@link systemAssetVerdict} reads that asset's OWN row.
   */
  readonly asset: { readonly type: string; readonly name: string };
  /** A phrase the file itself must contain, where it is text. */
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
    | { readonly from: 'urls'; readonly files: readonly FixedFile[] }
    | {
        /** An archive downloaded whole, pinned by its digest, and only `members` taken out. */
        readonly from: 'archive';
        readonly url: string;
        readonly members: readonly ArchiveMember[];
      }
    | {
        /**
         * An ambientCG asset — #1274: the one archive ambientCG publishes for
         * it at `attribute`, downloaded whole and pinned by its digest, and
         * only `maps` taken out. {@link ambientCgArchive} says which files.
         */
        readonly from: 'ambientcg';
        /** The size and format ambientCG names the archive by: `1K-JPG`. */
        readonly attribute: string;
        /** The maps taken, as ambientCG names them: `Color`, `NormalGL`. */
        readonly maps: readonly string[];
      };
}

/**
 * MakeHuman's repository, pinned to one commit so the mesh, skeleton and
 * weights are the ones every later run reads. #457 read it on 2026-09-22.
 */
export const MAKEHUMAN_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const MAKEHUMAN_RAW = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MAKEHUMAN_COMMIT}`;

/**
 * The MakeHuman targets the rider's build is made from — #623. Their weights
 * are `blender/process_rider.py` §`macro_targets`, MakeHuman's own macro
 * arithmetic over its own sliders; this is which files that arithmetic names at
 * the build `process_rider.py` §`BUILD` states, and the run fails if it names
 * one this list does not fetch.
 */
export const RIDER_BUILD_TARGETS: readonly string[] = [
  ...['female', 'male'].flatMap((sex) => [
    ...['averagemuscle', 'maxmuscle'].flatMap((muscle) =>
      ['averageweight', 'minweight'].map(
        (weight) => `universal-${sex}-young-${muscle}-${weight}.target`,
      ),
    ),
    ...['african', 'asian', 'caucasian'].map((ethnic) => `${ethnic}-${sex}-young.target`),
  ]),
];

/**
 * MakeHuman's CC0 system assets pack — #623, and ADR 0026's 2026-09-28
 * amendment: the owner's ruling that MakeHuman's own asset packs come from the
 * same author under the same CC0 grant as the pinned repository, and so fall
 * under D-4's existing MakeHuman row.
 *
 * - **Its page** lists every asset the pack holds with its author and licence;
 *   {@link systemAssetVerdict} reads the row of EACH asset taken, and refuses
 *   one whose author is not `makehuman_system` or whose licence is not CC0.
 *   ⚠️ The site's other skin and eyebrow packs ("Skins 01/02", "Eyebrows 01")
 *   are by community authors — Mindfront, MargaretToigo and others, read
 *   2026-09-28 — and are NOT taken: the ruling's premise, the same author, is
 *   false of them.
 * - **Its archive** is the one file downloaded, pinned by its SHA-256 in the
 *   lock with each member taken out of it.
 * - **Each member that is text** states the same CC0 release, in the same
 *   words and with the same copyright holders, as the repository's `base.obj`.
 */
export const SYSTEM_ASSETS_PAGE =
  'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html';
export const SYSTEM_ASSETS_ARCHIVE =
  'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip';
/** The sentence every MakeHuman asset file's header carries — the repository's `base.obj` too. */
const MAKEHUMAN_CC0_HEADER = 'This asset was explicitly released as CC0 in september 2020';

/**
 * Whether one asset on a MakeHuman asset pack's page is CC0 and MakeHuman's
 * own — #623. The page is a table, one `<tr>` an asset: its type, a
 * thumbnail, its name, its author, its source and its licence. Only a row
 * whose type and name are exactly the asset's is read, so another asset's
 * CC0 cannot vouch for this one.
 */
export function systemAssetVerdict(
  pageHtml: string,
  asset: { readonly type: string; readonly name: string },
): LicenceVerdict {
  const text = (cell: string): string =>
    cell
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const rows = pageHtml.split(/<tr\b/i).slice(1);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      text(match[1] ?? ''),
    );
    if (cells.length < 6 || cells[0] !== asset.type || cells[2] !== asset.name) continue;
    if (cells[3] !== 'makehuman_system') {
      return {
        kept: false,
        reason: `${asset.type} ${asset.name}: its author is ${cells[3] ?? 'nobody'}, not MakeHuman's own makehuman_system`,
      };
    }
    if (cells[5] !== 'CC0') {
      return {
        kept: false,
        reason: `${asset.type} ${asset.name}: its own entry reads ${cells[5] ?? 'nothing'}, not CC0`,
      };
    }
    return {
      kept: true,
      licence: 'CC0-1.0',
      evidence: `${asset.type} ${asset.name} makehuman_system CC0`,
    };
  }
  return {
    kept: false,
    reason: `${asset.type} ${asset.name}: the pack's page lists no such asset`,
  };
}

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
 * What every ambientCG asset's own page says of its licence, verbatim — read
 * on 2026-10-12 at `ambientcg.com/view?id=Rock026`.
 */
export const AMBIENTCG_PHRASE = 'All assets are released under the Creative Commons CC0 license';

/**
 * How an ambientCG asset may have been made, as its own page's "Technique"
 * names it, for the pipeline to take it — #1274.
 *
 * ADR 0026 D-4 bars anything **marked or known to be AI-generated**, and
 * ambientCG says of each asset how its maps were made. Read on 2026-10-12, its
 * pages name five techniques:
 *
 * | The page's "Technique" | What the page says of it | |
 * |---|---|---|
 * | `Surface Photogrammetry` | "Photogrammetry is used to create a highly accurate height map for the surface." | **kept** |
 * | `Photometric Stereo` | "Light from multiple angles is used to create a more accurate approximation of the height map for the surface." | **kept** |
 * | `Approximation` | "The height profile of the surface is approximated from the color." | refused |
 * | `Prodedural` (the site's spelling) | "Procedural/algorithmic techniques are used to create a surface." | refused |
 * | `Other/Unknown` | "(no description)" | refused |
 *
 * The two kept are MEASURED from a real surface. `Approximation` is refused
 * because the page does not say what approximates the height from the colour,
 * and until that is known it cannot be shown not to be a trained model — #1274
 * item 4. `Other/Unknown` is refused for the same reason, in the page's own
 * words. Both follow ADR 0049 D-2: a page that says "approximated" is read
 * until it is known which kind it is, and an asset whose making cannot be
 * established is treated as barred. `Prodedural` stays refused, and no longer
 * as a class: ADR 0049 D-2 rules that a deterministic tool run from committed
 * parameters is NOT AI-generated, and also that the test is how the asset was
 * made, not what its page calls it — the pull request that takes one shows
 * the making. The page's one sentence does not show it, and #1274 takes no
 * such asset, so adding the technique here is the work of the issue that does.
 *
 * ⚠️ **A list of what is kept, not of what is refused**, so a technique
 * ambientCG adds later is refused until somebody reads what it means.
 */
export const AMBIENTCG_TECHNIQUES_KEPT: readonly string[] = [
  'Surface Photogrammetry',
  'Photometric Stereo',
];

/**
 * One ambientCG asset — #1274: its id, the archive it is published in at
 * `attribute`, and the maps taken out of that archive.
 *
 * - **Its page** is `ambientcg.com/view?id=<id>`, the asset's own, which
 *   states the licence ({@link AMBIENTCG_PHRASE}), how the asset was made and
 *   which archives it is published in. {@link ambientCgVerdict} reads all three.
 * - **Its author** is recorded as ambientCG: the site publishes its own work,
 *   and an asset's page names no other author.
 */
function ambientCg(id: string, attribute: string, maps: readonly string[]): AssetSource {
  return {
    id,
    licencePage: `https://ambientcg.com/view?id=${id}`,
    licencePhrase: AMBIENTCG_PHRASE,
    licence: 'CC0-1.0',
    author: 'ambientCG',
    origin: { from: 'ambientcg', attribute, maps },
  };
}

/** An archive downloaded whole, and the files taken out of it. */
export interface ArchiveToRead {
  /** The archive's own file name: under `build/raw/<id>/`, and its path in the lock. */
  readonly name: string;
  readonly url: string;
  readonly members: readonly Pick<ArchiveMember, 'path' | 'mustContain'>[];
}

/**
 * The archive an ambientCG asset is published in, and the files taken out of
 * it — #1274. ambientCG names both by the asset's id and the attribute:
 * `Rock026_1K-JPG.zip` holds `Rock026_1K-JPG_Color.jpg`.
 *
 * ⚠️ **The archive is what the lock pins**, as it is for MakeHuman's pack
 * (#623): ambientCG publishes no digest of its own and serves the file through
 * a redirect, so the SHA-256 of the bytes that arrived is the only statement
 * of what they were. Measured on 2026-10-12: two downloads of
 * `Rock026_1K-JPG.zip`, minutes apart, were the same bytes.
 */
export function ambientCgArchive(source: AssetSource): ArchiveToRead {
  if (source.origin.from !== 'ambientcg') {
    throw new Error(`${source.id}: not an ambientCG asset`);
  }
  const { attribute, maps } = source.origin;
  const stem = `${source.id}_${attribute}`;
  const extension = (attribute.split('-')[1] ?? '').toLowerCase();
  return {
    name: `${stem}.zip`,
    url: `https://ambientcg.com/get?file=${stem}.zip`,
    members: maps.map((map) => ({ path: `${stem}_${map}.${extension}` })),
  };
}

/** The archive a source is read out of, where it is one: MakeHuman's pack, or an ambientCG asset. */
export function archiveOf(source: AssetSource): ArchiveToRead | undefined {
  if (source.origin.from === 'ambientcg') return ambientCgArchive(source);
  if (source.origin.from !== 'archive') return undefined;
  const { url, members } = source.origin;
  const path = new URL(url).pathname;
  return { name: path.slice(path.lastIndexOf('/') + 1), url, members };
}

/**
 * The techniques an ambientCG asset's page names: the text of each entry of
 * its "Technique" block (`<div id="techniques">`), in the page's order.
 */
export function ambientCgTechniques(pageHtml: string): readonly string[] {
  const block = /\bid="techniques"[^>]*>([\s\S]*?)(?=<div\b[^>]*\bid="|$)/i.exec(pageHtml);
  if (block === null) return [];
  return [...(block[1] ?? '').matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => (match[1] ?? '').replace(/\s+/g, ' ').trim())
    .filter((technique) => technique !== '');
}

/**
 * Whether an ambientCG asset may be kept, given the text of its OWN page —
 * #1274. Three things, none of which a marketplace label gives:
 *
 * 1. **The page is this asset's**: it offers the very archive the pipeline is
 *    about to download. A page that does not — the site's front page, another
 *    asset's, this asset at a size it is not published in — is refused, so
 *    another page's CC0 sentence cannot vouch for this file.
 * 2. **The page states the licence** — {@link licenceVerdict}'s own checks:
 *    the phrase, no NC, ND or SA term, no barred host.
 * 3. **The page says how the asset was made, and every technique it names is
 *    one {@link AMBIENTCG_TECHNIQUES_KEPT} lists.** A page that names none is
 *    refused too: not known is not the same as measured.
 */
export function ambientCgVerdict(source: AssetSource, pageHtml: string): LicenceVerdict {
  const archive = ambientCgArchive(source);
  if (!pageHtml.includes(`href="${archive.url}"`)) {
    return {
      kept: false,
      reason: `${source.id}: ${source.licencePage} does not offer ${archive.name} — it is not this asset's own page, or the asset is not published at that size`,
    };
  }
  const stated = statedLicence(source, pageHtml);
  if (!stated.kept) return stated;
  const techniques = ambientCgTechniques(pageHtml);
  if (techniques.length === 0) {
    return {
      kept: false,
      reason: `${source.id}: ${source.licencePage} does not say how the asset was made`,
    };
  }
  const refused = techniques.find((technique) => !AMBIENTCG_TECHNIQUES_KEPT.includes(technique));
  if (refused !== undefined) {
    return {
      kept: false,
      reason: `${source.id}: its page says it was made by "${refused}", which is not one of ${AMBIENTCG_TECHNIQUES_KEPT.join(', ')} — ADR 0026 D-4 bars AI-generated material, and only an asset measured from a real surface is taken (#1274)`,
    };
  }
  return { ...stated, technique: techniques.join(', ') };
}

/**
 * The photographic surfaces the realistic structures wear — #475, ADR 0026
 * D-12 layer 3 — each a Poly Haven CC0 texture: its id, and the file name Poly
 * Haven gives its 1K colour map (one of them spells it `diffuse`). How many
 * metres one repeat covers is `realistic-assets.ts`'s, beside the file names
 * the renderer loads.
 *
 * - `brick_wall_02` — a house and a row of shops;
 * - `clay_roof_tiles_02` — their roofs;
 * - `grey_roof_tiles_02` — a church's slate roof and spire;
 * - `old_stone_wall` — a church, its tower, and a dry-stone field wall;
 * - `dark_planks` — a barn's boards, a fence, a shopfront, a sign;
 * - `corrugated_iron` — a shed, and a barn's roof;
 * - `forest_leaves_02` — a hedge. ⚠️ Leaf litter photographed from above, the
 *   nearest thing to a clipped hedge any source in D-4 publishes; it is tinted
 *   greener in `three-renderer.ts`, and a hedge is the weakest of the nine.
 */
export const STRUCTURE_TEXTURES: readonly {
  readonly id: string;
  readonly colourFile: string;
}[] = [
  { id: 'brick_wall_02', colourFile: 'brick_wall_02_diff_1k.jpg' },
  { id: 'clay_roof_tiles_02', colourFile: 'clay_roof_tiles_02_diff_1k.jpg' },
  { id: 'grey_roof_tiles_02', colourFile: 'grey_roof_tiles_02_diff_1k.jpg' },
  { id: 'old_stone_wall', colourFile: 'old_stone_wall_diff_1k.jpg' },
  { id: 'dark_planks', colourFile: 'dark_planks_diff_1k.jpg' },
  { id: 'corrugated_iron', colourFile: 'corrugated_iron_diff_1k.jpg' },
  { id: 'forest_leaves_02', colourFile: 'forest_leaves_02_diffuse_1k.jpg' },
];

/**
 * The two surfaces the realistic ground blends into beside the grass — #627,
 * each a Poly Haven CC0 texture: its id, and its 1K colour map's file name.
 *
 * - `gravelly_sand` — the worn VERGE along the road's edge: earth and gravel
 *   where wheels and feet go and grass does not.
 * - `rocks_ground_05` — bare ROCK where the landform is steep, and SCREE above
 *   the tree line: stones on earth, which serves both, so the ground needs two
 *   new surfaces and not three (#627's "at most two").
 *
 * Downsized to {@link STRUCTURE_TEXTURE_PIXELS} by the same script as the
 * structures' maps, and encoded as KTX2: at 512 px the two pairs are about
 * 0.9 MB of build and 0.7 MiB estimated on the device, where the 1K pairs the
 * road and the grass wear would be about 3 MB of build — #627's ceiling.
 */
export const GROUND_BLEND_TEXTURES: readonly {
  readonly id: string;
  readonly colourFile: string;
}[] = [
  { id: 'gravelly_sand', colourFile: 'gravelly_sand_diff_1k.jpg' },
  { id: 'rocks_ground_05', colourFile: 'rocks_ground_05_diff_1k.jpg' },
];

/**
 * The ground surfaces taken from ambientCG — #1274, each one of its CC0
 * materials at 1K: its id, which is also the name its files carry.
 *
 * - `Rock026` — bare ROCK where the landform is steep: a fractured rock face,
 *   made by surface photogrammetry and published on 2019-10-24 (its own page,
 *   read 2026-10-12). Until #1274 a steep bank wore `rocks_ground_05`, which is
 *   loose stones on earth — scree, which a bank past the angle of repose is
 *   exactly not. That photograph keeps the scree above the tree line; this
 *   one takes the banks.
 *
 * ## ⚠️ Measured before it stayed, and the first one tried did not
 *
 * #1274 asks that each asset be measured before it stays. `Rock045`, a
 * weathered face with lichen on it, was fetched, locked, made and drawn first,
 * and read back **flatter than the grass beside it** in the browser gate's own
 * frame (`game-harness.ts` §`groundBlendProbe`, #627's measure): a contrast of
 * 0.0021 on the bank against 0.0017 to 0.0058 for level grass, where the
 * photograph it replaced read 0.0944 — so #627's own gate went red, rightly.
 * The ground's shader keeps a photograph's STRUCTURE and gives it the world's
 * colour, and a rider sees a bank from tens of metres away, where one pixel
 * covers 5 to 20 cm: a scan whose detail is all finer than that is a flat
 * slope. `Rock026`'s is fractured rock a metre across, and reads 0.0408 in the
 * same frame. A candidate for this table is screened the same way: its detail
 * has to survive a 20 cm footprint.
 *
 * Downsized to {@link STRUCTURE_TEXTURE_PIXELS} and encoded as KTX2 by the
 * same script and recipe as {@link GROUND_BLEND_TEXTURES}.
 */
export const AMBIENTCG_GROUND_TEXTURES: readonly { readonly id: string }[] = [{ id: 'Rock026' }];

/** The archive every {@link AMBIENTCG_GROUND_TEXTURES} entry is taken from, and the two maps taken. */
const AMBIENTCG_GROUND_ATTRIBUTE = '1K-JPG';
const AMBIENTCG_GROUND_MAPS = { colour: 'Color', normal: 'NormalGL' } as const;

/**
 * The bark and leaves the generated trees wear — #1283, ADR 0049 D-1: each an
 * ambientCG CC0 asset at 1K, taken through #1274's origin (its own page's
 * licence, its technique against {@link AMBIENTCG_TECHNIQUES_KEPT}, its
 * archive pinned by digest) — or, since #1294, a Poly Haven one
 * ({@link POLY_HAVEN_TREE_MAPS}). Which species wears which is
 * `generated-trees.ts` §`GENERATED_SPECIES`; this is the list of what to fetch,
 * derived from it so the two cannot disagree.
 *
 * - a **bark** gives its colour and normal maps;
 * - a **leaf atlas** gives its colour map, its opacity map — the cut-out each
 *   leaf is taken by — and its normal map.
 *
 * ⚠️ **ambientCG has no needles the pipeline may take**: read on 2026-10-12,
 * its two needle atlases (`LeafSet019`, `PineNeedles001`) are both made by
 * "Approximation", which {@link AMBIENTCG_TECHNIQUES_KEPT} refuses. A reviewer
 * who remembers this note ending "so the conifers stay the Poly Haven scans"
 * is reading #1283's file: the fir's needles are Poly Haven's since #1294.
 */
export const GENERATED_TREE_ATTRIBUTE = '1K-JPG';
export const GENERATED_BARK_MAPS = { colour: 'Color', normal: 'NormalGL' } as const;
export const GENERATED_LEAF_MAPS = {
  colour: 'Color',
  opacity: 'Opacity',
  normal: 'NormalGL',
} as const;

/**
 * The admitted sources a generated tree's bark and leaves may come from, as
 * ADR 0049 D-10 names them. D-1's body says "Bark and leaves come from
 * ambientCG", written to keep EZ-Tree's own bundled images out; its amendment
 * of 2026-10-12 records the owner's ruling that "needles and bark come from
 * Poly Haven" as well (#1294). Poly Haven was already on D-10's list for
 * photoscanned vegetation, so this is no new source. `admitted-sources.test.ts`
 * holds this list to the ADR and every worn asset's page to this list.
 */
export const GENERATED_TREE_WEARS: readonly string[] = ['ambientCG', 'Poly Haven'];

/** The size a Poly Haven map is taken at, as its API names it. */
export const POLY_HAVEN_TREE_RESOLUTION = '1k';

/**
 * The Poly Haven assets a generated tree wears, and which of each one's maps
 * are its bark and its leaf atlas, as `api.polyhaven.com/files/{id}` names
 * them — #1294. An asset named here is fetched from Poly Haven, through
 * {@link polyHavenFiles}; every other is ambientCG's.
 *
 * ## `fir_tree_01`, and why not `fir_sapling_medium`
 *
 * Both are Poly Haven CC0 models by Rob Tuytel (photography) and Rico Cilliers
 * (modeling), of the same collection, and both carry a twig atlas of the same
 * **seven photographed fir sprigs**. Read on 2026-10-12, byte for byte:
 *
 * | Map, 1K JPEG | `fir_sapling_medium` (`twigs_…`) | `fir_tree_01` (`twig_…`) |
 * |---|---|---|
 * | alpha | `1f0607dd…` | the same file |
 * | normal (`nor_gl`) | `d470dc39…` | the same file |
 * | colour (`diff`) | `db1113d3…`: black wherever the alpha is | `8c0833a1…`: the same sprigs, with green carried out from each needle's edge |
 *
 * `fir_tree_01` is taken for its colour map. A card is drawn several times
 * smaller than the atlas, so a card texel at a needle's edge averages needle
 * with background; over black that edge is a dark outline round every needle,
 * and over the needles' own green it is not. And taking it adds a source where
 * `fir_sapling_medium`'s alpha map would have changed an existing one: the
 * model's glTF does not include its alpha, so the scans' locked file list —
 * and with it the recorded input of eight committed files that do not read
 * it — would have moved.
 *
 * Its **bark** is the same asset's `bark_diff` and `bark_nor_gl`, which are
 * byte for byte `fir_sapling_medium`'s `branches_…` maps: the photographed
 * bark the scanned firs already wear.
 *
 * ## Four of the seven sprigs
 *
 * `generated-trees.ts` names each sprig by the rectangle it lies in. Measured
 * off the alpha map at half coverage on 2026-10-12: five sprigs stand upright,
 * two lean (at about 400, 300 and 510, 265 from the top left), and the
 * rectangle of the large upright one at the lower right (650 to 980 across,
 * 463 to 850 down) also holds 1 854 texels of the bare twig that crosses the
 * atlas's corner, so it is left out. The four named are the other upright
 * ones. What each one's rectangle holds beside its sprig: flecks of 1 to 22
 * texels that touch nothing, 105 texels in all, and in the third 23 texels of
 * the leaning sprig beside it — which a rectangle cannot leave out without
 * cutting the sprig it is for. The first is drawn 11 texels short on its right
 * so that its neighbour's tip is not in it, and loses 41 of its 25 109 texels.
 */
export const POLY_HAVEN_TREE_MAPS: Readonly<
  Record<
    string,
    {
      readonly bark: { readonly colour: string; readonly normal: string };
      readonly leaf: {
        readonly colour: string;
        readonly opacity: string;
        readonly normal: string;
      };
    }
  >
> = {
  fir_tree_01: {
    bark: { colour: 'bark_diff', normal: 'bark_nor_gl' },
    leaf: { colour: 'twig_diff', opacity: 'twig_alpha', normal: 'twig_nor_gl' },
  },
};

const wornAs = (part: 'bark' | 'sprig'): readonly string[] => [
  ...new Set(GENERATED_SPECIES.map((species) => species[part].source)),
];

/**
 * Every asset a generated tree wears, once each: ambientCG's barks, then its
 * leaf atlases, then Poly Haven's — one entry an asset, with its bark's maps
 * and its atlas's where one asset is both (#1294).
 */
export const GENERATED_TREE_TEXTURES: readonly {
  readonly id: string;
  readonly from: 'ambientcg' | 'polyhaven';
  readonly maps: readonly string[];
}[] = [
  ...wornAs('bark')
    .filter((id) => !(id in POLY_HAVEN_TREE_MAPS))
    .map((id) => ({
      id,
      from: 'ambientcg' as const,
      maps: Object.values(GENERATED_BARK_MAPS),
    })),
  ...wornAs('sprig')
    .filter((id) => !(id in POLY_HAVEN_TREE_MAPS))
    .map((id) => ({
      id,
      from: 'ambientcg' as const,
      maps: Object.values(GENERATED_LEAF_MAPS),
    })),
  ...Object.entries(POLY_HAVEN_TREE_MAPS)
    .map(([id, maps]) => ({
      id,
      from: 'polyhaven' as const,
      maps: [
        ...(wornAs('bark').includes(id) ? Object.values(maps.bark) : []),
        ...(wornAs('sprig').includes(id) ? Object.values(maps.leaf) : []),
      ],
    }))
    .filter((texture) => texture.maps.length > 0),
];

/**
 * Where the maps one species wears are, relative to the downloads' directory:
 * `<id>/<id>_1K-JPG_<map>.jpg`, the names ambientCG's archive gives them
 * ({@link ambientCgArchive}), or for a Poly Haven asset `<id>/<id>_<map>_1k.jpg`,
 * the name its API gives each file ({@link polyHavenFiles}).
 */
export function generatedTreeMaps(species: GeneratedSpecies): RunPaths {
  const ambient = (id: string, map: string): string =>
    `${id}/${id}_${GENERATED_TREE_ATTRIBUTE}_${map}.jpg`;
  const haven = (id: string, map: string): string =>
    `${id}/${id}_${map}_${POLY_HAVEN_TREE_RESOLUTION}.jpg`;
  const bark = POLY_HAVEN_TREE_MAPS[species.bark.source]?.bark;
  const leaf = POLY_HAVEN_TREE_MAPS[species.sprig.source]?.leaf;
  return {
    barkColour:
      bark === undefined
        ? ambient(species.bark.source, GENERATED_BARK_MAPS.colour)
        : haven(species.bark.source, bark.colour),
    barkNormal:
      bark === undefined
        ? ambient(species.bark.source, GENERATED_BARK_MAPS.normal)
        : haven(species.bark.source, bark.normal),
    leafColour:
      leaf === undefined
        ? ambient(species.sprig.source, GENERATED_LEAF_MAPS.colour)
        : haven(species.sprig.source, leaf.colour),
    leafOpacity:
      leaf === undefined
        ? ambient(species.sprig.source, GENERATED_LEAF_MAPS.opacity)
        : haven(species.sprig.source, leaf.opacity),
    leafNormal:
      leaf === undefined
        ? ambient(species.sprig.source, GENERATED_LEAF_MAPS.normal)
        : haven(species.sprig.source, leaf.normal),
  };
}

/** The side, in pixels, the pipeline downsizes a structure's maps to. */
export const STRUCTURE_TEXTURE_PIXELS = 512;

/**
 * The two committed maps of one structure texture, as `three-renderer.ts` and
 * `realistic-assets.ts` name them.
 */
export function structureMapFiles(id: string): {
  readonly colour: string;
  readonly normal: string;
} {
  return {
    colour: `${id}_diff_${String(STRUCTURE_TEXTURE_PIXELS)}.ktx2`,
    normal: `${id}_nor_gl_${String(STRUCTURE_TEXTURE_PIXELS)}.ktx2`,
  };
}

/**
 * The JPEG `process_texture.py` writes for one of {@link structureMapFiles} —
 * #618: the Blender step is unchanged and still writes the downsized JPEG it
 * always did, into the pipeline's scratch directory, and the committed file is
 * that JPEG encoded as KTX2.
 */
export function structureMapMade(file: string): string {
  return file.replace(/\.ktx2$/, '.jpg');
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
 * - {@link STRUCTURE_TEXTURES} — the structures' surfaces (#475, ADR 0026
 *   D-12 layer 3). ⚠️ **Surfaces, not buildings**: no source in D-4's list
 *   publishes a whole country building — Poly Haven's `buildings` category,
 *   read on 2026-09-22, is thirteen urban facade kits, gates and shutters, the
 *   facades at 118 000 to 175 000 triangles — so the structures are built from
 *   numbers in `three-renderer.ts` and wear these.
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
  ...STRUCTURE_TEXTURES.map((texture) =>
    polyHaven(texture.id, { type: 'texture', resolution: '1k', maps: ['Diffuse', 'nor_gl'] }),
  ),
  // #627: the ground's verge, rock and scree.
  ...GROUND_BLEND_TEXTURES.map((texture) =>
    polyHaven(texture.id, { type: 'texture', resolution: '1k', maps: ['Diffuse', 'nor_gl'] }),
  ),
  // #1274: the ground's bare rock, from ambientCG.
  ...AMBIENTCG_GROUND_TEXTURES.map((texture) =>
    ambientCg(texture.id, AMBIENTCG_GROUND_ATTRIBUTE, [
      AMBIENTCG_GROUND_MAPS.colour,
      AMBIENTCG_GROUND_MAPS.normal,
    ]),
  ),
  // #1283: the generated trees' bark and leaves, from ambientCG — and since
  // #1294 the fir's, from Poly Haven.
  ...GENERATED_TREE_TEXTURES.map((texture) =>
    texture.from === 'polyhaven'
      ? polyHaven(texture.id, {
          type: 'maps',
          resolution: POLY_HAVEN_TREE_RESOLUTION,
          maps: texture.maps,
        })
      : ambientCg(texture.id, GENERATED_TREE_ATTRIBUTE, texture.maps),
  ),
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
        // #623: the build's targets, from the same commit.
        ...RIDER_BUILD_TARGETS.map((name) => ({
          path: `targets/${name}`,
          url: `${MAKEHUMAN_RAW}/makehuman/data/targets/macrodetails/${name}`,
          mustContain: MAKEHUMAN_CC0_HEADER,
        })),
      ],
    },
  },
  {
    id: 'makehuman-system-assets',
    licencePage: SYSTEM_ASSETS_PAGE,
    licencePhrase: 'Makehuman system assets',
    licence: 'CC0-1.0',
    author: 'The MakeHuman team (makehuman_system)',
    origin: {
      from: 'archive',
      url: SYSTEM_ASSETS_ARCHIVE,
      members: [
        {
          path: 'skins/young_caucasian_male/young_lightskinned_male_diffuse.png',
          asset: { type: 'skins', name: 'young_caucasian_male' },
        },
        {
          path: 'skins/young_caucasian_male/young_caucasian_male.mhmat',
          asset: { type: 'skins', name: 'young_caucasian_male' },
          mustContain: MAKEHUMAN_CC0_HEADER,
        },
        {
          path: 'eyebrows/eyebrow001/eyebrow001.png',
          asset: { type: 'eyebrows', name: 'eyebrow001' },
        },
        {
          path: 'eyebrows/eyebrow001/eyebrow001.obj',
          asset: { type: 'eyebrows', name: 'eyebrow001' },
          mustContain: MAKEHUMAN_CC0_HEADER,
        },
        {
          path: 'eyebrows/eyebrow001/eyebrow001.mhclo',
          asset: { type: 'eyebrows', name: 'eyebrow001' },
          mustContain: MAKEHUMAN_CC0_HEADER,
        },
        {
          path: 'eyebrows/eyebrow001/eyebrow001.mhmat',
          asset: { type: 'eyebrows', name: 'eyebrow001' },
          mustContain: MAKEHUMAN_CC0_HEADER,
        },
      ],
    },
  },
];

/** The Blender version every derived asset was made with, and the one a re-run must use. */
export const PINNED_BLENDER = 'Blender 4.4.3';

/**
 * The tree generator every generated tree was made with, and the one a re-run
 * must use — #1283, ADR 0049 D-1: **EZ-Tree 1.1.0**, MIT, by Daniel Greenheck,
 * the release ADR 0049 read (published 2026-01-15).
 *
 * ⚠️ **A tool, never a dependency of the product**, as Blender and
 * KTX-Software are (ADR 0026 D-5): it is a `devDependency` of this app at
 * exactly this version, `ez-tree.ts` is the one module that loads it and
 * refuses any other, and nothing under `src/` imports it. What it writes is
 * this repository's own work, dedicated `CC0-1.0` (ADR 0049 D-1); the MIT
 * licence is the tool's.
 *
 * ⚠️ **three.js is part of the pin.** EZ-Tree places every limb with three's
 * own vectors, Euler angles and quaternions (its `peerDependency`), so the
 * numbers it makes are those of the `three` this app pins too —
 * {@link EZ_TREE_THREE}. A bump of either moves `generated-trees.ts`
 * §`GENERATED_TREES`' digests or does not, and `generated-trees.test.ts` says
 * which before anything is committed.
 */
export const EZ_TREE_VERSION = '1.1.0';

/** The generator as a record names it: its name and {@link EZ_TREE_VERSION}. */
export const PINNED_EZ_TREE = `EZ-Tree ${EZ_TREE_VERSION}`;

/** The npm package {@link PINNED_EZ_TREE} is installed as. */
export const EZ_TREE_PACKAGE = '@dgreenheck/ez-tree';

/** The `three` release {@link PINNED_EZ_TREE} computed the committed trees with. */
export const EZ_TREE_THREE = '0.185.1';

/**
 * The KTX-Software release every KTX2 file was encoded with, and the one a
 * re-run must use — #618, ADR 0026 D-8 and its 2026-09-27 amendment.
 *
 * ⚠️ **A tool, never a dependency**, exactly as Blender is (D-5): nothing in
 * the product or in CI runs it, and its output is committed with a digest.
 * KTX-Software is **Apache-2.0** (its own `LICENSE.md`, read 2026-09-27, and
 * the licence the notarised macOS installer shows), and like Blender's GPL its
 * licence does not reach what it writes.
 *
 * ⚠️ **Pinned to one release and a different one is refused**, because a
 * different encoder makes different blocks and the committed bytes would then
 * describe a run nobody can repeat. `ktx create` at this version, with
 * `--threads 1`, was measured byte-stable across two runs on 2026-09-27 — for
 * Basis ETC1S and for UASTC with Zstandard alike — so `--check` compares the
 * KTX2 files byte for byte like every other derived file, and D-5's fallback
 * (a digest over decoded texels) is not needed.
 *
 * How it was installed on the machine that made the committed files, so it can
 * be installed again: the release's own macOS package,
 * `KTX-Software-4.4.2-Darwin-arm64.pkg`, SHA-256
 * `500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c`,
 * notarised and signed "Developer ID Installer: The Khronos Group, Inc.
 * (TD2656HYNK)", expanded with `pkgutil --expand-full` rather than installed,
 * and `ktx` run from there with `libktx.4.dylib` beside it in `../lib` — the
 * binary's own `@executable_path/../lib` rpath. `KTX` names the binary; the
 * default is `ktx` on the `PATH`, which is where the package installs it.
 */
export const PINNED_KTX = 'KTX-Software v4.4.2';

/** What `ktx --version` prints at {@link PINNED_KTX}, the whole line. */
export const PINNED_KTX_VERSION_LINE = 'ktx version: v4.4.2';

/**
 * How a picture is encoded as KTX2 — #618.
 *
 * - `colour` — a colour map with no alpha: **Basis Universal ETC1S**, sRGB.
 *   On the tablet three's `KTX2Loader` transcodes ETC1S to **ETC2 RGB**, half
 *   a byte a texel; the photographs are what the owner looked at already,
 *   and ETC1S is what spike 0015's Godot build drew them as, ETC2.
 * - `colour-alpha` — a colour map whose alpha is a cut-out (a leaf card, an
 *   impostor strip): ETC1S with its alpha slice, which transcodes to **ETC2
 *   RGBA**, a byte a texel.
 * - `normal` — a tangent-space normal map: **UASTC**, linear, with Zstandard,
 *   which transcodes to **ASTC 4×4** where the device has it, a byte a texel.
 *   UASTC rather than ETC1S because ETC1S's shared endpoints band a normal
 *   map's smooth gradients, which is the one map where banding is lighting.
 *   ⚠️ **Three channels, not the encoder's `--normal-mode`**: that mode stores
 *   X and Y in RGB and A and needs a shader to rebuild Z, and three's
 *   `normalMap` reads RGB. Nothing here changes a shader.
 * - `data` — a map that is neither colour nor a normal: the realistic
 *   bicycle's roughness maps (#624). Encoded exactly as a normal map is —
 *   UASTC, linear, with Zstandard — because what it holds is a number per
 *   texel that three reads raw, and ETC1S's shared endpoints band a smooth
 *   one. Its own name so that a row says what the map IS.
 */
export type TextureEncoding = 'colour' | 'colour-alpha' | 'normal' | 'data';

/**
 * Which corner of the picture a texture coordinate of (0, 0) names.
 *
 * ⚠️ **three cannot flip a compressed texture** — `flipY` is refused for one —
 * so a picture that was loaded with `TextureLoader`, whose `flipY` is `true`,
 * is encoded with its rows reversed (`bottom-left`), which puts every texel
 * at the texture coordinate it had before. A glTF's own maps are read
 * unflipped by `GLTFLoader` and are encoded as they are (`top-left`).
 */
export type TextureOrigin = 'top-left' | 'bottom-left';

/** One picture encoded as KTX2. */
export interface Ktx2Step {
  readonly encoding: TextureEncoding;
  readonly origin: TextureOrigin;
}

/**
 * The `ktx create` arguments for one encoding — the whole recipe, so that the
 * committed bytes follow from this table and the pinned tool alone.
 *
 * - `--threads 1` — measured byte-stable at it (see {@link PINNED_KTX}).
 * - `--generate-mipmap` — the full chain, made by the encoder: three cannot
 *   generate mipmaps for a compressed texture, and a texture sampled with a
 *   mipmapped filter and no chain is incomplete and draws black.
 * - `--fail-on-color-conversions` — a colour map is taken as the sRGB it is,
 *   and a normal map is ASSIGNED linear rather than converted, so a picture
 *   the encoder wanted to convert is a refusal rather than a quietly
 *   different map.
 * - ETC1S at `--clevel 4 --qlevel 255`, the encoder's best quality short of
 *   its slowest level; UASTC at `--uastc-quality 2` with `--zstd 18`.
 */
export function ktxCreateArguments(
  step: Ktx2Step,
  input: string,
  output: string,
): readonly string[] {
  const encoded =
    step.encoding === 'normal' || step.encoding === 'data'
      ? [
          '--format',
          'R8G8B8_UNORM',
          '--assign-tf',
          'linear',
          '--encode',
          'uastc',
          '--uastc-quality',
          '2',
          '--zstd',
          '18',
        ]
      : [
          '--format',
          step.encoding === 'colour-alpha' ? 'R8G8B8A8_SRGB' : 'R8G8B8_SRGB',
          '--encode',
          'basis-lz',
          '--clevel',
          '4',
          '--qlevel',
          '255',
        ];
  return [
    'create',
    ...encoded,
    '--generate-mipmap',
    '--threads',
    '1',
    '--fail-on-color-conversions',
    ...(step.origin === 'bottom-left' ? ['--convert-texcoord-origin', 'bottom-left'] : []),
    input,
    output,
  ];
}

/** What {@link ktxCreateArguments} does, in words — the `modified` a record carries. */
export function encodingWords(step: Ktx2Step): string {
  const codec =
    step.encoding === 'normal' || step.encoding === 'data'
      ? 'Basis Universal UASTC with Zstandard, linear'
      : step.encoding === 'colour-alpha'
        ? 'Basis Universal ETC1S with alpha, sRGB'
        : 'Basis Universal ETC1S, sRGB';
  const flipped =
    step.origin === 'bottom-left'
      ? ', its rows reversed so that it samples as the upright picture did'
      : '';
  return `encoded as KTX2 (${codec}, with its full mipmap chain${flipped}) by ${PINNED_KTX}`;
}

/** What encoding a GLB's embedded maps does, in words — `encode-ktx2.ts` §`embeddedImages` chooses each map's encoding. */
export const GLB_IMAGES_WORDS = `its embedded maps encoded as KTX2 (KHR_texture_basisu) by ${PINNED_KTX} — colour maps as Basis Universal ETC1S, with alpha where the map has it, and normal maps as UASTC with Zstandard, each with its full mipmap chain`;

/** Where {@link OutputRecipe} `ktx2` recipes' encoder step lives — #618. */
export const KTX2_SCRIPT = 'encode-ktx2.ts';

/** Where the pipeline's scripts are, relative to the repository — what a row's `script` begins with. */
export const PIPELINE_DIRECTORY = 'apps/web/tools/realistic/';

/** The encoder's script as a two-step row's `modified` names it — #618's review. */
export const KTX2_SCRIPT_PATH = `${PIPELINE_DIRECTORY}${KTX2_SCRIPT}`;

/** What a two-step row's `modified` ends with, before {@link KTX2_SCRIPT_PATH}. */
export const KTX2_STEP_WORDS = '; the KTX2 step is made by ';

/** Where the product's realistic files are committed, repository-relative. */
export const OUTPUT_DIRECTORY = 'apps/web/public/realistic';

/** How one shipped file is made. */
export type OutputRecipe =
  /** Copied byte for byte: its `source` and `sha256` describe the same file. */
  | { readonly how: 'verbatim'; readonly file: string }
  /**
   * An upstream picture encoded as KTX2 by {@link KTX2_SCRIPT} — #618. The
   * road's and the ground's maps, which were committed verbatim until then.
   */
  | { readonly how: 'ktx2'; readonly file: string; readonly ktx2: Ktx2Step }
  /**
   * A map this repository DRAWS — #624: {@link DRAW_SCRIPT} draws its pixels
   * from arithmetic and {@link KTX2_SCRIPT} encodes them. There is no upstream
   * input and nothing in the lock; the picture the encoder reads is the input,
   * and its digest is the row's `inputsha256`.
   */
  | { readonly how: 'drawn'; readonly map: RealisticBicycleMap; readonly ktx2: Ktx2Step }
  /**
   * The game's wordmark — #966: the owner's committed artwork, keyed and
   * resampled by {@link WORDMARK_SCRIPT} and encoded by {@link KTX2_SCRIPT}.
   * Nothing is in the lock: the input is a file committed in this repository,
   * and the picture the encoder reads is its row's `inputsha256`.
   */
  | { readonly how: 'wordmark'; readonly ktx2: Ktx2Step }
  /** Made by a Blender script: {@link inputDigest} of the source's locked files is its input. */
  | {
      readonly how: 'blender';
      readonly script: string;
      /** The arguments after the input and output paths — which object, what budget. */
      readonly args: readonly string[];
      /**
       * The name the script writes, where the shipped file is not what it
       * writes but that file encoded as KTX2 (#618) — with {@link ktx2}.
       */
      readonly made?: string;
      /** How {@link made} becomes the shipped file. */
      readonly ktx2?: Ktx2Step;
      /**
       * Whether the GLB the script writes has its embedded maps encoded as
       * KTX2 (`KHR_texture_basisu`) before it ships — #618. A GLB with no
       * maps (a tree's middle level, the rider) is shipped as Blender wrote it.
       */
      readonly images?: 'ktx2';
      /** The other files the same run writes, beside {@link OutputSpec.file}. */
      readonly alsoWrites?: readonly AlsoWritten[];
      /**
       * Other sources the run reads, beside {@link OutputSpec.from} — #623:
       * their `build/raw/` directories follow the recipe's own arguments, and
       * their files are in every output's input digest.
       */
      readonly alsoReads?: readonly string[];
      /**
       * #623: the app's mark, drawn by `tools/icons/generate-icons.ts`
       * §`drawMark` at this many pixels and handed to the run as a PNG, last.
       */
      readonly mark?: number;
    }
  /**
   * One level of a GENERATED tree — #1283, ADR 0049 D-1: `generated-trees.ts`
   * makes its geometry with the pinned {@link PINNED_EZ_TREE} from the tree's
   * committed seed and parameters, and {@link GENERATED_TREE_SCRIPT} dresses
   * it in its species' bark and leaves, bakes its occlusion and, for a full
   * level, renders its impostor. Its input is {@link generatedInputDigest}.
   */
  | {
      readonly how: 'generated';
      /** Which of `generated-trees.ts` §`GENERATED_TREES`. */
      readonly tree: string;
      readonly level: GeneratedLevel;
      /** Whether the GLB's embedded maps are encoded as KTX2 before it ships. */
      readonly images?: 'ktx2';
      /** The impostor strips a full level's run writes. */
      readonly alsoWrites?: readonly AlsoWritten[];
    };

/** The other files a recipe's run writes beside its own: a tree's strips, the rider's maps. */
export function alsoWritten(recipe: OutputRecipe): readonly AlsoWritten[] {
  return recipe.how === 'blender' || recipe.how === 'generated' ? (recipe.alsoWrites ?? []) : [];
}

/**
 * A second file a Blender run writes — a tree's impostor strip — and, since
 * #618, what it ships as: {@link made} is the PNG the script writes, and
 * {@link file} is that PNG encoded as KTX2.
 */
export interface AlsoWritten {
  readonly file: string;
  readonly made: string;
  readonly ktx2: Ktx2Step;
  /** What it is, in words, where it is not a tree's impostor strip — #623. */
  readonly modified?: string;
}

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

/** The script that dresses and exports a generated tree — #1283. */
export const GENERATED_TREE_SCRIPT = 'blender/process_generated_tree.py';

/** Where the generated trees' numbers are, repository-relative. */
export const GENERATED_TREES_PATH = `${PIPELINE_DIRECTORY}generated-trees.ts`;

/**
 * What a generated output's {@link OutputSpec.from} names: no single
 * {@link SOURCES} entry, because the tree is this repository's own work and
 * the assets it wears are named by its species.
 */
export const GENERATED_FROM = 'this repository, generated';

/**
 * The tools a generated tree is made with, in order: the generator on the
 * `three` it computes with, under the repository's own Node, then Blender.
 */
export const GENERATED_TOOL = `${PINNED_EZ_TREE} on three ${EZ_TREE_THREE} under Node.js 24 (.nvmrc), then ${PINNED_BLENDER}`;

/**
 * How an impostor strip is encoded — #618: ETC1S with its alpha, because the
 * strip is a cut-out; and flipped, because `TextureLoader` read the PNG with
 * `flipY` and the shader's `vStripUv` was written against that.
 */
const IMPOSTOR_KTX2: Ktx2Step = { encoding: 'colour-alpha', origin: 'bottom-left' };

/**
 * How an impostor's NORMAL strip is encoded — #630: as a normal map is (UASTC,
 * linear), and flipped for the colour strip's reason, so the two strips' texels
 * line up under one texture coordinate.
 */
const IMPOSTOR_NORMALS_KTX2: Ktx2Step = { encoding: 'normal', origin: 'bottom-left' };

/** Where a drawn map's script lives — #624. @see OutputRecipe */
export const DRAW_SCRIPT = 'draw-bicycle-maps.ts';

/**
 * What a drawn map's {@link OutputSpec.from} names: no {@link SOURCES} entry,
 * because nothing was downloaded — #624.
 */
export const DRAWN_FROM = 'this repository';

/** The tools a drawn map is made with: the drawing runs under the repository's own Node. */
export const DRAWN_TOOL = `Node.js 24 (.nvmrc), then ${PINNED_KTX}`;

/** The date #624's maps were drawn and dedicated — a drawn row's `read`. */
export const DRAWN_ON = '2026-09-27';

/** What a wordmark output's {@link OutputSpec.from} names — #966: the owner's committed artwork. */
export const WORDMARK_FROM = 'the owner';

/** The tools the wordmark is made with: the keying runs under the repository's own Node. */
export const WORDMARK_TOOL = `Node.js 24 (.nvmrc), then ${PINNED_KTX}`;

/**
 * How the wordmark is encoded — #966: ETC1S with its alpha, because the
 * lettering is a cut-out over the board; and flipped, because the stylised
 * world's PNG is read by `TextureLoader` with `flipY`, and the two worlds'
 * boards share one set of texture coordinates (`logo-board.ts`).
 */
const WORDMARK_KTX2: Ktx2Step = { encoding: 'colour-alpha', origin: 'bottom-left' };

/**
 * What `realistic:process --check` requires of a run's REPORT, as well as of
 * its bytes — #900 item 2, by output file.
 *
 * `island_tree_02`'s scan repeats one triangle, and #696 made the importer
 * drop the same copy every run (`blender/gltf_import.py`). Only about one run
 * in fifty kept the other copy before that, so comparing the files alone
 * passed about 98 % of the time with #696's fix removed. The report says how
 * many repeated triangles were dropped, and a count that is not the one the
 * committed files were made with is a run that did not reproduce them.
 */
export const EXPECTED_REPORTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'island_tree_02.glb': { repeatedTrianglesDropped: 1 },
  'island_tree_02-middle.glb': { repeatedTrianglesDropped: 1 },
};

/** Why a run's report is not what {@link EXPECTED_REPORTS} requires of `file`, or nothing. */
export function reportFaults(file: string, report: unknown): readonly string[] {
  const expected = EXPECTED_REPORTS[file];
  if (expected === undefined) return [];
  const fields = typeof report === 'object' && report !== null ? report : {};
  return Object.entries(expected).flatMap(([field, value]) => {
    const said = (fields as Readonly<Record<string, unknown>>)[field];
    return said === value
      ? []
      : [
          `${file}: its report says ${field} ${JSON.stringify(said) ?? 'nothing'}, not ${String(value)}`,
        ];
  });
}

/** The rider's script, and the one file its kit's numbers are in — #623. */
export const RIDER_SCRIPT = 'blender/process_rider.py';
export const RIDER_KIT = `${PIPELINE_DIRECTORY}blender/rider_kit.py`;
/** The side of each of the rider's three maps, in texels — #623. */
export const RIDER_TEXTURE_PIXELS = 1024;
/** The side of the mark's picture `process_rider.py` samples. */
export const RIDER_MARK_PIXELS = 256;
/** The PNGs the rider's run writes, which the encoder turns into {@link REALISTIC_RIDER_MAPS}. */
export const RIDER_MADE = {
  colour: 'rider_kit_colour.png',
  normal: 'rider_nor_gl.png',
  orm: 'rider_orm.png',
} as const;

/** Where {@link structureMap}'s script lives — #475. */
export const TEXTURE_SCRIPT = 'blender/process_texture.py';

/**
 * Every shipped file, in the order the pipeline makes them.
 *
 * ⚠️ **The budgets in the arguments are the D-6 constants' numbers, not a
 * second copy of them**: `apps/web/src/game/realistic-budget.test.ts` reads each
 * output's triangles and texture sizes back off the committed bytes and holds
 * them to `realistic-budget.ts`, so a recipe that asked for more fails there.
 */
export const OUTPUTS: readonly OutputSpec[] = [
  // ⚠️ The sky stays the upstream HDR, at half-float, on purpose — #618 left it
  // out of scope: `PMREMGenerator` prefilters it, and a compressed HDR sky is
  // its own issue (#615 §"Deliberately not filed").
  { file: 'farm_field_2k.hdr', from: 'farm_field', recipe: verbatim('farm_field_2k.hdr') },
  // #618: the road's and the ground's maps, which were the upstream JPEGs
  // committed verbatim, are those JPEGs encoded as KTX2.
  ...['asphalt_02', 'sparse_grass'].flatMap((id) =>
    ['diff', 'nor_gl'].map((map): OutputSpec => {
      const upstream = `${id}_${map}_1k.jpg`;
      const ktx2: Ktx2Step = {
        encoding: map === 'diff' ? 'colour' : 'normal',
        origin: 'bottom-left',
      };
      return {
        file: `${id}_${map}_1k.ktx2`,
        from: id,
        recipe: { how: 'ktx2', file: upstream, ktx2 },
        modified: `one map of the texture (${upstream}), ${encodingWords(ktx2)}`,
      };
    }),
  ),
  tree('island_tree_02', 'island_tree_02', 'island_tree_02', '28000'),
  tree('tree_small_02', 'tree_small_02', 'tree_small_02', '28000'),
  tree('fir_sapling_medium_a', 'fir_sapling_medium', 'fir_sapling_medium_a', '24000'),
  tree('fir_sapling_medium_b', 'fir_sapling_medium', 'fir_sapling_medium_b', '24000'),
  // #617: each tree's middle level of detail, from the same pinned input.
  middle('island_tree_02', 'island_tree_02', 'island_tree_02', '6000'),
  middle('tree_small_02', 'tree_small_02', 'tree_small_02', '6000'),
  middle('fir_sapling_medium_a', 'fir_sapling_medium', 'fir_sapling_medium_a', '6000'),
  middle('fir_sapling_medium_b', 'fir_sapling_medium', 'fir_sapling_medium_b', '6000'),
  // #1283: the generated trees, each a full level with its strips and a middle level.
  ...GENERATED_TREES.flatMap((tree) => [generatedFull(tree), generatedMiddle(tree)]),
  plant('shrub_02_a', 'shrub_02', 'shrub_02_a', '6000'),
  plant('shrub_02_c', 'shrub_02', 'shrub_02_c', '6000'),
  {
    file: 'boulder_01.glb',
    from: 'boulder_01',
    recipe: {
      how: 'blender',
      script: 'blender/process_rock.py',
      args: ['boulder_01', '2400'],
      images: 'ktx2',
    },
    modified:
      'collapse-decimated from 66 122 to about 2 400 triangles, its colour and normal maps downsized to 512 px and its roughness map dropped; stood on its base; ambient occlusion baked into a vertex colour against a ground plane',
  },
  ...[...STRUCTURE_TEXTURES, ...GROUND_BLEND_TEXTURES].flatMap((texture) => {
    const made = structureMapFiles(texture.id);
    return [
      structureMap(made.colour, texture.id, texture.colourFile, 'colour'),
      structureMap(made.normal, texture.id, `${texture.id}_nor_gl_1k.jpg`, 'data'),
    ];
  }),
  // #1274: ambientCG's, by the same recipe — its files carry its own names.
  ...AMBIENTCG_GROUND_TEXTURES.flatMap((texture) => {
    const made = structureMapFiles(texture.id);
    const upstream = (map: string): string =>
      `${texture.id}_${AMBIENTCG_GROUND_ATTRIBUTE}_${map}.jpg`;
    return [
      structureMap(made.colour, texture.id, upstream(AMBIENTCG_GROUND_MAPS.colour), 'colour'),
      structureMap(made.normal, texture.id, upstream(AMBIENTCG_GROUND_MAPS.normal), 'data'),
    ];
  }),
  {
    file: REALISTIC_RIDER,
    from: 'makehuman',
    recipe: {
      how: 'blender',
      script: RIDER_SCRIPT,
      args: [
        '9000',
        String(RIDER_TEXTURE_PIXELS),
        RIDER_MADE.colour,
        RIDER_MADE.normal,
        RIDER_MADE.orm,
      ],
      alsoReads: ['makehuman-system-assets'],
      mark: RIDER_MARK_PIXELS,
      alsoWrites: [
        {
          file: REALISTIC_RIDER_MAPS.colour,
          made: RIDER_MADE.colour,
          ktx2: { encoding: 'colour', origin: 'top-left' },
          modified: `the On Your Left house kit's colour map, drawn by ${PIPELINE_DIRECTORY}${RIDER_SCRIPT} from the numbers in ${RIDER_KIT} onto the rider's own texture coordinates — jersey panels (black where the kit's main colour is, which the renderer adds from the occlusion map's blue channel), seams, a zip, cuffs, bib shorts, grippers, socks and shoes, and this app's own two-chevron mark from apps/web/tools/icons/generate-icons.ts, with no text and no other mark — and the skin: MakeHuman's CC0 system skin young_caucasian_male's detail divided by its own mean, on the rider's existing tone, flat round the eyes, with MakeHuman's CC0 eyebrow001 laid on through its own fit. The kit is this repository's own design, derived from no other product (ADR 0009) and dedicated CC0-1.0 as the app icons are (ADR 0024 D-5)`,
        },
        {
          file: REALISTIC_RIDER_MAPS.normal,
          made: RIDER_MADE.normal,
          ktx2: { encoding: 'normal', origin: 'top-left' },
          modified: `a tangent-space normal map baked by Cycles on one thread from the full-resolution body onto the decimated one's texture coordinates, with the kit's relief (seams, zip, bib straps, pockets, cuffs, chamois, shoe straps) and procedural folds at the hip, knee, elbow and shoulder added from the numbers in ${RIDER_KIT}; no cloth simulation`,
        },
        {
          file: REALISTIC_RIDER_MAPS.orm,
          made: RIDER_MADE.orm,
          ktx2: { encoding: 'data', origin: 'top-left' },
          modified: `ambient occlusion baked by Cycles on one thread from the full-resolution body with the helmet in the scene (red), each garment's and the skin's roughness (green) and how much of the renderer's main kit colour each texel is, premultiplied (blue), drawn by ${PIPELINE_DIRECTORY}${RIDER_SCRIPT} from the numbers in ${RIDER_KIT}`,
        },
      ],
    },
    modified:
      'the body mesh only, in an athletic, lean build — MakeHuman’s own macro targets at its default gender, age and ethnic mix with muscle at 85 % and weight at 25 % — its skeleton reduced from 163 bones to 24 with each dropped bone’s weights merged into its nearest kept ancestor, smooth-shaded, collapse-decimated to what a modelled helmet and glasses leave of 9 000 triangles, with texture coordinates and tangents and no colour of its own; and the helmet (a plain shell with vents and straps) and glasses built round the head’s own vertices, one mesh coloured per vertex; in its rest pose',
  },
  // #624: the bicycle's four maps, drawn here. ⚠️ `top-left`: they are drawn
  // in the orientation the bicycle's texture coordinates read them — row 0 is
  // v = 0 (`src/game/bicycle-surfaces.ts` §`bandV`) — and never went through
  // `TextureLoader`, so nothing is flipped.
  ...REALISTIC_BICYCLE_MAP_NAMES.map((map): OutputSpec => {
    const ktx2: Ktx2Step = { encoding: BICYCLE_MAP_KINDS[map], origin: 'top-left' };
    return {
      file: REALISTIC_BICYCLE_MAPS[map],
      from: DRAWN_FROM,
      recipe: { how: 'drawn', map, ktx2 },
      modified: `${BICYCLE_MAP_WORDS[map]}; then ${encodingWords(ktx2)}${KTX2_STEP_WORDS}${KTX2_SCRIPT_PATH}`,
    };
  }),
  // #966: the game's wordmark, made from the owner's committed artwork.
  {
    file: REALISTIC_WORDMARK,
    from: WORDMARK_FROM,
    recipe: { how: 'wordmark', ktx2: WORDMARK_KTX2 },
    modified: `${WORDMARK_MODIFIED_WORDS}; then ${encodingWords(WORDMARK_KTX2)}${KTX2_STEP_WORDS}${KTX2_SCRIPT_PATH}`,
  },
];

/** The digest of the pixels a drawn map's encoder reads — its row's `inputsha256`. */
export function drawnDigest(map: RealisticBicycleMap): string {
  return pixelDigest(drawBicycleMap(map));
}

/**
 * One structure map: a Poly Haven 1K map downsized — #475 — and since #618
 * encoded as KTX2. The Blender step writes the JPEG it always wrote
 * ({@link structureMapMade}), into the pipeline's scratch directory.
 */
function structureMap(
  file: string,
  from: string,
  mapFile: string,
  kind: 'colour' | 'data',
): OutputSpec {
  const ktx2: Ktx2Step = {
    encoding: kind === 'colour' ? 'colour' : 'normal',
    origin: 'bottom-left',
  };
  return {
    file,
    from,
    recipe: {
      how: 'blender',
      script: TEXTURE_SCRIPT,
      args: [mapFile, String(STRUCTURE_TEXTURE_PIXELS), kind],
      made: structureMapMade(file),
      ktx2,
    },
    modified: `one map of the texture (${mapFile}), downsized from 1024 to ${String(STRUCTURE_TEXTURE_PIXELS)} px and re-encoded as JPEG; then ${encodingWords(ktx2)}`,
  };
}

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
      images: 'ktx2',
      alsoWrites: [
        {
          file: `${name}-impostor.ktx2`,
          made: `${name}-impostor.png`,
          ktx2: IMPOSTOR_KTX2,
        },
        // #630: the same eight views' normals, so the runtime lights the far
        // band by the world's sun rather than by the script's.
        {
          file: `${name}-impostor-normals.ktx2`,
          made: `${name}-impostor-normals.png`,
          ktx2: IMPOSTOR_NORMALS_KTX2,
          modified: `the eight views of the full scan the impostor strip is rendered from, as NORMALS: Cycles' normal pass on one thread, in the plant's own frame in three's axes (x across, y up, z the model's front), encoded n * 0.5 + 0.5 with the background the zero vector`,
        },
      ],
    },
    modified: `one object of the pack (${object}); foliage thinned by whole cards and each survivor grown, wood collapse-decimated, textures downsized to 512 px and roughness maps dropped, ambient occlusion baked into a vertex colour; an eight-view impostor strip rendered from the full scan before any of that; then ${GLB_IMAGES_WORDS}`,
  };
}

/**
 * A tree's middle level of detail — #617. The same script on the same pinned
 * input as {@link tree}, a second time at a lower budget, with no impostor and
 * **no images**: the runtime pairs each part with the near file's part of the
 * same material name and wears that part's maps, so the level costs no texture
 * memory and no second copy of a map in the build. Its cards are thinned from
 * the same seeded order as the near file's, so it keeps a subset of them.
 */
function middle(name: string, from: string, object: string, triangles: string): OutputSpec {
  return {
    file: `${name}-middle.glb`,
    from,
    recipe: {
      how: 'blender',
      script: TREE_SCRIPT,
      args: [object, triangles, 'none', 'auto', 'nomaps'],
    },
    modified: `one object of the pack (${object}), as the tree's middle level of detail: foliage thinned by whole cards and each survivor grown, wood collapse-decimated or, where that stalls, thinned by whole pieces with the largest kept, to at most ${triangles} triangles in all; ambient occlusion baked into a vertex colour, and every image dropped — it wears the near file's maps`,
  };
}

/** A generated tree's full level, with the impostor strips its run renders — #1283. */
function generatedFull(tree: GeneratedTree): OutputSpec {
  const species = speciesOf(tree);
  const [frameW, frameH] = species.impostor.frame;
  const [normalW, normalH] = species.impostor.normalFrame;
  return {
    file: `${tree.name}.glb`,
    from: GENERATED_FROM,
    recipe: {
      how: 'generated',
      tree: tree.name,
      level: 'full',
      images: 'ktx2',
      alsoWrites: [
        {
          file: `${tree.name}-impostor.ktx2`,
          made: `${tree.name}-impostor.png`,
          ktx2: IMPOSTOR_KTX2,
          modified: `an eight-view impostor strip of the generated tree's full level, each view ${String(frameW)} by ${String(frameH)} px, rendered by Cycles on one thread before its maps are downsized`,
        },
        {
          file: `${tree.name}-impostor-normals.ktx2`,
          made: `${tree.name}-impostor-normals.png`,
          ktx2: IMPOSTOR_NORMALS_KTX2,
          modified: `the eight views of the generated tree's full level the impostor strip is rendered from, as NORMALS, each view ${String(normalW)} by ${String(normalH)} px: Cycles' normal pass on one thread, in the tree's own frame in three's axes (x across, y up, z the model's front), encoded n * 0.5 + 0.5 with the background the zero vector`,
        },
      ],
    },
    modified: `${species.words}, generated at the size wanted and neither decimated nor thinned: its wood and leaf cards are what ${PINNED_EZ_TREE} made from the seed ${String(tree.seed)} and the ${species.id} parameters in ${GENERATED_TREES_PATH}, scaled to metres; each leaf card ${'rects' in species.sprig ? `drawn from ${String(new Set(species.sprig.leaves.map((leaf) => leaf.cell)).size)} of ${species.sprig.source}'s photographed sprigs, each taken from its own rectangle of the twig atlas` : `a sprig drawn from ${species.sprig.source}'s scanned leaves`}, cut out by that atlas's own opacity map and toned by ${species.sprig.tone.join(', ')}, at ${String(species.sprig.pixels)} px with its normals at ${String(species.sprig.normalPixels)} px; ${species.bark.source}'s colour and normal maps downsized to ${String(species.bark.pixels)} px and its other maps dropped; ambient occlusion baked into a vertex colour; then ${GLB_IMAGES_WORDS}`,
  };
}

/** A generated tree's middle level: the same tree made again at a lower budget — #1283, #617. */
function generatedMiddle(tree: GeneratedTree): OutputSpec {
  const species = speciesOf(tree);
  return {
    file: `${tree.name}-middle.glb`,
    from: GENERATED_FROM,
    recipe: { how: 'generated', tree: tree.name, level: 'middle' },
    modified: `the same tree generated again as its middle level of detail, by ${PINNED_EZ_TREE} from the same seed ${String(tree.seed)} and ${species.id} parameters in ${GENERATED_TREES_PATH}: fewer sides round each branch, the wood deeper than level ${String(species.middle.deepestWood)} left out, and one leaf card in ${String(species.middle.leafEvery)} kept and enlarged ${String(species.middle.leafGrowth)} times about the point it grows from; ambient occlusion baked into a vertex colour, and no image — it wears the full level's maps`,
  };
}

/**
 * One digest for everything a generated tree was made from — #1283, ADR 0049
 * D-1: {@link inputDigest} over the geometry its seed and parameters make at
 * each level (`generated-trees.ts` §`geometryDigest`, named
 * `generated-trees.ts#<tree>.<level>`), the numbers of each level's run that
 * only Blender reads (§`runNumbersDigest`, named `…#<tree>.<level>.run`), and
 * every locked file of the assets it wears, each under its source's id. So a row moves when a parameter, the seed, the generator, or
 * either download does.
 *
 * ⚠️ **The `.run` lines are what make "a parameter" true.** The geometry
 * moves only for a number the GENERATOR reads. The sprig's shoots, its
 * atlas's grid and turn, its tone and every map's size are read by Blender
 * alone, and until #1289's review one of them could be edited with every
 * test green and stale files committed — CI has no Blender to run `--check`.
 * `species` is the tree's own unless a test hands it another.
 */
export function generatedInputDigest(
  tree: GeneratedTree,
  lock: InputLock,
  species: GeneratedSpecies = speciesOf(tree),
): string {
  const locked = (id: string): LockedSource => {
    const source = lock.sources.find((each) => each.id === id);
    if (source === undefined) throw new Error(`${tree.name}: ${id} is not in the lock`);
    return source;
  };
  return inputDigest([
    ...(['full', 'middle'] as const).flatMap((level) => [
      { path: `generated-trees.ts#${tree.name}.${level}`, sha256: tree.geometry[level] },
      {
        path: `generated-trees.ts#${tree.name}.${level}.run`,
        sha256: runNumbersDigest(tree, level, species),
      },
    ]),
    // Once each: the fir's bark and sprigs are one Poly Haven asset (#1294).
    ...[...new Set([species.bark.source, species.sprig.source])].flatMap((id) =>
      locked(id).files.map((file) => ({ path: `${id}/${file.path}`, sha256: file.sha256 })),
    ),
  ]);
}

/** A plant with no impostor: a shrub stands in the near field or not at all. */
function plant(name: string, from: string, object: string, triangles: string): OutputSpec {
  return {
    file: `${name}.glb`,
    from,
    recipe: {
      how: 'blender',
      script: TREE_SCRIPT,
      args: [object, triangles, 'none', 'all'],
      images: 'ktx2',
    },
    modified: `one object of the pack (${object}); foliage thinned by whole cards and each survivor grown, textures downsized to 512 px and roughness maps dropped, ambient occlusion baked into a vertex colour; then ${GLB_IMAGES_WORDS}`,
  };
}

/** Every file the pipeline writes into {@link OUTPUT_DIRECTORY}, impostors included. */
export function shippedFiles(): readonly string[] {
  return OUTPUTS.flatMap((output) => [
    output.file,
    ...alsoWritten(output.recipe).map((also) => also.file),
  ]);
}

/** Why a source was refused, or the evidence that it was not. */
export type LicenceVerdict =
  | {
      readonly kept: true;
      readonly licence: KeptLicence;
      readonly evidence: string;
      /** How the page says the asset was made, where the source says — #1274, ambientCG's. */
      readonly technique?: string;
    }
  | { readonly kept: false; readonly reason: string };

/**
 * Whether a source may be kept, given the text of its licence page.
 *
 * Refuses a barred host, a URL no admitted source owns ({@link admission}), a
 * page that does not carry the phrase, and — however
 * the phrase reads — a page that also names a non-commercial, no-derivatives or
 * share-alike term, because a page can carry the CC0 phrase for one file and a
 * stricter licence for the one being fetched. ADR 0026 D-4 excludes all three.
 *
 * ⚠️ **The one door, whatever the origin** — #1274: an ambientCG asset is held
 * to {@link ambientCgVerdict}, which asks all of this and more, from HERE, so
 * `fetch-assets.ts` cannot keep one on the general checks alone by calling the
 * wrong function.
 */
export function licenceVerdict(source: AssetSource, pageText: string): LicenceVerdict {
  return source.origin.from === 'ambientcg'
    ? ambientCgVerdict(source, pageText)
    : statedLicence(source, pageText);
}

/** {@link licenceVerdict}'s checks of the page's own words, which every origin shares. */
function statedLicence(source: AssetSource, pageText: string): LicenceVerdict {
  const asked: [string, 'licence' | 'file'][] = [
    [source.licencePage, 'licence'],
    ...fixedUrls(source).map((url): [string, 'file'] => [url, 'file']),
  ];
  for (const [url, as] of asked) {
    const verdict = admission(url, as);
    if (!verdict.admitted) return { kept: false, reason: `${source.id}: ${verdict.reason}` };
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
  if (source.origin.from === 'urls') return source.origin.files.map((file) => file.url);
  if (source.origin.from === 'archive') return [source.origin.url];
  if (source.origin.from === 'ambientcg') return [ambientCgArchive(source).url];
  return [];
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
    case 'maps':
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
  /**
   * How the source's own page said the asset was made, read with its licence —
   * #1274, for an ambientCG asset: {@link AMBIENTCG_TECHNIQUES_KEPT}.
   */
  readonly technique?: string;
  readonly files: readonly LockedFile[];
}

/**
 * Why a file that was just downloaded is not the one the lock records, or
 * nothing — the digest lock, ADR 0026 D-5, as one sentence `fetch-assets.ts`
 * throws: a file the lock does not name at all, or one whose SHA-256 is not
 * the one recorded. `--lock` is the only way past it, and that is a decision
 * to re-base the realistic world on new inputs.
 */
export function lockFault(
  id: string,
  path: string,
  sha256: string,
  locked: Pick<LockedSource, 'files'> | undefined,
): string | undefined {
  const was = locked?.files.find((each) => each.path === path);
  return was !== undefined && was.sha256 === sha256
    ? undefined
    : `${id}/${path}: not the input the lock records (${was?.sha256 ?? 'absent'}, got ${sha256}); run with --lock only if re-basing on new inputs is intended`;
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
 * {@link inputDigest} over several sources' files at once — #623, for a run
 * that reads more than one: each path is prefixed with its source's id, so a
 * file of one source cannot stand in for the same path in another.
 */
export function sourcesDigest(
  sources: readonly {
    readonly id: string;
    readonly files: readonly Pick<LockedFile, 'path' | 'sha256'>[];
  }[],
): string {
  return inputDigest(
    sources.flatMap((source) =>
      source.files.map((file) => ({ path: `${source.id}/${file.path}`, sha256: file.sha256 })),
    ),
  );
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
    (each) => each.file === file || alsoWritten(each.recipe).some((also) => also.file === file),
  );
  if (output === undefined) throw new Error(`${file}: no pipeline output makes it`);
  if (output.recipe.how === 'generated') return generatedRecord(file, output, lock, sha256);
  if (output.recipe.how === 'drawn') {
    return [
      ['path', `${OUTPUT_DIRECTORY}/${file}`],
      [
        'source',
        `This repository, #624 — drawn from arithmetic by ${PIPELINE_DIRECTORY}${DRAW_SCRIPT} for the realistic bicycle, at the sizes src/game/bicycle.ts states. Nothing was downloaded, traced, generated by a model or derived from another product's appearance (ADR 0009, ADR 0026 D-4)`,
      ],
      ['licence', 'CC0-1.0'],
      ['read', DRAWN_ON],
      ['sha256', sha256],
      ['modified', output.modified ?? ''],
      ['input', `${PIPELINE_DIRECTORY}${DRAW_SCRIPT}#${output.recipe.map}`],
      ['inputsha256', drawnDigest(output.recipe.map)],
      ['script', `${PIPELINE_DIRECTORY}${DRAW_SCRIPT}`],
      ['tool', DRAWN_TOOL],
    ];
  }
  if (output.recipe.how === 'wordmark') {
    return [
      ['path', `${OUTPUT_DIRECTORY}/${file}`],
      ['source', WORDMARK_SOURCE_WORDS],
      ['licence', 'CC-BY-4.0'],
      ['read', WORDMARK_READ],
      ['sha256', sha256],
      ['creator', WORDMARK_CREATOR],
      ['url', WORDMARK_URL],
      ['modified', output.modified ?? ''],
      ['input', WORDMARK_SOURCE],
      ['inputsha256', WORDMARK_SOURCE_SHA256],
      ['script', WORDMARK_SCRIPT],
      ['tool', WORDMARK_TOOL],
    ];
  }
  const source = lock.sources.find((each) => each.id === output.from);
  if (source === undefined) throw new Error(`${file}: ${output.from} is not in the lock`);
  const path = `${OUTPUT_DIRECTORY}/${file}`;
  // #1274: an ambientCG asset says so, and says how its page said it was made.
  const origin =
    source.id === 'makehuman'
      ? 'MakeHuman'
      : SOURCES.find((each) => each.id === source.id)?.origin.from === 'ambientcg'
        ? 'ambientCG'
        : 'Poly Haven';
  const by =
    source.technique === undefined
      ? source.authors
      : `${source.authors} (its own page: made by ${source.technique})`;
  // #623: a run that reads a second source names it, and digests it too.
  const also =
    output.recipe.how === 'blender'
      ? (output.recipe.alsoReads ?? []).map((id) => {
          const read = lock.sources.find((each) => each.id === id);
          if (read === undefined) throw new Error(`${file}: ${id} is not in the lock`);
          return read;
        })
      : [];
  if (output.recipe.how === 'verbatim') {
    const recipe = output.recipe;
    const upstream = source.files.find((each) => each.path === recipe.file);
    if (upstream === undefined) throw new Error(`${file}: the lock records no ${recipe.file}`);
    return [
      ['path', path],
      ['source', `${origin}, ${source.id} by ${by}; upstream bytes, unmodified — ${upstream.url}`],
      ['licence', source.licence],
      ['read', source.read],
      ['sha256', sha256],
    ];
  }
  const recipe = output.recipe;
  const impostor =
    recipe.how === 'blender'
      ? (recipe.alsoWrites ?? []).find((also) => also.file === file)
      : undefined;
  // #618: a file that passed through the encoder names it as well as Blender.
  const encoded =
    recipe.how === 'ktx2' ||
    impostor !== undefined ||
    (recipe.how === 'blender' && (recipe.ktx2 !== undefined || recipe.images === 'ktx2'));
  const tool =
    recipe.how === 'ktx2'
      ? PINNED_KTX
      : encoded
        ? `${PINNED_BLENDER}, then ${PINNED_KTX}`
        : PINNED_BLENDER;
  // #618's review: `script` is ONE path — ASSET007 checks a single committed
  // file, and the manifest's two readers (`check-repo-rules.sh` and
  // `credits/manifest.ts`) hold no list — so a two-step row names its first
  // step there, the Blender script that read the recorded input, and its
  // second in `modified`, where a reader making it again looks for what was
  // done. `provenance.test.ts` holds that the file named is committed.
  const second = recipe.how === 'blender' && encoded ? `${KTX2_STEP_WORDS}${KTX2_SCRIPT_PATH}` : '';
  const described =
    impostor === undefined
      ? (output.modified ?? '')
      : impostor.modified === undefined
        ? `an eight-view impostor strip of one object of the pack, rendered from the full scan; then ${encodingWords(impostor.ktx2)}`
        : `${impostor.modified}; then ${encodingWords(impostor.ktx2)}`;
  const alsoFrom = also
    .map(
      (each) =>
        `, and ${each.id} by ${each.authors}, its licence read on ${each.read} at ${each.licencePage}`,
    )
    .join('');
  return [
    ['path', path],
    [
      'source',
      `${origin}, ${source.id} by ${by}${alsoFrom}; made by this repository's asset pipeline (#430) from the files inputs.lock.json records`,
    ],
    ['licence', source.licence],
    ['read', source.read],
    ['sha256', sha256],
    ['modified', `${described}${second}`],
    ['input', [source, ...also].map((each) => each.licencePage).join(' and ')],
    [
      'inputsha256',
      also.length === 0 ? inputDigest(source.files) : sourcesDigest([source, ...also]),
    ],
    ['script', `${PIPELINE_DIRECTORY}${recipe.how === 'ktx2' ? KTX2_SCRIPT : recipe.script}`],
    ['tool', tool],
  ];
}

/**
 * The `ASSETS.toml` entry for one file of a generated tree — #1283, ADR 0049
 * D-1: **this repository's own work, dedicated `CC0-1.0`, naming the generator
 * and its version**, as the bicycle's drawn maps are recorded, and naming the
 * ambientCG or Poly Haven assets it wears with what each one's own page said.
 */
function generatedRecord(
  file: string,
  output: OutputSpec,
  lock: InputLock,
  sha256: string,
): AssetRecord {
  if (output.recipe.how !== 'generated') throw new Error(`${file}: not a generated tree`);
  const recipe = output.recipe;
  const tree = GENERATED_TREES.find((each) => each.name === recipe.tree);
  if (tree === undefined) throw new Error(`${file}: no generated tree ${recipe.tree}`);
  const species = speciesOf(tree);
  const worn = [...new Set([species.bark.source, species.sprig.source])].map((id) => {
    const source = lock.sources.find((each) => each.id === id);
    if (source === undefined) throw new Error(`${file}: ${id} is not in the lock`);
    return source;
  });
  const strip = alsoWritten(recipe).find((also) => also.file === file);
  const encoded = strip !== undefined || recipe.images === 'ktx2';
  const described =
    strip === undefined
      ? (output.modified ?? '')
      : `${strip.modified ?? ''}; then ${encodingWords(strip.ktx2)}`;
  // An ambientCG page says how the asset was made; a Poly Haven asset's API
  // names who photographed and modelled it (#1294).
  const wears = worn
    .map((each) =>
      each.id in POLY_HAVEN_TREE_MAPS
        ? `Poly Haven's ${each.id} (${each.licence}; its own page, read on ${each.read}: by ${each.authors})`
        : `ambientCG's ${each.id} (${each.licence}; its own page, read on ${each.read}: made by ${each.technique ?? 'nothing it names'})`,
    )
    .join(' and ');
  return [
    ['path', `${OUTPUT_DIRECTORY}/${file}`],
    [
      'source',
      `This repository, ${species.adoptedBy} — a tree generated by ${PINNED_EZ_TREE} (MIT, https://github.com/dgreenheck/ez-tree), a deterministic generator run from the seed and parameters committed in ${GENERATED_TREES_PATH}, wearing ${wears}. None of the generator's own images is taken, and nothing is the output of a trained model (ADR 0049 D-1, D-2)`,
    ],
    ['licence', 'CC0-1.0'],
    [
      'read',
      worn
        .map((each) => each.read)
        .sort()
        .at(-1) ?? '',
    ],
    ['sha256', sha256],
    ['modified', `${described}${encoded ? `${KTX2_STEP_WORDS}${KTX2_SCRIPT_PATH}` : ''}`],
    [
      'input',
      [`${GENERATED_TREES_PATH}#${tree.name}`, ...worn.map((each) => each.licencePage)].join(
        ' and ',
      ),
    ],
    ['inputsha256', generatedInputDigest(tree, lock)],
    ['script', `${PIPELINE_DIRECTORY}${GENERATED_TREE_SCRIPT}`],
    ['tool', encoded ? `${GENERATED_TOOL}, then ${PINNED_KTX}` : GENERATED_TOOL],
  ];
}

/** One entry as the `ASSETS.toml` subset writes it. */
export function formatRecord(record: AssetRecord): string {
  return ['[[asset]]', ...record.map(([key, value]) => `${key} = "${value}"`)].join('\n');
}
