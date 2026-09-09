// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every local boundary where data leaves the athlete's control, checked with
 * one property — and every boundary where it comes back to them, checked with
 * the opposite one.
 *
 * See [`boundaries.ts`](./boundaries.ts) for why the check walks the payload
 * instead of reading its fields, and why a sweep that trimmed everywhere would
 * be a failed acceptance criterion rather than a safe default.
 *
 * ## The enumeration fails closed
 *
 * A registry of boundaries is the hand-written list #34 warns about, so it is
 * checked against the files on disk: any module under `apps/web/src` named
 * `share.ts`, `privacy.ts` or `export-*.ts` must appear in {@link BOUNDARIES},
 * and every entry must name a file that is there. A new sharing surface turns
 * this red until somebody declares which direction it faces; a deleted one
 * turns it red rather than leaving an assertion that has stopped meaning
 * anything — the rule `LIC006` applies to `.spdx-exempt`, applied here.
 *
 * ⚠️ **What that convention cannot catch**, stated so nobody reads more into a
 * green run than it earns: a boundary in a file named something else. The file
 * name is the only signal available without a call-graph analysis, and a
 * convention that is checked is worth more than an analysis that is not — but
 * it is a convention, not a proof, and a reviewer adding a sharing path is the
 * remaining control.
 */

import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeGpx } from '@onyourleft/fit';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
} from '@onyourleft/store/testing';
import type { PrivacyZoneRecord } from '@onyourleft/store';
import { privacyZoneId } from '@onyourleft/store';
import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  metres,
  unixSeconds,
} from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sharedTrack } from '../detail/privacy';
import { routeShare } from '../routes/share';
import { exportActivity } from '../transfer/export-activity';

import { coordinatesIn, insideZone } from './boundaries';

/** Small enough to be quick, long enough to enter a zone and leave it again. */
const SAMPLE_COUNT = 400;

/** 50 m, so a zone covers part of the fixture track rather than all of it. */
const ZONE_RADIUS_METRES = 50;

/**
 * Which way a payload is going.
 *
 * `departing` — for somebody else; no coordinate inside a zone.
 * `retained` — the athlete's own data, back to them; the true coordinates stay.
 */
type Direction = 'departing' | 'retained';

interface Boundary {
  /** Path relative to `apps/web/src`, matched against the files on disk. */
  readonly module: string;
  readonly what: string;
  readonly direction: Direction;
}

const BOUNDARIES: readonly Boundary[] = [
  {
    module: 'detail/privacy.ts',
    what: 'the track a shared copy of a ride carries',
    direction: 'departing',
  },
  {
    module: 'routes/share.ts',
    what: 'the geometry a shared copy of a route carries',
    direction: 'departing',
  },
  {
    module: 'transfer/export-activity.ts',
    what: "the athlete's own ride, written to a file they asked for",
    // ⚠️ Not a mistake, and the one entry in this table worth reading twice.
    // #35: "privacy zones protect the user from others, not from themselves."
    // An export that trimmed would hand the athlete a corrupted copy of their
    // own ride and call it a privacy feature.
    direction: 'retained',
  },
];

const sourceRoot = new URL('../', import.meta.url);

/** Every `share.ts`, `privacy.ts` and `export-*.ts` under `apps/web/src`. */
function boundaryModulesOnDisk(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(fileURLToPath(directory))) {
      const child = new URL(`${entry}${entry.includes('.') ? '' : '/'}`, directory);
      if (statSync(fileURLToPath(child)).isDirectory()) {
        walk(new URL(`${entry}/`, directory), `${prefix}${entry}/`);
        continue;
      }
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
        continue;
      }
      if (entry === 'share.ts' || entry === 'privacy.ts' || entry.startsWith('export-')) {
        found.push(`${prefix}${entry}`);
      }
    }
  };
  walk(sourceRoot, '');
  return found.sort();
}

/** A zone over the middle of a track, so the payload enters it and leaves. */
function zoneOver(
  positions: readonly { latitude: number; longitude: number }[],
): PrivacyZoneRecord {
  const middle = positions[Math.floor(positions.length / 2)];
  expect(middle).toBeDefined();
  return {
    id: privacyZoneId('zone-home'),
    athleteId: ATHLETE_A,
    centre: geographicPosition(
      degreesLatitude(middle?.latitude ?? 0),
      degreesLongitude(middle?.longitude ?? 0),
    ),
    radius: metres(ZONE_RADIUS_METRES),
    label: 'home',
    createdAt: unixSeconds(1_700_000_000),
  };
}

describe('the boundary registry is checked against the files on disk', () => {
  it('finds boundary modules at all', () => {
    // The vacuous pass: a walker that returned nothing would make the two
    // assertions below trivially true in both directions.
    expect(boundaryModulesOnDisk().length).toBeGreaterThanOrEqual(3);
  });

  it('declares every boundary module that exists', () => {
    const declared = new Set(BOUNDARIES.map((boundary) => boundary.module));
    const undeclared = boundaryModulesOnDisk().filter((module) => !declared.has(module));
    expect(
      undeclared,
      'a new sharing or export module must declare which direction it faces',
    ).toStrictEqual([]);
  });

  it('declares no boundary module that has gone', () => {
    const onDisk = new Set(boundaryModulesOnDisk());
    const stale = BOUNDARIES.map((boundary) => boundary.module).filter(
      (module) => !onDisk.has(module),
    );
    expect(stale, 'this entry names a module that is no longer there').toStrictEqual([]);
  });
});

describe('coordinatesIn finds a position wherever it sits', () => {
  const here = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

  it('finds one at the top level', () => {
    expect(coordinatesIn(here)).toHaveLength(1);
  });

  it('finds one nested behind a field nobody thought about', () => {
    const found = coordinatesIn({ summary: { thumbnail: { centre: here } } });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('$.summary.thumbnail.centre');
  });

  it('finds one inside an array', () => {
    expect(coordinatesIn({ points: [{ position: here }, { position: here }] })).toHaveLength(2);
  });

  it('does not mistake two numbers for a position', () => {
    // The documented limit, asserted rather than left as prose: a bare
    // [longitude, latitude] pair is not recognised and cannot be.
    expect(coordinatesIn({ bounds: [-0.12, 51.5] })).toStrictEqual([]);
  });

  it('ignores an object carrying only one of the two', () => {
    expect(coordinatesIn({ latitude: 51.5 })).toStrictEqual([]);
  });

  it('terminates on a cycle rather than hanging', () => {
    const cyclic: Record<string, unknown> = { position: here };
    cyclic['self'] = cyclic;
    expect(coordinatesIn(cyclic)).toHaveLength(1);
  });
});

describe('a departing payload carries no coordinate inside a privacy zone', () => {
  it('a shared ride does not, in any field', () => {
    const ride = rideFor(ATHLETE_A, { hasPosition: true });
    const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
    const latitude = streams.channels.latitude;
    const longitude = streams.channels.longitude;
    expect(latitude && longitude).toBeTruthy();
    const positions = (latitude ?? []).map((each, index) => ({
      latitude: each ?? 0,
      longitude: longitude?.[index] ?? 0,
    }));
    const zone = zoneOver(positions);

    const shared = sharedTrack({ activityId: ride.id, latitude, longitude, zones: [zone] });

    // The fixture has to be one where trimming actually happened, or "nothing
    // inside the zone" is true because the zone was nowhere near the ride.
    expect(shared.trimmedPoints).toBeGreaterThan(0);
    // And something has to survive, or it is true because there is no payload.
    expect(shared.segments.flatMap((segment) => segment.points).length).toBeGreaterThan(0);

    const found = coordinatesIn(shared);
    expect(found.length).toBeGreaterThan(0);
    expect(insideZone(found, zone, ride.id).map((each) => each.path)).toStrictEqual([]);
  });

  it('a shared route does not, in any field', () => {
    const route = routeFor(ATHLETE_A, { loop: false, spacingMetres: 10, sideMetres: 400 });
    const zone = zoneOver(route.profile.positions);

    const share = routeShare(route, [zone]);

    expect(share.track.trimmedPoints).toBeGreaterThan(0);
    const found = coordinatesIn(share);
    expect(found.length).toBeGreaterThan(0);
    expect(insideZone(found, zone, route.id).map((each) => each.path)).toStrictEqual([]);
  });

  it('a shared ride withholds the whole of a zone it never leaves', () => {
    // The other end of the range: when everything is inside, the payload is
    // empty rather than partially trimmed, and `zonesApplied` is what tells a
    // rider "you have no zones" apart from "this ride never went near one".
    const ride = rideFor(ATHLETE_A, { hasPosition: true });
    const streams = streamSetFor(ride, { sampleCount: 20 });
    const latitude = streams.channels.latitude;
    const longitude = streams.channels.longitude;
    const positions = (latitude ?? []).map((each, index) => ({
      latitude: each ?? 0,
      longitude: longitude?.[index] ?? 0,
    }));
    const wide: PrivacyZoneRecord = { ...zoneOver(positions), radius: metres(5_000) };

    const shared = sharedTrack({ activityId: ride.id, latitude, longitude, zones: [wide] });

    expect(shared.segments).toStrictEqual([]);
    expect(shared.startsAtIndex).toBeUndefined();
    expect(coordinatesIn(shared)).toStrictEqual([]);
  });
});

describe("a retained payload keeps the athlete's own coordinates", () => {
  let harness: ReturnType<typeof createStoreHarness>;

  beforeEach(() => {
    resetFixtureIds();
    harness = createStoreHarness();
  });

  afterEach(async () => {
    await harness.destroy();
  });

  it('an export of your own ride is not trimmed, zone or no zone', async () => {
    // #35: "Export returns the athlete's true, unobfuscated track data for
    // their own activities — privacy zones protect the user from others, not
    // from themselves." Asserted on the file's own bytes, decoded back, rather
    // than on anything the screen rendered.
    await seedAthletes(harness);
    const ride = rideFor(ATHLETE_A, { hasPosition: true });
    const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
    const latitude = streams.channels.latitude;
    const longitude = streams.channels.longitude;
    const positions = (latitude ?? []).map((each, index) => ({
      latitude: each ?? 0,
      longitude: longitude?.[index] ?? 0,
    }));
    const zone = zoneOver(positions);

    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streams);
      await store.putPrivacyZone(zone);
    });

    const exported = await harness.read(async (store) =>
      exportActivity({ store, athleteId: ATHLETE_A, activityId: ride.id, format: 'gpx' }),
    );

    // `decodeGpx` takes text; the export is bytes, because that is what a
    // download is. Decoding through `TextDecoder` here rather than asserting on
    // a substring of the XML: a regex over the markup would pass on a file that
    // was well-formed nonsense, and this is the one boundary whose payload is a
    // file rather than an object.
    const decoded = decodeGpx(new TextDecoder().decode(exported.file.bytes));
    const written = coordinatesIn(decoded);
    expect(written.length).toBeGreaterThan(0);

    // The point of the test: the samples that a *shared* copy would withhold
    // are present here. Not "some coordinates survived" — these ones did.
    const withheld = insideZone(written, zone, ride.id);
    expect(withheld.length).toBeGreaterThan(0);

    // And the athlete's own centre is in there at full precision, which is the
    // strongest form of "not obfuscated" available.
    const nearest = Math.min(
      ...written.map((each) => distanceBetween(each.position, zone.centre) as number),
    );
    expect(nearest).toBeLessThan(1);
  });
});
