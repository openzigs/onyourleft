// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `card-qr-fixture.png` says — #2785: an instance card and a link code,
 * as `instance/instance-pin.ts` §`codeWithCard` writes them. No real instance:
 * `instance.example.org`, the scripted fingerprint
 * (`instance/testing.ts` §`SCRIPTED_FINGERPRINT`) and a made-up code.
 * `cardscan-harness.tsx` reads the picture; `cardscan.browser.spec.ts` checks
 * the scan put exactly this in the line box.
 */
export const CARD_QR_TEXT =
  'oyl-instance:https://instance.example.org#ABCDABCDABCDABCDABCDABCDABCDABCDABCDABCDABCDABCDEFGA ' +
  'abcd-efgh-jkmn-pqrs';
