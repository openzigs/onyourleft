// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a lap-race frame draws: the pick-up points, the puddles on the road,
 * and how each racer's hit effect looks — #1902, under ADR 0060 D-10.4
 * ("items, item effects and pick-up markers are drawn instanced, so the raise
 * stays small"). `delivery/in-view.ts` (#1814) is the precedent.
 *
 * `three-renderer.ts` §`LapRaceBelt` draws what this returns, read from
 * `port.ts` §`SceneFrame.lapRace` and §`RiderMarker.hit`, in at most three
 * calls whatever the count: one instanced call each for the pick-up points,
 * the puddles and the hit effects. The race's bots are `bot` markers in the
 * riders' own instanced meshes (`scene.ts` §`SceneInput.raceBots`, #368), so
 * they add none. This module decides **where** each piece is and how a hit
 * effect moves, and nothing about how anything looks.
 *
 * @unwired Nothing runs a lap race inside a ride yet. #1906 gives this
 * module its production caller when it runs a solo race in a game ride and
 * hands {@link lapRaceInView}'s result to the view on `SceneFrame.lapRace`,
 * each racer's {@link hitLook} on its marker, and the bots through
 * `SceneInput.raceBots`; until then only its tests and the browser gate's
 * `lap-race-harness.ts` reach it. The frame's types are `port.ts`', so the
 * view reaches none of the lap race's modules.
 *
 * ## What there is to draw
 *
 * #1899's rules resolve every item on the tick it is used: a gust hits at
 * once, a puddle is placed at once at the next pick-up point, a tow or a
 * tailwind starts at once. So **no item is ever in flight** in the model, and
 * nothing here draws one; what the rider sees of an item is the puddle it
 * leaves, or the hit effect it causes.
 *
 * - **A pick-up point** at each of `PICK_UP_FRACTIONS` round every lap, on
 *   the road's centre across the whole carriageway, because a pick-up counts
 *   in every lane (`items.ts` §`pickUpsPassed`).
 * - **A puddle** in the middle of its lane at its pick-up point, while it is
 *   on the road: the model drops one once it has dried.
 * - **A hit effect** on each racer while an item's slow-down runs on it: an
 *   effect with a negative rate (`items.ts` §`ITEM_RULES`: the puddle and the
 *   crosswind gust). A rain cape that absorbed a hit leaves no effect, so
 *   nothing is drawn for it.
 *
 * Only what stands on the frame's corridor is drawn, as `delivery/in-view.ts`
 * has it: a piece outside the corridor's span is not drawn rather than drawn
 * clamped to its end.
 *
 * ## Race distance onto the road
 *
 * The race measures distance from its own start (`race.ts`); the corridor's
 * points carry the ride's odometer (`terrain.ts` §`CorridorPoint.along`). A
 * race distance is placed at `startAlong` plus it, so a race started part of
 * the way into a ride is drawn where it is. Lanes are placed by
 * {@link laneLateral}: Delivery's three (`delivery/steer.ts`
 * §`LANE_OFFSETS_METRES`), which `in-view.test.ts` holds to the model's
 * `LANE_COUNT`.
 *
 * ## The hit effect, and reduced motion (WCAG 2.3.1)
 *
 * {@link hitLook} is the effect's whole timeline. With motion, the ring
 * grows in over {@link HIT_GROW_MS} from {@link HIT_GROW_FROM} of its size,
 * turns at {@link HIT_SPIN_TURNS_PER_SECOND}, and its brightness swings
 * gently between `HIT_GLOW_MEAN ± HIT_GLOW_SWING` at {@link HIT_PULSE_HZ}.
 * The swing is on the race's clock, not the hit's, so a second hit while the
 * first runs neither restarts nor jumps it: its reversals are 1.25 s apart,
 * and with an effect's start and end that is at most three luminance changes
 * in any second, for everybody.
 *
 * **Under `prefers-reduced-motion` it is steady**: full size, unturned, at
 * one brightness, from the hit until the slow-down ends. Its only changes are
 * appearing and going, and every item's slow-down lasts 4 s
 * (`items.ts` §`ITEM_RULES`). `in-view.test.ts` counts the changes over the
 * timeline in both forms.
 *
 * ## Nothing here leaves the ride
 *
 * Positions are held in memory for the frame, and nothing here formats one
 * into a string (ADR 0004 D).
 */

import { PICK_UP_FRACTIONS, type ItemRaceState, type OffsetEffect } from '@onyourleft/domain';

import { LANE_OFFSETS_METRES } from '../delivery/steer';
import type { LapRaceInView, LapRacePiece, RaceHitLook } from '../port';
import type { CorridorPoint, RoadCorridor } from '../terrain';

/** How long a hit effect takes to grow to its full size, with motion, ms. */
export const HIT_GROW_MS = 250;

/** What share of its full size a hit effect starts at, with motion. */
export const HIT_GROW_FROM = 0.5;

/** How many whole turns a second a hit effect makes about the vertical, with motion. */
export const HIT_SPIN_TURNS_PER_SECOND = 0.5;

/** The hit effect's mean brightness, `0` to `1`; its whole brightness under reduced motion. */
export const HIT_GLOW_MEAN = 0.8;

/** How far either side of {@link HIT_GLOW_MEAN} its brightness swings, with motion. */
export const HIT_GLOW_SWING = 0.2;

/**
 * How often the brightness swings, with motion, in cycles a second: a
 * reversal every 1.25 s, so a hit's start and end and one reversal are the
 * most any second holds (WCAG 2.3.1's three).
 */
export const HIT_PULSE_HZ = 0.4;

/** Everything a frame of a lap race knows. */
export interface LapRaceDrawInput {
  /** The frame's corridor: what the pieces are placed on. Only its centreline is read. */
  readonly corridor: Pick<RoadCorridor, 'centre'>;
  /** The race as it stands: its course and the puddles on the road. */
  readonly race: Pick<ItemRaceState, 'course' | 'hazards' | 'atMs'>;
  /** The ride's odometer where the race's distance is 0: its start line. */
  readonly startAlong: number;
}

/** A place on the corridor, and which way the road runs there. */
interface OnCorridor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingX: number;
  readonly headingZ: number;
}

/**
 * Where `along` falls on the corridor, between its points, and the road's
 * heading there: `delivery/in-view.ts`' own, restated so that the lap race
 * reaches none of Delivery's modules but its lanes. `undefined` outside the
 * corridor's span, or on a corridor with no length.
 */
function onCorridor(centre: readonly CorridorPoint[], along: number): OnCorridor | undefined {
  const last = centre.length - 1;
  if (last <= 0 || !Number.isFinite(along)) return undefined;
  const first = centre[0] as CorridorPoint;
  if (along < first.along || along > (centre[last] as CorridorPoint).along) return undefined;
  let low = 0;
  let high = last - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((centre[middle] as CorridorPoint).along > along) high = middle - 1;
    else low = middle;
  }
  const from = centre[low] as CorridorPoint;
  const to = centre[low + 1] as CorridorPoint;
  const span = to.along - from.along;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (along - from.along) / span)) : 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  return {
    x: from.x + dx * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + dz * fraction,
    headingX: length > 0 ? dx / length : 0,
    headingZ: length > 0 ? dz / length : 1,
  };
}

/** `at` moved `across` metres to the rider's right, facing along the road. */
function placed(at: OnCorridor, across: number): LapRacePiece {
  return {
    x: at.x - at.headingZ * across,
    y: at.y,
    z: at.z + at.headingX * across,
    yaw: Math.atan2(at.headingX, at.headingZ),
  };
}

/**
 * A lane's place across the road, metres, positive to the rider's right:
 * Delivery's three lanes (`delivery/steer.ts` §`LANE_OFFSETS_METRES`).
 * `SceneInput.raceBots` draws a bot here, and a puddle is drawn here.
 *
 * @throws {RangeError} for a lane that is not one of the three, naming the
 * constraint and not the value.
 */
export function laneLateral(lane: number): number {
  const lateral = Number.isInteger(lane) ? LANE_OFFSETS_METRES[lane] : undefined;
  if (lateral === undefined) throw new RangeError('lane must be one of the race’s lanes');
  return lateral;
}

/** The pieces a lap-race frame draws, as `port.ts` §`SceneFrame.lapRace` carries them. @see the header */
export function lapRaceInView(input: LapRaceDrawInput): LapRaceInView {
  const { centre } = input.corridor;
  const { course, hazards, atMs } = input.race;

  const pickUps: LapRacePiece[] = [];
  for (let lap = 0; lap < course.laps; lap += 1) {
    for (const fraction of PICK_UP_FRACTIONS) {
      const at = onCorridor(centre, input.startAlong + (lap + fraction) * course.lapLengthMetres);
      if (at !== undefined) pickUps.push(placed(at, 0));
    }
  }

  const puddles: LapRacePiece[] = [];
  for (const hazard of hazards) {
    if (!(hazard.untilMs > atMs)) continue;
    const at = onCorridor(centre, input.startAlong + hazard.position);
    if (at !== undefined) puddles.push(placed(at, laneLateral(hazard.lane)));
  }

  return { pickUps, hazards: puddles };
}

/**
 * How a racer's hit effect looks at `atMs`, or `undefined` while no item's
 * slow-down runs on them: the effect's whole timeline (see the header).
 *
 * @param effects - the racer's offset effects (`items.ts` §`LapRacer.effects`).
 * @param atMs - the instant drawn, on the race's clock.
 * @param reducedMotion - whether the rider asked for reduced motion.
 */
export function hitLook(
  effects: readonly OffsetEffect[],
  atMs: number,
  reducedMotion: boolean,
): RaceHitLook | undefined {
  // The start of the continuous run of slow-downs `atMs` is in: a second hit
  // during the first does not restart the grow-in, so the ring never snaps back.
  const slowDowns = effects
    .filter((effect) => effect.rateMetresPerSecond < 0 && effect.fromMs <= atMs)
    .sort((a, b) => a.fromMs - b.fromMs);
  let latest: number | undefined;
  let runEnd = -Infinity;
  for (const effect of slowDowns) {
    if (effect.fromMs > runEnd) latest = effect.fromMs;
    runEnd = Math.max(runEnd, effect.untilMs);
  }
  if (!(atMs < runEnd)) latest = undefined;
  if (latest === undefined) return undefined;
  if (reducedMotion) return { glow: HIT_GLOW_MEAN, scale: 1, spin: 0 };
  const seconds = atMs / 1_000;
  return {
    glow: HIT_GLOW_MEAN + HIT_GLOW_SWING * Math.cos(2 * Math.PI * HIT_PULSE_HZ * seconds),
    scale: Math.min(1, HIT_GROW_FROM + ((1 - HIT_GROW_FROM) * (atMs - latest)) / HIT_GROW_MS),
    spin: (2 * Math.PI * HIT_SPIN_TURNS_PER_SECOND * seconds) % (2 * Math.PI),
  };
}
