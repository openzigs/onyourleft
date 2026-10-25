// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A baked route's map data reaches the frame the renderer is handed — #1652.
 *
 * The fixture bundle (`browser/demo-route-fixture.ts`, never OpenStreetMap
 * data) is read through the page's loader and played: every claim is read
 * back off the `SceneFrame` given to the view, or off the snapshot the stage
 * publishes from it, never off the bundle the test holds.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectedCorridorCounts } from '../../browser/corridor-fixture';
import { bakeFixtureRouteInto, routeFilesIn } from '../../browser/demo-route-fixture';
import { NO_LAND_CLASS } from '../game/land-class';
import type { SceneInput } from '../game/scene';
import { INITIAL_QUALITY, qualitySettings } from '../game/quality';
import { loadBakedRoute, type BakedRoute } from './baked-route';
import { createDemoPlayer } from './player';
import { CLIMB_PRESET } from './presets';
import { startDemoStage, type DemoSnapshot } from './stage';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames, type FakeView } from './stage-testing';

/** Every input `sceneFrame` was handed, in order: what the scene was given, read back. */
const inputs: SceneInput[] = [];
vi.mock('../game/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game/scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

const RUNG = qualitySettings(INITIAL_QUALITY.level);
const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-map-data-'));
let route: BakedRoute;

beforeAll(async () => {
  await bakeFixtureRouteInto(scratch);
  const files = routeFilesIn(scratch);
  const loaded = await loadBakedRoute('fixture', (path) => {
    const bytes = files.get(path);
    return bytes === undefined ? Promise.reject(new Error(path)) : Promise.resolve(bytes);
  });
  if (loaded.kind !== 'ready') throw new Error(`the fixture route did not load: ${loaded.notice}`);
  route = loaded.route;
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the demo player on a baked route — #1652', () => {
  it('rides the route’s road, and hands the scene its corridor, land and mapped town', () => {
    const player = createDemoPlayer(CLIMB_PRESET, { reducedMotion: false, route });
    expect(player.profile).toBe(route.profile);
    expect(player.mapData).toEqual({ route: 'fixture', counts: expectedCorridorCounts() });
    const frame = player.frame(RUNG);
    // The mapped buildings the renderer's belt draws from: the fixture's
    // residential block, planned, and nothing invented.
    const plans = frame.mappedBuildings?.buildings.plans ?? [];
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(expectedCorridorCounts().buildings);
  });

  it('plans its camera tour on the route it rides, not the preset’s synthetic road', () => {
    const player = createDemoPlayer(CLIMB_PRESET, { reducedMotion: false, route });
    // The fixture road is 2 km; the climb's own is 3 km. The plan stops in
    // the second the lead passes the road's end, so a second's riding past it.
    expect(Math.max(...player.tour.leadMetres)).toBeLessThanOrEqual(
      route.profile.totalDistance + 20,
    );
    const synthetic = createDemoPlayer(CLIMB_PRESET);
    expect(Math.max(...synthetic.tour.leadMetres)).toBeGreaterThan(route.profile.totalDistance);
  });

  it('on the synthetic road hands the scene no map data, and reports none', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    expect(player.mapData).toBeUndefined();
    expect(player.frame(RUNG).mappedBuildings).toBeUndefined();
  });

  it('hands sceneFrame the same corridor, land mask and mapped town every frame, as a ride does', () => {
    const player = createDemoPlayer(CLIMB_PRESET, { reducedMotion: false, route });
    inputs.length = 0;
    player.frame(RUNG);
    player.frame(RUNG);
    const [first, second] = inputs;
    expect(first?.worldCorridor).toBe(route.corridor);
    expect(first?.landClass).toBeDefined();
    expect(first?.landClass).not.toBe(NO_LAND_CLASS);
    expect(first?.mappedTown).toBeDefined();
    // Built once, at the start, never per frame.
    expect(second?.landClass).toBe(first?.landClass);
    expect(second?.mappedTown).toBe(first?.mappedTown);
    expect(second?.mappedBuildings).toBe(first?.mappedBuildings);
  });

  it('hands sceneFrame none of them on the synthetic road', () => {
    const player = createDemoPlayer(CLIMB_PRESET);
    inputs.length = 0;
    player.frame(RUNG);
    expect(inputs[0]).toBeDefined();
    for (const key of ['worldCorridor', 'landClass', 'mappedBuildings', 'mappedTown'] as const) {
      expect(inputs[0]?.[key], key).toBeUndefined();
    }
  });
});

describe('the demo stage on a baked route — #1652', () => {
  function stage(withRoute: boolean) {
    const frames = new SteppedFrames();
    const { renderer, views } = fakeRenderer(new Promise(() => undefined));
    const player = createDemoPlayer(CLIMB_PRESET, {
      reducedMotion: false,
      route: withRoute ? route : undefined,
    });
    player.play();
    const snapshots: DemoSnapshot[] = [];
    startDemoStage({
      canvas: {} as HTMLCanvasElement,
      renderer,
      drawnWorld: fakeDrawnWorld,
      player,
      frames,
      publish: (snapshot) => void snapshots.push(snapshot),
    });
    frames.step(5);
    return { snapshots, view: views[0] as FakeView };
  }

  it('publishes the route and its counts, and the mapped buildings of the frame it drew', () => {
    const { snapshots, view } = stage(true);
    const last = snapshots.at(-1);
    expect(last?.mapData).toEqual({ route: 'fixture', counts: expectedCorridorCounts() });
    const drawn = view.rendered.at(-1)?.mappedBuildings?.buildings.plans.length;
    expect(drawn).toBeGreaterThan(0);
    expect(last?.mappedBuildings).toBe(drawn);
  });

  it('on the synthetic road publishes no map data and no mapped building', () => {
    const { snapshots } = stage(false);
    expect(snapshots.at(-1)).toMatchObject({ mapData: undefined, mappedBuildings: 0 });
  });
});
