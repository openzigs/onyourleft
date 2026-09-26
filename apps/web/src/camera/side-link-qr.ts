// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A pairing code as a QR code, and back** — #529,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-1.
 *
 * The two libraries this feature added, and the only place either is named:
 *
 * | | Library | Licence | Why |
 * |---|---|---|---|
 * | Drawing | `uqr` 0.1.3 | MIT, no dependencies | turns text into the grid of modules the screen draws; nothing else |
 * | Reading | `jsqr` 1.4.0 | Apache-2.0, no dependencies | finds and decodes a code in a picture's pixels, in plain JavaScript, so it reads the same in a browser, the Android WebView and jsdom |
 *
 * ⚠️ **Why not the platform's `BarcodeDetector`.** It is not in desktop
 * Chrome on Linux or Windows, and whether the Android System WebView exposes
 * it could not be established from here — and #529 must work in a browser AND
 * inside the Android shell. A reader that is the same code everywhere is one
 * behaviour to test rather than two.
 *
 * ## What happens to the pixels (ADR 0033 D-4)
 *
 * *"Decoded in memory for the code only, discarded as soon as a code is read
 * or scanning is cancelled, never sent, never kept and never analysed for
 * anything else."* {@link pairingCodeFromPixels} takes a picture's pixels and
 * returns a string or nothing: it keeps no reference to them, and the caller
 * (`session.ts` §`readPairingCode`) drops them with the call.
 */

import jsQR from 'jsqr';
import { encode } from 'uqr';

import type { CodePixels } from './camera-port';

/**
 * The error correction a pairing code is drawn with: `M`, which recovers 15 %
 * of the code. A tablet held at arm's length in a room is a glare and a
 * fingerprint away from `L`'s 7 %, and `Q` would make an offer's code two
 * versions denser for the phone's camera to resolve.
 */
export const PAIRING_CODE_CORRECTION = 'M';

/** The grid of modules `text` is drawn as, row by row: `true` is dark. No quiet zone. */
export function pairingCodeModules(text: string): readonly (readonly boolean[])[] {
  return encode(text, { ecc: PAIRING_CODE_CORRECTION, border: 0 }).data;
}

/**
 * The text of a QR code found in `pixels`, or `undefined` when there is none
 * this reader can find.
 *
 * Both polarities are tried, because a phone's screen photographed in a
 * bright room can read as light-on-dark.
 */
export function pairingCodeFromPixels(pixels: CodePixels): string | undefined {
  if (pixels.rgba.length !== pixels.width * pixels.height * 4) {
    return undefined;
  }
  const found = jsQR(pixels.rgba, pixels.width, pixels.height, {
    inversionAttempts: 'attemptBoth',
  });
  return found === null || found.data === '' ? undefined : found.data;
}
