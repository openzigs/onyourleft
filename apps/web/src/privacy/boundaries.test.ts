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
 *
 * ⚠️ **And it has already been wrong once, in the pull request that introduced
 * it.** The first walk matched `export-*` and not `export.ts`, so
 * `routes/export.ts` — #74's head-unit export, in the tree since before any of
 * this — was outside the registry while #218's body said the registry failed
 * closed. The lesson is not "add the case"; it is that a *pattern* over file
 * names is the part of this that can be silently narrow, so a new boundary
 * whose name does not match is still a reviewer's job.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
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

import { analysisRequestBody } from '../camera/analysis-transport';
import { capturedFrame } from '../camera/frame';
import { cleanFrameBytes } from '../camera/testing';
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
    module: 'routes/export.ts',
    what: "a saved route written to a file for the rider's own head unit",
    // Retained: it is the athlete's route going to the athlete's own Garmin.
    // `routes/share.ts` is the departing sibling and does trim; these two
    // being adjacent and opposite is exactly why the direction is declared
    // rather than inferred from the folder.
    direction: 'retained',
  },
  {
    module: 'transfer/export-everything.ts',
    what: 'every ride this athlete has, every picture they kept, and a manifest of everything else',
    // ⚠️ This entry was written because the registry demanded it. The file was
    // added in the same pull request as this test, and the "declares every
    // boundary module that exists" case went red the moment it landed — which
    // is the choke point doing its job on its own author, and worth recording
    // as the first time it fired for real rather than under a mutation.
    direction: 'retained',
  },
  {
    module: 'camera/analysis-transport.ts',
    what: "one picture and a fixed question, sent to the rider's own computer on a press (#387)",
    // ⚠️ Departing, and the first departing boundary that crosses a network.
    // ADR 0029 D-9's table: *"A frame to the rider's own machine for analysis —
    // departing. It is leaving the athlete's control."* The walk below finds no
    // coordinate in any field around the picture; what it cannot do is look
    // inside the picture, which is why D-9 re-encodes it at capture — see
    // `boundaries.ts`' own header, and `analysis-transport.test.ts` for the key
    // set the body is pinned to.
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
      // ⚠️ `export.ts` as well as `export-*`. The first version of this walk
      // matched only the hyphenated form and silently missed
      // `routes/export.ts` — #74's head-unit export, a real boundary module
      // that had been in the tree the whole time. A registry that claims to
      // fail closed and does not is worse than no registry, because #218's
      // pull request said it did.
      // ⚠️ And `*-transport.ts` since #387: a module that sends something off
      // the device is a boundary by definition, and a name that says so is
      // the only signal this walk has. `privacy/no-network.test.ts` is the
      // stronger check — it pins WHICH module may send at all — and this one
      // makes that module declare which way it faces.
      if (
        entry === 'share.ts' ||
        entry === 'privacy.ts' ||
        entry === 'export.ts' ||
        entry.startsWith('export-') ||
        entry.endsWith('-transport.ts')
      ) {
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

describe('the picture sent to the rider’s own computer carries no coordinate beside it — #387', () => {
  it('has none in any field, even when the ride it came from had a home zone', () => {
    const frame = capturedFrame({
      bytes: cleanFrameBytes(2048),
      mediaType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    const body = analysisRequestBody('a-model', { frame, question: 'connection-check' });
    // Departing: no coordinate may lie inside a zone — and there is no
    // coordinate at all, which is the stronger statement and the true one.
    expect(coordinatesIn(body)).toStrictEqual([]);
  });

  it('would find one if a field carried it — the walk is not blind to this payload', () => {
    // The control: the same body with a position added where a careless change
    // would put one. Without this, an empty walk proves only that the walk ran.
    const frame = capturedFrame({
      bytes: cleanFrameBytes(2048),
      mediaType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    const body = {
      ...analysisRequestBody('a-model', { frame, question: 'connection-check' }),
      where: { latitude: 51.5, longitude: -0.12 },
    };
    expect(coordinatesIn(body)).toHaveLength(1);
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

/* -------------------------------------------------------------------------- *
 * #384, ADR 0029 D-9: what this walk cannot see.
 * -------------------------------------------------------------------------- */

describe('the walk cannot see inside image bytes, and says so', () => {
  it('finds a coordinate in a field', () => {
    // The control. Without it, the assertion below would be equally true of a
    // walker that had stopped finding anything at all.
    const payload = {
      takenAt: geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    };
    expect(coordinatesIn(payload)).toHaveLength(1);
  });

  it('finds NOTHING in a buffer that spells one out', () => {
    // ⚠️ This is the blindness, demonstrated rather than described. The bytes
    // below are an Exif header followed by an ASCII latitude and longitude —
    // far cruder than a real GPS IFD, and already invisible. A `departing`
    // boundary over this payload is green, and it is green for a reason
    // entirely unrelated to the picture.
    const text = 'Exif\0\0GPSLatitude 51.500000 GPSLongitude -0.120000';
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    expect(coordinatesIn({ picture: bytes })).toStrictEqual([]);
  });

  it('is what ADR 0029 D-9 says, and this file’s header says it', () => {
    // #384's criterion is that `boundaries.ts` *"must say in its own header
    // that it cannot inspect image bytes, so that a future reader does not take
    // a green walk as evidence about a frame"*, and that it is an acceptance
    // criterion rather than a courtesy. A note nobody checks is a note somebody
    // deletes while tidying.
    const header = readFileSync(fileURLToPath(new URL('./boundaries.ts', import.meta.url)), 'utf8');
    expect(header).toContain('cannot inspect image bytes');
    expect(header).toContain('frame.ts');
  });
});
