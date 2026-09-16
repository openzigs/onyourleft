# The cost model: what "free to the end user" costs, and who pays it

- **Owner**: [#54](https://github.com/openzigs/onyourleft/issues/54), under epic
  [#17](https://github.com/openzigs/onyourleft/issues/17)
- **Inputs last read**: 2026-09-15. Each one carries its own date and provenance below
- **Checked by**: `pnpm run check:cost-model`, which recomputes every figure here from the inputs
  here and fails the build when the two disagree. CLAUDE.md §4l

"Free to the end user" is a promise that somebody else pays. This document makes the size of that
somebody's bill known, per athlete, before it is a surprise — and says, line by line, which of its
numbers were **measured**, which were **read off a vendor's page**, and which are **guesses**.

---

## What this is not

Stated first, because every sentence below is easier to over-read than to read.

- **It is not a bill.** No traffic has been served, no archive has been published
  ([#53](https://github.com/openzigs/onyourleft/issues/53)) and no invoice exists. Every dollar here
  is arithmetic over published rates.
- **It is not a real-time cost figure.** [ADR 0002](adr/0002-local-first-architecture.md) decision H
  forbids asserting one until a billing test has been run, and it has not been. See
  *[Unmodelled risk](#unmodelled-risk-real-time-compute-16)* — that section is the reason this
  document exists at all, not an appendix to it.
- **It is not a deployment.** There is no server in Phase 1 (owner decision D6) and there is nothing
  here to deploy. What self-hosting costs is modelled; *packaging* it is
  [#52](https://github.com/openzigs/onyourleft/issues/52). See
  *[Self-hosting](#self-hosting-what-it-costs-and-what-is-not-built)*.
- **It is not stable.** Two of its inputs are moving as this is written: the Protomaps planet build
  grew **103.0 MB in the four days to 2026-09-15**, and Verisign has announced a `.com` wholesale
  rise effective **2026-11-01**. The gate exists because of that, not in spite of it.

---

## The scope question, answered

[#54](https://github.com/openzigs/onyourleft/issues/54)'s revision block asks this to be settled
explicitly rather than left to a reader's assumption:

> *Is "cost per 1,000 MAU" infrastructure-only, or fully loaded including domains, error tracking,
> email and payment processing?*

**The headline figure is infrastructure-only, and the fully-loaded figure is stated beside it.**
Both are rows in the projection, so neither can be quoted without the other being one line away.

They differ by **$0.86 a month**, which is the answer's most useful part: at this architecture's
scale everything a "fully loaded" reading adds is either zero or absorbed by a box that is already
running. Only one extra is real, and it is the domain name.

**Payment processing is deliberately not a per-MAU line**, because it is not a function of MAU. It
is a function of how a supporter chooses to give, and it is material at small amounts — see
*[What it costs to be given ten dollars](#what-it-costs-to-be-given-ten-dollars)*.

---

## Inputs

Every figure the model reads. The **confidence** column is the point of the table: a cost model is
only as good as the provenance of its premises, and `check-cost-model` fails the build on an input
that has none.

| Word | Means |
| --- | --- |
| **measured** | produced by something that ran — a test in this repository, or a tool against a live endpoint, on the date given |
| **read** | read off the vendor's own page on the date given |
| **inherited** | carried from an earlier research record or ADR without being re-read here |
| **inferred** | nobody has measured it. A guess, flagged as one |

<!-- cost-model:inputs -->

| Input | Value | Unit | Provenance | Confidence |
| --- | --- | --- | --- | --- |
| `r` | 4 | rides per active per month | [ADR 0002](adr/0002-local-first-architecture.md) finding 5's population assumption | inherited |
| `d` | 1 | recorded hours per ride | [ADR 0002](adr/0002-local-first-architecture.md) finding 5's population assumption | inherited |
| `b` | 22,691 | bytes stored per recorded hour | **Measured** by `packages/store/src/stream-store.test.ts`, printed as `[#27]`; recorded in [ADR 0011](adr/0011-stream-storage.md) | measured |
| `m` | 12 | months of accumulation modelled | This model's own choice: the twelfth month's bill for a cohort that all rode all year — an upper bound, not an average | inferred |
| `L` | 30 | map loads per active per month | ⚠️ **The softest number here.** [ADR 0010](adr/0010-map-tiles-and-routing.md)'s cost model records it as inferred and unsourced | inferred |
| `T` | 15 | tile requests per map load | [ADR 0010](adr/0010-map-tiles-and-routing.md), inherited from #60; also unsourced | inherited |
| `h` | 0.5 | CDN cache hit rate, as a share | Protomaps' cost calculator default. Conservative — a real basemap caches far better | read |
| `s` | 70,000 | bytes, average tile | [ADR 0010](adr/0010-map-tiles-and-routing.md), inherited from #60 | inherited |
| `S` | 138,031,484,053 | bytes, basemap archive | **Measured** 2026-09-15 from `build-metadata.protomaps.dev/builds.json`, build `20260915`, b3sum `ba618b53…` | measured |
| `p_storage` | 0.015 | USD per GB-month | Cloudflare R2 Standard storage, `developers.cloudflare.com/r2/pricing/` (page dated 2026-08-07), read 2026-09-15 | read |
| `p_classB` | 0.36 | USD per million Class B requests | Same page, read 2026-09-15 | read |
| `p_egress` | 0.00 | USD per GB egress | Same page, read 2026-09-15: R2 egress is free | read |
| `box_eur` | 20.99 | EUR per month, the reference instance | ⚠️ [ADR 0002](adr/0002-local-first-architecture.md) decision A's Hetzner CAX31. **Thrice unverified** — see the note under the projection | inherited |
| `fx` | 1.1539 | USD per EUR | ECB reference rate for 2026-09-15, via `api.frankfurter.dev` | read |
| `domain_usd_year` | 10.26 | USD per year | Verisign `.com` wholesale, secondary sources read 2026-09-15. Excludes ICANN's per-transaction fee and any registrar margin, so it is a floor. Rises to $10.97 on 2026-11-01 | read |
| `email_usd_month` | 0.00 | USD per month | On the box, per [ADR 0002](adr/0002-local-first-architecture.md) decision A's "must not require a managed service". The cost is deliverability, not money — see the note under the projection | inherited |
| `errors_usd_month` | 0.00 | USD per month | Same: on the box | inherited |
| `fee_rate` | 0.029 | share of the transaction | Stripe US standard domestic card rate, `stripe.com/pricing`, read 2026-09-15 | read |
| `fee_fixed` | 0.30 | USD per transaction | Same page, read 2026-09-15 | read |
| `support_usd_year` | 48.00 | USD per year, one supporter's gift | Illustrative. Chosen as $4/month because that is the size at which a fixed per-transaction fee starts to hurt | inferred |

---

## What it costs

All figures are **US dollars per month** except the last, which is **US cents per athlete per
year** — dollars at two decimal places round that row to `$0.00` at two of the three scales, which
is how a headline claim becomes unfalsifiable by accident.

**Free tiers are excluded from every total**, per #17's rule that a free tier is a discount and not
a plan. R2's is not small — 10 GB-month of storage, 1 M Class A and 10 M Class B requests — and
including it would make the basemap line read $0.00 at every scale here while teaching nothing about
what happens when it is exceeded.

<!-- cost-model:projection -->

| Line item | 1,000 MAU | 10,000 MAU | 100,000 MAU |
| --- | --- | --- | --- |
| Instance (one box) | $24.22 | $24.22 | $24.22 |
| Basemap archive storage | $2.07 | $2.07 | $2.07 |
| Basemap tile requests | $0.08 | $0.81 | $8.10 |
| Basemap egress | $0.00 | $0.00 | $0.00 |
| Activity streams (object storage) | $0.02 | $0.16 | $1.63 |
| Infrastructure subtotal | $26.39 | $27.26 | $36.02 |
| Infrastructure, per 1,000 MAU | $26.39 | $2.73 | $0.36 |
| Domain name | $0.86 | $0.86 | $0.86 |
| Transactional email | $0.00 | $0.00 | $0.00 |
| Error tracking | $0.00 | $0.00 | $0.00 |
| Fully loaded total | $27.24 | $28.12 | $36.88 |
| Fully loaded, per 1,000 MAU | $27.24 | $2.81 | $0.37 |
| Fully loaded, US cents per athlete per year | 32.69 | 3.37 | 0.44 |
| Dominant line item | Instance (one box) | Instance (one box) | Instance (one box) |
| Second-largest line item | Basemap archive storage | Basemap archive storage | Basemap tile requests |

⚠️ **The instance line is the model's second-softest number and the one it turns on.**
[ADR 0002](adr/0002-local-first-architecture.md) open question 5 records two failed attempts to
re-read Hetzner's published CAX price on 2026-09-03 and gives this issue the job of re-reading it.
**A third attempt was made on 2026-09-15 and failed the same way**: `hetzner.com/cloud` was fetched
in full (163,764 bytes) and contains **zero occurrences of `CAX\d\d` and zero price strings at all**
— the page renders its price matrix client-side. Secondary sources disagree with each other, which
[#52](https://github.com/openzigs/onyourleft/issues/52)'s revision block already warned they would:
€12.49/month is reported for February 2026, a June 2026 adjustment of roughly 1.3–1.4× on the CAX
line, and a September 2026 range of €19.49–129.99 across the whole line. **€20.99 is inherited and
must not be quoted as read.** What does not depend on it is stated under
*[What would make this wrong](#what-would-make-this-wrong)*.

⚠️ **The transactional-email and error-tracking zeros are architectural, not free lunches.** They
are zero because [ADR 0002](adr/0002-local-first-architecture.md) decision A forbids requiring a
managed service, so both run on a box that is already paid for. Email in particular buys that zero
with **deliverability** rather than money: a self-hosted sender on a cloud provider's address space
is the harder half of that problem, and no part of it is measured here.

---

## Reading it

### The box is the whole bill, at every scale modelled

The dominant line item is the instance at 1,000, 10,000 **and** 100,000 monthly actives — 92%, 86%
and 66% of the fully-loaded total. #54's second criterion asks that the next thing to optimise be
known in advance rather than discovered, and the answer is blunt: **it is never the tiles and never
the streams. It is whether one box still serves.**

That reframes the question this model should be asked. Not *"what does the storage cost?"* — $2.07 a
month, and it barely moves — but *"at what population does one box stop being enough?"* **Nobody has
measured that**, and it is this model's largest uncertainty. Three things bound it, none of them a
measurement:

- **Bytes**: [ADR 0002](adr/0002-local-first-architecture.md) finding 5 puts the server-authoritative
  real-time workload at 100,000 MAU inside a single box's bundled traffic — 9.2 TB down and 0.9 TB
  up per month. That is an arithmetic bound on *bandwidth*, and it says nothing about CPU.
- **Disk**: at `b` = 22,691 bytes per recorded hour, one athlete-year of `r` × `d` riding is
  1,089,168 bytes. The reference box's 80 GB SSD therefore holds about **73,000 athlete-years** of
  streams before it holds nothing else — ignoring the operating system, the database, its indexes
  and every other row, so read it as a ceiling rather than a capacity. At 10,000 MAU that is seven
  years; at 100,000 it is nine months.
- **Indexing**: [ADR 0002](adr/0002-local-first-architecture.md) open question 2 records that the
  sources found for what a whole-network index costs disagree by **30×**, and neither is primary.
  Cross-athlete segment matching at 100,000 actives is not modelled here and must not be read out
  of the $24.22.

### The second-largest line changes, and where it changes is a guess

Basemap **archive storage** is second at 1,000 and 10,000 actives; basemap **tile requests** take
over at 100,000. The crossover is at **25,561 monthly actives** on the stated inputs — derived by
`node scripts/check-cost-model.mjs --print`, and the one figure in this document that the gate does
not check, because it is prose.

It is also almost entirely a statement about `L`. Archive storage does not depend on `L` at all;
tile requests are linear in it. Double `L` and the crossover halves. That asymmetry is the practical
form of [ADR 0010](adr/0010-map-tiles-and-routing.md) D-1's argument for the R2 shape: **what
survives a wrong `L` is the ordering, not the total**, because the dominant term on this platform is
one that `L` does not reach.

### The per-athlete figure, and the sentence it licenses

At 10,000 monthly actives the fully-loaded infrastructure costs **3.37 US cents per athlete per
year**. At 100,000 it is **0.44 cents**. At 1,000 it is **32.69 cents**, because a fixed box divided
by a small population is a large number — the per-athlete cost of this architecture falls with scale
for exactly one reason, and it is that the box does not get bigger.

That is what licenses the honest sentence, and it is not "free":

> **Free to you. It costs somebody a few cents a year — and here is who, and how.**

---

## Line by line

### Instance — one box

[ADR 0002](adr/0002-local-first-architecture.md) decision A: one ARM VPS, ~4 vCPU / 8 GB / 80 GB
SSD, with bundled traffic in the tens of TB; a floor of ~2 vCPU / 4 GB for a single-athlete or
single-club deployment. **No Kubernetes, no managed database, no cloud object store, no CDN account
and — decision H — no per-request-billed compute.** Every one of those is a second bill and a second
operator skill.

One box at all three scales is a modelling choice inherited from that ADR, and it is the assumption
most likely to be wrong first. See the three bounds above.

### Basemap — archive storage

`S` × `p_storage`. The archive is **immutable** ([ADR 0010](adr/0010-map-tiles-and-routing.md) D-3):
a refresh is a whole-file upload and a repointed URL, not a mutation, so the steady-state cost is
storage and the refresh cost is a transfer plus a few days of double storage.

⚠️ **The archive is 138.0 GB, not the ~120 GB / ~110 GB [ADR 0010](adr/0010-map-tiles-and-routing.md)
D-3 states**, and it is growing. Five consecutive daily builds read from
`build-metadata.protomaps.dev/builds.json` on 2026-09-15:

| Build | Bytes |
| --- | --- |
| `20260911` | 137,928,448,540 |
| `20260912` | 137,965,007,992 |
| `20260913` | 137,999,059,691 |
| `20260914` | 138,013,553,034 |
| `20260915` | 138,031,484,053 |

**+103.0 MB over four days — about 25.8 MB a day.** A cost model that hard-codes any single archive
size is wrong by construction, which is why `S` is an input with a date on it rather than a constant
in a script. ADR 0010 carries a dated amendment recording that its D-3 figure has drifted.

**A regional archive is much smaller, and the zoom cap is the lever.** Measured with
`pmtiles extract --dry-run` against the same build over the continental US
(`-125,24,-66,50`): **4.3 GB at z13, 9.0 GB at z14, 19 GB at z15** — roughly a doubling per zoom
level. The z14→z15 step alone decides whether a regional deployment sits inside R2's 10 GB free
tier. The model is stated at the planet size because that is the conservative choice; a self-hoster
serving one country pays a fifteenth of the storage line.

### Basemap — tile requests and egress

Requests: `A` × `L` × `T` × (1 − `h`) origin reads, at `p_classB`. Egress: `A` × `L` × `T` × `s`
bytes, at `p_egress`.

**The egress line is $0.00 because the rate is zero, not because the volume is.** At 10,000 actives
it is **315 GB a month**. On a platform that meters egress at $0.10/GB that same row reads $31.50,
which is [ADR 0010](adr/0010-map-tiles-and-routing.md) D-2's whole argument in one cell. It is kept
in the table at $0.00 rather than deleted for exactly that reason: a line item that disappears when
it is cheap cannot warn anybody when it stops being.

### Activity streams

`A` × `r` × `d` × `b` × `m` bytes held after twelve months, at `p_storage`.

⚠️ **This row prices the shape the architecture did not choose.**
[ADR 0002](adr/0002-local-first-architecture.md) decision A says a local disk is sufficient and
S3-compatible object storage is an *option*. On the chosen shape these bytes sit on the box's own
SSD and cost nothing marginal — the disk bound above is the real constraint, not this row. It is
priced anyway so that an operator who does put streams in a bucket has the figure, and so that the
per-athlete total is not quietly missing a line.

The measurement underneath it is the strongest number in this document: a four-hour, 1 Hz,
eight-channel ride packs to 244,800 B and stores, after `deflate-raw`, as **90,763 B** — 22,691 B
per recorded hour, at a 2.70× compression ratio, asserted against the `encodedBytes` the summary row
records so the number reported and the number on disk cannot drift. Re-run it with
`pnpm --filter @onyourleft/store run test`.

### Domain, email, error tracking

The domain is the only one that is money. The other two are zero because they run on the box, and
the note under the projection says what that zero actually buys.

---

## Unmodelled risk: real-time compute (#16)

This section is #54's fourth acceptance criterion, and it is the one line item that could make the
free promise unsustainable.

### The claim this issue's own body still carries is retracted

[#54](https://github.com/openzigs/onyourleft/issues/54)'s *Reference figures* table reads:

> | **Real-time multiplayer (#16)** | **Unbounded and unmodelled.** Always-on, scales with
> concurrent riders, not serverless-friendly |

That row is **wrong** and its own revision block already says so.
[ADR 0002](adr/0002-local-first-architecture.md) decision H names fixing it here rather than editing
another issue's body from a documentation change, so this is the fix. The replacement:

> Real-time multiplayer is unbounded on **per-request serverless billing** and bounded and cheap
> otherwise. The risk is a **platform-choice risk, not a physics risk**, and the mitigation is one
> sentence: **do not run always-on state on per-request-billed infrastructure.**

The evidence is two orders of magnitude from a billing model rather than from any property of the
workload: a published rate card puts 10,000 hibernatable WebSockets at 1 msg/s at **$419.30/month**,
and the identical workload fits inside the box already in the projection above.

### What is still open, and why no figure appears in the table

[ADR 0002](adr/0002-local-first-architecture.md) decision H partly closes the question this program
called *"the single most expensive unknown"* — whether a serverless platform bills **outbound
broadcast** WebSocket messages or only inbound, which for a broadcast-heavy simulation is a factor
of ~N per room. Cloudflare's Durable Objects pricing documentation, read 2026-09-03, states *"There
is no charge for outgoing WebSocket messages"*. That removes a ~$500/month tail on that platform.

**Three things remain, and until they are settled this model asserts no real-time figure:**

1. **A rate card is not an invoice.** #54's own criterion is a *billing test*: one room, one known
   message count, one bill. It has not been run.
2. **Duration billing is untouched by that finding.** A continuously ticking physics simulation
   never hibernates, so it accrues wall-clock duration charges for as long as the ride lasts —
   which is the line that actually scales with concurrency on that platform.
3. **It says nothing about any other platform.** The mitigation sentence is the general answer; that
   finding is one vendor's current wording.

**#16's breakdown trigger already names this**: its item 4 is *"#54 has a modelled and accepted cost
for concurrent real-time riders, using that answer"*, and item 3 is the billing question itself.
Both remain unticked, and this document is not evidence for either. What it does supply is the
model they will be checked against, and the structural answer: on the shape in
[ADR 0002](adr/0002-local-first-architecture.md) decision A, concurrency is bounded by one box's CPU
and its bundled traffic rather than by a meter, so the exposure is a capacity question and not an
unbounded bill.

---

## Self-hosting: what it costs, and what is not built

Self-hosting is **unconditional** (owner decision D5) and it is this project's clearest
differentiator: the closest analogue with a comparable free offering is closed-source with no
self-hosted option at all.

**It is not free either, and saying so is the point.** It is the box — €20.99/month at the reference
size, €5.99 at the floor — plus somebody's evenings. A self-hoster serving one region pays about a
fifteenth of the archive line, or nothing at all if a z13 or z14 extract fits inside R2's 10 GB free
tier. What they do not pay is a second bill for a managed database, an object store, a CDN account
or per-request compute, because [ADR 0002](adr/0002-local-first-architecture.md) decision A forbids
requiring any of them.

⚠️ **The single-command deploy in #54's fifth and sixth acceptance criteria is not in this change,
and could not be.** Three independent reasons, in the order they bite:

1. **There is nothing to deploy.** Owner decision D6 puts the server in Phase 3; Phase 1 is entirely
   local. CLAUDE.md is explicit that a command, config or test assuming a server exists must not be
   written, and a `docker-compose.yml` for an application that does not exist is the purest form of
   that mistake — worse than absent, because a reviewer reads it as evidence a deployment was
   exercised.
2. **The criterion requires a second person.** *"Run from scratch on a clean machine by someone
   other than its author"* cannot be satisfied by its author, whoever that is.
3. **[#52](https://github.com/openzigs/onyourleft/issues/52) owns the packaging** and is open. Its
   own criteria — an actually performed rollback, an actually performed restore, and a third party
   who has never seen this repository deploying from the documentation alone — are the same work at
   more detail.

What this document contributes to that issue is the sizing and the bill, so that when the deploy is
written the target is a number rather than a shrug.

### There is no budget alarm, and that is a decision

#54's third criterion asks for one *"proved to fire"*. Its own revision block **drops budget alarms
from required to optional**, for the reason [#52](https://github.com/openzigs/onyourleft/issues/52)
gives: they presuppose a cloud billing account this project operates, and requiring an alarm proven
to fire for a €21/month box somebody else pays for is ceremony. One R2 bucket exists
(`onyourleft-basemap`); no credential for that account is available to this change, nothing is being
billed, and an alarm on a $0.00 account cannot be breached in a way that proves anything.

**If a public reference instance is ever run, add them then** — and prove it by breaching a low
threshold, because an alarm nobody has triggered is a configuration and not an alarm.

---

## Who actually pays for things like this

The comparison #54's revision block asks for, because it sets expectations honestly.

**Every open project in this space that stayed cheap did so by moving state off the centre.** The two
that kept state central spend almost nothing on hosting and almost everything on people: the
Wikimedia Foundation's FY 2024–25 expenses totalled **$190.9 million**, of which internet hosting
was **$3,474,785 — about 1.8%**.

On the revenue side the picture is starker. Jellyfin has publicly asked people to stop donating.
Immich's Open Collective shows **$456.33 raised in total** — read 2026-09-15, which is also its
current balance, against an estimated annual budget of $433.59 — and its real funding is a patron.

**Nobody in this space is funded by hosting being cheap.** They are funded by donations, patrons or
grants. Hosting being cheap is what makes small donations *sufficient*, which is a different and much
better claim, and it is the one this model supports: at 10,000 monthly actives the whole
fully-loaded bill is **$28.12 a month**, which one supporter at $4 a month almost covers a seventh
of, and seven of them cover outright.

### What it costs to be given ten dollars

A fixed per-transaction fee is punitive at small amounts, which is why at least one comparable
service bills quarterly rather than monthly. The same $48 a year, at Stripe's published US domestic
rate of 2.9% + $0.30:

<!-- cost-model:donations -->

| Billing cadence | Charges per year | Amount per charge | Fees per year | Share of the gift |
| --- | --- | --- | --- | --- |
| Monthly | 12 | $4.00 | $4.99 | 10.4% |
| Quarterly | 4 | $12.00 | $2.59 | 5.4% |
| Annually | 1 | $48.00 | $1.69 | 3.5% |

**Monthly billing costs a supporter's gift three times what annual billing does**, and the whole
difference is the fixed fee. That is a product decision with a number attached, not a preference.

---

## What would make this wrong

- **`L` is measured and is not 30.** The tile-request line is linear in it and the crossover moves
  inversely. #53 already carries a *"measured cost per 100,000 tile requests"* criterion;
  instrumenting the client for one week replaces the guess. Nothing else in the model depends on it.
- **The reference box's price is read from a primary source and is not €20.99.** The *ordering* does
  not move — the box dominates anywhere in the €6–€43 band the secondary sources span, and at €43 it
  would dominate harder. What moves is the per-athlete figure, by up to a factor of two.
- **One box stops serving.** This is the one that would change the shape rather than the size, and
  it is unmeasured. The three bounds above are where to start.
- **The real-time billing test comes back badly.** Then decision H's mitigation sentence is what
  matters, and it is already the architecture: the exposure is a platform choice, and this project
  has not made the expensive one.
- **Streams stop fitting on a disk.** At 100,000 actives the twelfth month holds ~109 GB of streams
  against an 80 GB SSD. The answer is an attached volume, which is a line this model does not carry.

---

## Sources

| Claim | Source | Read |
| --- | --- | --- |
| R2 Standard: $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, egress free; free tier 10 GB-month, 1 M Class A, 10 M Class B | `developers.cloudflare.com/r2/pricing/`, page dated 2026-08-07 | 2026-09-15 |
| B2: $6.95/TB-month, egress free to 3× stored bytes then $0.01/GB and unconditionally free via three named CDNs, Class A/B/C calls free | `backblaze.com/cloud-storage/pricing` | 2026-09-15 |
| Planet archive 138,031,484,053 bytes at build `20260915`, and the four builds before it | `build-metadata.protomaps.dev/builds.json` | 2026-09-15 |
| Continental-US extracts: 4.3 GB (z13), 9.0 GB (z14), 19 GB (z15); the z15 extract took 5m06s and 120 HTTP requests | `pmtiles extract --dry-run`, recorded on #54 | 2026-09-15 |
| Stripe US standard domestic card rate 2.9% + $0.30 | `stripe.com/pricing` | 2026-09-15 |
| EUR→USD 1.1539 | ECB reference rate via `api.frankfurter.dev` | 2026-09-15 |
| Wikimedia Foundation FY 2024–25 expenses **$190.9 million** | Wikimedia Foundation audit FAQ on Meta-Wiki | 2026-09-15 |
| Wikimedia internet hosting **$3,474,785** (1.8% of expenses) | #54's research record. ⚠️ **Not re-verified** — the audited statements PDF did not resolve from this environment | inherited, 2026-09-02 |
| Immich Open Collective: $456.33 raised, $456.33 balance, $433.59 estimated annual budget | `opencollective.com/immich` | 2026-09-15 |
| Verisign `.com` wholesale $10.26, rising to $10.97 on 2026-11-01 | Secondary domain-industry press. ⚠️ Not a registry document | 2026-09-15 |
| `hetzner.com/cloud` carries no CAX line and no price string at all | Fetched in full: 163,764 bytes, zero matches for `CAX\d\d` | 2026-09-15 |
| Hetzner CAX31 €12.49/month (Feb 2026); a June 2026 CAX adjustment of ~1.3–1.4×; a Sept 2026 CAX range of €19.49–129.99 | Secondary trackers, which disagree with each other. ⚠️ Not a vendor document | 2026-09-15 |
| 22,691 bytes per recorded hour, 2.70× compression | `packages/store/src/stream-store.test.ts`, [ADR 0011](adr/0011-stream-storage.md) | measured, re-runnable |
| 10,000 hibernatable WebSockets at 1 msg/s ≈ $419.30/month; "no charge for outgoing WebSocket messages" | Cloudflare Durable Objects pricing documentation, via [ADR 0002](adr/0002-local-first-architecture.md) | inherited, 2026-09-03 |
| Tile-platform comparison: Google Map Tiles $2,220/mo, Google Dynamic Maps $1,750/mo, Mapbox ≈$925–950, AWS ≈$42.59, R2+Worker $7.46, R2 no Worker $2.46 | [ADR 0010](adr/0010-map-tiles-and-routing.md), which flags the Mapbox and AWS rows as unverified | inherited, 2026-09-03 |
| Pinball Map's first R2 month after ~50–60 k Mapbox loads/month: **$1.67, all storage**, for 111 GB | `blog.pinballmap.com`, via [ADR 0010](adr/0010-map-tiles-and-routing.md) | inherited, 2026-09-03 |
