// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Every empty state is the one component — #943's first criterion.
 *
 * Every route in `shell/routes.ts` §`ALL_ROUTES` — the table, never a hand
 * list (#142) — is opened through the real `AppShell` over
 * `testing/populated-shell.tsx`'s EMPTY fixture, and held to its entry in
 * that file's `EMPTY_STATES`:
 *
 * - **`empty-state`**: the sentence the screen says about being empty renders
 *   INSIDE a `design/EmptyState.tsx`, and that empty state has an
 *   `aria-hidden` drawing from the kit, a heading, and exactly one action.
 *   A view that went back to saying the sentence in a bare paragraph is red
 *   here — the case this criterion names — and so is one that deleted the
 *   sentence, which `route-sentences.a11y.test.tsx` would also catch.
 * - **`none`**: no empty state at all, so an entry cannot quietly go stale
 *   the other way.
 *
 * And over the POPULATED fixture no declared route shows one: an empty state
 * that renders whatever the data is not an empty state.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { ALL_ROUTES } from '../shell/routes';
import { openRoute } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { AVAILABLE_BLUETOOTH, EMPTY_STATES } from '../testing/populated-shell';

import { PRIMARY_BUTTON_SELECTOR } from './button-hierarchy';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function normalise(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The innermost element in `main` whose text holds `sentence`, or `null`. */
function sayer(main: Element, sentence: string): Element | null {
  let found: Element | null = null;
  for (const element of main.querySelectorAll('*')) {
    if (normalise(element.textContent).includes(sentence)) {
      found = element;
    }
  }
  return found;
}

describe('#943 — every empty state renders through design/EmptyState.tsx', () => {
  it('declares at least the seven screens #943 names', () => {
    const declared = ALL_ROUTES.filter((route) => EMPTY_STATES[route.id].kind === 'empty-state');
    expect(declared.map((route) => route.id).sort()).toEqual(
      ['activities', 'analysis', 'devices', 'game', 'routes', 'segments', 'workouts'].sort(),
    );
  });

  for (const route of ALL_ROUTES) {
    it(`${route.id} (${route.path}), empty`, async () => {
      const expectation = EMPTY_STATES[route.id];
      mounted = await openRoute(
        route,
        false,
        undefined,
        expectation.kind === 'empty-state' && expectation.bluetooth === true
          ? { capabilities: AVAILABLE_BLUETOOTH }
          : {},
      );
      expect(document.querySelector('h1')?.textContent).toBe(route.title);
      const main = document.querySelector('main');
      if (main === null) throw new Error('the shell rendered no main');
      const states = [...main.querySelectorAll('[data-oyl-empty-state]')];

      if (expectation.kind === 'none') {
        expect(states, `${route.id} declares no empty state: ${expectation.reason}`).toEqual([]);
        return;
      }

      const said = sayer(main, expectation.sentence);
      expect(said, `${route.id} no longer says “${expectation.sentence}”`).not.toBeNull();
      const state = said?.closest('[data-oyl-empty-state]');
      expect(
        state,
        `${route.id} says “${expectation.sentence}” outside design/EmptyState.tsx`,
      ).toBeTruthy();
      expect(states).toHaveLength(1);
      if (state === null || state === undefined) return;

      // The drawing: decoration, from the kit, hidden whole.
      const art = state.querySelector(':scope > .oyl-empty-state__art');
      expect(art?.getAttribute('aria-hidden')).toBe('true');
      const svgs = art?.querySelectorAll('svg') ?? [];
      expect(svgs.length, `${route.id}: the empty state draws nothing`).toBeGreaterThan(0);
      for (const svg of svgs) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
      // A heading, and words of its own.
      const heading = state.querySelector(':scope > h2, :scope > h3, :scope > h4');
      expect(normalise(heading?.textContent ?? null)).not.toBe('');
      // ONE action, drawn as a button of `Button.tsx`'s kinds, not a toggle.
      const actions = state.querySelectorAll('.oyl-button');
      expect(actions, `${route.id}: an empty state has one action`).toHaveLength(1);
      const [action] = actions;
      expect(action?.closest('.oyl-empty-state__action')).not.toBeNull();
      expect(action?.classList.contains('oyl-button--toggle')).toBe(false);
      expect(['A', 'BUTTON']).toContain(action?.tagName);
      // EXACTLY one primary on the empty page — #943's "primary, unless the
      // view already has a primary" — never at most one, which a view whose
      // only action had been made secondary passed with none (#987's review
      // found Segments so). The empty fixture opens no list–detail route at
      // two panes, so the page is one view here.
      const primaries = [...main.querySelectorAll(PRIMARY_BUTTON_SELECTOR)];
      expect(
        primaries.map((each) => normalise(each.textContent)),
        `${route.id}: an empty screen has exactly one primary`,
      ).toHaveLength(1);
    });
  }

  for (const route of ALL_ROUTES) {
    // Devices is not walked populated: the populated fixture opens it with no
    // Bluetooth, so the pairing panel (and its empty garage) never renders
    // there at all, and a green case would hold nothing.
    // `DevicesView.test.tsx` › "with a device paired, there is no empty
    // garage" is the case that holds it.
    if (EMPTY_STATES[route.id].kind !== 'empty-state' || route.id === 'devices') continue;
    it(`${route.id} (${route.path}), populated, shows no empty state`, async () => {
      mounted = await openRoute(route, true);
      expect(document.querySelector('main [data-oyl-empty-state]')).toBeNull();
    });
  }
});
