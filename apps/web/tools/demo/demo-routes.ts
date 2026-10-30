// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The baked routes in the demo build — #1651, ADR 0056.
 *
 * `demo:bake` (`bake-route.ts`) writes each preset route into
 * `demo/dist/routes/`, and the demo build empties `demo/dist/` before it
 * writes (`emptyOutDir`). So this plugin reads `routes/` before the build
 * starts and puts it back after the bundle is written: a bake survives any
 * number of builds, and a bake never needs a build after it.
 *
 * Then it reads back what is in the output and fails the build:
 *
 * - for a route file over {@link DEMO_ROUTE_MAX_BYTES}, the per-route ceiling;
 * - for a route file with no `LICENCE-ODbL.txt` or no `routes.json` beside
 *   it — the output carries its own compliance (ADR 0056 D-4.4), so a bundle
 *   is never served without its notice.
 *
 * A build with no routes is the usual case (CI's demo build) and passes.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Plugin } from 'vite';

import { filesUnder } from './demo-output';

/**
 * The most bytes one route's file may be — **8 MiB**. Neither ADR 0056 nor
 * the owner set a figure (#1651 asks one of them to), so this is the bake's
 * recommendation, from two hand-drawn lines baked once against the published
 * archive on 2026-10-25: 11 km through Manhattan, 25 tiles, 1 906 428 bytes
 * (about 76 KB a tile); 25 km from Boulder to Lyons, 43 tiles, 450 720
 * bytes. 8 MiB is about four times the densest, or some 45 km of a city
 * centre. `vite.demo.config.ts` fails the demo build above it, and the bake
 * refuses to write a file over it.
 *
 * Here rather than in `route-bundle.ts`, with the two names below, because the
 * demo's Vite config loads this file and Node cannot load that one's imports
 * of the workspace's extensionless TypeScript.
 */
export const DEMO_ROUTE_MAX_BYTES = 8 * 1024 * 1024;

/** The notice file beside the bundles: ODbL §4.2 d's "relevant directory". */
export const ODBL_NOTICE_FILE = 'LICENCE-ODbL.txt';

/** The manifest beside the bundles. Not `manifest.json`, which `demo-output.ts` refuses as a web app manifest. */
export const ROUTE_MANIFEST_FILE = 'routes.json';

/** Where the baked routes are, under the demo's output. */
export const ROUTES_DIRECTORY = 'routes';

/** What is wrong with a `routes/` directory, as lines; empty when nothing is. */
export function routesFindings(
  directory: string,
  ceiling: number = DEMO_ROUTE_MAX_BYTES,
): string[] {
  if (!existsSync(directory)) return [];
  const files = filesUnder(directory);
  const bundles = files.filter((file) => file.endsWith('.bin'));
  const findings: string[] = [];
  for (const file of bundles) {
    const bytes = statSync(join(directory, file)).size;
    if (bytes > ceiling) {
      findings.push(
        `${file} is ${String(bytes)} bytes, over the per-route ceiling of ${String(ceiling)}`,
      );
    }
  }
  if (bundles.length > 0) {
    for (const needed of [ODBL_NOTICE_FILE, ROUTE_MANIFEST_FILE]) {
      if (!files.includes(needed)) findings.push(`routes/ has map data and no ${needed}`);
    }
  }
  return findings;
}

/** The plugin, for `vite.demo.config.ts`. */
export function demoRoutes(ceiling: number = DEMO_ROUTE_MAX_BYTES): Plugin {
  let routes = '';
  let kept = new Map<string, Uint8Array>();
  return {
    name: 'oyl-demo-routes',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      routes = join(resolve(config.root, config.build.outDir), ROUTES_DIRECTORY);
    },
    buildStart() {
      kept = new Map(
        existsSync(routes)
          ? filesUnder(routes).map((file) => [file, readFileSync(join(routes, file))])
          : [],
      );
    },
    writeBundle() {
      for (const [file, bytes] of kept) {
        const path = join(routes, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes);
      }
    },
    closeBundle() {
      const findings = routesFindings(routes, ceiling);
      if (findings.length > 0) {
        throw new Error(
          `oyl-demo-routes: the demo's baked routes cannot ship (#1651, ADR 0056):\n  - ` +
            findings.join('\n  - '),
        );
      }
    },
  };
}
