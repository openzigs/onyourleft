// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the analysis agent (#1098): a ride's input, a scripted
 * model that answers turn by turn without a socket, a clock a test moves, and
 * the synced items the three-athlete tests plant. Never shipped.
 */

import type { RideAnalysisInput } from '@onyourleft/analysis';

import type { SqlStore } from '../store/sql-store.ts';
import type { ModelConnection, ModelTurn, ModelTurnRequest } from './model-turn.ts';

/** A ride of three sections, with a pose summary sent (camera consent given). */
export const RIDE_INPUT: RideAnalysisInput = {
  templateVersion: '2',
  ride: { movingMinutes: 62.5, distanceKilometres: 31.2 },
  rider: { massKilograms: 71.5, thresholdPower: 240 },
  whole: {
    power: { coverage: 1, mean: 182, max: 410 },
    heartRate: { coverage: 0.98, mean: 141, max: 171 },
  },
  sections: [
    {
      index: 1,
      kind: 'flat',
      minutes: 20,
      distanceKilometres: 11,
      metrics: { power: { coverage: 1, mean: 170, max: 260 } },
    },
    {
      index: 2,
      kind: 'climb',
      minutes: 25,
      distanceKilometres: 8,
      meanGradientPercent: 5.2,
      elevationGainMetres: 410,
      metrics: { power: { coverage: 1, mean: 221, max: 410 } },
    },
    {
      index: 3,
      kind: 'descent',
      minutes: 17.5,
      distanceKilometres: 12.2,
      metrics: { power: { coverage: 1, mean: 120, max: 300 } },
    },
  ],
  pose: {
    source: 'tablet',
    posed: 120,
    noRider: 3,
    unreadable: 1,
    differences: { torso: -2.5, knee: 1.1 },
  },
};

/** A write-up of three sections that passes the screen. */
export const PASSING_WRITE_UP = [
  'A steady ride of an hour, with the effort held well throughout.',
  'The flat start was easy, and the climb took the most effort, at a 5.2% gradient.',
  'The descent was a recovery, with power well below the ride’s average.',
].join('\n\n');

/** What a scripted turn is: a turn, or a function of the request that makes one. */
export type ScriptedTurn =
  ModelTurn | ((request: ModelTurnRequest) => ModelTurn | Promise<ModelTurn>);

export const text = (reply: string, finish: 'stop' | 'length' = 'stop'): ModelTurn => ({
  ok: true,
  text: reply,
  calls: [],
  finish,
  usage: {},
});

let callNumber = 0;

/** A turn that calls these tools with these arguments. */
export const calls = (
  ...made: readonly (readonly [string, unknown])[]
): Extract<ModelTurn, { ok: true }> => ({
  ok: true,
  text: '',
  calls: made.map(([toolName, input]) => {
    callNumber += 1;
    return { callId: `call-${String(callNumber)}`, toolName, input };
  }),
  finish: 'tool-calls',
  // What a small local model's server reports for a turn like this.
  usage: { inputTokens: 1_000, outputTokens: 30 },
});

export interface ScriptedModel extends ModelConnection {
  /** Every request, in order, copied. */
  readonly requests: ModelTurnRequest[];
}

/**
 * A model that answers from a script. When the script runs out, the LAST
 * entry answers again — so a model that "always calls a tool" is one entry.
 */
export function scriptedModel(...script: ScriptedTurn[]): ScriptedModel {
  const requests: ModelTurnRequest[] = [];
  let next = 0;
  return {
    requests,
    async turn(request) {
      requests.push({ ...request, messages: [...request.messages] });
      const entry = script[Math.min(next, script.length - 1)];
      next += 1;
      if (entry === undefined) return { ok: false, failure: 'server-error' };
      return typeof entry === 'function' ? entry(request) : entry;
    },
  };
}

/** A clock a test moves. */
export function movableClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

/** A pose summary as a synced side-camera report carries it, with keys no tool may return. */
export const POSE_REPORT_BODY = JSON.stringify({
  sentences: ['Possibly more upright later on.'],
  poseSummary: {
    source: 'tablet',
    posed: 99,
    noRiderPlantedKey: 4,
    differences: { torsoPlantedKey: -3.25, kneePlantedKey: 1.75 },
  },
});

const encode = (value: string) => new TextEncoder().encode(value);

/**
 * How an athlete's planted text names them: `rider A` for `athlete-a`. Not
 * the id, so a test can hold that the id itself is never sent to a model.
 */
export const riderLabel = (athleteId: string): string =>
  `rider ${athleteId.slice(-1).toUpperCase()}`;

/**
 * Plant, for each athlete, a ride summary, a goal and a side-camera report
 * carrying a pose summary, each naming its owner by {@link riderLabel}, at
 * increasing times.
 */
export async function plantAgentItems(
  store: SqlStore,
  athletes: readonly string[],
  extraGoal?: { readonly athleteId: string; readonly text: string },
): Promise<void> {
  let now = 1_790_000_000;
  for (const athleteId of athletes) {
    for (const [index, body] of [
      [
        '1',
        `{"passages":["An older ride of ${riderLabel(athleteId)}, 40 minutes at an easy effort."]}`,
      ],
      [
        '2',
        `{"passages":["The newest ride of ${riderLabel(athleteId)}: 90 minutes", "with two climbs."]}`,
      ],
    ] as const) {
      now += 1;
      await store.putSyncItem({
        athleteId,
        kind: 'ride-summary',
        key: `summary-${index}-of-${athleteId}`,
        body: encode(body),
        digest: `${index}${athleteId}`.padEnd(64, '0').slice(0, 64),
        now,
      });
    }
    now += 1;
    await store.putSyncItem({
      athleteId,
      kind: 'goal',
      key: `goal-of-${athleteId}`,
      body: encode(
        JSON.stringify({ text: `Goal of ${riderLabel(athleteId)}: ride a century in spring.` }),
      ),
      digest: `g${athleteId}`.padEnd(64, '0').slice(0, 64),
      now,
    });
    now += 1;
    await store.putSyncItem({
      athleteId,
      kind: 'side-camera-report',
      key: `report-of-${athleteId}`,
      body: encode(POSE_REPORT_BODY),
      digest: `r${athleteId}`.padEnd(64, '0').slice(0, 64),
      now,
    });
  }
  if (extraGoal !== undefined) {
    now += 1;
    await store.putSyncItem({
      athleteId: extraGoal.athleteId,
      kind: 'goal',
      key: 'planted-goal',
      body: encode(JSON.stringify({ text: extraGoal.text })),
      digest: 'f'.repeat(64),
      now,
    });
  }
}
