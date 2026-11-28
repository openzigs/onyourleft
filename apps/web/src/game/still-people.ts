// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * People who are not walking — #3285: **sitters** on some of a village's
 * benches, **spectators** behind the barriers at a start, finish or lap line's
 * gantry, and **standers** at a shop front. Where they are, which way they
 * face and what they are doing at a second of the ride; draws nothing.
 * `people.ts` §`peopleAt` counts them against the walkers' budget, nearest
 * first, and `three-renderer.ts` §`PeopleBelt` draws them in the people's one
 * instanced call, posed by `gait.ts` §"Still poses" — no new draw call.
 *
 * ## Seeded and pure
 *
 * Every choice — who sits on which bench, how many stand behind a barrier
 * piece, who claps — is drawn from `seeded.ts` by the place itself: a bench by
 * its street and its place among the street's benches, a spectator by their
 * line's route distance and the barrier piece, a stander by their shop front's
 * place. So the same ride and seed give the same people in the same poses,
 * whatever was drawn before. Their clothes are `people.ts` §`personLook`'s.
 *
 * ## Where each kind stands
 *
 * - **A sitter** is on the seat of a bench `streets.ts` laid
 *   (§`BENCH_SITTER_PLACES`), facing the road as the bench does, their soles
 *   on the pavement the bench stands on and their hips on its seat
 *   (§`BENCH_SEAT_TOP_METRES`, which the drawn bench's slats are laid by): the
 *   sit pose is blended to their height (`gait.ts` §`sitBlend`).
 * - **A spectator** is behind a gantry's barrier, on the verge beyond it —
 *   never between the barrier and the road ({@link SPECTATOR_BEHIND_METRES}
 *   past the barrier's back face, and a person's half-width) — in a small
 *   group, facing the road, on the drawn road's own frame at their piece
 *   (`gantry.ts` §`PlacedStand.boxes`). Some clap while the rider is within
 *   {@link SPECTATOR_CLAP_METRES}.
 * - **A stander** is on a shop's apron (`shop-aprons.ts`, #2848) — the paving
 *   between its front and the kerb — a little out from the wall. A front with
 *   an awning, which every café has (`footprint-buildings.ts`), is busier.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message.
 *
 * Pure, and names no rendering library.
 */

import { sitBlend, wrappedPhase, type Motion } from './gait';
import {
  BARRIER_LENGTH_METRES,
  BARRIER_THICKNESS_METRES,
  type PlacedBox,
  type PlacedStand,
} from './gantry';
import {
  PEOPLE_FAR_METRES,
  PERSON_HALF_WIDTH_METRES,
  PERSON_HEIGHT,
  personLook,
  type Person,
  type StillPlace,
} from './people';
import { slotHash, uniformFrom } from './seeded';
import { BENCH_SEAT_TOP_METRES, BENCH_SITTER_PLACES, type VillageStreet } from './streets';

/** The share of benches somebody sits on: **0.4**. */
export const BENCH_SITTER_SHARE = 0.4;

/** Of the benches somebody sits on, the share two sit on: **0.35**. */
export const BENCH_PAIR_SHARE = 0.35;

/** The share of a gantry's barrier pieces with a group behind them: **0.6**. */
export const SPECTATOR_GROUP_SHARE = 0.6;

/** The most people in one group behind a barrier piece: **3**. */
export const SPECTATOR_GROUP_MOST = 3;

/** How far apart a group's spectators stand along the barrier, in metres: **0.7**. */
export const SPECTATOR_SPACING_METRES = 0.7;

/**
 * How far behind a barrier's back face a spectator's side is, in metres:
 * **0.2** to **1.4**, seeded — so the nearest is clear of the barrier by a
 * hand and nobody is ever on the road's side of it.
 */
export const SPECTATOR_BEHIND_METRES = [0.2, 1.4] as const;

/** How near the rider a spectator claps, in metres: **30**. */
export const SPECTATOR_CLAP_METRES = 30;

/** The share of spectators who clap while the rider is near: **0.6**; the rest stand and watch. */
export const SPECTATOR_CLAP_SHARE = 0.6;

/** Claps a second: **2**, a clap a cycle of the clap pose. */
export const CLAPS_PER_SECOND = 2;

/** How long a stander's weight takes to shift and shift back, in seconds: **4**. */
export const STAND_SWAY_SECONDS = 4;

/**
 * The share of shop fronts with an apron that somebody stands at: **0.3**,
 * one person; and of those with an awning: **0.6**, up to
 * {@link SHOP_GROUP_MOST}.
 */
export const SHOP_STANDER_SHARE = { plain: 0.3, awning: 0.6 } as const;

/** The most people standing outside one shop front with an awning: **3**. */
export const SHOP_GROUP_MOST = 3;

/**
 * How far out from a shop's wall a stander stands, in metres: **0.6** to
 * **1.2** — and never nearer the kerb than {@link SHOP_KERB_CLEAR_METRES}.
 */
export const SHOP_OUT_METRES = [0.6, 1.2] as const;

/** How far a stander stays from an apron's kerb line, in metres: **0.5**. */
export const SHOP_KERB_CLEAR_METRES = 0.5;

/** What a still person is doing: sitting, standing, or clapping while the rider is near. */
export type StillDoing = 'sit' | 'stand' | 'cheer';

/** One still person, placed once: everything but their pose at a second. */
export interface StillSpot {
  readonly x: number;
  /** The ground under their feet: a bench's pavement top, or a road's height `scene.ts` restands. */
  readonly y: number;
  readonly z: number;
  /** Which way they face: three's yaw, as `people.ts` §`Person.yaw`. */
  readonly yaw: number;
  readonly height: number;
  readonly hash: number;
  readonly on: StillPlace;
  readonly doing: StillDoing;
  /** A sitter's phase of the sit pose (`gait.ts` §`sitBlend`); 0 for anyone else. */
  readonly phase: number;
}

function heightOf(hash: number): number {
  return PERSON_HEIGHT[0] + (PERSON_HEIGHT[1] - PERSON_HEIGHT[0]) * uniformFrom(hash, 3);
}

/** The benches' sitters of each street, once a street. */
const sittersOf = new WeakMap<VillageStreet, readonly StillSpot[]>();

/** The sitters on one street's benches. @see the header */
export function streetSitters(street: VillageStreet): readonly StillSpot[] {
  const known = sittersOf.get(street);
  if (known !== undefined) return known;
  const spots: StillSpot[] = [];
  let bench = 0;
  for (const item of street.furniture) {
    if (item.kind !== 'bench') continue;
    const seed = slotHash(street.wrappedSite, bench, 0x3285);
    bench += 1;
    if (uniformFrom(seed, 0) >= BENCH_SITTER_SHARE) continue;
    const two = uniformFrom(seed, 1) < BENCH_PAIR_SHARE;
    const places = two
      ? BENCH_SITTER_PLACES.along
      : [BENCH_SITTER_PLACES.along[uniformFrom(seed, 2) < 0.5 ? 0 : 1]];
    const sin = Math.sin(item.rotation);
    const cos = Math.cos(item.rotation);
    places.forEach((along, at) => {
      const hash = slotHash(seed, at, 0x51);
      const height = heightOf(hash);
      const back = BENCH_SITTER_PLACES.back;
      spots.push({
        // The bench's own frame turned by its yaw, as three turns it.
        x: item.x + along * cos + back * sin,
        y: item.y,
        z: item.z - along * sin + back * cos,
        yaw: item.rotation,
        height,
        hash,
        on: 'bench',
        doing: 'sit',
        phase: sitBlend(height, BENCH_SEAT_TOP_METRES),
      });
    });
  }
  sittersOf.set(street, spots);
  return spots;
}

/** Every sitter on `streets`' benches. */
export function benchSitters(streets: readonly VillageStreet[]): readonly StillSpot[] {
  return streets.flatMap(streetSitters);
}

/** A point of a barrier piece's frame: `across` along the road's normal there, `along` its heading. */
function onPiece(box: PlacedBox, across: number, along: number): { x: number; z: number } {
  return {
    x: box.x - box.headingZ * across + box.headingX * along,
    z: box.z + box.headingX * across + box.headingZ * along,
  };
}

/**
 * The spectators behind every gantry's barriers in `lines` — the frame's
 * placed stands (`gantry.ts` §`linesNear`). A line placed twice (two laps'
 * copies of a short circuit's) is peopled once. @see the header
 */
export function gantrySpectators(lines: readonly PlacedStand[]): readonly StillSpot[] {
  const spots: StillSpot[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    if (line.stand.kind !== 'gantry' || seen.has(line.stand.distance)) continue;
    seen.add(line.stand.distance);
    const lineSeed = slotHash(0x3285, Math.round(line.stand.distance * 10), 0x67);
    line.boxes.forEach((box, piece) => {
      if (box.box.role !== 'barrier') return;
      const seed = slotHash(lineSeed, piece, 1);
      if (uniformFrom(seed, 0) >= SPECTATOR_GROUP_SHARE) return;
      const count = 1 + Math.floor(uniformFrom(seed, 1) * SPECTATOR_GROUP_MOST);
      const side = box.box.across < 0 ? -1 : 1;
      // The barrier's back face, from the road's centreline.
      const face = Math.abs(box.box.across) + BARRIER_THICKNESS_METRES / 2;
      // Along the piece, inside its ends by a person's width, the group anywhere on it.
      const usable = BARRIER_LENGTH_METRES - 2 * PERSON_HALF_WIDTH_METRES;
      const extent = SPECTATOR_SPACING_METRES * (count - 1);
      const first = -usable / 2 + (usable - extent) * uniformFrom(seed, 2);
      for (let at = 0; at < count; at += 1) {
        const hash = slotHash(seed, at, 2);
        const behind =
          SPECTATOR_BEHIND_METRES[0] +
          (SPECTATOR_BEHIND_METRES[1] - SPECTATOR_BEHIND_METRES[0]) * uniformFrom(hash, 5);
        const across = side * (face + PERSON_HALF_WIDTH_METRES + behind);
        const along = first + at * SPECTATOR_SPACING_METRES;
        const point = onPiece(box, across, along);
        // Facing the road: back along the normal, turned a little either way.
        const turn = (uniformFrom(hash, 6) - 0.5) * 0.6;
        spots.push({
          x: point.x,
          y: box.y,
          z: point.z,
          yaw: Math.atan2(side * box.headingZ, -side * box.headingX) + turn,
          height: heightOf(hash),
          hash,
          on: 'spectator',
          doing: 'cheer',
          phase: 0,
        });
      }
    });
  }
  return spots;
}

/** What {@link shopStanders} reads of a mapped building's plan. */
export interface ShopFrontPlan {
  readonly apron: Float32Array;
  readonly shop: { readonly front: boolean; readonly awning: boolean };
}

/** The standers at each ride's shop fronts, once a ride's plans. */
const standersOf = new WeakMap<readonly ShopFrontPlan[], readonly StillSpot[]>();

/**
 * The standers at the shop fronts of `plans` — a ride's mapped buildings, each
 * with a shop front and an apron before it (`footprint-buildings.ts`
 * §`FootprintPlan.apron`: the wall's stations, then the kerb line's back
 * again). Built once a ride. Their `y` is 0: `scene.ts` stands them on the
 * ground drawn under them. @see the header
 */
export function shopStanders(plans: readonly ShopFrontPlan[]): readonly StillSpot[] {
  const known = standersOf.get(plans);
  if (known !== undefined) return known;
  const spots: StillSpot[] = [];
  plans.forEach((plan, index) => {
    const ring = plan.apron;
    const points = ring.length / 2;
    const stations = Math.floor(points / 2);
    if (!plan.shop.front || stations < 2) return;
    const seed = slotHash(0x3285, index, 0x5e);
    const busy = plan.shop.awning;
    if (uniformFrom(seed, 0) >= SHOP_STANDER_SHARE[busy ? 'awning' : 'plain']) return;
    const count = busy ? 1 + Math.floor(uniformFrom(seed, 1) * SHOP_GROUP_MOST) : 1;
    for (let at = 0; at < count; at += 1) {
      const hash = slotHash(seed, at, 3);
      // Between two of the wall's stations, and the kerb's line before them.
      const span = (stations - 1) * uniformFrom(hash, 7);
      const from = Math.min(stations - 2, Math.floor(span));
      const t = span - from;
      const wall = (station: number, axis: number): number => ring[station * 2 + axis] as number;
      const kerb = (station: number, axis: number): number =>
        ring[(points - 1 - station) * 2 + axis] as number;
      const lerp = (of: (station: number, axis: number) => number, axis: number): number =>
        of(from, axis) + (of(from + 1, axis) - of(from, axis)) * t;
      const wx = lerp(wall, 0);
      const wz = lerp(wall, 1);
      const ox = lerp(kerb, 0) - wx;
      const oz = lerp(kerb, 1) - wz;
      const depth = Math.hypot(ox, oz);
      const out =
        SHOP_OUT_METRES[0] + (SHOP_OUT_METRES[1] - SHOP_OUT_METRES[0]) * uniformFrom(hash, 5);
      const reach = Math.min(out, depth - SHOP_KERB_CLEAR_METRES);
      if (!(reach >= PERSON_HALF_WIDTH_METRES)) continue;
      const turn = (uniformFrom(hash, 6) - 0.5) * 1.2;
      spots.push({
        x: wx + (ox / depth) * reach,
        y: 0,
        z: wz + (oz / depth) * reach,
        // Facing out from the wall, toward the road, turned a little either way.
        yaw: Math.atan2(ox, oz) + turn,
        height: heightOf(hash),
        hash,
        on: 'shop-front',
        doing: 'stand',
        phase: 0,
      });
    }
  });
  standersOf.set(plans, spots);
  return spots;
}

/** What {@link stillPeopleAt} needs: where the rider is, in plan, and the ride's clock. */
export interface StillOptions {
  readonly x: number;
  readonly z: number;
  readonly seconds: number;
}

/** What one still person is doing at the clock, and where in its pose. */
function poseOf(spot: StillSpot, near: boolean, seconds: number): { gait: Motion; phase: number } {
  if (spot.doing === 'sit') return { gait: 'sit', phase: spot.phase };
  const offset = uniformFrom(spot.hash, 8);
  if (spot.doing === 'cheer' && near && uniformFrom(spot.hash, 9) < SPECTATOR_CLAP_SHARE) {
    return { gait: 'clap', phase: wrappedPhase(seconds * CLAPS_PER_SECOND + offset) };
  }
  return { gait: 'stand', phase: wrappedPhase(seconds / STAND_SWAY_SECONDS + offset) };
}

/**
 * Every spot of `lists` within `people.ts` §`PEOPLE_FAR_METRES` of the rider,
 * as the person a frame draws at `options.seconds`: a sitter sitting, a
 * stander swaying, and a spectator clapping while the rider is within
 * {@link SPECTATOR_CLAP_METRES} — if they are one who claps — and watching
 * otherwise. Their look is seeded by the spot.
 */
export function stillPeopleAt(
  lists: readonly (readonly StillSpot[])[],
  options: StillOptions,
): readonly Person[] {
  const found: Person[] = [];
  for (const spots of lists) {
    for (const spot of spots) {
      const distance = Math.hypot(spot.x - options.x, spot.z - options.z);
      if (distance > PEOPLE_FAR_METRES) continue;
      const { gait, phase } = poseOf(spot, distance <= SPECTATOR_CLAP_METRES, options.seconds);
      found.push({
        x: spot.x,
        y: spot.y,
        z: spot.z,
        yaw: spot.yaw,
        gait,
        phase,
        height: spot.height,
        look: personLook(spot.hash),
        distance,
        on: spot.on,
      });
    }
  }
  return found;
}
