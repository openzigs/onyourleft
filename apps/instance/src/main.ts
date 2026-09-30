// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import manifest from '../package.json' with { type: 'json' };
import { readConfig } from './config.ts';
import { createHandler } from './handler.ts';
import { logEvent, type LogSink } from './log.ts';
import { listen } from './node-listener.ts';

/**
 * The instance's entry point: `node src/main.ts` (#767).
 *
 * Node 24 strips the types itself, so there is no build step and the image
 * runs these files as they are committed. `scripts/check-wiring.mjs` reads this
 * path out of `package.json`'s `main`, because the instance has no
 * `index.html` for it to read one from.
 *
 * Every variable is read HERE, by name, and nowhere else — see `config.ts` for
 * why, and `.env.example` for what each one means.
 */

const log: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

const result = readConfig({
  host: process.env.OYL_INSTANCE_HOST,
  port: process.env.OYL_INSTANCE_PORT,
  commit: process.env.OYL_INSTANCE_COMMIT,
  sourceUrl: process.env.OYL_INSTANCE_SOURCE_URL,
  registration: process.env.OYL_INSTANCE_REGISTRATION,
  ownerKey: process.env.OYL_INSTANCE_OWNER_KEY,
  deputyKey: process.env.OYL_INSTANCE_DEPUTY_KEY,
  publicRoomMinAccountDays: process.env.OYL_INSTANCE_PUBLIC_ROOM_MIN_ACCOUNT_DAYS,
  publicRoomMinRides: process.env.OYL_INSTANCE_PUBLIC_ROOM_MIN_RIDES,
  clientAddressHeader: process.env.OYL_INSTANCE_CLIENT_ADDRESS_HEADER,
  trustedProxies: process.env.OYL_INSTANCE_TRUSTED_PROXIES,
});

if (!result.ok) {
  for (const problem of result.problems) process.stderr.write(`instance: ${problem}\n`);
  process.exit(1);
}

const { config } = result;
const notices = readFileSync(new URL('../third-party.txt', import.meta.url), 'utf8');
const handler = createHandler({ config, version: manifest.version, notices, log });
// ⚠️ No identity yet: the image installs no `kysely`, so this entry point opens
// no database and every account route answers `unavailable` until #780 wires
// the store. When it does, `identitySettings(config)` is what it hands
// `createIdentity` — the registration mode, the moderators and the
// public-room thresholds read above.
const listening = await listen(handler, {
  host: config.host,
  port: config.port,
  clientAddressHeader: config.clientAddressHeader,
  trustedProxies: config.trustedProxies,
});
logEvent(log, 'listening', {
  url: listening.url,
  version: manifest.version,
  commit: config.commit,
});

// Docker stops a container with SIGTERM and waits; an instance that ignores it
// is killed ten seconds later with whatever it had in flight.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logEvent(log, 'stopping', { signal });
    void listening.close().then(() => process.exit(0));
  });
}
