// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Ride group's views — Ride, the trainer game and Workouts.
 *
 * One module per navigation group (#674), so the bundler writes each group
 * into a chunk of its own that `AppShell` loads with `import()` only when a
 * route in it is opened. `tools/bundle/entry-graph.ts` fails the build when
 * any view named here is reachable from the entry chunk without a dynamic
 * import, and reads this file to know which views those are.
 */

export { RideView } from '../../views/RideView';
export { GameView } from '../../game/GameView';
export { WorkoutsView } from '../../views/WorkoutsView';
