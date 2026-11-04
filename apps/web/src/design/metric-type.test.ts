// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2041, ADR 0063 D-5 — the metric type: `theme.css` sets every number class
 * in one face, one weight and tabular figures, in ONE rule, and that rule is
 * `tokens.ts` §`METRIC_TYPE` over §`METRIC_TYPE_SELECTORS`.
 *
 * What the browser paints (Barlow resolved, the digits one width, the cap
 * height) is `browser/metric-numerals.browser.spec.ts`; this is the static
 * half, which runs without a layout engine.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { METRIC_TYPE, METRIC_TYPE_SELECTORS } from './tokens';

const THEME = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8');
const SOURCE = (path: string): string =>
  readFileSync(join(import.meta.dirname, '..', path), 'utf8');

/** Every top-level rule in a stylesheet with its comments removed: selector list and body. */
function rules(css: string): readonly { readonly selectors: string[]; readonly body: string }[] {
  const plain = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => !(match[1] ?? '').trim().startsWith('@'))
    .map((match) => ({
      selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
      body: match[2] ?? '',
    }));
}

/** A rule body's declarations, property to value. */
function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(';')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      }),
  );
}

describe('the metric type — #2041, ADR 0063 D-5', () => {
  const metric = rules(THEME).filter(
    (rule) =>
      rule.selectors.length === METRIC_TYPE_SELECTORS.length &&
      METRIC_TYPE_SELECTORS.every((selector) => rule.selectors.includes(selector)),
  );

  it('is one rule in theme.css over exactly the number classes', () => {
    expect(metric).toHaveLength(1);
  });

  it('declares the display face at 700 with tabular figures, and nothing else', () => {
    expect(declarations(metric[0]?.body ?? '')).toEqual(METRIC_TYPE);
    expect(METRIC_TYPE['font-family']).toBe('var(--oyl-font-family-display)');
    expect(METRIC_TYPE['font-variant-numeric']).toBe('tabular-nums');
  });

  it('is undone by no later rule that sets a number class in another face or proportional figures', () => {
    // A rule naming one of the classes and a different family or figures
    // would quietly take that class back out of the metric type.
    const conflicts = rules(THEME)
      .filter((rule) =>
        rule.selectors.some((selector) =>
          METRIC_TYPE_SELECTORS.some((number) => selector.endsWith(number)),
        ),
      )
      .flatMap((rule) => {
        const declared = declarations(rule.body);
        return [
          ...(declared['font-family'] !== undefined &&
          declared['font-family'] !== METRIC_TYPE['font-family']
            ? [`${rule.selectors.join(', ')}: font-family ${declared['font-family']}`]
            : []),
          ...(declared['font-variant-numeric'] !== undefined &&
          declared['font-variant-numeric'] !== METRIC_TYPE['font-variant-numeric']
            ? [
                `${rule.selectors.join(', ')}: font-variant-numeric ${declared['font-variant-numeric']}`,
              ]
            : []),
        ];
      });
    expect(conflicts).toEqual([]);
  });

  it.each([
    ['design/Reading.tsx', '.oyl-reading__value'],
    ['game/hud/HudCore.tsx', '.oyl-hud__value'],
    ['views/AnalysisView.tsx', '.oyl-metric__value'],
  ])('%s sets its numbers in %s', (path, selector) => {
    expect(SOURCE(path)).toContain(selector.slice(1));
    expect(METRIC_TYPE_SELECTORS).toContain(selector);
  });
});
