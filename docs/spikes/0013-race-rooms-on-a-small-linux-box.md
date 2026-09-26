# Spike 0013: Race rooms under `workerd` on a small Linux box, one room for an hour and many at once

- **Date measured**: **2026-09-26.** Every figure below was produced on that day on the machine in
  §2. Nothing here is quoted from a rate card except where it says so, and nothing here is an invoice
- **Issue**: [#464](https://github.com/openzigs/onyourleft/issues/464), its second acceptance
  criterion — *"the same room measured under `workerd` on a VM"*. Parent
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Follows**: [spike 0007](0007-race-room-under-workerd.md), which measured the same room on the
  bare macOS host and recorded *"not a VM"* and *"one room, not many"* as two of the eight things it
  did not establish. **This is the second write-up those two need**, because a spike is never edited
  (`CLAUDE.md` §7). Nothing here contradicts 0007; where the numbers differ, §6 says by how much and
  what that does and does not mean
- **Status of this document**: a **spike write-up**. It decides nothing

> ## ⚠️ What this does NOT do
>
> **There is still no Cloudflare bill.** Nothing was deployed and no dashboard was read, so
> [ADR 0002](../adr/0002-local-first-architecture.md) decision H's *"one room, one known message
> count, one bill"* is **still outstanding**, #464's first and third acceptance criteria are **not
> met**, and the pull request that lands this file says `Refs #464`. §8 says why this run did not
> attempt it and what it would take.
>
> ⚠️ **And it is not a rented VPS.** The "box" is a Linux container with a hard CPU quota and a
> memory limit, inside Docker Desktop's Linux virtual machine on an Apple M4 Pro. §2 is exactly what
> that is and §7 is what does and does not transfer to the Ampere-based reference box
> [ADR 0002](../adr/0002-local-first-architecture.md) decision A costs.
>
> ⚠️ **No server ships.** Owner decision **D6**. The room and the load generator were built and run
> in a temporary directory outside the workspace, as 0007's were, and are committed nowhere.
> `workerd` is in no manifest.

---

## 1. Headline

1. **The hour runs on the floor box.** One 50-rider room at 1 Hz for an hour, inside a 2-vCPU /
   4 GB limit — [ADR 0002](../adr/0002-local-first-architecture.md) decision A's *floor* — cost
   **1.70 % of one vCPU**, peaked at **269 MiB** of container memory, and put **84.6 MB** on the
   wire outbound. Every message both ends sent is accounted for, in both directions, exactly (§3.1).
2. ⚠️ **One `workerd` process uses one core, whatever the box has.** Its main thread did all the
   work; the V8 helper threads beside it were idle to within a rounding error. At **12 000 riders**
   (240 rooms) one process sat at **99.6 %** of a core and the room fell apart — tick lateness p99
   **2.1 s**, a ping answered in **11.5 s** at the 99th percentile. At **6 000** it was at **51 %**
   and healthy. **A four-vCPU box needs four processes and a way to put rooms on them**; with four,
   the same 6 000 riders were healthy and cost **about 28 % more CPU in total** (§4.2).
3. ⚠️ **With compression on — which is what a browser asks for — memory runs out before CPU does.**
   Chrome offers `permessage-deflate` and `workerd` accepts it by default. Each connection then holds
   a compression context, and a room of 50 costs about **33 MB**: **~0.67 MB per rider**, against
   **~0.14–0.29 MB** with compression switched off. Compression **halves** the outbound wire bytes
   and moved the CPU by under 3 % (§5). **That trade is a dial the operator owns, and on an 8 GB box
   it is the dial that decides how many riders fit.**
4. **Per-room CPU falls as rooms are added** — 1.70 % of a core for one room, **0.63 %** each at 80
   rooms — and the re-simulation per rider-second falls with it, from **162 µs** to **~60 µs**. The
   likeliest cause is a CPU that clocks down when it is nearly idle, and it is **not established**
   (§6).

---

## 2. The box, and the software

| | |
|---|---|
| Host | Apple **M4 Pro**, 12 cores, 24 GiB, macOS 26.6.2 — the same machine as spike 0007 |
| Virtual machine | **Docker Desktop 29.5.3**, Linux **6.12.76-linuxkit**, **aarch64**, 12 vCPUs and 7.75 GiB given to the VM |
| "Floor" box (§3) | one container, **`--cpus=2 --memory=4g`** — a CFS quota of two CPUs and a hard memory limit |
| "Reference" box (§4, §5) | one container, **`--cpus=4 --memory=7g`** — ADR 0002's reference is 8 GB; the VM holds 7.75 GiB, so 7 GB is the nearest limit that is honest. **No run came within 4.5 GB of it** |
| Image | `node:24-bookworm-slim` (Debian 12) for both containers |
| Runtime | `workerd` **1.20260922.1** (`workerd 2026-09-22`), the Linux arm64 build — the **same version** spike 0007 ran, chosen for comparability rather than the newest |
| Compatibility | date `2026-09-01`; the compressed runs use the defaults, the uncompressed ones add the one flag `no_web_socket_compression` and nothing else |
| Durable Object storage | `inMemory` |
| Physics | `packages/physics` at `bdde928`, bundled with the workspace's rolldown 1.2.6, aliasing `@onyourleft/physics` and `@onyourleft/domain` to their `src/index.ts` |
| Load generator | Node **24**, in a **second container on the same Docker bridge network**, with no CPU limit |

⚠️ **What "on a VM" is worth here, precisely.** The room runs in a Linux kernel with Linux's
scheduler, Linux's TCP stack and Linux's memory accounting, and the load generator reaches it over a
virtual Ethernet bridge rather than loopback — every frame crosses a real TCP stack twice. Those are
what 0007 lacked. **What it is not** is a slower core: a CFS quota caps how much CPU time the
container may take, not how fast each instruction runs, and every instruction here ran on an M4 Pro
core. §7 is what that costs the transfer.

⚠️ **The load generator does not simulate a screen**, where 0007's did. Each client sends a seeded
power — 2.5 to 4.0 W/kg on a declared 60–90 kg, with ±10 % noise — at the ingest rate, and a ping
every five seconds. The room's cost does not depend on what the client does with a frame, and a
generator carrying 12 000 client-side physics simulations would have measured itself. Its own
event-loop lag is recorded on every run (p99 **8–12 ms** on every healthy run, against a 100 ms
probe interval), which is what says the generator was never the bottleneck — except in §4.1's
saturated run, where it reached **47 ms** and the room's own lateness was **2 135 ms**.

### 2.1 The room

The same room 0007 built, from the same description, re-written in a temporary directory: one
Durable Object per race; `join` answered with an id and the route length; one `start` begins a
tick; each rider sends `{t:'p', s, ts, w}` — a sequence number, a send time and **the power they
are producing**, never a position (ADR 0028 D-2); once a tick the room re-simulates every rider
through `advance()` with **one** coefficient set (drag area 0.36 m², rolling resistance 0.005, a
9 kg bicycle, sea-level air at 15 °C) and **the rider's own declared mass** (ADR 0028 D-1); it
fans out one frame per rider carrying the whole field plus the echo of that rider's last sequence
number; a `ping` is answered **inline**, off the tick. The route was a sinusoid of ±4 % grade and
long enough that nobody finished, so every room carried its full field for the whole run. **0007
§6 already measured the finish order; it was not re-measured.**

⚠️ **Two things were added, both to measure rather than to race.** The tick is **scheduled against
the start time** — tick *k* is due at `t₀ + k × interval` — and the room records **how late** each
tick began. That lateness is the saturation signal, and it is the one number here that a room
falling behind cannot hide: a room that is keeping up starts every tick within a few milliseconds of
its due time. And the tick records how long its own physics and its own fan-out took, by the
worker's clock — which 0007 §7.6 records is frozen on Cloudflare and is not frozen under local
`workerd`.

⚠️ **The stats read is keyed by the room name the sockets used**, derived from one string. 0007
§3.1 is what happens otherwise.

---

## 3. The measured hour, on the floor box

**50 riders, 1 Hz ingest, 1 Hz tick, one room, `--cpus=2 --memory=4g`, compression negotiated
(`permessage-deflate; client_max_window_bits=15`), 3 601.5 s of wall clock.**

| | Measured |
|---|---|
| Riders | **50**, all connected for the whole run |
| Ticks | **3 601** |
| Position samples ingested | **179 050** |
| Fan-out frames sent | **180 050** — one per rider per tick, each carrying the whole field |
| Room inbound | **215 051 messages, 8 010 836 bytes** of application payload |
| Room outbound | **216 100 messages, 148 501 656 bytes** of application payload |
| **Wire, outbound** (container `eth0` `tx_bytes`) | **84 617 494 bytes** — **57 %** of the application bytes, because the frames are compressed |
| **Wire, inbound** (`rx_bytes`) | **37 425 365 bytes** — **4.7×** the application bytes: a 40-byte power sample carries TCP/IP and WebSocket framing, and this count includes the ACKs for everything sent |
| `workerd` CPU (`/proc/<pid>/stat`, user + system) | **61.40 s** over 3 601.5 s = **1.70 % of one vCPU** |
| Container CPU (cgroup `cpu.stat`) | **72.13 s** — everything above plus the sampler's own `docker exec` every ten seconds, which runs inside the container's cgroup |
| Of which re-simulating 50 riders (worker's clock) | **29.11 s** — **47.4 %** of `workerd`'s CPU, **162 µs per rider-second**, **1.62 µs per 10 ms sub-step** |
| Tick lateness | p50 **5 ms**, p99 **12 ms**, max **23 ms** |
| Longest single tick | **34 ms** |
| `workerd` resident set | **43 MiB** idle; climbs over the first ~20 minutes, then a sawtooth — median **207 MiB**, p90 **243 MiB**, max **257 MiB** |
| Container memory peak (cgroup `memory.peak`) | **269 MiB** of the 4 GB limit |

### 3.1 The accounting, both directions

**Inbound**: 179 050 positions + 35 950 pings + 50 joins + 1 start = **215 051**, which is the
room's counter and the clients' sent counter, both.

**Outbound**: 180 050 frames + 35 950 pongs + 50 join answers + 50 `go` = **216 100**, which is
the room's counter and the clients' received counter, both.

⚠️ **0007 §3.1 recorded an outbound residual of about 1 100 messages it could not explain, and this
run has none.** That is **not** an explanation of 0007's residual: 0007's harness was never
committed either, so the two cannot be compared line by line, and this one was written with the
decomposition in mind from the start. What it does say is that a room of this shape has no
inherent outbound loss at the scale of an hour.

⚠️ **The cross-check is exact only when the stats are read within one tick of the clients stopping**,
because the room keeps ticking until the sockets close. In §4.2's four-process run, 120 stats reads
took longer than a tick and the clients received **1 000** more messages than the rooms had
counted when read — exactly one tick of 20 rooms. That is the harness reading at two different
moments, and it is recorded rather than tidied.

### 3.2 Latency

| | Fan-out (what a rider waits) | Runtime (`ping` answered inline) |
|---|---|---|
| samples | 179 050 | 35 950 |
| p50 | **533 ms** | **1.4 ms** |
| p90 | 942 ms | 2.4 ms |
| p99 | 1 009 ms | 10.2 ms |
| max | 1 025 ms | 17.6 ms |
| mean | 531.9 ms | 1.6 ms |

The same two numbers 0007 §5 reported, and the same reading: the fan-out column is uniform over one
tick and is **the tick**, not the runtime. **Over a bridge rather than loopback, the runtime column
did not get worse** — 1.4 ms at the median against 0007's 2 ms — which says the bridge costs less
than the contention 0007 had from 50 client simulations sharing its cores. It is still not a real
network (§7).

---

## 4. Many rooms in one box

The reference shape — **`--cpus=4 --memory=7g`** — with 50 riders per room at 1 Hz, **180 s** per
run on a freshly started container (**120 s** for the saturated run). CPU is the **median of the
ten-second samples** over the steady state rather than the run total, because opening thousands of
sockets one after another takes long enough to distort a total.

| Run | Rooms | Riders | `workerd` processes | Compression | `workerd` CPU, % of one core | per room | Physics µs / rider-s | RSS at end | Tick lateness p50 / p99 / max | Ping p50 / p99 |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 5 | 250 | 1 | on | **7.2 %** | 1.44 % | 159 | 277 MiB | 4 / 12 / 15 ms | 1.3 / 15.5 ms |
| B | 10 | 500 | 1 | on | **12.3 %** | 1.23 % | 137 | 409 MiB | 3 / 13 / 31 ms | 1.2 / 13.4 ms |
| C | 20 | 1 000 | 1 | on | **20.0 %** | 1.00 % | 98 | 700 MiB | 9 / 20 / 61 ms | 1.8 / 26.3 ms |
| D | 40 | 2 000 | 1 | on | **28.7 %** | 0.72 % | 72 | 1 357 MiB | 10 / 24 / 28 ms | 3.4 / 28.6 ms |
| E | 80 | 4 000 | 1 | on | **50.4 %** | 0.63 % | 61 | 1 686 MiB | 23 / 40 / 52 ms | 12.6 / 60.9 ms |
| F | 20 | 1 000 | 1 | **off** | **19.4 %** | 0.97 % | 127 | 326 MiB | 10 / 22 / 23 ms | 0.9 / 21.7 ms |
| G | 120 | 6 000 | 1 | off | **51.1 %** | 0.43 % | 58 | 856 MiB | 25 / 55 / 58 ms | 7.1 / 56.7 ms |
| H | 120 | 6 000 | **4** | off | **65.2 %** (summed) | 0.54 % | 70 | 1 809 MiB (summed) | 7 / 28 / 117 ms | 0.8 / 9.8 ms |
| **I** | **240** | **12 000** | 1 | off | **99.6 %** | — | 61 | 1 605 MiB | **735 / 2 135 / 2 158 ms** | **3 051 / 11 546 ms** |

The fan-out wait sat at **p50 504–533 ms, p99 1 000–1 027 ms** in every run from A to H — the
tick, unchanged — and broke in I to **p50 1 120 ms, p99 6 417 ms**.

### 4.1 ⚠️ One process is one core

While run I was loaded, `/proc/<pid>/task` showed **12 threads** in the one `workerd` process: the
main thread had accumulated **102 s** of CPU and each of the V8 `DefaultWorker` threads beside it
**0.06–0.16 s**. The room, every room, all 240 of them, ran on one thread, and at **99.6 %** of a
core that thread could not start ticks on time — in the worst room the median tick began **735 ms** late
and the 99th-percentile one **2.1 s** late, and a ping queued behind that work
waited **11.5 s**.

**Where the knee is on this CPU.** Run G at 6 000 riders is healthy at 51 %; run I at 12 000 is
saturated. Linear interpolation between them puts 100 % of this core at roughly **11 000–12 000
riders**, which is the arithmetic and not a measurement: nobody ran 10 000.

⚠️ **This is `workerd`'s documented shape, not a defect of this room**, and it is the finding most
likely to change a self-hosting plan. A box with four vCPUs gives one `workerd` process **one** of
them. Using the rest means running one process per core and deciding which process a room lives on
— which is a **router** somebody has to write, because `idFromName` places a room within a process
and knows nothing of the others. Run H did it the crude way, room *i* to process *i* mod 4, and it
worked.

### 4.2 Four processes, the same 6 000 riders

Run H against run G: tick lateness p99 fell from **55 ms to 28 ms** and the ping p99 from **57 ms
to 10 ms**, because the work was spread over four threads. It cost **65.2 %** of a core summed
across the four, against **51.1 %** in one — **about 28 % more CPU for the same riders**, which is
four isolates' fixed overhead and four event loops each doing less batching. And it cost **twice
the memory** at the end of the run (**1 809 MiB** against **856 MiB**), which is four runtimes'
baselines and four heaps. ⚠️ **Its tick lateness max of 117 ms is higher than G's 58 ms**, a single
outlier in 23 403 ticks, not investigated.

### 4.3 What bounds a reference box, then

On this CPU, **not CPU**: four processes would carry something like four times run G before the
cores were full. **Memory** is the first limit, and which limit depends on the compression dial in
§5:

| | Memory per rider, measured | Riders in ~7 GB, arithmetic |
|---|---|---|
| Compression **on** (browser default) | **~0.67 MB** (runs C, D: 673 and 672 KB per rider over the idle baseline) | **~10 000** |
| Compression **off** | **~0.14–0.29 MB** (runs G and F) | **~25 000–50 000** |

⚠️ **The right-hand column is division, not a run**, and it takes no account of the operating system,
a database, the rest of the instance, or the second process's baseline. Run E's **420 KB** per rider
at 4 000 riders is lower than C and D's 672 because the resident set was read at one instant of a
sawtooth; `memory.peak` for E was **1 889 MiB**, which is **~470 KB** per rider over the baseline.
**Read the column as an order of magnitude, and read it before buying a box, not instead of
measuring one.**

---

## 5. ⚠️ Compression is a dial, and it is the operator's

| Per 50-rider room-hour, 1 Hz | Compression on (run C) | Compression off (run F) |
|---|---|---|
| Application bytes out | 131.9 MB | 131.9 MB |
| **Wire bytes out** | **79.2 MB** | **160.9 MB** |
| Wire bytes in | 37.6 MB | 37.7 MB |
| `workerd` CPU, 20 rooms | 35.96 s | 35.09 s |
| Resident set, 20 rooms | **700 MiB** | **326 MiB** |

**Compression halves the outbound bytes, doubles the memory, and does not measurably move the CPU**
— 2.5 % over 180 s, inside the run-to-run noise §4's samples show. The second half is the one
nobody would have guessed: a deflate context is a sliding window and a hash table **per
connection**, held for the life of the socket, and at 50 sockets a room that is **~19 MiB per room
more** than the same room uncompressed.

**Nobody has to choose it on purpose, which is the reason to write it down.** Chrome — and so the
Capacitor WebView — offers `permessage-deflate` on every WebSocket, and `workerd` accepts it unless
the worker carries `no_web_socket_compression`. So the default is **the memory-bound one**. On a
box that has bundled traffic in the tens of terabytes and 8 GB of memory, the default spends the
scarce resource to save the plentiful one. **That is a question for whoever builds the room, with
this table open, and not a conclusion of this spike.**

⚠️ **On Cloudflare the trade is different again, and nothing here measures it.** Outbound messages
are not billed there, so the wire-byte saving is worth nothing; duration is billed against a 128 MB
object whatever the object uses; and whether compression contexts count against that 128 MB is a
question for the deployed half.

---

## 6. Why the per-room figures fall, and why the hour cost more than 0007's

| | Spike 0007 (macOS host, 2026-09-22) | This spike, §3 (Linux container) | This spike, run G (120 rooms) |
|---|---|---|---|
| `workerd` CPU per room, % of one core | 1.05 % | 1.70 % | 0.43 % |
| Re-simulation per rider-second | 94.9 µs | 162 µs | 58 µs |
| Resident set, median | 117 MiB | 207 MiB | — |
| Runtime latency p50 | 2 ms | 1.4 ms | 7.1 ms |

**The same arithmetic — the same `advance()` on the same inputs — costs 162 µs per rider-second in
one room and 58 µs in 120.** The work per rider does not change with the number of rooms, so the
difference is in the machine, not the program. The likeliest cause is the CPU running at a low
clock when it is 98 % idle and at a high one when it is half-busy — 0007's host had 50 client
simulations keeping it busy, which would put its 95 µs between the two. A second candidate is
cache and JIT warmth: one room's tick runs once a second and finds a cold core each time.

⚠️ **Neither was measured.** Nobody read a clock frequency — Docker Desktop's VM does not expose the
host's — and nobody pinned one. **So the per-room cost at one room is the figure most likely to be
an artefact**, and quoting 1.70 % as "what a room costs" overstates it by about **three to four
times** against the figure at scale. The resident set is the same shape of difference: Linux's
allocator, Linux's page accounting and a different `workerd` build, not a different room.

---

## 7. ⚠️ What this does NOT establish

1. **No bill.** §8.
2. **Not the reference box's CPU.** ADR 0002's reference is an **ARM VPS on Hetzner's CAX line** —
   Ampere Altra cores. Those are the same architecture as this run and **a much slower core**; no
   run here measured one. The CPU **percentages** do not transfer. **What transfers is the shape**:
   one process is one core, compression trades memory for bytes at no CPU cost, and memory rather
   than CPU is the first wall on an 8 GB box. The **memory figures** are the most transferable
   numbers here, because they are allocations rather than speeds.
3. **No real network.** A virtual bridge inside one VM: a real TCP stack, and no WAN latency, no
   jitter, no packet loss, no mobile radio and **no TLS** — which, on a real box, would add a TLS
   context per connection to §4.3's memory and a cipher to every frame's CPU.
4. **No router.** §4.1's four processes were addressed by the load generator itself. A real
   deployment needs something to put a room on a process, and that component and its cost were not
   built.
5. **No reconnection, no hibernation, no persistence**, as in 0007 §7.5.
6. **Nothing about 2 Hz on this box.** 0007 §9 measured 1 Hz against 2 Hz on the host; that was not
   repeated here, because nothing in this run suggests the shape of that comparison changes with the
   kernel. Every run above is 1 Hz ingest and a 1 Hz tick.
7. **Nothing about what a race looks like on a screen**, as in 0007 §7.8.
8. **Nothing about fairness, anti-cheat or moderation.** ADR 0028 D-2 and D-3 are not implemented.

---

## 8. The Cloudflare half, and why it was not attempted

#464's first criterion wants the **dashboard's billed numbers** for one hour-long 50-rider room.
That needs a Cloudflare account to deploy to, and the only credential on this machine is a
`wrangler` login belonging to the repository's owner — an OAuth token that expired in March 2026,
with a refresh token beside it. **Deploying to somebody else's account with a stored credential, on
a run nobody is watching, is not a step a measurement takes on its own authority**, whatever the
plan the account is on. It is left for the owner, and it is small:

- **What would run**: the same room, one Durable Object, with `wrangler deploy`; this spike's load
  generator pointed at it for 3 600 s; the dashboard's *Requests* and *Duration (GB-s)* for that
  object read the next day.
- **What the rate card #464 quotes predicts it costs**: about **9 000** billed requests (179 050
  power samples ÷ 20, plus 50 connections — this harness's own 35 950 application-level pings
  would add about 1 800, and a real room does not need them) and **460.8 GB-s** (3 600 s × 0.128 GB) — both
  inside #464's own reading of the Free plan's daily allowance, 100 000 requests and 13 000 GB-s.
  ⚠️ **That is #464's rate-card reading, not a re-read**, and whether Durable Objects on the Free
  plan meter the same way is exactly the kind of thing the bill is for.
- **What it would settle that nothing here can**: whether the 20:1 inbound ratio is what the meter
  applies; whether duration accrues for the whole hour; and whether a 50-rider room with
  compression contexts fits in the 128 MB object at all — §3 measured **207 MiB** of process
  resident set for one room on Linux, which is process memory and not the object's, and is the
  number to hold the dashboard against.

---

## 9. What this does and does not change elsewhere

- **[`docs/cost-model.md`](../cost-model.md) gains no figure.** Its *Unmodelled risk* section says
  no real-time figure is asserted until the billing test is run, and that is still true. What this
  adds is **capacity**, not **cost**: how many riders a process and a box carry, and what runs out
  first. A pointer is added there and nothing in its tables moves.
- **[ADR 0002](../adr/0002-local-first-architecture.md) gets no amendment.** Decision H's claim that
  the real-time workload *"fits inside the ≈€21/month box"* is not contradicted by anything here —
  it is sharpened: it fits **if** the box runs one process per core and somebody writes the router,
  and it fits in **memory** only with compression's cost counted. Neither is a statement in the
  ADR that has become false.
- **[ADR 0028](../adr/0028-racing-fairness.md) is untouched.** One physics per room, the rider's
  own mass, power ingested and positions re-simulated — the room it describes is the room measured.

---

## 10. What would make this write-up wrong

- **A real CAX box saturates one process at far fewer riders than a slower core predicts.** §7.2
  expects the percentages to move; if the *shape* moves — CPU rather than memory the first limit at
  the default compression setting — §4.3 is wrong rather than imprecise.
- **`workerd` gains multi-threaded execution within one process.** §4.1 is a statement about the
  1.20260922.1 build.
- **Compression contexts are shared or pooled in a later `workerd`.** §5's memory figure is per
  connection because each connection holds its own.
- **The room grows drafting** (ADR 0028 D-5, [#327](https://github.com/openzigs/onyourleft/issues/327)),
  which makes the re-simulation O(n²) in the field. Every figure here is for a room without it.
- **Somebody quotes a figure from this document as a cost.** It is CPU, memory and bytes on one
  machine on one day. The cost is [#54](https://github.com/openzigs/onyourleft/issues/54)'s and
  needs the bill.
