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
 * Two bicycles are inside each other under {@link BIKE_LENGTH_METRES} apart
 * along and under {@link PACK_ABREAST_METRES} across: nose to tail on one line
 * as much as side by side. Once every bot has its place, one that would be
 * inside anyone is drawn instead at the place within its reach that is least
 * inside anyone, the rider first: held back, stepped aside, or both. A bot the
 * race has ahead of one it is held behind goes round it, up the side, as it
 * goes round the rider (the owner's ruling of 2026-11-13). The rider is never
 * moved.
 *
 * ## On the grid
 *
 * The owner's ruling of 2026-11-13 on #2544: the pack forms on the line. The
 * race lays the field out at the press (`ride-race.ts` §`startLapRaceRide`),
 * so through the countdown every bot already stands in its place, rows a bike
 * length apart and two or three abreast. Every racer is level on the line, and
 * level the rider is laid out last: theirs is the back row, so the grid stands
 * from the rider's line forward and no bot is drawn behind the race's start.
 * Off the line a bot keeps its grid place until it is rolling
 * ({@link PACK_ROLLING_METRES_PER_SECOND}), unless it is in the rider's line
 * and its row is making way, when it eases aside; and from there it gives way
 * no faster than {@link PACK_GIVE_WAY_SHARE} of its own speed, so its drawn
 * place goes forward from Go on and no bot stands still waiting for its place.
 *
 * ## Never a jump
 *
 * A row changes when the order does, and a lane when a bot steers. So every
 * bot's drawn place moves toward its row's at most
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND} across, the rider's own steering
 * speed, and {@link PACK_CLOSE_UP_METRES_PER_SECOND} along. Its sideways speed
 * goes to the drawing with it, which turns and leans the bicycle into the move
 * (#2456's `lane-change-lean.ts`). Keeping clear of another racer may give way
 * faster, up to {@link PACK_GIVE_WAY_SHARE} of the bot's own speed, so no bot
 * is drawn going backwards to get out of anyone's way (#2558's review). And
 * every change in how fast a bot's drawn place moves against its race place,
 * the row step's and keeping clear alike, is eased in at no more than
 * {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED}: a bot slows to give way and
 * speeds up to close up over ticks, never from one tick to the next. The
 * layout is stepped with the race, a tick at a time: a pure function of the
 * field and the layout before.
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
 * The fastest a bot's drawn speed changes against its race speed, metres a
 * second squared: **40**, two metres a second a tick. A bot slows to give way
 * and speeds up to close up again over ticks: drawn at its full give-way on
 * one tick and closing up on the next, a bot held behind the rider was drawn
 * at 1.4 m/s and 16 m/s on alternate ticks (#2558's review, finding A).
 *
 * It is as low as keeps the rider out of every bot. It was 80 until a bot a
 * place across from the rider stopped being scored as inside them by a
 * rounding ({@link PACK_ROUNDING_METRES}, finding H): before that, at 60 or
 * 40 a bot in front of a rider winding up through a field with items on could
 * not get out of their way in time (`pack-layout.test.ts`, "sees a pass
 * coming"). At 30, a bot the rider steers into cannot step forward out of
 * their way at {@link PACK_CLOSE_UP_METRES_PER_SECOND} within the tick, and
 * the known limit off the line runs past 3 s; at 20, a bot held behind the
 * rider at race speed is drawn giving way and closing up on alternate ticks
 * again. A rider brakes at 3 to 5 m/s², so this is still a firm brake: a bot
 * gives back 10 m/s over a quarter of a second rather than an eighth. On a
 * 10-seed probe of 120 s rides in a pack, steady, steering and surging, no
 * bot was drawn under half its race speed on one tick and over it on the
 * next, against 33 at 80.
 */
export const PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED = 40;

/**
 * The speed below which a bot keeps the place it was laid out in, metres a
 * second: **3**, the field still getting off the line.
 */
export const PACK_ROLLING_METRES_PER_SECOND = 3;

/**
 * How far ahead a pass is seen coming, seconds of the closing speed: **0.25**,
 * the time a bot takes to move two places across at
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND}, so a bot is aside before the rider
 * reaches it.
 */
const PACK_MAKE_WAY_SECONDS = (2 * PACK_ABREAST_METRES) / PACK_SIDEWAYS_METRES_PER_SECOND;

/** What is added to that look-ahead, metres: **0.5**, a frame's drawing and a row's closing-up. */
const PACK_MAKE_WAY_MARGIN_METRES = 0.5;

/** One racer as the layout reads it. */
export interface PackRacer {
  readonly id: string;
  /** Its place in the race, metres: effort distance plus race offset, the rider's and the bots' alike. */
  readonly along: number;
  /** Its lane's place across the road, metres (`in-view.ts` §`laneLateral`); the rider's steered place. */
  readonly lateral: number;
  /**
   * Its speed, metres a second: how fast its drawn place may give way, and,
   * the rider's beside a bot's, whether the two are closing (#2544).
   */
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
  /** Whether its row is making way for the rider passing it, or passing the rider. */
  readonly makingWay: boolean;
}

/**
 * The field in rows, front first: each row's racers in the order they ride.
 * Level, the rider is last, so on the line theirs is the grid's back row.
 */
function rows(racers: readonly PackRacer[], riderId: string): PackRacer[][] {
  const last = (racer: PackRacer): number => (racer.id === riderId ? 1 : 0);
  const ordered = [...racers].sort(
    (a, b) => b.along - a.along || last(a) - last(b) || (a.id < b.id ? -1 : 1),
  );
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
  // Left to right as they were: the rider where they steered, a bot where it
  // was drawn. Bots level with the rider across, as a grid's are on the line,
  // go half to the rider's left and half to their right.
  const bots = members
    .filter((member) => member.id !== riderId)
    .map((member) => ({ member, was: previous.get(member.id)?.lateral ?? member.lateral }))
    .sort((a, b) => a.was - b.was || (a.member.id < b.member.id ? -1 : 1));
  const rider = members.find((member) => member.id === riderId);
  const ordered = [...bots];
  if (rider !== undefined) {
    const left = bots.filter(({ was }) => was < rider.lateral).length;
    const level = bots.filter(({ was }) => was === rider.lateral).length;
    ordered.splice(left + Math.floor(level / 2), 0, { member: rider, was: rider.lateral });
  }
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

/**
 * Whether a row the rider is not in is passing the rider, or being passed:
 * one of its bots drawn level with the rider, or closing on them fast enough
 * to be level within {@link PACK_MAKE_WAY_SECONDS} and a margin. Closing is
 * the two speeds and the row's drawn shift moving toward the rider's.
 */
function passing(
  row: readonly PackRacer[],
  rider: PackRacer,
  shift: number,
  previous: PackLayout,
): boolean {
  return row.some((racer) => {
    if (racer.id === rider.id) return false;
    const was = previous.get(racer.id)?.shift ?? shift;
    const gap = racer.along + was - rider.along;
    const shifting = Math.sign(shift - was) * PACK_CLOSE_UP_METRES_PER_SECOND;
    const closing = -Math.sign(gap) * (racer.speed + shifting - rider.speed);
    return (
      Math.abs(gap) <= BIKE_LENGTH_METRES ||
      (closing > 0 &&
        Math.abs(gap) - BIKE_LENGTH_METRES <
          closing * PACK_MAKE_WAY_SECONDS + PACK_MAKE_WAY_MARGIN_METRES)
    );
  });
}

/**
 * Every racer's target, the rider's row the anchor. On the `grid`, every row
 * ahead of the rider's leaves them a way through.
 */
function targets(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
  grid: boolean,
): Map<string, Target> {
  const built = rows(racers, riderId);
  const riderRow = built.findIndex((row) => row.some((racer) => racer.id === riderId));
  const rider = built[riderRow]?.find((racer) => racer.id === riderId);
  // With no rider in the field, the front row is the anchor.
  const anchor = riderRow < 0 ? 0 : riderRow;
  const found = new Map<string, Target>();
  built.forEach((row, at) => {
    const shift = (anchor - at) * BIKE_LENGTH_METRES;
    // A row passing the rider, or being passed, is laid out across as if the
    // rider rode in it: its bots ease aside and leave the rider their place,
    // so every pass goes round (the owner's ruling of 2026-11-13 on #2544).
    const makingWay = rider !== undefined && (grid || passing(row, rider, shift, previous));
    const laid = makingWay && rider !== undefined && at !== riderRow ? [...row, rider] : row;
    const lanes = new Map<number, PackRacer[]>();
    for (const racer of laid) {
      // The rider rides in the lane they steered nearest; a bot in its own.
      const lane = racer.id === riderId ? nearestLane(racer.lateral, laid, riderId) : racer.lateral;
      lanes.set(lane, [...(lanes.get(lane) ?? []), racer]);
    }
    for (const [lane, members] of lanes) {
      for (const [id, lateral] of across(members, riderId, previous, lane)) {
        found.set(id, { shift, lateral, makingWay });
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
 * The field laid out on the line, before anyone has moved (#2544, the owner's
 * ruling of 2026-11-13): rows a bike length apart, the rider's the back row,
 * and every row ahead of it two or three abreast either side of the rider's
 * line, so the rider rides off the line between them and no bot need move
 * aside while it is still getting going.
 */
export function gridPackLayout(racers: readonly PackRacer[], riderId: string): PackLayout {
  const wanted = targets(racers, riderId, NO_PACK_LAYOUT, true);
  const grid = new Map<string, PackPlace>();
  for (const racer of racers) {
    const place = wanted.get(racer.id);
    if (racer.id === riderId || place === undefined) continue;
    grid.set(racer.id, {
      shift: place.shift,
      shiftBefore: place.shift,
      lateral: place.lateral,
      sway: 0,
    });
  }
  return grid;
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
  const wanted = targets(racers, riderId, previous, false);
  const rider = racers.find((racer) => racer.id === riderId);
  const next = new Map<string, PackPlace>();
  for (const racer of racers) {
    if (racer.id === riderId) continue;
    const was = previous.get(racer.id);
    // Off the line, a bot keeps its place on the grid until it is rolling:
    // the field's order changes by centimetres while it gets going, and a
    // place re-dealt for each would only shuffle it. But a bot in the rider's
    // line, its row making way for them, still eases aside, away from the
    // rider: a rider who steers into a bot still getting going finds it
    // making way (#2558's review, finding 3).
    const wants = wanted.get(racer.id) as Target;
    const easesAside =
      rider !== undefined &&
      wants.makingWay &&
      was !== undefined &&
      Math.abs(was.lateral - rider.lateral) < PACK_ABREAST_METRES &&
      Math.abs(wants.lateral - rider.lateral) > Math.abs(was.lateral - rider.lateral);
    const target =
      was !== undefined && racer.speed < PACK_ROLLING_METRES_PER_SECOND
        ? { shift: was.shift, lateral: easesAside ? wants.lateral : was.lateral }
        : wants;
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
    next.set(racer.id, {
      shift: shiftToward(racer, was, target.shift, elapsedSeconds),
      shiftBefore: was.shift,
      lateral,
      sway: elapsedSeconds > 0 ? (lateral - was.lateral) / elapsedSeconds : 0,
    });
  }
  return clear(racers, riderId, next, previous, elapsedSeconds);
}

/**
 * How fast a bot's drawn place goes back along the road to its row's when it
 * drops a row, metres a second: {@link PACK_GIVE_WAY_SHARE} of its speed, and
 * never more than {@link PACK_CLOSE_UP_METRES_PER_SECOND}. The row step's
 * rate only: keeping clear of another racer may give way faster, up to
 * {@link PACK_GIVE_WAY_SHARE} of its speed (§`clearOf`). Both are eased into
 * at {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED}.
 */
function giveWay(racer: PackRacer): number {
  return Math.min(PACK_CLOSE_UP_METRES_PER_SECOND, PACK_GIVE_WAY_SHARE * Math.max(0, racer.speed));
}

/**
 * The rates a bot's drawn shift may move at over a tick, metres a second:
 * within {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED} of the rate it
 * moved at over the tick before, no faster than
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} forward, and back no faster than
 * `back`, nor than {@link PACK_GIVE_WAY_SHARE} of its speed, which comes
 * first, so it is never drawn going backwards. A bot easing back from a
 * faster give-way than `back` eases back at the ease.
 */
function shiftRates(
  racer: PackRacer,
  was: PackPlace,
  back: number,
  elapsedSeconds: number,
): { readonly least: number; readonly most: number } {
  const rate = elapsedSeconds > 0 ? (was.shift - was.shiftBefore) / elapsedSeconds : 0;
  const ease = PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED * elapsedSeconds;
  const forward = -PACK_GIVE_WAY_SHARE * Math.max(0, racer.speed);
  const least = Math.max(forward, Math.min(rate + ease, Math.max(rate - ease, -back)));
  const most = Math.max(least, Math.min(rate + ease, PACK_CLOSE_UP_METRES_PER_SECOND));
  return { least, most };
}

/**
 * A bot's shift a tick on, toward its row's, as fast as {@link shiftRates}
 * allows. Arriving needs no braking of its own: the row step's rates are
 * within {@link PACK_CLOSE_UP_METRES_PER_SECOND} either way, so stopping from
 * either is inside the ease.
 */
function shiftToward(
  racer: PackRacer,
  was: PackPlace,
  target: number,
  elapsedSeconds: number,
): number {
  if (elapsedSeconds <= 0) return was.shift;
  const { least, most } = shiftRates(racer, was, giveWay(racer), elapsedSeconds);
  const wants = (target - was.shift) / elapsedSeconds;
  return was.shift + Math.max(least, Math.min(most, wants)) * elapsedSeconds;
}

/** A racer as drawn while the field is cleared: its drawn place, and its place in the race. */
interface Drawn {
  readonly along: number;
  readonly lateral: number;
  /** Its race place, metres: who the race has ahead. */
  readonly race: number;
  /**
   * Where it is drawn along on the frames back toward the tick before, at the
   * far end, metres: its race place a tick back along its speed and its shift
   * before. The frames between two ticks draw it there and at its new place
   * across, so a move across is clear on them too only if it is clear here.
   */
  readonly before: number;
}

/**
 * How far under a bike length along, or under a place across, two drawn
 * bicycles may be and still be clear, metres: **1e-9**, a nanometre. Places
 * are added up in floating point, and a bot laid out a place across from the
 * rider at −1.75 m is at −2.3 m, which is `0.5499999999999998` apart: without
 * this, that bot scored as inside the rider by about 1e-16, and, the score
 * read in order, gave way or held behind them as if it were in their way. A
 * bot was drawn 2.5 m behind the rider for 13 s while the race had it moving
 * up to 13.8 m ahead (#2558's review, finding H). A nanometre is far under
 * anything drawn, and far over the rounding in adding up a place.
 */
const PACK_ROUNDING_METRES = 1e-9;

/**
 * How far two drawn bicycles are inside each other: how far they are under a
 * bike length apart along, times how far under a place apart across, square
 * metres, each within {@link PACK_ROUNDING_METRES}. Nought is clear; it
 * shrinks as either moves off the other, so a step aside counts before the
 * two are clear.
 */
function overlap(
  one: { along: number; lateral: number },
  other: { along: number; lateral: number },
): number {
  return (
    Math.max(0, BIKE_LENGTH_METRES - PACK_ROUNDING_METRES - Math.abs(one.along - other.along)) *
    Math.max(0, PACK_ABREAST_METRES - PACK_ROUNDING_METRES - Math.abs(one.lateral - other.lateral))
  );
}

/** One place a bot may be drawn on this tick. */
interface Candidate {
  readonly shift: number;
  readonly lateral: number;
}

/**
 * How far ahead a bot sees the rider coming, seconds: **0.1**, two ticks;
 * {@link PACK_MAKE_WAY_SECONDS}, the time it takes to move two places across;
 * and **0.45**. A bot the rider would be inside by then moves already, so the
 * rider, who may close faster than a bot may move, does not reach it, and a
 * bot does not cross the rider's line just ahead of them.
 *
 * The 0.45 s is for a line of bots coming up on the rider, each a bike length
 * behind the one before. Easing in its give-way
 * ({@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED}), the front one cannot
 * wait for the rider to be 0.25 s away and then give way into the bot behind
 * it: seen 0.45 s on, the one behind gives way too, and the two ease back
 * together. Without it, a bot was drawn 5.6 cm inside the rider (a 120 s ride
 * at 8 m/s, seed 7). It was chosen on a probe of 24 seeds: 0.4 s let two bots
 * be drawn 6 cm inside each other between ticks, and 0.5 s let two be drawn
 * 15 cm inside each other winding up off the line (seed 4).
 */
const PACK_SEEN_AHEAD_SECONDS = [0.1, PACK_MAKE_WAY_SECONDS, 0.45] as const;

/**
 * How far past a bike length a place a bot holds clear of the rider is, metres:
 * **1 mm**, so that a place a bike length on is clear of the rounding in
 * adding up where each is.
 */
const PACK_CLEAR_METRES = 0.001;

/**
 * A place's score, the lower the better, in order: how far inside the rider,
 * inside any bot, and inside the rider a moment on, and how far it moved.
 */
type Score = readonly [number, number, number, number];

/**
 * Whether `each` scores better than `best`: the first term that differs
 * decides. Grouped so that a worse place never wins on a difference that is
 * merely not nought (#2558's review, finding 4).
 */
function better(each: Score, best: Score): boolean {
  return (each[0] - best[0] || each[1] - best[1] || each[2] - best[2] || each[3] - best[3]) < 0;
}

/**
 * How many times the field is gone through front to back each tick: **2**.
 * The second time, a bot ahead sees where the bots behind it went, and can
 * make room for one that had to move toward it.
 */
const PACK_CLEARING_PASSES = 2;

/**
 * The layout with no two racers inside each other (#2544): front to back,
 * each bot is drawn at the place, within the tick's reach, that is least
 * inside anyone. Its reach is what it may move in a tick:
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND} across, and along no faster than
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} forward or {@link PACK_GIVE_WAY_SHARE}
 * of its speed back, so it never jumps and never goes backwards (#2558's
 * review, finding 1), and within
 * {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED} of how fast it moved on
 * the tick before, so it is never drawn slowing and speeding up again on
 * alternate ticks (finding A). Inside the rider counts first, since the rider is
 * never moved; then inside a bot, each on this tick and on the frames drawn
 * back to the tick before; then inside the rider
 * {@link PACK_SEEN_AHEAD_SECONDS} on; then the least move from the place it
 * was laid out in.
 * Two bicycles are inside each other under a bike length along and under a
 * place across, so two nose to tail on one line are as inside each other as
 * two side by side (#2558's review, finding 2).
 *
 * A bot the race has ahead of a racer it is drawn held up behind goes round
 * it: it steps aside toward a place beside it, where that is free, and then
 * comes past up the side, as a bot passes the rider (the owner's ruling of
 * 2026-11-13 on #2544).
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
  const where = new Map<string, Drawn>();
  for (const racer of racers) {
    if (racer.id === riderId) {
      where.set(racer.id, {
        along: racer.along,
        lateral: racer.lateral,
        race: racer.along,
        before: racer.along - racer.speed * elapsedSeconds,
      });
      continue;
    }
    const was = previous.get(racer.id) ?? layout.get(racer.id);
    if (was !== undefined) {
      where.set(racer.id, {
        along: racer.along + was.shift,
        lateral: was.lateral,
        race: racer.along,
        before: racer.along - racer.speed * elapsedSeconds + was.shift,
      });
    }
  }
  const bots = racers
    .filter((racer) => racer.id !== riderId)
    .map((racer) => ({ racer, place: layout.get(racer.id) as PackPlace }))
    .sort(
      (a, b) =>
        b.racer.along + b.place.shift - (a.racer.along + a.place.shift) ||
        (a.racer.id < b.racer.id ? -1 : 1),
    );
  const across = PACK_SIDEWAYS_METRES_PER_SECOND * elapsedSeconds;
  for (let pass = 0; pass < PACK_CLEARING_PASSES; pass += 1) {
    for (const { racer, place } of bots) {
      const was = previous.get(racer.id);
      if (was === undefined) continue;
      const placed = clearOf(
        racer,
        place,
        layout.get(racer.id) as PackPlace,
        was,
        where,
        rider,
        across,
        elapsedSeconds,
      );
      where.set(racer.id, {
        along: racer.along + placed.shift,
        lateral: placed.lateral,
        race: racer.along,
        before: racer.along - racer.speed * elapsedSeconds + was.shift,
      });
      layout.set(racer.id, {
        shift: placed.shift,
        shiftBefore: place.shiftBefore,
        lateral: placed.lateral,
        sway: elapsedSeconds > 0 ? (placed.lateral - was.lateral) / elapsedSeconds : 0,
      });
    }
  }
  return layout;
}

/**
 * One bot's place this tick, clear of everyone in `where` as far as its reach
 * allows: where it is placed so far (`current`) when that is clear, and
 * otherwise the best place within reach of where it was (`was`), the least
 * move from where it was laid out (`place`).
 */
function clearOf(
  racer: PackRacer,
  place: PackPlace,
  current: Candidate,
  was: PackPlace,
  where: ReadonlyMap<string, Drawn>,
  rider: PackRacer | undefined,
  across: number,
  elapsedSeconds: number,
): Candidate {
  const others = [...where].filter(([id]) => id !== racer.id).map(([, other]) => other);
  const drawnAt = (each: Candidate) => ({ along: racer.along + each.shift, lateral: each.lateral });
  // On the frames drawn back toward the tick before, a bot is drawn at its
  // shift before but already at its new place across: a move across is clear
  // there only if it is clear of where the other is drawn there.
  const before = racer.along - racer.speed * elapsedSeconds + was.shift;
  const insideBefore = (
    each: Candidate,
    other: Drawn,
    moving = each.lateral !== was.lateral,
  ): number =>
    moving
      ? overlap(
          { along: before, lateral: each.lateral },
          { along: other.before, lateral: other.lateral },
        )
      : 0;
  // Inside the rider: on this tick, and on the frames back to the tick
  // before. And soon to be: a moment on, each racer at its own speed.
  const riderDrawn = rider === undefined ? undefined : where.get(rider.id);
  const insideRider = (each: Candidate): number =>
    rider === undefined || riderDrawn === undefined
      ? 0
      : overlap(drawnAt(each), rider) + insideBefore(each, riderDrawn, true);
  const riderSoon = (each: Candidate): number =>
    rider === undefined
      ? 0
      : PACK_SEEN_AHEAD_SECONDS.reduce(
          (sum, seconds) =>
            sum +
            overlap(
              { along: racer.along + each.shift + racer.speed * seconds, lateral: each.lateral },
              { along: rider.along + rider.speed * seconds, lateral: rider.lateral },
            ),
          0,
        );
  const insideAny = (each: Candidate): number =>
    others.reduce(
      (sum, other) => sum + overlap(drawnAt(each), other) + insideBefore(each, other),
      0,
    );
  const now = { shift: place.shift, lateral: place.lateral };
  const moved = (each: Candidate): number =>
    Math.abs(each.shift - now.shift) + Math.abs(each.lateral - now.lateral);
  // Each place is scored once (#2558's review, finding E): out of the rider's
  // way first, since the rider is never moved; then out of every bot's; then
  // out of the rider's way a moment on; then the least move.
  const score = (each: Candidate): Score => [
    insideRider(each),
    insideAny(each),
    riderSoon(each),
    moved(each),
  ];
  let chosen: Candidate = { shift: current.shift, lateral: current.lateral };
  let chosenScore = score(chosen);
  if (chosenScore[0] === 0 && chosenScore[1] === 0 && chosenScore[2] === 0) return chosen;
  // Within reach: along, from as far back as it may give way to keep clear,
  // PACK_GIVE_WAY_SHARE of its speed so it is still drawn going forward, to
  // as far on as it may close up, each eased from the tick before's;
  // across, a step either way.
  const rates = shiftRates(racer, was, Number.POSITIVE_INFINITY, elapsedSeconds);
  const least = was.shift + rates.least * elapsedSeconds;
  const most = was.shift + rates.most * elapsedSeconds;
  const reach = (shift: number): number => Math.min(most, Math.max(least, shift));
  const near = others.filter(
    (other) => overlap(drawnAt(now), other) > 0 || overlap(drawnAt(was), other) > 0,
  );
  // Along: where it was laid out, where it was, as far back and as far on as
  // it may go, a bike length either side of each racer near it, and a bike
  // length either side of where the rider will be a moment on, so a bot
  // caught behind the rider holds there at the rider's speed (#2558's review,
  // finding A). Across: where it was laid out, where it was, and a step
  // toward a place either side of each racer near it.
  const shifts = [
    now.shift,
    Math.min(now.shift, was.shift),
    least,
    most,
    ...near.flatMap((other) =>
      [-1, 1].map((side) => other.along + side * BIKE_LENGTH_METRES - racer.along),
    ),
    ...(rider === undefined
      ? []
      : PACK_SEEN_AHEAD_SECONDS.flatMap((seconds) =>
          [-1, 1].map(
            (side) =>
              rider.along +
              (rider.speed - racer.speed) * seconds +
              side * (BIKE_LENGTH_METRES + PACK_CLEAR_METRES) -
              racer.along,
          ),
        )),
  ].map(reach);
  // Many places are the same once within reach, most of all in a pile-up,
  // where each would be scored again for nothing (#2558's review, finding L).
  // The first of each is kept, so the place chosen is the same.
  const alongs = [...new Set(shifts)];
  const laterals = [
    ...new Set([
      now.lateral,
      was.lateral,
      ...near.flatMap((other) =>
        [-1, 1].map((side) =>
          toward(was.lateral, other.lateral + side * PACK_ABREAST_METRES, across),
        ),
      ),
    ]),
  ];
  for (const shift of alongs) {
    for (const lateral of laterals) {
      const each = { shift, lateral };
      const scored = score(each);
      if (better(scored, chosenScore)) {
        chosen = each;
        chosenScore = scored;
      }
    }
  }
  // Held up behind a racer the race has it ahead of: it goes round, a step
  // toward the place beside it, when that is no more inside anyone than
  // being held.
  const holding = near.find(
    (other) =>
      other.race < racer.along &&
      other.along > racer.along + chosen.shift &&
      overlap(drawnAt(now), other) > 0,
  );
  if (holding !== undefined && chosen.shift < now.shift) {
    const first = Math.sign(was.lateral - holding.lateral) || 1;
    const held = chosen;
    const [heldRider, heldAny] = chosenScore;
    const round = [first, -first]
      .map((side) => ({
        shift: held.shift,
        lateral: toward(was.lateral, holding.lateral + side * PACK_ABREAST_METRES, across),
      }))
      .find((each) => insideRider(each) <= heldRider && insideAny(each) <= heldAny);
    if (round !== undefined) chosen = round;
  }
  return chosen;
}
