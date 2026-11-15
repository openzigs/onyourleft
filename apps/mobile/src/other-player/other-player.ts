// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's own music player, another app, through the shell's own plugin —
 * #2073, spike 0034 and the owner's rulings of 2026-11-05 on it.
 *
 * `apps/web/src/shell/other-player-port.ts` declares what the client asks;
 * this is the Android answer. It does not implement that interface by name,
 * for `camera/camera.ts`' reason: `apps/web` already depends on this package
 * and an import back would be a workspace cycle. `main.tsx` composes the port
 * from {@link capacitorOtherPlayer} behind `isNativeShell` on Android.
 *
 * ## Every call is bounded
 *
 * A plugin call that never settles would leave a press with no end, or a
 * poll that never polls again. Each is raced against
 * {@link OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS}: a key not sent by then
 * rejects, and a reading not given by then is "nothing playing".
 *
 * ## Only a boolean crosses
 *
 * `OtherPlayerPlugin.java` answers `{ active }` and nothing else, and reads no
 * title, artist, artwork or app name (spike 0034 §2.4, owner ruling 1). This
 * side keeps only `active === true` of whatever the reply holds, so even a
 * reply that carried more would hand the client one boolean (spike 0034 §4).
 *
 * ## What is NOT verified here
 *
 * ⚠️ `capacitorOtherPlayerPlugin()` and `OtherPlayerPlugin.java` run only on a
 * device. CI does not build Android, so what is tested in CI is the mapping
 * below against a scripted plugin and, by reading the Java source
 * (`android/other-player-source.test.ts`), the keys it sends. Whether Spotify,
 * YouTube Music and a podcast app obey them is spike 0034 §7's device rows.
 */

import { registerPlugin } from '@capacitor/core';

/** The four keys the plugin sends, by the names `OtherPlayerPlugin.java` maps. */
export type OtherPlayerKey = 'play' | 'pause' | 'next' | 'previous';

/** The two calls this project makes of the plugin. */
export interface OtherPlayerPlugin {
  /** Send one media key, down then up. Rejects a name that is not one of the four. */
  sendKey(options: { readonly key: OtherPlayerKey }): Promise<void>;
  /** `AudioManager.isMusicActive()`, which counts this app's own sound too. */
  otherAudioActive(): Promise<{ readonly active: boolean }>;
}

/** How long a call may take before it is given up: a key is one binder call, a reading another. */
export const OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS = 2_000;

/**
 * The real plugin, registered under the name `OtherPlayerPlugin.java`
 * declares. Constructed rather than exported as a constant, for
 * `ble-client.ts`'s reason: importing this module must have no side effect on
 * the web build.
 */
export function capacitorOtherPlayerPlugin(): OtherPlayerPlugin {
  return registerPlugin<OtherPlayerPlugin>('OtherPlayer');
}

/** The web port's two methods, in its own terms. */
export interface CapacitorOtherPlayer {
  sendKey(key: OtherPlayerKey): Promise<void>;
  otherAudioActive(): Promise<boolean>;
}

/** `promise`, or a rejection once `milliseconds` have passed. */
function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('the music player call took too long'));
    }, milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * The plugin, bounded, in the web port's shape.
 *
 * - `sendKey` resolves once the key is sent and rejects on a refusal, a
 *   missing plugin ("not implemented") or the deadline: the web side's owner
 *   swallows each, as a press that did nothing.
 * - `otherAudioActive` is `true` only for a reply whose `active` is `true`,
 *   and `false` for anything else, a failure or the deadline included.
 */
export function capacitorOtherPlayer(
  plugin: OtherPlayerPlugin,
  deadlineMilliseconds = OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS,
): CapacitorOtherPlayer {
  return {
    sendKey: async (key) => {
      await within(plugin.sendKey({ key }), deadlineMilliseconds);
    },
    otherAudioActive: async () => {
      try {
        const reply = await within(plugin.otherAudioActive(), deadlineMilliseconds);
        return reply.active === true;
      } catch {
        return false;
      }
    },
  };
}
