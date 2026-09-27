// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the reflow walk drives — #660, WCAG 2.2 SC 1.4.10.
 *
 * It renders the **real** `shell/AppShell.tsx` under the **real**
 * `design/theme.css`, handed in-memory ports that are either **empty** (a
 * device that has recorded nothing) or **populated** (forty rides with long
 * names, a ride with a track, a chart, laps, a map and a side-camera report,
 * a segment with efforts, a route — on the Routes screen and in the game's
 * picker — a workout). `?data=empty` or
 * `?data=populated` chooses which; there is no default, because a page that
 * silently picked one would make the other half of the walk a copy of it.
 *
 * ## What it exists to catch
 *
 * #654's first pass found the Activities screen laid out 447 px wide inside a
 * 320 px phone and Credits 595 px wide, and **no gate looked**: jsdom performs
 * no layout (CLAUDE.md §4e), and the only 320 px check in the browser gate
 * measured the shell harness, whose views are handed no ports and so render
 * no table at all. This page is where every route is laid out by a real engine,
 * with the data that makes a route wide.
 *
 * ## What it deliberately does NOT decide
 *
 * **Which routes are walked.** `reflow.browser.spec.ts` takes them from
 * `shell/routes.ts` §`ALL_ROUTES`. This page takes them from the same table,
 * independently, and reports which of them it was never asked to render — so a
 * spec that walked a hand list, or dropped one route, is caught by a page that
 * never saw its own list shortened (#142's rule).
 *
 * **What a parameterised route's parameter is** is the one thing it does
 * decide, because only the fixtures know which ride and which segment exist:
 * {@link PARAMETERS}. A parameterised route with no entry there is a fault the
 * spec reports rather than a route it skips.
 *
 * ## The control
 *
 * `?control=overflow` appends a deliberately over-wide element to `.oyl-main`
 * on every route, and `?control=scroller`, `unnamed` and `grouped` each append
 * a box that scrolls sideways inside itself and lacks one of the three things
 * such a box needs. Each must turn the walk's own fault list non-empty —
 * without them, a page that rendered nothing would pass.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

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

import type { AthleteMassPort } from '../src/athlete/store-port';
import type { GamePort } from '../src/game/GameView';
import { NO_SENSORS } from '../src/game/sensors';
import { stubAnalysis } from '../src/analysis/testing';
import { CameraController } from '../src/camera/session';
import {
  SIDE_OBSERVATION_SENTENCES,
  SIDE_REPORT_OBSERVED,
} from '../src/camera/side-report-wording';
import { stubActivity, stubDetail, stubLap } from '../src/detail/testing';
import { stubEffortPort } from '../src/efforts/testing';
import { stubLibrary } from '../src/library/testing';
import { OSM_ATTRIBUTION } from '../src/map/basemap';
import type { MapPort } from '../src/map/port';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../src/ride/testing';
import { routeStub, stubRouteId } from '../src/routes/testing';
import { stubMatchPort } from '../src/segments/match-testing';
import { stubSegments } from '../src/segments/testing';
import { Button } from '../src/design/Button';
import { ScrollTable } from '../src/design/ScrollTable';
import { VisuallyHidden } from '../src/design/VisuallyHidden';
import { AppShell } from '../src/shell/AppShell';
import { ALL_ROUTES, matchHash, type RouteId } from '../src/shell/routes';
import type { CapabilityProbe } from '../src/support/bluetooth-support';
import type { UnitsPort } from '../src/units/store-port';
import { workoutStub } from '../src/workouts/testing';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';

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

/** How long the DOM must be still before a route counts as settled. */
const QUIET_MS = 250;
/** The most a route is waited for, first for its `h1` and then for quiet. */
const PATIENCE_MS = 10_000;

/** One box that scrolls sideways inside itself, and what a keyboard user gets. */
export interface ScrollBox {
  readonly description: string;
  readonly overflow: number;
  readonly focusable: boolean;
  readonly role: string | null;
  readonly name: string;
}

export interface ReflowMeasurement {
  readonly hash: string;
  /** The route `matchHash` resolved the hash to, which the spec compares with the one it asked for. */
  readonly routeId: RouteId;
  readonly h1: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** `scrollWidth − clientWidth` of the document. Positive is a failure. */
  readonly documentOverflow: number;
  /** The element reaching furthest right, for a failure message that names it. */
  readonly widest: string;
  /** CSS px between that element's right edge and the viewport's. Negative is an overflow. */
  readonly spare: number;
  readonly scrollBoxes: readonly ScrollBox[];
  /** The activity library's `data-layout`, or `null` on any other route. */
  readonly libraryLayout: string | null;
  /** The height of the library's sort control, or `null` on any other route. */
  readonly sortControlHeight: number | null;
  /**
   * What this page expects of the route's fixtures — {@link POPULATED} — or
   * `undefined` when it has no entry, which the spec fails in both walks.
   */
  readonly expectation: PopulatedExpectation | undefined;
  /** Whether the expectation's marker is on the page, or `null` when it has none. */
  readonly markerPresent: boolean | null;
  /**
   * Every uncaught error and unhandled rejection raised since the previous
   * route was opened — so one raised while a route rendered, or while the page
   * settled, is charged to that route rather than being read once, before the
   * walk began (#683's review).
   */
  readonly errors: readonly string[];
  readonly settledWithinPatience: boolean;
}

declare global {
  interface Window {
    __oylReflow?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly data: 'empty' | 'populated';
      readonly parameters: Partial<Record<RouteId, string>>;
      readonly populated: Partial<Record<RouteId, PopulatedExpectation>>;
      readonly visit: (hash: string) => Promise<ReflowMeasurement>;
      /** Every id in `ALL_ROUTES` this page has not rendered. */
      readonly unvisited: () => readonly RouteId[];
    };
  }
}

const errors: string[] = [];
/** How much of {@link errors} the previous {@link visit} has already reported. */
let reported = 0;
const visited = new Set<RouteId>();

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

async function realMap(): Promise<MapPort> {
  return (await import('../src/map/maplibre')).mapLibrePort;
}

function shell(populated: boolean): JSX.Element {
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
      map={realMap}
      basemap={{
        archiveUrl: new URL('/basemap-fixture.pmtiles', window.location.origin).toString(),
        attribution: OSM_ATTRIBUTION,
      }}
    />
  );
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function untilHeading(title: string): Promise<boolean> {
  const deadline = performance.now() + PATIENCE_MS;
  while (performance.now() < deadline) {
    if (document.querySelector('h1')?.textContent === title) {
      return true;
    }
    await nextFrame();
  }
  return false;
}

/** Resolve once the DOM has not changed for {@link QUIET_MS}, or at the deadline. */
async function untilQuiet(): Promise<boolean> {
  let last = performance.now();
  const observer = new MutationObserver(() => {
    last = performance.now();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const deadline = performance.now() + PATIENCE_MS;
  try {
    while (performance.now() < deadline) {
      await nextFrame();
      if (performance.now() - last >= QUIET_MS) {
        return true;
      }
    }
    return false;
  } finally {
    observer.disconnect();
  }
}

function describe(element: Element): string {
  const id = element.id === '' ? '' : `#${element.id}`;
  const classes = [...element.classList].map((name) => `.${name}`).join('');
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function nameOf(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') {
    return label.trim();
  }
  const ids = element.getAttribute('aria-labelledby');
  if (ids === null) {
    return '';
  }
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every element that scrolls sideways inside itself right now, measured.
 *
 * A box whose content is wider than it, with `overflow-x` of `auto` or
 * `scroll`, is a scroll container a mouse can scroll and a keyboard can reach
 * only if it can take focus. SC 1.4.10 exempts a table's two-dimensional
 * layout from reflow only on that condition (#654's re-review).
 */
function scrollBoxes(): ScrollBox[] {
  const found: ScrollBox[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const overflowX = getComputedStyle(element).overflowX;
    if (overflowX !== 'auto' && overflowX !== 'scroll') {
      continue;
    }
    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) {
      continue;
    }
    found.push({
      description: describe(element),
      overflow,
      focusable: element.tabIndex >= 0,
      role: element.getAttribute('role'),
      name: nameOf(element),
    });
  }
  return found;
}

/** The element whose right edge reaches furthest, for a failure message that names it. */
function clipped(element: Element): boolean {
  for (
    let parent = element.parentElement;
    parent !== null && parent !== document.body;
    parent = parent.parentElement
  ) {
    if (getComputedStyle(parent).overflowX !== 'visible') {
      return true;
    }
  }
  return false;
}

/** What a person actually sees: replaced elements, controls and tables. */
const CONTENT_ELEMENTS = 'img, svg, canvas, video, input, select, button, textarea, table';

/**
 * The content reaching furthest right, and how far its edge is from the
 * viewport's — the route's MARGIN, which the spec prints so a near miss is
 * visible rather than green. Measured over TEXT and over
 * {@link CONTENT_ELEMENTS} rather than every box, because a block stretches to
 * its container and would report the container's edge whatever is in it.
 * Anything inside a box that clips or scrolls is skipped: it can be wider than
 * the page without widening it.
 */
function widest(): { readonly description: string; readonly spare: number } {
  let right = -Infinity;
  let which = 'nothing';
  const consider = (box: DOMRect, owner: Element, what: string): void => {
    if (box.width > 0 && box.right > right && !clipped(owner)) {
      right = box.right;
      which = what;
    }
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (
      owner === null ||
      (node.textContent ?? '').trim() === '' ||
      getComputedStyle(owner).overflowX !== 'visible'
    ) {
      continue;
    }
    range.selectNodeContents(node);
    consider(range.getBoundingClientRect(), owner, `text in ${describe(owner)}`);
  }
  for (const element of document.body.querySelectorAll(CONTENT_ELEMENTS)) {
    consider(element.getBoundingClientRect(), element, describe(element));
  }
  return {
    description: `${which} (right edge ${right.toFixed(1)} px)`,
    spare: document.documentElement.clientWidth - right,
  };
}

function applyControl(control: string | null): void {
  const main = document.querySelector('.oyl-main');
  if (control === null || main === null || main.querySelector('[data-oyl-control]') !== null) {
    return;
  }
  const specimen = document.createElement('div');
  specimen.dataset['oylControl'] = control;
  if (control === 'overflow') {
    // Wider than any viewport the walk uses, and unbreakable.
    specimen.style.width = '1200px';
    specimen.style.height = '4px';
  } else if (control === 'scroller' || control === 'unnamed' || control === 'grouped') {
    // Contained, so the DOCUMENT does not scroll — only this box does. Each
    // has two of the three things a scroll box needs and lacks one, so each
    // proves its own part of the rule: `scroller` is a named region that
    // cannot take focus (a `ScrollTable` that lost its `tabIndex`), `unnamed`
    // is a focusable region with no name, and `grouped` is focusable and named
    // with a role that is not `region` (#683's review — any role used to pass).
    specimen.style.overflowX = 'auto';
    specimen.setAttribute('role', control === 'grouped' ? 'group' : 'region');
    if (control !== 'unnamed') {
      specimen.setAttribute('aria-label', 'A wide specimen');
    }
    if (control !== 'scroller') {
      specimen.tabIndex = 0;
    }
    const inner = document.createElement('div');
    inner.style.width = '1200px';
    inner.style.height = '4px';
    specimen.append(inner);
  } else if (control === 'region') {
    // The POSITIVE control: a table done properly must NOT be a fault, so the
    // rule cannot pass by flagging everything that scrolls. It is the REAL
    // `ScrollTable`, with a visually hidden name at the far end of a wide row —
    // the case that once escaped the region and widened the page (theme.css
    // §`.oyl-scroll-region`, `position: relative`).
    main.append(specimen);
    flushSync(() => {
      createRoot(specimen).render(
        <ScrollTable caption="A wide specimen">
          <tbody>
            <tr>
              <td style={{ minWidth: '1200px' }}>Wide</td>
              <td>
                <Button>
                  Delete<VisuallyHidden> the wide specimen</VisuallyHidden>
                </Button>
              </td>
            </tr>
          </tbody>
        </ScrollTable>,
      );
    });
    return;
  }
  main.append(specimen);
}

async function visit(hash: string): Promise<ReflowMeasurement> {
  const control = new URLSearchParams(window.location.search).get('control');
  window.location.hash = hash;
  const { route } = matchHash(hash);
  const headed = await untilHeading(route.title);
  const quiet = await untilQuiet();
  await document.fonts.ready;
  applyControl(control);
  await nextFrame();
  visited.add(route.id);
  // Read through a `Partial` view on purpose: the spec's "no entry" fault has
  // to be reachable if the `Record` type is ever loosened.
  const expectation = (POPULATED as Partial<Record<RouteId, PopulatedExpectation>>)[route.id];
  const marker =
    expectation === undefined || expectation.kind === 'none' ? undefined : expectation.marker;
  const raised = errors.slice(reported);
  reported = errors.length;
  const root = document.documentElement;
  const reach = widest();
  return {
    hash,
    routeId: route.id,
    h1: document.querySelector('h1')?.textContent ?? '',
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentOverflow: root.scrollWidth - root.clientWidth,
    widest: reach.description,
    spare: reach.spare,
    scrollBoxes: scrollBoxes(),
    libraryLayout: document.querySelector('.oyl-library')?.getAttribute('data-layout') ?? null,
    sortControlHeight:
      document.querySelector('#oyl-library-sort')?.getBoundingClientRect().height ?? null,
    expectation,
    markerPresent: marker === undefined ? null : document.querySelector(marker) !== null,
    errors: raised,
    settledWithinPatience: headed && quiet,
  };
}

function main(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('reflow harness: #shell is missing from reflow.html');
  }
  const data = new URLSearchParams(window.location.search).get('data');
  if (data !== 'empty' && data !== 'populated') {
    throw new Error(`reflow harness: ?data must be "empty" or "populated", not ${String(data)}`);
  }
  window.location.hash = '#/';
  flushSync(() => {
    createRoot(host).render(<StrictMode>{shell(data === 'populated')}</StrictMode>);
  });
  window.__oylReflow = {
    ready: true,
    errors,
    data,
    parameters: PARAMETERS,
    populated: POPULATED,
    visit,
    unvisited: () => ALL_ROUTES.map((route) => route.id).filter((id) => !visited.has(id)),
  };
}

window.addEventListener('error', (event) => {
  errors.push(event.message);
});
// A rejected promise nothing awaits raises no `error` event, and is the more
// likely failure in a view that reads a port.
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  errors.push(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

try {
  main();
} catch (error: unknown) {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylReflow = {
    ready: false,
    errors,
    data: 'empty',
    parameters: PARAMETERS,
    populated: POPULATED,
    visit: () => Promise.reject(new Error('the reflow harness did not start')),
    unvisited: () => ALL_ROUTES.map((route) => route.id),
  };
}
