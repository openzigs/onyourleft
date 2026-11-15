// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `circuits:author` entry point (#2293). `author-circuit.ts` reaches
 * `@onyourleft/map-features`, whose TypeScript `node`'s strip-only mode
 * refuses, so it is loaded through Vite's module runner, as
 * `tools/basemap/run-compare.mjs` loads its tool.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(import.meta.resolve('./author-circuit.ts')));
process.exitCode = await module.main(process.argv.slice(2).filter((arg) => arg !== '--'));
