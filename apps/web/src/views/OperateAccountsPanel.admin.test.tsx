// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2646, ADR 0069 D-7): the app's
 * `OperateAccountsPanel` and the instance's admin Accounts page, drawn from
 * ONE fixture, say the same registration-mode heading and sentence, the same
 * steps to change the mode and the same counts — and both say the steps
 * pinned below, so a step changed in `@onyourleft/operate-text` turns both
 * comparisons with the pin red, not neither.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`accountsBody`), reached by a computed
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
import { OperateAccountsPanel } from './OperateAccountsPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  accountsBody(view: {
    readonly status: OperateStatusAnswer | undefined;
    readonly registrations: readonly never[] | undefined;
    readonly strength: 'code' | 'passkey';
    readonly csrf: string;
    readonly notice: null;
    readonly reasonLimit: number;
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

/** What both must say, written out: the pin a change to the package's steps breaks. */
const PINNED_STEPS = [
  'Open the .env file beside compose.yaml.',
  'Set OYL_INSTANCE_REGISTRATION to approval, invite, open or closed.',
  'In that folder, run docker compose up -d instance, which starts the instance again with the new mode. docker compose restart does not read .env again.',
  // #2784 (ADR 0080 D-6): a mode the setup page or the command chose wins over .env.
  'If the setup page or operator registration set chose the mode, the instance holds it over .env: run operator registration clear too, or set the new mode with operator registration set instead.',
];

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

interface Said {
  readonly heading: string;
  readonly meaning: string;
  readonly steps: readonly string[];
  readonly text: string;
}

/** The mode's heading, the sentence after it, the steps, and all the text of `root`. */
function said(root: Element): Said {
  const heading = [...root.querySelectorAll('h2, h3')].find((each) =>
    squash(each.textContent).startsWith('Registration mode:'),
  );
  // The app's heading sits in a head with its ⓘ beside it; the sentence follows the head.
  const container = heading?.closest('.oyl-section-head') ?? heading;
  return {
    heading: squash(heading?.textContent),
    meaning: squash(container?.nextElementSibling?.textContent),
    steps: [...root.querySelectorAll('ol > li')].map((each) => squash(each.textContent)),
    text: squash(root.textContent),
  };
}

const drawnBoth = async (status: OperateStatus): Promise<{ app: Said; admin: Said }> => {
  mounted?.unmount();
  mounted = await mount(<OperateAccountsPanel status={status} />);
  const html = pages.accountsBody({
    status,
    registrations: [],
    strength: 'code',
    csrf: 'a'.repeat(64),
    notice: null,
    reasonLimit: 1000,
  });
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  return { app: said(mounted.container), admin: said(doc.body) };
};

describe('the app’s Accounts panel and the admin Accounts page say the same thing (#2646)', () => {
  it.each(['approval', 'invite', 'open', 'closed'] as const)(
    'the %s mode: the same heading, sentence and steps, from one fixture',
    async (registration) => {
      const { app, admin } = await drawnBoth({ ...SCRIPTED_STATUS, registration });
      expect(admin.heading).toBe(`Registration mode: ${registration}`);
      expect(admin.heading).toBe(app.heading);
      expect(admin.meaning).not.toBe('');
      expect(admin.meaning).toBe(app.meaning);
      expect(admin.steps).toEqual(app.steps);
      expect(admin.steps).toEqual(PINNED_STEPS);
    },
  );

  it('counts the same accounts awaiting approval and suspended as the app does', async () => {
    const status = {
      ...SCRIPTED_STATUS,
      counts: { ...SCRIPTED_STATUS.counts, athletes: { active: 7, pending: 4, suspended: 2 } },
    };
    const { app, admin } = await drawnBoth(status);
    for (const words of ['4 awaiting approval', '2 suspended']) {
      expect(app.text).toContain(words);
      expect(admin.text).toContain(words);
    }
    expect(admin.text).toContain('7 approved and active');
  });
});
