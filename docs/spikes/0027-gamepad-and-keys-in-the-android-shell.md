# Spike 0027: the Gamepad API and the keys of a gamepad in the Android shell, on the owner's Pixel Tablet — two pads measured, remotes, rings and media keys not

- **Date measured**: **2026-10-29.** Both runs below were made that day, on the owner's Pixel Tablet,
  in the installed `main` build of `dev.openzigs.onyourleft`. The owner pressed the buttons; the
  maintainer read the page. This write-up was written the same day from the two measurement
  comments on the issue, and re-checks one claim against Chromium's source (§5)
- **Issue**: [#1819](https://github.com/openzigs/onyourleft/issues/1819). Parent epic
  [#1803](https://github.com/openzigs/onyourleft/issues/1803). It rests on owner rulings **DL3**
  and **DL12** of 2026-10-27 and **DL7 revised** of 2026-10-28, which makes this spike *"the gate
  for the whole controller path"* (the issue's comment of that day)
- **Rests on it**: [#1821](https://github.com/openzigs/onyourleft/issues/1821) (a gamepad steers and
  throws in Delivery, pull request [#1855](https://github.com/openzigs/onyourleft/pull/1855)) and
  [#1858](https://github.com/openzigs/onyourleft/issues/1858) (forwarding a generic pad's numbered
  buttons from the shell)
- **Number**: **0027.** `docs/spikes/` holds 0001 to 0020 and 0022 to 0026 and 0028 on
  `origin/main` `7c9d2297`; 0027 was claimed by this issue's title and by spike 0028's own header.
  No open pull request carried a spike on 2026-10-29
- **Status of this document**: a **spike write-up**. It records what was measured and what was not,
  and decides nothing. The two follow-ups are issues, not conclusions of this note

> ## ⚠️ The answer in one paragraph
>
> **A standard-mapping Bluetooth pad works in the Android shell today, and a generic pad's
> d-pad does but its buttons do not.** An Xbox Wireless Controller over Bluetooth fired
> `gamepadconnected` with `mapping: 'standard'`, and every button pressed reached the page at its
> W3C index (A 0, B 1, X 2, Y 3, LB 4, RB 5, View 8, Menu 9, d-pad 12 to 15), with the left stick
> sweeping axis 0 from -1.00 to +1.00. A generic "Twin USB Joystick" receiver fired the event with
> `mapping: ''`; its **d-pad arrived as axes 0 and 1** (-1, 0 or +1), but **none of its nine face
> and shoulder buttons reached the page**, neither as `gamepad.buttons` nor as a `keydown`, although
> the kernel saw all nine. **Not measured, and the issue asked for them**: polling cost, a Chrome
> control, a Bluetooth handlebar remote or ring, a USB-C pad, media keys, the kill criterion
> committed beforehand, and the WebView version. §6 lists every acceptance criterion against what
> was done.

---

## 1. What was known before the run

From the issue, all read and not run before 2026-10-29:

- The W3C Gamepad API is exposed in Android WebView, and `getGamepads()` returns empty slots until
  a gamepad button is pressed (an anti-fingerprinting rule).
- `apps/mobile`'s `MainActivity` overrides no key handling (re-checked on `origin/main` `7c9d2297`:
  no `dispatchKeyEvent` or `onKey` in `apps/mobile/android/app/src/main/java`), and `@capacitor/android`
  is pinned at 8.5.2 in `apps/mobile/package.json`.
- [Spike 0026](0026-hardware-lap-and-pause-in-the-android-shell.md), read and not run: a remote
  paired as a keyboard sends key events the WebView delivers, and the volume keys go to the system.

## 2. How it was measured

- **The device**: a Google Pixel Tablet. **The WebView version was not recorded.** **The build was
  "the installed `main` build"; its commit was not recorded.** Both are gaps against the issue's
  criterion that every finding names them, and a later run should write them down first.
- **The method**: the app was not reinstalled or restarted. A **read-only probe was injected into
  its WebView over DevTools** from the maintainer's machine. It listened for `gamepadconnected`,
  `gamepaddisconnected` and `keydown`, and polled `getGamepads()`. In the generic-pad run the
  kernel's raw events were also captured with `getevent`. **Nothing was committed**: the probe and
  the raw logs stay in the maintainer's scratchpad, as the issue requires.
- No trainer was involved. Nothing here identifies the rider or a place.
- Pairing: a Bluetooth pad is paired by Android in Settings, not by the app, and Web Bluetooth
  blocklists the HID service, so the app's own BLE stack plays no part in either run.

## 3. The generic USB pad

A generic two-port USB receiver, listed by Android as **"Twin USB Joystick"** (USB vendor `0x0810`,
product `0x0001`). Android lists it as **two input devices**, each with sources
KEYBOARD and JOYSTICK, using the `Generic.kl` key layout.

| What | Result |
| --- | --- |
| `gamepadconnected` | **Fires** in the shell on the first input. id: *"Twin USB Joystick Twin USB Joystick (Vendor: 0810 Product: 0001)"* |
| `mapping` | **`''`, not `standard`**. 16 buttons, 4 axes |
| d-pad | **Reaches the page as axes 0 and 1**, at -1, 0 or +1: left and right on axis 0, up and down on axis 1. Every press arrived |
| Face, shoulder and Start buttons | **None reached the page.** `gamepad.buttons` stayed unpressed throughout and no `keydown` arrived |
| Raw kernel capture | `getevent` showed **nine distinct buttons**: `BTN_JOYSTICK`, `BTN_THUMB`, `BTN_THUMB2`, `BTN_TOP`, `BTN_TOP2`, `BTN_PINKIE`, `BTN_BASE`, `BTN_BASE2` and `BTN_BASE4`, which `Generic.kl` maps to `KEYCODE_BUTTON_1` to `10` |
| `gamepaddisconnected` | Fired about 35 s after the last press, presumably as the pad went idle |
| Volume and media keys | **Not tested in this run** |

The only explanation offered is a reading, taken further in §5: Chromium's Android gamepad path
maps only the *named* codes (`KEYCODE_BUTTON_A`, `_B`, `_X`, `_Y`, `_L1` and so on) and drops
`KEYCODE_BUTTON_1` to `16`.

## 4. The Xbox Wireless Controller over Bluetooth

An **Xbox Wireless Controller** (vendor `0x045e`, product `0x0b13`), paired by the owner in Android
Settings. The method was the same.

| What | Result |
| --- | --- |
| `gamepadconnected` | id *"Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"*. Android lists the sources as KEYBOARD, GAMEPAD and JOYSTICK |
| `mapping` | **`standard`**. 18 buttons, 4 axes |
| Buttons | **Every button pressed reached the page at its W3C standard index**: A 0, B 1, X 2, Y 3; LB 4, RB 5; View 8, Menu 9; d-pad up 12, down 13, left 14, right 15 |
| Left stick | Reached **axis 0 smoothly from -1.00 to +1.00**. At rest it read about +0.05 and -0.02 |
| Volume keys | Reached the page as **no `keydown`**; they went to the system. This matches spike 0026's reading |
| Not pressed | The Xbox button (16), the Share button, and the triggers (6 and 7) |

## 5. A claim re-checked against Chromium's source

§3's explanation was, in the maintainer's comment, *"reading (not verified in source)"*. It was
read on 2026-10-29 in Chromium's `main` branch, in
`device/gamepad/android/java/src/org/chromium/device/gamepad/`:

- `GamepadDevice.java` §`RELEVANT_KEYCODES` is the list of keycodes the device is asked about
  (`InputDevice.hasKeys`). It holds `DPAD_UP`, `DOWN`, `LEFT`, `RIGHT`, then `BUTTON_A` (0x60)
  through `BUTTON_MODE` (0x6e), then `MEDIA_RECORD` (0x82). **No `KEYCODE_BUTTON_1` to `16`** (188
  to 203).
- `GamepadMappings.java` names only the named button constants.
- `handleKeyEvent` does fold a `KEYCODE_UNKNOWN` event with a scancode from `BTN_TRIGGER_HAPPY`
  (0x2c0 to 0x2cf) into `KEYCODE_BUTTON_1` and up, but that is the *unmapped*-scancode case.
  Section 3's pad had `Generic.kl` map its buttons to `KEYCODE_BUTTON_1` to `10` already, so that
  branch is not the one it took.

**What this does and does not show.** It is consistent with the measurement and is the most likely
cause. It is **Chromium `main` on 2026-10-29, not the source of the WebView in the tablet** (whose
version is the gap in §2), and no run changed one thing and watched the buttons arrive. It stays a
reading.

## 6. Every acceptance criterion of the issue, against what was done

| Criterion | Done? |
| --- | --- |
| The kill criterion committed before measuring | **No.** The runs were made on 2026-10-29 from the issue's text and the owner's rulings, and no first commit stated what result makes #1821 go ahead in the shell, in the browser only, or wait. The reading that #1821 goes ahead for a standard pad in the shell (below) was made after the measurement |
| Gamepad in the shell: `gamepadconnected`, `getGamepads()` after a press, `standard` or not, indices of the d-pad, a stick and two face buttons | **Yes, for two pads.** §3 and §4 |
| The same in Chrome on the tablet, as a control | **No** |
| Polling cost: press to `getGamepads()`, at least 50 samples, median and 95th percentile | **No** |
| Remotes and rings: every button's `key` and `code` | **No remote or ring was paired.** DL7 revised asks for a cheap Bluetooth handlebar remote, a Bluetooth gamepad and a USB-C gamepad. The Bluetooth gamepad is done; **the remote is not; the USB pad was a receiver, and whether any pad ran over a USB-C cable was not recorded** |
| Media keys: `MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious`, and whether the system also acts | **No**, in either run |
| Volume keys: confirm or contradict spike 0026 | **Confirmed once** (§4, Xbox run: no `keydown`), and not tested in the generic run. The shell is unchanged, so this is route B's starting point |
| Every finding names the device, the WebView version and the build | **Device and ids: yes. WebView version: no. Build commit: no.** (§2) |
| It decides nothing; route B is a question for the owner | Yes (§7) |

## 7. What the maintainer read from it, and the questions

These are the readings in the issue's comments, repeated and not decided here.

1. **A standard Bluetooth pad works in the shell today**, with #1821's approved mapping (d-pad 14
   and 15 or the stick's axis 0 for lanes; X 2 left, B 1 right, A 0 toward the next house) and
   **no `apps/mobile` change**. The stick's rest value, about 0.05, is well inside #1821's 0.5
   press threshold.
2. **#1821 reads only `mapping: 'standard'`, so it ignores a generic pad entirely.** A generic
   pad's d-pad could steer lanes from axes 0 and 1 in the shell today.
3. **Throwing from a generic pad's buttons needs an `apps/mobile` change**: `MainActivity` would
   forward `KEYCODE_BUTTON_1` to `16` to the page, tracked in #1858. That is the owner's to rule
   on, as #1821 already says.
4. **Route B is still a question for the owner**: the volume keys never reach the page, so using
   them costs the rider the system volume during a ride, as spike 0026 §2 described.

## 8. What was not done, and what a later run needs

- **A Chrome control, the polling cost, the kill criterion**: write the criterion first, and take
  the 50 samples of press to `getGamepads()` on the shell and in Chrome on the tablet.
- **A cheap Bluetooth handlebar remote and a ring**: every button's `key` and `code`, or "nothing
  arrives". Nothing about a remote has been observed; spike 0026's route A remains a reading.
- **Media keys** (`MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious`) from a remote or a
  headset, and whether the system also acts on them.
- **The Xbox button, Share and the triggers** (6 and 7), and a standard pad in XInput mode from
  another maker, for example an 8BitDo controller.
- **The WebView version and the build commit**, written down before the first press.
- **A pad connected by a USB-C cable.**
- **Volume keys in the generic-pad run.**
- **One tablet.** Another device's WebView may differ, and so may a Samsung or an older Android's.

## Sources

- The issue's comments of 2026-10-28 and 2026-10-29,
  [#1819](https://github.com/openzigs/onyourleft/issues/1819), which carry the measurement and
  the lane's scope. The raw logs are not committed
- [Spike 0026](0026-hardware-lap-and-pause-in-the-android-shell.md), volume keys and a remote
- W3C, *Gamepad* — https://www.w3.org/TR/gamepad/
- Chromium, `GamepadDevice.java` — https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/android/java/src/org/chromium/device/gamepad/GamepadDevice.java
- Chromium, `GamepadMappings.java` — https://chromium.googlesource.com/chromium/src/+/main/device/gamepad/android/java/src/org/chromium/device/gamepad/GamepadMappings.java
