// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A bend, drawn by the real renderer and read back from straight above — #543.
 *
 * ## What was seen
 *
 * The owner's Pixel Tablet, 2026-09-25, the realistic world on a saved
 * 29-mile route: *"when the road curves the road turns into odd angles and is
 * not smooth"*. The corridor stepped along the route's own ten-metre grid, and
 * a route from a planner turns 25° to 45° at a time, so every bend was drawn
 * as straights meeting at corners. `terrain.ts` §`BEND_SMOOTHING_METRES` and
 * §`CORRIDOR_STEP_METRES` are the fix, and `terrain.test.ts` holds the
 * geometry to `MAXIMUM_CORRIDOR_JOINT_DEGREES`; this page asks the same of the
 * PIXELS, because a corridor that is smooth and a road that is drawn smooth
 * are two claims.
 *
 * ## What is measured
 *
 * `route-fixtures-testing.ts` §`plannerRoute`'s tightest bend — 20 m, through
 * 100°, exported the way a planner exports one — with the camera straight
 * above the centre of the bend's circle, looking down. Each frame is rendered
 * with the road and with the road's index list emptied (`loop-harness.ts`'s
 * isolation), so the pixels that differ are the road and nothing else.
 *
 * From the middle of the frame, which is the circle's centre, a ray is cast
 * every tenth of a degree, and the first run of road along it gives the road's
 * inner and outer edge at that angle. Each edge is then walked in steps of
 * two metres of its own length (`road-edges.ts`), a line is fitted through the pixels
 * of each step, and the turn from one step's line to the next is taken.
 *
 * ⚠️ **What is reported is the KINK, not the turn**: each turn less the mean of
 * the two either side of it. A bend turns the whole time, and a 16.5 m inner
 * edge turns 7° every two metres however smoothly it is drawn — so the turn
 * alone cannot tell a curve from a corner. A corner is a turn that its
 * neighbours do not share, which is what this is.
 *
 * ## The control
 *
 * The same bend drawn as it was before #543 — `roadCorridor`'s `unsmoothed`,
 * the route's own centreline at its own grid step, corners and all. The spec
 * requires THAT frame to show a kink, so a green run is not a frame that drew
 * no road or a bend the rays missed.
 */

import type { SceneFrame } from '../src/game/port';
import { CAMERA_ABOVE_METRES, verticalHalfTangent } from '../src/game/camera';
import { qualitySettings } from '../src/game/quality';
import { PLANNER_BENDS, plannerRoute } from '../src/game/route-fixtures-testing';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import { ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from '../src/game/terrain';
import { loadSceneryModels, threeGameRenderer } from '../src/game/three-renderer';
import { type EdgeReading, readEdge } from './road-edges';
import { withCorridor } from './with-corridor';

export type { EdgeReading } from './road-edges';

export interface BendReading {
  readonly roadPixels: number;
  readonly inner: EdgeReading;
  readonly outer: EdgeReading;
}

export interface BendMeasurement {
  readonly size: number;
  readonly pixelsPerMetre: number;
  readonly radiusMetres: number;
  /** The road as this build draws it. */
  readonly drawn: BendReading;
  /** The control: the road as it was drawn before #543. */
  readonly unsmoothed: BendReading;
}

declare global {
  interface Window {
    __oylBend?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measurement: BendMeasurement | undefined;
    };
  }
}

/** The frame is square, and this many pixels a side. */
const SIZE = 1024;
/** How high above the road the camera is, in metres. The bend fills the frame. */
const ALTITUDE_METRES = 45;
/** Rays cast from the bend's centre per degree. */
const RAYS_PER_DEGREE = 10;
/** Which of the planner's bends: the tightest, 20 m. */
const BEND = PLANNER_BENDS[2] as (typeof PLANNER_BENDS)[number];

/** The frame over the bend, from straight above its centre, with nothing on the road but the road. */
function overTheBend(unsmoothed: boolean): SceneFrame {
  const profile = plannerRoute();
  const origin = corridorOrigin(profile);
  const riderDistance = BEND.middleMetres;
  const start = atStartLine(profile);
  const frame = sceneFrame({
    profile,
    origin,
    state: start,
    riderDistance,
    centreline: true,
  });
  // ⚠️ The product's own `roadCorridor`, reaching further BEHIND than a ride's
  // 60 m. At 60 m the corridor's cut end falls inside the frame, 17 m before
  // the bend, and the rays read its square corner as a 116° kink in the outer
  // edge — measured, on the first run of this page. Reaching back 150 m puts
  // it beyond the frame; nothing else about the road changes with the reach.
  const corridor = roadCorridor(profile, origin, riderDistance, {
    behindMetres: 150,
    unsmoothed,
  });
  return {
    ...withCorridor(frame, profile, origin, corridor),
    scatter: [],
    markers: [],
    // A heading of nothing puts the eye straight over the target — `camera.ts`
    // §`cameraRig` offsets both along the heading — so the camera looks
    // straight down on the bend's centre. The fixture is level at 0 m.
    // ⚠️ `x` is WEST since #583 (`terrain.ts` §`localGroundPosition`), and the
    // fixture's origin is its start, so a centre `centreEast` metres east of
    // it stands at `x = −centreEast`. Left positive, the camera looks down on
    // a field 2·centreEast metres from the bend and the rays find no road —
    // which is what `bend.browser.spec.ts`'s chord counts would say.
    camera: {
      x: -BEND.centreEast,
      y: 0,
      z: BEND.centreNorth,
      headingX: 0,
      headingZ: 0,
      eyeRoadY: ALTITUDE_METRES - CAMERA_ABOVE_METRES,
      targetRoadY: 0,
    },
  };
}

/** Which pixels are road: those that change when the road's index list is emptied. */
function roadMask(unsmoothed: boolean): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const view = threeGameRenderer.create(canvas, qualitySettings(0));
  view.resize(SIZE, SIZE);
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) {
    view.destroy();
    throw new Error('bend harness: no GL context');
  }
  const withRoad = overTheBend(unsmoothed);
  const noRoad: SceneFrame = {
    ...withRoad,
    corridor: { ...withRoad.corridor, indices: new Uint32Array(0) },
  };
  const read = (): Uint8Array => {
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  // Twice each and only the second read: the first draw of a geometry uploads it.
  view.render(withRoad);
  view.render(withRoad);
  const present = read();
  view.render(noRoad);
  view.render(noRoad);
  const absent = read();
  view.destroy();
  const mask = new Uint8Array(SIZE * SIZE);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    const at = pixel * 4;
    mask[pixel] =
      present[at] !== absent[at] ||
      present[at + 1] !== absent[at + 1] ||
      present[at + 2] !== absent[at + 2]
        ? 1
        : 0;
  }
  return mask;
}

/**
 * The road's two edges, as points in pixels, ray by ray from the centre.
 *
 * A ray that finds no road, or whose first run of road reaches the frame's
 * border, ends the edge there: an edge is only ever the contiguous stretch of
 * rays that saw the whole width of the road.
 *
 * ⚠️ **So does a ray that crosses the road ALONG it rather than across it.**
 * Beyond the bend the road runs straight on, and a ray from the bend's centre
 * meets that straight ever more obliquely, so the far end of its run slides
 * away along the road — 175 px between two neighbouring rays on the first run
 * of this page, read as a 117° kink. A run is taken only while it is between
 * half and one and a half road widths long, which is a ray that crossed the
 * road rather than grazed it or ran along it.
 */
function edges(
  mask: Uint8Array,
  pixelsPerMetre: number,
): {
  readonly inner: Array<readonly [number, number]>[];
  readonly outer: Array<readonly [number, number]>[];
} {
  const centre = SIZE / 2;
  const inner: Array<readonly [number, number]>[] = [];
  const outer: Array<readonly [number, number]>[] = [];
  let innerRun: Array<readonly [number, number]> = [];
  let outerRun: Array<readonly [number, number]> = [];
  const close = (): void => {
    if (innerRun.length > 0) inner.push(innerRun);
    if (outerRun.length > 0) outer.push(outerRun);
    innerRun = [];
    outerRun = [];
  };
  const road = (x: number, y: number): boolean | undefined => {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 0 || row < 0 || column >= SIZE || row >= SIZE) return undefined;
    return mask[row * SIZE + column] === 1;
  };
  const rays = 360 * RAYS_PER_DEGREE;
  /** Where ray `ray` enters and leaves the road, or `undefined` if it did not cross it cleanly. */
  const crossing = (
    ray: number,
  ):
    | { readonly dx: number; readonly dy: number; readonly entered: number; readonly left: number }
    | undefined => {
    const angle = (ray / RAYS_PER_DEGREE) * (Math.PI / 180);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let entered: number | undefined;
    let left: number | undefined;
    for (let radius = 0; ; radius += 0.25) {
      const here = road(centre + dx * radius, centre + dy * radius);
      if (here === undefined) break;
      if (entered === undefined && here) entered = radius;
      if (entered !== undefined && !here) {
        left = radius;
        break;
      }
    }
    const across = entered === undefined || left === undefined ? 0 : left - entered;
    if (
      entered === undefined ||
      left === undefined ||
      across < 0.5 * ROAD_WIDTH_METRES * pixelsPerMetre ||
      across > 1.5 * ROAD_WIDTH_METRES * pixelsPerMetre
    ) {
      return undefined;
    }
    return { dx, dy, entered, left };
  };
  // ⚠️ **The sweep starts on a ray that does NOT cross the road** — #583. It
  // started at 0° until then, and a run of rays that straddles 0° was closed
  // at 360° and read as two edges, each turned less than the bend: the turn
  // across the join was lost. Nothing noticed because the bend on this page
  // happened to lie clear of 0°; #583 drew it the right way round, which is
  // its mirror, and it read 81.7° and 73.3° against 94.7° and 89.7°. Where
  // the sweep starts is not a property of the road, so it is chosen where it
  // cannot cut one.
  let start = 0;
  while (start < rays && crossing(start) !== undefined) start += 1;
  for (let step = 0; step < rays; step += 1) {
    const found = crossing((start + step) % rays);
    if (found === undefined) {
      close();
      continue;
    }
    const { dx, dy, entered, left } = found;
    innerRun.push([centre + dx * entered, centre + dy * entered]);
    outerRun.push([centre + dx * left, centre + dy * left]);
  }
  close();
  return { inner, outer };
}

function readBend(unsmoothed: boolean, pixelsPerMetre: number): BendReading {
  const mask = roadMask(unsmoothed);
  let roadPixels = 0;
  for (const pixel of mask) roadPixels += pixel;
  const { inner, outer } = edges(mask, pixelsPerMetre);
  return {
    roadPixels,
    inner: readEdge(inner, pixelsPerMetre),
    outer: readEdge(outer, pixelsPerMetre),
  };
}

async function run(): Promise<BendMeasurement> {
  await loadSceneryModels();
  // The frame spans 2·altitude·tan(fov / 2) metres across its height, and it
  // is square.
  const pixelsPerMetre = SIZE / (2 * ALTITUDE_METRES * verticalHalfTangent(1));
  return {
    size: SIZE,
    pixelsPerMetre,
    radiusMetres: BEND.radiusMetres,
    drawn: readBend(false, pixelsPerMetre),
    unsmoothed: readBend(true, pixelsPerMetre),
  };
}

run().then(
  (measurement) => {
    window.__oylBend = { ready: true, errors: [], measurement };
  },
  (error: unknown) => {
    window.__oylBend = {
      ready: false,
      errors: [error instanceof Error ? error.message : String(error)],
      measurement: undefined,
    };
  },
);
