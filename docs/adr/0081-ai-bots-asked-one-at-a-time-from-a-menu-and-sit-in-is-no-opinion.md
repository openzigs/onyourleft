# ADR 0081: The AI bots are asked about one at a time, from a menu the device makes, and the model's sit-in is no opinion — superseding in part ADR 0071 D-3, D-4.4 and D-7, ADR 0073 D-3, D-4 and D-5, ADR 0074 D-1 and D-2, and ADR 0076 D-11

- **Status**: **Proposed**, 2026-11-18. The design is the owner's ruling of that day on
  [#2836](https://github.com/openzigs/onyourleft/issues/2836), quoted in Context. What the ruling
  leaves open is the author's, marked *the author's choice*, and D-8 puts it to the owner as
  questions. **The build is in #2836's pull request**, behind bot-code version 7; it merges after
  the owner's answers, the scoring harness (#2838) and a tablet race
- **Date**: 2026-11-18
- **Deciders**: **the owner**, whose ruling is not argued again. **The author** decided what it
  leaves open
- **Issue**: [#2836](https://github.com/openzigs/onyourleft/issues/2836). It builds on #2767
  (ADR 0076), #2801 (#2794's course ahead) and #2834
- **Number**: **0081**, the next free number in `docs/agents/adr-numbering.md` on 2026-11-18. No
  open pull request named it. #2835's lane took **0083** the same day and left 0081 to this one
  ([its comment](https://github.com/openzigs/onyourleft/issues/2835)); 0082 is ADR 0082. The next
  free number is then **0084**
- **Supersedes, in part**, for **a model race only** (ADR 0071 D-1):
  - [ADR 0071](0071-model-chosen-lap-race-bot-tactics-during-a-ride.md) **D-3.1** (the answer's
    schema: one move for each bot the model names), **D-3.4** (the input: the whole field's race
    state), **D-4.4**'s *"The log keeps the answers and times only"*, and **D-7**'s figure of a
    call every 4 s of race time. D-3.2, D-3.3 and D-3.5 stand as written: the answer is still read
    field by field, twice, the model still gets no tools, and no model-written text is kept;
  - [ADR 0073](0073-ai-bots-race-with-strategy-freedom-inside-the-bodys-limits.md) **D-3** (the
    strategy rules lifted): the model's choice is now among the moves the device offers (D-2), so
    D-3.1's gamble under the W′ floor, D-3.2's flyer for any bot, D-3.4's target of any racer and
    D-3.5's kick from anywhere are no longer the model's to name. **D-4**, which gains a case: a
    bot the model answers `sit-in` for rides its seeded tactics (D-1). And **D-5.3**'s *"no
    code-computed attack gate"*: a menu is one;
  - [ADR 0074](0074-a-sprint-instinct-behind-the-models-moves.md) **D-1** and **D-2** for a model
    `sit-in` only: the backstop and its hold no longer fire on a `sit-in`, because a `sit-in` is no
    longer written over the seeded tactics, which kick inside the launch themselves (D-1.3). Both
    stand behind every other move the model names;
  - [ADR 0076](0076-ai-bots-race-with-bodies-that-fit-their-style-and-a-spread-of-strength.md)
    **D-11** in its figures for the call: one for the field every 4 s, at most 256 tokens. Its 8 s
    late limit and 10 s hold stand, the hold now for each bot (D-2.5).

  It is a new ADR and not an amendment because it reverses part of each, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0071, 0073,
  0074 and 0076 each gain one dated `## Amendments` entry pointing here; no body is edited
- **Leaves standing**: every seeded race, to the bit; ADR 0071 D-1 (and D-1.4: no instance, no AI
  bots, nothing else changes), D-2, D-5 and D-6 (the local model only, the rider's consent, the one
  model slot), D-7's fallback and D-8; ADR 0073 D-2 (the body's limits); ADR 0076 D-1 to D-10

---

## Context

### What the owner saw, and what the saved race shows

On the owner's tablet race of 2026-11-18 (the Kestrel circuit, 3 min 36 s, seven bots, bot-code
version 5): *"There was a difference in riders … It was odd the climber did not catch up on the
climb. I did see some gaps which is good."* The saved race's log shows why:

- all 32 answers arrived in time (median 4.15 s on the device);
- **five of seven bots never made a move**: bots 0 to 4 were `sit-in` at `easy` in every answer,
  and ten answers in a row were "every bot sit-in, easy";
- so the climber, one of those five, was held on a wheel up the climb;
- and the log does not say who each bot is, so the race could not be explained without
  recomputing the field.

Two things made that race. Asked for seven moves at once, under a prompt that said *"Most bots sit
in most of the time"*, the model gave most of the field the safe move. And
`applyModelMoves` **wrote each `sit-in` over the bot's seeded tactics**, which would have sent the
climber up the climb on their own (`tactics.ts` §`BOT_TACTIC_CLIMB_GRADE_PERCENT`).

### What the owner ruled

> **Owner ruling, 2026-11-18:** "yes fold these in", given to "Shall I fold these into #2835 and
> #2836 along with the review's design?" after the AI review of 2026-11-18. The owner accepts that
> the backstop needs an ADR.

The design folded in is #2836's revision block, which supersedes the issue's body: (1) a `sit-in`
from the model means "no opinion", and this replaces the body's "N idle answers" counter; (2) one
bot at a time, from a menu the tablet makes; (3) a reason word before the move; (4) the prompt
`tactics-8`; (5) logs on the device and on the instance. D-1 to D-5 are those five, in that order.

---

## Decision

### D-1 — A `sit-in` from the model is no opinion

1. In a model race, when a bot's window opens with a decision in force that names it `sit-in`,
   **nothing is written**: the bot keeps the memory it had, and its seeded tactics
   (`decideTactic`) choose for that window exactly as they do with no decision in force. The model
   overrides the seeded tactics only with a move.
2. So a bot the model sits in still attacks a climb if it is a climber, follows a move ahead,
   recovers when it is low, and kicks at its launch, by the seeded rules and inside them (ADR 0073
   D-4): the W′ floor, the 20 s attack, the dwell.
3. **Inside the launch too.** A model `sit-in` there leaves the sprint to the seeded tactics, which
   launch the kick on the same misread line. ADR 0074's backstop was needed because the `sit-in`
   was written over that kick; it now fires only behind a move the model names. *The author's
   choice* (R-3): the other reading keeps ADR 0074's hold on a `sit-in`, at the cost of the
   property in D-1.4.
4. **A model that only ever says `sit-in` rides the seeded race to the bit**, to the line. The
   build holds that as a test.
5. It is a strategy rule, behind the existing seam: `ADR_0081_MOVE_STRATEGY` in
   `packages/domain/src/lap-race/model-race.ts`. The body's limits stay outside the seam (D-7).

### D-2 — One bot at a time, from a menu the device makes

1. **The cadence.** One call is about one bot. The device asks about the next bot round the field
   that has something to choose, no sooner than **1 s** after the last ask and only when no call is
   out, so a model that answers inside a second is asked once a second and a slower one as fast as
   it answers. The first ask is 4 s after Go, as it was. A bot with nothing to choose costs no
   call.
2. **The menu.** For the bot asked about, the device works out **two to four moves** that are
   sensible for it now, from its style, the terrain, its energy and its place
   (`packages/domain` §`modelTacticsOffer`). `sit-in` is always on it, last. The model picks from
   the menu and nowhere else: a move off it is no decision, at the instance and again on the
   device. **The menu is empty, and the bot is not asked about**, when it is blown (the body's
   limit), when it reads the line inside its launch distance (the sprint is the bot's own, D-1.3),
   or when nothing but sitting in is sensible.
3. **What goes on it**, before `sit-in`, at most three, in this order. *The author's choice*, and
   every figure a feel number (R-2); the thresholds named in capitals are the seeded tactics' own,
   so the two never disagree about what a climb or a wheel is:

   | Move | Offered when |
   |---|---|
   | `kick` | on the last lap, within **2** launch distances of the line as the bot reads it |
   | the move it is in | it is in an `attack`, `chase`, `flyer`, `kick` or `follow`: it may hold it |
   | `follow` the racer ahead | that racer is in a move within `BOT_TACTIC_FOLLOW_METRES` (50 m) |
   | `attack` | never a sprinter; W′ at `BOT_TACTIC_WBAL_FLOOR` (0.3) or more; **on its terrain**, or W′ at **0.8** or more with no attack or flyer for **30 s** |
   | `flyer` | a breakaway rider on any lap, a rouleur in the last 2; W′ at 0.6 or more; no climb ahead |
   | `chase` the racer ahead | out of the draft (30 m) and within 200 m; W′ at 0.3 or more |
   | `recover` | W′ under 0.5 |

   **On its terrain** is: a climber where the grade ahead is 3 % or more; a rouleur or a breakaway
   rider where it is not; a sprinter inside the finish window; an opportunist within **10 s** of
   the last attack or flyer ending. The target of a `follow` or `chase` is the racer directly
   ahead, set by the device and never by the model.
4. **The cue words** go with the menu, from a closed list: `on-your-terrain`, `climb-soon` (a
   climb starts within 300 m), `fresh`, `tiring`, `move-ahead`, `move-just-caught`, `race-quiet`,
   `last-lap`, `finish-near`.
5. **Shared first, the bot last.** The ask is the race in short (laps, the course ahead, the
   rider, and every racing bot's seat, style, place, move and gap), the story so far (D-4.4), and
   then the bot: its style and strengths, the seconds since its last move, its move, place, gaps,
   W′, the line as it reads it, the grade ahead, the metres to its next climb, its cues and its
   menu. Every field is a number, a boolean or a word from a closed list, as ADR 0071 D-3.4
   requires, and the reader refuses any other key. The instance writes what the model reads from
   the ask **after** reading it field by field, key by key in an order it fixes, so the start of
   the prompt is the same from call to call.
6. **A decision holds for the bot it names**, 10 s from the window it applied in, unless that
   bot's next replaces it. Another bot's decision does not end it. *The author's choice* (R-4):
   the figure is ADR 0076 D-11's, unchanged, and seven bots at a call a second is a round of 7 s.
7. **The instance's limit** on tactics calls is raised from 30 to **90** a minute for one athlete
   (60 is one a second; the rest is room for a start and an AI pacer's decisions, which share the
   count). **One call out per athlete is unchanged**, and is what bounds the model's time.
8. **A device and its instance run the same build.** An ask of the shape sent before this ADR is
   `validation_failed` at the instance, and an answer of the old shape is no decision on the
   device, so a mismatched pair rides the seeded race (ADR 0071 D-7). *The author's choice* (R-6):
   serving both shapes would keep `tactics-7`, whose answers this ADR is written about.

### D-3 — A reason word before the move

The answer is `{"reason":<word>,"move":<one on the menu>,"effort"?:<word>}`. The reason is
required and **first**, so the model says why before it says what, from a closed list:
`my-terrain`, `cover-move`, `counter`, `save-legs`, `finish-near`. No free text. It is logged
(D-5) and nothing rides it. There is still no power field, and now no number at all.

### D-4 — The prompt: `tactics-8`

1. The sentence *"Most bots sit in most of the time"* is gone.
2. **The goal is stated**: a lively, believable race for the human; a race where nothing happens
   is a failure.
3. **Four worked examples**, four bots of different styles in one race, each a different pick.
4. **A "story so far" line**, which the instance writes from numbers and closed words the device
   sends and it has checked: the seconds raced, the laps left, the break (how many racers, for how
   long, how far clear), the lull, and how the bots are for energy. Never a device's text.
5. **The seconds since the bot last made a move of its own** are shown before its current move.
6. **No `effort` on `sit-in` or `recover`**: the schema offers none there, and the reader keeps
   none.
7. It is still guidance about what each move, style and cue is for (ADR 0073 D-5.4). What changed
   is that the device, not the prompt, says which moves are open.

### D-5 — What is logged

1. **On the device, with the ride** (ADR 0071 D-4.4), so a race can be explained afterwards
   without recomputing the field:
   - for the race: each bot's racing style, personality and skill, by seat;
   - with every call: the seat asked about, its place, its cue words and its menu, and, for a
     decision, the model's reason word;
   - every change of move, with who chose it: the `model`, the bot's `seeded` tactics, or its
     sprint `instinct` (ADR 0074). This is "which moves were seeded".

   Numbers and closed words only. **No replay reads any of it**, and the model input is still not
   kept (ADR 0071 D-10 R-7): the cues and the menu are what the device concluded from it.
2. **On the instance, one line a call**: the prompt's version, the model's name, how the call
   ended (`decision`, `invalid`, `failed`), the time it took, and the model server's own figures
   for it: load time, tokens in and out, and the time reading the prompt and writing the answer.
   Numbers and closed words only: never the model's text, a move, or anything of the race, the
   rider or a place. The instance still keeps no copy of a race (ADR 0071 D-7, D-8.5).

### D-6 — Determinism

The build raises `LAP_RACE_BOT_CODE_VERSION` to **7** (ADR 0071 D-4.3), after #2834's 6, with a
new golden entry beside the old ones. A log recorded under another version is not replayed, as
before. A stored record from before version 7 still reads back: what D-5.1 adds is optional in the
reader.

### D-7 — What does not move

- **The body's limits** (ADR 0073 D-2): an exhausted bot keeps its seeded choice before any
  strategy rule is read, `spendableWatts` caps every target, a seeded one included, and nothing
  changes a capacity.
- **No model output reaches a trainer.** `lap-race-cannot-reach-trainer.test.ts` and the trainer
  equality tests are unmodified.
- The local model only, the rider's consent, the one model slot and its hold, sealed-only routes,
  no tools, reasoning off (ADR 0071 D-3.3, D-5, D-6).
- A rider with no instance, or no consent, rides the seeded race, unchanged (ADR 0071 D-1.4).

### D-8 — Questions for the owner

| | Question | Recommendation |
|---|---|---|
| **R-1** | Approve ADR 0081 as built: `sit-in` is no opinion, one bot a call from a device-made menu, a reason word first, `tactics-8`, and the two logs | **Approve** |
| **R-2** | The menu's figures in D-2.3 and D-2.4 (the finish window of 2 launch distances, fresh at 0.8, quiet at 30 s, a counter within 10 s, a climb soon at 300 m) | **Approve as starting values**, to tune on #2838's harness |
| **R-3** | A model `sit-in` inside the launch leaves the sprint to the seeded tactics, without ADR 0074's hold (D-1.3) | **Approve.** It keeps "a model that only says sit-in rides the seeded race" exact |
| **R-4** | Keep the 10 s hold, now for each bot (D-2.6) | **Keep**, and set it against the round measured on the tablet: raise it if a round of the field takes more than 10 s |
| **R-5** | Send the shared race fresh with every call, rather than one snapshot for a whole round so the model server reads only the bot's part | **Fresh.** On the owner's PC Ollama read the whole prompt on every call (What was measured), so a snapshot would save nothing there |
| **R-6** | An older app against a newer instance, or the reverse, rides the seeded race (D-2.8) | **Approve** |
| **R-7** | The model can no longer launch a kick from anywhere, send any bot on a flyer, or gamble under the W′ floor (ADR 0073 D-3): only what the menu offers | **Approve.** It is what "the model picks from that menu only" means |
| **R-8** | 90 tactics calls a minute for one athlete (D-2.7) | **Approve** |

---

## Consequences

### What this enables

- **The floor under a race is the seeded race**, not a field sitting in: whatever the model
  answers, each bot does at least what its own tactics would.
- Each call is short: one bot's ask, and an answer of a reason and a move.
- A saved race says who each bot is, what each was offered, why the model picked, and which moves
  were the model's.

### What this costs, stated plainly

- **The model has less freedom than ADR 0073 gave it** (R-7). The device decides which moves are
  open; the model decides among them.
- **A bot is asked about once a round**, about every 7 s with seven bots at a call a second, where
  it was every 4 s. A slow model, or a slow link, makes the round longer, and a decision that
  lapses first hands the bot back to its seeded tactics.
- **More calls**: up to 60 a minute where there were 15, each much shorter.
- **The menu's thresholds are untested feel numbers** until the harness and a ride say otherwise.
- **The finish is the seeded race's** unless the model names a move near the line (D-1.3).

### Reversing any of these

D-1, D-2 and D-3 each need a superseding ADR. The figures in D-2.3, D-2.4, D-2.6 and D-2.7 are the
build's to state with a measurement, as ADR 0071 D-7 left its own.

### Not decided here

The scoring harness and its pass mark (#2838). The AI pacer (#2835, ADR 0083).

---

## What was measured

### On the owner's PC, 2026-11-19

gemma4:12b (Q4_K_M) under Ollama on the PC's loopback, reached over SSH, nothing deployed.

**The scoring harness (#2838)**, all six fixed races, `tactics-8` ridden three times and the worst
of the three taken (`docs/agents/game.md`), beside one run of `tactics-7` from `main` the same
morning. Pass marks: at least 5 of 7 bots move, no quiet run over 30 s, a climber attacks a climb,
9 answers in 10 are decisions and at most 1 in 10 is late. Results files, numbers only, under
`apps/web/tools/model-tactics-spike/results/scores/`.

| Race | Bots that moved, `tactics-7` | `tactics-8` (worst) | Longest quiet run, s, `-7` | `-8` | Climber attacks on a climb, `-7` | `-8` | Median answer, ms, `-7` | `-8` | Prompt tokens, `-7` | `-8` |
|---|---|---|---|---|---|---|---|---|---|---|
| flat | **4** | 7 | 24 | 0 | 0 | 0 | 3 744 | 1 616 | 2 358 | 1 632 |
| flat-mid-lap | **4** | 7 | 5 | 0 | 0 | 0 | 3 331 | 1 068 | 2 356 | 1 631 |
| rolling | 5 | 7 | 0 | 0 | 0 | 0 | 2 907 | 1 062 | 2 369 | 1 630 |
| rolling-mid-lap | **4** | 7 | 4 | 0 | 0 | 0 | 3 371 | 1 078 | 2 363 | 1 631 |
| climb | 5 | 7 | 0 | 0 | 2 | 2 | 2 928 | 1 082 | 2 406 | 1 668 |
| climb-mid-lap | 6 | 7 | 11 | 0 | 2 | 2 | 3 384 | 1 127 | 2 405 | 1 674 |

`tactics-7` fails three of six races on bots that moved; `tactics-8` passes all six in all three
runs. Every answer of both was a decision, and none was late. A `tactics-8` race makes 111 to 240
calls, against 41 to 74 for `tactics-7`.

**Ollama's own figures**, the flat race's first asks sent again in race order (12 of
`tactics-7`, 21 of `tactics-8`, three rounds of the field), median:

| | `tactics-7`, seven bots | `tactics-8`, one bot |
|---|---|---|
| Time a call (`total_duration`) | 2 659 ms | 1 070 ms |
| Prompt tokens (`prompt_eval_count`) | 2 353 | 1 635 |
| `prompt_eval_duration` | 1 108 ms | 644 ms |
| Answer tokens (`eval_count`) | 74 | 16 |
| `load_duration` | 20 ms | 20 ms |

A round of seven bots is about 7.5 s of calls, inside the 10 s hold (R-4). **Ollama evaluated the
whole prompt on every call**: `prompt_eval_count` is the full prompt each time, though the system
text and most of the race are the same from one call to the next. So freezing the shared race for
a round (R-5) would save nothing on this server as it stands; the 644 ms is the system text and
the race read again. That is a finding for R-5, not a change made here.

### On the author's Mac, 2026-11-18

gemma4:12b (Q4_K_M) under Ollama, with other work running on the machine, so **the token counts
are the finding and the times are not**:

| | `tactics-7`, seven bots | `tactics-8`, one bot |
|---|---|---|
| System text | 5 389 characters | 4 256 characters |
| Race state or ask | 2 536 characters | 1 300 characters |
| Prompt tokens (`prompt_eval_count`) | 2 414 | 1 700, of which about 450 are the ask |
| Answer tokens (`eval_count`) | up to about 150 (ADR 0076 D-11) | 12 to 15, over five calls |

All five answers were valid picks from their menus with the reason first, among them
`{"reason":"my-terrain","move":"attack"}` for a climber on a climb and
`{"reason":"cover-move","move":"follow"}` for a breakaway rider behind a move. Five calls are not a
race: the harness is.

---

## What would make this ADR wrong

- **Bots still do not race**: the harness shows fewer than five of seven bots making a move in a
  four-minute race. Then the menu is too narrow, or the seeded tactics are (their thresholds are
  ADR 0067's).
- **The model picks `sit-in` from every menu.** The floor holds, but the calls buy nothing: the
  fix is the prompt, or dropping the model for a rule.
- **A round is too slow on the tablet** for a decision to mean anything (R-4, R-5).
- **The race looks scripted**: every climber attacking every climb at the same metre. Then the
  menu should offer less and the seeded tactics should be read with more of the skill's misread.
