// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  RoutingError,
  type HeightProfile,
  type RoutingProvider,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { RouteHeights } from '../terrain/heights';

import { RIDING_DEFAULTS } from './preferences';
import { scriptedProvider } from './testing';
import { heightIntervalOf, NO_HEIGHTS_TEXT, routingTiers } from './tiers';
import { valhallaBrowserProvider } from './valhalla-browser-provider';

// Synthetic points off Null Island: no road, no place.
const at = (latitude: number, longitude: number) =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
const REQUEST = {
  waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
  preferences: RIDING_DEFAULTS,
};
const LINE = { shape: [at(0.05, 0.05), at(0.06, 0.06)], interval: metres(30) };

const TERRAIN_PROFILE: HeightProfile = {
  source: { name: 'the terrain archive', resolution: metres(15) },
  samples: [],
};

function terrain(): RouteHeights & { asked: number } {
  const heights = {
    asked: 0,
    interval: metres(15),
    heights: () => {
      heights.asked += 1;
      return Promise.resolve(TERRAIN_PROFILE);
    },
  };
  return heights;
}

/** A browser maker that counts how often it was asked for an engine. */
function countingBrowser(engine: RoutingProvider = scriptedProvider()) {
  const made = { count: 0 };
  return {
    made,
    browser: () => {
      made.count += 1;
      return engine;
    },
  };
}

describe('which engine routes a leg (#2734)', () => {
  it('is none at all with no instance and no graph: the planner draws straight lines', () => {
    expect(routingTiers({ heights: terrain() })).toBeUndefined();
  });

  it('with an instance that answers, never makes the browser engine, so its graph is never fetched', async () => {
    const instance = scriptedProvider();
    const { made, browser } = countingBrowser();
    const tiers = routingTiers({ instance, browser, heights: terrain() });
    await tiers?.route(REQUEST);
    await tiers?.heights(LINE);
    expect(instance.routeCalls).toHaveLength(1);
    expect(instance.heightCalls).toHaveLength(1);
    expect(made.count).toBe(0);
  });

  it('with an instance that answers, starts no in-browser engine and fetches no graph: counted at the SDK', async () => {
    // The same, one layer down: the real adapter, whose router is never made.
    let routers = 0;
    const browser = () =>
      valhallaBrowserProvider({
        graph: { manifestUrl: 'https://tiles.example.org/routing/r/manifest.json' },
        mapTilesOn: () => true,
        createRouter: () => {
          routers += 1;
          return Promise.reject(new Error('the graph was fetched'));
        },
      });
    const tiers = routingTiers({ instance: scriptedProvider(), browser });
    await expect(tiers?.route(REQUEST)).resolves.toHaveLength(1);
    expect(routers).toBe(0);
  });

  it('goes to the browser engine when the instance cannot be reached, and makes it once', async () => {
    const instance = scriptedProvider();
    instance.failEveryRoute(new RoutingError('unavailable', 'Your instance could not be reached.'));
    const engine = scriptedProvider();
    const { made, browser } = countingBrowser(engine);
    const tiers = routingTiers({ instance, browser });
    await tiers?.route(REQUEST);
    await tiers?.route(REQUEST);
    expect(engine.routeCalls).toHaveLength(2);
    expect(made.count).toBe(1);
  });

  it('takes any other answer from the instance as the answer, a privacy-zone refusal included', async () => {
    const instance = scriptedProvider();
    instance.failEveryRoute(new RoutingError('no-route', 'This leg starts in a privacy zone.'));
    const { made, browser } = countingBrowser();
    const tiers = routingTiers({ instance, browser });
    await expect(tiers?.route(REQUEST)).rejects.toMatchObject({ code: 'no-route' });
    expect(made.count).toBe(0);
  });

  it('with no instance, routes in the browser and measures on the terrain archive at its spacing', async () => {
    const engine = scriptedProvider();
    const heights = terrain();
    const tiers = routingTiers({ browser: () => engine, heights });
    if (tiers === undefined) throw new Error('no tiers');
    await tiers.route(REQUEST);
    expect(engine.routeCalls).toHaveLength(1);
    await expect(tiers.heights(LINE)).resolves.toBe(TERRAIN_PROFILE);
    expect(engine.heightCalls).toHaveLength(0);
    expect(heightIntervalOf(tiers)).toBe(15);
  });

  it('asks the instance for heights at the planner’s spacing, and the terrain when it cannot answer', async () => {
    const instance = scriptedProvider();
    const heights = terrain();
    const tiers = routingTiers({ instance, heights });
    if (tiers === undefined) throw new Error('no tiers');
    expect(heightIntervalOf(tiers)).toBeUndefined();
    const down: RoutingProvider = {
      route: (request) => instance.route(request),
      heights: () => Promise.reject(new RoutingError('unavailable', 'unreachable')),
    };
    await expect(routingTiers({ instance: down, heights })?.heights(LINE)).resolves.toBe(
      TERRAIN_PROFILE,
    );
    expect(heights.asked).toBe(1);
  });

  it('says so when no tier has heights', async () => {
    await expect(
      routingTiers({ browser: () => scriptedProvider() })?.heights(LINE),
    ).rejects.toThrow(NO_HEIGHTS_TEXT);
  });

  it('reads no interval from a provider that is not the tiers', () => {
    expect(heightIntervalOf(scriptedProvider())).toBeUndefined();
  });
});
