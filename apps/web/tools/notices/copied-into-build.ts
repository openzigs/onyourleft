// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every file the build copies out of a package is named in the notices — held
 * at build time, #676's review.
 *
 * `apps/web/third-party-notices.json` §`copiedIntoBuild` is a reviewed list, and
 * `scripts/check-third-party-notices.mjs` notices what it names (Part 3 of the
 * document). What that checker cannot see is a file the list does NOT name:
 * it deliberately does not depend on a build (CLAUDE.md §4g), and a new
 * `import url from 'some-package/thing.wasm?url'`, or a plugin that emits a
 * package's binary the way `tools/pose/pose-runtime-plugin.ts` does, would put
 * somebody else's bytes in `dist` with the list unchanged and every gate green.
 *
 * So the build checks it, because the build is the one place that knows what
 * it wrote: `pnpm run build` runs in CI, and a build that ships an unnamed
 * file fails.
 *
 * ## Which files, and why the rule reads the asset's origin
 *
 * Code is not this rule's: a `.js` or `.css` asset is bundled from a package
 * in the distributed closure (noticed in Part 1), from this repository's own
 * source, or from the bundler (Part 4) — MapLibre's worker is a `.js` asset
 * built from `maplibre-gl`. Everything else — a `.wasm`, a model, an image,
 * a font — must either come from this repository or be named in the list.
 * "From this repository" is read off Rolldown's `originalFileNames`, the
 * modules the asset was emitted for: an asset with none (a plugin's
 * `emitFile` from bytes it read somewhere, which is exactly how the pose
 * runtime arrives) or with one under a `node_modules` directory is treated as
 * a package's, and fails closed unless it is named.
 *
 * `public/` is not in the bundle at all — Vite copies it after — and every
 * file there is this repository's, recorded in `ASSETS.toml` when it is a
 * binary (`ASSET001`).
 *
 * A named file the build no longer writes is reported too, `LIC006`'s reason:
 * an entry that has stopped meaning something stops the build.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

/** One asset of the bundle, as far as this rule reads it. */
export interface BuiltAsset {
  readonly fileName: string;
  readonly originalFileNames: readonly string[];
}

/** An entry of `copiedIntoBuild`, as far as this rule reads it. */
export interface CopiedFile {
  readonly path: string;
}

/** Code: noticed through the closure, this repository or the bundler, never here. */
const CODE = /\.(?:[cm]?js|css|map|html)$/i;

/** Whether an asset's bytes came from a package rather than from this repository. */
export function fromAPackage(asset: BuiltAsset): boolean {
  return (
    asset.originalFileNames.length === 0 ||
    asset.originalFileNames.some((name) => /(?:^|[\\/])node_modules[\\/]/.test(name))
  );
}

/**
 * The assets a build wrote out of a package that the list does not name, and
 * the names on the list the build did not write.
 */
export function unnoticedCopies(
  assets: readonly BuiltAsset[],
  noticed: readonly CopiedFile[],
): { readonly unnamed: readonly string[]; readonly stale: readonly string[] } {
  const named = new Set(noticed.map((file) => file.path));
  const written = new Set(assets.map((asset) => asset.fileName));
  return {
    unnamed: assets
      .filter((asset) => !CODE.test(asset.fileName) && fromAPackage(asset))
      .map((asset) => asset.fileName)
      .filter((fileName) => !named.has(fileName))
      .sort(),
    stale: [...named].filter((path) => !written.has(path)).sort(),
  };
}

/** The reviewed inputs the notices generator reads. */
export const NOTICES_INPUTS = 'third-party-notices.json';

/**
 * The plugin: `enforce: 'post'`, so every other plugin has emitted what it is
 * going to by the time this reads the bundle.
 */
export function copiedIntoBuild(root: string): Plugin {
  return {
    name: 'oyl-copied-into-build',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const inputs = JSON.parse(readFileSync(join(root, NOTICES_INPUTS), 'utf8')) as {
        copiedIntoBuild?: CopiedFile[];
      };
      const assets = Object.values(bundle).flatMap((output) =>
        output.type === 'asset'
          ? [{ fileName: output.fileName, originalFileNames: output.originalFileNames }]
          : [],
      );
      const { unnamed, stale } = unnoticedCopies(assets, inputs.copiedIntoBuild ?? []);
      const problems = [
        ...unnamed.map(
          (file) =>
            `${file} is written out of a package and is not in ${NOTICES_INPUTS} §copiedIntoBuild`,
        ),
        ...stale.map(
          (file) =>
            `${file} is in ${NOTICES_INPUTS} §copiedIntoBuild and the build did not write it`,
        ),
      ];
      if (problems.length > 0) {
        this.error(
          `oyl-copied-into-build: the notices do not name what the build copied (#664).\n  - ` +
            `${problems.join('\n  - ')}\nName it, then run \`pnpm run notices:generate\`.`,
        );
      }
    },
  };
}
