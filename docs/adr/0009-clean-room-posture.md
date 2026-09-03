# ADR 0009: Clean-room posture toward Strava and Zwift

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: The **premise** is the repository owner's — **owner decision D1**, Revision 2 of
  [#1](https://github.com/openzigs/onyourleft/issues/1), restated by the owner in a comment on
  [#19](https://github.com/openzigs/onyourleft/issues/19) on 2026-09-03. D1 says the Strava API
  Agreement is a contract binding people who use the Strava API, that this project does not and
  will not, and that reimplementing the concepts is therefore permitted. **Everything else in this
  document is the author's engineering work and was not put to the owner.** The split is tabulated
  in [Authority](#authority) rather than left to the reader, because three review rounds in this
  repository have now caught an ADR claiming owner authority it did not have
- **Issue**: [#19](https://github.com/openzigs/onyourleft/issues/19)
- **Supersedes**: **no ADR.** The retracted "Strava's terms forbid this product" reasoning never
  reached an ADR — it lived in the bodies of #1, #2, #5, #11, #12, #13, #16, #31, #32 and #51, and
  the owner purged it from all ten before this was written. This ADR is where the corrected
  reasoning becomes citable, and [What was retracted](#what-was-retracted-and-why-it-was-wrong)
  records the reversal explicitly so that no reader has to reconstruct it from issue history
- **Constrains**: [#5](https://github.com/openzigs/onyourleft/issues/5) and
  [#51](https://github.com/openzigs/onyourleft/issues/51) (file import/export — the whole
  interoperability surface); [#11](https://github.com/openzigs/onyourleft/issues/11),
  [#12](https://github.com/openzigs/onyourleft/issues/12),
  [#13](https://github.com/openzigs/onyourleft/issues/13),
  [#16](https://github.com/openzigs/onyourleft/issues/16) (the reimplemented concepts);
  [#29](https://github.com/openzigs/onyourleft/issues/29)–[#32](https://github.com/openzigs/onyourleft/issues/32)
  and [#40](https://github.com/openzigs/onyourleft/issues/40)–[#44](https://github.com/openzigs/onyourleft/issues/44)
  (prior-art reading, rule **R1**);
  [#49](https://github.com/openzigs/onyourleft/issues/49) (the design system — **L1**);
  [#91](https://github.com/openzigs/onyourleft/issues/91) (world assets — **L2**);
  [#24](https://github.com/openzigs/onyourleft/issues/24), which owns the only machine check this
  ADR asks for
- **Relates to**: [ADR 0001](0001-licence.md) (the licence boundary that **R1** protects),
  [ADR 0004](0004-privacy-and-location.md) (other people's location data, from the privacy side),
  [ADR 0006](0006-fit-codec-licensing.md) (the same facts-versus-expression rule, applied to
  Garmin's FIT SDK; **R1** here is its generalisation and ADR 0006 R4 explicitly deferred the
  general form to this ADR), [ADR 0007](0007-patent-posture.md) (**patents, which this ADR does not
  cover and must not contradict**), [ADR 0008](0008-mobile-client-architecture.md) (whose D-5
  "there is no world to design" depends on **L2**), and `CLAUDE.md` §6, which already enforces
  **R1** on contributors and now has a home for its reasoning

> **This is an engineering decision recorded by engineers. It is not legal advice.** ADR 0001,
> ADR 0006 and ADR 0007 all say the same about themselves and this one is deliberately consistent
> with them. No blanket disclaimer follows: the three points where a lawyer genuinely adds value
> are named at the end as three specific questions, and everywhere else this document either shows
> the source it read, with the date, or marks the question open.

---

## Context

### The sentence that does the work

> **The Strava API Agreement is a contract. It binds people who use the Strava API. We are not one
> of them, so it does not bind us.**

That is repeatable by a non-lawyer, and it is the whole hinge. A contract binds its parties. You
become a party to the Strava API Agreement by accepting it — the agreement itself says how, in its
preamble, read on 2026-09-03: *"By accessing or using the Strava API Materials, you acknowledge that
you have read, and agree to abide by, this Agreement."* This project never does that. It obtains no
token, calls no endpoint, and holds no API Materials.

The clause the first planning pass was frightened of — *"You may not create applications that
compete with or replicate Strava functionality"* — is therefore **a condition on API access**. It is
what Strava may revoke a developer's token for. It is not, and could not be, a general prohibition
on writing cycling software, because Strava has no power to impose terms on a party it has no
contract with.

### What was retracted, and why it was wrong

**On 2026-09-03 the repository owner reversed this project's Strava posture** (decision **D1**,
Revision 2 of #1). The earlier position was that Strava's developer terms forbade building this
product at all. That was a category error: it read a contract binding Strava's API users as though
it were a rule of general application.

Every other term the first pass quoted at itself has the same shape — the restriction on displaying
other athletes' data, the restriction on use in connection with AI (API Policy §5.3, quoted below),
the 2026 developer-programme changes. **They are excellent reasons not to build on the Strava API.
They are not reasons not to build a cycling app.** Since this project makes no API call, none of
them attaches to anything it does.

Nine issues inherited the error and were corrected in the same pass. This ADR records the reversal
rather than quietly assuming the corrected position, because an ADR that silently reverses itself
teaches nobody anything, and the next person to read the Strava terms will otherwise re-derive the
same wrong conclusion. **Do not re-derive it.**

### What is not protected

Product **concepts** — a segment, a leaderboard, kudos, an activity feed, a club, a virtual group
ride, a training-load number — are not protected by that contract and are generally outside
copyright. **17 U.S.C. §102(b)** places procedures, processes, systems and methods of operation
outside copyright protection however they are described in a work; feature sets, workflow
conventions and the semantics of a data format go with them.

Where US courts have looked at reimplementing somebody else's interface for interoperability the
direction has been favourable — *Sega Enterprises v. Accolade*, 977 F.2d 1510 (9th Cir. 1992)
(intermediate copying for interoperability was fair use) and *Google LLC v. Oracle America*,
593 U.S. 1 (2021) (copying declaring code was fair use where Google "reimplemented a user
interface, taking only what was needed to allow users to put their accrued talents to work in a new
and transformative program"). **Note the limit**: the Court *assumed arguendo* that the API was
copyrightable and expressly declined to decide it. *Google v. Oracle* is not "APIs are free".

Its relevance here is modest anyway, and saying so is the honest framing: **this project copies no
Strava or Zwift code at all**, which is a materially stronger position than Google's was. Fair use
is a defence you need when you have copied something. The point of a clean-room posture is not to
have to raise it.

### Sources, with fetch dates

Read on **2026-09-03** unless stated otherwise.

| Source | Where | What it says, verbatim where it matters |
| --- | --- | --- |
| Strava **Terms of Service (2026)** | `strava.com/legal/terms` | Header: *"Terms of Service (2026) … Effective Date: January 1, 2026"*. Acceptance, §1: *"You indicate your acceptance of these Terms by accessing, using, or signing up for any Services."* §19 Proprietary Rights: *"Automated access to or collection of data from the Services—by any means, including data mining, robots, screen scraping, scripts, or similar data-gathering tools or software such as browser extensions and crawlers—is prohibited. This prohibition applies regardless of whether you are logged into a Strava account at the time of such automated access or collection."* Also §19: *"you agree not to … reverse engineer, reverse assemble, or otherwise attempt to discover any source code"* |
| Strava **API Agreement (2026)** | `strava.com/legal/api` | *"Effective Date: June 1, 2026"*. Preamble: *"By accessing or using the Strava API Materials, you acknowledge that you have read, and agree to abide by, this Agreement…"* Parties: *"made and entered into by and between Strava, Inc., or, if you are in the European Economic Area ('EEA'), Strava Ireland Limited … and you."* Highlights: *"You may not create applications that compete with or replicate Strava functionality."* §9.2: *"You understand that Strava may currently or in the future develop products and services that may be similar to or compete with your Developer Applications."* **Note that §5 of *this* document is "Privacy" and has only §5.1 and §5.2. The use restrictions are in the separate API Policy on the next row — see [Checking #19's citations](#checking-19s-citations-against-the-documents)** |
| Strava **API Policy (2026)** | `strava.com/legal/api_policy` — **a distinct document from the API Agreement above, at an adjacent path** | *"Effective Date: June 1, 2026"*. §1: *"To use the Strava API, developers must comply with this Strava API Policy (the 'Policy'), which is incorporated by reference into, and forms part of, the Strava API Agreement (the 'Agreement')."* **§5 is "Use Restrictions", running §5.1–§5.16.** §5.2 No Competing or Imitating Applications: *"You may not use the Strava API Materials in any manner that is competitive to Strava or the Strava Platform…"*, and may not *"create an application that imitates the look, imagery, or brand identity of Strava or the Strava Platform"*. §5.3: *"You may not use the Strava API Materials or Strava Data, directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application."* §5.4 No Aggregation: *"You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an aggregated, de-identified, or anonymized manner, for the purposes of analytics."* §5.5 No Scraping/Bulk Export: no *"web scraping, web harvesting, web data extraction methods, or any other automated means to extract data from the Strava Platform."* §5.16 No Abstraction Layers: no *"abstraction layer, integration-platform-as-a-service…that re-exposes the Strava API Materials."* **Every one of these opens "You may not use the Strava API Materials" — they are conditions on API access, and §1 gives the Policy exactly the Agreement's reach over exactly the Agreement's parties** |
| Zwift **Terms of Service** | `zwift.com/clubs/tos`; **last updated 2019-05-28**. `zwift.com/terms` 301-redirects to `support.zwift.com/categories/legal-rkCaoNtJS`, which did not render on fetch, and `zwift.com/eula` returns 404 | §5(h): *"Reverse engineer any aspect of our Platform or do anything that might discover source code or bypass or circumvent measures employed to prevent or limit access to any part of our Platform"*. §5(i): *"Use any data mining, robots or similar data gathering or extraction methods designed to scrape or extract data from our Platform…"*. §5(k): *"Develop or use any applications that interact with our Platform without our prior written authorization, including any cheats, mods or matchmaking services or applications that emulate or redirect the communication protocols used by Zwift…"* |
| **STRAVA** word mark | USPTO TSDR, `tsdr.uspto.gov/statusview/sn77693713` | Ser. 77693713 → **Reg. 3877582**, Strava, Inc. Filed 2009-03-18, registered 2010-11-16. Status **Live**: *"The registration has been renewed"*, status date 2021-07-27 |
| **KOM CHALLENGE** | USPTO TSDR, `tsdr.uspto.gov/statusview/sn85486389` | Ser. 85486389, BikeRx, LLC. **Dead** — *"Abandoned because the applicant failed to respond or filed a late response to an Office action"*, status date **2012-10-13** |
| **KOM AIR** | USPTO TSDR, `tsdr.uspto.gov/statusview/sn79130032` | Ser. 79130032 → Reg. 4553801, SINTEMA SPORT SRL. **Dead** — *"U.S. registration cancelled because International Registration cancelled in whole or in part"*, status date **2022-12-12** |
| `zoffline/zwift-offline` | GitHub repository **metadata only**, via `gh api repos/zoffline/zwift-offline`. **The source was not opened** — that is the point of **R2** | Description *"Use Zwift offline"*. Licence **AGPL-3.0**. Created 2017-11-26, last push 2026-06-02, not archived, 1,365 stars |
| `incyclist/devices` | `gh api repos/incyclist/devices` | Licence **MIT**. Confirms the one exception in `CLAUDE.md` §6's prior-art table |

### Checking #19's citations against the documents

**Strava publishes three separate legal documents at adjacent paths** — `/legal/terms` (Terms of
Service), `/legal/api` (the API **Agreement**) and `/legal/api_policy` (the API **Policy**) — and
their section numbering is independent. Reading the neighbour of the document you meant therefore
produces a confident, verbatim-quoted, wholly wrong answer.

An earlier draft of this ADR did exactly that. It fetched `/legal/api`, found §5 of the *Agreement*
to be "Privacy" with two subsections, and on that basis **withdrew #19's §5.4/§5.5 citation and
recorded the AI-application and no-intermediary clauses as "not located"**. Review caught it before
merge. **All three of #19's citations are correct**, and the retraction is retracted here rather
than shipped into a citable record:

1. **#19's §5.4 / §5.5 citation stands.** API Policy §5.4 is "No Aggregation, Analytics, or
   De-Identified Processing" and §5.5 is "No Scraping, Bulk Export, Harvesting, or Automated
   Extraction". Both are quoted in the sources table.
2. **The AI-application clause and the abstraction-layer clause both exist**, at API Policy §5.3
   and §5.16. Neither was missing; the wrong document was open.
3. **The API Agreement and the API Policy are both effective 2026-06-01**, distinct from the Terms
   of Service's 2026-01-01. "The June 2026 developer-programme changes" is a fair description of
   the pair, but a citation to either has to say which — that is the whole content of the mistake
   above.

**None of this touches the decision.** API Policy §1 states that the Policy *"is incorporated by
reference into, and forms part of, the Strava API Agreement"* and that *"[t]o use the Strava API,
developers must comply with"* it. It therefore has exactly the Agreement's reach over exactly the
Agreement's parties: people who use the Strava API. This project is not one of them, so §5.3, §5.4,
§5.5 and §5.16 bind it no more than the competing-applications clause does. They are four further
excellent reasons not to build on the Strava API and no reason at all not to build a cycling app.
**D1 stands, unchanged and unweakened.**

> ⚠️ **The durable lesson, recorded because it nearly went into the permanent record.** When a
> source is cited by **URL**, fetch *that* URL, and check the returned document's own title and
> effective date against the one you meant to read before you read a word of the analysis. A
> neighbouring document is worse than no document: it supplies real quotes for the wrong
> instrument, and a "this clause does not exist" written from one is stated with full confidence.

> ⚠️ **On the standard of the reading.** #19's acceptance criterion asks that the Strava documents
> be re-read *in full* before merge. What was actually done: each of the three was fetched on
> 2026-09-03 through a Markdown-converting fetch tool and queried for the clauses above, and the
> quotes in the table reproduce verbatim from those fetches. **That is not the same as a human
> reading forty pages page by page, and a converter can silently drop content.** Anyone whose
> decision turns on a clause **not** quoted in that table must read the document themselves first.
> This is stated rather than glossed because the whole failure this ADR corrects began with
> somebody trusting a paraphrase — and because the withdrawn retraction above came from fetching
> the wrong URL, which no amount of care about the converter would have caught.

---

## Decision

### Authority

| Part | Whose |
| --- | --- |
| **The premise** — the API Agreement binds API users; this project is not one; reimplementing the concepts from scratch is permitted | **Owner, decision D1** (Revision 2 of #1; restated on #19, 2026-09-03) |
| **L1–L5**, the five lines | **Author.** They are the corrected #19 body's five lines, phrased here so a reviewer can check a diff. The *substance* is the owner's retraction comment; the *checkable phrasing*, and the trade-dress limb of L1, are the author's |
| **R1** facts versus expression | **Author** — but it is already binding independently: `CLAUDE.md` §6 states it and ADR 0006 R3/R4 applies it to Garmin. This ADR is its home, not its origin |
| **R2** the do-not-read rule for `zwift-offline` | **Author's recommendation.** New. Not put to the owner. It costs nothing today (see the rule) but an owner who disagrees should say so here |
| **R3** the nominative-use template, **R4** KOM/QOM, **R5** file-based interoperability | **Author**, following from D1 and from the sources above |

### The premise (owner decision D1)

**Reimplement the concepts from scratch.** Segments, leaderboards, an activity feed, kudos, clubs, a
virtual ride — all of them, built from this project's own code, on this project's own users' data,
on OpenStreetMap geometry. That is permitted and it is the point of the product. No issue in this
repository may cite "Strava's terms" as a reason not to build a feature. If one does, it is wrong
and gets corrected.

### The five lines — each phrased so a reviewer can check a diff

"Respect their intellectual property" is not a rule anybody can act on. Each line below names the
artefact a reviewer looks at.

| # | Line | The check | Why |
| --- | --- | --- | --- |
| **L1** | **No Strava or Zwift name, mark, logo, stylisation, brand colour or overall get-up in the product.** | Grep the diff for `strava` and `zwift`, case-insensitively. **Every hit must be either prose in `docs/`, `README.md`, `CLAUDE.md`, an issue or an ADR, or an exact instance of the R3 template.** None may be a product name, a package name in a manifest, a directory or file name, an asset filename, a domain, an app-store listing field, a CSS custom property, or a UI label. Separately: the design system (#49) is ours — **do not reproduce their screen layout, colour palette and icon set as a set**, which is trade dress and is protected independently of any single mark | STRAVA is live on the US register (Reg. 3877582, renewed 2021-07-27). This is precisely what trademark law exists to stop and there is no fair-use argument for it. The trade-dress limb is the author's addition: "concepts are free" is true and stops short of a screen-for-screen copy |
| **L2** | **No Strava or Zwift code, asset, map data or course geometry, by any route.** | For any file in the diff that could plausibly have come from somewhere, **the PR body says where it came from.** No image, texture, 3D model, typeface, audio, avatar art, world geometry or marketing string derived from either product — including "for reference" and including machine-translated or decompiler output. Terrain comes from the athlete's own imported route (ADR 0008 D-5) or from OpenStreetMap | Their source, art and world geometry are protected expression. ADR 0008's "there is no world to design" is a *benefit* of this line, not a shortcut around it |
| **L3** | **No other athlete's data from any service.** | Every fixture in the repository is **synthetic** (as `packages/fit`'s corpus already is, per #107) or contributed by its own subject. No GPS trace, activity, name or avatar belonging to a person who is not a user of this project enters the tree, the store or a test | Other athletes' geolocation is personal data this project would have no lawful basis for, and the EU *sui generis* database right (Directive 96/9/EC) protects their compilation independently of copyright. ADR 0004 covers the same ground from the privacy side and is not superseded here |
| **L4** | **No scraping. Ever, of anyone.** | This project ships **no HTTP client, headless browser, crawler or browser extension pointed at `strava.com`, `zwift.com` or any third-party web UI**, and no test fixture is a saved response from one. **That is the durable form of the check: it is about what is fetched and from whom, not about whether anything is fetched at all**, so it survives the product growing a network. Today it is trivially checkable — owner decision D6 means there is no server, and until #60's map tiles land there is no outbound network call anywhere in the tree — and that convenience is temporary while the rule is not | Strava's Terms of Service bind **site visitors, not only API users** — acceptance is "by accessing", and §19's automated-access ban applies "regardless of whether you are logged into a Strava account". The exposure is **contract, not CFAA**: *hiQ v. LinkedIn* (9th Cir. 2022-04-18) and *Van Buren* (2021) narrowed the CFAA route, and then N.D. Cal. granted LinkedIn summary judgment on **breach of contract** (2022-11-04), ending in a consent judgment (#19 records $500,000), a permanent injunction and destruction of source and data. Quite bad enough |
| **L5** | **This project does not reverse engineer either product at all, and no contributor accepts a vendor agreement in order to study one.** | No decompiler or disassembler output in any diff. No PR whose work required installing or running the Zwift client in order to observe it. **Observing BLE traffic from hardware you own is a different act, is lawful, and is permitted** — that is how #40–#44 are built, from published FTMS, CPS, CSCS and HRS specifications | *Davidson & Associates v. Jung*, 422 F.3d 630 (8th Cir. 2005): a clean-room server reimplementation lost because the developers had clicked through a EULA banning reverse engineering, and the court held the **fair-use right waived by contract**. Zwift's ToS §5(h) carries such a clause and Strava's §19 does too — and Strava's binds anyone who has ever loaded the site, which is most cyclists. **The reliable answer is not to need the defence.** Reverse engineering is lawful in itself (*Kewanee Oil v. Bicron*, 416 U.S. 470 (1974)); DMCA §1201 is not engaged by plaintext GATT writes and §1201(f) permits circumvention for interoperability regardless; and EU law is stronger still — Software Directive 2009/24/EC Art. 6 grants a decompilation right for interoperability and **Art. 8 makes contrary contractual terms null and void**. None of that is needed, because nothing in this product's design requires reading their software |

### R1 — What a contributor may take from prior art, and what they may not

This is the line with teeth, because it is the one this repository already relies on. `CLAUDE.md` §6
enforces it today; ADR 0006 R3 applies it to Garmin's FIT SDK and R4 deferred the general statement
to this ADR. Here it is.

**Every mature FIT and BLE implementation except `incyclist/devices` (MIT) is GPL-2.0, GPL-3.0 or
AGPL-3.0** — GoldenCheetah, qdomyos-zwift, Auuki, and OpenTrainer under CC BY-NC-4.0, which is not
open source under the OSD at all. Under ADR 0001 and the path rule in `CLAUDE.md` §3, **none of
those licences may appear anywhere under `packages/`**. There is no exemption. So the distinction
below is not a nicety: getting it wrong relicenses a package.

**Reading them is fine.** Copying from them binds this project's licence.

| May be taken — **facts** | May **not** be taken — **expression** |
| --- | --- |
| A GATT service or characteristic **UUID** | A function, a class, a parser or a state machine, in any language |
| An **opcode**, a control-point response code, a flag-bit position | A **transliteration** into TypeScript that follows the original's structure, naming and branching. Retyping is copying |
| A **byte offset**, a field width, an endianness, a scale factor or offset | A **generated table** — a FIT profile, a message-definition map, a UUID registry — lifted as a table. The individual numbers are facts; **somebody's compilation of them is their work**, and a wholesale transcription takes the compilation |
| A **published constant** or an equation from a paper (Martin et al. 1998) | An implementation of that equation |
| The **fact that a device behaves a certain way**, once observed or documented | Their **test fixtures**, sample files, comments or documentation prose |

**The operating rule.** Re-derive from the specification, not from the implementation. Where a
fact's only accessible statement is inside GPL source, take the fact and its meaning and **write
nothing else down** — then record in the PR body where the number came from, exactly as ADR 0006 R4
already requires for `packages/fit`. If you find yourself with the other project's file open beside
your editor while you type, you are on the wrong side of this line.

### R2 — `zwift-offline` is a **do-not-read**, not a do-not-copy

**Author's recommendation, and new in this ADR.** `zoffline/zwift-offline` is a reimplementation of
Zwift's server protocol. It is **AGPL-3.0**, active, and widely known — 1,365 stars, last pushed
2026-06-02, all from repository metadata read on 2026-09-03. **Its source was not opened in the
course of writing this, and should not be opened in the course of building this project.**

The reason it gets a stricter rule than GoldenCheetah or Auuki is a principle, not a blacklist:

> **Read prior art that implements a *published standard* this project also implements. Do not read
> prior art whose entire content is somebody else's *private protocol*.**

GoldenCheetah, Auuki and qdomyos-zwift implement FIT, FTMS, CPS and HRS. Every fact in them has an
independent public source, so reading one checks a fact you could have got elsewhere and R1's
facts/expression line is workable. `zwift-offline` is the opposite: its content **is** Zwift's
protocol, so there is no independent public source and nothing you could take from it would be a
fact with a provenance you could write down. R1 would be unenforceable there.

**And the cost of the rule is zero**, which is why it is the right call rather than an anxious one.
Owner decision D6 means this project has no server in Phase 1; ADR 0008 D-5 means the virtual ride
is a fixed camera over the athlete's own imported route. **Nothing in this product's roadmap needs
to speak Zwift's protocol.** What `zwift-offline` is useful for is a single fact — *a fully offline,
single-player indoor cycling experience is technically achievable and people run one* — and **its
existence is citable for that without reading a line of it.** That is the whole benefit, and this
paragraph has now banked it permanently.

### R3 — The nominative fair-use template

There is one legitimate reason to write "Strava" in the product: to tell a rider truthfully that
their exported file will import. That is **nominative fair use** — using someone's mark to refer to
them, not to brand yourself. The three-part test is *New Kids on the Block v. News America
Publishing*, 971 F.2d 302 (9th Cir. 1992), extended to domain names by *Toyota v. Tabari*,
610 F.3d 1171 (9th Cir. 2010); the shape below — plain word mark plus an accurate disclaimer — is
the one that worked in *Keurig v. Sturm Foods*, 769 F. Supp. 2d 699 (D. Del. 2011).

**The template, and it is a template — deviating from it is a decision, not a wording preference:**

1. **The plain word mark only**, set in the body typeface, with no logo, no stylised wordmark, no
   ® or ™ lockup, and none of their brand colours.
2. **Only as much as is needed** to identify them. "Strava", once, in a sentence about files. Never
   as an adjective on one of our features ("the Strava importer", "Strava sync"), because that
   names *our* feature after *their* mark and steps outside nominative use.
3. **Nothing implying sponsorship, endorsement or an integration that does not exist.** "Sync with
   Strava" and "Connect to Strava" are both **false** here as well as risky — there is no
   connection to anything.
4. **Attach the non-affiliation sentence**, in the wording `README.md` already carries so that this
   project has one disclaimer rather than two that drift apart:

   > **On Your Left is not affiliated with, endorsed by, or derived from Strava or Zwift.**

   Where only one vendor is in view, the same sentence naming that vendor alone. The README's
   existing paragraph is the canonical long form and this ADR does not restate it differently or
   amend it.

**Approved strings, reusable verbatim** by #5 and #51:

> Imports activity files exported from Strava. On Your Left is not affiliated with, endorsed by, or
> derived from Strava or Zwift.

> Import a FIT, GPX or TCX file — including the bulk export from your Strava account.

**Not approved**: "Strava import", "Strava sync", "Strava-compatible", "Works with Zwift", any
button carrying their logo, and any app-store keyword field containing either name.

> **Note on wording**, so a reviewer does not read this as an oversight: #19's example sentence says
> *"not affiliated with, sponsored by, or endorsed by Strava, Inc."* This ADR uses the README's
> wording instead. "Sponsored by" adds nothing that "endorsed by" does not already carry, and one
> disclaimer used everywhere is worth more than a better-drafted second one. Changing `README.md`
> is out of scope for this ADR; if a reviewer wants "sponsored by" added, that is a one-line PR
> against the README and this template follows it.

### R4 — KOM and QOM are ordinary cycling vocabulary, with one caveat

**KOM and QOM may be used as ordinary cycling vocabulary** — for the climbing classification, in a
segment leaderboard, in a results table. No Strava-owned registration for either was found on the
US register. "King of the Mountains" is the Tour de France climbing classification and dates to
**1933**, which is a strong genericness position for the underlying term.

#19 recorded two in-sector marks with their live/dead status unchecked and said "check TSDR first".
**Checked, on 2026-09-03, and both are dead:**

| Mark | Serial | Owner | Status |
| --- | --- | --- | --- |
| KOM CHALLENGE | 85486389 | BikeRx, LLC | **Dead** — abandoned for failure to respond to an Office action, 2012-10-13 |
| KOM AIR | 79130032 (Reg. 4553801) | SINTEMA SPORT SRL | **Dead** — US registration cancelled when the International Registration was cancelled, 2022-12-12 |

**The caveat survives the finding, and this is the part to keep.** A dead federal registration does
not extinguish common-law rights, the register moves, and neither of those searches was
comprehensive. So:

- ✅ **Use KOM/QOM as vocabulary** — "KOM" on a leaderboard row, "QOM" in a results heading.
- ❌ **Do not brand a product, an app-store listing or a named feature `KOM <something>`** without a
  fresh TSDR check on the specific string, on the day.
- **"It sounds like a common word" is not a defence.** Mad Dogg Athletics enforced **SPIN®** and
  **SPINNING®** in cycling for decades against exactly that argument. Generic-sounding fitness
  marks do get enforced.
- **QOM was not searched at all.** Recorded as unverified below.

### R5 — File-based interoperability is the entire interoperability surface

**User-initiated FIT/GPX/TCX import and export stays in scope, unchanged, and is the only channel.**
A rider downloads their own bulk export from their own account and opens the file here. That is a
file operation between a person and their own data. It makes no API call, needs no token, and
accepts no terms.

The legal wind is behind it rather than against it: **GDPR Art. 20** exists for exactly this, and
the **EU Data Act, Regulation (EU) 2023/2854**, applicable since **2025-09-12**, goes further —
Chapter II (Arts. 3–7) gives the *user* of a connected product a right to that product's data and a
right to have it shared with a third party of their choosing, covering personal and non-personal
data alike, with design-by-default access obligations biting for products placed on the market
after **2026-09-12**.

**The check**: every byte this product parses arrived from a file the user chose in a file picker.
`packages/fit` and `apps/web` contain no HTTP client and issue no network request. They do contain
third-party host names, and a grep for one gets hits — the GPX and TCX fixtures and their generator
carry `topografix.com`, `garmin.com` and `w3.org` XML **namespace URIs**. Those are format
identifiers, not addresses: a conforming parser never dereferences one, and under `CLAUDE.md` §6 a
parser that does is precisely the XXE defect the corpus's `xxe-external-entity` fixtures exist to
catch. **The check is "no fetch", not "no host name in a string".** Implementation is
[#5](https://github.com/openzigs/onyourleft/issues/5) and
[#51](https://github.com/openzigs/onyourleft/issues/51); the codec is #30–#32 under ADR 0006; the
fixture corpus (#107) is already synthetic, which is L3 discharged in advance.

### What a machine checks today: **nothing**

Every rule above is enforced by review. That is worth saying plainly, because this repository's
habit is to close the gap between a documented boundary and an enforced one, and this ADR does not
close it.

**One of them is cheaply machine-checkable and #24 already owns it.** #24's revision block proposes
"no Strava or Zwift mark used as a product, package or asset name (#19)" as a grep gate alongside
the existing `SCOPE001` scope check. That is **L1's first limb** and this ADR does not implement it,
because `CLAUDE.md` §4b is explicit that #24 owns that work. The rule text #24 needs:

> Fail if `strava` or `zwift` (case-insensitive) appears in a manifest `name`, a path under
> `apps/` or `packages/`, or a non-prose source string. Prose in `docs/`, `README.md`, `CLAUDE.md`
> and `CONTRIBUTING.md` is exempt — naming them truthfully is the point of this ADR.

**L2, L3, L4, L5, R1 and R2 are not machine-checkable and should not be faked into looking like they
are.** L2 and R1 turn on where a contributor's eyes were, which no script can see. The control that
does work is ADR 0006 R4's: a **declaration in the PR body** naming what was consulted and where
each number came from. This ADR extends that declaration from `packages/fit` to any PR touching
`packages/sensors` protocol code, and it is a convention, not a gate.

---

## Consequences

### What this enables

- **The product.** Segments, leaderboards, the feed, kudos, clubs and the virtual ride are all
  buildable — #11, #12, #13 and #16 proceed with no legal caveat in their framing.
- **#51 ships an import UI without an apology.** Its retracted acceptance criterion — "the UI
  contains no control that would call the Strava API" — is gone. There is no such control because
  this project does not use that API. That is a **design choice**, not a prohibition, and the
  distinction is the whole content of D1.
- **#31's encoder has its real reason back.** The FIT encoder matters because a file the rider
  exports and loads themselves is an interoperability path that needs no token and no permission.
- **ADR 0008 D-5 is on firm ground.** "There is no world to design" reads like a shortcut until L2
  makes it the only defensible answer: a route the athlete imported is the one world source that
  cannot be somebody else's asset.
- **A contributor gets a usable answer to "may I read GoldenCheetah?"** — yes, and here is exactly
  what you may carry away from it.

### What this costs, stated plainly

- **There will never be a one-click Strava sync.** That is a genuine product cost and the most
  common thing a user will ask for. The answer is the bulk export, and it is worse. Accepted
  knowingly: taking the API means accepting the competing-applications clause, which is a condition
  on the token and would be a live constraint on this product's entire feature set.
- **R2 costs whatever a reader would have learned from `zwift-offline`.** Assessed as close to
  nothing, because no roadmap item speaks Zwift's protocol. If that changes, R2 is what has to be
  revisited first — by a successor ADR, not by a reviewer's judgement call in a PR.
- **R1 makes some work slower.** Re-deriving a profile table from a specification takes longer than
  copying one. ADR 0006 already accepted that cost for `packages/fit`; this generalises it.
- **L1's trade-dress limb costs a design shortcut.** The familiar layout is familiar because
  everyone copied it; #49 has to make its own choices.

### Constraints this places on other work

| Issue | What it must do |
| --- | --- |
| #5, #51 | File picker only. R3's approved strings verbatim, or a new string that satisfies R3's four points |
| #11, #12, #13, #16 | Build the concepts freely. Cite **ADR 0007**, not this ADR, for anything about matching or leaderboard mechanics — patents are the live constraint, not terms of service |
| #29–#32 | ADR 0006 governs; **R1 is its general form** and the PR-body declaration extends here unchanged |
| #40–#44 | Published BLE specifications. Prior art is readable under R1; `zwift-offline` is not, under R2 |
| #49 | Our own design system. L1's trade-dress limb |
| #91 | No asset from another product. Terrain from the imported route (ADR 0008 D-5) |
| #24 | Owns the L1 grep gate. Rule text above |
| #60 / ADR 0010 | **OpenStreetMap's ODbL and the derivative-database question are not this ADR's** — they are ADR 0001's open constraint and #64's. This ADR says only that OSM geometry is the alternative to anybody else's map data |

### Relationship to ADR 0007 — patents

**ADR 0007 owns patents and this ADR must not be read as covering them.** The two are complementary
and the division is clean:

- This ADR is about **contract, copyright and trademark**, and its conclusion is **favourable**:
  nothing here prevents any feature.
- ADR 0007 is about **patents**, and its conclusion is a set of real design constraints on segment
  matching and the pacer — the only legal constraints in this project that can actually stop a
  feature.

If those two ever appear to conflict on the same feature, **ADR 0007 wins on anything patent-shaped**
and a successor ADR reconciles them. Nothing here loosens **ADR 0007's D2** and its five
prohibitions on the segment matcher — written out in full because a bare "D2" in this repository is
more often owner decision D2, the ANT+ exclusion in `CLAUDE.md` §6.

---

## The three questions for a lawyer

Short, specific, answerable from public documents plus a paragraph of description. Not a
freedom-to-operate study — ADR 0007 already explains why this project does not buy one of those.

**Question 1 — does L5 need a contributor attestation?** Strava's ToS is accepted "by accessing" and
its §19 forbids reverse engineering. Most contributors to a cycling project have loaded
`strava.com`. *Davidson v. Jung* held the fair-use right waivable by contract. **Is "this project
does not reverse engineer their products at all" sufficient, or does the BLE work in #40–#44 need a
written contributor statement that it derives from published specifications only?** This is the
cheapest question of the three and the answer is a one-line change to R1's declaration or nothing at
all. Ask before #40 merges.

**Question 2 — is R3's template sufficient outside the US?** *New Kids* and *Tabari* are Ninth
Circuit; *Keurig* is D. Del. The EU test is different — Art. 14(1)(c) EUTMR's "honest practices in
industrial or commercial matters", plus the Comparative Advertising Directive where a comparison is
implied — and this project ships to a browser, which means everywhere. **Do the two approved strings
survive an EU/UK reading, and does an app-store listing change the answer?** Ask before #51 ships a
user-facing string.

**Question 3 — the athlete's own bulk export and the EU database right.** GDPR Art. 20 and the Data
Act say the data is the rider's. Directive 96/9/EC protects the *compilation* independently, and a
bulk export is a compilation of that rider's activities produced by Strava. **Is a user importing
their own export extracting a substantial part of a protected database, and does the answer change
if this project ships a parser tuned to that export's layout?** Nothing in the design turns on it —
the file is the athlete's own — but #5's bulk-import UI is where a surprising answer would bite.

**Three things a lawyer is deliberately not being asked**, because nothing depends on them:
whether the API Agreement and its incorporated API Policy bind this project (they do not; there
is no contract, and that is D1);
whether product concepts are copyrightable at the margin (§102(b) is adequate and this project
copies nothing regardless); and whether to register a mark of this project's own (a business
decision, not this ADR's).

---

## Notes

### Numbering

This ADR takes **0009**. #19's own acceptance criterion still names `0002`; that number belongs to
#57, which merged, and **the settled ownership table in [`docs/architecture.md`](../architecture.md)
wins** — resolved by [#112](https://github.com/openzigs/onyourleft/pull/112), closing
[#97](https://github.com/openzigs/onyourleft/issues/97), in favour of the claimant that merged ADRs
already cite by number. A citation in a merged document is a fact; an acceptance criterion in an
open issue is a proposal. The owner recorded the change in a comment on #19 on 2026-09-03. Rule
`ADR001` in `scripts/check-repo-rules.sh` fails the build on a duplicate number and `ADR002` on a
malformed filename, so neither can go wrong silently. ADR 0007 and ADR 0008 already forward-cite
this document as "ADR 0009".

### On not overstating this

**The premise is favourable and this document is written that way.** The headline is not "here is a
minefield" — it is *we may build the product, and the concepts are ours to reimplement*. Five lines
and five rules is the entire constraint set, four of the five lines describe things this project was
never going to do anyway, and the one with a real cost (L5, and the absence of any Strava
integration behind it) buys freedom from the competing-applications clause.

A posture reading "everything is risky" would be as useless as one that ignored risk, and it is how
the first planning pass reached a conclusion that would have cancelled the project. **The lines that
exist are narrow and checkable. That is the point of drawing them.**

### What this ADR could not confirm

Named here rather than smoothed over, per #2's standing criterion that every ADR say what it could
not confirm and who would settle it.

| Unverified | Who settles it |
| --- | --- |
| Whether Strava publishes further developer terms at some other path. **Three** documents were read — `/legal/terms`, `/legal/api` and `/legal/api_policy` — and the API Policy names a developer site that may carry more | Nobody, today. Nothing depends on it; there is no API use. Whoever first proposes to use the API reads the set afresh |
| Whether any of the three Strava documents contains a clause not quoted in the sources table. Each fetch was tool-converted and queried, **not a page-by-page human read** | Whoever first wants to rely on a clause that is not quoted above. Read it yourself first |
| Zwift's *current* general Terms of Service. `zwift.com/terms` redirects to a support category that did not render and `zwift.com/eula` 404s; the quoted document is the **Clubs** ToS, last updated **2019-05-28** | Whoever first needs a live Zwift term. L5's conclusion does not depend on which document it is, because this project reverse engineers neither product |
| **QOM** was not searched on any trademark register at all | Whoever first proposes to brand a feature "QOM <something>". R4's ❌ covers it in the meantime |
| Whether common-law rights subsist in "KOM CHALLENGE" or "KOM AIR" despite both registrations being dead | Same. A dead registration is not a clearance |
| The case citations, other than the reporter cite added for *Davidson* (422 F.3d 630), were carried from #19's body and **not re-pulled from a primary court database** on 2026-09-03. The *hiQ* consent-judgment figure ($500,000) is #19's | Question 1 and Question 2's answers will touch most of them |

### What would make this ADR wrong

- **A court holding that a competitor's UI arrangement is protected trade dress** in a way that
  reaches a feature-equivalent product. This is the closest thing to a real gap between "concepts
  are free" and "expression is protected", which is why L1 grew a trade-dress limb rather than
  stopping at the word mark. It would constrain #49, not the product.
- **This project deciding to use the Strava API after all.** Then the API Agreement binds — the
  competing-applications clause included — and D1's premise no longer applies to whatever is built
  on it. That is a reversal of an owner decision and needs a superseding ADR, not a PR.
- **`zwift-offline` becoming load-bearing.** If a roadmap item ever genuinely needs Zwift protocol
  compatibility, R2's zero cost stops being zero and the rule has to be re-argued on its merits.
- **Strava changing its terms.** Note that this one does *not* make the ADR wrong, and that is the
  point of the first section: a party with no contract is unaffected by amendments to it. The only
  Strava document whose changes matter here is the **Terms of Service**, because acceptance by
  access means it reaches anyone who visits the site — and L4 already keeps this project clear of
  the only clause in it that could ever apply.
