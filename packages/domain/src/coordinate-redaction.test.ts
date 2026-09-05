// SPDX-License-Identifier: Apache-2.0

/**
 * Every coordinate constructor redacts the value, including ones added later.
 *
 * #104 applied ADR 0004 decision D through `received()` in `unit-error.ts`, and
 * the pull request claimed that "a coordinate quantity added later inherits the
 * rule". The #144 review showed that is true only for the four shared guards:
 * `degreesCelsius` and `kilograms` already build their `UnitError` messages
 * inline, and a future coordinate written in that established style would leak
 * its value with nothing to catch it.
 *
 * This closes the gap the only way a convention can be closed — by enumerating
 * the package's own exports rather than a list someone has to remember to
 * update. A new constructor whose name carries `latitude` or `longitude` is
 * picked up here automatically; one written in the inline style fails.
 *
 * Why it matters is not academic. `SECURITY.md` puts location leaked through an
 * **error message** in scope, and an error string reaches logs, toasts and
 * crash reports that the coordinate itself never does. `614507218.4`
 * semicircles is 51.5074°N to sub-centimetre precision — someone's front door.
 */

import { describe, expect, it } from 'vitest';

import * as domain from './index';

/**
 * Values chosen so that at least one throws for any plausible coordinate
 * constructor, and so that each is recognisable in a string if it leaks.
 *
 * Deliberately not round numbers: `91` appears in unrelated prose and in the
 * bounds of a constraint, which a message is *allowed* to name. A long decimal
 * cannot arrive by coincidence.
 */
const POISON = [91.2345678, 181.2345678, 3_000_000_000.5, -181.2345678];

/** Exported functions whose name says they take or make a coordinate. */
function coordinateConstructors(): [string, (value: number) => unknown][] {
  const found: [string, (value: number) => unknown][] = [];
  for (const [name, value] of Object.entries(domain) as [string, unknown][]) {
    if (typeof value !== 'function') continue;
    if (value.length !== 1) continue;
    if (!/latitude|longitude/i.test(name)) continue;
    // The export union is far too wide for a type predicate to narrow, and a
    // predicate that lied here would silently drop constructors -- which is the
    // exact vacuity this file guards against. Checked at runtime instead, and
    // the count assertion below is what proves the check found anything.
    found.push([name, value as (value: number) => unknown]);
  }
  return found;
}

describe('the ADR 0004 coordinate-message rule', () => {
  it('has coordinate constructors to check, so this suite cannot pass vacuously', () => {
    // If the export surface is renamed and this filter stops matching, every
    // assertion below runs zero times and the file goes green having tested
    // nothing. That is the failure mode this whole test exists to prevent, so
    // it is asserted rather than assumed.
    expect(coordinateConstructors().length).toBeGreaterThanOrEqual(4);
  });

  for (const [name, construct] of coordinateConstructors()) {
    it(`${name} never names the value it rejected`, () => {
      let threw = 0;
      for (const poison of POISON) {
        let message: string | undefined;
        try {
          construct(poison);
        } catch (error) {
          threw += 1;
          message = error instanceof Error ? error.message : String(error);
        }
        if (message === undefined) continue;
        // The digits, in any spelling a formatter might choose.
        expect(message).not.toContain(String(poison));
        expect(message).not.toContain(String(Math.abs(poison)));
        expect(message).not.toMatch(/\d{3,}\.\d{3,}/);
      }
      // A constructor that accepts every poison value is not exercising the
      // guard at all, and would pass this test while redacting nothing.
      expect(threw).toBeGreaterThan(0);
    });
  }
});
