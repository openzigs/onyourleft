// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement itself (#2320): what #2009 asks of the owner's tablet, for
 * each end-point pair the page is given.
 *
 * Per pair and run, one **new router session**: a new worker with an empty
 * decoded-tile cache, as spike 0035's fresh browser context was:
 *
 * 1. initialise (worker, WebAssembly and graph metadata) and time it;
 * 2. route **cold**, then the same pair **warm**, then to the **dragged**
 *    destination (`shape.ts`), each timed on the page around `route()`;
 * 3. read the SDK's own counters: bytes and tiles it fetched, WebAssembly
 *    linear-memory high water, decoded-cache size;
 * 4. dispose.
 *
 * ⚠️ **Cold here is a cold session, not a cold HTTP cache.** A page cannot
 * empty the browser's cache, and with `individual-tiles` a `.gph` file fetched
 * by an earlier pair is served from it. `transferBytes` is the browser's own
 * figure for the tiles a step fetched (zero from the cache), so the record
 * says which it was, when the graph's host sends `Timing-Allow-Origin`;
 * without it the browser hides the figure and the record says `null`. Clear
 * the site's data before a run for a cold cache.
 *
 * ⚠️ **The record holds no coordinate.** It carries lengths, times, bytes and
 * the SDK's error *code* — never an error message, which may quote a location
 * (ADR 0004 decision D) — so it can be pasted into #2009 as it is.
 */

import type { MeasureConfig, Pair, Point } from './params';
import { decodePolyline6, pointBackAlong } from './shape';

/** The part of `valhalla-browser`'s `RouterOptions` the page sets. */
export interface SessionOptions {
  readonly manifestUrl: string;
  readonly transport: 'individual-tiles';
  readonly memoryBudgetBytes: number;
  readonly workerUrl: string;
  readonly wasmUrl: string;
  /** The SDK's per-fetch deadline, so a big tile on a slow link is measured, not a transport error. */
  readonly timeoutMs: number;
}

/** The fields of a route result the page reads. `valhalla-browser`'s `RouteResult` has them all. */
export interface RouteResultLike {
  readonly native: {
    readonly trip: {
      readonly summary: { readonly length: number };
      readonly legs: ReadonlyArray<{ readonly shape: string }>;
    };
  };
  readonly dataset: { readonly release: string };
  readonly diagnostics: {
    readonly routeMs: number;
    readonly loader: {
      readonly bytes: number;
      readonly tileDownloads: number;
      readonly requests: number;
    };
  };
}

/** The fields of the SDK's `StartupResult` the page reads. */
export interface StartupLike {
  readonly release: string;
  readonly workerReadyMs: number;
  readonly moduleStartupMs: number;
  readonly graphStartupMs: number;
  readonly graphStartupBytes: number;
  readonly memoryBudgetBytes: number;
  readonly wasmMemory: { readonly initialMiB: number; readonly maximumMiB: number };
}

/** The fields of the SDK's `Diagnostics` the page reads. */
export interface DiagnosticsLike {
  readonly native: {
    readonly decodedCacheBytes: number;
    readonly wasmHeapCapacityHighWaterBytes: number;
  };
  readonly resourceTiming: ReadonlyArray<{
    readonly name: string;
    readonly transferSize: number | null;
    readonly decodedBodySize: number | null;
  }>;
}

/** A router session: `valhalla-browser`'s `Router` is one. */
export interface RouterLike {
  initialize(): Promise<StartupLike>;
  route(
    request: {
      readonly origin: Point;
      readonly destination: Point;
      readonly costing: 'bicycle';
    },
    options: { readonly signal: AbortSignal },
  ): Promise<RouteResultLike>;
  diagnostics(): Promise<DiagnosticsLike>;
  dispose(): Promise<void>;
  /** Rejects every outstanding call with `CANCELLED`. */
  cancel(): void;
}

/** The SDK's longest per-fetch deadline (`timeoutMs`, 1 to 60,000); its default is 10,000. */
export const SESSION_FETCH_TIMEOUT_MS = 60_000;

/** What the measurement needs from its surroundings. */
export interface MeasureDeps {
  readonly createRouter: (options: SessionOptions) => RouterLike;
  readonly now: () => number;
  readonly workerUrl: string;
  readonly wasmUrl: string;
}

/** One timed route. */
export interface StepRecord {
  readonly ms: number;
  readonly routeMs: number;
  readonly bytes: number;
  readonly tiles: number;
  readonly requests: number;
  /** The browser's transfer size for the tiles this step fetched (0 from its cache); `null` where it does not say. */
  readonly transferBytes: number | null;
}

/** One pair, one run. */
export interface PairRecord {
  readonly pair: number;
  readonly run: number;
  readonly targetKm: number;
  readonly routedKm?: number;
  /** Whether the routed length is within 15 % of the class, as spike 0035's pairs were. */
  readonly withinClass?: boolean;
  readonly init?: {
    readonly ms: number;
    readonly workerReadyMs: number;
    readonly moduleStartupMs: number;
    readonly graphStartupMs: number;
    readonly bytes: number;
  };
  readonly cold?: StepRecord;
  readonly warm?: StepRecord;
  readonly drag?: StepRecord;
  readonly wasmHighWaterBytes?: number;
  readonly decodedCacheBytes?: number;
  /** The step that failed and the SDK's error code, never its message. */
  readonly error?: { readonly step: 'init' | 'cold' | 'warm' | 'drag'; readonly code: string };
}

/** The whole run. */
export interface MeasureReport {
  readonly release: string | null;
  readonly transport: 'individual-tiles';
  readonly budgetMiB: number;
  readonly wasmMemory: { readonly initialMiB: number; readonly maximumMiB: number } | null;
  readonly dragMetres: number;
  readonly records: readonly PairRecord[];
}

/** The SDK's `RoutingError` code, `TIMEOUT` when the page's own deadline fired, or `ERROR`. */
export function errorCode(error: unknown, timedOut: boolean): string {
  if (timedOut) return 'TIMEOUT';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(code)) return code;
  }
  return 'ERROR';
}

/**
 * Sum of the browser's transfer sizes over the tile fetches in `entries`, or
 * `null` if the browser does not say. A tile served from the HTTP cache has a
 * transfer size of 0 and its decoded size; a cross-origin tile served without
 * `Timing-Allow-Origin` has 0 for both, which says nothing, so that is `null`
 * too and never a cache hit (measured on #2320's smoke run).
 */
export function tileTransferBytes(entries: DiagnosticsLike['resourceTiming']): number | null {
  let sum = 0;
  for (const entry of entries) {
    if (!new URL(entry.name, 'https://x.invalid/').pathname.endsWith('.gph')) continue;
    if (
      entry.transferSize === null ||
      entry.decodedBodySize === null ||
      entry.decodedBodySize === 0
    )
      return null;
    sum += entry.transferSize;
  }
  return sum;
}

type Step = 'init' | 'cold' | 'warm' | 'drag';

class StepFailed extends Error {
  constructor(
    readonly step: Step,
    readonly code: string,
  ) {
    super(`${step}: ${code}`);
  }
}

async function withDeadline<T>(
  step: Step,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => void = () => undefined,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced, so a call that ignores the signal and the cancel still ends at the deadline.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      onTimeout();
      reject(new Error('deadline'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } catch (error: unknown) {
    throw new StepFailed(step, errorCode(error, timedOut));
  } finally {
    clearTimeout(timer);
  }
}

async function measureOne(
  pair: Pair,
  index: number,
  run: number,
  config: MeasureConfig,
  deps: MeasureDeps,
): Promise<{ record: PairRecord; startup?: StartupLike }> {
  const router = deps.createRouter({
    manifestUrl: config.manifestUrl,
    transport: 'individual-tiles',
    memoryBudgetBytes: config.budgetBytes,
    workerUrl: deps.workerUrl,
    wasmUrl: deps.wasmUrl,
    timeoutMs: SESSION_FETCH_TIMEOUT_MS,
  });
  const base = { pair: index + 1, run, targetKm: pair.targetKm };
  let record: PairRecord = base;
  let startup: StartupLike | undefined;
  let seenTiming = 0;
  let current: Step = 'init';
  const step = async (
    name: Exclude<Step, 'init'>,
    destination: Point,
  ): Promise<[StepRecord, RouteResultLike]> => {
    current = name;
    const started = deps.now();
    const result = await withDeadline(name, config.timeoutMs, (signal) =>
      router.route({ origin: pair.origin, destination, costing: 'bicycle' }, { signal }),
    );
    const ms = deps.now() - started;
    const timing = (await router.diagnostics()).resourceTiming;
    const transferBytes = tileTransferBytes(timing.slice(seenTiming));
    seenTiming = timing.length;
    const loader = result.diagnostics.loader;
    return [
      {
        ms,
        routeMs: result.diagnostics.routeMs,
        bytes: loader.bytes,
        tiles: loader.tileDownloads,
        requests: loader.requests,
        transferBytes,
      },
      result,
    ];
  };
  try {
    const initStarted = deps.now();
    startup = await withDeadline(
      'init',
      config.timeoutMs,
      () => router.initialize(),
      () => router.cancel(),
    );
    record = {
      ...record,
      init: {
        ms: deps.now() - initStarted,
        workerReadyMs: startup.workerReadyMs,
        moduleStartupMs: startup.moduleStartupMs,
        graphStartupMs: startup.graphStartupMs,
        bytes: startup.graphStartupBytes,
      },
    };
    seenTiming = (await router.diagnostics()).resourceTiming.length;
    const [cold, result] = await step('cold', pair.destination);
    const routedKm = result.native.trip.summary.length;
    record = {
      ...record,
      routedKm,
      withinClass: Math.abs(routedKm - pair.targetKm) <= pair.targetKm * 0.15,
      cold,
    };
    const [warm] = await step('warm', pair.destination);
    record = { ...record, warm };
    const shape = result.native.trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
    // The destination lies on the cold route, so this is close to a warm route: a lower bound on a real drag.
    const [drag] = await step('drag', pointBackAlong(shape, config.dragMetres));
    record = { ...record, drag };
    const native = (await router.diagnostics()).native;
    record = {
      ...record,
      wasmHighWaterBytes: native.wasmHeapCapacityHighWaterBytes,
      decodedCacheBytes: native.decodedCacheBytes,
    };
  } catch (error: unknown) {
    record =
      error instanceof StepFailed
        ? { ...record, error: { step: error.step, code: error.code } }
        : { ...record, error: { step: current, code: 'ERROR' } };
  } finally {
    await router.dispose();
  }
  return startup === undefined ? { record } : { record, startup };
}

/**
 * Measures every pair `config.runs` times, in order, one session at a time,
 * calling `onRecord` after each so a long run shows progress. A failed pair is
 * recorded with its error and the run goes on.
 */
export async function runMeasurement(
  config: MeasureConfig,
  deps: MeasureDeps,
  onRecord: (record: PairRecord) => void = () => undefined,
): Promise<MeasureReport> {
  const records: PairRecord[] = [];
  let first: StartupLike | undefined;
  for (let run = 1; run <= config.runs; run += 1) {
    for (const [index, pair] of config.pairs.entries()) {
      const { record, startup } = await measureOne(pair, index, run, config, deps);
      first ??= startup;
      records.push(record);
      onRecord(record);
    }
  }
  return {
    release: first?.release ?? null,
    transport: 'individual-tiles',
    budgetMiB: config.budgetBytes / (1024 * 1024),
    wasmMemory: first === undefined ? null : { ...first.wasmMemory },
    dragMetres: config.dragMetres,
    records,
  };
}
