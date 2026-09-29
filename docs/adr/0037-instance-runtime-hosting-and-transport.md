# ADR 0037: The instance's runtime, hosting, database and real-time transport — Node on the box, WebSocket, SQLite, and the owner's home machine first

- **Status**: Accepted. The product and hosting questions are the owner's and were answered on
  2026-09-28; they are quoted verbatim in Context. The engineering choices below are the author's,
  each made against a measurement or a document read on the date given. **Nothing is built by this
  ADR.**
- **Date**: 2026-09-29
- **Deciders**: **the owner**, on hosting (ruling 1 and the Q3, Q4, Q6 and Q7 answers), on compression
  (Q16), on licences (Q11) and on the package name (Q15), in three comments on #16 of 2026-09-28:
  [the rulings](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5879636643),
  [the answers to Q1–Q7, Q12 and Q13](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5880008335)
  and [the acceptance of Q8–Q11 and Q14–Q18](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5880031406).
  **The author**, on the runtime, the process model, the tick rates, the database, the driver and
  the migration rule. Each is marked *the author's choice* where it departs from a recommendation
  in #763's body or where #763 left it open
- **Issue**: [#763](https://github.com/openzigs/onyourleft/issues/763), in bundle
  [#825](https://github.com/openzigs/onyourleft/issues/825)
- **Number**: **0037**, reserved with 0036, 0038 and 0039 in the same pull request — see
  [ADR 0036](0036-a-self-hostable-instance-server-now.md)'s Number line
- **Supersedes**: nothing. **Discharges two deferrals** of [ADR 0005](0005-tech-stack.md): F's
  *"Phase 3, the instance — deferred to #7"* (the instance database and migration tool) and J's
  *"Real-time transport: deferred to #16"*. ADR 0005 gains an appended amendment pointing here
  ([ADR 0013](0013-adr-amendments.md)). ADR 0005 F's three constraints on the instance database are
  **kept and met**, not replaced — see D-5
- **Rests on**: [spike 0007](../spikes/0007-race-room-under-workerd.md) (one room for an hour, and
  1 Hz against 2 Hz) and [spike 0013](../spikes/0013-race-rooms-on-a-small-linux-box.md) (many rooms,
  one process per core, and compression)
- **Relates to**: [ADR 0036](0036-a-self-hostable-instance-server-now.md) (why there is an instance),
  [ADR 0002](0002-local-first-architecture.md) A and H,
  [ADR 0015](0015-dependency-licences.md), [ADR 0025](0025-app-store-additional-permission.md) D-5,
  [ADR 0028](0028-racing-fairness.md) D-2

---

## Context

### What the owner decided, quoted so it is not argued again

Ruling 1, 2026-09-28:

> **Hosting:** self-hostable first. One small open-source server anyone can run on a cheap Linux box.
> The same code may also deploy to a managed platform (for example Cloudflare Durable Objects) for the
> project's own public instance. Spikes 0007 and 0013 hold the measurements.

The answers of the same evening, verbatim:

> - **Q3 and Q6, hosting to start:** the project's instance **starts on the owner's local Windows
>   machine**, running Linux inside it (WSL or a **Docker container**), and is reached through a
>   **Cloudflare Tunnel**. There is no hosting bill to begin with. This makes a **Docker image** of
>   `apps/instance` the first deploy target. #790's managed deploy and a paid box come later. The
>   Durable Object adapter (#781) is still built, but is not deployed at first. Q7 (what the managed
>   platform hosts) is therefore moot for now.
> - **Q4, room size:** 50, configurable up to 100.

And the owner's acceptance of the planner's recommendations, verbatim:

> **Owner, 2026-09-28: the planner's recommendations for Q8–Q11 and Q14–Q18 are accepted as
> written.** Those are: no live standings list, only the gap to one chosen rider and the finish order
> afterwards; no keep-together in the first group ride; the patent-risk acceptance covers drafting;
> the room server is AGPL and the shared maths is Apache; cross-instance racing is deferred to #56;
> the server is `apps/instance`; WebSocket compression is off by default; only W/kg is shown beside
> other riders' names; no bot pacer in rooms. Voice chat is to be evaluated in #794.

### What ADR 0005 left for this decision

ADR 0005 F deferred the instance database to #7 with three constraints, all still binding: the
instance schema **mirrors the local store's shape**; the migration tool supports **reversible
migrations with a tested down path** (which is why `drizzle-kit` was eliminated — it generates no
down migrations); and the data layer is **permissively licensed or on the AGPL side**. ADR 0005 J
deferred the real-time transport to #16.

### What was read for this ADR, and when

| Fact | Where it was read | Date |
|---|---|---|
| `ws` 8.22.0 is `MIT` and has no runtime dependency | `npm view ws version license dependencies` | 2026-09-29 |
| `ws`: *"The extension is disabled by default on the server and enabled by default on the client. It adds a significant overhead in terms of performance and memory consumption so we suggest to enable it only if it is really needed."* | `npm view ws@8.22.0 readme` | 2026-09-29 |
| `kysely` 0.29.6 is `MIT` and has no runtime dependency | `npm view kysely` | 2026-09-29 |
| `better-sqlite3` 13.0.3 is `MIT`, depends on `node-addon-api` (`MIT`), and builds a native addon with `node-gyp` | `npm view better-sqlite3 scripts dependencies`; `npm view node-addon-api license` | 2026-09-29 |
| `pg` 8.23.0 is `MIT`; `postgres` 3.4.9 is `Unlicense` | `npm view` | 2026-09-29 |
| ⚠️ **`node:sqlite` is Stability 1.2, Release candidate, since Node v24.15.0** — the history table reads *"v24.15.0: SQLite is now a release candidate."* | [nodejs.org, v24 docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) (page for v24.21.0) | 2026-09-29 |
| `node:sqlite` loads on Node **24.20.0** with **no** experimental warning, and reports SQLite **3.53.4** | `node -e` against an in-memory database, on this machine | 2026-09-29 |
| `node:quic` is not a built-in on Node 24.20.0 (`ERR_UNKNOWN_BUILTIN_MODULE`) | `node -e "require('node:quic')"` | 2026-09-29 |
| Durable Objects rate card: requests *"1 million / month, + $0.15/million"*; duration *"400,000 GB-s / month, + $12.50/million GB-s"*; *"a 20:1 ratio is applied to incoming WebSocket messages"*; *"no charge for outgoing WebSocket messages, nor for incoming WebSocket protocol pings"*; duration is billed on *"the 128 MB of memory your Durable Object is allocated, regardless of actual usage"* | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 2026-09-29 |
| Cloudflare: *"Cloudflare will close a WebSocket connection when no data is transmitted in either direction for a period of time."* and *"When Cloudflare releases new code to its global network, we may restart servers, which terminates WebSockets connections."* The page gives **no** number for the idle period | [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/) | 2026-09-29 |

⚠️ **One finding corrects #763's research.** #763 recorded that `node:sqlite` reaches Stability 1.2
*"only from Node 25.7.0"* and that it was *"not verified which stability Node 24.x reports"*. The
v24 documentation says 1.2 from **v24.15.0**, and a run on 24.20.0 shows no experimental warning.
D-5 is decided on that.

⚠️ **One figure was not verified first-hand.** A **100-second** idle timeout for proxied WebSockets on
Cloudflare's Free and Pro plans is widely reported in third-party guides and in a search summary, but
Cloudflare's own WebSocket page read on 2026-09-29 states no number, and its connection-limits page
lists HTTP/2 and proxy idle timeouts (400 s and 900 s) and nothing for WebSockets. D-7 is written so
that it does not depend on the number.

---

## Decision

### D-1 — On the box, the runtime is **Node 24**, the repository's own

**Not `workerd`.** Rooms, HTTP and storage are one Node application in `apps/instance`, on the Node
version `.nvmrc` pins.

- **Why not `workerd` on the box**: spike 0013 §4.1 found one `workerd` process runs every room on one
  thread, so a four-core box needs a process per core **and a router** either way. Node gives the
  same shape with the repository's toolchain, its typechecker, its test runner and `node:sqlite`,
  and no second runtime to pin. `workerd`'s README also asks for a sandbox around *"possibly-malicious
  code"* (quoted in #763, not re-read here); that is not a blocker for our own code, and it is not a
  reason for it either.
- **What survives from `workerd`**: the Durable Object adapter (D-2) runs under it in tests
  ([#781](https://github.com/openzigs/onyourleft/issues/781)), so a room's behaviour is held to one
  conformance suite on both runtimes.

### D-2 — A portable core and two adapters

**The room and API logic are written against small ports** — a clock, a socket, a SQL connection and
a blob store — and nothing in the core names Node, `ws` or Cloudflare.

| | Adapter 1: self-host (**built and deployed first**) | Adapter 2: managed (**built, not deployed**) |
|---|---|---|
| Runtime | Node 24 | Cloudflare Worker, one Durable Object per room |
| Socket | `ws` | the platform's WebSocket |
| SQL | SQLite through `node:sqlite` (D-5) | Durable Object SQLite, or D1 |
| Blobs | local disk | R2 |
| Owner | [#780](https://github.com/openzigs/onyourleft/issues/780), [#769](https://github.com/openzigs/onyourleft/issues/769), [#770](https://github.com/openzigs/onyourleft/issues/770) | [#781](https://github.com/openzigs/onyourleft/issues/781) |

**Whether the managed adapter hosts rooms only or the whole instance is NOT decided here.** The
owner's Q7 answer made it moot for now; it is left to whoever writes
[#790](https://github.com/openzigs/onyourleft/issues/790). The HTTP handler is a fetch-style function
(`Request → Response`) so that either answer is open ([#767](https://github.com/openzigs/onyourleft/issues/767)).

**Licences (Q11)**: the room server is `apps/instance`, `AGPL-3.0-or-later`. The maths both sides must
agree on — `packages/physics`, and the wire format in `packages/protocol`
([#768](https://github.com/openzigs/onyourleft/issues/768)) — is `Apache-2.0`.

### D-3 — The transport is **WebSocket**, with compression **off** by default

| Option | Verdict |
|---|---|
| **WebSocket** | **Chosen.** The only option both adapters serve today. Every browser and the Capacitor WebView have it |
| WebTransport | **Not now.** Node 24 has no `node:quic` (read above), and #763 records Durable Objects documenting WebSockets only. Its advantage — unreliable datagrams with no head-of-line blocking — matters far less at 1–2 Hz than in a 60 Hz game. Revisit when both runtimes serve it |
| WebRTC data channels, client to server | **Rejected.** A server-side WebRTC stack (`werift`, MIT; or `node-datachannel`, MPL-2.0 and native) plus STUN and TURN, to buy what a WebSocket already gives. Between people it is ADR 0002 F's and stays ruled out |

- **Frames are JSON**, defined and bounded by `packages/protocol` (#768), with a version handshake.
- **`permessage-deflate` is OFF by default** (Q16), as an **operator setting**. On `ws` that is the
  library's own server default, so the setting turns it **on**. What the operator trades, from
  spike 0013 §5, per 50-rider room-hour at 1 Hz: compression **halves outbound wire bytes** (160.9 MB
  to 79.2 MB) and **doubles resident memory** (326 to 700 MiB for 20 rooms over 180 s). On a home
  connection the upload is the scarce resource (D-7), so an operator whose upload binds before memory
  should turn it on; on a rented box with tens of terabytes of bundled traffic, leave it off.

### D-4 — The tick model: server-authoritative, ingest at 2 Hz, fan-out at 1 Hz, clients interpolate

1. **The room is authoritative** (ADR 0028 D-2): it re-simulates every rider and its position is the
   one that counts ([#779](https://github.com/openzigs/onyourleft/issues/779)).
2. **Ingest at 2 Hz**: each client sends its latest power sample twice a second.
3. **Fan-out at 1 Hz**: the room ticks and broadcasts one frame per rider per tick, carrying the whole
   field (spike 0007 §3's batching).
4. **Clients interpolate** between the last two frames ([#782](https://github.com/openzigs/onyourleft/issues/782)),
   #323's `drawnAt` idea applied to other riders, which costs no bandwidth.

**Why**: spike 0007 §9 run C. Doubling ingest alone cut the fan-out wait's median from **526 ms to
274 ms** with outbound bytes and CPU unchanged inside the noise. On the self-host box inbound bytes
are the cheap direction.

**What it costs on Durable Objects, as arithmetic a reader can recompute** (rate card above). One
50-rider room for one hour:

| | 2 Hz ingest (this decision) | 1 Hz ingest |
|---|--:|--:|
| Incoming messages, 50 × rate × 3 600 s | 360 000 | 180 000 |
| Billed requests at 20:1 | **18 000** | 9 000 |
| Request cost beyond the allowance, × $0.15 / 1 000 000 | **$0.00270** | $0.00135 |
| Duration, 0.125 GB × 3 600 s | 450 GB-s | 450 GB-s |
| Duration cost beyond the allowance, × $12.50 / 1 000 000 | **$0.005625** | $0.005625 |
| **Per room-hour, both halves** | **≈ $0.0083** | ≈ $0.0070 |
| Room-hours inside the monthly **request** allowance (1 000 000 ÷ billed per hour) | **≈ 55** | ≈ 111 |
| Room-hours inside the monthly **duration** allowance (400 000 ÷ 450) | ≈ 889 | ≈ 889 |

- **2 Hz ingest costs $0.00135 more per room-hour** than 1 Hz, and halves how many room-hours fit in
  the included requests. That is the price of the latency in run C.
- **A ticking room never hibernates.** #763 quotes the pricing page: *"Events such as alarms, incoming
  requests, and scheduled callbacks prevent hibernation. This includes `setTimeout` and
  `setInterval`"* (read 2026-09-28 in #763, not re-read here). So duration runs for the whole race.
  An idle lobby can hibernate.
- **The keepalive must be a WebSocket protocol ping** on this adapter, because the rate card does not
  charge for incoming protocol pings and would charge for an application-level heartbeat.
- A **100-rider room** doubles the billed requests (36 000, $0.0054) and keeps one object's duration.
- ⚠️ **This is a rate card, not an invoice.** It excludes the plan's own monthly fee, storage, and
  anything spike 0007 §8 names as unmeasured, above all whether a 50-rider room fits in the 128 MB it
  is billed against. [ADR 0002](0002-local-first-architecture.md) H still owes a real bill, and
  [#464](https://github.com/openzigs/onyourleft/issues/464)'s first criterion is still open.

### D-5 — The database is **SQLite** in WAL mode, through **Kysely**, with **one writer process**

- **SQLite** is the dialect both adapters share (Durable Object storage and D1 are SQLite). It needs
  no second service, which ADR 0002 A's *"must not require … a managed database"* asks for.
- **WAL mode, one writer**: one process owns the database file and every write goes through it.
  Room processes (D-6) do not write the database during a race; results reach the writer at the end.
- **Kysely** 0.29.6 (MIT) is the query builder and the migrator. It has an `up`/`down` migrator and
  `migrateDown()`, and it supports SQLite and Postgres, so the Postgres adapter below stays open.
- **The driver is `node:sqlite`** — *the author's choice*, where #763 recommended `better-sqlite3`.
  It is part of Node, so it adds **no dependency**, no licence to check and **no native install step**,
  and it is a release candidate on the pinned Node line (read above). ⚠️ **Not verified**: whether
  Kysely 0.29.6's `SqliteDialect` accepts a `DatabaseSync` as it is or needs a thin adapter to the
  `better-sqlite3`-shaped interface it documents. [#769](https://github.com/openzigs/onyourleft/issues/769)
  settles that first. **The fallback is `better-sqlite3`** 13.0.3 (MIT), whose `node-gyp` build is a
  `pnpm-workspace.yaml` `allowBuilds` decision: the answer, if it is ever adopted, is **`true`**,
  because the addon is the package.
- **Postgres is named as a later adapter and not built.** `pg` (MIT) is the one it would use.
  `postgres` is `Unlicense`, which [ADR 0016](0016-unlicense.md) admits under `apps/` only; it is not
  chosen, so the question does not arise.
- **ADR 0005 F's three constraints, met**: the schema mirrors `packages/store`'s record shapes
  (#769 derives it from them); every migration has a tested down (D-6); SQLite, Kysely and
  `node:sqlite` are permissive or part of the runtime.
- **Backups**: Litestream (Apache-2.0, per #763's read; not re-read here) streams SQLite to object
  storage. It is a binary in the image, not an npm dependency. [#807](https://github.com/openzigs/onyourleft/issues/807)
  and [#791](https://github.com/openzigs/onyourleft/issues/791) decide it.

### D-6 — Every migration has a `down`, and a test proves it

**Kysely makes `down` optional; this project does not.** Every migration exports both `up` and
`down`, and a test applies **`up → down → up`** to a fixture for **each** migration and reads the
schema and the fixture rows back after each step. A migration with no `down` fails that test. This is
ADR 0005 F and `CLAUDE.md` §5 applied to the instance, and it is #769's to build.

### D-7 — The process model, as numbers, and what the operator should expect

**One process per core for rooms, and a router that places a room on a process** (spike 0013 §4.1).
Spike 0013 run H did it by room *i* to process *i* mod 4, and it worked. How a socket reaches its
room's process is [#780](https://github.com/openzigs/onyourleft/issues/780)'s to build. The writer
(D-5) and HTTP live in one more process.

**Rooms hold 50 riders by default, configurable up to 100** (Q4), as an operator setting. Fan-out
bytes grow with the square of the field: spike 0007 A → D measured four times the riders as 15.4
times the bytes, so a 100-rider room is about four times a 50-rider room's outbound bytes.

**What a box carries**, from spike 0013 — both memory rows quoted, the pessimistic one first:

| Bound | Figure | Source |
|---|---|---|
| CPU, one process | healthy at **6 000** riders (51 % of a core), saturated at **~11 000–12 000** | spike 0013 §4, runs G and I. Measured on an M4 Pro inside Docker Desktop, **not** on a rented box, so the percentages do not transfer |
| Memory, compression on, **the hour** | **~3.3 MiB per rider**, so **~2 000 riders** in ~7 GB | spike 0013 §4.3 — the **pessimistic** end |
| Memory, compression on, 180 s runs | ~0.67 MiB per rider, so ~10 000 riders in ~7 GB | spike 0013 §4.3 — the optimistic end |
| Memory, compression **off** (the default), 180 s runs | ~0.14–0.29 MiB per rider | spike 0013 §4.3. ⚠️ **No hour was run with compression off** |

**The operator should plan on ~2 000 riders — 40 rooms of 50 — on a 4-core, ~8 GB box**, with
compression off or on, until [#792](https://github.com/openzigs/onyourleft/issues/792) runs many rooms
for an hour. *The author's choice*: the compression-off rows are lower, but nothing measured whether
they climb over an hour the way the compressed hour did (five times its 180-second figure), so the
only planning figure with an hour behind it is the one quoted. #792 is the run that narrows it.

### D-8 — The first deployment is a Docker image on the owner's home machine, behind a Cloudflare Tunnel

Per Q3 and Q6: a **Docker image** of `apps/instance`, run on the owner's Windows machine (WSL or
Docker), reached through a **Cloudflare Tunnel**, with no hosting bill
([#807](https://github.com/openzigs/onyourleft/issues/807)).

**What the tunnel constrains, and what follows:**

1. **An idle WebSocket is closed.** Cloudflare's own page says so and gives no number (Context). So a
   **keepalive is mandatory**: the client sends a WebSocket ping at least every **30 seconds**
   whenever nothing else has been sent. *The author's choice* of 30 s: it clears the
   third-party-reported 100 s by more than three times without relying on it. During a race the 2 Hz
   ingest already keeps a socket busy; the lobby is what idles.
2. **Connections are dropped when Cloudflare restarts its servers.** So **rejoin is mandatory**, not
   an edge case: the room coasts a dropped rider and restores them on rejoin (#779), and the client
   reconnects and rejoins without the rider doing anything (#782).
3. **The home connection's upload bandwidth is the first capacity limit**, before CPU or memory.
   Spike 0013 §5 measured outbound **wire** bytes per 50-rider room-hour at 1 Hz fan-out:

   | | Wire bytes out per room-hour | Per second | Upload per 50-rider room |
   |---|--:|--:|--:|
   | Compression off (the default) | 160.9 MB | 44 694 B/s | **≈ 0.36 Mbit/s** |
   | Compression on | 79.2 MB | 22 000 B/s | ≈ 0.18 Mbit/s |

   So at an upload of *U* Mbit/s, a home instance carries at most about *U* ÷ 0.36 rooms of 50
   uncompressed, **before** any headroom and before the tunnel's own framing, which nothing here
   measured. At 10 Mbit/s that is ~27 rooms; a 100-rider room costs about four times a 50-rider one
   (D-7). **The owner's actual upload has not been measured**; #807 measures it and states the
   figure. Inbound (the 2 Hz ingest) is the download direction and is not the limit: spike 0013 §3
   measured ~37 MB per room-hour at 1 Hz, ACKs included.

### D-9 — Licences of what this ADR adopts, predicted before install

| Package | Version read | SPDX, read 2026-09-29 | Lands in | Closure | `DEP001` / `DEP002` prediction | Install script |
|---|---|---|---|---|---|---|
| `ws` | 8.22.0 | `MIT` | `apps/instance` | distributed | permissive: passes both | none |
| `kysely` | 0.29.6 | `MIT` | `apps/instance` | distributed | permissive: passes both | none |
| `node:sqlite` | Node 24 built-in | — (part of Node) | — | — | not a dependency | — |
| `better-sqlite3` | 13.0.3 | `MIT` | `apps/instance`, **only if D-5's fallback is taken** | distributed | permissive: passes both | a `node-gyp` build: **`allowBuilds: true`** |
| `node-addon-api` | (with the above) | `MIT` | the same | distributed | passes both | none |
| `pg` | 8.23.0 | `MIT` | **not adopted** | — | — | — |

The Durable Object adapter's own tooling (`workerd`, and whatever #781 needs to run it) is #781's to
record in the same shape. ⚠️ **What ships to riders is unchanged**: none of these is in `apps/web`'s
or `apps/mobile`'s closure, so the third-party notices a rider reads
(`apps/web/public/licences/third-party.txt`) must not change because of them. `check:notices` holds
that, and #767's criterion says so.

---

## Consequences

### What this enables

- #767 can scaffold `apps/instance` on a decided runtime; #768, #769, #779, #780 and #781 each have a
  shape to build against.
- A self-hoster needs Docker and nothing else: no managed database, no object store, no CDN account,
  which is ADR 0002 A's list of what an instance must not require.

### What this costs, stated plainly

- **A router nobody has written** (D-7). Without it a four-core box uses one core for rooms.
- **Two adapters and a conformance suite**, where one would do for the first deployment. The second
  is built so the managed option stays real; it is not deployed.
- **Upload-bound hosting at first** (D-8.3). A home connection carries tens of rooms, not hundreds.
- **`node:sqlite` is a release candidate, not stable.** A minor breaking change before 1.0 lands in
  one module (#769's SQL port) and nowhere else, because of D-2.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #767 | Fetch-style handler; `GET /source` ([ADR 0036](0036-a-self-hostable-instance-server-now.md) D-6); no dependency outside D-9 without a row like D-9's |
| #768 | JSON frames, bounded decoding, a version handshake |
| #769 | `node:sqlite` first, Kysely, the `up → down → up` test per migration (D-6); settles the dialect question in D-5 before anything else |
| #779 | Server-authoritative; coasts a dropped rider and restores a rejoin (D-8.2) |
| #780 | Process per core with a router; compression off by default and an operator setting; room size 50, up to 100 |
| #781 | Mounts the same core under a Durable Object; one conformance suite; protocol pings for keepalive |
| #782 | 2 Hz ingest, interpolation, keepalive at most every 30 s, automatic rejoin |
| #792 | Runs many rooms for an hour with compression on and off, and replaces D-7's planning figure |
| #807 | Measures the home upload and states it; Docker image; tunnel with WebSockets |

---

## What would make this ADR wrong

- **WebTransport reaches both Node and `workerd`.** Then D-3's reason to prefer WebSocket weakens, and
  a datagram transport becomes worth measuring for the fan-out.
- **The many-room hour (#792) shows memory at or above ~3 MiB per rider with compression off.** Then
  compression was never the memory story, D-7's planning figure is optimistic, and the box size
  ADR 0002 A names is too small.
- **`node:sqlite` regresses, or Kysely cannot drive it.** Then D-5's fallback, `better-sqlite3`, is
  taken, with its `allowBuilds` answer.
- **The home upload cannot carry one room reliably through the tunnel.** Then D-8 fails, and a paid
  box becomes the owner's decision earlier than planned
  ([ADR 0036](0036-a-self-hostable-instance-server-now.md) D-7).
- **A real Durable Objects bill differs from D-4's arithmetic.** Then the rate card was not the whole
  story, and ADR 0002 H's bill is what corrects it.
