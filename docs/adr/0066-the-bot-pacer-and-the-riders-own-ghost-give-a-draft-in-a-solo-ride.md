# ADR 0066: The bot pacer and the rider's own ghost give a draft in a solo ride, and take none — superseding the first sentence of ADR 0038 D-5's "Out" bullet for those two

- **Status**: **Accepted, 2026-11-10**, for what the owner ruled on 2026-11-09 on the epic
  [#2421](https://github.com/openzigs/onyourleft/issues/2421#issuecomment-6755764419): decision 1
  (the pacer and the own ghost give a draft), decision 4 (the patent-risk acceptance extended),
  decision 5's first two parts ("Your best" and segments mark a drafted ride) and decision 6's
  switch (a setting on the device that turns it off). Every ruling is quoted in Context. **R-11 to
  R-13 of D-9 were ruled by the owner on 2026-11-10** on this ADR's pull request
  ([comment](https://github.com/openzigs/onyourleft/pull/2441#issuecomment-6773737487)), and are no
  longer the author's recommendation. **Everything still marked *the author's recommendation* is
  Proposed** until the owner confirms it on this ADR's pull request; D-9 lists each one. **Nothing
  is built by this ADR**: [#2425](https://github.com/openzigs/onyourleft/issues/2425) builds it
- **Date**: 2026-11-10
- **Deciders**: **the owner**, on the four rulings of 2026-11-09 quoted in Context, and on R-11 to
  R-13 of D-9 on 2026-11-10 on this ADR's pull request. **The author**, on everything else, each
  part marked as the author's recommendation where it is decided
- **Issue**: [#2424](https://github.com/openzigs/onyourleft/issues/2424), under the epic
  [#2421](https://github.com/openzigs/onyourleft/issues/2421), a child of
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Number**: **0066**. On 2026-11-10 `main` (`f7f93389`) holds no `docs/adr/` file numbered 0066,
  and `docs/agents/conventions.md` §7, `docs/agents/adr-numbering.md` and `docs/architecture.md` all
  give 0066 as the next free number. No open pull request or open issue names it. **0057 and 0058
  stay claimed** by [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)
- **Supersedes**: [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) **D-5's "Out"
  bullet, its first sentence only, and only for the bot pacer in a solo ride and the rider's own
  ghost**. That sentence reads *"Out: drafting the bot pacer (there is no bot pacer in rooms, one of
  the recommendations the owner accepted on 2026-09-28) or any ghost (a ghost is 'a replay of
  recorded distance against recorded time' and has no drag area)."* **Every other part of ADR 0038
  is unchanged, by name**: D-1, D-2, D-3 (all six parts and the table), D-4, D-5's first two bullets
  and the Out bullet's team-tactics sentence, D-6, D-7, and both amendments. ADR 0038 gains an
  appended amendment pointing here ([ADR 0013](0013-adr-amendments.md)); its body is not edited
- **Rests on**: ADR 0038 D-3 (the model, unchanged), [spike 0005](../spikes/0005-live-racing-patent-read.md)
  §1.4 (the patent search that found nothing, and calls that weak evidence)
- **Relates to**: [ADR 0061](0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md)
  D-1 and D-4, [ADR 0007](0007-patent-posture.md) D1, D4 and D5,
  [ADR 0021](0021-racing-another-riders-ghost.md), [ADR 0039](0039-racing-another-riders-ghost-on-consent.md),
  [ADR 0028](0028-racing-fairness.md) D-1 and D-2, [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-2,
  [ADR 0009](0009-clean-room-posture.md)

> ## ⚠️ The patent half of this is a risk decision, not a finding
>
> No claim chart was drawn for drafting a synthetic rider or a replay of the rider's own ride. Nothing
> was searched for this ADR. This is not a freedom-to-operate opinion ([ADR 0007](0007-patent-posture.md)
> D1). The owner has accepted the risk, as D-4 records.

---

## Context

### What the owner asked, and what the owner ruled

The owner's request of 2026-11-09, which opened the epic #2421: *"make sure drafting physics really
applies when riding with a pacer, the solo ghost or bots, and with other riders in rooms."*

The owner's ruling of 2026-11-09 on #2421, answering the epic's open questions, verbatim for the
parts this ADR rests on:

> 1. **Yes: the bot pacer and the rider's own ghost give a draft in a solo ride.** The owner accepts
>    the patent risk for this, extending ADR 0038 D-7's acceptance. #2424 records it. **The rider
>    must be able to turn the draft off.** Add a setting, held on the device, that turns drafting off
>    for the pacer and the ghost. With it off, the rider is at k = 1, as today. #2425 includes the
>    setting and a test that the off position gives a byte-identical simulation to today's.
> 2. **Yes: "Your best" and segments mark a ride where the rider drafted.**
> 3. **The in-draft indicator is visual, and it is not spoken.** #2426 adds no spoken cue on entering
>    or leaving the draft. The mark keeps a text alternative, the words "In the draft" and an
>    accessible name, so it is readable, and it is not colour alone (SC 1.4.1). The rooms' existing
>    spoken draft cue, given only when announcements are on, is unchanged by this epic.

The owner's item 4 (the shelter mark's shape) is #2426's and is not decided here.

### Why an ADR, and why a new one

Today the pacer and the ghost give no draft **by decision**: ADR 0038 D-5's Out bullet. An ADR's body
is never edited, and reversing a decision needs a superseding ADR (`CLAUDE.md` §7, ADR 0013). So this
is a new ADR that supersedes one sentence, and #2425 may not change the test that asserts that
sentence until this has merged.

### Where drafting is and is not applied today (re-read on `main` at `f7f93389`, 2026-11-10)

#2424 gave this table as read at `85d184ec` on 2026-11-09. Each reference was re-read at writing
time; the ones that had moved are corrected, and say so.

| Who | Gives a draft? | Takes a draft? | Where it is decided |
|---|---|---|---|
| Live riders in a **room** with drafting on | yes | yes | The room computes `k` from the distances it holds: `apps/instance/src/room/core/room.ts` §`draft` (header `:54-65`, the function `:773-782`, ridden at `:653-655` through `ridingConditions(mass, position, k)`), with `packages/physics/src/draft.ts:166` §`fieldDraftFactors`. The client predicts the same `k`: `apps/web/src/game/room-ride.ts:314` calls `simulation.draftWith(room.draftFactor())`, applied at `apps/web/src/game/simulation.ts:813-822` §`#drafted` |
| Live riders in a room with drafting **off** | no | no | The same code with every `k = 1`: `room.ts:775-777` (ADR 0038's amendment of 2026-10-14) |
| The **bot pacer**, solo | **no** | **no** | `simulation.ts:500-505`: *"The bot is never drafted: its conditions are its own"*; the bot is advanced at `simulation.ts:745-749` with no draft. `apps/web/src/game/drafting.test.ts:121-131` asserts *"gives no draft from a bot pacer 1 m ahead: k = 1"* (the `it` is `:122-130`). There is no bot pacer in rooms (owner ruling Q18, 2026-09-28) |
| The rider's **own ghost** | **no** | **no** | ADR 0038 D-5 **Out** (`docs/adr/0038-drafting-in-the-first-multiplayer-release.md:234-235`). The ghost is placed by `packages/domain/src/ghost/replay.ts:181` §`ghostDistanceAt` at `simulation.ts:181` §`ghostClock` |
| **Lap-race bots** | **no** | **no** | ADR 0061 D-4: *"`advanceBot` passes no draft multiplier"*; `packages/physics/src/lap-race-bot.ts:38` restates it |
| The rider, **solo with nobody** | n/a | no (`k = 1`) | `draftWith` (`simulation.ts:582-584`) has one production caller, `room-ride.ts:314` §`roomFrame` |
| **The trainer**, on every ride | — | never feels a draft | `apps/web/src/game/gradient.ts:79-95` §*"What is deliberately NOT sent"*: only the grade is written. The grade is sampled at the odometer, `apps/web/src/game/GameView.tsx:3399-3403` (**moved**: #2424 read it at `:2994-2998`) |

Two other references in #2424 and its siblings had moved: the HUD's draft field is now
`apps/web/src/game/hud/fields.ts:979` (the condition) and `:1044` (§`draftField`), where #2424's
siblings read `:928` and `:993`.

### What the research added (2026-11-09, from #2424)

- **The model's source is unchanged.** Blocken et al. 2018's in-line paceline figures (ADR 0038
  D-3.1). Inside a 121-rider peloton drag in the mid-rear falls to 5-10 % of an isolated rider's
  (Blocken et al., *Aerodynamic drag in cycling pelotons*, 2018); that is not reachable in single file,
  and ADR 0038 D-3.6 already says so.
- **Lateral offset matters more than gap.** Spoelstra et al. 2021 (J. Wind Eng. Ind. Aerodyn., the
  abstract read, not the paper) give trailing reductions of *"27% to 66% depending on the longitudinal
  and lateral separation"*; a wind-tunnel study (Shirasaki et al.) found the lateral distance has the
  stronger effect, with the benefit fading by about 0.25-0.5 m of offset. **Not adopted here**: ADR
  0038 D-3.4 stands, and a drawn line is never the input.
- **The leader's share is real.** Benito et al., ISBS 2022, measured the leading rider's drag area
  falling 2.6-3.3 % with a rider behind, in the range of D-3.2's 0.976-0.999.
- **Another trainer app frames a draft as a share of the rider's power saved**, and riders note that
  its trainer does not simulate a draft. ADR 0038 D-5 chose a share of **aerodynamic drag**, never
  watts; this ADR keeps that. No other product's draft curve or coefficients was consulted
  ([ADR 0009](0009-clean-room-posture.md)).

---

## Decision

### D-1 — Who gives a draft in a solo ride, and who takes one (decision 1)

**The owner's ruling** (quoted in Context, item 1): the bot pacer and the rider's own ghost give a
draft in a solo ride.

**The author's recommendation**, on how:

1. **Only the rider takes a draft.** The pacer and the ghost give one and never take one.
   - **The pacer's plan stays its own.** It is ridden from `botPacerPlan` (#92) through the same
     physics, at its own conditions. If the rider in front of it could shelter it, its pace would
     depend on the rider, which is what ADR 0061 D-1 forbids for race bots and what the pacer has
     never done. So the bot's odometer is bit-identical whether the rider is ahead of it, behind it
     or absent. `drafting.test.ts:132-143` (*"never drafts the bot, whatever the rider is ridden
     at"*) stays, and #2425 extends it to the case where the pacer gives a draft.
   - **A ghost is a replay and is never re-simulated** (`simulation.ts:162` and §`ghostClock`,
     `packages/domain/src/ghost/replay.ts`). ADR 0038 D-5 said a ghost *"has no drag area"*; that
     stays true of the ghost itself, which takes nothing. What changes is that the rider is now
     sheltered **as though** a rider were at the ghost's recorded distance.
2. **The model is ADR 0038 D-3, unchanged.** The rider's `k` is
   `fieldDraftFactors([rider, pacer?, ghost?])` at the rider's index, the same call the room makes,
   so a solo `k` and a room's `k` for the same gaps are equal to the bit. Single file, from
   **odometer** distances only: the rider's `state.ride.distance`, the pacer's
   `state.bot.state.distance` on the same fixed step, and the ghost's `ghostDistanceAt` at
   `ghostClock(state)`. **Never** `racing-line.ts`, `scene.ts` §`lateralOf`, or the drawn place from
   `bend-easing.ts` (ADR 0038 D-3.4). The table is unchanged, so is `physicsVersion`. **On a solo
   ride the simulation's `k` is the only `k`**: there is no room, so nothing predicts it and nothing
   corrects it. ADR 0038 D-4 (the room computes `k` from its own positions and the client predicts
   it) is about rooms and does not reach a solo ride; it requires no room-side check of a solo draft.
3. **The leading-rider effect applies** (ADR 0038 D-3.2, 0.976-0.999): a rider with the pacer or the
   ghost close behind gets `k_ahead_of` too. It is the same function, and leaving it out would be a
   second model.
4. **A pacer and a ghost together form a chain** by D-3.6's own rule, and two of them level with each
   other count as one place in it. Neither shelters the other, because neither takes a draft.
5. **Where it applies.** A solo ride with a bot pacer, the rider's own ghost, or both, with the
   switch of D-6 on. **Unchanged**: a room (the room's `k` is the only `k`, and a room has no pacer,
   ruling Q18), a lap race (D-2), and a ride with neither a pacer nor a ghost, which is bit-identical
   to today down to the odometer (`#drafted` returns the same object at `k = 1`).
6. **A source that has finished stays in the field and still gives a draft.** **The owner's
   ruling, 2026-11-10**, on this ADR's pull request: *"A ghost that has finished its attempt, or a
   pacer past the end of a route that is not a loop, stays in the field and still gives a draft."*
   It reverses the author's earlier recommendation that a finished source leave the field, as the
   room's finisher does (`room.ts` §`draft`, *"a finisher has left it"*); a solo ride does not follow
   the room here. Where each source sits:
   - **The ghost stays at `ghostDistanceAt`'s clamped distance, the end of its attempt.** From the
     step at which `ghostHasFinished(track, ghostClock(state))` is true (`replay.ts:202`),
     `ghostDistanceAt` returns `track.totalDistance` (`replay.ts:186-188`), and that is the distance
     the ghost enters `fieldDraftFactors` with, for the rest of the ride. A ghost whose attempt ended
     short of the route's end is therefore **a stationary rider at that point**: a rider who catches
     it can sit in the 30 m behind it (`DRAFT_REACH_METRES`, `draft.ts:53`) and be sheltered, and
     can pass it and take the leading-rider effect (D-1.3) for the 30 m past it, as from any rider
     on the road. A ghost that finished at the route's end sits at the finish: it shelters a rider
     over the last 30 m before the finish, and gives the leading-rider effect to a rider who rides
     on past the end.
   - **The pacer keeps its unclamped `bot.state.distance`.** The pacer never stops: `advanceBot`
     integrates `bot.state.distance` with no limit (`apps/web/src/game/simulation.ts:745-749`), and
     the only clamp is the grade lookup's, `distanceOnRoute`
     (`packages/domain/src/route/profile.ts:554`). Past the end of a point-to-point route it rides
     on at the last grade, and its unclamped odometer is the distance it enters `fieldDraftFactors`
     with, so it keeps sheltering a rider still within 30 m behind it. On a loop there is no end to
     pass.

### D-2 — Lap-race bots stay undrafted (decision 2)

**The author's recommendation: out of scope, and a lap race is exactly what it is today.** No
lap-race bot gives or takes a draft, and the rider takes none from a bot. ADR 0061 D-4 says that a
bot in a drafting race needs a superseding ADR that says *first* how each bot's plan stays independent
of the other racers, and the owner's request does not need one. Letting the rider take a bot's draft
while the bots could not take the rider's would also make a race whose physics differs by racer,
which ADR 0028 D-1 rules out. **ADR 0061 is not amended**: nothing in it becomes false.

### D-3 — The cross-rider ghost stays undrafted (decision 3)

**The author's recommendation.** A ghost of **another** rider ([ADR 0021](0021-racing-another-riders-ghost.md),
on consent under [ADR 0039](0039-racing-another-riders-ghost-on-consent.md),
[#331](https://github.com/openzigs/onyourleft/issues/331)) gives no draft and takes none. D-1 covers
the rider's **own** ghost only. ADR 0007 D4 puts another rider's replay closer to the claim language
read there (*"other users"*, *"archived performance data … used in subsequent sessions"*), and
neither ADR 0038 D-7's acceptance nor this ADR's D-4 reaches it. Drafting one is a new ADR and a new
owner decision.

### D-4 — The patent-risk decision (decision 4)

**The owner's ruling** (Context, item 1): *"The owner accepts the patent risk for this, extending ADR
0038 D-7's acceptance."*

- **It covers what D-1 decides and nothing more**: the rider drafting the solo bot pacer and the
  rider's own ghost. It does not reach the cross-rider ghost (D-3) or lap-race bots (D-2).
- ⚠️ **This is a risk decision, not a finding.** No claim chart was drawn for drafting a synthetic
  rider or a replay of the rider's own ride, and nothing was searched for this ADR. Spike 0005 §1.4
  found *"no granted US patent claiming a drafting or slipstream model in a virtual cycling
  environment"* and recorded that as **not established**, not as clear. This ADR is not a
  freedom-to-operate opinion ([ADR 0007](0007-patent-posture.md) D1), and it must not be quoted as
  one.
- **What it leaves standing.** ADR 0007 D4's ✅ on the bot pacer rests on there being no recorded ride
  behind it, and its ✅ on the rider's own previous ride rests on the data being the rider's own and
  unranked. A draft changes neither: the pacer is still synthetic and the ghost still the rider's
  own, private and unranked. ADR 0038 D-7 stays as written, a record of what was accepted on
  2026-09-28; this is a second acceptance beside it, not an edit to it.

### D-5 — What a drafted solo ride does to comparisons (decision 5)

A rider who drafts their own best ghost beats it partly on its shelter. **The owner's ruling**
(Context, item 2): *"'Your best' and segments mark a ride where the rider drafted."*

1. **"Your best"** — `ghost-outcome.ts`'s settled outcome and the HUD's ghost field (`hud/fields.ts`
   §`LABELS`, `'Your best'`). **The author's recommendation, on how**: an outcome settled on a ride
   in which the rider drafted the ghost or the pacer says so in words, *"with its draft"* beside the
   result, on the rendered text and in its accessible name, never by colour alone. A ride that
   drafted nothing reads exactly as today.
2. **Segments.** **The author's recommendation, on how**: an effort is **marked** when the rider
   **drafted** inside it, by the definition of D-5.6. A marked effort is recorded, kept
   in the rider's own history and shown with its mark wherever it appears. It is **never silently
   mixed**: a comparison that puts it beside an unmarked effort shows the mark, and it is not offered
   to an instance leaderboard ([#68](https://github.com/openzigs/onyourleft/issues/68)) in this
   epic. Whether a room-drafted effort is marked the same way is **open** (D-9), because rooms are
   unchanged by this epic.
3. **The fact is kept with the ride on the device**, so the mark survives a reload; how it is stored
   is #2425's.
4. **The FIT export does not carry it in this epic.** **The author's recommendation: open.** Carrying
   it would be a developer field in the shape of [ADR 0053](0053-the-fit-lap-mark-a-developer-field-of-our-own.md),
   which is a permanent format decision of its own.
5. **What the rider is shown during the ride** follows the owner's ruling 3 (Context): the in-draft
   indicator is visual and not spoken (#2426). **The author's reading of that ruling**: a solo draft
   gains no spoken cue at all, so #2425's criterion that the room's `draftEvent` cue fires on a solo
   ride is superseded by ruling 3; the solo ride feeds the visual mark and the draft field. The
   rooms' spoken cue is unchanged. **The solo caller keeps the `inDraft` state `draftEvent` returns
   (D-5.6) and never queues the spoken `room-draft` event it also returns.** The reading is a share
   of aerodynamic drag, `(1 − k) × 100 %`, never watts (ADR 0038 D-5, kept).
6. **What "drafted" means** (added 2026-11-10 on review of this ADR's pull request, and **ruled by
   the owner on 2026-11-10**, R-12). "Any step at `k < 1`" would mark nearly every ride with the
   switch on: a solo ride starts level with the pacer or the ghost, and every start, and every pass,
   crosses the 30 m window in which `k` is below 1, if only by the leading-rider effect, which is
   under 0.1 % past 5 m. A mark that is always present tells the rider nothing. So:
   - **In the draft is `draftEvent`'s state** (`room-ride.ts:434-446`), fed the rider's **whole**
     solo `k` as the Draft field's reading, `(1 − k) × 100 %`: it begins when that reading reaches
     `DRAFT_IN_PERCENT` (10 %) and ends when it falls below `DRAFT_OUT_PERCENT` (5 %). It is the same
     transition, on the same `k`, that the in-draft mark of #2426 follows, so what the rider saw and
     what is recorded can never disagree. The `k` is the one `fieldDraftFactors` returns (D-1.2);
     nothing is computed beside it.
   - **An observation, not a rule**: the leading-rider effect (D-1.3) is at most 2.4 % (`LEADING`,
     0.976 at 0.05 m, `draft.ts:75`), so on its own it never reaches the 10 % entry and never marks a
     ride by itself.
   - **The state advances once per fixed simulation step**, from that step's `k`, not once per
     rendered frame as the room's spoken cue does today (`GameView.tsx:3209-3210`). A catch-up after a
     stall or a backgrounded tab then credits each step to the state it was ridden in, two runs of the
     same ride record the same share, and a ride with the screen off is still recorded. The mark
     reads the same state, so it lags the record by at most one frame.
   - **The rule: a ride or an effort is drafted when the rider was in the draft for at least a
     minimum share of its distance.** Distance, not time, because a segment is a stretch of road and
     a drafted rider covers it in less time. For "Your best" (D-5.1) the span is the attempt the
     outcome settles; for a segment (D-5.2) it is the effort.
   - **The share's value is not fixed by this ADR.** It is a single named constant that #2425
     defines. **The owner approved 10 % of the distance as its value on 2026-11-10**, on this ADR's
     pull request; it is unsourced. A later change to it changes that constant and no ADR. The two
     thresholds of the in-draft state stay what they are in `room-ride.ts`, also unsourced, and are
     not changed by this ADR.

### D-6 — The switch (decision 6)

**The owner's ruling** (Context, item 1): *"The rider must be able to turn the draft off. Add a
setting, held on the device, that turns drafting off for the pacer and the ghost. With it off, the
rider is at k = 1, as today."*

- **Off is today, to the bit.** With the switch off, the simulation is byte-identical to `main` before
  #2425, and #2425 carries the test.
- **On by default.** **The author's reading** of *"able to turn the draft off"*, and #2424's
  recommendation: a rider who stored nothing rides in the pacer's and the ghost's draft.
- **It is a different switch from `draft-preference.ts`.** That one decides only what a rider is
  **shown** about a room's draft, and the room's maker decides the room's physics. This one decides
  the **physics** of a solo ride. **The author's recommendation**: with it off there is no solo
  draft to show, so the solo ride shows no draft field. **The owner's ruling, 2026-11-10** (R-13):
  **with it on and the `draft-preference.ts` display preference off**, the solo Draft field and
  #2426's mark inside it are hidden, as they are in a room; the physics is unchanged, the in-draft
  state is still advanced (D-5.6), and a drafted ride is still marked *"with its draft"*, because
  the mark records what the rider was ridden at, not what they were shown.
- **It has no effect in a room or a lap race**, where D-1.5 and D-2 already decide.

### D-7 — The trainer never feels a draft (decision 7)

ADR 0038 D-1, restated and unchanged: **a draft is a multiplier on the rider's `C_D·A` and nothing
else.** No draft term reaches any trainer write: no grade, no wind, no rolling resistance, no wind
resistance coefficient, no ERG target. The grade is read at the rider's odometer
(`GameView.tsx:3399-3403`) and only the grade is written (`gradient.ts:79-95`). A draft reaches the
trainer only the way riding harder does: the rider arrives at the next grade sooner.
[#2423](https://github.com/openzigs/onyourleft/issues/2423)'s gate (a drafted and an undrafted ride
through the gradient session and the ERG writer, compared write for write) **stays green unmodified**
when #2425 adds the pacer and the ghost, and #2425 extends it with a pacer-drafted run.

### D-8 — The test that changes

`apps/web/src/game/drafting.test.ts:121-144` is the `describe` *"nothing but a room's rider gives or
takes a draft — #327, ADR 0038 D-5"*. Its first `it`, *"gives no draft from a bot pacer 1 m ahead: k =
1"* (`:122-130`), asserts the sentence D-1 supersedes. Its second, `:132-143`, does not. #2425 changes
the `describe` as follows, and nothing else in it:

- **The first `it` splits into two tests.** The existing one builds a joined room **and** a
  simulation with a bot, and asserts both are at `k = 1`.
  - **A room test keeps today's assertion, unchanged**: in a room the room's `k` is the only `k`, so
    the game's bot a metre up the road shelters nobody (D-1.5).
  - **A new solo test**: with the switch of D-6 on, a solo rider 1 m behind the pacer is ridden at
    `draftFactor(1, 1)` from `@onyourleft/physics` (nobody is behind them), and the rider's odometer
    after a held effort is **greater** than the same ride with the switch off. With the switch off
    it is the old solo assertion, `k = 1`.
- **`drafting.test.ts:132-143` stays** and is extended (D-1.1).
- **The `describe`'s claim changes, not only its citation.** After #2425 *"nothing but a room's rider
  gives a draft"* is false. The title says what stays true, that a pacer and a ghost give a draft only
  on a solo ride and never take one, and cites this ADR rather than ADR 0038 D-5.

### D-9 — What the owner is asked to confirm on this pull request

Each line is the author's recommendation; the owner's ruling of 2026-11-09 did not answer it. Until
the owner confirms or changes it, it is Proposed. **R-11, R-12 and R-13 were ruled by the owner on
2026-11-10** on this ADR's pull request: R-11 reversed the author's recommendation, and R-12 and R-13
approved it.

| # | Question | Recommendation | Where |
|---|---|---|---|
| R-1 | Only the rider takes a draft; the pacer and the ghost give one and take none | **Yes** | D-1.1 |
| R-2 | The leading-rider effect from a pacer or ghost behind the rider applies | **Yes** | D-1.3 |
| R-3 | Lap-race bots give and take no draft, and a lap race is unchanged | **Yes** | D-2 |
| R-4 | The cross-rider ghost gives and takes no draft | **Yes** | D-3 |
| R-5 | "Your best" says *"with its draft"* after a drafted attempt, "drafted" as D-5.6 defines it | **Yes** | D-5.1, D-5.6 |
| R-6 | A segment effort is marked when it was drafted as D-5.6 defines it, and a marked effort is not offered to a leaderboard in this epic | **Yes** | D-5.2, D-5.6 |
| R-7 | Whether a room-drafted effort is marked the same way | **Open**, not in this epic | D-5.2 |
| R-8 | The FIT export carries the fact | **Open**, not in this epic | D-5.4 |
| R-9 | A solo draft has no spoken cue (the author's reading of ruling 3) | **Yes** | D-5.5 |
| R-10 | The switch is on by default, and with it off no solo draft field is shown | **Yes** | D-6 |
| R-11 | A ghost past the end of its attempt, and a pacer past the end of a route that is not a loop, stay in the field and still give a draft (the ghost at the end of its attempt, the pacer at its unclamped distance) | **Owner's ruling, 2026-11-10: yes** (the author had recommended no draft) | D-1.6 |
| R-12 | "Drafted" is `draftEvent`'s 10 % / 5 % state on the whole solo `k`, advanced per simulation step, for at least a minimum share of the distance; the share is one named constant #2425 defines (10 %) | **Approved by the owner, 2026-11-10: 10 %** | D-5.6 |
| R-13 | With the physics switch on and the display preference off, the Draft field and the mark are hidden and the ride is still marked | **Approved by the owner, 2026-11-10** | D-6 |

---

## Consequences

### What this enables

- #2425 can ride the rider in the pacer's and the own ghost's draft, change `drafting.test.ts:121-131`
  as D-8 says, and add the switch of D-6.
- #2426's in-draft mark has a solo source as well as a room's.
- The owner's request is met for the pacer and the own ghost. For **lap-race bots** it is not, and
  D-2 says why; that is a deliberate gap, not an oversight.

### What this costs, stated plainly

- **A solo ride against your own best is no longer the same contest.** A rider who sits in their
  ghost's draft beats it partly on its shelter. D-5's marks make that visible; they do not make the
  two rides equal.
- **Shelter from something with no body.** The ghost is a replay with no drag area of its own, and
  the pacer is never sheltered by the rider. Outdoors two riders share the air both ways; here only
  the rider gains. It is the price of keeping the pacer's plan its own and the ghost a replay.
- **The model's known limits carry over unchanged**: single file, position-blind, a time-trial
  table for road positions, and the two unsourced rules (ADR 0038's "What this costs").
- **The patent risk is accepted, not removed** (D-4).

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #2425 | D-1's inputs (odometer distances only, `fieldDraftFactors` unchanged); the pacer and ghost never take a draft; a finished ghost stays in the field at the end of its attempt, and a pacer past the end of a route that is not a loop stays in it at its unclamped distance, both still giving a draft (D-1.6, the owner's ruling of 2026-11-10); D-6's switch with an off position byte-identical to today; D-8's test change and no other change to `drafting.test.ts`'s existing assertions; D-5's marks, by D-5.6's definition (`draftEvent` on the whole `k`, per simulation step) with the share as one named constant, 10 % as the owner approved on 2026-11-10, read back on the rendered text; D-7's gate green unmodified; no spoken solo cue: `draftEvent`'s state is kept and its `room-draft` event never queued (D-5.5) |
| #2426 | A solo source feeds the same in-draft state as a room's; not spoken (ruling 3) |
| #2423 | Its test is the trainer gate D-7 names; a new drafting source must keep it green unmodified |
| #2422 | The bend easing's drawn place is never a draft input (D-1.2) |
| Lap race | Unchanged (D-2). A drafting lap race needs the superseding ADR ADR 0061 D-4 asks for |
| #331 | Unchanged (D-3) |

---

## What would make this ADR wrong

- **Riders read the one-way shelter as unfair or odd** — a pacer that never benefits from the rider
  sitting in front of it, or a ghost that shelters without a body. Then the pacer taking a draft is
  revisited, and ADR 0061 D-1's reasoning has to be answered for the pacer first.
- **A granted or pending claim turns up that recites drafting a synthetic or replayed rider.** Then
  D-4's acceptance was made without it, and the owner decides again.
- **The marks of D-5 turn out to mix silently somewhere** — a personal best, a comparison or a board
  that ranks a drafted effort beside an undrafted one without saying so. Then D-5 has failed and the
  mark is owed there before anything else ships.
- **#2423's gate has to change to let #2425 pass.** Then a draft has reached the trainer, which D-7
  forbids, and the change is wrong rather than the gate.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-11** — **D-2 (lap-race bots stay undrafted) and D-6's last bullet (the switch has no
  effect in a lap race) are superseded by
  [ADR 0067](0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md) D-3**: every racer in a
  solo lap race gives and takes a draft by ADR 0038 D-3's model on effort distance, and this ADR's
  switch, off, turns it off for the whole race. D-7 (the trainer never feels a draft) is unchanged
  and binds the lap race. This entry only points there; nothing else in this ADR changes.
