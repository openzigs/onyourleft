// SPDX-License-Identifier: Apache-2.0

/**
 * **What the rider is told each of the instance agent's tools returns** —
 * #1104, ADR 0046 D-7 and D-9.
 *
 * The device-built input is named field by field in the disclosures by
 * `apps/web/src/ride-analysis/sent-fields.test.ts`. A tool is the other way a
 * hosted run's text is chosen: the model calls it during the run, so nobody
 * can list in advance what it will send, only what each tool CAN return. This
 * table is that list — for every tool the agent has, the phrases the hosted
 * consent and the instance paragraph name its results with.
 *
 * Two halves hold it, one per side of the seam, because the instance knows its
 * tools and the web client knows the words:
 *
 * - `apps/instance/src/analysis/tools/tools-disclosed.test.ts` requires its
 *   keys to be EXACTLY the agent's tools, so a tool added (#1099's
 *   `history_search`, #1100's `workouts`) without an entry here is a red
 *   build, and an entry for a tool that is gone is too.
 * - The pull request that ships the instance wording (#1102) extends
 *   `sent-fields.test.ts` to require every phrase here to appear in the hosted
 *   consent and in the instance paragraph, word for word.
 *
 * ⚠️ **The phrases are #1104's drafted wording, and await the owner's
 * approval**, as every disclosure does (#1104's first criterion). Nothing
 * renders them, and no disclosure the app shows today names a tool: they
 * describe a path that has not shipped, which is why they live in a table a
 * test reads and not in a screen (ADR 0029: *"a policy amended in advance, 'so
 * it is ready', is a false statement about a shipped app"*). If the owner
 * rewords a phrase, it changes here in the same pull request.
 *
 * ⚠️ **Every phrase is more than one word**, for #847's reason: a single
 * common word is found somewhere in any long disclosure, so it would name its
 * result whether or not the list did.
 */
export const AGENT_TOOL_DISCLOSURES: Readonly<Record<string, readonly string[]>> = {
  // The asked-about ride's sections, from the device-built input only — the
  // figures `sent-fields.test.ts` already names one by one.
  ride_sections: ['how it went section by section'],
  // Synced ride summaries: the device-built passages of other rides.
  recent_rides: ['short summaries of your recent rides'],
  // Synced goals (#836): text the rider typed, which can name anything.
  goals: ['what you wrote about your goals'],
  // ADR 0040's history index (#1099), searched with a query the model writes:
  // at most six passages a call and three calls a run, cut from other rides'
  // summaries, earlier write-ups (screened again) and the goals, notes and
  // documents the rider wrote — free text that can name anything, masked but
  // not filtered on a hosted job (#1101). Never the pose summary, a picture or
  // a date. ⚠️ DRAFT: awaits the owner's approval on #1104.
  history_search: [
    'summaries of older rides',
    'earlier write-ups',
    'what you wrote about your goals',
    'your notes and documents',
  ],
};
