# ADR 0056: The demo's shipped map — each preset route's OpenStreetMap-derived data baked into the demo build and published under ODbL 1.0

- **Status**: Proposed, 2026-10-24. It takes effect when the owner accepts it; until then the bake
  script ([#1651](https://github.com/openzigs/onyourleft/issues/1651)) stays blocked on it
- **Date**: 2026-10-24
- **Deciders**: **the owner**, on the rulings of 2026-10-24 on the epic
  [#1643](https://github.com/openzigs/onyourleft/issues/1643), quoted in Context. The owner ruled on
  **that a map is shipped, under ODbL 1.0, with the credit in the demo and in any exported video**
  (D-3, D-8), **where the data file is offered** (D-4, #1644 items 2 and 3), and **where the route's
  line and elevation come from** (D-7, #1644 item 6). The owner did **not** rule on which of the two
  shapes is shipped (#1644 item 1), on the GPX's licence, on a committed digest or on the video's
  closing card: D-10 puts those as questions with a recommendation, and nothing in this ADR should be
  read as a ruling on them. Drafted by the author for the owner's approval
- **Issue**: [#1644](https://github.com/openzigs/onyourleft/issues/1644), phase 1 of the epic
  [#1643](https://github.com/openzigs/onyourleft/issues/1643)
- **Number**: **0056**. [`docs/agents/conventions.md`](../agents/conventions.md) §7 said *"the next
  free number is 0055"* on 2026-10-24, but **0055 is claimed by the open issue
  [#1631](https://github.com/openzigs/onyourleft/issues/1631)** (its title names it), so this takes
  the next one. No open issue or pull request named 0056
- **Supersedes**: [ADR 0054](0054-towns-from-real-map-data.md) **D-1 item 2 and D-3.5, in part, for
  the demo build only**. D-1 below says which sentences stop holding and which still do. The
  rider's on-device store (`worldCorridors`) keeps D-3.5 **unchanged**. It is also the *"superseding
  ADR that publishes … under ODbL 1.0 and decides §4.6 a or b"* that [`docs/odbl.md`](../odbl.md)
  and [ADR 0012](0012-data-licence.md) D-4 ask for, for one database: the demo bundle
- **Relates to**: [ADR 0012](0012-data-licence.md) D-2, D-4, D-5 and D-6,
  [ADR 0004](0004-privacy-and-location.md) D, [ADR 0007](0007-patent-posture.md) D4,
  [ADR 0026](0026-realistic-game-world.md) D-12, [ADR 0032](0032-external-data-for-the-game-world.md)
  D-1 and D-3 (both untouched, D-7), [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 and
  D-7

---

## Context

### The rulings this records

The owner, 2026-10-24, on #1643, replacing that day's earlier "live tiles" ruling:

> CHANGE OF RULING, from the owner, 2026-10-24: the demo's map data comes from a SHIPPED map, not
> live tiles. This replaces the "live tiles" ruling.
>
> - Each preset route's map data (the corridor features or tiles, plus elevation) is baked into the
>   demo build. It loads with no request to our archive or any server, works offline, and looks the
>   same every time.
> - It adds bytes to the demo build only, never to the rider app or its precache.

And later the same day, on #1643:

> - **Shipped map data, with a new ADR (#1644).** The demo ships each preset route's baked map data
>   under ODbL 1.0. The OSM credit is shown in the demo and in any exported video, and the data file
>   is offered next to the demo and as a GitHub release asset. ADR 0054 D-1 item 2 and D-3.5 are
>   superseded for the demo build only, by the new ADR.
> - **Routes and elevation come from a GPX file the owner supplies.** Each preset route is a GPX
>   track the owner uploads to the repo. Its points give the route's line and its `<ele>` values give
>   the hills. The bake script reads the GPX and bakes the map data around it from our archive. No
>   elevation source is added, so ADR 0032 is untouched. The ADR (#1644) and the bake issue (#1651)
>   must state the following:
>   - The GPX is stripped of timestamps and of any sensor or extension data. Only lat, lon and ele
>     are kept, so nothing personal is shipped.
>   - Its start and end are trimmed, or it starts and ends at a public place, so that no home
>     location is published (SECURITY.md, location data). The bake script checks that no timestamps
>     remain; the trim is the owner's choice at upload.
>   - The owner confirms each GPX is theirs to publish, or is under a licence compatible with the
>     shipped bundle. The ADR names the licence the GPX is published under.
>   - This does not conflict with ADR 0007 D4 ("authored, never recorded"), which governs the bots'
>     power scripts. The route's line is separate from the riders' effort.

So the 3DEP and synthetic-profile options #1644 item 6 listed are **not taken**, and this ADR adds
no elevation source.

### Why this needs an ADR and not an amendment

- **ADR 0054 D-1 item 2**: *"No dataset derived from an external source is committed. **Still
  true.** Nothing is committed: the records arrive per route, on the rider's device"*.
- **ADR 0054 D-3.5**: *"Nothing in it leaves the device … **A change that sends any of this store's
  contents anywhere is a change to this ADR**, not a review note."*
- **`docs/odbl.md`**: share-alike is kept off *"on one condition alone"*, that nothing is published,
  and lifting it is *"a **superseding ADR** that publishes the store under ODbL 1.0 and decides §4.6
  a or b"*.
- **ADR 0012 D-4**: *"If D-3 is ever exercised, §4.6 comes back onto the table and its successor ADR
  decides between 4.6 a and 4.6 b then, with the shape of the data in front of it."*

An ADR's body is never edited, and reversing a decision needs a superseding ADR (ADR 0013). A
demo build that anyone can download is the first OpenStreetMap-derived database this project
Publicly Uses, so the project's position that §4.4 and §4.6 are not engaged stops being true for
it. That is a decision, not a correction of fact.

### The ODbL clauses this rests on, verbatim

Read **first-hand on 2026-10-24** from **<https://opendatacommons.org/licenses/odbl/1-0/>** (HTTP
200; the canonical page, not the mirror ADR 0012 D-6 had to use). Quoted exactly, line breaks
aside.

| Clause | ODbL 1.0, verbatim |
|---|---|
| §1.0 **"Derivative Database"** | "Means a database based upon the Database, and includes any translation, adaptation, arrangement, modification, or any other alteration of the Database or of a Substantial part of the Contents. This includes, but is not limited to, Extracting or Re-utilising the whole or a Substantial part of the Contents in a new Database." |
| §1.0 **"Produced Work"** | "a work (such as an image, audiovisual material, text, or sounds) resulting from using the whole or a Substantial part of the Contents (via a search or other query) from this Database, a Derivative Database, or this Database as part of a Collective Database." |
| §1.0 **"Publicly"** | "means to Persons other than You or under Your control by either more than 50% ownership or by the power to direct their activities (such as contracting with an independent consultant)." |
| §1.0 **"Convey"** | "As a verb, means Using the Database, a Derivative Database, or the Database as part of a Collective Database in any way that enables a Person to make or receive copies of the Database or a Derivative Database. Conveying does not include interaction with a user through a computer network, or creating and Using a Produced Work, where no transfer of a copy of the Database or a Derivative Database occurs." |
| §4.2 **Notices** | "If You Publicly Convey this Database, any Derivative Database, or the Database as part of a Collective Database, then You must: a. Do so only under the terms of this License or another license permitted under Section 4.4; b. Include a copy of this License (or, as applicable, a license permitted under Section 4.4) or its Uniform Resource Identifier (URI) with the Database or Derivative Database, including both in the Database or Derivative Database and in any relevant documentation; and c. Keep intact any copyright or Database Right notices and notices that refer to this License. d. If it is not possible to put the required notices in a particular file due to its structure, then You must include the notices in a location (such as a relevant directory) where users would be likely to look for it." |
| §4.3 **Notice for using output** | "Creating and Using a Produced Work does not require the notice in Section 4.2. However, if you Publicly Use a Produced Work, You must include a notice associated with the Produced Work reasonably calculated to make any Person that uses, views, accesses, interacts with, or is otherwise exposed to the Produced Work aware that Content was obtained from the Database, Derivative Database, or the Database as part of a Collective Database, and that it is available under this License." |
| §4.3 a **Example notice** | "The following text will satisfy notice under Section 4.3: Contains information from DATABASE NAME, which is made available here under the Open Database License (ODbL). DATABASE NAME should be replaced with the name of the Database and a hyperlink to the URI of the Database. "Open Database License" should contain a hyperlink to the URI of the text of this License. If hyperlinks are not possible, You should include the plain text of the required URI's with the above notice." |
| §4.4 a **Share alike** | "Any Derivative Database that You Publicly Use must be only under the terms of: i. This License; ii. A later version of this License similar in spirit to this License; or iii. A compatible license." |
| §4.4 c | "Derivative Databases and Produced Works. A Derivative Database is Publicly Used and so must comply with Section 4.4. if a Produced Work created from the Derivative Database is Publicly Used." |
| §4.4 d | "Share Alike and additional Contents. For the avoidance of doubt, You must not add Contents to Derivative Databases under Section 4.4 a that are incompatible with the rights granted under this License." |
| §4.6 **Access to Derivative Databases** | "If You Publicly Use a Derivative Database or a Produced Work from a Derivative Database, You must also offer to recipients of the Derivative Database or Produced Work a copy in a machine readable form of: a. The entire Derivative Database; or b. A file containing all of the alterations made to the Database or the method of making the alterations to the Database (such as an algorithm), including any additional Contents, that make up all the differences between the Database and the Derivative Database. The Derivative Database (under a.) or alteration file (under b.) must be available at no more than a reasonable production cost for physical distributions and free of charge if distributed over the internet." |

Two things follow from the text that #1644's body did not list, and this ADR acts on both:

1. **§4.2, not only §4.3, applies.** A demo build that carries the bundle as a file *"enables a
   Person to make or receive copies"* of it, so shipping it is **Publicly Conveying** a Derivative
   Database. §4.2 b wants the licence or its URI **inside the database and in the relevant
   documentation** (D-3.2).
2. **§4.4 c and §4.6 reach the video.** An exported video is a Produced Work from the bundle;
   publishing it Publicly Uses the bundle (§4.4 c) and obliges an offer of the database *"to
   recipients of the … Produced Work"* (§4.6), not only to people who download the demo (D-4.3).

---

## Decision

### D-1 — What of ADR 0054 this supersedes, and what still holds

| ADR 0054 | After this ADR |
|---|---|
| **D-1 item 2**: *"No dataset derived from an external source is committed"* | **Still true, and binding on the demo too.** The bundle is generated into the demo's gitignored output, never committed (D-5). The GPX that is committed is the owner's own track, not a dataset derived from an external source (D-7.4) |
| **D-1 item 2's reason**: *"the records arrive per route, on the rider's device"* | **Superseded for the demo build.** For each preset route the records also arrive in a file inside the demo build, made by the bake script (#1651) |
| **D-3.5**, for the rider's store `worldCorridors` | **Unchanged.** Nothing in that store leaves the device. The bake script never reads it; the two tests `docs/odbl.md` names still hold that line |
| **D-3.5**'s consequence that *"nothing in it is Publicly Used and §4.4 is not engaged"*, as the project's whole ODbL position | **Superseded for the demo bundle.** The bundle is Publicly Used; §4.4 and §4.6 are engaged for it, and D-3 and D-4 discharge them |
| D-2: one archive, four layers, no names, addresses or OSM ids | **Holds for the bundle** (D-2.1): the bake reads what the rider's read reads, and keeps no more |
| D-3.6: *"© OpenStreetMap contributors"* in the frame | **Holds, and extends** to the demo frame and every exported video frame (D-8) |
| D-4 to D-8 | **Unchanged.** The rider app's world, its read, its privacy rules and its credit are not touched |

ADR 0012's decisions for segments are unchanged. Its D-2 reason 2 (nothing is published) and D-4
(*"§4.6 is not the plan"*) stop describing the whole project: for this one database, §4.6 is the
plan (D-4).

### D-2 — What is shipped

1. **Per preset route, one file: the decoded corridor records, the shape the renderer already reads
   (option a), with no OSM id, no name and no address.** That is the decoder's own features as
   ADR 0054 D-3.3 lists them after its amendment of 2026-10-22 (building footprints with `kind`,
   `height` and `min_height`; land-use and water polygons with `kind`; footway lines with `kind` and
   `kind_detail`; street lines with `kind`, `kind_detail` and bridge or tunnel), for the corridor
   around the route's line, plus the route's own line and elevation from the GPX (D-7) and the
   metadata of D-3.2. **No owner, no route id, no device time and no tile coordinate list is in it**:
   it is not a `WorldCorridorRecord`, which carries those for the rider's store, and the demo needs
   none of them.
2. **Not a `pmtiles extract` (option b).** Recommended against, for D-10 Q1: it is a second
   rendering path the demo would have to decode, it is larger, and a vector tile carries the names
   and the `pois` and `places` layers that ADR 0054 D-2.2 refuses to read, so shipping it would
   publish what the project chose never to hold.
3. **Machine-readable and plain.** A file a reader can open without this program (for example JSON
   or a documented binary with its decoder published beside it); the format is #1651's, stated in
   that pull request.
4. **In the demo build only** (the owner's ruling): never in `apps/web/dist`, the APK, the service
   worker's precache or `apps/web/public/`. `tools/demo/demo-output.ts` and
   `tools/demo/demo-stays-out.ts` already hold the demo out of the product; #1651 extends them to
   the bundle.

### D-3 — Its licence: ODbL 1.0, and the notices

1. **The bundle is a Derivative Database of OpenStreetMap, and it is Publicly Used**, so it is
   offered **under ODbL 1.0** (§4.4 a.i). Not a later version and not a "compatible licence": the
   rider's store says `'ODbL-1.0'` and so does this.
2. **§4.2 b: the licence travels inside the file and beside it.** The file itself carries the
   licence identifier `ODbL-1.0`, the licence URI `https://opendatacommons.org/licenses/odbl/1-0/`,
   the source (*OpenStreetMap contributors*, `https://www.openstreetmap.org/copyright`, through the
   project's Protomaps archive by its URL and identity), and the §4.3 notice below. The demo's output
   directory also carries a notice file beside the bundle (§4.2 d's *"relevant directory"*), and the
   demo's licences page (`public/licences/`, already copied by `tools/demo/demo-output.ts`) names it.
3. **The §4.3 notice text**, ODbL's own example with the database named:

   > Contains information from OpenStreetMap, which is made available here under the Open Database
   > License (ODbL).

   with *"OpenStreetMap"* linked to `https://www.openstreetmap.org/copyright` and *"Open Database
   License"* linked to `https://opendatacommons.org/licenses/odbl/1-0/`, or both URIs in plain text
   where a link is not possible (§4.3 a). It is the sentence `docs/odbl.md` already records for the
   credits screen.
4. **§4.4 d: nothing incompatible is added.** The only Contents the bundle adds to OpenStreetMap's
   are the GPX's points and elevations, which is why D-7.3 requires the GPX's own licence to be one
   ODbL can carry.
5. **The ODbL governs the data, not the program.** The demo's code stays `AGPL-3.0-or-later` by path
   (`CLAUDE.md` §3), as `docs/odbl.md` already says of the rider app. This ADR does not lean on §4.5
   (Collective Databases) for that: the code is not a database.

### D-4 — §4.6: the entire Derivative Database (a), offered beside the demo and as a release asset

1. **§4.6 a, the entire database.** It is the bundle itself, already a plain file, so offering it
   costs nothing. §4.6 b (an alteration file or the method) would mean publishing the archive's
   version, the bake script and the GPX and asking the reader to rebuild it: the script is public
   anyway, but a method is a weaker offer than the file and is no cheaper here.
2. **Where it is offered** (the owner's ruling): **next to the demo**, as the file the demo itself
   loads, at a stable path in the demo output, and **as an asset on a GitHub release** of the demo,
   which is free on a public repository (ADR 0036 D-7: no paid service). The release is #1651's or
   #1654's to wire, whichever builds the release; neither may use a larger runner (`CLAUDE.md` §8).
3. **Reaching a video's recipients.** A video is often seen far from the demo. Whoever publishes one
   offers the database by naming the release asset's URL beside it: in the video's closing card
   (D-8.3) and, where the platform allows text, in the post. That is the offer *"to recipients of the
   … Produced Work"* §4.6 asks for.
4. **The output carries its own compliance.** ADR 0012 D-4 declined §4.6 because it is a duty a
   stranger running the code inherits without knowing it. Here the stranger is a website that embeds
   the demo (#1654): it Publicly Conveys the bundle by serving it. So the demo output is built to
   comply **as served, unchanged**: the bundle, its notice file and the licences page are in it, and
   the demo shows the notice. #1654's embedding guide says so in one sentence, and says that
   serving the output without the bundle's notice file is not allowed.

### D-5 — Never committed; a digest may be

1. **The bundle is generated, never committed.** The bake script (#1651) writes it into the demo's
   output directory, `apps/web/demo/dist`, which `.gitignore`'s `dist/` already ignores and
   `scripts/check-repo-rules.sh` already prunes like every `dist/`. This keeps ADR 0054 D-1 item 2
   true (D-1) and keeps OpenStreetMap data out of the repository's permanent history, where an error
   could never be withdrawn.
2. **A committed SHA-256 per route is allowed** (recommended, D-10 Q3), with the archive's URL and
   identity and the GPX's own digest beside it, so the bake is checked as reproducible and a changed
   archive is noticed. A digest is not data: no Contents can be recovered from it.

### D-6 — The licence boundary

The bundle is **data, not source**. It carries **no SPDX header**, it is not scanned by `LIC001`,
and it **never sits under `packages/`**, whose `Apache-2.0` path rule is about code and whose
consumers must be able to drop a package into a project with no ODbL obligation. The bake script and
the demo's loader are source like any other: `AGPL-3.0-or-later`, under `apps/web/`. The bake
script is a build-time tool and is not in the demo's or the rider app's module graph; its reads of
the archive are made by whoever runs it (a developer, or CI on `ubuntu-latest`), never by a rider,
so `apps/web/src/privacy/no-network.test.ts` and `apps/web/src/privacy/boundaries.ts` are not
touched by it.

### D-7 — The route's line and elevation: a GPX the owner supplies

The owner's ruling, with what each part requires of #1651:

1. **The route's line is the GPX's points, and its hills are the GPX's `<ele>`.** The bake reads the
   archive around that line. The mapped street lines in the bundle are context drawn beside it; the
   route is not snapped to them, since there is no routing engine
   (`docs/agents/route-planning.md`).
2. **Only latitude, longitude and elevation are kept.** The bake drops every `<time>`, every
   `<extensions>` element (heart rate, cadence, power, temperature, any device's own), the
   `<metadata>` block (author, name, link, time), every `<name>`, `<desc>`, `<cmt>`, `<src>` and
   `<link>`, and the `creator` attribute, and keeps nothing it does not name. **The bake fails if a
   timestamp survives in its output**, which is checked on the output, not assumed from the code
   that strips it. Its error names the field and never a coordinate (ADR 0004 D).
3. **No home is published.** The start and end are trimmed, or the track starts and ends at a public
   place. The trim is the owner's choice at upload (the ruling); the bake does not invent one.
4. **The GPX is the owner's own recorded track, or a line drawn by hand**, never a route exported
   from a planner that snapped it to OpenStreetMap or another map's roads. A snapped line would be
   data derived from an external source, committed, which ADR 0054 D-1 item 2 forbids, and a
   planner's own terms may forbid publishing it. A recorded trace is the rider's own (ADR 0012 D-1's
   reasoning) and carries no OSM Contents.
5. **Its licence: `CC0-1.0`, proposed** (D-10 Q2; the owner asked the ADR to name one and did not
   rule which). CC0 places no condition on the bundle, so §4.4 d is met, and it is a licence
   `ASSETS.toml` and the asset rules already permit under `apps/`. The owner's confirmation that each
   GPX is theirs to publish (the ruling) is recorded with the file, with its source and the date, in
   the record #1651 commits it under (`ASSETS.toml` if the asset rules treat it as a binary). A GPX
   that is not the owner's is admitted only under `CC0-1.0` or `ODbL-1.0`, and an `ODbL-1.0` one
   needs that licence admitted at its path first (ADR 0015 D-2, `ASSET004`).
6. **No elevation source is added, so ADR 0032 is untouched.** Its D-1 rejection of SRTM, NASADEM
   and 3DEP as world sources stands, and its D-3 (*"the route's elevation is not the world's"*)
   holds: the GPX gives the road's height, and the hillside beside it is still synthesised from it.
7. **ADR 0007 D4 is not engaged** (the ruling): it governs the bots' power and cadence scripts,
   which stay authored. The route's line says where the road is, not how anyone rode it.

### D-8 — Attribution in the demo and in every exported video

1. **In the demo frame, whenever bundle data is drawn**, the demo shows **"© OpenStreetMap
   contributors"**: `apps/web/src/map/basemap.ts` §`OSM_ATTRIBUTION`, the constant every surface
   uses, never a copy. It is keyed on the bundle being drawn, as ADR 0054 D-3.6 keys the ride's
   credit on the corridor: a stretch of the demo on the synthetic road shows none, because it owes
   none. The credit links to, or sits beside a link to, the §4.3 notice (D-3.3).
2. **In every exported video frame drawn from the bundle**, the same line is burned into the frame
   (#1655), as ADR 0054 D-3.6 does for a ride. It is in the pixels, not in a container's metadata,
   which a re-encode drops.
3. **A closing card, proposed** (D-10 Q4): a video that drew bundle data ends with the §4.3 notice
   and the plain-text URIs §4.3 a asks for where hyperlinks are not possible (OpenStreetMap's
   copyright page, the ODbL 1.0 text, and the release asset of D-4.2). The corner line alone names the
   source but does not say the data is *"available under this License"*, which §4.3 asks for.

### D-9 — The fixture rule stands

CI's browser gate (#1648) runs the demo on a bundle baked from the **synthetic corridor fixture**
(`apps/web/browser/corridor-fixture.ts`), never on OpenStreetMap data. That keeps
`packages/map-features/src/fixtures/tiles.ts`'s and `docs/agents/browser-gate.md`'s rule, *"no
OpenStreetMap data"* in a test artefact, true, so no build artefact of CI's carries an ODbL
obligation. A real-route bundle is baked by the owner or by the release job, not by a pull request's
checks.

### D-10 — What the owner is asked to rule on

1. **Q0 — Accept this ADR before it merges, or merge it as Proposed?** Recommended: **accept before
   merge**, and the pull request flips the Status line, because an amendment cannot change a Status
   line afterwards (ADR 0013). #1651 stays blocked until it is accepted either way.
2. **Q1 — What is shipped: (a) the decoded corridor records, or (b) a `pmtiles extract`?**
   Recommended: **(a)** (D-2.1, D-2.2): it is what the renderer reads, it is smaller, and it carries
   no names.
3. **Q2 — The GPX's licence.** Recommended: **`CC0-1.0`** for a track of the owner's own (D-7.5).
4. **Q3 — May a SHA-256 per route be committed?** Recommended: **yes** (D-5.2).
5. **Q4 — A closing card in each exported video** with the §4.3 notice and the URIs. Recommended:
   **yes** (D-8.3).

### D-11 — This is not a legal opinion

ADR 0012 D-6's rule, for the same reason: no lawyer was consulted. This ADR is the licence text read
first-hand (Context) and a design chosen so that the obligations it engages are met by the build's
own shape rather than by somebody remembering to.

---

## Consequences

### What this enables

- **#1651 can be built**: a bake script with a document to be checked against, and #1652 after it.
- **A demo that looks the same every time and makes no request**, on a real road with real
  buildings, in the US where the archive reaches.

### What this costs

- **The project's first Publicly Used ODbL database.** §4.2, §4.3, §4.4 and §4.6 now bind every
  demo release and every video made from one, for as long as either is published.
- **A compliance duty for whoever embeds the demo**, met by serving the output unchanged (D-4.4) and
  broken by serving the page without the bundle's notice file.
- **A notice in every video frame drawn from a real route**, and, if Q4 is accepted, a closing card.
- **A privacy step that rests on the owner at upload**: the bake checks for timestamps but cannot
  know where the owner lives, so the trim (D-7.3) is a person's job.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#1651](https://github.com/openzigs/onyourleft/issues/1651) | D-2 (option a unless the owner rules b), D-3.2's in-file metadata and notice file, D-5 (output only; a digest if Q3 is accepted), D-6, D-7.1–D-7.5 including the timestamp check on the output and the GPX's licence record, D-9's fixture-baked bundle for CI |
| [#1652](https://github.com/openzigs/onyourleft/issues/1652) | D-8.1: the credit from `OSM_ATTRIBUTION` whenever bundle data is drawn, and the §4.3 notice reachable from the demo |
| [#1648](https://github.com/openzigs/onyourleft/issues/1648) | D-9: the gate runs on the fixture-baked bundle only, and asserts the credit is visible when bundle data is drawn |
| [#1654](https://github.com/openzigs/onyourleft/issues/1654) | D-4.4: the embedding guide's sentence on serving the output unchanged; D-4.2's release asset if the release is built there |
| [#1655](https://github.com/openzigs/onyourleft/issues/1655) | D-8.2 and, if Q4 is accepted, D-8.3 |
| Any change to `worldCorridors` | None: ADR 0054 D-3.5 still binds it whole |
| ADR 0054 and ADR 0012 | Each gains one appended entry under ADR 0013 pointing here, in this pull request |

---

## What would make this ADR wrong

- **The bundle needs more than the four layers ADR 0054 D-2 reads**, such as place names for a
  showcase caption. Then the names question ADR 0054 D-2.2 settled comes back, and it is a change to
  this ADR and to that one.
- **A GPX that is not the owner's**, or one snapped to a planner's roads, is wanted. D-7.4 and D-7.5
  then need a ruling on that file's terms before it is committed.
- **The demo leaves the US.** The archive is US-only (ADR 0054 D-8 Q1); a route elsewhere has no
  map data to bake and gets the procedural world, until #1554.
- **The ODbL text, or the OpenStreetMap Foundation's guidance on games and videos, changes.**
  Context's table is dated for that reason.

## Sources

| What | Where | Read |
|---|---|---|
| ODbL 1.0: §1.0 definitions, §4.2, §4.3, §4.4 a, c and d, §4.6, quoted verbatim in Context | <https://opendatacommons.org/licenses/odbl/1-0/> (canonical page, fetched directly, HTTP 200) | 2026-10-24 |
| The owner's rulings of 2026-10-24 | [#1643](https://github.com/openzigs/onyourleft/issues/1643), its body's revised ruling and its comment of 2026-10-24 | 2026-10-24 |
| That the archive is distributed as *"an Open Database License Produced Work (OpenStreetMap attribution required)"* | <https://docs.protomaps.com/basemaps/downloads>, as quoted in ADR 0054 Context | 2026-10-21 |
