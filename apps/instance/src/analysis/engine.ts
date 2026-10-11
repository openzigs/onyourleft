// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The engine a running instance hands its jobs to** — #1095 over #1098's
 * agent and #1097's sources.
 *
 * A job names its source; {@link modelForSource} answers the model for it or
 * the closed reason there is none (`local_unavailable`, `hosted_unavailable`),
 * and the agent runs over that model with the instance's store as its one
 * read (`tools/reads.ts`). Nothing here falls from one source to the other,
 * and nothing here saves: the job engine (`jobs.ts`) keeps what the agent
 * returns.
 */

import { runAnalysisAgent, type AgentClock } from './agent.ts';
import type { AnalysisEngine } from './jobs.ts';
import { modelForSource, type SourceOptions } from './source.ts';
import type { AnalysisHistory, AnalysisReads } from './tools/reads.ts';

export interface AgentEngineOptions {
  readonly reads: AnalysisReads;
  /**
   * The history index (#835) the agent's `history_search` reads, or
   * `undefined` when the instance has none — which the tool then says. ⚠️
   * Until #1229 a running instance handed none, so the tool answered
   * "unavailable" on every job whatever the index held.
   */
  readonly history?: AnalysisHistory | undefined;
  readonly sources: SourceOptions;
  readonly clock: AgentClock;
}

export function agentEngine(options: AgentEngineOptions): AnalysisEngine {
  return {
    async run(job, signal, emit) {
      const chosen = await modelForSource(job.source, job.athleteId, options.sources);
      if (!chosen.ok) return { kind: 'failed', why: chosen.failure };
      return runAnalysisAgent({
        job: {
          athleteId: job.athleteId,
          input: job.input,
          ...(job.rideId === undefined ? {} : { rideId: job.rideId }),
        },
        model: chosen.model,
        reads: options.reads,
        history: options.history,
        clock: options.clock,
        signal,
        emit,
      });
    },
  };
}
