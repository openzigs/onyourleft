// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A village's street, its crossroads, the billboards, the people and the
 * other cyclists past a junction stay where they were through a choice —
 * #3095.
 *
 * Since #3092 an open-world ride's trees, rocks, houses and field boundaries
 * are placed along every way out of the junctions in view (`road.ts`
 * §`waysOut`). Everything else `scene.ts` §`sceneFrame` places was placed
 * along the road the route takes alone, so a choice took it off the road
 * straight on and put it on the street turned into, on the frame of the
 * press. Read here on the real `sceneFrame`, on a level synthetic street
 * grid, ridden by the real {@link OpenWorldRoad}, pressing 101 m to 110 m
 * short of a junction as a rider would (inside the 250 m prompt, short of the
 * 100 m lock): each kind past the junction, before the press and after it.
 *
 * ⚠️ **Not the corner itself.** For {@link CORNER_METRES} either side of the
 * junction the drawn road rounds the corner the route takes, and the
 * pavement, the people walking it and a cyclist riding it follow that corner:
 * a press redraws it. Everything farther than that from the junction is held.
 *
 * The real game screen through a press, with a village and its billboards
 * past the junction, is `junction-corner.test.tsx`'s. People and the other
 * cyclists are drawn only on the realistic world's top rung (`scene.ts`
 * §`SceneInput.people`), which that file's renderer does not load, so they
 * are held here.
 */

import { describe, expect, it } from 'vitest';

import { RollingRoute, metres, positionAt, type RollingEdge } from '@onyourleft/domain';
import { gridGraph, type SyntheticGround } from '@onyourleft/domain/rolling-testing';

import { PEOPLE_FAR_METRES } from '../people';
import type { SceneFrame } from '../port';
import { sceneFrame } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { OpenWorldRoad } from './road';

const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** Low, level ground: villages stand on it, which the grid's own high ground has none of. */
const LOWLAND: SyntheticGround = () => 120;

/**
 * How far from the junction the corner the route takes is drawn, metres:
 * **20**, `scene.ts`' `JUNCTION_CORNER_METRES` either side. @see this file's header
 */
const CORNER_METRES = 20;

/** How far from the rider anything is compared, metres: the view's reach ahead. */
const REACH_METRES = 400;

/** A place, to a centimetre. */
const key = (place: { readonly x: number; readonly z: number }): string =>
  `${place.x.toFixed(2)},${place.z.toFixed(2)}`;

/** One press: the frames before and after it, and where the junction is. */
interface Pressed {
  readonly before: SceneFrame;
  readonly after: SceneFrame;
  readonly junction: { readonly x: number; readonly z: number };
  readonly rider: { readonly x: number; readonly z: number };
}

/**
 * Rides the lowland grid, its columns moved `east` metres, to `back` metres
 * short of its `index`th junction, draws the frame, turns there onto the
 * first way the route does not take, and draws it again.
 */
function press(index: number, back: number, east = 0): Pressed {
  const { graph, edges } = gridGraph(
    COLUMNS.map((column) => column + east),
    ROWS,
    LOWLAND,
    3,
  );
  const route = new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
  const frame = corridorOrigin(route.view());
  const road = new OpenWorldRoad(route, { frame });
  let junction = road.route.nextJunctionAfter(0);
  for (let passed = 0; passed < index && junction !== undefined; passed += 1) {
    junction = road.route.nextJunctionAfter(junction.distance);
  }
  if (junction === undefined) throw new Error('no such junction');
  const rider = junction.distance - back;
  road.follow(rider);
  junction = road.route.nextJunctionAfter(rider);
  if (junction === undefined) throw new Error('no junction ahead');
  const at = junction;
  const other = at.ways.find((way) => way.edge.id !== at.taken)?.edge.id;
  if (other === undefined) throw new Error('no other way');
  const drawn = (): SceneFrame => {
    const view = road.view;
    const along = rider - view.origin;
    const start = atStartLine(view.profile);
    return sceneFrame({
      profile: view.profile,
      origin: corridorOrigin(view.profile),
      state: { ...start, ride: { speed: 8 as never, distance: metres(along) } },
      riderDistance: along,
      waysOut: road.waysOut(rider),
      // The realistic world's top rung: people, and the other cyclists.
      people: 16,
      sceneryCyclists: true,
    });
  };
  const before = drawn();
  const place = localGroundPosition(
    frame,
    positionAt(road.view.profile, at.distance - road.view.origin),
  );
  const riderPlace = localGroundPosition(
    frame,
    positionAt(road.view.profile, rider - road.view.origin),
  );
  expect(road.route.choose(at.distance, other, rider)).toBe('swapped');
  expect(road.follow(rider)).toBeDefined();
  return { before, after: drawn(), junction: place, rider: riderPlace };
}

/** Of `places`, those past the corner and within reach. */
function pastTheCorner(
  pressed: Pressed,
  places: readonly { readonly x: number; readonly z: number }[],
): string[] {
  return places
    .filter(
      (place) =>
        Math.hypot(place.x - pressed.junction.x, place.z - pressed.junction.z) > CORNER_METRES &&
        Math.hypot(place.x - pressed.rider.x, place.z - pressed.rider.z) <= REACH_METRES,
    )
    .map(key);
}

/** What of `before` `after` no longer has, and what it has that `before` did not. */
function changed(
  before: readonly string[],
  after: readonly string[],
): { readonly gone: string[]; readonly added: string[] } {
  const now = new Set(after);
  const was = new Set(before);
  return {
    gone: before.filter((each) => !now.has(each)),
    added: after.filter((each) => !was.has(each)),
  };
}

/** Every vertex of a frame's village pavements. */
function pavements(frame: SceneFrame): { x: number; z: number }[] {
  return frame.streets.flatMap((street) => {
    const out: { x: number; z: number }[] = [];
    const positions = street.pavement.positions;
    for (let at = 0; at + 2 < positions.length; at += 3) {
      out.push({ x: positions[at] as number, z: positions[at + 2] as number });
    }
    return out;
  });
}

/** Every point of a frame's village crossroads' arms. */
function crossroads(frame: SceneFrame): { x: number; z: number }[] {
  return frame.sideRoads
    .filter((road) => road.junction.source === 'village')
    .flatMap((road) => {
      const out: { x: number; z: number }[] = [];
      for (let at = 0; at + 1 < road.segments.length; at += 2) {
        out.push({ x: road.segments[at] as number, z: road.segments[at + 1] as number });
      }
      return out;
    });
}

/**
 * A frame's people, but those at the edge of who is drawn: within
 * `people.ts` §`PEOPLE_FAR_METRES` of the camera, less {@link EDGE_METRES},
 * since the two frames' cameras stand a few centimetres apart.
 */
const people = (frame: SceneFrame): { x: number; z: number }[] =>
  [...(frame.people?.near ?? []), ...(frame.people?.far ?? [])].filter(
    (person) =>
      Math.hypot(person.x - frame.camera.x, person.z - frame.camera.z) <=
      PEOPLE_FAR_METRES - EDGE_METRES,
  );

/** How far inside the edge of who is drawn a person is compared, metres. */
const EDGE_METRES = 5;

describe('what stands past a junction stays through a choice — #3095', () => {
  it('lays every village’s street along every way out: its pavements stay where they were', () => {
    // The fourth crossroads of the lowland grid has a village on every way out.
    for (const pressed of [press(3, 110), press(4, 110), press(5, 110)]) {
      const before = pastTheCorner(pressed, pavements(pressed.before));
      const after = pastTheCorner(pressed, pavements(pressed.after));
      expect(changed(before, after)).toStrictEqual({ gone: [], added: [] });
    }
    // Not nothing: the fourth crossroads' villages' pavements, past the corner.
    expect(pastTheCorner(press(3, 110), pavements(press(3, 110).before)).length).toBeGreaterThan(
      500,
    );
  });

  it('draws every village’s crossroads along every way out, where it stood', () => {
    const pressed = press(3, 110);
    const before = pastTheCorner(pressed, crossroads(pressed.before));
    expect(before.length).toBeGreaterThan(20);
    expect(changed(before, pastTheCorner(pressed, crossroads(pressed.after)))).toStrictEqual({
      gone: [],
      added: [],
    });
  });

  it('stands every billboard along every way out, where it stood', () => {
    const pressed = press(5, 110);
    const before = pastTheCorner(pressed, pressed.before.billboards);
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(changed(before, pastTheCorner(pressed, pressed.after.billboards))).toStrictEqual({
      gone: [],
      added: [],
    });
  });

  it('walks the people on those pavements where they walked', () => {
    let compared = 0;
    for (const pressed of [press(4, 110), press(5, 110)]) {
      const before = pastTheCorner(pressed, people(pressed.before));
      compared += before.length;
      expect(changed(before, pastTheCorner(pressed, people(pressed.after)))).toStrictEqual({
        gone: [],
        added: [],
      });
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('rides the other cyclists along every way out where they rode', () => {
    let compared = 0;
    // Two grids whose encounters put a cyclist past the junction at the press.
    for (const pressed of [press(5, 101, 14), press(6, 101, 28)]) {
      const before = pastTheCorner(pressed, pressed.before.cyclists ?? []);
      compared += before.length;
      expect(changed(before, pastTheCorner(pressed, pressed.after.cyclists ?? []))).toStrictEqual({
        gone: [],
        added: [],
      });
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });
});
