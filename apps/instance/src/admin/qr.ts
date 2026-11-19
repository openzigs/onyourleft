// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's card and a single-use code, as one QR code, drawn on the
 * server** — #2783, ADR 0080 (#2795) D-3 (the owner's claim code) and D-7
 * (a rider's invite), ADR 0047 D-6.
 *
 * - **The payload is the app's own line**: `<card> <code>`, exactly what
 *   `apps/web/src/instance/instance-pin.ts` §`codeWithCard` writes and
 *   §`readCodeWithCard` reads back. `apps/instance` may not import `apps/web`,
 *   so {@link cardWithCode} restates it, and
 *   `apps/web/src/a11y/admin-pages.a11y.test.ts` holds the two equal.
 * - **The card is checked whole before anything is drawn**
 *   (`@onyourleft/domain` §`parseInstanceCard`): an `oyl-instance:` card with
 *   the full 52-character fingerprint, never truncated (ADR 0047 D-6). A card
 *   that is not one, or a code that is not the instance's four groups of
 *   four, throws: it is a caller's mistake, never something to draw.
 * - **`oyl-instance:` is not a URL scheme** (ADR 0047 D-6,
 *   `apps/web/src/instance/no-url-handler.test.ts`), so a phone's system camera
 *   offers nothing to open; the app reads the code with its own scanner (#2785).
 * - **SVG and no script**, because the admin and setup pages run under
 *   `headers.ts` §`ADMIN_CONTENT_SECURITY_POLICY`: one `<path>` over a white
 *   square, drawn as the app's `camera/PairingCode.tsx` draws a code — one
 *   unit a module, a four-module quiet zone, black on white and never themed,
 *   because it is a symbol for a camera. The colours are SVG attributes, not a
 *   `style`, which the policy would refuse.
 * - **Drawn by `uqr`** 0.1.3, MIT, with no dependencies: the library the app
 *   already draws its codes with (`camera/side-link-qr.ts`), so both ends
 *   encode the same way. ADR 0037's amendment of 2026-11-18 is its row.
 *
 * ⚠️ **Only the loopback listener may be handed a card** (ADR 0069 D-2, D-5,
 * ADR 0080 D-1, D-3). Nothing here knows which listener it is drawing for: the
 * caller is the gate, as `admin.ts` §`keysPage` is for the card as text.
 */

import { parseInstanceCard } from '@onyourleft/domain';
import { encode } from 'uqr';

import { escapeHtml } from '../html.ts';

/**
 * The error correction a code is drawn with: `M`, as the app's
 * (`camera/side-link-qr.ts` §`PAIRING_CODE_CORRECTION`). A screen photographed
 * by a tablet is a glare and a reflection away from `L`'s 7 %.
 */
export const QR_CORRECTION = 'M';

/** The quiet zone, in modules: the QR specification's four. */
export const QR_QUIET_ZONE = 4;

/** The dark modules: black. Not a palette colour, so a theme cannot repaint it. */
export const QR_INK = '#000000';
/** The light modules and the quiet zone: white. */
export const QR_PAPER = '#ffffff';

/** A code as the instance mints one (`auth/identity.ts` §`readableCode`): four groups of four. */
const CODE_PATTERN = /^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/;

/**
 * The card and a code as one line: the app's `codeWithCard`, restated. Throws
 * unless `card` is a whole instance card and `code` a code the instance mints.
 */
export function cardWithCode(card: string, code: string): string {
  // The parser trims; the line may not carry a space the app would split it on.
  if (card !== card.trim() || !parseInstanceCard(card).ok) {
    throw new Error('a QR code was asked for something that is not a whole instance card');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new Error('a QR code was asked for a code that is not one the instance mints');
  }
  return `${card} ${code}`;
}

/** The grid of modules `text` is drawn as, row by row: `true` is dark. No quiet zone. */
export function qrModules(text: string): readonly (readonly boolean[])[] {
  return encode(text, { ecc: QR_CORRECTION, border: 0 }).data;
}

/**
 * `text` as an inline SVG QR code, named `label` for a screen reader, and
 * described by the element `describedBy` names — the same text, written out
 * beside it, which is the code's alternative.
 */
export function qrSvg(text: string, label: string, describedBy: string): string {
  const modules = qrModules(text);
  const size = modules.length + QR_QUIET_ZONE * 2;
  const path: string[] = [];
  for (const [row, cells] of modules.entries()) {
    for (const [column, dark] of cells.entries()) {
      if (dark) {
        path.push(`M${String(column + QR_QUIET_ZONE)} ${String(row + QR_QUIET_ZONE)}h1v1h-1z`);
      }
    }
  }
  const side = String(size);
  return `<svg class="qr" role="img" aria-label="${escapeHtml(label)}" aria-describedby="${escapeHtml(describedBy)}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" focusable="false" data-oyl-qr="true"><rect width="${side}" height="${side}" fill="${QR_PAPER}"/><path d="${path.join('')}" fill="${QR_INK}"/></svg>`;
}
