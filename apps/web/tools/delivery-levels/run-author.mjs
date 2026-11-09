// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `levels:author` entry point (#2361). `author-level.ts` reaches
 * `@onyourleft/map-features`, whose TypeScript `node`'s strip-only mode
 * refuses, so it is loaded through Vite's module runner, as
 * `tools/circuits/run-author.mjs` loads its tool.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(import.meta.resolve('./author-level.ts')));
process.exitCode = await module.main(process.argv.slice(2).filter((arg) => arg !== '--'));
