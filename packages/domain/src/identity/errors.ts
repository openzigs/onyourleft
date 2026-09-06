// SPDX-License-Identifier: Apache-2.0

/**
 * The one error the identity module raises.
 *
 * **No message in this module may carry key material, a signature, or a byte
 * of a record's payload.** Not because the caller does not already have the
 * value — it passed it in — but because a thrown message continues past the
 * `throw` into a console, a crash report and a bug tracker that the throw site
 * does not control. That is the same reasoning ADR 0004 decision D applies to
 * coordinates, and #61's acceptance criteria apply it to a private key: "never
 * appears in any exported file, log line or error report".
 *
 * So the messages here name the **field** and the **constraint**, and never the
 * value. `record-safety.test.ts` enumerates this module's rejections and fails
 * if any message contains the material it rejected.
 */

/** Raised when a value offered to the identity module is not what it claims. */
export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}
