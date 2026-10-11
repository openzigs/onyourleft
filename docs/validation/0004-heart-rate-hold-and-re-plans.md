# Validation 0004 — the heart-rate hold, and re-plans during a ride

**Status:** procedure written, **not yet run**. Every result table below is empty on purpose.
**Written:** 2026-10-11, against `main` at `7b66ce98`, for
[#1246](https://github.com/openzigs/onyourleft/issues/1246).
**Discharges, when run:** the hardware half of
[ADR 0048](../adr/0048-workouts-that-change-during-the-ride.md) for
[#1240](https://github.com/openzigs/onyourleft/issues/1240) and
[#1241](https://github.com/openzigs/onyourleft/issues/1241) (Part A), and for
[#1243](https://github.com/openzigs/onyourleft/issues/1243) and
[#1244](https://github.com/openzigs/onyourleft/issues/1244) (Part B). Parent epic
[#1092](https://github.com/openzigs/onyourleft/issues/1092). The pending checks are listed on
[#733](https://github.com/openzigs/onyourleft/issues/733), the owner's one device-check list.

⚠️ **Part A can be run today. Part B cannot.** The hold is merged (#1240, #1241). The re-plan job
(#1243) and its device half (#1244) were both **open** on the day this was written, so Part B is
written from ADR 0048 D-4 to D-10 and from those two issues' own criteria, **not from code anybody
has run**. §"Before Part B" lists what has to be re-read against the merged code first.

---

## What this is, and what it is not

**It is a script for two sessions on the bike**: about 75 minutes for Part A and about an hour for
Part B, on the owner's trainer, heart-rate strap, tablet and instance.

**It is not an ADR and it decides nothing.** A result here describes one trainer's firmware, one
strap and one rider's heart on one day.

**It is not a test of whether the hold is good training.** It checks that every target the trainer
was sent stayed inside the envelope the owner approved (ADR 0048 D-3, rules H1 to H11), and that a
proposal from the instance could only change a block that had not started (D-4 to D-9, rules P1 to
P9). The unit and closed-loop tests already assert what is *sent* against a simulated trainer and a
simulated heart (`apps/web/src/ride/controller.test.ts` §"#1240",
`packages/sensors/protocol/src/heart-rate-hold.closed-loop.test.ts`). No test in the repository can
say what a real heart, a real strap or a real trainer does.

**It makes no claim about anybody's body.** A heart-rate number in this document is *the range the
rider chose*. It is never a limit and never a number for health (ADR 0048 D-12).

---

## ⚠️ Safety, and why the steps are in this order

CLAUDE.md §6: *a smart trainer applies physical resistance to a person who is pedalling.* The hold
changes that resistance **by itself**, every five seconds, which no earlier procedure here has
asked a rider to sit on.

1. **The issue lists Part A's steps 1 to 7 in the order it thought of them. They are run in a
   different order, and the reordering is the safety design**, as validation 0001 reorders #137's.
   The step numbers are the issue's; the run order is below.

   | Run | Step | Why here |
   |---|---|---|
   | 1st | **A7** | The hold is **off** for the whole step. It is an ordinary steady block, so it is the warm-up |
   | 2nd | **A1** | The hold runs, from a cold start |
   | 3rd | **A2** | The same ride carried on. The long one |
   | 4th | **A3** | Takes an input away. The target may only freeze or fall |
   | 5th | **A4** | Deliberately uncomfortable: the rider lets cadence collapse under ERG |
   | 6th | **A5** | Ends the ride |
   | last | **A6** | Leaves the trainer in a state nobody chose: its power is cut while it holds a target |

2. **Part B's steps are run B6, B1, B4, B2, B3, B5**, for the same reason: the switch off first
   (nothing may happen), the step that stops the instance late, and *Stop* last.
3. **Flat pedals, a low gear, seated, and the trainer's power switch within reach**, for every
   step. Do not clip in for A4 or A6.
4. **Read the stop condition before each step.** Every step has one, in its own column, and it is
   written to be checked from the saddle without reading a log.
5. **The one stop condition that applies to the whole of Part A:**

   > ⚠️ **Press *Stop* if the resistance rises while your heart rate is not under the range you
   > chose.** Then write down the time, the target the Ride screen showed and your heart rate
   > before doing anything else. That is the finding, and it is the highest-severity one here.

6. **And to the whole of Part B:**

   > ⚠️ **Press *Stop* if the target changes in the middle of a block and the screen's
   > heart-rate-hold sentence does not account for it.** A re-plan may only change a block that
   > has not started (P2).

7. ⚠️ **On the owner's trainer *Stop* does not remove an ERG target** (validation 0002 Part R,
   #372: an acknowledged `0x08` left the target applied, and the owner accepted that). So after A5,
   A6 and B5 be ready to stop pedalling and step off, and use the power switch if the load stays.

---

## What you need

| | |
|---|---|
| The trainer | The KICKR CORE validation 0002 used. Write the firmware down if the manufacturer's app shows it |
| A heart-rate strap | Heart Rate Service (`0x180D`), **worn**, electrodes wet. Paired on the Devices screen |
| The Pixel Tablet | A **debug** APK of current `main` (validation 0002 §"Before the session") |
| The Mac | `adb`, for the log |
| A watch or a phone clock | Showing seconds, set against the tablet's. Every row asks for a time |
| For Part B only | The owner's instance through the tunnel, the tablet signed in to it, and a model source for the re-plan job (ADR 0048 D-11) |

### The instruments

- **What the trainer was sent**: `adb logcat`, as Parts R and S of validation 0002 read it. A target
  is an FTMS **`0x05` Set Target Power**: the opcode, then the watts as a little-endian signed
  16-bit number. `05 96 00` is 150 W; `05 2c 01` is 300 W. A release is **`0x08`**; a request for
  control is **`0x00`**.

  ```bash
  adb logcat -G 16M
  adb logcat -c
  adb logcat -v time | grep --line-buffered -i "BluetoothLe" | tee hold-$(date +%H%M).log
  ```

- **What the trainer did**: the power the Ride screen shows, which is the trainer's own Indoor Bike
  Data.
- **Heart rate**: the Ride screen's reading from the strap.
- **What the app said**: the *Heart-rate hold* line in the workout panel on the Ride screen, which
  is one sentence from `apps/web/src/workout/hold-text.ts` followed by *"Range a–b bpm, target n W."*
- ⚠️ **The #111 recording `BluetoothPort` does not apply on the tablet.** It wraps the Web Bluetooth
  port and is reached from `capture.html`, which runs no workout. The Android shell writes through
  the Capacitor plugin, and logcat is its record. It applies only if Part A is repeated in Chrome on
  a laptop, which this procedure does not ask for.
- ⚠️ **The plugin's log names a notification and not its bytes** (validation 0002 Part AC), so the
  trainer's `80 05 01` acknowledgements are **not** readable. What is read is every write.

### The envelope for this session — work it out before riding

The numbers every row is judged against. Fill this in from the Analysis screen, the workout and the
Ride screen's Trainer panel before the first step.

| | Value | Where from |
|---|---|---|
| Own threshold power (W) | | Analysis screen. **Set, not the default** (H1) |
| Own threshold heart rate (bpm) | | Analysis screen. **Set, not the default** (H1). Must be **at least 135** for this session's range (H2) |
| Trainer's reported minimum and maximum (W) | | Ride screen, Trainer panel |
| The block's range | 125–135 bpm | The workout below |
| **Floor** (W) = the higher of 0.20 × threshold power, rounded up, and the trainer's minimum | | H3 |
| **Ceiling** (W) = the lower of 0.85 × threshold power, rounded down, and the trainer's maximum | | H3 |
| **Start** (W) = 0.55 × threshold power, rounded, held between floor and ceiling | | The workout below |

### The workout for Part A

Build it once on the Workouts screen and save it as **Hold check**:

| Block | Kind | Length | Fields |
|---|---|---|---|
| 1 | Heart-rate hold | 60 min | Starting target **55** % of threshold; Ceiling **85** % of threshold; Heart rate from **125** bpm, to **135** bpm |

One block on purpose: ADR 0048 D-3 scopes the hold to a workout block, and a one-block workout is
the whole code path. If 125–135 bpm is not an endurance range for the rider, choose another ten-beat
range under their threshold heart rate, write it in the table above, and read every "125" and "135"
below as its two ends.

---

## Part A — the hold

Start the log. Pair the trainer and the strap on the Devices screen, and take control on the Ride
screen.

### A7 — a rider without a threshold heart rate set (run first)

**Checks H1** (eligible only with the rider's own threshold power and heart rate) **and D-9** (the
fallback is the static workout).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A7.1 | On the Analysis screen, **write down** the threshold heart rate, then clear the box and save. Start *Hold check* on the Ride screen and ride 5 minutes at a steady cadence | The workout **starts**. The line reads *"Heart-rate hold is off: set your own threshold power and heart rate on the Analysis screen."* The log shows **one `0x05` at the start watts** and no other `0x05` for the five minutes | the resistance changes at all after the first ten seconds |
| A7.2 | *End workout*. Put the threshold heart rate **back** and save. Read it back on the Analysis screen | One `0x08`. The box shows the number written down | |

**Fails H1 if:** a second `0x05` with a different value appears in A7.1, read from the log; or the
workout refuses to start.

### A1 — settle into the range from a cold start

**Checks H3** (the envelope), **H4** (no heart-rate-driven change in the first 90 s), **H5** (one
decision every 5 s; up at most 5 W a decision and 15 W in any 60 s; down at most 10 W a decision)
and **H10** (at most one write per 5 s, and an unchanged whole watt is not rewritten).

Rest until heart rate is under 110 bpm, so the start is cold. Clear the log (`adb logcat -c`) and
note the clock.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A1.1 | Start *Hold check* and pedal at a steady cadence (80–90 rpm) for the first 90 s | **One `0x05` at the start watts**, and no other for 90 s. The line reads *"Riding the planned target while your heart rate settles."* | the target moves in the first 90 s |
| A1.2 | Keep riding until the line first reads *"Your heart rate is in the range you chose."* Note the time | From 90 s the target steps **up** while heart rate is under the range, and the line reads *"Target raised to bring your heart rate into the range you chose."* | the resistance rises while heart rate is **at or above 135** |
| A1.3 | Ride five more minutes | The target moves by a few watts at a time, or not at all. Heart rate stays inside 125–135 | as A1.2 |

**Fails if, read from the log:** any `0x05` above the ceiling or under the floor (H3); any `0x05`
other than the first inside 90 s of the start (H4); two consecutive `0x05` values rising by more
than 5 W or falling by more than 10 W (H5); the highest `0x05` in any 60 s more than 15 W above the
value in force when those 60 s began (H5); two `0x05` less than 5 s apart, or two in a row with the
same value (H10). **Fails from the saddle if** the target rose while the Ride screen showed a heart
rate of 135 or more.

### A2 — thirty minutes of drift

**Checks H3 and H5 over time**, and **H6** if it happens (a mean 10 bpm above the top of the range
for 30 s writes the floor once, held until heart rate has been back in the range for 60 s).

Carry straight on from A1 in the same ride. Do not stop between them.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A2.1 | Ride 30 minutes at a steady cadence. Every 5 minutes write down the clock, the target and the heart rate | As the heart drifts upward at a fixed power, the target **steps down** to keep it in the range: *"Target lowered to keep your heart rate in the range you chose."* Later targets are at or under earlier ones, give or take a few watts | the resistance rises while heart rate is at or above 135, or the target stays put with heart rate above 145 for a minute |
| A2.2 | **Only if it happens by itself** — do not chase it: heart rate at 145 or more for 30 s | **One `0x05` at the floor**, and the line reads *"Target at its lowest until your heart rate has been back in the range you chose for a minute."* No `0x05` above the floor until heart rate has been inside 125–135 for 60 s | the target does not drop |

**Fails if, read from the log:** any `0x05` above the ceiling (H3); any of A1's H5 or H10
observations; in A2.2, no floor write within 40 s of heart rate reaching 145, or a write above the
floor before the 60 s were up (H6).

### A3 — take the strap off for 30 seconds

**Checks H7** (fewer than two readings in 10 s freezes the target; after 15 s of silence it goes
back to the start watts, and is never raised while silent) **and H8** (a reading under 30 or over
230 bpm, or a jump of more than 40 bpm in 2 s, counts as silence).

Still the same ride. Note the target before starting; call it *T*.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A3.1 | Keep pedalling. Unclip the strap and hold it away from the skin for **30 s** by the clock | Within about 10 s the line reads *"No heart rate: the target will not go up until it is back."* and the target stops moving. After 15 s of silence: one `0x05` at the **start watts if that is lower than *T***, otherwise nothing. The Ride screen's heart-rate card shows **no number**, not a nought | the resistance rises at any point in the 30 s |
| A3.2 | Put the strap back. Ride 3 minutes | Once readings are back the line leaves *"No heart rate…"* and the hold carries on from the target in force. Steps obey A1's limits | the target jumps by more than 5 W upward in one step |

**Fails H7 if, read from the log:** any `0x05` during the 30 s with a value **above** the one
before it. **Fails H8 if** a rise follows a moment when the strap, half off, showed a reading that
could not be a heart rate. Write down anything the heart-rate card showed while the strap was off:
a strap in the hand can report nonsense, and that is exactly H8's case.

### A4 — stop pedalling: the rescue must win

**Checks H9** (while the stall rescue holds relief or the floor, the hold is frozen; afterwards it
resumes from the eased target) **and D-8** (the rescue is above the hold in precedence).

⚠️ **Deliberately uncomfortable**, exactly as validation 0002 S1 is. Do not clip in.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A4.1 | Stop pushing. Let cadence fall to nothing over 10–15 s and keep the legs still for 20 s. Do not stop the recording | Note the target first; call it *T*. A `0x05` at **two thirds of *T*** as cadence falls under about 50 rpm, then a `0x05` at the **trainer's minimum** at or under 10 rpm. **No `0x08`.** The screen shows the **Eased** notice. **No `0x05` above the rescue's value while the legs are still**, whatever the heart rate does. Power falls as the legs slow | the load holds or rises as the legs slow (use the power switch) |
| A4.2 | Pedal again and settle at 80–90 rpm. Ride 3 minutes | The rescue steps back from the minimum to **two thirds of *T***, and after about 8 s steady it lets go. The hold then carries on **from that eased number** in A1's steps: there is no write back to *T* | the target jumps to its old value in one step |

**Fails H9 if, read from the log:** any `0x05` between the rescue's floor write and the first pedal
stroke of A4.2 with a value above the trainer's minimum; or, after the rescue lets go, any single
rise of more than 5 W other than the rescue's own step from the minimum to two thirds of *T*.
Heart rate falls while the legs are still, which is precisely when a hold that was not frozen would
raise the target.

### A5 — *Stop* mid-hold

**Checks H11** (Pause, Stop and control lost behave exactly as before; the hold keeps no state past
its block) **and D-8** (`releaseTrainer` and *Stop* win over everything).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A5.1 | Wait until the line reads *"Target raised…"* or *"Target lowered…"*, so a decision is seconds away. **While still pedalling**, press *Stop* and confirm it | **Exactly one `0x08`.** The workout ends; it is not shown paused, and there is no *Control lost* | — you have already stopped. Step off if the load stays (Safety item 7) |
| A5.2 | Keep the log running for 60 s without touching the app | **No `0x05` after the `0x08`**, and no `0x00` | |

**Fails H11 if, read from the log:** more than one `0x08`; or any `0x05` timestamped after it.

### A6 — control lost: the trainer power-cycled (run last)

**Checks H11 and H4**: a lost link pauses the workout as it always has, nothing is written to a
trainer that is not there, and on resume the hold starts its 90 s settling again from the start
watts.

⚠️ **The last thing done in Part A.** Cutting the power while the trainer holds a target is the
step whose outcome nobody chose. Do not clip in. Start a new recording and *Hold check*, and ride
until the hold has left *"…while your heart rate settles."* Note the target; call it *T*.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| A6.1 | **Stop pedalling and take your feet off the pedals.** Switch the trainer off at its power switch. Wait 20 s | The Ride screen says the trainer's link is lost, and the workout is shown **paused**. **No write of any kind** in the log after the link dropped | |
| A6.2 | Switch the trainer on. Do whatever the app asks to get it back (pair again on Devices if it says so; take control on the Ride screen). Write down each thing you had to press | A `0x00` only when **you** ask for control. No `0x05` yet: the workout is still paused | a target is written before you press *Resume* |
| A6.3 | Start pedalling gently, then press *Resume*. Ride 3 minutes | **One `0x05` at the start watts** — not at *T* — and then none for 90 s; the line reads *"Riding the planned target while your heart rate settles."* After 90 s, A1's steps | the first target after *Resume* is above the start watts |

**Fails if, read from the log:** any `0x05` between the link dropping and *Resume* (H11); a first
`0x05` after *Resume* at any value but the start watts, or a second one inside 90 s of it (H4,
H11: the hold kept state it should not have).

### A results

**Trainer (make, model, firmware):** ______________ **Strap:** ______________
**Build (`main` at, installed when):** ______________ **WebView:** ______________
**Date:** ______________

| Step | Rules | Result (pass / fail / not run) | Time by the clock | `0x05` values seen, in order, with times | `0x08` / `0x00` seen | Heart rate and what the line said | Notes |
|---|---|---|---|---|---|---|---|
| A7.1 | H1, D-9 | | | | | | |
| A7.2 | H1 | | | | | | |
| A1.1 | H4 | | | | | | |
| A1.2 | H3, H5, H10 | | | | | | |
| A1.3 | H3, H5, H10 | | | | | | |
| A2.1 | H3, H5 | | | | | | |
| A2.2 | H6 | | | | | | |
| A3.1 | H7, H8 | | | | | | |
| A3.2 | H5, H7 | | | | | | |
| A4.1 | H9, D-8 | | | | | | |
| A4.2 | H9, H5 | | | | | | |
| A5.1 | H11, D-8 | | | | | | |
| A5.2 | H11 | | | | | | |
| A6.1 | H11 | | | | | | |
| A6.2 | H11 | | | | | | |
| A6.3 | H4, H11 | | | | | | |

| Reading | Value |
|---|---|
| **A1: time from the start to first entering 125–135 bpm** (min:s) | |
| A1: time from the start to the line first reading *"Your heart rate is in the range you chose."* | |
| A1: highest `0x05` written, against the ceiling | |
| A1 and A2: the largest single rise, and the largest rise inside any 60 s (W) | |
| A1 and A2: the shortest gap between two `0x05` writes (s) | |
| A2: target at 0, 5, 10, 15, 20, 25 and 30 min (W) | |
| A2: heart rate at the same times (bpm) | |
| A2: minutes of the 30 with heart rate inside the range | |
| A3: seconds from the strap coming off to the line changing | |
| A6: what the app asked for to get the trainer back | |

**H2 is not ridden here.** It is checked where it is enforced: build a hold block whose range tops
out above the threshold heart rate and start it, and the line reads *"Heart-rate hold is off: the
range you chose is above your threshold heart rate, so this block rides its planned target."* Record
it in Notes if you try it; it changes no resistance beyond A7's.

**Did the hold ever do something you did not expect, in your own words?** ______________

---

## Before Part B — what has to be true, and what to re-read

⚠️ **Do not run Part B from this page alone.** #1243 and #1244 were unmerged when it was written.
Before the session, whoever prepares it re-reads the merged code and corrects this part **in the
same pull request that fills in its results**:

- [ ] #1243 and #1244 are merged, and #1245's wording is the owner-approved one.
- [ ] The **name and place of the per-ride switch**, of *Keep the plan*, and the **sentences** a
      rider sees for an accepted move. They are quoted below from the issues' examples, not from a
      wording module.
- [ ] How a **re-plan job is told apart** in the instance's `analysis_job` table (B6 counts them).
      On the day this was written that table had no job-type column: `id`, `athlete_id`, `status`,
      `source`, `template_version`, `input_json`, `ride_id`, `candidate`, `failure`, `created_at`,
      `ended_at` (`apps/instance/src/store/schema.ts` §`AnalysisJobTable`).
- [ ] Where **P9's record** of accepted and refused moves is read on the device after the ride.
- [ ] The job's **budget** (#1243 proposes 45 s) against P2's 30 s and P5's 60 s, so B2's two ways
      of being late still make a proposal late.
- [ ] The instance runs the build under test (`bash apps/instance/deploy/home/deploy.sh`), `/ready`
      answers through the tunnel, and the tablet is signed in to it.

### The workout for Part B

Six blocks, so there are five boundaries and no block is the last by accident. Save it as
**Re-plan check**:

| Block | Kind | Length | Target |
|---|---|---|---|
| 1 | Steady (warm-up) | 5 min | 50 % of threshold |
| 2 | Heart-rate hold | 6 min | Start 55 %, ceiling 85 %, 125–135 bpm |
| 3 | Steady | 6 min | 65 % |
| 4 | Steady | 6 min | 65 % |
| 5 | Steady | 6 min | 65 % |
| 6 | Steady (cool-down) | 5 min | 45 % |

**The loaded workout's own peak share is 85 %** (the hold's ceiling) **and 65 % for a steady
block** — P3's bound for a harder move. Write the watts for each block, at the rider's threshold,
beside the table before riding: every row below is judged against them.

Set typed goals on the device that leave room for a move (ADR 0048 D-10): a total duration **longer**
than 34 minutes, and a power ceiling at or above 85 %.

### Reading the instance

The count of jobs, before and after a step. Take a snapshot and count in it, so nothing reads the
live database:

```bash
# On the machine that runs the instance. `backup` is the operator's online snapshot.
# It writes into OYL_BACKUP_DIR on the host, where the `backup` service keeps its own.
docker compose -f apps/instance/deploy/home/compose.yaml exec -T backup \
  node src/operator/cli.ts backup /backups
# Then, with any SQLite client, on the newest snapshot's database file in OYL_BACKUP_DIR:
#   SELECT id, status, failure, created_at, ended_at FROM analysis_job ORDER BY created_at;
```

⚠️ That command was **not run** for this document; the service name and the `backup` verb are read
from `apps/instance/deploy/home/compose.yaml` and `docs/operating-an-instance.md`. Correct it under
"Before Part B" if it does not work as written.

---

## Part B — re-plans, on the owner's instance through the tunnel

Start the log as in Part A. Every step also keeps Part A's stop condition: the hold is still
running in block 2.

### B6 — the switch off (run first)

**Checks P7** (off unless switched on for this ride) **and D-10** (nothing leaves the device).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B6.1 | Count the instance's jobs (above). Start a recording and *Re-plan check* with the re-plan switch **left as it comes** — do not touch it. Ride blocks 1 to 3, about 17 minutes | The switch is **off** without having been touched. Every boundary's `0x05` is the loaded block's own watts. Nothing about a re-plan is shown or said | the target changes mid-block outside the hold |
| B6.2 | *End workout*. Count the instance's jobs again | **The same count.** No row was added | |

**Fails P7 if:** the second count is higher than the first, read from the instance's job table; or
any boundary's `0x05` differs from the loaded plan's watts.

### B1 — a proposal accepted at a boundary

**Checks P1** (a move from the closed list), **P2** (never the current block; applied from the next
boundary), **P3** (never above the loaded workout's own peak, the goal's ceiling or the machine's
maximum), **P4** (one accepted move per 3 min; +5 % per harder move) and **P9** (kept with the
ride).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B1.1 | Start a recording and *Re-plan check*. **Switch re-plans on** for this ride. Ride from block 1 | At a boundary a summary goes to the instance. If a move comes back in time and is accepted, **one sentence** names the move and the reason, for example *"Next block shortened by 2 minutes, because your heart rate stayed above your range."*, and *Keep the plan* appears. **The current block's target does not change**: no `0x05` between the sentence and the boundary, other than the hold's own in block 2 | the target changes before the boundary (Part B's stop condition) |
| B1.2 | Do **not** press *Keep the plan*. Ride through the boundary | At the boundary, the next block is the **changed** one: its `0x05` is the device's own arithmetic for the move the sentence named, and at or under the peak written beside the table. A shortened or extended block ends when the sentence said it would | the new block's target is above the loaded workout's peak for its kind, or above your goal's ceiling |
| B1.3 | Ride on to the end, and *End workout* | At most one accepted move in any 3 minutes. The cool-down is the loaded one, unshortened | |
| B1.4 | After the ride, read P9's record on the device | One entry per move accepted or refused: the move, the rule that decided, the time | |

**Fails if:** any `0x05` in the block that was current when the proposal arrived differs from that
block's plan (P2), read from the log; a boundary `0x05` above the loaded peak for that block kind,
the goal's ceiling or the trainer's maximum (P3); two accepted moves less than 3 minutes apart, or a
harder move of more than 5 % (P4); a move the sentence named that is not in D-4's list, or any text
on screen that reads like a model's and not like the app's (P1); a move with no entry in the record
(P9).

⚠️ **No proposal at all is not a failure of this step.** The model may propose nothing, and a
budget that runs out ends in *no proposal* (#1243). Ride the workout again. Record how many rides it
took; if three rides produce none, record that as the finding and what the job table's `failure`
column said.

### B4 — *Keep the plan*

**Checks D-7** (one control reverts a pending re-plan before its boundary).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B4.1 | As B1.1, until a move is announced | As B1.1 | as B1.1 |
| B4.2 | Press ***Keep the plan*** before the boundary. Ride through it | The next block is the **loaded** one: its `0x05` is the plan's own watts and it runs its own length. The control goes away. The press itself writes nothing | the next block is the changed one |

**Fails D-7 if:** the boundary `0x05`, or the block's length, is the proposed one and not the
loaded one; or the press produced a write.

### B2 — a proposal arriving late is dropped

**Checks P2** (a move must arrive at least 30 s before the boundary) **and P5** (a proposal older
than 60 s is refused). Opposite to `camera/useAnalysis.ts`, where a late answer still wins.

Two ways to make one late; do at least the first.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B2.1 | **Older than 60 s.** Re-plans on. Just after a boundary, have the instance's containers **paused** for 70 s and then resumed (`docker compose -f apps/instance/deploy/home/compose.yaml pause instance`, then `unpause`), so the answer to that boundary's summary comes back late | **Nothing changes and nothing is said**, or one short line at most. The next boundary's `0x05` is the loaded plan's. *Keep the plan* never appears | the target changes mid-block |
| B2.2 | **Inside 30 s of the boundary.** Ride a copy of the workout whose middle blocks are **45 s** long | Any answer that takes more than 15 s lands inside the last 30 s and is dropped: every boundary's `0x05` is the loaded plan's | as above |

**Fails P2 or P5 if:** any boundary `0x05` differs from the loaded plan's after a late answer, read
from the log; or a re-plan sentence is shown for a proposal that arrived late. The job table should
show the job itself **succeeded** — the instance answered; the device refused it.

### B3 — the instance stopped mid-ride

**Checks P8 and D-9** (any failure leaves the plan as it is, and says nothing or one short line at
most) **and ADR 0036 D-3(a)** (nothing that works with no instance starts to need one).

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B3.1 | Re-plans on, riding block 2 with the hold running. Have the instance **stopped** (`docker compose -f apps/instance/deploy/home/compose.yaml stop instance`). Ride through two boundaries | The ride carries on. **The hold keeps working** in block 2. Each boundary's `0x05` is the loaded plan's. At most one short line says re-plans are not available. **No write is caused by the failure**: no `0x05` at the moment the instance went, no `0x08`, no `0x00` | the target changes at the moment the instance stops, or the workout pauses or ends |
| B3.2 | Have the instance started again. Ride through one more boundary | Either re-plans carry on at the next boundary or they stay off for the ride; **record which**. No burst of requests: at most one job in flight (the job table shows no cluster of rows at the restart) | |

**Fails P8 if:** any write in the log coincides with the instance stopping; the workout paused or
ended; or more than one short line was shown.

### B5 — *Stop* with a proposal in flight (run last)

**Checks D-8** (the release wins; a pending re-plan is discarded) and #1244's *stop wins*.

| Step | What to do | What should happen | ⚠️ Stop if |
|---|---|---|---|
| B5.1 | Re-plans on. Ride to a boundary. **Within 10 s after it**, while the summary's job is still running, press *Stop* and confirm | **Exactly one `0x08`**, and **no `0x05` after it** for 60 s. Nothing about a re-plan is shown afterwards | — step off if the load stays (Safety item 7) |
| B5.2 | Count the instance's jobs and read the newest row | The job in flight is **`cancelled`**, not left `running` | |

**Fails D-8 if:** any `0x05` is timestamped after the `0x08`; or a re-plan sentence appears after
*Stop*. A job left `running` or ending `succeeded` is a finding against #1244's cancel, and it
caused no write.

### B results

**Instance (build, where it runs, model source):** ______________
**Trainer, strap, tablet build:** ______________ **Date:** ______________
**Job-table count before the session:** ______________

| Step | Rules | Result (pass / fail / not run) | Time by the clock | Boundary `0x05` values: loaded plan → seen | The sentence shown, word for word | Job-table rows added, and their `status` / `failure` | Notes |
|---|---|---|---|---|---|---|---|
| B6.1 | P7 | | | | | | |
| B6.2 | P7, D-10 | | | | | | |
| B1.1 | P1, P2 | | | | | | |
| B1.2 | P2, P3 | | | | | | |
| B1.3 | P3, P4 | | | | | | |
| B1.4 | P9 | | | | | | |
| B4.1 | D-7 | | | | | | |
| B4.2 | D-7 | | | | | | |
| B2.1 | P5 | | | | | | |
| B2.2 | P2 | | | | | | |
| B3.1 | P8, D-9 | | | | | | |
| B3.2 | P8 | | | | | | |
| B5.1 | D-8 | | | | | | |
| B5.2 | D-8 | | | | | | |

| Reading | Value |
|---|---|
| B1: rides it took to get one accepted move | |
| B1: seconds from a boundary to the sentence appearing (the round trip, as a rider sees it) | |
| B1: the move, the reason, and the watts the device computed for the changed block | |
| B1: P9's record, copied out | |
| B2.1: how late the answer was (s), and what the device showed | |
| B3: the one line shown while the instance was stopped, word for word | |
| B6: job-table count before and after | |

**Did a re-plan ever feel like the app deciding for you mid-effort, in your own words?**
______________

---

## After the session

1. Save both logs. They name the trainer's Bluetooth address; do not commit them.
2. Copy the answers into the tables above, in a pull request that changes nothing else but the
   corrections "Before Part B" asks for.
3. Tick Parts A and B on #733, or say there which step failed.
4. **A failed step is its own issue**, filed with the row and the log excerpt, labelled as trainer
   control. A target above the ceiling, a rise during silence, a write after *Stop* and a change to
   the current block are each a safety finding, not a tuning note: the envelope's numbers are the
   owner's recorded decisions (ADR 0048 D-3), and changing one is an amendment to that ADR.

## What this procedure cannot establish

- **That the hold suits another rider or another trainer.** One heart, one strap, one KICKR.
- **That a trainer acknowledged a target**: the plugin's log carries writes, not the control
  point's answers. Power following the target is the evidence that it was honoured.
- **That the trainer lets go on *Stop***. On this trainer it does not (#372), and A5, A6 and B5
  check what was *sent*.
- **Anything about a model's judgement.** B1 checks that a proposal stayed inside its bounds, not
  that it was a good idea (ADR 0048 D-5 says the same of the validator).
- **Part B, until it has been re-read against merged code.** Its control names, its sentences and
  its job-table query describe a design.
