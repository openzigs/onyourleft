// SPDX-License-Identifier: Apache-2.0

/**
 * The three measurement-only profiles: Heart Rate, Cycling Power, Cycling Speed
 * and Cadence. FTMS, which also has a control point, is in `ftms.ts`.
 *
 * ## Field presence, not bytes
 *
 * Each frame below is the *content* of one notification: the fields the
 * characteristic's flags say are present, as labelled quantities or as the raw
 * counters the profile defines. There is no `DataView` and no octet layout,
 * deliberately — `../README.md` bars GATT payload from this directory, and the
 * encoder for each characteristic is the mirror image of the decoder #41–#43
 * write, so it belongs beside them where the two can be checked against each
 * other. The frames are shaped so that an encoder is a table lookup away.
 */

import {
  beatsPerMinute,
  revolutionsPerMinute,
  EVENT_TICKS_PER_SECOND_1024,
  UINT16_MODULUS,
  UINT32_MODULUS,
  type BeatsPerMinute,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

import { createRevolutionCounter, type RevolutionReading } from './counters';
import type { RiderProfile } from './rider';

// --- Heart Rate Service (0x180D), Heart Rate Measurement (0x2A37) -----------

/**
 * Whether the strap can tell it is against skin, and whether it is: the
 * Heart Rate Measurement's flag bits 1 and 2, as `protocol/heart-rate.ts`
 * reads them. A strap off the chest (#1238's "strap absent") still notifies,
 * with `not-detected` — and the decoder drops that reading rather than report
 * its zero.
 */
export type SimulatedSensorContact = 'unsupported' | 'not-detected' | 'detected';

export interface HeartRateFrame {
  /**
   * What the strap notifies. Not bounded to a plausible heart: #1238's
   * scenarios notify 0 and 255 on purpose, and a value over 255 needs the
   * 16-bit form (flag bit 0), which is what an encoder has to get right.
   */
  readonly heartRate: BeatsPerMinute;
  readonly sensorContact: SimulatedSensorContact;
}

export interface HeartRateService {
  /**
   * The frame for the next notification. Called once per notification that
   * is actually sent, so a scripted reading is spent only when it is notified.
   */
  notify(heartRate: number): HeartRateFrame;
  /** What the next notification would carry, without spending a scripted reading. */
  peek(heartRate: number): HeartRateFrame;
  /** Scenario: notify these values verbatim, one per notification, then resume. */
  queue(values: readonly number[]): void;
  /** Scenario: the strap is off the chest for this many notifications. */
  absent(notifications: number): void;
}

export function createHeartRateService(): HeartRateService {
  let queued: number[] = [];
  let absentFor = 0;
  const frameOf = (value: number, contact: SimulatedSensorContact): HeartRateFrame => ({
    heartRate: beatsPerMinute(Math.max(0, Math.round(value))),
    sensorContact: contact,
  });
  return {
    notify(heartRate) {
      if (absentFor > 0) {
        absentFor -= 1;
        return frameOf(0, 'not-detected');
      }
      return frameOf(queued.shift() ?? heartRate, 'unsupported');
    },
    peek(heartRate) {
      return absentFor > 0
        ? frameOf(0, 'not-detected')
        : frameOf(queued[0] ?? heartRate, 'unsupported');
    },
    queue(values) {
      for (const value of values) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
          throw new RangeError(
            `a scripted heart rate must be a whole number from 0 to 65535, received ${String(value)}`,
          );
        }
      }
      queued = [...queued, ...values];
    },
    absent(notifications) {
      absentFor = notifications;
    },
  };
}

// --- Cycling Power Service (0x1818), Cycling Power Measurement (0x2A63) -----

/** The crank counter a crank-based power meter carries: flag bit 5. */
export const CYCLING_POWER_CRANK = {
  revolutionModulus: UINT16_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
} as const;

export interface CyclingPowerFrame {
  readonly instantaneousPower: Watts;
  /**
   * Crank Revolution Data. Always present here because the simulated meter is
   * crank-based; a hub-based meter would carry wheel data instead, and the
   * flag bit is what tells a decoder which — see the note on encoders above.
   */
  readonly crank: RevolutionReading;
}

export interface CyclingPowerService {
  advance(rider: RiderProfile, duration: Seconds): void;
  /** `power` is passed in because a trainer's power is not always the rider's. */
  frame(power: Watts): CyclingPowerFrame;
  armWrap(): void;
}

export function createCyclingPowerService(): CyclingPowerService {
  const crank = createRevolutionCounter(CYCLING_POWER_CRANK);
  return {
    advance(rider, duration) {
      crank.advance(rider.cadence, duration);
    },
    frame(power) {
      return { instantaneousPower: power, crank: crank.reading() };
    },
    armWrap() {
      crank.armWrap();
    },
  };
}

// --- Cycling Speed and Cadence Service (0x1816), CSC Measurement (0x2A5B) ---

/** Wheel Revolution Data: flag bit 0. `uint32` revolutions, 1/1024 s event time. */
export const CSC_WHEEL = {
  revolutionModulus: UINT32_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
} as const;

/** Crank Revolution Data: flag bit 1. `uint16` revolutions, 1/1024 s event time. */
export const CSC_CRANK = {
  revolutionModulus: UINT16_MODULUS,
  ticksPerSecond: EVENT_TICKS_PER_SECOND_1024,
} as const;

export interface CscFrame {
  /** Always present: the simulated sensor is a combined speed and cadence unit. */
  readonly wheel: RevolutionReading;
  readonly crank: RevolutionReading;
}

export interface CscService {
  advance(rider: RiderProfile, duration: Seconds): void;
  frame(): CscFrame;
  armWrap(): void;
}

export function createCscService(): CscService {
  const wheel = createRevolutionCounter(CSC_WHEEL);
  const crank = createRevolutionCounter(CSC_CRANK);
  return {
    advance(rider, duration) {
      wheel.advance(revolutionsPerMinute((rider.speed / rider.wheelCircumference) * 60), duration);
      crank.advance(rider.cadence, duration);
    },
    frame() {
      return { wheel: wheel.reading(), crank: crank.reading() };
    },
    armWrap() {
      // The crank only. A uint32 wheel count laps after four billion
      // revolutions, which no ride reaches, and its event time laps on the same
      // 64-second period the crank's does — so arming the crank exercises the
      // event-time wrap on the same profile without inventing a wheel count no
      // sensor produces.
      crank.armWrap();
    },
  };
}
