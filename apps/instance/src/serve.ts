// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

import manifest from '../package.json' with { type: 'json' };
import { readConfig } from './config.ts';
import { InstanceRefusal, startInstance } from './instance.ts';
import { logEvent, type LogSink } from './log.ts';
import { readServerConfig } from './server-config.ts';

/**
 * What `main.ts` starts, once the resolve hook is registered (#767, #780).
 *
 * Every variable is read HERE, by name, and nowhere else — see `config.ts` and
 * `server-config.ts` for why, and `.env.example` for what each one means.
 */

const log: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

const http = readConfig({
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
const server = readServerConfig(
  {
    database: process.env.OYL_INSTANCE_DATABASE,
    blobs: process.env.OYL_INSTANCE_BLOBS,
    origin: process.env.OYL_INSTANCE_ORIGIN,
    roomWorkers: process.env.OYL_INSTANCE_ROOM_WORKERS,
    compression: process.env.OYL_INSTANCE_WS_COMPRESSION,
    metrics: process.env.OYL_INSTANCE_METRICS,
    pingIntervalMs: process.env.OYL_INSTANCE_PING_INTERVAL_MS,
    metricsToken: process.env.OYL_INSTANCE_METRICS_TOKEN,
  },
  availableParallelism(),
);

const problems = [...(http.ok ? [] : http.problems), ...(server.ok ? [] : server.problems)];
if (!http.ok || !server.ok) {
  for (const problem of problems) process.stderr.write(`instance: ${problem}\n`);
  process.exit(1);
}

const notices = readFileSync(new URL('../third-party.txt', import.meta.url), 'utf8');

let instance;
try {
  instance = await startInstance({
    config: http.config,
    server: server.config,
    version: manifest.version,
    notices,
    log,
  });
} catch (error) {
  if (error instanceof InstanceRefusal) {
    process.stderr.write(`instance: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
const running = instance;

logEvent(log, 'listening', {
  url: running.url,
  version: manifest.version,
  commit: http.config.commit,
});

// Docker stops a container with SIGTERM and waits before it kills it — 20 s in
// `deploy/home/compose.yaml` (`stop_grace_period`), 10 s by Docker's default:
// rooms are told the server is stopping, results already final are written,
// and the store is closed well inside either.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logEvent(log, 'stopping', { signal });
    void running.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
