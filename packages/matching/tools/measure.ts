// SPDX-License-Identifier: Apache-2.0

/**
 * The measurement harness — #65's second, fourth and fifth criteria.
 *
 * Run it with `pnpm --filter @onyourleft/matching run spike:measure`. It prints
 * a table; it asserts nothing and gates nothing. The numbers it produces are
 * transcribed into `docs/spikes/0001-segment-matching.md` with the date and the
 * machine they came from, because a measurement without provenance is a claim.
 *
 * ⚠️ **This file reads a clock and the prototype does not.** `src/` compiles
 * under `tsconfig.platform-free.json` with `types: []`, so `performance.now()`
 * is a compile error there and is available here. That split is deliberate: a
 * prototype that timed itself would be measuring its own instrumentation, and
 * the timing would then be impossible to remove for a fair comparison.
 */

import { distanceBetween } from '@onyourleft/domain';

import { discreteFrechet } from '../src/frechet';
import { indexCorpus, matchRide, nearestApproachIndex, type RideTrace } from '../src/pipeline';
import { fourHourRide, syntheticCorpus, traversalOf } from './corpus';

/** One row of the fan-out table. */
export interface StageMeasurement {
  readonly corpusSize: number;
  readonly indexMilliseconds: number;
  readonly matchMilliseconds: number;
  readonly afterPrefilter: number;
  readonly afterEndpointGate: number;
  readonly afterSimilarity: number;
}

/**
 * Time one four-hour ride against a corpus of `corpusSize` segments.
 *
 * The corpus is indexed **once, outside the timed region**, and that split is
 * reported rather than hidden: indexing is a per-corpus cost paid when a
 * segment is created, and matching is the per-ride cost paid on every upload.
 * Rolling them together would make the per-ride number look far worse than it
 * is, and would be the wrong number to design against.
 */
export function measureStages(corpusSize: number, seed = 1): StageMeasurement {
  const segments = syntheticCorpus(corpusSize, seed);
  const ride = fourHourRide(segments, seed + 1);

  const indexStart = performance.now();
  const indexed = indexCorpus(segments);
  const indexMilliseconds = performance.now() - indexStart;

  const matchStart = performance.now();
  const result = matchRide(ride, indexed);
  const matchMilliseconds = performance.now() - matchStart;

  return {
    corpusSize,
    indexMilliseconds,
    matchMilliseconds,
    afterPrefilter: result.counts.afterPrefilter,
    afterEndpointGate: result.counts.afterEndpointGate,
    afterSimilarity: result.counts.afterSimilarity,
  };
}

/** What {@link measureMissRate} found. #65's fourth criterion. */
export interface MissRate {
  readonly noiseMetres: number;
  readonly traversals: number;
  readonly matched: number;
  /** In `[0, 1]`. The number "it works" leaves out. */
  readonly missed: number;
}

/**
 * How many known-good traversals the matcher misses, at a stated tolerance.
 *
 * Each trial rides one segment of the corpus exactly, with independent
 * Gaussian-ish noise per sample, and asks whether the matcher finds it.
 *
 * ⚠️ **Independent noise is the EASY case.** Real GNSS error is strongly
 * autocorrelated — a receiver under tree cover is wrong in the same direction
 * for many consecutive seconds, which walks the whole trace sideways rather
 * than jittering it around the truth. So this miss rate is a floor, and the
 * write-up says so rather than quoting it as the expected field rate.
 */
export function measureMissRate(noiseMetres: number, trials = 200, seed = 7): MissRate {
  const segments = syntheticCorpus(trials, seed);
  const indexed = indexCorpus(segments);

  let matched = 0;
  for (const [index, segment] of segments.entries()) {
    const ride = traversalOf(segment, { noiseMetres, seed: seed + index });
    const found = matchRide(ride, indexed).efforts.some(
      (effort) => effort.segmentId === segment.id,
    );
    if (found) {
      matched += 1;
    }
  }

  return {
    noiseMetres,
    traversals: segments.length,
    matched,
    missed: (segments.length - matched) / segments.length,
  };
}

/** What {@link measureTimingCost} found. #65's fifth criterion. */
export interface TimingCost {
  readonly intervalSeconds: number;
  readonly samples: number;
  /** Mean absolute difference, in seconds, between the two timings. */
  readonly meanSeconds: number;
  readonly worstSeconds: number;
}

/**
 * What **nearest recorded sample** timing costs against an interpolated
 * crossing, at a given recording interval.
 *
 * #65 asks the spike to quantify the difference, and notes that at a 5 s
 * interval it "changes every recorded time by up to several seconds, which is
 * larger than most leaderboard margins".
 *
 * ⚠️ **This is not a choice being weighed.** ADR 0007 D-2.2 forbids
 * synthesising a point to decide a crossing, and an interpolated crossing time
 * is that construct with a clock attached. The interpolated figure is computed
 * here **only as a control**, so the write-up can state the price of the
 * constraint rather than assert that it is small.
 */
export function measureTimingCost(intervalSeconds: number, trials = 100, seed = 11): TimingCost {
  const segments = syntheticCorpus(trials, seed);
  const indexed = indexCorpus(segments);

  const differences: number[] = [];
  for (const [index, segment] of segments.entries()) {
    const dense = traversalOf(segment, { seed: seed + index });
    // Thin the trace to the interval under test, which is what a device
    // recording every N seconds actually produces.
    const thinned: RideTrace = {
      positions: dense.positions.filter((_unused, i) => i % intervalSeconds === 0),
      times: dense.times
        .filter((_unused, i) => i % intervalSeconds === 0)
        .map((_unused, i) => i * intervalSeconds),
    };

    const [effort] = matchRide(thinned, indexed).efforts.filter(
      (candidate) => candidate.segmentId === segment.id,
    );
    if (effort === undefined) {
      continue;
    }

    const startAt = nearestApproachIndex(thinned, segment.start.position, effort.startIndex);
    const endAt = nearestApproachIndex(thinned, segment.end.position, effort.endIndex);
    if (startAt === undefined || endAt === undefined) {
      continue;
    }
    const interpolated = (endAt - startAt) * intervalSeconds;
    differences.push(Math.abs(interpolated - effort.elapsedSeconds));
  }

  if (differences.length === 0) {
    return { intervalSeconds, samples: 0, meanSeconds: 0, worstSeconds: 0 };
  }
  const total = differences.reduce((sum, value) => sum + value, 0);
  return {
    intervalSeconds,
    samples: differences.length,
    meanSeconds: total / differences.length,
    worstSeconds: Math.max(...differences),
  };
}

/**
 * How far apart two consecutive samples are at a given interval and speed —
 * the number that makes the timing cost intuitive rather than abstract.
 */
export function sampleSpacingMetres(intervalSeconds: number, kilometresPerHour = 30): number {
  return (kilometresPerHour / 3.6) * intervalSeconds;
}

/** What {@link measureIntervalSensitivity} found. */
export interface IntervalSensitivity {
  readonly intervalSeconds: number;
  readonly spacingMetres: number;
  readonly endpointRadiusMetres: number;
  readonly traversals: number;
  readonly matched: number;
}

/**
 * How many known-good traversals survive at a given **recording interval**,
 * for a given endpoint radius.
 *
 * ⚠️ **This measurement was not planned and is the most consequential thing
 * the spike found.** It exists because the timing comparison above returned
 * *zero efforts* at a 5 s interval, which first looked like a harness bug and
 * is not:
 *
 * > At 30 km/h a 5 s interval puts samples **41.7 m** apart. #64's endpoint
 * > tolerance radius is **15 m**. A rider can therefore pass a segment's start
 * > without ever recording a sample inside the radius — so the endpoint gate
 * > never opens, and **no effort is detected at all**.
 *
 * It is a silent, total failure for anyone on smart recording, and no
 * similarity threshold rescues it: stage 3 never runs, because stage 2 never
 * produced a span. #64's own note that "the recording interval is the worse
 * half" of the endpoint error turns out to understate it — at a long enough
 * interval the endpoint model does not degrade, it stops working.
 *
 * The write-up carries this to #66 as a required design change, with the
 * relationship measured here rather than asserted.
 */
export function measureIntervalSensitivity(
  intervalSeconds: number,
  endpointRadiusMetres: number,
  trials = 100,
  seed = 13,
): IntervalSensitivity {
  const segments = syntheticCorpus(trials, seed).map((segment) => ({
    ...segment,
    start: { ...segment.start, radius: endpointRadiusMetres as typeof segment.start.radius },
    end: { ...segment.end, radius: endpointRadiusMetres as typeof segment.end.radius },
  }));
  const indexed = indexCorpus(segments);

  let matched = 0;
  for (const [index, segment] of segments.entries()) {
    const dense = traversalOf(segment, { seed: seed + index });
    const thinned: RideTrace = {
      positions: dense.positions.filter((_unused, i) => i % intervalSeconds === 0),
      times: dense.times
        .filter((_unused, i) => i % intervalSeconds === 0)
        .map((_unused, i) => i * intervalSeconds),
    };
    if (matchRide(thinned, indexed).efforts.some((effort) => effort.segmentId === segment.id)) {
      matched += 1;
    }
  }

  return {
    intervalSeconds,
    spacingMetres: sampleSpacingMetres(intervalSeconds),
    endpointRadiusMetres,
    traversals: segments.length,
    matched,
  };
}

/** What {@link measureThresholdCoupling} found. */
export interface ThresholdCoupling {
  readonly endpointRadiusMetres: number;
  /** Fréchet distance of a PERFECT traversal — noise-free, same road. */
  readonly perfectTraversalMetres: number;
  readonly matchedOf: number;
  readonly matched: number;
}

/**
 * How the endpoint radius and the similarity threshold are **coupled** — the
 * spike's second unplanned finding, and the one that makes the first hard to
 * fix.
 *
 * A span opens at the **first sample inside the start radius**, so it swallows
 * up to `radius` metres of approach that is not part of the segment. The
 * Fréchet distance of a *noise-free, same-road* traversal is therefore bounded
 * below by roughly the radius — and once the radius exceeds
 * `SIMILARITY_METRES`, stage 3 rejects a perfect ride.
 *
 * That is why the obvious repair for the recording-interval failure does not
 * work: widening the radius to catch a coarse trace pushes the similarity
 * budget past its threshold, and widening the threshold to compensate is
 * exactly the tolerance-loosening that #65's third criterion warns makes the
 * false-positive rate worse. The two failures are in tension, and #66 has to
 * break the tension rather than tune between them — see the write-up.
 */
export function measureThresholdCoupling(
  endpointRadiusMetres: number,
  trials = 50,
  seed = 17,
): ThresholdCoupling {
  const segments = syntheticCorpus(trials, seed).map((segment) => ({
    ...segment,
    start: { ...segment.start, radius: endpointRadiusMetres as typeof segment.start.radius },
    end: { ...segment.end, radius: endpointRadiusMetres as typeof segment.end.radius },
  }));
  const indexed = indexCorpus(segments);

  let matched = 0;
  let worstPerfect = 0;
  for (const [index, segment] of segments.entries()) {
    const ride = traversalOf(segment, { seed: seed + index });
    const result = matchRide(ride, indexed);
    if (result.efforts.some((effort) => effort.segmentId === segment.id)) {
      matched += 1;
    }
    // What the span WOULD have scored, computed from the gate's own span so the
    // number is the one stage 3 actually saw.
    const span = spanFor(ride, segment.start.position, endpointRadiusMetres);
    if (span !== undefined) {
      worstPerfect = Math.max(
        worstPerfect,
        discreteFrechet(ride.positions.slice(span), segment.geometry),
      );
    }
  }

  return {
    endpointRadiusMetres,
    perfectTraversalMetres: worstPerfect,
    matchedOf: segments.length,
    matched,
  };
}

/** The index of the first sample within `radius` of `target`. */
function spanFor(
  ride: RideTrace,
  target: Parameters<typeof distanceBetween>[0],
  radius: number,
): number | undefined {
  for (const [index, position] of ride.positions.entries()) {
    if (distanceBetween(target, position) <= radius) {
      return index;
    }
  }
  return undefined;
}

function round(value: number, places = 1): string {
  return value.toFixed(places);
}

/** Prints every table the write-up transcribes. */
function main(): void {
  const stamp = new Date().toISOString();
  process.stdout.write(`# Segment-matching spike (#65) — measured ${stamp}\n`);
  process.stdout.write(`# node ${process.version} on ${process.platform}/${process.arch}\n\n`);

  process.stdout.write('## Fan-out and timing, one four-hour ride at 1 Hz (14 400 samples)\n\n');
  process.stdout.write(
    '| corpus | index ms | match ms | after prefilter | after endpoint gate | efforts |\n',
  );
  process.stdout.write('|---|---|---|---|---|---|\n');
  for (const size of [1_000, 10_000, 100_000]) {
    const row = measureStages(size);
    process.stdout.write(
      `| ${row.corpusSize.toLocaleString('en-GB')} | ${round(row.indexMilliseconds)} | ` +
        `${round(row.matchMilliseconds)} | ${String(row.afterPrefilter)} | ` +
        `${String(row.afterEndpointGate)} | ${String(row.afterSimilarity)} |\n`,
    );
  }

  process.stdout.write('\n## Miss rate at SIMILARITY_METRES = 25, 200 known-good traversals\n\n');
  process.stdout.write('| per-sample noise | traversals | matched | missed |\n');
  process.stdout.write('|---|---|---|---|\n');
  for (const noise of [0, 5, 10, 20, 30]) {
    const row = measureMissRate(noise);
    process.stdout.write(
      `| ${String(row.noiseMetres)} m | ${String(row.traversals)} | ${String(row.matched)} | ` +
        `${round(row.missed * 100)}% |\n`,
    );
  }

  process.stdout.write('\n## Nearest-sample vs interpolated timing (the control)\n\n');
  process.stdout.write('| interval | spacing at 30 km/h | efforts | mean diff | worst diff |\n');
  process.stdout.write('|---|---|---|---|---|\n');
  for (const interval of [1, 2, 3, 5, 10]) {
    const row = measureTimingCost(interval);
    // ⚠️ Zero efforts is a RESULT, not an empty cell. Printing "0.00 s" beside
    // it would read as "no difference" when it means "nothing was detected at
    // all" — the opposite conclusion. See `measureIntervalSensitivity`.
    const cells =
      row.samples === 0
        ? '**0 — no effort detected at all** | — | —'
        : `${String(row.samples)} | ${round(row.meanSeconds, 2)} s | ${round(row.worstSeconds, 2)} s`;
    process.stdout.write(
      `| ${String(row.intervalSeconds)} s | ${round(sampleSpacingMetres(row.intervalSeconds))} m | ` +
        `${cells} |\n`,
    );
  }

  process.stdout.write(
    '\n## The endpoint gate against recording interval — the unplanned finding\n\n',
  );
  process.stdout.write('| interval | spacing | endpoint radius | matched of 100 |\n');
  process.stdout.write('|---|---|---|---|\n');
  for (const radius of [15, 30, 50]) {
    for (const interval of [1, 2, 5, 10]) {
      const row = measureIntervalSensitivity(interval, radius);
      process.stdout.write(
        `| ${String(row.intervalSeconds)} s | ${round(row.spacingMetres)} m | ` +
          `${String(row.endpointRadiusMetres)} m | ${String(row.matched)} |\n`,
      );
    }
  }

  process.stdout.write(
    '\n## Why widening the radius does not fix it — the thresholds are coupled\n\n',
  );
  process.stdout.write(
    `At a 1 s interval, noise-free, on the segment's own road. ` +
      `\`SIMILARITY_METRES\` is 25.\n\n`,
  );
  process.stdout.write('| endpoint radius | Fréchet of a PERFECT traversal | matched of 50 |\n');
  process.stdout.write('|---|---|---|\n');
  for (const radius of [10, 15, 20, 25, 30, 40, 50]) {
    const row = measureThresholdCoupling(radius);
    process.stdout.write(
      `| ${String(row.endpointRadiusMetres)} m | ${round(row.perfectTraversalMetres)} m | ` +
        `${String(row.matched)} |\n`,
    );
  }
}

// `process.argv[1]` is the entry script. Running this file directly prints the
// tables; importing it from a test does not.
if (process.argv[1]?.endsWith('measure.ts') === true) {
  main();
}
