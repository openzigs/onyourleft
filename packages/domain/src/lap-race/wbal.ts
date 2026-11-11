// SPDX-License-Identifier: Apache-2.0

/**
 * A lap-race bot's W′ balance — #2458,
 * [ADR 0067](../../../../docs/adr/0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md)
 * D-1 and D-2.
 *
 * Every bot has a **capacity**, fixed at the start (ADR 0067 D-1.1): a critical
 * power (CP), the most it can hold for as long as a race lasts, and **W′**, a
 * store of work it can do above CP before it must ease. The balance, `wbal`,
 * is what is left of W′. An attack spends it, and a bot that spends all of it
 * fades to CP until it has recovered some. Strategy decides when to spend;
 * nothing here changes how much there is.
 *
 * ## The model: the discrete differential form
 *
 * Froncioni, Skiba and Clarke's form, GoldenCheetah's default. Per tick of
 * `dt` seconds at power `P`:
 *
 * ```
 * if P > CP:  wbal -= (P - CP) * dt
 * else:       wbal += (CP - P) * dt * (W' - wbal) / W'
 * ```
 *
 * The balance starts full, at W′, and is clamped to `[0, W′]`. **At 0 the bot
 * is exhausted**: {@link spendableWatts} caps its power at CP until the
 * balance has recovered past {@link BOT_WBAL_REENTRY_FRACTION} of W′.
 *
 * Recovery slows as the balance fills, because of the `(W′ − wbal)/W′` term,
 * so it never overshoots W′. Since #2459 the recovery term is times the
 * capacity's `recoveryFactor`, its archetype's rate (1 where none is named):
 * a rouleur recovers faster than the form's own rate. It also depends on how far under CP the bot
 * rides: a bot at CP neither spends nor recovers.
 *
 * ## Only `+ − × ÷` (ADR 0067 D-5.2)
 *
 * This module uses arithmetic, comparisons, `Math.min` and `Math.max` and
 * nothing else, so it gives the same bits on x86 and ARM, as
 * `packages/physics/src/draft.ts` requires of itself. A later room ADR need not
 * reopen the model. **Not** the integral form, whose time constant
 * `546·e^(−0.01·DCP) + 316` needs an exponential and was fitted on untrained
 * subjects. `wbal.test.ts` scans this file for an exponential, a power, a
 * random draw and a clock.
 *
 * ## Tick-rate independence
 *
 * Spending is exact at any tick. Recovery is a forward step of an exponential
 * approach, whose error per tick grows with the tick; at the rates a race
 * recovers at, a 60 s trace stepped at 0.05 s and at 1 s ends within
 * {@link BOT_WBAL_TICK_TOLERANCE} of W′ of itself (`wbal.test.ts`).
 */

import { BOT_MASS_KILOGRAMS, MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM } from '../pacer/pacing';
import { LapRaceError } from './errors';

/** What a bot can do, fixed at the start of a race (ADR 0067 D-1.1). Watts and joules. */
export interface BotCapacity {
  /** Its critical power: what it holds without spending W′. */
  readonly cpWatts: number;
  /** Its W′: the work it can do above {@link cpWatts} from full. */
  readonly wPrimeJoules: number;
  /** The most it ever rides: the surge ceiling (ADR 0061 D-8.2). */
  readonly peakWatts: number;
  /** The least it ever rides: #92's −20 % floor of its tier (ADR 0061 D-8.2). */
  readonly floorWatts: number;
  /**
   * How fast it recovers under CP, as a multiple of the form's own rate: its
   * archetype's (`archetype.ts` §`BOT_ARCHETYPE_RECOVERY_FACTOR`, #2459).
   * Absent, 1.
   */
  readonly recoveryFactor?: number;
}

/** What is left of a bot's W′, and whether it has run out. */
export interface BotEnergy {
  /** Joules left of W′: from 0 to the capacity's W′. */
  readonly wbalJoules: number;
  /**
   * True from the tick the balance reaches 0 until it recovers past
   * {@link BOT_WBAL_REENTRY_FRACTION} of W′. While it is, the bot rides no
   * more than CP.
   */
  readonly exhausted: boolean;
}

/**
 * How much of W′ an exhausted bot must recover before it may ride above CP
 * again: **a fifth**. ⚠️ A feel number for the owner's approval (#2458). Too
 * small and an empty bot flickers over and under CP every few ticks; too large
 * and a bot that went deep once is out of the race for good.
 */
export const BOT_WBAL_REENTRY_FRACTION = 0.2;

/**
 * How far apart, as a share of W′, the same 60 s trace may end when it is
 * stepped at 0.05 s (the solo race at 20 Hz) and at 1 s (the tests): **0.5 %**.
 * What `wbal.test.ts` holds the model's tick-rate independence to.
 */
export const BOT_WBAL_TICK_TOLERANCE = 0.005;

/**
 * A balance this close to empty, joules, is empty: **a millijoule**.
 * `spendableWatts` caps a bot's power at what the balance pays for, so the
 * float subtraction in `stepWbal` leaves a residue of about 1e-12 J instead of
 * an exact 0, and a bot on that residue must still latch `exhausted`.
 */
export const BOT_WBAL_EMPTY_JOULES = 1e-3;

/**
 * The most a bot's power may ever be, watts, whatever its capacity: 7 W/kg,
 * `MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM`, at `BOT_MASS_KILOGRAMS`, 75 kg
 * (ADR 0061 D-8.2, kept by ADR 0067 D-1.3).
 */
export const BOT_CEILING_WATTS = MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * BOT_MASS_KILOGRAMS;

/** A bot's balance at the start of a race: full, and not exhausted. */
export function fullBotEnergy(capacity: BotCapacity): BotEnergy {
  return { wbalJoules: capacity.wPrimeJoules, exhausted: false };
}

/** A capacity's recovery rate: 1 where none is named. */
function recoveryOf(capacity: BotCapacity): number {
  return capacity.recoveryFactor ?? 1;
}

function checkCapacity(capacity: BotCapacity): void {
  const { cpWatts, wPrimeJoules } = capacity;
  if (
    !Number.isFinite(cpWatts) ||
    cpWatts <= 0 ||
    !Number.isFinite(wPrimeJoules) ||
    wPrimeJoules <= 0 ||
    !Number.isFinite(capacity.peakWatts) ||
    !Number.isFinite(capacity.floorWatts) ||
    !(recoveryOf(capacity) > 0) ||
    !Number.isFinite(recoveryOf(capacity))
  ) {
    throw new LapRaceError(
      'capacity-out-of-range',
      'a capacity has a finite critical power, W prime and recovery, each above zero, and a finite peak and floor',
    );
  }
}

function checkEnergy(capacity: BotCapacity, energy: BotEnergy): void {
  const { wbalJoules } = energy;
  if (!Number.isFinite(wbalJoules) || wbalJoules < 0 || wbalJoules > capacity.wPrimeJoules) {
    throw new LapRaceError(
      'wbal-out-of-range',
      'a W prime balance must be a number of joules from zero to the capacity W prime',
    );
  }
}

function checkElapsed(dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new LapRaceError(
      'elapsed-out-of-range',
      'elapsed must be a finite number of seconds of at least zero',
    );
  }
}

/**
 * The balance after riding `powerWatts` for `dtSeconds`, in the discrete
 * differential form (see the header). Clamped to `[0, W′]`; exhausted from the
 * tick it reaches 0, and again able to spend once it has recovered past
 * {@link BOT_WBAL_REENTRY_FRACTION} of W′.
 *
 * @throws {LapRaceError} `capacity-out-of-range`, `wbal-out-of-range`,
 *   `elapsed-out-of-range`, and `power-not-finite` for a power that is not a
 *   finite number of watts.
 */
export function stepWbal(
  capacity: BotCapacity,
  energy: BotEnergy,
  powerWatts: number,
  dtSeconds: number,
): BotEnergy {
  checkCapacity(capacity);
  checkEnergy(capacity, energy);
  checkElapsed(dtSeconds);
  if (!Number.isFinite(powerWatts)) {
    throw new LapRaceError('power-not-finite', 'power must be a finite number of watts');
  }
  const { cpWatts, wPrimeJoules } = capacity;
  const { wbalJoules } = energy;
  const spent = powerWatts > cpWatts ? wbalJoules - (powerWatts - cpWatts) * dtSeconds : undefined;
  const after =
    spent !== undefined
      ? spent <= BOT_WBAL_EMPTY_JOULES
        ? 0
        : spent
      : wbalJoules +
        (recoveryOf(capacity) * (cpWatts - powerWatts) * dtSeconds * (wPrimeJoules - wbalJoules)) /
          wPrimeJoules;
  const clamped = Math.min(wPrimeJoules, Math.max(0, after));
  const exhausted =
    clamped <= 0 || (energy.exhausted && clamped <= wPrimeJoules * BOT_WBAL_REENTRY_FRACTION);
  return { wbalJoules: clamped, exhausted };
}

/**
 * What a bot that wants `wantedWatts` may ride for the next `dtSeconds`:
 *
 * - never over its peak, nor over {@link BOT_CEILING_WATTS} (7 W/kg at 75 kg);
 * - never over CP while it is exhausted;
 * - never more above CP than its balance pays for in the tick, so the balance
 *   reaches 0 and goes no further;
 * - and never under its floor.
 *
 * Over a tick of no time the balance limits nothing, because nothing is spent.
 *
 * @throws {LapRaceError} as {@link stepWbal}, and `power-not-finite` for a
 *   wanted power that is not a finite number of watts.
 */
export function spendableWatts(
  capacity: BotCapacity,
  energy: BotEnergy,
  wantedWatts: number,
  dtSeconds: number,
): number {
  checkCapacity(capacity);
  checkEnergy(capacity, energy);
  checkElapsed(dtSeconds);
  if (!Number.isFinite(wantedWatts)) {
    throw new LapRaceError('power-not-finite', 'power must be a finite number of watts');
  }
  const { cpWatts } = capacity;
  let most = Math.min(capacity.peakWatts, BOT_CEILING_WATTS);
  if (energy.exhausted) most = Math.min(most, cpWatts);
  else if (dtSeconds > 0) most = Math.min(most, cpWatts + energy.wbalJoules / dtSeconds);
  return Math.max(capacity.floorWatts, Math.min(wantedWatts, most));
}
