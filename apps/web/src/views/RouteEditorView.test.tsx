// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The route editor, action by action — #2007.
 *
 * #2007's second criterion: *each action has a test that fails without it,
 * read back through the saved route.* So every test below makes its change
 * through the screen's own controls, saves it, and reads the route back with
 * the store port's `getRoute`, the read the routes screen itself makes. What
 * the screen merely showed would be a weaker claim.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  LOOP_CLOSURE_METRES,
  routeProfile,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { athleteId, routeId, type RouteRecord } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { OSM_ATTRIBUTION } from '../map/basemap';
import type { MapPointerHandlers } from '../map/port';
import { stubMapPort, type StubMapPort } from '../map/testing';
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
import { NUDGE_DEGREES } from './RouteBuilderView';
import { FREEHAND_STRETCH_TEXT, NO_ROUTE_TO_EDIT_TEXT, RouteEditorView } from './RouteEditorView';

const ATHLETE = athleteId('athlete-editing');
const ID = routeId('route-saturday');
const SAVED_AT = unixSeconds(1_790_000_000);
const NOW = 1_800_000_000;
const BASEMAP = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function at(north: number, east: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(0.5 + north / 111_195),
    degreesLongitude(0.5 + east / 111_178),
  );
}

/** A 2 km route that bends east at its middle. */
function saturday(): RouteRecord {
  return {
    id: ID,
    createdBy: ATHLETE,
    name: 'Saturday',
    profile: routeProfile([
      { position: at(0, 0), elevation: altitudeMetres(100) },
      { position: at(1_000, 200), elevation: altitudeMetres(150) },
      { position: at(2_000, 0), elevation: altitudeMetres(120) },
    ]),
    visibility: 'private',
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
  };
}

interface Editor {
  readonly view: Mounted;
  readonly routes: RouteStub;
  readonly engine: StubMapPort;
}

async function open(options: { provider?: boolean } = {}): Promise<Editor> {
  const routes = routeStub(ATHLETE, [saturday()]);
  const engine = stubMapPort();
  mounted = await mount(
    <main>
      <h1>Edit a route</h1>
      <RouteEditorView
        routes={routes}
        selected={ID}
        provider={options.provider === true ? scriptedProvider() : undefined}
        map={() => Promise.resolve(engine)}
        basemap={BASEMAP}
        now={() => NOW}
      />
    </main>,
  );
  await settle();
  await settle();
  return { view: mounted, routes, engine };
}

function buttonNamed(view: Mounted, label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(view.container, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}"`);
  return found;
}

function hasButton(view: Mounted, label: string): boolean {
  return queryAll<HTMLButtonElement>(view.container, 'button').some(
    (button) => button.textContent?.trim() === label,
  );
}

async function press(view: Mounted, label: string): Promise<void> {
  await activateWithKeyboard(buttonNamed(view, label));
  await settle();
  await settle();
}

function fieldLabelled(view: Mounted, label: string): HTMLInputElement {
  const found = queryAll<HTMLLabelElement>(view.container, 'label').find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  const control = found?.htmlFor === '' ? found.querySelector('input') : found?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no field labelled "${label}"`);
  return control;
}

async function chooseChange(view: Mounted, label: string): Promise<void> {
  const radio = fieldLabelled(view, label);
  await act(async () => {
    radio.click();
    await Promise.resolve();
  });
  await settle();
}

/** Save over the original, and read the route back as the routes screen would. */
async function savedOver(editor: Editor): Promise<RouteRecord> {
  await press(editor.view, 'Save over “Saturday”');
  const read = await editor.routes.store.getRoute(ATHLETE, ID);
  if (read === undefined) throw new Error('the route did not read back');
  return read;
}

function status(view: Mounted): string {
  return view.container.querySelector('[role="status"]')?.textContent ?? '';
}

describe('opening a route to edit', () => {
  it('says so with nothing to edit', async () => {
    mounted = await mount(<RouteEditorView />);
    await settle();
    expect(mounted.container.textContent).toContain(NO_ROUTE_TO_EDIT_TEXT);
  });

  it('says a stretch is freehand with no routing service', async () => {
    const editor = await open();
    expect(editor.view.container.textContent).toContain(FREEHAND_STRETCH_TEXT);
    expect(editor.view.container.textContent).toContain('Saturday');
  });

  it('draws the saved line on an editable map, whole', async () => {
    const editor = await open();
    const map = editor.engine.created[0]!;
    expect(map.options.editable).toBe(true);
    expect(map.tracks.at(-1)?.geometry.coordinates[0]).toHaveLength(
      saturday().profile.positions.length,
    );
  });
});

describe('redraw a stretch', () => {
  it('replaces the stretch between two distances and keeps every other sample', async () => {
    const editor = await open();
    const before = saturday().profile;
    await typeInto(fieldLabelled(editor.view, 'Stretch starts at'), '0.40');
    await typeInto(fieldLabelled(editor.view, 'Stretch ends at'), '1.60');
    await press(editor.view, 'Redraw this stretch');
    expect(status(editor.view)).toContain('Redrew the stretch from 0.40 to 1.60 km');

    const read = await savedOver(editor);
    const from = Math.round(400 / before.resolution);
    const to = Math.round(1_600 / before.resolution);
    expect(read.profile.positions.slice(0, from + 1)).toEqual(before.positions.slice(0, from + 1));
    const tail = before.positions.length - to;
    expect(read.profile.positions.slice(-tail)).toEqual(before.positions.slice(to));
    // The bend was in the stretch: the straight line across it is shorter.
    expect(read.profile.totalDistance).toBeLessThan(before.totalDistance - 10);
    expect(read.updatedAt).toBe(NOW);
  });

  it('picks the stretch’s ends with two taps near the line', async () => {
    const editor = await open();
    const handlers = editor.engine.created[0]!.handlers as MapPointerHandlers;
    const before = saturday().profile;
    await act(async () => {
      handlers.tap(before.positions[30]!);
      await Promise.resolve();
    });
    await act(async () => {
      handlers.tap(before.positions[170]!);
      await Promise.resolve();
    });
    await settle();
    const from = Number(fieldLabelled(editor.view, 'Stretch starts at').value);
    const to = Number(fieldLabelled(editor.view, 'Stretch ends at').value);
    expect(from).toBeCloseTo((30 * before.resolution) / 1000, 2);
    expect(to).toBeCloseTo((170 * before.resolution) / 1000, 2);
  });

  it('follows the roads with a routing service', async () => {
    const editor = await open({ provider: true });
    await typeInto(fieldLabelled(editor.view, 'Stretch starts at'), '0.40');
    await typeInto(fieldLabelled(editor.view, 'Stretch ends at'), '1.60');
    await press(editor.view, 'Redraw this stretch');
    const read = await savedOver(editor);
    expect(read.profile.positions.length).toBeGreaterThan(3);
    expect(editor.view.container.textContent).not.toContain(FREEHAND_STRETCH_TEXT);
  });

  it('refuses one place for both ends, and changes nothing', async () => {
    const editor = await open();
    await typeInto(fieldLabelled(editor.view, 'Stretch starts at'), '0.50');
    await typeInto(fieldLabelled(editor.view, 'Stretch ends at'), '0.50');
    await press(editor.view, 'Redraw this stretch');
    expect(status(editor.view)).toContain('Choose two different places');
    expect(hasButton(editor.view, 'Undo')).toBe(false);
  });
});

describe('change the start', () => {
  it('starts at a new place and joins the route where the rider said', async () => {
    const editor = await open();
    const before = saturday().profile;
    await chooseChange(editor.view, 'Its start');
    await typeInto(fieldLabelled(editor.view, 'It joins the route at'), '0.30');
    await press(editor.view, 'Move the new start west');
    await press(editor.view, 'Move the new start west');
    await press(editor.view, 'Change the start');

    const read = await savedOver(editor);
    const first = read.profile.positions[0]!;
    expect(first.longitude).toBeCloseTo(before.positions[0]!.longitude - 2 * NUDGE_DEGREES, 9);
    const join = Math.round(300 / before.resolution);
    const tail = before.positions.length - join;
    expect(read.profile.positions.slice(-tail)).toEqual(before.positions.slice(join));
  });
});

describe('change the end', () => {
  it('ends at a new place, keeping the route up to where it leaves it', async () => {
    const editor = await open();
    const before = saturday().profile;
    await chooseChange(editor.view, 'Its end');
    await typeInto(fieldLabelled(editor.view, 'It joins the route at'), '1.80');
    await press(editor.view, 'Move the new end east');
    await press(editor.view, 'Change the end');

    const read = await savedOver(editor);
    const join = Math.round(1_800 / before.resolution);
    expect(read.profile.positions.slice(0, join + 1)).toEqual(before.positions.slice(0, join + 1));
    const last = read.profile.positions.at(-1)!;
    expect(last.longitude).toBeCloseTo(before.positions.at(-1)!.longitude + NUDGE_DEGREES, 6);
  });
});

describe('out and back, reverse and return to start', () => {
  it('goes out and back: twice the length, ending at the start', async () => {
    const editor = await open();
    const before = saturday().profile;
    await press(editor.view, 'Out and back');
    const read = await savedOver(editor);
    expect(read.profile.totalDistance).toBeCloseTo(before.totalDistance * 2, 6);
    expect(read.profile.positions.at(-1)).toEqual(before.positions[0]);
  });

  it('reverses: it starts where it ended', async () => {
    const editor = await open();
    const before = saturday().profile;
    await press(editor.view, 'Reverse');
    const read = await savedOver(editor);
    expect(read.profile.positions[0]).toEqual(before.positions.at(-1));
    expect(read.profile.totalAscent).toBe(before.totalDescent);
  });

  it('returns to its start, and is saved as a loop', async () => {
    const editor = await open();
    await press(editor.view, 'Return to start');
    const read = await savedOver(editor);
    expect(read.profile.loop).toBe(true);
    expect(
      distanceBetween(read.profile.positions[0]!, read.profile.positions.at(-1)!),
    ).toBeLessThanOrEqual(LOOP_CLOSURE_METRES);
    expect(hasButton(editor.view, 'Return to start')).toBe(false);
  });
});

describe('undo and redo', () => {
  it('undoes back to the saved line', async () => {
    const editor = await open();
    const before = saturday().profile;
    await press(editor.view, 'Reverse');
    await press(editor.view, 'Out and back');
    await press(editor.view, 'Undo');
    await press(editor.view, 'Undo');
    expect(hasButton(editor.view, 'Undo')).toBe(false);
    const read = await savedOver(editor);
    expect(read.profile).toEqual(before);
  });

  it('redoes what was undone', async () => {
    const editor = await open();
    const before = saturday().profile;
    await press(editor.view, 'Reverse');
    await press(editor.view, 'Undo');
    await press(editor.view, 'Redo');
    const read = await savedOver(editor);
    expect(read.profile.positions[0]).toEqual(before.positions.at(-1));
  });
});

describe('saving', () => {
  it('as a new route leaves the original as it was', async () => {
    const editor = await open();
    await press(editor.view, 'Reverse');
    const name = fieldLabelled(editor.view, 'Name of the new route');
    await typeInto(name, 'Saturday, backwards');
    const form = editor.view.container.querySelector<HTMLFormElement>(
      'form[aria-label="Save the edit"]',
    );
    await submitForm(form!);
    await settle();

    const all = await editor.routes.store.listRoutes(ATHLETE);
    expect(all).toHaveLength(2);
    const copy = all.find((route) => route.id !== ID)!;
    expect(copy.name).toBe('Saturday, backwards');
    expect(copy.visibility).toBe('private');
    expect(copy.profile.positions[0]).toEqual(saturday().profile.positions.at(-1));
    expect(await editor.routes.store.getRoute(ATHLETE, ID)).toEqual(saturday());
  });

  it('over the original is refused when it was changed in another tab', async () => {
    const editor = await open();
    editor.routes.writeBehind({
      ...saturday(),
      name: 'Saturday',
      updatedAt: unixSeconds(SAVED_AT + 5),
    });
    await press(editor.view, 'Reverse');
    await press(editor.view, 'Save over “Saturday”');
    expect(editor.view.container.textContent).toContain('changed somewhere else');
    const read = await editor.routes.store.getRoute(ATHLETE, ID);
    expect(read?.profile).toEqual(saturday().profile);
  });

  it('over the original twice in a row: the second save is not refused by the first', async () => {
    const editor = await open();
    await press(editor.view, 'Reverse');
    await savedOver(editor);
    await press(editor.view, 'Reverse');
    const read = await savedOver(editor);
    expect(read.profile.positions[0]).toEqual(saturday().profile.positions[0]);
  });
});
