# Spike 0032: a patent read on energy-budget pacing of computer opponents, for ADR 0061's lap-race bots

- **Date read**: **2026-11-01.** Every record below was fetched that day, and each says which source
  it came from
- **Issue**: [#1985](https://github.com/openzigs/onyourleft/issues/1985), a sub-issue of the lap-race
  epic [#1894](https://github.com/openzigs/onyourleft/issues/1894). It is the short spike the owner
  asked for on 2026-11-01 in answer to [ADR 0061](../adr/0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md)
  D-7 Q4 ([ruling on pull request #1984](https://github.com/openzigs/onyourleft/pull/1984#issuecomment-6557317199):
  *"Short spike, add note"*)
- **Rests on it**: the code pull request of [#1960](https://github.com/openzigs/onyourleft/issues/1960),
  which ADR 0061 D-6 says must not merge before this spike finishes
- **Number**: **0032.** `docs/spikes/` on `origin/main` `9c9b6cbc` holds 0001 to 0031 less 0009 and
  0021, and no open pull request carried a spike on 2026-11-01, so this takes the next free number
  (`SPIKE001`)
- **Status of this document**: a **spike write-up**. It records what was read and decides nothing.
  Anything for the owner or counsel is a numbered question in §8

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> It is the disclaimer [ADR 0007](../adr/0007-patent-posture.md) D1,
> [spike 0005](0005-live-racing-patent-read.md), [spike 0022](0022-re-plans-during-the-ride-patent-chart.md)
> and [spike 0030](0030-lap-race-expression-line-and-patent-read.md) carry. **No landscape search was
> run.** An engineer ran fourteen patent-database queries and seventeen web searches on one day,
> until the patent database stopped answering (§2.2), and read the claims of twenty US documents and
> the front pages of six more. A freedom-to-operate opinion is a systematic search plus a legal
> conclusion by somebody qualified to give one; this is neither. **Anyone citing this spike as clearance is misusing it.**

### What this write-up leaves out, on purpose

**No claim text beyond short quotes**, **no coordinate, place name or address** (the inventors' and
owners' addresses on the front pages are left out, and so are inventors' names), no Garmin FIT SDK
text (CLAUDE.md §6) and no load-metric trademark (`docs/agents/scope-and-ip.md`). *Critical power*
and *W′* are the physiology's own names for a quantity, as ADR 0061 uses them. Nothing here is copied
from any implementation.

---

## 1. The plan being checked

From [ADR 0061](../adr/0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md), accepted
2026-11-01. **None of it is built**; no code pull request for #1960 was open at the time of this read.

| | |
|---|---|
| **What it is** | A lap-race bot's power from **its tier, the road, the distance it has left and its own energy budget, and never any other racer** (D-1) |
| **What it may read** (D-2) | The bot's **tier**; the **course** (grade along the loop, lap length, lap count, race length), with the plan **fixed from the course before the start**; the bot's **own `effortDistance`**, from which the distance left is taken; the **budget the bot itself has spent**, in the critical-power and W′ style of `packages/domain/src/analysis/critical-power.ts`, drawn down above the tier's power and refilled below it. Each step is pure and seeded |
| **What it may never read** (D-3) | **Any other racer's** place, power, distance, offset, gap or finish (the rider is another racer); the bot's **own place or rank**; its **own `raceOffset`**, **drawn distance** and the race's **lap counter** |
| **Where its power goes** | Through `advanceBot` and `advance` in `packages/physics`: no new physics (D-2.5). **No game event reaches the trainer** (ADR 0060 D-2, ADR 0061 D-5.2) |
| **Bounds** (D-8) | Mean power within a named tolerance of the tier; a named surge ceiling, never over 7 W/kg; the −20 % floor kept; a closing sprint asserted on `effortDistance` |
| **Where it runs** | **Solo races only**, on the device, with no drafting for bots (D-4; ADR 0060 D-8) |

The elements a claim would have to find, for this read: **(P1)** a computer-controlled racer or
opponent; **(P2)** an energy, stamina or work-capacity budget of that racer's own, spent and refilled;
**(P3)** a plan fixed from the course before the start; **(P4)** a closing effort keyed to the
racer's own distance left; and **(P5)** nothing read from any other racer, the user included.

---

## 2. How it was read

### 2.1 Sources

- **Google Patents' query endpoint** (`patents.google.com/xhr/query`), as spike 0030 §9 used it, with
  the claims-only field `CL=(…)` for the later queries because full-text queries on these words
  returned mostly power-electronics and smart-home patents.
- **The USPTO print server's PDFs** (`image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/<number>`),
  HTTP 200 for every document asked for, for **granted patents and pre-grant publications alike**.
  The PDFs are images only, so the front page and the claims pages were rendered at 300 dpi and run
  through `tesseract`, as spike 0030 did. **Every claim reading in §4 and §6 is from that OCR text.**
  Quotes are corrected only for plain OCR slips (`1s` for `is`). **No page was checked by eye**, and
  no column number is given, because the OCR does not keep columns reliably.
- **A web search engine**, for candidates the database queries could not reach once the database
  stopped answering. Each US patent document it named was then read from the USPTO PDF; a search
  summary is never the source of a claim reading here. What it named and could not be read that way
  (a WO publication, an EP application, a paper) is in §5 and §6 and says so.

### 2.2 What could not be read

- ⚠️ **Google Patents answered HTTP 503 to the fifteenth request** (a longer form of C8), answered
  one more (C8 as listed), **and then answered 503 for the rest of the day**, both the query endpoint
  and the patent pages. It was not worked around. Seven assignee queries (§3, row A) were sent and
  **every one failed**, and no patent page could be opened for its legal-status events. **So no status word
  and no expiry in this write-up comes from Google Patents**; each is the front page's filing date and
  term adjustment, by an engineer's arithmetic, and says so.
- **WIPO Patentscope** served a human-verification page rather than the record, and
  **patents.justia.com** answered HTTP 403. Neither was pursued further.
- **Patent Center and the USPTO Open Data API were not tried**: spike 0030 §3.1 found the first returns
  a browser application shell and the second needs a key this project does not hold. So **no office
  status, maintenance-fee event or abandonment was read for any document.** §7 lists what that leaves
  open and who settles it.

---

## 3. The searches

All on 2026-11-01. "By title" means the listed titles were read and nothing was opened unless the
last column names it.

| # | Query (as sent) | Filter | Results | Opened |
|---|---|---|---|---|
| G1 | `("critical power" OR "anaerobic work capacity" OR "W prime" OR "anaerobic capacity" OR "anaerobic reserve")` + `(opponent OR "non-player" OR "computer-controlled" OR "virtual competitor" OR "virtual opponent" OR bot OR pacer OR "virtual rider")` + `(race OR racing OR competition)` | US, granted | 15 | none: all off topic by title |
| G2 | `(stamina OR energy OR "energy budget" OR fatigue OR reserve OR endurance)` + `("non-player" OR "computer-controlled" OR "computer controlled" OR CPU OR "AI opponent" OR "virtual opponent")` + `(race OR racing OR runner OR cyclist OR bicycle)` + `(pace OR pacing OR sprint OR "remaining distance" OR "distance remaining")` | `A63F13`, US, granted | 504 | first 40 by title; US 12,512,204 |
| G3 | `("critical power" OR "anaerobic work capacity" OR "anaerobic capacity" OR "W prime")` + `(pacing OR pace OR "pacing strategy" OR "power plan")` | `A63B`, US, granted | 14 | by title: none about an opponent |
| G4 | `(stamina OR fatigue OR "physical strength" OR "energy gauge" OR "remaining energy")` + `("non-player" OR "computer-controlled" OR CPU OR "computer controlled" OR "NPC")` | `A63F13/803`, US, granted | 56 | first 40 by title; front pages of US 12,364,922 and US 12,685,940 |
| G5 | `(horse OR "racehorse" OR runner OR marathon)` + `(stamina OR "physical strength")` + `(spurt OR "last spurt" OR "final stretch" OR "remaining distance" OR "distance to goal")` | `A63F13`, US, granted | 1 | US 9,566,516 |
| G6 | `("virtual competitor" OR "virtual opponent" OR "simulated competitor" OR "virtual pacer" OR "pace partner" OR "computer-controlled" OR "simulated rider" OR "virtual rider")` + `(anaerobic OR "critical power" OR fatigue OR "energy reserve" OR "work capacity" OR "physiological model")` | `A63B`, US, granted | 119 | first 50 by title: exercise hardware and monitoring; none opened |
| C1 | `CL=("critical power")` | US, all | 165 | first 40 by title; the Nautilus family (§4.5) |
| C2 | `CL=("anaerobic work capacity")` | US, all | 3 | US 11,090,007 |
| C3 | `CL=("critical power")` | `A63B`, US | 3 | the same Nautilus and NTT documents, and one activity-monitoring application |
| C4 | `CL=("critical power")` | `A63F`, US | 1 | none: a smart-contract game patent by title |
| C5 | `CL=(anaerobic)` + `CL=(virtual OR avatar OR opponent OR competitor OR pacer)` | US, all | 163 | first 40 by title, most of them wastewater; US 2009/0029769 |
| C6 | `CL=(stamina OR fatigue OR "physical strength")` + `CL=("non-player" OR "computer-controlled" OR NPC OR "computer controlled" OR CPU OR "automatically controlled")` + `CL=(race OR racing OR runner OR horse)` | `A63F`, US | 7 | front page of US 11,529,560 |
| C7 | `CL=("remaining distance" OR "distance remaining" OR "distance to the goal" OR "distance to the finish" OR "distance to a goal")` + `CL=("non-player" OR "computer-controlled" OR NPC OR opponent OR CPU OR "computer controlled")` | `A63F`, US | 11 | by title: none on point |
| C8 | `CL=("virtual competitor" OR "virtual opponent" OR "computer-controlled" OR "virtual pacer" OR pacer OR "non-player")` + `CL=(power OR wattage)` + `CL=(grade OR gradient OR slope OR terrain OR incline)` | `A63B`, US | 6 | by title: none on point. A longer form of this query was the first 503 |
| A | `assignee=` Zwift; Wahoo, Peloton, iFIT, ICON Health and Garmin each with pacer / virtual-competitor terms; Tacx | US | **not run** | every one answered HTTP 503 (§2.2) |
| W | Seventeen web searches: W′ balance and a virtual opponent; an energy reserve or stamina of computer racers with a final sprint; horse-racing stamina and spurt timing; stamina of non-player characters in sports games; a cycling-manager game's computer riders; Zwift's pace partners, twice; a virtual competitor on exercise equipment; virtual pacers on a cycling course; computer-generated competitors on a trainer; rowing games' computer opponents; the race game behind the Cygames filings, twice; and the status of three applications, four searches | web | — | US 5,186,460, US 6,722,973, US 8,360,835, US 6,656,049, US 2010/0062818, US 11,257,582, US 9,375,629, US 7,766,794, US 10,716,969, the fitness-partner family (§4.4), US 12,090,406, WO 2023/127578 (not read, §6), US 4,938,475, US 4,976,424 and US 7,662,064 |

---

## 4. The hits that come nearest, each read against the plan

**"Outside by construction"** means the plan has nothing that could be argued to be a required element
named in the cell. **"Outside by argument"** means the element is arguably absent but an engineer is
arguing, not reading. **"Unknown"** means the engineer cannot tell. None of these is an opinion on
infringement.

### 4.1 US 8,360,835 B2 — computer racers that burn stamina to reach the line empty, and sprint at a "sprint point"

| | |
|---|---|
| **Title, assignee** | *Virtual world of sports competition events with integrated betting system*. I-Race, Ltd. |
| **Filed / granted** | Appl. No. 12/289,231, filed **2008-10-23**, provisional 2007-10-23; published as US 2009/0149233 A1 on **2009-06-11**; granted **2013-01-29** (front page) |
| **Term** | Front page: adjusted by **926 days**. By arithmetic, 2028-10-23 plus 926 days is **2031-05-07**, if every maintenance fee was paid. **Fee status not read** (§7 item 3) |
| **Claims** | 5; **claim 1** is the only independent claim (PDF pages 25 and 26) |

**Why it is the nearest.** Its description says it plainly (PDF page 23, OCR): a competitor *"will have
an optimum speed for the track, at which its stamina is burnt at an optimal rate in order to reach
the finish line and have zero stamina left"*, and (page 24) a *"sprint point"* is *"the point at which a
competitor uses extra energy or strength to improve their position immediately near the end"*. That
is P1, P2 and P4 in a 2008 filing. **But a description is not a claim.** Claim 1, reduced:

| # | Limitation | The plan |
|---|---|---|
| 835-a | A live virtual event created **for world-wide gambling**, pari-mutuel, exchange or fixed-odds | **Absent**: there is no wager |
| 835-b | Real-time contestant behaviour so the outcome is emergent, using (i) goal-seeking AI under environmental constraints, (ii) *"genetic tactical tendencies"*, **(iii) *"contestant reaction to other competitors"***, (iv) the contestant's attributes | **(iii) is absent by D-3.1**: the plan never reads another racer |
| 835-c | Outcome determined in real time by perturbation models so it cannot be fixed or manipulated | arguably present (a seeded draw), not needed for the verdict |
| 835-d | Real-time odds, results or past-performance data **supporting wagering** | **Absent** |
| 835-e | Real-time visual access **on a simultaneous global basis** over the internet, simulcast or kiosks in gambling establishments | **Absent**: a solo race on the device |

**Verdict: outside by construction, on three independent elements** (835-a, 835-b(iii), 835-d). Its
description, **published 2009-06-11**, is prior art in the ADR 0007 D6 sense for a computer racer
pacing its stamina to the line and sprinting near the end.

### 4.2 US 2009/0029769 A1 — an avatar with a virtual metabolism (an application)

| | |
|---|---|
| **Title, applicant** | *Controlling avatar performance and simulating metabolism using virtual metabolism parameters*. Empire of Sports Developments Ltd. |
| **Filed / published** | Appl. No. 12/052,221, filed **2008-03-20**, provisionals 2007-12-21, Swiss priority 2007-07-27; published **2009-01-29** (front page). The search engine named a European counterpart, EP 2175949 A1, **not read** |
| **Status** | ⚠️ **Not read.** Whether anything was granted from 12/052,221 is not known (§7 item 1). Any patent from it would run from 2008-03-20, so to about 2028 plus any adjustment |
| **Claims as published** | Independent claims 1, 14, 15, 17 and 19 (PDF pages 27 to 29). Published claims are not granted claims |

| Published claim | Its limitations, reduced | The plan |
|---|---|---|
| **1** | An electronic game; an avatar equipped with a virtual metabolism of at least one metabolic parameter, **"wherein a user-selected action modulates"** it | **Outside by argument**: the bot's budget is moved by the bot's own plan, and no user action reaches it (D-3.1) |
| **14** | A user's computer, an avatar **controlled by the user's input device**, long-term metabolism parameters on a server and short-term ones on the computer | **Outside by construction**: a bot is not controlled by a user |
| **15** | A medium generating a game with an avatar whose virtual metabolism includes *"a computer-simulated physiological metabolic process of a real athlete"* | **Unknown.** It names no user control. Whether a W′-style budget is a *"simulated physiological metabolic process"*, and whether *"of a real athlete"* means a particular athlete (the bot is built from none, ADR 0060 D-7.1) or a process real athletes have, is a question of claim construction, not of engineering |
| **17, 19** | Items **marketed and sold** through the game that enhance the avatar | **Outside by construction**: nothing is sold |

**Verdict: unknown on published claim 15, and only its status can make that matter.** This is the
document that comes closest to P2 in words. As a 2009 publication it is also prior art for any later
claim to a game opponent with a physiological energy model.

### 4.3 US 2010/0062818 A1 — a virtual competitor from a workout file (an application)

| | |
|---|---|
| **Title, applicant** | *Real-time interaction with a virtual competitor while performing an exercise routine*. Apple Inc. |
| **Filed / published** | Appl. No. 12/207,126, filed **2008-09-09**; published **2010-03-11** (front page) |
| **Status** | ⚠️ **Not read** (§7 item 2). Any patent from it would run from 2008-09-09, so to about 2028 plus any adjustment |
| **Published claim 1** | A portable device with a **sensor** for the user's performance metrics; a processor **comparing them with *"a competitor workout file associated with the virtual competitor"***; a display of the comparison **in real time** (PDF page 11 onward). Independent claims 10, 15, 16, 17 and 20 were not reduced |

**Reading.** This is not about energy budgets at all, and it bears on **any** bot race, #92's pacer
included, not on this plan in particular. It is recorded because **D-2.2 moves one step toward it**:
a plan *"fixed from the course before the start"* could be argued to be a *workout file associated
with the virtual competitor*, where a pacing rule evaluated step by step is less like one. The
rider's power sensor and a live gap or standings display are present in the lap race whatever the
bot does. **Verdict: unknown, and only its status can make that matter.** ADR 0007 D4's ✅ for a bot
pacer was read against other claims, not this one.

### 4.4 The fitness-partner family — a virtual fitness partner with a pace, triggered by the user's motion

| | |
|---|---|
| **Documents read** | **US 12,499,637 B2** (granted **2025-12-16**) and **US 12,118,684 B2**, both titled for *a virtual fitness partner*, owned by their two named applicants (individuals). Claim 1 of each read (PDF, last three pages). The front page of **US 11,373,378 B2** (terminal disclaimer) was read too |
| **Family** | Per '637's front page, a chain of continuations: '684, US 11,748,959, '378, US 10,964,117, US 10,650,607, back to application 15/945,994, **filed 2018-04-05** (US 10,453,264). By arithmetic the family runs to about **2038-04-05**. **Live, and further continuations may be pending**: none was searched for |

**Claim 1 of '637, reduced** ('684 claim 1 is the same with *"at least one sensor"* for the fitness
tracker):

| # | Limitation | The plan |
|---|---|---|
| 637-a | Sensor data from the **user's** fitness tracker, processed into **the user's pace** on fitness equipment | present in the game (the rider's power and speed), not in the plan |
| 637-b | A partner generator; display data from **appearance data** in a partner profile | arguably present for any drawn bot |
| 637-c | A virtual position vector from **relative velocity of the user's motion and a partner pace**: distance and direction of the partner **relative to the user** | present in the race view for any bot, not in the plan |
| 637-d | **Event trigger monitoring data based on the [user's] motion data**, indicating one of several **partner actions** when a trigger condition is met | **Absent from the plan by D-3.1.** The description's own example of a trigger (PDF, OCR) is the partner **slowing when the user lags past a threshold**, which is rubber-banding to the user, the thing ADR 0060 D-9.1 and ADR 0061 D-3 forbid |
| 637-e | The partner shown **superimposed within images viewed by the user**, performing the triggered action | arguably absent: a rendered game world is not a view of the user's surroundings with a partner laid over it. That is an argument |

**Verdict for the plan: outside by construction on 637-d.** ⚠️ **Not read here, and worth a later
read**: the lap race's **item and lane choices** (`botDecision`, #1900 and #1959) do read the race,
the rider included (ADR 0061 D-3.4), and a bot *acting* when a rider is near is closer to 637-d than
any power rule is. That is outside this spike's question; §8 Question 4.

### 4.5 W′ balance and critical-power claims on a person: NTT and Nautilus

- **US 11,090,007 B2** (Nippon Telegraph and Telephone Corporation; PCT filed **2017-08-30**,
  adjusted by **147 days**, so about **2038-01-24** by arithmetic; granted 2021-08-17). Independent
  claims 1, 7 and 13 (PDF pages 14 to 16) each require **a heart rate obtained from a heart-rate
  monitor coupled to a body**, from which a residual anaerobic work capacity is calculated and shown
  or sent to compare athletic abilities. Dependent claim 3 recites the published W′-balance integral
  with its time constant (in the form Skiba et al. published in 2012, §5). **A bot has no heart
  rate, and the plan reads none: outside by construction.** The claim is on *estimating a person's*
  reserve from heart rate, not on spending a modelled one.
- **US 10,603,543 B2** (Nautilus, Inc.; filed **2018-11-15**, adjusted by 0 days, so
  **2038-11-15**) and its continuation **US 11,235,200 B2** (filed 2020-02-18, adjusted by
  **192 days**; by arithmetic **2039-05-26** unless a terminal disclaimer, not read, caps it). Claim 1
  of '543: a **workout apparatus** with an instrument **measuring the user's power output**, a work
  value per window size from that measurement, an **ability function fitted** to them, and a
  training program whose workout function stays under the ability function and **sets the
  apparatus's output or settings**. Claim 1 of '200: power functions from **the user's activities on
  different dates**, an ability function fitted to the largest work values, and a user-specific
  training program from it. **The plan measures no person, fits nothing (its budget per tier is a
  named constant, ADR 0061 Consequences), and nothing it does reaches the trainer: outside by
  construction.** The family's live application, **US 2022/0314069 A1** (17/579,530), was read on
  its front page only; its claims and status were not read. ⚠️ This family bears on a **rider-side**
  feature (a critical-power fit to the rider's own history that sets a workout), which is outside
  this question; §8 Question 5.

### 4.6 Other documents opened

| Document | What claim 1 needs, reduced | Reading for the plan |
|---|---|---|
| **US 5,186,460 A** (filed 1991-08-07, granted 1993-02-16; **expired** by arithmetic no later than 2011-08-07) | Claim 1: a two-dimensional array data structure of the course. Claim 6: speeding contestants within a distance of the finish **so that they finish at substantially the same time** | Claim 6 reads other contestants: outside by construction, and expired. Its abstract (*"allocating a reserve of energy to each contestant"*) is **prior art from 1993** |
| **US 6,722,973 B2** (filed 2001-11-13, 0 days; expired 2021) | A rearing-simulation apparatus whose requests depend on the player's responsiveness | Off point, expired |
| **US 6,656,049 B1** (Sega; filed 1999-02-25, 0 days; expired 2019) | A game apparatus with a turntable-shaped rotating input | Off point, expired |
| **US 11,257,582 B2** and **US 12,512,204 B2** (Fox Factory; granted 2022-02-22 and 2025-12-30) | '582: a downloadable course map with a data key, and GPS-certified course runs. '204: a geographical route simulated on a training device from recorded elevation, time and distance, with the user's biometrics | Off point for the plan: neither recites a computer opponent. The family's term was not computed (its earliest non-provisional filing was not read) |
| **US 7,766,794 B2** (Microsoft; filed 2007-11-02, 0 days; to 2027-11-02 if fees paid) | A heart-rate target-achievement score and the user's **ranking** against virtual competitors | Outside by construction: no heart rate, no score, no ranking in the plan |
| **US 9,375,629 B2** (filed 2012-07-02, 526 days; to about 2033-12) | Power derived from the user's heart rate; position in a pre-recorded video | Off point |
| **US 10,716,969 B2** (Aviron; filed 2017-10-30, 165 days; to about 2038-04) | One user's command applying the same difficulty change to peer devices | Off point; and nothing reaches the trainer |
| **US 12,090,406 B2** (Cygames; continuation of US 11,813,527) | A play-stamina parameter consumed to start a game and recovered with time | Off point: a player's play allowance, not a racer's effort |
| **US 9,566,516 B2** (Sony) | A golf shot's power from input timing (abstract) | Off point |
| **US 11,529,560 B2** (Tencent) | A pursuing car reducing a fleeing car's endurance by hitting it (abstract) | Off point, and it reads another racer |
| **US 12,364,922 B2** (Nintendo) | Branch routes opened or closed by a racer's progress (abstract) | Off point |
| **US 4,938,475 A** and **US 4,976,424 A** (granted 1990; expired) | Load calibration; heart-rate load control on a bicycle stand | Expired. Their descriptions of **simulated riders on a cycling trainer** are prior art from 1990 |
| **US 7,662,064 B2** (Garmin; filed 2007-12-13, adjusted by 5 days, a division of application 10/993,175 of 2004-11-19, which continues an earlier one; Google Patents' search listing gives priority 2003-06-17) | Not reduced: a virtual competitor from a performance profile, per a search summary | **Expired** by arithmetic by 2024-11-24 at the latest; not opened past the front page |

---

## 5. Non-patent prior art noticed

Not read as papers here, and named so that nobody has to find them again. **Prior art does not make a
granted claim go away** without a challenge this project will not fund (spike 0030 §8 Question 5);
it bears on what a *later* claim could validly cover.

- **Skiba, Chidnok, Vanhatalo and Jones, 2012**, *Modeling the expenditure and reconstitution of work
  capacity above critical power*, Medicine & Science in Sports & Exercise 44(8). The W′-balance model
  that `critical-power.ts`'s style and NTT's claim 3 both follow.
- **arXiv 2007.11393** (2020), *Optimal pacing of a cyclist in a time trial based on individualized
  models of fatigue and recovery*. As the search engine summarised it, it computes **a table of power
  by position on the course before the ride**, by dynamic programming, and reads it during the ride:
  P2, P3 and P4 together, for a human rider. Not read beyond that summary.
- **The 2009 publication of US 8,360,835** (§4.1) and **US 5,186,460** (§4.6) for computer racers with
  a reserve of energy.

---

## 6. Noticed, not read

1. ⚠️ **WO 2023/127578 A1** (Cygames, Inc.; PCT/JP2022/046695). The search engine described it as
   classed for **controlling game characters by their stamina or energy level**, with Korean and
   Chinese national entries, and it belongs to the filings behind a horse-racing game whose
   characters run out stamina and time a **last spurt by distance left**. That is the shape of P2 and
   P4 for computer racers, filed in 2022 and live. **Its claims were not read**: Google Patents was
   answering 503 and Patentscope served a verification page. **No US national entry was found**, which
   is "none found", not "none exists". Japanese grants from the same applicant surfaced by title only:
   JP 7193608 B1, JP 7197673 B1, JP 7185081 B1, JP 7174113 B1. §7 item 4.
2. **EP 2175949 A1**, the European counterpart of §4.2. Not read.
3. **Further continuations of the fitness-partner family** (§4.4) and of the Nautilus family (§4.5). Not searched.
4. **The assignee queries** (§3 row A). Not run.

### Outside this spike's question, and filed separately

- **US 12,685,940 B2** (Nintendo, priority JP 2022-11-09, filed 2023-11-02, adjusted by **350 days**,
  granted **2026-07-21**). It surfaced in search G4. Claim 1 (PDF, last three pages) selects an item
  for a racing game object from **probability parameters generated from the current game situation
  that relates to the game's result**, with a fallback to second data when the first selects nothing,
  and appearable items set randomly or by the user. **That bears on #1899 rule 2 (rank-weighted item
  draws), not on the bots' power**, and it was granted before spike 0030 §4.2 read *"no granted claim
  was found"* on 2026-10-30. It is not charted here; it is filed as its own spike issue so that a
  reading of it lands where #1899's does:
  [#1988](https://github.com/openzigs/onyourleft/issues/1988).

---

## 7. Could not confirm

Each with the step that would settle it and who owns that step.

1. **Whether any patent was granted from application 12/052,221** (US 2009/0029769, §4.2), and if so
   its claims and status. Settled by a person opening Patent Center (`patentcenter.uspto.gov`,
   application 12/052,221) in an ordinary browser and reading its status and any patent number, with
   the date read. **The project owner.**
2. **The same for application 12/207,126** (US 2010/0062818, §4.3). **The project owner.**
3. **US 8,360,835's maintenance fees** (§4.1). It is outside by construction whatever they show, so
   **nobody needs to**; recorded for completeness.
4. **WO 2023/127578's claims, and whether any US filing claims its priority** (§6 item 1). Settled
   by reading the WO publication's claims (Google Patents' English machine translation is enough for
   an engineering reading) and its family list in a browser. **The project owner, or anyone with a
   browser**; counsel only if its claims read on §1's P1 to P5.
5. **The assignee queries of §3 row A**, run as written. **Anyone**, on a day the database answers.
6. **Columns and an eye-check of the OCR** for every claim quoted. **Anyone, before a later issue
   relies on one of them.**
7. **Any patent outside these searches**: non-US rights, live applications beyond the two read, and
   claims whose words these queries did not hit. Settled only by a professional search (§8 Question 6).

---

## 8. Questions for the owner and counsel

1. **For the owner: do items 1, 2 and 4 of §7 before #1960's code merges.** Each is a browser read of
   minutes. **This is the engineering recommendation, and it is what §9's conclusion rests on.**
2. **For counsel, only if §7 item 1 shows a granted claim like published claim 15**: is a W′-style
   budget of a computer racer, built from no athlete, *"a computer-simulated physiological metabolic
   process of a real athlete"*?
3. **For counsel, only if §7 item 2 shows a granted claim like published claim 1**: is a bot's plan
   fixed from the course before the start a *"competitor workout file"*? This would bear on every bot
   race, not only this plan, and would belong with the counsel questions kept on
   [#1234](https://github.com/openzigs/onyourleft/issues/1234).
4. **For the owner: should the bots' item and lane choices** (#1900, #1959), which read the race and
   the rider, **be read against the fitness-partner family's 637-d** (§4.4)? Not needed for the energy plan.
5. **For the owner: is a rider-side feature that fits a critical-power curve to the rider's own
   history and sets a workout from it planned?** If so, the Nautilus family (§4.5) should be read
   against it first. Not needed for the energy plan.
6. **For counsel, if the owner wants more than this**: a proper search with classification tools and
   non-US coverage for stamina- or energy-paced computer opponents in games and exercise. **Not
   asked**: any validity question.

---

## 9. Conclusion, as an engineering reading

**Nothing granted that was read reads on ADR 0061's plan.** Every granted claim opened either needs
something the plan forbids (another competitor's behaviour, the user's motion, a ranking), something
it does not have (a wager, a heart rate, a measured person, a sale, a trainer set from the plan), or
is expired. **The genre's idea is old**: a computer racer spending a reserve to reach the line and
sprinting near the end is in a 1993 patent's abstract and a 2009 publication's description, and the
W′-balance model was published in 2012.

**So ADR 0061 D-6's reading stands as far as it goes**: the plan sets no target rank, and no claim
read here on energy budgets reaches it. **But this spike does not finish the search D-6 asked for.**
Two published applications whose claims come near in words (§4.2 claim 15, §4.3 claim 1) have no
known status, and one live family of exactly the right shape (§6 item 1) was not read, because the
database stopped answering. **No new ADR reading is needed unless one of those three shows a live
claim; the three reads of §7 items 1, 2 and 4 should be done before #1960's code pull request
merges** (§8 Question 1). If any of them shows a live claim reading on P1 to P5, that is a new
reading before the merge, and it goes to counsel through #1234.

---

## 10. How to reproduce

```bash
# A Google Patents query, as §3 sent them (the inner query is URL-encoded once). CL= searches claims only.
curl -sL -A 'Mozilla/5.0' 'https://patents.google.com/xhr/query?url=q%3DCL%3D(%22anaerobic%20work%20capacity%22)%26country%3DUS&exp='

# A granted patent or a pre-grant publication from the USPTO print server: images only, so render and OCR.
curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8360835 -o 835.pdf
pdfinfo 835.pdf | grep Pages
pdftoppm -r 300 -f 25 -l 26 -png 835.pdf p && for f in p-*.png; do tesseract "$f" -; done
curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/20090029769 -o 769.pdf
```

The pages used: front pages (page 1) of every document in §4; claims at US 8,360,835 pp. 25–26 and
its description at pp. 23–24; US 2009/0029769 pp. 27–29; US 11,090,007 pp. 14–16; the last three
pages of US 2010/0062818, US 12,499,637, US 12,118,684, US 10,603,543, US 11,235,200, US 10,716,969,
US 12,090,406 and US 12,685,940; the last two of US 11,257,582 and US 4,976,424; the last four of
US 7,766,794, US 9,375,629 and US 4,938,475.

---

## 11. What would make this spike wrong, and when it ages

- **§7 item 1, 2 or 4 shows a live claim** on a computer opponent's energy budget, a plan fixed before
  the start, or a sprint keyed to its own distance left. §9's conclusion then needs a new reading.
- **The plan comes to read the rider or any other racer** (ADR 0061 D-3). US 8,360,835's 835-b(iii),
  US 5,186,460's claim 6 and the fitness-partner family's 637-d all turn on exactly that.
- **Bots enter rooms, or are sold, wagered on or broadcast.** 835-a, 835-d and 835-e and published
  claims 17 and 19 of §4.2 come back into play.
- **The bot's budget is fitted to a person's power history**, or a bot is built from a rider (ADR
  0060 D-7.1). The Nautilus family and published claim 15's *"real athlete"* move.
- **Anything from the plan reaches the trainer.** The Nautilus claims and ADR 0060 D-2 both turn on it.
- **A patent outside these searches**, most likely, since seven of the planned queries could not be
  run.
- **Anyone reads this as clearance.** It is fourteen queries, seventeen web searches and twenty
  documents' claims, read by an engineer on one day.
