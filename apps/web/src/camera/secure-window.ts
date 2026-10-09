// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The one owner of the secure window flag: a count over the camera pictures
 * on screen** — [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-12.
 *
 * Every picture surface takes a hold when its picture is mounted and gives it
 * back when it is removed ({@link SecureWindow.hold}). The flag is set when
 * the first hold is taken and cleared when the last is given back — so two
 * pictures on one screen, or one replaced by the next in the same render,
 * never clear it early.
 *
 * ## Never cleared on the way to the background
 *
 * Android takes the recent-apps thumbnail as the app goes to the background.
 * A flag cleared then — a picture removed because the link dropped while the
 * app was leaving, or an unmount on `pause` — could leave the picture in that
 * thumbnail. So the last hold given back while the app is NOT in the
 * foreground keeps the flag set, and it is cleared only once the app is next
 * in the foreground with still no picture on screen (D-12: *"only by an in-app
 * change made while the app is in the foreground"*).
 *
 * ⚠️ **What it cannot prove here**: that a real device's thumbnail is blank.
 * That is a device check on the owner's list,
 * [#733](https://github.com/openzigs/onyourleft/issues/733).
 */

import type { SecureWindowPort } from './secure-window-port';

/** Whether the app is in the foreground, and when it next comes back to it. */
export interface Foreground {
  inForeground(): boolean;
  /** Call `listener` each time the app comes to the foreground. @returns the unsubscribe. */
  onForeground(listener: () => void): () => void;
}

/** The page's own answer: `document.visibilityState`, which Capacitor's WebView follows on pause and resume. */
export function documentForeground(): Foreground {
  return {
    inForeground: () => document.visibilityState === 'visible',
    onForeground: (listener) => {
      const heard = (): void => {
        if (document.visibilityState === 'visible') {
          listener();
        }
      };
      document.addEventListener('visibilitychange', heard);
      return () => {
        document.removeEventListener('visibilitychange', heard);
      };
    },
  };
}

/** The count, and the flag it drives. */
export class SecureWindow {
  readonly #port: SecureWindowPort;
  readonly #foreground: Foreground;
  #holds = 0;
  /** What the platform was last asked for. */
  #secure = false;
  /** Calls to the platform, one after another, so a set and a clear never cross. */
  #queue: Promise<void> = Promise.resolve();
  #waitingForForeground: (() => void) | undefined;

  constructor(port: SecureWindowPort, foreground: Foreground) {
    this.#port = port;
    this.#foreground = foreground;
  }

  /** How many pictures are holding the flag now. For the tests. */
  get holds(): number {
    return this.#holds;
  }

  /**
   * A picture is on screen: the flag is set, if it is not already.
   *
   * @returns the give-back. Call it once, when the picture is removed; a
   * second call does nothing.
   */
  hold(): () => void {
    this.#holds += 1;
    this.#ask(true);
    let given = false;
    return () => {
      if (given) {
        return;
      }
      given = true;
      this.#holds -= 1;
      this.#clearIfNothingHeld();
    };
  }

  #clearIfNothingHeld(): void {
    if (this.#holds > 0) {
      return;
    }
    if (this.#foreground.inForeground()) {
      this.#ask(false);
      return;
    }
    // In the background: keep the flag until the app is next in front.
    this.#waitingForForeground ??= this.#foreground.onForeground(() => {
      this.#waitingForForeground?.();
      this.#waitingForForeground = undefined;
      if (this.#holds === 0) {
        this.#ask(false);
      }
    });
  }

  #ask(secure: boolean): void {
    if (this.#secure === secure) {
      return;
    }
    this.#secure = secure;
    const port = this.#port;
    this.#queue = this.#queue
      .then(async () => port.setSecureWindow(secure))
      .catch(() => {
        // Nothing of the error is read (ADR 0029 D-8). A platform with no flag
        // — a plugin missing from MainActivity's registration — is a window
        // with no flag, which the consent's sentence already says of a browser.
      });
  }
}
