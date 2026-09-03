// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { positionAt, RIDE_START_UNIX_SECONDS, rideSamples, wrapLongitudeE7 } from './ride';
import { ANTIMERIDIAN_TRACK, NULL_ISLAND_TRACK, POINT_NEMO_TRACK } from './fit-fixtures';

describe('wrapLongitudeE7', () => {
  it('leaves a longitude inside the turn alone, including exactly +180', () => {
    expect(wrapLongitudeE7(0)).toBe(0);
    expect(wrapLongitudeE7(1_799_999_999)).toBe(1_799_999_999);
    expect(wrapLongitudeE7(1_800_000_000)).toBe(1_800_000_000);
    expect(wrapLongitudeE7(-1_800_000_000)).toBe(-1_800_000_000);
  });

  it('wraps one step past +180 to just inside -180, not to +180 again', () => {
    expect(wrapLongitudeE7(1_800_000_001)).toBe(-1_799_999_999);
    expect(wrapLongitudeE7(-1_800_000_001)).toBe(1_799_999_999);
  });

  it('wraps a value more than a full turn out', () => {
    expect(wrapLongitudeE7(1_800_000_000 + 3_600_000_000)).toBe(1_800_000_000);
  });
});

describe('the tracks', () => {
  it('walks the NULL-ISLAND track through both signs of both coordinates', () => {
    const latitudes = Array.from({ length: 120 }, (_unused, index) =>
      positionAt(NULL_ISLAND_TRACK, index),
    );
    expect(latitudes.some((position) => position.latitude < 0)).toBe(true);
    expect(latitudes.some((position) => position.latitude > 0)).toBe(true);
    expect(latitudes.some((position) => position.longitude < 0)).toBe(true);
    expect(latitudes.some((position) => position.longitude > 0)).toBe(true);
  });

  it('crosses the antimeridian: +180 exactly, then a negative longitude', () => {
    const longitudes = Array.from(
      { length: 40 },
      (_unused, index) => positionAt(ANTIMERIDIAN_TRACK, index).longitude as number,
    );
    expect(longitudes).toContain(180);
    expect(longitudes.at(0)).toBeGreaterThan(179);
    expect(longitudes.at(-1)).toBeLessThan(-179);
  });

  it('keeps both Point Nemo coordinates negative for the whole ride', () => {
    for (let index = 0; index < 60; index += 1) {
      const position = positionAt(POINT_NEMO_TRACK, index);
      expect(position.latitude).toBeLessThan(0);
      expect(position.longitude).toBeLessThan(0);
    }
  });
});

describe('rideSamples', () => {
  it('is a pure function of its specification, so two runs agree exactly', () => {
    const first = rideSamples({ sampleCount: 50, track: NULL_ISLAND_TRACK });
    const second = rideSamples({ sampleCount: 50, track: NULL_ISLAND_TRACK });
    expect(first).toEqual(second);
  });

  it('starts at the recorded constant instant and advances one second a sample', () => {
    const samples = rideSamples({ sampleCount: 3, track: undefined });
    // 2024-06-15T09:00:00Z.
    expect(RIDE_START_UNIX_SECONDS).toBe(1718442000);
    expect(new Date(RIDE_START_UNIX_SECONDS * 1000).toISOString()).toBe('2024-06-15T09:00:00.000Z');
    const timestamps = samples.map((sample) => sample.fitTimestamp);
    expect(timestamps[1]).toBe((timestamps[0] ?? 0) + 1);
    expect(timestamps[2]).toBe((timestamps[0] ?? 0) + 2);
  });

  it('omits position entirely when there is no track, rather than zeroing it', () => {
    for (const sample of rideSamples({ sampleCount: 10, track: undefined })) {
      expect(sample.position).toBeUndefined();
    }
  });

  it('keeps every channel inside the range of the field that carries it', () => {
    for (const sample of rideSamples({ sampleCount: 2000, track: NULL_ISLAND_TRACK })) {
      expect(sample.heartRate).toBeGreaterThanOrEqual(0);
      expect(sample.heartRate).toBeLessThanOrEqual(0xfe);
      expect(sample.cadence).toBeLessThanOrEqual(0xfe);
      expect(sample.power).toBeLessThanOrEqual(0xfffe);
      expect(sample.speedMillimetresPerSecond).toBeLessThanOrEqual(0xfffe);
      expect(sample.fitAltitude).toBeLessThanOrEqual(0xfffe);
      expect(sample.temperature).toBeGreaterThanOrEqual(-0x7f);
      expect(sample.temperature).toBeLessThanOrEqual(0x7e);
    }
  });

  it('continues the channels across a pause instead of restarting them', () => {
    const before = rideSamples({ sampleCount: 60, track: NULL_ISLAND_TRACK });
    const after = rideSamples({
      sampleCount: 60,
      track: NULL_ISLAND_TRACK,
      startOffsetSeconds: 359,
      channelOffset: 59,
    });
    expect(after[0]?.heartRate).toBe(before[59]?.heartRate);
    expect(after[0]?.position).toEqual(before[59]?.position);
    expect((after[0]?.fitTimestamp ?? 0) - (before[59]?.fitTimestamp ?? 0)).toBe(300);
  });
});
