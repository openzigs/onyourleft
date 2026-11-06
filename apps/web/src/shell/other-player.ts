// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The rider's own music player: when the header offers its controls, and
 * what a press sends** — [#2073](https://github.com/openzigs/onyourleft/issues/2073),
 * spike 0034 and the owner's rulings of 2026-11-05 on it.
 *
 * ## When the control shows
 *
 * - **Only inside the Android shell** ({@link otherPlayerOffered}). A browser
 *   cannot reach another app's player (spike 0034 §3) and there is no iOS path
 *   (CLAUDE.md §6), so `main.tsx` makes no {@link OtherPlayer} there and the
 *   header renders nothing.
 * - **Once other audio has been seen, for the rest of the visit** (ruling 2).
 *   `isMusicActive()` turns false the moment the rider pauses (spike 0034
 *   §1.3), so a control shown only while music plays would vanish under the
 *   finger that paused it. {@link OtherPlayerSnapshot.seen} never goes back to
 *   `false`, and is held in memory only: a reload is a new visit.
 * - **Seen means two readings in a row**, {@link OTHER_PLAYER_POLL_MILLISECONDS}
 *   apart. `isMusicActive()` counts our own sound too, and a menu sound
 *   (#946) is a fraction of a second: one reading could be ours, two a poll
 *   apart are a player.
 * - **Never on a ride route** (ruling 2): `AppShell` neither renders it nor
 *   polls there, so the ride's own cues are never read as the rider's player.
 *
 * ## What a press sends
 *
 * The explicit *play* or *pause* key, chosen from what the control believes
 * the player is doing, rather than the toggle, which could invert the rider's
 * intent (spike 0034 §1.2). The belief is the latest reading, except that a
 * press is believed over the readings for {@link PRESS_SETTLE_MILLISECONDS},
 * while a player starts or stops. *Next* and *previous* change no belief.
 * A key that could not be sent leaves the belief as it was.
 *
 * ## No track data
 *
 * The port answers one boolean, so nothing here knows what is playing.
 * `privacy/other-player-stays-on-device.test.ts` reads back the ride record,
 * an export and a sync payload after the control has been used.
 */

import { isNativeShell, shellPlatform, type CapacitorGlobal } from '../support/capacitor';

import type { OtherPlayerKey, OtherPlayerPort, RiderPlayerInUse } from './other-player-port';

/** How often the header asks whether music is playing, while it may show. */
export const OTHER_PLAYER_POLL_MILLISECONDS = 4_000;

/** How long a press is believed over the readings, while a player starts or stops. */
export const PRESS_SETTLE_MILLISECONDS = 3_000;

/** What the header draws from. */
export interface OtherPlayerSnapshot {
  /** Other audio was seen this visit: the control shows. Never goes back. */
  readonly seen: boolean;
  /** What the control believes the player is doing: *Pause* when `true`, *Play* when not. */
  readonly playing: boolean;
}

/** The three presses the header offers. */
export type OtherPlayerPress = 'play-pause' | 'next' | 'previous';

/** A clock and a repeating timer, so a test can drive both. */
export interface OtherPlayerClock {
  now(): number;
  /** Call `tick` every `milliseconds`. @returns the stop. */
  every(milliseconds: number, tick: () => void): () => void;
}

/** The page's own clock and `setInterval`. */
export const BROWSER_OTHER_PLAYER_CLOCK: OtherPlayerClock = {
  now: () => Date.now(),
  every: (milliseconds, tick) => {
    const handle = setInterval(tick, milliseconds);
    return () => {
      clearInterval(handle);
    };
  },
};

/**
 * Whether this platform offers the rider's own player at all: the Android
 * shell, and nothing else. `false` for every browser, the same bundle served
 * by Capacitor's own tooling included (`support/capacitor.ts`).
 */
export function otherPlayerOffered(capacitor: CapacitorGlobal | undefined): boolean {
  return isNativeShell(capacitor) && shellPlatform(capacitor) === 'android';
}

const NOTHING_SEEN: OtherPlayerSnapshot = { seen: false, playing: false };

/** The visit's one view of the rider's own player. */
export class OtherPlayer implements RiderPlayerInUse {
  readonly #port: OtherPlayerPort;
  readonly #clock: OtherPlayerClock;
  #snapshot: OtherPlayerSnapshot = NOTHING_SEEN;
  readonly #listeners = new Set<() => void>();
  /** The previous reading was "playing": the next one in a row is a sighting. */
  #lastReadingActive = false;
  /** When the last press was made, or `-Infinity`. */
  #pressedAt = Number.NEGATIVE_INFINITY;
  #polling = false;

  constructor(port: OtherPlayerPort, clock: OtherPlayerClock = BROWSER_OTHER_PLAYER_CLOCK) {
    this.#port = port;
    this.#clock = clock;
  }

  /** For `useSyncExternalStore`: the same object until something changes. */
  readonly getSnapshot = (): OtherPlayerSnapshot => this.#snapshot;

  /** For `useSyncExternalStore`. @returns the unsubscribe. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  riderPlayerInUse(): boolean {
    return this.#snapshot.playing;
  }

  /**
   * Ask now, and every {@link OTHER_PLAYER_POLL_MILLISECONDS} until stopped.
   * `AppShell` calls it while the control may show: not on a ride route.
   *
   * @returns the stop.
   */
  watch(): () => void {
    void this.poll();
    const stop = this.#clock.every(OTHER_PLAYER_POLL_MILLISECONDS, () => {
      void this.poll();
    });
    return () => {
      stop();
      // A gap in the readings is not two in a row.
      this.#lastReadingActive = false;
    };
  }

  /** One reading. A reading still in flight is not asked again. */
  async poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    let active: boolean;
    try {
      active = (await this.#port.otherAudioActive()) === true;
    } catch {
      active = false;
    } finally {
      this.#polling = false;
    }
    const sighted = active && this.#lastReadingActive;
    this.#lastReadingActive = active;
    const settling = this.#clock.now() - this.#pressedAt < PRESS_SETTLE_MILLISECONDS;
    this.#set({
      seen: this.#snapshot.seen || sighted,
      playing: settling ? this.#snapshot.playing : active,
    });
  }

  /** A press on the header's control. Never rejects: a key not sent is a press that did nothing. */
  async press(press: OtherPlayerPress): Promise<void> {
    const before = this.#snapshot;
    let key: OtherPlayerKey;
    if (press === 'play-pause') {
      key = before.playing ? 'pause' : 'play';
      this.#pressedAt = this.#clock.now();
      this.#set({ ...before, playing: !before.playing });
    } else {
      key = press;
    }
    try {
      await this.#port.sendKey(key);
    } catch {
      if (press === 'play-pause') {
        this.#pressedAt = Number.NEGATIVE_INFINITY;
        this.#set({ ...this.#snapshot, playing: before.playing });
      }
    }
  }

  #set(next: OtherPlayerSnapshot): void {
    if (next.seen === this.#snapshot.seen && next.playing === this.#snapshot.playing) return;
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }
}
