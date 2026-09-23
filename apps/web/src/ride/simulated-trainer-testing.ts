// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The #44 simulator's FTMS trainer, reachable by a {@link RideController} —
 * test support, never shipped.
 *
 * `controller.test.ts` drove the real controller against the simulator through
 * an octet bridge written inline; #503's `game/trainer-wiring.test.tsx` needs
 * the same trainer to ride the whole path from the game's *Ride* press to a
 * gradient on the machine, so the bridge lives here and both import it rather
 * than one copying the other.
 *
 * ⚠️ **The bridge is written out with literal offsets** rather than by calling
 * `encodeControlRequest`, for the reason `fitness-machine-simulator.test.ts`
 * gives: two implementations that share an arithmetic mistake cancel it out
 * invisibly.
 */

import { gradePercent, metresPerSecond, seconds, watts } from '@onyourleft/domain';
import {
  createTrainerControl,
  decodeSupportedPowerRange,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
} from '@onyourleft/sensors/protocol';
import {
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  type FitnessMachineStatus,
  type FtmsControlRequest,
  type FtmsControlResponse,
  type SimulatorBench,
} from '@onyourleft/sensors/simulator';

import type { OpenTrainer, TrainerConnection } from './trainer';

export const viewOf = (bytes: readonly number[]): DataView => {
  const array = Uint8Array.from(bytes);
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
};

export const int16 = (raw: number): [number, number] => {
  const unsigned = raw < 0 ? raw + 0x1_0000 : raw;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff];
};

const readInt16 = (bytes: Uint8Array, at: number): number => {
  const low = bytes[at] ?? 0;
  const high = bytes[at + 1] ?? 0;
  const unsigned = low | (high << 8);
  return unsigned > 0x7fff ? unsigned - 0x1_0000 : unsigned;
};

/** FTMS Tables 4.15 and 4.20, with literal offsets. */
export function requestFromOctets(bytes: Uint8Array): FtmsControlRequest {
  switch (bytes[0]) {
    case 0x00:
      return { opCode: 'request-control' };
    case 0x01:
      return { opCode: 'reset' };
    case 0x05:
      return { opCode: 'set-target-power', target: watts(readInt16(bytes, 1)) };
    case 0x08:
      return { opCode: 'stop-or-pause', stop: bytes[1] === 0x01 };
    case 0x11:
      // Only what a game ride's gradient write carries is read back.
      return {
        opCode: 'set-simulation-parameters',
        parameters: {
          windSpeed: metresPerSecond(readInt16(bytes, 1) / 1000),
          grade: gradePercent(readInt16(bytes, 3) / 100),
          rollingResistanceCoefficient: (bytes[5] ?? 0) / 10_000,
          windResistanceCoefficient: (bytes[6] ?? 0) / 100,
        },
      };
    default:
      throw new Error(`the bridge does not encode op code ${String(bytes[0])}`);
  }
}

/** FTMS Table 4.23. */
export const responseToOctets = (response: FtmsControlResponse): DataView =>
  viewOf([0x80, FTMS_CONTROL_OP_CODE[response.requestOpCode], FTMS_RESULT_CODE[response.result]]);

/** FTMS Table 4.26. */
export function statusToOctets(status: FitnessMachineStatus): DataView {
  const op = FITNESS_MACHINE_STATUS_OP_CODE[status.kind];
  switch (status.kind) {
    case 'target-power-changed':
      return viewOf([op, ...int16(status.target)]);
    case 'target-resistance-changed':
      return viewOf([op, Math.round(status.level * 10)]);
    default:
      return viewOf([op]);
  }
}

/** How {@link simulatedOpenTrainer}'s machine answers. */
export interface SimulatedTrainerOptions {
  /** Every control point write, as octets, in order. */
  readonly written: number[][];
  /**
   * Refuse every `0x00` Request Control at the ATT layer — a machine that will
   * not grant control, which the simulator itself never is.
   */
  readonly refuseControl?: boolean;
}

/**
 * An `OpenTrainer` over the simulator's FTMS trainer, the way a client opens
 * one: the power range read as octets through the package's own decoder, and
 * every write bridged to the simulator's control point.
 */
export function simulatedOpenTrainer(
  bench: SimulatorBench,
  options: SimulatedTrainerOptions,
): OpenTrainer {
  return (id) => {
    const handle = bench.device(id);
    const controlPoint = handle.controlPoint;
    const ranges = handle.supportedRanges;
    if (controlPoint === undefined || ranges === undefined) {
      return Promise.resolve({ choice: { kind: 'none' as const }, connection: undefined });
    }
    const powerRange = decodeSupportedPowerRange(
      viewOf([
        ...int16(ranges.minTargetPower),
        ...int16(ranges.maxTargetPower),
        ...int16(ranges.powerIncrement),
      ]),
    );
    const connection: TrainerConnection = {
      control: createTrainerControl(
        {
          enableControlPointIndications: () => {
            controlPoint.enableIndications();
            return Promise.resolve();
          },
          onControlPointIndication: (listener) =>
            controlPoint.onResponse((response) => listener(responseToOctets(response))),
          onStatus: (listener) =>
            controlPoint.onStatus((status) => listener(statusToOctets(status))),
          writeControlPoint: (value) => {
            options.written.push([...value]);
            if (options.refuseControl === true && value[0] === 0x00) {
              return Promise.reject(new Error('write not permitted'));
            }
            const outcome = controlPoint.write(requestFromOctets(value));
            if (outcome.kind === 'att-error') {
              return Promise.reject(new Error(outcome.error));
            }
            // The simulator delivers the indication on its next tick.
            bench.advance(seconds(1));
            return Promise.resolve();
          },
        },
        { powerRange },
      ),
      canSetPower: true,
      canSimulate: true,
      powerRange,
    };
    return Promise.resolve({
      choice: {
        kind: 'fitness-machine' as const,
        service: FITNESS_MACHINE_SERVICE,
        controlPoint: FITNESS_MACHINE_CONTROL_POINT,
        vendorAlsoPresent: false,
      },
      connection,
    });
  };
}
