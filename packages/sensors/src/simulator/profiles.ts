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

export interface HeartRateFrame {
  readonly heartRate: BeatsPerMinute;
}

export interface HeartRateService {
  frame(rider: RiderProfile): HeartRateFrame;
}

export function createHeartRateService(): HeartRateService {
  return {
    frame(rider) {
      return { heartRate: rider.heartRate };
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
