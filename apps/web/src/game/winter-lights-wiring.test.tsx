// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The winter lights' window through the real path — #1626. A ride started in
 * a mounted `GameView` on a device day, with the Settings switch as the device
 * holds it. Its frames and its season go two ways, each as the product's view
 * takes them: into the product's `DecorationBelt` with the product's own
 * table (what is read is the belt's mesh, never `decorationsFor`), and into
 * the product's own view (`threeGameRenderer`), whose `setSeason` writes the
 * mapped doors' wreath — read off a mapped building's facade material as its
 * program is handed it.
 *
 * ⚠️ jsdom has no WebGL, so the product's view stages nothing here: the belt
 * is updated with what the view was handed, by the same call the view makes,
 * and with the camera at the first village the frame's streets hold, because
 * a ride starts in open country. `realistic-town.browser.spec.ts` reads the
 * belt off a real view's frame.
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
import { mappedBuildingsOf } from './mapped-buildings';
import type { GameRenderer, SceneFrame } from './port';
import { qualitySettings } from './quality';
import type { CalendarDay, Season } from './season';
import {
  DECORATION_GLOW_ATTRIBUTE,
  DecorationBelt,
  facadeWreathOf,
  MappedBuildingBelt,
  threeGameRenderer,
} from './three-renderer';

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
let destroyers: (() => void)[] = [];

/** A double that owns the context jsdom lacks, telling the product's own view the season. */
const RENDERER: GameRenderer = {
  create: (canvas) => {
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    destroyers.push(() => {
      view.destroy();
    });
    return {
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: (season) => {
        seasons.push(season);
        view.setSeason(season);
      },
      resize: () => undefined,
      destroy: () => undefined,
    };
  },
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
};

let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;
let clock = 0;

beforeEach(() => {
  pending = [];
  frames = [];
  seasons = [];
  destroyers = [];
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
  for (const destroy of destroyers) destroy();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** The mapped doors' wreath as a facade material's program is handed it: 1 drawn, 0 not. */
function wreathOnTheFacade(): unknown {
  const belt = new MappedBuildingBelt(mappedBuildingsOf([]), new Map());
  try {
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader:
        '#include <common>\n#include <begin_vertex>\n#include <color_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader:
        '#include <common>\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };
    belt.materialOf('brick')?.onBeforeCompile(shader as never, undefined as never);
    return shader.uniforms['oylWreath']?.value;
  } finally {
    belt.dispose();
  }
}

/**
 * Start a ride on `day`; update a belt as the view does with the last frame
 * and season it was handed, and read the wreath off a facade material.
 */
async function rideOn(day: CalendarDay): Promise<{ bulbs: number; wreath: unknown }> {
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
  const wreath = wreathOnTheFacade();
  mounted.unmount();
  mounted = undefined;
  const frame = frames.at(-1);
  const season = seasons.at(-1);
  if (frame === undefined || season === undefined) throw new Error('the ride drew no frame');
  // Non-vacuity: the frame holds a village with lamp posts.
  const at = frame.streets
    .flatMap((street) => street.anchors)
    .find((anchor) => anchor.kind === 'lamp-post');
  if (at === undefined) throw new Error('the ride’s frame holds no village');
  const belt = new DecorationBelt('stylised');
  try {
    belt.update(frame.streets, { x: at.x, z: at.z }, season.holiday, HOLIDAY_DECORATIONS);
    if (!belt.mesh.visible) return { bulbs: 0, wreath };
    const glow = belt.mesh.geometry.getAttribute(DECORATION_GLOW_ATTRIBUTE);
    let bulbs = 0;
    for (let index = 0; index < glow.count; index += 1) if (glow.getX(index) === 1) bulbs += 1;
    return { bulbs, wreath };
  } finally {
    belt.dispose();
  }
}

describe('the winter lights, from the device’s day to the belt and the doors — #1626', () => {
  for (const day of [
    { year: 2026, month: 12, day: 1 },
    { year: 2026, month: 12, day: 31 },
    { year: 2027, month: 1, day: 6 },
  ]) {
    it(`light the bulbs and the wreath on a ride started on ${String(day.day)}/${String(day.month)}`, async () => {
      const ride = await rideOn(day);
      expect(ride.bulbs).toBeGreaterThan(0);
      expect(ride.wreath).toBe(1);
    });
  }

  for (const day of [
    { year: 2026, month: 11, day: 30 },
    { year: 2027, month: 1, day: 7 },
  ]) {
    it(`light nothing on a ride started on ${String(day.day)}/${String(day.month)}`, async () => {
      expect(await rideOn(day)).toEqual({ bulbs: 0, wreath: 0 });
    });
  }

  it('light nothing on 20 Dec with the Settings switch off', async () => {
    localStorage.setItem(HOLIDAY_DECORATIONS_STORAGE_KEY, 'off');
    expect(await rideOn({ year: 2026, month: 12, day: 20 })).toEqual({ bulbs: 0, wreath: 0 });
  });
});

describe('the mapped doors’ wreath follows the view’s holiday, and the gate’s control turns it off — #1626', () => {
  it('is drawn in the winter lights only, and never with `facade-wreath` off', () => {
    const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));
    try {
      const winter: Season = { holiday: 'winter-lights', nature: { autumn: 0, winter: 0.5 } };
      view.setSeason(winter);
      expect(wreathOnTheFacade()).toBe(1);
      facadeWreathOf(view, false);
      expect(wreathOnTheFacade()).toBe(0);
      facadeWreathOf(view, true);
      expect(wreathOnTheFacade()).toBe(1);
      view.setSeason({ holiday: 'halloween', nature: { autumn: 0.5, winter: 0 } });
      expect(wreathOnTheFacade()).toBe(0);
      view.setSeason({ holiday: undefined, nature: { autumn: 0, winter: 0.5 } });
      expect(wreathOnTheFacade()).toBe(0);
    } finally {
      facadeWreathOf(view, true);
      view.destroy();
    }
  });
});
