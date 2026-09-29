// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The run-time screen a model's write-up passes before anybody is shown it
 * or anything keeps it** — [#798](https://github.com/openzigs/onyourleft/issues/798),
 * epic #795, the owner's ruling 3: *"The angle and frontal-plane gate
 * (`no-absolute-angles`) still screens the model's output at run time: a
 * write-up that fails is not shown."*
 *
 * ## The same rules as the source scan, from the same module
 *
 * The matchers are `angle-claims.ts`'s — the ones `no-absolute-angles.ts`
 * holds this client's source to — so a sentence the build refuses to ship is
 * a sentence a model cannot get shown either. The HTML character references
 * the scan decodes in JSX are decoded here too, **for matching only**: a
 * write-up is shown as plain text, so `142&deg;` reaches a rider as eight
 * characters, and it is withheld anyway, because a ban that errs is one a
 * reviewer reads rather than one a rider does.
 *
 * ## Plain text, and nothing that renders as something else
 *
 * ADR 0029 D-8: model output is untrusted. What comes out of here is a string
 * for a React text node — never markup, never a link, never a path, a URL or a
 * command, and never anything a trainer reads. The screen itself:
 *
 * - **takes out** what renders as nothing or reorders what is around it —
 *   `angle-claims.ts` §`INVISIBLE`: the soft hyphen, the zero-width
 *   characters, the directional marks, embeddings, overrides and isolates and
 *   the byte-order mark (#815's review: the store admits them on purpose and
 *   leaves them to this screen). Taking them out changes no word a rider can
 *   read, and it is the text WITHOUT them that the rules are matched against;
 * - **writes** a carriage return or a CRLF as a newline and a tab as a space;
 * - **withholds** a write-up that still holds any other control character
 *   (C0, DEL, C1), is empty, or is longer than
 *   {@link MAXIMUM_WRITE_UP_CHARACTERS} — the store's own bound, imported
 *   rather than restated, so what is shown and what is kept cannot disagree.
 *
 * Markdown and HTML are left exactly as written: they are characters, and a
 * text node shows them as characters.
 *
 * ## Withheld WHOLE, and never with the words that failed
 *
 * One finding withholds the whole write-up: there is no partial text, because
 * a report with the offending sentence cut out is this client editing what a
 * model said, and the sentences around it were written by the same model.
 * What is returned is only the **kinds** of finding — never the matched text
 * or what surrounds it — so a finding shown to the rider, or handed to a
 * `rewrite` step (#811), carries no model words.
 *
 * ## Only this function makes a {@link ScreenedWriteUp}
 *
 * It is a brand, like `UntrustedText`, so an `UntrustedText` cannot be
 * rendered or stored where a screened write-up is needed — a
 * `@ts-expect-error` in `write-up-screen.test.ts` pins that.
 *
 * ## What it cannot see
 *
 * A claim made in words none of the rules names ("your knee bent to a right
 * angle and a half" is not a number with a sign), a number spelled in a
 * script whose digits NFKC does not fold, and anything outside the text. A
 * write-up that passes has been shown to break the two rules, and no more.
 */

import { MAXIMUM_WRITE_UP_CHARACTERS } from '@onyourleft/store';

import type { UntrustedText } from './analysis-port';
import {
  type AngleClaimKind,
  angleClaimKinds,
  decodeCharacterReferences,
  INVISIBLE,
} from './angle-claims';

export { MAXIMUM_WRITE_UP_CHARACTERS };

declare const screened: unique symbol;

/** A model's write-up that passed {@link screenWriteUp}: plain text, to be shown as text. */
export type ScreenedWriteUp = string & { readonly [screened]: true };

/**
 * Why a write-up was withheld — the kind of finding, never its words. The
 * angle kinds are `angle-claims.ts`'s; the rest are this screen's own.
 */
export type ScreenReason = 'empty' | 'too-long' | 'control-character' | AngleClaimKind;

/** A write-up that is not shown, and every kind of reason it is not. */
export interface WithheldWriteUp {
  readonly withheld: readonly ScreenReason[];
}

/** Every control character but a newline: C0, DEL and C1. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/**
 * The write-up as a rider would be shown it, or every kind of reason it is
 * withheld. Never throws.
 */
export function screenWriteUp(text: UntrustedText): ScreenedWriteUp | WithheldWriteUp {
  const shown = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .trim();
  if (shown === '') {
    return { withheld: ['empty'] };
  }
  // Refused before anything is matched, so no pattern ever runs over a text
  // longer than the one bound every holder of a write-up agrees on.
  if (shown.length > MAXIMUM_WRITE_UP_CHARACTERS) {
    return { withheld: ['too-long'] };
  }
  const reasons = new Set<ScreenReason>();
  if (CONTROL_BUT_NEWLINE.test(shown)) {
    reasons.add('control-character');
  }
  for (const kind of [
    ...angleClaimKinds(shown),
    ...angleClaimKinds(decodeCharacterReferences(shown)),
  ]) {
    reasons.add(kind);
  }
  return reasons.size === 0 ? (shown as ScreenedWriteUp) : { withheld: [...reasons] };
}

/** Whether {@link screenWriteUp} let the write-up through. */
export function passedScreen(
  outcome: ScreenedWriteUp | WithheldWriteUp,
): outcome is ScreenedWriteUp {
  return typeof outcome === 'string';
}
