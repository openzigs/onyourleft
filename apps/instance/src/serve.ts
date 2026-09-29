// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import manifest from '../package.json' with { type: 'json' };
import { readConfig } from './config.ts';
import { createHandler } from './handler.ts';
import { logEvent, type LogSink } from './log.ts';
import { listen } from './node-listener.ts';

/**
 * What `main.ts` starts, once the resolve hook is registered (#767, #780).
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
});

if (!result.ok) {
  for (const problem of result.problems) process.stderr.write(`instance: ${problem}\n`);
  process.exit(1);
}

const { config } = result;
const notices = readFileSync(new URL('../third-party.txt', import.meta.url), 'utf8');
const handler = createHandler({ config, version: manifest.version, notices, log });
const listening = await listen(handler, { host: config.host, port: config.port });
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
