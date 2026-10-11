// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Asking the rider's instance for a write-up, as the ride's page sees it** —
 * [#1102](https://github.com/openzigs/onyourleft/issues/1102),
 * [ADR 0046](../../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-1, D-11.
 *
 * One press starts a job on the instance; the page then follows it — its
 * progress, and each section once the instance AND this device have screened
 * it — can cancel it, picks it up again after a dropped connection or a
 * reopened page, and, when it succeeds, screens the write-up on this device,
 * saves it and tells the instance so. `instance-analysis.ts` §
 * `createInstanceAnalysis` implements it and `main.tsx` builds it.
 *
 * ## Why a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `check:wiring` watches every `*-port.ts`, so
 * a method here that nothing in production calls is a red `WIRE003`. The page
 * is handed it as an optional prop, so `instance-analysis-wiring.test.tsx`
 * drives the real shell with it, which is what goes red for a `main.tsx` that
 * stopped passing it (§4j §Limits).
 *
 * ## Following is not running
 *
 * Aborting the `signal` handed to {@link InstanceAnalysisPort.ask} or
 * {@link InstanceAnalysisPort.followAgain} stops the PAGE following the job — it
 * was closed, or a ride started (ADR 0035 D-8). The job carries on on the
 * instance, and the next {@link InstanceAnalysisPort.followAgain} for that ride
 * picks it up. Only {@link InstanceAnalysisPort.cancel} stops the job.
 */

import type { ActivityId } from '@onyourleft/store';
import type { ScreenedWriteUp } from '@onyourleft/analysis';

import type { InstanceJobSource } from './instance-job';
import type { AskOutcome } from './ride-analysis-port';

/** What the page shows while a job is followed. Only screened text. */
export interface InstanceJobView {
  readonly phase: 'starting' | 'streaming' | 'reconnecting' | 'saving';
  /** The step the instance is on, from one; `undefined` before its first. */
  readonly step?: number;
  /** Every section so far, screened on this device, in order. Empty after a withdrawal. */
  readonly sections: readonly ScreenedWriteUp[];
  /**
   * Whatever was shown was taken back: the instance withdrew it, or a section
   * failed this device's own screen. Nothing more is shown of this job.
   */
  readonly withdrawn: boolean;
}

/** How following a job ended: an ask's outcome, or the page let go and the job carries on. */
export type InstanceAskOutcome = AskOutcome | { readonly kind: 'detached' };

/** Whether a ride is being recorded, and when that changes (ADR 0035 D-8: nothing during a ride). */
export interface RideInProgressWatch {
  inProgress(): boolean;
  subscribe(listener: () => void): () => void;
}

/** What the ride's page may ask of the instance. */
export interface InstanceAnalysisPort {
  /** Whether this device holds a sign-in to an instance. Reads storage; sends nothing. */
  connected(): boolean;
  /** The sources on offer, the instance's own model first. Empty offers no control. */
  availableSources(): readonly InstanceJobSource[];
  /** Whether a job for this ride was started and has not ended here — so the page resumes it. */
  pendingJob(activityId: ActivityId): boolean;
  /** Start a job for this ride and follow it. Settles; never rejects. */
  ask(
    activityId: ActivityId,
    source: InstanceJobSource,
    view: (view: InstanceJobView) => void,
    signal: AbortSignal,
  ): Promise<InstanceAskOutcome>;
  /** Follow this ride's pending job again, from where this tab left it. Settles; never rejects. */
  followAgain(
    activityId: ActivityId,
    view: (view: InstanceJobView) => void,
    signal: AbortSignal,
  ): Promise<InstanceAskOutcome>;
  /** Ask the instance to cancel this ride's job. A follow then ends with the cancel's sentence. */
  cancel(activityId: ActivityId): Promise<void>;
  /** The recording, so the page stops following while a ride is recorded. Absent: never. */
  readonly ride?: RideInProgressWatch;
}
