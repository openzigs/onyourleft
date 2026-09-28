// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #62's acceptance criteria, against the view a rider actually sees.
 *
 * Two kinds of test here, deliberately. Most drive `stubLibrary`, because what
 * they are about is the *view* — what it reads, how it orders, what it says
 * before it deletes — and a real IndexedDB would only make those slower and
 * flakier without making them stricter. The deletion test uses the **real**
 * store through the #28 harness and reads back on a fresh connection, because
 * "the row is gone" is a persistence claim and CLAUDE.md §5 names the failure
 * it would otherwise miss: a write that reports success while the read cannot
 * see it.
 */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  type ActivityId,
  type ActivitySummary,
  type AthleteId,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TABLE_FROM_REM } from '../library/layout';
import { PAGE_SIZE } from '../library/rows';
import { stubLibrary } from '../library/testing';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  type Mounted,
} from '../testing/mount';

import { ActivitiesView } from './ActivitiesView';

const OWNER = athleteId('athlete-a');

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  vi.unstubAllGlobals();
});

function summary(id: string, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: activityId(id),
    athleteId: OWNER,
    name: 'Morning ride',
    startedAt: unixSeconds(1_700_000_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3_725),
    movingTime: seconds(3_600),
    distance: metres(42_195),
    visibility: 'private',
    hasPosition: true,
    createdAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}

function rowText(): string[] {
  return queryAll(document.body, 'tbody tr').map((row) => row.textContent ?? '');
}

function sortControl(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('select#oyl-library-sort');
  if (select === null) {
    throw new Error('the library has no sort control');
  }
  return select;
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find((button) =>
    (button.textContent ?? '').includes(text),
  );
}

describe('#62 — the local activity library', () => {
  it('renders every stored ride with no network request at all', async () => {
    // The failure prevented: a "local-first" app that shows an empty list when
    // offline, which is indistinguishable from having no rides. `fetch` throws
    // here, so a view that reached for it would fail rather than quietly
    // degrade.
    vi.stubGlobal('fetch', () => {
      throw new Error('the network must not be touched to list local rides');
    });
    const library = stubLibrary(OWNER, [
      summary('a', { name: 'Tuesday hills' }),
      summary('b', { name: 'Sunday long' }),
    ]);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(rowText().join(' ')).toContain('Tuesday hills');
    expect(rowText().join(' ')).toContain('Sunday long');
  });

  it('shows an imported ride and a recorded ride identically', async () => {
    // Two lists is a product bug, not a layout choice. This holds structurally
    // rather than by care: `ActivitySummary` is `Omit<ActivityRecord,
    // 'originalFile'>`, so the projection the list reads has no field saying
    // where a ride came from — there is nothing here that *could* differ.
    const library = stubLibrary(OWNER, [
      summary('imported', { name: 'From the archive' }),
      summary('recorded', { name: 'From the archive' }),
    ]);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    const rows = rowText();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(rows[1]);
  });

  it('renders a complete row for an indoor ride with no GPS', async () => {
    // Half of this product's rides. A complete row with every column filled,
    // and the fact stated in words rather than by a missing map or an empty
    // location cell.
    const library = stubLibrary(OWNER, [
      summary('turbo', { name: 'Zwift hour', hasPosition: false, averagePower: watts(213) }),
    ]);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    const [row] = rowText();
    expect(row).toContain('Zwift hour');
    expect(row).toContain('indoor');
    expect(row).toContain('1:02:05');
    expect(row).toContain('42.2');
    expect(row).toContain('213');
    // No map, no thumbnail, no empty location cell anywhere on the page.
    expect(queryAll(document.body, 'img, canvas, [data-map]')).toHaveLength(0);
  });

  it('orders ties deterministically, and the same way every render', async () => {
    // Two rides with identical start times. Without a tie-break the order is
    // whatever the index yields, which is not a documented property of Dexie
    // and not one to depend on.
    const tied = unixSeconds(1_700_000_500);
    const library = stubLibrary(OWNER, [
      summary('zulu', { name: 'Zulu', startedAt: tied }),
      summary('alpha', { name: 'Alpha', startedAt: tied }),
    ]);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    const first = rowText();

    mounted.unmount();
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(rowText()).toStrictEqual(first);
    expect(first[0]).toContain('Alpha');
  });

  it('reads once per page with a thousand rides stored, not once per row', async () => {
    // The stated bound is PAGE_SIZE: one `listActivitySummaries` call renders a
    // page, however many rides exist. A view that read per row would issue a
    // thousand.
    const many = Array.from({ length: 1_000 }, (_, index) =>
      summary(`ride-${String(index).padStart(4, '0')}`, {
        startedAt: unixSeconds(1_700_000_000 + index),
      }),
    );
    const library = stubLibrary(OWNER, many);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(library.reads).toHaveLength(1);
    expect(library.reads[0]?.limit).toBe(PAGE_SIZE);
    expect(rowText()).toHaveLength(PAGE_SIZE);
  });

  it('asks before deleting, and says the copy may be the only one', async () => {
    const library = stubLibrary(OWNER, [summary('a', { name: 'Tuesday hills' })]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    const remove = buttonNamed('Delete');
    expect(remove).toBeDefined();
    await activateWithKeyboard(remove as HTMLElement);
    await settle();

    // Armed, not deleted.
    expect(library.deleted).toStrictEqual([]);
    expect(document.body.textContent).toContain('cannot be undone');
    expect(document.body.textContent).toContain('only one that exists');
    expect(buttonNamed('Confirm delete')).toBeDefined();
  });

  it('deletes only on the second press, and the ride is gone from a fresh connection', async () => {
    // The real store, read back through a connection that did not write it —
    // the #28 primitive. A stub could not tell "removed" from "removed from the
    // copy in memory".
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const open = harness;

    // Both through `write`, which reuses the open handle. `harness.read`
    // discards every handle and opens a fresh one — that is the whole point of
    // it — so a live component calling it on each render closes the database
    // under its own next call. The fresh connection belongs at the end, where
    // the assertion is, not in the middle of the view's own reads.
    const library = {
      athleteId: ATHLETE_A,
      store: {
        listActivitySummaries: (owner: AthleteId) =>
          open.write(async (store) => store.listActivitySummaries(owner)),
        deleteActivity: (owner: AthleteId, id: ActivityId) =>
          open.write(async (store) => store.deleteActivity(owner, id)),
        getActivity: (owner: AthleteId, id: ActivityId) =>
          open.write(async (store) => store.getActivity(owner, id)),
      },
    };

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    expect(rowText()).toHaveLength(1);

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Confirm delete') as HTMLElement);
    await settle();

    // Unmounted first, so the view cannot re-read through the handle the fresh
    // connection below is about to discard.
    mounted.unmount();
    mounted = undefined;

    const left = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(left).toHaveLength(0);
    expect(await open.read(async (store) => store.getActivity(ATHLETE_A, ride.id))).toBeUndefined();
    // The streams behind it went too: a summary removed while its stream set
    // survived would leave the ride's data on the device after the rider
    // deleted it.
    expect(
      await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).toBeUndefined();
  });

  it('lets the same file be imported again once its ride is deleted', async () => {
    // #62's deletion criterion also asks that the *original file* go, tested by
    // a read of the file key failing rather than returning stale bytes.
    //
    // ⚠️ Phase 1 stores no file bytes — `originalFile` is a reference, `{ key,
    // sha256 }`, and `import-batch.ts` records that the bytes are deliberately
    // not kept — so there is no file store to read a key from. What is
    // assertable, and what the criterion is really protecting, is that the
    // reference does not outlive the ride: the hash is what #26's index
    // deduplicates on, so a surviving one would report every re-import of that
    // file as a duplicate of a ride that is gone. That is the #166 trap in a
    // different doorway.
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const open = harness;
    const sha256 = 'a'.repeat(64);
    await open.write(async (store) =>
      store.putActivity({ ...ride, originalFile: { key: 'archive/ride.fit', sha256 } }),
    );
    expect(
      await open.read(async (store) => store.findActivityByOriginalFileHash(ATHLETE_A, sha256)),
    ).toBeDefined();

    const library = {
      athleteId: ATHLETE_A,
      store: {
        listActivitySummaries: (owner: AthleteId) =>
          open.write(async (store) => store.listActivitySummaries(owner)),
        deleteActivity: (owner: AthleteId, id: ActivityId) =>
          open.write(async (store) => store.deleteActivity(owner, id)),
        getActivity: (owner: AthleteId, id: ActivityId) =>
          open.write(async (store) => store.getActivity(owner, id)),
      },
    };
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Confirm delete') as HTMLElement);
    await settle();
    mounted.unmount();
    mounted = undefined;

    expect(
      await open.read(async (store) => store.findActivityByOriginalFileHash(ATHLETE_A, sha256)),
    ).toBeUndefined();
  });

  it('explains how to get a first activity when there are none', async () => {
    const library = stubLibrary(OWNER, []);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(document.body.textContent).toContain('Nothing recorded yet');
    const hrefs = queryAll<HTMLAnchorElement>(document.body, 'a').map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toContain('#/ride');
    expect(hrefs).toContain('#/transfer');
  });

  it('says so when there is no local store, rather than showing an empty list', async () => {
    // The one wrong answer is "you have no rides": indistinguishable from the
    // truth, and the answer a rider would act on.
    mounted = await mount(<ActivitiesView />);
    await settle();

    expect(document.body.textContent).toContain('No local store on this browser');
    expect(document.body.textContent).not.toContain('Nothing recorded yet');
  });

  it('says a read failed rather than rendering it as an empty library', async () => {
    const library = {
      athleteId: OWNER,
      store: {
        listActivitySummaries: () => Promise.reject(new Error('QuotaExceededError')),
        deleteActivity: () => Promise.resolve(true),
        getActivity: () => Promise.resolve(undefined),
      },
    };

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(document.body.textContent).toContain('Could not read the rides');
    expect(document.body.textContent).toContain('QuotaExceededError');
  });

  it('re-reads when the sort changes, and orders by the column asked for', async () => {
    const library = stubLibrary(OWNER, [
      summary('short', { name: 'Short', distance: metres(5_000) }),
      summary('long', { name: 'Long', distance: metres(100_000) }),
    ]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await chooseOption(sortControl(), 'distance:descending');
    await settle();

    expect(library.reads.at(-1)?.orderBy).toBe('distance');
    expect(library.reads.at(-1)?.direction).toBe('descending');
    expect(rowText()[0]).toContain('Long');

    await chooseOption(sortControl(), 'distance:ascending');
    await settle();

    expect(library.reads.at(-1)?.direction).toBe('ascending');
    expect(rowText()[0]).toContain('Short');
    // The caption says the order the list is in, in the control's own words.
    expect(document.querySelector('caption')?.textContent).toBe(
      'Rides on this device, shortest first',
    );
  });

  it('sorts with a labelled select, not with filled buttons — #660', async () => {
    // #654's button-hierarchy finding: the sort was two filled PRIMARY buttons,
    // the look this client gives to the one thing a page is for. It is a
    // choice among four orders, which is what a select is.
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, [summary('a')])} />);
    await settle();

    const select = sortControl();
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Sort');
    expect([...select.options].map((option) => option.textContent)).toStrictEqual([
      'Newest first',
      'Oldest first',
      'Longest first',
      'Shortest first',
    ]);
    expect(select.value).toBe('startedAt:descending');
    expect(queryAll(document.body, '.oyl-library-controls button')).toHaveLength(0);
  });
});

/**
 * A `ResizeObserver` that reports one width, once, when asked to observe —
 * which is what a browser does on the first frame. jsdom has none, and with
 * none the library stays a table (`library/layout.ts`).
 */
function observerReporting(width: number): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe(): void {
        this.#callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], this);
      }
      disconnect(): void {
        // Nothing to release.
      }
      unobserve(): void {
        // Nothing to release.
      }
    },
  );
}

/** jsdom's root font size, which is the browser default. */
const REM = 16;

describe('#660 — a card list on a phone, a table where it fits', () => {
  const rides = [
    summary('outdoor', {
      name: 'Tuesday hills',
      averagePower: watts(212),
      startedAt: unixSeconds(1_700_000_100),
    }),
    summary('indoor', { name: 'Zwift hour', hasPosition: false }),
  ];

  it('is a list of cards, one per ride, below the width the columns need', async () => {
    observerReporting(TABLE_FROM_REM * REM - 1);
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    expect(document.querySelector('table')).toBeNull();
    const cards = queryAll(document.body, '.oyl-activity-cards > li');
    expect(cards).toHaveLength(2);
    const first = cards[0]?.textContent ?? '';
    // Every fact the table's columns carry, with the unit a column heading
    // would have given it.
    expect(first).toContain('Tuesday hills');
    expect(first).toContain('1:02:05');
    expect(first).toContain('42.2 km');
    expect(first).toContain('212 W');
    expect(cards[1]?.textContent).toContain('indoor');
    expect(cards[0]?.querySelector('a')?.getAttribute('href')).toBe(
      '#/activities/selected/outdoor',
    );
    // Named by the same words the table's caption would have said.
    const list = document.querySelector('.oyl-activity-cards');
    const label = document.getElementById(list?.getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe('Rides on this device, newest first');
  });

  it('is a table from the width the columns need', async () => {
    observerReporting(TABLE_FROM_REM * REM);
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    expect(queryAll(document.body, '.oyl-activity-cards')).toHaveLength(0);
    expect(rowText()).toHaveLength(2);
  });

  it('keeps delete confirmation working in the card list', async () => {
    observerReporting(300);
    const library = stubLibrary(OWNER, rides);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    expect(library.deleted).toStrictEqual([]);
    await activateWithKeyboard(buttonNamed('Confirm delete') as HTMLElement);
    await settle();
    expect(library.deleted).toStrictEqual(['outdoor']);
  });

  it('says there is nothing yet, in the card layout too', async () => {
    observerReporting(300);
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, [])} />);
    await settle();

    expect(document.body.textContent).toContain('Nothing recorded yet');
    expect(queryAll(document.body, '.oyl-activity-cards')).toHaveLength(0);
  });

  it('puts the table in a focusable region named by its caption', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    const region = document.querySelector('table')?.parentElement;
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('tabindex')).toBe('0');
    const caption = document.querySelector('caption');
    expect(region?.getAttribute('aria-labelledby')).toBe(caption?.id);
  });
});

describe('#670 — a selected ride', () => {
  function many(count: number): ActivitySummary[] {
    return Array.from({ length: count }, (_unused, index) =>
      summary(`ride-${String(index)}`, {
        name: `Ride number ${String(index)}`,
        startedAt: unixSeconds(1_700_000_000 - index * 86_400),
      }),
    );
  }

  it('is summarised from the page the list read, with no second read', async () => {
    const library = stubLibrary(OWNER, many(3));
    mounted = await mount(<ActivitiesView library={library} selected="ride-1" />);
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 1');
    expect(library.gets).toEqual([]);
    const open = queryAll<HTMLAnchorElement>(document.body, 'a').find(
      (anchor) => anchor.textContent === 'Open ride details',
    );
    expect(open?.getAttribute('href')).toBe('#/activities/ride-1');
  });

  it('is read on its own when it is outside the page, rather than called "not found"', async () => {
    // Ride fifty-five of sixty: past PAGE_SIZE, so the list never held it.
    const library = stubLibrary(OWNER, many(PAGE_SIZE + 10));
    mounted = await mount(<ActivitiesView library={library} selected="ride-55" />);
    await settle();
    await settle();
    expect(library.gets).toEqual(['ride-55']);
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 55');
  });

  it('says a ride this device does not hold is not found', async () => {
    const library = stubLibrary(OWNER, many(3));
    mounted = await mount(<ActivitiesView library={library} selected="somebody-elses" />);
    await settle();
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride not found');
    expect(document.body.textContent).toContain(
      'No ride with that address is stored on this device',
    );
  });

  it('marks the chosen ride in the list, in words a reader hears', async () => {
    const library = stubLibrary(OWNER, many(3));
    mounted = await mount(<ActivitiesView library={library} selected="ride-2" />);
    await settle();
    const current = queryAll(document.body, '[aria-current="true"]');
    expect(current.map((element) => element.getAttribute('data-oyl-select'))).toEqual(['ride-2']);
  });

  it('puts Start a ride before the list, so a long history does not bury it (#668)', async () => {
    const library = stubLibrary(OWNER, many(40));
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    const start = queryAll(document.body, 'a.oyl-button').find(
      (anchor) => anchor.textContent === 'Start a ride',
    );
    const firstRide = document.querySelector('[data-oyl-select]');
    expect(start).toBeDefined();
    expect(firstRide).not.toBeNull();
    expect(
      (start as Element).compareDocumentPosition(firstRide as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
