// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A race-length load run on one room (#464): N riders race one room through
 * the instance's PUBLIC hostname, and the run records what reached them —
 * frame lateness, ticks that never arrived, disconnects and rejoins, and the
 * bytes each way. Not a test and not a gate: it needs a running instance, a
 * race room (`node src/operator/cli.ts room-open <id> --kind race …`) and
 * riders the instance will ticket.
 *
 *     node tools/race-load.ts keys --riders 50 --out <file>
 *     node tools/race-load.ts ride --url https://rides.example.org --room <id> \
 *       --keys <file> [--name Load] [--minutes 90]
 *
 * **`keys`** writes N new device keys to `<file>` (mode 600) and prints their
 * PUBLIC keys, one per line. The private keys are a secret like any device
 * key's: keep the file out of the repository and delete it after.
 *
 * **`ride`** signs each key in through the instance's own sign-in. ⚠️ On an
 * instance whose registration is `approval`, a key it has never seen is a new
 * account AWAITING approval, and is refused a ticket: the riders must be
 * approved (or the instance's registration open) before the run, and erased
 * after. The run ends when the room says the race is over, or at `--minutes`.
 * The machine's CPU and the tunnel's bandwidth are measured beside it, not by
 * it: what the run costs the host is the host's to read.
 *
 * Prints ONE JSON object. It carries no token, no athlete id, no display name
 * and no coordinate.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { newRiderKeys, raceLoad } = await import('./race-load-run.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const USAGE =
  'usage: node tools/race-load.ts keys --riders <n> --out <file>\n' +
  '       node tools/race-load.ts ride --url https://… --room <id> --keys <file> [--name Load] [--minutes 90]\n';

const command = process.argv[2];
if (command === 'keys') {
  const riders = Number(arg('--riders'));
  const out = arg('--out');
  if (!Number.isInteger(riders) || riders < 1 || out === undefined) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const keys = await newRiderKeys(riders);
  await writeFile(out, `${JSON.stringify(keys)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${keys.map((key) => key.publicKey).join('\n')}\n`);
} else if (command === 'ride') {
  const url = arg('--url');
  const room = arg('--room');
  const keysFile = arg('--keys');
  if (url === undefined || room === undefined || keysFile === undefined) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const minutes = Number(arg('--minutes') ?? 90);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    process.stderr.write(`--minutes must be a positive number\n${USAGE}`);
    process.exit(2);
  }
  const keys: unknown = JSON.parse(await readFile(keysFile, 'utf8'));
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    !keys.every(
      (key: unknown) =>
        typeof key === 'object' &&
        key !== null &&
        typeof (key as { publicKey?: unknown }).publicKey === 'string' &&
        typeof (key as { privateKey?: unknown }).privateKey === 'string',
    )
  ) {
    process.stderr.write(
      'the keys file must hold a non-empty array of { publicKey, privateKey }\n',
    );
    process.exit(2);
  }
  const report = await raceLoad({
    url,
    roomId: room,
    keys: keys as { publicKey: string; privateKey: string }[],
    namePrefix: arg('--name') ?? 'Load',
    maximumMs: minutes * 60_000,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stderr.write(USAGE);
  process.exit(2);
}
