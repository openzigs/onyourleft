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
 * ## A lap apart, on a loop
 *
 * Rows are laid out in race places, so a bot a lap down rides in a row far
 * behind the rider's. But the scene draws every bot on the lap of the road the
 * frame shows (`scene.ts` §`onTheCorridorsLap`, #2516), so that bot stands on
 * the road beside the rider and the bots on the rider's lap. Given the lap
 * ({@link stepPackLayout}'s `lapMetres`), how far apart two racers are along
 * the road reads to the other's nearest place on the loop where a row is
 * passing the rider, where a bot is inside the rider or soon will be, and on
 * the frames between ticks; a bot a lap apart from the rider may step to a
 * place beside them; and two bots a lap apart that close on each other in one
 * place across are laid out a place apart (§`aLapApart`), so the one coming
 * up goes round rather than being held behind. Riders never ghost through
 * each other (the owner's ruling on #2544). A field on one lap is laid out
 * exactly as without the lap.
 *
 * ## Never a jump
 *
 * A row changes when the order does, and a lane when a bot steers. So every
 * bot's drawn place moves toward its row's at most
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND} across, a real rider's change of
 * line, its sideways speed eased in and out at no more than
 * {@link PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED} (#2665: it was the
 * rider's 4.375 m/s steering speed, from nought in one tick), and
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} along. Its sideways speed goes to the
 * drawing with it, which turns and leans the bicycle into the move (#2456's
 * `lane-change-lean.ts`), and the frames between two ticks draw its place and
 * its sideways speed between the two ({@link drawnLateral}, {@link drawnSway}),
 * as they draw its shift. A racer joins a row within {@link PACK_ROW_METRES}
 * of its front and leaves it only past {@link PACK_ROW_LEAVE_METRES}, so a
 * racer riding near the threshold does not change rows, and so places across,
 * tick by tick. Keeping clear of another racer may give way
 * faster, up to {@link PACK_GIVE_WAY_SHARE} of the bot's own speed, so no bot
 * is drawn going backwards to get out of anyone's way (#2558's review). And
 * every change in how fast a bot's drawn place moves against its race place,
 * the row step's and keeping clear alike, is eased in at no more than
 * {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED}: a bot slows to give way and
 * speeds up to close up over ticks, never from one tick to the next. The
 * layout is stepped with the race, a tick at a time: a pure function of the
 * field and the layout before.
 *
 * ## Through an item's effects
 *
 * An item moves a racer's race offset at up to 2 m/s for 4 s (`items.ts`),
 * and the offset drifts back after. That rate is in the speed each bot is
 * read at, so the frames between ticks draw a bot an item is moving where the
 * layout cleared it (#2665): before, they drew it back along its effort speed
 * alone, up to a tick's worth of the push off, and bots on the same lap were
 * drawn inside each other on hundreds of frames a race with items on, up to a
 * place across (#2636). And a row step counts an item's push toward its own
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} and give-way, never on top of them
 * (§`shiftToward`).
 *
 * ## In single file, for a group ride
 *
 * A group ride's line (#3304, ADR 0101 D-3.3) is laid out by the same step
 * with `singleFile` set, and a race's layout is exactly as it was without it.
 * Every racer of the line is a row of its own, so the line is drawn nose to
 * tail in one lane, each a bike length and its wheel gap behind the one
 * ahead. Two of the line change order only once one is
 * {@link LINE_PASS_METRES} past the other, so a rider who rides a little over
 * the wheel ahead is not dealt a new row each tick; while they overlap, the
 * bot is laid out a place beside the rider, as a race's is.
 *
 * A racer **beside** the line ({@link PackRacer.beside}: the one who has
 * pulled off) is no row. It is drawn level with the racer of the line it is
 * level with on the road, and between two of them as far along as it is
 * between them on the road, so it drifts back smoothly past a line that
 * keeps its shape; ahead of the front or behind the last it is a whole row
 * clear once it is {@link LINE_CLEAR_METRES} clear on the road, which is
 * where it left the line and where it rejoins it. When the rider is the one
 * beside, the rider is still never moved: the line is laid out about them.
 */

import { SIDEWAYS_METRES_PER_SECOND } from '../lanes';

/**
 * A road bicycle and its rider, front wheel to back, metres: **1.75**. What a
 * wheel gap leaves out (#2544).
 */
export const BIKE_LENGTH_METRES = 1.75;

/**
 * How far behind the front of a row, on effort distance, a racer may be and
 * join it, metres: **1.4**, two of #2542's 0.65 m wheel gaps and a little over.
 */
export const PACK_ROW_METRES = 1.4;

/**
 * How far behind the front of the row it rode in on the tick before a racer
 * may be and stay in it, metres: **2** (#2665). Over {@link PACK_ROW_METRES},
 * so a racer whose wheel gap breathes about the join threshold keeps its row,
 * and its place across, rather than changing both tick by tick.
 */
export const PACK_ROW_LEAVE_METRES = 2;

/** The most racers a row holds side by side: **3**. */
export const PACK_MOST_ABREAST = 3;

/**
 * How far apart two racers sharing a lane ride side by side, centre to
 * centre, metres: **0.55**, a pair of handlebars and a hand between. Three of
 * them span 1.1 m, inside the 1.75 m lane.
 */
export const PACK_ABREAST_METRES = 0.55;

/**
 * The fastest a bot's drawn place moves across the road, metres a second:
 * **1.4**, a real rider's change of line (#2665, the issue's 1.2 to 1.5). It
 * was the rider's own steering speed, 4.375 m/s, three or four times a real
 * rider's; the rider still steers at that (`lanes.ts`).
 */
export const PACK_SIDEWAYS_METRES_PER_SECOND = 1.4;

/**
 * The fastest a bot's sideways speed changes, metres a second squared:
 * **1.75** (#2665, the issue's 1.5 to 2). A bot eases into a move across and
 * out of it, and reaches {@link PACK_SIDEWAYS_METRES_PER_SECOND} after 0.8 s:
 * before #2665 it went from nought to full speed in one tick, 87.5 m/s².
 */
export const PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED = 1.75;

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
 * The fastest a bot may move across to keep out of the rider or another bot
 * where nothing within its eased reach is clear, metres a second: **4.375**,
 * the rider's own steering speed, which every bot moved at before #2665. Only
 * then: a bot that can keep clear at {@link PACK_SIDEWAYS_METRES_PER_SECOND},
 * eased, does.
 */
export const PACK_CLEAR_SIDEWAYS_METRES_PER_SECOND = 4.375;

/**
 * How long a bot at rest takes to move `metres` across and stop there, eased
 * in and out: seconds.
 */
function secondsAcross(metres: number): number {
  const speed = PACK_SIDEWAYS_METRES_PER_SECOND;
  const ease = PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED;
  // Long enough to reach full speed: speeding up, cruising, slowing; else a ramp up and down.
  return metres >= (speed * speed) / ease
    ? metres / speed + speed / ease
    : 2 * Math.sqrt(metres / ease);
}

/**
 * How far ahead a pass is seen coming, seconds of the closing speed: the time
 * a bot takes to move two places across from rest at
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND}, eased in and out (#2665): **1.59**,
 * so a bot is aside before the rider reaches it. It was 0.25 at the rider's
 * steering speed and no easing.
 */
const PACK_MAKE_WAY_SECONDS = secondsAcross(2 * PACK_ABREAST_METRES);

/** What is added to that look-ahead, metres: **0.5**, a frame's drawing and a row's closing-up. */
const PACK_MAKE_WAY_MARGIN_METRES = 0.5;

/**
 * In single file, how far past another of the line a racer is on the road
 * before the two change rows, metres: **0.5**, a wheel gap. Under it they
 * keep the order they were drawn in (#3304). Proposed; a feel parameter.
 */
export const LINE_PASS_METRES = 0.5;

/**
 * In single file, how far ahead of the line's front, or behind its last
 * racer, a racer beside the line is on the road when it is drawn a whole row
 * clear of it, metres: **0.3**, the nearest a bot holds a wheel
 * (`@onyourleft/domain` §`BOT_TACTIC_WHEEL_NEAREST_METRES`), so a bot that
 * pulls off the front of a held wheel starts a whole row ahead (#3304).
 */
export const LINE_CLEAR_METRES = 0.3;

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
  /**
   * The rider's alone: the place across they are steering to, which they move
   * to at `lanes.ts` §`SIDEWAYS_METRES_PER_SECOND` (#2665). A bot moves across
   * at a rider's pace, eased, and is drawn moving on every frame, so it looks
   * where the rider is going, not only where they are. Absent, where they are.
   */
  readonly heading?: number | undefined;
  /**
   * The rider's alone: where they were across a tick before, which the frames
   * between two ticks draw them back toward (#2665). Absent, where they are.
   */
  readonly lateralBefore?: number | undefined;
  /**
   * Its place in the race a tick before, metres (#2665): how far it truly went
   * over the tick, which a bot speeding up off the line went less than its
   * speed now says. A bot gives way no faster than a share of that, so it is
   * never drawn going backwards. Absent, its speed is taken.
   */
  readonly alongBefore?: number | undefined;
  /**
   * How fast its race offset moved over the tick, metres a second (#2636): an
   * item's effect, a tailwind, a tow, a puddle or a gust, or the drift back
   * after one. Already in {@link speed}; read again here so a row step does
   * not add its own close-up on top of an item's push (§`shiftToward`).
   * Absent, nought, as with items off.
   */
  readonly offsetRate?: number | undefined;
  /**
   * In single file only (#3304): whether it rides beside the line and not in
   * it, as the one who has pulled off does. It is no row of the line's.
   * Absent, in the line.
   */
  readonly beside?: boolean | undefined;
}

/** Where the layout draws one bot, against where the race has it. */
export interface PackPlace {
  /**
   * The shift its row was laid out at on this tick: two racers with the same
   * were in one row, which {@link PACK_ROW_LEAVE_METRES} keeps them in (#2665).
   */
  readonly rowShift: number;
  /**
   * The place across its row laid it out at on this tick, which it moves
   * toward: a lane's bots keep the middle theirs shared (#2665).
   */
  readonly aim: number;
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
  /**
   * {@link lateral} a tick before: a frame between two ticks draws it between
   * the two (#2665), as it draws the shift, so a bot moving across moves on
   * every frame rather than a tick's worth on one in three.
   */
  readonly lateralBefore: number;
  /** How fast {@link lateral} moved on the last step, metres a second: what turns and leans it. */
  readonly sway: number;
  /** {@link sway} a tick before, which the frames between two ticks blend from (#2665). */
  readonly swayBefore: number;
}

/** Every bot's drawn place, by id. Empty before the first step. */
export type PackLayout = ReadonlyMap<string, PackPlace>;

/**
 * A bot's shift on a frame `behindSeconds` before the newest tick of
 * `tickSeconds`: between the tick before's and the newest's, as the race place
 * is drawn back along the bot's speed.
 */
export function drawnShift(place: PackPlace, behindSeconds: number, tickSeconds: number): number {
  return place.shift + (place.shiftBefore - place.shift) * backBy(behindSeconds, tickSeconds);
}

/**
 * A bot's place across the road on a frame `behindSeconds` before the newest
 * tick of `tickSeconds`: between the tick before's and the newest's, as
 * {@link drawnShift} draws its shift (#2665). Drawn at the newest on every
 * frame, a bot moving across stood still on two frames in three and jumped on
 * the third, a tick ahead of where it was drawn along the road.
 */
export function drawnLateral(place: PackPlace, behindSeconds: number, tickSeconds: number): number {
  return place.lateral + (place.lateralBefore - place.lateral) * backBy(behindSeconds, tickSeconds);
}

/**
 * A bot's sideways speed on a frame `behindSeconds` before the newest tick,
 * metres a second: between the tick before's and the newest's, so the turn
 * and lean it draws change on every frame, never a tick's worth on one
 * (#2665). Eased, it changes by at most
 * {@link PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED} a second, which damps
 * it as `lane-change-lean.ts` §`dampedSway` damps the rider's, more tightly;
 * only a step out of someone's way (§`clearOf`) changes it faster.
 */
export function drawnSway(place: PackPlace, behindSeconds: number, tickSeconds: number): number {
  return place.sway + (place.swayBefore - place.sway) * backBy(behindSeconds, tickSeconds);
}

/** How far back toward the tick before a frame `behindSeconds` behind the newest is, 0 to 1. */
function backBy(behindSeconds: number, tickSeconds: number): number {
  return tickSeconds > 0 ? Math.min(1, Math.max(0, behindSeconds / tickSeconds)) : 0;
}

/**
 * The sideways speed a bot's eased move goes on from, metres a second: the
 * speed it moved at over the tick before, but never over
 * {@link PACK_SIDEWAYS_METRES_PER_SECOND}. A bot that stepped out of someone's
 * way faster (§`clearOf`) does not carry the step on: it goes on at a
 * rider's pace, or slows from it.
 */
function easedSway(was: PackPlace): number {
  return Math.max(
    -PACK_SIDEWAYS_METRES_PER_SECOND,
    Math.min(PACK_SIDEWAYS_METRES_PER_SECOND, was.sway),
  );
}

/**
 * A bot's place across a tick of `elapsedSeconds` on, toward `target`, and its
 * sideways speed over the tick (#2665): its speed changed by at most
 * {@link PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED} over the tick, never
 * over {@link PACK_SIDEWAYS_METRES_PER_SECOND}, and no faster than lets it
 * slow to a stop at the target at that ease, tick by tick. A step that would
 * carry it past the target stops it there, if it is slow enough to stop in
 * the tick.
 */
function easedAcross(
  was: PackPlace,
  target: number,
  elapsedSeconds: number,
): { readonly lateral: number; readonly sway: number } {
  if (elapsedSeconds <= 0) return { lateral: was.lateral, sway: was.sway };
  const ease = PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED;
  const gap = target - was.lateral;
  // The fastest it may go and still stop at the target, slowing by `ease × elapsed` a tick:
  // `v²/2a + v·dt/2 = gap`.
  const stopping =
    ease *
    (Math.sqrt((elapsedSeconds * elapsedSeconds) / 4 + (2 * Math.abs(gap)) / ease) -
      elapsedSeconds / 2);
  const wanted = Math.sign(gap) * Math.min(PACK_SIDEWAYS_METRES_PER_SECOND, stopping);
  const sway = toward(easedSway(was), wanted, ease * elapsedSeconds);
  const lateral = was.lateral + sway * elapsedSeconds;
  // Past the target, or there, slow enough to stop within the tick: it stops at
  // it. Faster, as when the target came toward it, it runs on past and comes
  // back at the ease rather than stopping dead.
  const past = gap === 0 ? sway === 0 : Math.sign(target - lateral) !== Math.sign(gap);
  if (past && Math.abs(easedSway(was)) <= ease * elapsedSeconds) {
    return { lateral: target, sway: gap / elapsedSeconds };
  }
  return { lateral, sway };
}

/** A layout before the first step: every bot goes straight to its place. */
export const NO_PACK_LAYOUT: PackLayout = new Map();

/**
 * `along` moved by whole laps of `lap` to its place nearest `to`, metres: where
 * a racer is on the road beside one at `to` (#2516). As it is with no lap.
 */
function nearestOnTheLoop(along: number, to: number, lap: number | undefined): number {
  return lap === undefined ? along : along + lap * Math.round((to - along) / lap);
}

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
function rows(racers: readonly PackRacer[], riderId: string, previous: PackLayout): PackRacer[][] {
  const last = (racer: PackRacer): number => (racer.id === riderId ? 1 : 0);
  // The row each rode in on the tick before, by its shift: the rider's is nought.
  const rowOf = (racer: PackRacer): number | undefined =>
    racer.id === riderId ? 0 : previous.get(racer.id)?.rowShift;
  const ordered = [...racers].sort(
    (a, b) => b.along - a.along || last(a) - last(b) || (a.id < b.id ? -1 : 1),
  );
  const built: PackRacer[][] = [];
  for (const racer of ordered) {
    const row = built[built.length - 1];
    const front = row?.[0];
    const was = rowOf(racer);
    const reach =
      front !== undefined && was !== undefined && was === rowOf(front)
        ? PACK_ROW_LEAVE_METRES
        : PACK_ROW_METRES;
    if (
      row !== undefined &&
      front !== undefined &&
      row.length < PACK_MOST_ABREAST &&
      front.along - racer.along <= reach
    ) {
      row.push(racer);
    } else {
      built.push([racer]);
    }
  }
  return built;
}

/**
 * The places across one lane for a row's racers in it: side by side, a place
 * apart. The rider keeps theirs and takes the place nearest it; the bots
 * take the rest, left to right in the order they were across. Without the
 * rider, the bots keep the middle they were laid out about on the tick
 * before, those of them already in the lane, as far as the lane's room allows
 * (#2665): a bot joining or leaving moves the others no more than it must.
 * Before #2665 every change in how many shared a lane moved each of them
 * 0.275 m at once, and a row whose count flickered drew them weaving. A bot
 * coming in from another lane alone, and the grid, are centred on the lane.
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
    .map((member) => ({
      member,
      was: previous.get(member.id)?.lateral ?? member.lateral,
      aim: previous.get(member.id)?.aim ?? member.lateral,
    }))
    .sort((a, b) => a.was - b.was || (a.member.id < b.member.id ? -1 : 1));
  const rider = members.find((member) => member.id === riderId);
  const ordered = [...bots];
  if (rider !== undefined) {
    const left = bots.filter(({ was }) => was < rider.lateral).length;
    const level = bots.filter(({ was }) => was === rider.lateral).length;
    ordered.splice(left + Math.floor(level / 2), 0, {
      member: rider,
      was: rider.lateral,
      aim: rider.lateral,
    });
  }
  const count = ordered.length;
  const riderAt = ordered.findIndex(({ member }) => member.id === riderId);
  // On the rider's own place, so the rider keeps it and every bot is a full
  // place from them; else on the middle the bots kept.
  const first =
    riderAt < 0
      ? sharedMiddle(ordered, lane) - ((count - 1) / 2) * PACK_ABREAST_METRES
      : (ordered[riderAt]?.member.lateral as number) - riderAt * PACK_ABREAST_METRES;
  const placed = new Map<string, number>();
  ordered.forEach(({ member }, at) => placed.set(member.id, first + at * PACK_ABREAST_METRES));
  return placed;
}

/**
 * The middle a lane's bots ride side by side about, metres (#2665): the one
 * those of them already laid out in the lane were laid out about on the tick
 * before (`aim`), held so that the outermost of them is still within the
 * lane's {@link PACK_MOST_ABREAST} places. The lane's own when none was in it.
 */
function sharedMiddle(ordered: readonly { readonly aim: number }[], lane: number): number {
  const count = ordered.length;
  const offsets = ordered.map((_, at) => (at - (count - 1) / 2) * PACK_ABREAST_METRES);
  const inLane = ordered
    .map(({ aim }, at) => aim - (offsets[at] as number))
    .filter((_, at) => {
      const aim = ordered[at]?.aim as number;
      return Math.abs(aim - lane) <= (PACK_MOST_ABREAST * PACK_ABREAST_METRES) / 2;
    });
  if (inLane.length === 0) return lane;
  const kept = inLane.reduce((sum, middle) => sum + middle, 0) / inLane.length;
  const room = (Math.max(0, PACK_MOST_ABREAST - count) / 2) * PACK_ABREAST_METRES;
  return Math.min(lane + room, Math.max(lane - room, kept));
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
  lap: number | undefined,
): boolean {
  return row.some((racer) => {
    if (racer.id === rider.id) return false;
    const was = previous.get(racer.id)?.shift ?? shift;
    // On a loop, to where the rider is on the road: a row a lap down passes too (#2516).
    const gap = racer.along + was - nearestOnTheLoop(rider.along, racer.along + was, lap);
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
  lap?: number,
  singleFile = false,
): Map<string, Target> {
  if (singleFile) return lineTargets(racers, riderId, previous);
  const built = rows(racers, riderId, previous);
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
    const makingWay = rider !== undefined && (grid || passing(row, rider, shift, previous, lap));
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
  if (lap !== undefined) aLapApart(racers, riderId, previous, lap, found);
  return found;
}

/**
 * A line's racers, front first, in single file (#3304): as they are on the
 * road, except that two who were drawn in an order keep it until one is
 * {@link LINE_PASS_METRES} past the other. Level, the rider is last.
 */
function lineOrder(line: readonly PackRacer[], riderId: string, previous: PackLayout): PackRacer[] {
  const last = (racer: PackRacer): number => (racer.id === riderId ? 1 : 0);
  // How far ahead of the rider's row each was laid out on the tick before.
  const was = (racer: PackRacer): number | undefined =>
    racer.id === riderId ? 0 : previous.get(racer.id)?.rowShift;
  const ordered = [...line].sort(
    (a, b) => b.along - a.along || last(a) - last(b) || (a.id < b.id ? -1 : 1),
  );
  for (let pass = 0; pass < ordered.length; pass += 1) {
    let swapped = false;
    for (let at = 0; at + 1 < ordered.length; at += 1) {
      const ahead = ordered[at] as PackRacer;
      const behind = ordered[at + 1] as PackRacer;
      const aheadWas = was(ahead);
      const behindWas = was(behind);
      if (
        aheadWas !== undefined &&
        behindWas !== undefined &&
        behindWas - aheadWas >= BIKE_LENGTH_METRES / 2 &&
        ahead.along - behind.along < LINE_PASS_METRES
      ) {
        ordered[at] = behind;
        ordered[at + 1] = ahead;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return ordered;
}

/**
 * Where a racer beside the line is against its rows, front row nought
 * (#3304): level with the racer of the line it is level with on the road,
 * between two rows as far as it is between them on the road, and a whole row
 * clear of either end once it is {@link LINE_CLEAR_METRES} clear of it.
 */
function besideRow(racer: PackRacer, line: readonly PackRacer[]): number {
  const front = line[0];
  if (front === undefined) return 0;
  if (racer.along >= front.along) {
    return -Math.min(1, (racer.along - front.along) / LINE_CLEAR_METRES);
  }
  let at = 0;
  while (at + 1 < line.length && (line[at + 1] as PackRacer).along > racer.along) at += 1;
  const ahead = line[at] as PackRacer;
  const behind = line[at + 1];
  const span = behind === undefined ? LINE_CLEAR_METRES : ahead.along - behind.along;
  const back = ahead.along - racer.along;
  return at + (span > 0 ? Math.min(1, Math.max(0, back / span)) : 1);
}

/**
 * Every racer's target in single file (#3304): a row to each racer of the
 * line, the rider's place the anchor whether they are in the line or beside
 * it, and a racer beside the line at {@link besideRow}. A bot of the line
 * drawn overlapping the rider along the road, in the rider's place across,
 * is laid out a place beside them, as a race's row making way is.
 */
function lineTargets(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
): Map<string, Target> {
  const line = lineOrder(
    racers.filter((racer) => racer.beside !== true),
    riderId,
    previous,
  );
  const row = new Map<string, number>();
  line.forEach((racer, at) => row.set(racer.id, at));
  for (const racer of racers) {
    if (racer.beside === true) row.set(racer.id, besideRow(racer, line));
  }
  const rider = racers.find((racer) => racer.id === riderId);
  const anchor = row.get(riderId) ?? 0;
  const found = new Map<string, Target>();
  for (const racer of racers) {
    const shift = (anchor - (row.get(racer.id) as number)) * BIKE_LENGTH_METRES;
    const drawn = racer.along + (previous.get(racer.id)?.shift ?? shift);
    const makingWay =
      rider !== undefined &&
      racer.id !== riderId &&
      racer.beside !== true &&
      Math.abs(racer.lateral - rider.lateral) < PACK_ABREAST_METRES &&
      Math.abs(drawn - rider.along) < BIKE_LENGTH_METRES - PACK_BETWEEN_SLACK_METRES;
    const lateral = makingWay
      ? (across([racer, rider], riderId, previous, racer.lateral).get(racer.id) as number)
      : racer.lateral;
    found.set(racer.id, { shift, lateral, makingWay });
  }
  return found;
}

/**
 * Two bots a lap apart never share a row, since rows are laid out in race
 * places, so neither is laid out beside the other when one comes up on the
 * other on the road (#2516). Held behind, a bot was drawn at the slower one's
 * speed for good, ever further behind its race place. So where two bots a lap
 * apart are level on the road or closing to be, as {@link passing} reads it,
 * in one place across, the one the race has ahead is laid out a place beside
 * the other, on the side it was, and goes round.
 */
function aLapApart(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
  lap: number,
  found: Map<string, Target>,
): void {
  const bots = racers.filter((racer) => racer.id !== riderId);
  for (const ahead of bots) {
    for (const behind of bots) {
      if (ahead.along - behind.along <= lap / 2) continue;
      const aheadTarget = found.get(ahead.id) as Target;
      const behindTarget = found.get(behind.id) as Target;
      if (Math.abs(aheadTarget.lateral - behindTarget.lateral) >= PACK_ABREAST_METRES) continue;
      const passes = passing(
        [ahead],
        { ...behind, along: behind.along + (previous.get(behind.id)?.shift ?? behindTarget.shift) },
        aheadTarget.shift,
        previous,
        lap,
      );
      if (!passes) continue;
      const was = previous.get(ahead.id)?.lateral ?? ahead.lateral;
      const side = Math.sign(was - behindTarget.lateral) || 1;
      found.set(ahead.id, {
        ...aheadTarget,
        lateral: behindTarget.lateral + side * PACK_ABREAST_METRES,
      });
    }
  }
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
      rowShift: place.shift,
      aim: place.lateral,
      shift: place.shift,
      shiftBefore: place.shift,
      lateral: place.lateral,
      lateralBefore: place.lateral,
      sway: 0,
      swayBefore: 0,
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
 * @param lapMetres - the loop's lap, metres, on which a racer a lap apart is
 *   drawn beside the others and kept clear of them (#2516); absent, none is.
 * @param singleFile - whether the field is a group ride's line, a row to each
 *   racer (#3304, the header's §"In single file"); absent, a race's pack.
 * @throws {RangeError} for an elapsed time that is not finite or is below
 *   zero, or a lap that is not a finite number of metres above zero.
 */
export function stepPackLayout(
  racers: readonly PackRacer[],
  riderId: string,
  previous: PackLayout,
  elapsedSeconds: number,
  lapMetres?: number,
  singleFile = false,
): PackLayout {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError('a pack layout steps a finite number of seconds, 0 or more');
  }
  if (lapMetres !== undefined && !(Number.isFinite(lapMetres) && lapMetres > 0)) {
    throw new RangeError('a pack layout’s lap is a finite number of metres above zero');
  }
  const wanted = targets(racers, riderId, previous, false, lapMetres, singleFile);
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
    // A line in single file has no grid to keep: its order holds by itself
    // (§`lineOrder`), and a line that waits for its rider still rotates.
    const target =
      !singleFile && was !== undefined && racer.speed < PACK_ROLLING_METRES_PER_SECOND
        ? { shift: was.shift, lateral: easesAside ? wants.lateral : was.lateral }
        : wants;
    if (was === undefined) {
      next.set(racer.id, {
        rowShift: wants.shift,
        aim: wants.lateral,
        shift: target.shift,
        shiftBefore: target.shift,
        lateral: target.lateral,
        lateralBefore: target.lateral,
        sway: 0,
        swayBefore: 0,
      });
      continue;
    }
    const { lateral, sway } = easedAcross(was, target.lateral, elapsedSeconds);
    next.set(racer.id, {
      rowShift: wants.shift,
      aim: wants.lateral,
      shift: shiftToward(racer, was, target.shift, elapsedSeconds),
      shiftBefore: was.shift,
      lateral,
      lateralBefore: was.lateral,
      sway,
      swayBefore: was.sway,
    });
  }
  return clear(racers, riderId, next, previous, elapsedSeconds, lapMetres);
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
 * How fast a racer's race place went forward over the tick, metres a second:
 * its speed, or less where it went less far (§`PackRacer.alongBefore`).
 */
function progress(racer: PackRacer, elapsedSeconds: number): number {
  if (racer.alongBefore === undefined || elapsedSeconds <= 0) return racer.speed;
  return Math.min(racer.speed, (racer.along - racer.alongBefore) / elapsedSeconds);
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
  const forward = -PACK_GIVE_WAY_SHARE * Math.max(0, progress(racer, elapsedSeconds));
  const least = Math.max(forward, Math.min(rate + ease, Math.max(rate - ease, -back)));
  const most = Math.max(least, Math.min(rate + ease, PACK_CLOSE_UP_METRES_PER_SECOND));
  return { least, most };
}

/**
 * A bot's shift a tick on, toward its row's, as fast as {@link shiftRates}
 * allows. Arriving needs no braking of its own: the row step's rates are
 * within {@link PACK_CLOSE_UP_METRES_PER_SECOND} either way, so stopping from
 * either is inside the ease.
 *
 * An item's push counts toward those rates (#2636): a bot a tailwind or a tow
 * carries forward closes up on its row only by what is left of
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} after the push, and one a puddle or
 * a gust holds back gives way only by what is left of its give-way. Before,
 * the row step was added on top: a bot under a tailwind closing up on the row
 * it shared with another came up on that bot at 3.5 m/s plus the other's
 * drift, faster than either could ease aside, and the two were drawn up to
 * 12 mm inside each other between ticks (`pack-harness.test.ts`, the flat
 * circuit with items on, seed 3). With items off nothing moves an offset, and
 * this is the row step as it was.
 */
function shiftToward(
  racer: PackRacer,
  was: PackPlace,
  target: number,
  elapsedSeconds: number,
): number {
  if (elapsedSeconds <= 0) return was.shift;
  const pushed = racer.offsetRate ?? 0;
  const forward = Math.max(0, PACK_CLOSE_UP_METRES_PER_SECOND - Math.max(0, pushed));
  const back = Math.max(0, giveWay(racer) - Math.max(0, -pushed));
  const { least, most } = shiftRates(racer, was, back, elapsedSeconds);
  const wants = Math.max(-back, Math.min(forward, (target - was.shift) / elapsedSeconds));
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
   * before.
   */
  readonly before: number;
  /**
   * Where it is drawn across there, metres: its place across a tick before.
   * The frames between two ticks draw it between there and where it is now,
   * along and across alike (#2665), so a move is clear on them only if that
   * whole way is clear.
   */
  readonly beforeLateral: number;
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
 * two are clear. Given the loop's `lap`, along the road to the other's
 * nearest place on it (#2516). It is given wherever a case or the race sweep
 * in `lap-race-lapped.test.ts` needs it, and nowhere else.
 */
function overlap(
  one: { along: number; lateral: number },
  other: { along: number; lateral: number },
  lap?: number,
): number {
  const apart = one.along - nearestOnTheLoop(other.along, one.along, lap);
  return (
    Math.max(0, BIKE_LENGTH_METRES - PACK_ROUNDING_METRES - Math.abs(apart)) *
    Math.max(0, PACK_ABREAST_METRES - PACK_ROUNDING_METRES - Math.abs(one.lateral - other.lateral))
  );
}

/**
 * How far two bicycles drawn on the frames between two ticks may graze each
 * other's box and still be clear there, metres: **1 mm** (#2665). The end of
 * each way a tick back is read along its speed now, not where it was drawn,
 * so two a bike length apart whose speeds differ graze by a hair there; a
 * graze that small, scored, sent a bot stepping across at full speed.
 */
const PACK_BETWEEN_SLACK_METRES = 0.001;

/**
 * How far two bicycles drawn on the frames between two ticks come inside each
 * other, square metres, as {@link overlap} scores it (#2665): each is drawn on
 * the straight way from where it was on the tick before (`from`) to where it
 * is (`to`), along and across, so the two are inside each other on those
 * frames where the way between them crosses the box a bike length long and a
 * place wide. Nought when it does not; else {@link overlap} at the middle of
 * the stretch inside, which shrinks as either moves off the other.
 */
function overlapBetween(
  one: { readonly from: Place; readonly to: Place },
  other: { readonly from: Place; readonly to: Place },
  lap?: number,
): number {
  const alongTo = one.to.along - nearestOnTheLoop(other.to.along, one.to.along, lap);
  const alongFrom = alongTo + (one.from.along - one.to.along) - (other.from.along - other.to.along);
  const acrossTo = one.to.lateral - other.to.lateral;
  const acrossFrom = one.from.lateral - other.from.lateral;
  let enter = 0;
  let leave = 1;
  for (const [from, to, half] of [
    [alongFrom, alongTo, BIKE_LENGTH_METRES - PACK_BETWEEN_SLACK_METRES],
    [acrossFrom, acrossTo, PACK_ABREAST_METRES - PACK_BETWEEN_SLACK_METRES],
  ] as const) {
    const change = to - from;
    if (change === 0) {
      if (Math.abs(from) >= half) return 0;
      continue;
    }
    const first = (-half - from) / change;
    const second = (half - from) / change;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
  }
  if (enter >= leave) return 0;
  const middle = (enter + leave) / 2;
  return overlap(
    {
      along: alongFrom + (alongTo - alongFrom) * middle,
      lateral: acrossFrom + (acrossTo - acrossFrom) * middle,
    },
    { along: 0, lateral: 0 },
  );
}

/** A place along the road and across it, metres. */
interface Place {
  readonly along: number;
  readonly lateral: number;
}

/** One place a bot may be drawn on this tick. */
interface Candidate {
  readonly shift: number;
  readonly lateral: number;
}

/**
 * How far ahead a bot sees the rider coming, seconds: **0.1**, two ticks;
 * {@link PACK_MAKE_WAY_SECONDS}, the time it takes to move two places across,
 * eased (1.59 s since #2665, when a bot's sideways speed fell to a rider's
 * and was eased in: it was 0.25 s); and **0.45**. A bot the rider would be
 * inside by then moves already, so the rider, who may close faster than a
 * bot may move, does not reach it, and a bot does not cross the rider's line
 * just ahead of them.
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

/** The shares of a step across, either way, a bot that must get clear tries (#2665). */
const PACK_CLEAR_STEPS = [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1] as const;

/**
 * How far ahead a bot sees another bot coming, seconds: **0.1**, **0.25** and
 * **0.5**, each going on as it moved over the last tick (#2665). Ranked after
 * a smooth move, so a bot it would soon be inside is eased away from, or held
 * back from, and stepped from only once it is in the way.
 */
const PACK_BOTS_SEEN_AHEAD_SECONDS = [0.1, 0.25, 0.5] as const;

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
type Score = readonly [number, number, number, number, number, number];

/**
 * `each`'s score where it scores better than `best`, else `undefined`: the
 * first term that differs decides, so that a worse place never wins on a
 * difference that is merely not nought (#2558's review, finding 4). Each term
 * is scored only when the ones before it tie (#2665): most places lose on the
 * first or the second, and the later ones read every racer a moment on.
 */
function better(
  terms: readonly ((each: Candidate) => number)[],
  each: Candidate,
  best: Score,
): Score | undefined {
  const scored: number[] = [];
  for (const [at, term] of terms.entries()) {
    const value = term(each);
    const apart = value - (best[at] as number);
    if (apart > 0) return undefined;
    scored.push(value);
    if (apart < 0) {
      for (const rest of terms.slice(at + 1)) scored.push(rest(each));
      return scored as unknown as Score;
    }
  }
  return undefined;
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
 * inside anyone. Its reach is what it may move in a tick: across, its eased
 * reach, and a step of {@link PACK_CLEAR_SIDEWAYS_METRES_PER_SECOND} where
 * nothing eased is clear (#2665); and along no faster than
 * {@link PACK_CLOSE_UP_METRES_PER_SECOND} forward or {@link PACK_GIVE_WAY_SHARE}
 * of how far its race place went on, so it never jumps and never goes backwards (#2558's
 * review, finding 1), and within
 * {@link PACK_SHIFT_EASE_METRES_PER_SECOND_SQUARED} of how fast it moved on
 * the tick before, so it is never drawn slowing and speeding up again on
 * alternate ticks (finding A). Inside the rider counts first, since the rider is
 * never moved; then inside a bot, each on this tick and on the frames drawn
 * back to the tick before; then inside the rider
 * {@link PACK_SEEN_AHEAD_SECONDS} on, where the rider is steering to; then how
 * far outside its eased reach across it is; then inside a bot
 * {@link PACK_BOTS_SEEN_AHEAD_SECONDS} on; then the least move from the place
 * it was laid out in.
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
  lap: number | undefined,
): PackLayout {
  const rider = racers.find((racer) => racer.id === riderId);
  // Where every racer is while each bot is placed: the rider where they are,
  // a bot placed already where it was placed, and one still to place where it
  // was last tick, so a bot ahead never moves across into one level behind it.
  const where = new Map<string, Drawn>();
  for (const racer of racers) {
    if (racer.id === riderId) {
      // The rider is drawn between where they were steered and where they are.
      where.set(racer.id, {
        along: racer.along,
        lateral: racer.lateral,
        race: racer.along,
        before: racer.along - racer.speed * elapsedSeconds,
        beforeLateral: racer.lateralBefore ?? racer.lateral,
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
        beforeLateral: was.lateral,
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
        elapsedSeconds,
        lap,
      );
      where.set(racer.id, {
        along: racer.along + placed.shift,
        lateral: placed.lateral,
        race: racer.along,
        before: racer.along - racer.speed * elapsedSeconds + was.shift,
        beforeLateral: was.lateral,
      });
      layout.set(racer.id, {
        rowShift: place.rowShift,
        aim: place.aim,
        shift: placed.shift,
        shiftBefore: place.shiftBefore,
        lateral: placed.lateral,
        lateralBefore: was.lateral,
        sway: elapsedSeconds > 0 ? (placed.lateral - was.lateral) / elapsedSeconds : 0,
        swayBefore: was.sway,
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
  elapsedSeconds: number,
  lap: number | undefined,
): Candidate {
  const others = [...where].filter(([id]) => id !== racer.id).map(([, other]) => other);
  const drawnAt = (each: Candidate) => ({ along: racer.along + each.shift, lateral: each.lateral });
  // On the frames drawn back toward the tick before, a bot is drawn on the
  // way from where it was to where it is, along and across (#2665): a place
  // is clear there only if that way is clear of the other's. Both ways are
  // straight, so two that are clear at either end may still cross, as one
  // closes up along while the other moves across. Where neither moves across,
  // both ways run along the road, and clear at either end is clear between:
  // the end a tick back is read along each one's speed now, and is not where
  // either was drawn, so it is not read then.
  const before = racer.along - racer.speed * elapsedSeconds + was.shift;
  const insideBefore = (each: Candidate, other: Drawn): number =>
    each.lateral === was.lateral && other.lateral === other.beforeLateral
      ? 0
      : overlapBetween(
          { from: { along: before, lateral: was.lateral }, to: drawnAt(each) },
          {
            from: { along: other.before, lateral: other.beforeLateral },
            to: { along: other.along, lateral: other.lateral },
          },
          lap,
        );
  // Inside the rider: on this tick, and on the frames back to the tick
  // before. And soon to be: a moment on, each racer at its own speed.
  const riderDrawn = rider === undefined ? undefined : where.get(rider.id);
  const insideRider = (each: Candidate): number =>
    rider === undefined || riderDrawn === undefined
      ? 0
      : overlap(drawnAt(each), rider, lap) + insideBefore(each, riderDrawn);
  const riderSoon = (each: Candidate): number =>
    rider === undefined
      ? 0
      : PACK_SEEN_AHEAD_SECONDS.reduce(
          (sum, seconds) =>
            sum +
            overlap(
              { along: racer.along + each.shift + racer.speed * seconds, lateral: each.lateral },
              {
                along: rider.along + rider.speed * seconds,
                lateral: toward(
                  rider.lateral,
                  rider.heading ?? rider.lateral,
                  SIDEWAYS_METRES_PER_SECOND * seconds,
                ),
              },
              lap,
            ),
          0,
        );
  // And inside a bot soon: each going on as it moved over this tick (#2665).
  // A bot moving across at a rider's pace takes longer to get clear than one
  // that jumped, so it looks a little ahead for a bot it is closing on.
  const othersSoon = (each: Candidate): number => {
    if (elapsedSeconds <= 0) return 0;
    const at = drawnAt(each);
    const along = (at.along - before) / elapsedSeconds;
    const across = (each.lateral - was.lateral) / elapsedSeconds;
    return others.reduce(
      (sum, other) =>
        other === riderDrawn
          ? sum
          : sum +
            PACK_BOTS_SEEN_AHEAD_SECONDS.reduce(
              (part, seconds) =>
                part +
                overlap(
                  { along: at.along + along * seconds, lateral: at.lateral + across * seconds },
                  {
                    along: other.along + ((other.along - other.before) / elapsedSeconds) * seconds,
                    lateral:
                      other.lateral +
                      ((other.lateral - other.beforeLateral) / elapsedSeconds) * seconds,
                  },
                  lap,
                ),
              0,
            ),
      0,
    );
  };
  const insideAny = (each: Candidate): number =>
    others.reduce(
      (sum, other) => sum + overlap(drawnAt(each), other, lap) + insideBefore(each, other),
      0,
    );
  const now = { shift: place.shift, lateral: place.lateral };
  const moved = (each: Candidate): number =>
    Math.abs(each.shift - now.shift) + Math.abs(each.lateral - now.lateral);
  // Across, its reach is what its eased sideways speed allows in the tick
  // (#2665): within PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED of the speed
  // it moved at on the tick before, and no faster than
  // PACK_SIDEWAYS_METRES_PER_SECOND. Where nothing in that reach is clear, it
  // may get out faster, a step of PACK_CLEAR_SIDEWAYS_METRES_PER_SECOND either
  // way, as every bot moved before #2665: never ghosting through anyone comes
  // first (the owner's ruling on #2544), and a smooth move second.
  const ease = PACK_SIDEWAYS_EASE_METRES_PER_SECOND_SQUARED * elapsedSeconds;
  const leftmost =
    was.lateral +
    Math.max(-PACK_SIDEWAYS_METRES_PER_SECOND, easedSway(was) - ease) * elapsedSeconds;
  const rightmost =
    was.lateral + Math.min(PACK_SIDEWAYS_METRES_PER_SECOND, easedSway(was) + ease) * elapsedSeconds;
  const within = (lateral: number): number => Math.min(rightmost, Math.max(leftmost, lateral));
  const step = PACK_CLEAR_SIDEWAYS_METRES_PER_SECOND * elapsedSeconds;
  const stepped = (lateral: number): number => toward(was.lateral, lateral, step);
  const unEased = (each: Candidate): number =>
    Math.max(0, leftmost - each.lateral, each.lateral - rightmost);
  // Each place is scored once (#2558's review, finding E): out of the rider's
  // way first, since the rider is never moved; then out of every bot's; then
  // out of the rider's way a moment on; then how far outside its eased reach
  // across (#2665); then the least move.
  const terms = [insideRider, insideAny, riderSoon, unEased, othersSoon, moved] as const;
  const score = (each: Candidate): Score => terms.map((term) => term(each)) as unknown as Score;
  let chosen: Candidate = { shift: current.shift, lateral: current.lateral };
  let chosenScore = score(chosen);
  if (
    chosenScore[0] === 0 &&
    chosenScore[1] === 0 &&
    chosenScore[2] === 0 &&
    chosenScore[4] === 0
  ) {
    return chosen;
  }
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
  // Each place across within its eased reach, and as far as a step goes.
  const eitherReach = (lateral: number): number[] => [within(lateral), stepped(lateral)];
  const laterals = [
    ...new Set([
      now.lateral,
      // Toward the place its row laid it out at, as fast as it may.
      ...eitherReach(place.aim),
      within(was.lateral),
      was.lateral,
      leftmost,
      rightmost,
      // And evenly across as far as a step goes either way, so a way out is
      // found where none of the places above is clear.
      ...PACK_CLEAR_STEPS.map((share) => was.lateral + share * step),
      ...near.flatMap((other) =>
        [-1, 1].flatMap((side) => eitherReach(other.lateral + side * PACK_ABREAST_METRES)),
      ),
      // And, for a bot a lap apart from the rider, a step toward a place
      // either side of the rider (#2516). It never shares the rider's row, so
      // nothing else lays it beside them, and a bot level with it on the road
      // on one side must not leave it held in the rider's line.
      ...(rider === undefined || nearestOnTheLoop(rider.along, racer.along, lap) === rider.along
        ? []
        : [-1, 1].flatMap((side) => eitherReach(rider.lateral + side * PACK_ABREAST_METRES))),
    ]),
  ];
  for (const shift of alongs) {
    for (const lateral of laterals) {
      const each = { shift, lateral };
      const scored = better(terms, each, chosenScore);
      if (scored !== undefined) {
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
      .flatMap((side) =>
        eitherReach(holding.lateral + side * PACK_ABREAST_METRES).map((lateral) => ({
          shift: held.shift,
          lateral,
        })),
      )
      .find((each) => insideRider(each) <= heldRider && insideAny(each) <= heldAny);
    if (round !== undefined) chosen = round;
  }
  return chosen;
}
