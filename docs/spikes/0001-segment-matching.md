<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Spike 0001: choosing a segment-matching approach

- **Issue**: [#65](https://github.com/openzigs/onyourleft/issues/65)
- **Date**: 2026-09-07
- **Status**: Recommendation. **Not an ADR** — it constrains no future work by
  itself. What binds #66 is [ADR 0007](../adr/0007-patent-posture.md) D-2 and
  [ADR 0012](../adr/0012-data-licence.md) D-3, both of which already existed;
  this measures against them
- **Prototype**: `packages/matching` — throwaway, and #66 hardens or deletes it
- **Blocks**: [#66](https://github.com/openzigs/onyourleft/issues/66), which
  #65 says must not be estimated until this lands

---

> ## ⚠️ 2026-09-08 — the prototype has been retired, and the shipped matcher differs
>
> **[#66](https://github.com/openzigs/onyourleft/issues/66) deleted
> `packages/matching`**, which is the fate this write-up gave it. The matcher
> now lives in `packages/domain/src/segment/` — `match.ts`, `cells.ts`,
> `frechet.ts` — where it is pure computation under that package's platform-free
> program, as #66's ninth criterion requires. Every path named below as
> `src/…` or `tools/…` is gone; nothing else in this document has been changed.
>
> **Two of the numbers below no longer describe the shipped code**, and it
> matters which:
>
> - §1's findings 1 and 2 are **fixed**, not carried forward. The endpoint gate
>   widens by half the ride's own sample spacing, and a span is bounded by the
>   *nearest* sample to each endpoint rather than the first one inside the
>   radius. The tables below are what the unfixed prototype did.
> - §5's miss rate was measured **before** two changes that raise it: both
>   compared paths are resampled to a common 10 m step, and the segment is
>   trimmed to the stretch the ride actually covers. Read it as the floor the
>   recommendation rested on, not as a property of what ships.
>
> §1's third finding — that sample spacing consumes similarity budget — is what
> those two changes address, and `packages/domain/src/segment/frechet.ts`
> states the assumption they buy it with.

---

## The recommendation, in one paragraph

**Take the geometric point-to-polyline pipeline (candidate 1), and change the
endpoint model before implementing it.** The measured fan-out is fine — a
100 000-segment corpus costs the same per ride as a 1 000-segment one, because
the prefilter is bounded by the ride's own footprint rather than by the corpus.
The four hard cases are all handled. But the spike found a **cliff**: at any
recording interval above about 1 s, the current endpoint model detects *nothing
at all*, and the obvious repair breaks a different threshold. #66's first job is
that, not the matching.

Candidate 2 — map-matched edge-ID subsequences — is **better on every hard
case** and is not available: it needs a routing service Phase 1 has no way to
run, and its stored edge ids are an ODbL Derivative Database. Revisit it at
[#7](https://github.com/openzigs/onyourleft/issues/7), not before.

---

## 1. The two findings that were not in the plan

These are the reason the spike was worth doing. Neither is a tuning question.

### Finding 1 — the endpoint gate does not degrade at a coarse recording interval. It stops.

At 30 km/h a **5 s** recording interval puts samples **41.7 m** apart. #64's
endpoint tolerance radius is **15 m**. A rider can therefore pass a segment's
start without ever recording a sample inside the radius — so the gate never
opens, no span is produced, and **stage 3 never runs**.

| interval | sample spacing | endpoint radius | traversals matched, of 100 |
|---|---|---|---|
| 1 s | 8.3 m | 15 m | **100** |
| 2 s | 16.7 m | 15 m | **0** |
| 5 s | 41.7 m | 15 m | **0** |
| 10 s | 83.3 m | 15 m | **0** |

It is silent and total. Every effort by every rider on smart recording is
missed, and nothing in the pipeline reports a reason — the segment simply never
appears. #64's own note that "the recording interval is the worse half" of the
endpoint error understates it: past a threshold the model does not get worse, it
returns nothing.

⚠️ **It was found by accident.** The timing comparison (§4) returned *zero
efforts* at 5 s, which looked like a harness bug. It is not, and printing a
"0.00 s difference" beside it would have read as *the two timings agree* —
the opposite conclusion. `tools/measure.ts` now prints the zero as a result.

### Finding 2 — widening the radius does not fix it, because the two thresholds are coupled

The obvious repair is a bigger endpoint radius. It makes things worse, and the
mechanism is not obvious:

> A span **opens at the first sample inside the start radius**, so it swallows
> up to `radius` metres of approach that is not part of the segment. The Fréchet
> distance of a *noise-free ride down the segment's own road* is therefore
> bounded below by roughly the radius.

Once the radius passes `SIMILARITY_METRES` (25), stage 3 rejects a perfect ride:

| endpoint radius | Fréchet of a **perfect** traversal | matched, of 50 |
|---|---|---|
| 10 m | 0.0 m | 50 |
| 15 m | 0.0 m | 50 |
| 20 m | 0.0 m | 50 |
| 25 m | 20.0 m | 50 |
| 30 m | 20.0 m | 50 |
| 40 m | 20.0 m | 50 |
| **50 m** | **40.0 m** | **0** |

So the two failures are in tension. Widen the radius to survive a coarse trace
and the similarity threshold rejects the result; widen the similarity threshold
to compensate and you are loosening exactly the tolerance #65's third criterion
warns makes the false-positive rate worse.

**#66 must break the tension rather than tune between the two.** The obvious way
is to trim the compared span to the closest approach to each endpoint before
measuring similarity, so the compared curve is the segment's extent rather than
whatever the gate happened to open at — which decouples the radius from the
similarity budget entirely. That is a design change, it is not what this
prototype does, and it is why #66 is not a matter of tidying this code up.

### A third, smaller one: how a segment is *stored* sets a floor on similarity

Two paths down the identical road, one sampled every 5 m and one every 20 m, are
**10 m** apart under Fréchet — half the coarser spacing, because a dense point
halfway between two sparse ones is 10 m from the nearer.

A segment stored at 20 m spacing therefore spends 10 m of the 25 m similarity
budget before any GNSS error is counted. One stored at 50 m spacing would spend
25 m and match nothing. That is a constraint on **#64's storage**, not a matcher
tunable, and it is not currently written down anywhere else.

---

## 2. The four hard cases

#65 asks the recommendation to speak in these terms. Every row is a passing test
in `packages/matching`, not an argument.

| Hard case | Candidate 1 (geometric) | Candidate 2 (edge sequence) |
|---|---|---|
| **Ridden twice in one ride** | ✅ Two efforts. The scan closes a span and keeps looking; a matcher that stopped at the first finish would discard the rider's second and usually faster effort | ✅ Two occurrences of the subsequence |
| **Ridden backwards** | ✅ None. The start gate requires direction agreement, so a descending rider never opens a span — no special case, and it is #64's `endpointReached` reused unchanged | ✅ None, and more strongly: direction is part of an edge step's identity, so there is no tolerance involved at all |
| **A road paralleling a trail** | ✅ None — **and it is rejected at two different stages depending on the geometry.** See below | ✅ None. A cycleway is a *different way* in the graph, so the question does not arise |
| **Crossing a recording gap** | ✅ None. A hole longer than `GAP_SECONDS` abandons the open span rather than bridging it, because the alternative is an elapsed time containing minutes nobody recorded | ✅ None. A gap breaks contiguity |

**The parallel-road case has two shapes and only one was obvious.** A road 30 m
away is rejected at the **endpoint gate** — the rider never gets within 15 m of
the start — and stage 3 never runs. A *detour that shares both endpoints* but
bulges 60 m in the middle passes the gate and is rejected by **similarity**.

⚠️ The first draft of that test asserted the parallel road reached stage 3. It
does not. Believing it did would have left the similarity threshold untested
behind a passing test, which is the shape of an assertion that measures the
wrong stage. Both are now separate cases with the stage counts asserted.

---

## 3. Fan-out and timing

One four-hour ride at 1 Hz (**14 400 samples**), measured 2026-09-07 on Node
v24.20.0, linux/x64, in this repository's container. Reproduce with
`pnpm --filter @onyourleft/matching run spike:measure`.

| corpus | index (ms) | **match (ms)** | after prefilter | after endpoint gate | efforts |
|---|---|---|---|---|---|
| 1 000 | 11.0 | 265 | 105 | 8 | 8 |
| 10 000 | 11.4 | 587 | 226 | 8 | 8 |
| **100 000** | 170.3 | **565** | **224** | 9 | 9 |

**The headline: fan-out is bounded by the ride, not by the corpus.** A corpus a
hundred times larger puts roughly the *same* number of candidates into stage 2,
because the prefilter is limited by how much ground the ride covers. That is
what makes 100 000 segments viable at all, and it is the number a
recommendation without a measurement would have got wrong in either direction.

Indexing is reported separately and deliberately: it is a per-corpus cost paid
when a segment is created, not a per-ride cost paid on every upload. Rolling the
two together would make the per-ride figure look four times worse than it is.

⚠️ **Three caveats on these numbers, none of which flatter the result:**

1. **The corpus is a uniform street grid.** Real riding concentrates on a few
   corridors, so a real corpus is *more* clustered and stage 1 would pass
   through *more* candidates. These are a lower bound on difficulty.
2. **~570 ms is not "fast enough" for anything yet**, because nothing has been
   decided about where matching runs. In a browser after a ride it is fine; per
   ride across a Phase 4 instance it is a capacity question #7 owns.
3. **The rows are not a clean scaling curve.** The generator lays out a wider
   city for a larger corpus, so the three rows differ in layout as well as size.
   What they establish is the *bound*, not a growth rate.

---

## 4. Effort timing: nearest recorded sample

**The recommendation is nearest recorded sample, and it was not a choice.**
[ADR 0007](../adr/0007-patent-posture.md) D-2.2 forbids extrapolating GPS points
to decide a crossing, and an interpolated crossing *time* is that construct with
a clock attached. #65 asks the spike to quantify the difference anyway, so the
interpolated figure was computed **as a control**:

| interval | spacing at 30 km/h | efforts found | mean difference | worst |
|---|---|---|---|---|
| 1 s | 8.3 m | 100 | 0.00 s | 0.00 s |
| 2 s | 16.7 m | **0 — nothing detected** | — | — |
| 5 s | 41.7 m | **0 — nothing detected** | — | — |
| 10 s | 83.3 m | **0 — nothing detected** | — | — |

At 1 Hz the two agree to within the printing precision: a sample every 8.3 m
puts a recorded point close enough to each endpoint that interpolating buys
nothing measurable. **So the constraint costs nothing at 1 Hz** — which is the
useful half of the answer, and it is a stronger result than "we are not allowed
to, sorry".

At every coarser interval the comparison could not be made, because finding 1
means there is no effort to time. #65 anticipated "up to several seconds, which
is larger than most leaderboard margins"; the real answer at 5 s is that the
question does not arise until the endpoint model is fixed, and **once it is
fixed the number must be re-measured** — a wider or trimmed gate will change it.

---

## 5. Miss rate

At `SIMILARITY_METRES` = 25, 200 known-good traversals, 1 Hz:

| per-sample noise | matched | **missed** |
|---|---|---|
| 0 m | 200 / 200 | 0.0% |
| 5 m | 200 / 200 | 0.0% |
| 10 m | 199 / 200 | **0.5%** |
| 20 m | 37 / 200 | **81.5%** |
| 30 m | 0 / 200 | **100%** |

The cliff between 10 m and 20 m is the 25 m threshold doing its job: past it,
the trace no longer resembles the segment by the measure chosen.

⚠️ **Independent per-sample noise is the easy case, and this is a floor rather
than a field rate.** Real GNSS error is strongly autocorrelated — a receiver
under tree cover is wrong in the *same direction* for many consecutive seconds,
which walks the whole trace sideways rather than jittering it around the truth.
A 10 m systematic offset would look like the 20 m row, not the 10 m row. Nothing
here has been tried against a real trace, and #66 should not assume 0.5%.

---

## 6. Why not candidate 2, given it wins on the hard cases

It does win. Direction is free, the parallel-road case cannot arise, and the
whole tolerance-tuning exercise disappears — `edge-sequence.test.ts` measures
that on the same four cases. **Three things stop it, and only the first is
temporary:**

1. **It cannot be built in Phase 1.** It needs a Hidden Markov map matcher over
   an OSM extract — Valhalla's Meili or `cyang-kth/fmm`. Both are native
   services. Phase 1 has **no server at all** (owner decision D6), so a matcher
   requiring a routing service cannot ship in the milestone #66 lands in.
2. **A stored edge-id table is an ODbL Derivative Database.**
   [ADR 0012](../adr/0012-data-licence.md) D-3: it goes in its own object store,
   licensed ODbL, never as fields on `SegmentRecord` — and every self-hoster
   then inherits a share-alike obligation they did not choose. ADR 0012 D-4
   declines that trade for exactly this reason.
3. **Neither engine is installable in this environment**, so its half of the
   comparison is a *stub*: `edge-sequence.ts` assumes a **perfect snapper** and
   measures only what perfect snapping would buy. Everything the real thing does
   is worse. A reader who mistook that for a measurement of candidate 2 would
   conclude it wins outright — it is an upper bound.

**This is a deferral, not a rejection.** If #7 brings a routing service, D-3's
four conditions are the path back.

---

## 7. What the prototype does instead of an oriented virtual start line

#65's sixth criterion, and [ADR 0007](../adr/0007-patent-posture.md) D-2.1:

> An effort begins when a **recorded sample** lies within the segment start's
> tolerance radius **and** that sample's own direction of travel — computed from
> the sample before it — agrees with the start's recorded direction to within an
> angular tolerance. It ends the same way at the finish.

Two scalar comparisons per sample. There is no line; nothing computes a path
through a user-selected point, takes its orientation, and sets a line in
relation to that orientation. There is no extrapolation: the scan sees one
recorded sample at a time and has nowhere to put a synthesised intermediate
point. There is no two-tier loose/tight match — one similarity criterion with
one threshold, and it is a Fréchet distance rather than a pair of line
crossings. Nothing discards a stored overlapping segment.

The endpoint test is `endpointReached` from `@onyourleft/domain`, which is
**#64's production code reused unchanged** rather than reimplemented here — so
the property is tested in one place and cannot drift between the model and the
matcher.

### Prior art, per ADR 0007 D-6

- **Discrete Fréchet distance** — Eiter, T. and Mannila, H., *Computing Discrete
  Fréchet Distance*, Technical Report CD-TR 94/64, Christian Doppler Laboratory
  for Expert Systems, TU Vienna, **1994**. The dynamic program in
  `src/frechet.ts` is that paper's. Seventeen years before the 2011-03-31
  priority of the '922 family.
- **Hidden Markov map matching** — Newson, P. and Krumm, J., *Hidden Markov Map
  Matching Through Noise and Sparseness*, ACM SIGSPATIAL GIS **2009**,
  pp. 336–343. The algorithm behind candidate 2, cited because the
  recommendation weighs it; **it is not implemented here.** Sixteen months
  before the same priority date.

---

## 8. Every threshold, and that each is ours

#65's last criterion. **No numeric tolerance is published by any other product**
— not an endpoint radius, not a gap threshold — so none of these is parity with
anything, and none may be described that way.

| Threshold | Value | Reasoning |
|---|---|---|
| `SIMILARITY_METRES` | 25 m | A road and the cycleway beside it are commonly 15–25 m apart; at 40 m the matcher reports efforts on a segment the rider was never on. Below ~10 m an honest traversal through a built-up section misses |
| `GAP_SECONDS` | 20 s | A device on a 10 s interval produces legitimate 10 s spacing, so the threshold must sit above it. Twice that leaves room for one dropped sample and refuses two |
| `CELL_DEGREES` | 0.01° (~1.1 km) | Smaller makes a 400 m segment's cover several cells wide for no filtering gain; larger puts a city in one cell and the prefilter stops filtering |
| Endpoint radius | 15 m | **#64's, and finding 1 says it is wrong.** Not this spike's to change |
| Bearing tolerance | 60° | #64's. Rejects the rear half-plane with 30° to spare; loose because the bearing is derived from two noisy samples |

---

## 9. The corpus

Synthetic, seeded, generated by `tools/corpus.ts`. **No real person's ride files,
from any platform, were used** — #65's seventh criterion and
[ADR 0004](../adr/0004-privacy-and-location.md). Beyond the privacy rule, a spike
whose numbers came from one person's riding would be measuring their commute.

The generator lays segments on a street grid over a city-sized area, which gives
the two properties the measurement needs: enough density that the prefilter has
real work, and roads running parallel a short distance apart so a false positive
is *available* to be made. It models no junction density, no elevation, and none
of the way real riding concentrates on corridors.

---

## 10. What #66 should do first

1. **Fix the endpoint model** (findings 1 and 2), before any matching work. The
   likely shape is trimming the compared span to the closest approach at each
   end, which decouples the radius from the similarity budget.
2. **Re-measure the timing difference** (§4) once it is fixed. The current
   answer only covers 1 Hz.
3. **Write down the storage-spacing constraint** (§1, third finding) wherever
   #64's segment geometry is described, because it silently consumes similarity
   budget.
4. **Take the dependency deliberately.** This prototype's grid index takes none;
   H3 or S2 is the production choice and arrives with the issue that needs it.
5. **Do not tune the tolerances to improve the miss rate** without re-running the
   false-positive cases. That is the exercise #65 warns makes the failure worse,
   and both cases are already written.
