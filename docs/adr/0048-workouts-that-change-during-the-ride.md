# ADR 0048: Workouts that change during the ride — a heart-rate hold on the device, and re-plans an instance agent may only propose

- **Status**: **Accepted, 2026-10-09**, on the owner's rulings of that day: thirteen answers to
  [#1233](https://github.com/openzigs/onyourleft/issues/1233)'s §9
  ([comment](https://github.com/openzigs/onyourleft/issues/1233#issuecomment-6091242146)) and the
  confirmation of Q5 that followed
  ([comment](https://github.com/openzigs/onyourleft/issues/1233#issuecomment-6091256317)), both
  quoted verbatim in Context, and a third ruling the same day that makes Q5's *"Operator key is not
  shared with riders"* general (*"yes share mode should go for post ride analysis"*, D-11). Where the issue's design and the rulings differ, the rulings win, and
  §"How the rulings change the design" lists each place. **Nothing is built by this ADR**: the
  issues gated on it (#1234 to #1246, all under [#1092](https://github.com/openzigs/onyourleft/issues/1092))
  build it
- **Date**: 2026-10-09
- **Deciders**: **the owner**, in the two rulings above. The author wrote the wording and decided the
  engineering content the rulings do not settle; each such point is marked *the author's choice*
- **Issue**: [#1233](https://github.com/openzigs/onyourleft/issues/1233). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092)
- **Number**: **0048**, reserved by #1233's title on 2026-10-09, when `docs/architecture.md` said
  the next free number was 0048 and no open issue or pull request named it. The pull request that
  writes this ADR adds the ownership row and moves the "next free number" sentence to 0049
- **Amends, by appended entries dated 2026-10-09** (ADR 0013; no body line of any of them is
  edited):
  - [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) **D-7**, for
    **one job type**, the re-plan during the ride (Q2), and **D-9**, whose **Share** mode the owner
    withdrew on 2026-10-09 for every job, post-ride analysis included (D-11);
  - [ADR 0017](0017-workout-file-format.md), **format version 2** for the heart-rate hold block (D-3);
  - [ADR 0030](0030-what-the-app-may-say-about-a-body.md), that this ADR's wording rules (D-12) apply
    to every workout string (Q12)
- **Related, and not superseded**: [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-8 and its
  corollary, [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3(a),
  [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md) D-7,
  [ADR 0007](0007-patent-posture.md), and [#389](https://github.com/openzigs/onyourleft/issues/389)'s
  rulings of 2026-09-28 and 2026-09-30, which stand

## Context

### The question

The owner asked on 2026-10-09: *"Allow agentic AI to give realtime dynamic workouts. The agentic AI
would change the output on the fly based on how the user is doing with heart rate, cadence and
power. The user would have to define goals."*

A smart trainer applies physical resistance to a person who is pedalling (`CLAUDE.md` §6). So the
question is not only *can a model change a workout*, but *what may it change, how fast, through
which writer, and what wins when anything goes wrong*. #1233 is the design; this ADR records it as
decided.

### What the owner decided, quoted so it is not argued again

[The rulings](https://github.com/openzigs/onyourleft/issues/1233#issuecomment-6091242146), verbatim:

> **Owner rulings, 2026-10-09** (given on the review page, round 3; each quoted as decided).
>
> - **Q1 Architecture:** approved. Two loops: a deterministic heart-rate hold on the device, shipped
>   first and alone, and an optional agent re-plan on the instance.
> - **Q2 May an agent's choice reach the trainer:** approved. Only as enumerated moves, only for
>   future blocks, checked by the device (which computes the watts), off unless switched on for the
>   ride. ADR 0046 D-7 is amended for the re-plan job type.
> - **Q3 #389's gate:** approved. #1233 is the safety review and #1235 the round-trip measurement;
>   the agent half is built only after both. The heart-rate hold is not gated by #389.
> - **Q4 Harder:** approved. Never above the loaded workout's own peak or the goal's ceiling, +5 % a
>   move, one harder move per 10 minutes, +10 % in total.
> - **Q5 Hosted model for in-ride re-plans: CHANGED.** The owner's words: *"yes if the user provides
>   an api key can use a hosted model along with hosted"*. Reading, to be confirmed by the owner
>   before ADR 0048 is written: a hosted model may be used for in-ride re-plans when the rider has
>   provided their own API key (bring-your-own, #1199), alongside the instance's own model, under
>   that rider's recorded hosted consent naming the endpoint (ADR 0046 D-9), with the same masking
>   (#1101). Whether Share mode (the operator's key) is also allowed is not yet settled.
> - **Q6 Hold numbers:** approved as written (ceiling 0.85 × own threshold power, 90 s settling, 5 s
>   updates, +5 W / −10 W, 15 W a minute up, 15 s silence fallback). Any change is a recorded
>   decision.
> - **Q7 Automatic:** approved. Applied at the next block boundary, announced, with one *Keep the
>   plan* control.
> - **Q8 What leaves the device:** approved. Per-block summaries only, sealed; accepted and refused
>   moves kept with the ride.
> - **Q9 Goals:** approved. Typed `workout-goal` kind, separate from #836's free text, which never
>   sets a limit.
> - **Q10 Names:** approved. *heart-rate hold* and *re-plan during the ride*.
> - **Q11 Patents:** approved. Do the claim-chart spike (#1234) before the agent half is built.
> - **Q12 Wording:** approved. The banned-word list, a source scan for it, and a reviewer checklist.
> - **Q13 Scope:** approved. A workout block only in the first release.

[The Q5 confirmation](https://github.com/openzigs/onyourleft/issues/1233#issuecomment-6091256317),
verbatim:

> **Owner ruling on Q5, confirmed 2026-10-09:** *"yes hosted and local models allowed. Operator key
> is not shared with riders. If it is hosted they need to bring their own key"*. In-ride re-plans
> may use the instance's local model, or a hosted model **only on the rider's own key**
> (bring-your-own, #1199), under that rider's recorded consent naming the endpoint, masked as #1101
> does. The operator's key is never used for a rider's re-plan. The hosted re-plan is therefore also
> blocked by #1199.

A third ruling, given the same day when the author asked whether Q5's *"Operator key is not shared
with riders"* also reached post-ride analysis, verbatim: *"yes share mode should go for post ride
analysis"* ([recorded on #1092](https://github.com/openzigs/onyourleft/issues/1092#issuecomment-6091274039)). So the rule is **general**: [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
D-9's Share mode is withdrawn, and a hosted model runs only on a rider's own key.

### How the rulings change the design

| #1233's body said | The ruling | Effect |
|---|---|---|
| §9 Q5, *"Recommended: not in the first release. Ollama on the instance only"* | Q5, confirmed: hosted allowed **on the rider's own key only** | D-11. The operator's key is never used for a rider's re-plan |
| [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-9, *"Share: the operator sets one key, and every permitted rider's analysis uses it"* | The third ruling, *"yes share mode should go for post ride analysis"* | D-11. Share mode is withdrawn for every job; ADR 0046 gains an appended amendment |
| §9 Q2, *"The alternative is the HR hold only, with the agent advising after the ride"* | Q2: approved, enumerated moves only | D-5 to D-7; ADR 0046 D-7 amended for one job type |
| §9 Q4, *"The alternative is easier or equal only"* | Q4: harder approved, within P3 and P4 | D-6's ceilings and rates |

Every other §9 recommendation was approved as written.

### The physiology and the round trip, which is why there are two loops

- **Heart rate follows power slowly.** Hunt & Hurni (2019,
  [PMC6828638](https://pmc.ncbi.nlm.nih.gov/articles/PMC6828638/)) identified a first-order model,
  *"k = 0.392 bpm/W"* and *"τ = 65.6 s"*, over 25 participants, controlled at *"0.2 Hz (sample
  interval of 5 s)"* on *"the mean of the latest five discrete HR samples"*. Participants were
  healthy males aged 22–36, in a laboratory. ⚠️ **The paper states no rate limit and no power
  bound**: every bound in D-3 is this project's, approved by the owner, not theirs.
- **A model is seconds to minutes.** Spike
  [0016](../spikes/0016-live-in-ride-coaching.md) §5 measured a 4.3B model on the rider's own
  computer at **2 252.6 ms p50 / 3 192.4 ms p95 warm** and **8 114.1 ms cold**, over loopback. The
  tunnel, the sealed transport (ADR 0047) and a tool-calling agent (ADR 0046 D-7: up to 24 model
  calls and 10 minutes) add to that. A sensor loop is 1 s. **So a model cannot be the fast loop**,
  and the fast loop needs none.
- **Prior art.** A deterministic heart-rate hold is old and ordinary: TrainerDay's heart-rate mode,
  iFIT's ActivePulse, and heart-rate-controlled ergometers from the 1970s and 80s (D-13's table).
  What nobody documents is a **language model** changing a workout mid-ride; the nearest is
  Peloton's unexamined application (D-13).

### What the repository already gives this (read on `main` at `8dece4df`, 2026-10-09)

- `packages/domain/src/workout/player.ts`: the player *"emits an INTENT, and the caller does the
  writing"*, and *"assumes it is the only thing writing a target; a new writer to the same
  characteristic has to be refused the same way"*.
- `packages/domain/src/workout/erg-safety.ts` §`createErgRescue`: one rescue latch for every ERG
  writer, and *"silence is not recovery"*.
- `apps/web/src/ride/manual-erg.ts`: *"During a rescue, ONLY the rescue writes."*
- `apps/web/src/workout/session.ts`: easing is a `0x05` target to the machine's reported floor,
  never a Stop; the end is `letGo` through `apps/web/src/ride/controller.ts` §`releaseTrainer`.
- `packages/sensors/protocol`: every target is bounded by the Supported Power Range the device
  reported.
- `apps/web/src/analysis/thresholds.ts` reports `assumed.power` and `assumed.heartRate`.
- `packages/sensors/src/simulator/rider.ts`: the #44 simulator's heart rate is a fixed 145 bpm and
  does not respond to load ([#1238](https://github.com/openzigs/onyourleft/issues/1238) gives it one).
- `apps/instance/src/store/sql-store.ts` §`SYNC_KINDS` has a free-text `goal` kind (#836).
- `apps/web/src/game/hud/announce.ts`: one live region, priority by order.

### What was read for this ADR, and when

- #1233's body and its three comments, 2026-10-09.
- The repository on `origin/main` at `8dece4df`, 2026-10-09.
- The patent documents in D-13, each at the read-status that table states, 2026-10-09.

## Decision

### D-1 — Two loops, and the hold ships first and alone

**The owner's Q1.** Two loops, not one:

1. **The heart-rate hold** — fast, deterministic, **on the device**, inside the workout player. Every
   5 s it moves the ERG target in small, bounded steps to keep the rider's heart rate inside a range
   they chose. **It uses no model and needs no instance**, so
   [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3(a) holds: nothing that works with no
   instance starts to need one.
2. **The re-plan during the ride** — slow, **optional**, a job on the rider's instance
   (ADR 0046). At block boundaries it reads per-block summaries and the rider's goals and
   **proposes** one change to the **remaining** workout. The device decides (D-5).

The hold ships first and alone ([#1236](https://github.com/openzigs/onyourleft/issues/1236),
[#1238](https://github.com/openzigs/onyourleft/issues/1238) to
[#1241](https://github.com/openzigs/onyourleft/issues/1241)). The re-plan waits on D-14's gates.

### D-2 — The hold lives inside the workout player, which stays the one writer of targets

- The hold is computed **inside the player**, in `packages/domain/src/workout/` (Apache-2.0), pure,
  with time as a parameter. The player emits an intent; `session.ts` writes it exactly as today.
  **No second writer to the control point is added**, which is the condition `player.ts` states.
- An accepted re-plan (D-5) becomes a new **plan revision** that the player reads at the next block
  boundary. The re-plan never writes a target; the player does.
- Every target the player emits is still bounded by the Supported Power Range the machine reported
  (`packages/sensors/protocol`).

### D-3 — The hold's envelope, as the owner approved it

**The owner's Q6: "approved as written … Any change is a recorded decision."** These numbers are
therefore not tuning constants. Changing one is an appended amendment to this ADR, as
[ADR 0030](0030-what-the-app-may-say-about-a-body.md) D-7 says of its own thresholds.

The hold is a **new workout block kind**, `heart-rate-hold`: a duration, a heart-rate range the
rider chose, a starting share of threshold power, and a power ceiling share. It is **format
version 2** (`onYourLeftWorkout: 2`), recorded on [ADR 0017](0017-workout-file-format.md) by an
appended amendment: a version-1 file still reads, and a version-2 file is refused by an older build,
which ADR 0017 D-4 intends.

| # | Rule | Value | Why |
|---|---|---|---|
| H1 | Eligible only with the rider's **own** threshold power **and** threshold heart rate, never an assumed default; a heart-rate strap paired; trainer control held | `assumed.power === false && assumed.heartRate === false` | ADR 0030 D-7: *"a substituted default must not enable"* a load decision |
| H2 | The range | at least **6 bpm** wide; top at or below **100 %** of the rider's own threshold heart rate, and at or below their "do not go above" goal | Heart rate lags too much to hold anything above threshold |
| H3 | Power envelope | floor: the machine's reported minimum or the block's floor share, whichever is higher. Ceiling: at most **0.85 × own threshold power**, lowered by the rider's goal, never above the machine's maximum | The hold is for endurance work |
| H4 | Settling | no heart-rate-driven change in the first **90 s** of a block | about 1.4 τ |
| H5 | Update | every **5 s**, from the mean of the last 5 s of readings; **2 bpm** deadband; up at most **5 W** per update and **15 W** per 60 s; down at most **10 W** per update | Down is allowed faster than up |
| H6 | Overshoot | mean heart rate at least **10 bpm** above the top of the range for **30 s**: one write to the block's floor, held until heart rate is back inside the range for **60 s** | Bounded, and announced |
| H7 | Heart-rate silence | fewer than 2 readings in 10 s: freeze. After **15 s** of silence: back to the block's starting share, and **never raised** while silent | A dropped reading is not a zero; `createErgRescue`'s rule |
| H8 | Implausible heart rate | under **30** or over **230 bpm**, or a jump of more than **40 bpm in 2 s**, counts as silence | Strap contact, crosstalk |
| H9 | Stall rescue first | while the rescue says relief or floor, the hold is frozen; afterwards it resumes from the eased target | D-8 |
| H10 | Write rate | at most one write per 5 s from the hold; an unchanged whole-watt target is not rewritten | #542 |
| H11 | Pause, Stop, control lost | exactly as today; the hold keeps no state past its block | D-8 |

When any H1 condition fails, the block runs at its starting share as a plain steady block and the
screen says why, in a sentence from D-12's list.

**Scope (the owner's Q13).** In the first release the hold is **a workout block only** — not a
free-standing switch on the Ride screen. A one-block workout gives the same result through the one
code path.

### D-4 — What the model may propose: a closed list of moves, and a closed list of reasons

**The owner's Q2: "Only as enumerated moves, only for future blocks, checked by the device (which
computes the watts)."**

| # | Rule |
|---|---|
| P1 | **A move is exactly one of**: extend or shorten a future block by **1, 2 or 5 min**; scale the remaining intervals by **−10 %, −5 % or +5 %** of their share; move a hold's range by **±3 or ±5 bpm** inside the goal; swap the next block for one from the rider's **own saved workouts**; end the main set and go to the cool-down. **A reason is one of a fixed list.** Anything else is refused whole |

- **No free number and no free text reaches the device's decision.** The model chooses an
  enumerated move and an enumerated reason; the device computes every watt and composes every
  sentence the rider sees from its own wording (D-12). This is how
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-8's corollary — a model's text response is
  untrusted input and is never interpolated into anything that reaches a control point — is kept:
  there is no text to interpolate. **The model's choice still matters**, and Q2 is the owner's
  ruling that a choice from this list may.
- The vocabulary and its encoding are [#1242](https://github.com/openzigs/onyourleft/issues/1242)'s,
  in `packages/domain/src/workout/` beside the validator.

### D-5 — The device validator: a pure function that accepts or refuses, and what it cannot do

A **pure validator** in `packages/domain/src/workout/` (Apache-2.0, no platform API, time as a
parameter) receives a proposal, the loaded plan, its current revision, the rider's typed goals
(D-10) and the machine's range, and returns **accepted with a new plan revision**, or **refused
naming the rule** (D-6's P-numbers). It runs on the device. The instance never decides.

**What it cannot do, stated so a green validator is not read as more than it is:**

- It bounds **what** changes and **how fast**, not whether the change is wise. A move inside every
  bound can still be a poor choice for this rider today; the bounds are what make a poor choice
  cheap, and H-rules plus the stall rescue still apply within the new plan.
- It cannot verify the summaries a proposal was computed from were read correctly by the model; it
  checks only that the proposal names the **current** revision and summary (P5).
- It cannot see the rider. Effort check-ins (D-10) are the rider's own report, between blocks only.
- A harder move is bounded by **the loaded workout's own peak share** (Q4). A rider who loads a hard
  workout has already set that peak; the validator does not second-guess it.

### D-6 — The validator's bounds, with the owner's Q4

| # | Rule | Value |
|---|---|---|
| P2 | Never the current block. A move applies from the **next** boundary, and only if it arrives at least **30 s** before it | |
| P3 | Hard ceilings: never above the goal's ceiling, **the loaded workout's own peak share** for that block type, or the machine's maximum. Total time never above the goal duration. Warm-up and cool-down never shortened or removed | Q4 |
| P4 | Rate: at most **one** accepted move per **3 min**; at most **one harder move per 10 min**; **+5 %** per harder move, and **+10 %** cumulative over the loaded plan | Q4 |
| P5 | Freshness: a proposal names the plan revision and the summary it was computed from, and is refused if the revision has moved or it is older than **60 s** | |
| P6 | Refused while a rescue is active, while paused, without trainer control, without H1's eligibility, or inside the cool-down | |
| P7 | Off unless switched on for this ride | ADR 0030 D-7 S5's shape |
| P8 | Any failure — no instance, a timeout, a refusal, a malformed or late answer — leaves the plan as it is, and says nothing or one short line at most | D-9 |
| P9 | Every acceptance and refusal is kept with the ride on the device: the move, the rule that decided, and the time | Q8 |

**The owner's Q4** is the whole of P3's "loaded workout's own peak" clause and P4's harder-move
rates. **Easier moves are bounded by H3's floor and the machine's minimum**, never by a Stop.

### D-7 — Timing: applied automatically at the next boundary, with *Keep the plan*

**The owner's Q7: "Applied at the next block boundary, announced, with one *Keep the plan*
control."**

- An accepted move is **pending** until the next boundary, then applied without a tap. Asking a
  rider for a decision at threshold is the hazard #389 describes.
- It is **announced** in one sentence from D-12's list, through `announce.ts`'s one live region,
  under D-12's silence rules.
- **One 48 px ride-time control, *Keep the plan***, reverts a pending re-plan before its boundary
  (it joins `apps/web/src/design/ride-time-controls.ts` §`RIDE_TIME_CONTROLS`). A **per-ride
  switch** turns re-plans off (P7).
- **A late answer is dropped, not applied** (P2, P5). This is the opposite of
  `camera/useAnalysis.ts`'s *"a late answer still wins"*, which is right for a button and wrong here.

### D-8 — Precedence: the stall rescue, `releaseTrainer` and *Stop* always win

In this order, and nothing in this ADR reorders them:

1. **The controller's one release** (`apps/web/src/ride/controller.ts` §`releaseTrainer`), *Stop*,
   *Pause* and a lost link. Unchanged. A pending re-plan is discarded; the hold keeps no state past
   its block (H11).
2. **The ERG stall rescue** (`createErgRescue`). While it holds relief or the floor, **only the
   rescue writes** (`manual-erg.ts`'s rule): the hold is frozen (H9) and proposals are refused (P6).
3. **The heart-rate hold**, inside the current block.
4. **The plan**, as last revised by an accepted move, from the next boundary.

### D-9 — Fallbacks: every failure ends at the static workout already on the device

No instance, no model, a slow or malformed answer, a refused proposal, no strap, a silent or
implausible heart rate, a stalled rider, an unset threshold: each falls back to the **static
workout already loaded on the device** (P8, H1, H7, H8), or to the rescue (D-8). No failure ends
the workout, and none raises a target.

### D-10 — What leaves the device mid-ride, and goals as a typed synced kind

**The owner's Q8: "Per-block summaries only, sealed; accepted and refused moves kept with the
ride."**

- At each block boundary, or at most every 3 minutes, the device sends a **per-block summary**:
  duration, mean and highest heart rate, time inside the range, mean power, mean cadence, rescues.
  **Never a 1 Hz stream, a position or a date.**
- It travels **sealed**, on a route in [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-7's sealed-only list, with **no plaintext twin**.
- The proposal comes back sealed. P9's record of each acceptance and refusal is kept with the ride
  on the device and synced with it.

**The owner's Q9: "Typed `workout-goal` kind, separate from #836's free text, which never sets a
limit."**

- Goals are **typed, bounded and device-canonical**: session type (endurance, tempo, intervals,
  recovery); total duration; a heart-rate range to hold and a heart rate the rider does not want to
  go above; a power ceiling as a share of their own threshold; a time-in-range target; optional
  effort check-ins (a 1–5 tap **between** blocks, never during one).
- Stored in `packages/store` at a new schema version with a tested `down`
  ([#1236](https://github.com/openzigs/onyourleft/issues/1236)) and synced as a new sealed item kind,
  `workout-goal` ([#1237](https://github.com/openzigs/onyourleft/issues/1237)).
- **#836's free-text goals stay readable by the agent's `goals` tool, and never set a bound.** Only
  a typed goal can.

### D-11 — Which models may propose a re-plan, and on whose key

**The owner's Q5, confirmed: "yes hosted and local models allowed. Operator key is not shared with
riders. If it is hosted they need to bring their own key."**

- **The instance's local model** ([ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
  D-9 source 1, a local address only), **or**
- **a hosted model only on the rider's own key** (bring-your-own,
  [#1199](https://github.com/openzigs/onyourleft/issues/1199)), under **that rider's recorded consent
  naming the endpoint** (ADR 0046 D-9), with every input and tool result **masked** as
  [#1101](https://github.com/openzigs/onyourleft/issues/1101) masks a post-ride job.
- **The operator's key is never used for a rider's job — a re-plan or a post-ride analysis.** The
  owner's third ruling of 2026-10-09, *"yes share mode should go for post ride analysis"*, makes
  *"Operator key is not shared with riders"* **general**: [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
  D-9's **Share** mode is withdrawn, recorded there by an appended amendment. **A hosted model runs
  only on the rider's own key**, with that rider's consent naming the endpoint. The operator's own
  analyses may still use the operator's key **for the operator's own account**: that is the
  operator as a rider bringing their own key, not a key shared with anyone.
- A rider with no key of their own and no local model on the instance has no re-plan, and loses
  nothing else (D-9).
- The re-plan job otherwise follows ADR 0046: read-only tools scoped to one athlete, the job table,
  budgets (*the author's choice*: a re-plan's budget is #1243's to state and is well inside D-7's
  ten minutes, because P2 needs an answer 30 s before a boundary), and the screen on any text — of
  which a re-plan carries none to the rider (D-4).

### D-12 — Names, wording, and the banned-word scan

**The owner's Q10: "*heart-rate hold* and *re-plan during the ride*."** None of the names in D-13's
list is used anywhere: not *Adaptive Training*, *Progression Levels*, *Workout Levels*, *TrainNow*,
*SMART workouts*, *MPA* or *Maximum Power Available*, *ActivePulse* or *HR+*, and not §6's *FTP*
label (the project says *threshold power*).

**The owner's Q12: "The banned-word list, a source scan for it, and a reviewer checklist."** For
every string, store listing and release note about a workout:

- never *cardiac*, *heart condition*, *rehabilitation*, *patient*, *therapy*, *safe heart rate*,
  *protects your heart*, *medical*, *clinical*;
- never a heart-rate number called a limit for health or safety — it is *"the range you chose"*;
- never a claim to prevent, treat or reduce the risk of anything ([ADR 0030](0030-what-the-app-may-say-about-a-body.md)
  R5, including its negative form);
- the purpose is training: *"to help you ride at the effort you chose"*;
- one short sentence **about the workout, never about the body**, from a fixed list — for example
  *"Target lowered to keep your heart rate in your chosen range."* or *"Next block shortened by 2
  minutes."*

**The scan** is a source test over `apps/web/src` in the shape of
`apps/web/src/camera/no-absolute-angles.test.ts`; **the reviewer checklist** covers what no scan
reaches — the Play listing, the README and release notes, which [spike 0008](../spikes/0008-eu-uk-medical-device-read.md)
§8 records as unscanned. Both are [#1245](https://github.com/openzigs/onyourleft/issues/1245)'s. The
rules are recorded on ADR 0030 by an appended amendment.

**Announcements.** Two new kinds, `hold-changed` and `plan-changed`, rank **below** `trainer-lost`,
`workout-fault` and `erg-held`, and are never spoken inside the last 30 s of a hard interval or above
threshold power (the shape of ADR 0030 D-7 S1 and S4). A silence is never explained.

**Why the wording carries the distance.** The same function is a medical device when its intended
purpose is medical: a treadmill maker's MDR classification note puts a heart-rate-controlled mode on
a medical ergometer in class IIa, and names the hazard, *"Malfunction of heart rate measurement or
wrong target heart rate settings may result in overload"* ([h/p/cosmos, 2025-10-11](https://www.hpcosmos.com/sites/default/files/uploads/20251011_hpcosmos_risk_classification_mdr_treadmill_en.pdf);
a manufacturer's document, not guidance). Intended purpose under MDR Article 2(12) is read from
*"the label, the instructions for use or in promotional or sales materials or statements"* (spike
0008 §4.3). FDA's general-wellness condition 2 — no intervention that may risk the user's safety
without regulatory controls ([ADR 0030](0030-what-the-app-may-say-about-a-body.md)'s 2026-09-23
amendment) — is the one a trainer under heart-rate control comes nearest, and **D-3 and D-6 are the
controls, stated as such**. Whether an opt-in, bounded hold marketed for training stays outside the
MDR and UK MDR definitions is **a question for counsel, recorded and not bought**.

### D-13 — Patents and trademarks, read as far as each row says

**This is not a freedom-to-operate opinion** ([ADR 0007](0007-patent-posture.md) D1). #1233 §7's
table, with each row's read-status:

| Document | Status | What was read | Bearing |
|---|---|---|---|
| **US 2026/0249137**, Peloton, *"Real-Time Modification of Workouts Within a Connected Fitness Platform"* (application 19/065,891; filed February 2025, published 2026-08-27) | **Application, not granted** | **Press summaries only** ([The Clip Out](https://theclipout.com/peloton-ai-workout-patents-real-time-coaching/), [PeloBuddy](https://www.pelobuddy.com/?p=45352)). The claims were **not** read | Its described insert, remove, shorten and lengthen segments on heart rate is the nearest thing to P1. The highest risk if it is granted in that form |
| **US 2026/0249138**, Peloton, *"Real-Time Modification of Audio Content for a Virtual Coach Application"* | Application | **Press summary only** | Describes LLM-written cues in an instructor's synthesised voice. This design sends **no model text** to the rider and synthesises no voice |
| **US11270598B2**, Pear Health Labs (priority 2013-07-19, expiry 2034-04-11 per Google Patents) | Granted, active | **Claim 1 read first-hand** on Google Patents, 2026-10-09 | Claim 1 needs a content authoring tool, a workout store database, segment goals measured by heart rate, pace or intensity, a calculated **routine score**, adjusting a segment parameter *"based on the routine score … and based on historical workouts"*, and prompts chosen from a **segment prompt library** by score. Candidate design-arounds: compute no score, and choose no prompt by score. **Needs a full chart** |
| **US9886871B1**, Pear Health Labs (priority 2011-12-27, expiry 2034-09-22) | Granted, active | **Claim 1 read first-hand**. Other independent claims **not** read | Claim 1 requires *"bridging … the plurality of wireless protocols"* on a portable device. This project is BLE only (owner decision D2) |
| **US11850470B2**, Ergatta (priority 2020-07-31) | Granted | **Claim 1 read**: a **rowing machine**, modifying future sessions. Claims 5 and 18 **only summarised** | Between-session adaptation; claim 1 is limited to rowing |
| **US4800310A**, **US4323237A** (heart-rate-controlled ergometers, 1970s–80s) | Expired | **Search summaries only** | Prior art for the deterministic hold (ADR 0007 D6) |
| Hunt & Hurni 2019 | Published | **Read** | Academic prior art for heart-rate control on a cycle ergometer |

**The owner's Q11: "Do the claim-chart spike (#1234) before the agent half is built."** The hold
proceeds on its expired prior art.

**Names this project must not use** (others' marketing names; registrations **not confirmed** —
the USPTO search pages are blocked from here, as `CLAUDE.md` §6 records): *Adaptive Training*,
*Progression Levels*, *Workout Levels*, *TrainNow* (TrainerRoad); *SMART workouts*, *MPA* /
*Maximum Power Available* (Xert); *ActivePulse* (iFIT); *HR+* (TrainerDay); and §6's list.

### D-14 — Gates: what has to land before which half is built

| Half | Gated by | Why |
|---|---|---|
| The heart-rate hold (#1236, #1238 to #1241) | **this ADR only** | No model, no camera, no utterance about the body: **outside #389 entirely** (Q3) |
| The re-plan during the ride (#1242 to #1244) | **[#1234](https://github.com/openzigs/onyourleft/issues/1234)**, the claim-chart spike (Q11) | D-13 |
| The same | **[#1235](https://github.com/openzigs/onyourleft/issues/1235)**, a re-plan round trip measured on the owner's instance, sealed, through the tunnel, **and this ADR** as the written safety review (Q3) | #389's 2026-09-30 ruling: *"Research only for now. Build nothing until … a measured round-trip time … and a written safety review."* |
| A **hosted** re-plan | **[#1199](https://github.com/openzigs/onyourleft/issues/1199)**, bring-your-own keys with consent naming the endpoint (Q5) | D-11 |

**Relationship to [#389](https://github.com/openzigs/onyourleft/issues/389).** #389 asks whether
the app should talk mid-ride about the rider's **position**, from pose. This ADR is about **workout
targets** from heart rate, power and cadence: no camera, no statement about the body. **It does not
answer, supersede or depend on #389's question.** #389's 2026-09-28 ruling, *"nothing on this path
reaches a trainer control point"*, was said of the camera path and stands for it; Q2 is the owner's
separate ruling that an enumerated move chosen by the re-plan agent **may** affect a setpoint
through the device's validator. #389's 2026-09-30 gates apply to the agent half by Q3.

## Consequences

### What this enables

- A rider can hold a heart-rate range on an endurance block with no instance and no model, through
  the same player, writer and rescue every workout already uses.
- A rider with an instance can let it shorten, lengthen, ease or (within Q4) harden what is left of
  a workout, with the device computing every watt.

### What this costs, stated plainly

- **A model's choice now reaches a trainer**, through a closed list and a validator. That is new in
  this program and is why ADR 0046 D-7 is amended. A bug in the validator is a bug on the path that
  applies resistance to a person; [#1242](https://github.com/openzigs/onyourleft/issues/1242) owes
  mutation-verified tests for every P-rule, and the #44 simulator owes a heart rate that responds to
  load (#1238) before any closed-loop claim is made.
- **Format version 2 is refused by every older build** (ADR 0017 D-4), wholesale.
- **Mid-ride summaries leave the device**, sealed. A rider who switches re-plans on sends their
  block-level heart rate, power and cadence to their own instance, and — if they chose a hosted
  model on their own key — masked, to that endpoint.
- **The hold's numbers are rulings**, so a hardware session that suggests a better step size is an
  amendment, not a commit.
- **No first-hand claim chart exists yet** for the three live documents; the agent half waits for one.

### Constraints this places on other work

| Work | What binds |
|---|---|
| Any new writer of a trainer target | Refused: the player is the one writer (D-2) |
| Any change to an H- or P-number | An appended amendment to this ADR (Q6) |
| Any new re-plan move or reason | A change to this ADR's closed lists (D-4), not a template edit |
| Any workout string, listing or release note | D-12's list, the scan and the checklist |
| A hosted re-plan, or any hosted analysis | #1199 first; only the rider's own key, never a key shared by the operator (D-11) |
| The re-plan's routes | Sealed-only (ADR 0047 D-7), no plaintext twin |

### Open items, not decided here

- **Counsel**: whether an opt-in, bounded heart-rate hold, marketed only for training, stays outside
  the MDR and UK MDR definitions (D-12). Recorded, not bought.

## What would make this ADR wrong

- **US 2026/0249137 granted with claims that read on P1**, or #1234's chart finding that
  US11270598's claim 1 reads on the re-plan as designed. The agent half would then need a
  design-around or would not be built.
- **#1235 measuring a re-plan round trip that cannot land 30 s before a boundary** on the owner's
  instance. P2 would refuse almost every proposal, and the agent half would be a feature that never
  acts.
- **Hardware validation ([#1246](https://github.com/openzigs/onyourleft/issues/1246)) showing the
  hold oscillating or overshooting** at D-3's numbers on a real rider and trainer. The numbers would
  move by amendment; the architecture would not.
- **A regulator or counsel reading a bounded heart-rate hold as a medical function whatever the
  wording.** D-12's distance would not hold, and the hold would need either regulatory controls or
  removal.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-10-10** — **D-13's read-status for its first, third and fourth rows, and Consequences'
  *"No first-hand claim chart exists yet"*, have stopped being true.**
  [Spike 0022](../spikes/0022-re-plans-during-the-ride-patent-chart.md) (#1234, the owner's Q11) read
  every independent claim first-hand on 2026-10-10: **US 2026/0249137 A1** claims 1, 11 and 18 from
  the USPTO print server, **US11270598B2** claims 1, 9 and 19, and **US9886871B1** claims 1 and 22,
  and charted them against D-4 to D-7. It decides nothing; what it measured: the two Pear patents
  are **not met**, '598 on its routine score and the prompts chosen by it (and, for claims 9 and 19,
  environment data), '871 on bridging wireless protocols, calorie, weight-loss or temperature
  criteria, and broadcast. **Peloton's claims 1 and 18, as published, read on the re-plan**, and
  claim 1 reads on the heart-rate hold as well. Whether the first condition in §"What would make this
  ADR wrong" is met is **not known as of 2026-10-10**: no grant was found, and the application's
  status after its publication on 2026-08-27 could not be read from Patent Center (spike §1.3;
  ADR 0007 D7 records an unread fact as unread). Its #1234 clause is answered (US11270598's claim 1
  does not read, provided the spike's rule R1, *no performance score during a ride*, holds). The
  spike's ten rules (R1 to R10) are owned by the issues its §6 names, the heart-rate hold's among
  them: #1236 (R6), #1239 (R2, R10), #1242 to #1244 and #1245 (R2). Option H is #1243's to decide.
  Its §8 Questions A and B are put to the owner. (#1234)
- **2026-10-12** — **D-4's P1 and D-6's P3 and P4 leave eleven things open, which the owner ruled on
  that day on [#1296](https://github.com/openzigs/onyourleft/issues/1296); and D-6's *"Easier moves
  are bounded by H3's floor and the machine's minimum"* is not what the validator does.** The body
  above is not edited. #1242's author had decided the eleven alone, in
  `packages/domain/src/workout/replan.ts`; the rulings keep nine as built and change two (2 and 3).
  The validator's header and `docs/architecture.md` carry the same list under the same numbers.
  1. *"Scale the remaining intervals"* (P1) reaches steady and ramp blocks as well as intervals
     blocks. A hold and a free ride are not scaled.
  2. **Changed.** A swap is bound by P4's **+5 %** a move and **+10 %** cumulative: the block's
     count does not go back to 0.
  3. **Changed.** Shortening a **recovery** block, one easier than the block that follows it, is a
     harder move and is bound as harder moves are.
  4. A free ride may be swapped in with none loaded, because it sets no target. Every other kind
     needs a block of its own kind in the loaded workout (P3's peak is per kind).
  5. The validator does **not** read the machine's minimum. An easier move is bounded by the lowest
     share a target may carry (0.2, H3's floor share) and by nothing else; raising a target to the
     trainer's reported minimum belongs to whatever writes it.
  6. Warm-up and cool-down are the first and the last block.
  7. A scale is counted in percentage points of the share a block joined the plan with, so +5 %
     twice is +10 % exactly.
  8. With no duration goal, the plan may not grow past the loaded workout's own length.
  9. A hold range moves up only to the highest range loaded, and never above threshold heart rate
     or the goal's.
  10. An intervals block is neither extended nor shortened.
  11. A proposal must name the latest summary sent, and its age is counted from when it left.

  **The arithmetic for 2 and 3 is the implementer's proposal, as the ruling asked, and is the
  owner's to change.** Wherever the ruling's words left a choice, the reading that refuses more was
  taken; each such choice is marked ⚠️.
  - **2, a move's +5 %.** The comparison is of the **highest share** each block asks for: the block
    swapped in against the block it replaces *as ridden now* (after any scale), whatever their
    kinds. A rise over 5 % is refused under P4. ⚠️ A block with a target may not replace a free
    ride, which has no target to measure a rise from. ⚠️ A hold swapped in for a hold may have a
    range at most **5 bpm** higher, P1's largest step, since a hold's target is its range. The rise
    is a ratio of two shares and is not exact in binary (0.735 / 0.7), so a rise within 10⁻⁹ of a
    percentage point over a move's +5 % is taken as 5, and is stored as 5, so the count
    carried never holds a hair over it.
  - **2, the +10 %.** The new block carries a count: what the replaced block carried, plus the
    highest net scale any of the replaced block's shares had reached, plus this swap's rise. Over
    10, the swap is refused under P4. A later scale of the new block is counted from its own
    shares, and that carried count is added before the +10 % is checked. ⚠️ The count is **additive**: it sums each
    move's percentage, though the rises compound, so +10 % in total can reach about 10.25 % over
    the loaded share (P3's loaded peak still caps it). Measuring against the loaded share instead
    is the owner's to rule. ⚠️ A hold is measured at its ceiling share, a cap and not a target;
    the start share was available and was not taken. One swapped-in block that has spent its
    allowance makes a scale refuse every remaining block until it is ridden (the existing
    all-or-nothing rule). ⚠️ A swap to an easier
    block, and a net scale below zero on the replaced block, earn nothing back. ⚠️ Every swap is
    still a harder move for the one-in-10-minutes rule, an easier one included.
  - **3.** A block is a recovery when the **lowest** share it asks for is under the **highest**
    share of the block after it. ⚠️ So a ramp from 0.4 to 0.8 before a 0.7 block is one, and a hold
    is read at its start share. ⚠️ A free ride is a recovery before any block with a target, and
    nothing is a recovery before a free ride. ⚠️ Only the block immediately
    after is read, so shortening a 0.5 before another 0.5 and then a 0.9 is not a harder move. *"Bound as harder moves are"* is P4's one harder move
    in 10 minutes; P4's two percentages are about shares, which a shortening does not change. The
    3-minute rule and *"never shortened to nothing"* apply as before.

  **A defect fixed in the same change, under 7.** The count had been advanced by a move even where
  a ceiling or the floor stopped the share from moving, so a +5 % that changed nothing at the peak
  block was "undone" by the next −5 %, which then changed nothing either. The count is now kept
  **for each share** (an intervals block's hard and easy shares, a ramp's two ends) and is **the
  change reached**: a share that did not move keeps its count, and one stopped part of the way
  records how far it got. +5 % twice is still +10 % exactly where nothing stops it.

  **On 5.** As of this date nothing clamps a workout's own target to the trainer's minimum:
  `apps/web/src/workout/session.ts` raises only a stall-relief target to it, and the trainer client
  refuses a target under the reported range, so the previous target stays. That is so for a loaded
  workout with no re-plan, and is
  [#1297](https://github.com/openzigs/onyourleft/issues/1297), to land before or with #1244. Read
  from the code, not ridden on a trainer. (#1296)
- **2026-10-12** — **The amendment above left four choices marked as the owner's to rule, and its
  ruling 5 rested on a premise that did not hold. The owner ruled on all five that day on
  [#1300](https://github.com/openzigs/onyourleft/issues/1300), and two statements in that amendment
  have stopped being true.** Neither the body nor the amendment above is edited. The validator's
  header and `docs/architecture.md` agree with what follows.
  - **Ruling 5, accepted as the record reads.** Nothing clamps a workout's own target to the
    trainer's minimum today, and [#1297](https://github.com/openzigs/onyourleft/issues/1297) must
    land before or with #1244. No code changes for it here.
  - **a, changed: the +10 % is of the share the block was loaded with, so it is a true 10 %.** The
    amendment above says the count is *"additive"*, summing each move's percentage, so that +10 %
    could reach about 10.25 %. That is no longer so. Each place in the plan keeps the share it was
    **loaded** with (the loaded block's highest share), and every rise spent there is counted in
    percentage points of that one share: a swap's rise as the difference between the two shares, a
    scale of the replaced block as the share it had moved. Measured before: 0.7, a swap to 0.735
    and a swap to 0.77175 were both accepted, 10.25 % over the loaded share. Now the second is
    refused under P4 and 0.77 is the most. A +5 % scale of a block swapped in at +5 % is refused
    for the same reason (0.735 × 1.05 is 0.77175). A move's own +5 % is still measured over the
    block it replaces *as ridden now*.
    ⚠️ Ruling 7 is kept beside it: a scale also may not take a block swapped in more than 10 % above
    the share **it** joined with, however far under the loaded share it is. ⚠️ A fall still earns
    nothing back, since the count only grows. ⚠️ One consequence the other way, which follows from
    the ruling's words: a rise from a share that is *below* the loaded one now costs fewer points
    than it did (0.63 to 0.66 in a place loaded at 0.7 is 4.29 points, where it was 4.76), so a
    place taken well under its loaded share can be raised by more moves than before. It can never
    pass 10 % over the loaded share, and each move is still 5 % at most.
  - **b, changed: a replaced heart-rate hold is measured at its start share**, not at its ceiling
    share, which is a cap and not a target. Measured before: a hold starting at 0.5 with a ceiling
    of 0.85, replaced by steady 0.89, was accepted as a 4.7 % rise. Now it is refused under P4, and
    0.525 is the most. The share a place loaded with a hold keeps for the +10 % is its start share
    too. ⚠️ **Three choices the ruling's words leave, which are the implementer's and the owner's
    to change.** A hold swapped **in** for a block that is not a hold is still read at its ceiling
    share, the higher of its two, which refuses more. A hold swapped in for a **hold** is compared
    like with like, start with start and ceiling with ceiling, the larger rise counting for the
    +5 % and the larger difference for the +10 %: reading the new hold's ceiling against the old
    one's start would refuse a hold in place of an identical hold, and with it nearly every such
    swap. And ruling 3's test of a recovery reads a hold as it did (its start share against the
    highest share of the block after it, a hold's ceiling included); the ruling was about a hold
    that is replaced.
  - **c, kept as built.** One swapped-in block that has spent its allowance makes a +5 % scale
    refused for every remaining block until it is ridden. Under a, a block swapped in at a full
    +5 % is such a block from the moment it joins.
  - **d, kept as built.** A recovery is read from the block immediately after it only.

  The rounding note above is superseded with a: a rise is no longer stored as exactly 5. A total
  within 10⁻⁹ of a percentage point over +10 % is taken as +10 %, for a swap and for a scale, as a
  move's +5 % already was. (#1300)

- **2026-10-12** — #1297 landed the clamp. The session now raises every workout target under the
  trainer's reported minimum to that minimum, so the "nothing clamps" reading of 5 above no longer
  holds. A raised target equals the floor, so the forget-hold rule treats it as an ease and does not
  hold it back.

- **2026-10-12** — **Two readings of #1300's ruling a and b, ruled on
  [#1304](https://github.com/openzigs/onyourleft/issues/1304) the same day, are kept as built and
  written down.** Nothing above is edited and no code changes for either.
  - **A place eased well below its loaded share may climb back in more steps: accepted.** The +10 %
    is over the share the place was *loaded* with and each move is +5 % at most, so a place loaded
    at 1.0 and swapped down to 0.5 accepts 0.525, then 0.5512, then 0.5787: 15.7 % over the block
    that joined, where the old additive sum stopped at +10 %, and about 0.60 is reachable. Each
    move is still 5 % at most and ten minutes apart, and the place stays far under what the workout
    was loaded with.
  - **A hold swapped for a hold: kept as built.** The +5 % compares ceiling with ceiling, but the
    +10 % total divides the ceiling's rise by the place's loaded **start** share. A hold loaded from
    0.3 to a 0.7 ceiling therefore refuses a ceiling of 0.735, which is exactly +5 %, and any hold
    whose ceiling is more than twice its start share refuses even a +5 % ceiling move. It refuses
    more, never less. `carried` is an upper bound on what a place has risen, not the distance
    travelled: it counts the larger of the start's and the ceiling's rise in points of one share. (#1304)

- **2026-10-12** — **D-11 leaves a re-plan's budget to #1243, the 2026-10-10 amendment leaves it
  spike 0022's option H, and D-14's gate on #1234 was lifted for #1243 by the owner that day**
  (*"go now. Do not wait for counsel"*,
  [recorded on #1243](https://github.com/openzigs/onyourleft/issues/1243#issuecomment-6132451387)).
  The body above is not edited. #1243 built the instance job; what it decided is below, and each
  point but the first is **the implementer's choice and the owner's to change**.
  - **Hosted models: as D-11 says, not as #1243's body says.** The issue's *"Ollama on the
    instance only, unless #1233 Q5 rules otherwise"* predates the Q5 confirmation. A re-plan runs
    on the instance's local model, or on a hosted one only on the rider's own key, under their
    recorded consent naming the endpoint, masked. A rider with no key of their own is refused
    `hosted_unavailable`, whatever key the operator holds.
  - **Budgets**: at most 4 model turns, 3 tool calls, 6 000 tokens and **45 s**, the issue's
    proposed figures. ⚠️ The 45 s is counted **from when the device's request was queued**, not
    from when a worker took the job, because P5 drops an answer older than 60 s. ⚠️ They are not a
    measurement of a re-plan: spike 0023 measured a write-up's one model call, and no run there
    called a tool. A spent budget is no proposal.
  - **Option H: taken.** The re-plan job has `ride_so_far`, `goals` and `saved_workouts`, and
    neither `recent_rides` nor `history_search`. It costs the re-plan the rider's earlier rides.
    Spike 0022 §3.5 says what it adds: a second element of US11270598's claims 1 and 19 the
    design does not have, beside the score. That is the spike's chart, not an opinion (ADR 0007
    D1). It also keeps a run inside its token budget.
  - **A model writes neither `revision` nor `summarySeq`.** It answers exactly `{ move, reason }`;
    the instance copies the other two keys from the device's input and reads the whole with
    #1242's decoder. So the instance's check is the device's decoder over the model's move and
    reason, and an answer carrying a revision of its own is no proposal.
  - **A model may answer that the workout should stay as it is** (`{ "keep": true }`), which is a
    job that succeeded with no proposal. D-4's closed list has no move for *no change*, and without
    this a model is asked for a change at every boundary. It is not a move and reaches nothing.
  - **No rewrite.** An answer that does not decode ends the job with no proposal and the cause
    `not-a-proposal`. A write-up is sent back once (ADR 0035 D-4); a re-plan has no time for it.
  - **A swap names a saved workout by its sync key**, which `saved_workouts` returns with each
    block's index and shape, and no name. No write-up tool returns a key.
  - **The typed goals travel in the job's input**, device-built, and are not read from the synced
    `workout-goal` item: the device's copy is canonical (D-10) and may be newer than the synced one.
  - **Spike 0022's R1 and R4**: the input's and the summary's keys are held by a test, and the
    re-plan's modules are scanned for the name of a performance figure or an environment figure.
    ⚠️ What that does not reach: the model is shown one block's *seconds in range* and the goal's
    *time-in-range* target together, and `goal-time-in-range` is one of D-4's reasons, so a model
    can compare the two. No code on the instance does. Whether the goal's target should be
    withheld from the job is **put to the owner**, with spike 0022 §3.4. (#1243)

- **2026-10-12** — #1305 narrowed #1297's clamp, on two owner rulings of that day recorded on
  [#1305](https://github.com/openzigs/onyourleft/issues/1305): *refuse a large raise and tell the
  rider*, and then *"yes"* to the narrower rule below. The #1297 entry above says the session
  raises "every workout target" under the trainer's reported minimum to that minimum. There is now
  one exception. A workout's own target more than 50 W under the minimum is not written, and the
  rider is told, **when this app knows of no target on the trainer at or above that minimum**.
  Where the trainer may hold one, the minimum only eases and is written whatever the gap. What
  counts as a target the trainer may hold: one the control client has confirmed (a hand-set target
  from before the workout included); one it had confirmed or attempted and can no longer vouch for
  (a lost link, a Stop, a gradient, a write with no answer); and, where the client knows of none,
  the last target that trainer acknowledged to this app since the page loaded, which the ride
  controller keeps by device because the client forgets it when the machine takes control away and
  a new pairing starts a new client. Only the first is known to be on the machine. The control
  client sends nothing under the machine's minimum, so in the client a refusal happens only on a
  trainer this app has had no target acknowledged by since the page loaded. ⚠️ That is not a
  trainer holding nothing: a target from before a page reload, from another app or from the
  machine's own buttons is not known to this app, and a refusal leaves it on. An eased target (the
  stall relief, a pause, a free ride) is raised or written as before, so on such a trainer the
  refusal lasts only until the first of those. H3 is unchanged: a hold block's envelope starts at
  the machine's minimum inside the player, so the refusal never applies to a hold block. (#1305)

- **2026-10-13** — **D-7, D-9 and D-10 leave the device half of a re-plan to #1244, and the
  2026-10-12 entry on #1243 leaves it two things to decide: how the device retries, and whether the
  goal's time-in-range target is sent. The hold on #1244 was lifted by the owner that day**
  (*"start 1244"*,
  [recorded on #1244](https://github.com/openzigs/onyourleft/issues/1244#issuecomment-6146412087)).
  The body above is not edited. #1244 built it; what it decided is below, and each point is **the
  implementer's choice and the owner's to change**. Every rider-facing string is the owner's to
  approve before merge, with #1245's.
  - **The player takes a revision itself, and checks it itself.** D-2 says the player *"reads"* a
    new plan revision at the next block boundary. `packages/domain/src/workout/player.ts` §`revise`
    keeps the revised timeline waiting and starts reading it when the block being ridden ends. It
    compares every segment before that boundary with the plan it is riding and refuses a timeline
    in which one differs. So D-6's P2 is held twice: by the validator, and by the one thing that
    asks for a target.
  - **When a summary is sent.** D-10 says *"At each block boundary, or at most every 3 minutes"*.
    As built: as a block begins, and no sooner than three minutes after the last request. Nothing
    is sent inside a long block. A workout of one long block and a cool-down is therefore asked
    about once, at most.
  - **Retries: none.** A request that failed is not sent again; the next is the next block. A
    start the instance refuses for a reason that will not change (`rate_limited`, `analysis_off`,
    `validation_failed`, a session it no longer accepts) ends the asking for that workout;
    `job_running` does not. That is at most 20 requests an hour, under the 24 the instance allows,
    which a refused start still spends.
  - **A late answer is dropped twice over.** A job still out 60 s after it was asked for, or 30 s
    before the block ends, is cancelled and no longer listened to; and the validator refuses the
    same proposal under P5 or P2 if it lands between two ticks. Neither shows anything.
  - **Nothing is asked, and a job in flight is cancelled, while the ride is paused or the stall
    rescue holds the target** (P6), without trainer control, without a strap, as the cool-down
    begins, or in a block of under 30 s.
  - **The goal's time-in-range target is not sent** (spike 0022's rule R1). A summary carries a
    block's seconds in range, so the goal is withheld from the job's input until the owner rules.
    `goal-time-in-range` is still one of D-4's reasons, and a model may still choose it.
  - **Only the instance's own model is asked.** D-11 allows a hosted model on the rider's own key.
    The device sends `instance-local` only: a hosted re-plan needs the masking list sent first, as
    a hosted write-up does, and is not built.
  - **The switch is per workout, set as it starts, and off every time** (P7). It is offered only
    where the device is signed in to an instance and the rider has set their own two thresholds
    (H1). It cannot be turned off during the workout; ending the workout ends the re-plans.
  - ***Keep the plan* is on the Ride screen only** (D-7's one control). The game says an accepted
    move through its one region and offers no control. A rider in the game leaves it to keep the
    plan.
  - ***Keep the plan* drops the move waiting for the next block** (there is at most one: a job is
    asked for only as a block begins), and the plan takes a new revision number while keeping the
    dropped move's P4 times (`replan.ts` §`planNotApplied`). So a proposal computed from the
    dropped revision is refused under P5, and dropping a move does not buy another one sooner.
  - **P9's record has a third decision, `not-applied`**, beside `accepted` and `refused`: an
    accepted move the rider kept the plan from, a pause or the end of the workout discarded (D-8),
    or the player would not take. Without it the record would say a move was made that was never
    ridden.
  - ⚠️ **P9's *"kept with the ride … and synced"* is half built.** The record is kept with the
    ride on the device (`packages/store` §`RideFacts.replans`) and is in the account export. It is
    **not synced**: a ride reaches an instance as its activity file, which carries none of a
    ride's facts, and a synced record needs an item kind of its own. That is
    [#1315](https://github.com/openzigs/onyourleft/issues/1315).
  - **`plan-changed` is said once for each accepted move, with announcements on**, and is held
    while the workout is in a segment above threshold power or in the last 30 s of one at it
    (D-12). A move dropped or ridden before it could be said is not said.
  - **What was not measured.** Every test uses a scripted instance and the #44 simulator. No
    re-plan was run against a model or a trainer:
    [validation 0004](../validation/0004-heart-rate-hold-and-re-plans.md) Part B is that. (#1244)

- **2026-10-13** — **After #1244's review, five points of the entry above changed before it
  merged, and they are recorded as changes and not written over it.** Each is still the
  implementer's choice and the owner's to change.
  - **Retries: at the next block, for everything not known to be permanent.** The entry above
    ended the asking for any refusal but `job_running`. As built now, a list of PERMANENT refusals
    ends it — `unauthenticated`, `validation_failed`, `rate_limited`, `analysis_off`, and a sign-in
    the device no longer holds — and every other answer (`job_running`, `unavailable`, a 5xx a
    tunnel relayed with no code, a session that threw as it was opened) is asked again at the next
    block boundary, never sooner and never less than three minutes after the last. Still at most 20
    an hour.
  - **A request is held to the instance's 8 KB input budget.** The plan's blocks and the goals are
    sent whole; the oldest summaries are left out when all do not fit. D-10's *"per-block
    summaries"* is therefore *the most recent ones that fit* in a long workout, and #1245's
    disclosure says so.
  - ***Keep the plan* is in the game too.** The entry above left a rider in the game to leave it.
    The HUD's actions now show the control while a move waits, calling the same `keepThePlan`. The
    HUD still shows no sentence: that is
    [#1324](https://github.com/openzigs/onyourleft/issues/1324).
  - **A waiting move a pause or a lost link discards (D-8) is said, once.** D-7 has a dropped
    *proposal* shown as nothing. A move that was ACCEPTED, shown and perhaps spoken is a different
    thing to take away in silence, so one sentence composed on the device says it went, at the
    moment the plan ahead goes back. The wording is the owner's to approve with the rest.
  - **A re-plan record that does not read is dropped and counted, never the ride.** The entry
    above had the store refuse to write, and to read, a ride holding such a record. P9's record is
    an audit trail beside a ride; the store now keeps each record that reads, counts the rest in
    `RideFacts.replansDropped`, and saves and reads the ride either way.
  - **#1245's wording is the one set of words.** The switch is *Re-plan during the ride* with
    #1245's disclosure under it; this issue's own label, help line, policy section and Data Safety
    sentences are gone. Two things were added to #1245's text in place, because they are true and
    it did not say them: a long workout's most recent summaries, and that the switch is offered
    only with the rider's own two thresholds set. (#1244)

- **2026-10-13** — **After #1244's third review, which found two privacy sentences false of the
  code, more of the entries above changed before they merged.** Recorded as changes; each is the
  implementer's choice and the owner's to change, and every string is the owner's to approve.
  - **Re-plans can be switched off while the workout runs** (D-7: *"A per-ride switch turns
    re-plans off"*). The first entry above said the switch *"cannot be turned off during the
    workout"*, while the policy said *"switch it off and nothing more is sent"*. Now a control
    beside *End workout*, *Switch re-plans off*, ends the re-plan session: no request leaves after
    it, a job in flight is cancelled, and **a move waiting for the next block is dropped** (the
    rider has just said no more changes; the record says `not-applied`, `switched-off`). **It does
    not come back on for that workout**: the session is over, as at the workout's end, and a rider
    who wants re-plans switches them on for the next one. It is a button named for what it does
    and not the chooser's switch drawn again, because it cannot be undone. On the Ride screen
    only; a rider in the game ends the workout or leaves the game to reach it.
  - **A reason is said only when the device holds its premise.** D-4 has the validator check that
    a reason is ON the list, and nothing checks that it is TRUE; the device was saying *"because
    your heart rate stayed above the range you chose"* to a rider who had chosen no range. Each
    reason now has a check against what the device itself sent with the request
    (`apps/web/src/workout/replan-reason.ts`): `heart-rate-high` and `heart-rate-low` need a range
    the rider chose for the block just ridden and a mean outside it; `cadence-falling` a fall of
    5 rpm or more between the last two blocks; `goal-duration` a duration goal; `on-plan` a block
    with no eased target and a heart rate not outside a chosen range. `goal-time-in-range` and
    `effort-check-in` are never said, because the device sends neither. Where the premise does not
    hold the move is said alone. ⚠️ **It is never a refusal**: this ADR does not say a reason must
    be true, the move was the validator's to judge, and this decides a clause of a sentence.
    P9's record keeps the reason either way, with `reasonNotShown` when it was not said.
  - **D-10's three minutes are the ride's.** A second workout in one ride waits out the first
    one's last request (the controller keeps the time), so the hour's bound of 20 is the ride's too.
  - **A job out when control or the strap is lost is cancelled** (P6), as one is in a rescue, so
    its answer is not accepted seconds after control returns. And **a ride paused by the rider is
    paused for P6 from the press**, not from the next tick: an answer in that second was accepted,
    shown and then discarded.
  - **A discard is spoken only of a move whose own sentence was offered.** One held back above
    threshold power and never said is taken away in silence.
  - **The switch is off at the start of every ride as well as every workout**: its state is reset
    when a ride starts or ends. While it is on, *"Re-plans on"* is said beside the chooser's
    heading, because the switch itself is under the list of workouts.
  - **The answer is bound as the request is**: `replan-result.json`, read by both suites.
  - ⚠️ **Not built: P9's record on a recovered ride.** The decisions are in memory until the ride
    saves, and a ride recovered after a crash is saved without them, as it is without
    `workoutFinished`. Carrying them in the checkpoint is
    [#1328](https://github.com/openzigs/onyourleft/issues/1328). (#1244)

- **2026-10-13** — **After #1244's fourth review, one line of the entry above is withdrawn:
  `on-plan` is never said.** That entry had *"because the workout is going to plan"* said when the
  block just ridden had no eased target and a heart rate not outside a chosen range. The review
  measured it holding for a block ridden at a third of its target, and for a summary with no
  reading in it. To see that a workout is going to plan a device has to set the rider's power
  against the target, which is the figure of how well a plan is being followed that
  [spike 0022](../spikes/0022-re-plans-during-the-ride-patent-chart.md)'s rule R1 keeps off the
  ride path. A premise the device may not compute is one it cannot see, so `on-plan` joins
  `goal-time-in-range` and `effort-check-in`: the move is said alone, and P9's record carries
  `reasonNotShown`. Four reasons can still be said: `heart-rate-high`, `heart-rate-low`,
  `cadence-falling` and `goal-duration`. (#1244)

- **2026-10-14** — **The switch is above the list, and *"Re-plans on"* stays beside the heading.**
  The owner ruled on #1329 (2026-10-13) that *Re-plan during the ride* sits ABOVE the list of
  workouts, so a rider sees it and what it sends before choosing one. D-7's consequence *"While it is
  on, 'Re-plans on' is said beside the chooser's heading"* still holds, for a new reason: the owner
  ruled on #1332 (2026-10-14) that the badge stays, outside the heading's name, so that it is said
  where the rider looks for a workout; its reason *"because the switch itself is under the list"* no
  longer holds. The disclosure's headline sits under the switch and its other eight sentences under
  the list, in their order, because nine sentences above the list would push *Ride* off a landscape
  tablet's screen; no word of the disclosure changed, and the privacy policy now says the rider is
  shown it *"with"* the switch rather than *"beside"* it. To keep the first *Ride* clear of the
  browser gate's 50 px floor on the tablet in the Android shell, the owner ruled the trainer card
  above the chooser trimmed (#1332): its paragraph gaps are 8 px, its ERG range sentence is at the
  small size, the headline is at the body size and close-set, and the chooser's heading gives up its
  margin to the switch. The first *Ride* then clears the fold by 63 px on the CI runner's fonts and
  85 px on a Mac's, the same with the badge as without it. The badge and the switch are both on the
  heading's row and above the list, so a rider who has scrolled down a long library sees neither.
  (#1329)

- **2026-10-20** — **P9's record survives a recovery.** The 2026-10-12 entry's *"Not built: P9's
  record on a recovered ride"* is built: the recording's checkpoint header carries the decisions
  made so far (`packages/store` §`RecordingSessionRecord.replans`), rewritten on every flush, and a
  ride recovered after a crash, saved, continued or kept in Recently deleted, is saved with them.
  The field is untrusted on read as the ride's own is: each record goes through
  `readReplanRecord`, one that does not read is dropped and counted in `replansDropped`, a field
  that is not a list holds no record, and the latest 200 are kept. Nothing about it can stop a ride
  being recovered. `workoutFinished` and `ghostRaced` are still not carried. (#1328)
- **2026-10-20** — **P9's record is synced with its ride.** D-10's *"kept with the ride on the device
  and synced with it"* is built: a ride's re-plan decisions go to the rider's instance as one sealed
  item of kind `replan-record`, an item of that ride keyed by its id, pushed and pulled by the
  write-up's rules (the record is written once and never edited). A pulled body is read whole by
  `readReplanRecord`, at most 200 entries, before anything is written; one that does not read writes
  nothing and is reported. It is deleted on the instance with its ride, never sent for a ride
  another device deleted there, and never indexed for history or read by an analysis tool. The
  disclosure's sentence *"They are not sent to your instance when you sync"* is replaced, with the
  privacy policy and the Data Safety answer, subject to the owner's approval of the wording. (#1315)
