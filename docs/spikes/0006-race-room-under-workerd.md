# Spike 0006: One 50-rider race room, measured under `workerd`

- **Date measured**: **2026-09-22.** Every figure below was produced on that day on the machine in
  §2. Nothing here is quoted from a rate card except where it says so, and nothing here is an invoice
- **Issue**: [#464](https://github.com/openzigs/onyourleft/issues/464). Parent
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."*

> ## ⚠️ The half of #464 this does NOT do
>
> #464 asks for two measurements: **the Cloudflare bill** and **the same room under `workerd`**.
> **Only the second was done.** Nothing was deployed to Cloudflare, no account was created, and no
> dashboard was read — so **[ADR 0002](../adr/0002-local-first-architecture.md) decision H's billing
> test is still outstanding**, and #464's first acceptance criterion is **not met**. The rate-card
> arithmetic in #464's body stands exactly as it was: an estimate, unmeasured. The pull request that
> lands this file says `Refs #464` and not a closing keyword, for that reason.
>
> ⚠️ **And no server ships.** Owner decision **D6**: there is no server in Phase 1, and
> [#7](https://github.com/openzigs/onyourleft/issues/7) is where one arrives. This is a
> **measurement**, taken in a temporary directory outside the workspace, of code that is committed
> nowhere. [ADR 0028](../adr/0028-racing-fairness.md) D-0's first block — *"there is no server in
> Phase 1"* — is untouched by it.

---

## 1. What was built, and what it deliberately is not

A race room shaped as **one Durable Object**, run under **`workerd`** — Cloudflare's open-source
(Apache-2.0) runtime, which is the same engine Workers and Durable Objects run on in production. The
shape follows [ADR 0028](../adr/0028-racing-fairness.md) rather than being invented for the spike:

| | |
|---|---|
| **Join** | A rider opens a WebSocket and sends `{t:'join', name, massKg}`. The room answers with an id and the route length |
| **Start** | One participant sends `{t:'start'}`; the room broadcasts `go` and begins a 1 Hz tick |
| **Ingest** | Each rider sends `{t:'p', s, ts, w}` at 1 Hz — a sequence number, a send timestamp and **the power they are producing**. ⚠️ **Not a position.** ADR 0028 D-2: the client simulates for its own screen, the **room re-simulates** |
| **Re-simulation** | Once a second, for every rider, `advance()` from `packages/physics` with the rider's own declared mass, the room's single coefficient set, and the grade at their own distance |
| **Fan-out** | Every rider is sent the whole field — `[id, decimetres, centimetres per second]` per rider — plus **the echo of their own last sequence number**, so a client measures its own latency with no clock sync |
| **Finish order** | A rider crossing the route length is stamped with their elapsed time and appended to an order; when everyone has finished the room broadcasts `end` and stops ticking |

**One physics for the whole room** ([ADR 0028](../adr/0028-racing-fairness.md) D-1): one drag area
(0.36 m², the middle `RIDING_POSITIONS` entry), one rolling-resistance coefficient, one bicycle mass,
one air density. **Only the rider's own body mass is per-rider, and it is declared.**

**What it deliberately is not** — [ADR 0028](../adr/0028-racing-fairness.md) D-7, which is
[spike 0005](0005-live-racing-patent-read.md)'s constraint list: no exercise class, no course content
served from anywhere, no instructor, no synchronising signal, no archived or previously recorded
performance parameters, no threshold-derived performance zone, no team-versus-team win condition,
and **no ranked list during the race** — a field of positions on a road, and a finish order at the
end.

### 1.1 Where the code lives, and why it is nowhere

⚠️ **It is not committed and it is not in the workspace.** #464 says *"throwaway branch, no product
code"*, and the stronger form was taken: it was built and run in a temporary directory, and the only
artefact that survives is this document.

`workerd` is **Apache-2.0** and would be admissible as a devDependency under `apps/` on
[ADR 0015](../adr/0015-dependency-licences.md)'s tables — but it was **not added**, because adding a
runtime that only a measurement needs is a permanent cost for a one-day answer.
`pnpm why workerd --recursive` over this workspace returns **nothing**, which is the check
`CLAUDE.md` §3 names for exactly this question. `DEP001` and `DEP002` are therefore unaffected, and
`pnpm run check:licences` reports the same 868 dependency licences it did before.

⚠️ **One consequence of building outside the workspace is worth recording because it cost a
debugging cycle.** The room and the load generator were bundled with **rolldown** (already in the
workspace, for Vite) straight from `packages/physics/src/index.ts`. Rolldown **strips types without
checking them**, so a wrong call to `withDragArea` — which takes **one** argument and returns a
partial, not a coefficient set — compiled cleanly and produced `NaN` speeds on the first run. Inside
the workspace `tsc` would have refused it. **A spike run outside the typechecker gets the
typechecker's defects back**, and the repair is to read the signature rather than to trust the
bundle.

---

## 2. The machine, and the software

| | |
|---|---|
| Machine | Apple **M4 Pro**, `Mac16,8`, **12 cores**, 24 GiB RAM |
| OS | macOS 26.6.2 (`25G83`) |
| Runtime | `workerd` **1.20260922.1** (`workerd 2026-09-22`), Apache-2.0, from npm into a temporary directory |
| Durable Object storage | `inMemory` — a race room has nothing to persist and #464 asks about compute, not storage |
| Load generator | Node **v24.20.0**, 50 WebSocket clients in **one** process, each simulating its own screen through `packages/physics` |
| Physics | `packages/physics` at this branch's commit, bundled with rolldown 1.2.6 |

⚠️ **This is a developer's laptop, not the €21/month box [ADR 0002](../adr/0002-local-first-architecture.md)
costs**, and #464 asks for *"a small VM"*. §7 is what that omission does and does not permit.

⚠️ **The load generator shares the machine with the room.** Every latency figure therefore includes
contention from 50 client-side simulations running on the same 12 cores. That inflates latency and
does **not** inflate the room's own CPU figure, which is read per-process.

---

## 3. The measured hour

**50 riders, 1 Hz, one room, 3 600 seconds.** The route was set to 60 km so that nobody finished and
the room carried a full 50-rider field for the whole hour; the finish-order path is measured
separately in §6.

**Everything in this table was produced by that run.** The room's own counters and the clients' own
counters are reported side by side on purpose — see §3.1.

| | Measured |
|---|---|
| Wall clock | **3 604.1 s** |
| Riders | **50**, all connected for the whole run |
| Position samples ingested | **179 850** (50 × 3 597 ticks) |
| Fan-out frames sent | **179 850** — ⚠️ **one frame per rider per tick, carrying the whole field**, not one message per rider pair |
| Total room inbound | **215 901 messages, 8 754 603 bytes** (positions + 36 000 latency pings + 50 joins + 1 start) |
| Total room outbound | **214 850 messages, 152 374 991 bytes** = **145.3 MiB per room-hour** |
| Mean outbound frame | **709 bytes** (50 riders × `[id, decimetres, cm/s]`) |
| Application bytes per rider-second | **48.7 in, 847 out** |
| `workerd` process CPU | **37.81 s** over 3 604.1 s = **1.05 % of one core** |
| `workerd` resident set | **30.2 MiB idle**, then a sawtooth: median **116.9**, p90 **150.3**, peak **174.3 MiB** |

### 3.1 ⚠️ The accounting cross-check, and the defect it caught

The room counts every message it receives and sends; each client counts every message it sends and
receives. **Over 430 751 messages the two disagree by exactly one** — the host's `start`, which the
room counts and no rider sends as a rider. Nothing was dropped, nothing was double-counted, and no
fan-out frame went missing.

⚠️ **That check exists because the first version of this harness failed it in the classic way.** The
smoke run reported a live race — riders joined, positions advanced, latencies came back — and the
`/stats` read came back **all zeros**. The write had succeeded and **the read was addressed to a
different Durable Object**: the room is keyed by `idFromName(searchParams.get('room'))`, the
WebSocket clients used `?room=smoke`, and the stats fetch had `?room=spike` hard-coded. That is the
*wrong key prefix* variant of "a write that reports success while the read cannot see it" — the
defect shape `CLAUDE.md` §5 names — reproduced faithfully in a networked room rather than in a store.
**The repair is that the stats URL is derived from the same string the sockets use**, and the
cross-check above is what would now make a recurrence loud rather than silent.

### 3.2 What the memory figure is, and what it is not

The resident set does not sit flat: it climbs from **30.2 MiB** with an idle room to a peak of
**174.3 MiB** and falls back — it was observed at 77 MiB at one sample and 150 MiB twenty seconds
later — which is V8 reclaiming a heap rather than a leak. **A leak would not come back down, and it
did, repeatedly.**

⚠️ **This is the `workerd` process, not the Durable Object's isolate heap**, and the two are not the
same number: the process baseline alone is 30 MiB before any room exists. **Cloudflare bills a
Durable Object against 128 MB.** This measurement neither confirms nor refutes that a 50-rider room
fits inside that, and §8 records it as the first thing the deployed half should read.

---

## 4. CPU, and where it goes

**37.81 seconds of process CPU for a 3 604-second race with 50 riders in it** — 1.05 % of one core
on this machine. The interesting part is where it goes.

| | Measured | Share |
|---|---|---|
| Whole `workerd` process (OS accounting, `ps -o cputime`) | **37.81 s** | 100 % |
| Inside the tick, re-simulating 50 riders (the worker's own clock) | **17.07 s** | **45.2 %** |
| Everything else — WebSocket frames, JSON encode and decode, scheduling | ≈ 20.7 s | ≈ 54.8 % |

**Per rider-second of racing, the re-simulation costs 94.9 µs.** That number has a cause worth
knowing before anybody tunes anything: `packages/physics` §`DEFAULT_INTEGRATION_STEP_SECONDS` is
**0.01**, so a one-second step is **100 sub-steps**, and the room does 5 000 sub-steps per tick for
50 riders. That works out at **≈ 0.95 µs per sub-step**, which is the honest unit and the one that
survives a change of rider count.

⚠️ **So the room's arithmetic is not what would limit it**, and the intuition that re-simulating
everybody is expensive is wrong by about an order of magnitude at this field size. **The messages
cost more than the physics.**

⚠️ **The 45.2 % share is a cross-check, not a coincidence, and §7.6 is why it matters.** The
in-worker figure comes from `Date.now()` deltas inside the tick — a clock Cloudflare deliberately
freezes between I/O operations in production, which would have made this read **zero**. It did not,
so local `workerd` does not freeze it here; and the figure lands **below** the operating system's
independent per-process total in a plausible proportion, which is the only reason it is quoted.

**And it scales close to linearly in riders, but the fan-out does not.** At **200 riders** for 300 s
the process used **15.73 s** of CPU — **5.17 % of a core**, against 1.61 % for 50 riders in the same
window. That is 3.2× the CPU for 4× the riders. **The bytes are the opposite story**: 200 riders
produced **178.0 MB of fan-out in 300 seconds** against **11.6 MB** for 50 — **15.4×, which is
n^1.97**. A frame per rider, each carrying every rider, is **O(n²) in bytes** and there is no way to
make it otherwise without sending each rider less than the whole field.

---

## 5. ⚠️ Latency is two numbers, and reporting one of them would have been misleading

This is the finding most likely to be misquoted, so it is stated before the figures.

A rider sends a power sample at some moment. The room does not answer it: it folds it into the
**next 1 Hz tick** and fans the whole field out. So "latency" from send to seeing your own input
reflected is **dominated by where in the room's one-second cycle the message landed** — a quantity
that has nothing to do with the runtime, the network or the room's code, and everything to do with
the tick rate.

So two things were measured:

- **Fan-out latency** — send a `p`, wait for the `f` frame echoing that sequence number. This is what
  a rider experiences, and it is mostly cycle wait.
- **Runtime latency** — send a `ping`, which the room answers **inline**, off the tick. This is the
  transport plus the runtime, and it is the number that says whether `workerd` is fast.

**Hour run, 50 riders, 1 Hz.**

| | Fan-out (what a rider waits) | Runtime (`ping` answered inline) |
|---|---|---|
| samples | 178 744 | 36 000 |
| min | 4 ms | 0 ms |
| **p50** | **510 ms** | **2 ms** |
| p90 | 907 ms | 4 ms |
| p99 | 1 003 ms | 10 ms |
| max | 1 029 ms | 35 ms |
| mean | 506.3 ms | 2.07 ms |

**Read the two columns together or not at all.** The fan-out distribution is almost exactly uniform
over one tick — a mean of **506 ms** against a predicted 500 — which is the arithmetic confirming
that what it measures is *where in the cycle the message landed*. The runtime column is `workerd`
itself: **2 ms at the median, 10 ms at the 99th percentile**, on loopback, with 50 client
simulations competing for the same cores.

At **200 riders** the runtime column moves and the fan-out column does not: ping p50 **2 ms**, p99
**37 ms**, max **49 ms**, against a fan-out p50 of **511 ms**. Four times the field costs about
**3.7× at the 99th percentile of runtime latency** and nothing at all at the median of what a rider
actually waits — because that is the tick, and the tick did not change.

⚠️ **All of this is loopback.** A rider's real fan-out latency is this **plus** their own round trip
to wherever the room is, and §7.4 records that no real network was involved at any point.

---

## 6. Joins, the start signal, and the finish order

Measured in a separate short race, because a room where everybody finishes stops carrying load.

**6 riders, a 1.2 km route, 1 Hz.** Joins, the start signal, 1 Hz ingest, re-simulation, fan-out and
the finish order, end to end:

- All six joined and were issued ids and the route length.
- One participant's `start` began the tick for everybody.
- Five crossed the line inside the run's window and were stamped with their elapsed times in the
  order they crossed — **156.5 s, 170.5 s, 172.5 s, 188.5 s, 194.6 s**. They are different because
  the riders' seeded W/kg and declared masses are different, which is the whole of
  [ADR 0028](../adr/0028-racing-fairness.md) D-1 working: **one physics, one bicycle, one drag area,
  one wind, and the rider's own mass**.
- The sixth had not finished when the run's clock expired, which is why the room's `end` broadcast
  is exercised only when the field is short enough — a real room needs a time limit as well as a
  finish line, and this one has none.

⚠️ **Nothing here proves the finish order is *right*, only that it is produced.** Whether two riders
crossing within one tick are ordered correctly is a **sub-tick** question this room does not answer:
it stamps a finish at the tick boundary, so its resolution is one second. That is a design question
for whoever builds the real room and it is recorded as open.

---

## 7. ⚠️ What this does NOT establish

Eight things, and the first two are the ones a reader in a hurry will assume.

1. **No bill.** Nothing was deployed to Cloudflare. #464's first acceptance criterion, and
   [ADR 0002](../adr/0002-local-first-architecture.md) decision H's *"one room, one known message
   count, one bill"*, are **outstanding**. §8 says what the measured numbers do and do not let
   anybody infer about the rate card.
2. **Not a VM.** An M4 Pro with 12 performance-class cores is not the reference box.
   [ADR 0002](../adr/0002-local-first-architecture.md)'s €21/month machine is a small shared-CPU
   instance, and a CPU figure that is a fraction of a percent here could be several percent there.
   **What transfers is the shape — how the cost scales with riders and with tick rate — and not the
   absolute number.**
3. **One room, not many.** Nothing here says what happens when a box runs fifty rooms. ⚠️ **And the
   per-room cost is not linear in riders in the way an extrapolation would want**: §9 run D measures
   CPU growing 3.0× for a 4× field while the outbound bytes grow **15.4×**, so "one room of 50" does
   not multiply into "four rooms of 50" *or* "one room of 200" by the same factor. Isolate overhead,
   socket count and scheduler behaviour under many rooms were not measured at all.
4. **No real network.** Everything ran on loopback. There is no WAN latency, no jitter, no packet
   loss, no mobile radio wake-up, and no TLS. A real rider's fan-out latency is this plus their own
   round trip.
5. **No reconnection, no hibernation, no storage.** A rider whose phone sleeps, a socket that drops
   mid-race, a room that outlives a process — none of it exists in this code. Cloudflare bills a
   Durable Object for **wall-clock time while active**, and hibernation is exactly the mechanism that
   would change that bill; this room never hibernates and was never asked to.
6. **The in-worker CPU figure is suspect on Cloudflare even though it is sound here.** Cloudflare
   Workers deliberately freeze `Date.now()` between I/O operations, which would make a
   `Date.now()`-delta across a synchronous loop read **zero**. It did not read zero under local
   `workerd`, so the clock advanced — but that is a statement about this runtime in this
   configuration and not about production. §4 cross-checks it against the operating system's own
   per-process CPU accounting, which is independent of the worker's clock, and **the cross-check is
   the reason the figure is quoted at all.**
7. **Nothing about fairness, anti-cheat or moderation.** [ADR 0028](../adr/0028-racing-fairness.md)
   D-2's checking rule and D-3's flags are not implemented here. #464's own body makes the point that
   *"the server is the cheap part; moderation, anti-cheat and prizes are not"*, and this document
   measures only the cheap part.
8. **Nothing about what a race should look like.** #464 asks what interpolation *"needs to look
   smooth at 1 Hz vs 2 Hz"*. §5 and §9 give the **latency and bandwidth** at both rates; **whether
   1 Hz looks smooth is a rendering question nobody watched a screen to answer**, and it is recorded
   as not established rather than as a number nobody measured.

---

## 8. What this does and does not say about the Cloudflare estimate

#464's estimate rests on two quantities, and this run measures one of them directly.

**Measured here: the message count and the bytes.**

| | #464's model | Measured | |
|---|---|---|---|
| Inbound messages per room-hour | 180 000 | **179 850** | ✅ **confirmed to 0.08 %** — it is riders × seconds and could hardly be otherwise |
| Billed Cloudflare requests per room-hour (÷ 20) | 9 000 | **≈ 8 998** | ✅ **#464's Cloudflare arithmetic is confirmed**, because it depends on this number alone |
| Outbound **messages** per room-hour | 8.82 M (each update to each of 49 others) | **179 850** | ⚠️ **49× fewer** |
| Outbound **bytes** per room-hour | ≈ 441 MB | **152.4 MB** | ⚠️ **2.9× fewer** |

⚠️ **The difference is batching, and it is a design choice rather than an error in #464.** This room
sends **one frame per rider per tick carrying the whole field**, where #464's arithmetic assumes each
rider's update is delivered to each other rider separately. On Cloudflare the difference is worth
**nothing**, because outgoing WebSocket messages are not charged. **On the platforms #464 uses to
make its point, it is worth almost everything**, and the arithmetic — over the measured counts, still
on the same rate cards, still not a bill — goes:

| Platform, at 1 000 riders/day | #464's figure | Recomputed on the measured, batched counts |
|---|---|---|
| Cloudflare Durable Objects | ≈ $5.7 / month | **≈ $5.7 / month**, unchanged |
| Per-delivery (Ably, Supabase) at ~$2.50/M | ≈ $13 800 / month | **≈ $270 / month** — 108 M deliveries, not 5.5 billion |
| Firebase RTDB download at ~$1/GB | ≈ $265 / month | **≈ $91 / month** — 91.4 GB, not 275 |

⚠️ **This does NOT overturn #464's conclusion and it narrows it.** *"A live race is cheap on a
platform that does not bill outbound messages"* stays true — Cloudflare is still about **47×** cheaper
than the nearest per-delivery alternative on these numbers. What changes is the **three orders of
magnitude**: batched, it is closer to one and a half, and the gap is a hosting-choice question rather
than a structural impossibility. **Every figure in the right-hand column is rate-card arithmetic over
a measured message count. None of them is an invoice, and the one that matters —
[ADR 0002](../adr/0002-local-first-architecture.md) decision H's — is still owed.**

**And the outbound count is the one that matters commercially**, because Cloudflare's rate card says
*"there is no charge for outgoing WebSocket messages"* while incoming ones are billed at 20:1.

**Not measured here: duration billing.** A Durable Object is billed for GB-seconds while active. That
is wall-clock time, not CPU time, so **a room that is 99 % idle is billed the same as one that is
saturated** — which means §4's CPU figure, however small, says **nothing** about the duration half of
the bill. #464's arithmetic for that half (128 MB × room-seconds) is unchanged and unverified.

⚠️ **And one measured number is a live question for that half.** §3 records the `workerd` process's
resident set sawtoothing rather than sitting flat. **Cloudflare's Durable Objects are billed against
a 128 MB object**, and process RSS is not isolate heap — `workerd` has its own baseline, several
megabytes of it before any worker runs. **So this measurement neither confirms nor refutes that a
50-rider room fits in 128 MB, and it is the first thing the deployed half should read.**

---

## 9. 1 Hz against 2 Hz, and against 200 riders

#464 asks for the 1 Hz / 2 Hz comparison, and a saturation point is worth having beside it.

Four 300-second runs, each on a freshly started `workerd`. **Ingest** is how often a rider sends;
**fan-out** is how often the room ticks and broadcasts. #464 conflates them and they are the two
dials, so they are separated here.

| Run | Riders | Ingest | Fan-out | CPU over 300 s | of one core | Room outbound | Fan-out latency p50 | Runtime p50 / p99 | RSS at end |
|---|---|---|---|---|---|---|---|---|---|
| **A** | 50 | 1 Hz | **1 Hz** | 5.32 s | **1.75 %** | **11.56 MB** | **526 ms** | 2 / 15 ms | 118 MiB |
| **B** | 50 | **2 Hz** | **2 Hz** | 7.48 s | **2.46 %** | **23.02 MB** | **256 ms** | 2 / 5 ms | 204 MiB |
| **C** | 50 | **2 Hz** | 1 Hz | 5.15 s | **1.69 %** | **11.57 MB** | **274 ms** | 1 / 5 ms | 190 MiB |
| **D** | **200** | 1 Hz | 1 Hz | 15.73 s | **5.17 %** | **178.0 MB** | 511 ms | 2 / 37 ms | 282 MiB |

**Three readings, and the third is the one worth carrying into a design.**

1. **A → B: doubling the fan-out halves the wait and doubles the bytes.** 526 ms → 256 ms at the
   median, 11.56 MB → 23.02 MB per 300 s, for **1.4× the CPU**. Exactly what the arithmetic predicts,
   which is mildly reassuring and not a finding.
2. **A → D: four times the field is 15.4× the bytes.** The fan-out is **O(n²)**, and the rider's own
   wait does not move at all, because the wait is the tick.
3. ⚠️ **A → C: doubling the INGEST alone buys most of the latency and costs nothing outbound.**
   526 ms → **274 ms**, with outbound bytes and CPU unchanged inside the noise (11.56 → 11.57 MB;
   5.32 → 5.15 s). The room takes each rider's **latest** sample at tick time, so sending twice as
   often halves how stale that sample is — and the expensive half of the system never learns about
   it. ⚠️ **On Cloudflare that is not free**: inbound messages are the billed ones, at 20:1, so C
   doubles the billed request count and B does not. **The cheap dial and the billed dial are the same
   dial, and they point opposite ways** — which is a thing to decide with the rate card open rather
   than to discover.

⚠️ **What none of this says is whether 1 Hz LOOKS smooth**, which is what #464 actually asks. **C
halves the staleness of the input; it does not change how often a rider's screen moves**, which is
still once per fan-out. Whether the answer is a faster fan-out or client-side interpolation between
the last two frames — #323's `drawnAt` idea applied to other riders, which is the option that costs
no bandwidth at all — is a rendering question, and **nobody watched a screen for this spike**. It is
recorded as not established.

---

## 10. How to reproduce it

Nothing here is committed, so the reproduction is a description rather than a script. In a temporary
directory outside the workspace:

1. `npm install workerd` — Apache-2.0, ~5 platform-optional binaries, **never** into the workspace.
2. Write the room as one exported Durable Object class plus a default `fetch` that routes to
   `env.ROOM.get(env.ROOM.idFromName(name))`, importing `advance`, `MARTIN_1998_COEFFICIENTS` and
   `withDragArea` from `@onyourleft/physics`.
3. Bundle it with the workspace's own rolldown, aliasing `@onyourleft/physics` and
   `@onyourleft/domain` to their `src/index.ts`. ⚠️ §1.1: rolldown does not typecheck.
4. A `config.capnp` with one service, one socket on `127.0.0.1`, a
   `durableObjectNamespaces` entry and `durableObjectStorage = (inMemory = void)`.
5. `workerd serve config.capnp`, then a Node process opening 50 `WebSocket`s.
6. Sample `ps -o %cpu=,rss= -p <workerd pid>` every 10 s, and take `ps -o cputime=` before and after.

⚠️ **Three details that are load-bearing rather than incidental**, each of which changed a number or
a conclusion in this document:

- **The room's tick interval and the clients' send rate must be separate dials.** §9 runs B and C
  differ only in that, and they are the two most interesting rows in the table. The first version of
  this harness had only the client dial, and run C's finding — most of the latency for none of the
  outbound cost — was invisible.
- **The `ping` must be answered inline, off the tick.** Without it there is one latency number, it is
  dominated by cycle wait, and `workerd`'s own speed is unmeasured (§5).
- **The stats read must be keyed by the same room name the sockets use.** §3.1 is what happens when
  it is not, and the symptom is a room that reports zero while working perfectly.

---

## 11. What would make this write-up wrong

- **It is run on a VM and the numbers move by more than an order of magnitude.** §7.2 says only the
  shape transfers; if the shape does not transfer either, the extrapolation in §4 is wrong rather
  than merely imprecise.
- **A real Cloudflare deployment bills something the message count does not predict.** That is the
  whole point of ADR 0002 decision H and is exactly why this document does not claim to have done it.
- **The room grows a feature that changes the per-tick cost class.** Drafting
  ([ADR 0028](../adr/0028-racing-fairness.md) D-5, [#327](https://github.com/openzigs/onyourleft/issues/327))
  makes each rider's step depend on every other rider's position, which is O(n²) where this is O(n).
  **Every number here is for a room with no drafting in it.**
- **`packages/physics`' integration step changes.** §4 shows the re-simulation cost is dominated by
  `DEFAULT_INTEGRATION_STEP_SECONDS`; that constant is a documented tunable and moving it moves every
  CPU figure here proportionally.
- **Somebody quotes a figure from this document as a cost.** It is a CPU, memory and bandwidth
  measurement of one room on one laptop on one day. The cost question is
  [#54](https://github.com/openzigs/onyourleft/issues/54)'s and needs the bill.
