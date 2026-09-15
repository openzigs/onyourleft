// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The routes screen (#73).
 *
 * Four of the eight acceptance criteria are about what a *rider* is told or
 * asked, so they are asserted here rather than only in `routes/save.ts`:
 *
 * - a newly imported route is saved **private** and the screen says so
 *   (criterion 4);
 * - deleting asks first and names the route (criterion 3);
 * - the public warning is on the page in its own words (criterion 5);
 * - the list still renders when the local store throws (criterion 7).
 *
 * The claim running through them: **the screen reports what was written, never
 * what was asked for.** A screen that showed "private" over a public record is
 * a published address, and the same code path produces both.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  LOOP_CLOSURE_METRES,
  metres,
  routeProfile,
  unixSeconds,
  type RoutePoint,
} from '@onyourleft/domain';
import {
  athleteId as toAthleteId,
  privacyZoneId,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { FILE_FIELD, loopChosen, routeFromImportForm } from '../routes/import-form';
import { LOOP_CHECKBOX_LABEL } from '../routes/save';
import { loopGpx, routeStub, stubRouteId, type RouteStub } from '../routes/testing';
import type { DownloadableFile } from '../transfer/store-port';
import { PUBLIC_ROUTE_WARNING } from '../routes/share';
import { ROUTES_IMPORT_MEANS } from '../routes/two-importers';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { RoutesView } from './RoutesView';

const ATHLETE = toAthleteId('athlete-a');
const METRES_PER_DEGREE_LATITUDE = 111_194.93;
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function northPoints(lengthMetres: number, fromMetresNorth: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= lengthMetres; along += 25) {
    points.push({
      position: geographicPosition(
        degreesLatitude(HOME.latitude + (fromMetresNorth + along) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(HOME.longitude),
      ),
      elevation: altitudeMetres(30),
    });
  }
  return points;
}

function route(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    id: stubRouteId('route-1'),
    createdBy: ATHLETE,
    name: 'Box Hill loop',
    profile: routeProfile(northPoints(3000, 2000)),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}

function zone(): PrivacyZoneRecord {
  return {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
  };
}

async function render(stub: RouteStub): Promise<Mounted> {
  mounted = await mount(<RoutesView port={stub} now={() => 1_700_000_500} />);
  await settle();
  return mounted;
}

/** Renders with a download collector, so #74's export column is reachable. */
async function renderWithSave(stub: RouteStub): Promise<{
  root: Mounted;
  saved: DownloadableFile[];
}> {
  const saved: DownloadableFile[] = [];
  mounted = await mount(
    <RoutesView
      port={stub}
      now={() => 1_700_000_500}
      save={(file) => {
        saved.push(file);
      }}
    />,
  );
  await settle();
  return { root: mounted, saved };
}

function buttonSaying(root: ParentNode, text: string): HTMLElement | undefined {
  return queryAll(root, 'button').find((element) => element.textContent?.includes(text));
}

describe('the saved list', () => {
  it('shows a route’s name, shape and who can see it — never in colour alone', () => {
    // #48: nothing on this screen encodes meaning in colour, so the visibility
    // is a word in its own cell.
    return render(routeStub(ATHLETE, [route()])).then((view) => {
      const text = view.container.textContent ?? '';
      expect(text).toContain('Box Hill loop');
      expect(text).toContain('private');
      expect(text).toContain('Point to point');
    });
  });

  it('says what its importer makes, and where a ride already done goes — #232', async () => {
    // #232's third criterion: the two importers' distinct purposes are stated
    // where a rider chooses, not only in the code. The wording is the shared
    // constant so this screen and the Files screen cannot drift apart.
    const view = await render(routeStub(ATHLETE));

    expect(view.container.textContent).toContain(ROUTES_IMPORT_MEANS);
    const targets = queryAll<HTMLAnchorElement>(view.container, 'a').map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
    expect(targets).toContain('#/transfer');
  });

  it('says there are none rather than rendering an empty table', async () => {
    const view = await render(routeStub(ATHLETE));
    expect(view.container.textContent).toContain('no saved routes yet');
  });

  it('still renders when the local store throws — #73 criterion 7', async () => {
    // There is no network to be offline from: everything is local, so the shape
    // this failure takes is a store that will not answer. The screen must say
    // that rather than blaming a connection or rendering nothing.
    const stub = routeStub(ATHLETE, [route()]);
    stub.failNextList();
    const view = await render(stub);
    const text = view.container.textContent ?? '';
    expect(text).toContain('not a connection problem');
    expect(text).toContain('Import a route');
  });

  it('explains itself when this browser has no local store at all', async () => {
    mounted = await mount(<RoutesView />);
    await settle();
    expect(mounted.container.textContent).toContain('not available in this browser');
  });
});

describe('deleting — #73 criterion 3', () => {
  it('asks first, and names the route it is about to remove', async () => {
    const stub = routeStub(ATHLETE, [route()]);
    const view = await render(stub);
    const remove = buttonSaying(view.container, 'Delete');
    expect(remove).toBeDefined();
    await activateWithKeyboard(remove as HTMLElement);
    await settle();
    const text = view.container.textContent ?? '';
    expect(text).toContain('Delete this route?');
    expect(text).toContain('Box Hill loop');
    expect(text).toContain('cannot be undone');
    // And nothing has gone yet.
    expect(stub.rows()).toHaveLength(1);
  });

  it('keeps it when the rider backs out', async () => {
    const stub = routeStub(ATHLETE, [route()]);
    const view = await render(stub);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonSaying(view.container, 'Keep it') as HTMLElement);
    await settle();
    expect(stub.rows()).toHaveLength(1);
  });

  it('removes it once confirmed', async () => {
    const stub = routeStub(ATHLETE, [route()]);
    const view = await render(stub);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(
      buttonSaying(view.container, 'Delete “Box Hill loop”') as HTMLElement,
    );
    await settle();
    expect(stub.rows()).toHaveLength(0);
    expect(view.container.textContent).toContain('Deleted “Box Hill loop”');
  });
});

describe('editing', () => {
  it('renames in place, keeping the same route rather than adding one', async () => {
    const stub = routeStub(ATHLETE, [route()]);
    const view = await render(stub);
    const field = view.container.querySelector<HTMLInputElement>('#name-route-1');
    await typeInto(field as HTMLInputElement, 'Ranmore');
    await activateWithKeyboard(buttonSaying(view.container, 'Save changes') as HTMLElement);
    await settle();
    expect(stub.rows()).toHaveLength(1);
    expect(stub.rows()[0]?.name).toBe('Ranmore');
    expect(stub.rows()[0]?.id).toBe('route-1');
  });

  it('refuses when the route moved under the editor, and writes nothing', async () => {
    // A second tab. The screen is holding the updatedAt it read; the row has
    // moved on.
    const stub = routeStub(ATHLETE, [route()]);
    const view = await render(stub);
    stub.writeBehind({
      ...route(),
      name: 'Renamed elsewhere',
      updatedAt: unixSeconds(1_700_000_400),
    });
    const field = view.container.querySelector<HTMLInputElement>('#name-route-1');
    await typeInto(field as HTMLInputElement, 'Mine');
    await activateWithKeyboard(buttonSaying(view.container, 'Save changes') as HTMLElement);
    await settle();
    expect(view.container.textContent).toContain('changed somewhere else');
    expect(stub.rows()[0]?.name).toBe('Renamed elsewhere');
  });

  it('refuses to publish a route a privacy zone would truncate', async () => {
    // The route starts at home. Trimming would move its start, and a route with
    // a different start is not the route — so nothing is written at all.
    const stub = routeStub(ATHLETE, [route({ profile: routeProfile(northPoints(3000, 0)) })]);
    stub.setZones([zone()]);
    const view = await render(stub);
    const select = view.container.querySelector<HTMLSelectElement>('#visibility-route-1');
    (select as HTMLSelectElement).value = 'public';
    await activateWithKeyboard(buttonSaying(view.container, 'Save changes') as HTMLElement);
    await settle();
    expect(view.container.textContent).toContain('would not be this route');
    expect(stub.rows()[0]?.visibility).toBe('private');
  });
});

describe('the warning before publishing — #73 criterion 5', () => {
  it('is on the page in the words share.ts states, not a generic notice', async () => {
    const view = await render(routeStub(ATHLETE, [route()]));
    const text = view.container.textContent ?? '';
    expect(text).toContain(PUBLIC_ROUTE_WARNING);
    // The half a generic notice would omit.
    expect(text).toContain('Most routes start at home');
  });
});

describe('sending a route to a head unit (#74)', () => {
  it('offers both formats, named, for each route', async () => {
    const { root } = await renderWithSave(routeStub(ATHLETE, [route()]));
    // The format is in the label rather than in an icon: #48's audit counts an
    // unnamed control as a violation, and "which file am I getting" is the
    // whole question the control answers.
    expect(buttonSaying(root.container, 'Download GPX — Box Hill loop')).toBeDefined();
    expect(buttonSaying(root.container, 'Download TCX — Box Hill loop')).toBeDefined();
  });

  it('hands the rider a named file when they press it', async () => {
    const { root, saved } = await renderWithSave(routeStub(ATHLETE, [route()]));
    buttonSaying(root.container, 'Download GPX')?.click();
    await settle();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fileName).toBe('Box Hill loop.gpx');
    expect(saved[0]?.mediaType).toBe('application/gpx+xml');
    expect(new TextDecoder().decode(saved[0]?.bytes)).toContain('<trkpt');
  });

  it('says what the file could not carry, in the same breath as saying it is ready', async () => {
    const { root } = await renderWithSave(routeStub(ATHLETE, [route()]));
    buttonSaying(root.container, 'Download TCX')?.click();
    await settle();
    const text = root.container.textContent ?? '';
    expect(text).toContain('Box Hill loop.tcx is ready');
    expect(text).toContain('Gradient is not written');
    expect(text).toContain('course time of zero');
  });

  it('renders no download control at all when the browser cannot save', async () => {
    // Rather than a button that does nothing. `save` is absent exactly when
    // `main.tsx` could not build a transfer port, which is the same condition
    // the transfer screen already refuses under.
    const stub = routeStub(ATHLETE, [route()]);
    mounted = await mount(<RoutesView port={stub} now={() => 1_700_000_500} />);
    await settle();
    expect(buttonSaying(mounted.container, 'Download GPX')).toBeUndefined();
    expect(mounted.container.textContent).toContain('Downloading is not available');
  });

  it('exports without reading the store again', async () => {
    // The list read already decoded the whole profile — that is what
    // ROUTE_LIST_LIMIT budgets for — so a second read would decode the same
    // megabytes to produce the same bytes. Asserted by making a further read
    // fail: if the export path took one, this would throw rather than download.
    const stub = routeStub(ATHLETE, [route()]);
    const { root, saved } = await renderWithSave(stub);
    stub.failNextList();
    buttonSaying(root.container, 'Download GPX')?.click();
    await settle();
    expect(saved).toHaveLength(1);
  });
});

describe('the file input a rider chooses a GPX with', () => {
  it('carries no accept filter, because Android types a .gpx as octet-stream', async () => {
    // ⚠️ **This asserts an ABSENCE, and the reason is a measurement rather than
    // a preference.** `accept=".gpx,application/gpx+xml"` shipped here and made
    // route import impossible on Android (#233): the system picker filters on
    // MIME type and does not match on the extension half, and Android's
    // MediaStore types a `.gpx` as `application/octet-stream` —
    //
    //   Row: 174 _display_name=Afternoon_Ride.gpx, mime_type=application/octet-stream
    //
    // read from a Pixel Tablet on Android 17. So the one file the rider came
    // for was the one file the picker greyed out.
    //
    // `TransferView` reached the same answer from a different direction and
    // says so at its own input: a filter "quietly drops them before the batch
    // sees them". Two screens, two reasons, one rule — and this test is what
    // stops a third screen learning it a third time.
    //
    // ⚠️ **It cannot stand in for the device check.** jsdom has no file picker,
    // `testing/mount.tsx` deliberately provides no helper for attaching a file,
    // and nothing here opens a chooser. This pins the attribute; only a device
    // establishes that a file can be selected. `docs/validation/0002` Part A
    // carries that step.
    const stub = routeStub(ATHLETE);
    const view = await render(stub);
    const field = view.container.querySelector<HTMLInputElement>('#route-file');
    if (field === null) throw new Error('no route-file field on this screen');

    expect(field.hasAttribute('accept')).toBe(false);
  });
});

describe('the loop box — #296', () => {
  /** The import form, found the way a rider finds it: through its file input. */
  function importForm(view: Mounted): HTMLFormElement {
    const field = view.container.querySelector<HTMLInputElement>('#route-file');
    const form = field?.closest('form');
    if (form == null) throw new Error('no import form on this screen');
    return form;
  }

  it('is a named control beside the file input, not a second screen', async () => {
    const view = await render(routeStub(ATHLETE));
    const box = view.container.querySelector<HTMLInputElement>('#route-loop');

    expect(box?.type).toBe('checkbox');
    expect(importForm(view).contains(box)).toBe(true);
    // #48's audit counts an unnamed control as a violation, and the words are
    // the ones the refusal tells a rider to untick.
    expect(box?.labels?.[0]?.textContent).toContain(LOOP_CHECKBOX_LABEL);
    // The rule the geometry is held to, where the rider is making the claim.
    expect(view.container.textContent).toContain(`${String(LOOP_CLOSURE_METRES)} m apart`);
  });

  it('lists a route imported as a loop as a Loop', async () => {
    // The Shape column has said "Loop" since #73 and no route in the product
    // could ever land in that branch, which is #296 in one table cell. The row
    // is seeded from the **import path's** own record rather than from a
    // hand-built profile, so the cell and the importer agree.
    const outcome = await routeFromImportForm(
      (() => {
        const form = new FormData();
        form.set(FILE_FIELD, new File([loopGpx()], 'circuit.gpx'));
        form.set('loop', 'on');
        return form;
      })(),
      { id: stubRouteId('route-1'), owner: ATHLETE, now: unixSeconds(1_700_000_000) },
    );
    if (outcome.status !== 'saved') throw new Error('the import refused the circuit');

    const view = await render(routeStub(ATHLETE, [outcome.record]));

    expect(view.container.textContent).toContain('Loop');
    expect(view.container.textContent).not.toContain('Point to point');
  });

  it('starts unticked, so an import means what it has always meant', async () => {
    const view = await render(routeStub(ATHLETE));

    expect(loopChosen(new FormData(importForm(view)))).toBe(false);
  });

  it('reaches the importer under the name the importer reads', async () => {
    // ⚠️ **This is the assertion #296 existed for, and it is shaped by what
    // jsdom cannot do.** No file can be put into a file input here
    // (`testing/mount.tsx` says why, from a false pass), so the form can never
    // be submitted through to a decoded route. What CAN be done is to build a
    // `FormData` from the **real rendered form** and put a real file into that
    // — so the field names, the checkbox, the reader and the whole import path
    // are the production ones, and only `new FormData(event.currentTarget)` is
    // taken on trust.
    const view = await render(routeStub(ATHLETE));
    const box = view.container.querySelector<HTMLInputElement>('#route-loop');
    if (box === null) throw new Error('no loop box on this screen');
    box.click();
    await settle();

    const submitted = new FormData(importForm(view));
    expect(loopChosen(submitted)).toBe(true);
    submitted.set(FILE_FIELD, new File([loopGpx()], 'sunday.gpx'));

    const outcome = await routeFromImportForm(submitted, {
      id: stubRouteId('route-2'),
      owner: ATHLETE,
      now: unixSeconds(1_700_000_500),
    });

    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.record.profile.loop).toBe(true);
  });
});

describe('pressing Import with no file chosen', () => {
  it('asks for a file rather than reporting bad GPX', async () => {
    // ⚠️ The guard this covers is NOT `instanceof File`, and the reason is the
    // HTML specification: a file input with no selection still appends an
    // entry holding a `File` with an empty name and no body. So the obvious
    // check passes, the empty body reaches `routeFromGpx`, and a rider who
    // pressed the button by mistake is told their file is not valid GPX —
    // which sends them looking at a file they never chose.
    //
    // Found in #202's review of the identical guard on the workouts screen,
    // reported there and fixed here.
    const stub = routeStub(ATHLETE);
    const view = await render(stub);
    const field = view.container.querySelector<HTMLInputElement>('#route-file');
    if (field === null) throw new Error('no route-file field on this screen');
    const form = field.closest('form');
    if (form === null) throw new Error('that field is not in a form');

    await submitForm(form);

    expect(view.container.textContent ?? '').toContain('Choose a GPX file to import.');
    expect(stub.rows()).toHaveLength(0);
  });
});
