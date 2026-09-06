// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #50's fifth acceptance criterion, and ADR 0004 decision B.
 *
 * The criterion asks that the untruncated track *not be present in the payload
 * at all*, asserted on the raw payload rather than on what is drawn. Phase 1
 * has no network, so the payload is the value {@link sharedTrack} returns — the
 * thing that crosses from the data layer into the component tree. Every
 * assertion below reads that value, and the central one walks the **whole**
 * structure looking for a withheld coordinate rather than checking the segments
 * it expects to find: a leak in a field nobody thought to check is exactly the
 * leak this criterion is about.
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  metres,
  unixSeconds,
  type DegreesLatitude,
  type DegreesLongitude,
} from '@onyourleft/domain';
import { athleteId, privacyZoneId, type PrivacyZoneRecord, type Samples } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { sharedTrack, TRIM_JITTER_FRACTION, trimRadius, type SharedTrack } from './privacy';

const ATHLETE = athleteId('athlete-a');

/** Home, near enough. A real place so the numbers are the size real numbers are. */
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

function zone(overrides: Partial<PrivacyZoneRecord> = {}): PrivacyZoneRecord {
  return {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
    ...overrides,
  };
}

/**
 * A track heading due north from `HOME`, one point every `stepMetres`.
 *
 * Due north so the distance from the centre is the latitude offset and nothing
 * else, which makes "the first point outside 500 m" a number this file can
 * state rather than one it has to discover.
 */
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

function northFrom(count: number, stepMetres: number, from = HOME) {
  const latitude: (DegreesLatitude | undefined)[] = [];
  const longitude: (DegreesLongitude | undefined)[] = [];
  for (let index = 0; index < count; index += 1) {
    latitude.push(
      degreesLatitude(from.latitude + (index * stepMetres) / METRES_PER_DEGREE_LATITUDE),
    );
    longitude.push(from.longitude);
  }
  return {
    latitude: latitude as Samples<'latitude'>,
    longitude: longitude as Samples<'longitude'>,
  };
}

/** Every coordinate anywhere in the returned structure, however it is nested. */
function everyPositionIn(track: SharedTrack): readonly { latitude: number; longitude: number }[] {
  const found: { latitude: number; longitude: number }[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value as unknown[]) {
        walk(entry);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.latitude === 'number' && typeof record.longitude === 'number') {
      found.push({ latitude: record.latitude, longitude: record.longitude });
    }
    for (const entry of Object.values(record)) {
      walk(entry);
    }
  };
  walk(track);
  return found;
}

describe('trimRadius — the jitter ADR 0004 decision B requires', () => {
  it('is deterministic in the activity and the zone', () => {
    // Not "stable within a render". Re-emitting the same activity twice with
    // two different draws hands an observer two constraints instead of one,
    // which the ADR records as worse than no jitter at all.
    const first = trimRadius(metres(500), 'ride-1', 'home');
    const second = trimRadius(metres(500), 'ride-1', 'home');
    expect(second).toBe(first);
  });

  it('differs between two rides through the same zone', () => {
    expect(trimRadius(metres(500), 'ride-1', 'home')).not.toBe(
      trimRadius(metres(500), 'ride-2', 'home'),
    );
  });

  it('differs between two zones on the same ride', () => {
    expect(trimRadius(metres(500), 'ride-1', 'home')).not.toBe(
      trimRadius(metres(500), 'ride-1', 'work'),
    );
  });

  it('keys the pair rather than their concatenation', () => {
    // ("ab", "c") and ("a", "bc") must not collide. Without a separator in the
    // key they would, and two zones could silently share a draw.
    expect(trimRadius(metres(500), 'ab', 'c')).not.toBe(trimRadius(metres(500), 'a', 'bc'));
  });

  it('stays inside the stated fraction, in both directions', () => {
    const radius = 500;
    for (let index = 0; index < 500; index += 1) {
      const trimmed = trimRadius(metres(radius), `ride-${String(index)}`, 'home');
      expect(trimmed).toBeGreaterThanOrEqual(radius * (1 - TRIM_JITTER_FRACTION));
      expect(trimmed).toBeLessThanOrEqual(radius * (1 + TRIM_JITTER_FRACTION));
    }
  });

  it('is symmetric about the true radius rather than one-sided', () => {
    // The failure the ADR names explicitly: with `u` drawn from `[0, 0.25]`
    // every emitted point lies at or outside `r`, so an observer takes the
    // minimum over many rides and converges on `r` from above with no error
    // term. Both sides have to be populated for the noise to be worth anything.
    const radius = 500;
    let below = 0;
    let above = 0;
    for (let index = 0; index < 500; index += 1) {
      const trimmed = trimRadius(metres(radius), `ride-${String(index)}`, 'home');
      if (trimmed < radius) {
        below += 1;
      }
      if (trimmed > radius) {
        above += 1;
      }
    }
    expect(below).toBeGreaterThan(150);
    expect(above).toBeGreaterThan(150);
  });
});

describe('sharedTrack — what a published copy contains', () => {
  it('withholds every point inside the zone, in the payload rather than the drawing', () => {
    // The criterion, in its strongest form: nothing anywhere in the returned
    // value is inside the trim radius. Walked recursively, so a coordinate
    // added to a future field is caught by this test rather than by a reader.
    const { latitude, longitude } = northFrom(200, 10);
    const track = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone()] });
    const radius = trimRadius(metres(500), 'ride-1', 'home');

    expect(track.trimmedPoints).toBeGreaterThan(0);
    const positions = everyPositionIn(track);
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      const at = geographicPosition(
        degreesLatitude(position.latitude),
        degreesLongitude(position.longitude),
      );
      expect(distanceBetween(at, HOME)).toBeGreaterThan(radius);
    }
  });

  it('emits the whole track when the athlete has no zones', () => {
    const { latitude, longitude } = northFrom(50, 10);
    const track = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [] });
    expect(track.segments).toHaveLength(1);
    expect(track.segments[0]?.points).toHaveLength(50);
    expect(track.trimmedPoints).toBe(0);
    expect(track.zonesApplied).toBe(0);
  });

  it('emits nothing at all when the whole ride is inside a zone', () => {
    // The indoor-adjacent case: a ride that never leaves the disc. Emitting a
    // shortened track would be worse than emitting none, because its endpoints
    // would still lie on the boundary.
    const { latitude, longitude } = northFrom(20, 5);
    const track = sharedTrack({
      activityId: 'ride-1',
      latitude,
      longitude,
      zones: [zone({ radius: metres(50_000) })],
    });
    expect(track.segments).toEqual([]);
    expect(track.trimmedPoints).toBe(20);
    expect(track.startsAtIndex).toBeUndefined();
    expect(track.distance).toBe(0);
  });

  it('splits a mid-ride passage into two parts rather than one polyline', () => {
    // ADR 0004 decision B item 2. A single polyline joined across the passage
    // draws a chord whose perpendicular bisector runs through the zone centre,
    // which hands an observer the thing the zone exists to hide.
    const out = northFrom(60, 40);
    const back = northFrom(60, -40, {
      latitude: degreesLatitude(out.latitude[59] ?? 0),
      longitude: HOME.longitude,
    });
    const latitude = [...out.latitude, ...back.latitude] as Samples<'latitude'>;
    const longitude = [...out.longitude, ...back.longitude] as Samples<'longitude'>;

    // A zone away from both ends, crossed twice: out through it and back.
    const midpoint = geographicPosition(
      degreesLatitude(out.latitude[30] ?? 0),
      degreesLongitude(HOME.longitude),
    );
    const track = sharedTrack({
      activityId: 'ride-1',
      latitude,
      longitude,
      zones: [zone({ centre: midpoint, radius: metres(300) })],
    });

    expect(track.segments.length).toBeGreaterThanOrEqual(2);
    // And the parts are in order, with no point reused between them.
    const indices = track.segments.flatMap((segment) => segment.points.map((p) => p.index));
    expect([...indices]).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('measures only the emitted track, never across the break', () => {
    // ADR 0004 decision B item 4: with a published total derived from the true
    // track, `true - emitted` restores the length of the trimmed part, and with
    // a bearing that is the centre again. So the distance here must be strictly
    // less than the length of the whole track.
    const { latitude, longitude } = northFrom(100, 20);
    const whole = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [] });
    const trimmed = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone()] });

    expect(trimmed.trimmedPoints).toBeGreaterThan(0);
    expect(trimmed.distance).toBeLessThan(whole.distance);
    // Not merely shorter — shorter by at least the span that was removed, which
    // is what a distance summed across the break would have kept.
    const removed = trimmed.trimmedPoints * 20;
    expect(whole.distance - trimmed.distance).toBeGreaterThan(removed * 0.5);
  });

  it('reports the first emitted point rather than the ride’s own start', () => {
    // Decision B item 3: nothing published may measure the trimmed part, and a
    // start time earlier than the first emitted point does exactly that.
    const { latitude, longitude } = northFrom(200, 10);
    const track = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone()] });
    expect(track.startsAtIndex).toBe(track.trimmedPoints);
    expect(track.startsAtIndex).toBeGreaterThan(0);
  });

  it('breaks the track at a gap in the stored stream, and does not count it as trimmed', () => {
    // A dropped fix is not a withheld point. Reporting it as trimmed would
    // tell the rider a zone was applied where none was.
    const { latitude, longitude } = northFrom(10, 400);
    const holed = [...latitude];
    holed[5] = undefined;
    const track = sharedTrack({
      activityId: 'ride-1',
      latitude: holed,
      longitude,
      zones: [],
    });
    expect(track.segments).toHaveLength(2);
    expect(track.trimmedPoints).toBe(0);
  });

  it('withholds a sample carrying only one of the two coordinates', () => {
    // `streams.ts` records that the two channels are separately absent. A
    // "position" assembled from one real coordinate and a default zero is a
    // point in the Gulf of Guinea, which no zone contains — so a half-position
    // treated as whole would be published from inside a zone.
    const { latitude, longitude } = northFrom(4, 400);
    const half = [...longitude];
    half[2] = undefined;
    const track = sharedTrack({
      activityId: 'ride-1',
      latitude,
      longitude: half,
      zones: [],
    });
    const indices = track.segments.flatMap((segment) => segment.points.map((p) => p.index));
    expect(indices).not.toContain(2);
    expect(indices).toEqual([0, 1, 3]);
  });

  it('applies every zone, not only the first', () => {
    // A rider with a home zone and a work zone. Stopping at the first match
    // would publish the second address, and every single-zone test in the suite
    // would still pass.
    const { latitude, longitude } = northFrom(100, 30);
    const far = geographicPosition(
      degreesLatitude(latitude[80] as number),
      degreesLongitude(HOME.longitude),
    );
    const one = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone()] });
    const both = sharedTrack({
      activityId: 'ride-1',
      latitude,
      longitude,
      zones: [zone(), zone({ id: privacyZoneId('work'), centre: far, label: 'work' })],
    });
    expect(both.trimmedPoints).toBeGreaterThan(one.trimmedPoints);
    expect(both.zonesApplied).toBe(2);
  });

  it('handles a ride with no position channels at all', () => {
    const track = sharedTrack({
      activityId: 'ride-1',
      latitude: undefined,
      longitude: undefined,
      zones: [zone()],
    });
    expect(track.segments).toEqual([]);
    expect(track.trimmedPoints).toBe(0);
  });
});
