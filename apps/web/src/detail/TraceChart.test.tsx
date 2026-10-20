// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { mount, queryAll, type Mounted } from '../testing/mount';

import TraceChart, { TIME_AXIS_TITLE, traceAxes, type TraceChartProps } from './TraceChart';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** An hour of power, 100 W to 300 W, one point a minute. */
const POWER: TraceChartProps = {
  label: 'Power',
  unit: 'W',
  points: Array.from({ length: 60 }, (_unused, index) =>
    index === 0 ? 100 : index === 59 ? 300 : 200,
  ),
  secondsPerPoint: 60,
  format: (value) => String(Math.round(value)),
  missingSamples: 0,
};

describe('the trace’s axes — #1439', () => {
  it('labels the value axis with its name and unit, top to bottom on the drawing’s own scale', () => {
    const axes = traceAxes(POWER);
    expect(axes.valueTitle).toBe('Power (W)');
    expect(axes.values).toStrictEqual(['300 W', '200 W', '100 W']);
  });

  it('labels the time axis from the start of the ride to its end', () => {
    const axes = traceAxes(POWER);
    expect(axes.timeTitle).toBe(TIME_AXIS_TITLE);
    expect(axes.times).toStrictEqual(['0:00', '30:00', '1:00:00']);
  });

  it('puts a flat trace’s one value in the middle, where it is drawn', () => {
    const flat = { ...POWER, points: POWER.points.map(() => 150) };
    expect(traceAxes(flat).values).toStrictEqual(['', '150 W', '']);
  });

  it('draws both axes beside the drawing, and leaves the drawing its description', async () => {
    mounted = await mount(<TraceChart {...POWER} />);
    const chart = mounted.container.querySelector('.oyl-trace-chart');
    expect(chart?.querySelector('.oyl-trace-chart__value-title')?.textContent).toBe('Power (W)');
    expect(
      queryAll(chart as Element, '.oyl-trace-chart__values > div').map((each) => each.textContent),
    ).toStrictEqual(['300 W', '200 W', '100 W']);
    expect(
      queryAll(chart as Element, '.oyl-trace-chart__times > div').map((each) => each.textContent),
    ).toStrictEqual(['0:00', '30:00', '1:00:00']);
    expect(chart?.querySelector('.oyl-trace-chart__time-title')?.textContent).toBe(TIME_AXIS_TITLE);
    // The drawing is still the one image, described in words; the axes are
    // not read out between it and the table.
    const svg = chart?.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toContain('from 100 to 300 W');
    for (const axis of queryAll(chart as Element, ':scope > :not(svg)')) {
      expect(axis.getAttribute('aria-hidden'), axis.className).toBe('true');
    }
  });
});
