// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2645, ADR 0069 D-7): the app's
 * `OperateStatusPanel` and the instance's admin Status page, drawn from ONE
 * fixture, say the same label and value for every row — and both say the
 * rows pinned below, so a row label changed in `@onyourleft/operate-text`
 * turns both comparisons with the pin red, not neither.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`statusBody`), reached by a computed
 * path for `testing/operate-instance-testing.ts`'s reason; the shape it is
 * used through is written down here.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OperateStatusAnswer } from '@onyourleft/operate-text';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { OperateStatus } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { mount, type Mounted } from '../testing/mount';
import { OperateStatusPanel } from './OperateStatusPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  statusBody(status: OperateStatusAnswer | undefined, now: number): string;
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

const NOW = Date.parse('2026-11-14T21:00:00.000Z');

/** Thirteen hours old on a six-hour interval: a row with a warning beside the low disk's. */
const STATUS: OperateStatus = {
  ...SCRIPTED_STATUS,
  lastBackup: { at: '2026-11-14T08:00:00.000Z', offBox: 'copied', intervalSeconds: 6 * 3600 },
};

/** What both must say, written out: the pin a change to the package's words breaks. */
const PINNED: readonly (readonly [string, string])[] = [
  ['Version', '0.0.0'],
  ['Deployed commit', '0123456789abcdef0123456789abcdef01234567'],
  ['Database', 'ok'],
  ['Migrations', 'up to date'],
  ['Rooms', 'ok'],
  ['Up for', '3 days 4 hours'],
  ['Disk holding the database', '412 GB free of 500 GB'],
  ['Disk holding the blobs', '20 GB free of 1.0 TB'],
  ['Last backup', '2026-11-14 08:00 UTC, 13 hours ago; its off-box copy succeeded.'],
  ['Tunnel', 'ready, 4 connections'],
  ['Registration', 'approval: a moderator approves each account'],
  ['Accounts', '3 active, 1 awaiting approval, 1 suspended'],
  ['Rooms open', '2'],
  ['Analysis jobs', '2 waiting, 1 running'],
  ['Instance keys', 'ready'],
];

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

/** The app's facts: a warning is a `StatusMessage`, the element its glyph is in. */
function appRows(container: Element): (readonly [string, string, string | null])[] {
  return [...container.querySelectorAll('dl.oyl-operate__status > div')].map((fact) => {
    const value = fact.querySelector('dd')?.cloneNode(true) as HTMLElement;
    const message = value.querySelector('.oyl-status__glyph')?.parentElement ?? null;
    message?.remove();
    message?.querySelector('.oyl-status__glyph')?.remove();
    return [
      squash(fact.querySelector('dt')?.textContent),
      squash(value.textContent),
      message === null ? null : squash(message.textContent),
    ] as const;
  });
}

/** The admin page's facts: a warning is its `p.warning`. */
function adminRows(html: string): (readonly [string, string, string | null])[] {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  return [...doc.querySelectorAll('dl.facts > div')].map((fact) => {
    const value = fact.querySelector('dd')?.cloneNode(true) as HTMLElement;
    const warning = value.querySelector('p.warning');
    warning?.remove();
    return [
      squash(fact.querySelector('dt')?.textContent),
      squash(value.textContent),
      warning === null ? null : squash(warning.textContent),
    ] as const;
  });
}

describe('the app’s Status panel and the admin Status page say the same thing (#2645)', () => {
  const drawnBoth = async () => {
    mounted = await mount(<OperateStatusPanel timeZone="UTC" status={STATUS} now={() => NOW} />);
    return { app: appRows(mounted.container), admin: adminRows(pages.statusBody(STATUS, NOW)) };
  };

  it('draws the same label, value and warning for every row, from one fixture', async () => {
    const { app, admin } = await drawnBoth();
    expect(admin).toEqual(app);
    // The two warnings, in both.
    expect(admin.filter(([, , warning]) => warning !== null).map(([label]) => label)).toEqual([
      'Disk holding the blobs',
      'Last backup',
    ]);
  });

  it('the app’s panel draws the last backup in the zone it is given, named; the admin page in UTC (#2917)', async () => {
    mounted = await mount(
      <OperateStatusPanel timeZone="America/New_York" status={STATUS} now={() => NOW} />,
    );
    const lastBackup = (rows: readonly (readonly [string, string, string | null])[]) =>
      rows.find(([label]) => label === 'Last backup')?.[1];
    expect(lastBackup(appRows(mounted.container))).toMatch(/^2026-11-14 03:00 EST, /);
    expect(lastBackup(adminRows(pages.statusBody(STATUS, NOW)))).toMatch(/^2026-11-14 08:00 UTC, /);
  });

  it('the app’s panel says the pinned rows', async () => {
    const { app } = await drawnBoth();
    expect(app.map(([label, value]) => [label, value])).toEqual(PINNED);
  });

  it('the admin Status page says the pinned rows', async () => {
    const { admin } = await drawnBoth();
    expect(admin.map(([label, value]) => [label, value])).toEqual(PINNED);
  });

  it('says the same thing above the rows, ready or not', async () => {
    for (const ready of [true, false]) {
      mounted?.unmount();
      mounted = await mount(
        <OperateStatusPanel timeZone="UTC" status={{ ...STATUS, ready }} now={() => NOW} />,
      );
      const sentence = ready
        ? 'The instance is up and ready for riders.'
        : 'The instance is up but not ready for riders. The checks below say which failed.';
      expect(squash(mounted.container.textContent)).toContain(sentence);
      expect(pages.statusBody({ ...STATUS, ready }, NOW)).toContain(sentence);
    }
  });
});
