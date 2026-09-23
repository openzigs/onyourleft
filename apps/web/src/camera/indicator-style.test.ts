// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one thing about the indicator's stylesheet that can be checked without a
 * browser: that nothing this product draws is allowed to cover it.
 *
 * ⚠️ **This suite runs in the default `node` environment, and that is why it is
 * its own file.** Reading `theme.css` off disk needs `import.meta.url` to be a
 * `file:` URL, and in a DOM environment it is an `http:` one — the render cases
 * in `indicator.test.tsx` need a document, so these cannot live beside them.
 * `a11y/theme.a11y.test.ts` reads the same file for the same reason and is
 * likewise not a DOM suite.
 *
 * ⚠️ **And the environment is chosen by a DOCBLOCK TAG, which a file's own
 * prose can set by accident.** The first version of this file explained the
 * paragraph above by naming the tag, in the doc comment, in backticks — and
 * Vitest read it, ran the suite in a DOM, and failed with `TypeError: The URL
 * must be of scheme file` before a single case collected. It is exactly the
 * shape CLAUDE.md §4j records for `@unwired`: *"a paragraph saying the
 * exemption had been removed parsed as a live one"*. So the tag is not spelled
 * out anywhere in this file, and a future edit that explains it by quoting it
 * will break this suite again.
 *
 * ⚠️ **It is not the measurement.** A `z-index` says nothing about a stacking
 * context an ancestor's `transform`, `filter` or `opacity` would trap the
 * element inside, so `browser/shell.browser.spec.ts` hit-tests it in the pinned
 * Chromium with an element at the product's own maximum laid over the viewport.
 * This is the half that makes a rule added later at 999 a red build rather than
 * a silent covering.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

/**
 * The stylesheet with its comments removed.
 *
 * ⚠️ **Not decoration: this file's own rule is written about in `theme.css`'s
 * prose, in backticks, and the first version of this scan counted it.** The
 * indicator's `z-index: 30` appeared twice — once as a declaration and once as
 * an explanation of the declaration — and the "exactly one rule is at the top"
 * assertion went red against a stylesheet that was entirely correct. Same shape
 * as `privacy/no-network.test.ts` §"is not fooled by a comment that talks about
 * one", one language along.
 */
const css = themeCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet', () => {
  /** Every `z-index: <n>` in the stylesheet, as numbers. */
  function stackingOrders(): number[] {
    return [...css.matchAll(/z-index:\s*(-?\d+)/g)].map((match) => Number(match[1]));
  }

  it('finds stacking orders at all', () => {
    // The vacuous pass: a regular expression that matched nothing would make
    // "the indicator is the highest" true of an empty list.
    expect(stackingOrders().length).toBeGreaterThanOrEqual(4);
  });

  it('puts the indicator above everything else this product draws', () => {
    // ADR 0029 D-5. The next highest is the ride stage's 20, and the camera may
    // well be running *during* a ride — that is the arrangement the owner chose
    // — so losing to the stage would lose in the one state that matters.
    // Measured properly, with a hit test, in `browser/shell.browser.spec.ts`;
    // this is the half that says a rule added later at 999 is a red build.
    const orders = stackingOrders();
    const highest = Math.max(...orders);
    const indicatorRule = /\.oyl-camera-indicator\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
    expect(indicatorRule, 'the indicator declares no z-index').not.toBeNull();
    expect(Number(indicatorRule?.[1])).toBe(highest);
    // Strictly the only one at the top, so a second rule sharing the number —
    // where document order would then decide — is a red test too.
    expect(orders.filter((order) => order === highest)).toHaveLength(1);
  });

  it('is fixed to the viewport rather than to whatever has scrolled', () => {
    expect(/\.oyl-camera-indicator\s*\{[^}]*position:\s*fixed/.test(css)).toBe(true);
  });
});
