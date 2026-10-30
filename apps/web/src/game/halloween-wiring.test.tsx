// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Halloween's window through the real path — #1625. A ride started in a
 * mounted `GameView` on a device day, with the Settings switch as the device
 * holds it; the frames and the season the view hands its renderer; and the
 * product's `DecorationBelt` updated with them and the product's own table,
 * as `three-renderer.ts` §`ThreeGameView.render` updates it. What is read is
 * the belt's mesh, never `decorationsFor`.
 *
 * ⚠️ jsdom has no WebGL, so the product's view stages nothing here (its
 * `render` returns without a context): the belt is updated with what the view
 * was handed, by the same call the view makes. And a ride starts in open
 * country, so the belt is updated with the camera at the first village the
 * frame's streets hold, rather than where the rider is.
 * `realistic-town.browser.spec.ts` reads the belt off a real view's frame.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { HOLIDAY_DECORATIONS } from './decorations';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { HOLIDAY_DECORATIONS_STORAGE_KEY } from './holiday-preference';
import type { GameRenderer, SceneFrame } from './port';
import type { CalendarDay, Season } from './season';
import { DECORATION_GLOW_ATTRIBUTE, DecorationBelt } from './three-renderer';

/** Three kilometres north from London: its first village's street starts about 190 m in. */
function northernRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 300; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-north', name: 'North', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([northernRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

let frames: SceneFrame[] = [];
let seasons: Season[] = [];

const RENDERER: GameRenderer = {
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: (frame) => {
      frames.push(frame);
    },
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: (season) => {
      seasons.push(season);
    },
    resize: () => undefined,
    destroy: () => undefined,
  }),
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let clock = 0;

beforeEach(() => {
  pending = [];
  frames = [];
  seasons = [];
  clock = 0;
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});

/**
 * Start a ride on `day`, then update a belt as the view does with the last
 * frame and season it was handed: its vertices, and how many glow.
 */
async function beltOn(day: CalendarDay): Promise<{ vertices: number; glowing: number }> {
  mounted = await mount(
    <GameView
      port={PORT}
      renderer={() => Promise.resolve(RENDERER)}
      now={() => clock}
      today={() => day}
    />,
  );
  await settle();
  const button = queryAll<HTMLButtonElement>(mounted.container, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
  for (let index = 0; index < 3; index += 1) {
    clock += 16;
    await act(async () => {
      pending.shift()?.(clock);
      await Promise.resolve();
    });
  }
  await settle();
  mounted.unmount();
  mounted = undefined;
  const frame = frames.at(-1);
  const season = seasons.at(-1);
  if (frame === undefined || season === undefined) throw new Error('the ride drew no frame');
  // Non-vacuity: the frame holds a village, with house steps to stand on.
  const village = frame.streets.find((street) =>
    street.anchors.some((anchor) => anchor.step?.building === 'building'),
  );
  const at = village?.anchors[0];
  if (at === undefined) throw new Error('the ride’s frame holds no village');
  const belt = new DecorationBelt('stylised');
  try {
    belt.update(frame.streets, { x: at.x, z: at.z }, season.holiday, HOLIDAY_DECORATIONS);
    if (!belt.mesh.visible) return { vertices: 0, glowing: 0 };
    const glow = belt.mesh.geometry.getAttribute(DECORATION_GLOW_ATTRIBUTE);
    let glowing = 0;
    for (let index = 0; index < glow.count; index += 1) if (glow.getX(index) === 1) glowing += 1;
    return { vertices: belt.mesh.geometry.getAttribute('position').count, glowing };
  } finally {
    belt.dispose();
  }
}

describe('Halloween’s pumpkins, from the device’s day to the belt — #1625', () => {
  it('are drawn on a ride started on 31 Oct, with jack-o’-lanterns’ faces glowing', async () => {
    const on = await beltOn({ year: 2026, month: 10, day: 31 });
    expect(on.vertices).toBeGreaterThan(0);
    expect(on.glowing).toBeGreaterThan(0);
  });

  it('are not drawn on a ride started on 2 Nov', async () => {
    expect(await beltOn({ year: 2026, month: 11, day: 2 })).toEqual({ vertices: 0, glowing: 0 });
  });

  it('are not drawn on 31 Oct with the Settings switch off', async () => {
    localStorage.setItem(HOLIDAY_DECORATIONS_STORAGE_KEY, 'off');
    expect(await beltOn({ year: 2026, month: 10, day: 31 })).toEqual({
      vertices: 0,
      glowing: 0,
    });
  });
});
