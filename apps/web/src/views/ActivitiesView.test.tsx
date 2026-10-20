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
 * "the row is gone" is a persistence claim and docs/agents/quality-gate.md §5 names the failure
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
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubActivity, stubDetail, stubLap } from '../detail/testing';
import { PAGE_SIZE } from '../library/rows';
import { SELECTED_HEADING_ID } from '../shell/ListDetail';
import { emptyLibraryStore, stubLibrary } from '../library/testing';
import type { LibraryPort } from '../library/store-port';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  type Mounted,
} from '../testing/mount';
import { liveRegionsSaying, timesSaid } from '../testing/said-once';

import { scriptedInstance } from '../instance/testing';
import {
  ActivitiesView,
  ACTIVITIES_KEPT_VISIBLE,
  DELETE_EXPLAINED_TEXT,
  DELETE_FAILED_TEXT,
  deleteRideText,
} from './ActivitiesView';
import { whereRidesAreText } from './where-rides-are';

const OWNER = athleteId('athlete-a');

/**
 * Settles until `check` holds — for the real-store tests, whose writes and
 * re-reads take as many turns as IndexedDB needs on a loaded machine.
 */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (check()) return;
    await settle();
  }
  throw new Error(`never: ${what}`);
}

/** The library's clock in the real-store tests — #1431. */
const NOW = unixSeconds(1_800_000_000);

/**
 * The library over the real store. Every call through `write`, which reuses
 * the open handle: `harness.read` discards every handle and opens a fresh one —
 * that is the whole point of it — so a live component calling it on each
 * render closes the database under its own next call. The fresh connection
 * belongs at the end, where the assertion is, not in the middle of the view's
 * own reads.
 */
function realLibrary(open: StoreHarness): LibraryPort {
  return {
    athleteId: ATHLETE_A,
    now: () => NOW,
    store: {
      listActivitySummaries: (owner: AthleteId) =>
        open.write(async (store) => store.listActivitySummaries(owner)),
      getActivity: (owner: AthleteId, id: ActivityId) =>
        open.write(async (store) => store.getActivity(owner, id)),
      moveActivityToRecentlyDeleted: (owner, id, at) =>
        open.write(async (store) => store.moveActivityToRecentlyDeleted(owner, id, at)),
      listRecentlyDeleted: (owner, now) =>
        open.write(async (store) => store.listRecentlyDeleted(owner, now)),
      restoreRecentlyDeleted: (owner, id, now) =>
        open.write(async (store) => store.restoreRecentlyDeleted(owner, id, now)),
      deleteRecentlyDeletedForGood: (owner, id) =>
        open.write(async (store) => store.deleteRecentlyDeletedForGood(owner, id)),
      emptyRecentlyDeleted: (owner) =>
        open.write(async (store) => store.emptyRecentlyDeleted(owner)),
      purgeRecentlyDeleted: (owner, now) =>
        open.write(async (store) => store.purgeRecentlyDeleted(owner, now)),
    },
  };
}

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** Each ride card's text, in the order the list draws them. */
function rowText(): string[] {
  return queryAll(document.body, '.oyl-activity-cards > li').map((card) => card.textContent ?? '');
}

/** The words the card list is labelled by: the order it is in. */
function listCaption(): string | undefined {
  const list = document.querySelector('.oyl-activity-cards');
  return (
    document.getElementById(list?.getAttribute('aria-labelledby') ?? '')?.textContent ?? undefined
  );
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

  it('asks before deleting, and says where the ride goes and for how long — #1431', async () => {
    const library = stubLibrary(OWNER, [summary('a', { name: 'Tuesday hills' })]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    const remove = buttonNamed('Delete');
    expect(remove).toBeDefined();
    await activateWithKeyboard(remove as HTMLElement);
    await settle();

    // Asked, not deleted — and asked in a dialog (#950) that names the ride.
    expect(library.deleted).toStrictEqual([]);
    const asked = document.querySelector('[role="alertdialog"]');
    expect(asked?.textContent).toContain('Delete “Tuesday hills”?');
    expect(asked?.textContent).toContain(DELETE_EXPLAINED_TEXT);
    expect(asked?.textContent).not.toContain('cannot be undone');
    expect(buttonNamed('Delete the ride')).toBeDefined();
    // Its first focus is the way out, so a second Enter deletes nothing.
    expect(document.activeElement?.textContent).toBe('Keep the ride');
  });

  it('keeps the ride when the rider says so, and gives focus back to its Delete — #950', async () => {
    const library = stubLibrary(OWNER, [summary('a', { name: 'Tuesday hills' })]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    const remove = buttonNamed('Delete') as HTMLElement;
    await activateWithKeyboard(remove);
    await settle();
    await activateWithKeyboard(buttonNamed('Keep the ride') as HTMLElement);
    await settle();

    expect(library.deleted).toStrictEqual([]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(remove);
  });

  it('puts focus on the sort control once the ride and its Delete are gone — #950', async () => {
    const library = stubLibrary(OWNER, [
      summary('a', { name: 'Tuesday hills' }),
      summary('b', { name: 'Sunday long' }),
    ]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
    await settle();

    expect(library.deleted).toHaveLength(1);
    expect(document.activeElement).toBe(sortControl());
  });

  it('keeps the dialog open and busy until the delete settles, and says so in it when it fails — #959', async () => {
    const stub = stubLibrary(OWNER, [
      summary('a', { name: 'Tuesday hills' }),
      summary('b', { name: 'Sunday long' }),
    ]);
    let refuse: (error: Error) => void = () => undefined;
    const moveActivityToRecentlyDeleted = vi.fn(
      async (): Promise<boolean> =>
        new Promise<boolean>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const library = { ...stub, store: { ...stub.store, moveActivityToRecentlyDeleted } };
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    const confirm = buttonNamed('Delete the ride') as HTMLElement;
    await activateWithKeyboard(confirm);
    await settle();

    // Under way: still open, saying it is busy, both answers unavailable, and
    // neither a second press nor *Keep the ride* does anything yet.
    const dialog = (): HTMLElement | null => document.querySelector('[role="alertdialog"]');
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-busy')).toBe('true');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(buttonNamed('Keep the ride')?.getAttribute('aria-disabled')).toBe('true');
    await activateWithKeyboard(confirm);
    await activateWithKeyboard(buttonNamed('Keep the ride') as HTMLElement);
    await settle();
    expect(dialog()).not.toBeNull();
    expect(moveActivityToRecentlyDeleted).toHaveBeenCalledTimes(1);

    refuse(new Error('QuotaExceededError'));
    await settle();

    // Refused: the dialog stays, says why in an alert inside it, and focus
    // has not left it — nor gone to the sort control as if the ride were gone.
    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-busy')).toBeNull();
    const alert = dialog()?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(DELETE_FAILED_TEXT);
    expect(alert?.textContent).not.toContain('QuotaExceededError');
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(sortControl());
    expect(confirm.getAttribute('aria-disabled')).toBeNull();

    // The ride is still in the list behind it, and the rider can still keep it.
    await activateWithKeyboard(buttonNamed('Keep the ride') as HTMLElement);
    await settle();
    expect(dialog()).toBeNull();
    expect(rowText().some((text) => text.includes('Tuesday hills'))).toBe(true);
  });

  it('closes, and only then moves focus to the sort control, once a slow delete works — #959', async () => {
    const stub = stubLibrary(OWNER, [
      summary('a', { name: 'Tuesday hills' }),
      summary('b', { name: 'Sunday long' }),
    ]);
    let done: (deleted: boolean) => void = () => undefined;
    const moveActivityToRecentlyDeleted = vi.fn(
      async (): Promise<boolean> =>
        new Promise<boolean>((resolve) => {
          done = resolve;
        }),
    );
    const library = { ...stub, store: { ...stub.store, moveActivityToRecentlyDeleted } };
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).not.toBe(sortControl());

    done(true);
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(sortControl());
  });

  it('deletes only on the second press, and the ride is in Recently deleted on a fresh connection — #1431', async () => {
    // The real store, read back through a connection that did not write it —
    // the #28 primitive. A stub could not tell "removed" from "removed from the
    // copy in memory".
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const open = harness;

    // Through `write` — `realLibrary` says why.
    const library = realLibrary(open);

    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    expect(rowText()).toHaveLength(1);

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
    await settle();

    // Unmounted first, so the view cannot re-read through the handle the fresh
    // connection below is about to discard.
    mounted.unmount();
    mounted = undefined;

    const left = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(left).toHaveLength(0);
    expect(await open.read(async (store) => store.getActivity(ATHLETE_A, ride.id))).toBeUndefined();
    // #1431: not destroyed — held, stamped with the library's clock, until it
    // is brought back, deleted for good, or its thirty days run out.
    const held = await open.read(async (store) => store.listRecentlyDeleted(ATHLETE_A, NOW));
    expect(held.map((each) => [each.id, each.deletedAt])).toStrictEqual([[ride.id, NOW]]);
  });

  it('brings a deleted ride back from Recently deleted, read on a fresh connection — #1431', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A, { name: 'Tuesday hills' });
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30 })),
    );
    const open = harness;
    mounted = await mount(<ActivitiesView library={realLibrary(open)} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
    await until(
      () => document.querySelector('.oyl-recently-deleted') !== null,
      'Recently deleted is drawn',
    );
    expect(rowText()).toHaveLength(0);
    const section = document.querySelector('.oyl-recently-deleted');
    expect(section?.textContent).toContain('Tuesday hills');
    expect(section?.textContent).toContain('Removed for good in 30 days');

    await activateWithKeyboard(buttonNamed('Restore') as HTMLElement);
    await until(() => rowText().length === 1, 'the ride is back in the list');
    expect(rowText().some((text) => text.includes('Tuesday hills'))).toBe(true);
    expect(document.body.textContent).toContain('“Tuesday hills” is back in your activities.');
    expect(document.activeElement?.textContent).toBe('Recently deleted');
    mounted.unmount();
    mounted = undefined;

    expect(
      (await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).map((r) => r.id),
    ).toStrictEqual([ride.id]);
    expect(await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id))).toBeDefined();
    expect(
      await open.read(async (store) => store.listRecentlyDeleted(ATHLETE_A, NOW)),
    ).toStrictEqual([]);
  });

  it('deletes for good only after asking, and then nothing of the ride is left — #1431', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A, { name: 'Tuesday hills' });
    await harness.write(async (store) =>
      store.putStreamSet(streamSetFor(ride, { sampleCount: 30 })),
    );
    await harness.write(async (store) =>
      store.moveActivityToRecentlyDeleted(ATHLETE_A, ride.id, NOW),
    );
    const open = harness;
    mounted = await mount(<ActivitiesView library={realLibrary(open)} />);
    await until(() => buttonNamed('Delete for good') !== undefined, 'Recently deleted is drawn');

    await activateWithKeyboard(buttonNamed('Delete for good') as HTMLElement);
    await settle();
    const asked = document.querySelector('[role="alertdialog"]');
    expect(asked?.textContent).toContain('Delete “Tuesday hills” for good?');
    expect(asked?.textContent).toContain('cannot be brought back');
    // Asked, not done: first focus is the way out.
    expect(document.activeElement?.textContent).toBe('Keep it in Recently deleted');
    expect(
      await open.write(async (store) => store.listRecentlyDeleted(ATHLETE_A, NOW)),
    ).toHaveLength(1);

    const confirm = queryAll<HTMLButtonElement>(asked ?? document.body, 'button').find(
      (button) => button.textContent === 'Delete for good',
    );
    await activateWithKeyboard(confirm as HTMLElement);
    await until(
      () => (document.body.textContent ?? '').includes('“Tuesday hills” was deleted for good.'),
      'the delete is said',
    );
    mounted.unmount();
    mounted = undefined;

    expect(
      await open.read(async (store) => store.listRecentlyDeleted(ATHLETE_A, NOW)),
    ).toStrictEqual([]);
    expect(
      await open.read(async (store) => store.getStreamSet(ATHLETE_A, ride.id)),
    ).toBeUndefined();
    expect(
      await open.read(async (store) => store.restoreRecentlyDeleted(ATHLETE_A, ride.id, NOW)),
    ).toBe('missing');
  });

  it('removes for good what has been in Recently deleted 30 days, each time it is shown — #1431', async () => {
    const library = {
      ...stubLibrary(OWNER, [summary('old', { name: 'Old ride' })]),
      now: () => NOW,
    };
    await library.store.moveActivityToRecentlyDeleted(
      OWNER,
      activityId('old'),
      unixSeconds(NOW - 30 * 24 * 60 * 60),
    );
    expect(library.bin).toHaveLength(1);
    mounted = await mount(<ActivitiesView library={library} />);
    await until(() => library.bin.length === 0, 'the expired ride is purged');
    expect(document.querySelector('.oyl-recently-deleted')).toBeNull();
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

    const library = realLibrary(open);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
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
      store: emptyLibraryStore({
        listActivitySummaries: () => Promise.reject(new Error('QuotaExceededError')),
      }),
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
    expect(listCaption()).toBe('Rides on this device, shortest first');
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
 * A `ResizeObserver` that reports each width in turn when asked to observe —
 * a browser laying the list out. Since #1041 nothing should be listening.
 */
function observerReporting(widths: readonly number[]): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe(): void {
        for (const width of widths) {
          this.#callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], this);
        }
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

describe('#1041 — every ride a card, at every width', () => {
  const rides = [
    summary('outdoor', {
      name: 'Tuesday hills',
      averagePower: watts(212),
      startedAt: unixSeconds(1_700_000_100),
    }),
    summary('indoor', { name: 'Zwift hour', hasPosition: false }),
  ];

  it('draws one card per ride, with its name, date and facts as readings, and no table', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelector('[role="region"]')).toBeNull();
    const cards = queryAll(document.body, '.oyl-activity-cards > li');
    expect(cards).toHaveLength(2);
    const first = cards[0];
    const text = first?.textContent ?? '';
    expect(text).toContain('Tuesday hills');
    expect(first?.querySelector('.oyl-activity-card__date')?.textContent).toBe(
      '14 Nov 2023, 22:15',
    );
    // Each fact is a `Reading`: its digits and its unit, at the reading size.
    expect(
      queryAll(first as Element, '.oyl-reading').map((reading) => reading.textContent),
    ).toStrictEqual(['1:00:00', '42.2 km', '212 W']);
    expect(cards[1]?.textContent).toContain('indoor');
    expect(first?.querySelector('a')?.getAttribute('href')).toBe('#/activities/selected/outdoor');
    expect(listCaption()).toBe('Rides on this device, newest first');
  });

  it('invents nothing for a ride with no position and no power: no power reading, no shape', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    const indoor = queryAll(document.body, '.oyl-activity-cards > li')[1];
    const text = indoor?.textContent ?? '';
    expect(text).toContain('Zwift hour');
    expect(text).not.toContain('Avg power');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b0 W\b/);
    expect(
      queryAll(indoor as Element, '.oyl-reading').map((reading) => reading.textContent),
    ).toStrictEqual(['1:00:00', '42.2 km']);
    // No card draws a shape: an `ActivitySummary` carries no track, no power
    // and no altitude, and a stand-in would be a picture of another ride.
    expect(
      queryAll(document.body, '.oyl-activity-cards svg, .oyl-activity-cards img'),
    ).toHaveLength(0);
  });

  it('invents no distance for a ride that stored none: no position, no power, no speed', async () => {
    // A ride recorded with no speed channel stores `metres(0)`
    // (`recording/finish.ts` §`distanceOf`) — no distance known, not 0.0 km.
    const nothing = summary('no-speed', {
      name: 'Trainer, power meter off',
      hasPosition: false,
      distance: metres(0),
      elapsedTime: seconds(3_600),
    });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [nothing])} selected="no-speed" />,
    );
    await settle();

    const card = queryAll(document.body, '.oyl-activity-cards > li')[0];
    const text = card?.textContent ?? '';
    expect(text).toContain('Trainer, power meter off');
    expect(text).not.toContain('Distance');
    expect(text).not.toContain('Avg power');
    expect(text).not.toMatch(/\b0(\.0)? (km|mi)\b/);
    expect(
      queryAll(card as Element, '.oyl-reading').map((reading) => reading.textContent),
    ).toStrictEqual(['1:00:00']);

    // #1439: the chosen ride's facts are its page's own, in the pane — no
    // Distance row for 0 m there (`ActivityDetailView.test.tsx` §"#1070").
    expect(document.getElementById(SELECTED_HEADING_ID)?.textContent).toBe(
      'Trainer, power meter off',
    );
  });

  it('invents no 0 W for a ride whose power readings were all 0 — #1054', async () => {
    // A ride recorded with power readings that were every one 0 stores an
    // average of 0 (`recording/finish.ts` §`averagePowerOf`, asserted in
    // `finish.test.ts` §"#1054"). That says nothing was measured, and "0 W"
    // drawn large reads as a measurement: no reading on the card, and an em
    // dash in the selected ride's summary, as distance has since #1041.
    const zero = summary('zero-power', {
      name: 'Ride 2026-09-25',
      hasPosition: false,
      averagePower: watts(0),
    });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [zero])} selected="zero-power" />,
    );
    await settle();

    const card = queryAll(document.body, '.oyl-activity-cards > li')[0];
    const text = card?.textContent ?? '';
    expect(text).toContain('Ride 2026-09-25');
    expect(text).not.toContain('Avg power');
    expect(text).not.toMatch(/\b0 W\b/);
    expect(
      queryAll(card as Element, '.oyl-reading').map((reading) => reading.textContent),
    ).toStrictEqual(['1:00:00', '42.2 km']);

    // #1439: the chosen ride's facts are its page's own, in the pane
    // (`ActivityDetailView.test.tsx` §"#1054").
    expect(document.getElementById(SELECTED_HEADING_ID)?.textContent).toBe('Ride 2026-09-25');
  });

  it('issues no read per card: one list read for fifty cards, and no ride read alone', async () => {
    const fifty = Array.from({ length: PAGE_SIZE }, (_, index) =>
      summary(`ride-${String(index)}`, { startedAt: unixSeconds(1_700_000_000 + index) }),
    );
    const library = stubLibrary(OWNER, fifty);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(queryAll(document.body, '.oyl-activity-cards > li')).toHaveLength(PAGE_SIZE);
    expect(library.reads).toHaveLength(1);
    expect(library.gets).toStrictEqual([]);
  });

  it('is cards whatever width it is laid out at — nothing measures it', async () => {
    // The table #660 drew from 32 rem is gone: a wide list, a narrow one and a
    // hidden one are all cards.
    observerReporting([2_000, 300, 0]);
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, rides)} />);
    await settle();

    expect(document.querySelector('table')).toBeNull();
    expect(queryAll(document.body, '.oyl-activity-cards > li')).toHaveLength(2);
    expect(document.querySelector('.oyl-library')?.hasAttribute('data-layout')).toBe(false);
  });

  it('keeps delete confirmation working on a card', async () => {
    const library = stubLibrary(OWNER, rides);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    expect(library.deleted).toStrictEqual([]);
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
    await settle();
    expect(library.deleted).toStrictEqual(['outdoor']);
  });

  it('says there is nothing yet, and draws no card', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, [])} />);
    await settle();

    expect(document.body.textContent).toContain('Nothing recorded yet');
    expect(queryAll(document.body, '.oyl-activity-cards')).toHaveLength(0);
  });

  it('keeps the list a card list when a ride is chosen and put back — #670', async () => {
    const library = stubLibrary(OWNER, rides);
    mounted = await mount(<ActivitiesView library={library} selected="outdoor" />);
    await settle();
    await mounted.rerender(<ActivitiesView library={library} />);
    await settle();

    expect(queryAll(document.body, '.oyl-activity-cards > li')).toHaveLength(2);
    expect(document.querySelector('table')).toBeNull();
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

  it('is headed from the page the list read, with no second read of the list', async () => {
    const library = stubLibrary(OWNER, many(3));
    mounted = await mount(<ActivitiesView library={library} selected="ride-1" />);
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 1');
    expect(library.gets).toEqual([]);
  });

  it('IS the ride’s page, read from the store, not a summary one tap from it — #1439', async () => {
    // It was a summary of the row whose one action was *Open ride details*:
    // two pages, two taps, to see a ride.
    const ride = stubActivity({ id: activityId('ride-1'), name: 'Ride number 1' });
    const detail = stubDetail(OWNER, {
      activity: ride,
      channels: { power: Array.from({ length: 120 }, () => watts(200)) },
      laps: [stubLap(1)],
    });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, many(3))} selected="ride-1" detail={detail} />,
    );
    await settle();
    await settle();
    const pane = document.querySelector('[data-oyl-pane="detail"]') as Element;
    expect(
      queryAll<HTMLAnchorElement>(document.body, 'a').map((anchor) => anchor.textContent),
    ).not.toContain('Open ride details');
    // The page's own read, its headline numbers, its chart and its laps.
    expect(detail.summaryReads.length).toBeGreaterThan(0);
    expect(queryAll(pane, 'h3').map((heading) => heading.textContent)).toEqual(
      expect.arrayContaining(['Traces', 'Laps']),
    );
    expect(pane.querySelector('.oyl-ride-summary')).not.toBeNull();
    // Named once: the pane's heading, not the page's own as well.
    expect(queryAll(pane, 'h2').map((heading) => heading.textContent)).toEqual(['Ride number 1']);
    // And no second way back beside the pane's own.
    expect(pane.textContent).not.toContain('All rides on this device');
  });

  it('reads the next ride’s own traces when the choice changes, not the first one’s — #1439', async () => {
    // The pane's page held the traces it had read by channel and only loaded
    // channels it lacked, so ride B opened over ride A's chart.
    const rideA = stubActivity({ id: activityId('ride-0'), name: 'Ride number 0' });
    const rideB = stubActivity({ id: activityId('ride-1'), name: 'Ride number 1' });
    const stubA = stubDetail(OWNER, {
      activity: rideA,
      channels: { power: Array.from({ length: 120 }, () => watts(100)) },
      laps: [],
    });
    const stubB = stubDetail(OWNER, {
      activity: rideB,
      channels: { power: Array.from({ length: 120 }, () => watts(300)) },
      laps: [],
    });
    const which = (id: string): typeof stubA => (id === 'ride-1' ? stubB : stubA);
    const both: typeof stubA = {
      ...stubA,
      store: {
        ...stubA.store,
        getStreamSetSummary: (owner, id) => which(id).store.getStreamSetSummary(owner, id),
        getStreamChannel: (owner, id, channel) =>
          which(id).store.getStreamChannel(owner, id, channel),
        getActivity: (owner, id) => which(id).store.getActivity(owner, id),
        listLaps: (owner, id) => which(id).store.listLaps(owner, id),
      },
    };
    const library = stubLibrary(OWNER, many(3));
    mounted = await mount(<ActivitiesView library={library} selected="ride-0" detail={both} />);
    await settle();
    await settle();
    expect(stubB.channelReads).toEqual([]);
    await mounted.rerender(<ActivitiesView library={library} selected="ride-1" detail={both} />);
    await settle();
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 1');
    expect(stubB.channelReads).toContain('power');
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
    mounted = await mount(<ActivitiesView library={library} selected="nobody-knows" />);
    await settle();
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride not found');
    expect(document.body.textContent).toContain(
      'No ride with that address is stored on this device',
    );
  });

  it('says another athlete’s ride is not found, even though this device holds it', async () => {
    // #670's review (N3): an id that exists for nobody proves nothing about
    // scoping. This one is on the device, under athlete B.
    const library = stubLibrary(OWNER, [
      ...many(3),
      summary('somebody-elses', { athleteId: athleteId('athlete-b'), name: 'Their ride' }),
    ]);
    mounted = await mount(<ActivitiesView library={library} selected="somebody-elses" />);
    await settle();
    await settle();
    expect(library.gets).toEqual(['somebody-elses']);
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride not found');
    expect(document.body.textContent).not.toContain('Their ride');
  });

  it('reads a ride outside the page once, however often the list is re-sorted', async () => {
    // #670's review (N2): the read returns the original file bytes, and a
    // sort change used to repeat it every time.
    // Older rides are shorter too, so every order below keeps ride 55 off
    // the page: each sort re-reads the page and must not re-read the ride.
    const stub = stubLibrary(
      OWNER,
      many(PAGE_SIZE + 10).map((ride, index) => ({ ...ride, distance: metres(100_000 - index) })),
    );
    // A page read that takes a turn of the event loop, as IndexedDB's does, so
    // the screen really passes through "loading" between two sorts rather
    // than having React batch it away.
    const library = {
      ...stub,
      store: {
        ...stub.store,
        listActivitySummaries: (
          ...args: Parameters<typeof stub.store.listActivitySummaries>
        ): ReturnType<typeof stub.store.listActivitySummaries> =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(stub.store.listActivitySummaries(...args));
            }, 0);
          }),
      },
    };
    mounted = await mount(<ActivitiesView library={library} selected="ride-55" />);
    await settle();
    await settle();
    expect(stub.gets).toEqual(['ride-55']);
    for (const order of ['distance:descending', 'startedAt:descending', 'distance:descending']) {
      await chooseOption(sortControl(), order);
      await settle();
      await settle();
    }
    expect(stub.reads.length).toBeGreaterThanOrEqual(4);
    expect(stub.gets).toEqual(['ride-55']);
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 55');
  });

  it('reads the ride again when the athlete changes, rather than keeping the first one’s', async () => {
    // #670's second review: the read was keyed on the reload count and the id
    // alone, so the same id under a different athlete kept the first ride.
    const other = athleteId('athlete-b');
    const theirs = many(PAGE_SIZE + 10).map((ride) => ({
      ...ride,
      athleteId: other,
      name: ride.name.replace('Ride number', 'Their ride'),
    }));
    const first = stubLibrary(OWNER, many(PAGE_SIZE + 10));
    const second = stubLibrary(other, theirs);
    mounted = await mount(<ActivitiesView library={first} selected="ride-55" />);
    await settle();
    await settle();
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Ride number 55');
    await mounted.rerender(<ActivitiesView library={second} selected="ride-55" />);
    await settle();
    await settle();
    expect(second.gets).toEqual(['ride-55']);
    expect(document.getElementById('oyl-selected-heading')?.textContent).toBe('Their ride 55');
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

/**
 * #670's review (B1): a message rendered twice is invisible to `toContain`.
 * This screen never had the Routes screen's duplicate; these keep it so.
 */
describe('each message is said once, in one live region', () => {
  function saidOnce(text: string): void {
    expect(timesSaid(document.body, text), `“${text}” is on the screen`).toBe(1);
    expect(liveRegionsSaying(document.body, text), `“${text}” is in live regions`).toBe(1);
  }

  it('when a delete asks to be confirmed', async () => {
    const library = stubLibrary(OWNER, [summary('one', { name: 'Only ride' })]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();
    const remove = queryAll(document.body, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Delete'),
    );
    await activateWithKeyboard(remove as HTMLElement);
    await settle();
    // #950: once on the screen, and said as the alert dialog's DESCRIPTION
    // rather than by a live region — focus moving into an `alertdialog` is
    // what announces it, and a live region too would say it twice.
    const text = DELETE_EXPLAINED_TEXT;
    expect(timesSaid(document.body, text), `“${text}” is on the screen`).toBe(1);
    expect(liveRegionsSaying(document.body, text)).toBe(0);
    const dialog = document.querySelector('[role="alertdialog"]');
    const description = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toContain(text);
  });

  it('when the rides cannot be read', async () => {
    const library = {
      athleteId: OWNER,
      store: emptyLibraryStore({
        listActivitySummaries: () => Promise.reject(new Error('QuotaExceededError')),
      }),
    };
    mounted = await mount(<ActivitiesView library={library} selected="one" />);
    await settle();
    await settle();
    saidOnce('Could not read the rides on this device.');
  });
});

describe('#1438 — the footer says where the rides are, per platform and per instance', () => {
  /** The footer's sentence, as the screen draws it. */
  function footer(): string {
    const said = queryAll(document.body, 'p.oyl-muted')
      .map((p) => p.textContent ?? '')
      .filter((text) => text.startsWith('Rides are stored on this device'));
    expect(said).toHaveLength(1);
    return said[0]!;
  }

  const BROWSER_ALONE =
    'Rides are stored on this device. Clearing this browser’s site data ' +
    'deletes them from this device — export anything you want to keep.';
  const BROWSER_WITH_INSTANCE =
    'Rides are stored on this device, and a ride you sync is also kept on your instance. ' +
    'Clearing this browser’s site data deletes them from this device — export anything you ' +
    'want to keep.';
  const APP_ALONE =
    'Rides are stored on this device. Uninstalling the app, or clearing its storage in ' +
    'Android’s settings, deletes them from this device — export anything you want to keep.';
  const APP_WITH_INSTANCE =
    'Rides are stored on this device, and a ride you sync is also kept on your instance. ' +
    'Uninstalling the app, or clearing its storage in Android’s settings, deletes them from ' +
    'this device — export anything you want to keep.';

  it('in a browser with no instance: here, and the browser’s site data', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, [])} />);
    await settle();
    expect(footer()).toBe(BROWSER_ALONE);
  });

  it('in a browser connected to an instance: a synced ride is kept there too', async () => {
    const instance = scriptedInstance({ connected: true });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [])} instance={instance.port} />,
    );
    await settle();
    expect(footer()).toBe(BROWSER_WITH_INSTANCE);
  });

  it('in a browser with an instance port but no connection: as with none', async () => {
    const instance = scriptedInstance({ connected: false });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [])} instance={instance.port} />,
    );
    await settle();
    expect(footer()).toBe(BROWSER_ALONE);
  });

  it('in the app with no instance: no browser, and what deletes them in Android', async () => {
    mounted = await mount(<ActivitiesView library={stubLibrary(OWNER, [])} nativeShell />);
    await settle();
    expect(footer()).toBe(APP_ALONE);
    expect(footer()).not.toContain('browser');
  });

  it('in the app connected to an instance', async () => {
    const instance = scriptedInstance({ connected: true });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [])} nativeShell instance={instance.port} />,
    );
    await settle();
    expect(footer()).toBe(APP_WITH_INSTANCE);
  });

  it('counts a signed-out instance as one: the rides synced before are still there', async () => {
    const instance = scriptedInstance({
      connected: true,
      state: { kind: 'signed-out', origin: 'https://ride.example' },
    });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [])} instance={instance.port} />,
    );
    await settle();
    expect(footer()).toBe(BROWSER_WITH_INSTANCE);
  });

  it('never says "nowhere else": a rider who synced then disconnected still has a copy on the instance', async () => {
    const instance = scriptedInstance({ connected: false });
    mounted = await mount(
      <ActivitiesView library={stubLibrary(OWNER, [])} instance={instance.port} />,
    );
    await settle();
    expect(footer()).not.toContain('nowhere else');
    for (const native of [false, true]) {
      for (const known of ['none', 'connected', 'unknown'] as const) {
        expect(whereRidesAreText(native, known)).not.toContain('nowhere else');
      }
    }
  });

  it('claims neither way until the instance has answered', () => {
    expect(whereRidesAreText(false, 'unknown')).toBe(
      'Rides are stored on this device. Clearing this browser’s site data deletes them from ' +
        'this device — export anything you want to keep.',
    );
  });

  it('never says there is no account or no server, and keeps the kept-visible words in each', () => {
    for (const native of [false, true]) {
      for (const known of ['none', 'connected', 'unknown'] as const) {
        const text = whereRidesAreText(native, known);
        expect(text).not.toMatch(/no account|no server/);
        for (const kept of ACTIVITIES_KEPT_VISIBLE) expect(text).toContain(kept);
      }
    }
  });
});

describe('#1450 — the delete dialog says where else the ride is, per platform and per instance', () => {
  // #1431's sentence on its own, and with #1450's instance sentence after it.
  const ALONE =
    'It moves to Recently deleted, at the foot of this list, where you can bring it back for ' +
    '30 days. After that it is removed from this device for good.';
  const WITH_INSTANCE =
    `${ALONE} A ride you synced is deleted from your instance at the next sync, and bringing ` +
    'it back restores it on this device only.';

  /** Opens the confirmation for the one ride, and reads its sentence. */
  async function dialogSays(props: {
    readonly nativeShell?: boolean;
    readonly instance?: ReturnType<typeof scriptedInstance>;
  }): Promise<string> {
    mounted = await mount(
      <ActivitiesView
        library={stubLibrary(OWNER, [summary('a', { name: 'Tuesday hills' })])}
        nativeShell={props.nativeShell}
        instance={props.instance?.port}
      />,
    );
    await settle();
    await activateWithKeyboard(buttonNamed('Delete') as HTMLElement);
    await settle();
    const said = queryAll(document.body, '[role="alertdialog"] p')
      .map((p) => p.textContent ?? '')
      .filter((text) => text.startsWith('It moves to Recently deleted'));
    expect(said).toHaveLength(1);
    return said[0]!;
  }

  for (const nativeShell of [false, true]) {
    const where = nativeShell ? 'in the app' : 'in a browser';

    it(`${where} with no instance: where the ride goes, and nothing about an instance`, async () => {
      expect(await dialogSays({ nativeShell })).toBe(ALONE);
    });

    it(`${where} with an instance port but no connection: as with none`, async () => {
      const instance = scriptedInstance({ connected: false });
      expect(await dialogSays({ nativeShell, instance })).toBe(ALONE);
    });

    it(`${where} connected to an instance: a synced ride goes from there too, and comes back here only`, async () => {
      const instance = scriptedInstance({ connected: true });
      expect(await dialogSays({ nativeShell, instance })).toBe(WITH_INSTANCE);
    });

    it(`${where} signed out of an instance: counted as one`, async () => {
      const instance = scriptedInstance({
        connected: true,
        state: { kind: 'signed-out', origin: 'https://ride.example' },
      });
      expect(await dialogSays({ nativeShell, instance })).toBe(WITH_INSTANCE);
    });
  }

  it('claims nothing about an instance until the port has answered', () => {
    expect(deleteRideText('unknown')).toBe(ALONE);
  });

  it('never says there is no server, no backup, or no copy anywhere else', () => {
    for (const known of ['none', 'connected', 'unknown'] as const) {
      expect(deleteRideText(known)).not.toMatch(/no server|no backup|nowhere else|anywhere else/);
      // #1431: a delete can be undone for 30 days, so the dialog never says otherwise.
      expect(deleteRideText(known)).not.toContain('cannot be undone');
    }
  });
});

describe('#1437 — History leads with moving time, and says which', () => {
  /** The facts of the first card: each term with what it says. */
  function cardFacts(): string[] {
    const card = document.querySelector('.oyl-activity-cards > li');
    return queryAll(card as Element, '.oyl-activity-card__facts > div').map(
      (fact) =>
        `${fact.querySelector('dt')?.textContent ?? ''}: ${fact.querySelector('dd')?.textContent ?? ''}`,
    );
  }

  it('leads a card with the moving time, named so, and the elapsed time after it', async () => {
    // The ride the issue saw: it moved for 0:10 of a recording left running for 10:31:26.
    const library = stubLibrary(OWNER, [
      summary('left-running', { movingTime: seconds(10), elapsedTime: seconds(37_886) }),
    ]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(cardFacts()[0]).toBe('Moving time: 0:10 of 10:31:26 elapsed');
    const card = document.querySelector('.oyl-activity-cards > li');
    expect(queryAll(card as Element, '.oyl-reading').map((reading) => reading.textContent)[0]).toBe(
      '0:10',
    );
    expect(card?.textContent).not.toContain('Duration');
  });

  it('says the time once when the ride never paused', async () => {
    const library = stubLibrary(OWNER, [
      summary('never-paused', { movingTime: seconds(3_725), elapsedTime: seconds(3_725) }),
    ]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(cardFacts()[0]).toBe('Moving time: 1:02:05');
  });

  it('shows the moving time alone when it is longer than the elapsed time — never “of … elapsed”', async () => {
    // No clock records this, but an import or an old save can hold it, and
    // "1:00 of 0:50 elapsed" would say something false about the ride.
    const library = stubLibrary(OWNER, [
      summary('moving-over-elapsed', { movingTime: seconds(60), elapsedTime: seconds(50) }),
    ]);
    mounted = await mount(<ActivitiesView library={library} />);
    await settle();

    expect(cardFacts()[0]).toBe('Moving time: 1:00');
  });

  it('names both in the selected ride’s summary, moving first', async () => {
    const library = stubLibrary(OWNER, [
      summary('left-running', { movingTime: seconds(10), elapsedTime: seconds(37_886) }),
    ]);
    // #1439: the pane is the ride's page, which reads the ride itself.
    const detail = stubDetail(OWNER, {
      activity: stubActivity({
        id: activityId('left-running'),
        movingTime: seconds(10),
        elapsedTime: seconds(37_886),
      }),
      channels: {},
      laps: [],
    });
    mounted = await mount(
      <ActivitiesView library={library} selected="left-running" detail={detail} />,
    );
    await settle();
    await settle();

    const pane = document.getElementById(SELECTED_HEADING_ID)?.parentElement;
    const terms = queryAll(pane as Element, 'dt').map((term) => term.textContent);
    const values = queryAll(pane as Element, 'dd').map((value) => value.textContent);
    expect(terms.slice(1, 3)).toStrictEqual(['Moving time', 'Elapsed time']);
    expect(values.slice(1, 3)).toStrictEqual(['0:10', '10:31:26']);
  });
});
