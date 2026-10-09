// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Account recovery as a rider meets it (#1194, ADR 0047 D-8): the one-off
 * review, the full reset, replacing an address, the hold, the three new
 * refusals, and the codes a rider types from a mail. Pure, and every sentence
 * is here.
 *
 * ⚠️ **The wording is a DRAFT for the owner's approval** (ADR 0047 D-14 Q6),
 * proposed in #1194's pull request. Nothing renders it yet: the Devices
 * screen that shows the review, the reset and the address cards is #1208's,
 * built on the sealed client #1192 switched the app to. Change a sentence
 * here and in the pull request that approves it, never only in one.
 *
 * Three rules here are safety rules rather than wording, and each has a test
 * that goes red without it:
 *
 * - **A mailed code is typed, never followed** ({@link typedCode}): anything
 *   that looks like a URL — `https:`, any other scheme, `www.` — is refused,
 *   so a link pasted in place of a code is never sent anywhere (D-8: a link
 *   opened in a browser crosses the edge in plaintext).
 * - **The review is PER DEVICE** ({@link reviewDue}): it is done when THIS
 *   device's key did it, never because another of the athlete's keys did —
 *   or a key the edge added could take it once and have it count for the
 *   rider.
 * - **The review never resets by itself** ({@link resetRequest}): the full
 *   reset is built only with a step-up — a recovery code, or a code mailed to
 *   an established address — and the review only offers it.
 */

/** A device as `GET /v1/auth/devices` lists it. */
export interface ReviewedDevice {
  readonly publicKey: string;
  /** Unix seconds. */
  readonly addedAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly thisDevice: boolean;
}

/** A recovery address as `GET /v1/auth/devices` lists it. */
export interface ReviewedAddress {
  readonly address: string;
  readonly confirmedAt: number | null;
  /** When its first week ends, Unix seconds; `null` once it recovers. */
  readonly heldUntil: number | null;
  readonly boundByKey: string | null;
}

// ---------------------------------------------------------------------------
// The code a rider types from a mail
// ---------------------------------------------------------------------------

/** Why a typed code was refused. */
export type TypedCodeProblem = 'empty' | 'link';

/** What the rider is told when what they typed is a link, not a code (draft). */
export const NOT_A_LINK_TEXT =
  'That is a link, not a code. Type only the code from the mail — this app never takes a link from a mail, and you should not open one.';

/** What the rider is told when they typed nothing (draft). */
export const EMPTY_CODE_TEXT = 'Type the code from the mail.';

/**
 * A code as the rider typed it, ready to send inside a sealed request — or the
 * refusal. A URL of any kind is refused: an `https:` link (an App Link
 * included), any other scheme, or a bare `www.` address (D-8).
 */
export function typedCode(
  input: string,
):
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly problem: TypedCodeProblem } {
  const code = input.trim();
  if (code === '') return { ok: false, problem: 'empty' };
  if (/:\/\//.test(code) || /^[a-z][a-z0-9+.-]*:/i.test(code) || /^www\./i.test(code)) {
    return { ok: false, problem: 'link' };
  }
  return { ok: true, code };
}

/** What the mail asks the rider to do with the code, as the app repeats it (draft). */
export const TYPE_THE_CODE_TEXT =
  'We have mailed you a code. Type it here, on this device. It is not a link: do not open anything in the mail.';

// ---------------------------------------------------------------------------
// The hold, the limit and the three refusals
// ---------------------------------------------------------------------------

/** Said where an address is given (draft, D-8 "The cost"). */
export const HOLD_TEXT =
  'A new address recovers nothing for a week. Until then your other recovery address and your recovery codes are what get you back in.';

/** The pending-confirmation card, naming the device that asked (draft, review L2). */
export function pendingCardText(address: string, askedByAddedOn: string): string {
  return `We mailed a code to ${address}, asked for by the key added on ${askedByAddedOn}. Type the code from that mail — if two mails arrived, type the one that names this device.`;
}

/** A held address in the list (draft). */
export function heldUntilText(address: string, until: string): string {
  return `${address} recovers nothing until ${until}.`;
}

/** The three refusals #1194 adds, as a rider reads them (draft). */
export const RECOVERY_REFUSAL_TEXT = {
  address_limit:
    'Your account already has two recovery addresses. Clear one before you add another.',
  address_unbound:
    'That code was mailed to an address that is no longer one of your recovery addresses, or is still in its first week. Ask for a new code, or use a recovery code.',
  confirmation_superseded:
    'Another of your devices confirmed this address first, so this code no longer works. Your account changes say which device did; if it was not you, revoke it.',
} as const;

// ---------------------------------------------------------------------------
// Replacing an address: the order the app offers
// ---------------------------------------------------------------------------

/**
 * Replacing an established address is three steps, offered in this order, so
 * a rider is never without one (D-8). Draft.
 */
export const REPLACE_ADDRESS_STEPS: readonly string[] = [
  'Give your new address and type the code we mail to it.',
  'Wait a week: until then the new address recovers nothing, and your old one still does.',
  'Then clear the old address. That needs one of your recovery codes, or a code mailed to the old address.',
];

// ---------------------------------------------------------------------------
// Codes on paper, and the invite caution
// ---------------------------------------------------------------------------

/** Shown with recovery codes, every time they are shown (draft). */
export const KEEP_CODES_ON_PAPER_TEXT =
  'Write these codes on paper and keep them away from this phone. Anyone with this phone and one of these codes can take your account, and an address whose mail this phone reads is a weaker way back than a code.';

/** Shown where an invitation is shared (draft). */
export const INVITE_CAUTION_TEXT =
  'Send this invitation only to the person it is for, by a way only they read. Anyone who has it before them can register with it.';

// ---------------------------------------------------------------------------
// The full reset
// ---------------------------------------------------------------------------

/** What the full reset does, said before it is offered (draft). */
export const RESET_TEXT =
  'The full reset gives you ten new recovery codes, clears every recovery address, and cancels every code that has been mailed or made for this account. Your old recovery codes stop working. It needs one of your recovery codes, or a code mailed to a recovery address that is past its first week.';

/** A step-up for the reset or for clearing an established address. */
export interface StepUp {
  readonly recoveryCode?: string;
  readonly emailToken?: string;
}

/**
 * The full reset's request body — built ONLY with a step-up. The review offers
 * the reset; it never makes one without the rider's recovery code or a mailed
 * code, so a key alone (the edge's, a thief's) cannot use the review to reset.
 */
export function resetRequest(
  stepUp: StepUp,
):
  | { readonly ok: true; readonly body: StepUp }
  | { readonly ok: false; readonly problem: 'step-up' | TypedCodeProblem } {
  const given = [stepUp.recoveryCode, stepUp.emailToken].filter(
    (value): value is string => value !== undefined && value.trim() !== '',
  );
  if (given.length !== 1) return { ok: false, problem: 'step-up' };
  const typed = typedCode(given[0] as string);
  if (!typed.ok) return typed;
  return {
    ok: true,
    body:
      stepUp.recoveryCode !== undefined && stepUp.recoveryCode.trim() !== ''
        ? { recoveryCode: typed.code }
        : { emailToken: typed.code },
  };
}

// ---------------------------------------------------------------------------
// The one-off review
// ---------------------------------------------------------------------------

/** Where a device keeps which of its keys has done the review. */
export interface ReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The storage key: the instance AND this device's key, so one device's review
 * never stands for another's — not even when two devices share a browser
 * profile.
 */
export function reviewStorageKey(origin: string, deviceKey: string): string {
  return `oyl.instance.review.v1.${origin}.${deviceKey}`;
}

/** Record that THIS device's key has done the review. */
export function markReviewed(
  storage: ReviewStorage,
  origin: string,
  deviceKey: string,
  atUnixSeconds: number,
): void {
  storage.setItem(reviewStorageKey(origin, deviceKey), String(atUnixSeconds));
}

/**
 * Whether the account predates the pin: any of its keys was added before this
 * device pinned the instance. Such an account may hold a key, a code or an
 * address the edge set up before phase 1 (D-8's residue).
 */
export function accountPredatesPin(
  devices: readonly Pick<ReviewedDevice, 'addedAt'>[],
  pinnedAtUnixSeconds: number,
): boolean {
  return devices.some((device) => device.addedAt < pinnedAtUnixSeconds);
}

/**
 * Whether THIS device is shown the review at its first sealed use: the
 * account predates the pin, and this device's own key has not done it.
 * Another key's review never counts for this device.
 */
export function reviewDue(
  storage: ReviewStorage,
  origin: string,
  deviceKey: string,
  predatesPin: boolean,
): boolean {
  return predatesPin && storage.getItem(reviewStorageKey(origin, deviceKey)) === null;
}

/** The review's three parts, in order (draft). */
export const REVIEW_TEXT = {
  heading: 'Check your account',
  intro:
    'This account was made before this app checked who it was talking to, so something may have been added to it that you did not add. Nothing here changes on its own: you decide.',
  devices:
    'These are the devices that can sign in as you. Keys marked “before the check” were added before this app checked your instance. Revoke any device you do not recognise.',
  beforePin: 'Added before the check',
  addresses: 'These are your recovery addresses. Is each one yours?',
  notMine:
    'If an address is not yours: one still in its first week goes when you revoke the device that gave it; one past its first week needs one of your recovery codes, or the full reset below.',
  reset:
    'We recommend the full reset: your recovery codes may have crossed the internet unprotected before this check, and an address may not be yours.',
  done: 'I have checked',
} as const;

/** One device row of the review. */
export interface ReviewDeviceRow extends ReviewedDevice {
  readonly beforePin: boolean;
}

/** What the review shows: every device (keys before the pin marked), every address, and the reset recommended. */
export interface Review {
  readonly devices: readonly ReviewDeviceRow[];
  readonly addresses: readonly ReviewedAddress[];
  readonly recommendReset: true;
}

/** The review's rows from the device list. It reads; it changes nothing. */
export function reviewOf(
  devices: readonly ReviewedDevice[],
  addresses: readonly ReviewedAddress[],
  pinnedAtUnixSeconds: number,
): Review {
  return {
    devices: devices.map((device) => ({
      ...device,
      beforePin: device.addedAt < pinnedAtUnixSeconds,
    })),
    addresses,
    recommendReset: true,
  };
}
