# ADR 0078: A floor under the AI pacer's intent — superseding in part ADR 0072 D-2 and D-5.1

- **Status**: **Accepted**, 2026-11-17, by the owner on #2793 (D-6). Proposed the same day, as
  [#2777](https://github.com/openzigs/onyourleft/issues/2777) asks (*"ask the owner if it changes a
  decision"*). It does: see *Supersedes, in part*
- **Date**: 2026-11-17
- **Deciders**: **the owner**, who decides R-1. **The author** chose the figures, marked *the
  author's choice* where they are made
- **Issue**: [#2777](https://github.com/openzigs/onyourleft/issues/2777)
- **Number**: **0078**, the next free number on #2762's branch (`docs/architecture.md`), which this
  work is stacked on. 0075 (#2670) and 0076 (#2767) stay claimed in open pull requests, 0070 by #2684,
  and 0057 and 0058 by #1748 and #1752. The next free number is then **0079**
- **Supersedes, in part**: [ADR 0072](0072-a-model-directs-the-bot-pacer-during-a-ride.md) **D-2**'s
  *"The model picks the plan and the intent; nothing else"*, for one case: an `ease` the model picks
  with the rider ahead is ridden as `hold`. And **D-5.1**'s *"it reads no rider state directly: the
  rider reaches it only through the model's answers, which the log holds"*: the device now reads
  where the rider was when it asked, before the answer is logged. It is a new ADR because it changes
  part of an accepted decision, and [ADR 0013](0013-adr-amendments.md) D-3 sends a changed decision
  to a new ADR. ADR 0072 gains one dated `## Amendments` entry pointing here; its body is not edited
- **Leaves standing**: the rest of ADR 0072 — #92's 80 % to 110 % envelope (D-2.2), no power in the
  answer (D-3), the line and its screen (D-4), the log as the whole of what replays the pacer and
  `MODEL_PACER_CODE_VERSION` (D-5), no pacer event reaching a trainer (D-6), and #92's pacer on any
  miss (D-7)

## Context

On the owner's tablet ride of 2026-11-17 with #2762's build the owner reported: *"the pacer isn't
matching exactly. It says it will push yet I am ahead and never see it taking over"*. The ride's
saved decision log had 57 asks, 39 applied: ease 19, hold 12, lift 8.

#2777 asks for three things: an intent that follows the gap, a line that agrees with the intent, and
a measurement. The first two are a change to the prompt and the input, and a screen rule, which ADR
0072's own *"What would make this ADR wrong"* anticipates (*"the fix is the rule, with the line as
its test"*), so they are an amendment to ADR 0072 rather than this ADR. The issue also asks the
author to *consider a deterministic floor: if the rider has been ahead by more than N s for M s and
the model says ease, ride hold*, stated in ADR 0072's terms, with the owner asked whether it changes
a decision. This ADR is that floor.

### What the measurement showed

A scripted 60-ask ride sent the instance's exact request straight to the model on the owner's PC
(`gemma4:12b`, #2777's pull request has the method and the tables). Under the prompt the owner rode
(`pacer-3`), with the rider ahead and working hard, the model eased on 13 and 11 of the 20 asks in
two runs, and lifted on none: it read its own coaching (*"ease a little to recover"*) as what the
pacer should do. Under `pacer-4` it lifted on every valid ask in those phases in both runs, so the
floor fired on none of them. The floor is for the model that does not follow the prompt: a different
model on another instance, a later prompt, or a ride the script did not cover.

## Decision

### D-1 — The floor

1. **With the rider ahead for at least 10 s, an `ease` is ridden as `hold`.** *Ahead* is the
   `riderPlace` the ask was built with: the rider more than **2 s** ahead of the pacer at the
   rider's own speed (`@onyourleft/domain` §`riderPlaceOf`, §`PACER_LEVEL_S`). *For at least 10 s*
   is an unbroken run of asks that were all `ahead`, the first of them at least
   **10 s** (`PACER_AHEAD_FLOOR_S`) before the ask being answered: three asks at #2712's 5 s.
   An ask with the rider `level`, `behind`, or at a standstill (no place) ends the run.
2. **Only `ease` moves, and only to `hold`.** The plan is kept. A `lift` or a `hold` is ridden as
   the model chose it. **The floor never lifts**: it stops the pacer riding away from a rider who is
   already ahead, and it does not make the pacer chase. Chasing stays the model's choice.
3. **The line.** An answer floored to `hold` keeps its line unless the line says the pacer is easing
   (`pacerSaysEasing`), which would describe what the pacer is not doing; that line is not shown, and
   the decision is still applied.
4. **On the device only.** The instance keeps no history between asks (ADR 0072 D-8, the instance
   keeps neither the question nor the answer), so it cannot know how long the rider has been ahead.
   The director in `apps/web/src/game/model-pacer.ts` keeps the run, and
   `@onyourleft/domain` §`flooredDirection` is the rule.
5. **The figures** — 2 s, 10 s — are *the author's choice*, feel parameters, not measured.

### D-2 — Replay and the log

1. **The log records the direction ridden.** The floor is applied before the decision is logged, so
   an applied record holds `hold`, not the model's `ease`. ADR 0072 D-5.1's *pure function of the
   route, its plan and the decision log* still holds, read as ADR 0072's 2026-11-16 amendment reads
   it, and `MODEL_PACER_CODE_VERSION` does not change: for a given route, plan and log the pacer's
   power is what it was.
2. **What the log does not say.** It does not record that the floor fired. An owner reading a saved
   log sees a `hold`; that the model said `ease` is not kept, as its line is not.

### D-3 — What this does not change

The envelope (ADR 0072 D-2.2), the trainer guarantee (D-6), the fallback (D-7), the consent and the
data sent (D-1.3, D-3.4 as amended): the floor reads `riderPlace`, which is already in the state the
rider agreed to send, and sends nothing more.

### D-4 — Reversing it

Removing the floor is a code change in `flooredDirection` and the director, and needs no store change:
a log written with the floor replays with or without it.

### D-5 — The question for the owner

| # | Question | Recommendation |
|---|---|---|
| **R-1** | Approve the floor: with the rider more than 2 s ahead for 10 s, the model's `ease` is ridden as `hold` (never as `lift`), superseding in part ADR 0072 D-2 and D-5.1 | **Approve.** On the measured ride it did not fire under `pacer-4`, and would have fired on 11 of the old prompt's 60 asks; it is a net under the model, not a second director |

### D-6 — The owner's answer

**Owner ruling, 2026-11-17:** asked in plain words whether, with the rider more than 2 s ahead for
10 s, the app should ride the model's `ease` as `hold` (never as `lift`), the owner answered *"I
approve"*. R-1 is approved, and ADR 0078 is accepted.

## Consequences

### What this enables

A pacer that cannot ease away from a rider who is already ahead, whatever the model says, so the
owner's ride (*"I am ahead and never see it taking over"*) cannot repeat with the pacer easing.

### What this costs, stated plainly

- The model no longer has the last word on the intent: D-2's *"nothing else"* is narrower by one case.
- The log hides the floor (D-2.2). A measurement of how often the model eased with the rider ahead
  has to be made as #2777's was, against the model, not read off a saved ride.
- A rider who rides ahead on purpose and wants the pacer to drop back has no way to ask for it; the
  pacer at `hold` still falls back if the rider rides harder than its plan.

## What would make this ADR wrong

- **The floor fires often under the shipped prompt**: then the prompt is not doing its job, and the
  floor is directing the pacer, which ADR 0072 gave to the model.
- **A pacer at `hold` behind a rider who is ahead is the wrong pace for a training partner**, on the
  owner's rides: then the floor should be `lift`, and that is a new decision, not this one.
