// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What #660's reflow walk asks of one route's measurement — moved out of
 * `reflow.browser.spec.ts` by #1128 so that ONE walk of a page can be judged by
 * both #660 and #666.
 *
 * `reflow.browser.spec.ts` and `controls-first.browser.spec.ts` both opened
 * `reflow.html` at a phone's 390×844, in the light palette, over the empty and
 * the populated fixtures, and visited every route of `ALL_ROUTES` — the same
 * page, the same query, the same palette and the same measurement, twice,
 * about 18 s of case time on the CI runner's EPYC 7763 (run 37244296171). Since
 * #1128 `controls-first`'s light phone walk is the one that runs, and it hands
 * every measurement to {@link reflowFaults} as well as to its own judgment;
 * `reflow.browser.spec.ts` skips that viewport in its light walk and names the
 * case that judges it. The DARK reflow walk (nightly since #1076) still walks
 * every viewport itself.
 */

import type { RouteDefinition } from '../src/shell/routes';

import type { ReflowMeasurement } from './reflow-harness';

/**
 * The viewport whose LIGHT reflow walk `controls-first.browser.spec.ts` runs
 * instead of `reflow.browser.spec.ts`, over both fixtures. Its cases are named
 * `… at a phone 390×844, <data>, and every route reflows (#660)`, and a reflow
 * fault fails them with the same sentence {@link reflowFaults} gives the
 * reflow walk. `controls-first` checks its phone IS this viewport at load, so
 * the two cannot drift apart and leave a viewport walked by neither.
 */
export const LIGHT_PHONE_WALKED_BY_CONTROLS_FIRST = { width: 390, height: 844 } as const;

/** Sub-pixel rounding in `scrollWidth`; a whole pixel is a real overflow. */
const SUBPIXEL_TOLERANCE = 0;

/**
 * Everything wrong with one route's measurement, as sentences. Empty is a pass.
 * The controls call this too, which is what makes them controls.
 */
export function reflowFaults(
  route: RouteDefinition,
  seen: ReflowMeasurement,
  populated: boolean,
): string[] {
  const faults: string[] = [];
  const where = `${route.id} at ${String(seen.viewport.width)}×${String(seen.viewport.height)}`;
  if (seen.routeId !== route.id) {
    faults.push(`${where}: opened ${seen.hash} and got the ${seen.routeId} route`);
  }
  if (seen.h1 !== route.title) {
    faults.push(`${where}: the h1 is "${seen.h1}", not "${route.title}"`);
  }
  if (!seen.settledWithinPatience) {
    faults.push(`${where}: the page did not settle`);
  }
  if (seen.documentOverflow > SUBPIXEL_TOLERANCE) {
    faults.push(
      `${where}: the document scrolls sideways by ${String(seen.documentOverflow)} px — widest is ${seen.widest}`,
    );
  }
  const expected = seen.expectation;
  if (expected === undefined) {
    faults.push(
      `${where}: reflow-harness.tsx §POPULATED says nothing about this route — name what its ` +
        'fixture puts on the page, or why nothing on it comes from one',
    );
  } else if (expected.kind === 'fixture' && seen.markerPresent !== populated) {
    faults.push(
      populated
        ? `${where}: the populated fixture did not reach the view (no ${expected.marker})`
        : `${where}: ${expected.marker} is on the EMPTY page, so it cannot tell the two walks apart`,
    );
  } else if (expected.kind === 'constant' && seen.markerPresent !== true) {
    faults.push(`${where}: ${expected.marker} is missing, and it does not depend on the fixtures`);
  }
  for (const error of seen.errors) {
    faults.push(`${where}: the page raised "${error}"`);
  }
  for (const box of seen.scrollBoxes) {
    if (!box.focusable || box.role !== 'region' || box.name === '') {
      faults.push(
        `${where}: ${box.description} scrolls sideways by ${String(box.overflow)} px and is not a ` +
          `focusable, named region (focusable ${String(box.focusable)}, role ${String(box.role)}, ` +
          `name "${box.name}")`,
      );
    }
  }
  return faults;
}

/** One route's margin, as the walk prints it: the spare width, and every box that scrolls. */
export function reflowMargin(route: RouteDefinition, seen: ReflowMeasurement): string {
  return (
    `${route.id}: ${seen.spare.toFixed(1)} px spare` +
    (seen.scrollBoxes.length === 0
      ? ''
      : ` (scroll boxes: ${seen.scrollBoxes.map((box) => `${box.description} +${String(box.overflow)}`).join(', ')})`)
  );
}
