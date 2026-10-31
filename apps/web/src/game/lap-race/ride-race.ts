// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A solo lap race inside a game ride — #1906 (epic #1894, ADR 0060).
 *
 * `GameView` holds one {@link LapRaceRide} for a ride that runs a race, and
 * this module is the whole of what it does with one: {@link startLapRaceRide}
 * at the press, {@link stepLapRaceRide} on every simulation step that ran,
 * {@link lapRaceHeard} after the HUD's one region has spoken, and
 * {@link lapRaceDrawing} and {@link lapRaceHud} for the frame and the HUD. It
 * composes the model (`@onyourleft/domain` §`stepRace`, through
 * `@onyourleft/physics` §`stepBotRace` for the bots), the rider's inputs
 * (`race-input.ts`), the assisted setting (`assist.ts`), the drawing
 * (`in-view.ts`) and the HUD's sentences (`hud/lap-race-announce.ts`); what
 * each of those decides is still theirs.
 *
 * ## Nothing here reaches the trainer (ADR 0060 D-2)
 *
 * The rider's distance comes IN, from the simulation's own odometer, and is
 * the rider's **effort distance** (D-3.1): the ride's odometer less where it
 * stood at the line. Nothing goes back. An item moves the rider's
 * `raceOffset`, which only {@link lapRaceDrawing} reads, to draw the rider
 * there (D-3.3); the grade the trainer is sent is still read at the
 * simulation's odometer by `gradient.ts`, which this module cannot reach
 * (`lap-race-cannot-reach-trainer.test.ts`). `lap-race-wiring.test.tsx` rides
 * one power trace as an ordinary ride and as a race with items off and on,
 * and holds every grade written and its time equal.
 *
 * ## The steps that ran, and only those
 *
 * As Delivery's round (`delivery/ride-round.ts` §"The steps that ran"): one
 * race tick per simulation step, {@link LAP_RACE_TICK_SECONDS} of race each,
 * so a paused ride steps nothing and the bots skip exactly the time the rider
 * skips. A frame that ran several steps shares the frame's distance between
 * them. The race's clock starts at nought at the line and moves 50 ms a tick.
 *
 * ## The race ends at the line, and the ride goes on
 *
 * The rider's finish is the model's (`race.ts` §`settle`), said once
 * (`lap-race-announce.ts`). The race keeps stepping after it, so the bots
 * still riding finish too and the standings fill in, and the ride records on
 * until the rider ends it. A ride ended first just drops the race: nothing of
 * it is kept (ADR 0060 D-12.2: no history of item events or positions against
 * bots is stored), so there is nothing to settle and nothing to wait for.
 *
 * ## The seed
 *
 * Drawn once at the press from the platform's cryptographic source, handed
 * to the race and to the bots' decisions, and never stored, as Delivery's
 * (`delivery/targets.ts` §`drawRoundSeed`), restated here because the lap
 * race reaches none of Delivery's modules.
 *
 * ## The bots ride still air
 *
 * A bot's course is the rider's road and air ({@link LapRaceRideStart.conditions}),
 * but never the rider's chosen wind: `simulation.ts` resolves that per step at
 * each rider's heading, privately, for its one pacer. A race on a windy ride
 * has the rider in the wind and the bots out of it. Stated, not fixed.
 */

import {
  BOT_MASS_KILOGRAMS,
  createItemRace,
  racePosition,
  raceCourse,
  seconds,
  type BotTier,
  type ItemRaceState,
  type RouteProfile,
} from '@onyourleft/domain';
import {
  lapRaceBot,
  stepBotRace,
  type LapRaceBot,
  type LapRaceBotConditions,
} from '@onyourleft/physics';

import type { PreferenceStorage } from '../hud/announce-preference';
import type { AnnouncementEvent, AnnouncementKind } from '../hud/announce';
import {
  lapRaceEvents,
  lapRaceOwedAtStart,
  lapRaceSpoken,
  oweRaceTick,
  type LapRaceOwed,
} from '../hud/lap-race-announce';
import { botName, riderEntry, type LapRaceEntrant, type LapRaceHud } from '../hud/lap-race-hud';
import type { SteerIntent } from '../lanes';
import type { LapRaceInView, RaceHitLook } from '../port';
import type { RaceBotInput } from '../scene';

import { assistedBotTier, assistedRaceSetup, assistedTick } from './assist';
import { readLapRaceAssist, type LapRaceAssist } from './assist-preference';
import { hitLook, laneLateral, lapRaceInView } from './in-view';
import {
  askLane,
  askToUseItem,
  riderTick,
  startRiderInput,
  stepRiderInput,
  type RiderRaceInput,
} from './race-input';

/** The race's length of one tick: the simulation's step, `simulation.ts` §`SIMULATION_STEP_SECONDS`. */
export const LAP_RACE_TICK_SECONDS = 0.05;

/** The most bots a field holds: seven, the field #1903's draw-call ceiling was measured with. */
export const LAP_RACE_MOST_BOTS = 7;

/** The rider's id in the race. Never shown: the HUD names the rider's own line itself. */
export const LAP_RACE_RIDER_ID = 'rider';

/** What race to run: chosen by the rider (#1907), or handed in by a test. */
export interface LapRaceChoice {
  /** How many laps of the loop. A whole number, at least one. */
  readonly laps: number;
  /** How many bots, 1 to {@link LAP_RACE_MOST_BOTS}. */
  readonly bots: number;
  /** The bots' tier, before the assisted setting's gentler bots. */
  readonly tier: BotTier;
  /** Whether the race has items, before the assisted setting's items off. */
  readonly itemsOn: boolean;
}

/** A lap race being ridden, in memory for the ride only. */
export interface LapRaceRide {
  readonly race: ItemRaceState;
  readonly bots: readonly LapRaceBot[];
  /** The race's one seed, for the bots' decisions. Never stored. */
  readonly seed: number;
  readonly assist: LapRaceAssist;
  /** The rider's lane and item use since the last tick (`race-input.ts`). */
  readonly input: RiderRaceInput;
  /** The ride's odometer at the line: race distance nought. */
  readonly startAlong: number;
  /** The rider's odometer after the last tick, metres. */
  readonly along: number;
  readonly conditions: LapRaceBotConditions;
  /** Each bot's name in the standings, by id. */
  readonly names: Readonly<Record<string, string>>;
  /** What is still to be said about the race (`hud/lap-race-announce.ts`). */
  readonly owed: LapRaceOwed;
}

/** What a race needs at the press. */
export interface LapRaceRideStart {
  readonly choice: LapRaceChoice;
  readonly profile: RouteProfile;
  /** The road and the air the bots ride: the rider's own, without their mass or their wind. */
  readonly conditions: LapRaceBotConditions;
  /** The rider's odometer at the press, metres: the line. */
  readonly riderDistance: number;
  /** The racing line's offset at the press (`racing-line.ts` §`lineOffsetAt`): steering starts there. */
  readonly lineOffset: number;
  /** The device's storage, for the assisted setting (`assist-preference.ts`). */
  readonly storage: PreferenceStorage | undefined;
}

/**
 * The course a race's bots ride: the rider's road and air, as `simulation.ts`
 * §`botCourseFor` builds its one pacer's — never the rider's mass (the bots
 * ride at their own 75 kg, ADR 0028 D-3) and never a headwind (see the header).
 */
export function lapRaceBotConditions(
  profile: RouteProfile,
  air: {
    readonly airDensityKilogramsPerCubicMetre: number;
    readonly coefficients?: LapRaceBotConditions['coefficients'];
    readonly integrationStepSeconds?: number | undefined;
  },
): LapRaceBotConditions {
  return {
    profile,
    airDensityKilogramsPerCubicMetre: air.airDensityKilogramsPerCubicMetre,
    ...(air.coefficients === undefined ? {} : { coefficients: air.coefficients }),
    ...(air.integrationStepSeconds === undefined
      ? {}
      : { integrationStepSeconds: air.integrationStepSeconds }),
  };
}

/** The race's seed, from the platform's cryptographic random source: one draw, at the press. */
function drawRaceSeed(): number {
  const drawn = new Uint32Array(1);
  crypto.getRandomValues(drawn);
  return drawn[0] as number;
}

/**
 * Start the race the rider chose, on the line, at the press: or `undefined`
 * on a route that is not a loop, which has no lap to race (ADR 0060 D-11.1).
 *
 * @throws {RangeError} for a field that is not 1 to {@link LAP_RACE_MOST_BOTS}
 * bots, naming the constraint and never the value; and through
 * `@onyourleft/domain` §`raceCourse` for laps that cannot be raced.
 */
export function startLapRaceRide(input: LapRaceRideStart): LapRaceRide | undefined {
  const { choice, profile } = input;
  if (!profile.loop) return undefined;
  if (!Number.isInteger(choice.bots) || choice.bots < 1 || choice.bots > LAP_RACE_MOST_BOTS) {
    throw new RangeError(
      `a lap race has a whole number of bots, 1 to ${String(LAP_RACE_MOST_BOTS)}`,
    );
  }
  const course = raceCourse(profile.totalDistance, choice.laps);
  const assist = readLapRaceAssist(input.storage);
  const seed = drawRaceSeed();
  const tier = assistedBotTier(assist, choice.tier);
  const ids = Array.from({ length: choice.bots }, (_, index) => `bot-${String(index + 1)}`);
  const race = createItemRace(
    assistedRaceSetup(
      assist,
      {
        course,
        seed,
        itemsOn: choice.itemsOn,
        racerIds: [LAP_RACE_RIDER_ID, ...ids],
        startMs: 0,
      },
      LAP_RACE_RIDER_ID,
    ),
  );
  return {
    race,
    bots: ids.map((id) => lapRaceBot(id, tier)),
    seed,
    assist,
    input: startRiderInput(input.lineOffset),
    startAlong: input.riderDistance,
    along: input.riderDistance,
    conditions: input.conditions,
    names: Object.fromEntries(ids.map((id, index) => [id, botName(tier, index + 1)])),
    owed: lapRaceOwedAtStart(race, LAP_RACE_RIDER_ID),
  };
}

/** The race after the rider asked for a lane change: taken by the next tick. */
export function askRaceLane(ride: LapRaceRide, intent: SteerIntent): LapRaceRide {
  const input = askLane(ride.input, intent);
  return input === ride.input ? ride : { ...ride, input };
}

/** The race after the rider asked to use their held item: taken by the next tick. */
export function askRaceItem(ride: LapRaceRide): LapRaceRide {
  const input = askToUseItem(ride.input);
  return input === ride.input ? ride : { ...ride, input };
}

/** One frame's simulation steps, as the ride hands them over. */
export interface LapRaceRideStep {
  /** How many simulation steps ran on this frame: `SimulationTick.steps`. Nought steps nothing. */
  readonly ticks: number;
  /** The rider's odometer after them, metres: the simulation's own. */
  readonly along: number;
}

/**
 * Run the frame's simulation steps through the race, one tick a step: the
 * rider's steering eased, their lane and any item use handed in (with the
 * assist's auto-use), the bots decided and ridden, and what changed for the
 * rider owed to the HUD's region.
 *
 * @throws {RangeError} for a count of ticks that is not a whole number of
 * nought or more; and through the model for anything it refuses.
 */
export function stepLapRaceRide(ride: LapRaceRide, step: LapRaceRideStep): LapRaceRide {
  const { ticks } = step;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a lap race step runs a whole number of ticks, 0 or more');
  }
  if (ticks === 0) return ride;
  const from = ride.along;
  // Never backwards: a race runs on a solo ride, where no room corrects the rider.
  const to = Math.max(from, step.along);
  let { race, bots, input, owed } = ride;
  for (let tick = 1; tick <= ticks; tick += 1) {
    const at = from + ((to - from) * tick) / ticks;
    input = stepRiderInput(input, LAP_RACE_TICK_SECONDS);
    const asked = riderTick(input, LAP_RACE_RIDER_ID);
    input = asked.next;
    const rider = assistedTick(ride.assist, race, LAP_RACE_RIDER_ID, {
      atMs: race.atMs,
      effortDistances: { [LAP_RACE_RIDER_ID]: at - ride.startAlong },
      lanes: asked.lanes,
      uses: asked.uses,
    });
    const before = race;
    const stepped = stepBotRace(race, bots, {
      elapsed: seconds(LAP_RACE_TICK_SECONDS),
      conditions: ride.conditions,
      seed: ride.seed,
      rider: {
        effortDistances: rider.effortDistances,
        ...(rider.lanes === undefined ? {} : { lanes: rider.lanes }),
        ...(rider.uses === undefined ? {} : { uses: rider.uses }),
      },
    });
    race = stepped.race;
    bots = stepped.bots;
    owed = oweRaceTick(
      owed,
      before,
      race,
      LAP_RACE_RIDER_ID,
      (rider.uses ?? []).includes(LAP_RACE_RIDER_ID),
    );
  }
  return { ...ride, race, bots, input, owed, along: to };
}

/** What the race offers the HUD's one region at `now`, ride seconds: one event per kind owed. */
export function lapRaceSaid(ride: LapRaceRide, now: number): readonly AnnouncementEvent[] {
  return lapRaceEvents(ride.owed, now);
}

/** The race once the region has said `kind` at `now` (`undefined`: it said nothing). */
export function lapRaceHeard(
  ride: LapRaceRide,
  kind: AnnouncementKind | undefined,
  now: number,
): LapRaceRide {
  const owed = lapRaceSpoken(ride.owed, kind, now);
  return owed === ride.owed ? ride : { ...ride, owed };
}

/** What a frame of the race draws, beside the frame `scene.ts` builds. */
export interface LapRaceDrawing {
  /** Where to draw the rider: the drawn odometer moved by their race offset (D-3.3). */
  readonly riderDistance: number;
  /** Where the rider has steered across the road: `SceneInput.steeredLateral`. */
  readonly steeredLateral: number;
  readonly riderHit: RaceHitLook | undefined;
  readonly raceBots: readonly RaceBotInput[];
}

/**
 * Where the race draws its racers on a frame. `riderDistance` is the rider's
 * drawn odometer (`simulation.ts` §`drawnAt`, a step behind the newest), and
 * `behindSeconds` how far behind the newest step that is, so each bot is
 * drawn as far back along its own speed and the field moves together.
 */
export function lapRaceDrawing(
  ride: LapRaceRide,
  riderDistance: number,
  behindSeconds: number,
  reducedMotion: boolean,
): LapRaceDrawing {
  const { race } = ride;
  const rider = riderEntry(race, LAP_RACE_RIDER_ID);
  const speeds = new Map(ride.bots.map((bot) => [bot.id, bot.ride.speed as number]));
  const raceBots: RaceBotInput[] = [];
  for (const entry of race.racers) {
    const speed = speeds.get(entry.racer.id);
    if (speed === undefined) continue;
    const hit = hitLook(entry.effects, race.atMs, reducedMotion);
    raceBots.push({
      distanceMetres: ride.startAlong + racePosition(entry.racer) - speed * behindSeconds,
      speedMetresPerSecond: speed,
      lateralMetres: laneLateral(entry.lane),
      ...(hit === undefined ? {} : { hit }),
    });
  }
  return {
    riderDistance: riderDistance + rider.racer.raceOffset,
    steeredLateral: ride.input.steer.offset,
    riderHit: hitLook(rider.effects, race.atMs, reducedMotion),
    raceBots,
  };
}

/** A race with items off draws no pick-up point: there is nothing to pick up there. */
const NOTHING_TO_DRAW: LapRaceInView = Object.freeze({ pickUps: [], hazards: [] });

/**
 * The race's pick-ups and puddles on the frame's corridor: `port.ts`
 * §`SceneFrame.lapRace`. None with items off, whether the rider chose no
 * items or the assisted setting took them away: a marker on the road that
 * gives nothing would be a promise the race does not keep.
 */
export function lapRaceFrame(
  ride: LapRaceRide,
  corridor: Parameters<typeof lapRaceInView>[0]['corridor'],
): LapRaceInView {
  if (!ride.race.itemsOn) return NOTHING_TO_DRAW;
  return lapRaceInView({ corridor, race: ride.race, startAlong: ride.startAlong });
}

/**
 * The race as the HUD reads it: the standings' names and each bot's W/kg at
 * its fixed mass (never watts, ADR 0060 D-12.2), and the rider's.
 */
export function lapRaceHud(
  ride: LapRaceRide,
  rider: { readonly wattsPerKilogram: number | undefined; readonly speed: number },
): LapRaceHud {
  const entrants: Record<string, LapRaceEntrant> = {};
  for (const bot of ride.bots) {
    entrants[bot.id] = {
      name: ride.names[bot.id] ?? bot.id,
      wattsPerKilogram: bot.power > 0 ? (bot.power as number) / BOT_MASS_KILOGRAMS : undefined,
    };
  }
  return {
    race: ride.race,
    riderId: LAP_RACE_RIDER_ID,
    entrants,
    riderWattsPerKilogram: rider.wattsPerKilogram,
    speedMetresPerSecond: rider.speed,
  };
}
