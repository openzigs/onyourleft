// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #49's seventh acceptance criterion, and its definition of done: *"The screen
 * sustains 1 Hz updates for **4 hours** without unbounded memory growth or
 * frame-rate degradation, measured against the #44 simulator and recorded."*
 *
 * ## What is measured, and what "unbounded" is taken to mean
 *
 * A four-hour ride at 1 Hz **must** grow in one way: it accumulates 14 400
 * samples, and a recording that did not would be losing the ride. So the
 * assertion is not "nothing grows". It is that everything which is **not** the
 * ride is flat:
 *
 * | Quantity | Expected | Why it is the one to watch |
 * |---|---|---|
 * | listeners on the controller | constant | a subscription leaked per tick is the classic slow death |
 * | entries in the latest-reading map | constant, one per channel | a map keyed by time rather than by channel would grow here |
 * | metrics in the snapshot | constant | a snapshot that appended rather than replaced |
 * | notices on screen | constant | a message list nothing prunes |
 * | flushed prefix | ≈ one per 5 s | the checkpoint schedule still running at hour four |
 *
 * And the thing that would show a **frame-rate** problem: the per-tick work
 * must not grow with the ride. That is asserted by **counting the work**, not
 * by timing it — see below.
 *
 * ## Why this counts operations instead of measuring elapsed time (#165)
 *
 * It used to assert that the wall-clock cost of hours 3-4 was under twice that
 * of hours 1-2. That assertion measured the machine rather than the code, and
 * it failed twice on unrelated pull requests — most recently #168, at a ratio
 * of 2.0197 against a budget of 2.
 *
 * Measured on an idle machine at the time of the change, the steady-state
 * ratio is ~1.5 with a single-run spread of 1.458 to 1.614, and it is the same
 * on a tree with the change and without it (means 0.003 apart). So it sat
 * about 30% below its budget with noise of its own that was a third of the
 * headroom: a busy pool cleared it, and no code change was needed to make that
 * happen. Vitest runs files in a parallel pool, so the number it reported moved
 * with whatever else was scheduled beside it — and this suite grew from ~2 225
 * to ~2 567 tests in a day.
 *
 * A test that can fail without a defect is worse here than elsewhere, because
 * CLAUDE.md §5 makes the **mutation list** the gate: the workflow is apply,
 * run, read what went red, restore. One assertion that reddens on its own turns
 * every mutation run into a judgement call about whether the red is the
 * mutation or the pool, which is exactly when a real finding gets waved through
 * as noise.
 *
 * So the property is now pinned by counters, which do not move with load:
 * {@link MAXIMUM_CHUNK_SAMPLES} and the contiguity and cadence assertions on
 * the checkpoint windows. Each is a fact about what the code did, not about how
 * long the machine took to do it.
 *
 * ⚠️ **What this no longer catches, stated plainly.** A regression that is
 * purely computational — an O(n) scan per tick that allocates nothing and
 * persists nothing — produces no counter to observe and would now pass here.
 * Two things make that an acceptable trade rather than a hole. The snapshot
 * path is O(1) *by construction*: `RideSnapshot` carries `sampleCount` as a
 * number and no series, `controller.ts` reads `session?.sampleCount` and never
 * calls `series()` or `slice()`, and `metricStateFor` works from a single
 * latest reading per channel. And the engine's own per-sample cost belongs to
 * `packages/domain`, which is where a counter for it would go — not to a test
 * whose subject is the screen.
 *
 * ⚠️ This is a **headless** measurement: it drives the controller, the recorder
 * and the store, not a browser's compositor. It cannot see a layout thrash or a
 * React render loop, and it is not evidence about either. What it does prove is
 * that the state machine underneath the screen is O(1) per tick and holds no
 * growing structure, which is the half that a browser profiler cannot easily
 * isolate.
 */

import { seconds } from '@onyourleft/domain';
import { createSimulator, ftmsTrainer, hrsStrap } from '@onyourleft/sensors/simulator';
import { recordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_FLUSH_INTERVAL_SECONDS,
  DEFAULT_LATE_TOLERANCE_SECONDS,
  type RecordingCheckpointStore,
} from '../recording/recorder';

import { createRideController } from './controller';

/** Four hours at 1 Hz. */
const RIDE_SECONDS = 4 * 60 * 60;

/**
 * The most samples one checkpoint window may carry.
 *
 * Derived from the recorder's own cadence rather than written down, so that
 * changing the flush interval moves this with it instead of silently loosening
 * it: the recorder flushes every {@link DEFAULT_FLUSH_INTERVAL_SECONDS} seconds
 * and holds a slot open for {@link DEFAULT_LATE_TOLERANCE_SECONDS}, so at 1 Hz
 * a window is the samples since the last checkpoint plus whatever the tolerance
 * is still holding. Doubling that is the slack.
 *
 * **Observed: 5 samples, across 2 880 checkpoints** — one per five seconds of a
 * four-hour ride, which is the cadence exactly. The bound is 14, so there is
 * about 2.8× headroom, and the number that would actually fail it is
 * {@link RIDE_SECONDS} — three orders of magnitude away. That gap is the point:
 * a bound this far from both the observed value and the failure value cannot be
 * cleared by a quiet machine or failed by a busy one, which is the whole reason
 * this replaced a wall-clock ratio.
 */
const MAXIMUM_CHUNK_SAMPLES = 2 * (DEFAULT_FLUSH_INTERVAL_SECONDS + DEFAULT_LATE_TOLERANCE_SECONDS);

/** One checkpoint window, as the store was actually asked to write it. */
interface ObservedChunk {
  readonly seq: number;
  readonly fromIndex: number;
  readonly sampleCount: number;
}

/**
 * A stop on a hung run, not a performance assertion.
 *
 * The performance assertion is {@link MAXIMUM_CHUNK_SAMPLES} and the cadence
 * checks beside it, none of which reads a clock. This exists because Vitest's
 * default of five seconds is shorter than four simulated hours plus fourteen
 * thousand IndexedDB transactions on a cold runner, and a timeout that fired
 * there would read as a regression rather than as a slow machine.
 *
 * It is deliberately generous for the same reason the assertions no longer time
 * anything: it must fail only for a run that is hung, never for one that is
 * merely sharing a busy pool.
 */
const RUN_TIMEOUT_MILLISECONDS = 120_000;

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/**
 * @param observed - every checkpoint window is appended here as the recorder
 * asks for it, so the assertions read what the code did rather than what a
 * clock said about it. Recorded on the way through: the write still goes to the
 * real store, so this observes the path instead of replacing it.
 */
function harnessStore(observed?: ObservedChunk[]): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      harness.write(async (store) => store.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) => {
      observed?.push({
        seq: chunk.seq,
        fromIndex: chunk.fromIndex,
        sampleCount: chunk.sampleCount,
      });
      return harness.write(async (store) => store.appendRecordingChunk(chunk));
    },
    listRecordingSessions: async (owner) =>
      harness.write(async (store) => store.listRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      harness.write(async (store) => store.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      harness.write(async (store) => store.deleteRecordingSession(owner, id)),
  };
}

describe('criterion 7 — four hours at 1 Hz', () => {
  it(
    'sustains a four-hour ride with nothing but the ride itself growing',
    async () => {
      const { transport, bench } = createSimulator({
        devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' }), hrsStrap({ id: 'strap' })],
      });
      const chunks: ObservedChunk[] = [];
      const controller = createRideController({
        transport,
        store: harnessStore(chunks),
        athleteId: ATHLETE_A,
        newSessionId: () => recordingSessionId('endurance'),
        now: () => bench.now,
      });

      // A subscriber, because the screen is one and a controller that leaked a
      // listener per notification would only show it with something attached.
      let renders = 0;
      const unsubscribe = controller.subscribe(() => {
        renders += 1;
        // Read on every change, exactly as `useSyncExternalStore` does. A
        // snapshot that were O(samples) to build would be built 14 400 times.
        controller.getSnapshot();
      });

      await controller.pair('trainer');
      await controller.pair('heart-rate');
      await controller.start();

      const midpointAt = RIDE_SECONDS / 2;
      let sampleCountAtMidpoint = 0;
      let chunksAtMidpoint = 0;

      for (let second = 0; second < RIDE_SECONDS; second += 1) {
        bench.advance(seconds(1));
        await controller.tick(bench.now);
        if (second === midpointAt - 1) {
          sampleCountAtMidpoint = controller.getSnapshot().sampleCount;
          chunksAtMidpoint = chunks.length;
        }
      }

      const snapshot = controller.getSnapshot();

      // --- The ride grew, which is the point of recording one ---------------
      expect(snapshot.phase).toBe('recording');
      expect(snapshot.elapsedSeconds).toBe(RIDE_SECONDS);
      expect(snapshot.sampleCount).toBeGreaterThan(RIDE_SECONDS - 5);
      expect(sampleCountAtMidpoint).toBeGreaterThan(midpointAt - 5);

      // --- And nothing else did ---------------------------------------------
      expect(snapshot.metrics).toHaveLength(4);
      expect(snapshot.sensors).toHaveLength(2);
      // Still delivering at hour four, from both devices. A run that quietly
      // stopped receiving would satisfy every "did not grow" assertion above.
      expect(snapshot.metrics.filter((metric) => metric.state.kind === 'live')).toHaveLength(4);
      expect(snapshot.storage).toBe('ok');
      expect(renders).toBeGreaterThan(RIDE_SECONDS);

      // --- Per-tick work is flat, counted rather than timed (#165) ----------
      // Every checkpoint writes only the window since the last one. A recorder
      // that re-flushed the series would still produce a correct recording and
      // still pass every assertion above — and would do work proportional to
      // the ride on every flush, which is the regression this is here for.
      const widest = chunks.reduce((worst, chunk) => Math.max(worst, chunk.sampleCount), 0);
      expect(
        widest,
        `the widest checkpoint window carried ${String(widest)} samples across ${String(chunks.length)} ` +
          'checkpoints — a window that grows with the ride is per-tick work that grows with the ride',
      ).toBeLessThanOrEqual(MAXIMUM_CHUNK_SAMPLES);

      // Contiguous and forward-only: each window starts exactly where the last
      // one ended. This is what makes the bound above mean "incremental" rather
      // than merely "small" — a cumulative re-flush would leave `fromIndex` at
      // zero while `sampleCount` climbed.
      let expectedFrom = 0;
      for (const chunk of chunks) {
        expect(
          chunk.fromIndex,
          `checkpoint ${String(chunk.seq)} did not start where the last ended`,
        ).toBe(expectedFrom);
        expectedFrom += chunk.sampleCount;
      }
      expect(chunks.map((chunk) => chunk.seq)).toStrictEqual(chunks.map((_, index) => index));

      // And the cadence itself is flat: hours 3-4 checkpoint as often as hours
      // 1-2. A flush that slowed as the series grew would show up here as the
      // second half falling behind, with no clock involved.
      const chunksInSecondHalf = chunks.length - chunksAtMidpoint;
      expect(
        chunksInSecondHalf,
        `hours 1-2 wrote ${String(chunksAtMidpoint)} checkpoints and hours 3-4 wrote ${String(chunksInSecondHalf)}`,
      ).toBeGreaterThanOrEqual(chunksAtMidpoint - 1);

      unsubscribe();
      controller.dispose();

      // --- The four hours are on disk, read on a fresh connection -----------
      const recovered = await harness.read(async (store) =>
        store.recoverRecording(ATHLETE_A, recordingSessionId('endurance')),
      );
      expect(recovered?.sampleCount).toBeGreaterThan(RIDE_SECONDS - 10);
    },
    RUN_TIMEOUT_MILLISECONDS,
  );
});
