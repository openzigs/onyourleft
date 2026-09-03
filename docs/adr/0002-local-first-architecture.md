# ADR 0002: Local-first architecture, one small self-hostable instance, and why not peer-to-peer

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner — **owner decision D5** (federated local-first, self-hosting
  unconditional, peer-to-peer ruled out) and **owner decision D6** (Phase 1 has no server, no
  account and no network). This ADR does not re-open either; it records the reasoning, the
  measurements and the limits, so that a future reader can argue with the decision instead of
  re-running the research
- **Issue**: [#57](https://github.com/openzigs/onyourleft/issues/57)
- **Supersedes**: nothing
- **Depended on by**: [ADR 0001](0001-licence.md) (self-hosting is unconditional *because* of this
  decision), [ADR 0004](0004-privacy-and-location.md) (cites this decision three times),
  [ADR 0005](0005-tech-stack.md) (the shared/deployment-specific boundary follows from it)
- **Constrains**: [#4](https://github.com/openzigs/onyourleft/issues/4),
  [#6](https://github.com/openzigs/onyourleft/issues/6),
  [#7](https://github.com/openzigs/onyourleft/issues/7),
  [#12](https://github.com/openzigs/onyourleft/issues/12),
  [#16](https://github.com/openzigs/onyourleft/issues/16),
  [#17](https://github.com/openzigs/onyourleft/issues/17),
  [#54](https://github.com/openzigs/onyourleft/issues/54),
  [#56](https://github.com/openzigs/onyourleft/issues/56),
  [#61](https://github.com/openzigs/onyourleft/issues/61), and the phase order in
  [#1](https://github.com/openzigs/onyourleft/issues/1)

> **On the number.** #57's body asks for `0005-local-first-architecture.md`. That number belongs to
> ADR 0005 (tech stack), which merged first. The number is **0002**, settled in
> [#97](https://github.com/openzigs/onyourleft/issues/97) and recorded in
> [`docs/architecture.md`](../architecture.md), because
> [`0001-licence.md:149`](0001-licence.md) and three passages in
> [`0004-privacy-and-location.md`](0004-privacy-and-location.md) already cite this decision as "ADR
> 0002". A citation in a merged document is a fact; an acceptance criterion in an open issue is a
> proposal. #19 renumbered to 0009 for the same reason.

> This ADR is an engineering decision recorded by engineers. It is **not legal advice** — the same
> caveat [ADR 0001](0001-licence.md) and [ADR 0006](0006-fit-codec-licensing.md) carry about
> themselves. The two points where outside expertise would genuinely add value, rather than confirm
> the obvious, are named at the end.

---

## Context

The owner's question was serious and deserves a serious answer: **can this product avoid centralised
hosting entirely — "a Napster model" — so that "free to the end user" is not underwritten by
somebody's credit card?**

It deserves a serious answer because the intuition behind it is correct. Every open project in this
space that stayed cheap stayed cheap by moving state off the centre, and this project has already
committed to consequences that make a central service uncomfortable: AGPL-3.0 forecloses a
closed hosted tier (ADR 0001), there is no CLA, and the payload is the GPS trace of where a named
person lives (ADR 0004). A design that needs a large central operator is a design in tension with
its own licence.

The answer is **no, and the reason is not cost.** Cost was the argument that motivated the question
and it is the weakest of the five reasons below — it runs backwards, which is worth recording
precisely so that nobody re-opens the question the first time a cheaper host appears.

### Why this is decided before there is anything to decide it about

Owner decision D6 is unambiguous: **Phase 1 has no server, no account and no network.** The whole
first milestone runs on one machine. It would be easy to conclude this ADR can wait for Phase 3.

It cannot, for the same reason ADR 0004 could not wait: this decision fixes **the shape of the local
data**, and the local data is being written now.
[#26](https://github.com/openzigs/onyourleft/issues/26) has already created the local schema,
[#61](https://github.com/openzigs/onyourleft/issues/61) puts a signature on every activity in the
v0.1 milestone, and `packages/domain` is already forbidden every platform API because the same code
must later run on an instance. Each of those is cheap now and a migration over a corpus later.
**Nothing in this ADR authorises creating `apps/api` or any other server-shaped code in Phase 1.**

### What the research established

Five findings. Each is recorded with its source, its date and — where it matters — what could **not**
be confirmed. The sources table at the end says which were read first-hand for this ADR and which
are inherited from the program's earlier research record.

#### 1. A browser cannot be a peer, and there is no such thing as WebRTC with zero servers

A browser has no listening socket. It cannot be dialled, it cannot hold a DHT node, and it cannot
accept an inbound connection. WebRTC data channels are the only browser-to-browser transport and
they require an out-of-band SDP exchange that something else must carry: libp2p performs it over a
circuit-relay server, `y-webrtc` requires a signalling server. WebTransport reached Baseline with
Safari 26.4 (March 2026) and is **client-to-server only**, so it does not help.

Every "serverless" design in this space is therefore a design with a server in it that somebody else
is paying for. That is not an objection to P2P on its own — it is the observation that the
zero-infrastructure premise of the question is already false before any measurement is taken.

#### 2. Connection establishment does not scale to a peloton

A 100-rider bunch is **C(100, 2) = 4,950** pairwise `RTCPeerConnection`s, and a peloton is not a
static set: it splits, merges and re-forms, so those connections renegotiate continuously.

The best current measurement of decentralised NAT traversal is Trautwein, Ihle, Schubotz, Breitinger
and Gipp, *Large-Scale Measurement of NAT Traversal for the Decentralized Web: A Case Study of DCUtR
in IPFS*, **arXiv:2604.12484, submitted 2026-04-14, accepted to ACM IMC '26** (Karlsruhe,
2026-10-12/16). It measured **4.4 million traversal attempts from over 85,000 networks across 167
countries** and reports:

> a **conditional success rate of 70% ± 7.1%** for the hole-punching stage

**"Conditional" is the load-bearing word**, and it is the part usually dropped in the retelling. The
paper states that the rate is conditional on relay reservation and public address discovery
succeeding, and that those **themselves fail for approximately 29% of attempts**. So the probability
that an arbitrary pair reaches a direct connection is roughly `0.70 × 0.71 ≈ 0.50`, not 0.70.

Applied to the bunch: of 4,950 legs, **~1,500 fail the hole punch outright, and ~2,490 never get a
direct connection at all** once the prerequisite failures are counted. Every one of those needs a
paid TURN relay, and they all need it in the same ten seconds, because a race starts at a gun. That
is a thundering herd at the start of every event, on the path that has to be up before the event can
begin.

> ⚠️ **A correction this ADR must carry, because the repository's own issue text is wrong.**
> #57 and #56 both reproduce a per-NAT-class table attributed to ProbeLab — Port-Restricted Cone
> 82.9%, full-cone 52%, **symmetric 39.7%**, mapping-unresolved 37.0% — and #16 repeats the 39.7%
> figure. **That table could not be sourced.** The IMC '26 paper explicitly disclaims measuring it:
>
> > "Our measurement architecture observes only the outcome of hole-punch attempts (success or
> > failure), not the internal mapping and filtering behavior of remote NAT devices."
>
> ProbeLab's RFM-15 report (measurement window 2022-12-01 to 2023-01-01) analyses success by
> transport, IP version, geography, relay proximity, VPN use and port-mapping status, and carries no
> NAT-class breakdown either. Searches for the individual percentages returned nothing primary.
> **The numbers are treated here as unsourced and are not relied on.** They are recorded only so
> that the next reader who meets them in an issue body knows they have already been chased.
>
> The decision does not need them. The sourced compound figure — half of all pairs never connect
> directly — is decisive on its own, and it is decisive in the same direction. What the unsourced
> table would have added is the observation that the failures concentrate on mobile-carrier and
> corporate NAT, which for a cycling app is exactly the population you least want to lose. That
> remains a plausible and *unproven* claim, and it is now stated as one.
>
> Iroh (~90%) and Holepunch (~95%) claim materially better rates. ProbeLab states plainly that no
> independent study backs those figures and the Holepunch post is staff-authored. Neither is used
> here.

#### 3. There is a latency floor, and it is set by the slowest rider in the group

Bandwidth is not the objection to a mesh — position state is tiny (see finding 5). Cheat resistance
is. In a bike-racing simulation **the only input is a number the client reports**. There is no
server-side physics check that separates a 6.5 W/kg attack from a fabricated one, because the game
has no other information about the rider. Anti-cheat is therefore not a heuristic problem that a
better model solves; it is an authority problem.

Every P2P scheme that genuinely prevents this is a commit-reveal construction, and commit-reveal
costs round trips. Webb, Soh and Lau's *RACS: A Referee Anti-Cheat Scheme for P2P Gaming* (NOSSDAV
2007, the 17th International Workshop on Network and Operating Systems Support for Digital Audio and
Video, June 2007) states the bound it improves on: the round length is **between 2d and 3d, where d
is the delay between the two slowest players with overlapping areas of interest**.

Two things follow, and the second is the one worth the citation:

1. One rider on a 300 ms link in Australia sets the tick rate for a hundred-rider bunch sprint in
   Belgium. That is not a tuning problem, it is the protocol working correctly.
2. **RACS's own answer is a referee** — a party with authority over game state, which is a server in
   everything but name. The P2P anti-cheat literature's best answer to "how do you prevent cheating
   without a server" is "introduce something that behaves like one". Adopting a referee and then
   calling the result peer-to-peer would be a naming decision, not an architectural one.

The qualifier "with overlapping areas of interest" is retained deliberately: it means interest
management bounds `d` to the group you can actually see, which is a real mitigation and is why the
figure is a floor rather than a catastrophe. It does not remove the floor.

#### 4. A global leaderboard is a global aggregate, and an aggregate needs an aggregator

This is the enumeration argument, and it is the reason the answer is a plain **no** rather than a
cost trade-off. **A leaderboard is a total order over a set you must first enumerate.** In a pure
peer-to-peer network:

- no node has seen every effort on a segment,
- no node can prove that it has, and
- **no peer can distinguish "nobody was faster" from "I have not met the faster rider yet".**

Putting efforts in a DHT does not remove the index cost; it multiplies it by the number of peers, and
it makes forgery free because there is no referee. This is not "hard", it is categorical — it is a
property of what a global aggregate *is*, and no amount of engineering or cheaper hosting touches it.

The precedent is decisive and worth naming because it is the strongest existing counter-example:
**Bluesky / AT Protocol is decentralised in storage and centralised in indexing, on purpose.** The
Relay + AppView exists because a global aggregate needs a global aggregator, and its own designers
concede the indexer is expensive and consolidation-prone (Kleppmann et al., arXiv:2402.03239v2,
2024). Napster, the model the original question invoked, had a **central index** — that is why it
worked, and also why it was suable.

#### 5. The money runs backwards, and the arithmetic is stated so it can be recomputed

This is the weakest of the five and it is included because it was the motivating argument, so it
matters that it fails on its own terms rather than being waved away.

**Assumptions, all stated inline so a reader can recompute rather than trust.** Change any of them
and the numbers move; that is the point of writing them down.

| Assumption | Value | Where it comes from |
|---|---|---|
| Position packet, on the wire | **124 bytes** | 24 B of payload plus ~100 B of UDP/IP/DTLS-SRTP overhead. Reproduces #16's stated ≈94 kbps at 20 riders and ≈491 kbps at 100 |
| Update rate | **5 Hz** | #16 |
| Interest-managed group | **50 riders** base case, 100 as the stress case | #16's ~60–100 ceiling |
| Population | **100,000 MAU**, 4 rides/month, 1 hour each → **400,000 rider-hours/month** | The scale at which the P2P proposal was made |
| Relay price | **$0.05/GB of egress**, first 1,000 GB/month free | Cloudflare Realtime TURN pricing, read 2026-09-03 |
| TURN fallback share | **15%** of legs | The figure the P2P proposal itself used; note finding 2 puts the honest number nearer 50% |
| GB | decimal (10⁹ bytes) throughout | — |

**Mesh, interest-managed to 50.** Each rider sends its own 124-byte packet to 49 peers, five times a
second: `124 × 5 × 49 = 30,380 B/s = 243 kbps` **each way**. Over 400,000 rider-hours that is
**43.7 TB/month** of mesh egress. Relaying 15% of it: **6.56 TB**, less the 1,000 GB free tier, at
$0.05/GB → **≈ $278/month**. At 100-rider groups the same arithmetic gives 88.4 TB, 13.3 TB relayed
and **≈ $613/month**, which is the order of the "~$553/month" figure circulating in #16 and #56.

**Server-authoritative, same group size.** The instance sends each rider **one** packet carrying all
49 neighbours' states: `49 × 24 + 100 = 1,276 B`, five times a second = `6,380 B/s = 51 kbps` down,
and the rider sends `124 × 5 = 620 B/s = 5 kbps` up. Over the same 400,000 rider-hours: **9.2 TB/month
egress** and 0.9 TB inbound.

The result is not the one the cost argument expects:

| | Mesh, group of 50 | Server-authoritative, group of 50 |
|---|---|---|
| Bytes on the wire per rider | 243 kbps up **and** 243 kbps down | 5 kbps up, 51 kbps down |
| Total monthly bytes | 43.7 TB each way | 9.2 TB down, 0.9 TB up |
| Ratio | **≈ 8.7× more bytes** | 1× |
| Marginal cost | ≈ $278/month of TURN | **€0** — inside one VPS's bundled traffic (open question 5) |

**The mesh is not cheaper on bytes. It is roughly nine times more expensive on bytes**, because every
rider re-sends the same 24 bytes 49 times and pays ~100 bytes of header on each copy, where the
server batches 49 states into one packet. And then, having produced more bytes, it pays a *metered*
rate on the fraction it cannot hole-punch — while the server's smaller total sits inside a flat
allowance. It loses on both terms.

So the honest form of the argument is not "P2P costs more than a server". It is: **the mesh loses on
bytes and loses again on billing model, and the axis it was proposed to win on is the one where it
does worst.** A cheaper host in future changes the second term and not the first, which is why this
finding is recorded as the *weakest* of the five and the enumeration argument in finding 4 is the
decisive one.

#### And the argument that would settle it even if all five above were wrong: enforcement

[ADR 0004](0004-privacy-and-location.md) requires privacy zones,
[#34](https://github.com/openzigs/onyourleft/issues/34) requires enforced visibility and
[#35](https://github.com/openzigs/onyourleft/issues/35) requires account data deletion. A CRDT or
P2P history makes all three **unenforceable by construction**: histories are append-only and
replicated to peers nobody controls, so "delete my rides" degrades to "ask the swarm nicely".

For a product whose payload is the GPS trace of where a named person lives and when they leave the
house, that is a defect. Under GDPR Art. 17 it is plausibly a legal one as well — see the open
question below, which this ADR does **not** claim to have solved.

---

## Decision

### A. The deployment unit is **one small self-hostable instance**, and here is its size

Self-hosting is not a courtesy extended to enthusiasts. **It is the deployment model** — ADR 0001
already records that as unconditional and derives it from this decision. An instance is a thing one
person runs for themselves, their club, or a few hundred riders, and the architecture is wrong if it
cannot be.

"Self-hostable" without a number is a wish, so the numbers are fixed here as **design targets that
[#17](https://github.com/openzigs/onyourleft/issues/17) and
[#54](https://github.com/openzigs/onyourleft/issues/54) must measure against**, not as measurements:

| Target | Value | Why this number |
|---|---|---|
| **Reference box** | One ARM VPS, ~4 vCPU / 8 GB RAM / 80 GB SSD, **≈ €21/month**, with bundled traffic in the tens of TB | The class inside which the whole real-time workload was modelled in finding 5. Nothing above needs more |
| **Floor** | The instance starts and serves a **single-athlete or single-club** deployment on ~2 vCPU / 4 GB | The "one person and their mates" case. If the floor is a €21 box, most people will not run one |
| **Deployment** | **One command** — Docker Compose or equivalent — on a clean machine | #54's criterion, which additionally requires it to be run by somebody other than its author |
| **Must not require** | Kubernetes, a managed database, a cloud object store, a CDN account, or **per-request-billed compute** | Each of those is a second bill and a second operator skill. The last is decision H |
| **Storage** | A local disk is sufficient; S3-compatible object storage is an *option* | Per-athlete volume is bounded by #27's measured per-recorded-hour figure and is not restated here |

**Is there a public reference instance, or is self-hosting the only mode?** #1 carries this as an
open question and names #57 as its owner, so it is answered here: **the architecture requires no
reference instance, and this ADR does not create one.** Phase 1 needs no instance at all, and every
row of decision G except the last works without one. Whether *this project* also runs a public
instance is an operations and funding decision for #17 and #54, taken later, revocable, and with no
architectural consequence either way — which is the property that makes it safe to defer. What the
architecture does forbid is a reference instance becoming load-bearing: if the answer is ever yes,
the "leaving costs a re-sync" property in decision D is what has to keep being true.

There is one figure this ADR deliberately does **not** ratify: the **~$28/month at 10,000 MAU / 5%
peak concurrency** serverless model quoted in #16 and #54. It is recorded as an inherited input with
its assumptions, not as this ADR's finding — #54 owns the cost model, and decision H below says what
still has to be settled before any real-time figure is asserted at all.

### B. What is local, what is shared, and where the boundary falls

> **The client owns the data.** Rides are recorded locally, stored locally first, encoded to FIT, and
> signed with the athlete's own key. **The signed file plus its signed summary is the canonical
> artefact.** An athlete with their files needs no server to have their history.

That sentence is the whole architecture, and everything else is a consequence of it.

**Phase 1 is entirely local** (owner decision D6): BLE sensors → recorder → local store → ride
library, charts, map, personal segment comparison. No account, no network, no upload. The point of
this ADR is that **the local shape does not have to change when the instance arrives** — because the
instance receives what the device already produced, rather than the device learning to speak to a
server.

The boundary that makes that true is not the usual client/server split, and
[ADR 0005](0005-tech-stack.md) decision D already records it: the shared packages are not "code the
client and the server happen to both need", they are **everything that is a function of the data
rather than of the deployment** — units, types, validation, signing and verification, segment
matching, analysis. That is why `packages/domain` may depend on **no platform API at all**, not
merely no server API: a package that imports `window` or `fs` cannot run on both sides of a
federation boundary.

What stays deployment-specific is narrow, and it is exactly decision C.

### C. An instance does **four** things, and each later epic depends on a named subset

| # | Responsibility | What it means | Why a peer cannot do it |
|---|---|---|---|
| 1 | **Reachability** | Somewhere with a listening socket that a browser can reach | A browser has no listening socket (finding 1) |
| 2 | **Indexing** | Segment matching across athletes, leaderboards, feeds, search | A global aggregate needs a global aggregator (finding 4) |
| 3 | **Authority** | Real-time race state, plausibility checks on reported power | The only input is a number the client reports (finding 3) |
| 4 | **Enforcement** | Privacy zones, visibility, erasure and retraction | Append-only replication cannot revoke (ADR 0004 decision F) |

**Which epic needs which**, so a reader of #7 or #12 can see why a server appears there and not in
v0.1:

| Epic | 1 Reach | 2 Index | 3 Authority | 4 Enforce | Note |
|---|:--:|:--:|:--:|:--:|---|
| #4 local store, #45 recorder, #61 identity | — | — | — | — | **Phase 1. No instance at all** |
| #6 identity and portability | — | — | — | ○ | Keypair and signing are local; erasure controls need an instance only once data has left |
| #7 instance sync API | ● | ● | — | ● | This is where the instance first exists |
| #12 / #68 segments and leaderboards | ● | ● | — | ● | Cross-athlete ranking is definitionally an index |
| #13 social graph and feed | ● | ● | — | ● | `followers` resolves against a follow graph the instance owns |
| #16 multiplayer | ● | — | ● | ○ | The only epic that needs **authority** |
| #17 / #54 self-hosting and cost | ● | ● | ● | ● | It deploys the instance, so it inherits all four |
| #56 federation | ● | ● | — | ● | Adds the aggregator, which is indexing at one more remove |

● required · ○ partial

### D. Federation: what federates, what does not, and what you take when you leave

**Instances federate over signed records, AT-Protocol-shaped**: an instance publishes a firehose of
signed records, and anyone who wants a cross-instance view runs an aggregator over it. The
alternative — ActivityPub-style server-to-server push — is not chosen, for the reason in finding 4:
the firehose model is the only one of the two that can produce a cross-instance *aggregate* at all.

| Crosses an instance boundary | Never crosses |
|---|---|
| Activities the athlete set to `public`, already obfuscated at emit (ADR 0004 decision C) | Anything `private`, and anything the athlete did not sync |
| The signed activity record: summary, content hash, public key, signature | **Privacy-zone definitions** — never, to any instance, in any phase (ADR 0004 decision B) |
| Signed **retractions**, which a conforming instance honours and propagates | Any point inside a privacy zone |
| Follows and club membership, for cross-instance social features | The athlete's private key, which never leaves the device (#61) |
| | `followers`-scoped activities — that scope resolves against a follow graph the instance owns, so it is *enforced*, not federated |

**What a user takes with them when they leave.** This is the test of whether "you own your data"
means anything, so it is stated as a list rather than a principle:

1. **Everything, always, because they never gave it away.** The canonical copy was on their device
   the whole time. Leaving an instance costs a re-sync, not a migration — which is precisely the
   sentence ADR 0004 relies on when it accepts that a hostile operator can read their own database.
2. **The signed records verify elsewhere.** Instance B accepts instance A's records using only the
   athlete's public key and a published spec, so history survives the move (#56).
3. **What does not survive**: anything the *instance* computed and the athlete never held — an
   instance-wide ranking position, kudos from athletes who stayed. Those are properties of a
   community, not of the athlete's data, and pretending otherwise would be dishonest.
4. **A complete local export exists independently** of any instance, in FIT and GPX plus a JSON
   manifest (ADR 0004 decision E, #35). It is a Phase 1 function, so it works before any instance has
   ever been contacted.

### E. Identity: a device keypair, and why **signing** is what makes data portable

Every athlete gets a keypair on their own device on first run, and every recorded activity becomes a
**signed, content-addressed record** — summary, content hash of the original file, public key,
signature. This lands in the **v0.1 local milestone** (#61), while there are no activities yet,
because retrofitting signatures onto a corpus of unsigned rides is a migration and adding two
functions now is an edit.

**Signing is not export with extra steps, and the difference is the entire claim.**

- An **export** says: here are some bytes we produced. Their meaning depends on trusting the producer.
  "You own your data" then means "you own a copy we could contradict".
- A **signature** says: this summary belongs to this file, and this athlete asserted it — checkable by
  a third party who has never run our code, using nothing but the public key and a published spec.
  A tampered byte fails verification and the verifier can say *which* check failed.

That property is what makes the four things in decision C delegable to an instance the athlete does
not trust very much. An instance is holding a claim it cannot forge and cannot silently alter,
rather than being the system of record. It is also what makes federation possible at all: instance B
can accept instance A's record without trusting instance A, and it is what makes ADR 0004's "leaving
costs nothing but a re-sync" true rather than aspirational.

W3C DID Core is **not** adopted: v1.1 is a Candidate Recommendation Snapshot (2026-03-05), DID
Resolution v1 is a CR Draft (2026-08-28), and `did:key` is a W3C CCG draft at v0.9. A raw keypair
plus signed content-addressed records gets ~95% of the benefit with none of the spec churn. The
curve, the library and the version are **#61's to decide and record**, and the record format may be
marked provisional until #56 breaks down — a format that changes now is an edit, a format that
changes after ten thousand rides is a migration.

### F. **Not peer-to-peer.** Plainly, and on the enumeration argument

> **Can this be pure peer-to-peer? No.**

Not "not yet", not "too expensive today". The binding reason is finding 4: **a global leaderboard is
a total order over a set that must first be enumerated, and no peer can enumerate the network or
prove that it has.** That is a property of the problem, not of the hardware, the protocol or the
price of bandwidth. A cheaper host does not touch it; a better NAT traversal library does not touch
it; a faster network does not touch it.

The four supporting findings — a browser cannot listen, half of all pairs never connect directly,
commit-reveal has a 2d–3d floor, and the money runs backwards — each independently make a mesh a bad
choice for *this* product. The enumeration argument makes it an impossible one for the feature the
product is named after.

**Where P2P remains admissible, so the door is closed in the right place:** direct transfer of a
user's own files between their own devices, on a **native** client, where both endpoints are the
same person and there is nothing to enumerate and nothing to cheat. `iroh` 1.0.3 (Apache-2.0 OR MIT,
1.0 GA 2026-06-15) is the candidate if that is ever built. **Never for leaderboards, never for
racing, never in the browser.** Any issue proposing a WebRTC mesh, a DHT or a browser peer is out of
scope by this ADR and should be closed with a link to it.

*Checked while writing this ADR (2026-09-03):* a grep of all 88 open issues for `WebRTC`, `mesh`,
`DHT`, `peer-to-peer`, `P2P`, `browser peer` and `Napster` returns only #1, #2, #16, #35, #56, #57
and #68. Every one of those passages is **ruling peer-to-peer out** or describing this decision —
#35 cites erasure as the argument against full decentralisation, #68 states that a cross-athlete
leaderboard is not achievable peer-to-peer, #16 and #56 list P2P transports as out of scope, and #1
and #2 record owner decision D5. **No open issue plans a WebRTC mesh, a DHT or a browser peer.**
This discharges #57's last acceptance criterion, and it is a check that has to be re-run rather than
inherited: it is true on the date above and nothing enforces it mechanically.

### G. Leaderboard scope: what is feasible without a central index

This table is normative. **No downstream issue may promise a global all-time KOM**, because the
architecture cannot deliver one without somebody volunteering to run an aggregator.

| Leaderboard scope | Feasible without a central index? | Why |
|---|---|---|
| **Personal bests** | **Yes, fully** | Your data, your device, no coordination. Works in Phase 1 with no network |
| **Friends-only** | **Yes** | A bounded set you already sync with; cost is O(follows) |
| **Club / group** | **Yes** | The club *is* the membership boundary; one member hosts the index |
| **Instance-wide** | **Yes** | An instance is a server. Rank everyone on it |
| **Cross-instance (federated)** | **Only over instances that federate with you** | Bounded by who publishes a firehose you consume — not by the size of the network |
| **Global all-time KOM** | **No** | Requires whole-network enumeration plus a referee. Finding 4 |

**Global leaderboards exist here if and only if somebody volunteers to run an aggregator.** That can
be this project, a sponsor, or nobody, and **the product does not break in the third case** — every
row above except the last still works. #12 and #68 must be designed so that the aggregator is
switchable off, and #56 already carries the acceptance criterion that proves it.

### H. The "unbounded cost" claim is **retracted**, and replaced

> **Retracted:** *"real-time multiplayer is the one genuinely unbounded cost in this program."*
>
> **Replaced with:** *real-time multiplayer is unbounded on **per-request serverless billing** and
> bounded and cheap otherwise. The risk is a **platform-choice risk, not a physics risk**, and the
> mitigation is one sentence: **do not run always-on state on per-request-billed infrastructure.***

The issues corrected are **[#16](https://github.com/openzigs/onyourleft/issues/16)**,
**[#17](https://github.com/openzigs/onyourleft/issues/17)** and
**[#54](https://github.com/openzigs/onyourleft/issues/54)**. All three already carry the retraction
in their revision blocks, which supersede their bodies; #54's body table still shows the old
"Unbounded and unmodelled" row beneath its own retraction, and #54 owns fixing that when it writes
`docs/cost-model.md`.

The evidence for the retraction: Cloudflare's own documentation prices **10,000 hibernatable
WebSockets at 1 msg/s at $419.30/month**, and hibernation does not help a continuously ticking
physics simulation, which never qualifies as idle. The identical workload fits inside the ≈€21/month
box in decision A. Two orders of magnitude, from a billing model rather than from any property of
the workload.

#### The open question this ADR can partly close, and the part it cannot

#16 records "the single most expensive unknown in the whole program": whether a serverless platform
bills **outbound broadcast** WebSocket messages or only inbound. For a broadcast-heavy simulation
that is a factor of ~N per room and would move ~$28/month to potentially ~$500/month at 50-rider
rooms.

**Read from Cloudflare's Durable Objects pricing documentation on 2026-09-03:**

> "There is no charge for outgoing WebSocket messages, nor for incoming WebSocket protocol pings"

and, for inbound:

> "For compute requests billing-only, a 20:1 ratio is applied to incoming WebSocket messages to
> factor in smaller messages for real-time communication."

**On the published rate card, for that platform and that product, outbound broadcast is not billed.**
That removes the ~$500/month tail on the specific platform where it was raised, and it is a better
answer than "unknown".

**It is not the whole answer, and #16's breakdown trigger should not be ticked on this paragraph
alone.** Three things remain:

1. **A rate card is not an invoice.** #54's criterion is a *billing test*, and it should still be run.
   One room, one known message count, one bill.
2. **Duration billing is untouched by this finding.** A continuously ticking simulation never
   hibernates, so it accrues wall-clock duration charges for as long as the ride lasts — which is the
   cost line that actually scales with concurrency on that platform.
3. **It says nothing about any other platform.** The mitigation sentence above is the general answer;
   this finding is one vendor's current wording.

**#54 must not assert a real-time cost figure until 1 and 2 are settled**, which is unchanged from
#16's position and is restated here so the correction does not read as permission.

---

## What this architecture does **not** give you

Stated plainly, because an implied guarantee is worse than a named gap, and because the honest
version of this ADR is worth more than the confident one.

- **Cross-instance leaderboards are bounded by who federates with you**, not by who uses the
  software. Two instances that never exchange firehoses have no shared ranking, and there is no
  discovery mechanism that fixes that. A global view requires an aggregator and an aggregator
  requires a funder. Decision G.
- **A hostile — or merely curious — instance operator can read their own database.** There is no
  access-control answer to that and encryption at rest is not one either, since the operator holds
  the keys. The defence is **minimisation, not secrecy**: the instance is never sent a zone
  definition, never sent a point inside a zone, and never sent an activity the athlete did not choose
  to sync. So the operator learns where the athlete *rides*, not where they *live*. ADR 0004 argues
  this at length and this ADR does not soften it.
- **"Delete" means something specific once a record is signed and copied elsewhere**, and this ADR is
  bound by [ADR 0004 decision F](0004-privacy-and-location.md) rather than reopening it. Locally,
  delete means **purge, not tombstone**. On your own instance, it means removal from the live store
  immediately and from every derived artefact within 7 days. **Across a federation it is a request**:
  the protocol carries a signed retraction, a conforming instance honours and propagates it, and an
  instance that does not is defederated — enforcement that is social rather than technical. The truth
  is told **at publish time, not at delete time**. Consent obtained after the copy is not consent.
- **There is no end-to-end encryption, and this ADR does not leave the door open for it.** All four
  responsibilities in decision C require reading the data. E2EE would defeat all four and produce an
  instance that can only store blobs, which is a different product.
- **Losing the device and the key is losing something.** The canonical copy being local means local
  loss is real loss for anything never synced or exported. #61 owes a *documented* key-loss and
  key-rotation behaviour with a stated consequence; an unanswered key-loss story becomes an
  unanswered support ticket.
- **An instance is not a backup.** It holds obfuscated tracks, so an athlete who loses their device
  and had no exports loses the trimmed portions of their rides. This follows directly from ADR 0004's
  strip-before-upload rule and is the price of not handing an operator a home address.
- **Self-hosting is not free.** It is ≈€21/month and somebody's evenings. "Anyone can run one" is a
  statement about permission and difficulty, not about cost being zero. #54's honest README sentence
  applies: not "free", but "free to you; here is who pays and how".
- **This is more work than one hosted service.** A signed record format, a firehose, verification on
  both sides and an optional aggregator are all things a single central database would not need. The
  cost is paid to get the property in decision D, and it should be paid consciously.

---

## Open questions

Recorded as open, with an owner. None of these is solved by this ADR and none may be cited as though
it were.

1. **How does erasure work in a federated, signed, append-only world?** **Owned by
   [#56](https://github.com/openzigs/onyourleft/issues/56)**, and it must be answered **before the
   record format is chosen**, because the answer changes the format. ADR 0004 decision F states the
   mitigation this project relies on — minimisation, so that the thing which cannot reliably be
   recalled is not the thing that names a home — and states plainly that signed retraction plus
   defederation is social enforcement, not a guarantee. **The GDPR Art. 17 exposure is real, it is
   mitigated rather than removed, and calling it solved would be the most consequential lie this
   product could tell.**
2. **What does a whole-network index actually cost?** Sources found during planning disagree by
   **30×** (a Hacker News comment at ~$300/month for a Bluesky AppView; a vendor marketing page at
   $3,000–$10,000/month). Neither is primary. **Owned by #56**: benchmark a segment-effort index at a
   realistic corpus size before promising a global leaderboard to anybody.
3. **The real-time billing test**, per decision H items 1 and 2. **Owned by #16 (the test) and #54
   (the model).**
4. **Signature curve and record format finality** — Ed25519 versus secp256k1 Schnorr, and whether the
   format is provisional until #56 breaks down.
   **Owned by [#61](https://github.com/openzigs/onyourleft/issues/61).**
5. **The reference-box price and its bundled traffic allowance were not re-read for this ADR.** The
   ≈€21/month figure is inherited from #54's research record (read 2026-09-02, post-15-June-2026
   Hetzner pricing, ARM CAX line); two attempts to re-read the vendor's pages on 2026-09-03 returned
   pages that do not carry that line. **The conclusion does not depend on the exact figure** — it
   depends only on the ratio between bundled traffic and $0.05/GB metered, which is two orders of
   magnitude. **#54 owns re-reading it.**

### Where outside expertise would genuinely help

Named specifically, in the style ADR 0006 uses, so that a review is a short question rather than a
research project. **These are not requests for confirmation of the obvious.**

1. **Under GDPR, who is the controller for a federated record?** When athlete A on instance X
   publishes a signed record that instance Y ingests through a firehose, is Y a controller, a joint
   controller, or a processor — and does the answer change if Y is a hobbyist running a club instance
   in their spare time? This determines whether the retraction mechanism in ADR 0004 decision F is
   an adequate Art. 17 response or merely a good-faith one, and it is the question in open question 1.
2. **Does an aggregator that indexes public records from instances it does not operate acquire
   obligations that an instance does not?** It holds a copy of everything public, from operators who
   never agreed to anything with it. If the answer is yes, "anyone may run an aggregator" is a
   sentence with a liability attached, and #56 needs to say so before it invites anyone to.

---

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Pure peer-to-peer / "the Napster model"** | Cannot produce a global leaderboard at all (finding 4); a browser cannot be a peer (finding 1); half of pairs never connect directly (finding 2); cheat prevention has a 2d–3d latency floor (finding 3); costs ~9× the bytes and pays a metered rate on them (finding 5); and makes privacy zones, visibility and erasure unenforceable by construction. **Six independent reasons, of which the cheapest to fix is the money** |
| **CRDT-replicated history (Automerge / Yjs shape)** | Append-only replication to peers you do not control makes ADR 0004's decisions A, C and F unenforceable. "Delete my rides" becomes "ask the swarm nicely" for data that names where somebody lives |
| **WebRTC mesh with a TURN fallback** | Finding 5. Pays for more bytes *and* pays a metered rate on the fraction it cannot punch, and still has no referee, so #16's own anti-cheat criterion remains unsatisfiable |
| **One central multi-tenant service** | Contradicts ADR 0001, which forecloses a closed hosted tier and makes self-hosting unconditional; makes the operator the system of record, which is the design the EU Data Act cuts against (ADR 0004 decision E); and makes "free" depend on one credit card, which is the question that started this |
| **ActivityPub-style server-to-server push federation** | Cannot produce a cross-instance aggregate, which is most of what federation is wanted for here. The firehose model can. #56 |
| **Blockchain, token or ledger anything** | Adds a consensus cost to a problem with no double-spend, and makes erasure strictly harder than the append-only case that is already the hardest open question |
| **Adopt W3C DID Core for identity** | v1.1 is a Candidate Recommendation Snapshot (2026-03-05) and `did:key` is a CCG draft at v0.9. A raw keypair plus signed content-addressed records gets ~95% of it with none of the spec churn |
| **Defer the whole decision to Phase 3, when a server first exists** | The local schema (#26), the signature (#61) and `packages/domain`'s platform-freedom are all being fixed *now*. Deferring makes each of them a migration instead of an edit |
| **P2P for own-device-to-own-device file transfer, on a native client** | **Not rejected** — see decision F. It is the one place the objections do not apply, and it is explicitly out of scope for this ADR rather than ruled out by it |

---

## Consequences

### What this enables

- **#7 knows what it is building**: the sync surface of one small self-hostable instance doing four
  named things — not a multi-tenant hosted API. Its ingestion becomes "accept, verify and index a
  signed bundle" rather than "receive a file and do all the work".
- **#61 can land in the v0.1 milestone**, because the reason for signing is now recorded rather than
  assumed, and because decision E states what the signature buys that an export does not.
- **#56 has a shape** — firehose plus optional aggregator — and a stated open question it must answer
  before choosing a record format, rather than discovering it during breakdown.
- **#12, #13 and #68 can be designed against decision G**, so nothing promises a global KOM.
- **#16 keeps its anti-cheat acceptance criterion**, which was unsatisfiable under any P2P design.
- **The four existing "ADR 0002" citations now resolve to a document.** `0001-licence.md:149` and
  three passages in `0004-privacy-and-location.md` pointed at a decision that existed only as issue
  text, and ADR 0005 depended on it by issue number. That is the reason the number could not move.
- **#1's open question 2 is answered.** "No central server" was shorthand for *no lock-in, cheap, and
  the user owns the data*. This architecture delivers all three — decision D for lock-in, decision A
  for cheap, decision B for ownership — so **no P2P work is needed** and Phase 3 can be scheduled
  without it. #1's open question 1 is answered in decision A.

### What this costs

- **More moving parts than a central service** — signed records, verification on both sides, a
  firehose, an optional aggregator. Paid deliberately for decision D.
- **A global leaderboard is conditional on a volunteer**, and always will be. Decision G.
- **A hostile operator is not defended against by access control**, only by minimisation. ADR 0004.
- **Federated erasure is a request, not a guarantee** — mitigated, not solved. Open question 1.
- **Everything about an instance is Phase 3 work** that Phase 1 must not anticipate by scaffolding.

### Constraints this places on other work

1. **No `apps/api` and nothing server-shaped in Phase 1.** Owner decision D6, restated because this
   ADR describes a server at length and that is exactly the reading to forbid.
2. **#7** builds the four responsibilities in decision C and nothing else. It implements ADR 0004's
   strip-before-upload as the client-side layer and instance-side enforcement as the second.
3. **#61** decides and records the curve, the library and the version; documents key rotation and key
   loss with a stated consequence; and keeps the record free of any location field, so publishing a
   record can never be the thing that leaks a home address.
4. **#56** answers open question 1 before choosing the record format, carries a signed retraction that
   instances propagate, defederates instances that do not honour it, and keeps the aggregator
   switchable off with a test that proves instance-scoped leaderboards still serve without it.
5. **#12 / #68** implement only the feasible rows of decision G. No global all-time KOM.
6. **#16** stays server-authoritative and interest-managed to ~60–100 nearby riders; adds no
   peer-to-peer transport, DHT or browser peer; and runs the billing test in decision H before #54
   uses its number.
7. **#17 / #54** measure the instance against decision A's targets — one command, one box, no managed
   services, no per-request-billed compute — and assert no real-time cost figure until decision H
   items 1 and 2 are settled. #54 also owns removing the stale "Unbounded and unmodelled" row from
   its own body.
8. **`packages/domain` stays free of every platform API**, not merely of server APIs, because the same
   code signs on a phone and verifies on an instance. Already enforced by `eslint.config.js` and by
   `packages/domain/tsconfig.json`; decision B is the reason it is enforced rather than requested.
9. **Any new issue proposing a WebRTC mesh, a DHT or a browser peer is out of scope by decision F**
   and should be closed with a link to it rather than debated again.

---

## Sources

Read first-hand for this ADR on **2026-09-03** unless stated otherwise.

| Claim | Source | Read |
|---|---|---|
| 70% ± 7.1% **conditional** hole-punch success; 4.4M attempts, 85k networks, 167 countries; ~29% fail before the hole punch; NAT class **not** observed | Trautwein, Ihle, Schubotz, Breitinger, Gipp, *Large-Scale Measurement of NAT Traversal for the Decentralized Web: A Case Study of DCUtR in IPFS*, **arXiv:2604.12484**, submitted 2026-04-14, accepted ACM IMC '26 | 2026-09-03 |
| Same 70% ± 7.1% figure, earlier preprint | Trautwein, Ihle, Schubotz, Gipp, *Challenging Tribal Knowledge — Large Scale Measurement Campaign on Decentralized NAT Traversal*, **arXiv:2510.27500**, submitted 2025-10-31 | 2026-09-03 |
| No per-NAT-class breakdown exists in the ProbeLab measurement report either | ProbeLab RFM-15, *NAT Hole Punching*, measurement window 2022-12-01 → 2023-01-01 | 2026-09-03 |
| Lockstep round length **between 2d and 3d**, d = delay of the two slowest players with overlapping areas of interest; the fix is a **referee** | Webb, Soh, Lau, *RACS: A Referee Anti-Cheat Scheme for P2P Gaming*, NOSSDAV 2007 (17th Intl. Workshop, June 2007) | 2026-09-03 |
| TURN relay **$0.05/GB egress**, first 1,000 GB free (shared with SFU) | Cloudflare Realtime pricing documentation | 2026-09-03 |
| **"There is no charge for outgoing WebSocket messages"**; 20:1 ratio on incoming for compute-request billing; hibernation reduces *duration*, not request charges | Cloudflare Durable Objects pricing documentation | 2026-09-03 |
| Decentralised storage, centralised indexing; the indexer is expensive and consolidation-prone | Kleppmann et al., *Bluesky and the AT Protocol*, arXiv:2402.03239v2, 2024 | inherited from #56's research record |
| 10,000 hibernatable WebSockets at 1 msg/s ≈ **$419.30/month**; ~$28/month at 10k MAU / 5% concurrency | #16 and #54 research records | inherited, 2026-09-02 |
| Reference box ≈ **€20.99/month** ARM VPS and its bundled traffic | #54 research record, post-15-June-2026 pricing | inherited, 2026-09-02 — **not re-verified**, open question 5 |
| Zwift caps rendering at ~100 nearest riders | Community forum threads, directionally corroborated across five | inherited — **not an engineering document** |
| `iroh` 1.0.3, Apache-2.0 OR MIT, 1.0 GA 2026-06-15 | #57 research record | inherited |

## Notes

- Every arithmetic result in finding 5 was computed rather than quoted, from the assumptions in the
  table above it, and each intermediate is shown so a reader can recompute rather than trust. Where
  the result differs from a figure circulating in the issue tracker — ≈$278/month at 50-rider groups
  against the ≈$553/month in #16 and #56 — the difference is the group size and the rider-hours
  assumption, which is precisely why #57 required the assumptions to be stated inline.
- The per-NAT-class success table in #57, #56 and #16 is **unsourced**, and the primary paper
  disclaims measuring it. It is not relied on anywhere above. This is recorded rather than quietly
  dropped, because the next person to read those issue bodies will meet the numbers again.
- Phase and ownership language follows owner decisions D5 and D6. **Nothing here authorises creating
  `apps/api` or any other server-shaped code in Phase 1.**
- Not legal advice, as stated at the top. The two questions where a lawyer adds value rather than
  confirms the obvious are named under "Where outside expertise would genuinely help"; ADR 0001 and
  ADR 0006 each name their own pair in the same form.
