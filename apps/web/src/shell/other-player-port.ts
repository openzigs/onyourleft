// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The rider's own music player, another app, from the web client's side** —
 * [#2073](https://github.com/openzigs/onyourleft/issues/2073), spike 0034 and
 * the owner's rulings of 2026-11-05 on it.
 *
 * Play, pause, next and previous, sent as media keys to whichever app Android
 * routes them to, and whether any music is playing. Nothing else: no title,
 * no artist, no app name (ruling 1, no Notification access), so there is no
 * track data on this side to keep on the device or to leak from it.
 *
 * `apps/mobile/src/other-player/` and `OtherPlayerPlugin.java` are the
 * Android half; `main.tsx` composes {@link OtherPlayerPort} from them behind
 * `isNativeShell` on Android only. A browser gets no port at all, because no
 * web API reaches another application's player (spike 0034 §3), and the
 * control is not rendered.
 *
 * A `*-port.ts` so `check:wiring` watches it (docs/agents/wiring-gate.md §4j).
 */

/** The four keys, by the names `OtherPlayerPlugin.java` maps. */
export type OtherPlayerKey = 'play' | 'pause' | 'next' | 'previous';

/** What the Android shell does for the rider's own player. */
export interface OtherPlayerPort {
  /**
   * Send one media key. Resolves once it is sent; rejects when the plugin
   * refuses, is missing or takes too long, which the caller swallows as a
   * press that did nothing.
   */
  sendKey(key: OtherPlayerKey): Promise<void>;
  /**
   * Whether any music is playing on the device. ⚠️ It counts this app's own
   * sound too (spike 0034 §1.3), and a paused player is not playing. `false`
   * for a failure, never a rejection.
   */
  otherAudioActive(): Promise<boolean>;
}

/** The one question the menu music asks of the rider's player: owner ruling 3. */
export interface RiderPlayerInUse {
  /**
   * Whether the rider's own player is in use now, so that our menu music
   * stays silent (ruling 3 of 2026-11-05 on #2073).
   *
   * @unwired the menu music player (#2058, PR #2215) is not on `main` yet, so
   * nothing asks this; wiring it is the follow-up to owner ruling 3 on #2073,
   * which must also keep our own music from reading as the rider's (spike
   * 0034 §1.3).
   */
  riderPlayerInUse(): boolean;
}
