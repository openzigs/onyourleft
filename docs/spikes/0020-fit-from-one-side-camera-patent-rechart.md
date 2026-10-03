# Spike 0020: US 12,499,571 re-charted against fit from one side camera

- **Date read**: **2026-10-03.** Claims 1, 10 and 17 of US 12,499,571 B2 were read again that day
  from the granted document on Google Patents (route A of
  [spike 0006](0006-camera-bike-fit-patent-read.md) §1.4, which worked again). The claims of the
  Canadian family member CA 3,183,442 A1 were read the same day, by the same route. Nothing quoted
  here comes from a marking page, an abstract or a search snippet
- **Issue**: [#1056](https://github.com/openzigs/onyourleft/issues/1056). Parent epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055). It brings
  [spike 0006](0006-camera-bike-fit-patent-read.md) §10 up to date and **does not edit spike 0006**
  (`CLAUDE.md` §7: a later run is a second write-up)
- **Rests on it**: ADR 0045, fit from one side camera
  ([#1059](https://github.com/openzigs/onyourleft/issues/1059)), which takes its patent section from
  §4 here
- **Status of this document**: a **spike write-up**. It measures and decides nothing. The owner
  ruled on 2026-10-03 to add fit now; this records what that ruling does to the claim chart, and
  which rules keep the chart where it is

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> It is the same disclaimer [ADR 0007](../adr/0007-patent-posture.md) D1,
> [spike 0005](0005-live-racing-patent-read.md) and [spike 0006](0006-camera-bike-fit-patent-read.md)
> carry, and it matters more here. This document again reaches a **favourable** reading, and this
> time it is about a design that **does more** than the one spike 0006 charted. One family was read
> by an engineer in an afternoon. No landscape search was run, and spike 0006 §5's ten unread
> documents are **still unread**. **Anyone citing this spike as clearance is misusing it.** §6 lists
> the questions worth paying a patent lawyer to answer.

---

## 1. What changed since spike 0006

### 1.1 The design being charted

Spike 0006 charted [#377](https://github.com/openzigs/onyourleft/issues/377): **differences only**,
no absolute angle (ADR 0030 D-3), no fit verdict (D-5). The owner's ruling of 2026-10-03, recorded
on [#1055](https://github.com/openzigs/onyourleft/issues/1055), supersedes **D-3 and D-5 to the
extent needed**. The design charted here is the one #1055 proposes. ADR 0045 may narrow it and may
not widen it.

| | |
|---|---|
| **Captured** | The tripod phone's pictures of the rider on a trainer, side-on, one camera, uncalibrated, no marker. The pose model runs on the tablet (ADR 0033 D-3) or, opted into, on the rider's own computer (ADR 0033 D-11) |
| **Computed** | **Absolute, scale-free sagittal angles** from image-plane joint coordinates: the **knee at bottom dead centre (BDC)**, the **hip**, the **trunk** and the **elbow**, each with a confidence. BDC is found from the body (#1064), because the pose model cannot see the crank |
| **Not computed** | No segment length and no ratio of lengths. No calibration factor of any kind: rider height is never asked for, and no marker or reference object is used. No mobility, flexibility or range-of-motion assessment. No equipment, size, component or position recommendation, and no direction to move one |
| **Maybe (ADR 0045 decides)** | **Option R**: a statement of where a number sits against a **published range** (ADR 0030 D-6 relaxed). **Option V**: a **fit verdict in words**, for example *"within the range fitters often use"* (D-5's verdict clause relaxed) |
| **Also new** | The rider's own model is sent the four angles and may write about them ([#1067](https://github.com/openzigs/onyourleft/issues/1067), ADR 0035) |

Spike 0006 §10 names two triggers that this design pulls. *"ADR 0030 D-5 is relaxed"*, which puts
element (g) in play. And element (c), which a skeleton-derived fit makes sharper. §2 and §3 take
them one at a time.

### 1.2 The claims, re-read 2026-10-03, and the family

**US 12,499,571 B2.** The claim text is unchanged from what spike 0006 quotes: 18 claims, with
independent claims **1, 10 and 17**. Claim 10 is claim 1 as a system. Claim 17 replaces element (h)
with *"dividing a dimension of a segment extracted from video or image pixels by the calibration
factor"*, and adds *"generating … the one or more models of sporting equipment"*. Bibliographic
data, as Google Patents shows it (not a legal reading): application US 18/075,800, filed 2022-12-06,
priority US 63/286,341 of 2021-12-06. Published as US 2023/0177718 A1. Granted 2025-12-16. Status
"Active", adjusted expiration 2043-11-25. The last US legal event listed is **2025-12-03 STCF
"PATENTED CASE"**.

**⚠️ CA 3,183,442 A1. Spike 0006 did not record this family member, and it matters.** The '571 page's
"Also Published As" list names it, and an assignee search for MyVeloFit returns the US grant and,
by keyword, this application. Google Patents lists it as **Pending**, a Canadian application filed
2022-12-06 with the same priority, published 2023-06-06, and with maintenance fees paid on
2024-11-27 and 2025-11-28. Its **independent claims are 1 (method) and 12 (system)**, and they
differ from the US grant in the one place spike 0006 drew most comfort from:

> *"selecting, at the processor, the sporting equipment based on the **calibrated model** from one
> or more models of sporting equipment."*
>
> CA 3,183,442 A1 claim 1, as published. The claim ends there.

**There is no element (h) in Canadian claim 1.** The two calibration formulae are its *dependent*
claims 4 and 5 (and 15 and 16). Spike 0006 §2.1 called (h) *"the single largest gap between the
marking page … and what was actually granted"*. That gap is a fact about the **US grant**, and the
Canadian application, as published, does not have it. Pending claims can change during
examination, so nothing here says what Canada will grant. This app is distributed through Google
Play, so it can reach Canadian riders. Spike 0006 §1.5's *"no non-US right"* gap is now a specific
document, not a general one.

### 1.3 Is there a published continuation? Read 2026-10-03

**None was found.** This was checked from the same public source spike 0006 used:

- The '571 page lists **one** priority application and **two** publications (the A1 and the B2),
  with US 18/075,800 as the **only** family application listed. "Also Published As" names only
  US 2023/0177718 A1 and CA 3,183,442 A1.
- `patents.google.com/xhr/query?url=assignee=Myvelofit` returns **one** result, US 12,499,571 B2.
  Its family metadata names two countries, **US: ACTIVE** and **CA: ACTIVE**.
- An inventor query on the exact name *"William Jesse Carim Jarjour"* returns only US 12,499,571 B2.
  A query on *"sporting equipment" "calibration factor" mobility* with a priority after 2021 returns
  only CA 3,183,442 A1.

⚠️ **This is not clearance, and the absence is weak evidence.** A continuation that claims this
family's priority could have been filed before the 2025-12-16 grant and **not yet be published**,
and Google Patents indexes publications rather than filings. The USPTO's own Patent Center file
wrapper was not consulted. §6 Question B is still the way to settle it.

---

## 2. The claim chart against the fit design

Elements are lettered as in spike 0006 §2. Claims 1 and 10 are charted together, and claim 17 is
covered by §2.3. **The CA column** is the pending Canadian claim 1, which has elements (a)–(g) with
the same wording except that (g) reads *"based on the calibrated model"*, and which has no (h).

| # | Element, quoted only as far as the analysis needs | Fit design | US 1 / 10 | CA 1 / 12 (pending) | Constraint that holds an OUTSIDE, and its independent (non-patent) reason |
|---|---|---|---|---|---|
| **a** | *"receiving … from a camera video or image data of a user comprising a series of movements"* | The side camera's pictures of a pedalling rider | **INSIDE** | **INSIDE** | — |
| **b** | *"detecting … coordinates of a plurality of joints of the user"* | Markerless pose, the same as before | **INSIDE** | **INSIDE** | — |
| **c** | *"generating … a model of the user comprising body segments lengths … respecting relative proportions"* | Angles from joint directions only, and never a length (§3). ⚠️ But **shipped code already computes segment lengths and their ratios** (§3.2) | **UNCERTAIN, treat as inside** | **UNCERTAIN, treat as inside** | An angle needs no length. That makes the literal argument stronger and leaves the equivalence question open (§3) |
| **d** | *"generating … calibrated body segments lengths … using a calibration factor"* | **Nothing.** No height, no marker, no reference object, and no metric scale from any source, including the pose model's own (§3.3) | **OUTSIDE** | **OUTSIDE** | **Rule P2.** Independent reason: ADR 0030 D-3 reason one, *"nothing here could have measured it"*. A centimetre from one uncalibrated phone would be precision the device does not have, and R8 requires the uncertainty to be stated anyway. A scale-free angle **does not need** a scale, so none is introduced |
| **e** | *"assessing … mobility of the user based on the video or image data"* | **Nothing.** Each angle is reported at a named event (BDC, or a stated crank phase), never as the reach or range of a joint | **OUTSIDE** | **OUTSIDE** | **Rule P5.** Independent reason: ADR 0030 D-2's table. A flexibility or mobility judgement is a claim about the body that R5 and R6 refuse, and that spike 0008 §7 calls the *"potential detection of pathologies"* a regulator reads for. ⚠️ It becomes **uncertain** if a range of motion over the stroke is ever reported (§2.2) |
| **f** | *"generating … a calibrated model of the user using the calibrated segments lengths"* | **Nothing.** It follows from (d) | **OUTSIDE** | **OUTSIDE** | As (d) |
| **g** | *"selecting … the sporting equipment based on the model from one or more models of sporting equipment"* | **No equipment data of any kind**, and nothing is selected. Options R and V are charted in §2.1 | **OUTSIDE** under both options | **OUTSIDE** under both options | **Rules P6–P8.** Independent reason: the standing half of ADR 0030 D-5 and R4 (no size, component or direction to move one), which ADR 0030's 2026-09 amendment ties to the FDA general-wellness condition 5, *"outputs that prompt or guide specific … action"*. Spike 0008 §7 gives a third, EU reason |
| **h** | *"wherein the calibration factor is chosen from the group consisting of"* the height formula and the marker formula | **Nothing.** Neither height nor a marker | **OUTSIDE** | **not in the claim** | As (d). ⚠️ In Canada this row gives **no** extra margin: (d) has to hold by itself |

**On both claim sets the fit design is outside on (d), (e), (f) and (g)**, the same four as spike
0006. In the US it is also outside on (h). Each of the four rests on a reason that a contributor will
meet before reading this document, which is ADR 0007 D2's test. **What the owner's ruling cost is
margin, not an element.** D-5's verdict clause was one of the independent reasons for (g), and it is
gone. What still holds (g) is the half of D-5 that the ruling left standing.

### 2.1 Element (g) under the two optional features

Spike 0006 Question A asked whether *"showing a rider a difference and letting them decide"* is
equivalent to *selecting the sporting equipment*. The fit design no longer shows only a difference.

| | Option R: where a number sits against a published range | Option V: a fit verdict in words |
|---|---|---|
| **Is anything selected?** | No. One number is placed against one cited figure | No. One sentence characterises a position |
| **Is there "one or more models of sporting equipment"?** | No. A literature range describes riders, not equipment | No |
| **Literal verdict on (g)** | **OUTSIDE** | **OUTSIDE** |
| **Does it move toward "showing a difference and letting them decide"?** | **Yes, and it stays on that side.** It shows the rider a measurement and a reference and leaves the decision to them. It is Question A's case with a reference point added | **It moves past it.** A verdict is the evaluation that a selection is made from. It decides *for* the rider whether the current position is acceptable, which is the step before choosing equipment |
| **What it leaks** | **A direction.** A knee number above a published range tells the rider which way the saddle would move, with no sentence saying so | **A direction, if the verdict is signed** (*"above the range"*, *"too open"*). An unsigned verdict (*"within"* / *"not within"*) leaks less than Option R does |
| **Engineer's reading** | The safer of the two on (g). Its risk is regulatory (ADR 0030 D-6's *"a range the rider is placed against is … a target"*), not this claim | Closer to (g) than Option R, though still outside on the claim's words. Claim 9, *"displaying … a resulting fit of the sporting equipment"*, is written as **a step added after** selecting, which suggests the claim treats a fit display and a selection as different steps. Whether that helps is §6 Question D, and an engineer should not rely on it |

**Answer to the acceptance criterion.** Neither option is *"selecting … from one or more models of
sporting equipment"* on the words of the claim. **Option R** is the one that keeps the design on the
*"show the rider and let them decide"* side of Question A. **Option V** is the one that moves (g)
toward selection, and a **signed** verdict moves it furthest, because *"above the range"* plus
*"knee at BDC"* is one inference away from *"lower your saddle"*. That last step is what R4 refuses.
Rule P7 says what keeps Option V outside if ADR 0045 adopts it.

⚠️ **The rider's model is the third surface, and it is the likeliest one to cross the line.**
[#1067](https://github.com/openzigs/onyourleft/issues/1067) sends the four angles to a general
language model. Ask a general model about a knee angle at BDC and it will usually suggest a saddle
change, often with millimetres. That sentence would be shown by this program. Rule P8 makes the
write-up screen, not the prompt, the thing that withholds it, because ADR 0029 D-8 treats model
output as untrusted input.

### 2.2 Element (e), and the one way the fit design could reach it

The four measurements are angles at events. The **hip** is the one to watch. #1055 says "hip" and
does not name a crank position. The way fitters usually quote it is the most closed hip angle over
the stroke, which is a joint's extreme of motion. Reporting it is still not *"assessing mobility"*
on the claim's words, because nothing is said about what the rider can reach. But **a range over
the stroke** (a maximum minus a minimum), **a category** (*"tight"*, *"flexible"*), or **a
comparison against what a body should manage** would be. Rule P5 forbids all three. ADR 0045 should
define the hip angle at a stated crank event (BDC, or top dead centre found the way #1064 finds BDC)
rather than as a minimum. That keeps it an observation of a position, not of a capacity.

### 2.3 Claim 17

Claim 17 still recites (c), (d), (e), (f) and (g), and adds *"generating … the one or more models
of sporting equipment"*. That is a fifth absent element, under Rule P6. Its calibration step is
*"dividing a dimension of a segment extracted from video or image pixels by the calibration
factor"*, which Rules P2 and P3 keep out. **Outside on the same elements, plus one.**

---

## 3. Element (c): an angle-only pipeline

### 3.1 Does computing angles and never a length strengthen the argument?

**Yes, on the literal reading, and only if it is done in a particular way.** The claim requires
*generating a model comprising body segments lengths … respecting relative proportions*. A joint
angle can be computed from two direction vectors with `atan2(cross, dot)`, and then **no length is
ever computed, even as an intermediate**. The angle depends on the two segments' directions and on
nothing else. A pipeline built that way does not generate a segment length. That is a better
argument than spike 0006 §2.3's fallback: there the lengths existed and were not *used*. Here they
are never *generated*.

**It is weaker than it looks in two ways**, and both are why (c) stays *uncertain*:

- **The common formula computes lengths.** `acos(dot / (|a| |b|))` divides by the two segment
  lengths. The angle is the same, but the lengths are generated on the way. The shipped
  `side-report.ts` §`jointAngle` is written that way today. Rule P4 says how to build the fit path
  instead, and how a test can tell the difference.
- **Scale-free is not length-free.** #1065's first acceptance criterion multiplies every landmark
  by k and asserts nothing changes. That proves **no absolute scale** enters, which is (d), (f) and
  (h). It does **not** prove no length enters: a **ratio of lengths** such as thigh over shin also
  survives multiplication by k. A test that sees only k would pass a pipeline that reports a ratio.
  Rule P3 is the second test.

### 3.2 ⚠️ Shipped code already generates segment lengths respecting relative proportions

Found while preparing this chart, and recorded because it changes how far §3.1 can be leaned on.
`main` at 2026-10-03:

- **`apps/web/src/camera/pose-plausibility.ts` §`implausibility`** (#761) computes the pixel lengths
  of the trunk, the thigh and the shin with `Math.hypot`. It refuses a pose whose `thigh / shin` or
  `trunk / thigh` falls outside `LIMB_RATIO_BOUNDS`, and its refusal is named `'out-of-proportion'`.
  That is, close to word for word, *"body segments lengths … respecting relative proportions"*. It
  runs on poses from the rider's own computer, as a guard against a hallucinated figure.
- **`apps/web/src/camera/side-report.ts` §`saddleOf`** reports the hip's horizontal offset as *"a
  share of the thigh's length"*. That divides a pixel distance by a body-segment length: a scale
  taken from the body. It is not a calibration factor in claim 1's sense, because it uses no height
  in centimetres and no marker, so it gives no calibrated length. But it is the shape claim 17's
  *"dividing a dimension … by"* step has. The pending Canadian claim, which has no Markush group, is
  where that shape would be argued about.
- **`side-report.ts` §`jointAngle`** computes `Math.hypot` of both segments and takes `acos`.

**None of this puts the product inside the claim.** (d), (e), (f) and (g) are still absent, and
every claim needs every element. What it means is that **the product as a whole already does (c) on
a literal reading, whatever the fit path does.** The angle-only argument is about the fit
pipeline, not about the app. If ADR 0045 wants that argument to cover the app, it has to decide
whether to rework those three functions to directions and orderings only. That is a design decision
with a cost: the plausibility check's proportion rule is a real defence against a fabricated pose
(#761). This spike flags it and does not decide it.

### 3.3 A metric scale from the pose model itself

MediaPipe's Pose Landmarker returns two coordinate sets. One is image-plane `landmarks`, which
`pose-worker.ts` reads. The other is `worldLandmarks`, and the pinned `@mediapipe/tasks-vision`
1.0.1's own declaration says of it: *"The landmark coordinates are in meters."* A metric
reconstruction from one picture can only come from a learned prior about human size. That is a
calibration with no height and no marker, which is outside the US Markush group (h) on its face,
and **exactly the open question** under the Canadian claim, which has no (h). Today nothing reads
`worldLandmarks`. Rule P2 keeps it that way for the fit path.

### 3.4 The doctrine-of-equivalents question an engineer cannot weigh

> If a pipeline computes joint angles from the **directions** of image-plane segments, and never
> computes, stores or reports a length, does it perform a function substantially the same as
> *"generating … a model of the user comprising body segments lengths … respecting relative
> proportions"*, in substantially the same way, with substantially the same result? Does the answer
> change because the same product also computes pixel segment lengths and checks their ratios for
> another purpose (§3.2)?

This is §6 Question A′. It matters less than it might, because (c) alone decides nothing while (d)
to (g) are absent. It decides **how much margin** is left if one of (d) to (g) is ever argued to be
present.

---

## 4. Design-around constraints ADR 0045 must carry as rules

Each is phrased so a test, a type or a source scan can check it. "Fit path" means everything from
a pose to a stored or rendered fit number, a fit field in a model's input, and the write-up screen.
The element each rule holds is in brackets.

| Rule | Statement, checkable | How it is checked |
|---|---|---|
| **P1** (d, f, h) | **Multiplying every image-plane landmark coordinate by any k > 0, and adding any offset, leaves every reported fit number unchanged.** The only scale applied is the picture's own aspect ratio, which turns normalised coordinates into square pixels | Property test over k ∈ {0.25, 1, 4, 17} and random offsets ([#1065](https://github.com/openzigs/onyourleft/issues/1065)'s criterion). Mutation: divide by the frame height, or by any segment length |
| **P2** (d, f, h) | **No input to the fit path carries a physical unit of length.** The computation's input type is poses only. Rider height, mass and the athlete row are not inputs, nothing in the fit path imports from `src/athlete/`, and the pose model's `worldLandmarks` (metres) are never read | A test asserts the input type's keys. A source scan finds no `worldLandmarks` in `apps/web/src`. A test asserts the fit module's import list |
| **P3** (c) | **Each reported angle is unchanged when either end landmark is moved along the ray from the joint the angle is measured at, by independent factors.** The number depends on segment directions only, never on a length or a ratio of lengths | Property test that slides the two end landmarks of each angle along their rays by different factors. Mutation: report a ratio of lengths, or weight by a length. P1 cannot catch either, and P3 does |
| **P4** (c) | **No segment length is computed in the fit path, even as an intermediate.** Angles are taken with `atan2(cross, dot)`, never with `acos` over a product of norms | A source scan of the fit module(s) for `Math.hypot`, `Math.sqrt` and `acos`, the way `no-absolute-angles.test.ts` scans for degree signs |
| **P5** (e) | **Every angle is reported at a named crank event** (BDC, or a stated phase found from the body), **never as a minimum, maximum or range over the stroke**, and no output names a flexibility, mobility or range-of-motion category | The output type has one value per angle at a named event, and a test asserts its keys. The wording falls under ADR 0030 D-2 R5 and R6 |
| **P6** (g, claim 17) | **No data about equipment exists in the fit path.** No frame size, stack, reach, saddle height, stem, crank length, component or catalogue, either as a table, a type field or a model input | A test asserts the keys of every fit type and of the model's fit section ([#1067](https://github.com/openzigs/onyourleft/issues/1067)). A source scan of the fit modules for those words |
| **P7** (g) | **No fit output names a component, a size, or a direction to move either.** If Option V is adopted, the verdict is **unsigned**: *"within"* or *"not within"* a cited range, and never *"above"*, *"below"*, *"too open"*, *"too closed"*, *"high"* or *"low"* | A closed list of every fit sentence, each in one module (the shape `side-report-wording.ts` has), with a test over the list for direction and component words |
| **P8** (g) | **A model's write-up that names a component, a size, or a direction to move one is withheld whole** by the write-up screen, whatever the prompt said | `write-up-screen.test.ts` cases built with `model-answers-testing.ts` (#1067's criterion). Mutation: redact instead of withhold |

**P1 and P3 together** are the claim that matters: the numbers depend on segment directions alone.
One without the other is a vacuous pass, and #1065 as written has only P1.

---

## 5. What was read and how to reproduce it

| What | Where | Result, 2026-10-03 |
|---|---|---|
| US 12,499,571 B2 claims and bibliographic data | `patents.google.com/patent/US12499571B2/en`, with spike 0006 §1.4 route A's command | HTTP 200, 175 215 bytes. 18 claims. Independent 1, 10, 17, unchanged. Family: US 18/075,800 only. Also published as US 2023/0177718 A1 and CA 3,183,442 A1 |
| CA 3,183,442 A1 claims and status | `patents.google.com/patent/CA3183442A1/en`, same command | HTTP 200. 20 claims. Independent 1 and 12, with no Markush group. Pending. Maintenance fees 2024-11-27 and 2025-11-28 |
| Assignee search | `patents.google.com/xhr/query?url=assignee%3DMyvelofit` | One result, US 12,499,571 B2. Family countries US and CA |
| Inventor search | `…/xhr/query?url=inventor%3D%22William+Jesse+Carim+Jarjour%22` | One result, US 12,499,571 B2 |
| Keyword search | `…/xhr/query?url=q%3D%22sporting+equipment%22%26q%3D%22calibration+factor%22%26q%3Dmobility%26after%3Dpriority%3A20210101` | One result, CA 3,183,442 A1 |
| `worldLandmarks` units | `node_modules/.pnpm/@mediapipe+tasks-vision@1.0.1/…/vision.d.ts`, interface `Landmark` | *"The landmark coordinates are in meters."* The public Pose Landmarker guide page, read the same day, does not state the unit |

⚠️ Spike 0006 §1.4 warned that route A goes silent under a rate limit (HTTP 503 and an empty
`claims` match). Each fetch above was checked for HTTP 200 and a non-empty claims section before
anything was read from it. **Not consulted**: the USPTO Patent Center file wrapper, CIPO's own
database, and any specification. §5 of spike 0006 is still unread.

---

## 6. Questions for a patent lawyer

These are worth paying for **if the design moves**. They are not worth paying for as a reassurance.
The shape follows spike 0006 §6, and none of them is *"are we safe"*.

**Question A′: a claim chart of US 12,499,571 claims 1, 10 and 17 against §1.1's fit design.** The
engineering claim to test is the same as before: (d), (e), (f) and (g) are absent, and (h) is a
closed group of two formulae. Under the fit design, add:

1. The doctrine of equivalents on **(c)** for an angle-only pipeline that never computes a length
   (§3.4), **given** that the same product computes pixel segment lengths and checks their
   proportions elsewhere (§3.2).
2. The doctrine of equivalents on **(g)**: is placing one of the rider's angles against a published
   range (Option R), with no equipment named, equivalent to *"selecting the sporting equipment based
   on the model from one or more models of sporting equipment"*?

**Worth buying when** ADR 0045 adopts Option R, or when anyone proposes reporting a length, a ratio
or a range of motion.

**Question B′: the file wrappers.** Does US 18/075,800 have a continuation or a divisional, filed or
pending, and does the specification support claims without the calibration factor or the selection
step? **And CA 3,183,442: what is its prosecution status, and what claims are likely to be granted?**
It is a pending right whose claim 1 has no Markush group (§1.2), in a market this app ships to. It
is bundled with A′ and costs the same afternoon. **Worth buying now**, because it is the one question
whose answer can change without this project doing anything.

**Question D (new): a verdict in words.** Is a statement such as *"within the range fitters often
use"* (Option V) about the rider's position on their own bicycle a *selecting* of the sporting
equipment, or its equivalent? Does it matter whether the verdict is signed (*"above the range"*), or
whether a model, rather than this program's own fixed wording, writes it? Does claim 9's
*"displaying … a resulting fit"*, written as a step after selecting, help or hurt? **Worth buying
when** ADR 0045 adopts Option V.

**Question E (new): a learned metric scale.** Under the **Canadian** claim 1, which has no Markush
group, would using a pose model's metric reconstruction (for example MediaPipe's `worldLandmarks`)
to produce body-segment lengths in metres be *"generating calibrated body segments lengths … using a
calibration factor"*? Does dividing a pixel distance by a body segment's pixel length
(`side-report.ts` §`saddleOf`) come close to it? **Worth buying when** anyone proposes a length in
real units, or when Question B′ finds the Canadian claim will grant as published.

**Question C (spike 0006's): publication.** It is unchanged, and sharper: this document records a
second dated reading of the same patent, and of the family's Canadian member.

**Not being asked**: validity, because this project will not fund a challenge. Anything about the
four neighbours in spike 0006 §3 and §4, because the fit design changes none of the limitations they
were outside on (markers, a stereo pair, an adjustable stationary bicycle).

---

## 7. What would make this spike wrong

- **A continuation issues, or the Canadian claim grants as published.** §1.3 found no continuation
  on public pages on one day, and an unpublished filing would not show there. The Canadian claim
  already has no (h). A continuation that also drops (d), or the selection step, would make §2 a
  chart of the wrong claims, and nothing in this repository would notice.
- **Element (c) is read broadly.** If a pose skeleton's implicit distances, or the product's own
  proportion check (§3.2), are found to be *"body segments lengths … respecting relative
  proportions"*, the chart still has four elements outside. But the margin narrows, and Question A′
  becomes worth buying rather than worth asking.
- **Option V, or a signed verdict, is read as selecting.** Then (g) depends only on the absence of
  equipment models (Rule P6), and the next request for *"which saddle height"* has nothing left
  between it and the claim.
- **A rule in §4 lands without its test, or #1065 lands with P1 and without P3.** A scale-free
  pipeline that reports a ratio of lengths passes P1 and is the design (c) is about.
- **The rider's model says it anyway.** If the write-up screen (Rule P8) is weaker than the prompt,
  the app shows a model's *"raise your saddle 5 mm"*. That is R4's refusal broken by somebody else's
  text, and it moves (g) more than either option does.
- **Anything reads `worldLandmarks`, a height or a marker.** Then (d) is a question, not an absence.
  In Canada there is no Markush group behind it.
- **One of spike 0006 §5's ten unread documents is closer than '571.** They are still unread. A fit
  report with absolute angles is closer to a conventional bike-fit tool than #377's difference
  report was, so the unread art is more likely to matter than when spike 0006 listed it.
- **Anyone reads this as clearance.** It is one family, read by an engineer, on one day.
