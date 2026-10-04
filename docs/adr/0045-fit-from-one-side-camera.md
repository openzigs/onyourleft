# ADR 0045: Fit from one side camera — four rough sagittal angles on one surface, inside the patent design-around and the wellness carve-out

- **Status**: Accepted, on the owner's rulings of 2026-10-03, which are quoted verbatim in Context,
  and **subject to the owner reading this text and approving it before it merges** (#1059's last
  acceptance criterion). Every point the rulings do not settle is marked **the author's choice**
  where it is made, and each takes the narrower option. **Nothing is built by this ADR**, and D-0
  says what has to be true before anything that renders a fit angle may ship
- **Date**: 2026-10-04
- **Deciders**: **the owner**, on whether fit exists at all (ruling 3 of epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055)), on the FDA condition-6 risk, on the
  trunk angle's reference, and on tying a capture to its ride (the three rulings in the comment on
  #1055 and #1059). The author decided the engineering content and drafted the wording
- **Issue**: [#1059](https://github.com/openzigs/onyourleft/issues/1059). Parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055)
- **Number**: **0045**, reserved by epic #1055 on 2026-10-03, which read *"The next free number is
  0044"* from [`docs/architecture.md`](../architecture.md) and reserved **0044** for
  [#1058](https://github.com/openzigs/onyourleft/issues/1058) (a live view and a snapshot) and
  **0045** for this issue. ADR 0044 is **not written** on `main` at this date. This pull request
  adds both rows to the reservation table, as the epic asks of whichever lands first
- **Supersedes**, each **to the extent named in D-1 and no further**:
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-3**, *"No absolute joint angle is ever
    reported as a number"*, for **the four angles D-3 below defines, on the one surface D-7 names**.
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-5**, for its **product boundary
    only**: the program now offers a check it calls a *fit check*. **Both clauses of D-5's rule
    stand unchanged**, the equipment clause and the verdict clause (D-1, D-8).
- **Does NOT supersede**, named so none of it is read as touched: ADR 0030 **D-1**, **D-2** (R1 to
  R10, with R1 relaxed only as D-3 above), **D-4** (nothing frontal-plane), **D-6** (decided
  explicitly in D-9 below: **kept**), **D-7** (the live silence rule) and **D-8**; ADR 0030's
  2026-09-23 amendment and its six conditions; [ADR 0029](0029-camera-imagery-as-a-data-class.md)
  **D-8** and **D-9**; [ADR 0033](0033-side-camera-link.md) **D-3**, including its rule that nothing
  joins pose numbers to a ride reading or a wall-clock time (D-5 and D-12 below keep it);
  [ADR 0035](0035-model-written-ride-write-ups.md) **D-4**'s degree screen, which D-10 keeps whole;
  and [ADR 0007](0007-patent-posture.md)
- **Relates to**: [ADR 0007](0007-patent-posture.md),
  [ADR 0013](0013-adr-amendments.md),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md),
  [ADR 0033](0033-side-camera-link.md),
  [ADR 0035](0035-model-written-ride-write-ups.md),
  [spike 0006](../spikes/0006-camera-bike-fit-patent-read.md),
  [spike 0008](../spikes/0008-eu-uk-medical-device-read.md),
  [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md),
  [#554](https://github.com/openzigs/onyourleft/issues/554),
  [#1057](https://github.com/openzigs/onyourleft/issues/1057),
  [#1058](https://github.com/openzigs/onyourleft/issues/1058),
  [#1060](https://github.com/openzigs/onyourleft/issues/1060),
  [#1064](https://github.com/openzigs/onyourleft/issues/1064) to
  [#1068](https://github.com/openzigs/onyourleft/issues/1068),
  [#1112](https://github.com/openzigs/onyourleft/issues/1112)

> ## ⚠️ This is not legal advice, not a regulatory opinion, and not a freedom-to-operate opinion
>
> [ADR 0007](0007-patent-posture.md), [ADR 0030](0030-what-the-app-may-say-about-a-body.md),
> [ADR 0035](0035-model-written-ride-write-ups.md) and every spike this one rests on say it of
> themselves, and it matters more here. This ADR records that **the owner accepts a risk** the FDA
> guidance and [spike 0008](../spikes/0008-eu-uk-medical-device-read.md) describe, and it builds on
> an engineer's reading of one patent family in [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md),
> whose verdict is **unsigned by any lawyer**. §"Questions for counsel" names what a lawyer would
> be paid to answer. **Anyone citing this document as clearance is misusing it.**

---

## Context

### The owner's rulings, quoted rather than paraphrased

Epic [#1055](https://github.com/openzigs/onyourleft/issues/1055), §"The owner's rulings of
2026-10-03", ruling 3, as the epic's table records it:

> | 3 | **Add FIT now** | ADR 0030 **D-3** (no absolute joint angle) and **D-5** (no fit verdict),
> to the extent needed, within the patent limits below |

The owner's comment on #1055 and on #1059, posted **2026-10-03**, verbatim:

> **Owner rulings, 2026-10-03.** These are in addition to the four rulings in the epic body.
>
> 1. **FDA general-wellness condition 6 (#1059):** accept the risk, framed. Show absolute sagittal
>    fit angles, each marked as a rough estimate from one camera and not a professional fit, on the
>    ADR 0035 precedent. ADR 0045 records the acceptance and lists the questions for counsel.
> 2. **Trunk angle (#1059, #1064):** the phone sends its own tilt from its motion sensor with the
>    frames, and the tablet corrects for it. This adds a phone-side change. File it with the
>    capture work once spike 0021 settles the transport.
> 3. **Snapshot and ride (#1058, #1063):** a snapshot is tied to the ride it was taken in. It shows
>    on that ride's page and is deleted with the ride and by the account erase. ADR 0044 records
>    this as a departure from ADR 0033 D-3's no-join rule for snapshots only.

These are decided and are not argued again below. Ruling 3 is about a **snapshot**, which ADR 0044
owns. This ADR applies the same tie to a **fit check** (D-12). ⚠️ **That application is the
author's reading of the ruling**, made because a fit check and a snapshot are taken in the same
session on the same path, and it is one of the points the owner confirms before this merges.

The review of spike 0020 ([PR #1073](https://github.com/openzigs/onyourleft/pull/1073)), recorded in
a comment on #1059 on 2026-10-03, asks this ADR to carry four things. Each is carried:

| Asked | Where |
|---|---|
| FDA condition 5 quoted in full, with the word *clinical* | D-11 |
| Rule P4 checks the **import closure**, not the fit module's own source | D-2, P4 |
| Rule P3 has a clause for the trunk angle, which has only one landmark ray | D-2, P3 |
| If a verdict is adopted, it is unsigned | D-8: **no verdict is adopted**, signed or unsigned |

### What spike 0020 found, in four lines

[Spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md) re-read US 12,499,571's
independent claims 1, 10 and 17 on 2026-10-03 against the fit design #1055 proposes:

- **The fit design is still outside on (d), (e), (f) and (g)**, and in the US on (h). What the
  ruling cost is **margin**: D-5's verdict clause was one of the reasons for (g), and the standing
  half of D-5 (no size, component or direction) is what holds it now.
- ⚠️ **The pending Canadian family member CA 3,183,442 A1 has no Markush group (h) in its claim
  1.** Spike 0006 did not record it. In Canada (d) must hold by itself.
- **Element (c) is uncertain.** An angle taken from two directions needs no length, which is the
  strongest literal argument. But **scale-free is not length-free**: a ratio of lengths survives
  multiplying every coordinate by k, so a second rule is needed. And shipped code
  (`pose-plausibility.ts` §`implausibility`, `side-report.ts` §`saddleOf` and §`jointAngle`)
  already computes segment lengths and their proportions.
- **Eight checkable rules, P1 to P8**, which D-2 below adopts.

### The regulatory documents, re-read for this ADR

ADR 0030's Context quotes the FDA's *General Wellness: Policy for Low Risk Devices* of January 6,
2026, read first-hand on 2026-09-22, and its 2026-09-23 amendment put this product **inside** the
non-invasive-sensing carve-out, which holds only while all six conditions hold. This ADR did not
fetch the guidance again. It relies on ADR 0030's verbatim quotation and records that it did so.
Condition 6 is the one fit breaks on its face:

> *"do not include values that mimic those used clinically unless validated (e.g. manufacturer
> testing, peer-reviewed clinical literature) to reflect those values."*

[Spike 0008](../spikes/0008-eu-uk-medical-device-read.md) was re-read for this ADR, §4.3 and §7
in particular. What it says that bears on fit:

- **§4.1**: MDCG 2019-11 Rev.1 names *"wellness or fitness apps"* as not qualifying as medical
  device software. The fitness claim of #495 Q1 is what keeps the product inside that exclusion.
- **§4.3**: *"In the EU, the distance between this product and a class IIa medical device is
  carried by ADR 0030 R5, and by very little else."* The worked class IIa example is software
  *"intended to prevent the risk of illnesses or pathologies by analysing physiological parameters
  (e.g. placement of the dorsal vertebrae …)"*. A trunk angle is posture measured from anatomy.
- **§7**: D-3 gained **no** third reason from the EU or UK read. D-5 gained one: the
  musculoskeletal example turns on *recommending* something to do. And on D-6: *"Placing a rider
  against a published range is the closest this product could come to 'potential detection of
  pathologies' without naming one."*
- **§9, Question A** was asked about *"a differences-only sagittal measurement … where no absolute
  value is rendered"*. Fit removes the second half of that description. D-11 restates the
  question.

### The measured picture rate, and why it decides whether fit can exist yet

[ADR 0033](0033-side-camera-link.md) D-3 designed the side camera to send **about 5 pictures a
second**. [#1112](https://github.com/openzigs/onyourleft/issues/1112) measured it on the owner's
Pixel Tablet and phone on 2026-10-04, during #554, on `main` at `a9c7f3ff`: **197 pictures in a
10-minute filming session, about 0.3 a second**, with none skipped as busy on the tablet, and 23 in
a second 30-second session. The shortfall is on the phone or the link, and #1112 owns finding it.

The pose model cannot see the crank, so bottom dead centre (BDC) has to be found from the body, and
a knee angle "at BDC" is only that if a picture was taken near BDC. The arithmetic, at a cadence of
*c* revolutions a second and *r* pictures a second:

| | |
|---|---|
| Crank degrees between two pictures | 360 · *c* / *r* |
| A picture within ±10° of BDC on **every** revolution | needs 360 · *c* / *r* ≤ 20°, so *r* ≥ 18 · *c*: **18 a second at 60 rpm, 27 at 90 rpm, 31.5 at 105 rpm** |
| With a rate that **sweeps** the stroke instead (incommensurate with the cadence) | about 1 picture in 18 lands within ±10° of BDC, so 10 such pictures need about **180 pictures**: about **36 s at 5 a second**, and about **10 minutes at 0.3 a second** of perfectly steady pedalling |
| A rate that is **commensurate** with the cadence | the same few phases for ever. At 5 a second and 75 rpm, exactly 4 phases (#1064's control case). At **0.3 a second and 90 rpm, exactly one**: 1.5 / 0.3 = 5 whole revolutions between pictures |

So at the rate measured today **a fit check is not possible**, and at the designed rate it is
possible only by sweeping. D-0 makes a measured, sufficient rate a precondition.

---

## Decision

Thirteen decisions. **D-0** is what must hold before anything ships. **D-1** draws the boundary of
the reversal. **D-2** is the patent design-around as checkable rules. **D-3** to **D-6** are the
measurements, the trunk's reference, the capture and the confidence. **D-7** is the closed list of
surfaces and how the gate is narrowed. **D-8** and **D-9** are the wording and the literature
ranges. **D-10** is the model write-up. **D-11** is the regulatory position. **D-12** is storage.

The issue's eight items map to: item 1 → D-2; item 2 → D-3, D-4; item 3 → D-0, D-5; item 4 → D-7;
item 5 → D-10; item 6 → D-11; item 7 → D-12; item 8 → §"What would make this ADR wrong".

### D-0 — Preconditions: fit is not offered until a sufficient picture rate is measured

> **The rule.** No control that starts a fit check, and no surface that shows a fit angle, ships to
> a rider until **all** of these hold:
>
> 1. **The rate is measured, not assumed.** On the owner's Pixel Tablet and side-camera phone, in
>    the APK, the pictures actually delivered during a fit-check capture are counted over **at
>    least 2 minutes** with the phone's filming sign showing, and the rate and the spread of the
>    intervals between pictures are recorded with the devices, the build and the date, in a spike
>    or in a validation procedure's result table. Today's figure is #1112's 0.3 a second.
> 2. **The rate is sufficient, shown on fixtures.** #1064's synthetic pedalling fixtures,
>    **resampled at the measured delivery times** (not at an ideal uniform rate), prove BDC
>    sampled within D-5's tolerance on D-5's number of revolutions, within **60 s** of steady
>    pedalling, at each of 60, 75, 90 and 105 rpm. 0.3 a second fails this by the arithmetic in
>    Context.
> 3. **The capture refuses at run time too.** Each fit check counts what it receives, and a check
>    that does not reach D-5's evidence in its time says so in words and shows no knee number (D-5,
>    D-6). Item 1 is about the owner's devices; this is about the rider's.
> 4. **ADR 0044 has landed** ([#1058](https://github.com/openzigs/onyourleft/issues/1058)), because
>    the capture's transport and any picture buffer are its decisions, and the privacy policy and
>    Play Data Safety wording ([#1060](https://github.com/openzigs/onyourleft/issues/1060)) are
>    approved by the owner, under [ADR 0033](0033-side-camera-link.md) D-10's rule that the
>    published statements are true at every merge.

⚠️ **Item 2's 60 s is the author's choice**: a fit check a rider has to hold steady for longer
than a minute is one most riders will not finish, and a longer window lets cadence drift spoil the
sweep. It is written down so that changing it is a decision.

Code that cannot reach a rider (the pure computation, the store record, fixtures) may land before
the preconditions hold. The rule is about what a rider can start and see.

### D-1 — What is superseded, and what stands

| Rule | Status under this ADR |
|---|---|
| ADR 0030 **D-3**, no absolute joint angle | **Superseded** for exactly the four angles D-3 defines, rendered only on the surface D-7 names, each with D-8's caveat in the same sentence. Everywhere else D-3 stands, including for a limb angle, a segment length and a body dimension, which this ADR never permits anywhere |
| ADR 0030 **D-3**'s second reason, condition 6 | **Accepted as a risk by the owner** (D-11). It is not argued away |
| ADR 0030 **R1**, a quantity only as a change | **Relaxed only as D-3 is**: the four fit angles may be standing values on D-7's surface. Everything else this app says about a body is still a difference |
| ADR 0030 **D-5**, no sizing, no equipment, no fit verdict | **Superseded for its product boundary only**: the program offers a *fit check*. **The equipment clause stands** (patent element g, and spike 0008 §7's EU reason). **The verdict clause stands**: no fit check output characterises a position or fit as correct, optimal, good or bad, and no verdict, **signed or unsigned**, is adopted (D-8) |
| ADR 0030 **D-4**, nothing frontal-plane | **Stands, unchanged**, as a number, a word, or a line drawn on a picture. The fit check is sagittal and near-side only |
| ADR 0030 **R4 to R9** | **Stand.** R4: no component, size or direction. R5: no condition or injury, in any tense. R6: no clinical, professional or *"accurate to"* framing (D-8 records the one fixed negative phrase the owner's ruling uses). R7: no prompt or alert. R8: **load-bearing**, every fit number carries its uncertainty in the same sentence. R9: no score or ranking |
| ADR 0030 **R10** and **D-6**, literature ranges | **Kept**, decided explicitly in D-9 |
| ADR 0030 **D-7**, live silence | **Stands.** No fit angle is shown, spoken or sent while a ride is recording or paused (D-7) |
| ADR 0030 **D-8**, what a machine checks | **Stands**, and its first bullet is **narrowed, not deleted** (D-7) |
| ADR 0035 **D-4**, the degree screen on model text | **Stands whole** (D-10), and gains one screen for write-ups that carry fit |
| ADR 0033 **D-3**, the join rule | **Stands** (D-5, D-12) |

⚠️ **The epic allowed more than this ADR takes.** Ruling 3 supersedes D-3 and D-5 *"to the extent
needed"*. The author reads "needed" as what fit requires to exist, and a verdict or a range
comparison is not required for a rider to read four angles. Adopting either later is a superseding
ADR, and spike 0020 §6 Question D or A′.2 is what to buy first.

### D-2 — The patent design-around, as checkable rules (spike 0020 §4)

"Fit path" means everything from a pose to a stored or rendered fit number: the fit computation,
the fit check record, the fit section of a model's input, the wording module, the section that
renders it, and the write-up screen. Each rule names the claim element it holds (spike 0020 §2)
and the check that holds it.

| Rule | Statement, checkable | Check |
|---|---|---|
| **P1** (d, f, h) | **Multiplying every image-plane landmark coordinate by any k > 0, and adding any offset, leaves every reported fit number unchanged.** The only scale applied is the picture's own aspect ratio, which turns normalised coordinates into square pixels. **And** rotating every landmark about any point together with the gravity reference (D-4) leaves every number unchanged | A property test over k ∈ {0.25, 1, 4, 17}, random offsets and random rotations ([#1065](https://github.com/openzigs/onyourleft/issues/1065)). Mutation: divide by the frame height, or by any segment length |
| **P2** (d, f, h) | **No input to the fit path carries a physical unit of length.** The computation's input is poses and the gravity reference only. Rider height, mass and the athlete row are not inputs, nothing in the fit path's import closure is under `apps/web/src/athlete/`, and MediaPipe's `worldLandmarks`, which its declaration says are *"in meters"*, are never read anywhere in `apps/web/src` | A test asserts the input type's keys. A source scan finds no `worldLandmarks` under `apps/web/src`. The import-closure walk below finds nothing under `src/athlete/` |
| **P3** (c) | **Each interior angle (knee, hip, elbow) is unchanged when either end landmark is moved along its ray from the joint, by independent factors.** **The trunk angle is unchanged when the shoulder is moved along the hip-to-shoulder ray, by any factor**, because it has one landmark ray and one reference direction, and the gravity reference is a unit direction with no position. The numbers depend on directions only, never on a length or a ratio of lengths | A property test that slides the end landmarks of each angle along their rays by different factors, and the shoulder along the trunk ray. Mutation: report a ratio of lengths, or weight by a length. P1 cannot catch either, and P3 does |
| **P4** (c) | **No segment length is computed in the fit path, even as an intermediate.** Angles are taken with `Math.atan2(cross, dot)`, never `Math.acos` over a product of norms. **The rule reaches the whole import closure of the fit computation**, not only its own file: a fit module that imported `side-report.ts` §`jointAngle` or `pose-plausibility.ts` would pass a scan of its own source and still compute lengths | A transitive import walk from the fit computation's entry module(s) with `apps/web/src/camera/import-walk-testing.ts`, which fails on `Math.hypot`, `Math.sqrt` or `Math.acos` in any production module it reaches, and on reaching `side-report.ts` or `pose-plausibility.ts` at all. Mutation: import `jointAngle` into the fit module |
| **P5** (e) | **Every angle is reported at a named crank event (D-3), never as a minimum, a maximum or a range over the stroke**, and no output names a flexibility, mobility or range-of-motion category | The output type has one value per angle at a named event, and a test asserts its keys. The wording falls under R5, R6 and D-8 |
| **P6** (g, claim 17) | **No data about equipment exists in the fit path.** No frame size, stack, reach, saddle height, setback, stem, crank length, component or catalogue, as a table, a type field or a model input | A test asserts the keys of every fit type and of the model's fit section. A source scan of the fit modules for those words |
| **P7** (g) | **No fit output names a component, a size, or a direction to move either.** No verdict is adopted (D-8), so the question of signing one does not arise | A closed list of every fit sentence, in one wording module (D-7), with a test over the list for D-8's component, size, direction and verdict words |
| **P8** (g) | **A model's write-up whose input carried a fit section, and which names a component, a size, or a direction to move one, is withheld whole** by the write-up screen, whatever the prompt said | `write-up-screen.test.ts` cases built with `model-answers-testing.ts` ([#1067](https://github.com/openzigs/onyourleft/issues/1067)). Mutation: redact instead of withhold |

**P1 and P3 together** are the claim that matters: the numbers depend on segment directions alone.
One without the other is a vacuous pass.

**Where the fit computation lives is #1065's licence question**, under `CLAUDE.md` §3: a pure,
platform-free computation could go in `packages/domain` (Apache-2.0). These rules bind it wherever
it lands, and P4's walk starts from wherever it is.

⚠️ **The shipped code that already computes lengths (spike 0020 §3.2) is not reworked by this
ADR. The author's choice.** `pose-plausibility.ts`'s proportion check is a real defence against a
fabricated pose ([#761](https://github.com/openzigs/onyourleft/issues/761)), and none of the three
functions is in the fit path or reachable from it (P4 makes that a test). What this leaves is that
the **app as a whole** does (c) on a literal reading, whatever the fit path does. The angle-only
argument covers the fit pipeline, not the product, and Question A′.1 below asks a lawyer what that
is worth.

### D-3 — The four measurements

**Landmarks** are MediaPipe Pose Landmarker's image-plane `landmarks`, the 33-point model the tablet
already runs in its worker. **Near side only**: the side whose hip, knee, ankle, shoulder, elbow
and wrist have the higher mean visibility over the capture is chosen **once per fit check**, and
the far side is never read. If neither side's six landmarks are visible on the share D-6 requires,
no angle is measured. **Sagittal only**, by D-4 of ADR 0030.

**The two crank events are found from the body**, because the crank is not a landmark:

- **BDC** is, in each revolution, the phase at which the near-side **ankle is lowest along the
  gravity direction** (D-4). Lowest is an ordering of one coordinate projected on a unit direction:
  no length is formed.
- **TDC** is, in each revolution, the phase at which the near-side **ankle is highest** along the
  gravity direction.

Both are defined by the ankle so that **no reported joint is reported at its own extreme** (P5).
How each phase is estimated, and the tolerance it must meet, is D-5 and #1064's.

| Angle | Landmarks (near side) | Event | Definition |
|---|---|---|---|
| **Knee at BDC** | hip, knee, ankle | BDC | The interior angle at the knee between the knee→hip and knee→ankle directions. A straight leg is 180° |
| **Hip** | shoulder, hip, knee | **TDC** | The interior angle at the hip between the hip→shoulder and hip→knee directions. At TDC, because that is where fitters usually quote it (the most closed point of the stroke), and **at the event, never as the minimum over the stroke** (spike 0020 §2.2) |
| **Elbow** | shoulder, elbow, wrist | BDC | The interior angle at the elbow between the elbow→shoulder and elbow→wrist directions |
| **Trunk** | hip, shoulder, and the gravity reference | BDC | The angle between the hip→shoulder direction and **horizontal**, horizontal being perpendicular to the phone's reported gravity direction in the picture (D-4). 0° is a flat back, 90° is upright |

**Each value** is the median of the per-revolution values at that event, over the revolutions D-5
accepts. **Each rendered value is rounded to the nearest 5°** and introduced with *"about"*.
⚠️ **The rounding is the author's choice**: published markerless error for this measurement is 6
to 10 degrees (R8), and a value given to the degree would be the spurious precision R8 names as its
own violation. The stored value keeps the median unrounded (D-12).

Every angle is computed with `atan2(cross, dot)` (P4) and is invariant to scale, offset and, for the
three interior angles, rotation (P1).

### D-4 — The trunk's reference: the phone sends its own tilt

**The owner's ruling 2 decides it**: the side-camera phone reads the direction of gravity from its
own motion sensor and sends it with the pictures, and the tablet measures the trunk against the
horizontal that direction gives.

- **What crosses the link**: one unit direction, the gravity vector **projected into the picture's
  own axes**, keyed by the picture's sequence number, and nothing else. No raw sensor stream, no
  orientation beyond that direction, no time of day, no position.
- **It is a direction, not a scale.** It carries no length and no unit of length, so it is not a
  calibration factor under (d) or (h), and P2 holds.
- **Only the trunk and the two event definitions use it.** The three interior angles are rotation
  invariant and do not need it.
- **A phone that is not still is not a level.** If the reported direction varies by more than **2°**
  over the capture, or is missing for more than a fifth of the pictures used, **the trunk is not
  measured**, and BDC and TDC are found along the picture's own vertical instead, which the fit check
  records (D-12). ⚠️ **2° and a fifth are the author's engineering choices**, and not
  measurements.
- ⚠️ **This adds a message to [ADR 0033](0033-side-camera-link.md) D-3's phone-to-tablet list,
  which says *"and nothing else"*.** The wire format, and the entry in that list, belong with the
  transport, which [ADR 0044](https://github.com/openzigs/onyourleft/issues/1058) (#1058) records
  from spike 0021 ([#1057](https://github.com/openzigs/onyourleft/issues/1057)), as the owner's
  ruling says: *"File it with the capture work once spike 0021 settles the transport."* **This ADR
  decides that the trunk is measured against it, and that until that message exists the trunk is
  "not measured"**. It does not itself widen ADR 0033 D-3.
- Whether the privacy policy names the tilt is #1060's question. It is device orientation, not data
  about the rider.

### D-5 — Capture: BDC must be proven sampled, and nothing joins a ride reading

> **The rule.** No knee-at-BDC number exists unless BDC was **proven sampled**: on at least
> **N = 10** revolutions, the estimated BDC phase is within **±10° of crank** of a picture the
> pose model answered for, and every revolution used passes the steadiness tests below. The same
> rule binds TDC for the hip, and BDC for the elbow and the trunk.

- **Why ±10° of crank**: near BDC the knee angle changes slowly, because BDC is close to the knee's
  turning point. With a knee swinging about 35° either side of its mean over the stroke, a 10°
  phase error moves it by about 35 · (1 − cos 10°) ≈ 0.5°, an order of magnitude under the model's
  own 6 to 10 degrees. ⚠️ **±10° and N = 10 are the author's engineering choices**, written down so
  that changing one is a decision, the way ADR 0030 D-7 wrote down S2 and S3.
- **Steady pedalling, judged from the pose stream.** Revolutions are found from the ankle's
  periodic motion. A revolution is not used if its period differs from the median by more than
  10 %, if the rider coasts (no revolution completes in 3 s), or if the near-side knee or ankle is
  missing on most of its pictures. Each of these has words, never a number (D-6, #1064).
- **Cadence comes from the pose stream, never from a sensor.** [ADR 0033](0033-side-camera-link.md)
  D-3 forbids joining pose numbers to a ride reading, and this ADR **does not** change that by name
  or otherwise. The fit capture imports nothing from `apps/web/src/ride/` or the recording engine,
  and #1064 asserts it.
- **The capture design** (a burst, a video track for the check only, or a sweeping rate) is spike
  0021's and ADR 0044's. Whatever it is, the rate it achieves is D-0's precondition, and **a
  commensurate rate that always lands on the same phases is refused, not reported** (#1064's control
  case).
- **The model stays in the worker**, as #1055 records from spike 0010.
- **Nothing is said about the body while the capture runs.** The fit check runs during a recorded
  ride (D-12), and while it does the rider sees only capture-state words about the camera
  (*"Keep pedalling steadily"*, *"Fit check done. The result is on this ride's page once you
  finish."*), never an angle or an observation. Those are instructions about a measurement, in the
  sense *"hold still"* is for a photograph, and they name nothing about the body, so ADR 0030 D-7
  and R7 are untouched.

### D-6 — Confidence: a number or a reason, never a score

Each angle is **either** shown as a number with D-8's caveat **or** replaced by *"not enough to say"*
and the reason in words. There is no third state and no confidence figure: a percentage of
confidence beside an angle reads as a score, which R9 refuses.

An angle is shown only when **all** of these hold:

| | Condition |
|---|---|
| 1 | D-5's evidence: at least 10 accepted revolutions with the event sampled within ±10° |
| 2 | Its three landmarks (two, and the gravity reference, for the trunk) have visibility of at least 0.5 on at least 80 % of the pictures used |
| 3 | The interquartile range of its per-revolution values is at most 10° |
| 4 | For the trunk, D-4's stillness test passed |

The reason given is the **first** condition that failed, from a closed list in the wording module:
for example *"not enough to say: the knee was hidden on most pictures"*. ⚠️ **The thresholds are
the author's engineering choices**, and #1064 and #1065 may tighten them by measurement. Loosening
one is a decision for this ADR's successor.

### D-7 — Where an angle may render: a closed list, and the gate narrowed, not deleted

> **The rule.** A fit angle is rendered as a number in **one** place: the **Fit check** section of a
> saved ride's page. Every other surface stays under ADR 0030 D-3 exactly as it was.

| Surface | May show a fit angle? |
|---|---|
| **The Fit check section of a ride's page**, `apps/web/src/detail/FitCheckSection.tsx`, rendered by `views/ActivityDetailView.tsx` on route `activity-detail` (`#/activities/:activity`) and the same page in the Activities list–detail pane (`#/activities/selected/:id`), for a ride that has a fit check | **Yes**, and only in sentences from the wording module below |
| **The account export** (#35), as numeric data in the fit check's manifest entry (D-12) | **Yes, as data**: numbers in named fields, no sentence. It is the rider's own copy, not a screen |
| The HUD, the game, the Ride screen, the live view (ADR 0044), the Camera and side-camera screens, Home, the library and every list row, Analysis, the side-camera report section, an announcement, a sound, a notification, a share preview, and any single-ride file export (FIT, GPX, TCX) | **No** |
| A model's write-up (ADR 0035) | **No**: D-10 |

⚠️ **The author's choice**: one section on the ride's page rather than a route of its own. A fit
check belongs to the ride it was taken in (D-12), the ride's page is where its snapshot already
shows by the owner's ruling 3, and one surface is the smallest list that satisfies the ruling.
[#1066](https://github.com/openzigs/onyourleft/issues/1066) builds this section rather than a new
route.

**How `no-absolute-angles` is narrowed.** [#1066](https://github.com/openzigs/onyourleft/issues/1066)
does it, in `apps/web/src/camera/no-absolute-angles.ts` and its test:

1. **Every sentence that carries a fit angle lives in one module**,
   `apps/web/src/camera/fit-report-wording.ts`, in the shape `side-report-wording.ts` has. The
   section renders strings from it and holds no degree literal of its own.
2. **A new list, `ANGLE_SURFACES`, names that one file by exact path**, with its reason, beside the
   existing `EXEMPT` list. In that file, and only there, the three **degree** rules (a degree sign,
   the word, a `'degree'` formatter) are lifted.
3. **The frontal-plane rule is not narrowed anywhere**, that file included.
4. **Matching is by path equality**, never by directory or prefix. An entry naming a file that does
   not exist, or one that excuses no finding, fails the gate, as `EXEMPT`'s entries do.
5. **The surface is closed by the import graph as well as by text.** A test (in
   `apps/web/src/camera/no-absolute-angles.test.ts` or a sibling) asserts that
   `fit-report-wording.ts` is imported by `detail/FitCheckSection.tsx` and by tests only, and that
   `FitCheckSection.tsx` is imported by `views/ActivityDetailView.tsx` and by tests only. Without
   it, any screen could import the wording module and render an angle with the text gate green.

The tests that prove it, each with its mutation, are #1066's: a degree sign outside the list fails;
in the listed file it passes; *"valgus"* in the listed file fails; a stale entry fails; matching by
directory lets a sibling's degree sign through and turns a test red.

**Never while riding.** A ride's page exists only for a saved ride, so nothing on that surface can
show while a ride is recording or paused. ADR 0030 D-7 and R7 hold by construction, and nothing on
the fit path fires a notification or an announcement.

### D-8 — Wording: R8's caveat in every sentence, the R6 phrase, and no verdict

**Every sentence that carries a fit angle has the caveat in the same sentence (R8).** The form is
drafted here, and the owner approves it with this ADR. ⚠️ **Drafted, not yet approved**:

> *"Knee at the bottom of the stroke: about 145°, a rough estimate from one camera and not a
> professional bike fit; studies of camera measurements like this one found them off by about 6 to
> 10 degrees (Kakavand et al., 2025)."*

Each of the four angles has a sentence of that shape. The citation is named inline, in the same
sentence; the 2026 scoping review ADR 0030 D-3 cites may be named beside it. #1066's test asserts
the caveat is in each angle's sentence.

**The R6 rules for fit sentences.**

- **The one permitted mention of a profession is the owner's fixed negative phrase**, *"not a
  professional bike fit"*, inside the caveat. R6 still refuses *"professional"* everywhere else,
  and any claim of likeness to a professional fit.
- **Refused anywhere in the fit path's text**: *"clinical"*, *"medical"*, *"validated"*,
  *"accurate"*, *"accuracy"*, *"precise"*, *"precision"*, *"grade"*, and *"accurate to"* in any
  form. The error figure is phrased as *"off by about"*, never as accuracy.

**P7's word list, for every angle sentence in the wording module**, as the minimum #1066's test
holds (it may add, never remove):

| Kind | Words |
|---|---|
| Components and sizes (R4, P6, P7) | saddle, seat, seatpost, stem, handlebar, bars, crank, cleat, frame, size, reach, stack, setback, spacer, shim, mm, millimetre, cm, centimetre, inch |
| Directions (R4, P7) | raise, lower, higher, move, adjust, forward, backward, up, down, above, below, too, high, low, extend, shorten, lengthen, open up, close down |
| Verdicts (D-5, R3, R9) | good, bad, correct, incorrect, wrong, optimal, ideal, normal, abnormal, should, recommend, within, outside, score, better, worse |
| Bodies (R5) | pain, injury, injure, strain, risk, prevent, healthy, unhealthy |

**No verdict, signed or unsigned.** Spike 0020 §2.1's Option V (*"within the range fitters often
use"*) is **not adopted**. An unsigned verdict leaks less direction than a range comparison, but it
is still a pass or a fail, it moves element (g) toward selection, and D-5's verdict clause stands
(D-1). ADR 0030 R3's description-not-judgement rule binds every fit sentence.

### D-9 — Literature ranges: ADR 0030 D-6 is kept, explicitly

> **The decision.** D-6 stands. A published range may appear on the Fit check section **only as
> prose with its citation in the same sentence**, and **never in, against or beside the rider's own
> number**. Spike 0020's Option R is **not adopted**.

**Why keep it**, answering D-6 and spike 0008 in their own terms:

- D-6's reason was that *"a range the rider is placed against is not a citation, it is a target"*.
  Fit makes that **more** true, not less: the rider's number now exists on the same screen, and a
  target beside it is a pass or a fail without the word.
- Spike 0008 §7: placing a rider against a published range is *"the closest this product could come
  to 'potential detection of pathologies' without naming one"*, which is MDCG 2019-11's own gloss
  on Rule 11a. In the EU, that is the margin to a class IIa example.
- Spike 0020 §2.1: a number placed against a range **leaks a direction** (*a knee above the range
  tells the rider which way the saddle would go*), with no sentence saying so. That is R4's refusal
  arrived at through layout.

**What "beside" means here**, so it can be checked. ⚠️ **The author's reading of D-6**, confirmed
by the owner with this ADR: a range sentence is *beside* a rider's number if it is in the same
sentence, list item, table row, card or chart. A range sentence in **its own sub-section, after
all four readings, headed as what published sources say**, is not. Every range sentence:

- contains no rider value, no *"you"* or *"your"*, and none of D-8's direction or verdict words;
- names its source in the same sentence;
- is followed, in the same sub-section, by the sentence ADR 0030 D-6's example already used:
  *"This app does not compare your numbers with these ranges."*

**Which ranges** are a closed list in the wording module, each read first-hand from its source by
#1066 with the date it was read. **This ADR names none as decided.** ⚠️ ADR 0030 D-6's example,
*"around 140–145° at the bottom of the stroke (Holmes et al., 1994)"*, is an illustration and must
not be copied without reading the source: the author's recollection, **not verified here**, is that
Holmes et al. is usually cited for 25 to 35 degrees of knee **flexion**, which as the interior angle
D-3 defines is 145 to 155 degrees.

### D-10 — The model write-up (ADR 0035): it may read fit, and it may not restate an angle

- **What a model is sent**: the fit check of **the ride the write-up is about**, and only that one,
  as angles (rounded as D-3 renders them), the reason for each one not measured, and the revolution
  count. No length, coordinate, picture, id or time (#1067, and P6 for the section's keys). No fit
  section, never zeros, when the ride has no fit check.
- **The write-up screen's degree matchers are NOT narrowed.** [ADR 0035](0035-model-written-ride-write-ups.md)
  D-4 withholds a write-up containing a degree sign, *"deg"* after a number, or the word *"degree"*,
  and it still does. A model's write-up is **not** an angle surface (D-7). A model may write about
  the rider's fit in words. The angles themselves are on the section above it, from this program's
  own wording, with R8's caveat. ⚠️ **The author's choice**, and the narrower one. A model's
  restated angle would carry whatever caveat the model chose, or none, and R8 cannot be screened
  on free text.
- **P8 is added**: a write-up **whose input carried a fit section** is also withheld whole if it
  names a component, a size, or a direction to move one, using D-8's component, size and direction
  words. This **tightens** ADR 0035 D-1, which left D-5 unscreened on model output, and only for
  write-ups that carry fit, because that is where a general model is likeliest to say *"raise your
  saddle 5 mm"* (spike 0020 §2.1). The one-rewrite-then-withhold rule of ADR 0035 D-4 applies.
- ⚠️ **The known gap, stated rather than hidden**: ADR 0035 D-1 already records that a bare number
  such as *"your knee reached 145 at the bottom"* passes the screen. With fit in the input, that gap
  is wider. The new template version (#1067) asks the model not to restate the angles, and that is
  a request, not a guarantee.

### D-11 — The regulatory position: condition 6 is an accepted risk, framed

**The FDA's six conditions, walked again for fit.** Quoted from the January 6, 2026 guidance as
ADR 0030 quotes it.

| # | Condition | Under fit |
|---|---|---|
| 1 | *"are non-invasive and not-implanted"* | **Holds by construction.** A camera on a tripod, and a phone's own motion sensor on the tripod |
| 2 | *"do not involve an intervention or technology that may pose a risk to the safety of users or other persons if specific regulatory controls are not applied"* | **Holds.** Nothing on the fit path reaches a trainer control point, the HUD, the announcer or a ride-time screen. Nothing is shown during a ride (D-7) |
| 3 | *"are not intended for the diagnosis, cure, mitigation, prevention, or treatment of a disease or condition"* | **Holds while R5 holds**, and D-8's body words make it a test on the fit sentences |
| 4 | *"are not intended to substitute for an FDA-authorized, cleared, or approved device"* | **Holds while R6 holds**: the caveat says in words that it is *"not a professional bike fit"* |
| 5 | *"do not include claims, functionality, or outputs that prompt or guide specific clinical action or medical management"* | **Holds while R7 and D-5's equipment clause hold.** Read only after the rider opens the ride's page; no alert; no verdict, no range comparison and no direction (D-8, D-9), which is what stops a number becoming guidance |
| 6 | *"do not include values that mimic those used clinically unless validated (e.g. manufacturer testing, peer-reviewed clinical literature) to reflect those values"* | ⚠️ **Breached on its face, and accepted.** A knee angle at bottom dead centre is a value used clinically, and nothing in this program validates one from a single uncalibrated phone. The peer-reviewed literature that exists puts markerless error at 6 to 10 degrees with **four** cameras |

> **The decision, the owner's.** Fit angles are shown although they may breach condition 6, and so
> may place the product outside the general-wellness carve-out. **The owner accepts that risk**, on
> 2026-10-03, in ruling 1 of the comment quoted in Context, *"accept the risk, framed"*, on the
> precedent of [ADR 0035](0035-model-written-ride-write-ups.md) D-1.

This is option **(i)** of #1059's three. **(ii)**, narrowing the claim, is taken as far as it goes
without removing the numbers: four angles, one surface, rounded, caveated, no verdict, no range
comparison. **(iii)**, a validation route, is **not named**, because validation is a study somebody
runs and publishes, and nothing in this project's reach would be one.

**What the framing is**, so it is checkable: every number is *"about"* a value rounded to 5° (D-3);
every number's sentence says *"a rough estimate from one camera and not a professional bike fit"*
and gives the published error (D-8); and no number is placed against a target (D-9).

**The EU and UK, re-read in spike 0008.** Nothing there made D-3 stricter or looser (§7), and the
wellness exclusion of MDCG 2019-11 still holds while the intended purpose is fitness (§4.1). What
fit changes is that spike 0008's Question A was asked about a product where *"no absolute value is
rendered"*, and that is no longer true. R5 remains the rule carrying the EU margin (§4.3), D-5's
equipment clause the second (§7), and D-6 is kept for spike 0008's reason (D-9). ⚠️ **And Article
2(12)'s *intended purpose* includes promotional material**: the word *"fit"* in a store listing,
a release note or `README.md` is the manufacturer describing the product, and spike 0008 §8's gap,
that nothing scans those, is wider now that the product has a feature called a fit check.

### D-12 — Storage: the athlete's own data, tied to its ride, no picture

- **A fit check is tied to the ride it was taken in**, by that ride's activity id, as the side-camera
  report already is (`camera/side-report-keeper.ts`). It is shown on that ride's page, **deleted when
  the ride is deleted**, and removed by *Erase everything* (`ERASE_REMOVES`). This applies the
  owner's ruling 3 to a fit check (Context).
- **It holds no time of its own.** No wall-clock time, no arrival time and no offset into the ride:
  the ride it belongs to is its time. That keeps ADR 0033 D-3's rule that pose numbers are never
  stored with a wall-clock time or an offset, and [#1065](https://github.com/openzigs/onyourleft/issues/1065)'s
  data model drops its *"when it was taken"* field for this reason.
- **What it holds**: the athlete id (every read filters on it), the activity id, the four angles
  (median, unrounded), each with its revolution count, its interquartile range and its reason when
  not measured, which side was used, whether the gravity reference was used, the framing-check
  result, and **this ADR's definitions version**, so a later change to D-3 is visible in old
  records.
- **What it never holds**: a picture, a landmark coordinate, a segment length, a ratio of lengths,
  or anything about equipment (P2, P6). A snapshot, if the rider presses for one, is ADR 0044's
  record, not this one's.
- **One fit check per ride.** A second check during the same ride replaces the first. ⚠️ **The
  author's choice**: it keeps *"the fit check of this ride"* a single thing on the page, in the
  export and in a model's input.
- **Exported** in the account export (#35), named in the manifest with its fields, as data (D-7).
  **Not** in any single-ride file export or shared copy.
- The store, the migration, the scoping and erasure tests and the fake are #1065's, under
  `CLAUDE.md` §5's round-trip harness.

---

## Consequences

### What this enables

- **#1064 to #1067 can be written against rules rather than a taste**: each rule in D-2 is a test,
  D-7 names exactly what the gate is narrowed to, and D-8 gives #1066 its word lists.
- **The rider gets the thing ADR 0030 said riders come for, partly.** Four of their own angles, with
  the honest error beside each. Not *"your saddle is 8 mm too low"*: that sentence is still
  refused, by D-5's equipment clause, R4 and element (g).

### What this costs, stated plainly

- **Fit cannot ship yet.** At #1112's 0.3 pictures a second, no fit check can prove BDC sampled, and
  D-0 refuses to offer one. If #1112 fixes the rate to about 5 a second, a check needs a sweeping
  capture of about half a minute at best, and longer in practice.
- **The regulatory margin is the thinnest this project has accepted for app-written text.** ADR
  0035 accepted condition-6 risk for **a model's** words. This ADR accepts it for **the app's
  own** numbers, framed. Every other condition now rests on wording rules holding: one alert, one
  *"reduces the risk of"*, or one range placed beside a number would argue the product out of the
  carve-out it relies on.
- **The patent margin is thinner too.** D-5's verdict clause still stands, which keeps (g) where
  spike 0020 put it. But the product now computes absolute body angles, closer to a conventional
  bike-fit tool than #377's difference report, and spike 0006 §5's ten documents are still unread.
- **No verdict and no range comparison**, which is what a rider might expect a fit check to give.
  They read four numbers and some cited prose and decide for themselves.
- **The trunk needs a phone-side change** and a new link message, owned by the transport work.
  Until it exists, the trunk is *"not measured"*.
- **A model may know the rider's fit and may not restate it.** A write-up that does is withheld,
  and the rider is told why, which some riders will find odd.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#1058](https://github.com/openzigs/onyourleft/issues/1058) (ADR 0044) | No angle on the live view (D-7). The tilt message in ADR 0033 D-3's list (D-4). The capture transport whose rate D-0 measures |
| [#1060](https://github.com/openzigs/onyourleft/issues/1060) | D-8's caveat and D-9's range sentence in the published wording; whether the policy names the tilt (D-4) |
| [#1064](https://github.com/openzigs/onyourleft/issues/1064) | D-0's measurement and fixtures, D-3's event definitions, D-5's tolerance, N and steadiness tests, no sensor join |
| [#1065](https://github.com/openzigs/onyourleft/issues/1065) | P1 to P6, D-3's definitions and rounding, D-6's conditions, D-12's record (no taken-at time, one per ride) |
| [#1066](https://github.com/openzigs/onyourleft/issues/1066) | D-7 entire: a section, not a route; one wording module; `ANGLE_SURFACES` and the import-graph test; D-8 and D-9 |
| [#1067](https://github.com/openzigs/onyourleft/issues/1067) | D-10: the screen's degree matchers unchanged, P8 added for fit-carrying write-ups |
| [#1112](https://github.com/openzigs/onyourleft/issues/1112) | Its fix is the first half of D-0 |

### ADR 0030 and an amendment

ADR 0030's body is not edited. An appended `## Amendments` entry on ADR 0030 pointing here, as
[ADR 0013](0013-adr-amendments.md) allows and as ADR 0033 and ADR 0035 each did, is **not made in
this pull request** and is left as a follow-up for the owner to confirm. Until it exists, a reader
of ADR 0030 D-3 and D-5 finds this ADR through `docs/architecture.md`'s index.

---

## Questions for counsel

Following [ADR 0007](0007-patent-posture.md)'s model. None is *"are we safe"*.

**Patent (spike 0020 §6).**

- **A′. A claim chart of US 12,499,571 claims 1, 10 and 17 against this design.** (1) The doctrine of
  equivalents on **(c)** for an angle-only pipeline that never computes a length, given that the same
  product computes pixel segment lengths and checks their proportions elsewhere (D-2's last note).
  (2) The doctrine of equivalents on **(g)**, which matters less now that no range comparison is
  adopted, but is the question to buy before one ever is.
- **B′. The file wrappers.** Is there a continuation or divisional of US 18/075,800, and what is
  **CA 3,183,442**'s prosecution status and likely grant, given that its claim 1 has **no Markush
  group (h)**? **Worth buying now**: it is the one answer that can change without this project doing
  anything, and the app reaches Canadian riders through Google Play.
- **E. A learned metric scale under the Canadian claim.** Would a pose model's metric reconstruction
  (`worldLandmarks`) be *"calibrated body segments lengths … using a calibration factor"*? P2 keeps
  it out. Worth buying if anyone proposes a length in real units, or if B′ finds the Canadian claim
  will grant as published.
- **D. A verdict in words** is **not adopted**, so not worth buying unless a verdict is proposed.
- **C. Publication**, unchanged from spike 0006: this ADR is a third dated public record of the same
  patent.

**Regulatory.**

- **R-1. Condition 6.** Is a joint angle from one consumer camera, rounded, labelled *"a rough
  estimate from one camera and not a professional bike fit"* and given with its published error, a
  *"value that mimics those used clinically"*? Does the labelling, the rounding or the absence of
  any target change the answer?
- **R-2. Spike 0008 Question A, restated for absolute values.** Does *"investigation … of the
  anatomy or of a physiological process"* reach four absolute sagittal angles from one uncalibrated
  camera, where no condition is named and no target is shown?
- **R-3. The word "fit" in the intended purpose.** Under Article 2(12), does describing a *fit
  check* in a store listing or release note move the product toward MDCG 2019-11's musculoskeletal
  examples, and what wording keeps it a fitness app?
- **R-4. Northern Ireland**, spike 0008 Question C, unchanged.

---

## What would make this ADR wrong

- **The owner withdraws the acceptance in D-11.** Then this ADR is superseded and no absolute angle
  is rendered anywhere, which is ADR 0030 D-3 as written.
- **The rate never reaches D-0's bar**, on the owner's devices or a rider's. Then fit is a decision
  with nothing built, and should be said to be so rather than shipped at a rate that cannot prove
  BDC.
- **A continuation issues, or CA 3,183,442 grants as published.** Then D-2's chart may be of the
  wrong claims, and in Canada (d) is held by P2 alone.
- **Element (c) is read broadly**, to reach a skeleton's implicit distances or the shipped
  proportion check. The chart still has four elements outside, but the margin narrows, and
  reworking `pose-plausibility.ts` and `side-report.ts` to directions only becomes worth its cost.
- **A rule in D-2 lands without its test**, or P1 lands without P3, or P4 checks only the fit
  module's own source. A pipeline that reports a ratio of lengths passes P1 alone.
- **Something reads `worldLandmarks`, a height or a marker.** Then (d) is a question, not an
  absence.
- **The narrowed gate is widened by convenience**: a second entry in `ANGLE_SURFACES`, a directory
  match, or a second importer of the wording module. Each is a new angle surface, and each needs a
  superseding ADR, not a review note.
- **A model restates an angle without a degree sign**, and the gap D-10 records is exploited. Then
  the write-up screen needs a rule for fit-carrying write-ups that this ADR did not write.
- **The FDA guidance is revised**, or spike 0008's documents are. Every quotation here is from
  ADR 0030's read of 2026-09-22 and spike 0008's.
- **One of spike 0006 §5's ten unread documents is closer than '571.** A fit report with absolute
  angles is closer to a conventional bike-fit tool than #377's design was, so the unread art matters
  more.
- **Anyone reads this as clearance.**
