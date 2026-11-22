// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: the frame-time numbers the write-up's tables are made of,
 * from what the page recorded. Pure, so the arithmetic is tested and the page
 * only records. Throwaway (see `rolling-profile.ts`).
 */

/** One drawn frame, as the page recorded it. */
export interface FrameRecord {
  /** `requestAnimationFrame`'s timestamp, ms. */
  readonly at: number;
  /** Since the frame before, ms. */
  readonly gapMs: number;
  /** Building the scene frame and `render`, on the main thread, ms. */
  readonly cpuMs: number;
  readonly calls: number;
  readonly triangles: number;
}

/** A main-thread long task, as `PerformanceObserver('longtask')` saw it. */
export interface LongTask {
  readonly at: number;
  readonly durationMs: number;
}

/** A span of the ride, ms on the page's clock. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface FrameStats {
  readonly frames: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Display refreshes with no new frame: each gap's whole intervals past the first. */
  readonly dropped: number;
  /** Dropped frames a second of the spans measured. */
  readonly droppedPerSecond: number;
  readonly cpuP95Ms: number;
  /** The longest frame on the main thread: a stall's own cost, where its gap lands on the next frame. */
  readonly cpuMaxMs: number;
  readonly callsMax: number;
  readonly trianglesMax: number;
  readonly longTasks: number;
  readonly longTaskMaxMs: number;
}

/** The value `share` of the way up `sorted` (nearest rank). */
export function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[rank] as number;
}

/** The spans `halfMs` either side of each event. */
export function around(events: readonly number[], halfMs: number): Span[] {
  return events.map((at) => ({ from: at - halfMs, to: at + halfMs }));
}

const inside = (at: number, spans: readonly Span[]): boolean =>
  spans.some((span) => at >= span.from && at < span.to);

/**
 * The frames (by their timestamp) and long tasks (by their start) inside
 * `spans`, summarised against a display interval of `displayMs`.
 */
export function frameStats(
  frames: readonly FrameRecord[],
  tasks: readonly LongTask[],
  displayMs: number,
  spans: readonly Span[],
): FrameStats {
  const chosen = frames.filter((frame) => inside(frame.at, spans));
  const gaps = chosen.map((frame) => frame.gapMs).sort((a, b) => a - b);
  const cpu = chosen.map((frame) => frame.cpuMs).sort((a, b) => a - b);
  const dropped = chosen.reduce(
    (sum, frame) => sum + Math.max(0, Math.round(frame.gapMs / displayMs) - 1),
    0,
  );
  const seconds = spans.reduce((sum, span) => sum + (span.to - span.from), 0) / 1000;
  const long = tasks.filter((task) => inside(task.at, spans));
  return {
    frames: chosen.length,
    p50Ms: round(percentile(gaps, 0.5)),
    p95Ms: round(percentile(gaps, 0.95)),
    maxMs: round(gaps[gaps.length - 1] ?? 0),
    dropped,
    droppedPerSecond: seconds > 0 ? round(dropped / seconds) : 0,
    cpuP95Ms: round(percentile(cpu, 0.95)),
    cpuMaxMs: round(cpu[cpu.length - 1] ?? 0),
    callsMax: chosen.reduce((most, frame) => Math.max(most, frame.calls), 0),
    trianglesMax: chosen.reduce((most, frame) => Math.max(most, frame.triangles), 0),
    longTasks: long.length,
    longTaskMaxMs: round(long.reduce((most, task) => Math.max(most, task.durationMs), 0)),
  };
}

/** Steady: everything in `whole` outside `spans`. */
export function outside(whole: Span, spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  let at = whole.from;
  for (const span of sorted) {
    if (span.from > at) out.push({ from: at, to: Math.min(span.from, whole.to) });
    at = Math.max(at, span.to);
  }
  if (at < whole.to) out.push({ from: at, to: whole.to });
  return out.filter((span) => span.to > span.from);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** How long each stage of a plan took, in milliseconds. */
export interface PlanTimings {
  corridorMs: number;
  landMs: number;
  urbanMs: number;
  plansMs: number;
}

/** One plan put in the frame, as the page recorded it. */
export interface PlanRecord {
  readonly at: number;
  readonly mode: 'main' | 'worker';
  readonly plans: number;
  readonly buildingsHeld: number;
  readonly timings: PlanTimings;
  /** In the worker, ms; absent on the main thread. */
  readonly workerMs?: number;
  /** On the main thread, ms: everything done there to put the plan in the frame. */
  readonly mainMs: number;
  /** From the swap or block that asked for it to the plan's being put in the frame, ms. */
  readonly latencyMs: number;
}

/** One block read, as the page recorded it. */
export interface BlockRecord {
  readonly at: number;
  readonly key: number;
  readonly readMs: number;
  readonly decodeMs: number;
  readonly bytes: number;
  readonly tiles: number;
  readonly buildings: number;
}

/** What the page publishes on `window.__spike`. */
export interface SpikeRun {
  ready: boolean;
  done: boolean;
  error?: string;
  config: Record<string, string | number>;
  renderer?: string;
  outcome?: string;
  displayMs?: number;
  rideFrom?: number;
  rideTo?: number;
  frames: FrameRecord[];
  longTasks: LongTask[];
  /** When each junction's choice swapped the profile's tail. */
  swaps: number[];
  /** When the rider rode through each junction. */
  junctions: number[];
  plans: PlanRecord[];
  blocks: BlockRecord[];
  tilesAsked: number;
  profileViews?: number;
  heapBytes?: number;
}

/** The write-up's spans: 1.5 s either side of an event, 3 s in all. */
export const AROUND_MS = 1_500;

/**
 * A finished run's numbers: steady, at the swaps and through the corners
 * (each {@link AROUND_MS} either side), the plans after the ride's first, and
 * the blocks read.
 */
export function summariseRun(run: SpikeRun) {
  const whole = { from: run.rideFrom ?? 0, to: run.rideTo ?? 0 };
  const swaps = around(run.swaps, AROUND_MS);
  const corners = around(run.junctions, AROUND_MS);
  const displayMs = run.displayMs ?? 1000 / 60;
  const stats = (spans: readonly Span[]): FrameStats =>
    frameStats(run.frames, run.longTasks, displayMs, spans);
  // The first plan is the ride's start's, made before the ride, as a ride start waits for it.
  const plans = run.plans.slice(1);
  const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
  const p = (values: readonly number[], share: number): number =>
    round(percentile(sorted(values), share));
  const reads = run.blocks.map((block) => block.readMs);
  const seconds = (whole.to - whole.from) / 1000;
  return {
    config: run.config,
    renderer: run.renderer,
    outcome: run.outcome,
    displayMs: Math.round(displayMs * 100) / 100,
    rideSeconds: round(seconds),
    turns: run.swaps.length,
    overall: stats([whole]),
    steady: stats(outside(whole, [...swaps, ...corners])),
    atSwaps: stats(swaps),
    atCorners: stats(corners),
    plans: {
      count: plans.length,
      buildingsHeldMax: Math.max(0, ...plans.map((plan) => plan.buildingsHeld)),
      plannedMax: Math.max(0, ...plans.map((plan) => plan.plans)),
      mainMsP50: p(
        plans.map((plan) => plan.mainMs),
        0.5,
      ),
      mainMsMax: p(
        plans.map((plan) => plan.mainMs),
        1,
      ),
      workerMsP50: p(
        plans.map((plan) => plan.workerMs ?? 0),
        0.5,
      ),
      workerMsMax: p(
        plans.map((plan) => plan.workerMs ?? 0),
        1,
      ),
      landMsMax: p(
        plans.map((plan) => plan.timings.landMs),
        1,
      ),
      urbanMsMax: p(
        plans.map((plan) => plan.timings.urbanMs),
        1,
      ),
      plansMsMax: p(
        plans.map((plan) => plan.timings.plansMs),
        1,
      ),
      latencyMsP50: p(
        plans.map((plan) => plan.latencyMs),
        0.5,
      ),
      latencyMsMax: p(
        plans.map((plan) => plan.latencyMs),
        1,
      ),
    },
    blocks: {
      read: run.blocks.length,
      tilesAsked: run.tilesAsked,
      tilesPerHour: seconds > 0 ? Math.round((run.tilesAsked * 3600) / seconds) : 0,
      readMsP50: p(reads, 0.5),
      readMsP95: p(reads, 0.95),
      readMsMax: p(reads, 1),
      decodeMsMax: p(
        run.blocks.map((block) => block.decodeMs),
        1,
      ),
      kibMax: Math.round(Math.max(0, ...run.blocks.map((block) => block.bytes)) / 1024),
    },
    profileViews: run.profileViews,
    heapMiB: run.heapBytes === undefined ? undefined : Math.round(run.heapBytes / 1048576),
  };
}
