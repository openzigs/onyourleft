// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `basemap:compare` entry point (#1557). `compare-archives.ts` imports
 * `@onyourleft/map-features`, the ride map's own decoder, and that package's
 * TypeScript uses parameter properties, which `node`'s strip-only mode refuses
 * (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Vite, already this app's build tool,
 * transforms the graph through its module runner instead, so no new dependency
 * and no change to the package.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(import.meta.resolve('./compare-archives.ts')));
process.exitCode = await module.main(process.argv.slice(2).filter((arg) => arg !== '--'));
