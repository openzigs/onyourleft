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

import { FONT_SIZE_TOKENS } from '../design/tokens';
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

describe('a ride metric is legible from two metres', () => {
  it('declares the metric size at or above the stated minimum', () => {
    expect(remOf(FONT_SIZE_TOKENS.metric)).toBeGreaterThanOrEqual(MINIMUM_PRIMARY_METRIC_REM);
  });

  it('is bigger than the largest heading, which is the size it would otherwise inherit', () => {
    // The failure this catches is not "somebody set it to 1rem". It is
    // "somebody deleted the token and let the metric fall back to a heading
    // size", which looks deliberate in a diff.
    expect(remOf(FONT_SIZE_TOKENS.metric)).toBeGreaterThan(remOf(FONT_SIZE_TOKENS.xl));
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
