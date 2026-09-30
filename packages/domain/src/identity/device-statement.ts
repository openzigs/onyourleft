// SPDX-License-Identifier: Apache-2.0

/**
 * What a device signs to prove to an instance that it holds a key (#772, #773).
 *
 * The device's ADR 0014 key signs activity records. The same key proves who a
 * device is to an instance, by signing a **statement**:
 *
 * ```json
 * { "purpose": "oyl-auth-v1", "instanceOrigin": "https://ride.example",
 *   "nonce": "<64 hex>", "publicKey": "<64 hex>", "issuedAt": 1790000000 }
 * ```
 *
 * canonicalised with RFC 8785 (`canonical.ts`) and signed as UTF-8 bytes.
 * Canonicalised HERE, once, because ADR 0014 D-8 says the canonicalisation
 * happens on the domain side "because #7 verifies from Node what `apps/web`
 * signed in a browser": the browser and the instance import this one function.
 *
 * ## Two members that exist to refuse something
 *
 * - **`instanceOrigin`** binds the signature to one instance, so a signature
 *   an instance was shown cannot be replayed at another one the same rider
 *   uses.
 * - **`purpose`** stops the statement being confused with anything else the
 *   same key signs. An activity record is canonical JSON under the same key
 *   (ADR 0014 D-4), and a record's canonical bytes have no `purpose` member at
 *   all, so no record verifies as a statement and no statement as a record.
 *   The three purposes below are distinct for the same reason: a device
 *   signing in cannot have its signature used to LINK a key or RECOVER an
 *   account, which add a key to an athlete rather than open a session.
 *
 * Not a secret, and not a record: nothing here is stored.
 */

import { canonicalBytes } from './canonical';

/** Signing in: the statement `POST /auth/session` verifies. */
export const AUTH_PURPOSE = 'oyl-auth-v1';

/** Adding this device's key to the athlete whose other device minted a link code (#773). */
export const LINK_PURPOSE = 'oyl-link-v1';

/** Adding this device's key to an athlete with a recovery code, every other device lost (#773). */
export const RECOVER_PURPOSE = 'oyl-recover-v1';

/** Every purpose an instance accepts, each at exactly one route. */
export type DevicePurpose = typeof AUTH_PURPOSE | typeof LINK_PURPOSE | typeof RECOVER_PURPOSE;

/** The five members a device signs. */
export interface DeviceStatement {
  readonly purpose: DevicePurpose;
  /** The instance's origin — scheme, host and port — exactly as the instance states it. */
  readonly instanceOrigin: string;
  /** The challenge the instance issued, lowercase hex. */
  readonly nonce: string;
  /** The device's Ed25519 public key, lowercase hex (ADR 0014's spelling). */
  readonly publicKey: string;
  /** When the device signed, in Unix seconds. */
  readonly issuedAt: number;
}

/** The bytes a device signs and an instance verifies: the statement's RFC 8785 form. */
export function deviceStatementBytes(statement: DeviceStatement): Uint8Array {
  return canonicalBytes({
    purpose: statement.purpose,
    instanceOrigin: statement.instanceOrigin,
    nonce: statement.nonce,
    publicKey: statement.publicKey,
    issuedAt: statement.issuedAt,
  });
}
