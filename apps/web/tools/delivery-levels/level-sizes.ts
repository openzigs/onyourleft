// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The built-in Delivery levels' size ceilings — #2361, ADR 0065 D-3.2, set by
 * the owner (D-15 Q5): **2 MiB for one level file, and 8 MiB for every level
 * file together.** The app's build fails above either (the {@link levelSizes}
 * plugin, in `vite.config.ts`), as the demo build fails above
 * `DEMO_ROUTE_MAX_BYTES`, and `author-level.ts` refuses to write a file that
 * would break either. A level over a ceiling is redrawn shorter or elsewhere;
 * its corridor is never narrowed to fit. A raise needs the owner's approval
 * in the pull request that asks for it (D-3.3).
 *
 * Self-contained, with only `node:` imports, because `vite.config.ts` loads it
 * and Node cannot load the workspace's extensionless TypeScript.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

/** The most bytes one level file may be (D-3.2). */
export const LEVEL_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** The most bytes every level file together may be (D-3.2). */
export const LEVELS_TOTAL_MAX_BYTES = 8 * 1024 * 1024;

/** One level file, by its name, and its size. */
export interface LevelFileSize {
  readonly name: string;
  readonly bytes: number;
}

/** What is over a ceiling, as lines; empty when nothing is. */
export function levelSizeFindings(
  files: readonly LevelFileSize[],
  perFile: number = LEVEL_FILE_MAX_BYTES,
  total: number = LEVELS_TOTAL_MAX_BYTES,
): string[] {
  const findings: string[] = [];
  let sum = 0;
  for (const file of files) {
    sum += file.bytes;
    if (file.bytes > perFile) {
      findings.push(
        `${file.name} is ${String(file.bytes)} bytes, over the per-level ceiling of ${String(perFile)}`,
      );
    }
  }
  if (sum > total) {
    findings.push(
      `the level files are ${String(sum)} bytes together, over the ceiling of ${String(total)}`,
    );
  }
  return findings;
}

/** The level files directly in `directory`, by name, with their sizes. */
export function levelFileSizes(directory: string): LevelFileSize[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, bytes: statSync(join(directory, name)).size }));
}

/** The plugin, for `vite.config.ts`: fails the build when a level file breaks a ceiling. */
export function levelSizes(
  directory: string,
  perFile: number = LEVEL_FILE_MAX_BYTES,
  total: number = LEVELS_TOTAL_MAX_BYTES,
): Plugin {
  return {
    name: 'oyl-delivery-level-sizes',
    apply: 'build',
    // Before the build starts, not in `buildStart`: a throw there is reported
    // as the service worker's "the build emitted no files" from its
    // `closeBundle`, and this message is lost.
    configResolved() {
      const findings = levelSizeFindings(levelFileSizes(directory), perFile, total);
      if (findings.length > 0) {
        throw new Error(
          `oyl-delivery-level-sizes: the built-in Delivery levels cannot ship (#2361, ADR 0065 D-3.2):\n  - ` +
            findings.join('\n  - '),
        );
      }
    },
  };
}
