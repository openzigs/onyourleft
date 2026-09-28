// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The whole app, handed in-memory ports that are either EMPTY (a device that
 * has recorded nothing) or POPULATED (forty rides with long names, a ride with
 * a track, a chart, laps and a side-camera report, a segment with efforts, a
 * route — on the Routes screen and in the game's picker — a workout).
 *
 * Moved out of `browser/reflow-harness.tsx` by #668 unchanged, so that two
 * gates walk every route over ONE fixture: the reflow walk (#660), which lays
 * each route out in a real engine, and the one-primary gate
 * (`a11y/button-hierarchy.a11y.test.tsx`), which counts each route's primary
 * buttons in jsdom. A fixture copied into the second would drift from the
 * first, and the second would then be checking routes nobody lays out.
 *
 * {@link POPULATED} is what a route shows when these fixtures reach it; both
 * gates hold every route to it, so a fixture that stopped reaching its view
 * fails rather than measuring the empty state twice.
 *
 * ⚠️ It names no map. The reflow page supplies the real MapLibre port and a
 * basemap; jsdom has no WebGL and supplies neither.
 */

import type { JSX } from 'react';

import {
  altitudeMetres,
  beatsPerMinute,
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  routeProfile,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type GeographicPosition,
  type RoutePoint,
  type WorkoutBlock,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  segmentEffortId,
  segmentId,
  workoutId,
  type ActivityRecord,
  type AthleteRecord,
  type SegmentEffortRecord,
  type SegmentRecord,
} from '@onyourleft/store';

import type { AthleteMassPort } from '../athlete/store-port';
import type { GamePort } from '../game/GameView';
import { NO_SENSORS } from '../game/sensors';
import { stubAnalysis } from '../analysis/testing';
import { CameraController } from '../camera/session';
import { SIDE_OBSERVATION_SENTENCES, SIDE_REPORT_OBSERVED } from '../camera/side-report-wording';
import { stubActivity, stubDetail, stubLap } from '../detail/testing';
import { stubEffortPort } from '../efforts/testing';
import { stubLibrary } from '../library/testing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { routeStub, stubRouteId } from '../routes/testing';
import { stubMatchPort } from '../segments/match-testing';
import { stubSegments } from '../segments/testing';
import { AppShell, type AppShellProps } from '../shell/AppShell';
import type { RouteId } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import type { UnitsPort } from '../units/store-port';
import { workoutStub } from '../workouts/testing';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const ATHLETE = athleteId('local');
const NOW = 1_760_000_000;
const DAY = 86_400;
const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = { latitude: 51.5, longitude: -0.12 };

/** The ride and the segment the populated fixtures hold. */
const RIDE_ID = 'ride-0';
const SEGMENT_ID = 'the-drag';

/**
 * The parameter each parameterised route is opened with. A route in
 * `ALL_ROUTES` whose path has a `:` segment and no entry here is reported by
 * the spec, never skipped.
 */
export const PARAMETERS: Partial<Record<RouteId, string>> = {
  'activity-detail': RIDE_ID,
  'segment-detail': SEGMENT_ID,
};

/**
 * What a route shows when its fixtures reach it, for EVERY route in the table.
 *
 * A fixture that stopped reaching its view would otherwise measure the empty
 * state twice and call it both. This was a `Partial` list of five markers
 * until #683's review, and the review emptied the routes, workouts and analysis
 * fixtures — three of the routes that overflowed on `main` — with all three
 * populated walks staying green: an allowlist of markers misses a route by
 * saying nothing about it. So it is a `Record` over {@link RouteId}, a route
 * added to the table without an entry here is a compile error, and the spec
 * ALSO fails a route this page publishes no entry for, taken from `ALL_ROUTES`
 * at run time (#142's rule), in case the type is ever widened back.
 *
 * - `fixture` — the selector is present in the POPULATED walk and ABSENT in the
 *   empty one. The absence is what proves the selector tells the two apart; a
 *   marker the empty state also satisfies would pass over an emptied fixture.
 * - `constant` — the route's content does not come from these fixtures, and
 *   the selector must be present in BOTH walks.
 * - `none` — nothing on the route comes from these fixtures, and the reason
 *   says why. ⚠️ A `none` is a statement about THIS harness, not about the
 *   screen: `transfer` has data-dependent content and is handed no port here,
 *   and the reason says so rather than calling the screen static.
 */
export type PopulatedExpectation =
  | { readonly kind: 'fixture'; readonly marker: string }
  | { readonly kind: 'constant'; readonly marker: string; readonly reason: string }
  | { readonly kind: 'none'; readonly reason: string };

export const POPULATED: Record<RouteId, PopulatedExpectation> = {
  home: { kind: 'fixture', marker: '.oyl-main .oyl-home__facts' },
  ride: { kind: 'fixture', marker: '.oyl-main .oyl-metric--live' },
  game: { kind: 'fixture', marker: '.oyl-game__picker li input[type="checkbox"]' },
  workouts: { kind: 'fixture', marker: '.oyl-main .oyl-scroll-region tbody tr' },
  activities: { kind: 'fixture', marker: '.oyl-main a[href^="#/activities/"]' },
  analysis: { kind: 'fixture', marker: '.oyl-main .oyl-scroll-region tbody tr' },
  segments: { kind: 'fixture', marker: '.oyl-main a[href^="#/segments/"]' },
  routes: { kind: 'fixture', marker: '.oyl-main .oyl-scroll-region tbody tr' },
  'activity-detail': { kind: 'fixture', marker: '.oyl-side-report' },
  'segment-detail': { kind: 'fixture', marker: '.oyl-main tbody tr' },
  credits: {
    kind: 'constant',
    marker: '.oyl-main code',
    reason: 'generated from ASSETS.toml at build time, the same in both walks',
  },
  devices: {
    kind: 'none',
    reason:
      'what it lists comes from Bluetooth, and this page hands it a browser with none — the same in both walks',
  },
  transfer: {
    kind: 'none',
    reason:
      'handed no transfer port, so it shows its not-available state in both walks; its forms with a store behind them are NOT walked here',
  },
  camera: {
    kind: 'none',
    reason: 'the camera this page hands it opens nothing, so it is the same in both walks',
  },
  settings: {
    kind: 'none',
    reason: 'its forms are the same whatever is stored; nothing it renders is a list of data',
  },
  about: { kind: 'none', reason: 'static prose' },
  'route-builder': {
    kind: 'none',
    reason:
      'handed no routing provider, and its draft is local storage rather than a port — the same in both walks',
  },
  'side-camera': {
    kind: 'none',
    reason: 'handed no pairing, so it shows its before-pairing state in both walks',
  },
  'not-found': { kind: 'none', reason: 'static: a heading and the route list' },
};

/** How many rides the populated library holds — more than a page of cards. */
export const POPULATED_RIDES = 40;

function north(metresNorth: number, metresEast = 0): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(
      ORIGIN.longitude +
        metresEast / (METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
    ),
  );
}

/** Long names, with spaces and without, because a name is where a row gets wide. */
function rideName(index: number): string {
  if (index % 7 === 3) {
    return `Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch loop ${String(index)}`;
  }
  return `An extraordinarily long Sunday morning club ride out to the reservoir and back again ${String(index)}`;
}

function ride(index: number): ActivityRecord {
  return stubActivity({
    id: activityId(`ride-${String(index)}`),
    athleteId: ATHLETE,
    name: rideName(index),
    startedAt: unixSeconds(NOW - index * DAY),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3 * 3600 + 17 * 60),
    movingTime: seconds(3 * 3600 + 2 * 60),
    distance: metres(123_456),
    averagePower: watts(234),
    hasPosition: index % 2 === 0,
  });
}

function detailPort(populated: boolean): ReturnType<typeof stubDetail> {
  const count = 1800;
  const track = Array.from({ length: count }, (_unused, index) =>
    north(index * 8, Math.sin(index / 90) * 400),
  );
  return stubDetail(ATHLETE, {
    // Empty: a ride that is not the one the route asks for, so the page says
    // the ride is not on this device.
    activity: populated ? ride(0) : { ...ride(0), id: activityId('not-this-one') },
    channels: {
      power: Array.from({ length: count }, (_unused, index) => watts(150 + (index % 97))),
      heartRate: Array.from({ length: count }, () => beatsPerMinute(151)),
      cadence: Array.from({ length: count }, () => revolutionsPerMinute(88)),
      speed: Array.from({ length: count }, () => metresPerSecond(8.2)),
      altitude: Array.from({ length: count }, (_unused, index) =>
        altitudeMetres(40 + (index % 300) / 3),
      ),
      latitude: track.map((position) => position.latitude),
      longitude: track.map((position) => position.longitude),
    },
    laps: Array.from({ length: 12 }, (_unused, index) =>
      stubLap(index, { activityId: activityId(RIDE_ID), athleteId: ATHLETE }),
    ),
    sideCamera: {
      athleteId: ATHLETE,
      activityId: activityId(RIDE_ID),
      summary: SIDE_REPORT_OBSERVED,
      observations: [
        SIDE_OBSERVATION_SENTENCES.torso.decreased,
        SIDE_OBSERVATION_SENTENCES.knee.increased,
      ],
    },
  });
}

function theSegment(): SegmentRecord {
  const built = createSegment({
    id: SEGMENT_ID,
    createdBy: ATHLETE,
    name: 'The long drag up past the reservoir, the farm and the old quarry',
    sport: 'ride',
    geometry: [north(0), north(250), north(500)],
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(NOW),
  });
  return { ...built, id: segmentId(SEGMENT_ID), createdBy: ATHLETE };
}

function effort(id: string, index: number, elapsed: number): SegmentEffortRecord {
  return {
    id: segmentEffortId(id),
    athleteId: ATHLETE,
    segmentId: segmentId(SEGMENT_ID),
    activityId: activityId(`ride-${String(index)}`),
    startedAt: unixSeconds(NOW - index * DAY + 100),
    elapsed: seconds(elapsed),
    deviation: metres(5),
    visibility: 'public',
    attributes: {},
  };
}

function effortTrack(speed: number): GeographicPosition[] {
  const track: GeographicPosition[] = [];
  for (let at = 0; at <= 500 / speed + 1e-9; at += 1) {
    track.push(north(at * speed));
  }
  return track;
}

function routePoints(): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= 3000; along += 25) {
    points.push({ position: north(2000 + along), elevation: altitudeMetres(30 + along / 100) });
  }
  return points;
}

function settingsPort(): UnitsPort {
  return {
    athleteId: ATHLETE,
    store: {
      setAthleteUnits: (id, units): Promise<AthleteRecord | undefined> =>
        Promise.resolve({ id, displayName: 'You', createdAt: unixSeconds(NOW), units }),
    },
  };
}

function athleteMassPort(): AthleteMassPort {
  return {
    athleteId: ATHLETE,
    store: {
      setAthleteMass: (id, mass): Promise<AthleteRecord | undefined> =>
        Promise.resolve({
          id,
          displayName: 'You',
          createdAt: unixSeconds(NOW),
          ...(mass === undefined ? {} : { mass }),
        }),
    },
  };
}

/** A camera that never opens anything — `shell-harness.tsx`'s, for its reason. */
function quietCamera(): CameraController {
  return new CameraController({
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'no-camera' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'no-camera' as const }),
      startCamera: () => Promise.reject(new Error('this harness opens no camera')),
    },
    schedule: () => () => undefined,
  });
}

/**
 * The trainer game's routes. Populated: one route with a long name, which the
 * picker lists with its ghost checkbox. No ride is started — this page has no
 * renderer — so the sensors are never read.
 */
function gamePort(populated: boolean): GamePort {
  return {
    listRoutes: () =>
      Promise.resolve(
        populated
          ? [
              {
                id: 'route-1',
                name: 'Box Hill, Leith Hill and every lane between them the long way round',
                profile: routeProfile(routePoints()),
                attempts: 0,
              },
            ]
          : [],
      ),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => NO_SENSORS,
  };
}

/**
 * What a caller supplies that this fixture does not — a map and its basemap —
 * or replaces: the ride controller, for a state of the ride screen neither
 * fixture reaches (the one-primary gate's paused-with-a-stop-armed case).
 */
export type PopulatedShellExtras = Pick<AppShellProps, 'map' | 'basemap' | 'rideController'>;

/** The real `AppShell` over the empty or the populated fixture. */
export function PopulatedShell({
  populated,
  ...extras
}: { readonly populated: boolean } & PopulatedShellExtras): JSX.Element {
  const rides = populated
    ? Array.from({ length: POPULATED_RIDES }, (_unused, index) => ride(index))
    : [];
  const segment = theSegment();
  const segmentTrack = Array.from({ length: 30 }, (_unused, index) => north(index * 20));
  const workoutBlocks: readonly WorkoutBlock[] = [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
    { kind: 'steady', seconds: seconds(1200), target: thresholdShare(0.9) },
  ];
  return (
    <AppShell
      capabilities={NO_BLUETOOTH}
      camera={quietCamera()}
      rideController={stubRideController(populated ? ridingSnapshot() : idleSnapshot()).controller}
      settings={settingsPort()}
      athleteMass={athleteMassPort()}
      library={stubLibrary(ATHLETE, rides)}
      detail={detailPort(populated)}
      analysis={stubAnalysis(
        ATHLETE,
        rides.map((activity) => ({
          activity: {
            ...activity,
            effortWeightedPower: watts(210),
            loadCoveredTime: seconds(3600),
          },
        })),
      )}
      segments={stubSegments(
        ATHLETE,
        populated ? [{ activity: ride(0), track: segmentTrack }] : [],
        populated ? { existing: [segment] } : {},
      )}
      match={stubMatchPort({
        athleteId: ATHLETE,
        rides: populated ? [{ activity: ride(0), track: segmentTrack }] : [],
        segments: populated ? [segment] : [],
      })}
      efforts={stubEffortPort({
        athleteId: ATHLETE,
        segments: populated ? [segment] : [],
        efforts: populated
          ? [effort('quick', 1, 88), effort('middling', 2, 96), effort('slow', 3, 131)]
          : [],
        rides: populated
          ? [1, 2, 3].map((index, order) => ({
              activity: ride(index),
              track: effortTrack(5 + order),
              sampleIntervalSeconds: 1,
            }))
          : [],
      })}
      routes={routeStub(
        ATHLETE,
        populated
          ? [
              {
                id: stubRouteId('route-1'),
                createdBy: ATHLETE,
                name: 'Box Hill, Leith Hill and every lane between them the long way round',
                profile: routeProfile(routePoints()),
                visibility: 'private',
                createdAt: unixSeconds(NOW),
                updatedAt: unixSeconds(NOW),
              },
            ]
          : [],
      )}
      workouts={workoutStub(
        ATHLETE,
        populated
          ? [
              {
                id: workoutId('workout-1'),
                createdBy: ATHLETE,
                name: 'Sweet spot over-unders with a very long name for a small screen',
                workout: { name: 'Sweet spot', blocks: workoutBlocks },
                createdAt: unixSeconds(NOW),
                updatedAt: unixSeconds(NOW),
              },
            ]
          : [],
      )}
      game={gamePort(populated)}
      {...extras}
    />
  );
}
