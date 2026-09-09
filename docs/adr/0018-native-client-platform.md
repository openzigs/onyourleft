# ADR 0018: One client on more platforms — Capacitor for iOS, and no desktop client yet

- **Status**: Accepted
- **Date**: 2026-09-09
- **Deciders**: the repository owner, on the question
  [#15](https://github.com/openzigs/onyourleft/issues/15) names as *"the decision this epic must
  make first"*. Drafted as engineering work; the ruling is the owner's, because two of the four
  options are foreclosed by a **licence** and `CLAUDE.md` §3 makes those answerable before the code
  is written
- **Issue**: [#15](https://github.com/openzigs/onyourleft/issues/15)
- **Number**: **0018**. Every number from 0001 to 0017 was written and `CLAUDE.md` §7 recorded 0018
  as the next free one with no live reservation — the check §7 asks for before a number is taken.
  The same pull request moves that sentence and
  [`docs/architecture.md`](../architecture.md)'s index on to 0019
- **Supersedes**: nothing
- **Extends**: [ADR 0008](0008-mobile-client-architecture.md) D-1, which chose Capacitor **for
  Android and the trainer game**. This carries the same choice to iOS and says why the reasons
  transfer — and, more usefully, records the one place ADR 0008 did not have to look
- **Relates to**: [ADR 0001](0001-licence.md) and `CLAUDE.md` §3, which decide two of the options
  below without reference to any technical merit

---

## Context

#15 exists for one capability the web client cannot have at any quality: **recording while the phone
is in a jersey pocket.** Everything else it lists — iOS at all, Safari and Firefox on the desktop,
Chrome on Linux without a flag — is reach. Background recording is the reason.

Its own revision block did most of this ADR's research already, on 2026-09-03, and this document's
job is to turn that into a decision rather than to redo it. Three findings from it are load-bearing
and are restated here because an ADR that cites a issue body ages badly when the issue is edited:

**1. Two options are foreclosed by architecture, not by licence.** Flutter and Kotlin Multiplatform
each fork `packages/sensors` into a second language. #15's *first* acceptance criterion is that the
mobile client uses #39's sensor interface **with no changes to the interface itself**, *"a diff of
`packages/sensors`-equivalent shows adapter additions only."* A second implementation in a second
language is not an adapter addition. That is the whole argument and it does not need a licence.

> ⚠️ A licence argument against Flutter **was considered and withdrawn**, and #15 records it so
> nobody reopens Flutter on discovering it: `flutter_blue_plus` 2.3.12 did relicense to a
> proprietary "FlutterBluePlus License v1.5", but `flutter_reactive_ble` 5.5.0 is BSD-3-Clause and
> OSI-approved. **Flutter is struck on the criterion above, not on that.**

**2. `webbluetooth` publishes licence-variant majors.** 3.x bundles MIT SimpleBLE 0.6.1; **4.x is
BSD-3, 5.x is GPL-3.0, 6.x is BUSL-1.1**. A desktop client built on it is one careless major bump
away from either a copyleft obligation or a non-OSI licence — and `CLAUDE.md` §3 makes the second
fatal everywhere and the first fatal under `packages/`. `DEP001` would catch it, which is the system
working; the point is that the *dependency* is unusually load-bearing for a version pin.

**3. The spike's hypothesis was mis-framed, and this is the correction that matters most.** A
foreground service keeps the *process* alive, and `BluetoothGatt` connections are held by the
process, so **connections survive** — that was never the risk. The real question is whether **the
WebView keeps delivering notification callbacks into JavaScript while the Activity is
backgrounded.** If the WebView is suspended under memory pressure, the connections stay open, the
samples go nowhere, and the failure is silent: software that looks like it is working and loses an
hour. *That* is the hybrid go/no-go, not "does background BLE work".

### What is already built, and what it constrains

[#87](https://github.com/openzigs/onyourleft/issues/87) created `apps/mobile`: a Capacitor shell, a
generated Android project, a `connectedDevice` foreground service, and a BLE adapter implementing
#39's interface unchanged. `capacitor.config.ts` sets `webDir: '../web/dist'`, so the shell wraps
**apps/web's build** — there is one client, and `CLAUDE.md` §4h explains at length why the trainer
game lives in `apps/web` because of it.

⚠️ **And six of #87's eight acceptance criteria were never verified.** `apps/mobile/README.md` §4 is
the table: no Android SDK in the container, `dl.google.com` refused by the egress proxy, nothing in
`android/` ever compiled, the merged manifest never asserted. That is not an argument against
Capacitor. It is the reason this ADR's decision is **conditional** rather than final, and the
condition is stated in D-4.

### The field

Read from each project's own metadata on 2026-09-02, carried from #15's revision block:

| Option | Version | Licence | Verdict |
| --- | --- | --- | --- |
| **Capacitor + `@capacitor-community/bluetooth-le`** | 8.3.0, 2026-08-13 | MIT | **Chosen.** Already in the tree; one client; #39's interface unchanged |
| `react-native-ble-plx` | 3.5.1, 2026-02-18 | ⚠️ **contradictory** | Viable but forks the UI. Its `LICENSE` is Apache-2.0 while `package.json` says MIT — both permissive, nothing blocked, contradiction unresolved upstream |
| `react-native-ble-manager` | 12.5.1, 2026-07-06 | Apache-2.0 | Viable; same fork cost |
| `btleplug` + `tauri-plugin-blec` | btleplug 0.12.0 | — | btleplug's own README states **Tauri is not supported by its maintainers** |
| `webbluetooth` (npm) | 3.7.0, 2026-04-17 | MIT **only in 3.x** | Desktop only. See finding 2 |
| Flutter / Kotlin Multiplatform | — | — | **Struck on #15's first criterion**, not on licence |

---

## Decision

### D-1 — iOS ships as a **Capacitor** target of the existing shell, not as a second client

`npx cap add ios` against `apps/mobile`, wrapping the same `apps/web` build the Android shell
already wraps. Not React Native, not Flutter, not a native Swift app.

The reasoning is one criterion and one fact. The criterion is #15's first: the sensor interface must
not change, and every non-hybrid option reimplements it. The fact is that the alternative is not
"one more client" but **two more** — an iOS client that shares nothing with Android is a third
codebase for the same product, and #15's own scope says *"this is the same product on more
platforms, not a different one."*

⚠️ **The cost is honest and it is the WebView.** Everything in finding 3 applies to iOS as well as
Android, and iOS additionally suspends a backgrounded WebView far more aggressively than Android
does. D-4 is what stops that being discovered after the code is written.

### D-2 — **No desktop client is built yet**, and `webbluetooth` is pinned within 3.x if one ever is

#15 lists Safari, Firefox and flagless Linux Chrome as reach. Reach is not the reason the epic
exists — background recording is — and a desktop client serves people sitting at a desk, which is
the one place the web client already works.

If one is built, `webbluetooth` is pinned `3.x` with an exact version and the reason recorded at the
pin, per finding 2. **A major bump of that package is a relicensing event**, and it would arrive
looking like a Dependabot chore.

### D-3 — Android is where the spike runs; **iOS is where it ships**

#15's own words, kept because the reasoning is right: Android is the harder background case and the
cheaper loop — no Mac, no $99/yr membership, no review queue, and `adb dumpsys` for ground truth.
But Android Chrome already has Web Bluetooth through
[#40](https://github.com/openzigs/onyourleft/issues/40), so a native Android client re-serves people
who are already served, while **iOS is at zero**.

Learn on the platform that is cheap to learn on. Ship on the platform with the gap.

### D-4 — This decision is **conditional on one measurement**, and the measurement is named

D-1 is reversed if the WebView does not deliver notification callbacks to JavaScript while
backgrounded. The measurement is #15's second acceptance criterion and it is not negotiable down to
a demonstration:

> A 2-hour ride recorded with the app backgrounded and the screen off produces a sample count within
> a stated tolerance of a simultaneous foreground recording.

⚠️ **"Background recording works" without a measured sample count is not a result.** #15 says so and
it is the exact failure users report as *"it lost the last hour"*.

Until that measurement exists, `apps/mobile` is an Android shell that pairs and controls a trainer
in the foreground, and this ADR's D-1 is a **direction rather than a shipped claim**. Nothing in the
README, the issue tracker or a release note may say otherwise.

### D-5 — No iOS project is generated until somebody can build it

`cap add ios` writes an Xcode project, a Podfile and a `.xcworkspace`. In this repository, right
now, **nobody can compile any of it**: there is no Mac, no Xcode, and no Apple Developer membership.

`apps/mobile/README.md` §4 already records what committing an unbuildable Android tree cost — six of
eight criteria unverifiable, and a committed `gradle-wrapper.jar` whose checksum could not be
checked. Generating a second, larger unbuildable tree would repeat that at greater cost and produce
exactly the false pass that file warns about: green typechecks and green tests over code no build
has ever seen.

**So the iOS platform files land in the pull request that can build them**, and not before.

---

## Consequences

**What this buys.** One client, one sensor interface, one FIT encoder — and #15's sixth criterion
becomes structurally true rather than something to re-assert per platform:
`apps/web/src/transfer/cross-client-fit.test.ts` asserts the bytes *and* the three facts that make
them the same bytes, so a second encoder arriving under `apps/mobile` is a red test.

**What it costs.** The WebView is now on the critical path for the one capability this epic exists
to deliver, and it is the part nobody has measured. If D-4's measurement fails, the fallback is
React Native — which means an adapter rewrite against `react-native-ble-plx` and the UI forked,
paying exactly the cost D-1 declined. That is the risk, stated plainly rather than discovered.

**What stays true whatever happens.** ANT+ is out on every platform, permanently — owner decision
D2, and `SCOPE001` now checks package manifests as well as source, which closes the *"dependency"*
half of #15's fifth criterion that the rule had never covered.

**What is not decided here.** Whether a desktop client is ever built; which of iOS's background
modes are declared; and how OEM battery-optimisation prompts are presented on Android. Each needs
the D-4 measurement first, because each is a different answer depending on whether the WebView keeps
delivering.

## What would make this ADR wrong

- **The D-4 measurement fails on either platform.** Then D-1 is wrong and React Native is the
  answer, at the cost this document already names.
- **`@capacitor-community/bluetooth-le` relicenses.** It is MIT today and `DEP001` watches it. The
  same thing happened to `flutter_blue_plus` between versions, which is why this is written down
  rather than assumed.
- **Apple changes what a backgrounded WebView may do**, in either direction. The measurement is
  dated for that reason and a re-measurement is a new spike write-up, not an edit to this one.
- **A desktop client becomes the point rather than reach** — a rider who wants Firefox on a laptop
  in a shed with a trainer is a real person, and if that turns out to be most of the demand then D-2
  is answering the wrong question.
