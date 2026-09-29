// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import { DEFAULT_PLAUSIBILITY_LIMITS, plausibility } from '@onyourleft/physics';

import { CeilingWatch } from './ceilings.ts';

/** A deterministic trace: a base power with a surge somewhere in it. */
function trace(
  length: number,
  base: number,
  surge: { at: number; seconds: number; watts: number },
) {
  return Array.from({ length }, (_, i) =>
    i >= surge.at && i < surge.at + surge.seconds ? surge.watts : base + ((i * 37) % 23) - 11,
  );
}

function watched(series: readonly number[], mass: number): boolean {
  const watch = new CeilingWatch(mass, DEFAULT_PLAUSIBILITY_LIMITS);
  for (const power of series) watch.record(power);
  return watch.flagged;
}

describe('the room’s rule 2 agrees with @onyourleft/physics’ plausibility', () => {
  const CASES = [
    { what: 'an honest hour', series: trace(3600, 220, { at: 0, seconds: 0, watts: 0 }), mass: 70 },
    {
      what: 'a 5 s sprint over 18 W/kg',
      series: trace(300, 200, { at: 120, seconds: 5, watts: 1300 }),
      mass: 70,
    },
    {
      what: 'a 4 s sprint over 18 W/kg — one second short',
      series: trace(300, 200, { at: 120, seconds: 4, watts: 1300 }),
      mass: 70,
    },
    {
      what: 'a minute over 10 W/kg',
      series: trace(400, 150, { at: 200, seconds: 61, watts: 720 }),
      mass: 70,
    },
    {
      what: '20 minutes over 6.5 W/kg',
      series: trace(1500, 100, { at: 100, seconds: 1200, watts: 470 }),
      mass: 70,
    },
    {
      what: 'an hour over 5.5 W/kg',
      series: trace(3600, 390, { at: 0, seconds: 0, watts: 0 }),
      mass: 70,
    },
    {
      what: 'an hour just under 5.5 W/kg',
      series: trace(3600, 370, { at: 0, seconds: 0, watts: 0 }),
      mass: 70,
    },
  ];

  for (const { what, series, mass } of CASES) {
    it(`gives the same verdict for ${what}`, () => {
      const expected = plausibility(
        series.map((p) => watts(p)),
        kilograms(mass),
      ).flagged;
      expect(watched(series, mass)).toBe(expected);
    });
  }

  it('is not vacuous: the cases above both flag and do not', () => {
    const verdicts = CASES.map(({ series, mass }) => watched(series, mass));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('never clears a flag once raised', () => {
    const watch = new CeilingWatch(70, DEFAULT_PLAUSIBILITY_LIMITS);
    for (let i = 0; i < 5; i += 1) watch.record(1500);
    expect(watch.flagged).toBe(true);
    for (let i = 0; i < 600; i += 1) watch.record(0);
    expect(watch.flagged).toBe(true);
  });

  it('judges no window it cannot fill, as bestMeanPower does', () => {
    const watch = new CeilingWatch(70, {
      ...DEFAULT_PLAUSIBILITY_LIMITS,
      ceilings: [{ durationSeconds: 2.5, wattsPerKilogram: 1 }],
    });
    for (let i = 0; i < 10; i += 1) watch.record(1000);
    expect(watch.flagged).toBe(false);
  });
});
