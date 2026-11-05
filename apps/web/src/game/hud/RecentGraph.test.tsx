// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's recent graph, drawn — #2078: a gap is a break in the line, the
 * zones are the rider's own threshold's, and it is redrawn only when a second
 * is written.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { watts } from '@onyourleft/domain';

import { mount, queryAll, type Mounted } from '../../testing/mount';

import { RecentGraph, powerScaleTop, runsOf } from './RecentGraph';
import { RECENT_TRACE_SECONDS, type TraceSample } from './recent-trace';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const sample = (power: number | undefined, heartRate: number | undefined): TraceSample => ({
  power,
  heartRate,
});

describe('a gap in the line (#2078)', () => {
  it('starts a new run after every gap, so a dropout is never drawn across', () => {
    const runs = runsOf([100, 110, undefined, 120, undefined, undefined, 130], 0, (value) => value);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toBe('M0.0 100.00 L0.0 100.00 L1.0 110.00');
    // An isolated reading is a run of its own — a dot, never dropped.
    expect(runs[1]).toBe('M3.0 120.00 L3.0 120.00');
    expect(runs[2]).toBe('M6.0 130.00 L6.0 130.00');
  });

  it('draws nothing for a window of gaps, and never a zero', () => {
    expect(runsOf([undefined, undefined], 0, (value) => value)).toEqual([]);
  });
});

describe('the scale (#2078)', () => {
  it('reaches past zone 7’s floor of the threshold, or the peak, whichever is higher', () => {
    expect(powerScaleTop([sample(200, 120)], watts(250))).toBe(400);
    expect(powerScaleTop([sample(900, 120)], watts(250))).toBe(900);
    expect(powerScaleTop([sample(undefined, 120)], undefined)).toBe(300);
  });
});

describe('the graph on the HUD (#2078)', () => {
  const samples = [
    sample(150, 120),
    sample(undefined, 121),
    sample(260, undefined),
    sample(270, 140),
  ];

  it('draws the power and the heart rate as runs over the threshold’s zone bands, right-aligned', async () => {
    mounted = await mount(<RecentGraph samples={samples} written={4} threshold={watts(250)} />);
    const svg = mounted.container.querySelector('[data-testid="oyl-hud-recent"]');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${String(RECENT_TRACE_SECONDS)} 100`);
    // Power: a gap at the second sample, so two runs.
    const power = queryAll(mounted.container, '.oyl-hud__recent-power');
    expect(power).toHaveLength(2);
    // The newest second is the right-hand edge.
    expect(power[1]?.getAttribute('d')).toContain(`L${(RECENT_TRACE_SECONDS - 1).toFixed(1)} `);
    // Heart rate: a gap at the third, so two runs, dashed by its class.
    expect(queryAll(mounted.container, '.oyl-hud__recent-heart')).toHaveLength(2);
    // The seven zones of a 250 W threshold, each its own band.
    expect(
      queryAll(mounted.container, '.oyl-hud__recent-band').map((band) =>
        band.getAttribute('data-zone'),
      ),
    ).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('draws no bands with no threshold set', async () => {
    mounted = await mount(<RecentGraph samples={samples} written={4} threshold={undefined} />);
    expect(queryAll(mounted.container, '.oyl-hud__recent-band')).toEqual([]);
    expect(queryAll(mounted.container, '.oyl-hud__recent-power')).toHaveLength(2);
  });

  it('is redrawn when a second is written, and at no other render', async () => {
    mounted = await mount(<RecentGraph samples={samples} written={4} threshold={watts(250)} />);
    const svg = (): Element | null =>
      mounted?.container.querySelector('[data-testid="oyl-hud-recent"]') ?? null;
    const before = svg()?.querySelectorAll('.oyl-hud__recent-power').length;
    // A frame's render with the same second written: new samples are ignored.
    await mounted?.rerender(
      <RecentGraph samples={[sample(999, 99)]} written={4} threshold={watts(250)} />,
    );
    expect(svg()?.getAttribute('data-oyl-graph-written')).toBe('4');
    expect(svg()?.querySelectorAll('.oyl-hud__recent-power').length).toBe(before);
    // The next second: drawn again.
    await mounted?.rerender(
      <RecentGraph samples={[sample(999, 99)]} written={5} threshold={watts(250)} />,
    );
    expect(svg()?.getAttribute('data-oyl-graph-written')).toBe('5');
    expect(svg()?.querySelectorAll('.oyl-hud__recent-power').length).toBe(1);
  });
});
