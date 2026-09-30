// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RaceResultRow } from '../net/rooms-port';
import { flagText, raceResultLines, raceTime, UNNAMED_RIDER } from './race-result';

const row = (overrides: Partial<RaceResultRow>): RaceResultRow => ({
  place: 1,
  displayName: 'Ann',
  you: false,
  finishMs: 3_600_000,
  wattsPerKilogram: 4.44,
  flags: [],
  ...overrides,
});

/** "N W" that is not "N W/kg": a power. */
const A_POWER = /\d\s*W\b(?!\/kg)/;

describe('a race’s result in words — #785', () => {
  it('puts W/kg beside every other rider and never watts, even given the rider’s own watts', () => {
    const lines = raceResultLines(
      [
        row({ flags: [{ durationSeconds: 5, overWattsPerKilogram: 18 }] }),
        row({ place: 2, displayName: 'Bea', wattsPerKilogram: 3.95 }),
        row({ place: 3, displayName: 'Me', you: true, wattsPerKilogram: 3.5 }),
      ],
      262,
    );
    for (const line of lines.filter((each) => !each.you)) {
      for (const text of [line.figure ?? '', ...line.flags]) expect(text).not.toMatch(A_POWER);
    }
    expect(lines[0]?.figure).toBe('4.4 W/kg');
    expect(lines[0]?.flags).toEqual(['Flagged: over 18.0 W/kg for 5 seconds.']);
  });

  it('shows the rider both figures on their OWN line — both are theirs', () => {
    const [mine] = raceResultLines([row({ you: true, wattsPerKilogram: 3.5 })], 262.4);
    expect(mine?.who).toBe('You');
    expect(mine?.figure).toBe('3.5 W/kg, 262 W');
    expect(raceResultLines([row({ you: true })])[0]?.figure).toBe('4.4 W/kg');
  });

  it('names a rider with no name — erased, or not one this rider may see — as “a rider”, and a non-finisher as not finishing', () => {
    const [gone, dnf] = raceResultLines([
      row({ place: 2, displayName: null, finishMs: null, wattsPerKilogram: null }),
      row({ place: null, displayName: 'Cat', finishMs: null }),
    ]);
    expect(gone).toMatchObject({
      place: '2nd',
      who: UNNAMED_RIDER,
      time: undefined,
      figure: undefined,
    });
    expect(dnf).toMatchObject({ place: 'Did not finish', who: 'Cat', time: undefined });
  });

  it('says times and windows as a person would', () => {
    expect(raceTime(61_400)).toBe('1:01');
    expect(raceTime(3_725_000)).toBe('1:02:05');
    expect(flagText({ durationSeconds: 60, overWattsPerKilogram: 10 })).toBe(
      'Flagged: over 10.0 W/kg for a minute.',
    );
    expect(flagText({ durationSeconds: 1200, overWattsPerKilogram: 6.5 })).toBe(
      'Flagged: over 6.5 W/kg for 20 minutes.',
    );
    expect(flagText({ durationSeconds: 3600, overWattsPerKilogram: 5.5 })).toBe(
      'Flagged: over 5.5 W/kg for an hour.',
    );
    expect(
      raceResultLines([1, 2, 3, 4, 11, 12, 13, 21, 22].map((place) => row({ place }))).map(
        (l) => l.place,
      ),
    ).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
