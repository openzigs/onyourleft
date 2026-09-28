// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * No sentence is lost — #666's first criterion.
 *
 * #666 tucks each screen's longer explanation into a `<details>` beneath its
 * controls, and the owner's ruling is that **nothing is deleted**. So every
 * sentence each route rendered on `main` — both of
 * `testing/populated-shell.tsx`'s fixtures, and the Files screen with a store
 * behind it — is recorded in `route-sentences.snapshot.json`, and every one of
 * them must still render on the SAME route, visible or tucked.
 *
 * ## The record, and why it is not rewritten by this test
 *
 * The snapshot was taken on `main` at `e6cd2cb`, before any screen was
 * changed, with `OYL_RECORD_ROUTE_SENTENCES=1` (see `.env.example`). Without
 * that variable this file only READS it. A record this test rewrote on every
 * run would agree with whatever the screens say today, which is the test that
 * cannot fail. Rewording a sentence is a real change and is done by editing
 * the record in the same commit, where a reviewer sees both halves.
 *
 * Since #670 a `list-detail` route's populated walk is read twice — the list,
 * and the same route with the fixture's item selected — because the list's
 * columns became the selected item's facts and actions. Three sentences were
 * edited in the record in #670's commit rather than lost: the Routes screen's
 * empty list said to import "above" (the import is beside it or below it
 * now), the Workouts builder said to add a block "above" (the block form
 * follows *Save workout* now), and the Workouts table's "Actions" column
 * heading is gone with the table.
 *
 * ## What it does not check
 *
 * That a sentence is in the same ORDER, or visible — `kept-visible.a11y.test`
 * is where the sentences that must never be tucked are held to that. And a
 * route's states neither fixture reaches (a ride in progress with a trainer
 * under control, a camera that is on) are not walked here.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { ALL_ROUTES, type RouteDefinition } from '../shell/routes';
import { openRoute, selectFixtureItem } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { sentencesIn, textBlocks } from '../testing/route-sentences';
import { emptyTransferPort } from '../testing/transfer-port';

/** `{ "<route id> <empty|populated>": [sentence, …] }`, in first-seen order. */
type Record_ = Record<string, readonly string[]>;

const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), 'route-sentences.snapshot.json');
const RECORDING = process.env['OYL_RECORD_ROUTE_SENTENCES'] === '1';

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

/** Open a route over a fixture, with a store behind the Files screen. */
async function open(route: RouteDefinition, populated: boolean): Promise<Element> {
  const transfer = await emptyTransferPort();
  harness = transfer.harness;
  mounted = await openRoute(route, populated, undefined, { transfer: transfer.port });
  expect(document.querySelector('h1')?.textContent).toBe(route.title);
  const main = document.querySelector('main');
  if (main === null) throw new Error('the shell rendered no main');
  return main;
}

function key(route: RouteDefinition, data: 'empty' | 'populated'): string {
  return `${route.id} ${data}`;
}

function readRecord(): Record_ {
  return JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record_;
}

describe('#666 — every sentence a route rendered on main still renders on it', () => {
  if (RECORDING) {
    it('records every route’s sentences', async () => {
      const record: Record<string, string[]> = {};
      for (const data of ['empty', 'populated'] as const) {
        for (const route of ALL_ROUTES) {
          const main = await open(route, data === 'populated');
          record[key(route, data)] = sentencesIn(main);
          mounted?.unmount();
          mounted = undefined;
          await harness?.destroy();
          harness = undefined;
        }
      }
      writeFileSync(SNAPSHOT, `${JSON.stringify(record, null, 2)}\n`);
    });
    return;
  }

  const record = readRecord();

  it('the record covers every route in the table, both ways, and holds sentences', () => {
    // #142: a route added to the table after the record was taken is not
    // silently unchecked — it has to be recorded.
    const expected = ALL_ROUTES.flatMap((route) => [key(route, 'empty'), key(route, 'populated')]);
    expect(Object.keys(record).sort()).toEqual([...expected].sort());
    const total = Object.values(record).reduce((sum, sentences) => sum + sentences.length, 0);
    expect(total, 'the record is empty, so this file checks nothing').toBeGreaterThan(200);
  });

  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id} (${route.path}), ${data}`, async () => {
        const main = await open(route, data === 'populated');
        const blocks = textBlocks(main);
        // #670: on a list–detail route an item's own sentences — its facts,
        // its actions — render on the SAME route once it is selected, where
        // they used to be columns of the list. The union is what the route
        // renders.
        if (data === 'populated' && (await selectFixtureItem(route))) {
          blocks.push(...textBlocks(main));
        }
        const rendered = blocks.join(' \n ');
        const lost = (record[key(route, data)] ?? []).filter(
          (sentence) => !rendered.includes(sentence),
        );
        expect(lost, `sentences ${route.id} rendered on main and no longer does`).toEqual([]);
      });
    }
  }
});
