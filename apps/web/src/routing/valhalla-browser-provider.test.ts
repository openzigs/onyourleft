// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  RoutingError,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  addWaypoint,
  emptyDraft,
  FreehandFallback,
  moveWaypoint,
  resolveDraft,
  type RouteDraft,
} from './draft';
import { RIDING_DEFAULTS } from './preferences';
import {
  BICYCLE_TYPES,
  decodePolyline6,
  NO_PATH_TEXT,
  NOT_LOADED_TEXT,
  OUTSIDE_GRAPH_TEXT,
  refusal,
  TILES_OFF_TEXT,
  TOO_LARGE_TEXT,
  TOO_SLOW_TEXT,
  valhallaBrowserProvider,
  type BrowserRouteRequest,
  type BrowserRouteResult,
  type BrowserRouter,
} from './valhalla-browser-provider';

// Synthetic points off Null Island: no road, no place.
const at = (latitude: number, longitude: number): GeographicPosition =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

const GRAPH = {
  manifestUrl: 'https://tiles.example.org/routing/oyl-synthetic-000000000000/manifest.json',
};

/** Polyline6, the encoder's half, so a test can hand the adapter a line it knows. */
function encode6(points: readonly { latitude: number; longitude: number }[]): string {
  let out = '';
  let previous = [0, 0];
  const one = (value: number): void => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    out += String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const next = [Math.round(point.latitude * 1e6), Math.round(point.longitude * 1e6)];
    one(next[0]! - previous[0]!);
    one(next[1]! - previous[1]!);
    previous = next;
  }
  return out;
}

/** A road from one point to the other with a bend in it: a quarter of the way east first. */
function roadBetween(request: BrowserRouteRequest): BrowserRouteResult {
  const [from, to] = request.locations;
  const bend = { latitude: from.lat, longitude: from.lon + (to.lon - from.lon) / 4 + 0.001 };
  const shape = [
    { latitude: from.lat, longitude: from.lon },
    bend,
    { latitude: to.lat, longitude: to.lon },
  ];
  return { native: { trip: { summary: { length: 1.234 }, legs: [{ shape: encode6(shape) }] } } };
}

interface FakeEngine {
  readonly requests: BrowserRouteRequest[];
  readonly signals: AbortSignal[];
  created: number;
  answer: (request: BrowserRouteRequest, signal: AbortSignal) => Promise<BrowserRouteResult>;
  failCreate: Error | undefined;
}

function fakeEngine(): FakeEngine & { createRouter: () => Promise<BrowserRouter> } {
  const engine: FakeEngine & { createRouter: () => Promise<BrowserRouter> } = {
    requests: [],
    signals: [],
    created: 0,
    answer: (request) => Promise.resolve(roadBetween(request)),
    failCreate: undefined,
    createRouter: () => {
      engine.created += 1;
      if (engine.failCreate !== undefined) return Promise.reject(engine.failCreate);
      return Promise.resolve({
        route: (request, { signal }) => {
          engine.requests.push(request);
          engine.signals.push(signal);
          return engine.answer(request, signal);
        },
      });
    },
  };
  return engine;
}

/** An SDK error as the SDK throws it: an Error with a string code. */
function sdkError(code: string): Error {
  return Object.assign(
    new Error(
      `${code}: tile https://tiles.example.org/routing/x/tiles/2/000/519/120.gph at 0.0512, 0.0512`,
    ),
    {
      code,
    },
  );
}

describe('the in-browser Valhalla adapter (#2734)', () => {
  it('routes each leg on its own, as a bicycle, and reads the road back', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    const legs = await provider.route({
      waypoints: [
        { position: at(0.05, 0.05) },
        { position: at(0.06, 0.06) },
        { position: at(0.07, 0.05) },
      ],
      preferences: { ...RIDING_DEFAULTS, bicycle: 'city' },
    });
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[0]).toStrictEqual({
      costing: 'bicycle',
      costing_options: { bicycle: { bicycle_type: 'hybrid' } },
      locations: [
        { lat: 0.05, lon: 0.05 },
        { lat: 0.06, lon: 0.06 },
      ],
    });
    expect(engine.requests[1]?.locations[0]).toStrictEqual({ lat: 0.06, lon: 0.06 });
    expect(legs).toHaveLength(2);
    expect(legs[0]?.shape).toHaveLength(3);
    expect(legs[0]?.shape[0]).toStrictEqual({ latitude: 0.05, longitude: 0.05 });
    expect(legs[0]?.shape[2]).toStrictEqual({ latitude: 0.06, longitude: 0.06 });
    // Kilometres in, metres out.
    expect(legs[0]?.distance).toBeCloseTo(1234, 6);
    // The SDK reports no surface, so none is claimed: never assumed paved (#70, #72).
    expect(legs.map((leg) => leg.surface)).toStrictEqual(['unknown', 'unknown']);
  });

  it('asks for every bicycle by a bicycle_type the SDK knows', () => {
    expect(new Set(Object.values(BICYCLE_TYPES))).toStrictEqual(
      new Set(['road', 'hybrid', 'cross', 'mountain']),
    );
  });

  it('loads nothing until a leg is routed, and loads once', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    expect(engine.created).toBe(0);
    const waypoints = [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }];
    await provider.route({ waypoints, preferences: RIDING_DEFAULTS });
    await provider.route({ waypoints, preferences: RIDING_DEFAULTS });
    expect(engine.created).toBe(1);
  });

  it('with map tiles off, loads nothing and draws the leg straight', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => false,
      createRouter: engine.createRouter,
    });
    const routing = provider.route({
      waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
      preferences: RIDING_DEFAULTS,
    });
    await expect(routing).rejects.toBeInstanceOf(FreehandFallback);
    await expect(routing).rejects.toThrow(TILES_OFF_TEXT);
    expect(engine.created).toBe(0);
  });

  it('draws a leg straight when the engine cannot start, and starts it again on the next leg', async () => {
    const engine = fakeEngine();
    engine.failCreate = sdkError('NETWORK');
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    const waypoints = [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }];
    await expect(provider.route({ waypoints, preferences: RIDING_DEFAULTS })).rejects.toThrow(
      NOT_LOADED_TEXT,
    );
    engine.failCreate = undefined;
    await expect(provider.route({ waypoints, preferences: RIDING_DEFAULTS })).resolves.toHaveLength(
      1,
    );
    expect(engine.created).toBe(2);
  });

  it('gives up on a leg that runs past its deadline, and draws it straight', async () => {
    const engine = fakeEngine();
    // As the SDK does: an aborted route is rejected as cancelled.
    engine.answer = (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(sdkError('CANCELLED')));
      });
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
      legTimeoutMs: 20,
    });
    const routing = provider.route({
      waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
      preferences: RIDING_DEFAULTS,
    });
    await expect(routing).rejects.toThrow(TOO_SLOW_TEXT);
    expect(engine.signals[0]?.aborted).toBe(true);
  });

  it('refuses fewer than two waypoints without loading anything', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    await expect(
      provider.route({ waypoints: [{ position: at(0.05, 0.05) }], preferences: RIDING_DEFAULTS }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(engine.created).toBe(0);
  });

  it('answers no heights: the terrain archive does that', async () => {
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: fakeEngine().createRouter,
    });
    await expect(provider.heights({ shape: [], interval: 30 as never })).rejects.toBeInstanceOf(
      RoutingError,
    );
  });

  it('reads an answer with no leg as malformed, not as a road', async () => {
    const engine = fakeEngine();
    engine.answer = () =>
      Promise.resolve({ native: { trip: { summary: { length: 1 }, legs: [] } } });
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    await expect(
      provider.route({
        waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
        preferences: RIDING_DEFAULTS,
      }),
    ).rejects.toMatchObject({ code: 'malformed-response' });
  });
});

describe('what a refused leg becomes (#2734)', () => {
  it.each([
    ['RESOURCE_LIMIT', TOO_LARGE_TEXT],
    ['OUTSIDE_COVERAGE', OUTSIDE_GRAPH_TEXT],
    ['TIMEOUT', TOO_SLOW_TEXT],
    ['QUEUE_TIMEOUT', TOO_SLOW_TEXT],
    ['NETWORK', NOT_LOADED_TEXT],
    ['DATASET', NOT_LOADED_TEXT],
    ['WORKER_FAILED', NOT_LOADED_TEXT],
  ])('%s is a straight leg that says why', (code, text) => {
    const error = refusal(sdkError(code), 0);
    expect(error).toBeInstanceOf(FreehandFallback);
    expect(error.message).toBe(text);
  });

  it.each(['NO_ROUTE', 'LOCATION_NOT_FOUND'])(
    '%s is a leg with no road, for the rider to move a point',
    (code) => {
      const error = refusal(sdkError(code), 2);
      expect(error).not.toBeInstanceOf(FreehandFallback);
      expect(error).toMatchObject({ code: 'no-route', leg: 2, message: NO_PATH_TEXT });
    },
  );

  it('never repeats what the SDK said, and no sentence a rider reads names a coordinate (ADR 0004 D)', () => {
    const sentences = [
      TOO_LARGE_TEXT,
      OUTSIDE_GRAPH_TEXT,
      TOO_SLOW_TEXT,
      NOT_LOADED_TEXT,
      TILES_OFF_TEXT,
      NO_PATH_TEXT,
      ...['RESOURCE_LIMIT', 'OUTSIDE_COVERAGE', 'TIMEOUT', 'NO_ROUTE', 'NETWORK', 'x'].map(
        (code) => refusal(sdkError(code), 0).message,
      ),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\d\.\d/);
      expect(sentence).not.toMatch(/https?:|\.gph/);
    }
  });

  it('turns a refused leg into a freehand leg marked with the reason, through the planner', async () => {
    const engine = fakeEngine();
    engine.answer = () => Promise.reject(sdkError('OUTSIDE_COVERAGE'));
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    let draft = emptyDraft();
    draft = addWaypoint(draft, at(0.05, 0.05), 'snapped').draft;
    const added = addWaypoint(draft, at(0.06, 0.06), 'snapped');
    const settled = await resolveDraft(added.draft, added.stale, provider, RIDING_DEFAULTS);
    expect(settled.legs[0]).toMatchObject({
      mode: 'freehand',
      state: 'routed',
      failure: { message: OUTSIDE_GRAPH_TEXT, retryable: true },
    });
    expect(settled.legs[0]?.shape).toHaveLength(2);
  });
});

describe('a dragged waypoint, counted at the engine (#2734, #71)', () => {
  it('re-asks the engine for only the two legs beside it', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    let draft: RouteDraft = emptyDraft();
    for (let index = 0; index < 5; index += 1) {
      const added = addWaypoint(draft, at(0.05 + index * 0.005, 0.05), 'snapped');
      draft = await resolveDraft(added.draft, added.stale, provider, RIDING_DEFAULTS);
    }
    expect(engine.requests).toHaveLength(4);
    const middle = draft.waypoints[2];
    if (middle === undefined) throw new Error('no middle waypoint');
    const moved = moveWaypoint(draft, middle.id, at(0.06, 0.055));
    await resolveDraft(moved.draft, moved.stale, provider, RIDING_DEFAULTS);
    expect(engine.requests).toHaveLength(6);
    // The two it asked about are the legs into and out of the moved point.
    expect(engine.requests.slice(4).map((request) => request.locations)).toStrictEqual([
      [
        { lat: 0.055, lon: 0.05 },
        { lat: 0.06, lon: 0.055 },
      ],
      [
        { lat: 0.06, lon: 0.055 },
        { lat: 0.065, lon: 0.05 },
      ],
    ]);
  });
});

describe('polyline6', () => {
  it('decodes what it encodes, at six places, signs and all', () => {
    const line = [
      { latitude: 0.05, longitude: 0.05 },
      { latitude: -0.000001, longitude: 0.123456 },
      { latitude: 0.0123, longitude: -0.0456 },
    ];
    expect(decodePolyline6(encode6(line))).toStrictEqual(line);
  });

  it('stops one point past its limit', () => {
    const line = Array.from({ length: 10 }, (_, index) => ({
      latitude: index / 1e3,
      longitude: 0,
    }));
    expect(decodePolyline6(encode6(line), 4)).toHaveLength(4);
  });

  it('refuses a line cut off in the middle of a number', () => {
    expect(() => decodePolyline6('_')).toThrow(RoutingError);
  });
});
