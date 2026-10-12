# Spike 0025: side-camera pictures through the instance, sealed, over loopback — what five a second costs, and what the tunnel run still needs

- **Date measured**: **2026-10-12.** Every figure in §4 was produced that day on the machine in §3
- **Issue**: [#1106](https://github.com/openzigs/onyourleft/issues/1106). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092). It is the criterion *"Bandwidth and
  latency, measured: about 5 pictures a second over the tunnel, against what the side analysis
  needs"*, as the owner's ruling of 2026-10-12 on #1106 bounded it: *"Build the measuring tool and
  run it on loopback against an instance started for the test … the through-the-tunnel run needs
  the owner's go-ahead and is reported as owed if not made"*
- **Rests on it**: `apps/web/src/camera/instance-pose.ts`
  §`INSTANCE_POSE_INTERVAL_MILLISECONDS`, and the measurement entries of 2026-10-12 in
  [ADR 0046](../adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) and
  [ADR 0047](../adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md)
- **Number**: **0025.** `docs/spikes/` holds 0001 to 0020 and 0022 to 0024 on `main`; 0021 is
  claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057). No open pull request
  carried a 0025 on 2026-10-12
- **Status of this document**: a **spike write-up**. It measures and decides nothing

> ## ⚠️ The answer in one paragraph
>
> **Nothing here went through the Cloudflare tunnel, and no real model looked at a picture.** What
> was measured is the transport, the sealing and the instance, over loopback, against an instance
> started for the run whose picture model was scripted to answer after a set time. **Five pictures
> a second is not reachable through the sealed transport, and bandwidth is not why**: an instance
> allows one session 120 sealed requests a minute, and offered a picture every 200 ms with a model
> that answered at once it refused **180 of 450** `rate_limited` in ninety seconds. **One a second
> is**: 130 of 130 of the largest pictures were answered over 129 s, none refused. A sealed picture
> costs **22 KB** on the wire for an 8 KiB picture, **87 KB** for 24 KiB and **175 KB** for the
> largest the side link carries (64 KiB), and **0.4 KB** comes back. Sealing, the round trip and
> opening together took **7.7 ms, 16.8 ms and 31.0 ms** at the median for those three sizes, so
> **the model is the whole of the latency**. What the side analysis needs is ten pictures with a
> rider in them for its framing check: at one a second that is **about 9 s**, where the tablet's
> own model at five a second takes two.

---

## 1. The question, and how much of it this answers

| #1106 asks for | Here |
| --- | --- |
| About 5 pictures a second **over the tunnel** | **Not measured.** §6 says what that run needs |
| Bandwidth | Measured on loopback (§4.1): bytes are bytes, and a sealed envelope's size does not depend on the path |
| Latency | Measured on loopback (§4.2) **without the tunnel's two legs and without a real model**. Spike 0023 §10 measured the tunnel adding about 0.14 s to an analysis job on 2026-10-11; that was a different payload, far smaller, and is not a figure for this one |
| Against what the side analysis needs | §5 |

## 2. What was run

`apps/instance/tools/side-picture-round-trip.ts --loopback`, at the commit this write-up lands in.
It starts an instance on this machine (`side-picture-loopback.ts`): `startInstance` as a real
instance is put together, a new database in a temporary directory, keys of its own, the default
limits, and a picture model that is the repository's fake OpenAI-compatible server answering
`{"rider":false}` after `--model-ms`. A throwaway device signs in, sealed, and offers
`POST /v1/camera/side-pose` a picture every `--interval-ms`, **one at a time as the tablet does**:
a picture that falls due while the last is still with the instance is counted `skipped` and not
sent, which is what `side-analysis.ts` does with one that arrives while the model is busy.

- **The pictures are of nobody.** Each is a JPEG's opening segment and filler of the size asked
  for. A sealed envelope is padded to a bucket (ADR 0047 D-9), so its size on the wire depends on
  the picture's size and not on what is in it.
- **It reads and changes no other instance.** No request left this machine, the owner's home
  instance and its `.env` were not touched, and no model on the owner's Ollama was loaded, pulled
  or stopped.
- **"Sealed" here is less than the app's**, as in spike 0023: the tool pins nothing and seals to
  whatever key the instance serves. On loopback that is the instance it started.

## 3. The machine

An Apple M4 Pro (arm64), Node 24.20.0, the instance and the device in two processes of one
machine over `127.0.0.1`. Other work was running on it at the time. The figures in §4.2 that are
not the scripted model's own time are small enough that this matters to them, and they should be
read as "a few milliseconds to a few tens", not to the decimal.

## 4. What was measured

### 4.1 Bytes on the wire

The body of the sealed request and of the sealed reply, as sent, without HTTP's own headers. Every
picture of one size cost the same.

| Picture | Up, per picture | Down, per picture | Up at one a second | Up at five a second, if it were allowed |
| --- | --- | --- | --- | --- |
| 8 KiB (8 192 B) | 21 961 B | 411 B | 22 KB/s (0.18 Mbit/s) | 110 KB/s (0.9 Mbit/s) |
| 24 KiB (24 576 B) | 87 497 B | 411 B | 87 KB/s (0.7 Mbit/s) | 437 KB/s (3.5 Mbit/s) |
| 64 KiB (65 536 B), the largest the side link carries | 174 878 B | 411 B | 175 KB/s (1.4 Mbit/s) | 874 KB/s (7.0 Mbit/s) |

A picture is base64 in JSON (4/3), padded to its bucket — a power of two up to 64 KiB, then the
next multiple of 64 KiB — and the envelope is base64url again (4/3). So an 8 KiB picture is 2.7
times its size on the wire, a 24 KiB one 3.6 times (it pads from 33 KB to 64 KiB), and a 64 KiB one
2.7 times. ⚠️ **The size of a real side-camera picture was not measured here**: the phone takes a
256-pixel picture at JPEG quality 0.8, and nothing in this run came from a camera.

### 4.2 Latency

`roundTripMs` is from before the request is sealed to the answer opened, on the device. 100
pictures offered every 200 ms; the scripted model's time is the column.

| Picture | Model 0 ms: p50 / p95 / max | Model 400 ms: p50 / p95 | Model 2 000 ms: p50 / p95 | Sealing p50 | Opening p50 |
| --- | --- | --- | --- | --- | --- |
| 8 KiB | 7.7 / 11.8 / 22.2 ms | 410.0 / 411.8 ms | 2 014.7 / 2 023.2 ms | 0.8 ms | 0.2 ms |
| 24 KiB | 16.8 / 24.4 / 25.7 ms | 413.8 / 418.1 ms | 2 015.7 / 2 031.0 ms | 2.2 ms | 0.3 ms |
| 64 KiB | 31.0 / 33.4 / 35.3 ms | 434.9 / 440.1 ms | 2 019.3 / 2 035.3 ms | 5.4 ms | 0.3 ms |

Everything that is not the model — sealing, the request, the instance opening it, checking the
picture, the reply and opening that — is under 35 ms for the largest picture.

### 4.3 How many of five a second are looked at

| Offered | Model | Sent | Answered | Skipped (one was out) | Refused | Answered a second |
| --- | --- | --- | --- | --- | --- | --- |
| 100 every 200 ms, 24 KiB | 0 ms | 100 | 100 | 0 | 0 | 5.05 |
| 100 every 200 ms, 24 KiB | 400 ms | 34 | 34 | 66 | 0 | 1.68 |
| 100 every 200 ms, 24 KiB | 2 000 ms | 10 | 10 | 90 | 0 | 0.46 |
| **450 every 200 ms, 24 KiB** | 0 ms | 450 | **270** | 0 | **180 `rate_limited`** | 3.01 |
| **130 every 1 000 ms, 64 KiB** | 0 ms | 130 | **130** | 0 | **0** | 1.01 |
| 15 every 1 000 ms, 24 KiB | 400 ms | 15 | 15 | 0 | 0 | 1.04 |
| 32 every 1 000 ms, 24 KiB | 2 000 ms | 11 | 11 | 21 | 0 | 0.34 |

The first three rows last twenty seconds and stay inside a minute's allowance, which is why they
show no refusal. **The fourth is the finding**: `auth/identity.ts` §`DEFAULT_LIMITS` allows one
session 120 sealed requests a minute, and 450 requests in ninety seconds got 120, 120 and 30
through. A refused request is refused before it is opened, so its picture was sent, never read,
and cost its 87 KB anyway. And the limit is the session's, not this route's: a sync, a write-up's
stream and a room's ticket draw on the same 120.

## 5. Against what the side analysis needs

`apps/web/src/camera/side-analysis.ts` takes one picture at a time and drops the rest, so it has
no rate it must be fed at. What it needs:

- **Ten pictures with a rider in them, for the framing check** (§`FRAMING_CHECK_POSES`). At five a
  second on the tablet's own model that is two seconds. Through the instance at one a second the
  tenth answer came at **9.0 s** with a model that answered at once and **9.4 s** with one taking
  0.4 s. With one taking 2 s it came at **29.0 s** on the tool's one-second grid, where a picture
  that falls due while one is out waits for the next tick; the app sends the next as soon as the
  last is answered and a second has passed since the last was sent, which would be nearer 20 s
  and **was not measured**.
- **A session's worth for the report**, which compares the first third of a session with the
  last. At one a second a twenty-minute session is at most 1 200 pictures, against 6 000 at five
  a second. Whether the report's comparison is as steady on a fifth of the pictures **was not
  measured**, and nothing here says it is.

So the app sends at most one a second (`INSTANCE_POSE_INTERVAL_MILLISECONDS`): half of a
session's allowance, leaving the other half for everything else the app seals.

## 6. What the tunnel run needs, and why it was not made

The owner's ruling: *"Do not change the home instance or its `.env`, do not pull or stop models on
the owner's Ollama, and do not touch either tunnel."* A run through the tunnel is:

    node tools/side-picture-round-trip.ts --url https://<the instance> --pictures 130 --interval-ms 1000 --picture-bytes 24576

against an instance that holds keys, **names a picture model** (`OYL_INSTANCE_PICTURE_MODEL`, a
change to its `.env` and a model that takes pictures on its Ollama) and admits a new device. It
registers a throwaway account there and asks that instance's model about 130 pictures of nobody.
Each of those is the owner's to allow.

## 7. What was not measured

- **The tunnel**: its two legs, its upload ceiling, and what a home connection's upstream does to
  175 KB a second.
- **Any real model**: how long one takes over a picture, cold or warm, and whether it finds a
  rider. `apps/web/src/camera/computer-pose.ts` already says a general vision model asked for
  coordinates as JSON is an unmeasured claim; this does not measure it either.
- **A real picture's size.**
- **The app.** The tool is a Node process, not the tablet: WebCrypto in a WebView sealing 64 KiB
  was not timed, nor the tablet's radio.
- **A hosted model.** The tool refuses `--source instance-hosted`: it holds no key and no consent.
- **The report's quality on fewer pictures** (§5).
