# ADR 0072: A model directs the bot pacer during a ride — superseding #92 criterion 6, ADR 0066 D-1.1 and ADR 0071 D-2 for the pacer

- **Status**: **Accepted**, 2026-11-16, by the owner on #2723, with the answers recorded in D-11.
  Proposed the same day. R-8 (the setup wording and the *"Your pacer"* label) is approved with the
  pull request's screenshots, and the build does not merge before that. **The owner's ruling of
  2026-11-16 on the patent risk was never open**: Context quotes it and nothing here re-argues it
- **Date**: 2026-11-16
- **Deciders**: **the owner**, whose rulings of 2026-11-14 on #2616 and 2026-11-16 on #2712 are
  quoted in Context. **The author** decided what those leave open, and each such point is marked
  *the author's choice* where it is made. D-10 lists the questions the author asks the owner to
  confirm or overrule
- **Issue**: [#2712](https://github.com/openzigs/onyourleft/issues/2712), under the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It applies
  [ADR 0071](0071-model-chosen-lap-race-bot-tactics-during-a-ride.md)'s rules for a model during a
  ride to the pacer, and uses its instance route pattern
  ([#2709](https://github.com/openzigs/onyourleft/issues/2709), merged in #2719)
- **Number**: **0072**. On 2026-11-16 `main` (`255e10b2`) holds no `docs/adr/` file numbered 0072,
  and `docs/agents/conventions.md` §7 and `docs/agents/adr-numbering.md` give 0072 as the next free
  number. #2712's lane note claims it. **0073 is claimed** by
  [#2720](https://github.com/openzigs/onyourleft/issues/2720), 0070 by #2684 (pull request #2694),
  and 0057 and 0058 by #1748 and #1752. The next free number is then **0074**
- **Supersedes, in part**, for **a solo ride the rider has chosen to ride with an AI pacer** only
  (D-1):
  - [#92](https://github.com/openzigs/onyourleft/issues/92)'s **sixth acceptance criterion**
    (*"A test asserts the bot completes the route without the rider present, i.e. it is not driven
    by rider state"*): an AI pacer's plan and intent are chosen by a model that reads the rider. The
    criterion stands as written for every other ride, and its test (`pacer.test.ts`) is unchanged;
  - [ADR 0066](0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md)
    **D-1.1**'s *"The pacer's plan stays its own"* and *"the bot's odometer is bit-identical whether
    the rider is ahead of it, behind it or absent"*: an AI pacer's odometer depends on the decisions
    a model made after reading the rider. Its other half, **the pacer never takes a draft**, stands;
  - **the '637 flag**: epic [#2582](https://github.com/openzigs/onyourleft/issues/2582)'s *"Not in
    scope"* line for a rider-aware pacer that waits, sits up or chases, which reads toward claim
    element 637-d of the "virtual fitness partner" family (US 12,499,637 B2 / US 12,118,684 B2;
    [spike 0032](../spikes/0032-energy-budget-pacing-of-lap-race-bots-patent-read.md) §4.4). It was
    an epic's scope line, not an ADR's decision; this ADR records that the owner set it aside for
    the AI pacer;
  - [ADR 0071](0071-model-chosen-lap-race-bot-tactics-during-a-ride.md) **D-2**'s *"Never for the
    pacer"*, which says only a superseding ADR can let the pacer in, and **D-1.1**'s *"There is one
    place consent is asked"*: the same consent is asked at the AI pacer's choice too (D-1.3);
  - [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) **D-7**'s
    *"nothing runs during a ride"*, for one more use beside the re-plan and lap-race bot tactics.

  It is a new ADR and not amendments because each of these reverses a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0066, ADR 0071
  and ADR 0046 each gain one dated `## Amendments` entry pointing here; no ADR's body is edited
- **Leaves standing, by name**: ADR 0066 D-1.2 to D-1.6 and D-2 to D-8, the pacer above all never
  taking a draft (D-1.1's first sentence) and the trainer never feeling one (D-7); ADR 0071 D-3 to
  D-9 for the bots, and D-5 and D-6 as this ADR applies them to the pacer; ADR 0046 D-9 as ADR 0071
  D-5 narrows it; [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3's four invariants;
  [ADR 0007](0007-patent-posture.md) D4's line that the pacer replays no recorded ride;
  [ADR 0004](0004-privacy-and-location.md) D
- **Relates to**: [ADR 0048](0048-workouts-that-change-during-the-ride.md) (the re-plan, a model
  call during a ride), [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-7 (sealed routes), [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 (the
  repository names and recommends no model), [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md)
  D-1 (a draft is a multiplier on the rider's `C_D·A` and nothing else)

---

## Context

### What the owner ruled, quoted so it is not argued again

On 2026-11-14, on [#2616](https://github.com/openzigs/onyourleft/issues/2616) (spike 0039), the
owner said: *"I am okay with breaking the patent flag. I think using AI with the pacer could help as
it could also give written feedback and encouragement."* Spike 0039 then reported on the pacer only
(its §7), and said a pacer build needs a superseding ADR for #92 criterion 6, ADR 0066 D-1.1 and the
'637 flag, and that the counsel opinion on US 2026/0249137 (#1234, due about 2027-01-15) should be
read before a pacer build ships.

On 2026-11-16, on #2712:

> **Owner ruling, 2026-11-16:** "We are fine with the patent. Put it in." The owner accepts the
> patent risk of a model-driven pacer and does not want it held for the #1234 counsel opinion.

ADR 0071's Context records the same ruling, and its D-2 sends the pacer here.

### What the issue asks

#2712 asks for this ADR (Proposed, the owner's approval before the build merges) and for the build:
every few seconds the model chooses the pacer's plan and intent, carried out by the existing pacer
physics; it writes short on-screen feedback and encouragement, spoken only as the announcer setting
allows; it uses ADR 0071's instance route pattern. And, tested: no model output reaches the trainer,
and no pacer, game, race, bot or draft event may set trainer resistance or an ERG target; the
schema has no power field and the model gets no tools; the feedback is length-capped and carries no
metric trademark and no medical wording.

### What exists today (read at `main` `255e10b2`, 2026-11-16)

- **The pacer** is #92's: `flat W/kg × 75 kg × pacingFactor(grade)` (`packages/domain/src/pacer/pacing.ts`),
  ridden through the shared `advance` tick by `advanceBot` (`packages/physics/src/pacer.ts`) in
  `GameSimulation.advanceTo` (`apps/web/src/game/simulation.ts`). It reads no rider state. Its
  envelope is +10 % and −20 % of the flat figure. None of epic #2582's sub-issues (the ride-average
  ledger, freewheeling, seeded wander) is built; #2582's *"tick-rate feel"* is therefore today's
  20 Hz fixed step and #92's rule, which the AI pacer rides through unchanged.
- **The instance's tactics routes** (#2709, merged in #2719): the status, the consent naming the
  instance and its local model address, the model slot with its warm-up and hold, one decision per
  request with no tools and reasoning off, and the field-by-field check, all sealed-only and
  owner-scoped (`apps/instance/src/analysis/tactics.ts`).
- **No device side of AI bots yet**: #2710 builds the "AI bots" option and its consent wording.
- **Ride facts kept with a ride**: `RideFacts` (`packages/store/src/records.ts`) holds facts known
  only while riding as optional fields, which `packages/store` does not version (*"an optional field
  is not a migration"*): the re-plan records, the draft spans.

## Decision

### D-1 — What an AI pacer ride is

1. **An opt-in switch beside the pacer**, on the ride's setup, *"Let the AI on your instance steer
   the pacer and cheer you on"*. It is offered only where this device holds a sealed session to an
   instance (`instance/pacer-port.ts` §`offered`, as another rider's ghost is), and asks the
   instance whether it offers this rider a local model before anything else.
2. **A solo ride with a pacer only.** Never a room (there is no pacer in rooms, ruling Q18), never a
   lap race (a race rides without the pacer, #1971), never a simulated ride.
3. **The consent is ADR 0071's, asked at this choice too** (*the author's choice*, D-10 R-3). It names
   a place: the rider's instance and its local model address, as the instance says them (ADR 0071
   D-5.2). It is recorded on the instance by the same route and checked on every pacer decision; a
   change of the address withdraws it (D-5.3); the rider can withdraw it at the same switch (D-5.4).
   One consent covers a model during either kind of ride, because what the rider agrees to is a
   place, and the place is the same. The wording names what is sent and says the trainer is never
   steered by it. The wording is the build's draft, for the owner's screenshots.
4. **A rider with no instance, no consent, or the switch off loses nothing** (ADR 0036 D-3(a)): the
   pacer is #92's, to the bit. `simulation.test.ts` and `pacer.test.ts` hold a ride with no direction
   in force to `advanceBot`'s own answer, exactly.

### D-2 — The model picks the plan and the intent; nothing else

1. **Two closed lists.** The **plan**, how the pacer's power follows the road: `rolling` (#92's own
   rule), `even` (the flat figure whatever the grade) or `climber` (#92's envelope reached at half
   its grades, 4 % and −3 %). The **intent**, what it does now: `hold`, `lift` (+5 %) or `ease`
   (−7 %). The figures are feel parameters, *the author's choice*, not measured.
2. **Held inside #92's envelope.** The pacer's power is `flat W/kg × 75 kg × plan(grade) ×
   intent`, clamped to **80 % to 110 %** of the flat figure: #92's own envelope. A model can choose
   where inside it the pacer rides; it cannot take it outside, and it names no power.
3. **Carried out by the existing pacer physics.** The direction reaches `advanceBot` as a field of
   the bot's course, two words, and the tick is the same `advance` the rider's ride goes through.
   The pacer's mass stays 75 kg, and it still never takes a draft (ADR 0066 D-1.1, first sentence).
4. **The ride average is not held** in this build: a pacer told to ease rides below its advertised
   W/kg for a while. #2583's ledger, when it is built, applies to a directed pacer as it does to any.

### D-3 — The decision: a closed list, no power, no tools

1. **The schema** is `{"plan":<one of three>,"intent":<one of three>,"say":<a line>}`. **It has no
   power field**, and no number at all.
2. **Any key the schema does not name makes the whole answer invalid**, so an answer carrying a
   `watts` key is no answer; so is a plan or an intent outside its list, text that is not JSON, an
   answer over 512 characters, or a line that fails D-4. The instance reads the answer field by
   field before it returns it (`@onyourleft/domain` §`readModelPacerAnswer`), and the device reads
   it again on arrival with the same function.
3. **The model gets no tools.** One call per request, no `tools` field, reasoning off, the answer
   held to the schema by the local server's structured output and read again regardless — ADR 0071
   D-3.3 and D-5.7, on the same instance code.
4. **The input carries no coordinate, no place name, no rider name, no date and no identifier**
   (ADR 0004 D). It is `@onyourleft/domain` §`ModelPacerInput`: the pacer's W/kg, plan, intent and
   the seconds held, the rider's gap to it, the rider's W/kg (the rider's own mass, on the device),
   whether the rider is in its draft, the grade 100 m ahead of it, the metres to the finish (none on
   a loop) and the seconds ridden. Built on the device; read field by field on the instance, which
   refuses any key it does not name and names the field, never the value.

### D-4 — The line of feedback

This is the first model-written text a rider is shown during a ride. ADR 0071 D-3.5 kept the bots'
model text from the rider; the pacer's line is the point of the owner's 2026-11-14 ruling, so it is
shown, and screened.

1. **At most 80 characters, one line**, read at a glance on a handlebar. The empty line says
   nothing and is allowed.
2. **Screened twice**, on the instance and on the device, by one function
   (`@onyourleft/domain` §`pacerSayProblem`): no control character or line break; no markup, code,
   link or address characters; **no digit of any script**, so no figure and no coordinate can be
   quoted (CLAUDE.md §6: the input holds none, and this makes it impossible rather than unlikely);
   **no load-metric trademark** (NP, TSS, IF, CTL, ATL, TSB as words, and their names in any case);
   **no medical wording** (ADR 0048 D-12's nine and a coach's health words: doctor, injury,
   illness, disease, diagnosis, symptom, pain, health); at least one letter. Invisible characters are
   removed before the rules are read. **A line that fails makes the whole answer invalid**: a model
   that wrote a bad line is not trusted for its direction either (*the author's choice*, D-10 R-5).
3. **Shown on the HUD for 8 s of ride**, labelled *"Your pacer"*, and **spoken only with
   announcements on**: it is the announcer's lowest event (`announce.ts` rank 5i), never an
   always-spoken one, and any other event in the window wins.
4. **Never kept.** The line is not stored, logged or synced; the decision log (D-5) holds no text.

### D-5 — Determinism: the decision log, stored with the ride

1. **A directed pacer is a pure function of the route, its plan and the decision log**, under a
   pacer-code version. Unlike ADR 0071's bots it reads no rider state directly: the rider reaches it
   only through the model's answers, which the log holds. So the log alone replays it, with no
   per-tick rider input (`@onyourleft/domain` §`pacerDirectionAt`).
2. **The log records, for each ask**: the seconds ridden it was asked at, the seconds ridden its
   answer arrived at (or none), and what became of it from a closed list (`applied`, `late`,
   `invalid`, `refused`, `failed`), with the plan and intent of an applied one. Seconds ridden are
   the ride's own fixed-step clock (`GameState.ridden`), never a wall clock. A decision applies from
   the first fixed step at or after its arrival, and holds until a newer one or **15 s**.
3. **The pacer-code version** is `MODEL_PACER_CODE_VERSION` in `packages/domain`, stored beside the
   log, and raised by any change that alters the pacer's power for some route, plan and log.
4. **Stored on the device, with the ride, as `RideFacts.pacerModel`**: an optional ride fact, which
   `packages/store` does not version, rather than ADR 0071 D-4.4's new schema version (*the author's
   choice*, D-10 R-6). A log that does not read is dropped whole, never the ride. The instance keeps
   no copy (ADR 0036 D-3(c)). A recording that carries two directed game rides keeps the last one's
   log.
5. **The ride never waits for the model.** One ask is out at a time; frames run at their rate.

### D-6 — What does not move: the trainer

1. **No model output reaches the trainer.** A direction moves the pacer and nothing else; the grade
   the trainer is sent is read at the rider's own odometer (`gradient.ts`), and nothing of the AI
   pacer names the gradient session, a workout or a trainer port. **No pacer, game, race, bot or
   draft event may set trainer resistance or an ERG target** (ADR 0060 D-2.1, ADR 0066 D-7, ADR 0038
   D-1, unchanged).
2. **The pacer gives a draft only as riding harder does.** A directed pacer that rides faster
   shelters a rider who keeps up, through ADR 0066's `k` on the rider's `C_D·A`; the rider then
   arrives at the next grade sooner, as a rider who rode harder would. That is the only way a pacer
   decision reaches the rider.
3. **Tested in model mode.** `apps/web/src/game/model-pacer-wiring.test.tsx` rides the shipped path,
   the solo draft on, with the AI pacer told the hardest direction it can name in every decision:
   in simulation mode every grade write is the road's at the rider's own odometer with the
   protocol's defaults, and every other write is the same bytes in the same order as the same ride
   undirected; under a workout every write is the same bytes at the same frame; the release is the
   same. `draft-cannot-reach-trainer.test.tsx`, `solo-draft-cannot-reach-trainer.test.tsx` and
   `lap-race-cannot-reach-trainer.test.ts` stay green unmodified.

### D-7 — Fallback: #92's pacer on any miss

On any late, invalid, missing or refused answer the pacer rides the decision in force, and with
none in force, #92's own rule. An answer more than **5 s** of riding after its ask is logged late and
never applied; a decision lapses after **15 s**; a refused request (no consent, not offered, busy,
the operator's switch off) ends the ride's asks, and the pacer rides #92's rule for the rest of it.
The figures (an ask every **5 s**, 5 s late, 15 s lapse, a log of at most 2 000 asks) are *the
author's choice*: spike 0039 §7 estimated a pacer decision at 1.5 to 2 s on the owner's PC, and that
estimate should be measured on the tablet ride, not assumed. Nothing waits, retries in a loop or
asks the rider anything mid-ride.

### D-8 — ADR 0071's rules, applied to the pacer

1. **The instance's local model only** (ADR 0071 D-5.1), on the same gates: offered to this rider,
   the operator's switch for other riders (D-5.5), the consent naming the address it is at.
2. **The same model slot and hold** (D-6): `POST /v1/analysis/tactics/start` when a directed ride
   starts, `end` when it ends. Write-ups wait while it runs; one model ride at a time per instance,
   so a directed ride and another rider's AI-bots race exclude each other; a re-plan is not held.
   The warm-up is the tactics warm-up (a fixed race, nothing of the rider's): it loads the model,
   which is what the warm-up is for (*the author's choice*).
3. **The route**, `POST /v1/analysis/pacer/decide`, is sealed-only with no plaintext twin (ADR 0047
   D-7, a row beside ADR 0071's), owner-scoped, rate-limited with the tactics decisions, one call at
   a time per rider. It answers with ADR 0071's codes.
4. **No platform model on a phone or tablet** (ADR 0046 D-13). `no-network.test.ts` still admits
   exactly one module for instance traffic, and the pacer goes through it.
5. **Licence (CLAUDE.md §3).** The schema, the screen, the factors and the log are pure and live in
   `packages/domain` (Apache-2.0); the route and prompt in `apps/instance`, and the director, the
   port and the setup in `apps/web` (AGPL-3.0-or-later). Written fresh; no new dependency.

### D-9 — The patent posture

**This is not a freedom-to-operate opinion** ([ADR 0007](0007-patent-posture.md) D1), and nothing
was searched for it. It is a risk decision the owner made, quoted in Context: a pacer that reads the
rider, through a model, is what claim element 637-d of the '637 family and the workout documents
ADR 0048 D-13 reads (US 2026/0249137 among them) are nearest to, and the owner accepted that risk on
2026-11-16 without waiting for #1234's counsel opinion. What the acceptance leaves standing: the
pacer replays no recorded ride, from this rider or any other (ADR 0007 D4), and there is no ranking
or comparison against another person in it. **When #1234's opinion arrives, it is read against this
ADR**, and the owner decides again if it says to.

### D-10 — Questions for the owner

The owner approves this ADR as a whole (R-1), and confirms or overrules each choice below.

| # | Question | The author's recommendation | Where |
|---|---|---|---|
| **R-1** | Approve ADR 0072, superseding #92 criterion 6, ADR 0066 D-1.1's second half, ADR 0071 D-2 and D-1.1's "one place", and ADR 0046 D-7 for the AI pacer | **Approve** | whole |
| **R-2** | The model picks a plan (`rolling`, `even`, `climber`) and an intent (`hold`, `lift` +5 %, `ease` −7 %), held inside #92's 80 % to 110 % envelope; the ride average is not held until #2583 | **Yes** | D-2 |
| **R-3** | One consent, ADR 0071's, covers a model during an AI-bots race and an AI-pacer ride, asked at either choice | **Yes** | D-1.3 |
| **R-4** | The line: 80 characters, no digits, no markup, no metric trademark, no medical wording; shown 8 s; spoken only with announcements on, as the lowest event | **Yes** | D-4 |
| **R-5** | A line that fails the screen voids the whole answer, so the pacer keeps the decision in force | **Yes** | D-4.2 |
| **R-6** | The log is an optional ride fact with no store schema version (unlike ADR 0071 D-4.4), keeps no text, and a recording keeps its last directed game ride's log | **Yes** | D-5.4 |
| **R-7** | An ask every 5 s of riding, 5 s late, 15 s lapse; a refusal ends the ride's asks | **Yes**, to be measured on the tablet ride | D-7 |
| **R-8** | The draft wording on the setup (D-1.3) and the *"Your pacer"* label, from the pull request's screenshots | **Approve or reword** | D-1, D-4 |

### D-11 — The owner's answers

**Owner ruling, 2026-11-16:** asked whether they approve R-1 to R-7 as recommended, and whether the
pacer should stay within 80 % to 110 % of its set power or be given more freedom, the owner answered
*"Approve. And 80-110 is good"*. So:

- **R-1**: ADR 0072 is approved.
- **R-2**: the model picks a plan (`rolling`, `even`, `climber`) and an intent (`hold`, `lift`,
  `ease`), held inside #92's 80 % to 110 % envelope. The owner kept that envelope rather than widen
  it.
- **R-3**: one consent, ADR 0071's, covers a model in an AI-bots race and in an AI-pacer ride.
- **R-4**: the line is at most 80 characters, with no digits, no markup, no metric trademark and no
  medical wording. It is shown for 8 s, and spoken only with announcements on, as the lowest event.
- **R-5**: a line that fails the screen voids the whole answer.
- **R-6**: the log is an optional ride fact with no store schema version, and keeps no text.
- **R-7**: an ask every 5 s of riding, 5 s late and 15 s lapse; a refusal ends the ride's asks. It
  is to be measured on the tablet ride.
- **R-8**: open until the owner approves the pull request's screenshots.

## Consequences

### What this enables

- **A pacer that rides with the rider**: easing when they drop back, lifting when they come past,
  and a line of encouragement, the thing the owner asked for on 2026-11-14 — with every guarantee
  the pacer had on the trainer and on what is sent.
- **A replayable directed ride**: the route, the W/kg, the log and the version are the whole of
  what the pacer did.

### What this costs, stated plainly

- **The patent risk is accepted, not removed** (D-9), and it is a larger one than ADR 0066's: a
  pacer that reacts to the rider is the claim language's own example.
- **The pacer is no longer a promise of its W/kg** on a directed ride (D-2.4) until #2583.
- **Model-written text reaches a rider during a ride** for the first time. The screen is a word
  list and a set of character rules; a sentence can be unhelpful, or wrong about the ride, and pass.
- **Write-ups wait for the length of a directed ride** on that rider's instance, and a directed
  ride and an AI-bots race cannot run at once on one instance.
- **The pacer decides on a ride a few seconds old.** A lift asked when the rider was ahead can
  arrive after they have dropped back.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2712 (this build) | D-1 to D-8; the owner's screenshots of the setup and the line, and a moving-ride tablet frame check, before merge; no per-case timeout (#1688) |
| #2710 | The consent it words for AI bots is this consent (D-1.3); its wording and this ADR's draft should agree |
| #2583 and the rest of #2582 | A directed pacer is ridden through the same rule; the ledger, when built, applies to it, and any change to the pacer's power raises `MODEL_PACER_CODE_VERSION` |
| #1234 | The counsel opinion is read against D-9 |

### Reversing any of these

Each of D-1 to D-9 is reversed only by a superseding ADR. In particular: a power field or a tool for
the model (D-3), a hosted model directing the pacer, a pacer outside #92's envelope (D-2.2), model
text kept or shown unscreened (D-4), or any pacer decision reaching a trainer write (D-6) needs one.

### Not decided here

- **The prompt's words**: `apps/instance/src/analysis/pacer-prompt.ts`, versioned by
  `PACER_PROMPT_VERSION`, tuned as #2708 tuned the bots'.
- **Whether the log syncs or travels in an export**: it stays on the device until an issue decides
  otherwise.
- **A spoken-only line, or a line in another language**: the line is the model's, in the prompt's
  language.

## What would make this ADR wrong

- **A pacer decision reaches a trainer write**, by any path: then D-6 has failed, and the change is
  wrong rather than the gate.
- **A line reaches the rider that the screen should have stopped** — a number, a metric name, a
  health claim: then D-4.2's rules are short, and the fix is the rule, with the line as its test.
- **The fallback is the ride**: if, on the owner's PC under ordinary load, most asks are late or
  invalid, the rider is riding #92's pacer under another name, and the switch should say so or not
  be offered.
- **Replay diverges under one version**: then something reads a clock or the rider outside the log.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-16** — **The log alone did not replay the pacer, and the stored fact now holds what
  was missing.** D-5.1 says a directed pacer is a pure function of *"the route, its plan and the
  decision log"*, and the Consequences say *"the route, the W/kg, the log and the version"* are the
  whole of what it did. As first built, `RideFacts.pacerModel` held only the version and the
  decisions: no W/kg, no route, and no start of the directed game ride within its recording. And
  the pacer's course depends on two more inputs neither sentence names: the **riding position**,
  whose drag area the pacer is ridden with (`apps/web` §`rideConditionsFor`), and the **wind**.
  Since #2712's review the fact also holds `pacerWPerKg`, `routeId`, `position`, `wind` (absent for
  still air) and `startedAt`, the recording-clock instant its seconds ridden count from. It is still
  an optional ride fact with no store schema version (R-6), and a fact missing any of them, or
  holding one malformed, is dropped whole. Read D-5.1's inputs as the route, the plan, the position,
  the wind and the log; `apps/web/src/game/model-pacer-replay.test.tsx` replays a saved ride from
  them, step for step.
- **2026-11-17** — **The model is shown the rider's own sensors and its own last lines
  ([#2760](https://github.com/openzigs/onyourleft/issues/2760)).** On the first tablet ride the
  owner ruled: *"the messages did change. Did not vary much. Also AI should analyze my ride and
  stats and offer suggestions based on cadence, heart rate, power etc if the stats are
  available"*. So D-3.4's input is wider, and nothing else in D-1 to D-9 moves:
  - **What is added to `ModelPacerInput`**, each field **left out when its sensor is not live**,
    never guessed or zeroed: the rider's W/kg over 3 s (the HUD's average) and over the last
    minute; its zone, and the whole seconds held at or above threshold, **only of a threshold
    power the rider set**; whether it is rising, steady or fading over the last minute; cadence
    in whole rpm; heart rate in whole bpm, its zone **only of a threshold heart rate the rider
    set**, and whether it is rising, steady or falling. A zone is named by its name in
    `analysis/zones.ts`. Every one is a number or a word from a closed list, so D-3.4's *no
    coordinate, no place name, no rider name, no date, no identifier* still holds, and the
    instance still refuses any key it does not name. The cap is 2 048 characters, from 1 024.
  - **The model's own last three lines** (`recentLines`) ride in the input so it does not repeat
    itself. This narrows D-4.4's *"Never kept"* by exactly this: the device holds the last three
    shown lines **in memory for the ride** and sends them back, sealed, to the same instance's
    own model with the next asks. They are still never stored, logged or synced; the decision
    log holds no text; the instance keeps neither the question nor the answer. Each line is read
    again on the instance by `pacerSayProblem` before any model call, so a line the screen would
    stop cannot ride back in.
  - **The prompt is `pacer-2`** (`PACER_PROMPT_VERSION`): coach from what the rider is doing, one
    thing at a time (ease after a long stretch above threshold, a lighter gear for a low cadence on
    a climb, a pacing note for power fading against heart rate, encouragement when steady), vary
    the words, and name heart rate only as effort, never as a health matter. **The temperature is
    0.7** (`PACER_TEMPERATURE`), above 0 as #2760 asks; it was 0.7 already, and on the owner's PC
    0.9 varied the lines little more and kept them less on what the rider was doing.
  - **What does not move.** D-4.2's screen is the same function and the same rules, R-4's *no
    digits* among them, so a line with a digit voids the answer as before, and the prompt still
    asks for no number in any form. Whether coaching may carry cadence and power digits is a
    change to R-4 that #2760 puts to the owner; until the owner rules it stays as it is. The data goes
    only to the rider's own instance's local model (D-8.1); D-6's trainer guarantee and its
    tests are unmodified.
  - **The consent wording (D-1.3) names the new data** — cadence and heart rate, how they trend,
    their zones, and the pacer's last lines — as does `docs/privacy-policy.md`. It is draft
    wording for the owner to approve from screenshots, so R-8 stays open.
  - **A device and an instance on either side of this change.** An instance from before it refuses
    a state carrying any new field (`validation_failed`), which the device reads as a refusal:
    the ride's asks end and the pacer rides #92's rule (D-7). Nothing is lost, and nothing reaches
    the model; deploy the instance first.
- **2026-11-17** — **R-4's *"no digits"* and D-4.2's *"no digit of any script"* are superseded in
  part by [ADR 0077](0077-the-ai-pacers-line-may-name-a-cadence-or-power-target.md)**, on the
  owner's ruling of that day (*"Yes"* to *"allow cadence and power numbers only"*). A line may now
  carry a cadence or power target — a number with `rpm`, `watt(s)`, `W` or `W/kg` straight after
  it, at 30 to 150 rpm, 30 to 2 000 W or 0.5 to 10 W/kg — and every other digit still voids the
  answer. The prompt is `pacer-3`. The preceding entry's *"until the owner rules it stays as it
  is"* is answered by this. Nothing else in D-4 moves, and this ADR's body is unchanged.
- **2026-11-17** — **The intent follows the gap, and the line agrees with the intent
  ([#2777](https://github.com/openzigs/onyourleft/issues/2777)).** On the owner's tablet ride with
  #2762's build: *"It says it will push yet I am ahead and never see it taking over"*; the saved log
  had ease 19, hold 12, lift 8 of 39 applied.
  - **D-3.4's input gains two optional words**, both worked out on the device from the gap it
    already sends: `riderPlace` (`ahead`, `level` or `behind`, by more than 2 s at the rider's own
    speed; absent at a standstill) and `gapTrend` (`rider-gaining`, `steady` or `rider-losing`,
    how the gap moved since the last ask at more than 0.2 m/s; absent on the first ask). Each is a
    word from a closed list, so D-3.4's *no coordinate, no place name, no rider name, no date, no
    identifier* holds, and the instance still refuses a key it does not name. An instance from
    before this change refuses a state with either (`validation_failed`), so, as for #2760,
    **deploy the instance first**.
  - **The prompt is `pacer-4`.** It explains which way the gap runs, asks for an intent by rule
    from `riderPlace` and `gapTrend` (ahead and pulling away: `lift`; ahead otherwise: never
    `ease`; behind and losing ground: `ease`; behind otherwise: never `lift`; level or in the
    draft: `hold`), says that coaching the rider to ease is never a reason for the pacer to ease,
    and drops `pacer-3`'s *"Change intent only every few decisions"*.
  - **D-4.2 gains a rule, as *"What would make this ADR wrong"* anticipates** (*"the fix is the
    rule, with the line as its test"*): a line in which the pacer says it will push, lift, chase or
    come past, beside `ease` or `hold`, or says it is easing, slowing or waiting, beside `lift`,
    makes the whole answer invalid (`say-against-intent`), read on the instance and again on the
    device by `@onyourleft/domain` §`readModelPacerAnswer`, so the decision in force stays (R-5).
    The rule reads the pacer speaking of itself (*I*, *we*, *let's*, or *here I come*, *waiting for
    you*); advice to the rider (*"ease a little"*, *"push through this rise"*) is not a promise of
    the pacer's.
  - **A floor under the intent** — with the rider ahead for 10 s, an `ease` ridden as `hold` — is a
    change to D-2 and D-5.1, not an amendment, so it is
    [ADR 0078](0078-a-floor-under-the-ai-pacers-intent.md), **Proposed** for the owner's answer.
  - **What does not move**: the envelope (D-2.2), the trainer (D-6), the fallback (D-7), the log and
    `MODEL_PACER_CODE_VERSION` (D-5), and the screen's other rules.
- **2026-11-17** — **D-3.4's input gains the course ahead
  ([#2794](https://github.com/openzigs/onyourleft/issues/2794)).** The owner asked that the AI
  take the terrain into account when it changes pace. The pacer state may carry `course`, read
  from the pacer's place on the route (`@onyourleft/domain` §`ModelPacerCourse`,
  `route/course-ahead.ts`): the next climb and the next descent (each 3 % or steeper for 200 m or
  more, looked for 5 km ahead at most and never past the finish: metres to its start, its length,
  its average and steepest grade), the climbing left to the finish or, on a loop, in the lap, and
  on a loop the metres left in the lap. Every field is a number or `null`, so D-3.4's *no
  coordinate, no place name, no rider name, no date, no identifier* still holds, and the reader
  refuses any key it does not name; the field is optional, so a device from before it still asks.
  The prompt is `pacer-5`: where the gap rules (`pacer-4`) leave a choice, ease a little in the
  last 300 m before a climb so the pacer can hold its pace up it, and lift on a descent or where a
  climb ends into the flat. **What does not move**: the envelope (D-2.2), the trainer (D-6), the
  fallback (D-7), the log and `MODEL_PACER_CODE_VERSION` (D-5), the screen (D-4.2) and the gap
  rules, which still come first.
