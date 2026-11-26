// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parked cars — #3278: the cars standing on a mapped house's driveway, on a
 * shop's apron and at the kerb of a mapped side street, on an ordinary ride.
 * Until #3278 the three bodies of `realistic-assets.ts`
 * §`REALISTIC_DELIVERY_CAR` were drawn only as a Delivery round's obstacles,
 * so a route ride or an open-world ride passed houses with driveways and
 * shops with aprons and not one vehicle.
 *
 * ⚠️ **Scenery, never an obstacle.** Nothing here is read by a simulation, a
 * score or the trainer: a car is a place, a heading and a look, handed to the
 * view (`port.ts` §`SceneFrame.parkedCars`). A Delivery round's parked cars
 * are `delivery/obstacles.ts`' own and are placed by its rules, not these; a
 * frame of a round carries none of these (`scene.ts` §`SceneInput.parkedCars`).
 *
 * ## Where a car stands — from what is already planned, and no new map data
 *
 * - **`driveway`**: on a mapped house's garage driveway (`footprint-buildings.ts`
 *   §`FootprintPlan.driveway`, #1588), in {@link PARKED_CAR_SHARES}'
 *   `driveway` of them: on the driveway's own middle line,
 *   {@link PARKED_CAR_GARAGE_GAP_METRES} out from the garage door, nose in or
 *   nose out by its hash. A driveway too short or too narrow for the car's
 *   box has none.
 * - **`apron`**: on a shop's apron (`shop-aprons.ts`, #2848), parallel to the
 *   shop front, in a row along it: its outer side
 *   {@link PARKED_CAR_APRON_KERB_METRES} in from the apron's kerb line and its
 *   inner side at least {@link PARKED_CAR_APRON_DOOR_METRES} off the wall, so
 *   only an apron deep enough for both has a car on it.
 * - **`kerb`**: at the kerb of a mapped `minor` or `major` side street
 *   (`nearby-streets.ts`, #2973) that has a mapped building within
 *   {@link PARKED_CAR_KERB_HOUSE_METRES}: parallel to the street, its outer
 *   side {@link PARKED_CAR_KERB_GAP_METRES} inside the street's edge, facing
 *   the way that side of the street runs, in slots
 *   {@link PARKED_CAR_KERB_SLOT_METRES} apart and never within
 *   {@link PARKED_CAR_KERB_END_METRES} of either end of its piece — a piece
 *   ends at a junction, a gap or the next piece, and the rule does not ask
 *   which. A minor street has cars along one side only (two rows would leave
 *   under two metres between them), a major one along both.
 *
 * ## ⚠️ What the issue asked for and this does not place, and why
 *
 * - **No car at the kerb of the RIDDEN road** — the village's and the city
 *   centre's street of `streets.ts`. The carriageway is 7 m and the rider's:
 *   three lanes at −1.75, 0 and +1.75 m (`lanes.ts`) and a racing line that
 *   may reach 2.9 m (`racing-line.ts`) leave 0.4 m inside each kerb, and a
 *   car is 2 m across its mirrors. A kerb car there stands in a ridden lane,
 *   which the issue's own "never in the rider's way" rules out. So a
 *   procedural village, whose only street is the ridden road and which has
 *   no mapped driveway, has no car — and its frame, frozen at
 *   `realistic-budget.ts` §`REALISTIC_VILLAGE_DRAW_CALLS`, is not touched.
 * - **None on or beside a `service` road** — a mapped driveway or a parking
 *   aisle. The tiles give a driveway, a parking aisle and an alley the one
 *   `kind_detail`, `service` (ADR 0091 D-3), so a rule that parked along one
 *   would block the alleys too.
 * - **None at a kerb on an open-world ride** ({@link ParkedCarSite.kerbs}
 *   false): every street there may be the next one ridden, so a car at its
 *   kerb would be in a lane the moment the rider turned onto it. There a car
 *   also keeps {@link PARKED_CAR_ROAD_CLEAR_METRES} off the middle of every
 *   street the rider may turn onto, as off the ridden road, so a turn never
 *   takes a car away.
 *
 * ## Never in the rider's way
 *
 * A car's whole box ({@link PARKED_CAR_BOX}) stands at least
 * {@link PARKED_CAR_ROAD_CLEAR_METRES} from the middle of ANY stretch of the
 * ridden road ({@link ParkedCarSite.road}): the carriageway's half-width and
 * a metre of verge. The site may answer a nearer distance than the true one
 * where a pavement is laid there (`scene.ts` hands a city centre's), so a car
 * stands behind it. And it stands clear of:
 *
 * - every mapped building's footprint, by {@link PARKED_CAR_WALL_METRES};
 * - every other street's surface — a side road's mouth, a crossing street, a
 *   junction's stub — by {@link PARKED_CAR_STREET_MARGIN_METRES} off its edge,
 *   read off the map's own lines ({@link ParkedCarSite.streets}) and not off
 *   the roads one frame draws, so a car does not come and go with them;
 * - every mapped footway's line, a crossing's included, by
 *   {@link PARKED_CAR_FOOTWAY_METRES}, so nobody walks through one;
 * - water and ground that is not drawn ({@link ParkedCarSite.ground});
 * - every other car, by {@link PARKED_CAR_GAP_METRES}: of two that would
 *   meet, the one on a driveway is kept before one on an apron and one at a
 *   kerb, and otherwise the one with the lower hash.
 *
 * ## The same street on every ride
 *
 * Whether a place has a car, which way it faces, its body and its paint are
 * hashed from the ride's seed and the place itself (its coordinates, in
 * centimetres), never from the frame, the camera or the order anything was
 * found in. Whether a car is KEPT is decided from what stands within
 * {@link PARKED_CAR_NEIGHBOUR_METRES} of it alone, so the cars in reach of
 * one place are exactly those in reach of the next that are still in reach:
 * a car never appears or goes as the rider moves except at the edge of
 * {@link PARKED_CAR_FAR_METRES}.
 *
 * ## Cost
 *
 * {@link parkedCarsAt} is asked once per {@link PARKED_CAR_CELL_METRES} cell
 * the place asked about enters (`scene.ts` asks about the road
 * {@link PARKED_CAR_AHEAD_METRES} ahead of the rider, and keeps the last
 * answer), never per frame. It
 * names the {@link PARKED_CARS_MAX} cars nearest the cell's middle, the
 * nearest {@link PARKED_CARS_NEAR_MAX} of those within
 * {@link PARKED_CAR_NEAR_METRES} at the `near` level — the body and its four
 * wheels — and the rest at `far`, the body alone. `three-renderer.ts`
 * §`ParkedCarBelt` draws them in ONE call of its own, each car submitting its
 * own body's triangles and no other's, inside `realistic-budget.ts`
 * §`REALISTIC_PARKED_CAR_TRIANGLES`.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. A car's
 * hash is taken from local metres, which never leave the frame.
 *
 * Pure, and names no rendering library.
 */

import type { PathFeature, StreetFeature } from '@onyourleft/map-features';

import { SIDE_ROAD_WIDTHS, widthClassOf } from './cross-streets';
import { isFootway } from './footways';
import type { FootprintPlan } from './footprint-buildings';
import type { NearbyStreetPiece } from './nearby-streets';
import { fmix32, mixInto, uniformFrom } from './seeded';
import { ROAD_WIDTH_METRES } from './terrain';

/** Where a parked car stands. @see the header */
export type ParkedCarSpot = 'driveway' | 'apron' | 'kerb';

/** Which of a car's two levels of detail it is drawn at: its body and wheels, or its body alone. */
export type ParkedCarLevel = 'near' | 'far';

/**
 * A parked car's box in plan, in metres: **2.25** from its middle to either
 * end and **1** to either side — the longest of the three bodies is 4.4 m and
 * the widest 1.98 m across its mirrors (`realistic-assets.ts`
 * §`REALISTIC_DELIVERY_CAR`, held by `parked-car-belt.test.ts`), so every
 * body stands inside it.
 */
export const PARKED_CAR_BOX = { halfLength: 2.25, halfWidth: 1 } as const;

/**
 * How far from the middle of the ridden road no part of a car's box stands,
 * in metres: **4.5** — the carriageway's half-width (`terrain.ts`
 * §`ROAD_WIDTH_METRES` / 2, kerb to kerb: every lane and the racing line's
 * whole reach are inside it) and a metre of verge.
 */
export const PARKED_CAR_ROAD_CLEAR_METRES = ROAD_WIDTH_METRES / 2 + 1;

/** How far out from its garage door a driveway's car stands, in metres: **0.6**. */
export const PARKED_CAR_GARAGE_GAP_METRES = 0.6;

/** How far in from an apron's kerb line a car's outer side stands, in metres: **1**. */
export const PARKED_CAR_APRON_KERB_METRES = 1;

/** How far off a shop's wall a car's inner side stands at least, in metres: **1.5** — a doorway's room. */
export const PARKED_CAR_APRON_DOOR_METRES = 1.5;

/** How far inside its street's edge a kerb car's outer side stands, in metres: **0.2**. */
export const PARKED_CAR_KERB_GAP_METRES = 0.2;

/** How far apart a street's kerb slots are, middle to middle, in metres: **6** — a car and 1.5 m. */
export const PARKED_CAR_KERB_SLOT_METRES = 6;

/** How near either end of its street's piece no kerb car's middle stands, in metres: **10**. */
export const PARKED_CAR_KERB_END_METRES = 10;

/** How near a mapped building a kerb car's street must come for it to stand there, in metres: **35**. */
export const PARKED_CAR_KERB_HOUSE_METRES = 35;

/** How far off a mapped building's footprint a car's box keeps, in metres: **0.3**. */
export const PARKED_CAR_WALL_METRES = 0.3;

/** How far off another street's edge a car's box keeps, in metres: **0.3**. */
export const PARKED_CAR_STREET_MARGIN_METRES = 0.3;

/** How far off a mapped footway's line a car's box keeps, in metres: **0.6** — half a footway and a hand. */
export const PARKED_CAR_FOOTWAY_METRES = 0.6;

/** How far apart two cars' boxes keep, in metres: **0.4**. */
export const PARKED_CAR_GAP_METRES = 0.4;

/**
 * The share of places of each kind that have a car: **0.6** of garage
 * driveways, **0.4** of an apron's slots and **0.3** of a street's kerb slots.
 */
export const PARKED_CAR_SHARES: Readonly<Record<ParkedCarSpot, number>> = {
  driveway: 0.6,
  apron: 0.4,
  kerb: 0.3,
};

/** The share of driveway cars parked nose in, toward the garage: **0.65**. */
export const PARKED_CAR_NOSE_IN_SHARE = 0.65;

/**
 * How far ahead of the rider along the road the place the cars are chosen
 * about is, in metres: **40** — so the reach is spent on what is in front of
 * the camera: from 110 m behind the rider to 190 m ahead, with their wheels
 * from 20 m behind to 100 m ahead.
 */
export const PARKED_CAR_AHEAD_METRES = 40;

/** Within this of the cell asked about a car is drawn with its wheels, in metres: **60**. */
export const PARKED_CAR_NEAR_METRES = 60;

/**
 * Beyond this of the cell asked about no car is drawn, in metres: **150** —
 * `realistic-budget.ts` §`MAPPED_BUILDING_NEAR_METRES`, where a mapped
 * building's driveway and apron stop being drawn too.
 */
export const PARKED_CAR_FAR_METRES = 150;

/** The most cars a frame draws with their wheels: **12**. */
export const PARKED_CARS_NEAR_MAX = 12;

/** The most cars a frame draws, at either level: **36**. */
export const PARKED_CARS_MAX = 36;

/** The side of the cell the cars in reach are chosen for, in metres: **16**. */
export const PARKED_CAR_CELL_METRES = 16;

/**
 * How far round a car what may stand in its way is looked for, in metres:
 * **8** — two boxes' diagonals and {@link PARKED_CAR_GAP_METRES}, rounded up.
 */
export const PARKED_CAR_NEIGHBOUR_METRES = 8;

/** One parked car, in the corridor's local metres. */
export interface ParkedCar {
  readonly x: number;
  /** The drawn ground under its middle. */
  readonly y: number;
  readonly z: number;
  /** three's yaw: its nose points along `(sin heading, cos heading)` in `x, z`. */
  readonly heading: number;
  /** How far its nose is tipped up the ground it stands on, radians. */
  readonly pitch: number;
  readonly spot: ParkedCarSpot;
  readonly level: ParkedCarLevel;
  /** Its hash: which body and which paint it is. @see parkedCarBody, parkedCarPaint */
  readonly look: number;
}

/** The parked cars a frame carries, nearest the middle of the cell asked about first. */
export interface ParkedCarsInView {
  readonly cars: readonly ParkedCar[];
}

/** No parked car: a ride with no mapped building and no mapped street. */
export const NO_PARKED_CARS: ParkedCarsInView = Object.freeze({ cars: Object.freeze([]) });

/** What of a mapped building's plan a car is placed from, and kept off. */
export type ParkedCarPlot = Pick<
  FootprintPlan,
  'centroid' | 'footprint' | 'garage' | 'driveway' | 'apron'
>;

/** What the cars of a ride are placed among. */
export interface ParkedCarSite {
  /** The ride's seed. */
  readonly seed: number;
  /** The mapped buildings planned, and each one's reach about its centroid (`mapped-buildings.ts`). */
  readonly plots: readonly ParkedCarPlot[];
  readonly radii: ArrayLike<number>;
  /**
   * The mapped streets off the route as they are drawn
   * (`nearby-streets.ts` §`NearbyStreets.pieces`): where a kerb car stands.
   */
  readonly pieces: readonly NearbyStreetPiece[];
  /**
   * Every mapped street of the corridor (`WorldCorridor.streets`), the route's
   * own and the stretch of each a junction's stub is drawn over included:
   * what a car is kept off. The map's lines and not a frame's side roads, so
   * a car's place does not depend on which roads the frame it is asked in draws.
   */
  readonly streets: readonly StreetFeature[];
  /** The corridor's mapped footways (`WorldCorridor.paths`). */
  readonly paths: readonly PathFeature[];
  /**
   * Whether the ride's streets are scenery — a route ride — so that a car
   * may stand at a street's kerb. False on an open-world ride. @see the header
   */
  readonly kerbs: boolean;
  /**
   * How far `(x, z)` is from the middle of ANY stretch of the ridden road,
   * exact within `reach` — less whatever pavement is laid on that side of it.
   */
  readonly road: (x: number, z: number, reach: number) => number;
  /**
   * The drawn ground about `(x, z)`, as `nearby-streets.ts` §`StreetGround`
   * answers: a height for any point near it, or `undefined` on water or where
   * no ground is drawn.
   */
  readonly ground: (x: number, z: number) => ((x: number, z: number) => number) | undefined;
}

/** Which of `bodies` bodies a car is. */
export function parkedCarBody(car: Pick<ParkedCar, 'look'>, bodies: number): number {
  return bodies > 0 ? fmix32(car.look ^ 0x3278_b0d1) % bodies : 0;
}

/** Which of `paints` paints a car wears: from a stream of its own, so a body and a paint do not go together. */
export function parkedCarPaint(car: Pick<ParkedCar, 'look'>, paints: number): number {
  return paints > 0 ? fmix32(car.look ^ 0x3278_9a17) % paints : 0;
}

/** The key the cars are hashed under, outside anything else's. */
const PARKED_KEY = 0x3278_0000;

/** A car that may stand: its place, its nose's direction, and what it is on. */
interface Candidate {
  readonly x: number;
  readonly z: number;
  /** Its nose's direction, unit. */
  readonly ux: number;
  readonly uz: number;
  readonly spot: ParkedCarSpot;
  readonly look: number;
}

/** A place's hash: the ride's seed, the kind of place and the place itself, in centimetres. */
function placeHash(seed: number, spot: ParkedCarSpot, x: number, z: number): number {
  const kind = spot === 'driveway' ? 1 : spot === 'apron' ? 2 : 3;
  return mixInto(
    mixInto(mixInto(seed ^ PARKED_KEY, kind), Math.round(x * 100)),
    Math.round(z * 100),
  );
}

/** A plot's cars before any is kept off anything, by seed. */
const plotCandidates = new WeakMap<ParkedCarPlot, { seed: number; found: readonly Candidate[] }>();

/** A street piece's kerb cars before any is kept off anything, by seed. */
const kerbCandidates = new WeakMap<
  NearbyStreetPiece,
  { seed: number; found: readonly Candidate[] }
>();

/** The car on a plot's garage driveway, where it has one that holds a car and its hash says so. */
function drivewayCandidate(plot: ParkedCarPlot, seed: number): Candidate | undefined {
  const ring = plot.driveway;
  // A garage's driveway is four corners, the garage's two first (`drivewayRing`);
  // a fuel station's forecourt is filed there too, and is no place to park.
  if (!plot.garage || ring.length !== 8) return undefined;
  const gx = ((ring[0] as number) + (ring[2] as number)) / 2;
  const gz = ((ring[1] as number) + (ring[3] as number)) / 2;
  const rx = ((ring[4] as number) + (ring[6] as number)) / 2;
  const rz = ((ring[5] as number) + (ring[7] as number)) / 2;
  const length = Math.hypot(rx - gx, rz - gz);
  const width = Math.hypot(
    (ring[2] as number) - (ring[0] as number),
    (ring[3] as number) - (ring[1] as number),
  );
  const { halfLength, halfWidth } = PARKED_CAR_BOX;
  if (!(length >= PARKED_CAR_GARAGE_GAP_METRES + 2 * halfLength) || width < 2 * halfWidth) {
    return undefined;
  }
  const nx = (rx - gx) / length;
  const nz = (rz - gz) / length;
  const out = PARKED_CAR_GARAGE_GAP_METRES + halfLength;
  const x = gx + nx * out;
  const z = gz + nz * out;
  const look = placeHash(seed, 'driveway', x, z);
  if (uniformFrom(look, 0) >= PARKED_CAR_SHARES.driveway) return undefined;
  const noseIn = uniformFrom(look, 1) < PARKED_CAR_NOSE_IN_SHARE;
  return {
    x,
    z,
    ux: noseIn ? -nx : nx,
    uz: noseIn ? -nz : nz,
    spot: 'driveway',
    look,
  };
}

/** The cars along a plot's apron, where it is deep enough for one. @see the header */
function apronCandidates(plot: ParkedCarPlot, seed: number, found: Candidate[]): void {
  const ring = plot.apron;
  const points = Math.floor(ring.length / 2);
  // Its wall's stations, then its kerb line's back again (`shop-aprons.ts` §`ShopApron.ring`).
  if (points < 4 || points % 2 !== 0) return;
  const stations = points / 2;
  const wallX = (at: number): number => ring[at * 2] as number;
  const wallZ = (at: number): number => ring[at * 2 + 1] as number;
  const kerbX = (at: number): number => ring[(points - 1 - at) * 2] as number;
  const kerbZ = (at: number): number => ring[(points - 1 - at) * 2 + 1] as number;
  const run = Math.hypot(wallX(stations - 1) - wallX(0), wallZ(stations - 1) - wallZ(0));
  if (!(run > 0)) return;
  const ex = (wallX(stations - 1) - wallX(0)) / run;
  const ez = (wallZ(stations - 1) - wallZ(0)) / run;
  /** How far along the wall station `at` is from the first. */
  const alongWall = (at: number): number =>
    (wallX(at) - wallX(0)) * ex + (wallZ(at) - wallZ(0)) * ez;
  const { halfLength, halfWidth } = PARKED_CAR_BOX;
  const needed = PARKED_CAR_APRON_DOOR_METRES + 2 * halfWidth + PARKED_CAR_APRON_KERB_METRES;
  const slot = 2 * halfLength + 1;
  const slots = Math.floor(run / slot);
  // The row faces one way, as a row parked before a shop does.
  const row = placeHash(seed, 'apron', wallX(0), wallZ(0));
  const turned = uniformFrom(row, 2) < 0.5 ? 1 : -1;
  for (let index = 0; index < slots; index += 1) {
    // Centred on the wall's run, so the row stands in the middle of the front.
    const along = (run - slots * slot) / 2 + (index + 0.5) * slot;
    // The shallowest the apron is anywhere beside the car, and which way out is there.
    let depth = Number.POSITIVE_INFINITY;
    let outX = 0;
    let outZ = 0;
    for (let at = 0; at < stations; at += 1) {
      // A station bounds the columns either side of it: from the station before to the one after.
      const before = alongWall(Math.max(0, at - 1));
      const after = alongWall(Math.min(stations - 1, at + 1));
      if (after < along - halfLength || before > along + halfLength) continue;
      const dx = kerbX(at) - wallX(at);
      const dz = kerbZ(at) - wallZ(at);
      const here = Math.hypot(dx, dz);
      if (here < depth) {
        depth = here;
        outX = here > 0 ? dx / here : 0;
        outZ = here > 0 ? dz / here : 0;
      }
    }
    if (!Number.isFinite(depth) || depth < needed) continue;
    const out = depth - PARKED_CAR_APRON_KERB_METRES - halfWidth;
    const x = wallX(0) + ex * along + outX * out;
    const z = wallZ(0) + ez * along + outZ * out;
    const look = placeHash(seed, 'apron', x, z);
    if (uniformFrom(look, 0) >= PARKED_CAR_SHARES.apron) continue;
    found.push({ x, z, ux: ex * turned, uz: ez * turned, spot: 'apron', look });
  }
}

function candidatesOfPlot(plot: ParkedCarPlot, seed: number): readonly Candidate[] {
  const known = plotCandidates.get(plot);
  if (known?.seed === seed) return known.found;
  const found: Candidate[] = [];
  const onDriveway = drivewayCandidate(plot, seed);
  if (onDriveway !== undefined) found.push(onDriveway);
  apronCandidates(plot, seed, found);
  plotCandidates.set(plot, { seed, found });
  return found;
}

/** Whether a street is one a car may stand at the kerb of: a `minor` or a `major` one, on the ground. */
function kerbStreet(piece: NearbyStreetPiece): boolean {
  return piece.deck !== true && (piece.widthClass === 'minor' || piece.widthClass === 'major');
}

function candidatesOfPiece(piece: NearbyStreetPiece, seed: number): readonly Candidate[] {
  const known = kerbCandidates.get(piece);
  if (known?.seed === seed) return known.found;
  const found: Candidate[] = [];
  const line = piece.line;
  const half = SIDE_ROAD_WIDTHS[piece.widthClass] / 2;
  const off = half - PARKED_CAR_KERB_GAP_METRES - PARKED_CAR_BOX.halfWidth;
  let total = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    total += Math.hypot(
      (line[at + 2] as number) - (line[at] as number),
      (line[at + 3] as number) - (line[at + 1] as number),
    );
  }
  // One side of a minor street, by its piece's own hash; both of a major one.
  const pieceHash = placeHash(seed, 'kerb', line[0] as number, line[1] as number);
  const sides: readonly (1 | -1)[] =
    piece.widthClass === 'major' ? [1, -1] : [uniformFrom(pieceHash, 3) < 0.5 ? 1 : -1];
  if (off > 0) {
    for (
      let along = PARKED_CAR_KERB_END_METRES;
      along <= total - PARKED_CAR_KERB_END_METRES;
      along += PARKED_CAR_KERB_SLOT_METRES
    ) {
      // The segment `along` is on, and where on it.
      let walked = 0;
      for (let at = 0; at + 3 < line.length; at += 2) {
        const ax = line[at] as number;
        const az = line[at + 1] as number;
        const dx = (line[at + 2] as number) - ax;
        const dz = (line[at + 3] as number) - az;
        const span = Math.hypot(dx, dz);
        if (span > 0 && along <= walked + span) {
          const t = (along - walked) / span;
          const px = ax + dx * t;
          const pz = az + dz * t;
          const ux = dx / span;
          const uz = dz / span;
          for (const side of sides) {
            // The street's right, looking along it, is `(−uz, ux)`: the side
            // traffic going that way keeps to, as the riders keep right
            // (`racing-line.ts` §`ROAD_SIDE`). A car on the other side faces back.
            const x = px + -uz * off * side;
            const z = pz + ux * off * side;
            const look = placeHash(seed, 'kerb', x, z);
            if (uniformFrom(look, 0) >= PARKED_CAR_SHARES.kerb) continue;
            found.push({ x, z, ux: ux * side, uz: uz * side, spot: 'kerb', look });
          }
          break;
        }
        walked += span;
      }
    }
  }
  kerbCandidates.set(piece, { seed, found });
  return found;
}

// --- A car's box against what it must keep off -------------------------------

/**
 * How far a segment is from a car's box, in metres: nought where it touches
 * or crosses it. Worked in the box's own frame, where it is a rectangle about
 * the origin.
 */
function boxToSegment(car: Candidate, ax: number, az: number, bx: number, bz: number): number {
  const { halfLength, halfWidth } = PARKED_CAR_BOX;
  // Along the nose, and along its left `(uz, −ux)`.
  const a0 = (ax - car.x) * car.ux + (az - car.z) * car.uz;
  const a1 = (ax - car.x) * car.uz - (az - car.z) * car.ux;
  const b0 = (bx - car.x) * car.ux + (bz - car.z) * car.uz;
  const b1 = (bx - car.x) * car.uz - (bz - car.z) * car.ux;
  // Clipped to the rectangle (Liang–Barsky): anything left of it is inside.
  let from = 0;
  let to = 1;
  const d0 = b0 - a0;
  const d1 = b1 - a1;
  let crosses = true;
  for (const [p, q] of [
    [-d0, a0 + halfLength],
    [d0, halfLength - a0],
    [-d1, a1 + halfWidth],
    [d1, halfWidth - a1],
  ] as const) {
    if (p === 0) {
      if (q < 0) crosses = false;
    } else if (p < 0) {
      from = Math.max(from, q / p);
    } else {
      to = Math.min(to, q / p);
    }
  }
  if (crosses && from <= to) return 0;
  // Apart: the nearest of an end of the segment to the rectangle, and a corner to the segment.
  const toRectangle = (p0: number, p1: number): number =>
    Math.hypot(Math.max(Math.abs(p0) - halfLength, 0), Math.max(Math.abs(p1) - halfWidth, 0));
  let nearest = Math.min(toRectangle(a0, a1), toRectangle(b0, b1));
  const span = d0 * d0 + d1 * d1;
  for (const [c0, c1] of [
    [halfLength, halfWidth],
    [halfLength, -halfWidth],
    [-halfLength, halfWidth],
    [-halfLength, -halfWidth],
  ] as const) {
    const t = span > 0 ? Math.min(1, Math.max(0, ((c0 - a0) * d0 + (c1 - a1) * d1) / span)) : 0;
    nearest = Math.min(nearest, Math.hypot(c0 - a0 - d0 * t, c1 - a1 - d1 * t));
  }
  return nearest;
}

/** A box's four corners, `x, z` each, round it. */
function cornersOf(car: Candidate): readonly (readonly [number, number])[] {
  const { halfLength, halfWidth } = PARKED_CAR_BOX;
  const lx = car.uz;
  const lz = -car.ux;
  return [
    [car.x + car.ux * halfLength + lx * halfWidth, car.z + car.uz * halfLength + lz * halfWidth],
    [car.x + car.ux * halfLength - lx * halfWidth, car.z + car.uz * halfLength - lz * halfWidth],
    [car.x - car.ux * halfLength - lx * halfWidth, car.z - car.uz * halfLength - lz * halfWidth],
    [car.x - car.ux * halfLength + lx * halfWidth, car.z - car.uz * halfLength + lz * halfWidth],
  ];
}

/** Whether `(x, z)` is inside a ring of `x, z` pairs. */
function insideRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  const n = Math.floor(ring.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a car's box comes within `margin` of a ring's outline, or stands inside it. */
function boxMeetsRing(car: Candidate, ring: ArrayLike<number>, margin: number): boolean {
  const n = Math.floor(ring.length / 2);
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    if (
      boxToSegment(
        car,
        ring[j * 2] as number,
        ring[j * 2 + 1] as number,
        ring[i * 2] as number,
        ring[i * 2 + 1] as number,
      ) < margin
    ) {
      return true;
    }
  }
  return insideRing(ring, car.x, car.z);
}

/** Whether two cars' boxes come within {@link PARKED_CAR_GAP_METRES} of each other. */
function boxesMeet(a: Candidate, b: Candidate): boolean {
  const { halfLength, halfWidth } = PARKED_CAR_BOX;
  const reach = 2 * Math.hypot(halfLength, halfWidth) + PARKED_CAR_GAP_METRES;
  if (Math.hypot(a.x - b.x, a.z - b.z) > reach) return false;
  const corners = cornersOf(b);
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const [jx, jz] = corners[j] as readonly [number, number];
    const [ix, iz] = corners[i] as readonly [number, number];
    if (boxToSegment(a, jx, jz, ix, iz) < PARKED_CAR_GAP_METRES) return true;
  }
  // One wholly inside the other has no edge near it; two boxes of one size cannot be, but say so.
  return boxToSegment(a, b.x, b.z, b.x, b.z) === 0;
}

/** The points of a box's outline the road is measured from: its corners and along each side. */
function outlineOf(car: Candidate): readonly (readonly [number, number])[] {
  const corners = cornersOf(car);
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [ax, az] = corners[i] as readonly [number, number];
    const [bx, bz] = corners[(i + 1) % 4] as readonly [number, number];
    // A long side every 1.125 m, a short side at its ends and middle.
    const steps = i % 2 === 0 ? 2 : 4;
    for (let step = 0; step < steps; step += 1) {
      points.push([ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps]);
    }
  }
  return points;
}

/**
 * How far off a street's middle a car's box must keep: its edge and
 * {@link PARKED_CAR_STREET_MARGIN_METRES}, and on an open-world ride
 * {@link PARKED_CAR_ROAD_CLEAR_METRES} off any street the rider may turn
 * onto — every one but a `service` road, a track and a bridleway, which the
 * street graph leaves out (ADR 0091 D-3).
 */
function streetClearance(half: number, ridable: boolean, kerbs: boolean): number {
  const edge = half + PARKED_CAR_STREET_MARGIN_METRES;
  return kerbs || !ridable ? edge : Math.max(edge, PARKED_CAR_ROAD_CLEAR_METRES);
}

/** A mapped line's box in plan, found once: a footway's, or a street's. */
const lineBoxes = new WeakMap<
  Float32Array,
  { minX: number; maxX: number; minZ: number; maxZ: number }
>();

function boxOfLine(line: Float32Array): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const known = lineBoxes.get(line);
  if (known !== undefined) return known;
  const box = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (let at = 0; at + 1 < line.length; at += 2) {
    box.minX = Math.min(box.minX, line[at] as number);
    box.maxX = Math.max(box.maxX, line[at] as number);
    box.minZ = Math.min(box.minZ, line[at + 1] as number);
    box.maxZ = Math.max(box.maxZ, line[at + 1] as number);
  }
  lineBoxes.set(line, box);
  return box;
}

/**
 * The least cosine between a kerb car and a stretch of street for the car to
 * be standing AT that street's kerb: **0.95**, within 18° of along it.
 */
const KERB_ALONG_COSINE = 0.95;

/**
 * Whether a kerb car stands at the kerb of the street the segment is a
 * stretch of: along it, and its middle within the street's half-width of the
 * segment's LINE — the line and not the segment, so the stretches of its own
 * street before and after it are its own too, and a street beside it is not.
 */
function atTheKerbOf(
  car: Candidate,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  half: number,
): boolean {
  if (car.spot !== 'kerb') return false;
  const dx = bx - ax;
  const dz = bz - az;
  const span = Math.hypot(dx, dz);
  if (!(span > 0)) return false;
  if (Math.abs((dx * car.ux + dz * car.uz) / span) < KERB_ALONG_COSINE) return false;
  return Math.abs(((car.x - ax) * dz - (car.z - az) * dx) / span) <= half;
}

/** How far `(x, z)` is outside a box in plan: nought inside it. */
function gapToBox(
  box: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  },
  x: number,
  z: number,
): number {
  return Math.hypot(
    Math.max(box.minX - x, x - box.maxX, 0),
    Math.max(box.minZ - z, z - box.maxZ, 0),
  );
}

/** What is near enough to the place asked about to stand in a car's way there. */
interface Near {
  readonly plots: readonly ParkedCarPlot[];
  readonly streets: readonly StreetFeature[];
  readonly paths: readonly PathFeature[];
}

/**
 * Whether a car may stand where it is, whatever other car is near — the
 * header's rules but the last. Each reads only what is within the car's own
 * reach, so the answer is the same wherever it is asked from.
 */
function standsClear(car: Candidate, site: ParkedCarSite, near: Near): boolean {
  const reach = Math.hypot(PARKED_CAR_BOX.halfLength, PARKED_CAR_BOX.halfWidth);
  // Off the ridden road, its whole outline.
  for (const [x, z] of outlineOf(car)) {
    if (site.road(x, z, PARKED_CAR_ROAD_CLEAR_METRES + 1) < PARKED_CAR_ROAD_CLEAR_METRES) {
      return false;
    }
  }
  // Off every footprint.
  let housed = false;
  for (const plot of near.plots) {
    const off = Math.hypot(plot.centroid.x - car.x, plot.centroid.z - car.z);
    if (off <= PARKED_CAR_KERB_HOUSE_METRES) housed = true;
    if (boxMeetsRing(car, plot.footprint, PARKED_CAR_WALL_METRES)) return false;
  }
  // A kerb car only on a street with a building on it: a lane through fields has none.
  if (car.spot === 'kerb' && !housed) return false;
  // Off every other street's surface, and off the middle of one the rider may turn onto.
  for (const street of near.streets) {
    if (
      gapToBox(boxOfLine(street.line), car.x, car.z) >
      PARKED_CAR_ROAD_CLEAR_METRES + SIDE_ROAD_WIDTHS.highway + reach
    ) {
      continue;
    }
    const widthClass = widthClassOf(street);
    const half = SIDE_ROAD_WIDTHS[widthClass] / 2;
    const ridable = widthClass === 'minor' || widthClass === 'major';
    const clear = streetClearance(half, ridable, site.kerbs);
    const line = street.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      // The street a kerb car stands at the kerb of is its own.
      if (atTheKerbOf(car, ax, az, bx, bz, half)) continue;
      if (boxToSegment(car, ax, az, bx, bz) < clear) return false;
    }
  }
  // Off every mapped footway's line.
  for (const path of near.paths) {
    if (gapToBox(boxOfLine(path.line), car.x, car.z) > PARKED_CAR_FOOTWAY_METRES + reach) continue;
    const line = path.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      if (
        boxToSegment(
          car,
          line[at] as number,
          line[at + 1] as number,
          line[at + 2] as number,
          line[at + 3] as number,
        ) < PARKED_CAR_FOOTWAY_METRES
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Whether `a` is kept before `b` where the two would meet. @see the header */
function keptBefore(a: Candidate, b: Candidate): boolean {
  const rank = (car: Candidate): number =>
    car.spot === 'driveway' ? 0 : car.spot === 'apron' ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) < rank(b);
  if (a.look !== b.look) return a.look < b.look;
  return a.x !== b.x ? a.x < b.x : a.z < b.z;
}

/** How far apart a car's axles are taken to be when its pitch is read off the ground, metres: **2.6**. */
const PITCH_SPAN_METRES = 2.6;

/**
 * The parked cars in reach of `(x, z)` — #3278: every car that may stand
 * within {@link PARKED_CAR_FAR_METRES} of the middle of the
 * {@link PARKED_CAR_CELL_METRES} cell `(x, z)` is in, the nearest
 * {@link PARKED_CARS_MAX} of them, nearest first. The same answer for every
 * place in a cell. @see the header
 */
export function parkedCarsAt(site: ParkedCarSite, x: number, z: number): ParkedCarsInView {
  if (site.plots.length === 0 && site.pieces.length === 0) return NO_PARKED_CARS;
  const cell = PARKED_CAR_CELL_METRES;
  const cx = (Math.floor(x / cell) + 0.5) * cell;
  const cz = (Math.floor(z / cell) + 0.5) * cell;
  const gather = PARKED_CAR_FAR_METRES + PARKED_CAR_NEIGHBOUR_METRES;
  // What is near enough to hold a car in reach, or to stand in the way of one.
  const plots: ParkedCarPlot[] = [];
  site.plots.forEach((plot, index) => {
    const reach = gather + (site.radii[index] ?? 0) + PARKED_CAR_KERB_HOUSE_METRES;
    if (Math.hypot(plot.centroid.x - cx, plot.centroid.z - cz) <= reach) plots.push(plot);
  });
  const pieces = site.pieces.filter(
    (piece) => gapToBox(piece, cx, cz) <= gather + PARKED_CAR_NEIGHBOUR_METRES,
  );
  if (plots.length === 0 && pieces.length === 0) return NO_PARKED_CARS;
  const paths = site.paths.filter(
    (path) =>
      isFootway(path) &&
      gapToBox(boxOfLine(path.line), cx, cz) <= gather + PARKED_CAR_NEIGHBOUR_METRES,
  );
  // A street on the ground: one on a bridge or in a tunnel stands in nobody's way down here.
  const streets = site.streets.filter(
    (street) =>
      street.grade === 'ground' &&
      gapToBox(boxOfLine(street.line), cx, cz) <= gather + 2 * PARKED_CAR_NEIGHBOUR_METRES,
  );
  const near: Near = { plots, streets, paths };
  const candidates: Candidate[] = [];
  for (const plot of plots) {
    for (const car of candidatesOfPlot(plot, site.seed)) {
      if (Math.hypot(car.x - cx, car.z - cz) <= gather) candidates.push(car);
    }
  }
  if (site.kerbs) {
    for (const piece of pieces) {
      if (!kerbStreet(piece)) continue;
      for (const car of candidatesOfPiece(piece, site.seed)) {
        if (Math.hypot(car.x - cx, car.z - cz) <= gather) candidates.push(car);
      }
    }
  }
  // Each stood on its ground, or dropped where there is none.
  const stood: { car: Candidate; y: number; pitch: number }[] = [];
  for (const car of candidates) {
    if (!standsClear(car, site, near)) continue;
    const about = site.ground(car.x, car.z);
    if (about === undefined) continue;
    const half = PITCH_SPAN_METRES / 2;
    const noseX = car.x + car.ux * half;
    const noseZ = car.z + car.uz * half;
    const tailX = car.x - car.ux * half;
    const tailZ = car.z - car.uz * half;
    // Neither end over water or off the drawn ground.
    if (site.ground(noseX, noseZ) === undefined || site.ground(tailX, tailZ) === undefined) {
      continue;
    }
    const nose = about(noseX, noseZ);
    const tail = about(tailX, tailZ);
    stood.push({
      car,
      y: (nose + tail) / 2,
      pitch: Math.atan2(nose - tail, PITCH_SPAN_METRES),
    });
  }
  // Of two that would meet, the one kept before the other; never a chain's verdict.
  const kept = stood.filter(
    ({ car }) =>
      Math.hypot(car.x - cx, car.z - cz) <= PARKED_CAR_FAR_METRES &&
      !stood.some(
        (other) => other.car !== car && keptBefore(other.car, car) && boxesMeet(other.car, car),
      ),
  );
  if (kept.length === 0) return NO_PARKED_CARS;
  const off = (car: Candidate): number => Math.hypot(car.x - cx, car.z - cz);
  kept.sort((a, b) => off(a.car) - off(b.car) || (keptBefore(a.car, b.car) ? -1 : 1));
  const cars: ParkedCar[] = [];
  let nearDrawn = 0;
  for (const { car, y, pitch } of kept.slice(0, PARKED_CARS_MAX)) {
    const near = off(car) <= PARKED_CAR_NEAR_METRES && nearDrawn < PARKED_CARS_NEAR_MAX;
    if (near) nearDrawn += 1;
    cars.push({
      x: car.x,
      y,
      z: car.z,
      heading: Math.atan2(car.ux, car.uz),
      pitch,
      spot: car.spot,
      level: near ? 'near' : 'far',
      look: car.look,
    });
  }
  return { cars };
}

/**
 * Whether any part of a car's box comes within `clear` metres of a segment's
 * line — what {@link parkedCarsAt} holds every car to, asked of a car as a
 * frame carries it.
 *
 * @test-facing `parked-cars.test.ts` and `parked-cars-scene.test.ts` ask it of
 * the cars a frame carries against the ridden road, every drawn side road and
 * one another; the product keeps a car off them as a candidate, before it is one
 */
export function parkedCarToSegment(
  car: Pick<ParkedCar, 'x' | 'z' | 'heading'>,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  return boxToSegment(
    {
      x: car.x,
      z: car.z,
      ux: Math.sin(car.heading),
      uz: Math.cos(car.heading),
      spot: 'kerb',
      look: 0,
    },
    ax,
    az,
    bx,
    bz,
  );
}

/**
 * A car's box in plan, its four corners round it, `x, z` each.
 *
 * @test-facing `parked-cars.test.ts` and `parked-cars-scene.test.ts` measure a
 * frame's cars by it; the product measures a candidate's
 */
export function parkedCarCorners(
  car: Pick<ParkedCar, 'x' | 'z' | 'heading'>,
): readonly (readonly [number, number])[] {
  return cornersOf({
    x: car.x,
    z: car.z,
    ux: Math.sin(car.heading),
    uz: Math.cos(car.heading),
    spot: 'kerb',
    look: 0,
  });
}
