// SPDX-License-Identifier: Apache-2.0

/**
 * The Fitness Machine Control Point, which is a protocol and not a write.
 *
 * Every test here is about a way a fire-and-forget implementation looks correct
 * and is not: it writes a target, the trainer ignores it, and the screen says
 * the rider is holding 250 W while the trainer holds whatever it held before.
 * The device side is a scripted machine here and the #44 simulator in
 * `fitness-machine-simulator.test.ts`; neither needs hardware.
 */

import { gradePercent, metresPerSecond, resistanceLevel, watts } from '@onyourleft/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSensorError, SensorError } from '../../src/errors';
import type { Unsubscribe } from '../../src/subscription';

import {
  createTrainerControl,
  CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS,
  decodeControlResponse,
  decodeFitnessMachineStatus,
  encodeControlRequest,
  FTMS_OP_CODE,
  FTMS_RESULT_CODE,
  MAX_ENCODABLE_RESISTANCE_LEVEL,
  MAX_PLAUSIBLE_GRADE_PERCENT,
  type ControlLossReason,
  type FitnessMachineChannel,
  type TrainerControlOptions,
} from './fitness-machine-control';
import {
  decodeFitnessMachineFeature,
  decodeSupportedPowerRange,
  type SupportedPowerRange,
} from './fitness-machine';
import { createPayloadWriter } from './testing';

// --- A scripted machine on the other end of the ATT bearer -------------------

/**
 * A trainer that answers exactly what the test tells it to, and records what it
 * was written.
 *
 * By default it answers **synchronously inside the write**, before the write
 * promise resolves. That ordering is deliberate and it is the one that catches
 * a client which subscribes to the indication *after* awaiting its write: a
 * real stack can dispatch the indication before `writeValue` settles, and such
 * a client waits for ever for a response it has already been sent.
 */
interface ScriptedMachine {
  readonly channel: FitnessMachineChannel;
  readonly writes: Uint8Array[];
  indicationsEnabled: boolean;
  /** What to answer the next write with, by request op code. */
  answer(opCode: number, result: number): void;
  /** Answer nothing at all, so the procedure never completes. */
  goSilent(): void;
  /**
   * Hold the CCCD write open, and return the release.
   *
   * The one await inside a procedure that happens *before* the client arms its
   * indication waiter, so it is the window in which a teardown can land on a
   * procedure that does not yet exist to be rejected.
   */
  holdIndicationEnable(): () => void;
  /** Reject the ATT write itself, as an ATT error does. */
  refuseWrites(error: Error): void;
  /** Push a Fitness Machine Status notification. */
  status(bytes: Uint8Array): void;
  /** Deliver a control point indication out of band. */
  indicate(bytes: Uint8Array): void;
}

function scriptedMachine(): ScriptedMachine {
  const writes: Uint8Array[] = [];
  const indicationListeners: Array<(value: DataView) => void> = [];
  const statusListeners: Array<(value: DataView) => void> = [];
  const answers = new Map<number, number>();
  let silent = false;
  let writeError: Error | undefined;
  let enableGate: Promise<void> | undefined;
  let releaseEnable: (() => void) | undefined;

  const viewOf = (bytes: Uint8Array): DataView =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const emitIndication = (bytes: Uint8Array): void => {
    for (const listener of [...indicationListeners]) {
      listener(viewOf(bytes));
    }
  };

  const machine: ScriptedMachine = {
    writes,
    indicationsEnabled: false,
    channel: {
      enableControlPointIndications: async () => {
        if (enableGate !== undefined) {
          await enableGate;
        }
        machine.indicationsEnabled = true;
      },
      onControlPointIndication(listener): Unsubscribe {
        indicationListeners.push(listener);
        return () => {
          indicationListeners.splice(indicationListeners.indexOf(listener), 1);
        };
      },
      onStatus(listener): Unsubscribe {
        statusListeners.push(listener);
        return () => {
          statusListeners.splice(statusListeners.indexOf(listener), 1);
        };
      },
      writeControlPoint(value): Promise<void> {
        if (writeError !== undefined) {
          return Promise.reject(writeError);
        }
        if (!machine.indicationsEnabled) {
          // Core Spec Supplement Part B §1.2: writing before the CCCD is
          // configured for indication is an ATT error, not a result code.
          return Promise.reject(new Error('CCCD Improperly Configured'));
        }
        writes.push(value.slice());
        if (!silent) {
          const requestOpCode = value[0] ?? 0;
          emitIndication(
            Uint8Array.from([
              FTMS_OP_CODE.responseCode,
              requestOpCode,
              answers.get(requestOpCode) ?? FTMS_RESULT_CODE.success,
            ]),
          );
        }
        return Promise.resolve();
      },
    },
    answer(opCode, result) {
      answers.set(opCode, result);
    },
    goSilent() {
      silent = true;
    },
    holdIndicationEnable() {
      enableGate = new Promise<void>((resolve) => {
        releaseEnable = resolve;
      });
      return () => {
        enableGate = undefined;
        releaseEnable?.();
      };
    },
    refuseWrites(error) {
      writeError = error;
    },
    status(bytes) {
      for (const listener of [...statusListeners]) {
        listener(viewOf(bytes));
      }
    },
    indicate: emitIndication,
  };
  return machine;
}

const POWER_RANGE: SupportedPowerRange = decodeSupportedPowerRange(
  createPayloadWriter().i16(0).i16(1000).u16(5).view(),
);

const RESISTANCE_RANGE = {
  minimum: resistanceLevel(1),
  maximum: resistanceLevel(20),
  increment: resistanceLevel(0.5),
};

let machine: ScriptedMachine;

beforeEach(() => {
  machine = scriptedMachine();
});

function control(options?: Partial<TrainerControlOptions>) {
  return createTrainerControl(machine.channel, { powerRange: POWER_RANGE, ...options });
}

/**
 * Let the queued procedure actually start.
 *
 * Writes are serialised through a promise chain, so a call made synchronously
 * has not reached the control point yet. A test that scripted a fault before
 * this would be testing the check that happens *before* the write, which is a
 * different test.
 */
async function inFlight(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
}

/**
 * Whether `promise` settles at all, within a bounded number of microtask ticks.
 *
 * A procedure that is never settled does not fail — it hangs, and every later
 * call queued behind it hangs with it. Asserting on this rather than awaiting
 * the promise is what makes that failure read as a red assertion in
 * milliseconds instead of a test-runner timeout.
 */
async function settles(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  const observed = promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let tick = 0; tick < 50 && !done; tick += 1) {
    await Promise.resolve();
  }
  await (done ? observed : Promise.resolve());
  return done;
}

// --- The wire format --------------------------------------------------------

describe('encoding a control point request', () => {
  it('encodes Request Control as a single op code octet', () => {
    expect([...encodeControlRequest({ opCode: 'request-control' })]).toStrictEqual([0x00]);
  });

  it('encodes Reset as a single op code octet', () => {
    expect([...encodeControlRequest({ opCode: 'reset' })]).toStrictEqual([0x01]);
  });

  it('encodes Set Target Power as a little-endian sint16 of watts', () => {
    expect([
      ...encodeControlRequest({ opCode: 'set-target-power', target: watts(250) }),
    ]).toStrictEqual([0x05, 0xfa, 0x00]);
  });

  it('encodes a target of zero, which is a legitimate ERG setpoint', () => {
    expect([
      ...encodeControlRequest({ opCode: 'set-target-power', target: watts(0) }),
    ]).toStrictEqual([0x05, 0x00, 0x00]);
  });

  it('encodes Set Target Resistance Level as a uint8 at a resolution of 0.1', () => {
    expect([
      ...encodeControlRequest({ opCode: 'set-target-resistance', level: resistanceLevel(7.5) }),
    ]).toStrictEqual([0x04, 75]);
  });

  it('encodes Stop with control information 0x01, and Pause with 0x02', () => {
    expect([...encodeControlRequest({ opCode: 'stop' })]).toStrictEqual([0x08, 0x01]);
    expect([...encodeControlRequest({ opCode: 'pause' })]).toStrictEqual([0x08, 0x02]);
  });

  it('encodes Start or Resume as a single op code octet', () => {
    expect([...encodeControlRequest({ opCode: 'start-or-resume' })]).toStrictEqual([0x07]);
  });

  it('refuses to encode a parameter the wire field cannot carry', () => {
    // The encoder checks as well as the client, so a caller that reaches for it
    // directly gets the same refusal. A truncated octet is a setpoint the rider
    // did not ask for.
    expect(() =>
      encodeControlRequest({ opCode: 'set-target-resistance', level: resistanceLevel(30) }),
    ).toThrow(SensorError);
    expect(() =>
      encodeControlRequest({ opCode: 'set-target-power', target: watts(40_000) }),
    ).toThrow(/target power/);
  });
});

describe('encoding the simulation parameter array — the sign is the whole test', () => {
  it('encodes a POSITIVE grade as a positive little-endian sint16 at 0.01 %', () => {
    const bytes = encodeControlRequest({
      opCode: 'set-simulation-parameters',
      parameters: { grade: gradePercent(8.5) },
    });

    // 8.5 % ÷ 0.01 = 850 = 0x0352, least significant octet first.
    expect([...bytes]).toStrictEqual([0x11, 0x00, 0x00, 0x52, 0x03, 40, 51]);
  });

  it('encodes a NEGATIVE grade as twos complement — a descent must not become a climb', () => {
    const bytes = encodeControlRequest({
      opCode: 'set-simulation-parameters',
      parameters: { grade: gradePercent(-8.5) },
    });

    // -850 as a sint16 is 0xFCAE.
    expect([...bytes]).toStrictEqual([0x11, 0x00, 0x00, 0xae, 0xfc, 40, 51]);
  });

  it('round-trips the sign back out of the octets it wrote', () => {
    for (const grade of [-30, -8.5, -0.01, 0, 0.01, 8.5, 30]) {
      const bytes = encodeControlRequest({
        opCode: 'set-simulation-parameters',
        parameters: { grade: gradePercent(grade) },
      });
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      expect(view.getInt16(3, true) / 100).toBeCloseTo(grade, 10);
    }
  });

  it('encodes wind speed at 0.001 m/s and the two coefficients at their own resolutions', () => {
    const bytes = encodeControlRequest({
      opCode: 'set-simulation-parameters',
      parameters: {
        grade: gradePercent(0),
        windSpeed: metresPerSecond(2.5),
        rollingResistanceCoefficient: 0.0033,
        windResistanceCoefficient: 0.63,
      },
    });

    // 2.5 ÷ 0.001 = 2500 = 0x09C4; 0.0033 ÷ 0.0001 = 33; 0.63 ÷ 0.01 = 63.
    expect([...bytes]).toStrictEqual([0x11, 0xc4, 0x09, 0x00, 0x00, 33, 63]);
  });
});

describe('decoding the response indication', () => {
  it('reads the response code op, the request op and the result', () => {
    const bytes = Uint8Array.from([0x80, 0x05, 0x01]);

    expect(
      decodeControlResponse(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    ).toStrictEqual({ requestOpCode: 0x05, result: 'success' });
  });

  it.each([
    [FTMS_RESULT_CODE.opCodeNotSupported, 'op-code-not-supported'],
    [FTMS_RESULT_CODE.invalidParameter, 'invalid-parameter'],
    [FTMS_RESULT_CODE.operationFailed, 'operation-failed'],
    [FTMS_RESULT_CODE.controlNotPermitted, 'control-not-permitted'],
  ])('maps result code %i to %s', (code, expected) => {
    const bytes = Uint8Array.from([0x80, 0x05, code]);

    expect(
      decodeControlResponse(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)).result,
    ).toBe(expected);
  });

  it('maps a reserved result code to "reserved" and NOT to success', () => {
    // 0x06-0xFF are reserved for future use. A decoder that treated anything it
    // did not recognise as success would report an applied setpoint for a
    // machine that said something it has no word for.
    const bytes = Uint8Array.from([0x80, 0x05, 0x42]);

    expect(
      decodeControlResponse(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)).result,
    ).toBe('reserved');
  });

  it('rejects an indication whose first octet is not the Response Code op', () => {
    const bytes = Uint8Array.from([0x05, 0x05, 0x01]);

    expect(() =>
      decodeControlResponse(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    ).toThrow(/response code/i);
  });

  it('rejects a truncated indication rather than reading past the end', () => {
    const bytes = Uint8Array.from([0x80, 0x05]);

    expect(() =>
      decodeControlResponse(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    ).toThrow();
  });
});

describe('decoding a Fitness Machine Status notification', () => {
  const decode = (...octets: number[]) => {
    const bytes = Uint8Array.from(octets);
    return decodeFitnessMachineStatus(
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  };

  it('reads Control Permission Lost, which is 0xFF at the TOP of the range', () => {
    expect(decode(0xff)).toStrictEqual({ kind: 'control-permission-lost' });
  });

  it('reads Target Power Changed and its new sint16 target', () => {
    expect(decode(0x08, 0xfa, 0x00)).toStrictEqual({
      kind: 'target-power-changed',
      target: 250,
    });
  });

  it('reads Target Resistance Level Changed at a resolution of 0.1', () => {
    expect(decode(0x07, 75)).toStrictEqual({ kind: 'target-resistance-changed', level: 7.5 });
  });

  it('reads Reset', () => {
    expect(decode(0x01)).toStrictEqual({ kind: 'reset' });
  });

  it('reads the three session statuses a machine sends without being asked', () => {
    expect(decode(0x02, 0x01)).toStrictEqual({ kind: 'stopped-or-paused' });
    expect(decode(0x03)).toStrictEqual({ kind: 'stopped-by-safety-key' });
    expect(decode(0x04)).toStrictEqual({ kind: 'started-or-resumed' });
  });

  it('reads Indoor Bike Simulation Parameters Changed', () => {
    expect(decode(0x12)).toStrictEqual({ kind: 'simulation-parameters-changed' });
  });

  it('reports a status op code it does not model rather than failing the link', () => {
    expect(decode(0x14, 0x02)).toStrictEqual({ kind: 'other', opCode: 0x14 });
  });

  it('raises rather than reading past the end when a parameter is missing', () => {
    expect(() => decode(0x08)).toThrow(/new target power/);
  });

  it('rejects an empty notification', () => {
    expect(() => decode()).toThrow();
  });
});

// --- Control must be requested before anything is set ------------------------

describe('a setpoint before Request Control has succeeded', () => {
  it('is refused as an error and NOTHING is written to the control point', async () => {
    const trainer = control();

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);
    expect(machine.writes).toStrictEqual([]);
  });

  it('carries the control-not-held code, so a UI can say why', async () => {
    const trainer = control();

    await trainer.setTargetPower(watts(250)).catch((error: unknown) => {
      expect(isSensorError(error, 'control-not-held')).toBe(true);
    });
    expect.assertions(1);
  });

  it('refuses a simulation setpoint too, not only an ERG one', async () => {
    const trainer = control();

    await expect(trainer.setSimulationParameters({ grade: gradePercent(-4) })).rejects.toThrow(
      SensorError,
    );
    expect(machine.writes).toStrictEqual([]);
  });

  it('is permitted once Request Control has been answered with success', async () => {
    const trainer = control();

    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    expect(machine.writes.map((write) => [...write])).toStrictEqual([[0x00], [0x05, 0xfa, 0x00]]);
    expect(trainer.hasControl()).toBe(true);
  });

  it('enables indications on the control point before it writes anything', async () => {
    // 0x2AD9 is INDICATIONS, CCCD value 0x0002. A client that never configures
    // the descriptor gets an ATT error, or on some stacks silence.
    const trainer = control();

    await trainer.requestControl();

    expect(machine.indicationsEnabled).toBe(true);
  });

  it('does not claim control when the machine refuses the Request Control', async () => {
    machine.answer(FTMS_OP_CODE.requestControl, FTMS_RESULT_CODE.operationFailed);
    const trainer = control();

    await expect(trainer.requestControl()).rejects.toThrow(SensorError);
    expect(trainer.hasControl()).toBe(false);
  });
});

// --- Every write awaits its indication ---------------------------------------

describe('a control write awaits and correlates its indication', () => {
  it('surfaces a non-success result code as an error rather than swallowing it', async () => {
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.invalidParameter);
    const trainer = control();
    await trainer.requestControl();

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(/invalid-parameter/);
  });

  it('leaves the confirmed target untouched when the write was rejected', async () => {
    // FTMS §4.16.4: a procedure that returns a non-success result did not take
    // effect. The screen must not show a target the trainer refused.
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.operationFailed);
    const trainer = control();
    await trainer.requestControl();

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'none' });
  });

  it('records the confirmed target only after a success indication', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.setTargetPower(watts(250));

    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 250 });
  });

  it('rejects an indication that answers a different op code than the one written', async () => {
    const trainer = control();
    await trainer.requestControl();
    // The machine answers Set Target Speed while Set Target Power is
    // outstanding. FTMS serialises procedures, so this cannot be a coincidence
    // — and a client that took it as its own answer would report an ERG target
    // the trainer never accepted.
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.success);
    const original = machine.channel.writeControlPoint.bind(machine.channel);
    vi.spyOn(machine.channel, 'writeControlPoint').mockImplementation((value) => {
      machine.indicate(Uint8Array.from([0x80, FTMS_OP_CODE.setTargetSpeed, 0x01]));
      return original(value);
    });

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(/answered op code/);
  });

  it('propagates an ATT error from the write itself, distinctly from a result code', async () => {
    const trainer = control();
    await trainer.requestControl();
    machine.refuseWrites(new Error('Procedure Already In Progress'));

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'none' });
  });

  it('serialises writes, so this client never provokes Procedure Already In Progress', async () => {
    const trainer = control();
    await trainer.requestControl();
    let inFlight = 0;
    let overlapped = false;
    const original = machine.channel.writeControlPoint.bind(machine.channel);
    vi.spyOn(machine.channel, 'writeControlPoint').mockImplementation(async (value) => {
      inFlight += 1;
      overlapped ||= inFlight > 1;
      await Promise.resolve();
      const result = await original(value);
      inFlight -= 1;
      return result;
    });

    await Promise.all([
      trainer.setTargetPower(watts(100)),
      trainer.setTargetPower(watts(150)),
      trainer.setTargetPower(watts(200)),
    ]);

    expect(overlapped).toBe(false);
    expect(machine.writes).toHaveLength(4);
  });

  it('keeps serialising after a procedure fails, rather than wedging the queue', async () => {
    const trainer = control();
    await trainer.requestControl();
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.operationFailed);

    await expect(trainer.setTargetPower(watts(100))).rejects.toThrow(SensorError);
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.success);
    await trainer.setTargetPower(watts(150));

    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 150 });
  });
});

describe('a procedure that is never answered', () => {
  it('times out rather than blocking every later setpoint for the ride', async () => {
    const fire: Array<() => void> = [];
    const trainer = control({
      scheduleTimeout: (_after, run) => {
        fire.push(run);
        return () => {
          fire.splice(fire.indexOf(run), 1);
        };
      },
    });
    await trainer.requestControl();
    machine.goSilent();

    const pending = trainer.setTargetPower(watts(250));
    await inFlight();
    expect(fire).toHaveLength(1);
    fire.forEach((run) => {
      run();
    });

    await expect(pending).rejects.toThrow(SensorError);
    await pending.catch((error: unknown) => {
      expect(isSensorError(error, 'control-timed-out')).toBe(true);
    });
  });

  it('leaves the target UNKNOWN, because the machine may or may not have applied it', async () => {
    const fire: Array<() => void> = [];
    const trainer = control({
      scheduleTimeout: (_after, run) => {
        fire.push(run);
        return () => {
          fire.splice(fire.indexOf(run), 1);
        };
      },
    });
    await trainer.requestControl();
    machine.goSilent();

    const pending = trainer.setTargetPower(watts(250));
    await inFlight();
    fire.forEach((run) => {
      run();
    });
    await pending.catch(() => undefined);

    expect(trainer.targetPower()).toStrictEqual({ kind: 'unknown', attempted: 250 });
  });

  it('arms the timeout at the documented interval', async () => {
    const armed: number[] = [];
    const trainer = control({
      scheduleTimeout: (after) => {
        armed.push(after);
        return () => undefined;
      },
    });

    await trainer.requestControl();

    expect(armed).toStrictEqual([CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS]);
  });

  it('cancels the timeout when the answer does arrive', async () => {
    const cancelled: number[] = [];
    const trainer = control({
      scheduleTimeout: (after) => () => {
        cancelled.push(after);
      },
    });

    await trainer.requestControl();

    expect(cancelled).toStrictEqual([CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS]);
  });
});

// --- Losing control ----------------------------------------------------------

describe('losing control', () => {
  it('detects Fitness Machine Status 0xFF and stops claiming control', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    machine.status(Uint8Array.from([0xff]));

    expect(trainer.hasControl()).toBe(false);
  });

  it('forgets the confirmed target, because whoever took control may change it', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    machine.status(Uint8Array.from([0xff]));

    expect(trainer.targetPower()).toStrictEqual({ kind: 'none' });
  });

  it('tells a listener, with the reason', async () => {
    const reasons: ControlLossReason[] = [];
    const trainer = control({ reacquireControl: false });
    trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();

    machine.status(Uint8Array.from([0xff]));

    expect(reasons).toStrictEqual(['permission-lost']);
  });

  it('refuses a setpoint written during the gap, and does NOT report it as applied', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    machine.status(Uint8Array.from([0xff]));
    const writesBefore = machine.writes.length;

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);

    expect(machine.writes).toHaveLength(writesBefore);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'none' });
  });

  it('re-requests control on the next setpoint, and the setpoint then goes through', async () => {
    const trainer = control();
    await trainer.requestControl();
    machine.status(Uint8Array.from([0xff]));
    await Promise.resolve();

    await trainer.setTargetPower(watts(250));

    expect(machine.writes.map((write) => write[0])).toStrictEqual([
      FTMS_OP_CODE.requestControl,
      FTMS_OP_CODE.requestControl,
      FTMS_OP_CODE.setTargetPower,
    ]);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 250 });
  });

  it('treats a Control Not Permitted result as a loss too, not only the 0xFF status', async () => {
    // The routine case on a phone that reconnected: no status notification
    // arrives, the trainer simply answers 0x05. A client that only watched the
    // status characteristic would keep believing it had control.
    const reasons: ControlLossReason[] = [];
    const trainer = control({ reacquireControl: false });
    trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();
    machine.answer(FTMS_OP_CODE.setTargetPower, FTMS_RESULT_CODE.controlNotPermitted);

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);

    expect(trainer.hasControl()).toBe(false);
    expect(reasons).toStrictEqual(['permission-lost']);
  });

  it('gives up its OWN control on a successful Reset — FTMS §4.16.2.1', async () => {
    // The trap a workout player falls into: reset between intervals, keep
    // sending targets, and every one of them is silently ignored.
    const reasons: ControlLossReason[] = [];
    const trainer = control({ reacquireControl: false });
    trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();

    await trainer.reset();

    expect(trainer.hasControl()).toBe(false);
    expect(reasons).toStrictEqual(['reset']);
  });

  it('does not silently re-acquire control after a Reset, which would defeat the reset', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.reset();
    await Promise.resolve();

    expect(machine.writes.map((write) => write[0])).toStrictEqual([
      FTMS_OP_CODE.requestControl,
      FTMS_OP_CODE.reset,
    ]);
  });
});

describe('the link dropping mid-ERG', () => {
  it('drops the control claim, because control does not survive a connection', async () => {
    const reasons: ControlLossReason[] = [];
    const trainer = control();
    trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    trainer.linkLost();

    expect(trainer.hasControl()).toBe(false);
    expect(reasons).toStrictEqual(['link-lost']);
  });

  it('reports the target as UNKNOWN, not as still applied', async () => {
    // The rider is pushing against whatever the trainer last accepted and this
    // client can no longer change it. Reporting the last confirmed target as
    // current would tell a UI everything is fine.
    const trainer = control();
    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    trainer.linkLost();

    expect(trainer.targetPower()).toStrictEqual({ kind: 'unknown', attempted: 250 });
  });

  it('rejects the procedure that was in flight rather than leaving it pending for ever', async () => {
    const trainer = control();
    await trainer.requestControl();
    machine.goSilent();

    const pending = trainer.setTargetPower(watts(250));
    await inFlight();
    expect(machine.writes).toHaveLength(2);
    trainer.linkLost();

    await expect(pending).rejects.toThrow(SensorError);
    await pending.catch((error: unknown) => {
      expect(isSensorError(error, 'not-connected')).toBe(true);
    });
  });

  it('refuses every later setpoint until control is requested again', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    trainer.linkLost();
    trainer.linkRestored();

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);
  });

  it('lets a deliberate Stop end the resistance before a rider unclips', async () => {
    const trainer = control();
    await trainer.requestControl();
    await trainer.setTargetPower(watts(250));

    await trainer.stop();

    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x08, 0x01]);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'none' });
  });

  it('refuses to write at all until the transport says a new link is up', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    trainer.linkLost();

    await trainer.requestControl().catch((error: unknown) => {
      expect(isSensorError(error, 'not-connected')).toBe(true);
    });
    expect.assertions(1);
  });

  it('re-enables indications after a reconnection, because the CCCD is per-connection', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    trainer.linkLost();
    machine.indicationsEnabled = false;
    trainer.linkRestored();

    await trainer.requestControl();

    expect(machine.indicationsEnabled).toBe(true);
  });

  it('abandons a procedure whose CCCD write was still in flight when the link went', async () => {
    // `linkLost()` clears `indicationsEnabled` — but the enable that was in
    // flight sets it back to true when it resolves, and the CCCD does not
    // survive a connection. A client that believed it did would write to an
    // unconfigured descriptor for the rest of the ride.
    const trainer = control({ reacquireControl: false });
    const release = machine.holdIndicationEnable();

    const first = trainer.requestControl();
    await inFlight();

    trainer.linkLost();
    release();

    expect(await settles(first)).toBe(true);
    await expect(first).rejects.toThrow(SensorError);
    expect(trainer.hasControl()).toBe(false);

    machine.indicationsEnabled = false;
    trainer.linkRestored();
    await trainer.requestControl();

    expect(machine.indicationsEnabled).toBe(true);
  });

  it('does not restore control just because a link came back', async () => {
    const trainer = control({ reacquireControl: false });
    await trainer.requestControl();
    trainer.linkLost();

    trainer.linkRestored();

    expect(trainer.hasControl()).toBe(false);
  });
});

// --- The bounds on a setpoint written to a machine that resists a person -----

describe('the ERG target is bounded by the range read FROM THE DEVICE', () => {
  it('rejects a target above the device maximum without writing it', async () => {
    const trainer = control();
    await trainer.requestControl();
    const writes = machine.writes.length;

    await expect(trainer.setTargetPower(watts(1500))).rejects.toThrow(/1000/);
    expect(machine.writes).toHaveLength(writes);
  });

  it('carries the control-out-of-range code', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.setTargetPower(watts(1500)).catch((error: unknown) => {
      expect(isSensorError(error, 'control-out-of-range')).toBe(true);
    });
    expect.assertions(1);
  });

  it('rejects a target below the device minimum', async () => {
    const range = decodeSupportedPowerRange(createPayloadWriter().i16(50).i16(1000).u16(5).view());
    const trainer = control({ powerRange: range });
    await trainer.requestControl();

    await expect(trainer.setTargetPower(watts(20))).rejects.toThrow(SensorError);
  });

  it('accepts a target of zero when the device says zero is in range', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.setTargetPower(watts(0));

    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x05, 0x00, 0x00]);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 0 });
  });

  it('uses the device range and not a hard-coded one — a narrower device narrows the client', async () => {
    const narrow = decodeSupportedPowerRange(createPayloadWriter().i16(0).i16(400).u16(1).view());
    const trainer = control({ powerRange: narrow });
    await trainer.requestControl();

    await expect(trainer.setTargetPower(watts(500))).rejects.toThrow(/400/);
    await trainer.setTargetPower(watts(400));

    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 400 });
  });

  it('quantises the target to the minimum increment the device reported', async () => {
    const trainer = control();
    await trainer.requestControl();

    const written = await trainer.setTargetPower(watts(252));

    expect(written).toBe(250);
    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x05, 0xfa, 0x00]);
    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 250 });
  });

  it('quantises from the device minimum, not from zero', async () => {
    const offset = decodeSupportedPowerRange(
      createPayloadWriter().i16(30).i16(1000).u16(25).view(),
    );
    const trainer = control({ powerRange: offset });
    await trainer.requestControl();

    // The grid is 30, 55, 80, … so 100 quantises to 105, not to 100.
    expect(await trainer.setTargetPower(watts(100))).toBe(105);
  });

  it('never quantises UP past the device maximum', async () => {
    const odd = decodeSupportedPowerRange(createPayloadWriter().i16(0).i16(998).u16(25).view());
    const trainer = control({ powerRange: odd });
    await trainer.requestControl();

    expect(await trainer.setTargetPower(watts(996))).toBe(975);
  });

  it('refuses a target above this client own ceiling even if a range somehow allows it', async () => {
    // Defence in depth: `decodeSupportedPowerRange` already refuses to accept a
    // range this wide from a device. This is the check that still holds if a
    // range reaches the client another way.
    const trainer = control({
      powerRange: { minimum: watts(0), maximum: watts(5000), increment: watts(1) },
    });
    await trainer.requestControl();
    const writes = machine.writes.length;

    await expect(trainer.setTargetPower(watts(4000))).rejects.toThrow(SensorError);
    expect(machine.writes).toHaveLength(writes);
  });
});

describe('the resistance setpoint', () => {
  it('refuses to set a level at all when the device range was never read', async () => {
    const trainer = control();
    await trainer.requestControl();

    await expect(trainer.setTargetResistance(resistanceLevel(5))).rejects.toThrow(SensorError);
    expect(machine.writes.map((write) => write[0])).toStrictEqual([FTMS_OP_CODE.requestControl]);
  });

  it('writes a level inside the device range, quantised to its increment', async () => {
    const trainer = control({ resistanceRange: RESISTANCE_RANGE });
    await trainer.requestControl();

    const written = await trainer.setTargetResistance(resistanceLevel(7.4));

    expect(written).toBeCloseTo(7.5, 10);
    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x04, 75]);
  });

  it('rejects a level outside the device range, at either end', async () => {
    const trainer = control({ resistanceRange: RESISTANCE_RANGE });
    await trainer.requestControl();

    await expect(trainer.setTargetResistance(resistanceLevel(25))).rejects.toThrow(SensorError);
    await expect(trainer.setTargetResistance(resistanceLevel(0.5))).rejects.toThrow(/1\.\.20/);
  });

  it('refuses on a machine whose Target Setting bit 2 is clear', async () => {
    const features = decodeFitnessMachineFeature(
      createPayloadWriter()
        .u32(0)
        .u32(1 << 3)
        .view(),
    );
    const trainer = control({ resistanceRange: RESISTANCE_RANGE, features });
    await trainer.requestControl();

    await trainer.setTargetResistance(resistanceLevel(5)).catch((error: unknown) => {
      expect(isSensorError(error, 'capability-unsupported')).toBe(true);
    });
    expect.assertions(1);
  });

  it('rejects a level the uint8 parameter cannot carry, rather than truncating it', async () => {
    // FTMS 1.0 is internally inconsistent here: the Supported Resistance Level
    // Range is a sint16 at 0.1 (so up to 3 276.7) while the Set Target
    // Resistance Level parameter is a UINT8 at 0.1 (so up to 25.5). A device
    // advertising a maximum of 32 has a range this procedure cannot address,
    // and truncating the octet would set 6.4 where 32 was asked for.
    const wide = {
      minimum: resistanceLevel(0),
      maximum: resistanceLevel(32),
      increment: resistanceLevel(0.1),
    };
    const trainer = control({ resistanceRange: wide });
    await trainer.requestControl();

    await expect(trainer.setTargetResistance(resistanceLevel(30))).rejects.toThrow(
      new RegExp(String(MAX_ENCODABLE_RESISTANCE_LEVEL)),
    );
  });

  it('quantises DOWN when the device grid would round a legal level past the uint8 ceiling', async () => {
    // A grid that does not land on its own maximum: 0.6 in steps of 25 gives
    // 0.6, 25.6, 50.6 … so 25.5 — a level both the device range and the wire
    // field admit — rounds UP to 25.6, which the uint8 parameter cannot carry.
    // The step below it is the setpoint, and it is the safe direction: less
    // resistance than was asked for, reported back as what was set.
    const offGrid = {
      minimum: resistanceLevel(0.6),
      maximum: resistanceLevel(30),
      increment: resistanceLevel(25),
    };
    const trainer = control({ resistanceRange: offGrid });
    await trainer.requestControl();

    const written = await trainer.setTargetResistance(
      resistanceLevel(MAX_ENCODABLE_RESISTANCE_LEVEL),
    );

    expect(written).toBeCloseTo(0.6, 10);
    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x04, 6]);
  });
});

describe('the simulation gradient', () => {
  it('sets a positive gradient and confirms it', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.setSimulationParameters({ grade: gradePercent(6.2) });

    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([
      0x11, 0x00, 0x00, 0x6c, 0x02, 40, 51,
    ]);
  });

  it('sets a negative gradient with the sign intact', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.setSimulationParameters({ grade: gradePercent(-6.2) });

    const written = machine.writes.at(-1) ?? new Uint8Array();
    const view = new DataView(written.buffer, written.byteOffset, written.byteLength);

    expect(view.getInt16(3, true)).toBe(-620);
  });

  it('refuses a gradient no road has, rather than writing it to a brake', async () => {
    const trainer = control();
    await trainer.requestControl();
    const writes = machine.writes.length;

    await expect(
      trainer.setSimulationParameters({ grade: gradePercent(MAX_PLAUSIBLE_GRADE_PERCENT + 1) }),
    ).rejects.toThrow(SensorError);
    await expect(
      trainer.setSimulationParameters({ grade: gradePercent(-MAX_PLAUSIBLE_GRADE_PERCENT - 1) }),
    ).rejects.toThrow(SensorError);
    expect(machine.writes).toHaveLength(writes);
  });

  it('refuses coefficients the uint8 parameters cannot carry', async () => {
    const trainer = control();
    await trainer.requestControl();

    await expect(
      trainer.setSimulationParameters({
        grade: gradePercent(0),
        rollingResistanceCoefficient: 0.5,
      }),
    ).rejects.toThrow(SensorError);
    await expect(
      trainer.setSimulationParameters({ grade: gradePercent(0), windResistanceCoefficient: 9 }),
    ).rejects.toThrow(SensorError);
  });
});

// --- Gating on the Feature characteristic ------------------------------------

describe('gating on the Feature characteristic, when one was read', () => {
  const featuresWith = (targetBits: number) =>
    decodeFitnessMachineFeature(createPayloadWriter().u32(0).u32(targetBits).view());

  it('refuses ERG on a machine whose Target Setting bit 3 is clear', async () => {
    const trainer = control({ features: featuresWith(1 << 13) });
    await trainer.requestControl();

    await trainer.setTargetPower(watts(250)).catch((error: unknown) => {
      expect(isSensorError(error, 'capability-unsupported')).toBe(true);
    });
    expect.assertions(1);
  });

  it('refuses simulation mode on a machine whose Target Setting bit 13 is clear', async () => {
    const trainer = control({ features: featuresWith(1 << 3) });
    await trainer.requestControl();

    await expect(trainer.setSimulationParameters({ grade: gradePercent(4) })).rejects.toThrow(
      SensorError,
    );
  });

  it('permits both when both bits are set', async () => {
    const trainer = control({ features: featuresWith((1 << 3) | (1 << 13)) });
    await trainer.requestControl();

    await trainer.setTargetPower(watts(250));
    await trainer.setSimulationParameters({ grade: gradePercent(4) });

    expect(machine.writes).toHaveLength(3);
  });
});

// --- The guarantees this client makes at COMPILE time ------------------------

describe('a setpoint is labelled, or it is not a setpoint', () => {
  /**
   * Each `// @ts-expect-error` is the assertion. If the line ever compiles,
   * TypeScript reports `TS2578: Unused '@ts-expect-error' directive`,
   * `pnpm run typecheck` fails and CI fails with it — this file is inside both
   * of `packages/sensors`' programs.
   *
   * The runtime `expect` is deliberately not the assertion: it pins the fact
   * that the rejected line would have produced a plausible wrong value, which
   * is what makes the compile error worth having. An ERG target of 250 W and a
   * brake level of 250 are the same literal and only one of them is a setpoint
   * any trainer should be given.
   */
  it('does not accept a bare number as an ERG target', async () => {
    const trainer = control();
    await trainer.requestControl();

    // @ts-expect-error 250 what? Watts — and the value reaches a brake a person is pushing against
    await expect(trainer.setTargetPower(250)).resolves.toBe(250);
  });

  it('does not accept a resistance level where an ERG target belongs', async () => {
    const trainer = control({ resistanceRange: RESISTANCE_RANGE });
    await trainer.requestControl();

    // @ts-expect-error a unitless brake level is not a power, however alike the numbers look
    await expect(trainer.setTargetPower(resistanceLevel(15))).resolves.toBe(15);
  });

  it('does not accept watts where a resistance level belongs', async () => {
    const trainer = control({ resistanceRange: RESISTANCE_RANGE });
    await trainer.requestControl();

    // @ts-expect-error a power is not a brake level
    await expect(trainer.setTargetResistance(watts(15))).resolves.toBe(15);
  });

  it('does not accept a bare number as a gradient', async () => {
    const trainer = control();
    await trainer.requestControl();

    await expect(
      // @ts-expect-error a gradient is signed and labelled; an unlabelled -8 could be anything
      trainer.setSimulationParameters({ grade: -8 }),
    ).resolves.toBeUndefined();
  });
});

describe('an unreadable notification from the machine', () => {
  it('costs one procedure and does not throw out of the handler', async () => {
    // A decoder that threw here would throw into the browser's event dispatch,
    // where nothing can catch it. The indication is dropped instead.
    const trainer = control();
    await trainer.requestControl();

    expect(() => {
      machine.indicate(Uint8Array.from([0x99]));
    }).not.toThrow();
    expect(trainer.hasControl()).toBe(true);
  });

  it('drops an unreadable status without moving the control state', async () => {
    const trainer = control();
    await trainer.requestControl();

    expect(() => {
      machine.status(new Uint8Array());
    }).not.toThrow();
    expect(trainer.hasControl()).toBe(true);
  });

  it('drops an indication that arrives with no procedure outstanding', async () => {
    const trainer = control();
    await trainer.requestControl();

    machine.indicate(Uint8Array.from([0x80, FTMS_OP_CODE.setTargetPower, 0x01]));

    // The next setpoint must correlate against its OWN answer, not against the
    // one that arrived out of turn.
    await trainer.setTargetPower(watts(250));
    expect(trainer.targetPower()).toStrictEqual({ kind: 'confirmed', target: 250 });
  });
});

describe('starting and stopping a session', () => {
  it('writes Start or Resume', async () => {
    const trainer = control();
    await trainer.requestControl();

    await trainer.start();

    expect([...(machine.writes.at(-1) ?? [])]).toStrictEqual([0x07]);
  });

  it('refuses to start without control', async () => {
    await expect(control().start()).rejects.toThrow(SensorError);
  });
});

describe('a listener can stop listening', () => {
  it('hears nothing after it unsubscribes', async () => {
    const reasons: ControlLossReason[] = [];
    const trainer = control({ reacquireControl: false });
    const stop = trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();

    stop();
    stop(); // idempotent, as `Unsubscribe` promises
    machine.status(Uint8Array.from([0xff]));

    expect(reasons).toStrictEqual([]);
    expect(trainer.hasControl()).toBe(false);
  });
});

describe('the simulation parameters this client refuses to write', () => {
  it('refuses a wind speed the sint16 field cannot carry', async () => {
    const trainer = control();
    await trainer.requestControl();
    const writes = machine.writes.length;

    await expect(
      trainer.setSimulationParameters({
        grade: gradePercent(0),
        windSpeed: metresPerSecond(100),
      }),
    ).rejects.toThrow(/wind speed/);
    expect(machine.writes).toHaveLength(writes);
  });

  it('refuses a negative coefficient', async () => {
    const trainer = control();
    await trainer.requestControl();

    await expect(
      trainer.setSimulationParameters({
        grade: gradePercent(0),
        rollingResistanceCoefficient: -0.001,
      }),
    ).rejects.toThrow(SensorError);
    await expect(
      trainer.setSimulationParameters({ grade: gradePercent(0), windResistanceCoefficient: -1 }),
    ).rejects.toThrow(SensorError);
  });
});

describe('closing the client', () => {
  it('unsubscribes, so a status arriving after close reaches no listener', async () => {
    const reasons: ControlLossReason[] = [];
    const trainer = control({ reacquireControl: false });
    trainer.onControlLost((reason) => reasons.push(reason));
    await trainer.requestControl();

    trainer.close();
    machine.status(Uint8Array.from([0xff]));

    expect(reasons).toStrictEqual([]);
  });

  it('refuses further setpoints', async () => {
    const trainer = control();
    await trainer.requestControl();

    trainer.close();

    await expect(trainer.setTargetPower(watts(250))).rejects.toThrow(SensorError);
  });

  it('rejects the procedure that was in flight rather than leaving it pending for ever', async () => {
    // `close()` unsubscribes from the indication, so the answer this procedure
    // is waiting on can no longer arrive by any route. With no `scheduleTimeout`
    // — the default — nothing else will ever settle it either.
    const trainer = control();
    await trainer.requestControl();
    machine.goSilent();

    const pending = trainer.setTargetPower(watts(250));
    await inFlight();
    expect(machine.writes).toHaveLength(2);

    trainer.close();

    expect(await settles(pending)).toBe(true);
    await expect(pending).rejects.toThrow(SensorError);
    await pending.catch((error: unknown) => {
      expect(isSensorError(error, 'not-connected')).toBe(true);
    });
  });

  it('does not wedge the queue behind the procedure it orphaned', async () => {
    // Every call is chained off the one in flight, so a single procedure that
    // never settles takes every later call with it — the setpoint after this
    // one would hang rather than being refused.
    const trainer = control();
    await trainer.requestControl();
    machine.goSilent();

    const orphaned = trainer.setTargetPower(watts(250));
    await inFlight();
    trainer.close();
    await settles(orphaned);

    expect(await settles(trainer.setTargetPower(watts(200)))).toBe(true);
  });

  it('refuses a procedure whose CCCD write was still in flight when it closed', async () => {
    // The teardown lands on the one await that happens BEFORE the indication
    // waiter is armed, so there is no `pending` for `close()` to reject. A
    // procedure that arms itself after that point waits on a listener that has
    // already been unsubscribed.
    const trainer = control();
    const release = machine.holdIndicationEnable();

    const first = trainer.requestControl();
    await inFlight();
    expect(machine.writes).toHaveLength(0);

    trainer.close();
    release();

    expect(await settles(first)).toBe(true);
    await expect(first).rejects.toThrow(SensorError);
    // And nothing reached the control point of a client that had been closed.
    expect(machine.writes).toHaveLength(0);
  });

  it('cancels the outstanding timeout, leaving no timer armed on a closed client', async () => {
    const cancelled: number[] = [];
    const trainer = control({
      scheduleTimeout: (after) => () => {
        cancelled.push(after);
      },
    });
    await trainer.requestControl();
    machine.goSilent();

    const pending = trainer.setTargetPower(watts(250));
    await inFlight();
    expect(cancelled).toStrictEqual([CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS]);

    trainer.close();
    await settles(pending);

    expect(cancelled).toStrictEqual([
      CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS,
      CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS,
    ]);
  });
});
