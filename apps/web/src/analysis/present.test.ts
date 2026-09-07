// SPDX-License-Identifier: AGPL-3.0-or-later

import { powerZones, seconds, watts, type TimeInZones, type Zone } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { barWidth, coverageNote, durationLabel, zoneRange, zoneRows, zoneShare } from './present';

const ZONES = powerZones(watts(250));

/**
 * One zone, or a failure that names the index.
 *
 * `ZONES[2]` is `Zone | undefined` and a `!` here would turn a wrong index into
 * an assertion about `undefined` that reads like a formatting bug.
 */
function zoneAt(index: number): Zone {
  const zone = ZONES.at(index);
  if (zone === undefined) {
    throw new Error(`the power zone list has no entry at ${String(index)}`);
  }
  return zone;
}

describe('zoneRange — rounding must not open a gap between two rows', () => {
  it('shows the same rounded number as one zone’s top and the next one’s bottom', () => {
    // 0.91 × 250 = 227.5, which is zone 3's upper bound AND zone 4's lower
    // bound. Rounding the two independently is how a table comes to read
    // "190–227" above "228–265", with 227.6 W in no zone at all. They agree
    // here because they are the same number rounded once.
    const third = zoneAt(2);
    const fourth = zoneAt(3);
    expect(third.upper).toBe(fourth.lower);
    expect(zoneRange(third, 'W')).toBe('190–228 W');
    expect(zoneRange(fourth, 'W')).toBe('228–265 W');
  });

  it('starts the bottom zone at zero', () => {
    expect(zoneRange(zoneAt(0), 'W')).toBe('0–140 W');
  });

  it('says the top zone is open in words rather than with a symbol', () => {
    // "∞" is announced as "infinity" by a screen reader and read as a bug by a
    // rider. 1.51 × 250 = 377.5.
    expect(zoneRange(zoneAt(-1), 'W')).toBe('378 W and above');
  });

  it('carries whatever unit it is given, so heart rate is not watts', () => {
    expect(zoneRange(zoneAt(1), 'bpm')).toBe('140–190 bpm');
  });
});

describe('zoneShare', () => {
  it('is a share of the covered time, so the column adds to a hundred', () => {
    expect(zoneShare(50, 200)).toBe('25%');
    expect(zoneShare(200, 200)).toBe('100%');
  });

  it('answers zero rather than NaN when nothing was covered', () => {
    // A ride whose sensor said nothing has a real answer to "how much of it was
    // in zone 3", and it is none of it.
    expect(zoneShare(0, 0)).toBe('0%');
  });
});

describe('barWidth', () => {
  it('is the share as a CSS percentage', () => {
    expect(barWidth(50, 200)).toBe('25%');
  });

  it('is zero width rather than NaN% for an uncovered ride', () => {
    // `width: NaN%` is an invalid declaration the browser drops, which leaves
    // the bar at its natural width — a full bar for a ride with no data.
    expect(barWidth(0, 0)).toBe('0%');
  });
});

describe('coverageNote', () => {
  it('says nothing when the channel covered the whole ride', () => {
    expect(coverageNote(3600, 3600)).toBeUndefined();
    // Covered can exceed moving time — an ERG trainer holds a target while the
    // rider is off the bike. That is not a shortfall to explain.
    expect(coverageNote(3700, 3600)).toBeUndefined();
  });

  it('explains a shortfall rather than leaving the total short', () => {
    const note = coverageNote(3400, 3600);
    expect(note).toContain('94%');
    expect(note).toContain('56:40');
    expect(note).toContain('1:00:00');
  });

  it('says nothing for a ride with no moving time to compare against', () => {
    expect(coverageNote(0, 0)).toBeUndefined();
  });
});

describe('durationLabel — the name of an effort, not a clock reading', () => {
  it.each([
    [1, '1s'],
    [30, '30s'],
    [60, '1min'],
    [300, '5min'],
    [1200, '20min'],
    [2700, '45min'],
    [3600, '1h'],
    [5400, '1.5h'],
    [7200, '2h'],
  ])('renders %i seconds as %s', (input, expected) => {
    expect(durationLabel(input)).toBe(expected);
  });

  it('keeps a fraction rather than rounding two durations to one label', () => {
    // 90 s and 120 s must not both read "2min": a personal-best table with two
    // rows carrying the same label is unreadable.
    expect(durationLabel(90)).toBe('1.5min');
    expect(durationLabel(120)).toBe('2min');
  });
});

describe('zoneRows', () => {
  const time: TimeInZones = {
    perZone: [
      seconds(100),
      seconds(0),
      seconds(300),
      seconds(0),
      seconds(0),
      seconds(0),
      seconds(0),
    ],
    covered: seconds(400),
  };

  it('pairs each zone with its own total, in order', () => {
    const rows = zoneRows(ZONES, time, 'W');

    expect(rows).toHaveLength(7);
    expect(rows[0]?.name).toBe('Recovery');
    expect(rows[0]?.time).toBe('1:40');
    expect(rows[0]?.share).toBe('25%');
    expect(rows[2]?.time).toBe('5:00');
    expect(rows[2]?.share).toBe('75%');
    expect(rows[1]?.share).toBe('0%');
  });

  it('tolerates a totals array shorter than the zone list', () => {
    // Not reachable through `timeInZones`, which fills to the zone count — but
    // this function takes the two separately, and a `perZone[index]!` here
    // would turn a future mismatch into a crash on a rider's screen rather
    // than a row of zeros.
    const short: TimeInZones = { perZone: [seconds(10)], covered: seconds(10) };
    const rows = zoneRows(ZONES, short, 'W');

    expect(rows).toHaveLength(7);
    expect(rows[6]?.time).toBe('0:00');
  });
});
