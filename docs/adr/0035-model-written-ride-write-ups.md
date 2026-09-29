# ADR 0035: A ride write-up written by the rider's own model — outside ADR 0030's vocabularies for model text only, screened at run time, and the owner accepts the medical-device risk

- **Status**: Accepted. The owner ruled on every product question on
  [#795](https://github.com/openzigs/onyourleft/issues/795) and
  [#796](https://github.com/openzigs/onyourleft/issues/796) on 2026-09-28, and both rulings are
  quoted verbatim in Context so they are not argued again. **Nothing is built by this ADR.** It is
  the decision [#805](https://github.com/openzigs/onyourleft/issues/805) waits on before any model's
  words about a ride are shown, and [#803](https://github.com/openzigs/onyourleft/issues/803) before
  the hosted path sends ride data
- **Date**: 2026-09-28
- **Deciders**: **the owner, on every product question and on the risk.** The author decided the
  engineering content and drafted the wording; the owner approved the wording with one addition,
  quoted in D-9. Two points the owner's rulings do not settle are flagged where they are made as
  *the author's choice*. Each takes the narrower option, and widening either is the owner's
  decision
- **Issue**: [#796](https://github.com/openzigs/onyourleft/issues/796). Parent epic
  [#795](https://github.com/openzigs/onyourleft/issues/795)
- **Number**: **0035**, read from [`docs/architecture.md`](../architecture.md)'s ownership table —
  the check `CLAUDE.md` §7 asks for — on 2026-09-28. That table said the next free number was
  0034, and ⚠️ **0034 was not taken, on purpose**: open issue
  [#673](https://github.com/openzigs/onyourleft/issues/673) names "ADR 0034" in its title, so a
  branch taking it here would collide with one that cannot be renumbered once either merges. The
  table now records 0034 as reserved for #673 and 0035 as this ADR, in the same pull request. No
  open branch added a file under `docs/adr/` that day
- **Supersedes**, each **for text a model writes and for nothing else**:
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-2**, the normative table, rows R1 to
    R10.
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-3**, *"No absolute joint angle is ever
    reported as a number"*, **as a rule the model's text must satisfy**. What survives of it is the
    runtime screen in D-4 below, which still withholds any write-up with a degree sign, `deg` or
    the word "degree" in it.
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md) **D-8**'s third bullet, *"Every
    user-visible string in the report module comes from one vocabulary file"*. A model's text
    cannot come from a file. D-8's first two bullets are not superseded: they become the runtime
    screen.
  - [ADR 0033](0033-side-camera-link.md) **D-6**'s *"What is kept"* row, **in its last clause
    only**: *"and discarded when the report is made"*. D-6's rule about pictures is untouched.

  ADR 0030 and ADR 0033 each gain an appended amendment in the same pull request pointing here
  ([ADR 0013](0013-adr-amendments.md)), so a reader of the old sentence finds the new one.
- **Does NOT supersede**, named so none of it is read as touched: everything
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md) says about **text this app writes**;
  `apps/web/src/camera/side-report.ts` and `side-report-wording.ts`; ADR 0030 **D-4** (it becomes
  part of the runtime screen, D-4 below); ADR 0030 **D-5** as a rule about what the app does; ADR
  0030 **D-7**, the live silence rule; [ADR 0029](0029-camera-imagery-as-a-data-class.md) **D-8**;
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) **D-3** and **D-4**;
  [ADR 0033](0033-side-camera-link.md) **D-3**. Never a picture, and nothing reaching a trainer
- **Relates to**: [ADR 0007](0007-patent-posture.md),
  [ADR 0013](0013-adr-amendments.md),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md),
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md),
  [ADR 0033](0033-side-camera-link.md),
  [spike 0006](../spikes/0006-camera-bike-fit-patent-read.md),
  [spike 0008](../spikes/0008-eu-uk-medical-device-read.md),
  [#761](https://github.com/openzigs/onyourleft/issues/761),
  [#798](https://github.com/openzigs/onyourleft/issues/798) to
  [#811](https://github.com/openzigs/onyourleft/issues/811)

> ## ⚠️ This is not legal advice, and it is not a regulatory opinion
>
> [ADR 0030](0030-what-the-app-may-say-about-a-body.md) and
> [spike 0008](../spikes/0008-eu-uk-medical-device-read.md) both say it of themselves. This ADR
> says it for a stronger reason: it does not reach a conclusion that the product is safe from
> regulation. It records that **the owner accepts a risk those two documents describe**, and what
> the app does to narrow it. No lawyer was asked, and none was bought.

---

## Context

### The question

Today no model's words about a ride are shown anywhere. A side-camera ride gets the fixed-sentence
report from `camera/side-report.ts`, rendered by `detail/SideCameraSection.tsx`
([#388](https://github.com/openzigs/onyourleft/issues/388)). Every sentence in it comes from one
file, `side-report-wording.ts`, under [ADR 0030](0030-what-the-app-may-say-about-a-body.md)'s two
vocabularies. The rider's own computer is used for side-camera poses
([#553](https://github.com/openzigs/onyourleft/issues/553)). The hosted path sends a connection
check with no ride data ([#518](https://github.com/openzigs/onyourleft/issues/518)).

The owner has asked for something those rules cannot hold: a write-up of the whole ride, **in the
model's own words, riding position included.** No vocabulary file can contain a model's sentence,
and ADR 0030's table was written so that a reviewer could read every sentence before it shipped.
So ADR 0030 cannot be amended to allow it. [ADR 0013](0013-adr-amendments.md)'s table says a
decision being reversed needs a superseding ADR, and this is that ADR.

### What the owner decided, quoted so it is not argued again

The rulings of 2026-09-28 on [#795](https://github.com/openzigs/onyourleft/issues/795), verbatim:

> **Owner rulings, 2026-09-28. These change this epic's design, and the sentence-id design above is
> superseded.**
>
> 1. **Keep a pose summary with the ride:** yes, differences only. It is erasable, exported, and
>    listed in the privacy policy. This amends ADR 0033 D-6.
> 2. **What the model is sent:** heart rate, cadence, power, rider weight, W/kg, ride length and the
>    **ride profile**, so the model can evaluate how the rider did in each section of the ride. Pose
>    summary numbers are added when there is a side-camera session. **Never a picture.**
> 3. **Output:** a **full free-text write-up by the model, covering riding position as well.**
>    - This **reverses ADR 0030** D-2, D-3 and D-8 as they apply to model output, and needs a
>      **superseding ADR** that records the owner accepting the medical-device risk set out in
>      spike 0008.
>    - The angle and frontal-plane gate (`no-absolute-angles`) still screens the model's output at
>      run time: a write-up that fails is not shown.
>    - Nothing on this path may reach a trainer control point.
> 4. **Hosted model:** may receive the full ride data (health and fitness data shared with a third
>    party the rider chose). The privacy policy, Play Data Safety (health and fitness shared) and
>    the consent wording change to say so, in the same PR as the hosted path.
> 5. **Consent:** camera consent is required **only when pose data is included**. A rider with no
>    side camera can still get the ride write-up.
> 6. **How it is produced:** a **multi-step agent**, running several model calls from an
>    app-defined, versioned template and outline: for example, analyse each section of the ride,
>    then write the summary.
> 7. A new analysis replaces the saved one. The rider's own computer is offered first when both a
>    computer and a hosted model are set up. The own-computer path is built first and the hosted
>    path after. The planner drafts the consent and privacy wording, and the owner approves it in
>    the ADR amendment.

And the owner's answers to #796's five questions, on
[#796](https://github.com/openzigs/onyourleft/issues/796#issuecomment-5880293997), verbatim:

> **Owner answers, 2026-09-28:**
> 1. **Position is analysed over the whole session only**, never per section. ADR 0033 D-3 stands.
> 2. **Sections:** the saved route's gradient runs; otherwise laps; otherwise equal-time sections;
>    **at most 8**.
> 3. **A write-up that fails the screen** gets one rewrite step inside the budget. If it fails
>    again, it is withheld, and the rider is told why.
> 4. **Trademarked metric names:** the model's words are not filtered for them. The ADR records
>    that the app itself never labels a figure with those names, and the prompts use the project's
>    own names.
> 5. **Threshold power:** send `thresholdPower` when it is set.
> 6. **Wording:** all three drafts are **approved** as written above, with one addition. Drafts B
>    (the own-computer policy paragraph) and C (the hosted consent screen) add *"your threshold
>    power, if you set one"* to their list of what is sent. The ADR and its amendments quote the
>    approved text, and the tests pin it word for word.

### The risk the owner accepts, quoted rather than paraphrased

ADR 0030's 2026-09-23 amendment put the product inside the US general-wellness carve-out, and
recorded that the carve-out holds **only while all six conditions hold at once**. Two of them are
the ones a model's free text can breach, quoted from that amendment's table:

> **5** — *"do not include claims, functionality, or outputs that prompt or guide specific clinical
> action or medical management"*
>
> **6** — *"do not include values that mimic those used clinically unless validated (e.g.
> manufacturer testing, peer-reviewed clinical literature) to reflect those values"*

And the same amendment's warning:

> *A single breach — one absolute angle rendered, one alert fired on a reading, one "reduces your
> risk of" — does not merely produce a bad sentence; it argues the product out of the carve-out it
> now relies on.*

[Spike 0008](../spikes/0008-eu-uk-medical-device-read.md) §4.3 is the EU finding that decides it,
verbatim:

> **In the EU, the distance between this product and a class IIa medical device is carried by
> [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) R5, and by very little else.**
>
> R5 was written as a wording rule with a US regulator's disqualifier list behind it. This read
> promotes it: a single sentence anywhere in this product's *intended purpose* — which Article 2(12)
> defines as *"the label, the instructions for use or in promotional or sales materials or
> statements"* — claiming that watching your position prevents injury would place the product
> inside document C's own worked class IIa example. **That is not a wording slip with a wording
> consequence. It is the difference between a self-published app and a device needing a notified
> body.**

§4.2 names that worked example, from MDCG 2019-11 Rev.1: *"a device intended to prevent the risk of
illnesses or pathologies by analysing physiological parameters (e.g. placement of the dorsal
vertebrae, analysis of arterial stiffness, etc.) … is in class IIa."* §5 says what class IIa costs:
*"a notified body, a quality management system and a clinical evaluation. There is no version of
qualifying that is cheap."* §6.3 is the UK's position from the MHRA's own guidance: *"Apps and
software for monitoring sport or fitness purposes, e.g. heart rate, are not considered to be
medical devices. However, in some specific cases, where the intention is to investigate the
physiological processes they may be."*

**R5 is one of the ten rows D-2 holds, and D-2 is superseded here for model text.** A model can
write *"this should help prevent knee pain"*, and nothing mechanical can stop every such sentence.
That is the risk, and the owner accepts it in D-1.

---

## Decision

Eleven decisions. **D-1** is the owner's acceptance of the risk. **D-2** and **D-3** draw the
boundary of the reversal. **D-4** is the runtime screen. **D-5** to **D-8** are what goes in, what
is kept and what never happens. **D-9** is the approved wording. **D-10** and **D-11** are where
each piece lands.

### D-1 — The owner accepts that a model-written write-up may fall outside the carve-out

> **The decision, the owner's.** A write-up written by the model the rider chose may say something
> that breaches the US general-wellness carve-out's condition 5 or 6, or ADR 0030 R5, and so may
> fall outside it, or inside MDCG 2019-11's worked class IIa example. The owner accepts that risk
> for text the rider's own model writes, on a ride the rider asked it about. The owner decided it
> on 2026-09-28, in ruling 3 on [#795](https://github.com/openzigs/onyourleft/issues/795).

**What the app does to narrow it**, and each of these is app behaviour that stays under
[ADR 0030](0030-what-the-app-may-say-about-a-body.md):

| | What | Which condition or rule it keeps closer to |
|---|---|---|
| 1 | **The runtime screen** (D-4): a write-up with an angle, a degree or a frontal-plane word is withheld whole | Condition 6, D-3, D-4 |
| 2 | **The app's own framing** above every write-up (D-9 A): the model wrote it, the app did not and cannot check it, it can be wrong, and it is not medical advice | R6, and Article 2(12)'s *intended purpose*, which is the manufacturer's statements rather than a third party's |
| 3 | **Read only after a press.** A write-up is made when the rider presses one control on the ride's page, and read when they open it. No notification, no alert, no sound, no announcement | Condition 5's *"functionality"*, R7 |
| 4 | **Never during a ride.** Nothing on this path runs, is shown or is said while a ride is recording or paused (D-8) | ADR 0030 D-7 |
| 5 | **The prompts ask for none of it.** The versioned template ([#810](https://github.com/openzigs/onyourleft/issues/810)) tells the model not to give an angle, not to describe side-to-side movement, not to name a disease, injury or condition, and not to recommend a size, a component or a direction to move one. ⚠️ **The author's choice**, and it is a request to the model, not a guarantee: only item 1 is enforced | R5, D-5, and [spike 0006](../spikes/0006-camera-bike-fit-patent-read.md)'s design-around |

⚠️ **What is accepted and not narrowed, stated plainly.** R5 (no disease or injury), R7 (no prompt
to act) and D-5 (no equipment) are **not** screened on model output. A number with no degree sign,
such as *"your knee reached 142 at the bottom"*, passes the screen. The screen catches the two
violations that can be matched; the rest is the risk D-1 accepts.

### D-2 — What is superseded, for model-written text only

| ADR 0030 | For text a model writes | For text this app writes |
|---|---|---|
| **D-1**, two vocabularies | Not applied. The model's words are its own | **Unchanged** |
| **D-2**, R1 to R10 | **Superseded** | **Unchanged** |
| **D-3**, no absolute angle | **Superseded as a rule of wording.** What survives is the screen's degree matchers (D-4) | **Unchanged** |
| **D-4**, no frontal plane | **Survives as the screen's word list** (D-4). Not superseded | **Unchanged** |
| **D-5**, no equipment | Not screened. The prompt asks against it (D-1 item 5) | **Unchanged** |
| **D-6**, literature ranges | Not applied | **Unchanged** |
| **D-7**, live silence | **Untouched.** Nothing on this path is live (D-8) | **Unchanged** |
| **D-8**, what a machine checks | Bullets 1 and 2 **survive as the runtime screen**. Bullet 3, one vocabulary file, is **superseded** | **Unchanged**, and `no-absolute-angles.test.ts` still scans `apps/web/src` |

### D-3 — What is NOT superseded, by name

- **Everything ADR 0030 says about text this app writes.** The headings around a write-up, the
  framing (D-9 A), every failure and "withheld" sentence, and every control's label are app text.
  They are under ADR 0030's vocabularies and D-8's source scan, exactly as the side-camera report
  is.
- **`camera/side-report.ts` and `camera/side-report-wording.ts`**, and `SideCameraSection.tsx`'s
  behaviour. The fixed-sentence report is unchanged and is still shown. The write-up is shown
  **below** it, as a separate thing, and never replaces it.
- **ADR 0030 D-7.** Nothing here is live.
- **[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-8, in full.** A model's text is untrusted
  input. It is never rendered as HTML, never followed as a URL, never used as a path, never turned
  into a control, and never reaches a trainer control point.
- **[ADR 0033](0033-side-camera-link.md) D-3.** *"Nothing on the tablet joins [pose numbers] to a
  ride reading."* The pose summary is whole-session, and the prompt never pairs it with a section
  of the ride (owner's answer 1).
- **[ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-3 and D-4.** No vendor, model or
  service is named or defaulted.
- **Never a picture**, to any model, on either path.
- **Nothing reaches a trainer**, the HUD, the announcer or a ride-time screen.

### D-4 — The runtime screen: what survives of ADR 0030 D-3, D-4 and D-8

> **The rule.** A write-up is shown, and is saved, only if it passes the same matchers
> `camera/no-absolute-angles.ts` applies to source, after invisible characters are removed. **A
> write-up that fails is withheld whole. It is never redacted**, because a sentence with its angle
> cut out still says what the angle said.

- **What the matchers are**: the six degree signs (`°`, `º`, `˚`, `⁰`, `ᵒ`, `∘`), except a capital
  `C` or `F` after one; a number followed by `deg`; the word "degree" or "degrees"; and the
  frontal-plane vocabulary ADR 0030 D-4 and D-8 name, with the forms `no-absolute-angles.ts` reads,
  narrowed to a body as it is. **One set of matchers, shared**: [#798](https://github.com/openzigs/onyourleft/issues/798)
  exports them from one module so the source scan and the runtime screen cannot drift apart.
- **Invisible characters** (U+00AD, U+200B to U+200D, U+2060) are removed before matching, as the
  source scan does.
- **One rewrite, then withheld** (owner's answer 3). A write-up that fails is sent back to the
  model once, inside the run's time budget, with a fixed instruction from the template to rewrite
  it without angles or side-to-side words. If the rewrite fails too, or the budget runs out, the
  write-up is withheld, **and the rider is told why** in a fixed app sentence. The withheld text is
  not saved and not shown.
- **Screened again before it is shown.** A saved write-up is read back through the same screen
  before it renders, so a row written by an older build, or edited in storage, is withheld the same
  way.
- **Plain text only.** A write-up is rendered as text nodes. Never HTML, never Markdown turned into
  HTML, never a link (ADR 0029 D-8).

### D-5 — What the model is sent, and what it never is

**Sent** (owner's ruling 2 and answer 5): heart rate, cadence and power; the rider's weight and
watts per kilogram; the threshold power **when the rider has set one**, and never a substituted
default; how long the ride lasted; and the ride **by section**. When a side-camera session exists
**and the rider agreed to the camera** (ruling 5), the pose summary of D-6.

**Sections** (owner's answer 2): the saved route's gradient runs, when the ride was on a saved
route; otherwise its laps; otherwise equal-time sections. **At most 8.** The rule belongs to
[#809](https://github.com/openzigs/onyourleft/issues/809).

**Never sent**: a picture, or anything made from one other than the pose summary's numbers; a
coordinate or an absolute altitude; a date or a time of day; a ride, route or athlete name; an
identifier of any kind; the rider's key to anywhere but the address they entered. The approved
wording in D-9 says *"It is not sent your name, where you rode, or when"*, and that sentence is a
rule #809's input builder is held to by a walk over what it builds.

**Position is whole-session only** (owner's answer 1). The pose summary is never attributed to a
section, and no step of the template pairs it with one.

### D-6 — The pose summary is kept with the ride

Supersedes [ADR 0033](0033-side-camera-link.md) D-6's *"and discarded when the report is made"*,
on the owner's ruling 1.

- **What is kept**: for each sagittal kind, the late-minus-early difference, whether the two thirds
  were comparable, the counts behind them, and where the poses came from (the tablet's model or the
  rider's computer). **Differences only**: no pose, no landmark, no absolute value, and nothing
  keyed to a time in the ride.
- **Built only from plausible poses**, once [#761](https://github.com/openzigs/onyourleft/issues/761)
  lands. [#801](https://github.com/openzigs/onyourleft/issues/801) waits on it.
- **Owned by the athlete, removed by the erase, carried in the account export, and listed in the
  privacy policy.** The policy changes in the pull request that first stores it, not before
  (ADR 0029 §"What would make this ADR wrong": *"A policy amended in advance, 'so it is ready', is
  a false statement about a shipped app."*).
- ⚠️ **Nothing about pictures changes.** D-6's rule — no picture is ever stored or shown on the
  tablet — stands in full.

### D-7 — How it is produced

A **multi-step agent** (owner's ruling 6) runs a fixed outline from an app-defined, **versioned**
template ([#810](https://github.com/openzigs/onyourleft/issues/810)): one step per section, one for
position when there is a pose summary, one for the summary. **The app decides every step; the
model never chooses a tool, a step or what data it gets.** A run's budgets, retries, cancellation
and failure sentences are [#811](https://github.com/openzigs/onyourleft/issues/811)'s.

A new write-up **replaces** the saved one. The rider's own computer is offered first when both it
and a hosted model are set up (ruling 7).

### D-8 — What never happens on this path

- **Nothing reaches a trainer control point**, the HUD, the announcer, a notification or a
  ride-time screen. `side-report-safety.test.ts` and `analysis-safety.test.ts` are extended to hold
  it, each with a red control.
- **Nothing runs during a ride.** A write-up is asked for from a saved ride's page.
- **Nothing is sent in the background.** A request is made only on the rider's press.
- **The app never labels a figure with the trademarked load-metric names** (`CLAUDE.md` §6). The
  prompts use this project's own names: `effortWeightedPower`, `thresholdFraction`, `rideLoad`,
  `base`, `recent` and `freshness`. **The model's words are not filtered for the familiar names**
  (owner's answer 4): what a model writes is the model's, and the app's framing says so.

### D-9 — The approved wording

The planner drafted these on #796; the owner approved them on 2026-09-28, with *"your threshold
power, if you set one"* added to B and C. **They are quoted here as approved.** The code that ships
each one pins it word for word, the way `consent.test.ts` and `hosted-model.test.ts` already do.
⚠️ **Where the added phrase sits in each list is the author's choice**: after weight and watts per
kilogram, beside the other figure that describes the rider rather than the ride.

**A — the write-up's framing.** App text, shown above every write-up:

> **Written by the model you chose, from this ride's numbers.** This app did not write it and cannot
> check it. It can be wrong. It is not medical advice.

**B — own computer, a new paragraph in the privacy policy:**

> **A ride sent to your own computer, when you ask for an analysis.** When you press the button on
> a ride's page, that ride's numbers go to the computer you set up: heart rate, cadence and power,
> your weight and watts per kilogram, your threshold power, if you set one, how long the ride
> lasted, and how it went section by section. If the side camera filmed the ride, and you agreed to
> the camera, it also gets how a few measurements of your riding position changed between the start
> and the end of filming. Never a picture. Nothing is sent until you press the button, and nothing
> is sent in the background.

**C — hosted, the consent screen**, replacing the wording in ADR 0029's 2026-09-28 amendment:

> **This sends your ride to a service you have chosen, using your own key.**
>
> If you turn this on, each time you ask for a ride analysis, that ride's numbers are sent to the
> address you entered, using the key you entered: your heart rate, cadence and power, your weight
> and watts per kilogram, your threshold power, if you set one, how long the ride lasted, and how
> it went section by section. If the side camera filmed the ride, it is also sent how a few
> measurements of your riding position changed between the start and the end of filming. That is a
> company or a computer that is not yours and not ours, and we cannot see what they do with it or
> how long they keep it. We cannot delete it for you afterwards. Like any service you connect to,
> it also sees your internet address.
>
> It is never sent a picture — not a photograph of you, and nothing made from one. It is not sent
> your name, where you rode, or when.
>
> Your key is kept on this device, is sent only to the address you entered, and is never put in a
> file this app exports.
>
> **You do not need this.** Everything else in the app works without it, and a computer of your own
> can do the same analysis.
>
> This is off. It stays off until you turn it on, it is off again whenever the app is opened, and
> you can turn it off at any time.

⚠️ **A says "not medical advice" and that is not an R6 breach.** R6 forbids *claiming* clinical or
medical standing. A says the opposite, and it is the owner's approved sentence. It is app text, so
the source scan reads it, and it contains nothing that scan forbids.

### D-10 — Where each piece lands

| Piece | Lands with | Why there |
|---|---|---|
| This ADR, and the pointer amendments to ADR 0030 and ADR 0033 | **This pull request** | A reader of the superseded sentences must be able to find this one |
| The pose summary's retention (D-6) and its policy paragraph | [#800](https://github.com/openzigs/onyourleft/issues/800) (store) and [#801](https://github.com/openzigs/onyourleft/issues/801) (what writes it), whichever first stores one | The policy changes with the first byte kept |
| Wording B, the own-computer policy paragraph | [#802](https://github.com/openzigs/onyourleft/issues/802) | It is the first pull request that sends a ride's numbers to the rider's computer |
| Wording A, the framing | [#805](https://github.com/openzigs/onyourleft/issues/805) | It is the first pull request that shows a write-up |
| Wording C, the hosted consent, **as a further ADR 0029 amendment**, with the policy and Play Data Safety's health and fitness rows filed as shared | [#803](https://github.com/openzigs/onyourleft/issues/803) | ⚠️ **Not pre-filed here.** A consent screen and a policy amended before the path exists are false statements about a shipped app (ADR 0029 §"What would make this ADR wrong"). ADR 0029's 2026-09-28 amendment already says the issue that adds a numbers question owes this |
| The runtime screen's shared matchers | [#798](https://github.com/openzigs/onyourleft/issues/798) | Before [#811](https://github.com/openzigs/onyourleft/issues/811)'s runner can call it |

### D-11 — The gate: no model's words are shown before this merges

[#805](https://github.com/openzigs/onyourleft/issues/805) is blocked by this ADR, and
[#803](https://github.com/openzigs/onyourleft/issues/803) is blocked by it for ride data on the
hosted path. Until this ADR merged, ADR 0029's 2026-09-28 amendment was right that *"nothing may
show a model's words about a rider's body outside ADR 0030's vocabularies"*. From this merge that
sentence is true of **app** text only.

---

## Consequences

### What this enables

- A rider with their own computer set up presses one control on a ride's page and later reads a
  write-up of that ride in their model's words, including position when the side camera filmed the
  ride and they agreed to the camera.
- The same, on a hosted model on the rider's own key, once #803 lands.
- The pose summary survives the report, so [#563](https://github.com/openzigs/onyourleft/issues/563)
  can compare sessions from it later.

### What this costs, stated plainly

- **The regulatory margin is thinner than any ADR here has accepted.** ADR 0030's amendment said Q1
  *"raises the cost of eroding D-3, D-4 and R5 rather than lowering it"*. This ADR lets a model
  erode R5 in text the app shows, and relies on the app's framing and the screen rather than on a
  rule every sentence obeys. **That is the accepted risk of D-1, and it is the owner's.**
- **The screen has false positives.** A write-up about a bend in the road (*"a 90-degree corner"*)
  or a rider rocking on a climb is withheld. The one rewrite step and the prompts are what reduce
  that; [#806](https://github.com/openzigs/onyourleft/issues/806) counts how often it happens on the
  tablet.
- **The screen has false negatives**, and D-1 names them: an angle written without a degree sign, a
  disease, a prescription, an equipment change.
- **Health data goes to a third party on the hosted path**, by the owner's ruling 4. It is off by
  default, separately consented, on the rider's own key, and the disclosures move in the same pull
  request.

### Constraints this places on other work

- **Any app text on this path** is written under ADR 0030's vocabularies and passes the source
  scan. That includes every failure, "withheld" and progress sentence #804, #805 and #811 add.
- **#798** exports the matchers from one module, used by both the source scan and the runtime
  screen, with a test that the two read the same list.
- **#809** builds the input with no coordinate, absolute altitude, date, time, name or identifier,
  held by a walk over what it builds, and never pairs the pose summary with a section.
- **#810**'s template carries D-1 item 5's instructions, and uses this project's own metric names.
- **#811** treats a write-up that fails the screen as D-4 says: one rewrite inside the budget, then
  withheld with a reason.
- **#805** screens a saved write-up again before it renders, renders it as text nodes only, and
  shows it below the unchanged side-camera report.
- **Store listings, the README and release notes** are still [spike 0008](../spikes/0008-eu-uk-medical-device-read.md)
  §8's unscanned surfaces. Nothing here describes the write-up as preventing anything, and nothing
  that promotes it may.

---

## What would make this ADR wrong

- **The owner withdraws the acceptance in D-1.** Then this ADR is superseded, and a write-up goes
  back to the sentence-id design #795 first proposed, with every sentence in one file.
- **A regulator or counsel says a model-written write-up the app displays is the manufacturer's
  statement of intended purpose.** Then D-1 item 2's reliance on the framing is wrong, and R5
  would have to be enforced on model output, which no screen here can do. Spike 0008's Question B
  is the nearest question already written down.
- **A model is found writing past the screen often enough to matter.** #806 measures what it can on
  one device. A pattern of injury or prevention language in real write-ups would be a reason to add
  a screen for it, and that is a new decision, not a tuning pass.
- **The screen's matchers and the source scan's drift apart.** #798's shared module exists to stop
  that. A second copy of the list anywhere is a defect.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-09-29** — **D-9's wordings B and C did not name every figure a ride analysis sends, and
  the owner approved completing them.** The review of
  [#843](https://github.com/openzigs/onyourleft/pull/843) ([#803](https://github.com/openzigs/onyourleft/issues/803))
  found that `apps/web/src/ride-analysis/template-v1.ts` sends `distanceKilometres`,
  `meanGradientPercent` and `elevationGainMetres`, and neither wording named them. The owner ruled
  on [#845](https://github.com/openzigs/onyourleft/issues/845) on 2026-09-29: both lists add
  *"distance, and each section's gradient and total climb"*, and the hosted consent adds *"When you
  save a service, the app sends it one test question, containing none of your data, to check it
  answers."* **Nothing in D-9 is edited**; the wordings below replace B and C where the code and the
  privacy policy quote them, and ADR 0029 gains an entry quoting C.

  ⚠️ **Where the added phrase sits is the author's choice**: after *"how long the ride lasted"*, as
  *"its distance, and each section's gradient and total climb"*, beside the other figures that
  describe the ride rather than the rider.

  **B, as amended:**

  > **A ride sent to your own computer, when you ask for an analysis.** When you press the button on
  > a ride's page, that ride's numbers go to the computer you set up: heart rate, cadence and power,
  > your weight and watts per kilogram, your threshold power, if you set one, how long the ride
  > lasted, its distance, and each section's gradient and total climb, and how it went section by
  > section. If the side camera filmed the ride, and you agreed to the camera, it also gets how a
  > few measurements of your riding position changed between the start and the end of filming.
  > Never a picture. Nothing is sent until you press the button, and nothing is sent in the
  > background.

  **C, as amended:**

  > **This sends your ride to a service you have chosen, using your own key.**
  >
  > If you turn this on, each time you ask for a ride analysis, that ride's numbers are sent to the
  > address you entered, using the key you entered: your heart rate, cadence and power, your weight
  > and watts per kilogram, your threshold power, if you set one, how long the ride lasted, its
  > distance, and each section's gradient and total climb, and how it went section by section. If
  > the side camera filmed the ride, it is also sent how a few measurements of your riding position
  > changed between the start and the end of filming. That is a company or a computer that is not
  > yours and not ours, and we cannot see what they do with it or how long they keep it. We cannot
  > delete it for you afterwards. Like any service you connect to, it also sees your internet
  > address.
  >
  > It is never sent a picture — not a photograph of you, and nothing made from one. It is not sent
  > your name, where you rode, or when. When you save a service, the app sends it one test question,
  > containing none of your data, to check it answers.
  >
  > Your key is kept on this device, is sent only to the address you entered, and is never put in a
  > file this app exports.
  >
  > **You do not need this.** Everything else in the app works without it, and a computer of your own
  > can do the same analysis.
  >
  > This is off. It stays off until you turn it on, it is off again whenever the app is opened, and
  > you can turn it off at any time.

  ⚠️ **The test question is not sent when a service is saved.** On the Camera page, *Save this
  service* sends nothing; the test question goes when the rider, with the hosted model turned on,
  presses *Send a test question to the service*. The sentence is quoted as approved, and whether to
  reword it is the owner's decision, filed as [#847](https://github.com/openzigs/onyourleft/issues/847).

  **What holds the lists complete.** `apps/web/src/ride-analysis/sent-fields.test.ts` builds every
  prompt each template in `template.ts` §`ANALYSIS_TEMPLATES` makes from an input with every
  optional figure present, collects every key of the JSON those prompts carry, and requires each
  key to be named by a phrase in both B and C. A field added to a template without a change of
  wording is a red build.

  | Artefact | What changed in the same pull request |
  |---|---|
  | `apps/web/src/detail/write-up.ts` | `COMPUTER_SENDS` is B above |
  | `apps/web/src/camera/hosted-model.ts` | `HOSTED_CONSENT` is C above |
  | [`docs/privacy-policy.md`](../privacy-policy.md) | The own-computer paragraph is B, the hosted section carries C's first two paragraphs, and the sharing line reads *"We never sell your data. The only sharing is the analysis you choose to send to a service you set up."*, which agrees with Play Data Safety's fitness and health rows, declared shared |
  | `apps/mobile/src/android/data-safety.ts` | The fitness-info row's description names the distance, gradient and climb |
