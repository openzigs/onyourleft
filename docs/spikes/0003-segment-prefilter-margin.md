<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Spike 0003: what padding the segment prefilter costs

- **Issue**: [#291](https://github.com/openzigs/onyourleft/issues/291)
- **Date**: 2026-09-15
- **Status**: Measurement. **Not an ADR and not a decision.** The decision —
  that the corpus side of the prefilter pads its cover by 100 m — is recorded
  where the tunable lives, in
  [`packages/domain/src/segment/cells.ts`](../../packages/domain/src/segment/cells.ts)
  §`PREFILTER_MARGIN_METRES`, the same place `CELL_DEGREES` and
  `SIMILARITY_METRES` are. This is the number that decision rests on
- **Reproduce**: `pnpm --filter @onyourleft/domain run test`, file
  `src/segment/prefilter-fanout.test.ts`
- **Supersedes nothing.** It is the second write-up
  [spike 0001](0001-segment-matching.md) §3 needs, because §3's fan-out was
  measured against an **unpadded** cover and a spike is never edited

---

## Why a second write-up exists at all

[Spike 0001](0001-segment-matching.md) §3 measured how many segments stage 1
passes to stage 2, and reported the result that makes a hundred-thousand-segment
corpus viable: *"fan-out is bounded by the ride, not by the corpus."* That
measurement was taken on a cover that marks only the cells a path's own points
fall in.

[#291](https://github.com/openzigs/onyourleft/issues/291) found that such a
cover is **not conservative at a cell boundary** — two paths a millimetre apart
on opposite sides of a grid line share no cell, so `coversIntersect` rejects a
perfect traversal before stage 2 ever runs. #291's own words for what to check:

> ⚠️ `docs/spikes/0001-segment-matching.md` §3's fan-out measurement rests on
> the current cover. Any padding changes how many candidates reach stage 2, so
> the measurement has to be re-run and the spike gets a second write-up rather
> than an edit — a spike is never edited.

This is that write-up.

---

## 1. What was measured, and what was not

**Measured**: the number of segments whose cover meets a ride's, and the number
of cells a segment's index holds. Both are pure functions of the corpus and the
ride — no clock, no randomness, the same answer on every machine — which is why
they are asserted in `prefilter-fanout.test.ts` rather than produced by a script
nobody runs again. Spike 0001's `pnpm --filter @onyourleft/matching run
spike:measure` went with `packages/matching`.

**Not measured**: milliseconds. Spike 0001 §3's `match (ms)` column has no
counterpart here. A timing measurement does not belong in a test suite, and the
machine this was taken on is not the container that produced §3's numbers, so a
figure from it would invite a comparison that is not available.

⚠️ **The absolute counts below are not comparable with §3's.** The corpus and
ride generators are this file's own. What carries across is the *shape* of the
result and the *ratio* between the two covers, which is what the decision turns
on.

### The generator

- **Corpus** — northbound 500 m segments of 26 points, on streets 200 m apart,
  600 m apart along each street, every one knocked off the lattice by a
  deterministic offset in ±300 m. The city grows with the corpus, so density is
  constant. ⚠️ **The jitter is load-bearing.** On an exact lattice the padding
  adds *no* candidates at all and the measurement reads as free; that is an
  artefact of the arrangement, not a property of the padding, and the first run
  of this measurement hit it.
- **Rides** — two shapes, both 14 400 samples at 1 Hz (four hours, 120 km,
  8.33 m apart). *Hill repeats*: up and down one 12 km road, stepping 200 m east
  each time — about the smallest footprint 120 km can have, 33 cells.
  *Big loop*: a circuit with 30 km sides, 138 cells. A ride's footprint is what
  bounds stage 1, so one shape is one measurement.

---

## 2. The fan-out

Taken 2026-09-15 on Node v24.20.0, darwin/arm64. "Halo" is the alternative #291
proposed: every cell of the cover plus its eight neighbours.

### Hill repeats — 33-cell footprint

| corpus | unpadded | padded (100 m) | halo (1 cell) | cells/segment: unpadded → padded → halo |
|---|---|---|---|---|
| 1 000 | 208 | **229** (+10.1%) | 327 (+57.2%) | 1.46 → 2.10 → 10.37 |
| 10 000 | 208 | **229** (+10.1%) | 327 (+57.2%) | 1.45 → 2.10 → 10.35 |
| 100 000 | 208 | **229** (+10.1%) | 327 (+57.2%) | 1.45 → 2.11 → 10.35 |

### Big loop — 138-cell footprint

| corpus | unpadded | padded (100 m) | halo (1 cell) | cells/segment: unpadded → padded → halo |
|---|---|---|---|---|
| 1 000 | 173 | **201** (+16.2%) | 340 (+96.5%) | 1.46 → 2.10 → 10.37 |
| 10 000 | 653 | **737** (+12.9%) | 1 370 (+109.8%) | 1.45 → 2.10 → 10.35 |
| 100 000 | 1 078 | **1 233** (+14.4%) | 2 404 (+123.0%) | 1.45 → 2.11 → 10.35 |

**Three readings, in order of how much they matter.**

1. **Spike 0001 §3's headline survives the padding.** The hill-repeats rows are
   flat at 229 across a corpus that grows a hundredfold: stage 1 is still
   bounded by how much ground the ride covers, not by how many segments exist.
   That is the property the whole three-stage design rests on, and a padding
   that broke it would have sent the decision the other way.
2. **The margin costs 10–16% of the candidates reaching stage 2.** Not free, and
   the first version of this measurement said it was — see the jitter note.
3. **The halo costs 57–123%, and multiplies a segment's index by seven.** For
   the same correctness. A 500 m segment goes from 1.45 cells to 10.35 rather
   than to 2.11, which is a per-corpus memory cost as well as a per-ride one.

⚠️ **The big-loop rows are not a clean scaling curve, for the reason §3's were
not.** The city grows with the corpus, so a 30 km circuit runs off the edge of
the 1 000-segment city and sees less of it. The three rows differ in layout as
well as in size. What they establish is the bound and the ratio, not a growth
rate.

⚠️ **The corpus is a uniform street grid.** Real riding concentrates on a few
corridors, so a real corpus is more clustered and every column here is a lower
bound on difficulty. That is spike 0001 §3's caveat, unchanged and still
binding.

---

## 3. What this does not establish

- **Nothing about wall-clock time.** See §1. Whether a 1 233-candidate stage 2
  is affordable in a browser after a ride is the question spike 0001 §3 caveat 2
  left open and it is still open.
- **Nothing about a real corpus.** Every number here comes from a generator.
- **Nothing about 89° of latitude.** The margin is a distance applied to a grid
  in degrees, so near a pole the one-cell cap on the longitude margin binds and
  the margin stops being 100 m. `cells.ts` states it; nothing measures it,
  because there is no road there to measure.
- **Nothing about whether 100 m is the right number.** It is derived from the
  tolerances downstream of stage 1 — 25 m of similarity, and an endpoint gate
  that reaches 56 m at the slowest recording interval in common use — and
  `cells.test.ts` asserts that relationship against the constants themselves.
  What this measures is what the choice *costs*, not that it is the only one
  that would have worked.

---

## 4. What would make this write-up wrong

A change to `CELL_DEGREES`, to `PREFILTER_MARGIN_METRES`, or to the generator in
`prefilter-fanout.test.ts`. The first two are what the test's bounds are there to
catch; the third is a change to what was measured, and the honest response to it
is a third write-up rather than an edit to this one.
