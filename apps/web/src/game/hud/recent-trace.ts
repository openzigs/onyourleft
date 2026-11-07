// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The last few minutes of power and heart rate, for the HUD's graph — #2078.
 *
 * ## Bounded by construction
 *
 * #2078's first criterion: *bounded memory, a fixed ring of samples*. So the
 * trace is two `Float64Array`s of {@link RECENT_TRACE_SECONDS} slots, made once
 * and written round and round. A four-hour ride and a four-minute one hold the
 * same 2 × 600 numbers; nothing here grows with the ride, which is the whole
 * of what a HUD drawn for hours on a phone can afford.
 *
 * ## One sample a second, and a gap is a gap
 *
 * A slot is a second of the RIDE's clock (the simulation's `elapsed`), taken
 * when that clock passes a whole second — {@link sampleSecond}. A frame that
 * does not cross one adds nothing, so the graph changes at most once a second
 * however fast the game draws (#2078's second criterion), and a paused game,
 * whose clock stands still, adds nothing at all.
 *
 * A reading that is not live is stored as `NaN` and read back as `undefined`:
 * a sensor that dropped is a GAP in the line, never a drawn zero (the third
 * criterion, and #94's rule that a dropped sensor is never a number). A ride
 * that skips seconds — a long frame — fills the seconds it skipped with gaps
 * rather than stretching the line across them.
 */

/** How many seconds the graph shows: ten minutes, the top of #2078's five to ten. */
export const RECENT_TRACE_SECONDS = 600;

/** One second of the graph: each channel's reading, or `undefined` where it was not live. */
export interface TraceSample {
  readonly power: number | undefined;
  readonly heartRate: number | undefined;
}

/** The ring. @see createRecentTrace */
export interface RecentTrace {
  /** How many slots it has. Never changes. */
  readonly capacity: number;
  /** How many seconds have been written, all told — the newest's index plus one. */
  readonly written: number;
  /** The last ride-second written, or `-1` before the first. */
  readonly second: number;
  /** Write the sample for ride-second `second`, filling any skipped seconds with gaps. */
  write(second: number, sample: TraceSample): void;
  /** The held seconds, oldest first, `undefined` where a channel was not live. */
  read(): readonly TraceSample[];
}

/** A ring of `capacity` seconds. */
export function createRecentTrace(capacity = RECENT_TRACE_SECONDS): RecentTrace {
  const power = new Float64Array(capacity).fill(Number.NaN);
  const heartRate = new Float64Array(capacity).fill(Number.NaN);
  let written = 0;
  let last = -1;
  const put = (sample: TraceSample): void => {
    const slot = written % capacity;
    power[slot] = sample.power ?? Number.NaN;
    heartRate[slot] = sample.heartRate ?? Number.NaN;
    written += 1;
  };
  return {
    capacity,
    get written() {
      return written;
    },
    get second() {
      return last;
    },
    write(second: number, sample: TraceSample): void {
      if (!Number.isFinite(second) || second <= last) return;
      // Seconds skipped are gaps, and never more than a ring's worth of them.
      const skipped = last < 0 ? 0 : Math.min(capacity, second - last - 1);
      for (let index = 0; index < skipped; index += 1) {
        put({ power: undefined, heartRate: undefined });
      }
      put(sample);
      last = second;
    },
    read(): readonly TraceSample[] {
      const held = Math.min(written, capacity);
      const first = written - held;
      const out: TraceSample[] = [];
      for (let index = first; index < written; index += 1) {
        const slot = index % capacity;
        const p = power[slot] as number;
        const h = heartRate[slot] as number;
        out.push({
          power: Number.isNaN(p) ? undefined : p,
          heartRate: Number.isNaN(h) ? undefined : h,
        });
      }
      return out;
    },
  };
}

/**
 * The whole ride-second a frame at `elapsed` seconds falls in, or `undefined`
 * when it is the same second as `last` — so a caller writes at most once a
 * second. Pure.
 */
export function sampleSecond(last: number, elapsed: number): number | undefined {
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  const second = Math.floor(elapsed);
  return second > last ? second : undefined;
}
