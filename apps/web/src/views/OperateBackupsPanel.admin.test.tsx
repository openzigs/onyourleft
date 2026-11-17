// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2647, ADR 0069 D-7): the app's
 * `OperateBackupsPanel` and the instance's admin Backups page, drawn from ONE
 * fixture, say the same line for every record and the same restore steps —
 * and both say the lines pinned below, so a word changed in
 * `@onyourleft/operate-text` turns both comparisons with the pin red.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`backupsBody`), reached by a computed
 * path for `testing/operate-instance-testing.ts`'s reason.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { OperateBackup } from '../instance/operate-port';
import { SCRIPTED_BACKUPS, scriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateBackupsPanel } from './OperateBackupsPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  backupsBody(view: {
    readonly backups: { readonly records: readonly unknown[]; readonly pendingSince: null };
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

/** The route's further facts, which only the admin page draws, added to each scripted record. */
const withFacts = (record: OperateBackup) => ({
  ...record,
  databaseSha256: null,
  removed: null,
  freeBytes: { backups: null, offBox: null },
});

const PINNED_LINES = [
  '2026-11-14 20:00 UTC, 1 hour ago, asked for by the owner: 3.4 GB, 48213 rows, 1204 blobs; off-box copy made. snapshot-2026-11-14T20-00-00-000Z',
  '2026-11-14 18:00 UTC, 3 hours ago: no snapshot was made (ENOSPC).',
  '2026-11-14 12:00 UTC, 9 hours ago: 3.4 GB, 48100 rows, 1200 blobs; off-box copy FAILED. snapshot-2026-11-14T12-00-00-000Z',
];

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

describe('the app’s Backups panel and the admin Backups page say the same thing (#2647)', () => {
  it('draws the same line for every record and the same restore steps, from one fixture', async () => {
    mounted = await mount(
      <OperateBackupsPanel port={scriptedOperate().port} every={() => () => undefined} />,
    );
    await settle();
    const appLines = [...mounted.container.querySelectorAll('.oyl-operate__backups > li')].map(
      (item) => {
        const copy = item.cloneNode(true) as HTMLElement;
        // A warning is a StatusMessage: not part of the line.
        for (const message of copy.querySelectorAll('[role="status"], .oyl-status'))
          message.remove();
        return squash(copy.textContent);
      },
    );
    const appSteps = [...mounted.container.querySelectorAll('.oyl-operate__restore > li')].map(
      (step) => squash(step.textContent),
    );

    const html = pages.backupsBody({
      backups: { records: SCRIPTED_BACKUPS.map(withFacts), pendingSince: null },
      strength: 'code',
      csrf: 'a'.repeat(64),
      notice: null,
    });
    const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    const adminLines = [...doc.querySelectorAll('ol.backups > li > p:first-child')].map((line) =>
      squash(line.textContent),
    );
    const adminSteps = [...doc.querySelectorAll('ol.restore > li')].map((step) =>
      squash(step.textContent),
    );

    expect(adminLines).toEqual(PINNED_LINES);
    expect(appLines).toEqual(adminLines);
    expect(adminSteps).toHaveLength(5);
    // The app's picker starts at the newest snapshot, as the admin page's steps are.
    expect(appSteps).toEqual(adminSteps);
    expect(adminSteps[1]).toContain('restore /backups/snapshot-2026-11-14T20-00-00-000Z --force');
  });
});
