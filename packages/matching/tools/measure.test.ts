// SPDX-License-Identifier: Apache-2.0

/**
 * The measurement harness, at small scale, and the two findings it produced.
 *
 * `spike:measure` runs the full corpus and takes about a minute; this runs the
 * same functions at a size that belongs in the fast suite. Its job is not to
 * reproduce the numbers in the write-up — those are transcribed from a dated
 * run — but to stop the harness rotting and to pin the **shape** of the two
 * findings, so a later change that quietly fixed or broke them is visible.
 *
 * ⚠️ **This file is outside the coverage report**, like `packages/fit/tools`:
 * the root `vitest.config.ts` includes each package's `src` tree only. That is
 * deliberate — it is authoring-time code that ships in nothing, and folding it
 * into the prototype's denominator would measure the wrong thing.
 *
 * (The glob is not written out above on purpose: it contains the two characters
 * that end a block comment, and the first draft of this file spelled it in full
 * and turned the rest of this paragraph into executable code. `ReferenceError:
 * src is not defined` is what that looks like from the test runner.)
 */

import { describe, expect, it } from 'vitest';

import {
  measureIntervalSensitivity,
  measureMissRate,
  measureStages,
  measureThresholdCoupling,
  measureTimingCost,
  sampleSpacingMetres,
} from './measure';

describe('the fan-out narrows at every stage', () => {
  it('passes fewer segments to each stage than the one before', () => {
    // #65: "A recommendation without a measured fan-out is a guess."
    const row = measureStages(1_000);
    expect(row.corpusSize).toBe(1_000);
    expect(row.afterPrefilter).toBeLessThan(row.corpusSize);
    expect(row.afterEndpointGate).toBeLessThanOrEqual(row.afterPrefilter);
    expect(row.afterSimilarity).toBeLessThanOrEqual(row.afterEndpointGate);
    // And it did real work rather than filtering everything away.
    expect(row.afterSimilarity).toBeGreaterThan(0);
  });

  it(
    'survivor count is bounded by the ride’s own footprint, not by the corpus size',
    // ⚠️ Two explicit choices, both about `test:coverage` rather than about the
    // matcher. The pair below is 1k/10k and not the write-up's 1k/100k, because
    // a 100 000-segment corpus belongs in `spike:measure` and not in a suite a
    // contributor runs on every save — the sublinearity is already visible at
    // this size (105 survivors at 1k, 226 at 10k, on the run this was written
    // against), and §3 of the write-up carries the 100k row. And the timeout is
    // raised from Vitest's 5 s default because V8 coverage instrumentation
    // costs this file roughly 5x: it passed the default comfortably under
    // `pnpm run test` and timed out under `pnpm run test:coverage`, which is
    // the one CI actually runs.
    //
    // (Vitest 4 takes the options as the SECOND argument. The removed
    // `(name, fn, options)` form fails the whole FILE to load, so it looks like
    // a broken import rather than a bad call.)
    { timeout: 30_000 },
    () => {
      // The headline result. A corpus ten times larger does not put ten times
      // more candidates into stage 2, because the prefilter is limited by how
      // much ground the RIDE covers. That is what makes the approach viable at
      // 100 000 segments at all.
      const small = measureStages(1_000);
      const large = measureStages(10_000);
      expect(large.corpusSize / small.corpusSize).toBe(10);
      expect(large.afterPrefilter).toBeLessThan(small.afterPrefilter * 10);
    },
  );
});

describe('the miss rate is characterised rather than asserted to be fine', () => {
  it('is zero with no noise and total at noise well past the threshold', () => {
    // #65's fourth criterion: "'It works' without a miss rate is not a result."
    expect(measureMissRate(0, 20).missed).toBe(0);
    expect(measureMissRate(40, 20).missed).toBe(1);
  });

  it('degrades monotonically as noise grows', () => {
    const clean = measureMissRate(0, 20).missed;
    const noisy = measureMissRate(20, 20).missed;
    expect(noisy).toBeGreaterThan(clean);
  });
});

describe('finding 1 — the endpoint gate fails outright at a coarse recording interval', () => {
  it('a 15 m radius matches everything at 1 s and NOTHING at 5 s', () => {
    // ⚠️ Not a degradation — a cliff. At 30 km/h a 5 s interval puts samples
    // 41.7 m apart and #64's endpoint radius is 15 m, so a rider can pass a
    // segment's start without ever recording a sample inside it. No similarity
    // threshold rescues this: stage 3 never runs.
    expect(measureIntervalSensitivity(1, 15, 20).matched).toBe(20);
    expect(measureIntervalSensitivity(5, 15, 20).matched).toBe(0);
  });

  it('nearest-sample and interpolated timing agree exactly at 1 Hz, which is §4’s number', () => {
    // The write-up's §4 claim, asserted rather than transcribed: at a 1 s
    // interval the constraint ADR 0007 D-2.2 imposes costs nothing measurable.
    // ⚠️ Without this the control could be a constant and the suite would stay
    // green — the sample count below does not depend on the value at all, which
    // a mutation found.
    const oneHertz = measureTimingCost(1, 20);
    expect(oneHertz.samples).toBe(20);
    expect(oneHertz.meanSeconds).toBeCloseTo(0, 6);
    expect(oneHertz.worstSeconds).toBeCloseTo(0, 6);
  });

  it('the timing comparison reports no efforts at all at 5 s, which is the same fact', () => {
    // The measurement that surfaced it. Zero efforts is a RESULT — printing a
    // "0.00 s difference" beside it would read as "the two timings agree".
    expect(measureTimingCost(1, 20).samples).toBeGreaterThan(0);
    expect(measureTimingCost(5, 20).samples).toBe(0);
  });

  it('spacing is what drives it, and it is linear in the interval', () => {
    expect(sampleSpacingMetres(1)).toBeCloseTo(8.33, 1);
    expect(sampleSpacingMetres(5)).toBeCloseTo(41.67, 1);
    expect(sampleSpacingMetres(10)).toBeCloseTo(sampleSpacingMetres(5) * 2, 6);
  });
});

describe('finding 2 — the endpoint radius and the similarity threshold are coupled', () => {
  it('a wider radius raises the Fréchet distance of a PERFECT traversal', () => {
    // The span opens at the first sample inside the radius, so it swallows up
    // to `radius` metres of approach that is not part of the segment. A
    // noise-free ride down the segment's own road therefore scores worse as
    // the radius widens.
    const tight = measureThresholdCoupling(15, 10);
    const wide = measureThresholdCoupling(50, 10);
    expect(wide.perfectTraversalMetres).toBeGreaterThan(tight.perfectTraversalMetres);
  });

  it('so widening the radius past the similarity threshold matches NOTHING', () => {
    // Which is why the obvious repair for finding 1 does not work, and why
    // #66 has to break the tension rather than tune between the two.
    expect(measureThresholdCoupling(15, 10).matched).toBe(10);
    expect(measureThresholdCoupling(50, 10).matched).toBe(0);
  });
});
