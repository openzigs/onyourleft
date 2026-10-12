# Spike 0025: side-camera pictures through the instance, sealed, over loopback — what five a second costs, and what the tunnel run still needs

- **Date measured**: **2026-10-12.** Every figure in §4 was produced that day on the machine in §3
- **Issue**: [#1106](https://github.com/openzigs/onyourleft/issues/1106). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092). It is the criterion *"Bandwidth and
  latency, measured: about 5 pictures a second over the tunnel, against what the side analysis
  needs"*, as the owner's ruling of 2026-10-12 on #1106 bounded it: *"Build the measuring tool and
  run it on loopback against an instance started for the test … the through-the-tunnel run needs
  the owner's go-ahead and is reported as owed if not made"*
- **Rests on it**: `apps/web/src/camera/instance-pose.ts`
  §`INSTANCE_POSE_INTERVAL_MILLISECONDS`, and
  [ADR 0050](../adr/0050-side-camera-pictures-to-the-riders-instance-sealed.md) D-9 and its
  §"What was verified, and what was not"
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

## 8. Real models, asked on 2026-10-12

Appended after §1 to §7, which are as they were: where the opening paragraph, §2 and §7 say no real
model looked at a picture and no hosted model was measured, read this section. Four real models were
asked, the same day, after the owner's decisions on #1106 allowed it
([comment](https://github.com/openzigs/onyourleft/issues/1106#issuecomment-6127194892), decision 5
for the hosted one).

> **In one paragraph.** A drawn picture of nobody went through an instance started for the run on
> loopback, sealed, to each model. **Three of the four took it and answered `{"rider":false}`**:
> two local models on the owner's Ollama (`gemma4:12b`, 6.6 s at the median; `gemma3:4b`, 4.7 s) and
> DeepSeek's `deepseek-flash` on the owner's key (2.0 s, once). **The fourth, a text-only local
> model, was refused by its server and the instance said `model_without_pictures`, correctly.**
> ⚠️ **Two of the models that take pictures were wrongly read as taking none** when sent bytes they
> could not decode, because their refusals name an image; that is fixed in the same pull request.
> ⚠️ **No model was shown a rider**, so no model's landmarks were read, and the local timings were
> taken on a machine busy with other work.

### 8.1 What was run

    node tools/side-picture-round-trip.ts --loopback --picture drawn \
      --model-url http://localhost:11434/v1 --picture-model <name> --pictures <n> --interval-ms 1000

- **The tool** as of this pull request: `--picture drawn`, `--model-url` and `--picture-model` are
  new, and so is `answers` in the report.
- **The instance**: started for each run by `side-picture-loopback.ts`, the composition
  `startInstance` builds, a temporary database, its own keys, on `127.0.0.1`. Not the home
  instance, whose `.env` and tunnels were not touched.
- **The picture**: `tools/drawn-picture.ts`. A red disc, a blue rectangle and a green triangle on a
  pale ground, 320 by 240, **6 021 bytes**, drawn and encoded as a baseline JPEG in code, with no
  segment but the ones a picture needs (no Exif, no XMP, no comment). The disc moves a little
  between pictures so no two are the same bytes. **No image file is committed and no photograph was
  read.** macOS's own decoder opened it as a 320 by 240 JPEG.
- **The question** is the instance's one fixed question (`camera/hosted-pictures.ts`
  §`SIDE_POSE_QUESTION`), with a bound of 512 tokens.
- **The local models**: the owner's Ollama, version 0.30.5, at `http://localhost:11434`. Models were
  loaded by being asked. None was pulled, deleted or stopped, and Ollama was not restarted.
- **The machine** is §3's. ⚠️ **It was busier than in §4**: the one-minute load average read 11.1
  before the first run, 12.9 after it and 22.7 after the third. The local round trips are therefore
  slower than these models alone, by an amount not measured.

### 8.2 The local models

One picture offered a second, one at a time; a picture that fell due while the last was out was
skipped unsent, as the tablet does.

| | `gemma4:12b` | `gemma3:4b` | `qwen2.5:3b` |
|---|---|---|---|
| Ollama lists it with | `completion`, `tools`, `thinking`, `vision` | `completion` only | `completion`, `tools` |
| Report's `startedAt` | `2026-10-12T15:24:47.197Z` | `2026-10-12T15:28:30.597Z` | `2026-10-12T15:30:04.813Z` |
| Pictures offered | 200 | 90 | 3 |
| Sent | 27 | 16 | 1 |
| Answered | **27** | **15** | **0** |
| Refused | none | 1 `picture_model_failed` | 1 `model_without_pictures` |
| Round trip, p50 | **6 596 ms** | **4 726 ms** | |
| Round trip, p95 | 11 728 ms | 6 532 ms | |
| Round trip, least to most | 4 478 to 12 792 ms | 493 to 6 532 ms | |
| Ten answers (the framing check's count) | 66.6 s | 79.8 s | never |
| On the wire, each | 21 961 bytes up, 411 down | the same | |

**What the answers looked like, for a picture with no rider.** Every answered picture got
`{"rider":false}`, which is what the question asks for:

- `gemma4:12b`: 8 times bare, 18 times inside a Markdown code fence (` ```json `), and once fenced
  with a space after the colon. The app's reader (`computer-pose.ts` §`sidePoseFromAnswer`) takes
  the fence off, so all 27 read as *no rider*. Asked directly, this model also returned a
  `reasoning` field naming the three shapes (154 completion tokens in all); the instance passes on
  the answer alone.
- `gemma3:4b`: 15 times bare. ⚠️ **Ollama's list gives this model no `vision` capability, and it
  read the picture**: asked directly with a looser question it answered *"The image depicts three
  colored geometric shapes arranged on a light gray background."* A server's list is not a reliable
  "no".
- Its one `picture_model_failed` was not explained. It was most likely the first picture, sent while
  Ollama was swapping the model in, running past the instance's 25 s bound; that was not
  established.

**One a second is what was offered, and it is not what a local model here took.** About one picture
in seven was sent. The rate the app sends at is the model's, as §5 said it would be.

### 8.3 A text-only model, and what the code made of it

`qwen2.5:3b` has no image input. Ollama answered the instance's request **HTTP 400**:

    {"error":{"message":"{\"error\":{\"code\":400,\"message\":\"Multimodal data provided, but model does not support multimodal requests.\",\"type\":\"invalid_request_error\"}}","type":"invalid_request_error","param":null,"code":null}}

The instance answered the device **422 `model_without_pictures`**, which is right, and the app's
sentence for it is *"The model answered that it does not take pictures…"*. It did not answer about
a picture it had dropped.

### 8.4 A hosted model: DeepSeek, two requests in all

The owner allowed one real test with their key. **Two requests were made and no more**: one with the
drawn picture, and one with the tool's filler bytes to see a real refusal.

- **Where**: `https://api.deepseek.com/v1`, model `deepseek-flash`, the model spike 0023 §11 used.
- **How**: an instance on loopback as in §8.1, a throwaway account, the key stored through
  `POST /v1/analysis/hosted/key`, and the picture sent sealed with `source: instance-hosted` and the
  consent's origin, so it went through `camera/side-pose.ts`, `camera/hosted-pictures.ts` and
  `analysis/model.ts` as a rider's would. The request the service was sent held `model`,
  `max_tokens` (512) and one user message of two parts, `text` and `image_url`, 9 027 bytes in all,
  and nothing else.
- ⚠️ **By a script that is not committed**, because the measuring tool refuses
  `--source instance-hosted` on purpose (it holds no key and no consent) and this pull request does
  not change that. It differs from §8.1 only in storing the key and in handing `startInstance` a
  `hostedFetch` that recorded the service's status, time and reply.

| | The drawn picture | Filler bytes (not a decodable picture) |
|---|---|---|
| The service answered | **HTTP 200** in **1 972 ms** | **HTTP 400** in 423 ms |
| Round trip through the sealed route | **2 005 ms** | 450 ms |
| The instance answered the device | 200, `{"rider":false}` | 422 `model_without_pictures` — **wrong**, see §8.5 |
| The service's words | `"content":"{\"rider\":false}"`, with 34 reasoning tokens of 41, the reasoning saying *"shapes only"* | *".messages[0].image[0]: You have uploaded an unsupported image. Please make sure your image is valid and has one of the following formats: webp, png, jpeg, and gif."* |

So `deepseek-flash` **accepts a picture in this request on a rider's own key, and saw it**. One
round trip is not a distribution: nothing here says how it varies, and nothing was sent a second
apart.

**The key.** It was read from a file into the environment of the one process that made each
request, sent sealed to the loopback instance, and stored there encrypted under that instance's own
secret. After each request the key was cleared through `DELETE /v1/analysis/hosted/key`, read back
as cleared, and the instance's data directory deleted. The script refuses to print its report if the
key is anywhere in it, and both saved reports and the instance's log lines were searched for the key
and did not hold it. It is in no file this pull request adds.

### 8.5 The refusal pattern was wrong, and how

`analysis/model.ts` read any 400, 415 or 422 whose body contained *image*, *vision* or *multimodal*
as *"this model takes no pictures"*. Two real refusals from models that DO take pictures matched it:

| Model | Sent | It answered, HTTP 400 | Read as | Should be |
|---|---|---|---|---|
| `gemma3:4b` (Ollama) | the tool's filler bytes | *"Failed to load image or audio file"* | `model_without_pictures` | one failed picture |
| `deepseek-flash` | the same | *"You have uploaded an unsupported image…"* | `model_without_pictures` | one failed picture |

The app stops for the session on `model_without_pictures` and tells the rider to choose another
model, so one picture a service could not decode would have ended the session with the wrong
reason. The pattern now matches statements about the MODEL only (`model.ts` §`WITHOUT_PICTURES`),
and both of these are `picture_model_failed`. `model.test.ts` holds the three real sentences of
§8.3 and this table. ⚠️ Of the five patterns, **one was observed** (§8.3's). The other four are the
author's reading of what other servers say, and a server that words it differently is three failed
pictures and a stop that says *"gave no usable answer"*.

This is also why **a run against a real model needs `--picture drawn`**: §6's command, as written,
sends filler, which a real model refuses.

### 8.6 What is still not measured

- **The tunnel.** The owner's decision 4 allows the run on the Mac home instance (one model that
  takes pictures pulled into its Ollama, one `.env` line naming it, one throwaway account). It was
  not made here. The command is §6's with `--picture drawn` added.
- **Anthropic**, and every hosted service but DeepSeek: documentation only.
- **A picture with a rider in it, on any model.** No picture of a person was used, so nothing here
  says whether a real model returns nine landmarks the reader takes, whether the plausibility check
  passes them, or whether a model that reasons finishes that longer answer inside 512 tokens.
- **What a hosted service that takes no picture answers.**
- **A quiet machine, a cold model's first answer measured on purpose, and a model's time on a
  picture the size a real camera sends** (the drawn one is 6 KB; the side link carries up to 64 KiB).
- **The app**: still a Node process and not the tablet.
