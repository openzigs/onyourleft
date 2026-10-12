// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement #1106 asks for: *"about 5 pictures a second over the
 * tunnel, against what the side analysis needs"*. A throwaway device offers
 * an instance a side-camera-sized picture every `--interval-ms`, one at a
 * time as the tablet does, and records how many were looked at, how long each
 * took and what each cost on the wire. Not a test and not a gate.
 *
 *     node tools/side-picture-round-trip.ts --loopback [--model-ms 400]
 *     node tools/side-picture-round-trip.ts --url https://rides.example.org \
 *       [--origin https://…]
 *     …and with either: [--pictures 50] [--interval-ms 200]
 *       [--picture-bytes 24576] [--source instance-local]
 *
 * - **`--loopback`** starts an instance on this machine for the run —
 *   `side-picture-loopback.ts`: a temporary database, its own keys, and a
 *   scripted picture model that answers after `--model-ms` — and stops it
 *   afterwards. It reads and changes no other instance. It measures the
 *   transport, the sealing and the instance; the model's time is the number
 *   you gave it.
 * - **`--url`** measures a running instance instead, which must hold keys
 *   (`OYL_INSTANCE_SECRET_KEY`), name a picture model
 *   (`OYL_INSTANCE_PICTURE_MODEL`) and admit a new device. ⚠️ Through a tunnel
 *   this is the run the owner has to allow: it registers a throwaway account
 *   on that instance and asks its model about each picture.
 * - **The pictures are of nobody**: a JPEG's opening and filler of
 *   `--picture-bytes` (at most 65536).
 * - **`--source instance-hosted`** is refused here: a hosted model is
 *   measured only with a key and a consent, and this command holds neither.
 *
 * Prints ONE JSON object. It carries no token, no athlete id and no picture.
 */

import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { refusedArguments } = await import('./replan-round-trip-run.ts');
const { measurePictures } = await import('./side-picture-round-trip-run.ts');

const VALUED = [
  '--url',
  '--origin',
  '--model-ms',
  '--pictures',
  '--interval-ms',
  '--picture-bytes',
  '--source',
];

const given = process.argv.slice(2);
const loopback = given.includes('--loopback');
const refused = refusedArguments(
  given.filter((word) => word !== '--loopback'),
  VALUED,
);

function arg(name: string): string | undefined {
  const index = given.indexOf(name);
  return index < 0 ? undefined : given[index + 1];
}

function whole(name: string, fallback: number, least: number, most: number): number {
  const text = arg(name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < least || value > most) {
    process.stderr.write(
      `${name} must be a whole number from ${String(least)} to ${String(most)}\n`,
    );
    process.exit(2);
  }
  return value;
}

const url = arg('--url');
const source = arg('--source') ?? 'instance-local';
if (refused !== undefined || loopback === (url !== undefined) || source !== 'instance-local') {
  process.stderr.write(
    `${refused ?? (source !== 'instance-local' ? '--source instance-hosted is not measured by this command: it holds no key and no consent' : 'give --loopback or --url, and not both')}\n` +
      'usage: node tools/side-picture-round-trip.ts (--loopback [--model-ms 400] | --url https://… [--origin https://…]) [--pictures 50] [--interval-ms 200] [--picture-bytes 24576]\n',
  );
  process.exit(2);
}

const pictures = whole('--pictures', 50, 1, 5_000);
const intervalMs = whole('--interval-ms', 200, 1, 60_000);
const pictureBytes = whole('--picture-bytes', 24_576, 64, 65_536);
const modelMs = whole('--model-ms', 400, 0, 60_000);
const origin = arg('--origin');

let started;
if (loopback) {
  const { startLoopbackInstance } = await import('./side-picture-loopback.ts');
  started = await startLoopbackInstance({ modelMs, pictures });
}
try {
  const report = await measurePictures({
    url: started?.url ?? url ?? '',
    ...(started !== undefined
      ? { origin: started.origin }
      : origin === undefined
        ? {}
        : { origin }),
    pictures,
    intervalMs,
    pictureBytes,
    source: 'instance-local',
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(
    `${JSON.stringify({ ...report, ...(loopback ? { loopback: { modelMs } } : {}) }, null, 2)}\n`,
  );
} finally {
  await started?.close();
}
