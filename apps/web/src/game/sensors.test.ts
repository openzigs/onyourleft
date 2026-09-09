// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The four-into-three translation, and the distinction it exists to keep.
 *
 * `ride/metrics.ts` has four states; the HUD renders three things. Which of the
 * four maps to which of the three is the whole content of `sensors.ts`, and
 * getting one of them wrong produces a warning on every ride for a strap the
 * rider does not own.
 */

import { describe, expect, it } from 'vitest';

import { NO_SENSORS, gameSensors, readingFor } from './sensors';
import { hudReadings } from './hud/fields';
import { atStartLine } from './simulation';
import type { RideSnapshot } from '../ride/controller';
import type { MetricState } from '../ride/metrics';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  unixSeconds,
  type RoutePoint,
} from '@onyourleft/domain';

/** A snapshot carrying exactly the metric states a test cares about. */
function snapshotWith(states: Partial<Record<string, MetricState>>): RideSnapshot {
  return {
    phase: 'recording',
    stopArmed: false,
    elapsedSeconds: 0,
    movingSeconds: 0,
    sampleCount: 0,
    metrics: Object.entries(states).map(([id, state]) => ({
      id: id as 'power' | 'cadence' | 'heartRate' | 'speed',
      state: state as MetricState,
    })),
    sensors: [],
    trainer: {
      paired: false,
      controllable: false,
      canSetPower: false,
      powerRange: undefined,
      hasControl: false,
      target: { kind: 'none' },
      controlLost: undefined,
      requested: undefined,
    } as unknown as RideSnapshot['trainer'],
    workout: undefined,
    storage: 'ok',
    pairingError: undefined,
    saveState: 'unavailable',
    saveError: undefined,
    savedActivityId: undefined,
    connectionsRemaining: 3,
  };
}

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(0),
    });
  }
  return routeProfile(points);
}

describe('a channel nobody is paired for is not a channel that dropped', () => {
  it('reports an unpaired channel as unpaired, not merely as not live', () => {
    const reading = readingFor(snapshotWith({ heartRate: { kind: 'unpaired' } }), 'heartRate');

    expect(reading.live).toBe(false);
    expect(reading.paired).toBe(false);
  });

  it('reports a stale channel as paired and not live', () => {
    const reading = readingFor(
      snapshotWith({ power: { kind: 'stale', silentForSeconds: 9 } }),
      'power',
    );

    expect(reading.live).toBe(false);
    expect(reading.paired).toBe(true);
  });

  it('does not warn about a strap the rider does not own', () => {
    // The false alarm `ride/metrics.ts` names, asserted where a rider would see
    // it: a HUD with no heart rate strap paired must show a dash and say
    // nothing, while a dropped one says so.
    const profile = route();
    const noStrap = hudReadings({
      profile,
      state: atStartLine(profile),
      cadence: { value: undefined, live: false, paired: false },
      heartRate: { value: undefined, live: false, paired: false },
    });
    const droppedStrap = hudReadings({
      profile,
      state: atStartLine(profile),
      cadence: { value: undefined, live: false, paired: false },
      heartRate: { value: undefined, live: false, paired: true },
    });

    expect(noStrap.find((field) => field.key === 'heartRate')?.stale).toBe(false);
    expect(droppedStrap.find((field) => field.key === 'heartRate')?.stale).toBe(true);
  });

  it('treats a paired-but-silent channel as a fault rather than as absent', () => {
    // `waiting` — a trainer that connected and has not notified. A sensor that
    // connects and never speaks is a real fault, and a screen that sat silently
    // on dashes would leave the rider wondering whether to re-pair.
    const reading = readingFor(snapshotWith({ power: { kind: 'waiting' } }), 'power');

    expect(reading.paired).toBe(true);
    expect(reading.live).toBe(false);
  });

  it('treats a channel the snapshot never mentions as unpaired', () => {
    expect(readingFor(snapshotWith({}), 'cadence').paired).toBe(false);
  });
});

describe('a live channel carries its number', () => {
  it('passes the value through', () => {
    const reading = readingFor(
      snapshotWith({ power: { kind: 'live', value: 243, at: unixSeconds(1_700_000_000) } }),
      'power',
    );

    expect(reading).toMatchObject({ value: 243, live: true, paired: true });
  });

  it('brands power for the simulation, and a genuine zero survives', () => {
    const sensors = gameSensors(
      snapshotWith({ power: { kind: 'live', value: 0, at: unixSeconds(1_700_000_000) } }),
    );

    // Zero and live: the rider is freewheeling, and the simulation must be told
    // zero rather than told nothing.
    expect(sensors.rider.power).toBe(0);
    expect(sensors.rider.live).toBe(true);
  });

  it('gives the simulation zero rather than a stale number when the link drops', () => {
    const sensors = gameSensors(snapshotWith({ power: { kind: 'stale', silentForSeconds: 4 } }));

    expect(sensors.rider.power).toBe(0);
    expect(sensors.rider.live).toBe(false);
    expect(sensors.rider.paired).toBe(true);
  });
});

describe('before a ride exists', () => {
  it('reports nothing paired rather than everything dropped', () => {
    expect(gameSensors(undefined)).toEqual(NO_SENSORS);
    expect(NO_SENSORS.rider.paired).toBe(false);
    expect(NO_SENSORS.heartRate.paired).toBe(false);
  });
});
