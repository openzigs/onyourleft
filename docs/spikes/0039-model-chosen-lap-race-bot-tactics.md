# Spike 0039: A language model picks the lap-race bots' tactics, on the owner's instance PC

- **Date measured**: **2026-11-16.** Every figure below was measured that day on the machine in §2.
- **Issue**: [#2616](https://github.com/openzigs/onyourleft/issues/2616), on the owner's lane scope
  of 2026-11-16 (*"Start ai bot trial"*): a model-tactics adapter, a replay decision log, a harness
  comparison against the seeded tactics (#2561), local latency against Ollama 0.40.16 with
  `gemma4:12b` (`think:false`) on the instance PC, alone and beside a write-up job, and this
  write-up. The pacer half is **report only** (§7). Refs #2582, #2538, #2558, #2561, #1234.
- **Code**: `apps/web/tools/model-tactics-spike/`. **Spike code**: nothing the app ships imports it
  (`spike-boundary.test.ts`), so none of it is in the bundle or on the ride path.
- **Status of this document**: a **spike write-up**. It decides nothing, and it amends no ADR. §8
  lists the amendments a build would need.
- **Addendum**: §10, dated 2026-11-16 (#2708), re-measures with a tuned prompt and corrects four
  statements in §1, §4 and §8 (#2705). The body above is left as it was measured.

> ## ⚠️ What this does NOT do
>
> - **The owner has not ridden against it.** Feel is the issue's measure 3, and its second half is
>   the owner riding both on the tablet. The spike stays off the ride path by the lane's own rule,
>   so there is no build to ride. §5 gives the headless comparison only.
> - **The hosted alternative is not measured.** The lane skips OpenRouter unless the owner provides
>   a key. No account was created and nothing was spent.
> - **One prompt, untuned.** `ollama.ts` §`MODEL_TACTICS_SYSTEM` was written once and never tuned
>   against the harness. §5's "the model attacks far more" is a finding about this prompt, not about
>   what a model can do.
> - **No pacer behaviour changed.** The pacer's patent limits are waived for this spike by the
>   owner's ruling of 2026-11-14. Nothing here exercises that waiver.

---

## 1. Headline

1. **It is fast enough to run, on its own.** 216 batched decisions for seven bots in six live races:
   **median 2.51 s, 90th percentile 3.90 s, highest 4.15 s** of server time. None was late (over
   5 s), and **216 of 216 were valid JSON in the schema**. Each was about 960 prompt tokens in and
   73 out. The research estimate was 2.5 to 3.5 s.
2. **It stops when a write-up is running.** Ollama on this PC serves one request at a time. A
   decision asked during a write-up waited for the write-up to finish: **23.6 s and 29.8 s**, the
   write-ups' own lengths. Every window in that time would fall back to the seeded tactics.
3. **`think:false` takes effect in Ollama 0.40.16 for gemma4.** With it, 20 of 20 calls returned no
   thinking text. With `think:true`, 3 of 3 wrote 835 to 1 042 characters of thinking, used all
   400 output tokens, took 7.4 s, and **returned no valid decision**.
4. **Safety held under the most hostile moves.** A model that tells every bot to attack in every
   window was ridden through the real game ride. The trainer was sent exactly an ordinary ride's
   writes, with the draft off (D-2.1) and with it on, at the race's `k` (D-3.6). No bot went over
   its peak or under 0 W′, and every capacity stayed the one the seeded race built.
5. **Replay is exact.** A race is its seed plus its decision log. All six live races replayed to
   the same outcomes, and a replay of a replay matched to the bit.
6. **The model's races are different, and more aggressive.** With this prompt, bots attacked for
   **12 to 17 %** of the time on the flat (the seeded bots: 0 %) and **30 to 32 %** on the hills
   (seeded: 4 to 5 %). More moves got clear (67 against 20 over the six fields). The bots almost
   stopped following or chasing (1 to 3.5 %, against 1.4 to 33 %). Whether that feels more human is
   for the owner to judge on the tablet.

---

## 2. The machine, the software, and the method

- **Model server**: the owner's instance PC (Windows 11), NVIDIA RTX 3060 12 GB, Ollama
  **0.40.16**, `gemma4:12b` (digest `6114515d63c1`). Context 32 768, flash attention, `q8_0` KV
  cache, keep-alive 30 minutes, listening on `127.0.0.1` only.
  `OLLAMA_NUM_PARALLEL` is not set.
- **Client**: a development Mac. Each call runs `curl.exe` on the PC over SSH, the body on stdin,
  so Ollama is never exposed. **Every latency here is the server's own `total_duration`**, the time
  an instance calling Ollama on its own loopback would wait. The SSH leg is logged beside it
  (`wallMs`: median 3.70 s, 90th percentile 5.04 s, highest 5.34 s). It is left out of the latency,
  because a build would not use SSH.
- **The race**: #2561's harness setup, through the game's own race step (`stepLapRaceRide`, one
  20 Hz tick per call). Seven bots, `brisk` tier, 3 laps of a 628 m circuit, flat and with a 12 m
  rise and fall, seeds 1, 2 and 3, the draft on, the rider steady at 8 m/s and 200 W, 150 s ridden.
  `race.ts` is the loop.
- **The call** (`ollama.ts`): one batched `/api/chat` call every 4 s of race time. `stream:false`,
  `think:false`, `format` set to the decision's JSON Schema, temperature 0.6, a fixed seed per call,
  at most 400 tokens, and **no `tools` field**. The input (`model-input.ts`) has each bot's seat,
  style, rank, gaps, W′ share, whether it is drafting, its current move, laps and metres to the line,
  launch distance, grade ahead and the rider's gap, plus the rider's rank and W/kg. **It has no
  coordinate, no place name and no rider name.**
- **Race time against wall time**: the live loop pauses the race while it waits for an answer. It
  books the answer as arriving after its measured latency in race time, so the race sees the model
  exactly as slow as it was. Ticks are not paced in real time. A tablet would keep riding while the
  call runs, and the log records it the same way.
- Commands, all from `apps/web`:

  ```bash
  node tools/model-tactics-spike/run-live.mjs bench --host <ssh host>       # results/latency.json
  node tools/model-tactics-spike/run-live.mjs race flat --host <ssh host>   # results/flat-{1,2,3}.json
  node tools/model-tactics-spike/run-live.mjs race hilly --host <ssh host>  # results/hilly-{1,2,3}.json
  node tools/model-tactics-spike/run-live.mjs compare                          # results/comparison.json, no network
  ```

---

## 3. The design as built

- **Decision** (`decision.ts`): `{"bots":[{"bot":<seat>,"move":<one of the seven>,"target"?:"rider"|<seat>}]}`.
  **There is no watts field.** Any key that is not in the schema makes the whole answer invalid,
  so a model that writes `"watts": 900` is treated as having said nothing. A move outside the seven,
  a seat outside the field, a seat named twice, text that is not JSON, or more than 8 192
  characters is also invalid. The schema is enforced by the server and checked again on arrival.
- **Adapter** (`adapter.ts`): before the tick that opens a 1 s tactics window, it hands each bot
  the memory `decideTactic` would have written if it had chosen the model's move itself: that move,
  for this window. The tick then rides the move just as it rides a seeded choice, with the target
  power worked out from the race view and capped by `spendableWatts` at the bot's peak (and at CP
  once the bot is exhausted). **No shipped module was changed.** In each of the cases below, the
  bot keeps today's seeded choice for that window:
  - no decision is in force, or the decision does not name this bot;
  - the bot is inside its launch distance (**the sprint launch stays local**);
  - the bot is exhausted, or `attack` or `chase` would take it under the W′ floor (**the low-W′
    overrides stay local**);
  - the move is not open to the bot yet: a `kick` outside the launch distance, a `flyer` before the
    last two laps or under 0.6 W′, or an `attack` already held for 20 s;
  - the move is a `follow` or `chase` whose target is not the racer directly ahead.
- **Decision log** (`decision-log.ts`): each call is logged with the race time it was asked at and
  the race time its answer arrived at. A decision is applied at the first window that starts
  **after** it arrived, and holds until the next replaces it, or for 5 s at most. An answer that
  arrives more than 5 s after it was asked is logged as late and never applied. Replay reads only
  the log, so the seed plus the log is the whole race.

---

## 4. Latency

| Measurement | Calls | Median | 90th pct | Highest | Notes |
|---|---:|---:|---:|---:|---|
| **Live races, each call a new race state** | 216 | **2 507 ms** | **3 901 ms** | **4 151 ms** | prompt 953–1 023 tokens, output 65–184; 6 over 4 s, none over 5 s |
| The same prompt asked 20 times, model resident | 20 | 1 665 ms | 1 705 ms | 1 707 ms | the prompt is cached: a floor, not a race |
| `think:true`, the same prompt | 3 | 7 370 ms | | 7 377 ms | 400 of 400 output tokens, **0 valid** |
| Beside a write-up job | 2 | | | 29 754 ms | 23 605 ms and 29 754 ms. The two write-ups took 23 275 ms and 29 328 ms |
| Cold load (first call after the model was unloaded) | 1 | 10 851 ms | | | `load_duration` of the first probe call |

- **Why the same-prompt figure is lower.** One check: the same race state asked twice took 2 843 ms
  then 1 684 ms. On the second call 956 of its 961 prompt tokens were cached, and prompt evaluation
  fell from 1 119 ms to 429 ms. A state 4 s later took 2 927 ms with **0 cached tokens**, so even the
  fixed instructions at the front were not reused. Each race call costs about 1.1 s of prompt
  evaluation and 1.2 to 1.35 s of generation (about 55 to 60 tokens a second).
- **How old a decision is when applied.** The time from the ask to the window that applies the
  answer was a median of **3 s** and at most **5 s**. Every move is made on a race that is 3 to 5 s
  old.
- **Gaps.** When an answer arrives after the next 4 s mark, the next ask waits for the mark after
  that, and the previous decision expires after 5 s. Over the six races, 336 bot-windows (5.5 % of
  6 258) had no decision in force and fell back to the seeded tactics.
- **Beside a write-up.** The write-up here was a synthetic one, sized like a real one: about 6 000
  tokens of made-up ride notes in and up to 1 200 out, so no rider's data was sent anywhere. It is
  not the instance's own tool-calling job. The decision call queued behind it in both trials.
  `OLLAMA_NUM_PARALLEL=2` might change that, but it was not tried: changing the live instance's
  Ollama settings is not this spike's call, and two 32 768-token contexts on a 12 GB card are not
  obviously possible.

---

## 5. The harness comparison (seeded / model)

Each field was ridden twice: once with today's seeded tactics, and once from its live decision log.
The shares are of bot-ticks. A "move away" is an attack or flyer that got 5 m clear of the racer
behind it (#2561's reading).

| Field | attack % | flyer % | follow + chase % | moves away | changes / bot / min | lead changes | spread at end, m | lowest W′ | drafting at 30 s | rider's place |
|---|---|---|---|---|---|---|---|---|---|---|
| flat 1 | 0.0 / 11.9 | 20.6 / 2.7 | 11.7 / 0.9 | 1 / 7 | 0.80 / 1.83 | 22 / 8 | 2.2 / 5.7 | 0.93 / 0.77 | 6 / 6 | 8 / 8 |
| flat 2 | 0.0 / 15.0 | 20.3 / 3.2 | 2.1 / 1.5 | 0 / 11 | 0.57 / 2.57 | 21 / 6 | 2.2 / 4.2 | 0.95 / 0.68 | 6 / 6 | 8 / 8 |
| flat 3 | 0.0 / 16.9 | 20.3 / 1.7 | 1.4 / 3.4 | 0 / 2 | 0.46 / 2.51 | 22 / 8 | 2.3 / 3.9 | 0.95 / 0.63 | 6 / 6 | 8 / 8 |
| hilly 1 | 3.8 / 29.7 | 16.7 / 4.3 | 25.7 / 2.2 | 3 / 21 | 2.46 / 3.09 | 14 / 8 | 77.5 / 134.5 | 0.45 / 0.45 | 5 / 6 | 5 / 5 |
| hilly 2 | 4.2 / 32.3 | 15.7 / 0.5 | 21.7 / 1.7 | 7 / 14 | 1.89 / 2.86 | 10 / 10 | 112.8 / 157.7 | 0.49 / 0.43 | 6 / 6 | 5 / 6 |
| hilly 3 | 4.6 / 29.7 | 10.3 / 0.3 | 33.0 / 3.5 | 9 / 12 | 2.06 / 3.49 | 2 / 3 | 131.4 / 133.7 | 0.49 / 0.43 | 6 / 6 | 6 / 6 |

- **What the model asked for.** Over 1 512 named moves: `sit-in` 1 077, `attack` 370, `follow`
  45, `flyer` 17, `chase` 3, `kick` 0, `recover` 0. 46 moves named a target. Every call named all
  seven bots.
- **What the adapter did with it.** Of 6 258 bot-windows: 5 716 applied the model's move, 336
  had no decision in force, 157 fell back because a follow or chase named a racer who was not
  directly ahead, 43 because an attack had run its 20 s, and 6 because a flyer was not yet open. No
  move was refused for W′: the model never asked a bot under the floor to attack.
- **What it means.** The model's races are not the seeded race with noise added. On the flat they
  are a different race: the seeded field sits in and rolls the lead around (21 or 22 changes in
  150 s), while the model's field attacks off a stable front. Both still form a pack by 30 s, so
  #2561's pack criterion holds either way. The bots hardly follow or chase, which is the racecraft
  that closes moves down: more moves got away, and on the hills the field ends further apart.
- **What the 150 s does not reach.** The harness ends before the last 300 m, so no kick appears in
  either race. The launch override is held by `adapter.test.ts`, not by this table.

---

## 6. Safety, as tested

| Requirement (the issue's "must hold, tested") | Held by |
|---|---|
| No model output reaches the trainer: draft off, the trainer's writes are an ordinary ride's | `src/game/lap-race-wiring.test.tsx`, *"in #2616's model mode, every bot told to attack, … (D-2.1)"*: the real `GameView`, gradient driver and writer, with every bot told to attack in every window |
| … draft on, the trainer's writes are an ordinary ride's at the race's `k` | the same file, *"… with the draft on … (ADR 0067 D-3.6)"*, which also shows that the model's moves changed the `k` the rider rode at |
| `lap-race-cannot-reach-trainer.test.ts` unmodified | not changed by #2616. `spike-boundary.test.ts` runs the same walk over the spike's own modules |
| The spike is off the shipped path | `spike-boundary.test.ts`: no non-test module under `apps/web/src/` names the spike's directory |
| The model gets no tools | `model-input.test.ts`: the request body has exactly its seven keys, with no `tools` |
| No watts from the model | `decision.test.ts`: a `watts` key, or any other unknown key, makes the whole answer invalid. The schema offers only `bot`, `move` and `target` |
| Every move is capped by W′ and the fixed capacity | `adapter.test.ts`: all bots told to attack all race; no tick over peak or under 0 W′; each capacity is the one the seeded race built; the floor and the 20 s limit fired. `replay.test.ts`: the same on all six live logs |
| No coordinate or place name goes to the model | `model-input.test.ts`: none of the circuit's 64 positions' latitudes and longitudes, to 3 or 4 places, appears in the request body, and neither does a key named for a place or a bot's name |
| Late, invalid or illegal output falls back | `decision-log.test.ts` (late, invalid and failed calls apply nothing; a decision lapses after 5 s) and `adapter.test.ts` (every rule in §3) |
| With no instance or no consent, the whole race uses the seeded tactics | `adapter.test.ts`: an empty log rides today's seeded race **to the bit** |

**Not shown**: a model on the instance with decisions coming back through the one permitted module
(ADR 0036 D-3, #777). The spike calls Ollama from a development machine. A build needs the
instance route, the consent naming the endpoint (ADR 0046 D-9), and `no-network.test.ts` to keep
admitting exactly one module.

---

## 7. The pacer: report only

The lane allows no change to pacer behaviour, so nothing in §4 to §6 measured the pacer. From the
measurements above:

- **Latency (an estimate, not measured).** A pacer call is one entity, so its prompt is about a
  quarter of the bots' size. Its output, a plan and intent plus a short line of feedback, is about
  40 to 60 tokens. At this PC's measured rates of about 1.1 ms per prompt token and 55 to 60 tokens
  a second, that is roughly **1.5 to 2 s**. That estimate should be measured, not assumed.
- **Feedback is a new kind of output.** Model-written text on the ride screen, and spoken if the
  announcer's setting allows it, needs what the analysis write-ups already have: a length cap, a
  check that it is a sentence and not markup, and a fallback line when it is late or invalid. It
  also falls under CLAUDE.md §6's error-message rule: a sentence the model writes must never quote
  a coordinate. The input carries none (§2), which is what makes that hold.
- **The same contention applies.** A pacer call during a write-up waits behind it (§4). Feedback
  that arrives 30 s late is worse than none.
- **The patent flags.** The owner waived the pacer limits that rest on the patent flag for this
  spike (#92 criterion 6, ADR 0066 D-1.1, the '637 flag). **A pacer build needs a superseding ADR
  for those decisions, and the counsel opinion on US 2026/0249137 (#1234, due about 2027-01-15)
  should be read before a pacer build ships.**

---

## 8. What a build would need (no ADR is amended here)

- **ADR 0046 D-7** says nothing runs during a ride. A model race runs a model call every 4 s of
  the ride. The write-up contention (§4) is the same question from the other side: a build must
  either hold write-ups while a model race runs or measure parallel serving.
- **ADR 0046 D-9** requires the rider's consent naming the endpoint, for the local model and for
  any hosted one.
- **ADR 0067 D-6.2** says bots are pure seeded functions with no clock. They become pure functions
  of the seed **and the decision log**. The log, and the race time each answer arrived at, become
  stored race data. **A log replays only against the bot code it was recorded with**: a build must
  store a bot-code version beside the seed and the log. `replay.test.ts` deliberately does not
  hold replay equal to the live run, because any later tuning of the tactics would break it.
  `run-live.mjs compare` checked it at this commit: 6 of 6.
- **The pacer's limits**, waived above: a superseding ADR, after #1234's counsel opinion.
- **ADR 0060 D-2.1, D-2.2 and ADR 0067 D-3.6 need no change.** They held, tested, in model mode.

---

## 9. What would make this write-up wrong

- A different prompt. The attack-heavy races are this prompt's. A prompt tuned against the harness
  could make the model sit in more, or follow more.
- A loaded PC. The six races and the bench ran with the instance idle and no other GPU work. §4's
  write-up row shows what one concurrent job does.
- A different Ollama version or setting. `think:false` honoured, the prompt cache missing on a
  changed suffix, and serial serving are all 0.40.16 as configured on 2026-11-16.
- The race-time booking. A tablet riding in real time while the call runs sees the same latency.
  But the race state the model sees is the state when it was asked, which is 3 to 5 s old by the
  time its move is ridden (§4).

---

## 10. Addendum, 2026-11-16: the tuned prompt, re-measured (#2708)

Measured on the same machine as §2 on the same day, with the same Ollama 0.40.16 and
`gemma4:12b`, `think:false`. Ollama's settings on the PC were not changed. The bench unloaded
the model once, using the documented `keep_alive: 0` call with no messages, so that its cold row
is a real cold load. That is an unload, not a setting. The first run's files stay in `results/`.
This run's files are in `results/2708/`, and `replay.test.ts` replays both.

### 10.1 What changed

- **The input** (`model-input.ts`) adds five fields. Each bot gets `ahead` (who is directly
  ahead: `"rider"`, a seat, or `null` for the leader), `aheadMove` (that bot's move) and
  `secondsInMove` (whole seconds it has held its own move). The field gets `quietS` (seconds
  since any bot was attacking or on a flyer, or since the start, from `race.ts` §`quietSeconds`)
  and `attackOpen` (`quietS` of 30 or more). The same location test still passes: no
  coordinate, place or name.
- **The answer format** (`decision.ts` §`modelAnswerFormat`) offers no `target`. A `follow` or
  `chase` acts on whoever is directly ahead **when it is ridden**, 3 to 5 s after the ask. Of the
  first run's 46 aimed moves, 157 bot-windows fell back because by then the racer ahead was a
  different one. The parser still reads a target if one arrives, and the adapter still checks it.
  The adapter itself is unchanged.
- **The prompt** (`ollama.ts` §`MODEL_TACTICS_SYSTEM`) gives each move a condition the model can
  read straight off the input, using the input's field names. A new attack starts only when
  `attackOpen` is true, and only one bot starts it (a climber on a grade of 3 % or more,
  otherwise an attacker, with W′ 0.7 or more). A bot already attacking keeps going until 15 s and
  then sits in. A bot follows when the bot ahead is attacking or on a flyer within 50 m. A bot
  chases only from 30 m to 200 m back, and gives up after 20 s. Temperature (0.6), the per-call
  seed and the 400-token cap are unchanged.
- **How the tuning went.** There were five single-seed rounds before the full run. Without the
  `attackOpen` flag, the model started attacks inside a lull it was told the seconds of (at 4 s
  on the hilly circuit, and straight after another bot's attack). With the flag but no "keep
  going" sentence, every attack lasted one call. One over-strict wording had all seven bots sit in
  for the whole 150 s. Repeat calls are deterministic: the same seed and state gave the same
  answer.

### 10.2 The target, and why it is not the seeded rate

The seeded flat field never attacks (0 %). It rides flyers 20 % of the time, three bots at once
in lap 2, and passes the lead around 21 or 22 times in 150 s. Matching those rates would copy the
seeded race, not people racing. So the target set for #2708 is: **attacks and flyers together
under 10 % of bot-time on both circuits, separated by 30 s lulls, with one bot starting at a time;
sitting in and following as most of the time; and a chase only across a gap the draft does not
reach (30 m or more).**

### 10.3 The harness comparison (seeded / first prompt / tuned)

`results/2708/comparison.json` has the full numbers, and `results/comparison.json` has the same
columns for the first run, recomputed with no network.

| Field | attack % | flyer % | follow + chase % | sit-in % | moves away | lead changes | first move, s |
|---|---|---|---|---|---|---|---|
| flat 1 | 0.0 / 11.9 / 4.6 | 20.6 / 2.7 / 0.6 | 11.7 / 0.9 / 2.8 | 67.7 / 84.6 / 92.1 | 1 / 7 / 2 | 22 / 8 / 1 | 78 / 7 / 35 |
| flat 2 | 0.0 / 15.0 / 4.1 | 20.3 / 3.2 / 0.0 | 2.1 / 1.5 / 0.0 | 77.6 / 80.4 / 95.9 | 0 / 11 / 0 | 21 / 6 / 0 | 79 / 7 / 35 |
| flat 3 | 0.0 / 16.9 / 4.1 | 20.3 / 1.7 / 0.0 | 1.4 / 3.4 / 2.7 | 78.3 / 78.1 / 93.2 | 0 / 2 / 0 | 22 / 8 / 0 | 79 / 7 / 35 |
| hilly 1 | 3.8 / 29.7 / 7.1 | 16.7 / 4.3 / 0.2 | 25.7 / 2.2 / 4.0 | 53.8 / 63.8 / 85.6 | 3 / 21 / 5 | 14 / 8 / 3 | 0 / 0 / 0 |
| hilly 2 | 4.2 / 32.3 / 9.1 | 15.7 / 0.5 / 0.3 | 21.7 / 1.7 / 3.4 | 58.4 / 65.5 / 85.6 | 7 / 14 / 4 | 10 / 10 / 8 | 0 / 0 / 0 |
| hilly 3 | 4.6 / 29.7 / 9.7 | 10.3 / 0.3 / 0.0 | 33.0 / 3.5 / 6.9 | 52.2 / 66.6 / 81.8 | 9 / 12 / 3 | 2 / 3 / 0 | 0 / 0 / 0 |

- **Attacks are rare and mostly spaced.** Attacks and flyers together took 4.1 % to 5.2 % of
  bot-time on the flat and 7.3 % to 9.7 % on the hills, against 14.6 % to 34.0 % with the first
  prompt. On the flat the first move was asked for at 32 s in all three fields (ridden from 35 s),
  and the next one 40 to 50 s after the last ended, two or three in all. Each was asked for 12 to
  24 s. **In each flat field one bot made every attack.** On the hills the lull was broken three times: an attack was asked for 12 s after the
  last one ended (hilly 2 at 80 s, hilly 3 at 80 s) and once 4 s after (hilly 2 at 100 s). Of 218
  decisions, 211 told at most one bot to attack. The other 7 are all in
  the first 16 s on the hilly circuit: there the seeded climbers attack from the first tick (the
  "first move 0 s" column), and the model keeps those attacks going, as the prompt says.
- **Sitting in and following are most of the time:** 95 % to 96 % on the flat and 87 % to 89 % on
  the hills, against 77 % to 80 % and 74 % to 76 % seeded. Almost all of that is sitting in.
- **Chases follow real gaps.** The tuned run started two chases, across gaps of 94.5 m and
  134.7 m. The first prompt started a chase across 26 to 27 m on every flat field, inside the
  draft's reach. Seeded chases start from about 30 m.
- **Target-not-ahead fallbacks: 0**, down from 157. Every fallback left was a window with no
  decision in force (308 of 6 258, 4.9 %), plus one attack that had already run its 20 s.
- **What the model asked for**, over 1 526 named moves: `sit-in` 1 367, `attack` 96, `follow`
  38, `recover` 16, `chase` 9, `flyer` 0, `kick` 0.

### 10.4 Latency and validity, 218 race calls plus the bench

| Measurement | Calls | Median | 90th pct | Highest | Notes |
|---|---:|---:|---:|---:|---|
| **Live races, tuned prompt** | 218 | **2 714 ms** | **2 819 ms** | **4 202 ms** | **218 of 218 valid**, none late; prompt 1 254–1 331 tokens, output 67–181 (mean 75.6); 4 over 4 s |
| The same prompt asked 20 times, model resident | 20 | 1 456 ms | 1 505 ms | 1 552 ms | 20 of 20 valid, no thinking text |
| `think:true`, the same prompt | 3 | 6 939 ms | | 7 462 ms | 400 of 400 output tokens, 903–1 105 characters of thinking, **0 valid** |
| Beside a write-up job | 2 | | | 29 003 ms | 22 830 ms and 29 003 ms; the write-ups took 22 513 ms and 28 890 ms |
| **Cold load**, after an explicit unload | 1 | **11 276 ms** load | | **14 035 ms** total | `coldLoadMs` and `coldServerMs` in `results/2708/latency.json` |

- The prompt grew by about 300 tokens with the new fields, which adds about 0.2 s to the median.
  The 90th percentile fell from 3.9 s to 2.8 s because answers are more uniform: most are about 75
  tokens of seven moves with no target.
- The SSH leg (`wallMs`, not counted): median 3.91 s, 90th percentile 4.03 s, highest 5.38 s.
- The time from ask to applied was unchanged: a median of 3 s, at most 5 s.

### 10.5 Corrections to the body (#2705)

- **§1 item 1 and the §4 table: output tokens.** "73 out" is the bench prompt's figure, asked 20
  times. The 216 live race calls wrote 65 to 184 tokens, **mean 84.2** (median 73).
- **§4, the cold-load row.** The 10 851 ms came from a probe call that was not committed.
  `results/latency.json` holds `coldLoadMs: 21`, the load time of a model that was already
  resident. The committed measurement is now §10.4's: **11 276 ms** of load, 14 035 ms for the
  whole first call, in `results/2708/latency.json`.
- **§1 item 5 and §8: replay scope.** "All six live races replayed to the same outcomes" and "6 of
  6" were checked by `replayIsLive`, which compared only the **per-outcome counts** of the live
  run and the replay, not the race. That field is now `outcomeCountsMatchLive`, and it is still
  true for all six of the first run's logs at this commit. Those logs carry no trace, so their
  `traceMatchesLive` is `null`. #2708's logs carry a SHA-256 of the live run's whole trace (every
  racer's place, every bot's move, W′ and power on every tick). **All six replay to the live trace
  bit for bit** (`traceMatchesLive: true`).
- **The stale reference.** `ollama.ts` cited an `ollama.test.ts` that does not exist. The no-tools
  check is in `model-input.test.ts`, as §6 already said.

### 10.6 What this still does not do

- **The owner has not ridden either prompt.** "Races like people" here means these numbers. The
  tablet ride is #2706's step 5.
- **The tuned flat race is quiet.** The lead changed hands 0 or 1 times in 150 s on the flat,
  against 21 or 22 seeded, and no flyers were ridden. The first is what most of a field sitting in
  looks like. The second is a cost of the one-mover rule: lap 2 is where the seeded bots fly.
  Whether that feels flat on the tablet is the owner's call, and `MODEL_ATTACK_QUIET_SECONDS` is
  the first lever to try.
- **Following is still rarer than seeded on the hills** (3 % to 5 %, against 18 % to 23 %). The
  seeded bots follow the rider's own moves too. The input does not give the rider's move, because
  `aheadMove` is `null` when the rider is ahead.
- **One attacker per flat field.** The prompt says "an attacker", and the model took the same
  one each time. Naming who attacked last, or asking for a different bot, is the next thing to
  try.
- **Part of the timing is in the input, not the model.** `attackOpen` is computed, so the model
  chooses who goes and how long, but the lull is set by code. A build could equally keep the lull
  in code and ask the model only who goes.
