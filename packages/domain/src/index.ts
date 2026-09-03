// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/domain` — canonical units, core types, validation, signing and
 * analysis.
 *
 * This package depends on **no platform API at all**: no DOM, no Node globals,
 * no I/O, no network types. `tsconfig.json` enforces it by narrowing `lib` and
 * emptying `types`, and `eslint.config.js` enforces it again for the module
 * specifiers a `lib` narrowing cannot see. See docs/architecture.md.
 */

export { metresPerSecondToKilometresPerHour, UnitError } from './speed';
