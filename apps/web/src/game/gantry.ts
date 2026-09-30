// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the realistic world's start and finish gantries stand, and what they
 * are made of — #679.
 *
 * ## At the line and nowhere else
 *
 * A loop has ONE line, at route distance 0 — the lap line the HUD's "To go"
 * already counts to (`hud/fields.ts` §`hudReadings`) — and one gantry over it,
 * reading {@link LINE_WORDS}' `lap`. A point-to-point route has two: `start`
 * at distance 0 and `finish` at its end. Each has a board one distance unit
 * before it in the rider's own units (`gantry-wording.ts` §`toGoText`), low
 * barriers on both verges for {@link BARRIER_REACH_METRES} either side of it,
 * and nothing else.
 *
 * ## Drawn only near a line
 *
 * {@link linesNear} hands a frame only the gantries and boards within
 * {@link LINE_DRAW_AHEAD_METRES} ahead of the rider or
 * {@link LINE_DRAW_BEHIND_METRES} behind, so anywhere else on a route the
 * gantry costs no draw call and no triangle (`three-renderer.ts`
 * §`GantryBelt` hides its meshes when a frame carries none).
 *
 * ## Clear of the carriageway, and of everything else
 *
 * Every leg stands {@link GANTRY_LEG_CLEARANCE_METRES} outside the road's
 * edge, its underside — the banner's bottom edge — is
 * {@link GANTRY_HEADROOM_METRES} above the road at the line, and the barriers
 * stand on the verge, each piece on the DRAWN road at its own distance
 * (§`PlacedStand.boxes`), which `scatter.ts` keeps
 * three metres of clear ground beside (`SCATTER_VERGE_METRES`) — so nothing
 * scattered can meet them, and `gantry.test.ts` holds the structures and the
 * water off them on the fixture routes.
 *
 * ## Built from numbers
 *
 * Boxes, as `buildings.ts` builds a barn — not Poly Haven's street furniture,
 * which is the research's N5 and is the owner's to decide. The banner is a
 * quad whose texture is rasterised from the committed Roboto's glyph ranges
 * (`banner-atlas.ts`).
 *
 * Pure: names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import {
  BANNER_SUBLINE,
  LINE_WORDS,
  oneDistanceUnitMetres,
  toGoText,
  type LineKind,
} from './gantry-wording';
import { ROAD_WIDTH_METRES, type CorridorPoint, type RoadCorridor } from './terrain';

/** Half the road, edge to centre line. */
const HALF_ROAD = ROAD_WIDTH_METRES / 2;

/** How far outside the road's edge each gantry leg stands, to its inner face: **0.9 m**. */
export const GANTRY_LEG_CLEARANCE_METRES = 0.9;

/** A leg's side, square: **0.35 m**. */
export const GANTRY_LEG_METRES = 0.35;

/**
 * The gantry's UNDERSIDE above the road at the line — its lowest point over
 * the carriageway, which is the banner's bottom edge: **4 m**. ⚠️ Not the
 * beam's: the banner hangs a metre below it, and until #879's review this
 * constant was the beam's 5 m while the banner came down to 4.
 */
export const GANTRY_HEADROOM_METRES = 4;

/** The beam's depth (along the road) and height: **0.4 m** and **0.5 m**. */
export const GANTRY_BEAM_DEPTH_METRES = 0.4;
export const GANTRY_BEAM_HEIGHT_METRES = 0.5;

/** The banner under the beam, facing the rider: **6 m** wide and **1.5 m** tall. */
export const BANNER_WIDTH_METRES = 6;
export const BANNER_HEIGHT_METRES = 1.5;

/** The beam's underside: the banner's top, less the beam it hangs from — **5 m**. */
export const GANTRY_BEAM_UNDERSIDE_METRES =
  GANTRY_HEADROOM_METRES + BANNER_HEIGHT_METRES - GANTRY_BEAM_HEIGHT_METRES;

/** How far outside the road's edge a barrier stands, to its middle: **0.35 m** — on the verge. */
export const BARRIER_OFFSET_METRES = 0.35;

/** A barrier piece: **2.5 m** long, **1.1 m** tall, **0.08 m** thick. */
export const BARRIER_LENGTH_METRES = 2.5;
export const BARRIER_HEIGHT_METRES = 1.1;
export const BARRIER_THICKNESS_METRES = 0.08;

/** How far either side of a line the barriers run: **20 m** — eight pieces a side a verge. */
export const BARRIER_REACH_METRES = 20;

/** The board before a line: on a post **2.6 m** tall, **2.4 m** wide, beside the right verge. */
export const BOARD_WIDTH_METRES = 2.4;
export const BOARD_HEIGHT_METRES = 0.8;
export const BOARD_POST_METRES = 2.6;

/**
 * How far ahead of the rider a line is drawn: **375 m** — the corridor's
 * `VIEW_AHEAD_METRES` (400) less the barriers' reach and a little, so every
 * barrier piece of a line in reach stands on road the frame actually draws
 * (#879's review: at 400 the far pieces fell off the corridor's end, and were
 * carried on along its last heading, which on a bend is the carriageway) —
 * and behind: **30 m**, which the chase camera's 4.5 m cannot see past but a
 * rider who has just crossed a line looks back through; its barriers reach
 * about 50 m back, inside the corridor's 60.
 */
export const LINE_DRAW_AHEAD_METRES = 375;
export const LINE_DRAW_BEHIND_METRES = 30;

/** How far past the start the board before the finish must stand, or there is none: **50 m**. */
export const BOARD_CLEAR_OF_START_METRES = 50;

/** Something that stands at a line — a gantry, or the board before it. */
export interface LineStand {
  readonly kind: 'gantry' | 'board';
  /** Its route distance, wrapped as `CorridorPoint.distance` is. */
  readonly distance: number;
  /** The banner's text: a key `banner-atlas.ts` rasterised. */
  readonly text: string;
  /** The smaller line under it, or none. */
  readonly subline?: string;
}

/** What stands at the lines of a route, for a rider in these units. */
export function lineStands(profile: RouteProfile, units: UnitSystem): readonly LineStand[] {
  const total = profile.totalDistance as number;
  const unit = oneDistanceUnitMetres(units);
  const lines: { readonly kind: LineKind; readonly distance: number }[] = profile.loop
    ? [{ kind: 'lap', distance: 0 }]
    : [
        { kind: 'start', distance: 0 },
        { kind: 'finish', distance: total },
      ];
  const stands: LineStand[] = [];
  for (const line of lines) {
    stands.push({
      kind: 'gantry',
      distance: line.distance,
      text: LINE_WORDS[line.kind],
      subline: BANNER_SUBLINE,
    });
  }
  // One board, one unit before the line a rider rides TOWARD — the lap line
  // at the lap's end, or the finish — and not on a route too short to hold it,
  // where it would stand at or behind the start.
  if (total - unit > BOARD_CLEAR_OF_START_METRES) {
    stands.push({ kind: 'board', distance: total - unit, text: toGoText(units) });
  }
  return stands;
}

/** A point on the drawn road's centreline and the road's direction there. */
export interface RoadFrame {
  /** On the drawn road's centreline, local metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The road's direction there, a unit vector in the ground plane. */
  readonly headingX: number;
  readonly headingZ: number;
}

/**
 * One box of a stand, placed: the frame it is built in — the DRAWN road at the
 * box's own route distance, facing along the road there — and the box, whose
 * `across` and `up` are measured from that frame and whose `along` has been
 * spent finding it.
 */
export interface PlacedBox extends RoadFrame {
  readonly box: StandBox;
}

/** A stand placed in the corridor's frame, for this frame. */
export interface PlacedStand extends RoadFrame {
  readonly stand: LineStand;
  /**
   * Every box it is built from, each on the drawn road at its OWN route
   * distance. ⚠️ Not offset along the line's tangent: a barrier 20 m from the
   * line on a 200 m circuit would then stand d²/2R ≈ 1 m nearer the centre,
   * inside the carriageway (#879's review) — and on a 60 m circuit on the
   * centre line itself.
   */
  readonly boxes: readonly PlacedBox[];
}

/**
 * The stands within reach of the rider, placed on the DRAWN road — the
 * corridor this frame's road is built from — between the two corridor points
 * whose odometers bracket the stand's. On a loop a stand is matched on every
 * lap at once, by odometer, which is `CorridorPoint.along`'s reason for
 * existing.
 */
export function linesNear(
  profile: RouteProfile,
  corridor: RoadCorridor,
  riderDistance: number,
  stands: readonly LineStand[],
): readonly PlacedStand[] {
  const centre = corridor.centre;
  if (centre.length < 2 || stands.length === 0) return [];
  const total = profile.totalDistance as number;
  const placed: PlacedStand[] = [];
  for (const stand of stands) {
    // The odometer readings this stand is at near the rider: on a loop, every
    // lap's; on a point-to-point route, its distance.
    const lapsFrom = profile.loop ? Math.floor(riderDistance / total) - 1 : 0;
    const lapsTo = profile.loop ? lapsFrom + 2 : 0;
    for (let lap = lapsFrom; lap <= lapsTo; lap += 1) {
      const along = stand.distance + lap * total;
      const ahead = along - riderDistance;
      if (ahead > LINE_DRAW_AHEAD_METRES || ahead < -LINE_DRAW_BEHIND_METRES) continue;
      // A loop is matched by odometer, which never clamps or wraps; a
      // point-to-point route by route distance, because behind its start the
      // corridor's points are clamped onto it while their odometers go on.
      const at = onCorridor(centre, profile.loop ? along : stand.distance, profile.loop);
      if (at === undefined) continue;
      const from = profile.loop ? along : stand.distance;
      const boxes = standBoxes(stand.kind).map((box): PlacedBox =>
        box.along === 0
          ? { box, ...at }
          : { box, ...alongDrawnRoad(centre, from + box.along, profile.loop) },
      );
      placed.push({ stand, ...at, boxes });
    }
  }
  return placed;
}

/**
 * The drawn road at a distance, and — past either end of the corridor, where
 * nothing is drawn — the road's straight continuation from that end. Never
 * undefined, for a box: a barrier past a point-to-point route's finish stands
 * on the road's line carried on, as it did before.
 */
function alongDrawnRoad(
  centre: readonly CorridorPoint[],
  along: number,
  byOdometer: boolean,
): RoadFrame {
  const found = onCorridor(centre, along, byOdometer);
  if (found !== undefined) return found;
  const at = (point: CorridorPoint): number => (byOdometer ? point.along : point.distance);
  let first: { readonly here: CorridorPoint; readonly next: CorridorPoint } | undefined;
  let last: { readonly here: CorridorPoint; readonly next: CorridorPoint } | undefined;
  for (let index = 0; index + 1 < centre.length; index += 1) {
    const here = centre[index] as CorridorPoint;
    const next = centre[index + 1] as CorridorPoint;
    if (Math.hypot(next.x - here.x, next.z - here.z) === 0 || at(next) === at(here)) continue;
    first ??= { here, next };
    last = { here, next };
  }
  if (first === undefined || last === undefined) {
    const only = centre[0] as CorridorPoint;
    return { x: only.x, y: only.y, z: only.z, headingX: 0, headingZ: 1 };
  }
  const before = along < at(first.here);
  const piece = before ? first : last;
  const end = before ? piece.here : piece.next;
  const dx = piece.next.x - piece.here.x;
  const dz = piece.next.z - piece.here.z;
  const span = Math.hypot(dx, dz);
  const perMetre = span / (at(piece.next) - at(piece.here));
  const beyond = (along - at(end)) * perMetre;
  const rise = (piece.next.y - piece.here.y) / span;
  return {
    x: end.x + (dx / span) * beyond,
    y: end.y + rise * beyond,
    z: end.z + (dz / span) * beyond,
    headingX: dx / span,
    headingZ: dz / span,
  };
}

function onCorridor(
  centre: readonly CorridorPoint[],
  along: number,
  byOdometer: boolean,
): RoadFrame | undefined {
  // The last piece of road with length, for the end of a point-to-point route:
  // the corridor clamps its points onto the route's end, so past it every
  // piece has none, and the line is where the last real one ends.
  let real: { readonly here: CorridorPoint; readonly next: CorridorPoint } | undefined;
  for (let index = 0; index + 1 < centre.length; index += 1) {
    const here = centre[index] as CorridorPoint;
    const next = centre[index + 1] as CorridorPoint;
    const dx = next.x - here.x;
    const dz = next.z - here.z;
    const span = Math.hypot(dx, dz);
    const from = byOdometer ? here.along : here.distance;
    const to = byOdometer ? next.along : next.distance;
    const inside = from <= along && along < to;
    if (span > 0) {
      real = { here, next };
      if (!inside) continue;
      const share = (along - from) / (to - from);
      return {
        x: here.x + dx * share,
        y: here.y + (next.y - here.y) * share,
        z: here.z + dz * share,
        headingX: dx / span,
        headingZ: dz / span,
      };
    }
    // Clamped onto a point-to-point route's end, where the distance stops.
    const atTheEnd = !byOdometer && from === to && Math.abs(from - along) < 1e-6;
    if ((inside || atTheEnd) && real !== undefined) {
      const rx = real.next.x - real.here.x;
      const rz = real.next.z - real.here.z;
      const length = Math.hypot(rx, rz);
      return {
        x: real.next.x,
        y: real.next.y,
        z: real.next.z,
        headingX: rx / length,
        headingZ: rz / length,
      };
    }
  }
  return undefined;
}

/** One box of a gantry, a barrier or a board, in the stand's own frame. */
export interface StandBox {
  /** Its middle: across the road (to the rider's right), up from the road, along it. */
  readonly across: number;
  readonly up: number;
  readonly along: number;
  /** Its size on each of those axes. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly role: 'metal' | 'barrier' | 'board';
}

/**
 * The boxes a stand is built from, in its own frame — `across` to the rider's
 * right, `up` from the road at the line, `along` the road. A gantry: two legs,
 * a beam and {@link BARRIER_REACH_METRES} of barrier each side each way. A
 * board: its post.
 */
export function standBoxes(kind: LineStand['kind']): readonly StandBox[] {
  if (kind === 'board') {
    return [
      {
        across: HALF_ROAD + 1.2,
        up: BOARD_POST_METRES / 2,
        along: 0,
        width: 0.12,
        height: BOARD_POST_METRES,
        depth: 0.12,
        role: 'metal',
      },
    ];
  }
  const legAcross = HALF_ROAD + GANTRY_LEG_CLEARANCE_METRES + GANTRY_LEG_METRES / 2;
  const top = GANTRY_BEAM_UNDERSIDE_METRES + GANTRY_BEAM_HEIGHT_METRES;
  const boxes: StandBox[] = [
    ...[-1, 1].map((side): StandBox => ({
      across: side * legAcross,
      // From half a metre into the ground, so a verge that drops is met.
      up: (top - 0.5) / 2,
      along: 0,
      width: GANTRY_LEG_METRES,
      height: top + 0.5,
      depth: GANTRY_LEG_METRES,
      role: 'metal',
    })),
    {
      across: 0,
      up: GANTRY_BEAM_UNDERSIDE_METRES + GANTRY_BEAM_HEIGHT_METRES / 2,
      along: 0,
      width: 2 * legAcross + GANTRY_LEG_METRES,
      height: GANTRY_BEAM_HEIGHT_METRES,
      depth: GANTRY_BEAM_DEPTH_METRES,
      role: 'metal',
    },
  ];
  const pieces = Math.round(BARRIER_REACH_METRES / BARRIER_LENGTH_METRES);
  for (const side of [-1, 1]) {
    for (const way of [-1, 1]) {
      for (let piece = 0; piece < pieces; piece += 1) {
        boxes.push({
          across: side * (HALF_ROAD + BARRIER_OFFSET_METRES),
          up: BARRIER_HEIGHT_METRES / 2,
          // Clear of the leg at the line itself.
          along: way * (GANTRY_LEG_METRES + (piece + 0.5) * BARRIER_LENGTH_METRES),
          width: BARRIER_THICKNESS_METRES,
          height: BARRIER_HEIGHT_METRES,
          depth: BARRIER_LENGTH_METRES * 0.96,
          role: 'barrier',
        });
      }
    }
  }
  return boxes;
}

/**
 * Where a stand's banner is, in its own frame: its middle, and its size. The
 * banner faces the rider riding toward the line — against the road's heading
 * — and reads left to right toward the rider's right.
 */
export function bannerPlace(kind: LineStand['kind']): {
  readonly across: number;
  readonly up: number;
  readonly along: number;
  readonly width: number;
  readonly height: number;
} {
  if (kind === 'board') {
    return {
      across: HALF_ROAD + 1.2,
      up: BOARD_POST_METRES - BOARD_HEIGHT_METRES / 2,
      along: -0.07,
      width: BOARD_WIDTH_METRES,
      height: BOARD_HEIGHT_METRES,
    };
  }
  return {
    across: 0,
    up: GANTRY_HEADROOM_METRES + BANNER_HEIGHT_METRES / 2,
    // Just in front of the beam's rider-side face, so it is not inside it.
    along: -(GANTRY_BEAM_DEPTH_METRES / 2 + 0.02),
    width: BANNER_WIDTH_METRES,
    height: BANNER_HEIGHT_METRES,
  };
}

/**
 * A point of a stand's own frame in the corridor's: `across` along the road's
 * normal — the rider's right, `(−headingZ, headingX)` (`terrain.ts`) — `up`
 * straight up and `along` the heading.
 */
export function standPoint(
  placed: PlacedStand,
  across: number,
  up: number,
  along: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: placed.x - placed.headingZ * across + placed.headingX * along,
    y: placed.y + up,
    z: placed.z + placed.headingX * across + placed.headingZ * along,
  };
}

/**
 * A point of a placed box's own frame in the corridor's: `across` along the
 * road's normal there, `up` straight up — the box's `along` has already been
 * spent finding the frame (§`PlacedStand.boxes`).
 */
export function boxPoint(
  placed: PlacedBox,
  across: number,
  up: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: placed.x - placed.headingZ * across,
    y: placed.y + up,
    z: placed.z + placed.headingX * across,
  };
}
