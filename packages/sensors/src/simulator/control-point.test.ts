// SPDX-License-Identifier: Apache-2.0

/**
 * The FTMS Fitness Machine Control Point, as the simulated trainer serves it.
 *
 * Every case here is a behaviour the specification states or a real trainer has
 * been observed doing, and each is asserted through what a client would see:
 * the ATT outcome of the write, the response indication, the Fitness Machine
 * Status notification, and — the one that matters to a rider — whether the
 * power stream through `SensorTransport` follows the target.
 *
 * ⚠️ The control point is reached through the simulator's bench, not through
 * `SensorTransport`. #39 deliberately has no write path; #43 owns the command
 * surface. That is recorded as a finding in #44's pull request rather than
 * worked around by widening the interface here.
 */

import { seconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId, isSensorError, type MeasurementFor } from '../index';
import {
  ATT_ERROR_CODE,
  createSimulator,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  ftmsTrainer,
  hrsStrap,
  type FitnessMachineStatus,
  type FtmsControlResponse,
} from './index';

const TRAINER = deviceId('trainer');

async function connectedTrainer(options: { maxTargetPower?: number } = {}) {
  const { transport, bench } = createSimulator({
    devices: [
      ftmsTrainer({
        id: 'trainer',
        maxTargetPower:
          options.maxTargetPower === undefined ? undefined : watts(options.maxTargetPower),
      }),
    ],
  });
  await transport.connect(TRAINER);
  const handle = bench.device(TRAINER);
  if (handle.controlPoint === undefined) {
    throw new Error('an FTMS trainer has a control point');
  }
  const responses: FtmsControlResponse[] = [];
  const statuses: FitnessMachineStatus[] = [];
  handle.controlPoint.onResponse((response) => responses.push(response));
  handle.controlPoint.onStatus((status) => statuses.push(status));
  const powers: MeasurementFor<'power'>[] = [];
  await transport.subscribe(TRAINER, 'power', (m) => powers.push(m));
  return {
    transport,
    bench,
    controlPoint: handle.controlPoint,
    responses,
    statuses,
    powers,
    handle,
  };
}

describe('the spec constants a client will switch on', () => {
  it('carries the wire values from FTMS 1.0 and the Core Specification Supplement', () => {
    expect(FTMS_CONTROL_OP_CODE).toEqual({
      'request-control': 0x00,
      reset: 0x01,
      'set-target-power': 0x05,
    });
    expect(FTMS_RESULT_CODE).toEqual({
      success: 0x01,
      'invalid-parameter': 0x03,
      'control-not-permitted': 0x05,
    });
    expect(FITNESS_MACHINE_STATUS_OP_CODE).toEqual({
      reset: 0x01,
      'target-power-changed': 0x08,
      'control-permission-lost': 0xff,
    });
    expect(ATT_ERROR_CODE).toEqual({
      'cccd-improperly-configured': 0xfd,
      'procedure-already-in-progress': 0xfe,
    });
  });
});

describe('the routine mobile case: a setpoint before Request Control', () => {
  it('answers 0x05 Control Not Permitted and the power stream does not move', async () => {
    const { bench, controlPoint, responses, powers } = await connectedTrainer();
    controlPoint.enableIndications();

    expect(controlPoint.write({ opCode: 'set-target-power', target: watts(250) })).toEqual({
      kind: 'accepted',
    });
    bench.advance(seconds(3));

    expect(responses).toEqual([
      { requestOpCode: 'set-target-power', result: 'control-not-permitted' },
    ]);
    expect(powers.map((m) => m.power)).toEqual([200, 200, 200]);
  });
});

describe('the happy path: Request Control, then Set Target Power', () => {
  it('answers success twice, pushes Target Power Changed, and the trainer holds the target', async () => {
    const { bench, controlPoint, responses, statuses, powers } = await connectedTrainer();
    controlPoint.enableIndications();

    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });
    bench.advance(seconds(2));

    expect(responses).toEqual([
      { requestOpCode: 'request-control', result: 'success' },
      { requestOpCode: 'set-target-power', result: 'success' },
    ]);
    expect(statuses).toEqual([{ kind: 'target-power-changed', target: 250 }]);
    // The first frame precedes the setpoint; the trainer holds 250 W from then.
    expect(powers.map((m) => m.power)).toEqual([200, 250, 250]);
    expect(bench.device(TRAINER).inspect().ftms).toEqual({
      controlHeld: true,
      indicationsEnabled: true,
      targetPower: 250,
    });
  });

  it('rejects a target above the supported power range as 0x03 Invalid Parameter', async () => {
    const { bench, controlPoint, responses, powers } = await connectedTrainer({
      maxTargetPower: 1000,
    });
    controlPoint.enableIndications();
    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));

    controlPoint.write({ opCode: 'set-target-power', target: watts(1001) });
    bench.advance(seconds(1));

    expect(responses.at(-1)).toEqual({
      requestOpCode: 'set-target-power',
      result: 'invalid-parameter',
    });
    expect(powers.at(-1)?.power).toBe(200);
  });
});

describe('the two ATT-level refusals the revision block grounds', () => {
  it('refuses a write before indications are enabled with CCCD Improperly Configured', async () => {
    const { bench, controlPoint, responses } = await connectedTrainer();

    expect(controlPoint.write({ opCode: 'request-control' })).toEqual({
      kind: 'att-error',
      error: 'cccd-improperly-configured',
    });
    bench.advance(seconds(2));
    expect(responses).toEqual([]);

    controlPoint.enableIndications();
    expect(controlPoint.write({ opCode: 'request-control' })).toEqual({ kind: 'accepted' });
  });

  it('refuses a write that overlaps an outstanding procedure with Procedure Already In Progress', async () => {
    const { bench, controlPoint, responses } = await connectedTrainer();
    controlPoint.enableIndications();

    expect(controlPoint.write({ opCode: 'request-control' })).toEqual({ kind: 'accepted' });
    expect(controlPoint.write({ opCode: 'set-target-power', target: watts(250) })).toEqual({
      kind: 'att-error',
      error: 'procedure-already-in-progress',
    });

    bench.advance(seconds(1));
    expect(responses).toEqual([{ requestOpCode: 'request-control', result: 'success' }]);
    // The indication has gone out; the next write is accepted again.
    expect(controlPoint.write({ opCode: 'set-target-power', target: watts(250) })).toEqual({
      kind: 'accepted',
    });
  });

  it('sustains a host writing at 1 Hz, which is the cadence a real host uses', async () => {
    const { bench, controlPoint, responses, powers } = await connectedTrainer();
    controlPoint.enableIndications();
    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));

    for (let target = 201; target <= 230; target += 1) {
      expect(controlPoint.write({ opCode: 'set-target-power', target: watts(target) })).toEqual({
        kind: 'accepted',
      });
      bench.advance(seconds(1));
    }

    expect(responses).toHaveLength(31);
    expect(responses.every((response) => response.result === 'success')).toBe(true);
    expect(powers.at(-1)?.power).toBe(230);
  });

  it('stops delivering to a response listener that unsubscribed, and only to that one', async () => {
    const { bench, controlPoint, responses } = await connectedTrainer();
    controlPoint.enableIndications();
    const second: FtmsControlResponse[] = [];
    const stop = controlPoint.onResponse((response) => second.push(response));

    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));
    stop();
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });
    bench.advance(seconds(1));

    expect(second.map((response) => response.requestOpCode)).toEqual(['request-control']);
    expect(responses.map((response) => response.requestOpCode)).toEqual([
      'request-control',
      'set-target-power',
    ]);
  });
});

describe('control is lost in three ways the spec and the field both know', () => {
  it('a Reset revokes the client its own control (FTMS §4.16.2.1) and clears the target', async () => {
    const { bench, controlPoint, responses, statuses, powers } = await connectedTrainer();
    controlPoint.enableIndications();
    // A Reset is itself a control procedure: without control it is refused.
    controlPoint.write({ opCode: 'reset' });
    bench.advance(seconds(1));
    expect(responses).toEqual([{ requestOpCode: 'reset', result: 'control-not-permitted' }]);
    responses.length = 0;
    powers.length = 0;

    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });
    bench.advance(seconds(1));

    controlPoint.write({ opCode: 'reset' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(260) });
    bench.advance(seconds(1));

    expect(responses.slice(2)).toEqual([
      { requestOpCode: 'reset', result: 'success' },
      { requestOpCode: 'set-target-power', result: 'control-not-permitted' },
    ]);
    expect(statuses.map((status) => status.kind)).toEqual(['target-power-changed', 'reset']);
    // 250 W held, then the reset releases it back to the rider, then the
    // refused 260 W changes nothing.
    expect(powers.map((m) => m.power)).toEqual([200, 250, 200, 200]);
  });

  it('a link drop mid-procedure loses the response and the permission', async () => {
    const { transport, bench, controlPoint, responses, handle } = await connectedTrainer();
    controlPoint.enableIndications();
    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });

    handle.script({ kind: 'disconnect' });
    expect(transport.connectionState(TRAINER)).toBe('disconnected');
    expect(() => controlPoint.write({ opCode: 'request-control' })).toThrow(
      expect.objectContaining({ code: 'not-connected' }),
    );
    bench.advance(seconds(2));
    expect(responses).toEqual([{ requestOpCode: 'request-control', result: 'success' }]);

    await transport.connect(TRAINER);
    // A fresh link is a fresh ATT bearer: indications must be re-enabled and
    // control must be re-requested, exactly as with a real trainer.
    expect(controlPoint.write({ opCode: 'set-target-power', target: watts(250) })).toEqual({
      kind: 'att-error',
      error: 'cccd-improperly-configured',
    });
    controlPoint.enableIndications();
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });
    bench.advance(seconds(1));
    expect(responses.at(-1)).toEqual({
      requestOpCode: 'set-target-power',
      result: 'control-not-permitted',
    });
  });

  it('Control Permission Lost (0xFF) is pushed and the next setpoint is ignored', async () => {
    const { bench, controlPoint, responses, statuses, powers, handle } = await connectedTrainer();
    controlPoint.enableIndications();
    controlPoint.write({ opCode: 'request-control' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(250) });
    bench.advance(seconds(1));

    handle.script({ kind: 'control-permission-lost' });
    bench.advance(seconds(1));
    controlPoint.write({ opCode: 'set-target-power', target: watts(300) });
    bench.advance(seconds(1));

    expect(statuses.map((status) => status.kind)).toEqual([
      'target-power-changed',
      'control-permission-lost',
    ]);
    expect(responses.at(-1)).toEqual({
      requestOpCode: 'set-target-power',
      result: 'control-not-permitted',
    });
    // The previous target stays in force — whoever took control did not
    // change it — and the ignored 300 W never appears.
    expect(powers.map((m) => m.power)).toEqual([200, 250, 250, 250]);
    expect(bench.device(TRAINER).inspect().ftms?.controlHeld).toBe(false);
  });
});

describe('a device with no FTMS service', () => {
  it('has no control point, and refuses a control scenario rather than ignoring it', () => {
    const { bench } = createSimulator({ devices: [hrsStrap({ id: 'strap' })] });
    const strap = bench.device(deviceId('strap'));

    expect(strap.controlPoint).toBeUndefined();
    let refused: unknown;
    try {
      strap.script({ kind: 'control-permission-lost' });
    } catch (error) {
      refused = error;
    }
    expect(isSensorError(refused, 'capability-unsupported')).toBe(true);
  });
});
