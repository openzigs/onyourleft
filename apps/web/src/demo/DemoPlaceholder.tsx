// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the demo page shows until its player arrives (#1647), and the source
 * offer it keeps after that.
 *
 * ⚠️ **The source links are an obligation, not a courtesy.** The demo's bundle
 * is conveyed to every visitor's browser, so AGPL-3.0 §6 applies to it as it
 * does to the app (`AboutView.tsx`, ADR 0025): the page says where the source
 * is, and under what licence. The third-party notices are the product's
 * document, copied into the demo build by `tools/demo/demo-output.ts`.
 */

import { SOURCE_CODE_URL } from '../privacy/policy';

/** The licence the demo is published under, as the repository states it. */
export const DEMO_LICENCE_URL = `${SOURCE_CODE_URL}/blob/main/LICENSE`;

/** The notices document, relative to the page, so it works from any path. */
export const DEMO_NOTICES_PATH = './licences/third-party.txt';

/** The placeholder. */
export function DemoPlaceholder() {
  return (
    <main>
      <h1>On Your Left</h1>
      <p>The demo ride is on its way.</p>
      <footer>
        <p>
          Free and open source, under the GNU Affero General Public License, version 3 or later.{' '}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
            Source code
          </a>{' '}
          ·{' '}
          <a href={DEMO_LICENCE_URL} target="_blank" rel="noreferrer">
            Licence (AGPL-3.0-or-later)
          </a>{' '}
          · <a href={DEMO_NOTICES_PATH}>Third-party notices</a>
        </p>
      </footer>
    </main>
  );
}
