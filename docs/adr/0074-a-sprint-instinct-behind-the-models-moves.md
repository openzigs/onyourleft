# ADR 0074: A sprint instinct behind the model's moves — superseding in part ADR 0073 D-3.5

- **Status**: **Accepted**, 2026-11-16, by the owner on
  [#2724](https://github.com/openzigs/onyourleft/pull/2724#issuecomment-6930011367), who answered the
  four options put in plain words with *"I agree with your recommndations"* (sic): option 1
- **Date**: 2026-11-16
- **Deciders**: **the owner**, who chose the backstop. **The author** decided what that left open,
  marked *the author's choice* where it is made
- **Issue**: [#2710](https://github.com/openzigs/onyourleft/issues/2710), built in its pull request
  [#2724](https://github.com/openzigs/onyourleft/pull/2724)
- **Number**: **0074**, the next free number on 2026-11-16 (`docs/agents/conventions.md` §7). No
  open issue or pull request named it. 0072 stays claimed by
  [#2712](https://github.com/openzigs/onyourleft/issues/2712), 0070 by #2684, and 0057 and 0058 by
  #1748 and #1752. The next free number is then 0075
- **Supersedes, in part**, for **a model race only**:
  [ADR 0073](0073-ai-bots-race-with-strategy-freedom-inside-the-bodys-limits.md) **D-3.5** (*"inside
  the launch distance a move other than the kick is ridden too"*). It is a new ADR because it puts a
  rule back that D-3.5 lifted, and [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision
  to a new ADR. ADR 0073 gains one dated `## Amendments` entry pointing here; its body is not edited
- **Leaves standing**: the rest of ADR 0073, its body's limits (D-2) above all, and ADR 0071 D-7's
  fallback

## Context

ADR 0073's "What would make this ADR wrong" asked #2710 to ride a full-distance model race and look
for a sprint. In six full-distance races on the owner's PC, the model named `kick` 62 times in 1 964
moves, and in `hilly-1` five of seven bots never kicked. Under D-3.5 a bot inside its launch rides
whatever the model names there, so a model that keeps saying `sit-in` takes the finish away.

### What the owner ruled

> **Owner ruling, 2026-11-16:** on how a model race should finish, the owner chose option 1 ("I
> agree with your recommndations"). The options were put in plain words: (1) a sprint instinct as a
> backstop, (2) a final-sprint flag in the input, (3) a bigger model, (4) leave it. Under option 1:
> if the model has not named `kick` by the time a bot is inside its usual launch distance (read from
> the misread line, as seeded `decideTactic` reads it), the bot's own sprint instinct launches the
> kick; the model may still kick earlier, from anywhere.

## Decision

### D-1 — The backstop launches the kick

In a model race, when a bot's window opens with a decision in force that names it, and the model's
move for it is not `kick`, and the bot is **inside its launch distance as it reads the line** (the
true distance plus its skill's misread for the window, `archetype.ts`
§`botTacticsMisjudgement`, the reading seeded `decideTactic` launches on), the bot rides **its own
kick**, the one seeded `decideTactic` launches there, at the kick's own target and not at any effort
the model gave the other move. A bot the decision does not name, or with no decision in force, rides
its seeded tactics, which kick there already (ADR 0073 D-4).

### D-2 — Once launched, it holds to the line

A bot in its kick, within its launch distance plus the largest misread
(`BOT_TACTICS_MISJUDGE_LINE_METRES`) of the **true** line, keeps riding its kick whatever the model
names, so a misread redrawn a window later cannot end it either. **A later model move does not end
a backstop kick.** *The author's choice*: so every race gets a finish. The hold is on the kick, not
on who launched it, so a kick the model named that is still going when the bot reaches that band
holds too.

### D-3 — What the model keeps

- The model may name `kick` **anywhere**, earlier included, and it is ridden as ADR 0073 D-3.5 says.
- A kick the model launches further out than D-2's band is still the model's to end.
- Everything else of ADR 0073 D-3 stands outside the launch.

### D-4 — What does not move

The body's limits (ADR 0073 D-2) are unchanged: an exhausted bot keeps its seeded choice before
this rule is read, `spendableWatts` caps the kick, and no model output reaches a trainer
(`lap-race-cannot-reach-trainer.test.ts` is unmodified). Seeded races are untouched.

### D-5 — Determinism

It changes bot output for some logs, so the build raises `LAP_RACE_BOT_CODE_VERSION` to **3**
(ADR 0071 D-4.3), with a new golden entry beside the old ones. The rules sit behind the existing
seam as `ADR_0074_MOVE_STRATEGY` in `packages/domain/src/lap-race/model-race.ts`; ADR 0073's stays
there as `ADR_0073_MOVE_STRATEGY`, used by no race.

## Consequences

- **Every model race has a sprint**: each bot that reaches its launch with a decision in force
  kicks, and the model's own long kicks stay possible.
- **The model can no longer sit a bot up inside its launch, or end a kick near the line.** That is
  the freedom D-3.5 gave, taken back for the finish only.
- **A lapsed decision still falls back to the seeded tactics** (ADR 0071 D-7), which kick inside the
  launch but may let a naive bot's kick drop for a window where its misread puts it back outside.
  D-2's hold applies only while a decision names the bot.
- Reversing D-1 or D-2 needs a superseding ADR.

## What would make this ADR wrong

- **A model race still ends with bots that never kicked** while a decision named them inside their
  launch: the adapter is wrong, not the rule.
- **The finish looks scripted on the tablet**: every bot kicking at its seeded distance makes the
  last 300 m the seeded race's. Then the fix is the prompt or the input (option 2), by a superseding
  ADR.

## Amendments

- **2026-11-18** — **Once [ADR 0081](0081-ai-bots-asked-one-at-a-time-from-a-menu-and-sit-in-is-no-opinion.md) is Accepted, D-1 and D-2 are superseded by it in part: for a
  model `sit-in` only.** Under ADR 0081 a `sit-in` from the model is no opinion and is no longer
  written over the bot's seeded tactics, which launch the kick inside the launch themselves. So the
  backstop and its hold no longer fire on a `sit-in`, and a bot inside its launch is not asked
  about. **Both stand behind every other move the model names**: a bot sent on anything but its
  kick inside its launch, or holding a kick near the line, still rides its own kick. The rules stay
  behind the seam as `ADR_0074_MOVE_STRATEGY`, which `ADR_0081_MOVE_STRATEGY` is built on. Read
  ADR 0081 for the rule. This entry only points there; nothing else in this ADR changes. (#2836)

- **2026-11-19** — **[ADR 0081](0081-ai-bots-asked-one-at-a-time-from-a-menu-and-sit-in-is-no-opinion.md) is Accepted**, on the owner's answers
  to its D-8 (its D-9), so the entry above is in force. This entry only records that; nothing else in
  this ADR changes. (#2836)
