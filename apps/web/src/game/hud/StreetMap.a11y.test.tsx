// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The street map, readable at arm's length — #2290.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it. What is asserted is
 * SC 1.1.1 (the picture has a sentence), SC 1.4.11 (the route against every
 * fill it crosses, and the rider's mark against the route and the land, at
 * 3:1) and the plan view's own size floor for the mark — each read off the
 * rendered SVG, whose colours are attributes, and `theme.css` for the mark's,
 * which is the plan view's class.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../../design/contrast';
import { paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import { UnitsProvider } from '../../units/context';
import { PLAN_SMALLEST_PIXELS, RIDER_MARK_MINIMUM_PIXELS, RIDER_MARK_RING_PIXELS } from './plan';
import { STREET_MAP_PAINTS, StreetMap } from './StreetMap';
import { STREET_MAP_METRES } from './street-map';
import { northCorridor, northRoute } from './street-map-testing';

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function rendered(): Promise<HTMLElement> {
  mounted = await mount(
    <StreetMap corridor={northCorridor()} profile={northRoute()} distance={300} />,
  );
  return mounted.container;
}

function layer(root: HTMLElement, name: string): Element {
  const found = root.querySelector(`[data-oyl-street-map="${name}"]`);
  if (found === null) throw new Error(`no ${name} layer`);
  return found;
}

describe('the street map is a picture with a sentence — #2290', () => {
  it('is one image, named, in the plan view’s box, with its shapes hidden', async () => {
    const root = await rendered();
    const svg = root.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(
      'Street map around you, north up, about 1.0 kilometres from top to bottom, with the route ' +
        'on it. You are 20 per cent of the way along the route.',
    );
    // The class every layout sizes the plan view by, phones' give-way rules included.
    expect(svg?.classList.contains('oyl-hud__plan-svg')).toBe(true);
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(root.querySelector('svg > g')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says the span in the rider’s own units', async () => {
    mounted = await mount(
      <UnitsProvider units="imperial">
        <StreetMap corridor={northCorridor()} profile={northRoute()} distance={300} />
      </UnitsProvider>,
    );
    expect(mounted.container.querySelector('svg')?.getAttribute('aria-label')).toContain(
      'about 0.6 miles from top to bottom',
    );
  });
});

describe('the street map is drawn to be read at arm’s length — #2290', () => {
  it(`draws the rider’s mark at least ${String(RIDER_MARK_MINIMUM_PIXELS)} px across in the smallest box`, async () => {
    const root = await rendered();
    const mark = root.querySelector('circle');
    expect(mark?.classList.contains('oyl-hud__plan-here')).toBe(true);
    const across = (2 * Number(mark?.getAttribute('r')) * PLAN_SMALLEST_PIXELS) / STREET_MAP_METRES;
    expect(across).toBeGreaterThanOrEqual(RIDER_MARK_MINIMUM_PIXELS);
    expect(Number(mark?.getAttribute('stroke-width'))).toBe(RIDER_MARK_RING_PIXELS);
    // In the middle of the view, which is where the rider is.
    const [x, y, width, height] = (root.querySelector('svg')?.getAttribute('viewBox') ?? '')
      .split(' ')
      .map(Number);
    expect(Number(mark?.getAttribute('cx'))).toBe((x ?? 0) + (width ?? 0) / 2);
    expect(Number(mark?.getAttribute('cy'))).toBe((y ?? 0) + (height ?? 0) / 2);
  });

  it('paints each layer as STREET_MAP_PAINTS says, the route widest and on top', async () => {
    const root = await rendered();
    expect(layer(root, 'land').getAttribute('fill')).toBe(STREET_MAP_PAINTS.land.fill);
    expect(layer(root, 'water').getAttribute('fill')).toBe(STREET_MAP_PAINTS.water.fill);
    for (const name of ['streets', 'paths', 'route'] as const) {
      expect(layer(root, name).getAttribute('stroke')).toBe(STREET_MAP_PAINTS[name].stroke);
      expect(Number(layer(root, name).getAttribute('stroke-width'))).toBe(
        STREET_MAP_PAINTS[name].width,
      );
      expect(layer(root, name).getAttribute('class')).toBe('oyl-hud__street-map-line');
    }
    expect(STREET_MAP_PAINTS.route.width).toBeGreaterThanOrEqual(3);
    // Last but the mark: the route is drawn over every street.
    const drawn = [...root.querySelectorAll('path')].map((path) =>
      path.getAttribute('data-oyl-street-map'),
    );
    expect(drawn.at(-1)).toBe('route');
  });

  it('keeps every line its stated width in screen pixels, whatever the box', () => {
    const rule = /\.oyl-hud__street-map-line\s*\{([^{}]*)\}/.exec(themeCss)?.[1] ?? '';
    expect(rule).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(rule).not.toMatch(/stroke(-width)?:/);
  });

  it('meets 3:1 for the route on every fill, and for the mark on the route and the land', () => {
    // The panel's own surface shows where the corridor holds no tile.
    for (const theme of THEMES) {
      const hud = paletteColours(theme);
      const fills = {
        'the panel': hud.hudSurface,
        land: STREET_MAP_PAINTS.land.fill,
        water: STREET_MAP_PAINTS.water.fill,
        'a street': STREET_MAP_PAINTS.streets.stroke,
      };
      const route = STREET_MAP_PAINTS.route.stroke;
      for (const [what, fill] of Object.entries(fills)) {
        expect(contrastRatio(route, fill), `the route on ${what}, ${theme}`).toBeGreaterThanOrEqual(
          AA_LARGE_TEXT_OR_NON_TEXT,
        );
        // The mark's disc wherever the rider is off the route's line.
        expect(
          contrastRatio(hud.hudInk, fill),
          `the mark's disc on ${what}, ${theme}`,
        ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
      }
      // On the route, the ring is what separates the mark from the line.
      expect(
        contrastRatio(hud.hudSurface, route),
        `the ring on the route, ${theme}`,
      ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
    }
  });
});
