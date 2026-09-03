# ADR 0004: Activity privacy and the location-data model

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner, through the acceptance criteria in #21 and its comment of
  2026-09-03; each choice below is recorded with its reasoning so a superseding ADR has
  something to argue with
- **Issue**: [#21](https://github.com/openzigs/onyourleft/issues/21)
- **Depends on**: [ADR 0001](0001-licence.md) (self-hosting is unconditional), the local-first
  architecture decision ([#57](https://github.com/openzigs/onyourleft/issues/57)), and owner
  decision D6 (Phase 1 has no server, no account and no network)
- **Implemented by**: [#26](https://github.com/openzigs/onyourleft/issues/26) (schema),
  [#29](https://github.com/openzigs/onyourleft/issues/29) (fixtures),
  [#34](https://github.com/openzigs/onyourleft/issues/34) (visibility enforcement),
  [#35](https://github.com/openzigs/onyourleft/issues/35) (export and deletion),
  [#12](https://github.com/openzigs/onyourleft/issues/12) (segments and leaderboards),
  [#13](https://github.com/openzigs/onyourleft/issues/13) (feed),
  [#56](https://github.com/openzigs/onyourleft/issues/56) (federation),
  [#73](https://github.com/openzigs/onyourleft/issues/73) (routes)
- **Supersedes**: nothing

## Context

The payload of this product is a timestamped record of where a named person was, at 1 Hz, on the
days they left the house. For most outdoor riders the first point of nearly every activity is their
front door, the last point is too, and the timestamps say when the house was empty. Heart rate and
power ride alongside it and are **health data** under both Google Play and App Store policy, which
`SECURITY.md` already states.

No source consulted while planning this program addressed its privacy posture. It is not inherited
from anywhere, so it is decided here.

### Why this is decided in Phase 0, before there is anything to protect

Owner decision D6 is unambiguous: **Phase 1 has no server, no account and no network.** The data
never leaves the device, so in the first milestone there is nothing to obfuscate and nobody to
obfuscate it from. It would be easy to conclude that this ADR can wait.

It cannot, for one reason: **designed in, obfuscation is a function applied at an emit boundary;
retrofitted, it is a migration over every historical activity, a backfill, a re-derivation of every
segment effort, and an apology.** Two issues that are being written now are built against the
answers below — [#26](https://github.com/openzigs/onyourleft/issues/26) puts a `visibility` column
and a privacy-zone table into the local schema, and
[#29](https://github.com/openzigs/onyourleft/issues/29) builds the fixture corpus that every parser
and analysis test in the program will use. Both need this ADR to have decided rather than deferred,
which is why the sections below choose an answer and give the reasoning even where the reasoning is
uncomfortable.

**Nothing here creates a server, and nothing here may be read as licence to scaffold one.** Sections
that describe instance behaviour are Phase 3 rules, owned by
[#7](https://github.com/openzigs/onyourleft/issues/7), stated now because the schema and the record
format are fixed before the instance exists.

### Who this model defends against, and who it does not

Stated up front, because a privacy model without a threat model is a mood:

| Adversary | Defended? |
|---|---|
| A stranger reading a public activity page or its JSON | **Yes** — this is the main case |
| A stranger correlating many of one athlete's public activities | **Partly** — cost is raised, not made infinite; see decision B |
| A follower the athlete approved | **No** — approving a follower is a disclosure decision |
| The operator of the instance the athlete syncs to | **No access control** — the defence is minimisation, not secrecy; see "What this model does not protect against" |
| Another instance in the federation | **Partly** — it receives only what the athlete published, already obfuscated |
| Someone with the athlete's unlocked device | **No** |

### The new input: an error message is a location channel

The review of [#102](https://github.com/openzigs/onyourleft/pull/102) found that
`packages/domain`'s `UnitError` interpolates the offending value into its message, and deferred the
policy question here. Verified against the committed tree at `f16f57f`:

- `assertIntegerInRange` in `packages/domain/src/unit-error.ts` reports
  `latitude in semicircles must be a whole number, received 614507218.4`. A **fractional
  semicircle** is a plausible read error rather than a hostile input — a caller that scaled a field
  before labelling it — and the value it echoes is a real coordinate to sub-centimetre precision.
- `assertInRange`, reached through the same file, is leaky in one further case the deferral did not
  name. `latitudeSemicircles` bounds its argument at the pole (±2^30), not at the field width, so a
  **transposed** field pair — the exact bug `packages/domain/src/position.ts` is built to catch —
  reports `latitude in semicircles must be between -1073741824 and 1073741824, received
  1803997218` for any athlete whose longitude is outside ±90°. `1803997218` semicircles is
  151.2093°E, exact. That covers the Americas, Oceania and East Asia.

`CLAUDE.md` §6 already names error messages as a location-leak channel. The list of boundaries in
this ADR's own issue — a sync, a shared route, a segment effort, a file export, a leaderboard row —
did not include them. Decision D closes that gap.

## Decision

### A. Default visibility for a new account is **private**, and the column exists from the first schema

Every activity carries `visibility`, an enum of exactly three values, `NOT NULL`, written at insert:

| Value | Meaning |
|---|---|
| `private` | The owning athlete only. **The default.** |
| `followers` | Athletes the owner has approved. Inert until #79. |
| `public` | Anyone, including logged-out readers and other instances. |

The column lands in the **Phase 1 local schema** (#26) even though Phase 1 has nothing that reads
it. A column added later is a migration over every row an athlete already owns, and — worse — a
default chosen later is a default chosen for data that already exists. Writing it from the first
insert costs one column and removes that whole class of problem.

**The tension is real and the choice is not free.** A private-by-default product makes the social
features in [#13](https://github.com/openzigs/onyourleft/issues/13) feel empty: a new athlete's feed
shows nothing, their first ride gets no kudos, and the network effect that makes a feed worth
building never starts. Public-by-default fixes that and, in the same motion, publishes the home
addresses of everyone who did not think about it. **We choose the empty feed.** Three reasons, in
order of weight:

1. **The two failures are not equally reversible.** An empty feed is repaired by one athlete action
   that takes seconds and can be undone. A published ride from a front door has been fetched,
   cached, indexed and — under the federation model in ADR 0002 / #57 — copied to other instances as
   a signed record. Decision F says plainly that recalling it is a request, not a guarantee. One
   failure has a fix; the other has an apology.
2. **The people harmed by public-by-default are exactly the people who did not make a choice.** A
   default is a decision made on behalf of someone who is not paying attention, so it should be the
   decision that is safe to make on their behalf.
3. **This project is not optimising the metric that public-by-default optimises.** It is not
   growth-funded, it has no advertising surface, and its distribution model is small self-hosted
   instances rather than one network whose value is its size. Borrowing a default from products that
   *are* funded that way would import their incentives along with it.

The mitigation for the empty feed is **prompting at the right moment, not defaulting**: a per-activity
share affordance on the activity itself, and a one-time visibility choice presented during first
sync setup (#7) that offers `private` / `followers` / `public` with plain-language consequences and
no pre-selected option other than `private`. **A bulk "make everything public" action must require a
second confirmation naming the count of activities affected**, because the one-click version of it is
how an athlete publishes ten years of rides from a settings screen.

`public` is the only value that crosses an instance boundary in the federation sense; `followers`
resolves against a follow graph the instance owns, so it is enforced, not federated (#56).

### B. Privacy zones: a **500 m default radius**, athlete-confirmed, and an honest account of what a fixed disc leaks

A privacy zone is a centre, a radius and a label, owned by the athlete. Points inside it are removed
at every emit boundary (decision C).

**Radius: default 500 m; selectable from 250 m, 500 m, 1 km, 2 km.** The lower bound is set by GNSS
error and by dwelling density — a 100 m disc in a rural setting frequently contains exactly one
building, which obfuscates nothing — and the upper bound by usefulness, since a 2 km disc removes
most of a short ride. 500 m is chosen as the default because in any built-up area it contains
several hundred addresses, and it is roughly the smallest radius for which that is true across the
range of places people actually live. **The athlete in a low-density area must choose larger, and
the UI must say so at the point of choosing**, with the count of the athlete's own activities the
zone would affect. A silently-too-small default is worse than no default, because it is believed.

**No zone is created without the athlete confirming it.** Ride-start clustering *is* computed — on
device, in Phase 1 and in every later phase, never on an instance — and is used to **propose** a
zone that the athlete accepts, moves, resizes or rejects. It is not applied automatically, for two
reasons that point the same way: an inferred-and-applied zone is the product computing "where this
person lives" and storing it as a first-class artefact, which is precisely the datum this ADR
exists to avoid creating; and it is wrong for the athlete whose rides start at a station, a café or
a colleague's house, where it would hide the wrong place while producing the *feeling* of
protection. The proposal is discarded if declined and recomputed only on request; the centroid is
never persisted except as a zone the athlete confirmed.

**Zone definitions never leave the device.** They are not synced, not backed up to an instance, and
not present in any payload. The instance is not told where the athlete lives *and then trusted to
hide it* — it is never told. This is the single most load-bearing sentence in this ADR, because it
is what makes the model survive a hostile instance operator (see below).

#### A fixed radius around a fixed point leaks its own centre, and this is the part usually missed

If every activity's emitted track begins exactly on the boundary of the same circle, the centre is
the circumcentre of any three entry points. Three rides locate the home to within GNSS noise; fifty
rides locate it to metres. The zone has moved the disclosure from the first GPS point to a small
geometry problem, which is a real improvement and is not the same thing as protection.

What this ADR requires to blunt it:

1. **Jitter the trim radius per activity.** The trim radius is `r · (1 + u)` with `u` drawn from
   `[0, 0.25]`, so the emitted first point lies in an annulus rather than on a circle. The draw must
   be **deterministic in (activity id, zone id)** — a keyed, stable derivation, not a fresh random
   number — because re-emitting the same activity twice with two different draws hands an observer
   two constraints instead of one and makes the jitter worth less than nothing.
2. **Trim along the path, and represent a mid-ride passage as a gap.** A ride that passes home in
   the middle is emitted as two segments with an explicit gap between them, never as one polyline.
   A renderer that joins across the gap draws a chord whose perpendicular bisector passes through
   the centre; #63 must not connect across a gap, and a test must assert it does not.
3. **Publish nothing that measures the trimmed part.** No trimmed distance, no trimmed duration, no
   "activity started at" earlier than the first emitted point. The start timestamp of a non-owner
   view is the timestamp of the first emitted point.
4. **Derive every published total from the emitted track, not the true one** — see decision C.
   Otherwise `true_distance − emitted_distance` restores the length of the trimmed prefix, and with
   a bearing that is the centre again.

**And then say the true thing: this does not defeat a determined observer with many activities.**
Jitter degrades an estimate; averaging over rides recovers it. A privacy zone raises the cost of
locating a home from "read one GPX file" to "collect an athlete's public activities and solve for a
centre", and it stops there. The only complete protection is not publishing the activity at all,
which is what decision A gives by default, and that is why decisions A and B are one decision in two
parts. **The UI must not describe a privacy zone as making a location private.** It hides the start
and end of a ride; it is not anonymity.

#### Routes are a different problem and get a different rule

A saved route (#55, #73) is a plan, and its endpoints are usually the athlete's front door. There is
no "hide the first 200 m" that leaves a usable route: a route trimmed at the start does not start
where the rider is, so trimming produces a route that is both less private-feeling and actually
broken.

**A route is shared whole or not at all.** Therefore:

- A route with either endpoint inside one of the athlete's privacy zones **may not be shared or
  published**. The action is refused, with an explanation and an offer to re-anchor the start at a
  nearby junction outside the zone — an edit the athlete makes deliberately to a copy, not something
  applied to their route behind their back.
- The share dialog for every route states, in words, that its endpoints are published.
- A route exported to the athlete's own head unit (#74) is their own data and is exported whole.

### C. Obfuscation is applied **in the payload, at every boundary where data leaves the athlete's control**

> **The rule.** At every boundary listed below, the bytes that cross it contain no point inside a
> privacy zone, and every derived value in them is derived from the obfuscated track. Obfuscation is
> never performed by the renderer.

Client-side hiding is not a control. A client that draws a trimmed line from a full payload has
protected nothing: the full track is one `fetch` away from anyone who opens developer tools, and it
is already in the browser's cache. #34's criterion — assert on the **raw response payload**, not on
rendered output — is the correct shape and this ADR generalises it.

The boundaries, all of them:

| # | Boundary | Where the rule is applied | Owned by |
|---|---|---|---|
| 1 | **Sync to an instance** | On the device, **before transmission** | #7, #47, #61 |
| 2 | **An instance's response body** — activity detail, stream fetch, list, search | Server-side, in the payload | #34, #38 |
| 3 | **A server-rendered image** — map thumbnail, static map, OG image | Rendered from the obfuscated track, with a bounding box computed from it | #38, #63 |
| 4 | **A raw activity file download** | Same check as the detail route, including any pre-signed URL | #34 |
| 5 | **A segment effort and a leaderboard row** | Effort geometry and start point | #12, #68 |
| 6 | **The activity feed** | Summary card, map preview, start/end fields | #13, #80 |
| 7 | **A shared or published route** | Refused rather than trimmed — decision B | #55, #73 |
| 8 | **A file export to a third party** | Decision E | #35, #51, #74 |
| 9 | **A federated record crossing to another instance** | The record is emitted already obfuscated | #56 |
| 10 | **An error message, a log line, a toast or a crash report** | Decision D | this ADR |

Three consequences of "derived from the obfuscated track" that are easy to miss and are therefore
requirements, not advice:

- **Published totals are the totals of the emitted track.** A public ride shows 48.2 km where the
  athlete's own view shows 50.0 km. This is a real cost and it is accepted, because the alternative
  is a per-field exception list, and an exception list is a thing people forget to add to. The UI
  must explain the difference on the athlete's own activity rather than let them discover it.
- **Any stored summary field derived from position** — `start_lat`, `start_lng`, a bounding box, an
  encoded overview polyline — is either not stored at all or stored in a form that never crosses a
  boundary. #26 must not create a `start_lat`/`start_lng` pair that a list query selects, because
  that is the leak that survives a correct stream endpoint.
- **A segment effort whose matched span intersects any of the owner's zones is not published**, and
  the athlete is told why. There is no trimmed effort: a partial effort is a wrong time.

**The local store keeps the truth.** Obfuscation is applied at emit, never by destroying the
athlete's own data — so enlarging a zone retroactively protects every past activity, and a
mistakenly large zone is reversible. The corollary is a Phase 3 obligation: **creating or enlarging
a zone re-emits every affected activity already synced**, replacing it at the instance, and the
instance must accept that replacement. Anything a third party already fetched is gone; the ADR does
not pretend otherwise.

**Two layers, not one.** The client strips before upload *and* the instance enforces in its response
bodies. Belt and braces, for the same reason ADR 0005's licence rule is: an instance can hold a
record that arrived from a federated peer, from an older client, or from a file import, and a rule
that only one layer applies is a rule with a hole in the shape of every other producer.

### D. An error message is a boundary. The rule is the **field and the constraint, never the value — for coordinates only**

> **The coordinate-message rule.** When the quantity being reported is a coordinate — a latitude, a
> longitude, a semicircle field of either, a position, or an altitude reported together with one — a
> message may name **the field** and **the constraint** and must not name **the value**. Every other
> quantity keeps its value in the message.

`latitude in semicircles must be a whole number` is the required form.
`… received 614507218.4` is not.

**Why not strip values generally.** Because the value is most of the diagnostic. A malformed GATT
payload, a FIT field scaled twice, a heart rate of 65535, a timestamp before the 1989 epoch — in
every one of those the offending number is the thing that tells the reader what happened, and
`packages/domain`'s whole validation design is built on saying which field and why. A blanket rule
would buy a coordinate's privacy at the cost of every other quantity's debuggability. The narrow
rule costs one class of message.

**Scope: every layer that formats a coordinate into a string, not only `packages/domain`.** Error
messages, log lines, UI toasts, crash and diagnostic reports, analytics breadcrumbs, and any Phase 3
API error body. Binding it to the domain package alone would bind exactly the wrong half:
`docs/architecture.md` records that the same domain code runs on the device *and on an instance*, so
the package with the least dangerous sink today has one of the most dangerous later, while the sinks
that actually transmit — a crash reporter, a log shipper, an error response — live everywhere else.

**What this requires, and when:**

- **Now, for all new code:** no coordinate value in a message, a log line or a toast, in any package
  or app.
- **Before the first off-device sink exists:** `packages/domain`'s `assertInRange` and
  `assertIntegerInRange` are brought into line on the coordinate paths. This is deliberately *not*
  urgent — under D6 the only sink is the athlete's own device, and the echoed value has always
  failed validation on its way to a thrown error — but it must land before any of: a crash reporter,
  a telemetry or log-shipping path, or an error body crossing the network.
  [#104](https://github.com/openzigs/onyourleft/issues/104) carries it; no test in the domain
  package asserts on message text today, so the change breaks nothing.
- **Standing constraint:** the client ships **no third-party analytics or crash-reporting SDK that
  transmits off-device by default.** If crash reporting is ever added it is opt-in, it is named in
  `.env.example` (which `ENV001` already enforces), and it applies this rule. A rule about what goes
  into a log is unenforceable next to an SDK that ships the whole log somewhere.

### E. Exports: your own data whole, anyone else's obfuscated

| Export | Contents |
|---|---|
| **Your own activity, to yourself** | The **true** track, unobfuscated, including points inside your own zones. Full streams, laps, health channels, and the original uploaded file with its content hash. |
| **Your own account, to yourself** (#35) | Everything above for every activity, plus zone definitions, gear, routes and settings — machine-readable, in FIT and GPX plus a JSON manifest describing what is in it. |
| **Your own activity, shared or published to a third party** | Obfuscated, by decision C. An explicit per-export "include the full track" opt-out exists and must name the consequence in the confirmation. |
| **Another athlete's activity** | Exactly what that athlete's visibility setting lets you see, obfuscated the same way as the response body. An export route that is not subject to the read check is the classic bypass. |

Exporting your own data returns the truth because it *is* your data, and because obfuscating it
would break the invariant the whole architecture rests on: per ADR 0002 / #57 the athlete's signed
files are the canonical artefact, and a canonical artefact with the start of every ride missing is
not canonical. It follows that an account export is the most concentrated location dataset the
system ever produces — a single file naming where the athlete lives — so it must be delivered over
an authenticated, single-use, short-lived channel, never a guessable or long-lived URL, and never by
email attachment.

#### Does a hosted instance become a data holder under the EU Data Act?

Regulation (EU) 2023/2854 has applied since 2025-09-12. Chapter II (Arts. 3–7) gives the *user* of a
connected product a right to the data it generates and a right to have the data holder share it with
a third party the user chooses, covering personal **and** non-personal data — broader than GDPR Art.
20. The design-by-default access obligations bite for products placed on the market after
**2026-09-12**, and Art. 7(1) exempts micro and small enterprises from the Ch. II sharing
obligations.

**Position: assume a hosted instance is a data holder, and build as though the obligation applies.**
An instance that receives data from a connected product (a head unit, a power meter, a trainer) via
a related service is a plausible data holder, and the small-enterprise exemption is an argument
about the size of whoever is running the instance — which for a self-hostable project is a different
answer for every deployment and therefore useless as a design input. The obligation is cheap here
because the architecture already satisfies it: the athlete holds the canonical copy locally, export
is complete and machine-readable, and directing an export to a third party is a first-class function
rather than a support ticket. The Data Act cuts **for** this project's design and against a design
that would have made the instance the system of record. **This is an engineering decision recorded
by engineers, not legal advice** — the same caveat ADR 0001 carries.

### F. Retention and deletion, and what deletion means once a record is signed and federated

**Phase 1 (local).** Retention is the athlete's own disk and nothing expires. Deletion means
**purge, not tombstone**: deleting an activity removes its summary row, its laps, its stream blobs
and the original file in the same transaction, and #28's round-trip harness asserts the streams are
gone **by reading back through the same path a consumer uses**, not by trusting the delete's return
value. This is the dominant defect shape in this program (`CLAUDE.md` §5) pointed at deletion, where
it presents as data the athlete believes is gone.

**Phase 3 (instance).**

- An instance holds only what the athlete synced, already obfuscated, and never a zone definition.
- Account deletion removes the athlete's records from the live store immediately, and from derived
  indexes, caches, thumbnails, search and CDN copies **within 7 days**. Backups expire on their own
  schedule, which must be **at most 35 days** and must be documented by the operator (#17, #52).
- **A deletion that leaves a derived artefact is not a deletion.** The enumeration is part of #35's
  acceptance criteria and must be derived from the schema rather than hand-written: segment efforts,
  leaderboard rows, feed entries, kudos and comments, club rosters, cached thumbnails and tiles,
  aggregate counters.
- Health channels — heart rate, power, cadence — are covered by the same visibility column and the
  same purge. They are never shared with a third party and never used for advertising, and they must
  be declared as health data in the Play Data Safety form and the App Store privacy label (#95).
  This restates `SECURITY.md`; it does not extend it.

**Federation (owner decision D5, owned by #56).** Once a signed record is on another instance,
"delete my rides" is a request. There is no mechanism by which one instance compels another to
forget, and pretending otherwise would be the most consequential lie this product could tell. What
this ADR requires instead:

1. The federation protocol carries a **signed retraction** record. A conforming instance honours it,
   removes the record and its derived artefacts, and **propagates** the retraction onward.
2. An instance that does not honour retractions is non-conforming and is defederated. That is the
   only enforcement that exists, and it is social rather than technical. Say so.
3. **The truth is told at publish time, not at delete time.** The dialog that makes an activity
   public states that a public activity may be copied to other instances and cannot be recalled with
   certainty. Consent obtained after the copy is not consent.
4. The GDPR Art. 17 exposure this creates is mitigated by **minimisation, not by erasure**: because
   a federated record never contains a point inside a privacy zone and never contains a zone
   definition, the thing that cannot reliably be recalled is not the thing that names a home. This
   is the argument for decision C's "strip before upload", and it is why that rule is not
   negotiable.

### G. No real person's ride file is a fixture, anywhere in this program, ever

> **The rule.** No file recorded by a real device from a real ride may be committed to this
> repository, referenced by a test, or used as the evidence for any acceptance criterion in this
> program. Every fixture is produced by a committed generator from parameters in the repository.

This is a hard prohibition and it has no exceptions. In particular:

- **A contributor's own rides are not an exemption.** "Synthetic or self-recorded" — as #29's
  revision block currently puts it — is resolved here in favour of synthetic. A contributor's own
  ride file is a real person's real ride file, and the person is the contributor. #29's own body
  already gives the practical reason: a file that exists on one machine cannot be checked in CI, so
  a criterion resting on it is a criterion only its author can discharge, which is not a criterion.
  Local, uncommitted exploration against one's own rides is fine and always was; it just cannot be
  the evidence.
- **A public activity downloaded from another service is not an exemption.** It is still a real
  person's ride, and it usually still starts at their home. Public does not mean unowned.
- **A real trace translated, rotated or noised is not an exemption.** A displaced trace keeps its
  shape, which can be matched against a road network, and it keeps its timing and its health
  channels. Derivation launders nothing.
- **The rule binds #65's matching spike** as strongly as it binds #29 — a matching spike is exactly
  where somebody reaches for a real dataset — and it binds #75–#78 and #67 identically.

**The check.** #29's existing criterion — *"a test asserts every position in every fixture falls
inside a documented synthetic test region, and fails if any does not"* — is the mechanical form of
this rule, and this ADR makes the region concrete so the criterion has something to point at:

| Region | Latitude | Longitude | Why it is safe |
|---|---|---|---|
| `NULL-ISLAND` | −1.0 … +1.0 | −1.0 … +1.0 | Open water, Gulf of Guinea. Exercises both signs of both coordinates and the zero crossing |
| `ANTIMERIDIAN` | −1.0 … +1.0 | ≥ +179.0 or ≤ −179.0 | Open Pacific. Exercises the longitude wrap and the `sint32` bound |
| `POINT-NEMO` | −49.0 … −48.0 | −124.0 … −123.0 | The oceanic pole of inaccessibility. A ride-sized region in the southern and western hemispheres |

A fixture position outside every declared region fails the test. A region may be added by the corpus
only if it contains no land — so that no ride has ever been recorded in it — with the check recorded
in the corpus README next to the region. Indoor fixtures carry no position at all and are
unaffected.

**This ADR deliberately does not add a rule to `scripts/check-repo-rules.sh`.** There are no
fixtures today, so such a rule would pass by checking nothing, and `CLAUDE.md` §5 is explicit that a
check that has not been watched to fail is not a check. #29 adds the enforcement **in the same pull
request as the first fixture**, where a violating fixture exists to prove the check can go red.

### H. The leak paths that must be tested

Each of these needs a test that asserts **on the payload or the artefact**, not on rendered output,
and each needs a fixture containing **three athletes** — two cannot distinguish "correctly scoped"
from "returns everything the requester is connected to", because with two athletes those are the
same set.

| Path | Assertion | Owned by |
|---|---|---|
| Activity detail | No point inside a zone in the response body; another athlete's private activity is **404, not 403** | #34, #38 |
| Stream fetch | The stream endpoint is obfuscated independently of the detail endpoint — it is the one people forget | #34, #38 |
| Map thumbnail / static image | Rendered from the obfuscated track; the image's bounding box does not extend to the trimmed start | #38, #63 |
| Raw file download | Subject to the same check as detail, including pre-signed URLs | #34 |
| Segment effort start points | An effort intersecting a zone is not published; a published effort's geometry contains no zone point | #12, #68 |
| Leaderboard row | No coordinate, no start point, no map preview drawn from a true track | #12, #68 |
| Activity feed | Summary card, preview and start/end fields are all derived from the obfuscated track | #13, #80 |
| Shared route | Sharing is refused while an endpoint is inside a zone | #73 |
| Export | Own export whole; third-party export obfuscated; someone else's export scoped | #35, #51 |
| Federated record | The record emitted to a peer contains no zone point and no zone definition | #56 |
| Visibility change | Public → private takes effect on the very next read, through every cache | #34 |
| **Error messages and logs** | No coordinate value in any message, log line, toast or crash report | this ADR, #104 |

## What this model does not protect against

Stated plainly, because an implied guarantee is worse than a named gap.

- **A hostile or merely curious instance operator.** They can read their own database; there is no
  access-control answer to that, and encryption at rest is not one either since the operator holds
  the keys. **The answer is minimisation, not secrecy:** the instance is never sent a zone
  definition, never sent a point inside a zone, and never sent an activity the athlete did not
  choose to sync. So an operator learns where the athlete rides, not where they live. That is a real
  residual disclosure and it is accepted, for three reasons: it is a property of every hosted
  service, and a design that hid it would be lying; the canonical copy stays on the athlete's device
  (ADR 0002 / #57), so leaving an instance costs nothing but a re-sync; and ADR 0001 makes
  self-hosting unconditional and AGPL-3.0 §13 obliges an operator to publish the source they run, so
  "trust the operator" is a choice with an exit and an audit path rather than a condition of use.
- **We do not do end-to-end encryption, and this ADR does not leave the door open for it.** The four
  things an instance exists for per `docs/architecture.md` — reachability, indexing, authority for
  real-time state, and enforcement of privacy and erasure — all require reading the data. E2EE would
  defeat all four and produce an instance that could only store blobs, which is a different product.
  Minimisation is the control; encryption is not being used as a substitute for it.
- **Aggregation over many public activities**, which is the zone-centre inference in decision B.
- **An approved follower.** Approving a follower is a disclosure decision by the athlete.
- **Traffic analysis of sync timing**, which can reveal when an athlete rides even when the activity
  is private. Not defended, not cheaply defensible, recorded so nobody claims otherwise.
- **Any aggregate or heat-map surface.** None is in scope, and none may ship without an ADR that
  supersedes or extends this one. Two constraints are fixed now and are not that ADR's to reopen:
  such a surface consumes the **obfuscated** stream only, and a cell is published only above a
  minimum distinct-athlete threshold that the owning ADR sets and justifies. The published
  incidents in this space were aggregate disclosures, not individual ones.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Public-by-default with a prominent privacy prompt** | The prompt is read by the people who would have set it anyway. The harm lands on everyone else, and it is irreversible. Decision A. |
| **Followers-only as the default** | Better than public and still wrong at the moment of the first follow request, which a new athlete accepts before understanding what it grants. It is also not meaningfully different from private on day one, so it buys nothing for #13 while costing clarity. |
| **Obfuscate on read at the instance, upload the true track** | Gives the operator the home address, makes every read path a potential leak, and makes correctness depend on remembering to filter in each of ten places. Decision C strips before upload *and* filters on read. |
| **Trim the first and last *N* seconds instead of a radius** | Distance-based hiding is what the athlete can reason about; a time-based trim hides 200 m on a fast start and 2 km on a slow one. |
| **Destructively trim the track in the local store** | Makes the athlete's own data lossy to protect it from a third party, and makes a mistakenly large zone permanent. The local store keeps the truth. |
| **Automatically applied inferred zones** | Creates and stores "where this person lives" as a derived artefact, and silently protects the wrong place for anyone whose rides do not start at home. Decision B proposes; the athlete confirms. |
| **Strip all values from all error messages** | Buys one class of privacy with every other quantity's debuggability. Decision D is narrow on purpose. |
| **Allow self-recorded fixtures for hard cases** | Reintroduces the exact file the rule exists to keep out, and produces criteria that only their author can discharge. Decision G. |
| **End-to-end encryption of activity data** | Defeats the four functions the instance exists for. See above. |

## Consequences

### What this enables

- #26 can create the schema now: `visibility` `NOT NULL DEFAULT 'private'`, a local-only
  privacy-zone table, and no stored position-derived summary field that a list query selects.
- #29 can build the corpus against a stated, checkable region rule, with the "synthetic or
  self-recorded" ambiguity resolved.
- #34 inherits a boundary list rather than one API response, and #12, #13, #35, #56 and #73 each
  have a named rule and a named test.
- The federation record format (#56, #61) can be fixed knowing that a federated record never
  contains a zone point or a zone definition — which is what makes the Art. 17 exposure survivable.

### What this costs

- **The feed will look empty on day one**, deliberately. #13 must be designed for a product where
  most activities are private, and its emptiness is not a bug to be fixed by changing the default.
- **Published totals differ from the athlete's own totals**, and every place that shows a number has
  to be able to explain why.
- **An instance is not a complete backup.** It holds obfuscated tracks, so an athlete who loses
  their device and had no exports loses the trimmed portions of their rides. This follows directly
  from "strip before upload" and is the price of not handing the operator a home address; the
  mitigation is that export (#35, #51) is a first-class, complete, local function.
- **Enlarging a zone means re-emitting synced activities**, which is real Phase 3 work in #7.
- **A privacy zone is not anonymity**, and the UI carries the burden of saying so without
  frightening anyone out of using it.

### Constraints this places on other work

1. **#26** adds `visibility` (`private` | `followers` | `public`, `NOT NULL`, default `private`) and
   a local-only privacy-zone table, in the Phase 1 **local** schema. It must not add a stored
   `start_lat`/`start_lng` pair that a list query selects.
2. **#29** treats decision G as binding, adopts the three regions in the table, and adds the
   position-region check in the same PR as the first fixture, with a violating fixture proving it
   goes red. "Self-recorded" is not permitted.
3. **#34** enforces on all ten boundaries in decision C, with three-athlete fixtures, asserting on
   payloads. 404 not 403 stands.
4. **#12 / #68** exclude any effort intersecting the owner's zone and publish no coordinate on a
   leaderboard row.
5. **#13 / #80** derive every feed field from the obfuscated track, and are designed for a
   private-by-default population.
6. **#35** enumerates derived artefacts from the schema, purges within the stated windows, and
   delivers exports over an authenticated single-use channel.
7. **#56** carries a signed retraction record, propagates it, and defederates instances that do not
   honour it. #61's record format must make the retraction signable.
8. **#63** must not draw a line across a gap in an emitted track.
9. **#73 / #74** refuse to share a route with an endpoint inside a zone; export a route to a head
   unit whole.
10. **#7** implements strip-before-upload, the sync-setup visibility choice, re-emit on zone
    enlargement, and instance-side enforcement as the second layer.
11. **Every package and app** applies the coordinate-message rule in decision D to new code from
    now; `packages/domain`'s existing guards are brought into line in #104, before the first
    off-device sink exists, and no third-party analytics or crash-reporting SDK ships transmitting
    by default.
12. **#95** declares heart rate and power as health data in the Play Data Safety form and the App
    Store privacy label.

## Notes

- Phase and ownership language follows owner decisions D5 and D6. Nothing in this ADR authorises
  creating `apps/api` or any other server-shaped code in Phase 1.
- Statutory references — Regulation (EU) 2023/2854 Arts. 3–7, Art. 7(1), and the 2026-09-12
  design-by-default date; GDPR Arts. 17 and 20 — are recorded as the inputs to an engineering
  decision. **This is not legal advice.**
- The `packages/domain` message paths in the Context section were read from the committed tree at
  commit `f16f57f` and the semicircle values were computed rather than estimated:
  `1803997218 × 180 / 2^31 = 151.2093°` exactly. The coordinates used as examples anywhere in this
  ADR are public city-centre and open-ocean references — the same London pair `position.ts` already
  documents — and none came from a ride file, which is decision G applied to this file.
