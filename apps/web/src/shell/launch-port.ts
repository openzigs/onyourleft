// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Telling the Android shell the page has painted** — #2051.
 *
 * #2050 holds the launch splash (`@capacitor/splash-screen`, configured in
 * `apps/mobile/capacitor.config.ts`) until the page says it is ready, or
 * until 3 s pass. The page has to say so once its first frame is on screen,
 * not when its script starts, or the rider sees the bare canvas the splash is
 * there to cover. `launch.tsx` decides when; this is what it tells.
 *
 * `main.tsx` composes the Android port from `apps/mobile/src/launch/` behind
 * `isNativeShell`, inside the same `import()` as the rest of the shell, so a
 * browser never loads a line of Capacitor, and hands a browser
 * {@link NO_LAUNCH}: a browser holds no splash.
 *
 * A `*-port.ts` so `check:wiring` watches it: a method here that nothing in
 * production calls is a red `WIRE003` (docs/agents/wiring-gate.md §4j).
 */

/** The shell's launch splash, from the page's side. */
export interface LaunchPort {
  /**
   * Release the splash. Resolves once the shell has been asked; a failure is
   * the caller's to swallow, because the shell's own timeout releases the
   * splash anyway.
   */
  releaseSplash(): Promise<void>;
}

/** A browser's: there is no splash to release, and nothing pretends there is. */
export const NO_LAUNCH: LaunchPort = {
  releaseSplash: () => Promise.resolve(),
};
