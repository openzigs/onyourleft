// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The whole app, handed in-memory ports that are either EMPTY (a device that
 * has recorded nothing) or POPULATED (forty rides with long names, a ride with
 * a track, a chart, laps, a side-camera report and — since #805 — a model's
 * long write-up with the ask control set up, a segment with efforts, a
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

import { useState, type JSX } from 'react';

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
  type UnixSeconds,
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
  type RideWriteUpRecord,
  type SegmentEffortRecord,
  type SegmentRecord,
} from '@onyourleft/store';

import type { AthleteMassPort } from '../athlete/store-port';
import type { GamePort } from '../game/GameView';
import { NO_SENSORS } from '../game/sensors';
import { stubAnalysis } from '../analysis/testing';
import { CameraController } from '../camera/session';
import type { SidePairingPort } from '../camera/side-pairing-port';
import { scriptedSidePairing } from '../camera/testing';
import { SIDE_OBSERVATION_SENTENCES, SIDE_REPORT_OBSERVED } from '../camera/side-report-wording';
import { stubActivity, stubDetail, stubLap } from '../detail/testing';
import type { AskOutcome, RideAnalysisPort } from '../ride-analysis/ride-analysis-port';
import type {
  InstanceAnalysisPort,
  InstanceAskOutcome,
} from '../ride-analysis/instance-analysis-port';
import { stubEffortPort } from '../efforts/testing';
import { stubLibrary } from '../library/testing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { routeStub, stubRouteId } from '../routes/testing';
import { addWaypoint, emptyDraft, type RouteDraft } from '../routing/draft';
import { DRAFT_STORAGE_KEY, serialiseDraft } from '../routing/draft-storage';
import { stubMatchPort } from '../segments/match-testing';
import { stubSegments } from '../segments/testing';
import { scriptedInstance, scriptedModeration } from '../instance/testing';
import { AppShell, type AppShellProps } from '../shell/AppShell';
import type { RouteId } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import type { UnitsPort } from '../units/store-port';
import type { MaskedWordsPort } from '../athlete/masked-words-port';
import type { RiderTextPort } from '../rider-text/rider-text-port';
import { memoryRiderText } from '../rider-text/testing';
import { workoutStub } from '../workouts/testing';
import { browserSecureWindow } from '../camera/secure-window-testing';

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
 * The populated fixture's one workout's blocks — exported for #941's "no
 * watts" test, which renders the Workouts list over this same workout.
 */
export const POPULATED_WORKOUT_BLOCKS: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
  { kind: 'steady', seconds: seconds(1200), target: thresholdShare(0.9) },
];

/**
 * The item each `list-detail` route (#670) selects in the populated fixture —
 * one the list holds. A `list-detail` route with no entry here is reported by
 * `routes.test.ts`, never skipped.
 */
export const SELECTIONS: Partial<Record<RouteId, string>> = {
  activities: RIDE_ID,
  workouts: 'workout-1',
  routes: 'route-1',
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
 *   screen: `transfer` has data-dependent content from a port this shell does
 *   not build, and the reason says so rather than calling the screen static.
 */
export type PopulatedExpectation =
  | { readonly kind: 'fixture'; readonly marker: string }
  | { readonly kind: 'constant'; readonly marker: string; readonly reason: string }
  | { readonly kind: 'none'; readonly reason: string };

export const POPULATED: Record<RouteId, PopulatedExpectation> = {
  home: { kind: 'fixture', marker: '.oyl-main .oyl-home__facts' },
  ride: { kind: 'fixture', marker: '.oyl-main .oyl-metric--live' },
  game: { kind: 'fixture', marker: '.oyl-chooser__card input[type="radio"]' },
  workouts: { kind: 'fixture', marker: '.oyl-main a[data-oyl-select]' },
  activities: { kind: 'fixture', marker: '.oyl-main a[href^="#/activities/"]' },
  analysis: { kind: 'fixture', marker: '.oyl-main .oyl-scroll-region tbody tr' },
  segments: { kind: 'fixture', marker: '.oyl-main a[href^="#/segments/"]' },
  routes: { kind: 'fixture', marker: '.oyl-main a[data-oyl-select]' },
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
      'what it shows comes from the store behind the transfer port a caller hands it, not from these fixtures; the reflow page fills that store and imports a file for its populated walk and says so with an expectation of its own (#690), while the sentence walk hands it an empty store and the others none',
  },
  camera: {
    kind: 'none',
    reason:
      'the camera this page hands it opens nothing, and its side-camera pairing is offered and never made, so it is the same in both walks',
  },
  // #839: the rider's words to mask are the one list the screen renders.
  settings: { kind: 'fixture', marker: '.oyl-main .oyl-masked-words li' },
  about: { kind: 'none', reason: 'static prose' },
  // #690: its waypoint list and legs table come from the draft in local
  // storage, which `PopulatedShell` writes for the populated walk and clears
  // for the empty one — see `seedRouteDraft`.
  'route-builder': { kind: 'fixture', marker: '.oyl-main .oyl-scroll-region tbody tr' },
  'side-camera': {
    kind: 'none',
    reason: 'no pairing is ever made, so it shows its before-pairing state in both walks',
  },
  // #777/#773: connected, the instance's devices are listed; not, the form.
  instance: { kind: 'fixture', marker: '.oyl-main .oyl-instance__devices li' },
  // #955: a moderator's queues; empty, an account that moderates nothing.
  moderation: { kind: 'fixture', marker: '.oyl-main .oyl-moderation__pending li' },
  'not-found': { kind: 'none', reason: 'static: a heading and the route list' },
};

/**
 * Which routes have an EMPTY STATE over the empty fixture — #943 — and the
 * sentence that says so, which must render inside `design/EmptyState.tsx`.
 *
 * A `Record` over `RouteId`, as {@link POPULATED} is, so a route added to the
 * table without an entry is a compile error rather than a route nobody checked.
 * `a11y/empty-states.a11y.test.tsx` holds every entry both ways round — the
 * sentence inside an `EmptyState` with one action, and no `EmptyState` on a
 * `none` — and the browser gate (`controls-first.browser.spec.ts` §"#943")
 * measures each action against the fold.
 *
 * `bluetooth`: the empty state is only reachable where a browser can pair —
 * the Devices screen with nothing paired — so the route is opened with
 * {@link AVAILABLE_BLUETOOTH}.
 */
export type EmptyStateExpectation =
  | { readonly kind: 'empty-state'; readonly sentence: string; readonly bluetooth?: true }
  | { readonly kind: 'none'; readonly reason: string };

export const EMPTY_STATES: Record<RouteId, EmptyStateExpectation> = {
  activities: {
    kind: 'empty-state',
    sentence: 'Nothing recorded yet. A ride appears here the moment you finish one.',
  },
  workouts: { kind: 'empty-state', sentence: 'No workouts saved on this device yet.' },
  routes: {
    kind: 'empty-state',
    sentence: 'You have no saved routes yet. Import a GPX file to add one.',
  },
  game: { kind: 'empty-state', sentence: 'You have no saved routes yet.' },
  devices: {
    kind: 'empty-state',
    sentence: 'Start with your smart trainer: it is the one device here this app can control',
    bluetooth: true,
  },
  segments: {
    kind: 'empty-state',
    sentence:
      'No segments yet. A segment is cut from a ride with a track: import one from a file to begin.',
  },
  analysis: {
    kind: 'empty-state',
    sentence: 'Nothing recorded yet. Zones appear here the moment you finish a ride.',
  },
  home: { kind: 'none', reason: 'a first run has its own welcome, the ride cards (#939)' },
  ride: { kind: 'none', reason: 'nothing to be empty: it starts a ride' },
  transfer: { kind: 'none', reason: 'a form, which is the same with nothing imported' },
  camera: { kind: 'none', reason: 'a consent and a switch, the same in both walks' },
  settings: { kind: 'none', reason: 'settings, which are never empty' },
  about: { kind: 'none', reason: 'static prose' },
  credits: { kind: 'none', reason: 'generated from ASSETS.toml, never empty' },
  'route-builder': { kind: 'none', reason: 'a canvas to draw on, which is its own empty state' },
  instance: { kind: 'none', reason: 'a form to connect, the same with nothing connected' },
  moderation: { kind: 'none', reason: 'the queues of a moderator, not in the list #943 names' },
  'side-camera': { kind: 'none', reason: 'a pairing flow, not a list' },
  'activity-detail': { kind: 'none', reason: 'one ride, opened by its id' },
  'segment-detail': { kind: 'none', reason: 'one segment, opened by its id' },
  'not-found': { kind: 'none', reason: 'a heading and the route list' },
};

/**
 * A Bluetooth that answers "available" and is never asked to pair — #699's
 * review, N4, moved here from `browser/reflow-harness.tsx` by #943 so the
 * jsdom empty-state walk reaches the Devices screen's pairing rows too.
 */
export const AVAILABLE_BLUETOOTH: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('this fixture pairs nothing')),
  },
  secureContext: true,
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

/**
 * The ride whose card is the hard case for its facts and its link (#1041's
 * review): ten hours and more, so its duration is the widest reading a card
 * draws (`10:23:45` at `xxl`: about 8.5rem in a Mac's system font, and about
 * 9.6rem in the CI runner's Linux font, #1052), and a name of four letters, so
 * its link is narrower than 44 px unless the link's own floor holds it. The
 * name is "Spin" and not "Ride" (#1053): "Ride" is also a navigation label, and
 * the route-sentence record is a SET, so a ride of that name lost its own entry
 * on any route that also draws the navigation.
 */
const SHORT_LONG_RIDE = 1;

/** Long names, with spaces and without, because a name is where a row gets wide. */
function rideName(index: number): string {
  if (index === SHORT_LONG_RIDE) {
    return 'Spin';
  }
  if (index % 7 === 3) {
    return `Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch loop ${String(index)}`;
  }
  return `An extraordinarily long Sunday morning club ride out to the reservoir and back again ${String(index)}`;
}

/**
 * One of the populated library's rides, for a caller that puts it in a store
 * of its own — the reflow page's Files screen (#690).
 */
export function fixtureRide(index: number): ActivityRecord {
  return ride(index);
}

/** How many waypoints the route builder's fixture draft has. */
export const FIXTURE_DRAFT_WAYPOINTS = 4;

/**
 * The route builder's fixture (#690): four waypoints joined by freehand legs,
 * which a draft restores whole with no routing engine (`draft-storage.ts`
 * §`deserialiseDraft`), so the waypoint list and the legs table are drawn.
 */
function fixtureDraft(): RouteDraft {
  let draft = emptyDraft();
  for (let index = 0; index < FIXTURE_DRAFT_WAYPOINTS; index += 1) {
    draft = addWaypoint(draft, north(index * 400, (index % 2) * 300), 'freehand').draft;
  }
  return draft;
}

/**
 * Put the fixture draft where the route builder reads it, or take it away.
 * The draft is local storage rather than a port (`routing/draft-storage.ts`),
 * so it is the one fixture this shell cannot hand over as a prop — and a walk
 * of the empty fixture after a populated one on the same origin would
 * otherwise find the populated draft still there. In the Vitest suite,
 * `hierarchy-walk.tsx` §`openRoute`'s unmount takes it away (#864), so a later
 * test in the same file does not find it either.
 */
export function seedRouteDraft(populated: boolean, storage: Storage): void {
  if (populated) {
    storage.setItem(DRAFT_STORAGE_KEY, serialiseDraft(fixtureDraft()));
  } else {
    storage.removeItem(DRAFT_STORAGE_KEY);
  }
}

/**
 * The ride Home describes as *Last ride* — the newest — moves for ten hours
 * and more (#1052), so Home's widest reading, a moving time of `10:23:45`, is
 * on the page in its facts. With {@link homeNow} its week is the same width
 * again (`28:35:45`), and the week before it `21:14:00`.
 */
const LAST_RIDE = 0;

function movingTimeOf(index: number): number {
  return index === LAST_RIDE ? 10 * 3600 + 23 * 60 + 45 : 3 * 3600 + 2 * 60;
}

function elapsedTimeOf(index: number): number {
  if (index === SHORT_LONG_RIDE) return 10 * 3600 + 23 * 60 + 45;
  return index === LAST_RIDE ? 10 * 3600 + 41 * 60 : 3 * 3600 + 17 * 60;
}

/**
 * Home's clock: the fixture's own instant, which its rides are dated back
 * from (#1052). On the wall clock *This week* is a week nobody rode in.
 */
const homeNow = (): UnixSeconds => unixSeconds(NOW);

function ride(index: number): ActivityRecord {
  return stubActivity({
    id: activityId(`ride-${String(index)}`),
    athleteId: ATHLETE,
    name: rideName(index),
    startedAt: unixSeconds(NOW - index * DAY),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(elapsedTimeOf(index)),
    movingTime: seconds(movingTimeOf(index)),
    distance: metres(123_456),
    averagePower: watts(234),
    hasPosition: index % 2 === 0,
  });
}

/** An unbreakable string a model might write — a URL with no break opportunity in it. */
export const WRITE_UP_UNBREAKABLE =
  'https://example.invalid/an-unbreakable-string-a-model-might-write-with-no-space-or-hyphen-anywhere-in-it/' +
  'x'.repeat(120);

/** The populated fixture's saved write-up (#805). */
const POPULATED_WRITE_UP: RideWriteUpRecord = {
  activityId: activityId(RIDE_ID),
  athleteId: ATHLETE,
  text: [
    'A long, steady ride. The first hour was evenly paced, with power held close to the same figure on every climb and cadence settling after the first ten minutes.',
    'The middle sections were harder: heart rate drifted upwards while power stayed level, which usually means the effort was catching up with you rather than the road getting steeper.',
    `A string with no break in it, the way a model sometimes writes one: ${WRITE_UP_UNBREAKABLE}`,
    'The last section eased off, and the ride finished at a comfortable pace.',
  ].join('\n\n'),
  templateId: 'ride-write-up',
  templateVersion: '1',
  source: 'computer',
  includedPose: true,
  missingSections: [2, 3],
  writtenAt: unixSeconds(NOW),
};

/**
 * The post-ride ask, set up with the rider's own computer (#805, carried from
 * #831's review): without it every route gate built the shell with no port,
 * so the ask control and what it says is sent were never laid out. It never
 * answers — a walk never presses it.
 */
function rideAnalysisPort(): RideAnalysisPort {
  return {
    availableSources: () => ['computer'],
    previewHostedRequest: async () => Promise.resolve({ kind: 'shown', steps: [], total: 1 }),
    hostedPreviewSeen: () => true,
    askForRideWriteUp: async () => new Promise<AskOutcome>(() => undefined),
  };
}

/**
 * A write-up asked of the rider's instance (#1102): connected on the
 * populated walk, so its press and what it says is sent are laid out, and not
 * on the empty one, so its one no-instance sentence is. It never answers — a
 * walk never presses it.
 */
function instanceAnalysisPort(populated: boolean): InstanceAnalysisPort {
  return {
    connected: () => populated,
    availableSources: () => (populated ? ['instance-local'] : []),
    pendingJob: () => false,
    ask: async () => new Promise<InstanceAskOutcome>(() => undefined),
    followAgain: async () => Promise.resolve({ kind: 'detached' }),
    cancel: async () => Promise.resolve(),
  };
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
    // #805: a long write-up, with paragraphs and one unbreakable string, so
    // the reflow walk lays it out at 320 px — and a pose summary and two
    // missing sections, so every line under it renders.
    ...(populated ? { writeUp: POPULATED_WRITE_UP } : {}),
    sideCamera: {
      athleteId: ATHLETE,
      activityId: activityId(RIDE_ID),
      summary: SIDE_REPORT_OBSERVED,
      observations: [
        SIDE_OBSERVATION_SENTENCES.torso.decreased,
        SIDE_OBSERVATION_SENTENCES.knee.increased,
      ],
      pose: null,
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

/**
 * The rider's words to mask (#839) — in the populated walk a list whose
 * entries include one long phrase and one unbreakable word, so the reflow
 * walk lays out the longest a row can be.
 */
function maskedWordsPort(populated: boolean): MaskedWordsPort {
  const words = populated
    ? [
        'Kestrel Farm',
        'The Old Rectory, Lower Oakbrook Lane, Little Wittenham-on-the-Marsh',
        'Supercalifragilisticexpialidociousvillagename',
      ]
    : [];
  return {
    athleteId: ATHLETE,
    store: {
      getAthlete: (id): Promise<AthleteRecord | undefined> =>
        Promise.resolve({
          id,
          displayName: 'You',
          createdAt: unixSeconds(NOW),
          maskedWords: words,
        }),
      setAthleteMaskedWords: (id, next): Promise<AthleteRecord | undefined> =>
        Promise.resolve({ id, displayName: 'You', createdAt: unixSeconds(NOW), maskedWords: next }),
    },
  };
}

/**
 * The rider's goals, a note on the fixture ride and two documents (#836) — in
 * the populated walk, with one unbreakable word and one long file name, so the
 * reflow walk lays out the widest a box and a row can be.
 */
function riderTextPort(populated: boolean): RiderTextPort {
  if (!populated) return memoryRiderText([], ATHLETE).port;
  const savedAt = unixSeconds(NOW);
  return memoryRiderText(
    [
      {
        athleteId: ATHLETE,
        kind: 'goal',
        key: 'goals',
        text: 'A hundred miles in June. Supercalifragilisticexpialidociousgoal.',
        savedAt,
      },
      {
        athleteId: ATHLETE,
        kind: 'note',
        key: RIDE_ID,
        text: 'Legs heavy after a late night; windy on the climb.',
        savedAt,
      },
      {
        athleteId: ATHLETE,
        kind: 'document',
        key: 'plan',
        name: 'twelve-week-base-plan-for-the-spring-sportive-final-version.md',
        text: '# Base plan\n\nThree rides a week.',
        savedAt,
      },
      {
        athleteId: ATHLETE,
        kind: 'document',
        key: 'notes',
        name: 'Coach notes.txt',
        text: 'Keep the easy days easy.',
        savedAt,
      },
    ],
    ATHLETE,
  ).port;
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
    secureWindow: browserSecureWindow(),
    port: {
      cameraAvailability: () => Promise.resolve({ kind: 'no-camera' as const }),
      requestCameraAccess: () => Promise.resolve({ kind: 'no-camera' as const }),
      startCamera: () => Promise.reject(new Error('this harness opens no camera')),
    },
    schedule: () => () => undefined,
  });
}

/**
 * A side-camera pairing that is OFFERED and never made — #666.
 *
 * `main.tsx` builds one wherever this browser can make the direct link, which
 * is most of them, and the Camera screen's first control is the way in it
 * offers (#557). Without it this fixture measured the rarer screen, where no
 * side camera can be paired. It is the scripted port the unit tests use with
 * no current pairing, so the ride screens show no side camera and nothing is
 * ever connected.
 */
function unpairedSideCamera(): SidePairingPort {
  const scripted = scriptedSidePairing();
  return {
    offerSideCamera: () => scripted.offerSideCamera(),
    currentSideCamera: () => undefined,
    answerSideCamera: (code) => scripted.answerSideCamera(code),
  };
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
 * What a caller supplies that this fixture does not — a map and its basemap,
 * and a transfer port, which needs a real store (#666) — or replaces: the ride controller, for a state of the ride screen neither
 * fixture reaches (the one-primary gate's paused-with-a-stop-armed case).
 */
/**
 * What a caller may hand the shell in place of the fixture's own. Since #699's
 * review (N4) that includes `capabilities`: the fixture's browser has no
 * Bluetooth, which leaves the Devices screen's pairing rows — the state where
 * its controls are — out of every walk, so the controls-first gate hands it a
 * Bluetooth that answers "available" to measure that state's fold too.
 */
export type PopulatedShellExtras = Pick<
  AppShellProps,
  'map' | 'basemap' | 'rideController' | 'transfer'
> &
  Partial<Pick<AppShellProps, 'capabilities' | 'routeUpdates'>>;

/** The real `AppShell` over the empty or the populated fixture. */
export function PopulatedShell({
  populated,
  capabilities = NO_BLUETOOTH,
  ...extras
}: { readonly populated: boolean } & PopulatedShellExtras): JSX.Element {
  // Before anything below renders, so a route builder mounted in this same
  // render reads it; once, so a re-render never rewrites a rider's edits.
  useState(() => {
    seedRouteDraft(populated, localStorage);
    return populated;
  });
  const rides = populated
    ? Array.from({ length: POPULATED_RIDES }, (_unused, index) => ride(index))
    : [];
  const segment = theSegment();
  const segmentTrack = Array.from({ length: 30 }, (_unused, index) => north(index * 20));
  return (
    <AppShell
      capabilities={capabilities}
      homeNow={homeNow}
      camera={quietCamera()}
      rideController={stubRideController(populated ? ridingSnapshot() : idleSnapshot()).controller}
      settings={settingsPort()}
      athleteMass={athleteMassPort()}
      maskedWords={maskedWordsPort(populated)}
      riderText={riderTextPort(populated)}
      instance={scriptedInstance({ connected: populated }).port}
      moderation={
        scriptedModeration({
          standing: populated ? 'moderator' : 'not-moderator',
          // #961: a suspended account, so the walks lay out its row and its control.
          suspended: { 'rider-erin': 1_790_020_000 },
        }).port
      }
      library={stubLibrary(ATHLETE, rides)}
      detail={detailPort(populated)}
      rideAnalysis={rideAnalysisPort()}
      instanceAnalysis={instanceAnalysisPort(populated)}
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
                workout: { name: 'Sweet spot', blocks: POPULATED_WORKOUT_BLOCKS },
                createdAt: unixSeconds(NOW),
                updatedAt: unixSeconds(NOW),
              },
            ]
          : [],
      )}
      game={gamePort(populated)}
      sidePairing={unpairedSideCamera()}
      {...extras}
    />
  );
}
