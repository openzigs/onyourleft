// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A chosen route's page with its map, audited — #2003.
 *
 * ⚠️ **`routes.a11y.test.tsx` cannot see this.** It renders every route with
 * no ports, so the Routes screen it audits has no route chosen and no map
 * engine, and the map, its credit and its seven buttons are outside it.
 * `map.a11y.test.tsx` audits the panel alone, inside headings written for a
 * ride. This is the panel where a rider meets it: under a chosen route's name,
 * after its facts, in the detail pane.
 *
 * What it holds, beside a clean audit: **the map is not the only way to the
 * route's facts** — its distance, climb, shape and who can see it are words in
 * the page — and the way to move the map is the buttons, which are in the tab
 * order, while the map surface is not.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e).
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  unixSeconds,
  type RoutePoint,
} from '@onyourleft/domain';
import { athleteId as toAthleteId, type RouteRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { OSM_ATTRIBUTION } from '../map/basemap';
import { stubMapPort } from '../map/testing';
import { routeStub, stubRouteId } from '../routes/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { RoutesView } from './RoutesView';

const ATHLETE = toAthleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function aRoute(): RouteRecord {
  const points: RoutePoint[] = Array.from({ length: 40 }, (_unused, index) => ({
    position: geographicPosition(
      degreesLatitude(51.5 + index * 0.0005),
      degreesLongitude(-0.1 + index * 0.0002),
    ),
    elevation: altitudeMetres(30 + index),
  }));
  return {
    id: stubRouteId('route-1'),
    createdBy: ATHLETE,
    name: 'Old mill loop',
    profile: routeProfile(points),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
}

/** The screen inside the `main` and `h1` the shell gives it — `RouteBuilder.a11y.test.tsx`'s reason. */
async function chosenWithMap(): Promise<Mounted> {
  document.documentElement.lang = 'en';
  const engine = stubMapPort();
  mounted = await mount(
    <main>
      <h1>Routes</h1>
      <RoutesView
        port={routeStub(ATHLETE, [aRoute()])}
        selected="route-1"
        map={() => Promise.resolve(engine)}
        basemap={{
          archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
          attribution: OSM_ATTRIBUTION,
        }}
      />
    </main>,
  );
  await settle();
  await settle();
  return mounted;
}

describe('a chosen route with its map — #2003', () => {
  it('passes the audit', async () => {
    await chosenWithMap();
    expect(document.querySelector('.oyl-map')).not.toBeNull();
    const violations = auditAccessibility(document);
    expect(formatViolations(violations)).toBe('');
  });

  it('keeps the route’s facts in words, so the map is not the only way to them', async () => {
    await chosenWithMap();
    const facts = queryAll(document, '.oyl-selected dt').map((term) => term.textContent);
    expect(facts).toEqual(['Distance', 'Climb', 'Shape', 'Who can see it']);
    for (const value of queryAll(document, '.oyl-selected dd')) {
      expect(value.textContent?.trim()).not.toBe('');
    }
  });

  it('moves the map from buttons in the tab order, and puts the map itself in none', async () => {
    await chosenWithMap();
    const map = document.querySelector('.oyl-map') as HTMLElement;
    const tabbable = tabbableElements(document);
    expect(tabbable).not.toContain(map);
    expect(tabbableElements(map)).toEqual([]);
    const moves = queryAll(document, '.oyl-map__moves button');
    expect(moves).toHaveLength(7);
    for (const button of moves) {
      expect(tabbable).toContain(button);
    }
  });
});
