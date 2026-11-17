// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2649, ADR 0069 D-7): the app's
 * `OperateRoomsPanel` and the instance's admin Rooms page, drawn from ONE
 * fixture, say the same line for every room — and both say the lines pinned
 * below, so a word changed in `@onyourleft/operate-text` turns both
 * comparisons with the pin red.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`roomsBody`), reached by a computed
 * path for `testing/operate-instance-testing.ts`'s reason.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SCRIPTED_ROOMS, scriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateRoomsPanel } from './OperateRoomsPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  roomsBody(view: {
    readonly rooms: readonly unknown[];
    readonly strength: 'code' | 'passkey';
    readonly csrf: string;
    readonly notice: null;
  }): string;
}

const PAGES = join(dirname(fileURLToPath(import.meta.url)), '../../../instance/src/admin/pages.ts');

let pages: AdminPages;
beforeAll(async () => {
  pages = (await import(/* @vite-ignore */ PAGES)) as AdminPages;
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const PINNED_LINES = [
  'Race, private, under way. Opened 2026-11-14 19:30 UTC by Ann. 3 riders: Ann, Bea and a rider. Code a1b2c3.',
  'Group ride, public, waiting to start. Opened 2026-11-14 18:00 UTC by Cal. Nobody is in it. Code 0f1e2d.',
];

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

describe('the app’s Rooms panel and the admin Rooms page say the same thing (#2649)', () => {
  it.each(['code', 'passkey'] as const)(
    'draws the same line for every room, from one fixture (a %s session)',
    async (strength) => {
      mounted = await mount(<OperateRoomsPanel port={scriptedOperate().port} />);
      await settle();
      const appLines = [...mounted.container.querySelectorAll('.oyl-operate__rooms > li')].map(
        (item) => {
          const copy = item.cloneNode(true) as HTMLElement;
          // The app's End room button sits in the line's item, after it.
          for (const button of copy.querySelectorAll('button')) button.remove();
          return squash(copy.textContent);
        },
      );
      const html = pages.roomsBody({
        rooms: SCRIPTED_ROOMS,
        strength,
        csrf: 'a'.repeat(64),
        notice: null,
      });
      const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
      const adminLines = [...doc.querySelectorAll('ol.rooms > li > p:first-child')].map((line) =>
        squash(line.textContent),
      );
      expect(adminLines).toEqual(PINNED_LINES);
      expect(appLines).toEqual(adminLines);
    },
  );
});
