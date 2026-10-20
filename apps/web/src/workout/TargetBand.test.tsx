// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The block's target band as markup — #1434: a gauge named by every number
 * it is drawn from, marks placed where `target-band.ts` says, the words for
 * in, under and over beside it, and paint only through `theme.css`'s classes.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { seconds, thresholdShare } from '@onyourleft/domain';

import { colourLiteralIn } from '../design/illustration/rules-testing';

import { ERG_CUE, targetBand, targetBandWords, type TargetBandInput } from './target-band';
import { TARGET_BAND_PAINTS, TargetBand } from './TargetBand';

function rendered(workout: TargetBandInput): Element {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(<TargetBand workout={workout} />);
  return holder;
}

const input = (power: number, overrides: Partial<TargetBandInput> = {}): TargetBandInput => ({
  elapsedSeconds: 100,
  status: 'running',
  holdingWatts: 200,
  hasControl: true,
  targetConfirmed: true,
  timeline: {
    segments: [
      {
        startsAt: seconds(0),
        endsAt: seconds(600),
        from: thresholdShare(0.8),
        to: thresholdShare(0.8),
      },
    ],
    totalSeconds: 600,
  },
  trace: [98, 99, 100].map((at) => ({
    at,
    target: 200,
    power,
    heartRate: undefined,
    range: undefined,
  })),
  live: { power, heartRate: undefined, cadence: 90 },
  blockAverageWatts: 195,
  ...overrides,
});

describe('the target band on the Ride screen — #1434', () => {
  it.each([
    [200, 'in', 'In the band'],
    [170, 'under', '20 W under the band'],
    [230, 'over', '20 W over the band'],
  ] as const)('at %i W says %s in words, beside the gauge', (power, standing, words) => {
    const root = rendered(input(power));
    expect(root.querySelector('[data-oyl-target-band]')?.getAttribute('data-oyl-target-band')).toBe(
      standing,
    );
    expect(root.textContent).toContain(words);
    expect(root.textContent).toContain('Target 200 W, ride 190–210 W');
    expect(root.textContent).toContain('8:20 left in this block');
    expect(root.textContent).toContain('Block average 195 W');
    expect(root.textContent).toContain(ERG_CUE);
  });

  it('names the gauge with every number it is drawn from', () => {
    const workout = input(200);
    const band = targetBand(workout);
    if (band === undefined) throw new Error('no band');
    const gauge = rendered(workout).querySelector('[role="img"]');
    expect(gauge?.getAttribute('aria-label')).toBe(targetBandWords(band).name);
  });

  it('draws the band, the 3 s power and the average where the numbers put them', () => {
    const root = rendered(input(250));
    const style = (selector: string): string =>
      root.querySelector(selector)?.getAttribute('style') ?? '';
    // A 100–300 W scale: the band 190–210, power 250, average 195.
    expect(style('.oyl-target-band__band')).toContain('left:45.00%');
    expect(style('.oyl-target-band__band')).toContain('width:10.00%');
    expect(style('[data-oyl-mark="power"]')).toContain('left:75.00%');
    expect(style('[data-oyl-mark="average"]')).toContain('left:47.50%');
  });

  it('draws no mark it has no number for', () => {
    const root = rendered(
      input(200, {
        blockAverageWatts: undefined,
        live: { power: undefined, heartRate: undefined },
      }),
    );
    expect(root.querySelector('[data-oyl-mark="power"]')).toBeNull();
    expect(root.querySelector('[data-oyl-mark="average"]')).toBeNull();
    expect(root.textContent).toContain('No power reading');
  });

  it('warns of a low cadence under load, and only then', () => {
    const low = rendered(input(200, { live: { power: 200, heartRate: undefined, cadence: 58 } }));
    expect(low.textContent).toContain('58 rpm under load. Spin faster now');
    expect(rendered(input(200)).textContent).not.toContain('Spin faster');
  });

  it('renders nothing where there is no band', () => {
    expect(rendered(input(200, { status: 'paused' })).innerHTML).toBe('');
  });

  it('paints by class and never by a colour of its own', () => {
    const root = rendered(input(200));
    const known = new Set(TARGET_BAND_PAINTS.map(({ className }) => className));
    for (const element of root.querySelectorAll('[class^="oyl-target-band__"]')) {
      for (const { name, value } of element.attributes) {
        if (name === 'aria-label') continue;
        expect(colourLiteralIn(value), `<${element.tagName} ${name}>`).toBeUndefined();
      }
    }
    for (const name of known) {
      expect(root.querySelector(`.${name}`), name).not.toBeNull();
    }
  });
});

describe('the band’s paint table and theme.css say the same thing — #1434', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'theme.css'),
    'utf8',
  ).replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const kebab = (camel: string): string =>
    camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const body = (className: string): string =>
    [...css.matchAll(new RegExp(`(?:^|[{};])\\s*\\.${className}\\s*\\{([^{}]*)\\}`, 'g'))]
      .map(([, found]) => found ?? '')
      .join(';');

  for (const { className, token, property } of TARGET_BAND_PAINTS) {
    it(`.${className} paints its ${property} with the ${token} token`, () => {
      expect(body(className)).toMatch(
        new RegExp(
          `(?:^|;)\\s*(?:${property}|border(?:-bottom)?):[^;]*var\\(--oyl-color-${kebab(token)}\\)`,
        ),
      );
    });
  }

  it('names every colour the band’s rules paint', () => {
    const painted = [...css.matchAll(/\.(oyl-target-band__[a-z-]+)\s*\{([^{}]*)\}/g)].flatMap(
      ([, name, found]) =>
        [...(found ?? '').matchAll(/var\(--oyl-color-([a-z-]+)\)/g)].map(
          ([, token]) => `${name ?? ''} ${token ?? ''}`,
        ),
    );
    expect(new Set(painted)).toEqual(
      new Set(TARGET_BAND_PAINTS.map(({ className, token }) => `${className} ${kebab(token)}`)),
    );
  });
});
