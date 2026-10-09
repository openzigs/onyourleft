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
analysis"*. So the rule is **general**: [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
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
