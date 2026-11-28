// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness for the AI group ride: runs `main.ts` through Vite's module
 * runner, as `model-tactics-spike/run-harness.mjs` runs its own, because the
 * shipped session it rides imports the game's TypeScript and TSX. See
 * `main.ts` for the command.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const { main } = (await runnerImport(fileURLToPath(import.meta.resolve('./main.ts')))).module;
process.exitCode = await main(process.argv.slice(2).filter((arg) => arg !== '--'));
