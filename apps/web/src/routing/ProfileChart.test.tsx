// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type HeightProfile,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, queryAll, type Mounted } from '../testing/mount';
import { ELEVATION_INTERVAL_METRES, elevationFrom, type PlannedElevation } from './elevation';
import {
  PROFILE_CHART_HEIGHT,
  PROFILE_CHART_POINTS,
  PROFILE_CHART_WIDTH,
  ProfileChart,
  profileChart,
} from './ProfileChart';
import { GLO30 } from './testing';

const INTERVAL = metres(ELEVATION_INTERVAL_METRES);

/** A straight line north, `long` metres, with one height per 30 m sample. */
function planned(elevations: readonly (number | undefined)[], long: number): PlannedElevation {
  const shape = [
    geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    geographicPosition(degreesLatitude(51.5 + long / 111_320), degreesLongitude(-0.12)),
  ];
  const heights: HeightProfile = {
    source: GLO30,
    samples: elevations.map((elevation, index) => ({
      along: metres(index * ELEVATION_INTERVAL_METRES),
      elevation: elevation === undefined ? undefined : altitudeMetres(elevation),
    })),
  };
  const result = elevationFrom(shape, heights, INTERVAL);
  if (result === undefined) throw new Error('fixture produced no profile');
  return result;
}

/** Every point of a path's `d`, as numbers. */
function points(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('the planned profile, drawn (#3185)', () => {
  const rising = Array.from({ length: 41 }, (_, i) => 100 + i * 2);

  it('draws one line across the drawing, low on the left and high on the right', () => {
    const chart = profileChart(planned(rising, 1_200), 'metric');
    expect(chart.lines).toHaveLength(1);
    const drawn = points(chart.lines[0] ?? '');
    expect(drawn[0]?.x).toBe(0);
    expect(drawn.at(-1)?.x).toBe(PROFILE_CHART_WIDTH);
    // SVG's y grows downwards: the start is near the bottom, the end near the top.
    expect(drawn[0]?.y).toBeGreaterThan(PROFILE_CHART_HEIGHT * 0.9);
    expect(drawn.at(-1)?.y).toBeLessThan(PROFILE_CHART_HEIGHT * 0.1);
  });

  it('breaks the line where the dataset has no height, rather than drawing a guessed ramp', () => {
    const holed = [...rising.slice(0, 15), undefined, undefined, undefined, ...rising.slice(18)];
    const profile = planned(holed, 1_200);
    expect(profile.coverage.gaps.length).toBeGreaterThan(0);
    const chart = profileChart(profile, 'metric');
    expect(chart.lines).toHaveLength(2);
    // No drawn point lies inside the hole.
    const gap = profile.coverage.gaps[0];
    if (gap === undefined) throw new Error('no gap');
    const xs = chart.lines.flatMap((line) => points(line).map((point) => point.x));
    const holeFrom = (gap.from / profile.profile.totalDistance) * PROFILE_CHART_WIDTH;
    const holeTo = (gap.to / profile.profile.totalDistance) * PROFILE_CHART_WIDTH;
    expect(xs.filter((x) => x > holeFrom && x < holeTo)).toEqual([]);
  });

  it('draws a flat route down the middle, with its one height there', () => {
    const chart = profileChart(planned(Array<number>(41).fill(50), 1_200), 'metric');
    expect(new Set(points(chart.lines[0] ?? '').map((point) => point.y))).toEqual(
      new Set([PROFILE_CHART_HEIGHT / 2]),
    );
    expect(chart.heights).toEqual(['', '50 m', '']);
  });

  it('labels its heights and its distance in the units the rider reads', () => {
    const metric = profileChart(planned(rising, 1_200), 'metric');
    expect(metric.elevationTitle).toBe('Elevation (m)');
    expect(metric.distanceTitle).toBe('Distance (km)');
    expect(metric.heights).toEqual(['180 m', '140 m', '100 m']);
    expect(metric.distances).toEqual(['0.0', '0.6', '1.2']);
    const imperial = profileChart(planned(rising, 1_200), 'imperial');
    expect(imperial.elevationTitle).toBe('Elevation (ft)');
    expect(imperial.distanceTitle).toBe('Distance (mi)');
    expect(imperial.heights[0]).toBe('591 ft');
  });

  it('draws no more points than the drawing is wide, however long the route', () => {
    const long = 200_000;
    const samples = Math.ceil(long / ELEVATION_INTERVAL_METRES) + 1;
    const profile = planned(
      Array.from({ length: samples }, (_, i) => 100 + 50 * Math.sin(i / 40)),
      long,
    );
    expect(profile.profile.elevations.length).toBeGreaterThan(PROFILE_CHART_POINTS * 10);
    const chart = profileChart(profile, 'metric');
    expect(points(chart.lines.join(' ')).length).toBe(PROFILE_CHART_POINTS);
  });

  it('hides the drawing from a screen reader, which reads the sentence and the table', async () => {
    mounted = await mount(<ProfileChart planned={planned(rising, 1_200)} units="metric" />);
    const root = mounted.container.firstElementChild;
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(queryAll(mounted.container, 'path')).toHaveLength(1);
    expect(mounted.container.textContent).toContain('Elevation (m)');
  });
});
