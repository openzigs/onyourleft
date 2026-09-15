// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A loop survives being saved — #296's third criterion, against the **real**
 * local store.
 *
 * ## Why this is a test of its own rather than a line in `import-form.test.ts`
 *
 * Because the criterion says so, and it says so for a reason CLAUDE.md §5 names
 * as the dominant defect shape in this program's persistence work: *a write that
 * reports success while the read cannot see it*, from a wrong storage, a wrong
 * layer, a wrong time or a wrong harness. The fourth is the one that applies
 * here — asserting `profile.loop` on the object handed to `putRoute` is
 * asserting that an object literal has the field it was built with, which is
 * true whatever the store does with it.
 *
 * So every claim below reads back through `@onyourleft/store/testing`, whose
 * `read` discards every open handle before it opens another. A fresh IndexedDB
 * connection sees the flag, or this goes red.
 *
 * ⚠️ **And both directions are asserted.** A route imported without the box has
 * to come back `false` — otherwise the same test would pass against a decoder
 * that returned `true` for every row, which is a bug with exactly the symptom
 * #296 describes, arrived at from the other side.
 */

import { unixSeconds } from '@onyourleft/domain';
import { routeId, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { LOOP_FIELD, routeFromImportForm } from './import-form';
import { loopGpx, openEndedGpx } from './testing';

const NOW = unixSeconds(1_700_000_000);
const ID = routeId('route-from-the-import-form');

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

/** The form a rider submits, with a real file in it. @see import-form.test.ts */
function submitted(text: string, loop: boolean): FormData {
  const form = new FormData();
  form.set('file', new File([text], 'sunday.gpx'));
  if (loop) form.set(LOOP_FIELD, 'on');
  return form;
}

/**
 * Import through the production path, write it, and read it back on a
 * connection that has never seen the record.
 */
async function importedAndReadBack(text: string, loop: boolean): Promise<RouteRecord> {
  const open = await openSeeded();
  const outcome = await routeFromImportForm(submitted(text, loop), {
    id: ID,
    owner: ATHLETE_A,
    now: NOW,
  });
  if (outcome.status !== 'saved') {
    throw new Error(`the import refused this file: ${outcome.refusal.message}`);
  }
  const found = await open.roundTrip(
    async (store) => store.putRoute(outcome.record),
    async (store) => store.getRoute(ATHLETE_A, ID),
  );
  if (found === undefined) {
    throw new Error('a fresh connection can see no route with that id');
  }
  return found;
}

describe('a route imported as a loop', () => {
  it('reads back as a loop on a connection that never saw it written', async () => {
    const read = await importedAndReadBack(loopGpx(), true);

    expect(read.profile.loop).toBe(true);
    // And it is the same route, not merely a row with the flag set: the flag is
    // worth nothing without the geometry it wraps.
    expect(read.profile.totalDistance).toBeGreaterThan(250);
    expect(read.profile.positions.length).toBeGreaterThan(2);
  });

  it('reads back point to point when the rider did not claim it', async () => {
    const read = await importedAndReadBack(loopGpx(), false);

    expect(read.profile.loop).toBe(false);
  });

  it('is private, because nothing about a loop changes who may see it', async () => {
    const read = await importedAndReadBack(loopGpx(), true);

    expect(read.visibility).toBe('private');
  });
});

describe('a route that does not close, imported as a loop', () => {
  it('leaves the store with nothing in it at all', async () => {
    // #296's second criterion: *and the route is not saved as a non-loop behind
    // their back*. The read is the assertion — a refusal that still wrote
    // something would be invisible to a test that only read the outcome.
    const open = await openSeeded();

    const outcome = await routeFromImportForm(submitted(openEndedGpx(340), true), {
      id: ID,
      owner: ATHLETE_A,
      now: NOW,
    });
    expect(outcome.status).toBe('refused');

    const found = await open.read(async (store) => store.getRoute(ATHLETE_A, ID));
    expect(found).toBeUndefined();
    const listed = await open.read(async (store) => store.listRoutes(ATHLETE_A));
    expect(listed).toHaveLength(0);
  });
});
