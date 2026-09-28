// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The control for #668's one-primary gate, in the literal shape the third
 * criterion asks for: a route with two primaries, which must fail.
 *
 * The fixture route is the `about` row of the real route table, whose view is
 * replaced here by one drawing two primaries. Nothing else is replaced: the
 * route is walked by `testing/hierarchy-walk.tsx` §`walkRoute` — the hash, the
 * real `AppShell` over `populated-shell.tsx`, the marker check and
 * `onePrimaryViolations` — which is the one function every route in
 * `button-hierarchy.a11y.test.tsx` goes through. A walk that stopped counting,
 * or stopped reaching the view, turns this red.
 *
 * In its own file because `vi.mock` replaces the module for the whole file,
 * and the real walk must see the real `AboutView`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../design/Button';
import { routeById } from '../shell/routes';
import { walkRoute } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';

vi.mock('../views/AboutView', () => ({
  AboutView: () => (
    <>
      <p>A fixture view with two calls to action.</p>
      <Button>Start recording</Button>
      <Button>Import route</Button>
    </>
  ),
}));

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

describe('the control — a route with two primaries fails the walk', () => {
  for (const populated of [false, true]) {
    it(`reports both, by name, ${populated ? 'populated' : 'empty'}`, async () => {
      const walked = await walkRoute(routeById('about'), populated);
      mounted = walked.mounted;
      expect(walked.violations).toEqual([
        '2 primary buttons in one view: “Start recording”, “Import route”',
      ]);
    });
  }
});
