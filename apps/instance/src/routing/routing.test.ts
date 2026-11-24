// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route planner's roads and heights through the instance (#2008): sealed
 * in, asked of the routing engine, answered, and kept nowhere.
 *
 * Every call is made as the app makes it — SEALED, through the real listener
 * over a real database file — and the engine is `valhalla-testing.ts`'s fake
 * Valhalla, so what the engine was sent is read off the wire and the real
 * client in `valhalla.ts` parses its answers. No fixture names a real place.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { syncWorld } from '../sync/sync-testing.ts';
import { ROUTING_HEIGHTS_PATH, ROUTING_ROUTE_PATH } from './routes.ts';
import { ELEVATION_DATASET } from './valhalla.ts';
import {
  FAKE_VERTICES,
  fakeValhalla,
  NOWHERE,
  NOWHERE_POINTS,
  type FakeValhalla,
} from './valhalla-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const PREFERENCES = { bicycle: 'road', hills: 'avoid', surface: 'prefer-paved' };

async function routingWorld(
  options: {
    engine?: FakeValhalla | 'none';
    keyless?: boolean;
    routeLimit?: { limit: number; windowMs: number };
  } = {},
) {
  const valhalla = options.engine === 'none' ? undefined : (options.engine ?? fakeValhalla());
  const synced = await syncWorld(1, {
    routing: {
      ...(valhalla === undefined ? {} : { engine: valhalla.engine() }),
      ...(options.routeLimit === undefined ? {} : { routeLimit: options.routeLimit }),
    },
    ...(options.keyless === true ? { keyless: true } : {}),
  });
  world = synced.world;
  return {
    world: synced.world,
    token: synced.riders[0]!.token,
    rider: synced.riders[0]!,
    valhalla,
  };
}

function codeOf(answer: { body: unknown }): string | undefined {
  return (answer.body as { error?: { code?: string } } | null)?.error?.code;
}

/** Every number in `text` written with three or more decimal places: how a coordinate reads. */
const COORDINATE_LIKE = /\d+\.\d{3,}/;

describe('roads between waypoints, from the instance’s routing engine (#2008)', () => {
  it('answers one snapped leg per pair, with its length and surface, asked of the engine by bicycle', async () => {
    const { world, token, valhalla } = await routingWorld();
    const answer = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
    });
    expect(answer.status).toBe(200);
    const legs = (
      answer.body as { legs: { shape: number[][]; distanceMetres: number; surface: string }[] }
    ).legs;
    expect(legs).toHaveLength(2);
    for (const [index, leg] of legs.entries()) {
      // Snapped, not a straight line between two pins (#71's first criterion).
      expect(leg.shape).toHaveLength(FAKE_VERTICES);
      expect(leg.shape[0]).toEqual(NOWHERE[index]);
      expect(leg.shape.at(-1)).toEqual(NOWHERE[index + 1]);
      expect(leg.distanceMetres).toBeGreaterThan(1000);
      expect(leg.surface).toBe('paved');
    }
    // What the engine was asked: the rider's named options in its numbers
    // (the table in `valhalla.ts`), no directions, and the waypoints.
    const route = valhalla!.requests.find((each) => each.action === 'route');
    expect(route?.body).toStrictEqual({
      locations: NOWHERE.map(([lat, lon]) => ({ lat, lon })),
      costing: 'bicycle',
      costing_options: {
        bicycle: { bicycle_type: 'road', use_hills: 0, avoid_bad_surfaces: 0.25 },
      },
      directions_type: 'none',
      units: 'kilometers',
    });
    // And each leg's surface was walked once.
    expect(valhalla!.requests.filter((each) => each.action === 'trace_attributes')).toHaveLength(2);
  });

  it('keeps no waypoint: not in the database, and not in a log line, even when the engine quotes one', async () => {
    const valhalla = fakeValhalla();
    const { world, token } = await routingWorld({ engine: valhalla });
    const body = { waypoints: NOWHERE_POINTS, preferences: PREFERENCES };
    expect((await world.call('POST', ROUTING_ROUTE_PATH, { token, body })).status).toBe(200);
    // An engine error whose own text quotes a coordinate, as Valhalla's can.
    valhalla.failNext('route', 400, {
      error_code: 442,
      error: `No path could be found for input near ${String(NOWHERE[0]![0])},${String(NOWHERE[0]![1])}`,
      status_code: 400,
    });
    const refused = await world.call('POST', ROUTING_ROUTE_PATH, { token, body });
    expect(codeOf(refused)).toBe('no_route');
    expect(JSON.stringify(refused.body)).not.toMatch(COORDINATE_LIKE);
    expect(JSON.stringify(refused.body)).not.toContain(String(NOWHERE[0]![0]));

    const lines = world.instance.lines.join('\n');
    // The control: a routing call IS logged, and says how it ended.
    expect(lines).toContain('"event":"routing-call"');
    expect(lines).toContain('"state":"routed"');
    expect(lines).toContain('"state":"no-route"');
    for (const [lat, lon] of NOWHERE) {
      expect(lines).not.toContain(String(lat));
      expect(lines).not.toContain(String(lon));
    }
    expect(lines).not.toMatch(COORDINATE_LIKE);
    const disk = await world.databaseBytes();
    expect(disk).not.toContain(String(NOWHERE[1]![1]));
  });

  it('is refused in plaintext before anything is read, and the engine is never asked', async () => {
    const { world, token, valhalla } = await routingWorld();
    const plain = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
      plain: true,
    });
    expect(plain.status).toBe(403);
    expect(codeOf(plain)).toBe('sealed_required');
    expect(valhalla!.requests).toHaveLength(0);
  });

  it('is refused on an instance that holds no keys, which answers its other sealed routes in plaintext', async () => {
    const { world, token, valhalla } = await routingWorld({ keyless: true });
    // The control: this instance DOES answer another sealed route unsealed.
    expect((await world.call('GET', '/v1/analysis/hosted', { token })).status).toBe(200);
    for (const path of [ROUTING_ROUTE_PATH, ROUTING_HEIGHTS_PATH]) {
      const refused = await world.call('POST', path, {
        token,
        body: {
          waypoints: NOWHERE_POINTS,
          preferences: PREFERENCES,
          shape: NOWHERE_POINTS,
          interval: 30,
        },
      });
      expect(codeOf(refused)).toBe('sealed_required');
    }
    expect(valhalla!.requests).toHaveLength(0);
  });

  it('needs a signed-in device', async () => {
    const { world, rider, valhalla } = await routingWorld();
    const refused = await world.call('POST', ROUTING_ROUTE_PATH, {
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
      signer: rider.device,
    });
    expect(refused.status).toBe(401);
    expect(valhalla!.requests).toHaveLength(0);
  });

  it('holds a rider to their allowance a minute, and asks the engine nothing past it', async () => {
    const { world, token, valhalla } = await routingWorld({
      routeLimit: { limit: 2, windowMs: 60_000 },
    });
    const body = { waypoints: NOWHERE_POINTS.slice(0, 2), preferences: PREFERENCES };
    for (let index = 0; index < 2; index += 1) {
      expect((await world.call('POST', ROUTING_ROUTE_PATH, { token, body })).status).toBe(200);
    }
    const asked = valhalla!.requests.length;
    const third = await world.call('POST', ROUTING_ROUTE_PATH, { token, body });
    expect(third.status).toBe(429);
    expect(codeOf(third)).toBe('rate_limited');
    expect(valhalla!.requests).toHaveLength(asked);
    // The next minute, the allowance is back.
    world.clock.ms += 60_000;
    expect((await world.call('POST', ROUTING_ROUTE_PATH, { token, body })).status).toBe(200);
  });

  it('says there is no routing engine when the operator set none', async () => {
    const { world, token } = await routingWorld({ engine: 'none' });
    const answer = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
    });
    expect(answer.status).toBe(503);
    expect(codeOf(answer)).toBe('routing_off');
  });

  it('refuses a body it cannot route, naming the field and never the value', async () => {
    const { world, token, valhalla } = await routingWorld();
    const answer = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: {
        waypoints: [{ latitude: 91.123456, longitude: 0.01 }, NOWHERE_POINTS[1]],
        preferences: { bicycle: 'tank' },
      },
    });
    expect(codeOf(answer)).toBe('validation_failed');
    const fields = (answer.body as { error: { fields: { field: string }[] } }).error.fields;
    expect(fields.map((each) => each.field)).toEqual(['waypoints', 'preferences']);
    expect(JSON.stringify(answer.body)).not.toContain('91.123456');
    expect(JSON.stringify(answer.body)).not.toContain('tank');
    expect(valhalla!.requests).toHaveLength(0);
  });

  it('says a paved-only route was stranded by an unpaved end, and any other no-route as no route', async () => {
    const valhalla = fakeValhalla();
    const { world, token } = await routingWorld({ engine: valhalla });
    const noEdges = { error_code: 171, error: 'No suitable edges near location', status_code: 400 };
    valhalla.failNext('route', 400, noEdges);
    const stranded = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: { ...PREFERENCES, surface: 'paved-only' } },
    });
    expect(codeOf(stranded)).toBe('unpaved_endpoint');
    valhalla.failNext('route', 400, noEdges);
    const nowhere = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
    });
    expect(codeOf(nowhere)).toBe('no_route');
  });

  it('answers routing_failed, and nothing malformed, when the engine is down', async () => {
    const valhalla = fakeValhalla();
    const { world, token } = await routingWorld({ engine: valhalla });
    valhalla.failNext('route', 503, { error: 'busy' });
    const answer = await world.call('POST', ROUTING_ROUTE_PATH, {
      token,
      body: { waypoints: NOWHERE_POINTS, preferences: PREFERENCES },
    });
    expect(answer.status).toBe(502);
    expect(codeOf(answer)).toBe('routing_failed');
  });
});

describe('heights along a line, from the instance’s terrain data (#2008)', () => {
  it('answers one sample per point, at point × interval, a hole as null, and names its source', async () => {
    const valhalla = fakeValhalla({ heights: [10, null, 12.5] });
    const { world, token } = await routingWorld({ engine: valhalla });
    const answer = await world.call('POST', ROUTING_HEIGHTS_PATH, {
      token,
      body: { shape: [...NOWHERE_POINTS, ...NOWHERE_POINTS], interval: 100 },
    });
    expect(answer.status).toBe(200);
    const { source, samples } = answer.body as {
      source: { name: string; resolutionMetres: number };
      samples: [number, number | null][];
    };
    expect(source).toStrictEqual({
      name: ELEVATION_DATASET.name,
      resolutionMetres: ELEVATION_DATASET.resolutionMetres,
    });
    // The app laid the line out at the interval already: point k is k × interval
    // along it, never a distance the engine measured again (#3136).
    expect(samples).toEqual([
      [0, 10],
      [100, null],
      [200, 12.5],
      [300, 10],
      [400, null],
      [500, 12.5],
    ]);
    const asked = valhalla.requests.find((each) => each.action === 'height');
    expect(asked?.body).not.toHaveProperty('resample_distance');
    expect(asked?.body).not.toHaveProperty('range');
  });

  it('refuses an interval it would not sample at', async () => {
    const { world, token, valhalla } = await routingWorld();
    const answer = await world.call('POST', ROUTING_HEIGHTS_PATH, {
      token,
      body: { shape: NOWHERE_POINTS, interval: 0 },
    });
    expect(codeOf(answer)).toBe('validation_failed');
    expect(valhalla!.requests).toHaveLength(0);
  });
});
