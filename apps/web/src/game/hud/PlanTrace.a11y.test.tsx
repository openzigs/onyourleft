// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The plan view, readable at arm's length — #2070.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it: what is asserted here is
 * SC 1.4.11 (each mark a rider has to tell apart, at 3:1 against what it sits
 * on) and SC 1.4.1 (ridden and to come differ by more than colour).
 *
 * ⚠️ **Read off the rendered SVG.** The widths, the dash and the mark's size
 * are attributes on the elements `PlanTrace` renders, and each part's colours
 * are what its CLASS is painted with in `theme.css`, read as a file because
 * jsdom resolves no custom property (as `attribution.a11y.test.tsx` does).
 * `PLAN_PAINTS` is the table between the two, and it is held to both: every
 * class the SVG carries is in it, and every row is what `theme.css` paints.
 * What a real engine draws, in pixels, is `hud.browser.spec.ts` §"#2070".
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../../design/contrast';
import {
  CONTRAST_REQUIREMENTS,
  paletteColours,
  THEMES,
  type ColourToken,
} from '../../design/tokens';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import { PLAN_PAINTS, PlanTrace } from './PlanTrace';
import {
  PLAN_PADDING,
  PLAN_SIZE,
  PLAN_SMALLEST_PIXELS,
  RIDER_MARK_MINIMUM_PIXELS,
  RIDER_MARK_RING_PIXELS,
} from './plan';

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose LAST compound selector is exactly `.className`. */
function bodiesFor(className: string): readonly string[] {
  return [
    ...themeCss.matchAll(
      new RegExp(`(?:^|[{};])\\s*([^{};]*\\.${className})\\s*\\{([^{}]*)\\}`, 'g'),
    ),
  ].map(([, , body]) => body ?? '');
}

/** A route due north, 2 km, so the rider can be part of the way along it. */
function route(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** The plan view a third of the way along, which draws both parts of the road. */
async function rendered(): Promise<HTMLElement> {
  const profile = route();
  mounted = await mount(
    <PlanTrace profile={profile} distance={(profile.totalDistance as number) / 3} />,
  );
  return mounted.container;
}

/** The paint row for an element, by the classes it carries; there must be exactly one. */
function paintOf(element: Element): (typeof PLAN_PAINTS)[number] {
  const rows = PLAN_PAINTS.filter((row) => element.classList.contains(row.className));
  expect(rows, element.getAttribute('class') ?? '').toHaveLength(1);
  return rows[0] as (typeof PLAN_PAINTS)[number];
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

/** Each pair a rider has to tell apart, by what it is. */
function pairsOf(root: HTMLElement): readonly {
  readonly what: string;
  readonly a: ColourToken;
  readonly b: ColourToken;
}[] {
  const roads = queryAll(root, 'path').map(paintOf);
  const mark = root.querySelector('circle');
  if (mark === null) {
    throw new Error('no rider mark on the plan');
  }
  const here = paintOf(mark);
  if (here.fill === 'none') {
    throw new Error('the rider mark is not filled');
  }
  return [
    ...roads.map((road) => ({
      what: `${road.className} against the panel`,
      a: road.stroke,
      b: 'hudSurface' as const,
    })),
    ...roads.map((road) => ({
      what: `the mark's ring against ${road.className}`,
      a: here.stroke,
      b: road.stroke,
    })),
    { what: "the mark's disc against its ring", a: here.fill, b: here.stroke },
  ];
}

describe('the plan view is drawn to be read at arm’s length', () => {
  it('draws the road ridden and the road ahead as two different lines, not two colours', async () => {
    const root = await rendered();
    const ridden = root.querySelectorAll('[data-oyl-plan-part="ridden"]');
    const ahead = root.querySelectorAll('[data-oyl-plan-part="ahead"]');
    expect(ridden.length).toBeGreaterThan(0);
    expect(ahead.length).toBeGreaterThan(0);

    const style = (element: Element) => ({
      width: Number(element.getAttribute('stroke-width')),
      dash: element.getAttribute('stroke-dasharray') ?? 'none',
    });
    const behind = style(ridden[0] as Element);
    const toCome = style(ahead[0] as Element);

    // SC 1.4.1: by dash AND by width, either of which would do alone.
    expect(behind.dash).not.toBe(toCome.dash);
    expect(toCome.dash).toBe('none');
    expect(behind.dash).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?$/);
    expect(toCome.width).toBeGreaterThan(behind.width);
    // Sized for arm's length: neither is the 1.5 px hairline it was.
    expect(behind.width).toBeGreaterThanOrEqual(2);
    expect(toCome.width).toBeGreaterThanOrEqual(3);
  });

  it(`draws the rider's mark at least ${String(RIDER_MARK_MINIMUM_PIXELS)} px across in the smallest box`, async () => {
    const root = await rendered();
    const mark = root.querySelector('circle');
    const radius = Number(mark?.getAttribute('r'));
    const svg = root.querySelector('svg');
    // The viewBox is what the radius is in, so this is what a box of
    // `PLAN_SMALLEST_PIXELS` scales it to.
    const units = Number(svg?.getAttribute('viewBox')?.split(' ')[3]);
    expect(units).toBe(PLAN_SIZE);

    const across = (2 * radius * PLAN_SMALLEST_PIXELS) / units;
    expect(across).toBeGreaterThanOrEqual(RIDER_MARK_MINIMUM_PIXELS);
    // With a ring, so it is a shape apart from the road under it.
    expect(Number(mark?.getAttribute('stroke-width'))).toBe(RIDER_MARK_RING_PIXELS);
    expect(RIDER_MARK_RING_PIXELS).toBeGreaterThanOrEqual(2);
    // And drawn whole at the very edge of the route: the padding holds the
    // disc and the outer half of its ring at the smallest box.
    const ringUnits = (RIDER_MARK_RING_PIXELS / 2) * (units / PLAN_SMALLEST_PIXELS);
    expect(radius + ringUnits).toBeLessThanOrEqual(PLAN_PADDING);
  });

  it('holds every box theme.css gives the plan view to the smallest the mark was sized for', () => {
    const heights = [...themeCss.matchAll(/\.oyl-hud__plan-svg\s*\{([^{}]*)\}/g)].flatMap(
      ([, body]) => [...(body ?? '').matchAll(/(?:^|;)\s*height:\s*([\d.]+)rem/g)],
    );
    expect(heights.length).toBeGreaterThan(2);
    for (const [, rem] of heights) {
      expect(Number(rem) * 16).toBeGreaterThanOrEqual(PLAN_SMALLEST_PIXELS);
    }
  });

  it('meets 3:1 for every pair a rider has to tell apart, each one declared, in both palettes', async () => {
    const root = await rendered();
    const pairs = pairsOf(root);
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    for (const { what, a, b } of pairs) {
      expect(declared(a, b), `${what}: ${a} on ${b} is not a declared 3:1 pair`).toBe(true);
      for (const theme of THEMES) {
        const colours = paletteColours(theme);
        expect(contrastRatio(colours[a], colours[b]), `${what}, ${theme}`).toBeGreaterThanOrEqual(
          AA_LARGE_TEXT_OR_NON_TEXT,
        );
      }
    }
  });
});

describe('PLAN_PAINTS and theme.css say the same thing', () => {
  const kebab = (camel: string): string =>
    camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  it('names every class the rendered plan view is painted by', async () => {
    const root = await rendered();
    for (const element of root.querySelectorAll('path, circle')) {
      paintOf(element);
    }
  });

  for (const { className, fill, stroke } of PLAN_PAINTS) {
    it(`.${className} is painted ${fill} and stroked ${stroke}, in one rule`, () => {
      const found = bodiesFor(className);
      expect(found).toHaveLength(1);
      const colours = (found[0] ?? '')
        .split(';')
        .map((declaration) => declaration.trim().replaceAll(/\s+/g, ' '))
        .filter((declaration) => /^(fill|stroke):/.test(declaration))
        .sort();
      expect(colours).toEqual(
        [
          fill === 'none' ? 'fill: none' : `fill: var(--oyl-color-${kebab(fill)})`,
          `stroke: var(--oyl-color-${kebab(stroke)})`,
        ].sort(),
      );
    });
  }

  it('sets no width or dash in CSS, which would override what the SVG says', () => {
    for (const className of ['oyl-hud__plan-line', ...PLAN_PAINTS.map((row) => row.className)]) {
      for (const body of bodiesFor(className)) {
        expect(body, className).not.toMatch(/stroke-(width|dasharray)/);
      }
    }
  });
});
