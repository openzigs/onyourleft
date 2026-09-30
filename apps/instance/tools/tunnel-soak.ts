// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tunnel measurement #807 asks for (#780 criterion 8): riders join one
 * room through the instance's PUBLIC hostname and ride for as long as asked,
 * and the run records every disconnect, how long each rejoin took, and the
 * longest the room went silent. Not a test and not a gate: it needs a running
 * instance behind a real tunnel, a room (`node src/operator/cli.ts room-open`)
 * and open registration while it signs its riders up.
 *
 *     node tools/tunnel-soak.ts --url https://rides.example.org --room tunnel \
 *       --minutes 30 [--riders 2] [--keepalive-seconds 30]
 *
 *     node tools/tunnel-soak.ts --url https://rides.example.org --room tunnel-lobby \
 *       --idle-probe [--minutes 5]
 *
 * **The ride** is what a client does (#782 builds the real one): a hello with
 * a ticket, a power report twice a second, a WebSocket ping every
 * `--keepalive-seconds` (ADR 0037 D-8.1's 30 s), and — when the socket
 * closes — a new ticket and a new hello at once, which is a rejoin.
 *
 * **The idle probe** opens ONE socket to a race lobby (no frames), sends
 * nothing and answers no ping, and reports how long the tunnel let it live:
 * the idle timeout the ride's keepalive must be shorter than. Run it with the
 * instance's own ping off (`OYL_INSTANCE_PING_INTERVAL_MS=0`), and turn it back
 * on after — with the ping on, the socket is never idle and the probe
 * measures nothing (it says so).
 *
 * Prints ONE JSON object: what #807's PR records. It carries no token, no
 * athlete id and no coordinate.
 */

import { registerHooks } from 'node:module';

import { resolveExtensionless } from '../src/node-imports.ts';

registerHooks({ resolve: resolveExtensionless });

const { soak, idleProbe } = await import('./tunnel-soak-run.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const url = arg('--url');
const room = arg('--room');
if (url === undefined || room === undefined) {
  process.stderr.write(
    'usage: node tools/tunnel-soak.ts --url https://… --room <id> [--minutes 30] [--riders 2] [--keepalive-seconds 30] [--idle-probe]\n',
  );
  process.exit(2);
}
const minutes = Number(arg('--minutes') ?? (process.argv.includes('--idle-probe') ? 5 : 30));
const report = process.argv.includes('--idle-probe')
  ? await idleProbe({ url, roomId: room, maximumMs: minutes * 60_000 })
  : await soak({
      url,
      roomId: room,
      durationMs: minutes * 60_000,
      riders: Number(arg('--riders') ?? 2),
      keepaliveMs: Number(arg('--keepalive-seconds') ?? 30) * 1000,
    });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
