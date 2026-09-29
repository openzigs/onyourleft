// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The History group's views — Activities, a ride's page, Analysis, Segments and a segment's page.
 *
 * One module per navigation group (#674), so the bundler writes each group
 * into a chunk of its own that `AppShell` loads with `import()` only when a
 * route in it is opened. `tools/bundle/entry-graph.ts` fails the build when
 * any view named here is reachable from the entry chunk without a dynamic
 * import, and reads this file to know which views those are.
 */

export { ActivitiesView } from '../../views/ActivitiesView';
export { ActivityDetailView } from '../../views/ActivityDetailView';
export { AnalysisView } from '../../views/AnalysisView';
export { SegmentsView } from '../../views/SegmentsView';
export { SegmentDetailView } from '../../views/SegmentDetailView';
