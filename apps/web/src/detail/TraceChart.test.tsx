// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, queryAll, type Mounted } from '../testing/mount';

import { distanceAxis, distanceProfile } from './axis';
import TraceChart, {
  describeTrace,
  TIME_AXIS_TITLE,
  traceAxes,
  type TraceChartProps,
} from './TraceChart';

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

  it('labels the shared time axis from the ride’s own span when one is given — #2068', () => {
    // A stacked chart on a two-hour ride whose trace is the first hour.
    expect(traceAxes({ ...POWER, timeSpan: 7200 }).times).toStrictEqual([
      '0:00',
      '1:00:00',
      '2:00:00',
    ]);
  });

  it('draws a trace over its share of a longer shared axis — #2068', async () => {
    mounted = await mount(<TraceChart {...POWER} timeSpan={7200} />);
    const d = mounted.container.querySelector('svg.oyl-trace path')?.getAttribute('d') ?? '';
    const xs = [...d.matchAll(/[ML](-?[\d.]+)/g)].map((match) => Number(match[1]));
    // An hour of a two-hour axis is the left half of the 600-unit drawing.
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBeCloseTo(300, 6);
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

/** The x of every vertex of every path in `root`'s trace. */
function xsOf(root: ParentNode): number[] {
  return queryAll(root, 'svg.oyl-trace path').flatMap((path) =>
    [...(path.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+)/g)].map((match) =>
      Number(match[1]),
    ),
  );
}

describe('the laps, as bands behind the trace — #2081', () => {
  const LAPS = [
    { number: 1, from: 0, to: 1200 },
    { number: 2, from: 1200, to: 2400 },
    { number: 3, from: 2400, to: 3600 },
  ];

  it('shades every other lap and draws an edge where each later lap begins', async () => {
    mounted = await mount(<TraceChart {...POWER} laps={LAPS} />);
    const bands = queryAll(mounted.container, 'rect.oyl-trace__lap').map((rect) => [
      rect.getAttribute('x'),
      rect.getAttribute('width'),
    ]);
    // An hour across 600 units: laps 1 and 3 shaded, lap 2 the well between.
    expect(bands).toStrictEqual([
      ['0.00', '200.00'],
      ['400.00', '200.00'],
    ]);
    expect(
      queryAll(mounted.container, 'line.oyl-trace__lap-edge').map((line) =>
        line.getAttribute('x1'),
      ),
    ).toStrictEqual(['200.00', '400.00']);
    // Behind the trace, and hidden with it.
    expect(mounted.container.querySelector('rect')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('says in the description how many laps are marked, so the bands are not only a picture', () => {
    expect(describeTrace({ ...POWER, laps: LAPS })).toContain('3 laps are marked as bands.');
    expect(describeTrace({ ...POWER, laps: LAPS.slice(0, 1) })).toContain(
      '1 lap is marked as bands.',
    );
    expect(describeTrace(POWER)).not.toContain('marked');
  });

  it('draws no band for a ride with no laps', async () => {
    mounted = await mount(<TraceChart {...POWER} />);
    expect(queryAll(mounted.container, 'rect, line.oyl-trace__lap-edge')).toHaveLength(0);
  });
});

describe('the distance axis — #2081', () => {
  // Half an hour at 10 m/s, then half an hour at 5 m/s: 27 km, two thirds of
  // it in the first half hour.
  const profile = distanceProfile(
    [...Array.from({ length: 1800 }, () => 10), ...Array.from({ length: 1800 }, () => 5)],
    1,
  );
  const axis = distanceAxis(profile, 'Distance ridden', (m) => `${(m / 1000).toFixed(1)} km`);

  it('places each point by the distance ridden by then, and labels the axis in distance', async () => {
    mounted = await mount(
      <TraceChart {...POWER} axis={axis} laps={[{ number: 2, from: 1800, to: 3600 }]} />,
    );
    // The point half an hour in is two thirds of the way across.
    const xs = xsOf(mounted.container);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBeCloseTo(600, 6);
    // Point 30 of 60 is drawn at 30/59 of the hour, 1 830.5 s: 18 km plus
    // 30.5 s at 5 m/s, 18 152.5 m of 27 000 — on a time axis it would be at 305.
    expect(xs[30]).toBeCloseTo((18_152.5 / 27_000) * 600, 2);
    // And the lap that starts then starts there too.
    expect(mounted.container.querySelector('line.oyl-trace__lap-edge')?.getAttribute('x1')).toBe(
      '400.00',
    );
    expect(
      queryAll(mounted.container, '.oyl-trace-chart__times > div').map((each) => each.textContent),
    ).toStrictEqual(['0.0 km', '13.5 km', '27.0 km']);
    expect(mounted.container.querySelector('.oyl-trace-chart__time-title')?.textContent).toBe(
      'Distance ridden',
    );
  });

  it('draws the cursor at the distance ridden by the cursor’s moment', async () => {
    mounted = await mount(<TraceChart {...POWER} axis={axis} cursor={1800} />);
    expect(mounted.container.querySelector('line.oyl-trace__cursor')?.getAttribute('x1')).toBe(
      '400.00',
    );
  });
});

describe('the tap and hover read-out — #2081', () => {
  /** Lay the drawing out at 300 px from x = 100, which jsdom does not. */
  function laidOut(svg: Element): void {
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 300,
      right: 400,
      top: 0,
      bottom: 96,
      height: 96,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
  }

  async function point(
    svg: Element,
    type: 'pointerdown' | 'pointermove',
    clientX: number,
    pointerType: string,
  ): Promise<void> {
    await act(async () => {
      svg.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerType }));
      await Promise.resolve();
    });
  }

  it('moves the cursor to the moment under a tap', async () => {
    const picked: number[] = [];
    mounted = await mount(
      <TraceChart {...POWER} onPick={(at) => picked.push(at)} timeSpan={3600} />,
    );
    const svg = mounted.container.querySelector('svg.oyl-trace') as Element;
    laidOut(svg);
    // A quarter of the way across an hour.
    await point(svg, 'pointerdown', 175, 'touch');
    expect(picked).toStrictEqual([900]);
  });

  it('follows a mouse hovering, and leaves a finger dragging to scroll the page', async () => {
    const picked: number[] = [];
    mounted = await mount(<TraceChart {...POWER} onPick={(at) => picked.push(at)} />);
    const svg = mounted.container.querySelector('svg.oyl-trace') as Element;
    laidOut(svg);
    await point(svg, 'pointermove', 250, 'mouse');
    await point(svg, 'pointermove', 400, 'touch');
    expect(picked).toStrictEqual([1800]);
  });

  it('asks nothing of a drawing that has not been laid out', async () => {
    const picked: number[] = [];
    mounted = await mount(<TraceChart {...POWER} onPick={(at) => picked.push(at)} />);
    await point(
      mounted.container.querySelector('svg.oyl-trace') as Element,
      'pointerdown',
      50,
      'mouse',
    );
    expect(picked).toStrictEqual([]);
  });

  it('shows the chart’s own reading at the cursor beside its title, hidden from a screen reader', async () => {
    mounted = await mount(<TraceChart {...POWER} cursor={60} cursorReading="200 W" />);
    const reading = mounted.container.querySelector('.oyl-trace-chart__reading');
    expect(reading?.textContent).toBe('200 W');
    expect(reading?.getAttribute('aria-hidden')).toBe('true');
    // The title keeps its own words.
    expect(mounted.container.querySelector('.oyl-trace-chart__value-title')?.textContent).toBe(
      'Power (W)',
    );
  });
});
