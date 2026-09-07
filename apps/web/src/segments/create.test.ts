// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  MINIMUM_SEGMENT_LENGTH_METRES,
  NEAR_DUPLICATE_OVERLAP,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  privacyZoneId,
  segmentId,
  type ActivityRecord,
  type AthleteId,
  type PrivacyZoneRecord,
  type SegmentRecord,
} from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  createSegmentFromRide,
  DUPLICATE_SCAN_LIMIT,
  MAXIMUM_SPAN_SAMPLES,
  readSpan,
  SEGMENT_NOTE,
  SEGMENT_REFUSAL,
  segmentDecision,
} from './create';
import { stubSegments } from './testing';

const OWNER: AthleteId = athleteId('athlete-a');
const RIDE = activityId('ride-1');
const NOW = unixSeconds(1_760_000_000);
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** A due-north track of `count` points, `spacingMetres` apart. */
function northward(count: number, spacingMetres = 50, originLatitude = 51.5): GeographicPosition[] {
  const step = spacingMetres / METRES_PER_DEGREE_LATITUDE;
  return Array.from({ length: count }, (_unused, index) =>
    at(originLatitude + index * step, -0.12),
  );
}

function outdoorRide(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: RIDE,
    athleteId: OWNER,
    name: 'Morning ride',
    startedAt: NOW,
    startedAtTimeZone: 'UTC',
    elapsedTime: 3600 as ActivityRecord['elapsedTime'],
    movingTime: 3500 as ActivityRecord['movingTime'],
    distance: 30_000 as ActivityRecord['distance'],
    visibility: 'private',
    hasPosition: true,
    createdAt: NOW,
    ...overrides,
  };
}

function zoneAt(centre: GeographicPosition, radius = 500): PrivacyZoneRecord {
  return {
    id: privacyZoneId('zone-1'),
    athleteId: OWNER,
    centre,
    radius: metres(radius),
    label: 'home',
    createdAt: NOW,
  };
}

function existingSegment(
  geometry: readonly GeographicPosition[],
  name = 'The climb',
): SegmentRecord {
  return {
    id: segmentId('existing-1'),
    createdBy: OWNER,
    name,
    sport: 'ride',
    geometry,
    start: { position: geometry[0] as GeographicPosition, bearing: 0 as never, radius: metres(15) },
    end: {
      position: geometry[geometry.length - 1] as GeographicPosition,
      bearing: 0 as never,
      radius: metres(15),
    },
    bearingToleranceDegrees: 60,
    distance: metres(1000),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: NOW,
  };
}

function decisionInput(overrides: Partial<Parameters<typeof segmentDecision>[0]> = {}) {
  return {
    id: 'segment-new',
    owner: OWNER,
    name: 'The long drag',
    geometry: northward(21),
    requestedVisibility: 'public' as const,
    privacyZones: [],
    existing: [],
    createdAt: NOW,
    ...overrides,
  };
}

describe('the decision is pure and refuses before it builds', () => {
  it('creates a public segment when nothing objects', () => {
    const decision = segmentDecision(decisionInput());
    expect(decision.kind).toBe('create');
    if (decision.kind !== 'create') {
      return;
    }
    expect(decision.record.visibility).toBe('public');
    expect(decision.notes).toEqual([]);
    expect(decision.overlaps).toEqual([]);
  });

  it('refuses an unnamed segment', () => {
    const decision = segmentDecision(decisionInput({ name: '   ' }));
    expect(decision).toMatchObject({ kind: 'refused', reason: 'unnamed' });
  });

  it('trims the name it stores', () => {
    const decision = segmentDecision(decisionInput({ name: '  The long drag  ' }));
    expect(decision.kind === 'create' && decision.record.name).toBe('The long drag');
  });

  it('refuses an empty span', () => {
    const decision = segmentDecision(decisionInput({ geometry: [] }));
    expect(decision).toMatchObject({ kind: 'refused', reason: 'spanEmpty' });
  });

  it('refuses a span with too few positions', () => {
    const decision = segmentDecision(decisionInput({ geometry: northward(2, 1000) }));
    expect(decision).toMatchObject({ kind: 'refused', reason: 'tooFewPositions' });
  });

  it('refuses a span below the minimum length, and says the minimum', () => {
    const decision = segmentDecision(decisionInput({ geometry: northward(21, 10) }));
    expect(decision).toMatchObject({ kind: 'refused', reason: 'tooShort' });
    expect(decision.kind === 'refused' && decision.message).toContain(
      String(MINIMUM_SEGMENT_LENGTH_METRES),
    );
  });

  it('refuses a span that never moves', () => {
    const stationary = Array.from({ length: 20 }, () => at(51.5, -0.12));
    // Zero-length, so it is `tooShort` that catches it first — which is the
    // honest ordering: a rider who selected a stopped minute is better told
    // "too short" than "no direction".
    expect(segmentDecision(decisionInput({ geometry: stationary })).kind).toBe('refused');
  });

  it('names no coordinate value in any refusal, per ADR 0004 decision D', () => {
    // A refusal is rendered on screen, which is exactly the layer decision D
    // binds. The latitude below is distinctive enough to find in a string.
    const secret = 51.987_654_321;
    const decision = segmentDecision(decisionInput({ geometry: northward(21, 10, secret) }));
    expect(decision.kind).toBe('refused');
    if (decision.kind !== 'refused') {
      return;
    }
    expect(decision.message).not.toContain('51.98');
    expect(decision.message).not.toContain('-0.12');
  });
});

describe('criterion 4 — a privacy zone forces a segment private', () => {
  it('downgrades a public segment whose START is inside a zone, and says so', () => {
    const geometry = northward(21);
    const decision = segmentDecision(
      decisionInput({ geometry, privacyZones: [zoneAt(geometry[0] as GeographicPosition)] }),
    );
    expect(decision.kind).toBe('create');
    if (decision.kind !== 'create') {
      return;
    }
    // The record that gets WRITTEN is private. Not a label beside a public one.
    expect(decision.record.visibility).toBe('private');
    expect(decision.notes).toContain(SEGMENT_NOTE.insidePrivacyZone);
  });

  it('downgrades one whose END is inside a zone', () => {
    // A ride that finishes at the rider's front door is the case this catches,
    // and checking only the start would miss it entirely.
    const geometry = northward(21);
    const decision = segmentDecision(
      decisionInput({
        geometry,
        privacyZones: [zoneAt(geometry[geometry.length - 1] as GeographicPosition)],
      }),
    );
    expect(decision.kind === 'create' && decision.record.visibility).toBe('private');
  });

  it('leaves a segment public when the zone is nowhere near either end', () => {
    const decision = segmentDecision(
      decisionInput({ privacyZones: [zoneAt(at(52.5, -1.9), 500)] }),
    );
    expect(decision.kind === 'create' && decision.record.visibility).toBe('public');
    expect(decision.kind === 'create' && decision.notes).toEqual([]);
  });

  it('uses the zone’s true radius, not the jittered one the shared view uses', () => {
    // `detail/privacy.ts` jitters by ±12.5% so an observer cannot average an
    // emitted radius out of many rides. Nothing is emitted here, and a jittered
    // radius would sometimes let a start inside a zone through — which is a
    // published address, half the time.
    const geometry = northward(21);
    const start = geometry[0] as GeographicPosition;
    // 490 m from the start: inside a 500 m zone, and outside a jittered one
    // drawn at the bottom of the interval (437 m).
    const centre = at(start.latitude - 490 / METRES_PER_DEGREE_LATITUDE, start.longitude);
    const decision = segmentDecision(
      decisionInput({ geometry, privacyZones: [zoneAt(centre, 500)] }),
    );
    expect(decision.kind === 'create' && decision.record.visibility).toBe('private');
  });
});

describe('criterion 3 — duplicate detection surfaces overlaps', () => {
  it('reports an overlap below the threshold WITHOUT changing the visibility', () => {
    // "Surfaces overlapping existing segments" is a wider ask than "blocks a
    // duplicate": a 40% overlap is worth telling a rider about and is not a
    // reason to make their segment private.
    const existing = existingSegment(northward(9));
    const decision = segmentDecision(
      decisionInput({ geometry: northward(21), existing: [existing] }),
    );
    expect(decision.kind).toBe('create');
    if (decision.kind !== 'create') {
      return;
    }
    expect(decision.overlaps).toHaveLength(1);
    expect(decision.overlaps[0]?.fraction).toBeLessThan(NEAR_DUPLICATE_OVERLAP);
    expect(decision.record.visibility).toBe('public');
    expect(decision.notes).toEqual([]);
  });

  it('forces a near-duplicate private, keeps it, and does not touch the earlier one', () => {
    // ADR 0007 D-2.4: this project keeps both. Deduplication by deletion
    // silently orphans the earlier segment's efforts.
    const geometry = northward(21);
    const existing = existingSegment(geometry);
    const decision = segmentDecision(decisionInput({ geometry, existing: [existing] }));
    expect(decision.kind).toBe('create');
    if (decision.kind !== 'create') {
      return;
    }
    expect(decision.record.visibility).toBe('private');
    expect(decision.notes).toContain(SEGMENT_NOTE.nearDuplicate);
    // The candidate is still created — "creating a near-duplicate is permitted".
    expect(decision.record.geometry).toHaveLength(21);
    // And the existing one is returned unchanged, not marked for removal.
    expect(existing.geometry).toHaveLength(21);
  });

  it('tells a rider about a duplicate even when they already asked for private', () => {
    const geometry = northward(21);
    const decision = segmentDecision(
      decisionInput({
        geometry,
        requestedVisibility: 'private',
        existing: [existingSegment(geometry)],
      }),
    );
    expect(decision.kind === 'create' && decision.notes).toContain(SEGMENT_NOTE.nearDuplicate);
  });

  it('reports the most overlapping segment first', () => {
    const geometry = northward(21);
    const mostly = { ...existingSegment(geometry, 'the same road'), id: segmentId('existing-2') };
    const partly = existingSegment(northward(6), 'the first bit');
    const decision = segmentDecision(decisionInput({ geometry, existing: [partly, mostly] }));
    expect(decision.kind === 'create' && decision.overlaps[0]?.name).toBe('the same road');
  });

  it('finds no overlap with a road a kilometre away', () => {
    const decision = segmentDecision(
      decisionInput({ existing: [existingSegment(northward(21, 50, 52.5))] }),
    );
    expect(decision.kind === 'create' && decision.overlaps).toEqual([]);
  });
});

describe('reading a span out of a ride', () => {
  it('drops a position with a gap rather than interpolating one', async () => {
    // The gap rule, restated at every layer since `power-duration.ts`.
    // Interpolating would put a coordinate the receiver never reported into a
    // record that outlives the ride it came from.
    const track = northward(21) as (GeographicPosition | undefined)[];
    track[5] = undefined;
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track }]);
    const span = await readSpan(port, RIDE, 0, 21);
    expect(span?.geometry).toHaveLength(20);
  });

  it('carries altitudes only when every kept position has one', async () => {
    const track = northward(5, 250);
    const port = stubSegments(OWNER, [
      { activity: outdoorRide(), track, altitudes: [10, 20, undefined, 40, 50] },
    ]);
    const span = await readSpan(port, RIDE, 0, 5);
    // A partial altitude channel would give `createSegment` an array that does
    // not match the geometry index for index — and a gain computed from half a
    // climb is a claim nobody measured.
    expect(span?.altitudes).toBeUndefined();
    expect(span?.geometry).toHaveLength(5);
  });

  it('carries altitudes when the whole span has them', async () => {
    const track = northward(5, 250);
    const port = stubSegments(OWNER, [
      { activity: outdoorRide(), track, altitudes: [10, 20, 30, 40, 50] },
    ]);
    const span = await readSpan(port, RIDE, 0, 5);
    expect(span?.altitudes).toEqual([10, 20, 30, 40, 50]);
  });

  it('bounds the span it will read', async () => {
    const track = northward(30, 50);
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track }]);
    const span = await readSpan(port, RIDE, 0, Number.MAX_SAFE_INTEGER);
    expect(span?.geometry.length).toBeLessThanOrEqual(MAXIMUM_SPAN_SAMPLES);
    expect(span?.geometry).toHaveLength(30);
  });

  it('reads only the chosen stretch, not the whole ride', async () => {
    const track = northward(30, 50);
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track }]);
    const span = await readSpan(port, RIDE, 10, 20);
    expect(span?.geometry).toHaveLength(10);
    expect(span?.geometry[0]).toEqual(track[10]);
  });

  it('has nothing to read from a ride with no track', async () => {
    const port = stubSegments(OWNER, [{ activity: outdoorRide({ hasPosition: false }) }]);
    expect(await readSpan(port, RIDE, 0, 10)).toBeUndefined();
  });
});

describe('criterion 1 — only from an activity the athlete owns', () => {
  it('refuses a ride that is not this athlete’s, and says so', async () => {
    // The stub answers `getActivity` for the owning athlete only, standing in
    // for the store's athlete-scoped index.
    const port = stubSegments(athleteId('athlete-b'), [
      { activity: outdoorRide(), track: northward(21) },
    ]);
    const outcome = await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'Their climb',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'notYours' });
    expect(outcome.kind === 'refused' && outcome.message).toBe(SEGMENT_REFUSAL.notYours);
    expect(port.written).toEqual([]);
  });

  it('costs one indexed miss rather than three channel decodes', async () => {
    // The ORDER is the claim. Reading the activity first, athlete-scoped, is
    // what makes a request naming somebody else's ride cheap — and it is what
    // stops a creation path decoding a stranger's track before discovering it
    // may not have it.
    const port = stubSegments(athleteId('athlete-b'), [
      { activity: outdoorRide(), track: northward(21) },
    ]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'Their climb',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });
    expect(port.reads).toEqual([`activity:${RIDE}`]);
  });

  it('refuses an indoor ride without decoding anything, from the stored bit', async () => {
    // `hasPosition` is the one bit #26 stores for exactly this question. The
    // message says an indoor ride is normal rather than faulty.
    const port = stubSegments(OWNER, [{ activity: outdoorRide({ hasPosition: false }) }]);
    const outcome = await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'Turbo',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'noTrack' });
    expect(port.reads).toEqual([`activity:${RIDE}`]);
  });
});

describe('creating end to end', () => {
  it('writes the segment and reports what it noticed', async () => {
    const track = northward(21);
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track }], {
      privacyZones: [zoneAt(track[0] as GeographicPosition)],
    });
    const outcome = await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'Home climb',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') {
      return;
    }
    expect(port.written).toHaveLength(1);
    // What was WRITTEN is private, which is the assertion that matters.
    expect(port.written[0]?.visibility).toBe('private');
    expect(outcome.notes).toContain(SEGMENT_NOTE.insidePrivacyZone);
  });

  it('writes nothing at all when the decision refuses', async () => {
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track: northward(21, 10) }]);
    const outcome = await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'Too short',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'tooShort' });
    expect(port.written).toEqual([]);
  });

  it('bounds the duplicate scan rather than reading every segment ever made', async () => {
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track: northward(21) }]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'A climb',
      from: 0,
      to: 21,
      requestedVisibility: 'public',
      createdAt: NOW,
    });
    expect(port.reads).toContain(`segments:${String(DUPLICATE_SCAN_LIMIT)}`);
  });

  it('stores a branded id and owner, so the record is the store’s shape', async () => {
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track: northward(21) }]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'A climb',
      from: 0,
      to: 21,
      requestedVisibility: 'private',
      createdAt: NOW,
    });
    expect(port.written[0]?.id).toBe('segment-new');
    expect(port.written[0]?.createdBy).toBe(OWNER);
  });

  it('records the elevation source as the device when the ride measured one', async () => {
    const track = northward(5, 250);
    const port = stubSegments(OWNER, [
      { activity: outdoorRide(), track, altitudes: [100, 110, 120, 130, 140] },
    ]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'A climb',
      from: 0,
      to: 5,
      requestedVisibility: 'private',
      createdAt: NOW,
    });
    expect(port.written[0]?.elevationSource).toBe('device');
    expect(port.written[0]?.elevationGain).toBeCloseTo(40, 6);
  });

  it('records no elevation source at all when the ride had no altitude', async () => {
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track: northward(21) }]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'A climb',
      from: 0,
      to: 21,
      requestedVisibility: 'private',
      createdAt: NOW,
    });
    expect(port.written[0]?.elevationSource).toBe('none');
    expect(port.written[0]?.elevationGain).toBeUndefined();
  });

  it('stores a geometry that is a copy — the ride’s array is not aliased', async () => {
    // #64 criterion 2, at this layer. The store's own test covers the
    // deletion half; this covers the aliasing half.
    const track = northward(21);
    const port = stubSegments(OWNER, [{ activity: outdoorRide(), track }]);
    await createSegmentFromRide(port, {
      id: 'segment-new',
      activityId: RIDE,
      name: 'A climb',
      from: 0,
      to: 21,
      requestedVisibility: 'private',
      createdAt: NOW,
    });
    expect(port.written[0]?.geometry).not.toBe(track);
    expect(port.written[0]?.geometry).toHaveLength(21);
  });
});
