// SPDX-License-Identifier: Apache-2.0

/**
 * A rider's display name: the one string a rider chooses that strangers see
 * (#774, ADR 0028 D-6.5 — "rider-chosen, unverified, and shown").
 *
 * Because it is shown to other riders, it is also the first thing a person
 * could use to deceive one: a name that renders as somebody else's, a name
 * that reverses the text after it, a name with nothing visible in it. So the
 * rule is narrow and every refusal is its own reason:
 *
 * - **`not-text`** — an unpaired surrogate, which is not a Unicode scalar value.
 * - **`control`** — a C0 or C1 control character (`\p{Cc}`): a newline, a tab,
 *   a bell.
 * - **`bidi`** — a bidirectional formatting character: the embeddings and
 *   overrides U+202A–U+202E, the isolates U+2066–U+2069, and the marks
 *   U+200E, U+200F and U+061C. An override inside a name reverses what follows
 *   it on a leaderboard.
 * - **`invisible`** — any other format character or default-ignorable code
 *   point: the zero-width space and joiners, the word joiner, the soft hyphen.
 *   The same set `apps/web/src/camera/angle-claims.ts` §`INVISIBLE` strips
 *   before it matches (#564): `\p{Default_Ignorable_Code_Point}` and `\p{Cf}`.
 * - **`empty`** — nothing left after surrounding white space is trimmed.
 * - **`too-long`** — more than {@link MAXIMUM_DISPLAY_NAME_SCALARS} scalar
 *   values after NFC normalisation. Counted in scalar values, not UTF-16 code
 *   units, so an emoji is one and not two.
 *
 * The name that is kept is the NFC form, trimmed, so two riders who type the
 * same name on different keyboards store the same bytes.
 */

/** The longest display name, in Unicode scalar values after NFC. */
export const MAXIMUM_DISPLAY_NAME_SCALARS = 32;

/** Why a display name was refused. */
export type DisplayNameProblem =
  'not-text' | 'control' | 'bidi' | 'invisible' | 'empty' | 'too-long';

export type DisplayNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly problem: DisplayNameProblem };

const CONTROL = /\p{Cc}/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;

/** Check a display name, and give back the form to store. */
export function checkDisplayName(input: string): DisplayNameCheck {
  // Checked on the raw input, before `normalize` sees a lone surrogate.
  if (!input.isWellFormed()) return { ok: false, problem: 'not-text' };
  const name = input.normalize('NFC').trim();
  if (CONTROL.test(name)) return { ok: false, problem: 'control' };
  if (BIDI.test(name)) return { ok: false, problem: 'bidi' };
  if (INVISIBLE.test(name)) return { ok: false, problem: 'invisible' };
  if (name.length === 0) return { ok: false, problem: 'empty' };
  if ([...name].length > MAXIMUM_DISPLAY_NAME_SCALARS) return { ok: false, problem: 'too-long' };
  return { ok: true, name };
}
