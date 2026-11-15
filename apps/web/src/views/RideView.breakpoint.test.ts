// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride screen's upright two-column breakpoint — PR #2413's review.
 *
 * `theme.css` puts `.oyl-ride` in two columns on an upright tablet 48 rem wide
 * and 60 rem tall or more (#692), and a second rule places the Live group
 * beside the trainer group under the same condition. #2387's follow-up moved
 * the first to 64 rem by accident and no gate saw it: #740's browser cases sit
 * at 1024 px, past both edges. So the two rules are held to the one condition
 * here, statically; what the layout measures is `rideview.browser.spec.ts`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const THEME = readFileSync(
  join(import.meta.dirname, '..', 'design', 'theme.css'),
  'utf8',
).replaceAll(/\/\*[\s\S]*?\*\//g, '');

/** The condition of the `@media` rule whose first rule opens with `selector {` and `body`. */
function mediaOf(selector: string, body = ''): string | undefined {
  const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`@media ([^{]+)\\{\\s*${escape(selector)} \\{\\s*${escape(body)}`);
  return pattern.exec(THEME)?.[1]?.trim();
}

/** #692's upright condition. */
const UPRIGHT = '(min-width: 48rem) and (min-height: 60rem)';

describe('the Ride screen upright (#692)', () => {
  it('is two columns from 48 rem wide and 60 rem tall', () => {
    expect(mediaOf('.oyl-ride', 'grid-template-columns: repeat(2, minmax(0, 1fr));')).toBe(
      `(min-width: 60rem), ${UPRIGHT}`,
    );
  });

  it('places the Live group beside the trainer group under the same condition', () => {
    expect(mediaOf('.oyl-ride:has(> .oyl-ride__group--graph) > .oyl-ride__group--live')).toBe(
      `${UPRIGHT} and (max-width: 59.99rem)`,
    );
  });
});
