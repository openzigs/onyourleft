// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The round-trip measurement #1235 asks for (ADR 0048, #389's gate): a
 * throwaway device starts an analysis job on an instance, follows it to its
 * result, and records how long every leg it can see took. Not a test and not
 * a gate: it needs a running instance with an analysis model
 * (`OYL_INSTANCE_ANALYSIS_MODEL_URL`, `OYL_INSTANCE_ANALYSIS_MODEL`) that
 * admits a new device.
 *
 *     node tools/replan-round-trip.ts --url https://rides.example.org \
 *       [--transport sealed|plaintext] [--runs 30] [--cold-runs 5] \
 *       [--unload 'ollama stop <model>'] [--origin https://…] \
 *       [--starts-per-account 12] [--run-timeout-seconds 660] \
 *       [--hosted-url https://… --hosted-model <name>]
 *
 * - **`--transport sealed`** (the default) is what a device sends (ADR 0047):
 *   the instance must hold keys (`OYL_INSTANCE_SECRET_KEY`).
 *   **`plaintext`** is the control, and works only against an instance that
 *   holds none — one with keys answers `sealed_required`.
 * - **`--unload`** is a shell command that unloads the model. It runs before
 *   each cold run; without it no cold run is made.
 * - **A new account every `--starts-per-account` starts**: the instance allows
 *   each athlete 12 starts an hour. On an instance whose registration is
 *   `approval` a new account is pending and its job is refused, so there the
 *   measurement needs `open` for its length, or one approved account and
 *   three hours.
 * - **`--origin`** is what the instance states as `OYL_INSTANCE_ORIGIN`, when
 *   it is reached at another address (the control, over loopback).
 *
 * - **`--hosted-url` and `--hosted-model`**, together, measure a hosted model
 *   on a key of your own instead of the instance's local one. ⚠️ **The key is
 *   read from the environment variable `OYL_MEASURE_HOSTED_KEY` and from
 *   nowhere else** — there is no option for it, so it is in no process list
 *   and no shell history — and it is printed nowhere. Each throwaway account
 *   stores it (sealed), consents to the URL's origin and pushes an empty
 *   masking item; when the run ends, or throws, the key and the consent are
 *   cleared and read back, and the report's `hosted.cleared` says whether
 *   every account read back empty. Sealed only, and refused with `--unload`:
 *   a hosted model has nothing to unload, so it has no cold runs. ⚠️ A run
 *   that is KILLED (Ctrl-C) clears nothing: revoke the key at its provider.
 *
 * The job is the ride write-up that exists, over a synthetic ride — see
 * `replan-round-trip-run.ts` for why and what that does and does not say
 * about a re-plan.
 *
 * Prints ONE JSON object. It carries no token, no athlete id, no model text
 * and no coordinate.
 */

import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { hostedFromCommand, measure } = await import('./replan-round-trip-run.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const url = arg('--url');
const transport = arg('--transport') ?? 'sealed';
if (url === undefined || (transport !== 'sealed' && transport !== 'plaintext')) {
  process.stderr.write(
    "usage: node tools/replan-round-trip.ts --url https://… [--transport sealed|plaintext] [--runs 30] [--cold-runs 5] [--unload '<command>'] [--origin https://…] [--starts-per-account 12] [--run-timeout-seconds 660] [--hosted-url https://… --hosted-model <name>, with the key in OYL_MEASURE_HOSTED_KEY]\n",
  );
  process.exit(2);
}
const unload = arg('--unload');
const origin = arg('--origin');
let hosted: ReturnType<typeof hostedFromCommand>;
try {
  hosted = hostedFromCommand(arg('--hosted-url'), arg('--hosted-model'), process.env);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'the hosted options are not usable'}\n`,
  );
  process.exit(2);
}
const report = await measure({
  url,
  transport,
  runs: Number(arg('--runs') ?? 30),
  coldRuns: Number(arg('--cold-runs') ?? 5),
  startsPerAccount: Number(arg('--starts-per-account') ?? 12),
  runTimeoutMs: Number(arg('--run-timeout-seconds') ?? 660) * 1000,
  log: (line) => process.stderr.write(`${line}\n`),
  ...(origin === undefined ? {} : { origin }),
  ...(hosted === undefined ? {} : { hosted }),
  ...(unload === undefined
    ? {}
    : {
        unload: () => {
          // A model the last run never loaded is already unloaded, and the
          // command says so by failing: that is no reason to lose the run.
          try {
            execFileSync('/bin/sh', ['-c', unload], { stdio: 'ignore' });
          } catch {
            process.stderr.write('the unload command failed; carrying on\n');
          }
          return Promise.resolve();
        },
      }),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
