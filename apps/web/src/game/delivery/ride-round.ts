// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Delivery round inside a game ride — #1816, resting on the owner's rulings
 * DL2, DL5, DL6b and DL11 of 2026-10-27 (epic #1803), recorded as ADR 0059.
 *
 * `GameView` holds one {@link DeliveryRide} for a ride with Delivery on, and
 * this module is the whole of what it does with one: {@link startDeliveryRide}
 * at the press — on a realistic ride, once its world has loaded or failed to (or the arrival window has lapsed),
 * from where the rider is then (#2392, `GameView.tsx` §`deliveryWaitingRef`)
 * — {@link stepDeliveryRide} on every simulation step that ran,
 * and {@link endDeliveryRide} when the round is over or the ride ends. It
 * composes the round (`round.ts`), the target pick (`targets.ts`), the throw
 * (`throw.ts`), the obstacles (`obstacles.ts`) and the lane steering
 * (`steer.ts`, #1853); what each of those decides is still theirs.
 *
 * ## Nothing here reaches the trainer (DL5, ADR 0059 D-2)
 *
 * The rider's distance and speed come IN, from the simulation's own state;
 * nothing goes back. A delivery, a miss and a crash change the round and its
 * score and nothing else, and this module imports none of the simulation, the
 * gradient driver or a trainer port (`delivery-cannot-reach-trainer.test.ts`,
 * #1807). `delivery-wiring.test.tsx` rides the same power trace with and
 * without a round and holds the trainer's writes equal, which is the half of
 * DL5 no import walk can see.
 *
 * ## A crash stops the DRAWN rider, on a second distance (#3021, ADR 0094)
 *
 * The ride distance (`DeliveryRideStep.along`, the simulation's odometer) is
 * the only distance the grade is read at, and nothing here changes it. The
 * round holds {@link DeliveryRide.crashOffset} beside it, clamped to
 * `[-CRASH_OFFSET_BOUND_METRES, 0]`, and reads the drawn distance,
 * {@link DeliveryRide.along} = ride distance + offset, for everything it does:
 * its throws, misses, obstacles, hazard warnings, {@link nextHouse} and its
 * end. `GameView` draws the rider, and points the camera, there too
 * ({@link drawnRiderDistance}).
 *
 * - **The stop** (D-3): for {@link CRASH_STOP_SECONDS} from a counted crash,
 *   each step takes what the ride covered off the offset, so the drawn rider
 *   holds where they crashed. If the offset reaches the bound the stop ends
 *   there and the drawn rider moves with the ride. While down no throw is
 *   taken and no contact counts; a parcel already in the air still lands.
 * - **The payout** (D-4): after the stop the drawn rider moves faster than the
 *   ride by {@link CRASH_PAYOUT_SHARE} of its speed, never past
 *   `obstacles.ts` §`AVOIDABLE_FASTEST_METRES_PER_SECOND` and never slower
 *   than the ride, until the offset is back to nought.
 *
 * ⚠️ The offset never flows the other way: nothing here writes the ride
 * distance, and nothing that feeds the simulation reads
 * {@link DeliveryRide.along} (D-2.4). A stop is drawn; the legs feel the road
 * at the ride distance.
 *
 * ## The steps that ran, and only those
 *
 * `obstacles.ts` warns that a rolling obstacle still crosses a rider whose
 * speed is nought, so a step the rider did not ride would cost a point for
 * not moving. {@link DeliveryRideStep.ticks} is the count `GameSimulation`
 * says it integrated on the frame (`SimulationTick.steps`): nought while the
 * simulation owed nothing, and the loop does not run while the ride is
 * paused, so a paused ride steps nothing. A frame that ran several steps
 * places the rider at each by sharing the frame's distance between them, so
 * an obstacle is swept at every step rather than at the frame's end.
 *
 * ## The rider steers, and the obstacles meet them where they are drawn
 *
 * A round runs on a solo ride only, so its rider can always steer (#1820,
 * DL9): its obstacles are placed with `steering` on, so some stand in a lane,
 * and {@link DeliveryRide.steer} starts in the lane nearest the racing line at
 * the press (`racing-line.ts` §`lineOffsetAt`, never the drawn
 * `PlacedRider.lateral`, which has made room for a bot or a ghost). `GameView`
 * turns it with `steer.ts` §`steerToward` for each lane key; every step that
 * ran steps it ({@link stepDeliveryRide}) BEFORE the obstacles, and hands them
 * its offset as the rider's lateral. The same offset is what `scene.ts`
 * §`lateralOf` draws the rider at, exactly, so a crash is drawn as one
 * (#1853). Since #2362 a parked car the rider hits moves them to its road
 * side, so a crash into one is drawn as a crash and not as a ride through it
 * (`obstacles.ts` §`clearOfParkedCars`): the steering's drawn offset only,
 * never their lane, distance or speed. While they are held clear, the
 * obstacles meet them in the lane they steer to, so the move scores no crash
 * of its own. It is held in memory for the round, as the
 * rest is, and never stored: a stored ride has no lateral field.
 *
 * ## A house is missed when its window has closed behind the rider
 *
 * The round's window ({@link DeliveryRide.throwWindow}: `throw.ts`
 * §`THROW_WINDOW_AFTER_METRES`, or a level's own since #2931) says where a
 * house's window closes (widened by the assist's {@link ASSISTED_THROW_SCALE}),
 * and that is where a house still expecting a parcel is counted missed — but not while a parcel
 * thrown to it from inside its window is still in the air, because that
 * parcel may yet land on the doorstep. Every parcel lands within
 * `PARCEL_FLIGHT_SECONDS`, so the wait is bounded.
 *
 * ## The round's score has the crashes in it
 *
 * `round.ts` §`RoundTally.score` counts deliveries only. The owner's ruling of
 * 2026-10-28 on #1811 takes a crash off the round's score, never below nought
 * at any moment, so {@link DeliveryRide.changes} keeps each delivery and each
 * crash in the order it happened — in a step, its landings and then its
 * crashes — and {@link DeliveryRide.score} is `obstacles.ts` §`roundScore` of
 * them. The week's score is `round.ts` §`endRound`'s, deliveries only, and a
 * crash never reaches it.
 *
 * ## Where a parcel came down, and what it earned (#2577)
 *
 * Each step's landings are kept for {@link LANDING_SHOWN_SECONDS} of the throw
 * clock as {@link DeliveryRide.landed}, each with the points it moved the
 * score by, so the frame can mark the house hit or the spot missed, the HUD
 * can say it under the score, and `GameView` can play its sound. A drawing
 * and a word: nothing the round decides reads them.
 *
 * ## When the round ends
 *
 * Once no house on the round is expecting a parcel the round is over, and
 * its outcome is settled then and held: the ride goes on, the parcels still in
 * the air and the obstacles still crossing are drawn, and nothing after it
 * scores. A ride that ends first ends its round there ({@link endDeliveryRide}),
 * counting only the houses the rider has passed (#1857, the owner's ruling of
 * 2026-10-29): one passed and not delivered is missed, and one not yet reached
 * is neither, so a mis-pressed *End ride* costs no more than the houses
 * already behind the rider.
 *
 * ## A route with fewer houses than the day's rides a shorter round
 *
 * The round holds the week's count of houses, every one a house
 * `targets.ts` §`pickRoundTargets` found the town draws, so every house on
 * it has a doorstep to throw at. Where the pick finds fewer than the week
 * asks for, the round is every house it found (the owner's ruling of
 * 2026-10-29 on #1818), and it stands for the day's count
 * (`round.ts` §`Round.dayHouses`), so being short never lowers tomorrow's
 * count (`round.ts` §`endRound`). A pick of fewer than
 * `round.ts` §`FEWEST_DELIVERY_HOUSES` — none at all included, which is
 * #1856's town with no house in reach — is no round, and the ride is an
 * ordinary one. With no round nothing is kept, so the week is as it was.
 * What the rider is told is `hud/delivery-announce.ts` §`TOO_FEW_HOUSES_TEXT`.
 *
 * ## A round on a built-in level (#2362, ADR 0065)
 *
 * {@link DeliveryRideStart.level} is the level's round: its `houses` are the
 * round's, in place of the week's, and its hazards set the obstacles
 * (`obstacles.ts` §`levelObstacleMix`): its static ones parked cars and bins,
 * every one standing, and since #2364 its moving ones a dog, a car pulling
 * out or another rider coming the other way, each stepped only on a step that
 * ran, as every obstacle is. The assist still places fewer or none. A level round is kept
 * apart from the week ({@link DeliveryRide.onLevel}, ADR 0065 D-9.3): its end
 * is never written to `delivery-progress.ts`. Reached, its end keeps the
 * level finished instead ({@link keepLevelFinished}, #2363, D-9), which opens
 * the next level in the picker. Since #2931 its throw window is read
 * ({@link DeliveryRide.throwWindow}): the throw's test, the line a house is
 * missed at and where {@link nextHouse} counts down to are all the level's,
 * no wider than `throw.ts`' own (`level-file.ts`), and the assist's wider
 * windows scale its closing edge as they scale the default's. A rider's own
 * route keeps `throw.ts`' own. Its mailbox and no-delivery shares are read
 * (#2365): the pick makes that share of its houses mailboxes at the kerb, and
 * that share houses that must not get a parcel, apart from the round
 * ({@link DeliveryRide.noDeliveryTargets}); a parcel one catches takes
 * `throw.ts` §`NO_DELIVERY_SCORE_DELTA` off the round's score, or nothing with
 * the assist's no fail on, and never reaches the week.
 * Its weather and light (#2366) are read here for the drawing only
 * ({@link DeliveryRide.weather}, {@link DeliveryRide.revealMetres}): they
 * change where a marker is drawn from, never the round, the throw, the
 * obstacles, the announcements, the ride record or the trainer (ADR 0065
 * D-11: rain and dusk are a drawing and never a grade).
 *
 * ## Nothing here leaves the ride (DL11)
 *
 * The seed is drawn once at the press, handed to the pick and the
 * obstacles, and kept by nothing: a {@link DeliveryRide} carries no seed, and
 * its targets are round positions, distances and points held in memory for
 * the ride. Nothing here formats a position into a string.
 */

import type { RouteProfile } from '@onyourleft/domain';

import type { PreferenceStorage } from '../hud/announce-preference';
import type { MappedBuildings } from '../mapped-buildings';
import type { CorridorOrigin } from '../terrain';

import { readDeliveryAssist } from './assist-preference';
import { CRASH_SECONDS } from './crash-look';
import { readDeliveryProgress, writeDeliveryProgress } from './delivery-progress';
import { LOW_LIGHT_REVEAL_METRES } from './in-view';
import { readLevelProgress, withLevelFinished, writeLevelProgress } from './level-progress';
import type { LevelRound } from './levels/level-file';
import {
  AVOIDABLE_FASTEST_METRES_PER_SECOND,
  clearOfParkedCars,
  levelObstacleMix,
  placeObstacles,
  roundScore,
  scoreAfter,
  startObstacles,
  stepObstacles,
  type Obstacle,
  type ObstacleState,
  type ScoreChange,
} from './obstacles';
import {
  endRound,
  FEWEST_DELIVERY_HOUSES,
  recordMiss,
  roundTally,
  startRound,
  type Round,
  type RoundOutcome,
  type WeekProgress,
} from './round';
import { LANE_OFFSETS_METRES, startSteer, stepSteer, type SteerState } from './steer';
import type { ThrowIntent } from './throw-input';
import {
  drawRoundSeed,
  pickRoundTargets,
  TARGET_WINDOW_HALF_METRES,
  type DeliveryTarget,
} from './targets';
import {
  ASSISTED_THROW_SCALE,
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DEFAULT_THROW_WINDOW,
  DELIVERY_TICK_SECONDS,
  insideThrowWindow,
  NO_DELIVERY_SCORE_DELTA,
  NO_PARCELS,
  stepThrows,
  throwSideFor,
  type Landing,
  type ThrowSide,
  type ThrowState,
  type ThrowTarget,
  type ThrowWindow,
} from './throw';

/**
 * How long a parcel's landing is shown, seconds — #2577: **1.5**. The mark at
 * the house (or where the parcel came down) and the Score field's word under
 * the score stand this long after the landing, on the ride's own ticks. This
 * project's own number, for the owner's approval in #2577's pull request.
 */
export const LANDING_SHOWN_SECONDS = 1.5;

/** {@link LANDING_SHOWN_SECONDS} in the game's ticks: **30**. */
export const LANDING_SHOWN_TICKS = Math.round(LANDING_SHOWN_SECONDS / DELIVERY_TICK_SECONDS);

/**
 * A parcel that came down, as the rider is shown it — #2577: the owner, on
 * the tablet, *"I cant tell when I throw a package if it actually gets to the
 * house. Is there a reward for hitting it."* A hit is a delivery; a miss is a
 * parcel no house caught; a no-delivery is one a house that must not get a
 * parcel caught (#2365). Held in memory for {@link LANDING_SHOWN_SECONDS}, for
 * the drawing, the HUD and the sound, and never stored (DL11).
 */
export interface ParcelLanded {
  readonly kind: 'delivered' | 'missed' | 'no-delivery';
  /** The throw clock's tick it came down on (`throw.ts` §`ThrowState.tick`). */
  readonly tick: number;
  /**
   * What it did to the round's score, as the score moved: `+1` for a
   * delivery, the no-delivery's cost (nought with the assist's no fail on, or
   * with the score already at nought), nought for a miss and for anything
   * after the round's end.
   */
  readonly points: number;
  /** Where it came down, metres along the route and from the road's centre, and to which side. */
  readonly along: number;
  readonly across: number;
  readonly side: ThrowSide;
  /**
   * The house that caught it: its round position for a delivery, its place in
   * {@link DeliveryRide.noDeliveryTargets} for a no-delivery. Absent for a miss.
   */
  readonly house?: number;
}

/**
 * How long a crash stops the drawn rider, in seconds — ADR 0094 D-3.1: the
 * crash's drawn length, `crash-look.ts` §`CRASH_SECONDS` (**1.8 s**), so the
 * rider is held for as long as they are drawn down and getting back up.
 */
export const CRASH_STOP_SECONDS = CRASH_SECONDS;

/** The stop in the game's ticks: **36**. */
const CRASH_STOP_TICKS = Math.round(CRASH_STOP_SECONDS / DELIVERY_TICK_SECONDS);

/**
 * How far the drawn rider may fall behind the ride, metres — ADR 0094 D-2.5's
 * rule, not a free number: the fastest avoidable speed times the stop,
 * rounded up to the next 5 m. 12 × 1.8 = 21.6, so **25 m**.
 */
export const CRASH_OFFSET_BOUND_METRES =
  Math.ceil((AVOIDABLE_FASTEST_METRES_PER_SECOND * CRASH_STOP_SECONDS) / 5) * 5;

/**
 * How much faster than the ride the drawn rider moves while the banked
 * distance is paid out — ADR 0094 D-4.1: **25 %** of the ride's speed, so a
 * payout below 9.6 m/s takes `CRASH_STOP_SECONDS / 0.25`, 7.2 s.
 */
export const CRASH_PAYOUT_SHARE = 0.25;

/**
 * The speed the drawn rider moves at, for a ride speed `speed`, while an
 * offset is being paid out — ADR 0094 D-4.3: `max(v, min((1 + P) v, 12 m/s))`,
 * never slower than the ride and never faster than every hazard is proved
 * avoidable at.
 */
export function payoutSpeed(speed: number): number {
  return Math.max(
    speed,
    Math.min((1 + CRASH_PAYOUT_SHARE) * speed, AVOIDABLE_FASTEST_METRES_PER_SECOND),
  );
}

/** A Delivery round being ridden, in memory for the ride only. */
export interface DeliveryRide {
  /** The week the round is ridden in: its `day` is the round's day. */
  readonly week: WeekProgress;
  /** The round's houses as #1808 picked them, for the drawing. */
  readonly targets: readonly DeliveryTarget[];
  /** The same houses as the throw reads them. */
  readonly throwTargets: readonly ThrowTarget[];
  readonly round: Round;
  readonly throws: ThrowState;
  readonly obstacles: readonly Obstacle[];
  readonly obstacleState: ObstacleState;
  /** Every delivery and crash of the round, in the order it happened: a few dozen at most. */
  readonly changes: readonly ScoreChange[];
  /** The round's score with every crash in it, never below nought: `roundScore` of {@link changes}. */
  readonly score: number;
  /**
   * The parcels that came down in the last {@link LANDING_SHOWN_SECONDS} of
   * the throw clock, oldest first (#2577): what the frame marks at the house
   * and the Score field says. A few at most: the throw's cool-down is 0.5 s.
   */
  readonly landed: readonly ParcelLanded[];
  /** The assist's wider windows (#1813), for the throw and for the misses. */
  readonly widerWindows: boolean;
  /**
   * The round's throw window, before the assist widens it (#2931): a level's
   * own (`level-file.ts` §`LevelRound.throwWindow`), or `throw.ts`
   * §`DEFAULT_THROW_WINDOW` on a rider's own route. The throw, the misses and
   * {@link nextHouse} all read it.
   */
  readonly throwWindow: ThrowWindow;
  /** Where the rider has steered across the road (#1820), stepped on every step that ran. */
  readonly steer: SteerState;
  /**
   * Where the rider is DRAWN after the last step that ran, metres: the ride
   * distance plus {@link crashOffset} (#3021, ADR 0094 D-2.3). Everything the
   * round decides reads this, never the odometer.
   */
  readonly along: number;
  /**
   * The ride distance after the last step that ran, metres: the simulation's
   * own odometer, as {@link DeliveryRideStep.along} handed it. Read only to
   * share the next frame's distance between its steps.
   */
  readonly rideAlong: number;
  /**
   * How far the drawn rider is behind the ride, metres: in
   * `[-CRASH_OFFSET_BOUND_METRES, 0]`, nought but after a crash (ADR 0094 D-2.2).
   */
  readonly crashOffset: number;
  /** {@link crashOffset} one step before the last, which the drawing blends from. */
  readonly crashOffsetBefore: number;
  /** Steps left of a crash's stop: nought while the rider is up (ADR 0094 D-3). */
  readonly stopTicks: number;
  /** The round's end, once every house is settled or the ride has ended it. */
  readonly outcome: RoundOutcome | undefined;
  /** A built-in level's round (#2362): its end is never kept as the week's (ADR 0065 D-9.3). */
  readonly onLevel: boolean;
  /**
   * The houses on a level that must not get a parcel (#2365), for the drawing
   * and the warning; never on the round. Each `position` is its place here.
   */
  readonly noDeliveryTargets: readonly DeliveryTarget[];
  /** The same houses as the throw reads them. */
  readonly throwNoDelivery: readonly ThrowTarget[];
  /**
   * A parcel at one of them costs {@link NO_DELIVERY_SCORE_DELTA} (#2365);
   * `false` with the assist's no fail on, when it costs nothing (DL10).
   */
  readonly noDeliveryCosts: boolean;
  /** The level's id, on a level (#2363): what its end keeps as finished (ADR 0065 D-9.2). */
  readonly levelId: string | undefined;
  /**
   * The level's weather and light (#2366, ADR 0065 D-10.4), for the drawing
   * only: rain and dusk. Clear daylight on a rider's own route.
   */
  readonly weather: DeliveryWeather;
  /**
   * How near a house the rider must be for its marker to be drawn, metres
   * (#2366): `in-view.ts` §`LOW_LIGHT_REVEAL_METRES` in rain or at dusk,
   * `undefined` — no nearer than the corridor draws — in clear daylight or
   * with the assist's wider windows on (DL10: no hidden targets).
   */
  readonly revealMetres: number | undefined;
}

/** A round's weather and light, as the drawing reads them (#2366). */
export interface DeliveryWeather {
  readonly rain: boolean;
  readonly dusk: boolean;
}

/** What a round needs at the press. */
export interface DeliveryRideStart {
  /** The ride's planned mapped buildings, indexed at the press. */
  readonly buildings: MappedBuildings;
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  /** The rider's odometer reading at the press, metres. */
  readonly riderDistance: number;
  /**
   * The racing line's offset at the press, metres right of the centre line
   * (`racing-line.ts` §`lineOffsetAt`): the steering starts from it.
   */
  readonly lineOffset: number;
  /**
   * The device's storage, for the week it has kept (`delivery-progress.ts`)
   * and the assist setting (`assist-preference.ts`), both read here so that
   * nothing outside Delivery's own modules reads the setting (#1813's test).
   */
  readonly storage: PreferenceStorage | undefined;
  /**
   * A built-in level's round (#2362, ADR 0065 D-4.1): its houses, its
   * hazards for the obstacles, and the level's own stated length, which the
   * obstacles' most is read off (`obstacles.ts` §`levelObstacleMix`): the
   * file's `lengthMetres`, never the road as measured, so one length is used
   * everywhere (review of PR #2378, round 6). Absent, the week's round on a
   * rider's route.
   */
  readonly level?:
    | (Pick<LevelRound, 'houses' | 'hazardsPerKilometre'> &
        Partial<
          Pick<LevelRound, 'mailboxShare' | 'noDeliveryShare' | 'weather' | 'light' | 'throwWindow'>
        > & {
          readonly lengthMetres: number;
          /** The level's id (#2363): its round's end opens the next level (ADR 0065 D-9). */
          readonly id: string;
        })
    | undefined;
  /**
   * #3153: the round's seed, set by capture mode alone (`capture-scene.ts`,
   * which only the capture tool's build reads), so a scene picks the same
   * houses and obstacles twice. Absent — every rider's round — it is drawn
   * at the press.
   */
  readonly seed?: number | undefined;
}

/**
 * Start the round the week asks for, at the press: its houses picked, its
 * obstacles placed, both from one seed drawn here and kept by nothing.
 * A pick short of the week's count rides every house it found, and
 * `undefined` is a short pick of fewer than {@link FEWEST_DELIVERY_HOUSES}
 * (#1818). @see the header
 */
export function startDeliveryRide(input: DeliveryRideStart): DeliveryRide | undefined {
  const week = readDeliveryProgress(input.storage);
  const assist = readDeliveryAssist(input.storage);
  const seed = input.seed ?? drawRoundSeed();
  const pick = pickRoundTargets(
    {
      buildings: input.buildings,
      profile: input.profile,
      origin: input.origin,
      riderDistance: input.riderDistance,
      houses: input.level?.houses ?? week.houses,
      // #2365: a level's mailboxes and houses that get no parcel, from this seed.
      shares:
        input.level === undefined
          ? undefined
          : {
              mailbox: input.level.mailboxShare ?? 0,
              noDelivery: input.level.noDeliveryShare ?? 0,
            },
    },
    seed,
  );
  const last = pick.targets.at(-1);
  if (last === undefined || (!pick.complete && pick.targets.length < FEWEST_DELIVERY_HOUSES)) {
    return undefined;
  }
  const furthest = Math.max(last.distance, pick.noDelivery.at(-1)?.distance ?? 0);
  const weather: DeliveryWeather = {
    rain: input.level?.weather === 'rain',
    dusk: input.level?.light === 'dusk',
  };
  const obstacles = placeObstacles(
    { from: input.riderDistance, to: furthest + TARGET_WINDOW_HALF_METRES },
    seed,
    assist.obstacles,
    // A round runs solo only, so its rider can always steer (DL9).
    true,
    input.level === undefined ? undefined : levelObstacleMix(input.level, input.level.lengthMetres),
  );
  return {
    week,
    targets: pick.targets,
    throwTargets: pick.targets.map(throwTargetOf),
    round: startRound(pick.targets.length, {
      assisted: assist.noFail,
      dayHouses: input.level?.houses ?? week.houses,
    }),
    throws: NO_PARCELS,
    obstacles,
    obstacleState: startObstacles(obstacles),
    changes: [],
    score: 0,
    landed: [],
    widerWindows: assist.widerWindows,
    // #2931: a level's own window; a rider's own route keeps the throw's.
    throwWindow: input.level?.throwWindow ?? DEFAULT_THROW_WINDOW,
    steer: startSteer(input.lineOffset),
    along: input.riderDistance,
    rideAlong: input.riderDistance,
    crashOffset: 0,
    crashOffsetBefore: 0,
    stopTicks: 0,
    outcome: undefined,
    onLevel: input.level !== undefined,
    noDeliveryTargets: pick.noDelivery,
    throwNoDelivery: pick.noDelivery.map(throwTargetOf),
    noDeliveryCosts: !assist.noFail,
    levelId: input.level?.id,
    weather,
    // #2366: a marker shows only once the rider is closer, unless the assist widens the windows.
    revealMetres:
      (weather.rain || weather.dusk) && !assist.widerWindows ? LOW_LIGHT_REVEAL_METRES : undefined,
  };
}

/** A picked house as the throw reads it: its doorstep, or its mailbox (#2365). */
function throwTargetOf(target: DeliveryTarget): ThrowTarget {
  return {
    position: target.position,
    along: target.distance,
    side: target.side === 1 ? 'right' : 'left',
    clear: Math.max(0, target.fromRoad - CARRIAGEWAY_HALF_WIDTH_METRES),
    ...(target.mailbox === true ? { mailbox: true } : {}),
  };
}

/** One frame's simulation steps, as the ride hands them over. */
export interface DeliveryRideStep {
  /** How many simulation steps ran on this frame: `SimulationTick.steps`. Nought steps nothing. */
  readonly ticks: number;
  /**
   * The ride distance after them, metres: the simulation's own odometer. The
   * round draws the rider at it plus {@link DeliveryRide.crashOffset}, and
   * hands nothing back to it (ADR 0094 D-2.4).
   */
  readonly along: number;
  /** The rider's speed after them, metres a second, which a parcel thrown now carries. */
  readonly speed: number;
  /** A throw the rider asked for since the last step, already resolved to a side. */
  readonly throwTo?: ThrowSide | undefined;
}

/** What one frame's steps did. */
export interface DeliveryRideStepped {
  readonly ride: DeliveryRide;
  /** Crashes counted on these steps; nought once the round is over, and while the rider is down. */
  readonly crashes: number;
  /** The throw asked for was taken: `false` when none was, or the cool-down refused it. */
  readonly thrown: boolean;
  /** Parcels a house that must not get one caught on these steps (#2365); nought once the round is over. */
  readonly noDeliveries: number;
  /** Every parcel that came down on these steps, in the order it did (#2577), after the round's end too. */
  readonly landed: readonly ParcelLanded[];
}

/** Every house whose window has closed behind the rider with no parcel still able to reach it, missed. */
function recordMisses(
  round: Round,
  throws: ThrowState,
  targets: readonly ThrowTarget[],
  along: number,
  window: ThrowWindow,
  scale: number,
): Round {
  let settled = round;
  for (const target of targets) {
    if (settled.houses[target.position] !== 'expecting') continue;
    if (along <= target.along + window.afterMetres * scale) continue;
    const coming = throws.inFlight.some(
      (parcel) =>
        parcel.side === target.side && insideThrowWindow(parcel.launchAlong, target, window, scale),
    );
    if (!coming) settled = recordMiss(settled, target.position);
  }
  return settled;
}

/**
 * Run the frame's simulation steps through the round: the throw asked for,
 * the parcels, the misses, the steering and the obstacles, one tick of each a
 * step.
 * @see the header
 */
export function stepDeliveryRide(ride: DeliveryRide, step: DeliveryRideStep): DeliveryRideStepped {
  const { ticks } = step;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a Delivery ride step runs a whole number of ticks, 0 or more');
  }
  if (ticks === 0) return { ride, crashes: 0, thrown: false, noDeliveries: 0, landed: [] };
  const scale = ride.widerWindows ? ASSISTED_THROW_SCALE : 1;
  const from = ride.rideAlong;
  // Never backwards: a room's correction does not run on a Delivery ride
  // (DL9), and a distance that went back would sweep no road.
  const to = Math.max(from, step.along);
  let { round, throws, obstacleState, outcome, steer, crashOffset, crashOffsetBefore, stopTicks } =
    ride;
  const changes = [...ride.changes];
  // #2577: the score as it moves change by change, so each landing says what it earned.
  let score = ride.score;
  const landedNow: ParcelLanded[] = [];
  let crashes = 0;
  let noDeliveries = 0;
  let thrown = false;
  let rideBefore = from;
  let before = ride.along;
  for (let tick = 1; tick <= ticks; tick += 1) {
    const rideAt = from + ((to - from) * tick) / ticks;
    const covered = rideAt - rideBefore;
    rideBefore = rideAt;
    // #3021, ADR 0094: the drawn rider, held while down and paid out after.
    const down = stopTicks > 0;
    const paying = !down && crashOffset < 0;
    crashOffsetBefore = crashOffset;
    if (down) {
      // D-3.1, D-3.2: held, until the bound is reached, which ends the stop.
      crashOffset = Math.max(-CRASH_OFFSET_BOUND_METRES, crashOffset - covered);
      stopTicks = crashOffset <= -CRASH_OFFSET_BOUND_METRES ? 0 : stopTicks - 1;
    } else if (paying) {
      // D-4.1, D-4.3: faster than the ride by P, never past the fastest avoidable speed.
      const drawnMove = payoutSpeed(covered / DELIVERY_TICK_SECONDS) * DELIVERY_TICK_SECONDS;
      crashOffset = Math.min(0, crashOffset + drawnMove - covered);
    }
    const at = rideAt + crashOffset;
    const thrownNow = stepThrows(throws, {
      // A parcel carries the speed the rider is drawn at.
      rider: { along: before, speed: paying ? payoutSpeed(step.speed) : step.speed },
      targets: ride.throwTargets,
      round,
      // D-3.3: no throw is taken while the rider is down.
      ...(tick === 1 && step.throwTo !== undefined && !down ? { throwTo: step.throwTo } : {}),
      widerWindows: ride.widerWindows,
      noDelivery: ride.throwNoDelivery,
      window: ride.throwWindow,
    });
    thrown ||= thrownNow.thrown;
    throws = thrownNow.state;
    steer = stepSteer(steer, DELIVERY_TICK_SECONDS);
    // #2362: while held clear of a parked car already hit, the obstacles meet
    // the rider in the lane they steer to, never at the move-aside's offset,
    // so the move scores no crash of its own (review of PR #2378, round 3).
    // ⚠️ Two couplings, each held by a test (round 4):
    // - `held` is read AFTER the steering's step, so it is true only because
    //   one tick's sideways step carries the rider from the moved offset back
    //   past `PARKED_CAR_CLEARANCE_METRES` into the car's width. A clearance
    //   larger than that step would make `held` flicker false
    //   (`ride-round.test.ts` §"one tick's lane step").
    // - While held, the rider is scored in their lane and drawn beside the car,
    //   so an obstacle at the drawn place would pass through the drawn rider.
    //   No generated round has one there: `placeObstacles` keeps neighbours at
    //   least `OBSTACLE_SIGHT_METRES` (60 m) apart, and a hold lasts at most
    //   the car's length and the bicycle's, about 6 m (`obstacles.test.ts`
    //   §"no other obstacle within a parked car's hold").
    const held =
      clearOfParkedCars(ride.obstacles, obstacleState, { along: at, ...steer }) !== undefined;
    const lateral = held ? (LANE_OFFSETS_METRES[steer.lane] as number) : steer.offset;
    const obstaclesNow = stepObstacles(obstacleState, {
      rider: { along: at, lateral, speed: (at - before) / DELIVERY_TICK_SECONDS },
      obstacles: ride.obstacles,
    });
    obstacleState = obstaclesNow.state;
    // #2362: a parked car hit is drawn as a crash, the rider beside it, never through it.
    steer = clearOfParkedCars(ride.obstacles, obstacleState, { along: at, ...steer }) ?? steer;
    before = at;
    for (const landing of thrownNow.landings) {
      const scoreBefore = score;
      if (outcome === undefined) {
        let change: ScoreChange | undefined;
        if (landing.kind === 'delivery') change = 'delivery';
        // #2365: a parcel at a house that must not get one costs, and never pays.
        if (landing.kind === 'no-delivery') {
          noDeliveries += 1;
          if (ride.noDeliveryCosts) change = { scoreDelta: NO_DELIVERY_SCORE_DELTA };
        }
        if (change !== undefined) {
          changes.push(change);
          score = scoreAfter(score, change);
        }
      }
      // #2577: every landing is shown, the round over or not; only what it earned is the round's.
      landedNow.push(landedOf(landing, score - scoreBefore));
    }
    if (outcome !== undefined) continue;
    // D-3.3: a contact while the rider is down costs nothing. A crash counted
    // starts a stop from the offset as it stands (D-4.4).
    if (!down && obstaclesNow.crashes.length > 0) {
      for (const crash of obstaclesNow.crashes) score = scoreAfter(score, crash);
      changes.push(...obstaclesNow.crashes);
      crashes += obstaclesNow.crashes.length;
      stopTicks = CRASH_STOP_TICKS;
    }
    round = recordMisses(thrownNow.round, throws, ride.throwTargets, at, ride.throwWindow, scale);
    if (roundTally(round).expecting === 0) outcome = endRound(ride.week, round);
  }
  return {
    ride: {
      ...ride,
      round,
      throws,
      obstacleState,
      changes,
      score: roundScore(changes),
      // #2577: what came down in the last LANDING_SHOWN_TICKS of the throw clock.
      landed: [...ride.landed, ...landedNow].filter(
        (landed) => throws.tick - landed.tick < LANDING_SHOWN_TICKS,
      ),
      steer,
      along: to + crashOffset,
      rideAlong: to,
      crashOffset,
      crashOffsetBefore,
      stopTicks,
      outcome,
    },
    crashes,
    thrown,
    noDeliveries,
    landed: landedNow,
  };
}

/** A throw's landing as the rider is shown it, with what it earned (#2577). */
function landedOf(landing: Landing, points: number): ParcelLanded {
  const at = {
    tick: landing.tick,
    along: landing.along,
    across: landing.across,
    side: landing.side,
  };
  switch (landing.kind) {
    case 'delivery':
      return { kind: 'delivered', points, house: landing.position, ...at };
    case 'no-delivery':
      return { kind: 'no-delivery', points, house: landing.house, ...at };
    case 'wasted':
      return { kind: 'missed', points: 0, ...at };
  }
}

/**
 * Where to draw a round's rider, from where the simulation's blend draws the
 * ride (`simulation.ts` §`drawnAt`) and the same `blend`: 0 the step before
 * the newest, 1 the newest — #3021, ADR 0094 D-6.1. The offset is blended
 * between the same two steps, so a held rider is drawn still rather than
 * creeping on and jumping back at each step. The camera follows this.
 */
export function drawnRiderDistance(
  ride: Pick<DeliveryRide, 'crashOffset' | 'crashOffsetBefore'>,
  rideDistance: number,
  blend: number,
): number {
  const share = Math.min(1, Math.max(0, blend));
  return (
    rideDistance + ride.crashOffsetBefore + (ride.crashOffset - ride.crashOffsetBefore) * share
  );
}

/**
 * The round's end: the one it reached, or the one a ride ending now gives it
 * (#1857). Then a house whose window has closed behind the rider and that was
 * not delivered is missed, though a parcel thrown to it is still in the air:
 * the ride is over, so it cannot land. A house the rider has not yet passed is
 * neither, and `round.ts` §`endRound` counts it for nothing.
 */
export function endDeliveryRide(ride: DeliveryRide): RoundOutcome {
  if (ride.outcome !== undefined) return ride.outcome;
  const scale = ride.widerWindows ? ASSISTED_THROW_SCALE : 1;
  return endRound(
    ride.week,
    recordMisses(ride.round, NO_PARCELS, ride.throwTargets, ride.along, ride.throwWindow, scale),
  );
}

/**
 * Where the next house on the round is from the rider — #2453: which side of
 * the road, and how far ahead along it, so the HUD can say where to throw
 * without the rider having to spot the house's marker. A side and a distance
 * from the rider, never a place (DL11).
 *
 * ⚠️ **Since #2513 the distance is to the THROW POINT, not to the house.** The
 * owner's frame of 2026-11-12 read "Next house 0 ft on the right" level with
 * the house, which is beside and behind the chase camera and out of frame:
 * the countdown pointed the rider at the one place the house cannot be seen,
 * and a parcel thrown there is thrown late. It now counts down to where the
 * house's throw window opens (`throw.ts` §`THROW_WINDOW_BEFORE_METRES`, 20 m
 * before it, or a level's own since #2931), and reaches nought there; from there until the window closes
 * the HUD says to throw (the owner's ruling of 2026-11-12 on #2513).
 */
export interface NextHouse {
  readonly side: ThrowSide;
  /**
   * Metres along the road from the rider to where the house's throw window
   * opens; nought once the rider is inside the window, until it closes
   * behind them. A reviewer who remembers this as the distance to the house
   * is reading the file before #2513.
   */
  readonly metres: number;
}

/**
 * The next house still expecting a parcel, in route order, from where the
 * rider is after the last step that ran — #2453. A house the rider is level
 * with or has just passed stays the next one, at nought metres, until its
 * window closes behind them and the round counts it missed
 * ({@link DeliveryRide.throwWindow}'s closing edge): it can still be delivered
 * to. `undefined` when no house on the round is still expecting one. Its
 * distance is to the window's opening edge, the round's `beforeMetres` before
 * the house (#2513; a level's own since #2931), which the assist's wider
 * windows do not move (`throw.ts` §"Wider windows").
 */
export function nextHouse(ride: DeliveryRide): NextHouse | undefined {
  let next: DeliveryTarget | undefined;
  for (const target of ride.targets) {
    if (ride.round.houses[target.position] !== 'expecting') continue;
    if (next === undefined || target.distance < next.distance) next = target;
  }
  if (next === undefined) return undefined;
  return {
    side: next.side === 1 ? 'right' : 'left',
    metres: Math.max(0, next.distance - ride.throwWindow.beforeMetres - ride.along),
  };
}

/**
 * The side a throw the rider asked for goes to on this round (#1810), or
 * `undefined` for *the next house* when none is left: `throw.ts`
 * §`throwSideFor` over the round as it stands, where a house is behind once
 * the round's own window ({@link DeliveryRide.throwWindow}, a level's since
 * #2931) has closed past it. `GameView` calls it when the HUD's throw control
 * hands it an intent.
 */
export function throwSideOn(ride: DeliveryRide, intent: ThrowIntent): ThrowSide | undefined {
  return throwSideFor(intent, {
    targets: ride.throwTargets,
    round: ride.round,
    along: ride.along,
    window: ride.throwWindow,
  });
}

/**
 * Keep the week's counts for the next ride, from the round's end — counts
 * only (DL11, `delivery-progress.ts`). `false` when the device refused, and
 * when the round was a built-in level's, which keeps nothing of the week
 * (#2362, ADR 0065 D-9.3).
 */
export function keepDeliveryWeek(
  storage: PreferenceStorage | undefined,
  outcome: RoundOutcome,
  ride?: Pick<DeliveryRide, 'onLevel'>,
): boolean {
  if (ride?.onLevel === true) return false;
  return writeDeliveryProgress(storage, outcome.next);
}

/**
 * Keep a built-in level finished, from a round that reached its own end —
 * #2363, ADR 0065 D-9: every house on it settled, delivered or missed, with
 * the assisted setting on or off (D-9.1, DL10). The level's id only, in
 * `level-progress.ts`, and never the week's counts (D-9.3). `false` for a
 * round on a rider's own route, a round not yet at its end (a ride ended
 * first finishes no level), and a device that refused.
 */
export function keepLevelFinished(
  storage: PreferenceStorage | undefined,
  ride: Pick<DeliveryRide, 'levelId' | 'outcome'>,
): boolean {
  if (ride.levelId === undefined || ride.outcome === undefined) return false;
  return writeLevelProgress(storage, withLevelFinished(readLevelProgress(storage), ride.levelId));
}
