// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Editing a saved route keeps its line — #2007.
 *
 * The first criterion is the one this file is built round: *editing one
 * stretch leaves every point outside it byte-identical*. "Byte-identical" is
 * asserted per sample with `Object.is` on each number (latitude, longitude,
 * height, gradient), which a value that moved by one ulp fails. The read back
 * through the real store is `route-edit.store.test.ts`.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  LOOP_CLOSURE_METRES,
  metres,
  routeProfile,
  RouteError,
  RoutingError,
  unixSeconds,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';
import {
  athleteId,
  privacyZoneId,
  routeId,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { newHistory, record, redo, undo } from './history';
import { RIDING_DEFAULTS } from './preferences';
import {
  canReturnToStart,
  drawStretch,
  heightAt,
  lastSample,
  lineOf,
  nearestSample,
  outAndBack,
  rampedLength,
  replaceRouteLine,
  replaceStretch,
  returnToStart,
  reverseLine,
  routeFromEdit,
  sampleAt,
  straightStretch,
  type EditedLine,
} from './route-edit';
import { GLO30, scriptedProvider } from './testing';

const OWNER = athleteId('athlete-editing');
const NOW = unixSeconds(1_800_000_000);
const SAVED_AT = unixSeconds(1_790_000_000);

/** A place `north` and `east` metres from an arbitrary origin. */
function at(north: number, east: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(0.5 + north / 111_195),
    degreesLongitude(0.5 + east / 111_178),
  );
}

/** A 2 km line due north that climbs 40 m and comes down 20, sampled by `routeProfile`. */
function savedProfile(): RouteProfile {
  return routeProfile(
    [
      { position: at(0, 0), elevation: altitudeMetres(100) },
      { position: at(800, 0), elevation: altitudeMetres(140) },
      { position: at(1_400, 0), elevation: altitudeMetres(120) },
      { position: at(2_000, 0), elevation: altitudeMetres(120) },
    ],
    {},
  );
}

function savedRoute(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    id: routeId('route-saved'),
    createdBy: OWNER,
    name: 'Saturday',
    profile: savedProfile(),
    visibility: 'private',
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
    ...overrides,
  };
}

/** Every number of sample `index`, for an `Object.is` comparison. */
function sample(profile: RouteProfile, index: number): readonly number[] {
  const position = profile.positions[index]!;
  return [
    position.latitude,
    position.longitude,
    profile.elevations[index]!,
    profile.grades[index]!,
  ];
}

/** Assert `edited`'s samples `[editedFrom, …)` are byte-identical to `kept`'s `[keptFrom, …)`, `count` of them. */
function expectSameSamples(
  kept: RouteProfile,
  keptFrom: number,
  edited: RouteProfile,
  editedFrom: number,
  count: number,
): void {
  for (let offset = 0; offset < count; offset += 1) {
    const before = sample(kept, keptFrom + offset);
    const after = sample(edited, editedFrom + offset);
    for (const [field, value] of before.entries()) {
      if (!Object.is(after[field], value)) {
        throw new Error(
          `sample ${String(keptFrom + offset)} moved: field ${String(field)} is no longer the same`,
        );
      }
    }
  }
}

/** A detour 300 m east between samples `from` and `to`, freehand. */
function detour(line: EditedLine, from: number, to: number): EditedLine {
  const start = line.profile.positions[from]!;
  const end = line.profile.positions[to]!;
  const out = geographicPosition(
    degreesLatitude((start.latitude + end.latitude) / 2),
    degreesLongitude(start.longitude + 300 / 111_178),
  );
  return replaceStretch(line, from, to, {
    points: [
      { position: start, elevation: heightAt(line, from) },
      { position: out, elevation: undefined },
      { position: end, elevation: heightAt(line, to) },
    ],
    measured: false,
  });
}

describe('redrawing a stretch', () => {
  it('leaves every sample outside the stretch byte-identical, and its two ends', () => {
    const line = lineOf(savedRoute());
    const last = lastSample(line);
    const edited = detour(line, 50, 120);

    // Before the stretch, up to and including its first end.
    expectSameSamples(line.profile, 0, edited.profile, 0, 51);
    // After it, from its second end to the route's end.
    const tail = last - 120 + 1;
    expectSameSamples(
      line.profile,
      120,
      edited.profile,
      edited.profile.positions.length - tail,
      tail,
    );
    // Not vacuous: the stretch between did change, and is longer.
    expect(edited.profile.positions.length).toBeGreaterThan(line.profile.positions.length);
  });

  it('works out the distance from the changed stretch only', () => {
    const line = lineOf(savedRoute());
    const edited = detour(line, 50, 120);
    const resolution = line.profile.resolution;
    const start = line.profile.positions[50]!;
    const end = line.profile.positions[120]!;
    const out = geographicPosition(
      degreesLatitude((start.latitude + end.latitude) / 2),
      degreesLongitude(start.longitude + 300 / 111_178),
    );
    const stretch = distanceBetween(start, out) + distanceBetween(out, end);
    const kept = 50 * resolution + (lastSample(line) - 120) * resolution;

    expect(edited.profile.totalDistance).toBeCloseTo(kept + stretch, 6);
    // The detour adds what it adds and nothing else: the old stretch was 70 samples long.
    expect(edited.profile.totalDistance - line.profile.totalDistance).toBeCloseTo(
      stretch - 70 * resolution,
      6,
    );
  });

  it('slopes the stretch’s heights evenly between its two ends with no instance', () => {
    const line = lineOf(savedRoute());
    const edited = replaceStretch(
      line,
      30,
      90,
      straightStretch(line.profile.positions[30]!, line.profile.positions[90]!, {
        from: heightAt(line, 30),
        to: heightAt(line, 90),
      }),
    );
    const low = line.profile.elevations[30]!;
    const high = line.profile.elevations[90]!;
    const inner = edited.profile.elevations.slice(31, 90);
    expect(inner.length).toBeGreaterThan(10);
    for (const height of inner) {
      expect(height).toBeGreaterThanOrEqual(Math.min(low, high) - 1e-9);
      expect(height).toBeLessThanOrEqual(Math.max(low, high) + 1e-9);
    }
    // Marked as not measured, and only there.
    expect(edited.ramped.slice(0, 31).some(Boolean)).toBe(false);
    expect(edited.ramped.slice(31, 90).every(Boolean)).toBe(true);
    expect(edited.ramped.slice(90).some(Boolean)).toBe(false);
    expect(rampedLength(edited)).toBeGreaterThan(0);
  });

  it('sums the climb again over the whole edited line', () => {
    const line = lineOf(savedRoute());
    // Flatten the climb: a straight stretch from the start to the high point's far side.
    const peak = line.profile.elevations.indexOf(
      Math.max(...line.profile.elevations) as (typeof line.profile.elevations)[number],
    );
    const edited = replaceStretch(
      line,
      0,
      peak + 20,
      straightStretch(line.profile.positions[0]!, line.profile.positions[peak + 20]!, {
        from: heightAt(line, 0),
        to: heightAt(line, peak + 20),
      }),
    );
    expect(line.profile.totalAscent).toBeGreaterThan(35);
    expect(edited.profile.totalAscent).toBeLessThan(line.profile.totalAscent);
    expect(edited.profile.totalAscent).toBeGreaterThan(0);
  });

  it('refuses a stretch that does not start before it ends', () => {
    const line = lineOf(savedRoute());
    const place = line.profile.positions[40]!;
    expect(() => replaceStretch(line, 40, 40, straightStretch(place, place, {}))).toThrow(
      RouteError,
    );
    expect(() => replaceStretch(line, 80, 40, straightStretch(place, place, {}))).toThrow(
      RouteError,
    );
    expect(() =>
      replaceStretch(line, 0, lastSample(line) + 1, straightStretch(place, place, {})),
    ).toThrow(RouteError);
  });
});

describe('changing the start or the end', () => {
  it('starts at the new place and keeps every sample from where it joins', () => {
    const line = lineOf(savedRoute());
    const start = at(100, -400);
    const edited = replaceStretch(
      line,
      'new-start',
      30,
      straightStretch(start, line.profile.positions[30]!, { to: heightAt(line, 30) }),
    );
    // A new place, not a kept sample: the same value, from the stretch's own profile.
    expect(edited.profile.positions[0]).toEqual(start);
    const tail = lastSample(line) - 30 + 1;
    expectSameSamples(
      line.profile,
      30,
      edited.profile,
      edited.profile.positions.length - tail,
      tail,
    );
    expect(edited.profile.loop).toBe(false);
  });

  it('ends at the new place and keeps every sample up to where it joins', () => {
    const line = lineOf(savedRoute());
    const end = at(1_700, 500);
    const edited = replaceStretch(
      line,
      150,
      'new-end',
      straightStretch(line.profile.positions[150]!, end, { from: heightAt(line, 150) }),
    );
    expectSameSamples(line.profile, 0, edited.profile, 0, 151);
    expect(distanceBetween(edited.profile.positions.at(-1)!, end)).toBeLessThan(0.01);
  });
});

describe('reverse, out and back, and return to start', () => {
  it('reverses every sample in place, turns each gradient and swaps the climb and descent', () => {
    const line = lineOf(savedRoute());
    const reversed = reverseLine(line);
    const last = lastSample(line);
    for (let index = 0; index <= last; index += 1) {
      expect(reversed.profile.positions[index]).toBe(line.profile.positions[last - index]);
      expect(reversed.profile.elevations[index]).toBe(line.profile.elevations[last - index]);
      expect(reversed.profile.grades[index]).toBe(0 - line.profile.grades[last - index]!);
    }
    expect(reversed.profile.totalAscent).toBe(line.profile.totalDescent);
    expect(reversed.profile.totalDescent).toBe(line.profile.totalAscent);
    expect(reverseLine(reversed)).toEqual(line);
  });

  it('goes out and back: twice the length, back at the start, the way out kept', () => {
    const line = lineOf(savedRoute());
    const there = outAndBack(line);
    expect(there.profile.totalDistance).toBeCloseTo(line.profile.totalDistance * 2, 6);
    expect(there.profile.positions.at(-1)).toBe(line.profile.positions[0]);
    expectSameSamples(line.profile, 0, there.profile, 0, line.profile.positions.length);
    expect(there.profile.totalAscent).toBeCloseTo(
      line.profile.totalAscent + line.profile.totalDescent,
      6,
    );
    expect(there.profile.loop).toBe(false);
  });

  it('returns to its start and is then a loop, with the way out kept', () => {
    const line = lineOf(savedRoute());
    expect(canReturnToStart(line)).toBe(true);
    const last = lastSample(line);
    const back = returnToStart(
      line,
      straightStretch(line.profile.positions[last]!, line.profile.positions[0]!, {
        from: heightAt(line, last),
        to: heightAt(line, 0),
      }),
    );
    expect(back.profile.loop).toBe(true);
    expect(
      distanceBetween(back.profile.positions[0]!, back.profile.positions.at(-1)!),
    ).toBeLessThanOrEqual(LOOP_CLOSURE_METRES);
    expectSameSamples(line.profile, 0, back.profile, 0, last + 1);
    expect(canReturnToStart(back)).toBe(false);
    expect(returnToStart(back, straightStretch(at(0, 0), at(0, 0), {}))).toBe(back);
  });
});

describe('undo and redo through an edit', () => {
  it('walks back through every change to the saved line, and forward again', () => {
    const line = lineOf(savedRoute());
    let history = newHistory(line);
    const steps = [
      (current: EditedLine) => detour(current, 20, 60),
      reverseLine,
      outAndBack,
      (current: EditedLine) => detour(current, 100, 180),
    ];
    for (const step of steps) history = record(history, step(history.present));
    const finished = history.present;
    for (let count = 0; count < steps.length; count += 1) history = undo(history);
    expect(history.present).toBe(line);
    for (let count = 0; count < steps.length; count += 1) history = redo(history);
    expect(history.present).toBe(finished);
  });
});

describe('picking a place on the line', () => {
  it('turns a distance into the nearest sample, clamped to the route', () => {
    const line = lineOf(savedRoute());
    const resolution = line.profile.resolution;
    expect(sampleAt(line, 500)).toBe(Math.round(500 / resolution));
    expect(sampleAt(line, -20)).toBe(0);
    expect(sampleAt(line, 1e9)).toBe(lastSample(line));
  });

  it('turns a tap beside the line into the sample nearest it', () => {
    const line = lineOf(savedRoute());
    // 30 m east of sample 70.
    const beside = at(70 * line.profile.resolution, 30);
    expect(Math.abs(nearestSample(line, beside) - 70)).toBeLessThanOrEqual(1);
  });
});

describe('drawing a stretch', () => {
  it('is a straight line with no routing service, its heights not measured', async () => {
    const stretch = await drawStretch(
      at(0, 0),
      at(500, 0),
      { from: altitudeMetres(100), to: altitudeMetres(110) },
      undefined,
      RIDING_DEFAULTS,
    );
    expect(stretch.points).toHaveLength(2);
    expect(stretch.measured).toBe(false);
  });

  it('follows the roads and measures its heights with one, keeping the ends’ heights', async () => {
    const provider = scriptedProvider({ vertices: 12, heights: [200] });
    const stretch = await drawStretch(
      at(0, 0),
      at(500, 0),
      { from: altitudeMetres(100), to: altitudeMetres(110) },
      provider,
      RIDING_DEFAULTS,
    );
    expect(provider.routeCalls).toHaveLength(1);
    expect(provider.heightCalls).toHaveLength(1);
    expect(stretch.measured).toBe(true);
    expect(stretch.points.length).toBeGreaterThan(2);
    expect(stretch.points[0]!.elevation).toBe(100);
    expect(stretch.points.at(-1)!.elevation).toBe(110);
    expect(stretch.points[1]!.elevation).toBe(200);
  });

  it('passes the routing service’s refusal on, so nothing is changed', async () => {
    const provider = scriptedProvider();
    provider.failNextRoute(new RoutingError('no-route', 'No path between these two points.', 0));
    await expect(
      drawStretch(at(0, 0), at(500, 0), {}, provider, RIDING_DEFAULTS),
    ).rejects.toBeInstanceOf(RoutingError);
  });
});

describe('saving an edit', () => {
  it('as a new route: private, the original’s owner, and the ramped stretch counted as missing', () => {
    const original = savedRoute({
      visibility: 'public',
      elevation: {
        dataset: GLO30.name,
        resolution: GLO30.resolution,
        interval: metres(30),
        missing: metres(0),
      },
    });
    const edited = detour(lineOf(original), 50, 120);
    const outcome = routeFromEdit(original, edited, {
      id: routeId('route-new'),
      name: '  Saturday, the long way  ',
      now: NOW,
    });
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    expect(outcome.record.visibility).toBe('private');
    expect(outcome.record.createdBy).toBe(OWNER);
    expect(outcome.record.name).toBe('Saturday, the long way');
    expect(outcome.record.profile).toBe(edited.profile);
    expect(outcome.record.elevation?.missing).toBeCloseTo(rampedLength(edited), 6);
    expect(outcome.record.elevation?.dataset).toBe(GLO30.name);
  });

  it('as a new route from an import: claims no dataset', () => {
    const original = savedRoute();
    const outcome = routeFromEdit(original, detour(lineOf(original), 50, 120), {
      id: routeId('route-new'),
      name: 'Saturday again',
      now: NOW,
    });
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    expect('elevation' in outcome.record).toBe(false);
  });

  it('refuses a new route with no name', () => {
    const original = savedRoute();
    const outcome = routeFromEdit(original, lineOf(original), {
      id: routeId('route-new'),
      name: '   ',
      now: NOW,
    });
    expect(outcome.status === 'refused' && outcome.refusal.code).toBe('name-required');
  });

  it('over the original: the new line, the same id, a new updatedAt', () => {
    const stored = savedRoute();
    const edited = detour(lineOf(stored), 50, 120);
    const outcome = replaceRouteLine(stored, edited, SAVED_AT, NOW);
    if (outcome.status !== 'saved') throw new Error(outcome.refusal.message);
    expect(outcome.record.id).toBe(stored.id);
    expect(outcome.record.name).toBe(stored.name);
    expect(outcome.record.profile).toBe(edited.profile);
    expect(outcome.record.updatedAt).toBe(NOW);
  });

  it('over the original: refused when it was changed somewhere else', () => {
    const stored = savedRoute({ updatedAt: unixSeconds(SAVED_AT + 60) });
    const outcome = replaceRouteLine(stored, lineOf(stored), SAVED_AT, NOW);
    expect(outcome.status === 'refused' && outcome.refusal.code).toBe('edited-elsewhere');
  });

  it('over a shared route: refused when its new start lies in a privacy zone', () => {
    const stored = savedRoute({ visibility: 'public' });
    const home = at(150, -2_000);
    const zone: PrivacyZoneRecord = {
      id: privacyZoneId('zone-home'),
      athleteId: OWNER,
      centre: home,
      radius: metres(200),
      label: 'Home',
      createdAt: SAVED_AT,
    };
    const line = lineOf(stored);
    const moved = replaceStretch(
      line,
      'new-start',
      30,
      straightStretch(home, line.profile.positions[30]!, { to: heightAt(line, 30) }),
    );
    const outcome = replaceRouteLine(stored, moved, SAVED_AT, NOW, [zone]);
    expect(outcome.status === 'refused' && outcome.refusal.code).toBe('cannot-be-shared');
    // The same line over a private route is the rider's own business.
    const mine = replaceRouteLine({ ...stored, visibility: 'private' }, moved, SAVED_AT, NOW, [
      zone,
    ]);
    expect(mine.status).toBe('saved');
  });
});
