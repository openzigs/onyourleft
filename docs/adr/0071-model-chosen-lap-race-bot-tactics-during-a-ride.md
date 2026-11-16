# ADR 0071: Model-chosen lap-race bot tactics during a ride — superseding in part ADR 0067 D-6.2 and ADR 0046 D-7 and D-9

- **Status**: **Accepted**, 2026-11-16, by the owner on #2711, with the D-11 answers recorded there. Proposed the same day. It becomes **Accepted** only when the owner approves it, in
  words, on its pull request; that approval is recorded in D-11 as **Owner ruling, YYYY-MM-DD:**
  with the owner's words. Until then every other sub-issue of the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706) that builds on it (#2709, #2710) stays
  blocked. **The owner's ruling of 2026-11-16 was never open**: Context quotes it and nothing here
  re-argues it. **Nothing is built by this ADR**: #2708 to #2710 build it
- **Date**: 2026-11-16
- **Deciders**: **the owner**, whose ruling of 2026-11-16 on the epic #2706 asked for a version of
  AI-chosen lap-race bot tactics they can race against on the tablet, and whose issue #2707 names
  what this ADR must settle. **The author** decided what that leaves open, and each such point is
  marked *the author's choice* where it is made. D-10 lists the questions the author asks the owner
  to confirm or overrule
- **Issue**: [#2707](https://github.com/openzigs/onyourleft/issues/2707), sub-issue 1 of the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It rests on spike 0039
  ([`docs/spikes/0039-model-chosen-lap-race-bot-tactics.md`](../spikes/0039-model-chosen-lap-race-bot-tactics.md),
  [#2616](https://github.com/openzigs/onyourleft/issues/2616), merged in #2704), whose §8 lists what
  a build would need
- **Number**: **0071**. On 2026-11-16 `main` (`0c910f89`) holds no `docs/adr/` file numbered 0070
  or 0071. `docs/agents/conventions.md` §7, `docs/agents/adr-numbering.md` and
  `docs/architecture.md` give 0070 as the next free number, but **0070 is claimed** by
  [#2684](https://github.com/openzigs/onyourleft/issues/2684), whose open pull request
  [#2694](https://github.com/openzigs/onyourleft/pull/2694) writes ADR 0070 (houses on inferred
  built-up land). #2707 claims 0071 by its title. **0057 and 0058 stay claimed** by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752). The next free number is then 0072
- **Supersedes, in part**, for **a lap race the rider has chosen to ride with AI bots** only (D-1):
  - [ADR 0067](0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md) **D-6.2**
    (*"Pure seeded functions only: no clock"* … *"The same seed replays byte for byte"*): in such a
    race the bots are pure functions of the seed, **the decision log** and **a stored bot-code
    version** (D-4). D-6.2 stands as written for every other race;
  - [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) **D-7's**
    *"nothing runs during a ride"*: a model may run during a ride **for lap-race bot tactics only,
    never for the pacer** (D-2), and write-ups wait while a model race runs (D-6);
  - ADR 0046 **D-9**, which applies to this use **as D-5 narrows it**: the instance's local model
    only, and the rider's own recorded consent naming the endpoint before the first model race,
    which D-9 point 4 did not require of the local model. Consent can be withdrawn.

  It is a new ADR and not amendments because each of these reverses a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0046 and ADR
  0067 each gain one dated `## Amendments` entry pointing here; no ADR's body is edited
- **Leaves standing, by name** (D-8): [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)
  **D-2.1** and **D-2.2** and ADR 0067 **D-3.6**, unchanged and tested in model mode; ADR 0067 D-0,
  D-1, D-3, D-6.1 and D-6.3 to D-6.7; ADR 0046 D-1, D-3, D-6, D-8, D-10 to D-14 and the rest of D-7
  and D-9; [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3's four invariants;
  [ADR 0066](0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md) whole, the
  pacer above all; [ADR 0004](0004-privacy-and-location.md) D
- **Relates to**: [ADR 0048](0048-workouts-that-change-during-the-ride.md) (the other model call
  during a ride: a re-plan), [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-7 (sealed routes), [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 (the
  repository names and recommends no model), [ADR 0007](0007-patent-posture.md) D1 and D4

---

## Context

### What the owner ruled, quoted so it is not argued again

Spike 0039 ([#2616](https://github.com/openzigs/onyourleft/issues/2616), merged in #2704) ran a
language model on the owner's instance PC that picked the lap-race bots' tactics. It was spike code
only, off the shipped path. On 2026-11-16 the owner said yes to a build, recorded on the epic
[#2706](https://github.com/openzigs/onyourleft/issues/2706) as:

> **Owner ruling, 2026-11-16:** after spike 0039 (#2616, #2704), the owner said yes to a version of
> AI-chosen bot tactics they can race against on the tablet.

and on this ADR's issue, #2707, as *"a ridable AI-bots build is wanted (epic #2706). This ADR comes
first."* The issue names what this ADR must decide and record: the three supersessions above; that
ADR 0060 D-2.1, D-2.2 and ADR 0067 D-3.6 are unchanged and stay tested in model mode; that the
decision schema has no power field and the model gets no tools; that the fallback is seeded tactics
on any late, invalid or missing answer; and that the pacer stays out until
[#1234](https://github.com/openzigs/onyourleft/issues/1234)'s counsel opinion. That last point was
overtaken on 2026-11-16, after the issue was written: **Owner ruling, 2026-11-16:** *"We are fine
with the patent. Put it in."* The owner accepted the patent risk of a model-driven pacer and put it
in epic #2706 as its own issue, #2712, under its own ADR (0072). This ADR still covers the bots
only (D-2). The epic puts hosted
models out of scope *"not without the owner's key and a separate ruling"*.

### Why an ADR, and why a new one

Three accepted decisions say this cannot be built. ADR 0067 D-6.2 makes a bot a pure seeded
function with no clock, and a model's answer arrives at a time no seed decides. ADR 0046 D-7 says
nothing runs during a ride, apart from the re-plan its 2026-10-09 entry admits. ADR 0046 D-9 point 4
says the local model needs no consent, and the issue asks for one. Each is a reversal, so
[ADR 0013](0013-adr-amendments.md) D-3 sends it to a new ADR. ADR 0035 D-8, which ADR 0046 D-7
restates on the instance, gains no entry: ADR 0046 D-7 is the rule on the instance, and its
2026-10-09 entry admitted the re-plan the same way, by amending ADR 0046 alone.

### What exists today (read at `main` `0c910f89`, 2026-11-16)

- **The seeded tactics.** `packages/domain/src/lap-race/tactics.ts` §`decideTactic` picks each
  bot's move once per `BOT_TACTICS_WINDOW_MS` (in `archetype.ts`) (1 000 ms) of race time, keyed by the window, from
  the seed. `plan.ts` rides the move, capped by `wbal.ts` §`spendableWatts` at the bot's peak.
- **The spike** (`apps/web/tools/model-tactics-spike/`, imported by nothing the app ships,
  `spike-boundary.test.ts`): the decision schema (`decision.ts`), the adapter (`adapter.ts`), the
  decision log (`decision-log.ts`), the model input (`model-input.ts`) and the Ollama call
  (`ollama.ts`).
- **No race is stored.** The ride recording is, and nothing of a lap race beyond it: no seed, no
  result row. A decision log is new stored data.
- **The one module for instance traffic** is the one `apps/web/src/privacy/no-network.test.ts`
  admits ([#777](https://github.com/openzigs/onyourleft/issues/777)).
- **The trainer gates**: `apps/web/src/game/lap-race/lap-race-cannot-reach-trainer.test.ts` (ADR
  0060 D-2.2's walk) and `lap-race-wiring.test.tsx` (D-2.1's behavioural half and ADR 0067 D-3.6).

### What spike 0039 measured (2026-11-16, not re-run here)

- **Fast enough on its own**: 216 batched calls for seven bots, median 2.51 s, 90th percentile
  3.90 s, highest 4.15 s of server time; none over 5 s; 216 of 216 valid in the schema.
- **Serial serving**: the model server served one request at a time, so a decision asked during a
  write-up waited 23.6 s and 29.8 s, the write-ups' own lengths.
- **A cold load** took about 11 s.
- **Reasoning off is required**: with it on, 3 of 3 calls used every output token and returned no
  valid decision.
- **Safety held** with every bot told to attack in every window: the trainer was sent an ordinary
  ride's writes with the draft off (ADR 0060 D-2.1) and on, at the race's `k` (ADR 0067 D-3.6); no
  bot went over its peak or under 0 W′; every capacity stayed the one the seeded race built.
- **Replay was exact**: six live races replayed from seed and log to the same outcomes.
- **The untuned prompt over-attacks**: 12 to 17 % of bot-time on the flat, about 30 % on hills,
  against 0 to 5 % seeded; following and chasing almost stopped. That is the prompt's, and #2708
  tunes it.

The measurements are of **one model on one PC**. They are a measurement, not a recommendation: the
repository names and recommends no model (ADR 0046's 2026-11-14 entry, point 8).

## Decision

### D-1 — What a model race is

1. **An opt-in race option, "AI bots"**, on the lap race's setup. It is offered whenever the
   rider's instance offers a local model; choosing it asks for the rider's consent (D-5) when none
   is recorded, and the race is today's seeded race unless consent is given. There is one place
   consent is asked: at that choice, on the first model race and again after a withdrawal (D-5.3). The wording is #2710's, approved by the owner
   with its screenshots.
2. **A solo lap race only.** Bots in rooms stay out (ADR 0067 D-5, ADR 0060 D-8).
3. **The model picks each bot's move; nothing else.** The physics, W′ balance, fixed capacity,
   draft, items and the rider's own race are exactly the seeded race's. A model race differs from a
   seeded one only in which of the seven moves `decideTactic`'s caller rides in a window.
4. **A rider with no instance, or no consent, loses nothing** (ADR 0036 D-3(a)): the seeded race is
   unchanged, to the bit, as the spike's `adapter.test.ts` holds for an empty log.

### D-2 — Lap-race bots only; the pacer stays out

- **A model may run during a ride for lap-race bot tactics, and for nothing new besides.** ADR 0046
  D-7's *"nothing runs during a ride"* is superseded for this use, beside the re-plan its
  2026-10-09 entry admitted, and stands for every other job type.
- **Never for the pacer**, the rider's own ghost, a cross-rider ghost, a room, or any announcement
  or HUD text. ADR 0066 is unchanged by this ADR. The model-driven pacer is decided separately by
  ADR 0072 ([#2712](https://github.com/openzigs/onyourleft/issues/2712)), which supersedes ADR
  0066's patent-resting decisions. The owner accepted that patent risk on 2026-11-16 (*"We are fine
  with the patent. Put it in."*), so the pacer no longer waits for the counsel opinion on US
  2026/0249137 ([#1234](https://github.com/openzigs/onyourleft/issues/1234)). Nothing in this ADR
  admits the pacer: until ADR 0072 is accepted, D-2 keeps it out.

### D-3 — The decision: a closed list, no power, no tools

1. **The schema** is spike 0039 §3's: `{"bots":[{"bot":<seat>,"move":<one of the seven>,"target"?:"rider"|<seat>}]}`.
   **It has no power field**, nor any field that is a number other than a seat.
2. **Any key the schema does not name makes the whole answer invalid**, so an answer carrying a
   `watts` key is treated as no answer. So is a move outside the seven, a seat outside the field,
   a seat named twice, text that is not JSON, or an answer longer than a fixed cap (the spike's
   8 192 characters; #2709 states its figure). The instance checks the answer field by field
   before it returns it, and the device checks it again on arrival.
3. **The model gets no tools.** The request carries no `tools` field, and no instance module the
   tactics call reaches defines one. A tactics call is one model call per request: no agent loop,
   no step budget to spend.
4. **The input carries no coordinate, no place name, no rider name, no date and no identifier**
   (ADR 0004 D, ADR 0067 D-6.7). It is spike 0039's `model-input.ts` shape: seats, styles, ranks,
   gaps, W′ shares, drafting, current moves, laps and metres to the line, launch distance, grade
   ahead, the rider's gap, rank and W/kg. It is built on the device and checked there
   (ADR 0046 D-6's rule, applied to this input).
5. **No model-written text reaches the rider.** The answer is a closed-list move per seat; any text
   the model writes is not kept, shown, spoken or logged. A bot's move is worded by the app, exactly
   as a seeded move is, so ADR 0046 D-11's screen has nothing to screen.
6. **Every move is ridden through the seeded race's own rules.** The bot keeps its seeded choice
   for a window when no decision is in force or it does not name the bot; when the bot is inside
   its launch distance (the sprint launch stays local, read from the same misread distance seeded
   `decideTactic` uses, #2705); when the bot is exhausted, or an `attack` or `chase` would take it
   under the W′ floor; when the move is not open to it yet (a `kick` outside the launch distance, a
   `flyer` before the last two laps or under its W′ share, an `attack` already held its longest);
   and when a `follow` or `chase` names a racer who is not the one directly ahead. The target power
   is the seeded rider's, capped by `spendableWatts` at the bot's peak (ADR 0067 D-1).

### D-4 — Determinism: the seed, the decision log and the bot-code version

This supersedes ADR 0067 **D-6.2** for a model race only.

1. **A model race's bots are pure functions of the seed, the decision log, the bot-code version
   and the rider's per-tick input.** Bots read the rider (ADR 0067 D-0: gaps, rank and the rider's
   watts per kilogram), so a replay needs the rider's power and position at every race tick; the
   1 Hz ride recording does not hold them (spike 0039's replay holds only because it rides a
   constant wattage). Still no wall clock and no `Math.random`; draws still go through
   `packages/domain/src/lap-race/random.ts` with their named salts. The same seed, log and version
   replay byte for byte. A seeded race is a model race with an empty log, and replays exactly as
   D-6.2 says today.
2. **The log records, for each call**: the race time it was asked at, **the race time its answer
   arrived at**, and the answer as checked (or the closed reason it was not applied: late, invalid,
   refused, failed). Race time is the race's own clock from Go, never a wall clock. A decision
   applies from the first tactics window that starts **after** it arrived, and holds until the next
   replaces it or for a fixed lapse at most.
3. **The bot-code version** is a named, exported constant in `packages/domain`'s lap-race module,
   stored beside the seed and the log. It is raised by any change that alters any bot's output for
   some seed and log. *The author's choice*, for #2710 to build: a test replays committed seeds and
   logs and holds their outcomes, with the golden outcomes **keyed by version and append-only**, so
   a change that alters bot output without raising the version goes red and cannot be cleared by
   editing the golden outcome in place. A stored log recorded under another version is **not**
   replayed: no race result is stored (Context), so a report of that race is read from the ride
   recording, not reproduced.
4. **What is stored, and where.** The seed, the log, the version and **the rider's per-tick input
   (D-4.1)** are stored **on the device, with the ride**, at a new store schema version with a
   tested `down`. The log keeps the answers and times only, **not the model input sent** (*the
   author's choice*, D-10 R-7): that input is derived from the race, which holds only because the
   rider's per-tick input is stored beside the seed and log. The instance keeps no copy (D-7).
5. **The race never waits for the model.** Ticks run at the race's rate whatever the model does;
   a call in flight changes nothing until its answer arrives and is logged.

### D-5 — Model source and consent (ADR 0046 D-9, as it applies here)

1. **The instance's local model only** (ADR 0046 D-9 source 1, the address rule of ADR 0040 D-6 on
   save and on every request, as the 2026-11-14 entry has it). **No hosted model plays the bots**,
   on any key. The route refuses a request when the instance offers no local model, before a model
   is called.
2. **The rider consents before their first model race, and the consent names the endpoint.** This
   supersedes D-9 point 4 (*"the Ollama source needs no hosted consent"*) for this use. *The
   author's reading*, for D-10 R-3: the endpoint named is the rider's instance and the local model
   address it is configured with, so the rider agrees to a place. The consent is recorded on the
   instance and checked on every tactics request; the app offers the option from what the instance
   last answered (point 3 of ADR 0046's second 2026-10-12 entry, #1251, the hosted source).
3. **Changing the local model's address withdraws every rider's consent to model races**, as a
   change of endpoint withdraws a hosted consent (Q10). The next race asks again.
4. **The rider can withdraw it** in the app at any time. Withdrawal is recorded on the instance and
   takes effect at the next tactics request: it is refused, and the race rides the seeded tactics
   from there (D-7). The rider loses nothing else.
5. **The operator's switch for other riders applies** (ADR 0046's 2026-11-14 entry, point 6): while
   it is off, a model race for any athlete but the operator is refused before a model is called,
   and that rider's race is seeded. *The author's choice*, D-10 R-4.
6. **The route is sealed-only** (ADR 0047 D-7), with no plaintext twin, and **owner-scoped**: the
   athlete is the one of the device-key session, never a field of the request.
7. **Reasoning off.** The route asks the local server for no reasoning, in that server's own
   spelling where it has one (Ollama's `think: false`, which the spike found required). This is a
   tactics-route rule only; the 2026-10-11 entry's rule for analysis jobs is unchanged. A model
   whose answer is late because it reasons anyway simply falls back (D-7).

### D-6 — Write-ups wait while a model race runs

The spike measured that the model server serves one request at a time, and that a decision asked
during a write-up waited the write-up's length (§4). Parallel serving was not measured and is not
assumed. So:

1. **While a model race runs, post-ride analysis jobs wait.** A job that would start is held, not
   failed, and starts when the race ends. **The wait does not count against ADR 0046 D-7's
   ten-minute run budget**, which starts when the job leaves the hold (*the author's choice*). A
   test proves a held write-up still completes (#2709).
2. **A write-up already running when a race starts is not cancelled.** The race starts on time;
   its decisions queue behind the write-up at the model server and fall back to seeded tactics
   until it ends.
3. **One model race at a time per instance.** A second rider's race asking while one runs is
   answered "busy", and that race is seeded; the app says AI bots are not available right now
   (*the author's choice*, D-10 R-5).
4. **The hold ends** when the app says the race has ended, or when no tactics request has arrived
   for a fixed lapse, whichever is first, so a closed app cannot hold write-ups for ever. A **fixed ceiling on the whole hold** also ends it,
   so a client that keeps sending requests cannot hold every rider's write-ups and other riders'
   model races indefinitely. #2709 states the lapse and the ceiling.
5. **Warm-up.** A call at race start loads the model, so the first decision is not about 11 s late
   (#2709). It is a model call of the same shape, with nothing of the rider's in it.
6. **A re-plan is not held** (ADR 0048). It runs during a ride and has its own budget and fallback
   (ADR 0048 D-9), so holding it for a race would only turn it into a fallback. It queues at the
   model server like any request, and the bot decisions it delays fall back (*the author's
   choice*, D-10 R-6).

### D-7 — Fallback: seeded tactics on any miss

**On any late, invalid, missing or refused answer, the bot rides its seeded choice for that
window.** Concretely: an answer that arrives more than a fixed late limit after it was asked (the
spike's 5 s) is logged late and never applied; a decision lapses after a fixed hold (the spike's
5 s); an invalid answer, a refused request (no consent, the switch off, busy, no local model), a
failed call and an instance that cannot be reached all apply nothing. A race that loses its
instance mid-race finishes on seeded tactics. Nothing waits, retries in a loop, or asks the rider
anything mid-race. The figures (a call every 4 s of race time, 5 s late, 5 s lapse) are the
spike's draft; #2709 and #2710 state theirs, with a measurement where they change them.

### D-8 — What does not move

1. **The trainer.** [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)
   **D-2.1** (no game event changes what the trainer is sent, or when, but for ADR 0067 D-3.3's
   narrowing) and **D-2.2** (the import walk), and ADR 0067 **D-3.6** (an ordinary ride's writes at
   the race's `k`), **unchanged**. `lap-race-cannot-reach-trainer.test.ts` stays green **unmodified**.
   Every non-test module of the model race lives under the mode's own directories in `apps/web` and
   `packages/domain`, so D-2.2's walk reaches it (D-2.2's own definition of *"the mode's code"*).
   The instance has no Bluetooth path at all (ADR 0046 D-7).
2. **Tested in model mode.** `lap-race-wiring.test.tsx` gains spike 0039's two model-mode cases in
   the shipped path, every bot told to attack in every window: the trainer is sent an ordinary
   ride's writes with the draft off (D-2.1) and on at the race's `k` (D-3.6) (#2710).
3. **Capacity is fixed** (ADR 0067 D-1). No answer changes a bot's CP, W′ or peak, and no answer
   names a power.
4. **ADR 0067's other D-6 rules**: one decision per window, never per tick (D-6.3); O(bots) per
   tick with nothing allocated per tick (D-6.4), so the call, its parsing and its log entry happen
   off the tick; a bot is never a recorded ride (D-6.5); no coordinate or place name in public
   text, the HUD or speech (D-6.7).
5. **ADR 0036 D-3**: (a) D-1.4; (b) the device copy of the log is never deleted on anything the
   instance says; (c) the instance keeps nothing of a race but the hold's state while it runs, and
   its log lines carry no race state, so it is never the only place a race is; (d) the input is
   built on the device under D-3.4 and goes only to the local model on the rider's own instance.
   `no-network.test.ts` still admits exactly one module, and tactics go through it.
6. **No platform model on a phone or tablet** (ADR 0046 D-13). The model runs on the instance.
7. **Licence (CLAUDE.md §3).** The schema, adapter, log and replay are pure and belong in
   `packages/domain` (Apache-2.0). The spike's copies under `apps/web/tools/model-tactics-spike` are
   AGPL-3.0-or-later and are **not moved**: #2710 writes these modules fresh, as moving them would be
   a relicence (ADR 0046 D-4 did that only on the copyright holder's consent); the route in `apps/instance` and the wiring and setup in
   `apps/web` (AGPL-3.0-or-later). No new dependency is expected; one would go through the licence
   gates.

### D-9 — The patent posture

**This is not a freedom-to-operate opinion** ([ADR 0007](0007-patent-posture.md) D1), and nothing
was searched for it. The owner set the patent check aside **for racing strategy** on 2026-11-10
(ADR 0067 D-0). *The author's reading*, for D-10 R-8: a bot's strategy chosen by a model is still
racing strategy, so D-0 reaches it; the drafting risk is ADR 0067 D-3.8's, unchanged. The documents
ADR 0048 D-13 reads (US 2026/0249137 among them) concern workouts changed for the rider, which a
bot's move is not, and the pacer, which is nearest to them, stays out of this ADR (D-2); the owner
accepted the pacer's patent risk on 2026-11-16, and ADR 0072 decides it.

### D-10 — Questions for the owner

The owner approves this ADR as a whole (R-1), and confirms or overrules each choice below.

| # | Question | The author's recommendation | Where |
|---|---|---|---|
| **R-1** | Approve ADR 0071 | **Approve** | whole |
| **R-2** | Write-up policy: write-ups wait while a model race runs, the wait not counted against their budget; a running one is not cancelled | **Yes**, rather than parallel serving, which was not measured | D-6.1, D-6.2 |
| **R-3** | The consent names the rider's instance and its local model address; a change of that address withdraws it; withdrawal takes effect at the next request | **Yes** | D-5.2 to D-5.4 |
| **R-4** | The operator's switch for other riders gates model races, as it gates the local model's write-ups | **Yes** | D-5.5 |
| **R-5** | One model race at a time per instance; a second gets seeded bots and a sentence | **Yes** | D-6.3 |
| **R-6** | A re-plan is not held by a model race | **Yes** | D-6.6 |
| **R-7** | The stored log keeps answers and times, not the model input sent; the model input is rederived from the seed, log and the stored rider per-tick input | **Yes** | D-4.4 |
| **R-8** | ADR 0067 D-0's setting aside of the patent check reaches strategy a model chooses | **Yes**, as a risk decision and not an opinion | D-9 |

### D-11 — The owner's answers

**Owner ruling, 2026-11-16:** asked *"Do you approve ADR 0071 with all eight as recommended?"*,
with each of R-1 to R-8 put in plain words, the owner answered *"Yes"*. So:

- **R-1:** ADR 0071 is approved.
- **R-2:** write-ups wait while a model race runs. The wait is not counted against their budget, and
  a write-up already running is not cancelled.
- **R-3:** the consent names the rider's instance and its local model address. A change of address
  withdraws it, and a withdrawal takes effect at the next request.
- **R-4:** the operator's switch for other riders gates model races.
- **R-5:** one model race at a time per instance. A second race gets seeded bots and a sentence
  saying why.
- **R-6:** a re-plan is not held by a model race.
- **R-7:** the stored log keeps the answers and their arrival times, with the rider's per-tick
  input, and not the model input sent.
- **R-8:** ADR 0067 D-0's setting aside of the patent check reaches strategy a model chooses, as a
  risk decision.

## Consequences

### What this enables

- **A race the owner can ride against bots a model steers** (#2710, ridden in #2706's sub-issue 5),
  with every guarantee the seeded race has on the trainer, capacity and determinism.
- **A reproducible model race**: seed, log, version and the rider's per-tick input are the whole race, so a report of a strange
  race can be replayed exactly under the version it was ridden with.

### What this costs, stated plainly

- **A model race needs an instance with a local model and a GPU fast enough**; a rider without one
  gets the seeded race. That is a feature they never had, not one they lose.
- **Write-ups wait for the length of a race** on an instance running one, for every rider on it.
- **The bots decide on a race 3 to 5 s old** (spike 0039 §4). A move that would have been right
  then can be wrong when it is ridden.
- **Bot-code changes now have a cost**: any change to bot output raises the version, and older logs
  stop replaying. Their recorded results stand.
- **A new stored data class on the device** (the log), with a schema version and a `down`.
- **Consent is one more thing to ask** of a rider, even for a model on their own instance.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2708 | Spike path only; tune the prompt and input within D-3 (no power field, no tools, no coordinate or name) |
| #2709 | The route: sealed-only, owner-scoped, local model only, consent and the switch checked before a model is called (D-5); field-by-field check and length cap (D-3.2); reasoning off (D-5.7); warm-up, the hold and its lapse, one race at a time, re-plans not held, and a test that a held write-up completes (D-6) |
| #2710 | The option and consent (D-1, D-5); fallback on every miss (D-7); the log, the version and its replay test, stored on the device at a new schema version (D-4); #2705's launch-band fix (D-3.6); the model-mode trainer cases (D-8.2); `lap-race-cannot-reach-trainer.test.ts` unmodified |

### Reversing any of these

Each of D-1 to D-9 is reversed only by a superseding ADR. In particular: a power field or a tool
for the model (D-3), a hosted model playing the bots (D-5.1), a model anywhere near the pacer
(D-2), or any model output reaching a trainer write (D-8.1) needs one.

### Not decided here

- **The prompt, the call cadence and the late and lapse figures**: #2708, #2709 and #2710 state
  them.
- **The consent's and the option's wording**: #2710's, approved by the owner.
- **Whether the log syncs to the instance or travels in an export**: it stays on the device until
  an issue decides otherwise.
- **Parallel serving** on the model server: unmeasured; D-6 stands until a measurement says it can
  change.

## What would make this ADR wrong

- **A model answer reaches a trainer write**, by any path: then D-8.1 has failed, and the change is
  wrong rather than the gate.
- **A held write-up never completes**, or the hold outlives the race: then D-6's hold is broken, and
  the lapse is the fix to measure.
- **Replay diverges under one version**: then something reads a clock or a draw outside the seed and
  log and the rider's stored input, and D-4.1 has failed.
- **The fallback is the race**: if, on the owner's PC under ordinary load, most windows fall back,
  the rider is racing seeded bots under another name, and the option should say so or not be
  offered.
