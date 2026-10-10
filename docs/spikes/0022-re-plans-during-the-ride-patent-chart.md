# Spike 0022: three live patent documents charted against re-plans during a ride

- **Date read**: **2026-10-10.** Every independent claim of the three documents was read that day
  from a first-hand source. US 2026/0249137 A1 was read from the **USPTO's own print server**,
  because Google Patents did not have it. US11270598B2 and US9886871B1 were read on **Google
  Patents**. Nothing quoted here comes from a press summary, an abstract or a search snippet. The
  exceptions are the two expired ergometer patents in §7, for which only the abstract and claim 1
  were read, and the table there says so
- **Issue**: [#1234](https://github.com/openzigs/onyourleft/issues/1234). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092). Commissioned by the owner's ruling
  **Q11** on [#1233](https://github.com/openzigs/onyourleft/issues/1233) (2026-10-09): *"Do the
  claim-chart spike (#1234) before the agent half is built."*
- **Rests on it**: the agent half of [ADR 0048](../adr/0048-workouts-that-change-during-the-ride.md),
  [#1242](https://github.com/openzigs/onyourleft/issues/1242),
  [#1243](https://github.com/openzigs/onyourleft/issues/1243) and
  [#1244](https://github.com/openzigs/onyourleft/issues/1244). ADR 0048 D-13 recorded these three
  documents at a lower read-status, and its appended amendment of 2026-10-10 cites this spike
- **Number**: **0022.** `docs/spikes/` held 0001 to 0020 on 2026-10-10, but **0021 is claimed** by
  [#1057](https://github.com/openzigs/onyourleft/issues/1057)'s title and is cited by ADR 0033 and
  ADR 0044 as the side camera's transport measurement, so this write-up takes the next free number
- **Status of this document**: a **spike write-up**. It measures and decides nothing. In particular
  it does **not** decide whether the agent half is built. §2.4 and §8 say what the finding puts in
  front of the owner

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> It is the disclaimer [ADR 0007](../adr/0007-patent-posture.md) D1,
> [spike 0005](0005-live-racing-patent-read.md), [spike 0006](0006-camera-bike-fit-patent-read.md)
> and [spike 0020](0020-fit-from-one-side-camera-patent-rechart.md) carry. Three documents were
> read by an engineer in one day. No landscape search was run. One of the three is an
> **unexamined application whose claims can still change in any direction**, and §2 finds that two
> of its claims, **as published**, read on the re-plan. **Anyone citing this spike as clearance is
> misusing it.** §8 lists the questions worth paying a patent lawyer to answer.

---

## 1. What was charted, and what was read

### 1.1 The design being charted

The design is ADR 0048 as the owner ruled on it (#1233's §3 and §4, with the rulings quoted in the
ADR's Context). The agent half is the subject. The heart-rate hold is charted only in §5, because
the issue does not block it.

| | |
|---|---|
| **Where it runs** | The **re-plan agent** is a job on the rider's own instance (ADR 0046). The **validator** and the **workout player** run on the rider's device (ADR 0048 D-2, D-5). The instance never writes a target |
| **What goes in** | At each block boundary, or at most every 3 minutes, a **per-block summary**, sealed: duration, mean and highest heart rate, **time inside the range**, mean power, mean cadence and rescues. Never a 1 Hz stream, a position or a date (D-10). Also the rider's typed goals (D-10), and whatever the agent's read-only tools return (ADR 0046 D-7: `ride_sections`, `recent_rides`, `goals`, `workouts`, `history_search`) |
| **What comes out** | **One move from a closed list** and **one reason from a closed list** (D-4 rule P1). No free number and no free text reaches the device's decision |
| **What the device does with it** | A pure validator accepts it or refuses it, naming the rule (D-5, D-6). An accepted move applies **only from the next block boundary, never to the current block** (P2). It applies automatically, is announced in one sentence from a fixed list (D-12), and has one cancel control, *Keep the plan* (D-7) |
| **Not in the design** | **No score is computed** of how the rider is following the plan. **No prompt is chosen from a library by a score.** No environment data. No calories. No haptics. BLE is the only sensor transport (owner decision D2). Nothing is broadcast to other riders |

The last row is the one this spike leans on. Each entry in it becomes a checkable rule in §6.

### 1.2 What was read, and how

| Document | Source, 2026-10-10 | Claims | Independent claims | Status, as the source shows it |
|---|---|---|---|---|
| **US 2026/0249137 A1**, Peloton Interactive, *"Real-Time Modification of Workouts Within a Connected Fitness Platform"*. Inventor Francis Shanahan. Application **19/065,891**, filed **2025-02-27**, published **2026-08-27**. The front page shows no related-application data, so 2025-02-27 is its earliest date | `image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20260249137`: HTTP 200, 1 179 975 bytes, 17 pages. The PDF is **images only** (`pdftotext` returns nothing), so the claims on page 17 were **read by eye** and cross-checked against `tesseract` OCR of the same page at 300 dpi | 20 | **1** (system), **11** (method), **18** (medium) | An **application**. Current status **not read**: §1.3 |
| **US11270598B2**, Pear Health Labs (originally Pear Sports LLC), *"Physical activity coaching platform with dynamically changing workout content"*. Application US16/865,681, filed 2020-05-04, priority **2013-07-19**, granted **2022-03-08** | `patents.google.com/patent/US11270598B2/en`: HTTP 200, 489 710 bytes, non-empty claims section | 20 | **1** (platform), **9** (method), **19** (apparatus) | **Active**. Anticipated expiration **2034-04-11**. 4th-year maintenance fee paid 2025-09-08 |
| **US9886871B1**, Pear Health Labs (originally Pear Sports LLC), *"Fitness and wellness system with dynamically adjusting guidance"*. Application US13/720,936, filed 2012-12-19, priority **2011-12-27**, granted **2018-02-06** | `patents.google.com/patent/US9886871B1/en`: HTTP 200, 433 563 bytes, non-empty claims section | 22 | **1** and **22** (both methods) | **Active**. Adjusted expiration **2034-09-22**. 8th-year maintenance fee paid 2025-08-06 |

Which claims are independent was read from the page's own markup on Google Patents: a claim is
dependent when its `div` carries the class `claim-dependent`. '598 has 20 claim blocks and 17
dependent markers (1, 9 and 19 are independent). '871 has 22 and 20 (1 and 22). For Peloton the
independent claims are the three that refer to no other claim.

Google Patents' status words, expiration dates and fee events are its own reading of the legal
data, and **are not a legal reading**.

### 1.3 Peloton's application status: not read, and why

The acceptance criterion asks for the application's status from Patent Center or Public PAIR, with
the date. **It could not be read on 2026-10-10**, and this is recorded rather than guessed (ADR 0007
D7):

- **Patent Center** (`patentcenter.uspto.gov/applications/19065891`) answered every URL from this
  machine, its own JavaScript bundles included, with the same 17 430-byte HTML shell, `server:
  AmazonS3` and `x-cache: Error from cloudfront`. A headless Chromium (Playwright 1.63.0) loaded
  the page and rendered nothing, because the scripts it was sent were HTML. So this is a fault
  between this machine and the CDN, not an answer about the application.
- **Public PAIR** no longer exists as a separate service. The USPTO folded it into Patent Center.
- **Global Dossier** (`globaldossier.uspto.gov`) answered **HTTP 403**.
- **The USPTO Open Data Portal API** (`api.uspto.gov/api/v1/patent/applications/19065891`)
  answered **HTTP 401**: it needs an API key, and this project holds none.
- **Google Patents** does not index the publication yet (`US20260249137A1`: HTTP 404), and a query
  for Peloton's documents with a priority after 2025-01-01 returned only design registrations.

**What is known first-hand** is that the application was **published on 2026-08-27** as an A1, and
that an application publishes while it is pending. No grant of it was found. **Its status after
2026-08-27 is unknown**, and §8 Question B is how to settle it: a person opens Patent Center in an
ordinary browser and reads the transaction history.

⚠️ **This chart ages.** It charts claims **as published**. An examiner will very likely require
amendment (§2.4), and any amendment, a continuation or a grant makes §2 a chart of the wrong
claims. Nothing in this repository will notice.

### 1.4 Family members noticed, and their status

| Document | Relationship | Read | Status |
|---|---|---|---|
| **US10643483B2**, Pear, granted 2020-05-05, same priority as '598 (2013-07-19) | '598's sibling: '598 is application US16/865,681, and '483 is US15/017,537, both claiming US 61/856,500 | **Independent claims 1, 9 and 18 read** on Google Patents, 2026-10-10 | Active, anticipated expiration 2034-04-11 |
| **US20160240100A1**, Pear, filed 2016-02-05 | Claims '871's priority | Status only | **Abandoned 2022-08-10**, *"failure to respond to an office action"* |
| **US 2026/0249138 A1**, Peloton, *"Real-Time Modification of Audio Content for a Virtual Coach Application"* | ADR 0048 D-13 lists it | **Not read.** Google Patents 404, and it is outside this issue | Not read |

'483's three independent claims carry the **same routine-score and prompt-library elements** as
'598 claim 1: each calculates *"a routine score based on the biofeedback data"* and has a workout
engine *"configured to select one or more prompts from the segment prompt library based on the state
of the user or the user's performance of the routine and the routine score"*. Rules R1 and R2 (§6)
therefore hold '483 on the same elements as '598, and this spike does not chart it further.

---

## 2. US 2026/0249137 A1 (Peloton), claims as published

### 2.1 The independent claims, verbatim

Read by eye from page 17 of the USPTO print-server PDF and checked against the OCR. Line breaks
and hyphenation from the two-column layout are removed; nothing else is changed.

> **1.** A system associated with a connected fitness platform, the system comprising:
> a modification module that receives a trigger event within a workout performed by a user and
> tracked by the connected fitness platform;
> a sensor data module that accesses sensor data representing one or more workout metrics
> associated with the workout performed by the user in response to the trigger event; and
> an output module that generates a modified workout based on the one or more workout metrics for
> the workout performed by the user.

> **11.** A method, comprising:
> receiving an indication that a user, performing a workout, has progressed to an inflection point
> within the workout;
> presenting workout options available to the user and associated with the workout;
> receiving a selection of one or more of the presented workout options; and
> progressing the workout to the selected one or more workout options.

> **18.** A non-transitory, computer-readable medium whose contents, when executed by a computing
> system, causes the computing system to perform a method, the method comprising:
> receiving an indication that a user, performing a workout, has progressed to an inflection point
> within the workout;
> accessing sensor data associated with performance of the workout by the user at the inflection
> point;
> automatically selecting one or more workout options within the workout for the user based on the
> sensor data; and
> progressing the workout to the automatically selected one or more workout options.

### 2.2 The chart

| Claim | Element | The re-plan design | Verdict | What decides it |
|---|---|---|---|---|
| **1** | (a) *"a modification module that receives a trigger event within a workout"* | A block boundary, or the 3-minute cadence, triggers a summary and a proposal | **met** | Any re-plan needs some trigger |
| **1** | (b) *"a sensor data module that accesses sensor data representing one or more workout metrics … in response to the trigger event"* | The per-block summary: heart rate, power and cadence for the block | **met** | A re-plan that reads no sensor data could not adapt to the rider |
| **1** | (c) *"an output module that generates a modified workout based on the one or more workout metrics"* | The validator turns an accepted move into a new plan revision | **met** | This is the feature |
| **11** | (a) *"progressed to an inflection point within the workout"* | The next block boundary | **met** | P2 |
| **11** | (b) *"presenting workout options available to the user"* | The rider is shown **one pending change** and one cancel control, *Keep the plan*. No menu of paths | **unclear** | D-7. Whether "the change, or keep the plan" is two options presented is a question of construction (§8 Question C) |
| **11** | (c) *"receiving a selection of one or more of the presented workout options"* | A press of *Keep the plan* cancels. With no press, the change applies without a selection | **unclear** | D-7's *"applied without a tap"* is the stronger half. A rider who presses *Keep the plan* may be read as selecting |
| **11** | (d) *"progressing the workout to the selected one or more workout options"* | The plan as revised, or as it was | **unclear** | Follows (b) and (c) |
| **18** | (a) inflection point | The next block boundary | **met** | P2 |
| **18** | (b) *"accessing sensor data … at the inflection point"* | The per-block summary | **met** | D-10 |
| **18** | (c) *"automatically selecting one or more workout options within the workout for the user based on the sensor data"* | The agent chooses one move from a closed list, and the device validates it. A move **edits** the rider's plan (extend, shorten, scale, move a range, swap a block from the rider's own saved workouts, end the main set). The workout holds **no authored branches** | **unclear, treat as met** | The description's examples of "options" are branches authored into a class and found *"via metadata within the multimedia stream"* (claim 13, ¶0110). A narrow reading of *"options within the workout"* needs authored branches, and the design has none (rule R10). A broad reading covers any change the system picks. An engineer should assume the broad one |
| **18** | (d) *"progressing the workout to the automatically selected … options"* | Applied at the next boundary without a tap | **met** | D-7 |

**Claim 1, as published, reads on the re-plan on every element.** **Claim 18 does too, on the broad
reading of (c).** Claim 11 is the only one with room, and that room depends on *Keep the plan*.

### 2.3 What the chart cannot fix

No design-around keeps a re-plan outside claim 1 as published. Claim 1 has three elements: a
trigger, sensor data, and a workout modified from that data. That is a description of what
"re-plan during the ride" means. **The same breadth reaches well past this design**:

- the **heart-rate hold** (§5), which changes the target from heart rate inside a block;
- **shipped code**: `packages/domain/src/workout/erg-safety.ts` §`createErgRescue` eases an ERG
  target when cadence collapses, and `apps/web/src/ride/manual-erg.ts` applies it to a target the
  rider typed (#567). On a literal reading each is a workout modified from a workout metric after a
  trigger;
- **dated prior art** that predates 2025-02-27 by decades (§7), including an ergometer whose
  abstract describes holding the user's heart rate in a range (1983) and an exercise apparatus that
  raises the load when a performance objective is met (1979).

That breadth is why §2.4 matters more than §2.2.

### 2.4 Why the published claims are unlikely to be the granted ones, and why that is no comfort

An engineer's reading, not a legal one: a claim that, read literally, covers a 1983 heart-rate
ergometer and Pear's own 2014–2022 grants (§7) is the kind of claim an examiner rejects over the art
and the applicant narrows. The description has narrower material to narrow into: branches authored
into a class and found through stream metadata (claims 12 to 14), presenting the options on the
machine's display (claim 17), and a large language model that writes a modified voice instruction
in an instructor's voice (¶0081, ¶0089). **None of those is in ADR 0048's design**: no authored
branch, no option menu, and no model text reaches the rider (D-4). If the granted claims narrow into
any of them, the design is likely outside.

**But nothing is known yet about what will grant**, and an application can also issue as a
continuation with claims aimed at a competitor's product. So the honest reading is:

> **As published, two of Peloton's three independent claims read on the re-plan. What grants is
> unknown. The design's distance from the description's narrower embodiments is real and is the
> margin to keep (rules R9 and R10). Whether to build before the claims settle is the owner's call,
> and §8 Questions A and B are what would inform it.**

---

## 3. US11270598B2 (Pear), granted

### 3.1 The independent claims, verbatim

From Google Patents' text, 2026-10-10. Whitespace is normalised and the space Google inserts before
a comma after a claim number is removed; nothing else is changed.

> **1.** An electronic coaching platform comprising:
> an electronic content authoring tool comprising non-transitory machine-readable instructions that
> are executable on a computer, the content authoring tool being configured to:
> electronically receive a routine definition of a routine of an activity, the routine definition
> having one or more segments, each segment including at least one of a segment parameter, a
> segment goal, and a segment prompt library, the segment parameter including at least one of a
> duration, a distance, and an intensity defining the routine, wherein the segment goal includes a
> measurement determining whether a user is successfully performing the routine, and wherein the
> measurement includes one or more of a heart rate, a pace and an intensity associated with the
> routine,
> retrieve, based on a received selection by the user, at least part of the routine definition to
> download to an electronic device associated with the user,
> format the routine definition in a non-transitory machine-readable format for electronic
> transmission via a communications network from the computer,
> store each formatted routine definition in a memory,
> receive biofeedback data from one or more sensors associated with the user and connected with the
> electronic device, the biofeedback data providing at least one contextual attribute associated
> with the user while performing the routine to analyze the at least one contextual attribute based
> on the segment goal of the routine definition to determine a state of the user during each segment
> of the routine
> calculate, while the user is performing at least a part of the routine, a routine score based on
> the biofeedback data and based on whether the at least one contextual attribute associated with
> the user satisfies the measurement, the routine score indicating how the user is able to follow
> and achieve segment goals defined by the routine definition, and
> adjust the segment parameter, based on the routine score and upon determination that the at least
> one contextual attribute does not satisfy the measurement and based on historical workouts of the
> user; and
> a workout store in digital communication with the memory of the content authoring tool to receive
> one or more routine definitions defined by the content authoring tool in the non-transitory
> machine-readable format, the workout store configured to:
> store the one or more routine definitions and metadata associated with the one or more routine
> definitions in a database,
> organize the stored one or more routine definitions and metadata for access by a workout engine
> hosted on the electronic device associated with the user, the workout engine being configured to
> select one or more prompts from the segment prompt library based on the state of the user or the
> user's performance of the routine and the routine score, the one or more prompts including sensory
> feedback information associated with the routine, the sensory feedback information being
> formatted as a combination of visual feedback, auditory feedback, and tactile feedback.

> **9.** A method comprising:
> defining, by a content authoring tool of a coaching platform, a routine definition comprising one
> or more segments, wherein each segment includes at least one of a segment parameter, a segment
> goal and a segment prompt library for assisting a user with performing a routine, the segment
> parameter including at least one of a duration, a distance, and an intensity defining a routine,
> and wherein the segment goal includes a measurement determining whether the user is successfully
> performing the routine, and wherein the measurement includes one or more of a heart rate, a pace
> and an intensity associated with the routine;
> formatting the routine definition for storage in a workout store, wherein the workout store
> organizes one or more routine definitions for access by a device associated with the user;
> downloading to the device associated with the user, based on a received selection by the user, at
> least a part of the routine definition;
> receiving, by at least one data processor, contextual attributes detected by one or more sensors
> associated with the device, wherein the contextual attributes comprise biofeedback data of the
> user and data of a local environment of the user, the data of the local environment indicating at
> least one of air temperature, humidity, elevation, or terrain conditions;
> calculating, while the user is performing the routine, a routine score based on the biofeedback
> data and based on the data of the local environment indicating the at least one of air
> temperature, humidity, elevation, or terrain conditions, wherein the routine score indicates an
> ability of the user to achieve the segment goal in the local environment;
> providing a prompt from the segment prompt library of the routine definition based on the routine
> score, wherein the prompt comprises an audio prompt;
> modifying, by the at least one data processor, the segment parameter of the routine definition
> based on the routine score and in response to a determination that the at least one received
> contextual attributes does not satisfy the measurement;
> wherein at least one of the defining, formatting, downloading, receiving, calculating, providing,
> and modifying is performed by at least one data processor.

> **19.** An electronic coaching apparatus for coaching a user of a routine of an activity, the
> apparatus comprising:
> at least one data processor; and
> at least one memory storing instructions which, when executed by the at least one data processor,
> result in operations comprising:
> defining, a routine definition comprising segments, wherein each segment includes at least one of
> a segment parameter, a segment goal and a segment prompt library for assisting the user with
> performing the routine, the at least one segment parameter including at least one of a duration,
> a distance, and an intensity defining the routine, and wherein the segment goal includes a
> measurement determining whether the user is successfully performing the routine, and wherein the
> measurement includes one or more of a heart rate, a pace and an intensity associated with the
> routine;
> formatting the routine definition for storage in a workout store, wherein the workout store
> organizes one or more routine definitions for access by a device associated with the user;
> downloading to the device associated with the user, based on a received selection by the user, at
> least a part of the routine definition;
> receiving, by at least one data processor, contextual attributes detected by one or more sensors
> associated with the device, wherein the contextual attributes comprise biofeedback data of the
> user and data of a local environment of the user, the data of the local environment indicating at
> least one of air temperature, humidity, elevation, or terrain conditions;
> calculating, while the user is performing the routine, a routine score based on the biofeedback
> data and based on the data of the local environment indicating the at least one of air
> temperature, humidity, elevation, or terrain conditions, wherein the routine score indicates an
> ability of the user to achieve the segment goal in the local environment;
> providing a prompt from the segment prompt library of the routine definition based on the routine
> score, wherein the prompt comprises at least one of an audio prompt, a visual prompt, and a
> tactile prompt; and
> modifying the segment parameter of the routine definition based on the routine score upon
> determination that the at least one received contextual attributes does not satisfy the
> measurement and based on historical workouts of the user.

### 3.2 The chart, claim 1

| # | Element, quoted only as far as the analysis needs | The re-plan design | Verdict | What decides it |
|---|---|---|---|---|
| a | A content authoring tool receives a routine definition of segments; *"the segment goal includes a measurement … one or more of a heart rate, a pace and an intensity"* | The workout builder (`apps/web/src/workouts/`) makes workouts of blocks with a duration and a share of threshold power. A `heart-rate-hold` block (#1239) carries a heart-rate range | **met** once #1239 ships | A block with a duration is a segment parameter, and a heart-rate range is a goal with a heart-rate measurement |
| b | *"retrieve, based on a received selection by the user, at least part of the routine definition to download to an electronic device"* | Workouts are made on the device. Since #1100 they also sync to and from the rider's instance | **unclear, treat as met** | Sync is a download on a broad reading |
| c | *"format the routine definition … for electronic transmission via a communications network"* | ADR 0017's file format, and sealed sync | **met** | |
| d | *"store each formatted routine definition in a memory"* | `packages/store` | **met** | |
| e | *"receive biofeedback data … to analyze the at least one contextual attribute based on the segment goal … to determine a state of the user during each segment"* | The per-block summary compares heart rate to the block's range (*time inside the range*), and the hold compares it every 5 s | **met** | Comparing heart rate to the rider's range is the hold's whole job |
| f | *"calculate, while the user is performing … a **routine score** … indicating how the user is able to follow and achieve segment goals"* | **No score.** The summary carries measurements for one block: seconds, beats per minute, watts, revolutions per minute and a count of rescues. Nothing combines them into one figure of how well the rider is following the plan, during the ride or in the re-plan's input or output | **not met**, **if rule R1 holds** | **Rule R1.** Independent reason: the project already keeps its ride and workout surfaces free of a score, for trademark and wording reasons (`apps/web/src/ride/ride-result.ts`: *"No score, no grade, no load"*; `apps/web/src/workouts/library.ts`: *"no stress score"*). ⚠️ **Time inside the range is the nearest field to a score**: §3.4 |
| g | *"adjust the segment parameter, based on the routine score and upon determination that the at least one contextual attribute does not satisfy the measurement and based on historical workouts of the user"* | A move changes a segment parameter, so the adjusting is there. **Not based on a score** (R1). **Based on history? Yes, as designed**: the re-plan job inherits ADR 0046's `recent_rides` and `history_search` tools (§3.5) | **not met**, on the score alone | R1. The history limb is **met** today, so the score is the only thing holding (g) |
| h | A workout store database organises routine definitions *"for access by a workout engine hosted on the electronic device"* | The workout library, and its sync | **met** | |
| i | The workout engine selects *"one or more prompts from the segment prompt library based on the state of the user or the user's performance of the routine **and the routine score**"*, formatted as *"a combination of visual feedback, auditory feedback, and tactile feedback"* | Every sentence the rider sees or hears comes from **one fixed list in the app**, keyed by the event and the move (D-12). There is **no prompt library in a workout or a block**, nothing is chosen by a score, and **no tactile output exists** | **not met** on three limbs: no per-segment library, no score, no tactile feedback | **Rules R1, R2 and R3.** Independent reasons: D-12 already requires one fixed list of wording for every workout string, and the ADR 0029 D-8 corollary keeps model text off the rider's screen. R3 is margin only: one haptic call would remove it |

**Claim 1 is not met, on (f), (g) and (i)**, and every one of the three rests on **R1**: no score.
R2 adds a second, independent limb to (i). That is where #1233's §3 put the candidate
design-around, and this chart confirms it.

### 3.3 The chart, claims 9 and 19

Claims 9 and 19 share (a) to (e) with claim 1 in substance, and differ where it helps:

| Element | Claims | The re-plan design | Verdict | What decides it |
|---|---|---|---|---|
| Contextual attributes *"comprise biofeedback data of the user **and data of a local environment** … air temperature, humidity, elevation, or terrain conditions"* | 9, 19 | **None.** A workout block on an ERG trainer has no route, no gradient and no weather. The summary carries no environment field | **not met** | **Rule R4.** Independent reason: an ERG workout does not run on a route. The trainer game is refused the trainer while a workout runs (`apps/web/src/ride/controller.ts` §`simulationControl`), so no gradient reaches a workout |
| *"calculating … a routine score based on the biofeedback data **and** … the local environment"* | 9, 19 | No score | **not met** | R1 and R4 |
| *"providing a prompt from the segment prompt library … based on the routine score"* (an **audio** prompt in 9; audio, visual or tactile in 19) | 9, 19 | One fixed app-wide list, chosen by event, never by score | **not met** | R1, R2 |
| *"modifying … the segment parameter … based on the routine score"* | 9, 19 | A move, but not based on a score | **not met** | R1 |
| *"… and based on historical workouts of the user"* | 19 | Met, as designed (§3.5) | **met** | — |

**Claims 9 and 19 are not met** on four elements each. Claim 9 is the widest of the three on the
element it drops (no history), and it is also held by R4.

### 3.4 Time inside the range: the one field to watch

ADR 0048 D-10 sends *time inside the range* in each block's summary, and D-10's goals include a
*time-in-range target*. Element (f) is a score *"based on whether the at least one contextual
attribute … satisfies the measurement"*, *"indicating how the user is able to follow and achieve
segment goals"*. One block's seconds inside a range is a **measurement of one segment**, not a
figure for the routine. But it would move toward (f) if it became:

- **a share** of the block, or of the plan, rather than a number of seconds;
- **combined** across blocks into one running figure; or
- **compared with the time-in-range target during the ride**, as progress toward a goal.

Rule R1 forbids all three on the ride path. A post-ride report of the same numbers is a different
question, outside (f)'s *"while the user is performing"*, and is not charted here.

### 3.5 History: the limb the design meets, and what it would cost to drop

'598 claims 1 and 19 (and '483's claims, by their own text) adjust *"based on historical workouts of
the user"*. ADR 0048 D-11 says the re-plan job *"otherwise follows ADR 0046"*, whose D-7 tools
include `recent_rides` (synced ride summaries) and `history_search` (the ADR 0040 index). An agent
with those tools can base a move on past workouts, so **that limb is met as designed**.

Dropping those two tools from the re-plan job, and keeping `goals` and the current ride's summaries,
would add a **second** missing element to claims 1 and 19 alongside the score. It would cost the
re-plan the rider's history. **This spike does not decide it.** It is option **H** for #1243 to
decide, and §6 lists it as optional margin, not as a rule.

---

## 4. US9886871B1 (Pear), granted

### 4.1 The independent claims, verbatim

From Google Patents' text, 2026-10-10, normalised as in §3.1.

> **1.** A method for implementation by one or more data processors comprising:
> accessing, by at least one data processor of a portable physical exercise training device, data
> comprising a training plan, the training plan specifying at least one workout, each workout
> specifying at least one physical exercise and associated performance parameters relating to the
> at least one physical exercise;
> receiving, by the at least one data processor over a wireless connection using one of a plurality
> of wireless protocols, while a user is completing a workout specified by the training plan, data
> characterizing at least one of a physiological measurement of the user, a position of the user,
> and an environment of the user, the receiving further comprising bridging, by the at least one
> data processor of the portable physical exercise training device, the plurality of wireless
> protocols to make the data characterizing at least one of a physiological measurement of the
> user, a position of the user, and an environment of the user interoperable by the portable
> physical exercise training device; and
> determining, by the at least one data processor and based on the received interoperable data and
> using the training plan, guidance to provide to the user during the workout in order to comply
> with the training plan and the associated performance parameters; and
> initiating, by the at least one data processor, provision of the guidance to the user in real-time
> during the workout to allow the user to adjust his or her workout accordingly;
> wherein the training plan is selected by the at least one data processor and based on the
> interoperable data characterized by the at least one of the physiological measurement of the
> user, the position of the user, and the environment of the user received during a previously
> completed training plan;
> wherein at least a portion of the data is generated by at least one sensor;
> wherein the at least one sensor comprises at least one biometric sensor characterizing at least
> one physiological measurement taken from the user during the workout;
> wherein the data from the at least one biometric sensor is received continuously and in real-time
> during the workout, and wherein the guidance adapts based on the data received from the at least
> one biometric sensor, the training plan, and the associated performance parameters;
> wherein the training plan comprises training content that coaches the user follow to an exercise
> routine, wherein training content is used to provide adjustable guidance to the user in real-time
> based on the performance of the user;
> wherein the guidance is variable based on criteria specified by the training content, the
> criteria comprising one or more of calories burned by the user during the workout, weight loss of
> the user during the workout, and temperature of the user during workout; and
> wherein the training content is broadcasted to a plurality of users concurrently engaging in the
> workout.

> **22.** A method for implementation by one or more data processors comprising:
> accessing, by at least one data processor of a portable physical exercise training device, data
> comprising a training plan, the training plan specifying at least one physical exercise and
> associated performance parameters;
> receiving, by the at least one data processor over a wireless connection using one of a plurality
> of wireless protocols, data from at least one exercise machine characterizing interaction by a
> user with the exercise machine while a user is completing a workout, the receiving further
> comprising bridging, by the at least one data processor of the portable physical exercise
> training device, the plurality of wireless protocols to make the data from at least one exercise
> machine characterizing interaction by a user with the exercise machine interoperable by the
> portable physical exercise training device;
> determining, by the at least one data processor and based on the received interoperable data and
> using the training plan, guidance to provide to the user during the workout in order to comply
> with the training plan; and
> initiating, by the at least one data processor, provision of the guidance to the user in real-time
> during the workout to allow the user to adjust his or her workout accordingly by transmitting data
> encapsulating the guidance to a mobile phone worn by the user, the data encapsulating the
> guidance being transmitted in real-time while the user is completing the workout;
> wherein at least a portion of the data is generated by at least one sensor;
> wherein the at least one sensor comprises at least one biometric sensor characterizing at least
> one physiological measurement taken from the user during the workout;
> wherein the data from the at least one biometric sensor is received continuously and in real-time
> during the workout, and wherein the guidance adapts based on the data received from the at least
> one biometric sensor, the training plan, and the associated performance parameters;
> wherein the training plan comprises training content that coaches the user follow to an exercise
> routine, wherein training content is used to provide adjustable guidance to the user in real-time
> based on the performance of the user;
> wherein the guidance is variable based on criteria specified by the training content, the
> criteria comprising one or more of calories burned by the user during the workout, weight loss of
> the user during the workout, and temperature of the user during workout; and
> wherein the training content is broadcasted to a plurality of users concurrently engaging in the
> workout.

### 4.2 The chart

| Element | Claims | The re-plan design | Verdict | What decides it |
|---|---|---|---|---|
| A portable training device accesses a training plan of workouts with performance parameters | 1, 22 | The app on a tablet or phone, with a loaded workout | **met** | |
| Receiving data *"over a wireless connection using one of a plurality of wireless protocols"*, and **bridging** *"the plurality of wireless protocols to make the data … interoperable"* | 1, 22 | **BLE only.** Heart rate, power, cadence and the trainer all arrive over Bluetooth Low Energy. The instance link carries summaries **out** and a move back; it carries no sensor data **in** | **not met** | **Rule R5.** Independent reason: **owner decision D2** puts ANT+ out of scope permanently, enforced by `SCOPE001` in `scripts/check-repo-rules.sh` |
| Determining guidance from the data and the plan, provided in real time *"to allow the user to adjust his or her workout"* | 1, 22 | The hold and the re-plan change the target themselves. The rider is told in one sentence | **unclear, treat as met** | Changing the target for the rider is not obviously "guidance … to allow the user to adjust". An engineer should not lean on it |
| *"the training plan is selected by the at least one data processor and based on … data … received during a previously completed training plan"* | 1 | **The rider loads the workout.** Nothing picks a workout for them. The re-plan's *swap* move replaces one **block** with one from the rider's own saved workouts | **unclear** | **Rule R8.** A block is not a training plan on the claim's words, but a swap chosen with the history tools (§3.5) moves toward it |
| Guidance transmitted *"to a mobile phone worn by the user"* | 22 | Shown on the device running the app, which is on the bars or beside the trainer. Nothing is sent to a second device worn by the rider | **not met** | Margin only. A phone in a pocket would be a second device the app does not have |
| Guidance *"variable based on criteria … comprising one or more of calories burned …, weight loss …, and temperature of the user"* | 1, 22 | **None of the three** is computed or used. No code under `apps/*/src` or `packages/*/src` computes calories (the only mentions, read 2026-10-10, are a note on units in `packages/sensors/src/measurement.ts` and a masking rule in `packages/analysis/src/hosted-mask.ts`) | **not met** | **Rule R6.** Independent reason: D-10's goals and D-4's reasons are closed lists, and none of the three is in either |
| *"the training content is broadcasted to a plurality of users concurrently engaging in the workout"* | 1, 22 | A workout is one rider's. A race room carries power and positions, never a workout plan | **not met** | **Rule R7** |

**Claims 1 and 22 are not met** on three elements each: bridging (R5), the calorie, weight-loss or
temperature criteria (R6), and broadcast (R7). Claim 22 also misses the worn phone. R5 rests on a
decision this project made for unrelated reasons, which is ADR 0007 D2's test at its strongest.

---

## 5. The heart-rate hold, briefly

The issue does not block the hold, and ADR 0048 D-13 rests it on expired art. Read against the
claims above:

- **'598, '483 and '871**: the hold computes no score (R1), selects no prompt (R2), uses no
  environment data (R4) and bridges nothing (R5). It reads **no history**, so '598's history limb
  is not met either. **Not met**, with more margin than the re-plan.
- **Peloton claim 1, as published**: **met**, for §2.3's reason: read literally, it covers any
  modified workout. The hold's lineage is the 1983 heart-rate ergometer and Hunt and Hurni 2019
  (§7). That is a recording obligation under ADR 0007 D6, not a validity argument.
- **Peloton claims 11 and 18**: the hold acts **inside** a block every 5 s, not at an inflection
  point, and selects no option. **Not met** on the words.

---

## 6. Design-around rules, in ADR 0007 D2's shape

Each rule is checkable **by reading this repository's code**, never by reading a patent. "Ride path"
means the hold, the validator, the player, the per-block summary, the re-plan job's input and
output, and every sentence about them. The owner of each check is the issue that builds the
module.

| Rule | Statement, checkable | Holds | How it is checked | Owner |
|---|---|---|---|---|
| **R1** | **No performance score is computed during a ride.** Nothing on the ride path computes, stores, sends or shows one number for how well the rider is following the plan or its goals. The per-block summary carries measurements in their own units only: seconds, beats per minute, watts, revolutions per minute, and a count. *Time inside the range* is **seconds of one block**: never a share, never summed or averaged across blocks during the ride, and never compared with the goal's time-in-range target during the ride | '598 1(f), (g), (i), 9, 19; '483 1, 9, 18 | A test asserts the keys and units of the summary type, and of the re-plan's input and proposal types. A source scan of the ride-path modules finds no `score`, `rating`, `adherence` or `compliance` identifier | #1242, #1243, #1244 |
| **R2** | **No prompt is chosen by a score, and a workout carries no prompts.** Every sentence about a hold or a re-plan comes from one fixed list in one module, keyed by the event and the move (ADR 0048 D-12). The workout format has no per-block text, prompt or cue field | '598 1(i), 9, 19; '483 | A test asserts the workout format's keys (`packages/domain/src/workout/format.ts`) after format version 2 lands. The wording list is one module with a test over it | #1239, #1244, #1245 |
| **R3** | **No tactile output on the ride path.** No vibration or haptics call | '598 1(i) | A source scan for `vibrate` and `Haptics` under `apps/web/src` and `apps/mobile/src`. On 2026-10-10 there was none | #1244 |
| **R4** | **No environment data reaches the hold, the validator or the re-plan.** No air temperature, humidity, elevation, gradient or terrain is a field of any ride-path input | '598 9, 19 | A test asserts the input types' keys | #1242, #1243 |
| **R5** | **Sensor data arrives over BLE only, and nothing merges sensor data from two transports.** | '871 1, 22 | `SCOPE001`, already a gate | already enforced |
| **R6** | **No calorie, weight-loss or body-temperature quantity is computed on the ride path, or used as a goal, a reason or a bound.** | '871 1, 22 | ADR 0048 D-10's goal type and D-4's reason list are closed. A test asserts both lists | #1236, #1242 |
| **R7** | **A workout plan, a hold and a re-plan belong to one rider's ride.** No room message carries a workout plan, a hold or a move | '871 1, 22 | `packages/protocol`'s message types carry none today. A test there should assert it when workout work first touches a room | #1244, and any room work that touches workouts |
| **R8** | **The rider chooses which workout to ride.** Nothing selects a workout or a plan for them from earlier rides. A swap replaces one block, from the rider's own saved workouts, and never the plan | '871 1 (margin) | The validator refuses a swap that replaces more than the next block (#1242's tests). No code path loads a workout the rider did not choose | #1242, #1244 |
| **R9** | **No menu of alternative paths mid-ride.** The rider is shown at most one pending change and one control that cancels it, *Keep the plan*. Never a list of options to choose between | Peloton 11 (margin) | The Ride screen and the HUD render one pending move and one control. A test asserts there is never more than one pending move | #1244 |
| **R10** | **No authored branches.** A move edits the rider's plan from ADR 0048 D-4's closed list. The workout format has no field for alternative paths, branches or options inside a workout | Peloton 18 (margin, on the narrow reading only) | The workout format's keys, as in R2 | #1239, #1242 |

**Optional margin, not a rule — option H** (§3.5): give the re-plan job no `recent_rides` and no
`history_search` tool. It adds a second missing element to '598 claims 1 and 19 and to '483. It costs
the re-plan the rider's history. **#1243 decides**, and says which it chose.

**What carries the distance.** For Pear it is **R1**, with R2 and R4 behind it, and R5 to R7 for
'871. For Peloton, **no rule here holds claims 1 or 18 as published** (§2.3). R9 and R10 are what
keeps the design away from the description's narrower embodiments, which is where an amended claim
is most likely to land.

---

## 7. Prior art, with dates (ADR 0007 D6)

A recording obligation, not a legal argument. Prior art is for a court or the PTAB to weigh, and
this spike does not say any of it invalidates anything. Each row predates Peloton's filing date of
2025-02-27.

| Reference | Date | What was read, 2026-10-10 | What it shows |
|---|---|---|---|
| **US4323237A**, Coats and Clark, *"Adaptive exercise apparatus"* | priority 1979-08-30, granted 1982-04-06. **Expired** | Abstract and claim 1, Google Patents | Raises the resistance when a performance objective is met, or keeps the load and shortens the time or raises the repetitions. Adapting a workout's intensity or duration from measured performance, during exercise |
| **US4800310A**, Combi Corp, *"Bicycle ergometer and eddy current brake therefor"* | priority 1983-07-08, granted 1989-01-24. **Expired** | Abstract and claims, Google Patents. ⚠️ The **claims** are about the brake. The heart-rate control is in the **abstract** | A bicycle ergometer with a pulse sensor and a control circuit that loads the brake *"to maintain the user's heart rate in a predetermined range"*. The heart-rate hold's lineage |
| **US9886871B1**, Pear | priority 2011-12-27, granted 2018-02-06 | All independent claims (§4) | Guidance that adapts during a workout from biometric data |
| **US10643483B2**, Pear | priority 2013-07-19, published as US20160151674A1 on 2016-06-02, granted 2020-05-05 | Independent claims 1, 9 and 18 | A segment parameter modified from the state of the user (its claims 2 and 3, read in passing: *"increased or decreased duration, distance or intensity"*) |
| **US11270598B2**, Pear | priority 2013-07-19, granted 2022-03-08 | All independent claims (§3) | Adjusting a segment parameter during a routine from biofeedback and a score |
| **US11850470B2**, Ergatta, *"System and method for improving cardio machine capabilities by dynamically adapting workouts to an athlete"* | priority 2020-07-31, granted 2023-12-26. **Active**, adjusted expiration 2041-12-23 | Abstract and claim 1, Google Patents | Modifying the length or intensity of a **future** interval from interval-by-interval comparison with prescribed performance. Claim 1 is limited to a **rowing machine**. ⚠️ Its other independent claims were **not** read |
| Hunt, K. J. and Hurni, S., *"Heart rate dynamics in a cycle ergometer"* ([PMC6828638](https://pmc.ncbi.nlm.nih.gov/articles/PMC6828638/)) | 2019 | As ADR 0048 records it | A first-order heart-rate model and closed-loop control at 0.2 Hz on a cycle ergometer |

**A language model choosing the move** has no dated prior art here. ADR 0048 already records that
none was found. **This spike ran no search for it**, so that absence is still not evidence.

---

## 8. Questions for a patent lawyer

These are worth paying for **before the agent half is built**, and Question B is worth paying for
now. None of them is *"are we safe"*.

**Question A: a claim chart of US 2026/0249137 A1 claims 1, 11 and 18 against ADR 0048's agent
half, and what to expect from examination.** The engineering reading is that claims 1 and 18 read as
published (§2.2), that they are broad enough to read on 1979 and 1983 art (§2.3, §7), and that the
description holds narrower material (authored branches in a class, options on the machine's display,
model-written voice instructions in an instructor's voice) that the design does not have. Is that a
fair forecast? **Worth buying before** #1242 to #1244 are built.

**Question B: the file wrapper, and a preissuance submission.** What is the application's status and
transaction history (§1.3 could not read it)? Has a first action issued? Is a continuation pending?
And **should the project make a third-party preissuance submission** of §7's art? As an engineer
reads 35 U.S.C. 122(e), not checked with counsel: one is accepted before a notice of allowance, and
before the **later** of six months after publication (publication was 2026-08-27, so about
**2027-02-27**) or the first rejection of any claim. **That is a clock, and it is the one thing in
this spike that runs out.** Worth buying now.

**Question C: *Keep the plan*.** Under claim 11, is announcing one pending change with one control
that cancels it *"presenting workout options"* and, when pressed, *"receiving a selection"*? Would
removing the control (the change applies with no way to refuse it) or replacing it with a per-ride
switch only change the answer? **This is a safety trade as well as a claim question**: ADR 0048 D-7
put the control there so a rider is never asked to decide at threshold, and also never left without
a refusal. Worth buying with A.

**Question D: the routine score.** Under '598 claims 1, 9 and 19 and '483, is a per-block
measurement of seconds inside a heart-rate range a *"routine score … indicating how the user is
able to follow and achieve segment goals"*? Does it change if a language model, rather than this
program, reasons over several blocks' summaries before choosing a move, without outputting a
number? Worth buying with A.

**Not being asked**: validity of any of the three, because this project will not fund a challenge.
The Pear history limb (option H), because it is a design choice #1243 can make without advice.

---

## 9. How to reproduce

```bash
# Peloton: the USPTO print server. The PDF is images only, so read page 17 by eye.
curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20260249137 -o 137.pdf
pdftoppm -r 300 -f 17 -l 17 -png 137.pdf p && tesseract p-17.png p17   # a cross-check, not the source

# Pear: Google Patents, route A of spike 0006 §1.4
curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US11270598B2/en -o 598.html
curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US9886871B1/en -o 871.html
```

Each Google Patents fetch was checked for **HTTP 200** and a **non-empty** `<section
itemprop="claims">` before anything was read from it, because spike 0006 §1.4 found that route
goes silent under a rate limit. The claims were extracted by stripping the section's tags. The
independent claims were identified by the `claim-dependent` class (§1.2).

**Not consulted**: the file wrappers of any of the three; the specifications of the two Pear patents
beyond their claims; Peloton's description beyond the paragraphs §2 cites (¶0075, ¶0081, ¶0089,
¶0093 to ¶0117 on pages 14 to 16); US 2026/0249138 A1; and any non-US family member.

---

## 10. What would make this spike wrong, and when it ages

- **Peloton's claims change.** Any amendment, grant or continuation makes §2 a chart of the wrong
  claims. A grant whose claims keep claim 1's breadth puts the agent half **and** the hold inside a
  granted claim, whatever §5 says about lineage.
- **The preissuance window closes unnoticed.** If Question B is not asked before about 2027-02-27,
  or before a first rejection that makes a later date apply, the cheapest response to §2 is gone.
- **A score arrives by another name.** A share of time in range, a running adherence figure, a
  "how you're doing" number on the HUD, or a progress bar toward the time-in-range goal during the
  ride. R1 is what stops it, and only if its test lands with #1244.
- **A re-plan sentence is chosen by anything but the event and the move**, or a workout grows a
  per-block cue field. Then R2 is gone, and R1 holds (i) alone.
- **A haptic is added to the ride path** for an unrelated reason. R3 goes, which matters only if R1
  or R2 has gone too.
- **The re-plan keeps its history tools** (option H not taken) **and R1 fails.** Then '598 claims 1
  and 19 have nothing left between them and the design except R2.
- **ANT+ returns**, or anything merges sensor data from two transports. '871 loses its strongest
  missing element.
- **'871's unread family member, or '598's** (§1.4), has issued or will issue with different claims.
  US20160240100A1 is abandoned, and no other pending member was found on Google Patents on
  2026-10-10. That is **weak evidence and not clearance**, as spike 0020 §1.3 says of its own
  search.
- **Anyone reads this as clearance.** It is three documents, read by an engineer, on one day.
