// SPDX-License-Identifier: AGPL-3.0-or-later

import { seconds, unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  distanceAt,
  distanceAxis,
  distanceProfile,
  lapAt,
  lapBands,
  timeAxis,
  TIME_AXIS_TITLE,
} from './axis';
import { stubLap } from './testing';

const km = (metres: number): string => `${(metres / 1000).toFixed(1)} km`;

describe('the time axis — #2068, #2081', () => {
  it('places a moment by its share of the ride, and finds the moment at a place', () => {
    const axis = timeAxis(1200);
    expect(axis.kind).toBe('time');
    expect(axis.title).toBe(TIME_AXIS_TITLE);
    expect(axis.ticks).toStrictEqual(['0:00', '10:00', '20:00']);
    expect(axis.fractionAt(300)).toBe(0.25);
    expect(axis.secondsAt(0.25)).toBe(300);
    // Clamped at both ends: a tap past the drawing's edge is the ride's end.
    expect(axis.fractionAt(5000)).toBe(1);
    expect(axis.secondsAt(-0.5)).toBe(0);
  });

  it('draws everything at the left edge of a ride with no length, rather than dividing by it', () => {
    expect(timeAxis(0).fractionAt(10)).toBe(0);
  });
});

describe('the distance ridden, summed from the speed channel — #2081', () => {
  it('adds a sample’s distance at each step it ends in', () => {
    const profile = distanceProfile(
      Array.from({ length: 100 }, () => 10),
      1,
      10,
    );
    expect(profile.secondsPerStep).toBe(10);
    expect(profile.metres).toStrictEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('takes the share of a sample that falls before a step’s boundary, so the total is whole', () => {
    // Three seconds at 10 m/s in two steps of a second and a half.
    const profile = distanceProfile([10, 10, 10], 1, 2);
    expect(profile.secondsPerStep).toBe(1.5);
    expect(profile.metres).toStrictEqual([0, 15, 30]);
  });

  it('adds no distance across a gap: nothing was measured there', () => {
    const profile = distanceProfile([10, undefined, undefined, 10], 1, 4);
    expect(profile.metres).toStrictEqual([0, 10, 10, 10, 20]);
  });

  it('counts each sample for its own interval', () => {
    expect(distanceProfile([10, 10], 2, 2).metres).toStrictEqual([0, 20, 40]);
  });

  it('reads the distance between two steps on the straight line between them', () => {
    const profile = distanceProfile(
      Array.from({ length: 100 }, () => 10),
      1,
      10,
    );
    expect(distanceAt(profile, 15)).toBe(150);
    expect(distanceAt(profile, 0)).toBe(0);
    expect(distanceAt(profile, 9999)).toBe(1000);
  });
});

describe('the distance axis — #2081', () => {
  // Ten minutes at 10 m/s, five stopped, ten more at 10 m/s: 12 km.
  const speeds = [
    ...Array.from({ length: 600 }, () => 10),
    ...Array.from({ length: 300 }, () => 0),
    ...Array.from({ length: 600 }, () => 10),
  ];
  const profile = distanceProfile(speeds, 1, 1500);
  const axis = distanceAxis(profile, 'Distance ridden', km);

  it('labels its start, middle and end in the rider’s distance', () => {
    expect(axis?.kind).toBe('distance');
    expect(axis?.title).toBe('Distance ridden');
    expect(axis?.ticks).toStrictEqual(['0.0 km', '6.0 km', '12.0 km']);
  });

  it('draws a stop as no ground covered, and its moments at one place', () => {
    expect(axis?.fractionAt(600)).toBe(0.5);
    expect(axis?.fractionAt(750)).toBe(0.5);
    expect(axis?.fractionAt(900)).toBe(0.5);
    expect(axis?.fractionAt(1500)).toBe(1);
  });

  it('finds the moment drawn at a place: the inverse of where a moment is drawn', () => {
    for (const moment of [0, 120, 333, 1000, 1499]) {
      const fraction = axis?.fractionAt(moment) ?? Number.NaN;
      expect(axis?.fractionAt(axis.secondsAt(fraction))).toBeCloseTo(fraction, 9);
    }
    expect(axis?.secondsAt(0.25)).toBeCloseTo(300, 9);
    // Halfway is first reached when the stop begins.
    expect(axis?.secondsAt(0.5)).toBeCloseTo(600, 9);
    expect(axis?.secondsAt(1)).toBeCloseTo(1500, 9);
    expect(axis?.secondsAt(0)).toBe(0);
  });

  it('is not offered for a ride whose speed covers no ground', () => {
    expect(distanceAxis(distanceProfile([0, 0, 0], 1), 'Distance ridden', km)).toBeUndefined();
    expect(distanceAxis(distanceProfile([], 1), 'Distance ridden', km)).toBeUndefined();
  });
});

describe('the laps, as stretches of the ride’s clock — #2081', () => {
  const started = unixSeconds(1_760_000_000);
  const laps = [stubLap(0), stubLap(1), stubLap(2)];

  it('starts each lap at its own moment of the stream clock, numbered from one', () => {
    expect(lapBands(laps, started, 1800)).toStrictEqual([
      { number: 1, from: 0, to: 600 },
      { number: 2, from: 600, to: 1200 },
      { number: 3, from: 1200, to: 1800 },
    ]);
  });

  it('clips a lap to the ride, and leaves out one wholly outside it', () => {
    expect(lapBands(laps, started, 900)).toStrictEqual([
      { number: 1, from: 0, to: 600 },
      { number: 2, from: 600, to: 900 },
    ]);
    // Streams that began five minutes after the first lap did.
    expect(
      lapBands([stubLap(0, { elapsedTime: seconds(200) })], unixSeconds(1_760_000_300), 600),
    ).toStrictEqual([]);
  });

  it('gives the moment two laps share to the lap that starts there', () => {
    const bands = lapBands(laps, started, 1800);
    expect(lapAt(bands, 0)?.number).toBe(1);
    expect(lapAt(bands, 599)?.number).toBe(1);
    expect(lapAt(bands, 600)?.number).toBe(2);
    expect(lapAt(bands, 1800)?.number).toBe(3);
    expect(lapAt(bands, 1801)).toBeUndefined();
    expect(lapAt([], 10)).toBeUndefined();
  });
});
