// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The start of a LOOP, drawn by the real renderer at the real chase camera —
 * #440.
 *
 * ## What was seen
 *
 * The owner's Pixel Tablet, 2026-09-21, at 0 % of a loop route with #424's low
 * chase camera: the asphalt stopped abruptly along an edge with grass below it,
 * and a white edge line crossed the road diagonally.
 *
 * ## What the geometry says — the cause, established by reading it
 *
 * `packages/domain`'s `routeProfile` admits a loop whose two ends are up to
 * `LOOP_CLOSURE_METRES` (25 m) apart, and until #440 it profiled the route up
 * to its last point only. `distanceOnRoute` then wraps `totalDistance` onto 0,
 * so the last grid sample and the first are neighbours in ROUTE distance and
 * up to 25 m apart on the GROUND. `terrain.ts` §`roadCorridor` builds the
 * corridor from `atDistance − VIEW_BEHIND_METRES`, so at the start of a loop
 * the corridor runs through the wrap: one ribbon segment 22 m long (a 20 m gap
 * plus a 10 m grid step, measured) cutting across from the loop's end to its
 * start, with its edge lines. That is the diagonal white line and the cut edge.
 * The issue's hypothesis — "the end of the loop approaching the start at a
 * different heading" — was close: it is the end of the loop, and what makes it
 * visible is that the wrap crosses the gap in zero metres.
 *
 * The camera did not cause it and moving the camera would only hide it: the
 * old camera stood 8 m back, on the same segment.
 *
 * ## What is measured, and the control
 *
 * Each frame is rendered twice — with the road, and with the road's index list
 * emptied — so the pixels that differ are the road and nothing else (no
 * markers, no scenery). For every row the harness reports where the road
 * starts and ends, and how many separate runs of road the row holds.
 *
 * What the break DOES to the picture, read off a screenshot of both frames
 * while this page was written: the rider is placed on the stretched segment
 * that spans the gap, so the chase camera takes that segment's heading and
 * looks across the road rather than down it — the road ahead runs off to one
 * side of the frame and its centre line crosses the view diagonally, which is
 * the owner's "stray diagonal white line". On the closed loop the camera looks
 * down the road, and the road converges on the middle of the frame. So the
 * measurement is **where the far road is, across the frame**: {@link
 * RoadRows.aheadCentre}.
 *
 * ⚠️ **The control is the route as a pre-#440 build stored it**: the same
 * points profiled as a line and then marked `loop: true`, which is exactly the
 * profile a saved route from before the fix still carries (a stored profile is
 * a computed artefact and nothing rewrites it). The spec requires THAT frame to
 * show the break, so a green run is not a frame that drew no road.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import type { SceneFrame } from '../src/game/port';
import { qualitySettings } from '../src/game/quality';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import { corridorOrigin } from '../src/game/terrain';
import { loadSceneryModels, threeGameRenderer } from '../src/game/three-renderer';

/** One frame's road, row by row, from the bottom of the frame up. */
export interface RoadRows {
  /** How far the loop's two ends are apart in the points it was built from. */
  readonly gapMetres: number;
  /** How many pixels were road at all. Zero means there was nothing to measure. */
  readonly roadPixels: number;
  /**
   * For each row from the bottom, the road's leftmost and rightmost column, or
   * `null` when no pixel in that row is road.
   */
  readonly rows: readonly (readonly [number, number] | null)[];
  /** How many separate runs of road each row holds. A ribbon seen once is one. */
  readonly runs: readonly number[];
  /**
   * The mean centre of the road across its FAR quarter — the top quarter of
   * the rows the road occupies, where it converges — as a fraction of the
   * frame's width. A camera looking down the road it is on puts this near 0.5.
   */
  readonly aheadCentre: number;
}

export interface LoopStartMeasurement {
  readonly width: number;
  readonly height: number;
  /** The route as this build profiles it. */
  readonly closed: RoadRows;
  /** The control: the same points as a pre-#440 build stored them. */
  readonly stored: RoadRows;
}

declare global {
  interface Window {
    __oylLoop?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measurement: LoopStartMeasurement | undefined;
    };
  }
}

const WIDTH = 640;
const HEIGHT = 360;
const METRES_PER_DEGREE = 111_320;
const LATITUDE = 51.5;
/** A 400 m square, ridden anticlockwise from the middle of its south side. */
const SIDE_METRES = 400;
const STEP_METRES = 10;
/**
 * Where the loop's last point is, relative to its first: 10 m short of the
 * start and 12 m to its left — a finish recorded on the far side of the road
 * from the start, which is the usual untidy closure of a recorded GPX loop.
 * 15.6 m apart, inside `LOOP_CLOSURE_METRES`.
 */
const END_SHORT_METRES = 10;
const END_ACROSS_METRES = 12;

/** The loop's points, in local metres east (x) and north (y) of the start. */
function loopPoints(): RoutePoint[] {
  const half = SIDE_METRES / 2;
  const path: Array<readonly [number, number]> = [];
  for (let s = 0; s <= half; s += STEP_METRES) path.push([s, 0]);
  for (let s = STEP_METRES; s <= SIDE_METRES; s += STEP_METRES) path.push([half, s]);
  for (let s = half - STEP_METRES; s >= -half; s -= STEP_METRES) path.push([s, SIDE_METRES]);
  for (let s = SIDE_METRES - STEP_METRES; s >= END_ACROSS_METRES; s -= STEP_METRES) {
    path.push([-half, s]);
  }
  // Back along the south side, 12 m north of the start line, stopping short.
  for (let s = -half + STEP_METRES; s <= -END_SHORT_METRES; s += STEP_METRES) {
    path.push([s, END_ACROSS_METRES]);
  }
  const perLongitude = METRES_PER_DEGREE * Math.cos((LATITUDE * Math.PI) / 180);
  return path.map(([east, north]) => ({
    position: geographicPosition(
      degreesLatitude(LATITUDE + north / METRES_PER_DEGREE),
      degreesLongitude(-0.12 + east / perLongitude),
    ),
    // A gentle tilt, so the two ends are also at different heights and the
    // vertical half of the wrap is exercised as well.
    elevation: altitudeMetres(10 + east * 0.01 + north * 0.02),
  }));
}

/**
 * The frame at the start line, with nothing on the road but the road.
 *
 * ⚠️ **Through the CENTRELINE's camera since #499** (`centreline: true`). The
 * product's camera now stands on the rider's racing line, and at this loop's
 * start the line is off the centre of the road, so the far road it looks down
 * sits off the middle of the frame — measured at 44.0 % of the width against
 * this spec's 5 % tolerance of the middle. That is the camera following the
 * rider across the road, which is #499's intent, and says nothing about the
 * road's continuity at the wrap or which way the camera faces, which is what
 * #440's claim is about and what this page measures.
 */
function startFrame(profile: RouteProfile): SceneFrame {
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: atStartLine(profile),
    centreline: true,
  });
  return { ...frame, scatter: [], markers: [] };
}

function roadRows(profile: RouteProfile): RoadRows {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const view = threeGameRenderer.create(canvas, qualitySettings(0));
  view.resize(WIDTH, HEIGHT);
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) {
    view.destroy();
    throw new Error('loop harness: no GL context');
  }
  const withRoad = startFrame(profile);
  const noRoad: SceneFrame = {
    ...withRoad,
    corridor: { ...withRoad.corridor, indices: new Uint32Array(0) },
  };
  const read = (): Uint8Array => {
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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

  const rows: Array<readonly [number, number] | null> = [];
  const runs: number[] = [];
  let roadPixels = 0;
  for (let row = 0; row < HEIGHT; row += 1) {
    let low = -1;
    let high = -1;
    let count = 0;
    let inRun = false;
    for (let column = 0; column < WIDTH; column += 1) {
      const at = (row * WIDTH + column) * 4;
      const road =
        present[at] !== absent[at] ||
        present[at + 1] !== absent[at + 1] ||
        present[at + 2] !== absent[at + 2];
      if (road) {
        roadPixels += 1;
        if (low === -1) low = column;
        high = column;
        if (!inRun) count += 1;
      }
      inRun = road;
    }
    rows.push(low === -1 ? null : [low, high]);
    runs.push(count);
  }
  const occupied = rows.flatMap((row) => (row === null ? [] : [row]));
  const far = occupied.slice(Math.floor(occupied.length * 0.75));
  const aheadCentre =
    far.length === 0
      ? 0
      : far.reduce((sum, [low, high]) => sum + (low + high) / 2, 0) / far.length / WIDTH;
  return {
    gapMetres: Math.hypot(END_SHORT_METRES, END_ACROSS_METRES),
    roadPixels,
    rows,
    runs,
    aheadCentre,
  };
}

async function run(): Promise<LoopStartMeasurement> {
  await loadSceneryModels();
  const points = loopPoints();
  // What this build does with a loop: closes it (#440).
  const closed = routeProfile(points, { loop: true });
  // ⚠️ The control: a profile as a pre-#440 build stored it — the line, marked
  // as a loop after the fact. Nothing about it is invented for the test.
  const stored: RouteProfile = { ...routeProfile(points), loop: true };
  return { width: WIDTH, height: HEIGHT, closed: roadRows(closed), stored: roadRows(stored) };
}

run().then(
  (measurement) => {
    window.__oylLoop = { ready: true, errors: [], measurement };
  },
  (error: unknown) => {
    window.__oylLoop = {
      ready: false,
      errors: [error instanceof Error ? error.message : String(error)],
      measurement: undefined,
    };
  },
);
