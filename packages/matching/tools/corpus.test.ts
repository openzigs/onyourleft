// SPDX-License-Identifier: Apache-2.0

/**
 * The corpus is the evidence, so its determinism is part of the claim.
 *
 * Every number in `docs/spikes/0001-segment-matching.md` is transcribed from a
 * dated run of `spike:measure` against this generator. If the generator is not
 * deterministic, nobody can reproduce those numbers and the write-up is a
 * report of something that happened once — which is the failure mode the FIT
 * fixture corpus already guards against, for the same reason
 * (`packages/fit/fixtures/README.md`).
 *
 * ⚠️ It is deterministic **by construction, not by policy**: `seededRandom` is
 * a mulberry32, and `eslint.config.js` cannot help here the way it does in
 * `packages/physics` — the harness lives in `tools/`, outside the
 * platform-isolated block, precisely so it may read a clock to time things.
 * A stray `Math.random()` in the generator would therefore draw no lint error
 * at all, and these are the tests that would notice.
 */

import { describe, expect, it } from 'vitest';

import { fourHourRide, seededRandom, syntheticCorpus, traversalOf } from './corpus';

describe('the synthetic corpus is reproducible', () => {
  it('gives the identical corpus for the identical seed', () => {
    expect(syntheticCorpus(25, 3)).toEqual(syntheticCorpus(25, 3));
  });

  it('gives a different corpus for a different seed, so the seed is doing work', () => {
    // Without this, a generator that ignored its seed entirely would satisfy
    // the test above — and every measurement would be one measurement repeated.
    expect(syntheticCorpus(25, 3)).not.toEqual(syntheticCorpus(25, 4));
  });

  it('the ride and a traversal are reproducible too, not only the corpus', () => {
    const corpus = syntheticCorpus(25, 3);
    expect(fourHourRide(corpus, 5)).toEqual(fourHourRide(corpus, 5));
    const [segment] = corpus;
    expect(segment).toBeDefined();
    if (segment === undefined) {
      return;
    }
    expect(traversalOf(segment, { noiseMetres: 10, seed: 9 })).toEqual(
      traversalOf(segment, { noiseMetres: 10, seed: 9 }),
    );
  });
});

describe('the generator’s own randomness', () => {
  it('is a pure function of the seed, and repeats across calls', () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const drawn = Array.from({ length: 8 }, () => first());
    expect(drawn).toEqual(Array.from({ length: 8 }, () => second()));
  });

  it('stays inside [0, 1) and does not return the same value every time', () => {
    const draw = seededRandom(42);
    const drawn = Array.from({ length: 64 }, () => draw());
    for (const value of drawn) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(drawn).size).toBeGreaterThan(1);
  });
});
