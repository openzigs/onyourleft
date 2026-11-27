# ADR 0058: On iOS the camera screens detect screen capture and blank the picture

- **Status**: **Accepted, 2026-11-26**, by the owner, 2026-11-26, on its pull request
  [#3316](https://github.com/openzigs/onyourleft/pull/3316)
  ([comment](https://github.com/openzigs/onyourleft/pull/3316#issuecomment-7207451593)), with every
  recommendation in §"Questions for the owner": **Q1 yes**, the picture is also hidden from the
  app-switcher snapshot (D-6); **Q2**, the draft words of D-5 are approved, with the iOS sentence in
  its switcher variant; **Q3 yes**, nothing is done on a screenshot (D-3). It was **Proposed**
  earlier the same day, and that wording was only ever on the pull request's branch. The decision
  is the owner's: **D-11** on the epic [#15](https://github.com/openzigs/onyourleft/issues/15),
  2026-10-27: *"detect screen capture and blank the camera picture, through a new ADR (the iOS
  counterpart of ADR 0044 D-12)"*. The author chose the terms below: the trigger, the signal, the
  port's shape and the draft words
- **Date**: 2026-11-26
- **Deciders**: **the owner** (D-11, the decision itself; the rider wording, approved 2026-11-26;
  and Q1 to Q3, answered 2026-11-26); the author (the engineering terms, D-1 to D-5, and D-6's
  cover as recommended)
- **Issue**: [#1752](https://github.com/openzigs/onyourleft/issues/1752), under the iOS epic
  [#15](https://github.com/openzigs/onyourleft/issues/15). It is built by
  [#1771](https://github.com/openzigs/onyourleft/issues/1771), which is blocked by spike S1
  ([#1753](https://github.com/openzigs/onyourleft/issues/1753)). This decision is not blocked by S1,
  because it holds whichever Bluetooth bridge S1 picks
- **Number**: **0058**, reserved for #1752 by the plan comment on #15 on 2026-10-27, beside 0057
  for [#1748](https://github.com/openzigs/onyourleft/issues/1748). On 2026-11-26 both were still
  recorded as claimed in [`docs/architecture.md`](../architecture.md) and
  [`docs/agents/conventions.md`](../agents/conventions.md) §7, no file under `docs/adr/` held either
  number, and no open pull request named either. Writing 0058 does not move the next free number,
  which is 0100
- **Supersedes**: nothing. [ADR 0044](0044-side-camera-live-view-and-snapshot.md) D-12 is about
  Android, and it names Android's flag. This ADR adds the iOS counterpart beside it, and D-12 still
  binds the Android shell word for word. ADR 0044 gains one dated `## Amendments` pointer here
  ([ADR 0013](0013-adr-amendments.md)). Its body is not edited
- **Leaves standing**: [ADR 0044](0044-side-camera-live-view-and-snapshot.md) D-6 (where a picture
  may appear) and D-12 (Android). [ADR 0029](0029-camera-imagery-as-a-data-class.md) in every
  part. ADR 0036 D-3's four invariants: nothing here touches the network

## Context

ADR 0044 D-12 makes the Android app's window carry `WindowManager.LayoutParams.FLAG_SECURE` while a
camera picture is on the screen. While the flag is set, Android shows a blank recent-apps
thumbnail, refuses a screenshot or a screen recording, and shows a cast blank. #1061 built it:
`SecureWindowPlugin.java`, `apps/mobile/src/secure-window/`,
`apps/web/src/camera/secure-window-port.ts`, and the one owner of the flag,
`apps/web/src/camera/secure-window.ts`, which keeps a count over the pictures on screen.

**iOS has no such flag.** An app cannot refuse a screenshot, a screen recording, AirPlay or
mirroring. What it can do is *learn* about them:

- **That the scene is being recorded or mirrored, while it happens.** The scene's trait
  collection carries `sceneCaptureState`, and the app can observe changes to that trait.
- **That a screenshot was taken, after the fact.** `UIApplication.userDidTakeScreenshotNotification`
  *"posts after the screenshot is taken"*. By then the picture is in the screenshot.

So the protection ADR 0044 D-12 gives on Android cannot be reproduced on iOS. The owner ruled, as
D-11 on #15, that iOS detects screen capture and blanks the camera picture, and that this is a new
ADR. ADR 0013 D-3 allows an appended amendment only for a fact that has drifted. Saying what iOS does
instead is a decision, and so is the sentence the rider is told.

**Minimum iOS.** The owner's ruling of 2026-11-26 on #15 sets the minimum to iOS and iPadOS 17
(#1765), and the app is iPad-first (#1780). Every API this ADR relies on is available from 17.0.

### The Apple documentation, read on 2026-11-26

The iOS research of 2026-10-27 named these APIs from memory and did not read them. Each one below
was read on 2026-11-26 from Apple's developer documentation, at
`developer.apple.com/documentation/uikit/…`:

| API | What Apple's page says | Available |
| --- | --- | --- |
| `UITraitCollection.sceneCaptureState` (type `UISceneCaptureState`: `active`, `inactive`, `unspecified`) | *"Scene capture state represents whether a scene is currently being mirrored or recorded."* No discussion section | iOS and iPadOS 17.0 |
| `UITraitChangeObservable.registerForTraitChanges(_:handler:)`, with the trait `UITraitSceneCaptureState` listed under *"Registering traits for observation"*. `UIWindowScene`, `UIWindow` and `UIViewController` conform | *"When you register for trait changes, the system observes the specified traits, and calls your code when any of the observed traits change value."* | iOS and iPadOS 17.0 |
| `UIScreen.isCaptured` | *"A value of YES indicates the system is actively recording, mirroring, or using AirPlay to stream the contents of the screen."* **Deprecated in iOS 27.0**: *"Use the sceneCaptureState in UITraitCollection instead."* | iOS 11.0 to 27.0 |
| `UIScreen.capturedDidChangeNotification` | *"UIKit sends this notification when the capture status of the screen changes"*, where that status is `isCaptured`'s | iOS 11.0; not itself marked deprecated |
| `UIApplication.userDidTakeScreenshotNotification` | *"This notification posts after the screenshot is taken."* | iOS 7.0 |
| `UIScene.willDeactivateNotification` / `sceneWillResignActive(_:)` | Posted for temporary interruptions *"and before transitioning your app to the background state"* | iOS 13.0 |
| *Preparing your UI to run in the background* (article) | *"After your app enters the background and your delegate method returns, UIKit takes a snapshot of your app's current user interface. The system displays the resulting image in the app switcher."* Sensitive information should be removed *"from your views when entering the background"* | — |

`UITraitSceneCaptureState`'s own page was not found at the address its list links to (HTTP 404 on
2026-11-26). It is named in the protocol's list of observable traits, and #1771 confirms it compiles
before relying on it.

Two things the pages do not say, so this ADR does not claim them: **which kinds of capture set
`sceneCaptureState` to `active`**, beyond *"mirrored or recorded"* (the deprecated `isCaptured`
names AirPlay as well), and **how soon after capture starts the trait changes**.

## Decision

### D-1 — Which screens blank: exactly ADR 0044 D-12's list

In the iOS app, these are the camera screens, the same list D-12 gives for Android:

1. the side camera's **live view**, during setup and during the ride (`camera/SideLiveView.tsx`);
2. a **snapshot** shown in an open section of a ride's page (`detail/RideSnapshotsSection.tsx`);
3. the phone's own **framing preview** (`camera/FramingPreview.tsx`);
4. the tablet's **pairing viewfinder** (`camera/ScanViewfinder.tsx`).

The set is defined the way D-12 defines it: a surface that holds the secure window through
`secure-window.ts` is a camera screen. A camera surface added later blanks on iOS because it takes
that hold, and needs no list of its own. **Only the picture blanks.** The ride, the HUD, the
controls and everything else on the screen keep drawing. A rider who mirrors a ride to a television
keeps the ride and loses only the camera picture.

### D-2 — What triggers it: the scene being captured, mirrored or recorded

The picture is blanked **while the window scene's `sceneCaptureState` is `active`**, and drawn
again when it is not.

- **The state is read when the first picture is shown, not only when it changes.** A picture shown
  while the screen is already being recorded is never drawn: the blank comes first. The answer
  `unspecified` counts as **captured**. This is the more protective reading, and it is *the author's
  choice*.
- **The change is observed through `registerForTraitChanges` on the app's window scene**, for
  `UITraitSceneCaptureState`. `UIScreen.isCaptured` and `capturedDidChangeNotification` are **not**
  used: `isCaptured` is deprecated from iOS 27, and the app's minimum of 17 already has the
  replacement Apple names.
- **The blank is the web client's**, in the same component that shows the picture. The picture
  element is removed, not covered, and a plain panel takes its place with one line of text (D-5).
  The surface keeps its hold on the secure window while it is blank, so the count of D-12 means
  the same on both platforms.

### D-3 — What cannot be prevented, stated as such

- **A screenshot.** iOS gives an app no way to refuse one, and it says so only after it has been
  taken. The app does nothing with `userDidTakeScreenshotNotification`: there is nothing it could
  do that would take the picture back, and a message after the fact would only tell the rider what
  they already know. The author proposed it, and **the owner confirmed it on 2026-11-26 (Q3)**.
- **The frames before the blank.** Between capture starting and the app hearing of it, the
  picture may be in the recording or on the mirrored screen. Apple's pages give no figure for that
  gap, and nobody here has measured it. #1771's device check observes it on a device, and the
  result is recorded on the owner's device-check list,
  [#733](https://github.com/openzigs/onyourleft/issues/733). The number is not invented here.
- **A capture iOS does not report.** If some capture does not set `sceneCaptureState`, the picture
  is not blanked during it, and this ADR cannot say there is none.
- **Another device's camera pointed at the screen** (ADR 0044 D-6), as on Android.

### D-4 — The port needs a signal it does not carry today

**`secure-window-port.ts`'s contract cannot carry "captured now" as it stands.** Its one method,
`setSecureWindow(secure: boolean): Promise<void>`, runs **from the web client to the platform**:
the client tells the platform that a picture is on the screen. iOS needs the other direction. The
platform has to tell the client, at any time, that the scene has started or stopped being captured.
A promise that resolves once cannot say that.

So the port gains one member. The shape is *the author's*, and #1771 builds it:

```ts
/**
 * Whether the screen is being recorded, mirrored or shared now. `listener` is called once with the
 * current state as soon as it is known, then on every change. @returns the unsubscribe.
 */
watchCapture(listener: (captured: boolean) => void): () => void;
```

- **iOS**: backed by D-2's trait observation in the iOS half of the secure-window plugin.
- **Android**: always `false`. `FLAG_SECURE` already blanks every capture of the whole window
  there, so the picture never needs to blank itself.
- **A browser**: always `false`, because a web page cannot detect a capture. `NO_SECURE_WINDOW`
  gains the same no-op, and the browser's sentence (D-5) says nothing is blocked.
- **`secure-window.ts` stays the one owner.** It subscribes when the first hold is taken and
  unsubscribes when the last is given back, and each picture surface reads `captured` from it. No
  component subscribes to the port directly. `check:wiring` (§4j) then has one production caller
  for the new member, as it has for `setSecureWindow`.

`setSecureWindow` keeps its meaning on iOS: the plugin records whether a picture is on the screen,
which is what D-6 needs.

### D-5 — What the rider is told

`apps/web/src/camera/consent.ts` §`SCREENSHOT_SENTENCE` (line 82 on `main` at 292aa3a0e) reads:

> In the Android app, screenshots and the app-switcher preview are blocked while a camera picture
> is on the screen. A browser cannot block them.

On `main` it is shown in two places: on the Camera page (`views/CameraView.tsx`, through
`CONSENT_STATEMENT`) and on the side-camera phone's page (`views/SideCameraView.tsx`). Wherever
ADR 0044 D-10's table puts it later, the same rule applies. **It is wrong on iOS**, where nothing is blocked and the app does
something else. In the iOS app, the sentence must describe the iOS app and must not name Android.

**The decision**: the sentence is chosen by platform, one per shell. The Android app's and the
browser's words do not change. **The words for the iOS app, approved by the owner on 2026-11-26**
(Q2; ADR 0044 D-10: the published wording changes only with the owner's approval). Because the
owner said yes to Q1, the iOS sentence is the switcher variant:

> **(iOS)** In the iPad and iPhone app, a camera picture is hidden while the screen is being
> recorded or shared, and in the app switcher. A screenshot cannot be blocked.

The line in the blank panel (D-2), also approved:

> **(panel)** Hidden while your screen is being recorded or shared.

The draft without the switcher clause (*"…is hidden while the screen is being recorded or shared. A
screenshot cannot be blocked."*) was the wording for a no to Q1, and is not used.

### D-6 — The app switcher: the picture is hidden from its snapshot too (Q1, the owner's ruling)

D-11 rules on screen capture. Android's flag also blanks the recent-apps thumbnail, and iOS takes
the app-switcher snapshot *"after your app enters the background and your delegate method
returns"* (the article quoted in Context). D-11 did not say whether iOS should hide the picture
from that snapshot, so this ADR asked (Q1), and **the owner ruled yes on 2026-11-26**.

- **While a hold is taken**, the iOS half of the secure-window plugin puts an opaque **native**
  view over the web view on `sceneWillResignActive(_:)`, and removes it when the scene is active
  again. It reads the hold that `setSecureWindow` records (D-4).
- **The cover is native**, because Apple's article puts the snapshot after the delegate method
  returns, and nothing here shows the web view's JavaScript runs in time to remove the picture
  first.
- **It covers the whole window.** Only the snapshot and a moment on return show it. This matches
  what D-12 gives Android's recent-apps thumbnail.
- The rider is told so, in D-5's sentence: *"…and in the app switcher."*

## Questions for the owner

All three were answered by the owner on 2026-11-26 on #3316, each as recommended.

1. **Q1 — Hide the picture from the app-switcher snapshot too?** **Answered yes, 2026-11-26** (D-6).
   *Recommendation was: yes.* While a hold
   is taken, the iOS half of the plugin puts an opaque native view over the web view on
   `sceneWillResignActive(_:)`, and removes it when the scene is active again. The cover is native
   because Apple's article puts the snapshot after the delegate method returns, and nothing here
   shows the web view's JavaScript runs in time to remove the picture first. It covers the whole
   window, and only the snapshot and a moment on return show it. This matches what D-12 gives
   Android's recent-apps thumbnail.
2. **Q2 — The two draft sentences in D-5.** **Approved, 2026-11-26**, the iOS sentence in its
   switcher variant after Q1. *Recommendation was: approve them as written.* They say
   what the app does and what it cannot do, in the words a rider uses ("recorded or shared"), and
   they leave out "mirrored", which riders rarely say.
3. **Q3 — Do nothing on a screenshot (D-3)?** **Answered yes, nothing, 2026-11-26.**
   *Recommendation was: yes, nothing.* The alternative is a
   notice after `userDidTakeScreenshotNotification`, which cannot undo the screenshot and would
   tell the rider only what they did.

## Consequences

- **What this enables.** #1771 can build the iOS half against a fixed contract: the trait it
  observes, the port member it adds, the owner it goes through, and the words the owner
  approved.
- **What it costs.** The port gains a member that does nothing on two of its three platforms. The
  consent sentence becomes platform-dependent, so `consent.test.ts` has to pin one sentence per
  shell instead of one sentence. A rider who records their own iPad screen loses the camera picture
  in the recording, on purpose.
- **What it does not give.** Parity with Android. A screenshot of a camera picture on iOS keeps the
  picture, and the rider is told so. Some frames may reach a recording before the blank (D-3).
- **Constraints on other work.**
  - #1771 adds `watchCapture` to `secure-window-port.ts`, gives `secure-window.ts` a `captured`
    state, makes each D-1 surface draw D-5's panel while captured, and changes `consent.ts` to a
    per-shell sentence, all in one pull request with the owner-approved words (D-5), and adds
    D-6's native cover for the app-switcher snapshot.
  - #1771 owes a device check on the owner's list (#733): start a screen recording and start
    mirroring with each D-1 surface on the screen, and record whether the picture is blank in the
    recording and on the mirror, and roughly how many frames reached them first.
  - `UITraitSceneCaptureState` is confirmed to compile against the iOS 17 SDK before it is relied
    on (Context).

## What would make this ADR wrong

- **Apple adds a way to refuse capture** for an app's own window. Then the counterpart of D-12 is
  that, and this ADR is superseded.
- **`sceneCaptureState` turns out not to report** AirPlay or a cast that `isCaptured` reported.
  Then D-2 needs a second source, and the deprecated API may be the only one until iOS 27.
- **The gap before the blank is long enough to matter** on #1771's device check. Then the owner
  decides whether a camera picture is shown on iOS at all.
