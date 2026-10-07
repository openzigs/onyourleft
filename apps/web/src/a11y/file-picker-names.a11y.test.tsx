// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Every file picker's name holds the words drawn on it — #1038, WCAG 2.2 SC
 * 2.5.3 (Label in Name).
 *
 * `design/FileDrop.tsx` §`FilePicker` draws a file input as a styled button
 * (#1030) whose words — "Choose file", "Choose files", "Choose a folder" — are
 * `aria-hidden`. A speech-input user says the words they see, so the input's
 * name has to contain them as well as the screen's own label. This walks every
 * route in `shell/routes.ts` §`ALL_ROUTES` — imported, never listed (#142) —
 * over both fixtures, with a store behind the Files screen as
 * `route-sentences.a11y.test.tsx` opens it, and holds every picker to that.
 *
 * ⚠️ A walk that found no picker would pass, so the routes it found one on are
 * held too ({@link ROUTES_WITH_A_PICKER}).
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { ALL_ROUTES, type RouteId } from '../shell/routes';
import { openRoute } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { emptyTransferPort } from '../testing/transfer-port';

import { accessibleName } from './audit';

/** The routes that draw a file picker on the populated walk, measured. */
const ROUTES_WITH_A_PICKER: readonly RouteId[] = ['routes', 'workouts', 'transfer', 'settings'];

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

/** Which routes drew a picker on each walk, filled in by the cases above it. */
const seen = { empty: new Set<RouteId>(), populated: new Set<RouteId>() };

describe('#1038 — every file picker is named with the words on its button', () => {
  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id}, ${data}`, async () => {
        const transfer = await emptyTransferPort();
        harness = transfer.harness;
        mounted = await openRoute(route, data === 'populated', undefined, {
          transfer: transfer.port,
        });
        const faults: string[] = [];
        for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
          seen[data].add(route.id);
          const words = input.parentElement
            ?.querySelector('.oyl-file__button')
            ?.textContent?.trim();
          const label = input.labels?.[0]?.textContent?.trim();
          const name = accessibleName(input);
          if (words === undefined || words === '') {
            faults.push(`#${input.id} is not drawn by FilePicker`);
          } else if (!name.includes(words)) {
            faults.push(`#${input.id} is named "${name}", without "${words}"`);
          }
          if (label === undefined || label === '' || !name.includes(label)) {
            faults.push(`#${input.id} is named "${name}", without its label`);
          }
        }
        expect(faults).toEqual([]);
      });
    }
  }

  it('found a picker on every route that draws one', () => {
    expect([...seen.populated].sort()).toEqual([...ROUTES_WITH_A_PICKER].sort());
    expect([...seen.empty].sort()).toEqual([...ROUTES_WITH_A_PICKER].sort());
  });
});
