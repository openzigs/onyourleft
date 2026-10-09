// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told about their account's changes (#1193, ADR 0047 D-8):
 * the account-change notices, and how the device list is marked after a
 * revoke. Pure, and every sentence is here.
 *
 * ⚠️ **The wording is a DRAFT for the owner's approval** (ADR 0047 D-14 Q6),
 * proposed in #1193's pull request. Nothing renders it yet: the call that
 * reads `GET /v1/auth/account-changes` goes through the sealed client that
 * #1192 switches the app to, and the Devices screen that shows these notices
 * is built on that, in #1208. Change a sentence here and in the pull
 * request that approves it, never only in one.
 *
 * A key is named the way a rider can recognise it — by the day it was added
 * ("the key added on 12 September"), or as "this device" — and never by its
 * hex, which nobody reads.
 *
 * ⚠️ **A revoked key is named by its day, never as "this device"** (the
 * owner's ruling of 2026-10-09): notices are read on the rider's OTHER
 * devices, and a revoked key cannot read anything — its sessions end with
 * the revoke, a revoked key cannot sign in, and its row is kept, so it can
 * never be linked again (`key_in_use`). So the reading device is never the
 * key a revocation names, and there is no "this device" branch for it. The
 * day comes from the entry itself (`subjectAddedAt`), not from the device
 * list, so the notice can name it whatever list the screen holds.
 */

/** One entry of the log, as `GET /v1/auth/account-changes` answers it. */
export interface AccountChangeEntry {
  readonly id: number;
  /** Unix seconds. */
  readonly at: number;
  readonly kind:
    | 'codes_replaced'
    | 'address_added'
    | 'address_cleared'
    | 'link_code_minted'
    | 'key_added'
    | 'key_revoked';
  readonly actorKey: string;
  readonly subjectKey: string | null;
  /** Unix seconds: the day {@link subjectKey} was added; `null` with no subject. */
  readonly subjectAddedAt: number | null;
  readonly via: 'link_code' | 'recovery_code' | 'email_token' | null;
  readonly address: string | null;
}

/** What the notices need to know of a device: `GET /v1/auth/devices`'s rows. */
export interface ListedKey {
  readonly publicKey: string;
  /** Unix seconds. */
  readonly addedAt: number;
}

/** How a date is written in a notice: "3 October". */
export type DayFormat = (unixSeconds: number) => string;

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

/** The device's own calendar, "3 October". */
export const formatDay: DayFormat = (unixSeconds) => dayMonth.format(new Date(unixSeconds * 1000));

/** The sentence that follows every change another key made, but a key added. */
export const IF_NOT_YOU_TEXT = 'If that was not you, revoke that key.';

/** How a key is named in a notice: by its day, or as this device. */
export function keyName(
  publicKey: string,
  keys: readonly ListedKey[],
  thisDevice: string,
  day: DayFormat = formatDay,
): string {
  if (publicKey === thisDevice) return 'this device';
  const listed = keys.find((key) => key.publicKey === publicKey);
  return listed === undefined
    ? 'a key this account no longer lists'
    : `the key added on ${day(listed.addedAt)}`;
}

/**
 * How the key a revocation names is written: by the day it was added, from
 * the entry itself. Never "this device" — see the header.
 */
function revokedKeyName(entry: AccountChangeEntry, day: DayFormat = formatDay): string {
  return entry.subjectAddedAt === null ? 'a key' : `the key added on ${day(entry.subjectAddedAt)}`;
}

/**
 * One notice, in a sentence or two: what happened, when, by which key — and,
 * for anything but a key added, what to do if it was not the rider.
 */
export function noticeText(
  entry: AccountChangeEntry,
  keys: readonly ListedKey[],
  thisDevice: string,
  day: DayFormat = formatDay,
): string {
  const when = day(entry.at);
  const actor = keyName(entry.actorKey, keys, thisDevice, day);
  const by = (did: string): string => `On ${when} ${actor} ${did}. ${IF_NOT_YOU_TEXT}`;
  switch (entry.kind) {
    case 'codes_replaced':
      return by('replaced your recovery codes');
    case 'address_added':
      return by(`added a recovery address, ${entry.address ?? 'one this app was not told'}`);
    case 'address_cleared':
      return by(`cleared a recovery address, ${entry.address ?? 'one this app was not told'}`);
    case 'link_code_minted':
      return by('made a link code');
    case 'key_revoked':
      return by(`revoked ${revokedKeyName(entry, day)}`);
    case 'key_added':
      switch (entry.via) {
        case 'link_code':
          return `A new key was added to your account on ${when}, by a link code from ${actor}.`;
        case 'email_token':
          return `A new key was added to your account on ${when}, with a code mailed to a recovery address.`;
        default:
          return `A new key was added to your account on ${when}, with a recovery code.`;
      }
  }
}

/** How a key in the device list is marked after a revoke. */
export type RevokeMark = 'linked-by-revoked' | 'added-since';

/** The words beside a marked key (draft, D-14 Q6). */
export const REVOKE_MARK_TEXT: Readonly<Record<RevokeMark, string>> = {
  'linked-by-revoked':
    'Added with a link code from the key you revoked. Revoke it too if you do not recognise it.',
  'added-since':
    'Added after the key you revoked was first used. Revoke it if you do not recognise it.',
};

/** What is said above the list once a key has been revoked (draft, D-14 Q6). */
export const AFTER_REVOKE_TEXT =
  'That key is revoked. The link codes it made no longer work, and your recovery codes are unchanged. Look at the keys marked below: revoke any you do not recognise.';

/**
 * Which keys to mark after `revoked` is revoked (ADR 0047 D-8): every key
 * added since the revoked key was first used, and — marked apart — every key
 * added with a link code it minted.
 *
 * "First used" is taken as the day the revoked key was ADDED, which is never
 * later than its first use: so this marks at least every key D-8 asks for,
 * and perhaps a few more, rather than missing one.
 */
export function revokeMarks(
  keys: readonly ListedKey[],
  changes: readonly AccountChangeEntry[],
  revoked: string,
): ReadonlyMap<string, RevokeMark> {
  const marks = new Map<string, RevokeMark>();
  const since = keys.find((key) => key.publicKey === revoked)?.addedAt;
  if (since !== undefined) {
    for (const key of keys) {
      if (key.publicKey !== revoked && key.addedAt >= since)
        marks.set(key.publicKey, 'added-since');
    }
  }
  for (const entry of changes) {
    if (
      entry.kind === 'key_added' &&
      entry.via === 'link_code' &&
      entry.actorKey === revoked &&
      entry.subjectKey !== null &&
      entry.subjectKey !== revoked
    ) {
      marks.set(entry.subjectKey, 'linked-by-revoked');
    }
  }
  return marks;
}
