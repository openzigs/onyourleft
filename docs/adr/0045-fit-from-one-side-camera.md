# ADR 0045: Fit from one side camera — four rough sagittal angles on one surface, inside the patent design-around and the wellness carve-out

- **Status**: Accepted, on the owner's rulings of 2026-10-03 and 2026-10-04, which are quoted
  verbatim in Context. **The owner approved this ADR for merge on 2026-10-04**: asked *"Do you
  approve ADR 0045 (bike fit) for merge?"*, the owner answered *"Approve"* (#1059's last acceptance
  criterion). The same day the owner ruled that a model's write-up may give equipment and position
  advice (*"Allow advice too"*), which D-1, D-2, D-10 and D-11 record. Every point the rulings do not
  settle is marked **the author's choice** where it is made, and each takes the narrower option.
  **Nothing is built by this ADR**, and D-0 says what has to be true before anything that renders a
  fit angle may ship
- **Date**: 2026-10-04
- **Deciders**: **the owner**, on whether fit exists at all (ruling 3 of epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055)), on the FDA condition-6 risk, on the
  trunk angle's reference, and on tying a capture to its ride (the three rulings in the comment on
  #1055 and #1059), and on **2026-10-04** on approving this ADR, on one small ADR for the phone's
  tilt and ADR 0044's acceptance, and on equipment and position advice in a model's write-up. The
  author decided the engineering content and drafted the wording
- **Issue**: [#1059](https://github.com/openzigs/onyourleft/issues/1059). Parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055)
- **Number**: **0045**, reserved by epic #1055 on 2026-10-03, which read *"The next free number is
  0044"* from [`docs/architecture.md`](../architecture.md) and reserved **0044** for
  [#1058](https://github.com/openzigs/onyourleft/issues/1058) (a live view and a snapshot) and
  **0045** for this issue. ADR 0044 was written by #1058 and merged on 2026-10-04
  ([#1113](https://github.com/openzigs/onyourleft/pull/1113)), with its Status *Proposed* and its
  wording approved by the owner; this pull request records 0045 as written beside it
- **Numbering in this ADR**: a bare *D-n* is **this ADR's** decision. Another ADR's decision is
  always written with its number, *ADR 0030 D-5*, because ADR 0030 and this ADR both have a D-3 to
  a D-8 and they are about different things (ADR 0030 D-5 is *no fit verdict*; this ADR's D-5 is
  the capture)
- **Supersedes**, each **to the extent named in D-1 and no further**:
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-3**, *"No absolute joint angle is ever
    reported as a number"*, for **the four angles D-3 below defines, on the one surface D-7 names**.
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-5**, for its **product boundary**:
    the program now offers a check it calls a *fit check*. **And, by the owner's ruling of
    2026-10-04, for a model's write-up (ADR 0035)**: ADR 0030 D-5's equipment clause, ADR 0030
    **R4**, and the *"or otherwise"* half of ADR 0030 **R7** no longer bind a write-up, which may
    name a component and suggest an equipment or position change (D-10). **For everything the app
    itself writes, the Fit check section included, ADR 0030 D-5's equipment clause, R4 and R7 stand
    unchanged**, and ADR 0030 D-5's verdict clause stands everywhere (D-1, D-8).
  - ADR 0030's body is not edited. It carries an appended `## Amendments` entry dated **2026-10-04**
    pointing here, under [ADR 0013](0013-adr-amendments.md), as ADR 0033 and ADR 0035 each did.
  - ADR 0035's body is not edited and **no ADR 0035 decision is superseded**: ADR 0035 D-1 left
    ADR 0030 D-5 unscreened on model text as an accepted risk, and the owner's ruling turns that
    risk into a permission (D-10).
- **Narrows, without superseding**: ADR 0030 **D-8**, what a machine checks. It **stands**, with its
  first bullet **narrowed, not deleted**, for one file named by exact path (D-1, D-7).
- **Does NOT supersede**, named so none of it is read as touched: **ADR 0030 D-1**; **ADR 0030
  D-2** as amended on 2026-09-28 (R1 to R10, with R1 relaxed only as this ADR's D-3 says, and R4
  and R7's non-medical half relaxed for a model's write-up only, as above); **ADR 0030 D-4**
  (nothing frontal-plane); **ADR 0030 D-6** (decided explicitly in this ADR's D-9: **kept**); and
  **ADR 0030 D-7** (the live silence rule); ADR 0030's 2026-09-23 amendment and its six conditions; [ADR 0029](0029-camera-imagery-as-a-data-class.md)
  **D-8** and **D-9**; [ADR 0033](0033-side-camera-link.md) **D-3**, including its rule that nothing
  joins pose numbers to a ride reading or a wall-clock time (this ADR's D-5 and D-12 keep it);
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
session on the same path. The owner approved this ADR, that reading included, on 2026-10-04 (below).

### The owner's rulings of 2026-10-04

Asked on 2026-10-04, answered the same day, each question with its answer verbatim:

| # | Question | Answer |
|---|---|---|
| 1 | *"Do you approve ADR 0045 (bike fit) for merge?"* | *"Approve"* |
| 2 | The phone's tilt message on ADR 0033 D-3's list, together with ADR 0044's acceptance | *"One small ADR for both"* |
| 3 | AI write-ups and bike components | *"Allow advice too"* |

What each one does here:

1. **This ADR is approved** for merge, with the author's choices marked in it. The Status records it.
2. **One small ADR, written separately, will add the phone's tilt message to ADR 0033 D-3's list
   and accept ADR 0044.** This ADR does not write it. Until it is accepted, D-0's item 4 and its
   trunk precondition both stand, and the trunk reads *"not measured"*.
3. **A model's write-up (ADR 0035) may now name components and may suggest equipment or position
   changes**, such as *"raise your saddle"* or *"a shorter crank may suit you"*. That supersedes
   ADR 0030 D-5's equipment clause, R4 and R7's non-medical half **for write-ups only** (D-1),
   removes the component-withholding screen the draft of this ADR planned as P8 for #1067 (D-2,
   D-10), and puts element (g) of US 12,499,571 in play in write-up output (D-2). **The Fit check
   section is unchanged by it**: the app's own sentences show numbers and give no advice (D-7).

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
  ruling cost is **margin**: ADR 0030 D-5's verdict clause was one of the reasons for (g), and the
  standing half of ADR 0030 D-5 (no size, component or direction) is what held it. ⚠️ **Since the
  owner's ruling of 2026-10-04 that half no longer binds a model's write-up**, so (g) may be present
  in write-up output, and D-2 records what still keeps the claims outside.
- ⚠️ **The pending Canadian family member CA 3,183,442 A1 has no Markush group (h) in its claim
  1.** Spike 0006 did not record it. In Canada (d) must hold by itself.
- **Element (c) is uncertain.** An angle taken from two directions needs no length, which is the
  strongest literal argument. But **scale-free is not length-free**: a ratio of lengths survives
  multiplying every coordinate by k, so a second rule is needed. And shipped code
  (`pose-plausibility.ts` §`implausibility`, `side-report.ts` §`saddleOf` and §`jointAngle`)
  already computes segment lengths and their proportions.
- **Eight checkable rules, P1 to P8**, which D-2 below adopts, with P8 replaced by the owner's
  ruling of 2026-10-04 (D-2).

### The regulatory documents, re-read for this ADR

ADR 0030's Context quotes the FDA's *General Wellness: Policy for Low Risk Devices* of January 6,
2026, read first-hand on 2026-09-22, and its 2026-09-23 amendment put this product **inside** the
non-invasive-sensing carve-out, which holds only while all six conditions hold. This ADR did not
fetch the guidance again. It relies on ADR 0030's verbatim quotation and records that it did so.
Condition 6 is the one fit breaks on its face:

> *"do not include values that mimic those used clinically unless validated (e.g. manufacturer
> testing, peer-reviewed clinical literature) to reflect those values."*

[Spike 0008](../spikes/0008-eu-uk-medical-device-read.md) was re-read for this ADR, §4.2, §4.3 and
§7 in particular. What it says that bears on fit:

- **§4.1**: MDCG 2019-11 Rev.1 names *"wellness or fitness apps"* as not qualifying as medical
  device software. The fitness claim of #495 Q1 is what keeps the product inside that exclusion.
- **§4.3**: *"In the EU, the distance between this product and a class IIa medical device is
  carried by ADR 0030 R5, and by very little else."*
- **§4.2**: the worked class IIa example (MDCG 2019-11, sub-rule 11a) is software *"intended to
  prevent the risk of illnesses or pathologies by analysing physiological parameters (e.g.
  placement of the dorsal vertebrae …)"*. A trunk angle is posture measured from anatomy.
- **§7**: ADR 0030 D-3 gained **no** third reason from the EU or UK read. ADR 0030 D-5 gained one:
  the musculoskeletal example turns on *recommending* something to do. And on ADR 0030 D-6: *"Placing a rider
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

Fourteen decisions. **D-0** is what must hold before anything ships. **D-1** draws the boundary of
the reversal. **D-2** is the patent design-around as checkable rules. **D-3** to **D-6** are the
measurements, the trunk's reference, the capture and the confidence. **D-7** is the closed list of
surfaces and how the gate is narrowed. **D-8** and **D-9** are the wording and the literature
ranges. **D-10** is the model write-up. **D-11** is the regulatory position. **D-12** is storage.
**D-13** is what would make this ADR wrong.

The issue's eight items map to: item 1 → D-2; item 2 → D-3, D-4; item 3 → D-0, D-5; item 4 → D-7;
item 5 → D-10; item 6 → D-11; item 7 → D-12; item 8 → D-13.

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
>    sampled within the tolerance this ADR's D-5 (capture) sets, on its number of revolutions, within **60 s** of steady
>    pedalling, at each of 60, 75, 90 and 105 rpm. 0.3 a second fails this by the arithmetic in
>    Context.
> 3. **The capture refuses at run time too.** Each fit check counts what it receives, and a check
>    that does not reach the evidence of this ADR's D-5 (capture) in its time says so in words and
>    shows no knee number (this ADR's D-5 and D-6). Item 1 is about the owner's devices; this is about the rider's.
> 4. **ADR 0044 is accepted** ([#1058](https://github.com/openzigs/onyourleft/issues/1058)). It merged
>    on 2026-10-04 with its Status *Proposed* and the owner's approval of its wording, and its D-2 is
>    conditional on spike 0021, so this item holds once its Status reads *Accepted*. By the owner's
>    ruling of 2026-10-04, **one small ADR**, written separately, accepts ADR 0044 and adds the
>    phone's tilt message (Context), so it discharges this item and the trunk precondition below
>    together. It is a
>    precondition because the capture's transport and any picture buffer are its decisions, and the privacy policy and
>    Play Data Safety wording ([#1060](https://github.com/openzigs/onyourleft/issues/1060)) are
>    approved by the owner, under [ADR 0033](0033-side-camera-link.md) D-10's rule that the
>    published statements are true at every merge.

⚠️ **Item 2's 60 s is the author's choice**: a fit check a rider has to hold steady for longer
than a minute is one most riders will not finish, and a longer window lets cadence drift spoil the
sweep. It is written down so that changing it is a decision.

> **The trunk angle has a fifth precondition.** It is **blocked** until an **accepted ADR widens
> [ADR 0033](0033-side-camera-link.md) D-3's phone-to-tablet list**, which says *"and nothing
> else"*, to admit the phone's tilt message (D-4). **This ADR does not widen it, and neither does
> ADR 0044.** ADR 0044 merged on 2026-10-04 ([#1113](https://github.com/openzigs/onyourleft/pull/1113))
> and says so in its own words: *"The phone's tilt message is a new D-3 message that the capture
> work after spike 0021 adds, and this ADR does not add it."* Its table of what each issue owns
> gives [#1064](https://github.com/openzigs/onyourleft/issues/1064) *"the phone's tilt message (the
> owner's trunk-angle ruling), both added there and not here"*. #1064 is an implementation issue,
> and an implementation issue cannot widen an ADR's list, so **ADR 0044 does not discharge this
> precondition**, and the trunk stays *"not measured"* until an accepted ADR widens the list.
> Until such an ADR is accepted, **every fit check reports the trunk as *"not measured"*** with its
> reason in words (D-6), and BDC and TDC are found by D-4's fallback. The other three angles do
> not wait for it. **Which ADR does it is decided**: the owner ruled on 2026-10-04 for *"One small
> ADR for both"*, the tilt message and ADR 0044's acceptance (Context). It is written separately,
> and this precondition holds until it is accepted.

Code that cannot reach a rider (the pure computation, the store record, fixtures) may land before
the preconditions hold. The rule is about what a rider can start and see.

### D-1 — What is superseded, and what stands

| Rule | Status under this ADR |
|---|---|
| ADR 0030 **D-3**, no absolute joint angle | **Superseded** for exactly the four angles D-3 defines, rendered only on the surface D-7 names, each with D-8's caveat in the same sentence. Everywhere else D-3 stands, including for a limb angle, a segment length and a body dimension, which this ADR never permits anywhere |
| ADR 0030 **D-3**'s second reason, condition 6 | **Accepted as a risk by the owner** (D-11). It is not argued away |
| ADR 0030 **R1**, a quantity only as a change | **Relaxed only as D-3 is**: the four fit angles may be standing values on D-7's surface. Everything else this app says about a body is still a difference |
| ADR 0030 **D-5**, no sizing, no equipment, no fit verdict | **Superseded for its product boundary**: the program offers a *fit check*. **The equipment clause is superseded for a model's write-up only**, by the owner's ruling of 2026-10-04 (*"Allow advice too"*): a write-up may name a component and suggest an equipment or position change (D-10). **For everything the app itself writes, the Fit check section included, the equipment clause stands** (D-7). **The verdict clause stands everywhere**: no fit check output characterises a position or fit as correct, optimal, good or bad, and no verdict, **signed or unsigned**, is adopted (D-8). ⚠️ **That the verdict clause also stands for write-ups is the author's reading** of a ruling that names advice and not verdicts, and it is the narrower one |
| ADR 0030 **D-4**, nothing frontal-plane | **Stands, unchanged**, as a number, a word, or a line drawn on a picture. The fit check is sagittal and near-side only |
| ADR 0030 **R4 to R9** | **Stand**, with **R4 and R7's non-medical half relaxed for a model's write-up only** (D-10). R4: no component, size or direction, still binding every sentence the app writes. R5: no condition or injury, in any tense, write-ups included. R6: no clinical, professional or *"accurate to"* framing, write-ups included (D-8 records the one fixed negative phrase the owner's ruling uses). R7: no prompt or alert; a write-up may now suggest an equipment or position change, and still no medical prompt and no alert. R8: **load-bearing**, every fit number carries its uncertainty in the same sentence, and a write-up says its advice rests on a rough estimate (D-10). R9: no score or ranking |
| ADR 0030 **R10** and **D-6**, literature ranges | **Kept**, decided explicitly in D-9 |
| ADR 0030 **D-7**, live silence | **Stands.** No fit angle is shown, spoken or sent while a ride is recording or paused (D-7) |
| ADR 0030 **D-8**, what a machine checks | **Stands**, and its first bullet is **narrowed, not deleted**, for one file named by exact path (D-7). It is not superseded |
| ADR 0035 **D-4**, the degree screen on model text | **Stands whole** (D-10). The component screen the draft added here (P8) is **removed** by the owner's ruling of 2026-10-04; one narrow screen for mobility words is added for (e) (D-2, D-10) |
| ADR 0035 **D-1**, ADR 0030 D-5 unscreened on model text as an accepted risk | **Not superseded.** The owner's ruling turns that accepted risk into a permission for equipment and position advice (D-10) |
| ADR 0033 **D-3**, the join rule | **Stands** (this ADR's D-5 and D-12) |

⚠️ **The epic allowed more than this ADR takes.** Ruling 3 supersedes ADR 0030 D-3 and D-5 *"to the
extent needed"*. The author reads "needed" as what fit requires to exist, and a verdict or a range
comparison is not required for a rider to read four angles. Adopting either later is a superseding
ADR, and spike 0020 §6 Question D or A′.2 is what to buy first.

### D-2 — The patent design-around, as checkable rules (spike 0020 §4)

"Fit path" means everything from a pose to a stored or rendered fit number: the fit computation,
the fit check record, the fit section of a model's input, the wording module, the section that
renders it, and the write-up screen. Each rule names the claim element it holds (spike 0020 §2)
and the check that holds it.

| Rule | Statement, checkable | Check |
|---|---|---|
| **P1** (d, f, h) | **Multiplying every image-plane landmark coordinate by any k > 0, and adding any offset, leaves every reported fit number unchanged.** The only scale applied is the picture's own aspect ratio, which turns normalised coordinates into square pixels. **And** rotating every landmark about any point together with the **reference direction** leaves every number unchanged. The reference direction is an explicit input of the computation: the phone's gravity direction (D-4) when it passed D-4's test, and **in D-4's fallback the picture's own downward axis, passed in as a unit direction rather than read as a hard-coded axis**, so the clause holds in both cases. No angle may read the picture's axes except through that input | A property test over k ∈ {0.25, 1, 4, 17}, random offsets and random rotations ([#1065](https://github.com/openzigs/onyourleft/issues/1065)), run once with a gravity direction and once in the fallback. Mutation: divide by the frame height, or by any segment length; or find BDC by the raw picture *y* coordinate instead of the reference input, which the fallback's rotation case turns red |
| **P2** (d, f, h) | **No input to the fit path carries a physical unit of length.** The computation's input is poses and the gravity reference only. Rider height, mass and the athlete row are not inputs, nothing in the fit path's import closure is under `apps/web/src/athlete/`, and MediaPipe's `worldLandmarks`, which its declaration says are *"in meters"*, are never read anywhere in `apps/web/src` | A test asserts the input type's keys. A source scan finds no `worldLandmarks` under `apps/web/src`. The import-closure walk below finds nothing under `src/athlete/` |
| **P3** (c) | **Each interior angle (knee, hip, elbow) is unchanged when either end landmark is moved along its ray from the joint, by independent factors.** **The trunk angle is unchanged when the shoulder is moved along the hip-to-shoulder ray, by any factor**, because it has one landmark ray and one reference direction, and the gravity reference is a unit direction with no position. The numbers depend on directions only, never on a length or a ratio of lengths | A property test that slides the end landmarks of each angle along their rays by different factors, and the shoulder along the trunk ray. Mutation: report a ratio of lengths, or weight by a length. P1 cannot catch either, and P3 does |
| **P4** (c) | **No segment length is computed in the fit path, even as an intermediate.** Angles are taken with `Math.atan2(cross, dot)`, never `Math.acos` over a product of norms. **The rule reaches the whole import closure of the fit computation**, not only its own file: a fit module that imported `side-report.ts` §`jointAngle` or `pose-plausibility.ts` would pass a scan of its own source and still compute lengths | A transitive import walk from the fit computation's entry module(s) with `apps/web/src/camera/import-walk-testing.ts`, which fails on `Math.hypot`, `Math.sqrt` or `Math.acos` in any production module it reaches, and on reaching `side-report.ts` or `pose-plausibility.ts` at all. Mutation: import `jointAngle` into the fit module |
| **P5** (e) | **Every angle is reported at a named crank event (D-3), never as a minimum, a maximum or a range over the stroke**, and no output names a flexibility, mobility or range-of-motion category | The output type has one value per angle at a named event, and a test asserts its keys. The wording falls under R5, R6 and D-8 |
| **P6** (g, claim 17) | **No data about equipment exists in the fit path.** No frame size, stack, reach, saddle height, setback, stem, crank length, component or catalogue, as a table, a type field or a model input | A test asserts the keys of every fit type and of the model's fit section. A source scan of the fit modules for those words |
| **P7** (g) | **No fit output names a component, a size, or a direction to move either.** No verdict is adopted (D-8), so the question of signing one does not arise | A closed list of every fit sentence, in one wording module (D-7), with a test over the list for D-8's component, size, direction and verdict words |
| **P8** (e) | ⚠️ **Spike 0020's P8, which withheld a write-up naming a component, a size or a direction to move one, is withdrawn** by the owner's ruling of 2026-10-04 (*"Allow advice too"*): a write-up may now do all three (D-10). **In its place: a model's write-up that assesses the rider's flexibility, mobility or range of motion is withheld whole** by the write-up screen, whatever the prompt said, **whether or not its input carried a fit section**, so that advice cannot carry element (e) into the product. The matchers are D-10's | `write-up-screen.test.ts` cases built with `model-answers-testing.ts` ([#1067](https://github.com/openzigs/onyourleft/issues/1067)), including one whose input has **no** fit section, and one that names a component and **is shown**. Mutation: redact instead of withhold; or apply the screen only when the input has a fit section, which the first case turns red; or keep the old component screen, which the second turns red |

**P1 and P3 together** are the claim that matters: the numbers depend on segment directions alone.
One without the other is a vacuous pass.

> **Element (g) and the owner's ruling of 2026-10-04.** Asked about AI write-ups and bike
> components, the owner answered *"Allow advice too"* on **2026-10-04**. The effect, stated plainly:
>
> - **Element (g) of US 12,499,571**, *"selecting … the sporting equipment based on the model from
>   one or more models of sporting equipment"*, **may now be present in write-up output.** A
>   write-up that says *"a shorter crank may suit you"* is arguably a selection of equipment. P6
>   and P7 still keep (g) out of everything the app itself computes and writes: no equipment data
>   on the fit path, and no component, size or direction in a fit sentence.
> - **The US claims stay outside because (d), (e), (f) and (h) are still absent.** There is no
>   calibration factor from a height or a marker (P1, P2), so no calibrated segment lengths (d) and
>   no calibrated model (f) to base a selection on, and (h)'s two formulas are never computed. No
>   mobility is assessed (P5 for the app's output, P8 for a write-up's). **P1 to P8 stay, and each is
>   now load-bearing**: with (g) no longer an absence in write-ups, every independent claim of '571
>   is avoided only through these four elements.
> - **In Canada the margin is thinner.** CA 3,183,442's claim 1 has **no (h)**, so there it rests
>   on (d), (e) and (f) alone, held by P1, P2 and P5/P8. (Its (g) reads *"based on the calibrated
>   model"*, which still needs (f), but that is the same absence counted again, not a new one.)
> - **The owner accepted this risk** with the ruling. Question **G** below is what to ask a lawyer.

> **The output property, stated once.** **No fit output type has a length, a size, a component or
> a direction field.** "Fit output type" means every type on the fit path: the computation's
> result, the stored fit check record (D-12), the model's fit section (D-10), the account export's
> fit entry (D-7), and the wording module's inputs. Each may hold an angle in degrees, a count, a
> spread in degrees, a side, a reason from a closed list, a flag and a definitions version, and
> nothing else. "Direction" means a direction to move something; the gravity reference is an
> **input** (D-4) and is never stored or output. P2, P4 and P6 are the input and computation halves
> of this property, and the check is one test that asserts the keys of each of those types against
> a list.

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
How each phase is estimated, and the tolerance it must meet, is this ADR's D-5 (capture) and #1064's.

| Angle | Landmarks (near side) | Event | Definition |
|---|---|---|---|
| **Knee at BDC** | hip, knee, ankle | BDC | The interior angle at the knee between the knee→hip and knee→ankle directions. A straight leg is 180° |
| **Hip** | shoulder, hip, knee | **TDC** | The interior angle at the hip between the hip→shoulder and hip→knee directions. At TDC, because that is where fitters usually quote it (the most closed point of the stroke), and **at the event, never as the minimum over the stroke** (spike 0020 §2.2) |
| **Elbow** | shoulder, elbow, wrist | BDC | The interior angle at the elbow between the elbow→shoulder and elbow→wrist directions |
| **Trunk** | hip, shoulder, and the gravity reference | BDC | The angle between the hip→shoulder direction and **horizontal**, horizontal being perpendicular to the phone's reported gravity direction in the picture (D-4). 0° is a flat back, 90° is upright |

**Each value** is the median of the per-revolution values at that event, over the revolutions this
ADR's D-5 (capture) accepts. **Each rendered value is rounded to the nearest 5°** and introduced with *"about"*.
⚠️ **The rounding is the author's choice**: published markerless error for this measurement is 6
to 10 degrees (R8), and a value given to the degree would be the spurious precision R8 names as its
own violation. The stored value keeps the median unrounded (D-12).

Every angle is computed with `atan2(cross, dot)` (P4) and is invariant to scale, offset, and a
rotation of the landmarks together with the reference direction (P1). The three interior angles are
also invariant to a rotation of the landmarks alone.

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
- ⚠️ **This needs a message on [ADR 0033](0033-side-camera-link.md) D-3's phone-to-tablet list,
  which says *"and nothing else"*.** The wire format belongs with the transport, which spike 0021
  ([#1057](https://github.com/openzigs/onyourleft/issues/1057)) settles, as the owner's ruling
  says: *"File it with the capture work once spike 0021 settles the transport."* **This ADR decides
  that the trunk is measured against it. It does not itself widen ADR 0033 D-3**, and D-0 makes
  the widening, by an accepted ADR, a precondition of the trunk angle: until then the trunk is
  *"not measured"*.
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
| 1 | The evidence of this ADR's D-5 (capture): at least 10 accepted revolutions with the event sampled within ±10° |
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
>
> **The Fit check section shows numbers only, and gives no advice.** The owner's ruling of
> 2026-10-04 allows equipment and position advice in **a model's write-up only** (D-10). Every
> sentence on this section is the app's own, from the wording module, and stays under ADR 0030
> D-5's equipment clause, R4 and P7: no component, no size, no direction to move either. Advice
> appears only in a write-up, which is its own section of the ride's page (ADR 0035), and never
> inside the Fit check section.

| Surface | May show a fit angle? |
|---|---|
| **The Fit check section of a ride's page**, `apps/web/src/detail/FitCheckSection.tsx`, rendered by `views/ActivityDetailView.tsx` on route `activity-detail` (`#/activities/:activity`) and the same page in the Activities list–detail pane (`#/activities/selected/:id`), for a ride that has a fit check | **Yes**, and only in sentences from the wording module below |
| **The account export** (#35), as numeric data in the fit check's manifest entry (D-12) | **Yes, as data**: numbers in named fields, no sentence. It is the rider's own copy, not a screen |
| The HUD, the game, the Ride screen, the live view (ADR 0044), the Camera and side-camera screens, Home, the library and every list row, Analysis, the side-camera report section, an announcement, a sound, a notification, a share preview, and any single-ride file export (FIT, GPX, TCX) | **No** |
| A model's write-up (ADR 0035) | **No angle**: D-10. It is the one place advice may appear |

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
   the word, a `'degree'` formatter) are lifted. ⚠️ **The lift is file-wide, and that is decided,
   not overlooked.** It is **not** keyed per sentence the way `EXEMPT` is: `EXEMPT` matches a file
   **and the exact text** of one string (`no-absolute-angles.ts` §`EXEMPT`), and a fit sentence is
   a template with a number in it, so there is no exact text to match. The file-wide lift is
   acceptable because that file is a closed wording module and nothing else: every sentence in it is
   on #1066's list, which holds R8's caveat and D-8's word lists over each one, and item 5 below
   keeps its importers to the one section. A degree sign added to that file outside an angle
   sentence would pass this gate; the closed-list test is what catches it.
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
drafted here, and the owner approved it with this ADR on 2026-10-04 (*"Approve"*):

> *"Knee at the bottom of the stroke: about 145°, a rough estimate from one camera and not a
> professional bike fit; studies of camera measurements like this one found them off by about 6 to
> 10 degrees (Kakavand et al., 2025)."*

Each of the four angles has a sentence of that shape. ⚠️ **The trunk's sentence names no
direction**: it reads *"Trunk angle to horizontal: about 40°, …"*, never *"above horizontal"*,
because *"above"* is on P7's direction list below and the list has **no exception**, for the trunk
or any other sentence. ⚠️ **The author's choice**, the narrower of drafting round the word and
admitting it. The citation is named inline, in the same
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
holds (it may add, never remove). **Matching is case-insensitive and on word boundaries**, never
by substring: *"low"* is in *"follow"*, *"up"* in *"upright"* and *"too"* in *"took"*, and a
substring match would refuse innocent capture-state wording. A multi-word entry (*"open up"*)
matches as a phrase.

| Kind | Words |
|---|---|
| Components and sizes (R4, P6, P7) | saddle, seat, seatpost, stem, handlebar, bars, crank, cleat, frame, size, reach, stack, setback, spacer, shim, mm, millimetre, cm, centimetre, inch |
| Directions (R4, P7) | raise, lower, higher, move, adjust, forward, backward, up, down, above, below, too, high, low, extend, shorten, lengthen, open up, close down |
| Verdicts (ADR 0030 D-5, R3, R9) | good, bad, correct, incorrect, wrong, optimal, ideal, normal, abnormal, should, recommend, within, outside, score, better, worse |
| Bodies (R5) | pain, injury, injure, strain, risk, prevent, healthy, unhealthy |

**No verdict, signed or unsigned.** Spike 0020 §2.1's Option V (*"within the range fitters often
use"*) is **not adopted**. An unsigned verdict leaks less direction than a range comparison, but it
is still a pass or a fail, it moves element (g) toward selection, and ADR 0030 D-5's verdict clause stands
(D-1). ADR 0030 R3's description-not-judgement rule binds every fit sentence.

### D-9 — Literature ranges: ADR 0030 D-6 is kept, explicitly

> **The decision.** ADR 0030 D-6 stands. A published range may appear on the Fit check section **only as
> prose with its citation in the same sentence**, and **never in, against or beside the rider's own
> number**. Spike 0020's Option R is **not adopted**.

**Why keep it**, answering ADR 0030 D-6 and spike 0008 in their own terms:

- ADR 0030 D-6's reason was that *"a range the rider is placed against is not a citation, it is a target"*.
  Fit makes that **more** true, not less: the rider's number now exists on the same screen, and a
  target beside it is a pass or a fail without the word.
- Spike 0008 §7: placing a rider against a published range is *"the closest this product could come
  to 'potential detection of pathologies' without naming one"*, which is MDCG 2019-11's own gloss
  on Rule 11a. In the EU, that is the margin to a class IIa example.
- Spike 0020 §2.1: a number placed against a range **leaks a direction** (*a knee above the range
  tells the rider which way the saddle would go*), with no sentence saying so. That is R4's refusal
  arrived at through layout.

**What "beside" means here**, so it can be checked. ⚠️ **The author's reading of ADR 0030 D-6**, confirmed
by the owner with this ADR: a range sentence is *beside* a rider's number if it is in the same
sentence, list item, table row, card or chart. A range sentence in **its own sub-section, after
all four readings, headed as what published sources say**, is not. Every range sentence:

- contains no rider value, no *"you"* or *"your"*, and none of D-8's direction or verdict words;
- names its source in the same sentence;
- is followed, in the same sub-section, by a closing sentence on the model of ADR 0030 D-6's
  example, which reads *"This app does not measure that, and the pictures below are not that
  measurement."* That wording no longer fits, because the app now does measure an angle. The
  closing sentence drafted here is *"This app does not compare a rider's angles with these
  ranges."* ⚠️ **Drafted by the author, not quoted from ADR 0030**, and it obeys the first bullet
  above: no *"you"* or *"your"*. It is the one fixed sentence of the sub-section that is **not** a
  range sentence, so #1066's walk over the range-sentence list does not include it; #1066 holds it
  to the first bullet by a test of its own.

**Which ranges** are a closed list in the wording module, each read first-hand from its source by
#1066 with the date it was read. **This ADR names none as decided.** ⚠️ ADR 0030 D-6's example,
*"around 140–145° at the bottom of the stroke (Holmes et al., 1994)"*, is an illustration and must
not be copied without reading the source: the author's recollection, **not verified here**, is that
Holmes et al. is usually cited for 25 to 35 degrees of knee **flexion**, which as the interior angle
D-3 defines is 145 to 155 degrees.

### D-10 — The model write-up (ADR 0035): it may read fit and give advice, and it may not restate an angle

> **The owner's ruling, 2026-10-04.** Asked about AI write-ups and bike components, the owner
> answered *"Allow advice too"*. **A model's write-up may name components, and may suggest
> equipment or position changes**, such as *"raise your saddle"* or *"a shorter crank may suit
> you"*. This is the only place in the product that advice may appear (D-7).

- **What a model is sent**: the fit check of **the ride the write-up is about**, and only that one,
  as angles (rounded as D-3 renders them), the reason for each one not measured, and the revolution
  count. No length, coordinate, picture, id or time (#1067, and P6 for the section's keys). No fit
  section, never zeros, when the ride has no fit check. ⚠️ **Advice changes nothing about the
  input**: no rider height, no segment length and no equipment data is sent, so a model has nothing
  to calibrate with (P2, P6), and that is what keeps (d), (f) and (h) absent from its advice (D-2).
- **The write-up screen's degree matchers are NOT narrowed.** [ADR 0035](0035-model-written-ride-write-ups.md)
  D-4 withholds a write-up containing a degree sign, *"deg"* after a number, or the word *"degree"*,
  and it still does. A model's write-up is **not** an angle surface (D-7). **It may not restate an
  absolute angle**, advice included: *"raise your saddle until your knee is at 150°"* is withheld.
  A model may write about the rider's fit in words. The angles themselves are on the section above
  it, from this program's own wording, with R8's caveat. ⚠️ **The author's choice**, and the
  narrower one. A model's restated angle would carry whatever caveat the model chose, or none, and
  R8 cannot be screened on free text.
- **ADR 0030 D-4 holds for write-ups**: nothing in the frontal plane, as advice or otherwise, and
  ADR 0035 D-4's frontal-plane screen is unchanged.
- **The component screen the draft planned for #1067 is removed.** The draft added a P8 that
  withheld every write-up naming a component, a size or a direction to move one. The owner's ruling
  withdraws it (D-2): a write-up that says *"raise your saddle 5 mm"* is now **shown**. #1067 does
  not build that screen, and its tests include a write-up giving equipment advice that passes. Its
  new template version also stops asking the model not to recommend a size, a component or a
  direction to move one, which ADR 0035 D-1's item 5 records as a request of the template, not a
  decision; the template's other asks (no angle, nothing side to side, no condition) stay.
- **What still binds advice in a write-up**:
  - **R6**: no clinical, professional or *"accurate to"* framing. Advice is a suggestion from a
    rough estimate, never *"what a fitter would set"*. ⚠️ **The author's choice**: now that advice
    is allowed, #1067 adds a screen that withholds a write-up containing *"clinical"*, *"medical"*,
    *"validated"*, *"accurate to"*, *"professional fit"* or *"professional bike fit"*, matched
    case-insensitively on word boundaries. *"Professional"* alone is not matched, because
    *"professional riders"* is ordinary ride prose.
  - **R8's rough-estimate caveat**: wherever a write-up's input carried a fit section or a pose
    summary, the app shows, in its own words beside the write-up, that anything it says about
    position rests on a rough estimate from one camera and is not a professional bike fit. The
    template (#1067) also asks the model to say so beside any advice; that half is a request.
  - **R5 and condition 3: no clinical or medical claim.** Advice may not name a condition, an
    injury or a symptom, or claim to prevent or relieve one (*"to stop your knee pain"*). The
    template asks it, and as ADR 0035 D-1 records for R5 on model text, that is a request, not a
    screen.
  - **R7's medical half**: no prompt to see a clinician, and no alert. A write-up is still read
    only when the rider opens the ride's page.
  - **P8 (e)**: no assessment of flexibility, mobility or range of motion. A write-up that names
    one is withheld whole, with or without a fit section, matched case-insensitively on word
    boundaries: *flexibility*, *flexible*, *inflexible*, *mobility*, *range of motion*, *tight
    hamstrings*, *tight hips*. ⚠️ **The author's choice**, as narrow as it can be while keeping (e)
    out of advice. #1067 may add to the list, never remove, and records each word it adds with the
    false withholds it measured on `model-answers-testing.ts`. The one-rewrite-then-withhold rule
    of ADR 0035 D-4 applies.
  - **ADR 0030 D-5's verdict clause, R3 and R9**: advice suggests a change, and does not call the
    rider's position correct, wrong, good, bad or optimal, or score it (D-1). That is a template
    instruction, not a screen.
- **What this does to ADR 0035.** ADR 0035 D-1 left ADR 0030 D-5 unscreened on model output and
  recorded that as an accepted risk (*"What is accepted and not narrowed"*). The owner's ruling turns
  the equipment half of that risk into a permission. ADR 0035 is **not** superseded: no ADR 0035
  decision changes, and the screens it built stand. The two screens this ADR adds (R6's words and
  P8's mobility words) narrow what ADR 0035 would have shown, which is not a reversal.
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
| 5 | *"do not include claims, functionality, or outputs that prompt or guide specific clinical action or medical management"* | **Holds while R7's medical half holds.** On the Fit check section: read only after the rider opens the ride's page; no alert; no verdict, no range comparison and no direction (D-7, D-8, D-9). In a write-up: equipment and position advice is allowed (D-10), and **is not *"specific clinical action or medical management"***, recorded below |
| 6 | *"do not include values that mimic those used clinically unless validated (e.g. manufacturer testing, peer-reviewed clinical literature) to reflect those values"* | ⚠️ **Breached on its face, and accepted.** A knee angle at bottom dead centre is a value used clinically, and nothing in this program validates one from a single uncalibrated phone. The peer-reviewed literature that exists puts markerless error at 6 to 10 degrees with **four** cameras |

> **The decision, the owner's.** Fit angles are shown although they may breach condition 6, and so
> may place the product outside the general-wellness carve-out. **The owner accepts that risk**, on
> 2026-10-03, in ruling 1 of the comment quoted in Context, *"accept the risk, framed"*, on the
> precedent of [ADR 0035](0035-model-written-ride-write-ups.md) D-1.

**Equipment and position advice under condition 5.** Condition 5, in full, is that the product's
features *"do not include claims, functionality, or outputs that prompt or guide specific clinical
action or medical management"*. Since the owner's ruling of 2026-10-04 a write-up may prompt an
action: *"raise your saddle"*, *"a shorter crank may suit you"*. **The author's reading, recorded
here: that action is not clinical and is not medical management.** It is a change to a bicycle,
which a rider makes in a garage, and it names no condition, symptom or treatment. It stays that
way only while the advice keeps clear of the clinical: no condition, injury or symptom (R5), no
claim to prevent or relieve one, no prompt to see a clinician (R7's medical half), and no
clinical, professional or *"accurate to"* framing (R6), as D-10 lists. ⚠️ **An unsigned engineer's
reading, not a regulatory opinion**: *"lower your saddle to ease your knee pain"* would be advice
toward managing a symptom, and it is R5, not condition 5's wording, that keeps it out. Question
R-1 below covers condition 6, and **R-5** asks this one.

This is option **(i)** of #1059's three. **(ii)**, narrowing the claim, is taken as far as it goes
without removing the numbers: four angles, one surface, rounded, caveated, no verdict, no range
comparison. **(iii)**, a validation route, is **not named**, because validation is a study somebody
runs and publishes, and nothing in this project's reach would be one.

**What the framing is**, so it is checkable: every number is *"about"* a value rounded to 5° (D-3);
every number's sentence says *"a rough estimate from one camera and not a professional bike fit"*
and gives the published error (D-8); and no number is placed against a target (D-9).

**The EU and UK, re-read in spike 0008.** Nothing there made ADR 0030 D-3 stricter or looser (§7), and the
wellness exclusion of MDCG 2019-11 still holds while the intended purpose is fitness (§4.1). What
fit changes is that spike 0008's Question A was asked about a product where *"no absolute value is
rendered"*, and that is no longer true. R5 remains the rule carrying the EU margin (§4.3), ADR 0030
D-5's equipment clause the second (§7) for everything the app itself writes, and ADR 0030 D-6 is
kept for spike 0008's reason (D-9). ⚠️ **For a model's write-up that second margin is gone** since
the owner's ruling of 2026-10-04: spike 0008 §7 found the musculoskeletal example turns on
*recommending* something to do, and a write-up may now recommend an equipment or position change,
so in a write-up R5 carries the EU margin alone. ⚠️ **And Article
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
  or anything about equipment (P2, P6), and no length, size, component or direction field (D-2's
  output property). A snapshot, if the rider presses for one, is ADR 0044's
  record, not this one's.
- **One fit check per ride.** A second check during the same ride replaces the first. ⚠️ **The
  author's choice**: it keeps *"the fit check of this ride"* a single thing on the page, in the
  export and in a model's input.
- **Exported** in the account export (#35), named in the manifest with its fields, as data (D-7).
  **Not** in any single-ride file export or shared copy.
- The store, the migration, the scoping and erasure tests and the fake are #1065's, under
  `CLAUDE.md` §5's round-trip harness.

### D-13 — What would make this ADR wrong

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
  the write-up screen needs a rule for write-ups that carry fit, which this ADR did not write.
- **A write-up's advice is argued to be (g) based on a calibrated model**, or to assess mobility.
  Since 2026-10-04 (g) is no longer an absence in write-ups, so every claim of the family is avoided
  only by (d), (e), (f), and in the US (h). A length, a height or a mobility word reaching a
  write-up's input or output would remove that last margin.
- **Advice drifts into the clinical**: a write-up that ties a change to a symptom or a condition.
  Then condition 5 and R5 are breached together, and the template's request has failed often
  enough to need a screen.
- **The FDA guidance is revised**, or spike 0008's documents are. Every quotation here is from
  ADR 0030's read of 2026-09-22 and spike 0008's.
- **One of spike 0006 §5's ten unread documents is closer than '571.** A fit report with absolute
  angles is closer to a conventional bike-fit tool than #377's design was, so the unread art matters
  more.
- **Anyone reads this as clearance.**

---

## Consequences

### What this enables

- **#1064 to #1067 can be written against rules rather than a taste**: each rule in D-2 is a test,
  D-7 names exactly what the gate is narrowed to, and D-8 gives #1066 its word lists.
- **The rider gets the thing ADR 0030 said riders come for, partly.** Four of their own angles, with
  the honest error beside each, on the Fit check section. **And, since the owner's ruling of
  2026-10-04, advice in a write-up**: a model may say *"raise your saddle"* or *"a shorter crank may
  suit you"*. The app itself still never says *"your saddle is 8 mm too low"*: on the Fit check
  section that sentence is refused by ADR 0030 D-5's equipment clause, R4 and P7.

### What this costs, stated plainly

- **Fit cannot ship yet.** At #1112's 0.3 pictures a second, no fit check can prove BDC sampled, and
  D-0 refuses to offer one. If #1112 fixes the rate to about 5 a second, a check needs a sweeping
  capture of about half a minute at best, and longer in practice.
- **The regulatory margin is the thinnest this project has accepted for app-written text.** ADR
  0035 accepted condition-6 risk for **a model's** words. This ADR accepts it for **the app's
  own** numbers, framed. Every other condition now rests on wording rules holding: one alert, one
  *"reduces the risk of"*, or one range placed beside a number would argue the product out of the
  carve-out it relies on.
- **The patent margin is thinner too, and thinner again since 2026-10-04.** The product now
  computes absolute body angles, closer to a conventional bike-fit tool than #377's difference
  report, and spike 0006 §5's ten documents are still unread. And **element (g) may now be present
  in write-up output** (D-2), so in the US the claims are avoided by (d), (e), (f) and (h) alone,
  and in Canada, where claim 1 has no (h), by (d), (e) and (f). The owner accepted that risk.
- **No verdict and no range comparison**, which is what a rider might expect a fit check to give.
  They read four numbers and some cited prose and decide for themselves.
- **The trunk needs a phone-side change** and a new link message, which an accepted ADR has to add
  to ADR 0033 D-3's list, and **no ADR owns that yet** (D-0). Until one does, the trunk is *"not
  measured"*.
- **A model may know the rider's fit and advise on it, and may not restate it.** A write-up that
  restates an angle, or assesses flexibility or mobility, is withheld, and the rider is told why,
  which some riders will find odd.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#1058](https://github.com/openzigs/onyourleft/issues/1058) (ADR 0044) | No angle on the live view (D-7). The capture transport whose rate D-0 measures, and D-0 item 4 (its Status reading *Accepted*). ADR 0044, merged on 2026-10-04, does **not** add the tilt message to ADR 0033 D-3's list and says so. By the owner's ruling of 2026-10-04, **one small ADR**, written separately, accepts ADR 0044 and adds the tilt message, discharging D-0 item 4 and the trunk precondition together |
| [#1060](https://github.com/openzigs/onyourleft/issues/1060) | D-8's caveat and D-9's range sentence in the published wording; whether the policy names the tilt (D-4) |
| [#1064](https://github.com/openzigs/onyourleft/issues/1064) | D-0's measurement and fixtures, D-3's event definitions, this ADR's D-5 tolerance, N and steadiness tests, no sensor join. ADR 0044 gives it the tilt message too, and it cannot add that to ADR 0033 D-3's list without an accepted ADR (D-0) |
| [#1065](https://github.com/openzigs/onyourleft/issues/1065) | P1 to P6, D-3's definitions and rounding, D-6's conditions, D-12's record (no taken-at time, one per ride) |
| [#1066](https://github.com/openzigs/onyourleft/issues/1066) | D-7 entire: a section, not a route; one wording module; `ANGLE_SURFACES` and the import-graph test; D-8 and D-9 |
| [#1067](https://github.com/openzigs/onyourleft/issues/1067) | D-10: the screen's degree and frontal-plane matchers unchanged; **no component screen** (the draft's P8 is withdrawn by the owner's ruling of 2026-10-04), with a test that a write-up giving equipment advice is shown; the template stops asking the model not to recommend equipment; P8's mobility screen and the R6 word screen added for every write-up, with or without a fit section; R8's caveat beside a write-up whose input carried a fit section or a pose summary |
| [#1112](https://github.com/openzigs/onyourleft/issues/1112) | Its fix is the first half of D-0 |

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
- **G. Equipment and position advice in a model's write-up**, allowed by the owner on 2026-10-04.
  (1) Is a write-up that says *"a shorter crank may suit you"* or *"raise your saddle"*, written by
  a model sent four rough, uncalibrated angles and no length, *"selecting … the sporting equipment
  based on the model"* under element **(g)** of US 12,499,571's claims 1, 10 and 17, and does it
  matter that this project neither trains nor chooses the model? (2) With (g) arguably present,
  how much weight do (d), (e), (f) and (h) bear, and does the doctrine of equivalents on any of
  them reach a pipeline that never computes a length? (3) **Against CA 3,183,442**, whose claim 1
  has no (h) and whose (g) reads *"based on the calibrated model"*: is advice from an uncalibrated
  model outside that wording, and how thin is the margin if (d) is ever argued? **Worth buying
  before advice ships**, because it is the margin the owner's ruling spent.

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
- **R-5. Equipment and position advice under condition 5.** Is a write-up that suggests a saddle,
  crank or position change, with no condition named, *"specific clinical action or medical
  management"* (D-11)? And under MDCG 2019-11, does recommending an equipment change from body
  angles move the product toward the musculoskeletal examples spike 0008 §7 names?
