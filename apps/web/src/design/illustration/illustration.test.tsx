// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The illustration kit's rules — #938.
 *
 * ⚠️ **The parts are read off `index.ts`'s exports**, never listed: a part
 * added there is rendered and held to the rules here with no edit to this
 * file (and `specimens-testing.ts` will not compile until it says how to draw
 * it).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement, type ComponentType, type JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  expandWorkout,
  seconds,
  thresholdShare,
  type ThresholdShare,
  type WorkoutSegment,
} from '@onyourleft/domain';

import {
  BICYCLE_LENGTH_METRES,
  RIDER_BICYCLE_PARTS,
  RIDER_HEIGHT_METRES,
} from '../../game/bicycle';
import * as kit from './index';
import { ILLUSTRATION_PAINTS } from './paint';
import { PROFILE_SHAPE_COLUMNS, PROFILE_SHAPE_MAX_POINTS } from './ProfileShape';
import { colourLiteralIn, illustrationFaults } from './rules-testing';
import {
  ILLUSTRATION_SPECIMENS,
  SPECIMEN_WORKOUT,
  type IllustrationPartName,
} from './specimens-testing';
import { WORKOUT_SHAPE_BARS, WORKOUT_SHAPE_MAX_POINTS } from './WorkoutShape';

/** One element, rendered and parsed — the markup a browser would be handed. */
function rendered(element: JSX.Element): Element {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(element);
  const root = holder.firstElementChild;
  if (root === null) {
    throw new Error('rendered nothing');
  }
  return root;
}

function draw(part: ComponentType<never>, props: object): Element {
  return rendered(createElement(part as ComponentType<object>, props));
}

const parts = Object.entries(kit) as [IllustrationPartName, unknown][];

/** Every coordinate pair in every path's `d`, which in this kit is all M/L/Z. */
/** Every `d` in a drawing, joined — for a NaN or an Infinity that leaked in. */
function allGeometry(root: Element): string {
  return [...root.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '').join(' ');
}

function pointCount(root: Element): number {
  let numbers = 0;
  for (const path of root.querySelectorAll('path')) {
    numbers += (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.length ?? 0;
  }
  return numbers / 2;
}

/** The x extent of each path's points, for the gap cases. */
function runExtents(root: Element): { readonly left: number; readonly right: number }[] {
  return [...root.querySelectorAll('path')].map((path) => {
    const values = (path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const xs = values.filter((_, index) => index % 2 === 0);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  });
}

describe('the kit — every exported part, from the exports', () => {
  it('exports only parts, and finds some', () => {
    expect(parts.length).toBeGreaterThan(0);
    for (const [name, part] of parts) {
      expect(typeof part, `${name} is not a component`).toBe('function');
      expect(name, `${name} is not a component's name`).toMatch(/^[A-Z]/);
    }
  });

  it('has a specimen for every part and for nothing else', () => {
    expect(Object.keys(ILLUSTRATION_SPECIMENS).sort()).toEqual(parts.map(([name]) => name).sort());
    for (const [name] of parts) {
      expect(ILLUSTRATION_SPECIMENS[name].length, name).toBeGreaterThan(0);
    }
  });

  for (const [name, part] of parts) {
    it(`${name} is an aria-hidden svg with no text and no colour but a token`, () => {
      for (const props of ILLUSTRATION_SPECIMENS[name]) {
        const root = draw(part as ComponentType<never>, props);
        expect(illustrationFaults(root), `${name} ${JSON.stringify(props).slice(0, 80)}`).toEqual(
          [],
        );
        // It drew something: a rule passed over an empty picture is no rule.
        expect(root.querySelectorAll('path, circle, rect, line').length).toBeGreaterThan(0);
      }
    });
  }
});

describe('the check can fail', () => {
  const svg = (children: JSX.Element, attributes: Record<string, string> = {}): Element =>
    rendered(
      createElement(
        'svg',
        { 'aria-hidden': 'true', focusable: 'false', viewBox: '0 0 10 10', ...attributes },
        children,
      ),
    );
  const painted = { className: ILLUSTRATION_PAINTS.mark.className };

  it('passes a shape that takes its paint from a class', () => {
    expect(illustrationFaults(svg(<path {...painted} d="M0 0 L10 10 Z" />))).toEqual([]);
  });

  it('fails a fixture part with fill="#ff0000"', () => {
    function RedPart(): JSX.Element {
      return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 10 10">
          <path {...painted} d="M0 0 L10 10 Z" fill="#ff0000" />
        </svg>
      );
    }
    expect(illustrationFaults(rendered(<RedPart />))).toEqual([
      '<path fill>: a colour literal in “#ff0000”',
    ]);
  });

  it('fails rgb(), hsl() and a named colour, in an attribute or a style', () => {
    for (const shape of [
      <path {...painted} key="a" d="M0 0Z" stroke="rgb(1, 2, 3)" />,
      <path {...painted} key="b" d="M0 0Z" style={{ fill: 'hsl(1 2% 3%)' }} />,
      <path {...painted} key="c" d="M0 0Z" fill="Tomato" />,
      <path {...painted} key="d" d="M0 0Z" fill="currentColor" />,
    ]) {
      expect(illustrationFaults(svg(shape)).length, shape.key ?? '').toBe(1);
    }
  });

  it('fails a system colour, bare or as a var() fallback, and passes a custom property — #967', () => {
    for (const [key, value] of [
      ['CanvasText', 'CanvasText'],
      ['Canvas', 'Canvas'],
      ['ButtonFace', 'ButtonFace'],
      ['AccentColor', 'AccentColor'],
      ['Highlight', 'Highlight'],
      ['Mark', 'Mark'],
      ['GrayText', 'GrayText'],
      ['deprecated WindowText', 'WindowText'],
      ['fallback', 'var(--oyl-x, CanvasText)'],
    ] as const) {
      expect(
        illustrationFaults(svg(<path {...painted} d="M0 0Z" fill={value} />)),
        key,
      ).toHaveLength(1);
    }
    expect(
      illustrationFaults(
        svg(<path {...painted} d="M0 0Z" style={{ fill: 'var(--oyl-x, Field)' }} />),
      ),
    ).toHaveLength(1);
    expect(
      illustrationFaults(
        svg(<path {...painted} d="M0 0Z" style={{ fill: 'var(--oyl-color-canvas)' }} />),
      ),
    ).toEqual([]);
    expect(colourLiteralIn('var(--oyl-color-mark-highlight)')).toBeUndefined();
    expect(colourLiteralIn('oyl-illo__mark')).toBeUndefined();
    expect(colourLiteralIn('background: var(--oyl-color-canvas)')).toBeUndefined();
    expect(colourLiteralIn('background: Canvas')).toBe(
      'the system colour “canvas” in “background: Canvas”',
    );
  });

  it('fails an <image>, a <use> and a <foreignObject> — #967', () => {
    expect(illustrationFaults(svg(<image href="a.png" />))).toEqual(['holds a <image>']);
    expect(illustrationFaults(svg(<use href="#elsewhere" />))).toEqual([
      'holds a <use>',
      '<use href>: a colour literal in “#elsewhere”',
    ]);
    expect(illustrationFaults(svg(<use {...painted} />))).toEqual(['holds a <use>']);
    expect(illustrationFaults(svg(<foreignObject />))).toEqual(['holds a <foreignobject>']);
  });

  it('fails a shape with no paint class, a title, text, and a picture that is not hidden', () => {
    expect(illustrationFaults(svg(<path d="M0 0Z" />))).toEqual([
      'a <path> takes no paint from ILLUSTRATION_PAINTS',
    ]);
    expect(illustrationFaults(svg(<title>Hills</title>)).length).toBeGreaterThan(0);
    expect(illustrationFaults(svg(<desc />))).toEqual(['holds a <desc>']);
    expect(illustrationFaults(svg(<text />))).toEqual(['holds a <text>']);
    expect(
      illustrationFaults(
        rendered(
          <svg focusable="false">
            <path {...painted} d="M0 0Z" />
          </svg>,
        ),
      ),
    ).toEqual(['is not aria-hidden="true"']);
    expect(
      illustrationFaults(
        rendered(
          <svg aria-hidden="true">
            <path {...painted} d="M0 0Z" />
          </svg>,
        ),
      ),
    ).toEqual(['is not focusable="false"']);
  });
});

describe('the paint table and theme.css say the same thing', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'theme.css'),
    'utf8',
  );
  const kebab = (camel: string): string =>
    camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  // Every rule's prelude and body, comments out, at any depth: a prelude is the
  // text between the last `{`, `}` or `;` and a `{`, so a rule nested in an
  // `@media` is found as well as one at the top level.
  const uncommented = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const preludes = [...uncommented.matchAll(/([^{};]+)\{/g)].map(([, prelude]) =>
    (prelude ?? '').trim().replaceAll(/\s+/g, ' '),
  );
  const declarations = (className: string): readonly (readonly string[])[] =>
    [
      ...uncommented.matchAll(new RegExp(`(?:^|[{};])\\s*\\.${className}\\s*\\{([^{}]*)\\}`, 'g')),
    ].map(([, body]) =>
      (body ?? '')
        .split(';')
        .map((declaration) => declaration.trim().replaceAll(/\s+/g, ' '))
        .filter((declaration) => declaration !== '')
        .sort(),
    );

  for (const [name, { className, token, property }] of Object.entries(ILLUSTRATION_PAINTS)) {
    it(`${name}: .${className} sets exactly ${property} to the ${token} token`, () => {
      const expected = [`${property}: var(--oyl-color-${kebab(token)})`];
      if (property === 'stroke') {
        expected.push('fill: none');
      }
      // ⚠️ Equal, not contains (#967's review): a `stroke: #ff0000` added
      // beside the token passed every check while it was `toContain`.
      expect(declarations(className)).toEqual([expected.sort()]);
    });
  }

  it('names every .oyl-illo__ rule theme.css has', () => {
    const declared = new Set(
      [...css.matchAll(/^\.(oyl-illo__[a-z-]+)\s*\{/gm)].map(([, name]) => name),
    );
    expect(declared).toEqual(
      new Set(Object.values(ILLUSTRATION_PAINTS).map(({ className }) => className)),
    );
  });

  it('paints a part in no rule but a bare class of its own — #967', () => {
    // A descendant, compound or grouped selector (`.oyl-illo__mark path`,
    // `svg .oyl-illo__sky`, `.a, .oyl-illo__road`) would repaint a shape
    // around the table above, so any prelude naming the kit is one class alone.
    const naming = preludes.filter((prelude) => prelude.includes('oyl-illo__'));
    expect(naming.length).toBeGreaterThan(0);
    for (const prelude of naming) {
      expect(prelude, prelude).toMatch(/^\.oyl-illo__[a-z-]+$/);
    }
  });
});

describe('ProfileShape', () => {
  const profile = (elevations: readonly (number | undefined)[]): Element =>
    rendered(<kit.ProfileShape profile={{ elevations }} />);

  it('emits at most its bound for 100 000 samples', () => {
    const climb = Array.from({ length: 100_000 }, (_, index) => Math.sin(index / 5000) * 300);
    expect(pointCount(profile(climb))).toBeLessThanOrEqual(PROFILE_SHAPE_MAX_POINTS);
    expect(pointCount(profile(climb))).toBeGreaterThanOrEqual(PROFILE_SHAPE_COLUMNS);
  });

  it('emits at most its bound for 100 000 samples with a gap in every other column', () => {
    // Each column's samples, by `downsample`'s own bucket edges, so every other
    // column really is empty — the most runs the drawing can be handed.
    const width = 100_000 / PROFILE_SHAPE_COLUMNS;
    const worst = Array.from({ length: 100_000 }, (_, index): number | undefined => {
      let column = Math.floor(index / width);
      while (Math.floor(column * width) > index) column -= 1;
      while (Math.floor((column + 1) * width) <= index) column += 1;
      return column % 2 === 0 ? index : undefined;
    });
    const drawn = profile(worst);
    expect(drawn.querySelectorAll('path').length).toBe(PROFILE_SHAPE_COLUMNS / 2);
    expect(pointCount(drawn)).toBeLessThanOrEqual(PROFILE_SHAPE_MAX_POINTS);
  });

  it('draws an empty input as nothing, not as a flat line', () => {
    expect(profile([]).querySelectorAll('path').length).toBe(0);
    expect(profile([undefined, undefined, undefined]).querySelectorAll('path').length).toBe(0);
    expect(illustrationFaults(profile([]))).toEqual([]);
  });

  it('keeps a gap as a gap, not as a line drawn across it', () => {
    const elevations = Array.from({ length: 90 }, (_, index) =>
      index >= 30 && index < 60 ? undefined : 100 + index,
    );
    const runs = runExtents(profile(elevations));
    expect(runs).toHaveLength(2);
    for (const { left, right } of runs) {
      // Nothing is drawn over columns 30 to 59.
      expect(right <= 30 || left >= 60, `${String(left)}–${String(right)}`).toBe(true);
    }
  });

  it('keeps a lone reading between two gaps as a sliver rather than nothing', () => {
    const runs = runExtents(profile([undefined, 50, undefined]));
    expect(runs).toEqual([{ left: 1, right: 2 }]);
  });

  it('draws a level route as level ground, not as nothing', () => {
    const drawn = profile([40, 40, 40, 40]);
    expect(drawn.querySelectorAll('path').length).toBe(1);
  });

  it('reads a NaN or an Infinity as a gap, and still draws the finite parts — #967', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const drawn = profile([10, 20, bad, 30, 40]);
      expect(allGeometry(drawn), String(bad)).not.toMatch(/NaN|Infinity/);
      // The two finite runs either side of the bad sample, drawn apart.
      expect(runExtents(drawn), String(bad)).toHaveLength(2);
      expect(illustrationFaults(drawn)).toEqual([]);
    }
    expect(profile([Number.NaN, Number.NaN]).querySelectorAll('path')).toHaveLength(0);
  });

  it('puts the highest point higher than the lowest', () => {
    const d = profile([0, 100]).querySelector('path')?.getAttribute('d') ?? '';
    const ys = (d.match(/-?\d+(?:\.\d+)?/g) ?? [])
      .map(Number)
      .filter((_, index) => index % 2 === 1);
    // The two column points are the third and fourth pairs.
    expect(ys[3]).toBeLessThan(ys[2] ?? 0);
  });
});

describe('WorkoutShape', () => {
  const shape = (segments: readonly WorkoutSegment[]): Element =>
    rendered(<kit.WorkoutShape workout={{ segments }} />);
  const share = (value: number): ThresholdShare => thresholdShare(value);
  const segment = (
    startsAt: number,
    endsAt: number,
    from: number | undefined,
    to = from,
  ): WorkoutSegment => ({
    startsAt: seconds(startsAt),
    endsAt: seconds(endsAt),
    from: from === undefined ? undefined : share(from),
    to: to === undefined ? undefined : share(to),
    block: 0,
  });

  it('emits at most its bound for 100 000 segments', () => {
    const many = Array.from({ length: 100_000 }, (_, index) =>
      segment(index, index + 1, index % 2 === 0 ? 1.1 : 0.5),
    );
    expect(pointCount(shape(many))).toBeLessThanOrEqual(WORKOUT_SHAPE_MAX_POINTS);
    expect(shape(many).querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('emits at most its bound at the most segments it draws one for one', () => {
    const most = Array.from({ length: WORKOUT_SHAPE_BARS }, (_, index) =>
      segment(index, index + 1, 0.5 + (index % 3) * 0.2),
    );
    const drawn = shape(most);
    expect(drawn.querySelectorAll('path').length).toBe(WORKOUT_SHAPE_BARS);
    expect(pointCount(drawn)).toBeLessThanOrEqual(WORKOUT_SHAPE_MAX_POINTS);
  });

  it('draws an empty workout as nothing', () => {
    expect(shape([]).querySelectorAll('path').length).toBe(0);
    expect(illustrationFaults(shape([]))).toEqual([]);
  });

  it('keeps a hole in the timeline as a hole when it is sliced', () => {
    const holed = Array.from({ length: 1000 }, (_, index) =>
      segment(index < 500 ? index : index + 500, (index < 500 ? index : index + 500) + 1, 0.8),
    );
    const runs = runExtents(shape(holed));
    expect(runs).toHaveLength(2);
    // The drawing is 1000 units for 1500 s: nothing between 500 s and 1000 s.
    for (const { left, right } of runs) {
      expect(right <= 334 || left >= 666, `${String(left)}–${String(right)}`).toBe(true);
    }
  });

  it('drops a segment with a NaN or an Infinity in it, and draws the rest — #967', () => {
    const raw = (
      startsAt: number,
      endsAt: number,
      from: number | undefined,
      to = from,
    ): WorkoutSegment => ({ startsAt, endsAt, from, to, block: 0 }) as unknown as WorkoutSegment;
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const poisoned of [
        raw(20, bad, 0.8),
        raw(bad, 30, 0.8),
        raw(20, 30, bad),
        raw(20, 30, 0.8, bad),
      ]) {
        const drawn = shape([raw(0, 10, 0.5), raw(10, 20, 1), poisoned]);
        expect(allGeometry(drawn), String(bad)).not.toMatch(/NaN|Infinity/);
        expect(drawn.querySelectorAll('path'), String(bad)).toHaveLength(2);
      }
      // And sliced, past the one-for-one bound.
      const many = Array.from({ length: 500 }, (_, index) => raw(index, index + 1, 0.7));
      const drawn = shape([...many, raw(500, bad, 0.9)]);
      expect(allGeometry(drawn), String(bad)).not.toMatch(/NaN|Infinity/);
      expect(drawn.querySelectorAll('path').length).toBeGreaterThan(0);
    }
  });

  it('draws a harder block taller than an easier one', () => {
    const [easy, hard] = [
      ...shape([segment(0, 10, 0.5), segment(10, 20, 1)]).querySelectorAll('path'),
    ].map((path) => Number((path.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.[3]));
    expect(hard).toBeLessThan(easy ?? 0);
  });

  it('renders no number at all — no digit in its text or in any attribute but geometry', () => {
    const geometry = new Set(['d', 'viewbox']);
    for (const drawn of [
      shape(expandWorkout(SPECIMEN_WORKOUT).segments),
      shape(Array.from({ length: 5000 }, (_, index) => segment(index, index + 1, 0.9))),
    ]) {
      expect(drawn.textContent ?? '').not.toMatch(/\d/);
      for (const element of [drawn, ...drawn.querySelectorAll('*')]) {
        for (const { name, value } of element.attributes) {
          if (!geometry.has(name.toLowerCase())) {
            expect(value, `<${element.tagName} ${name}>`).not.toMatch(/\d/);
          }
        }
      }
    }
  });
});

describe('Hills', () => {
  const outline = (seed: number): string =>
    [...rendered(<kit.Hills seed={seed} />).querySelectorAll('path')]
      .map((path) => path.getAttribute('d'))
      .join('|');

  it('draws the same hills for the same seed, and different ones for another', () => {
    expect(outline(3)).toBe(outline(3));
    expect(outline(3)).not.toBe(outline(4));
  });

  it('draws a far layer and a near one, in that order', () => {
    const classes = [...rendered(<kit.Hills />).querySelectorAll('path')].map((path) =>
      path.getAttribute('class'),
    );
    expect(classes).toEqual([
      ILLUSTRATION_PAINTS.hillFar.className,
      ILLUSTRATION_PAINTS.hillNear.className,
    ]);
  });
});

describe('RiderSilhouette', () => {
  const rider = rendered(<kit.RiderSilhouette />);

  it('is the size game/bicycle.ts says the rider is, and no other', () => {
    const [, , width, height] = (rider.getAttribute('viewBox') ?? '').split(' ').map(Number);
    // The viewBox is the bicycle's length and the rider's height, each with
    // the same margin either side.
    expect((width ?? 0) - BICYCLE_LENGTH_METRES).toBeCloseTo(
      (height ?? 0) - RIDER_HEIGHT_METRES,
      2,
    );
    expect(height).toBeGreaterThan(RIDER_HEIGHT_METRES);
  });

  it('draws its wheels from the parts list', () => {
    const wheels = RIDER_BICYCLE_PARTS.filter((part) => part.name.endsWith('wheel'));
    const circles = [...rider.querySelectorAll('circle')].map((circle) => ({
      cx: Number(circle.getAttribute('cx')),
      r: Number(circle.getAttribute('r')),
    }));
    for (const wheel of wheels) {
      const radius = wheel.solid.shape === 'ring' ? wheel.solid.radius : Number.NaN;
      expect(circles).toContainEqual({ cx: wheel.z, r: Math.round(radius * 100) / 100 });
    }
  });
});
