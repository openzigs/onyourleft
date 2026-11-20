// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The write-up agent against a real model, over the scored set** — #2840.
 *
 *     node tools/write-up-measure.ts [--host <ssh host> | --url <loopback origin>]
 *         [--model gemma4:12b] [--template 1|2] [--rides <name>[,<name>]] [--results <directory>]
 *
 * Runs the shipped agent over `write-up-set.ts`'s twelve fixed rides (or the
 * ones named), prints one JSON line a ride, writes the whole run, numbers
 * only, to `<directory>/write-up-v<template>-<time>.json` (by default
 * `tools/results/write-up/`), and **exits 1 below the set's pass mark**
 * (`SET_PASS_MARK`), 0 at or above it, and 2 for a command it cannot read.
 *
 * Run it **before any change to the write-up's prompt, its tools' results,
 * its budgets or the model**, and after. It is not a CI gate: CI has no model.
 * `write-up-set.test.ts` and `write-up-measure.test.ts` check its arithmetic
 * and its reading of the server with no model.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { measureWriteUps, OLLAMA_LOOPBACK, sendTo } = await import('./write-up-measure-run.ts');
const { WRITE_UP_SET } = await import('./write-up-set.ts');
const { ANALYSIS_AGENT_TEMPLATE_V1, ANALYSIS_AGENT_TEMPLATE_V2 } =
  await import('@onyourleft/analysis');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const USAGE =
  'usage: node tools/write-up-measure.ts [--host <ssh host> | --url <loopback origin>] [--model <name>] [--template 1|2] [--rides <name>[,<name>]] [--results <directory>]\n';

const host = arg('--host');
const template = arg('--template') ?? '2';
const named = arg('--rides')?.split(',');
const rides =
  named === undefined ? WRITE_UP_SET : WRITE_UP_SET.filter((ride) => named.includes(ride.name));
if ((template !== '1' && template !== '2') || rides.length === 0) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const result = await measureWriteUps({
  send: sendTo(
    host === undefined
      ? { kind: 'loopback', origin: arg('--url') ?? OLLAMA_LOOPBACK }
      : { kind: 'ssh', host },
  ),
  model: arg('--model') ?? 'gemma4:12b',
  rides,
  template: template === '1' ? ANALYSIS_AGENT_TEMPLATE_V1 : ANALYSIS_AGENT_TEMPLATE_V2,
  log: (line) => process.stdout.write(`${line}\n`),
});

const directory =
  arg('--results') ?? join(dirname(fileURLToPath(import.meta.url)), 'results', 'write-up');
await mkdir(directory, { recursive: true });
const file = join(
  directory,
  `write-up-v${template}-${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}.json`,
);
await writeFile(
  file,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), ...result }, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ file, contextTokens: result.contextTokens, shortfalls: result.shortfalls })}\n`,
);
process.exitCode = result.shortfalls.length === 0 ? 0 : 1;
