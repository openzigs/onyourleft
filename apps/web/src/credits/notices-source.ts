// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The contents of the third-party notices, as they were when this client was
 * built — #664.
 *
 * ⚠️ **One line, in its own file, on purpose** — `source.ts`'s reason: it is
 * the only impure thing in the notices code, so `notices.ts` and `CreditsView`
 * can be exercised against a fixture while the screen still defaults to the
 * real thing.
 *
 * ⚠️ **The contents, not the whole document.** Both are written by
 * `scripts/check-third-party-notices.mjs` and both are compared by
 * `check:notices`; the whole document is about 125 KiB of licence text and is
 * served beside the app for a rider to open, while the screen needs only the
 * list, which is about 5 KiB. `check-third-party-notices.mjs` §`CONTENTS`
 * says why the list is inlined rather than fetched.
 */

import contents from './third-party-contents.txt?raw';

/** `third-party-contents.txt`, verbatim. */
export const THIRD_PARTY_CONTENTS_SOURCE: string = contents;
