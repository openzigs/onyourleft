// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words of the two mails an instance sends (#1194, ADR 0047 D-8): the
 * recovery code, and the code that confirms a recovery address.
 *
 * ⚠️ **Each carries its token as a code to TYPE into the app, and never a
 * link of any kind** — no `https:` URL on the instance's origin or any other,
 * no custom scheme and no App Link. A link opened in a browser would send the
 * token through the tunnel in plaintext, and the edge could redeem it in a
 * sealed `recover` signed with a key of its own; a custom scheme can be
 * claimed by any app on the phone (RFC 8252). `recovery-mail.test.ts` holds
 * both bodies to that, and `docs/operating-an-instance.md` says it to a
 * mailer's author: send this text as it is.
 *
 * ⚠️ **The wording is a DRAFT for the owner's approval** (ADR 0047 D-14 Q6),
 * proposed in #1194's pull request. Change a sentence here and in the pull
 * request that approves it, never only in one.
 */

/** A mail, as the instance writes it: the operator's mailer sends it as it is. */
export interface RecoveryMailText {
  readonly subject: string;
  /** Plain text. Holds the code, and no URL. */
  readonly text: string;
}

/** How a day is written in a mail: "12 September". UTC, because a mail has no device clock. */
export function mailDay(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(unixSeconds * 1000));
}

/** The line every mail ends on: where the code goes, and where it must not. */
export const TYPE_THIS_CODE_TEXT =
  'Type this code into the On Your Left app, on the device that asked for it. It is not a link, and nothing in this mail is one: do not paste it into a web page.';

/** The recovery mail (`POST /v1/auth/recover/email`). */
export function recoveryMailText(token: string): RecoveryMailText {
  return {
    subject: 'Your On Your Left recovery code',
    text: [
      'Somebody asked to recover the On Your Left account that uses this address.',
      '',
      `Your recovery code: ${token}`,
      '',
      TYPE_THIS_CODE_TEXT,
      'It works once, for 30 minutes. If you did not ask for it, ignore this mail: nothing changes until the code is typed in.',
    ].join('\n'),
  };
}

/**
 * The confirmation mail (`POST /v1/auth/recovery-email`), naming the device
 * that asked — "asked for by the key added on 12 September" — so a rider who
 * finds two mails at one address types the code their own device asked for
 * (review L2).
 */
export function confirmationMailText(token: string, askedByAddedAt: number): RecoveryMailText {
  return {
    subject: 'Confirm your On Your Left recovery address',
    text: [
      `A device on an On Your Left account gave this address for recovery. It was asked for by the key added on ${mailDay(askedByAddedAt)}.`,
      '',
      `Your confirmation code: ${token}`,
      '',
      TYPE_THIS_CODE_TEXT,
      'It works once, for 24 hours. A new address recovers nothing for a week after it is confirmed. If you did not ask for this, ignore this mail.',
    ].join('\n'),
  };
}
