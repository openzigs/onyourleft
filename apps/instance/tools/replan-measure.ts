// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The workout re-plan against a real model** — #2841.
 *
 *     node tools/replan-measure.ts [--host <ssh host> | --url <loopback origin>]
 *         [--model gemma4:12b] [--times 20] [--looks 0-3] [--label <word>] [--results <directory>]
 *
 * `--looks n` makes each run call the first `n` of the three tools before the
 * model answers (`forcedLooks`), to measure what a run that reads them costs.
 *
 * Runs the shipped re-plan agent over the device's two golden requests, each
 * `--times` times, prints one JSON line a run, and writes the runs and each
 * fixture's summary (valid answers, moves, failures, time), closed names and
 * numbers only, to `<directory>/replan-<label>-<time>.json` (by default
 * `tools/results/replan/`). It is a measurement, not a gate: it exits 0
 * whatever came back, and 2 for a command it cannot read. CI has no model.
 *
 * Run it before and after any change to the re-plan's prompt, schema, budgets
 * or model. ⚠️ It never reaches a trainer: a re-plan's answer is a closed move
 * the device bounds (`@onyourleft/domain` §`validateProposal`), and nothing
 * here applies one.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { measureReplans } = await import('./replan-measure-run.ts');
const { OLLAMA_LOOPBACK, ollamaVersion, sendTo } = await import('./write-up-measure-run.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const USAGE =
  'usage: node tools/replan-measure.ts [--host <ssh host> | --url <loopback origin>] [--model <name>] [--times <n>] [--looks 0-3] [--label <word>] [--results <directory>]\n';

const host = arg('--host');
const times = Number(arg('--times') ?? '20');
const label = arg('--label') ?? 'run';
const looks = Number(arg('--looks') ?? '0');
if (
  !Number.isInteger(times) ||
  times < 1 ||
  times > 100 ||
  !/^[a-z0-9-]{1,32}$/.test(label) ||
  !Number.isInteger(looks) ||
  looks < 0 ||
  looks > 3
) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const send = sendTo(
  host === undefined
    ? { kind: 'loopback', origin: arg('--url') ?? OLLAMA_LOOPBACK }
    : { kind: 'ssh', host },
);
const model = arg('--model') ?? 'gemma4:12b';
const { runs, summaries } = await measureReplans({
  send,
  model,
  times,
  looks,
  log: (line) => process.stdout.write(`${line}\n`),
});

const directory =
  arg('--results') ?? join(dirname(fileURLToPath(import.meta.url)), 'results', 'replan');
await mkdir(directory, { recursive: true });
const file = join(
  directory,
  `replan-${label}-${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}.json`,
);
await writeFile(
  file,
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      model,
      ollama: await ollamaVersion(send),
      label,
      summaries,
      runs,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`${JSON.stringify({ file, summaries })}\n`);
