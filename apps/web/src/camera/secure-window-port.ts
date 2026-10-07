// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Android's secure window flag, from the web client's side** —
 * [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-12.
 *
 * While a camera picture is on screen — the side camera's live view on the
 * tablet (`SideLiveView.tsx`), the phone's own framing preview
 * (`FramingPreview.tsx`) and the tablet's pairing viewfinder
 * (`ScanViewfinder.tsx`) — the Android app's window carries
 * `WindowManager.LayoutParams.FLAG_SECURE`: Android then shows a blank
 * recent-apps thumbnail, refuses a screenshot or a screen recording, and shows
 * a cast blank. `apps/mobile/src/secure-window/` and `SecureWindowPlugin.java`
 * are the Android half; `main.tsx` composes this port from them behind
 * `isNativeShell`, and hands a browser {@link NO_SECURE_WINDOW}, because a web
 * page cannot stop a screenshot — the consent says so (`consent.ts`
 * §`SCREENSHOT_SENTENCE`) rather than leaving it to be assumed.
 *
 * A `*-port.ts` so `check:wiring` watches it: a method here that nothing in
 * production calls is a red `WIRE003` (docs/agents/wiring-gate.md §4j). `secure-window.ts` is
 * the one caller, and the one owner of the flag: a count over the pictures on
 * screen, so two pictures, or a picture replaced by the next, never clear it
 * early.
 */

/** Set or clear the flag on the app's window. */
export interface SecureWindowPort {
  /**
   * `true` adds the flag to the window and `false` clears it. Resolves once
   * the platform has been asked; never needs to be awaited for correctness,
   * and a failure is the caller's to swallow (a browser has no flag at all).
   */
  setSecureWindow(secure: boolean): Promise<void>;
}

/** A browser's: there is no flag to set, and nothing pretends there is. */
export const NO_SECURE_WINDOW: SecureWindowPort = {
  setSecureWindow: () => Promise.resolve(),
};
