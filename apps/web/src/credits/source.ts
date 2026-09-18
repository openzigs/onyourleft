// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The manifest itself, as it is at the moment this client was built.
 *
 * ⚠️ **One line, in its own file, on purpose.** It is the only thing in the
 * credits code that is not pure, and keeping it here means `manifest.ts` and
 * `credits.ts` can be exercised against fixtures while `CreditsView` still
 * defaults to the real thing.
 *
 * ## Why an import rather than a generated file, or a fetch
 *
 * A **generated, committed** credits file would be the shape #299 exists to
 * catch: a second copy of a source of truth, kept in step by whoever remembers
 * to regenerate it, needing its own `CAP004`-shaped gate to notice when it
 * drifts. #358 asks for the version with no second copy, so Vite inlines the
 * manifest at build time and there is nothing to keep in step.
 *
 * A **fetch** would be worse than either: the screen would depend on the
 * manifest having been deployed beside the bundle, would fail inside the
 * Android shell's `file://` origin, and would make an attribution notice
 * conditional on the network. #358's second criterion says the manifest ships
 * with the build, and `CreditsView.test.tsx` asserts that rendering the screen
 * asks the network for nothing.
 *
 * The cost is stated: the whole manifest is in the bundle, including rows for
 * files that ship in no client — twelve FIT fixtures and the Capacitor
 * template's launcher art. That is about 20 kB of text before compression, and
 * the alternative is a build step that decides what a rider may be shown.
 */

import manifest from '../../../../ASSETS.toml?raw';

/** `ASSETS.toml`, verbatim. */
export const ASSET_MANIFEST_SOURCE: string = manifest;
