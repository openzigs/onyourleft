// SPDX-License-Identifier: Apache-2.0

/**
 * **The owner's claim's comparison code** (#2782, ADR 0080 D-5): six digits
 * the instance and the claiming tablet each derive, on their own, from the
 * claim code and the claiming device's public key. The instance's loopback
 * page shows its six beside the pending claim, the tablet shows its own, and
 * the owner confirms the claim only when the two agree.
 *
 * Here, not in the instance or the app, because both sides must agree byte
 * for byte, and a derivation written twice drifts.
 *
 * The derivation: SHA-256 over the UTF-8 of
 *
 * ```text
 * oyl-owner-claim-compare-v1\n<claim code, normalised>\n<device key, lowercase hex>
 * ```
 *
 * whose first four bytes, read as a big-endian unsigned integer, are taken
 * modulo 1 000 000 and written as six digits with leading zeros. The claim
 * code is normalised as the instance reads every readable code: lower case,
 * with no whitespace and no hyphens, so the code typed or scanned in either
 * form gives the same six digits. The label is this code's own (D-5: "a
 * domain label of its own"), so no other hash the project takes of a code or
 * a key can be replayed as one. 2^32 is not a multiple of 10^6, so the
 * digits are not exactly uniform; the bias is under one part in 4 000 and
 * buys an attacker nothing, because only one claim can be pending at a time
 * and an attacker who redeems first does not need to match anything (D-5).
 */

import { utf8Encode } from './utf8';
import type { Sha256 } from './seam';

/** The domain label the comparison code's hash starts with. */
export const OWNER_CLAIM_COMPARISON_LABEL = 'oyl-owner-claim-compare-v1';

/** A claim code as the instance reads it: lower case, no whitespace, no hyphens. */
export function normalisedClaimCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

/** The six-digit comparison code for `claimCode` redeemed by `deviceKey` (lowercase hex). */
export async function ownerClaimComparisonCode(
  sha256: Sha256,
  claimCode: string,
  deviceKey: string,
): Promise<string> {
  const digest = await sha256(
    utf8Encode(
      `${OWNER_CLAIM_COMPARISON_LABEL}\n${normalisedClaimCode(claimCode)}\n${deviceKey.toLowerCase()}`,
    ),
  );
  const first =
    (((digest[0] ?? 0) << 24) >>> 0) +
    ((digest[1] ?? 0) << 16) +
    ((digest[2] ?? 0) << 8) +
    (digest[3] ?? 0);
  return String(first % 1_000_000).padStart(6, '0');
}
