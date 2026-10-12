// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The running workout's graph as markup — #1307: an image with a name that
 * says what it shows, painted only through the classes `theme.css` declares,
 * and a DOM that does not grow with the workout.
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
import { mount } from '../testing/mount';
import { BLOCK_CHART_MAX_SHAPES } from '../workouts/block-chart';
import { BLOCK_CHART_PAINTS } from '../workouts/BlockChart';

import {
  GRAPH_KEY_HEART_RATE,
  GRAPH_KEY_PLAN,
  GRAPH_KEY_TRACE,
  workoutGraphText,
  type WorkoutGraphInput,
  type WorkoutTraceSample,
} from './workout-graph';
import { WORKOUT_GRAPH_PAINTS, WorkoutGraph } from './WorkoutGraph';

function rendered(element: JSX.Element): Element {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(element);
  return holder;
}

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

const BLOCKS: readonly WorkoutBlock[] = [
  steady(600, 0.6),
  { kind: 'free-ride', seconds: seconds(300) },
  steady(600, 1),
];

const RANGE = { low: 130, high: 140 };

const trace = (range?: typeof RANGE): readonly WorkoutTraceSample[] =>
  [298, 299, 300].map((at) => ({
    at,
    target: 150,
    power: 145 + (at % 3),
    heartRate: range === undefined ? undefined : 134,
    range,
  }));

const input = (overrides: Partial<WorkoutGraphInput> = {}): WorkoutGraphInput => ({
  elapsedSeconds: 300,
  timeline: expandWorkout({ name: 'test', blocks: BLOCKS }),
  holdingWatts: 150,
  thresholdWatts: 250,
  trace: trace(),
  ...overrides,
});

const classesOf = (root: Element): readonly string[] =>
  [...root.querySelectorAll('path')].map((path) => path.getAttribute('class') ?? '');

describe('the running workout’s graph — #1307', () => {
  it('is an image named by the sentence that says what it shows, with its marks hidden', () => {
    const workout = input();
    const svg = rendered(<WorkoutGraph workout={workout} />).querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(workoutGraphText(workout));
    expect(svg?.getAttribute('focusable')).toBe('false');
    // Every mark is inside a hidden group: the name is the whole of what is read.
    for (const path of svg?.querySelectorAll('path') ?? []) {
      expect(path.closest('g[aria-hidden="true"]')).not.toBeNull();
    }
    expect(svg?.querySelector('text, title, desc, foreignObject, image, use')).toBeNull();
  });

  it('draws the plan ridden and to come, now, the target and the power', () => {
    const classes = classesOf(rendered(<WorkoutGraph workout={input()} />));
    for (const expected of [
      'oyl-workout-graph__done',
      'oyl-workout-graph__now',
      'oyl-workout-graph__now-cap',
      'oyl-workout-graph__target',
      'oyl-workout-graph__target-edge',
      'oyl-workout-graph__power',
      'oyl-block-chart__band-threshold',
      'oyl-block-chart__free-ride',
      'oyl-block-chart__rule',
    ]) {
      expect(classes, expected).toContain(expected);
    }
    // No hold, no re-plan: neither is drawn.
    expect(classes.filter((name) => /range|heart-rate|replaced/.test(name))).toEqual([]);
  });

  it('records where now is, for a test to read without parsing a path', () => {
    const now = rendered(<WorkoutGraph workout={input()} />).querySelector(
      '.oyl-workout-graph__now',
    );
    expect(now?.getAttribute('data-fraction')).toBe('0.2000');
  });

  it('adds the heart-rate lane, and makes room for it, while a hold runs', () => {
    const plain = rendered(<WorkoutGraph workout={input()} />).querySelector('svg');
    const held = rendered(<WorkoutGraph workout={input({ trace: trace(RANGE) })} />);
    const classes = classesOf(held);
    expect(classes).toContain('oyl-workout-graph__range');
    expect(classes).toContain('oyl-workout-graph__range-edge');
    expect(classes).toContain('oyl-workout-graph__heart-rate');
    const height = (svg: Element | null | undefined): number =>
      Number((svg?.getAttribute('viewBox') ?? '').split(' ')[3]);
    expect(height(held.querySelector('svg'))).toBeGreaterThan(height(plain));
  });

  it('draws what a re-plan replaced once it is supplied — #1244’s seam', () => {
    const replaced = expandWorkout({ name: 'before', blocks: [steady(1500, 0.8)] }).segments;
    const classes = classesOf(rendered(<WorkoutGraph workout={input({ replaced })} />));
    expect(classes).toContain('oyl-workout-graph__replaced');
  });

  it('paints by class and never by a colour of its own', () => {
    const root = rendered(
      <WorkoutGraph
        workout={input({ trace: trace(RANGE), replaced: input().timeline.segments })}
      />,
    );
    const known = new Set([
      ...WORKOUT_GRAPH_PAINTS.map(({ className }) => className),
      ...BLOCK_CHART_PAINTS.map(({ className }) => className),
    ]);
    for (const name of classesOf(root)) {
      expect(known.has(name), name).toBe(true);
    }
    for (const element of root.querySelectorAll('*')) {
      for (const { name, value } of element.attributes) {
        if (name === 'aria-label') continue;
        expect(colourLiteralIn(value), `<${element.tagName} ${name}>`).toBeUndefined();
      }
    }
  });

  it('says what each lane is under the graph on the Ride screen', () => {
    const plain = rendered(<WorkoutGraph workout={input()} />);
    expect(plain.querySelector('.oyl-workout-graph__key')?.textContent).toBe(
      `${GRAPH_KEY_PLAN} ${GRAPH_KEY_TRACE}`,
    );
    const held = rendered(<WorkoutGraph workout={input({ trace: trace(RANGE) })} />);
    expect(held.querySelector('.oyl-workout-graph__key')?.textContent).toBe(
      `${GRAPH_KEY_PLAN} ${GRAPH_KEY_HEART_RATE} ${GRAPH_KEY_TRACE}`,
    );
  });

  it('is a strip with no key on the HUD, sized by the route plan’s own rule', () => {
    const hud = rendered(<WorkoutGraph workout={input()} variant="hud" />);
    expect(hud.querySelector('.oyl-workout-graph__key')).toBeNull();
    expect(hud.querySelector('svg')?.getAttribute('class')).toBe(
      'oyl-workout-graph__svg oyl-hud__plan-svg',
    );
    // The name is still the whole sentence: the strip is smaller, not quieter.
    expect(hud.querySelector('svg')?.getAttribute('aria-label')).toBe(workoutGraphText(input()));
    const panel = rendered(<WorkoutGraph workout={input()} />);
    expect(panel.querySelector('svg')?.getAttribute('class')).toBe(
      'oyl-workout-graph__svg oyl-workout-graph__svg--panel',
    );
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
    const timeline = expandWorkout({ name: 'long', blocks });
    expect(timeline.segments).toHaveLength(MAXIMUM_SEGMENTS);
    const root = rendered(
      <WorkoutGraph
        workout={input({
          timeline,
          elapsedSeconds: 150_000,
          trace: trace(RANGE),
          replaced: timeline.segments,
        })}
      />,
    );
    expect(root.querySelectorAll('path').length).toBeLessThanOrEqual(
      BLOCK_CHART_MAX_SHAPES + WORKOUT_GRAPH_PAINTS.length,
    );
  });

  it('draws nothing, and leaves the page standing, when the geometry throws', async () => {
    const broken = { ...input(), timeline: undefined } as unknown as WorkoutGraphInput;
    // React logs the caught error; the page is what is asserted.
    const error = console.error;
    console.error = () => undefined;
    try {
      // Mounted for real: `renderToStaticMarkup` does not run error boundaries.
      const view = await mount(
        <section>
          <p>End workout</p>
          <WorkoutGraph workout={broken} />
        </section>,
      );
      expect(view.container.textContent).toBe('End workout');
      expect(view.container.querySelector('svg')).toBeNull();
      view.unmount();
    } finally {
      console.error = error;
    }
  });
});

describe('the paint table and theme.css say the same thing — #1307', () => {
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

  for (const { className, token, property } of WORKOUT_GRAPH_PAINTS) {
    it(`.${className} sets ${property} to the ${token} token, in one rule`, () => {
      const found = bodies(className);
      expect(found).toHaveLength(1);
      const colours = (found[0] ?? '')
        .split(';')
        .map((declaration) => declaration.trim().replaceAll(/\s+/g, ' '))
        .filter((declaration) => /^(fill|stroke):/.test(declaration));
      expect(colours.sort()).toEqual(
        (property === 'fill'
          ? [`fill: var(--oyl-color-${kebab(token)})`]
          : ['fill: none', `stroke: var(--oyl-color-${kebab(token)})`]
        ).sort(),
      );
    });
  }

  it('names every painted .oyl-workout-graph__ rule theme.css has', () => {
    const declared = new Set(
      [...css.matchAll(/\.(oyl-workout-graph__[a-z0-9-]+)\s*\{([^{}]*)\}/g)]
        .filter(([, , body]) => /(?:^|;)\s*(fill|stroke):/.test(body ?? ''))
        .map(([, name]) => name),
    );
    expect(declared).toEqual(new Set(WORKOUT_GRAPH_PAINTS.map(({ className }) => className)));
  });

  it('gives the strip no height of its own, so the HUD’s route-plan rule sizes it — #1169', () => {
    // Measured, not read off this: `browser/ride.browser.spec.ts` §"#1307".
    expect(bodies('oyl-workout-graph__svg')).toHaveLength(1);
    expect(bodies('oyl-workout-graph__svg')[0]).not.toMatch(/height:/);
  });
});
