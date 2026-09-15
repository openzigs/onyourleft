// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #49's eighth acceptance criterion, second half: *"the primary metrics are
 * legible at a stated minimum size — this screen is read from two metres away."*
 *
 * The stated size is `MINIMUM_PRIMARY_METRIC_REM` in `ride/MetricGrid.tsx`. It
 * is checked here rather than in that file's own test for the reason
 * `theme.a11y.test.ts` exists at all: a constant in TypeScript is not what the
 * browser paints. `theme.css` is what paints, so this reads the stylesheet.
 *
 * jsdom performs no layout and resolves no custom property, so there is no way
 * to assert a *rendered* size in this suite; the honest check is the declared
 * one, plus the join between the declaration and the element that uses it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FONT_SIZE_TOKENS, TYPE_SCALE_STEPS } from '../design/tokens';
import { MINIMUM_PRIMARY_METRIC_REM } from '../ride/MetricGrid';

const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

/** `'4rem'` → `4`. Anything not in `rem` fails rather than being guessed at. */
function remOf(value: string): number {
  const match = /^([\d.]+)rem$/.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new Error(
      `the metric font size is "${value}", which is not a rem. A px value does not scale with ` +
        "the reader's own font size, which is the first thing somebody with poor eyesight changes.",
    );
  }
  return Number(match[1]);
}

/**
 * The largest size the type scale gives a heading, **derived** rather than
 * named.
 *
 * ⚠️ Naming one is how this assertion quietly stopped meaning what it says.
 * The test below compared the metric against `xl`, which was the top of the
 * scale when it was written; #307 added `xxl` above it and the comparison went
 * on passing against a size that is no longer the largest heading. Nobody
 * edited the test, and that is the point — a hard-coded token name narrows
 * silently when the scale grows.
 *
 * `metric` is excluded because it is the thing under test. Every other step is
 * a reading size (`TYPE_SCALE_STEPS` requires them to be contiguous rungs), so
 * the largest of them is the size the metric would fall back to if its own
 * token were deleted — which is the failure this guards.
 */
function largestHeadingRem(): number {
  const headings = Object.keys(TYPE_SCALE_STEPS).filter((name) => name !== 'metric');
  if (headings.length === 0) {
    throw new Error('the type scale has no reading sizes, so there is nothing to compare against');
  }
  return Math.max(
    ...headings.map((name) => remOf(FONT_SIZE_TOKENS[name as keyof typeof FONT_SIZE_TOKENS])),
  );
}

describe('a ride metric is legible from two metres', () => {
  it('declares the metric size at or above the stated minimum', () => {
    expect(remOf(FONT_SIZE_TOKENS.metric)).toBeGreaterThanOrEqual(MINIMUM_PRIMARY_METRIC_REM);
  });

  it('is bigger than the largest heading, which is the size it would otherwise inherit', () => {
    // The failure this catches is not "somebody set it to 1rem". It is
    // "somebody deleted the token and let the metric fall back to a heading
    // size", which looks deliberate in a diff.
    expect(remOf(FONT_SIZE_TOKENS.metric)).toBeGreaterThan(largestHeadingRem());
  });

  it('is the size the stylesheet actually gives the value element', () => {
    // The join. Without it the token could be 4rem and `.oyl-metric__value`
    // could carry `--oyl-font-size-md`, and both of the assertions above would
    // still pass.
    const rule = /\.oyl-metric__value\s*\{[^}]*\}/.exec(themeCss)?.[0] ?? '';
    expect(rule, 'theme.css has no .oyl-metric__value rule').not.toBe('');
    expect(rule).toContain('font-size: var(--oyl-font-size-metric)');
  });

  it('uses tabular figures, so a changing number does not shift the layout', () => {
    // Not cosmetic at 1 Hz: proportional digits make a power number jitter
    // sideways every second, which is unreadable from two metres and is the
    // kind of thing nobody diagnoses.
    const rule = /\.oyl-metric__value\s*\{[^}]*\}/.exec(themeCss)?.[0] ?? '';
    expect(rule).toContain('font-variant-numeric: tabular-nums');
  });
});
