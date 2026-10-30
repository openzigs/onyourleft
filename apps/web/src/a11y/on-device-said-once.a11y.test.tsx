// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Where rides are is said once on a screen, where it matters — #1442.
 *
 * Every screen ended with the footer's "Your rides are kept on this device",
 * and several said their own version just above it: the Ride screen's note,
 * History's line under its list and its summary, Instance's note. The footer
 * says only what the app is now, and the screens that need the sentence say
 * it once.
 *
 * What counts: a sentence whose SUBJECT is the rider's rides (or that opens
 * *Recorded*) and says they are kept, stored, recorded or stay on this device
 * — the reassurance itself. Not counted: a count of rides on this device ("No
 * rides on this device"), a threshold "stored on this device with your
 * rides", a workout saved there, and what one ACTION does, said beside it —
 * Instance's "Disconnecting … Every ride stays on this device." (#777) and
 * About's "Syncing with it sends your rides … they stay on this device too."
 * (#1195). Those are each action's consequence, and dropping either would
 * drop a promise about that action. Read from the whole shell, footer
 * included, over both of `testing/populated-shell.tsx`'s fixtures.
 *
 * What it cannot reach: a paraphrase that does not use those words. Those are
 * held by reading, and by the route-sentences record for what a route renders.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { ALL_ROUTES, routeById } from '../shell/routes';
import { openRoute } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { sentencesIn } from '../testing/route-sentences';
import { emptyTransferPort } from '../testing/transfer-port';

const REASSURANCE =
  /^(your )?(rides?\b[^.]*\b(kept|stored|recorded|stays?)|recorded)\b[^.]*\bon this device\b/i;

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

describe('where rides are, said once a screen — #1442', () => {
  it('counts the reassurance and not a count of rides or a setting’s place', () => {
    for (const said of [
      'Your rides are kept on this device.',
      'Recorded on this device.',
      'Rides recorded on this device, newest first.',
      'Rides are stored on this device.',
      'Your rides stay on this device.',
    ]) {
      expect(REASSURANCE.test(said), said).toBe(true);
    }
    for (const other of [
      'No rides on this device',
      'They are stored on this device with your rides.',
      'Workouts saved on this device, newest first.',
      'Record a ride from the sensors paired on this device.',
      'Every ride stays on this device.',
      'Syncing with it sends your rides, whole; they stay on this device too.',
    ]) {
      expect(REASSURANCE.test(other), other).toBe(false);
    }
  });

  it('the footer under every screen does not say it', async () => {
    mounted = await openRoute(routeById('home'), false);
    const footer = document.querySelector('.oyl-footer');
    expect(footer?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'On Your Left — free and open source.',
    );
  });

  for (const populated of [false, true]) {
    it(`no screen says it twice, ${populated ? 'populated' : 'empty'}`, async () => {
      const twice: string[] = [];
      for (const route of ALL_ROUTES) {
        const transfer = await emptyTransferPort();
        harness = transfer.harness;
        mounted = await openRoute(route, populated, undefined, { transfer: transfer.port });
        const said = sentencesIn(document.body).filter((sentence) => REASSURANCE.test(sentence));
        if (said.length > 1) twice.push(`${route.id}: ${said.join(' | ')}`);
        mounted.unmount();
        mounted = undefined;
        await harness.destroy();
        harness = undefined;
      }
      expect(twice).toStrictEqual([]);
      // Every route in the table, mounted one after another: seconds, not the
      // default five, on a loaded runner.
    }, 60_000);
  }
});
