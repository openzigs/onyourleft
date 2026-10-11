// SPDX-License-Identifier: Apache-2.0

/**
 * The heart-rate hold in a closed loop (#1239), against #1238's response model.
 *
 * The workout player (`packages/domain`) decides; a simulated FTMS trainer is
 * written through its control point and holds the target; a simulated heart
 * answers to the power the trainer holds; a simulated strap notifies it, and
 * each notification is read through the REAL Heart Rate decoder before the
 * player sees it. Nobody is on the bike, and every piece of the loop but the
 * rider's heart is the code a ride runs.
 *
 * ⚠️ **The rider's heart is a model, and its numbers are test defaults**:
 * Hunt & Hurni's mean gain and time constant, with a resting rate this test
 * chooses so that 100 W sits below a 130–140 bpm range. Passing here says the
 * hold settles THIS heart; it says nothing about any rider's.
 */

import {
  beatsPerMinute,
  createWorkoutPlayer,
  expandWorkout,
  HOLD_MAXIMUM_RISE_WATTS,
  HOLD_MAXIMUM_STEP_DOWN_WATTS,
  HOLD_MAXIMUM_STEP_UP_WATTS,
  HOLD_RISE_WINDOW_SECONDS,
  MAXIMUM_HOLD_CEILING_SHARE,
  seconds,
  thresholdShare,
  watts,
  type HeartRateSample,
  type PlayerState,
  type Watts,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId } from '../../src/index';
import { createSimulator, ftmsTrainer, hrsStrap } from '../../src/simulator/index';
import { heartRatesThroughTheDecoder } from './simulator-bridge';

const TRAINER = deviceId('kickr');
const STRAP = deviceId('hrs-strap');
const THRESHOLD = watts(250);

/** A rider whose heart sits at 119 bpm at 100 W: the hold has 15 to 20 bpm to find. */
const RESTING = 80;

async function rideTheHold(options: { readonly minutes: number; readonly driftAfter?: number }) {
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr' }), hrsStrap()],
    rider: { power: watts(100) },
    heartRate: { kind: 'responsive', restingHeartRate: RESTING },
  });
  await transport.connect(TRAINER);
  await transport.connect(STRAP);
  const controlPoint = bench.device(TRAINER).controlPoint;
  if (controlPoint === undefined) {
    throw new Error('the trainer serves no control point');
  }
  controlPoint.enableIndications();
  controlPoint.write({ opCode: 'request-control' });
  bench.advance(seconds(1));
  controlPoint.write({ opCode: 'set-target-power', target: watts(100) });
  bench.advance(seconds(1));

  const history: HeartRateSample[] = [];
  heartRatesThroughTheDecoder(bench, STRAP, (bpm) => {
    history.push({ at: seconds(bench.now), bpm });
  });

  const player = createWorkoutPlayer({
    timeline: expandWorkout({
      name: 'Hold',
      blocks: [
        {
          kind: 'heart-rate-hold',
          seconds: seconds(options.minutes * 60),
          range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
          startShare: thresholdShare(0.4),
          ceilingShare: thresholdShare(0.85),
        },
      ],
    }),
    thresholdPower: THRESHOLD,
    heartRateHold: {
      thresholdHeartRate: beatsPerMinute(170),
      assumed: { power: false, heartRate: false },
    },
  });

  const writes: { at: number; watts: Watts; hold: string | undefined }[] = [];
  const heard: { at: number; bpm: number }[] = [];
  player.start(seconds(bench.now));
  for (let second = 0; second < options.minutes * 60; second += 1) {
    if (options.driftAfter !== undefined && second === options.driftAfter) {
      bench.device(STRAP).script({ kind: 'heart-rate-drift', bpmPerHour: 7.7 });
    }
    bench.advance(seconds(1));
    const now = seconds(bench.now);
    const state: PlayerState = player.tick(now, { heartRate: history.slice(-30) });
    if (state.intent.kind === 'write-target') {
      writes.push({ at: second, watts: state.intent.watts, hold: state.intent.hold });
      controlPoint.write({ opCode: 'set-target-power', target: state.intent.watts });
      player.acknowledge(state.intent.watts);
    }
    const latest = history.at(-1);
    if (latest !== undefined) {
      heard.push({ at: second, bpm: latest.bpm });
    }
  }
  return { writes, heard, onTheTrainer: bench.device(TRAINER).inspect().ftms?.targetPower };
}

describe('the heart-rate hold, closed around a simulated heart', () => {
  it('from 100 W settles a 130–140 bpm range within 6 minutes, and stays in it for 20 minutes of drift at 7.7 bpm/h', async () => {
    const minutes = 26;
    const { writes, heard } = await rideTheHold({ minutes, driftAfter: 6 * 60 });

    const firstInside = heard.findIndex((sample) => sample.bpm >= 130 && sample.bpm <= 140);
    expect(firstInside).toBeGreaterThan(-1);
    // Inside within six minutes, and never outside again from six minutes on.
    const afterSix = heard.filter((sample) => sample.at >= 6 * 60);
    expect(afterSix.length).toBeGreaterThan(19 * 60);
    expect(afterSix.filter((sample) => sample.bpm < 130 || sample.bpm > 140)).toEqual([]);

    // Every write inside the envelope: the floor, the ceiling, the steps and the
    // per-minute rise.
    const ceiling = Math.floor(THRESHOLD * MAXIMUM_HOLD_CEILING_SHARE);
    let previous = 100;
    const rises: { at: number; watts: number }[] = [];
    for (const write of writes) {
      expect(write.watts).toBeLessThanOrEqual(ceiling);
      expect(write.watts).toBeGreaterThanOrEqual(THRESHOLD * 0.2);
      if (write.hold === 'raised' || write.hold === 'lowered') {
        expect(write.watts - previous).toBeLessThanOrEqual(HOLD_MAXIMUM_STEP_UP_WATTS);
        expect(previous - write.watts).toBeLessThanOrEqual(HOLD_MAXIMUM_STEP_DOWN_WATTS);
      }
      if (write.watts > previous) {
        rises.push({ at: write.at, watts: write.watts - previous });
        const inWindow = rises
          .filter((rise) => rise.at > write.at - HOLD_RISE_WINDOW_SECONDS)
          .reduce((sum, rise) => sum + rise.watts, 0);
        expect(inWindow).toBeLessThanOrEqual(HOLD_MAXIMUM_RISE_WATTS);
      }
      previous = write.watts;
    }
    // The drift was answered by lowering the target, which is the point.
    const atSix = writes.filter((write) => write.at <= 6 * 60).at(-1)?.watts ?? 0;
    expect(writes.at(-1)?.watts ?? 0).toBeLessThan(atSix);
  });
});
