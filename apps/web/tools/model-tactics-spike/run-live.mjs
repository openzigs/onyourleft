// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: runs `live.ts` through Vite's module runner, which
 * transforms the `.tsx` the race step's import graph reaches. See `live.ts`
 * for the commands.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(import.meta.resolve('./live.ts')));
process.exitCode = await module.main(process.argv.slice(2).filter((arg) => arg !== '--'));
