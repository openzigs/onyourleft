// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The illustration kit — #938, the house style of epic #935.
 *
 * ⚠️ **This module exports parts and nothing else**, and that is a rule
 * `illustration.test.tsx` reads: it renders every export of this file and
 * holds each to the kit's rules (an `aria-hidden` `<svg>`, no text, no colour
 * but a token), so a part added here is checked with no edit to the test. A
 * constant or a helper belongs in its part's own file.
 *
 * Flat geometric art drawn from arithmetic in this repository (the owner's
 * D-1 on #935) — nothing downloaded, nothing traced, and no icon set's path
 * data (ADR 0034 D-3) — so none of it has an `ASSETS.toml` row: it is source.
 * `docs/architecture.md` §"House style for the menus" is the rules in prose.
 */

export { Hills } from './Hills';
export { ProfileShape } from './ProfileShape';
export { RiderSilhouette } from './RiderSilhouette';
export { RoadRibbon } from './RoadRibbon';
export { SensorGlyph } from './SensorGlyph';
export { Sky } from './Sky';
export { WorkoutShape } from './WorkoutShape';
