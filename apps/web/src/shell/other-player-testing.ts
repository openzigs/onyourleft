// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Doubles for the rider's own music player — #2073. Test support only.
 */

import type { OtherPlayerClock } from './other-player';
import type { OtherPlayerKey, OtherPlayerPort } from './other-player-port';

/** A clock a test moves by hand, and the repeating timers it holds. */
export interface ManualOtherPlayerClock {
  readonly clock: OtherPlayerClock;
  /** Move the clock on and run every timer due, once per interval passed. */
  advance(milliseconds: number): void;
  /** How many repeating timers are running. */
  running(): number;
}

export function manualOtherPlayerClock(): ManualOtherPlayerClock {
  let now = 0;
  const timers = new Set<{ readonly every: number; due: number; readonly tick: () => void }>();
  return {
    clock: {
      now: () => now,
      every: (milliseconds, tick) => {
        const timer = { every: milliseconds, due: now + milliseconds, tick };
        timers.add(timer);
        return () => {
          timers.delete(timer);
        };
      },
    },
    advance(milliseconds) {
      const until = now + milliseconds;
      for (;;) {
        const next = [...timers].sort((a, b) => a.due - b.due)[0];
        if (next === undefined || next.due > until) break;
        now = next.due;
        next.due += next.every;
        next.tick();
      }
      now = until;
    },
    running: () => timers.size,
  };
}

/** A port whose readings a test sets, keeping every key it was sent. */
export interface ScriptedOtherPlayerPort {
  readonly port: OtherPlayerPort;
  readonly keys: OtherPlayerKey[];
  /** How many times it was asked whether music is playing. */
  readings(): number;
  /** What the next readings answer. */
  setActive(active: boolean): void;
  /** Make every key from now on fail. */
  failKeys(): void;
}

export function scriptedOtherPlayerPort(active = false): ScriptedOtherPlayerPort {
  const keys: OtherPlayerKey[] = [];
  let playing = active;
  let asked = 0;
  let failing = false;
  return {
    keys,
    port: {
      sendKey: (key) => {
        if (failing) return Promise.reject(new Error('not implemented'));
        keys.push(key);
        return Promise.resolve();
      },
      otherAudioActive: () => {
        asked += 1;
        return Promise.resolve(playing);
      },
    },
    readings: () => asked,
    setActive: (next) => {
      playing = next;
    },
    failKeys: () => {
      failing = true;
    },
  };
}
