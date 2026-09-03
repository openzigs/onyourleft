# ADR 0003: Platform support matrix and permanent platform gaps

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner. Decisions **D2** (Bluetooth only, ANT+ dropped) and **D6** (no
  server in Phase 1) were taken in Revision 2 of
  [#1](https://github.com/openzigs/onyourleft/issues/1); the client stack was taken in
  [#86](https://github.com/openzigs/onyourleft/issues/86) on 2026-09-03. This ADR records the
  platform consequences of those decisions, and makes the four this issue was left to make — D-3,
  D-5, D-6 and D-7 below
- **Issue**: [#20](https://github.com/openzigs/onyourleft/issues/20)
- **Supersedes**: nothing
- **Constrains**: [#8](https://github.com/openzigs/onyourleft/issues/8),
  [#39](https://github.com/openzigs/onyourleft/issues/39),
  [#40](https://github.com/openzigs/onyourleft/issues/40),
  [#44](https://github.com/openzigs/onyourleft/issues/44),
  [#48](https://github.com/openzigs/onyourleft/issues/48),
  [#49](https://github.com/openzigs/onyourleft/issues/49),
  [#15](https://github.com/openzigs/onyourleft/issues/15) and its sub-issues
- **Relates to**: [ADR 0005](0005-tech-stack.md) (the stack this matrix is a property of), ADR 0008
  ([#86](https://github.com/openzigs/onyourleft/issues/86), mobile client architecture — this ADR
  consumes its choice and does not reopen it), ADR 0002
  ([#57](https://github.com/openzigs/onyourleft/issues/57), local-first architecture)

> **This ADR decides reach, not implementation.** It does not implement the Web Bluetooth adapter
> (#40) or the mobile client (#15). It states which platforms this product runs on, in which phase,
> with which capabilities — and, more importantly, which of the gaps are **permanent** so that
> nobody files an issue for them in two years.

---

## Context

### What this ADR is for

A support matrix that only lists what works is half a document. Every line in it decays into a
support question, and the questions that cost the most are the ones about things that will never
work: "when will this work in Safari", "why can I not record with the screen off", "can we add
ANT+". Those have answers, the answers are structural, and the value of writing them down once is
that the answer survives the person who researched it.

So this ADR has two halves. The first is the matrix. The second names each permanent gap, gives the
reason it is permanent rather than pending, and says what evidence would have to change for it to
stop being permanent.

### What is already settled, and is not reopened here

Three decisions are inputs to this ADR rather than questions it asks:

| Settled | Where | What this ADR does with it |
| --- | --- | --- |
| **Bluetooth Low Energy only. ANT+ is out of scope permanently, on every platform.** Owner decision **D2** | Revision 2 of #1; enforced in source by `scripts/check-repo-rules.sh` rule `SCOPE001`; stated in CLAUDE.md §6 | Records the platform consequence and the reason, in one place, marked permanent. Documentation may name ANT+ **to explain why it is excluded**; source may not |
| **Phase 1 has no server, no account and no network.** Owner decision **D6** | Revision 2 of #1; CLAUDE.md §1 | Every Phase 1 cell below is a capability of the athlete's own machine. Nothing in the matrix is satisfied by "the server does it" |
| **The mobile client is Capacitor + TypeScript**, chosen so that `packages/domain`, `packages/fit`, `packages/sensors` and `packages/store` ship **unchanged** rather than being reimplemented in a second language | ADR 0008 (#86) | Consumed. The matrix's Phase 3 and Phase 6 rows are the rows a Capacitor client produces. Reopening the stack is a change to ADR 0008, not a finding against this matrix |

### Sources, with fetch dates

Every browser-support claim in this document is from one of these, read on the date shown. **These
figures drift.** Re-read them rather than quoting this table; the point of recording the date is
that a future reader can tell whether it has moved.

| Source | Read | Observed |
| --- | --- | --- |
| `caniuse` feature `web-bluetooth`, from `Fyrd/caniuse` `features-json/web-bluetooth.json` | **2026-09-03** | `status: unoff`; `usage_perc_y` **76.46**, `usage_perc_a` **0** |
| The same file, per browser | **2026-09-03** | Chrome `y` from **56** (highest tracked 154) · Edge from **79** (151) · Opera from **43** · Samsung Internet from **6.2–6.4** · Chrome Android **151** · **Firefox `n` through 157** · **Firefox Android `n` through 153** · **Safari `n` through 27 including Technology Preview** · **iOS Safari `n` through 26.6** |
| WebBluetoothCG `implementation-status.md` (`main`) | **2026-09-03** | "In **Android, Chrome OS, Mac and Windows**, the GATT Communication API is shipped without any flag." · "**Linux** is partially implemented and not supported. The `chrome://flags/#enable-experimental-web-platform-features` flag must be enabled." · Linux "Requires Kernel 3.19+ and BlueZ 5.41+" · **"Android WebView: Will be supported in the future"** (i.e. not today) · **"iOS: … no implementation planned in the Chromium codebase"** · `getDevices()` 83 🚩 and Persistent Device Permissions 83 🚩 on every platform · `watchAdvertisements()` 85 🚩 on **Android, Mac and Windows only** — blank for **Chrome OS and Linux** · "Some Bluetooth GATT operations can't be run in parallel yet" |
| Mozilla `standards-positions`, merged data, entry `95` | **2026-09-03** | **`position: negative`**. Rationale, verbatim: *"The Web Bluetooth CG has opted to only rely on user consent, which we believe is not sufficient protection. This proposal also uses a blocklist, which will require constant and active maintenance so that vulnerable devices aren't exploited. This model is unsustainable and presents a significant risk to users and their devices."* |
| WebKit `standards-positions`, `summary.json`, issue **570** | **2026-09-03** | **`position: oppose`**, concerns `privacy`, `security`, `device independence`. Resolved **2025-12-02**: *"The low-level nature of this API means that it is insecure, has a massive privacy risk, and perhaps most importantly doesn't meet the web platform's device-independence bar. Resolving this as position: oppose"* |
| WebBluetoothCG issue **#342**, "Deal with a limit on the number of active connections" | **2026-09-03** | **Open**, filed **2016-12-19**, last updated 2017-01-23 |
| WebBluetoothCG issue **#188**, "GATT operation in progress — how to handle it?" | **2026-09-03** | **Open**, filed 2015-11-24 |
| `@capacitor-community/bluetooth-le`, npm registry metadata | **2026-09-03** | **8.3.0**, published **2026-08-13**, `license: MIT`, peer `@capacitor/core >=8.0.0` |

Two notes on that table, because both are the kind of detail that gets quietly rounded off:

- **`caniuse`'s link text for Mozilla's position still reads "Harmful", and the position record now
  reads `negative`.** Mozilla renamed the label; the substance is unchanged and the rationale above
  is the current text. This ADR uses `negative` because that is what the record says today. Anyone
  re-checking against the older wording is looking at the same decision.
- **`usage_perc_a` is `0`.** There is no partial-support population. A browser either implements
  Web Bluetooth or it does not, so `76.46%` is the whole of the reachable audience and the
  remaining ~24% is not "degraded", it is zero.

### Why the browser gaps are permanent rather than pending

This is the load-bearing paragraph of the ADR, and until 2025-12-02 it could not have been written
this strongly.

**Both remaining engines have now formally opposed the specification, on the record, with reasons.**
Mozilla's position is `negative` and WebKit's is `oppose`, and neither is a resourcing statement.
Mozilla objects that consent-plus-blocklist is not a sustainable security model for granting a web
page access to arbitrary GATT services. WebKit objects on privacy, security **and device
independence** — the last being an argument that an API whose behaviour depends on which physical
peripherals the user owns does not belong on the web platform at all. Those are objections to the
design of the API. No amount of engineering effort by this project, and no amount of user demand,
addresses them.

The specification's own status corroborates it: `caniuse` records `unoff`. Web Bluetooth is a **W3C
Community Group draft**, not a standards-track document, ten years after the first Chrome
implementation. It has one implementer.

**Therefore: Safari and Firefox are permanent gaps, not backlog items.** Writing "no roadmap" was
the honest thing to write in 2024. In 2026 the stronger and more accurate statement is available,
and it is the one that stops the question being re-asked.

### The Web Bluetooth constraints that shape the product

These are product constraints, not bugs, and not things a better implementation of #40 removes.
CLAUDE.md §8 already states them; this ADR is where they are argued and dated.

- **Secure context only** — HTTPS or `localhost`.
- **`requestDevice()` requires a user gesture, one per device**, and cannot be called
  programmatically. A trainer plus a heart-rate strap plus a power meter is **three separate
  clicks**, by design. #49 must not be designed around a single "pair everything" button.
- **`optionalServices` must be declared up front** or `getPrimaryService()` throws.
- **Not exposed on `WorkerNavigator`** — no Web Worker. Parsing runs on the main thread alongside a
  ride screen updating at 1 Hz.
- **Blocked in cross-origin iframes** by default (Permissions Policy `bluetooth`, allowlist `self`).
- **No background operation.** The tab must stay live. See the permanent-gap table below.
- **Silent reconnect is flag-gated, not absent.** `getDevices()` (Chrome 83),
  `watchAdvertisements()` (Chrome 85), `device.forget()` and Persistent Device Permissions all
  exist — behind `chrome://flags`, with `watchAdvertisements()` **absent on Chrome OS and Linux
  entirely**. The product conclusion is unchanged (do not build automatic reconnection), and the
  wording matters because "flag-gated in 2026" is a sentence someone can usefully re-check, while
  "does not exist" is one they will find to be false and then distrust the rest of the document.
- **~3 concurrent GATT connections is the planning number, not 7.** The ceiling is **OS-wide and
  shared with everything else the user has paired** — AirPods, a watch, a keyboard — none of which
  is observable from inside the page. Android's Bluedroid caps at 7; a real report hit
  `DOMException` on the third device. WebBluetoothCG issue **#342** has been open since **2016** and
  the specification has no answer. A trainer plus an HRM plus a power meter is already three, which
  is why **taking power and cadence from the trainer's own FTMS stream is preferred over opening
  separate connections** (#8, #43).
- **GATT operations do not run in parallel** (WebBluetoothCG #188, open since 2015), and FTMS
  §4.16.3 independently mandates one control-point procedure at a time. #40 owns a **single global
  operation queue across all devices**, not one per device.

---

## Decision

### D-1 — The matrix

Legend, and it is deliberately four values rather than three:

| | Meaning |
| --- | --- |
| ✅ | Supported |
| ⚠️ | Works only under a stated condition, which the user must satisfy |
| ❌ | Not supported now. Could change — a client we have not built yet would deliver it |
| ⛔ | **Permanently unsupported.** Structural. Nothing this project builds changes it |

The ⛔ / ❌ distinction is the whole point of the document. A ❌ is a backlog entry. A ⛔ is not, and
must never be turned into one.

Capabilities, defined once so a cell means the same thing everywhere:

- **BLE sensors** — connect to and read a heart-rate strap (`0x180D`), power meter (`0x1818`) or
  cadence/speed sensor (`0x1816`).
- **Trainer control** — write the FTMS (`0x1826`) control point for ERG, resistance and gradient.
  This is the capability that makes the product a cycling application rather than a log.
- **Background recording** — keep receiving GATT notifications and writing samples while the app is
  not the foreground window and, on a phone, while the screen is off and the phone is in a jersey
  pocket.
- **GPS position** — record a location track for an outdoor ride.
- **Silent reconnect** — re-establish a previously paired device without a user gesture.

#### Phase 1–2 — the web client, the only client that exists

`apps/web`, Chrome-family, no server, no account (#48–#51, D6).

| Platform / browser | BLE sensors | Trainer control | Background recording | GPS position | Silent reconnect |
| --- | :---: | :---: | :---: | :---: | :---: |
| Android — Chrome, Edge, Samsung Internet 6.2+, Opera | ✅ | ✅ | ⛔ | ⚠️ ¹ | ❌ ² |
| Chrome OS — Chrome | ✅ | ✅ | ⛔ | ⚠️ ¹ | ❌ ² ³ |
| macOS — Chrome, Edge | ✅ | ✅ | ⛔ | ⚠️ ¹ | ❌ ² |
| Windows 10 v1703+ — Chrome 70+, Edge 79+ | ✅ | ✅ | ⛔ | ⚠️ ¹ | ❌ ² |
| Linux — Chrome, default configuration | ❌ ⁴ | ❌ ⁴ | ⛔ | ⚠️ ¹ | ❌ ² ³ |
| Linux — Chrome with the experimental flag, kernel 3.19+, BlueZ 5.41+ | ⚠️ ⁴ | ⚠️ ⁴ | ⛔ | ⚠️ ¹ | ❌ ² ³ |
| **Any platform — Firefox** | ⛔ ⁵ | ⛔ ⁵ | ⛔ | ⚠️ ¹ | ⛔ ⁵ |
| **macOS — Safari** | ⛔ ⁶ | ⛔ ⁶ | ⛔ | ⚠️ ¹ | ⛔ ⁶ |
| **iOS / iPadOS — Safari** | ⛔ ⁶ | ⛔ ⁶ | ⛔ | ⚠️ ¹ | ⛔ ⁶ |
| **iOS / iPadOS — Chrome, Edge, Firefox** | ⛔ ⁷ | ⛔ ⁷ | ⛔ | ⚠️ ¹ | ⛔ ⁷ |
| iOS / iPadOS — Bluefy, WebBLE, iOSWebBLE extension | ⚠️ ⁸ | ⚠️ ⁸ | ⛔ | ⚠️ ¹ | ❌ |
| Android — WebView / in-app browsers (the link opened inside a chat app) | ❌ ⁹ | ❌ ⁹ | ⛔ | ⚠️ ¹ | ❌ ⁹ |

¹ `navigator.geolocation` is available in every browser above, so an outdoor track is technically
recordable — but only while the tab is live and foregrounded, because the same
no-background-execution limit applies. Phase 1's product is the **indoor** ride; outdoor recording
on a phone in a pocket is #15's, and the ⛔ in the background column is why.
² Flag-gated, per the constraints list above. Treat as unavailable; do not build automatic
reconnection.
³ `watchAdvertisements()` is absent on Chrome OS and Linux entirely, so even the flag-gated path is
narrower there.
⁴ WebBluetoothCG: "Linux is partially implemented and **not supported**." `navigator.bluetooth` may
be **present while the adapter is unusable**, which is why #40 and #48 must probe capability rather
than sniff for the object's existence.
⁵ Mozilla `standards-positions`: **`negative`**, on security grounds. Not a backlog.
⁶ WebKit `standards-positions`: **`oppose`**, on privacy, security and device-independence grounds.
Not a backlog.
⁷ Every iOS browser is WKWebView. Chrome on iOS is not Chromium's engine, and WebBluetoothCG records
"no implementation planned in the Chromium codebase" for iOS. **There is no third-party escape on
iOS**, which is a different and stronger statement than "Safari does not support it".
⁸ Third-party browsers that bridge to CoreBluetooth. They work. **They are not a supportable
mainstream path** — this project will not tell a user to install a specific alternative browser to
use the product — and this project takes no dependency on them. Named so that the matrix is honest,
not as a route.
⁹ WebBluetoothCG: "Android WebView: Will be supported in the future." **A Capacitor Android app
therefore cannot use `navigator.bluetooth`** — see D-5.

**No row of this matrix is satisfied on a phone with the screen off.** That single fact is the
entire reason [#15](https://github.com/openzigs/onyourleft/issues/15) exists.

#### Phase 3 — the Android client (#85, Capacitor)

Adds one row. Everything above is unchanged.

| Platform / client | BLE sensors | Trainer control | Background recording | GPS position | Silent reconnect |
| --- | :---: | :---: | :---: | :---: | :---: |
| Android — `apps/mobile`, Capacitor + native BLE bridge † | ✅ | ✅ | ⚠️ ¹⁰ | ✅ | ✅ |

† **This matrix does not set the minimum OS version** — that is #15's and #85's to establish and
measure. ADR 0008 sets a *rendering* device floor for the game (Android 9+, arm64-v8a, 3 GB RAM,
OpenGL ES 3.0, 30 fps at 720p), which is a different constraint from the BLE floor and must not be
borrowed for it.

¹⁰ Achievable, and it is **imperative infrastructure rather than a declaration**: a foreground
service of type `connectedDevice`, its permission, its ongoing notification, and an unbounded tail
of OEM battery-optimisation behaviour with no API that makes it deterministic. #85 is a
**foreground** game — the rider is looking at the screen — so this cell is not on #85's critical
path. It is squarely on #15's. See D-6.

#### Phase 6 — iOS and desktop (#15)

| Platform / client | BLE sensors | Trainer control | Background recording | GPS position | Silent reconnect |
| --- | :---: | :---: | :---: | :---: | :---: |
| iOS — `apps/mobile`, Capacitor + CoreBluetooth bridge † | ✅ | ✅ | ✅ ¹¹ | ✅ | ✅ ¹¹ |
| macOS / Windows / Linux — desktop client | ✅ ¹² | ✅ ¹² | ✅ | ✅ | ✅ |

¹¹ On iOS background BLE is **declarative**: the `bluetooth-central` background mode plus a
CoreBluetooth restore identifier, after which the OS relaunches the app to deliver each
notification. State restoration is also what gives iOS silent reconnect for free. This is the
inversion of the Android story and D-6 turns on it.
¹² A desktop client is what closes the Safari-on-macOS, Firefox-everywhere and
Linux-without-a-flag cells in one move, for people at a desk. It does not close the iPhone gap.

### D-2 — The permanent gaps, named

| Gap | Scope | Why it is permanent | What would overturn it |
| --- | --- | --- | --- |
| **Web Bluetooth in Safari**, desktop and iOS | Every version, every device | WebKit's formal position is **`oppose`**, resolved 2025-12-02 on privacy, security and device-independence grounds. An objection to the API's design, not to its priority | WebKit publishing a changed position. Not a Safari release note — the position record |
| **Web Bluetooth in Firefox**, every platform | Desktop and Android | Mozilla's formal position is **`negative`**: consent-plus-blocklist is judged an unsustainable security model | Mozilla publishing a changed position |
| **Web Bluetooth on any iOS browser** | iOS / iPadOS entirely | Every iOS browser is WKWebView. This is an OS-level constraint, not a vendor choice by Google or Mozilla, and it is why the Safari gap is an **iPhone** gap rather than a browser-preference gap | Apple permitting third-party engines *and* one of them shipping Web Bluetooth. Both, not either |
| **Background recording in any browser, on any platform** | All of Phase 1–2 | A page has no execution guarantee when it is not foregrounded. This is not a Web Bluetooth limitation and it is not fixable by a Web Bluetooth change; it is what a browser tab *is* | Nothing on the roadmap of any engine. The answer is a native client (#15), which is why #15 exists |
| **ANT+, on every platform, in every phase** | The whole product | See D-4. Four independent reasons, each sufficient | Nothing. This is a scope decision, not a capability assessment |
| **ANT+ on iOS specifically** | iOS / iPadOS | **No API exists.** ANT+ needs a built-in ANT radio or a USB-OTG stick plus ANT Radio Service — Android only, and there is no iOS equivalent to build against | Apple shipping an ANT radio API. Not foreseeable, and moot given D-4 |

**These are ⛔, and ⛔ does not go in a backlog.** A backlog entry implies it will happen. If one of
the "what would overturn it" columns ever comes true, the correct response is a **new ADR
superseding this one**, not an issue titled "add Safari support".

### D-3 — Native iOS: **committed**, as a hybrid client, in Phase 6

**Committed.** Not "if there is demand". The reasoning is arithmetic rather than preference: a
browser-only product reaches **zero** iPhone users, and there is no partial credit — `usage_perc_a`
is `0`, and every iOS browser is the same engine. An iOS client is not an enhancement of the web
client's reach; it is the difference between a number and zero.

"Native" in the sense the question was asked — *a bespoke Swift/CoreBluetooth application* — is
**not** committed and is explicitly rejected. See D-5. What is committed is **an iOS application in
the App Store**, built as a Capacitor client, using CoreBluetooth through a native bridge. From the
user's side that distinction is invisible, which is the point.

**Phase 6, after #85.** Sequenced there for the reason in D-6, not because iOS is lower value.

### D-4 — ANT+: **not required**, out of scope permanently, and absent from this matrix

Owner decision **D2**, recorded here as settled. Four reasons, each independently sufficient:

1. **No browser path exists, on any platform.** Web Bluetooth is BLE by definition. ANT+ is
   unreachable from every browser this product will ever run in.
2. **No iOS path exists at all.** ANT+ requires a built-in ANT radio or a USB-OTG stick plus ANT
   Radio Service — Android only. There is no API to write against. This is the D-2 row marked ⛔ and
   it is the one most likely to be mistaken for a backlog item, because "not on iOS yet" is such a
   familiar sentence.
3. **The specification is behind a login wall.** `thisisant.com/resources/fitness-equipment-device`
   returned "Restricted Access" when checked on 2026-09-02. An open-source project cannot implement
   from a document its contributors cannot read.
4. **The network key may not be committed to a public repository.** The ANT+ Shared Source License
   forbids redistributing source containing it. This repository is public and its history is
   permanent.

It buys legacy hardware and costs an entire native track. **BLE covers modern hardware** — every
trainer, power meter, HR strap and cadence sensor in this product's scope speaks one of the four
standard GATT services.

**Why there is no ANT+ row in the matrix.** A row of ⛔ across every platform invites the reading
that ANT+ is a tracked capability which happens to be unavailable everywhere. It is not tracked at
all. Naming it in prose, once, with the reasons, records the exclusion without implying a plan —
and `SCOPE001` enforces the same distinction mechanically: documentation may name ANT+ **to explain
why it is excluded**, source may not.

### D-5 — Hybrid, not bespoke native — and one thing that follows from it that is easy to get wrong

**Decided in ADR 0008 (#86): Capacitor + TypeScript.** This ADR consumes that and records the
platform consequences.

The decisive property is that `packages/domain`, `packages/fit`, `packages/sensors` and
`packages/store` ship **unchanged**, and — because Capacitor wraps the same web build — so do
`apps/web`'s screens. A bespoke Swift client and a bespoke Kotlin client would fork
`packages/sensors` into two more languages, which is a permanent tax on every protocol fix
thereafter. `@capacitor-community/bluetooth-le` 8.3.0 (MIT, published 2026-08-13) reaches both
platforms and already wraps every call in an internal queue.

**The thing that is easy to get wrong**, and it is a platform fact rather than a design opinion:

> **A Capacitor Android app cannot use the Web Bluetooth adapter from #40.** WebBluetoothCG's own
> status file lists Android WebView under *unsupported platforms* — "Will be supported in the
> future". `navigator.bluetooth` is not there. Every hybrid client, on both platforms, talks to a
> **native BLE bridge**, never to the browser API it resembles.

That is precisely why #39's transport interface is platform-free and why `packages/sensors/src` must
stay free of Web Bluetooth types: the interface has three implementations to satisfy — Web
Bluetooth, CoreBluetooth and Android BLE — and an interface that can name a browser type has already
chosen one of the three.

It is also why the plugin's Web-Bluetooth-*shaped* API is a trap if read as a drop-in. It exposes a
flattened, `deviceId`-keyed form, not Web Bluetooth's object graph, so the flattening work lands in
the adapter (#40's `deviceId → {device, server, service, characteristic}` map) rather than being
absent.

### D-6 — Android closes the capability gap; iOS closes the reach gap

Android and iOS pull in **opposite** directions, and a matrix that implies symmetry between them
would mislead the issue that inherits it. Stated plainly:

| | Android | iOS |
| --- | --- | --- |
| **Development cost** | **Lower.** No Mac, no paid developer account, no review gate. Real introspection via `adb shell dumpsys`. For an open-source project that wants contributors, this matters more than it looks | **Higher.** A contributor needs a Mac, an iPhone **and** a paid account before they can run the thing once |
| **Background BLE cost** | **Higher.** A `connectedDevice` foreground service, its permission and its notification — plus an unbounded tail of OEM battery-killer behaviour with no API that makes it deterministic. Android does not serialise GATT operations for you, so operation queues, Binder-thread rules, `close()` discipline, `TRANSPORT_LE` and GATT 133 recovery are all real work | **Lower.** Declarative: `bluetooth-central` plus a restore identifier, and the OS wakes the app per notification. CoreBluetooth serialises GATT operations for you. Essentially the entire Android BLE reliability literature is work that **does not exist** on iOS |
| **Incremental reach** | **Near zero.** Android Chrome already has Web Bluetooth via #40. A native Android client re-serves users the web client already reaches | **The entire iPhone population, from zero.** |

**Therefore, and this is the sentence #15 should be read against: Android is where the background
capability is won, and iOS is where the audience is won.** Spike the hard background problem on the
cheap platform; ship the client where the gap is.

That is what makes #85 (Android, Phase 3, foreground game) a natural predecessor to #15 (iOS +
background, Phase 6) rather than a detour: #85 builds the native BLE bridge on the platform where
building it is cheapest, without needing the background capability that platform makes hardest, and
#15 inherits the bridge.

**One caveat #15 must carry, because it is the go/no-go rather than a detail.** A foreground service
keeps the *process* alive, and `BluetoothGatt` connections are held by the process, so the
connections survive. The open question is whether the **WebView keeps delivering notification
callbacks into JavaScript** while the Activity is backgrounded. If the WebView is suspended under
memory pressure, the connections stay open and the samples go nowhere — a silent failure that looks
exactly like working software. That is the hybrid go/no-go for #15, not "does background BLE work",
and it is a **measurement**, not a judgement.

### D-7 — What an unsupported browser must be shown

Feeds the acceptance criteria of [#48](https://github.com/openzigs/onyourleft/issues/48).
**"Silently broken" is explicitly rejected**: roughly a quarter of first-time visitors arrive in a
browser where the core feature cannot work, and the default outcome — a pairing button that does
nothing, with an error in a console the user will never open — is the worst possible one.

The rules, in the order they bind:

1. **Detect capability, never the user agent.** UA sniffing misclassifies browsers that do not exist
   yet, and it gets Linux wrong today in the more dangerous direction: `navigator.bluetooth` can be
   **present while the adapter is unusable**. Probing must reach past the object's existence.
2. **Name the browsers that do work.** "Your browser is not supported" is useless.
3. **Say the limitation is the browser's, not the user's.** Safari and Firefox have **no Web
   Bluetooth implementation at all**, by their vendors' stated positions. A user who did nothing
   wrong must not be shown a message implying they did.
4. **Distinguish permanent from pending.** Safari and Firefox are ⛔ and the honest message says so,
   pointing at #15 as the answer rather than implying a future browser update. Chrome on Linux is
   ⚠️ and gets a **different, actionable** message: the flag, kernel 3.19+, BlueZ 5.41+.
5. **Do not hide the constraints in the working path either.** One user gesture per device means
   three clicks for three devices; there is no silent reconnect; and there is no background
   recording. #49 must not design a UI that implies otherwise — a "pair everything" button cannot
   exist, and a UI that suggests recording continues in the background is a data-loss bug wearing a
   design.

---

## Consequences

### For the issues this ADR blocks

- **#8 (device connectivity)** — scope is confirmed as four BLE GATT services and no transport
  beyond BLE, in any phase. The ~3-connection planning number stands, with the corollary that
  **power and cadence should be taken from the trainer's own FTMS stream** rather than by opening
  separate connections. The ceiling must be **measured per host adapter**, never assumed.
- **#39 / #40 (sensor abstraction and the Web Bluetooth transport)** — the interface has three
  implementations to satisfy, not one. Web Bluetooth types must not escape the transport boundary.
  #40's `unavailable` path must cover **Linux-with-the-object-present-but-unusable**, not only
  "`navigator.bluetooth` is absent". A **single global** GATT operation queue across all devices.
- **#44 (the simulator)** — becomes more load-bearing than it looks. Every ⛔ row above is a
  platform where a contributor cannot test with real hardware, and requiring a £1,000 trainer to
  contribute to the BLE layer means a contributor pool of one.
- **#48 (app shell)** — inherits D-7 directly.
- **#49 (pairing UX)** — inherits the gesture-per-device and no-silent-reconnect constraints.
- **#15 (iOS, desktop, background)** — inherits D-3, D-5 and D-6: hybrid not bespoke, spike on
  Android, ship on iOS, and the WebView-callback question is the go/no-go.

### Costs this decision accepts, knowingly

- **~24% of visitors cannot use the core feature in Phase 1**, and the figure is not softenable:
  there is no partial-support population.
- **Zero iPhone reach until Phase 6.** This is the largest single cost in the matrix and it is
  accepted for the phase order's sake, not because it is small.
- **Linux contributors need a flag.** For a project whose contributors skew Linux this is an
  onboarding problem rather than a footnote, and it is why the Linux rows are listed separately
  rather than folded into "Chrome".
- **No background recording anywhere until Phase 6.** Phase 1's product is the indoor ride.

### A licence trap this ADR's research surfaced, recorded so it is not re-discovered

The desktop client in #15 is expected to use the `webbluetooth` npm package. Its registry metadata,
read **2026-09-03**, declares **`"license": "MIT"` on every published major from 0.x through 7.x**,
while the *bundled SimpleBLE build* differs by major. Both can be true: the manifest field describes
the JavaScript, the bundled native library carries its own terms.

**Naming the majors turns this from a warning into a rule §3 already decides.** The package's own
`dist-tags` state the bundled licence, read from `registry.npmjs.org/webbluetooth` on 2026-09-03:

| dist-tag | Version | Bundled SimpleBLE licence | Admissible under `CLAUDE.md` §3? |
|---|---|---|---|
| `mit` | 3.6.0 | MIT | Yes, anywhere |
| `latest` | **3.7.0** | MIT | Yes, anywhere |
| `bsd-3` | 4.6.0 | BSD-3-Clause | Yes, anywhere |
| `gpl-3.0` | 5.6.0 | **GPL-3.0** | **No** — a GPL dependency anywhere under `packages/` fails CI, no exemption. Admissible only under `apps/`. |
| `busl-1.1` | 6.6.0 | **BUSL-1.1** | **No, anywhere.** Not an OSI licence; `CONTRIBUTING.md` requires an ADR before any non-open-source dependency. |
| `next` | 7.0.0 | unverified | Unknown — treat as inadmissible until checked. |

So the rule for #15 and #24 is concrete rather than cautionary: **pin `webbluetooth` within 3.x.** A
caret range across a major is a silent relicensing, and 5.x and 6.x are both refused by rules this
repository already has.

The consequence is specific and it generalises past this one package: **a licence gate that reads
manifests cannot see this.** `pnpm licenses list --json` would report MIT for every one of those
majors. It is the same shape as the defect this repository already hunts in its persistence work —
a check that reports success while the thing it is supposed to observe is invisible to it. The
per-package dependency-licence allowlist in
[#24](https://github.com/openzigs/onyourleft/issues/24) must therefore verify **the artefact**, not
the manifest field, for any package that bundles a native library — and `webbluetooth` must be
pinned within a major whose bundled build has been checked, with the check recorded rather than
assumed. `dist-tags.latest` was **3.7.0** on 2026-09-03, i.e. upstream itself is holding latest
below the majors in question.

### What would overturn this ADR

Three things, in descending likelihood:

1. **A changed engine position.** WebKit moving off `oppose`, or Mozilla off `negative`. That is the
   record to watch, not a release note. It would reopen the two largest ⛔ rows.
2. **The #15 WebView-callback measurement failing.** If a backgrounded Capacitor WebView does not
   receive GATT notifications and cannot be made to, the hybrid route does not deliver background
   recording, D-5's shared-code argument survives but D-3's *route* does not, and the fallback is
   React Native — under which the leaf packages are still identical, which is what makes it
   survivable.
3. **The concurrent-connection ceiling measuring materially below three** on real host adapters.
   Three is a planning number taken from an open specification issue and one field report; it is the
   softest figure in this ADR. If measurement contradicts it, the product design (which sensors to
   connect at once) changes, not the platform matrix.

None of the three is reason to edit this file. `docs/adr/*.md` is a protected path: an ADR is
amended by a **new** ADR that supersedes it.

---

## Notes

Every figure in the sources table drifts, and one already has: `caniuse` recorded desktop Safari at
`n` through **26.6** when #20 was written on 2026-09-02 and `n` through **27** when it was re-read
on 2026-09-03. That is what drift looks like here — the version ceiling moves, the `n` does not.
`usage_perc_y` moves monthly and should be re-read before it is quoted anywhere user-facing.

The two positions are the exception, and are the reason this ADR can say "permanent" rather than
"no roadmap". A support percentage is a measurement of the present. A published standards position
with a stated rationale is a statement about the future, from the only two parties who could change
it.
