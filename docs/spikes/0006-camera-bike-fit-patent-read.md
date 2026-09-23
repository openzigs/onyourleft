# Spike 0006: Are the granted claims of US 12,499,571 — or its neighbours — over what #377 proposes?

- **Date read**: **2026-09-22.** Every claim quoted below was read on that day from the granted
  patent document, by one of the two routes recorded in §1.4. No claim here is taken from a
  marking page, an abstract, a family summary or a search-result snippet
- **Issue**: [#381](https://github.com/openzigs/onyourleft/issues/381). Parent
  [#377](https://github.com/openzigs/onyourleft/issues/377)
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an
  ADR and does not decide anything — it is a dated measurement that an ADR or an issue may then rest
  on, and it ages the way a measurement does."* §9 is a posture rather than a conclusion; the
  decision is the owner's
- ⚠️ **#381's body asks for `docs/adr/NNNN-<kebab-case>.md` and this is a spike instead.** That is a
  deliberate deviation and it is argued in §8. Every substantive acceptance criterion on #381 is met
  here; the venue is the one thing that differs, and the reason is that #381's own seventh criterion
  is *"the ADR **flags rather than resolves**: it does not conclude the feature is safe to build"*,
  which is `CLAUDE.md` §7's definition of a spike and not of an ADR.
  [Spike 0005](0005-live-racing-patent-read.md) is the precedent, and it is three days old

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> [ADR 0007](../adr/0007-patent-posture.md) **D1** says it of itself; [spike 0005](0005-live-racing-patent-read.md)
> repeats it; and it is repeated again here because this document reaches a **favourable** conclusion
> about the closest claim it found, and a favourable conclusion is the one a reader is most likely to
> mistake for clearance. **No systematic landscape search was performed.** Four granted US patents
> were read because a patentee's own marking page and four keyword searches pointed at them. A
> freedom-to-operate opinion is a systematic search plus a legal conclusion by somebody qualified to
> give one; this is neither. **Anyone citing this spike as clearance is misusing it.** §6 names the
> questions a patent lawyer should be asked, on the model of ADR 0007's Question 2 and spike 0005's
> Question A.

---

## 1. What was checked, and what was read

### 1.1 The design being charted

From [#377](https://github.com/openzigs/onyourleft/issues/377) and, for the wording rules that turn
out to carry most of the distance, [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md).
**Nothing of it is built**, and #377's own rule is that nothing may be until all four Phase A issues
close.

| | |
|---|---|
| **What is captured** | Stills or short clips of the rider, on their own bicycle on a trainer, by a camera the rider placed. One camera. Uncalibrated. No marker of any kind on the rider or the bicycle |
| **When it is analysed** | **Afterwards** — owner decision D-A. The rider reads a report on the sofa |
| **What is computed** | Differences between two observations of the **same** rider, on the **same** camera, in the **same** session, in the sagittal plane; and qualitative descriptions of what the pictures show |
| **What is reported** | A change, a comparison, or a description. ⚠️ **Never an absolute joint angle as a number** ([ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-3), **never anything in the frontal plane** (D-4), and **never a size, a component, a component position or a direction to move one** (D-5) |
| **Where it runs** | The rider's own machine, over their own LAN, or — opted into, on their own key — a hosted model the rider chose ([ADR 0031](../adr/0031-model-licences-and-the-hosted-model-hole.md) D-4) |
| **Explicitly absent** | No marker. No second camera. No calibration factor, no reference object, no stated rider height, no derived body-segment length. **No model of any bicycle, and no selection from any set of bicycles.** No mobility assessment. No stationary bicycle device that anything adjusts |

⚠️ **The last row is the load-bearing one**, and §3 is where it does its work.

### 1.2 What was read

Four granted US patents, claim text read in full for every independent claim.

| Patent | Title, **as the granted document states it** | Assignee | Priority | Granted | Independent claims | Status / expiry |
|---|---|---|---|---|---|---|
| **US 12,499,571 B2** | *System and method for selecting a sporting equipment* | Myvelofit Inc | 2021-12-06 | **2025-12-16** | **1, 10, 17** | Active; adjusted expiration **2043-11-25** |
| **US 9,381,417 B2** | *Bicycle fitting system* | Shimano Inc. | 2013-08-16 | 2016-07-05 | **1** | Active |
| **US 11,534,657 B2** | *Indoor bicycle adjustment method and system* | Wahoo Fitness LLC | — | 2022-12-27 | **1, 15, 16** | Active |
| **US 10,704,890 B2** | *Dynamic motion detection system* | Giant Manufacturing Co., Ltd. | 2016-08-10 | 2020-07-07 | **1** | Active |

> ⚠️ **Expiry is an estimate and must not be relied on**, for
> [ADR 0007](../adr/0007-patent-posture.md)'s stated reason: it is Google Patents' "Adjusted
> expiration" field, arithmetic rather than a reading of Patent Term Adjustment or terminal
> disclaimers. Only '571's was recorded, because it is the only one where a date could plausibly
> matter.

### 1.3 ⚠️ The correction this reading forces, and it is the reason the issue exists

**#381 and #377 both give US 12,499,571's title as *"System and Method for Determining the Proper Fit
and Sizing of a Sporting Equipment."* That is not the title of the granted patent.**

The granted document reads **"System and method for selecting a sporting equipment"**. The other
string is what `myvelofit.com/patents` prints, and that page was re-read first-hand on **2026-09-22**
to be sure the discrepancy is real rather than a transcription error upstream. It is real, and the
page reads, verbatim:

> *"U.S. Patent No. 12,499,571*
> *Title: System and Method for Determining the Proper Fit and Sizing of a Sporting Equipment*
> *Covered Products and Services include, but are not limited to:*
> *· The MyVeloFit online bike fit platform*
> *· Automated and AI-assisted bicycle fit and sizing analysis*
> *· Systems and methods for determining bicycle sizing and rider position using user-provided data,
> images, or video*
> *· Software, algorithms, and user interfaces related to bicycle fit recommendations"*

**A virtual patent marking page under 35 U.S.C. § 287(a) is a notice that a product is covered. It
is not claim scope, it is not reviewed by anyone, and here it does not even reproduce the patent's
own title.** #381's first acceptance criterion exists precisely because a posture built on that page
would be a posture built on marketing prose — and the strongest single demonstration of why is that
the prose and the patent disagree on the first line.

⚠️ **This does not mean the page is wrong about coverage.** A patentee marks products it believes
its claims cover, and the claims below do cover a platform that photographs a rider and returns a
bicycle size. What the discrepancy establishes is narrower and is the whole point: **the page is not
the claims, and the difference between "determining the proper fit and sizing" and what claim 1
actually requires is where this entire analysis lives.**

### 1.4 How to reproduce any of it, and the route that failed

**Route A — Google Patents, for '571 and '417:**

```bash
curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US12499571B2/en \
  | python3 -c "import sys,re,html; s=sys.stdin.read(); \
m=re.search(r'<section itemprop=\"claims\".*?</section>', s, re.S); \
print(html.unescape(re.sub(r'<[^>]+>',' ', m.group(0))))"
```

⚠️ **That route stopped working part-way through this spike, and the failure is worth recording
because it is silent-looking.** After eleven successful fetches on 2026-09-22, Google Patents began
returning **HTTP 503** to every request from this machine — including a re-fetch of `US12499571B2`,
which had succeeded minutes earlier. A rate limit rather than a page-level refusal, and the regex in
the command above finds no `claims` section in a 1 103-byte error body, so an unguarded version of
this pipeline prints nothing and exits 0. Spike 0005 records the same class of failure with a
different symptom.

**Route B — the USPTO's own print server, for '657 and '890, which is how they were read after
route A failed:**

```bash
curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11534657 -o 11534657.pdf
```

It needs no user agent, and it serves **the granted document** rather than a rendering of one.
⚠️ It is a **scanned image**: `pdftotext` extracts nothing (the file carries no `/Font` object at
all), so the claims were read **by eye** from the rendered pages — `US 11,534,657 B2` cols. 31–34,
and `US 10,704,890 B2` cols. 13–16. That is a slower read and a more reliable one, and it is the
route to use first next time.

### 1.5 ⚠️ What was **not** read, stated as the gap it is

- **No non-US right.** Not one. '417 has an EP member (`EP2837329B1`) and a CN member
  (`CN104368972B`) visible in its own family list, and neither was opened.
  [ADR 0007](../adr/0007-patent-posture.md)'s Open Question 2 is unchanged.
- **No pending application.** '571 granted on 2025-12-16 from a 2022-12-06 filing with a 2021-12-06
  priority. **A continuation is entirely possible and would not appear on any page read here.** In a
  family this young that is the most important gap in this document — the same sentence
  spike 0005 writes about Peloton's seven continuations, for the opposite reason: there the family
  was old and prolific, here it is new and has had no time to branch yet.
- **The specification of any of the four.** Only the claims were read, plus '890's closing
  paragraphs of the description, which arrived on the same printed page as its claim 1.
  ⚠️ **What a continuation may claim is bounded by what the specification already discloses**, so a
  spike that reads no specification cannot size the continuation risk the way spike 0005 §1.4 did.
- **Four patents seen and not analysed**, listed in §5 with one sentence each, because #381's fifth
  criterion is right that a list of what was seen and not read is worth more than a silence.
- **Nothing about design patents, trade dress or trademarks.** Only utility claims.

---

## 2. The claim chart: US 12,499,571 claim 1, element by element

Claim 1 is a method claim. Claims **10** (system) and **17** (method) recite the same steps —
claim 10 is claim 1 wrapped in *"a processor configured for"*, and claim 17 substitutes claim 3's
*"generating … the one or more models of sporting equipment"* and claim 4's division-by-calibration-factor
for claim 1's Markush group of calibration factors. **All three therefore stand or fall on the same
elements**, and the chart below covers all three; §2.2 records the one place claim 17 differs and
why it does not matter.

Read 2026-09-22 from the granted patent. Quoted in the fragments the analysis turns on and no more —
[ADR 0007](../adr/0007-patent-posture.md)'s discipline.

| # | Element of claim 1, quoted | What #377 proposes | Verdict |
|---|---|---|---|
| **a** | *"receiving, at a processor, from a camera video or image data of a user comprising a series of movements of the user"* | A camera, video or stills of a rider pedalling | **INSIDE.** No argument available and none attempted |
| **b** | *"detecting, at the processor, coordinates of a plurality of joints of the user from the video or image data"* | Markerless pose estimation, which is exactly this | **INSIDE** |
| **c** | *"generating … a model of the user comprising body segments lengths of the user respecting relative proportions of the user"* | ⚠️ **Genuinely uncertain.** A pose skeleton is joint coordinates; the pixel distances between them are segment lengths "respecting relative proportions" on any reading a reader would accept. #377 does not *use* them, but the claim requires generating them, not using them | **UNCERTAIN — treat as inside** |
| **d** | *"generating … **calibrated** body segments lengths of the user using a **calibration factor**"* | **Nothing.** No calibration factor of any kind. No rider height is asked for, no reference object is placed in frame, no marker is used | **OUTSIDE** |
| **e** | *"assessing, at the processor, mobility of the user based on the video or image data"* | **Nothing.** No mobility assessment, no flexibility category, no range-of-motion test | **OUTSIDE** |
| **f** | *"generating … a **calibrated model** of the user using the calibrated segments lengths"* | **Nothing.** Follows from (d): with no calibration factor there is no calibrated model | **OUTSIDE** |
| **g** | *"**selecting**, at the processor, **the sporting equipment** based on the model **from one or more models of sporting equipment**"* | **Nothing.** [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-5 forbids recommending a size, a component or a component position, and there is no set of equipment models to select from | **OUTSIDE** |
| **h** | *"wherein the calibration factor is chosen from the group consisting of: (1) … (leg pixel+back pixel+upper arm pixel)/height of the user in centimeter and (2) … a diagonal measured in camera pixels/diagonal of a marker measured in centimeter using the marker"* | **Nothing**, and this is the narrowest element in the claim: a **Markush group of exactly two** formulae. One needs the rider's height in centimetres; the other needs a physical marker of known size in frame | **OUTSIDE** |

### 2.1 What this means, stated carefully

**A claim is infringed only if every element is present.** Four elements — **d**, **e**, **f** and
**g** — are absent from what #377 proposes, and each is absent for a reason that already existed
before this patent was read:

- **(d), (f) and (h)** are absent because #377's accuracy finding makes calibration pointless. A
  four-camera research rig misses by ~10° at the knee; a calibration factor on one uncalibrated
  phone would produce an *absolute* number, which
  [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-3 forbids for two independent
  reasons neither of which is this patent.
- **(e)** is absent because a mobility assessment is a claim about a rider's body of exactly the kind
  ADR 0030 D-2's table rules out.
- **(g)** is absent because ADR 0030 D-5 refuses to recommend equipment — a product decision taken
  on regulatory and honesty grounds, before this chart was drawn.

**That is the ideal shape of a design-around**, on [ADR 0007](../adr/0007-patent-posture.md) D2's
own test: nobody has to remember the patent reason for it to hold, because each avoidance has an
independent justification that a future contributor will meet first.

⚠️ **Element (h) is the one to notice.** A Markush group — *"chosen from the group consisting of"* —
is closed. The claim does not cover "a calibration factor"; it covers **two specific formulae**, one
of which requires the user's height in centimetres and the other a physical marker of measured
diagonal. Even a design that *did* calibrate would be outside claim 1 unless it calibrated by one of
those two. **This is a narrow claim wearing a broad title**, and it is the single largest gap between
the marking page's *"AI-assisted bicycle fit and sizing analysis"* and what was actually granted.

### 2.2 The one place claim 17 differs, and why it changes nothing

Claim 17 drops element **h**'s Markush group from the claim body and substitutes
*"wherein the calibrated body segments lengths are generated by dividing a dimension of a segment
extracted from video or image pixels by the calibration factor"*, adding
*"generating … the one or more models of sporting equipment"* as a further step. **It still recites
a calibration factor (d), a calibrated model (f), a mobility assessment (e), and selecting sporting
equipment from models of sporting equipment (g) — and it adds a step, generating those models.** So
it is broader in one place, narrower in another, and outside on the same four elements. Claim 18
puts the Markush group back as a dependent limitation.

### 2.3 If an element were found to be inside, what #377 would have to drop

#381's eighth criterion asks for a bounded answer rather than a warning. The bounded answer:

**Drop element (g) and the chart holds however the others are read.** Every independent claim of
'571 requires *selecting the sporting equipment … from one or more models of sporting equipment*.
[ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-5 already forbids it, so **nothing
would have to change**; what would have to be resisted is a future feature request to add a size
recommendation, a component suggestion, or a "which bike should I buy" flow. That request is the one
thing on #377's roadmap-adjacent surface that would move this analysis, and a reviewer meeting it
should be sent here.

Second, weaker fallback: **do not generate body-segment lengths at all** (element c). A pipeline that
reports only *angles between joint coordinates* and never a length has a genuine argument on (c) as
well. It is weaker because "respecting relative proportions" is broad and a reviewer cannot be sure
what a court would make of a skeleton's implicit distances, which is why (c) is marked uncertain
rather than outside.

---

## 3. The design-around that already existed: US 9,381,417's marker requirement

Shimano's '417 is the patent #381's body names as the neighbouring design-around, and claim 1 — the
**only** independent claim; claims 2–15 all depend from it — was read in full on 2026-09-22. Two
limitations carry it, and both are absent from what #377 proposes:

> *"a motion capturing apparatus electrically connected to the controller, the motion capturing
> apparatus including **at least three markers configured to be attached to a rider body of a
> rider**, a sensor configured to detect positions of the at least three markers while the rider is
> on a bicycle fitting equipment configured to simulate riding a bicycle"*
>
> — US 9,381,417 claim 1

> *"the predetermined condition being based on a **flexibility level** of a rider body of the rider,
> the flexibility level expressing a flexibility of at least one joint of the rider body in terms of
> a **flexibility category selected from at least two different flexibility categories**"*
>
> — same claim, earlier

| Limitation | What #377 proposes | Verdict |
|---|---|---|
| **at least three markers attached to the rider body** | **Markerless.** Nothing is attached to the rider | **OUTSIDE, on the claim's face** |
| **bicycle fitting equipment configured to simulate riding a bicycle** | The rider's own bicycle on their own trainer | **Uncertain** — a smart trainer arguably simulates riding. Moot: the marker limitation is independent |
| **a flexibility category selected from at least two categories** | No flexibility assessment at all | **OUTSIDE** |
| **at least one angle between three of the markers**, judged against a parameter range | No absolute angle is computed for reporting at all (ADR 0030 D-3), and there are no markers to take one between | **OUTSIDE** |
| **calculate bicycle fitting information indicating a bicycle component position** | ADR 0030 D-5 forbids it | **OUTSIDE** |

⚠️ **"Markerless" is therefore a documented property of this design rather than an incidental one**,
which is #381's fourth criterion. It is worth stating why it is not merely lucky: markerless is
forced by the product, not chosen against the patent. A rider on a trainer at home has no markers,
no assistant to place them and no fitting rig, so the only version of this feature that exists is
the markerless one. #377 could not have proposed anything else.

⚠️ **And '417 is the reason to be careful about the family**, not a reassurance: **US 2023/0177718 A1
— the application that granted as '571 — appears in '417's own cited-by list**, read first-hand from
'417's Google Patents page on 2026-09-22. MyVeloFit's application cites Shimano's patent. That is a
fact about who was reading whom, and it is why §5 lists the rest of that list rather than stopping at
the two patents #381 names.

---

## 4. The two neighbours that were read, and what each turns on

Both were read from the USPTO print server after Google Patents began refusing (§1.4).

### 4.1 US 11,534,657 B2 (Wahoo Fitness) — claims 1, 15, 16: it is not about the rider at all

> *"calculate, based on received data associated with dimensions of a **reference non-stationary
> bicycle**, at least one estimated dimension of the reference non-stationary bicycle; determine a
> setting of an **adjustable feature of an adjustable stationary bicycle device**, wherein the
> setting is based on a translation of the at least one estimated dimension … to a corresponding
> dimension of the adjustable stationary bicycle device; and provide the setting of the adjustable
> feature."*
>
> — US 11,534,657 claim 1, col. 31

Claim 15 adds *"transmitting one or more control instructions to the adjustable stationary bicycle
device to alter a dimension"*; claim 16 recites the same reference-distance-to-image-distance ratio
without the apparatus wrapper.

**Outside on three independent grounds**, and it is the most comfortable of the four:

- Every independent claim requires an **adjustable stationary bicycle device** — a smart bike whose
  geometry changes. #377 proposes nothing of the kind and this project ships no hardware.
- The digital image in this claim is **an image of a bicycle**, not of a rider. Claim 3 has the
  system *"display a digital image of the reference non-stationary bicycle"* and take user input
  identifying a component in it.
- Nothing in it detects a joint, a body or a person.

**This is a patent about sizing a KICKR-class smart bike from a photograph of the rider's own road
bike.** It is in the neighbourhood by assignee and by keyword, and it is not in the neighbourhood by
subject.

### 4.2 US 10,704,890 B2 (Giant Manufacturing) — claim 1: markers again, and a stereo pair

Claim 1 is the only independent claim; claims 2–20 all depend from it.

> *"a plurality of **active independent emitting elements, respectively affixed to different parts
> of a person to-be-tested**, and each … configured to actively emit a positioning signal having a
> preset wavelength"*

> *"wherein the signal capturing apparatus comprises: a **first image capturing module**, configured
> to capture a left-eye image; a **second image capturing module**, disposed at a position with a
> predetermined interval from the first image capturing module, and configured to capture a
> right-eye image"*
>
> — US 10,704,890 claim 1, cols. 13–14

**Outside on two independent grounds**, each sufficient: there is **nothing affixed to the rider**
(the dependent claims make the emitters LEDs, IR emitters or active RFID tags), and there is **one
camera, not a stereo pair**. Claim 12 makes the riding case explicit — *"configured to detect a
bicycle riding motion of the person to-be-tested"* — which is why it is in this document at all.

⚠️ **This patent is cited by '571 and is a Giant-assigned patent about markered stereo capture of a
cyclist.** It is the clearest statement in this document of what the incumbents in this space
actually claimed: **markers and multiple cameras**. The markerless single-camera approach is not a
clever avoidance of that art, it is a different technology that became possible later — which is a
better position to be in and a worse one, because a later technology attracts later patents that
this document has not looked for.

---

## 5. Seen and not read

Listed with number and one sentence, per #381's fifth criterion. Each was surfaced by '571's or
'417's own citation lists, or by the four searches in §7, and **none was read**.

| Patent / publication | One sentence |
|---|---|
| **US 2013/0211774 A1** (Blast Motion) | *Fitting system for sporting equipment* — cited by '571; a published application rather than a grant, so it has no claims to be inside |
| **US 2018/0018779 A1** (Dyaco International) | *Systems and methods for analyzing a motion based on images* — cited by '571; application, not grant |
| **US 11,602,668 B2** (Imotek) | *System and method for motion analysis* — cites '417; a general motion-analysis grant that the phrase search surfaced, and the most likely of these to matter |
| **US 9,592,423 B2** (Global Action Inc.) | *Measuring system and measuring method for analyzing knee joint* — cites '417; knee-specific and camera-based |
| **US 11,660,505 B2** (Leomo) | *Stability evaluation system, program, and method* — from a company whose product is a cycling motion sensor |
| **US 10,685,153 B2** (Syscend) | *Bicycle sizer* — surfaced by the `"bicycle fit"` search; sizing rather than posture |
| **US 7,976,433 B2** (Kenyon) | *Biomechanical diagnostic machine for bicycle fitting, rehabilitation…* — 2011, a fitting rig |
| **US 12,499,569 B2** (Industrial Technology Research Institute) | *Measurement card, measurement system…* — cites '417, granted the same day as '571 |
| **TW I708628 B** (ITRI) and **IT 202100009284 A1** (Bizzoni) | Non-US members of '417's citing list — *"sensing and feedback … riding a spinning bike"* and *"postural detection system on the bicycle"*. ⚠️ §1.5's non-US gap in concrete form |
| **EP 4141774 A1** (SQlab GmbH) | *Method and system for selecting a bicycle product* — cites '417; European, and the title is '571's subject |

⚠️ **US 11,602,668 (Imotek) and US 9,592,423 (Global Action) are the two most worth reading next**,
because both are granted, both are camera-based motion analysis, and both cite the Shimano patent
this design is outside of — which means an examiner already thought they were in the same art.

---

## 6. The questions for a patent lawyer

Three, specific, as claim charts — [ADR 0007](../adr/0007-patent-posture.md)'s model and
spike 0005's. None is *"are we safe"*.

**Question A — a claim chart of US 12,499,571 claims 1, 10 and 17 against the design in §1.1.** The
engineering claim being tested is that four elements are absent — the calibration factor, the
calibrated model, the mobility assessment, and selecting equipment from models of equipment — and
that the Markush group in element (h) makes even a calibrating design outside claim 1 unless it uses
one of two named formulae. ⚠️ **The specific thing an engineer cannot weigh is the doctrine of
equivalents on element (c)**: is a pose skeleton's implicit pixel distances *"body segments lengths
… respecting relative proportions"*? And on element (g): is showing a rider a *difference* and
letting them decide the equivalent of *selecting the sporting equipment*? This is the cheapest
possible moment to ask — nothing is built.

**Question B — does '571 have a pending continuation, and what does its specification disclose?**
Not a chart: a file-wrapper check. It granted in December 2025 from a 2022 filing, so a continuation
would be young and invisible on the pages read here. **A design checked against granted claims is not
checked against claims in prosecution**, and this family has had no time to branch. Bundle it with
Question A; it is the same afternoon's work.

**Question C — does publishing this document in a public repository help or harm?** ADR 0007's
Question 3 and spike 0005 both ask it and neither has an answer. A dated engineering record of
deliberately avoiding specific claims is normally the good kind of evidence and is also a record that
we read the patents. ⚠️ **It is sharper here than in either predecessor**, for a reason worth
stating: `myvelofit.com/patents` exists to give constructive notice under 35 U.S.C. § 287(a), and
this document records that the notice was read, on a date, by name. An engineer cannot weigh what
that does and should not guess.

**Three things a lawyer is not being asked**, because nothing depends on them: whether '571 would
survive a validity challenge (this project will not fund one); whether the marking page's title
discrepancy has any legal significance (it is a fact recorded in §1.3 and no decision rests on it);
and whether the Wahoo and Giant patents matter (both are outside on limitations that are absent by
construction — no hardware, no markers, one camera).

---

## 7. The searches that produced §5

All run **2026-09-22** against `patents.google.com/xhr/query`, US grants only.

| Query | Results | What it produced |
|---|---|---|
| `"bicycle fit"` | 16 | Wahoo's '657, Syscend's '153, Kenyon's '433 |
| `"bike fitting" camera` | 7 | Global Action's '423, Imotek's '668, Leomo's '505 |
| `"cycling" "sagittal" camera "joint angle" analysis` | 12 | Nothing cycling-specific; the hits are prosthetics, running gait and surgical robotics |
| `markerless "bicycle" "joint angles" video saddle` | 0 | — |

⚠️ **Two of the four returned nothing useful and one returned zero**, which is a finding about the
search rather than about the art: conjunctions of several quoted phrases return empty sets on this
endpoint, and a reader who took a zero as evidence of an empty field would be wrong.
`"bicycle fit"`'s sixteen results are the useful sample, and sixteen is small enough to read in full,
which is what makes §5's list a list rather than a selection. **The citation lists of '571 and '417
produced more relevant art than any of the four searches did.**

---

## 8. Why this is a spike and not an ADR

#381's *Technical Details* asks for `docs/adr/NNNN-<kebab-case>.md`. This document is
`docs/spikes/0006-…` instead, and the deviation is argued here rather than left to be noticed.

1. **#381's own seventh acceptance criterion is the definition of a spike.** *"The ADR **flags rather
   than resolves**: it does not conclude the feature is safe to build. Its output is a posture and a
   list of what an owner would have to accept."* `CLAUDE.md` §7: *"A spike write-up is **not** an ADR
   and does not decide anything — it is a dated measurement that an ADR or an issue may then rest
   on."* A document that decides nothing is, in this repository's own vocabulary, a spike.
2. **The precedent is three days old and is the same shape.**
   [Spike 0005](0005-live-racing-patent-read.md) (#466) read eleven granted patents first-hand,
   charted them, recommended, and decided nothing — and
   [ADR 0028](../adr/0028-racing-fairness.md) is the ADR that rests on it. The same split applies
   here: this measures, and the owner decides whether #377 proceeds.
3. **It ages like a measurement.** Every claim here was read on one day, from pages that change, in a
   family young enough to branch. An ADR is amended by a successor; a spike is *"never renumbered,
   and a finding is never edited out — if a later run contradicts it, that is a second write-up"*,
   which is the right handling for a claim set that may be joined by a continuation next year.
4. **Every substantive criterion on #381 is met here**: the claims read first-hand from the patent
   document with the date recorded (§1.2, §1.4), the element-by-element chart against what #377
   actually proposes with each element marked (§2), quotation limited to the fragments the analysis
   turns on, '417's marker requirement recorded as a design-around with its operative phrase quoted
   (§3), the citing family listed with one sentence each (§5), the not-legal-advice statement with
   three **specific** claim charts rather than a blanket disclaimer (§6), flagging rather than
   resolving (§9), and the bounded answer to "what would have to be dropped" (§2.3).

**What is not met is the venue**, and one consequence follows from it: **no ADR number is consumed
and no reservation row is added** to `docs/architecture.md`'s ownership table, because there is no
ADR. ⚠️ A row is added to that file's **spike** table instead, which is the same check applied to the
same kind of claim. #381's numbering criterion is therefore satisfied in substance — the number came
from reading `docs/spikes/` rather than from the issue body — and not in form.

---

## 9. What this flags, and what an owner would have to accept

**This document does not conclude that the feature is safe to build.** What it says:

- **US 12,499,571's independent claims are outside what #377 proposes on four elements**, three of
  which are absent for reasons that pre-date the patent being read. The closest element is (c) and it
  is marked uncertain rather than outside.
- **The claim is much narrower than the marking page**, and the gap between the two is where the
  comfort comes from. ⚠️ **That comfort is destroyed by one product decision**: adding a size or
  component recommendation. #377 does not propose one and
  [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-5 forbids one.
- **The incumbents' granted art in this space is markered and multi-camera** — Shimano, Giant — and
  a markerless single-camera approach is outside all of it on limitations that are absent by
  construction.
- **The space is crowded and getting more so.** Ten further documents are listed in §5 unread, two of
  them granted US patents on camera-based motion analysis citing the same Shimano patent.

**What an owner would have to accept to proceed:**

1. That no counsel has been asked, and §6's Question A has not been bought. Spike 0005 §5 records
   that the owner declined to buy counsel for the racing questions on 2026-09-22, accepting the
   residual risk; **the same decision is available here and is not assumed.**
2. That a continuation may issue in a family that granted nine months ago and has had no time to
   branch (§1.5, §6 Question B).
3. That no non-US right was read at all, and two non-US members of the neighbouring family are
   listed in §5 unread.
4. That §5's ten unread documents are unread.
5. That the whole of the comfort in §2 rests on
   [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) D-5 continuing to hold. **A future
   feature request for "tell me what size bike to buy" is not a product question here; it reopens
   this document.**

---

## 10. What would make this spike wrong

- **A continuation issues from '571's family** with claims that drop the calibration factor or the
  equipment-selection step. §2's chart would be about the wrong claims, and nothing here would
  notice.
- **Element (c) is read broadly by a court.** If *"body segments lengths … respecting relative
  proportions"* reads on a pose skeleton's implicit distances, the chart loses its only uncertain
  element and still has three outside — but the margin narrows and Question A becomes worth buying
  rather than worth asking.
- **One of §5's ten turns out to be closer than any of the four read here.** The list is a list of
  what was *seen*, and the two flagged in §5 are flagged because nobody has read them.
- **ADR 0030 D-5 is relaxed.** Every version of that relaxation puts element (g) in play, and (g) is
  in every independent claim of '571.
- **Anyone reads this as clearance.** It is four patents, found by one marking page and four
  searches, read by an engineer in an afternoon.
