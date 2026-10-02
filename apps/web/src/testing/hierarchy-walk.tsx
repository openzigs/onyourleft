// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One route of #668's one-primary walk, as a function — so the walk over the
 * real route table and its control (a route whose view draws two primaries)
 * go through exactly the same path: the hash, the real `AppShell` over
 * `populated-shell.tsx`'s fixtures, the settle, the marker check and
 * `a11y/button-hierarchy.ts` §`buttonHierarchyViolations` (one primary per
 * view, and since #1002 no danger button outside a modal dialog).
 *
 * Test support: it calls `expect`, and is imported only by tests.
 */

import { expect } from 'vitest';

import {
  buttonHierarchyViolations,
  buttonsByView,
  type ViewButtons,
} from '../a11y/button-hierarchy';
import type { RideController } from '../ride/controller';
import { hrefFor, hrefForSelection, type RouteDefinition } from '../shell/routes';

import { mount, settle, type Mounted } from './mount';
import {
  PARAMETERS,
  POPULATED,
  SELECTIONS,
  PopulatedShell,
  seedRouteDraft,
  type PopulatedShellExtras,
} from './populated-shell';

function hashFor(route: RouteDefinition): string {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = PARAMETERS[route.id];
  if (parameter === undefined) {
    throw new Error(`${route.id} is parameterised and populated-shell.tsx names no fixture id`);
  }
  return hrefFor(route, parameter);
}

/** Settle until the page stops changing, because every view reads a port. */
async function settled(): Promise<void> {
  let before = '';
  for (let round = 0; round < 40; round += 1) {
    await settle();
    const now = document.body.innerHTML;
    if (now === before) return;
    before = now;
  }
}

/** Open `route` in the real shell over the empty or the populated fixture. */
export async function openRoute(
  route: RouteDefinition,
  populated: boolean,
  rideController?: RideController,
  extras: Omit<PopulatedShellExtras, 'rideController'> = {},
): Promise<Mounted> {
  globalThis.location.hash = hashFor(route);
  const mounted = await mount(
    <PopulatedShell
      populated={populated}
      {...extras}
      {...(rideController === undefined ? {} : { rideController })}
    />,
  );
  await settled();
  // #864: the populated fixture writes the route builder's draft into
  // `localStorage` as it renders (`seedRouteDraft`), and nothing took it away,
  // so a later test in the same file — one that mounts the route builder
  // itself, say — found a draft it never wrote. Unmounting takes it away.
  return {
    container: mounted.container,
    caughtErrors: mounted.caughtErrors,
    rerender: (next) => mounted.rerender(next),
    unmount: () => {
      mounted.unmount();
      seedRouteDraft(false, localStorage);
    },
  };
}

/**
 * Choose the populated fixture's item on a `list-detail` route that is already
 * open — #670 — by moving the hash, as a link would, and settle. `false` for a
 * route with no selection or no fixture item to select.
 */
export async function selectFixtureItem(route: RouteDefinition): Promise<boolean> {
  const id = SELECTIONS[route.id];
  if (route.selection === undefined || id === undefined) {
    return false;
  }
  globalThis.location.hash = hrefForSelection(route, id);
  globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
  await settled();
  return true;
}

/** What one route of the walk found. */
export interface WalkedRoute {
  readonly mounted: Mounted;
  readonly views: readonly ViewButtons[];
  readonly violations: readonly string[];
}

/**
 * Open `route`, check it reached the view its fixture says it should, and
 * return what the one-primary rule found. The caller unmounts.
 */
export async function walkRoute(route: RouteDefinition, populated: boolean): Promise<WalkedRoute> {
  const mounted = await openRoute(route, populated);
  expect(document.querySelector('h1')?.textContent).toBe(route.title);

  const expectation = POPULATED[route.id];
  if (expectation.kind === 'fixture') {
    expect(
      document.querySelector(expectation.marker) !== null,
      `${route.id}: the fixture marker ${expectation.marker} should be ` +
        (populated ? 'present' : 'absent'),
    ).toBe(populated);
  }

  const views = buttonsByView(document);
  expect(views, 'the shell renders exactly one main').toHaveLength(1);
  return { mounted, views, violations: buttonHierarchyViolations(document) };
}
