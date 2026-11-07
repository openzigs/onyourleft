// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  errorCode,
  runMeasurement,
  tileTransferBytes,
  type DiagnosticsLike,
  type MeasureDeps,
  type RouteResultLike,
  type RouterLike,
  type SessionOptions,
  type StartupLike,
} from './measure';
import type { MeasureConfig, Pair, Point } from './params';

// Synthetic end points off Null Island: no road, no place.
const PAIR_40: Pair = {
  targetKm: 40,
  origin: { lat: 0.1, lon: 0.1 },
  destination: { lat: 0.1, lon: 0.46 },
};
const PAIR_5: Pair = {
  targetKm: 5,
  origin: { lat: 0.2, lon: 0.2 },
  destination: { lat: 0.2, lon: 0.245 },
};

const CONFIG: MeasureConfig = {
  manifestUrl: 'https://tiles.example/routing/r1/manifest.json',
  pairs: [PAIR_40],
  runs: 1,
  budgetBytes: 128 * 1024 * 1024,
  timeoutMs: 5_000,
  dragMetres: 250,
};

/** `0.1,0.1` to `0.1,0.46` along the parallel, encoded at six decimal places. */
const SHAPE_40 = '_ibE_ibE?_c~T';

const STARTUP: StartupLike = {
  release: 'r1',
  workerReadyMs: 180,
  moduleStartupMs: 120,
  graphStartupMs: 30,
  graphStartupBytes: 22_600,
  memoryBudgetBytes: 128 * 1024 * 1024,
  wasmMemory: { initialMiB: 128, maximumMiB: 512 },
};

type Timing = DiagnosticsLike['resourceTiming'][number];
const tile = (
  name: string,
  transferSize: number | null,
  decodedBodySize: number | null = 1000,
): Timing => ({
  name,
  transferSize,
  decodedBodySize,
});

interface Script {
  /** Per call to `route`: how long it takes, what it fetched, and what it returns or throws. */
  readonly routes: ReadonlyArray<{
    ms: number;
    km?: number;
    bytes?: number;
    tiles?: number;
    timings?: Timing[];
    fail?: Error;
    hang?: true;
  }>;
  readonly initFails?: Error;
  /** `initialize()` never answers, unless `cancel()` is called. */
  readonly initHangs?: true;
}

/** A router whose every answer the test wrote, which advances the test's clock as it "works". */
class FakeRouter implements RouterLike {
  readonly requests: Array<{ origin: Point; destination: Point; costing: string }> = [];
  disposed = 0;
  private readonly timings: Timing[] = [
    tile('https://tiles.example/routing/r1/manifest.json', 100),
  ];
  private call = 0;

  constructor(
    readonly options: SessionOptions,
    private readonly script: Script,
    private readonly clock: { t: number },
  ) {}

  cancelled = 0;
  private cancelInit: (() => void) | undefined;

  cancel(): void {
    this.cancelled += 1;
    this.cancelInit?.();
  }

  async initialize(): Promise<StartupLike> {
    if (this.script.initHangs === true) {
      return new Promise((_, reject) => {
        this.cancelInit = () =>
          reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
      });
    }
    this.clock.t += 200;
    if (this.script.initFails !== undefined) throw this.script.initFails;
    return Promise.resolve(STARTUP);
  }

  async route(
    request: { origin: Point; destination: Point; costing: 'bicycle' },
    { signal }: { signal: AbortSignal },
  ): Promise<RouteResultLike> {
    this.requests.push(request);
    const step = this.script.routes[this.call] ?? { ms: 1 };
    this.call += 1;
    if (step.hang === true) {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })),
        );
      });
    }
    this.clock.t += step.ms;
    if (step.fail !== undefined) throw step.fail;
    this.timings.push(...(step.timings ?? []));
    return Promise.resolve({
      native: { trip: { summary: { length: step.km ?? 40 }, legs: [{ shape: SHAPE_40 }] } },
      dataset: { release: 'r1' },
      diagnostics: {
        routeMs: step.ms - 1,
        loader: {
          bytes: step.bytes ?? 0,
          tileDownloads: step.tiles ?? 0,
          requests: step.tiles ?? 0,
        },
      },
    });
  }

  async diagnostics(): Promise<DiagnosticsLike> {
    return Promise.resolve({
      native: { decodedCacheBytes: 9_000_000, wasmHeapCapacityHighWaterBytes: 134_217_728 },
      resourceTiming: [...this.timings],
    });
  }

  async dispose(): Promise<void> {
    this.disposed += 1;
    return Promise.resolve();
  }
}

function harness(scripts: Script[]): { deps: MeasureDeps; routers: FakeRouter[] } {
  const clock = { t: 1_000 };
  const routers: FakeRouter[] = [];
  const deps: MeasureDeps = {
    createRouter: (options) => {
      const router = new FakeRouter(options, scripts[routers.length] ?? { routes: [] }, clock);
      routers.push(router);
      return router;
    },
    now: () => clock.t,
    workerUrl: '/assets/worker-1.js',
    wasmUrl: '/assets/valhalla-browser-1.wasm',
  };
  return { deps, routers };
}

const metres = (a: Point, b: Point): number =>
  distanceBetween(
    geographicPosition(degreesLatitude(a.lat), degreesLongitude(a.lon)),
    geographicPosition(degreesLatitude(b.lat), degreesLongitude(b.lon)),
  );

describe('runMeasurement', () => {
  const happy: Script = {
    routes: [
      {
        ms: 300,
        km: 40.07,
        bytes: 18_500_000,
        tiles: 6,
        timings: [tile('t/2/1.gph', 9_000), tile('t/2/2.gph', 9_500)],
      },
      { ms: 12 },
      { ms: 17 },
    ],
  };

  it('times the session, the cold, warm and dragged routes, and reads the SDK’s counters', async () => {
    const { deps, routers } = harness([happy]);
    const report = await runMeasurement(CONFIG, deps);
    expect(report).toMatchObject({
      release: 'r1',
      transport: 'individual-tiles',
      budgetMiB: 128,
      wasmMemory: { initialMiB: 128, maximumMiB: 512 },
      dragMetres: 250,
    });
    expect(report.records).toEqual([
      {
        pair: 1,
        run: 1,
        targetKm: 40,
        init: {
          ms: 200,
          workerReadyMs: 180,
          moduleStartupMs: 120,
          graphStartupMs: 30,
          bytes: 22_600,
        },
        routedKm: 40.07,
        withinClass: true,
        cold: {
          ms: 300,
          routeMs: 299,
          bytes: 18_500_000,
          tiles: 6,
          requests: 6,
          transferBytes: 18_500,
        },
        warm: { ms: 12, routeMs: 11, bytes: 0, tiles: 0, requests: 0, transferBytes: 0 },
        drag: { ms: 17, routeMs: 16, bytes: 0, tiles: 0, requests: 0, transferBytes: 0 },
        wasmHighWaterBytes: 134_217_728,
        decodedCacheBytes: 9_000_000,
      },
    ]);
    expect(routers[0]?.disposed).toBe(1);
  });

  it('opens the session with individual tiles, the budget, and the page’s own worker and WebAssembly', async () => {
    const { deps, routers } = harness([happy]);
    await runMeasurement(CONFIG, deps);
    expect(routers[0]?.options).toEqual({
      manifestUrl: CONFIG.manifestUrl,
      transport: 'individual-tiles',
      memoryBudgetBytes: 128 * 1024 * 1024,
      workerUrl: '/assets/worker-1.js',
      wasmUrl: '/assets/valhalla-browser-1.wasm',
      timeoutMs: 60_000,
    });
  });

  it('routes cold and warm to the destination, then to a point the drag distance back along the route', async () => {
    const { deps, routers } = harness([happy]);
    await runMeasurement(CONFIG, deps);
    const [cold, warm, drag] = routers[0]?.requests ?? [];
    expect(cold).toEqual({
      origin: PAIR_40.origin,
      destination: PAIR_40.destination,
      costing: 'bicycle',
    });
    expect(warm).toEqual(cold);
    expect(drag?.origin).toEqual(PAIR_40.origin);
    expect(drag?.destination.lat).toBeCloseTo(0.1, 9);
    expect(metres(drag?.destination as Point, PAIR_40.destination)).toBeCloseTo(250, 3);
  });

  it('opens a new session for every pair and every run, and closes each', async () => {
    const { deps, routers } = harness([]);
    const seen: Array<[number, number]> = [];
    const report = await runMeasurement(
      { ...CONFIG, pairs: [PAIR_40, PAIR_5], runs: 2 },
      deps,
      (record) => seen.push([record.pair, record.run]),
    );
    expect(routers).toHaveLength(4);
    expect(routers.every((router) => router.disposed === 1)).toBe(true);
    expect(seen).toEqual([
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(report.records.map((record) => record.targetKm)).toEqual([40, 5, 40, 5]);
  });

  it('marks a pair whose routed length is more than 15 % off its class', async () => {
    const { deps } = harness([{ routes: [{ ms: 1, km: 46.5 }] }]);
    const report = await runMeasurement(CONFIG, deps);
    expect(report.records[0]).toMatchObject({ routedKm: 46.5, withinClass: false });
  });

  it('records the step and the SDK’s code when a route fails, never its message, and goes on', async () => {
    const failure = Object.assign(new Error('No route near 0.1,0.46'), { code: 'NO_ROUTE' });
    const { deps, routers } = harness([{ routes: [{ ms: 5, fail: failure }] }, happy]);
    const report = await runMeasurement({ ...CONFIG, pairs: [PAIR_40, PAIR_40] }, deps);
    expect(report.records[0]).toMatchObject({ error: { step: 'cold', code: 'NO_ROUTE' } });
    expect(report.records[0]?.cold).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('0.46');
    expect(routers[0]?.disposed).toBe(1);
    expect(report.records[1]?.error).toBeUndefined();
  });

  it('records a failed warm route against the warm step, keeping the cold one', async () => {
    const failure = Object.assign(new Error('gone'), { code: 'NETWORK' });
    const { deps } = harness([{ routes: [{ ms: 5 }, { ms: 5, fail: failure }] }]);
    const record = (await runMeasurement(CONFIG, deps)).records[0];
    expect(record?.error).toEqual({ step: 'warm', code: 'NETWORK' });
    expect(record?.cold?.ms).toBe(5);
  });

  it('gives up on a route that runs past the deadline, as TIMEOUT', async () => {
    const { deps, routers } = harness([{ routes: [{ ms: 0, hang: true }] }]);
    const record = (await runMeasurement({ ...CONFIG, timeoutMs: 20 }, deps)).records[0];
    expect(record?.error).toEqual({ step: 'cold', code: 'TIMEOUT' });
    expect(routers[0]?.disposed).toBe(1);
  });

  it('gives up on a session that never starts, as TIMEOUT, and cancels it', async () => {
    const { deps, routers } = harness([{ routes: [], initHangs: true }]);
    const record = (await runMeasurement({ ...CONFIG, timeoutMs: 20 }, deps)).records[0];
    expect(record?.error).toEqual({ step: 'init', code: 'TIMEOUT' });
    expect(routers[0]?.cancelled).toBe(1);
    expect(routers[0]?.disposed).toBe(1);
  });

  it('gives the session the SDK’s longest per-fetch deadline', async () => {
    const { deps, routers } = harness([{ routes: [{ ms: 1 }] }]);
    await runMeasurement(CONFIG, deps);
    expect(routers[0]?.options.timeoutMs).toBe(60_000);
  });

  it('records a session that would not start against the init step', async () => {
    const { deps } = harness([
      { routes: [], initFails: Object.assign(new Error('x'), { code: 'INCOMPATIBLE_DATASET' }) },
    ]);
    const report = await runMeasurement(CONFIG, deps);
    expect(report.records[0]?.error).toEqual({ step: 'init', code: 'INCOMPATIBLE_DATASET' });
    expect(report.release).toBeNull();
    expect(report.wasmMemory).toBeNull();
  });
});

describe('tileTransferBytes', () => {
  it('sums the tiles and ignores everything else', () => {
    expect(
      tileTransferBytes([tile('a/manifest.json', 5), tile('t/1.gph', 10), tile('t/2.gph?x=1', 0)]),
    ).toBe(10);
  });

  it('is null when the browser hides a tile’s figures, which is not a cache hit', () => {
    expect(tileTransferBytes([tile('t/1.gph', 0, 0)])).toBeNull();
    expect(tileTransferBytes([tile('t/1.gph', null)])).toBeNull();
  });
});

describe('errorCode', () => {
  it('takes the SDK’s code, and nothing that is not one', () => {
    expect(errorCode({ code: 'NO_ROUTE' }, false)).toBe('NO_ROUTE');
    expect(errorCode({ code: 'near 1.5, 2.5' }, false)).toBe('ERROR');
    expect(errorCode(new Error('x'), false)).toBe('ERROR');
    expect(errorCode({ code: 'CANCELLED' }, true)).toBe('TIMEOUT');
  });
});
