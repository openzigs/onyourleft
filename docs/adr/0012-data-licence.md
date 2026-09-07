# ADR 0012: The data licence — when a stored segment inherits ODbL, and the shape chosen so it does not

- **Status**: Accepted
- **Date**: 2026-09-07
- **Deciders**: the author, as engineering work. This ADR **discharges a deferral**
  [ADR 0001](0001-licence.md)'s *Data* section left open; it does not overturn an owner decision and
  does not seek one. ADR 0001 deferred this question **because it depends on a design decision that
  had not been made**, in its own words: *"whether segments are stored as OSM-snapped geometry or as
  raw GPS traces with snapping applied at read time. The second shape may avoid the question
  entirely."* That design decision is [#64](https://github.com/openzigs/onyourleft/issues/64)'s, it
  is made in **D-1** below, and the licence answer follows from it rather than the other way round.
  ⚠️ **This is not a legal opinion** — see **D-6**
- **Issue**: [#64](https://github.com/openzigs/onyourleft/issues/64), its *Open questions* section
- **Number**: **0012**, reserved for this decision in
  [`docs/architecture.md`](../architecture.md)'s ownership table and by ADR 0001's own amendment of
  2026-09-05. `CLAUDE.md` §7 says 0012 "is reserved and not free"; this is the document it was
  reserved for, so taking it consumes the reservation rather than colliding with it
- **Supersedes**: nothing
- **Constrains**: [#64](https://github.com/openzigs/onyourleft/issues/64) (the segment model, which
  this lands with), [#66](https://github.com/openzigs/onyourleft/issues/66) (the matcher — **the
  place the question actually bites**), [#68](https://github.com/openzigs/onyourleft/issues/68)
  (leaderboards), [#73](https://github.com/openzigs/onyourleft/issues/73),
  [#7](https://github.com/openzigs/onyourleft/issues/7) (the Phase 4 server, which is the first
  thing that can Publicly Use anything at all)
- **Relates to**: [ADR 0001](0001-licence.md) (defers this question and carries the amendment
  recording that it named the wrong number), [ADR 0010](0010-map-tiles-and-routing.md) (settles the
  *tile* half and deliberately does not touch this one), [ADR 0002](0002-local-first-architecture.md)
  (local-first, which is why Phase 1 publishes nothing), [ADR 0007](0007-patent-posture.md) (whose
  D-2 constrains the same matcher for an unrelated reason)

---

## Context

### The question, stated precisely

OpenStreetMap data is licensed **ODbL 1.0**. ODbL's share-alike obligation is in **§4.4 a**:

> Any Derivative Database that You Publicly Use must be only under the terms of: i. This License;
> ii. A later version of this License similar in spirit to this License; or iii. A compatible
> license.

and **§4.4 b** removes the wriggle room:

> For the avoidance of doubt, Extraction or Re-utilisation of the whole or a Substantial part of the
> Contents into a new database is a Derivative Database and must comply with Section 4.4.

So the obligation attaches to a **dataset**, independently of what licence the *code* carries. This
project is AGPL-3.0 and Apache-2.0 by path (ADR 0001, `CLAUDE.md` §3), and **neither of those
licences discharges an ODbL obligation on data**. That is the whole reason ADR 0001 said "#18 must
decide a data licence, not only a code licence".

The escape hatch ADR 0001 mentions is **§4.6**, which lets a publisher offer either the Derivative
Database itself (§4.6 a) or *"a file containing all of the alterations made to the Database or the
method of making the alterations to the Database (such as an algorithm)"* (§4.6 b). It is a real
option and it is **not** the one taken here, for the reason in **D-4**.

### Three ODbL terms this decision turns on, quoted rather than paraphrased

Read on 2026-09-07 from the ODbL 1.0 text (see *Sources*). The paraphrases in circulation are worse
than the originals in exactly the places that matter here.

| Term | ODbL 1.0 §1.0, verbatim |
|---|---|
| **Derivative Database** | "a database based upon the Database, and includes any translation, adaptation, arrangement, modification, or any other alteration of the Database or of a Substantial part of the Contents." |
| **Produced Work** | "a work (such as an image, audiovisual material, text, or sounds) resulting from using the whole or a Substantial part of the Contents (via a search or other query) from this Database, a Derivative Database, or this Database as part of a Collective Database." |
| **Publicly** | "means to Persons other than You or under Your control by either more than 50% ownership or by the power to direct their activities" |
| **Extraction** | "Means the permanent or temporary transfer of all or a Substantial part of the Contents to another medium by any means or in any form." |

⚠️ **"Publicly" is a defined term and it is narrow.** It is not "on the internet" and not "outside a
company"; it is *"to Persons other than You"*. Every obligation in §4.4 and §4.6 is conditioned on
Public Use. This matters more than any other single fact in this ADR, and it is the fact that
usually gets lost when the question is summarised.

### What ADR 0010 already settled, and what it explicitly did not

[ADR 0010](0010-map-tiles-and-routing.md) settles the **tile** half: an OSM-derived basemap tile is
a **Produced Work**, needs attribution and nothing more, and that is stated by the publisher of the
archive we consume. Its own callout says, of the question this ADR answers, *"This ADR decides
neither and contradicts neither"*, and its issue table records against #64: *"Unaffected. The ODbL
Derivative Database question for stored geometry is still yours, and this ADR does not touch it."*

So the tile question is closed and this is the other one. They are separate because §4.5 b says so:

> Using this Database, a Derivative Database, or this Database as part of a Collective Database to
> create a Produced Work does not create a Derivative Database for purposes of Section 4.4

A picture of a road is not a database of roads. A **list of way identifiers** is.

### The design fork ADR 0001 named

ADR 0001 deferred rather than decided, and said why:

> This is deferred rather than decided because it depends on a design decision that has not been
> made yet: whether segments are stored as OSM-snapped geometry or as raw GPS traces with snapping
> applied at read time. The second shape may avoid the question entirely. Deciding the licence
> before the data model would be deciding it blind.

That is the correct order and this ADR keeps it: **D-1 decides the shape, D-2 and D-3 read the
licence consequence off it.**

### Where the question actually bites, which is not #64

It is tempting to treat this as #64's problem because #64 is the issue that carries it. It is not.
**#64's own deliverable cannot trigger §4.4 under any reading**, for two independent reasons stated
in D-2 — and the issue that *can* is [#66](https://github.com/openzigs/onyourleft/issues/66), whose
leading candidate matcher (ADR 0007 D-2's "candidate 2") **snaps both the ride and the segment to an
OSM way sequence and compares edge-ID subsequences.** A stored edge-ID sequence is a transfer of OSM
Contents to another medium — Extraction, in §1.0's terms — and if a corpus of them is ever Publicly
Used, §4.4 is live.

Writing this ADR at #64 rather than at #66 is deliberate: the constraint has to exist **before** the
spike (#65) recommends an approach, or the approach gets chosen on speed alone and the licence
arrives as a surprise. That is the same posture `CLAUDE.md` §3 takes on dependencies — *"a licence
question answered before you write the code, not a taste question settled in review"*.

---

## Decision

Six rules. D-1 is the data model; D-2 and D-3 are the licence reading that follows from it; D-4 says
what happens at the Phase 4 boundary; D-5 is the attribution obligation, which is owed regardless;
D-6 is what this document is not.

### D-1 — A stored segment's geometry is the athlete's own recorded trace. No OSM geometry is stored.

**This is the design decision ADR 0001 was waiting for, and it is the second of its two shapes.**

A segment created under #64 is a **copy of a contiguous span of the creating athlete's own activity
stream** — their GPS receiver's own measurements, recorded by them, already stored in
`packages/store` under their own athlete id. Concretely:

1. **No coordinate in a `SegmentRecord` is copied from, snapped to, or interpolated onto an OSM
   way.** Not the polyline, not the endpoints, not the bearings.
2. **No OSM identifier is stored on a segment** — no way id, no node id, no edge id, no changeset,
   no relation.
3. **The elevation source is recorded per segment** (`elevationSource`, `elevationResolution`), and
   where it is a DEM it is Copernicus (ADR 0010 D-5) rather than OSM. Copernicus carries its own
   attribution obligation, which ADR 0010 already records; it is not ODbL and it is not share-alike.
4. **Snapping, if it ever happens, happens at read time and is not persisted.** Rendering a segment
   over a basemap draws our polyline on top of a Produced Work. That is two layers on a screen, not
   a merged dataset.

The consequence: **the segment corpus contains no OSM Contents at all.** It is not a Derivative
Database of OSM under §1.0 because it is not "based upon" OSM in any respect a court or the OSMF
would recognise — nothing was Extracted. A GPS trace of a road is an independent measurement of the
same physical world, and the physical world is not anybody's database.

> ⚠️ **This is a real cost, not a free win.** Raw-trace geometry is noisier than snapped geometry:
> two riders on the same road produce polylines that differ by metres, and a curve-similarity
> matcher has to absorb that where an edge-sequence matcher would not. **We are paying accuracy for
> licence simplicity and this ADR says so plainly**, rather than presenting the chosen shape as
> costless. #65's spike measures what that costs; **D-3 is what it must do if the answer is "too
> much".**

### D-2 — Nothing in Phase 1 Publicly Uses anything, so §4.4 and §4.6 are not engaged

Two independent reasons, either sufficient:

1. **There is no OSM-derived database to share alike** (D-1). §4.4 attaches to a *Derivative
   Database*; there isn't one.
2. **Nothing is Publicly Used.** §1.0 defines *Publicly* as "to Persons other than You". In Phase 1
   there is no server, no account and no upload (owner decision D6, ADR 0002): a segment lives in
   the athlete's own browser in their own IndexedDB. Even a corpus that *was* wall-to-wall OSM
   Contents would owe nothing under §4.4 while it sits there, because the condition on the
   obligation is not met.

**Reason 2 is the weaker one to rely on and it is stated second on purpose.** It expires the moment
#7 lands a server, and an ADR that rested on it alone would be a time bomb. Reason 1 is a property
of the data model and does not expire. ⚠️ **Do not cite reason 2 without reason 1.**

> ⚠️ **§4.5 c is *not* the argument being made here**, though it looks like the obvious one. It
> exempts "Use of a Derivative Database internally within an organisation". A single athlete's
> browser is not an organisation, and stretching that word to cover one person is the kind of
> reading that survives right up until somebody tests it. The definition of *Publicly* does the work
> without any stretching at all, which is why D-2 uses that instead.

### D-3 — If a matcher needs OSM way identifiers, it stores them in a separate table and that table is ODbL

Binding on [#65](https://github.com/openzigs/onyourleft/issues/65) and
[#66](https://github.com/openzigs/onyourleft/issues/66). **This is the rule this ADR exists for.**

If the spike concludes that raw-trace matching is not accurate enough and a map-matched design is
needed, that is permitted — the accuracy of the product is a real consideration and D-1 is not a
suicide pact. But it arrives under four conditions:

1. **OSM-derived data is stored in its own object store**, never as fields on `SegmentRecord`. The
   split is the point: a table that is entirely OSM-derived can be licensed ODbL on its own, and the
   segment table beside it stays clean. This is the shape the OSMF's own **Collective Database
   Guideline** describes — datasets kept independent are a Collective Database (§4.5 a), not a
   Derivative one, and share-alike reaches only the OSM part.
2. **That store is declared ODbL 1.0 in this ADR's successor**, which is a new ADR and not an
   amendment to this one — a licence on a dataset is a decision, and `CLAUDE.md` §7 requires a
   superseding ADR to reverse one.
3. **The segment record still carries its own-trace geometry** (D-1), so a way-id table can be
   dropped and rebuilt without the athlete losing a segment. A segment whose geometry *is* a way
   sequence cannot survive that, and would make the licensing decision irreversible in practice.
4. **The PR that introduces it says, in one sentence, which OSM Contents it stores and where.** Not
   "uses OSM" — *which fields*.

⚠️ **Do not merge a matcher that writes an OSM identifier into `SegmentRecord` and call it an
optimisation.** That is the change that converts the whole segment corpus into a Derivative
Database, and it would arrive looking like a schema tidy-up. It is the exact shape of the trap
`CLAUDE.md` §3 describes for dependencies, in a different layer.

### D-4 — §4.6 is not the plan, and the reason is that it is an ongoing obligation rather than a one-off

ADR 0001 names §4.6 as "a way out — publish the algorithm rather than the database". It is a genuine
option and we are declining it, on the merits:

- §4.6 is conditioned on **Publicly Using a Derivative Database**. It does not avoid §4.4; it is
  what §4.4-adjacent publication *costs*. The obligation to "offer to recipients … a copy in a
  machine readable form" is **continuous** — it binds every version, forever, for a self-hosted
  instance run by somebody who has never read this ADR.
- ADR 0002 makes self-hosting a first-class deployment model, and ADR 0001's *Self-hosting* section
  makes it unconditional. **An obligation we cannot discharge on a stranger's behalf is one we
  should not create for them.** A self-hoster who runs an instance and does not publish an
  alteration file is in breach, and would have no way to know it.
- D-1 costs accuracy. §4.6 costs every future operator a compliance duty. Given a choice between
  paying once in engineering and taxing everybody who ever runs this, the first is the better trade
  and it is the one ADR 0002's architecture already implies.

**If D-3 is ever exercised, §4.6 comes back onto the table** and its successor ADR decides between
4.6 a and 4.6 b then, with the shape of the data in front of it. It is not decided here because
deciding it here would be deciding it blind — the same error ADR 0001 declined to make.

### D-5 — OSM attribution is owed wherever an OSM-derived basemap is displayed, and that is untouched

ADR 0001's *Data* section states one thing as already settled: *"any instance serving OSM-derived
tiles or routes must display OSM attribution"*. **That stands exactly as written and this ADR does
not narrow it.**

It comes from **§4.3**, which is a *Produced Work* obligation and therefore applies even though D-1
keeps us clear of §4.4 entirely — attribution and share-alike are different sections with different
triggers, and satisfying neither §4.4 nor §4.6 says nothing about §4.3. ODbL's own example notice
(§4.3 a) is:

> Contains information from DATABASE NAME, which is made available here under the Open Database
> License (ODbL).

⚠️ **A segment drawn over a basemap displays the basemap**, so a screen showing a segment owes OSM
attribution for the tiles under it — not for the segment. #63's map already asserts the attribution
requirement in a test, per its own acceptance criteria, and that test is the enforcement half of
this rule. **A segment view that renders a map without it is a licence violation even though every
word of D-1 is satisfied**, and the two facts are easy to confuse.

### D-6 — This is not a legal opinion and must not be quoted as one

The same rule [ADR 0007](0007-patent-posture.md) D-1 states for patents, for the same reason.

No lawyer was consulted. What this ADR contains is the **licence text read directly** (§1.0, §4.3,
§4.4, §4.5, §4.6, quoted above from the source in *Sources*) and a design chosen so the harder
questions are not reached. Whether a corpus of GPS traces of public roads could be argued into being
"based upon" OSM by somebody determined enough is a question this ADR does not answer and does not
need to, because D-1 gives it nothing to work with.

⚠️ **Two limits worth stating plainly.** `opendatacommons.org` and `osmfoundation.org` are both
**blocked by this environment's egress proxy**, so the ODbL text was read from
[a third-party mirror](#sources) and the OSMF Community Guidelines only through search-result
summaries. The mirror's §4.4 and §4.6 text is consistent with every secondary description found, and
the definitions are the load-bearing part — but a reader with unblocked access should re-read §1.0
and §4.4 against the canonical text before relying on this for anything beyond "choose the shape
that does not raise the question". The Collective Database Guideline cited in D-3.1 is the weakest
citation here and is doing supporting rather than load-bearing work: D-3's separate-table rule is
sound on §4.5 a alone.

---

## Consequences

**Good:**

- **ADR 0001's *Data* deferral is discharged**, and #64 and #73 are unblocked. That deferral has
  been open since the first ADR and has blocked two issues for the whole of Phase 1.
- **Phase 1 ships with no data-licence obligation beyond attribution**, which #63 already asserts.
- **The rule that matters is in place before the spike that would otherwise decide it by
  accident** — #65 now chooses a matcher knowing what an edge-ID table costs.
- **The trap is named.** An OSM way id on `SegmentRecord` is the one change that converts everything,
  and D-3 says so in the place a future contributor will look.

**Bad, or at least owed:**

- **Raw-trace geometry is less accurate than snapped geometry**, and #66 absorbs that cost. If the
  spike says the cost is too high, D-3's four conditions are more work than a single snapped column
  would have been.
- **D-2's reason 2 expires at #7.** A Phase 4 server that serves segments to other people is Public
  Use by definition, and at that point *only* reason 1 holds the line. It holds — but the margin
  narrows from two independent arguments to one.
- **This ADR rests on a licence text read through a mirror**, per D-6.

**Neutral, and worth knowing:**

- **Nothing here constrains what an athlete may do with their own segment.** ADR 0014's signed
  records are theirs; exporting a segment they created from their own ride carries no ODbL
  obligation, because there is no OSM in it.
- **`packages/store` gains no dependency and no licence declaration from this.** The decision is
  about what is *in* a record, and the path rule (`CLAUDE.md` §3) is untouched — a segment record is
  Apache-2.0 code describing the athlete's own data.

---

## Sources

| What | Where | Read |
|---|---|---|
| ODbL 1.0 full text — §1.0 definitions, §4.3, §4.4, §4.5, §4.6, quoted verbatim above | `https://github.com/kemitchell/ODbL-1.0/blob/master/ODbL-1.0.unwrapped.md` (mirror; `opendatacommons.org` is blocked by this environment's egress proxy) | 2026-09-07 |
| OSMF Collective Database Guideline — independent datasets are a Collective rather than a Derivative Database | `https://osmfoundation.org/wiki/License/Community_Guidelines/Collective_Database_Guideline_Guideline` (**not fetched** — `osmfoundation.org` is blocked; read through search-result summaries only, see D-6) | 2026-09-07 |
| That a Protomaps basemap archive is distributed as an ODbL **Produced Work** requiring OSM attribution | quoted in [ADR 0010](0010-map-tiles-and-routing.md) from `https://docs.protomaps.com/basemaps/downloads` | 2026-09-03 |
