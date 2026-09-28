# Spike 0016: Whether live in-ride coaching exists at all, and what its round trip measured

- **Date measured**: **2026-09-28.** Every figure in §5 was produced on that day on the machine in
  §5.1. Every other figure is cited to the file it came from.
- **Issue**: [#389](https://github.com/openzigs/onyourleft/issues/389), under the owner's ruling of
  2026-09-28 on that issue: _"investigate live in-ride coaching. Proceed on this issue's 'if it
  proceeds' criteria. They must be met before anything is built"_. Related ruling:
  [#518](https://github.com/openzigs/onyourleft/issues/518) (a hosted model, numbers only).
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: _"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."_ §8 **recommends**; the owner decides. Nothing here is
  built, no product file changes, and no issue is filed: §8's list is a draft.
- **Why 0016**: `docs/spikes/` holds 0001–0008 and 0010–0015 on `main`. **0009 is claimed** by
  [#471](https://github.com/openzigs/onyourleft/pull/471), still open (its branch carries
  `docs/spikes/0009-realism-on-the-device-floor.md`, and spike 0010's own row in
  `docs/architecture.md` says so). No open pull request or remote branch carries a 0016.

> ## ⚠️ The answer in one paragraph
>
> **The owner's criteria are not met, and three of them cannot be met from this machine.** What was
> measured is the model leg of the round trip: a 4.3-billion-parameter vision model on the rider's
> own computer answered #553's exact side-pose request in **2 252.6 ms p50 / 3 192.4 ms p95** warm
> (20 requests) and **8 114.1 ms** cold, over loopback whose own overhead was **0.2 ms p50**. The
> tablet's legs — capture, the side link, the Wi-Fi request, the sentence reaching a rider — are a
> procedure in §6 with **empty cells**. And the measurement found something that matters more than
> the latency: **on one identical picture, twenty answers put the rider's elbow anywhere from 0.18 to
> 0.71 of the picture's width, and a picture of random noise with nobody in it produced a pose the
> product's own reader accepted in four of six answers** (§5.4). Separately, a live coach
> collides with two rules the owner has already made: [ADR 0033](../adr/0033-side-camera-link.md)
> D-6 says pose numbers _"never reach the HUD, the ride screen, an announcement or a trainer"_, and
> [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md) R7 forbids _"a notification fired on
> a reading"_ — which is what an in-ride utterance is (§3.1). **Recommendation (§8): proceed to
> measurement and to two owner rulings only. Build nothing** until the §6 cells are filled and both
> rulings are made.

---

## 1. The question

#389 asks whether a live coach should exist at all, and if it proceeds, it owes five things before
anything is built (the owner's list, verbatim in the issue's 2026-09-28 comment):

| # | Owed | Where this document answers it | State |
| --- | --- | --- | --- |
| 1 | A **measured** end-to-end round trip (capture → transport → model on the rider's own machine → render), on a stated transport, model and hardware | §5 (measured), §6 (the tablet's legs, as a procedure) | **Partly measured.** The model leg and a loopback transport are measured; the tablet's legs are not |
| 2 | A written safety analysis: what may be said above a stated effort, what is never said mid-ride, the minimum interval between utterances, and silence (never a stale repeat) when the endpoint stops answering | §4.1–§4.3 | **Written** |
| 3 | ADR 0030 D-7's silence rule shown to be implementable, and the effort signal it reads | §4.4 | **Written, as a typed sketch** — not shipped code |
| 4 | Nothing on this path reaches a trainer control point | §4.5 | **Argued from the import graph**, with the gate that would hold it proposed |
| 5 | A CPU budget that the quality ladder sheds before the world degrades | §4.6 | **Written**, and it found that the side camera's pose analysis is on no ladder today |

---

## 2. What Phase C actually shipped — read from the files, not from #377

Everything in this section was read on `main` at `ca300c9` on 2026-09-28.

### 2.1 What exists

| Piece | File | What it does, exactly |
| --- | --- | --- |
| The post-ride report | `apps/web/src/camera/side-report.ts` | Pure. Pose numbers in, sentences out. Compares the **first third** of one session's posed pictures with its **last third**, on five sagittal kinds (`torso`, `knee`, `elbow`, `head`, `saddle`). Needs a session of at least `MINIMUM_SESSION_MILLISECONDS` (six minutes) and `MINIMUM_POSES_PER_THIRD` (30) usable poses per third. Every threshold is marked in the file as _"a provisional choice, not a measurement"_ |
| Its vocabulary | `apps/web/src/camera/side-report-wording.ts` | Every sentence the report can say, each past tense, each naming both sides (_"late in the session than early in it"_), each worded _"possibly"_, **none carrying a number** |
| The number gate | `side-report.ts` §`MEASURED_SPREAD_DEGREES` | **`undefined`**, so `renderableChanges` returns nothing: no degree figure is rendered anywhere, because #385's accuracy half — the measured spread — **was never done** ([spike 0010](0010-on-device-pose-model-cost.md)'s own warning box) |
| The tablet's pose model | `camera/pose-runtime.ts`, `camera/pose-worker.ts`, `apps/web/tools/pose/` | MediaPipe Pose Landmarker lite in a Web Worker, served from the app's origin, behind a network fence (`fenceWorkerNetwork`) that refuses MediaPipe's usage logger. Spike 0010 §5.4: **65.8 / 80.9 ms p50 / p95** per picture over a ten-minute soak beside the stylised game, **no frame over 20 ms** in 36 071 |
| The analysis on the tablet | `camera/side-analysis.ts` | Looks at each picture as it arrives, keeps at most one waiting (the newest survives), keeps pose numbers and never a picture. **Its header: _"Nothing is said about a body during the ride (D-6)"_** |
| The one network primitive | `camera/analysis-transport.ts` | One `POST` to an OpenAI-compatible `/v1/chat/completions` on the rider's own machine: four keys (model, prompt, picture, `max_tokens: 400`), `cache: 'no-store'`, `redirect: 'error'`, `credentials: 'omit'`. No `temperature` is sent |
| The address rule | `camera/analysis-endpoint.ts` | Refuses any address not on the rider's own network (a public name, which is what a tunnel's is, is refused). Plain `http:` on the LAN is ADR 0029 D-6's adopted default |
| The Android path | `apps/mobile/src/http/analysis-http.ts` (#553) | The same request through Capacitor's native HTTP, because the WebView blocked it as mixed content (validation 0002 Part AF). `connectTimeout` 10 s, `readTimeout` 120 s. **A native request cannot be aborted from the web side** |
| The computer as pose model | `camera/computer-pose.ts`, `camera/side-analyser.ts` (#553) | A second `SidePoseEstimator` that sends each side-camera picture to the rider's computer with the fixed `side-pose` prompt (`analysis-port.ts` §`ANALYSIS_PROMPTS`) and reads the answer with `sidePoseFromAnswer` — numbers or `unreadable`. Off by default, its own consent sentence. Per-picture deadline `COMPUTER_POSE_DEADLINE_MILLISECONDS` = 30 000; two deadlines in a row stop the session |
| The connection check | `camera/useAnalysis.ts` | A 60 s deadline on the **screen**, none on the request, and ⚠️ **_"a late answer still wins"_** — the right rule for a button, and the opposite of what a live coach needs (§4.3) |
| Two safety gates | `camera/analysis-safety.test.ts`, `camera/side-report-safety.test.ts` | Three holds on #387's answer (runtime, module graph, text) and two on the report path (a transitive walk of relative imports finding no trainer module; a section with no control). Both use the same `TRAINER_MODULE` pattern |

### 2.2 What does NOT exist

- **No in-ride utterance about a body, of any kind.** `game/hud/announce.ts` §`AnnouncementEvent`
  has eight kinds and none is about the rider's body. `ADR 0033` D-6 makes that a rule, not an
  omission: _"Pose numbers never reach the HUD, the ride screen, an announcement or a trainer."_
- **No measured accuracy.** `MEASURED_SPREAD_DEGREES` is `undefined`. #385 is closed; its accuracy
  half is not done (spike 0010 §"The half of #385 this does NOT do").
- **No measured accuracy of a general vision model as a pose source** — `computer-pose.ts` says so
  itself: _"Whether a general vision model answers it WELL is not measured"_. §5.4 is the first
  measurement, and it is not reassuring.
- **No place on the quality ladder for the side camera's analysis.** `game/quality.ts`
  §`QualitySettings` has `capture` (#387's single capture) and `presence` (#390); nothing in
  `apps/web/src/game/` names `SideAnalysis`, and `GameView.tsx` throttles only
  `props.camera?.throttle(settings.capture)` (read by `grep` on 2026-09-28). The 5-per-second pose
  model runs whatever rung the ride is on. Spike 0010 measured that it cost the ride no frames in a
  worker — but that was on a lighter scene than #323's 24 ms p50 (spike 0010 §5.5).

### 2.3 What a live coach could say that the report does not — and what it could never say

Under ADR 0030 D-1 and D-2, and with no number (the spread is unmeasured), **a live coach could say
exactly the report's five kinds of observation, in the report's shape, and nothing else.** The one
thing it adds is **timing**: _"Your upper body was possibly lower in the last ten minutes than in
the first ten"_ said at minute 45 rather than read on the sofa. #389's own body reaches the same
place: a within-session difference needs two windows, so the first half-hour of a ride has nothing
to say, and "rocking hips" — the example #389 was filed with — was dropped from the vocabulary by
the owner on 2026-09-26 because it is frontal (D-4).

It may **never** say, mid-ride or otherwise:

| Never | Rule |
| --- | --- |
| An absolute angle, length or body dimension, as a number | D-3 (both reasons; #385 cannot lift it) |
| Anything across the rider — side to side, knee tracking, hip drop, sway — as a number **or a word** | D-4, and `no-absolute-angles.test.ts` scans every rendered string for it |
| Any number at all, while `MEASURED_SPREAD_DEGREES` is `undefined` | The owner's ruling on #388 |
| An imperative, a suggestion, a tip — _"drop your elbows"_ | D-1: there is no suggestion category; _"a 'suggestion' is a prescription with a softening adverb"_ |
| Anything about equipment | R4 |
| Any condition, injury or risk, in either direction | R5 |
| A judgement, a score, _"good"_, _"better"_ | R3, R9 |
| A sentence without _"possibly"_ and without both sides named | R1, R2, and the owner's _"every observation is worded as 'possible'"_ |

So **the honest content of a live coach is the post-ride report's sentences, early.** Whether that
is worth an interruption is the question §3.1 argues cannot be answered by engineering.

---

## 3. Two rulings already stand in the way

### 3.1 ADR 0030 R7 and the carve-out's condition 5

ADR 0030 D-2 **R7**: _"No prompt to act, medically or otherwise, and no alert. A report is read; it
does not interrupt."_ Forbidden, illustrating: _"a notification fired on a reading"_. Its 2026-09-23
amendment made R7 load-bearing for the general-wellness position, under condition 5 (_"do not
include claims, **functionality**, or outputs that prompt or guide specific clinical action"_), and
wrote: _"a feature that emitted a notification on a reading would breach it even with a permitted
sentence in it"_.

An in-ride utterance under D-7 is, by D-7's own S3, **emitted because an observation persisted** —
that is a notification fired on a reading. D-7 was written before the amendment and assumes an
utterance can exist; the amendment then described one as a breach. **The two do not agree inside the
same ADR, and resolving that is the owner's**, not this spike's. Two shapes the owner could rule on:

- **Push** (what #389 imagined): the coach speaks when S1–S6 hold. On the amendment's reading, this
  breaches condition 5 whatever the sentence says.
- **Pull**: nothing is ever spoken unprompted. A rider who presses _"How has my position changed?"_
  during an easy block gets the report-so-far, subject to S1–S6 — which is R7's permitted example,
  _"a report the rider opens"_, opened early. It is not a coach, and it may be all that is permitted.

### 3.2 ADR 0033 D-6

_"It runs **during** the ride, and **nothing is shown until after it** (owner). ⚠️ That is not live
coaching […] Pose numbers never reach the HUD, the ride screen, an announcement or a trainer.
[#389] remains a separate decision."_ That is an owner rule about this exact path. Any live coach
reading side-camera pose numbers needs it changed first, by an owner ruling recorded as an appended
amendment to ADR 0033 (or a superseding ADR if it is read as reversing a decision).

---

## 4. The safety analysis — what would hold if the rulings allowed a coach

Written because the owner's criteria require it before anything is built. It assumes the **pull**
shape or an owner ruling that permits push; every rule below applies to both.

### 4.1 What may be said above a stated effort, and what is never said mid-ride

**The effort signal is power, against the rider's own threshold power.** Not heart rate: it lags
effort by tens of seconds and would call the first minute of a hard interval easy. Not cadence: a
rider grinding at 60 rpm on purpose is at high effort (`erg-safety.ts` makes the same point about
cadence alone). Concretely:

- **Above 100 % of the rider's own threshold power**, sustained or momentary within the window:
  **nothing is said about the body at all.** D-7 S1.
- **Inside a workout segment whose target is above threshold, or within 30 s of such a segment's
  end** — read off `RideWorkoutSnapshot.timeline` with the one clock `RideWorkoutSnapshot.elapsedSeconds`:
  **nothing.** D-7 S4. The look-ahead is the same `segmentAt(timeline, elapsed + lead)` #398 uses.
- **Below threshold, for the whole window**: at most one observation sentence (§4.2), from the
  vocabulary only (S6).
- **When the threshold is not the rider's own** — `analysis/thresholds.ts` §`thresholdsFor` returns
  `assumed.power === true` — **nothing, ever, on that ride.** D-7's own note: _"a substituted
  default must not enable S1"_. `assumed.power` already exists, so this needs no new state.
- **When there is no power reading** — no trainer, no power meter, or a dropped reading
  (`fields.ts` §`NO_READING`): **nothing.** `audio-cues.ts`' rule, _"Silence is the answer to every
  'I do not know'"_, applied to effort: an unknown effort is treated as a high one.

**Never said mid-ride, whatever the effort** (beyond §2.3's list, which binds everywhere):

- nothing while a **stall rescue** holds a workout's target (`RideWorkoutSnapshot.rescue`), while
  the trainer is lost or not released (announcer rank 1), or during a workout fault (rank 2) — the
  rider has a machine to think about;
- nothing while the **ride is paused** or the camera reports the rider **absent** (#390's presence) —
  there is nobody to speak to, and speaking to an empty room is how a stale sentence reaches the
  rider when they come back;
- nothing in the **first window of a ride**, because a within-session difference has no earlier
  side yet (R1, R2);
- **no repeat** of a sentence already said on this ride — a repeat is a stale utterance by
  definition, and the report says it again after the ride anyway.

### 4.2 The minimum interval between utterances

**Five minutes between body utterances (D-7 S2), and inside that the announcer's own rule still
applies.** The argument, from what is already built:

- `game/hud/announce.ts` speaks **at most one sentence per `ANNOUNCE_WINDOW_SECONDS` (3 s)**, and a
  lower-ranked item is **dropped, not queued**: _"a queue that grows is the continuous-speech failure
  itself"_. A coach sentence would be a **new kind at the lowest rank, below `power` (rank 8)** —
  every existing kind is either safety or a reading the rider chose, and a sentence about posture
  outranks none of them. So a coach sentence that meets a busy window is dropped. It is not
  re-offered: the next chance is the next five-minute slot, from a fresh window (§4.3).
- `audio-cues.ts`: _"a short sound plays only with its sentence"_, and a sound is never the only
  carrier. A coach sentence gets **no sound**: a tone that means "the camera noticed your body" is
  exactly the alert R7 forbids.
- S2's five minutes is D-7's and is marked there as _"an engineering choice, not a measurement"_. It
  is kept rather than re-derived: nothing measured since gives a reason to move it, and #389 owns
  re-deriving it only **if** a coach is built.
- With S2 alone a 60-minute ride has at most **twelve** slots; with §4.1's no-repeat rule it has at
  most **ten** body sentences (five kinds, two directions, none said twice) and usually none.

### 4.3 Silence, never a stale repeat, when the endpoint stops answering

**An utterance is a function of the pose window ending now. It is never a stored sentence replayed.**
The freshness rule, concretely:

1. The coach holds **pose numbers with their picture's timestamp**, never a sentence. A sentence is
   produced at the moment of speaking, from the two windows ending at that moment.
2. The **late window** (the "last ten minutes") must end **no more than 10 s before now**, and must
   hold poses covering at least **60 s** (S3) with **no gap longer than 10 s** between posed
   pictures. The 10 s figures are proposed engineering choices, not measurements: long enough that
   the tablet dropping pictures under load (D-6's "newest survives") does not silence it, short
   enough that a rider who stopped pedalling to drink is not described from before they stopped.
3. When the source stops — the computer path goes `dead` in `computer-pose.ts` (a `FAILURES_THAT_STOP`
   failure, or `MAXIMUM_CONSECUTIVE_DEADLINES`), the tablet model is `unavailable`, or the side link
   is lost — **no new poses arrive, rule 2 fails within 10 s, and the coach is silent.** Nothing is
   said about the silence: D-7, _"silence is never explained"_. (The side link's own loss is already
   rank 5a and is said, but as a camera event, not a body event.)
4. **A late answer never wins here.** `useAnalysis.ts` deliberately lets a late answer replace "no
   answer yet", because a person pressed a button and wants the answer. For a coach the rule is
   inverted: a pose whose picture is older than rule 2 allows is **discarded on arrival**, not
   appended. With the computer path's measured 2.25 s p50 and 30 s deadline (§5), an answer can
   arrive half a minute after its picture; it describes a rider who has moved on.

### 4.4 D-7's silence rule is implementable, and this is the shape

`packages/domain/src/workout/erg-safety.ts` §`assessErgCadence` is the model: a pure function over a
history of readings, **time as a parameter, not a clock**, returning a verdict — and saying when to
stop. The coach's is the same function pointed the other way. A typed sketch, **not shipped code**:

```ts
// Sketch only. Where it would live is a sub-issue's decision (§8, C); if it goes in
// packages/domain it may not read a clock, name a DOM type or import anything under apps/.

interface PowerReading {
  readonly at: Seconds;
  readonly watts: Watts | undefined; // undefined = dropped reading (NO_READING)
}

interface CoachInput {
  readonly switchedOnForThisRide: boolean; // S5 — per ride, off by default
  readonly thresholdPower: Watts;
  readonly thresholdAssumed: boolean; // thresholds.ts assumed.power — D-7's note
  readonly power: readonly PowerReading[]; // the effort signal
  readonly segmentAboveThreshold: boolean; // S4, from the workout timeline at `now`
  readonly secondsToEndOfHardSegment: number | undefined; // S4's 30 s
  readonly safetyEventActive: boolean; // rescue, trainer lost, workout fault, paused, absent
  readonly lastUtteranceAt: Seconds | undefined; // S2
  readonly alreadySaid: ReadonlySet<string>; // §4.1's no-repeat
  readonly early: readonly TimedPose[]; // the earlier window
  readonly late: readonly TimedPose[]; // the window ending now
}

type CoachVerdict = { readonly kind: 'silent' } | { readonly kind: 'may-say'; readonly sentence: string };

function assessCoach(input: CoachInput, now: Seconds, window: Seconds): CoachVerdict {
  const silent = { kind: 'silent' } as const; // silence is never explained: no reason field
  if (!input.switchedOnForThisRide) return silent; // S5
  if (input.thresholdAssumed) return silent; // D-7: a default never enables S1
  if (input.safetyEventActive) return silent; // §4.1
  const inWindow = input.power.filter((r) => r.at > now - window && r.at <= now);
  if (!coversWindow(inWindow, now, window)) return silent; // no effort signal = high effort
  if (inWindow.some((r) => r.watts === undefined || r.watts >= input.thresholdPower)) return silent; // S1
  if (input.segmentAboveThreshold) return silent; // S4
  if (input.secondsToEndOfHardSegment !== undefined && input.secondsToEndOfHardSegment <= 30)
    return silent; // S4
  if (input.lastUtteranceAt !== undefined && now - input.lastUtteranceAt < 300) return silent; // S2
  if (!fresh(input.late, now)) return silent; // §4.3 rules 2–3
  const sentence = observationBetween(input.early, input.late); // side-report.ts's arithmetic, S3 ≥ 60 s
  if (sentence === undefined || input.alreadySaid.has(sentence)) return silent;
  return { kind: 'may-say', sentence }; // S6: sentence is from the vocabulary file, by construction
}
```

Every input already exists in the client except two pieces of bookkeeping the coach keeps itself — a
power history and the pose windows' freshness — as `assessErgCadence`'s caller keeps its cadence
history: `RideSnapshot.metrics` carries the current power reading and its state, `RideWorkoutSnapshot.timeline` and `.rescue` carry S4 and the
rescue, `TrainerSnapshot.lost` the trainer, `thresholds.ts` the threshold and whether it was assumed,
`camera/session.ts` §`riderPresence` presence, and `side-analysis.ts` §`poseSamples` the poses.
**S6 is structural**: `observationBetween` can only return a string from a vocabulary file, as
`side-report.ts` can only return one from `side-report-wording.ts`, and `no-absolute-angles.test.ts`
already scans every rendered string. **The one condition a machine cannot check is whether a sentence
that passes all of this is worth saying** — D-8 says the same of D-7's other five conditions.

### 4.5 Nothing on this path reaches a trainer control point

**Argued from the import graph, and the argument is the existing one.** A model's answer is
attacker-influenceable through the picture (ADR 0029 D-8; a sign held up to the camera is a prompt),
and this is the one path where a live loop and a resistance setpoint could plausibly meet.

- `analysis-safety.test.ts` §2 holds that every module holding an analysis answer imports nothing
  matching `TRAINER_MODULE` — `ride/controller`, `ride/trainer`, `ride/RideSession`,
  `game/gradient`, `game/trainer-port`, `game/GameView`, anything under `workout/`, and
  `@onyourleft/sensors`. `computer-pose.ts` is on that list and passes.
- `side-report-safety.test.ts` walks **every relative import transitively**, dynamic `import()`
  included, from each module on the report path, and finds none of them. The keeper reads the ride
  controller's snapshot **through an interface it declares itself** for exactly this reason.
- **The coach needs readings the ride controller owns** — power, the workout timeline, the rescue.
  That is the new risk: the easy way to get them is to import `ride/controller`, which is on the
  trainer list. So the coach reads them the keeper's way, through a narrow interface of its own
  declared in the coach module, **and the dependency points one way**: the announcer and `GameView`
  (both on the trainer side) import the coach and hand it readings; the coach imports neither.
- **Presence is a path to the trainer, and the coach must not touch it.** `analysis-safety.test.ts`
  §1 records why: a ride that thinks nobody is on the bike pauses, and a paused ERG ride eases the
  machine (#441). The coach **reads** presence (§4.1) and never writes it.
- **The proposed gate** (§8, E): `coach-safety.test.ts`, the report test's transitive walk over the
  coach's modules with the same `TRAINER_MODULE` pattern, plus a control asserting the pattern
  matches `../ride/controller`, `../game/gradient`, `../workout/session` and
  `@onyourleft/sensors/protocol`, as `analysis-safety.test.ts` §2 does — so a pattern that matched
  nothing could not pass. ⚠️ The report test's walk follows relative imports only; a coach module
  importing a workspace package other than `@onyourleft/sensors` is outside it, which is acceptable
  only because `packages/domain` cannot reach a trainer (no platform API, §4d).

### 4.6 A CPU budget the quality ladder sheds before the world degrades

**The coach's own arithmetic is small; the pose model under it is not.** Spike 0010 §6: at 5
pictures a second in a worker, the model costs **one core for ~58–80 ms of every 200 ms — 29–40 % of
one core at the p50, 37–51 % at the p95**, and it cost the ride no frames on a scene reading 10–12 ms
— **not** #323's 24 ms p50 load, and #247's 60-minute device-floor run is **still open**, so any
budget here stacks on an uncharacterised one. The coach itself compares two windows of at most a few
thousand nine-point poses every few seconds; that is not measured and is not expected to register
beside the model, and §6 row T6 measures it rather than assuming it.

The proposal follows the two precedents exactly:

- a **`coaching: boolean`** on `QualitySettings`, `true` **only on level 0** (and on the realistic
  ladder's first rung, which inherits level 0's figures), `false` from the **first step down** — the
  same place `capture` and `presence` go, for `presence`'s argument: _"the work that is not the world
  at all goes before any of it"_. It sheds at or before the first rung that reduces anything a rider
  sees and strictly before the first that caps frame rate, and needs no new rung (the rung indices
  are owner rulings, #476 and #482).
- **What shedding does**: the coach goes silent. Nothing else — the poses keep arriving for the
  report, as they do today.

⚠️ **This exposes a gap that is not the coach's**: the pose model itself — the 29–51 % of a core —
is on no ladder today (§2.2). A coach that is shed while the model runs on saves almost nothing. The
owner should decide whether a hot tablet may also stop looking at side-camera pictures, which costs
the post-ride report data; that is a question for #553/#530's owners, not a coach feature, and it
is listed in §8 as a separate item.

---

## 5. What was measured on this machine

### 5.1 Hardware and software

| | |
| --- | --- |
| Machine | MacBook Pro, `Mac16,8`, **Apple M4 Pro**, 12 cores (8 performance, 4 efficiency), **24 GB** (`system_profiler SPHardwareDataType`) |
| OS | macOS 26.6.2, build 25G83 (`sw_vers`) |
| Model server | **Ollama 0.30.5**, already installed and already running on `127.0.0.1:11434` before this spike (`lsof -nP -iTCP -sTCP:LISTEN`); nothing was installed or downloaded. Its OpenAI-compatible `/v1/chat/completions` is the endpoint #387's transport speaks |
| Models present | `ollama list`: six. Two report `vision` in `/api/show`'s `capabilities`: **`gemma3:4b`** (4.3 B parameters, Q4_K_M) and **`gemma4:12b`** (11.9 B, Q4_K_M, also `thinking`). Both were measured. Neither is recommended: ADR 0031 D-3/D-4 — the app names no model and no vendor, and naming them here records what was measured, not a choice |
| Python | 3.14.5, Pillow 12.1.1, the standard library's `urllib` and `http.server` |

⚠️ **What the Mac is not.** The owner's criterion is a model on _the rider's own machine_; this is
one such machine, not a floor. The transport measured is **loopback**, not the LAN, and nothing here
ran on the tablet.

### 5.2 The picture

No photograph of a rider exists in the repository, and none was taken. A **stand-in**: a side-view
stick rider on a bicycle drawn by `make_frames.py` at **256 × 192** (the side camera's ~256 px,
`side-camera.ts` §`PICTURE_INTERVAL_MILLISECONDS`' note), JPEG quality 80, **6 881 bytes**; a
**blank** control of the same size, **1 395 bytes**; and a **noise** picture (random pixels, blurred)
at **25 063 bytes**, close to spike 0010 §2's 26 KB input. The drawn landmarks are known: the head's
centre at (0.66, 0.22) of the picture, shoulder (0.63, 0.29), hip (0.41, 0.44), knee (0.53, 0.57).

JPEG encode on the Mac, 200 runs each: rider **0.076 ms p50 / 0.084 ms p95**, blank 0.061 / 0.067.
⚠️ That is Pillow on an M4 Pro, not the phone's canvas encoder; it bounds nothing about the phone
and is recorded so nobody quotes it as the capture leg (§6, T1).

### 5.3 The round trip on the Mac

The request body is `analysis-transport.ts` §`analysisRequestBody`'s shape exactly — `model`,
`stream: false`, `max_tokens: 400`, one user message of the `side-pose` prompt copied verbatim from
`analysis-port.ts` §`ANALYSIS_PROMPTS` and the picture as a `data:image/jpeg;base64,` URL — sent
sequentially, one at a time, as `computer-pose.ts` sends them. Time is wall-clock from before the
request is written to after the whole body is read.

| Leg | Command | n | Result |
| --- | --- | --- | --- |
| HTTP over loopback, no model (a local `http.server` that reads the body and answers a fixed `{"rider":false}` reply, started and stopped by this spike) | `roundtrip.py http://127.0.0.1:18765/v1/chat/completions null rider.jpg 201` | 200 after 1 warm-up | **0.2 ms p50, 0.3 ms p95** (10 060-byte request) |
| The same, with the 25 KB noise picture | `… null noise.jpg 201` | 200 | **0.2 ms p50, 0.2 ms p95** |
| **`gemma3:4b`, rider picture, cold** (model not loaded: `/api/ps` was empty) | `… 11434 … gemma3:4b rider.jpg 21` | 1 | **8 114.1 ms** |
| **`gemma3:4b`, rider picture, warm** | same run | 20 | **p50 2 252.6 ms, p95 3 192.4 ms**, min 2 047.1, max 3 644.5. 465 prompt tokens; 114–216 answer tokens, and the slow answers are the long ones (pretty-printed JSON) |
| `gemma3:4b`, blank picture | `… gemma3:4b blank.jpg 6` | 6 | first 3 070.2 ms; last five 1 113.1–3 515.1 ms, p50 **1 136.9 ms** |
| `gemma3:4b`, noise picture | `… gemma3:4b noise.jpg 6` | 6 | first 4 085.1; last five p50 **1 981.0 ms** |
| **`gemma4:12b`, rider picture** | `… gemma4:12b rider.jpg 11` | 11 | first 26 132.9 ms; last ten p50 **17 445.5 ms**, p95 59 312.2. **Every answer's `content` was empty**: all 400 of `max_tokens` went to the model's thinking, so under the product's exact request it returned nothing a reader could use |

Afterwards both models were unloaded with `keep_alive: 0` and `/api/ps` read empty again.

**What the round trip on this machine is, then**: with the smaller model, **about 2.3 s per picture
warm and 8 s cold**, of which the HTTP itself is under a millisecond. At the side camera's five
pictures a second, `computer-pose.ts` keeps one in flight and `side-analysis.ts` drops the rest, so
the computer path looks at **roughly one picture in eleven** (the 2.25 s p50 against 200 ms), about
**27 in a 60 s window** — under the report's own `MINIMUM_POSES_PER_THIRD` of 30.

### 5.4 What the answers said — read by the product's own reader

Every answer was run through the **real** `computer-pose.ts` §`sidePoseFromAnswer` (aspect 256/192)
in a throwaway Vitest file that was deleted afterwards and never committed:

| Picture | Answers | `pose` | `no-rider` | `unreadable` |
| --- | --- | --- | --- | --- |
| rider, `gemma3:4b` | 21 | 17 | 0 | 4 |
| **blank**, `gemma3:4b` | 6 | **1** | 4 | 1 |
| **noise**, `gemma3:4b` | 6 | **4** | 2 | 0 |
| rider, `gemma4:12b` | 11 | 0 | 0 | 11 (empty content) |

Over the 17 accepted poses of **one identical picture**, the range of each landmark across answers
(x and y as fractions of the picture):

| Landmark | x range | y range |
| --- | --- | --- |
| ear | 0.32 – 0.54 | 0.35 – 0.60 |
| shoulder | 0.35 – 0.54 | 0.26 – 0.74 |
| elbow | **0.18 – 0.71** | 0.27 – 0.81 |
| wrist | 0.10 – 0.89 | 0.28 – 0.95 |
| hip | 0.13 – 0.59 | 0.08 – 0.45 |
| knee | 0.21 – 0.59 | 0.08 – 0.70 |
| ankle | 0.00 – 0.73 | 0.05 – 0.90 |

Three findings, each stated as what it is:

1. **Repeatability on identical input is poor.** The same picture, twenty times, put the elbow
   across half the picture's width. The transport sends no `temperature`, so the server's default
   sampling applies; whether a fixed temperature narrows it was **not** measured.
2. **It is not near the drawn rider.** The drawn head is at x 0.66; no accepted answer put the ear
   above x 0.54. This is one drawn picture, not a photograph, and proves nothing about photographs —
   but a stick figure is the easy case.
3. **Pictures with nobody in them produced poses the reader accepted** — one of six blank, four of
   six noise. `sidePoseFromAnswer` checks shape, keys and range, which is all it can check; a
   fluent wrong answer passes. A post-ride report built on such poses would compare hallucinations.
   ⚠️ **This is a finding about #553's shipped path, not only about a coach**, and §8 lists it
   separately.

**Consequence for a coach**: a general vision model on the rider's computer is **not a usable pose
source for anything said during a ride**, on this evidence. If a coach exists, it reads the
**tablet's own MediaPipe poses** (5 a second, 65.8 ms p50, spike 0010), and then the "round trip to
the rider's machine" is not on its path at all — the latency that matters is capture → side link →
tablet model → coach → speech, all on devices in the room. Which is a different measurement from the
one the owner named, and the owner should say which is wanted (§8, A).

### 5.5 Reproduce

The three scripts are short and were run from a scratch directory outside the repository; they are
reproduced here so the figures can be re-taken without the scratch directory.

```bash
# 1. The pictures (writes rider.jpg, blank.jpg; prints encode times). noise.jpg:
#    Image.frombytes('RGB',(256,192),os.urandom(256*192*3)).filter(GaussianBlur(0.6)), quality 80.
python3 make_frames.py
# 2. Loopback overhead: start a fixed-answer server, measure, stop it.
python3 echo_server.py 18765 & SP=$!
python3 roundtrip.py http://127.0.0.1:18765/v1/chat/completions null rider.jpg 201
kill $SP
# 3. The model: first request is the cold one (check `curl -s 127.0.0.1:11434/api/ps` is empty).
python3 roundtrip.py http://127.0.0.1:11434/v1/chat/completions gemma3:4b rider.jpg 21
python3 roundtrip.py http://127.0.0.1:11434/v1/chat/completions gemma3:4b blank.jpg 6
python3 roundtrip.py http://127.0.0.1:11434/v1/chat/completions gemma3:4b noise.jpg 6
python3 roundtrip.py http://127.0.0.1:11434/v1/chat/completions gemma4:12b rider.jpg 11
# 4. Unload: curl -s 127.0.0.1:11434/api/generate -d '{"model":"gemma3:4b","keep_alive":0}'
```

`roundtrip.py` builds `{"model", "stream": false, "max_tokens": 400, "messages": [{"role": "user",
"content": [{"type": "text", "text": <the side-pose prompt>}, {"type": "image_url", "image_url":
{"url": "data:image/jpeg;base64,…"}}]}]}`, posts it with `urllib.request`, and records wall-clock
milliseconds, the `usage` block and the answer's `content`. The reader check calls
`sidePoseFromAnswer(content, 256 / 192)` on each saved answer from a temporary test under
`apps/web/src/camera/`, deleted after the run.

---

## 6. The tablet's legs: a procedure with its cells empty

These need the owner's tablet, the tripod phone and a rider, so they belong in the owner's device
session, [#733](https://github.com/openzigs/onyourleft/issues/733). This document does not edit that
issue; the owner adds the rows if the recommendation is accepted. **Every result cell is empty until
somebody runs it.** A debug build is needed for T3–T5, because `apps/mobile/tools/webview-probe.mjs`
only attaches to one.

| # | Leg | Transport, model, hardware | How to measure it | Result |
| --- | --- | --- | --- | --- |
| T1 | Capture and encode on the phone: shutter to a JPEG in memory | the tripod phone's WebView, 256 px, `FRAME_QUALITY` 0.8 | A debug build on the phone; `webview-probe.mjs` with an async IIFE that draws the live `<video>` into a 256-px canvas and calls `toBlob('image/jpeg', 0.8)` 100 times, timing each with `performance.now()`. Report p50 / p95 | |
| T2 | Phone → tablet over the side link | WebRTC data channel, host candidates only (ADR 0033 D-1), same Wi-Fi | Needs a timestamp on both ends; the side link carries a sequence number and milliseconds but no send time (ADR 0033 D-3: _"the camera stands alone"_). So: probe the phone for the send instant of sequence _n_ and the tablet for its arrival instant, both against `Date.now()`, with both devices' clocks read against the Mac's `date` over adb first to get their offsets. Report p50 / p95 of the arrival minus the send, corrected | |
| T3 | Tablet pose model, beside the ride | MediaPipe lite, worker, Pixel Tablet | **Already measured**: spike 0010 §5.4, 65.8 / 80.9 ms p50 / p95 beside the stylised game in Chrome; 68.0 / 83.0 in the app's WebView (§5.5 there). Re-measure only on #323's 24 ms load | 65.8 / 80.9 ms (spike 0010) |
| T4 | Tablet → the rider's computer and back, **with the model** | Capacitor native HTTP (#553), plain `http:` on the LAN (ADR 0029 D-6), Wi-Fi, the §5 Mac and `gemma3:4b` | The model server listening on the LAN address (the Mac's server listens on loopback by default and has to be told to listen on the LAN). With the app open, `webview-probe.mjs` an async IIFE calling `Capacitor.Plugins.CapacitorHttp.post({url, headers: {'Content-Type': 'application/json'}, data: <§5.3's body with the rider picture>})` 21 times, timing each with `performance.now()`. Report the first, then p50 / p95 of the rest | |
| T5 | The same with a trivial answer | as T4, against `echo_server.py` bound to the Mac's LAN address | As T4. T4 minus T5 is the model; T5 minus §5.3's 0.2 ms is the Wi-Fi and the native bridge | |
| T6 | The coach's own decision and the sentence reaching the rider | the HUD's live region and TalkBack, on the tablet | **Needs code that does not exist** (§8, C and D) — so it cannot be measured before something is built, and that is stated rather than hidden. Once a harness exists: time from `assessCoach` returning `may-say` to TalkBack beginning to speak, filmed at 240 fps beside the screen, 10 utterances | |
| T7 | CPU while it all runs | Pixel Tablet, the game at level 0, side camera filming | `realistic-sampler.sh` (validation 0002 Part AH) for ten minutes with the side camera filming and the tablet's model running, then the same with nothing filming: frame p50 / p95 and CPU from `gfxinfo` and the sampler | |

**The end-to-end figure the owner asked for** is T1 + T2 + (T3 **or** T4) + T6 for one utterance's
worth of pictures — and, because S3 needs 60 s of persisted observation, it is dominated by the
window rather than by any single leg. A two-second leg delays a sentence built on sixty seconds of
pictures by two seconds; a thirty-second deadline, and a pose source that answers a picture of
nobody, are what would actually break it.

---

## 7. What was not measured, and why

| Not measured | Why |
| --- | --- |
| Any leg on the tablet or the phone | No device was used; §6 is their procedure. Deliberately not attempted from here |
| A LAN round trip | Loopback only. T4 and T5 are the LAN |
| A photograph of a rider | None exists in the repository and none was taken. §5.4's findings are about a drawn stand-in and two no-rider controls |
| Whether a fixed `temperature` or a different prompt improves repeatability | Out of scope for a decision spike, and would change `analysis-transport.ts`' request, which is #553's |
| Accuracy of the tablet's MediaPipe poses | #385's accuracy half, still undone. `MEASURED_SPREAD_DEGREES` stays `undefined` |
| Whether a live sentence is worth hearing, or safe to hear, at ride intensity | Nobody rode. Validation 0003 Part I (sounds at ride intensity) is the nearest procedure and its table is empty |
| #323's 24 ms load with the pose model beside it | Spike 0010 §8 records the same gap; #247 is open |

---

## 8. Recommendation

**Proceed to measurement and to two owner rulings only. Build nothing.** The owner's own condition —
_"They must be met before anything is built"_ — is not met: the end-to-end round trip is measured on
the Mac's side only, and T1, T2, T4–T7 are empty. And two things this spike found would decide the
matter before any latency does:

1. **The rules as they stand forbid it.** ADR 0033 D-6 (pose numbers never reach an announcement)
   and ADR 0030 R7 with condition 5 (no notification fired on a reading) both have to move, by the
   owner, before a push coach can exist. A **pull** shape — the report-so-far, opened by the rider
   during an easy block — may fit R7 as written, but it still needs D-6 changed.
2. **The rider's-computer pose source is not fit for a live sentence.** On one identical picture it
   scattered landmarks across half the frame, and it gave poses for pictures of nobody (§5.4). A
   coach would read the tablet's own model — whose accuracy is also unmeasured (#385).

If the owner reads the above and still wants the branch open, the draft sub-issues below are the
order to do it in. **None is filed.** Each is a title, a scope and its acceptance criteria.

### A. Owner ruling: which round trip is the criterion, and push or pull

- **Scope**: an owner comment on #389 answering (1) whether the measured round trip must go to the
  rider's own computer (T4) or may be the in-room path through the tablet's model (T1 + T2 + T3),
  given §5.4; (2) push or pull (§3.1); (3) whether ADR 0033 D-6 changes for this.
- **Acceptance**: the three answers recorded; if D-6 changes, an appended ADR 0033 amendment (or a
  superseding ADR) in the pull request that records it; if R7's reading changes, an appended ADR 0030
  amendment.

### B. Fill §6's cells on the owner's device session

- **Scope**: T1–T5 and T7 run on the tablet and the phone, results written into this spike's
  successor write-up (a later run is a second write-up, `CLAUDE.md` §7), not into this file's cells.
  Rows added to #733 by the owner.
- **Acceptance**: every T-row but T6 has a dated figure with its command; the end-to-end figure is
  stated on a named transport, model and hardware.

### C. D-7 as a pure function — only after A and B

- **Scope**: §4.4's `assessCoach`, with §4.1–§4.3's rules, tested the way `erg-safety.test.ts` is.
- **Acceptance**: a test per D-7 condition that fails when that condition's check is deleted (§5
  mutation list); a test that `thresholdAssumed` alone forces silence; a test that a pose older than
  §4.3's freshness bound is discarded, not spoken; a test that no sentence is said twice in a ride;
  the function reads no clock.

### D. The live vocabulary, and its place in the announcer

- **Scope**: one vocabulary file for live sentences (or the report's, reused), and a new lowest-rank
  `AnnouncementKind` in `announce.ts`, dropped rather than queued, never in `ALWAYS_SPOKEN`, no sound.
- **Acceptance**: every live sentence checked against D-2 in the pull request by a reviewer;
  `no-absolute-angles.test.ts` covers the file; a test that the coach kind is last in `PRIORITY`; a
  test that a coach sentence is dropped, not queued, behind any other kind.

### E. The coach's trainer gate

- **Scope**: `coach-safety.test.ts` as §4.5 describes, landing **before or with** the first coach
  module.
- **Acceptance**: the transitive walk over the coach's modules finds no `TRAINER_MODULE` match; the
  control proves the pattern matches the four trainer specifiers; a mutation adding
  `import '../ride/controller'` to a coach module turns it red.

### F. `QualitySettings.coaching`

- **Scope**: §4.6's flag, `true` on level 0 and the realistic ladder's first rung only.
- **Acceptance**: `quality.test.ts` asserts it is `false` at or before the first rung that reduces
  anything and strictly before the first that caps frame rate, as `presence` is asserted; a test that
  `GameView` silences the coach on the first step down.

### Not part of this branch, listed because this spike found them

- **The side camera's pose model is on no quality rung** (§2.2, §4.6). A question for #530/#553's
  owners: may a hot tablet stop looking at side-camera pictures, at the cost of the report's data?
- **`sidePoseFromAnswer` accepts a fluent answer about a picture with nobody in it** (§5.4). On
  #553's shipped path that feeds the post-ride report. Worth its own issue: whether the computer path
  should stay offered while this is so, and whether the report should say it came from the computer.
