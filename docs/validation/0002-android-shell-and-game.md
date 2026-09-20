# Validation 0002 — an Android phone, the shell, and the game on a trainer

**Status:** procedure written; **partly run on 2026-09-18** — see *What the 2026-09-18 session
established* below. Every result cell that is still empty is still unrun, and the ones that are
filled in say which session filled them.
**Written:** 2026-09-09, against `main` at the merge of #224, with
[#226](https://github.com/openzigs/onyourleft/pull/226) open. **Part H added 2026-09-17** by
[#341](https://github.com/openzigs/onyourleft/issues/341), which owes the measurement in it.
**Part L added 2026-09-18** by [#364](https://github.com/openzigs/onyourleft/issues/364), which is
the part that would have caught [#362](https://github.com/openzigs/onyourleft/issues/362) and did
not exist to. ⚠️ **It is `L` rather than the `K` it was drafted as**, because #349's Part K was
already here and a part letter in this file is a safety control rather than a label: the ordering
rule, the power-switch instruction and the do-not-clip-in instruction below are all keyed to it, so
two parts sharing a letter makes each of those instructions ambiguous even when every sentence in it
is individually correct.
**Discharges, when run:** [#87](https://github.com/openzigs/onyourleft/issues/87) criteria 2, 3, 5
and 6 and its two-OEM line; the Android half of
[#85](https://github.com/openzigs/onyourleft/issues/85); and
[ADR 0008](../adr/0008-mobile-client-architecture.md) decision D-2's rendering gate, **which was
waived rather than passed** (see its 2026-09-08 amendment).

---

## What this is, and what it is not

**It is the companion to [0001](0001-trainer-and-sensors.md), not a replacement.** 0001 validates
the sensor and trainer clients from a laptop over Web Bluetooth. This one validates the **Android
shell**: the same web build inside a WebView, reaching the same trainer through a different
transport.

⚠️ **Run 0001 first, on the same trainer.** Part D writes to a control point over the Capacitor
path. If the trainer misbehaves there and 0001 has not been run, you cannot tell a bug in
`apps/mobile/src/ble/` from a trainer that does that anyway. 0001 establishes the trainer's own
behaviour; this establishes that Android reproduces it.

**It is not an ADR and it decides nothing.** Like 0001 and like a spike, it is dated and it ages.
`ADR00*` rules are scoped to `docs/adr/` and do not apply.

---

## ⚠️ Safety

The same rule as 0001, for the same reason — CLAUDE.md §6: *a smart trainer applies physical
resistance to a person who is pedalling*.

1. **Parts A, B, C and E to K write nothing that changes resistance.** They run first.
2. ⚠️ **Parts L and D are last, in that order**, and they are the only two that change what a rider
   feels. **L (simulation mode) before D (ERG)**, because L's resistance follows a road the rider can
   see coming and D's is a number somebody typed — and D's own steps are ordered so the one that
   leaves the trainer in an unknown state (D4, a mid-ERG disconnect) is the last thing done all day.
   ⚠️ **This list used to read "Part D is last" and name four parts as safe; a reviewer who
   remembers that is reading the old file.** Part L is new
   ([#364](https://github.com/openzigs/onyourleft/issues/364)) and the whole document had no
   simulation-mode step before it — which is why an afternoon spent filling in Part D truthfully
   would have left every cell green and the game sending nothing (#362).
3. **Have the trainer's power switch within reach for Parts L and D.**
4. **Do not clip in for D4, and do not clip in for L5.** Flat pedals or bare feet, or stand beside
   the bike. ⚠️ **`L5`, not `K5`** — Part K is #349's rendering measurement and its own K5 asks for
   a ride with no cadence sensor, which changes no resistance at all.
5. ⚠️ **L3 asks for the steepest section of the route.** Ride it seated and in a low gear, and
   choose a route whose maximum gradient you already know — `RouteProfile` carries it, the route
   screen shows it, and a 20 % wall arriving under a rider who expected 6 % is the failure mode this
   ordering exists for.

> ⚠️ If a finding in 0001's T7 was that the trainer keeps applying resistance after the link drops,
> **D4 tells you nothing new and should be skipped.** Repeating a known-dangerous behaviour over a
> second transport is not evidence, it is a second chance to get hurt.

---

## What the 2026-09-18 session established

Ridden on Android against a real FTMS trainer on a real route, by the owner. It is recorded here
rather than in an issue thread because this is the file that keeps device findings, and because
[#364](https://github.com/openzigs/onyourleft/issues/364)'s fifth criterion is that what *has*
happened is written down rather than left pending a future session.

**Established:**

| What | Evidence |
|---|---|
| The BLE link streams **Indoor Bike Data** over the Capacitor path | **252** `BluetoothLe` notification lines in `adb logcat` over one ride, every one from service `00001826-…` (FTMS) |
| The HUD renders from it | power, cadence, speed, gradient, to-go, pacer gap and wind all shown and moving |
| Frame pacing holds up under a real ride | see **Part F results**, filled in from this session |
| The display-unit switch (#238) works on a device | changed on the Settings screen; every screen read in the new units |

⚠️ **And the thing it established by its absence, which is the reason this section exists at all:**
the same log holds **252 inbound notifications and zero writes**. Nothing was ever sent to the
trainer. That is [#362](https://github.com/openzigs/onyourleft/issues/362) — the game computed a
gradient, drew the hill, put the number on the HUD and never told the machine — and **no step in
either validation document would have caught it**, because Part D is four ERG steps and 0001's T1
records only whether the feature bits *offer* gradient. **Part L is that step.**

**Not established, and previously easy to read as established:**

| What | Why not |
|---|---|
| **Part B, every step** | ⚠️ The session exercised **one** peripheral — the trainer. B1–B4 are all about *two* links, overlapping writes and 40 connect/disconnect cycles, and none of them was run. B's results table is still empty and is not made less empty by a ride that worked |
| Anything written to the trainer | Zero writes. Part D and Part L are both unrun |
| The two-OEM line | One phone |
| Background recording, the thermal run, the scenery parts | Not attempted |

---

## What you need

| | |
|---|---|
| An Android phone, API 30+ | API 30 is the floor for `getThermalHeadroom()`; the app's `minSdkVersion` is 24 |
| **A second Android phone from a different OEM** | #87's Definition of Done says *tested on at least two OEMs*. One phone leaves that open |
| A USB cable and `adb` | `platform-tools` is installed; `adb devices` must list the phone |
| Developer options + USB debugging | On the phone. `adb` sees nothing without it |
| The trainer and sensors from 0001 | Part D needs the trainer; Part B needs at least two peripherals |
| A bike on the trainer, and ~60 minutes of pedalling for Part E | Part E is a *sustained* run; there is no short version of it |
| A fan | Part E is a thermal measurement. A fan changes the result — so decide before you start whether you are measuring the phone in still air or in a rider's actual airflow, and **write down which** |

---

## Before the session

```bash
nvm install && nvm use
corepack enable pnpm
pnpm install --frozen-lockfile

# The shell wraps apps/web's build. cap sync copies nothing if nothing is built.
pnpm --filter @onyourleft/web run build
pnpm --filter @onyourleft/mobile exec cap sync android

export ANDROID_HOME="$HOME/Library/Android/sdk"   # or wherever sdkmanager put it
cd apps/mobile/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The build was first run on 2026-09-09 and produces `app-debug.apk` (~4.9 MB);
`apps/mobile/README.md` §5 records what that first run found.

⚠️ **This is a debug build and it is not signed for release.** #95 owns the release pipeline and
`REL001` bans committing key material. Nothing here needs a release build, and producing one to
"test properly" would be the step that puts a keystore on somebody's laptop.

---

## Part A — install, launch and permissions (#87 criterion 8, and criterion 2's declaration)

The merged manifest was asserted from the build on 2026-09-09 and is **not** re-checked here — see
`apps/mobile/README.md` §5. What a device adds is what a *rider* sees.

| Step | What to do | What should happen |
|---|---|---|
| A1 | Launch the app with Bluetooth **off** | The permission notice explains it — not an empty device list. #87 criterion 8 |
| A2 | Launch with Bluetooth on, **deny** the permission prompt | An explanatory screen, again not an empty list |
| A3 | Grant, then pair a sensor | The device list populates |
| A4 | ⚠️ Check **Settings → Apps → On Your Left → Permissions** | **Location must not be listed as requested** on API 31+. This is the rider-visible form of criterion 1, and the whole point of the `tools:replace` overrides |
| A5 | Start a recording; pull down the notification shade | A **"Recording ride"** notification, from the `connectedDevice` foreground service. This is the half of criterion 2 a build cannot show |
| A6 | ⚠️ **[#230](https://github.com/openzigs/onyourleft/issues/230).** With Bluetooth on and the permission **not yet granted**, press "Pair a heart rate strap" | The Android **permission prompt appears** — pairing is what asks for it, because `initialize()` now runs on this path. It must **not** report *"no device was chosen"*, which is what a rider was told when the stack was never initialised |
| A7 | ⚠️ **[#230](https://github.com/openzigs/onyourleft/issues/230), the one that says it is fixed.** Grant the permission, press Pair again | The **native device chooser appears**. `adb shell dumpsys window \| grep mCurrentFocus` leaves `MainActivity`; `adb logcat` carries **no** `Bluetooth LE not initialized.` |
| A8 | Cancel that chooser | On screen: *"no device was chosen"* — and only here. A cancellation is the one failure that may still say so |

⚠️ **A6–A8 are #230's last acceptance criterion and nothing in CI can stand in for them.** The bug
was found by installing the APK and pressing the button while four gates were green: the scripted
plugin double allowed a chooser before `initialize()`, the typecheck saw an implemented method, the
build succeeded, and the browser gate never constructs the Capacitor transport. The fixture now
refuses the out-of-order call and the transport initialises on the pairing path — but *"a device
reaches a chooser"* is a sentence only a device can write. Until A7 is filled in, the fix is
**asserted and unobserved**.

### A results

| Step | Phone 1 (OEM, model, Android version) | Phone 2 |
|---|---|---|
| A1 | | |
| A2 | | |
| A3 | | |
| A4 | | |
| A5 | | |
| A6 | | |
| A7 | | |
| A8 | | |

---

## Part B — the BLE link on Android (#87 criteria 5 and 6)

| Step | What to do | What should happen |
|---|---|---|
| B1 | Pair **two** peripherals and subscribe to both | Both stream. This is the shared-characteristic seam that shipped two defects (README §4) |
| B2 | Drop one subscription; watch the other | The other **keeps streaming**. That is defect (1) from README §4, on a real stack |
| B3 | **Criterion 5** — trigger two overlapping writes | Both complete. The plugin's `queue()` was read but never exercised |
| B4 | **Criterion 6** — 40 connect/disconnect cycles | Connection **40** still succeeds. Log each; the failure mode is gradual |

⚠️ **B4 is tedious and is the point.** #87 asks for 40 because Android BLE stacks degrade over
repeated cycles rather than failing outright, and a run of five proves nothing.

⚠️ **The 2026-09-18 session exercised ONE peripheral, so B1–B4 all remain unrun**
([#364](https://github.com/openzigs/onyourleft/issues/364)). That session established the link
streams Indoor Bike Data from a trainer over the Capacitor path — 252 notifications from service
`0x1826` — and **every step in this table is about something else**: B1 and B2 are the
shared-characteristic seam that shipped two defects and need *two* peripherals subscribed at once,
B3 is overlapping writes on a queue that has still never been exercised, and B4 is the fortieth
connect/disconnect cycle. A ride that worked with one strap-free trainer is not partial credit
against any of them, and the results table below stays empty to say so.

### B results

| Step | Phone 1 | Phone 2 | Notes |
|---|---|---|---|
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B4 | cycle reached: | cycle reached: | |

---

## Part C — background recording (#87 criterion 3)

```bash
# Before: confirm the service is up and typed.
adb shell dumpsys activity services dev.openzigs.onyourleft | grep -iE "RecordingService|foreground"

# Start a recording, then background the app and lock the screen.
adb shell input keyevent KEYCODE_HOME
adb shell input keyevent KEYCODE_POWER

# ... 60 minutes ...

adb shell dumpsys activity services dev.openzigs.onyourleft | grep -iE "RecordingService|foreground"
```

| Step | What to do | What should happen |
|---|---|---|
| C1 | Record 60 minutes backgrounded, screen off | The ride is **continuous** — no gap, no truncation |
| C2 | `dumpsys` at the end | The service is still running and still `connectedDevice` |
| C3 | Return to the app and finish the ride | It saves, and the sample count matches the elapsed time |

⚠️ **Criterion 4 is not in this table and cannot be.** *"Killing the renderer does not stop
recording"* is **not satisfiable as specified** in a Capacitor shell — the recorder is
`packages/domain`'s state machine running as JavaScript in the WebView, so the renderer *is* the
recorder. `RecordingService.java`'s header says so. Do not improvise a test for it; changing that
is an ADR.

### C results

| Step | Phone 1 | Phone 2 |
|---|---|---|
| C1 | duration recorded: | |
| C2 | | |
| C3 | samples / elapsed: | |

---

## Part D — trainer control over the Capacitor path ⚠️ run last

This is the Android counterpart of 0001's Part B. Everything that decides *what may be written* —
`createTrainerControl`, the bounding, the quantisation, the feature gating — is the same
platform-free code on both transports (CLAUDE.md §4h). **What is different is only the write**, so
these steps target that.

| Step | What to do | What should happen |
|---|---|---|
| D1 | Open the fitness machine and take control | Supported ranges are read **from the device**, as on the laptop. Compare to 0001's numbers — they must match |
| D2 | Set an ERG target and hold 3 minutes | The trainer holds it. Compare to 0001's T4 |
| D3 | Set a target the trainer will refuse (outside its range) | Reported as **rejected**, not silently dropped. This is the acknowledged-write path — `port.write`, never `writeWithoutResponse` |
| D4 | ⚠️ **Off the bike, lowest target.** Disconnect mid-ERG | Whatever happens, **write it down before doing anything else**. Skip if 0001's T7 already found the trainer keeps applying resistance |

⚠️ **D3 is the one that matters most and is easiest to skip.** `fitness-machine-channel.test.ts`
asserts the unacknowledged sibling stays uncalled, but only a real device proves the acknowledgement
is *read*. A rejected command reported as accepted is the failure mode that puts a rider against a
load nothing told them about.

### D results

| Step | Result | 0001's equivalent | Match? |
|---|---|---|---|
| D1 | | T1 | |
| D2 | | T4 | |
| D3 | | T2 | |
| D4 | | T7 | |

---

## Part E — the rendering gate (ADR 0008 D-2, #91's third criterion)

**This gate was waived, not passed.** ADR 0008's 2026-09-08 amendment records that; #91's
60-minute measured run on the device floor is still outstanding. This part is that run.

### ⚠️ Read this before planning the measurement

**`getThermalHeadroom()` is not wired up, and the procedure works around it rather than around the
truth.** `apps/web/src/game/quality.ts` takes `thermalHeadroom` as an optional field of
`QualitySample` and documents it as *"Android's own forecast — `PowerManager.getThermalHeadroom()`,
API 30+"*. **Nothing in `apps/mobile` provides it.** `apps/mobile/src/index.ts` exports the BLE
transport and the permission notice and nothing else; there is no thermal port implementation.

Two consequences, both of which shape this part:

- In the shipped app `thermalHeadroom` is always `undefined`, so `nextQuality` degrades on **frame
  timing alone** (`FRAME_MS_REDUCE_ABOVE = 45`, `SUSTAINED_SAMPLES = 30`). The
  `HEADROOM_REDUCE_ABOVE`/`HEADROOM_RESTORE_BELOW` hysteresis **cannot fire at all**.
- ⚠️ CLAUDE.md §4h describes the thermal port as having "Capacitor implementations in
  `apps/mobile`". For the foreground service that is true; **for thermal headroom it describes the
  design and not the tree.**

So thermal state is measured **externally, with `adb`**, which needs no app change:

```bash
adb shell dumpsys thermalservice | grep -iE "Temperature|status|mThermalStatus"
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -A4 "Janky"
adb shell dumpsys battery | grep -iE "temperature|level"
```

Sample all three every five minutes for the hour.

| Step | What to do | What to record |
|---|---|---|
| E1 | Note the starting state | battery %, battery temp, thermal status |
| E2 | Start a ride on a route with the game visible; pedal | — |
| E3 | Every 5 min for 60 min | the three `adb` readings, plus the quality level the HUD is showing |
| E4 | Watch for a quality drop | **when** it first dropped, and to which level |
| E5 | Note whether it ever recovered | `HEADROOM_RESTORE_BELOW` cannot fire; a frame-timing recovery can |
| E6 | ⚠️ Read the HUD in sunlight, phone on the bars | Is it legible at a glance? #94's contrast is gated in CI, **legibility at arm's length in daylight is not** |
| E7 | Note battery % at the end | A rider needs the ride to outlast the phone |

### E results

| Minute | Battery % | Battery temp | Thermal status | Janky % | Quality level |
|---|---|---|---|---|---|
| 0 | | | | | |
| 5 | | | | | |
| 10 | | | | | |
| 15 | | | | | |
| 20 | | | | | |
| 25 | | | | | |
| 30 | | | | | |
| 35 | | | | | |
| 40 | | | | | |
| 45 | | | | | |
| 50 | | | | | |
| 55 | | | | | |
| 60 | | | | | |

**Still air or fan?** ______________  **Phone (OEM, model, Android):** ______________

---

## Part F — frame pacing ([#323](https://github.com/openzigs/onyourleft/issues/323))

**This is the one criterion of #323 that no gate in this repository can discharge**, and it is the
criterion the issue says mattered most: *"A green modern figure said nothing here; the legacy one
and a human's eyes both did."* Everything else about #323 is asserted in the Vitest suite; this is
the part that needs a phone with a trainer in front of it.

### What was measured before the fix

Pixel Tablet, Android 17, debug build, `dumpsys gfxinfo` over a 12-second window during a ride,
2026-09-16 — the numbers in #323's body, repeated here so the re-measurement has a baseline beside
it rather than in an issue tracker:

| | Before |
|---|---|
| Total frames rendered | 756 in 12 s ≈ 63 fps |
| Janky frames (modern) | 0 (0.00 %) |
| **Janky frames (legacy, > 16 ms)** | **714 — 94.44 %** |
| Frame time 50th / 90th / 95th / 99th | 24 / 26 / 27 / 28 ms |
| GPU time 50th / 90th | 6 / 9 ms |
| Missed Vsync | 0 |

### ⚠️ Read this before planning the measurement

- **The modern jank figure was 0.00 % while the world was visibly stepping.** It counts frames that
  missed their deadline, and none did: the loop presented 63 fps of *duplicates*. **Record both
  figures or the measurement says nothing.**
- **A low GPU time is not good news here.** 6 ms against a 16.7 ms budget is what "the renderer is
  waiting on a simulation with nothing new to say" looks like, and it is why #323 is not a
  performance fix and why nothing in `quality.ts` was touched for it.
- **The fix trades 50 ms of display latency for smoothness** — one fixed step — because the frame is
  drawn *between* the last two simulation states and never ahead of the newest.
  `apps/web/src/game/simulation.ts` §`DrawnRide` says so. If a rider reports the world feeling
  *behind* their pedalling rather than stepping, that is this trade and it belongs in F5.

```bash
# Reset the counters, ride for a measured window, then read them.
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible and the rider pedalling ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

| Step | What to do | What to record |
|---|---|---|
| F1 | Start a ride on a route with the game visible; pedal steadily | — |
| F2 | Reset the counters, ride a 12-second window, read them back | every row of the table below |
| F3 | Repeat F2 with a bot pacer on the road | the same rows again, and whether the bot steps |
| F4 | ⚠️ Watch the world, not the numbers | Does it **move**? One sentence in your own words |
| F5 | Watch for the opposite complaint | Does the world feel *behind* the pedals? @see the note above |
| F6 | Repeat once the phone is warm — 20 minutes in | whether the answer to F4 changed |

### F results

**Run 2026-09-18** ([#364](https://github.com/openzigs/onyourleft/issues/364)), on a real trainer on
a real route, over a **15-second** window rather than the 12 the command above uses — so the frame
*count* is not directly comparable with the before column and every rate and percentile is.

| | Before (2026-09-16, 12 s) | After (2026-09-18, 15 s, F2) | After (F3, with pacer) |
|---|---|---|---|
| Total frames rendered | 756 ≈ 63 fps | **911 ≈ 61 fps** | |
| Janky frames (modern) | 0 (0.00 %) | 0 | |
| **Janky frames (legacy, > 16 ms)** | **714 — 94.44 %** | **0.11 %** | |
| Frame time 50th / 90th / 95th / 99th | 24 / 26 / 27 / 28 ms | **13 / 14 / — / 16 ms** | |
| GPU time 50th / 90th | 6 / 9 ms | **7 / —** | |
| Missed Vsync | 0 | **0** | |

⚠️ **Read the legacy row and not the modern one**, which is the whole lesson of the note above: the
modern figure was 0.00 % *before* the fix, while the world was visibly stepping. **94.44 % → 0.11 %**
is what #323 bought, and it is the row a future regression is compared against.

⚠️ **F3 was not run** — no bot pacer was on the road — so the third column is empty and stays empty.
⚠️ **F6 was not run either**: there is no reading from a phone twenty minutes warm.

**Does the world move rather than step (F4)?** Yes — the session reported the ride reading as
smooth, which is the answer #323 says settles it.

**Does it feel behind the pedals (F5)?** Not reported. The 50 ms trade `simulation.ts` §`DrawnRide`
describes was not raised as a complaint, which is weaker than a "no" and is recorded as what it is.

**Phone (OEM, model, Android):** not recorded ⚠️ — record it next time; a frame-pacing figure
without a device beside it cannot be compared with anything. **Build:** `main` at 4bfee83

⚠️ **A legacy jank figure that is still high is not automatically a failure now.** It counts frames
over 16 ms of wall time, and a loop that is idle between vsyncs can produce one. What settles #323
is F4: whether a person watching the screen sees a world that moves. Record the numbers anyway —
they are what a future regression would be compared against.

---

## Part G — the availability check on a phone that has slept ([#322](https://github.com/openzigs/onyourleft/issues/322))

**The cause is settled and is recorded here rather than left in an issue thread**, because #322's
fifth acceptance criterion is a re-run on an unlocked device and this is the file that keeps device
findings. What is *not* settled is whether the fix behaves on a phone, which is what G1–G5 are for.

### What was measured, and which of the two causes it was

Pixel Tablet · Android 17 · Chrome 151 WebView · debug build at `362d0867` ·
`@capacitor-community/bluetooth-le` as pinned in the lockfile, driven over CDP through
`adb forward`. Two runs on 2026-09-16.

**Run 1, device PIN-locked.** The Devices screen showed *"Checking: Asking this phone about
Bluetooth"* and *"Waiting for the check to finish"* at 0 s, 5 s, 15 s, 30 s and 45 s, unchanged.
`adb logcat` carried exactly two lines mentioning the callback id, both outbound; nothing resolved
it. Bluetooth was **on**, `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` were both **granted**, there was
no pending permission dialog and there were no JS exceptions. The run flagged its own confound: the
tablet was locked throughout (`mDreamingLockscreen=true`) and could not be unlocked.

**Run 2, device unlocked** (`mDreamingLockscreen=false`, screen on,
`stay_on_while_plugged_in=2`). ⚠️ **It still hung** — same five polls, same text. **The lockscreen
was not the cause and is struck from this issue.** The cause is upstream, from the device's own
stack trace:

```
Caused by: java.lang.NullPointerException:
  Attempt to invoke virtual method 'void com.getcapacitor.PluginCall.resolve()'
  on a null object reference
    at com.capacitorjs.community.plugins.bluetoothle.BluetoothLe.runInitialization(BluetoothLe.kt:156)
    at com.capacitorjs.community.plugins.bluetoothle.BluetoothLe.checkPermission(BluetoothLe.kt:137)
...
at androidx.lifecycle.ReportFragment$LifecycleCallbacks.onActivityPostStarted(ReportFragment.kt:121)
at android.app.Activity.performStart(Activity.java:9422)
```

The plugin holds the `PluginCall` to resolve after its permission check; on an **activity start** it
runs `checkPermission` → `runInitialization` with that reference **null**, throws, and therefore
never resolves. So the answer to "which of the two causes was it" is: **the plugin call itself, not
the lockscreen.**

**What does not trigger it**, measured so nobody re-treads it:

| Path | Result |
|---|---|
| Cold start (`force-stop`, then launch) | ✅ resolves — *"✓ Bluetooth is available"* |
| Background with HOME, wait 4 s, return (same pid) | ✅ resolves, no NPE |
| Reload the page 3× **during** an in-flight check | ✅ resolves, no NPE |
| Long-running instance across a **Doze + screen-off + lock** cycle | ❌ **hangs, NPE** |

### What was changed, and what still needs a phone

The plugin defect is upstream and is **not** fixed here. What #322 changed is that this program
stops depending on an answer: `apps/web/src/support/shell-support.ts` §`SHELL_ANSWER_TIMEOUT`
bounds what the rider waits, and `apps/mobile/src/ble/transport.ts` §`INITIALIZE_ANSWER_WINDOW`
stops sharing an unanswered `initialize()` so that the re-check reaches the plugin. Both are
asserted in the Vitest suite against a plugin double that never answers; neither has been seen on a
device.

| Step | What to do | What should happen |
|---|---|---|
| G1 | Reproduce the hang: leave the app running, let the tablet sleep and lock, wake it, open Devices | Within ~10 s the screen stops saying "Checking" and reads **"This phone has not answered about Bluetooth"** |
| G2 | Read the whole notice | It says **nothing has been refused**; it does **not** name a permission, a switched-off radio, or a phone with no Bluetooth |
| G3 | Press **Check again** | `adb logcat` shows a **second** outbound `initialize` with a **new** callback id. This is `INITIALIZE_ANSWER_WINDOW` doing its job; a repeat of the first id means the memo is still being shared |
| G4 | Note whether that second call answers | Expected to, on the evidence that a cold start does — but it is the one step of this part that is a prediction rather than a measurement |
| G5 | With the app in this state, leave it and come back (HOME, then return) | The check **re-runs by itself** on the return, without the rider pressing anything. This is the lifecycle half: a timer armed before the activity stopped may be suspended, so the return is the trigger |
| G6 | Separately: launch with the permission **not** granted, and take **longer than 10 s** over Android's dialog | The "has not answered" message appears **and is then replaced** by the real answer when the dialog is finally answered. A screen still saying "has not answered" after a grant is a defect |

### G results

| Step | Phone 1 (OEM, model, Android version) | Phone 2 |
|---|---|---|
| G1 | | |
| G2 | | |
| G3 | callback id reused? | |
| G4 | | |
| G5 | | |
| G6 | | |

⚠️ **G3 is the one that cannot be read off the screen.** A "Check again" that re-attaches to the
dead promise and a "Check again" that reaches the plugin and is ignored look identical to a rider —
both end on the same message. Only the callback id in logcat tells them apart, which is why the
step asks for it rather than for a verdict.

---

## Part H — what the scenery models cost the GPU ([#341](https://github.com/openzigs/onyourleft/issues/341))

**#341 replaced five generated solids with models from the CC0 pack
[ADR 0022](../adr/0022-game-scenery-model-pack.md) names, and this is the measurement it owes and did not
make.** Nobody in the loop that wrote it has an Android device, so the tables below are empty in the
same way every other table in this file is: the procedure is written, the result is not claimed.

⚠️ **Read this before treating a green figure as good news**, because it is the trap Part F already
records in its own words: *"A low GPU time is not good news here. 6 ms against a 16.7 ms budget is
what 'the renderer is waiting on a simulation with nothing new to say' looks like."* Six
milliseconds was measured over a scene of six instanced **primitives**. The GPU column is the one
models are most likely to move, and it is the one that has stayed flat through every change so far.

### The baseline, and where it actually lives

⚠️ **It is not in this repository.** ADR 0022 checked this rather than assuming it: the only real
device measurement of the game is in a **comment on
[#323](https://github.com/openzigs/onyourleft/issues/323)**, dated 2026-09-16, and Part F's own
result table — the repository's record — is still empty. So #341's *"re-measured against #246's
committed baseline"* describes a baseline that is not committed, and #302's *"GPU 7 ms median"* is a
figure that reads **6**.

| | Before #341, Pixel Tablet, 2026-09-16 |
|---|--:|
| Frame time 50th | 13 ms |
| GPU time 50th | 6 ms |
| Janky frames (legacy, > 16 ms) | 0.00 % |

### What is known without a device, so that the measurement starts from something

Measured in the browser gate (`game.browser.spec.ts` §"the scenery is models, not solids"), on a
desktop software rasteriser, 2026-09-17 — **vertex indices submitted for one instance of each
kind**, as a solid and then as a model:

| Kind | As a solid | As a model | Model |
|---|--:|--:|---|
| `tree-broadleaf` | 108 | 342 | `tree_default.glb` |
| `tree-conifer` | 36 | 234 | `tree_pineTallA.glb` |
| `shrub` | 60 | 96 | `plant_bush.glb` |
| `rock` | 24 | 240 | `stone_largeA.glb` |
| `building` | 36 | **2 310** | `building-type-h.glb` |
| `post` | 60 | 60 | — (ADR 0022 D-3 leaves it alone) |

⚠️ **The building is the one to watch, and the worst case is arithmetic rather than a guess.**
`SCATTER_MAX_ITEMS` is 240 and a belt reserves that for **every** kind, so a stretch of route that
is all buildings submits 240 × 770 ≈ **185 000 triangles** a frame where it used to submit 2 880.
The floor rung of `QUALITY_LADDER` drops to 60 items, which is a quarter of that. Nothing here says
whether either is affordable on the device floor; that is what H2 is for.

| Step | What to do | What to record |
|---|---|---|
| H1 | Ride the same route Part F was measured on, game visible, pedalling steadily | — |
| H2 | Reset the counters, ride a 12-second window, read them back | every row of the table below |
| H3 | Ride a stretch with buildings beside the road, if the route has one | the same rows again |
| H4 | ⚠️ Look at it | Do the trees read as trees? One sentence in your own words |
| H5 | Repeat H2 once the phone is warm — 20 minutes in | whether the rung changed, and the rows again |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible and the rider pedalling ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### H results

| | H2 (ordinary route) | H3 (buildings) | H5 (warm) |
|---|---|---|---|
| Total frames rendered | | | |
| Janky frames (modern) | | | |
| **Janky frames (legacy, > 16 ms)** | | | |
| Frame time 50th / 90th / 95th / 99th | | | |
| GPU time 50th / 90th | | | |
| Missed Vsync | | | |

**Do the trees read as trees (H4)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **What a bad result means is already decided, so nobody has to decide it while tired.** ADR 0022
§"What would make this ADR wrong" says: *"If #341's re-measurement moves the GPU column materially
at the floor, the answer is D-3 in reverse: fewer kinds get models, starting with the ones with
least silhouette."* On the table above that is `shrub` first and `building` last.

---

## Part I — does the scenery still read as a village? ([#348](https://github.com/openzigs/onyourleft/issues/348))

**#348 is the one item in this file whose acceptance criterion is a sentence rather than a number**,
and the issue says so itself: *"This is judged by eye, on the device. The numbers said the models
were free and they were — what they could not say is that the result looks like a village."* So this
part is deliberately half a look and half a counter read-back, and the look comes first.

Nobody in the loop that wrote #348 has an Android device, so the tables below are empty in the same
way every other table in this file is.

### What changed, and what it predicts

| | Before #348 | After |
|---|--:|--:|
| Grid period | 10 m | 20 m |
| Things per cell, per side | 4 | 7 |
| Nearest thing to the centreline | 5 m | 9.5 m |
| Furthest | 21 m | 44.5 m |
| Jitter along the cell | 1.25 m | 14 m |
| Stretches with nothing beside them | none | about a quarter of a route |
| `SCATTER_MAX_ITEMS` | 240 | **240 — unchanged, and #348 forbids changing it** |

Measured on the synthetic fixtures in `scatter.test.ts` rather than on a device: a 460 m view of a
sea-level temperate route carried **about 330** items on every stretch of road; it now carries
**between 13 and 255** depending on where the clustering falls, with a median near 140.

⚠️ **What that predicts for the GPU column is "nothing, or a little less", and the reasoning is
arithmetic rather than hopeful.** A frame can never carry more than `SCATTER_MAX_ITEMS`, which did
not move, so the worst case is exactly what it was; the typical case is roughly half of it. Working
against that, the cull now submits a **larger share** of what it is handed — 100 % of a straight
route's scenery where it submitted 98.3 %, because `SCATTER_LATERAL_METRES` grew with the band — so
the per-frame instance count is bounded above by the same 240 and is usually well below it. **If the
GPU or frame column moves at all, that is the finding**, exactly as #348 says.

⚠️ **The table above describes #348 and three issues have moved it since, so read it as dated
rather than as current.** #351, #353 and #355 each moved one of its rows: the grid is back to 12 m,
a cell holds 5 rather than 7, and since [#355](https://github.com/openzigs/onyourleft/issues/355)
the nearest thing to the centreline is **6.5 m** rather than 9.5 m and the furthest **21.5 m**
rather than 44.5 m. **I2 is the step that reads on the changed number**, and it is the one to take
most carefully: #355 narrowed the verge *because* a 6 m one puts the near band outside the camera's
own cone, so the question it asks — whether anything is close enough to feel like a hedge — is now
the question the change could plausibly have got wrong.

⚠️ **#355's own verification asks for the frame budget against #246's baseline, and the section
above records that that baseline is not in this repository.** What can be said without a device:
the number of instances drawn per frame **did not move at all**, because
`SCATTER_MAX_ITEMS` still binds on every frame of the digest sweep in
`arrangement-unchanged.test.ts` — 7 680 items over 32 frames, before and after — and the cull
submits *less* of a hairpin than it did rather than more (52.4 % against 55.1 %, measured in
`three-renderer.test.ts`). The issue's worry that more items survive the cull is therefore the
opposite of what was measured. **That is an argument and not a measurement**, and I5 and I6 remain
the measurement.

| Step | What to do | What to record |
|---|---|---|
| I1 | ⚠️ **Ride the route and look at it.** Before touching a counter | Does it read as open road with things beside it, or as a continuous village? One sentence in your own words |
| I2 | Look at the verge specifically — how close does the nearest thing come as it passes? | Whether anything is close enough to feel like a hedge |
| I3 | Ride until a bare stretch and then a wooded one | Whether the change between them reads as a place changing or as a bug |
| I4 | Ride a tight bend, if the route has one | ⚠️ Whether anything is standing **in the road**. This is the one that is a defect rather than a taste |
| I5 | Reset the counters, ride a 12-second window, read them back | every row of the table below |
| I6 | Repeat I5 on a stretch that is *wooded*, where the budget binds | the same rows again |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible and the rider pedalling ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### I results

| | I5 (ordinary stretch) | I6 (wooded stretch) |
|---|---|---|
| Total frames rendered | | |
| **Janky frames (legacy, > 16 ms)** | | |
| Frame time 50th / 90th / 95th / 99th | | |
| GPU time 50th / 90th | | |
| Missed Vsync | | |

**Does it still read as a village (I1)?** ______________

**Is anything standing in the road on a bend (I4)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **A screenshot before and after belongs on the pull request**, and #348 asks for one. Neither was
taken: this environment has no device and no emulator, and a desktop browser at a different aspect
ratio is not the thing the owner looked at. The pair to take is the same stretch of the same route,
at the same point, on the same phone.

---

## Part J — is there anything standing beside the road at all? ([#351](https://github.com/openzigs/onyourleft/issues/351))

**Part I was never run, and #351 is what happened instead.** #348 merged, the owner rode it on the
tablet, and the scenery was *gone*: one house and one tree, both on the horizon, over an otherwise
empty plain. Part I's predictions above are a record of what #348 expected and are **superseded** by
this part — they are left standing because a prediction that turned out wrong is worth more than a
prediction quietly corrected.

⚠️ **Read Part I's own last paragraph first.** It says a screenshot before and after belongs on the
pull request and that neither was taken. That is the gap #351 names in one sentence: *"the gap was
that no screenshot was taken after merging, only before."* This environment still has no device and
no emulator, so the same gap is still open, and this part is still the thing that closes it.

### What changed, and what it predicts

| | Before #348 | #348 | **#351** |
|---|--:|--:|--:|
| Grid period | 10 m | 20 m | **12 m** |
| Things per cell, per side | 4 | 7 | **5** |
| Nearest thing to the centreline | 5 m | 9.5 m | **9.5 m — kept** |
| Furthest | 21 m | 44.5 m | **34.5 m** |
| Jitter along the cell | 1.25 m | 14 m | **6.6 m** |
| Stretches with nothing beside them | none | about a quarter | **about a seventh** |
| `SCATTER_MAX_ITEMS` | 240 | 240 | **240 — unchanged, and #351 says so too** |

Measured on the synthetic fixtures in `scatter.test.ts` rather than on a device — a 12 km level
temperate route, ridden at 100 positions 100 m apart, each frame the 460 m span `scene.ts` asks for:

| | Before #348 | #348 | **#351** |
|---|--:|--:|--:|
| Items in the nearest **60 m** of road | 42.9 | 21.3 | **32.3** |
| Frames with **nothing** in that 60 m | 0 in 100 | 15 in 100 | **6 in 100** |
| Items offered per frame, before the budget | ~330 | 161.9 | **245.2** |
| Frames where the budget actually binds | every one | 11 in 100 | **62 in 100** |
| Median distance from the centreline | 12.0 m | 27.2 m | **21.6 m** |

⚠️ **The fourth row is the one nobody was watching.** `thin` returns its input untouched when the
supply is inside the budget, so between #348 and #351 `SCATTER_NEAR_BIAS` — the thing that keeps the
*near* half of the view populated when there is more world than budget — did nothing on 89 frames in
100. Density and that bias are not independent: below the budget there is no bias.

⚠️ **What this predicts for the GPU column is "a little more than #348, no more than before it"**,
and the reasoning is the same arithmetic Part I used. A frame still cannot carry more than
`SCATTER_MAX_ITEMS`, which still has not moved, so the worst case is unchanged for the third time;
what moved is how often the worst case is reached, from "every frame" to "one in nine" to "three in
five". Working the other way, the cull now submits a slightly *smaller* share of what it is handed
on a hairpin — 55.1 % where #348 submitted 43.9 % — because the band is shallower, so fewer
instances are built per frame than the raw count suggests. **If the GPU or frame column moves at
all, that is the finding.**

| Step | What to do | What to record |
|---|---|---|
| J1 | ⚠️ **Ride the route and look at it.** Before touching a counter | Is there anything beside the road in the foreground, or is it an empty plain with things on the horizon? One sentence in your own words |
| J2 | Compare against the screenshot taken before #348, if one survives | Whether this is nearer the village or nearer the plain |
| J3 | Ride until a bare stretch and then a wooded one | Whether the open ground reads as open ground rather than as a world that failed to load |
| J4 | Ride a tight bend, if the route has one | ⚠️ Whether anything is standing **in the road**. Still the one that is a defect rather than a taste |
| J5 | Reset the counters, ride a 12-second window, read them back | every row of the table below |
| J6 | Repeat J5 on a stretch that is *wooded*, where the budget binds | the same rows again |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible and the rider pedalling ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### J results

| | J5 (ordinary stretch) | J6 (wooded stretch) |
|---|---|---|
| Total frames rendered | | |
| **Janky frames (legacy, > 16 ms)** | | |
| Frame time 50th / 90th / 95th / 99th | | |
| GPU time 50th / 90th | | |
| Missed Vsync | | |

**Is there scenery in the foreground (J1)?** ______________

**Nearer the village or nearer the plain (J2)?** ______________

**Is anything standing in the road on a bend (J4)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **The screenshot pair is still owed, and #351 says which one is missing: the "after" has to be
the merged state.** Take it on the phone, on the same stretch of the same route, once this has
merged — not from the pull request's branch and not from a desktop browser, which is a different
aspect ratio and a different distance from the eye.

---

## Part K — what the rider on a bicycle costs ([#349](https://github.com/openzigs/onyourleft/issues/349))

**#349's fourth acceptance criterion in its own words**: *"Re-measured on the device against #246's
baseline (GPU 7 ms, frame 13 ms, legacy jank 0.00 %). This is the change most likely to move them,
and a regression here is a finding, not a detail."*

⚠️ **Read Part H's §"The baseline, and where it actually lives" first.** It records that #246's
committed baseline is not in fact committed — Part F's results table is empty, and the numbers #349
quotes come from a comment on [#323](https://github.com/openzigs/onyourleft/issues/323). They are
repeated in Part H and are the row to compare against until somebody fills Part F in.

### What changed, and what it predicts

| | before #349 | after |
|---|---|---|
| What the rider is | one `SphereGeometry(0.9, 12, 8)` | a bicycle and a body, merged, plus a crankset and four leg segments |
| Draw calls, whole rider | 1 | **3** |
| Draw calls, scenery-free frame | 4 | **6** |
| Triangles, whole rider | 192 | about 1 100 |
| Per-frame work | none | ⚠️ two assignments, one rotation, and — **only when the cranks have moved** — four matrix composes and one instanced-buffer upload |
| Materials | one per marker | ⚠️ one for the whole rider, because the colours are vertex data |

⚠️ **What this predicts for the GPU column is "nothing measurable", and the reasoning is worth
stating so that a surprise is a finding.** #341 added five models — one of them 2 310 vertex
indices, instanced across dozens of items — and the frame budget did not move. The rider is **one**
object of about 1 100 triangles at one depth, filling a small share of the frame, and two extra draw
calls against a scene that already issues ten. The plausible cost is on the **CPU** rather than the
GPU: four `Matrix4.compose` calls and a 256-byte buffer upload on every frame the cranks turn, which
is every frame of every ride with a cadence sensor on it.

⚠️ **The measurement that is NOT worth making here is a pixel comparison.** ADR 0009 forbids deriving
a reference image from another product, and there is no earlier one to compare against. What a
person can say, and what K1–K3 ask, is whether it reads as a cyclist from the chase camera.

### K — the rider, by eye and by number

| Step | What to do | What to record |
|---|---|---|
| K1 | Start a ride on any route and look at the middle of the frame | Does it read as a cyclist on a bicycle, from 8 m behind and 3 m above? |
| K2 | Pedal with a cadence sensor connected, and watch the cranks | Do they turn at the rate the HUD's Cadence field shows? Do the legs follow them? |
| K3 | Stop pedalling, and then disconnect the cadence sensor | Do the cranks stop, rather than carrying on at the last rate? |
| K4 | Ride a bend | Does the bicycle stay pointed along the road, or does it face an axis? |
| K5 | ⚠️ Ride with **no** cadence sensor paired at all — a power meter only | The cranks should not move. Is a still bicycle worse than the sphere was, or better? This is the one design decision in #349 that a person has to judge |
| K6 | 12 s of riding with the game visible, at the target rung | the rows below |
| K7 | Repeat K6 on the **floor** rung, if the ladder reaches it | the same rows again |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible and the rider pedalling ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### K results

| | #323's baseline | K6 (target rung) | K7 (floor rung) |
|---|--:|--:|--:|
| Total frames rendered | | | |
| **Janky frames (legacy, > 16 ms)** | 40.63 % | | |
| Frame time 50th | 13 ms | | |
| GPU time 50th / 90th | 6 / 9 ms | | |
| Missed Vsync | | | |

**Does it read as a cyclist (K1)?** ______________

**Do the cranks match the HUD's cadence (K2)?** ______________

**What happens with no cadence sensor, and is it acceptable (K5)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **A screenshot belongs here, and it has to be of the MERGED state** — Part J's own last paragraph
says why, and #351 is what happened when one was taken only before. Take it on the phone, on the
same stretch of the same route, once this has merged.

---

## Part L — simulation mode over the Capacitor path ⚠️ run last but one, before Part D

Added 2026-09-18 by [#364](https://github.com/openzigs/onyourleft/issues/364). **This is the part
whose absence let [#362](https://github.com/openzigs/onyourleft/issues/362) ship.**

Part D is *"trainer control over the Capacitor path"* and all four of its steps are **ERG**, which is
the *workout* feature. The **game** drives — or is supposed to drive — **simulation mode**, through
[#90](https://github.com/openzigs/onyourleft/issues/90)'s gradient setpoint driver, and no step in
either validation document covered it: `0001-trainer-and-sensors.md` §T1 records only whether the
feature bits *offer* gradient, never that one was sent. So an afternoon spent filling in Part D
truthfully would have left every cell green while the game sent nothing at all — this repository's
own recurring defect shape, where the green result is indistinguishable from the correct one,
arriving in a procedure rather than in a gate.

### ⚠️ Read this before starting

- **The rider-visible readout is a line inside the HUD panel, just above *Pause* and *End ride*.**
  While a ride is running against a trainer that granted control, the panel shows
  `Trainer: simulating −3.4% (17 sent)`. That is what `apps/web/src/game/gradient.ts`
  §`GradientSessionState` reports: the gradient last *asked for* and how many writes have been
  attempted. **A step whose expected result is invisible is an empty cell**, which is what #364 is
  about, so every step below names something on the screen or in the log.
- ⚠️ **It used to be *under* the panel, and in landscape it was off the bottom of the screen** —
  [#373](https://github.com/openzigs/onyourleft/issues/373), reported from a tablet during the
  2026-09-19 run of this part. A rider could not perform L2, L3 or L4 in the orientation a
  handlebar-mounted phone is most likely to be in. It is inside the panel now, above the controls,
  so reaching *Pause* means passing it.
- ⚠️ **You will still have to scroll, in either orientation, and that is a separate finding.**
  Measured in the pinned Chromium (`apps/web/browser/ride.browser.spec.ts` carries the table): the
  HUD panel is **572 px** tall and a landscape phone viewport is 390, so *Pause* and *End ride* are
  below the fold at every viewport measured — 844×390, 390×844, 1280×800 and 768×1024. Scroll to
  the controls and the trainer line is on screen with them. That is
  [#419](https://github.com/openzigs/onyourleft/issues/419) and it is not fixed here.
- **The count is the half that catches #362.** A gradient rendered in that line with `(0 sent)`
  beside it is exactly the defect: the number was computed and never written.
- **`adb logcat` is the independent check**, and it is the one that found the defect. Filter for
  `BluetoothLe` and look for **writes**, not notifications — 252 of the latter and none of the former
  is what a whole ride produced before this was wired.
- **A trainer that does not offer simulation mode is not a failed run.** It is L1's finding, and the
  rider is supposed to be *told*. Write down which it was before doing anything else.
- ⚠️ **End any workout before you start, and this is a safety instruction rather than tidiness.**
  There is one control point on the machine. A workout started on the Ride screen keeps running
  while the rider is on the game screen — `RideSession` is mounted above the router — so the game is
  **refused** the trainer while one is in progress and the notice reads *"A workout is driving your
  trainer…"*. That refusal is the correct behaviour and is worth seeing once: start a workout, open
  the game, and confirm the notice appears and the trainer line shows no count. ⚠️ **If a gradient
  IS written while a workout is running, stop the session.** Two writers on one control point is
  the defect, and the sharp end of it is that ending the game ride sends an FTMS Stop, after which
  the machine ignores the workout's targets while the workout's clock runs on and every one of them
  reports success.

```bash
# Watch what actually reaches the machine. ⚠️ The write lines are what matter;
# a ride that only produces "Notifying listeners" lines is #362 returning.
adb logcat -c
adb logcat | grep -i "BluetoothLe"
```

| Step | What to do | What should happen |
|---|---|---|
| L1 | On the Ride screen, pair the trainer and **take control**. Then open the game and choose a route | If the machine does not offer simulation mode, the picker says so in words about the **road** — *"does not offer simulation mode … the road on screen is real; the resistance under you is not"* — and **nothing is written**. If control was not taken, it says to take it on the Ride screen. Either way, record which and stop here |
| L2 | ⚠️ **On the bike, low gear, seated.** Start the ride on a route with a gentle climb and pedal. Scroll the HUD down until *Pause* is on screen | Within a second or two the HUD's trainer line — just above the controls — reads `Trainer: simulating …%` with a **non-zero** count beside it, and the resistance increases as the climb starts. ⚠️ Do this in **landscape as well as portrait** and say which orientations you read it in; that is what #373 was about |
| L3 | Ride through the steepest section of the route you chose | The percentage on that line **tracks the route's own gradient** — compare it against the gradient field on the HUD, which is read from the same profile. They should agree to a tenth or so |
| L4 | Ride over the crest and onto the descent | The percentage goes **negative** and the resistance drops away. A sign lost between the profile and the control point shows up here and nowhere else |
| L5 | ⚠️ **Off the bike.** Press *End ride* | The trainer is **released** — an FTMS Stop, not a gradient of zero — and the resistance goes away. Confirm by turning the cranks by hand |
| L6 | Read the logcat you have been collecting | There are **write** lines, not only `Notifying listeners`. Count them and compare with the `(n sent)` figure the HUD showed |
| L7 | Start a second ride on the same route, then navigate away from the game screen mid-ride | The trainer is released again. This is the cleanup path rather than the button, and it is a different line of code |

⚠️ **L3 is the step that distinguishes "a gradient was written" from "the right gradient was
written".** A driver fed the wrong distance writes a perfectly plausible number that has nothing to
do with the hill under the rider, and every other step here would pass.

⚠️ **L5 and L7 are the same claim by two paths and both are needed.** FTMS simulation parameters
**persist on the machine until they are changed**, so a ride ended on a 9 % wall leaves the flywheel
loaded against whoever gets on next. `apps/web/src/game/gradient.ts` §`stop` records why the release
is a Stop rather than a flat road.

### L results

| Step | Result | Notes |
|---|---|---|
| L1 | does the machine offer simulation mode? | |
| L2 | first gradient seen / writes reported: | orientation(s) read in: |
| L3 | HUD gradient vs trainer line: | |
| L4 | negative on the descent? | |
| L5 | released on *End ride*? | |
| L6 | write lines in logcat: | notifications for comparison: |
| L7 | released on navigating away? | |

**Did the hills feel like hills (in your own words)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________  **Trainer:** ____________

⚠️ **If L2's count is zero, stop and write that down as the result.** It is #362, and the useful
information is the exact state — which of the four things `trainer-port.ts` §`GameTrainerKind` can
say the screen was reporting at the time.

---

## Part M — what the scenery's colours and its variants cost ([#366](https://github.com/openzigs/onyourleft/issues/366), [#367](https://github.com/openzigs/onyourleft/issues/367))

**#367's fifth acceptance criterion in its own words**: *"Draw calls are **measured** on the device,
not reasoned about, and the number is published in `docs/validation/0002-android-shell-and-game.md`
the way Part H publishes the model cost."*

⚠️ **Read Part H's §"The baseline, and where it actually lives" first.** It records that #246's
committed baseline is not in fact committed — Part F's results table is empty — and that the numbers
Parts H and K compare against come from a comment on
[#323](https://github.com/openzigs/onyourleft/issues/323). They are the row to compare against until
somebody fills Part F in.

### What changed, and what it predicts

| | before | after |
|---|---|---|
| Where a scenery colour comes from | one constant a kind, in `three-renderer.ts` | ⚠️ the model's own `baseColorFactor`, or its atlas sampled per vertex, baked into `COLOR_0` at load |
| Materials on the whole belt | six, one a kind | ⚠️ **two** — a lit one and its unlit twin, for every mesh |
| Vertex buffer | position + normal | position + normal + **colour**, three floats a vertex |
| Textures uploaded | none | ⚠️ **none**, still. The atlas is fetched once, sampled at load and thrown away |
| Shapes a kind is drawn as | 1 | 2, or 3 for a building |
| Meshes in the belt | 6 | **12** |
| Scenery draw calls, measured in the pinned Chromium on 2026-09-19 | 6 | **12** at three shapes a kind, **11** at two, **6** at one |
| Scenery-free scene | 6 calls | **5** — see Part N, which took two away |

⚠️ **What this predicts for the GPU column, stated so that a surprise is a finding.** The triangle
count does not move at all: a variant is a *different* model of about the same size, not an extra
one, and the instance budget (`SCATTER_MAX_ITEMS`, 240) is unchanged. What moves is **draw calls**,
from 6 to 12 — against a scene that issued eleven in total before #367 and issues seventeen now. The
plausible cost is CPU-side state changes rather than fill rate, which is the opposite of what Part H
measured; #240's NFR-2 names draw calls first for exactly this reason. The colour attribute adds
about 12 bytes a vertex to a buffer uploaded **once**, at load.

⚠️ **The measurement that is NOT worth making here is a pixel comparison.** ADR 0009 forbids deriving
a reference image from another product, and there is no earlier one to compare against. What a
person can say is whether the world reads as a place rather than as one prop repeated, which is what
M1 and M2 ask and is the whole of what the owner reported on 2026-09-18.

### M — the scenery, by eye and by number

| Step | What to do | What to record |
|---|---|---|
| M1 | Ride 2 km of a route with buildings on it and look at them | Are they painted — a roof a different colour from the walls — or one flat shade? |
| M2 | Ride past a stand of broadleaf trees | Do the trunks read as brown against a green canopy? |
| M3 | Ride 2 km and watch the buildings go by | Are there visibly several different buildings, or one repeated? Same question for the trees |
| M4 | ⚠️ Ride the **same** stretch twice | Does the same house stand in the same place both times? A variant that moved between laps is a seeded-hash defect |
| M5 | 12 s of riding with the game visible, at the target rung | the rows below |
| M6 | Repeat M5 on the **floor** rung, if the ladder reaches it | the same rows again, and whether the variety visibly drops |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible, on a stretch that has buildings on it ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### M results

| | #323's baseline | M5 (target rung) | M6 (floor rung) |
|---|--:|--:|--:|
| Total frames rendered | | | |
| **Janky frames (legacy, > 16 ms)** | 40.63 % | | |
| Frame time 50th | 13 ms | | |
| GPU time 50th / 90th | 6 / 9 ms | | |
| Missed Vsync | | | |

**Are the buildings painted (M1)?** ______________

**Do the trunks read as brown (M2)?** ______________

**Is there visible variety over 2 km (M3)?** ______________

**Does the same house stand in the same place on the second lap (M4)?** ______________

**Does the floor rung's drop in variety read as a fault or as a setting (M6)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **If M5 or M6 regresses against #323's row, the lever is
`quality.ts` §`QualitySettings.sceneryVariants`** — it is a rung precisely so that this measurement
has somewhere to go, and lowering the ladder's top rung to 2 costs one mesh a building and nothing
else. `scenery-models.ts` §`MAXIMUM_SCENERY_VARIANTS` is the budget above it, and raising **that**
is what this part exists to gate.

---

## Part N — can a rider tell the three apart? ([#368](https://github.com/openzigs/onyourleft/issues/368))

**#368's fourth acceptance criterion in its own words**: *"Told apart at a glance at 10 m, 50 m and
200 m — checked on the device, not in a headless browser, because that is what #93's criterion is
actually about."*

⚠️ **This is the one part of this procedure whose result could send the change back.** #93's third
criterion — that a rider glancing at a bar-mounted phone can tell themselves from the pacer from
their own ghost — was previously carried by three different **silhouettes**. #368 gives all three a
bicycle, so it is carried by colour alone, and `bicycle.ts` records that the trade was judged rather
than assumed. **At 200 m three bicycles may genuinely be worse than three blobs, and that is a
finding rather than a failure.**

### What changed, and what it predicts

| | before #368 | after |
|---|---|---|
| The rider | a bicycle, three draw calls | ⚠️ a bicycle, and **one instance** of three shared meshes |
| The bot | a cone, `0xc2410c`, one call | a bicycle tinted `0xc2410c` |
| The ghost | an octahedron, `0x64748b`, one call | a bicycle tinted `0x64748b` |
| Draw calls, scenery-free frame | 6 | ⚠️ **5** — the two solids' calls are gone and no new ones arrive |
| Their cranks | none to turn | from their own odometer at a fixed 6.2 m development |
| Per-frame work | two `position.set` | three matrix composes, three tints, and — only for a rider whose cranks moved — four more composes each |

⚠️ **Measured in the pinned Chromium on 2026-09-19**, each drawn alone at the same place, as the
mean colour of its own silhouette: **rider (32, 72, 153), bot (22, 13, 6), ghost (7, 28, 81)**. So
the bot is the only one of the three whose red channel leads, and the rider is more than twice as
bright as either of the others. ⚠️ **The rider and the ghost lead on the same channel**, because a
per-instance tint can only darken the shared palette towards itself and the rider's jersey is blue —
which is why the pair is separated by **value** rather than by hue, and why N2 below is the question
this part is really asking.

⚠️ **And the value separation is real, measured rather than asserted.** Taking the harness's own
`0.2126R + 0.7152G + 0.0722B` over those three means gives **bot 14, ghost 27, rider 69** — three
levels no two of which are within a factor of 1.8 of each other, so a rider who cannot resolve the
hues at 200 m still has a light one, a mid one and a dark one to work with. ⚠️ That is a headless
Chromium on a desktop at 600 × 400 with no sunlight on it, which is precisely what N4 and N5 exist
to contradict; it bounds what *can* be told apart in principle and says nothing about a phone on a
handlebar. If N4's answer is no, this row is what says the remedy is hue rather than value.

### N — the three, by eye

| Step | What to do | What to record |
|---|---|---|
| N1 | Start a ride with a pacer **and** a ghost in play, and let a gap open | Can you tell all three apart at a glance — under a second, without studying the screen? |
| N2 | ⚠️ With the gap at roughly **10 m** | Which is which? Is the ghost distinguishable from you, given it is the same blue and darker? |
| N3 | At roughly **50 m** | The same question |
| N4 | At roughly **200 m** | The same question. ⚠️ If the answer is no, say whether the **solids were better** — that is the finding #368 asks for |
| N5 | Ride outdoors in direct sunlight, or with the screen at full brightness under a bright sky | Does the distinction survive? Colour alone is what washes out, which is why #93's criterion named it |
| N6 | Watch the pacer's cranks as it changes pace | Do they turn faster when it does, and stop when it stops? |
| N7 | 12 s of riding with all three on screen, at the target rung | the rows below |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with a pacer and a ghost both in play ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### N results

| | #323's baseline | N7 (target rung) |
|---|--:|--:|
| Total frames rendered | | |
| **Janky frames (legacy, > 16 ms)** | 40.63 % | |
| Frame time 50th | 13 ms | |
| GPU time 50th / 90th | 6 / 9 ms | |
| Missed Vsync | | |

**Told apart at 10 m (N2)?** ______________

**At 50 m (N3)?** ______________

**At 200 m (N4)? And were the solids better?** ______________

**In sunlight (N5)?** ______________

**Do the pacer's cranks track its pace (N6)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **If N4 says the solids were better, the cheapest answer is not to revert.** `three-renderer.ts`
§`RIDER_TINTS` is one table; a tint that suppresses blue would give the ghost a hue of its own, and a
distance-dependent fallback is a rung on `quality.ts`'s ladder rather than a change to `bicycle.ts`.
Record what was seen before deciding which.

---

## Part O — a trainer that serves only its manufacturer's control point ([#370](https://github.com/openzigs/onyourleft/issues/370))

Added 2026-09-20 by #370, and ⚠️ **it is the one part of this document nobody in the loop can run.**
The owner's machine serves FTMS. This part exists so that the first person who *does* have a
pre-FTMS trainer — a Wahoo KICKR or SNAP from before the Fitness Machine Service, a CompuTrainer, a
Tacx of that era — has a script in front of them rather than a bug report to write from memory.

⚠️ **Nothing here asks anybody to control such a trainer, and nothing in the app will try.** #370's
fourth criterion is that the vendor characteristic is never written to, and
`packages/sensors/protocol/src/fitness-machine-control.ts` §"What is deliberately not implemented"
is why: two independent open-source implementations of the Wahoo characteristic disagree by a
**factor of ten** on the rolling-resistance scaling, and CLAUDE.md §6 puts writing an unverifiable
scaling to a brake in the safety class. **This part is about a sentence on a screen.**

### ⚠️ Read this before starting

- **What changed is a message, not a capability.** Before #370 such a trainer was told *"this
  trainer does not offer a Fitness Machine control point, or did not report the power range"* — a
  sentence whose second half is a guess and which reads as *"your trainer is not a trainer"*.
- **The read that makes the difference is an enumeration**, and it happens on pairing:
  `WebBluetoothTransport.resolvedUuids` in a browser, the plugin's `getServices` in the shell. If
  the enumeration fails the rider gets the old, general sentence and a working trainer — which is
  the deliberate fallback, and O4 is how you tell the two apart.
- **`adb logcat` is the independent check**, filtered for `BluetoothLe`. What must **not** appear is
  a **write** to `a026e005-…`.

```bash
adb logcat -c
adb logcat | grep -i "BluetoothLe"
```

| Step | What to do | What should happen |
|---|---|---|
| O1 | Pair the trainer on the Ride screen | It pairs, and power and cadence appear. A vendor-only machine is still a sensor |
| O2 | Read the trainer panel | *"Records, but cannot be controlled"* — **"This trainer records fine but cannot be controlled from here"**. ⚠️ If it says *"does not offer a control point this app recognises"*, the enumeration did not find the vendor characteristic: record the model and go to O4 |
| O3 | Ride for a minute, then read the logcat | Notifications, and **no write at all** to `a026e005-0a7d-4ab3-97fa-f1500f9feb8b`. A write here is a stop-the-session defect |
| O4 | ⚠️ Only if O2 gave the general sentence. In `chrome://bluetooth-internals` (or from the logcat), list the characteristics inside `0x1818` | If a vendor control point is there and the app did not see it, that is a finding about the enumeration or about the UUID — `trainer-control-choice.ts` records that the Wahoo value is **secondary-sourced** and has never been checked against hardware. This step is the check |
| O5 | Open the game and choose a route | The picker says the road is not reaching the trainer, in words about the **road**. Nothing is written |

⚠️ **O4 is the step this part is really for.** `WAHOO_TRAINER_CONTROL_POINT` was corroborated from
community documentation and open-source implementations, read and never copied, and **has not been
checked against a device**. The whole failure mode of a wrong transcription is O2 giving the general
sentence instead of the specific one — which is why it is safe to ship unverified, and why the first
person with the hardware is being asked to look.

### O results

| Step | Result | Notes |
|---|---|---|
| O1 | trainer model: | paired? |
| O2 | which sentence? | |
| O3 | writes to the vendor characteristic: | expected: none |
| O4 | characteristics inside 0x1818: | |
| O5 | what the picker said: | |

**Was the sentence the one you would have wanted to read (in your own words)?** ______________

---

## After the session

1. **Fill the tables in this file and commit it.** An empty table in `main` is the honest state; a
   filled one is the evidence. Do not summarise the numbers away.
2. **Tick what is discharged on #87** and say which phone discharged it. Criterion 4 stays open with
   its reason, not with a tick.
3. **ADR 0008 D-2**: append a dated entry to its `## Amendments` section recording that the gate was
   run and what it found. ⚠️ [ADR 0013](../adr/0013-adr-amendments.md) — **append only**; the body
   is never edited, and reversing a decision needs a superseding ADR.
4. **File a defect per finding**, one issue each, rather than one omnibus issue.
5. If Part E shows the quality ladder never engaging, **that is a finding about the ladder, not a
   pass.** A ladder that never fires and a phone that never got hot look identical in this table,
   and only the frame-time column tells them apart.

---

## What this procedure cannot establish

- **That the scene looks right.** There is no reference image and ADR 0009 forbids deriving one from
  another product.
- **That the thermal half of the quality ladder works.** It cannot fire, because nothing feeds it.
  Wiring the port is a separate piece of work; measuring it is impossible until that lands.
- **Anything about iOS.** [ADR 0018](../adr/0018-native-client-platform.md) decides the platform;
  #15 owns the reach.
- **Anything about a release build.** This is a debug APK. #95 owns signing and distribution.
- **That two OEMs are enough.** It is what #87 asks for. Android BLE stacks vary by chipset as much
  as by vendor, and two is a floor rather than coverage.
- **That the gradient a trainer applies is the gradient it was asked for.** Part L establishes that
  a value was sent and that it tracks the road; what the machine does with it — its own ramp rate,
  its own interpretation of `c_d · A` and `C_RR`, whether it clamps — is the trainer's and is not
  observable from here. `apps/web/src/game/gradient.ts` §"What is deliberately NOT sent" records
  that only the **grade** is written and that the protocol client's own defaults stand for the other
  three simulation parameters.
