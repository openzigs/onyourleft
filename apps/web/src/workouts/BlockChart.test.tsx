// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The block chart as markup — #1043: decoration a screen reader never meets,
 * painted only through the classes `theme.css` declares, and a DOM that does
 * not grow with the workout.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  expandWorkout,
  MAXIMUM_REPEATS,
  MAXIMUM_SEGMENTS,
  seconds,
  thresholdShare,
  type WorkoutBlock,
} from '@onyourleft/domain';

import { colourLiteralIn } from '../design/illustration/rules-testing';
import { BAND_TOKENS } from '../design/tokens';
import { BLOCK_CHART_MAX_SHAPES } from './block-chart';
import { BLOCK_CHART_PAINTS, BlockChart } from './BlockChart';

function rendered(element: JSX.Element): Element | null {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(element);
  return holder.firstElementChild;
}

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

/** A block of every kind, in every band. */
const EVERYTHING: readonly WorkoutBlock[] = [
  { kind: 'free-ride', seconds: seconds(300) },
  { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.4), to: thresholdShare(1.6) },
  steady(120, 0.8),
  steady(120, 1.3),
];

const chartOf = (blocks: readonly WorkoutBlock[]): Element => {
  const svg = rendered(<BlockChart segments={expandWorkout({ name: 'test', blocks }).segments} />);
  if (svg === null) throw new Error('drew nothing');
  return svg;
};

const PAINT_CLASSES = new Set(BLOCK_CHART_PAINTS.map(({ className }) => className));

describe('the block chart — #1043', () => {
  it('is aria-hidden, not a tab stop, and carries no text', () => {
    const svg = chartOf(EVERYTHING);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.textContent).toBe('');
    expect(svg.querySelector('text, title, desc, foreignObject, image, use')).toBeNull();
  });

  it('draws every band, a free ride and the rule, each by a class and never a colour', () => {
    const svg = chartOf(EVERYTHING);
    const shapes = [...svg.querySelectorAll('*')];
    expect(shapes.map((shape) => shape.getAttribute('class')).sort()).toEqual(
      [...PAINT_CLASSES].sort(),
    );
    for (const element of [svg, ...shapes]) {
      for (const { name, value } of element.attributes) {
        expect(colourLiteralIn(value), `<${element.tagName} ${name}>`).toBeUndefined();
      }
    }
  });

  it('paints a block by the band its share falls in', () => {
    // 88 % is tempo (76 %–91 %); 95 % is threshold (91 %–106 %).
    const classes = [...chartOf([steady(300, 0.88), steady(300, 0.95)]).querySelectorAll('path')]
      .map((path) => path.getAttribute('class'))
      .filter((name) => name !== 'oyl-block-chart__rule');
    expect(classes).toEqual(['oyl-block-chart__band-tempo', 'oyl-block-chart__band-threshold']);
  });

  it('draws nothing at all for a workout with no blocks', () => {
    expect(rendered(<BlockChart segments={[]} />)).toBeNull();
  });

  it('is at most a fixed number of shapes for a workout at MAXIMUM_SEGMENTS', () => {
    const blocks: WorkoutBlock[] = [];
    for (let made = 0; made < MAXIMUM_SEGMENTS; made += 2 * MAXIMUM_REPEATS) {
      blocks.push({
        kind: 'intervals',
        repeats: MAXIMUM_REPEATS,
        hardSeconds: seconds(20),
        hardTarget: thresholdShare(1.2),
        easySeconds: seconds(40),
        easyTarget: thresholdShare(0.5),
      });
    }
    const svg = chartOf(blocks);
    expect(expandWorkout({ name: 'test', blocks }).segments).toHaveLength(MAXIMUM_SEGMENTS);
    // 300 000 seconds, 10 000 segments: still one path per band at most.
    expect(svg.querySelectorAll('*').length).toBeLessThanOrEqual(BLOCK_CHART_MAX_SHAPES);
    expect(svg.querySelectorAll('*').length).toBeGreaterThan(1);
  });
});

describe('the paint table and theme.css say the same thing', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'theme.css'),
    'utf8',
  ).replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const kebab = (camel: string): string =>
    camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const bodies = (className: string): readonly string[] =>
    [...css.matchAll(new RegExp(`(?:^|[{};])\\s*\\.${className}\\s*\\{([^{}]*)\\}`, 'g'))].map(
      ([, body]) => body ?? '',
    );

  it('paints band n with the nth band token', () => {
    expect(
      BLOCK_CHART_PAINTS.filter(({ property }) => property === 'fill').map(({ token }) => token),
    ).toEqual([...BAND_TOKENS]);
  });

  for (const { className, token, property } of BLOCK_CHART_PAINTS) {
    it(`.${className} sets ${property} to the ${token} token, in one rule`, () => {
      const found = bodies(className);
      expect(found).toHaveLength(1);
      const declarations = (found[0] ?? '')
        .split(';')
        .map((declaration) => declaration.trim().replaceAll(/\s+/g, ' '))
        .filter((declaration) => declaration !== '');
      const colours = declarations.filter((declaration) => /^(fill|stroke):/.test(declaration));
      expect(colours.sort()).toEqual(
        (property === 'fill'
          ? [`fill: var(--oyl-color-${kebab(token)})`]
          : ['fill: none', `stroke: var(--oyl-color-${kebab(token)})`]
        ).sort(),
      );
    });
  }

  it('names every .oyl-block-chart__ rule theme.css has', () => {
    const declared = new Set(
      [...css.matchAll(/\.(oyl-block-chart__[a-z0-9-]+)/g)].map(([, name]) => name),
    );
    expect(declared).toEqual(PAINT_CLASSES);
  });
});
