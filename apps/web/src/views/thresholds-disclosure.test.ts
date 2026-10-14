// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The thresholds card's sentence, held to the code that makes it true** —
 * #1342.
 *
 * The card said "Nothing is sent anywhere" while threshold power was in every
 * ride analysis' input. A test that pins the sentence's words cannot catch
 * that: it agrees with whatever the sentence says. So each clause of
 * `AnalysisView.tsx` §`THRESHOLDS_WHERE_THEY_GO` is a row here, checked
 * against the builder of what leaves on that path, and a builder that starts
 * or stops sending a threshold is a red test beside the sentence it falsifies.
 *
 * Not held here: a private room (`net/room-port.ts` sends the declared weight
 * and nothing of the athlete row besides, which `room-port.test.ts` pins), and
 * sync's pushed items (rides as signed files, typed text and saved workouts,
 * none of which is the athlete row).
 */

import {
  beatsPerMinute,
  kilograms,
  metres,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type BeatsPerMinute,
  type Kilograms,
  type Watts,
} from '@onyourleft/domain';
import { rideAnalysisInput, type RideAnalysisInput } from '@onyourleft/analysis';
import { describe, expect, it } from 'vitest';

import { analysisJobRequest } from '../ride-analysis/instance-job';
import { rideSummaryBody } from '../ride-analysis/ride-summary';
import { REPLAN_SOURCE, replanInput, replanRequest } from '../workout/replan-job';
import { THRESHOLDS_WHERE_THEY_GO } from './AnalysisView';

/** Numbers no other figure below can equal, so finding one in a payload means the threshold leaked. */
const THRESHOLD_POWER = 287;
const THRESHOLD_HEART_RATE = 163;

/**
 * An athlete row with BOTH thresholds, typed as the store's row is rather than
 * as the builder's narrower parameter, so a builder that started reading
 * threshold heart rate would find it here.
 */
const athlete: {
  readonly mass: Kilograms;
  readonly thresholdPower: Watts;
  readonly thresholdHeartRate: BeatsPerMinute;
} = {
  mass: kilograms(70),
  thresholdPower: watts(THRESHOLD_POWER),
  thresholdHeartRate: beatsPerMinute(THRESHOLD_HEART_RATE),
};

/** Ten minutes at 200 W and 140 bpm: figures that cannot be mistaken for either threshold. */
const SAMPLES = 600;
const streams = {
  startedAt: unixSeconds(1_700_000_000),
  sampleInterval: seconds(1),
  sampleCount: SAMPLES,
  channels: {
    power: Array.from({ length: SAMPLES }, () => watts(200)),
    heartRate: Array.from({ length: SAMPLES }, () => beatsPerMinute(140)),
  },
};

function analysisInput(): RideAnalysisInput {
  return rideAnalysisInput(
    { movingTime: seconds(SAMPLES), distance: metres(5000) },
    streams,
    athlete,
    {
      templateVersion: 'template-1',
      cameraConsented: false,
    },
  );
}

/** Every key, at any depth, of a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

describe('the thresholds card says where each threshold goes — #1342', () => {
  it('says what each path below holds, and never that nothing is sent', () => {
    expect(THRESHOLDS_WHERE_THEY_GO).toContain(
      'Asking for a ride analysis sends your threshold power to the model you chose',
    );
    expect(THRESHOLDS_WHERE_THEY_GO).toContain(
      'a re-plan during the ride sends your instance each block’s power as a share of it, never in watts',
    );
    expect(THRESHOLDS_WHERE_THEY_GO).toContain('Your threshold heart rate is not sent.');
    expect(THRESHOLDS_WHERE_THEY_GO).not.toMatch(/nothing is sent/i);
  });

  it('a ride analysis carries the threshold power, and not the threshold heart rate', () => {
    const request = analysisJobRequest(analysisInput(), 'template-1', 'instance-local');
    const sent = JSON.stringify(request);
    expect(request.input.rider.thresholdPower).toBe(THRESHOLD_POWER);
    expect(sent).toContain(`"thresholdPower":${String(THRESHOLD_POWER)}`);
    expect(keysOf(request).filter((key) => /threshold/i.test(key))).toEqual(['thresholdPower']);
    expect(sent).not.toContain(String(THRESHOLD_HEART_RATE));
  });

  it('a re-plan carries shares of the threshold power, no threshold, and goes to the instance only', () => {
    const request = replanRequest(
      replanInput({
        revision: 1,
        summarySeq: 1,
        currentBlock: 1,
        goals: {},
        blocks: [
          { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.6), label: 'Easy' },
          { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.9), label: 'Hard' },
        ],
        summaries: [{ block: 0, seconds: 300, meanPowerShare: 0.612, rescues: 0 }],
      }),
    );
    const keys = keysOf(request);
    expect(keys).toContain('meanPowerShare');
    expect(keys.filter((key) => /threshold|watt/i.test(key))).toEqual([]);
    expect(REPLAN_SOURCE).toBe('instance-local');
    expect(request.source).toBe(REPLAN_SOURCE);
  });

  it('a synced ride’s summary does not carry either threshold', () => {
    const body = rideSummaryBody(analysisInput());
    expect(body).not.toContain(String(THRESHOLD_POWER));
    expect(body).not.toContain(String(THRESHOLD_HEART_RATE));
    expect(body).not.toMatch(/threshold/i);
  });
});
