# Validation 0002 — an Android phone, the shell, and the game on a trainer

**Status:** procedure written, **not yet run**. Every result table below is empty on purpose.
**Written:** 2026-09-09, against `main` at the merge of #224, with
[#226](https://github.com/openzigs/onyourleft/pull/226) open. **Part H added 2026-09-17** by
[#341](https://github.com/openzigs/onyourleft/issues/341), which owes the measurement in it.
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

1. **Parts A, B, C and E write nothing that changes resistance.** They run first.
2. **Part D is last**, and its own steps are ordered so the one that leaves the trainer in an
   unknown state (D4, a mid-ERG disconnect) is the last of those.
3. **Have the trainer's power switch within reach for Part D.**
4. **Do not clip in for D4.** Flat pedals or bare feet, or stand beside the bike.

> ⚠️ If a finding in 0001's T7 was that the trainer keeps applying resistance after the link drops,
> **D4 tells you nothing new and should be skipped.** Repeating a known-dangerous behaviour over a
> second transport is not evidence, it is a second chance to get hurt.

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

| | After (F2, no pacer) | After (F3, with pacer) |
|---|---|---|
| Total frames rendered | | |
| Janky frames (modern) | | |
| **Janky frames (legacy, > 16 ms)** | | |
| Frame time 50th / 90th / 95th / 99th | | |
| GPU time 50th / 90th | | |
| Missed Vsync | | |

**Does the world move rather than step (F4)?** ______________

**Does it feel behind the pedals (F5)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

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
