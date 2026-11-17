// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2650, ADR 0069 D-7): the app's
 * `OperateKeysPanel` and the instance's admin Keys page, drawn from ONE
 * fixture, say the same label and value for every fact of the keys but the
 * card — and both say the facts pinned below. The card and its fingerprint
 * are drawn by the admin page only where it is handed them (the loopback
 * listener), and then whole.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`keysBody`), reached by a computed
 * path for `testing/operate-instance-testing.ts`'s reason.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SCRIPTED_KEYS, scriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateKeysPanel } from './OperateKeysPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  keysBody(view: {
    readonly keys: unknown;
    readonly card: { readonly card: string; readonly fingerprint: string } | null;
    readonly onServer: boolean;
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

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

const facts = (root: ParentNode, selector: string): (readonly [string, string])[] =>
  [...root.querySelectorAll(`${selector} > div`)].map(
    (fact) =>
      [
        squash(fact.querySelector('dt')?.textContent),
        squash(fact.querySelector('dd')?.textContent),
      ] as const,
  );

const STATE = {
  state: SCRIPTED_KEYS.state,
  current: SCRIPTED_KEYS.current,
  olderHeld: SCRIPTED_KEYS.olderHeld,
};

describe('the app’s Keys panel and the admin Keys page say the same thing (#2650)', () => {
  it('draws the same facts but the card, from one fixture, and the card only where it is handed', async () => {
    mounted = await mount(<OperateKeysPanel port={scriptedOperate().port} />);
    await settle();
    const app = facts(mounted.container, 'dl.oyl-operate__keys').filter(
      ([label]) => label !== 'Card' && label !== 'Fingerprint',
    );
    const draw = (onServer: boolean) =>
      new DOMParser().parseFromString(
        `<main>${pages.keysBody({
          keys: STATE,
          card: onServer
            ? { card: SCRIPTED_KEYS.card ?? '', fingerprint: SCRIPTED_KEYS.fingerprint ?? '' }
            : null,
          onServer,
          strength: 'code',
          csrf: 'a'.repeat(64),
          notice: null,
        })}</main>`,
        'text/html',
      );
    const tunnel = draw(false);
    const admin = facts(tunnel, 'dl.facts');
    expect(admin.map(([label]) => label)).toEqual([
      'State',
      'Encryption key',
      'Rotates by itself',
      'Older keys held',
    ]);
    expect(admin).toEqual(app);
    // Through the tunnel the card is not there at all; on the server machine, whole.
    const fingerprint = SCRIPTED_KEYS.fingerprint ?? '';
    expect(tunnel.body.textContent).not.toContain(fingerprint.slice(0, 8));
    expect(tunnel.body.textContent).not.toContain('oyl-instance:');
    const server = draw(true);
    expect(server.querySelector('code.card')?.textContent).toBe(SCRIPTED_KEYS.card);
    expect(server.querySelector('code.fingerprint')?.textContent).toBe(fingerprint);
  });
});
