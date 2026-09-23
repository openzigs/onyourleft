# ADR 0030: What this app may say about a rider's body — a wording rule, not a habit

- **Status**: Accepted — for the decisions below, **and two named questions in §"What the owner has
  not decided" are explicitly NOT decided and are the owner's.** **D-0** means nothing can be built
  until they are. `Proposed` was rejected for [ADR 0007](0007-patent-posture.md)'s reason, restated
  by [ADR 0028](0028-racing-fairness.md): the Phase C report
  ([#388](https://github.com/openzigs/onyourleft/issues/388)) and the Phase D live-coaching decision
  ([#389](https://github.com/openzigs/onyourleft/issues/389)) are both blocked on this document, and
  an ADR a reader is told not to rely on cannot block anything
- **Date**: 2026-09-22
- **Deciders**: the author, on the engineering and wording content. ⚠️ **No owner decision was
  sought or given for this ADR**, and none of the three owner decisions recorded on
  [#377](https://github.com/openzigs/onyourleft/issues/377) is about claims. The owner's **D-A**
  (post-ride first, live second) is the reason D-7's silence rule can be written before anybody has
  to obey it
- **Issue**: [#379](https://github.com/openzigs/onyourleft/issues/379). Parent
  [#377](https://github.com/openzigs/onyourleft/issues/377)
- **Number**: **0030**, read from [`docs/architecture.md`](../architecture.md)'s ownership table —
  the check `CLAUDE.md` §7 asks for — after [ADR 0029](0029-camera-imagery-as-a-data-class.md) took
  0029 in the same pull request. ⚠️ **0021 is a live reservation**
  ([#330](https://github.com/openzigs/onyourleft/issues/330), unwritten) and is left alone
- **Supersedes**: nothing
- **Relates to**: [ADR 0009](0009-clean-room-posture.md) (why what another product says is evidence
  about the market and not about us), [ADR 0029](0029-camera-imagery-as-a-data-class.md) (the bytes
  this one is about the wording of), [ADR 0020](0020-display-units.md) (the precedent for a wording
  rule with a source scan behind it),
  [#385](https://github.com/openzigs/onyourleft/issues/385),
  [#388](https://github.com/openzigs/onyourleft/issues/388),
  [#389](https://github.com/openzigs/onyourleft/issues/389)

> ## ⚠️ This is not legal advice, and it is not a regulatory opinion
>
> [ADR 0001](0001-licence.md), [ADR 0006](0006-fit-codec-licensing.md) and
> [ADR 0007](0007-patent-posture.md) all say it of themselves and this one says it too, because it
> reads a regulator's guidance and reaches a conclusion. **One jurisdiction's guidance was read,
> first-hand, and it is non-binding by its own words.** No blanket disclaimer follows: §"The
> questions for a lawyer" names the three specific points where one adds value, on ADR 0007's model,
> and everywhere else this document either shows its evidence or marks the question open.

---

## Context

### The question

**"Bike fit" and "form feedback" edge toward health and injury advice**, and the line between a
measurement and a diagnosis is a line in *wording*, not in code. `CLAUDE.md` §6 already treats
trainer control as a safety issue *"because a smart trainer applies physical resistance to a person
who is pedalling"*. Advice that changes how somebody loads their knees is the sibling concern, and
it is the one with a regulatory surface as well as a moral one.

Left to a style guide, this becomes a habit, and a habit is what the next contributor writes a
different sentence than. So the output of this ADR is a **normative table of claim shapes** a
reviewer who was not in the discussion can check a new string against, plus the one place in the
build where the check is mechanical rather than editorial.

### What was read, first-hand, and on what date

**FDA, *General Wellness: Policy for Low Risk Devices*, document issued January 6, 2026**, read
**2026-09-22** from `https://www.fda.gov/media/90652/download` — the PDF itself, not a summary. Its
own front matter:

> *"This document supersedes 'General Wellness: Policy for Low Risk Devices' issued on September 27,
> 2019."*

and, on what kind of document it is:

> *"FDA's guidance documents, including this guidance, do not establish legally enforceable
> responsibilities. Instead, guidances describe the Agency's current thinking on a topic and should
> be viewed only as recommendations … The use of the word should in Agency guidance means that
> something is suggested or recommended, but not required."*

⚠️ **A correction, in [ADR 0007](0007-patent-posture.md) D7's shape.** #377's epic body and #379's
own body both quote the guidance as saying:

> *"What matters most is not the technology itself but the claims made about what the product
> does."*

**That sentence does not appear in the January 6, 2026 document.** A full-text search of the PDF
read on 2026-09-22 returns no match for *"matters most"*, for *"not the technology"* and for
*"technology itself"*. It may be an accurate paraphrase, it may be from the superseded 2019 version,
or it may be from secondary reporting; this ADR does not know which and does not rely on it. **The
sentence is not quoted anywhere below.** What the guidance actually says, and what every decision
here rests on instead, is the **intended-use** framing at §III, and §520(o)(1)(B) of the FD&C Act as
the guidance quotes it:

> *"Section 520(o)(1)(B) of the FD&C Act, states that software that is intended 'for maintaining
> or encouraging a healthy lifestyle and is unrelated to the diagnosis, cure, mitigation,
> prevention, or treatment of a disease or condition' is not a device under section 201(h) of the
> FD&C Act."*
>
> — §I, *Introduction*. The stray comma after *"FD&C Act"* is the document's own, and the inner
> quotation marks are the document's own too; they are rendered here as single quotes only because
> the outer pair already belongs to this citation

⚠️ **The same document renders the same provision a second way at §II, and the two are not a
contradiction.** This is recorded because a reviewer checked it and read it as a paraphrase, and the
next reviewer would check it again. §II, *Policy on Low Risk General Wellness Products*, reads
*"section 520(o)(1)(B) of the FD&C Act excludes software functions that are intended for maintaining
or encouraging a healthy lifestyle and are unrelated to the diagnosis…"* — **plural and unquoted at
§II, singular and quoted at §I.** This ADR quotes §I, which is the rendering that puts the statutory
words inside quotation marks, and it is verbatim. Both were read from the same PDF on **2026-09-22**;
nothing below turns on which one is used.

and

> *"If the product's intended uses are not limited to the above general wellness intended uses, this
> guidance does not apply."*
>
> — §III

This correction is the reason to read a primary document rather than inherit a quotation, and it is
recorded rather than quietly fixed because #377 and #379 both carry it and a future reader will meet
it there.

### The passage that decides this ADR, and it is new in the 2026 revision — checked against the superseded document rather than assumed

The January 2026 revision adds a framework for products that use **non-invasive sensing to estimate
or infer physiologic parameters**. A camera estimating a joint angle is squarely such a product.
Read 2026-09-22, §III, in full where it bears:

> *"FDA may consider certain products that use non-invasive sensing (e.g. optical sensing) to
> estimate, infer, or output physiologic parameters … to be general wellness products when such
> outputs are intended solely for wellness uses, and provided they:*
>
> - *are non-invasive and not-implanted;*
> - *do not involve an intervention or technology that may pose a risk to the safety of users or
>   other persons if specific regulatory controls are not applied;*
> - *are not intended for the diagnosis, cure, mitigation, prevention, or treatment of a disease or
>   condition;*
> - *are not intended to substitute for an FDA-authorized, cleared, or approved device;*
> - *do not include claims, functionality, or outputs that prompt or guide specific clinical action
>   or medical management; and*
> - **do not include values that mimic those used clinically unless validated (e.g. manufacturer
>   testing, peer-reviewed clinical literature) to reflect those values.**"

and, immediately after:

> *"Products that meet the aforementioned criteria may display values, ranges, trends, baselines, or
> longitudinal summaries, and may contextualize these outputs in relation to sleep, activity, stress,
> recovery, or similar wellness domains."*

**Those two paragraphs are this ADR in miniature.** The sixth bullet is *"no absolute joint angle,
reported as a number"* stated by the regulator rather than only by the accuracy argument — a knee
angle at bottom dead centre is a value used clinically, and nothing in this program validates it.
The paragraph that follows is why *differences, trends and longitudinal comparison* remain
available: they are exactly the outputs the guidance names as permitted.

And the disqualifier list, which is the forbidden half:

> *"Products are not general wellness products if their labeling, advertising, user interface, or
> functionality includes any of the following: 1. references to specific diseases, clinical
> conditions, or diagnostic thresholds; 2. alerts, alarms, or prompts that recommend or require
> specific clinical action or medical management; 3. treatment guidance intended to inform or direct
> medical management; 4. claims of clinical equivalence, clinical accuracy, medical or clinical
> grade, or substitution for an FDA-authorized, cleared, or approved medical device; or
> 5. intended-use statements that explicitly target diagnosis, screening, monitoring, or management
> of a disease or condition."*

⚠️ Note that it reaches **the user interface and the functionality**, not only the marketing. A
string in a report is in scope on the guidance's own terms.

#### "New in the 2026 revision" is a claim about a document, so the document was read

The heading above asserts an **absence** from a version of the guidance this ADR does not otherwise
rely on, and an asserted absence is only as good as the search that failed to find it. So the
superseded document was fetched and searched rather than inferred from the 2026 one's supersession
notice:

| | |
|---|---|
| **What** | *General Wellness: Policy for Low Risk Devices*, **document issued on September 27, 2019**, *"originally issued on July 29, 2016"* — the document the January 2026 version names as the one it supersedes |
| **From where** | `https://web.archive.org/web/20230103192307id_/https://www.fda.gov/media/90652/download`. ⚠️ **Not a first-party copy** — FDA replaced the file at that media id in place, which is why it had to come from an archive at all. The snapshot's `Last-Modified` header is `Fri, 27 Sep 2019 18:21:02 GMT`, matching the issue date on the document's own cover |
| **Read** | **2026-09-22**, as a PDF, extracted to text and searched. SHA-256 of the bytes fetched: `f3815cfc6ea29346e8d4056418b69588214fef4260f9927fd0df8409824e6047` (the 2026 document read above is `0756013b2a64bfdc23902afad6195edc4e20d2570308845c2138c4b5c8dd2b7e`) |
| **What the search found** | **Nothing.** No occurrence of *"non-invasive sensing"*, *"noninvasive sensing"*, *"physiologic parameter"*, *"mimic those used clinically"* or *"longitudinal summaries"*, and none of *"diagnostic thresholds"*, *"clinical equivalence"* or *"medical or clinical grade"* from the disqualifier list. Extracted text: 4 038 words for 2019 against 4 970 for 2026 |

So the sensing framework, the sixth bullet D-3 rests on, the permitted-outputs paragraph D-6 rests
on **and** the five-item disqualifier list are all additions. ⚠️ **What this does not establish** is
that nothing else moved between the two, that the archived bytes are byte-identical to what FDA
served in 2019 beyond the header above, or that no intermediate revision existed between them. The
claim being made is narrow: **these passages are not in the superseded document**, and that was
checked rather than assumed.

Two further passages are quoted where they are used: the permitted-claims list at §III (D-2), and
the healthcare-professional notification carve-out with its four conditions (D-6).

### What was **not** read, stated as the gap it is

- **No non-US regulation.** Not the EU Medical Device Regulation (EU) 2017/745 and not its
  MDCG software-qualification guidance; not the UK MHRA's; not Health Canada's, not the TGA's.
  **This project ships globally and one jurisdiction was read.** §"What the owner has not decided"
  Q2 is where that sits.
- **No advertising or consumer-protection law anywhere.** A claim can be lawful under a device
  regime and still be an actionable misrepresentation. Nothing here considers that.
- **No professional-practice question.** Whether telling somebody to move their saddle is regulated
  practice in any jurisdiction was not looked at.
- **The superseded 2019 guidance was read only as far as one search.** §"New in the 2026 revision"
  records what was fetched, from where, and the eight phrases that returned nothing. It was **not**
  read end to end, it came from a web archive rather than from FDA, and no intermediate revision
  between 2019 and 2026 was looked for.
- **No accuracy measurement of our own.** Every accuracy figure this ADR relies on is #377's, from
  published literature, and [#385](https://github.com/openzigs/onyourleft/issues/385) is the spike
  that would measure this device. **D-3 and D-4 are written so that #385's answer cannot make them
  wrong in the dangerous direction** — a better measurement could widen them, and a worse one
  changes nothing.

---

## Decision

Nine rules. **D-0** blocks. **D-1** and **D-2** are the vocabulary. **D-3** to **D-5** are the three
refusals. **D-6** is the one thing a report may borrow from the literature. **D-7** is the live
phase's silence rule. **D-8** is what a machine can check and what only a reviewer can.

### D-0 — Nothing is built until Phase A lands and two questions are answered

| Block | What would clear it |
|---|---|
| **Phase A is not complete** | #377's own rule |
| **Two questions are the owner's** | §"What the owner has not decided" |
| **The accuracy this device actually achieves is unmeasured** | [#385](https://github.com/openzigs/onyourleft/issues/385). ⚠️ It cannot make D-3 or D-4 *looser*; it can only tell the owner whether the feature is worth building at all |

### D-1 — Two vocabularies, and every string in this feature is in one of them

> **The rule.** Everything this feature says about a rider's body is either an **observation** — a
> statement about what the pictures show, framed as a change, a comparison or a description — or it
> is forbidden. There is no third category, and in particular there is no "suggestion", "tip" or
> "recommendation" category.

| | Observation — permitted | Prescription, diagnosis or prognosis — forbidden |
|---|---|---|
| **Subject** | what the images showed | what the rider should do, has, or will get |
| **Tense** | past, about this ride or between rides | imperative, or future |
| **Object** | a difference, a trend, a description | a body part's correctness, a setting's correctness, a condition |
| **Authority** | the pictures | the app |

The reason for refusing a middle category is the one this repository keeps rediscovering: a
"suggestion" is a prescription with a softening adverb, and the softening adverb is the first thing
a reviewer stops noticing. *"You might consider raising your saddle"* is `Your saddle is too low`
with three extra words.

### D-2 — The normative table. Rows are **rules**, not examples

A reviewer checks a new string against this table. Each row is stated as a property of the sentence,
with an illustration, so that a sentence nobody anticipated can still be judged.

| # | Rule | Permitted, illustrating | Forbidden, illustrating |
|---|---|---|---|
| **R1** | **A quantity is reported only as a change between two things this app observed.** Never as a standing value of the body | *"Your knee was about 4° straighter at the bottom of the stroke after you raised the saddle"* | *"Your knee angle at the bottom of the stroke is 142°"* |
| **R2** | **A comparison names both sides and the conditions.** A difference with one side missing is a standing value wearing a coat | *"Your hips moved more in the last ten minutes than in the first ten"* | *"Your hips move a lot"* |
| **R3** | **A description of what the pictures show is permitted. A judgement of it is not** | *"Here is your position at the bottom of the stroke. Here is last week's, in the same place"* | *"Your position is good" / "Your fit is correct" / "Your position is wrong"* |
| **R4** | **Nothing is said about equipment.** No component, no direction, no distance | *"Your position changed after you changed something"* | *"Your saddle is 8 mm too low" / "Raise your saddle" / "Try a shorter stem"* |
| **R5** | **No disease, condition, injury, symptom or body part's health is named**, in any tense, including as something avoided | *(nothing)* | *"This will cause knee pain" / "prevents injury" / "reduces your risk of ITB syndrome" / "this is bad for your back"* |
| **R6** | **No clinical, medical or professional framing.** No "clinical", "medical grade", "professional fit", "accurate to", "validated" | *"This is an estimate from one camera and it is rough"* | *"Clinical-grade analysis" / "as accurate as a professional bike fit"* |
| **R7** | **No prompt to act, medically or otherwise**, and no alert. A report is read; it does not interrupt | *(a report the rider opens)* | *"Stop riding" / "See a physiotherapist about this" / a notification fired on a reading |
| **R8** | **Uncertainty is stated wherever a number appears**, in the same sentence, not in a footnote | *"about 4°, and this is a rough estimate from one camera"* | *"4.2°"* — spurious precision is its own violation, independently of R1 |
| **R9** | **No superlative, ranking or score of a body or a position.** No grade, no percentage "correct", no out-of-ten | *(nothing)* | *"Your position scores 78" / "Better than 60 % of riders"* |
| **R10** | **A literature range may be quoted only under D-6**, and never with the rider's own number placed in or beside it | see D-6 | *"Fitters aim for 140–145°. You are at 151°."* |

⚠️ **R5 covers the negative form.** *"Prevents injury"* and *"reduces the risk of"* are the claims
other products in this space market on, and #379's own body says why that is not an argument: it is
evidence about the market, and [ADR 0009](0009-clean-room-posture.md)'s clean-room posture forbids
deriving anything from another product's behaviour in any case. The guidance's second category of
general-wellness claims *does* permit disease-risk references in narrow circumstances — but only
where *"it is well understood and accepted that healthy lifestyle choices may play an important role
in health outcomes"* for that condition, and a saddle height is not a lifestyle choice. This ADR
declines the whole category rather than reason about its edge.

### D-3 — **No absolute joint angle is ever reported as a number.** Two independent reasons, and either alone is enough

> **The rule.** No product surface renders an absolute joint angle, a limb angle, a torso angle, a
> segment length or a body dimension as a number. Differences between two observations of the same
> rider on the same camera in the same session are permitted under R1.

**Reason one — nothing here could have measured it.** #377 records the accuracy finding: markerless
pose estimation against marker-based motion capture *during cycling*, with **four** cameras, gives
knee-flexion RMSE of **9.3° (±3.8°) left and 10.2° (±4.3°) right** (Kakavand et al., *Computers in
Biology and Medicine* 192(Pt A):110295, 2025, DOI `10.1016/j.compbiomed.2025.110295`), and a pooled
scoping review gives a median sagittal knee RMSE of 6.07° (*Frontiers in Digital Health* 2026,
`10.3389/fdgth.2026.1882536`). Fitters resolve saddle changes on the order of **1–2°**. One handheld
phone, not perpendicular, with lens distortion and out-of-plane motion, is worse than the
four-camera rig. **A rendered "142°" would be precision in the wrong place, and the green result
would be indistinguishable from the correct one because the number would look plausible** — which
`CLAUDE.md` §4k tabulates as this repository's own recurring defect shape, arrived at from a new
direction.

**Reason two — the regulator's own words, and this is the half the accuracy argument does not
supply.** The January 2026 guidance conditions its non-invasive-sensing carve-out on outputs that
*"do not include values that mimic those used clinically unless validated (e.g. manufacturer
testing, peer-reviewed clinical literature) to reflect those values."* A knee angle at bottom dead
centre **is** a value used clinically, and nothing in this program validates it — no manufacturer
testing, and the peer-reviewed literature that exists says the opposite. So the number is outside
the carve-out on the guidance's face, independently of how accurate anyone thinks it is.

⚠️ **These are two reasons and not one restated.** A better sensor would answer reason one and leave
reason two exactly where it is, because validation is a thing somebody does and publishes rather
than a property a device acquires. **#385 cannot lift this rule**, and it is worth saying so before
that spike is run.

### D-4 — **Nothing in the frontal plane is ever reported.** Not as a number, not as a word, not as a picture with a line on it

> **The rule.** No product surface reports any frontal-plane quantity or observation: knee tracking,
> knee valgus or varus, hip drop, lateral sway, foot eversion, shoulder levelness, or any other
> measurement taken across the rider rather than along them.

The reason is that a single sagittal camera is not merely imprecise about the frontal plane — it is
**catastrophically wrong in a way that looks fine**. #377 records Noraxon's worked example: a knee
abduction measured at **−2.3° in 3D and −22° in 2D on the same landing**. That is not noise around a
value; it is a different answer by an order of magnitude, from the same event.

⚠️ **This is the rule most likely to be eroded, and it is worth saying why.** Knee tracking and hip
drop are the things riders most want from a fit, so the pressure to report *something* about them
will be constant, and the softest available version — a word rather than a number, "your knees look
like they track slightly inward" — is exactly as wrong as the number and carries no visible
uncertainty at all. **The rule therefore bans the word and the annotated picture as well as the
number.** A line drawn on a frontal image is a measurement rendered graphically.

**What is permitted instead**: showing the rider a frontal photograph with nothing drawn on it and
nothing said about it. A picture of yourself is not a claim.

### D-5 — No sizing, no equipment recommendation, and no "fit" verdict

> **The rule.** This program does not recommend a bicycle size, a component, a component position,
> or a direction to move one; and it never characterises a rider's position or fit as correct,
> optimal, good or bad.

R4 and R3 in the table are the wording form of this; it is restated as a decision because it is the
one that draws a product boundary rather than a wording one, and because it is the one with a
patent question attached. [Spike 0006](../spikes/0006-camera-bike-fit-patent-read.md) charts
US 12,499,571's independent claims against what #377 proposes, and **every one of them requires
selecting sporting equipment from one or more models of sporting equipment**. Not recommending
equipment is therefore a product decision with an independent justification *and* the thing that
keeps the analysis outside that claim — which is the ideal shape of a design-around, for
[ADR 0007](0007-patent-posture.md) D2's stated reason: **nobody has to remember the patent reason
for it to hold.**

### D-6 — A literature range may be shown as **prose with its citation**, and never as a band the rider's own number sits in

> **The rule.** A report may state, in prose, what published sources say about cycling position —
> naming the source inline, in the same sentence — and may not place the rider's own observation in,
> against, or beside that range.

Permitted:

> *"Bike fitters often work to a knee angle somewhere around 140–145° at the bottom of the stroke
> (Holmes et al., 1994). This app does not measure that, and the pictures below are not that
> measurement."*

Forbidden, and the second is forbidden even though it reports no absolute number of its own:

> *"Fitters aim for 140–145°. You are at 151°."*
>
> *"Fitters aim for 140–145°. You are outside it."*

**Why the second is the one worth stating explicitly.** It looks compliant with D-3 — no number is
rendered — and it is a *worse* claim than the number, because it converts an unvalidated estimate
into a verdict and hides the uncertainty entirely. It is also, on the guidance's own disqualifier
list, a **reference to a diagnostic threshold** in the shape item 1 names. A range the rider is
placed against is not a citation, it is a target.

**The healthcare-professional carve-out is noted and not used.** The guidance permits a general
wellness product to include *"a notification informing a user that evaluation by a healthcare
professional may be helpful when outputs fall outside ranges appropriate for general wellness use"*,
provided it does not name a disease, does not characterise the output as abnormal, carries no
clinical threshold, and provides no ongoing alerts. **This program does not use it**, because every
version of it requires deciding that an output *is* outside a range, which is the thing D-3 and D-6
say nothing here can decide.

### D-7 — The live phase's silence rule: the conditions under which an in-ride coach says nothing

Owner decision **D-A** phases live coaching second, and #389 decides whether it exists at all. This
rule is written now because it is cheap now: `packages/domain/src/workout/erg-safety.ts` is the
shape — *"a written rule about what the system does and when it must stop"* — and its
`assessErgCadence` already tells a rider grinding on purpose apart from the start of an ERG spiral.
A live coach needs the same thing pointed the other way: **a rule about when it must say nothing.**

> **The rule.** An in-ride utterance about the rider's body is emitted only when **every** one of
> these holds. Any one failing means silence, and silence is never explained.

| # | Condition | Threshold | Why |
|---|---|---|---|
| **S1** | The rider is not at high intensity | below the rider's own threshold power, sustained for the whole window | A rider at 400 W cannot act on it, cannot un-read it, and is holding a bike |
| **S2** | Enough time has passed since the last utterance | **at least 5 minutes** | A coach that speaks often is a coach a rider stops hearing, and then stops noticing when it matters |
| **S3** | The observation has persisted | the same observation across **at least 60 s** of frames | A single frame is a posture, not a pattern. This is also what stops a dropped detection speaking |
| **S4** | The rider is not in the last part of a hard interval | not inside a workout segment whose target is above threshold, and not within 30 s of its end | Same as S1, plus: a rider counting down does not need a second voice |
| **S5** | The rider asked for it | the live coach is off unless switched on for this ride | The same per-ride shape [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-2 uses, and for the same reason |
| **S6** | The utterance passes D-2 | every rule in the table | A live utterance is subject to every wording rule a report is, with no relaxation for brevity |

⚠️ **The numbers in S2 and S3 are engineering choices, not measurements**, and they are written down
so that changing one is a decision rather than a tuning pass — the failure `apps/web/src/game/scatter.ts`
records about its own constants. #389 owns re-deriving them if live coaching is built.

⚠️ **S1 needs a threshold power the rider may not have set.** `apps/web/src/analysis/thresholds.ts`
is the one place a threshold default is substituted, and **a substituted default must not enable
S1** — an unset threshold means silence, not a guess about when the rider is working hard.

### D-8 — What a machine checks, and what only a reviewer can

`CLAUDE.md` is blunt about the difference and [ADR 0007](0007-patent-posture.md)'s §"Which of D1–D7
a machine checks" is the precedent: *"A documented ban is not a gate."* So, precisely:

**Mechanically checkable, and owed by #388 as a gate in the shape of
`apps/web/src/units/no-inline-units.test.ts`:**

- **No absolute-angle literal reaches a product surface.** The scan is for a degree sign, the word
  `degrees`, and a formatter that renders one, anywhere under `apps/web/src` outside the one module
  that formats a *difference*. That is D-3 in the form a build can fail on, and it is
  #377's own epic criterion.
- **No frontal-plane vocabulary anywhere.** A word list — `valgus`, `varus`, `abduction`,
  `adduction`, `knee track`, `hip drop`, `sway` — scanned over `apps/web/src`. That is D-4.
- **Every user-visible string in the report module comes from one vocabulary file**, so that a new
  sentence is a diff in the one file a reviewer reads with this table beside them. This is the
  structural half, and it is the half that makes the reviewer's job small enough to actually do.

**Not mechanically checkable, and a reviewer's:**

- Whether a permitted-looking sentence is a prescription with a softening adverb (D-1).
- Whether a comparison names both sides honestly (R2).
- Whether an uncertainty statement is in the same sentence or has drifted into a footnote (R8).
- Every one of D-7's six conditions except S5.

**So a green build is not evidence that this ADR was followed.** It is evidence that two specific,
high-value violations are absent. A reader should know that rather than infer an enforcement that is
not there.

---

## Consequences

### What this enables

- **#388 can be written**, against a table rather than a taste, with two of its assertions
  mechanical and the rest checkable by a reviewer holding one page.
- **#389 has its safety analysis already done** in D-7, so the decision it has to make is *"is a
  coach that can only say these things worth building"* rather than *"what would a coach be allowed
  to say"*.
- **#385 has a bound on what its answer can change.** D-3 has two reasons and only one of them is
  about accuracy, so the spike cannot come back and unlock a number. That is worth knowing before
  the measurement is taken rather than after.
- **The wording for the FDA's own permitted outputs is the wording this feature already wanted.**
  *"Values, ranges, trends, baselines, or longitudinal summaries"* is, almost word for word,
  #377's defensible list.

### What this costs, stated plainly

- **The product cannot say the thing riders come for.** *"Your saddle is 8 mm too low"* is the
  sentence a person opens a bike-fit app to read, and D-5 forbids it outright. What is offered
  instead — *"that change moved your knee about 4°"* — requires the rider to have made a change
  already, which means the app is a **measuring tape rather than a fitter**, and a rough one.
- **Competitors will say more.** Other products in this space market injury prevention explicitly.
  A rider comparing feature lists will find this one thinner, and the honest answer is that the
  thinner list is the accurate one.
- **No frontal-plane feature exists at all**, which removes knee tracking and hip drop — two of the
  three things riders most ask about — from the product permanently, or at least until a materially
  different capture setup exists (#377 records what would lift the limit: a calibrated two-camera
  rig, a depth sensor, or a per-rider calibration object in plane).
- **One jurisdiction was read.** A rider in the EU or the UK is covered by rules nobody here has
  looked at, and this document does not pretend otherwise.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#388](https://github.com/openzigs/onyourleft/issues/388) | D-2 entire, as the checklist every rendered string is reviewed against; D-8's two source scans as acceptance criteria; D-6's prose form |
| [#389](https://github.com/openzigs/onyourleft/issues/389) | D-7 entire, and D-2 unchanged — a live utterance gets no relaxation for brevity |
| [#385](https://github.com/openzigs/onyourleft/issues/385) | D-3's second reason: a better measurement does not unlock an absolute number |
| [#386](https://github.com/openzigs/onyourleft/issues/386) | D-4 — a capture arrangement that produces a frontal view produces a view nothing may report on |
| [#390](https://github.com/openzigs/onyourleft/issues/390) | Nothing, and that is worth recording: *"is anybody on the bike"* is a binary about presence, not a claim about a body, and it is outside this ADR entirely |

---

## What the owner has not decided

**Q1 — Does this feature make a claim about health at all, or is it a photograph viewer with a
protractor?** The decisions above take the second position: everything permitted is a description of
what the pictures showed. A product that only does that is arguably outside the guidance because it
makes no wellness claim *and* no device claim — it makes no claim. The owner may want the first
position instead, which is a larger product, buys the language in the guidance's permitted list
(*"improve physical fitness, develop or improve endurance, strength or coordination"*), and pulls
every one of the six non-invasive-sensing conditions into scope as something to satisfy rather than
avoid. **This ADR takes the narrower reading; widening it is the owner's.**

**Q2 — Is a US-only regulatory read acceptable for a product distributed globally?** The app ships
through Google Play and — per [ADR 0018](0018-native-client-platform.md) — will ship through the App
Store. Both are worldwide. Nobody has read the EU MDR, the MDCG software-qualification guidance, the
UK MHRA's position, or any other regime. ⚠️ **The decisions above are deliberately more conservative
than the US guidance requires**, which is the cheapest available hedge and is not a substitute for
reading the others. The owner decides whether to read them, to buy the read, or to accept the gap on
the record.

---

## The questions for a lawyer

Three, specific, on [ADR 0007](0007-patent-posture.md)'s model. None is *"is this legal"*.

**Question A — is a product that makes no health claim at all still within a device regime?** The
narrow reading in Q1 is that describing what a photograph shows is not a claim about health, so no
regime attaches. That is an engineer's reading of an intended-use test and it is exactly the kind of
reading that is wrong in a way an engineer cannot see. Worth asking **before** #388 is built, and
cheap to ask because the answer is about the product's whole posture rather than about a string.

**Question B — does the EU MDR, or the UK equivalent, qualify this as software with a medical
purpose?** Specifically whether "differences within a session, no absolute values, no diagnosis"
survives a qualification test written differently from the FDA's. This is the gap Q2 records, and it
is the one that would actually change the product rather than the wording.

**Question C — does D-2's table, published in a public repository, create an exposure it would not
otherwise have?** ADR 0007's Question 3 asks the counter-intuitive version of this about patents,
and the same shape applies: a documented, dated record of deliberately avoiding specific claim
categories is normally good evidence of care, and it is also a record that we identified the risk.
An engineer cannot weigh that and should not guess; if the answer is "reword", a successor ADR does
it.

Three things a lawyer is **not** being asked, because nothing depends on them: whether the accuracy
figures are right (they are published and cited, and D-3 does not rest on any particular one);
whether other products' injury-prevention marketing is lawful (irrelevant — ADR 0009 forbids
deriving anything from it either way); and whether the FDA guidance is binding (it says of itself
that it is not).

---

## What would make this ADR wrong

- **The 2026 guidance is revised again**, or the non-invasive-sensing framework is withdrawn. Every
  quotation above is dated 2026-09-22 and read from the January 6, 2026 document; a later revision
  is a new read, not an assumption that these words survived.
- **The missing sentence turns out to be in the guidance after all**, in a form the full-text search
  missed. That would not change a decision — nothing below rests on it — but the correction in
  Context would be wrong and should be corrected in turn, in this ADR's own `## Amendments`.
- **Question B comes back saying the EU qualifies this as a medical device.** Then D-0's block
  becomes a product question rather than a wording one, and this ADR is the input to a superseding
  one rather than the answer.
- **#385 finds the accuracy is far better than the literature predicts.** D-3 stands anyway on its
  second reason, and an ADR that had rested on accuracy alone would have been wrong here — which is
  why it does not.
- **Somebody reads a green `no-inline-units`-shaped scan as compliance.** D-8 says in terms that it
  is not, and the day that sentence is dropped from a PR description is the day the rule starts
  rotting.
