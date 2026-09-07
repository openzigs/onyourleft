// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #63's fifth and sixth acceptance criteria, at the layer where a map cannot
 * argue with them.
 *
 * - **Criterion 5** — gaps render as visible discontinuities. Asserted as
 *   structure: one member of the `MultiLineString` per run, so there is no line
 *   between them for any renderer to draw.
 * - **Criterion 6** — privacy-zone truncation asserted on the coordinate array
 *   the map receives. `detail/privacy.test.ts` proves the segments carry no
 *   in-zone point; this proves the conversion into map geometry keeps it that
 *   way and does not, say, close the ring.
 */

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  metres,
  unixSeconds,
} from '@onyourleft/domain';
import { athleteId, privacyZoneId, type PrivacyZoneRecord, type Samples } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { sharedTrack, trimRadius, type TrackSegment } from '../detail/privacy';

import { trackBounds, trackFeature, trackGeometry } from './track';

const ATHLETE = athleteId('athlete-a');
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

function at(latitude: number, longitude: number) {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

function segment(...points: readonly (readonly [number, number])[]): TrackSegment {
  return {
    points: points.map(([latitude, longitude], index) => ({
      index,
      position: at(latitude, longitude),
    })),
  };
}

describe('trackGeometry — the shape a map is handed', () => {
  it('is a MultiLineString even for a single unbroken run', () => {
    // The shape does not change with the data. A renderer written against
    // "sometimes a LineString" has a branch half the rides exercise and no
    // fixture does.
    const geometry = trackGeometry([segment([51.5, -0.1], [51.6, -0.1])]);
    expect(geometry?.type).toBe('MultiLineString');
    expect(geometry?.coordinates).toHaveLength(1);
  });

  it('writes longitude first — GeoJSON order, the one transposition in the program', () => {
    // London is 51.5074 N, 0.1278 W. Transposed it is a valid position in
    // Kenya, nothing throws, and the ride is drawn on the wrong continent.
    const geometry = trackGeometry([segment([51.5074, -0.1278], [51.5084, -0.1278])]);
    expect(geometry?.coordinates[0]?.[0]).toEqual([-0.1278, 51.5074]);
  });

  it('gives every run its own line, so no renderer can join across a gap', () => {
    // Criterion 5, as structure rather than as a drawing instruction: there is
    // no line between two members of a MultiLineString and no styling option
    // that creates one.
    const geometry = trackGeometry([
      segment([51.5, -0.1], [51.51, -0.1]),
      segment([51.6, -0.1], [51.61, -0.1]),
    ]);
    expect(geometry?.coordinates).toHaveLength(2);
    // And the two runs do not share an endpoint, which is what joining would
    // look like if it were done by concatenation instead.
    expect(geometry?.coordinates[0]?.at(-1)).not.toEqual(geometry?.coordinates[1]?.[0]);
  });

  it('keeps an isolated fix as a two-position line rather than dropping it', () => {
    // A LineString needs two positions, and a round cap draws this as a dot —
    // the same choice `detail/TraceChart.tsx` makes for an isolated reading.
    // Dropping it would be this function deciding a real fix is noise.
    const geometry = trackGeometry([segment([51.5, -0.1])]);
    expect(geometry?.coordinates[0]).toEqual([
      [-0.1, 51.5],
      [-0.1, 51.5],
    ]);
  });

  it('is undefined when there is nothing to draw, so no map is rendered at all', () => {
    // Criterion 1's failure: an empty map centred on 0°, 0°. `undefined` is
    // what makes the panel render nothing rather than an empty grid.
    expect(trackGeometry([])).toBeUndefined();
    expect(trackGeometry([{ points: [] }])).toBeUndefined();
  });

  it('wraps as a Feature, and propagates undefined', () => {
    expect(trackFeature(trackGeometry([segment([51.5, -0.1], [51.6, -0.1])]))?.type).toBe(
      'Feature',
    );
    expect(trackFeature(undefined)).toBeUndefined();
  });
});

describe('trackBounds — computed from what is drawn, never from the stored track', () => {
  it('boxes every drawn position', () => {
    const geometry = trackGeometry([segment([51.5, -0.2], [51.7, 0.1])]);
    expect(trackBounds(geometry)).toEqual({ west: -0.2, south: 51.5, east: 0.1, north: 51.7 });
  });

  it('is undefined when there is no geometry', () => {
    expect(trackBounds(undefined)).toBeUndefined();
  });

  it('boxes the trimmed track, not the true one — ADR 0004 decision C', () => {
    // The ADR names a bounding box among the position-derived summaries that
    // must not be computed from the true track: a box around the untrimmed ride
    // has a corner near the front door, and it would leak what the trimming
    // removed while the drawn line looked correct.
    const count = 200;
    const latitude = Array.from({ length: count }, (_unused, index) =>
      degreesLatitude(HOME.latitude + (index * 10) / METRES_PER_DEGREE_LATITUDE),
    ) as Samples<'latitude'>;
    const longitude = Array.from({ length: count }, () =>
      degreesLongitude(HOME.longitude),
    ) as Samples<'longitude'>;
    const zone: PrivacyZoneRecord = {
      id: privacyZoneId('home'),
      athleteId: ATHLETE,
      centre: HOME,
      radius: metres(500),
      label: 'home',
      createdAt: unixSeconds(1),
    };

    const whole = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [] });
    const trimmed = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone] });
    const wholeBox = trackBounds(trackGeometry(whole.segments));
    const trimmedBox = trackBounds(trackGeometry(trimmed.segments));

    expect(trimmed.trimmedPoints).toBeGreaterThan(0);
    // The trimmed box starts further north — its southern edge is outside the
    // zone, where the untrimmed one is the zone's centre itself.
    expect(trimmedBox?.south).toBeGreaterThan(wholeBox?.south ?? 0);
  });
});

describe('criterion 6 — the coordinate array the map receives carries no in-zone point', () => {
  it('holds nothing inside the trim radius, walked position by position', () => {
    const count = 200;
    const latitude = Array.from({ length: count }, (_unused, index) =>
      degreesLatitude(HOME.latitude + (index * 10) / METRES_PER_DEGREE_LATITUDE),
    ) as Samples<'latitude'>;
    const longitude = Array.from({ length: count }, () =>
      degreesLongitude(HOME.longitude),
    ) as Samples<'longitude'>;
    const zone: PrivacyZoneRecord = {
      id: privacyZoneId('home'),
      athleteId: ATHLETE,
      centre: HOME,
      radius: metres(500),
      label: 'home',
      createdAt: unixSeconds(1),
    };

    const trimmed = sharedTrack({ activityId: 'ride-1', latitude, longitude, zones: [zone] });
    const geometry = trackGeometry(trimmed.segments);
    const radius = trimRadius(metres(500), 'ride-1', 'home');

    expect(trimmed.trimmedPoints).toBeGreaterThan(0);
    const drawn = geometry?.coordinates.flat() ?? [];
    expect(drawn.length).toBeGreaterThan(0);
    for (const [longitudeValue, latitudeValue] of drawn) {
      // ⚠️ Read back in GeoJSON order, and this assertion does **not** catch a
      // transposition: swap the pair upstream and every point moves somewhere
      // else that is also outside the disc, so this still passes. The ordering
      // is pinned by "writes longitude first" above, which is the test that
      // goes red for it. Said here rather than left to be discovered, because
      // an assertion that looks like it covers two things and covers one is
      // worse than one that covers one.
      expect(distanceBetween(at(latitudeValue, longitudeValue), HOME)).toBeGreaterThan(radius);
    }
  });
});
