// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's plan and the 3D world agree about which way a bend turns — #583.
 *
 * Until #583 they did not. `hud/plan.ts` is north-up with east on the right,
 * which is a map. The world put east on `+x` and north on `+z` in a
 * right-handed renderer, so a camera behind a rider heading north had WEST on
 * its right: every route was drawn as a mirror of its map, and the plan showed
 * a rider a right-hand bend that the road in front of them turned left.
 *
 * This file states the agreement against the same route, with arithmetic that
 * shares nothing with either side: the plan's own points, and the world's
 * drawn road put through the camera the renderer aims — three's `lookAt` with
 * the world's up, right being `forward × up` (`near-field.ts` §`nearPyramid`
 * reads the same axes, and says where they come from). The browser gate reads
 * the same thing off a drawing buffer (`game.browser.spec.ts` §"#583"); this
 * is the half that runs in the fast suite and names both sides.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, positionAt, type RouteProfile } from '@onyourleft/domain';

import { cameraRig } from './camera';
import { routePlan, planPoint } from './hud/plan';
import { cornerRoute, hairpinRoute, northRoute, sBendRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';

/** Where the fixtures' first bend starts, in metres of route. */
const BEND_START = 400;

/** The frame a rider `distance` along `profile` is drawn in. */
function frameAt(profile: RouteProfile, distance: number): ReturnType<typeof sceneFrame> {
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: {
      ...atStartLine(profile),
      ride: { speed: metresPerSecond(8), distance: metres(distance) },
    },
  });
}

/**
 * A world point as the camera sees it: how far to the RIGHT of the view axis,
 * and how far ahead along it. Right is `forward × up`, which is three's
 * `lookAt` for a camera looking along its own `−z` with `+y` up.
 */
function onScreen(
  rig: ReturnType<typeof cameraRig>,
  point: { readonly x: number; readonly y: number; readonly z: number },
): { readonly right: number; readonly ahead: number } {
  const fx = rig.target.x - rig.eye.x;
  const fy = rig.target.y - rig.eye.y;
  const fz = rig.target.z - rig.eye.z;
  const length = Math.hypot(fx, fy, fz);
  const forward = { x: fx / length, y: fy / length, z: fz / length };
  // forward × (0, 1, 0)
  const rx = -forward.z;
  const rz = forward.x;
  const across = Math.hypot(rx, rz);
  const dx = point.x - rig.eye.x;
  const dy = point.y - rig.eye.y;
  const dz = point.z - rig.eye.z;
  const ahead = dx * forward.x + dy * forward.y + dz * forward.z;
  // Divided by depth: where on the screen, not where in the world.
  return { right: (dx * rx + dz * rz) / across / ahead, ahead };
}

/**
 * The sign of the turn through three points on a screen whose first axis is
 * right and second is up the screen: **negative for a turn to the right**
 * (clockwise), positive for one to the left.
 */
function turn(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  return Math.sign(ux * vy - uy * vx);
}

/** Which way the WORLD turns between `from` and `to`, seen from a rider at `rider`. */
function worldTurn(profile: RouteProfile, rider: number, at: readonly number[]): number {
  const frame = frameAt(profile, rider);
  const rig = cameraRig(frame.camera);
  const centre = frame.corridor.centre;
  const points = at.map((distance) => {
    // The drawn road's own point nearest `distance` — not a projection of the
    // route computed here, which would share the defect it is testing for.
    let nearest = centre[0];
    for (const point of centre) {
      if (Math.abs(point.along - distance) < Math.abs((nearest?.along ?? 0) - distance)) {
        nearest = point;
      }
    }
    if (nearest === undefined) throw new Error('an empty corridor');
    const seen = onScreen(rig, nearest);
    expect(seen.ahead, `${String(distance)} m is in front of the camera`).toBeGreaterThan(1);
    // On a flat road the screen's "up" grows with distance ahead; use depth as
    // that axis, which is monotonic with it and cannot flip a turn's sign.
    return [seen.right, seen.ahead] as const;
  });
  return turn(points[0] as readonly [number, number], points[1] as never, points[2] as never);
}

/** Which way the PLAN turns between the same distances: north up, east right. */
function planTurn(profile: RouteProfile, at: readonly number[]): number {
  const { projection } = routePlan(profile);
  const points = at.map((distance) => {
    const point = planPoint(projection, positionAt(profile, distance));
    // SVG's y runs DOWN the panel; the plan's up is north.
    return [point.x, -point.y] as const;
  });
  return turn(points[0] as readonly [number, number], points[1] as never, points[2] as never);
}

describe('the plan and the world agree about which way a bend turns — #583', () => {
  const cases: readonly (readonly [string, RouteProfile, number, readonly number[], number])[] = [
    // name, route, rider at, three distances on the bend, the turn (−1 right).
    [
      'a right-hand hairpin',
      hairpinRoute(20),
      BEND_START,
      [BEND_START + 4, BEND_START + 16, BEND_START + 28],
      -1,
    ],
    [
      'a left-hand hairpin',
      hairpinRoute(20, 'left'),
      BEND_START,
      [BEND_START + 4, BEND_START + 16, BEND_START + 28],
      1,
    ],
    [
      'a right-hand corner',
      cornerRoute(40),
      BEND_START,
      [BEND_START + 5, BEND_START + 25, BEND_START + 45],
      -1,
    ],
    [
      'a left-hand corner',
      cornerRoute(40, 90, 'left'),
      BEND_START,
      [BEND_START + 5, BEND_START + 25, BEND_START + 45],
      1,
    ],
    [
      'an S-bend’s first bend, right',
      sBendRoute(30),
      BEND_START,
      [BEND_START + 4, BEND_START + 16, BEND_START + 28],
      -1,
    ],
  ];

  it.each(cases)(
    '%s turns the same way on the plan and on the screen',
    (_, route, rider, at, expected) => {
      expect(planTurn(route, at)).toBe(expected);
      expect(worldTurn(route, rider, at)).toBe(expected);
    },
  );

  it('draws the mirrored hairpin exactly as the right-hand one mirrored — the browser gate’s control', () => {
    // `game-harness.ts` §`bendProbe` takes `hairpinRoute(20, 'left')` as "the
    // right-hand hairpin as a build before #583 drew it". That holds because
    // #583 changed only the projection, to its mirror (`x` from `+east` to
    // `−east`), and mirroring the route's input mirrors every corridor point
    // the projection feeds: the pre-#583 drawing of the right-hand hairpin is
    // this build's drawing of it with `x` negated, which is this — pinned.
    const right = frameAt(hairpinRoute(20), 385).corridor.centre;
    const mirrored = frameAt(hairpinRoute(20, 'left'), 385).corridor.centre;
    expect(mirrored.length).toBe(right.length);
    right.forEach((point, index) => {
      const other = mirrored[index];
      expect(other?.along).toBeCloseTo(point.along, 6);
      expect(other?.x).toBeCloseTo(-point.x, 6);
      expect(other?.y).toBeCloseTo(point.y, 6);
      expect(other?.z).toBeCloseTo(point.z, 6);
    });
    // Non-vacuity: the stretch really bends — a straight is its own mirror.
    expect(Math.max(...right.map((point) => Math.abs(point.x)))).toBeGreaterThan(10);
  });

  it('keeps the rider right of the road’s centre, on the screen and on the map', () => {
    // The #546 ruling — keep to the right — survives #583 as a fact about the
    // screen and the map at once. The camera follows the rider across the road
    // (#546), so the rider is not right of the FRAME here; the road's centre
    // line is left of the rider, a little ahead of them, which is the same
    // claim read the way a chase camera shows it.
    const route = northRoute(1_000, () => 0);
    const frame = frameAt(route, 500);
    const rig = cameraRig(frame.camera);
    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider in the frame');
    const ahead = frame.corridor.centre.find((point) => point.along >= 510);
    if (ahead === undefined) throw new Error('no road ahead of the rider');
    expect(onScreen(rig, ahead).right).toBeLessThan(onScreen(rig, rider).right - 0.02);
    // East of the centreline: the centreline is at x = 0 and east is `−x`.
    expect(rider.x).toBeLessThan(-1);
  });
});
