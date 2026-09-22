# Spike 0005: Is a live race between riders inside the claims ADR 0007 read, or others?

- **Date read**: **2026-09-22.** Every claim quoted below was read on that day from the granted
  patent as published by the USPTO through Google Patents. Each is reproducible with the command in
  §1.3
- **Issue**: [#466](https://github.com/openzigs/onyourleft/issues/466). Parent
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Where the chart is posted**: #466's first acceptance criterion asks for *"a dated claim chart
  posted here and linked from #16"*, and a file in this repository is not that. It is posted as
  [#466 comment 5782720581](https://github.com/openzigs/onyourleft/issues/466#issuecomment-5782720581)
  — the eleven-patent verdict table, §3.1's chart in full and §6's recommendation — and linked from
  [#16 comment 5782722227](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5782722227),
  which carries §5's purchase decision and the constraints this epic inherits. ⚠️ **This file is the
  full version and those comments are summaries**; where they differ, read this one
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."* The recommendation in §6 is a recommendation. The
  decision is [ADR 0028](../adr/0028-racing-fairness.md)'s and the owner's

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> [ADR 0007](../adr/0007-patent-posture.md) D1 says it of itself and it is repeated here because
> this document goes **wider** than that ADR did and a reader may mistake width for completeness.
> **No systematic landscape search was performed.** Eleven granted US patents were read because two
> known disputes and four keyword searches pointed at them. A freedom-to-operate opinion is a
> systematic search plus a legal conclusion by somebody qualified to give one; this is neither.
> **Anyone citing this spike as clearance is misusing it.** §5 names the questions a patent lawyer
> should be asked, on the model of ADR 0007's own Question 2.

---

## 1. What this was checked against, and what was read

### 1.1 The design being charted

From [#465](https://github.com/openzigs/onyourleft/issues/465) and
[#16](https://github.com/openzigs/onyourleft/issues/16). **Nothing of it is built** — #466's third
acceptance criterion is that no live-racing code is written before this closes, and none has been.
The shape charted below is:

| | |
|---|---|
| **A room** | Riders join a named room. There is no class, no course content, no video, no audio and nobody leading it |
| **The course** | A route one of the riders imported as a GPX, or a saved route. It is the athlete's own data (ADR 0002), not content served to them |
| **What travels** | Each rider's own **live** power, cadence and declared mass, at about **1 Hz**, while they are pedalling |
| **What is shown** | The other riders' **positions on the road**, as avatars in the same world the solo game already draws — distance along the route, not a ranked list of numbers |
| **What ends it** | A **finish order** — who crossed the end of the route first — and the elapsed times |
| **Who computes** | The client simulates for its own screen; the room re-simulates each rider from their reported power and declared mass through `packages/physics`, and the room's position wins (#465 decision 2) |
| **Explicitly absent** | No instructor. No exercise class, live or recorded. No previously recorded content of any kind. **No replay of any prior session**, this rider's or anybody else's. No synchronising signal embedded in content. No archived performance parameters |

⚠️ **"No replay" is the load-bearing one** and it is what makes this a different question from
ADR 0007 D4's. D4 rules on **ghosts**: an on-screen rider driven by a *recorded* ride. A live race
has no recording behind any rider — every position on screen is being produced by somebody who is
pedalling at that moment. A race with a ghost in it is D4's, not this document's.

### 1.2 What was read

Eleven granted US patents, claim text read in full for every independent claim. All eleven report
**Active** legal status on 2026-09-22.

| Patent | Title | Assignee | Priority | Independent claims | Anticipated expiry |
|---|---|---|---|---|---|
| **US 9,174,085 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1** | 2033-11-10 |
| **US 9,233,276 B1** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 13** | 2033-07-31 |
| **US 10,486,026 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 11** | 2033-07-31 |
| **US 10,639,521 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 11** | 2033-07-31 |
| **US 11,081,224 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 18** | 2033-07-31 |
| **US 11,170,886 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 19, 26, 27** | 2033-07-31 |
| **US 11,289,185 B2** | Exercise system and method | Peloton Interactive | 2012-07-31 | **1, 19, 26, 27** | 2033-07-31 |
| **US 11,040,247 B2** | Real-time and dynamically generated graphical user interfaces for competitive events and broadcast data | Technogym S.p.A. | 2019-02-28 | **1, 9, 16, 18** | 2039-02-28 |
| **US 11,602,671 B2** | Interactive network game with game conditions altered based upon group physical activity | **Zwift, Inc.** | 2018-11-01 | **1, 11, 20** | 2039-10-30 |
| **US 11,975,239 B2** | Virtual competitive event management system with result validation | ChallengeRunner LLC | 2020-04-16 | **1, 14, 19** | 2042-12-11 |
| **US 10,537,790 B2** | Methods and apparatus for virtual competition | Fox Factory, Inc. | 2008-11-25 | **1, 6, 12** | 2029-11-25 |

> ⚠️ **The expiry column is an estimate and must not be relied on**, for exactly the reason
> ADR 0007 gives: it is Google Patents' "Anticipated expiration" field, arithmetic from the earliest
> non-provisional filing, **not verified against Patent Term Adjustment or terminal disclaimers**.
> In a family with seven continuations both are live possibilities. If a date near the end of a term
> ever matters, get it from the file wrapper.

### 1.3 How to reproduce any of it

```bash
# Claim text, first-hand, for any of the eleven.
curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US9174085B2/en \
  | python3 -c "import sys,re,html; s=sys.stdin.read(); \
m=re.search(r'<section itemprop=\"claims\".*?</section>', s, re.S); \
print(html.unescape(re.sub(r'<[^>]+>',' ', m.group(0))))"
```

⚠️ **That command is not reliable and its failure is silent-looking.** Re-run later the same day it
returned Google's *"your computer or network may be sending automated queries"* page, from which the
regex finds no `claims` section. The fallback is the USPTO's own print server —
`curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/<number>` — which needs no
user agent and is the *granted document* rather than a rendering of it, but is a **scanned image**:
`pdftotext` extracts nothing and it has to be read by eye. §1.4 records the one passage in this
document that came from it.

The four searches that produced the non-Peloton four, all run 2026-09-22 against
`patents.google.com/xhr/query`, US grants only:

- `"slipstream" OR "drafting" virtual cycling avatar` — 49 results; the only relevant grants were
  Zwift's '671 and Wahoo's **US 12,465,811** (an indoor bicycle training *device* — hardware, and
  ADR 0007 already records that this project ships none).
- `"virtual race" "plurality of participants" real-time position exercise` — 10 results; produced
  ChallengeRunner's '239 and Fox Factory's '790 and '448.
- `"virtual race" "plurality of users" stationary bicycle real time positions leaderboard` — produced
  Technogym's '247 and the five Peloton family members ADR 0007 had not read.
- `zwift virtual cycling network game` — produced '671 and nothing else on point.

### 1.4 ⚠️ What was **not** read, stated as the gap it is

- **No non-US right.** Not one. ADR 0007's Open Question 2 is unchanged by this document, except that
  it now covers a wider family.
- **No pending application.** Every patent here is granted; the Peloton family has continued at
  least seven times from one 2012 priority and a design checked against granted claims is not
  checked against claims still in prosecution. **In a family with this continuation record that is
  the most important gap in this document.**

  ⚠️ **And what a continuation may claim is bounded by what the specification already discloses, so
  the gap is worth sizing rather than only naming.** '085's specification discloses peer competition
  and cross-rider normalisation closely enough to be worth quoting. Read 2026-09-22 from the granted
  patent's own USPTO print, page 26 — col. 14, under the heading *Gamification*:

  > *"the instructor or users can create mini-competitions for participation by all users or just a
  > selected subset of users such as a group of friends. Competitions such as sprints, hill climbs,
  > maximum power output, etc. can be preset or created in real-time … Competitions can be created
  > within a class or session, or across multiple classes or sessions like **multi-stage bicycle
  > races**. A wide range of **direct competitions can be created between and among users**, with the
  > different performance characteristics of different bikes **calibrated and normalized** to account
  > for differences in bikes based on different riders … the system provides locations or
  > technologies to validate stationary bikes to assure that the bikes in a particular competition
  > are properly **calibrated and normalized to establish a level playing field**."*

  and, in the same document at col. 13 (line 30 of the print's own numbering):

  > *"the system may also allow users to establish **handicapping systems to equalize the
  > competition** among different users or user groups allowing for broad based competitions."*

  ⚠️ **This changes no conclusion in §3 or §6, and must not be read as one.** Disclosure is not claim
  scope: every granted claim charted below still carries the *cycling class* limitation, and §3.1's
  reading is unchanged. It is recorded here for two reasons. It is concrete evidence for **§5
  Question C** — whether the continuation practice in this family is of a kind a design should be
  built to survive — and the disclosed subject matter is recognisably
  [ADR 0028](../adr/0028-racing-fairness.md) D-1 and D-2 (peer competition, normalisation across
  riders, a level playing field), so a lawyer answering **§5 Question A** should see this text
  alongside the claim rather than the claim alone.

  ⚠️ **Provenance, because it differs from everything else here.** The two passages above were read
  from the USPTO print at
  `image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9174085`, which is a **scanned image**:
  `pdftotext` extracts nothing from it and it was read by eye, page 26 of 28, on 2026-09-22. They are
  from the **specification**, not the claims; every claim quoted elsewhere in this document came from
  the source in §1.3. The line citations are the print's own centre-gutter numbering and are
  approximate to within a line or two.
- **The IPR2020-01541 certificate is still not read**, so ADR 0007's Open Question 1 stands
  verbatim. `patents.google.com/patent/US10486026K1/en` returned **404** and
  `patentimages.storage.googleapis.com` **403** on 2026-09-22 — the same two failures ADR 0007
  recorded on 2026-09-03. Nothing here rests on '026: the charts below reach the same answer for
  '026 whether its claims survived or not, because a live race fails its *archived* limitation
  either way.
- **Nothing about drafting as a physical model.** #465 decision 5 and
  [#327](https://github.com/openzigs/onyourleft/issues/327) ask whether the first races have
  drafting; the searches found **no granted US patent claiming a drafting or slipstream model in a
  virtual cycling environment** and the absence of a hit is weak evidence. It is recorded as
  **not established** rather than as clear.

---

## 2. The correction this reading forces, and why it matters

**#466's own body states that *"'886 claim 19 requires 'live performance parameters' collected from
users' sensors during a live session"*. Read first-hand, claim 19 requires a great deal more than
that** — and every additional element is one a live race lacks. This is ADR 0007 D7's failure mode
(*"an unverified patent assertion … everything downstream inherits it as settled"*) caught one step
earlier than usual, which is the only reason the correction is cheap. In full, '886 claim 19 requires
all of:

1. a **previously recorded on-demand exercise class**;
2. a **control station** providing its exercise content;
3. **at least one synchronizing signal** *included in* that class, indicating a **starting point and
   an ending point** for collecting parameters;
4. collection of live parameters **from the starting point indicated in that signal**;
5. synchronising them **according to that signal**;
6. **maintaining** them at a storage device with the exercise content;
7. providing them during a **subsequent** session, where they **"represent ghost riders"**;
8. **maintaining at least one live performance parameter as private**.

Elements 6, 7 and 8 mean claim 19 is not a live-racing claim at all: it is a **ghost** claim whose
live session is the *recording* stage. ADR 0007 D4's ❌ already forecloses what it reaches.

**The second correction is about scope of reading rather than about a fact.** ADR 0007 read **two**
members of the Peloton family. There are at least **seven** granted, all Active, all from one
2012-07-31 priority — and **the two ADR 0007 did not read are the two closest to a live race**:
US 9,174,085 and US 9,233,276 are the family's *live multi-user comparison* claims. §3.1 is why that
matters and it is this document's principal finding. ADR 0007 is not wrong about anything it says;
it is narrower than a reader would infer, and nothing in it claims otherwise — D1's *"six patents
were read because two known disputes pointed at them"* is exactly accurate.

---

## 3. The claim charts

Each row is one limitation of the independent claim, in the claim's own words, against the design in
§1.1. **Absent by construction** means the design has no component that could be argued to be the
element — not that it has a different one.

### 3.1 US 9,174,085 claim 1 — the closest claim in this document

This is the family's **live** claim. Read it before anything else here.

| Limitation (US 9,174,085 cl. 1) | A live race, per §1.1 |
|---|---|
| *"providing information about available **live and archived cycling classes** that can be accessed via a digital communication network … for display"* | **Absent by construction.** There is no class, live or archived, and nothing is offered for selection. A room is a room |
| *"providing an interface … whereby the first user **can select either a live cycling class or select among a plurality of archived cycling classes**"* | **Absent by construction.** No such selection exists. The rider picks a route they imported |
| *"receiving from the first user a **selection** of one of the available live or archived cycling classes"* | **Absent by construction** |
| *"sending **digital video and audio content** comprising the selected cycling class from a server"* | **Absent by construction.** No video, no audio, and no server holds a course. The world is drawn from the rider's own route (ADR 0026, `apps/web/src/game/`) |
| *"a display screen **associated with a first stationary bike**"* | **Arguably present.** A phone or tablet on the bars, driving a smart trainer. This is not a distinction to rely on |
| *"detecting a plurality of performance parameters from the first stationary bike … **at a particular point in the selected cycling class**"* | **Partly present, and the qualifier is absent.** Parameters are detected; *"a particular point in the selected cycling class"* is not a thing that exists |
| *"detecting a plurality of performance parameters from a **second user on a second stationary bike at a second remote location** at the same point in the selected cycling class"* | **Present**, but for the class qualifier. This is what a race does |
| *"displaying at least one of the … parameters detected from the second stationary bike on the display screen associated with the first stationary bike … **presented for comparison**"* | **Present in substance.** Showing another rider's position *is* presenting their performance for comparison, and arguing otherwise on the word "parameter" would be arguing rather than constructing |

**Reading.** Four of the eight limitations are absent by construction and all four are the **same
element**: a *cycling class* — offered, selected, and delivered as video and audio from a server.
Strip that element away and the rest of claim 1 describes a live race almost exactly. **So the whole
distance between this design and the closest claim found is carried by one limitation.** That is a
materially thinner margin than ADR 0007 D4's ✅ items enjoy, where three or four independent
limitations each fail on their own, and it is the sentence a reader should take away from this
document.

US 9,233,276 claims 1 and 13 are the same analysis. Claim 13 replaces *"a second user on a second
stationary bike"* with *"each of a plurality of other stationary bikes used by a plurality of other
users"* — closer still to a race field, and it does not move the class limitation, which remains in
both claims.

### 3.2 US 11,170,886 claims 1, 26 and 27, and US 11,289,185 claims 1, 19, 26, 27

'185 is '886 with *"synchronizing signal"* generalised to *"points in time"* and *"performance
parameters"* to *"activity information"*. Neither generalisation touches a limitation a live race
fails, so one chart serves both.

| Limitation (US 11,170,886 cl. 26, the broadest of the four) | A live race |
|---|---|
| *"the **previously recorded on-demand exercise class** being **led by at least one instructor**"* | **Absent by construction**, twice over. There is no recorded class and nobody leads anything |
| *"including exercise content and **at least one synchronizing signal** that indicates a starting point and an ending point for collecting performance parameters"* | **Absent by construction.** Nothing is embedded in content, because there is no content. Riders are positioned by distance along a route |
| *"a **control station** for collecting and synchronizing live performance parameters"* | **Arguably present.** The room is a networked party that receives parameters from several devices. This element should be conceded, not argued |
| *"providing the **exercise content** of the live session of the on-demand exercise class"* | **Absent by construction** |
| *"collecting live performance parameters from the sensors during the live session … **from the starting point indicated by the … synchronizing signal**"* | **Half present.** Live parameters are collected; the synchronising-signal qualifier is absent |
| *"providing the synchronized live performance parameters to the users during the live session … thereby enabling the users … to **participate with each other**"* | **Present in substance** |

**Reading.** Three independent limitations fail by construction — the recorded class, the
instructor, the synchronising signal — and each fails on its own. '886 claim 1 and claim 27 add
nothing a race has that claim 26 lacks; '886 claim 19 adds the ghost and privacy limitations of §2,
which push it further away still. **The '886/'185 pair is not the risk.** ADR 0007's assessment of
this pair is confirmed by a fuller reading, not disturbed by it.

### 3.3 US 10,486,026 claims 1 and 11, US 10,639,521 claims 1 and 11, US 11,081,224 claims 1 and 18

All six require an **archived** or **previously recorded** class and a **dynamically updating ranked
list**. A live race fails both, independently:

| Limitation | A live race |
|---|---|
| *"archived performance data … **previously generated by the other users** … while participating in the archived exercise class"* ('026 cl. 1) | **Absent by construction.** Every other rider is pedalling now. Nothing is replayed |
| *"a plurality of available **archived** exercise classes for selection"* ('521 cl. 1, '224 cl. 1) | **Absent by construction** |
| *"available archived **instructor-led** exercise classes"* ('224 cl. 1) | **Absent by construction**, twice |
| *"content … comprising video content and audio content and **at least one synchronizing signal**"* ('224 cl. 1) | **Absent by construction** |
| *"a **dynamically updating ranked list**"* ('026, '521, '224) | **Absent as designed, and this one is a design choice rather than a fact about the world.** The race shows **positions on a road** and, at the end, a **finish order**. §4 is why that distinction is thinner than it looks and what would make it disappear |
| *"numerical performance parameters for a plurality of **ghost riders** … previously generated by other users"* ('224 cl. 18) | **Absent by construction**, and already forbidden by ADR 0007 D4 |

### 3.4 US 11,040,247 (Technogym) claims 1, 9, 16, 18

| Limitation | A live race |
|---|---|
| *"determining … an **absolute performance threshold or a personal performance threshold**"* | **Absent by construction.** Nothing in a race is scored against a threshold. (`packages/domain/src/analysis/zones.ts` computes training zones from a threshold, but that is a solo analysis screen and is nowhere near a race) |
| *"determining … a **performance zone** based on a comparison of the real-time … data and the … threshold"* | **Absent by construction** |
| *"a real-time leaderboard **overlaid on a broadcast**"* | **Absent by construction.** There is no broadcast to overlay on |
| *"a **broadcast of a real-time video of an instructor** leading a workout"* (cll. 9, 16) | **Absent by construction**, twice |
| *"each entry comprises a **username and an icon that comprises a hue**"* (cl. 1), *"an **arcuate indicator that concentrically surrounds the icon**"* (cl. 18) | **Absent by construction** |

**Reading.** Not close. Every independent claim needs a threshold-derived *performance zone* and a
leaderboard *overlaid on a broadcast*; the design has neither concept.

### 3.5 US 11,602,671 (Zwift) claims 1, 11, 20

The only patent here held by a direct competitor in this product's own space, and therefore the one
most worth reading carefully. It is **narrower than its title**.

| Limitation | A live race |
|---|---|
| *"a competition involving **at least two competing groups** of individuals"* | **Absent by construction.** A race is individuals against each other, not group against group |
| *"a **win condition** requiring physical activity translated into movement of a digital avatar **in two distinct locations within a digital world**"* | **Absent by construction.** One route, one place, everybody on it |
| *"requiring **at least two different levels or types of physical exertion** to be completed by **at least two separate individuals within each group**"* | **Absent by construction.** One effort: ride the route |
| *"identify a winner as the first group or the second group"* | **Absent by construction.** The winner is a person |

**Reading.** Four limitations, all absent, and the claim is about a **team objective game** rather
than a race. ⚠️ **It becomes live the moment #16 wants team events** — and if a future issue proposes
"two teams, each with a sprinter and a climber, first team to light both beacons", that is this claim
almost word for word. Record it there rather than rediscovering it.

### 3.6 US 11,975,239 (ChallengeRunner) claims 1, 14, 19 — the result-validation one

The closest published claim to **#465 decision 2**, which is why it is charted rather than listed.

| Limitation | A live race, with #465's re-simulation |
|---|---|
| *"create a plurality of events … each … comprises a set of requirements for participating in that event and an event time"* | **Arguably present.** A room with a start time and a rule about who may join |
| *"the request comprises a **description of one or more participant devices** that are in the possession of the participant"* | **Absent as designed.** A rider declares a **mass**, not a device inventory. #465 decision 3's dual-recording option would introduce a device claim, so this element is a live design constraint rather than a settled absence |
| *"register the participant … as a **high trust participant** when the participant meets the set of requirements"* | **Absent as designed.** There is no trust tier |
| *"determine a **speed** of the participant based on a set of **position data captured by a position sensor**"* | **Absent by construction.** An indoor race has no position sensor and no GNSS. Speed is *computed* from power through `packages/physics` — the opposite direction |
| *"determine a **movement status** … based on … an **accelerometer** … selected from the group comprising **pedestrian motion and vehicular motion**"* | **Absent by construction.** No accelerometer, and neither category applies |
| *"the participant did not validly participate … when a **step count** … is not consistent with the speed"* | **Absent by construction.** No step count exists |
| *"cause a first **leaderboard** to display … results … for a plurality of **high trust participants**"* | **Half present** — a finish order — with the high-trust qualifier absent |
| cl. 19 adds *"an **event route** describing a geographical location"*, *"a set of **location data** … verify that … it substantially matches the event route"*, *"a set of **biometric data**"*, heart rate | **Absent by construction** for an indoor race. ⚠️ **Live for an *outdoor* virtual event**, which #16 does not propose and which would engage this claim directly |

**Reading.** The *idea* of validating a claimed result is unpatentable in the abstract; what is
claimed here is a specific outdoor apparatus — GNSS speed, accelerometer motion class, step-count
consistency. #465's re-simulation validates a **power** figure against **physics**, using none of
them. Outside, by construction, for an indoor race.

### 3.7 US 10,537,790 (Fox Factory) claims 1, 6, 12

Every independent claim requires *"**correlating a digital video feed** comprising one or more
monitored performances with a **Global Navigation Satellite System (GNSS) altitude and map log**"*
and *"a **real time re-creation** of a performance"*. No video feed, no GNSS log and no re-creation
of a past performance. **Absent by construction**, on three elements.

---

## 4. What a live race lacks by construction, and what it has

#466 asks for this plainly, so it is stated plainly.

### Lacks, by construction — no component exists that could be argued to be the element

| Element | Appears in |
|---|---|
| An **exercise class** — live, archived or on-demand | Every one of the seven Peloton patents |
| **Video and audio content** delivered as the class | '085, '276, '224, '247, '790 |
| An **instructor** leading anything | '224, '886, '185, '247 |
| A **synchronizing signal** (or "points in time") embedded in content | '224, '886, '185 |
| **Archived** performance parameters from a prior session | '026, '521, '224 |
| A **ghost rider** replaying anybody | '224 cl. 18, '886 cl. 19 — and already ❌ under ADR 0007 D4 |
| A **performance threshold** and a derived **performance zone** | '247, every claim |
| A **broadcast** to overlay anything on | '247 |
| **Two competing groups** and a two-location, two-exertion win condition | '671, every claim |
| **GNSS position data**, an **accelerometer**, a **step count**, a device inventory, a trust tier | '239, '790 |

### Has

| Element | Appears in | Note |
|---|---|---|
| Several people exercising at once, on networked devices | Every patent here | Unavoidable; it is what a race is |
| **Live** parameters from each rider's sensors, collected over a network | '085, '276, '886, '185, '247 | This is the race |
| Another rider's performance **shown on this rider's screen for comparison** | '085, '276 | Shown as a position on a road rather than as a number |
| A party that collects and distributes them — a "control station" on a fair reading | '886, '185 | Concede it; do not argue it |
| A **finish order** at the end | closest to '026/'521/'224's *ranked list*, and to '239's *leaderboard* | See below |

### ⚠️ The two places the margin is thin, and they are not the ones a reader expects

1. **The class limitation is doing all the work against '085 and '276** (§3.1). It is a strong
   limitation and it is absent by construction — but it is *one* limitation, where ADR 0007 D4's two
   ✅ items are each outside their claims on three or four independent grounds. **A design that
   drifted toward serving course content from a server would erode it**: a "featured route of the
   week", delivered from an instance with a video intro, is a step toward the one element that
   presently carries the whole distance.
2. **"A finish order" and "a dynamically updating ranked list" are closer than the words suggest.**
   A finish order *after* the race is not a list *dynamically updating during* it; but a race screen
   that showed live standings — 1st, 2nd, 3rd, updating as riders trade places — would be a
   dynamically updating ranked list of live performance parameters in plain language. It would still
   fail '026, '521 and '224 on their **archived** limitation, which is independent and absent. The
   point is that this is the element to be deliberate about, and deliberateness costs nothing today.

---

## 5. The questions for a patent lawyer

On ADR 0007 Question 2's model: a targeted opinion on a handful of claims, answerable from public
documents plus a short description of the design, **not** a freedom-to-operate study.

**Question A — a claim chart of US 9,174,085 claim 1 and US 9,233,276 claims 1 and 13 against the
design in §1.1.** This is the one worth buying and the others are optional beside it. The engineering
claim being tested is that the *cycling class* limitation — offered for selection, delivered as
digital video and audio from a server — is absent by construction from a peer race on a rider's own
imported route, **and that it is absent under the doctrine of equivalents as well as literally**,
where "a shared room with a route in it performs substantially the same function in substantially the
same way as a class" is exactly the argument an engineer is unqualified to weigh. §4 records that
this single limitation carries the whole distance. **Ask before any live-racing code is written**,
because the answer may constrain the design rather than merely bless it.

**Question B — does a "finish order", or live standings during a race, read on the *ranked list*
limitation of US 10,486,026 claim 1, US 10,639,521 claim 1 or US 11,081,224 claim 1, if the archived
limitation is assumed absent?** Cheap to ask alongside A, and the answer decides a UI question
(§4's second point) that is free to decide now and expensive to decide after riders have used it.
⚠️ **Bundle ADR 0007's Open Question 1 — the IPR2020-01541 K1 certificate for '026 — with this**, as
ADR 0007 already directs; it is still unread and a lawyer has the access this repository does not.

**Question C — what does the Peloton family's continuation record imply?** Seven grants from one
2012-07-31 priority, the most recent granted 2022-03-29. §1.4 records that **no pending application
was read**, and a design-around verified against granted claims is not verified against claims in
prosecution. The question is not "will they file" but **"is the continuation practice here of a kind
that a design should be built to survive, and if so which elements are the ones to keep clear of?"**

Three things a lawyer is **not** being asked, because nothing turns on them: whether Wahoo's
US 12,465,811 matters (it is an indoor trainer *device*, and this project ships no hardware);
whether Zwift's '671 matters today (it is a team-objective claim and #16 proposes individual racing —
ask it *then*, per §3.5); and whether any of these would survive a validity challenge (this project
will not fund one, so the answer changes nothing it would do).

---

## 6. Recommendation

**Live racing is outside ADR 0007 D4 as written — and D4's silence is not clearance, so a new ADR
should record the live-race constraints before any code is written.**

In three parts, because "outside D4" on its own would be read as more than it is:

1. **D4 does not reach a live race, and nothing here relaxes D4.** Its four parts are about
   **replay**: a synthetic bot ✅, the rider's own ride ✅, another rider's recorded ride ❌, a ranked
   leaderboard of ghost participants replaying prior sessions ❌. A live race replays nothing —
   every rider on screen is pedalling now. So this is a case D4 is **silent** about rather than one
   it permits, and **ADR 0007 D5's procedure is not engaged**: D5 governs relaxing a ❌, and no ❌ is
   being relaxed. ⚠️ A race with a ghost in it is D4's and is still ❌.
2. **A new ADR should record the live-race constraints anyway**, in D2's and D3's shape — a short
   list of things the design may not do, each checkable by reading our own code and none requiring a
   reader to have read a patent. From §4 the list writes itself: **no exercise class and no course
   content served from an instance; no instructor; no synchronising signal embedded in content; no
   archived or previously recorded performance parameters in a race; no performance-zone or
   threshold-derived leaderboard; no team-versus-team win condition spanning two locations; and
   deliberate care with live standings during a race.**
   [ADR 0028](../adr/0028-racing-fairness.md) D-7 is where they landed.
3. **Counsel before a public live race ships, not before the ADR is written.** Question A is the
   purchase; it is worth making once the room's shape is settled and before it is built, which is
   exactly the timing ADR 0007's own Question 1 recommends (*"a chart against a hypothetical design
   is wasted money"*). ⚠️ **Nothing in §4's "has" column is a reason to stop**, and nothing in it is
   a reason to go either: it is a reason to be deliberate about one limitation and one screen.

**What would make this recommendation wrong**, stated so a future reader can check rather than
re-derive:

- **A pending Peloton continuation issues with a live claim that drops the class limitation.** §1.4
  records that none was read, and this is the single change that would most alter §3.1's reading.
- **Question A comes back saying the class limitation is met by equivalents.** Then a live race is a
  design problem rather than a documentation one, and #16 stops until a design-around exists.
- **The room ever serves course content.** §4's first thin margin. Featured routes delivered from an
  instance are a product idea with a patent cost attached, and the cost is invisible unless it is
  written down here.
- **Anyone reads this as clearance.** It is eleven patents found by four searches, read by an
  engineer, in one day.
