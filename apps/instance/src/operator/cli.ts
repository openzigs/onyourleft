// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../node-imports.ts';

/**
 * `node src/operator/cli.ts <command> …` — the operator's commands (#791):
 * `migrate`, `backup`, `backup-loop`, `restore`, `verify`, `room-open`, `model-key`, `instance-key`, `load-accounts`, `account-erase`, `analysis-settings`, `admin-code`, `admin-passkeys`. `commands.ts` says
 * what each does. The resolve hook goes first, as in `main.ts`.
 *
 * The data it works on is where the instance keeps it: `OYL_INSTANCE_DATABASE`
 * and `OYL_INSTANCE_BLOBS`, read here by name (`.env.example`), with the
 * instance's own defaults.
 */

registerHooks({ resolve: resolveExtensionless });

/**
 * Standard input, whole: `model-key set` reads the key from it and from
 * nowhere else, `load-accounts add` the public keys, and `account-erase` the
 * rider's recovery code.
 */
async function readStandardInput(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * `backup-loop` runs until it is stopped (#2606): the `backup` service's
 * `docker compose stop` sends SIGTERM, and a run in progress finishes first.
 * Only that command is given the handlers — every other one keeps Node's own
 * answer to Ctrl-C.
 */
const stop = new AbortController();
if (process.argv[2] === 'backup-loop') {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());
}

// #2781 (ADR 0080 D-4): the secret as the instance reads it — `.env`, else
// its file in the secrets folder — which a command READS and never makes:
// only the instance's own start chooses it. No log line: a command's
// standard output is its JSON report.
const { resolveSecrets } = await import('../setup/secrets.ts');
const secrets = await resolveSecrets(
  {
    directory: process.env.OYL_INSTANCE_SECRETS_DIR,
    secretKey: process.env.OYL_INSTANCE_SECRET_KEY,
    database: process.env.OYL_INSTANCE_DATABASE,
    blobs: process.env.OYL_INSTANCE_BLOBS,
  },
  { log: () => undefined, generate: false },
);
if (secrets.ok) {
  const { runCommand } = await import('./run.ts');
  process.exitCode = await runCommand(process.argv.slice(2), {
    signal: stop.signal,
    database: process.env.OYL_INSTANCE_DATABASE,
    blobs: process.env.OYL_INSTANCE_BLOBS,
    secret: secrets.secretKey,
    ownerKey: process.env.OYL_INSTANCE_OWNER_KEY,
    origin: process.env.OYL_INSTANCE_ORIGIN,
    readStandardInput,
  });
} else {
  for (const problem of secrets.problems) process.stderr.write(`operator: ${problem}\n`);
  process.exitCode = 1;
}
