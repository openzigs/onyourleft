# `@onyourleft/matching` — the #65 spike

> ⚠️ **Throwaway by design. Nothing imports this package and nothing should.**
>
> It exists so that [#65](https://github.com/openzigs/onyourleft/issues/65)'s recommendation rests
> on measurements from runnable code rather than on estimates.
> [#66](https://github.com/openzigs/onyourleft/issues/66) either hardens it into a real matcher or
> deletes it, and either outcome is a success for a spike.

**The durable deliverable is [`docs/spikes/0001-segment-matching.md`](../../docs/spikes/0001-segment-matching.md).**
This package is its evidence. Read the write-up first; read this file before reusing any code here.

---

## 1. What is measured, and what is not

| | Status |
|---|---|
| Candidate 1 — geometric matching against `packages/domain`'s `Segment` | **Runs end to end.** Every number in the write-up comes from it |
| Candidate 2 — map-matching to a road graph, then edge-sequence search | **The algorithmic half runs; the snapper is stubbed.** Its numbers are an *upper bound*, and `edge-sequence.ts` names the three blockers |
| The corpus | **Synthetic**, generated from a seeded PRNG. #65's seventh criterion forbids a real person's ride files as a fixture, from any platform |
| A real GNSS trace | **Never tried.** Nothing here has met multipath, an urban canyon, or a device that reports a smoothed track |

So: the pipeline is honest, the thresholds are ours (§8 of the write-up lists every one), and the two
findings below are properties of the *design*, not of the fixture — but a green run of
`spike:measure` is not evidence that segment matching works on real rides. It is evidence about
which of two approaches to build, which is the question #65 asked.

## 2. The two findings

Both were produced by measurement rather than by review, and both are reproduced as tests in
`tools/measure.test.ts` so that a later change which quietly fixes or breaks them is visible.

1. **The endpoint gate does not degrade at a coarse recording interval — it stops.** At 30 km/h a
   5 s interval puts samples 41.7 m apart and #64's endpoint radius is 15 m, so a rider can pass a
   segment's start without ever recording a sample inside it. Matched-of-100 goes 100 → 0 between a
   1 s and a 2 s interval. No similarity threshold rescues it: stage 3 never runs.
2. **Widening the radius does not fix that, because the two thresholds are coupled.** A candidate
   span opens at the first sample inside the radius, so it swallows up to `radius` metres of
   approach that is not part of the segment. A *perfect, noise-free* traversal therefore scores
   worse as the radius widens; at a 50 m radius its Fréchet distance exceeds `SIMILARITY_METRES`
   and 0 of 50 known-good traversals match.

There is a third, smaller one: how a segment is *stored* sets a floor on similarity of about half
the coarser path's sample spacing. Write-up §1 has all three with their tables.

## 3. Layout

| Path | What it is |
|---|---|
| `src/grid.ts` | The prefilter. A 0.01° cell grid, and the cover of a path — which interpolates the cells *between* consecutive samples, so a fast rider does not skip one |
| `src/frechet.ts` | Discrete Fréchet distance (Eiter & Mannila 1994), two rows, O(m) space. `directedHausdorff` is the losing candidate, kept runnable and never wired in, so the write-up's claim about it is checkable |
| `src/pipeline.ts` | The three stages: prefilter → endpoint gate → similarity. `nearestApproachIndex` is the interpolation *control* — it is measured against and deliberately never called by the pipeline, because ADR 0007 D-2.2 forbids extrapolating a point to decide a crossing |
| `src/edge-sequence.ts` | Candidate 2's algorithmic half, and the three blockers on measuring the rest |
| `tools/corpus.ts` | The seeded synthetic corpus. Deterministic — mulberry32, no clock, no `Math.random` |
| `tools/measure.ts` | The harness `spike:measure` runs, and the source of the write-up's tables |

`src/` is platform-free the way `packages/domain` is, through the two-tsconfig pattern
`packages/fit` uses: `tsconfig.json` is the wide program (it has to cover `tools/`, where the
harness legitimately calls `performance.now()`), and **`tsconfig.platform-free.json` is the one
that enforces** — `src/` alone, `lib: ["ES2024"]`, `types: []`. A `performance.now()` in `src/` is
therefore a compile error. `pnpm --filter @onyourleft/matching run typecheck` runs both; reading
only the first is how the boundary would be believed absent.

## 4. Running it

```bash
# The fast suite. Part of `pnpm run test`, like every other package.
pnpm --filter @onyourleft/matching run test

# The full measurement run — a 100 000-segment corpus and a four-hour ride.
# About a minute, and it prints the write-up's tables as markdown.
pnpm --filter @onyourleft/matching run spike:measure
```

⚠️ **`spike:measure` is not part of any gate and must not become one.** It takes a minute, it
prints rather than asserts, and the numbers it produces belong in a dated write-up rather than in a
threshold. `tools/measure.test.ts` is the part that runs on every save: the same functions at a
size that belongs in the fast suite, asserting the *shape* of each finding rather than
reproducing its numbers.

⚠️ **`tools/` is outside the coverage report**, exactly as `packages/fit/tools` is (#110): the root
`vitest.config.ts` includes each package's `src` tree only. Folding an authoring-time harness into
the prototype's denominator would measure the wrong thing.

## 5. What binds anything built on this

- **[ADR 0007](../../docs/adr/0007-patent-posture.md) D-2** — the patent design-around. No
  oriented virtual start line derived from a user-selected point, no extrapolation of GPS points to
  decide a crossing, no two-tier loose/tight match whose tight tier is line crossings, no automatic
  discard of a stored overlapping segment, and no segment-definition flow whose only input is
  picking points on a map. Write-up §7 says what this prototype does instead, with the prior-art
  citations D-6 requires.
- **[ADR 0012](../../docs/adr/0012-data-licence.md) D-3** — a matcher that needs OSM way
  identifiers stores them in their **own** object store, which is then ODbL, never as fields on
  `SegmentRecord`. This is why candidate 2 is a licence decision as well as an engineering one.
- **§6 of `CLAUDE.md`** — every mature prior-art matcher in this space is GPL or AGPL. Reading one
  is fine; copying from one is fatal under `packages/`. Nothing here is derived from one.
