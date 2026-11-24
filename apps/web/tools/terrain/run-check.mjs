// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `terrain:check` entry point (#2013). `archive-check.ts` is TypeScript
 * with extensionless imports, so it is loaded through Vite's module runner, as
 * `tools/basemap/run-compare.mjs` loads its own: no new dependency.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(import.meta.resolve('./archive-check.ts')));
process.exitCode = await module.main(process.argv.slice(2).filter((arg) => arg !== '--'));
