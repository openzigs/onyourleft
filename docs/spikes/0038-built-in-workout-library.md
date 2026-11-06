# Spike 0038: a built-in workout library — what may be taken from other products, which open corpora are lawfully reusable, and the zone model

- **Date read**: **2026-11-06.** Every licence, terms page and repository below was read that day,
  first-hand unless its row says otherwise. Nothing was run: this is a desk read.
- **Issue**: [#2296](https://github.com/openzigs/onyourleft/issues/2296), phase 1 of epic
  [#2295](https://github.com/openzigs/onyourleft/issues/2295) (under
  [#14](https://github.com/openzigs/onyourleft/issues/14)), from the owner's request of 2026-11-06 on
  #14: *"most won't build their own; they want canned ones"*. It feeds
  [#210](https://github.com/openzigs/onyourleft/issues/210) (importing the de facto format) rather
  than duplicating it
- **Blocks**: [#2298](https://github.com/openzigs/onyourleft/issues/2298),
  [#2300](https://github.com/openzigs/onyourleft/issues/2300),
  [#2301](https://github.com/openzigs/onyourleft/issues/2301),
  [#2303](https://github.com/openzigs/onyourleft/issues/2303)
- **Number**: **0038.** `docs/spikes/` on `origin/main` `ef687995` holds 0001 to 0037 without 0009,
  0021 and 0032, and no open pull request adds a file under `docs/spikes/` (checked with
  `gh pr list --state open` over each pull request's files on 2026-11-06). If another write-up
  merges first at 0038, this one takes the next free number (`SPIKE001`)
- **Status of this document**: a **spike write-up**. It records what each source says and what
  follows, and decides nothing by itself. The owner's ruling on R-1 to R-4 is recorded in §6

> ## ⚠️ The answer in one paragraph
>
> **Write the library ourselves, from training facts, in our own words; vendor nothing.** Every
> corpus the planning survey named was read. The two that are lawfully reusable as files
> (`phisad/structured-cycling-workouts`, 30 workouts, and `robiningelbrecht/zwift-workouts`, 7, both
> MIT) are small, are written in the de facto format that is #210's question, and carry other
> products' names and a load-metric mark in their labels and text, so what is worth taking from them
> is their structures, which are facts we may write down anyway. Zwift's own library is reserved by
> its Terms of Service §9, and the one mirror read says it reproduces it *"with permission from
> Zwift"*, a permission that does not reach us. TrainerDay's terms licence shared workouts only to
> *"anyone using our platform"*, forbid data harvesting, and say outright that some of its workouts
> were uploaded from other products. intervals.icu's API terms licence API outputs but say nothing
> of other users' authored workouts, and its general terms page could not be read. GoldenCheetah is
> GPL-2.0 and carries no corpus, only 52 test files, seven of them named after another product's
> titles. **One finding bears on #210 directly**: `h4l/zwift-workout-file-reference` documents 46
> elements and 57 attributes under `MIT OR CC-BY-4.0`, compiled by analysing Zwift's own copyrighted
> files; it is posted on #210 (§4). **The zone model stays as it is** (`zones.ts`, 7 power and 5
> heart-rate zones), with targets as shares of threshold and zones as labels only. **Two findings
> change the next issues rather than confirm them** (§5): a heart-rate hold's range is stored in
> **bpm**, so a template has to carry it as shares of threshold heart rate and resolve it per rider
> (#2298); and the sweet-spot range 0.88–0.94 is **not expressible** from
> `POWER_ZONE_LOWER_FRACTIONS`, so #2300's category gate needs one named constant or a looser band.

---

## 1. Facts versus expression: what may be taken from another product's library

The line is the one [ADR 0009](../adr/0009-clean-room-posture.md) R1 already draws for code, applied
to workouts. Nothing here is new law; it is the existing rule stated for this material.

| May be taken — **facts** | May **not** be taken — **expression and marks** |
| --- | --- |
| An interval structure: *2 × 20 min at 0.95 of threshold, 5 min easy between* | A workout's **name**, including a name that reads as generic but is a product's coinage (§3) |
| A target as a share of threshold, a duration, a repeat count, a ramp's end points | A workout's **description**, coaching text, in-ride messages or cue text |
| A category of training (recovery, endurance, tempo, sweet spot, threshold, VO₂, anaerobic, sprint) | A **branded collection, plan or programme**, and its name |
| A published test protocol (a ramp in one-minute steps; a 20-minute test) and its arithmetic | A product's **compilation** of workouts lifted as a set, in its order and grouping |
| A zone table's published fractions (`zones.ts` records them as published numbers) | The load-metric marks: never `NP`, `TSS`, `IF`, `CTL`, `ATL`, `TSB` ([`scope-and-ip.md`](../agents/scope-and-ip.md) §6) |

Two third-party statements read on 2026-11-06 put the line in the same place. Neither is legal
authority; both are the operators' own reading:

- TrainerDay's Terms and Conditions (§2.4 below): *"Workouts in themselves are not copyrightable, but
  the names and descriptions are."*
- `h4l/zwift-workout-file-reference`'s README (§2.2): *"The workout files themselves can't be
  committed here as they're copyrighted."*

**What this means for the library.** A built-in template is authored in this repository, under
`packages/domain` and so under Apache-2.0, from structures that are training facts. Its name is
plainly descriptive (*"Sweet spot, three by twelve"*, #2300's example), its summary is our own
sentence, and neither contains a name from §3. The epic's invariant that nothing from a GPL or AGPL
project or another product's library text is copied is this table.

---

## 2. The corpora, each licence read first-hand

Every row of #2296's table, in its order. Quotations are from the licence file or terms page
itself. Where a page could not be read, the row says so.

### 2.1 Zwift's bundled workouts, and sites mirroring them — **not reusable**

**Read first-hand**: Zwift's [Terms of Service](https://support.zwift.com/en/terms-of-service-HJt7VBYyH),
*"Last Updated: June 02, 2026"*, read 2026-11-06. §9, *Ownership; Limited License*:

> *"The Platform and all content contained therein, including the text, graphics, images,
> photographs, videos, illustrations, themes, objects, characters (including names), stories,
> dialogue, catch phrases, concepts, artwork, animations, sounds, musical compositions, and
> audio-visual effects, are owned by Zwift or our licensors and are protected under both United
> States and foreign laws. Except as explicitly stated in these Terms, all rights in and to the
> Platform are reserved by us or our licensors. Subject to your compliance with these Terms, you are
> hereby granted a limited, nonexclusive, nontransferable, non-sublicensable, revocable license to
> access and use our Platform for your own personal, noncommercial use"*

§5 forbids users to *"Copy, reproduce, distribute, publicly perform or publicly display all or
portions of our Platform, except as expressly permitted by us or our licensors"* and to *"Use any
data mining, robots or similar data gathering or extraction methods designed to scrape or extract
data from our Platform"*. §10: *"'Zwift' and our logos, our product or service names, our slogans
and the look and feel of the Platform are trademarks of Zwift and may not be copied, imitated or
used, in whole or in part, without our prior written permission."*

**The mirror.** [What's on Zwift?](https://whatsonzwift.com/terms-conditions), read 2026-11-06:

> *"All Zwift workouts and training plans on this website have been reproduced with permission
> from Zwift."* … *"The person submitting the workouts to be published on whatsonzwift.com must own
> the copyright and/or intellectual property rights of the submitted workouts, or have permission
> from those that own the copyright and/or intellectual property rights to do so."*

A permission granted to the site's operator is not a licence to anyone who reads the site. The
other mirrors the planning note mentioned were not read; this one is enough to settle the row.

**Conclusion**: proprietary, and the planning note stands. Names from this source are in §3.

### 2.2 `h4l/zwift-workout-file-reference` — **a reference, not a corpus; bears on #210**

**Read first-hand**: the repository at `5856ea772f74` (last commit 2021-02-22), through the GitHub
API, 2026-11-06.

- [`LICENSE`](https://github.com/h4l/zwift-workout-file-reference/blob/master/LICENSE) is, in full:
  *"MIT OR CC-BY-4.0"*. GitHub's licence detector reports `NOASSERTION` because of the `OR`.
- [`LICENSE.MIT.txt`](https://github.com/h4l/zwift-workout-file-reference/blob/master/LICENSE.MIT.txt):
  *"The MIT License (MIT) / Copyright (c) 2019 Hal Blackburn"*, followed by the standard MIT grant.
- [`LICENCE.CC-BY-4.0.txt`](https://github.com/h4l/zwift-workout-file-reference/blob/master/LICENCE.CC-BY-4.0.txt)
  holds only the URL `http://creativecommons.org/licenses/by/4.0/` (44 bytes), not the licence text.
- [`README.md`](https://github.com/h4l/zwift-workout-file-reference/blob/master/README.md) on how the
  reference is made:

  > *"The reference is generated from two sources: Manually created descriptions and examples in
  > descriptions.yaml [and] Automatically generated data in tag_attr_usage.json"* … *"The
  > `tag_attr_usage.json` committed here is the result of analysing all of the workouts that come
  > with Zwift. The workout files themselves can't be committed here as they're copyrighted."*

- The generated reference describes **46 elements and 57 attributes** (counted from its headings).
  Each entry carries a *"Times seen"* count, which is the usage analysis of Zwift's files; the usage
  examples read in this lane are hand-written (an author called *"Jim"*), not excerpts. The element
  set itself is **not reproduced here**: whether it may be used is #210's question, and copying it
  into a spike would answer that question by accident.

**What it is.** A documented element and attribute set for the de facto format, under a licence that
is acceptable anywhere in this repository (MIT is permissive; CC-BY-4.0 is an alternative). It is
**not a corpus**: it holds no workouts.

**Why it matters, and what it does not settle.** #210's third unblock condition is *"The element set
turns out to be documented in a source with an acceptable licence."* This is such a source on its
face. Three things it does not settle, each for #210's ADR rather than for this spike:

1. **ADR 0009 R1, the compilation.** R1 forbids taking somebody's compilation of facts as a table. The
   compiler here is the repository's author (Hal Blackburn), who licensed the compilation permissively, which is what R1
   needs. But the compilation was made **by analysing Zwift's copyrighted files**. Element names
   observed in a file are facts about the format; the files were not redistributed. Whether a
   compilation of facts drawn from copyrighted inputs is clean is the question R1 has not been asked
   before, and it is posted to #210 as an open question, not answered here.
2. **ADR 0009 L1, the mark.** The reference does nothing for L1: the format's name and file extension
   are still Zwift's, and L1's grep still fires on them.
3. **ADR 0006 R2, provenance.** It gives each element a provenance that can be written down (a URL
   and a commit), which is what R2 asks and what "recalled" fails.

### 2.3 `phisad/structured-cycling-workouts` — **MIT; structures only would be usable**

**Read first-hand**: the repository at `0869e1087ec6` (created and last pushed 2026-01-19), through
the GitHub API, 2026-11-06.

- [`LICENSE`](https://github.com/phisad/structured-cycling-workouts/blob/main/LICENSE): *"MIT License /
  Copyright (c) 2026 Free Cycling Workouts Contributors"*, followed by the standard MIT grant.
- [`README.md`](https://github.com/phisad/structured-cycling-workouts/blob/main/README.md): *"This
  project is licensed under the MIT License"*; it describes *"30 structured cycling workouts (20-35
  minutes each)"* in two collections, 16 *"Classic Training Zones"* and 14 *"4DP-Style Workouts"*,
  the latter *"inspired by Wahoo's Four-Dimensional Power methodology"*. Its disclaimer: *"These
  workouts are not affiliated with Wahoo, TrainingPeaks, or Zwift"*.
- [`FAQ.md`](https://github.com/phisad/structured-cycling-workouts/blob/main/FAQ.md): *"Yes, free to
  use, modify, and share. MIT License."* and, on commercial use, *"Yes, MIT License allows
  commercial use."*
- The files: 14 under `workouts/4dp-style/`, 16 under `workouts/classic-zones/`, all in the de facto
  format. One file read in full for its labels carries the author *"Philipp - SYSTM Style"* and the
  tags `AC` and `4DP`. The FAQ explains a load-metric mark by name.

**Conclusion**: lawfully reusable as files under MIT, with attribution. **Its names and text are not
usable by this library**: they carry Wahoo's coinages (`4DP`, *Four-Dimensional Power*, *SYSTM*,
*Half Monty* in the FAQ) and a §6 mark. What would be usable is the structures, and a structure is a
fact we may write without the file. Vendoring the files is an import of the de facto format, which
is #210, and buys this epic 30 short workouts it can author in its own words.

### 2.4 `robiningelbrecht/zwift-workouts` — **MIT; a personal collection**

**Read first-hand**: the repository at `a4fb32237d3a` (created 2026-01-12, last pushed
2026-05-06), through the GitHub API, 2026-11-06.

- [`LICENSE`](https://github.com/robiningelbrecht/zwift-workouts/blob/master/LICENSE): *"MIT License /
  Copyright (c) 2026 Robin Ingelbrecht"*, followed by the standard MIT grant.
- [`README.md`](https://github.com/robiningelbrecht/zwift-workouts/blob/master/README.md): *"This
  repository contains structured Zwift workouts organized into training schedules."* Two schedules,
  *"80/20 Polarized"* and *"Pyramidal"*, and one warm-up.
- The files: 7 in the de facto format (three under `80-20/`, three under `pyramidal/`, one under
  `other/`; a 30/30 and a zone-2 workout appear in both schedules).

**Conclusion**: lawfully reusable under MIT, and too small to matter: seven workouts of ordinary
structure (30/30s, over-unders, a sweet-spot set, zone 2). The schedule label *80/20* is also the name
of a commercial training brand; its register status was not checked (§3).

### 2.5 GoldenCheetah — **GPL-2.0; no corpus to take, and not to be opened**

**Read first-hand**: repository metadata and file listings only, at `9e8d3018da1d`, 2026-11-06.
**No source file was opened** ([ADR 0009](../adr/0009-clean-room-posture.md) R1).

- [`COPYING`](https://github.com/GoldenCheetah/GoldenCheetah/blob/master/COPYING) opens *"GNU GENERAL
  PUBLIC LICENSE / Version 2, June 1991"*; the GitHub API reports `GPL-2.0`.
- The README lists importing indoor workouts from TrainerDay as a feature, and the tree has
  TrainerDay download code under `src/Train/` (file names only, from a code search). The workouts
  come from TrainerDay's service at run time, under TrainerDay's terms (§2.7), not from the
  repository.
- The repository does carry **52 workout files under `test/workouts/`** (file listing only). They are
  test fixtures, not a library, under a GPL-2.0 repository. **Seven of their file names are titles
  from Wahoo SYSTM's catalogue (formerly The Sufferfest)**, matched against a Wahoo forum list of
  those titles (§3), and one is named after a Zwift workout.

**Conclusion**: GPL-2.0 is fatal under `packages/` (CLAUDE.md §3), the test files are fixtures with
other products' names on some of them, and there is nothing to take. The planning note's *"bundles
no corpus we could take"* stands, with the correction that it does bundle test files.

### 2.6 intervals.icu shared workouts — **not a corpus**

**Read first-hand**: the *Intervals.icu API Terms and Conditions*, *"Effective Date: October 23,
2025"*, as posted by the operator on the
[intervals.icu forum](https://forum.intervals.icu/t/114087) on 2025-10-22 and read there on
2026-11-06. §1, *License Grant*:

> *"We grant you a non-exclusive, worldwide, royalty-free, perpetual license to access and use the
> API for any lawful purpose, including commercial use. Except for the Garmin attribution
> requirements in 1.1, you may integrate, modify, distribute, and sublicense outputs derived from the
> API without restriction or attribution."*

The API terms say nothing of workouts authored by other users. **The general Terms of Service could
not be read first-hand**: `https://intervals.icu/terms` returns a page rendered by JavaScript whose
fetched text is only the site name, and no copy was found elsewhere.

**Conclusion**: the planning note's reasoning stands on what was read. An operator can licence what
it holds; a workout another user wrote and shared is that user's, and nothing read says the
operator holds a licence to pass on. Not a corpus.

### 2.7 TrainerDay (formerly ErgDB) — **service terms; not a corpus**

**Read first-hand**: TrainerDay's
[Terms and Conditions](https://home.trainerday.com/terms-and-conditions), read 2026-11-06 (no date
on the page; `trainerday.com/terms` answered 403 and `app.trainerday.com/terms` is rendered by
JavaScript). Under *Intellectual Property Rights*:

> *"IF YOU UPLOAD WORKOUTS FROM OTHER PLATFORMS, such as TrainerRoad, Zwift, Sufferfest or others.
> Please do not share it with the world. KEEP IT PRIVATE FOR YOUR OWN USE."* … *"Workouts in
> themselves are not copyrightable, but the names and descriptions are."*

> *"For any workouts you create on our platform are your intellectual property owner and you agree
> to allow unlimited use to anyone using our platform."* … *"everyone has free use of any public
> workouts generated by the TrainerDay users."*

Under *Restrictions*, a user may not engage *"in any data mining, data harvesting, data extracting or
any other similar activity in relation to this Website; Other than API usage for the purpose of
enhancing the TrainerDay/ERGdb community via additional free distribution of our workouts, unless
allowed by TrainerDay in writing."*

And on provenance, TrainerDay's own staff on its forum
([*Flagging "original" TrainerDay workouts in search?*](https://forums.trainerday.com/t/29150),
2023-12-11): *"We don't really have original TD workouts"*; most are generated per rider by its plan
generator.

**Conclusion**: the use granted runs to *"anyone using our platform"*, extraction is forbidden
without written permission, and the terms themselves say other products' workouts are uploaded
there, so the provenance of any one workout is unknown. Not a CC0, CC-BY or OSI corpus.

### 2.8 The table, corrected

| Corpus | Licence, as read | Read first-hand | Reusable here |
|---|---|---|---|
| Zwift's bundled workouts | Proprietary, ToS §9 (updated 2026-06-02); mirror reproduces *"with permission from Zwift"* | Yes (ToS, one mirror) | **No** |
| `h4l/zwift-workout-file-reference` | `MIT OR CC-BY-4.0` | Yes | A reference, not a corpus; **#210's question** |
| `phisad/structured-cycling-workouts` | MIT | Yes | Files yes under MIT; names and text no; **structures are facts anyway** |
| `robiningelbrecht/zwift-workouts` | MIT | Yes | Yes under MIT; 7 workouts, nothing the library needs |
| GoldenCheetah | GPL-2.0 | Metadata and listings only, by design | **No**; carries test files, not a corpus |
| intervals.icu shared workouts | API terms licence API outputs; general terms **not read** | API terms yes; ToS **no** | **No** |
| TrainerDay / ErgDB | Platform-scoped use; extraction forbidden | Yes | **No** |

---

## 3. The names the library must not use

#2300 turns this list into a test. Every name below was met during this research, with where. **A
name is a product's coinage even where it reads as generic.** The list is the floor, not the
ceiling: a reviewer who recognises another product's name in a template rejects it whether or not it
is here.

The test has to match two ways, and this is why the list is split. A **coinage** is distinctive, so a
template's name or summary must not **contain** it. A **descriptive title** is a product's exact title
built from training vocabulary (*"Over - Unders"*, *"6x2 VO2 Max"*); banning it by containment would
ban the vocabulary the library needs, so a template's name must not **equal** it, compared without
case, spaces or punctuation.

### 3.1 The load-metric marks and their long forms — contain-match

From [`scope-and-ip.md`](../agents/scope-and-ip.md) §6. The six abbreviations are matched **as
upper-case whole words**, because a case-insensitive `IF` matches the English *if* in every summary:

- `NP`, `TSS`, `IF`, `CTL`, `ATL`, `TSB`
- *Normalized Power*, *Training Stress Score*, *Intensity Factor*, case-insensitive
- **`FTP`** is not established as a mark either way (§6 of that file), but the project's wording is
  *threshold power* ([ADR 0048](../adr/0048-workouts-that-change-during-the-ride.md) D-12), so it
  belongs on the list as a wording rule. Upper-case whole word

### 3.2 Products, programmes and features — contain-match, case-insensitive

| Name | Whose | Met in |
|---|---|---|
| *Zwift*, *TrainerRoad*, *Wahoo*, *SYSTM*, *Sufferfest*, *TrainerDay*, *ErgDB*, *TrainingPeaks*, *intervals.icu*, *GoldenCheetah* | Products | Every source above |
| *4DP*, *Four-Dimensional Power* | Wahoo | phisad README and tags (§2.3) |
| *Half Monty* | Wahoo SYSTM (a ramp test) | phisad FAQ (§2.3) |
| *ISLAGIATT* | Wahoo SYSTM title | Wahoo forum list (below) |
| *Collywobbles*, *Coach Jack* | TrainerDay | TrainerDay forum (§2.7) |
| *Pettit*, *Lamarck*, *Spanish Needle*, *Mount Field* | TrainerRoad workouts | Search results naming them as TrainerRoad workouts, 2026-11-06 (not read on TrainerRoad's own site) |
| *Sweet Spot Base* | TrainerRoad plan | The same search |
| *The Mayfield*, *Jon's Mix*, *The Gorby*, *Devedeset*, *ODZwifters* | Zwift workouts | What's on Zwift? (§2.1) |
| *Adaptive Training*, *TrainNow*, *Progression Levels*, *Workout Levels*, *SMART workouts*, *Maximum Power Available*, *ActivePulse*, *HR+*, and `MPA` (upper-case whole word) | Other products' features | Already banned by ADR 0048 D-12; repeated so one test holds them |
| *80/20* | A training brand's name; also robiningelbrecht's schedule label | §2.4. Register status **not checked**. A summary describing a polarised split says *mostly easy, some hard* instead |

The Wahoo SYSTM titles were confirmed against a member's list on Wahoo's own forum
([*List of Sufferfests in order of release date*](https://wahoox.forum.wahoofitness.com/t/17057),
2022-02-23), read 2026-11-06.

### 3.3 Descriptive titles — whole-name match

| Exact title | Whose | Met in |
|---|---|---|
| *Downward Spiral*, *Fight Club*, *Revolver*, *Angels*, *The Hunted*, *Local Hero*, *A Very Dark Place* | Wahoo SYSTM (The Sufferfest) | GoldenCheetah `test/workouts/` file names (§2.5) and the Wahoo forum list |
| *Hell Hath No Fury*, *Extra Shot*, *The Long Scream*, *There Is No Try*, *The Wretched*, *Blender*, *Rubber Glove*, *Violator* | Wahoo SYSTM (The Sufferfest) | The Wahoo forum list |
| *SST (Short)*, *SST (Med)*, *6x2 VO2 Max*, *Over - Unders*, *The Famous 40/20's*, *Get It Done*, *Aerobic Builds* | Zwift | What's on Zwift? (§2.1) |
| *Less Than 60 Minutes to Burn*, *The Long Haul*, *Ride On for World Bicycle Relief* | Zwift collections | URL paths on What's on Zwift? in search results; the pages were not opened |
| *Classic Training Zones*, *4DP-Style Workouts*, *SYSTM Style* | phisad's collections and author label | §2.3 |
| *80/20 Polarized*, *Pyramidal* | robiningelbrecht's schedules | §2.4 |
| *Hour of Power* | Origin **not established**; a GoldenCheetah test file name | §2.5. Cheap to avoid |

**Not on the list, deliberately**: the training vocabulary those titles are built from — *recovery*,
*endurance*, *zone 2*, *tempo*, *sweet spot*, *threshold*, *over-under*, *VO₂*, *40/20*, *30/30*,
*pyramid*, *ramp test*. They are the terms of the training literature, as `zones.ts` records, and the
library is written in them.

---

## 4. What bears on #210

**Posted on #210**: the comment at
[#210 (comment)](https://github.com/openzigs/onyourleft/issues/210#issuecomment-PLACEHOLDER), on
2026-11-06. It quotes #210's unblock condition 3 and states, without deciding:

1. `h4l/zwift-workout-file-reference` (§2.2) is a source documenting the element set under `MIT OR
   CC-BY-4.0`, with a provenance (URL and commit) that ADR 0006 R2 can record;
2. it was compiled by analysing Zwift's copyrighted bundled files, which R1 has not been asked about
   and #210's ADR has to answer explicitly;
3. it does nothing for L1;
4. the two MIT corpora (§2.3, §2.4) are the only lawfully reusable files found, 37 workouts between
   them, and their names and text carry other products' marks, so an import would vendor structures
   only and rename them;
5. this epic vendors nothing (R-1), so none of this is a dependency of #2295.

---

## 5. The zone model

### 5.1 What the repository has, read on `ef687995`

- [`packages/domain/src/analysis/zones.ts`](../../packages/domain/src/analysis/zones.ts): a **7-zone
  power table**, lower bounds `0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51` of threshold power, named
  *Recovery, Endurance, Tempo, Threshold, VO₂, Anaerobic, Sprint*; and a **5-zone heart-rate table**,
  lower bounds `0, 0.81, 0.90, 0.94, 1.00` of threshold heart rate, named *Recovery, Endurance, Tempo,
  Threshold, Maximal*. Zones are `[lower, upper)`.
- [`packages/domain/src/workout/workout.ts`](../../packages/domain/src/workout/workout.ts): every
  power target is a `ThresholdShare` (*"share of threshold power"*). The heart-rate hold's range is a
  `HeartRateRange` in **beats per minute**, at least `MINIMUM_HOLD_RANGE_BPM = 6` wide, with
  `MAXIMUM_HOLD_CEILING_SHARE = 0.85`.
- The zone tables are read by `apps/web/src/workouts/block-chart.ts` and `apps/web/src/design/tokens.ts`
  to colour and label. **No trainer target is computed from a zone.**

The planning survey's claim that every surveyed app uses this 7-zone split was **not re-verified**
in this lane; the fractions are as `zones.ts` records them.

### 5.2 Each recommendation, tested

**R-1 — an authored library, no vendored corpus. Holds.** §2 found nothing that is both lawfully
reusable and free of other products' names, and the two MIT corpora are 37 workouts whose value is
their structures, which §1 says we may write anyway. A corpus import goes through #210.

**R-2 — targets as shares of threshold, zones as labels and filters only. Holds, and is already the
model's shape.** `ThresholdShare` is how every power target is written today, and no target is
computed from a zone. A template written as *"zone 3"* would make a change to the zone table change
what a trainer is told; written as `0.85`, the zone is a label that follows from the number.

**R-3 — keep the 7-zone power and 5-zone heart-rate tables as the only models. Holds, with one
finding for #2300.** Every category in the epic's survey maps onto a zone or a pair of them, except
that **sweet spot (0.88–0.94) straddles the zone 3/4 boundary at 0.91**, and neither 0.88 nor 0.94 is
in `POWER_ZONE_LOWER_FRACTIONS`. #2300's gate says *"the ranges come from `POWER_ZONE_LOWER_FRACTIONS`,
not from new literals"*, which can express sweet spot only as zones 3–4 (0.76–1.06), a band that
would also pass a tempo or a threshold set. **Proposal for #2300**: one named, documented constant
for the sweet-spot band beside the zone tables, stated once and cited, rather than a literal in the
test or a gate too loose to fail. Likewise #2300's threshold band *"0.91–1.05"* ends at 1.05 where
zone 4 ends at 1.06; it should be the table's `[0.91, 1.06)`. A three-zone polarised view stays a
later, separate decision.

**R-4 — heart-rate-zone workouts as heart-rate hold blocks. Holds, with one finding for #2298.** A
zone-2 heart-rate ride is a hold over *Endurance*, `[0.81, 0.90)` of threshold heart rate, with a
ceiling at or below 0.85 of threshold power; ADR 0048 D-3's H1–H11 apply unchanged, because the
template produces an ordinary `HeartRateHoldBlock`. **But the block stores its range in bpm**, and a
built-in template cannot know a rider's heart rate. So:

- the **template** carries the range as **shares of threshold heart rate**, a quantity the model does
  not have yet, and tailoring resolves it to bpm from the rider's own threshold heart rate (#2298);
- resolution should round **inward** (low up, high down) so the resolved range stays inside the
  zone, and then pass `validateWorkout` as any range does. For *Endurance* that is about 9 % of
  threshold heart rate wide, so H2's 6 bpm is met for any threshold heart rate above about 67 bpm
  before rounding; below that, tailoring **refuses** rather than widening the range, as the epic's
  invariant says;
- H1 means a heart-rate template **cannot run as a hold** for a rider whose threshold power or heart
  rate is an assumed default: the block then rides its starting share as a plain steady block, and
  browsing (#2304) should say so before the rider picks it.

---

## 6. The owner's ruling

**2026-11-06**, on [#2295](https://github.com/openzigs/onyourleft/issues/2295#issuecomment-6697920648)
(open question 1), posted from the owner's account: *"R-1 to R-4: **yes to all four**. An authored
library with no vendored corpus; targets as shares of threshold, with zones as labels only; keep the
existing 7-zone power and 5-zone heart-rate tables; heart-rate-zone rides written as heart-rate
holds."* The same comment records the rulings later issues rest on, among them: sprints of 20 s or
less are free-ride blocks (6), and every authoring pull request lists every workout name for the
owner to approve (8). Since the ruling is recorded, #2296 does not need `awaiting: owner`.

The two findings in §5.2 do not reopen R-3 or R-4: they say how #2298 and #2300 carry the rulings
out, and each lands on that issue for its own review.

---

## 7. What this did not do

- **No lawyer was asked.** Every conclusion above is a reading of licence text against this
  repository's existing rules (ADR 0009, ADR 0006, CLAUDE.md §3 and §6).
- **No trademark register was searched.** The names in §3 are banned because they are another
  product's names, which needs no registration to be a reason; whether any is registered was not
  checked. *80/20* in particular is listed on recognition, not on a record.
- **Not read first-hand**: intervals.icu's general Terms of Service (§2.6); TrainerRoad's own
  workout pages (the names in §3.2 come from search results); the What's on Zwift? collection pages
  (§3.3); other mirrors of Zwift's library (§2.1).
- **No GPL or AGPL source was opened**, and no other product's coaching text appears here. The quoted
  text is licence and terms text, quoted to record the decision as
  [`scope-and-ip.md`](../agents/scope-and-ip.md) §6 says of the Garmin licence, and the README and FAQ
  sentences of two MIT repositories about their own licence.
