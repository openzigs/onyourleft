// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The route planner on its map — #2006.
 *
 * The map is the recording port (`map/testing.ts`): a gesture is fired the way
 * the real adapter reports it, through the handlers the planner gave `listen`,
 * and every assertion is read back through the planner's own state — the
 * draft it keeps across a reload (its `DraftStorage`) and the list it renders —
 * never through the object the test handed in. `map.browser.spec.ts` §"the
 * route planner's map" is the other half: that the real engine reports those
 * gestures at all.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OSM_ATTRIBUTION } from '../map/basemap';
import type { MapPointerHandlers } from '../map/port';
import { STUB_MAP_CENTRE, stubMapPort, type RecordedMap, type StubMapPort } from '../map/testing';
import type { RouteDraft } from '../routing/draft';
import type { DraftStorage } from '../routing/draft-storage';
import { EMPTY_PLANNER_VIEW } from '../routing/map-edit';
import { scriptedProvider } from '../routing/testing';
import { routeStub, type RouteStub } from '../routes/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { PLANNER_MAP_FAILED_TEXT, PLANNER_MAP_TEXT, RouteBuilderView } from './RouteBuilderView';

const BASEMAP = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};
const ATHLETE = athleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A draft store in a closure, read back as the planner's own state. @see RouteBuilderView.test.tsx */
function isolatedStorage(): DraftStorage & { held(): RouteDraft | undefined } {
  let held: RouteDraft | undefined;
  return {
    read: () => held,
    write: (draft) => {
      held = draft;
    },
    forget: () => {
      held = undefined;
    },
    held: () => held,
  };
}

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

interface Planner {
  readonly view: Mounted;
  readonly engine: StubMapPort;
  readonly storage: ReturnType<typeof isolatedStorage>;
  readonly routes: RouteStub;
  map(): RecordedMap;
}

async function open(
  options: { provider?: boolean; map?: 'stub' | 'failing'; now?: () => number } = {},
): Promise<Planner> {
  const engine = stubMapPort();
  const storage = isolatedStorage();
  const routes = routeStub(ATHLETE);
  mounted = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView
        provider={options.provider === true ? scriptedProvider() : undefined}
        storage={storage}
        map={
          options.map === 'failing'
            ? () => Promise.reject(new Error('no chunk'))
            : () => Promise.resolve(engine)
        }
        basemap={BASEMAP}
        preferences={undefined}
        routes={routes}
        now={options.now}
      />
    </main>,
  );
  await settle();
  await settle();
  const view = mounted;
  return {
    view,
    engine,
    storage,
    routes,
    map: () => {
      const created = engine.created.at(-1);
      if (created === undefined) throw new Error('the planner created no map');
      return created;
    },
  };
}

/** Fire a gesture the way the adapter reports one, and let the planner render. */
async function gesture(
  planner: Planner,
  fire: (handlers: MapPointerHandlers) => void,
): Promise<void> {
  const handlers = planner.map().handlers;
  if (handlers === undefined) throw new Error('the planner is not listening to its map');
  await act(async () => {
    fire(handlers);
    await Promise.resolve();
  });
  await settle();
}

function waypoints(planner: Planner): readonly GeographicPosition[] {
  return planner.storage.held()?.waypoints.map((waypoint) => waypoint.position) ?? [];
}

function buttonNamed(view: Mounted, label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(view.container, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}"`);
  return found;
}

const A = at(40, -105);
const B = at(40.02, -105);
const C = at(40.02, -104.98);

describe('the map is on the planner — #2006', () => {
  it('draws an editable map with no waypoints, at the empty view, and says how to use it', async () => {
    const planner = await open();
    const map = planner.map();
    expect(map.options.explorable).toBe(true);
    expect(map.options.editable).toBe(true);
    expect(map.tracks).toEqual([undefined]);
    expect(map.bounds).toEqual([EMPTY_PLANNER_VIEW]);
    expect(planner.view.container.textContent).toContain(PLANNER_MAP_TEXT);
    expect(planner.view.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Map for drawing a route.',
    );
  });

  it('says how to use the map only when there is one to use', async () => {
    const engine = stubMapPort();
    mounted = await mount(
      <main>
        <h1>Draw a route</h1>
        <RouteBuilderView
          storage={isolatedStorage()}
          map={() => Promise.resolve(engine)}
          basemap={undefined}
        />
      </main>,
    );
    await settle();
    await settle();
    expect(mounted.container.textContent).not.toContain(PLANNER_MAP_TEXT);
    expect(mounted.container.textContent).toContain('This build has no basemap');
    expect(engine.created).toHaveLength(0);
  });

  it('says so when the map engine cannot be loaded, and the list still places waypoints', async () => {
    const planner = await open({ map: 'failing' });
    expect(planner.view.container.textContent).toContain(PLANNER_MAP_FAILED_TEXT);
    await activateWithKeyboard(buttonNamed(planner.view, 'Add a waypoint'));
    await settle();
    expect(waypoints(planner)).toHaveLength(1);
  });
});

describe('tap to add — #2006', () => {
  it('adds a waypoint where the map was tapped, in order', async () => {
    const planner = await open();
    await gesture(planner, (map) => {
      map.tap(A);
    });
    await gesture(planner, (map) => {
      map.tap(B);
    });
    expect(waypoints(planner)).toEqual([A, B]);
    expect(planner.view.container.textContent).toContain('Waypoint 2');
    // And the map is handed both, as markers, with the planner's ids.
    expect(planner.map().waypoints.at(-1)).toEqual([
      { id: 'w1', position: A },
      { id: 'w2', position: B },
    ]);
  });

  it('draws a straight leg with no routing service, and calls its distance a minimum', async () => {
    const planner = await open();
    await gesture(planner, (map) => {
      map.tap(A);
    });
    await gesture(planner, (map) => {
      map.tap(B);
    });
    expect(planner.storage.held()?.legs.map((leg) => [leg.mode, leg.state])).toEqual([
      ['freehand', 'routed'],
    ]);
    expect(planner.map().tracks.at(-1)?.geometry.coordinates).toEqual([
      [
        [-105, 40],
        [-105, 40.02],
      ],
    ]);
    expect(planner.view.container.textContent).toMatch(/At least 2\.2\d* km over 1 leg\./);
  });

  it('asks the routing service for the leg when there is one', async () => {
    const planner = await open({ provider: true });
    await gesture(planner, (map) => {
      map.tap(A);
    });
    await gesture(planner, (map) => {
      map.tap(B);
    });
    expect(planner.storage.held()?.legs[0]?.mode).toBe('snapped');
  });

  it('fits the view once, not at every tap', async () => {
    const planner = await open();
    await gesture(planner, (map) => {
      map.tap(A);
    });
    await gesture(planner, (map) => {
      map.tap(B);
    });
    await gesture(planner, (map) => {
      map.tap(C);
    });
    expect(planner.map().fits).toEqual([true, false, false]);
  });
});

describe('the first waypoint starts at the map’s centre — #2006', () => {
  it('lands where the rider has been looking, not at the fixed default', async () => {
    const planner = await open();
    const looking = at(39.5, -106.1);
    planner.map().centre = looking;
    await activateWithKeyboard(buttonNamed(planner.view, 'Add a waypoint'));
    await settle();
    expect(waypoints(planner)).toEqual([looking]);
    expect(STUB_MAP_CENTRE).not.toEqual(looking);
  });
});

describe('drag to move — #2006', () => {
  it('moves the waypoint that was dragged, and only it', async () => {
    const planner = await open();
    for (const point of [A, B, C]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    const dropped = at(40.025, -105.01);
    await gesture(planner, (map) => {
      map.moveWaypoint('w2', dropped);
    });
    expect(waypoints(planner)).toEqual([A, dropped, C]);
  });

  it('is one step of undo', async () => {
    const planner = await open();
    for (const point of [A, B]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    await gesture(planner, (map) => {
      map.moveWaypoint('w1', C);
    });
    await activateWithKeyboard(buttonNamed(planner.view, 'Undo'));
    await settle();
    expect(waypoints(planner)).toEqual([A, B]);
  });
});

describe('drag the line to insert — #2006', () => {
  it('puts a new waypoint where the line was let go, on the leg that was grabbed', async () => {
    const planner = await open();
    for (const point of [A, B, C]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    // Grabbed on the second leg (B to C, running east), let go to its north.
    const dropped = at(40.03, -104.99);
    await gesture(planner, (map) => {
      map.dragLine(at(40.0201, -104.99), dropped);
    });
    expect(waypoints(planner)).toEqual([A, B, dropped, C]);
  });

  it('on the first leg, when that is the one grabbed', async () => {
    const planner = await open();
    for (const point of [A, B, C]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    const dropped = at(40.01, -105.01);
    await gesture(planner, (map) => {
      map.dragLine(at(40.01, -104.9999), dropped);
    });
    expect(waypoints(planner)).toEqual([A, dropped, B, C]);
  });

  it('has a keyboard equivalent on the leg’s row', async () => {
    const planner = await open();
    for (const point of [A, B]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    await activateWithKeyboard(buttonNamed(planner.view, 'Add a waypoint halfway along leg 1'));
    await settle();
    const [first, middle, last] = waypoints(planner);
    expect([first, last]).toEqual([A, B]);
    expect(middle?.latitude).toBeCloseTo(40.01, 9);
    expect(middle?.longitude).toBeCloseTo(-105, 9);
  });
});

describe('save to your routes — #2006', () => {
  async function drawnAndNamed(name: string, now?: () => number): Promise<Planner> {
    const planner = await open(now === undefined ? {} : { now });
    for (const point of [A, B, C]) {
      await gesture(planner, (map) => {
        map.tap(point);
      });
    }
    const input = planner.view.container.querySelector<HTMLInputElement>('input[name="name"]');
    if (input === null) throw new Error('no name field');
    await typeInto(input, name);
    const form = planner.view.container.querySelector<HTMLFormElement>(
      'form[aria-label="Save this route"]',
    );
    if (form === null) throw new Error('no save form');
    await submitForm(form);
    await settle();
    return planner;
  }

  it('writes the drawn line to the routes store, private, and links to it', async () => {
    const planner = await drawnAndNamed('Foothills', () => 1_700_000_000.25);
    const listed = await planner.routes.store.listRoutes(ATHLETE);
    expect(listed.map((route) => [route.name, route.visibility])).toEqual([
      ['Foothills', 'private'],
    ]);
    const saved = listed[0]!;
    expect(saved.id).toBe('route-1700000000250');
    expect(saved.profile.positions[0]).toEqual(A);
    expect(saved.profile.positions.at(-1)).toEqual(C);
    const text = planner.view.container.textContent ?? '';
    expect(text).toContain('Saved “Foothills” to your routes. It is private.');
    expect(text).toContain('saved flat');
    const link = [...planner.view.container.querySelectorAll('a')].find(
      (anchor) => anchor.textContent === 'Open it in Routes',
    );
    expect(link?.getAttribute('href')).toContain('route-1700000000250');
  });

  it('writes nothing, and says why, when the route has no name', async () => {
    const planner = await drawnAndNamed('  ');
    expect(await planner.routes.store.listRoutes(ATHLETE)).toEqual([]);
    expect(planner.view.container.textContent).toContain(
      'Give this route a name before saving it.',
    );
  });
});
