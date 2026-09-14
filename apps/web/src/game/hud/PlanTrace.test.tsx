// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The plan view as a rider's browser actually renders it — #285.
 *
 * `plan.test.ts` asserts the arithmetic. This file asserts the four things that
 * only exist once the numbers are in a DOM: that a break is a separate `<path>`
 * rather than a count in a data structure, that the drawing is not stretched by
 * the attribute that would stretch it, that the rider's mark moves, and that
 * what a screen reader is handed is the sentence rather than a pile of paths.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { PlanTrace } from './PlanTrace';
import { describePlan, routePlan } from './plan';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
  routeProfile,
  type GeographicPosition,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

function straightRoute(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return routeProfile(points);
}

/** @see plan.test.ts — the shape `packages/store` can hand back and this cannot. */
function brokenRoute(): RouteProfile {
  const positions: GeographicPosition[] = [];
  for (let index = 0; index < 20; index += 1) {
    const offset = index < 10 ? index * 10 : 2_000 + (index - 10) * 10;
    positions.push(
      geographicPosition(
        degreesLatitude(51.5 + offset / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12),
      ),
    );
  }
  return {
    loop: false,
    resolution: metres(10),
    totalDistance: metres(190),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: positions.map(() => altitudeMetres(10)),
    grades: positions.map(() => gradePercent(0)),
    positions,
  };
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function markAt(): { readonly x: number; readonly y: number } {
  const mark = document.querySelector('[data-testid="oyl-hud-plan-here"]');
  if (mark === null) {
    throw new Error('no rider mark on the plan');
  }
  return {
    x: Number(mark.getAttribute('data-x')),
    y: Number(mark.getAttribute('data-y')),
  };
}

describe('the route is drawn as paths a browser can render', () => {
  it('draws one path for an unbroken route', async () => {
    mounted = await mount(<PlanTrace profile={straightRoute()} distance={0} />);

    expect(queryAll(mounted.container, 'path')).toHaveLength(1);
  });

  it('draws one path per run, so a jump is a hole rather than a line', async () => {
    mounted = await mount(<PlanTrace profile={brokenRoute()} distance={0} />);

    const paths = queryAll(mounted.container, 'path');
    expect(paths).toHaveLength(2);
    // Each path starts its own subpath and never continues into the other. A
    // single `<path>` carrying both runs would still be "two moves" — this
    // asserts they are two ELEMENTS, which is what makes each one styleable,
    // keyed and, above all, unjoined.
    for (const path of paths) {
      expect((path.getAttribute('d') ?? '').split('M')).toHaveLength(2);
    }
  });

  it('is not allowed to stretch, because the shape is the content', async () => {
    mounted = await mount(<PlanTrace profile={straightRoute()} distance={0} />);

    const svg = mounted.container.querySelector('svg');
    // `none` is what the elevation strip beside it uses, and copying it here is
    // the single most likely change to this file. It would let the box scale
    // each axis independently and turn a circuit into an ellipse.
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg?.getAttribute('preserveAspectRatio')).not.toBe('none');
  });
});

describe('the rider’s mark', () => {
  it('moves along the road as the rider rides', async () => {
    const profile = straightRoute();
    const total: number = profile.totalDistance;

    mounted = await mount(<PlanTrace profile={profile} distance={0} />);
    const start = markAt();
    mounted.unmount();

    mounted = await mount(<PlanTrace profile={profile} distance={total / 2} />);
    const middle = markAt();

    expect(Math.hypot(middle.x - start.x, middle.y - start.y)).toBeGreaterThan(1);
  });

  it('sits on the route rather than beside it', async () => {
    const profile = straightRoute();
    mounted = await mount(<PlanTrace profile={profile} distance={profile.totalDistance / 2} />);
    const mark = markAt();

    const drawn = routePlan(profile).runs.flatMap((run) => run.points);
    const nearest = Math.min(
      ...drawn.map((point) => Math.hypot(point.x - mark.x, point.y - mark.y)),
    );

    // Within a fifth of a viewBox unit of a drawn sample of the road itself.
    // A mark placed through a second, separately-derived projection would sit
    // some distance off its own road, and on a route whose bounds happened to
    // match it would sit on it — which is why this is asserted on a route whose
    // bounds do not.
    expect(nearest).toBeLessThan(0.2);
  });
});

describe('what a screen reader is handed', () => {
  it('is the sentence, on an element with a role, not a pile of paths', async () => {
    const profile = straightRoute();
    mounted = await mount(<PlanTrace profile={profile} distance={profile.totalDistance / 4} />);

    const svg = mounted.container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(describePlan(profile, profile.totalDistance / 4));
    expect(svg?.getAttribute('aria-label')).toContain('north up');
    // The paths themselves carry nothing a reader can use, and announcing a
    // hundred of them is worse than announcing none — `TraceChart.tsx`'s rule.
    expect(mounted.container.querySelector('g')?.getAttribute('aria-hidden')).toBe('true');
  });
});
