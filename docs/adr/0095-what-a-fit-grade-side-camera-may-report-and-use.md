# ADR 0095: What a fit-grade side camera may report and use — 1° once measured, a published range beside a reading, the knee's maximum extension, a hosted model on the rider's key, and never a marker

- **Status**: **Accepted**, 2026-11-22, on the owner's answers to the five questions of
  [#3034](https://github.com/openzigs/onyourleft/issues/3034), given that day one question at a time
  and quoted verbatim in Context, and on the owner's lane note of the same day, which asked for this
  ADR to record them as Accepted and to put no new question to the owner unless something is
  genuinely open. One point is open in that sense, and D-8 says which and why it is **not decided
  here**
- **Date**: 2026-11-22
- **Deciders**: **the owner**, on Q1 to Q5 of #3034 and on the lane note. The author wrote the
  wording and decided the engineering content the answers do not settle. Each such point is marked
  *the author's choice* where it is made, and each takes the narrower option
- **Issue**: [#3034](https://github.com/openzigs/onyourleft/issues/3034), area side camera (epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055)); it rests on the research pass of
  2026-11-22 that also filed [#3027](https://github.com/openzigs/onyourleft/issues/3027) (accuracy
  against ground truth on a real rider) and [#3033](https://github.com/openzigs/onyourleft/issues/3033)
  (the fit-grade capture spike)
- **Number**: **0095**. On 2026-11-22 `main` (`e6fa32d41`) holds ADRs up to 0094, and
  `docs/agents/conventions.md` §7 gives 0095 as the next free number. No open pull request adds a
  `docs/adr/0095-…` file and no open issue but #3034 names 0095 (checked that day), and the lane note
  on #3034 names it
- **Numbering in this ADR**: a bare *D-n* is **this ADR's** decision. Another ADR's is always written
  with its number (*ADR 0045 D-9*), because ADR 0030, ADR 0045, ADR 0050 and this ADR all have a D-1
  to a D-9 about different things
- **Supersedes**, in part, each **to the extent D-1 names and no further**:
  - [ADR 0045](0045-fit-from-one-side-camera.md) **D-3**'s *"Each rendered value is rounded to the
    nearest 5°"* (conditionally, D-2), **D-9** (a published range kept away from the rider's number,
    D-3 here), **D-2 rule P5** (an angle only at a named crank event, for one value: D-4 here), and
    **D-5**'s bullet *"The model stays in the worker"* (D-6 here); with them the parts of ADR 0045
    D-1, D-8 and D-11 that restate those four, which D-1 lists
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-6** and **R10**, for the Fit check
    section only (D-3 here). **R5 and R6 stand**, and so does every other rule of ADR 0030
  - [ADR 0050](0050-side-camera-pictures-to-the-riders-instance-sealed.md) **D-1** (one path, for
    the side analysis only), **D-5**'s *"What the service is sent, in full"* (one fixed question)
    and **D-7** (two consents), to admit a fit check's pictures on the same path (D-7 here)

  Each of the three gains one dated `## Amendments` entry pointing here, in this pull request
  ([ADR 0013](0013-adr-amendments.md)). No body and no `Status` line is edited
- **Leaves standing**, named so none of it is read as touched: ADR 0045 **D-0** (no fit check ships
  until a sufficient picture rate is measured), **D-2 P1 to P4, P6 to P8** and the output property,
  **D-5**'s rule (BDC proven sampled) and its *"Cadence comes from the pose stream, never from a
  sensor"*, **D-6**, **D-7** (one surface), **D-8**'s caveat, R6 rules and word lists (*within*,
  *outside*, *above* and *below* included), **D-10** (the write-up), **D-12** (no picture stored)
  and **D-13**; ADR 0030 **D-1** to **D-5**, **D-7**, **D-8** and **R1 to R9** as amended, **R5**
  and **R6** in particular, and **D-4** (nothing frontal-plane); ADR 0050 **D-2** (sealed or not
  sent), **D-3**, **D-4** (never stored), **D-6**, **D-8** (stripping), **D-9** (the allowance and
  one at a time) and **D-10**; [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) **D-3**
  and **D-4** (D-8 here); [ADR 0033](0033-side-camera-link.md) **D-3** and **D-6**;
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) **D-3**;
  [ADR 0052](0052-the-phones-tilt-on-the-side-camera-link-and-adr-0044-accepted.md)
- **Relates to**: [ADR 0007](0007-patent-posture.md), [ADR 0013](0013-adr-amendments.md),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0035](0035-model-written-ride-write-ups.md),
  [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md),
  [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md),
  [spike 0008](../spikes/0008-eu-uk-medical-device-read.md),
  [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md),
  [#1064](https://github.com/openzigs/onyourleft/issues/1064) to
  [#1067](https://github.com/openzigs/onyourleft/issues/1067)

> ## ⚠️ This is not legal advice, not a regulatory opinion, and not a freedom-to-operate opinion
>
> ADR 0030, ADR 0045 and spike 0020 say it of themselves, and it matters more here: this ADR records
> that **the owner accepts a patent risk** spike 0020 charted, and two of its decisions narrow
> margins ADR 0045 kept. §"Questions for counsel" names what a lawyer would be paid to answer.
> **Anyone citing this document as clearance is misusing it.**

---

## Context

### The questions, as #3034 put them

#3034 came from the research pass of 2026-11-22 that asked what it would take for one side camera
to give a fit-grade result. It found that several parts of the best-evidenced fit pipeline conflict
with ADR 0045 as accepted, and put five questions to the owner (one also to counsel):

1. **Finer than 5°.** ADR 0045 D-3 rounds a value to 5°, which hides a ±2–3° result. Allow 1° if the
   validation study passes?
2. **Ranges beside the number.** ADR 0045 D-9 allows no range beside the rider's number and no
   verdict. Show *"published sources give 25–35° static, about 33–43° while pedalling"* beside it?
   Dynamic and static ranges must never be mixed (dynamic reads about 8° more). Patent-sensitive:
   range comparison is one of the elements spike 0020 charted.
3. **Stickers on hip, knee and ankle**, the only setup with published 2–3° agreement. ADR 0045 D-13
   records that anything reading a marker makes claim element (d) of US 12,499,571 *"a question, not
   an absence"*. For counsel before any decision.
4. **A hosted model for fit**, via OpenRouter rather than a local model. ADR 0050 D-9 caps the
   instance path at about one picture a second and ADR 0045 D-12 keeps pictures out of storage.
5. **Maximum knee extension.** ADR 0045 P5 allows only named crank events. Keep that?

And it listed what is **fixed whatever the answers**: no *"professional fit"*, *"validated"* or
*"accurate to"* wording (ADR 0030 R6); no injury-prevention claim (R5); no frontal-plane output (ADR
0030 D-4); and cadence from the BLE sensor stays out (ADR 0045 D-5), which loses nothing, because a
cadence sensor gives one event per turn at an arbitrary crank position rather than at BDC.

### The owner's answers, verbatim

[#3034, comment of 2026-11-22](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082813874),
*"asked one question at a time in the session"*:

> 1. **Rounding:** report to **1° only once the accuracy test (#3027) passes** (±3° 95 % limits of
>    agreement); 5° until then. *(recommended)*
> 2. **Ranges beside the number:** **show published ranges now.** The owner accepts the patent risk
>    spike 0020 charted for range comparison. Fixed rule that still holds: a dynamic reading is only
>    ever shown beside a dynamic range (about 33–43° flexion at BDC while pedalling), never the
>    static 25–35° goniometer range, and with no verdict wording (ADR 0030 R5/R6).
> 3. **Stickers:** **no stickers, ever.** The fit check is markerless only; #3033's arms stay
>    markerless.
> 4. **Hosted model:** **allowed, opt-in, on the rider's own key** (OpenRouter Qwen3-VL first,
>    DeepSeek flash second), with ADR 0050 widened to fit frames and the privacy policy updated:
>    pictures of a body at home go to the chosen provider. The local pose model on the instance stays
>    the default.
> 5. **Maximum knee extension:** **also allowed**, beside knee at BDC (supersedes ADR 0045 P5).

The owner's earlier note on Q4, [same day](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082665142),
names the hosted model `qwen/qwen3-vl-235b-a22b-instruct` on OpenRouter (*"about one US cent per fit
at ~40 frames"*), DeepSeek flash second, and says #3033 expects a dedicated pose model (RTMPose-m) to
run locally on the instance, so that the hosted path may not be needed at all. ⚠️ **The price and
the model's abilities are the owner's note, not verified here.**

The lane note, [same day](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082880979), verbatim in its
operative part:

> write the superseding ADR only (next free number 0095), recording the owner's five answers above as
> **Accepted** (the owner has answered; no new owner questions unless something is genuinely open).
> Supersede in part ADR 0045 (5° rounding conditional on #3027, D-9 ranges, P5 maximum extension,
> markers stay excluded) and ADR 0050 (fit frames to an opt-in hosted provider on the rider's key,
> OpenRouter added as a provider), and touch ADR 0030 only where the range wording needs it — R5/R6
> stand. […] State that the privacy policy change and the OpenRouter provider are implementation
> issues to file after merge. No code.

### What exists today (read at `main` `e6fa32d41`)

**No fit check is built.** There is no `FitCheckSection.tsx`, no `fit-report-wording.ts` and no fit
computation under `apps/` or `packages/`; ADR 0045 D-0's capture-rate gate has not been met
([#1112](https://github.com/openzigs/onyourleft/issues/1112)'s 0.3 pictures a second is the last
figure recorded). So nothing in this ADR changes shipped behaviour, and every decision below binds
#1064 to #1067 and the issues D-10 names when they are built.

**What is built is ADR 0050's path**: the side analysis's pictures, sealed, to the rider's instance
(`apps/web/src/camera/instance-pose.ts`), shown there to the operator's local picture model or to a
hosted model on the rider's own key through one builder (`apps/instance/src/camera/hosted-pictures.ts`),
with one fixed question (`SIDE_POSE_QUESTION`) and nothing else, never stored.

### One conflict the answers did not name

The lane note asks for *"OpenRouter added as a provider"*. [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md)
**D-4** permits the rider's own key only because *"this client ships no vendor name, no vendor list,
no default endpoint and no vendor-specific request shaping"*, and its **D-3** admits code that
reaches a specific hosted model by name only with an ADR recording that vendor's terms, read on a
date. Neither was among the decisions the owner named for supersession. D-8 says how this ADR reads
the instruction inside them, and what is left for the owner.

---

## Decision

Ten decisions. **D-1** is the supersession table. **D-2** to **D-5** are the owner's five answers
about what is reported and how it is captured. **D-6** and **D-7** are where the pose is computed
and how a fit check's pictures travel. **D-8** is OpenRouter. **D-9** restates what is fixed, and
**D-10** what follows.

### D-1 — What is superseded, and what stands

| Rule | Under this ADR |
|---|---|
| ADR 0045 **D-3**, *"Each rendered value is rounded to the nearest 5°"*, and the matching words of **D-11** (*"every number is 'about' a value rounded to 5°"*) | **Superseded conditionally** (D-2): 5° stays until an angle's measured 95 % limits of agreement are within ±3° on the engine that produced it; then that angle, on that engine, is rendered to 1°. *"About"* stays on every number |
| ADR 0045 **D-9**, and the row of ADR 0045 **D-1** that keeps ADR 0030 R10 and D-6 | **Superseded** for the Fit check section (D-3): a published range, cited in the same sentence, may stand beside the rider's reading of the same measure, dynamic beside dynamic only, with no verdict |
| ADR 0030 **D-6** and **R10** | **Superseded on the Fit check section only** (D-3). Everywhere else they stand as written, and D-6's refusal to use the healthcare-professional notification carve-out stands everywhere |
| ADR 0045 **D-2, rule P5** | **Superseded for one value**: the knee's maximum extension over the stroke may be reported (D-4). Every other angle stays at a named event; no minimum, no range over the stroke (a maximum minus a minimum) and no flexibility, mobility or range-of-motion category, anywhere |
| ADR 0045 **D-5**, *"The model stays in the worker"* | **Superseded in part**: a fit check's pose may also be found on the rider's instance, by a local model there (the default when the rider has one), or by a hosted model on the rider's own key, opted in (D-6). The tablet's own model stays available |
| ADR 0045 **D-8**'s caveat, R6 rules and word lists | **Stand.** D-2 changes the error figure the caveat quotes once one is measured; the verdict and direction lists, *within*, *outside*, *above*, *below*, *high* and *low* included, bind every range sentence too (D-3) |
| ADR 0045 **D-11**, item (ii)'s *"no range comparison"* and condition 5's *"no range comparison"* | **Restated by D-3**: a range stands beside a reading; no sentence compares them. Condition 6's acceptance stands, and D-3 records the regulatory reasons of ADR 0030 D-6 as a risk now taken (D-3, last bullet) |
| ADR 0045 **D-13**, *"Something reads `worldLandmarks`, a height or a marker"* | **Stands, and is made a rule** for markers by D-5: no marker, ever |
| ADR 0050 **D-1**, **D-5** (*"What the service is sent, in full"*) and **D-7** | **Widened** to a fit check's pictures on the same sealed path, under every one of ADR 0050's other rules, with a fit question of its own and a third switch of its own (D-7) |
| ADR 0031 **D-3** and **D-4** | **Stand** (D-8) |

### D-2 — Rounding: 5° until an angle is measured within ±3°, then 1° for that angle on that engine

> **The rule.** Every fit angle is rendered rounded to the nearest 5° and introduced with
> *"about"*, as ADR 0045 D-3 has it, **until** a measurement on a real rider against ground truth,
> made on [#3027](https://github.com/openzigs/onyourleft/issues/3027)'s protocol, finds **that
> angle's** 95 % limits of agreement within **±3°**, **for the pose engine that produced the value**
> (D-6), at the capture setup the measurement used. From then, that angle from that engine is
> rendered to the nearest **1°**, still introduced with *"about"*.

- **Per angle and per engine.** ⚠️ *The author's choice, and the narrower reading of "once the
  accuracy test passes"*: a knee that passes on the instance's pose model does not let the trunk, or
  the same knee from a hosted model, be shown to 1°. An angle or engine with no passing measurement
  is rendered to 5°. The fit computation reads the rounding from one table, keyed by angle and
  engine, whose every 1° entry cites the measurement that earned it (a spike or a validation result
  under `docs/`), with its devices, build and date.
- **The caveat follows the measurement (R8).** ADR 0045 D-8's sentence quotes *"off by about 6 to 10
  degrees (Kakavand et al., 2025)"*. A value rendered to 1° quotes **its own measured limits** in the
  same sentence, in the same *"off by about"* form, and cites where they were measured. A number to
  the degree with a published error of 6 to 10 degrees beside it is the spurious precision R8 names.
- **No new word.** A passing measurement is not a *"validation"*, and the app never says it is:
  *"validated"*, *"accurate"*, *"accuracy"*, *"precise"* and *"accurate to"* stay refused (ADR 0045
  D-8, ADR 0030 R6). ⚠️ Whether such a measurement is *"validated … to reflect those values"* under
  the FDA's condition 6 is **not** decided here: ADR 0045 D-11's acceptance of that risk stands, and
  R-1 below asks counsel.
- **The stored value is unchanged**: the unrounded median (ADR 0045 D-12). Which rounding a value was
  rendered with follows from the engine the record names and the table, and the definitions version
  changes with the table.
- **Write-ups.** A model is sent the angles *"rounded as D-3 renders them"* (ADR 0045 D-10), so a
  1° angle goes to it at 1°. ADR 0035 D-4's degree screen stands whole.

### D-3 — A published range may stand beside the rider's reading: the same measure, dynamic beside dynamic, cited, and never compared

> **The rule.** On the Fit check section, and nowhere else, a published range may be shown **beside**
> the rider's reading of the **same measure** (the same angle, at the same crank event or the same
> extreme, taken the same way), **only if the source measured it while pedalling**, with its source
> named in the same sentence. No sentence, word, colour or mark says where the reading falls against
> it.

- **Dynamic beside dynamic, never static.** The owner's fixed rule: a reading taken while pedalling
  is only ever shown beside a range measured while pedalling (the owner's example: about 33–43°
  knee flexion at BDC), **never** beside a static, goniometer range (the owner's example: 25–35°),
  because a dynamic reading runs about 8° above a static one and the comparison would mislead by
  construction. A source that does not say which it measured is not used.
- **The same measure.** A range for knee flexion at BDC stands beside the knee at BDC and not beside
  the maximum extension (D-4), unless a source gives a range for maximum extension while pedalling.
  No range stands beside an angle no dynamic source gives one for. ⚠️ *The author's choice.*
- **The same convention.** ADR 0045 D-3 reports the knee as the interior angle (a straight leg is
  180°); published ranges are usually knee **flexion** (180° minus that). A range is shown in the
  convention of the number beside it; where the source uses the other, the sentence gives the
  source's figures and the converted ones, so the rider never reads 145° beside *"33–43°"*. The words
  are the wording module's (ADR 0045 D-7), approved by the owner with #1066.
- **Each range is read first-hand**, with the date it was read, by whoever adds it to the wording
  module's closed list, as ADR 0045 D-9 required. **The figures in this ADR are the owner's
  examples, and this ADR names none as decided.** ⚠️ Neither the 33–43° figure nor the *"about 8°"*
  difference was read from its source for this ADR.
- **No verdict, signed or unsigned.** ADR 0045 D-8's lists bind every range sentence and every
  sentence beside one: no *within*, *outside*, *above*, *below*, *high*, *low*, *too*, *normal*,
  *ideal*, *should* or *recommend*. ADR 0030 D-5's verdict clause and R3 stand. ⚠️ *The author's
  choice*: **beside means in text, not drawn**. No band, bar, gauge or chart with the reading placed
  on it, and no colour or highlight that changes with where the reading falls. A drawing that places
  the number in a band is a verdict without the word.
- **The reading's caveat stays in its own sentence (R8)**, and the range sentence carries its source.
  The closing sentence ADR 0045 D-9 drafted, *"This app does not compare a rider's angles with these
  ranges"*, is no longer true of the layout and is **not** used. ⚠️ *The author's choice*: in its
  place the section says once, in words for the owner to approve with #1066, that a range is what
  published studies measured on other riders, and that the app does not say whether a rider's
  angle should be inside it.
- **Write-ups are not sent ranges.** A model's input (ADR 0045 D-10) carries no range, and ADR 0035
  D-4's screens stand. ⚠️ *The author's choice*: a model that sees a range beside a number will
  compare them, and that comparison is the one thing this decision refuses.
- **What is accepted.** The owner accepts the patent risk spike 0020 §2.1 charted for **Option R**:
  a reading beside a range **leaks a direction** (*a knee outside a range tells the rider which way
  the saddle would go*), and that moves element (g) of US 12,499,571 toward selection. ⚠️ *The
  author's reading*: the answer also takes the **regulatory** risk ADR 0030 D-6 and ADR 0045 D-9 gave
  as their reasons, since there is no way to show a range beside a number without it. ADR 0030 D-6
  called a range the rider is placed against *"a target"* and, on the FDA guidance's disqualifier
  list, *"a reference to a diagnostic threshold"*; spike 0008 §7 called it *"the closest this product
  could come to 'potential detection of pathologies' without naming one"*. Those reasons are **not
  answered here**; R-6 below asks counsel.

### D-4 — The knee's maximum extension may be reported beside the knee at BDC

> **The rule.** A fifth value may be reported: **the knee's maximum extension**, the largest
> interior knee angle (ADR 0045 D-3's convention, a straight leg 180°) in each accepted revolution,
> reported as the median over those revolutions, beside the knee at BDC and never in its place.

- **P5, as it now reads**: every angle is reported at a named crank event (ADR 0045 D-3), **except
  the knee's maximum extension**, which is that one joint's extreme over the stroke. **No minimum,
  no range over the stroke (a maximum minus a minimum, or a maximum beside a minimum of the same
  joint) and no flexibility, mobility or range-of-motion category** is reported, by any angle, on any
  surface or in any write-up. #1065's key test on the output type gains the one field, and its
  mutation (adding a minimum, or a range field) still turns it red.
- **Why this is still not (e).** Spike 0020 §2.2: reporting a joint's extreme of motion *"is still not
  'assessing mobility' on the claim's words, because nothing is said about what the rider can
  reach"*; a range over the stroke, a category, or a comparison against what a body should manage
  would be. What is spent is margin, and the owner's answer accepts it. ADR 0045 P8's mobility
  screen on write-ups stands whole.
- **The same evidence as the knee at BDC.** ADR 0045 D-5's rule binds it: on at least N = 10 accepted
  revolutions, a picture the pose model answered for lies within ±10° of crank of the estimated
  phase at which the knee is most open, and the value is shown only under ADR 0045 D-6's conditions.
  A sparse sample reads a maximum low, so it is held to the sampling evidence a maximum needs.
  ⚠️ *The author's choice*, the same numbers ADR 0045 chose.
- **Its own sentence**, from the wording module, with R8's caveat in it, and D-2's rounding for it as
  an angle of its own: the knee at BDC passing ±3° does not earn the maximum 1°.
- **Stored** in the fit check record as one more angle with its count, spread and reason (ADR 0045
  D-12), and the definitions version changes.

### D-5 — No marker, ever: the fit check is markerless

> **The rule.** Nothing in this program asks a rider to put a sticker, tape, dot, marker or any other
> object on their body, clothing or bicycle for the camera to find, and no code looks for one. The fit
> check reads the body's own landmarks from an unmarked picture and nothing else.

- **No calibration object either.** A known-length object in the picture is a marker for scale, and
  ADR 0045 P1 and P2 already refuse what it would be for.
- **The phone's tilt is not a marker** ([ADR 0052](0052-the-phones-tilt-on-the-side-camera-link-and-adr-0044-accepted.md)):
  it is a direction from the phone's own sensor, with no length.
- **#3033's arms stay markerless**, the owner's words. A study that used markers on a volunteer as
  ground truth for #3027 measures this program; it is not part of it, and nothing it records reaches
  the app.
- **What it keeps.** ADR 0045 D-13 records that anything reading a marker makes element (d) *"a
  question, not an absence"*; with this rule it stays an absence. #3034's question 3 for counsel is
  therefore not asked: the owner refused the option it was about.
- **What it costs.** The only setup with published 2–3° agreement is not available, and D-2's ±3° has
  to be reached without it, or the angles stay at 5°.

### D-6 — Where a fit check's pose is found: the instance's own model by default, the tablet's, or a hosted one opted in

- **On the rider's instance, by a local pose model**: the default for a rider with an instance, the
  owner's *"The local pose model on the instance stays the default"*. Which model, and whether one
  meets ADR 0045 D-0 and D-2 here, is #3033's measurement. A dedicated pose model (the owner's note
  names RTMPose-m) is committed or downloaded weights, so its licence is
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-2's question when it is chosen,
  and this ADR does not decide it.
- **On the tablet**, in its worker, as ADR 0045 D-5 has it. ⚠️ *The author's reading*: the owner's
  answer names a default and removes nothing, so this stays, and a rider with no instance keeps
  every fit check a tablet can make (ADR 0036 D-3 (a)).
- **A hosted model on the rider's own key**, only when the rider has switched it on (D-7).
- **Every engine answers points, never angles.** ⚠️ *The author's choice*: an engine, the hosted one
  included, is asked for image-plane landmark points, and the angles are computed from them by the
  one fit computation under ADR 0045 P1 to P4. A model asked for an angle computes it however it
  likes, and P3 and P4 cannot be held over that. An answer is untrusted input, held to the
  plausibility check of [#761](https://github.com/openzigs/onyourleft/issues/761) as the side
  analysis's is.
- **The record names the engine**, so D-2's rounding and a later reader can tell which produced it.

### D-7 — A fit check's pictures on ADR 0050's path: sealed, never stored, on the rider's own key, behind a switch of their own

> **The rule.** A fit check's pictures may go to the rider's own instance, to be looked at there by
> its local pose model or, when the rider has switched it on, sent on to a hosted model on the
> rider's own key, **under every rule of ADR 0050** except the three this decision widens.

- **What stands, word for word**: sealed or not sent (ADR 0050 D-2), what the tunnel can see and the
  rider is told (D-3), never stored on the instance, in a table, a file, a log or an error (D-4),
  the rider's own key and nobody else's, pinned to the host it was stored with, never following a
  redirect (D-5), stripping on the device and checked twice more (D-8), and **one picture at a time,
  inside an instance's sealed-request allowance, which this ADR does not raise** (D-9). ADR 0045
  D-12 stands: a fit check stores no picture anywhere.
- **What widens.** ADR 0050 D-1's one path admits a second payload: a fit check's pictures, during a
  fit check only. ADR 0050 D-5's *"one fixed question"* becomes one fixed question **per purpose**:
  the side analysis keeps `SIDE_POSE_QUESTION`, and a fit check sends a fit question of its own,
  a constant of this repository's source that asks for landmark points (D-6) and carries nothing of
  the rider's. ADR 0050 D-7's two switches gain a **third** (below).
- **Its own switch, off by default.** ⚠️ *The author's choice*: a hosted model for a fit check has
  its own consent, separate from ADR 0050's hosted consent and the write-up's, given on the device
  and stored there as ADR 0050 D-6 and D-7 store theirs, forgotten on *Erase this device* and on
  disconnecting. It names the service by the host of the rider's own key (ADR 0050 D-7) and says, in
  words the owner approves before merge, that **pictures of the rider's body at home go to that
  company**, under its terms, for each fit check. The owner's *"opt-in"* is read as opt-in to this
  use, not inherited from a switch given for the side analysis.
- **Sizes and rates are not changed here.** ADR 0050 D-3 tells the rider a picture is at most 64 KiB
  and D-9 caps sending at about one a second, one at a time. If #3033's capture needs larger pictures
  or faster sending, that changes what the rider is told and is a later ADR's, not an implementation
  detail.
- **ADR 0033 D-6 is not widened.** How a fit check's pictures are buffered on the tablet is the
  capture design ADR 0045 D-5 leaves to spike 0021 and ADR 0044. If it needs more than ADR 0033 D-6
  allows to wait, that is its own decision.
- **The privacy policy is updated before the first fit picture is sent**: what goes to the instance
  and, with the switch on, to the chosen service, for a fit check. Play Data Safety's Photos and
  videos row is already `shared: true` (ADR 0050 D-7). The change is an implementation issue (D-10),
  and ADR 0033 D-10's rule that the published statements are true at every merge holds it.

### D-8 — OpenRouter, read inside ADR 0031 D-3 and D-4: reachable on the rider's own key, named by the rider, not by the app

> **The rule.** The hosted picture path is made to work with OpenRouter's OpenAI-compatible
> endpoint and with the two models the owner named, and is shown to, with each request recorded as
> ADR 0050 recorded its DeepSeek test. **The app still names no vendor**: the rider types the
> service's address, their key and the model's name, as ADR 0031 D-4 requires, and the consent names
> the service by the host of that key.

- **Why this reading.** ADR 0031 D-4 is not among the decisions the owner named for supersession, and
  it is the condition on which a rider's own key is permitted at all. OpenRouter serves the
  OpenAI-compatible request shape the hosted path already sends, so *"OpenRouter added as a
  provider"* can be met without a vendor name, a vendor list, a default endpoint or vendor-specific
  request shaping. ⚠️ *The author's reading, and the narrower one.*
- **What "added" means, so it can be checked**: the implementation issue (D-10) proves the hosted
  picture path takes an OpenRouter address and key, sends the fit question with a picture **of
  nobody** to `qwen/qwen3-vl-235b-a22b-instruct` and to the DeepSeek flash model through OpenRouter,
  reads each answer through the one reader, refuses cleanly if a model takes no picture, and records
  which models were asked, how, and what they answered, with no key in any file, log or report.
- **One model per key.** ADR 0050 D-11 row 3: a rider on a hosted key uses that key's one model for
  pictures and write-ups. A rider who stores an OpenRouter key for Qwen3-VL gets its write-ups too.
  A separate picture model per key would change the stored key, and is the implementation issue's
  to raise, not this ADR's.
- **Not decided here, and the one point genuinely open.** Naming OpenRouter, or either model, **in
  the app** (a recommendation, a picker entry, a placeholder or a default) supersedes ADR 0031 D-4
  condition 2, and reaching a named hosted model needs ADR 0031 D-3's record of its terms (vendor,
  endpoint, terms URL, the date read, what is sent, what the rider is told). ADR 0086 did the first
  for one local model on one page. **Recommended if the owner wants it**: a small ADR that names
  OpenRouter and Qwen3-VL on the fit consent's setup page only, with D-3's record, after the
  implementation issue shows the path works.

### D-9 — What is fixed, whatever the answers

As #3034 listed, and unchanged by any decision above:

- **No *"professional fit"*, *"validated"* or *"accurate to"* framing** (ADR 0030 R6), except ADR 0045
  D-8's fixed negative phrase *"not a professional bike fit"* inside the caveat.
- **No injury, condition or symptom, and no claim to prevent one** (ADR 0030 R5), range sentences
  included: a published range is never described as *"safe"*, *"healthy"* or as reducing a risk.
- **Nothing in the frontal plane** (ADR 0030 D-4), as a number, a word, a range or advice.
- **Cadence from the BLE sensor stays out** (ADR 0045 D-5, ADR 0033 D-3): revolutions and BDC come
  from the pose stream. Nothing is lost, because a cadence sensor gives one event per turn at an
  arbitrary crank position, not at BDC.
- **No fit check ships until ADR 0045 D-0 holds**, its capture-rate gate included. This ADR adds no
  precondition and removes none.

### D-10 — What follows, once merged

| Work | What it inherits |
|---|---|
| **An implementation issue: the privacy policy and the fit consent** (to file after merge) | D-7: the policy's section for a fit check's pictures, to the instance and, switched on, to the chosen service; the third switch, off by default; the consent's words, for the owner's approval before merge; their test against the policy, as `camera/instance-pose-policy.test.ts` holds ADR 0050's |
| **An implementation issue: OpenRouter on the hosted picture path** (to file after merge) | D-8: the path proven against OpenRouter with the two models, a picture of nobody, recorded; no vendor name in the app |
| [#3033](https://github.com/openzigs/onyourleft/issues/3033) | D-5: markerless arms only. D-6: points, not angles, from every engine. D-7: sizes and rates as ADR 0050 has them, or a later ADR |
| [#3027](https://github.com/openzigs/onyourleft/issues/3027) | D-2: 95 % limits of agreement per angle and per engine, with the devices, build and date |
| [#1064](https://github.com/openzigs/onyourleft/issues/1064) | D-4: the phase of maximum extension proven sampled |
| [#1065](https://github.com/openzigs/onyourleft/issues/1065) | D-2's rounding table, D-4's fifth angle in the record and its key test, D-6's engine in the record, the definitions version |
| [#1066](https://github.com/openzigs/onyourleft/issues/1066) | D-2's caveat from the measurement, D-3's range sentences (dynamic only, same measure, same convention, in text, read first-hand), the replacement for ADR 0045 D-9's closing sentence |
| [#1067](https://github.com/openzigs/onyourleft/issues/1067) | D-3: no range in a model's input; D-4: P8's mobility screen unchanged |

---

## Consequences

### What this enables

- **A fit check can earn the degree.** If #3027 and #3033 show an engine within ±3°, the rider reads
  that angle to 1°, with the measured error beside it, rather than a 5° value that hides it.
- **A rider sees what published studies measured**, beside their own reading of the same thing while
  pedalling, which ADR 0045 noted is what a rider might expect a fit check to give.
- **The knee's maximum extension**, the figure riders most often hear quoted, beside the knee at BDC.
- **A stronger pose engine than the tablet's**, on the rider's instance by default, or a hosted model
  the rider chose and pays for on their own key.

### What this costs, stated plainly

- **The patent margin narrows twice.** A range beside a reading leaks a direction (spike 0020 §2.1,
  element (g)), and a joint's maximum moves toward element (e). In the US the claims are still
  avoided by (d), (e), (f) and (h) as ADR 0045 D-2 records, and in Canada, where CA 3,183,442's
  claim 1 has no (h), by (d), (e) and (f). The owner accepted both. D-5 keeps (d) an absence.
- **The regulatory margin narrows.** ADR 0030 D-6's *"a range the rider is placed against is … a
  target"* is now what the Fit check section shows, without the verdict. One sentence that says
  *"within"*, *"outside"* or *"normal"*, or one colour that changes with the reading, would turn it
  into the diagnostic threshold the FDA guidance names. D-3's text-only rule and ADR 0045 D-8's lists
  are what stand between the two.
- **Pictures of a rider's body at home may go to a company**, with the third switch on, under its
  terms, and neither the instance nor this project can delete them. ADR 0050 D-7's erase-screen
  line already says so for the side analysis, and the policy will say it for a fit check.
- **No marker means the best published agreement is out of reach.** ±3° may not be reached
  markerless, and then the angles stay at 5° for good.
- **D-8 leaves the least technical rider to type an address and a model's name**, as ADR 0031 D-4
  accepted, until the owner rules on naming OpenRouter in the app.

### Constraints this places on other work

- **A 1° value without a cited measurement is a defect**, and so is a measurement on one engine
  used for another.
- **A static range beside a dynamic reading is a defect**, and so is a range drawn as a band or
  coloured by where the reading falls.
- **Any minimum, range over the stroke or mobility word** reopens P5 and needs a superseding ADR.
- **Any marker, sticker or calibration object**, in the app, its help text or its setup, reverses D-5
  and needs a superseding ADR.
- **A vendor's name in the app** stays ADR 0031 D-4's to refuse (D-8).

### What would make this ADR wrong

- **#3027's protocol is found not to measure what the app renders**: a ground truth that is not the
  same angle at the same event, or a setup the rider cannot reproduce. Then D-2's ±3° is a number
  about something else.
- **A published dynamic range turns out to be measured differently from the app's angle** (another
  landmark set, another event, a marker-based 3D model). Then *"the same measure"* fails and the
  range comes off.
- **A rider reads a range as a target despite the text-only rule**, in a test with riders or a
  complaint. Then ADR 0030 D-6's reason was right on this surface too.
- **A continuation issues on US 12,499,571, or CA 3,183,442 grants as published**, with a claim
  that reads on a range or an extreme. Then this ADR's acceptance was of the wrong claims.
- **A hosted service stores or trains on fit pictures** contrary to its terms as the rider read them.
- **Anyone reads this as clearance.**

---

## Questions for counsel

Following [ADR 0007](0007-patent-posture.md)'s model, and adding to ADR 0045's list. None is *"are we
safe"*.

- **A″. Option R and maximum extension under US 12,499,571 and CA 3,183,442.** (1) Is a reading shown
  beside a published range, with no sentence comparing them, *"selecting … the sporting equipment"*
  under element (g), given the direction it leaks? (2) Is a joint's maximum extension over the stroke
  *"assessing … mobility"* under element (e) when no range, category or comparison with a capacity
  is reported? **Worth buying before either ships.**
- **R-1, restated.** Does a fit angle rendered to 1° on the strength of a published measurement on a
  real rider (D-2) change the answer to ADR 0045's R-1 on FDA condition 6, *"unless validated (e.g.
  manufacturer testing …)"*?
- **R-6. A range beside a reading, with no verdict.** Under the FDA guidance's disqualifier list,
  is a published dynamic range shown beside the rider's own angle, in text, with no word placing the
  angle against it, *"a reference to a diagnostic threshold"*? And under MDCG 2019-11, does it move
  the product toward the *"potential detection of pathologies"* spike 0008 §7 names?

**Not asked**: #3034's question 3, markers under element (d). The owner refused markers (D-5).

## Sources

| What | Where | Read |
|---|---|---|
| The five questions and the fixed rules | [#3034](https://github.com/openzigs/onyourleft/issues/3034), its body | 2026-11-22 |
| The owner's answers | [#3034, comment of 2026-11-22](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082813874) | 2026-11-22 |
| The owner's note on Q4 | [#3034, comment of 2026-11-22](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082665142) | 2026-11-22 |
| The lane note | [#3034, comment of 2026-11-22](https://github.com/openzigs/onyourleft/issues/3034#issuecomment-7082880979) | 2026-11-22 |
| The accuracy test and the capture spike | [#3027](https://github.com/openzigs/onyourleft/issues/3027), [#3033](https://github.com/openzigs/onyourleft/issues/3033) | 2026-11-22 |
| Option R, element (e) and the extreme of a joint | [spike 0020](../spikes/0020-fit-from-one-side-camera-patent-rechart.md) §2.1, §2.2 | 2026-11-22 |
| The hosted picture path as built | `apps/instance/src/camera/hosted-pictures.ts`, `apps/web/src/camera/instance-pose.ts`, at `main` `e6fa32d41` | 2026-11-22 |
| That no fit check is built | a search of `apps/` and `packages/` for a fit computation, `FitCheckSection` and `fit-report-wording`, at `main` `e6fa32d41` | 2026-11-22 |
