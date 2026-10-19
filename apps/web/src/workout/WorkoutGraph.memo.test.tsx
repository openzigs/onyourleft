// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The graph is worked out again only when something it reads changes — #1313.
 *
 * The controller's snapshot is a new object on every change of the ride,
 * several a second; what the graph draws changes about once a second. Its own
 * file because the module under the component is spied on here, so a call can
 * be counted.
 */

import { describe, expect, it, vi } from 'vitest';

import { expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';

import { mount } from '../testing/mount';

import * as graph from './workout-graph';
import { WorkoutGraph, WorkoutStrip } from './WorkoutGraph';

vi.mock('./workout-graph', async (importOriginal) => {
  const original = await importOriginal<typeof import('./workout-graph')>();
  return {
    ...original,
    workoutGraphPaths: vi.fn(original.workoutGraphPaths),
    workoutStripPaths: vi.fn(original.workoutStripPaths),
  };
});

const TIMELINE = expandWorkout({
  name: 'test',
  blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) }],
});

/** The same length, harder: what an accepted re-plan hands over. */
const REPLANNED = expandWorkout({
  name: 'test',
  blocks: [{ kind: 'steady', seconds: seconds(600), target: thresholdShare(0.7) }],
});

const SAMPLE = { at: 299, target: 150, power: 146, heartRate: 134, range: undefined };

/** Every field of the input, set — so a field the key leaves out is a field this misses. */
const FULL: Required<graph.WorkoutGraphInput> = {
  elapsedSeconds: 300,
  timeline: TIMELINE,
  holdingWatts: 150,
  thresholdWatts: 250,
  trace: [SAMPLE],
  replaced: [],
  hold: { reason: 'settling', target: 160 },
  rescue: { kind: 'relief' },
  status: 'running',
  hasControl: true,
  targetConfirmed: true,
  live: { power: 146, heartRate: 134 },
  raisedFromWatts: 120,
  refused: false,
};

/** A different value for every field the key covers. */
const CHANGED: { readonly [K in keyof graph.WorkoutGraphInput]?: graph.WorkoutGraphInput[K] } = {
  elapsedSeconds: 301,
  holdingWatts: 151,
  thresholdWatts: 251,
  hold: { reason: 'settling', target: 161 },
  rescue: undefined,
  status: 'paused',
  hasControl: false,
  targetConfirmed: false,
  live: { power: 147, heartRate: 134 },
  raisedFromWatts: 121,
  refused: true,
};

/** The three the component keys on by identity. */
const ARRAYS = ['timeline', 'trace', 'replaced'] as const;

describe('the memo key — #1313', () => {
  it('changes with every field of the input that is not one of the three arrays', () => {
    const fields = Object.keys(FULL).filter(
      (field) => !(ARRAYS as readonly string[]).includes(field),
    );
    expect(Object.keys(CHANGED).sort()).toEqual([...fields].sort());
    const key = graph.workoutGraphMemoKey(FULL);
    for (const field of fields) {
      const changed = { ...FULL, [field]: CHANGED[field as keyof typeof CHANGED] };
      expect(graph.workoutGraphMemoKey(changed), field).not.toBe(key);
    }
  });

  it('tells each reading apart, and an absent `live` from two readings that are not live', () => {
    const key = graph.workoutGraphMemoKey(FULL);
    expect(graph.workoutGraphMemoKey({ ...FULL, live: { power: 146, heartRate: 135 } })).not.toBe(
      key,
    );
    expect(graph.workoutGraphMemoKey({ ...FULL, live: undefined })).not.toBe(
      graph.workoutGraphMemoKey({ ...FULL, live: { power: undefined, heartRate: undefined } }),
    );
  });

  it('is the same for a new object with the same values', () => {
    expect(graph.workoutGraphMemoKey({ ...FULL })).toBe(graph.workoutGraphMemoKey(FULL));
  });
});

describe('the graph and the strip are worked out again only when what they read changes — #1313', () => {
  for (const [name, render, worked] of [
    ['the graph', WorkoutGraph, graph.workoutGraphPaths],
    ['the strip', WorkoutStrip, graph.workoutStripPaths],
  ] as const) {
    it(`${name}: not for a new snapshot of the same values, and again for a new value or a new trace`, async () => {
      const spy = vi.mocked(worked);
      const Component = render;
      const mounted = await mount(<Component workout={{ ...FULL }} />);
      const once = spy.mock.calls.length;
      expect(once).toBeGreaterThan(0);

      // A new object, as the controller hands over on every notification.
      await mounted.rerender(<Component workout={{ ...FULL }} />);
      await mounted.rerender(<Component workout={{ ...FULL }} />);
      expect(spy.mock.calls.length).toBe(once);

      // A new reading is drawn.
      await mounted.rerender(
        <Component workout={{ ...FULL, live: { power: 200, heartRate: 134 } }} />,
      );
      expect(spy.mock.calls.length).toBe(once + 1);
      // A new sample is a new trace, and is drawn.
      await mounted.rerender(
        <Component
          workout={{
            ...FULL,
            live: { power: 200, heartRate: 134 },
            trace: [SAMPLE, { ...SAMPLE, at: 300 }],
          }}
        />,
      );
      expect(spy.mock.calls.length).toBe(once + 2);
      mounted.unmount();
    });

    it(`${name}: again for a new plan, and again for a new outline of what a re-plan replaced, with every other value the same`, async () => {
      const spy = vi.mocked(worked);
      const Component = render;
      const mounted = await mount(<Component workout={{ ...FULL }} />);
      const once = spy.mock.calls.length;

      // An accepted re-plan: the player's plan is a new object, and nothing in
      // the key has moved (the clock is the same within the second).
      const replanned = { ...FULL, timeline: REPLANNED };
      await mounted.rerender(<Component workout={replanned} />);
      expect(spy.mock.calls.length).toBe(once + 1);
      await mounted.rerender(<Component workout={{ ...replanned }} />);
      expect(spy.mock.calls.length).toBe(once + 1);

      // What it replaced arrives as its own new array.
      await mounted.rerender(<Component workout={{ ...replanned, replaced: TIMELINE.segments }} />);
      expect(spy.mock.calls.length).toBe(once + 2);
      mounted.unmount();
    });
  }
});
