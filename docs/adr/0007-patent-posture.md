# ADR 0007: Patent posture, and the segment-matching design-around

- **Status**: Accepted — on the strength of **D4**, which is the owner's recorded line. The
  *reasoning* below was not put to the owner (see **Deciders**), so an owner who wants it ratified
  before it binds #65/#66 should downgrade this to **Proposed** and say so here. Marking it
  Accepted is the author's call, made because four open issues are already acting on D4 and an ADR
  a reader is told not to rely on cannot correct them
- **Date**: 2026-09-03
- **Deciders**: The ✅/❌ line in decision **D4** is the **repository owner's**, recorded before this
  ADR in the bodies of [#92](https://github.com/openzigs/onyourleft/issues/92) and
  [#93](https://github.com/openzigs/onyourleft/issues/93) and in the Revision-2 block of
  [#14](https://github.com/openzigs/onyourleft/issues/14). **No one of those three states all four
  parts**: #92 carries the synthetic-pacer ✅ and two ❌, #93 carries the own-ride ✅ and the same
  two ❌, and #14's Revision-2 block states it as prose rather than as bullets. This ADR is the first
  place all four sit together, and assembling them is the author's work; each part is the owner's.
  The **reasoning** below — the claim readings, the design-around in **D2**, **D3** and **D6**, and
  the reconsideration procedure in **D5** — is the author's engineering work. **It was
  not put to the owner and no new owner decision was sought or given for this ADR.** Where it
  corrects a fact stated in #59's own body, it says so and shows the source
- **Issue**: [#59](https://github.com/openzigs/onyourleft/issues/59)
- **Supersedes**: nothing
- **Constrains**: [#65](https://github.com/openzigs/onyourleft/issues/65),
  [#66](https://github.com/openzigs/onyourleft/issues/66),
  [#68](https://github.com/openzigs/onyourleft/issues/68) — the matching and leaderboard half of
  [#12](https://github.com/openzigs/onyourleft/issues/12);
  [#92](https://github.com/openzigs/onyourleft/issues/92),
  [#93](https://github.com/openzigs/onyourleft/issues/93) — the pacer and ghost half of
  [#85](https://github.com/openzigs/onyourleft/issues/85);
  [#14](https://github.com/openzigs/onyourleft/issues/14) and
  [#16](https://github.com/openzigs/onyourleft/issues/16); and
  [#55](https://github.com/openzigs/onyourleft/issues/55) /
  [#60](https://github.com/openzigs/onyourleft/issues/60) where popularity data feeds routing
- **Relates to**: [ADR 0001](0001-licence.md) (which names patents as one of the two reasons this
  project is not MIT-licensed, and names #59 as an open constraint on itself),
  [ADR 0002](0002-local-first-architecture.md) (which is why a leaderboard needs an instance at all),
  [ADR 0004](0004-privacy-and-location.md) (whose `private-match` effort state is a privacy rule that
  this ADR does **not** substitute for), [ADR 0006](0006-fit-codec-licensing.md) (the standard of
  evidence this ADR tries to match), and
  [#19](https://github.com/openzigs/onyourleft/issues/19) (clean-room posture, ADR 0009)

> **This is an engineering decision recorded by engineers. It is not legal advice, and it is not a
> freedom-to-operate opinion.** ADR 0001 and ADR 0006 both say the same about themselves and this
> ADR is deliberately consistent with them. No blanket disclaimer follows: the three points where a
> lawyer genuinely adds value are named at the end, in the form of three specific claim charts, and
> everywhere else this document either shows its evidence or marks the question open.

---

## Context

Two facts make this a concrete question rather than a hypothetical one, and both are dated so a
future reader can check whether they have moved.

1. **Strava sued Garmin on 2025-09-30** on three patents plus breach of contract, and segment
   matching is [#65](https://github.com/openzigs/onyourleft/issues/65) and
   [#66](https://github.com/openzigs/onyourleft/issues/66) here — the core of the Strava half of the
   product, not an adjacent feature.
2. **Peloton's "Exercise System and Method" family produced two settlements in which the defendant
   removed the feature rather than litigate it.** iFIT settled on 2022-05-16 and Echelon on
   2022-11-08; in both, the disclosed term was the removal of on-demand leaderboard technology.

Neither fact means "we might get sued for anything". Both are narrow, and the claims are narrower
than the headlines. The purpose of this ADR is to convert them into constraints an implementer can
check their own code against, because "avoid infringement" is not something anyone can act on.

### Sources, with fetch dates

Everything below was read on **2026-09-03** unless stated otherwise. Patent claim text was read from
the granted-patent PDFs published by the USPTO via Google Patents, not from a summary; the column
references let a reader reproduce each reading.

| Source                                              | Where                                                                                                          | Observed                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| US 9,116,922 B2 — granted patent                    | `patentimages.storage.googleapis.com/18/a3/4c/349a98534cdfce/US9116922.pdf`                                     | 31 pp. Claims at cols. 19–24. Independent claims **1, 14, 16, 17**                                                                              |
| US 9,208,175 B2 — granted patent                    | `patentimages.storage.googleapis.com/a1/4a/18/a65b508f9fa416/US9208175.pdf`                                     | 30 pp. Claims at cols. 19–22. Independent claims **1, 16, 19**                                                                                  |
| US 9,297,651 B2 — granted patent                    | `patentimages.storage.googleapis.com/b0/57/dc/52246c07c2f97e/US9297651.pdf`                                     | 36 pp. Claims at cols. 27–32. Independent claims **1, 13, 23** — all three recite route suggestion                                                                                  |
| US 9,778,053 B2 — granted patent                    | `patentimages.storage.googleapis.com/70/85/b2/750661def0f1b8/US9778053.pdf`                                     | 36 pp. Claims begin at col. 27. Independent claims **1, 11, 21**                                                                                  |
| US 10,486,026 B2 — granted patent                   | `patentimages.storage.googleapis.com/6a/9f/62/9f6d408c3cb121/US10486026.pdf`                                    | 32 pp. Claims at cols. 15–18. Independent claims **1, 11**. Front page: PTA **0 days** under 35 U.S.C. 154(b)                                   |
| US 11,170,886 B2 — granted patent                   | `patentimages.storage.googleapis.com/e8/2f/38/f81d7c377019e9/US11170886.pdf`                                    | 38 pp. Claims at cols. 15–20. Independent claims **1, 19, 26, 27**. Front page: PTA **0 days**                                                  |
| Strava v. Garmin complaint, page 1                  | `garminrumors.com/wp-content/uploads/2025/10/Strava-vs-Garmin-Lawsuit-Segments-9-30.pdf`                        | Header reads `Case No. 1:25-cv-03074-DDD-CYC Document 1 filed 09/30/25 USDC Colorado pg 1 of 40`; captioned "COMPLAINT AND JURY DEMAND". **Only page 1 of 40 is served at this URL** |
| Google Patents bibliographic pages                  | `patents.google.com/patent/US{9116922,9208175,9297651,9778053,10486026,11170886}B2/en`                          | Priority, filing, grant, assignee and "Anticipated expiration" as tabulated below. Legal status **Active** for all six. **US 10,486,026 carries an `IPRC` legal event, effective 2023-03-27: "INTER PARTES REVIEW CERTIFICATE; TRIAL NO. IPR2020-01541 … CERTIFICATE ISSUED MAR. 27, 2023"** — re-read 2026-09-03, reproduce command below |
| EP 2691888 — European member of the Strava family   | `patents.google.com/patent/EP2691888A4/en`                                                                     | Publication **A4** (search report) 2014-09-17. Legal events end at **"THE APPLICATION HAS BEEN WITHDRAWN", effective 2022-11-03**. **No B1 grant publication exists in the family list** |
| Peloton / Echelon settlement                        | Reported from the joint press release of **2022-11-08** (`investor.onepeloton.com`, `sgbonline.com`, `bicycleretailer.com`) | Echelon agreed to cease using Peloton's patented leaderboard technology in its on-demand classes; all pending actions dismissed. Other terms undisclosed. **Peloton's own investor page timed out when fetched; this is secondary reporting of a joint release** |
| Peloton / iFIT settlement                           | `engadget.com/peloton-ifit-settlement-193547478.html`                                                            | **2022-05-16**: "iFit will remove some leaderboard features from its devices"; Peloton licensed iFIT remote-control patents in return                                       |
| Peloton's 2021-11-12 complaints against iFIT and Echelon | `pelobuddy.com/peloton-new-lawsuit-echelon-ifit/`                                                          | D. Del., **1:21-cv-01605-UNA** (iFIT) and **1:21-cv-01607-UNA** (Echelon), filed three days after the '886 grant. Complaint language quoted as *"[The] collected live performance parameters are used in subsequent sessions of the exercise class to enable ghost participants."* |
| Peloton v. Echelon appeals, Federal Circuit         | `cafc.uscourts.gov/opinions-orders/22-1586.ORDER.12-2-2022_2041894.pdf`                                          | Appeals **2022-1586, 2022-1588** from **IPR2020-01186** and **IPR2020-01187**, **DISMISSED by agreement, mandate 2022-12-02**                                                |
| Newson & Krumm, HMM map matching                    | ACM SIGSPATIAL GIS 2009, Seattle, pp. 336–343; `dl.acm.org/doi/10.1145/1653771.1653818`                          | Published **November 2009** — before the 2011-03-31 priority of the Strava segment family                                                                                   |
| Eiter & Mannila, discrete Fréchet distance          | Technical report CD-TR 94/64, Christian Doppler Laboratory, TU Vienna                                           | **1994**                                                                                                                                                                   |

**On quoting.** CLAUDE.md §6 and #19 (ADR 0009) say reading prior art is fine and copying from it
binds this project's licence. That applies to patent text too. Claim language is quoted below only
in the short fragments the analysis turns on, each with its patent and claim number, and no patent
specification, drawing or example is reproduced anywhere.

### The Strava family — what is actually claimed

| Patent           | Title                                    | Priority   | Filed      | Granted    | Anticipated expiry |
| ---------------- | ---------------------------------------- | ---------- | ---------- | ---------- | ------------------ |
| **US 9,116,922** | Defining and matching segments           | 2011-03-31 | 2011-03-31 | 2015-08-25 | 2031-03-31         |
| **US 9,208,175** | Defining and matching segments (cont.)   | 2011-03-31 | 2012-04-05 | 2015-12-08 | 2031-03-31         |
| **US 9,297,651** | Generating user preference activity maps | 2013-12-11 | 2014-12-09 | 2016-03-29 | 2034-12-09         |
| **US 9,778,053** | Generating user preference activity maps (cont. of '651's application) | 2013-12-11 | 2016-02-16 | 2017-10-03 | 2034-12-09 |

> ⚠️ **The expiry column is an estimate and must not be relied on.** It is Google Patents'
> "Anticipated expiration" field, which is arithmetic from the earliest non-provisional filing. **It
> is not verified against Patent Term Adjustment or against terminal disclaimers**, and both are
> live possibilities in a family this full of continuations. The only term data this ADR read
> directly is on the two Peloton front pages, which each recite 0 days of 154(b) adjustment. If a
> date near the end of a term ever matters to a decision, get it from the file wrapper, not from
> here.

**Strava asserted three of the four** — '922, '651 and '053 — against Garmin, together with a breach
of a 2015 cooperation agreement. It **voluntarily dismissed without prejudice about three weeks
later**; the case is refilable and no court ruled on infringement or validity. Reports differ on the
exact day by one: the notice is reported as 2025-10-21 and the docket termination as 2025-10-22.
Both CourtListener and Justia returned HTTP 403 when fetched on 2026-09-03, so **this ADR has read
page 1 of the complaint and no docket entry**. The distinction does not change any decision below.

**'922 — the oriented virtual start line, and an extrapolation.** Every one of its four independent
claims (1, 14, 16, 17) recites the same two-part construction:

> generating a virtual start line associated with the segment based at least in part on: determining
> a path through at least a user selected segment start point … determining an orientation of the
> path; and setting the virtual start line in relation to the orientation of the path
>
> — US 9,116,922 claim 1, cols. 19–20

and then defines the match by that line being crossed, where crossing is itself defined as

> generating an extrapolation associated with at least a portion of the second set of GPS data …
> determining that the extrapolation crosses the virtual start line
>
> — US 9,116,922 claim 1, cols. 19–20 (same claim, continuing)

Two independent hooks, then, not one. A matcher that constructs no oriented start line is outside
the first; a matcher that extrapolates no GPS data is outside the second. That second one is worth
noticing because Strava's own support documentation, quoted in #65, says its product *"doesn't
interpolate or extrapolate GPS data"* — so the claim and the documented product behaviour are not
the same thing, which is exactly why a design is checked against claims and not against a
competitor's feature list.

**'175 is not simply "more of '922", and #59's body assumes it is.** Its independent claims (1, 16,
19) contain **no virtual start line at all**. What they require instead is a **segment
de-duplication step**: determining that a newly submitted first segment "is redundant with respect
to a second segment stored in the segments database" because the two definitions "at least partially
overlap", then "discarding the second segment from the segments database", and matching efforts with

> a first threshold of match for a loose match or a second threshold of match for a tight match, and
> wherein the tight match comprises determining that the matching effort crossed a start line and a
> finish line
>
> — US 9,208,175 claim 1, cols. 19–20

This is the finding that most changes what #65 must avoid, and it was found by reading the grant
rather than the family summary. Avoiding the oriented start line does **not** clear this family.
Avoiding a two-tier loose/tight matcher whose tight tier is "crossed a start line and a finish line",
and avoiding an automatic discard-the-overlapping-stored-segment step, is a second and separate
obligation. Both are in D2 below.

**'651 and '053 — the popularity map.** Both recite the same unusual mining limitation, and it is
the limitation that a naïve heatmap would *not* practise:

> mining user activity data based at least in part on an order associated with a plurality of GPS
> recording device types
>
> — US 9,778,053 claim 11, col. 30; the same limitation at US 9,297,651 claim 1, col. 27

They then diverge, and the divergence matters. **'651's independent claims all additionally require
route suggestion** — "determine one or more suggested routes between a user input first endpoint and
a user input second endpoint based at least in part on the user preference map" (claim 1, col. 27).
**'053's claims 1, 11 and 21 do not**: aggregating activities onto a base map to generate a
user preference map is the whole of it, with routing pushed down into dependent claims 9, 19 and 29.
So the bare heatmap sits inside '053's independent claims but for the device-type-order limitation,
which is therefore the single limitation carrying the weight — and it is a strange enough limitation
that a design can be checked against it in one code review.

### The Peloton family — what is actually claimed

| Patent            | Title                    | Priority   | Filed      | Granted    | Anticipated expiry |
| ----------------- | ------------------------ | ---------- | ---------- | ---------- | ------------------ |
| **US 10,486,026** | Exercise system and method | 2012-07-31 | 2019-05-14 | 2019-11-26 | 2033-07-31         |
| **US 11,170,886** | Exercise system and method | 2012-07-31 | 2021-05-19 | 2021-11-09 | 2033-07-31         |

Same estimate caveat as above.

**'026 claim 1 is a ranked list built from other people's earlier sessions.** Reduced to its
limitations, the claimed system receives

> archived performance data representing archived user performance parameters for **a plurality of
> other users** … wherein the archived performance data was previously generated by the other users
> … while participating in the archived exercise class

synchronises that data with the present user's, and causes a display of

> a dynamically updating ranked list of the first user performance parameter and at least some of
> the synchronized archived user performance parameters, to thereby simulate the first user
> competing with at least some of the other users
>
> — US 10,486,026 claim 1, cols. 15–16

Four limitations, each of which alone puts a design outside the claim: **other users** (not the
rider's own history), **archived** parameters from a prior session, **synchronised** to a common
timeline, and a **dynamically updating ranked list**.

**'886 is where the word "ghost" actually appears**, and it appears in a dependent claim and in one
independent method claim, not in claim 1. Claim 1 requires a plurality of networked exercise devices,
a **previously recorded on-demand exercise class led by at least one instructor**, a **synchronizing
signal** carried in that class content marking the start and end points for parameter collection, and
a **control station**. On top of that, claim 9 adds that the synchronised parameters "are used in a
subsequent session to enable ghost participants", and independent claim 19 requires that during a
subsequent session the maintained synchronised parameters be provided to an exercise device where
they "represent ghost riders during the subsequent session" (cols. 17–18).

So Peloton's ghost claims are **class-shaped**: instructor-led recorded content, a synchronising
signal embedded in it, multiple users' live parameters collected against it, a control station
serving them back. That structure is not incidental — it is most of the claim.

### What this ADR did **not** verify

- **Wahoo's and Zwift's portfolios.** #59's body concludes they are hardware patents and therefore
  irrelevant to a project that ships no hardware. That conclusion is plausible and this ADR neither
  confirms nor relies on it: **no Wahoo or Zwift patent was read.** Nothing below depends on it.
- **Any non-US right other than EP 2691888.** No GB, DE, CA or AU national-phase search was done for
  either family, and no non-US member of the Peloton family was examined. See the open questions.
- **Whether either family has pending continuations.** The Strava map family continued at least to
  US 10,240,939; a design-around checked against granted claims is not checked against claims that
  have not issued yet.
- **Which claims of '026 the IPR2020-01541 certificate cancelled or confirmed.** That the proceeding
  reached a final written decision *is* established below; the per-claim outcome is not, and this one
  is important enough to state as a correction rather than as an omission.

### A correction: "US 10,486,026 survived IPR" is not established

**#59's body and #92's body** state that '026 "survived IPR2020-01541 (PTAB sided with Peloton,
March 2021)" — and only those two: `gh issue view <n> --json body` on **#93** and **#14** returns no
match for `IPR` at all (#93 cites the family without any validity assertion; #14's Revision-2 block
quotes only the Echelon/iFIT settlement language). **This ADR could not verify the assertion, and
what it did verify points elsewhere.** What is established:

- Echelon Fitness Multimedia petitioned against three Peloton patents — IPR2020-01186 ('315),
  IPR2020-01187 ('590) and IPR2020-01541 ('026) — and **the Board instituted trial on all three in
  early 2021**. An institution decision is the Board finding a reasonable likelihood the *petitioner*
  prevails. If the "March 2021" date in those issue bodies refers to anything real, it is most likely
  this — which is a point **against** Peloton, not for it.
- **US 10,322,315 and US 10,022,590 were held unpatentable as obvious**, in final written decisions
  reported as January 2022 — that date is from reporting, not from the decisions themselves, which
  this ADR did not retrieve. What **was** read directly is the consequence: Peloton appealed both,
  and the Federal Circuit dismissed the appeals by agreement with a mandate on **2022-12-02**
  (2022-1586, 2022-1588), shortly after the Echelon settlement. Appeals do not get taken from
  decisions Peloton won.
- For **IPR2020-01541** the *secondary* record is contradictory: one summary reports a final written
  decision dated 2022-03-02, another reports the parties jointly moving to file a confidential
  settlement agreement, which would mean termination without a merits decision. **The primary record
  settles that much.** Google Patents' legal-event list for '026 carries, effective **2023-03-27**:

  ```
  2023-04-04  IPRC  Trial and appeal board: inter partes review certificate
    Kind code of ref document: K1
    INTER PARTES REVIEW CERTIFICATE; TRIAL NO. IPR2020-01541, SEP. 1, 2020
    INTER PARTES REVIEW CERTIFICATE FOR PATENT 10,486,026, ISSUED NOV. 26, 2019,
      APPL. NO. 16/412,327, MAY 14, 2019
    INTER PARTES REVIEW CERTIFICATE ISSUED MAR. 27, 2023
  ```

  Read 2026-09-03; reproduce with

  ```bash
  curl -sL -A 'Mozilla/5.0' https://patents.google.com/patent/US10486026B2/en \
    | grep -A24 '>IPRC<' | sed 's/<[^>]*>//g'
  ```

  Under **35 U.S.C. § 318(b)** and **37 C.F.R. § 42.80** a certificate issues *after* a final written
  decision and after any appeal is terminated; a pre-decision termination on joint request under
  **§ 317** produces no certificate at all. **So IPR2020-01541 did reach a final written decision** —
  the settlement report, if accurate, describes a settlement of the appeal rather than of the trial,
  and both facts then fit at once. What the legal-event line does **not** say is *which* claims the
  certificate cancelled, confirmed or amended, and that is the whole of what remains open.

**The honest statement is therefore: IPR2020-01541 reached a final written decision, and the
per-claim outcome for '026 has not been read.** Two of its close siblings were held unpatentable.
Neither "'026 survived IPR" nor "'026 was cancelled" may be asserted in this repository until the
certificate itself is read. A maintenance fee was paid on '026 on 2023-05-07, after the certificate,
which is *consistent with* claims having survived — but a maintenance fee is paid on a patent, not
on a claim, and it settles nothing.

**The step that would settle it**, precisely: read **the inter partes review certificate itself**
(kind code **K1**, issued 2023-03-27), which recites on its face which claims were cancelled and
which were confirmed. It is in the file wrapper for **App. No. 16/412,327** in Patent Center, and on
the **IPR2020-01541** PTAB docket alongside the final written decision. One document, one answer.
This ADR could not retrieve it without an account: Google Patents serves no `US10486026K1` document
page (404 on 2026-09-03), `developer.uspto.gov/ptab-api` now redirects to the Open Data Portal and
wants a key, and `ptacts.uspto.gov` returns 403 to a scripted fetch. **Owner: whoever takes the
Question 1 claim chart below to a lawyer** — it should be bundled with that instruction rather than
done twice. Until it is read, no issue in this repository may state that '026 survived IPR; **#59 and
#92 carry that claim today** and each is corrected by a comment pointing here.

---

## Decision

Seven rules. D1 is about what this document is; D2, D3 and D6 are the design-around; D4 is the line
four issues already act as though exists; D5 says how to reopen it; D7 is about how facts get into
this repository.

### D1 — This is not a freedom-to-operate opinion and must not be quoted as one

No search of the patent landscape was performed. Six patents were read because two known disputes
pointed at them. A freedom-to-operate opinion is a systematic search plus a legal conclusion; this is
neither. **Anyone citing this ADR as clearance is misusing it**, including a future contributor
reading it in a hurry, which is why it is rule D1 rather than a footnote.

What this ADR *is*: a record of what specific published claims require, and of design choices made
so that the question does not arise in the first place.

### D2 — The segment matcher: five things it may not do

Binding on [#65](https://github.com/openzigs/onyourleft/issues/65)'s recommendation and
[#66](https://github.com/openzigs/onyourleft/issues/66)'s implementation. Each is checkable by
reading our own code; none requires reading a patent.

1. **No oriented virtual start line derived from a user-selected start point.** Do not compute a path
   through a user-selected start point, take its orientation, and set a line in relation to that
   orientation. ('922, all four independent claims.)
2. **No extrapolation of GPS points to decide a crossing.** Effort detection may use only recorded
   samples. If two consecutive samples straddle the segment start, that is a fact about the samples;
   synthesising an intermediate point in order to declare a crossing is the thing to avoid. ('922,
   all four independent claims — a second and independent hook.)
3. **No two-tier loose/tight match whose tight tier is defined as crossing a start line and a finish
   line.** One similarity criterion with one threshold, or a different structure entirely. ('175,
   independent claims 1, 16, 19.)
4. **No automatic redundancy discard of a stored overlapping segment.** When a new segment overlaps
   one already stored, this project keeps both. Deduplication, if it is ever wanted, is a
   presentation-layer grouping, never a delete of the earlier record — and there are good reasons for
   that anyway: a discarded segment silently orphans its efforts, and ADR 0002 makes the athlete's
   own signed record the source of truth. ('175, independent claims 1, 16, 19.)
5. **No segment definition flow whose only input is picking points on a map.** Segment definition by
   **importing a GPX**, or by selecting a span of an existing recorded activity, is the primary path.
   A point-picking UI is not forbidden outright — '922's other limitations are what matter — but it
   is not the path the matcher is designed around.

**And one positive requirement.** The approach #65 recommends must be **traceable to published prior
art that predates 2011-03-31**, cited by name in the spike write-up. This is the point of D6 and it
is what makes the rest of D2 more than a list of avoidances: an approach whose lineage is a 2009
SIGSPATIAL paper is in a materially different position from one arrived at by reading a competitor's
product.

The map-matched, edge-sequence design #65 already carries as candidate 2 satisfies all six. It
snaps both the ride and the segment to a way sequence and compares edge-ID subsequences: there is no
start line, oriented or otherwise, nothing is extrapolated, matching is subsequence containment
rather than a two-tier threshold, and its ancestry is Newson & Krumm (2009) over a road graph, with
discrete Fréchet (Eiter & Mannila, 1994) available for the geometric fallback. **This ADR does not
choose the approach — #65 does, on measurements.** It rules out the shapes above and requires the
citation.

> **On #59's acceptance criterion 2**, which asks this ADR to state the constraint in implementable
> terms *"and name the chosen alternative"*: the naming half is **deliberately deferred to #65**.
> #65 is a spike whose entire job is to choose on measurements, and an ADR choosing ahead of it
> would be an architecture decision made on no data. Candidate 2 above is named as *satisfying* D2,
> not as selected. This is a deviation from the criterion as written and is listed as one in the
> pull request.

> ⚠️ **D2 is not a privacy rule and does not replace one.** ADR 0004's `private-match` effort state
> and #66's three-state effort model stand entirely independently. An effort that is invisible for
> privacy reasons is not thereby outside a patent claim, and vice versa.

### D3 — Popularity data: the mining input, and where it may be used

Binding on any heatmap, popularity layer or popularity-weighted routing, wherever it lands (#12, #55,
#60).

1. **Activity data is never mined, ordered, weighted or filtered by GPS recording device type.** Not
   by device model, not by manufacturer, not by a "trust these devices more" ranking. This is the one
   limitation every independent claim of both '651 and '053 recites, and there is no product reason
   to want it: a preference for one brand's traces over another's is a data-quality heuristic that
   would be better expressed as accuracy metadata on the samples.
2. **A popularity layer that suggests routes between two user-input endpoints is a separate step and
   a separate review.** '651's independent claims all require it; '053's do not. Displaying edge
   popularity is one feature; using a preference map to answer "route me from A to B" is another, and
   it is the one the claims reach further into. When #55 or #60 wants it, it comes back here.

### D4 — The ghost line

Each part of this line is the owner's, recorded in #92, #93 and #14 before this ADR existed — though
no one of those three carries all four parts (see **Deciders**). What follows is why it holds against
the claim language actually read.

✅ **A bot pacer is not a ghost at all** ([#92](https://github.com/openzigs/onyourleft/issues/92)).
It is synthetic: computed from a target w/kg and a pacing rule, through the same physics model as the
rider (#88). **It replays no prior session's performance parameters — from this rider or from anyone
else — because there is no recorded ride behind it.** '026 claim 1 needs "archived performance data
… previously generated by the other users"; '886 claim 19 needs "live performance parameters"
collected from users' sensors during a live session. A bot has neither, so it is outside the claim
language **by construction, not by argument**. That is not a happy accident: it is the reason #92 is
a bot rather than a recorded rider, and recording that reason here is half the point of this ADR.

✅ **A rider's own previous ride on the same route, as a private unranked pacing aid**
([#93](https://github.com/openzigs/onyourleft/issues/93)). Two independent limitations fail: the data
is the **rider's own**, not "a plurality of other users" ('026 claim 1), and there is **no ranked
list** — one line on a screen, no ordering, nothing published or exported. There is also no class, no
instructor, no synchronising signal and no control station, which is most of '886 claim 1. #93's
existing acceptance criterion that a test assert only the rider's own activities can source a ghost
is doing double duty: it is a cross-athlete exposure control under CLAUDE.md §6 **and** it is what
keeps the "other users" limitation false.

❌ **A ghost of another rider. Not behind a setting, not opt-in, not in a later phase.** The moment
another person's recorded ride drives an on-screen rider, the "other users" and "archived/live
performance parameters … used in subsequent sessions" limitations are both live, and the remaining
distance to the claim is argument rather than construction.

❌ **A ranked leaderboard populated by ghost participants replaying prior sessions.** This is the
combination — ranking plus replay of others' prior sessions — that two well-funded companies deleted
from shipping products rather than defend. Cross-athlete leaderboards over *stored efforts with
times* are a different thing and are #68's, unaffected by this rule: a table of finishing times is
not a ghost participant, and nothing in it is synchronised into a live session.

### D5 — What would have to change for the ❌ items, and who decides

Not "never" as a slogan. Concretely, **all three** of the following, in order:

1. **A fact changes.** The relevant claims expire (estimated 2033-07-31 for the Peloton family, not
   verified — see the caveat), or are held unpatentable in a decision that is final and unappealable,
   or the rights are abandoned or licensed to us. A settlement between other parties is not one of
   these; neither is a dismissal without prejudice.
2. **A new ADR supersedes this one**, citing the changed fact with its source and date. `docs/adr/`
   is a protected path: an ADR is amended by a successor, never edited.
3. **The repository owner decides**, on the record, in the successor ADR's Deciders line. The line in
   D4 is the owner's; **an implementer, a reviewer and an agent may not relax it**, and neither may a
   later issue's acceptance criteria. An issue proposing a cross-rider ghost reopens #59 first — as
   #93 already says, and it is not a formality.

Before step 3, the claim chart in Question 2 below is the thing worth buying.

### D6 — Prior art is recorded, because it is the difference between two identical-looking designs

Patents claim **methods**. The question for #65 is never "is segment matching patented" — it is
"which method is claimed, and is ours one of them". An approach traceable to published literature
that predates the priority date is in a materially different position from one that arrives at the
same place by inspection of a competitor.

So #65's write-up **names its lineage**, with citation and date, for whichever approach it
recommends. The two that already apply:

- **Map matching**: Newson & Krumm, *Hidden Markov Map Matching Through Noise and Sparseness*, ACM
  SIGSPATIAL GIS 2009, pp. 336–343 — November 2009, sixteen months before '922's 2011-03-31 priority.
  The map-matching and GPS-trace-snapping literature is older still; this ADR did not survey it, and
  #65 cites what it actually used.
- **Curve similarity**: Eiter & Mannila, *Computing Discrete Fréchet Distance*, CD-TR 94/64,
  Christian Doppler Laboratory, TU Vienna, 1994. Direction-preserving, which #66 needs anyway for the
  ridden-backwards case.

This is a recording obligation, not a legal argument: **prior art is a matter for a court or the
PTAB, not for us**, and this ADR does not claim any of these references invalidates anything. What
the citation buys is that a future reader can see where the design came from.

### D7 — No patent claim enters this repository without a citation and a date

An unverified patent assertion in an ADR is worse than an open question, because everything
downstream inherits it as settled — which is exactly what happened with "'026 survived IPR", written
once in #59 and repeated in #92, and repeated again in the first draft of this ADR as a claim about
which issues carried it. So:

- Any statement in this repository about what a patent claims cites the **patent number, the claim
  number and the column**, and is read from the granted patent rather than from a family summary or
  a news report.
- Any statement about litigation cites the **case number and court**, and says whether it was read
  from a docket or from reporting.
- Anything that could not be verified is **written as an open question with the step that would
  settle it and the person who owns that step** — as the IPR2020-01541 paragraph above does.

### Which of D1–D7 a machine checks: **none of them**

CLAUDE.md §8 says it about `WF001` — *"A documented ban is not a gate"* — and `docs/architecture.md`
says it about itself: *"the rules were checkable but unchecked — a distinction worth keeping in mind
about every other row in this document that says 'enforced'."* This ADR adds no script check, so:

- **D2, D3, D4 and D5 are review-time obligations.** D2's five prohibitions are geometry; no grep
  decides whether a matcher declares a crossing by extrapolating a point. They bite because they are
  carried as acceptance criteria on #65, #66 and #68 and because a reviewer applies them.
- **D1 and D6 are documentary obligations** on a spike write-up, checked by whoever reads it.
- **D7 is the only one that could plausibly become a rule.** A `check-repo-rules.sh` check of the
  shape *"a file under `docs/` naming a `US N,NNN,NNN` pattern must carry a claim number and a date
  within N lines"* is writable. **It is not written**, and this ADR does not write it: that is a code
  change in a docs-only change, and the false-positive rate against ordinary prose has not been
  measured. If it is wanted it needs its own issue, next to
  [#24](https://github.com/openzigs/onyourleft/issues/24)'s other unenforced gates.

So nothing mechanical stops a future pull request re-asserting "'026 survived IPR" — which is the
defect D7 exists to prevent and the defect that produced this ADR's own first-draft error. A
reviewer noticing is the entire mechanism, and a reader should know that rather than infer an
enforcement that is not there.

---

## Consequences

### What this enables

- **#65 can start.** It has five prohibitions it can check a prototype against, a positive
  requirement to cite its lineage, and confirmation that its candidate 2 (map-matched edge sequences)
  satisfies all of them. That is the blocker #12 recorded against #59 discharged.
- **#92 and #93 can be built as specified**, with the reason recorded rather than folklore. The next
  person to ask "why is the pacer a bot instead of a recorded rider?" gets an answer with claim
  numbers in it.
- **#68's cross-athlete leaderboard is untouched.** It ranks stored efforts with times. It is not a
  ghost participant and not a synchronised replay, and nothing in D4 constrains it.

### What this costs

- **A design freedom is given up in D2.4 and D3.1** — automatic segment de-duplication, and any
  device-type-based weighting of activity data — and both were mildly wanted. Neither is expensive to
  live without and both have independent justifications, which is the ideal shape for a
  design-around: nobody has to remember the patent reason for it to hold.
- **Segment definition leans on GPX import and activity-span selection** rather than point-picking,
  which is a slightly heavier first-run experience.
- **Popularity routing needs a second look before it ships**, per D3.2. It is not blocked; it is
  gated on a review that has to happen once.

### Constraints this places on other work

| Issue                                         | What it inherits                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [#65](https://github.com/openzigs/onyourleft/issues/65) | D2's five prohibitions as acceptance criteria on the recommendation; D6's citation requirement |
| [#66](https://github.com/openzigs/onyourleft/issues/66) | The same five, as acceptance criteria on the implementation                                 |
| [#68](https://github.com/openzigs/onyourleft/issues/68) | D4's second ❌ — a leaderboard of stored efforts is fine, a leaderboard of ghost participants replaying sessions is not |
| [#92](https://github.com/openzigs/onyourleft/issues/92) | D4's first ✅, and the reason the pacer is synthetic                                        |
| [#93](https://github.com/openzigs/onyourleft/issues/93) | D4's second ✅, and D5 as the only route to widening it                                     |
| [#14](https://github.com/openzigs/onyourleft/issues/14), [#16](https://github.com/openzigs/onyourleft/issues/16) | D4 entire                                                          |
| [#55](https://github.com/openzigs/onyourleft/issues/55), [#60](https://github.com/openzigs/onyourleft/issues/60) | D3, when popularity data reaches routing                          |
| [#59](https://github.com/openzigs/onyourleft/issues/59), [#92](https://github.com/openzigs/onyourleft/issues/92) | The IPR correction above — both state "'026 survived IPR" and both need a comment pointing here. **#93 and #14 do not state it**; they inherit the family framing from #59 and need no correction |

### Open questions, and who owns each

1. **Which claims of US 10,486,026 the IPR certificate cancelled, confirmed or amended.** *Not*
   whether the proceeding reached a decision — the certificate issued 2023-03-27 and under 35 U.S.C.
   § 318(b) that means it did. One document, published: the K1 certificate itself. Owner: bundled
   with the lawyer questions below. Stated in full above.
2. **Non-US rights.** **EP 2691888 is resolved and is good news**: the European member of the Strava
   segment family reached only an A4 search-report publication and its legal events end at "the
   application has been withdrawn", effective 2022-11-03, with **no B1 grant in the family**. So
   there is no granted European patent in that family to design around. **What remains open** is
   every other jurisdiction — no GB, DE, CA or AU national-phase search was done, the '651/'053 map
   family's non-US members were not examined, and the Peloton family's non-US members were not
   examined at all. This matters only if the reference instance is hosted outside the US or a
   contributor distributes from elsewhere; ADR 0002 puts Phase 1 entirely on the athlete's device,
   which defers it. Owner: [#7](https://github.com/openzigs/onyourleft/issues/7) when an instance is
   first hosted.
3. **Pending continuations in both families.** A design-around verified against granted claims is not
   verified against claims still in prosecution. Owner: re-check when the Question 1 claim chart is
   commissioned.
4. **Term.** Every expiry date here is an estimate, unverified against PTA and terminal disclaimers.
   Owner: whoever first wants to rely on an expiry — nobody yet.

---

## The three questions for a lawyer

A targeted opinion on a handful of claims, not a freedom-to-operate study. All three are answerable
from public documents plus a short description of our design, and between them they cover everything
above that an engineer should not be deciding.

**Question 1 — a claim chart of US 9,116,922 and US 9,208,175 against the design #65 recommends.**
Specifically: does an edge-sequence matcher over a map-matched way graph, with no start line and no
extrapolation, read on any independent claim of either patent — including under the doctrine of
equivalents, where "we snap to a graph instead of drawing a line" is exactly the kind of argument an
engineer is unqualified to weigh? **Bundle the IPR2020-01541 certificate retrieval with this.** Ask after
#65 has a recommendation and before #66 starts: a chart against a hypothetical design is wasted
money.

**Question 2 — a claim chart of US 10,486,026 and US 11,170,886 against #92 and #93 as specified.**
The engineering claim being tested is that a synthetic bot is outside both by construction, and that
an own-ride ghost fails the "plurality of other users" limitation of '026 claim 1 and the class /
instructor / control-station structure of '886 claim 1 independently. If that is right, D4's two ✅
items are safe and no more legal work is needed on them ever. If it is wrong, this is the cheapest
possible moment to learn it — #92 is 5 points and #93 is 3.

**Question 3 — does a design-around narrow enough to be described in five bullets raise a wilfulness
exposure it would not otherwise have?** This is the counter-intuitive one and it is why D1 exists. A
documented, dated engineering record of deliberately avoiding specific claims is normally the good
kind of evidence, but it is also a record that we read the patents. **Is this document, published in
a public repository, net helpful or net harmful, and should any part of it be worded differently?**
An engineer cannot answer that and should not guess; if the answer is "reword", a successor ADR does
it.

Three things a lawyer is **not** being asked, because nothing depends on them: whether Wahoo's or
Zwift's hardware patents matter (no hardware is shipped and none were read); whether the Strava v.
Garmin contract claim has any bearing (it is a 2015 agreement between two other parties); and whether
'922 or '175 would survive a validity challenge (this project is not going to fund one, so the
answer changes nothing it would do).

---

## Notes

### Numbering

This ADR takes **0007**, as `docs/architecture.md` records and as #59's acceptance criteria specify.
Unlike 0002, 0006 and 0008, this number was never double-claimed; the ownership table settled by
[#112](https://github.com/openzigs/onyourleft/pull/112) (closing
[#97](https://github.com/openzigs/onyourleft/issues/97)) lists 0007 against #59 alone. Rule `ADR001`
in `scripts/check-repo-rules.sh` fails the build on a duplicate and `ADR002` on a malformed filename,
so neither can be got wrong silently.

### On not overstating this

The two facts at the top are specific, and a reader should come away able to say what is claimed and
what is not. Of the six patents read, **none has an independent claim that covers "segment matching"
or "a leaderboard" in general.** Each turns on a construction — an oriented start line, a redundancy
discard, a device-type ordering, a ranked list of other people's archived parameters — that a
differently designed product simply does not have. That is the useful shape of this risk, and a
posture reading "we might be sued for anything" would have obscured it as thoroughly as ignoring the
risk would.

Equally: no court and no board has ruled that any of these claims is invalid, the Strava case is
refilable, and the two Peloton settlements are evidence that defending one of these is expensive
enough that two funded companies chose to delete a feature instead. Both halves are true at once.

### What would make this ADR wrong

- The IPR2020-01541 certificate turns out to have cancelled '026's independent claims. D4 would not
  change — the ✅ items are outside those claims either way and the ❌ items are also constrained by
  '886, which was never challenged — but the risk description would, and Open Question 1 would close
  in this project's favour. The reverse (the certificate confirms them) is equally possible and is
  why the question is open rather than assumed.
- A continuation issues in either family with claims that reach the design D2 permits.
- #65 recommends a geometric approach after all, on measurements. D2 still binds, but prohibitions 1,
  2 and 3 become live design pressure rather than a description of a design that already avoids them,
  and the Question 1 claim chart becomes more valuable rather than less.
