// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The street map, readable at arm's length — #2290.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it. What is asserted is
 * SC 1.1.1 (the picture has a sentence), SC 1.4.11 (each line a rider has to
 * tell apart from what it is drawn on, at 3:1, each one a pair `tokens.ts`
 * declares) and the plan view's own size floor for the mark — each read off
 * the rendered SVG, whose widths are attributes, and `theme.css`, whose rules
 * paint each layer's class (read as a file: jsdom resolves no custom
 * property). `STREET_MAP_PAINTS` is the table between the two and is held to
 * both, as `PlanTrace.a11y.test.tsx` holds `PLAN_PAINTS`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../../design/contrast';
import {
  CONTRAST_REQUIREMENTS,
  paletteColours,
  THEMES,
  type ColourToken,
} from '../../design/tokens';
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

/** The declarations of every rule whose LAST compound selector is exactly `.className`. */
function bodiesFor(className: string): readonly string[] {
  return [
    ...themeCss.matchAll(
      new RegExp(`(?:^|[{};])\\s*([^{};]*\\.${className})\\s*\\{([^{}]*)\\}`, 'g'),
    ),
  ].map(([, , body]) => body ?? '');
}

/** Whether `tokens.ts` declares this pair, either way round, at 3:1 or more. */
function declared(a: ColourToken, b: ColourToken): boolean {
  return CONTRAST_REQUIREMENTS.some(
    (requirement) =>
      requirement.minimum >= AA_LARGE_TEXT_OR_NON_TEXT &&
      ((requirement.foreground === a && requirement.background === b) ||
        (requirement.foreground === b && requirement.background === a)),
  );
}

const kebab = (camel: string): string =>
  camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

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
    for (const name of ['land', 'water'] as const) {
      expect(layer(root, name).getAttribute('class')).toBe(STREET_MAP_PAINTS[name].className);
      // Painted by the class alone: an attribute would be a colour no gate reads.
      expect(layer(root, name).hasAttribute('fill')).toBe(false);
    }
    const lines = {
      streets: 'streets',
      paths: 'paths',
      routeEdge: 'route-edge',
      route: 'route',
    } as const;
    for (const [name, attribute] of Object.entries(lines) as [keyof typeof lines, string][]) {
      const element = layer(root, attribute);
      expect(element.getAttribute('class')).toBe(
        `oyl-hud__street-map-line ${STREET_MAP_PAINTS[name].className}`,
      );
      expect(Number(element.getAttribute('stroke-width'))).toBe(STREET_MAP_PAINTS[name].width);
      expect(element.hasAttribute('stroke')).toBe(false);
    }
    // The owner's ruling of 2026-11-06: the streets and paths a little wider than 2 and 1.
    expect(STREET_MAP_PAINTS.streets.width).toBeGreaterThan(2);
    expect(STREET_MAP_PAINTS.paths.width).toBeGreaterThan(1);
    expect(STREET_MAP_PAINTS.route.width).toBeGreaterThan(STREET_MAP_PAINTS.streets.width);
    expect(STREET_MAP_PAINTS.routeEdge.width).toBeGreaterThanOrEqual(
      STREET_MAP_PAINTS.route.width + 2 * RIDER_MARK_RING_PIXELS,
    );
    // The route is drawn over every street, on its casing, and the same line as it.
    const drawn = [...root.querySelectorAll('path')].map((path) =>
      path.getAttribute('data-oyl-street-map'),
    );
    expect(drawn.slice(-2)).toEqual(['route-edge', 'route']);
    expect(layer(root, 'route-edge').getAttribute('d')).toBe(
      layer(root, 'route').getAttribute('d'),
    );
    expect(layer(root, 'streets').getAttribute('d')).not.toBe('');
  });

  for (const [name, paint] of Object.entries(STREET_MAP_PAINTS)) {
    it(`theme.css paints ${name} (.${paint.className}) as STREET_MAP_PAINTS says, in one rule`, () => {
      const found = bodiesFor(paint.className);
      expect(found).toHaveLength(1);
      const colours = (found[0] ?? '')
        .split(';')
        .map((declaration) => declaration.trim().replaceAll(/\s+/g, ' '))
        .filter((declaration) => /^(fill|stroke):/.test(declaration))
        .sort();
      const wanted = (property: 'fill' | 'stroke', token: ColourToken | 'none'): string[] =>
        token === 'none'
          ? property === 'fill'
            ? ['fill: none']
            : []
          : [`${property}: var(--oyl-color-${kebab(token)})`];
      expect(colours).toEqual(
        [...wanted('fill', paint.fill), ...wanted('stroke', paint.stroke)].sort(),
      );
    });
  }

  it('keeps every line its stated width in screen pixels, whatever the box', () => {
    const rule = /\.oyl-hud__street-map-line\s*\{([^{}]*)\}/.exec(themeCss)?.[1] ?? '';
    expect(rule).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(rule).not.toMatch(/stroke(-width)?:/);
  });

  it('meets 3:1 for every line on what it is drawn on, each pair declared, in both palettes', () => {
    const { land, water, streets, paths, routeEdge, route } = STREET_MAP_PAINTS;
    const pairs: readonly { what: string; a: ColourToken | 'none'; b: ColourToken | 'none' }[] = [
      // The owner's ruling of 2026-11-06: the streets and paths on the land.
      { what: 'a street on the land', a: streets.stroke, b: land.fill },
      { what: 'a path on the land', a: paths.stroke, b: land.fill },
      // A bridge, and the water kept a fill of its own.
      { what: 'a street over the water', a: streets.stroke, b: water.fill },
      { what: 'a path over the water', a: paths.stroke, b: water.fill },
      // The route's edge is its casing, whatever is under that.
      { what: 'the route on its casing', a: route.stroke, b: routeEdge.stroke },
      // The rider's ring, on the route.
      { what: 'the mark’s ring on the route', a: 'hudSurface', b: route.stroke },
      { what: 'the mark’s disc in its ring', a: 'hudInk', b: 'hudSurface' },
    ];
    for (const { what, a, b } of pairs) {
      if (a === 'none' || b === 'none') throw new Error(`${what}: a layer with no paint`);
      expect(declared(a, b), `${what}: ${a} on ${b} is not a declared 3:1 pair`).toBe(true);
      for (const theme of THEMES) {
        const colours = paletteColours(theme);
        expect(contrastRatio(colours[a], colours[b]), `${what}, ${theme}`).toBeGreaterThanOrEqual(
          AA_LARGE_TEXT_OR_NON_TEXT,
        );
      }
    }
  });

  it('keeps the water a fill apart from the land, and the mark’s disc readable on every fill', () => {
    for (const theme of THEMES) {
      const colours = paletteColours(theme);
      const { land, water, streets } = STREET_MAP_PAINTS;
      // The water is told apart by its blue; its lightness is kept at least
      // what it was before the ruling (1.20 on the land), so it did not fade.
      expect(contrastRatio(colours[water.fill], colours[land.fill])).toBeGreaterThanOrEqual(1.2);
      for (const fill of [
        colours.hudSurface,
        colours[land.fill],
        colours[water.fill],
        colours[streets.stroke],
      ]) {
        expect(contrastRatio(colours.hudInk, fill), `${theme}`).toBeGreaterThanOrEqual(
          AA_LARGE_TEXT_OR_NON_TEXT,
        );
      }
    }
  });
});
