# ADR 0073: AI bots race with strategy freedom inside the body's limits — superseding in part ADR 0071 D-3.6

- **Status**: **Proposed**, 2026-11-16. **The owner approves it before the build that adopts it
  (#2710) merges**; until then ADR 0071 D-3.6 stands as written, and the build rides it. The owner's
  rulings of 2026-11-16 that it rests on were never open: Context quotes them and nothing here
  re-argues them. **Nothing shipped is built by this ADR**: the spike's adapter, input and prompt
  under `apps/web/tools/model-tactics-spike/` carry it out for measurement, and #2710 builds it
- **Date**: 2026-11-16
- **Deciders**: **the owner**, whose rulings of 2026-11-16 asked that the bots race with strategy and
  have more freedom in it, and whose issue #2720 names what is kept and what is lifted. **The
  author** decided what that leaves open, and each such point is marked *the author's choice* where
  it is made. D-9 lists the questions the author asks the owner to confirm or overrule
- **Issue**: [#2720](https://github.com/openzigs/onyourleft/issues/2720), part of the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It rests on spike 0039
  ([`docs/spikes/0039-model-chosen-lap-race-bot-tactics.md`](../spikes/0039-model-chosen-lap-race-bot-tactics.md)),
  whose §11 is this ADR's measurement
- **Number**: **0073**. On 2026-11-16 `main` holds no `docs/adr/` file numbered 0072 or 0073, and
  `docs/agents/conventions.md` §7 gave 0072 as the next free number. **0072 is claimed** by
  [#2712](https://github.com/openzigs/onyourleft/issues/2712) (the AI pacer), whose title names it
  and which ADR 0071 D-2 already cites. #2720 claims 0073 by its title. **0057 and 0058 stay
  claimed** by [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752), and 0070 by
  [#2684](https://github.com/openzigs/onyourleft/issues/2684). The next free number is then 0074
- **Supersedes, in part**, for **a model race only** (ADR 0071 D-1):
  [ADR 0071](0071-model-chosen-lap-race-bot-tactics-during-a-ride.md) **D-3.6** (*"Every move is
  ridden through the seeded race's own rules"*): its strategy rules are lifted (D-3) and its body's
  limits kept (D-2). It is a new ADR and not an amendment because it reverses a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0071 gains one
  dated `## Amendments` entry pointing here; its body is not edited
- **Leaves standing, by name**: ADR 0071 D-1, D-2, D-3.1 to D-3.5, D-4 to D-9 and D-11, the
  fallback (D-7) above all; [ADR 0060](0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)
  **D-2.1** and **D-2.2** and [ADR 0067](0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md)
  **D-3.6**, unchanged and tested in model mode; ADR 0067 D-1 (capacity fixed at the start) and the
  seeded tactics of every race that is not a model race
- **Relates to**: [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3,
  [ADR 0004](0004-privacy-and-location.md) D, [ADR 0007](0007-patent-posture.md) D1

---

## Context

### What the owner ruled, quoted so it is not argued again

On 2026-11-16 the owner asked, of the AI bots, that **"they have to race with strategy. Cannot
push endlessly."**, and later the same day: **Owner ruling, 2026-11-16:** *"The bo[t]s should have
more flexibility with strategy."* #2720 records the second as the owner's ruling and sets out what
it means: the limits of the body stay, the rules of strategy go. It names both lists, which D-2 and
D-3 take word for word, and asks for this ADR, Proposed, with the owner's approval before the build
merges.

The owner's **second ruling on #2720, 2026-11-16** (later the same day), which widens the issue's
body and says to read it before writing this ADR: *"And not be [con]strained by the game rules."*
It sets **the only fixed limits** as the body (the bot's CP, W′, peak and exhaustion, that is
`spendableWatts`), the bike physics, no model output reaching the trainer and no tools for the
model; **every other seeded tactics rule is the model's choice in a model race**: every refusal in
ADR 0071 D-3.6 except exhaustion, move durations and hold limits, which moves are open when, the
sprint launch distance and the `attackOpen` gate. D-2 and D-3 are that list. It asks two more
things: that **the seeded skill stays** (a naive bot still misjudges the distance, and what it does
with that reading is the model's choice: D-3.5), and that **an effort level be considered**: the
model picking a share of what `spendableWatts` allows (tempo, threshold, all-out) instead of only a
named move. That last one is **decided in D-2.5** and put to the owner as R-6.

### What ADR 0071 D-3.6 says, and why it is now too tight

ADR 0071 D-3.6 rides every model move **through the seeded race's own rules**: a bot keeps its
seeded choice inside its launch distance, when it is exhausted, when an `attack` or `chase` would
take it under the W′ floor, when the move is not open yet (a `kick` outside the launch, a `flyer`
before the last two laps or under its W′ share, an `attack` held its longest), and when a `follow`
or `chase` names anyone but the racer directly ahead. Those were the seeded tactics' own rules,
copied so that a model could ask for nothing a seeded bot could not do.

Under them, and under #2708's prompt, which added a code-computed `attackOpen` gate and one bot at
a time, the tuned model race was **quiet** (spike 0039 §10.6): on the flat the lead changed hands 0
or 1 times in 150 s against 21 or 22 seeded, no flyer was ridden, one bot made every attack, and on the flat a
bot never sat on the rider's wheel (on the hills, once, for 24 bot-ticks: spike 0039 §11.2), because nothing in the input said what the rider was doing.
Half of those limits are not the body's. The W′ floor, the flyer's laps, the attack's longest hold,
the wheel directly ahead and the fixed launch are how the *seeded* bots were taught to race; a
model choosing strategy does not need them taught, and the owner has said it should not be held to
them.

### Why an ADR

D-3.6 is a decision, and lifting half of it reverses that half: ADR 0013 D-3. ADR 0071 D-10 R-1 was
approved whole, D-3.6 with it, so the owner approves this one before the build changes what D-3.6
lets a model do.

## Decision

### D-1 — Scope: a model race only

Everything here is about a lap race the rider chose to ride with AI bots (ADR 0071 D-1). A seeded
race, and every bot a model does not name in a window, is ridden by today's seeded tactics,
unchanged. A rider with no instance or no consent loses nothing (ADR 0036 D-3(a)).

### D-2 — Kept, because they are physical limits

1. **The target power stays the seeded rider's**: the move's own target from `decideTactic`'s view,
   capped by `wbal.ts` §`spendableWatts` **at the bot's peak**, and **at CP once the bot is
   exhausted**. Capacity stays fixed at the start (ADR 0067 D-1).
2. **W′ drains and refills as today**, and **an exhausted bot cannot surge**. *The author's choice*:
   an exhausted bot also **keeps its seeded choice** for the window, whatever the model names, so a
   blown bot rides as the seeded tactics ride a blown bot (it recovers) until its W′ is back over
   the re-entry share. `spendableWatts` would hold it to CP either way; keeping it out of the
   model's hands also stops a model holding a blown bot at CP, where it never refills (D-9 R-2).
3. **The schema has no power field and the model gets no tools** (ADR 0071 D-3.1 to D-3.3,
   unchanged).
4. **No model output reaches the trainer** (ADR 0071 D-8.1; ADR 0060 D-2.1 and D-2.2; ADR 0067
   D-3.6). `lap-race-cannot-reach-trainer.test.ts` stays unmodified, and `lap-race-wiring.test.tsx`'s
   model-mode cases now ride under these rules (D-6).

5. **No effort level, in this ADR: the schema's moves stay the whole of what the model chooses.**
   *The author's choice*, on the owner's ask to consider one (Context). A share of
   `spendableWatts` as a field would be a second power path beside the move's own target, and ADR
   0071 D-3.1 forbids a power field; adding one means superseding D-3.1 in part. **This ADR does
   not, and D-3.1 stands unchanged.** The reasons:
   - **The freedom the owner asked for is already there without it.** The moves already span the
     effort range, from `sit-in` and `recover` at the wheel's pace to `attack`, `flyer` and `kick`
     at the bot's cap, and D-3 lifts every rule that kept the model from naming them when it
     likes, for as long as W′ allows.
   - **It is unmeasured.** Spike 0039 §11 measured the lifted rules and not a share, and a share
     is a second number for a 12-billion-parameter model to get right in each window, in a call
     that already runs slow (D-7).
   - **It would stay safe, and that is why it can wait.** Were it added, the cap would be the
     body's (`spendableWatts` at the bot's peak, or at CP once exhausted, D-2.1 and D-2.2) and the
     trainer unreachable (D-2.4), so it would be a pacing choice and not a power override. It
     needs its own measurement and its own superseding ADR of D-3.1, not a rider on this one.

   The owner may overrule this at R-6.

### D-3 — Lifted, because they are strategy rules

1. **The W′-floor refusal of `attack` and `chase`**: a bot may gamble and blow up. D-2.2 is what
   blowing up costs it.
2. **`flyer` limited to the last two laps and over its W′ share**: a breakaway may go any time.
3. **An `attack` capped at its longest hold** (`BOT_TACTIC_ATTACK_MS`): it may last as long as W′
   allows, for as long as the model keeps naming it.
4. **`follow` and `chase` only of the racer directly ahead**: any racer, the rider included, may be
   marked or chased. The schema's `target` (`"rider"` or a seat) is offered to the model again.
   *The author's choice*, so that no new power path is written: today's physics carries both moves
   to the wheel directly ahead and to no other, so a target elsewhere is reached through the moves a
   bot already has:
   - **directly ahead**, or no target, or a target that is the bot itself or is not racing: the move
     as named, on the wheel ahead;
   - **further up the road**: ridden as a **`chase`**, which rides past the racers between until the
     target is the one directly ahead, when the next window's `follow` takes its wheel (*bridging*);
   - **behind**: ridden as **`sit-in`**, which rides the wheel ahead at that wheel's pace and
     never waits, so the marked racer comes by as the bunch rides, when a `follow` takes its wheel
     (*marking*).
5. **The fixed sprint launch distance**: the model may launch long or late. A `kick` is ridden
   wherever the model names it, and inside the launch distance a move other than the kick is ridden
   too. **The misread distance still governs what a bot thinks is left**: the input's `toLineM` is
   the true distance plus the bot's skill's misjudgement for the window (`archetype.ts`
   §`botTacticsMisjudgement`), the same read seeded `decideTactic` launches on and ADR 0071 D-3.6's
   #2705 fix names. The model times a launch on what the bot believes; `launchM` is shown as where
   its legs would usually go, a guide.

### D-4 — What the seeded tactics still decide

When **no decision is in force** (none yet, a late, invalid or failed answer, or a lapsed one, ADR
0071 D-7), when the decision **does not name the bot**, or when the bot is **exhausted** (D-2.2),
the bot rides `decideTactic` exactly as a seeded bot does, every rule of it: the utility scores and
the archetype's propensities, the 4 s dwell and the commitment bonus, the W′ floor on `attack` and
`chase`, the 20 s attack, the flyer's last two laps and W′ share, the follow of a mover within
50 m, the chase from 30 m to 200 m, the recover under half of W′, and the kick at its launch
distance read on the misread line. **A move the model started is not finished by the model when
its decision lapses**: the seeded tactics take it over from the memory the model left, so an attack
held past 20 s scores nothing and ends at the next window the dwell allows, and a flyer under its
W′ share ends, as either would for a seeded bot.

### D-5 — The prompt and the input: guidance, not rules

1. **Each bot is dealt a racing style from the race's seed**: `breakaway`, `sprinter` (a
   wheel-sitter who waits for the line), `climber`, `rouleur` or `opportunist`. *The author's
   choice*: every style once before any twice, so a field of seven holds all five, in an order the
   seed shuffles; dealt apart from the bot's archetype, which the input still shows as `legs`, so a
   bot may race in a style its legs do not suit (D-9 R-4). In the build the deal is a draw through
   `packages/domain/src/lap-race/random.ts` with a named salt, as ADR 0071 D-4.1 requires of every
   draw.
2. **The rider's state is in the input**: rank, W/kg, who is directly ahead of them, the gaps ahead
   and behind, and whether they draft; each bot still has its own `riderGapM`. So a bot can mark the
   rider.
3. **No code-computed attack gate and no one-at-a-time rule.** The input keeps `quietS` (seconds
   since any bot attacked or rode a flyer) as information; `attackOpen` is removed, and the prompt
   asks for moves by different bots at different times without a rule for how many.
4. **Each bot's W′ share (`wbal`) and whether it is blown (`blown`) are in the input, and the prompt
   says plainly that spending it costs later**: every effort above sitting in spends it, it refills
   only while the bot rides easy, a blown bot rides no harder than steady until it has refilled, and
   a bot that attacks with little left can blow up.
5. **The input stays within ADR 0071 D-3.4**: seats, styles, archetypes, ranks, gaps, W′, moves,
   laps, metres, grade and the rider's numbers, and no coordinate, place name, rider name, date or
   identifier. `model-input.test.ts` still finds none of the circuit's coordinates in it.

### D-6 — Determinism: a log replays under the rules it was recorded under

The bots of a model race stay pure functions of the seed, the log, the bot-code version and the
rider's per-tick input (ADR 0071 D-4). This change alters bot output for some logs, so the build
that adopts it **raises the bot-code version** (ADR 0071 D-4.3). The spike says it in the log
itself: each log written under this ADR carries `"rules": "adr-0073"`, the spike's adapter takes
the rules as an argument (`adapter.ts` §`ModelRules`), and a log that names none, spike 0039's and
#2708's, replays under ADR 0071's, so every committed log still replays to its own live trace.

### D-7 — What was measured

Spike 0039 §11 (#2720) has the numbers. They were measured on the owner's instance PC with
`gemma4:12b` and `think:false`, with Ollama's settings unchanged, over the six fields of #2561's
harness, ridden live under these rules with this prompt, beside the seeded and #2708's columns.
Against #2720's five asks:

- **A W′-exhausted bot is never above CP: held.** That held in every live field and in the
  harness, where bots told to kick from the gun blow, ride no harder than CP and lose places. **A
  bot that over-spends fades: not seen live.** No live bot was exhausted, and the lowest W′ any bot
  read was 0.338. The model did not gamble that far.
- **The lead changes hands: yes.** It changed 4 to 13 times on the flat, against 0 or 1 under
  #2708, and 8 to 27 times on the hills.
- **More than one bot makes moves: yes.** 4 to 6 bots moved in every field.
- **Bots mark the rider: in three fields of six.** In each of those, a bot sat on the rider's
  wheel, and 20 moves aimed a `follow` or `chase` at the rider.
- **Latency and validity:** 186 of 186 calls were valid and none was late, but the median rose to
  3.56 s from 2.71 s (the highest was 4.38 s). Calls over 4 s halved the cadence, so 14.0 % of
  bot-windows fell back, against 4.9 %.

### D-8 — What does not move

ADR 0071 D-7's fallback, D-4's determinism and D-5's consent; ADR 0071 D-8's trainer, capacity and
licence rules; and every seeded race. In particular the build still writes these modules fresh in
`packages/domain` (Apache-2.0) and does not move the spike's AGPL-3.0-or-later copies (ADR 0071
D-8.7).

### D-9 — Questions for the owner

| # | Question | The author's recommendation | Where |
|---|---|---|---|
| **R-1** | Approve ADR 0073: the five strategy rules lifted, the body's limits kept, for model races only | **Approve** | whole |
| **R-2** | An exhausted bot keeps its seeded choice (it recovers) whatever the model names, rather than ride the model's move held to CP | **Yes**: a blown rider does not choose to keep going | D-2.2 |
| **R-3** | A `follow` or `chase` of a racer up the road is ridden as a chase until they are the wheel ahead; of a racer behind, as sitting in until they come by | **Yes**: it needs no new power path | D-3.4 |
| **R-4** | Racing styles dealt every-style-once from the seed, apart from the bot's archetype | **Yes**: it guarantees five kinds of racer in a field of seven | D-5.1 |
| **R-5** | A `kick` is open anywhere, with no gate; the model reads the line as the bot misreads it. Inside the launch distance the model's move is ridden, so a race may end with no sprint if the model never names a `kick` (it named none in 1 296 moves): a seeded kick takes over only when a decision lapses | **Yes**, with #2710 measuring a full-distance race for a sprint (What would make this ADR wrong); the alternative is a seeded kick inside the launch whenever the model names no `kick` there, which puts a rule back | D-3.5 |
| **R-6** | No effort level: the model chooses moves only, and ADR 0071 D-3.1 (no power field) stands untouched. Or, if the owner wants a share of `spendableWatts` as a field, a superseding ADR of D-3.1 in part, measured first | **Decline for now**: the moves already span the range, a share is unmeasured, and it stays safe whenever it is added | D-2.5 |

## Consequences

### What this enables

- **A model race that can look like a race**: breakaways on any lap, long attacks that blow up,
  counters by different bots, bots on the rider's wheel, and sprints launched long or late.
- **The owner's two rulings at once**: bots race with strategy, and cannot push endlessly, because
  the W′ they spend is gone (D-2.2).

### What this costs, stated plainly

- **A model can now make a bot race badly.** A breakaway on the first lap, a kick a lap out or an
  attack held into the ground are all allowed, and the body is the only brake. Whether the races it
  makes are good is the prompt's job, measured in spike 0039 §11 and judged by the owner on the
  tablet.
- **Fewer refusals hide the model's choices.** Under ADR 0071 D-3.6 a bad ask often became a
  seeded window; now most asks are ridden.
- **The longer input is slower.** Spike 0039 §11.3 measured a median of 3.56 s and 14.0 % of
  bot-windows with no decision in force, so #2710 must state a cadence that holds with it (ADR 0071
  D-7).
- **The bot-code version rises** in the build, and logs written under ADR 0071's rules stop
  replaying there (ADR 0071's own consequence, as it said).
- **Marking is approximate**: a bridge is a chase past the racers between, and a mark behind is a
  sit-in, so a bot marking someone behind it rides as the bunch rides, not slower.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2710 | Once this is Accepted: the adapter's D-2 and D-3 rules, D-4's seeded fallbacks, D-5's input and the prompt, and a bot-code version raised for them (D-6); the model-mode trainer cases under these rules; `lap-race-cannot-reach-trainer.test.ts` unmodified; a full-distance measurement that a model race reaches a sprint (What would make this ADR wrong) |
| #2715 | Its race-feel items are folded in here and measured in spike 0039 §11; its tool items stay its own |

### Reversing any of these

Each of D-1 to D-6 is reversed only by a superseding ADR. Putting back a strategy rule (D-3) for a
model race, or taking away a body's limit (D-2), needs one.

### Not decided here

- **The prompt's wording**, the call cadence and the late and lapse figures: the spike's are drafts,
  and #2710 states its own.
- **Whether the seeded tactics themselves should be freer.** This ADR changes model races only.

## What would make this ADR wrong

- **A blown bot rides over CP** under a model's move: then D-2.2 has failed, and the adapter is
  wrong, not the rule.
- **A model answer reaches a trainer write**: ADR 0071 D-8.1 has failed.
- **A full-distance model race ends with no sprint.** The model asked for `kick` 0 times in 1 296
  named moves (spike 0039 §11.2), and inside the launch distance its move is ridden, so the seeded
  kick takes over only where a decision lapses. Spike 0039's harness ends before the last 300 m, so
  it never saw a kick. If #2710's full-distance measurement shows a field reaching the line with no
  kick, D-3.5 has failed in effect, and the fix is the prompt, or the seeded kick put back inside
  the launch by a superseding ADR (R-5).
- **The freedom makes the race worse on the tablet**: if the owner finds the model races less like a
  race than ADR 0071's, the rule to restore is the one that would have prevented it, by a
  superseding ADR.
