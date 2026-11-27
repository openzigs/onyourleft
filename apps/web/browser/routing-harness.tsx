// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-browser routing in a real engine — #2734.
 *
 * Vitest cannot run `valhalla-browser`: it needs a module worker, WebAssembly
 * and Web Crypto. So the adapter's own suite (`src/routing/valhalla-browser-provider.test.ts`)
 * runs against a router double, and this page is the other half: the
 * **product's** adapter, loading the **real** SDK by its dynamic import, its
 * worker and its WebAssembly from this origin, routing on the synthetic grid
 * off Null Island that `valhalla-grid.ts` serves with R2's headers.
 *
 * It publishes `window.__oylRouting`:
 *
 * - `contract()`: `src/routing/contract-testing.ts`'s checks, the ones the
 *   scripted double passes in Vitest, run against the adapter;
 * - `contractWithTilesOff()`: the same with map tiles off, the control: every
 *   check that routes must fail, so a green `contract()` is about the engine;
 * - `drag()`: five waypoints routed, the middle one moved, and the engine's
 *   `route()` calls counted at the SDK's own router, before and after;
 * - `refusals()`: what the planner makes of a leg off the graph, of a leg
 *   to a point inside the graph's coverage that no road is near, and of a leg
 *   to the unconnected square beside the grid;
 * - `saved()`: the routes this page's planner saved, read back from the store.
 *
 * And it mounts the **real** route planner, with the in-browser tier as its
 * engine and the real local store as its routes, its first waypoint on the
 * grid, for `routing.browser.spec.ts` to draw a route on with the network on
 * and off.
 *
 * ## What it does not prove
 *
 * Anything about the published graph or its host, or about a tablet: a
 * 140 KB grid in headless Chromium on loopback says that the code works, not
 * how fast a state's graph is on a phone. The tablet check is the owner's.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { openActivityStore, type RouteRecord } from '@onyourleft/store';

import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';
import { runRoutingContract } from '../src/routing/contract-testing';
import {
  addWaypoint,
  emptyDraft,
  moveWaypoint,
  resolveDraft,
  type RouteDraft,
} from '../src/routing/draft';
import { browserDraftStorage } from '../src/routing/draft-storage';
import { RIDING_DEFAULTS } from '../src/routing/preferences';
import { routingTiers } from '../src/routing/tiers';
import {
  loadBrowserRouter,
  valhallaBrowserProvider,
  type BrowserRouter,
  type CreateBrowserRouter,
} from '../src/routing/valhalla-browser-provider';
import { RouteBuilderView } from '../src/views/RouteBuilderView';

import { GRID_PATH, GRID_RELEASE } from './valhalla-grid-release';

import '../src/design/theme.css';
import '../src/design/tailwind.css';

type Results = Awaited<ReturnType<typeof runRoutingContract>>;

interface RoutingHarness {
  readonly ready: boolean;
  contract(): Promise<Results>;
  contractWithTilesOff(): Promise<Results>;
  drag(): Promise<{ readonly drawn: number; readonly dragged: number }>;
  refusals(): Promise<{
    readonly offTheGraph: {
      readonly mode: string | undefined;
      readonly message: string | undefined;
    };
    readonly farFromRoads: {
      readonly mode: string | undefined;
      readonly message: string | undefined;
    };
    readonly unconnected: {
      readonly state: string | undefined;
      readonly message: string | undefined;
    };
  }>;
  saved(): Promise<readonly RouteRecord[]>;
}

declare global {
  interface Window {
    __oylRouting?: RoutingHarness;
  }
}

const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

const GRAPH = { manifestUrl: `${window.location.origin}${GRID_PATH}${GRID_RELEASE}/manifest.json` };

/**
 * Three waypoints on the grid's roads, each mid-block, so a leg between them
 * turns a corner: along the bottom street, up a column, along a street.
 */
const CONTRACT_POINTS = [at(0.05, 0.0525), at(0.0625, 0.065), at(0.075, 0.0725)] as const;

/**
 * Inside the graph's coverage rectangle and its one level-2 tile, about 7.7 km
 * north of the grid's top street, with no road nearer (#3179): the engine
 * snaps a waypoint here to the grid and answers a leg that never reaches it.
 */
const FAR_FROM_ROADS = at(0.22, 0.1);

/** Where the planner's first waypoint goes: on the bottom street, 22 m east of a corner. */
const PLANNER_ORIGIN = at(0.05, 0.0502);

/** A router that counts the legs the SDK is asked for. */
function counting(create: CreateBrowserRouter): {
  create: CreateBrowserRouter;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    create: async (graph) => {
      const router: BrowserRouter = await create(graph);
      return {
        route: (request, options) => {
          calls += 1;
          return router.route(request, options);
        },
        cancel: () => {
          router.cancel();
        },
      };
    },
  };
}

const inBrowser = (mapTilesOn: boolean, createRouter?: CreateBrowserRouter) =>
  valhallaBrowserProvider({
    graph: GRAPH,
    mapTilesOn: () => mapTilesOn,
    ...(createRouter === undefined ? {} : { createRouter }),
  });

async function drawn(
  points: readonly GeographicPosition[],
  engine: ReturnType<typeof inBrowser>,
): Promise<RouteDraft> {
  let draft = emptyDraft();
  for (const point of points) {
    const added = addWaypoint(draft, point, 'snapped');
    draft = await resolveDraft(added.draft, added.stale, engine, RIDING_DEFAULTS);
  }
  return draft;
}

async function run(): Promise<void> {
  const store = openActivityStore('oyl-routing-harness');
  // Every saved route names its athlete, as the app's own start makes sure of.
  await ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
  const harness: RoutingHarness = {
    ready: true,
    contract: () =>
      runRoutingContract({
        provider: inBrowser(true),
        points: CONTRACT_POINTS,
        preferences: RIDING_DEFAULTS,
        snapMetres: 30,
        farFromRoads: FAR_FROM_ROADS,
      }),
    contractWithTilesOff: () =>
      runRoutingContract({
        provider: inBrowser(false),
        points: CONTRACT_POINTS,
        preferences: RIDING_DEFAULTS,
        snapMetres: 30,
        farFromRoads: FAR_FROM_ROADS,
      }),
    drag: async () => {
      const counted = counting(loadBrowserRouter);
      const engine = inBrowser(true, counted.create);
      // Five waypoints up one column of the grid, 22 m east of it.
      const draft = await drawn(
        [0, 1, 2, 3, 4].map((step) => at(0.05 + step * 0.01, 0.0502)),
        engine,
      );
      const drawnCalls = counted.calls();
      const middle = draft.waypoints[2];
      if (middle === undefined) throw new Error('no middle waypoint');
      const moved = moveWaypoint(draft, middle.id, at(0.07, 0.0752));
      await resolveDraft(moved.draft, moved.stale, engine, RIDING_DEFAULTS);
      return { drawn: drawnCalls, dragged: counted.calls() - drawnCalls };
    },
    refusals: async () => {
      const engine = inBrowser(true);
      // Off the graph: north of the grid's tile, where the graph has nothing.
      const off = await drawn([at(0.05, 0.0525), at(0.3, 0.0525)], engine);
      // Inside the coverage, with no road near it: the engine snaps it to the grid.
      const far = await drawn([at(0.05, 0.0525), FAR_FROM_ROADS], engine);
      // To the square beside the grid that no road reaches.
      const island = await drawn([at(0.05, 0.0525), at(0.05, 0.2025)], engine);
      return {
        offTheGraph: { mode: off.legs[0]?.mode, message: off.legs[0]?.failure?.message },
        farFromRoads: { mode: far.legs[0]?.mode, message: far.legs[0]?.failure?.message },
        unconnected: { state: island.legs[0]?.state, message: island.legs[0]?.failure?.message },
      };
    },
    saved: () => store.listRoutes(LOCAL_ATHLETE),
  };
  window.__oylRouting = harness;

  const host = document.getElementById('root');
  if (host === null) throw new Error('routing.html has no #root');
  createRoot(host).render(
    <StrictMode>
      <RouteBuilderView
        provider={routingTiers({ browser: () => inBrowser(true) })}
        origin={PLANNER_ORIGIN}
        storage={browserDraftStorage(undefined)}
        routes={{ athleteId: LOCAL_ATHLETE, store }}
      />
    </StrictMode>,
  );
}

void run();
