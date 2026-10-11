# Spike 0023: an analysis job's round trip, sealed, over loopback, and what the tunnel run still needs

- **Date measured**: **2026-10-11.** Every figure in §4 and §5 was produced that day on the machine
  in §3. Every other figure is cited to the file it came from
- **Issue**: [#1235](https://github.com/openzigs/onyourleft/issues/1235). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092). It is the *"measured round-trip
  time"* the owner required on [#389](https://github.com/openzigs/onyourleft/issues/389)
  (2026-09-30) and applied to the agent half of
  [ADR 0048](../adr/0048-workouts-that-change-during-the-ride.md) by ruling Q3 on
  [#1233](https://github.com/openzigs/onyourleft/issues/1233)
- **Rests on it**: [#1243](https://github.com/openzigs/onyourleft/issues/1243) and
  [#1244](https://github.com/openzigs/onyourleft/issues/1244), which stay blocked: §1 says why this
  write-up does not unblock them
- **Number**: **0023.** `docs/spikes/` holds 0001 to 0020 and 0022 on `main`. 0021 is claimed by
  [#1057](https://github.com/openzigs/onyourleft/issues/1057), as spike 0022 records. No open pull
  request carried a 0023 on 2026-10-11
- **Status of this document**: a **spike write-up**. It measures and decides nothing

> ## ⚠️ The answer in one paragraph
>
> **The measurement #1235 asks for was not made.** Nothing here went through the Cloudflare tunnel
> or ran on the owner's deployed instance, and §7 says exactly what that run needs. What was
> measured is the **control** #1235 also asks for: the same job, over loopback, on the Mac that
> hosts the owner's test instance. A device signed in, started an analysis job over the sealed
> transport ([ADR 0047](../adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md)),
> and had the decrypted result in **4 281.6 ms p50 / 6 154.2 ms p95 / 6 195.9 ms at most** with a
> 3.1-billion-parameter model, and in **13 958.9 ms p50 / 17 370.0 ms p95 / 19 457.4 ms at most**
> with a 14.8-billion-parameter one (30 warm runs each). With the model unloaded first, the larger
> one took **21 370.2 to 24 347.8 ms** (5 runs). **The model call was the whole of it**: sealing and
> opening cost about 3 ms a job, and everything that is not the model call cost under 20 ms at the
> median. Two things matter more than those figures. **The job measured is a ride write-up, not a
> re-plan**, because no re-plan job exists, and no run called a tool (§2). And **the same Mac, an
> hour earlier and busy with other work, took 52.6 s p50 and 93.5 s p95 for the larger model's
> job**, failed two of its cold runs, and its model server stopped during the run (§5). On that
> evidence ADR 0048's 60-second freshness bound (P5) is met with 42 s or more to spare on an idle
> machine and **missed on a busy one**.

---

## 1. The question, and how much of it this answers

[#1235](https://github.com/openzigs/onyourleft/issues/1235) asks for a re-plan round trip measured
on the owner's instance: the device sends a block summary, the instance runs a re-plan job through
the agent, and the proposal comes back, all sealed, through the tunnel.

| #1235 asks for | Here |
| --- | --- |
| At least 30 round trips, and 5 cold, through the tunnel, sealed, on the owner's instance | **Not measured.** §7 |
| The legs split where they can be | Measured over loopback (§4.2). The two tunnel legs are **not measured** |
| A control: the same job over loopback on the instance | **Measured** (§4), on the same Mac, but not on the deployed stack (§3) |
| A verdict for P2 and P5 | Given for the control only (§6). For the tunnel: **not measured** |
| What could not be measured is listed | §8 |

So this is the control and the instrument, and the tunnel run is a second write-up when it is made
(a spike is not amended). **#1243 and #1244 stay blocked**: the owner's gate is a round trip on the
instance, and this is not one.

## 2. What job was measured, because no re-plan job exists

There is one job type on an instance: a write-up of one ride
(`apps/instance/src/analysis/routes.ts`, #1095). Its input must be a `RideAnalysisInput` in its
exact shape, and its agent is the write-up agent (`apps/instance/src/analysis/agent.ts`). A re-plan
job, its input (a block summary) and its answer (one move from a closed list) are
[#1243](https://github.com/openzigs/onyourleft/issues/1243)'s to build, and that issue waits on
this measurement. So the job measured is the write-up job, over a synthetic ride.

**What that does and does not carry over to a re-plan:**

- **Carries over**: the sealed transport's cost, the job routes' cost, the cost of loading a model,
  and the two rates a model call is made of (§4.3): how fast a prompt is read and how fast an answer
  is written
- **Does not carry over**: the total. A write-up's answer was about 270 to 360 tokens of prose. A
  re-plan's answer is one move and a reason code. And a re-plan is meant to read goals and
  summaries through tools, which is more than one model call
- ⚠️ **No run called a tool.** Every job that succeeded took one model call (two when the screen
  sent the write-up back once). The agent's tools were offered and the models did not use them, so
  **a multi-step, tool-calling run was not measured at all**, outside the tool's own test against a
  scripted model
- **The input is synthetic**: `apps/instance/tools/replan-round-trip-run.ts` §`syntheticInput`,
  round numbers nobody rode. Each job's input differs by a few units, because a model server keeps
  the prompt it last read and thirty identical jobs would each skip reading their input (§5.2)
- **Every account was new**, with no rides, goals or history on the instance, so a tool would have
  found nothing had one been called

## 3. Hardware, software and where the device was

| | |
| --- | --- |
| Machine | MacBook Pro, `Mac16,8`, **Apple M4 Pro**, 12 cores (8 performance, 4 efficiency), **24 GB** (`system_profiler SPHardwareDataType`). It is the Mac the owner's test instance runs on (the owner's note on #1235) |
| OS | macOS 26.6.2, build 25G83 |
| Instance | `node src/main.ts` (Node 24.20.0) from this repository at `7b66ce98`, whose `apps/instance/src` and `packages` are identical to `main` at `1908021c`. Its own SQLite file in a temporary directory, registration `open`, one room worker. ⚠️ **Not the Docker image and not the owner's deployed stack** |
| Transport | **Loopback**, `http://127.0.0.1`. Sealed: the instance held keys (`OYL_INSTANCE_SECRET_KEY`), so the job routes were sealed-only (ADR 0047 D-7). Plaintext control: a second instance with no secret key, which serves the same routes in plaintext |
| Device | A throwaway device key in a Node process **on the same Mac**. Same clock as the instance |
| Model server | **Ollama 0.30.5** on the host, at `127.0.0.1:11434`, on the GPU (`ollama ps`: `100% GPU`), context 4 096 tokens (its default here; no request was truncated, §4.3) |
| Models | **`qwen2.5:3b`**: 3.1 B parameters, Q4_K_M, 1 929 912 432 bytes. **`qwen2.5:14b`**: 14.8 B, Q4_K_M, 8 988 124 069 bytes. Both report `tools` in `/api/tags`. Neither is recommended: [ADR 0031](../adr/0031-model-licences-and-the-hosted-model-hole.md) D-4, the app names no model, and naming them here records what was measured |
| Load | The one-minute load average was 5.0 to 9.5 during the figures in §4 (recorded by the tool before and after each set). Other work was running on the Mac throughout. §5.1 is the same measurement at a load of 20 to 37 |

⚠️ **How this differs from the owner's deployed instance, none of it measured:**

- The deployed stack reaches its model at the Compose `ollama` service
  (`apps/instance/deploy/home/compose.yaml`, Ollama 0.34.4). `docs/self-hosting/home-machine.md`
  says Docker Desktop passes through an NVIDIA GPU only, on the WSL 2 backend. So on this Mac that
  service would run the model **on the processor**, not on the GPU the figures here used
- The deployed stack runs the image behind `cloudflared`. Nothing here crossed a network

## 4. What was measured

One run is: seal and send the start request, read its 202, seal and open the event stream, open
each event as it arrives, and stop the clock when the `result` event is decrypted. **Total** is from
before the start request is sealed to that moment. Each set is one unmeasured run to load the model,
then 30 warm runs, then 5 runs that each follow `ollama stop <model>`. Percentiles are nearest-rank:
the p95 of 30 is the 29th smallest.

### 4.1 The round trip

| Set | Warm, total ms: p50 / p95 / max (n) | Cold, total ms: min / p50 / max (n) | How every run ended |
| --- | --- | --- | --- |
| **Sealed**, `qwen2.5:3b` | **4 281.6 / 6 154.2 / 6 195.9** (30) | 5 800.9 / 5 865.7 / 6 688.1 (4) | 34 succeeded. 1 cold run **withheld** by the screen after its one rewrite, at 9 817 ms |
| **Plaintext control**, `qwen2.5:3b` | 4 859.2 / 6 063.9 / 6 449.2 (30) | 6 457.4 / 7 457.3 / 9 564.6 (5) | 35 succeeded |
| **Sealed**, `qwen2.5:14b` | **13 958.9 / 17 370.0 / 19 457.4** (30) | 21 370.2 / 21 823.5 / 24 347.8 (5) | 35 succeeded |

Every warm run's total, in order, whole milliseconds:

- Sealed, `qwen2.5:3b`: 3756 4705 4776 4155 3046 3985 5148 5166 3728 4300 3874 4251 2568 4282 6196
  4411 3184 4357 6154 4979 3538 4571 3333 5265 3068 4752 2738 4334 5644 3761
- Plaintext, `qwen2.5:3b`: 4462 3652 3887 4878 4911 4765 5325 4885 3839 6449 5724 4098 3659 4455
  4493 5547 3994 5228 5020 3914 3015 5978 6064 5791 5252 4859 4972 4839 3722 5100
- Sealed, `qwen2.5:14b`: 17200 17370 15588 16046 13299 19457 12520 14535 13874 13470 16904 14206
  14711 13959 12227 13763 12788 15919 15034 10483 13505 11715 13089 15260 16905 14059 11335 12228
  15922 12996

**The sealed set was not slower than the plaintext one** (4 281.6 against 4 859.2 ms at the
median). That is not sealing being free. It is the model writing a different length each time: the
spread between two runs of one set is seconds, and sealing's cost is milliseconds. Sealing's cost
is read from its own legs, below.

### 4.2 The legs

Milliseconds, p50 / p95 over the 30 warm runs of each set.

| Leg | Sealed, 3b | Plaintext, 3b | Sealed, 14b |
| --- | --- | --- | --- |
| **Seal**: building the three envelopes a run sends (start, stream, read) | 1.6 / 2.5 | 0 | 4.7 / 35.9 |
| **Open**: decrypting every reply and event | 1.4 / 2.3 | 0 | 4.1 / 31.5 |
| **Start request**, sent to 202 read: both directions and the handler | 5.6 / 8.1 | 3.7 / 5.6 | 12.4 / 41.4 |
| **202 to the first event**: the stream request, and the job's wait in the queue | 4.0 / 8.3 | 1.5 / 2.8 | 8.2 / 40.0 |
| **Agent steps per run** | 1 / 1 | 1 / 1 | 1 / 1 |
| **One step**: the model call, to its first screened section | 4 271.6 / 6 143.7 | 4 853.1 / 6 058.6 | 13 940.8 / 17 357.2 |
| **After the step**: the whole-text screen, the save, the `result` event | 0.6 / 1.0 | 0.1 / 0.2 | 1.3 / 11.6 |
| The job on the instance's clock, `endedAt − createdAt` | 4 276 / 6 147 | 4 856 / 6 062 | 13 944 / 17 363 |
| Up, `createdAt − sent`, same clock | 4 / 5 | 1 / 3 | 7 / 23 |
| Down, `received − endedAt`, same clock | 2 / 3 | 2 / 2 | 7 / 43 |
| **Tunnel up** | not measured | not measured | not measured |
| **Tunnel down** | not measured | not measured | not measured |

- **What sealing cost**, from the 3b pair: about 3 ms of sealing and opening on the device, about
  2 ms more on the start request and about 2.5 ms more before the first event. **Roughly 7 ms a
  job at the median.** The total less the job's own time was 5.6 ms sealed and 3.0 ms plaintext at
  the median
- **The 14b set's p95 legs are larger** (35.9 ms to seal, where the 3b set took 2.5). The load
  average rose from 6.2 to 9.5 during that set. That is the busy machine, not the model
- **The queue wait is not separable.** The instance does not report when a job left the queue, and
  only one job ran at a time. It is inside "202 to the first event"
- **Up and down are honest only here**, where the device and the instance share a clock. The tool
  prints them for any run, and across a network they compare two clocks and mean nothing

### 4.3 What one model call was made of

From the model server's own log for the same runs (`ollama serve`, its per-request timing lines).
It logged **109 requests** for the three sets: 36 jobs each, plus the one rewrite. That is the
tool's own count of steps, so a step here is one model call.

| | `qwen2.5:3b` | `qwen2.5:14b` |
| --- | --- | --- |
| Prompt, tokens in context when the answer begins | 1 223 | 1 223 |
| Prompt tokens read on a warm run (the rest was kept from the run before): p50 | 191 | 191 |
| Reading 191 tokens: p50 | 253 ms | 1 124 ms |
| Reading all 1 223 tokens, as a cold run does: p95 | 1 503 ms | 8 001 ms |
| Answer, tokens: p50 / p95 | 355 / 468 | 274 / 353 |
| Answer, tokens a second: p50 | 86.8 | 22.1 |
| Loading the model before a cold run, as the server logged it | 0.5 to 1.3 s | 1.3 to 3.8 s |
| Requests truncated to fit the context | 0 of 73 | 0 of 36 |

So a warm run with the larger model was about one second of reading and twelve of writing. **A
shorter answer is the lever**: the write-up's 274 tokens are what took the time, and a re-plan's
answer is a move and a reason code. How long a re-plan's answer and its tool calls take is **not
measured**, and this document does not estimate it.

## 5. What else was run, and why those are not the figures

### 5.1 The same measurement an hour earlier, on a busy machine

The first pass ran from 13:07 to 13:55 local time, while other work on the Mac held its load
average between 20 and 37 (`uptime` at 13:18: 36.65, 30.74, 21.12; the machine has 12 cores) and
its swap, read at the end of the pass, at 12.2 GiB of 15.0 GiB.

| Set, first pass | Warm, total ms: p50 / p95 / max (n) | Cold |
| --- | --- | --- |
| Sealed, `qwen2.5:3b` | 12 040.2 / 18 384.0 / 22 541.7 (30) | 10 066.6 to 40 578.7 (5) |
| Plaintext, `qwen2.5:3b` | 11 655.4 / 23 297.7 / 25 881.6 (29; 1 withheld) | 18 625.9 to 29 234.0 (5) |
| Sealed, `qwen2.5:14b` | **52 599 / 93 532 / 109 312** (30) | **2 runs, both failed**, at 120 780 and 47 465 ms |

- **The larger model's job was about four times slower** than in §4 (52.6 s against 14.0 s at the
  median), on the same machine with the same model
- **A cold run can outlast the agent's own bound.** One model turn may take 120 s
  (`AGENT_TURN_MILLISECONDS`). A cold run of the larger model in an earlier trial failed
  `out-of-time` at 120 220 ms, and the first cold run here failed at 120 780 ms
- ⚠️ **The model server stopped during that set.** After the second failed cold run, Ollama was no
  longer running. Why is **not known**: no crash report was found. It was not installed as a service, so
  nothing restarted it, and it was started again by hand for §4. The tool then stopped on its unload command and **the per-run report for that
  set was lost**: its totals above are from the tool's progress lines, in whole milliseconds, and
  the two failures' reasons were not recorded. The tool now carries on when the unload command
  fails
- These are not the figures because the machine was doing other work. They are here because the
  owner's test instance is this Mac, and this is what the same job cost on it on a working day

### 5.2 The same measurement with thirty identical jobs

The second pass (load average 2.7 to 5.1) sent the same input every time: sealed 3b
4 438.3 / 6 056.6 / 8 557.5 ms, plaintext 3b 4 401.5 / 6 171.6 / 7 134.6 ms, sealed 14b
13 411.1 / 17 578.6 / 18 414.3 ms, cold 14b 21 050.7 to 25 784.5 ms. The model server's log showed
it reading **one token** of prompt on each warm run, because the prompt was byte for byte the one
before. No rider sends the same ride twice, so the tool now moves each job's numbers and §4 is the
pass with that change. The difference was about half a second for the larger model and inside the
noise for the smaller.

### 5.3 A third model that never finished a job

`gemma4:12b` (11.9 B, Q4_K_M, reports `tools` and `thinking`) was tried for five jobs and finished
none. **The four counted jobs all failed `model-cut-off`**, after 51.9 to 79.3 s each: the answer
hit the agent's 1 024-token bound for one turn (`AGENT_TURN_OUTPUT_TOKENS`) before it ended. The
unmeasured first job failed too, at 81.8 s; its reason was not recorded. `gemma3:4b`, the model
[spike 0016](0016-live-in-ride-coaching.md) measured, does not report `tools` and was not run.

## 6. P2 and P5, for the control only

ADR 0048 D-6: **P5** refuses a proposal older than 60 s. **P2** applies a move only if it arrives
at least 30 s before the next block boundary. Read against §4.1's p95, with the caveat of §2 that
this is a write-up job with one model call:

| | P5: back within 60 s | P2: what the round trip leaves |
| --- | --- | --- |
| `qwen2.5:3b`, warm, p95 6.2 s | **Met**, with 53.8 s to spare | A summary sent at a boundary serves a next block of 36.2 s or longer |
| `qwen2.5:14b`, warm, p95 17.4 s | **Met**, with 42.6 s to spare | A next block of 47.4 s or longer |
| `qwen2.5:14b`, cold, at most 24.3 s (n = 5) | **Met**, with 35.7 s to spare | A next block of 54.3 s or longer |
| `qwen2.5:14b`, the busy machine of §5.1, p95 93.5 s | **Not met**, by 33.5 s. The median, 52.6 s, is inside by 7.4 s | A next block of 123.5 s or longer |
| Through the tunnel, on the owner's instance | **not measured** | **not measured** |

## 7. The run on the owner's instance: what it needs, and the command

**Not run.** Read first-hand on 2026-10-11: the instance at `onyourleft.openzigs.com` answers
`/health` with commit `401d29ee` (2026-10-01), 511 commits behind `main`. That commit has no
`apps/instance/src/analysis/routes.ts` and no `apps/instance/src/sealed/`, so it has no job routes
and no sealed transport to measure. The deployment's `.env` was **not read** (the owner's note on
#1235 says not to touch it), so which of the settings below are already there is **not known**.

What the run needs, in order:

1. **The instance redeployed from `main`**, which the owner's note allows
   (`apps/instance/deploy/home/deploy.sh`)
2. **In the deployment's `.env`, by the owner**: `OYL_INSTANCE_SECRET_KEY` (without it the instance
   holds no keys and nothing is sealed), `COMPOSE_PROFILES=analysis`,
   `OYL_INSTANCE_ANALYSIS_MODEL_URL=http://ollama:11434/v1` and `OYL_INSTANCE_ANALYSIS_MODEL`
   (`docs/operating-an-instance.md`, "Analysis model")
3. **A model that takes tools pulled into the Compose Ollama**
   (`docker compose exec ollama ollama pull <model>`). Which model is the owner's choice
4. **A device the instance admits.** Registration there was `approval` when it was deployed on
   2026-09-30 (not re-read), and under it a new account is pending and its job refused. Either `OYL_INSTANCE_REGISTRATION=open` for the length of the run,
   as the tunnel soak needs (`docs/self-hosting/home-machine.md`), or approved accounts. An
   instance allows each athlete 12 job starts an hour, and the tool takes a new account every 12
5. **A place for the device.** The tunnel admits the owner's home address only (the owner's note
   on #1235). From this Mac the
   request still leaves through Cloudflare and comes back down the tunnel. A second machine on the
   home network is the better device, because it is not also the instance

Then, from `apps/instance`, with Node 24:

```bash
node tools/replan-round-trip.ts --url https://onyourleft.openzigs.com \
  --runs 30 --cold-runs 5 \
  --unload 'docker compose -p onyourleft exec -T ollama ollama stop <model>'
```

and the control, on the box, against the same stack over its own network rather than the tunnel.
That needs the instance reachable on loopback, which the Compose file allows only through its one
commented-out local-debugging port.

| Cell | Result |
| --- | --- |
| Sealed, through the tunnel, warm: p50 / p95 / max (n ≥ 30) | not measured |
| Sealed, through the tunnel, cold (n = 5) | not measured |
| Start request through the tunnel (the cleanest read of the tunnel's own cost) | not measured |
| The same job on the deployed stack without the tunnel | not measured |
| P5 at p95, and the margin | not measured |
| P2 at p95, and the margin | not measured |

## 8. What was not measured

- **Anything through the tunnel, and anything on the deployed stack**: the Docker image, the
  Compose Ollama, a model on the processor rather than the GPU
- **A re-plan job.** None exists (§2)
- **A run that calls a tool**, and so a run of more than one model call, apart from one rewrite
- **A job for an athlete with history or goals** on the instance
- **A hosted model** on the rider's own key, which ADR 0048 D-11 allows
- **The queue wait**, apart from the stream request (§4.2), and **two riders' jobs at once**
- **A device that is not the instance's own machine**: no Wi-Fi, no tablet, no phone
- **The Windows machine** that is to be the instance's home
- **Why the model server stopped** in §5.1

## 9. Reproduce

The control, as run here. Two instances, because one instance is either sealed-only or plaintext:

```bash
cd apps/instance
export OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" OYL_INSTANCE_PORT=18831
export OYL_INSTANCE_DATABASE=/tmp/oyl-round-trip/instance.sqlite OYL_INSTANCE_BLOBS=/tmp/oyl-round-trip/blobs
export OYL_INSTANCE_ORIGIN=http://127.0.0.1:18831 OYL_INSTANCE_REGISTRATION=open OYL_INSTANCE_ROOM_WORKERS=1
export OYL_INSTANCE_ANALYSIS_MODEL_URL=http://127.0.0.1:11434/v1 OYL_INSTANCE_ANALYSIS_MODEL=qwen2.5:3b
export OYL_INSTANCE_SECRET_KEY="$(openssl rand -base64 32)"   # leave unset for the plaintext control
node src/operator/cli.ts migrate && node src/main.ts &

node tools/replan-round-trip.ts --url http://127.0.0.1:18831 --transport sealed \
  --runs 30 --cold-runs 5 --unload 'ollama stop qwen2.5:3b'
```

The tool prints one JSON object: every run's legs, the summaries of §4, and how every run ended. It
carries no token, no athlete id and no model text. `apps/instance/tools/replan-round-trip.test.ts`
runs the same code against a scripted model inside `pnpm run test`, and holds its arithmetic.
