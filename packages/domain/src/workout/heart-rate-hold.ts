// SPDX-License-Identifier: Apache-2.0

/**
 * The heart-rate hold (#1239, ADR 0048 D-3): what one hold block's target
 * should be, decided from the rider's heart rate, inside an envelope the owner
 * approved on 2026-10-09 (Q6).
 *
 * ## It decides a number; the player writes it
 *
 * Pure: time arrives as a parameter, nothing is written, no clock is read. The
 * player (`player.ts`) asks this module what the hold's target is and emits
 * it in its own `write-target` intent — so the player stays the **one writer**
 * of a target (ADR 0048 D-2), and everything it already does (the pending
 * write, the whole-watt de-duplication of #542, a refused write tried again)
 * applies to the hold unchanged.
 *
 * ## ⚠️ Every number below is a recorded decision, not a tuning constant
 *
 * The owner approved them as written: *"Any change is a recorded decision"*.
 * Changing one is an appended amendment to ADR 0048, as ADR 0030 D-7 says of
 * its own thresholds. Each carries the rule it implements (H1–H11) and, where
 * it has one, its source.
 *
 * ## What it never does
 *
 * - **Raise the target on silence.** A dropped heart rate is not a zero
 *   (H7): fewer than two plausible readings in ten seconds freezes the target,
 *   and fifteen seconds of silence takes it back to the start share — or
 *   leaves it where it is if that is lower. Never up.
 * - **Read an implausible reading as a heart rate** (H8): under 30, over 230,
 *   or a jump of more than 40 bpm inside 2 s is silence, not a rider far
 *   below the range.
 * - **Act during a rescue** (H9): the player does not ask it while the stall
 *   rescue holds the target down, and it resumes from the eased target.
 * - **Leave its envelope.** Every target it returns is clamped to the floor and
 *   the ceiling the player computed, and every rise passes the rate limiter.
 */

import { watts, type BeatsPerMinute, type Seconds, type Watts } from '../quantities';

import {
  HOLD_FLOOR_SHARE,
  MAXIMUM_HOLD_BPM,
  MAXIMUM_HOLD_CEILING_SHARE,
  MINIMUM_HOLD_BPM,
  type HeartRateHoldBlock,
  type HeartRateRange,
  type ThresholdShare,
} from './workout';

/** One heart-rate reading, stamped on the caller's clock — the one `tick` is given. */
export interface HeartRateSample {
  readonly at: Seconds;
  readonly bpm: number;
}

/**
 * Why the hold's target is what it is. The screens word it; this package does
 * not (ADR 0048 D-12).
 *
 * `holding` is the hold running and the heart rate inside its deadband: the
 * five of #1239's list each describe a change or a reason not to run, and a
 * hold that has settled and needs no change is neither.
 */
export type HoldReason =
  'settling' | 'holding' | 'raised' | 'lowered' | 'overshoot' | 'silent' | 'ineligible';

/** H4: no heart-rate-driven change in a block's first 90 s — about 1.4 τ (Hunt & Hurni 2019). */
export const HOLD_SETTLING_SECONDS = 90;

/** H5: one decision every 5 s — Hunt & Hurni's controller ran at 0.2 Hz. */
export const HOLD_UPDATE_SECONDS = 5;

/** H5: each decision reads the mean of the last 5 s of plausible readings. */
export const HOLD_MEAN_SECONDS = 5;

/** H5: no change while the mean is within 2 bpm of the middle of the range. */
export const HOLD_DEADBAND_BPM = 2;

/** H5: a decision raises the target by at most 5 W. */
export const HOLD_MAXIMUM_STEP_UP_WATTS = 5;

/** H5: a decision lowers the target by at most 10 W — down is allowed faster than up. */
export const HOLD_MAXIMUM_STEP_DOWN_WATTS = 10;

/** H5: the target rises by at most 15 W in any {@link HOLD_RISE_WINDOW_SECONDS}. */
export const HOLD_MAXIMUM_RISE_WATTS = 15;

/** H5: the window {@link HOLD_MAXIMUM_RISE_WATTS} is measured over. */
export const HOLD_RISE_WINDOW_SECONDS = 60;

/**
 * How far the target moves per bpm of error, before the step limits — this
 * file's own engineering choice, not one of ADR 0048's numbers.
 *
 * Small on purpose. A heart answers to power over about a minute (τ ≈ 65.6 s),
 * so a controller that moves 5 W every 5 s until the heart rate arrives has
 * already asked for far too much by the time it does, and rings. At 0.5 W/bpm
 * the hold's own loop, against Hunt & Hurni's mean gain, settles without
 * leaving a 10 bpm range — `heart-rate-hold.closed-loop.test.ts` in
 * `packages/sensors` is the measurement.
 */
export const HOLD_WATTS_PER_BPM = 0.5;

/** H6: a mean at least 10 bpm above the top of the range… */
export const HOLD_OVERSHOOT_BPM = 10;

/** H6: …for 30 s writes the floor… */
export const HOLD_OVERSHOOT_SECONDS = 30;

/** H6: …which holds until the heart rate has been back inside the range for 60 s. */
export const HOLD_OVERSHOOT_RECOVERY_SECONDS = 60;

/** H7: fewer than this many plausible readings… */
export const HOLD_SILENCE_MINIMUM_READINGS = 2;

/** H7: …in this many seconds freezes the target. */
export const HOLD_SILENCE_WINDOW_SECONDS = 10;

/** H7: after this long with no plausible reading, back to the start share (never up). */
export const HOLD_SILENCE_FALLBACK_SECONDS = 15;

/** H8: a reading under 30 or over 230 bpm is silence — the block's own range band. */
export const HOLD_PLAUSIBLE_MINIMUM_BPM = MINIMUM_HOLD_BPM;
export const HOLD_PLAUSIBLE_MAXIMUM_BPM = MAXIMUM_HOLD_BPM;

/** H8: a jump of more than 40 bpm… */
export const HOLD_IMPLAUSIBLE_JUMP_BPM = 40;

/** H8: …within 2 s of the previous plausible reading is silence: strap contact, crosstalk. */
export const HOLD_IMPLAUSIBLE_JUMP_SECONDS = 2;

/** What the hold needs to know about the rider, from outside this package. */
export interface HeartRateHoldContext {
  /**
   * The rider's OWN threshold heart rate. H2: the range's top must be at or
   * below it.
   */
  readonly thresholdHeartRate: BeatsPerMinute;
  /**
   * Whether either threshold is a substituted default
   * (`apps/web/src/analysis/thresholds.ts`). H1: a substituted default must
   * not enable a load decision, so either `true` makes every hold steady.
   */
  readonly assumed: { readonly power: boolean; readonly heartRate: boolean };
  /** The rider's power-ceiling goal (#1236), which lowers H3's ceiling. */
  readonly goalCeiling?: ThresholdShare | undefined;
  /** The rider's "do not go above" goal (#1236), which bounds H2's range. */
  readonly goalHeartRateAbove?: BeatsPerMinute | undefined;
}

/** The machine's own Supported Power Range, as the trainer reported it. */
export interface TrainerPowerRange {
  readonly minimum: Watts;
  readonly maximum: Watts;
}

/** Where a hold's target may go, in whole watts. */
export interface HoldEnvelope {
  readonly range: HeartRateRange;
  readonly floor: Watts;
  readonly ceiling: Watts;
  readonly start: Watts;
}

/**
 * H3: the floor is the higher of {@link HOLD_FLOOR_SHARE} and the machine's
 * reported minimum; the ceiling is the lowest of the block's ceiling, the
 * rider's goal, {@link MAXIMUM_HOLD_CEILING_SHARE} and the machine's maximum.
 * The start share is clamped between them.
 */
export function holdEnvelope(
  block: HeartRateHoldBlock,
  thresholdPower: Watts,
  goalCeiling: ThresholdShare | undefined,
  trainer: TrainerPowerRange | undefined,
): HoldEnvelope {
  const ceilingShare = Math.min(
    block.ceilingShare,
    goalCeiling ?? MAXIMUM_HOLD_CEILING_SHARE,
    MAXIMUM_HOLD_CEILING_SHARE,
  );
  const floor = Math.max(
    Math.ceil(thresholdPower * HOLD_FLOOR_SHARE),
    Math.ceil(trainer?.minimum ?? 0),
  );
  const ceiling = Math.max(
    floor,
    Math.min(
      Math.floor(thresholdPower * ceilingShare),
      Math.floor(trainer?.maximum ?? Number.POSITIVE_INFINITY),
    ),
  );
  const start = Math.min(ceiling, Math.max(floor, Math.round(thresholdPower * block.startShare)));
  return { range: block.range, floor: watts(floor), ceiling: watts(ceiling), start: watts(start) };
}

/**
 * H1 and H2: whether this hold may run at all for this rider. Without a
 * context, with either threshold assumed, or with a range above the rider's
 * own threshold heart rate or their "do not go above" goal, it may not — and
 * the block rides as a steady one at its start share.
 */
export function holdEligible(
  block: HeartRateHoldBlock,
  context: HeartRateHoldContext | undefined,
): boolean {
  if (context === undefined || context.assumed.power || context.assumed.heartRate) {
    return false;
  }
  if (block.range.high > context.thresholdHeartRate) {
    return false;
  }
  return context.goalHeartRateAbove === undefined || block.range.high <= context.goalHeartRateAbove;
}

/**
 * H8: the readings that count as a heart rate. In order, each judged against
 * the last one that counted, so one spike does not make the next good reading
 * look like a jump back.
 */
export function plausibleReadings(history: readonly HeartRateSample[]): HeartRateSample[] {
  const kept: HeartRateSample[] = [];
  for (const reading of history) {
    if (
      !Number.isFinite(reading.bpm) ||
      reading.bpm < HOLD_PLAUSIBLE_MINIMUM_BPM ||
      reading.bpm > HOLD_PLAUSIBLE_MAXIMUM_BPM
    ) {
      continue;
    }
    const previous = kept.at(-1);
    if (
      previous !== undefined &&
      reading.at - previous.at <= HOLD_IMPLAUSIBLE_JUMP_SECONDS &&
      Math.abs(reading.bpm - previous.bpm) > HOLD_IMPLAUSIBLE_JUMP_BPM
    ) {
      continue;
    }
    kept.push(reading);
  }
  return kept;
}

/** One decision: the target in whole watts, and why. */
export interface HoldDecision {
  readonly watts: Watts;
  readonly reason: HoldReason;
}

export interface HeartRateHold {
  readonly envelope: HoldEnvelope;
  /** The target the hold holds now, whatever it last returned. */
  current(): Watts;
  /**
   * Decide the target at `now`.
   *
   * @param history the rider's heart rate, oldest first, on the caller's
   * clock; `undefined` for no strap at all, which makes the block steady.
   */
  decide(now: Seconds, history: readonly HeartRateSample[] | undefined): HoldDecision;
  /**
   * H9: the stall rescue wrote `eased` instead. The hold is frozen while that
   * lasts, and resumes from the eased target, never from the one before.
   */
  rescued(eased: Watts): void;
}

/**
 * One hold block, from the instant it began.
 *
 * H11: the hold keeps no state past its block. The player makes a new one for
 * each hold block it enters, and again after a pause, so a resumed hold
 * settles again rather than acting on a heart rate from before the stop.
 */
export function createHeartRateHold(
  envelope: HoldEnvelope,
  eligible: boolean,
  startedAt: Seconds,
): HeartRateHold {
  const { floor, ceiling, start, range } = envelope;
  const centre = (range.low + range.high) / 2;
  const clamp = (value: number): number => Math.min(ceiling, Math.max(floor, Math.round(value)));

  let current: number = start;
  let reason: HoldReason = eligible ? 'settling' : 'ineligible';
  let lastHeardAt: number = startedAt;
  let lastUpdateAt: number | undefined;
  let overshootSince: number | undefined;
  let overshootLatched = false;
  let insideSince: number | undefined;
  /** Every rise, so H5's per-minute limit counts each watt it let through. */
  const rises: { at: number; watts: number }[] = [];

  const decision = (why: HoldReason): HoldDecision => {
    reason = why;
    return { watts: watts(current), reason: why };
  };

  /** Never up: back to the start share, or stay where it is if that is lower. */
  const fallBack = (why: HoldReason): HoldDecision => {
    current = Math.min(current, start);
    return decision(why);
  };

  const risenInWindow = (now: number): number => {
    while (rises.length > 0 && (rises[0]?.at ?? now) <= now - HOLD_RISE_WINDOW_SECONDS) {
      rises.shift();
    }
    return rises.reduce((sum, rise) => sum + rise.watts, 0);
  };

  return {
    envelope,
    current: () => watts(current),

    decide(now, history) {
      if (!eligible || history === undefined) {
        return fallBack('ineligible');
      }

      const valid = plausibleReadings(history).filter((reading) => reading.at <= now);
      const last = valid.at(-1);
      if (last !== undefined && last.at > lastHeardAt) {
        lastHeardAt = last.at;
      }
      // H4 before H7: in the settling window the target is the start share
      // whatever the strap says, so silence there changes nothing and says
      // nothing either.
      if (now - startedAt < HOLD_SETTLING_SECONDS) {
        return decision('settling');
      }

      const inSilenceWindow = valid.filter(
        (reading) => reading.at > now - HOLD_SILENCE_WINDOW_SECONDS,
      ).length;
      if (inSilenceWindow < HOLD_SILENCE_MINIMUM_READINGS) {
        // Silence is not a reading, so it neither starts nor ends an overshoot.
        overshootSince = undefined;
        insideSince = undefined;
        if (now - lastHeardAt >= HOLD_SILENCE_FALLBACK_SECONDS) {
          return fallBack('silent');
        }
        return decision('silent');
      }

      const window = valid.filter((reading) => reading.at > now - HOLD_MEAN_SECONDS);
      if (window.length === 0) {
        return decision(reason === 'silent' ? 'holding' : reason);
      }
      const mean = window.reduce((sum, reading) => sum + reading.bpm, 0) / window.length;

      // H6, before anything else that reads the mean.
      if (overshootLatched) {
        insideSince = mean >= range.low && mean <= range.high ? (insideSince ?? now) : undefined;
        if (insideSince === undefined || now - insideSince < HOLD_OVERSHOOT_RECOVERY_SECONDS) {
          current = floor;
          return decision('overshoot');
        }
        overshootLatched = false;
        insideSince = undefined;
        lastUpdateAt = now;
        return decision('holding');
      }
      overshootSince =
        mean >= range.high + HOLD_OVERSHOOT_BPM ? (overshootSince ?? now) : undefined;
      if (overshootSince !== undefined && now - overshootSince >= HOLD_OVERSHOOT_SECONDS) {
        overshootLatched = true;
        overshootSince = undefined;
        current = floor;
        return decision('overshoot');
      }

      // H5 and H10: one decision per 5 s.
      if (lastUpdateAt !== undefined && now - lastUpdateAt < HOLD_UPDATE_SECONDS) {
        return decision(reason);
      }
      lastUpdateAt = now;

      const error = mean - centre;
      if (Math.abs(error) <= HOLD_DEADBAND_BPM) {
        return decision('holding');
      }
      let step = Math.round(-error * HOLD_WATTS_PER_BPM);
      step = Math.max(-HOLD_MAXIMUM_STEP_DOWN_WATTS, Math.min(HOLD_MAXIMUM_STEP_UP_WATTS, step));
      if (step > 0) {
        step = Math.min(step, HOLD_MAXIMUM_RISE_WATTS - risenInWindow(now));
      }
      const next = clamp(current + step);
      if (next === current) {
        return decision('holding');
      }
      if (next > current) {
        rises.push({ at: now, watts: next - current });
      }
      const why: HoldReason = next > current ? 'raised' : 'lowered';
      current = next;
      return decision(why);
    },

    rescued(eased) {
      // The last thing the rescue wrote becomes the hold's own target, so the
      // hold resumes from it — never from the target before the rescue.
      current = clamp(eased);
    },
  };
}
