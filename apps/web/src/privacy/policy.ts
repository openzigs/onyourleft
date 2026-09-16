// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the published privacy policy is, stated once
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * Google Play's Health Content and Services policy requires the privacy policy
 * to be reachable **from inside the app** as well as from the store listing,
 * and requires the two to be the same URL — this app is in scope of that policy
 * because heart rate and power advance gameplay, which is Play's own worked
 * example (#95). So the URL is a constant here rather than an `href` typed into
 * a component: a link in JSX and a link pasted into a console form are two
 * copies of one fact, and the copy nobody can diff is the one that goes stale.
 *
 * ⚠️ **The URL is DERIVED from the path, not typed beside it.** Typing both is
 * the same drift one step later: the file could be renamed, the link would
 * still resolve to a plausible-looking GitHub URL, and the reader would get a
 * 404 from a page that claims to be a privacy policy. `policy.test.ts` resolves
 * {@link PRIVACY_POLICY_PATH} against the repository and fails if nothing is
 * there.
 */

/** The policy's path in this repository, from the repository root. */
export const PRIVACY_POLICY_PATH = 'docs/privacy-policy.md';

/** The repository the app is published from. */
const REPOSITORY = 'https://github.com/openzigs/onyourleft';

/**
 * The published policy.
 *
 * ⚠️ `blob/main` rather than a tag or a commit: the policy that applies is the
 * current one, and a link pinned to the release a phone happens to be running
 * would show an athlete a policy that has been superseded. The file's own
 * history is the change log — the document says so.
 */
export const PRIVACY_POLICY_URL = `${REPOSITORY}/blob/main/${PRIVACY_POLICY_PATH}`;
