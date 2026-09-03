# ADR 0008: Mobile client architecture and rendering stack

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner. **All four decisions below — the client stack and its gate, the
  permanent closure of Unity, the device floor, and the camera — were taken by the repository
  owner and confirmed on 2026-09-03** in
  [#86](https://github.com/openzigs/onyourleft/issues/86). Like ADR 0001, this is not an
  implementer's call. This ADR is the **write-up** of those rulings, not a fresh evaluation: the
  owner's four are quoted as such in D-1 to D-5, and everything this document adds beyond them —
  the source verification, the spike's measurement protocol, and D-6 — is marked **author's
  record** where it appears
- **Issue**: [#86](https://github.com/openzigs/onyourleft/issues/86)
- **Supersedes**: nothing
- **Constrains**: [#85](https://github.com/openzigs/onyourleft/issues/85) and every sub-issue of
  it — [#87](https://github.com/openzigs/onyourleft/issues/87),
  [#89](https://github.com/openzigs/onyourleft/issues/89),
  [#91](https://github.com/openzigs/onyourleft/issues/91) — and
  [#15](https://github.com/openzigs/onyourleft/issues/15), which inherits the shell this epic
  builds
- **Relates to**: [ADR 0001](0001-licence.md) (the licence choice that forecloses two of the three
  major engines, and the absence of a CLA that makes the foreclosure permanent),
  [ADR 0003](0003-platform-support-matrix.md) (which already **consumes** this decision and does
  not reopen it), [ADR 0005](0005-tech-stack.md) (mutual dependency — recorded in both),
  [#19](https://github.com/openzigs/onyourleft/issues/19) (clean-room posture, ADR 0009, not yet
  written — the constraint that makes "no world to design" a benefit rather than a shortcut)

> **This ADR decides a stack, and creates no code.** It does not scaffold `apps/mobile`, add a
> dependency, or touch the lockfile. `apps/mobile` is created by
> [#87](https://github.com/openzigs/onyourleft/issues/87) and the renderer by
> [#91](https://github.com/openzigs/onyourleft/issues/91). Everything here is a constraint on those
> issues.

---

## Context

### What was open, and what the owner settled

Four questions were open when #86 was filed. All four are answered, and this ADR records the
answers together with the reasoning that produced them — because the reasoning is what a future
contributor needs in order to know whether a change in the world reopens the decision.

| Question | Ruling (owner, 2026-09-03) | Recorded as |
| --- | --- | --- |
| React Native or Capacitor? | **Capacitor**, gated on a rendering spike | D-1, D-2 |
| Is reopening ADR 0001 for a linking exception on the table? | **No. Unity is closed permanently, not deferred** | D-3 |
| What is the target device? | **Zwift's published Android floor**, 30 fps at 720p world render | D-4 |
| What does the camera do? | **Fixed chase camera** over terrain generated from the imported route | D-5 |

### Sources, with fetch dates

Everything below was read on **2026-09-03**. Licence terms are quoted **verbatim** with a digest or
an observed "last updated" line, so that a future reader can tell whether the terms moved rather
than trusting this summary. This table is **author's record**: the owner's rulings did not depend on
this verification, and none of it changed a ruling.

| Source | URL | Observed |
| --- | --- | --- |
| Unreal Engine EULA | `https://cdn2.unrealengine.com/unreal-engine-end-user-license-agreement-d2812e10c642.pdf`, linked from `https://www.unrealengine.com/eula/unreal` | 327 535 bytes; SHA-256 `f08c68648ef1020b31b3c711e5cae4798318d697bc6ccb7c25a5362ca2b5ef5f`. The document body carries **no version number and no effective date**; its PDF metadata records creation on 2022-03-24. The HTML rendering at `unrealengine.com/en-US/eula/unreal` returned **HTTP 403** to an automated fetch, which is why the PDF is the cited artefact |
| Unity Editor Software Terms | `https://unity.com/legal/editor-terms-of-service/software` | Page states **"Last updated: June 30, 2026"**. §2.2 is headed *Unity Runtime* |
| AGPL-3.0 §10 | this repository's own [`LICENSE`](../../LICENSE) | Byte-identical to the canonical text; digest recorded in [ADR 0001](0001-licence.md) and enforced by `scripts/check-licence-hashes.sh` rule `LIC005` |
| `@capacitor-community/bluetooth-le` | `https://registry.npmjs.org/@capacitor-community%2Fbluetooth-le` | latest **8.3.0**, `"license": "MIT"`, published 2026-08-13T12:20:26Z |
| Android foreground service, Capacitor BLE plugin | `https://github.com/capacitor-community/bluetooth-le/issues/643` | Issue **#643 "Foreground Service on Android"**, opened 2024-04-09, **still open** |
| `react-native-ble-plx` | `https://registry.npmjs.org/react-native-ble-plx` and `dotintent/react-native-ble-plx` `master/LICENSE` | latest **3.5.1**, npm manifest `"license": "MIT"`, published 2026-02-18T20:45:08Z; the repository's `LICENSE` file is the **Apache License 2.0** text. The contradiction is upstream and unresolved |
| `flutter_blue_plus` | `https://pub.dev/api/packages/flutter_blue_plus`, `https://pub.dev/packages/flutter_blue_plus` | latest **2.3.12**; pub.dev shows a bespoke **"FlutterBluePlus License"**, not an OSI licence |
| `flutter_reactive_ble` | `https://pub.dev/api/packages/flutter_reactive_ble`, `https://pub.dev/packages/flutter_reactive_ble` | latest **5.5.0**; pub.dev shows **BSD-3-Clause** — OSI-approved. This is the source of the withdrawn argument in D-3 |
| Zwift's published device requirements | `https://support.zwift.com/en_us/supported-devices-to-run-zwift-H1Cj9QbeB` | **Could not be re-verified by direct fetch**: the page is client-rendered and served no requirements text to `curl` or to an automated fetcher. See the verification note in *Notes* — this affects the RAM figure in D-4 and nothing else |

### The engine field, and why two of the three are foreclosed by ADR 0001

This is the finding that produced #86, and it is recorded in full because a future contributor who
does not find it here **will re-derive it**, at the cost of a week and possibly of a wrong answer.

#### Unreal Engine: foreclosed, and nothing this project can do cures it

The EULA's *Non-Compatible Licenses* clause, §5(a) *Other Restrictions on Your Use of the Licensed
Technology*, verbatim:

> **a. Non-Compatible Licenses**
>
> You may not, and may not permit others to, combine, Distribute, or otherwise use the Licensed
> Technology with any code or other content which is covered by a license that would directly or
> indirectly require that all or part of the Licensed Technology be governed under any terms other
> than those of this Agreement (those licenses, the “Non-Compatible Licenses”). This means, for
> example, that you may not combine the Licensed Technology with code or content that is licensed
> under any of the following licenses: GNU General Public License (GPL), Lesser GPL (LGPL) (unless
> you are merely dynamically linking a shared library), or Creative Commons Attribution-ShareAlike
> License.

Two things about that quotation matter. The **operative** sentence is the first one — a licence
that would require the Licensed Technology be governed under other terms — and AGPL-3.0 is such a
licence by construction: §5(c) requires the whole of a combined work to be licensed under the AGPL
"to anyone who comes into possession of a copy". The GPL/LGPL naming in the second sentence is an
**example list**, so "AGPL is not literally named" is not an argument; and the LGPL carve-out is for
*dynamically linking a shared library*, which is not the shape of a game built on an engine.

**Nothing this project can do cures it.** The restriction is on Epic's technology, and this project
has no standing to vary it. Unreal is out.

#### Unity: foreclosed, and the cure is one ADR 0001 deliberately made unobtainable

Unity Editor Software Terms **§2.2 *Unity Runtime***, verbatim ("Last updated: June 30, 2026"):

> Subject to payment of applicable fees, if any, you may distribute the Unity Runtime as an
> integrated part of your Projects, solely as embedded or incorporated into your Projects, and
> solely to third parties to whom you license or sell your Projects or who provide you with
> services, in each case **pursuant to an agreement that is no less protective of Unity and its
> licensors and its service providers than this Agreement**.

Against AGPL-3.0 §10, final paragraph, verbatim from this repository's own `LICENSE`:

> You may not impose any further restrictions on the exercise of the rights granted or affirmed
> under this License.

Shipping the Unity Runtime inside an AGPL application requires every recipient to be bound by terms
"no less protective of Unity" — restrictions beyond the AGPL. §10 forbids imposing them. The two
cannot both be satisfied.

The recognised cure is a **linking exception**: an additional permission, granted by the copyright
holders, allowing the AGPL work to be combined with the Runtime. That requires the consent of
**every** copyright holder, and ADR 0001 removed the mechanism that would have made such consent
collectable:

> **No CLA.** … **The consequence: this project cannot be relicensed without unanimous consent of
> all contributors, and therefore in practice cannot be relicensed at all.** That is the intended
> outcome — it is the same property that protects contributors from a future maintainer closing the
> project.

So the exception is not merely difficult; it is difficult **on purpose**, and it gets harder with
every contributor.

**And it would not even buy Unity.** Every Unity BLE plugin found is proprietary and redistributed
binary-only, which conflicts with AGPL distribution independently of the engine licence. An
exception would therefore surrender the exact property #18 chose AGPL for — that nobody can take
contributors' work proprietary — and get **nothing** in return. That is why D-3 records this as
**settled**, not deferred.

#### Godot: eliminated on BLE, not on licence

Godot is MIT and there is **no licence problem at all**; the 4.6/4.7 Mobile renderer is genuinely
improved. It is eliminated for a different reason, and the distinction matters because a licence
argument would be permanent while this one is not:

- Godot core exposes **no Bluetooth API**.
- GDBLE, the community extension, states *"Not supported: Android ARMv7, iOS, and automatic
  reconnection"*. Two of those three are load-bearing here: no iOS closes #15's platform, and no
  automatic reconnection is a trainer-session requirement, not a nicety.
- GodotAndroidBle is **Android-only**.

A Godot client would therefore mean writing and maintaining the BLE layer twice — once in
TypeScript for the web client, once in GDScript/C++ for Godot — which is the precise outcome
[#39](https://github.com/openzigs/onyourleft/issues/39) exists to prevent.

#### Flutter and Kotlin Multiplatform: eliminated on architecture, not on licence

Both would fork `packages/sensors` — and with it `packages/domain`, `packages/fit` and
`packages/store` — into a second language. #39 defined a **transport-agnostic** sensor abstraction
specifically so that one implementation serves every client; a Dart or Kotlin client discards that
and creates two implementations of the same protocol logic, which is where the divergent-bug class
in this domain lives.

> ⚠️ **A licence argument against Flutter was considered and withdrawn. It is recorded here so that
> nobody reopens Flutter on discovering the withdrawal.**
>
> The argument was that `flutter_blue_plus` 2.3.12 relicensed to a bespoke, non-OSI
> "FlutterBluePlus License" requiring a commercial licence for for-profit use and prohibiting
> relicensing — which would fail `CONTRIBUTING.md` outright. **That is true of that package.** But
> it does not generalise to Flutter: `flutter_reactive_ble` 5.5.0 is **BSD-3-Clause**, OSI-approved
> and permissive, so a licence-clean Flutter BLE path exists. Flutter is therefore eliminated on
> **architecture alone**, and a future contributor who checks the licence and finds it clean has
> found nothing new.

### React Native versus Capacitor

Both keep TypeScript, so both keep every leaf package and every rendering option open. That is what
makes the fallback in D-2 survivable, and it is why the comparison came down to reuse and risk
rather than to language.

| | React Native + `react-native-ble-plx` 3.5.1 | **Capacitor** + `@capacitor-community/bluetooth-le` 8.3.0 |
| --- | --- | --- |
| Licence | `LICENSE` is Apache-2.0, `package.json` says MIT — **unresolved upstream contradiction** | **MIT, consistent** across manifest and repository |
| What is reused from #48–#51 | The leaf packages. The UI is rebuilt against React Native primitives | **The entire web build** — screens, design system, accessibility baseline |
| Android GATT serialisation | Caller's problem | **The plugin wraps every call in an internal queue** — the hardest Android GATT correctness problem, solved upstream |
| iOS background BLE | Documented: `restoreStateIdentifier` + `restoreStateFunction` | Plugin documents `UIBackgroundModes`, less completely |
| Android foreground service | **Not provided** | **Not provided** — upstream issue #643 open since 2024-04-09 |
| Rendering | three.js via expo-gl, with `react-native-wgpu` → WebGPU as the escape hatch | three.js in a WebView — the same Chromium engine as Chrome, but **unmeasured** in that configuration |
| Rendering risk | expo-gl is a single community-maintained GL bridge on an API Apple has deprecated | The WebView question in D-2 |

**Background BLE is Capacitor's genuine weakness, and it does not bite in #85.** #85 is a
**foreground game**: the rider is on a trainer, looking at the screen, for the duration of the
session. The screen-off, app-backgrounded case is #15's, and #15 is where that weakness has to be
paid for. Choosing the cheaper option for the epic that does not need the expensive property, while
recording where the bill lands, is the whole of D-1.

### What nobody has measured

There is **no controlled benchmark** of WebGL2 in an Android WebView versus WebGL2 in Chrome on the
same device. The Capacitor maintainers state there is no difference — the WebView is the same
Chromium — and developers in the same thread report that there is. Both are forum posts. Neither is
a measurement, and the difference between them is exactly the risk #85 is taking.

That is not a reason to reject Capacitor. It is a reason to **gate** on it, which is D-2.

---

## Decision

### D-1 — The client stack is **Capacitor**, wrapping the same web build

`apps/mobile` is a **Capacitor** shell around the build `apps/web` already produces, with a native
BLE bridge via `@capacitor-community/bluetooth-le` 8.3.0 (MIT).

**Owner ruling, 2026-09-03.** The reasoning that produced it, recorded because it is what a future
reader needs in order to know whether a changed fact reopens it:

1. **#85 is a foreground game**, so Capacitor's genuine weakness — background BLE — does not bite
   in this epic at all. It bites in #15.
2. **Capacitor wraps the same web build as #48–#51**, so the *entire web client* is reused, not
   only the leaf packages a React Native client would also get.
3. **`@capacitor-community/bluetooth-le` already wraps every call in an internal queue**, which is
   the hardest Android GATT correctness problem solved for free, and it is MIT with no manifest
   contradiction.

Per [ADR 0003](0003-platform-support-matrix.md) D-5, the client talks to a **native BLE bridge**,
never to `navigator.bluetooth` — an Android WebView does not implement Web Bluetooth. The bridge is
**BLE only**; ANT+ is out of scope permanently under owner decision D2 and is named here solely to
say so.

### D-2 — The gate: **#91 may not begin until the rendering spike passes**

**Owner ruling, 2026-09-03: the gate is real and must not be quietly dropped.**

> **#91 may not begin until a spike proves 30 fps sustained on the device floor, in a WebView, with
> a live BLE connection.**

**Pass condition — all four, together, or the spike has failed:**

| | Condition |
| --- | --- |
| **Frame rate** | **≥ 30 fps sustained** — the mean over the run, with **no more than 1 % of frames exceeding 50 ms** |
| **Duration** | **20 minutes continuous**, which is the shortest realistic session and long enough for thermal throttling to appear. A 30-second measurement measures a cold device |
| **Device** | Hardware **at the D-4 floor**, not above it. A flagship result is not evidence about the floor |
| **Configuration** | Inside a **Capacitor WebView**, at **720p world render**, with a **live BLE connection streaming notifications** for the whole run |

**Why the tail threshold is 50 ms and not 33.3 ms.** An earlier draft used 33.3 ms, which is
arithmetically unpassable at the frame rate D-4 specifies: a renderer running at a **30 fps cap**
produces frame times clustered *on* 33.3 ms, so ordinary jitter puts far more than 1 % of frames
marginally above it — on a run that is subjectively perfect. Read the other way, a 1 % tail bound at
33.3 ms implies p99 ≤ 33.3 ms, which demands real headroom above 30 fps and makes the mean clause
redundant. Either reading breaks the gate: it fails a device that meets the owner's ruling, or it
silently tightens "30 fps sustained" into something considerably harder than what was decided.

50 ms is 20 fps. The pair therefore says what the owner's ruling means: **the mean holds at 30, and
the worst 1 % never drops below 20** — a bound on visible stutter rather than on jitter around the
cap. The threshold is the author's, not the owner's; the 30 fps target is the owner's.

The BLE condition is not decoration: GATT notifications arrive on the same JavaScript thread the
renderer runs on, so a renderer measured without them has not been measured in the configuration it
will ship in.

**Fail condition and fallback.** If any of the four is missed, the recorded fallback is **React
Native** with three.js via expo-gl. This is survivable precisely because the **leaf packages are
identical under both** — what is lost is the web UI reuse from D-1's reason 2, not the domain,
sensor, FIT or store work. **A spike with no failure condition is not a gate**, which is why the
numbers above are written down before the spike is run rather than after.

The measurement protocol in the table is **author's record**: the owner's ruling fixed 30 fps
sustained, the device floor, the WebView and the live BLE connection. The 20-minute duration, the
1 %-of-frames tail bound and the note about the shared JavaScript thread are this ADR's rendering
of "sustained" into something a spike can pass or fail.

### D-3 — Unity and Unreal are **foreclosed by ADR 0001**, and Unity is **closed permanently**

**Owner ruling, 2026-09-03: reopening ADR 0001 for a linking exception is off the table.**

- **Unreal is foreclosed** by the *Non-Compatible Licenses* clause quoted above. There is no cure.
- **Unity is foreclosed** by Editor Software Terms §2.2 against AGPL §10, both quoted above.
- **Reopening ADR 0001 to add a linking exception is not on the table.** Not deferred, not "revisit
  in Phase 6" — **closed**. It would require unanimous consent that ADR 0001 deliberately made
  unobtainable by declining a CLA, it would surrender the property AGPL was chosen for, and it
  would not even buy Unity, because every Unity BLE plugin found is proprietary with binary-only
  redistribution terms. It is recorded as settled **because unanimous consent only ever gets harder
  to obtain**: deferring the question guarantees it is asked at the moment it is least answerable.
- **Godot** is eliminated on **BLE**, not licence.
- **Flutter and Kotlin Multiplatform** are eliminated on **architecture**, not licence — and the
  Flutter licence argument was **considered and withdrawn**, as recorded in Context.

Anyone proposing a game engine in this project must start from this section, and the only thing
that reopens Unreal or Unity is a **change to their terms**, not a change of mind here.

### D-4 — The device floor is a specification, not an adjective

**Owner ruling, 2026-09-03.** The target is **Zwift's own published Android floor**, which is
citable, defensible and already accepted by that product's users:

| Property | Floor |
| --- | --- |
| OS | **Android 9 or later** |
| ABI | **arm64-v8a** |
| RAM | **3 GB** |
| Graphics API | **OpenGL ES 3.0** |
| Frame rate | **30 fps** |
| World render resolution | **720p** |

"A mid-range Android phone" is not a specification and is not acceptable in an acceptance
criterion. **This table is the number the D-2 spike measures against**, and it is the number #91
optimises to — Zwift's own engine is reported by its co-founder as "all C and OpenGL 2 +
extensions", and every phone, tablet and Apple TV gets Zwift's **Basic** graphics profile capped at
30 fps. A WebGL2-class renderer sits comfortably inside that envelope; the open question is the
WebView, not the ceiling, which is why D-2 gates on the WebView and not on the renderer.

### D-5 — A **fixed chase camera** over terrain generated from the imported route

**Owner ruling, 2026-09-03.** The camera follows the rider from a fixed offset. The world is **3D
terrain generated from the GPX route imported by
[#89](https://github.com/openzigs/onyourleft/issues/89)**.

- The rider sees **the hill coming and the road bend** — the parts that carry the experience.
- A fixed camera removes the **culling, level-of-detail and visible-rider problems simultaneously**,
  which is most of why the D-4 floor is reachable at all.
- Terrain generated from the route means **there is no world to design**. That is not only a cost
  saving: [#19](https://github.com/openzigs/onyourleft/issues/19) (ADR 0009, not yet written)
  forbids deriving any asset from another product, and a route the athlete imported is the one
  world source that cannot be an infringement.
- Precedent: TrainingPeaks Virtual competed on physics with deliberately basic graphics.

> ⚠️ **A free camera is out of scope for #91, and reopening it is a change to this ADR — not a #91
> implementation detail.** It is written that way because "the camera should be steerable" is
> exactly the kind of request that arrives as a review comment on a renderer PR, where it looks
> small and is not: it reintroduces culling, LOD and the visible-rider problem in one move.

### D-6 — The Android foreground service is **known work**, and #87 owns it

**Author's record**, following from the sources rather than from a separate owner ruling:

**Neither Capacitor nor React Native ships an Android foreground service.** The Capacitor plugin's
upstream issue #643 has been open since 2024-04-09; React Native's `isBackgroundEnabled` only adds
a `uses-feature` line to the manifest. It is **hand-written Kotlin either way**, so it is not a
differentiator between the two stacks and it is not spike risk — it is **budgeted, known work**,
and it is owned by [#87](https://github.com/openzigs/onyourleft/issues/87) along with the app shell
and the runtime BLE permissions.

It was **not** in #15's original ~34-point estimate. That estimate is understated by this ADR, and
#15 should be re-pointed rather than surprised.

---

## Consequences

### For the issues this ADR constrains

- **#87 (Android app shell, foreground service, BLE permissions)** — creates `apps/mobile` as a
  Capacitor project, AGPL-3.0-or-later by path (CLAUDE.md §3), from `packages/domain` as the
  template: a manifest, its own `LICENSE`, a `tsconfig.json`, a `vitest.config.ts` and a test. It
  owns the hand-written foreground service per D-6. **Author's inference**, recorded so the gate
  is not read wider than it is: #87 does **not** need the D-2 spike to have passed. The owner's
  gate names #91 and only #91; the Android shell, the permissions and the foreground service are
  work the React Native fallback needs too, and the shell is where the spike gets run.
- **#91 (3D route renderer)** — **blocked on the D-2 spike**. Scoped to the D-5 fixed chase camera
  at the D-4 floor. A free camera is out of scope.

> ⚠️ **Who runs the spike: #87.** This is stated because it was very nearly nobody. #91's body says
> it "may not begin until the **#86** rendering spike passes" — but #86 is the ADR-writing issue and
> the PR recording this ADR closes it, so after merge the gate would have pointed at a closed issue.
> That is how a gate the owner said "must not be quietly dropped" gets dropped: not by anyone
> deciding to, but by nobody being assigned it.
>
> **#87 owns running the spike, producing the measurement and recording the result in this ADR.**
> It is the right home — the shell is where a WebView with a live BLE connection first exists — and
> it is an added deliverable on #87, not a reason to block #87 itself. #87 is needed under the
> React Native fallback too.
- **#89 (route profile model, GPX import)** — is now on #91's critical path, because it is where
  the world comes from.
- **#48–#51 (web client)** — **are now on #85's critical path in a way they were not before.**
  Choosing Capacitor means #85 is substantially "the web client in a native shell, plus a 3D view",
  which is most of why it is cheap; the corollary is that #85 cannot outrun the web client it
  wraps.
- **#15 (iOS, desktop, background)** — inherits the shell and the bridge, and inherits the
  background-BLE bill that D-1 deliberately did not pay. Its estimate is understated by the
  foreground service (D-6).

### "Hybrid" does not mean "no native code"

It means **native code confined to the transport and background boundary** — the BLE bridge and the
foreground service — with everything above that boundary shared with the web client. Any proposal
that pushes native code above that line is a change to this ADR. ADR 0003 D-5 says the same thing
from the platform-matrix side, and the two must be read together.

### Costs this decision accepts, knowingly

- **An unmeasured rendering path.** Mitigated, not removed, by D-2's gate and its recorded
  fallback.
- **A second, larger bill in #15** for background BLE on iOS and Android.
- **Hand-written Kotlin** in a project whose stack is otherwise TypeScript end to end (D-6).
- **No game engine, ever, under the current licence.** The physics
  ([#88](https://github.com/openzigs/onyourleft/issues/88)) and the renderer (#91) are this
  project's own work. D-3 makes that permanent, and it is the intended trade.

### Relationship to the other ADRs

- **ADR 0003 already consumes this decision.** Its D-5 records the hybrid-not-bespoke-native
  conclusion and its settled-inputs table names "the mobile client is Capacitor + TypeScript, ADR
  0008 (#86)". #86's acceptance criterion that "#20 is updated to reference this ADR rather than
  restating the hybrid-vs-native question" is therefore **already satisfied by the merged ADR
  0003** — and ADR 0003 is a protected path that is amended by a superseding ADR, never edited in
  place (CLAUDE.md §7).
- **ADR 0005 and this ADR depend on each other, and both say so.** ADR 0005 fixes TypeScript;
  this ADR's entire justification is that the web build and the leaf packages are *shared* rather
  than reimplemented in a second language. Overturning TypeScript in ADR 0005 invalidates this ADR,
  and choosing a non-TypeScript client here would invalidate ADR 0005's reasoning.
- **ADR 0001 constrains this ADR**, and this ADR does not reopen it (D-3).

### What would overturn this ADR

Each of these is a fact about the world changing, not a preference changing. Anything else is a
change *to* this ADR, made by a superseding ADR.

1. **The D-2 spike fails.** The stack becomes React Native; D-3, D-4 and D-5 are unaffected, and
   the leaf packages do not move.
2. **Epic or Unity changes its terms** such that the quoted clauses no longer conflict with
   AGPL-3.0. The digest and the "last updated" line in the sources table are what make that
   detectable. Note that a Unity change alone is still not sufficient while every Unity BLE plugin
   is proprietary and binary-only.
3. **A maintained, permissively licensed, cross-platform BLE binding for Godot appears** covering
   iOS and automatic reconnection. That removes the *elimination reason*; it does not by itself
   overturn D-1, because the second-implementation cost in #39's terms remains.
4. **`@capacitor-community/bluetooth-le` is abandoned or relicensed.** The MIT licence of 8.3.0 is
   irrevocable for that version, so this is a maintenance question rather than a licence one — but
   it is the dependency the whole D-1 reuse argument rests on.

---

## Notes

This ADR is an engineering decision recorded by engineers. It is **not legal advice** — ADR 0001
and ADR 0006 say the same about themselves, and this one is deliberately consistent with them. No
question here is put to a lawyer: both licence conclusions are foreclosures this project accepts
rather than positions it intends to rely on, and the cheapest possible answer to "may we ship Unity
inside an AGPL app" is not to.

**Verification note on D-4's RAM figure.** The owner's ruling states 3 GB. Zwift's requirements page
is client-rendered and served no requirements text to an automated fetch on 2026-09-03, so the
figure could not be re-confirmed at source; one secondary search result reported 2 GB. **3 GB is the
figure that binds**, both because it is the owner's ruling and because it is the stricter of the two
— a spike passing at a 3 GB floor has passed at a 2 GB one, and the reverse is not true. If the
distinction ever matters, re-read the source page in a real browser rather than trusting either
number here.
