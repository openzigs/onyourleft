# Spike 0030: the expression line and a patent read for a lap race with position-weighted items and bots on a trainer

- **Date read**: **2026-10-30.** Every record below was fetched that day and each says which source
  it came from. Status lines say whether they come from an office record or a secondary source
- **Issue**: [#1896](https://github.com/openzigs/onyourleft/issues/1896). Parent epic
  [#1894](https://github.com/openzigs/onyourleft/issues/1894) (a lap race with items and bots, where
  no game event reaches the trainer). Proposed decisions it reads against: ADR 0060
  ([#1895](https://github.com/openzigs/onyourleft/issues/1895)), written in a separate pull request
- **Rests on it**: [#1899](https://github.com/openzigs/onyourleft/issues/1899) (item rules),
  [#1900](https://github.com/openzigs/onyourleft/issues/1900) (bots),
  [#1907](https://github.com/openzigs/onyourleft/issues/1907) (the chooser entry, which puts the mode
  in front of riders), and through #1895 D-9 and D-11 the owner's answers there
- **Number**: **0030.** `docs/spikes/` on `origin/main` `f5fef915` holds 0001 to 0029 less 0009 and
  0021, and no open pull request carried a spike on 2026-10-30, so this takes the next free number
  (`SPIKE001`)
- **Status of this document**: a **spike write-up**. It records what was read and decides nothing.
  Anything for the owner or counsel is a numbered question in §8

> ## ⚠️ This is not legal advice, and it is not a freedom-to-operate opinion
>
> It is the disclaimer [ADR 0007](../adr/0007-patent-posture.md) D1,
> [spike 0005](0005-live-racing-patent-read.md), [spike 0022](0022-re-plans-during-the-ride-patent-chart.md)
> and [spike 0028](0028-delivery-mark-and-patent-read.md) carry. **No landscape search was run.** An
> engineer ran eight keyword searches on one day, opened thirteen patents, and read one trademark
> record and one court summary. A freedom-to-operate opinion is a systematic search plus a legal
> conclusion by somebody qualified to give one; this is neither. Nor is §2 a trademark or
> unfair-competition clearance. **Anyone citing this spike as clearance is misusing it.**

### What this write-up leaves out, on purpose

It holds **no art, sprite, sound, course layout, item design or text** from any game, **no claim
text beyond short quotes**, **no coordinate, place name or address** (owner addresses in the records
are left out for that reason), and no Garmin FIT SDK text (CLAUDE.md §6). It names the kart series
**only where a record does**, in a field quoted from that record. Elsewhere it is "the kart series".

---

## 1. The design being checked

From the epic #1894 and the proposals in ADR #1895. **None of it is built.** The shape checked in §6:

| | |
|---|---|
| **The device** | The rider's own smart trainer and bike, through BLE (owner decision D2). This project ships **no hardware** |
| **Speed** | The rider's power through the one physics (`packages/physics` §`advance`). The trainer is sent **the road's grade at the rider's effort distance and nothing else** (#1895 D-2, D-3 option A) |
| **The race** | Several laps of a **loop route the rider imported or saved** (#1895 D-11, ADR 0028 D-7.1). A finish order at the line; live standings in W/kg per ADR 0051 |
| **Items** | Picked up at fixed fractions of the lap. The item a racer gets is drawn from a table keyed by **race position band**, by a seeded draw (#1899). An item moves only a bounded **race offset**, the drawn lane, or the item held (#1895 D-4, D-5). **One item held at a time; matching items never combine** (#1899 rule 4) |
| **Bots** | The #92 bot: power from a target W/kg tier and a pacing rule, position through `advance` (`packages/physics/src/pacer.ts` §`advanceBot`). **Never a recorded ride** (ADR 0007 D4). Proposed: **no change of a bot's power with its race position** (#1895 D-9) |
| **Input** | Three lanes, by keys, bar buttons, a gamepad, and touch controls when the touch lock is off (#1901, #1895 D-13) |
| **Where it runs** | Solo against bots on the device with no instance; against other riders through the rider's own instance (phase 2) |
| **Not in the design** | No team win condition (ADR 0028 D-7.6). No item that changes mass, `C_D·A`, drafting or power. No bots in rooms (#1895 D-8). No stored history of item events |

---

## 2. The expression line

### 2.1 Rules versus expression, in our own words

[Spike 0028](0028-delivery-mark-and-patent-read.md) §4 summarised three US cases on where the line
sits between a game's rules and its protected expression: ***Tetris Holding v. Xio Interactive***
(D.N.J. 2012), ***Data East v. Epyx*** (9th Cir. 1988) and ***Spry Fox v. Lolapps*** (W.D. Wash.
2012). They are not re-summarised here; the same caveat applies (read from secondary summaries, not
the opinions). For a kart racer the shape is the same: **the mechanics of a lap race with pick-up
items, catch-up weighting and computer opponents are rules**, and are not what any of those cases
protected. **What a copy of a kart game would take is its characters, the look and behaviour of its
named items, its course designs, its sounds and its overall get-up**, and those are what the cases
found protected or arguably so.

### 2.2 The marks, read from TSDR

**Source**: `https://tsdr.uspto.gov/statusview/sn79263442`, HTTP 200. The page says of itself: *"This
page was generated by TSDR on 2026-10-30 15:03:03 EDT"*. Quoted fields:

| Field | Value read |
|---|---|
| Mark | **MARIOKART**, standard characters |
| US serial / registration | **79263442** / **6109886**, registered **2020-07-28**, Principal Register. International registration 1478203A |
| TM5 status | **LIVE/REGISTRATION/Issued and Active**. Status: *"A partial Section 71 declaration has been accepted"*, status date 2026-09-23 |
| Current owner | **Nintendo of America Inc.**, a corporation |
| Classes | 014, 018, 024, 025, **028** (toys, video game machines and controllers among them) and 041 **ACTIVE**; 016, 021, 030 and 032 **SECTION 71 - CANCELLED** |

**Not read**: a US word mark for the series' name in **class 009 (game software)**. A web search on
2026-10-30 named serial **79429191** (a pending later mark in class 9); TSDR answered **HTTP 403**
for it that day, and it was not read by any other route. The series' class 009 coverage is §8
Question 1. Nothing in this project needs it settled, because #1895 D-1 already forbids any name,
character or get-up of the series; it is recorded so nobody reads the table above as complete.

### 2.3 Trade dress: a court summary, read first-hand

**Source**: the Intellectual Property High Court's English summary,
`https://www.ip.courts.go.jp/vc-files/ip/file/002467.pdf`, HTTP 200, read as text on 2026-10-30.
**Case**: 2018 (Ne) 10081 (principal action) and 2018 (Ne) 10091 (counterclaim), Intellectual
Property High Court, Second Division, **interlocutory judgment of 2019-05-30**, under the Unfair
Competition Prevention Act of Japan.

What the summary records, in short: the court held that the series' name in Japanese and in Latin
letters was **famous as an indication of the plaintiff's goods or business**, that the defendant's
similar marks were used as such indications, and that **the shapes of four of the series'
characters were famous indications too**, so that costumes resembling them, worn and rented out in
a street go-kart business, fell under Article 2(1)(ii). Domain names similar to the name fell under
Article 2(1)(xiii).

The **final judgment of 2020-01-29**, raising the damages, was read **only in secondary reports**
(news and IP-firm summaries found by a web search on 2026-10-30), not from the court. No conclusion
for US or EU law is drawn from a Japanese unfair-competition case.

### 2.4 What the mode must not resemble, at the level the issue asks

Drawn from §2.1 to §2.3 and from ADR 0059 D-1's shape. It is a list for #1895 D-1, not a legal
test:

1. **No character** of the kart series, and no rider styled, costumed or coloured to suggest one.
2. **No item recognisable as one of the series'** in look, name, sound or described behaviour. Being
   an item that moves a rival back is a rule; being one of the series' items is expression.
3. **No course or circuit design** taken from the series (layout, set pieces, signage, music).
4. **No name, logo, wordmark, sound or get-up** of the series, and the mode names no other game
   anywhere a rider sees (the store listing and release notes included).
5. **No trainer app's power-up names or icons** ([ADR 0009](../adr/0009-clean-room-posture.md), the
   clean-room posture toward Zwift). The epic's sources describe one trainer app's power-ups as
   changes to drag and mass; this design refuses those **as mechanics** (#1895 D-4, D-5), which also
   keeps it apart in behaviour.

---

## 3. Patents named in the issue, read from the granted text

### 3.1 How each was read

Claim text was read from the Google Patents page (HTTP 200, a non-empty `<section
itemprop="claims">`). **Every column below was read from the granted patent itself**, the USPTO print
server's PDF (`image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/<number>`). The PDFs are
images only, so the claims pages were rendered at 300 dpi and run through `tesseract`. **Pages
checked by eye as well**: US 7,278,913 page 21, US 11,103,784 page 51, US 11,071,911 pages 34 to 36,
US 11,484,783 page 50 and US 11,173,342 page 19. Any other column is the OCR's order (which half of
the page a claim's first line falls in) and says so. Term adjustments are read from each front page's
*"(\*) Notice"* field. **Status words and expiry dates are Google Patents' reading of the legal data,
a secondary source**, unless a line says otherwise.

⚠️ **No US office record of status was read.** Patent Center
(`patentcenter.uspto.gov/retrieval/public/v2/application/data?applicationNumberText=10968254`)
returned its browser application shell, not data, and the USPTO Open Data API
(`api.uspto.gov/api/v1/patent/applications/10968254`) answered **HTTP 401 Unauthorized**: it needs a
key this project does not hold. §7 lists what that leaves open.

### 3.2 US 7,278,913 B2 — computer racers with target ranks

| | |
|---|---|
| **Title, assignee** | *Racing game program and video game device*. Nintendo Co., Ltd. |
| **Filed / granted** | Appl. No. 10/968,254, filed **2004-10-20**, priority JP 2003-11-04 / granted **2007-10-09** (front page) |
| **Term** | Front page: *"extended or adjusted under 35 U.S.C. 154(b) by **183 days**"*. By an engineer's arithmetic: 20 years from 2004-10-20 is 2024-10-20; plus 183 days is **2025-04-21** |
| **Status** | Google Patents (secondary): **"Expired - Lifetime"**, adjusted expiration **2025-04-21**, which matches the arithmetic. The epic's source (evorix.jp, a secondary source, read 2026-10-30) said "probably around April 2025". **Not confirmed from the office record** (§7 item 1) |
| **Independent claims** | **1** (col. 11, about lines 20 to 40), **12** (col. 12, from about line 65). Claim 11 is a device comprising claim 1's medium |

**Claim 1, reduced to its limitations** (claim 12 is the method of the same steps):

| # | Limitation |
|---|---|
| 913-a | A racing game in which a player moving object controlled by a human and **a plurality of non-player moving objects** controlled by a predetermined algorithm race on a course in a virtual space |
| 913-b | A **target rank setter**: *"setting different target ranks for at least two of the plurality of non-player moving objects"*, the target ranks *"set irrespective of a current rank"* of any of them |
| 913-c | A **driving performance value changer**: changing a preset driving performance value of each non-player object **according to its target rank** |
| 913-d | An automatic controller driving each non-player object by its changed performance value |

Dependent claim 3 (col. 11) adds the familiar part: a bot's speed is controlled *"so that the current
rank thereof comes closer to the target rank"*.

### 3.3 US 11,103,784 B2 — matching held items trigger a stronger effect

| | |
|---|---|
| **Title, assignee** | *Storage medium storing information processing program, …*. Nintendo Co., Ltd. |
| **Filed / granted** | Filed **2019-04-25** / granted **2021-08-31** (Google Patents events; front page read for the term) |
| **Term** | Front page: *"extended or adjusted under 35 U.S.C. 154(b) by **118 days**"*. By arithmetic: 2039-04-25 plus 118 days is **2039-08-21** |
| **Status** | Google Patents (secondary): **"Active"**, adjusted expiration **2039-08-21**, matching both the arithmetic and the epic's secondary source. Maintenance-fee status **not read** from the office record (§7 item 2) |
| **Independent claims** | **1** (col. 49, by the OCR's order: it follows the end of the description at the top of page 50), **20** (col. 51, line 14), **21** (col. 51, line 60), **22** (col. 52, line 41). Claims 20 to 22 carry the same limitations as claim 1; the two limitations 784-e and 784-f below were checked in all four |

**Claim 1, reduced to its limitations:**

| # | Limitation |
|---|---|
| 784-a | Controlling a player object through a virtual space on the user's input |
| 784-b | During the game, **for each of a plurality of in-game options** (slots), setting a value that indicates possession of one of a plurality of game objects, and displaying an image of each possessed object |
| 784-c | Selecting a possessed object and enabling a **first in-game effect** based on its type, then clearing that slot's possession value |
| 784-d | While the player object is controlled, determining whether **at least two of the slots' values satisfy a combinational condition**, and if so enabling a **second, different effect** |
| 784-e | The combinational condition is satisfied by *"at least two of the values being the same"*, and not by slots set to non-possession |
| 784-f | The second effect includes the first effect occurring *"a number of times that is more than a total number"* of the matching values |

### 3.4 JP 6921193 B2 — the steering process chosen by where a touch starts, and its US counterpart

| | |
|---|---|
| **JP 6921193 B2** | Nintendo Co., Ltd. Filed **2017-05-22** (as PCT WO 2018/216080), granted **2021-08-18**. Google Patents (secondary): **"Active"**, anticipated expiration **2037-05-22**. Claims read from Google Patents' Japanese text and its machine translation; **the granted JP publication itself was not read**, so no column or page is given (§7 item 3) |
| **US counterpart: US 11,071,911 B2** | Same priority (2017-05-22). Filed 2019-11-20, granted **2021-07-27**. Front page: term adjusted by **0 days**. Google Patents: **"Active"**, anticipated expiration **2037-05-22**. Independent claims **1** (col. 28, line 22), **10** (col. 29, line 56), **11** (col. 30, line 36), **16** (col. 31, line 45), each read by eye |
| **EP counterpart: EP 3608002 A1** | Google Patents: **"Withdrawn"**. Not read further |
| **Family members noticed, not read** | A JP divisional, JP 7150108 B2 (filed 2021-07-27), appears in the JP page's events and was not opened |

**US 11,071,911 claim 1, reduced** (claim 1 of the JP patent reads the same way in translation):

| # | Limitation |
|---|---|
| 911-a | Repeatedly acquiring input positions from a pointing device |
| 911-b | If a movement input **starts outside a predetermined area**, setting a first reference position and moving an object by a **first movement process** from that reference and the continued input |
| 911-c | If it **starts inside the area**, setting a second reference position and moving the object by a **second, different movement process** |
| 911-d | In each process the object's **movement direction changes with the distance** between the reference and the input position, and for the same distance **the amount of change differs** between the two processes |

The description says plainly what this is for: a touch that starts on the player's kart puts it into
a **drift state** with sharper steering. The word "drift" is not in claim 1.

---

## 4. The searches, and what they found

### 4.1 Searches run

All on **Google Patents** (`patents.google.com/xhr/query`) on **2026-10-30**, filtered to **US,
granted patents**, first 25 to 50 results read by title. The queries are what was sent:

| # | Query | CPC filter | Results | Opened |
|---|---|---|---|---|
| 1 | `(racing OR race)` + `(item OR items)` + `(rank OR ranking OR position OR place)` + `(probability OR lottery OR distribution OR "weighted")` + `(game OR "video game")` | `A63F13` | 3 051 | '736, '903, '043, '259 |
| 2 | `(item OR items)` + `(rank OR ranking OR "race position" OR "current position" OR "order")` + `(probability OR lottery OR random OR weighted OR distribution)` | `A63F13/803` (driving games) | 432 | '783, NetEase '730 |
| 3 | `("non-player" OR "computer-controlled" OR CPU OR opponent OR AI)` + `(rank OR position OR behind OR ahead)` + `(speed OR performance OR difficulty)` + `(adjust OR adjusted OR adjusting OR change)` | `A63F13/803` | 537 | Tencent '702 |
| 4 | `("exercise bike" OR … OR "smart trainer")` + `("power-up" OR "power up" OR powerup OR "power-ups" OR "virtual item" OR "bonus item")` + `(race OR racing OR competition)` | none | 54 | Zwift '342 |
| 5 | `(cycling OR bicycle OR cyclist OR "bike")` + `("power-up" OR … OR "powerups")` + `(virtual OR avatar OR …)` | none | 10 814 | none: the results were electrical "power-up" patents |
| 6 | as 5, with `(cycling OR bicycle OR … OR "stationary bike")` + `(game OR race OR racing)` | `A63F13` | 147 | Nintendo '383 |
| 7 | as 6 | `A63B` | 91 | none new ('671 is spike 0005's) |
| 8 | `assignee=Zwift` | none | 6 | read by title: '671, US 11,986,700, US 12,522,318, US 10,299,702, US 12,465,816, US 12,023,148 |

### 4.2 Position-weighted item distribution

**No granted claim was found that recites choosing which item a racer receives according to the
racer's position in the race.** That is "none found by these searches", never "none exist". What
came closest, each opened and its claim 1 read from Google Patents:

- **US 10,124,259 B2** (Kabam, *Dynamic item obtain rate based on player progression*). Claim 1
  sets a user account's probability of receiving a reward item from a **usage value based on the
  user's access to their account**, on completing a game objective. Not race position. Off point.
- **US 11,045,736 B2** (Nintendo, priority 2018-05-02, Google Patents: Active, adjusted expiration
  2039-10-04). Claim 1 gives game objects **in exchange for a reduction in in-game currency**, and a
  second object on reaching a specific position. This design has no currency. Off point.
- **US 11,439,903 B2** (Nintendo, priority 2018-12-26, Active, adjusted expiration 2040-12-24).
  Claim 1 recites, in a racing game played many times, an event score per in-game event, a reward
  from a calculated score, and a **second parameter kept across plays** and moved by the race's
  standing. Relevant only if the mode ever **kept a persistent rating or currency across races**;
  the epic stores finish order only. Recorded in §6.

### 4.3 Exercise equipment, power-ups, and Zwift

- **No granted claim was found that recites power-ups or items in a race on exercise equipment.**
- **US 11,173,342 B2** (Zwift, priority 2018-11-01, Active, adjusted expiration 2040-02-06) is the
  sibling of US 11,602,671, which spike 0005 §3.5 read. Its claims 1 (col. 17, line 34), 9 (col. 18,
  line 39) and 16 (on the page printed as cols. 19 and 20; the column was not settled by eye) each
  require **at least two competing groups**, a **win condition** needing avatars of at least two
  members of each group at **at least two distinct locations**, through **independent courses with
  different levels or types of exertion**, and a **winning group**. A lap race of individuals has none
  of these. It becomes live only with team races, which ADR 0028 D-7.6 and #1895 D-12 refuse.
- The six Zwift grants listed by search 8 were read by title only: shifting, a single-sprocket
  trainer, step characteristics, a device protocol and movement tracking. **None is titled for
  power-ups or items**, and none was opened. The epic's Could Not Confirm item 3 is answered as far
  as these titles go: **no Zwift grant on power-ups was found**.

### 4.4 Touch and controller input (for #1901)

- **US 11,484,783 B2** (Nintendo, priority 2018-05-02, Active) and its continuation **US 11,673,043
  B2** (Active, anticipated expiration 2039-03-15). Claim 1 of each recites **one continuous touch
  drag** whose component **along one axis steers** the moving object and whose component **along a
  second axis sets the direction of a game operation** that moves another virtual object away (an
  item fired). '783 claim 1 is at col. 50, from line 60, checked by eye; '043 claim 1 is at col. 50
  and claims 17 and 18 at cols. 52 and 53 **by the OCR's order, not checked by eye**. '783's further
  independent claims 23 and 24 are at col. 53.
- **US 10,300,383 B2** (Nintendo, priority 2010-12-22, Active). Claim 1 aims a shot from **an inertia
  sensor in the controller** together with a directional input. This design aims nothing by
  motion sensing. Off point; column not read.
- **US 12,390,730 B2** (NetEase) and **US 11,911,702 B2** (Tencent) were opened: a remote "road book"
  display between two terminals, and a genetic search for racing-AI parameters. Off point; columns
  not read.

---

## 5. The Peloton family, US 2026/0249137 and ADR 0028 D-7

Read against what [spike 0005](0005-live-racing-patent-read.md),
[ADR 0007](../adr/0007-patent-posture.md), [ADR 0028](../adr/0028-racing-fairness.md) D-7 and
[spike 0022](0022-re-plans-during-the-ride-patent-chart.md) already record. **No new patent text was
read for this section**; it applies those readings to what this mode adds.

| What the mode adds | The family and claim it is checked against | Reading, and the D-7 item it relies on |
|---|---|---|
| **Bots** in a solo race | ADR 0007 D4's ✅ for a bot pacer: '026 claim 1 needs archived data from other users, '886 claim 19 live parameters from sensors | **Outside by construction**, as long as #1900's bot takes only a tier, a pacing rule, the course and a seed. Relies on **D-7.4** (no archived or recorded parameters) |
| **Laps on a loop route** | '085 and '276 claim 1's *cycling class* limitation, which spike 0005 §4 says carries the whole distance | **Unchanged**, as long as the loop is the rider's own route. Relies on **D-7.1**; §5.1 is the one way this mode could erode it |
| **Items** | No claim of the family read in ADR 0007 or spike 0005 recites an item, a power-up or a race offset | **Outside by construction**: there is no element for an item to meet. Items add nothing to the family's elements; they also remove none |
| **A room race with items** | '085 claim 1 as charted in spike 0005 §3.1: present in substance but for the class | **The same as any live race**: the owner accepted spike 0005's reading on 2026-09-22 (ADR 0028 amendment, Q6). Relies on **D-7.1, D-7.2, D-7.3, D-7.4** |
| **Live standings** | Spike 0005 §5 Question B ('026, '521, '224 ranked list) | **Unchanged**: ADR 0051 accepted the risk on 2026-10-14; Question B is already in the counsel bundle on #1234. Relies on ADR 0051 in place of the superseded **D-7.7** |
| **No team result** | '671 and '342 (§4.3) | **Outside by construction** while **D-7.6** holds (#1895 D-12) |
| **Anything sent to the trainer** | US 2026/0249137 A1 claims 1, 11, 18 (spike 0022 §2.1): a workout **modified** from workout metrics at a trigger event or inflection point | **Outside by construction** while #1895 D-2 holds: no race event changes what the trainer is sent or when, so no event in the race produces a modified workout. The mode **must not** become a source of workout changes (an item that "eases the next interval") |

### 5.1 ADR 0028 D-7.1 and a circuit shipped inside the app — a reading for the owner

The question: may a loop circuit **bundled in the client** (not served from an instance) be offered
for a **solo bot race**, against D-7.1's *"a race's course is a route a rider imported or saved"*?

What spike 0005 §3.1 found carries the distance from '085 claim 1 is the **cycling class**: *offered
for selection*, *selected*, and *delivered as digital video and audio content from a server*. Read
element by element:

1. **"Information about available … classes", offered for selection.** A menu of shipped circuits is
   a menu of things offered for selection. **This element moves toward the claim**: today the rider
   picks a route of their own, and nothing is offered.
2. **"Digital video and audio content comprising the selected … class, sent from a server".** A
   circuit is geometry and elevation, drawn by the client; it carries no video and no audio. **Still
   absent.** ⚠️ The web build is itself downloaded from a web server, so "not from a server" is an
   argument about what the content is, not about how it travelled.
3. **"A second user on a second stationary bike at a second remote location"**, with that user's
   parameters shown for comparison. **A solo bot race has no second user at all.** A bot is not a
   user on a stationary bike (ADR 0007 D4). **Absent by construction, independently of the class.**

**So, for a solo bot race only, a bundled circuit sits outside '085 claim 1 on two independent
grounds** (no class delivered as video and audio, and no second rider), where a room race on the
rider's own route sits outside on one. **In a room, a bundled circuit would remove the second ground
and weaken the first**, which is the erosion spike 0005 §4 warns of. The engineering reading is:
**a bundled circuit is lower-risk if it is offered for solo bot races and never as a room's course.**
The owner decides (#1895 D-11, and §8 Question 4).

---

## 6. Design check

Each ADR #1895 D-item and #1899 / #1900 rule this reading bears on. **"Outside by construction"**
means the design has nothing that could be argued to be a required element named in the cell.
**"Outside by argument"** means the element is arguably absent but an engineer is arguing, not
reading. **"Unknown"** means the engineer cannot tell, or the design is not fixed yet. None of these
is an opinion on infringement.

| Item | What it bears on | Verdict | Why |
|---|---|---|---|
| **#1895 D-1** expression | §2 | **Outside by construction**, if D-1 is kept as written | D-1 already forbids every element §2.4 lists. Item names, icons and sounds are approved by the owner in #1899's and #1902's pull requests |
| **#1895 D-2** nothing reaches the trainer | US 2026/0249137 (§5) | **Outside by construction** | No race event yields a modified workout |
| **#1895 D-3** two distances | none read | **Outside by construction** | No claim read recites an effort distance, a race offset or a bound |
| **#1895 D-4** effort dominates; catch-up only from items | '913 (§3.2), '342 (§4.3) | **Outside by construction** | No change to any racer's effort; no team win |
| **#1895 D-5** items act on the virtual rider only | '784 (§3.3) | **Outside by construction**, given #1899 rule 4 | See #1899 rule 4 below |
| **#1895 D-6** lanes in a room | '911 (§3.4) | **Outside by construction**, given discrete lanes | Lanes are three discrete positions chosen by a key or a control. '911 needs a continuous direction change scaled by drag distance |
| **#1895 D-7** bots are synthetic | ADR 0007 D4 | **Outside by construction** | §5, first row |
| **#1895 D-8** no bots in rooms | none | not affected | — |
| **#1895 D-9** no rubber-banding of bots by rank | '913 (§3.2) | **Outside by construction** as proposed; **outside by argument** if the owner chose rubber-banding | As proposed, a bot has a **W/kg tier**, which is a performance value, and **no target rank** (913-b): nothing is set as a rank to reach. If bots varied power **by their current rank**, the closest limitation is dependent claim 3; claim 1 still needs target ranks *"set irrespective of a current rank"* and a performance value changed **according to the target rank**, so a rule driven by current rank alone is a different mechanism by argument. And the patent is **reported expired** on 2025-04-21 (secondary source plus front-page arithmetic, §3.2), which is §7 item 1 |
| **#1895 D-11** courses, and a bundled circuit | '085 class limitation (§5.1) | **Outside by construction** for the rider's own loop; **outside by argument** for a bundled circuit in a solo bot race; **unknown** for a bundled circuit in a room | §5.1 |
| **#1895 D-12** no team result | '671, '342 | **Outside by construction** | §4.3 |
| **#1895 D-13** touch lock; items by key, remote, gamepad | '783 / '043 (§4.4) | **Outside by construction** while item use is a **separate control** (a key, a button or a tap) and steering is lane selection | '783 and '043 need **one drag** that both steers and aims an item. A swipe gesture that did both would meet the shape and is **unknown** |
| **#1899 rule 2** position-weighted draws | §4.2 | **Unknown, no claim found** | No granted claim on rank-keyed item draws was found by searches 1 and 2. The practice is long-standing genre background (the epic's sources), which is prior art in the ADR 0007 D6 sense, but no dated publication was read for it here |
| **#1899 rule 4** one item held; no combining | '784 (§3.3) | **Outside by construction** while a racer holds **one** item | 784-b needs **a plurality of** possession slots, and 784-d to 784-f a condition on **two slots being the same** with a repeated stronger effect. One slot has no pair to match. **A second slot, or a "hold two, use both" rule, would need this chart re-run** |
| **#1899 rule 1** pick-ups by lap fraction | '736 (§4.2) | **Outside by construction** | '736 claim 1 needs objects bought with in-game currency |
| **#1899, results** | '903 (§4.2) | **Outside by construction** while results keep finish order only | '903 needs a parameter kept across plays and moved by standing, used in a score that sets a reward |
| **#1900 rule 1** W/kg tiers | '913 | **Outside by construction** | A tier is not a target rank (913-b) |
| **#1900 rule 3** no rubber-banding | '913 | as D-9 | — |
| **#1900 rule 4** never a recorded ride | ADR 0007 D4 | **Outside by construction** | #1900's import test holds it |

**Nothing read here is on point for the mode as #1895 proposes it.** That is the result of eight
searches and thirteen patents on one day. It is not clearance.

---

## 7. Could not confirm

Each with the step that would settle it and who owns that step.

1. **US 7,278,913's status from the office record.** Settled by a person opening the patent in
   Patent Center (`patentcenter.uspto.gov`, application 10/968,254) in an ordinary browser and
   copying the status, the maintenance-fee events and the expiry, with the date read. **Owner of the
   step: the project owner.** Until then the status is Google Patents' "Expired - Lifetime" plus the
   front page's 183-day adjustment, which agree.
2. **US 11,103,784's maintenance-fee status from the office record**, the same way (it was filed
   2019-04-25). **The project owner.** It matters only if #1899 ever adds a second item slot.
3. **JP 6921193 read from the granted JP publication**, for a page reference. Its claims were read
   from Google Patents' Japanese text and machine translation only. Settled by reading the J-PlatPat
   publication. **Counsel, if the owner wants it**; the US counterpart's columns are given in §3.4.
4. **Columns not checked by eye**: '784 claim 1, '043 claims 1, 17 and 18, '342 claim 16, '783
   claims 23 and 24, and the columns of '736,
   '903, '259, '383, '730 and '702, which were read from Google Patents' text only. Settled by
   rendering the USPTO print-server PDFs as §9 shows. **Anyone, before a later issue relies on one of
   them.**
5. **A class 009 US mark for the series' name** (§2.2). Settled by reading TSDR for serial 79429191
   and searching the register in a browser. **The project owner.**
6. **The 2020-01-29 final judgment in the go-kart case** (§2.3), read only in secondary reports.
   Settled by the court's own record. **Counsel**; nothing here turns on it.
7. **Any patent outside these searches**: non-US rights, pending applications, and claims whose
   words these keyword queries did not hit. Settled only by a professional search (§8 Question 5).

---

## 8. Questions for the owner and counsel

1. **For the owner: the class 009 mark** (§2.2, §7 item 5). Low priority: #1895 D-1 already keeps
   every name and get-up of the series out.
2. **For the owner: US 7,278,913 in Patent Center** (§7 item 1). This is what #1895 D-9 waits on if
   the owner wants bots to rubber-band; it is not needed if D-9 is accepted as proposed (no
   rubber-banding), which is outside the claim by construction anyway.
3. **For counsel: is a single held item enough distance from US 11,103,784**, given 784-b's
   *"plurality of in-game options"*? The engineering reading (§6, #1899 rule 4) is that one slot has
   no pair to match. A lawyer would say whether a sequence of single pick-ups could be argued to be
   a plurality of options over time.
4. **For the owner, and for counsel if a bundled circuit is wanted in a room: ADR 0028 D-7.1 and a
   circuit shipped in the app** (§5.1). The reading is that a bundled circuit for solo bot races
   keeps two independent grounds against '085 claim 1, and in a room keeps one, weakened. **This
   bears on spike 0005 §5 Question A** (the class limitation under the doctrine of equivalents),
   which is why it is cross-linked from [#1234](https://github.com/openzigs/onyourleft/issues/1234),
   where the counsel questions due by about 2027-01-15 are kept. Bundle it there only if the owner
   wants bundled circuits in rooms.
5. **For counsel, if the owner wants more than this: a proper search** with classification tools
   and non-US coverage, for rank-weighted item distribution and for items or power-ups in exercise
   games. **Not asked**: any validity question, since this project will not fund a challenge.

---

## 9. How to reproduce

```bash
# A patent's claims and legal events (status words are Google Patents' reading, a secondary source).
curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US7278913B2/en -o 913.html

# The granted patent for the column and the term adjustment: images only, so render and OCR.
curl -sL https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7278913 -o 913.pdf
pdftoppm -r 300 -f 21 -l 21 -png 913.pdf p && tesseract p-21.png p-21

# A search, as §4.1 ran it (the inner query is URL-encoded once).
curl -sL 'https://patents.google.com/xhr/query?url=q%3D(racing%20OR%20race)%26q%3D(item%20OR%20items)%26cpc%3DA63F13%26country%3DUS%26type%3DPATENT%26status%3DGRANT'

# The mark, and the court's English summary.
curl -sL -A 'Mozilla/5.0' https://tsdr.uspto.gov/statusview/sn79263442 -o tm.html
curl -sL https://www.ip.courts.go.jp/vc-files/ip/file/002467.pdf | pdftotext - -
```

The claim pages used: US 7,278,913 page 21; US 11,103,784 pages 50 and 51; US 11,071,911 pages 34 to
36; US 11,484,783 page 50; US 11,173,342 pages 19 and 20; US 11,673,043 pages 51 to 53. Front pages
(page 1) for the term adjustments.

---

## 10. What would make this spike wrong, and when it ages

- **US 7,278,913's office record shows something other than expiry** (§7 item 1). It would not move
  §6's verdict for D-9 as proposed, which rests on the absent target rank.
- **#1899 adds a second item slot** or any rule that rewards holding matching items. '784's chart
  must be re-run first.
- **#1901 adds a swipe gesture** that both steers and aims, or a touch steering mode chosen by where a
  touch starts. '783, '043 and '911 must be re-read first.
- **Results start to persist** across races as a rating, points or currency. '903 must be re-read.
- **A circuit is served from an instance, or a bundled circuit is offered in a room.** §5.1.
- **Team races arrive.** '671 and '342 become live, as spike 0005 §3.5 already warns.
- **A patent outside these eight searches**, most likely, since they were keyword searches over US
  grants only, with no pending applications and no non-US rights.
- **Anyone reads this as clearance.** It is eight searches, thirteen patents, one mark and one court
  summary, read by an engineer on one day.
