// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride-analysis input (#809), built from rides that went through the REAL
 * store: every case writes through the #28 harness, reads back through the
 * public path on a fresh connection, and builds the input from what came back.
 * A hand-built object alone would test a shape the store might not produce.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  metresPerSecond,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import type {
  ActivityRecord,
  AthleteRecord,
  LapRecord,
  NewActivity,
  NewLap,
  NewStreamSet,
  RouteRecord,
  StreamSet,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  athleteRecord,
  createStoreHarness,
  lapFor,
  resetFixtureIds,
  rideFor,
  routeFor,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SideSessionSummary } from '../camera/side-session-summary';
import { SIDE_POSE_SOURCES } from '../camera/side-session-summary';
import { coordinatesIn } from '../privacy/boundaries';
import { MAXIMUM_IMPORTED_SAMPLES } from '../transfer/read-activity-file';

import {
  INPUT_BYTE_BUDGET,
  MAXIMUM_SECTIONS,
  MINIMUM_REPORTED_COVERAGE,
  MINIMUM_SECTION_SECONDS,
  rideAnalysisInput,
  SECTION_KINDS,
  type RideAnalysisInput,
  type RideAnalysisOptions,
} from './input';

const TEMPLATE = 'ride-analysis/1';

let harness: StoreHarness | undefined;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

function theHarness(): StoreHarness {
  if (harness === undefined) {
    throw new Error('no harness');
  }
  return harness;
}

interface Saved {
  readonly ride: ActivityRecord;
  readonly streams: StreamSet | undefined;
  readonly athlete: AthleteRecord | undefined;
  readonly laps: readonly LapRecord[];
  readonly route: RouteRecord | undefined;
}

/** Write everything through the public path, then read it all back on a fresh connection. */
async function saved(
  ride: NewActivity,
  streams: NewStreamSet | undefined,
  options: {
    readonly athlete?: Partial<AthleteRecord>;
    readonly laps?: readonly NewLap[];
    readonly route?: RouteRecord;
  } = {},
): Promise<Saved> {
  const store = theHarness();
  return store.roundTrip(
    async (writer) => {
      await writer.putAthlete({ ...athleteRecord(ATHLETE_A), ...options.athlete });
      if (options.route !== undefined) {
        await writer.putRoute(options.route);
      }
      await writer.putActivity(ride);
      if (streams !== undefined) {
        await writer.putStreamSet(streams);
      }
      for (const lap of options.laps ?? []) {
        await writer.putLap(lap);
      }
    },
    async (reader) => {
      const read = await reader.getActivity(ATHLETE_A, ride.id);
      if (read === undefined) {
        throw new Error('the ride did not come back');
      }
      return {
        ride: read,
        streams: await reader.getStreamSet(ATHLETE_A, ride.id),
        athlete: await reader.getAthlete(ATHLETE_A),
        laps: await reader.listLaps(ATHLETE_A, ride.id),
        route:
          options.route === undefined
            ? undefined
            : await reader.getRoute(ATHLETE_A, options.route.id),
      };
    },
  );
}

function inputFor(from: Saved, options: Partial<RideAnalysisOptions> = {}): RideAnalysisInput {
  return rideAnalysisInput(from.ride, from.streams, from.athlete, {
    templateVersion: TEMPLATE,
    laps: from.laps,
    ...(from.route === undefined ? {} : { route: from.route.profile }),
    cameraConsented: false,
    ...options,
  });
}

/** A stream set with one channel replaced. Values must lie on the channel's stored grid. */
function withChannel(
  set: NewStreamSet,
  channel: keyof NewStreamSet['channels'],
  values: readonly (number | undefined)[],
): NewStreamSet {
  return { ...set, channels: { ...set.channels, [channel]: values } };
}

/** Distinctive altitudes, on FIT's 0.2 m grid, nowhere near any other figure in a ride. */
function distinctiveAltitude(count: number): (number | undefined)[] {
  return Array.from({ length: count }, (_, index) =>
    altitudeMetres(Math.round((2717.4 + 0.2 * (index % 37)) * 5) / 5),
  );
}

/** Every key and every leaf value in a structure, with its path. */
function walk(
  value: unknown,
  path = '$',
  found: { keys: string[]; strings: string[]; numbers: number[]; paths: string[] } = {
    keys: [],
    strings: [],
    numbers: [],
    paths: [],
  },
): typeof found {
  if (typeof value === 'string') {
    found.strings.push(value);
  } else if (typeof value === 'number') {
    found.numbers.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${String(index)}]`, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.keys.push(key);
      found.paths.push(`${path}.${key}`);
      walk(child, `${path}.${key}`, found);
    }
  }
  return found;
}

const POSE: SideSessionSummary = {
  source: 'tablet',
  posesCompared: 1840,
  differences: { knee: -3.25, torso: 1.5 },
};

describe('what never leaves: nothing that locates or identifies the rider', () => {
  it('carries no coordinate, no altitude, no identity and no string but its own', async () => {
    const ride = rideFor(ATHLETE_A, {
      name: 'Home to Box Hill via the Zig Zag',
      hasPosition: true,
      routeId: undefined,
    });
    const base = streamSetFor(ride, { sampleCount: 3600 });
    const streams = withChannel(base, 'altitude', distinctiveAltitude(3600));
    const from = await saved(ride, streams, {
      athlete: { displayName: 'Ada Lovelace', mass: kilograms(68.5), thresholdPower: watts(240) },
      laps: [lapFor(ride, 0), lapFor(ride, 1), lapFor(ride, 2)],
    });
    const input = inputFor(from, { pose: POSE, cameraConsented: true });
    const found = walk(input);

    // No key that names a place, a time or an identity.
    const forbiddenKeys =
      /latitude|longitude|altitude|position|coordinate|name|date|time ?zone|startedAt|createdAt|^id$|Id$|key|signature|record/i;
    expect(found.keys.filter((key) => forbiddenKeys.test(key))).toStrictEqual([]);

    // No string but an enumeration member or the template version.
    const allowed = new Set<string>([TEMPLATE, ...SECTION_KINDS, ...SIDE_POSE_SOURCES]);
    expect(found.strings.filter((text) => !allowed.has(text))).toStrictEqual([]);

    // No number that equals a coordinate, an altitude sample or an instant.
    const located = new Set<number>();
    for (const channel of ['latitude', 'longitude', 'altitude'] as const) {
      for (const sample of from.streams?.channels[channel] ?? []) {
        if (sample !== undefined) {
          located.add(sample);
        }
      }
    }
    expect(located.size).toBeGreaterThan(100);
    for (const instant of [from.ride.startedAt, from.ride.createdAt, from.streams?.startedAt]) {
      if (instant !== undefined) {
        located.add(instant);
      }
    }
    expect(found.numbers.filter((number) => located.has(number))).toStrictEqual([]);

    // And the privacy module's own walk finds no position anywhere.
    expect(coordinatesIn(input)).toStrictEqual([]);
  });

  it('holds the absent-altitude seed honest: the walk DOES find an altitude sample when one leaks', async () => {
    // The control: the same walk over an input with an altitude sample planted
    // in it must fail, or the assertion above could be passing over nothing.
    const ride = rideFor(ATHLETE_A);
    const streams = withChannel(
      streamSetFor(ride, { sampleCount: 900 }),
      'altitude',
      distinctiveAltitude(900),
    );
    const from = await saved(ride, streams);
    const leaked = { ...inputFor(from), leaked: from.streams?.channels.altitude?.[5] };
    const located = new Set<number>(
      (from.streams?.channels.altitude ?? []).filter((sample) => sample !== undefined),
    );
    expect(walk(leaked).numbers.some((number) => located.has(number))).toBe(true);
  });

  it('never uses a registered metric name in any key (CLAUDE.md §6)', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 3600 }), {
      athlete: { mass: kilograms(70), thresholdPower: watts(250) },
      laps: [lapFor(ride, 0), lapFor(ride, 1)],
    });
    const keys = walk(inputFor(from, { pose: POSE, cameraConsented: true })).keys;
    const registered =
      /normali[sz]ed|stress|intensityfactor|^(np|tss|if|ctl|atl|tsb|ftp)$|ftp|chronic|acute|balance/i;
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => registered.test(key))).toStrictEqual([]);
  });
});

describe('the rider', () => {
  it('sends the threshold power when it is set, and says it is absent when it is not', async () => {
    const ride = rideFor(ATHLETE_A);
    const withIt = await saved(ride, streamSetFor(ride, { sampleCount: 600 }), {
      athlete: { thresholdPower: watts(262) },
    });
    expect(inputFor(withIt).rider.thresholdPower).toBe(262);

    await theHarness().destroy();
    harness = createStoreHarness();
    const without = await saved(ride, streamSetFor(ride, { sampleCount: 600 }));
    const input = inputFor(without);
    expect(input.rider.thresholdPower).toBeNull();
    // Null rather than a missing key, so it survives serialisation and a model is TOLD.
    expect(JSON.stringify(input)).toContain('"thresholdPower":null');
  });

  it('gives watts per kilogram when the mass and the power both exist, through the domain', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 1200 }), {
      athlete: { mass: kilograms(64) },
    });
    const input = inputFor(from);
    const power = from.streams?.channels.power ?? [];
    const present = power.filter((sample) => sample !== undefined);
    const mean = present.reduce((sum, sample) => sum + sample, 0) / present.length;
    // Independent arithmetic, not the domain function under test.
    expect(input.whole.wattsPerKilogram?.mean).toBeCloseTo(mean / 64, 2);
    expect(input.whole.wattsPerKilogram?.max).toBeCloseTo(Math.max(...present) / 64, 2);
    expect(input.rider.massKilograms).toBe(64);
    for (const section of input.sections) {
      expect(section.metrics.wattsPerKilogram).toBeDefined();
    }
  });

  it('gives NO watts per kilogram without a mass — never a default mass', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 1200 }));
    const input = inputFor(from);
    expect(input.rider.massKilograms).toBeNull();
    expect(input.whole.power?.mean).toBeDefined();
    expect(input.whole.wattsPerKilogram).toBeUndefined();
    expect(input.sections.every((s) => s.metrics.wattsPerKilogram === undefined)).toBe(true);
  });

  it('gives NO watts per kilogram without a power channel', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(
      ride,
      streamSetFor(ride, { sampleCount: 1200, channels: ['heartRate', 'cadence', 'speed'] }),
      { athlete: { mass: kilograms(70) } },
    );
    const input = inputFor(from);
    expect(input.whole.power).toBeUndefined();
    expect(input.whole.wattsPerKilogram).toBeUndefined();
  });
});

/** A straight road north: flat, a 5 % climb, a 5 % descent, flat — 10 km. */
function hillRoute(): RouteRecord {
  const points: RoutePoint[] = [];
  for (let metre = 0; metre <= 10_000; metre += 50) {
    let height = 100;
    if (metre > 2_000 && metre <= 5_000) {
      height = 100 + (metre - 2_000) * 0.05;
    } else if (metre > 5_000 && metre <= 8_000) {
      height = 250 - (metre - 5_000) * 0.05;
    }
    points.push({
      position: geographicPosition(degreesLatitude(51 + metre / 111_195), degreesLongitude(-0.5)),
      elevation: altitudeMetres(height),
    });
  }
  return { ...routeFor(ATHLETE_A), profile: routeProfile(points, { loop: false }) };
}

/** A ride over the whole of {@link hillRoute} at a steady 5 m/s. */
function rideOverTheHill(route: RouteRecord): { ride: NewActivity; streams: NewStreamSet } {
  const ride = rideFor(ATHLETE_A, { routeId: route.id, distance: metres(10_000) });
  const streams = withChannel(
    streamSetFor(ride, { sampleCount: 2000, channels: ['power', 'heartRate', 'cadence'] }),
    'speed',
    Array.from({ length: 2000 }, () => metresPerSecond(5)),
  );
  return { ride, streams };
}

describe('sections', () => {
  it('follows the saved route’s gradient when the ride was ridden on one', async () => {
    const route = hillRoute();
    const { ride, streams } = rideOverTheHill(route);
    const from = await saved(ride, streams, {
      route,
      laps: [lapFor(ride, 0), lapFor(ride, 1), lapFor(ride, 2)],
    });
    const input = inputFor(from);
    expect(input.sections.map((section) => section.kind)).toStrictEqual([
      'flat',
      'climb',
      'descent',
      'flat',
    ]);
    const [, climb, descent] = input.sections;
    expect(climb?.meanGradientPercent).toBeGreaterThan(3);
    expect(climb?.elevationGainMetres).toBeGreaterThan(120);
    expect(descent?.meanGradientPercent).toBeLessThan(-3);
    expect(descent?.elevationGainMetres).toBe(0);
    expect(input.sections.reduce((sum, s) => sum + (s.distanceKilometres ?? 0), 0)).toBeCloseTo(
      10,
      1,
    );
  });

  it('uses the laps when the route is not saved any more', async () => {
    const route = hillRoute();
    const { ride, streams } = rideOverTheHill(route);
    const from = await saved(ride, streams, {
      laps: [lapFor(ride, 0), lapFor(ride, 1), lapFor(ride, 2)],
    });
    const input = inputFor(from);
    expect(input.sections.map((section) => section.kind)).toStrictEqual(['lap', 'lap', 'lap']);
    expect(input.sections.map((section) => section.laps)).toStrictEqual([
      { first: 1, last: 1 },
      { first: 2, last: 2 },
      { first: 3, last: 3 },
    ]);
  });

  it('uses the laps when a route profile is handed in but the ride was not ridden on it', async () => {
    const route = hillRoute();
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 1800 }), {
      route,
      laps: [lapFor(ride, 0), lapFor(ride, 1), lapFor(ride, 2)],
    });
    expect(inputFor(from).sections.every((section) => section.kind === 'lap')).toBe(true);
  });

  it('falls back to equal stretches of time with no route and fewer than two laps', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 3600 }), {
      laps: [lapFor(ride, 0)],
    });
    const input = inputFor(from);
    expect(input.sections).toHaveLength(MAXIMUM_SECTIONS);
    expect(new Set(input.sections.map((section) => section.kind))).toStrictEqual(new Set(['time']));
    expect(new Set(input.sections.map((section) => section.minutes))).toStrictEqual(new Set([7.5]));
    expect(input.sections.map((section) => section.index)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('merges thirty laps into at most eight sections, covering every lap once', async () => {
    const ride = rideFor(ATHLETE_A);
    const laps = Array.from({ length: 30 }, (_, ordinal) =>
      lapFor(ride, ordinal, ordinal % 3 === 0 ? { elapsedTime: seconds(400) } : {}),
    );
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 30 * 600 }), { laps });
    const input = inputFor(from);
    expect(input.sections.length).toBeLessThanOrEqual(MAXIMUM_SECTIONS);
    expect(input.sections.length).toBeGreaterThan(1);
    let next = 1;
    for (const section of input.sections) {
      expect(section.kind).toBe('lap');
      expect(section.laps?.first).toBe(next);
      next = (section.laps?.last ?? 0) + 1;
    }
    expect(next).toBe(31);
    expect(input.sections.reduce((sum, s) => sum + s.minutes, 0)).toBeCloseTo(300, 5);
  });

  it('keeps a ride shorter than two minimum sections as ONE section, laps and all', async () => {
    const ride = rideFor(ATHLETE_A);
    const samples = 2 * MINIMUM_SECTION_SECONDS - 1;
    const laps = [0, 1, 2].map((ordinal) =>
      lapFor(ride, ordinal, { startedAt: unixSeconds(ride.startedAt + ordinal * 200) }),
    );
    const from = await saved(ride, streamSetFor(ride, { sampleCount: samples }), { laps });
    expect(inputFor(from).sections).toHaveLength(1);

    await theHarness().destroy();
    harness = createStoreHarness();
    const noLaps = await saved(ride, streamSetFor(ride, { sampleCount: samples }));
    expect(inputFor(noLaps).sections).toHaveLength(1);
  });

  it('uses the laps when a ride on a saved route has no speed to place it on the route', async () => {
    const route = hillRoute();
    const ride = rideFor(ATHLETE_A, { routeId: route.id });
    const from = await saved(
      ride,
      streamSetFor(ride, { sampleCount: 1800, channels: ['power', 'heartRate', 'altitude'] }),
      { route, laps: [lapFor(ride, 0), lapFor(ride, 1), lapFor(ride, 2)] },
    );
    const input = inputFor(from);
    expect(input.sections.map((section) => section.kind)).toStrictEqual(['lap', 'lap', 'lap']);
    // No speed channel, so no distance is invented for a section.
    expect(input.sections.every((section) => section.distanceKilometres === undefined)).toBe(true);
  });

  it('never leaves two neighbouring route sections of one kind', async () => {
    // A 1.6 km loop of climbs and descents ridden eleven times: after merging,
    // most sections average out to flat, and neighbours of one kind are one.
    const route = routeFor(ATHLETE_A);
    const ride = rideFor(ATHLETE_A, { routeId: route.id });
    const streams = withChannel(
      streamSetFor(ride, { sampleCount: 3600, channels: ['power'] }),
      'speed',
      Array.from({ length: 3600 }, () => metresPerSecond(5)),
    );
    const from = await saved(ride, streams, { route });
    const kinds = inputFor(from).sections.map((section) => section.kind);
    expect(kinds.length).toBeGreaterThan(0);
    kinds.forEach((kind, index) => {
      if (index > 0) {
        expect(kind).not.toBe(kinds[index - 1]);
      }
    });
  });

  it('counts a lap that starts with another, or after the samples end, in the section before', async () => {
    const ride = rideFor(ATHLETE_A);
    const laps = [
      lapFor(ride, 0),
      lapFor(ride, 1, { startedAt: unixSeconds(ride.startedAt + 900) }),
      lapFor(ride, 2, { startedAt: unixSeconds(ride.startedAt + 900) }),
      lapFor(ride, 3, { startedAt: unixSeconds(ride.startedAt + 9_000) }),
    ];
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 1800 }), { laps });
    expect(inputFor(from).sections.map((section) => section.laps)).toStrictEqual([
      { first: 1, last: 1 },
      { first: 2, last: 4 },
    ]);
  });

  it('has no sections and no metrics for a ride with no samples', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, undefined);
    const input = inputFor(from);
    expect(input.sections).toStrictEqual([]);
    expect(input.whole).toStrictEqual({});
    expect(input.ride.distanceKilometres).toBe(120);
  });
});

describe('a gap is not a zero', () => {
  it('reports a heart-rate dropout as coverage, averaging only what was reported', async () => {
    const ride = rideFor(ATHLETE_A);
    // Ten minutes, two sections of five; the strap drops for 60 s in the first.
    const from = await saved(
      ride,
      streamSetFor(ride, {
        sampleCount: 600,
        gaps: [{ channel: 'heartRate', from: 100, count: 60 }],
      }),
    );
    const input = inputFor(from);
    const first = input.sections[0];
    expect(input.sections).toHaveLength(2);
    expect(first?.metrics.heartRate?.coverage).toBe(0.8);

    const heart = (from.streams?.channels.heartRate ?? []).slice(0, 300);
    const present = heart.filter((sample) => sample !== undefined);
    const fair = present.reduce((sum, sample) => sum + sample, 0) / present.length;
    const zeroed = present.reduce((sum, sample) => sum + sample, 0) / heart.length;
    expect(first?.metrics.heartRate?.mean).toBe(Math.round(fair));
    expect(first?.metrics.heartRate?.mean).not.toBe(Math.round(zeroed));
    expect(input.sections[1]?.metrics.heartRate?.coverage).toBe(1);
  });

  it('says a mostly-missing channel is mostly missing, and gives no figure for it', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(
      ride,
      streamSetFor(ride, {
        sampleCount: 600,
        gaps: [{ channel: 'heartRate', from: 0, count: 240 }],
      }),
    );
    const first = inputFor(from).sections[0]?.metrics.heartRate;
    expect(first?.coverage).toBeLessThan(MINIMUM_REPORTED_COVERAGE);
    expect(first).toStrictEqual({ coverage: 0.2 });
  });

  it('averages a channel with no gap over every sample', async () => {
    const ride = rideFor(ATHLETE_A);
    const set = withChannel(
      streamSetFor(ride, { sampleCount: 300 }),
      'heartRate',
      Array.from({ length: 300 }, (_, index) => beatsPerMinute(index < 150 ? 100 : 120)),
    );
    const from = await saved(ride, set);
    expect(inputFor(from).whole.heartRate).toStrictEqual({ coverage: 1, mean: 110, max: 120 });
  });
});

describe('the pose summary', () => {
  it.each([
    { present: true, consented: true, sent: true },
    { present: true, consented: false, sent: false },
    { present: false, consented: true, sent: false },
    { present: false, consented: false, sent: false },
  ])('present $present, consented $consented: sent $sent', async ({ present, consented, sent }) => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 1800 }));
    const input = inputFor(from, {
      ...(present ? { pose: POSE } : {}),
      cameraConsented: consented,
    });
    if (sent) {
      expect(input.pose).toStrictEqual(POSE);
    } else {
      expect(input.pose).toBeUndefined();
      expect(JSON.stringify(input)).not.toContain('posesCompared');
    }
  });

  it('never appears inside a section', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 3600 }));
    const input = inputFor(from, { pose: POSE, cameraConsented: true });
    expect(input.pose).toBeDefined();
    const inSections = walk(input.sections).keys.filter((key) =>
      ['pose', 'posesCompared', 'differences', 'source', 'knee', 'torso'].includes(key),
    );
    expect(inSections).toStrictEqual([]);
  });

  it('sends only the fields it declares, and nothing with a source it does not know', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 600 }));
    const extra = {
      ...POSE,
      note: 'the rider in the kitchen',
      differences: { ...POSE.differences, hips: 4 },
    };
    expect(inputFor(from, { pose: extra, cameraConsented: true }).pose).toStrictEqual(POSE);
    const unknown = { ...POSE, source: 'cloud' } as unknown as SideSessionSummary;
    expect(inputFor(from, { pose: unknown, cameraConsented: true }).pose).toBeUndefined();
  });
});

describe('the size of the input', () => {
  it(`stays under ${String(INPUT_BYTE_BUDGET)} bytes for the largest ride this client imports`, async () => {
    const ride = rideFor(ATHLETE_A);
    const laps = Array.from({ length: 30 }, (_, ordinal) =>
      lapFor(ride, ordinal, { startedAt: unixSeconds(ride.startedAt + ordinal * 5_760) }),
    );
    const from = await saved(ride, streamSetFor(ride, { sampleCount: MAXIMUM_IMPORTED_SAMPLES }), {
      athlete: { mass: kilograms(70.4), thresholdPower: watts(255) },
      laps,
    });
    const input = inputFor(from, {
      pose: {
        source: 'computer',
        posesCompared: 54_000,
        differences: { torso: -12.34, knee: 8.76, elbow: -10.11, head: 0.12, saddle: -0.09 },
      },
      cameraConsented: true,
    });
    expect(input.sections).toHaveLength(MAXIMUM_SECTIONS);
    const bytes = new TextEncoder().encode(JSON.stringify(input)).length;
    expect(bytes).toBeLessThan(INPUT_BYTE_BUDGET);
  });
});

describe('purity', () => {
  it('gives the same input for the same ride, every time', async () => {
    const ride = rideFor(ATHLETE_A);
    const from = await saved(ride, streamSetFor(ride, { sampleCount: 3600 }), {
      athlete: { mass: kilograms(70) },
    });
    expect(inputFor(from)).toStrictEqual(inputFor(from));
  });
});
