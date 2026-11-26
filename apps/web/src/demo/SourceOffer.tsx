// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo page's source offer — #1645, kept by the player (#1647).
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

/**
 * The two-minute demo video on YouTube — #3225. A link, never an embed: the
 * page's policy (`demo/index.html`: `default-src 'self'`) refuses a third-party
 * frame, and a player would load YouTube's cookies; navigating to an address is
 * not something the policy governs, so it is unchanged. It opens in a new tab
 * because the demo is usually an iframe of another site, and YouTube refuses
 * to be framed.
 */
export const DEMO_VIDEO_URL = 'https://www.youtube.com/watch?v=lgpE-VbyFa0';

/** The offer, as the page's footer. */
export function DemoSourceOffer() {
  return (
    // #1654: small, and off the stage, so the offer is on screen in an iframe
    // as small as 320 × 180 and covers nothing.
    <footer
      className="oyl-demo__offer"
      style={{ fontSize: 'var(--oyl-font-size-sm)', lineHeight: 1.3 }}
    >
      <p style={{ margin: 0, padding: 'var(--oyl-space-xs) var(--oyl-space-sm)' }}>
        {/* #1945: in a small frame `demo.css` leaves this sentence to a screen
            reader, and the links below stay on screen. */}
        <span className="oyl-demo__offer-sentence">
          Free and open source, under the GNU Affero General Public License, version 3 or later.
        </span>{' '}
        <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
          Source code
        </a>{' '}
        ·{' '}
        <a href={DEMO_LICENCE_URL} target="_blank" rel="noreferrer">
          Licence (AGPL-3.0-or-later)
        </a>{' '}
        · <a href={DEMO_NOTICES_PATH}>Third-party notices</a> ·{' '}
        {/* #3225: in a small frame `demo.css` leaves "Watch the two-minute" to a
            screen reader, as it does the sentence above, so the link costs the
            stage no line; the name is whole either way. */}
        <a className="oyl-demo__video-link" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
          <span className="oyl-demo__video-lead">Watch the two-minute </span>demo on YouTube
        </a>
      </p>
    </footer>
  );
}
