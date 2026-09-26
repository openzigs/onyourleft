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
**Part P added — and run — 2026-09-20** by [#410](https://github.com/openzigs/onyourleft/issues/410),
which measured whether the APK cold-starts with no network. ⚠️ **It is the one part of this document
whose result table was filled in by the change that added it**, so it is a dated measurement rather
than a script waiting for an afternoon; the rest of this file is still the latter unless a part says
otherwise.
**Part S added 2026-09-21** by [#441](https://github.com/openzigs/onyourleft/issues/441): whether a
struggling rider in ERG is actually eased, now that the ease is a lower target rather than a Stop.
Checked with `grep '^## Part'` for a duplicate letter first — S was free.
**Parts U to Y added 2026-09-21** by one pull request for
[#455](https://github.com/openzigs/onyourleft/issues/455),
[#458](https://github.com/openzigs/onyourleft/issues/458),
[#459](https://github.com/openzigs/onyourleft/issues/459),
[#460](https://github.com/openzigs/onyourleft/issues/460) and the no-asset half of
[#425](https://github.com/openzigs/onyourleft/issues/425) — one part each, in that order, every
result cell empty. Checked with `grep '^## Part'` for a duplicate letter first — T was the last, and
U to Y were free. ⚠️ **V to Y are looks and frame times, and they need a ride**: ride them with the
trainer **not** handed to the game (a power meter, or a trainer with control not granted), so they
change no resistance and stay in rule 1's group below. A rider who gives the game the trainer for
them is running Part L as well, and runs them after it.
**Frame rates corrected 2026-09-22** by [#476](https://github.com/openzigs/onyourleft/issues/476):
until then `quality.ts`'s frame cap was read by nothing and **every rung drew at the display's
rate**. Now the top rung — "the target rung" in every Part below — draws at the display's rate
(60 Hz on the tablet) and the rungs below cap at 30, 24 and 20. A row taken at the target rung before
#476 is comparable with one after it; a row taken at a lower rung ("the floor rung", K7, M6) is not.
**And again the same day** by [#482](https://github.com/openzigs/onyourleft/issues/482), the owner's
*"I want the extra 60 fps step"*: the ladder is **five** rungs, and the first step down sheds
resolution and scenery **at the display's rate** — only the three below it cap, at 30, 24 and 20. A
reader who remembers "one rung down" meaning 30 fps is reading the #476 file; "one rung down" (Y5, T5)
is 60 fps with less detail now. The floor rung is unchanged in every figure. Part Z's frame-rate note
has the table.
**Part AC added 2026-09-23** by [#503](https://github.com/openzigs/onyourleft/issues/503): the
game's own *Ride* press now asks the trainer for control, so L1's *"take control on the Ride screen
first"* is no longer the way in, and AC is the hardware step that says whether the press does it.
Checked with `grep '^## Part'` for a duplicate letter first — AB was the last, and AC was free. It
**changes resistance** and runs with L, before D (Safety rule 2).
**Results filled 2026-09-26** from the owner's session of 2026-09-25 into the morning of 2026-09-26,
on the Pixel Tablet with a Wahoo KICKR CORE: A5, Part C, Part S, Part T (T1, T3, T4) and AE3. See
*What the 2026-09-25 session established* below for the build and for what it filed. **Part AF
added — and run — the same day** for [#519](https://github.com/openzigs/onyourleft/issues/519):
whether the shell reaches a plain-`http:` model server on the LAN. Checked with `grep '^## Part'`
for a duplicate letter first — AE was the last, and AF was free.
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

1. **Parts A, B, C, E to K, P and U to Y write nothing that changes resistance.** They run first.
   ⚠️ **U to Y are in that list only when ridden without the trainer handed to the game** — see
   the header. ⚠️ **`P`
   is in that list and this line used to stop at `K`** — Part P
   ([#410](https://github.com/openzigs/onyourleft/issues/410)) is an offline cold-start measurement
   that pairs no trainer at all, and a part missing from this list is as ambiguous as two parts
   sharing a letter.
2. ⚠️ **Parts L and D are last, in that order**, and they are the only two that change what a rider
   feels. **L (simulation mode) before D (ERG)**, because L's resistance follows a road the rider can
   see coming and D's is a number somebody typed — and D's own steps are ordered so the one that
   leaves the trainer in an unknown state (D4, a mid-ERG disconnect) is the last thing done all day.
   ⚠️ **This list used to read "Part D is last" and name four parts as safe; a reviewer who
   remembers that is reading the old file.** Part L is new
   ([#364](https://github.com/openzigs/onyourleft/issues/364)) and the whole document had no
   simulation-mode step before it — which is why an afternoon spent filling in Part D truthfully
   would have left every cell green and the game sending nothing (#362).
   ⚠️ **Parts AC ([#503](https://github.com/openzigs/onyourleft/issues/503)), R
   ([#372](https://github.com/openzigs/onyourleft/issues/372)) and S
   ([#441](https://github.com/openzigs/onyourleft/issues/441)) run between them: L, then AC, then R,
   then S, then D.** AC is L's road with the control taken by the game's own *Ride* press rather than
   on the Ride screen, so it follows L while the rider is warm to the same route. S deliberately lets cadence collapse under an ERG target, which is the most
   uncomfortable thing in this document short of D4 — do it fresh, and not after D. R is the ERG half of the release test and it needs a target set, so it is not a
   no-resistance part. ⚠️ It used to say every step of it ends by *removing* resistance; on the
   owner's trainer none does (Part R says what was measured), so ride R as if the target stays —
   and D4 stays the last thing done all day.
3. **Have the trainer's power switch within reach for Parts L, AC, R, S and D.**
4. **Do not clip in for D4, and use flat pedals for L5, L7 and Part R.** D4: flat pedals or bare
   feet, or stand beside the bike. ⚠️ **L5, L7 and R are ridden**, and this item used to say not to
   clip in for L5 because L5 was *"off the bike, turn the cranks by hand"* — a reviewer who remembers
   that is reading the old procedure. Since #372 those steps release the trainer **while you are
   still pedalling**, because that is the only way to see whether it let go (L5 says why). On the
   owner's trainer it does not, so be able to stop pedalling and step off at once. ⚠️ **`L5`, not `K5`** — Part K is #349's rendering measurement and its own K5 asks for a
   ride with no cadence sensor, which changes no resistance at all.
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

## What the 2026-09-25 session established

Run by the owner from the afternoon of 2026-09-25 into the morning of 2026-09-26.

| | |
|---|---|
| Devices | Google Pixel Tablet, Android 17, WebView 153.0.8010.36 — **every result below was taken on it**. A Pixel 8 (Android 17, WebView 153.0.8010.36) was also in the session |
| Trainer | Wahoo KICKR CORE, over FTMS |
| Build | debug APK from `main` at `cfa8956` (the merge of #540), which contains #524 and #526. A5, S, T and AE3 ran on it, and Part C ran overnight on the same install. Part AF ran earlier the same afternoon on `2b84996`, and says so |

| Part | Result |
|---|---|
| A5 | **Pass** — the notification question is asked and the service is foreground and `connectedDevice`. The notification is filed under **Silent**, so it is easy to miss. #526's three extra observations were **not** run |
| C | **C1–C3 pass while powered**: a 10½-hour ride backgrounded with the screen off, continuous. ⚠️ The charger was connected throughout, and **the battery run is still owed** |
| S | **S1 and S2 pass** in a saved workout: the stall rescue wrote the machine's minimum as a `0x05`, and no `0x08` was sent. ⚠️ **Manual ERG has no stall rescue**, and the trainer's own firmware let go instead. S3 and S4 not run |
| T | T1 passes. T3 and T4 give frame and GPU times with the shadow map off and on. There is a stall of about 5 s at the start of a ride with the map on. T2 and T5 not run |
| AE | **AE3 passes**, in the product rather than the harness, with a whole-ride `gfxinfo`. AE1 and AE2 not run |
| AF | **The shell blocks a plain-`http:` LAN model server as mixed content** (#519) |

**Found along the way**, one issue each (After the session, item 4):

| Issue | What |
|---|---|
| [#542](https://github.com/openzigs/onyourleft/issues/542) | An ERG workout re-sends an unchanged, acknowledged target about once a second (14 writes in 16 s) — Part S |
| [#543](https://github.com/openzigs/onyourleft/issues/543) | The road's bends are drawn as straight pieces with sharp corners |
| [#544](https://github.com/openzigs/onyourleft/issues/544) | Distant hills draw as pale, near-white bands with hard edges in the realistic world |
| [#545](https://github.com/openzigs/onyourleft/issues/545) | Scenery clips at the camera: a sliver of building wall and a flat grey tree trunk at the frame's edge |
| [#546](https://github.com/openzigs/onyourleft/issues/546) | Make the drawn rider take a real racing line and body position through bends |
| [#547](https://github.com/openzigs/onyourleft/issues/547) | Make the riders' real shadow map the default in the stylised world, instead of the blob — T4's verdict by eye |
| [#548](https://github.com/openzigs/onyourleft/issues/548) | After a ride is stopped and saved, the Ride screen offers no way to start another without restarting the app |
| [#551](https://github.com/openzigs/onyourleft/issues/551) | Show the side camera's state on the ride screen, and say when its link drops mid-ride |
| [#552](https://github.com/openzigs/onyourleft/issues/552) | Flaky browser test: `sidelink.browser.spec.ts` saw `pairing` where it expected `framing` |

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

⚠️ **Run A5 on a build that contains [#526](https://github.com/openzigs/onyourleft/issues/526)
as well as [#524](https://github.com/openzigs/onyourleft/issues/524).** From Android 13 (API 33)
`POST_NOTIFICATIONS` is a runtime permission, and before #526 nothing asked for it: the service ran
and its notification was never shown, so on the owner's tablet (API 35+) A5 would record a failure
caused by the missing question rather than by the service. On such a build, pressing **Start
recording** for the first time raises Android's notifications dialog while the service is
**already** running — allow it, and the "Recording ride" notification appears, which is what A5 then
looks for. Refusing it must leave the ride recording, with one sentence on the Ride screen saying
there will be no notification, and a later ride must not ask again. Below API 33 nothing is asked. A
result taken on a build without #526 says nothing about A5 on API 33+.

Three more observations belong to the same row, and none of them is decidable off the device:

- **Leave the dialog up and let the screen time out** (or press Home). The ride must keep recording
  with the screen off: `adb shell dumpsys activity services dev.openzigs.onyourleft` lists
  `RecordingService` as a foreground service while the question is still unanswered. That is
  #531's review finding — the service is started first and does not wait for the answer, because
  Android delivers the answer only once the app is on screen again.
- **Dismiss the dialog** (back pressed, no choice made), finish the ride, and start another. Record
  whether the second ride asks again. ⚠️ Capacitor 8.5.2's `Bridge.validatePermissions` stores any
  result that is not a grant as `denied` unless `shouldShowRequestPermissionRationale` is true, so a
  dismissal reported as a denial may be remembered as `denied` and **never asked about again** — the
  opposite of what #531's first description claimed. Which one Android 13+ reports for a dismissal
  is the observation.
- **Allow it**, and check the notification appears on **this** ride without stopping it: the second
  start the client sends on `granted` is what posts it.

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
| A5 | **Pass**, with the Silent caveat below. Google Pixel Tablet, Android 17, 2026-09-25, `main` at `cfa8956`. Before the first ride `POST_NOTIFICATIONS` read `granted=false` with no `USER_SET` flag, so it had never been asked. Pressing *Start recording* raised Android's *Allow notifications* dialog, and the owner tapped **Allow**. `dumpsys activity services` then listed `RecordingService` with `isForeground=true` and `types=0x10` (`connectedDevice`). The notification *"Recording ride — Sensors stay connected while this is showing."* was posted on channel `ride_recording` at importance 2 (`LOW`) | |
| A6 | | |
| A7 | | |
| A8 | | |

⚠️ **A5's notification is Silent, and the owner did not see it at first.** Android files a channel
at importance 2 (`IMPORTANCE_LOW`) under the shade's *Silent* section, below the ordinary
notifications. It was there, and `dumpsys` shows it was posted. But *"pull down the notification
shade"* does not show it at a glance. Whether `ride_recording` should be `LOW` is not decided here.

⚠️ **The three observations #526 added under A5 were not run.** The owner allowed the dialog the
first time it appeared. So the dialog was never left up with the screen off, and it was never
dismissed. Whether Android 13+ reports a dismissal as `denied`, and whether that is then never asked
again, **is still open**. The notification did appear on the same ride after Allow, as the third
bullet expects, but that was seen in passing and was not run as its own step.

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

⚠️ **Run this on a build that contains [#524](https://github.com/openzigs/onyourleft/issues/524).**
Before it, nothing in the client started `RecordingService`: the plugin was registered and never
called, so A5 showed no notification and this part ran with no service at all. A result taken on
such a build measures a ride with no foreground service, and says nothing about one with it.

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
| C1 | duration recorded: **37 887 s**, against 37 886 s elapsed. **Pass, while powered.** Recording started at 21:08:04 on 2026-09-25. The app was backgrounded and the screen turned off at 21:08:19. The owner stopped it at 07:39:30 the next morning. The trainer sent **38 019** Indoor Bike Data notifications, with a largest gap of 2 s and none over 3 s. The app process was the same one all night | |
| C2 | **Pass, while powered.** `RecordingService` was foreground and typed `connectedDevice` at six `dumpsys` checks over the first hour. The process was not restarted, and the notification stream above ran unbroken to the stop | |
| C3 | samples / elapsed: **37 887 / 37 886 s**. **Pass, while powered.** The ride saved | |

**Phone:** Google Pixel Tablet, Android 17, WebView 153.0.8010.36. **Build:** debug, `main` at
`cfa8956`, the same install as A5. **Trainer:** Wahoo KICKR CORE (FTMS).

⚠️ **The tablet was on USB power for the whole run, so this is the easy case.** Android relaxes its
background limits on a device that is charging: Doze does not start while it is plugged in. A ride on
battery is the case #87 criterion 3 is really about, and **it is still to be run**. It needs the same
three rows with the charger unplugged before the recording starts. Until then, the pass above says
the service holds a ride overnight on a powered device, and nothing about a battery.

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
  `apps/mobile`". For the foreground service that has been true since
  [#524](https://github.com/openzigs/onyourleft/issues/524) — before it the service existed and
  nothing started it; **for thermal headroom it describes the
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
- ⚠️ **Since [#423](https://github.com/openzigs/onyourleft/issues/423) you do NOT scroll, and a
  reader who remembers the two bullets above as the state of things is reading the old procedure.**
  #373 moved the line and did not make it visible: confirmed on a tablet in landscape on 2026-09-20
  ([#422](https://github.com/openzigs/onyourleft/issues/422)). While a ride runs the world now fills
  the screen and the line shares a corner panel with *Pause* and *End ride*. Part Q is where that is
  checked on the device.
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
| L1 | On the Ride screen, pair the trainer and **take control**. Then open the game and choose a route | If the machine does not offer simulation mode, the picker says so in words about the **road** — *"does not offer simulation mode … the road on screen is real; the resistance under you is not"* — and **nothing is written**; record it and stop here. Otherwise the picker says *"Your trainer will follow this route’s hills"*. ⚠️ **Since [#503](https://github.com/openzigs/onyourleft/issues/503) it no longer sends a rider without control to the Ride screen** — the *Ride* press asks for it, and Part AC is the step for that path; a reader who remembers L1 stopping on *"take it on the Ride screen"* is reading the old procedure |
| L2 | ⚠️ **On the bike, low gear, seated.** Start the ride on a route with a gentle climb and pedal. Scroll the HUD down until *Pause* is on screen | Within a second or two the HUD's trainer line — just above the controls — reads `Trainer: simulating …%` with a **non-zero** count beside it, and the resistance increases as the climb starts. ⚠️ Do this in **landscape as well as portrait** and say which orientations you read it in; that is what #373 was about |
| L3 | Ride through the steepest section of the route you chose | The percentage on that line **tracks the route's own gradient** — compare it against the gradient field on the HUD, which is read from the same profile. They should agree to a tenth or so |
| L4 | Ride over the crest and onto the descent | The percentage goes **negative** and the resistance drops away. A sign lost between the profile and the control point shows up here and nowhere else |
| L5 | ⚠️ **The pedal-through test — flat pedals, low gear, seated.** Ride a steady climb at a steady cadence and watch the HUD's power. **While still pedalling**, press *End ride*. Keep pedalling in the same gear for ten seconds, then let your cadence fall — 80, 70, 60, 50 rpm — and read the trainer's own power on the Ride screen or in logcat as you do | **Record what happens; do not expect a release.** **Released:** power **falls** as cadence falls, and the climb's weight is gone. **Still holding:** power stays up or **rises** as cadence falls — which is what the owner's trainer did after both a Stop and a Reset in 2026 (see below), and which the owner has accepted. In logcat the release is **one `0x08` Stop** (`08 01`) answered `80 08 01` — **no `0x01` Reset**, and **no `0x00` Request Control after the `0x08`**. The Ride screen afterwards shows neither *Control lost* nor *Ask the trainer for control*: control is kept. If it shows **Not released**, the trainer refused the Stop: write down exactly what logcat shows |
| L6 | Read the logcat you have been collecting | There are **write** lines, not only `Notifying listeners`. Count them and compare with the `(n sent)` figure the HUD showed |
| L7 | Start a second ride on the same route — no need to take control again, the release keeps it — climb, and **while still pedalling navigate away from the game screen** with the system Back gesture. Then the same cadence ramp as L5 | The same as L5: one `0x08` answered `80 08 01`, no `0x01`, no `0x00` after the `0x08`, and power recorded as cadence fell. This is the cleanup path rather than the button, and it is a different line of code making the same claim |

⚠️ **L3 is the step that distinguishes "a gradient was written" from "the right gradient was
written".** A driver fed the wrong distance writes a perfectly plausible number that has nothing to
do with the hill under the rider, and every other step here would pass.

⚠️ **L5 and L7 are the same claim by two paths and both are needed.** FTMS simulation parameters
**persist on the machine until they are changed**, so a ride ended on a 9 % wall leaves the flywheel
loaded against whoever gets on next. `apps/web/src/game/gradient.ts` §`stop` records what the
release sends and what, on hardware, it did not do.

⚠️ **L5 and L7 used to expect a `0x01` Reset and a released trainer, and a reviewer who remembers that
is reading the old procedure.** [#372](https://github.com/openzigs/onyourleft/issues/372): on the
owner's trainer (`EB:71:8D:AA:0E:3C`) an acknowledged Stop kept the grade (2026-09-19) and an ERG
target (2026-09-21); PR #442 then sent a Reset instead, and on 2026-09-21 it was acknowledged
`80 01 01` and the trainer **kept holding 198–202 W across 64–81 rpm, then raised power as cadence
fell** — the same as the Stop, and the Reset had revoked control as well. So the release is a Stop
again, through one method, and the owner has **accepted end-of-ride retention** on the condition that
the app can take control again — which it can. These steps record what a trainer does; they no longer
expect it to let go.

⚠️ **Why L5 is a pedal-through test and not "turn the cranks by hand" — do not simplify it back.**
L5's old expected result was *"confirm by turning the cranks by hand"*, and that **cannot tell a
released trainer from one still holding a grade**: a direct-drive trainer always has drag, and
simulation resistance nearly vanishes at walking pace anyway. The 2026-09-19 run needed a
*differential* to see anything — a ride ended on a climb felt heavy, one ended on a descent felt
easy. The pedal-through judges by the trainer's **own power reading** and needs no comparison: in a
fixed gear, a released trainer is a free resistance curve, where less cadence can only mean less
power. A trainer still holding a target keeps power up — and one still in ERG **raises** it as
cadence falls, which is exactly what #372's ERG measurement saw after an acknowledged Stop.

⚠️ **After a release this client still holds control**, because a Stop does not revoke it. PR #442's
Reset did, and the next game ride then asked the rider to take control on the Ride screen every time;
a reviewer who remembers L7 starting with *"take control again"* is reading the old procedure.

⚠️ **Why "no `0x00` after the `0x08`" is in L5, L7 and every step of Part R.** A trainer may notify
Fitness Machine Status `0xFF` (*Control Permission Lost*) around a release, and nothing in BLE or FTMS
says whether that arrives before or after the release's own answer. Until PR #442's review the client
treated a `0xFF` that arrived *first* as somebody else taking control: it showed *Control lost*, and
it **wrote a `0x00` Request Control straight after the release** — control back in the app's hands
without the rider doing anything. The fix is tested against a scripted machine
(`fitness-machine-control.test.ts` §"releasing the trainer at the end of a ride"), but whether this
trainer sends a `0xFF` at all is only in the logcat. Note it if one appears; a `0x00` after the
`0x08` is the thing that must not.

### L results

| Step | Result | Notes |
|---|---|---|
| L1 | does the machine offer simulation mode? | |
| L2 | first gradient seen / writes reported: | orientation(s) read in: |
| L3 | HUD gradient vs trainer line: | |
| L4 | negative on the descent? | |
| L5 | pedal-through on *End ride*: power as cadence fell (rpm → W): | `0x08` answered? `0x01` seen? `0x00` after `0x08`? `0xFF` seen? screen said: |
| L6 | write lines in logcat: | notifications for comparison: |
| L7 | pedal-through on navigating away: power as cadence fell (rpm → W): | `0x08` answered? `0x01` seen? `0x00` after `0x08`? |

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

## Part P — does the APK cold-start with no network? ([#410](https://github.com/openzigs/onyourleft/issues/410))

Added **and run** on 2026-09-20 by #410, and ⚠️ **it is the first part of this document whose
result table was filled in by the change that wrote it.** Every other part here was written for a
future afternoon; this one is a measurement with a date on it, and the tables below say what a
Pixel Tablet actually did rather than what it should do.

⚠️ **`P`, and the letter was checked rather than assumed.** `grep '^## Part'` before adding one:
A to O were taken, and two parts sharing a letter is [#364](https://github.com/openzigs/onyourleft/issues/364)'s
durable finding — the ⚠️Safety list, the ordering rule and the do-not-clip-in instruction are all
keyed to part letters, so a duplicate makes each of those ambiguous even when every sentence in it
is right.

⚠️ **Nothing here writes to a trainer and nothing changes resistance.** It belongs with the safe
group in ⚠️Safety rule 1, not with L and D. No trainer was paired for it.

### Why this part exists

[ADR 0024](../adr/0024-offline-and-caching-posture.md) D-4 says the service worker registers only
when `isNativeShell()` is false, and its argument is that inside the shell the client is *already*
served from local storage and *already* cold-starts with no network. That argument was **read from
source and never executed** — `capacitor.config.ts` sets `webDir: '../web/dist'`, `cap sync` copies
the tree into the APK, therefore. ADR 0024's own §"What would make this ADR wrong" names the
failure: *"The Android shell turns out not to cold-start offline. D-4 rests on it; #410 measures
it, and a negative result reopens D-4 rather than this whole ADR."*

So a **negative** result here was a valid outcome and would have been the more valuable one. It is
not what happened, and the tables say so with numbers rather than with the word "pass".

### ⚠️ Four ways to measure this and get a wrong green

1. **A stale APK.** `./gradlew assembleDebug` prints `BUILD SUCCESSFUL` in about a second with
   almost every task up to date, and a debug APK carrying last week's bundle measures last week.
   **Compare the hashed `index-*.js` name inside the APK against `apps/web/dist/assets/` before
   measuring anything** — step P1, and it is first for that reason.
2. **"Offline" as a setting rather than as a fact.** Aeroplane mode, Wi-Fi off and mobile data off
   are three switches, not one, and none of them is the claim being made. ⚠️ On this tablet
   `svc data disable` answers `Can't find service: phone` — there is no cellular radio — so that
   command proves nothing at all here and its silence is not evidence. The claim that matters is
   *the WebView cannot reach a host*, and P2 establishes it from inside the WebView with something
   that would fail.
3. **A process that was never stopped.** Cold means not running: `am force-stop` first, and
   `am start -W` must answer `LaunchState: COLD`. A warm start re-uses a live WebView and measures
   nothing.
4. **A warm cache.** A profile that has been online would pass where a fresh install would not, so
   P3 is a **fresh install that has never had a network**, and P10 is the other end of it —
   `pm clear`, which wipes app data **and** every cache.

### The tooling, and where it is

Four of #410's questions are invisible from outside the WebView: the origin, whether
`crypto.subtle` is reachable, whether a service worker is registered, and which assets a render
fetched. `adb logcat` answers only the last, and only for what Capacitor's local server logs.

[`apps/mobile/tools/webview-probe.mjs`](../../apps/mobile/tools/webview-probe.mjs) evaluates one
expression inside the running WebView over the DevTools protocol through an adb forward, and prints
what it returned. ⚠️ **It asks nothing** — the questions are the expressions in this document, so
the tool has no opinion to go stale.

⚠️ **It is not under `scripts/`, deliberately.** That directory is the bare-clone set — bash and
coreutils, no install, no network, no device (CLAUDE.md §2, §4a) — and this needs `adb`, a phone
with developer options on and a **debug** build. It could never be a repository check, and
`check:repo` does not call it. It lives beside the Android project whose WebView it talks to.

⚠️ **It only attaches to a debug build.** Capacitor enables WebView contents debugging for debug
and not for release, so this cannot be pointed at a shipped APK — which is a limit of Part P, not
only of the tool. See §"What this cannot establish".

```bash
ADB=/path/to/platform-tools/adb          # not on PATH in a Homebrew cmdline-tools install
export ANDROID_HOME=/path/to/android-commandlinetools

pnpm run build                                   # apps/web -> apps/web/dist
( cd apps/mobile && pnpm exec cap sync android ) # dist -> android/app/src/main/assets/public
pnpm run check:capacitor                         # cap sync regenerates two committed files (§4k)
( cd apps/mobile/android && ./gradlew assembleDebug )

# P1 — the APK has to carry the bundle you just built.
unzip -l apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk |
  grep 'assets/public/assets/index-'
ls apps/web/dist/assets/index-*.js

# The probe, once the app is running.
PID=$("$ADB" shell pidof dev.openzigs.onyourleft)
"$ADB" forward tcp:9222 localabstract:webview_devtools_remote_"$PID"
node apps/mobile/tools/webview-probe.mjs 'location.origin'
```

⚠️ **`adb shell svc power stayon true` before you start, and `false` when you finish.** A tablet
that dozes suspends the WebView's network silently, which has already cost this project a debugging
session — and leaving the screen pinned on afterwards is a different kind of rude.

### The procedure

| Step | What to do | What should happen |
|---|---|---|
| P1 | Build, sync, assemble, and compare the hashed bundle name inside the APK with `apps/web/dist/assets/` | The same `index-*.js`. If not, nothing below means anything |
| P2 | Aeroplane mode on, Wi-Fi off, then verify with something that would fail: `ping` an IP, `ping` a name, `dumpsys connectivity`, and from inside the WebView a `fetch` of an external origin | `Network is unreachable`, `unknown host`, `Active default network: none`, and a rejected fetch |
| P3 | `adb uninstall`, `adb install -r` (over USB — not a network), then `am start -W`. **The profile has never been online** | `LaunchState: COLD`, and the app renders |
| P4 | Probe `location.origin`, `isSecureContext`, and a real `crypto.subtle.digest` | `https://localhost`, secure, and the right digest. A non-secure origin would break identity and import, which is a bigger problem than offline |
| P5 | Probe `navigator.serviceWorker.getRegistrations()` and `caches.keys()`, **and** list `app_webview/Default/` on disk with `run-as` | Nothing registered, no caches, and no `Service Worker` directory. This is the baseline a future registration would be visible against (ADR 0024 D-4) |
| P6 | Import a route while offline, from `packages/fit/fixtures/corpus/planned-loop-route.gpx` | It saves, and the saved-routes table lists it. `#/game` needs a route and there is no other way to get one |
| P7 | Ride it. Count the scenery assets the renderer fetched and their status codes; read `adb logcat` for what served them | Eleven `.glb` and the shared atlas, all 200, all answered by Capacitor's local server. This is the path with the most runtime-fetched assets and the one the browser build needs a worker for |
| P8 | `am force-stop`, relaunch, still offline | `COLD` again, renders, and the route is still there — the read is through the rider's own screen after a process death |
| P9 | Reboot the device. Confirm it is still offline. Launch, and ride again | `COLD`, renders, twelve assets again |
| P10 | `pm clear` — app data **and** every cache — then launch, still offline | `COLD`, renders. The route is gone, which is what `pm clear` means and is how you know it did what it says |

### P context

| | |
|---|---|
| Date | **2026-09-20** |
| Device | **Pixel Tablet** (`tangorpro`), build `CP2A.260705.006` |
| Android | **17** (SDK 37) |
| WebView | **`com.google.android.webview` 151.0.7922.199** (versionCode 792219903), the current provider per `dumpsys webviewupdate` |
| Capacitor | **`@capacitor/android` 8.5.2** with `@capacitor/core` 8.5.2, read from `capacitor.settings.gradle`; one plugin, `@capacitor-community/bluetooth-le` 8.3.0 |
| APK | debug, built **2026-09-20**, 5 643 897 bytes, `versionName=1.0`, `versionCode=1`, `minSdk=24`, `targetSdk=36` |
| Bundle | `assets/index-CqoY0sjQ.js`, 742 590 B, SHA-256 `3a3c89d3c96ba618…` |
| Branch | `feature/issue-410-android-cold-start-offline`, off `main` at `072245c` |

### P results

| Step | Result | What was actually observed |
|---|---|---|
| P1 | **same bundle** | `assets/public/assets/index-CqoY0sjQ.js` inside the APK; `apps/web/dist/assets/index-CqoY0sjQ.js` on disk. The build also emitted `sw.js` precaching 27 files, 3.07 MiB, as `338cdb0fcc3fafe8` — see P5 |
| P2 | **offline, established four ways** | `settings get global airplane_mode_on` → `1`; `dumpsys wifi` → `Wi-Fi is disabled`; `ping -c 2 -W 2 1.1.1.1` → `connect: Network is unreachable`; `ping example.com` → `unknown host`; `dumpsys connectivity` → `Active default network: none`. ⚠️ `svc data disable` → `Can't find service: phone` (no cellular radio) and proves nothing. **From inside the WebView**: `fetch('https://example.com/')` → `REJECTED TypeError: Failed to fetch`. Google Play services logged `net::ERR_INTERNET_DISCONNECTED` from its own process while this ran |
| P3 | **it cold-starts** | `pm list packages` → 0 matches after uninstall. Installed over USB, launched: `LaunchState: COLD`, `TotalTime: 595` ms. `h1` = **"Ride"**, all eleven nav entries present. First launch of a profile that had never existed, with no network of any kind |
| P4 | **`https://localhost`, secure, `crypto.subtle` live** | `location.href` = `https://localhost/`; `isSecureContext` = `true`; `crypto.subtle.digest('SHA-256', [1,2,3])` returned `039058c6…`, which is the right answer. Capacitor logged `Loading app at https://localhost` |
| P5 | **no worker, no caches, no directory** | `getRegistrations()` → `[]`, `navigator.serviceWorker.controller` → `null`, `caches.keys()` → `[]` on every one of the four launches. Independently, `run-as … ls app_webview/Default/` has **no `Service Worker` entry and no Cache Storage entry at all**. ⚠️ `sw.js` and `manifest.webmanifest` **do ship inside the APK** — they are part of `dist` — and nothing registers the first. That pair is the baseline |
| P6 | **imported offline** | `✓ Done: Saved "Synthetic fixture loop". It is private.` The saved-routes table then listed it at **5.0 km / 60 m**, read back through the rider's own screen |
| P7 | **`#/game` rendered, twelve assets, all local** | **12 distinct** scenery assets — eleven `.glb` and `colormap-*.png` — in **14 requests**, every one `responseStatus 200`; `three-renderer-*.js` 200; a live canvas at 1158×652; the HUD reading `— W`, `— rpm`, `— bpm`, `0.0 km/h`, `1.9 %`, `5.03 km`, `—`. `adb logcat` carries one `D Capacitor: Handling local request: https://localhost/assets/<file>` per request and **no network line at all**. The screenshot shows road, centre line, trees, buildings, bushes, rocks and the rider on a bicycle, with the aeroplane-mode icon in the status bar |
| P8 | **cold again, state intact** | pid empty after `am force-stop`; `LaunchState: COLD`, `TotalTime: 452` ms; renders; the route is still in the list after a process death |
| P9 | **cold after a reboot** | Still offline after the reboot (`airplane_mode_on` 1, Wi-Fi disabled, `Network is unreachable`). `LaunchState: COLD`, `TotalTime: 468` ms; renders; the route survived; the ride re-fetched **12 distinct assets in 14 requests, all 200** |
| P10 | **cold with nothing warm at all** | `pm clear` emptied the data directory (`ls` showed only `.` and `..`). `LaunchState: COLD`, `TotalTime: 421` ms; the app rendered; the route count was **0**, which is what `pm clear` means and is how you know it happened |

**Does the Android APK cold-start with no network?** **Yes.** Four cold starts — first-ever on a
fresh install, after a force-stop, after a reboot, and after `pm clear` — all offline, 421 to
595 ms to activity launch, the full client every time, and the game's twelve scenery assets served
from the APK by Capacitor's own local server.

**ADR 0024 D-4's premise is therefore measured rather than reasoned, and it held.** No amendment to
ADR 0024 is owed by this result. ⚠️ That is a statement about D-4's **premise** and nothing wider:
it says the shell is already local, not that a worker there would be harmless, which is D-4's
separate argument about an APK update racing Cache Storage.

### ⚠️ The control — what stops this being a vacuous green

Every headline answer in P5 and P2 is an **absence**: no registration, no cache, a rejected fetch.
An expression that always answers that way would produce exactly the same table, which is this
repository's recurring defect shape. So each absence has a positive control, and all three were
run.

| Claim | The control | What it answered |
|---|---|---|
| `getRegistrations()` → `[]` is a real answer | ⚠️ **The same expression, against the same `dist`, in a browser**: `vite preview` on `http://localhost:4173` (a secure context) in the pinned headless Chromium | `["http://localhost:4173/"]`, with `caches.keys()` → `["oyl-precache-338cdb0fcc3fafe8"]` — and `338cdb0fcc3fafe8` is the precache hash this same build printed. The expression distinguishes, and this is [ADR 0024](../adr/0024-offline-and-caching-posture.md) D-4's branch observed from **both** sides |
| the shell really has no worker | A second, independent layer: `run-as … ls app_webview/Default/` | No `Service Worker` directory and no Cache Storage directory at all. Nothing in the WebView profile, not merely nothing the page can see |
| `fetch` rejecting means "offline" | The same fetch expression with a network | `RESOLVED opaque`. So `REJECTED TypeError: Failed to fetch` in P2 is an answer about the network rather than about the expression |

⚠️ **Where the numbers came from, precisely.** The device numbers above were taken through the
DevTools protocol with the probe's prototype attached to the tablet; the committed
[`webview-probe.mjs`](../../apps/mobile/tools/webview-probe.mjs) is that prototype tidied, and it
was exercised end to end — value printed and exit 0, an expression that throws reported and exit 1,
no endpoint exit 1, no argument exit 2, `OYL_DEVTOOLS_PORT` honoured — against the pinned Chromium
rather than against the phone, because the tablet dropped off USB before the file was finished.
**Nobody has yet run the committed file against an Android WebView.** It is the same four protocol
calls and the next person to run Part P will find out; recording it is cheaper than letting a
reader assume it.

### What Part P found along the way

Five observations, none of which is a defect in this client and all of which would have been
invisible from a table that only said "pass".

1. ⚠️ **`navigator.onLine` is `true` with no network whatsoever.** Aeroplane mode, Wi-Fi off, every
   `ping` unreachable, and the WebView's own `fetch` rejecting — and `navigator.onLine` still
   reports `true`, because the page is served from a local scheme. **Nothing in `apps/` or
   `packages/` reads it** (checked), so it costs nothing today. It is a trap for the first thing
   that does, and this is where it is written down.
2. **The WebView asks for `/favicon.ico` by itself and gets a 404.** `apps/web/dist` ships none and
   `index.html` references none, so this is the browser's own request answered locally by the
   Capacitor server. It was observed only on the first launch of a fresh profile. No network was
   attempted.
3. **The shared texture atlas is fetched once per building model**, so twelve distinct assets
   arrive in fourteen requests. All three are answered from the APK. It costs nothing measurable
   here and it is recorded because P7 counts requests and the two numbers differ.
4. ⚠️ **`PerformanceResourceTiming` reports `transferSize` and `decodedBodySize` of `0` for every
   locally-served asset**, so resource timing cannot measure bytes inside the shell and a reader
   cannot tell a served file from a cached one that way. The evidence that a file arrived is
   `responseStatus === 200` plus Capacitor's own `Handling local request` line. This is the same
   shape as the opaque cross-origin timing recorded in CLAUDE.md §4f, arriving from the other
   direction.
5. ⚠️ **`E Capacitor/Console: Error injecting safe area CSS: TypeError: Cannot read properties of
   null (reading 'style')`**, intermittently at startup — once in four offline launches and once in
   three **online** ones, so it is not an offline symptom. It is `@capacitor/android` 8.5.2's own
   `SystemBars` plugin (`SystemBars.java`) setting `--safe-area-inset-*` on
   `document.documentElement` before there is one, and when it loses that race the four custom
   properties are simply not set. **Nothing in `apps/` reads `--safe-area-inset-*`**, so it is inert
   here and no issue was filed for it. It stops being inert the day this client honours a display
   cutout — which is why it is recorded rather than dropped.

### What Part P cannot establish

- **Anything about a release APK.** This is a debug build, and the probe works *because* it is:
  Capacitor enables WebView contents debugging for debug and not for release. The web bundle is the
  same one either build ships, but no measurement here was taken through a signed package. #95 owns
  that.
- **Anything about a second OEM, or a phone.** One tablet, one WebView build, one screen size.
  #87's two-OEM line is untouched.
- **Anything about BLE while offline.** No trainer was paired; aeroplane mode left `bluetooth_on`
  at `2`. Parts B, D and L own the trainer and their tables are still empty.
- **Anything about the browser build**, which is a different client with a different answer and is
  [#408](https://github.com/openzigs/onyourleft/issues/408)'s.
- **Anything about frame rate, thermals or battery.** Parts E, F and H own those, and ADR 0008
  D-2's gate is still waived.
- **That the asset tree inside the APK is what a clean clone would produce.** The copied tree is
  gitignored by design; `pnpm run check:capacitor` is the gate on the two generated files that are
  committed, and it was run.
- **That a worker inside the shell would be harmful.** It establishes only that one would be
  unnecessary. D-4's second argument — an APK update racing a registration holding the previous
  build — is untested and would need a worker to exist inside the shell to test.

---

## Part Q — the ride's stage, the Ride screen and the chase camera ([#423](https://github.com/openzigs/onyourleft/issues/423), [#422](https://github.com/openzigs/onyourleft/issues/422), [#419](https://github.com/openzigs/onyourleft/issues/419), [#424](https://github.com/openzigs/onyourleft/issues/424))

**What was measured on the owner's Pixel Tablet on 2026-09-20, held in landscape, and is the reason
this part exists:** on the trainer game, *Pause*, *End ride* and the trainer status line were all
**below the fold**, beside a display that was about 53 % blank. On the **Ride** screen it was worse:
`WorkoutPanel` was off-screen, so structured workouts were invisible — and a rider who set out to
answer [#372](https://github.com/openzigs/onyourleft/issues/372)'s open ERG question started a plain
recording believing it was a workout. The wire showed Request Control, 103 seconds of nothing, then
Stop. **Zero ERG targets.** A layout defect produced a false answer to a safety question, and it
read as a clean pass.

⚠️ **#373 had called landscape solved and it was not**, and Part L above still carries the sentence
that said so. It moved the trainer line *into* a panel that was itself 572 px tall in a 390 px
viewport.

### What changed, and what it predicts

| | before | after |
|---|---|---|
| The game during a ride | a 16 : 9 canvas capped at 60 % of the height, the HUD stacked under it, under the page's header, title and summary | ⚠️ **the world fills the screen**; the header, navigation, title, summary and footer are **not rendered**; the HUD is four small **opaque** panels laid over the world's corners |
| HUD readings | nine equal fields at 2.5 rem | two tiers: **power, cadence, heart rate** at 2.5 rem; everything else at 1.5 rem |
| Leaving a ride | any navigation link | ⚠️ ***End ride*, and only that.** There is no navigation on the stage. The platform's own Back still works and ends the ride exactly as *End ride* does |
| The Ride screen | one column under a 68-character reading measure | three groups — live, trainer, sensors — side by side where there is width |
| The camera | 8 m back, 3 m up, 60° lens, level gaze | **4.5 m back, 2 m up, 70° lens**, and it **pitches with the road** |
| The rider, share of a 16 : 9 frame's height | 18.1 % | **27.3 %** by arithmetic, **28.1 %** read back off the drawing buffer in the pinned Chromium |
| Roadside scenery level with the rider | in shot | ⚠️ **not in shot** — it enters the frame 0.7 m ahead of the rider. This is a deliberate trade and `apps/web/src/game/camera.ts` argues it |

⚠️ **What a headless Chromium established, and what it cannot.** At 1280×800, 1024×768, 800×1280,
844×390, 736×360, 390×844, 360×800 and 360×752 every reading and both controls are on screen with no
scrolling, no panel is over another or over the rider, and a control that takes the stage away puts
*End ride* below the fold again. The **Ride screen** is measured separately, at 1280×800 and
1024×768, at 1024×720 (a guess at a 4:3 tablet that has lost its bars) and — since
[#439](https://github.com/openzigs/onyourleft/issues/439) — at **1280×800 with edge-to-edge insets
36/32 applied to the engine**, which replaced the 1280×720 guess; every tablet case there prints its
margin to the fold. None of that says
the screen **looks right**, that the panels are where a thumb falls, that a 70° lens is comfortable
for an hour, or that the frame rate held. **Only somebody holding the tablet can say any of that,
and this part is where they say it.**

### ⚠️ Read this before starting

- **Q6 is the safety step and it is the reason for the rest.** It is #372's question, asked again
  now that the control that answers it can be seen. Follow Part D's safety notes: low gear, seated,
  ready to stop pedalling.
- **A notice changes the layout on a phone — for the whole ride.** If the game shows a notice about
  the road not reaching your trainer, then on a phone — either way up — the elevation strip and the
  plan view give their place to it. ⚠️ **Not for a moment: from the first frame to the last.** The
  trainer is read once when the ride starts, four of its six states carry a notice (a structured
  workout in the game is one of them), and nothing dismisses it. That is recorded in
  `apps/web/src/design/theme.css` §"WHERE THERE IS NO FREE CELL", and the remedy is
  [#437](https://github.com/openzigs/onyourleft/issues/437). On the tablet all five are shown.
- ⚠️ **Safe areas are the one thing no gate could measure.** The browser gate fakes an inset and
  watches the panels move. Whether the tablet *reports* one — and so whether a panel sits under the
  status bar or the gesture bar — is Q4.

### Q — the stage, by eye

| Step | What to do | What to record |
|---|---|---|
| Q1 | Tablet in **landscape**. Start a ride in the trainer game with a pacer, a ghost and a wind | Does the world fill the screen? Is the app's header gone? Are *Pause*, *End ride* and the trainer line visible **without scrolling**? |
| Q2 | The same ride. Look at the four panels | Is any panel over the rider, or over the road directly ahead? Are power, cadence and heart rate readable at arm's length, and visibly larger than the rest? |
| Q3 | Rotate to **portrait** mid-ride | Does the layout follow? Does the world redraw at the new shape without stretching — are the wheels still round? ⚠️ This is the orientation that was already working and must not have regressed. ⚠️ Then **pause, rotate back, and look before resuming**: the paused frame is **expected to be stretched** until *Resume* — a known limit, `apps/web/src/game/GameView.tsx` says why — so what to record is whether it corrects itself on the first frame after resuming, and whether it is bad enough to matter when re-seating a tablet on the bars |
| Q4 | Both orientations | ⚠️ Is any panel under the **status bar**, the **gesture bar** or a camera cut-out? Is any panel's edge clipped? |
| Q5 | Press *End ride* | Does the header come back? Then start another ride and leave with the **system Back** gesture instead | 
| Q6 | ⚠️ **The Ride screen, landscape, trainer paired and control granted.** Start a recording first. Are ***Pause* and *Stop*** visible **without scrolling**, and is *Ride a workout*? ⚠️ By measurement *Pause* / *Stop* are the lowest ride controls on this screen, not the workout — they are what a short WebView loses first. Then **record the WebView's size** — see below. Then start a saved workout, ride 60 s, end it | Did the trainer's resistance change when the workout started? ⚠️ **Did it release when the workout ended?** — this is #372, and Part R2 is how to tell; on the owner's trainer it did not, and that is accepted. Capture `adb logcat` filtered for `BluetoothLe`: there must be **`0x05`** Set Target Power writes this time |

⚠️ **Q6's number has been read once, and it changed the gate — #439.** On 2026-09-21 the probe below
answered **1280 × 800, with safe-area insets top 36 and bottom 32**: the app targets API 36, Android
enforces edge-to-edge from 35, and the bars are drawn *over* the WebView rather than taken off it.
`rideview.browser.spec.ts` §`TABLET_IN_THE_SHELL` is now those numbers, applied to the engine; a
reviewer who remembers it guessing 1280×720 is reading the old file. What is still NOT read: the
**portrait** insets (the gate reuses the landscape ones and says so) — run the probe upright too and
add `JSON.stringify(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'))`.
The paragraph that follows is the history. The browser gate used to measure the Ride screen at
1280×800 — the tablet's *display* — and, after #436's review, at **1280×720, which was a guess** at
what the WebView is left once the status bar and the navigation bar are taken off. The Android shell
configures no fullscreen mode, so the two differ, and before that review *Pause* / *Stop* ended at
y = 737: on screen at 800, **below the fold at 728**. They now end at y = 614, which clears a 720 px
fold by 105 px in the pinned Chromium — with this machine's fonts, not the tablet's. With a **debug**
build running and Part P's adb forward in place, in landscape on the Ride screen:

```bash
node apps/mobile/tools/webview-probe.mjs \
  '[innerWidth, innerHeight, devicePixelRatio, document.querySelector(".oyl-ride__group--live button")?.getBoundingClientRect().bottom].join(" ")'
```

Four numbers: the WebView's width and height in CSS pixels, the pixel ratio, and where the first
ride control actually ends on the device. The second is what let
`apps/web/browser/rideview.browser.spec.ts` §`TABLET_IN_THE_SHELL` stop guessing (#439); the fourth
against the second **less the bottom inset** is the real margin to the fold, which no gate here can
take.

**#439 — does the ride still scroll?** With a game ride on the stage, landscape and then upright:

```bash
node apps/mobile/tools/webview-probe.mjs \
  '[innerHeight, document.documentElement.scrollHeight].join(" ")'
```

The two numbers must be **equal**. On 2026-09-21, before #439, they were `800 868`.

### Q — the camera, by eye and by number

| Step | What to do | What to record |
|---|---|---|
| Q7 | A ride on a rolling route | Is the rider prominent — roughly a quarter of the screen's height? Does 30 km/h read as faster than it did? |
| Q8 | A steep climb, then a steep descent | ⚠️ Do you still see road on both? Does the pacer stay in the same part of the screen, or does it go behind the rider (descent) or under the top panels (climb)? |
| Q9 | A pacer **and** a ghost, at roughly 10 m, 50 m and 200 m | #93's third criterion, re-asked: can all three still be told apart? At 10 m on a dead-straight road the pacer's wheels are behind the rider by design — is that a problem in practice? |
| Q10 | Anywhere | ⚠️ Is the 70° lens comfortable? Does anything at the edge of the screen look stretched enough to notice? Would you ride an hour with it? |
| Q11 | 12 s of riding at the target rung, tablet in landscape | the rows below. ⚠️ A lower camera draws more near scenery at a larger size, and the canvas is now the whole screen: this is **fill rate**, which the draw-call counts in the browser gate cannot see |
| Q12 | ⚠️ **Re-import the loop route first** — a route saved before [#440](https://github.com/openzigs/onyourleft/issues/440) keeps the gap in its stored profile. Then start a ride on it and look at the road at 0 % before pedalling; then do the same on a **point-to-point** route | On the loop: the road runs **straight on down the middle of the screen**, with no diagonal white line and no cut edge. Whatever the loop's own closing kink looks like behind the rider is real geometry. On the point-to-point route: **nothing** behind the start line — no wedge of road. If the loop is still broken after a re-import, record the loop's closing gap (the route screen's *not a loop* refusal names it if it is over 25 m) |
| Q13 | ⚠️ **On a phone**, with a workout running on the Ride screen, open the trainer game and start a ride ([#437](https://github.com/openzigs/onyourleft/issues/437)). Ride 20 s, then press ***Trainer notice*** twice | The notice *"…a workout is driving your trainer…"* stands open for about **15 s of ride** and then gets out of the way: the **elevation strip and the plan view come back**. *Trainer notice* reopens it and closes it again. With TalkBack on, the sentence is still read when the notice is put away |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s, landscape, with a pacer and a ghost both in play ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### Q results

| | #323's baseline | Q11 (target rung, full-bleed) |
|---|--:|--:|
| Total frames rendered | | |
| **Janky frames (legacy, > 16 ms)** | 40.63 % | |
| Frame time 50th | 13 ms | |
| GPU time 50th / 90th | 6 / 9 ms | |
| Missed Vsync | | |

**Every control visible without scrolling, landscape (Q1)?** ______________

**Any panel over the rider or the road ahead (Q2)?** ______________

**Portrait still right, and the world not stretched after a rotation (Q3)?** ______________

**Rotated while PAUSED — stretched until *Resume* as expected, corrected on the first frame after, and does it matter (Q3)?** ______________

**Any panel under a system bar or a cut-out (Q4)?** ______________

**Header back after *End ride*, and after system Back (Q5)?** ______________

***Pause* / *Stop* visible without scrolling on the Ride screen, mid-recording, landscape (Q6)?** ______________

**The WebView, landscape — `innerWidth` × `innerHeight`, pixel ratio, and where the first ride control ends (Q6):** ______________

**#439 — `innerHeight scrollHeight` with a game ride on the stage, landscape / upright (equal = fixed):** ______________ / ______________

**#439 — the safe-area insets upright, `top right bottom left`:** ______________

**#440 — the start of a re-imported loop, and of a point-to-point route (Q12):** ______________

**#437 — notice put away after ~15 s, strip and plan view back, reopened by the control (Q13):** ______________

**⚠️ Workout visible, started, and RELEASED on the Ride screen (Q6)? `0x05` writes seen?** ______________

⚠️ **Q6 and the line above used to say `0x04`, and a reviewer who remembers `0x04` is reading the old
file.** Set Target Power is **`0x05`** — `packages/sensors/protocol/src/fitness-machine-control.ts`
§`FTMS_OP_CODE`; `0x04` is Set Target *Resistance Level*, which nothing in this client sends. A tester
looking for `0x04` would see none, conclude that no ERG target was sent, and be wrong: the
false-negative shape #372 exists because of, arriving through a procedure. See the correction on
[#422](https://github.com/openzigs/onyourleft/issues/422).

**Rider prominent; speed reads as speed (Q7)?** ______________

**Road visible on a steep climb and a steep descent; pacer stays put (Q8)?** ______________

**Three riders told apart at 10 / 50 / 200 m (Q9)?** ______________

**The lens, for an hour (Q10)?** ______________

**Device (OEM, model, Android):** ______________  **Build:** ______________

⚠️ **If Q10's answer is no, the remedy is in one file and it is not free.**
`apps/web/src/game/camera.ts` §`CAMERA_FIELD_OF_VIEW_DEGREES` is 70 because that is what keeps 72 %
of the first 25 m of roadside in shot with the camera this close; narrow it and that gate goes red,
which is the gate doing its job. The honest options are a camera further back — which makes the
rider smaller, by the law in that file's header — or accepting a lower near-field share, which is a
decision to record rather than a constant to nudge.

---

## Part R — what does ending ERG leave on the trainer? ([#372](https://github.com/openzigs/onyourleft/issues/372)) ⚠️ run after L, before D

**What was measured, and is the reason this part exists.** On the owner's trainer
(`EB:71:8D:AA:0E:3C`), 2026-09-21:

- `0x05` Set Target Power 200 W, then *End ERG* sent **`0x08` Stop**, acknowledged `80 08 01`, while
  the rider kept pedalling. For 36 s the trainer held 195–201 W at 66–69 rpm; then as cadence
  **fell** 55 → 54 → 52 → 50 → 46 rpm, power **rose** 99 → 131 → 148 → 171 → 175 W. Power rising
  while cadence falls cannot come from a passive brake in a fixed gear: it was an ERG loop still
  chasing 200 W.
- PR #442's build sent **`0x01` Reset** instead, acknowledged `80 01 01`. For 30 s the trainer held
  198–202 W across 64–81 rpm, then power **rose** 120 → 175 → 182 W as cadence fell 64 → 58 → 53 rpm.
  The same ERG signature. And the Reset revoked control, so the rider had to take it again.

⚠️ **This part used to expect a Reset and a released trainer, and a reviewer who remembers that is
reading the old procedure.** **On this machine neither command releases.** The owner accepted
end-of-ride retention on 2026-09-21, on the condition that the app can take control again — measured
and met: after the Reset, *Ask the trainer for control* was answered `80 00 01` and a new 200 W
target `80 05 01`, and the trainer held it. So every release — *End ERG*, the end of a workout, *End
ride* on either screen, navigating away from a game ride — sends **`0x08` Stop** again, through one
method (`TrainerControl.letGo`), and keeps control. #372 stays open as a known limitation.

These steps **record what a trainer does**; they no longer expect it to let go. Their value is on a
second trainer, and in catching a regression in what is sent. **No test in the repository can say
what a real trainer does**: every test asserts what is *sent*.

### ⚠️ Read this before starting

- **The method is the pedal-through test** — L5 says at length why turning the cranks by hand is not
  evidence. Set a target, ride steadily, release **while still pedalling**, keep the gear, then let
  cadence fall. **Released: power falls with cadence. Still in ERG: power holds or rises.**
- Flat pedals, low gear, seated, and the trainer's power switch within reach — Safety item 4. On the
  owner's trainer the target **will** still be there; be ready to stop pedalling and step off.
- **Read power from the trainer**, on the Ride screen's power reading or in logcat's Indoor Bike Data
  — not from a separate power meter, which reports what the rider does rather than what the brake
  does.
- After each release the Trainer panel should show **neither** *Control lost* **nor** *Ask the
  trainer for control*: a release is not a loss, and a Stop keeps control. There is no need to take
  control again between steps.
- After *End ERG* the panel should read ***The trainer may still be holding 200 W — this app can no
  longer tell.*** — and ⚠️ **never** *No target set. The trainer is following your effort.*, which
  is what it said until PR #444's review while the trainer went on holding 200 W. An answered Stop
  is not evidence the machine let go, so a confirmed target becomes an unknown one. Record the exact
  sentence in the *Panel afterwards* column.
- **No `0x00` may follow the `0x08`** in any step. A Request Control after a release is the client
  taking control back on its own — L's note above says how that happened before PR #442's review.
  Record whether a `0xFF` status arrived at all.
- **No `0x01` Reset may appear anywhere.** Nothing in the client sends one since the re-scope.
- If a panel reads **Not released**, the trainer refused or did not answer the Stop. Write down
  exactly what logcat shows.

```bash
adb logcat -c
adb logcat | grep -i "BluetoothLe"
```

| Step | What to do | What should happen |
|---|---|---|
| R1 | Ride screen, control taken. Set an ERG target of **200 W** and ride 60 s at a steady cadence. **While still pedalling**, press ***End ERG***. Keep the gear for ten seconds, then let cadence fall — 80, 70, 60, 50 rpm | In logcat: one **`0x08`** (`08 01`) answered `80 08 01`, **no `0x01`**, and **no `0x00`** after it. Record power as cadence fell — on the owner's trainer, expect it to **hold or rise** (accepted). Then set a new target of 150 W and confirm the trainer holds 150 W: **the app can still drive it**, which is the condition the acceptance rests on |
| R2 | Start a **saved workout** with a long steady block (≥ 150 W). Ride 60 s. **While still pedalling**, end the workout (*End workout*). Then the same cadence ramp | `0x05` writes during the workout, then one `0x08`, no `0x01`, no `0x00` after it. The workout **ends** — it is not shown paused, and there is no *Control lost*. Record power as cadence fell |
| R3 | Start the same workout, ride 60 s, and **while still pedalling** press *Stop* twice to end the **recording** | The same as R2. The workout's release and the ride's are one release, so there is **exactly one** `0x08` after the last `0x05` |
| R4 | Start a workout whose **last block is a free ride**, and ride it to the end | During the free ride there is a **`0x05` at the trainer's lowest target** and no `0x08` — that is #441's ease, and Part S is where it is measured. At the end of the workout there is **one `0x08`** — the release the old code skipped because the free ride had already sent a Stop |

⚠️ **R4 used to expect a `0x08` during the free ride, and a reviewer who remembers that is reading the
old procedure.** Since [#441](https://github.com/openzigs/onyourleft/issues/441) a workout eases the
trainer — a free-ride block, a stalled rider, a paused ride — by writing its **lowest target**, because
on the owner's trainer a Stop does not ease an ERG target and a `0x05` is honoured to within ±2 W.
What R4 checks here is that the **end** of such a workout still reaches the release.

### R results

| Step | Power as cadence fell (rpm → W) | `0x08` answered? | `0x01` seen anywhere? | `0x00` after the `0x08`? | Panel afterwards |
|---|---|---|---|---|---|
| R1 | | | | | new target held? |
| R2 | | | | | |
| R3 | | how many after the last `0x05`? | | | |
| R4 | | | | | |

**What did the trainer keep after each release, in your own words?** ______________

**Trainer (make, model, firmware, address):** ______________  **Build:** ______________

---

## Part S — does a struggling rider get eased? ([#441](https://github.com/openzigs/onyourleft/issues/441)) ⚠️ run after R, before D

**Why this part exists.** Part R measured that on the owner's trainer an acknowledged `0x08` Stop
leaves an ERG target applied. Until #441 a workout eased a rider **inside** the workout with exactly
that Stop, in three places — a free-ride block, a **stalled** rider (the ERG spiral-of-death rule,
cadence at or below 10 rpm), and a paused ride — so on that trainer none of them eased anything, and
the stall rescue, which is the one case where the target most needs to go, did nothing.

The same trainer honoured **`0x05` Set Target Power** to within ±2 W (200 W held at 197–202 W across
64–81 rpm, #372). So since #441 all three write the machine's **own lowest target** — the minimum of
the Supported Power Range it reported, never a number typed into the client — and a rider whose
cadence is merely *collapsing* (not yet stalled) is eased to two thirds of the interval's target, as
before, raised to that floor if it would fall under it. The relief then stays on until cadence has
held for one whole trend window (8 s) — so the target should step back **floor → two thirds → full**,
not flap.

⚠️ **No test in the repository can prove a real trainer eases.** Every test asserts what is *sent*:
a `0x05` with a lower value and no `0x08`. These steps are the proof, and #441's second criterion is
about them.

### ⚠️ Read this before starting

- **S1 is deliberately uncomfortable.** It asks you to let your cadence collapse under an ERG target.
  Flat pedals, a low gear, seated, the trainer's power switch within reach. Stop at once if anything
  surprises you, and write down what.
- **Read power from the trainer** (the Ride screen, or Indoor Bike Data in logcat).
- Write down the trainer's **Supported Power Range minimum** first: the Ride screen quotes the range
  the trainer reported. That number is what every ease should write.

```bash
adb logcat -c
adb logcat | grep -i "BluetoothLe"
```

| Step | What to do | What should happen |
|---|---|---|
| S1 | ⚠️ **The stall rescue — the one that matters.** Ride screen, control taken, start a saved workout with a long steady block at a target you can hold but not comfortably (≥ 200 W). Ride 60 s. Then **stop pushing**: let cadence fall steadily towards zero over 10–15 s without stopping the recording | As cadence falls under ~50 rpm the target should drop to **two thirds** (a `0x05`); once cadence is at or below **10 rpm** a `0x05` at the trainer's **minimum** — and **no `0x08` anywhere**. **Power must FALL** as the rider slows: the brake lets go of the legs. If power holds or rises, the rescue does not work on this trainer: stop and record it |
| S2 | From S1's stall, start pedalling again and settle at a comfortable cadence | The target steps back: two thirds while cadence is under 50 rpm, then — only after about **8 s** steady — the full target. It should **not** flap between full and eased while cadence hovers near 50 |
| S3 | A workout with a **free-ride block** after an ERG block. Ride into the free ride and let cadence fall | One `0x05` at the trainer's minimum as the block starts, no `0x08`, and power **falls** with cadence — the previous interval's target is gone |
| S4 | During an ERG block, press **Pause** while pedalling; keep pedalling slowly for 10 s; then **Resume** | On Pause one `0x05` at the minimum, no `0x08`; power falls with cadence while paused. On Resume the interval's target comes back within a second or two |
| S5 | [#542](https://github.com/openzigs/onyourleft/issues/542). A saved workout with a steady block of at least two minutes. Ride it at a comfortable cadence, with the logcat above running, and count the `0x05` writes in each whole minute of the block | **One** `0x05` at the block's start and **none** after it while the target is unchanged — so 1 in the first minute and 0 in each after. A retry appears only after a write that was refused or not answered. Before #542 this was about one a second (14 in 16 s) |
| S6 | [#567](https://github.com/openzigs/onyourleft/issues/567). ⚠️ **Manual ERG, no workout.** Ride screen, control taken, **no workout running**. Set **150 W** on the Trainer panel's ERG form and ride 60 s. Then stop pushing: let cadence fall from about 70 rpm towards zero over 10–15 s, as in the 2026-09-25 run below | As cadence falls under ~50 rpm the app writes a `0x05` at **100 W** (two thirds of 150), and at or below **10 rpm** a `0x05` at the trainer's **minimum** — **no `0x08` anywhere**. The Trainer panel shows **Eased**, the reason, and *Your 150 W comes back by itself…*. **Power must FALL before the trainer's own firmware lets go** (about 9 s under 40 rpm on this machine): the first `0x05` should be in the log well before that |
| S7 | From S6's stall, pedal again and settle at a comfortable cadence | `0x05` at 100 W while cadence is under 50 rpm, then — only after about **8 s** steady — `0x05` at **150 W**, and the **Eased** notice goes. No flapping |

### S results

| Step | Trainer minimum (W) | `0x05` values seen, in order | `0x08` seen? | Power as cadence fell (rpm → W) |
|---|---|---|---|---|
| S1 | **0** (the value the rescue wrote) | A saved workout with a 200 W block. The owner stalled at 20:41:37–40. At 20:41:41 the app wrote a `0x05` at **0 W**, the machine's minimum. Every write was acknowledged `80 05 01` | **No**, anywhere in the session | **Pass**, as the owner reported it: the rescue fired at the stall. The two-thirds step before the stall is not in the record, because cadence fell in about three seconds |
| S2 | 0 | **133 W** (two thirds of 200 W) at 20:41:43, as the owner pedalled again. Then **0 W** again at 20:42:02 | **No** | **Pass** for the step from floor to two thirds. The later step back to the full 200 W is not in the record, so this does not settle whether the target flapped |
| S3 | | *Not run* | | |
| S4 | | *Not run* | | |
| S5 | | *Not run.* `0x05` writes per whole minute of the steady block: | | |
| S6 | | *Not run* | | |
| S7 | | *Not run* | | |

⚠️ **Manual ERG has no stall rescue, and on this trainer the firmware let go instead.** Before the
workout, the owner set **150 W** on the Ride screen's Trainer panel, with no workout running, and let
cadence fall to **37 rpm**. The app wrote **nothing**. The trainer's own firmware released the load
after about **9 s** (20:35:38–20:35:47). That is how the client is built: the rescue belongs to the
workout player (`erg-safety.ts` §`assessErgCadence`), and a target set by hand does not go through
the player. So S1–S4 pass or fail on a **workout** only. A rider on a manual ERG target is relying
on the trainer, and a different trainer may not let go.

⚠️ **#567's answer, 2026-09-26: a hand-set target now has the same rescue.** The latch the workout
player used is one object now (`erg-safety.ts` §`createErgRescue`), and the Ride screen's ERG form
holds one too (`apps/web/src/ride/manual-erg.ts`): the same stall detection, the same `0x05` ease to
two thirds or to the machine's minimum, never a Stop, through one ERG writer. After recovery the
rider's target is **put back** once cadence has held for a whole window, and the panel says so while
it is eased. **S6 and S7 are the hardware check**, and their result cells are empty. The paragraph
above is the 2026-09-25 finding and stays as it was.

⚠️ **Found along the way: [#542](https://github.com/openzigs/onyourleft/issues/542).** During the
workout, an unchanged target that had already been acknowledged was written again about once a
second, 14 writes in 16 s. It is harmless on this trainer, since every write was acknowledged, but
it looks like the busy loop `player.ts` §`acknowledge` is there to prevent. #542 owns finding out
why.

⚠️ **#542's answer, 2026-09-26: it was not that busy loop.** The player refreshed an unchanged,
acknowledged target on a timer, `REFRESH_SECONDS = 1`, on purpose — #14 recorded a host writing at
about 1 Hz so that a machine which had lost the session would be told again. The quantised
acknowledgement was never involved: this trainer answers 200 W as 200 W, and the player compared
against what it had asked for either way. The refresh is gone. A target is written again only when
the whole watts change, after a write that was refused, timed out or superseded, or after a pause or
a stall put the trainer at its floor. A machine that revokes control says so with a `0xFF` status or
a `0x05` result, and both already pause the workout. The case this gives up is a machine that drops
its target **without** saying so. **S5 is the hardware check**, and its result cell is empty.

**Did the stall rescue take the load off your legs, in your own words?** Not asked in so many words.
The owner reported the rescue as working.

**Trainer (make, model, firmware, address):** Wahoo KICKR CORE (FTMS); firmware not recorded
**Build:** debug, `main` at `cfa8956`, on the Pixel Tablet (Android 17, WebView 153.0.8010.36),
2026-09-25

---

## Part T — the riders' shadows, and what a real shadow map costs ([#426](https://github.com/openzigs/onyourleft/issues/426))

#426 grounded the three bicycles. Two things shipped, and only one of them is on by default:

| | on by default? | what it costs, by construction | where it is measured |
|---|---|---|---|
| **Contact shadows** — a soft blob under the rider and the pacer, placed from `world.ts`'s own sun | **yes, on every rung** | one transparent instanced draw call for all of them (the scenery-free frame is 6 calls, from 5) | `game.browser.spec.ts` §"draws each of the three in its own colour" reads it back, with the shadows off as its control |
| **A shadow map** for the riders only, caught by a shadow-catching plane under them | **no** — `quality.ts` §`RIDER_SHADOW_MAP_RUNG`, above the ladder, and the first thing the ladder gives up — for the rest of the ride, `quality.ts` §`keepsShadowMap` | a shadow pass of the three rider meshes into a 512² depth map, plus the catcher | the pinned Chromium publishes a frame time on a software rasteriser, which says nothing about a phone. ⚠️ Since [#473](https://github.com/openzigs/onyourleft/issues/473) the harness times frames built as `GameView` builds them (lent, no copy); a figure published before it also paid for a ~55 KB copy a frame the product never makes, so the two are not comparable. **This part is the measurement #426 closes on** |

⚠️ **The ghost casts neither, on purpose** (`contact-shadow.ts` §`CASTS_CONTACT_SHADOW`): a bicycle
with no shadow reads as *not really here*, which is #93's at-a-glance criterion. T2 asks whether it
does.

⚠️ **Read Part H's §"The baseline, and where it actually lives" before comparing anything**, and
note that the figure #426 quotes — *"GPU 50th percentile 7 ms during a ride"* — predates
#366/#367/#368. T3 re-takes it without the map first, on the same build, so the comparison is on
one day and one phone rather than across three months of changes.

### T — how the shadow map is switched on

There is **no control for it on any screen**, deliberately (`quality.ts`
§`RIDER_SHADOW_MAP_STORAGE_KEY` says why). With a **debug** build running and Part P's adb forward in
place, on any screen but the game:

```bash
node apps/mobile/tools/webview-probe.mjs \
  'localStorage.setItem("oyl.game.riderShadowMap", "on"), localStorage.getItem("oyl.game.riderShadowMap")'
```

It prints `on`. It is read at the **start** of each ride, so start a new one. To turn it off again,
the same with `localStorage.removeItem("oyl.game.riderShadowMap")`, which prints `undefined`.

### T — the steps

| Step | What to do | What to record |
|---|---|---|
| T1 | Shadow map **off** (the default). Ride any route with a pacer | Does the rider look **on** the road now, rather than floating over it? Does the pacer's blob follow the pacer, and fall on the same side as the rider's? |
| T2 | Ride the same route racing a ghost | The ghost has **no** shadow. Does that read as *"not really here"*, or as a rendering fault? |
| T3 | Shadow map **off**. 12 s of riding, target rung, the `dumpsys` block below | the **off** column |
| T4 | Switch the shadow map **on** (above), start a new ride, and repeat T3 | the **on** column. And by eye: is the real shadow worth having over the blob? |
| T5 | With it **on**, ride for **20 minutes** and note whether the ladder stepped down — the HUD's quality line, or `dumpsys` frame times rising | whether it left the map rung, and after how long. The first step down takes the map away **for the rest of that ride** (`quality.ts` §`keepsShadowMap`): a phone that cools and climbs back to level 0 does **not** get the map back, so the shadow under the rider should change from the real shadow to the blob once and never change back. If it comes back mid-ride, that is a defect — record it rather than the frame times. To measure the map again after a step down, start a **new** ride |

```bash
adb shell dumpsys gfxinfo dev.openzigs.onyourleft reset
# ... ride for 12 s with the game visible, the rider pedalling and the pacer in shot ...
adb shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|Missed Vsync|GPU"
```

### T results

| | T3 — contact shadows | T4 — shadow map | difference |
|---|--:|--:|--:|
| Total frames rendered | not recorded | not recorded | |
| Janky frames (legacy, > 16 ms) | 0 | 0 | 0 |
| Frame time 50th / 90th | 13 / 21 ms (95th 22, 99th 29) | 14 / 21 ms (95th 22, 99th 32) | +1 / 0 ms (95th 0, 99th +3) |
| **GPU time 50th / 90th** | **8 / 12 ms** (95th 13, 99th 21) | **7 / 12 ms** (95th 13, 99th 22) | −1 / 0 ms (95th 0, 99th +1) |
| Missed Vsync | not recorded | not recorded | |

Each column is 12 s of steady riding. T4's column was taken **after** the start of the ride, and
that matters. ⚠️ **The first 12 s of a ride with the map on stalled for about 5 s.** Frame
25 / 32 / 34 / 42 ms (50th / 90th / 95th / 99th), and a GPU 99th percentile of **4 950 ms**. That
one frame is most likely the shadow pass's shaders compiling on first use, but it has not been
measured as that. The first 12 s of a ride with the map **off** were not measured, so whether that start stalls too is
not known. A rider sees it as a freeze at the
start of the ride, and whether the map becomes a rung has to account for it.

**Does the rider stand on the road (T1)?** **Yes.** The rider is on the road, and the pacer has its
own shadow.

**Does the ghost read as not-really-there, or as broken (T2)?** *Not run.*

**Is the real shadow worth having over the blob, by eye (T4)?** **Yes**, in the owner's words: *"use
bike shaped shadow over blob"*. Filed as [#547](https://github.com/openzigs/onyourleft/issues/547).

**Did the ladder leave the map rung in 20 minutes, and when (T5)? Did the map ever come back in the same ride?** *Not run.*

**Phone (OEM, model, Android):** Google Pixel Tablet, Android 17, WebView 153.0.8010.36
**Build:** debug, `main` at `cfa8956`, 2026-09-25

**The decision this is for**, to be written on #426 when the table is filled: the shadow map
**lands as a rung** (and on which devices it is offered), or it is recorded as **"measured, not
worth it"** with the numbers above and the rung is removed. #426 stays open until one of the two is
written down; it was opened with `Refs`, not `Closes`, for exactly this. ⚠️ **As of the
2026-09-25 session it is not written down yet.** The owner's by-eye answer points towards landing
the map, and #547 asks for more than that: the map as the stylised world's default. But T5 (whether
the ladder holds the map for 20 minutes) and the start-of-ride stall above are both still open.

---

## Part U — the audio lets go even when a ride ends as it starts ([#455](https://github.com/openzigs/onyourleft/issues/455))

#447 let the platform stop running the audio when a ride ends. #448's review found the one window it
missed: a `suspend()` asked for while a `resume()` was still in flight did nothing, because the
context still said *suspended* — and the resume then landed and left the audio running with nobody
riding. `apps/web/src/game/web-audio.ts` §`waking` now honours the suspend in that window.
⚠️ **Practically unreachable by hand**, which is why the fix is tested against the injected port and
not argued from a device. What a phone can check is that the ordinary path still behaves, and that a
fast end does not leave the audio held.

Sounds **on** (Settings → Sounds). Headphones as in
[validation 0003](0003-screen-reader-and-assistive-technology.md) Part I.

| Step | What to do | What should happen |
|---|---|---|
| U1 | Start a game ride and press **End ride** as fast as you can after **Ride** | Nothing left sounding, and — the check — music started in another app straight afterwards is **not** ducked or interrupted |
| U2 | Straight after U1, start another game ride | Its distance sound is heard at the first mark: the press on *Ride* woke the audio |
| U3 | Repeat U1 five times in a row | The same every time. A single run where the music stays ducked is the finding |

### U results

| Step | As described? | What was heard | Headphones (wired / Bluetooth, model) |
|---|---|---|---|
| U1 | | | |
| U2 | | | |
| U3 | | | |

**Phone (OEM, model, Android):** ______________  **Build:** ______________

---

## Part V — does a climb look like a climb? ([#458](https://github.com/openzigs/onyourleft/issues/458))

Until #458 the ground was one flat quad at the rider's own height that moved with them, so a 10 %
climb lifted the road off a level world and a descent dived through it. Since #458 the ground either
side of the road is a **landform** (`apps/web/src/game/landform.ts`): it stands at the height of the
road beside it, it rises on one side of a climb and falls away on the other (a road cut across a
hillside), it is **lit**, and it **writes depth** — so a hillside hides what is behind it. A ring of
hazed hills stands on the horizon. **Heights come from the route and a seeded hash only**; nothing is
fetched, and the gradient sent to a trainer is unchanged (it comes from the route profile, #362).

⚠️ **What the pinned Chromium measured, and what it cannot.** The browser gate reads a height off
the drawing buffer by occlusion and publishes the landform's cost — **1 222 vertices, 6 624 indices,
one draw call**, and **7 draw calls** for the scenery-free scene where there were 6 (the ring is the
new one). Each rung of the quality ladder draws fewer bands of ground: 6 624 / 5 520 / 5 520 / 4 968
/ 4 416 indices. ⚠️ **Five figures since #482, and a reader who remembers four —
6 624 / 5 520 / 4 968 / 4 416 — is reading the pre-#484 file**: the ladder gained a rung, level 2
repeats level 1's ten bands, and only its frame cap differs (#485). A software rasteriser says
nothing about a phone's GPU, which is what V3 is for.

⚠️ **V3 is also [#469](https://github.com/openzigs/onyourleft/issues/469)'s device check, and it is
PENDING.** #469 stopped the ground, the water and the settlements allocating fresh storage every
frame: the ground's four arrays and the water's three are now lent and reused, and the buildings are
de-duplicated by a number rather than a string. Measured on 2026-09-21 in **Node 24's V8, not on a
phone and not in the pinned Chromium**, riding `sceneFrame` 3 000 frames at 0.15 m a frame (9 m/s at
60 fps) over three fixture routes, before and after on the same machine:

| Route | Typed-array storage a frame | JS heap allocated a frame | Minor GCs per 1 000 frames | `sceneFrame` median |
|---|---|---|---|---|
| `hillRoute`, from 300 m | 14 arrays, 68.2 KB → 5, 13.0 KB | 453 KB → 451 KB | 88.7 → 88.7 | 0.22–0.31 → 0.22–0.24 ms |
| `lakeValleyRoute`, from 800 m | 15 arrays, 70.0 KB → 6, 13.7 KB | 1 658 KB → 1 152 KB | 156 → 72 | 0.44–0.48 → 0.41–0.43 ms |
| 20 km level farmland, from 2 km | 14 arrays, 68.2 KB → 5, 13.0 KB | 1 360 KB → 1 059 KB | 138 → 75 | 0.42–0.43 → 0.39–0.47 ms |

Method: typed-array constructions counted by wrapping the constructors for one pass; the JS heap by
V8's sampling heap profiler (`HeapProfiler.startSampling`, 512-byte interval, collected objects
included), which does not see a typed array's backing store — hence the two columns; GCs by
`PerformanceObserver` `gc` entries; time as the median of eleven runs, three runs each way
interleaved, and the range is across those three. What is left in the typed-array column is the
road's own (`terrain.ts` §`roadCorridor`) and the horizon's 192 bytes, which #469 did not take on;
what is left on the heap is mostly small objects and numbers — the relief and water shaping at every
vertex, the scenery and the settlements' clearance search. `apps/web/src/game/lent-buffers.test.ts`
pins the reuse. What only a phone can say is whether the legacy-jank row moves, so **record V3
against a build that has #469 in it, and say so** beside the build. Part F's 0.11 % is the figure to
compare it with.

| Step | What to do | What to record |
|---|---|---|
| V1 | Ride a **real hilly route** — one with a sustained climb of 6 % or more and a descent | Does the climb read as a **climb**: ground rising beside the road ahead, a hillside on one side? Does the descent open a **valley** in front of you? In your words |
| V2 | On the same route, watch the edge of the road for a minute on the climb and on a bend | Any **crack** between the road's edge and the ground — sky or a light line showing through? Any ground **over** the road on a bend? (Neither should happen: the ground is built on the road's own edge) |
| V3 | 12 s of riding at the target rung, the `dumpsys` block from Part T | Frame times with the landform on |
| V4 | Look at the horizon on a flat stretch | Are there hills on the horizon, or a hard line where the near ground ends? |
| V5 | Ride past the same stretch on lap two of a loop | The same hills and hillsides in the same places |

### V results

| | V3 |
|---|--:|
| Total frames rendered | |
| Janky frames (legacy, > 16 ms) | |
| Frame time 50th / 90th | |
| **GPU time 50th / 90th** | |

**Does a climb read as a climb, and a descent as a valley (V1)?** ______________

**Any crack at the road's edge, or ground over the road (V2)?** ______________

**Hills on the horizon, or a hard edge (V4)?** ______________

**The same place on lap two (V5)?** ______________

**Route ridden:** ______________  **Phone (OEM, model, Android):** ______________  **Build:** ______________

---

## Part W — water in the route's valleys, and the bridges over it ([#459](https://github.com/openzigs/onyourleft/issues/459))

#459 puts a **stream across the road at every valley floor** of a route — a point that is the lowest
for 300 m either way, with the road climbing at least 8 m out of it on both sides — and a **bridge**
carrying the road over it: stone parapets, a slab under the deck and two abutments. A **lake** lies
beside a long, level, low stretch that the road climbs out of at both ends. All of it is placed from
the route's own elevation and a seeded hash (`apps/web/src/game/waterways.ts`); nothing is fetched.
⚠️ **The deck is the road, unchanged, and the gradient a trainer is sent there is the route's** —
`waterways.test.ts` rides the gradient session across the bridge and compares every grade it sends.
Nothing from the scenery stands in the water or on its banks.

The water is a **shader**, not a texture and not a second render: the sky reflected with a Fresnel
term, ripples scrolling on the ride's own clock, and the edges tinted shallow. On the quality ladder
it is shaded on the target rung only and one flat colour below it. The pinned Chromium measured the
valley frame at **1.05 ms shaded against 1.04 ms flat** on a software rasteriser — which says nothing
about a phone, and is why W3 exists. Water and bridges are **two draw calls** when either is in view,
and none when neither is.

| Step | What to do | What to record |
|---|---|---|
| W1 | Ride a **real route that crosses a valley** — down into it and out again | Is there a stream at the bottom, and a bridge carrying the road over it? Does the water read as water — does it move, does it reflect the sky? |
| W2 | Look at the bridge as you ride over it | The parapets on both sides; nothing floating, nothing buried; the road surface itself exactly as on either side of it. ⚠️ And **either side of the bridge** (#468's review, B2): the road runs on a solid stone approach down to where the bank meets it — never a strip of tarmac over an open trench |
| W3 | 12 s of riding with the bridge and water in view, target rung, the `dumpsys` block from Part T | Frame times with the water shaded |
| W4 | If the route has a long level valley floor: ride along it | A lake beside the road? No trees standing in it? |
| W5 | ⚠️ **Only after Part L, with the trainer handed to the game.** Ride across the bridge | The resistance through the valley follows the ROAD — down the approach, up the far side — and does not go flat over the bridge |
| W6 | Ride a route with **no valley** | No stream, no bridge |

### W results

| | W3 |
|---|--:|
| Total frames rendered | |
| Janky frames (legacy, > 16 ms) | |
| Frame time 50th / 90th | |
| **GPU time 50th / 90th** | |

**Stream and bridge where the valley is, and solid road either side of it (W1, W2)?** ______________

**A lake beside a level valley floor, nothing standing in it (W4)?** ______________

**Resistance followed the road across the bridge (W5)?** ______________

**Nothing on a route with no valley (W6)?** ______________

**Routes ridden:** ______________  **Phone (OEM, model, Android):** ______________  **Build:** ______________

---

## Part X — villages, farmsteads, and fields with walls ([#460](https://github.com/openzigs/onyourleft/issues/460))

Until #460 every building was one scatter kind, placed wherever a tree could stand: alone, at any
angle, anywhere in the band. Since #460 buildings stand in **places** (`apps/web/src/game/settlements.ts`):
on level, low, dry stretches of the route a seeded field puts a **village** — a street of houses at
one setback, all facing the road, a **row of shops** at its middle, a **church** at one end and a
**signpost** at each way in — or a **farmstead**: a farmhouse, a **barn** and a **shed** grouped on
one side. Fields beside the road are **walled** on higher or steeper ground and **hedged** or
**fenced** on the low flat land, along the verge and out from the road. ⚠️ **Signposts carry no
words** — no real name, brand or signage. Everything new is built from numbers in
`three-renderer.ts` §`STRUCTURE_STYLE`; no model was added.

⚠️ **What the pinned Chromium measured.** The scenery belt's ceiling is **20** meshes where it was 12
(eight new kinds of one shape each), so the scenery can spend up to 20 draw calls; a village frame
drew **21 calls against 14** without its structures, and timed **4.48 ms against 3.04 ms** — on a
software rasteriser, which is not a phone. On the quality ladder the structures have their own
budget, 240 → 120 → 60 → 40: houses are kept and the far field boundaries go first.

| Step | What to do | What to record |
|---|---|---|
| X1 | Ride a **real route with a long level stretch low down** — a valley road | Villages and farmsteads, rather than houses one at a time? Do the houses face the road? Is the church a landmark you can see coming? |
| X2 | Look at the five kinds of building as you pass | Can you tell a house, a barn, a church, a row of shops and a shed apart by their shape? |
| X3 | Look along the fields | Walls, hedges or fences along the verge and out from the road; walls on the higher ground. ⚠️ On a **hairpin or a tight bend** (#468's review, B1): no wall, hedge, fence or building standing on the road — the other leg of the hairpin included |
| X4 | The signposts at a village's ends | A blank board: no words, no name |
| X5 | 12 s of riding through a village with its fields in view, target rung, the `dumpsys` block from Part T | Frame times with the new kinds on |
| X6 | Ride through the same village on lap two of a loop | The same houses in the same places — and ⚠️ the **same field colours** between the same walls (#468's review, B3: on its first head every field changed colour on lap two) |

### X results

| | X5 |
|---|--:|
| Total frames rendered | |
| Janky frames (legacy, > 16 ms) | |
| Frame time 50th / 90th | |
| **GPU time 50th / 90th** | |

**Places rather than houses, facing the road (X1)?** ______________

**Five buildings told apart by shape (X2)?** ______________

**Walls, hedges and fences where described (X3); nothing on the road at a hairpin; blank signposts (X4)?** ______________

**The same village, and the same field colours, on lap two (X6)?** ______________

**Route ridden:** ______________  **Phone (OEM, model, Android):** ______________  **Build:** ______________

---

## Part Y — a sky with a gradient, and surfaces with detail ([#425](https://github.com/openzigs/onyourleft/issues/425), the no-asset half)

#425 asked for the road and the ground to be textured and the sky to be more than one colour. What
ships is **the half that needs no asset**; the photographic surfaces, KTX2 and an HDRI sky wait for
[#431](https://github.com/openzigs/onyourleft/issues/431), the ADR that decides whether the world goes
realistic.

- **The sky** is a vertical gradient from the route's own sky colour overhead to its haze at the
  horizon — a dome of vertex colours, one draw call, no texture.
- **The road** carries a grain and **the ground** a mottle, both computed in the fragment shader from
  where the pixel is, and the ground a **patchwork of fields** on the same grid the walls stand on
  (#460). ⚠️ **No texture is sampled**, so "no texture reaches the GPU" (#366) still holds and
  ADR 0022 is not amended. The grain **multiplies** the road's gradient tint and is bounded so the
  steepest climb and descent still differ by the WCAG contrast the cue needs.
- It **fades out with distance** — noise at a grazing angle shimmers, and #424's low camera makes
  that worse — and it is on the **target rung only**: the first step down the quality ladder drops
  it, and since [#482](https://github.com/openzigs/onyourleft/issues/482) that step keeps the
  display's rate, so the detail goes one step before any rung caps the frame rate at all. (Between
  [#476](https://github.com/openzigs/onyourleft/issues/476) and #482 the same step also took the frame
  rate from 60 to 30 — see Part Z's frame-rate note.)

⚠️ **What the pinned Chromium measured**: the sky 25° up and 8° up are two colours (and one colour
with the haze set to the sky, the control); a patch of carriageway varies by 1.82 levels with the
detail and 0.00 without; the ground's detail changes 120 000 pixels of a 600 × 400 frame. The
scenery-free scene is **8 draw calls** (the dome is the new one).

| Step | What to do | What to record |
|---|---|---|
| Y1 | Ride any route in daylight on the target rung | Is the sky darker and bluer overhead and paler at the horizon? |
| Y2 | Watch the road just ahead of the bicycle, and the ground beside it, at speed | A surface, or noise? ⚠️ **Any shimmer or crawling** — especially further ahead, at a grazing angle — is the finding |
| Y3 | Watch a climb and a descent | Is the gradient tint on the road still as easy to read as before? |
| Y4 | Look at the fields beside the road on a level stretch | Fields of different greens and a yellower crop, meeting where the walls and hedges are? |
| Y5 | 12 s of riding, target rung, the `dumpsys` block from Part T; then the same with the quality ladder one rung down (a hot phone, or Part E's forcing). ⚠️ **Since #482 "one rung down" is still the display's rate**, so the two rows differ in detail and not in frame cap — the comparison this row always wanted; a Y5 row taken between #476 and #482 compared 60 fps against 30 | Frame times with the detail on, and off |

### Y results

| | Y5 — detail on | Y5 — one rung down |
|---|--:|--:|
| Total frames rendered | | |
| Janky frames (legacy, > 16 ms) | | |
| Frame time 50th / 90th | | |
| **GPU time 50th / 90th** | | |

**Sky graded (Y1)?** ______________

**Surface or noise; any shimmer, and where (Y2)?** ______________

**Gradient tint still legible (Y3)?** ______________

**Fields meeting at the walls (Y4)?** ______________

**Phone (OEM, model, Android):** ______________  **Build:** ______________

---

## Part Z — the realistic world on the tablet, and the twenty-minute soak ([#430](https://github.com/openzigs/onyourleft/issues/430), [#425](https://github.com/openzigs/onyourleft/issues/425), [#474](https://github.com/openzigs/onyourleft/issues/474), [#369](https://github.com/openzigs/onyourleft/issues/369); [ADR 0026](../adr/0026-realistic-game-world.md))

The realistic world's first three layers — ground, road and sky (#425), trees, shrubs and rocks
(#474), and the rider (#369) — are in the product, built by #430's pipeline, and **reachable from
no control in the shipped app**: ADR 0026 D-12 offers the world to riders only when it is whole,
and layer 3 (structures) is [#475](https://github.com/openzigs/onyourleft/issues/475). The one way
to it is the owner's page, `apps/web/browser/realistic.html`, staged into a **local debug APK**.
This Part is what that page is for.

⚠️ **Since #475's build half, layer 3 is in too, and the soak now follows it.** Every structure
kind is drawn on the realistic rungs in **CC0 photographic surfaces** — brick and clay tile on a
house and a row of shops, boards and corrugated iron on a barn, stone and slate on a church, stone
on a field wall, boards on a fence, leaves on a hedge (`realistic-assets.ts`
§`REALISTIC_STRUCTURE_SURFACES`). ⚠️ **The shapes are this repository's own, built from numbers**:
no source in ADR 0026 D-4's list publishes a whole country building (Poly Haven's "buildings" are
urban facade kits of 118 000–175 000 triangles), so what is photographic is what covers them. The
water stays #459's procedural shader and now **reflects the realistic sky's own colour**
(`three-renderer.ts` §`WaterBelt.update` argues why it stays procedural). Z9 and Z10 below are the
two looks that change, and the rider control still waits for the soak — #475.

### What is already measured, and where it came from

The provisional budget in `apps/web/src/game/realistic-budget.ts` (ADR 0026 D-6) rests on the one
device run there is: #457's spike on the owner's Pixel Tablet, **2026-09-22**, posted on
[#471](https://github.com/openzigs/onyourleft/pull/471), one page load per configuration, **30-second
windows**, `?panel=0`, no errors and no stalls in any configuration.

| Configuration (spike page) | Frame p50 / p90 / p99, page | Draw calls | Triangles | Textures | Texture estimate |
|---|---|--:|--:|--:|--:|
| baseline (the product) | 16.6 / 16.7 / 16.8 ms | 21 | 29 376 | 0 | 0 |
| sky + environment, AgX | 16.6 / 16.7 / 16.8 ms | 21 | 28 668 | 3 | 40 MiB |
| surfaces 1K | 16.6 / 16.7 / 16.8 ms | 21 | 29 376 | 7 | 32 MiB |
| surfaces 2K | 16.6 / 16.7 / 16.8 ms | 21 | 29 376 | 7 | 128 MiB |
| trees + impostors | 16.6 / 16.7 / 16.8 ms | 28 | 239 060 | 28 | 187 MiB |
| rider | 16.6 / 16.7 / 16.8 ms | 24 | 43 034 | 2 | 0 |
| all on, scale 1 | 16.6 / 16.7 / 16.8 ms | 45 | 252 024 | 51 | 355 MiB |

| `dumpsys gfxinfo`, ≈ 1 000 frames | Frame p50 / p90 / p99 | **GPU p50 / p90 / p99** | Janky (modern) |
|---|---|---|--:|
| baseline | 9 / 31 / 32 ms | **3 / 14 / 15 ms** | 0.19 % |
| all on, scale 1 | 26 / 30 / 61 ms | **10 / 19 / 4 950 ms** (the p99 is the asset upload) | 0.60 % |

Every row held the 60 Hz vsync; the GPU column is what reads the headroom, and all-on was **over
the 16.7 ms frame at its p90**. Thermal status 0 throughout. ⚠️ **What this PR ships is not the
spike's all-on**: 1K surfaces rather than 2K, trees at 512 px with their roughness maps dropped, the
near-mesh band capped by count (`REALISTIC_NEAR_MESHES`), and the road's sheen cut to a quarter so
its gradient tint survives AgX (`three-renderer.ts` §`ROAD_SHEEN`). The estimate this PR's own gate
holds it to is under 160 MiB of textures and 300 000 triangles; what that costs on the tablet is
Z5–Z8 below, and **no part of it has been measured on a device yet**.

⚠️ **The frame cap is honoured since [#476](https://github.com/openzigs/onyourleft/issues/476),
and this paragraph used to say it was read by nothing — a reader who remembers "every rung draws
at the display's rate" is reading the old file.** The owner's rulings (2026-09-22, #476 and then
[#482](https://github.com/openzigs/onyourleft/issues/482)): **the top TWO rungs of the stylised
ladder draw at the display's rate — 60 Hz on the tablet, and never above it — the first of them at
full detail and the second with reduced resolution and scenery, and only the three below cap, at
30 → 24 → 20** (`quality.ts` §`QUALITY_LADDER`). ⚠️ **A reader who remembers the first step down
cutting to 30 fps is reading the #476 file**: between #476 and #482 it took the resolution, the
scenery and the drop from 60 to 30 in one step. Both **realistic** rungs are the stylised ladder's top
two with the world swapped, so they draw at the display's rate too, and a hot tablet gives up realism
two steps before it gives up any frame rate: the first capped rung it can reach is the stylised
ladder's level 2, at 30. What that means for a number read here:

| Rung (`world` · `rung` on the page) | Frame cap | Frame p50 on a 60 Hz display that keeps up |
|---|---|--:|
| realistic · realistic | display rate | 16.7 ms |
| realistic · realistic, reduced resolution and scenery | display rate | 16.7 ms |
| stylised · full | display rate | 16.7 ms |
| stylised · reduced resolution and scenery | display rate | 16.7 ms |
| stylised · reduced resolution and scenery, 30 fps | 30 fps | 33.3 ms |
| stylised · reduced resolution, scenery and frame rate | 24 fps | 33.3 or 50 ms — the two alternate, so a p50 reads one of them; 41.7 ms is their **mean**, not a median |
| stylised · minimum | 20 fps | 50 ms |

**The page's frame p50/p90/p99 are the time between DRAWN frames**, so on a capped rung they read the
cap, not a fault; `frameCap` is in every `OYL-REALISTIC` and `OYL-REALISTIC-SOAK` line and on the
readout, so a row always says which it was. `dumpsys gfxinfo` counts what the WebView presents, which
at a capped rung includes the vsyncs this page skipped. The quality ladder is fed the time a drawn frame
held the next one off (`frame-pacer.ts`), never a skipped frame's idle vsync and never the cap, so a
capped rung does not read itself as hot or as cool. ⚠️ **A soak run before #476 drew every rung at
the display's rate**; its rows at a stylised rung below the top are not comparable with one after it.

### Build and install

On the developer machine (macOS paths; Node 24 and pnpm 11 as CLAUDE.md §4a):

```bash
ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

pnpm install --frozen-lockfile
pnpm run build                                          # the product, into apps/web/dist
pnpm --filter @onyourleft/web run realistic:stage       # the owner's page, into apps/web/dist/harness/
( cd apps/mobile && pnpm exec cap sync android )
pnpm run check:capacitor                                # cap sync must not have changed a committed file
( cd apps/mobile/android && ./gradlew assembleDebug )
unzip -l apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk | grep 'public/harness/realistic.html'
"$ADB" install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

⚠️ `install -r` keeps the app's data only when the installed build is signed with the same debug key.
If it fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, **stop** — uninstalling erases the rides on the
tablet. ⚠️ The staged page is gone after the next `pnpm run build`; a release is built from a clean
checkout and has never had it in it.

Open the page in the app's own WebView (Part P's probe):

```bash
"$ADB" shell svc power stayon true
"$ADB" shell monkey -p dev.openzigs.onyourleft -c android.intent.category.LAUNCHER 1
PID=$("$ADB" shell pidof dev.openzigs.onyourleft)
"$ADB" forward tcp:9222 localabstract:webview_devtools_remote_"$PID"
node apps/mobile/tools/webview-probe.mjs "location.href = '/harness/realistic.html'"
```

The page rides a 4 km route through a valley, over a bridge and past a farmstead, at 9 m/s. Its
buttons switch between the realistic and the stylised world, hold or free the quality ladder, and
start one rung down. Back to the app: `node apps/mobile/tools/webview-probe.mjs "location.href = '/'"`.

⚠️ **Since [#478](https://github.com/openzigs/onyourleft/issues/478) the page says three more things
in `logcat`, and the first run after it should record them.** On 2026-09-22 (main `eacc152`) the
tablet's WebView logged `Uncaught TypeError: Cannot read properties of undefined (reading
'triggerEvent')` on this page, and its readout showed `frame p50 NaN ms`. The `NaN` was the page's own:
the readout was computed over the measurement window, which the page empties every frame once the
30-second figure is published — so it was `NaN` during the warm-up and for the rest of every ride.
It reads the clock's own rolling window now. The `TypeError` is Capacitor's: the shell sends its
lifecycle events by evaluating `window.Capacitor.triggerEvent("resume", "document")` in the page
(`MockCordovaWebViewImpl`, when the app resumes after a pause).

⚠️ **This paragraph used to say "on this page there was no `window.Capacitor`", and blamed the
harness page — a reader who remembers that is reading the old file.** [#480](https://github.com/openzigs/onyourleft/issues/480)
settled it the other way. On 2026-09-22 (main `89a5d9b`) the tablet logged the same `TypeError`
**twice within the first second of launching the app**, with logcat cleared just before, and
**before anything navigated to this page**; the page itself then reported
`capacitorAtStart: "object"`. So the bridge reaches this page, and the error is the app's launch. In
Capacitor 8.5.2 the only code that evaluates `triggerEvent` in a page is `MockCordovaWebViewImpl`'s
`pause` and its `resume`-after-a-pause, posted to the main looper to run against whatever document
the WebView holds by then; the bridge is injected for the app's origin only, so a `window` without
it in the first second is the WebView's initial blank document, before the app's page has
committed. Two errors are one pause and one resume at launch. It is **harmless**: that document is
discarded, and nothing in this client listens for Capacitor's `pause` or `resume` — the app reads
`visibilitychange`. `apps/mobile/src/android/lifecycle-events.test.ts` asserts both premises
against the installed Capacitor and this repository's sources. **What only the device can confirm**,
on the next launch with logcat cleared:

```bash
"$ADB" logcat -d -b events | grep -E 'wm_on_(paused|resume)_called.*MainActivity'   # a pause and a resume at launch
"$ADB" logcat -d -s chromium | grep triggerEvent                                     # its source: is NOT https://localhost/…
```

If the two errors do **not** sit beside a pause and a resume, or their `source:` is the app's own
page, the argument above is wrong and #480's third item is open again.

The page still records the bridge before any other script runs, which is how this was settled:

```bash
"$ADB" logcat -d | grep -E 'OYL-REALISTIC-(LOAD|BRIDGE|ERROR)'
```

- `OYL-REALISTIC-LOAD {"bridge":{"capacitorAtStart":…,"androidBridgeAtStart":…,"standIn":…}}` — one
  line per load. `capacitorAtStart: "object"` means Capacitor's bridge reached this page, which is
  what the tablet reported on 2026-09-22. `"undefined"` with `androidBridgeAtStart: "object"` means the WebView
  gave the page Capacitor's message channel but Capacitor's document-start script did not run on it;
  both `"undefined"` means neither reached it.
- `OYL-REALISTIC-BRIDGE {"event":"resume","target":"document"}` — a lifecycle event the shell sent to a
  page with no bridge. The page stands in for `triggerEvent` alone, so the event is recorded and still
  dispatched instead of thrown; it defines no `isNativePlatform`, so the page does not claim to be the
  shell.
- `OYL-REALISTIC-ERROR …` — any error, including one before the page's own module ran. The same list
  is on `window.__oylRealistic.errors` and in the red box at the foot of the page.

⚠️ Since #478 the page also builds each frame at the **rung's own scenery budget**, as `GameView`
does, and the realistic world's trees, shrubs and rocks spend that budget with the posts and
buildings rather than beside it. Before it, the second realistic rung reduced the resolution and the
water and drew every tree — so a soak on the page before #478 measured a ladder the product does not
run, and its Z6/Z7 numbers should not be compared with one after it.

### The procedure

Landscape, full brightness, on charge, nothing else running; let the tablet cool first.

| Step | What to do | What to record |
|---|---|---|
| Z1 | Open the page. Let it ride for a minute | Does the realistic world load at all? The line at the top says **realistic world · realistic** — if it says **stylised** with a sentence under it, that sentence is the finding |
| Z2 | Look at the **road** just ahead and far ahead, at speed | A surface, or noise? ⚠️ **Any shimmer or crawling at a grazing angle** is #425's criterion, and it is the owner's to judge — nothing in CI can see it |
| Z3 | Watch a climb and a descent (the route has both) | Is the gradient tint on the road still as easy to read as the stylised world's? The browser gate measured 3.97 : 1 between the steepest climb and descent; the eye is the check |
| Z4 | Look at the trees near and far, and at the point where a tree changes from a mesh to a picture | Do the near trees look sparse beside the far ones (the thinned canopy — spike 0005 §2)? Is the switch visible? |
| Z5 | Look at the rider from behind, and hold the ride still: `location.href = '/harness/realistic.html?at=900&panel=0'` | Do the legs follow the pedals? With the ride held (`?at=`), do the legs STOP? — #349's rule for the realistic rider |
| Z6 | `?panel=0&ladder=0`, 30 s; then `?world=stylised&panel=0&ladder=0`, 30 s — each with the `dumpsys` block below. ⚠️ **Both are TOP rungs, so both draw at the display's rate, 60 Hz** (#476) — this is realistic against stylised at 60, and nothing about a cap | Frame and GPU percentiles, realistic against stylised |
| Z7 | **The soak**: `?soak=20&panel=0` — the ladder free, as a rider would have it. ⚠️ **It starts at the realistic top rung, at the display's rate (60 Hz)**, and every minute's line says the rung and its `frameCap`: while it says `display` it is measuring 60 fps — and since #482 that is **four** rungs, not two: realistic, realistic reduced, stylised full and stylised reduced, so a minute at `display` can already be two steps down, and the `world` and `rung` columns say which. Stepping down now looks like: the picture softens and thins **at 60** (realistic reduced), then the world changes to stylised **at 60**, softens and thins again **at 60**, and only then does the frame rate fall — a minute that says `30`, `24` or `20` is a stylised rung the ladder stepped to, and its frame times read that cap. ⚠️ Each step needs thirty drawn frames of heat, so the ladder reacts in half a second at `display` and in 1.0, 1.25 and 1.5 s at 30, 24 and 20 (`quality.ts` §`SUSTAINED_SAMPLES`) | One line a minute; thermal status; the rung **and frame cap** it ends on |
| Z8 | During Z7, once at minute 10: `"$ADB" shell dumpsys meminfo dev.openzigs.onyourleft \| grep -iE "Graphics\|GL mtrack\|TOTAL"` | What the driver actually holds, against the 160 MiB estimate (the estimate is **136 MiB** since #475's structures) |
| Z9 | Ride past the farmstead and any village: `?panel=0&ladder=0`. Look at a house, a barn, a wall and a hedge from the road | Do the walls read as brick, board and stone, and the roofs as tile, slate and iron? Is a brick the same size on every wall (it should be — the photographs are laid out in metres)? ⚠️ **The hedge is the weakest**: it wears leaf litter tinted green, the nearest photograph any admitted source publishes — say whether it reads as a hedge |
| Z10 | Ride over the bridge and past the lake | Does the water take the sky's colour — grey under grey cloud, not the stylised world's blue? Any seam where it meets the bank? |

⚠️ **Two corrections from the first run of this Part (2026-09-23), and the commands below carry them.**
The page's lines reach `logcat` under **`Capacitor/Console`**, not `chromium` as this Part and the
harness's own header said — `-s chromium` filters every one of them out, so the commands grep the
whole log instead. And `dumpsys thermalservice`'s first `Temperature{…}` block is **`Cached
temperatures`**, which did not change once in twenty minutes while the sensors moved by several
degrees; the soak now reads **`Current temperatures from HAL`**. It also reads a twenty-first
minute, because the page publishes minute N's line during minute N + 1 and the first run's loop
ended one line short.

Each 30-second row:

```bash
"$ADB" shell dumpsys gfxinfo dev.openzigs.onyourleft reset
node apps/mobile/tools/webview-probe.mjs "location.href = '/harness/realistic.html?panel=0&ladder=0'"
sleep 40
"$ADB" logcat -d | grep 'OYL-REALISTIC ' | tail -1
"$ADB" shell dumpsys gfxinfo dev.openzigs.onyourleft | grep -iE "Total frames|Janky|percentile|GPU"
"$ADB" exec-out screencap -p > realistic-z6.png
```

The soak:

```bash
"$ADB" shell dumpsys gfxinfo dev.openzigs.onyourleft reset
node apps/mobile/tools/webview-probe.mjs "location.href = '/harness/realistic.html?soak=20&panel=0'"
for minute in $(seq 1 21); do
  sleep 60
  "$ADB" logcat -d | grep 'OYL-REALISTIC-SOAK ' | tail -1
  "$ADB" shell dumpsys thermalservice | grep 'Thermal Status'
  "$ADB" shell dumpsys thermalservice | awk '/Current temperatures from HAL/{f=1;next} /Current cooling/{f=0} f' \
    | grep -E 'G3D|BIG|VIRTUAL-SKIN|battery'
done
```

### Z results

Run **2026-09-23**, 09:22–10:05 local, by the owner at the tablet with the commands driven over
USB. Debug APK built from `main` at **`0530883`** by §"Build and install", `check:capacitor`
byte-identical, `public/harness/realistic.html` present in the APK, `install -r` (the rides on the
tablet kept). Landscape, AC power at 100 %, brightness set to manual full for the run and put back
to automatic after. Thermal status **0** at the start: CPU LITTLE 57 °C, display 25.2 °C,
charger skin 28.1 °C, battery 20.2 °C.

| | Z6 — realistic | Z6 — stylised |
|---|--:|--:|
| Frame p50 / p90 / p99 (page) | 16.6 / 16.7 / 16.7 ms | 16.6 / 16.7 / 16.8 ms |
| Frame p50 / p90 / p99 (gfxinfo) | 12 / 16 / 20 ms | 12 / 21 / 23 ms |
| **GPU p50 / p90 / p99** | **5 / 8 / 11 ms** | **4 / 13 / 16 ms** |
| Janky (modern) | 0.08 % | 0.13 % |
| Draw calls (page) | 35 | 21 |

Both at the display's rate (`frameCap: display`), `?ladder=0`, zero stalls, thermal status 0.
⚠️ **The stylised world's GPU p90 is higher than the realistic world's**, which is the opposite of
what the draw calls suggest. It is one 30-second window each, and a second realistic window agreed
with the first (GPU 4 / 7 / 12 ms, 2 342 frames, whose p99 includes four asset uploads in the
4 950 ms bucket). It is recorded as observed; nothing here explains it.

**The 20-minute soak** (Z7): `?soak=20&panel=0`, the ladder free, 09:32–09:52.

| Minute | Frame p50 / p90 / p99 | Rung (`world` · `rung` · `frameCap`) | Thermal status | GPU / CPU big / skin (°C) |
|--:|---|---|---|---|
| 1 | 16.6 / 16.7 / 16.8 ms | realistic · realistic · display | 0 | — (see below) |
| 5 | 16.6 / 16.7 / 16.7 ms | realistic · realistic · display | 0 | 54 / 46 / 29 |
| 10 | 16.5 / 16.7 / 16.7 ms | realistic · realistic · display | 0 | 55 / 48 / 30 |
| 15 | 16.5 / 16.7 / 16.7 ms | realistic · realistic · display | 0 | 53 / 47 / 31 |
| 19 | 16.6 / 16.6 / 16.7 ms | realistic · realistic · display | 0 | 53 / 48 / 31 |

Every one of the nineteen minutes captured was the realistic top rung at the display's rate, 32 to
37 draw calls, zero stalls, thermal status 0. Across the whole soak `gfxinfo` counted **72 275
frames**, 0.10 % janky, frame 12 / 16 / 21 ms, **GPU 5 / 8 / 12 ms**. From 09:35 the GPU sensor
(`G3D`) read 51 to 56 °C with no trend, `VIRTUAL-SKIN` rose 29 → 31 °C and the battery 22 → 24 °C.

⚠️ **Two holes in that table, both the procedure's and both corrected above.** Minute 20's line
was never captured: the loop read minute N's line at the start of minute N + 1 and stopped after
twenty reads. And the first three minutes have no temperature: the loop read `Cached
temperatures`, which stayed at their 09:32 values for the whole run, and a second logger reading
the HAL's current values was started at 09:35.

**GPU memory at minute 10 (Z8):** `GL mtrack` **317 340 kB (310 MiB)**, `EGL mtrack` 113 764 kB
(111 MiB), `Graphics` 431 104 kB (421 MiB), `TOTAL PSS` 563 223 kB. ⚠️ **That is about 2.3 times
the 136 MiB estimate.** The estimate counts texture images; what the driver holds under
`GL mtrack` also includes, at least, mipmap chains, the 2560 × 1600 render targets and vertex
buffers, and this run did not separate them. It is a finding for D-6's budget, not a pass or a
fail: the tablet had the memory, and the device floor's 3 GB would feel it.

**Loads and draws realistic (Z1)?** **Yes.** `realistic world · realistic · display rate`, frame
p50 16.6 ms, drawing buffer 2560 × 1600, `errors: []`.

**Road: surface or noise; any shimmer, and where (Z2)?** **A surface.** The owner saw no shimmer
or crawl near or far at speed.

**Gradient tint legible (Z3)?** **Yes**: climb and descent are easy to read.

**Trees near and far (Z4)?** **Look good.** No sparse near field and no visible switch from mesh to
picture were reported.

**Legs follow the pedals, and stop when held (Z5)?** **Yes to both**: they follow the pedals while
riding and stop with `?at=900`.

**Structures: brick, board, stone, tile, slate, iron; the hedge (Z9)?** Held at 1 045 m, beside
the first farmstead: **brick, board, tile and corrugated iron read correctly, a brick is one size
across a wall, and the hedge reads as a hedge.** ⚠️ **But the buildings have no doors, no
windows and little detail**, so a house reads as a brick box — the owner's verdict was that they
need more — [#500](https://github.com/openzigs/onyourleft/issues/500). ⚠️ **This route cannot
answer the stone half**: `structuresAt` over all 4 km places 3 houses, 3 barns, 3 sheds, 242 fence
and 320 hedge runs and **no wall**, all three farmsteads on the left, 24–30 m back, at about
1 050, 1 540 and 3 760 m — [#501](https://github.com/openzigs/onyourleft/issues/501). The owner,
riding at 9 m/s, first reported seeing no buildings at all; they are on screen for seconds.

**The water's reflection (Z10)?** Held at 2 815 m, 30 m before the one crossing (2 846.7 m):
**the water takes the sky's grey-blue**, not the stylised blue. ⚠️ **Four defects, each confirmed
by the owner**: fine horizontal banding in the water, a hard straight edge with no bank where water
meets grass, a light seam across the road where the deck begins, and plain grey block parapets.
⚠️ **There is no lake on this route**: `waterways()` returns `lakes: []`, although
`realistic/route.ts` says its valley floor is there for one. All five are
[#501](https://github.com/openzigs/onyourleft/issues/501).

**`OYL-REALISTIC-LOAD` — `capacitorAtStart` / `androidBridgeAtStart`, and any `OYL-REALISTIC-BRIDGE` or
`OYL-REALISTIC-ERROR` line (#478):** five loads, every one
`{"capacitorAtStart":"object","androidBridgeAtStart":"object","standIn":false,"events":[]}`; **no**
`BRIDGE` and **no** `ERROR` line.

**Does the realistic top rung hold for twenty minutes, at 60 fps, with headroom?** **Yes, on this
tablet, on charge, in a cool room**: nineteen captured minutes at the top rung and the display's
rate, GPU p90 8 ms of a 16.7 ms frame, thermal status 0 throughout and the GPU sensor flat. ⚠️
What it does **not** show: a phone, a warm room, a battery-powered run, or the 60-minute ride
#247 asks for, and the memory figure above is well over the estimate D-6 set. ADR 0026 D-3's
default and D-6's budget remain **#475's** to act on; this is the evidence, not the decision.

**Phone (OEM, model, Android, WebView):** Google Pixel Tablet (`tangorpro`), build
`CP2A.260705.006`, Android 17, WebView `com.google.android.webview` **153.0.8010.36** (Part P read
151 on 2026-09-20)  **Build:** debug, `main` at `0530883`, installed 2026-09-23 09:22

---

## Part AA — doors, windows and detail on the buildings ([#500](https://github.com/openzigs/onyourleft/issues/500))

Part Z's Z9 found the surfaces right and the SHAPES wrong: a house was a brick box and a barn a
board box, with no opening on any face. #500 cut doors and windows into every building's road-facing
side (recessed, framed, glazed), overhung the eaves, capped the ridges, stood every building on a
plinth, darkened the foot of its walls, put a chimney on every house and gave every kind two
proportions — `apps/web/src/game/buildings.ts`, drawn with the same triangles in both worlds. The
browser gate reads a window's glass back off the drawing buffer with a control
(`game.browser.spec.ts` §"#500"); what it cannot say is whether any of it reads from a saddle.

**This is #500's last criterion, and nothing in CI can discharge it.** Same tablet, same debug-APK
route as Part Z (§"Build and install"), from a `main` that has #500 in it.

| Step | What to do | What should happen |
|---|---|---|
| AA1 | Z9 again: `?panel=0&ladder=0`, ride past the first farmstead (about 1 050 m) at your usual speed | Does the farmstead read as a farmstead **at 9 m/s** — a house with a door and windows, a barn with great doors? |
| AA2 | Hold the ride beside it: `location.href = '/harness/realistic.html?at=1045&panel=0'`, then ride slowly past | Do the openings **shimmer or crawl at a grazing angle** — the frames, the sills, the glass's reflection? Do the eaves and the chimney read? |
| AA3 | Z6's 30-second realistic row, with its `dumpsys` block: `?panel=0&ladder=0` | Draw calls and GPU p50 / p90 / p99, against Part Z's **33–37 calls and GPU p90 8 ms** |
| AA4 | The stylised world past the same farmstead: `?world=stylised&panel=0&ladder=0` | Do the stylised barn, shed and (in a village) church and shops have their openings? The stylised HOUSE is still the Kenney model — does it need anything? That is the owner's call, #500 §5 |

### AA results

| Step | As described? | What was seen, or measured |
|---|---|---|
| AA1 | **Yes** | The first farmstead (about 1 050 m, on the left) reads as a farmstead at 9 m/s: a house with a door and windows, a barn with great doors. The owner missed it on the first pass and it was re-run from the start |
| AA2 | **Yes, no shimmer** | Held at 1 045 m: the eaves and both chimneys read. The openings do **not** shimmer — six `screencap`s taken back to back were identical, pixel for pixel, over the house, the road and the fence. ⚠️ With `?at=` the scene is static, so this rules out flicker (z-fighting) and not crawl in motion; AA1 is the moving half |
| AA3 | **Yes** | Held beside the farmstead, buildings in frame: 60 fps (page 16.6 / 16.7 / 16.8 ms), **35 draw calls**, **GPU 5 / 8 / 12 ms**, 0.11 % janky, thermal status 0. The same GPU p90 as Part Z's 8 ms before the detail. From the start of the route, before any building is in view: 35 calls, GPU 4 / 7 / 11 ms. ⚠️ That is ONE view, not [#506](https://github.com/openzigs/onyourleft/issues/506)'s worst case, which is a computed bound |
| AA4 | **Yes** | The stylised barn has its double doors, and the shed its openings. The stylised house (the Kenney model, which carries its own door and windows) **needs nothing** — the owner's call, #500 §5 |

**Phone (OEM, model, Android, WebView):** Google Pixel Tablet (`tangorpro`), build `CP2A.260705.006`, Android 17, WebView 153.0.8010.36  **Build:** debug, `main` at `a21bdfe`, installed 2026-09-23 14:32, run 14:39–15:07 by the owner at the tablet

---

## Part AB — the water, the bridge, the lake and the walls again ([#501](https://github.com/openzigs/onyourleft/issues/501))

Part Z's Z10 found four defects at the bridge and Z9/Z10 found the soak route could not show a
lake or a stone wall at all. #501 changed each, and each has a gate in CI that says what it can:

- **The banding.** The ripple normal fades as its phase turns faster than about half a radian a
  pixel (`three-renderer.ts` §`RIPPLE_FADE_RADIANS_PER_PIXEL`). The browser gate reads the banding
  as a number with the fade on and, as its control, off (`game.browser.spec.ts` §"#501"). What it
  cannot say is whether 2560×1600 at a grazing angle looks right.
- **The bank.** The stream's surface runs on under the bank, so its edge is never what is seen: the
  drawn ground rises out of the water, and the ground just above it is darkened to a wet margin
  (`waterways.ts` §`STREAM_SURFACE_HALF_WIDTH_METRES`, `landform.ts` §`WET_GROUND_TINT`).
- **The seam.** Found rather than guessed: the abutment was a LEVEL box under a sloping road, and
  its top stood up to 9 cm through the road on this route's 8 % approach; the deck's pieces could
  stand 1 cm through at the foot of a slope. Both now sit under the road drawn over them
  (`waterways.test.ts` §"the road is continuous across the bridge").
- **The parapets** wear `old_stone_wall` on the realistic rung, projected in the world's metres, with
  a coping along each top. Still one draw call; no new belt.
- **The route** now lays a lake beside its valley floor (right of the road, about 1 410–1 880 m)
  and walls fields in stone on the 5 % climb out of it (about 1 900–2 500 m).
  `browser/realistic/route.test.ts` holds it to both. ⚠️ **The farmstead that stood at about
  1 540 m is gone** — it was on the same floor, and the lake took its place. The one at about
  1 050 m, which Part AA rides past, is unchanged.

| Step | What to do | What should happen |
|---|---|---|
| AB1 | Z10 again: `?panel=0&ladder=0`, then hold at the bridge: `location.href = '/harness/realistic.html?at=2815&panel=0'` | Is the **banding** gone from the stream? Is there a **bank** — a drop from grass to water, and a darker margin where they meet? Is the **seam** across the road at the deck's start gone? Do the **parapets** read as stone with a coping? |
| AB2 | Ride past the lake: `location.href = '/harness/realistic.html?at=1450&panel=0'`, then ride on | Is there a lake beside the road? Does it have the bank and margin AB1 asks about, and does it band? |
| AB3 | Z9's stone half: `location.href = '/harness/realistic.html?at=1960&panel=0'` — ⚠️ 1 960 m, not 2 100 m: at 2 100 m the walls stand behind the trees (first run, 2026-09-23) | Do the field walls on the climb read as **stone walls**? |
| AB4 | Z6's 30-second realistic row, with its `dumpsys` block: `?panel=0&ladder=0` | GPU p50 / p90 / p99 against Part Z's **GPU p90 8 ms** — the water shader now takes two screen-space derivatives a pixel |

### AB results

| Step | As described? | What was seen, or measured |
|---|---|---|
| AB1 | **Yes, all four** | Held at 2 815 m: the banding is gone from the stream, there is a bank with a darker margin, the seam across the road at the deck is gone, and the parapets read as stone with a coping |
| AB2 | **Yes** | Held at 1 450 m: a lake on the left, with the bank and margin, and **no banding** — its broad waves are ripples. (The owner first answered "banded" meaning ripples, and corrected it once the two were told apart: evenly spaced parallel lines against uneven crests) |
| AB3 | **Yes** | The walls read as stone. ⚠️ **At 2 100 m, where this step holds, none is in view** — they stand behind the trees there. `structuresAt` over the route places 128 wall pieces between 1 908 and 2 447 m, 6–42 m from the road; **1 960 m** shows them on both sides of the road, and is the distance this step should use |
| AB4 | **Yes** | Held at the bridge with the water filling the view: 60 fps, **33 draw calls**, **GPU 4 / 7 / 11 ms**, 0.21 % janky, thermal status 0 — no cost from the two screen-space derivatives against Part Z's GPU p90 8 ms |

**Phone (OEM, model, Android, WebView):** Google Pixel Tablet (`tangorpro`), build `CP2A.260705.006`, Android 17, WebView 153.0.8010.36  **Build:** debug, `main` at `a21bdfe`, installed 2026-09-23 14:32, run 14:39–15:07 by the owner at the tablet

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

---

## Part AC — the game takes control when the rider presses Ride ([#503](https://github.com/openzigs/onyourleft/issues/503)) ⚠️ run after L, before D

**Why this part exists.** On 2026-09-23 the owner opened the trainer game on the Pixel Tablet and was
told they did not have control of the trainer. The only *Ask the trainer for control* was on the Ride
screen, inside the ERG panel, so the game looked as though it needed an ERG set first. It never did.
Since #503 the game's picker says *"Your trainer will follow this route’s hills. Pressing Ride asks
it for control…"*, and the **Ride press** sends the one Request Control, through the same controller
the Ride screen uses. Entering the game screen asks nothing and writes nothing.

⚠️ **No test in the repository can say what a real trainer does.** `game/trainer-wiring.test.tsx`
rides this path against the #44 simulator — pair, open the game, press *Ride*, `0x00` then `0x11` —
and reads the grade back off the simulated machine. Whether a real FTMS trainer grants the request
and follows the climb is only here.

### ⚠️ Read this before starting

- **Start with control NOT held.** Force-stop the app and reopen it, or pair the trainer fresh, so the
  Ride screen's Trainer panel reads *"This app does not have control of the trainer."* — and **do not
  press *Ask the trainer for control*** anywhere. That is the whole point of the part.
- **End any workout first** — L's bullet says why. With a workout running, *Ride* must ask for
  nothing (AC5 checks that).
- Flat pedals, low gear, seated, power switch within reach (Safety items 3 and 4). A route with a
  gentle climb whose maximum gradient you know — Safety item 5.

```bash
adb logcat -c
adb logcat | grep -i "BluetoothLe"
```

| Step | What to do | What should happen |
|---|---|---|
| AC1 | Pair the trainer on the Ride screen and **do not** take control. Open the game and choose the route. Wait ten seconds on the picker | The picker reads *"Your trainer will follow this route’s hills. Pressing Ride asks it for control…"*, above the *Ride* button. ⚠️ **No `0x00` in logcat yet, and no write at all** — entering the game asks nothing |
| AC2 | ⚠️ **On the bike, low gear, seated.** Press ***Ride*** and pedal | **One `0x00` Request Control**, answered `80 00 01`, **before** the first `0x11`. Within a second or two the HUD's trainer line reads `Trainer: simulating …%` with a non-zero count, and **no road notice** is on the stage |
| AC3 | Ride into the climb | The resistance **follows the climb**, and the trainer line's percentage tracks the HUD's gradient as in L3 — without the Ride screen having been visited |
| AC4 | Press *End ride*, return to the Ride screen | One `0x08` Stop as in L5, and **no `0x00` after it**. The Trainer panel reads *"This app has control of the trainer…"*: the game's request is the Ride screen's control, not a second one. The ERG line is labelled *ERG, optional* — one of the things control is for, not the thing it is |
| AC5 | Start a saved workout on the Ride screen, then open the game and press *Ride* | The picker shows the *"A workout is driving your trainer…"* notice, and ⚠️ **no `0x00` and no `0x11`** follow the Ride press — a workout keeps the control point |
| AC6 | *(Only if you have a second app that can take control, e.g. the manufacturer's.)* Take control with the other app, then press *Ride* in this one | Either this app is granted control (AC2's result) or the trainer refuses — in which case the ride still starts and the stage says *"Your trainer did not grant control when you pressed Ride…"*. Record which, and the `80 00 xx` answer |

### AC results

| Step | Result | `0x00` count / answer | Notes |
|---|---|---|---|
| AC1 | **Yes** — *"Your trainer will follow this route’s hills. Pressing Ride asks it for control, and the gradient is sent to it as you ride."* | **0** — no write of any kind | App force-stopped and relaunched at 15:00:31; trainer paired 15:00:44 (`connect`, `getServices`, reads and two `startNotifications` only). ⚠️ The picker has no separate "choose a route" step: each saved route carries its own *Ride* button, so waiting on the list IS AC1 |
| AC2 | **Yes** — HUD *"Trainer: simulating 6.2% (47 sent)"*, no road notice | **1** `0x00` at 15:03:45.158, **before** the first `0x11` at 15:03:45.409 | The control point answered 196 ms after the `0x00`. ⚠️ The plugin's log names the notification and not its bytes, so the `80 00 01` itself was **not read**; that the gradient writes that followed were honoured is AC3 |
| AC3 | **Yes** | — | The owner, on the bike: *"resistance and power seem correct for grade"*, with the Ride screen never visited |
| AC4 | **Yes** — *"This app has control of the trainer."*; the ERG line reads *"ERG, optional: No target set. The trainer is following your effort."* | One `0x08 01` at 15:05:51; **no `0x00` after it** | 47 `0x11` in all, none after the Stop. The panel also says the trainer carries its manufacturer’s own control point and the standard one is used (#370) |
| AC5 | **Not run** | — | The owner has no saved workout. Open |
| AC6 | **Not run** | — | Optional; no second app to hand |

⚠️ **An earlier attempt at AC1, at 14:58, is not a finding.** The owner pressed *Ride* and went back before reading the picker; the log shows exactly the sequence AC2 and AC4 require (`00`, then `11`, then `08 01` at the return), and the app was restarted for the AC1 above.

**Did pressing Ride on the game feel like the only thing you had to do, in your own words?** Not asked in so many words; the owner reported AC1–AC4 as correct.

**Trainer (make, model, firmware, address):** make, model and firmware not recorded; address `EB:71:8D:AA:0E:3C`  **Build:** debug, `main` at `a21bdfe`, installed 2026-09-23 14:32, on the Pixel Tablet above

---

## Part AD — a racing line through the bends, and a rider who leans ([#499](https://github.com/openzigs/onyourleft/issues/499))

**Why this part exists.** Until #499 every rider — you, the pacer and the ghost — was drawn on the
road's centreline and bolt upright through every bend, and two riders level on the road were drawn
inside each other. Since #499 each rides a **line** (`apps/web/src/game/racing-line.ts`): the line
of least peak curvature inside the carriageway, 0.6 m in from each edge, which enters a bend wide,
clips the apex and exits wide. Each **leans** by `tan φ = v² / (g·R)` from that line's own bend and
its own speed, rolling in over a few metres rather than snapping, and **stops at 38.7°**, the most a
dry road tyre holds. Two riders level on the road are moved a handlebar and a bit apart. The chase
camera follows you across the road and does **not** roll.

⚠️ **The cap is a drawing decision, not physics.** The game never slows you for a bend, so at a
hairpin taken at full speed the lean the bend asks for is past what any tyre holds; you are drawn at
the cap and are, in truth, going too fast for the corner. AD3 is where that shows.

⚠️ **Nothing measured along the road moved.** Distance, the trainer's grade, the ghost, the pacer's
gap and *To go* are all still on the centreline — a test holds the grade a trainer is sent through a
hairpin to be identical with and without the line. So this part is about how it LOOKS and nothing
else. The browser gate reads the rider off-centre and rolled at a 20 m hairpin's apex, against the
same rider on the centreline and upright (`game.browser.spec.ts` §"#499"); whether it looks like a
racer is only here.

Same tablet, same debug-APK route as Part Z (§"Build and install"), from a `main` that has #499 in it.

| Step | What to do | What should happen |
|---|---|---|
| AD1 | The owner's soak route through its valley: `?panel=0&ladder=0`, ride the first 3 km at your usual speed | Its bends are sweeping (about 250 m radius), so the line drifts across the road rather than darting and the lean is a few degrees. Does the **line look like a racer's** — wide into a bend, inside at its middle, wide out — and never like a rider wandering? |
| AD2 | The same, **faster**: a sprint through two or three of those bends | Does the **lean look natural at speed** — rolling in before the bend rather than snapping at it, and back out after? Does it lean **into** the bend every time? |
| AD3 | Import a route with a real **hairpin** (any GPX of a mountain road) and ride it, then sprint through it | At a hairpin taken hard the rider is drawn at the **cap**, 38.7°, and holds it there. Does anything look **wrong** — the wheels through the road, the rider's shadow somewhere odd, the bicycle leaving the tarmac at the apex? |
| AD4 | Race your own ghost, or a pacer, and ride **level** with it for a few seconds, then pass | The two bicycles are **side by side**, never inside each other, and ease apart as they draw level rather than jumping sideways. Does the camera stay on **you**? |
| AD5 | The stylised world (`?world=stylised&panel=0&ladder=0`) through the same bends | The line and the lean are the same in both worlds — the stylised bicycle and the realistic MakeHuman rider lean **together with** their bicycle |

### AD results

| Step | As described? | What was seen |
|---|---|---|
| AD1 | | |
| AD2 | | |
| AD3 | | |
| AD4 | | |
| AD5 | | |

**Does the line look like a racer's line, in your own words?** ______________

**Phone (OEM, model, Android, WebView):** ______________  **Build:** ______________

---

## Part AE — the realistic structure budget ([#506](https://github.com/openzigs/onyourleft/issues/506))

Since #500 a realistic building is up to 640 triangles, and the realistic top rung carried the
stylised top's 240 structures: a worst frame of about 450 000 triangles against
`REALISTIC_FRAME_TRIANGLES`' 300 000, which no gate summed. #506 cut both realistic rungs to **36
structures** (`realistic-budget.ts` §`REALISTIC_STRUCTURE_ITEMS`, which carries the arithmetic);
`realistic-budget.test.ts` now sums the structures into the worst frame. Every building is listed
before any wall, hedge or fence (`settlements.ts` §`structuresAt`), so what should go is the far
field boundaries and never a house. AA3 measured a farmstead; nothing has measured a **village**,
which is where the structures' draw calls peak (up to 16 of `REALISTIC_STRUCTURE_MESHES`' 35).

**This is #506's last criterion, and nothing in CI can discharge it.** Same tablet, same debug-APK
route as Part Z (§"Build and install"), from a `main` that has #506 in it.

| Step | What to do | What should happen |
|---|---|---|
| AE1 | Z6's 30-second realistic row, with its `dumpsys` block: `?panel=0&ladder=0`, held beside the first farmstead as AA3 was | Draw calls and GPU p50 / p90 / p99 against AA3's **35 calls and GPU 5 / 8 / 12 ms**. Triangles, if the page reports them |
| AE2 | The same row in a **village**, with the church and the shops in frame | The same figures. This is the view the 35 structure meshes are justified against |
| AE3 | Ride the realistic world past a village and on into fields, at your usual speed | Is every house there? Do the **field walls, hedges and fences** end where they did not before — and does that read as wrong from a saddle? |

### AE results

| Step | As described? | What was seen, or measured |
|---|---|---|
| AE1 | *Not run* | Needs the staged harness build (§"Build and install", `realistic:stage`). The session's APK was a plain `main` build without it |
| AE2 | *Not run* | Same reason as AE1 |
| AE3 | **Yes** | Ridden in the **product**, not the harness: the realistic world chosen in Settings, on the owner's own saved route of about 29 miles. The village is there and every house is complete, with doors, windows, chimneys and brick. The field walls, hedges and fences read correctly from the saddle |

**AE3's whole ride, by `dumpsys gfxinfo`** (reset at 20:45:17): **25 907** frames, **14** janky
(0.05 %). Frame time 50th / 90th / 95th / 99th **11 / 22 / 23 / 28 ms**. GPU **4 / 8 / 13 / 16 ms**.
Thermal status 0 throughout. ⚠️ `gfxinfo` reports no draw calls or triangles, so this is **not**
AE1's or AE2's row. It is the cost of a whole real ride in the realistic world, villages included,
against AA3's GPU 5 / 8 / 12 ms held at one farmstead.

**Phone (OEM, model, Android, WebView):** Google Pixel Tablet, Android 17, WebView 153.0.8010.36
**Build:** debug, `main` at `cfa8956`, 2026-09-25

---

## Part AF — does the shell reach a plain-`http:` model server on the LAN? ([#519](https://github.com/openzigs/onyourleft/issues/519))

**Why this part exists.** The Android shell serves the app from a secure origin
(`https://localhost`), and `apps/mobile/capacitor.config.ts` sets `allowMixedContent: false`. #387's
analysis transport marks every request with `targetAddressSpace` (`local` or `loopback`). Chromium's
Local Network Access rules use that mark to relax mixed-content blocking for a private address once
the rider grants permission. Nothing had measured whether the Android System WebView does the same,
asks for the permission, or blocks the request. If it blocks, [ADR 0029](../adr/0029-camera-imagery-as-a-data-class.md)
D-6's default transport, plain LAN, does not work inside the APK.

⚠️ **This part was run by the change that added it**, as Part P was, so it is a dated measurement
rather than a script. ⚠️ **It changes no resistance** and needs no trainer.

| Step | What to do | What should happen |
|---|---|---|
| AF1 | Run an OpenAI-compatible server on a computer on the same Wi-Fi, bound to `0.0.0.0`, answering over plain `http:`. Check it from that computer with `curl` | It answers |
| AF2 | On the Camera page, save `http://<LAN address>:<port>` and press *Send one picture to check the connection*. Watch the server's log and `adb logcat` | Record what the page says, whether **any** request or preflight reached the server, whether a Local Network Access or other permission prompt appeared, and which layer refused, from logcat: mixed content, LNA, or cleartext policy |

### AF results

| Step | Result | What was seen |
|---|---|---|
| AF1 | **Yes** | A throwaway stub on the owner's Mac at `http://192.168.68.65:8519`, bound to `0.0.0.0`. It answered `ready`, sent CORS headers for `https://localhost` and `Access-Control-Allow-Private-Network`, and answered `curl` from the Mac |
| AF2 | **Blocked, as mixed content** | The page reported that the computer **cannot be reached**. The stub logged **no request and no preflight** from the tablet, so the request never left the WebView. **No** Local Network Access prompt and **no** permission dialog appeared. Logcat: `E Capacitor/Console: ... Mixed Content: The page at 'https://localhost/#/camera' was loaded over HTTPS, but requested an insecure resource 'http://192.168.68.65:8519/v1/chat/completions'. This request has been blocked; the content must be served over HTTPS.` |

**Which layer refused: mixed content.** In this WebView, `targetAddressSpace: 'local'` does **not**
relax mixed-content blocking. The refusal was not the cleartext policy and not LNA: the request
never got as far as either.

**What it means, and what is not decided here.** ADR 0029 D-6's default transport, plain LAN, does
**not** work inside the APK today. Each way round it is a security setting, and #519 requires an
owner decision in an issue or an ADR rather than a config change:

1. `allowMixedContent` in `capacitor.config.ts`, which also brings Android's cleartext policy into
   play.
2. A native HTTP path outside the WebView, such as CapacitorHttp. That still meets the cleartext
   policy.
3. Require an `https:` endpoint that the phone trusts, which is hard for a rider to set up.

It matters less since [ADR 0033](../adr/0033-side-camera-link.md) made on-device analysis on the
tablet the primary path (#530), so the rider's computer is now optional. #519 also still owes the
rider-facing document's update: [`docs/analysis-on-your-own-computer.md`](../analysis-on-your-own-computer.md)
should say *"blocked"* rather than *"untried"*. This part does not make that edit.

**Phone (OEM, model, Android, WebView):** Google Pixel Tablet, Android 17, WebView 153.0.8010.36
**Build:** debug, `main` at `2b84996`, 2026-09-25
