# Spike 0037: One 50-rider race room on the self-hosted instance, an hour on loopback

- **Date measured**: **2026-11-04.** Every figure below was produced on that day on the machine in
  §2, except where a row says it is quoted from #464's comments or from a rate card. Nothing here is
  an invoice
- **Issue**: [#464](https://github.com/openzigs/onyourleft/issues/464), on its lane scope of
  2026-11-04: *"run #464 on the self-hosted adapter (the home instance's code, run locally on
  synthetic riders)"*, report CPU, memory, bandwidth and frame timing for one 50-rider race room, and
  estimate the Durable Objects cost *"from the published price list and the measured message
  counts"*. Parent [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Follows**: [spike 0007](0007-race-room-under-workerd.md) and
  [spike 0013](0013-race-rooms-on-a-small-linux-box.md), which measured a **throwaway** room under
  `workerd` that is committed nowhere. **This one measures the room that ships**: `apps/instance`'s
  self-host adapter at `main` (`48a9d448`), raced by the same tool the owner's tunnel runs used
  (`apps/instance/tools/race-load-run.ts`). Neither earlier spike is edited (`CLAUDE.md` §7)
- **Status of this document**: a **spike write-up**. It decides nothing

> ## ⚠️ What this does NOT do
>
> **There is still no Cloudflare bill.** No account was used, nothing was deployed, and no charge
> was incurred; the lane forbids all three. §6 is an **estimate**: the published rate card read on
> 2026-11-04, multiplied by message counts this run measured. #464's first and third acceptance
> criteria stay open (the bill is parked with #790 by the owner's ruling of 2026-10-15), so the
> pull request that lands this file says `Refs #464`.
>
> ⚠️ **It is loopback, not the tunnel.** The instance and the 50 riders ran on the same machine
> over `127.0.0.1`. No Cloudflare Tunnel, no home network, no TLS. §5 sets these runs beside the
> owner's tunnel runs of 2026-10-16 so that the difference can be read, and says what it does and
> does not separate.
>
> ⚠️ **No product change.** No measurement failed, so no issue was filed. The driver that started
> the instance and sampled it was a throwaway script outside the workspace, and §2.1 says exactly
> what it did so that the run can be repeated.

---

## 1. Headline

1. **The race runs clean on loopback.** Two one-hour races of 50 riders over 31 km. **All 50
   finished both times, with no disconnect, no rejoin and not one missing tick** in 179 200 frames
   per run. On a quiet host, frame lateness was **5 / 11 / 12 / 32 ms** (p50 / p95 / p99 / max).
2. **The room costs under 2 % of one core.** The room worker process used **59.65 s of CPU over
   3 598 s, 1.66 % of one core** (5-second peak 4.0 %). The main process, which serves HTTP, used
   **0.35 s**. Most of the instance's memory belongs to the **eleven idle room workers**, not to the
   room: the room worker held **122–175 MiB** (median 148) while the whole process tree read **~850 MiB**
   (§4).
3. ⚠️ **It sends about twice the upload ADR 0037 plans for.** Application payload out was
   **333.4 MB per room-hour, about 0.74 Mbit/s** for one 50-rider room, before WebSocket, TCP or
   tunnel framing. [ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) D-8 item 3
   plans upload as **≈ 0.36 Mbit/s** per room, from spike 0013's wire bytes. The room that ships
   sends **two messages per rider per tick**, a `frame` and a `standings`
   ([ADR 0051](../adr/0051-live-race-standings.md)), **1 857 bytes per rider per tick** together
   (§3). The gap is **not all `standings`**: the shipped `frame` alone is larger than the figure
   ADR 0037 planned (§3, last warning).
4. ⚠️ **On Durable Objects the same room would bill about 20 % more requests than ADR 0037 D-4's
   arithmetic.** D-4 counts the 2 Hz reports (18 000 billed requests per room-hour at 20:1) and
   omits the **tick alarm**: the Durable Object adapter sets one alarm per tick
   (`room/durable-object/room-object.ts`), and the rate card bills each **alarm invocation as a
   request, not at 20:1**. That is about **3 600** more, for **≈ 21 600** per room-hour (§6).
   **That figure is still an estimate.**

---

## 2. The machine, the software, and the method

| | |
|---|---|
| Machine | Apple **M4 Pro**, `Mac16,8`, **12 cores**, 24 GiB RAM, macOS 26.6.2. The same machine as spikes 0007 and 0013 |
| Runtime | Node **v26.13.0**, the repository's engine (`>=26 <27`) |
| Instance | `apps/instance` at **`48a9d448`**, started as `node src/main.ts`: registration `approval`, **12 room workers** (the default, one per core), compression **off** (the default), no `OYL_INSTANCE_SECRET_KEY`, so sign-in, tickets and the start were plaintext rather than sealed (§7.3) |
| Room | `room-open load-464-local --kind race --length 31000`: flat, `hoods`, the default countdown |
| Riders | **50**, `race-load-run.ts` §`raceLoad`, in one Node process **on the same machine**: each reports power at **2 Hz** (`REPORT_INTERVAL_MS`), the room fans out at **1 Hz** (`FRAME_INTERVAL_MS`), as the web client does (ADR 0037 D-4) |
| Accounts | 50 throwaway accounts made with `operator load-accounts add` and erased with `load-accounts erase` after each run: **`erased 50, remaining 0`** both times. The private keys were held in the driver's memory only and never written to disk |

### 2.1 What the throwaway driver did

1. Migrated a new SQLite database in a temporary directory, made the 50 accounts and opened the
   room with the operator CLI.
2. Started `src/main.ts` as its own process on a random loopback port and waited until it answered.
3. Sampled the instance **every 5 s with `ps`**: CPU time and resident set for `src/main.ts` **and
   each of its child processes**, and the host's one-minute load average. **30 s idle** before the
   race and 30 s after it.
4. Raced the riders with `raceLoad`. Its `onSocket` hook wrapped each rider's socket to **count
   every message by `type`, both ways**. That is the count §6 multiplies. `raceLoad`'s own report
   gave frames, missing ticks, lateness, disconnects, rejoins and application bytes.
5. Sent the instance `SIGTERM`, erased the accounts and deleted the directory.

⚠️ **The first run's sampler measured the wrong process, and it is worth recording because the
figures looked plausible.** The room workers are **child processes** of `src/main.ts`, not threads
(`room/node/worker-main.ts`, one per core). The first driver read `ps -p <main>` alone and reported
**0.44 s of CPU for the whole race**, which is the HTTP process idling while the room ran next to
it. A process list halfway through showed the busy worker. A second sampler then followed the
whole tree for the last 1 703 s of run 1, and run 2 was driven with the corrected driver from the
start. **Every CPU and memory figure below is from run 2, or from run 1's corrected second half.**
That defect is the shape `CLAUDE.md` §5 names: a figure read from a layer the work never touched.

---

## 3. The two races

| | Run 1 | **Run 2** |
|---|--:|--:|
| Host load average, one minute, median / max | 15.9 / 41.9 (other agents' work on the machine) | **2.7 / 22.6** |
| Seating, first sign-in to last rider seated | < 0.5 s | < 0.5 s |
| Time racing (includes the default 10 s countdown, which sends no frames) | 3 593 s, race over | **3 593 s, race over** |
| Finishers | 50 | **50** |
| Frames reaching riders | 179 200 (3 584 to every rider) | **179 200** (3 584 to every rider) |
| Missing ticks | 0 | **0** |
| Frame lateness p50 / p95 / p99 / max | 3 / 20 / 39 / 453 ms | **5 / 11 / 12 / 32 ms** |
| Disconnects, rejoins | 0, 0 | **0, 0** |
| Messages to the room: `hello` + `report` | 50 + 358 200 | **50 + 358 100** |
| Messages from the room: `frame`, `standings` | 179 200, 179 200 | **179 200, 179 200** |
| …and `welcome`, `countdown`, `name`, `finish` | 50, 50, 2 500, 50 | 50, 50, 2 500, 50 |
| Application bytes to the room / from it | 25.38 MB / 332.94 MB | **25.37 MB / 332.80 MB** |

**Per room-hour** (run 2, scaled by 3 600 ÷ 3 593):

| | Measured |
|---|--:|
| Messages to the room | **358 848**, of which 358 798 reports: **1.993 reports per rider-second** against the 2 Hz the client is set to |
| Messages from the room | **361 753** |
| Application bytes to the room | **25.4 MB**, 141 B per rider-second, 70.8 B per report |
| Application bytes from the room | **333.4 MB**, 1 853 B per rider-second, **1 857 B per rider per tick** for `frame` and `standings` together |
| Upload, application payload only | **92.6 kB/s ≈ 0.74 Mbit/s** per 50-rider room |

**The two runs agree on everything the room controls.** Message counts differ by 100 reports, and
bytes by under 0.05 %. Only lateness moved, and it moved with the host's load (§5).

⚠️ **The split between `frame` and `standings` bytes was not measured.** The driver counted
messages by type and bytes in total. ADR 0051's standings carry every racer's figures every tick,
so they are a large share, but this run cannot say how large.

⚠️ **The gap from ADR 0037 D-8.3's 0.36 Mbit/s is not all `standings`.** The repository already
carries a measure of the frame alone: `packages/protocol/src/frame-size.test.ts` encodes a realistic
50-rider mid-race frame at **1 132 bytes**, about **0.45 Mbit/s** of payload, up from spike 0007's
709 bytes. D-8.3's 0.36 is spike 0013's wire bytes, about 894 bytes per rider per tick, so the
`frame` that ships had already outgrown it. Subtracting, 1 857 − 1 132 leaves an *estimated* ~725
bytes for `standings`, about 1.6 times a group-ride frame, which fits ADR 0051's own bound of at most
about 1.8 times. That split is an inference from a test fixture, not a measurement of this run.

---

## 4. CPU and memory

**Run 2, the room worker** (the child process holding the room, picked as the one with the most CPU
at the end):

| | Measured |
|---|--:|
| CPU over the race, 3 598 s of wall clock | **59.65 s = 1.66 % of one core** |
| 5-second intervals, median / p90 / max | 1.80 % / 2.39 % / 4.00 % |
| By 10-minute bucket | 1.45, 1.18, 1.96, 1.47, 2.04, 1.87 % |
| Resident set, idle → race median → race max | **122 → 148 → 175 MiB** |
| Resident set, first 10 minutes / last 10 minutes, median | 175 / 151 MiB: it **settled**, it did not climb |

**Run 1's corrected second half** (1 703 s): the room worker at **1.29 %** of one core, 5-second
max 4.76 %; resident set 70–139 MiB, median 129 MiB.

**The rest of the instance:**

- `src/main.ts`, which served the 50 sign-ins, the tickets and the start: **0.35 s** of CPU during
  the race; resident set 176–197 MiB early, **64–81 MiB** after minute 17.
- **Eleven idle room workers**: 0.28–0.31 s of CPU each over the whole of run 2, and the same in run 1. Their resident sets fell
  **from ~120 MiB to 57 MiB each** over the first ~15 minutes with no work to do, and then held.
  Probably the OS reclaiming pages rather than the instance freeing anything, but a `ps` resident
  set cannot tell that apart from V8 shrinking its heap or pages being compressed or swapped, and
  this run did not separate them.
- **The whole tree** (13 processes) read **1 618 MiB** at the start, fell to **~835 MiB** by
  minute 17, and ended at **861 MiB**. ⚠️ **Summed resident sets overstate memory.** Every Node
  process maps the same runtime pages, and `ps` counts them once per process. The tree's figure is
  an upper bound, not a requirement.

⚠️ **This is the likeliest reading of the home instance's 725–863 MiB** in the owner's 50 km run
(#464, 2026-10-16): most of it is idle room workers, one per core, rather than the race. **Not
established.** That run was in a container whose core count this spike did not read, and the
figure came from a different tool. `OYL_INSTANCE_ROOM_WORKERS` sets the worker count.

**Set against spike 0007's throwaway room** (37.81 s of CPU per room-hour at 1 Hz ingest under
`workerd`): the shipped room used about **1.6×** that CPU, at **twice** the ingest and with
`standings` added. These are different runtimes, encodings and room code, so the ratio is a
reading, not a regression measured.

---

## 5. Beside the owner's tunnel runs

The tunnel figures are **quoted from the owner's comments on #464 of 2026-10-16** and were not
re-measured here.

| | Tunnel, 50 km, 2026-10-16 (quoted) | **Loopback, 31 km, run 2** |
|---|--:|--:|
| Where the riders were | the same Mac as the instance, through the public hostname | the same Mac, `127.0.0.1` |
| Time racing | 5 787 s | 3 593 s |
| Finishers | 50 | 50 |
| Missing ticks | 32 of 288 868 frames | **0** of 179 200 |
| Frame lateness p50 / p95 / p99 / max | 18 / 51 / 96 / 781 ms | **5 / 11 / 12 / 32 ms** |
| Disconnects | 30, all 1006, in three bursts | **0** |
| Bytes from the room per hour | 541 MB ÷ 1.61 h ≈ **337 MB** | **333 MB** |
| Instance memory | 725 → 863 MiB | tree 1 618 → 861 MiB; room worker 122 → 175 MiB |

**What this does separate.** The same room code, the same tool and the same field on the same
machine, without the tunnel, dropped **nobody** for an hour, on a quiet host (run 2) and on a busy
one (run 1, load average up to 41.9). The busy-host run is the more relevant one: the owner's run
reported a load average up to 28 from other work. So **a busy Mac on its own did not drop riders
here**. That is consistent with the owner's reading that the drops came from the path between the
riders and the instance.

**What it does not separate.** Loopback removes the tunnel, the home network and TLS together, so
it cannot say which of the three dropped the sockets. The Windows-riders run in #464's comment of
2026-10-17 is still the run that splits them. And the owner's instance at `589bf4be` is older than
`48a9d448`: anything in between that touched the room is not controlled for.

**Bytes agree to about 1 %** between the tunnel run and loopback: the room sends what it sends
whatever the path.

---

## 6. ⚠️ An ESTIMATE of the Durable Objects cost, from the measured counts

**Rate card read on 2026-11-04** from developers.cloudflare.com/durable-objects/platform/pricing/
(page dated *"Last Updated: October 18, 2026"*):

- **Free plan**: 100 000 requests/day and 13 000 GB-s/day. SQLite-backed objects only: 100 000 rows
  written/day.
- **Paid plan**: 1 000 000 requests/month, then **$0.15/million**. 400 000 GB-s/month, then
  **$12.50/million GB-s**. SQLite rows written: 50 million/month included, then $1.00/million.
- A request *"includes HTTP requests, RPC sessions, WebSocket messages, and **alarm
  invocations**"*. *"A 20:1 ratio is applied to **incoming WebSocket messages**"*. *"There is no
  charge for outgoing WebSocket messages."* *"Each `setAlarm()` is billed as a single row
  written."* Duration bills *"the 128 MB of memory your Durable Object is allocated, regardless of
  actual usage"* while the object is not eligible to hibernate. The page's own examples turn 128 MB
  into **0.128 GB**.

**The Durable Object adapter's ticks are alarms.** `room/durable-object/room-object.ts` sets the
next alarm on every tick while the room runs, so a running race costs **one alarm invocation and
one row written per second**, and never hibernates. The adapter itself was **not run**: it is
*"built and not deployed"*. The counts below are the self-host adapter's, which runs the same core.

**One 50-rider room-hour:**

| | Count | Billed as |
|---|--:|--:|
| Incoming WebSocket messages, measured: 358 798 reports + 50 hellos | 358 848 | ÷ 20 = **17 942** requests |
| Tick alarms, one per second | ≈ 3 600 | **3 600** requests, not divided |
| HTTP to the object: 50 socket upgrades, 50 tickets, 1 start | 101 | **101** requests |
| **Billed requests** | | **≈ 21 643** |
| Outgoing WebSocket messages, measured | 361 753 | **$0**, not charged |
| `setAlarm` rows written | ≈ 3 600 | rows |
| Duration: 3 600 s × 0.128 GB | | **460.8 GB-s** |

**Per month, on #464's own scenarios** (one-hour races of 50 riders, 30 days, Paid plan, $5/month
base):

| Riders per day | Room-hours / month | Requests | Duration | Rows written | **Estimate** | #464's rate-card figure |
|---|--:|--:|--:|--:|--:|--:|
| 1 000 (20 races) | 600 | 12.99 M − 1 M = 11.99 M → **$1.80** | 276 480 GB-s, inside 400 000 → **$0** | 2.16 M, inside 50 M → $0 | **≈ $6.80** | ≈ $5.7 |
| 10 000 (200 races) | 6 000 | 129.86 M − 1 M → **$19.33** | 2 764 800 − 400 000 → **$29.56** | 21.6 M, inside 50 M → $0 | **≈ $53.90** | ≈ $43 |

**On the Free plan**, one room-hour uses about 21.6 % of the day's requests, 3.5 % of its duration
and 3.6 % of its rows written. **Requests bind first: about four one-hour races a day.**

**Where this differs from what the repository already says:**

1. **#464's body assumed 1 Hz ingest**, 9 000 billed requests per room-hour. The room ingests at 2 Hz
   (ADR 0037 D-4), so the reports alone are 17 942.
2. ⚠️ **[ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) D-4's table counts the
   reports and not the alarms.** Its 18 000 billed requests per room-hour becomes ≈ 21 643, **20 %
   more**, and its *"room-hours inside the monthly request allowance ≈ 55"* becomes **≈ 46**. Its
   duration row uses 0.125 GB where the page's examples use 0.128 GB, a 2.4 % difference.
3. **The conclusion of #464 stands.** Outbound fan-out, 361 753 messages and 333 MB per room-hour,
   is billed at **$0** on this rate card. The bill is the inbound ingest plus the clock.

⚠️ **Every figure in this section is rate-card arithmetic over measured counts. It is not an
invoice.** It cannot say whether the meter applies 20:1 to messages arriving on hibernatable
sockets the way the page reads, whether alarm invocations count as the page says, or whether a
50-rider room fits in the 128 MB it is billed against. The room worker here held 122–175 MiB (race median 148) as a
whole Node process, which is not an isolate's heap. [ADR 0002](../adr/0002-local-first-architecture.md)
decision H's *"one room, one known message count, one bill"* still needs that bill, and §3 now
supplies the known message count.

---

## 7. ⚠️ What this does NOT establish

1. **No bill** (§6).
2. **No real network.** Loopback has no WAN latency, jitter, loss or TLS. The lateness figures are
   the room's scheduling and the host's, not a rider's.
3. **The riders shared the machine with the instance**, and in run 1 with other agents' work. The
   room worker's CPU is read per process, so the riders' own CPU is not in it. Lateness includes
   their contention.
4. **Plaintext, not sealed.** No `OYL_INSTANCE_SECRET_KEY` was set, so sign-in, tickets and the
   start were not sealed (#1210). Those are before the race and once per rider. The race's socket
   messages are the same either way, but the HTTP figures are not the home instance's.
5. **Compression off**, the instance's default. Spike 0013 §5 measured that compression roughly
   halves outbound bytes and costs memory per connection. Not measured for this room.
6. **One room.** Nothing here measures many rooms on one worker, or the router across workers.
7. **Not a reference box.** An M4 Pro is not ADR 0002's ARM VPS. The shape transfers: the room is a
   small fraction of one core, and upload is the first limit on a home connection. The percentages
   do not.
8. **Not the owner's instance version.** `48a9d448`, not the home instance's `589bf4be`.
9. **No rider's screen was watched.** Whether 1 Hz fan-out with interpolation *looks* smooth is
   #782's question, and nothing here answers it.

---

## 8. What this does and does not change elsewhere

- **[`docs/cost-model.md`](../cost-model.md) gains no figure.** It asserts no real-time cost until
  the billing test runs, and §6 is not that test. Criterion 3 of #464 stays open.
- **[ADR 0002](../adr/0002-local-first-architecture.md) gets no amendment.** Decision H's
  statements remain true: the bill is still owed, and duration still accrues for a ticking room.
- ⚠️ **[ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) carries two figures this
  run contradicts.** D-4's billed requests per room-hour omit the tick alarms (§6, item 2). D-8
  item 3's upload per 50-rider room, ≈ 0.36 Mbit/s and *"at 10 Mbit/s that is ~27 rooms"*, is
  exceeded: the payload alone is **≈ 0.74 Mbit/s**, so about **13 rooms** at 10 Mbit/s before
  framing. Part of that is `standings`, which spike 0013 did not have, and part is the `frame`
  itself, which `frame-size.test.ts` puts at about 0.45 Mbit/s (§3). **This spike does not amend the ADR.** An ADR's body is never edited, and an appended
  amendment is the owner's call (ADR 0013). It is recorded here so that the amendment, if it is
  made, has a measurement to cite.

---

## 9. What would make this write-up wrong

- **The meter does not bill what the page says.** §6 rests on the page's own words: 20:1 inbound,
  alarms as requests, outbound free. A bill that disagrees corrects §6, and §3's counts stand.
- **The room's messages change.** A smaller `standings`, a slower one, or a frame that carries less
  moves §3's bytes, and §1 item 3 with them. A different tick rate moves both the bytes and §6's
  alarm row.
- **The tunnel run's drops came from the busy riders' machine after all.** Run 1 had no drops at a
  load average up to 41.9, which points away from that. But loopback's riders do no TLS and no
  network I/O through a tunnel client, so it does not rule it out.
- **Somebody quotes §6 as a cost.** It is an estimate over measured counts. The cost is
  [#54](https://github.com/openzigs/onyourleft/issues/54)'s and needs the bill.
