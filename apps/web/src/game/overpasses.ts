// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overpasses and underpasses — #2661: where a mapped street crosses the route
 * on a bridge or in a tunnel, the grade separation is drawn.
 *
 * `cross-streets.ts` §`meetsAtGrade` rightly leaves such a street out of the
 * junctions, but until #2661 nothing else drew it: the rider passed under an
 * invisible overpass (the 2026-11-15 tag audit's Chicago case, Halsted St
 * under I-290).
 *
 * ## Where a crossing is
 *
 * {@link mappedGradeCrossings}: from #1539's corridor, every street whose
 * `grade` (`StreetFeature.grade`, the tile's `is_bridge` and `is_tunnel`) is
 * not `'ground'`, resampled as the junctions' streets are
 * (`cross-streets.ts` §`resampled`). A crossing is where two of its points
 * next to each other lie within `cross-streets.ts`
 * §`JUNCTION_TOLERANCE_METRES` of the same stretch of the drawn road on
 * OPPOSITE sides of it: the street passes from one side to the other. A
 * street that runs along the route — within `cross-streets.ts`
 * §`JUNCTION_MIN_ANGLE_DEGREES` of its heading, either way — crosses
 * nothing. A `highway` crosses as any other street does: a motorway bridge is
 * the case the audit found.
 *
 * - **A bridge** is the street passing OVER the route: an overpass.
 * - **A tunnel** is the street passing UNDER it, so the route is on a bridge
 *   of its own there. ⚠️ **Only where that is visible**: a tunnel way longer
 *   than {@link UNDERPASS_MAX_METRES} is a bored tunnel deep under the ground,
 *   which a rider above it cannot see, and is not one.
 *
 * Crossings within {@link CROSSING_MERGE_METRES} of each other along the route,
 * of one grade, are one — a way split where it crosses, or traced twice — so
 * that two blocks never stand in the same place.
 *
 * ## What is drawn
 *
 * Boxes, as #459's stream bridges are (`waterways.ts` §`BridgePart`), handed
 * to the frame's bridges (`scene.ts` §`water`) and drawn by
 * `three-renderer.ts` §`BridgeBelt`. ⚠️ **Since #2699 an overpass's boxes are
 * not in the stone**: the belt draws them in a second instanced box of its
 * own, in the colour each box's `finish` names, so a frame with an overpass
 * makes one draw call more than it did. Nothing here adds a structure, and
 * the frame's bridges are still cut to `waterways.ts` §`MAXIMUM_BRIDGE_PARTS`
 * boxes, twelve triangles each, whichever of the belt's two draws them.
 *
 * - **An overpass**: a level deck slab along the
 *   street, long enough to cover both abutments however skew it crosses; an
 *   edge beam along each side of the deck, which rises above it as the
 *   parapet; and an abutment each side of the road, parallel to it and
 *   {@link OVERPASS_SETBACK_METRES} off its edge, from under the ground up to
 *   the deck's top. The edge beams' feet are the lowest of it, at
 *   {@link OVERPASS_CLEARANCE_METRES} above the highest of the road it spans.
 *
 *   **Why the abutments stand 15 m out — #2699's third round.** The owner:
 *   "nothing taller than about 1 m within 15 m of the main carriageway edge,
 *   except the bridge itself". So the deck spans the verge to
 *   {@link OVERPASS_CLEAR_VERGE_METRES} off the road's edge, where the
 *   abutment's back is, and everything behind it — the approach and its
 *   embankment — is behind that line. Each abutment runs along the road as
 *   far as the embankment behind it spreads, as a wing wall does, so the
 *   embankment, which is cut off at that line, is retained by the concrete
 *   rather than seen end on.
 *   ⚠️ **Nothing of it stands in the carriageway below the clearance**:
 *   `overpasses.test.ts` holds every block's corners clear of the road's
 *   width up to that height.
 *
 *   **Why edge beams — #2699.** #2687's screenshots showed #2661's overpass as
 *   a flat brown slab: a deck and its parapets flush, in the stream bridges'
 *   stone, read from below as one block. So the deck now wears the road's own
 *   colour, being a road (`finish: 'road'`), and the beams, the parapets and
 *   the abutments a concrete grey (`'concrete'`), drawn apart from the stone
 *   (`three-renderer.ts` §`BridgeBelt`). Each beam stands
 *   {@link OVERPASS_EDGE_PROUD_METRES} proud of the deck's side and hangs
 *   {@link OVERPASS_EDGE_DROP_METRES} below its underside, so a rider under it
 *   sees a light edge either side of a dark deck — and that it is still five
 *   boxes, as #2661 drew, is what keeps the frame's share of the belt.
 * - **An overpass's road — #2699**, the owner's "Odd thing with overpass is
 *   there are no roads connected to it": the street it carries, as one strip
 *   in the side roads' mesh (`cross-streets.ts` §`SideRoadMesh`, drawn by
 *   `three-renderer.ts` §`SideRoadBelt` in the main road's own material, the
 *   photograph and its wear on a realistic rung) — so a frame with one in view
 *   makes no draw call more for it, and nothing scattered stands on it
 *   (`scene.ts` hands it to the scenery with the side roads). Over the deck it
 *   is the deck's top, between the parapets. Past each end of the deck it is
 *   an **approach** up to {@link APPROACH_METRES} long: one straight ramp down
 *   from the deck's top, at {@link APPROACH_GRADE} or steeper, that is on the
 *   ground by where its fade begins (§`rampOf`), then on the ground, and over
 *   its last {@link APPROACH_FADE_METRES} narrowing and sinking under it, as a
 *   side road fades. It follows the MAPPED street ({@link GradeCrossing.approaches}:
 *   the bridge way on from the crossing and each way that meets it end to end,
 *   while it is on the land read), moving onto it from the deck's line over
 *   12 m — **but only while that street heads away from the route**
 *   ({@link APPROACH_LEAVING_SHARE}): a frontage road or a slip road that turns
 *   to run beside the route is not followed, which is what drew #2699's second
 *   round's wall beside the rider. Where the street is not mapped any further,
 *   or no longer leaves the route, the approach carries on along the last
 *   heading it had — the deck's line itself where nothing past the bridge is.
 *   It stops short of the main carriageway and its verge, and of water.
 *   ⚠️ **One road an overpass, and no more overpasses than the boxes allow**:
 *   {@link APPROACH_TRIANGLES_PER_OVERPASS} each and
 *   {@link OVERPASS_ROAD_FRAME_TRIANGLES} a frame, in the side roads' mesh
 *   beside `cross-streets.ts` §`SIDE_ROAD_FRAME_TRIANGLES`.
 * - **An overpass's embankment — #2699's third round**, the owner's "slopes,
 *   not walls": wherever the approach stands above the ground, a bank from
 *   each of its edges down to the ground at {@link EMBANKMENT_RUN} : 1, its
 *   foot under the ground. It is ground, not road and not concrete: drawn by
 *   `three-renderer.ts` §`TerrainBelt` in the ground's OWN material, whichever
 *   that is this frame (the photographed grass and its patchwork, or the
 *   stylised ground), with a normal of its own for each face, so it is lit as
 *   the slope it is and meets the ground in the ground's look. Anything of it
 *   nearer the route than the abutments' backs is cut off at that line
 *   (§`toeOf`). {@link EMBANKMENT_TRIANGLES_PER_OVERPASS} each and
 *   {@link EMBANKMENT_FRAME_TRIANGLES} a frame; the scenery is kept off it
 *   with the road (`SideRoad.halfWidths` covers its foot).
 * - **An underpass**: a parapet with its coping along each edge of the road
 *   over the street's width and {@link UNDERPASS_MARGIN_METRES} either side,
 *   in pieces that follow the road's height — the stream bridge's own
 *   parapets (`waterways.ts` §`bridgeParts`). The ground under the road is not
 *   cut: the street below is no more seen than it was.
 *
 * ⚠️ **The deck is at the route's height, not the street's.** A street's
 * height is not in the tile, so a route in a cutting still has the deck five
 * metres over it, its abutments rising from the ground beside the road. The
 * route's own grade is never read or changed: nothing here touches
 * a profile, and what a trainer is sent at an overpass is the route's.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a street's `kind`, `kindDetail`, `grade` and line, and never a name.
 *
 * Pure, built once a corridor and once a crossing, and names no rendering
 * library.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';

import type { StreetFeature } from '@onyourleft/map-features';

import {
  JUNCTION_MIN_ANGLE_DEGREES,
  JUNCTION_TOLERANCE_METRES,
  resampled,
  SIDE_ROAD_END_WIDTH_SHARE,
  SIDE_ROAD_LIFT_METRES,
  SIDE_ROAD_SINK_METRES,
  SIDE_ROAD_WIDTHS,
  stationAt,
  STREET_MAX_METRES,
  TARMAC,
  widthClassOf,
  type SideRoad,
  type WidthClass,
} from './cross-streets';
import type { LandClassMask } from './land-class';
import { terrainHeightAt, VERGE_METRES } from './landform';
import { nearestOnDrawnRoad, type NearestOnRoad } from './road-grid';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import {
  BRIDGE_PIECE_METRES,
  COPING_DEPTH_METRES,
  COPING_OVERHANG_METRES,
  inWater,
  PARAPET_HEIGHT_METRES,
  PARAPET_THICKNESS_METRES,
  waterways,
  type BridgeFinish,
  type BridgePart,
} from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** Half the main carriageway, in metres: **3.5**. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How far the underside of an overpass's deck stands above the road it spans,
 * in metres: **5** — about the 16 ft a US interstate bridge leaves, and the
 * 16 ft 6 in a British one does.
 */
export const OVERPASS_CLEARANCE_METRES = 5;

/**
 * How deep an overpass is from its edge beams' feet to its deck's top, in
 * metres: **1.2**. The deck slab is this less {@link OVERPASS_EDGE_DROP_METRES}.
 */
export const OVERPASS_DECK_DEPTH_METRES = 1.2;

/**
 * How far an overpass's edge beam hangs below its deck slab's underside, in
 * metres: **0.25** — #2699. A lip a rider under the bridge sees each side.
 */
export const OVERPASS_EDGE_DROP_METRES = 0.25;

/**
 * How far an overpass's edge beam stands proud of its deck slab's side, in
 * metres: **0.15** — #2699. Outward only: its inner face is over the deck.
 */
export const OVERPASS_EDGE_PROUD_METRES = 0.15;

/**
 * How far each edge beam's end reaches past the deck's. The two overlap where
 * the beam hangs below and stands above the deck's edge, and ends in the same
 * plane would draw as two colours fighting for it.
 */
export const OVERPASS_BEAM_OVERHANG_METRES = 0.02;

/**
 * How far off the main carriageway's edge nothing of an overpass but the
 * bridge itself — its deck, edge beams and abutments — stands more than
 * {@link OVERPASS_VERGE_HEIGHT_METRES} above the ground, in metres: **15** —
 * #2699's third round, the owner's "no wall over the verge". The abutments'
 * backs are on it. @see the header
 */
export const OVERPASS_CLEAR_VERGE_METRES = 15;

/**
 * The most anything but the bridge stands above the ground within
 * {@link OVERPASS_CLEAR_VERGE_METRES}: **1 m**, the owner's "about 1 m".
 *
 * @test-facing held by `overpasses.test.ts`, which samples every drawn
 * triangle of the road and its embankment; what keeps it in the product is
 * where the abutments stand and where an embankment is cut off (§`toeOf`)
 */
export const OVERPASS_VERGE_HEIGHT_METRES = 1;

/** How thick an overpass's abutment is, across the road, in metres: **1**. */
export const ABUTMENT_THICKNESS_METRES = 1;

/**
 * How far off the road's edge an overpass's abutment's face stands, in metres:
 * **14** — its back on {@link OVERPASS_CLEAR_VERGE_METRES}. #2661 drew it 3 m
 * off, which put the approach's embankment over the verge.
 */
export const OVERPASS_SETBACK_METRES = OVERPASS_CLEAR_VERGE_METRES - ABUTMENT_THICKNESS_METRES;

/**
 * How far under the deck's top an abutment's top is, in metres: **0.02**. It
 * rises to the deck's top, not its underside, since #2699's third round, so
 * that past the deck's sides it retains the embankment behind it; inside the
 * deck it is hidden, and a face a hair under the deck's never fights it.
 */
const ABUTMENT_TUCK_METRES = 0.02;

/** How far below the ground an abutment's foot reaches, in metres: **0.3**. */
const ABUTMENT_FOOT_METRES = 0.3;

/**
 * The longest tunnel way that is an underpass, in metres: **80**. Longer is a
 * bored tunnel deep under the ground, which nothing on the route can see.
 */
export const UNDERPASS_MAX_METRES = 80;

/** How far past the street's edges an underpass's parapets run, along the road, in metres: **2**. */
export const UNDERPASS_MARGIN_METRES = 2;

/** Crossings of one grade within this many metres along the route are one: **3**. */
export const CROSSING_MERGE_METRES = 3;

/**
 * The most crossings one route keeps: **1 000**, in route order. A street
 * network is an imported file's; past this the route has no more of them
 * rather than an unbounded list, as `cross-streets.ts` §`MAX_JUNCTIONS`.
 */
export const MAX_GRADE_CROSSINGS = 1_000;

/**
 * The most boxes a frame's overpasses and underpasses may add: **48**,
 * nearest the rider first — nine overpasses of five boxes, or two of the widest, most
 * skew underpasses. Inside `waterways.ts` §`MAXIMUM_BRIDGE_PARTS`, which the
 * frame's bridges are cut to with the streams' first.
 */
export const OVERPASS_FRAME_PARTS = 48;

/** The boxes one overpass is: its deck, two edge beams and two abutments. */
const OVERPASS_BOXES = 5;

/**
 * How far past each end of an overpass's deck its street is drawn, in metres:
 * **160** — #2699, the owner's "there are no roads connected to it". About
 * where the fog (`world.ts`) has taken most of a road off to the side, and
 * past the 60 m a side road is drawn (`cross-streets.ts` §`SIDE_ROAD_METRES`).
 */
export const APPROACH_METRES = 160;

/**
 * The gentlest an approach falls from the deck: **6 %**, a street's ramp.
 * Steeper wherever that would not bring it to the ground before its fade
 * begins (`rampOf`), which inside the ground the view draws is most places.
 */
export const APPROACH_GRADE = 0.06;

/**
 * How fast a mapped street must head away from the route for an approach to
 * follow it: **0.4** of a metre off the route for each metre along it, about
 * 24° — #2699's third round. Under the 30° a crossing must make
 * (`cross-streets.ts` §`JUNCTION_MIN_ANGLE_DEGREES`), so the deck's own line
 * always does. A way that turns to run beside the route, or back towards it,
 * is left there, and the approach carries on along the heading it had.
 */
export const APPROACH_LEAVING_SHARE = 0.4;

/** How far apart an approach's rows are, in metres: **4**. */
export const APPROACH_STEP_METRES = 4;

/**
 * The last this many metres of an approach narrow and go under the ground,
 * in metres: **40** — as a side road fades (`cross-streets.ts`
 * §`SIDE_ROAD_END_WIDTH_SHARE`, §`SIDE_ROAD_SINK_METRES`), with no transparency.
 */
export const APPROACH_FADE_METRES = 40;

/**
 * How far from the route an approach may run, metres — the ground the reduced
 * rungs draw ends at 90 m (`quality.ts` §`terrainBands`, the floor rung), so a
 * road further out hangs over no ground. Its fade ends here: it is cut off
 * rather than run on.
 */
export const APPROACH_REACH_METRES = 90;

/**
 * How far above the ground an approach stands where it has come down to it,
 * in metres: **0.08**. More than a side road's 0.03, because its rows are 4 m
 * apart rather than 2 and the ground between two of them may rise a little
 * above the straight line between them.
 */
export const APPROACH_GROUND_LIFT_METRES = 0.08;

/** Over how many metres past the deck an approach moves from the deck's line onto the mapped street's: **12**. */
const APPROACH_BLEND_METRES = 12;

/**
 * An embankment's slope, as metres out for each metre down: **2**, the owner's
 * "about 1:2" — 27°, gentler than the 28° where the realistic ground starts to
 * wear rock (`ground-blend.ts` §`ROCK_SLOPE_DEGREES`), so it is grass.
 */
export const EMBANKMENT_RUN = 2;

/** How far under the ground an embankment's foot is, in metres: **0.15**. */
const EMBANKMENT_FOOT_METRES = 0.15;

/** The furthest out from the road's edge an embankment's foot is, in metres: **40**. */
const EMBANKMENT_MAX_RUN_METRES = 40;

/** An embankment no taller than this at both ends of a step is not drawn there, in metres. */
const EMBANKMENT_LEAST_METRES = 0.12;

/** How many times an embankment's foot is moved to where its slope meets the ground. */
const EMBANKMENT_FOOT_STEPS = 3;

/** An embankment's vertex colour: the ground's own, untinted — the material carries the colour. */
const EARTH = [1, 1, 1] as const;

/** How far apart two ways' ends may be and still meet, in metres: **1**. */
const APPROACH_JOIN_METRES = 1;

/** The most ways one approach is followed through: **16**. */
const APPROACH_MAX_WAYS = 16;

/**
 * The most ways listed for one metre of ground — a crafted tile can put a
 * hundred thousand ends at one point, and every hop of every walk rescans the
 * ways there.
 */
const APPROACH_MAX_ENDS_PER_JOIN = 8;

/** The most an approach turns where one way meets the next and is still followed: **60°**. */
const APPROACH_TURN_COSINE = Math.cos(Math.PI / 3);

/**
 * How much of a street is read on from a crossing, either way, in metres:
 * past the widest half-deck (about 24 m, a motorway's at 30°), and
 * {@link APPROACH_METRES} beyond it.
 */
const APPROACH_READ_METRES = APPROACH_METRES + 60;

/**
 * How far from the drawn road an approach's ground is read, in metres: past
 * {@link APPROACH_REACH_METRES}, by as far as an embankment's foot reaches.
 */
const APPROACH_GROUND_REACH_METRES = APPROACH_REACH_METRES + EMBANKMENT_MAX_RUN_METRES;

/** The most steps one approach is. */
const APPROACH_STEPS = Math.ceil(APPROACH_METRES / APPROACH_STEP_METRES);

/**
 * The most triangles one overpass's road may be — #2699: {@link APPROACH_METRES}
 * a side at {@link APPROACH_STEP_METRES}, each step a quad of road, and the
 * deck's top. **162**.
 */
export const APPROACH_TRIANGLES_PER_OVERPASS = 2 + 2 * 2 * APPROACH_STEPS;

/**
 * The most triangles one overpass's embankment may be — #2699's third round:
 * each approach's every step a quad of bank each side. **320**.
 */
export const EMBANKMENT_TRIANGLES_PER_OVERPASS = 2 * 2 * 2 * APPROACH_STEPS;

/**
 * The most triangles a frame's overpass roads may add to the side roads' mesh
 * (`three-renderer.ts` §`SideRoadBelt`) — #2699: one road an overpass, and no
 * more overpasses than {@link OVERPASS_FRAME_PARTS} has room for. **4 338**.
 *
 * @test-facing held by `overpasses.test.ts`, which counts what the belt is
 * handed on a frame of overpasses; nothing in the product applies it at run time
 */
export const OVERPASS_ROAD_FRAME_TRIANGLES =
  Math.floor(OVERPASS_FRAME_PARTS / OVERPASS_BOXES) * APPROACH_TRIANGLES_PER_OVERPASS;

/**
 * The most triangles a frame's embankments may be, in the ground's second
 * mesh (`three-renderer.ts` §`TerrainBelt`) — #2699: one an overpass, as
 * {@link OVERPASS_ROAD_FRAME_TRIANGLES}. **2 880**.
 *
 * @test-facing held by `overpasses.test.ts`, which counts what the belt is
 * handed on a frame of overpasses; nothing in the product applies it at run time
 */
export const EMBANKMENT_FRAME_TRIANGLES =
  Math.floor(OVERPASS_FRAME_PARTS / OVERPASS_BOXES) * EMBANKMENT_TRIANGLES_PER_OVERPASS;

/** How far past the frame's corridor a crossing is still drawn, in metres: **40**. */
const IN_VIEW_REACH_METRES = 40;

/** How far either side of a crossing its heading is read, in metres: **8**. */
const HEADING_METRES = 8;

/** Where a mapped street crosses the route over or under it. */
export interface GradeCrossing {
  /** The route distance of the crossing, on the first lap. */
  readonly along: number;
  /** `'bridge'`: the street passes over the route. `'tunnel'`: under it. */
  readonly grade: 'bridge' | 'tunnel';
  readonly widthClass: WidthClass;
  /** Where its centreline crosses the drawn road's, local metres. */
  readonly x: number;
  readonly z: number;
  /** Its heading there in plan, a unit vector towards the road's right (its normal). */
  readonly dx: number;
  readonly dz: number;
  /**
   * The mapped street on from where it crosses — #2699: `[back, on]`, the
   * first along `−(dx, dz)` and the second along `(dx, dz)`, each
   * `x0, z0, x1, z1, …` from `(x, z)`, through the ways that meet it end to
   * end, as far as the land read and {@link APPROACH_READ_METRES} go. Empty
   * for a tunnel. @see the header
   */
  readonly approaches: readonly [Float32Array, Float32Array];
}

/** The road's frame at `along`: where, and its forward and normal directions. */
function roadAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  along: number,
): { x: number; z: number; forwardX: number; forwardZ: number; normalX: number; normalZ: number } {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) {
    return { x: 0, z: 0, forwardX: 0, forwardZ: 1, normalX: -1, normalZ: 0 };
  }
  // The heading is the normal turned back a quarter (`terrain.ts` §`drawnRoadFrame`).
  return {
    x: frame.x,
    z: frame.z,
    forwardX: frame.normalZ,
    forwardZ: -frame.normalX,
    normalX: frame.normalX,
    normalZ: frame.normalZ,
  };
}

/** The road's height at odometer `along`, local metres. */
function roadHeight(profile: RouteProfile, origin: CorridorOrigin, along: number): number {
  return elevationAt(profile, distanceOnRoute(profile, along)) - origin.elevation;
}

function metresOf(line: Float32Array): number {
  let total = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    total += Math.hypot(
      (line[at + 2] as number) - (line[at] as number),
      (line[at + 3] as number) - (line[at + 1] as number),
    );
  }
  return total;
}

/** A tunnel's approaches: none. */
const NO_APPROACHES: readonly [Float32Array, Float32Array] = [
  new Float32Array(0),
  new Float32Array(0),
];

/** Every street but a tunnel, by each end, to the metre: where one way meets the next. */
type Joins = ReadonlyMap<string, readonly StreetFeature[]>;

function joinKey(x: number, z: number): string {
  return `${String(Math.round(x))},${String(Math.round(z))}`;
}

function joinsOf(streets: readonly StreetFeature[]): Joins {
  const joins = new Map<string, StreetFeature[]>();
  for (const street of streets) {
    const line = street.line;
    if (street.grade === 'tunnel' || line.length < 4) continue;
    for (const at of [0, line.length - 2]) {
      const x = line[at] as number;
      const z = line[at + 1] as number;
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const key = joinKey(x, z);
      const known = joins.get(key);
      // A way with both ends in one cell is listed twice there, which costs a second look and no more.
      if (known === undefined) joins.set(key, [street]);
      else if (known.length < APPROACH_MAX_ENDS_PER_JOIN) known.push(street);
    }
  }
  return joins;
}

/**
 * The way that goes on from `(x, z)`, heading `(hx, hz)`: one not yet
 * followed with an end there, turning least and less than 60°. Its points are
 * read from `start`, in `step`.
 */
function joinedAt(
  joins: Joins,
  x: number,
  z: number,
  hx: number,
  hz: number,
  followed: ReadonlySet<StreetFeature>,
): { readonly street: StreetFeature; readonly start: number; readonly step: 1 | -1 } | undefined {
  let best: { street: StreetFeature; start: number; step: 1 | -1 } | undefined;
  let straightest = APPROACH_TURN_COSINE;
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      for (const street of joins.get(joinKey(x + i, z + j)) ?? []) {
        if (followed.has(street)) continue;
        const line = street.line;
        const last = line.length / 2 - 1;
        for (const [end, next, step] of [
          [0, 1, 1],
          [last, last - 1, -1],
        ] as const) {
          const ex = line[end * 2] as number;
          const ez = line[end * 2 + 1] as number;
          if (Math.hypot(ex - x, ez - z) > APPROACH_JOIN_METRES) continue;
          const ox = (line[next * 2] as number) - ex;
          const oz = (line[next * 2 + 1] as number) - ez;
          const length = Math.hypot(ox, oz);
          if (!(length > 0)) continue;
          const cosine = (ox * hx + oz * hz) / length;
          if (cosine > straightest) {
            straightest = cosine;
            best = { street, start: next, step };
          }
        }
      }
    }
  }
  return best;
}

/**
 * The mapped street on from a crossing at `(x, z)`, heading `(headingX,
 * headingZ)` — #2699: `points` from `start` in `step`, then each way that meets it end to end
 * ({@link joinedAt}), while the points are on the land read and until
 * {@link APPROACH_READ_METRES}. `x0, z0, …` from the crossing. @see GradeCrossing.approaches
 */
function mappedApproach(
  x: number,
  z: number,
  headingX: number,
  headingZ: number,
  points: readonly number[],
  start: number,
  step: 1 | -1,
  street: StreetFeature,
  corridor: WorldCorridor,
  joins: Joins,
): Float32Array {
  const out = [x, z];
  const followed = new Set([street]);
  let line: ArrayLike<number> = points;
  let cursor = start;
  let direction: 1 | -1 = step;
  let metres = 0;
  let px = x;
  let pz = z;
  let hx = headingX;
  let hz = headingZ;
  for (let ways = 0; ways < APPROACH_MAX_WAYS; ways += 1) {
    for (; cursor >= 0 && cursor * 2 + 1 < line.length; cursor += direction) {
      const qx = line[cursor * 2] as number;
      const qz = line[cursor * 2 + 1] as number;
      if (!Number.isFinite(qx) || !Number.isFinite(qz) || !corridor.covered(qx, qz)) {
        return Float32Array.from(out);
      }
      const length = Math.hypot(qx - px, qz - pz);
      if (!(length > 0)) continue;
      hx = (qx - px) / length;
      hz = (qz - pz) / length;
      out.push(qx, qz);
      metres += length;
      px = qx;
      pz = qz;
      if (metres >= APPROACH_READ_METRES) return Float32Array.from(out);
    }
    const next = joinedAt(joins, px, pz, hx, hz, followed);
    if (next === undefined) break;
    followed.add(next.street);
    line = next.street.line;
    cursor = next.start;
    direction = next.step;
  }
  return Float32Array.from(out);
}

/** One corridor's crossings, kept with the profile they were found against. */
const crossingsFound = new WeakMap<
  WorldCorridor,
  { profile: RouteProfile; crossings: readonly GradeCrossing[] }
>();

/**
 * Every place a mapped street crosses the route on a bridge or in a tunnel,
 * in route order — #2661. Built once per corridor, the same array after.
 * @see the header
 */
export function mappedGradeCrossings(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly GradeCrossing[] {
  const cached = crossingsFound.get(corridor);
  if (cached?.profile === profile) return cached.crossings;
  const found: GradeCrossing[] = [];
  const budget = { metres: STREET_MAX_METRES };
  const steepest = Math.cos((JUNCTION_MIN_ANGLE_DEGREES * Math.PI) / 180);
  // Built at the first overpass, and never on a corridor without one.
  let joins: Joins | undefined;
  for (const street of corridor.streets) {
    if (street.grade === 'ground') continue;
    if (street.grade === 'tunnel' && metresOf(street.line) > UNDERPASS_MAX_METRES) continue;
    const points = resampled(street.line, budget);
    const count = points.length / 2;
    const near: (NearestOnRoad | undefined)[] = [];
    for (let index = 0; index < count; index += 1) {
      const x = points[index * 2] as number;
      const z = points[index * 2 + 1] as number;
      near.push(
        corridor.covered(x, z)
          ? nearestOnDrawnRoad(profile, origin, x, z, JUNCTION_TOLERANCE_METRES)
          : undefined,
      );
    }
    for (let index = 0; index + 1 < count; index += 1) {
      const a = near[index];
      const b = near[index + 1];
      if (a === undefined || b === undefined) continue;
      // From one side to the other, of one stretch of the road.
      if (!(a.lateral * b.lateral < 0 || (a.lateral === 0 && b.lateral !== 0))) continue;
      if (Math.abs(a.along - b.along) > JUNCTION_TOLERANCE_METRES * 2) continue;
      const t = a.lateral / (a.lateral - b.lateral);
      const ax = points[index * 2] as number;
      const az = points[index * 2 + 1] as number;
      const x = ax + ((points[index * 2 + 2] as number) - ax) * t;
      const z = az + ((points[index * 2 + 3] as number) - az) * t;
      const along = a.along + (b.along - a.along) * t;
      // Its heading, over a few metres either side.
      const reach = Math.ceil(HEADING_METRES / 2);
      const from = Math.max(0, index - reach + 1);
      const to = Math.min(count - 1, index + reach);
      let dx = (points[to * 2] as number) - (points[from * 2] as number);
      let dz = (points[to * 2 + 1] as number) - (points[from * 2 + 1] as number);
      const length = Math.hypot(dx, dz);
      if (!(length > 0)) continue;
      dx /= length;
      dz /= length;
      const road = roadAt(profile, origin, along);
      if (Math.abs(dx * road.forwardX + dz * road.forwardZ) > steepest) continue;
      // Whether `(dx, dz)` runs the way the street's points do.
      const onward = dx * road.normalX + dz * road.normalZ >= 0;
      if (!onward) {
        dx = -dx;
        dz = -dz;
      }
      let approaches = NO_APPROACHES;
      if (street.grade === 'bridge') {
        joins ??= joinsOf(corridor.streets);
        // Up the points from `index + 1`, or down them from `index`.
        const ux = onward ? dx : -dx;
        const uz = onward ? dz : -dz;
        const up = mappedApproach(x, z, ux, uz, points, index + 1, 1, street, corridor, joins);
        const down = mappedApproach(x, z, -ux, -uz, points, index, -1, street, corridor, joins);
        approaches = onward ? [down, up] : [up, down];
      }
      found.push({
        along,
        grade: street.grade,
        widthClass: widthClassOf(street),
        x,
        z,
        dx,
        dz,
        approaches,
      });
    }
  }
  found.sort((p, q) => p.along - q.along);
  const crossings: GradeCrossing[] = [];
  for (const crossing of found) {
    if (crossings.length >= MAX_GRADE_CROSSINGS) break;
    const twin = crossings.some(
      (kept) =>
        kept.grade === crossing.grade &&
        Math.abs(kept.along - crossing.along) < CROSSING_MERGE_METRES,
    );
    if (!twin) crossings.push(crossing);
  }
  crossingsFound.set(corridor, { profile, crossings });
  return crossings;
}

/** A box `length` along `(axisX, 0, axisZ)`, level, in an overpass's `finish`. */
function levelBox(
  x: number,
  y: number,
  z: number,
  axisX: number,
  axisZ: number,
  length: number,
  width: number,
  height: number,
  finish: BridgeFinish,
): BridgePart {
  return { x, y, z, axisX, axisY: 0, axisZ, length, width, height, finish };
}

/** An overpass's boxes, and where its deck's top is: what its road is built on. */
interface OverpassBuilt {
  readonly parts: BridgePart[];
  /** The deck's top, local metres. */
  readonly deckTop: number;
  /** How far the deck runs either way from the crossing, along the street. */
  readonly halfSpan: number;
  /** How far from the route's centreline its abutments' backs are: what an embankment is cut off at. */
  readonly outer: number;
}

/** An overpass's boxes. @see the header */
function overpassBoxes(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): OverpassBuilt {
  const road = roadAt(profile, origin, crossing.along);
  const sine = crossing.dx * road.normalX + crossing.dz * road.normalZ;
  const cosine = crossing.dx * road.forwardX + crossing.dz * road.forwardZ;
  const deckWidth = SIDE_ROAD_WIDTHS[crossing.widthClass] + PARAPET_THICKNESS_METRES * 2;
  // The deck with its edge beams proud of it: what the span and the abutments cover.
  const overallWidth = deckWidth + OVERPASS_EDGE_PROUD_METRES * 2;
  const outer = ROAD_HALF_WIDTH_METRES + OVERPASS_SETBACK_METRES + ABUTMENT_THICKNESS_METRES;
  // Along the road, how far either way the deck's footprint reaches past the crossing.
  const skew = (outer * Math.abs(cosine)) / sine + overallWidth / 2 / sine;
  // Level, over the highest of the road it spans.
  let road0 = roadHeight(profile, origin, crossing.along);
  for (const end of [-1, 1]) {
    road0 = Math.max(road0, roadHeight(profile, origin, crossing.along + end * skew));
  }
  // The edge beams' feet: the lowest of the overpass.
  const clearance = road0 + OVERPASS_CLEARANCE_METRES;
  const underside = clearance + OVERPASS_EDGE_DROP_METRES;
  const deckTop = clearance + OVERPASS_DECK_DEPTH_METRES;
  // Along the street, long enough to cover both abutments however skew it crosses.
  const span = 2 * (outer / sine + ((overallWidth / 2) * Math.abs(cosine)) / sine);
  const parts: BridgePart[] = [
    levelBox(
      crossing.x,
      (underside + deckTop) / 2,
      crossing.z,
      crossing.dx,
      crossing.dz,
      span,
      deckWidth,
      deckTop - underside,
      'road',
    ),
  ];
  // An edge beam along each side of the deck: proud of it, under it, and the parapet above it.
  const acrossX = crossing.dz;
  const acrossZ = -crossing.dx;
  const beamTop = deckTop + PARAPET_HEIGHT_METRES;
  for (const side of [-1, 1]) {
    const out =
      (deckWidth / 2 - PARAPET_THICKNESS_METRES / 2 + OVERPASS_EDGE_PROUD_METRES / 2) * side;
    parts.push(
      levelBox(
        crossing.x + acrossX * out,
        (clearance + beamTop) / 2,
        crossing.z + acrossZ * out,
        crossing.dx,
        crossing.dz,
        span + OVERPASS_BEAM_OVERHANG_METRES * 2,
        PARAPET_THICKNESS_METRES + OVERPASS_EDGE_PROUD_METRES,
        beamTop - clearance,
        'concrete',
      ),
    );
  }
  // An abutment each side, parallel to the road, from under the ground to the
  // deck's top: along the road as far as the embankment behind it spreads.
  const abutmentTop = deckTop - ABUTMENT_TUCK_METRES;
  for (const side of [-1, 1]) {
    const lateral = side * (outer - ABUTMENT_THICKNESS_METRES / 2);
    const along = crossing.along + (lateral * cosine) / sine;
    const here = roadAt(profile, origin, along);
    const middle = terrainHeightAt(
      profile,
      origin,
      seed,
      distanceOnRoute(profile, along),
      lateral,
      land,
    );
    const spread = Math.min(
      EMBANKMENT_MAX_RUN_METRES,
      EMBANKMENT_RUN * Math.max(0, abutmentTop - middle),
    );
    const length = (overallWidth + 2 * spread) / sine;
    const grounds = [-0.5, 0, 0.5].map((end) =>
      terrainHeightAt(
        profile,
        origin,
        seed,
        distanceOnRoute(profile, along + end * length),
        lateral,
        land,
      ),
    );
    const foot = Math.min(...grounds) - ABUTMENT_FOOT_METRES;
    parts.push(
      levelBox(
        here.x + here.normalX * lateral,
        (abutmentTop + foot) / 2,
        here.z + here.normalZ * lateral,
        here.forwardX,
        here.forwardZ,
        length,
        ABUTMENT_THICKNESS_METRES,
        abutmentTop - foot,
        'concrete',
      ),
    );
  }
  return { parts, deckTop, halfSpan: span / 2, outer };
}

/** `0` at `0`, `1` at `1`, level at both ends: the smoothstep of `share`, clamped. */
function smooth(share: number): number {
  const s = Math.min(1, Math.max(0, share));
  return s * s * (3 - 2 * s);
}

/** Where one row across an overpass's road is: its middle, and how far past the deck's end. */
interface ApproachStation {
  readonly x: number;
  readonly z: number;
  /** Metres past the deck's end: `0` at it. */
  readonly past: number;
}

/**
 * The middles of one approach's rows — #2699: from the deck's end, every
 * {@link APPROACH_STEP_METRES} to {@link APPROACH_METRES}, moving off the
 * deck's line onto the mapped street's over {@link APPROACH_BLEND_METRES},
 * and carried on along the last heading it had where the street is no longer
 * mapped (`cross-streets.ts` §`stationAt`), or — #2699's third round — no
 * longer heads away from the route by {@link APPROACH_LEAVING_SHARE}: along the
 * deck's line itself where none of it is. It stops short of anywhere the road
 * would cover the main carriageway or its verge, or run into water, as a side
 * road does.
 */
function approachStations(
  crossing: GradeCrossing,
  side: -1 | 1,
  halfSpan: number,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): ApproachStation[] {
  const line = crossing.approaches[side < 0 ? 0 : 1];
  const half = SIDE_ROAD_WIDTHS[crossing.widthClass] / 2;
  const ways = waterways(profile, seed);
  const stations: ApproachStation[] = [];
  // The last row kept, how far it is from the route, and the heading it was reached on.
  let last: ApproachStation | undefined;
  let lastDistance = 0;
  let heading = { x: side * crossing.dx, z: side * crossing.dz };
  // Once the mapped street stops leaving the route: straight on from there.
  let straightOn: ApproachStation | undefined;
  for (let past = 0; ; past = Math.min(past + APPROACH_STEP_METRES, APPROACH_METRES)) {
    const metres = halfSpan + past;
    let x = crossing.x + side * crossing.dx * metres;
    let z = crossing.z + side * crossing.dz * metres;
    if (straightOn !== undefined) {
      x = straightOn.x + heading.x * (past - straightOn.past);
      z = straightOn.z + heading.z * (past - straightOn.past);
    } else if (line.length >= 4) {
      const mapped = stationAt(line, metres);
      const share = smooth(past / APPROACH_BLEND_METRES);
      x += (mapped.x - x) * share;
      z += (mapped.z - z) * share;
    }
    let near = nearestOnDrawnRoad(profile, origin, x, z, APPROACH_GROUND_REACH_METRES);
    if (last !== undefined && straightOn === undefined && near !== undefined) {
      const step = Math.hypot(x - last.x, z - last.z);
      if (step > 0 && near.distance - lastDistance < step * APPROACH_LEAVING_SHARE) {
        // Running beside the route, or back towards it: not followed.
        straightOn = last;
        x = last.x + heading.x * (past - last.past);
        z = last.z + heading.z * (past - last.past);
        near = nearestOnDrawnRoad(profile, origin, x, z, APPROACH_GROUND_REACH_METRES);
      } else if (step > 0) {
        heading = { x: (x - last.x) / step, z: (z - last.z) / step };
      }
    }
    if (past > 0) {
      if (near === undefined || near.distance > APPROACH_REACH_METRES) break;
      if (near.distance < ROAD_HALF_WIDTH_METRES + VERGE_METRES + half) break;
      if (inWater(ways, profile, near.along, near.lateral)) break;
    }
    const station = { x, z, past };
    stations.push(station);
    last = station;
    lastDistance = near?.distance ?? 0;
    if (past >= APPROACH_METRES) break;
  }
  return stations;
}

/** The ground under a point, local metres, and where on the drawn road it is nearest. */
interface GroundRead {
  readonly height: number;
  readonly near: NearestOnRoad;
}

/** The ground under `(x, z)`, or `undefined` where it is not read. */
function groundBeneath(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  x: number,
  z: number,
): GroundRead | undefined {
  const near = nearestOnDrawnRoad(profile, origin, x, z, APPROACH_GROUND_REACH_METRES);
  return near === undefined
    ? undefined
    : { height: terrainHeightAt(profile, origin, seed, near.along, near.lateral, land), near };
}

/**
 * How high one approach's ramp is at `past` metres past the deck's end,
 * before the ground — #2699's third round: ONE straight line down from the
 * deck's top, at {@link APPROACH_GRADE} or steeper, steep enough to be at the
 * ground under the row where the approach's fade begins (or halfway along
 * a short one). The road stands on the higher of it and the ground, so it never
 * climbs above the deck, and where the ground rises to meet it, it lands there.
 *
 * ⚠️ **Why one line, and measured where it must land.** The second round's
 * ramp stopped at the first row whose ground came within 6 % of the deck, and
 * held 6 % from there on: wherever the ground fell away again past that row,
 * and wherever the street ran beside the route and so never left the view,
 * the road stayed up — 6 % brings a 6 m deck down in 100 m, most of the view.
 */
function rampOf(
  stations: readonly ApproachStation[],
  length: number,
  deckTop: number,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): (past: number) => number {
  const top = deckTop + SIDE_ROAD_LIFT_METRES;
  const latest = Math.max(length - APPROACH_FADE_METRES, length / 2);
  const groundAt = (station: ApproachStation): number =>
    (groundBeneath(profile, origin, seed, land, station.x, station.z)?.height ?? top) +
    APPROACH_GROUND_LIFT_METRES;
  // The ground where the ramp must have landed, between the rows either side.
  let landing = top;
  for (let index = 1; index < stations.length; index += 1) {
    const to = stations[index] as ApproachStation;
    if (to.past < latest) continue;
    const from = stations[index - 1] as ApproachStation;
    const lower = groundAt(from);
    const share = to.past > from.past ? (latest - from.past) / (to.past - from.past) : 0;
    landing = lower + (groundAt(to) - lower) * share;
    break;
  }
  const slope = latest > 0 ? Math.max(APPROACH_GRADE, (top - landing) / latest) : APPROACH_GRADE;
  return (past) => top - slope * past;
}

/** One road edge of one row: where it is, and where the embankment under it meets the ground. */
interface RoadEdge {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The road edge's own place on the drawn road, for the ground's fields. */
  readonly along: number;
  readonly lateral: number;
  /** How far the road edge stands above the ground under it. */
  readonly lift: number;
  /** The embankment's foot. @see toeOf */
  readonly toe: EmbankmentToe;
}

/** One row across an overpass's road, as built. */
interface RoadRow {
  /** Its two road vertices, left and right. */
  readonly l: number;
  readonly r: number;
  readonly edges: readonly [RoadEdge, RoadEdge];
}

/** Where an embankment's slope from one road edge meets the ground. */
interface EmbankmentToe {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly along: number;
  readonly lateral: number;
  /** How far out from the road's edge it is, before any cut. */
  readonly run: number;
}

/**
 * The foot of the embankment under a road edge at `(x, y, z)`, out along
 * `(ox, oz)` — #2699's third round: down at {@link EMBANKMENT_RUN} : 1 to
 * {@link EMBANKMENT_FOOT_METRES} under the ground, moved out to where the
 * slope meets the ground there {@link EMBANKMENT_FOOT_STEPS} times. ⚠️ Cut
 * off where it would come nearer the route than `outer` — the abutments'
 * backs, {@link OVERPASS_CLEAR_VERGE_METRES} off the carriageway's edge — at
 * that line, where the abutment retains it.
 */
function toeOf(
  edge: { readonly x: number; readonly y: number; readonly z: number; readonly ground: GroundRead },
  ox: number,
  oz: number,
  outer: number,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): EmbankmentToe {
  let ground = edge.ground;
  let run = 0;
  for (let step = 0; step < EMBANKMENT_FOOT_STEPS; step += 1) {
    run = Math.min(
      EMBANKMENT_MAX_RUN_METRES,
      EMBANKMENT_RUN * Math.max(0, edge.y - ground.height + EMBANKMENT_FOOT_METRES),
    );
    ground =
      groundBeneath(profile, origin, seed, land, edge.x + ox * run, edge.z + oz * run) ?? ground;
  }
  let share = 1;
  // Signed to the road edge's side, so a foot that would reach across the
  // route is cut where it comes to the line, not where it is as far off it.
  const side = Math.sign(edge.ground.near.lateral) || 1;
  const from = edge.ground.near.lateral * side;
  const to = ground.near.lateral * side;
  if (to < outer && run > 0) {
    share = from > to ? Math.max(0, Math.min(1, (from - outer) / (from - to))) : 0;
  }
  const cut = run * share;
  // Where it is not cut, the foot is under the ground it was last moved to,
  // however that ground lies: a few centimetres down, never a lip in the air.
  const slope = edge.y - cut / EMBANKMENT_RUN;
  return {
    x: edge.x + ox * cut,
    y: share < 1 ? slope : Math.min(slope, ground.height - EMBANKMENT_FOOT_METRES),
    z: edge.z + oz * cut,
    along: edge.ground.near.along + (ground.near.along - edge.ground.near.along) * share,
    lateral: edge.ground.near.lateral + (ground.near.lateral - edge.ground.near.lateral) * share,
    run,
  };
}

/** One overpass's embankment: what `three-renderer.ts` §`TerrainBelt` draws in the ground's material. */
export interface Embankment {
  readonly positions: Float32Array;
  /** One for each face, so each is lit as the slope it is. */
  readonly normals: Float32Array;
  /** Linear, untinted: the ground's material carries the colour. */
  readonly colours: Float32Array;
  /** The ground's own (`landform.ts` §`TerrainMesh.fields`): route distance and signed lateral, for its patchwork. */
  readonly fields: Float32Array;
  readonly indices: Uint32Array;
}

/** An overpass's road and its embankment. */
interface OverpassRoad {
  readonly road: SideRoad;
  readonly embankment: Embankment;
}

/**
 * An overpass's road — #2699: one strip along the street from the far end of
 * one approach, over the deck's top, to the far end of the other, in the
 * side roads' mesh (`cross-streets.ts` §`SideRoadMesh`), so it wears the
 * main road's own material and nothing scattered stands on it; and since the
 * third round its embankment, in the ground's. @see the header
 */
function overpassRoad(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  deck: OverpassBuilt,
): OverpassRoad {
  const half = SIDE_ROAD_WIDTHS[crossing.widthClass] / 2;
  const back = approachStations(crossing, -1, deck.halfSpan, profile, origin, seed);
  const on = approachStations(crossing, 1, deck.halfSpan, profile, origin, seed);
  const lengths = [back[back.length - 1]?.past ?? 0, on[on.length - 1]?.past ?? 0] as const;
  const ramps = [
    rampOf(back, lengths[0], deck.deckTop, profile, origin, seed, land),
    rampOf(on, lengths[1], deck.deckTop, profile, origin, seed, land),
  ] as const;
  // One strip, from the back approach's far end to the other's: heading `(dx, dz)` over the deck.
  const strip = [
    ...back.map((station) => ({ ...station, side: 0 as const })).reverse(),
    ...on.map((station) => ({ ...station, side: 1 as const })),
  ];
  const positions: number[] = [];
  const colours: number[] = [];
  const across: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, a: number): number => {
    positions.push(x, y, z);
    colours.push(TARMAC[0], TARMAC[1], TARMAC[2]);
    across.push(a);
    return positions.length / 3 - 1;
  };
  const rows: RoadRow[] = [];
  for (let index = 0; index < strip.length; index += 1) {
    const station = strip[index] as (typeof strip)[number];
    // Along the strip here: the deck's heading at its ends, else between the rows either side.
    let hx = crossing.dx;
    let hz = crossing.dz;
    if (station.past > 0) {
      const before = strip[Math.max(0, index - 1)] as ApproachStation;
      const after = strip[Math.min(strip.length - 1, index + 1)] as ApproachStation;
      const length = Math.hypot(after.x - before.x, after.z - before.z);
      if (length > 0) {
        hx = (after.x - before.x) / length;
        hz = (after.z - before.z) / length;
      }
    }
    const length = lengths[station.side];
    const fadeMetres = Math.min(APPROACH_FADE_METRES, length);
    const fade = fadeMetres > 0 ? smooth((station.past - (length - fadeMetres)) / fadeMetres) : 0;
    const halfHere = half * (1 - (1 - SIDE_ROAD_END_WIDTH_SHARE) * fade);
    // Down from the deck's top to the ground, and never under the ground.
    const ramp = ramps[station.side](station.past);
    const edge = (sign: -1 | 1): RoadEdge => {
      const x = station.x + hz * halfHere * sign;
      const z = station.z - hx * halfHere * sign;
      const read = groundBeneath(profile, origin, seed, land, x, z);
      const ground = read?.height ?? ramp;
      const standing = Math.max(ramp, ground + APPROACH_GROUND_LIFT_METRES);
      const y = standing + (ground - SIDE_ROAD_SINK_METRES - standing) * fade;
      const at = read ?? { height: y, near: { distance: 0, along: crossing.along, lateral: 0 } };
      return {
        x,
        y,
        z,
        along: at.near.along,
        lateral: at.near.lateral,
        lift: y - ground,
        toe: toeOf(
          { x, y, z, ground: at },
          hz * sign,
          -hx * sign,
          deck.outer,
          profile,
          origin,
          seed,
          land,
        ),
      };
    };
    const left = edge(-1);
    const right = edge(1);
    rows.push({
      l: vertex(left.x, left.y, left.z, -halfHere),
      r: vertex(right.x, right.y, right.z, halfHere),
      edges: [left, right],
    });
  }
  const segments: number[] = [];
  const halfWidths: number[] = [];
  const bank = {
    positions: [] as number[],
    normals: [] as number[],
    colours: [] as number[],
    fields: [] as number[],
    indices: [] as number[],
  };
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const a = rows[index] as RoadRow;
    const b = rows[index + 1] as RoadRow;
    indices.push(a.l, b.l, b.r, a.l, b.r, a.r);
    const from = strip[index] as ApproachStation;
    const to = strip[index + 1] as ApproachStation;
    // The deck's top: over the main road, which nothing scattered stands on anyway.
    if (from.past === 0 && to.past === 0) continue;
    segments.push(from.x, from.z, to.x, to.z);
    // The scenery kept off the embankment's foot as well as the road.
    let reach = 0;
    for (const row of [a, b]) for (const each of row.edges) reach = Math.max(reach, each.toe.run);
    halfWidths.push(half + reach);
    // A bank down each side, wherever the road stands above the ground.
    for (const side of [0, 1] as const) {
      const ea = a.edges[side];
      const eb = b.edges[side];
      if (Math.max(ea.lift, eb.lift) <= EMBANKMENT_LEAST_METRES) continue;
      embankmentQuad(bank, ea, eb);
    }
  }
  return {
    road: {
      junction: { along: crossing.along, source: 'mapped', arms: [] },
      mesh: {
        positions: Float32Array.from(positions),
        colours: Float32Array.from(colours),
        across: Float32Array.from(across),
        indices: Uint32Array.from(indices),
      },
      segments: Float32Array.from(segments),
      halfWidths: Float32Array.from(halfWidths),
    },
    embankment: {
      positions: Float32Array.from(bank.positions),
      normals: Float32Array.from(bank.normals),
      colours: Float32Array.from(bank.colours),
      fields: Float32Array.from(bank.fields),
      indices: Uint32Array.from(bank.indices),
    },
  };
}

/**
 * One step of one side's bank, from the road's edge at two rows to the
 * embankment's foot under each: two triangles, each with three vertices of
 * its own carrying its face's normal — up and out, never down — and wound to
 * face it, so three draws its front.
 */
function embankmentQuad(
  bank: {
    positions: number[];
    normals: number[];
    colours: number[];
    fields: number[];
    indices: number[];
  },
  a: RoadEdge,
  b: RoadEdge,
): void {
  const corners = [
    [a.x, a.y, a.z, a.along, a.lateral],
    [b.x, b.y, b.z, b.along, b.lateral],
    [b.toe.x, b.toe.y, b.toe.z, b.toe.along, b.toe.lateral],
    [a.toe.x, a.toe.y, a.toe.z, a.toe.along, a.toe.lateral],
  ] as const;
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 2, 3],
  ] as const) {
    let p = corners[i];
    let q = corners[j];
    const r = corners[k];
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const uz = q[2] - p[2];
    const vx = r[0] - p[0];
    const vy = r[1] - p[1];
    const vz = r[2] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // A foot cut back onto the road's edge leaves no face.
    if (!(length > 1e-6)) continue;
    if (ny < 0) {
      // Wound the other way, so the face three draws is the upper one.
      [p, q] = [q, p];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const corner of [p, q, r]) {
      bank.indices.push(bank.positions.length / 3);
      bank.positions.push(corner[0], corner[1], corner[2]);
      bank.normals.push(nx / length, ny / length, nz / length);
      bank.colours.push(EARTH[0], EARTH[1], EARTH[2]);
      bank.fields.push(corner[3], corner[4]);
    }
  }
}

/** An underpass's boxes: the stream bridge's parapets and copings, over the street. @see the header */
function underpassBoxes(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
): BridgePart[] {
  const road = roadAt(profile, origin, crossing.along);
  const sine = crossing.dx * road.normalX + crossing.dz * road.normalZ;
  const half = SIDE_ROAD_WIDTHS[crossing.widthClass] / 2 / sine + UNDERPASS_MARGIN_METRES;
  const pieces = Math.ceil((half * 2) / BRIDGE_PIECE_METRES);
  const step = (half * 2) / pieces;
  const parts: BridgePart[] = [];
  const at = (along: number): { x: number; y: number; z: number } => {
    const frame = roadAt(profile, origin, along);
    return { x: frame.x, y: roadHeight(profile, origin, along), z: frame.z };
  };
  for (let piece = 0; piece < pieces; piece += 1) {
    const from = at(crossing.along - half + piece * step);
    const to = at(crossing.along - half + (piece + 1) * step);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    const flat = Math.hypot(dx, dz);
    if (!(flat > 0)) continue;
    const nx = -dz / flat;
    const nz = dx / flat;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    for (const side of [1, -1]) {
      const out = ROAD_HALF_WIDTH_METRES + PARAPET_THICKNESS_METRES / 2;
      parts.push({
        x: mid.x + nx * out * side,
        y: mid.y + PARAPET_HEIGHT_METRES / 2 - 0.05,
        z: mid.z + nz * out * side,
        axisX: dx / length,
        axisY: dy / length,
        axisZ: dz / length,
        length,
        width: PARAPET_THICKNESS_METRES,
        height: PARAPET_HEIGHT_METRES + 0.1,
      });
      const coping = out + COPING_OVERHANG_METRES / 2;
      parts.push({
        x: mid.x + nx * coping * side,
        y: mid.y + PARAPET_HEIGHT_METRES - COPING_DEPTH_METRES / 2,
        z: mid.z + nz * coping * side,
        axisX: dx / length,
        axisY: dy / length,
        axisZ: dz / length,
        length,
        width: PARAPET_THICKNESS_METRES + COPING_OVERHANG_METRES,
        height: COPING_DEPTH_METRES,
      });
    }
  }
  return parts;
}

/** One crossing as it is drawn: its boxes, and an overpass's road and embankment. */
interface CrossingBuilt {
  readonly parts: readonly BridgePart[];
  readonly road: OverpassRoad | undefined;
}

/**
 * Every crossing's boxes and road, built on first sight — per land-class
 * mask, since #1547 levels the ground an abutment and an approach stand on
 * under mapped built-up land.
 */
const built = new WeakMap<LandClassMask, WeakMap<GradeCrossing, CrossingBuilt>>();

/**
 * One crossing, built once per land-class mask: an overpass's deck, edge
 * beams, abutments and road, or an underpass's parapets. @see the header
 */
function crossingBuilt(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): CrossingBuilt {
  let byCrossing = built.get(land);
  if (byCrossing === undefined) {
    byCrossing = new WeakMap();
    built.set(land, byCrossing);
  }
  const known = byCrossing.get(crossing);
  if (known !== undefined) return known;
  let made: CrossingBuilt;
  if (crossing.grade === 'bridge') {
    const deck = overpassBoxes(crossing, profile, origin, seed, land);
    made = { parts: deck.parts, road: overpassRoad(crossing, profile, origin, seed, land, deck) };
  } else {
    made = { parts: underpassBoxes(crossing, profile, origin), road: undefined };
  }
  byCrossing.set(crossing, made);
  return made;
}

/** What a frame draws of the crossings in view — #2699. @see gradeCrossingsAt */
export interface CrossingsInView {
  /** Their boxes, for the frame's bridges (`scene.ts` §`water`). */
  readonly parts: readonly BridgePart[];
  /** Each overpass's road, for the frame's side roads (`SceneFrame.sideRoads`). */
  readonly roads: readonly SideRoad[];
  /** Each overpass's embankment, for the frame's ground (`TerrainFrame.embankments`), in the roads' order. */
  readonly embankments: readonly Embankment[];
}

/** No crossing in view. */
export const NO_CROSSINGS_IN_VIEW: CrossingsInView = { parts: [], roads: [], embankments: [] };

/**
 * Every crossing within the odometer span `[fromMetres, toMetres)`, widened a
 * little — nearest `riderMetres` first, each once however many laps the span
 * covers, whole crossings only, and no more boxes than `room` or
 * {@link OVERPASS_FRAME_PARTS}: their boxes, and each overpass's road and
 * embankment, the same objects every call. @see the header
 */
export function gradeCrossingsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  riderMetres: number,
  crossings: readonly GradeCrossing[],
  land: LandClassMask,
  room: number = OVERPASS_FRAME_PARTS,
): CrossingsInView {
  if (crossings.length === 0) return NO_CROSSINGS_IN_VIEW;
  const from = fromMetres - IN_VIEW_REACH_METRES;
  const to = toMetres + IN_VIEW_REACH_METRES;
  const total: number = profile.totalDistance;
  const firstLap = profile.loop && total > 0 ? Math.floor(from / total) : 0;
  const lastLap = profile.loop && total > 0 ? Math.floor(to / total) : 0;
  const found: { crossing: GradeCrossing; at: number; gap: number }[] = [];
  for (const crossing of crossings) {
    for (let lap = firstLap; lap <= lastLap; lap += 1) {
      const at = crossing.along + lap * total;
      if (at >= from && at < to) {
        found.push({ crossing, at, gap: Math.abs(at - riderMetres) });
        break;
      }
    }
  }
  found.sort((a, b) => a.gap - b.gap);
  const most = Math.min(room, OVERPASS_FRAME_PARTS);
  const parts: BridgePart[] = [];
  const roads: { road: OverpassRoad; at: number }[] = [];
  for (const { crossing, at } of found) {
    const drawn = crossingBuilt(crossing, profile, origin, seed, land);
    if (parts.length + drawn.parts.length > most) break;
    parts.push(...drawn.parts);
    if (drawn.road !== undefined) roads.push({ road: drawn.road, at });
  }
  // Along the odometer, not nearest first: the belts rebuild when the order of
  // their roads changes, and nearest-first flips as the rider passes a midpoint.
  roads.sort((a, b) => a.at - b.at);
  return parts.length === 0
    ? NO_CROSSINGS_IN_VIEW
    : {
        parts,
        roads: roads.map((entry) => entry.road.road),
        embankments: roads.map((entry) => entry.road.embankment),
      };
}
