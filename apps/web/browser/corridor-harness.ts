// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route's corridor, read in a real engine — #1539.
 *
 * Through the product's own port (`world-data/corridor-port.ts`), the
 * product's own reader and its one `fetch` (`world-data/corridor-source.ts`),
 * into the product's store in this origin's real IndexedDB, from the synthetic
 * archive `corridor-fixture.ts` emits at this origin. The map-tiles switch is
 * read from `localStorage` exactly as `main.tsx` reads it, so a spec turns it
 * off the way a rider's Settings would.
 *
 * Publishes `window.__oylCorridor`: the state the read came to, how many tiles
 * were covered, the feature counts, and two digests of what the scene builds
 * at the start line — with the corridor (if any) and with none. Nothing reads
 * the corridor into the scene yet (#1540), so the two are equal; the offline
 * control asserts that they are, which is the browser half of "offline, the
 * world is today's".
 *
 * ⚠️ What it does NOT prove: anything about the hosted archive's latency
 * (ADR 0010 D-1's 500 ms+; #1553 measures that on the tablet), or that the
 * realistic world draws anything from the corridor (#1540).
 */

import { openActivityStore } from '@onyourleft/store';
import { unixSeconds } from '@onyourleft/domain';

import { corridorOrigin } from '../src/game/terrain';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import type { CorridorState, WorldCorridor } from '../src/game/world-data/corridor';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { readMapTilesChoice } from '../src/map/tiles-preference';
import { createWorldCorridorPort } from '../src/world-data/corridor-port';
import { corridorArchive } from '../src/world-data/corridor-source';
import { routeId } from '@onyourleft/store';

import {
  CORRIDOR_ARCHIVE_FILE,
  corridorFixtureRoute,
  LONG_CORRIDOR_ARCHIVE_FILE,
} from './corridor-fixture';

/** `?long`: the 600-tile corridor, for the performance budget. */
const LONG = new URLSearchParams(location.search).has('long');

export interface CorridorHarness {
  readonly state: CorridorState['kind'];
  readonly why: string | undefined;
  readonly coveredTiles: number;
  readonly buildings: number;
  readonly landUse: number;
  readonly paths: number;
  readonly sceneDigest: string;
  readonly proceduralDigest: string;
  readonly milliseconds: number;
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __oylCorridor?: CorridorHarness;
  }
}

/** FNV-1a over what a frame stands in the world, so two frames compare as one string. */
function digestOf(corridor: WorldCorridor | undefined): string {
  const profile = corridorFixtureRoute(LONG);
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: atStartLine(profile),
    ...(corridor === undefined ? {} : { worldCorridor: corridor }),
  });
  const text = JSON.stringify([frame.scatter, frame.billboards, frame.streets, frame.lines]);
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return `${String(text.length)}:${hash.toString(16)}`;
}

async function run(): Promise<CorridorHarness> {
  const errors: string[] = [];
  const store = openActivityStore('oyl-corridor-harness');
  await ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
  const profile = corridorFixtureRoute(LONG);
  const id = routeId(LONG ? 'corridor-harness-long' : 'corridor-harness-route');
  await store.putRoute({
    id,
    createdBy: LOCAL_ATHLETE,
    name: 'Corridor harness',
    profile,
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  });
  const port = createWorldCorridorPort({
    store,
    owner: LOCAL_ATHLETE,
    basemap: () => ({
      archiveUrl: new URL(
        `/${LONG ? LONG_CORRIDOR_ARCHIVE_FILE : CORRIDOR_ARCHIVE_FILE}`,
        location.href,
      ).href,
      attribution: '',
    }),
    archive: corridorArchive,
    mapTilesOn: () => readMapTilesChoice(localStorage),
    realisticOn: () => true,
    recording: () => false,
    now: () => new Date(),
    log: (line) => errors.push(line),
  });
  const started = performance.now();
  const state = await port.load({ id, profile }, new AbortController().signal, () => undefined);
  const milliseconds = performance.now() - started;
  const ready = state.kind === 'ready' ? state.corridor : undefined;
  const kept = await store.getWorldCorridor(LOCAL_ATHLETE, id);
  store.close();
  return {
    state: state.kind,
    why: 'why' in state ? state.why : undefined,
    coveredTiles: kept?.tiles.filter((tile) => tile.state === 'covered').length ?? 0,
    buildings: ready?.buildings.length ?? 0,
    landUse: ready?.landUse.length ?? 0,
    paths: ready?.paths.length ?? 0,
    sceneDigest: digestOf(ready),
    proceduralDigest: digestOf(undefined),
    milliseconds,
    errors,
  };
}

void run().then(
  (result) => {
    window.__oylCorridor = result;
  },
  (error: unknown) => {
    window.__oylCorridor = {
      state: 'unavailable',
      why: undefined,
      coveredTiles: 0,
      buildings: 0,
      landUse: 0,
      paths: 0,
      sceneDigest: '',
      proceduralDigest: '',
      milliseconds: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  },
);
