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
  workoutGraphKey,
  workoutGraphLabels,
  workoutGraphText,
  workoutStripText,
  type WorkoutGraphInput,
  type WorkoutTraceSample,
} from './workout-graph';
import {
  WORKOUT_GRAPH_PAINTS,
  WORKOUT_STRIP_PAINTS,
  WorkoutGraph,
  WorkoutStrip,
} from './WorkoutGraph';

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

const textOf = (root: Element, selector: string): readonly string[] =>
  [...root.querySelectorAll(selector)].map((each) => each.textContent ?? '');

describe('the running workout’s graph — #1307', () => {
  it('is an image named by the sentence that says what it shows, with its marks hidden', () => {
    const workout = input();
    const root = rendered(<WorkoutGraph workout={workout} />);
    const image = root.querySelector('[role="img"]');
    expect(root.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(image?.getAttribute('aria-label')).toBe(workoutGraphText(workout));
    // Every mark AND every number written on a lane is inside one hidden
    // wrapper: the name is the whole of what is read.
    expect(image?.children).toHaveLength(1);
    expect(image?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('svg').length).toBeGreaterThan(0);
    for (const svg of root.querySelectorAll('svg')) {
      expect(svg.closest('[role="img"]')).toBe(image);
      expect(svg.getAttribute('focusable')).toBe('false');
      // Never SVG text: each drawing is stretched to its box.
      expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
      expect(svg.querySelector('text, title, desc, foreignObject, image, use')).toBeNull();
    }
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
    ]) {
      expect(classes, expected).toContain(expected);
    }
    // No hold, no re-plan, nothing held instead: none of those is drawn.
    expect(classes.filter((name) => /range|heart-rate|replaced|asked|held/.test(name))).toEqual([]);
    // ⚠️ And no threshold rule: an unlabelled dashed line was the one mark the
    // key did not explain.
    expect(classes).not.toContain('oyl-block-chart__rule');
  });

  it('draws one drawing a lane, each under its caption, in order', () => {
    const plain = rendered(<WorkoutGraph workout={input()} />);
    expect(
      [...plain.querySelectorAll('[data-oyl-lane]')].map((lane) =>
        lane.getAttribute('data-oyl-lane'),
      ),
    ).toEqual(['plan', 'trace']);
    const held = rendered(<WorkoutGraph workout={input({ trace: trace(RANGE) })} />);
    const lanes = [...held.querySelectorAll('[data-oyl-lane]')];
    expect(lanes.map((lane) => lane.getAttribute('data-oyl-lane'))).toEqual([
      'plan',
      'heart-rate',
      'trace',
    ]);
    for (const lane of lanes) {
      expect(lane.querySelectorAll('svg')).toHaveLength(1);
      const caption = lane.querySelector('.oyl-workout-graph__caption');
      const svg = lane.querySelector('svg');
      if (caption === null || svg === null) throw new Error('a lane is missing a part');
      const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
      expect(caption.compareDocumentPosition(svg) & FOLLOWING).toBe(FOLLOWING);
    }
  });

  it('writes each lane’s numbers on it: the clock, watts, and the scale’s two ends', () => {
    const workout = input();
    const root = rendered(<WorkoutGraph workout={workout} />);
    const labels = workoutGraphLabels(workout);
    expect(textOf(root, '[data-oyl-lane="plan"] .oyl-workout-graph__caption span')).toEqual([
      'Whole workout',
      '5:00 of 25:00',
    ]);
    expect(textOf(root, '[data-oyl-lane="trace"] .oyl-workout-graph__caption span')).toEqual([
      labels.trace.title,
      'Target 150 W · You 145 W',
    ]);
    // 145–150 W in the window: the lane runs from 110 W to 190 W, and says so.
    expect(textOf(root, '[data-oyl-lane="trace"] .oyl-workout-graph__scale')).toEqual([
      '190 W',
      '110 W',
    ]);
  });

  it('writes heart rate and the range’s edges on the heart-rate lane, where the band is', () => {
    const root = rendered(<WorkoutGraph workout={input({ trace: trace(RANGE) })} />);
    expect(textOf(root, '[data-oyl-lane="heart-rate"] .oyl-workout-graph__caption span')).toEqual([
      'Heart rate',
      '134 bpm',
    ]);
    const edges = [
      ...root.querySelectorAll('[data-oyl-lane="heart-rate"] .oyl-workout-graph__scale'),
    ];
    expect(edges.map((each) => each.textContent)).toEqual(['140', '130']);
    // Each beside its own edge: on a lane from 125 to 145 bpm, a quarter and
    // three quarters of the way down.
    expect(edges.map((each) => each.getAttribute('style'))).toEqual(['top:25.00%', 'top:75.00%']);
  });

  it('records where now is, for a test to read without parsing a path', () => {
    const now = rendered(<WorkoutGraph workout={input()} />).querySelector(
      '.oyl-workout-graph__now',
    );
    expect(now?.getAttribute('data-fraction')).toBe('0.2000');
  });

  it('adds the heart-rate lane while a hold runs', () => {
    const classes = classesOf(rendered(<WorkoutGraph workout={input({ trace: trace(RANGE) })} />));
    expect(classes).toContain('oyl-workout-graph__range');
    expect(classes).toContain('oyl-workout-graph__range-edge');
    expect(classes).toContain('oyl-workout-graph__heart-rate');
  });

  it('draws what the plan asks and what the trainer holds, where the two differ', () => {
    // 60 % of 250 W is 150 W; the trainer confirmed 180 W.
    const classes = classesOf(rendered(<WorkoutGraph workout={input({ holdingWatts: 180 })} />));
    expect(classes).toContain('oyl-workout-graph__asked');
    expect(classes).toContain('oyl-workout-graph__held');
    expect(classes).toContain('oyl-workout-graph__held-edge');
  });

  it('draws what a re-plan replaced once it is supplied — #1244’s seam', () => {
    const replaced = expandWorkout({ name: 'before', blocks: [steady(1500, 0.8)] }).segments;
    const classes = classesOf(rendered(<WorkoutGraph workout={input({ replaced })} />));
    expect(classes).toContain('oyl-workout-graph__replaced');
  });

  const everything = (): WorkoutGraphInput =>
    input({ trace: trace(RANGE), replaced: input().timeline.segments, holdingWatts: 180 });

  it('paints by class and never by a colour of its own', () => {
    for (const [root, table] of [
      [rendered(<WorkoutGraph workout={everything()} />), WORKOUT_GRAPH_PAINTS],
      [rendered(<WorkoutStrip workout={everything()} />), WORKOUT_STRIP_PAINTS],
      [rendered(<WorkoutStrip workout={input()} />), WORKOUT_STRIP_PAINTS],
    ] as const) {
      const known = new Set([
        ...table.map(({ className }) => className),
        ...(table === WORKOUT_GRAPH_PAINTS
          ? BLOCK_CHART_PAINTS.map(({ className }) => className)
          : []),
      ]);
      expect(classesOf(root).length).toBeGreaterThan(2);
      for (const name of classesOf(root)) {
        expect(known.has(name), name).toBe(true);
      }
      for (const element of root.querySelectorAll('*')) {
        for (const { name, value } of element.attributes) {
          if (name === 'aria-label') continue;
          expect(colourLiteralIn(value), `<${element.tagName} ${name}>`).toBeUndefined();
        }
      }
    }
  });

  it('says nothing under the graph unless a mark needs explaining: the lanes carry titles', () => {
    for (const workout of [input(), input({ trace: trace(RANGE) })]) {
      const root = rendered(<WorkoutGraph workout={workout} />);
      expect(root.querySelector('.oyl-workout-graph__key')).toBeNull();
      // No paragraph at all outside the image — not an empty one.
      expect(root.querySelectorAll('p:not([role="img"] p)')).toHaveLength(0);
      expect(root.textContent).not.toMatch(/Top:|Middle:|Bottom:/);
    }
  });

  it('explains the dashed outline, and the dotted one, under the graph while each is drawn', () => {
    const held = input({ holdingWatts: 180 });
    const root = rendered(<WorkoutGraph workout={held} />);
    const key = root.querySelector('.oyl-workout-graph__key');
    expect(key?.textContent).toBe(
      'At the line, the dashed outline is what the plan asks for now, 150 W. The shaded step ' +
        'is what the trainer confirmed instead, 180 W.',
    );
    // Outside the image: it is read, where the marks are not.
    expect(key?.closest('[role="img"]')).toBeNull();
    const both = rendered(<WorkoutGraph workout={everything()} />);
    expect(both.querySelector('.oyl-workout-graph__key')?.textContent).toBe(
      workoutGraphKey(everything()),
    );
    expect(workoutGraphKey(everything())).toContain(
      'The dotted outline is the plan before it was changed.',
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
    const strip = rendered(
      <WorkoutStrip workout={input({ timeline, elapsedSeconds: 150_000, trace: trace(RANGE) })} />,
    );
    expect(strip.querySelectorAll('path').length).toBeLessThanOrEqual(WORKOUT_STRIP_PAINTS.length);
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
          <WorkoutStrip workout={broken} />
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

describe('the HUD’s strip as markup — #1307', () => {
  const held = (): WorkoutGraphInput => input({ trace: trace(RANGE) });

  it('is one image named by the whole sentence, sized by the route plan’s own rule', () => {
    const workout = input();
    const root = rendered(<WorkoutStrip workout={workout} />);
    const image = root.querySelector('[role="img"]');
    expect(root.querySelectorAll('[role="img"]')).toHaveLength(1);
    // The name is still the whole sentence: the strip is smaller, not quieter.
    expect(image?.getAttribute('aria-label')).toBe(workoutGraphText(workout));
    expect(image?.getAttribute('data-oyl-workout-graph')).toBe('hud');
    // `oyl-hud__plan-svg`: the size of the thing it replaces (#1169).
    expect(image?.getAttribute('class')).toBe('oyl-workout-strip oyl-hud__plan-svg');
    // Everything inside the image is hidden under its name.
    for (const child of image?.children ?? []) {
      expect(child.getAttribute('aria-hidden')).toBe('true');
    }
    // No key: the HUD has no room for a paragraph.
    expect(root.querySelector('.oyl-workout-graph__key')).toBeNull();
  });

  it('draws ONE lane, a bar and one line of text: power against the target', () => {
    const workout = input();
    const root = rendered(<WorkoutStrip workout={workout} />);
    expect(root.querySelectorAll('svg')).toHaveLength(2);
    expect(root.querySelector('[role="img"]')?.getAttribute('data-oyl-lane')).toBe('power');
    expect([...classesOf(root)].sort()).toEqual(
      [
        'oyl-workout-strip__target',
        'oyl-workout-strip__power',
        'oyl-workout-strip__track',
        'oyl-workout-strip__done',
        'oyl-workout-strip__now',
      ].sort(),
    );
    expect(textOf(root, 'p')).toEqual([workoutStripText(workout)]);
    expect(textOf(root, 'p')).toEqual(['Target 150 W · 5:00 left in block']);
    expect(root.querySelector('.oyl-workout-strip__now')?.getAttribute('data-fraction')).toBe(
      '0.2000',
    );
  });

  it('draws heart rate against its range, and no power, while a hold runs', () => {
    const root = rendered(<WorkoutStrip workout={held()} />);
    expect(root.querySelector('[role="img"]')?.getAttribute('data-oyl-lane')).toBe('heart-rate');
    const classes = classesOf(root);
    expect(classes).toContain('oyl-workout-strip__range');
    expect(classes).toContain('oyl-workout-strip__heart-rate');
    expect(classes.filter((name) => /target|power/.test(name))).toEqual([]);
    expect(textOf(root, 'p')).toEqual(['134 bpm, range 130–140 · Target 150 W']);
  });
});

describe('the paint tables and theme.css say the same thing — #1307', () => {
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

  for (const { className, token, property } of [...WORKOUT_GRAPH_PAINTS, ...WORKOUT_STRIP_PAINTS]) {
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

  it('names every painted .oyl-workout-graph__ and .oyl-workout-strip__ rule theme.css has', () => {
    const declared = new Set(
      [...css.matchAll(/\.(oyl-workout-(?:graph|strip)__[a-z0-9-]+)\s*\{([^{}]*)\}/g)]
        .filter(([, , body]) => /(?:^|;)\s*(fill|stroke):/.test(body ?? ''))
        .map(([, name]) => name),
    );
    expect(declared).toEqual(
      new Set([...WORKOUT_GRAPH_PAINTS, ...WORKOUT_STRIP_PAINTS].map(({ className }) => className)),
    );
  });

  /** Every colour a rule sets, whatever the property. */
  const coloursOf = (className: string): readonly string[] =>
    bodies(className).flatMap((body) =>
      [...body.matchAll(/var\(--oyl-color-([a-z-]+)\)/g)].map(([, name]) => name ?? ''),
    );

  it('paints the strip with the HUD’s own tokens and no well — not the page’s light surface', () => {
    const rules = [...css.matchAll(/\.(oyl-workout-strip[a-z0-9_-]*)\s*\{/g)].map(
      ([, name]) => name ?? '',
    );
    expect(rules.length).toBeGreaterThan(WORKOUT_STRIP_PAINTS.length);
    for (const name of rules) {
      for (const colour of coloursOf(name)) {
        expect(colour, name).toMatch(/^hud-/);
      }
      expect(bodies(name).join(';'), name).not.toMatch(/background/);
    }
    expect(coloursOf('oyl-workout-strip__text')).toEqual(['hud-ink']);
  });

  it('gives the strip no height of its own, so the HUD’s route-plan rule sizes it — #1169', () => {
    // Measured, not read off this: `browser/ride.browser.spec.ts` §"#1307".
    expect(bodies('oyl-workout-strip')).toHaveLength(1);
    expect(bodies('oyl-workout-strip')[0]).not.toMatch(/height:/);
  });

  it('writes the lanes’ numbers in ink on the frame’s own surface', () => {
    expect(coloursOf('oyl-workout-graph__frame')).toEqual(['surface', 'border']);
    expect(coloursOf('oyl-workout-graph__caption')).toEqual(['ink-muted']);
    expect(coloursOf('oyl-workout-graph__reading')).toEqual(['ink']);
    expect(coloursOf('oyl-workout-graph__scale')).toEqual(['ink-muted']);
  });
});
