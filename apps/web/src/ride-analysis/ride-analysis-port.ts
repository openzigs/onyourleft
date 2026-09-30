// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The post-ride ask, as the ride's page sees it** —
 * [#804](https://github.com/openzigs/onyourleft/issues/804), epic #795.
 *
 * One press on a ride's page builds the ride's input (#809), runs the agent
 * (#811) on the model the rider set up, screens the write-up (#798) and saves
 * it with the ride in place of any earlier one (#800). This is the seam the
 * page presses through; `ride-analysis.ts` §`createRideAnalysis` implements
 * it and `main.tsx` builds it.
 *
 * ## Why a `*-port.ts`
 *
 * CLAUDE.md §4j: `check:wiring` watches every `*-port.ts`, so a method here
 * nothing in production calls is a red `WIRE003`. ⚠️ **That half is not the
 * whole of it**: the page is handed this port as an OPTIONAL prop, and a
 * `main.tsx` that stopped passing it would be green there (§4j §Limits' third
 * entry). `ride-analysis-wiring.test.tsx` drives the real shell at the real
 * detail route with the port built the way `main.tsx` builds it, which is the
 * half that goes red for that.
 *
 * ## Settles, never rejects
 *
 * Every way an ask can end is an {@link AskOutcome}, and a failure carries its
 * sentence, taken from a fixed table (`ride-analysis.ts` §`ASK_FAILURE_TEXT`,
 * §`CANCELLED_TEXT`). No sentence carries a key, an address, a model name or a
 * model's words (ADR 0029 D-8).
 *
 * ## What the page is told while it runs
 *
 * Step *n* of *m* ({@link AskProgress}) and nothing else: no step kind, no
 * prompt, no reply.
 */

import type { ActivityId } from '@onyourleft/store';

/** Where a write-up is asked for: the rider's own computer, or a hosted model on their key (#803). */
export type RideWriteUpSource = 'computer' | 'hosted';

/** Where a run is: step `step` of `total`. */
export interface AskProgress {
  readonly step: number;
  readonly total: number;
}

/** How an ask ended. */
export type AskOutcome =
  /**
   * Saved with the ride, replacing any write-up it had. `notice`, from a
   * fixed table, says what the write-up had to leave out of the rider's
   * history (#835) — `ride-analysis.ts` §`HISTORY_NOTICE_TEXT`.
   */
  | { readonly kind: 'written'; readonly notice?: string }
  /** Nothing was saved, and any earlier write-up is untouched. `text` is from a fixed table. */
  | { readonly kind: 'failed'; readonly text: string };

/**
 * One step of a hosted run, exactly as the service will be sent it (#839):
 * its two messages, masked. `step` counts from one, as the progress does.
 */
export interface HostedPreviewStep {
  readonly step: number;
  readonly system: string;
  readonly user: string;
}

/**
 * What "See what will be sent" shows (#839). Nothing is sent to show it.
 *
 * `steps` is every step a run sends before any reply — a note per section,
 * and one on position when there is a pose summary. The last step, and its
 * rewrite if there is one, also carry the notes the model wrote in reply,
 * which cannot be known until it writes them; `total` counts them, and the
 * page says they are masked the same way.
 */
export type HostedPreview =
  | {
      readonly kind: 'shown';
      readonly steps: readonly HostedPreviewStep[];
      readonly total: number;
    }
  /** Nothing to show, and nothing was sent. `text` is from a fixed table. */
  | { readonly kind: 'failed'; readonly text: string };

/** What the ride's page may ask. */
export interface RideAnalysisPort {
  /**
   * The sources set up and switched on now, **the default first** — the
   * rider's own computer before a hosted model (the owner's ruling 7 on
   * #795). Empty when neither is, and then the page offers no control (#805's
   * fallback).
   */
  availableSources(): readonly RideWriteUpSource[];
  /**
   * Ask `source` for a write-up of ride `activityId`. Settles; never rejects.
   * Aborting `signal` cancels the run.
   */
  askForRideWriteUp(
    activityId: ActivityId,
    source: RideWriteUpSource,
    signal: AbortSignal,
    progress?: (progress: AskProgress) => void,
  ): Promise<AskOutcome>;
  /**
   * The masked text a hosted run of ride `activityId` would send, built the
   * way the run builds it and masked by the same function with the same
   * guard (#839). Sends nothing. Settles; never rejects.
   */
  previewHostedRequest(activityId: ActivityId): Promise<HostedPreview>;
  /**
   * Whether the rider has been shown a preview since the app was opened —
   * the hosted consent's own lifetime. Until they have, the page shows the
   * preview before the first hosted run rather than starting it (#839).
   */
  hostedPreviewSeen(): boolean;
}
