// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness for AI bot races and AI pacer rides: runs
 * `harness/main.ts` through Vite's module runner, as `run-live.mjs` runs the
 * spike, and hands it **the instance's own prompt modules**, loaded from
 * `apps/instance` by path (`harness/production.ts` says why by path). See
 * `harness/main.ts` for the commands.
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

const load = async (specifier) =>
  (await runnerImport(fileURLToPath(import.meta.resolve(specifier)))).module;

const { PRODUCTION_MODULES, productionFrom } = await load('./harness/production.ts');
const production = productionFrom({
  tactics: await load(`../../../instance/src/analysis/${PRODUCTION_MODULES.tactics}`),
  pacer: await load(`../../../instance/src/analysis/${PRODUCTION_MODULES.pacer}`),
});
const { main } = await load('./harness/main.ts');
process.exitCode = await main(
  process.argv.slice(2).filter((arg) => arg !== '--'),
  production,
);
