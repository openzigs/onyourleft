// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `demo:release` — stages the demo's baked route data as the assets of a
 * GitHub release (#1932, ADR 0056 D-4.2).
 *
 * ```sh
 * pnpm --silent --filter @onyourleft/web run demo:release -- --list
 * pnpm --filter @onyourleft/web run demo:release -- --tag demo-YYYY-MM-DD --stage <dir> --notes <file>
 * ```
 *
 * ADR 0056 D-4.2 offers each preset route's map data — the entire Derivative
 * Database, ODbL §4.6 a — in two places: beside the demo, which `demo:bake`
 * and the demo build already do, and **as an asset on a GitHub release of the
 * demo**. `.github/workflows/demo-release.yml` builds that release by hand
 * (`workflow_dispatch`): it bakes every preset route with `demo:bake`, builds
 * the demo, then runs this to copy what is published into `--stage`.
 *
 * - **`--list`** prints the preset routes, one id a line: each route with a
 *   committed GPX and its record in `demo/routes/` (`bake-route.ts` §"Adding
 *   a preset route"). The workflow bakes exactly these.
 * - **`--tag`, `--stage` and `--notes`** check the demo output's `routes/`
 *   and copy, for each preset route, its `<id>.<digest>.bin`, then
 *   `routes.json` and `LICENCE-ODbL.txt`, into `--stage`; and write the
 *   release's notes, with the ODbL notice, to `--notes`. They refuse a tag
 *   that is not `demo-YYYY-MM-DD` (a second release that day `.2` on), a
 *   preset route the output does not hold, a file whose bytes are not the
 *   digest `routes.json` names, a route in `routes.json` that is not a preset
 *   (it would be published), and an output `demo-routes.ts` would refuse to
 *   build.
 *
 * Not the OpenStreetMap data's to decide: it publishes only what `demo:bake`
 * wrote, unchanged, so the asset is the file the demo loads (D-4.1, D-4.4).
 * ⚠️ Never a pull request's: a real-route bake is the owner's or the release
 * job's (D-9), and nothing here runs in the required checks except against
 * the synthetic fixture.
 *
 * Imports only `demo-routes.ts` and types, so `node` runs it with types
 * stripped, without the bake's import graph.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RouteManifest } from './bake-route';
import { ODBL_NOTICE_FILE, ROUTE_MANIFEST_FILE, routesFindings } from './demo-routes';

/** A demo release's tag: `demo-` and the UTC date, and `.2`, `.3` … for a later one that day. */
export const RELEASE_TAG =
  /^demo-\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:\.(?:[2-9]|[1-9]\d))?$/;

// Not `new URL('../../', import.meta.url)`, which Vite rewrites as an asset's URL under jsdom.
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the committed preset routes are, and where the bake and the build leave their output. */
export const PRESET_ROUTES_DIRECTORY = join(WEB, 'demo', 'routes');
export const BAKED_ROUTES_DIRECTORY = join(WEB, 'demo', 'dist', 'routes');

/** The preset routes in `directory`: each id with both `<id>.gpx` and `<id>.bake.json`, sorted. */
export function presetRouteIds(directory: string): string[] {
  const names = new Set(readdirSync(directory));
  return [...names]
    .filter((name) => name.endsWith('.bake.json'))
    .map((name) => name.slice(0, -'.bake.json'.length))
    .filter((id) => names.has(`${id}.gpx`))
    .sort();
}

/** `tag`, if it is a demo release's; throws otherwise. */
export function releaseTag(tag: string): string {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(
      'demo:release: a tag is demo-YYYY-MM-DD, or demo-YYYY-MM-DD.2 for a second that day',
    );
  }
  return tag;
}

/**
 * The file names under `routesDirectory` a release of `presets` publishes, in
 * upload order: each preset's bundle, then the manifest and the notice.
 * Every check reads the output back from disk.
 */
export function releaseAssets(routesDirectory: string, presets: readonly string[]): string[] {
  if (presets.length === 0) throw new Error('demo:release: there is no preset route to publish');
  const findings = routesFindings(routesDirectory);
  if (findings.length > 0) throw new Error(`demo:release: ${findings.join('; ')}`);
  const manifestPath = join(routesDirectory, ROUTE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`demo:release: routes/ has no ${ROUTE_MANIFEST_FILE}; run demo:bake first`);
  }
  if (!existsSync(join(routesDirectory, ODBL_NOTICE_FILE))) {
    throw new Error(`demo:release: routes/ has no ${ODBL_NOTICE_FILE}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RouteManifest;
  const strays = Object.keys(manifest.routes).filter((id) => !presets.includes(id));
  if (strays.length > 0) {
    throw new Error(
      `demo:release: ${ROUTE_MANIFEST_FILE} lists ${strays.join(', ')}, which is not a preset route`,
    );
  }
  const bundles = presets.map((id) => {
    const entry = manifest.routes[id];
    if (entry === undefined) throw new Error(`demo:release: ${id} has not been baked`);
    const path = join(routesDirectory, entry.file);
    if (!existsSync(path)) throw new Error(`demo:release: ${id}: ${entry.file} is missing`);
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (sha256 !== entry.sha256) {
      throw new Error(
        `demo:release: ${id}: ${entry.file} is not the file ${ROUTE_MANIFEST_FILE} names`,
      );
    }
    return entry.file;
  });
  return [...bundles, ROUTE_MANIFEST_FILE, ODBL_NOTICE_FILE];
}

/** The release's notes: what each file is, and the notice ODbL §4.2 and §4.3 ask for. */
export function releaseNotes(
  tag: string,
  routesDirectory: string,
  presets: readonly string[],
): string {
  const manifest = JSON.parse(
    readFileSync(join(routesDirectory, ROUTE_MANIFEST_FILE), 'utf8'),
  ) as RouteManifest;
  const rows = presets.map((id) => {
    const entry = manifest.routes[id];
    if (entry === undefined) throw new Error(`demo:release: ${id} has not been baked`);
    return (
      `| \`${id}\` | \`${entry.file}\` | ${String(entry.bytes)} | \`${entry.sha256}\` | ` +
      `${entry.archiveUrl} |`
    );
  });
  return [
    `The On Your Left demo's preset route map data, release \`${tag}\` ([ADR 0056](https://github.com/openzigs/onyourleft/blob/main/docs/adr/0056-the-demos-shipped-map-under-odbl.md) D-4.2).`,
    '',
    `${manifest.notice} © OpenStreetMap contributors, https://www.openstreetmap.org/copyright. ` +
      `Licence: ${manifest.licence}, ${manifest.licenceUrl}.`,
    '',
    `Each \`.bin\` file is the entire database the demo draws for one route (ODbL §4.6 a), ` +
      `the file the demo itself loads: gzip over UTF-8 JSON. \`${ROUTE_MANIFEST_FILE}\` describes ` +
      `each one and \`${ODBL_NOTICE_FILE}\` is the notice that goes with them.`,
    '',
    '| Route | File | Bytes | SHA-256 | Baked from |',
    '| --- | --- | ---: | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** Copies `releaseAssets` into `stage` and writes the notes to `notes`. Returns the names staged. */
export function stageRelease(options: {
  readonly tag: string;
  readonly routesDirectory: string;
  readonly presets: readonly string[];
  readonly stage: string;
  readonly notes: string;
}): string[] {
  const tag = releaseTag(options.tag);
  const assets = releaseAssets(options.routesDirectory, options.presets);
  mkdirSync(options.stage, { recursive: true });
  for (const name of assets)
    copyFileSync(join(options.routesDirectory, name), join(options.stage, name));
  mkdirSync(dirname(options.notes), { recursive: true });
  writeFileSync(options.notes, releaseNotes(tag, options.routesDirectory, options.presets));
  return assets;
}

/** `argv` after the script's own path; a bare `--` (pnpm's separator) is skipped. */
export function parseReleaseArguments(
  argv: readonly string[],
):
  | { readonly list: true }
  | { readonly list: false; readonly tag: string; readonly stage: string; readonly notes: string } {
  const values = new Map<string, string>();
  let list = false;
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (flag === '--') continue;
    if (flag === '--list') {
      list = true;
      continue;
    }
    if (flag !== '--tag' && flag !== '--stage' && flag !== '--notes') {
      throw new Error(`demo:release: unknown argument ${String(flag)}`);
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`demo:release: ${flag} needs a value`);
    values.set(flag, value);
    at += 1;
  }
  if (list) {
    if (values.size > 0) throw new Error('demo:release: --list takes no other argument');
    return { list };
  }
  const [tag, stage, notes] = ['--tag', '--stage', '--notes'].map((flag) => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`demo:release: ${flag} is required, or --list`);
    return value;
  }) as [string, string, string];
  return { list, tag, stage, notes };
}

function main(): void {
  const args = parseReleaseArguments(process.argv.slice(2));
  const presets = presetRouteIds(PRESET_ROUTES_DIRECTORY);
  if (args.list) {
    for (const id of presets) console.log(id);
    return;
  }
  const staged = stageRelease({ ...args, routesDirectory: BAKED_ROUTES_DIRECTORY, presets });
  console.log(`demo:release: ${args.tag}: staged ${staged.join(', ')} in ${args.stage}`);
}

if (process.argv[1]?.endsWith('demo-release.ts') === true) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
