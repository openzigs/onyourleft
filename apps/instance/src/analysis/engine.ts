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
import type { AnalysisReads } from './tools/reads.ts';

export interface AgentEngineOptions {
  readonly reads: AnalysisReads;
  readonly sources: SourceOptions;
  readonly clock: AgentClock;
}

export function agentEngine(options: AgentEngineOptions): AnalysisEngine {
  return {
    async run(job, signal, emit) {
      const chosen = await modelForSource(job.source, job.athleteId, options.sources);
      if (!chosen.ok) return { kind: 'failed', why: chosen.failure };
      return runAnalysisAgent({
        job: { athleteId: job.athleteId, input: job.input },
        model: chosen.model,
        reads: options.reads,
        clock: options.clock,
        signal,
        emit,
      });
    },
  };
}
