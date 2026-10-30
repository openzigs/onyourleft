// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The licence texts this app ships, read inside the app** — #1744.
 *
 * Credits used to link `credits.ts` §`SHIPPED_LICENCE_TEXTS` (the Apache-2.0
 * text, #597, and the OFL-1.1 text, #991) with `target="_blank"`. Inside the
 * Android shell that loaded the `.txt` over the app and back then left it:
 * the same trap `notices-document.ts` describes for the third-party notices
 * (#664). So the screen renders each text itself, read the way that module
 * reads the notices: a dynamic `import()` of the committed file, one chunk per
 * licence, downloaded only when a rider opens it, precached like every other
 * chunk and shipped inside the APK. Not a `fetch`, for the reason that module
 * gives.
 *
 * ⚠️ **The files imported are the files `SHIPPED_LICENCE_TEXTS` names**, which
 * `credits.test.ts` holds byte-identical to the canonical texts and which are
 * still served at those URLs for a browser. `licence-documents.test.ts` reads
 * both back and compares them, so a loader cannot point at another copy.
 */

const LOADERS: Readonly<Record<string, () => Promise<{ readonly default: string }>>> = {
  'Apache-2.0': () => import('../../public/licences/Apache-2.0.txt?raw'),
  'OFL-1.1': () => import('../../public/licences/OFL-1.1.txt?raw'),
};

/** The licences {@link loadShippedLicence} can read, in display order. */
export const READABLE_LICENCES: readonly string[] = Object.keys(LOADERS);

/**
 * One shipped licence text, verbatim. Rejects for a licence this app does not
 * ship a copy of, so the screen says it could not be read rather than showing
 * an empty block.
 */
export async function loadShippedLicence(licence: string): Promise<string> {
  const load = LOADERS[licence];
  if (load === undefined) {
    throw new Error(`This app ships no copy of the ${licence} licence.`);
  }
  const module = await load();
  return module.default;
}
