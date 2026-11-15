// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the shell's WebView lets media start without a press, through the
 * shell's own plugin — #2357, the owner's ruling of 2026-11-08: the menus'
 * music starts in the Android app with no first tap.
 *
 * `apps/web/src/shell/menu-music.ts` §`MenuMusicDeps.autoplay` takes the
 * answer; `main.tsx` asks it behind `isNativeShell`, so a browser and the demo
 * never ask and keep the first-press rule. It does not import that module, for
 * `camera/camera.ts`' reason: `apps/web` already depends on this package.
 *
 * `AutoplayPlugin.java` answers `{ allowed }`, the negation of the WebView's
 * own `getMediaPlaybackRequiresUserGesture()`.
 *
 * ## Bounded, and "no" for anything but a yes
 *
 * The call is raced against {@link AUTOPLAY_CALL_DEADLINE_MILLISECONDS}. A
 * refusal, a missing plugin ("not implemented"), the deadline, or a reply
 * whose `allowed` is not `true` is "no": the loop then waits for a press, as
 * in a browser, which is the safe direction.
 *
 * ## What is NOT verified here
 *
 * ⚠️ `capacitorAutoplayPlugin()` and `AutoplayPlugin.java` run only on a
 * device. CI does not build Android, so what is tested in CI is the mapping
 * below against a scripted plugin and, by reading the Java source
 * (`android/autoplay-source.test.ts`), what the plugin reads.
 */

import { registerPlugin } from '@capacitor/core';

/** The one call this project makes of the plugin. */
export interface AutoplayPlugin {
  /** Whether the WebView lets media start without a user gesture. */
  allowed(): Promise<{ readonly allowed: boolean }>;
}

/** How long the answer may take before it is "no": one read of a WebView setting. */
export const AUTOPLAY_CALL_DEADLINE_MILLISECONDS = 2_000;

/**
 * The real plugin, registered under the name `AutoplayPlugin.java` declares.
 * Constructed rather than exported as a constant, for `ble-client.ts`'s
 * reason: importing this module must have no side effect on the web build.
 */
export function capacitorAutoplayPlugin(): AutoplayPlugin {
  return registerPlugin<AutoplayPlugin>('Autoplay');
}

/** Whether the plugin says yes in time: `true` only for a reply whose `allowed` is `true`. */
export async function capacitorAutoplayAllowed(
  plugin: AutoplayPlugin,
  deadlineMilliseconds = AUTOPLAY_CALL_DEADLINE_MILLISECONDS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('the autoplay call took too long'));
    }, deadlineMilliseconds);
  });
  try {
    const reply = await Promise.race([plugin.allowed(), deadline]);
    return reply.allowed === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
