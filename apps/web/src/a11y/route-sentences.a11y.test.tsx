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
 * ⚠️ **Re-recorded by #746, with the reader made the recorder's collection.**
 * A sentence is now found only as a sentence the collection produced — not as
 * a substring of any block, which the reader used to accept — and the record
 * must EQUAL what the recorder would write here. The re-record reordered the
 * sentences #666 and #670 moved and added what the screens had gained since
 * (the "More about" summaries — ⓘ help since #1031, whose hidden names
 * "Help with …" are recorded instead — the Appearance section, the Activities
 * list–detail prompt, the Basis transcoder's credit). It dropped two lines,
 * each still said in other words it records: "Draw a route", the `<h2>` #670
 * removed when the drawing link moved to the head of the list ("Draw a route on
 * this device — …" is recorded), which the old reader passed only as a
 * substring of that sentence; and #745's hand-edited kit sentence, which
 * renders after its warning's "No local store:" label in one block and is
 * recorded so.
 *
 * ⚠️ **Re-recorded by #943**, when the empty states became
 * `design/EmptyState.tsx`. Every empty-state sentence is still recorded, in
 * the same words; each screen gained a heading over it ("Your first ride" and
 * so on) and its action moved into it, which reorders a few lines. Two lines
 * changed on Activities' empty walk and are not lost words: "Start a ride
 * Import or export files" is now two lines, because *Start a ride* is the
 * empty state's action and no longer shares a paragraph with the import; and
 * the six column headings of the EMPTY table ("Ride", "Started", "Duration",
 * "Distance (km)", "Avg power (W)", "Actions") are gone with that table — a
 * table with no rows is what the empty state replaces. Every one of them
 * still renders on the populated walk, which this file holds unchanged. One
 * sentence is REWORDED, in the record in the same commit: Segments' "Make one
 * from a ride above." is "below" with no segment yet, because the list moved
 * ahead of the forms to keep its action above the fold. And since #987's
 * review that "below" sentence is said only where there IS a ride with a
 * track below: with none — which is the empty walk — the form below is the
 * *Nothing to cut from* refusal, so pointing at it was false, and the empty
 * state says "No segments yet. A segment is cut from a ride with a track:
 * import one from a file to begin." over a primary *Import a ride* instead.
 * The record's Segments line is that sentence; the "below" one is still in
 * the source, for a device that has a ride to cut from.
 *
 * ⚠️ **Edited by #1009, the owner's rulings of 2026-10-02.** Camera's note was
 * "Nothing is sent anywhere, and a picture is thrown away once it has been
 * looked at." — false on a screen that offers to send pictures to the rider's
 * own computer and ride text to a hosted model, and its second half false
 * once "keep this ride's pictures" is on. It is REWORDED, in the owner's
 * approved words: "Pictures and ride details stay on this device unless you
 * turn on sending them below." Nothing is lost by it: that a picture is thrown
 * away once looked at is still said, with its exception, by the consent text
 * on the same route (`camera/consent.ts`). And Moderation's two log sentences
 * moved from below the actions to above them, which reorders that route's
 * populated walk and changes no word.
 *
 * ⚠️ **Re-recorded by #1013**, when each section's explanation moved behind
 * its ⓘ (`design/SectionHelp.tsx`). Nothing was lost: every route gained its
 * sections' "Help with …" names, sentences moved order, and Analysis' empty
 * walk says "A ride recorded without a power meter or a strap carries
 * neither." in its Time in zone help, where it used to follow a ride with
 * neither. One sentence is REWORDED, in the record in the same commit: the
 * Routes import's "Turn it on for a circuit…" is read in the section's help
 * now, above the switch rather than under it, so it names the switch — "Turn
 * on “This route is a loop” for a circuit…".
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

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { ALL_ROUTES, type RouteDefinition } from '../shell/routes';
import { openRoute, selectFixtureItem } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { sentencesIn } from '../testing/route-sentences';
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

/**
 * Every sentence one route says over one fixture — the ONE collection the
 * recorder writes and the reader checks against (#746).
 *
 * ⚠️ **Until #746 they collected differently, and a reviewer who remembers the
 * reader matching a sentence anywhere in the page's text is reading the old
 * file.** The recorder took the list's sentences only; the reader also read the
 * list–detail route with its fixture's item selected (#670) and accepted a
 * sentence found as a SUBSTRING of any block. So a re-record on `main` dropped
 * 121 lines the reader was still holding — every sentence that moved from a
 * list's columns into its selected item — and nothing said so. Both now read
 * the list and, where there is one, the selected item, and keep each distinct
 * sentence once, in first-seen order.
 */
async function sentencesFor(
  route: RouteDefinition,
  data: 'empty' | 'populated',
): Promise<string[]> {
  const main = await open(route, data === 'populated');
  const sentences = sentencesIn(main);
  // #670: on a list–detail route an item's own sentences — its facts, its
  // actions — render on the SAME route once it is selected, where they used
  // to be columns of the list. The union is what the route renders.
  if (data === 'populated' && (await selectFixtureItem(route))) {
    for (const sentence of sentencesIn(main)) {
      if (!sentences.includes(sentence)) sentences.push(sentence);
    }
  }
  return sentences;
}

/** Every route over both fixtures, collected by {@link sentencesFor}. */
async function recordNow(): Promise<Record<string, string[]>> {
  const record: Record<string, string[]> = {};
  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      record[key(route, data)] = await sentencesFor(route, data);
      mounted?.unmount();
      mounted = undefined;
      await harness?.destroy();
      harness = undefined;
    }
  }
  return record;
}

describe('#666 — every sentence a route rendered on main still renders on it', () => {
  if (RECORDING) {
    it('records every route’s sentences', async () => {
      writeFileSync(SNAPSHOT, `${JSON.stringify(await recordNow(), null, 2)}\n`);
    });
    return;
  }

  const record = readRecord();
  let now: Record<string, string[]> = {};

  beforeAll(async () => {
    now = await recordNow();
  });

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
      it(`${route.id} (${route.path}), ${data}`, () => {
        const rendered = new Set(now[key(route, data)]);
        const lost = (record[key(route, data)] ?? []).filter((sentence) => !rendered.has(sentence));
        expect(
          lost,
          `sentences ${route.id} rendered on main and no longer does: ${JSON.stringify(lost)}`,
        ).toEqual([]);
      });
    }
  }

  // #746: the recorder and the reader are one collection, so a re-record
  // on this tree writes exactly the committed file. A sentence ADDED to a
  // route is red here until the record is taken again — which is the point:
  // a record that lags the screens stops protecting what they gained, and a
  // re-record that would quietly drop a line is seen in the same diff.
  it('is exactly what the recorder would write on this tree', () => {
    expect(now).toEqual(record);
  });
});
