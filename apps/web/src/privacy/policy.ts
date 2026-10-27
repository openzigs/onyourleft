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

/**
 * The web page for requesting account deletion (#906 item 4): Google Play's
 * account-deletion requirement asks an app that creates an account for a web
 * link, beside the in-app path, where a rider can ask for the account to be
 * deleted. It is the URL to paste into Play Console's *Delete account URL*
 * field, and like the policy's it is derived from the path, so
 * `policy.test.ts` fails if the page is renamed. A GitHub page: no paid
 * service (ADR 0036 D-7).
 */
export const ACCOUNT_DELETION_PATH = 'docs/delete-your-account.md';

/** The published page for requesting account deletion. `blob/main`, as the policy's. */
export const ACCOUNT_DELETION_URL = `${REPOSITORY}/blob/main/${ACCOUNT_DELETION_PATH}`;

/**
 * Where the Corresponding Source of the running app is.
 *
 * ⚠️ **This is an obligation, not a courtesy, and ADR 0025 makes it a
 * CONDITION.** AGPL-3.0 section 6 requires whoever conveys object code to say
 * where the source is, and a rider who installed from an app store has never
 * seen the repository. The additional permission that lets this project be
 * conveyed through those stores at all (COPYRIGHT, ADR 0025 D-4) is granted
 * only *"provided that you are otherwise in compliance… including without
 * limitation making the Corresponding Source available in compliance with
 * section 6"* — so a build that ships without this link on its About screen
 * has not met the condition of the permission it is shipping under.
 *
 * The same constant as the privacy policy's, for the reason that module
 * exists: the repository is written down once.
 */
export const SOURCE_CODE_URL = REPOSITORY;
