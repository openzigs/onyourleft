// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drafted account-change wording and the device-list marks after a
 * revoke (#1193, ADR 0047 D-8 and D-14 Q6). The sentences are asserted whole,
 * so a change to one is a change a reviewer sees here.
 */

import { describe, expect, it } from 'vitest';

import {
  AFTER_REVOKE_TEXT,
  formatDay,
  keyName,
  noticeText,
  REVOKE_MARK_TEXT,
  revokeMarks,
  type AccountChangeEntry,
  type ListedKey,
} from './account-change-notices';

const day = (unixSeconds: number): string => `day ${String(unixSeconds)}`;

const KEYS: readonly ListedKey[] = [
  { publicKey: 'mine', addedAt: 100 },
  { publicKey: 'september', addedAt: 200 },
  { publicKey: 'october', addedAt: 300 },
];

const entry = (overrides: Partial<AccountChangeEntry>): AccountChangeEntry => ({
  id: 1,
  at: 900,
  kind: 'link_code_minted',
  actorKey: 'september',
  subjectKey: null,
  via: null,
  address: null,
  ...overrides,
});

describe('a notice (#1193 draft wording)', () => {
  it('names a key by the day it was added, this device as itself, and a lost one plainly', () => {
    expect(keyName('september', KEYS, 'mine', day)).toBe('the key added on day 200');
    expect(keyName('mine', KEYS, 'mine', day)).toBe('this device');
    expect(keyName('gone', KEYS, 'mine', day)).toBe('a key this account no longer lists');
  });

  it('says what another key did, when, and what to do if it was not the rider', () => {
    const text = (overrides: Partial<AccountChangeEntry>): string =>
      noticeText(entry(overrides), KEYS, 'mine', day);
    expect(text({ kind: 'codes_replaced' })).toBe(
      'On day 900 the key added on day 200 replaced your recovery codes. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'address_added', address: 'a@example.org' })).toBe(
      'On day 900 the key added on day 200 added a recovery address, a@example.org. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'address_cleared', address: 'a@example.org' })).toBe(
      'On day 900 the key added on day 200 cleared a recovery address, a@example.org. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'link_code_minted' })).toBe(
      'On day 900 the key added on day 200 minted a link code. If that was not you, revoke that key.',
    );
    expect(text({ kind: 'key_revoked', subjectKey: 'mine' })).toBe(
      'On day 900 the key added on day 200 revoked this device. If that was not you, revoke that key.',
    );
  });

  it('says a new key was added, and how', () => {
    const text = (via: AccountChangeEntry['via']): string =>
      noticeText(entry({ kind: 'key_added', subjectKey: 'october', via }), KEYS, 'mine', day);
    expect(text('link_code')).toBe(
      'A new key was added to your account on day 900, by a link code from the key added on day 200.',
    );
    expect(text('recovery_code')).toBe(
      'A new key was added to your account on day 900, with a recovery code.',
    );
    expect(text('email_token')).toBe(
      'A new key was added to your account on day 900, with a code mailed to a recovery address.',
    );
  });

  it('writes a day as the day and the month', () => {
    // Noon UTC, so the day is the same in every time zone a test runs in.
    expect(formatDay(Date.UTC(2026, 9, 3, 12) / 1000)).toBe('3 October');
  });
});

describe('the device list after a revoke (#1193)', () => {
  it('marks keys added since the revoked key, and — apart — keys added with a code it minted', () => {
    const changes = [
      entry({
        id: 1,
        kind: 'key_added',
        actorKey: 'mine',
        subjectKey: 'september',
        via: 'link_code',
      }),
      entry({
        id: 2,
        kind: 'key_added',
        actorKey: 'september',
        subjectKey: 'october',
        via: 'link_code',
      }),
    ];
    const marks = revokeMarks(KEYS, changes, 'september');
    expect([...marks.entries()]).toEqual([['october', 'linked-by-revoked']]);
    // Revoking the oldest key marks every key added since.
    expect([...revokeMarks(KEYS, [], 'mine').entries()].sort()).toEqual([
      ['october', 'added-since'],
      ['september', 'added-since'],
    ]);
    // An earlier key linked by the revoked one is still marked as linked by it.
    expect(
      revokeMarks(
        KEYS,
        [entry({ kind: 'key_added', actorKey: 'october', subjectKey: 'mine', via: 'link_code' })],
        'october',
      ).get('mine'),
    ).toBe('linked-by-revoked');
    // A key added by `recover` is not marked as linked by anybody.
    expect(
      revokeMarks(
        KEYS,
        [
          entry({
            kind: 'key_added',
            actorKey: 'october',
            subjectKey: 'mine',
            via: 'recovery_code',
          }),
        ],
        'october',
      ).get('mine'),
    ).toBeUndefined();
  });

  it('has words for every mark, and says the codes are unchanged', () => {
    expect(Object.keys(REVOKE_MARK_TEXT).sort()).toEqual(['added-since', 'linked-by-revoked']);
    expect(AFTER_REVOKE_TEXT).toContain('your recovery codes are unchanged');
  });
});
