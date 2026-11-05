// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { seconds, watts, type PowerDurationCurve } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, queryAll, type Mounted } from '../testing/mount';

import { RIDE_CURVE_DURATIONS } from './curve';
import PowerCurveChart, {
  ALL_TIME_CURVE_LABEL,
  CURVE_HEIGHT,
  CURVE_WIDTH,
  RIDE_CURVE_LABEL,
} from './PowerCurveChart';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const curve = (entries: readonly (readonly [number, number])[]): PowerDurationCurve =>
  entries.map(([duration, power]) => ({ duration: seconds(duration), power: watts(power) }));

/** Each vertex of a path, as `[x, y]` in the drawing's own units. */
function vertices(path: Element | null): (readonly [number, number])[] {
  return [...(path?.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as const,
  );
}

const RIDE = curve([
  [5, 800],
  [60, 400],
  [300, 300],
  [1200, 250],
]);
const ALL_TIME = curve([
  [5, 1000],
  [60, 450],
  [300, 320],
  [1200, 280],
  [3600, 240],
]);

describe('the power curve drawing — #2081', () => {
  it('draws each effort at its duration’s place across and its watts up, from nought at the bottom', async () => {
    mounted = await mount(<PowerCurveChart ride={RIDE} allTime={ALL_TIME} />);
    const peak = 1000;
    const last = RIDE_CURVE_DURATIONS.length - 1;
    const read = (path: Element | null): (readonly [number, number])[] =>
      vertices(path).map(([x, y]) => [
        RIDE_CURVE_DURATIONS[Math.round((x / CURVE_WIDTH) * last)] ?? -1,
        Math.round(((CURVE_HEIGHT - y) / CURVE_HEIGHT) * peak),
      ]);
    // Read back off the drawing, the values are the curves'.
    expect(read(mounted.container.querySelector('path.oyl-curve__ride'))).toStrictEqual(
      RIDE.map((effort) => [effort.duration, effort.power]),
    );
    expect(read(mounted.container.querySelector('path.oyl-curve__all-time'))).toStrictEqual(
      ALL_TIME.map((effort) => [effort.duration, effort.power]),
    );
    // Five seconds at the left edge and an hour at the right.
    expect(vertices(mounted.container.querySelector('path.oyl-curve__all-time'))[0]?.[0]).toBe(0);
    expect(vertices(mounted.container.querySelector('path.oyl-curve__all-time')).at(-1)?.[0]).toBe(
      CURVE_WIDTH,
    );
  });

  it('labels the value axis from the higher curve’s peak to nought, and the durations under it', async () => {
    mounted = await mount(<PowerCurveChart ride={RIDE} allTime={ALL_TIME} />);
    const chart = mounted.container.querySelector('.oyl-curve-chart');
    expect(
      queryAll(chart as Element, '.oyl-curve-chart__values > div').map((each) => each.textContent),
    ).toStrictEqual(['1000 W', '500 W', '0 W']);
    expect(
      queryAll(chart as Element, '.oyl-curve-chart__times > div').map((each) => each.textContent),
    ).toStrictEqual(['5s', '5min', '1h']);
  });

  it('names both lines in a legend, and draws the second dashed, so colour is not the only carrier', async () => {
    mounted = await mount(<PowerCurveChart ride={RIDE} allTime={ALL_TIME} />);
    expect(
      queryAll(mounted.container, '.oyl-curve-chart__legend li').map((each) => each.textContent),
    ).toStrictEqual([RIDE_CURVE_LABEL, ALL_TIME_CURVE_LABEL]);
    expect(mounted.container.querySelector('.oyl-curve-chart__key--all-time')).not.toBeNull();
  });

  it('draws the ride’s line alone where there is no all-time curve', async () => {
    mounted = await mount(<PowerCurveChart ride={RIDE} />);
    expect(queryAll(mounted.container, 'path')).toHaveLength(1);
    expect(
      queryAll(mounted.container, '.oyl-curve-chart__legend li').map((each) => each.textContent),
    ).toStrictEqual([RIDE_CURVE_LABEL]);
    expect(
      queryAll(mounted.container, '.oyl-curve-chart__values > div').map((each) => each.textContent),
    ).toStrictEqual(['800 W', '400 W', '0 W']);
  });

  it('is one described image, its paths and axes hidden from a screen reader', async () => {
    mounted = await mount(<PowerCurveChart ride={RIDE} allTime={ALL_TIME} />);
    const svg = mounted.container.querySelector('svg.oyl-curve');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain("This ride's best: 5s 800 W");
    expect(svg?.querySelector('g')?.getAttribute('aria-hidden')).toBe('true');
    for (const part of queryAll(mounted.container, '.oyl-curve-chart > :not(svg)')) {
      expect(part.getAttribute('aria-hidden'), part.className).toBe('true');
    }
  });
});
