// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a lap race draws its racers in a pack — #2544, pack riding step 3.
 *
 * The race places every racer by **effort distance** (ADR 0060 D-3), and the
 * draft model reads the gap between two racers as a **wheel gap** (ADR 0038
 * D-3): a bot sitting in holds a wheel 0.3 to 1 m back (#2542). Drawn at those
 * distances on one line, a pack would be seven bicycles inside one another. So
 * the drawing lays the field out, and the race never reads it back: nothing
 * here moves an effort distance, a race offset, a lane or a draft.
 *
 * ## Rows, a bike length apart
 *
 * The field is taken front to back. A racer within {@link PACK_ROW_METRES} of
 * the front of the row ahead of it, while that row has fewer than
 * {@link PACK_MOST_ABREAST}, rides in it; otherwise it starts the next row.
 * So a group rides two or three abreast at its front, and a strung-out field,
 * whose gaps are wider than a row, rides single file. Every row boundary adds
 * {@link BIKE_LENGTH_METRES} to the drawn gap: the bicycle the wheel gap does
 * not count. The rider is the anchor: their row is where the race has them,
 * rows ahead are drawn that many bike lengths further on, and rows behind that
 * many further back, so the rider's own place, which the camera and the grade
 * read, never moves.
 *
 * ## Across the lane
 *
 * A row's racers who share a lane share it side by side,
 * {@link PACK_ABREAST_METRES} apart and centred on the lane, so an item's lane
 * is still the lane a bot is drawn in (ADR 0060 D-5). The rider keeps the
 * place they steered to, and the bots beside them are laid out a full place
 * either side of it. Every racer keeps its order across the road, so a bot
 * coming up through the pack does it up the side.
 *
 * ## Never inside one another
 *
 * Once every bot has its place, a bot less than {@link PACK_ABREAST_METRES}
 * across from a racer ahead of it is drawn at least a bike length behind it,
 * so a bot steering a lane over, or a row still closing up, is never drawn
 * through anyone. The rider is never moved.
 *
 * ## Never a jump
 *
 * A row changes when the order does, and a lane when a bot steers. So every
 * bot's drawn place moves toward its row's at most
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND} across, the rider's own steering
 * speed, and {@link PACK_CLOSE_UP_METRES_PER_SECOND} along. Its sideways speed
 * goes to the drawing with it, which turns and leans the bicycle into the move
 * (#2456's `lane-change-lean.ts`). The layout is stepped with the race, a tick
 * at a time: a pure function of the field and the layout before.
 */

import { SIDEWAYS_METRES_PER_SECOND } from '../lanes';

/**
 * A road bicycle and its rider, front wheel to back, metres: **1.75**. What a
 * wheel gap leaves out (#2544).
 */
export const BIKE_LENGTH_METRES = 1.75;

/**
 * How far behind the front of a row, on effort distance, a racer may be and
 * still ride in it, metres: **1.4**, two of #2542's 0.65 m wheel gaps and a
 * little over.
 */
export const PACK_ROW_METRES = 1.4;

/** The most racers a row holds side by side: **3**. */
export const PACK_MOST_ABREAST = 3;

/**
 * How far apart two racers sharing a lane ride side by side, centre to
 * centre, metres: **0.55**, a pair of handlebars and a hand between. Three of
 * them span 1.1 m, inside the 1.75 m lane.
 */
export const PACK_ABREAST_METRES = 0.55;

/** The fastest a bot's drawn place moves across the road, metres a second: the rider's own steering speed. */
export const PACK_SIDEWAYS_METRES_PER_SECOND = SIDEWAYS_METRES_PER_SECOND;

/** The fastest a bot's drawn place moves along the road to its row's, metres a second: **2**. */
export const PACK_CLOSE_UP_METRES_PER_SECOND = 2;

/**
 * The most of its own speed a bot's drawn place gives back when it drops a row
 * or makes way, as a share: **0.9**. Under 1, and spread over the tick's
 * frames ({@link PackPlace.shiftBefore}), so a bot drawn giving way is still
 * drawn going forward.
 */
export const PACK_GIVE_WAY_SHARE = 0.9;

/**
 * The speed below which a bot keeps the place it was laid out in, metres a
 * second: **3**, the field still getting off the line.
 */
export const PACK_ROLLING_METRES_PER_SECOND = 3;

/** One racer as the layout reads it. */
export interface PackRacer {
  readonly id: string;
  /** Its place in the race, metres: effort distance plus race offset, the rider's and the bots' alike. */
  readonly along: number;
  /** Its lane's place across the road, metres (`in-view.ts` §`laneLateral`); the rider's steered place. */
  readonly lateral: number;
  /** Its speed, metres a second: how fast its drawn place may give way. */
  readonly speed: number;
}

/** Where the layout draws one bot, against where the race has it. */
export interface PackPlace {
  /** Metres added to its race place along the road: bike lengths, ahead of the rider's row or behind it. */
  readonly shift: number;
  /**
   * {@link shift} a tick before: a frame between two ticks draws the shift
   * between the two, as it draws the race place between them, so a bot giving
   * way moves back smoothly rather than a tick's worth at a time.
   */
  readonly shiftBefore: number;
  /** Metres across the road, positive to the rider's right. */
  readonly lateral: number;
  /** How fast {@link lateral} moved on the last step, metres a second: what turns and leans it. */
  readonly sway: number;
}

/** Every bot's drawn place, by id. Empty before the first step. */
export type PackLayout = ReadonlyMap<string, PackPlace>;

/**
 * A bot's shift on a frame `behindSeconds` before the newest tick of
 * `tickSeconds`: between the tick before's and the newest's, as the race place
 * is drawn back along the bot's speed.
 */
export function drawnShift(place: PackPlace, behindSeconds: number, tickSeconds: number): number {
  const back = tickSeconds > 0 ? Math.min(1, Math.max(0, behindSeconds / tickSeconds)) : 0;
  return place.shift + (place.shiftBefore - place.shift) * back;
}

/** A layout before the first step: every bot goes straight to its place. */
export const NO_PACK_LAYOUT: PackLayout = new Map();

/** `value` moved toward `target` by at most `most`. */
function toward(value: number, target: number, most: number): number {
  return value + Math.max(-most, Math.min(most, target - value));
}

/** Each racer's target: its row's shift and its place across. */
interface Target {
  readonly shift: number;
  readonly lateral: number;
}

/** The field in rows, front first: each row's racers in the order they ride. */
function rows(racers: readonly PackRacer[]): PackRacer[][] {
  const ordered = [...racers].sort((a, b) => b.along - a.along || (a.id < b.id ? -1 : 1));
  const built: PackRacer[][] = [];
  for (const racer of ordered) {
    const row = built[built.length - 1];
    const front = row?.[0];
    if (
      row !== undefined &&
      front !== undefined &&
      row.length < PACK_MOST_ABREAST &&
      front.along - racer.along <= PACK_ROW_METRES
    ) {
      row.push(racer);
    } else {
      built.push([racer]);
    }
  }
  return built;
}

/**
 * The places across one lane for a row's racers in it: side by side, centred
 * on the lane. The rider keeps theirs and takes the place nearest it; the bots
 * take the rest, left to right in the order they were across.
 */
function across(
  members: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
  lane: number,
): Map<string, number> {
  // Left to right as they were: the rider where they steered, a bot where it was drawn.
  const ordered = members
    .map((member) => ({
      member,
      was:
        member.id === riderId
          ? member.lateral
          : (previous.get(member.id)?.lateral ?? member.lateral),
    }))
    .sort((a, b) => a.was - b.was || (a.member.id < b.member.id ? -1 : 1));
  const count = ordered.length;
  const riderAt = ordered.findIndex(({ member }) => member.id === riderId);
  // Centred on the lane, or, with the rider among them, on the rider's own
  // place, so the rider keeps it and every bot is a full place from them.
  const first =
    riderAt < 0
      ? lane - ((count - 1) / 2) * PACK_ABREAST_METRES
      : (ordered[riderAt]?.member.lateral as number) - riderAt * PACK_ABREAST_METRES;
  const placed = new Map<string, number>();
  ordered.forEach(({ member }, at) => placed.set(member.id, first + at * PACK_ABREAST_METRES));
  return placed;
}

/** Every racer's target, the rider's row the anchor. */
function targets(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
): Map<string, Target> {
  const built = rows(racers);
  const riderRow = built.findIndex((row) => row.some((racer) => racer.id === riderId));
  // With no rider in the field, the front row is the anchor.
  const anchor = riderRow < 0 ? 0 : riderRow;
  const found = new Map<string, Target>();
  built.forEach((row, at) => {
    const shift = (anchor - at) * BIKE_LENGTH_METRES;
    const lanes = new Map<number, PackRacer[]>();
    for (const racer of row) {
      // The rider rides in the lane they steered nearest; a bot in its own.
      const lane = racer.id === riderId ? nearestLane(racer.lateral, row, riderId) : racer.lateral;
      lanes.set(lane, [...(lanes.get(lane) ?? []), racer]);
    }
    for (const [lane, members] of lanes) {
      for (const [id, lateral] of across(members, riderId, previous, lane)) {
        found.set(id, { shift, lateral });
      }
    }
  });
  return found;
}

/** The lane of a row's bot nearest the rider's place, or the rider's own place when no bot shares it. */
function nearestLane(riderLateral: number, row: readonly PackRacer[], riderId: string): number {
  let lane = riderLateral;
  let best = PACK_ABREAST_METRES * PACK_MOST_ABREAST;
  for (const racer of row) {
    if (racer.id === riderId) continue;
    const apart = Math.abs(racer.lateral - riderLateral);
    if (apart < best) {
      best = apart;
      lane = racer.lateral;
    }
  }
  return lane;
}

/**
 * The layout one tick of `elapsedSeconds` on: every bot's drawn place moved
 * toward its row's, at most {@link PACK_SIDEWAYS_METRES_PER_SECOND} across
 * and {@link PACK_CLOSE_UP_METRES_PER_SECOND} along. A bot new to the layout
 * starts at its row's place. The rider is laid out with the field and never
 * kept: their place is their own.
 *
 * @param racers - the field, the rider among them.
 * @throws {RangeError} for an elapsed time that is not finite or is below zero.
 */
export function stepPackLayout(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
  elapsedSeconds: number,
): PackLayout {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('a pack layout steps a finite number of seconds, 0 or more');
  }
  const wanted = targets(racers, riderId, previous);
  const next = new Map<string, PackPlace>();
  for (const racer of racers) {
    if (racer.id === riderId) continue;
    const was = previous.get(racer.id);
    // Off the line, a bot keeps its place on the grid until it is rolling:
    // the field's order changes by centimetres while it gets going, and a
    // place re-dealt for each would only shuffle it.
    const target =
      was !== undefined && racer.speed < PACK_ROLLING_METRES_PER_SECOND
        ? { shift: was.shift, lateral: was.lateral }
        : (wanted.get(racer.id) as Target);
    if (was === undefined) {
      next.set(racer.id, {
        shift: target.shift,
        shiftBefore: target.shift,
        lateral: target.lateral,
        sway: 0,
      });
      continue;
    }
    const lateral = toward(
      was.lateral,
      target.lateral,
      PACK_SIDEWAYS_METRES_PER_SECOND * elapsedSeconds,
    );
    // Back along the road no faster than it may give way: never backwards.
    const back = Math.min(
      PACK_CLOSE_UP_METRES_PER_SECOND,
      PACK_GIVE_WAY_SHARE * Math.max(0, racer.speed),
    );
    next.set(racer.id, {
      shift:
        target.shift < was.shift
          ? Math.max(target.shift, was.shift - back * elapsedSeconds)
          : Math.min(target.shift, was.shift + PACK_CLOSE_UP_METRES_PER_SECOND * elapsedSeconds),
      shiftBefore: was.shift,
      lateral,
      sway: elapsedSeconds > 0 ? (lateral - was.lateral) / elapsedSeconds : 0,
    });
  }
  return clear(racers, riderId, next, previous, elapsedSeconds);
}

/**
 * The layout with no two racers inside each other: front to back, a bot less
 * than {@link PACK_ABREAST_METRES} across from a racer ahead of it, and less
 * than {@link BIKE_LENGTH_METRES} behind, is in the way. A move that would put
 * it there waits, across or along, until the place is free; one already in
 * the way is drawn back toward a bike length behind, never faster than
 * {@link PACK_GIVE_WAY_SHARE} of its own speed, so it never goes backwards or
 * jumps. The rider is never moved.
 */
function clear(
  racers: readonly PackRacer[],
  riderId: string,
  layout: Map<string, PackPlace>,
  previous: PackLayout,
  elapsedSeconds: number,
): PackLayout {
  const rider = racers.find((racer) => racer.id === riderId);
  // Where every racer is while each bot is placed: the rider where they are,
  // a bot placed already where it was placed, and one still to place where it
  // was last tick, so a bot ahead never moves across into one level behind it.
  const where = new Map<string, { along: number; lateral: number }>();
  if (rider !== undefined) where.set(rider.id, { along: rider.along, lateral: rider.lateral });
  for (const racer of racers) {
    if (racer.id === riderId) continue;
    const was = previous.get(racer.id) ?? layout.get(racer.id);
    if (was !== undefined) {
      where.set(racer.id, { along: racer.along + was.shift, lateral: was.lateral });
    }
  }
  let placing = '';
  const blocking = (along: number, lateral: number) =>
    [...where].find(
      ([id, other]) =>
        id !== placing &&
        Math.abs(other.lateral - lateral) < PACK_ABREAST_METRES &&
        Math.abs(other.along - along) < BIKE_LENGTH_METRES,
    )?.[1];
  const fixed = [...where.values()];
  const bots = racers
    .filter((racer) => racer.id !== riderId)
    .map((racer) => ({ racer, place: layout.get(racer.id) as PackPlace }))
    .sort(
      (a, b) =>
        b.racer.along + b.place.shift - (a.racer.along + a.place.shift) ||
        (a.racer.id < b.racer.id ? -1 : 1),
    );
  for (const { racer, place } of bots) {
    placing = racer.id;
    const was = previous.get(racer.id);
    const { shiftBefore } = place;
    let { lateral, sway, shift } = place;
    if (was !== undefined && blocking(racer.along + shift, lateral) !== undefined) {
      // A move into a place that is taken waits: across first, then along,
      // then both, whichever leaves it clear; where none does, it is already
      // in someone's way, and gives way back toward a bike length behind.
      const tries = [
        { shift, lateral: was.lateral },
        { shift: Math.min(shift, was.shift), lateral },
        { shift: Math.min(shift, was.shift), lateral: was.lateral },
      ];
      const free = tries.find(
        (each) => blocking(racer.along + each.shift, each.lateral) === undefined,
      );
      if (free !== undefined) {
        ({ shift, lateral } = free);
      } else {
        // Nowhere free: the place furthest from anyone, then give way from it.
        const clearance = (each: { shift: number; lateral: number }): number =>
          Math.min(
            ...[...where]
              .filter(([id]) => id !== placing)
              .map(([, other]) =>
                Math.hypot(other.along - (racer.along + each.shift), other.lateral - each.lateral),
              ),
          );
        ({ shift, lateral } = [{ shift, lateral }, ...tries].reduce((best, each) =>
          clearance(each) > clearance(best) ? each : best,
        ));
        // What it may still give back this tick, less what it gave already.
        let room =
          PACK_GIVE_WAY_SHARE * Math.max(0, racer.speed) * elapsedSeconds -
          Math.max(0, was.shift - shift);
        for (let pass = 0; pass <= fixed.length && room > 0; pass += 1) {
          const ahead = blocking(racer.along + shift, lateral);
          if (ahead === undefined) break;
          const back = Math.min(room, racer.along + shift - (ahead.along - BIKE_LENGTH_METRES));
          if (!(back > 0)) break;
          shift -= back;
          room -= back;
        }
      }
      sway = elapsedSeconds > 0 ? (lateral - was.lateral) / elapsedSeconds : 0;
    }
    where.set(racer.id, { along: racer.along + shift, lateral });
    layout.set(racer.id, { shift, shiftBefore, lateral, sway });
  }
  return layout;
}
