// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Every way the junction pop-up offers is drawn, no scenery stands on a
 * street, and the plan view shows the streets** — #3106.
 *
 * The owner's open-world tablet ride of 2026-11-23: the pop-up offered a
 * right turn where no street was drawn — hedges, trees and grass across its
 * mouth — while a street on the left was drawn; "seem to be missing a lot of
 * street"; and the plan view showed the ridden line and no street at all.
 *
 * Every case rides the real game screen over the product's own session, its
 * area reader, decoder, street graph and rolling route, on fixture streets
 * (`fixture-testing.ts`: lines written there, no map data), and reads back
 * **the frames the renderer was handed** and the HUD the rider was shown
 * (`offered-ways-testing.ts`):
 *
 * - **Each offered way is drawn as road** from its junction to 120 m, on
 *   every frame from the one the prompt appears on until the junction is
 *   passed: at a fork, at a street mapped on a bridge, at a street whose
 *   first metres are a way of their own, and at a crossroads. A way is read
 *   from the ride's own rolling route, the question the prompt asks, and
 *   "drawn" is a triangle of a side road's mesh, or the road's surface.
 * - **In a town of 40 m blocks**, where the ways in view are many times what
 *   `way-roads.ts` reads in a frame, the offered ways are still drawn: the
 *   next junction's are read first.
 * - **With more street than a corridor's bound** read before the town's own
 *   — an open-world ride's far blocks — the town's streets are still drawn.
 * - **No scenery item stands on a street the graph holds.**
 * - **The plan view is a street map** of the streets round the rider, with
 *   the OpenStreetMap credit, and says the road ahead and no share ridden.
 * - **The cost**: a town of crossroads, where the streets' own drawing is
 *   whole, is handed no way road at all; and where there are some, the same
 *   objects frame after frame until the streets in view are chosen again.
 *
 * Each town is ridden ONCE, in its describe's `beforeAll`, and every case of
 * it reads the frames of that one ride.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { queryAll } from '../../testing/mount';
import { SIDE_ROAD_WIDTHS, widthClassOf, type SideRoad } from '../cross-streets';
import { NEARBY_STREET_REFRESH_METRES, NEARBY_STREET_VIEW_METRES } from '../nearby-streets';
import type { SceneInput } from '../scene';
import { corridorOrigin, localGroundPosition } from '../terrain';
import {
  WAY_ROAD_REFRESH_METRES,
  WAY_ROAD_STATIONS_PER_FRAME,
  WAY_ROAD_STEP_METRES,
} from '../way-roads';
import {
  fixturePosition,
  OPEN_WORLD_AWKWARD_STREETS,
  OPEN_WORLD_DENSE_STREETS,
  OPEN_WORLD_FAR_SERVICE_ROADS,
  OPEN_WORLD_GRID_STREETS,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { JUNCTION_PROMPT_METRES } from './junction-choice';
import {
  sceneInputs,
  startOfferedWaysRide,
  toDrawnSideRoad,
  undrawnOfferedWays,
  type OfferedWaysRide,
  type RiddenFrame,
} from './offered-ways-testing';

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      sceneInputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** What `wayRoads` handed each frame's scene, in order. */
const wayRoadsHanded: (readonly SideRoad[])[] = [];

/** How many stations each frame's ways out would be read at were there no bound, in order. */
const stationsAsked: number[] = [];

vi.mock('../way-roads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../way-roads')>();
  return {
    ...actual,
    wayRoads: (...args: Parameters<typeof actual.wayRoads>) => {
      const roads = actual.wayRoads(...args);
      wayRoadsHanded.push(roads);
      let asked = 0;
      for (const { way, toMetres } of args[0]) {
        const to = Math.min(
          way.profile.totalDistance,
          Math.ceil(toMetres / WAY_ROAD_REFRESH_METRES) * WAY_ROAD_REFRESH_METRES,
        );
        asked += Math.max(0, Math.floor((to - way.fromMetres) / WAY_ROAD_STEP_METRES) + 1);
      }
      stationsAsked.push(asked);
      return roads;
    },
  };
});

let ride: OfferedWaysRide | undefined;

/** Rides `streets` from the start pin to `metres`, once: the frames every case of a describe reads. */
function ridden(streets: Parameters<typeof startOfferedWaysRide>[0], metres: number): void {
  beforeAll(async () => {
    wayRoadsHanded.length = 0;
    stationsAsked.length = 0;
    ride = await startOfferedWaysRide(streets, START_COLUMN, START_ROW);
    await ride.rideTo(metres);
  });
  afterAll(() => {
    ride?.end();
    ride = undefined;
  });
}

/** The frames of the describe's one ride. */
function framesRidden(): readonly RiddenFrame[] {
  if (ride === undefined) throw new Error('no ride was ridden');
  return ride.frames;
}

/** The ride distance of the `index`th junction the ride was prompted for. */
function junctionAt(frames: readonly RiddenFrame[], index: number): number {
  const distances = [
    ...new Set(frames.flatMap((frame) => (frame.junction ? [frame.junction.distance] : []))),
  ].sort((a, b) => a - b);
  const distance = distances[index];
  if (distance === undefined) throw new Error(`no junction ${String(index)} was prompted`);
  return distance;
}

/**
 * Holds every frame that prompts for the junction at ride distance
 * `junction`: the prompt appeared as soon as it could, its pop-up offered
 * the ways this file reads, and every one of them is drawn on every frame.
 */
function expectOfferedWaysDrawn(
  frames: readonly RiddenFrame[],
  junction: number,
  ways: number,
  /** The ride distance the prompt can first be for this junction: the junction before it. */
  from: number,
): void {
  const prompted = frames.filter((frame) => frame.junction?.distance === junction);
  const first = prompted[0];
  if (first === undefined) throw new Error('never prompted');
  // From the moment the prompt appears: within two frames of where it can.
  expect(first.odometer).toBeLessThan(Math.max(from, junction - JUNCTION_PROMPT_METRES) + 12);
  // The pop-up the rider was shown offers exactly the ways read here. The
  // HUD is drawn after the frame it reads, so its buttons are a frame behind.
  expect(first.ways).toHaveLength(ways);
  expect(prompted.slice(0, 3).some((frame) => frame.offered.length === ways)).toBe(true);
  expect(prompted.length).toBeGreaterThan(20);
  for (const frame of prompted) {
    expect(
      undrawnOfferedWays(frame, NEARBY_STREET_VIEW_METRES),
      `the junction at ${junction.toFixed(0)} m, from ${frame.odometer.toFixed(0)} m`,
    ).toStrictEqual([]);
  }
}

interface StreetSegment {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly half: number;
}

/** Every street of `streets` the graph holds, as segments in `frame`'s local metres, with its half-width. */
function graphStreets(
  streets: typeof OPEN_WORLD_AWKWARD_STREETS,
  frame: RiddenFrame,
): StreetSegment[] {
  const origin = corridorOrigin(frame.input.profile);
  const out: StreetSegment[] = [];
  for (const street of streets) {
    const kindDetail = street.tags['kind_detail'];
    // The graph leaves a service road out (ADR 0091 D-3).
    if (kindDetail === 'service') continue;
    const half =
      SIDE_ROAD_WIDTHS[
        widthClassOf({
          kind: street.tags['kind'] as 'major_road' | 'minor_road',
          kindDetail: typeof kindDetail === 'string' ? kindDetail : '',
        })
      ] / 2;
    for (let index = 0; index + 1 < street.line.length; index += 1) {
      const [ac, ar] = street.line[index] as readonly [number, number];
      const [bc, br] = street.line[index + 1] as readonly [number, number];
      const a = localGroundPosition(origin, fixturePosition(ac, ar));
      const b = localGroundPosition(origin, fixturePosition(bc, br));
      out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half });
    }
  }
  return out;
}

/**
 * The scenery in `frame`'s view that stands on one of `streets`, each as
 * `kind@x,z`, and how much scenery is in view. In view is ahead of the
 * camera: a frame also carries what stands along the 60 m of road behind the
 * rider, which the chase camera, looking ahead from behind them, never shows.
 */
function sceneryOnStreets(
  streets: readonly StreetSegment[],
  frame: RiddenFrame,
): { readonly on: string[]; readonly items: number } {
  const on: string[] = [];
  const { camera } = frame.frame;
  const standing: { readonly kind: string; readonly x: number; readonly z: number }[] = [
    ...frame.frame.scatter,
    ...frame.frame.billboards.map((board) => ({ kind: 'billboard', x: board.x, z: board.z })),
  ];
  const items = standing.filter(
    (item) => (item.x - camera.x) * camera.headingX + (item.z - camera.z) * camera.headingZ > 0,
  );
  for (const item of items) {
    for (const { ax, az, bx, bz, half } of streets) {
      const span = (bx - ax) ** 2 + (bz - az) ** 2;
      const t = Math.max(
        0,
        Math.min(1, ((item.x - ax) * (bx - ax) + (item.z - az) * (bz - az)) / span),
      );
      if (Math.hypot(item.x - ax - t * (bx - ax), item.z - az - t * (bz - az)) < half) {
        on.push(`${item.kind}@${item.x.toFixed(0)},${item.z.toFixed(0)}`);
        break;
      }
    }
  }
  return { on, items: items.length };
}

/** Holds every frame of the ride clear of scenery on `streets`, and that there was scenery to keep off them. */
function expectNoSceneryOn(streets: typeof OPEN_WORLD_AWKWARD_STREETS, least: number): void {
  let items = 0;
  for (const frame of framesRidden()) {
    const found = sceneryOnStreets(graphStreets(streets, frame), frame);
    items += found.items;
    expect(found.on, `at ${frame.odometer.toFixed(0)} m`).toStrictEqual([]);
  }
  // Not vacuous: the frames carried scenery to keep off them.
  expect(items).toBeGreaterThan(least);
}

describe('a town of a fork, a street on a bridge, a split street and a crossroads — #3106', () => {
  ridden(OPEN_WORLD_AWKWARD_STREETS, 925);

  it('draws every way the pop-up offers as road, from the frame the prompt appears', () => {
    const frames = framesRidden();
    const fork = junctionAt(frames, 0);
    const bridge = junctionAt(frames, 1);
    const split = junctionAt(frames, 2);
    const crossroads = junctionAt(frames, 3);
    // The four junctions, a fixture block apart.
    for (const [index, at] of [fork, bridge, split, crossroads].entries()) {
      expect(at).toBeGreaterThan(225 + index * 232);
      expect(at).toBeLessThan(240 + index * 232);
    }
    expectOfferedWaysDrawn(frames, fork, 2, 0);
    expectOfferedWaysDrawn(frames, bridge, 2, fork);
    expectOfferedWaysDrawn(frames, split, 2, bridge);
    expectOfferedWaysDrawn(frames, crossroads, 3, split);
    // Not vacuous: the fork and the bridge are drawn by the way roads and by
    // nothing else, so some frame was handed one.
    expect(wayRoadsHanded.some((roads) => roads.length > 0)).toBe(true);
  });

  it('stands no scenery item on a street the graph holds', () => {
    expectNoSceneryOn(OPEN_WORLD_AWKWARD_STREETS, 10_000);
  });

  it('hands the frames the same way roads, until the streets in view are chosen again', () => {
    // Each different array handed on is one working-out. The streets in view
    // are chosen every 40 m, a junction's stub comes into view or leaves it,
    // and a way does: a handful a refresh, where a frame is 5 m.
    const distinct = new Set(wayRoadsHanded).size;
    expect(wayRoadsHanded.length).toBeGreaterThan(150);
    expect(distinct).toBeLessThan((925 / NEARBY_STREET_REFRESH_METRES) * 3);
    // And a stretch drawn again is the same ribbon: far fewer ribbons than frames.
    const ribbons = new Set(wayRoadsHanded.flat());
    expect(ribbons.size).toBeGreaterThan(0);
    expect(ribbons.size).toBeLessThan(wayRoadsHanded.length / 2);
  });
});

describe('a town with more street than the corridor’s bound read first, far from the ride — #3106', () => {
  ridden([...OPEN_WORLD_FAR_SERVICE_ROADS, ...OPEN_WORLD_GRID_STREETS], 480);

  it('draws every way the pop-up offers as road, and the streets beyond them', () => {
    const frames = framesRidden();
    const first = junctionAt(frames, 0);
    const second = junctionAt(frames, 1);
    expectOfferedWaysDrawn(frames, first, 3, 0);
    expectOfferedWaysDrawn(frames, second, 3, first);
    // And by the streets' own drawing, not the way roads': a town of
    // crossroads needs none, however much street is held beyond it.
    expect(wayRoadsHanded.length).toBeGreaterThan(50);
    expect(wayRoadsHanded.every((roads) => roads.length === 0)).toBe(true);
    // The streets beyond the offered ways too: the street parallel to Main
    // street, a block north, which no junction of the road offers.
    const last = frames[frames.length - 1] as RiddenFrame;
    const origin = corridorOrigin(last.input.profile);
    const rider = last.frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider drawn');
    let checked = 0;
    for (let column = -4000; column <= 3500; column += 100) {
      const { x, z } = localGroundPosition(origin, fixturePosition(column, 948));
      if (Math.hypot(x - rider.x, z - rider.z) > 300) continue;
      checked += 1;
      expect(toDrawnSideRoad(last.frame, x, z, 1), `column ${String(column)}`).toBeLessThanOrEqual(
        1,
      );
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('stands no scenery item on a street the graph holds', () => {
    expectNoSceneryOn(OPEN_WORLD_GRID_STREETS, 5_000);
  });
});

describe('a town of crossroads — #3106', () => {
  ridden(OPEN_WORLD_GRID_STREETS, 480);

  it('is handed no way road on any frame: the streets’ own drawing is whole', () => {
    expect(wayRoadsHanded.length).toBeGreaterThan(50);
    expect(wayRoadsHanded.every((roads) => roads.length === 0)).toBe(true);
  });

  it('shows the held streets on the plan view, with the credit, and names no share of a route', () => {
    const map = queryAll<HTMLElement>(document, '.oyl-hud__street-map')[0];
    expect(map?.getAttribute('aria-label')).toBe(
      'Street map around you, north up, about 1.0 kilometres from top to bottom, with the road ahead on it.',
    );
    const streets = queryAll<SVGPathElement>(document, '[data-oyl-street-map="streets"]')[0];
    const drawn = (streets?.getAttribute('d') ?? '')
      .split('M')
      .filter((subpath) => subpath !== '')
      .map((subpath) => subpath.replace('L', ' ').trim().split(/\s+/).map(Number));
    expect(drawn.length).toBeGreaterThan(10);
    // The streets the rider is NOT on are on it: the cross street the second
    // junction's prompt offered, a block north of Main street and a block
    // south, in the map's own metres east and south of the corridor's origin.
    const corridor = sceneInputs[sceneInputs.length - 1]?.worldCorridor;
    if (corridor === undefined) throw new Error('the scene was handed no street corridor');
    for (const row of [948, 3148]) {
      const local = localGroundPosition(corridor.origin, fixturePosition(-1000, row));
      const east = -local.x;
      const south = -local.z;
      let least = Number.POSITIVE_INFINITY;
      for (const line of drawn) {
        for (let at = 0; at + 3 < line.length; at += 2) {
          const ax = line[at] as number;
          const ay = line[at + 1] as number;
          const bx = line[at + 2] as number;
          const by = line[at + 3] as number;
          const span = (bx - ax) ** 2 + (by - ay) ** 2;
          const t =
            span > 0
              ? Math.max(
                  0,
                  Math.min(1, ((east - ax) * (bx - ax) + (south - ay) * (by - ay)) / span),
                )
              : 0;
          least = Math.min(
            least,
            Math.hypot(east - ax - t * (bx - ax), south - ay - t * (by - ay)),
          );
        }
      }
      expect(least, `the cross street at row ${String(row)}`).toBeLessThan(2);
    }
    // The route — the road ahead — is on it too, and the OpenStreetMap credit is shown.
    expect(
      queryAll<SVGPathElement>(document, '[data-oyl-street-map="route"]')[0]?.getAttribute('d'),
    ).not.toBe('');
    expect(queryAll<HTMLElement>(document, '.oyl-hud__attribution')[0]?.textContent).toContain(
      'OpenStreetMap',
    );
  });
});

describe('a town of short blocks, with more way in view than a frame reads — #3106', () => {
  ridden(OPEN_WORLD_DENSE_STREETS, 300);

  it('draws every way the pop-up offers as road, the bridge street among them', () => {
    const frames = framesRidden();
    // Not vacuous: the frames' ways out asked for more than a frame reads, so
    // some way went unread on them; and a junction was prompted every block.
    expect(Math.max(...stationsAsked)).toBeGreaterThan(WAY_ROAD_STATIONS_PER_FRAME);
    const prompted = frames.filter((frame) => frame.junction !== undefined);
    expect(new Set(prompted.map((frame) => frame.junction?.distance)).size).toBeGreaterThan(5);
    // The bridge street is drawn by the way roads and by nothing else.
    expect(wayRoadsHanded.some((roads) => roads.length > 0)).toBe(true);
    const undrawn = prompted.flatMap((frame) =>
      undrawnOfferedWays(frame, NEARBY_STREET_VIEW_METRES).map(
        (way) => `${way} from ${frame.odometer.toFixed(0)} m`,
      ),
    );
    expect(undrawn).toStrictEqual([]);
  });
});
