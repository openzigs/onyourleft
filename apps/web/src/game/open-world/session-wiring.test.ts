// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world session is constructed by the app's real entry** — #2896.
 *
 * ⚠️ **Why this file exists.** `GamePort.openWorld` is an optional member
 * threaded through JSX, which `check:wiring` cannot follow (§Limits): a
 * `main.tsx` that stopped supplying it would leave that gate green — the
 * session module is still imported, by `session-lazy.ts` — and every start
 * the picker hands over would be dropped with nothing said. So this holds
 * `main.tsx` to building the member over the tab's one entry, the same one the
 * picker hands its start to, and runs the lazy port's own loader to show it
 * opens the real session.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../units/no-inline-units';
import { createOpenWorldEntry } from './entry';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { lazyOpenWorldSessions } from './session-lazy';

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
const gamePort = main.slice(
  main.indexOf('function buildGamePort('),
  main.indexOf('function buildGameTrainerPort('),
);

describe('main.tsx hands the game the open-world session — #2896', () => {
  it('builds the game port’s openWorld over the tab’s one entry', () => {
    expect(gamePort.length).toBeGreaterThan(0);
    expect(gamePort).toMatch(
      /openWorld: lazyOpenWorldSessions\(\{\s*entry: openWorldEntry,\s*basemap: browserBasemapConfig,\s*mapTilesOn: \(\) => readMapTilesChoice\(deviceStorage\(\)\),\s*terrain: browserTerrainConfig,\s*riddenBlocks: \{ store, owner: LOCAL_ATHLETE \},\s*\}\)/,
    );
    expect(main).toMatch(
      /import \{ lazyOpenWorldSessions \} from '\.\/game\/open-world\/session-lazy';/,
    );
    // #2899: and the terrain archive the road's heights are read from, the
    // one #2013's planner reads.
    expect(main).toMatch(/import \{ browserTerrainConfig \} from '\.\/terrain\/config';/);
  });

  it('is the entry the start picker hands its start to', () => {
    expect(main.match(/const openWorldEntry = createOpenWorldEntry\(\);/g)).toHaveLength(1);
    const startPort = main.slice(
      main.indexOf('function buildOpenWorldStartPort('),
      main.indexOf('function buildRoutePort('),
    );
    expect(startPort).toMatch(/entry: openWorldEntry,/);
  });

  it('opens the real session through the lazy port’s own loader', async () => {
    const entry = createOpenWorldEntry();
    const start = fixtureStart(START_COLUMN, START_ROW);
    entry.hand(start);
    // No basemap configured and map tiles on: the real session's answer, which
    // a loader that made no session could not give.
    const sessions = lazyOpenWorldSessions({
      entry,
      basemap: () => undefined,
      mapTilesOn: () => true,
    });
    expect(sessions.take()).toBe(start);
    expect(sessions.take()).toBeUndefined();
    const session = sessions.open(start);
    expect(await session.ready).toStrictEqual({ kind: 'refused', refusal: 'no-map' });
    session.stop();
    const off = lazyOpenWorldSessions({ entry, basemap: () => undefined, mapTilesOn: () => false });
    expect(await off.open(start).ready).toStrictEqual({
      kind: 'refused',
      refusal: 'map-tiles-off',
    });
  });

  it('opens nothing when stopped before its modules load, and tries a failed load again', async () => {
    const start = fixtureStart(START_COLUMN, START_ROW);
    let loads = 0;
    let opened = 0;
    const sessions = lazyOpenWorldSessions(
      { entry: createOpenWorldEntry(), basemap: () => undefined, mapTilesOn: () => true },
      () => {
        loads += 1;
        if (loads === 1) return Promise.reject(new Error('chunk not fetched'));
        return Promise.resolve(() => {
          opened += 1;
          return { ready: Promise.resolve({ kind: 'stopped' }), stop: () => undefined };
        });
      },
    );
    expect(await sessions.open(start).ready).toStrictEqual({
      kind: 'refused',
      refusal: 'unavailable',
    });
    const stoppedFirst = sessions.open(start);
    stoppedFirst.stop();
    expect(await stoppedFirst.ready).toStrictEqual({ kind: 'stopped' });
    expect(loads).toBe(2);
    expect(opened).toBe(0);
  });
});
