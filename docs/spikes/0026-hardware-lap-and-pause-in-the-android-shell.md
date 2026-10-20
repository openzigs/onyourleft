# Spike 0026: Lap and Pause from hardware in the Android shell — volume keys and a Bluetooth remote, read but not run

- **Date**: **2026-10-19.** A reading of this repository at the commit this write-up lands in,
  and of platform documentation, that day. **Nothing was run on a phone, and no remote was
  paired**
- **Issue**: [#1432](https://github.com/openzigs/onyourleft/issues/1432), its fourth criterion:
  *"A spike note on hardware alternatives in the Android shell (volume keys, a Bluetooth remote)
  for Lap and Pause, without new permissions unless the owner agrees"*
- **Rests on it**: nothing yet. It is the input to a follow-up issue, if the owner wants one
- **Number**: **0026.** `docs/spikes/` holds 0001 to 0020 and 0022 to 0025 on `main`; 0021 is
  claimed by [#1057](https://github.com/openzigs/onyourleft/issues/1057). No open pull request
  carried a spike on 2026-10-19
- **Status of this document**: a **spike write-up**. It measures and decides nothing, and unlike
  most of its siblings it does not even measure: every claim about Android below is from the
  documentation and is marked as such where it matters

> ## ⚠️ The answer in one paragraph
>
> **Every route below needs no new Android permission**, and none touches the trainer. The
> cheapest is no shell change at all: a **Bluetooth remote that the phone pairs as a keyboard**
> (most do: a camera-shutter remote or a presentation clicker is a HID device) sends key events
> the WebView already delivers to the page, so a **key map on the Ride screen and the HUD** —
> written in `apps/web`, working in a browser too — gives Lap and Pause to any remote that sends
> ordinary keys. **The volume keys are not among them**: Android hands them to the activity and
> the system volume, so they need a small native hook in `MainActivity` and a plugin event, and
> they cost the rider the volume of their music for as long as the hook holds them. **The screen
> off is the hard case**: an activity hears no keys then, and the documented way is a media
> session in the recording service, which is a larger piece of work. **An app cannot read a HID
> remote over GATT itself** — Android reserves that service to the system — so pairing a remote
> through the app's own Bluetooth stack is not a route.

---

## 1. What the shell and the client have today

- `apps/mobile/android/app/src/main/java/dev/openzigs/onyourleft/MainActivity.java` extends
  Capacitor's `BridgeActivity`, registers three plugins of this repository's own
  (`RecordingServicePlugin`, `ThermalPlugin`, `SecureWindowPlugin`) and overrides nothing about
  keys.
- The manifest asks for `INTERNET`, `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_CONNECT`,
  the two location permissions up to API 30 only, `CAMERA`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_CONNECTED_DEVICE` and `POST_NOTIFICATIONS`.
- **Nothing in `apps/web/src` listens for a key on the Ride screen or the HUD.** A rider with a
  keyboard reaches *Lap* and *Pause* by Tab and Enter, which is the accessibility path and not a
  hardware shortcut.
- The touch lock #1432 adds lets a click with `detail` 0 through — a key's click — so none of
  the routes below would be stopped by it (`apps/web/src/design/touch-lock.ts`).

## 2. The routes

| Route | Shell change | New permission | Screen off | What it costs the rider |
| --- | --- | --- | --- | --- |
| A. A key map in `apps/web` for a remote that sends ordinary keys | none | none | no | nothing; keys must be chosen not to collide with focus (Enter and Space activate the focused control) |
| B. The phone's own volume keys, or a shutter remote that sends them | `MainActivity` hook and a plugin event | none | no | the volume keys stop changing the volume while a ride holds them |
| C. Media buttons (play/pause, next) from a headset or remote | a media session in the shell | none | yes, documented | competes with the rider's music app for the same buttons |
| D. Reading a HID remote over GATT from the app | — | not grantable | — | not a route |

### A. A key map, in the web build

A remote paired in Android's Settings as an input device is a keyboard to every app, and its keys
arrive in the WebView as `KeyboardEvent`s the way a laptop's do. Presentation clickers commonly
send Page Up / Page Down or the arrow keys; some shutter remotes send Enter. A ride-time key map
(say, one key for Lap and one for Pause / Resume, on the Ride screen and the HUD while a ride is
in progress) is ordinary client code, testable in jsdom and in the browser gate, and serves a
desktop keyboard too. **Which keys a given remote sends was not checked**: it varies by model,
and the follow-up would have to pick keys from a short survey of real remotes, or let the rider
press the remote's button once to bind it.

### B. The volume keys

From the Android documentation and the forum reports read for this note, not measured: key events
reach the foreground activity's `dispatchKeyEvent` first, and `KEYCODE_VOLUME_UP` and
`KEYCODE_VOLUME_DOWN` are acted on by the system volume unless the activity consumes them; the
page inside a WebView does not receive them as key events. So the route is a `dispatchKeyEvent`
override in `MainActivity` that, **only while the client has said a ride is in progress and the
rider has turned it on**, consumes the two keys and sends a plugin event that the client maps to
Lap and Pause — the shape `RecordingServicePlugin` already has for the other direction. Many cheap
camera-shutter remotes pair as a keyboard that sends exactly `VOLUME_UP`, so this route also serves
the cheapest remote there is. What it costs: for as long as the hook holds them the rider cannot
turn their music down with those keys, which is why it must be opt-in and released the moment the
ride stops. Needs no permission.

### C. Media buttons, and the screen off

An activity receives no key events while the screen is off. The documented way to hear a button
then is a media session: Android routes media buttons (and, with a remote volume provider, the
volume keys) to the active session. The shell's foreground `RecordingService` is the natural owner
of one. It needs no permission, but it is a larger change than B, it has to declare a playback
state that the recording is not, and it competes with whatever music app the rider is using for the
same buttons. Not researched further here.

### D. Not a route: GATT

A HID remote's service is reserved to the system: since Android 5 an app that opens the HID
service over GATT is refused without `BLUETOOTH_PRIVILEGED`, a permission only system apps hold.
The app's own BLE stack (`@capacitor-community/bluetooth-le`) therefore cannot read a remote's
buttons; the operating system pairs it and passes its keys on, which is route A or B. A vendor
controller with a proprietary service of its own is a separate question — a protocol to read and
a licence and IP check under `docs/agents/scope-and-ip.md` first — and was not looked at.

## 3. What was not done

- No phone and no remote: no key code in this note was observed.
- No WebView version was checked for which keys it forwards; route B's claim that the page does not
  see the volume keys is the documentation's, and the follow-up's first step is to log what a real
  device delivers.
- Nothing about iOS (there is no iOS shell).

## 4. For the owner

The recommendation, which the owner may take or leave: **route A first**, as its own issue — it is
client code with no shell change and no permission, and works with the remotes that send ordinary
keys; **route B second**, opt-in, held only during a ride, with a device check on the owner's
phone added to #733 before it ships. Route C only if riding with the screen off turns out to be
how riders use it.

## Sources

- Hammerhead, *Karoo OS Rain Lock* — https://support.hammerhead.io/hc/en-us/articles/25184031714203-Karoo-OS-Rain-Lock
- Android, `Activity.dispatchKeyEvent` — https://developer.android.com/reference/android/app/Activity#dispatchKeyEvent(android.view.KeyEvent)
- Android, `KeyEvent` (the volume key codes) — https://developer.android.com/reference/android/view/KeyEvent
- WebView key handling and volume keys, forum reports — https://www.b4x.com/android/forum/threads/webview-_-keycode-problem.124884
- HID over GATT refused to apps without `BLUETOOTH_PRIVILEGED` — https://devzone.nordicsemi.com/f/nordic-q-a/29198/bluetooth_privileged-error-hid-keyboard/126531
