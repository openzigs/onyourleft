// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where a side-camera session's report goes when the session ends** —
 * [#388](https://github.com/openzigs/onyourleft/issues/388), the owner's
 * retention ruling of 2026-09-26: *"when a side-camera session ends, the
 * report's sentences are saved with that ride."*
 *
 * `side-analysis.ts` opens a {@link SideReportSession} when a pairing's
 * analysis begins and ends it with the report's sentences when the pairing
 * ends. `side-report-keeper.ts` is the implementation: it works out which ride
 * the session filmed and saves the sentences against it.
 *
 * ## Why a `*-port.ts`
 *
 * CLAUDE.md §4j: `check:wiring` watches every `*-port.ts`, so a method here
 * that no production code calls is a red `WIRE003`. That matters for the half
 * a unit test cannot see: an analysis that computed a report and handed it to
 * nothing would pass every test of the report and save no sentence. ⚠️ The
 * `reports` option on `SideAnalysisOptions` is optional, so `main.tsx` leaving
 * it out is well typed and green here — §Limits' third entry; `main.tsx` says
 * so beside the line that supplies it.
 */

import type { SideReport } from './side-report';

/** One pairing's report, on its way to the ride it filmed. */
export interface SideReportSession {
  /**
   * The pairing has ended. `report` is its sentences, or `undefined` when there
   * was nothing to report (a pairing that never filmed). Called at most once.
   */
  endSideReportSession(report: SideReport | undefined): void;
}

/** What `side-analysis.ts` asks of whatever keeps its reports. */
export interface SideReportKeepingPort {
  /** A pairing's analysis has begun. */
  beginSideReportSession(): SideReportSession;
}
