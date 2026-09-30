// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../node-imports.ts';

/**
 * `node src/operator/cli.ts <command> …` — the operator's commands (#791):
 * `migrate`, `backup`, `restore`, `verify`, `room-open`. `commands.ts` says
 * what each does. The resolve hook goes first, as in `main.ts`.
 *
 * The data it works on is where the instance keeps it: `OYL_INSTANCE_DATABASE`
 * and `OYL_INSTANCE_BLOBS`, read here by name (`.env.example`), with the
 * instance's own defaults.
 */

registerHooks({ resolve: resolveExtensionless });

const { runCommand } = await import('./run.ts');
process.exitCode = await runCommand(process.argv.slice(2), {
  database: process.env.OYL_INSTANCE_DATABASE,
  blobs: process.env.OYL_INSTANCE_BLOBS,
});
