// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A move of the cursor hands every chart the axis it already had** — #2194.
 *
 * `detail/TraceChart.tsx` §`lines` keeps its paths, up to 600 points a
 * trace, for as long as the trace and the axis are the same objects
 * (`TraceChart.test.tsx` §"draws its paths once a trace" is that half). A
 * page that built a new axis on every render would hand each chart a fresh
 * one on every step of the cursor, and every chart would draw every path
 * again — which looks identical in the DOM, so only the props can say it.
 * This file replaces the chart with one that records the props it is given,
 * which is why it is a file of its own: `vi.mock` holds for a whole file.
 */

import { beatsPerMinute, metresPerSecond, watts } from '@onyourleft/domain';
import { activityId, athleteId } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubActivity, stubDetail, stubLap } from '../detail/testing';
import type { RideAxis } from '../detail/axis';
import type { TraceChartProps } from '../detail/TraceChart';
import { mount, settle, typeInto, type Mounted } from '../testing/mount';

import { ActivityDetailView } from './ActivityDetailView';

const handed = vi.hoisted(() => ({ props: [] as { label: string; axis: unknown }[] }));

vi.mock('../detail/TraceChart', async (original) => {
  const real = await original<typeof import('../detail/TraceChart')>();
  return {
    ...real,
    default: (props: TraceChartProps) => {
      handed.props.push({ label: props.label, axis: props.axis });
      return <svg className="oyl-trace" />;
    },
  };
});

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  handed.props.length = 0;
});

/** The axes the chart labelled `label` was handed, render by render. */
function axesOf(label: string): unknown[] {
  return handed.props.filter((props) => props.label === label).map((props) => props.axis);
}

async function open(): Promise<void> {
  await import('../detail/TraceChart');
  mounted = await mount(
    <ActivityDetailView
      port={stubDetail(ATHLETE, {
        activity: stubActivity({ hasPosition: false }),
        channels: {
          power: Array.from({ length: 1200 }, () => watts(200)),
          heartRate: Array.from({ length: 1200 }, () => beatsPerMinute(140)),
          speed: Array.from({ length: 1200 }, () => metresPerSecond(10)),
        },
        laps: [stubLap(0)],
      })}
      activityId={RIDE}
    />,
  );
  await settle();
  await settle();
}

async function moveTo(seconds: number): Promise<void> {
  await typeInto(document.querySelector('#oyl-trace-cursor') as HTMLInputElement, String(seconds));
  await settle();
}

describe('#2194 — the axis every chart is handed stays the same while the cursor moves', () => {
  it('on time', async () => {
    await open();
    const before = axesOf('Power').length;
    expect(before).toBeGreaterThan(0);
    for (const at of [100, 200, 300]) {
      await moveTo(at);
    }
    const power = axesOf('Power');
    expect(power.length).toBeGreaterThan(before);
    expect(new Set(power.slice(before - 1)).size).toBe(1);
    expect(new Set(axesOf('Heart rate').slice(-4)).size).toBe(1);
    expect((power.at(-1) as RideAxis).kind).toBe('time');
  });

  it('on distance', async () => {
    await open();
    await act(async () => {
      document
        .querySelector<HTMLInputElement>('input[name="oyl-trace-axis"][value="distance"]')
        ?.click();
      await Promise.resolve();
    });
    await settle();
    await settle();
    const before = axesOf('Power').length;
    expect((axesOf('Power').at(-1) as RideAxis).kind).toBe('distance');
    for (const at of [100, 200, 300]) {
      await moveTo(at);
    }
    const power = axesOf('Power');
    expect(power.length).toBeGreaterThan(before);
    expect(new Set(power.slice(before - 1)).size).toBe(1);
  });
});
