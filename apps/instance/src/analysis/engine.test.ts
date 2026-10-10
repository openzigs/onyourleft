// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The engine a running instance hands its jobs to (#1095): the job's own
 * source, or its closed reason, and the agent over the model it names.
 */

import { describe, expect, it } from 'vitest';

import { calls, PASSING_WRITE_UP, RIDE_INPUT, scriptedModel, text } from './agent-testing.ts';
import { agentEngine } from './engine.ts';
import type { AgentEvent } from './agent.ts';

const NO_READS = { listLiveSyncItems: () => Promise.resolve([]) };
const NO_KEY = () => Promise.resolve({ kind: 'none' } as const);

describe('agentEngine', () => {
  it('fails a job whose source has no model with that source’s reason, and calls nothing', async () => {
    const engine = agentEngine({
      reads: NO_READS,
      sources: { local: undefined, hostedKey: NO_KEY },
      clock: { now: () => 0 },
    });
    for (const [source, why] of [
      ['instance-local', 'local_unavailable'],
      ['instance-hosted', 'hosted_unavailable'],
    ] as const) {
      expect(
        await engine.run(
          { athleteId: 'athlete-a', input: RIDE_INPUT, source },
          new AbortController().signal,
          () => undefined,
        ),
      ).toEqual({ kind: 'failed', why });
    }
  });

  it('runs the agent over the local model, for the job’s athlete, emitting as it goes', async () => {
    const model = scriptedModel(text(PASSING_WRITE_UP));
    const engine = agentEngine({
      reads: NO_READS,
      sources: { local: model, hostedKey: NO_KEY },
      clock: { now: () => 0 },
    });
    const events: AgentEvent[] = [];
    const ended = await engine.run(
      { athleteId: 'athlete-a', input: RIDE_INPUT, source: 'instance-local' },
      new AbortController().signal,
      (event) => events.push(event),
    );
    expect(ended).toMatchObject({ kind: 'written', writeUp: PASSING_WRITE_UP });
    expect(events[0]).toEqual({ type: 'progress', step: 1 });
    expect(events.filter((each) => each.type === 'section')).toHaveLength(3);
  });

  it('hands the agent the history index and the job’s ride, which the history tool searches with (#1229)', async () => {
    const searched: { athleteId: string; body: Readonly<Record<string, unknown>> }[] = [];
    const engineAsking = () =>
      agentEngine({
        reads: NO_READS,
        history: {
          searchFor: (athleteId, body) => {
            searched.push({ athleteId, body });
            return Promise.resolve({ ok: true, value: { passages: [] } });
          },
        },
        sources: {
          local: scriptedModel(
            calls(['history_search', { query: 'hill repeats' }]),
            text(PASSING_WRITE_UP),
          ),
          hostedKey: NO_KEY,
        },
        clock: { now: () => 0 },
      });
    for (const rideId of ['ride-1', undefined]) {
      searched.length = 0;
      await engineAsking().run(
        {
          athleteId: 'athlete-a',
          input: RIDE_INPUT,
          source: 'instance-local',
          ...(rideId === undefined ? {} : { rideId }),
        },
        new AbortController().signal,
        () => undefined,
      );
      expect(searched).toHaveLength(1);
      expect(searched[0]?.athleteId).toBe('athlete-a');
      expect(searched[0]?.body.rideId).toBe(rideId);
    }
  });
});
