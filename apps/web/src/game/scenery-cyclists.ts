// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Other cyclists on the road — #2722, the owner's ruling of 2026-11-16: "for
 * additional scenery we should add in some random cyclists just for someone
 * or something to pass". Riders coming the other way, slower riders ahead
 * that the rider catches and passes, and now and then a faster one who
 * overtakes. Where each one is, and what they wear. Draws nothing:
 * `three-renderer.ts` §`RealisticRiderBelt` and §`PeopleBelt` draw what
 * `scene.ts` §`sceneryCyclistsOf` places from here.
 *
 * ## Scenery only — the owner's ruling
 *
 * They give no draft, have no race standing and never reach the trainer.
 * Nothing in the drafting, race, announcer or trainer code imports this
 * file (`scenery-cyclists.test.ts` holds the importers to the drawing's own),
 * and they are not riders of the frame: they are not in `SceneFrame.markers`,
 * so nothing that reads the riders — the solo draft, the name tags, the
 * stylised belt — ever sees one. `scene.ts` places them only on a free ride or a
 * workout: never in a lap race, a room, a Delivery round, or beside the pacer
 * or a ghost, where another rider on the road means something.
 *
 * ## Encounters, and where each one is
 *
 * The route is cut into cells of {@link CYCLIST_CELL_METRES}, and each cell
 * holds an encounter by a seeded draw from the route, at
 * {@link CYCLISTS_PER_CELL}: a few a ride, more on a town's road than in open
 * country. An encounter is a place on the route, its *meeting point*, a kind
 * and a pace — a share of the rider's own:
 *
 * - **oncoming**, at {@link ONCOMING_PACE} of the rider's pace, the other way;
 * - **slower**, ahead, at {@link SLOWER_PACE}, so the rider catches them;
 * - **faster**, behind, at {@link FASTER_PACE}, so they overtake.
 *
 * ⚠️ **A function of where the rider is drawn, never of a clock.** A cyclist
 * is at `meeting + pace · (rider − meeting)` (the other way for oncoming), so
 * every encounter happens at its meeting point, whatever the rider's speed: a
 * rider at 15 km/h still passes the slower one, and a rider at 50 km/h is
 * still passed by the faster. It is also why the same ride shows the same
 * riders in the same places, and why a rider who stops holds them, as a held
 * ride holds #1541's people. Each one is drawn only within
 * {@link CYCLIST_DRAW_METRES} of the rider, and the window an encounter lasts
 * is sized so they are further than that at both its ends: none of them
 * appears or vanishes in view.
 *
 * ## In their lane, and never through the rider
 *
 * A cyclist riding the rider's way keeps to the rider's right, and an
 * oncoming one to the left ({@link KEEP_SIDE}), each in its kind's lane
 * ({@link LANES}): a slower one near the kerb, so the rider — who holds the
 * right-hand lane 1.75 m out on a straight (`racing-line.ts`) — passes it on
 * its left, and a faster one nearer the centre, passing the rider on theirs,
 * as a rider overtakes. Where the rider — or another
 * cyclist already placed — is within a bicycle's length of them along the road,
 * they move across ({@link clearLateral}) to the nearest place at least
 * {@link CLEAR_METRES} from everybody, eased in as #499's level riders are,
 * never past {@link ROAD_EDGE_METRES}, and never over the centre into the
 * other half. The rider is never moved: nothing a cyclist does changes how the
 * rider is drawn.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message.
 *
 * Pure, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { slotHash, uniformFrom } from './seeded';
import { siteAt, siteSpacing } from './settlements';
import type { UrbanClassMap } from './urban-class';

/** Which way a cyclist is going, and against the rider's pace. */
export type CyclistKind = 'oncoming' | 'slower' | 'faster';

/** How long a cell of the route that may hold an encounter is, in metres: **250**. */
export const CYCLIST_CELL_METRES = 250;

/**
 * The chance a cell holds an encounter: **0.35** on a town's road (a mapped
 * village, town or city centre, or a procedural village), **0.08** in open
 * country — about 1.4 a kilometre in a town and one every 3 km outside,
 * which is the issue's "a few per ride, more on town roads".
 */
export const CYCLISTS_PER_CELL = { town: 0.35, country: 0.08 } as const;

/** The share of encounters of each kind: half come the other way, and a faster rider is the rarest. */
export const KIND_SHARE: Readonly<Record<CyclistKind, number>> = {
  oncoming: 0.5,
  slower: 0.3,
  faster: 0.2,
};

/** An oncoming rider's pace, as a share of the rider's own: **0.7** to **1.1**. */
export const ONCOMING_PACE = [0.7, 1.1] as const;

/** A slower rider's pace: **0.6** to **0.8** of the rider's — caught, and passed. */
export const SLOWER_PACE = [0.6, 0.8] as const;

/** A faster rider's pace: **1.25** to **1.5** of the rider's — they overtake. */
export const FASTER_PACE = [1.25, 1.5] as const;

/**
 * How far from the rider a cyclist is drawn at all, in metres: **150** —
 * `people.ts` §`PEOPLE_FAR_METRES`, where a person becomes a few pixels in the
 * fog. Each encounter's window is sized so its cyclist is past this at both ends.
 */
export const CYCLIST_DRAW_METRES = 150;

/**
 * The most cyclists one frame draws: **3**, the nearest. A frame with more in
 * reach than that is a coincidence of three cells; the budget is
 * `realistic-budget.ts` §`REALISTIC_SCENERY_CYCLIST_TRIANGLES`.
 */
export const SCENERY_CYCLISTS_MAX = 3;

/**
 * Which side of the road a cyclist riding the rider's way keeps to: **+1**,
 * the rider's right (the road's normal side, `port.ts` §`RiderMarker.lean`).
 * An oncoming one keeps to the other side.
 */
export const KEEP_SIDE = 1;

/**
 * How far from the centreline each kind's lane is, in metres, least to most
 * — each cyclist's is a seeded place between: an oncoming one **1.7 to 2.3**
 * out in the other half, a slower one **2.5 to 2.9** out by the kerb, and a
 * faster one **0.6 to 0.9** out, its overtaking line, the rider's 1.75 m
 * less a little under {@link CLEAR_METRES}: it comes level only a few
 * centimetres further over.
 */
export const LANES: Readonly<Record<CyclistKind, readonly [number, number]>> = {
  oncoming: [1.7, 2.3],
  slower: [2.5, 2.9],
  faster: [0.6, 0.9],
};

/**
 * How far across the road a cyclist level with another rider keeps from
 * them, middle to middle: **1.2 m** — `scene.ts`' two handlebars and the air
 * between them, the gap #499 keeps level riders apart by.
 */
export const CLEAR_METRES = 1.2;

/**
 * The furthest from the centreline a cyclist is ever drawn: **3.2 m**, half a
 * handlebar and 0.1 m inside the 7 m road's edge — `scene.ts`'
 * `DRAWN_LIMIT_METRES`.
 */
export const ROAD_EDGE_METRES = 3.2;

/**
 * The nearest the centreline a cyclist is ever drawn: **0.4 m**, a handlebar's
 * half and as much again, so no part of one is over the centre in the other
 * half of the road.
 */
export const OWN_HALF_METRES = 0.4;

/** What a cyclist wears and rides, as sRGB hex. */
export interface CyclistLook {
  readonly jersey: number;
  readonly shorts: number;
  readonly skin: number;
  readonly shoes: number;
  readonly hair: number;
  readonly frame: number;
  readonly helmet: number;
}

/** One cyclist, where a frame draws them. @see SceneFrame.cyclists in `port.ts` */
export interface SceneryCyclist {
  readonly kind: CyclistKind;
  /** Where the bicycle stands, on the road surface between its tyres' contacts. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Which way it faces, a unit vector in the ground plane: against the road for an oncoming one. */
  readonly headingX: number;
  readonly headingZ: number;
  /**
   * How far the bicycle and its rider lean together, radians from upright —
   * positive toward the cyclist's OWN right, so an oncoming one in the same
   * bend leans the other way by this sign and the same way on the road.
   */
  readonly lean: number;
  /** How far its cranks have turned, radians: from its own odometer, as the pacer's are. */
  readonly crankAngle: number;
  /** Where across the road it is, metres from the centreline, positive on the rider's right. */
  readonly lateral: number;
  /** Where along the route it is, metres. */
  readonly along: number;
  readonly look: CyclistLook;
}

/** One encounter, before it is placed. */
export interface Encounter {
  readonly kind: CyclistKind;
  /** Where on the route the rider and this cyclist meet, metres (unwrapped on a loop). */
  readonly meeting: number;
  /** Its pace, a share of the rider's. */
  readonly pace: number;
  /** Its lane, metres from the centreline, positive on the rider's right. */
  readonly lane: number;
  /** Its seed: its look and its cranks' offset. */
  readonly key: number;
}

/**
 * Bright kit, as a group ride's is — sRGB. None is the house kit's teal
 * (`bicycle.ts` §`HOUSE_KIT`) or the pacer's blue, so no cyclist is ever read
 * as the rider or the pacer.
 */
export const JERSEYS: readonly number[] = [
  0xd62828, 0xf77f00, 0xfcbf49, 0x2a9d8f, 0x6a4c93, 0xe9ecef, 0x1d3557, 0xff6b9a, 0x80b918,
  0x212529, 0xc1121f, 0x00a6fb,
];

/** Shorts and bib tights, sRGB: nearly always black, now and then navy or grey. */
export const SHORTS: readonly number[] = [0x111111, 0x111111, 0x111111, 0x1b2a41, 0x3a3a3a];

/** Frames, sRGB: what a bicycle shop's floor holds. */
export const FRAMES: readonly number[] = [
  0x1a1a1a, 0xf1f1f1, 0xb3001b, 0x0f4c81, 0x2d6a4f, 0x8d99ae, 0xffb703, 0x5a189a,
];

/** Helmets, sRGB. */
export const HELMETS: readonly number[] = [0xf8f9fa, 0x111111, 0xd62828, 0x1d3557, 0xfcbf49];

/** Skin, sRGB: `people.ts`' spread. */
const SKIN: readonly number[] = [
  0xf1c6a6, 0xe0ac8a, 0xc68863, 0xa86b4a, 0x8a5536, 0x6b3f28, 0x4f2e1e,
];

/** Cycling shoes, sRGB. */
const SHOES: readonly number[] = [0x111111, 0xf1f1f1, 0x1d3557];

/** Hair under the helmet, sRGB. */
const HAIR: readonly number[] = [0x1b1410, 0x3b2617, 0x6a4a2c, 0xa7834f, 0x8a8a8a];

function pick(list: readonly number[], share: number): number {
  return list[Math.min(list.length - 1, Math.floor(share * list.length))] as number;
}

/** A cyclist's seeded look. */
export function cyclistLook(key: number): CyclistLook {
  return {
    jersey: pick(JERSEYS, uniformFrom(key, 10)),
    shorts: pick(SHORTS, uniformFrom(key, 11)),
    skin: pick(SKIN, uniformFrom(key, 12)),
    shoes: pick(SHOES, uniformFrom(key, 13)),
    hair: pick(HAIR, uniformFrom(key, 14)),
    frame: pick(FRAMES, uniformFrom(key, 15)),
    helmet: pick(HELMETS, uniformFrom(key, 16)),
  };
}

/** Whether the road at `along` is a town's — @see CYCLISTS_PER_CELL. */
export type TownAt = (along: number) => boolean;

/**
 * Whether the road at `along` is a town's: the ride's urban class says so where
 * it was mapped, or a procedural village of `settlements.ts` stands there.
 */
export function townAt(profile: RouteProfile, seed: number, urban: UrbanClassMap): TownAt {
  const { span } = siteSpacing(profile);
  const length = profile.totalDistance;
  return (along) => {
    const wrapped = profile.loop && length > 0 ? ((along % length) + length) % length : along;
    const mapped = urban.classAt(wrapped);
    if (mapped === 'village' || mapped === 'town' || mapped === 'city-centre') return true;
    if (!(span > 0)) return false;
    const site = siteAt(profile, seed, Math.floor(along / span));
    return (
      site !== undefined &&
      site.kind === 'village' &&
      Math.abs(along - site.centre) <= site.half + CYCLIST_CELL_METRES / 2
    );
  };
}

/** The seed stream of the encounters, apart from every other user of the route's seed. */
const ENCOUNTER_KEY = 0x2722;

function paceOf(kind: CyclistKind, share: number): number {
  const [low, high] =
    kind === 'oncoming' ? ONCOMING_PACE : kind === 'slower' ? SLOWER_PACE : FASTER_PACE;
  return low + (high - low) * share;
}

/** The encounter of one cell of the route, or none. */
export function encounterOf(
  profile: RouteProfile,
  seed: number,
  town: TownAt,
  cell: number,
): Encounter | undefined {
  const length = profile.totalDistance;
  const cells = Math.max(1, Math.round(length / CYCLIST_CELL_METRES));
  const span = length / cells;
  if (!profile.loop && (cell < 0 || cell >= cells)) return undefined;
  // Hashed by the cell on the route's first lap, so a loop's every lap shows the same riders.
  const wrapped = ((cell % cells) + cells) % cells;
  const key = slotHash(seed, wrapped, ENCOUNTER_KEY);
  const meeting = cell * span + span * uniformFrom(key, 0);
  const chance = town(meeting) ? CYCLISTS_PER_CELL.town : CYCLISTS_PER_CELL.country;
  if (uniformFrom(key, 1) >= chance) return undefined;
  const roll = uniformFrom(key, 2);
  const kind: CyclistKind =
    roll < KIND_SHARE.oncoming
      ? 'oncoming'
      : roll < KIND_SHARE.oncoming + KIND_SHARE.slower
        ? 'slower'
        : 'faster';
  const side = kind === 'oncoming' ? -KEEP_SIDE : KEEP_SIDE;
  const [near, far] = LANES[kind];
  const lane = side * (near + (far - near) * uniformFrom(key, 3));
  return { kind, meeting, pace: paceOf(kind, uniformFrom(key, 4)), lane, key };
}

/** Where an encounter's cyclist is on the route when the rider is drawn at `rider`, metres. */
export function cyclistAlong(encounter: Encounter, rider: number): number {
  const since = rider - encounter.meeting;
  return encounter.kind === 'oncoming'
    ? encounter.meeting - encounter.pace * since
    : encounter.meeting + encounter.pace * since;
}

/**
 * How far from the rider's drawn place a cell can hold an encounter whose
 * cyclist is in reach, in metres: the slowest closing speed's —
 * `CYCLIST_DRAW_METRES / (1 − 0.8)` — and a cell.
 */
const ENCOUNTER_REACH_METRES =
  CYCLIST_DRAW_METRES / Math.min(1 - SLOWER_PACE[1], FASTER_PACE[0] - 1) + CYCLIST_CELL_METRES;

/** A cyclist in reach of the rider, before it is put across the road. */
export interface CyclistInReach {
  readonly encounter: Encounter;
  /** Where it is along the route, metres. */
  readonly along: number;
  /**
   * How far it has ridden, metres, by its own odometer — from its meeting
   * point, and a seeded few metres more so no two cyclists pedal in step:
   * what turns its cranks.
   */
  readonly ridden: number;
}

/**
 * Every encounter's cyclist within {@link CYCLIST_DRAW_METRES} of `rider` along
 * the route, nearest first, at most {@link SCENERY_CYCLISTS_MAX}; on a
 * point-to-point route only those on it.
 */
export function cyclistsInReach(
  profile: RouteProfile,
  seed: number,
  town: TownAt,
  rider: number,
): readonly CyclistInReach[] {
  const length = profile.totalDistance;
  const cells = Math.max(1, Math.round(length / CYCLIST_CELL_METRES));
  const span = length / cells;
  if (!(span > 0)) return [];
  const from = Math.floor((rider - ENCOUNTER_REACH_METRES) / span);
  const to = Math.floor((rider + ENCOUNTER_REACH_METRES) / span);
  const found: CyclistInReach[] = [];
  for (let cell = from; cell <= to; cell += 1) {
    const encounter = encounterOf(profile, seed, town, cell);
    if (encounter === undefined) continue;
    const along = cyclistAlong(encounter, rider);
    if (Math.abs(along - rider) > CYCLIST_DRAW_METRES) continue;
    if (!profile.loop && (along < 0 || along > length)) continue;
    found.push({
      encounter,
      along,
      ridden: encounter.pace * (rider - encounter.meeting) + 10 * uniformFrom(encounter.key, 5),
    });
  }
  found.sort((a, b) => Math.abs(a.along - rider) - Math.abs(b.along - rider));
  return found.slice(0, SCENERY_CYCLISTS_MAX);
}

/**
 * Over how much road a cyclist stops being level with another: from a
 * bicycle's length apart to 2 m beyond it — `scene.ts`' `LEVEL_FADE_METRES`.
 */
const LEVEL_FADE_METRES = 2;

/** Another rider on the road, as {@link clearLateral} keeps clear of them. */
export interface OnTheRoad {
  /** How far along the road from the cyclist, metres, either way. */
  readonly gap: number;
  /** Where across the road, metres from the centreline, positive on the rider's right. */
  readonly lateral: number;
}

/**
 * How level two riders `gap` apart along the road are: 1 within
 * `bicycleLength` of each other, 0 at {@link LEVEL_FADE_METRES} beyond it,
 * linear between — #499's rule, so a cyclist eases across as they come level.
 */
export function levelness(gap: number, bicycleLength: number): number {
  return Math.min(
    1,
    Math.max(0, (bicycleLength + LEVEL_FADE_METRES - Math.abs(gap)) / LEVEL_FADE_METRES),
  );
}

/**
 * Where across the road a cyclist in `lane` is drawn, with `others` on the
 * road: the place nearest its lane, in its own half of the road
 * ({@link OWN_HALF_METRES} to {@link ROAD_EDGE_METRES} out), that is at least
 * {@link CLEAR_METRES} times its levelness with each of `others` from them.
 * Where nobody is level, its lane. Where no place is clear of everybody, the
 * one in its half that is furthest from the nearest of them.
 *
 * The clear distance grows from nought with the levelness, so a cyclist is
 * eased across as it comes level and back as it goes, rather than jumping.
 * ⚠️ It does jump in one case, and only where it stays clear: a rider whose
 * own line crosses the cyclist's lane WHILE level with it moves the nearest
 * clear place from one side of the rider to the other.
 */
export function clearLateral(
  lane: number,
  others: readonly OnTheRoad[],
  bicycleLength: number,
): number {
  const side = lane < 0 ? -1 : 1;
  const inner = side * OWN_HALF_METRES;
  const outer = side * ROAD_EDGE_METRES;
  const low = Math.min(inner, outer);
  const high = Math.max(inner, outer);
  const keep = others
    .map((other) => ({ at: other.lateral, by: CLEAR_METRES * levelness(other.gap, bicycleLength) }))
    .filter((other) => other.by > 0);
  const within = (value: number): number => Math.min(high, Math.max(low, value));
  const start = within(lane);
  if (keep.length === 0) return start;
  const clearOf = (value: number): number =>
    Math.min(...keep.map((other) => Math.abs(value - other.at) - other.by));
  const candidates = [start, low, high];
  for (const other of keep)
    candidates.push(within(other.at - other.by), within(other.at + other.by));
  let best: number | undefined;
  for (const candidate of candidates) {
    if (clearOf(candidate) < -1e-9) continue;
    if (best === undefined || Math.abs(candidate - lane) < Math.abs(best - lane)) best = candidate;
  }
  if (best !== undefined) return best;
  // No clear place in its half: the one furthest from whoever is nearest.
  let furthest = start;
  for (const candidate of candidates) {
    if (clearOf(candidate) > clearOf(furthest)) furthest = candidate;
  }
  return furthest;
}
