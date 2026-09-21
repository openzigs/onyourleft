# Validation 0003 — a screen reader, the shell, and a ride nobody can see

**Status:** procedure written; **not run.** ⚠️ **Every result table in this file is empty, and that
is the deliverable rather than an omission.** Nobody has run any part of it: not the owner, not an
agent, and not a person who uses a screen reader. The parts marked *needs a screen-reader user* have
no such person in the loop today, and saying so is the honest state — a table filled in from
reasoning would be worse than no document, because CLAUDE.md §4a's *"a documented command nobody
has run is the most expensive kind of wrong"* applies to a result cell exactly as it does to a
command.
**Written:** 2026-09-21, by [#393](https://github.com/openzigs/onyourleft/issues/393), against
`main` at the merge of [#444](https://github.com/openzigs/onyourleft/pull/444) plus the pull
request that adds this file — which also adds a climb-ahead announcement
([#399](https://github.com/openzigs/onyourleft/issues/399)), optional non-speech sounds
([#400](https://github.com/openzigs/onyourleft/issues/400)) and the browser-gate proof that the
announcement region is not hidden ([#401](https://github.com/openzigs/onyourleft/issues/401)).
**Refs:** [#392](https://github.com/openzigs/onyourleft/issues/392) (the epic),
[#391](https://github.com/openzigs/onyourleft/issues/391) (the finding it answers).

---

## What this is, and what it is not

**It is the third validation procedure, and the first that is not about a trainer.**
[0001](0001-trainer-and-sensors.md) validates the sensor and trainer clients from a laptop;
[0002](0002-android-shell-and-game.md) validates the Android shell and the game. This one asks the
question none of the gates in this repository can: **can somebody who cannot see the screen actually
complete a ride?**

**It is not an ADR and it decides nothing.** Like 0001, 0002 and a spike, it is dated and it ages.
The `ADR00*` rules are scoped to `docs/adr/` and do not apply.

**Why it exists — the three things no gate can establish**, from #392's own table:

1. **Whether TalkBack reaches the HUD inside the Capacitor WebView at all.** The evidence that it
   does is indirect. Chromium's Android accessibility document (read 2026-09-19, at 112.0.5615.165)
   records that Chrome and the WebView **never set** `AccessibilityNodeInfo.liveRegion` and instead
   force an announcement through `announceLiveRegionText`, *"because TalkBack will read the entirety
   of the liveRegion node when there is a change"*. That is direct evidence that live regions are
   implemented for WebView content. **It is not a measurement of this app.** Part B is.
2. **Whether the Bluetooth device chooser is operable.** It is not this repository's DOM, on either
   platform. Part D measures it and fixes nothing.
3. **Whether TalkBack costs frames.** An Ionic/Capacitor discussion (ionic-team/capacitor #3899)
   alleges that enabled Android accessibility services *"bring WebView apps to their knees, even
   causing ANRs"* — with no version given and nothing measured. **It is cited here as a risk, not as
   a finding.** With a three.js loop at 60 fps behind the HUD, this project has never measured it.
   Part E does.

⚠️ **And one more that only a rider can answer**: whether the throttled speech is *usable* at ride
intensity (Part F).

### What the gates DO establish, so that this procedure does not repeat them

| Claim | Where it is established | Not here because |
|---|---|---|
| the HUD has one region, `role="status"`, and it receives a sentence during a ride | `apps/web/src/game/hud/hud-announcer.a11y.test.tsx` (jsdom) | it is a DOM fact |
| priority is an order, one sentence per 3 s window, lower items dropped | `apps/web/src/game/hud/announce.test.ts` | it is arithmetic |
| the region is **not hidden** by the shipping stylesheet and displaces nothing in the HUD's layout | `apps/web/browser/hud.browser.spec.ts` (pinned Chromium, [#401](https://github.com/openzigs/onyourleft/issues/401)) | it is layout |
| the mute silences, a dropped sensor silences, the tone stops when the ride does | `apps/web/src/game/audio-cues.test.ts`, against a port double ([#400](https://github.com/openzigs/onyourleft/issues/400)) | it is a call sequence |

⚠️ **None of those is evidence that anything was spoken.** Playwright's Chromium is not a screen
reader and jsdom is not a browser. Each row above is a precondition for Part B passing, not a
substitute for running it.

---

## ⚠️ Safety

CLAUDE.md §6: *a smart trainer applies physical resistance to a person who is pedalling.* This
procedure puts a rider on a trainer **with their eyes off the screen**, which is the whole point and
also the risk.

1. **Parts A to E write nothing that changes resistance, and Parts B, C and G need no trainer at
   all** — the simulator-free game rides a route with no trainer paired, and every announcement in
   them is produced without one. Run them first, off the bike.
2. **Parts F, H and I are ridden.** Run them with a sighted helper beside the bike and the trainer's
   power switch within their reach, and **do not clip in** — flat pedals. A rider who cannot see the
   screen cannot see a fault notice either, and that is exactly the condition under test.
3. ⚠️ **If a workout is ridden in Part G or I, it is ERG**: the trainer holds a target whatever the
   rider does. The ease-on-stall behaviour is [0002](0002-android-shell-and-game.md) Part S's
   question, not this one's; do not test it here.

---

## What you need

| | |
|---|---|
| An Android phone or tablet, API 30+ | The same device floor as 0002. The owner's tablet is the obvious first one |
| **TalkBack**, and a person who uses it daily for the parts marked *needs a screen-reader user* | A sighted person with TalkBack switched on for the afternoon can run Parts A, B, C, D and E. They **cannot** answer Part F, and should not try |
| A USB cable and `adb` | For Part A's version readings and Part E's `dumpsys gfxinfo` |
| Headphones, wired or Bluetooth | Part I. ⚠️ Note which — Bluetooth audio adds latency a wired pair does not, and a cue that arrives late is a finding about the cue |
| The trainer and a power meter from 0001 | Parts F, H and I only |
| A sighted helper | Parts F, H and I. See *Safety* |

---

## Before the session

Build and install the debug APK exactly as [0002](0002-android-shell-and-game.md) §"Before the
session" does. Nothing here needs a release build.

Then, **on the device, with TalkBack off**, set the app up so the parts below start from a known
state:

1. Open **More → Settings → Announcements**. Confirm the switch *Announce the ride to a screen
   reader* is **off** — it is off by default ([#395](https://github.com/openzigs/onyourleft/issues/395)'s
   decision). Record it in A7; do not turn it on yet.
2. Confirm **More → Settings → Sounds** is **off** as well (A8).
3. Import or draw at least one route with a real climb on it, and save one short workout of two or
   three blocks on the Workouts screen. Parts G to I need both.

---

## Part A — the versions, and the starting state

⚠️ **The WebView version is recorded separately from Chrome's, and that is not pedantry.** Adrian
Roselli's live-region support matrix (adrianroselli.com/2026/01/live-region-support.html, published
2026-01-14, read 2026-09-19) records TalkBack's behaviour **changing between versions** — TalkBack
13.1 on Android 13 with Chrome 114 treats every live region as assertive, TalkBack 16.0 on Android 16
with Chrome 143 treats every one as polite. The shell renders in the **Android System WebView**, which
updates separately from Chrome, so a result with only Chrome's version on it cannot be compared with
a later one.

```bash
# Android and the device
adb shell getprop ro.build.version.release
adb shell getprop ro.product.model
# The WebView the shell actually renders in — NOT Chrome's
adb shell dumpsys package com.google.android.webview | grep versionName
# Chrome, for comparison
adb shell dumpsys package com.android.chrome | grep versionName
# TalkBack (the Android Accessibility Suite)
adb shell dumpsys package com.google.android.marvin.talkback | grep versionName
```

⚠️ **Confirm the WebView the app is actually using**, which can differ from the package above on a
device with a WebView provider set in Developer options. With the debug build installed,
[`apps/mobile/tools/webview-probe.mjs`](../../apps/mobile/tools/webview-probe.mjs) evaluates an
expression inside the shell's own WebView; `navigator.userAgent` there names the `Chrome/…` version
the WebView reports.

| Step | What to record |
|---|---|
| A1 | Device (OEM, model) |
| A2 | Android version |
| A3 | TalkBack version |
| A4 | Android System WebView version, from `dumpsys` |
| A5 | The WebView version the shell reports, from `webview-probe.mjs` |
| A6 | Chrome version |
| A7 | Announcements switch off at first launch (yes / no) |
| A8 | Sounds switch off at first launch (yes / no) |
| A9 | Build (`main` at which commit) |

### A results

| Step | Result |
|---|---|
| A1 | |
| A2 | |
| A3 | |
| A4 | |
| A5 | |
| A6 | |
| A7 | |
| A8 | |
| A9 | |

---

## Part B — is a live region announced at all inside the shell?

**The part the rest of the epic stands on.** If nothing is spoken here, every announcement in this
app is silent on Android, and the right next step is an issue — not Part C.

| Step | What to do | What should happen |
|---|---|---|
| B1 | Turn TalkBack **on**. Open **More → Settings → Announcements**, turn the switch on, and set *Say your power* to **every 15 seconds**. Leave the others at their defaults | TalkBack reads each control as it is focused, and *"Saved on this device."* after each change — that message is itself a live region (`StatusMessage live`) |
| B2 | Open **Ride → Trainer game**, choose the route, and activate **Ride** | The ride starts. No trainer and no power meter are needed: a ride with no power sensor says *"No power reading"* |
| B3 | Put the device down and **touch nothing** for 60 seconds | TalkBack speaks a power sentence about every 15 seconds — *"No power reading"*, or *"Power N watts"* with a meter paired. ⚠️ **Never "zero" and never "nought"** for a missing reading |
| B4 | While B3 runs, move TalkBack's focus somewhere else on the screen (swipe right a few times) | The sentences keep coming **without focus being on them**. That is WCAG 2.2 SC 4.1.3 in one step |
| B5 | Turn the Announcements switch **off** in Settings and ride again for 60 seconds | **Nothing** is spoken without the rider moving focus. Off means off |

⚠️ **"Nothing was spoken" in B3 is a result, not a failure of the procedure.** Record it as exactly
that, with A3 to A5 beside it. It would mean the live-region path the Chromium document describes
does not reach this app's WebView on this device, and that is the most important finding this file
can produce.

### B results

| Step | Spoken? (yes / no / partly) | What was said, word for word | Notes |
|---|---|---|---|
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B4 | | | |
| B5 | | | |

**The negative row — fill this in if B3 was silent:**

| | |
|---|---|
| Nothing was spoken in B3 | |
| TalkBack's own verbosity settings at the time | |
| Was the region reached by swiping to it? (`Ride metrics` → the last item) | |

---

## Part C — the politeness question, on the device under test

**Why it is asked rather than assumed.** Roselli's matrix records TalkBack **ignoring** the
difference between `role="status"` (polite) and `role="alert"` (assertive) — all assertive on one
Android, all polite on another, and which way round depends on the version. This client was built so
that **nothing depends on the answer**: priority is an *order* in the announcer core
(`apps/web/src/game/hud/announce.ts` §`PRIORITY`), never a politeness. This part records what the
device under test actually does, so the next person does not have to re-derive it.

Two roles appear in this client, and each has a step that produces it:

- **`role="status"`** — the HUD's announcement region, and every `StatusMessage live`.
- **`role="alert"`** — exactly two places, both on the trainer game's picker (#255): the pacer
  intensity refusal and the wind refusal.

| Step | What to do | What to record |
|---|---|---|
| C1 | Start a ride with power announcements every 15 s. While TalkBack is **in the middle of reading something long** (swipe to the route description and let it read), wait for a power sentence | Did the power sentence **interrupt** the reading, **wait** for it to finish, or **not arrive**? |
| C2 | End the ride. On the picker, tick *Ride with a pacer*, type **`70`** into the pacer intensity box, and activate **Ride** | The refusal is announced. Did TalkBack **prepend "alert"**? Did it interrupt whatever it was saying? |
| C3 | Repeat C2 while TalkBack is reading something long | Interrupted, queued, or dropped? |
| C4 | Compare C1 with C3 | Were `status` and `alert` treated **differently at all** on this device? |

### C results

| Step | Interrupted / waited / not heard | "Alert" prepended? | Notes |
|---|---|---|---|
| C1 | | — | |
| C2 | | | |
| C3 | | | |
| C4 | status and alert treated the same? | | |

---

## Part D — the Bluetooth device chooser ⚠️ not this repository's DOM

**Read this before starting.** On Android the shell pairs through
`@capacitor-community/bluetooth-le`, whose chooser is a **native Kotlin dialog**
(`DeviceScanner.kt` in that plugin); in a desktop browser it is Chrome's own chooser, rendered by
`navigator.bluetooth.requestDevice()`. **No ARIA in `apps/web` can change either.** This part
measures somebody else's dialog. A failure here is **recorded and not fixed here** — the honest
follow-up is a report to that plugin's maintainers, not a patch in this repository.

It is still part of "complete a ride", because a rider who cannot pair cannot start one.

| Step | What to do | What should happen |
|---|---|---|
| D1 | With TalkBack on, open **More → Devices** and activate a pairing button | TalkBack announces that a dialog opened, and its title |
| D2 | Swipe through the dialog | Each found device is read out with a name a person could recognise |
| D3 | Choose a device by double-tap | The dialog closes and pairing proceeds; the app's own screen says so (that sentence **is** ours) |
| D4 | Open the chooser again and cancel it with the Back gesture | The app says *"no device was chosen"* (ours) and focus returns to the button that opened it |

### D results

| Step | Operable? (yes / no / partly) | What TalkBack said | Notes |
|---|---|---|---|
| D1 | | | |
| D2 | | | |
| D3 | | | |
| D4 | | | |

---

## Part E — what TalkBack costs a frame

**Method: [0002](0002-android-shell-and-game.md) Part F's, by reference, and not restated.** The
same `dumpsys gfxinfo` reset-and-read over a measured window, and the same warning about which row
to read (the **legacy** jank figure, not the modern one). What this part adds is the **pairing**:
the same ride, the same window, the same phone, with TalkBack **on** and then **off**, back to back,
so the comparison is the measurement rather than either figure on its own.

⚠️ **The open question this records rather than settles**: whether this part rides along with
[#247](https://github.com/openzigs/onyourleft/issues/247), the 60-minute run on the device floor. The
proposal is that it **does** — the device, the harness and the `gfxinfo` method are the same, and a
TalkBack-on window is one more pair of rows in a session that is already being run. The owner may
decide otherwise; until they do, the table below is here so the measurement has somewhere to go
either way.

| Step | What to do |
|---|---|
| E1 | TalkBack **off**. Ride the game with power announcements every 15 s; reset the counters; ride a 15-second window; read them |
| E2 | TalkBack **on**, same everything, immediately after |
| E3 | Repeat E1 and E2 once more, in the opposite order, so a warming phone is not read as TalkBack's cost |
| E4 | Watch for an ANR dialog or a visibly stepping world with TalkBack on | a sentence |

### E results

| | E1 (off) | E2 (on) | E3 (on) | E3 (off) |
|---|---|---|---|---|
| Window (s) | | | | |
| Total frames rendered | | | | |
| Janky frames (legacy, > 16 ms) | | | | |
| Janky frames (modern) | | | | |
| Frame time 50th / 90th / 99th | | | | |
| Missed Vsync | | | | |

**E4, in your own words:**

---

## Part F — is the speech usable at ride intensity? ⚠️ needs a screen-reader user, on the bike

**The one question in the whole epic that only a rider can answer.** The announcer says at most one
sentence per three seconds and drops rather than queues; whether that is *usable* — whether a rider
at threshold, breathing hard, in headphones or over a fan, can take in *"Power 212 watts"* and act
on it — is not arithmetic, and no number here stands in for it. **This part asks for prose.**

Ride twenty minutes with TalkBack on, announcements on, and the settings the rider would actually
choose. Then answer, in their words:

| Question | Answer |
|---|---|
| F1. Which of power / distance to go / next block / climb ahead were on, at what settings? | |
| F2. Was anything said too often? Which? | |
| F3. Was anything said too late to be useful? Which? | |
| F4. Was a sentence ever cut off by the next? | |
| F5. Was it ever unclear what a sentence referred to? | |
| F6. Did "No power reading" ever arrive, and was it understood as *the sensor has gone* rather than *you are doing nothing*? | |
| F7. Anything else, in the rider's own words | |

---

## Part G — the announcements #444 shipped, one by one

What [#444](https://github.com/openzigs/onyourleft/pull/444) added (#394, #396, #397, #398), each
with the step that produces it. TalkBack on throughout.

| Step | What to do | What should be said |
|---|---|---|
| G1 | Settings: announcements on, *Say the distance to go* **every 1 km** (or 1 mi), power **never**. Ride the game on a route long enough to cross a whole kilometre | *"N kilometres to go"* once as each mark is crossed — **once**, not every frame. On a loop, the count is to the end of **this lap**, which is what the HUD's *To go* shows |
| G2 | Set power **never** and distance **never**, ride again | Nothing, apart from events |
| G3 | On the Ride screen, with a trainer granted control, start the saved workout with *Say a workout's next block* at **10 seconds** | About ten seconds before each block changes: the next block as a share of threshold, never in watts. At the change: *"Now: …"* |
| G4 | Pause the ride across a block boundary | Nothing is said about the next block while paused |
| G5 | Set *Say a workout's next block* to **never** and ride a boundary | No lookahead sentence. *"Now: …"* **is** still said — it is the visible line made audible, not a setting (#394) |
| G6 | Switch the trainer off mid-ride on the Ride screen | *"Control lost"* on the Trainer panel is announced (#394) — since #445 by the Ride screen's one region; Part J is the step that checks it is said once. ⚠️ Off the bike for this step |
| G7 | In the game, ride with a trainer that cannot take simulation mode (or none) | *"The road is not reaching your trainer"*, once, when it appears |

### G results

| Step | Said? | Word for word | Notes |
|---|---|---|---|
| G1 | | | |
| G2 | | | |
| G3 | | | |
| G4 | | | |
| G5 | | | |
| G6 | | | |
| G7 | | | |

---

## Part H — a climb ahead ([#399](https://github.com/openzigs/onyourleft/issues/399))

New in the pull request that adds this file. `apps/web/src/game/hud/climb-ahead.ts` reads the
route's own gradient profile — no new engine — and says a climb or a descent is coming at a distance
the rider chooses. A gradient that wanders inside ±3 % is not a change worth a sentence, and neither
is a stretch shorter than 100 m.

| Step | What to do | What should be said |
|---|---|---|
| H1 | Settings: announcements on, *Say a climb ahead* at **250 m**, power and distance **never**. Ride a route with a climb | *"Climb in 250 metres, N percent"* once, as the rider comes within 250 m of it |
| H2 | Ride on to the top and over | *"Descent in 250 metres, N percent"* before a real descent, in different words from the climb |
| H3 | On a **loop**, ride into the second lap past a climb | Lap two's climb is announced ahead of it; a climb already behind the rider on lap two is **not** |
| H4 | On a **point-to-point** route, ride past the end | Nothing — the route has ended, it does not wrap |
| H5 | Set the climb row to **never** | Nothing about climbs |

### H results

| Step | Said? | Word for word | Notes |
|---|---|---|---|
| H1 | | | |
| H2 | | | |
| H3 | | | |
| H4 | | | |
| H5 | | | |

---

## Part I — the sounds, with headphones ([#400](https://github.com/openzigs/onyourleft/issues/400))

New in the pull request that adds this file. **No speech engine and no dependency**: the sounds are
generated by the platform's own Web Audio, in `apps/web/src/game/web-audio.ts`, and they are this
project's own design — nothing is derived from any other product (ADR 0009). They are **off by
default**. ⚠️ **Nothing here claims a sound is better than a visual display** — the published
research does not establish that for cycling. The argument is narrower: for a rider with no visual
channel the comparison does not arise.

**What each sound is meant to be**, so a person can say whether it is:

- **The power tone** — only during a **workout** on the Ride screen, and only once the trainer has
  acknowledged a target. A steady sine at one pitch when power is within 3 % of the target; **higher
  when over, lower when under**, one octave at 25 % off. **Silence** when there is no target, no power
  reading, or the sound is muted — a dropped power meter is silence, never the lowest pitch.
- **The interval sound** — two short rising notes, at the moment a workout's block changes. The
  sentence *"Now: …"* is said at the same moment, so a rider with the sound off loses nothing.
- **The distance sound** — one short low note, when a distance-to-go mark is crossed in the game.
  Only when that sentence is also said (announcements on, distance not "never").

**Where the audio starts, and what happens when it is suspended.** The audio context is created and
resumed **only** inside a press — *Ride* in the game, a workout's *Ride* button, or either sound
control — because a browser refuses audio that starts without one, silently. If Android suspends it
(the screen goes off, another app takes the audio), sounds scheduled while suspended are not heard;
the next press of a sound control or of *Ride* resumes it. I7 checks that. A rider who leaves the
Ride screen mid-workout and comes back gets the tone back **with no press** where the audio is still
running, and nothing is resumed on the way — returning to a screen is not a gesture; where Android
suspended the audio meanwhile, the tone stays silent until *Mute sounds* or the volume is touched.
I12 checks both.

| Step | What to do | What should happen |
|---|---|---|
| I1 | With Sounds **off** (the default), ride a workout | **No sound at all** |
| I2 | Settings → Sounds: on, volume 50 %. Ride a workout with a power meter | The tone, steady when on target |
| I3 | Push hard, then ease right off | The pitch **rises**, then **falls** below the steady pitch |
| I4 | Switch the power meter off mid-interval | The tone **stops**. It does not drop to its lowest pitch |
| I5 | Press **Mute sounds** on the ride screen, mid-ride | Silence, at once. Press again: sound returns |
| I6 | Move **Sound volume** mid-ride, with the **phone's own volume unchanged** | The sound gets quieter and louder independently of the system volume — WCAG 2.2 SC 1.4.2 |
| I7 | Lock the screen for 30 s mid-ride, unlock, press **Mute sounds** twice | Sound resumes; record whether it was ever heard while locked |
| I8 | Ride across a block boundary | Two rising notes, **and** *"Now: …"* with TalkBack on |
| I9 | In the game, with distance every 1 km, cross a mark | One low note **and** *"N kilometres to go"* |
| I10 | End the workout, then end the ride | The tone **stops** with the workout, and nothing is left sounding |
| I11 | Start a second workout straight after | **One** tone, not two layered on each other |
| I12 | Mid-workout with the tone sounding, open **Routes**, wait 10 s, return to **Ride**. Then repeat with the screen locked for 30 s while away | The first time the tone **returns on its own**. The second, record whether it returned; if not, pressing **Mute sounds** twice brings it back |
| I13 | ([#447](https://github.com/openzigs/onyourleft/issues/447)) End a workout, then play music from another app for 30 s, then start a second workout straight away | The music is **not** interrupted or ducked after the first workout ends (the app has let the audio stop), and the second workout's tone **is** heard from its first press — the press on *Ride* wakes it |

### I results

| Step | As described? | What was heard | Headphones (wired / Bluetooth, model) |
|---|---|---|---|
| I1 | | | |
| I2 | | | |
| I3 | | | |
| I4 | | | |
| I5 | | | |
| I6 | | | |
| I7 | | | |
| I8 | | | |
| I9 | | | |
| I10 | | | |
| I11 | | | |
| I12 | | | |
| I13 | | | |

**Could the rider tell the three sounds apart while riding hard? In their words:**

---

## Part J — one voice while riding ([#445](https://github.com/openzigs/onyourleft/issues/445))

Before #445, *"Control lost"*, *"Not released"*, a workout fault, the game's road notice and a
refused gradient write were each spoken by a live region of their own, beside the announcer's
throttle — so a routine power sentence could be spoken in the same second as *"Control lost"*, and
the HUD carried three regions while a notice stood. Since #445 each goes through the announcer into
the screen's **one** region, in `apps/web/src/game/hud/announce.ts`'s order, and the visible
message stays where it was. ⚠️ Steps J1 and J4 are with announcements **off**, the default: those
sentences are spoken whatever the rider chose (`announce.ts` §`ALWAYS_SPOKEN`). ⚠️ Off the bike
for J1–J3. ⚠️ J2 used to be on the Ride screen, where it **could not fail** — that screen speaks no
power sentence whatever the rider set — and it was moved to the game by #448's review.

| Step | What to do | What should be seen, and said |
|---|---|---|
| J1 | Announcements **off**. On the Ride screen, with a trainer granted control, switch the trainer off | **Seen**: *"Control lost"* on the Trainer panel. **Said**: *"Control lost: …"* **once** — not twice, and not a second time when you move TalkBack's focus onto the panel's own message (reading it by touch is expected; an unprompted repeat is the defect) |
| J2 | **In the game**, not on the Ride screen. Announcements **on**, power every **15 s**. Start a ride on a trainer that takes simulation mode and wait until a power sentence has been said at least twice (off the bike it is *"No power reading"*, which is fine). Then take control away mid-ride on another app, or refuse a gradient as in J3 | *"Trainer: …"* is said, and **no** power sentence is said within about **3 s** of it, before or after. The next power sentence comes at its own time, not in the same breath. ⚠️ **Why the game and not the Ride screen**: the Ride screen never speaks power at all (`apps/web/src/ride/RideAnnouncer.tsx` sets `powerEverySeconds: 'never'`, because its numbers are `MetricGrid`'s own), so a Ride-screen version of this step could not fail. The game's HUD is where a power sentence and a trainer sentence can collide, which is the defect #445 describes |
| J3 | In the game, on a trainer that refuses a gradient (or take control away mid-ride on another app) | **Seen**: the *Trainer* notice on the HUD. **Said**: *"Trainer: …"* once |
| J4 | Announcements **off**. Ride the game with a trainer that cannot take simulation mode | **Seen**: *"The road is not reaching your trainer"*. **Said**: the same, once, as the ride starts |

### J results

| Step | Seen? | Said? How many times? | Word for word | Notes |
|---|---|---|---|---|
| J1 | | | | |
| J2 | | | | |
| J3 | | | | |
| J4 | | | | |

---

## After the session

1. **Fill the tables in this file and commit it**, with the date and who ran each part. An empty
   table in `main` is the honest state; a filled one is the evidence.
2. **File a defect per finding**, one issue each. A Part B that was silent is the first and most
   important one, and it blocks nothing else from being recorded.
3. A Part D failure is **reported to the plugin's maintainers** and linked from here. It is not
   fixed in this repository, because it is not this repository's dialog.
4. If Part E shows a real cost, it goes to the owner as a decision — whether announcements should
   warn that TalkBack itself is expensive on this device — rather than being fixed by lowering
   the frame rate.

---

## What this procedure cannot establish

- **That every screen-reader user would agree.** One person riding one afternoon is one data point.
  It is a floor, not a verdict.
- **Anything about iOS or VoiceOver.** [ADR 0018](../adr/0018-native-client-platform.md) decides the
  platform; there is no iOS build to run it on.
- **Anything about another Android screen reader.** TalkBack only.
- **That the audio cues help anybody ride better.** It asks whether they are distinguishable and
  controllable, which is the claim the code makes. Whether they improve a ride is a study, not an
  afternoon.
- **That the design of any sentence or sound is right.** It asks whether each does what it says.
  Whether riders want different ones is for the rider in Part F to tell us, in their own words.
