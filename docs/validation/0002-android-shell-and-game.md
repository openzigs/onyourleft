# Validation 0002 — an Android phone, the shell, and the game on a trainer

**Status:** procedure written, **not yet run**. Every result table below is empty on purpose.
**Written:** 2026-09-09, against `main` at the merge of #224, with
[#226](https://github.com/openzigs/onyourleft/pull/226) open.
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
