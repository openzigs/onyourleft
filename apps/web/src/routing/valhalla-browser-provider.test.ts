// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  RoutingError,
  type GeographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it, vi } from 'vitest';

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
  NO_ROAD_NEAR_TEXT,
  NOT_LOADED_TEXT,
  OUTSIDE_GRAPH_TEXT,
  refusal,
  RELEASED_TEXT,
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
  cancelled: number;
}

function fakeEngine(): FakeEngine & { createRouter: () => Promise<BrowserRouter> } {
  const engine: FakeEngine & { createRouter: () => Promise<BrowserRouter> } = {
    requests: [],
    signals: [],
    created: 0,
    answer: (request) => Promise.resolve(roadBetween(request)),
    failCreate: undefined,
    cancelled: 0,
    createRouter: () => {
      engine.created += 1;
      if (engine.failCreate !== undefined) return Promise.reject(engine.failCreate);
      return Promise.resolve({
        route: (request, { signal }) => {
          engine.requests.push(request);
          engine.signals.push(signal);
          return engine.answer(request, signal);
        },
        cancel: () => {
          engine.cancelled += 1;
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

  it('routes one leg at a time, so one leg past its deadline cannot cancel another, and each clock starts when its leg runs', async () => {
    const engine = fakeEngine();
    let inFlight = 0;
    let most = 0;
    // As the SDK does: an abort ends the worker and rejects every route queued in it.
    const queued: ((error: Error) => void)[] = [];
    engine.answer = (request, signal) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise<BrowserRouteResult>((resolve, reject) => {
        queued.push(reject);
        signal.addEventListener('abort', () => {
          for (const rejectQueued of queued.splice(0)) rejectQueued(sdkError('CANCELLED'));
        });
        // The first leg never answers; any other answers after 30 ms, longer
        // than a deadline started when it was queued would allow.
        if (request.locations[0].lat !== 0.05) {
          setTimeout(() => {
            resolve(roadBetween(request));
          }, 30);
        }
      }).finally(() => {
        inFlight -= 1;
      });
    };
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
      legTimeoutMs: 40,
    });
    const stuck = provider.route({
      waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
      preferences: RIDING_DEFAULTS,
    });
    const other = provider.route({
      waypoints: [{ position: at(0.07, 0.07) }, { position: at(0.08, 0.08) }],
      preferences: RIDING_DEFAULTS,
    });
    await expect(stuck).rejects.toThrow(TOO_SLOW_TEXT);
    await expect(other).resolves.toHaveLength(1);
    expect(most).toBe(1);
  });

  it('lets the engine go when released, and starts it again on the next leg with the same router', async () => {
    const engine = fakeEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    // Released before any leg: nothing was made, so nothing is made now.
    provider.release();
    await Promise.resolve();
    expect(engine.created).toBe(0);
    const request = {
      waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
      preferences: RIDING_DEFAULTS,
    };
    await provider.route(request);
    provider.release();
    await vi.waitFor(() => {
      expect(engine.cancelled).toBe(1);
    });
    await expect(provider.route(request)).resolves.toHaveLength(1);
    expect(engine.created).toBe(1);
  });

  /**
   * An engine as the SDK behaves: `cancel()` rejects every route it holds, and
   * the router is made only when `load` is called, so a test can release the
   * planner while the engine is still loading.
   */
  function heldEngine(): {
    readonly asked: number[];
    readonly cancelled: () => number;
    readonly created: () => number;
    readonly createRouter: () => Promise<BrowserRouter>;
    readonly load: () => void;
    readonly answerAll: () => void;
  } {
    const asked: number[] = [];
    const outstanding: ((ok: boolean) => void)[] = [];
    let cancelled = 0;
    let created = 0;
    const { promise: loading, resolve: loaded } = Promise.withResolvers<BrowserRouter>();
    const router: BrowserRouter = {
      route: (request) => {
        asked.push(request.locations[0].lat);
        return new Promise<BrowserRouteResult>((answer, reject) => {
          outstanding.push((ok) => {
            if (ok) answer(roadBetween(request));
            else reject(sdkError('CANCELLED'));
          });
        });
      },
      cancel: () => {
        cancelled += 1;
        for (const settle of outstanding.splice(0)) settle(false);
      },
    };
    return {
      asked,
      cancelled: () => cancelled,
      created: () => created,
      createRouter: () => {
        created += 1;
        return loading;
      },
      load: () => {
        loaded(router);
      },
      answerAll: () => {
        for (const settle of outstanding.splice(0)) settle(true);
      },
    };
  }

  const legAt = (latitude: number) => ({
    waypoints: [{ position: at(latitude, latitude) }, { position: at(latitude + 0.01, latitude) }],
    preferences: RIDING_DEFAULTS,
  });

  it('settles the legs a closed planner left in the queue without asking the engine, so no worker is started for them', async () => {
    const held = heldEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: held.createRouter,
    });
    const inEngine = provider.route(legAt(0.05));
    const queued = provider.route(legAt(0.07));
    held.load();
    await vi.waitFor(() => {
      expect(held.asked).toEqual([0.05]);
    });
    provider.release();
    await expect(inEngine).rejects.toThrow(TOO_SLOW_TEXT);
    await expect(queued).rejects.toThrow(RELEASED_TEXT);
    // The queued leg never reached the engine, so it started no worker.
    expect(held.asked).toEqual([0.05]);
    expect(held.cancelled()).toBe(1);
  });

  it('does not start loading the engine again for a closed planner’s queued leg after a load failed', async () => {
    const engine = fakeEngine();
    const { promise: loading, reject: fail } = Promise.withResolvers<BrowserRouter>();
    let created = 0;
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: () => {
        created += 1;
        return created === 1 ? loading : engine.createRouter();
      },
    });
    const first = provider.route(legAt(0.05));
    const queued = provider.route(legAt(0.07));
    await vi.waitFor(() => {
      expect(created).toBe(1);
    });
    provider.release();
    fail(sdkError('NETWORK'));
    await expect(first).rejects.toThrow(NOT_LOADED_TEXT);
    await expect(queued).rejects.toThrow(RELEASED_TEXT);
    // A failed load is forgotten, but the closed planner's leg does not ask for another.
    expect(created).toBe(1);
  });

  it('released while the engine loads: the old leg never reaches it, and the cancel does not touch the planner opened since', async () => {
    const held = heldEngine();
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: held.createRouter,
    });
    const closed = provider.route(legAt(0.05));
    // Its leg has asked for the engine, which is still loading.
    await vi.waitFor(() => {
      expect(held.created()).toBe(1);
    });
    provider.release();
    // The planner is opened again before the engine has loaded.
    const reopened = provider.route(legAt(0.07));
    held.load();
    await expect(closed).rejects.toThrow(RELEASED_TEXT);
    await vi.waitFor(() => {
      expect(held.asked).toEqual([0.07]);
    });
    held.answerAll();
    // The new view's first leg follows roads: it was not cancelled and drawn straight.
    await expect(reopened).resolves.toHaveLength(1);
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
      NO_ROAD_NEAR_TEXT,
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

describe('a waypoint the graph has no road near (#3179)', () => {
  /**
   * As Valhalla answers it: the waypoint with no road near it is moved to the
   * nearest road the graph holds, here 0.1° (about 11 km) south of where it
   * was, and the line runs to there.
   */
  function snapsFar(which: 'from' | 'to'): (request: BrowserRouteRequest) => BrowserRouteResult {
    return (request) => {
      const [from, to] = request.locations;
      const moved = (point: { lat: number; lon: number }) => ({
        lat: point.lat - 0.1,
        lon: point.lon,
      });
      return roadBetween({
        ...request,
        locations: which === 'from' ? [moved(from), to] : [from, moved(to)],
      });
    };
  }

  it.each(['from', 'to'] as const)(
    'draws a leg straight when the engine moved its %s waypoint to a road far away, and says why without a coordinate',
    async (which) => {
      const engine = fakeEngine();
      const answer = snapsFar(which);
      engine.answer = (request) => Promise.resolve(answer(request));
      const provider = valhallaBrowserProvider({
        graph: GRAPH,
        mapTilesOn: () => true,
        createRouter: engine.createRouter,
      });
      let draft = emptyDraft();
      draft = addWaypoint(draft, at(0.25, 0.05), 'snapped').draft;
      const added = addWaypoint(draft, at(0.26, 0.06), 'snapped');
      const settled = await resolveDraft(added.draft, added.stale, provider, RIDING_DEFAULTS);
      // The engine answered; the planner does not take its line as a road to the pins.
      expect(engine.requests).toHaveLength(1);
      expect(settled.legs[0]).toMatchObject({
        mode: 'freehand',
        state: 'routed',
        failure: { message: NO_ROAD_NEAR_TEXT, retryable: true },
      });
      expect(settled.legs[0]?.shape).toStrictEqual([at(0.25, 0.05), at(0.26, 0.06)]);
    },
  );

  it('still follows roads when the engine moved a waypoint a short way onto a road', async () => {
    const engine = fakeEngine();
    // About 110 m: a pin dropped beside a road.
    engine.answer = (request) => {
      const [from, to] = request.locations;
      return Promise.resolve(
        roadBetween({ ...request, locations: [{ lat: from.lat + 0.001, lon: from.lon }, to] }),
      );
    };
    const provider = valhallaBrowserProvider({
      graph: GRAPH,
      mapTilesOn: () => true,
      createRouter: engine.createRouter,
    });
    const legs = await provider.route({
      waypoints: [{ position: at(0.05, 0.05) }, { position: at(0.06, 0.06) }],
      preferences: RIDING_DEFAULTS,
    });
    expect(legs[0]?.shape).toHaveLength(3);
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
