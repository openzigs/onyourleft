// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The gate #48's third, fourth and fifth acceptance criteria name.
 *
 * - **Criterion 4** — automated accessibility checks on *every* route. The
 *   suite iterates `ALL_ROUTES` rather than naming views, so a route added to
 *   the table is audited without anyone remembering to add a case here.
 * - **Criterion 3** — every interactive control reachable and operable by
 *   keyboard, asserted rather than inspected. `activateWithKeyboard` refuses to
 *   activate anything it cannot focus first, which is what makes "operable"
 *   more than a click in disguise.
 * - **Criterion 5** — focus is managed on navigation: it moves to the new view
 *   rather than being left on a link describing the page you have left.
 *
 * This file runs in CI both inside `pnpm run test:coverage` and again as the
 * dedicated `pnpm run test:a11y` step, so an accessibility regression fails
 * under a check named for what broke.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { ridingSnapshot, stubRideController } from '../ride/testing';
import { stubMatchPort } from '../segments/match-testing';
import { stubSegments } from '../segments/testing';
import type { MatchPort } from '../segments/match-port';
import type { SegmentPort } from '../segments/store-port';
import { AppShell } from '../shell/AppShell';
import {
  ALL_ROUTES,
  groupDestination,
  hrefFor,
  ROUTES,
  routeById,
  type RouteDefinition,
} from '../shell/routes';
import type { ActivityRecord, AthleteRecord, SegmentRecord, UnitSystem } from '@onyourleft/store';
import { activityId, athleteId, segmentId } from '@onyourleft/store';

import type { UnitsPort } from '../units/store-port';
import type { AthleteMassPort } from '../athlete/store-port';

import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';

import { accessibleName, auditAccessibility, formatViolations, tabbableElements } from './audit';

/**
 * A browser that can pair.
 *
 * The audit runs against the *capable* branch on purpose: it is the branch with
 * the most controls in it, so it is the one with the most to get wrong. The
 * incapable branches are audited too, below.
 */
function workingBluetooth(available = true): BluetoothPort {
  return {
    getAvailability: async () => Promise.resolve(available),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
  };
}

const CAPABLE: CapabilityProbe = { bluetooth: workingBluetooth(), secureContext: true };
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/**
 * The ride screen, mid-ride.
 *
 * The **busiest** state on purpose: recording, a trainer under ERG control, a
 * stale channel, a paired sensor with a "forget" control and four pairing
 * buttons. That is where the controls are, and a route audited in its empty
 * state is a route audited where there is nothing to get wrong. #49's controls
 * are all reachable from here, so they are all covered by the loops below
 * without this file naming any of them.
 */
function midRide(): Parameters<typeof AppShell>[0]['rideController'] {
  return stubRideController(ridingSnapshot()).controller;
}

/**
 * A settings port that answers, so the **control** is what gets audited.
 *
 * ⚠️ Without it `/settings` renders its `UNITS_NO_STORE` explanation — a
 * paragraph with nothing interactive in it — and the radio group #238 adds is
 * audited nowhere, while this file's route loop still reports the route as
 * covered. That is the vacuous pass a review caught: the gate ran, the route
 * was green, and the only new control on it had never been rendered under it.
 */
function settingsPort(): UnitsPort {
  const owner = athleteId('local');
  return {
    athleteId: owner,
    store: {
      setAthleteUnits: (id, units): Promise<AthleteRecord | undefined> =>
        Promise.resolve({
          id,
          displayName: 'You',
          createdAt: 0 as AthleteRecord['createdAt'],
          units,
        }),
    },
  };
}

/**
 * The same, for the weight box #325 adds to that screen.
 *
 * ⚠️ **The same trap, a second time and in the same file.** With no
 * `athleteMass` port the settings route renders `MASS_NO_STORE` — a paragraph
 * with nothing interactive in it — so the route loop below would report the
 * screen clean while the labelled input, its button and its live status message
 * had never been rendered under the audit.
 */
function athleteMassPort(): AthleteMassPort {
  const owner = athleteId('local');
  return {
    athleteId: owner,
    store: {
      setAthleteMass: (id, mass): Promise<AthleteRecord | undefined> =>
        Promise.resolve({
          id,
          displayName: 'You',
          createdAt: 0 as AthleteRecord['createdAt'],
          ...(mass === undefined ? {} : { mass }),
        }),
    },
  };
}

/**
 * Segment ports that answer, so the **controls** are what get audited (#282).
 *
 * ⚠️ The same vacuous pass `settingsPort` above records, in a second place. A
 * `/segments` mounted with no port renders `SegmentsView`'s "No storage"
 * `StatusMessage` — a paragraph with nothing interactive in it — and returns
 * before the create form or #282's "Match my rides" control exist at all,
 * while the route loop below still reports `/segments` as covered. A review of
 * #290 caught it on the new control; the create form (#64) had been outside
 * the audit since it was written.
 */
const SEGMENTS_ATHLETE = athleteId('local');
const SEGMENTS_ORIGIN_LATITUDE = 51.5;
const SEGMENTS_ORIGIN_LONGITUDE = -0.12;
const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const SEGMENTS_NOW = unixSeconds(1_760_000_000);

/** A straight northbound track, which is all the matcher needs to find one. */
function northward(count: number, spacingMetres = 50): GeographicPosition[] {
  const step = spacingMetres / METRES_PER_DEGREE_LATITUDE;
  return Array.from({ length: count }, (_unused, index) =>
    geographicPosition(
      degreesLatitude(SEGMENTS_ORIGIN_LATITUDE + index * step),
      degreesLongitude(SEGMENTS_ORIGIN_LONGITUDE),
    ),
  );
}

function segmentsRide(): ActivityRecord {
  return {
    id: activityId('ride-1'),
    athleteId: SEGMENTS_ATHLETE,
    name: 'Morning ride',
    startedAt: SEGMENTS_NOW,
    startedAtTimeZone: 'UTC',
    elapsedTime: 3600 as ActivityRecord['elapsedTime'],
    movingTime: 3500 as ActivityRecord['movingTime'],
    distance: 30_000 as ActivityRecord['distance'],
    visibility: 'private',
    hasPosition: true,
    createdAt: SEGMENTS_NOW,
  };
}

function aSegment(geometry: readonly GeographicPosition[]): SegmentRecord {
  const built = createSegment({
    id: 'the-drag',
    createdBy: SEGMENTS_ATHLETE,
    name: 'The long drag',
    sport: 'ride',
    geometry,
    elevationSource: 'none',
    visibility: 'private',
    createdAt: SEGMENTS_NOW,
  });
  return { ...built, id: segmentId(built.id), createdBy: SEGMENTS_ATHLETE };
}

function segmentsPort(): SegmentPort {
  const geometry = northward(26, 20);
  return stubSegments(SEGMENTS_ATHLETE, [{ activity: segmentsRide(), track: northward(21) }], {
    existing: [aSegment(geometry)],
  });
}

/**
 * A library the sweep finds one effort in, and one traversal it abandons.
 *
 * Both, in one press: the success `StatusMessage` and the labelled gap note are
 * the two messages #282 adds, and a press that produced neither would audit the
 * control and none of what it renders.
 */
function matchPort(): MatchPort {
  const geometry = northward(26, 20);
  const step = 20 / METRES_PER_DEGREE_LATITUDE;
  const leadIn = [4, 3, 2, 1].map((back) =>
    geographicPosition(
      degreesLatitude(SEGMENTS_ORIGIN_LATITUDE - back * step),
      degreesLongitude(SEGMENTS_ORIGIN_LONGITUDE),
    ),
  );
  const holed = [
    ...geometry.slice(0, 12),
    ...Array.from<undefined>({ length: 40 }).fill(undefined),
    ...geometry.slice(12),
  ];
  return stubMatchPort({
    athleteId: SEGMENTS_ATHLETE,
    rides: [
      { activity: segmentsRide(), track: [...leadIn, ...geometry] },
      {
        activity: {
          ...segmentsRide(),
          id: activityId('ride-2'),
          startedAt: unixSeconds(1_760_003_600),
        },
        track: [...leadIn, ...holed],
      },
    ],
    segments: [aSegment(geometry)],
  });
}

async function open(
  path: string,
  capabilities: CapabilityProbe = CAPABLE,
  units?: UnitSystem,
): Promise<Mounted> {
  globalThis.location.hash = `#${path}`;
  const result = await mount(
    <AppShell
      capabilities={capabilities}
      rideController={midRide()}
      settings={settingsPort()}
      athleteMass={athleteMassPort()}
      segments={segmentsPort()}
      match={matchPort()}
      {...(units === undefined ? {} : { units })}
    />,
  );
  await settle();
  mounted = result;
  return result;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

describe('criterion 4 — every route passes the automated audit', () => {
  for (const route of ALL_ROUTES) {
    it(`${route.id} (${route.path}) has no accessibility violations`, async () => {
      await open(route.path);
      expect(document.querySelector('h1')?.textContent).toBe(route.title);
      expectClean(`${route.id} with Bluetooth available`);
    });
  }

  it('the settings route passes with its controls actually rendered, and its refusal', async () => {
    // ⚠️ **The vacuous pass, guarded rather than described.** The loop above
    // reports `/settings` clean either way; these two lines are what say the
    // audit had something to look at. #238's radio group and #325's weight box
    // are both gone the moment a port is missing, and the file header records
    // that this has already happened once.
    await open('/settings');
    expect(queryAll(document, 'input[type="radio"]').length).toBeGreaterThan(0);
    expect(document.querySelector('#oyl-rider-mass')).not.toBeNull();

    // And the state the loop cannot reach: a refusal, which is a live region
    // beside a labelled input and is where an `aria-describedby` goes dangling.
    const box = document.querySelector('#oyl-rider-mass');
    await typeInto(box as HTMLInputElement, '6.5');
    const save = queryAll(document, 'button').find(
      (candidate) => (candidate.textContent ?? '').trim() === 'Save weight',
    );
    expect(save, 'the save control is not on the settings page').not.toBeUndefined();
    await activateWithKeyboard(save as HTMLElement);
    await settle();

    expect(document.body.textContent).toContain('Your weight must be a number');
    expectClean('settings with a refused weight');
  });

  it('the devices route passes in a browser with no Bluetooth at all', async () => {
    // The Safari and Firefox branch renders different markup — a different
    // status tone, a paragraph instead of a list. Auditing only the happy path
    // would leave the branch a quarter of visitors see unchecked.
    await open('/devices', NO_BLUETOOTH);
    expect(document.body.textContent).toContain('Safari and Firefox');
    expectClean('devices with no Bluetooth');
  });

  it('the segments route passes with the sweep’s result on screen, not only its control', async () => {
    // ⚠️ The loop above audits the control; the two messages it renders appear
    // only after a press, and a message is where a live region, a label and a
    // heading order get broken. Pressed by keyboard for the same reason
    // criterion 3 does: a control that cannot be focused cannot be activated
    // here at all.
    await open('/segments');
    const button = queryAll(document, 'button').find(
      (candidate) => (candidate.textContent ?? '').trim() === 'Match my rides',
    );
    expect(button, 'the sweep control is not on the segments page').not.toBeUndefined();

    await activateWithKeyboard(button as HTMLElement);
    await settle();

    // Both messages, so this is not auditing an unchanged page.
    expect(document.body.textContent).toContain('Matched 2 rides against 1 segment');
    expect(document.body.textContent).toContain('gap in the recording');
    expectClean('segments after a sweep');
  });

  it('the ride route passes with no controller, which is what Safari and Firefox get', async () => {
    // The other branch of the ride screen: an explanation and a link, and no
    // control that cannot work. Auditing only the mid-ride state would leave
    // the branch a quarter of visitors see unchecked, exactly as the
    // no-Bluetooth devices case above.
    globalThis.location.hash = '#/ride';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    expect(document.body.textContent).toContain('cannot pair Bluetooth sensors');
    expectClean('ride with no controller');
  });

  it('the devices route passes while the probe is still in flight', async () => {
    // The loading state is a real state — it lasts for as long as
    // `getAvailability()` takes, which on a cold adapter is not instant — and
    // it contains a live region. Held open with a promise this test resolves,
    // rather than by not awaiting: an unresolved probe is the only way to
    // observe the state at all, since `mount` already flushes microtasks.
    let release = (): void => {};
    const pending = new Promise<boolean>((resolve) => {
      release = () => {
        resolve(true);
      };
    });
    globalThis.location.hash = '#/devices';
    mounted = await mount(
      <AppShell
        capabilities={{
          bluetooth: {
            getAvailability: async () => pending,
            requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
          },
          secureContext: true,
        }}
      />,
    );

    expect(document.body.textContent).toContain('Looking for Bluetooth');
    expectClean('devices while probing');

    release();
    await settle();
    expect(document.body.textContent).toContain('Bluetooth is available');
  });
});

describe('#238 criterion 6 — every route passes the audit in either unit system', () => {
  // ⚠️ **Both settings, every route.** #238 asks for this explicitly, and the
  // failure it is watching for is a legibility one rather than a structural
  // one: an imperial reading is a different string — `1312 ft` where metric
  // says `400 m` — and a longer one is what overflows a tile. jsdom performs no
  // layout so nothing here can assert a width, but the structural rules
  // (`audit.ts`) and the names every control carries are checked against the
  // markup that actually renders in each system, which is the half that is
  // checkable without a browser. Stated rather than implied, so nobody reads
  // this loop as proving more than it does.
  for (const route of ALL_ROUTES) {
    it(`${route.id} (${route.path}) has no accessibility violations in miles`, async () => {
      await open(route.path, CAPABLE, 'imperial');
      expect(document.querySelector('h1')?.textContent).toBe(route.title);
      expectClean(`${route.id} reading in miles`);
    });
  }

  it('renders a different string on a route that shows a distance, so this is not a no-op', async () => {
    // Without this the loop above could pass with the preference doing
    // nothing at all — the classic vacuous parameterisation.
    await open('/routes/new', CAPABLE, 'metric');
    const metric = document.body.textContent ?? '';
    mounted?.unmount();
    mounted = undefined;

    await open('/routes/new', CAPABLE, 'imperial');
    const imperial = document.body.textContent ?? '';

    expect(imperial).not.toBe(metric);
  });
});

describe('criterion 3 — everything interactive is reachable by keyboard', () => {
  for (const route of ALL_ROUTES) {
    it(`every control on ${route.id} is in the tab order and is named`, async () => {
      await open(route.path);
      const tabbable = new Set(tabbableElements(document));
      const controls = queryAll(
        document,
        'a[href], button, input, select, textarea, [role="button"]',
      );

      expect(controls.length, `${route.id} renders no controls at all`).toBeGreaterThan(0);
      for (const control of controls) {
        expect(tabbable.has(control), `not in the tab order: ${control.outerHTML}`).toBe(true);
        expect(accessibleName(control), `unnamed control: ${control.outerHTML}`).not.toBe('');
      }
    });
  }

  it('puts the skip link first in the tab order, which is the one press it exists for', async () => {
    await open('/');
    const first = tabbableElements(document)[0];
    expect(first?.textContent).toBe('Skip to main content');
  });

  it('navigates between every pair of routes using the keyboard alone', async () => {
    await open('/');
    for (const destination of ROUTES) {
      await navigateTo(destination);
      expect(document.querySelector('h1')?.textContent).toBe(destination.title);
    }
  });

  it('reaches every route from every other in at most two activations — #427', async () => {
    // The group, then the page. What a page offers depends only on its GROUP —
    // the primary links are the same everywhere and the second row is drawn
    // for the current group — so walking from one page of every group covers
    // every ordered pair without paying for 110 of them (which timed out under
    // coverage instrumentation, measured). A route one activation from home
    // can be two from elsewhere, and would be three if a group's link went
    // nowhere useful.
    await open('/');
    const representatives = ROUTES.filter(
      (route, index) => ROUTES.findIndex((each) => each.group === route.group) === index,
    );
    expect(representatives.length).toBeGreaterThanOrEqual(5);
    for (const from of representatives) {
      await navigateTo(from);
      for (const to of ROUTES) {
        if (to.id === from.id) continue;
        const presses = await navigateTo(to);
        expect(presses, `${from.id} → ${to.id}`).toBeLessThanOrEqual(2);
        expect(document.querySelector('h1')?.textContent).toBe(to.title);
        await navigateTo(from);
      }
    }
  }, 30_000);

  it('marks the current page for assistive technology, not only with colour', async () => {
    await open('/activities');
    const current = queryAll(document, 'nav a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe(routeById('activities').navLabel);
  });
});

/**
 * #307's third criterion, in the DOM rather than in the stylesheet.
 *
 * `theme.a11y.test.ts` proves the `select` rule stops at the closed control's
 * skin. This proves the other direction: that no route has answered "the select
 * is hard to style" by building a listbox instead. The two are separate
 * failures and only one of them is visible in `theme.css` — a view that
 * replaced its `<select>` with a `div[role="listbox"]` would leave that
 * stylesheet rule perfectly correct and unused.
 *
 * The audit above would not catch it either: a hand-built listbox can carry a
 * label, a `tabindex` and an intact heading order, and still lose typeahead,
 * the platform popup, and every screen reader's own list-navigation mode.
 *
 * ## §Limit — measured, not assumed
 *
 * There are ten `<select>` in six views and this reaches **three** of them: two
 * on `segments` and one on `route-builder`. The other seven are behind data
 * these route stubs do not supply — an empty activity library renders no ride
 * chooser — so replacing one of those with a listbox passes this loop. Measured
 * by counting per route, not inferred. Widening it means richer stubs for the
 * views that need them, which is a bigger change than #307 and is not this
 * one's.
 */
describe('#307 — a chooser on a route is a native select, not a listbox', () => {
  for (const route of ALL_ROUTES) {
    it(`${route.id} builds no listbox of its own`, async () => {
      await open(route.path);
      const handmade = queryAll(document, '[role="listbox"], [role="combobox"], [role="option"]');
      expect(
        handmade.map((element) => element.outerHTML.slice(0, 120)),
        'a control with one of these roles is a chooser built out of generic elements. #305 ' +
          'records why this product uses the platform one, and #307 styles it rather than ' +
          'replacing it.',
      ).toEqual([]);
    });
  }

  it('finds native selects to have been talking about', async () => {
    // Without this the loop above passes on a client that has no choosers at
    // all, which is the vacuous-pass shape: it would go on passing after every
    // `<select>` had been deleted.
    // ⚠️ Sequentially, and unmounted between routes. `open` assigns the module
    // `mounted` and the `afterEach` unmounts only that one, so a test that
    // opens several routes and leaves them mounted puts several `<main>`
    // elements in the document — which the *next* test reads as focus having
    // been lost. Cost an afternoon once; do not visit routes in a loop without
    // this line.
    let found = 0;
    for (const route of ALL_ROUTES) {
      const page = await open(route.path);
      found += queryAll(document, 'select').length;
      page.unmount();
    }
    expect(
      found,
      'no route rendered a native chooser, so the loop above asserts nothing',
    ).toBeGreaterThan(0);
  });
});

describe('criterion 5 — focus is managed on navigation', () => {
  it('moves focus to the new view rather than leaving it on the link', async () => {
    await open('/');
    const link = document.querySelector<HTMLAnchorElement>(
      `nav a[href="${hrefFor(routeById('devices'))}"]`,
    );
    await activateWithKeyboard(link as HTMLAnchorElement);

    const main = document.querySelector('main');
    expect(document.activeElement).toBe(main);
    // Not just "something is focused": the thing focused has to announce the
    // page arrived at, which is what `aria-labelledby` on `main` supplies.
    expect(accessibleName(main as Element)).toBe(routeById('devices').title);
  });

  it('does not steal focus on first render, which would make the skip link unreachable', async () => {
    await open('/');
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus on every navigation, not only the first', async () => {
    await open('/');
    for (const destination of [routeById('activities'), routeById('about'), routeById('ride')]) {
      await navigateTo(destination);
      expect(document.activeElement, `focus was lost navigating to ${destination.id}`).toBe(
        document.querySelector('main'),
      );
    }
  });

  it('sends the skip link to main without navigating away from the page', async () => {
    // ⚠️ This shell routes on the fragment, so an ordinary `href="#oyl-main"`
    // would set the hash to a value matching no route and "skip to content"
    // would land on the not-found page. Both halves are asserted because
    // getting the focus right while breaking the route would look like a pass.
    await open('/about');
    const skip = tabbableElements(document)[0];
    await activateWithKeyboard(skip as HTMLElement);

    expect(document.activeElement).toBe(document.querySelector('main'));
    expect(document.querySelector('h1')?.textContent).toBe(routeById('about').title);
  });
});

describe('the document title follows the route', () => {
  it('names the view, so a tab strip and a screen reader both say where you are', async () => {
    await open('/activities');
    expect(document.title).toBe('Activities — On Your Left');
    await navigateTo(routeById('about'));
    expect(document.title).toBe('About On Your Left — On Your Left');
  });
});

/**
 * Reach a route the way a rider does, by the keyboard: its own link if one is
 * on the page, otherwise its group's link and then its page's — #427. Returns
 * how many activations that took, and fails if there was no way at all.
 */
async function navigateTo(destination: RouteDefinition): Promise<number> {
  const direct = document.querySelector<HTMLAnchorElement>(`nav a[href="${hrefFor(destination)}"]`);
  if (direct !== null) {
    await activateWithKeyboard(direct);
    return 1;
  }
  expect(destination.group, `${destination.id} belongs to no group`).toBeDefined();
  const group = document.querySelector<HTMLAnchorElement>(
    `nav[aria-label="Primary"] a[href="${hrefFor(groupDestination(destination.group ?? 'more'))}"]`,
  );
  expect(group, `no primary link to ${destination.id}'s group`).not.toBeNull();
  await activateWithKeyboard(group as HTMLAnchorElement);
  const page = document.querySelector<HTMLAnchorElement>(`nav a[href="${hrefFor(destination)}"]`);
  expect(page, `no link to ${destination.id} on its group's page`).not.toBeNull();
  await activateWithKeyboard(page as HTMLAnchorElement);
  return 2;
}
