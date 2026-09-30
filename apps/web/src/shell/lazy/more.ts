// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The More group's views — Devices, Files, Camera, the side camera, Settings,
 * connecting to an instance (#777), About and Credits.
 *
 * One module per navigation group (#674), so the bundler writes each group
 * into a chunk of its own that `AppShell` loads with `import()` only when a
 * route in it is opened. `tools/bundle/entry-graph.ts` fails the build when
 * any view named here is reachable from the entry chunk without a dynamic
 * import, and reads this file to know which views those are.
 */

export { DevicesView } from '../../views/DevicesView';
export { TransferView } from '../../transfer/TransferView';
export { CameraView } from '../../views/CameraView';
export { SideCameraView } from '../../views/SideCameraView';
export { SettingsView } from '../../views/SettingsView';
export { InstanceView } from '../../views/InstanceView';
export { AboutView } from '../../views/AboutView';
export { CreditsView } from '../../views/CreditsView';
