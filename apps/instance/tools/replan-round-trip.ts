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
 * - **`--unload`** is a shell command that unloads the model, run by this
 *   machine's own shell (`cmd.exe` on Windows, `/bin/sh` elsewhere). It runs
 *   before each cold run; without it no cold run is made. A cold run after an
 *   unload command that failed is kept in the report as `unloaded: false`
 *   and counted in no cold figure: it may have run on a loaded model.
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
 *   nowhere else** — it is not an argument, and there is no option for it
 *   (`--hosted-key` is refused) — and it is printed nowhere. Set it for the
 *   one command from a file, `OYL_MEASURE_HOSTED_KEY="$(cat key-file)" node …`:
 *   a key typed at a prompt is in the shell's history, and a process's
 *   environment can be read by the same user. Each throwaway account
 *   stores it (sealed), consents to the URL's origin and pushes an empty
 *   masking item; when the run ends, or throws, the key and the consent are
 *   cleared and read back, and the report's `hosted.cleared` says whether
 *   every account read back empty. When one did not, the command exits 3 and
 *   its last line on stderr says to revoke the key. When the run throws there
 *   is no report: each account's line on stderr is then the only record.
 *   An account is cleared as soon as the run is done with it, and each
 *   clean-up is tried three times before it is reported as not confirmed.
 *   Sealed only, and refused with `--unload`: a hosted model has nothing to
 *   unload, so it has no cold runs. The first Ctrl-C (or SIGTERM) stops the
 *   run, clears every account and exits 130 — or 3, saying to revoke the key.
 *   Every request the tool sends refuses a redirect. ⚠️ A run that is KILLED
 *   (a second Ctrl-C, SIGKILL), or whose stderr is closed under it, clears
 *   nothing: revoke the key at its provider.
 *   ⚠️ **"Sealed" here is less than the app's.** The app seals to a key it
 *   judged against an identity pinned from the instance's card (ADR 0047
 *   D-5, D-6). This tool pins nothing and checks no statement: it seals to
 *   whatever encryption key `--url` serves. So a hosted run is refused unless
 *   `--url` is `https:` or loopback, and over `https:` the key is sealed to
 *   whoever terminates TLS for that name — through a tunnel, the tunnel's
 *   operator. Use a key you can revoke.
 * - **An option this command does not have is refused**, by name and never
 *   with its value; a name too long to be an option's is not repeated, and
 *   neither is a value that is not a URL.
 *
 * The job is the ride write-up that exists, over a synthetic ride — see
 * `replan-round-trip-run.ts` for why and what that does and does not say
 * about a re-plan.
 *
 * Prints ONE JSON object. It carries no token, no athlete id, no model text
 * and no coordinate.
 */

import { execSync } from 'node:child_process';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { hostedFromCommand, INTERRUPTED, KEY_NOT_CLEARED, measure, refusedArguments } =
  await import('./replan-round-trip-run.ts');

const OPTIONS = [
  '--url',
  '--transport',
  '--runs',
  '--cold-runs',
  '--unload',
  '--origin',
  '--starts-per-account',
  '--run-timeout-seconds',
  '--hosted-url',
  '--hosted-model',
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const refused = refusedArguments(process.argv.slice(2), OPTIONS);
if (refused !== undefined) {
  process.stderr.write(`${refused}\n`);
  process.exit(2);
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
// Hosted, the first Ctrl-C (or SIGTERM) clears the key before the command
// ends; a second one, with the handlers gone, ends it at once.
const stop = new AbortController();
if (hosted !== undefined) {
  for (const name of ['SIGINT', 'SIGTERM'] as const) {
    process.once(name, () => {
      process.stderr.write('interrupted: clearing the hosted key from every account\n');
      stop.abort();
    });
  }
}
const measuring = measure({
  url,
  signal: stop.signal,
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
          // A failed unload does not stop the measurement, but the run after
          // it is not a cold one: the model may still be loaded (#1271). A
          // model never loaded makes the command fail too, so that run is
          // kept as `unloaded: false` rather than lost.
          try {
            execSync(unload, { stdio: 'ignore' });
            return Promise.resolve(true);
          } catch {
            process.stderr.write('the unload command failed\n');
            return Promise.resolve(false);
          }
        },
      }),
});
let report: Awaited<typeof measuring>;
try {
  report = await measuring;
} catch (error) {
  if (!stop.signal.aborted) throw error;
  // The run in flight is abandoned, not awaited: it may take minutes.
  const cleared = error instanceof Error && error.message === INTERRUPTED;
  process.stderr.write(`${cleared ? INTERRUPTED : KEY_NOT_CLEARED}\n`);
  process.exit(cleared ? 130 : 3);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.hosted?.cleared === false) {
  // A key left behind is not a run that ended well, whatever it measured.
  process.stderr.write(`${KEY_NOT_CLEARED}\n`);
  process.exitCode = 3;
}
