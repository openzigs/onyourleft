// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which release of the synthetic routing graph the gate routes on, and where
 * the page asks for it (#2734). A file of its own, with no Node import, so the
 * harness page can read it; `valhalla-grid.ts` is the server half.
 */

/** The committed release: the directory name is the manifest's `release`, as the SDK requires. */
export const GRID_RELEASE = 'oyl-synthetic-5a88037d986f';

/** Where the page asks for it. */
export const GRID_PATH = '/valhalla-grid/';
