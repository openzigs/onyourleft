// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic page's readout line — #480, pinning #479's fix for the
 * tablet's `frame p50 NaN ms`.
 *
 * The line is read the way the page produces it: a clock ridden past its
 * measurement, with the window taken every frame from then on, exactly as
 * `realistic-harness.ts` does when `?soak=` is unset.
 */

import { describe, expect, it } from 'vitest';

import { MeasurementClock } from './loop';
import { readoutLine, type ReadoutInput } from './reporting';

/** A clock that has published its measurement and gone on riding. */
function measuredClock(): MeasurementClock {
  const clock = new MeasurementClock(1);
  let now = 0;
  clock.frame(now);
  // Past the one-second warm-up and through a short window…
  while (now < 3_000) {
    now += 16;
    clock.frame(now);
  }
  clock.take();
  // …and on, with the page taking the window every frame after it.
  for (let each = 0; each < 30; each += 1) {
    now += 16;
    clock.frame(now);
    clock.take();
  }
  return clock;
}

const line = (clock: MeasurementClock, patch: Partial<ReadoutInput> = {}): string =>
  readoutLine({
    world: 'realistic',
    rung: 'realistic',
    frameCap: 'display',
    phase: 'measured',
    clock,
    buffer: [2560, 1600],
    notice: undefined,
    ...patch,
  });

describe('the realistic page’s readout line — #480', () => {
  it('shows a frame time after the measurement has been published — the tablet’s NaN', () => {
    const clock = measuredClock();
    // The measurement window is empty at this point, every frame.
    expect(clock.samples).toEqual([]);
    const shown = line(clock);
    expect(shown).toContain('frame p50 16.0 ms');
    expect(shown).not.toMatch(/NaN|not timed/);
  });

  it('says so rather than NaN before anything has been timed', () => {
    const clock = new MeasurementClock(3);
    clock.frame(0);
    expect(line(clock, { phase: 'warming up' })).toContain('frame p50 — (not timed yet)');
  });

  it('carries the world, the rung, its frame cap, the phase, the buffer and the notice', () => {
    expect(
      line(measuredClock(), {
        world: 'stylised',
        rung: 'target',
        frameCap: 30,
        notice: 'The world did not load.',
      }),
    ).toBe(
      'stylised world · target · capped at 30 fps · measured · frame p50 16.0 ms · buffer 2560×1600\nThe world did not load.',
    );
    expect(line(measuredClock())).toContain('realistic · display rate · measured');
  });
});
