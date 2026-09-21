// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride's non-speech sounds may ask of the platform's audio — #400.
 *
 * ## A port, because jsdom has no Web Audio
 *
 * `AudioContext` cannot be constructed meaningfully in the fast suite, and a
 * test that constructs the real one is a test that runs nowhere. So every
 * decision — when a tone starts, what pitch it is, that a mute silences it,
 * that a dropped sensor silences it, that it stops when the ride does — is
 * made in `audio-cues.ts` against THIS interface, and asserted against a double
 * that counts calls. `web-audio.ts` is the one file that names `AudioContext`,
 * and what it does with these five calls is the half only a person with
 * headphones can check: `docs/validation/0003-screen-reader-and-assistive-technology.md`
 * Part I, whose table is empty.
 *
 * ⚠️ **A `*-port.ts` on purpose**: `check:wiring` then requires every method
 * here to have a production caller (§4j, `WIRE003`), which is what stops a
 * mute or a stop being declared, implemented, tested — and called by nobody.
 *
 * ⚠️ **No dependency.** Web Audio is part of the platform, available in the
 * Android WebView, so this raises no licence question at all (CLAUDE.md §3).
 * And it is **not speech**: `window.speechSynthesis` is unsupported in the
 * Android WebView, and a tone is not a sentence.
 */

/** The two short sounds. Their shapes are `web-audio.ts`'s, and this project's own. */
export type CueName = 'interval' | 'distance';

export interface CueOutput {
  /**
   * Create the audio context if there is none, and resume it if it is
   * suspended. ⚠️ **Only ever called from inside a user gesture** — a browser
   * refuses audio that starts without one, silently, so an implementation that
   * relied on autoplay would pass every test and be dead in the product.
   */
  resume(): void;
  /**
   * Whether a context already exists and is `running` — #400's review. A panel
   * that comes back mid-workout asks this rather than calling {@link resume},
   * because it is not inside a press. ⚠️ **Never creates or resumes anything**:
   * `false` where there is no context, and `false` for a suspended one, which
   * only the rider's next press can fix.
   */
  isRunning(): boolean;
  /**
   * Let the platform stop running the audio — #447. Suspends a context that is
   * running and does nothing otherwise; never creates one.
   *
   * ⚠️ **Called only when neither a ride nor a workout is running**, and that
   * is the whole of the safety argument. An idle `running` context still runs
   * the platform's audio thread — work a phone on a handlebar pays for in
   * battery for the rest of the session — and a suspended one costs the next
   * ride nothing, because its *Ride* press calls {@link resume} inside the
   * gesture anyway. What it WOULD cost is a panel coming back mid-workout
   * ({@link isRunning} would say no, and the tone would wait for a press),
   * which is why a workout still running is never suspended under.
   */
  suspend(): void;
  /** Start the one continuous tone. A second call while one sounds moves it rather than adding one. */
  startTone(frequencyHz: number, gain: number): void;
  /** Move the tone that is sounding. */
  setTone(frequencyHz: number, gain: number): void;
  /** Stop the tone. Nothing is left sounding. */
  stopTone(): void;
  /** One short sound, at a gain. */
  playCue(cue: CueName, gain: number): void;
}
