// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the demo build may never contain — held at build time, #1645.
 *
 * The demo (epic #1643) is a page an outside website embeds and anybody's
 * browser runs. It drives scripted bots, so it has no use for a trainer, a
 * Bluetooth device, the network or a rider's store, and the guarantee is that
 * it **cannot** reach any of them: not "does not call", but "the code is not
 * in the bundle". So the demo's Vite config reads the bundle it emitted, the
 * way `tools/bundle/entry-graph.ts` reads the product's, and fails the build
 * when a module below is in any chunk.
 *
 * ## What is checked
 *
 * - Every module Rolldown put in an emitted chunk (`output.modules`). A
 *   type-only import is erased before bundling, so it is not counted, and
 *   that is the point: a type costs a visitor no bytes and runs nothing.
 * - Against {@link DEMO_FORBIDDEN_PATHS} (a file, or a directory when the path
 *   ends in `/`, relative to the repository root) and
 *   {@link DEMO_FORBIDDEN_PACKAGES} (an installed package, by its directory
 *   name under `node_modules`).
 * - ⚠️ **Every path must exist.** A renamed file would otherwise leave the
 *   list naming nothing, and a check over nothing passes for ever — the shape
 *   `scripts/check-wiring.mjs` §`missingSeamFiles` refuses for the same list.
 *
 * ## What it does not check
 *
 * A module that does something forbidden through a platform global without
 * importing anything (`fetch`, `navigator.bluetooth`, `indexedDB`) is not a
 * module this list can name. The network half of that is the page's
 * Content-Security-Policy (`content-security.ts`); the rest is review.
 */

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Plugin } from 'vite';

/** A path the demo may not bundle, and why, in a sentence the failure prints. */
export interface ForbiddenPath {
  readonly path: string;
  readonly why: string;
}

/**
 * `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM`, every module of it —
 * `forbidden-modules.test.ts` reads that list and fails if one is missing here.
 */
const TRAINER_SEAM: readonly string[] = [
  'packages/domain/src/trainer/simulation.ts',
  'packages/sensors/protocol/src/fitness-machine-control.ts',
  'packages/sensors/protocol/src/simulation-writer.ts',
  'packages/sensors/protocol/src/erg-writer.ts',
  'packages/sensors/protocol/src/trainer-control-choice.ts',
];

/** Every repository path the demo bundle may not contain. */
export const DEMO_FORBIDDEN_PATHS: readonly ForbiddenPath[] = [
  ...TRAINER_SEAM.map((path) => ({
    path,
    why: 'the trainer-command seam: what sets a resistance or an ERG target',
  })),
  { path: 'packages/sensors/', why: 'Bluetooth sensors and trainers' },
  { path: 'apps/web/src/ride/trainer.ts', why: 'opens a trainer' },
  { path: 'apps/web/src/game/trainer-port.ts', why: 'the game’s port to a trainer' },
  { path: 'apps/web/src/net/', why: 'rooms, over the network' },
  { path: 'apps/web/src/instance/', why: 'a rider’s instance, over the network' },
  { path: 'apps/web/src/camera/', why: 'the camera' },
  { path: 'apps/web/src/world-data/corridor-source.ts', why: 'reads map tiles over the network' },
  { path: 'packages/store/src/activity-store.ts', why: 'the IndexedDB store of a rider’s data' },
];

/** Installed packages the demo may not bundle. */
export const DEMO_FORBIDDEN_PACKAGES: readonly ForbiddenPath[] = [
  { path: 'dexie', why: 'the IndexedDB adapter packages/store is built on' },
];

/** A module id as a path relative to `repository`, with `/` and no query. */
function relativeId(id: string, repository: string): string {
  return relative(repository, id.replace(/\?.*$/, '')).replace(/\\/g, '/');
}

/** Every bundled module that is forbidden, one sentence each; empty when none is. */
export function forbiddenModules(
  moduleIds: readonly string[],
  repository: string,
  paths: readonly ForbiddenPath[] = DEMO_FORBIDDEN_PATHS,
  packages: readonly ForbiddenPath[] = DEMO_FORBIDDEN_PACKAGES,
): string[] {
  const problems: string[] = [];
  for (const id of moduleIds) {
    const normalised = id.replace(/\\/g, '/');
    const rel = relativeId(id, repository);
    const path = paths.find((each) =>
      each.path.endsWith('/') ? rel.startsWith(each.path) : rel === each.path,
    );
    const found =
      path ?? packages.find((each) => normalised.includes(`/node_modules/${each.path}/`));
    if (found !== undefined) {
      problems.push(`${rel.startsWith('..') ? normalised : rel} (${found.why})`);
    }
  }
  return problems;
}

/** The entries of `paths` that name nothing under `repository`. */
export function missingForbiddenPaths(
  repository: string,
  paths: readonly ForbiddenPath[] = DEMO_FORBIDDEN_PATHS,
): string[] {
  return paths.map((each) => each.path).filter((path) => !existsSync(join(repository, path)));
}

/** The plugin. `enforce: 'post'`, so it reads the bundle every other plugin left. */
export function demoForbiddenModules(repository: string): Plugin {
  return {
    name: 'oyl-demo-forbidden-modules',
    apply: 'build',
    enforce: 'post',
    buildStart() {
      const missing = missingForbiddenPaths(repository);
      if (missing.length > 0) {
        this.error(
          `oyl-demo-forbidden-modules: these forbidden paths name no file, so the check would ` +
            `pass over nothing — update tools/demo/forbidden-modules.ts:\n  - ${missing.join('\n  - ')}`,
        );
      }
    },
    generateBundle(_options, bundle) {
      const moduleIds = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? Object.keys(output.modules) : [],
      );
      const problems = forbiddenModules(moduleIds, repository);
      if (problems.length > 0) {
        this.error(
          `oyl-demo-forbidden-modules: the demo bundles a module it must never reach (#1645): ` +
            `no trainer, no Bluetooth, no network, no storage.\n  - ${problems.join('\n  - ')}`,
        );
      }
    },
  };
}
