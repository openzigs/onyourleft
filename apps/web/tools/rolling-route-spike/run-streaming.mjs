// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: tiles read an hour and the lead at 40 km/h, written to
 * `results/streaming.json`. From `apps/web`, after `run-page.mjs`:
 *
 *     node tools/rolling-route-spike/run-streaming.mjs
 *
 * The time a block takes to be ready is the page's own measurement on this
 * machine (`results/*.json`): its slowest block read plus its slowest plan
 * latency over every run. The tablet's is owed (the write-up says by whom).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

import { runnerImport } from 'vite';

const load = async (path) =>
  (await runnerImport(fileURLToPath(new URL(path, import.meta.url)))).module;
const { hourRide, leadNeeded } = await load('./streaming.ts');
const { streamRide } = await load('./block-grid.ts');

const results = fileURLToPath(new URL('./results/', import.meta.url));
const runs = readdirSync(results)
  .filter((name) => name.endsWith('.json') && name !== 'streaming.json')
  .map((name) => JSON.parse(readFileSync(`${results}${name}`, 'utf8')));
const readMs = Math.max(...runs.map((run) => run.blocks.readMsMax));
const planMs = Math.max(...runs.map((run) => run.plans.latencyMsMax));
const readyAfterMs = Math.ceil(readMs + planMs);

const PLACES = {
  suburb: { latitude: 41.8885, longitude: -87.7945 },
  city: { latitude: 41.8819, longitude: -87.6278 },
};
const SEEDS = [1, 2, 3, 4, 5];
const NEED = 400;
const LEAD = 200;

const perHour = {};
for (const pattern of ['random', 'staircase']) {
  for (const size of [1, 2, 4]) {
    for (const kmh of [30, 40]) {
      const counts = Object.values(PLACES).flatMap((start) =>
        SEEDS.map(
          (seed) =>
            streamRide({
              path: hourRide(start, seed, kmh, pattern),
              stepSeconds: 1,
              size,
              need: NEED,
              lead: LEAD,
              readyAfterMs: 0,
            }).tilesPerHour,
        ),
      );
      counts.sort((a, b) => a - b);
      perHour[`${pattern}, block ${String(size)}, ${String(kmh)} km/h`] = {
        min: counts[0],
        median: counts[Math.floor(counts.length / 2)],
        max: counts[counts.length - 1],
      };
    }
  }
}

const leads = {};
for (const [name, multiple] of [
  ['as measured on this machine', 1],
  ['at 3x this machine', 3],
  ['at 5x this machine', 5],
]) {
  for (const size of [1, 2]) {
    const found = Object.values(PLACES).flatMap((start) =>
      SEEDS.map((seed) =>
        leadNeeded({
          path: hourRide(start, seed, 40),
          size,
          need: NEED,
          readyAfterMs: readyAfterMs * multiple,
        }),
      ),
    );
    leads[`${name}, block ${String(size)}`] = {
      readyAfterMs: readyAfterMs * multiple,
      leadMetresMax: found.includes(undefined) ? 'over 2000' : Math.max(...found),
    };
  }
}

const written = {
  need: NEED,
  leadUsedByThePage: LEAD,
  readMsMax: readMs,
  planLatencyMsMax: planMs,
  tilesPerHour: perHour,
  leadAt40kmh: leads,
};
writeFileSync(`${results}streaming.json`, `${JSON.stringify(written, null, 2)}\n`);
console.log(JSON.stringify(written, null, 2));
