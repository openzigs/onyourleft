// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The road ahead on the rendered HUD — #2075.
 *
 * `look-ahead.test.ts` holds the arithmetic. This holds the wire: that the
 * real `HudPanel`, handed a ride at a distance on a synthetic climb, draws the
 * strip from that distance, fills each run with its band's own pattern, names
 * the climb the announcer would name, and fills the whole route's strip.
 * jsdom does no layout, so where the strip sits and how tall the route panel
 * is are the browser gate's (`ride.browser.spec.ts` and its siblings).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { mount, queryAll, type Mounted } from '../../testing/mount';
import { atStartLine, type GameState } from '../simulation';

import { slopeEvent, slopesOf } from './climb-ahead';
import { HudPanel } from './HudPanel';
import { GRADE_BANDS, LOOK_AHEAD_METRES, LOOK_AHEAD_RISE_METRES, lookAhead } from './look-ahead';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const STEP = 10;

/** 1 km flat at 100 m, 600 m at 6 %, 1.4 km flat — `look-ahead.test.ts`'s climb. */
function climb(): RouteProfile {
  const elevations = [100];
  for (let metre = STEP; metre <= 3000; metre += STEP) {
    elevations.push(metre <= 1000 ? 100 : metre <= 1600 ? 100 + ((metre - 1000) * 6) / 100 : 136);
  }
  const points: RoutePoint[] = elevations.map((elevation, index) => ({
    position: geographicPosition(
      degreesLatitude(51.5 + (index * STEP) / 111_320),
      degreesLongitude(-0.12),
    ),
    elevation: altitudeMetres(elevation),
  }));
  return routeProfile(points);
}

/** The ride at `distance` metres along `profile`. */
function at(profile: RouteProfile, distance: number): GameState {
  const start = atStartLine(profile);
  return { ...start, ride: { ...start.ride, distance: metres(distance) } };
}

async function hudAt(profile: RouteProfile, distance: number): Promise<HTMLElement> {
  mounted = await mount(
    <HudPanel
      profile={profile}
      state={at(profile, distance)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      onPause={() => undefined}
      onEnd={() => undefined}
      paused={false}
      announcement=""
    />,
  );
  return mounted.container;
}

describe('the look-ahead strip on the HUD (#2075)', () => {
  const profile = climb();

  it('is in the route panel, with the whole route’s strip', async () => {
    const hud = await hudAt(profile, 600);
    const strip = hud.querySelector('.oyl-hud__route [data-testid="oyl-hud-look-ahead"]');
    expect(strip).not.toBeNull();
    expect(strip?.parentElement?.querySelector('.oyl-hud__profile-svg')).not.toBeNull();
    expect(strip?.getAttribute('viewBox')).toBe(`0 0 ${String(LOOK_AHEAD_METRES)} 100`);
  });

  it('fills the climb ahead in the steep band, from where it starts', async () => {
    const hud = await hudAt(profile, 600);
    const runs = queryAll(hud, '.oyl-hud__ahead-run');
    expect(runs[0]?.getAttribute('data-band')).toBe('flat');
    expect(runs[0]?.getAttribute('data-start')).toBe('0');
    const leaving = runs.find((run) => run.getAttribute('data-band') !== 'flat');
    expect(Number(leaving?.getAttribute('data-start'))).toBeGreaterThan(330);
    expect(Number(leaving?.getAttribute('data-start'))).toBeLessThan(430);
    expect(runs.map((run) => run.getAttribute('data-band'))).toContain('steep');
  });

  it('draws it from the ride’s own distance: a rider further on sees the climb nearer', async () => {
    const farther = await hudAt(profile, 800);
    const start = (container: HTMLElement): number =>
      Number(
        queryAll(container, '.oyl-hud__ahead-run')
          .find((run) => run.getAttribute('data-band') !== 'flat')
          ?.getAttribute('data-start'),
      );
    const at800 = start(farther);
    mounted?.unmount();
    const nearer = await hudAt(profile, 600);
    expect(start(nearer) - at800).toBeCloseTo(200, -1);
  });

  /*
   * The owner's screenshot review of 2026-11-05: at the fixed scale a flat or
   * a descent ends on the window's floor, and drawn UNDER the road it was a
   * sliver. Every band is the strip's full height now, so its height says
   * nothing about its grade and each is as readable as the climb's.
   */
  it('draws every band at the strip’s full height, a descent and a flat as tall as a climb', async () => {
    // From 1500 m the window holds the top of the climb and the flat after it.
    const hud = await hudAt(profile, 1500);
    const runs = queryAll(hud, '.oyl-hud__ahead-run');
    const bands = runs.map((run) => run.getAttribute('data-band'));
    expect(bands).toContain('flat');
    expect(bands).toContain('steep');
    for (const run of runs) {
      expect(run.tagName.toLowerCase(), run.getAttribute('data-band') ?? '').toBe('rect');
      expect(run.getAttribute('y')).toBe('0');
      expect(run.getAttribute('height')).toBe(String(LOOK_AHEAD_RISE_METRES));
      expect(Number(run.getAttribute('x'))).toBe(Number(run.getAttribute('data-start')));
      expect(Number(run.getAttribute('width'))).toBe(
        Number(run.getAttribute('data-end')) - Number(run.getAttribute('data-start')),
      );
    }
  });

  it('draws the road over the bands at the fixed scale, from the ride’s own distance', async () => {
    const hud = await hudAt(profile, 1500);
    const road = hud.querySelector('[data-testid="oyl-hud-road-ahead"]');
    const strip = hud.querySelector('[data-testid="oyl-hud-look-ahead"]');
    // After every band, so it is drawn over them.
    const last = queryAll(hud, '.oyl-hud__ahead-run').at(-1);
    expect(last === undefined || road === null).toBe(false);
    expect(
      (last?.compareDocumentPosition(road as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(strip?.querySelector('.oyl-hud__ahead-road-edge')?.getAttribute('points')).toBe(
      road?.getAttribute('points'),
    );
    const expected = lookAhead(profile, 1500)
      .points.map(
        (point) =>
          `${String(point.ahead)},${String(LOOK_AHEAD_RISE_METRES - Math.min(LOOK_AHEAD_RISE_METRES, point.height))}`,
      )
      .join(' ');
    expect(road?.getAttribute('points')).toBe(expected);
  });

  it('fills every band with its own pattern, so colour is never the only signal', async () => {
    const hud = await hudAt(profile, 600);
    const patterns = queryAll(hud, '[data-testid="oyl-hud-look-ahead"] pattern');
    expect(patterns.map((pattern) => pattern.getAttribute('data-pattern'))).toEqual(
      GRADE_BANDS.map((band) => band.pattern),
    );
    for (const run of queryAll(hud, '.oyl-hud__ahead-run')) {
      const band = run.getAttribute('data-band');
      const reference = /^url\(#(.+)\)$/.exec(run.getAttribute('fill') ?? '')?.[1];
      const pattern = reference === undefined ? null : hud.querySelector(`[id="${reference}"]`);
      expect(pattern?.classList.contains(`oyl-hud__band--${band ?? ''}`)).toBe(true);
    }
    // Every patterned band carries marks; only the flat is its colour alone.
    for (const pattern of patterns) {
      const marks = pattern.querySelectorAll('.oyl-hud__band-mark, .oyl-hud__band-dot').length;
      expect(marks > 0, pattern.getAttribute('data-pattern') ?? '').toBe(
        pattern.getAttribute('data-pattern') !== 'none',
      );
    }
  });

  it('names the climb the announcer would say, from the same lookahead', async () => {
    const hud = await hudAt(profile, 600);
    const said = slopeEvent(undefined, {
      slopes: slopesOf(profile).filter((slope) => slope.kind === 'climb'),
      profile,
      distance: 600,
      lead: LOOK_AHEAD_METRES,
      units: 'metric',
    }).event?.text;
    // "Climb in 400 metres, 6 percent", spoken; "Climb in 400 m · 6 %", shown.
    const [, spokenMetres, spokenPercent] =
      /Climb in (\d+) metres, (\d+) percent/.exec(said ?? '') ?? [];
    const shown = hud.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent ?? '';
    expect(shown).toBe(`Climb in ${spokenMetres ?? '?'} m · ${spokenPercent ?? '?'} %`);
    expect(
      hud.querySelector('[data-testid="oyl-hud-look-ahead"]')?.getAttribute('aria-label'),
    ).toBe(
      `The next kilometre: next climb in ${spokenMetres ?? '?'} metres, ${spokenPercent ?? '?'} per cent average`,
    );
  });

  it('says nothing of a climb once it is behind, and leaves the route’s sentence as it was', async () => {
    const hud = await hudAt(profile, 1800);
    expect(hud.querySelector('[data-testid="oyl-hud-next-climb"]')).toBeNull();
    expect(hud.querySelector('.oyl-hud__profile-text')?.textContent).toMatch(/^\d+% complete$/);
    expect(
      hud.querySelector('[data-testid="oyl-hud-look-ahead"]')?.getAttribute('aria-label'),
    ).toBe('The next kilometre: no climb in the next kilometre');
  });

  it('fills the whole route’s strip, and keeps its marker', async () => {
    const hud = await hudAt(profile, 600);
    const fill = hud.querySelector('.oyl-hud__profile-svg .oyl-hud__profile-fill');
    expect(fill?.tagName.toLowerCase()).toBe('polygon');
    // Closed along the strip's floor at both ends.
    expect(fill?.getAttribute('points')?.startsWith('0,24 ')).toBe(true);
    expect(fill?.getAttribute('points')?.endsWith(' 100,24')).toBe(true);
    expect(hud.querySelector('[data-testid="oyl-hud-position"]')).not.toBeNull();
  });
});
