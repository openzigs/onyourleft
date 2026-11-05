// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The time of day, kept current — #2072. What the ride HUD's *Clock* and the
 * Ride screen's say (`format.ts` §`formatTimeOfDay`).
 *
 * ⚠️ **A wall clock, and never a clock of the ride's.** The ride's own times — moving and elapsed — are the recorder's, worked out
 * from the instants its readings carry (`game/hud/fields.ts`
 * §`HudInput.elapsedSeconds`), and nothing here may feed them. This is the
 * device's time and nothing else: it is read from `Date`, and the timer only
 * says when to read it again.
 *
 * Re-read at the next turn of the minute rather than on an interval, so the
 * figure changes within a few milliseconds of the device's own clock and not
 * up to a minute after it — `HH:MM` has no seconds to hide the lag in. A game
 * that is paused does not re-render (`GameView.tsx` §`useRideMovingSeconds`),
 * so the HUD cannot rely on its frames to move this either.
 */

import { useEffect, useState } from 'react';

/** How long after `now` the minute next turns, in milliseconds. Never 0. */
function untilNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

/** The device's time now, re-read each time the minute turns. */
export function useTimeOfDay(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (from: Date): void => {
      timer = setTimeout(() => {
        const next = new Date();
        setNow(next);
        schedule(next);
      }, untilNextMinute(from));
    };
    schedule(new Date());
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return now;
}
