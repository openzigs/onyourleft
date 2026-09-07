// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The map panel, audited in every state it renders.
 *
 * `a11y/routes.a11y.test.tsx` renders the shell with no ports, so the map never
 * appears there at all — it needs a renderer, a basemap and a ride with GPS,
 * and the route audit supplies none of the three. Without this file the map
 * would be the one part of the detail screen outside #48's gate.
 *
 * ⚠️ Named `*.a11y.test.tsx` because **that is what the gate selects on** —
 * `test:a11y` is `vitest run --project web .a11y.test.`, and #142 records why
 * it is the filename rather than the directory. `check:a11y-suite` fails the
 * build for a test file in this directory that does not carry the convention.
 */

import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  isHiddenFromAssistiveTechnology,
  tabbableElements,
} from '../a11y/audit';
import type { TrackSegment } from '../detail/privacy';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { OSM_ATTRIBUTION, type BasemapConfig } from './basemap';
import { MapPanel } from './MapPanel';
import { stubMapPort } from './testing';
import { trackGeometry, type TrackGeometry } from './track';

const BASEMAP: BasemapConfig = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function segment(...points: readonly (readonly [number, number])[]): TrackSegment {
  return {
    points: points.map(([latitude, longitude], index) => ({
      index,
      position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
    })),
  };
}

function aTrack(parts = 1): TrackGeometry {
  const segments = Array.from({ length: parts }, (_unused, index) =>
    segment([51.5 + index, -0.1], [51.51 + index, -0.1]),
  );
  return trackGeometry(segments) as TrackGeometry;
}

/**
 * The panel inside the headings the real screen gives it.
 *
 * `h1` from the shell, `h2` for the ride's name, `h3` for the section — which
 * is the order `views/ActivityDetailView.tsx` renders. Skipping the `h2` here
 * would report a `heading-order` violation that belongs to this harness rather
 * than to the panel, and a reader who saw one would learn to ignore the next.
 */
async function openPanel(element: React.ReactElement): Promise<Mounted> {
  document.documentElement.lang = 'en';
  const result = await mount(
    <main>
      <h1>Ride details</h1>
      <h2>Tuesday morning</h2>
      <h3>Route</h3>
      {element}
    </main>,
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

describe('the map panel passes the audit in every state', () => {
  it('with a map', async () => {
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    expectClean('the map panel with a map');
  });

  it('with no basemap configured', async () => {
    await openPanel(<MapPanel port={stubMapPort()} basemap={undefined} track={aTrack()} />);
    expectClean('the map panel with no basemap');
  });

  it('with no renderer, which is what a browser without WebGL gets', async () => {
    await openPanel(<MapPanel port={undefined} basemap={BASEMAP} track={aTrack()} />);
    expectClean('the map panel with no renderer');
  });

  it('with no track, where it renders nothing', async () => {
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={undefined} />);
    expectClean('the map panel with no track');
  });
});

describe('the map is marked up as the picture it is', () => {
  it('carries an image role and a name, rather than being an unlabelled region', async () => {
    // A bare `<div>` holding a WebGL canvas is announced as nothing at all. The
    // `image-has-alt` rule is what would fail if the label were dropped.
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack(2)} />);
    const map = document.querySelector('.oyl-map');
    expect(map?.getAttribute('role')).toBe('img');
    expect(accessibleName(map as Element)).toContain('route');
  });

  it('puts nothing in the tab order, because it is not interactive', async () => {
    // `map/maplibre.ts` constructs the map with `interactive: false`, so there
    // is no gesture to give a keyboard equivalent for and nothing focusable to
    // land on. A pannable map that skipped the keyboard half would fail #48's
    // third criterion, which is why interaction is deferred rather than added.
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    const map = document.querySelector('.oyl-map') as HTMLElement;
    expect(tabbableElements(document)).not.toContain(map);
    expect(tabbableElements(map)).toEqual([]);
  });
});

describe('the attribution survives the ways a credit usually gets lost', () => {
  it('is not hidden from assistive technology', async () => {
    // ODbL §4.3 is not satisfied by text a screen reader cannot reach.
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    const credit = document.querySelector('.oyl-map__attribution');
    expect(credit).not.toBeNull();
    expect(isHiddenFromAssistiveTechnology(credit as Element)).toBe(false);
  });

  it('is text in the document, not an attribute on the map', async () => {
    // An `aria-label` or a `title` would satisfy a grep and not a reader who is
    // looking at the page. The criterion says *rendered legibly*.
    await openPanel(<MapPanel port={stubMapPort()} basemap={BASEMAP} track={aTrack()} />);
    expect(queryAll(document, 'p').map((node) => node.textContent)).toContain(
      '© OpenStreetMap contributors',
    );
  });
});
