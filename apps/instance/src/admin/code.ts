// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The admin pages' one-time code** (#2641, ADR 0069 D-1): the bootstrap and
 * break-glass way in, minted on the host by `operator admin-code`.
 *
 * It is the project's readable code — sixteen characters of a 31-letter
 * alphabet with no `0`, `o`, `1`, `i` or `l`, in four groups of four, 79 bits
 * (`auth/identity.ts` §`readableCode`; ADR 0069 D-1 corrects the epic's "80
 * bits of base32") — typed in either case, with or without its hyphens or
 * spaces, as a recovery code is. It lives ten minutes, is single use, and is
 * stored only as the SHA-256 of its normalised form (`admin_code`).
 */

import { readableCode, recoveryCodeSha256 } from '../auth/identity.ts';

/** How long a code may be redeemed for, in seconds. */
export const ADMIN_CODE_LIFETIME_SECONDS = 10 * 60;

/** A fresh code to print once, and the SHA-256 the store keeps of it. */
export async function newAdminCode(): Promise<{
  readonly code: string;
  readonly sha256: string;
}> {
  const code = readableCode(16);
  const sha256 = await adminCodeSha256(code);
  // A code `readableCode` drew always has the shape it reads back.
  if (sha256 === undefined) throw new Error('a drawn admin code did not read back');
  return { code, sha256 };
}

/**
 * The SHA-256 the store keeps of a code as it was typed, or `undefined` when
 * what was typed is not the shape of one — so a typing error is refused with
 * no lookup. The shape and the normalising are a recovery code's, which is
 * why this reads it through `recoveryCodeSha256`.
 */
export function adminCodeSha256(typed: string): Promise<string | undefined> {
  return recoveryCodeSha256(typed);
}
