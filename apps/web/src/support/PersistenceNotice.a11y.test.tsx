// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What the storage panel says, and that it is audited (#409).
 *
 * ⚠️ `routes.a11y.test.tsx` renders Settings with no `storage` prop, so it
 * audits the `unsupported` branch and **only** that one. The two branches a
 * rider actually sees — granted and not granted — would sit outside the gate,
 * which is the shape `RideRecovery.a11y.test.tsx` and `UpdateOffer.a11y.test.tsx`
 * both exist to close.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { AppShell } from '../shell/AppShell';
import { routeById } from '../shell/routes';
import { mount, settle, type Mounted } from '../testing/mount';

import {
  BEST_EFFORT_TEXT,
  CLEARING_STILL_REMOVES,
  PERSISTENT_TEXT,
  UNSUPPORTED_TEXT,
} from './PersistenceNotice';
import type { CapabilityProbe } from './bluetooth-support';
import type { StorageManagerLike } from './persistent-storage';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function settings(storage: StorageManagerLike | undefined): Promise<Mounted> {
  globalThis.location.hash = `#${routeById('settings').path}`;
  mounted = await mount(
    <AppShell capabilities={NO_BLUETOOTH} {...(storage === undefined ? {} : { storage })} />,
  );
  await settle();
  return mounted;
}

const GRANTED: StorageManagerLike = { persisted: () => Promise.resolve(true) };
const DENIED: StorageManagerLike = { persisted: () => Promise.resolve(false) };

describe('the storage panel is inside the accessibility gate', () => {
  it.each([
    ['granted', GRANTED],
    ['not granted', DENIED],
    ['no Storage API', undefined],
  ])('audits clean when persistence is %s', async (_name, storage) => {
    await settings(storage);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('what the rider is told', () => {
  it('says the browser will not remove the rides, when it has said so', async () => {
    const view = await settings(GRANTED);
    expect(view.container.textContent ?? '').toContain(PERSISTENT_TEXT);
  });

  it('says it may remove them, when it has not', async () => {
    const view = await settings(DENIED);
    expect(view.container.textContent ?? '').toContain(BEST_EFFORT_TEXT);
  });

  it('says nothing it cannot know, where there is no Storage API', async () => {
    const view = await settings(undefined);
    expect(view.container.textContent ?? '').toContain(UNSUPPORTED_TEXT);
  });

  it('is fully usable after a browser that refuses — every route still renders', async () => {
    // #409: "a denied request is handled and does not throw, and the app is
    // fully usable afterwards".
    const view = await settings(DENIED);
    expect(view.container.querySelector('h1')?.textContent).toBe('Settings');
    const headings = [...view.container.querySelectorAll('h2')].map(
      (heading) => heading.textContent ?? '',
    );
    expect(headings).toContain('Units');
    expect(headings).toContain('Your weight');
    expect(headings).toContain('Storage');
  });

  it('survives a browser whose persisted() throws', async () => {
    const view = await settings({
      persisted: () => {
        throw new Error('not implemented');
      },
    });
    expect(view.container.textContent ?? '').toContain(UNSUPPORTED_TEXT);
  });
});

describe('the honest half cannot ship without being said', () => {
  it.each([
    ['persistent', PERSISTENT_TEXT],
    ['best-effort', BEST_EFFORT_TEXT],
    ['unsupported', UNSUPPORTED_TEXT],
  ])('pairs the %s message with what persistence does not protect against', (_name, text) => {
    // ⚠️ #409's criterion, by string, in both halves: the reassuring sentence
    // and the one about clearing site data are rendered together on every
    // branch, so an edit that keeps only the comfortable one is a red build.
    expect(text).toContain('automatically');
  });

  it('always renders the sentence about clearing site data', async () => {
    for (const storage of [GRANTED, DENIED, undefined]) {
      const view = await settings(storage);
      expect(view.container.textContent ?? '').toContain(CLEARING_STILL_REMOVES);
      view.unmount();
      mounted = undefined;
    }
  });

  it('names no ride, no athlete and no coordinate — ADR 0004 decision D', () => {
    // The rule binds every layer that formats a coordinate into a string, a
    // settings panel included. This one talks about storage and never about
    // what is in it, and that is what this asserts.
    for (const text of [PERSISTENT_TEXT, BEST_EFFORT_TEXT, UNSUPPORTED_TEXT]) {
      expect(text).not.toMatch(/\d+\.\d+/);
      expect(text.toLowerCase()).not.toContain('latitude');
      expect(text.toLowerCase()).not.toContain('longitude');
      expect(text.toLowerCase()).not.toContain('athlete');
    }
  });
});
