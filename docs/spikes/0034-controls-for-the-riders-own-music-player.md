# Spike 0034: controls for the rider's own music player (another app) inside the Android shell — a desk read, no device run

- **Date read**: **2026-11-03.** Every source below was read that day. **Nothing was run on a
  device**: this lane had no tablet, no phone and no adb, by the lane-scope comment on the issue.
  Every claim that depends on a device is marked **not measured** and has a row in §7
- **Issue**: [#2073](https://github.com/openzigs/onyourleft/issues/2073), from the owner's question
  of 2026-11-03: *"Is there a way if the user is playing their own music through another music app
  we can show the controls in our app for them to control the music"*. Related:
  [#2033](https://github.com/openzigs/onyourleft/issues/2033) (the audio epic),
  [#2060](https://github.com/openzigs/onyourleft/issues/2060) (does the WebView take audio focus),
  [#2056](https://github.com/openzigs/onyourleft/issues/2056) (the music mute this control would sit
  beside)
- **Platform range**: `apps/mobile/android/variables.gradle` on `origin/main` `aff787f3`:
  `minSdkVersion = 24`, `targetSdkVersion = 36`, `compileSdkVersion = 36`
- **Number**: **0034.** `docs/spikes/` on `origin/main` `aff787f3` holds 0001 to 0033 without 0009,
  0021 and 0032, and the one open pull request carrying a spike (#1989) claims 0032. #2060 will
  take "the next free number at write time"; if it merges first with 0034, this file takes the
  next free one (`SPIKE001`)
- **Status of this document**: a **spike write-up**. It records what the platform documents say and
  what that implies, and decides nothing. The issue's first acceptance criterion holds the build
  until the owner has read it

> ## ⚠️ The answer in one paragraph
>
> **Controls, yes, with no permission at all; the track title, only at a price we recommend not
> paying.** `AudioManager.dispatchMediaKeyEvent` sends a simulated media key (play, pause, next,
> previous), and Android routes it the way it routes a headset button: on Android 8.0 and later to
> the last app whose media session played audio locally, before 8.0 to the active session. It needs
> no permission and no new dependency. **Reading what is playing is a different matter**:
> `MediaSessionManager.getActiveSessions` needs either a system-only permission or the rider to turn
> on **Notification access** for us, which lets an app read every notification on the device, and
> which Android 13 and later blocks for an APK installed outside a store until the rider finds
> "Allow restricted settings". **Recommendation: build controls without a title.** Two findings
> change the issue's design rather than confirm it (§3): `isMusicActive()` counts our own WebView's
> sound too, and it turns false the moment the rider pauses, so "show the control only when another
> player is active" would hide the play button exactly when the rider wants to press it. **Not
> measured, and the issue asks for it**: whether Spotify, YouTube Music and a podcast app each obey
> the key, and on which Android versions (§7).

---

## 1. Controls with no special permission (the issue's question 1)

### 1.1 What the platform documents

[`AudioManager`](https://developer.android.com/reference/android/media/AudioManager), read
2026-11-03:

| Method | Added | Text, verbatim | Permission named |
| --- | --- | --- | --- |
| `dispatchMediaKeyEvent(KeyEvent)` | API 21 | *"Sends a simulated key event for a media button."* | None |
| `isMusicActive()` | API 1 | *"Checks whether any music is active."* | None |
| `getActivePlaybackConfigurations()` | API 26 | *"Returns the current active audio playback configurations of the device"* | None |

Every one is at or below `minSdkVersion = 24`, so none needs a version branch except the API 26
one.

How Android chooses the receiver of a media key is in
[Responding to media buttons](https://developer.android.com/media/legacy/media-buttons), verbatim:

- **Android 8.0 (API 26) and later**: *"the system tries to find the last app with a MediaSession
  that played audio locally. If the session is still active Android sends the event directly to it.
  Otherwise, if the session is not active and it has a mediabutton receiver, Android sends the event
  to the receiver, which will restart the session and so it can receive the event. [...] If the
  session does not have a media button receiver the system discards the media button event and
  nothing will happen."*
- **Before Android 8.0 (API 24 and 25 here)**: *"the system tries to send the event to an active
  media session. If there are multiple active media sessions, Android tries to choose a media
  session that is preparing to play (buffering/connecting), playing, or paused, rather than one that
  is stopped. [...] If there is no active session, Android tries to send the event to the most
  recently active session."*

### 1.2 What that means for this app

- **A Capacitor plugin can do it.** The call is a plain framework method on a system service; an
  in-tree plugin (the pattern `ThermalPlugin.java` and `SecureWindowPlugin.java` already follow,
  registered in `MainActivity` before `super.onCreate`, which
  `apps/mobile/src/android/plugin-registration.test.ts` already enforces for every in-tree plugin)
  sends a `KeyEvent` with `ACTION_DOWN` and then one with `ACTION_UP`. No Gradle dependency is
  added, so `apps/mobile/native-closure.json` (a list of library coordinates) **does not change**:
  the issue's "recorded in `native-closure.json`" has nothing to record unless a library such as
  `androidx.media` is added, and none is needed.
- **The key goes to whichever app Android picks, not to an app we name.** Without the permission in
  §2 we cannot see which app that is. If the rider last played a podcast and then opened a music
  app without starting it, "next" goes to the podcast.
- **"Play" can start an app that is not running.** On 8.0 and later a key reaching an inactive
  session with a media button receiver restarts it. That is the behaviour a headset button has, so
  it is expected, but it means a press can make sound start where there was none. The control
  should only ever send a key on a press, never on its own.
- **A risk to measure, not a reading**: if our own WebView ever creates a media session (for
  example for a media-element music source in #2058, which #2033's graph names), then on 8.0 and
  later **we** may become "the last app with a MediaSession that played audio locally", and the
  keys we send would come back to us instead of the rider's player. Whether Android System WebView
  creates a platform media session for page audio is **not documented in anything read here** and
  is a device row (§7, row D4).
- **Toggle or explicit keys.** `KEYCODE_MEDIA_PLAY_PAUSE` is a toggle, and without §2 we do not know
  the player's state. `KEYCODE_MEDIA_PLAY` and `KEYCODE_MEDIA_PAUSE` are explicit and cannot invert
  the rider's intent; whether each player honours them is a device row (D2). The safer default is
  the explicit pair, chosen from what the control last sent.

### 1.3 Does `isMusicActive()` tell us something is playing?

It tells us **something** is. Two consequences the issue's design did not account for:

1. **It counts our own sound.** The method's text is "any music", and nothing on the page limits it
   to other apps. While our menu music or ride cues play through the WebView, it is true whatever
   the rider's player is doing. `getActivePlaybackConfigurations()` does not rescue this: the only
   public accessor on
   [`AudioPlaybackConfiguration`](https://developer.android.com/reference/android/media/AudioPlaybackConfiguration)
   is `getAudioAttributes()` (`getAudioDeviceInfo()` is deprecated in API 36 as *"never
   populated"*), so a non-system app cannot tell whose player each configuration is. The client
   does know its own state, so the honest reading is "other audio is probably playing" only while
   our own output is silent. Whether a **suspended or muted** `AudioContext` still counts is a
   device row (D5).
2. **It turns false when the rider pauses.** A paused player is not active. A control shown "only
   when another player is active" would therefore disappear the instant the rider pauses through it,
   leaving no way to press play again. The issue's acceptance criterion "hidden [...] when nothing
   is playing" needs restating before a build: for example, keep the control for the rest of the
   visit once the rider has used it or once other audio was seen, or show it in Settings on Android
   always and in the header only when other audio was seen. That is a design choice for the owner,
   not a finding, and §6 lists it.

## 2. Track title and artwork (the issue's question 2)

### 2.1 What it needs

[`MediaSessionManager.getActiveSessions(ComponentName)`](https://developer.android.com/reference/android/media/session/MediaSessionManager),
verbatim: *"This requires the `MEDIA_CONTENT_CONTROL` permission be held by the calling app. You may
also retrieve this list if your app is an enabled notification listener using the
`NotificationListenerService` APIs, in which case you must pass the `ComponentName` of your enabled
listener."* `MEDIA_CONTENT_CONTROL` is not grantable to an ordinary app, so in practice the route is
a `NotificationListenerService` the rider enables by hand in system Settings. The API 33 methods
that would name the receiving app (`getMediaKeyEventSessionPackageName`) carry the same requirement
and *"will throw a `SecurityException`"* without it.

### 2.2 What Google Play says about it

- **Not on Play's restricted list.** Play's
  [Permissions and APIs that Access Sensitive Information](https://support.google.com/googleplay/android-developer/answer/13161072)
  policy, read 2026-11-03, names SMS and Call Log, location, photo and video, All Files Access,
  package visibility, the Accessibility API, body sensors, Health Connect, VPN, exact alarms and
  full-screen intents. **It does not mention a notification listener** (a fetch of the page found no
  `NotificationListenerService`, `BIND_NOTIFICATION_LISTENER_SERVICE` or "notification access").
- **The general rule still binds**, verbatim: *"Requests for permission and APIs that access
  sensitive information should make sense to users. You may only request permissions and APIs that
  access sensitive information that are necessary to implement current features or services in your
  app that are promoted in your Google Play listing."* So the listing would have to promote the
  feature.
- **Data safety.** Play's
  [Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469)
  defines *"collect"* as *"transmitting data from your app off a user's device"*, and says *"User
  data accessed by your app that is only processed locally on the user's device and not sent off
  device does not need to be disclosed."* A title that never leaves the device would not change the
  Data safety answers in `apps/mobile/src/android/`.
- **How it is disclosed to the rider.** There is no runtime dialog. The rider is sent to the system's
  Notification access screen and turns the switch on there; Android's own warning on that screen is
  the disclosure. A good in-app explanation before sending them there is our job.

### 2.3 What it costs beyond Play

- **It is far wider than the feature.** An enabled notification listener can read the content of
  every notification on the device: messages, codes, everything. Asking a rider for that so that a
  header can show a song title is out of proportion, and the project's posture toward the rider's
  data (CLAUDE.md §1, §6) argues against it.
- **Android 13 and later restrict it for an APK installed outside a store.** "Restricted settings"
  block the rider from enabling a notification listener (and an accessibility service) for an app
  that was not installed through a store's session-based installer, until they find **Settings >
  Apps > [app] > ⋮ > Allow restricted settings**. Google's
  [help page](https://support.google.com/android/answer/12623953) gives that path and says it needs
  Android 13 or later; it does not list which settings are restricted. The notification-listener
  scope and the sideload condition are from a **secondary source**,
  [Kaspersky's write-up of restricted settings](https://kaspersky.com/blog/android-restricted-settings/49991),
  and were not checked against AOSP source in this lane. This matters here because
  `apps/mobile/RELEASE.md` describes a GitHub Release APK as well as the Play bundle.

### 2.4 Recommendation on the Notification-access question

**Do not ask for Notification access. Controls without a title are enough** for the owner's question,
which was about controlling the music, not seeing it. If the owner wants the title later, it is a
separate issue with its own owner ruling, its own in-app explanation screen, and the privacy tests
of §4 written first.

## 3. The web build (the issue's question 3)

- **It can do nothing for another app's player.** The
  [W3C Media Session API](https://www.w3.org/TR/mediasession/) lets a page *"show customized media
  metadata on platform UI, customize available platform media controls, and access platform media
  keys"*: it is about the page's **own** media, in both directions. No web API sends a key to, or
  reads from, another application or another tab.
- **How the control is hidden there.** `apps/web/src/support/capacitor.ts` already answers "am I in
  the Android shell" from `window.Capacitor.isNativePlatform()` and explains why neither the user
  agent nor `'Capacitor' in window` will do. The control should render only when that answer is yes
  **and** `getPlatform()` is `android` (there is no iOS path, CLAUDE.md §6), and the web side should
  reach the plugin through a port that the browser build never loads, as `apps/mobile/src/index.ts`
  already does for BLE.

## 4. Privacy (the issue's question 4)

- **With controls only, there is no track data to leak.** The plugin's replies would be a boolean
  ("other audio active") and nothing else; no title, artist, artwork or package name is ever read.
  That is the strongest form of "it stays on the device": it never reaches the device's JavaScript.
- **What the acceptance criterion's test should then assert**: that the plugin port's reply type
  holds only that boolean (a type-level and a runtime check on the TypeScript side), and that a
  ride's stored record, its export and the sync payload, read back through their real readers after
  the control has been used, contain no field the control introduced. The readers are the same ones
  the device-canonical invariants (CLAUDE.md §1, ADR 0036 D-3) already lean on.
- **If a title is ever added (§2.4)**, it is personal data: in memory only, never in
  `localStorage`, IndexedDB, a log line, a crash report, the ride record, an export, a sync payload
  or an AI write-up, and the `no-network.test.ts` rule that admits one module for instance traffic
  does not change.

## 5. Interplay with the rest of the audio epic

- **#2060 (audio focus).** If the WebView takes audio focus when menu music starts, the rider's
  player pauses itself and §1.3's `isMusicActive()` turns false. If it does not, both play at once.
  Either way, our menu music and the rider's music compete. A design where our menu music stays
  silent while the rider's own player is in use follows naturally, but it is an owner decision.
- **Ride routes.** Not proposed. The issue keeps the control off ride routes unless the owner rules
  otherwise, and `apps/web/src/design/ride-time-controls.ts` governs anything that is.

## 6. What the owner is asked to decide before a build

1. Controls without a title (recommended), or Notification access for a title (§2).
2. When the control shows, given §1.3 (2): the issue's "only when another player is active" hides it
   after the first pause.
3. Whether our menu music yields to the rider's player (§5).

## 7. Device rows (not measured; each needs the installed `main` build, its commit and the WebView version written down first)

These are proposed for #733 when the build exists. They were **not** added to #733 by this lane.

| Row | What to do | What to record |
| --- | --- | --- |
| D1 | With Spotify, YouTube Music and one podcast app each playing in turn, press our play/pause, next and previous | Which app responded to each key, on which Android version |
| D2 | Repeat D1 with explicit `PLAY` and `PAUSE` keys instead of the toggle | Whether each app honours the explicit keys |
| D3 | Pause the other app through our control, then read `isMusicActive()` | That it turns false (the §1.3 (2) reading) |
| D4 | Start our ride cues, and menu music once #2058 exists, then send a key | Whether the key reaches the other app or comes back to our WebView (§1.2) |
| D5 | With nothing else playing, read `isMusicActive()` with our `AudioContext` running and silent, then suspended | Whether our own idle output counts as music (§1.3 (1)) |
| D6 | One run on an Android 7.x device if one exists (API 24 or 25) | Whether pre-8.0 routing behaves as §1.1 quotes |

## 8. Every acceptance criterion of the issue, against this write-up

| Criterion | Where it stands |
| --- | --- |
| Spike document with sources and a recommendation on the Notification-access question, read by the owner before any build | This file; recommendation in §2.4. **The owner's read is outstanding** |
| Controls send the media key and the other app responds, proven by a test through the plugin port, and a device check row on #733 | **Not built.** Held by the first criterion. Rows proposed in §7 |
| Hidden in the web build and when nothing is playing, with tests | **Not built.** §3 says how; §1.3 (2) says "when nothing is playing" needs restating first |
| No track data leaves the device: a test reads back the ride record, export and sync payload | **Not built.** §4 says what the test asserts |
| Owner-approved before/after screenshots before merge | **Not applicable to this write-up**; nothing a rider sees changes |
