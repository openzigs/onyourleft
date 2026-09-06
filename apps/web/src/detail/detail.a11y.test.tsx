// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride detail view, audited **with a ride in it**.
 *
 * `a11y/routes.a11y.test.tsx` walks `ALL_ROUTES` and so audits this route too —
 * but it renders the shell with no ports, so what it sees is the honest
 * "no local store on this browser" state. That state is worth auditing and is
 * audited there. It is not the screen: the charts, the series toggles, the
 * summary list, the lap table and the shared-view panel are all absent from it.
 *
 * This file is the same shape as `library/library.a11y.test.tsx` and exists for
 * the same reason #62 needed that one — a route audited in its empty state is a
 * route audited where there is nothing to get wrong.
 *
 * ⚠️ Named `*.a11y.test.tsx` because **that is what the gate selects on** —
 * `test:a11y` is `vitest run --project web .a11y.test.` and #142 records why it
 * is the filename rather than the directory. A file in this directory without
 * that name would sit silently outside the gate, which `check:a11y-suite`
 * fails the build for.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  privacyZoneId,
  type PrivacyZoneRecord,
  type Samples,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import { stubActivity, stubDetail, stubLap, type StubDetail } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function powerSeries(count: number, holeFrom = -1, holeLength = 0): Samples<'power'> {
  return Array.from({ length: count }, (_unused, index) =>
    index >= holeFrom && index < holeFrom + holeLength ? undefined : watts(150 + (index % 60)),
  );
}

/**
 * The busiest state on purpose.
 *
 * A ride with a track, a gap in its power trace, laps, and six chartable
 * channels — so the audit sees every control this view can render rather than
 * the two a minimal fixture would produce.
 */
function busyRide(): StubDetail {
  const count = 400;
  const zone: PrivacyZoneRecord = {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
  };

  return stubDetail(
    ATHLETE,
    {
      activity: stubActivity({ hasPosition: true, averagePower: watts(212) }),
      channels: {
        power: powerSeries(count, 100, 120),
        heartRate: Array.from({ length: count }, () => beatsPerMinute(142)),
        cadence: Array.from({ length: count }, () => revolutionsPerMinute(88)),
        speed: Array.from({ length: count }, () => metresPerSecond(9.4)),
        altitude: Array.from({ length: count }, (_u, index) => altitudeMetres(30 + index / 40)),
        temperature: Array.from({ length: count }, () => degreesCelsius(14)),
        latitude: Array.from({ length: count }, (_u, index) =>
          degreesLatitude(HOME.latitude + (index * 10) / METRES_PER_DEGREE_LATITUDE),
        ),
        longitude: Array.from({ length: count }, () => degreesLongitude(HOME.longitude)),
      },
      laps: [stubLap(0), stubLap(1), stubLap(2)],
    },
    [zone],
  );
}

/**
 * The view inside a `main` with an `h1`, which is what the shell gives it.
 *
 * Without the wrapper the audit would report a missing `main` and a heading
 * order starting at `h2` — both of which are the harness's fault rather than
 * the view's, and both of which would train a reader to ignore this file's
 * failures.
 */
async function openDetail(port: StubDetail | undefined): Promise<Mounted> {
  document.documentElement.lang = 'en';
  const result = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView port={port} activityId={RIDE} />
    </main>,
  );
  // Twice: the first settles the store reads, the second the lazily imported
  // chart. See the note in `views/ActivityDetailView.test.tsx`.
  await settle();
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

describe('the ride detail view passes the audit in every state it renders', () => {
  it('with a ride, its charts, its laps and its series toggles', async () => {
    await openDetail(busyRide());
    expectClean('the detail view with a ride');
  });

  it('with the shared view open', async () => {
    await openDetail(busyRide());
    const reveal = queryAll<HTMLButtonElement>(document, 'button').find((button) =>
      button.textContent?.includes('Show what a shared copy would contain'),
    );
    await activateWithKeyboard(reveal as HTMLButtonElement);
    await settle();
    expectClean('the detail view with the shared view open');
  });

  it('with every series switched on', async () => {
    await openDetail(busyRide());
    for (const button of queryAll<HTMLButtonElement>(document, 'button')) {
      if (button.textContent?.startsWith('Show ') === true) {
        await activateWithKeyboard(button);
        await settle();
      }
    }
    await settle();
    expect(queryAll(document, 'svg.oyl-trace').length).toBeGreaterThan(2);
    expectClean('the detail view with every series on');
  });

  it('with no local store, which is what a private window gets', async () => {
    await openDetail(undefined);
    expectClean('the detail view with no store');
  });
});

describe('every control on the detail view is reachable and named', () => {
  it('is in the tab order and has an accessible name', async () => {
    await openDetail(busyRide());
    const tabbable = new Set(tabbableElements(document));
    const controls = queryAll(
      document,
      'a[href], button, input, select, textarea, [role="button"]',
    );

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(tabbable.has(control), `not in the tab order: ${control.outerHTML}`).toBe(true);
      expect(accessibleName(control), `unnamed control: ${control.outerHTML}`).not.toBe('');
    }
  });

  it('names each series toggle by what pressing it does', async () => {
    // "Show cadence", not "Cadence" with the state carried by a colour. #48's
    // sixth criterion: colour is never the sole carrier of meaning.
    await openDetail(busyRide());
    const toggles = queryAll<HTMLButtonElement>(document, '.oyl-library-controls button');
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) {
      expect(accessibleName(toggle)).toMatch(/^(Show|Hide) /);
    }
  });
});

describe('the chart is described rather than left as an unlabelled picture', () => {
  it('carries an image role and a description of the trace', async () => {
    // A bare `<svg>` full of paths is announced as a group of nothing. The
    // paths are hidden and the description carries the shape.
    await openDetail(busyRide());
    const svg = document.querySelector('svg.oyl-trace');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(accessibleName(svg as Element)).toContain('Power over');
  });

  it('hides the paths from assistive technology and puts none of them in the tab order', async () => {
    await openDetail(busyRide());
    const group = document.querySelector('svg.oyl-trace g');
    expect(group?.getAttribute('aria-hidden')).toBe('true');
    for (const path of queryAll(document, 'svg.oyl-trace path')) {
      expect(tabbableElements(document)).not.toContain(path);
    }
  });
});
