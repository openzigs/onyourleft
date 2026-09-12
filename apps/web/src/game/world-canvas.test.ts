// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The game canvas has a size, and `theme.css` is where it comes from — #236.
 *
 * ## Why this test exists, and why it is shaped like this
 *
 * `GameView` gives its canvas `className="oyl-game__world"` and **no rule for
 * that class existed**, so the element took the HTML default intrinsic size of
 * 300x150 CSS pixels on every device. The renderer drew a correct scene into a
 * postage stamp beside a full-width HUD, and a rider reported the game as
 * showing no world at all.
 *
 * ⚠️ **The identical lesson was already in `theme.css`**, written for the ride
 * map one screen over: *"a WebGL canvas in a container with no height renders
 * zero pixels and looks exactly like a map that failed to load."* `.oyl-map`
 * carries a height and a width accordingly; the game canvas landed afterwards
 * with neither. This file is what stops that happening a third time.
 *
 * ## What this CANNOT check, stated so nobody mistakes a green run for proof
 *
 * ⚠️ **It does not check that the canvas is visible, or sized correctly, or
 * sized at all at runtime.** `CLAUDE.md` §4e: jsdom "performs no layout and
 * resolves no custom property". `clientWidth` is `0` for every element in the
 * suite, so a sized canvas and an unsized one are indistinguishable here — which
 * is precisely why the defect survived a suite that renders this route.
 *
 * What it does check is that the **declaration has not been deleted**, which is
 * the failure that actually happened. The real gate belongs in the browser
 * gate (§4f) measuring `GameView`'s own canvas in a live engine; today
 * `game.browser.spec.ts` supplies its own canvas and so cannot see this.
 * #236 carries that as an acceptance criterion.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

/** The rule body for one class selector, or `undefined` when it has none. */
function ruleFor(selector: string): string | undefined {
  const at = themeCss.indexOf(`${selector} {`);
  if (at === -1) {
    return undefined;
  }
  const opened = themeCss.indexOf('{', at);
  const closed = themeCss.indexOf('}', opened);
  return closed === -1 ? undefined : themeCss.slice(opened + 1, closed);
}

describe('the trainer game canvas is sized by the stylesheet', () => {
  it('has a rule at all, which is the thing that was missing', () => {
    expect(ruleFor('.oyl-game__world')).toBeDefined();
  });

  it('states a width, because a canvas does not take one from its parent', () => {
    expect(ruleFor('.oyl-game__world') ?? '').toMatch(/\bwidth:/);
  });

  it('states a height, or something that determines one', () => {
    // `aspect-ratio` is a height given a width, and is what this canvas uses —
    // it is ridden on a phone on a handlebar and on a tablet, in both
    // orientations, where the map's fixed `height` would be wrong. Accepting
    // either keeps the assertion about the property that matters rather than
    // about the technique.
    expect(ruleFor('.oyl-game__world') ?? '').toMatch(/\b(height|aspect-ratio):/);
  });

  it('is a block, because an inline canvas sits on a text baseline', () => {
    expect(ruleFor('.oyl-game__world') ?? '').toMatch(/\bdisplay:\s*block\b/);
  });

  it('keeps the rule the map learned this from, so the pair cannot drift apart', () => {
    // If `.oyl-map` ever loses its sizing, the comment this file cites as
    // precedent has stopped being true and somebody should find that out here.
    const map = ruleFor('.oyl-map') ?? '';
    expect(map).toMatch(/\bheight:/);
    expect(map).toMatch(/\bwidth:/);
  });
});
