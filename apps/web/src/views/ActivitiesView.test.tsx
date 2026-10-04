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

import { PAGE_SIZE } from '../library/rows';
import { SELECTED_HEADING_ID } from '../shell/ListDetail';
import { stubLibrary } from '../library/testing';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  type Mounted,
} from '../testing/mount';
import { liveRegionsSaying, timesSaid } from '../testing/said-once';

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

  it('asks before deleting, and says the copy may be the only one', async () => {
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
    expect(asked?.textContent).toContain('cannot be undone');
    expect(asked?.textContent).toContain('only one that exists');
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
    await activateWithKeyboard(buttonNamed('Delete the ride') as HTMLElement);
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
    ).toStrictEqual(['1:02:05', '42.2 km', '212 W']);
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
    ).toStrictEqual(['1:02:05', '42.2 km']);
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

    // The selected ride's summary says so with an em dash, never
    // "undefined km" or "0.0 km" (#1053).
    const summaryFacts = document.getElementById(SELECTED_HEADING_ID)?.nextElementSibling;
    const facts = new Map(
      queryAll(summaryFacts as Element, ':scope > div').map((fact): [string, string] => [
        fact.querySelector('dt')?.textContent ?? '',
        fact.querySelector('dd')?.textContent ?? '',
      ]),
    );
    expect(facts.get('Distance')).toBe('—');
    expect(summaryFacts?.textContent ?? '').not.toMatch(/undefined|\b0(\.0)? (km|mi)\b/);
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
    ).toStrictEqual(['1:02:05', '42.2 km']);

    const summaryFacts = document.getElementById(SELECTED_HEADING_ID)?.nextElementSibling;
    const facts = new Map(
      queryAll(summaryFacts as Element, ':scope > div').map((fact): [string, string] => [
        fact.querySelector('dt')?.textContent ?? '',
        fact.querySelector('dd')?.textContent ?? '',
      ]),
    );
    expect(facts.get('Avg power')).toBe('—');
    expect(facts.get('Distance')).toBe('42.2 km');
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
    mounted = await mount(<ActivitiesView library={library} selected="one" />);
    await settle();
    const remove = queryAll(document.body, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Delete'),
    );
    await activateWithKeyboard(remove as HTMLElement);
    await settle();
    // #950: once on the screen, and said as the alert dialog's DESCRIPTION
    // rather than by a live region — focus moving into an `alertdialog` is
    // what announces it, and a live region too would say it twice.
    const text = 'Deleting a ride cannot be undone.';
    expect(timesSaid(document.body, text), `“${text}” is on the screen`).toBe(1);
    expect(liveRegionsSaying(document.body, text)).toBe(0);
    const dialog = document.querySelector('[role="alertdialog"]');
    const description = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toContain(text);
  });

  it('when the rides cannot be read', async () => {
    const library = {
      athleteId: OWNER,
      store: {
        listActivitySummaries: () => Promise.reject(new Error('QuotaExceededError')),
        deleteActivity: () => Promise.resolve(true),
        getActivity: () => Promise.resolve(undefined),
      },
    };
    mounted = await mount(<ActivitiesView library={library} selected="one" />);
    await settle();
    await settle();
    saidOnce('Could not read the rides on this device.');
  });
});
